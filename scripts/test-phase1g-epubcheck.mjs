import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const validationRoot = resolve(
  repositoryRoot,
  ".tools",
  "phase1g-validation",
);
const epubCheckArchive = resolve(validationRoot, "epubcheck-5.3.0.zip");
const javaArchive = resolve(validationRoot, "temurin-jre-21.0.11+10.zip");
const exporterExecutable = resolve(
  repositoryRoot,
  "crates",
  "madi-export-epub",
  "target",
  "debug",
  "madi-export-epub.exe",
);

const PROCESS_TIMEOUT_MS = 120_000;
const PROCESS_KILL_GRACE_MS = 5_000;
const MAX_PROCESS_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_EPUB_BYTES = 64 * 1024 * 1024;
const MAX_ZIP_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_EPUBCHECK_REPORT_BYTES = 8 * 1024 * 1024;
const MAX_TOOL_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_TOOL_ZIP_ENTRIES = 1_024;
const MAX_TOOL_ZIP_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_TOOL_ZIP_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_TOOL_ZIP_PATH_BYTES = 1_024;
const EPUBCHECK_JAR_ARCHIVE_PATH = "epubcheck-5.3.0/epubcheck.jar";
const EPUBCHECK_TRANSITIVE_JAR_PROBE =
  "epubcheck-5.3.0/lib/httpclient5-5.1.3.jar";
const JAVA_ROOT_ARCHIVE_PATH = "jdk-21.0.11+10-jre";
const JAVA_EXECUTABLE_ARCHIVE_PATH = `${JAVA_ROOT_ARCHIVE_PATH}/bin/java.exe`;
const JAVA_RELEASE_ARCHIVE_PATH = `${JAVA_ROOT_ARCHIVE_PATH}/release`;
const JAVA_RUNTIME_DLL_PROBE = `${JAVA_ROOT_ARCHIVE_PATH}/bin/server/jvm.dll`;
const javaOfflineProperties = [
  "-Djava.net.useSystemProxies=false",
  "-Dhttp.proxyHost=127.0.0.1",
  "-Dhttp.proxyPort=9",
  "-Dhttps.proxyHost=127.0.0.1",
  "-Dhttps.proxyPort=9",
  "-Djavax.xml.accessExternalDTD=",
  "-Djavax.xml.accessExternalSchema=",
  "-Djavax.xml.accessExternalStylesheet=",
];
const actualEpubMode = process.argv[2] === "--actual-epub";

if (process.argv.length !== (actualEpubMode ? 3 : 2)) {
  fail("phase1g-epubcheck-arguments-invalid", {
    argumentCount: process.argv.length - 2,
  });
}

const epubCheckDistribution = {
  label: "EPUBCheck 5.3.0 distribution",
  path: epubCheckArchive,
  bytes: 33_071_108,
  sha256: "6c07e68584b2e2ce2f89fe06e1246dfead3eb36b46b340e7d93524f29dcff6c5",
};
const javaDistribution = {
  label: "Eclipse Temurin JRE 21.0.11+10 distribution",
  path: javaArchive,
  bytes: 49_005_708,
  sha256: "be26677aaa20b39a62edcaab4c8857a8b76673b0f45abc0b6143b142b62717e4",
};
const epubCheckJarIdentity = {
  label: "EPUBCheck 5.3.0 executable JAR",
  archivePath: EPUBCHECK_JAR_ARCHIVE_PATH,
  bytes: 1_223_671,
  sha256: "f7f96617c929371821609b88c8484d6dc9f24fe916499863c46094c5fb778a65",
};
const javaExecutableIdentity = {
  label: "Eclipse Temurin JRE 21.0.11+10 java.exe",
  archivePath: JAVA_EXECUTABLE_ARCHIVE_PATH,
  bytes: 50_344,
  sha256: "5e0fab9f07952ceb6e71eb9fd33e1ed69959904ca00cf70869b7baf516a98016",
};

