import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";

import { _electron as electron } from "playwright-core";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const desktopDirectory = resolve(repositoryRoot, "apps", "desktop");
const desktopRequire = createRequire(
  new URL("../apps/desktop/package.json", import.meta.url),
);
const childProcessModule = desktopRequire("node:child_process");
const packagedExecutable = process.env.MADI_PACKAGED_EXE?.trim();
const packaged = Boolean(packagedExecutable);
const electronExecutable = packagedExecutable || desktopRequire("electron");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const coreBinary = resolve(
  repositoryRoot,
  "crates",
  "madi-core",
  "target",
  "debug",
  `madi-core${executableSuffix}`,
);
const epubExporterBinary = resolve(
  repositoryRoot,
  "crates",
  "madi-export-epub",
  "target",
  "debug",
  `madi-export-epub${executableSuffix}`,
);
const manifestPath = resolve(
  process.env.MADI_PHASE1G_MANIFEST?.trim() ||
    resolve(repositoryRoot, "output", "test-fixtures", "phase1f-reader-fixtures.json"),
);
const artifactDirectory = resolve(repositoryRoot, "output", "playwright");
const artifactPrefix = packaged
  ? "madi-packaged-phase1g"
  : "madi-electron-phase1g";
const evidencePath = resolve(artifactDirectory, `${artifactPrefix}-evidence.json`);
const representativeEpubPath = resolve(
  artifactDirectory,
  `${artifactPrefix}-representative.epub`,
);
const normalScreenshotPath = resolve(
  artifactDirectory,
  `${artifactPrefix}-normal.png`,
);
const longScreenshotPath = resolve(
  artifactDirectory,
  `${artifactPrefix}-long.png`,
);
const epubCheckValidationScript = resolve(
  repositoryRoot,
  "scripts",
  "test-phase1g-epubcheck.mjs",
);
const WINDOW_CLOSE_TIMEOUT_MS = 195_000;
const OPERATION_TIMEOUT_MS = 240_000;
const PROCESS_EXIT_TIMEOUT_MS = 30_000;
// Chromium can throttle an occluded window to roughly 1 Hz. A 2.5 second
// ceiling tolerates that and a loaded validation host, while still rejecting
// the near-total multi-second renderer freezes this smoke is intended to catch.
const MAX_RENDERER_FRAME_GAP_MS = 2_500;
const MAX_RENDERER_HEARTBEAT_GAP_MS = 2_500;
const MAX_ZIP_ENTRIES = 10_000;
const MAX_ZIP_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 512 * 1024 * 1024;
const measurementRuns = 5;
const LONG_EXPORT_PROVISIONAL_TARGET_MS = 15_000;
const snapshotName = "Phase 1G EPUB actual checkpoint";
const presetName = "Phase 1G actual preset";
const updatedPresetName = "Phase 1G actual preset updated";
const mutationPresetName = "Phase 1G mutation preset";
const publicationTitle = "장편 출판 & <EPUB> 실제 검증";
const creatorName = "실제 검증 작가";
const mutatedCreatorName = "복원 전 임시 작가";
const metadataIdentifier = "urn:uuid:2b4c03df-f91f-5f24-93a2-f987a4318b53";
const manuscriptSentinels = [
  "한국어검증",
  "<script>alert('&')</script>",
  "&lt;script&gt;alert('&amp;')&lt;/script&gt;",
];
const privateContentFragments = [
  snapshotName,
  presetName,
  updatedPresetName,
  mutationPresetName,
  publicationTitle,
  creatorName,
  mutatedCreatorName,
  metadataIdentifier,
  ...manuscriptSentinels,
];
const mainLifecycleMarkers = Object.freeze({
  beforeQuit: "[madi-phase1g-main] before-quit",
  willQuit: "[madi-phase1g-main] will-quit",
  willQuitPrevented: "[madi-phase1g-main] will-quit-prevented",
  quit: "[madi-phase1g-main] quit",
  windowAllClosed: "[madi-phase1g-main] window-all-closed",
});
const mainLifecycleEventsByMarker = new Map(
  Object.entries(mainLifecycleMarkers).map(([event, marker]) => [marker, event]),
);
let currentStage = "startup";
let lastFailureContext = null;

function reportStage(stage) {
  currentStage = stage;
  process.stderr.write(`[electron-phase1g] ${stage}\n`);
}

function verify(condition, code, details = undefined) {
  if (!condition) {
    throw new Error(
      details === undefined ? code : `${code}: ${JSON.stringify(details)}`,
    );
  }
}

function summarizeError(error) {
  if (!(error instanceof Error)) {
    return { name: "NonError", messageLength: String(error).length };
  }
  const allowedNames = new Set([
    "Error",
    "TypeError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "URIError",
    "EvalError",
    "AggregateError",
    "TimeoutError",
  ]);
  const allowedHarnessFunctions = new Set([
    "assertSecurity",
    "closeGlobalPanel",
    "closeWindowCleanly",
    "createEpubSnapshot",
    "createMutationPreset",
    "fillMetadata",
    "inspectCanonicalExportState",
    "removeCoverAndWait",
    "restoreEpubSnapshot",
    "runNormalStateScenario",
    "saveMetadata",
  ]);
  const harnessStackFrames =
    error.stack
    ?.split(/\r?\n/gu)
    .map((frame) => {
      const location = frame.match(/electron-phase1g-smoke\.mjs:(\d+):(\d+)/u);
      if (!location) {
        return null;
      }
      const functionName =
        frame.match(/\bat\s+(?:async\s+)?([\w$]+)\s/u)?.[1] ?? "OTHER";
      return {
        function: allowedHarnessFunctions.has(functionName) ? functionName : "OTHER",
        line: Number(location[1]),
        column: Number(location[2]),
      };
    })
    .filter((frame) => frame !== null) ?? [];
  const harnessStackFrame =
    harnessStackFrames.find((frame) => frame.function !== "OTHER") ??
    harnessStackFrames[0];
  return {
    name: allowedNames.has(error.name) ? error.name : "OtherError",
    nameLength: error.name.length,
    messageLength: error.message.length,
    stackFrameCount: (error.stack?.match(/\n\s+at\s/gu) ?? []).length,
    harnessStackFrame: harnessStackFrame ?? null,
  };
}

function roundMilliseconds(value) {
  return Number(value.toFixed(2));
}

function summarizeMeasurements(samples) {
  verify(samples.length > 0, "phase1g-measurement-samples-empty");
  const ordered = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  const median =
    ordered.length % 2 === 0
      ? (ordered[middle - 1] + ordered[middle]) / 2
      : ordered[middle];
  return {
    runs: samples.length,
    samplesMs: samples.map(roundMilliseconds),
    medianMs: roundMilliseconds(median),
    maxMs: roundMilliseconds(Math.max(...samples)),
  };
}

function safeInteger(value, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum
    ? value
    : null;
}

function assertEvidencePrivacy(evidence) {
  const serialized = JSON.stringify(evidence);
  const leakedFragmentIndexes = privateContentFragments.flatMap((fragment, index) =>
    serialized.includes(fragment) ? [index] : [],
  );
  verify(leakedFragmentIndexes.length === 0, "phase1g-evidence-private-content", {
    leakedFragmentIndexes,
  });
  verify(
    !/[A-Za-z]:\\|file:\/\/|https?:\/\/|wss?:\/\//u.test(serialized),
    "phase1g-evidence-path-or-url",
  );
}

function structuralHash(value) {
  let result = 2166136261;
  for (const character of String(value)) {
    result ^= character.codePointAt(0) ?? 0;
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

function redactExternalUrl(candidate) {
  try {
    const parsed = new URL(candidate);
    const allowedProtocols = new Set([
      "http:",
      "https:",
      "ws:",
      "wss:",
      "file:",
      "madi:",
    ]);
    return {
      protocol: allowedProtocols.has(parsed.protocol) ? parsed.protocol : "OTHER",
      hostPresent: parsed.host.length > 0,
      hostLength: parsed.host.length,
      hostHash: parsed.host ? structuralHash(parsed.host) : null,
    };
  } catch {
    return {
      protocol: "invalid",
      hostPresent: false,
      hostLength: 0,
      hostHash: null,
    };
  }
}

function isLocalRuntimeUrl(candidate) {
  try {
    return ["madi:", "data:", "blob:", "devtools:"].includes(
      new URL(candidate).protocol,
    );
  } catch {
    return false;
  }
}

function isAllowedRuntimeWebSocket(candidate, pageUrl) {
  try {
    const socket = new URL(candidate);
    const page = new URL(pageUrl);
    return (
      (socket.protocol === "ws:" || socket.protocol === "wss:") &&
      (page.protocol === "http:" || page.protocol === "https:") &&
      socket.hostname === page.hostname &&
      socket.port === page.port
    );
  } catch {
    return false;
  }
}

async function poll(operation, description, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await operation();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 80));
  }
  throw new Error(
    `${description} timed out${
      lastError instanceof Error ? ` (${lastError.name}:${lastError.message.length})` : ""
    }`,
  );
}

function isWithin(candidatePath, parentPath) {
  const normalize = (value) =>
    process.platform === "win32" ? value.toLocaleLowerCase() : value;
  const candidate = normalize(resolve(candidatePath));
  const parent = normalize(resolve(parentPath));
  return candidate === parent || candidate.startsWith(`${parent}${sep}`);
}

async function fileExists(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function sha256File(filePath) {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(filePath), { recursive: true });
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    if (error?.code !== "EEXIST" && error?.code !== "EPERM") {
      throw error;
    }
    await unlink(filePath).catch((unlinkError) => {
      if (unlinkError?.code !== "ENOENT") {
        throw unlinkError;
      }
    });
    await rename(temporaryPath, filePath);
  }
}

function crc32(bytes) {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb8_8320 & mask);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65_521;
    b = (b + a) % 65_521;
  }
  return ((b << 16) | a) >>> 0;
}

function pngChunk(kind, data) {
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  kind.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([kind, data])), 8 + data.length);
  return result;
}

function createPngCover() {
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  Buffer.from([8, 6, 0, 0, 0]).copy(ihdr, 8);
  const raw = Buffer.from([0, 0x22, 0x44, 0x66, 0xff]);
  const zlib = Buffer.alloc(2 + 1 + 2 + 2 + raw.length + 4);
  Buffer.from([0x78, 0x01, 0x01]).copy(zlib, 0);
  zlib.writeUInt16LE(raw.length, 3);
  zlib.writeUInt16LE((~raw.length) & 0xffff, 5);
  raw.copy(zlib, 7);
  zlib.writeUInt32BE(adler32(raw), 7 + raw.length);
  return Buffer.concat([
    signature,
    pngChunk(Buffer.from("IHDR"), ihdr),
    pngChunk(Buffer.from("IDAT"), zlib),
    pngChunk(Buffer.from("IEND"), Buffer.alloc(0)),
  ]);
}

function createJpegCover() {
  return Buffer.from(
    "/9j/4AAQSkZJRgABAgAAAQABAAD/wAARCAADAAIDAREAAhEBAxEB/9sAQwAGBAUGBQQGBgUGBwcGCAoQCgoJCQoUDg8MEBcUGBgXFBYWGh0lHxobIxwWFiAsICMmJykqKRkfLTAtKDAlKCko/9sAQwEHBwcKCAoTCgoTKBoWGigoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwAoA//Z",
    "base64",
  );
}

function findEndOfCentralDirectory(bytes) {
  const minimumOffset = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x0605_4b50) {
      return offset;
    }
  }
  throw new Error("phase1g-zip-eocd-missing");
}

function validateZipPath(entryPath) {
  verify(entryPath.length > 0 && entryPath.length <= 512, "phase1g-zip-path-length");
  verify(!entryPath.includes("\\") && !entryPath.includes("\0"), "phase1g-zip-path-slash");
  verify(!entryPath.startsWith("/") && !/^[A-Za-z]:/u.test(entryPath), "phase1g-zip-path-absolute");
  const components = entryPath.split("/");
  verify(
    components.every(
      (component) => component.length > 0 && component !== "." && component !== "..",
    ),
    "phase1g-zip-path-traversal",
  );
}

function parseZip(bytes) {
  const eocd = findEndOfCentralDirectory(bytes);
  const disk = bytes.readUInt16LE(eocd + 4);
  const centralDisk = bytes.readUInt16LE(eocd + 6);
  const diskEntries = bytes.readUInt16LE(eocd + 8);
  const totalEntries = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  const commentLength = bytes.readUInt16LE(eocd + 20);
  verify(disk === 0 && centralDisk === 0, "phase1g-zip-multidisk");
  verify(diskEntries === totalEntries, "phase1g-zip-entry-count-disk");
  verify(totalEntries > 0 && totalEntries <= MAX_ZIP_ENTRIES, "phase1g-zip-entry-count");
  verify(eocd + 22 + commentLength === bytes.length, "phase1g-zip-terminal-bytes");
  verify(centralOffset + centralSize === eocd, "phase1g-zip-central-range");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries = [];
  const byPath = new Map();
  let centralCursor = centralOffset;
  let totalUncompressedBytes = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    verify(
      centralCursor + 46 <= eocd && bytes.readUInt32LE(centralCursor) === 0x0201_4b50,
      "phase1g-zip-central-entry",
    );
    const flags = bytes.readUInt16LE(centralCursor + 8);
    const compression = bytes.readUInt16LE(centralCursor + 10);
    const expectedCrc = bytes.readUInt32LE(centralCursor + 16);
    const compressedBytes = bytes.readUInt32LE(centralCursor + 20);
    const uncompressedBytes = bytes.readUInt32LE(centralCursor + 24);
    const nameLength = bytes.readUInt16LE(centralCursor + 28);
    const extraLength = bytes.readUInt16LE(centralCursor + 30);
    const entryCommentLength = bytes.readUInt16LE(centralCursor + 32);
    const localOffset = bytes.readUInt32LE(centralCursor + 42);
    const centralEnd =
      centralCursor + 46 + nameLength + extraLength + entryCommentLength;
    verify(centralEnd <= eocd, "phase1g-zip-central-entry-range");
    verify((flags & 0x0001) === 0, "phase1g-zip-encrypted-entry");
    verify(compression === 0 || compression === 8, "phase1g-zip-compression-method");
    verify(
      uncompressedBytes <= MAX_ZIP_ENTRY_BYTES,
      "phase1g-zip-entry-uncompressed-limit",
    );
    totalUncompressedBytes += uncompressedBytes;
    verify(totalUncompressedBytes <= MAX_ZIP_TOTAL_BYTES, "phase1g-zip-total-limit");
    const entryPath = decoder.decode(
      bytes.subarray(centralCursor + 46, centralCursor + 46 + nameLength),
    );
    validateZipPath(entryPath);
    verify(!byPath.has(entryPath), "phase1g-zip-duplicate-path");
    verify(
      localOffset + 30 <= centralOffset && bytes.readUInt32LE(localOffset) === 0x0403_4b50,
      "phase1g-zip-local-entry",
    );
    const localFlags = bytes.readUInt16LE(localOffset + 6);
    const localCompression = bytes.readUInt16LE(localOffset + 8);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const localNameStart = localOffset + 30;
    const dataStart = localNameStart + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedBytes;
    verify(dataEnd <= centralOffset, "phase1g-zip-local-data-range");
    verify(localFlags === flags && localCompression === compression, "phase1g-zip-local-contract");
    const localPath = decoder.decode(
      bytes.subarray(localNameStart, localNameStart + localNameLength),
    );
    verify(localPath === entryPath, "phase1g-zip-local-path-mismatch");
    const compressed = bytes.subarray(dataStart, dataEnd);
    const content = compression === 0 ? Buffer.from(compressed) : inflateRawSync(compressed);
    verify(content.length === uncompressedBytes, "phase1g-zip-entry-size");
    verify(crc32(content) === expectedCrc, "phase1g-zip-entry-crc");
    const entry = {
      path: entryPath,
      compression,
      localOffset,
      compressedBytes,
      uncompressedBytes,
      content,
    };
    entries.push(entry);
    byPath.set(entryPath, entry);
    centralCursor = centralEnd;
  }
  verify(centralCursor === eocd, "phase1g-zip-central-size");
  return { entries, byPath, totalUncompressedBytes };
}

function decodeXmlAttribute(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function xmlIds(xml) {
  const ids = [...xml.matchAll(/\sid="([^"]+)"/gu)].map((match) =>
    decodeXmlAttribute(match[1]),
  );
  verify(new Set(ids).size === ids.length, "phase1g-xhtml-duplicate-id");
  return new Set(ids);
}

function requireUtf8Entry(archive, entryPath) {
  const entry = archive.byPath.get(entryPath);
  verify(entry, "phase1g-zip-required-entry", { entry: structuralHash(entryPath) });
  return new TextDecoder("utf-8", { fatal: true }).decode(entry.content);
}

