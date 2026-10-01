import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { inflateRawSync } from "node:zlib";

const MAX_TOOL_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_TOOL_ZIP_ENTRIES = 1_024;
const MAX_TOOL_ZIP_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_TOOL_ZIP_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_TOOL_ZIP_PATH_BYTES = 1_024;

function fail(stage, evidence = {}) {
  throw new Error(`${stage}: ${JSON.stringify(evidence)}`);
}

function decodeUtf8(bytes, stage) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { fail(stage); }
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

export async function readVerifiedLocalTool(tool) {
  let metadata;
  try {
    metadata = await lstat(tool.path);
  } catch (error) {
    fail("local-validation-tool-missing", {
      tool: tool.label,
      code: error?.code ?? "UNKNOWN",
    });
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== tool.bytes) {
    fail("local-validation-tool-size-mismatch", {
      tool: tool.label,
      expectedBytes: tool.bytes,
      actualBytes: metadata.size,
    });
  }
  const bytes = await readFile(tool.path);
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== tool.sha256) {
    fail("local-validation-tool-hash-mismatch", {
      tool: tool.label,
      expectedSha256: tool.sha256,
      actualSha256: actualHash,
    });
  }
  return bytes;
}

function findToolArchiveEndOfCentralDirectory(bytes, label) {
  const minimumOffset = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  fail("tool-archive-eocd-missing", { tool: label });
}

function normalizedToolArchivePath(name, directory, label, index) {
  const normalized = directory ? name.slice(0, -1) : name;
  const segments = normalized.split("/");
  const reservedWindowsName = /^(?:aux|con|nul|prn|com[1-9]|lpt[1-9])(?:\.|$)/iu;
  if (
    normalized.length === 0 ||
    Buffer.byteLength(name, "utf8") > MAX_TOOL_ZIP_PATH_BYTES ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes(":") ||
    /[\u0000-\u001f]/u.test(name) ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.endsWith(".") ||
        segment.endsWith(" ") ||
        Buffer.byteLength(segment, "utf8") > 255 ||
        reservedWindowsName.test(segment),
    )
  ) {
    fail("tool-archive-entry-path-invalid", { tool: label, index });
  }
  return normalized;
}