function fail(stage, evidence = {}) {
  throw new Error(`${stage}: ${JSON.stringify(evidence)}`);
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function readVerifiedLocalTool(tool) {
  let metadata;
  try {
    metadata = await stat(tool.path);
  } catch (error) {
    fail("local-validation-tool-missing", {
      tool: tool.label,
      code: error?.code ?? "UNKNOWN",
    });
  }
  if (!metadata.isFile() || metadata.size !== tool.bytes) {
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

function parseVerifiedToolArchive(bytes, label) {
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

function toolTreePath(root, archivePath, stage) {
  const path = resolve(root, ...archivePath.split("/"));
  if (!path.startsWith(`${resolve(root)}${sep}`)) {
    fail(`${stage}-path-escape`);
  }
  return path;
}

async function inspectExtractedToolTree(root, stage) {
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

async function verifyExtractedToolTree(root, expectedTree, stage) {
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

async function extractVerifiedToolArchive(
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

function verifyExtractedIdentity(extraction, identity) {
  const entry = extraction.tree.get(identity.archivePath);
  if (
    entry?.kind !== "file" ||
    entry.bytes !== identity.bytes ||
    entry.sha256 !== identity.sha256
  ) {
    fail("tool-archive-leaf-identity-mismatch", { tool: identity.label });
  }
}

async function assertExtractedMutationRejected(extraction, archivePath, label) {
  if (spawnedProcessCount !== 0) {
    fail("tool-tree-self-test-ran-after-spawn", { tool: label });
  }
  const original = extraction.captured.get(archivePath);
  if (original === undefined || original.byteLength === 0) {
    fail("tool-tree-self-test-source-missing", { tool: label });
  }
  const tampered = Buffer.from(original);
  tampered[Math.floor(tampered.byteLength / 2)] ^= 0xff;
  const target = toolTreePath(extraction.root, archivePath, "tool-tree-self-test");
  await writeFile(target, tampered);
  const expectedStage = `tool-tree-self-test-${label}`;
  let rejected = false;
  try {
    await verifyExtractedToolTree(extraction.root, extraction.tree, expectedStage);
  } catch (error) {
    if (!String(error?.message).startsWith(`${expectedStage}-`)) {
      throw error;
    }
    rejected = true;
  }
  if (!rejected || spawnedProcessCount !== 0) {
    fail("tool-tree-self-test-mutation-not-rejected", { tool: label });
  }
  await writeFile(target, original);
  await verifyExtractedToolTree(
    extraction.root,
    extraction.tree,
    `tool-tree-self-test-${label}-restored`,
  );
}

let spawnedProcessCount = 0;

function runBoundedProcess(executable, arguments_, options = {}) {
  const {
    input,
    timeoutMs = PROCESS_TIMEOUT_MS,
    maxOutputBytes = MAX_PROCESS_OUTPUT_BYTES,
  } = options;
  return new Promise((resolvePromise) => {
    spawnedProcessCount += 1;
    let child;
    try {
      child = spawn(executable, arguments_, {
        cwd: repositoryRoot,
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            ([name]) =>
              ![
                "JAVA_TOOL_OPTIONS",
                "_JAVA_OPTIONS",
                "JDK_JAVA_OPTIONS",
                "MADI_PHASE1G_ACTUAL_EPUB",
              ].includes(name.toUpperCase()),
          ),
        ),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      resolvePromise({
        exitCode: null,
        signal: null,
        timedOut: false,
        outputOverflow: false,
        spawnErrorCode: error?.code ?? "UNKNOWN",
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
      });
      return;
    }

    const stdoutChunks = [];
    const stderrChunks = [];
    let outputBytes = 0;
    let outputOverflow = false;
    let timedOut = false;
    let spawnErrorCode = null;
    let settled = false;
    let killGraceTimer;

    const finish = (exitCode, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killGraceTimer);
      resolvePromise({
        exitCode,
        signal,
        timedOut,
        outputOverflow,
        spawnErrorCode,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
      });
    };

    const terminate = () => {
      child.kill("SIGKILL");
      killGraceTimer = setTimeout(
        () => finish(null, "KILL_GRACE_EXPIRED"),
        PROCESS_KILL_GRACE_MS,
      );
    };

    const capture = (chunks) => (chunk) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        outputOverflow = true;
        terminate();
        return;
      }
      chunks.push(chunk);
    };

    child.stdout.on("data", capture(stdoutChunks));
    child.stderr.on("data", capture(stderrChunks));
    child.on("error", (error) => {
      spawnErrorCode = error?.code ?? "UNKNOWN";
    });
    child.on("close", finish);
    child.stdin.on("error", (error) => {
      spawnErrorCode = error?.code ?? "STDIN_ERROR";
      terminate();
    });

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);

    child.stdin.end(input);
  });
}

function assertProcessSucceeded(stage, result) {
  if (
    result.exitCode !== 0 ||
    result.timedOut ||
    result.outputOverflow ||
    result.spawnErrorCode !== null
  ) {
    fail(stage, {
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      outputOverflow: result.outputOverflow,
      spawnErrorCode: result.spawnErrorCode,
    });
  }
}

function canonicalValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

function sourceReference(sceneId, suffix, headingNodeId = null) {
  const rangeVerified = headingNodeId === null;
  return {
    sourceNodeId: headingNodeId ?? sceneId,
    sceneNodeId: sceneId,
    documentId: `document-${sceneId}`,
    blockId: `source-${sceneId}-${suffix}`,
    start: rangeVerified ? 0 : null,
    end: rangeVerified ? 10 : null,
    rangeVerified,
  };
}

function richInlines(sceneId) {
  return [
    {
      kind: "TEXT",
      text: `한국어 ${sceneId} <script>alert(1)</script> & XML “문자” `,
    },
    {
      kind: "STRONG",
      children: [{ kind: "TEXT", text: "굵게" }],
    },
    {
      kind: "EMPHASIS",
      children: [{ kind: "TEXT", text: "기울임" }],
    },
    {
      kind: "UNDERLINE",
      children: [{ kind: "TEXT", text: "밑줄" }],
    },
    {
      kind: "STRIKE",
      children: [{ kind: "TEXT", text: "취소" }],
    },
    {
      kind: "RUBY",
      annotation: "한",
      children: [{ kind: "TEXT", text: "韓" }],
    },
  ];
}

function scene(sectionNumber, chapter = null) {
  const sceneId = `scene-${sectionNumber}`;
  const blocks = [];
  if (sectionNumber === 1) {
    blocks.push({
      kind: "HEADING",
      id: "heading-work",
      level: 1,
      text: "작품 <검증>",
      source: sourceReference(sceneId, "heading-work", "work-a"),
    });
  }
  if (chapter !== null) {
    blocks.push({
      kind: "HEADING",
      id: `heading-${chapter.id}`,
      level: 3,
      text: chapter.title,
      source: sourceReference(
        sceneId,
        `heading-${chapter.id}`,
        chapter.id,
      ),
    });
  }
  blocks.push(
    {
      kind: "HEADING",
      id: `heading-${sceneId}`,
      level: 4,
      text: `장면 ${sectionNumber}`,
      source: sourceReference(sceneId, "heading-scene", sceneId),
    },
    {
      kind: "PARAGRAPH",
      id: `paragraph-${sceneId}`,
      inlines: richInlines(sceneId),
      source: sourceReference(sceneId, "paragraph"),
    },
    {
      kind: "QUOTE",
      id: `quote-${sceneId}`,
      inlines: [{ kind: "TEXT", text: "인용 & <문장> '따옴표'" }],
      source: sourceReference(sceneId, "quote"),
    },
    {
      kind: "SCENE_BREAK",
      id: `break-${sceneId}`,
      source: sourceReference(sceneId, "break"),
    },
    {
      kind: "UNSUPPORTED",
      id: `unsupported-${sceneId}`,
      nodeType: "custom-block",
      text: "안전한 <fallback> 텍스트",
      source: sourceReference(sceneId, "unsupported"),
    },
  );
  return {
    id: `section-${sectionNumber}`,
    sourceNodeId: sceneId,
    kind: "SCENE",
    title: `장면 ${sectionNumber}`,
    parentTitles: [
      "작품 <검증>",
      chapter?.title ?? "제1화 & 시작",
    ],
    blocks,
  };
}

function inlinePlainText(inlines) {
  return inlines
    .map((inline) =>
      inline.kind === "TEXT"
        ? inline.text
        : inlinePlainText(inline.children),
    )
    .join("");
}

function blockPlainText(block) {
  switch (block.kind) {
    case "PARAGRAPH":
    case "QUOTE":
      return inlinePlainText(block.inlines);
    case "UNSUPPORTED":
      return block.text;
    default:
      return "";
  }
}

function codePointCount(value) {
  return [...value].length;
}

function createPublicationDocument() {
  const sections = [
    scene(1, { id: "chapter-a", title: "제1화 & 시작" }),
    scene(2),
  ];
  const plainTextBlocks = sections
    .flatMap((section) => section.blocks)
    .filter((block) => ["PARAGRAPH", "QUOTE", "UNSUPPORTED"].includes(block.kind));
  const text = plainTextBlocks.map(blockPlainText).join("");
  return {
    formatVersion: 1,
    projectId: "project-phase1g-epubcheck",
    projectRevision: 42,
    scopeNodeId: "work-a",
    scopeKind: "WORK",
    metadata: {
      title: "작품 <검증>",
      authorName: "작가 & 공동",
      language: "ko",
    },
    sections,
    stats: {
      withSpaces: codePointCount(text),
      withoutSpaces: codePointCount(
        [...text].filter((character) => !/\s/u.test(character)).join(""),
      ),
      paragraphCount: sections
        .flatMap((section) => section.blocks)
        .filter((block) => ["PARAGRAPH", "QUOTE"].includes(block.kind))
        .length,
      sceneCount: sections.length,
      chapterCount: 1,
    },
  };
}

function publicationHash(document) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(document)), "utf8")
    .digest("hex");
}