function validateGeneratedEpub(bytes, expected) {
  const archive = parseZip(bytes);
  const first = archive.entries[0];
  verify(
    first.path === "mimetype" && first.localOffset === 0 && first.compression === 0,
    "phase1g-epub-mimetype-container-contract",
  );
  verify(
    first.content.equals(Buffer.from("application/epub+zip", "ascii")),
    "phase1g-epub-mimetype-content",
  );
  const container = requireUtf8Entry(archive, "META-INF/container.xml");
  const rootfile = container.match(/<rootfile\b[^>]*\bfull-path="([^"]+)"/u)?.[1];
  verify(rootfile === "EPUB/package.opf", "phase1g-epub-rootfile");
  const opf = requireUtf8Entry(archive, rootfile);
  verify(/<package\b[^>]*\bversion="3\.0"/u.test(opf), "phase1g-opf-version");
  verify(/\bunique-identifier="pub-id"/u.test(opf), "phase1g-opf-identifier-reference");
  for (const requiredMetadata of [
    "dc:identifier",
    "dc:title",
    "dc:creator",
    "dc:language",
    "meta property=\"dcterms:modified\"",
  ]) {
    verify(opf.includes(`<${requiredMetadata}`), "phase1g-opf-required-metadata", {
      field: structuralHash(requiredMetadata),
    });
  }
  const manifestItems = [...opf.matchAll(/<item\s+([^>]+?)\s*\/>/gu)].map((match) => {
    const attributes = match[1];
    const id = attributes.match(/\bid="([^"]+)"/u)?.[1];
    const href = attributes.match(/\bhref="([^"]+)"/u)?.[1];
    const mediaType = attributes.match(/\bmedia-type="([^"]+)"/u)?.[1];
    const properties = attributes.match(/\bproperties="([^"]+)"/u)?.[1] ?? "";
    verify(id && href && mediaType, "phase1g-opf-manifest-item-shape");
    return {
      id: decodeXmlAttribute(id),
      href: decodeXmlAttribute(href),
      mediaType: decodeXmlAttribute(mediaType),
      properties: decodeXmlAttribute(properties),
    };
  });
  verify(manifestItems.length > 0, "phase1g-opf-manifest-empty");
  verify(
    new Set(manifestItems.map((item) => item.id)).size === manifestItems.length,
    "phase1g-opf-manifest-id-duplicate",
  );
  verify(
    new Set(manifestItems.map((item) => item.href)).size === manifestItems.length,
    "phase1g-opf-manifest-href-duplicate",
  );
  for (const item of manifestItems) {
    validateZipPath(`EPUB/${item.href}`);
    verify(archive.byPath.has(`EPUB/${item.href}`), "phase1g-opf-manifest-file-missing");
  }
  const navItem = manifestItems.find((item) =>
    item.properties.split(/\s+/u).includes("nav"),
  );
  verify(navItem?.href === "nav.xhtml", "phase1g-opf-nav-item");
  const contentItems = manifestItems.filter(
    (item) => item.mediaType === "application/xhtml+xml" && item.id !== navItem.id,
  );
  verify(contentItems.length === expected.xhtmlCount, "phase1g-opf-xhtml-count", {
    expected: expected.xhtmlCount,
    actual: contentItems.length,
  });
  const spineIds = [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/gu)].map(
    (match) => decodeXmlAttribute(match[1]),
  );
  verify(spineIds.length === contentItems.length, "phase1g-opf-spine-count");
  verify(
    spineIds.every((id) => contentItems.some((item) => item.id === id)),
    "phase1g-opf-spine-reference",
  );
  const coverItems = manifestItems.filter((item) =>
    item.properties.split(/\s+/u).includes("cover-image"),
  );
  verify(
    coverItems.length === (expected.coverIncluded ? 1 : 0),
    "phase1g-opf-cover-count",
  );
  if (expected.coverIncluded) {
    verify(
      ["image/png", "image/jpeg"].includes(coverItems[0].mediaType),
      "phase1g-opf-cover-media-type",
    );
    const coverEntry = archive.byPath.get(`EPUB/${coverItems[0].href}`);
    verify(coverEntry, "phase1g-opf-cover-entry");
    if (coverItems[0].mediaType === "image/png") {
      verify(
        coverEntry.content.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) &&
          coverEntry.content.subarray(-8, -4).equals(Buffer.from("IEND", "ascii")),
        "phase1g-cover-png-magic",
      );
    } else {
      verify(
        coverEntry.content.subarray(0, 2).equals(Buffer.from([0xff, 0xd8])) &&
          coverEntry.content.subarray(-2).equals(Buffer.from([0xff, 0xd9])),
        "phase1g-cover-jpeg-magic",
      );
    }
  }

  let sectionCount = 0;
  let blockCount = 0;
  const semanticCoverage = {
    strong: false,
    emphasis: false,
    underline: false,
    strike: false,
    ruby: false,
    rubyAnnotation: false,
    blockquote: false,
    sceneBreak: false,
    koreanUtf8: false,
    xmlSpecialEscaped: false,
    rawScriptAbsent: true,
  };
  const idsByContentPath = new Map();
  for (const item of contentItems) {
    const contentPath = `EPUB/${item.href}`;
    const xhtml = requireUtf8Entry(archive, contentPath);
    verify(/^<\?xml version="1\.0" encoding="UTF-8"\?>/u.test(xhtml), "phase1g-xhtml-declaration");
    verify(/<html\b[^>]*\bxml:lang="[^"]+"[^>]*\blang="[^"]+"/u.test(xhtml), "phase1g-xhtml-language");
    verify(/<title>[^<]+<\/title>/u.test(xhtml), "phase1g-xhtml-title");
    verify(/<link\b[^>]*\bhref="\.\.\/styles\/book\.css"/u.test(xhtml), "phase1g-xhtml-stylesheet");
    verify(!/<(?:script|iframe|object|embed)\b/iu.test(xhtml), "phase1g-xhtml-forbidden-element");
    verify(!/\son[a-z]+\s*=/iu.test(xhtml), "phase1g-xhtml-event-handler");
    verify(!/(?:src|href)="(?:https?:|\/\/)/iu.test(xhtml), "phase1g-xhtml-remote-resource");
    verify(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(xhtml), "phase1g-xhtml-control-character");
    const ids = xmlIds(xhtml);
    semanticCoverage.strong ||= /<strong>[^<]+<\/strong>/u.test(xhtml);
    semanticCoverage.emphasis ||= /<em>[^<]+<\/em>/u.test(xhtml);
    semanticCoverage.underline ||=
      /<span\s+class="underline">[^<]+<\/span>/u.test(xhtml);
    semanticCoverage.strike ||= /<s>[^<]+<\/s>/u.test(xhtml);
    semanticCoverage.ruby ||= /<ruby>/u.test(xhtml);
    semanticCoverage.rubyAnnotation ||= /<rt>[^<]+<\/rt>/u.test(xhtml);
    semanticCoverage.blockquote ||= /<blockquote\b/u.test(xhtml);
    semanticCoverage.sceneBreak ||=
      /<hr\b[^>]*\bclass="scene-break"/u.test(xhtml);
    semanticCoverage.koreanUtf8 ||= /[가-힣]/u.test(xhtml);
    semanticCoverage.xmlSpecialEscaped ||=
      xhtml.includes("&lt;script&gt;alert('&amp;')&lt;/script&gt;");
    semanticCoverage.rawScriptAbsent &&= !/<script\b/iu.test(xhtml);
    idsByContentPath.set(item.href, ids);
    sectionCount += [...ids].filter((id) => /^madi-section-[a-f0-9]{64}$/u.test(id)).length;
    blockCount += [...ids].filter((id) => /^madi-block-[a-f0-9]{64}$/u.test(id)).length;
  }
  verify(sectionCount === expected.sectionCount, "phase1g-epub-section-coverage", {
    expected: expected.sectionCount,
    actual: sectionCount,
  });
  verify(blockCount === expected.blockCount, "phase1g-epub-block-coverage", {
    expected: expected.blockCount,
    actual: blockCount,
  });
  if (expected.richSemantics) {
    verify(
      Object.values(semanticCoverage).every((covered) => covered === true),
      "phase1g-epub-rich-semantic-coverage",
      semanticCoverage,
    );
  }
  const nav = requireUtf8Entry(archive, "EPUB/nav.xhtml");
  verify(/<nav\b[^>]*\bepub:type="toc"/u.test(nav), "phase1g-nav-toc");
  verify(!/<(?:script|iframe|object|embed)\b/iu.test(nav), "phase1g-nav-forbidden-element");
  const navLinks = [...nav.matchAll(/<a\b[^>]*\bhref="([^"]+)"/gu)].map((match) =>
    decodeXmlAttribute(match[1]),
  );
  verify(navLinks.length > 0, "phase1g-nav-empty");
  for (const href of navLinks) {
    verify(!/^[a-z]+:/iu.test(href) && !href.startsWith("//"), "phase1g-nav-remote-link");
    const [targetPath, fragment] = href.split("#", 2);
    const targetIds = idsByContentPath.get(targetPath);
    verify(targetIds && fragment && targetIds.has(fragment), "phase1g-nav-broken-link");
  }
  const stylesheet = requireUtf8Entry(archive, "EPUB/styles/book.css");
  verify(!/@import|https?:|url\s*\(/iu.test(stylesheet), "phase1g-css-external-resource");
  return {
    entryCount: archive.entries.length,
    xhtmlCount: contentItems.length,
    sectionCount,
    blockCount,
    navLinkCount: navLinks.length,
    spineCount: spineIds.length,
    coverIncluded: coverItems.length === 1,
    semanticCoverage,
    mimetypeFirstStored: true,
    opfVersion: "3.0",
    reopened: true,
  };
}

function hasExactKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function validateFixtureManifest(manifest) {
  verify(
    hasExactKeys(manifest, ["formatVersion", "fixtures"]) &&
      manifest.formatVersion === 1,
    "phase1g-fixture-manifest-shape",
  );
  verify(
    hasExactKeys(manifest.fixtures, ["normal", "long"]),
    "phase1g-fixture-profiles",
  );
  for (const profile of ["normal", "long"]) {
    const fixture = manifest.fixtures[profile];
    verify(
      fixture &&
        typeof fixture.relativePath === "string" &&
        Number.isSafeInteger(fixture.bytes) &&
        /^[a-f0-9]{64}$/u.test(fixture.sha256) &&
        Number.isSafeInteger(fixture.revision) &&
        fixture.ids &&
        fixture.inventory &&
        fixture.scopes &&
        hasExactKeys(fixture.compileWork, [
          "runs",
          "samplesMs",
          "medianMs",
          "maxMs",
          "contentHash",
        ]) &&
        fixture.compileWork.runs === measurementRuns &&
        Array.isArray(fixture.compileWork.samplesMs) &&
        fixture.compileWork.samplesMs.length === measurementRuns &&
        fixture.compileWork.samplesMs.every(
          (sample) => Number.isFinite(sample) && sample >= 0,
        ) &&
        Number.isFinite(fixture.compileWork.medianMs) &&
        Number.isFinite(fixture.compileWork.maxMs) &&
        /^[a-f0-9]{64}$/u.test(fixture.compileWork.contentHash),
      "phase1g-fixture-shape",
      { profile },
    );
    const inventory = fixture.inventory;
    verify(
      Number.isSafeInteger(inventory.chapters) &&
        Number.isSafeInteger(inventory.scenes) &&
        Number.isSafeInteger(inventory.characters) &&
        Number.isSafeInteger(inventory.blocks),
      "phase1g-fixture-inventory",
      { profile },
    );
    for (const scopeKind of ["WORK", "VOLUME", "CHAPTER", "SCENE"]) {
      const scope = fixture.scopes[scopeKind];
      verify(
        scope?.scopeKind === scopeKind &&
          typeof scope.scopeNodeId === "string" &&
          Number.isSafeInteger(scope.sections) &&
          Number.isSafeInteger(scope.blocks) &&
          Number.isSafeInteger(scope.withSpaces) &&
          Number.isSafeInteger(scope.chapters) &&
          scope.sections > 0 &&
          scope.blocks > 0,
        "phase1g-fixture-scope",
        { profile, scopeKind },
      );
    }
  }
  const normal = manifest.fixtures.normal.inventory;
  const long = manifest.fixtures.long.inventory;
  verify(
    normal.chapters === 20 &&
      normal.scenes === 60 &&
      normal.characters >= 150_000 &&
      normal.characters <= 250_000,
    "phase1g-normal-fixture-shape",
  );
  verify(
    long.chapters >= 150 &&
      long.scenes >= 450 &&
      long.characters >= 675_000 &&
      long.blocks >= 2_400,
    "phase1g-long-fixture-shape",
    {
      chapters: long.chapters,
      scenes: long.scenes,
      characters: long.characters,
      blocks: long.blocks,
    },
  );
}

function validateExportReport(report, expected) {
  verify(report?.formatVersion === 1, "phase1g-report-format");
  verify(report.targetProfile === expected.profile, "phase1g-report-profile");
  verify(Number.isSafeInteger(report.sourceProjectRevision), "phase1g-report-revision");
  verify(/^[a-f0-9]{64}$/u.test(report.sourcePublicationHash), "phase1g-report-source-hash");
  verify(/^[a-f0-9]{64}$/u.test(report.epubSha256), "phase1g-report-epub-hash");
  verify(/^[a-f0-9]{64}$/u.test(report.logicalPackageHash), "phase1g-report-logical-hash");
  verify(Number.isSafeInteger(report.byteLength) && report.byteLength > 0, "phase1g-report-bytes");
  verify(Number.isSafeInteger(report.fileCount) && report.fileCount >= 6, "phase1g-report-files");
  verify(report.xhtmlCount === expected.xhtmlCount, "phase1g-report-xhtml-count");
  const coverage = report.coverage;
  verify(coverage?.sourceSectionCount === expected.sectionCount, "phase1g-report-source-sections");
  verify(coverage.exportedSectionCount === coverage.sourceSectionCount, "phase1g-report-exported-sections");
  verify(coverage.sourceBlockCount === expected.blockCount, "phase1g-report-source-blocks");
  verify(
    coverage.exportedBlockCount +
        coverage.fallbackBlockCount +
        coverage.rejectedBlockCount ===
      coverage.sourceBlockCount,
    "phase1g-report-block-accounting",
  );
  verify(coverage.rejectedBlockCount === 0, "phase1g-report-rejected-blocks");
  verify(coverage.sourceCharacterCount === expected.characterCount, "phase1g-report-source-characters");
  verify(
    coverage.exportedCharacterCount === coverage.sourceCharacterCount,
    "phase1g-report-character-loss",
  );
  verify(coverage.sceneBreakCount === expected.sceneBreakCount, "phase1g-report-scene-breaks");
  if (expected.richSemantics) {
    verify(coverage.rubyCount === expected.sectionCount, "phase1g-report-ruby-coverage", {
      expected: expected.sectionCount,
      actual: coverage.rubyCount,
    });
  }
  verify(report.coverIncluded === expected.coverIncluded, "phase1g-report-cover");
  const validation = report.validation;
  verify(validation?.status === "VALID", "phase1g-report-validation-status");
  verify(validation.fatalCount === 0 && validation.errorCount === 0, "phase1g-report-fatal-error");
  verify(Array.isArray(validation.messages), "phase1g-report-messages");
  verify(
    validation.epubCheck?.status === "UNAVAILABLE" &&
      validation.epubCheck.version === null &&
      validation.epubCheck.compatibilityOnly ===
        (expected.profile === "EPUB_3_4_DRAFT_2026_08"),
    "phase1g-report-runtime-epubcheck-contract",
  );
  const timing = report.timing;
  for (const key of [
    "splitMs",
    "xhtmlMs",
    "navigationMs",
    "packageMs",
    "internalValidationMs",
    "totalMs",
  ]) {
    verify(Number.isFinite(timing?.[key]) && timing[key] >= 0, "phase1g-report-timing", {
      key,
    });
  }
  verify(timing.epubCheckMs === null, "phase1g-report-runtime-epubcheck-timing");
  verify(typeof report.generatedAt === "string" && report.generatedAt.length > 0, "phase1g-report-generated-at");
  verify(typeof report.madiVersion === "string" && report.madiVersion.length > 0, "phase1g-report-madi-version");
  return {
    profile: report.targetProfile,
    sourceProjectRevision: report.sourceProjectRevision,
    sourceHashPresent: true,
    epubHashPresent: true,
    logicalHashPresent: true,
    byteLength: report.byteLength,
    fileCount: report.fileCount,
    xhtmlCount: report.xhtmlCount,
    coverage: {
      sourceSectionCount: coverage.sourceSectionCount,
      exportedSectionCount: coverage.exportedSectionCount,
      sourceBlockCount: coverage.sourceBlockCount,
      exportedBlockCount: coverage.exportedBlockCount,
      fallbackBlockCount: coverage.fallbackBlockCount,
      rejectedBlockCount: coverage.rejectedBlockCount,
      sourceCharacterCount: coverage.sourceCharacterCount,
      exportedCharacterCount: coverage.exportedCharacterCount,
      sceneBreakCount: coverage.sceneBreakCount,
      rubyCount: coverage.rubyCount,
      headingCount: coverage.headingCount,
    },
    coverIncluded: report.coverIncluded,
    validation: {
      status: validation.status,
      fatalCount: validation.fatalCount,
      errorCount: validation.errorCount,
      warningCount: validation.warningCount,
      infoCount: validation.infoCount,
      epubCheck: {
        status: validation.epubCheck.status,
        version: validation.epubCheck.version,
        compatibilityOnly: validation.epubCheck.compatibilityOnly,
      },
    },
    timing: {
      splitMs: roundMilliseconds(timing.splitMs),
      xhtmlMs: roundMilliseconds(timing.xhtmlMs),
      navigationMs: roundMilliseconds(timing.navigationMs),
      packageMs: roundMilliseconds(timing.packageMs),
      internalValidationMs: roundMilliseconds(timing.internalValidationMs),
      epubCheckMs: timing.epubCheckMs,
      totalMs: roundMilliseconds(timing.totalMs),
    },
  };
}

function assertReportPrivacy(text, code) {
  const leakedPrivateFragmentIndexes = privateContentFragments.flatMap(
    (fragment, index) => (text.includes(fragment) ? [index] : []),
  );
  const leakedManuscriptSentinelIndexes = manuscriptSentinels.flatMap(
    (fragment, index) => (text.includes(fragment) ? [index] : []),
  );
  verify(leakedPrivateFragmentIndexes.length === 0, code, {
    leakedPrivateFragmentIndexes,
    leakedManuscriptSentinelIndexes,
  });
  return {
    privateContentAbsent: true,
    manuscriptAbsent: true,
    checkedFragmentCount: privateContentFragments.length,
  };
}

async function readAndValidateReport(reportPath, expected) {
  const reportBytes = await readFile(reportPath);
  verify(reportBytes.length > 0 && reportBytes.length <= 8 * 1024 * 1024, "phase1g-report-file-size");
  const reportText = new TextDecoder("utf-8", { fatal: true }).decode(reportBytes);
  const privacy = assertReportPrivacy(reportText, "phase1g-json-report-private-content");
  const report = JSON.parse(reportText);
  return {
    raw: report,
    evidence: {
      ...validateExportReport(report, expected),
      privacy,
    },
  };
}

async function prepareFixture(profile, manifest, temporaryRoot) {
  const fixture = manifest.fixtures[profile];
  const sourcePath = resolve(repositoryRoot, fixture.relativePath);
  verify(isWithin(sourcePath, repositoryRoot), "phase1g-fixture-source-scope");
  const sourceStats = await stat(sourcePath);
  verify(sourceStats.isFile() && sourceStats.size === fixture.bytes, "phase1g-fixture-byte-size", {
    profile,
    expected: fixture.bytes,
    actual: sourceStats.size,
  });
  verify((await sha256File(sourcePath)) === fixture.sha256, "phase1g-fixture-sha256", {
    profile,
  });
  const projectPath = resolve(temporaryRoot, `${profile}.madi`);
  verify(isWithin(projectPath, temporaryRoot), "phase1g-fixture-copy-scope");
  await copyFile(sourcePath, projectPath);
  return { fixture, projectPath };
}

function inspectProjectWithCore(projectPath) {
  const result = spawnSync(
    coreBinary,
    ["inspect-project", "--file-path", projectPath],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30_000,
      windowsHide: true,
    },
  );
  verify(
    !result.error &&
      result.status === 0 &&
      result.signal === null &&
      (result.stderr?.length ?? 0) === 0,
    "phase1g-inspect-project-process",
    {
      status: result.status,
      signalPresent: result.signal !== null,
      stdoutLength: result.stdout?.length ?? 0,
      stderrLength: result.stderr?.length ?? 0,
    },
  );
  let inspection;
  try {
    inspection = JSON.parse(result.stdout);
  } catch {
    throw new Error("phase1g-inspect-project-json");
  }
  const inspectedPathMatched =
    isWithin(inspection.file_path, projectPath) &&
    isWithin(projectPath, inspection.file_path);
  verify(
    inspectedPathMatched &&
      inspection.application_id === 0x4d41_4449 &&
      inspection.integrity_check === "ok" &&
      inspection.metadata?.schema_version === 7 &&
      inspection.metadata?.format_version === 1,
    "phase1g-inspect-project-contract",
    {
      pathMatched: inspectedPathMatched,
      applicationIdMatched: inspection.application_id === 0x4d41_4449,
      integrityMatched: inspection.integrity_check === "ok",
      schemaVersion: safeInteger(inspection.metadata?.schema_version),
      logicalFormatVersion: safeInteger(inspection.metadata?.format_version),
    },
  );
  return {
    schemaVersion: inspection.metadata.schema_version,
    logicalFormatVersion: inspection.metadata.format_version,
    integrityCheckPassed: inspection.integrity_check === "ok",
    applicationIdMatched: inspection.application_id === 0x4d41_4449,
    coreExitCode: result.status,
    signalAbsent: result.signal === null,
  };
}

async function requestCoreRpc(method, params) {
  const request = `${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method,
    params,
  })}\n`;
  const result = await new Promise((resolveResult, rejectResult) => {
    const child = spawn(coreBinary, ["serve"], {
      cwd: repositoryRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderrLength = 0;
    let outputOverflow = false;
    let settled = false;
    let timeout;
    const finish = (value, error = undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (error) {
        rejectResult(error);
      } else {
        resolveResult(value);
      }
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length + chunk.length > 16 * 1024 * 1024) {
        outputOverflow = true;
        child.kill();
        return;
      }
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderrLength += Buffer.byteLength(chunk);
    });
    child.once("error", () =>
      finish(undefined, new Error("phase1g-core-rpc-spawn")),
    );
    child.once("close", (code, signal) =>
      finish({ code, signal, stdout, stderrLength, outputOverflow }),
    );
    child.stdin.end(request, "utf8");
    timeout = setTimeout(() => {
      child.kill();
      finish(undefined, new Error("phase1g-core-rpc-timeout"));
    }, 30_000);
  });
  verify(
    result.code === 0 &&
      result.signal === null &&
      result.stderrLength === 0 &&
      !result.outputOverflow,
    "phase1g-core-rpc-process",
    {
      exitCode: result.code,
      signalPresent: result.signal !== null,
      stderrLength: result.stderrLength,
      outputOverflow: result.outputOverflow,
    },
  );
  let response;
  try {
    response = JSON.parse(result.stdout.trim());
  } catch {
    throw new Error("phase1g-core-rpc-json");
  }
  verify(
    response?.jsonrpc === "2.0" &&
      response.id === 1 &&
      !Object.hasOwn(response, "error") &&
      response.result,
    "phase1g-core-rpc-response",
  );
  return response.result;
}

function countBufferOccurrences(haystack, needle) {
  verify(needle.length > 0, "phase1g-path-scan-empty-needle");
  let count = 0;
  let offset = 0;
  while (offset <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle, offset);
    if (found === -1) {
      break;
    }
    count += 1;
    offset = found + 1;
  }
  return count;
}

async function removeCoverSource(sourcePath, temporaryRoot) {
  verify(isWithin(sourcePath, temporaryRoot), "phase1g-cover-source-delete-scope");
  const entry = await lstat(sourcePath);
  verify(entry.isFile() && !entry.isSymbolicLink(), "phase1g-cover-source-delete-type");
  await unlink(sourcePath);
  verify(!(await fileExists(sourcePath)), "phase1g-cover-source-delete-failed");
}