export function parseVerifiedToolArchive(bytes, label) {
  if (bytes.byteLength > MAX_TOOL_ARCHIVE_BYTES) {
    fail("tool-archive-size-limit", { tool: label, bytes: bytes.byteLength });
  }
  const eocdOffset = findToolArchiveEndOfCentralDirectory(bytes, label);
  const disk = bytes.readUInt16LE(eocdOffset + 4);
  const centralDisk = bytes.readUInt16LE(eocdOffset + 6);
  const diskEntryCount = bytes.readUInt16LE(eocdOffset + 8);
  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  const centralSize = bytes.readUInt32LE(eocdOffset + 12);
  const centralOffset = bytes.readUInt32LE(eocdOffset + 16);
  const commentLength = bytes.readUInt16LE(eocdOffset + 20);
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    diskEntryCount !== entryCount ||
    entryCount === 0 ||
    entryCount > MAX_TOOL_ZIP_ENTRIES ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    eocdOffset + 22 + commentLength !== bytes.length ||
    centralOffset + centralSize !== eocdOffset
  ) {
    fail("tool-archive-layout-invalid", { tool: label });
  }

  const archiveNames = new Set();
  const files = new Map();
  const tree = new Map();
  const localRanges = [];
  let totalUncompressed = 0;
  let cursor = centralOffset;

  const addDirectory = (path, index) => {
    const existing = tree.get(path);
    if (existing?.kind === "file") {
      fail("tool-archive-file-directory-conflict", { tool: label, index });
    }
    tree.set(path, { kind: "directory" });
  };

  for (let index = 0; index < entryCount; index += 1) {
    if (
      cursor + 46 > eocdOffset ||
      bytes.readUInt32LE(cursor) !== 0x02014b50
    ) {
      fail("tool-archive-central-directory-invalid", { tool: label, index });
    }
    const versionMadeBy = bytes.readUInt16LE(cursor + 4);
    const flags = bytes.readUInt16LE(cursor + 8);
    const compression = bytes.readUInt16LE(cursor + 10);
    const crc32 = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const entryCommentLength = bytes.readUInt16LE(cursor + 32);
    const diskStart = bytes.readUInt16LE(cursor + 34);
    const externalAttributes = bytes.readUInt32LE(cursor + 38);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const centralEntryEnd =
      cursor + 46 + nameLength + extraLength + entryCommentLength;
    if (
      centralEntryEnd > eocdOffset ||
      diskStart !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff ||
      compressedSize > MAX_TOOL_ARCHIVE_BYTES ||
      uncompressedSize > MAX_TOOL_ZIP_ENTRY_BYTES ||
      totalUncompressed + uncompressedSize > MAX_TOOL_ZIP_TOTAL_BYTES ||
      (flags & ~0x080e) !== 0 ||
      ![0, 8].includes(compression) ||
      (compression === 0 && (flags & 0x0006) !== 0)
    ) {
      fail("tool-archive-entry-unsupported", { tool: label, index });
    }
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    if ((flags & 0x0800) === 0 && rawName.some((byte) => byte > 0x7f)) {
      fail("tool-archive-entry-encoding-unsupported", { tool: label, index });
    }
    const name = decodeUtf8(rawName, "tool-archive-entry-name-invalid");
    const directory = name.endsWith("/");
    const path = normalizedToolArchivePath(name, directory, label, index);
    const caseFoldedPath = path.toLocaleLowerCase("en-US");
    if (archiveNames.has(caseFoldedPath)) {
      fail("tool-archive-entry-duplicate", { tool: label, index });
    }
    archiveNames.add(caseFoldedPath);

    const hostSystem = versionMadeBy >>> 8;
    const unixType = (externalAttributes >>> 16) & 0xf000;
    if (
      hostSystem === 3 &&
      (unixType === 0xa000 ||
        (unixType !== 0 && unixType !== 0x4000 && unixType !== 0x8000) ||
        (unixType === 0x4000) !== directory)
    ) {
      fail("tool-archive-entry-type-unsupported", { tool: label, index });
    }
    if (directory && (compressedSize !== 0 || uncompressedSize !== 0)) {
      fail("tool-archive-directory-content-invalid", { tool: label, index });
    }
    if (
      localOffset + 30 > centralOffset ||
      bytes.readUInt32LE(localOffset) !== 0x04034b50
    ) {
      fail("tool-archive-local-header-invalid", { tool: label, index });
    }
    const localFlags = bytes.readUInt16LE(localOffset + 6);
    const localCompression = bytes.readUInt16LE(localOffset + 8);
    const localCrc32 = bytes.readUInt32LE(localOffset + 14);
    const localCompressedSize = bytes.readUInt32LE(localOffset + 18);
    const localUncompressedSize = bytes.readUInt32LE(localOffset + 22);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (
      localFlags !== flags ||
      localCompression !== compression ||
      dataOffset + compressedSize > centralOffset ||
      ((flags & 0x0008) === 0 &&
        (localCrc32 !== crc32 ||
          localCompressedSize !== compressedSize ||
          localUncompressedSize !== uncompressedSize))
    ) {
      fail("tool-archive-local-metadata-mismatch", { tool: label, index });
    }
    const localName = decodeUtf8(
      bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength),
      "tool-archive-local-name-invalid",
    );
    if (localName !== name) {
      fail("tool-archive-entry-name-mismatch", { tool: label, index });
    }

    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    let content;
    if (compression === 0) {
      content = Buffer.from(compressed);
    } else {
      try {
        content = inflateRawSync(compressed, {
          maxOutputLength: MAX_TOOL_ZIP_ENTRY_BYTES,
        });
      } catch {
        fail("tool-archive-deflate-invalid", { tool: label, index });
      }
    }
    if (content.byteLength !== uncompressedSize) {
      fail("tool-archive-entry-size-mismatch", { tool: label, index });
    }

    const segments = path.split("/");
    for (let depth = 1; depth < segments.length; depth += 1) {
      addDirectory(segments.slice(0, depth).join("/"), index);
    }
    if (directory) {
      addDirectory(path, index);
    } else {
      const existing = tree.get(path);
      if (existing !== undefined) {
        fail("tool-archive-file-directory-conflict", { tool: label, index });
      }
      const sha256 = createHash("sha256").update(content).digest("hex");
      tree.set(path, { kind: "file", bytes: content.byteLength, sha256 });
      files.set(path, content);
    }
    localRanges.push({ start: localOffset, end: dataOffset + compressedSize });
    totalUncompressed += uncompressedSize;
    cursor = centralEntryEnd;
  }
  if (cursor !== eocdOffset) {
    fail("tool-archive-central-directory-size-mismatch", { tool: label });
  }
  localRanges.sort((left, right) => left.start - right.start);
  if (localRanges[0]?.start !== 0) {
    fail("tool-archive-leading-payload-forbidden", { tool: label });
  }
  for (let index = 1; index < localRanges.length; index += 1) {
    if (localRanges[index - 1].end > localRanges[index].start) {
      fail("tool-archive-entry-overlap", { tool: label, index });
    }
  }
  return { files, tree };
}