function createExporterInput(document, splitMode, outputPath) {
  return {
    operationId: randomUUID(),
    mode: "EXPORT",
    document,
    request: {
      projectId: document.projectId,
      scopeNodeId: document.scopeNodeId,
      expectedProjectRevision: document.projectRevision,
      sourcePublicationHash: publicationHash(document),
      metadata: {
        title: "출판 제목 <안전>",
        creatorName: "작가 & 공동",
        language: "ko-KR",
        identifier: "urn:madi:phase1g:epubcheck",
        publisher: "출판사 & Co.",
        description: "설명 <script>문자열</script>",
        rights: "All rights reserved & 안전",
        subjects: ["소설 & 테스트"],
      },
      options: {
        targetProfile: "EPUB_3_3_COMPATIBILITY",
        splitMode,
        includeCover: false,
        includeSceneTitles: true,
        includeChapterTitles: true,
        tocDepth: 4,
        sceneBreakStyleToken: "ORNAMENT",
        bodyStyleToken: "REFLOWABLE_PROSE",
        stylesheetToken: "MADI_CLASSIC",
      },
      outputPath,
      replaceExisting: false,
      cover: null,
    },
  };
}

function parseExporterResult(result) {
  assertProcessSucceeded("epub-exporter-failed", result);
  let messages;
  try {
    messages = result.stdout
      .toString("utf8")
      .split(/\r?\n/u)
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
  } catch {
    fail("epub-exporter-invalid-json-lines");
  }
  const terminal = messages.at(-1);
  if (
    terminal?.kind !== "RESULT" ||
    terminal.mode !== "EXPORT" ||
    terminal.summary?.targetProfile !== "EPUB_3_3_COMPATIBILITY"
  ) {
    fail("epub-exporter-invalid-terminal-message", {
      kind: terminal?.kind ?? null,
      mode: terminal?.mode ?? null,
      targetProfile: terminal?.summary?.targetProfile ?? null,
    });
  }
  return terminal.summary;
}