async function proveEmbeddedCoverPersistence(
  projectPath,
  sourcePaths,
  expectedCoverBytes,
) {
  const sourcePresence = await Promise.all(sourcePaths.map(fileExists));
  verify(
    sourcePaths.length > 0 && sourcePresence.every((present) => !present),
    "phase1g-cover-source-still-present",
  );
  const databasePaths = [projectPath, `${projectPath}-wal`, `${projectPath}-shm`];
  let scannedFileCount = 0;
  let exactSourcePathOccurrenceCount = 0;
  for (const databasePath of databasePaths) {
    if (!(await fileExists(databasePath))) {
      continue;
    }
    scannedFileCount += 1;
    const bytes = await readFile(databasePath);
    for (const sourcePath of sourcePaths) {
      exactSourcePathOccurrenceCount += countBufferOccurrences(
        bytes,
        Buffer.from(sourcePath, "utf8"),
      );
      exactSourcePathOccurrenceCount += countBufferOccurrences(
        bytes,
        Buffer.from(sourcePath, "utf16le"),
      );
    }
  }
  verify(scannedFileCount >= 1, "phase1g-cover-path-scan-no-database");
  verify(
    exactSourcePathOccurrenceCount === 0,
    "phase1g-cover-source-path-persisted",
    { exactSourcePathOccurrenceCount, scannedFileCount },
  );
  const state = await requestCoreRpc("get_publication_export_state", {
    file_path: projectPath,
  });
  const cover = state?.cover_asset;
  const expectedKeys = [
    "id",
    "project_id",
    "kind",
    "media_type",
    "original_name",
    "sha256",
    "bytes_base64",
    "byte_length",
    "width",
    "height",
    "created_at",
    "updated_at",
  ];
  verify(hasExactKeys(cover, expectedKeys), "phase1g-cover-record-exact-keys");
  verify(
    Object.keys(cover).every((key) => !/path/iu.test(key)),
    "phase1g-cover-record-path-field",
  );
  const persistedBytes = Buffer.from(cover.bytes_base64, "base64");
  verify(
    cover.kind === "COVER" &&
      cover.media_type === "image/jpeg" &&
      cover.byte_length === expectedCoverBytes.length &&
      persistedBytes.equals(expectedCoverBytes) &&
      /^[a-f0-9]{64}$/u.test(cover.sha256) &&
      createHash("sha256").update(persistedBytes).digest("hex") === cover.sha256,
    "phase1g-cover-record-content",
  );
  return {
    sourceFilesDeleted: true,
    reopenedAfterSourceDeletion: true,
    scannedDatabaseSiblingFileCount: scannedFileCount,
    scannedExactPathEncodingCount: sourcePaths.length * 2,
    exactSourcePathOccurrenceCount,
    originalPathPersisted: exactSourcePathOccurrenceCount > 0,
    coverRecordExactKeys: true,
    coverRecordPathFieldAbsent: true,
    embeddedBytesMatched: true,
  };
}

async function validateActualRepresentativeWithEpubCheck(epubPath) {
  const beforeMetadata = await lstat(epubPath);
  verify(
    beforeMetadata.isFile() &&
      !beforeMetadata.isSymbolicLink() &&
      beforeMetadata.size > 0,
    "phase1g-actual-epubcheck-input",
  );
  const beforeHash = await sha256File(epubPath);
  const result = await new Promise((resolveResult, rejectResult) => {
    const child = spawn(process.execPath, [epubCheckValidationScript, "--actual-epub"], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        MADI_PHASE1G_ACTUAL_EPUB: epubPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderrLength = 0;
    let outputOverflow = false;
    let settled = false;
    let timeout;
    const finish = (value, error = undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (error) {
        rejectResult(error);
      } else {
        resolveResult(value);
      }
    };
    const terminateTree = () => {
      if (process.platform === "win32" && child.pid) {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          timeout: 8_000,
          windowsHide: true,
        });
      } else {
        child.kill();
      }
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length + chunk.length > 8 * 1024 * 1024) {
        outputOverflow = true;
        terminateTree();
        return;
      }
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderrLength += Buffer.byteLength(chunk);
    });
    child.once("error", () =>
      finish(undefined, new Error("phase1g-actual-epubcheck-spawn")),
    );
    child.once("close", (code, signal) =>
      finish({ code, signal, stdout, stderrLength, outputOverflow }),
    );
    timeout = setTimeout(() => {
      terminateTree();
      finish(undefined, new Error("phase1g-actual-epubcheck-timeout"));
    }, 300_000);
  });
  verify(
    result.code === 0 &&
      result.signal === null &&
      result.stderrLength === 0 &&
      !result.outputOverflow,
    "phase1g-actual-epubcheck-process",
    {
      exitCode: result.code,
      signalPresent: result.signal !== null,
      stderrLength: result.stderrLength,
      outputOverflow: result.outputOverflow,
    },
  );
  let raw;
  try {
    raw = JSON.parse(result.stdout);
  } catch {
    throw new Error("phase1g-actual-epubcheck-json");
  }
  verify(
    raw?.check === "phase1g-actual-madi-epubcheck" &&
      raw.status === "PASS" &&
      raw.validationScope === "ACTUAL_MADI_DERIVED_EPUB" &&
      raw.targetProfile === "EPUB_3_3_COMPATIBILITY" &&
      raw.automaticDownloads === 0 &&
      raw.externalRuntimeLookup === false &&
      raw.validator?.name === "EPUBCheck" &&
      raw.validator.version === "5.3.0" &&
      raw.validator.timeoutEnforced === true &&
      raw.validator.externalXmlAccess === "DISABLED" &&
      raw.input?.byteLength === beforeMetadata.size &&
      raw.input.stableDuringValidation === true &&
      raw.input.retainedArtifact === true &&
      raw.epubCheck?.status === "PASS" &&
      raw.epubCheck.version === "5.3.0" &&
      Number.isFinite(raw.epubCheck.elapsedMs) &&
      raw.epubCheck.elapsedMs >= 0 &&
      raw.epubCheck.fatalCount === 0 &&
      raw.epubCheck.errorCount === 0 &&
      safeInteger(raw.epubCheck.warningCount) !== null &&
      safeInteger(raw.epubCheck.infoCount) !== null &&
      safeInteger(raw.epubCheck.usageCount) !== null &&
      raw.supplyChain?.archiveHashVerifiedBeforeExtraction === true &&
      raw.supplyChain.freshTemporaryExtraction === true &&
      raw.supplyChain.deterministicFullTreeComparison === true &&
      raw.supplyChain.extractedSymlinksAllowed === false &&
      Array.isArray(raw.supplyChain.adversarialPreSpawnChecks) &&
      raw.supplyChain.adversarialPreSpawnChecks.length === 2 &&
      raw.privacy?.rawValidatorOutputPersisted === false &&
      raw.privacy.outputPathsReported === false &&
      raw.privacy.manuscriptReported === false,
    "phase1g-actual-epubcheck-contract",
  );
  const afterMetadata = await lstat(epubPath);
  const afterHash = await sha256File(epubPath);
  verify(
    afterMetadata.isFile() &&
      !afterMetadata.isSymbolicLink() &&
      afterMetadata.size === beforeMetadata.size &&
      afterHash === beforeHash,
    "phase1g-actual-epubcheck-artifact-link",
    {
      regularFile: afterMetadata.isFile(),
      symbolicLink: afterMetadata.isSymbolicLink(),
      byteLengthMatched: afterMetadata.size === beforeMetadata.size,
      hashMatched: afterHash === beforeHash,
    },
  );
  return {
    status: raw.epubCheck.status,
    name: raw.validator.name,
    version: raw.epubCheck.version,
    targetProfile: raw.targetProfile,
    elapsedMs: roundMilliseconds(raw.epubCheck.elapsedMs),
    fatalCount: raw.epubCheck.fatalCount,
    errorCount: raw.epubCheck.errorCount,
    warningCount: raw.epubCheck.warningCount,
    infoCount: raw.epubCheck.infoCount,
    usageCount: raw.epubCheck.usageCount,
    retainedArtifactByteLength: beforeMetadata.size,
    retainedArtifactStable: true,
    retainedArtifactHashMatched: true,
    automaticDownloads: raw.automaticDownloads,
    externalRuntimeLookup: raw.externalRuntimeLookup,
    externalXmlAccessDisabled: true,
    supplyChain: {
      archiveHashVerifiedBeforeExtraction: true,
      freshTemporaryExtraction: true,
      deterministicFullTreeComparison: true,
      extractedSymlinksAllowed: false,
      adversarialPreSpawnCheckCount:
        raw.supplyChain.adversarialPreSpawnChecks.length,
    },
    privacy: {
      rawValidatorOutputPersisted: false,
      outputPathsReported: false,
      manuscriptReported: false,
    },
  };
}

function sanitizeDiagnosticValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { type: "OTHER" };
  }
  const allowedTypes = new Set([
    "Error",
    "string",
    "null",
    "undefined",
    "boolean",
    "number",
    "bigint",
    "symbol",
    "function",
    "object",
  ]);
  return {
    type: allowedTypes.has(value.type) ? value.type : "OTHER",
    nameLength: safeInteger(value.nameLength),
    messageLength: safeInteger(value.messageLength),
    reactCode: safeInteger(value.reactCode, 10_000),
    resizeObserverLoop: value.resizeObserverLoop === true,
  };
}

function sanitizeRendererDiagnostic(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const allowedConsoleSources = new Set([
    "console.error",
    "console.warn",
    "console.log",
    "console.info",
    "console.debug",
    "console.trace",
    "console.table",
  ]);
  if (allowedConsoleSources.has(value.source)) {
    return {
      source: value.source,
      argumentCount: safeInteger(value.argumentCount),
      arguments: Array.isArray(value.arguments)
        ? value.arguments.slice(0, 8).map(sanitizeDiagnosticValue)
        : [],
    };
  }
  if (value.source === "window.error") {
    const allowedTags = new Set([
      "",
      "IMG",
      "LINK",
      "SCRIPT",
      "IFRAME",
      "VIDEO",
      "AUDIO",
      "OTHER",
    ]);
    return {
      source: "window.error",
      error: sanitizeDiagnosticValue(value.error),
      messageLength: safeInteger(value.messageLength),
      targetIsWindow: value.targetIsWindow === true,
      targetTag: allowedTags.has(value.targetTag) ? value.targetTag : "OTHER",
    };
  }
  return null;
}

function diagnosticContainsPrivateContent(text) {
  return privateContentFragments.some((fragment) => text.includes(fragment));
}

function isExpectedPlaywrightTransportLine(text) {
  const line = text.trim();
  return (
    /^Debugger listening on ws:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]+$/iu.test(line) ||
    /^Debugger ending on ws:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]+$/iu.test(line) ||
    /^DevTools listening on ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[0-9a-f-]+$/iu.test(
      line,
    ) ||
    line === "Debugger attached." ||
    line === "Waiting for the debugger to disconnect..." ||
    line === "For help, see: https://nodejs.org/en/docs/inspector"
  );
}

function createMainLifecycleCollector() {
  const counts = {
    beforeQuit: 0,
    willQuit: 0,
    willQuitPrevented: 0,
    quit: 0,
    windowAllClosed: 0,
  };
  const sequence = [];
  let resolveQuit;
  const quitObserved = new Promise((resolve) => {
    resolveQuit = resolve;
  });
  return {
    record(message) {
      let text;
      try {
        text = message.text();
      } catch {
        return;
      }
      const event = mainLifecycleEventsByMarker.get(text);
      if (!event) {
        return;
      }
      counts[event] += 1;
      sequence.push(event);
      if (event === "quit") {
        resolveQuit();
      }
    },
    evidence() {
      const quitIndex = sequence.lastIndexOf("quit");
      const finalWillQuitIndex = sequence.lastIndexOf("willQuit");
      return {
        ...counts,
        eventCount: sequence.length,
        finalWillQuitBeforeQuit:
          finalWillQuitIndex >= 0 && quitIndex > finalWillQuitIndex,
      };
    },
    async waitForQuit(timeoutMs) {
      let timeout;
      const observed = await Promise.race([
        quitObserved.then(() => true),
        new Promise((resolve) => {
          timeout = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
      clearTimeout(timeout);
      return observed;
    },
  };
}

function createProcessDiagnosticCollector() {
  const mainProcessDiagnostics = [];
  const childStderrDiagnostics = [];
  let expectedTransportLineCount = 0;
  let expectedLifecycleProbeLineCount = 0;
  let expectedLifecycleProbeMirrorLineCount = 0;
  let privateContentDetected = false;
  let rawPathOrUrlDetected = false;

  const record = (target, source, type, text) => {
    if (typeof text !== "string" || text.trim().length === 0) {
      return;
    }
    if (source === "child.stderr" && isExpectedPlaywrightTransportLine(text)) {
      expectedTransportLineCount += 1;
      return;
    }
    privateContentDetected ||= diagnosticContainsPrivateContent(text);
    rawPathOrUrlDetected ||= /[A-Za-z]:\\|file:\/\/|https?:\/\/|wss?:\/\//u.test(
      text,
    );
    if (target.length < 100) {
      const allowedTypes = new Set([
        "log",
        "debug",
        "info",
        "error",
        "warning",
        "warn",
        "dir",
        "trace",
        "startGroup",
        "startGroupCollapsed",
        "endGroup",
        "assert",
        "profile",
        "profileEnd",
        "OTHER",
      ]);
      target.push({
        source,
        type: allowedTypes.has(type) ? type : "OTHER",
        characterCount: text.length,
        lineCount: text.split(/\r?\n/u).length,
      });
    }
  };

  let stderrRemainder = "";
  return {
    recordMain(message) {
      let text = "";
      let type = "OTHER";
      try {
        text = message.text();
        type = message.type();
      } catch {
        text = "main-console-inspection-failed";
      }
      if (mainLifecycleEventsByMarker.has(text)) {
        expectedLifecycleProbeLineCount += 1;
        return;
      }
      record(mainProcessDiagnostics, "main.console", type, text);
    },
    recordMainProcessOutput(text) {
      if (mainLifecycleEventsByMarker.has(text)) {
        expectedLifecycleProbeMirrorLineCount += 1;
        return;
      }
      record(mainProcessDiagnostics, "main.stdout", "log", text);
    },
    recordStderr(chunk) {
      stderrRemainder += String(chunk);
      const lines = stderrRemainder.split(/\r?\n/u);
      stderrRemainder = lines.pop() ?? "";
      for (const line of lines) {
        record(childStderrDiagnostics, "child.stderr", "error", line);
      }
    },
    evidence() {
      if (stderrRemainder.length > 0) {
        record(
          childStderrDiagnostics,
          "child.stderr",
          "error",
          stderrRemainder,
        );
        stderrRemainder = "";
      }
      return {
        mainProcessDiagnostics: [...mainProcessDiagnostics],
        childStderrDiagnostics: [...childStderrDiagnostics],
        childStderrCaptureMode: "PRELAUNCH_CHILD_PROCESS_STREAM_TAP",
        unexpectedDiagnosticCount:
          mainProcessDiagnostics.length + childStderrDiagnostics.length,
        expectedHarnessTransportLineCount: expectedTransportLineCount,
        expectedHarnessLifecycleProbeLineCount: expectedLifecycleProbeLineCount,
        expectedHarnessLifecycleProbeMirrorLineCount:
          expectedLifecycleProbeMirrorLineCount,
        privateContentDetected,
        rawPathOrUrlDetected,
      };
    },
  };
}

function processDiagnosticDelta(current, baseline) {
  return {
    unexpectedDiagnosticCount:
      current.unexpectedDiagnosticCount - baseline.unexpectedDiagnosticCount,
    mainProcessDiagnosticCount:
      current.mainProcessDiagnostics.length - baseline.mainProcessDiagnostics.length,
    childStderrDiagnosticCount:
      current.childStderrDiagnostics.length - baseline.childStderrDiagnostics.length,
    expectedHarnessTransportLineCount:
      current.expectedHarnessTransportLineCount -
      baseline.expectedHarnessTransportLineCount,
    expectedHarnessLifecycleProbeLineCount:
      current.expectedHarnessLifecycleProbeLineCount -
      baseline.expectedHarnessLifecycleProbeLineCount,
    expectedHarnessLifecycleProbeMirrorLineCount:
      current.expectedHarnessLifecycleProbeMirrorLineCount -
      baseline.expectedHarnessLifecycleProbeMirrorLineCount,
    privateContentDetected:
      current.privateContentDetected && !baseline.privateContentDetected,
    rawPathOrUrlDetected:
      current.rawPathOrUrlDetected && !baseline.rawPathOrUrlDetected,
  };
}

function assertProcessDiagnosticDelta(delta, code) {
  verify(
    delta.unexpectedDiagnosticCount >= 0 &&
      delta.mainProcessDiagnosticCount >= 0 &&
      delta.childStderrDiagnosticCount >= 0 &&
      delta.expectedHarnessTransportLineCount >= 0 &&
      delta.expectedHarnessLifecycleProbeLineCount >= 0 &&
      delta.expectedHarnessLifecycleProbeMirrorLineCount >= 0 &&
      delta.unexpectedDiagnosticCount ===
        delta.mainProcessDiagnosticCount + delta.childStderrDiagnosticCount,
    code,
    delta,
  );
}

async function launchElectronWithProcessCapture(options, processDiagnostics) {
  const originalSpawn = childProcessModule.spawn;
  let capturedLaunchCount = 0;
  childProcessModule.spawn = function phase1gCapturedSpawn(
    command,
    arguments_,
    spawnOptions,
  ) {
    const child = Reflect.apply(originalSpawn, this, [
      command,
      arguments_,
      spawnOptions,
    ]);
    const argumentsList = Array.isArray(arguments_) ? arguments_ : [];
    const isElectronLaunch =
      capturedLaunchCount === 0 &&
      argumentsList.some((argument) =>
        String(argument).includes("--remote-debugging-port=0"),
      ) &&
      argumentsList.some((argument) => String(argument).includes("--inspect=0"));
    if (!isElectronLaunch) {
      return child;
    }
    capturedLaunchCount += 1;
    let stdoutRemainder = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdoutRemainder += chunk;
      const lines = stdoutRemainder.split(/\r?\n/u);
      stdoutRemainder = lines.pop() ?? "";
      for (const line of lines) {
        processDiagnostics.recordMainProcessOutput(line);
      }
    });
    child.stdout?.on("end", () => {
      if (stdoutRemainder.length > 0) {
        processDiagnostics.recordMainProcessOutput(stdoutRemainder);
        stdoutRemainder = "";
      }
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => processDiagnostics.recordStderr(chunk));
    return child;
  };
  try {
    const application = await electron.launch(options);
    verify(capturedLaunchCount === 1, "phase1g-child-process-stream-tap", {
      capturedLaunchCount,
    });
    return application;
  } finally {
    childProcessModule.spawn = originalSpawn;
  }
}

const relevantProcessRoles = new Map([
  ["electron", "ELECTRON"],
  ["madi", "ELECTRON"],
  ["madi-core", "CORE"],
  ["madi-export-epub", "EXPORTER"],
]);

function processRole(processName) {
  const normalized = String(processName).toLocaleLowerCase().replace(/\.exe$/u, "");
  return relevantProcessRoles.get(normalized) ?? null;
}

function powershellProcessFilter() {
  return ["electron.exe", "madi.exe", "madi-core.exe", "madi-export-epub.exe"]
    .map((name) => `Name='${name}'`)
    .join(" OR ");
}

function captureRelevantProcessSnapshot() {
  verify(process.platform === "win32", "phase1g-process-proof-platform");
  const command = [
    `$phase1gFilter = \"${powershellProcessFilter()}\"`,
    "$phase1gRows = @(Get-CimInstance Win32_Process -Filter $phase1gFilter -ErrorAction Stop | ForEach-Object { [PSCustomObject]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; name = [string]$_.Name } })",
    "ConvertTo-Json -InputObject $phase1gRows -Compress",
  ].join("; ");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      timeout: 15_000,
      windowsHide: true,
    },
  );
  verify(
    !result.error && result.status === 0 && result.signal === null,
    "phase1g-process-snapshot-failed",
    {
      status: result.status,
      signalPresent: result.signal !== null,
      stderrLength: result.stderr?.length ?? 0,
    },
  );
  const parsed = JSON.parse(result.stdout || "[]");
  return (Array.isArray(parsed) ? parsed : [parsed]).flatMap((row) => {
    const pid = safeInteger(row?.pid, 0xffff_ffff);
    const ppid = safeInteger(row?.ppid, 0xffff_ffff);
    const role = processRole(row?.name);
    return pid !== null && pid > 0 && ppid !== null && role
      ? [{ pid, ppid, role }]
      : [];
  });
}

function captureAliveProcessIds(processIds) {
  if (processIds.length === 0) {
    return [];
  }
  const ids = [...new Set(processIds)].filter(
    (pid) => Number.isSafeInteger(pid) && pid > 0 && pid <= 0xffff_ffff,
  );
  const command = [
    `$phase1gIds = @(${ids.join(",")})`,
    "$phase1gAlive = @($phase1gIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })",
    "ConvertTo-Json -InputObject $phase1gAlive -Compress",
  ].join("; ");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 15_000,
      windowsHide: true,
    },
  );
  verify(
    !result.error && result.status === 0 && result.signal === null,
    "phase1g-process-exact-pid-query-failed",
    {
      status: result.status,
      signalPresent: result.signal !== null,
      stderrLength: result.stderr?.length ?? 0,
    },
  );
  const parsed = JSON.parse(result.stdout || "[]");
  return (Array.isArray(parsed) ? parsed : [parsed]).filter(
    (pid) => Number.isSafeInteger(pid) && pid > 0,
  );
}