export function toolTreePath(root, archivePath, stage) {
  const path = resolve(root, ...archivePath.split("/"));
  if (!path.startsWith(`${resolve(root)}${sep}`)) {
    fail(`${stage}-path-escape`);
  }
  return path;
}

export async function inspectExtractedToolTree(root, stage) {
  const tree = new Map();
  const visit = async (absoluteDirectory, relativeDirectory) => {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en-US"));
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const absolutePath = toolTreePath(root, relativePath, stage);
      const metadata = await lstat(absolutePath);
      if (entry.isSymbolicLink() || metadata.isSymbolicLink()) {
        fail(`${stage}-symlink-forbidden`, { path: relativePath });
      }
      if (entry.isDirectory() && metadata.isDirectory()) {
        tree.set(relativePath, { kind: "directory" });
        await visit(absolutePath, relativePath);
      } else if (entry.isFile() && metadata.isFile()) {
        tree.set(relativePath, {
          kind: "file",
          bytes: metadata.size,
          sha256: await sha256File(absolutePath),
        });
      } else {
        fail(`${stage}-entry-type-invalid`, { path: relativePath });
      }
    }
  };
  await visit(resolve(root), "");
  return tree;
}

export async function verifyExtractedToolTree(root, expectedTree, stage) {
  const actualTree = await inspectExtractedToolTree(root, stage);
  const expectedPaths = [...expectedTree.keys()].sort();
  const actualPaths = [...actualTree.keys()].sort();
  if (
    expectedPaths.length !== actualPaths.length ||
    expectedPaths.some((path, index) => path !== actualPaths[index])
  ) {
    fail(`${stage}-path-set-mismatch`, {
      expectedEntries: expectedPaths.length,
      actualEntries: actualPaths.length,
    });
  }
  for (const path of expectedPaths) {
    const expected = expectedTree.get(path);
    const actual = actualTree.get(path);
    if (
      expected.kind !== actual.kind ||
      (expected.kind === "file" &&
        (expected.bytes !== actual.bytes || expected.sha256 !== actual.sha256))
    ) {
      fail(`${stage}-content-mismatch`, { path });
    }
  }
}
export async function extractVerifiedToolArchive(
  bytes,
  destinationRoot,
  label,
  capturePaths,
) {
  const { files, tree } = parseVerifiedToolArchive(bytes, label);
  await mkdir(destinationRoot, { recursive: false });
  const directories = [...tree.entries()]
    .filter(([, entry]) => entry.kind === "directory")
    .map(([path]) => path)
    .sort((left, right) => {
      const depth = left.split("/").length - right.split("/").length;
      return depth === 0 ? left.localeCompare(right, "en-US") : depth;
    });
  for (const path of directories) {
    await mkdir(toolTreePath(destinationRoot, path, "tool-extraction"), {
      recursive: false,
    });
  }
  const captured = new Map();
  for (const [path, content] of files) {
    const outputPath = toolTreePath(destinationRoot, path, "tool-extraction");
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content, { flag: "wx" });
    if (capturePaths.has(path)) {
      captured.set(path, Buffer.from(content));
    }
  }
  for (const path of capturePaths) {
    if (!captured.has(path)) {
      fail("tool-archive-self-test-entry-missing", { tool: label, path });
    }
  }
  await verifyExtractedToolTree(destinationRoot, tree, "tool-extraction-verify");
  return { root: resolve(destinationRoot), tree, captured };
}

export function verifyExtractedIdentity(extraction, identity) {
  const entry = extraction.tree.get(identity.archivePath);
  if (
    entry?.kind !== "file" ||
    entry.bytes !== identity.bytes ||
    entry.sha256 !== identity.sha256
  ) {
    fail("tool-archive-leaf-identity-mismatch", { tool: identity.label });
  }
}