function findEndOfCentralDirectory(bytes) {
  const minimumOffset = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  fail("epub-reopen-eocd-missing");
}

function decodeUtf8(bytes, stage) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail(stage);
  }
}

function reopenZip(bytes) {
  if (bytes.byteLength > MAX_EPUB_BYTES) {
    fail("epub-reopen-size-limit", { bytes: bytes.byteLength });
  }
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const disk = bytes.readUInt16LE(eocdOffset + 4);
  const centralDisk = bytes.readUInt16LE(eocdOffset + 6);
  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  const centralSize = bytes.readUInt32LE(eocdOffset + 12);
  const centralOffset = bytes.readUInt32LE(eocdOffset + 16);
  const commentLength = bytes.readUInt16LE(eocdOffset + 20);
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    eocdOffset + 22 + commentLength !== bytes.length ||
    centralOffset + centralSize !== eocdOffset
  ) {
    fail("epub-reopen-unsupported-zip-layout");
  }

  const entries = new Map();
  const localOffsets = [];
  let totalUncompressed = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (
      cursor + 46 > eocdOffset ||
      bytes.readUInt32LE(cursor) !== 0x02014b50
    ) {
      fail("epub-reopen-central-directory-invalid", { index });
    }
    const compression = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const entryCommentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const centralEntryEnd =
      cursor + 46 + nameLength + extraLength + entryCommentLength;
    if (
      centralEntryEnd > eocdOffset ||
      uncompressedSize > MAX_ZIP_ENTRY_BYTES ||
      totalUncompressed + uncompressedSize > MAX_ZIP_TOTAL_BYTES
    ) {
      fail("epub-reopen-entry-limit", { index });
    }
    const name = decodeUtf8(
      bytes.subarray(cursor + 46, cursor + 46 + nameLength),
      "epub-reopen-entry-name-invalid",
    );
    const pathSegments = name.split("/");
    if (
      name.length === 0 ||
      name.startsWith("/") ||
      name.includes("\\") ||
      pathSegments.includes("") ||
      pathSegments.includes(".") ||
      pathSegments.includes("..") ||
      entries.has(name)
    ) {
      fail("epub-reopen-entry-path-invalid", { index });
    }
    if (
      localOffset + 30 > centralOffset ||
      bytes.readUInt32LE(localOffset) !== 0x04034b50
    ) {
      fail("epub-reopen-local-header-invalid", { index });
    }
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > centralOffset) {
      fail("epub-reopen-entry-data-invalid", { index });
    }
    const localName = decodeUtf8(
      bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength),
      "epub-reopen-local-name-invalid",
    );
    if (localName !== name) {
      fail("epub-reopen-entry-name-mismatch", { index });
    }
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    let content;
    if (compression === 0) {
      content = Buffer.from(compressed);
    } else if (compression === 8) {
      try {
        content = inflateRawSync(compressed, {
          maxOutputLength: MAX_ZIP_ENTRY_BYTES,
        });
      } catch {
        fail("epub-reopen-deflate-invalid", { index });
      }
    } else {
      fail("epub-reopen-compression-unsupported", { index, compression });
    }
    if (content.byteLength !== uncompressedSize) {
      fail("epub-reopen-entry-size-mismatch", { index });
    }
    entries.set(name, { compression, content });
    localOffsets.push({ name, offset: localOffset });
    totalUncompressed += uncompressedSize;
    cursor = centralEntryEnd;
  }
  if (cursor !== eocdOffset) {
    fail("epub-reopen-central-directory-size-mismatch");
  }
  localOffsets.sort((left, right) => left.offset - right.offset);
  const first = localOffsets[0];
  const mimetype = entries.get("mimetype");
  if (
    first?.name !== "mimetype" ||
    first.offset !== 0 ||
    mimetype?.compression !== 0 ||
    mimetype.content.toString("ascii") !== "application/epub+zip"
  ) {
    fail("epub-reopen-mimetype-invalid");
  }
  for (const required of [
    "META-INF/container.xml",
    "EPUB/package.opf",
    "EPUB/nav.xhtml",
  ]) {
    if (!entries.has(required)) {
      fail("epub-reopen-required-entry-missing", { entry: required });
    }
  }
  return entries;
}