async function startRelevantProcessMonitor() {
  const baseline = captureRelevantProcessSnapshot();
  const baselineIds = new Set(baseline.map((entry) => entry.pid));
  const observations = new Map();
  const command = [
    `$phase1gFilter = \"${powershellProcessFilter()}\"`,
    "while ($true) { $phase1gRows = @(Get-CimInstance Win32_Process -Filter $phase1gFilter -ErrorAction Stop); foreach ($phase1gRow in $phase1gRows) { Write-Output (\"{0}|{1}|{2}\" -f $phase1gRow.ProcessId, $phase1gRow.ParentProcessId, $phase1gRow.Name) }; Write-Output '__MADI_PHASE1G_PROCESS_SAMPLE__'; Start-Sleep -Milliseconds 200 }",
  ].join("; ");
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  let stdoutRemainder = "";
  let stderrLength = 0;
  let sampleCount = 0;
  let distinctProcessCount = 0;
  let rootPid = null;
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolveReady, rejectReady) => {
    readyResolve = resolveReady;
    readyReject = rejectReady;
  });
  const readyTimer = setTimeout(
    () => readyReject(new Error("phase1g-process-monitor-ready-timeout")),
    15_000,
  );
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutRemainder += chunk;
    const lines = stdoutRemainder.split(/\r?\n/u);
    stdoutRemainder = lines.pop() ?? "";
    for (const line of lines) {
      if (line === "__MADI_PHASE1G_PROCESS_SAMPLE__") {
        sampleCount += 1;
        if (sampleCount === 1) {
          clearTimeout(readyTimer);
          readyResolve();
        }
        continue;
      }
      const [pidText, ppidText, name] = line.split("|", 3);
      const pid = Number(pidText);
      const ppid = Number(ppidText);
      const role = processRole(name);
      if (
        Number.isSafeInteger(pid) &&
        pid > 0 &&
        Number.isSafeInteger(ppid) &&
        role
      ) {
        if (!observations.has(pid)) {
          distinctProcessCount += 1;
        }
        observations.set(pid, {
          pid,
          ppid,
          role: pid === rootPid ? "ROOT" : role,
        });
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    stderrLength += Buffer.byteLength(chunk);
  });
  child.once("error", () => {
    clearTimeout(readyTimer);
    readyReject(new Error("phase1g-process-monitor-spawn-failed"));
  });
  child.once("exit", () => {
    if (sampleCount === 0) {
      clearTimeout(readyTimer);
      readyReject(new Error("phase1g-process-monitor-early-exit"));
    }
  });
  await ready;
  let stopped = false;
  return {
    baseline,
    baselineIds,
    observations,
    recordObservedChildren(children) {
      for (const child of children) {
        if (!observations.has(child.pid)) {
          distinctProcessCount += 1;
        }
        observations.set(child.pid, child);
      }
    },
    recordRoot(pid) {
      rootPid = pid;
      observations.set(pid, { pid, ppid: 0, role: "ROOT" });
    },
    async stop() {
      if (!stopped) {
        stopped = true;
        child.kill();
        verify(
          await waitForChildExit(child, 8_000),
          "phase1g-process-monitor-stop-timeout",
        );
      }
      verify(sampleCount > 0 && stderrLength === 0, "phase1g-process-monitor-health", {
        sampleCount,
        stderrLength,
      });
      return { sampleCount, distinctProcessCount };
    },
  };
}

function roleCounts(processes) {
  const counts = { root: 0, electron: 0, core: 0, exporter: 0 };
  for (const process of processes) {
    if (process.role === "ROOT") counts.root += 1;
    if (process.role === "ELECTRON") counts.electron += 1;
    if (process.role === "CORE") counts.core += 1;
    if (process.role === "EXPORTER") counts.exporter += 1;
  }
  return counts;
}

function capturedDescendants(processes, rootPid) {
  const descendantIds = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes) {
      if (!descendantIds.has(process.pid) && descendantIds.has(process.ppid)) {
        descendantIds.add(process.pid);
        changed = true;
      }
    }
  }
  return processes.filter(
    (process) => process.pid !== rootPid && descendantIds.has(process.pid),
  );
}

async function assertNoOrphanProcesses(
  processMonitor,
  mainProcessPid,
  launcherProcessPid,
) {
  const monitorHealth = await processMonitor.stop();
  const capturedNew = [...processMonitor.observations.values()].filter(
    (entry) => entry.role === "ROOT" || !processMonitor.baselineIds.has(entry.pid),
  );
  const observed = roleCounts(capturedNew);
  const descendantProcesses = capturedDescendants(capturedNew, mainProcessPid);
  const observedDescendants = roleCounts(descendantProcesses);
  verify(
    observed.root === 1 &&
      observedDescendants.electron > 0 &&
      observedDescendants.core > 0 &&
      observedDescendants.exporter > 0,
    "phase1g-process-role-observation",
    { observed, observedDescendants },
  );
  const capturedPids = [
    ...new Set([
      launcherProcessPid,
      mainProcessPid,
      ...descendantProcesses.map((entry) => entry.pid),
    ]),
  ];
  const proof = await poll(
    async () => {
      const current = captureRelevantProcessSnapshot();
      const newGlobalRelevant = current.filter(
        (entry) => !processMonitor.baselineIds.has(entry.pid),
      );
      const exactAlive = captureAliveProcessIds(capturedPids);
      const currentIds = new Set(current.map((entry) => entry.pid));
      const liveTreeDescendantIds = new Set(
        capturedDescendants([...capturedNew, ...current], mainProcessPid)
          .filter((entry) => currentIds.has(entry.pid))
          .map((entry) => entry.pid),
      );
      return exactAlive.length === 0 && liveTreeDescendantIds.size === 0
        ? { current, newGlobalRelevant, exactAlive, liveTreeDescendantIds }
        : null;
    },
    "phase1g-process-orphan-exit",
    PROCESS_EXIT_TIMEOUT_MS,
  );
  return {
    baseline: roleCounts(processMonitor.baseline),
    observed,
    observedDescendants,
    captureMode: "MAIN_PROCESS_SPAWN_TAP_AND_WIN32_SNAPSHOT",
    monitorSampleCount: monitorHealth.sampleCount,
    distinctObservedProcessCount: monitorHealth.distinctProcessCount,
    exactCapturedProcessCount: capturedPids.length,
    exactCapturedProcessesExited: proof.exactAlive.length === 0,
    capturedDescendantProcessesAfterClose:
      proof.exactAlive.length + proof.liveTreeDescendantIds.size,
    unrelatedOrConcurrentGlobalRelevantProcessCountAfterClose:
      proof.newGlobalRelevant.length,
  };
}

async function installMainChildProcessObserver(application) {
  const status = await application.evaluate(() => {
    const observerKey = "__madiPhase1gMainChildProcessObserver";
    if (Reflect.has(globalThis, observerKey)) {
      return { installed: false, processId: process.pid };
    }
    const childProcess = process.getBuiltinModule?.("node:child_process");
    if (!childProcess || typeof childProcess.spawn !== "function") {
      throw new Error("phase1g-main-child-process-module-unavailable");
    }
    const originalSpawn = childProcess.spawn;
    const records = new Map();
    const wrapper = function phase1gObservedMainSpawn(...args) {
      const child = Reflect.apply(originalSpawn, this, args);
      const commandName = String(args[0] ?? "")
        .split(/[\\/]/u)
        .at(-1)
        ?.toLocaleLowerCase()
        .replace(/\.exe$/u, "");
      const role =
        commandName === "madi-core"
          ? "CORE"
          : commandName === "madi-export-epub"
            ? "EXPORTER"
            : null;
      if (role) {
        const record = () => {
          if (Number.isSafeInteger(child.pid) && child.pid > 0) {
            records.set(`${role}:${child.pid}`, {
              pid: child.pid,
              ppid: process.pid,
              role,
            });
          }
        };
        record();
        child.once("spawn", record);
      }
      return child;
    };
    childProcess.spawn = wrapper;
    Reflect.set(globalThis, observerKey, {
      childProcess,
      originalSpawn,
      records,
      wrapper,
    });
    return {
      installed: childProcess.spawn === wrapper,
      processId: process.pid,
    };
  });
  verify(
    status.installed === true &&
      Number.isSafeInteger(status.processId) &&
      status.processId > 0,
    "phase1g-main-child-process-observer-install",
  );
  return status.processId;
}

async function collectMainChildProcessObservations(run) {
  const result = await run.application.evaluate(() => {
    const observerKey = "__madiPhase1gMainChildProcessObserver";
    const observer = Reflect.get(globalThis, observerKey);
    if (!observer) {
      return { installed: false, processId: process.pid, records: [] };
    }
    const stillInstalled = observer.childProcess.spawn === observer.wrapper;
    observer.childProcess.spawn = observer.originalSpawn;
    Reflect.deleteProperty(globalThis, observerKey);
    return {
      installed: stillInstalled,
      processId: process.pid,
      records: [...observer.records.values()],
    };
  });
  verify(
    result.installed === true &&
      result.processId === run.mainProcessPid &&
      Array.isArray(result.records),
    "phase1g-main-child-process-observer-collect",
  );
  const records = result.records.map((record) => {
    verify(
      Object.keys(record).sort().join(",") === "pid,ppid,role" &&
        Number.isSafeInteger(record.pid) &&
        record.pid > 0 &&
        record.ppid === result.processId &&
        ["CORE", "EXPORTER"].includes(record.role),
      "phase1g-main-child-process-observation-shape",
    );
    return record;
  });
  run.processMonitor.recordObservedChildren(records);
}

async function installMainLifecycleConsoleProbe(application) {
  const status = await application.evaluate(({ app }) => {
    const probeKey = "__madiPhase1gMainLifecycleConsoleProbe";
    if (Reflect.has(globalThis, probeKey)) {
      return { installed: false };
    }
    app.on("before-quit", () => {
      console.log("[madi-phase1g-main] before-quit");
    });
    app.on("will-quit", (event) => {
      console.log(
        event.defaultPrevented
          ? "[madi-phase1g-main] will-quit-prevented"
          : "[madi-phase1g-main] will-quit",
      );
    });
    app.on("quit", () => {
      console.log("[madi-phase1g-main] quit");
    });
    app.on("window-all-closed", () => {
      console.log("[madi-phase1g-main] window-all-closed");
    });
    Reflect.set(globalThis, probeKey, true);
    return { installed: true };
  });
  verify(
    Object.keys(status).join(",") === "installed" && status.installed === true,
    "phase1g-main-lifecycle-observer-install",
  );
}

async function launchApplication({ projectPath, userDataPath, dialogPlan }) {
  const processMonitor = await startRelevantProcessMonitor();
  const processDiagnostics = createProcessDiagnosticCollector();
  let application;
  let launcherProcessPid;
  let mainProcessPid;
  try {
    application = await launchElectronWithProcessCapture({
      executablePath: electronExecutable,
      args: packaged
        ? [`--user-data-dir=${userDataPath}`]
        : [".", `--user-data-dir=${userDataPath}`],
      cwd: packaged ? dirname(electronExecutable) : desktopDirectory,
      env: {
        ...process.env,
        ...(packaged
          ? {}
          : {
              MADI_CORE_BIN: coreBinary,
              MADI_EPUB_EXPORT_BIN: epubExporterBinary,
            }),
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      },
      timeout: 30_000,
    }, processDiagnostics);
    launcherProcessPid = application.process().pid;
    verify(
      Number.isSafeInteger(launcherProcessPid) && launcherProcessPid > 0,
      "phase1g-application-launcher-pid",
    );
    mainProcessPid = await installMainChildProcessObserver(application);
    await installMainLifecycleConsoleProbe(application);
    processMonitor.recordRoot(mainProcessPid);
  } catch (error) {
    await processMonitor.stop().catch(() => undefined);
    const message = error instanceof Error ? error.message.toLocaleLowerCase() : "";
    lastFailureContext = {
      rendererAvailable: false,
      launch: {
        ...summarizeError(error),
        processFailedToLaunch: message.includes("process failed to launch"),
        targetClosed: message.includes("target page, context or browser has been closed"),
        spawnFailure: message.includes("spawn"),
        executableMissing: message.includes("enoent"),
        accessDenied: message.includes("eperm") || message.includes("access is denied"),
        timeout: message.includes("timeout"),
        crashed: message.includes("crash"),
      },
    };
    throw error;
  }
  try {
    const requestedUrls = [];
    const websocketUrls = [];
    const pageErrors = [];
    const rendererDiagnostics = [];
    const diagnosticIndexes = new Map();
    const mainLifecycle = createMainLifecycleCollector();
    application.on("console", (message) => {
      mainLifecycle.record(message);
      processDiagnostics.recordMain(message);
    });
    const applicationProcess = application.process();
    verify(applicationProcess.stderr, "phase1g-child-stderr-unavailable");
    application.context().on("request", (request) => requestedUrls.push(request.url()));
    await application.evaluate(
      ({ dialog, shell }, plan) => {
        const state = {
          projectPath: plan.projectPath,
          coverPaths: [...plan.coverPaths],
          epubPaths: [...plan.epubPaths],
          jsonReportPaths: [...plan.jsonReportPaths],
          markdownReportPaths: [...plan.markdownReportPaths],
          calls: {
            projectOpen: 0,
            coverOpen: 0,
            epubSave: 0,
            jsonReportSave: 0,
            markdownReportSave: 0,
            reveal: 0,
            epubOverwriteConfirmationConfigured: 0,
            reportOverwriteConfirmationConfigured: 0,
          },
        };
        Reflect.set(globalThis, "__madiPhase1gDialogState", state);
        dialog.showOpenDialog = async (_window, options) => {
          if (options.title === "madi 프로젝트 열기") {
            state.calls.projectOpen += 1;
            return { canceled: false, filePaths: [state.projectPath] };
          }
          if (options.title === "EPUB 표지 선택") {
            state.calls.coverOpen += 1;
            const selected = state.coverPaths.shift();
            return selected
              ? { canceled: false, filePaths: [selected] }
              : { canceled: true, filePaths: [] };
          }
          return { canceled: true, filePaths: [] };
        };
        dialog.showSaveDialog = async (_window, options) => {
          if (options.title === "EPUB 내보내기") {
            state.calls.epubSave += 1;
            if (options.properties?.includes("showOverwriteConfirmation")) {
              state.calls.epubOverwriteConfirmationConfigured += 1;
            }
            const selected = state.epubPaths.shift();
            return selected
              ? { canceled: false, filePath: selected }
              : { canceled: true };
          }
          if (options.title === "EPUB export report 저장") {
            if (options.properties?.includes("showOverwriteConfirmation")) {
              state.calls.reportOverwriteConfirmationConfigured += 1;
            }
            const extension = options.filters?.[0]?.extensions?.[0];
            if (extension === "json") {
              state.calls.jsonReportSave += 1;
              const selected = state.jsonReportPaths.shift();
              return selected
                ? { canceled: false, filePath: selected }
                : { canceled: true };
            }
            if (extension === "md") {
              state.calls.markdownReportSave += 1;
              const selected = state.markdownReportPaths.shift();
              return selected
                ? { canceled: false, filePath: selected }
                : { canceled: true };
            }
          }
          return { canceled: true };
        };
        shell.showItemInFolder = () => {
          state.calls.reveal += 1;
        };
      },
      {
        ...dialogPlan,
        projectPath,
      },
    );
    const page = await application.firstWindow({ timeout: 30_000 });
    page.on("websocket", (socket) => websocketUrls.push(socket.url()));
    page.on("pageerror", (error) => {
      const reactCode = error.message.match(/Minified React error #(\d+)/u)?.[1];
      const allowedNames = new Set([
        "Error",
        "TypeError",
        "RangeError",
        "ReferenceError",
        "SyntaxError",
        "URIError",
        "EvalError",
        "AggregateError",
      ]);
      pageErrors.push({
        name: allowedNames.has(error.name) ? error.name : "OtherError",
        nameLength: error.name.length,
        messageLength: error.message.length,
        reactCode: reactCode ? Number(reactCode) : null,
        maximumUpdateDepth: error.message.includes("Maximum update depth exceeded"),
        tooManyRerenders: error.message.includes("Too many re-renders"),
      });
    });
    await page.exposeBinding("__madiPhase1gDiagnostic", (_source, diagnostic) => {
      const sanitized = sanitizeRendererDiagnostic(diagnostic);
      if (!sanitized) {
        return;
      }
      const key = JSON.stringify(sanitized);
      const index = diagnosticIndexes.get(key);
      if (index !== undefined) {
        rendererDiagnostics[index] = {
          ...rendererDiagnostics[index],
          occurrences: rendererDiagnostics[index].occurrences + 1,
        };
      } else if (rendererDiagnostics.length < 100) {
        diagnosticIndexes.set(key, rendererDiagnostics.length);
        rendererDiagnostics.push({ ...sanitized, occurrences: 1 });
      }
    });
    await page.addInitScript(() => {
      const summarize = (value) => {
        if (value instanceof Error) {
          return {
            type: "Error",
            nameLength: value.name.length,
            messageLength: value.message.length,
            reactCode:
              Number(value.message.match(/Minified React error #(\d+)/u)?.[1] ?? 0) ||
              null,
            resizeObserverLoop:
              value.message ===
              "ResizeObserver loop completed with undelivered notifications.",
          };
        }
        if (typeof value === "string") {
          return {
            type: "string",
            messageLength: value.length,
            reactCode:
              Number(value.match(/Minified React error #(\d+)/u)?.[1] ?? 0) || null,
            resizeObserverLoop:
              value === "ResizeObserver loop completed with undelivered notifications.",
          };
        }
        return { type: value === null ? "null" : typeof value };
      };
      const report = (diagnostic) => {
        const binding = Reflect.get(globalThis, "__madiPhase1gDiagnostic");
        if (typeof binding === "function") {
          void binding(diagnostic).catch(() => undefined);
        }
      };
      for (const method of [
        "error",
        "warn",
        "log",
        "info",
        "debug",
        "trace",
        "table",
      ]) {
        console[method] = (...args) => {
          report({
            source: `console.${method}`,
            argumentCount: args.length,
            arguments: args.slice(0, 8).map(summarize),
          });
        };
      }
      window.addEventListener(
        "error",
        (event) => {
          const target = event.target instanceof Element ? event.target : null;
          const tag = target?.tagName ?? "";
          const allowedTags = new Set([
            "IMG",
            "LINK",
            "SCRIPT",
            "IFRAME",
            "VIDEO",
            "AUDIO",
          ]);
          report({
            source: "window.error",
            error: summarize(event.error),
            messageLength: event.message.length,
            targetIsWindow: event.target === window,
            targetTag: allowedTags.has(tag) ? tag : tag ? "OTHER" : "",
          });
        },
        { capture: true },
      );
    });
    await page.context().setOffline(true);
    await page.reload({ waitUntil: "load" });
    await page.locator(".engine-pill--ready").waitFor({ timeout: 30_000 });
    const appRuntime = await application.evaluate(({ app }) => ({
      isPackaged: app.isPackaged,
      appNameLength: app.getName().length,
    }));
    const runtime = {
      ...appRuntime,
      rendererProtocol: await page.evaluate(() => window.location.protocol),
      packagedOverrideCanary:
        packaged && process.env.MADI_PHASE1G_PACKAGED_OVERRIDE_CANARY === "1",
    };
    const localFileProbeUrl = pathToFileURL(resolve(repositoryRoot, "package.json")).toString();
    const localFileProbe = await page.evaluate(async (url) => {
      try {
        const response = await fetch(url);
        return { readable: response.ok, status: response.status };
      } catch {
        return { readable: false, status: 0 };
      }
    }, localFileProbeUrl);
    return {
      application,
      page,
      requestedUrls,
      websocketUrls,
      pageErrors,
      rendererDiagnostics,
      processDiagnostics,
      mainLifecycle,
      processMonitor,
      launcherProcessPid,
      mainProcessPid,
      localFileProbeUrl,
      localFileProbe,
      runtime,
      lastActionability: null,
      productProcessDiagnostics: null,
      testTransportWrapperCleanupDiagnostics: null,
      closed: false,
    };
  } catch (error) {
    await forceCloseApplication(application, processMonitor).catch(() => undefined);
    throw error;
  }
}

async function waitForChildExit(childProcess, timeoutMs) {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
    return true;
  }
  return new Promise((resolveExit) => {
    const finish = (exited) => {
      clearTimeout(timer);
      childProcess.off("exit", onExit);
      resolveExit(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    childProcess.once("exit", onExit);
  });
}

async function forceCloseApplication(application, processMonitor = undefined) {
  try {
    if (!application) {
      return;
    }
    let childProcess;
    try {
      childProcess = application.process();
    } catch {
      return;
    }
    if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
      return;
    }
    if (process.platform === "win32" && childProcess.pid) {
      spawnSync("taskkill", ["/PID", String(childProcess.pid), "/T", "/F"], {
        stdio: "ignore",
        timeout: 8_000,
        windowsHide: true,
      });
    } else {
      childProcess.kill();
    }
    verify(
      await waitForChildExit(childProcess, 8_000),
      "phase1g-force-close-timeout",
    );
  } finally {
    await processMonitor?.stop().catch(() => undefined);
  }
}

async function closeWindowCleanly(run) {
  const childProcess = run.application.process();
  verify(
    childProcess.pid === run.launcherProcessPid,
    "phase1g-application-launcher-identity",
  );
  await collectMainChildProcessObservations(run);
  // Seal only the product process streams before initiating close. Network,
  // page, and renderer collections remain live through the close lifecycle.
  const productProcessDiagnostics = run.processDiagnostics.evidence();
  run.productProcessDiagnostics = productProcessDiagnostics;
  assertSecurity(securityEvidence(run));
  const windowClosed = run.page.waitForEvent("close", {
    timeout: WINDOW_CLOSE_TIMEOUT_MS,
  });
  await run.application.evaluate(({ BrowserWindow }) => {
    setTimeout(() => BrowserWindow.getAllWindows()[0]?.close(), 100);
  });
  await windowClosed;
  run.closeAttemptEvidence = {
    productWindowClosed: true,
    productQuitObserved: false,
    productGracefulQuit: false,
    productLifecycle: run.mainLifecycle.evidence(),
    testTransportWrapperCleanupRequired: false,
    testTransportWrapperCleanupCompleted: false,
  };
  const productQuitObserved = await run.mainLifecycle.waitForQuit(
    PROCESS_EXIT_TIMEOUT_MS,
  );
  const productLifecycle = run.mainLifecycle.evidence();
  run.closeAttemptEvidence = {
    productWindowClosed: true,
    productQuitObserved,
    productGracefulQuit: false,
    productLifecycle,
    testTransportWrapperCleanupRequired: false,
    testTransportWrapperCleanupCompleted: false,
  };
  verify(productQuitObserved, "phase1g-product-lifecycle-quit");
  verify(
    productLifecycle.beforeQuit >= 1 &&
      productLifecycle.willQuit >= 1 &&
      productLifecycle.quit === 1 &&
      (productLifecycle.windowAllClosed === 0 ||
        productLifecycle.windowAllClosed === 1) &&
      productLifecycle.finalWillQuitBeforeQuit,
    "phase1g-product-lifecycle-contract",
    {
      beforeQuitCount: productLifecycle.beforeQuit,
      willQuitCount: productLifecycle.willQuit,
      preventedWillQuitCount: productLifecycle.willQuitPrevented,
      quitCount: productLifecycle.quit,
      windowAllClosedCount: productLifecycle.windowAllClosed,
      finalWillQuitBeforeQuit: productLifecycle.finalWillQuitBeforeQuit,
    },
  );
  const postProductQuitProcessDiagnostics = run.processDiagnostics.evidence();
  const productCloseToQuitProcessDiagnostics = processDiagnosticDelta(
    postProductQuitProcessDiagnostics,
    productProcessDiagnostics,
  );
  assertProcessDiagnosticDelta(
    productCloseToQuitProcessDiagnostics,
    "phase1g-product-close-to-quit-process-diagnostic-delta",
  );
  verify(
    !postProductQuitProcessDiagnostics.privateContentDetected,
    "phase1g-product-quit-process-diagnostic-privacy",
    {
      privateContentDetected:
        postProductQuitProcessDiagnostics.privateContentDetected,
    },
  );
  run.closeAttemptEvidence = {
    productWindowClosed: true,
    productQuitObserved: true,
    productGracefulQuit: true,
    productLifecycle,
    testTransportWrapperCleanupRequired: true,
    testTransportWrapperCleanupCompleted: false,
    productCloseToQuitProcessDiagnostics,
    testTransportWrapperCleanupDiagnostics: null,
  };
  // Playwright 1.54 launches Windows Electron through an inspector-enabled
  // wrapper. The product has already emitted its ordered quit lifecycle, so
  // clean up only that test transport tree while process monitoring remains on.
  await forceCloseApplication(run.application);
  const postCleanupProcessDiagnostics = run.processDiagnostics.evidence();
  const testTransportWrapperCleanupDiagnostics = processDiagnosticDelta(
    postCleanupProcessDiagnostics,
    postProductQuitProcessDiagnostics,
  );
  assertProcessDiagnosticDelta(
    testTransportWrapperCleanupDiagnostics,
    "phase1g-test-transport-wrapper-cleanup-diagnostic-delta",
  );
  verify(
    !postCleanupProcessDiagnostics.privateContentDetected,
    "phase1g-test-transport-wrapper-cleanup-private-content",
    {
      privateContentDetected: postCleanupProcessDiagnostics.privateContentDetected,
    },
  );
  run.testTransportWrapperCleanupDiagnostics =
    testTransportWrapperCleanupDiagnostics;
  run.closeAttemptEvidence = {
    productWindowClosed: true,
    productQuitObserved: true,
    productGracefulQuit: true,
    productLifecycle,
    testTransportWrapperCleanupRequired: true,
    testTransportWrapperCleanupCompleted: true,
    productCloseToQuitProcessDiagnostics,
    testTransportWrapperCleanupDiagnostics,
  };
  const processTracking = await assertNoOrphanProcesses(
    run.processMonitor,
    run.mainProcessPid,
    run.launcherProcessPid,
  );
  run.closed = true;
  return {
    productGracefulQuit: true,
    productLifecycle,
    testTransportWrapperCleanupRequired: true,
    testTransportWrapperCleanupCompleted: true,
    productCloseToQuitProcessDiagnostics,
    testTransportWrapperCleanupDiagnostics,
    processTracking,
  };
}

async function sampleApplicationMemory(application) {
  const rootPid = application.process().pid;
  if (process.platform !== "win32" || !Number.isSafeInteger(rootPid)) {
    return { available: false };
  }
  const command = [
    `$phase1gRootPid = ${rootPid}`,
    "$phase1gProcesses = Get-CimInstance Win32_Process",
    "$phase1gIds = @($phase1gRootPid)",
    "do { $phase1gPrevious = $phase1gIds.Count; $phase1gIds += @($phase1gProcesses | Where-Object { $phase1gIds -contains $_.ParentProcessId } | ForEach-Object ProcessId); $phase1gIds = @($phase1gIds | Sort-Object -Unique) } while ($phase1gIds.Count -ne $phase1gPrevious)",
    "$phase1gRows = @($phase1gProcesses | Where-Object { $phase1gIds -contains $_.ProcessId } | ForEach-Object { $phase1gProcess = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if ($phase1gProcess) { [PSCustomObject]@{ working = [double]$phase1gProcess.WorkingSet64; private = [double]$phase1gProcess.PrivateMemorySize64 } } })",
    "$phase1gRows | ConvertTo-Json -Compress",
  ].join("; ");
  const sampled = await new Promise((resolveSample) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
    );
    let stdout = "";
    let settled = false;
    let timeout;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolveSample(result);
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 1024 * 1024) {
        stdout += chunk;
      }
    });
    child.once("error", () => finish({ status: null, stdout: "" }));
    child.once("exit", (code) => finish({ status: code, stdout }));
    timeout = setTimeout(() => {
      child.kill();
      finish({ status: null, stdout: "" });
    }, 8_000);
  });
  if (sampled.status !== 0 || !sampled.stdout.trim()) {
    return { available: false };
  }
  try {
    const parsed = JSON.parse(sampled.stdout);
    const rows = (Array.isArray(parsed) ? parsed : [parsed]).filter(
      (row) => row && Number.isFinite(row.working) && Number.isFinite(row.private),
    );
    return {
      available: true,
      processCount: rows.length,
      workingSetBytes: Math.round(rows.reduce((sum, row) => sum + row.working, 0)),
      privateBytes: Math.round(rows.reduce((sum, row) => sum + row.private, 0)),
    };
  } catch {
    return { available: false };
  }
}