function stableBlockId(sourceId) {
  const kind = "block";
  const hash = createHash("sha256");
  hash.update("madi-epub-source-v1", "utf8");
  const kindLength = Buffer.alloc(8);
  kindLength.writeBigUInt64BE(BigInt(Buffer.byteLength(kind, "utf8")));
  hash.update(kindLength);
  hash.update(kind, "utf8");
  const sourceLength = Buffer.alloc(8);
  sourceLength.writeBigUInt64BE(BigInt(Buffer.byteLength(sourceId, "utf8")));
  hash.update(sourceLength);
  hash.update(sourceId, "utf8");
  return `madi-block-${hash.digest("hex")}`;
}

function decodeXmlText(value) {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/gu, (_, decimal) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function renderedPlainText(fragment) {
  return decodeXmlText(
    fragment
      .replace(/<rt(?:\s[^>]*)?>[\s\S]*?<\/rt>/giu, "")
      .replace(/<[^>]+>/gu, ""),
  );
}

function matchExactlyOnce(documents, expression, stage) {
  const matches = documents.flatMap((document) => [
    ...document.matchAll(expression),
  ]);
  if (matches.length !== 1) {
    fail(stage, { matches: matches.length });
  }
  return matches[0];
}

function verifyReopenedCoverage(document, entries, summary) {
  const contentDocuments = [...entries.entries()]
    .filter(([name]) => /^EPUB\/text\/[^/]+\.xhtml$/u.test(name))
    .map(([, entry]) => decodeUtf8(entry.content, "epub-xhtml-invalid-utf8"));
  if (contentDocuments.length === 0) {
    fail("epub-reopen-content-documents-missing");
  }
  for (const source of contentDocuments) {
    if (/<script(?:\s|>)/iu.test(source) || /\son[a-z]+\s*=/iu.test(source)) {
      fail("epub-reopen-executable-content-found");
    }
  }

  const blocks = document.sections.flatMap((section) => section.blocks);
  let observedCharacterCount = 0;
  for (const block of blocks) {
    const id = stableBlockId(block.id);
    let match;
    if (block.kind === "SCENE_BREAK") {
      matchExactlyOnce(
        contentDocuments,
        new RegExp(`<hr\\s+id="${id}"[^>]*>`, "gu"),
        "epub-reopen-scene-break-coverage",
      );
      continue;
    }
    if (block.kind === "HEADING") {
      match = matchExactlyOnce(
        contentDocuments,
        new RegExp(
          `<h${block.level}\\s+id="${id}"[^>]*>([\\s\\S]*?)<\\/h${block.level}>`,
          "gu",
        ),
        "epub-reopen-heading-coverage",
      );
      if (renderedPlainText(match[1]) !== block.text) {
        fail("epub-reopen-heading-text-mismatch");
      }
      continue;
    }
    if (block.kind === "QUOTE") {
      match = matchExactlyOnce(
        contentDocuments,
        new RegExp(
          `<blockquote\\s+id="${id}"[^>]*>([\\s\\S]*?)<\\/blockquote>`,
          "gu",
        ),
        "epub-reopen-quote-coverage",
      );
    } else {
      match = matchExactlyOnce(
        contentDocuments,
        new RegExp(`<p\\s+id="${id}"[^>]*>([\\s\\S]*?)<\\/p>`, "gu"),
        "epub-reopen-paragraph-coverage",
      );
    }
    const observedText = renderedPlainText(match[1]);
    const expectedText = blockPlainText(block);
    if (observedText !== expectedText) {
      fail("epub-reopen-block-text-mismatch", { kind: block.kind });
    }
    observedCharacterCount += codePointCount(observedText);
  }

  const expectedCharacterCount = blocks
    .map(blockPlainText)
    .reduce((total, value) => total + codePointCount(value), 0);
  const statistics = summary.statistics;
  if (
    statistics.sourceBlockCount !== blocks.length ||
    statistics.exportedBlockCount !== blocks.length ||
    statistics.rejectedBlockCount !== 0 ||
    statistics.sourceCharacterCount !== expectedCharacterCount ||
    statistics.exportedCharacterCount !== expectedCharacterCount ||
    observedCharacterCount !== expectedCharacterCount ||
    statistics.sourceSectionCount !== document.sections.length ||
    statistics.exportedSectionCount !== document.sections.length ||
    summary.validationReport?.status !== "PASS" ||
    summary.validationReport?.fatalCount !== 0 ||
    summary.validationReport?.errorCount !== 0
  ) {
    fail("epub-reopen-coverage-mismatch", {
      expectedBlocks: blocks.length,
      sourceBlocks: statistics.sourceBlockCount,
      exportedBlocks: statistics.exportedBlockCount,
      rejectedBlocks: statistics.rejectedBlockCount,
      expectedCharacters: expectedCharacterCount,
      sourceCharacters: statistics.sourceCharacterCount,
      exportedCharacters: statistics.exportedCharacterCount,
      reopenedCharacters: observedCharacterCount,
      internalStatus: summary.validationReport?.status ?? null,
    });
  }
  return {
    sourceSections: document.sections.length,
    exportedSections: statistics.exportedSectionCount,
    sourceBlocks: blocks.length,
    exportedBlocks: statistics.exportedBlockCount,
    rejectedBlocks: statistics.rejectedBlockCount,
    sourceCharacters: expectedCharacterCount,
    exportedCharacters: statistics.exportedCharacterCount,
    reopenedCharacters: observedCharacterCount,
  };
}

function collectEpubCheckMessages(value, messages = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectEpubCheckMessages(item, messages);
    }
    return messages;
  }
  if (value === null || typeof value !== "object") {
    return messages;
  }
  const severity =
    typeof value.severity === "string" ? value.severity.toUpperCase() : null;
  if (["FATAL", "ERROR", "WARNING", "INFO", "USAGE"].includes(severity)) {
    messages.push({
      severity,
      code:
        typeof value.ID === "string"
          ? value.ID
          : typeof value.id === "string"
            ? value.id
            : typeof value.code === "string"
              ? value.code
              : "UNKNOWN",
    });
  }
  for (const nested of Object.values(value)) {
    collectEpubCheckMessages(nested, messages);
  }
  return messages;
}