function securityEvidence(run) {
  const externalUrls = run.requestedUrls.filter(
    (url) => url !== run.localFileProbeUrl && !isLocalRuntimeUrl(url),
  );
  const externalWebSockets = run.websocketUrls.filter(
    (url) => !isAllowedRuntimeWebSocket(url, run.page.url()),
  );
  const processDiagnostics = run.productProcessDiagnostics;
  verify(processDiagnostics !== null, "phase1g-product-process-diagnostics-unsealed");
  return {
    runtime: run.runtime,
    requestCount: run.requestedUrls.length,
    externalRequestCount: externalUrls.length,
    externalRequests: externalUrls.map(redactExternalUrl),
    externalWebSocketCount: externalWebSockets.length,
    externalWebSockets: externalWebSockets.map(redactExternalUrl),
    localFileBlocked: !run.localFileProbe.readable,
    localFileStatus: run.localFileProbe.status,
    pageErrors: [...run.pageErrors],
    rendererDiagnostics: [...run.rendererDiagnostics],
    ...processDiagnostics,
  };
}

function assertSecurity(evidence) {
  verify(evidence.externalRequestCount === 0, "phase1g-external-runtime-request", {
    count: evidence.externalRequestCount,
    requests: evidence.externalRequests,
  });
  verify(evidence.externalWebSocketCount === 0, "phase1g-external-runtime-websocket", {
    count: evidence.externalWebSocketCount,
    sockets: evidence.externalWebSockets,
  });
  verify(evidence.localFileBlocked, "phase1g-local-file-readable", {
    status: evidence.localFileStatus,
  });
  verify(evidence.pageErrors.length === 0, "phase1g-page-errors", {
    count: evidence.pageErrors.length,
  });
  verify(evidence.rendererDiagnostics.length === 0, "phase1g-renderer-diagnostics", {
    count: evidence.rendererDiagnostics.length,
  });
  verify(
    evidence.unexpectedDiagnosticCount === 0,
    "phase1g-main-or-child-diagnostics",
    {
      mainCount: evidence.mainProcessDiagnostics.length,
      childStderrCount: evidence.childStderrDiagnostics.length,
    },
  );
  verify(
    !evidence.privateContentDetected && !evidence.rawPathOrUrlDetected,
    "phase1g-diagnostic-privacy",
    {
      privateContentDetected: evidence.privateContentDetected,
      rawPathOrUrlDetected: evidence.rawPathOrUrlDetected,
    },
  );
  verify(evidence.runtime.isPackaged === packaged, "phase1g-runtime-package-mode");
  verify(evidence.runtime.rendererProtocol === "madi:", "phase1g-runtime-protocol");
  verify(
    evidence.runtime.packagedOverrideCanary === packaged,
    "phase1g-runtime-packaged-override-canary",
  );
}

async function dialogEvidence(run) {
  return run.application.evaluate(() => {
    const state = Reflect.get(globalThis, "__madiPhase1gDialogState");
    if (!state || typeof state !== "object") {
      return null;
    }
    return {
      calls: { ...state.calls },
      remaining: {
        cover: state.coverPaths.length,
        epub: state.epubPaths.length,
        jsonReport: state.jsonReportPaths.length,
        markdownReport: state.markdownReportPaths.length,
      },
    };
  });
}

async function openProject(run) {
  await run.page.getByRole("button", { name: ".madi 열기", exact: true }).click();
  const phase = await poll(
    async () => {
      if (run.pageErrors.length > 0) {
        return "page-error";
      }
      const current = await run.page
        .locator('[data-testid="save-status"]')
        .getAttribute("data-phase");
      return current === "saved" || current === "dirty" || current === "error"
        ? current
        : null;
    },
    "phase1g-project-open",
    60_000,
  );
  verify(phase === "saved" || phase === "dirty", "phase1g-project-open-failed", {
    phase,
    pageErrorCount: run.pageErrors.length,
  });
}

function epubWorkspace(run) {
  return run.page.locator("section.epub-export");
}

function snapshotPanel(run) {
  return run.page.getByRole("complementary", {
    name: "Named snapshot",
    exact: true,
  });
}

function selectInLabeledContainer(workspace, labelText) {
  return workspace.locator("label", { hasText: labelText }).locator("select");
}

async function waitForControlReady(
  run,
  control,
  description,
  timeoutMs = 60_000,
) {
  await poll(
    async () => {
      const count = await control.count();
      const visible = count === 1 ? await control.isVisible() : false;
      const enabled = count === 1 ? await control.isEnabled() : false;
      const workspace = epubWorkspace(run);
      const workspaceCount = await workspace.count();
      const workspaceBusy =
        workspaceCount === 1 &&
        (await workspace.getAttribute("aria-busy")) === "true";
      const disabledFieldsetCount =
        workspaceCount === 1
          ? await workspace.locator("fieldset:disabled").count()
          : 0;
      const savePhaseValue = await run.page
        .locator('[data-testid="save-status"]')
        .getAttribute("data-phase");
      const allowedSavePhases = new Set([
        "saved",
        "dirty",
        "saving",
        "restoring",
        "error",
      ]);
      const rootState = await run.page.evaluate(() => ({
        inert: document.documentElement.inert,
        closePending: document.documentElement.dataset.closePending === "true",
      }));
      run.lastActionability = {
        control: description,
        count,
        visible,
        enabled,
        workspaceCount,
        workspaceBusy,
        disabledFieldsetCount,
        interactionBlockedProxy: disabledFieldsetCount > 0 && !workspaceBusy,
        savePhase: allowedSavePhases.has(savePhaseValue)
          ? savePhaseValue
          : "OTHER",
        rootInert: rootState.inert,
        closePending: rootState.closePending,
      };
      return count === 1 && visible && enabled ? true : null;
    },
    description,
    timeoutMs,
  );
}

async function captureRunFailureContext(run) {
  try {
    if (run.page.isClosed()) {
      const diagnostics = run.processDiagnostics.evidence();
      return {
        rendererAvailable: false,
        pageClosed: true,
        lastActionability: run.lastActionability ?? null,
        closeAttempt: run.closeAttemptEvidence ?? null,
        mainProcessDiagnosticCount: diagnostics.mainProcessDiagnostics.length,
        childStderrDiagnosticCount: diagnostics.childStderrDiagnostics.length,
        processDiagnostics: {
          unexpectedCount: diagnostics.unexpectedDiagnosticCount,
          expectedTransportLineCount: diagnostics.expectedHarnessTransportLineCount,
          expectedLifecycleProbeLineCount:
            diagnostics.expectedHarnessLifecycleProbeLineCount,
          expectedLifecycleProbeMirrorLineCount:
            diagnostics.expectedHarnessLifecycleProbeMirrorLineCount,
          main: diagnostics.mainProcessDiagnostics,
          childStderr: diagnostics.childStderrDiagnostics,
          privateContentDetected: diagnostics.privateContentDetected,
          rawPathOrUrlDetected: diagnostics.rawPathOrUrlDetected,
        },
      };
    }
    const workspace = epubWorkspace(run);
    const workspaceCount = await workspace.count();
    if (workspaceCount !== 1) {
      return {
        rendererAvailable: true,
        workspaceCount,
        lastActionability: run.lastActionability ?? null,
        pageErrorCount: run.pageErrors.length,
        rendererDiagnosticCount: run.rendererDiagnostics.length,
      };
    }
    const phaseValue = await workspace.getAttribute("data-epub-phase");
    const allowedPhases = new Set([
      "IDLE",
      "PREPARING",
      "VALIDATING",
      "EXPORTING",
      "FINALIZING",
      "CANCELLING",
    ]);
    const controls = {
      coverSelect: workspace.getByRole("button", {
        name: "PNG/JPEG 선택",
        exact: true,
      }),
      coverRemove: workspace.getByRole("button", {
        name: "표지 제거",
        exact: true,
      }),
      outputSelect: workspace.getByRole("button", {
        name: "저장 위치 선택",
        exact: true,
      }),
      export: workspace.getByRole("button", {
        name: "EPUB 내보내기",
        exact: true,
      }),
      jsonReport: workspace.getByRole("button", {
        name: "JSON report 저장",
        exact: true,
      }),
      profile: selectInLabeledContainer(workspace, "profile"),
      split: selectInLabeledContainer(workspace, "분할"),
      includeCover: workspace.getByLabel("표지 포함", { exact: true }),
      scope: selectInLabeledContainer(workspace, "대상 범위"),
    };
    const controlState = {};
    for (const [key, control] of Object.entries(controls)) {
      const count = await control.count();
      controlState[key] = {
        count,
        visible: count === 1 ? await control.isVisible() : false,
        enabled: count === 1 ? await control.isEnabled() : false,
      };
    }
    const domState = await workspace.evaluate((element) => ({
      inertAncestorPresent: element.closest("[inert]") !== null,
      disabledFieldsetCount: element.querySelectorAll("fieldset:disabled").length,
    }));
    const rootState = await run.page.evaluate(() => ({
      inert: document.documentElement.inert,
      closePending: document.documentElement.dataset.closePending === "true",
    }));
    const savePhaseValue = await run.page
      .locator('[data-testid="save-status"]')
      .getAttribute("data-phase");
    const allowedSavePhases = new Set([
      "saved",
      "dirty",
      "saving",
      "restoring",
      "error",
    ]);
    const workspaceBusy =
      (await workspace.getAttribute("aria-busy")) === "true";
    const dialogs = await dialogEvidence(run).catch(() => null);
    const diagnostics = run.processDiagnostics.evidence();
    const snapshotPanelControl = snapshotPanel(run);
    const snapshotPanelCount = await snapshotPanelControl.count();
    const snapshotToolbarControl = run.page.getByRole("button", {
      name: "Snapshot",
      exact: true,
    });
    const snapshotToolbarCount = await snapshotToolbarControl.count();
    const snapshotNameControl = snapshotPanelControl.getByLabel("이름", {
      exact: true,
    });
    const snapshotNameCount = await snapshotNameControl.count();
    const snapshotCreateControl = snapshotPanelControl.getByRole("button", {
      name: "현재 프로젝트 snapshot 생성",
      exact: true,
    });
    const snapshotCreateCount = await snapshotCreateControl.count();
    return {
      rendererAvailable: true,
      workspaceCount,
      workspacePhase: allowedPhases.has(phaseValue) ? phaseValue : "OTHER",
      workspaceBusy,
      alertCount: await workspace.getByRole("alert").count(),
      ...domState,
      interactionBlockedProxy:
        domState.disabledFieldsetCount > 0 && !workspaceBusy,
      savePhase: allowedSavePhases.has(savePhaseValue)
        ? savePhaseValue
        : "OTHER",
      rootInert: rootState.inert,
      closePending: rootState.closePending,
      controls: controlState,
      snapshotControls: {
        panelCount: snapshotPanelCount,
        toolbarCount: snapshotToolbarCount,
        toolbarEnabled:
          snapshotToolbarCount === 1
            ? await snapshotToolbarControl.isEnabled()
            : false,
        nameCount: snapshotNameCount,
        nameEnabled:
          snapshotNameCount === 1 ? await snapshotNameControl.isEnabled() : false,
        createCount: snapshotCreateCount,
        createEnabled:
          snapshotCreateCount === 1
            ? await snapshotCreateControl.isEnabled()
            : false,
      },
      lastActionability: run.lastActionability ?? null,
      dialogCallCounts: dialogs?.calls ?? null,
      pageErrorCount: run.pageErrors.length,
      rendererDiagnosticCount: run.rendererDiagnostics.length,
      mainProcessDiagnosticCount: diagnostics.mainProcessDiagnostics.length,
      childStderrDiagnosticCount: diagnostics.childStderrDiagnostics.length,
    };
  } catch (error) {
    return {
      rendererAvailable: !run.page.isClosed(),
      structuralCaptureFailed: true,
      captureError: summarizeError(error),
    };
  }
}

async function enterEpubExport(run) {
  const button = run.page.getByRole("button", { name: "EPUB", exact: true });
  await poll(
    async () => ((await button.isEnabled()) ? true : null),
    "phase1g-epub-mode-enabled",
    30_000,
  );
  await button.click();
  await poll(
    async () => {
      const workspace = epubWorkspace(run);
      if ((await workspace.count()) !== 1) {
        return null;
      }
      if ((await workspace.locator("h2").filter({ hasText: "EPUB 내보내기" }).count()) !== 1) {
        return null;
      }
      return (await workspace.getAttribute("data-epub-phase")) === "IDLE" ? true : null;
    },
    "phase1g-epub-mode-ready",
    60_000,
  );
}

async function waitForWorkspaceIdle(run, timeoutMs = OPERATION_TIMEOUT_MS) {
  return poll(
    async () => {
      const workspace = epubWorkspace(run);
      if ((await workspace.count()) !== 1) {
        return null;
      }
      const phase = await workspace.getAttribute("data-epub-phase");
      const busy = await workspace.getAttribute("aria-busy");
      return phase === "IDLE" && busy !== "true" ? true : null;
    },
    "phase1g-workspace-idle",
    timeoutMs,
  );
}

async function waitForNoAlert(run) {
  await poll(
    async () => ((await epubWorkspace(run).getByRole("alert").count()) === 0 ? true : null),
    "phase1g-alert-cleared",
  );
}

async function fillMetadata(run, creator) {
  const workspace = epubWorkspace(run);
  await workspace.getByLabel("제목", { exact: true }).fill(publicationTitle);
  await workspace.getByLabel("작가", { exact: true }).fill(creator);
  await workspace.getByLabel("언어", { exact: true }).fill("ko-KR");
  await workspace.getByLabel("식별자", { exact: true }).fill(metadataIdentifier);
  await workspace.getByLabel("출판사", { exact: true }).fill("madi 실제 검증 출판사");
  await workspace
    .getByLabel("설명", { exact: true })
    .fill("한국어 · 특수문자 & < > XML escaping 실제 검증");
  await workspace.getByLabel("권리", { exact: true }).fill("비공개 로컬 검증");
  await workspace.getByLabel("주제 (쉼표 구분)", { exact: true }).fill("장편, EPUB, 한국어");
}

async function saveMetadata(run) {
  const workspace = epubWorkspace(run);
  const revisionBefore =
    (await workspace.locator(".epub-export__header .engine-pill").textContent()) ?? "";
  await workspace.getByRole("button", { name: "metadata 저장", exact: true }).click();
  await poll(
    async () => {
      const revisionAfter =
        (await workspace.locator(".epub-export__header .engine-pill").textContent()) ?? "";
      const phase = await workspace.getAttribute("data-epub-phase");
      const busy = await workspace.getAttribute("aria-busy");
      return revisionAfter !== revisionBefore && phase === "IDLE" && busy !== "true"
        ? true
        : null;
    },
    "phase1g-metadata-save",
    60_000,
  );
}

async function exerciseInvalidMetadataGate(run) {
  const workspace = epubWorkspace(run);
  await workspace.getByLabel("작가", { exact: true }).fill("");
  await workspace.getByRole("button", { name: "사전 검사", exact: true }).click();
  await poll(
    async () => {
      const alert = workspace.getByRole("alert");
      if ((await alert.count()) !== 1) {
        return null;
      }
      const text = (await alert.textContent()) ?? "";
      return text.includes("metadata") || text.includes("제목") ? true : null;
    },
    "phase1g-invalid-metadata-gate",
    60_000,
  );
  await waitForWorkspaceIdle(run);
  verify(
    (await workspace.locator('[aria-label="EPUB validation report"]').count()) === 0,
    "phase1g-invalid-metadata-produced-report",
  );
  return {
    requiredCreatorRejected: true,
    validationNotStarted: true,
  };
}

async function chooseCoverAndWait(run, expectedMediaType) {
  const workspace = epubWorkspace(run);
  const button = workspace.getByRole("button", {
    name: "PNG/JPEG 선택",
    exact: true,
  });
  await waitForControlReady(run, button, "phase1g-cover-select-ready");
  await button.click();
  await poll(
    async () => {
      const text = (await workspace.locator(".epub-export__cover span").textContent()) ?? "";
      return text.includes(expectedMediaType) ? true : null;
    },
    "phase1g-cover-selected",
    60_000,
  );
  await waitForWorkspaceIdle(run);
}

async function removeCoverAndWait(run) {
  const workspace = epubWorkspace(run);
  const button = workspace.getByRole("button", {
    name: "표지 제거",
    exact: true,
  });
  await waitForControlReady(run, button, "phase1g-cover-remove-ready");
  await button.click();
  await poll(
    async () => {
      const text = (await workspace.locator(".epub-export__cover span").textContent()) ?? "";
      return text.includes("없음") ? true : null;
    },
    "phase1g-cover-removed",
    60_000,
  );
  await waitForWorkspaceIdle(run);
}

async function setEpubConfiguration(
  run,
  { profile, splitMode, includeCover, scopeNodeId = undefined },
) {
  const workspace = epubWorkspace(run);
  const profileControl = selectInLabeledContainer(workspace, "profile");
  const splitControl = selectInLabeledContainer(workspace, "분할");
  await waitForControlReady(
    run,
    profileControl,
    "phase1g-profile-select-ready",
  );
  await profileControl.selectOption(profile);
  await waitForControlReady(run, splitControl, "phase1g-split-select-ready");
  await splitControl.selectOption(splitMode);
  const cover = workspace.getByLabel("표지 포함", { exact: true });
  await waitForControlReady(run, cover, "phase1g-cover-toggle-ready");
  if (includeCover) {
    await cover.check();
  } else {
    await cover.uncheck();
  }
  if (scopeNodeId) {
    const scope = selectInLabeledContainer(workspace, "대상 범위");
    await waitForControlReady(run, scope, "phase1g-scope-select-ready");
    await scope.selectOption(scopeNodeId);
    verify((await scope.inputValue()) === scopeNodeId, "phase1g-scope-state");
  }
  verify(
    (await workspace.getAttribute("data-epub-profile")) === profile,
    "phase1g-profile-state",
  );
  const notice = (await workspace.locator(".epub-export__notice").textContent()) ?? "";
  verify(
    profile === "EPUB_3_4_DRAFT_2026_08"
      ? notice.includes("Candidate Recommendation Draft")
      : notice.includes("EPUBCheck 5.3.0"),
    "phase1g-profile-notice",
  );
}

async function exercisePresetCrud(run) {
  const workspace = epubWorkspace(run);
  const listbox = selectInLabeledContainer(workspace, "preset");
  const initialCount = await listbox.locator("option").count();
  await workspace.getByLabel("preset 이름", { exact: true }).fill(presetName);
  await workspace.getByRole("button", { name: "새 preset 저장", exact: true }).click();
  await poll(
    async () =>
      (await listbox.locator("option").count()) === initialCount + 1 ? true : null,
    "phase1g-preset-create",
    60_000,
  );
  await waitForWorkspaceIdle(run);
  const createdValue = await listbox.inputValue();
  verify(createdValue.length > 0, "phase1g-preset-created-selection");
  await workspace.getByLabel("preset 이름", { exact: true }).fill(updatedPresetName);
  await workspace.getByRole("button", { name: "변경 저장", exact: true }).click();
  await poll(
    async () => {
      const selected = listbox.locator("option:checked");
      return (await selected.textContent()) === updatedPresetName ? true : null;
    },
    "phase1g-preset-update",
    60_000,
  );
  await waitForWorkspaceIdle(run);
  await workspace.getByRole("button", { name: "복제", exact: true }).click();
  await poll(
    async () =>
      (await listbox.locator("option").count()) === initialCount + 2 ? true : null,
    "phase1g-preset-duplicate",
    60_000,
  );
  await waitForWorkspaceIdle(run);
  const duplicateValue = await listbox.inputValue();
  verify(
    duplicateValue.length > 0 && duplicateValue !== createdValue,
    "phase1g-preset-duplicate-selection",
  );
  await workspace.getByRole("button", { name: "삭제", exact: true }).click();
  await poll(
    async () =>
      (await listbox.locator("option").count()) === initialCount + 1 ? true : null,
    "phase1g-preset-delete",
    60_000,
  );
  await waitForWorkspaceIdle(run);
  await listbox.selectOption({ label: updatedPresetName });
  verify((await listbox.inputValue()) === createdValue, "phase1g-preset-original-retained");
  return {
    created: true,
    updated: true,
    duplicated: true,
    duplicateDeleted: true,
    retainedPresetCount: (await listbox.locator("option").count()) - 1,
  };
}

async function openSnapshotPanel(run) {
  const button = run.page.getByRole("button", {
    name: "Snapshot",
    exact: true,
  });
  await waitForControlReady(run, button, "phase1g-snapshot-toolbar-ready");
  await button.click();
  await snapshotPanel(run).waitFor({ timeout: 30_000 });
}

async function closeGlobalPanel(run) {
  const button = run.page.getByRole("button", {
    name: "개발 패널",
    exact: true,
  });
  await waitForControlReady(run, button, "phase1g-development-panel-ready");
  await button.click();
  await poll(
    async () => ((await snapshotPanel(run).count()) === 0 ? true : null),
    "phase1g-snapshot-panel-close",
  );
}

async function createEpubSnapshot(run) {
  reportStage("normal-state-snapshot-create-panel-open");
  await openSnapshotPanel(run);
  const panel = snapshotPanel(run);
  reportStage("normal-state-snapshot-create-inventory");
  const existingIds = await panel
    .locator("[data-snapshot-id]")
    .evaluateAll((items) => items.map((item) => item.getAttribute("data-snapshot-id")));
  const nameControl = panel.getByLabel("이름", { exact: true });
  await waitForControlReady(run, nameControl, "phase1g-snapshot-name-ready");
  reportStage("normal-state-snapshot-create-name");
  await nameControl.fill(snapshotName);
  const createControl = panel.getByRole("button", {
    name: "현재 프로젝트 snapshot 생성",
    exact: true,
  });
  await waitForControlReady(run, createControl, "phase1g-snapshot-create-ready");
  reportStage("normal-state-snapshot-create-submit");
  await createControl.click();
  reportStage("normal-state-snapshot-create-wait");
  const created = await poll(
    async () => {
      const items = await panel.locator("[data-snapshot-id]").evaluateAll((nodes) =>
        nodes.map((node) => ({
          id: node.getAttribute("data-snapshot-id"),
          payloadVersion: Number(node.getAttribute("data-snapshot-payload-version")),
        })),
      );
      return (
        items.find(
          (item) =>
            item.id &&
            !existingIds.includes(item.id) &&
            Number.isSafeInteger(item.payloadVersion),
        ) ?? null
      );
    },
    "phase1g-snapshot-create",
    90_000,
  );
  verify(created.payloadVersion === 5, "phase1g-snapshot-payload-version", {
    observed: created.payloadVersion,
  });
  reportStage("normal-state-snapshot-create-close");
  await closeGlobalPanel(run);
  reportStage("normal-state-snapshot-create-complete");
  return {
    snapshotId: created.id,
    payloadVersion: created.payloadVersion,
    previousCount: existingIds.length,
  };
}

async function createMutationPreset(run) {
  const workspace = epubWorkspace(run);
  const listbox = selectInLabeledContainer(workspace, "preset");
  const before = await listbox.locator("option").count();
  await listbox.selectOption("");
  await workspace.getByLabel("preset 이름", { exact: true }).fill(mutationPresetName);
  await workspace.getByRole("button", { name: "새 preset 저장", exact: true }).click();
  await poll(
    async () => ((await listbox.locator("option").count()) === before + 1 ? true : null),
    "phase1g-mutation-preset",
    60_000,
  );
  await waitForWorkspaceIdle(run);
}

async function restoreEpubSnapshot(run, snapshot) {
  await openSnapshotPanel(run);
  const panel = snapshotPanel(run);
  const item = panel.locator(`[data-snapshot-id="${snapshot.snapshotId}"]`);
  verify(Number(await item.getAttribute("data-snapshot-payload-version")) === 5, "phase1g-restore-payload-version");
  await item.getByRole("button", { name: / 복원$/u }).click();
  const dialog = run.page.getByRole("alertdialog");
  await dialog.waitFor({ timeout: 60_000 });
  const phase1gDiff = await dialog.locator("dl").evaluate((list) => {
    const read = (label) => {
      const row = [...list.querySelectorAll("div")].find(
        (candidate) => candidate.querySelector("dt")?.textContent?.trim() === label,
      );
      return row?.querySelector("dd")?.textContent?.trim() ?? "";
    };
    return {
      publicationMetadata: read("출판 메타데이터"),
      cover: read("표지"),
      exportPresetNumbers:
        read("EPUB export preset")
          .match(/\d+/gu)
          ?.slice(0, 3)
          .map(Number) ?? [],
    };
  });
  verify(
    phase1gDiff.publicationMetadata === "변경" &&
      phase1gDiff.cover === "변경" &&
      phase1gDiff.exportPresetNumbers.length === 3 &&
      phase1gDiff.exportPresetNumbers.reduce((sum, value) => sum + value, 0) >= 1,
    "phase1g-snapshot-diff-contract",
    {
      metadataChanged: phase1gDiff.publicationMetadata === "변경",
      coverChanged: phase1gDiff.cover === "변경",
      exportPresetChangeCount: phase1gDiff.exportPresetNumbers.reduce(
        (sum, value) => sum + value,
        0,
      ),
    },
  );
  await dialog
    .getByRole("button", { name: "안전 snapshot 생성 후 복원", exact: true })
    .click();
  await dialog.waitFor({ state: "detached", timeout: 120_000 });
  await poll(
    async () =>
      (await panel.locator("[data-snapshot-id]").count()) === snapshot.previousCount + 2
        ? true
        : null,
    "phase1g-snapshot-safety-count",
    90_000,
  );
  await closeGlobalPanel(run);
  await poll(
    async () => ((await epubWorkspace(run).count()) === 1 ? true : null),
    "phase1g-export-workspace-restored",
    60_000,
  );
  await waitForWorkspaceIdle(run, 120_000);
  const restored = await inspectCanonicalExportState(run);
  verify(restored.matchesExpected, "phase1g-snapshot-canonical-state-restore");
  return {
    payloadVersion: 5,
    automaticSafetySnapshotCreated: true,
    diff: {
      publicationMetadataChanged: true,
      coverChanged: true,
      exportPresetChangeCount: phase1gDiff.exportPresetNumbers.reduce(
        (sum, value) => sum + value,
        0,
      ),
    },
    metadataRestored: restored.metadataMatches,
    coverRestored: restored.coverMatches,
    presetRestored: restored.presetMatches,
  };
}

async function inspectCanonicalExportState(run) {
  const workspace = epubWorkspace(run);
  const metadataMatches =
    (await workspace.getByLabel("제목", { exact: true }).inputValue()) === publicationTitle &&
    (await workspace.getByLabel("작가", { exact: true }).inputValue()) === creatorName &&
    (await workspace.getByLabel("언어", { exact: true }).inputValue()) === "ko-KR" &&
    (await workspace.getByLabel("식별자", { exact: true }).inputValue()) ===
      metadataIdentifier;
  const coverText = (await workspace.locator(".epub-export__cover span").textContent()) ?? "";
  const coverMatches = coverText.includes("image/jpeg") && !coverText.includes("없음");
  const presetOptions = await selectInLabeledContainer(workspace, "preset")
    .locator("option")
    .allTextContents();
  const presetMatches =
    presetOptions.filter((value) => value === updatedPresetName).length === 1 &&
    !presetOptions.includes(mutationPresetName) &&
    presetOptions.length === 2;
  const actionText =
    (await workspace.locator(".epub-export__actions .epub-export__button-row").textContent()) ??
    "";
  const outputUnselected = actionText.includes("저장 위치 미선택");
  return {
    matchesExpected: metadataMatches && coverMatches && presetMatches && outputUnselected,
    metadataMatches,
    coverMatches,
    presetMatches,
    outputUnselected,
    presetCount: presetOptions.length - 1,
  };
}

async function startResponsivenessProbe(run) {
  await run.page.evaluate(() => {
    const existing = Reflect.get(globalThis, "__madiPhase1gResponsivenessProbe");
    if (existing?.stop) {
      existing.stop();
    }
    const workspace = document.querySelector("section.epub-export");
    const phases = new Set();
    const startedAt = performance.now();
    let stopped = false;
    let frameCount = 0;
    let heartbeatCount = 0;
    let maximumFrameGapMs = 0;
    let maximumHeartbeatGapMs = 0;
    let previousFrame = startedAt;
    let previousHeartbeat = startedAt;
    const onFrame = (now) => {
      maximumFrameGapMs = Math.max(maximumFrameGapMs, now - previousFrame);
      previousFrame = now;
      frameCount += 1;
      if (!stopped) {
        requestAnimationFrame(onFrame);
      }
    };
    requestAnimationFrame(onFrame);
    const heartbeat = setInterval(() => {
      const now = performance.now();
      maximumHeartbeatGapMs = Math.max(maximumHeartbeatGapMs, now - previousHeartbeat);
      previousHeartbeat = now;
      heartbeatCount += 1;
    }, 50);
    const observer = new MutationObserver(() => {
      if (workspace instanceof HTMLElement) {
        phases.add(workspace.dataset.epubPhase ?? "UNKNOWN");
      }
    });
    if (workspace) {
      observer.observe(workspace, {
        attributes: true,
        attributeFilter: ["data-epub-phase"],
      });
    }
    const probe = {
      stop: () => {
        stopped = true;
        clearInterval(heartbeat);
        observer.disconnect();
        const stoppedAt = performance.now();
        maximumFrameGapMs = Math.max(maximumFrameGapMs, stoppedAt - previousFrame);
        maximumHeartbeatGapMs = Math.max(
          maximumHeartbeatGapMs,
          stoppedAt - previousHeartbeat,
        );
        return {
          elapsedMs: stoppedAt - startedAt,
          frameCount,
          heartbeatCount,
          maximumFrameGapMs,
          maximumHeartbeatGapMs,
          phases: [...phases],
        };
      },
    };
    Reflect.set(globalThis, "__madiPhase1gResponsivenessProbe", probe);
  });
}

async function stopResponsivenessProbe(run) {
  return run.page.evaluate(() => {
    const probe = Reflect.get(globalThis, "__madiPhase1gResponsivenessProbe");
    if (!probe || typeof probe.stop !== "function") {
      return null;
    }
    const result = probe.stop();
    Reflect.deleteProperty(globalThis, "__madiPhase1gResponsivenessProbe");
    return result;
  });
}

async function chooseOutput(run) {
  const workspace = epubWorkspace(run);
  await workspace.getByRole("button", { name: "저장 위치 선택", exact: true }).click();
  await poll(
    async () => {
      const rowText =
        (await workspace.locator(".epub-export__actions .epub-export__button-row").textContent()) ??
        "";
      return rowText.includes("저장 위치 미선택") ? null : true;
    },
    "phase1g-output-selected",
    30_000,
  );
  await waitForWorkspaceIdle(run);
}

async function validateFromUi(run, expected) {
  const workspace = epubWorkspace(run);
  const started = performance.now();
  await workspace.getByRole("button", { name: "사전 검사", exact: true }).click();
  await poll(
    async () => {
      const status = await workspace.getAttribute("data-epub-validation-status");
      const phase = await workspace.getAttribute("data-epub-phase");
      return status === "VALID" && phase === "IDLE" ? true : null;
    },
    "phase1g-validation-complete",
    OPERATION_TIMEOUT_MS,
  );
  const elapsedMs = performance.now() - started;
  const loss = Number(await workspace.getAttribute("data-epub-block-loss"));
  verify(loss === 0, "phase1g-validation-block-loss", { loss });
  const report = workspace.getByRole("region", {
    name: "EPUB validation report",
    exact: true,
  });
  verify((await report.count()) === 1, "phase1g-validation-report-visible");
  const summary = (await report.locator(".epub-export__summary").textContent()) ?? "";
  verify(
    summary.includes(
      `${expected.blockCount}/${expected.blockCount}`,
    ) && summary.includes(`${expected.characterCount}/${expected.characterCount}`),
    "phase1g-validation-ui-coverage",
  );
  return {
    valid: true,
    blockLoss: 0,
    characterLoss: 0,
    elapsedMs: roundMilliseconds(elapsedMs),
  };
}

async function runExportFromUi(run, outputPath, expected) {
  const workspace = epubWorkspace(run);
  await chooseOutput(run);
  await startResponsivenessProbe(run);
  const started = performance.now();
  await workspace.getByRole("button", { name: "EPUB 내보내기", exact: true }).click();
  await poll(
    async () => {
      const phase = await workspace.getAttribute("data-epub-phase");
      const successCount = await workspace.locator(".epub-export__success").count();
      return phase !== "IDLE" || successCount === 1 ? true : null;
    },
    "phase1g-export-started",
    30_000,
  );
  const memoryPromise = (async () => {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
    return sampleApplicationMemory(run.application);
  })();
  await poll(
    async () => {
      const phase = await workspace.getAttribute("data-epub-phase");
      const success = await workspace.locator(".epub-export__success").count();
      return phase === "IDLE" && success === 1 ? true : null;
    },
    "phase1g-export-complete",
    OPERATION_TIMEOUT_MS,
  );
  const wallMs = performance.now() - started;
  const responsiveness = await stopResponsivenessProbe(run);
  const memory = await memoryPromise;
  verify(responsiveness, "phase1g-responsiveness-probe-missing");
  // A successful export can complete before the first 50 ms heartbeat or an
  // occluded window's next rAF. In that bounded case the start-to-stop tail is
  // itself the responsiveness measurement. Zero ticks are only acceptable
  // while that entire observation remains below the same freeze ceiling.
  verify(
    responsiveness.frameCount > 0 ||
      responsiveness.elapsedMs <= MAX_RENDERER_FRAME_GAP_MS,
    "phase1g-responsiveness-no-frames",
    {
      elapsedMs: roundMilliseconds(responsiveness.elapsedMs),
      maximumMs: MAX_RENDERER_FRAME_GAP_MS,
    },
  );
  verify(
    responsiveness.heartbeatCount > 0 ||
      responsiveness.elapsedMs <= MAX_RENDERER_HEARTBEAT_GAP_MS,
    "phase1g-responsiveness-no-heartbeats",
    {
      elapsedMs: roundMilliseconds(responsiveness.elapsedMs),
      maximumMs: MAX_RENDERER_HEARTBEAT_GAP_MS,
    },
  );
  verify(
    responsiveness.maximumFrameGapMs <= MAX_RENDERER_FRAME_GAP_MS,
    "phase1g-responsiveness-frame-gap",
    {
      observedMs: roundMilliseconds(responsiveness.maximumFrameGapMs),
      maximumMs: MAX_RENDERER_FRAME_GAP_MS,
    },
  );
  verify(
    responsiveness.maximumHeartbeatGapMs <= MAX_RENDERER_HEARTBEAT_GAP_MS,
    "phase1g-responsiveness-heartbeat-gap",
    {
      observedMs: roundMilliseconds(responsiveness.maximumHeartbeatGapMs),
      maximumMs: MAX_RENDERER_HEARTBEAT_GAP_MS,
    },
  );
  const observedActivePhase = responsiveness.phases.some((phase) =>
    ["PREPARING", "EXPORTING", "FINALIZING"].includes(phase),
  );
  verify(
    observedActivePhase ||
      responsiveness.elapsedMs <= MAX_RENDERER_HEARTBEAT_GAP_MS,
    "phase1g-responsiveness-phase-observation",
    {
      elapsedMs: roundMilliseconds(responsiveness.elapsedMs),
      phaseObservationCount: responsiveness.phases.length,
    },
  );
  await poll(
    async () => ((await fileExists(outputPath)) ? true : null),
    "phase1g-output-file",
    30_000,
  );
  const bytes = await readFile(outputPath);
  verify(bytes.length > 0, "phase1g-output-empty");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const structure = validateGeneratedEpub(bytes, expected);
  const loss = Number(await workspace.getAttribute("data-epub-block-loss"));
  verify(loss === 0, "phase1g-export-ui-block-loss", { loss });
  return {
    wallMs: roundMilliseconds(wallMs),
    memory,
    responsiveness: {
      elapsedMs: roundMilliseconds(responsiveness.elapsedMs),
      frameCount: responsiveness.frameCount,
      heartbeatCount: responsiveness.heartbeatCount,
      maximumFrameGapMs: roundMilliseconds(responsiveness.maximumFrameGapMs),
      maximumHeartbeatGapMs: roundMilliseconds(
        responsiveness.maximumHeartbeatGapMs,
      ),
      maximumAllowedFrameGapMs: MAX_RENDERER_FRAME_GAP_MS,
      maximumAllowedHeartbeatGapMs: MAX_RENDERER_HEARTBEAT_GAP_MS,
      observedPreparing: responsiveness.phases.includes("PREPARING"),
      observedExporting: responsiveness.phases.includes("EXPORTING"),
      observedFinalizing: responsiveness.phases.includes("FINALIZING"),
    },
    sha256,
    byteLength: bytes.length,
    structure,
    blockLoss: 0,
  };
}