async function runEpubCheck(epubPath, reportPath, toolPaths) {
  const startedAt = performance.now();
  const result = await runBoundedProcess(
    toolPaths.javaExecutable,
    [
      "-Duser.language=en",
      "-Duser.country=US",
      ...javaOfflineProperties,
      "-jar",
      toolPaths.epubCheckJar,
      epubPath,
      "--profile",
      "default",
      "--json",
      reportPath,
      "--locale",
      "en",
      "--quiet",
    ],
    { timeoutMs: PROCESS_TIMEOUT_MS },
  );
  let reportBytes;
  try {
    const reportMetadata = await stat(reportPath);
    if (!reportMetadata.isFile() || reportMetadata.size > MAX_EPUBCHECK_REPORT_BYTES) {
      fail("epubcheck-report-size-invalid", { bytes: reportMetadata.size });
    }
    reportBytes = await readFile(reportPath);
  } catch (error) {
    fail("epubcheck-report-missing", { code: error?.code ?? "UNKNOWN" });
  }
  let report;
  try {
    report = JSON.parse(reportBytes.toString("utf8"));
  } catch {
    fail("epubcheck-report-invalid-json");
  }
  const messages = collectEpubCheckMessages(report);
  const counts = Object.fromEntries(
    ["FATAL", "ERROR", "WARNING", "INFO", "USAGE"].map((severity) => [
      severity.toLowerCase(),
      messages.filter((message) => message.severity === severity).length,
    ]),
  );
  if (
    result.exitCode !== 0 ||
    result.timedOut ||
    result.outputOverflow ||
    result.spawnErrorCode !== null ||
    counts.fatal !== 0 ||
    counts.error !== 0
  ) {
    fail("epubcheck-validation-failed", {
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      outputOverflow: result.outputOverflow,
      spawnErrorCode: result.spawnErrorCode,
      counts,
      messageCodes: [...new Set(messages.map((message) => message.code))].sort(),
    });
  }
  return {
    status: "PASS",
    version: toolPaths.epubCheckVersion,
    elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
    fatalCount: counts.fatal,
    errorCount: counts.error,
    warningCount: counts.warning,
    infoCount: counts.info,
    usageCount: counts.usage,
  };
}

async function exportAndValidateFixture(
  directory,
  document,
  splitMode,
  toolPaths,
) {
  const normalizedName = splitMode.toLowerCase();
  const epubPath = resolve(directory, `epub-3-3-${normalizedName}.epub`);
  const reportPath = resolve(directory, `epubcheck-${normalizedName}.json`);
  const input = createExporterInput(document, splitMode, epubPath);
  const exporterResult = await runBoundedProcess(
    exporterExecutable,
    [],
    { input: JSON.stringify(input) },
  );
  const summary = parseExporterResult(exporterResult);
  const epubBytes = await readFile(epubPath);
  const actualSha256 = createHash("sha256").update(epubBytes).digest("hex");
  if (
    summary.byteLength !== epubBytes.byteLength ||
    summary.sha256 !== actualSha256
  ) {
    fail("epub-exporter-output-hash-mismatch", {
      summaryBytes: summary.byteLength,
      reopenedBytes: epubBytes.byteLength,
      summarySha256: summary.sha256,
      reopenedSha256: actualSha256,
    });
  }
  const entries = reopenZip(epubBytes);
  const coverage = verifyReopenedCoverage(document, entries, summary);
  const epubCheck = await runEpubCheck(epubPath, reportPath, toolPaths);
  return {
    targetProfile: "EPUB_3_3_COMPATIBILITY",
    splitMode,
    sha256: actualSha256,
    byteLength: epubBytes.byteLength,
    zipReopened: true,
    fileCount: entries.size,
    internalValidation: {
      status: summary.validationReport.status,
      fatalCount: summary.validationReport.fatalCount,
      errorCount: summary.validationReport.errorCount,
      warningCount: summary.validationReport.warningCount,
    },
    epubCheck,
    coverage,
  };
}

async function resolveActualEpubInput() {
  const configured = process.env.MADI_PHASE1G_ACTUAL_EPUB?.trim();
  if (!configured) {
    fail("phase1g-actual-epub-input-missing");
  }
  const artifactRoot = resolve(repositoryRoot, "output", "playwright");
  const actualPath = resolve(configured);
  const comparableArtifactRoot =
    process.platform === "win32"
      ? artifactRoot.toLocaleLowerCase()
      : artifactRoot;
  const comparableActualPath =
    process.platform === "win32" ? actualPath.toLocaleLowerCase() : actualPath;
  if (
    !comparableActualPath.startsWith(`${comparableArtifactRoot}${sep}`) ||
    !/^madi-(?:electron|packaged)-phase1g-representative\.epub$/u.test(
      basename(actualPath),
    )
  ) {
    fail("phase1g-actual-epub-input-scope");
  }
  let metadata;
  try {
    metadata = await lstat(actualPath);
  } catch (error) {
    fail("phase1g-actual-epub-input-missing", {
      code: error?.code ?? "UNKNOWN",
    });
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size <= 0 ||
    metadata.size > MAX_EPUB_BYTES
  ) {
    fail("phase1g-actual-epub-input-invalid", {
      regularFile: metadata.isFile(),
      symbolicLink: metadata.isSymbolicLink(),
      bytes: metadata.size,
    });
  }
  return {
    path: actualPath,
    byteLength: metadata.size,
    sha256: await sha256File(actualPath),
  };
}

if (process.platform !== "win32") {
  fail("phase1g-epubcheck-platform-unsupported", {
    requiredPlatform: "win32",
    actualPlatform: process.platform,
  });
}

const [epubCheckArchiveBytes, javaArchiveBytes, modeInput] = await Promise.all([
  readVerifiedLocalTool(epubCheckDistribution),
  readVerifiedLocalTool(javaDistribution),
  actualEpubMode ? resolveActualEpubInput() : stat(exporterExecutable),
]);
if (!actualEpubMode && !modeInput.isFile()) {
  fail("epub-exporter-missing");
}

const temporaryRoot = resolve(tmpdir());
const temporaryDirectory = await mkdtemp(
  resolve(temporaryRoot, "madi-phase1g-epubcheck-"),
);
const temporaryDirectoryIsSafe =
  temporaryDirectory.startsWith(`${temporaryRoot}${sep}`) &&
  basename(temporaryDirectory).startsWith("madi-phase1g-epubcheck-");