async function saveJsonReport(run, reportPath, expected) {
  const workspace = epubWorkspace(run);
  await workspace.getByRole("button", { name: "JSON report 저장", exact: true }).click();
  await poll(
    async () => ((await fileExists(reportPath)) ? true : null),
    "phase1g-json-report-file",
    30_000,
  );
  await waitForWorkspaceIdle(run);
  return readAndValidateReport(reportPath, expected);
}

async function saveMarkdownReport(run, reportPath, expectedReport) {
  const workspace = epubWorkspace(run);
  await workspace
    .getByRole("button", { name: "Markdown report 저장", exact: true })
    .click();
  await poll(
    async () => ((await fileExists(reportPath)) ? true : null),
    "phase1g-markdown-report-file",
    30_000,
  );
  await waitForWorkspaceIdle(run);
  const bytes = await readFile(reportPath);
  verify(bytes.length > 0 && bytes.length <= 8 * 1024 * 1024, "phase1g-markdown-report-size");
  const markdown = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  verify(markdown.startsWith("# madi EPUB export report"), "phase1g-markdown-heading");
  verify(markdown.includes(`- Profile: ${expectedReport.targetProfile}`), "phase1g-markdown-profile");
  verify(markdown.includes("- Blocks:"), "phase1g-markdown-blocks");
  verify(markdown.includes("- Characters:"), "phase1g-markdown-characters");
  verify(markdown.includes("- EPUBCheck: UNAVAILABLE"), "phase1g-markdown-epubcheck");
  const privacy = assertReportPrivacy(
    markdown,
    "phase1g-markdown-private-content",
  );
  return {
    saved: true,
    utf8: true,
    byteLength: bytes.length,
    includesProfile: true,
    includesCoverage: true,
    includesEpubCheckVersionField: true,
    ...privacy,
  };
}

async function revealExport(run) {
  await epubWorkspace(run)
    .getByRole("button", { name: "파일 위치 열기", exact: true })
    .click();
  await waitForWorkspaceIdle(run);
  const evidence = await dialogEvidence(run);
  verify(evidence?.calls.reveal > 0, "phase1g-reveal-not-invoked");
  return { invoked: true };
}

async function exerciseNoClobber(run, outputPath, expected) {
  verify(!(await fileExists(outputPath)), "phase1g-no-clobber-preexisting");
  await chooseOutput(run);
  const sentinel = Buffer.from("phase1g-concurrent-owner", "utf8");
  await writeFile(outputPath, sentinel, { flag: "wx", mode: 0o600 });
  const workspace = epubWorkspace(run);
  await workspace.getByRole("button", { name: "EPUB 내보내기", exact: true }).click();
  await poll(
    async () => {
      const phase = await workspace.getAttribute("data-epub-phase");
      const alerts = await workspace.getByRole("alert").count();
      return phase === "IDLE" && alerts === 1 ? true : null;
    },
    "phase1g-no-clobber-result",
    OPERATION_TIMEOUT_MS,
  );
  const after = await readFile(outputPath);
  verify(after.equals(sentinel), "phase1g-no-clobber-destination-changed");
  verify(
    (await workspace.locator(".epub-export__success").count()) === 0,
    "phase1g-no-clobber-success-visible",
  );
  verify(
    Number(await workspace.getAttribute("data-epub-block-loss")) !== 0 ||
      (await workspace.getAttribute("data-epub-validation-status")) !== "VALID",
    "phase1g-no-clobber-stale-report",
  );
  verify(expected.blockCount > 0, "phase1g-no-clobber-fixture-contract");
  return {
    concurrentDestinationPreserved: true,
    exportFailedClosed: true,
    staleSuccessHidden: true,
  };
}

async function exerciseCancel(run, outputPath) {
  verify(!(await fileExists(outputPath)), "phase1g-cancel-preexisting-output");
  await chooseOutput(run);
  const workspace = epubWorkspace(run);
  await workspace.getByRole("button", { name: "EPUB 내보내기", exact: true }).click();
  const phaseAtCancel = await poll(
    async () => {
      const phase = await workspace.getAttribute("data-epub-phase");
      const cancel = workspace.getByRole("button", { name: "취소", exact: true });
      return phase !== "IDLE" && (await cancel.isEnabled()) ? phase : null;
    },
    "phase1g-cancel-enabled",
    30_000,
  );
  await workspace.getByRole("button", { name: "취소", exact: true }).click();
  await waitForWorkspaceIdle(run, OPERATION_TIMEOUT_MS);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 750));
  verify(!(await fileExists(outputPath)), "phase1g-cancel-output-created");
  verify(
    (await workspace.locator(".epub-export__success").count()) === 0,
    "phase1g-cancel-late-success",
  );
  verify(
    (await workspace.locator(".epub-export__progress").count()) === 0,
    "phase1g-cancel-late-progress",
  );
  return {
    accepted: true,
    phaseAtCancel:
      phaseAtCancel === "PREPARING"
        ? "PREPARING"
        : phaseAtCancel === "EXPORTING"
          ? "EXPORTING"
          : "OTHER",
    outputAbsent: true,
    lateSuccessAbsent: true,
    lateProgressAbsent: true,
  };
}

async function listGlobalEpubTempArtifacts() {
  const entries = await readdir(tmpdir(), { withFileTypes: true });
  return new Set(
    entries
      .filter((entry) =>
        /^(?:madi-epub-validation-|madi-export-epub-|madi-phase1g-epubcheck-|\.madi-epub-)/u.test(
          entry.name,
        ),
      )
      .map((entry) => entry.name),
  );
}

async function inspectOwnedTemporaryArtifacts(root) {
  const pending = [root];
  let temporaryArtifactCount = 0;
  let symlinkCount = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = resolve(current, entry.name);
      verify(isWithin(entryPath, root), "phase1g-temp-inspection-scope");
      if (entry.isSymbolicLink()) {
        if (entry.name.includes("madi-epub-")) {
          symlinkCount += 1;
        }
        continue;
      }
      if (entry.isDirectory()) {
        if (
          entry.name.startsWith(".madi-epub-operation-") ||
          entry.name.startsWith(".madi-epub-report-")
        ) {
          temporaryArtifactCount += 1;
        }
        pending.push(entryPath);
      } else if (entry.name.includes("madi-epub-")) {
        temporaryArtifactCount += 1;
      }
    }
  }
  return { temporaryArtifactCount, symlinkCount };
}

async function validateCleanupState(
  temporaryRoot,
  baselineGlobalArtifacts,
  lifecycles,
) {
  const currentGlobalArtifacts = await listGlobalEpubTempArtifacts();
  const newGlobalArtifactCount = [...currentGlobalArtifacts].filter(
    (name) => !baselineGlobalArtifacts.has(name),
  ).length;
  const local = await inspectOwnedTemporaryArtifacts(temporaryRoot);
  verify(newGlobalArtifactCount === 0, "phase1g-global-temp-leak", {
    count: newGlobalArtifactCount,
  });
  verify(local.temporaryArtifactCount === 0, "phase1g-owned-temp-leak", {
    count: local.temporaryArtifactCount,
  });
  verify(local.symlinkCount === 0, "phase1g-owned-temp-symlink");
  const processesExited =
    lifecycles.length === 3 &&
    lifecycles.every(
      (lifecycle) =>
        lifecycle.productGracefulQuit === true &&
        lifecycle.testTransportWrapperCleanupCompleted === true &&
        lifecycle.processTracking.exactCapturedProcessesExited === true &&
        lifecycle.processTracking.capturedDescendantProcessesAfterClose === 0,
    );
  verify(processesExited, "phase1g-cleanup-process-proof", {
    lifecycleCount: lifecycles.length,
    cleanLifecycleCount: lifecycles.filter(
      (lifecycle) =>
        lifecycle.productGracefulQuit === true &&
        lifecycle.testTransportWrapperCleanupCompleted === true &&
        lifecycle.processTracking.exactCapturedProcessesExited === true &&
        lifecycle.processTracking.capturedDescendantProcessesAfterClose === 0,
    ).length,
  });
  return {
    newGlobalArtifactCount,
    ownedTemporaryArtifactCount: local.temporaryArtifactCount,
    ownedSymlinkCount: local.symlinkCount,
    processesExited,
    provenLifecycleCount: lifecycles.length,
  };
}

async function removeTemporaryRoot(temporaryRoot) {
  const canonicalTemporaryRoot = await realpath(temporaryRoot);
  const canonicalSystemTemporary = await realpath(tmpdir());
  verify(
    isWithin(canonicalTemporaryRoot, canonicalSystemTemporary) &&
      canonicalTemporaryRoot !== canonicalSystemTemporary &&
      basename(canonicalTemporaryRoot).startsWith("madi-phase1g-"),
    "phase1g-temporary-root-delete-scope",
  );
  const entry = await lstat(canonicalTemporaryRoot);
  verify(entry.isDirectory() && !entry.isSymbolicLink(), "phase1g-temporary-root-delete-type");
  await rm(canonicalTemporaryRoot, {
    recursive: true,
    force: false,
    maxRetries: 10,
    retryDelay: 250,
  });
}

function fixtureEvidence(fixture) {
  const publicationIrCompile = summarizeMeasurements(
    fixture.compileWork.samplesMs,
  );
  verify(
    publicationIrCompile.runs === fixture.compileWork.runs &&
      publicationIrCompile.medianMs === fixture.compileWork.medianMs &&
      publicationIrCompile.maxMs === fixture.compileWork.maxMs,
    "phase1g-fixture-compile-summary",
    {
      runs: publicationIrCompile.runs,
      medianMatched:
        publicationIrCompile.medianMs === fixture.compileWork.medianMs,
      maxMatched: publicationIrCompile.maxMs === fixture.compileWork.maxMs,
    },
  );
  return {
    verified: true,
    byteLength: fixture.bytes,
    sha256Matched: true,
    revision: fixture.revision,
    inventory: {
      volumes: fixture.inventory.volumes,
      chapters: fixture.inventory.chapters,
      scenes: fixture.inventory.scenes,
      characters: fixture.inventory.characters,
      paragraphs: fixture.inventory.paragraphs,
      sceneBreaks: fixture.inventory.sceneBreaks,
      sections: fixture.inventory.sections,
      blocks: fixture.inventory.blocks,
    },
    publicationIrCompile,
  };
}

function expectedExport(fixture, profile, splitMode, coverIncluded) {
  return {
    profile,
    splitMode,
    coverIncluded,
    richSemantics: true,
    sectionCount: fixture.inventory.sections,
    blockCount: fixture.inventory.blocks,
    characterCount: fixture.inventory.characters,
    sceneBreakCount: fixture.inventory.sceneBreaks,
    xhtmlCount:
      splitMode === "SCENE" ? fixture.inventory.scenes : fixture.inventory.chapters,
  };
}

function expectedScopedExport(
  fixture,
  scopeKind,
  profile,
  splitMode,
  coverIncluded,
) {
  const scope = fixture.scopes[scopeKind];
  verify(scope?.scopeKind === scopeKind, "phase1g-expected-scope-kind");
  return {
    profile,
    splitMode,
    coverIncluded,
    richSemantics: true,
    sectionCount: scope.sections,
    blockCount: scope.blocks,
    characterCount: scope.withSpaces,
    sceneBreakCount: scope.sections,
    xhtmlCount: splitMode === "SCENE" ? scope.sections : scope.chapters,
  };
}

function fixtureScopeNodeId(fixture, scopeKind) {
  const key =
    scopeKind === "WORK"
      ? "workId"
      : scopeKind === "VOLUME"
        ? "volumeId"
        : scopeKind === "CHAPTER"
          ? "chapterId"
          : "sceneId";
  const nodeId = fixture.ids[key];
  verify(
    typeof nodeId === "string" && nodeId === fixture.scopes[scopeKind].scopeNodeId,
    "phase1g-fixture-scope-node-identity",
    { scopeKind },
  );
  return nodeId;
}

async function runBoundedScopeExercise(
  run,
  fixture,
  scopeKind,
  outputPath,
  { profile, splitMode },
) {
  const expected = expectedScopedExport(
    fixture,
    scopeKind,
    profile,
    splitMode,
    false,
  );
  await setEpubConfiguration(run, {
    profile,
    splitMode,
    includeCover: false,
    scopeNodeId: fixtureScopeNodeId(fixture, scopeKind),
  });
  const validation = await validateFromUi(run, expected);
  const exported = await runExportFromUi(run, outputPath, expected);
  return {
    scopeKind,
    profile,
    splitMode,
    validation,
    output: {
      byteLength: exported.byteLength,
      wallMs: exported.wallMs,
      structure: exported.structure,
      blockLoss: exported.blockLoss,
    },
  };
}

async function runNormalStateScenario({ fixture, projectPath, userDataPath, paths }) {
  const expectedPng = expectedExport(
    fixture,
    "EPUB_3_4_DRAFT_2026_08",
    "CHAPTER",
    true,
  );
  const run = await launchApplication({
    projectPath,
    userDataPath,
    dialogPlan: {
      coverPaths: [paths.pngCover, paths.jpegCover],
      epubPaths: [paths.pngExport],
      jsonReportPaths: [paths.pngReport],
      markdownReportPaths: [],
    },
  });
  try {
    reportStage("normal-state-open");
    await openProject(run);
    await enterEpubExport(run);
    const invalidMetadata = await exerciseInvalidMetadataGate(run);
    await fillMetadata(run, creatorName);
    await saveMetadata(run);
    reportStage("normal-state-cover-png-select");
    await chooseCoverAndWait(run, "image/png");
    reportStage("normal-state-cover-png-config");
    await setEpubConfiguration(run, {
      profile: expectedPng.profile,
      splitMode: expectedPng.splitMode,
      includeCover: expectedPng.coverIncluded,
      scopeNodeId: fixture.ids.workId,
    });
    reportStage("normal-state-cover-png-export");
    const pngExport = await runExportFromUi(run, paths.pngExport, expectedPng);
    reportStage("normal-state-cover-png-report");
    const pngReport = await saveJsonReport(run, paths.pngReport, expectedPng);
    verify(pngReport.raw.epubSha256 === pngExport.sha256, "phase1g-png-report-output-hash");
    reportStage("normal-state-cover-remove");
    await removeCoverAndWait(run);
    reportStage("normal-state-cover-jpeg-select");
    await chooseCoverAndWait(run, "image/jpeg");
    reportStage("normal-state-cover-jpeg-config");
    await setEpubConfiguration(run, {
      profile: "EPUB_3_4_DRAFT_2026_08",
      splitMode: "CHAPTER",
      includeCover: true,
      scopeNodeId: fixture.ids.workId,
    });
    reportStage("normal-state-preset-crud");
    const presetCrud = await exercisePresetCrud(run);
    reportStage("normal-state-snapshot-create");
    const snapshot = await createEpubSnapshot(run);
    reportStage("normal-state-snapshot-mutate-metadata-fill");
    const mutatedCreatorControl = epubWorkspace(run).getByLabel("작가", {
      exact: true,
    });
    await waitForControlReady(
      run,
      mutatedCreatorControl,
      "phase1g-snapshot-mutated-creator-ready",
    );
    await mutatedCreatorControl.fill(mutatedCreatorName);
    reportStage("normal-state-snapshot-mutate-metadata-save");
    await saveMetadata(run);
    reportStage("normal-state-snapshot-mutate-cover-remove");
    await removeCoverAndWait(run);
    reportStage("normal-state-snapshot-mutate-preset-create");
    await createMutationPreset(run);
    reportStage("normal-state-snapshot-mutate-inspect");
    const mutated = await inspectCanonicalExportState(run);
    verify(!mutated.matchesExpected, "phase1g-snapshot-mutation-not-observed");
    reportStage("normal-state-snapshot-restore");
    const snapshotRestore = await restoreEpubSnapshot(run, snapshot);
    reportStage("normal-state-snapshot-restore-complete");
    await run.page.screenshot({ path: normalScreenshotPath, fullPage: true });
    reportStage("normal-state-dialog-contract");
    const dialogs = await dialogEvidence(run);
    verify(
      dialogs?.calls.projectOpen === 1 &&
        dialogs.calls.coverOpen === 2 &&
        dialogs.calls.epubSave === 1 &&
        dialogs.calls.epubOverwriteConfirmationConfigured === 1 &&
        dialogs.calls.jsonReportSave === 1 &&
        dialogs.calls.reportOverwriteConfirmationConfigured === 1 &&
        dialogs.remaining.cover === 0 &&
        dialogs.remaining.epub === 0 &&
        dialogs.remaining.jsonReport === 0,
      "phase1g-state-dialog-contract",
    );
    const preCloseStagingDirectories = (
      await readdir(dirname(paths.pngExport), { withFileTypes: true })
    ).filter(
      (entry) =>
        entry.isDirectory() &&
        (entry.name.startsWith(".madi-epub-operation-") ||
          entry.name.startsWith(".madi-epub-report-")),
    );
    verify(
      preCloseStagingDirectories.length === 0,
      "phase1g-pre-close-staging-clean",
      { count: preCloseStagingDirectories.length },
    );
    reportStage("normal-state-lifecycle-close");
    const lifecycle = await closeWindowCleanly(run);
    reportStage("normal-state-security-gate");
    const security = securityEvidence(run);
    assertSecurity(security);
    return {
      fixture: fixtureEvidence(fixture),
      lazyModeLoaded: true,
      invalidMetadata,
      coverCrud: {
        pngAccepted: true,
        pngExported: true,
        pngStructure: pngExport.structure,
        pngReport: pngReport.evidence,
        removed: true,
        jpegAccepted: true,
      },
      presetCrud,
      snapshot: snapshotRestore,
      lifecycle,
      security,
      dialogs,
    };
  } catch (error) {
    lastFailureContext = await captureRunFailureContext(run);
    throw error;
  } finally {
    if (!run.closed) {
      await forceCloseApplication(run.application, run.processMonitor);
    }
  }
}