if (!temporaryDirectoryIsSafe) {
  fail("epubcheck-temporary-directory-invalid");
}
try {
  const verifiedToolsRoot = resolve(temporaryDirectory, "verified-tools");
  await mkdir(verifiedToolsRoot, { recursive: false });
  const epubCheckExtraction = await extractVerifiedToolArchive(
    epubCheckArchiveBytes,
    resolve(verifiedToolsRoot, "epubcheck"),
    epubCheckDistribution.label,
    new Set([EPUBCHECK_TRANSITIVE_JAR_PROBE]),
  );
  const javaExtraction = await extractVerifiedToolArchive(
    javaArchiveBytes,
    resolve(verifiedToolsRoot, "java"),
    javaDistribution.label,
    new Set([JAVA_RUNTIME_DLL_PROBE]),
  );
  verifyExtractedIdentity(epubCheckExtraction, epubCheckJarIdentity);
  verifyExtractedIdentity(javaExtraction, javaExecutableIdentity);
  await assertExtractedMutationRejected(
    epubCheckExtraction,
    EPUBCHECK_TRANSITIVE_JAR_PROBE,
    "transitive-jar",
  );
  await assertExtractedMutationRejected(
    javaExtraction,
    JAVA_RUNTIME_DLL_PROBE,
    "runtime-dll",
  );

  const toolPaths = {
    epubCheckJar: toolTreePath(
      epubCheckExtraction.root,
      EPUBCHECK_JAR_ARCHIVE_PATH,
      "verified-tool",
    ),
    javaExecutable: toolTreePath(
      javaExtraction.root,
      JAVA_EXECUTABLE_ARCHIVE_PATH,
      "verified-tool",
    ),
  };
  const releaseText = await readFile(
    toolTreePath(
      javaExtraction.root,
      JAVA_RELEASE_ARCHIVE_PATH,
      "verified-tool",
    ),
    "utf8",
  );
  if (
    !releaseText.includes('IMPLEMENTOR="Eclipse Adoptium"') ||
    !releaseText.includes('IMPLEMENTOR_VERSION="Temurin-21.0.11+10"') ||
    !releaseText.includes('JAVA_RUNTIME_VERSION="21.0.11+10-LTS"') ||
    !releaseText.includes('IMAGE_TYPE="JRE"')
  ) {
    fail("local-java-release-mismatch");
  }

  const versionArguments = [
    ...javaOfflineProperties,
    "-jar",
    toolPaths.epubCheckJar,
    "--version",
  ];
  const versionResult = await runBoundedProcess(
    toolPaths.javaExecutable,
    versionArguments,
  );
  assertProcessSucceeded("epubcheck-version-probe-failed", versionResult);
  const versionOutput = Buffer.concat([
    versionResult.stdout,
    versionResult.stderr,
  ]).toString("utf8");
  const observedEpubCheckVersion = versionOutput
    .trim()
    .match(/^EPUBCheck v(5\.3\.0)$/u)?.[1];
  if (!observedEpubCheckVersion) {
    fail("epubcheck-version-mismatch");
  }
  toolPaths.epubCheckVersion = observedEpubCheckVersion;
  const timeoutProbe = await runBoundedProcess(
    toolPaths.javaExecutable,
    [...javaOfflineProperties, "-jar", toolPaths.epubCheckJar, "--help"],
    { timeoutMs: 1 },
  );
  if (!timeoutProbe.timedOut || timeoutProbe.outputOverflow) {
    fail("epubcheck-timeout-probe-failed", {
      exitCode: timeoutProbe.exitCode,
      signal: timeoutProbe.signal,
      timedOut: timeoutProbe.timedOut,
      outputOverflow: timeoutProbe.outputOverflow,
    });
  }

  const commonEvidence = {
    status: "PASS",
    automaticDownloads: 0,
    externalRuntimeLookup: false,
    validator: {
      name: "EPUBCheck",
      version: observedEpubCheckVersion,
      distributionSha256: epubCheckDistribution.sha256,
      jarSha256: epubCheckJarIdentity.sha256,
      timeoutMs: PROCESS_TIMEOUT_MS,
      timeoutEnforced: true,
      externalXmlAccess: "DISABLED",
    },
    java: {
      distribution: "Eclipse Temurin JRE",
      version: "21.0.11+10-LTS",
      distributionSha256: javaDistribution.sha256,
      executableSha256: javaExecutableIdentity.sha256,
      packagedWithApplication: false,
    },
    supplyChain: {
      archiveHashVerifiedBeforeExtraction: true,
      freshTemporaryExtraction: true,
      deterministicFullTreeComparison: true,
      extractedSymlinksAllowed: false,
      adversarialPreSpawnChecks: ["TRANSITIVE_JAR", "RUNTIME_DLL"],
    },
  };
  let evidence;
  if (actualEpubMode) {
    const reportPath = resolve(temporaryDirectory, "epubcheck-actual.json");
    const epubCheck = await runEpubCheck(modeInput.path, reportPath, toolPaths);
    const finalMetadata = await lstat(modeInput.path);
    const finalSha256 = await sha256File(modeInput.path);
    if (
      !finalMetadata.isFile() ||
      finalMetadata.isSymbolicLink() ||
      finalMetadata.size !== modeInput.byteLength ||
      finalSha256 !== modeInput.sha256
    ) {
      fail("phase1g-actual-epub-input-changed", {
        regularFile: finalMetadata.isFile(),
        symbolicLink: finalMetadata.isSymbolicLink(),
        byteLengthMatched: finalMetadata.size === modeInput.byteLength,
        hashMatched: finalSha256 === modeInput.sha256,
      });
    }
    evidence = {
      check: "phase1g-actual-madi-epubcheck",
      ...commonEvidence,
      validationScope: "ACTUAL_MADI_DERIVED_EPUB",
      targetProfile: "EPUB_3_3_COMPATIBILITY",
      input: {
        byteLength: modeInput.byteLength,
        stableDuringValidation: true,
        retainedArtifact: true,
      },
      epubCheck,
      privacy: {
        rawValidatorOutputPersisted: false,
        outputPathsReported: false,
        manuscriptReported: false,
      },
    };
  } else {
    const document = createPublicationDocument();
    const fixtures = [];
    for (const splitMode of ["CHAPTER", "SCENE"]) {
      fixtures.push(
        await exportAndValidateFixture(
          temporaryDirectory,
          document,
          splitMode,
          toolPaths,
        ),
      );
    }
    evidence = {
      check: "phase1g-build-test-epubcheck",
      ...commonEvidence,
      runtimePackaging: "DEFERRED",
      validationScope: "BUILD_TEST_ONLY",
      fixtures,
      privacy: {
        manuscriptInProcessArguments: false,
        rawValidatorOutputPersisted: false,
        outputPathsReported: false,
      },
    };
  }
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  if (temporaryDirectoryIsSafe) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