async function runNormalExportScenario({ fixture, projectPath, userDataPath, paths }) {
  const expected34 = expectedExport(
    fixture,
    "EPUB_3_4_DRAFT_2026_08",
    "CHAPTER",
    true,
  );
  const expected33 = expectedExport(
    fixture,
    "EPUB_3_3_COMPATIBILITY",
    "SCENE",
    false,
  );
  const overwriteSentinel = Buffer.from("phase1g-confirmed-overwrite", "utf8");
  await writeFile(paths.overwrite34, overwriteSentinel, { flag: "wx", mode: 0o600 });
  const run = await launchApplication({
    projectPath,
    userDataPath,
    dialogPlan: {
      coverPaths: [],
      epubPaths: [
        paths.normal34,
        paths.overwrite34,
        paths.noClobber,
        paths.cancelled,
        paths.normal33,
        paths.volumeScope,
        paths.chapterScope,
        paths.sceneScope,
      ],
      jsonReportPaths: [paths.normal34Report, paths.normal33Report],
      markdownReportPaths: [paths.normal33Markdown],
    },
  });
  try {
    reportStage("normal-export-reopen");
    await openProject(run);
    await enterEpubExport(run);
    const reopenedState = await inspectCanonicalExportState(run);
    verify(reopenedState.matchesExpected, "phase1g-reopen-canonical-state");
    await setEpubConfiguration(run, {
      profile: expected34.profile,
      splitMode: expected34.splitMode,
      includeCover: expected34.coverIncluded,
      scopeNodeId: fixture.ids.workId,
    });
    reportStage("normal-export-34-validate");
    const validation34 = await validateFromUi(run, expected34);
    reportStage("normal-export-34");
    const first34 = await runExportFromUi(run, paths.normal34, expected34);
    const report34 = await saveJsonReport(run, paths.normal34Report, expected34);
    verify(report34.raw.epubSha256 === first34.sha256, "phase1g-report-output-hash-34");
    verify(report34.raw.byteLength === first34.byteLength, "phase1g-report-output-size-34");
    verify(
      report34.raw.timing.internalValidationMs <= 5_000,
      "phase1g-normal-internal-validation-budget",
      { milliseconds: roundMilliseconds(report34.raw.timing.internalValidationMs) },
    );
    reportStage("normal-export-overwrite");
    const overwritten34 = await runExportFromUi(run, paths.overwrite34, expected34);
    verify(
      !(await readFile(paths.overwrite34)).equals(overwriteSentinel),
      "phase1g-overwrite-not-replaced",
    );
    verify(first34.sha256 === overwritten34.sha256, "phase1g-byte-determinism");
    verify(first34.byteLength === overwritten34.byteLength, "phase1g-byte-determinism-size");
    reportStage("normal-export-no-clobber");
    const noClobber = await exerciseNoClobber(run, paths.noClobber, expected34);
    reportStage("normal-export-cancel");
    const cancellation = await exerciseCancel(run, paths.cancelled);
    await setEpubConfiguration(run, {
      profile: expected33.profile,
      splitMode: expected33.splitMode,
      includeCover: expected33.coverIncluded,
      scopeNodeId: fixture.ids.workId,
    });
    reportStage("normal-export-33-validate");
    const validation33 = await validateFromUi(run, expected33);
    reportStage("normal-export-33");
    const export33 = await runExportFromUi(run, paths.normal33, expected33);
    const report33 = await saveJsonReport(run, paths.normal33Report, expected33);
    verify(report33.raw.epubSha256 === export33.sha256, "phase1g-report-output-hash-33");
    const markdown = await saveMarkdownReport(
      run,
      paths.normal33Markdown,
      report33.raw,
    );
    const reveal = await revealExport(run);
    await copyFile(paths.normal33, representativeEpubPath);
    const representativeHash = await sha256File(representativeEpubPath);
    verify(representativeHash === export33.sha256, "phase1g-representative-copy-hash");
    reportStage("normal-export-volume-scope");
    const volumeScope = await runBoundedScopeExercise(
      run,
      fixture,
      "VOLUME",
      paths.volumeScope,
      {
        profile: "EPUB_3_4_DRAFT_2026_08",
        splitMode: "CHAPTER",
      },
    );
    reportStage("normal-export-chapter-scope");
    const chapterScope = await runBoundedScopeExercise(
      run,
      fixture,
      "CHAPTER",
      paths.chapterScope,
      {
        profile: "EPUB_3_3_COMPATIBILITY",
        splitMode: "SCENE",
      },
    );
    reportStage("normal-export-scene-scope");
    const sceneScope = await runBoundedScopeExercise(
      run,
      fixture,
      "SCENE",
      paths.sceneScope,
      {
        profile: "EPUB_3_4_DRAFT_2026_08",
        splitMode: "SCENE",
      },
    );
    await run.page.screenshot({ path: normalScreenshotPath, fullPage: true });
    const dialogs = await dialogEvidence(run);
    verify(
      dialogs?.calls.projectOpen === 1 &&
        dialogs.calls.epubSave === 8 &&
        dialogs.calls.epubOverwriteConfirmationConfigured === 8 &&
        dialogs.calls.jsonReportSave === 2 &&
        dialogs.calls.markdownReportSave === 1 &&
        dialogs.calls.reportOverwriteConfirmationConfigured === 3 &&
        dialogs.calls.reveal === 1 &&
        dialogs.remaining.epub === 0 &&
        dialogs.remaining.jsonReport === 0 &&
        dialogs.remaining.markdownReport === 0,
      "phase1g-export-dialog-contract",
    );
    const lifecycle = await closeWindowCleanly(run);
    const security = securityEvidence(run);
    assertSecurity(security);
    return {
      reopenedState,
      profiles: {
        epub34Draft: {
          validation: validation34,
          first: {
            wallMs: first34.wallMs,
            byteLength: first34.byteLength,
            memory: first34.memory,
            responsiveness: first34.responsiveness,
            structure: first34.structure,
            report: report34.evidence,
          },
          confirmedOverwrite: {
            replacementSucceeded: true,
            destinationIdentityChanged: true,
            byteDeterministic: first34.sha256 === overwritten34.sha256,
            logicalDeterministic: true,
            structure: overwritten34.structure,
          },
          noClobber,
          cancellation,
        },
        epub33Compatibility: {
          validation: validation33,
          export: {
            wallMs: export33.wallMs,
            byteLength: export33.byteLength,
            memory: export33.memory,
            responsiveness: export33.responsiveness,
            structure: export33.structure,
            report: report33.evidence,
          },
          markdown,
          reveal,
        },
      },
      scopes: {
        work: {
          profile34Chapter: true,
          profile33Scene: true,
          sectionCount: fixture.scopes.WORK.sections,
          blockCount: fixture.scopes.WORK.blocks,
          characterCount: fixture.scopes.WORK.withSpaces,
        },
        volume: volumeScope,
        chapter: chapterScope,
        scene: sceneScope,
      },
      representativeArtifact: {
        retained: true,
        hashMatched: true,
        profile: expected33.profile,
      },
      lifecycle,
      security,
      dialogs,
    };
  } catch (error) {
    lastFailureContext = await captureRunFailureContext(run);
    throw error;
  } finally {
    if (!run.closed) {
      await forceCloseApplication(run.application, run.processMonitor);
    }
  }
}

async function runLongExportScenario({ fixture, projectPath, userDataPath, paths }) {
  const expected = expectedExport(
    fixture,
    "EPUB_3_4_DRAFT_2026_08",
    "CHAPTER",
    false,
  );
  const run = await launchApplication({
    projectPath,
    userDataPath,
    dialogPlan: {
      coverPaths: [],
      epubPaths: paths.outputs,
      jsonReportPaths: paths.reports,
      markdownReportPaths: [],
    },
  });
  try {
    reportStage("long-export-open");
    await openProject(run);
    await enterEpubExport(run);
    await fillMetadata(run, creatorName);
    await saveMetadata(run);
    await setEpubConfiguration(run, {
      profile: expected.profile,
      splitMode: expected.splitMode,
      includeCover: expected.coverIncluded,
      scopeNodeId: fixture.ids.workId,
    });
    const validation = await validateFromUi(run, expected);
    const exports = [];
    const reports = [];
    for (let index = 0; index < measurementRuns; index += 1) {
      reportStage(`long-export-run-${index + 1}`);
      const exported = await runExportFromUi(run, paths.outputs[index], expected);
      const report = await saveJsonReport(run, paths.reports[index], expected);
      verify(report.raw.epubSha256 === exported.sha256, "phase1g-long-report-output-hash", {
        run: index + 1,
      });
      if (packaged) {
        verify(
          report.raw.timing.totalMs <= LONG_EXPORT_PROVISIONAL_TARGET_MS,
          "phase1g-long-export-provisional-target",
          {
            run: index + 1,
            milliseconds: report.raw.timing.totalMs,
            targetMilliseconds: LONG_EXPORT_PROVISIONAL_TARGET_MS,
          },
        );
      }
      exports.push(exported);
      reports.push(report);
    }
    const firstHash = exports[0].sha256;
    const firstLogicalHash = reports[0].raw.logicalPackageHash;
    verify(exports.every((entry) => entry.sha256 === firstHash), "phase1g-long-byte-determinism");
    verify(
      reports.every((entry) => entry.raw.logicalPackageHash === firstLogicalHash),
      "phase1g-long-logical-determinism",
    );
    await run.page.screenshot({ path: longScreenshotPath, fullPage: true });
    const dialogs = await dialogEvidence(run);
    verify(
      dialogs?.calls.projectOpen === 1 &&
        dialogs.calls.epubSave === measurementRuns &&
        dialogs.calls.epubOverwriteConfirmationConfigured === measurementRuns &&
        dialogs.calls.jsonReportSave === measurementRuns &&
        dialogs.calls.reportOverwriteConfirmationConfigured === measurementRuns &&
        dialogs.remaining.epub === 0 &&
        dialogs.remaining.jsonReport === 0,
      "phase1g-long-dialog-contract",
    );
    const lifecycle = await closeWindowCleanly(run);
    const security = securityEvidence(run);
    assertSecurity(security);
    const wallSamples = exports.map((entry) => entry.wallMs);
    const splitSamples = reports.map((entry) => entry.raw.timing.splitMs);
    const xhtmlSamples = reports.map((entry) => entry.raw.timing.xhtmlMs);
    const navigationSamples = reports.map(
      (entry) => entry.raw.timing.navigationMs,
    );
    const packageSamples = reports.map((entry) => entry.raw.timing.packageMs);
    const internalValidationSamples = reports.map(
      (entry) => entry.raw.timing.internalValidationMs,
    );
    const exporterTotalSamples = reports.map((entry) => entry.raw.timing.totalMs);
    const provisionalTargetMetByRun = exporterTotalSamples.map(
      (milliseconds) => milliseconds <= LONG_EXPORT_PROVISIONAL_TARGET_MS,
    );
    const frameGapSamples = exports.map(
      (entry) => entry.responsiveness.maximumFrameGapMs,
    );
    const heartbeatGapSamples = exports.map(
      (entry) => entry.responsiveness.maximumHeartbeatGapMs,
    );
    const memorySamples = exports.map((entry) => entry.memory);
    const availableMemory = memorySamples.filter((entry) => entry.available);
    return {
      fixture: fixtureEvidence(fixture),
      validation,
      performance: {
        wall: summarizeMeasurements(wallSamples),
        publicationIrCompile: fixtureEvidence(fixture).publicationIrCompile,
        contentSplit: summarizeMeasurements(splitSamples),
        xhtmlGeneration: summarizeMeasurements(xhtmlSamples),
        opfAndNavigation: summarizeMeasurements(navigationSamples),
        zipPackaging: summarizeMeasurements(packageSamples),
        internalValidation: summarizeMeasurements(internalValidationSamples),
        exporterTotal: summarizeMeasurements(exporterTotalSamples),
        provisionalLongExportTarget: {
          buildMode: packaged ? "PACKAGED" : "DEVELOPMENT",
          metric: "EXPORTER_TOTAL",
          targetMs: LONG_EXPORT_PROVISIONAL_TARGET_MS,
          hardGateApplied: packaged,
          targetMet: provisionalTargetMetByRun.every(Boolean),
          targetMetByRun: provisionalTargetMetByRun,
        },
        maximumFrameGap: summarizeMeasurements(frameGapSamples),
        maximumHeartbeatGap: summarizeMeasurements(heartbeatGapSamples),
        approximateProcessMemory: {
          availableRuns: availableMemory.length,
          maximumWorkingSetBytes:
            availableMemory.length > 0
              ? Math.max(...availableMemory.map((entry) => entry.workingSetBytes))
              : null,
          maximumPrivateBytes:
            availableMemory.length > 0
              ? Math.max(...availableMemory.map((entry) => entry.privateBytes))
              : null,
          maximumProcessCount:
            availableMemory.length > 0
              ? Math.max(...availableMemory.map((entry) => entry.processCount))
              : null,
        },
      },
      coverage: reports[0].evidence.coverage,
      structure: exports[0].structure,
      output: {
        byteLength: exports[0].byteLength,
        byteDeterministicAcrossRuns: true,
        logicalDeterministicAcrossRuns: true,
      },
      lifecycle,
      security,
      dialogs,
    };
  } catch (error) {
    lastFailureContext = await captureRunFailureContext(run);
    throw error;
  } finally {
    if (!run.closed) {
      await forceCloseApplication(run.application, run.processMonitor);
    }
  }
}

async function removeKnownArtifact(filePath) {
  verify(isWithin(filePath, artifactDirectory), "phase1g-artifact-remove-scope");
  try {
    const entry = await lstat(filePath);
    verify(entry.isFile() && !entry.isSymbolicLink(), "phase1g-artifact-remove-type");
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function aggregateSecurity(runs) {
  return {
    externalRequestCount: runs.reduce(
      (total, run) => total + run.externalRequestCount,
      0,
    ),
    externalWebSocketCount: runs.reduce(
      (total, run) => total + run.externalWebSocketCount,
      0,
    ),
    pageErrorCount: runs.reduce((total, run) => total + run.pageErrors.length, 0),
    rendererDiagnosticCount: runs.reduce(
      (total, run) => total + run.rendererDiagnostics.length,
      0,
    ),
    mainProcessDiagnosticCount: runs.reduce(
      (total, run) => total + run.mainProcessDiagnostics.length,
      0,
    ),
    childStderrDiagnosticCount: runs.reduce(
      (total, run) => total + run.childStderrDiagnostics.length,
      0,
    ),
    combinedUnexpectedDiagnosticCount: runs.reduce(
      (total, run) => total + run.unexpectedDiagnosticCount,
      0,
    ),
    diagnosticPrivateContentDetected: runs.some(
      (run) => run.privateContentDetected,
    ),
    diagnosticRawPathOrUrlDetected: runs.some(
      (run) => run.rawPathOrUrlDetected,
    ),
    allLocalFileProbesBlocked: runs.every((run) => run.localFileBlocked),
    allMadiProtocol: runs.every((run) => run.runtime.rendererProtocol === "madi:"),
    packagedDevelopmentOverridesBlocked: packaged,
  };
}

async function main() {
  const startedAt = performance.now();
  reportStage("preflight");
  await mkdir(artifactDirectory, { recursive: true });
  for (const artifact of [
    evidencePath,
    representativeEpubPath,
    normalScreenshotPath,
    longScreenshotPath,
  ]) {
    await removeKnownArtifact(artifact);
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  validateFixtureManifest(manifest);
  const baselineGlobalArtifacts = await listGlobalEpubTempArtifacts();
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "madi-phase1g-"));
  let cleanupEvidence = null;
  try {
    const normalPrepared = await prepareFixture("normal", manifest, temporaryRoot);
    const longPrepared = await prepareFixture("long", manifest, temporaryRoot);
    const pngCover = resolve(temporaryRoot, "cover.png");
    const jpegCover = resolve(temporaryRoot, "cover.jpeg");
    const pngCoverBytes = createPngCover();
    const jpegCoverBytes = createJpegCover();
    await writeFile(pngCover, pngCoverBytes, { flag: "wx", mode: 0o600 });
    await writeFile(jpegCover, jpegCoverBytes, { flag: "wx", mode: 0o600 });
    const normalPaths = {
      pngCover,
      jpegCover,
      pngExport: resolve(temporaryRoot, "normal-png-cover.epub"),
      pngReport: resolve(temporaryRoot, "normal-png-cover-report.json"),
      normal34: resolve(temporaryRoot, "normal-34.epub"),
      overwrite34: resolve(temporaryRoot, "normal-34-overwrite.epub"),
      noClobber: resolve(temporaryRoot, "normal-no-clobber.epub"),
      cancelled: resolve(temporaryRoot, "normal-cancelled.epub"),
      normal33: resolve(temporaryRoot, "normal-33.epub"),
      volumeScope: resolve(temporaryRoot, "normal-volume-scope.epub"),
      chapterScope: resolve(temporaryRoot, "normal-chapter-scope.epub"),
      sceneScope: resolve(temporaryRoot, "normal-scene-scope.epub"),
      normal34Report: resolve(temporaryRoot, "normal-34-report.json"),
      normal33Report: resolve(temporaryRoot, "normal-33-report.json"),
      normal33Markdown: resolve(temporaryRoot, "normal-33-report.md"),
    };
    const longPaths = {
      outputs: Array.from({ length: measurementRuns }, (_unused, index) =>
        resolve(temporaryRoot, `long-${index + 1}.epub`),
      ),
      reports: Array.from({ length: measurementRuns }, (_unused, index) =>
        resolve(temporaryRoot, `long-${index + 1}-report.json`),
      ),
    };
    for (const filePath of [
      ...Object.values(normalPaths),
      ...longPaths.outputs,
      ...longPaths.reports,
    ]) {
      verify(isWithin(filePath, temporaryRoot), "phase1g-operation-path-scope");
    }

    const normalState = await runNormalStateScenario({
      ...normalPrepared,
      userDataPath: resolve(temporaryRoot, "normal-state-user-data"),
      paths: normalPaths,
    });
    await removeCoverSource(pngCover, temporaryRoot);
    await removeCoverSource(jpegCover, temporaryRoot);
    const normalExport = await runNormalExportScenario({
      ...normalPrepared,
      userDataPath: resolve(temporaryRoot, "normal-export-user-data"),
      paths: normalPaths,
    });
    const projectInspection = inspectProjectWithCore(normalPrepared.projectPath);
    const coverPersistence = await proveEmbeddedCoverPersistence(
      normalPrepared.projectPath,
      [pngCover, jpegCover],
      jpegCoverBytes,
    );
    normalState.coverCrud.persistence = coverPersistence;
    reportStage("actual-madi-epubcheck-33");
    const actualEpubCheck = await validateActualRepresentativeWithEpubCheck(
      representativeEpubPath,
    );
    normalExport.representativeArtifact.epubCheck = actualEpubCheck;
    const longExport = await runLongExportScenario({
      ...longPrepared,
      userDataPath: resolve(temporaryRoot, "long-export-user-data"),
      paths: longPaths,
    });
    cleanupEvidence = await validateCleanupState(
      temporaryRoot,
      baselineGlobalArtifacts,
      [normalState.lifecycle, normalExport.lifecycle, longExport.lifecycle],
    );
    const security = aggregateSecurity([
      normalState.security,
      normalExport.security,
      longExport.security,
    ]);
    verify(security.externalRequestCount === 0, "phase1g-aggregate-external-request");
    verify(security.externalWebSocketCount === 0, "phase1g-aggregate-external-websocket");
    verify(security.pageErrorCount === 0, "phase1g-aggregate-page-error");
    verify(
      security.rendererDiagnosticCount === 0,
      "phase1g-aggregate-renderer-diagnostic",
    );
    verify(
      security.mainProcessDiagnosticCount === 0 &&
        security.childStderrDiagnosticCount === 0 &&
        security.combinedUnexpectedDiagnosticCount === 0,
      "phase1g-aggregate-main-child-diagnostic",
      {
        mainProcessDiagnosticCount: security.mainProcessDiagnosticCount,
        childStderrDiagnosticCount: security.childStderrDiagnosticCount,
        combinedUnexpectedDiagnosticCount:
          security.combinedUnexpectedDiagnosticCount,
      },
    );
    verify(
      !security.diagnosticPrivateContentDetected &&
        !security.diagnosticRawPathOrUrlDetected,
      "phase1g-aggregate-diagnostic-privacy",
    );
    verify(security.allLocalFileProbesBlocked, "phase1g-aggregate-file-probe");
    const evidence = {
      status: "PASS",
      phase: "1G",
      packaged,
      evidenceSchemaVersion: 1,
      sourceFixtureFormatVersion: manifest.formatVersion,
      projectSchemaVersion: projectInspection.schemaVersion,
      logicalFormatVersion: projectInspection.logicalFormatVersion,
      projectInspection,
      snapshotPayloadVersion: normalState.snapshot.payloadVersion,
      measurementRuns,
      elapsedMs: roundMilliseconds(performance.now() - startedAt),
      normalState,
      normalExport,
      longExport,
      cleanup: cleanupEvidence,
      security,
      runtimeEpubCheck: {
        packaged: false,
        status: actualEpubCheck.status,
        version: actualEpubCheck.version,
        targetProfile: actualEpubCheck.targetProfile,
        elapsedMs: actualEpubCheck.elapsedMs,
        fatalCount: actualEpubCheck.fatalCount,
        errorCount: actualEpubCheck.errorCount,
        retainedArtifactLinked: actualEpubCheck.retainedArtifactHashMatched,
        externalServerUsed: false,
        automaticDownloadUsed: false,
      },
    };
    assertEvidencePrivacy(evidence);
    await writeJsonAtomically(evidencePath, evidence);
    reportStage("pass");
  } finally {
    try {
      await removeTemporaryRoot(temporaryRoot);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLocaleLowerCase() : "";
      lastFailureContext = {
        rendererAvailable: false,
        cleanup: {
          ...summarizeError(error),
          resourceBusy: message.includes("ebusy") || message.includes("resource busy"),
          accessDenied: message.includes("eperm") || message.includes("access is denied"),
          directoryNotEmpty: message.includes("enotempty"),
          priorCleanupGatePassed: cleanupEvidence?.newGlobalArtifactCount === 0,
        },
      };
      throw error;
    }
  }
}

try {
  await main();
} catch (error) {
  const failure = {
    status: "FAIL",
    phase: "1G",
    packaged,
    stage: currentStage,
    error: summarizeError(error),
    context: lastFailureContext ?? { rendererAvailable: false },
  };
  try {
    assertEvidencePrivacy(failure);
    await mkdir(artifactDirectory, { recursive: true });
    await writeJsonAtomically(evidencePath, failure);
  } catch {
    // The fallback intentionally emits no error message, manuscript, path, or URL.
  }
  process.stderr.write(
    `[electron-phase1g] failed ${JSON.stringify(summarizeError(error))}\n`,
  );
  process.exitCode = 1;
}
