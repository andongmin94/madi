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
const hwpxExporterBinary = resolve(
  repositoryRoot,
  "crates",
  "madi-export-hwpx",
  "target",
  "debug",
  `madi-export-hwpx${executableSuffix}`,
);
const hwpBridgeBinary = resolve(
  repositoryRoot,
  "sidecars",
  "hwp-bridge",
  "bin",
  "Debug",
  "net10.0-windows",
  "win-x86",
  `madi-hwp-bridge${executableSuffix}`,
);
const atomicOutputBinary = resolve(
  repositoryRoot,
  "crates",
  "madi-atomic-output",
  "target",
  "debug",
  `madi-atomic-output${executableSuffix}`,
);
const manifestPath = resolve(
  process.env.MADI_PHASE1H_MANIFEST?.trim() ||
    resolve(repositoryRoot, "output", "test-fixtures", "phase1f-reader-fixtures.json"),
);
const artifactDirectory = resolve(repositoryRoot, "output", "playwright");
const artifactPrefix = packaged
  ? "madi-packaged-phase1h"
  : "madi-electron-phase1h";
const evidencePath = resolve(artifactDirectory, `${artifactPrefix}-evidence.json`);
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
const NORMAL_EXPORT_HARD_TARGET_MS = 5_000;
const LONG_EXPORT_HARD_TARGET_MS = 15_000;
const LONG_FIXTURE_MINIMUM_SCENES = 450;
const LONG_FIXTURE_MINIMUM_CHARACTERS = 675_000;
const LONG_FIXTURE_MINIMUM_BLOCKS = 2_400;
const snapshotName = "Phase 1H HWPX actual checkpoint";
const presetName = "Phase 1H actual preset";
const updatedPresetName = "Phase 1H actual preset updated";
const mutationPresetName = "Phase 1H mutation preset";
const privateContact = "private-phase1h-contact@example.invalid";
const rubyFallbackText = "(루비)";
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
  privateContact,
  ...manuscriptSentinels,
];
const mainLifecycleMarkers = Object.freeze({
  beforeQuit: "[madi-phase1h-main] before-quit",
  willQuit: "[madi-phase1h-main] will-quit",
  willQuitPrevented: "[madi-phase1h-main] will-quit-prevented",
  quit: "[madi-phase1h-main] quit",
  windowAllClosed: "[madi-phase1h-main] window-all-closed",
});
const mainLifecycleEventsByMarker = new Map(
  Object.entries(mainLifecycleMarkers).map(([event, marker]) => [marker, event]),
);
let currentStage = "startup";
let lastFailureContext = null;

function reportStage(stage) {
  currentStage = stage;
  process.stderr.write(`[electron-phase1h] ${stage}\n`);
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
  const failureCode = error.message.match(/^(phase1h-[a-z0-9-]+)/u)?.[1] ?? null;
  let failureDetails = null;
  if (failureCode === "phase1h-owned-tcp-boundary") {
    try {
      const parsed = JSON.parse(error.message.slice(error.message.indexOf(":") + 1));
      if (hasPrivacySafeOwnedTcpBoundaryFailureDetails(parsed)) {
        failureDetails = parsed;
      }
    } catch {
      failureDetails = null;
    }
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
    "assertHancomState",
    "closeGlobalPanel",
    "closeWindowCleanly",
    "completeSuccessfulExport",
    "createHwpxSnapshot",
    "createMutationPreset",
    "exerciseCancel",
    "exerciseNoClobber",
    "exercisePresetCrud",
    "restoreHwpxSnapshot",
    "runExportFromUi",
    "runLongExportScenario",
    "runNormalExportScenario",
    "runNormalStateScenario",
    "validateExportReport",
    "validateGeneratedHwpx",
  ]);
  const harnessStackFrames =
    error.stack
    ?.split(/\r?\n/gu)
    .map((frame) => {
      const location = frame.match(/electron-phase1h-smoke\.mjs:(\d+):(\d+)/u);
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
    failureCode,
    failureDetails,
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
  verify(samples.length > 0, "phase1h-measurement-samples-empty");
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
  verify(leakedFragmentIndexes.length === 0, "phase1h-evidence-private-content", {
    leakedFragmentIndexes,
  });
  verify(
    !/[A-Za-z]:\\|file:\/\/|https?:\/\/|wss?:\/\//u.test(serialized),
    "phase1h-evidence-path-or-url",
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
  let committed = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, filePath);
    committed = true;
  } finally {
    if (!committed) {
      await unlink(temporaryPath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    }
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

function findEndOfCentralDirectory(bytes) {
  const minimumOffset = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x0605_4b50) {
      return offset;
    }
  }
  throw new Error("phase1h-zip-eocd-missing");
}

function validateZipPath(entryPath) {
  verify(entryPath.length > 0 && entryPath.length <= 512, "phase1h-zip-path-length");
  verify(!entryPath.includes("\\") && !entryPath.includes("\0"), "phase1h-zip-path-slash");
  verify(!entryPath.startsWith("/") && !/^[A-Za-z]:/u.test(entryPath), "phase1h-zip-path-absolute");
  const components = entryPath.split("/");
  verify(
    components.every(
      (component) => component.length > 0 && component !== "." && component !== "..",
    ),
    "phase1h-zip-path-traversal",
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
  verify(disk === 0 && centralDisk === 0, "phase1h-zip-multidisk");
  verify(diskEntries === totalEntries, "phase1h-zip-entry-count-disk");
  verify(totalEntries > 0 && totalEntries <= MAX_ZIP_ENTRIES, "phase1h-zip-entry-count");
  verify(eocd + 22 + commentLength === bytes.length, "phase1h-zip-terminal-bytes");
  verify(centralOffset + centralSize === eocd, "phase1h-zip-central-range");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries = [];
  const byPath = new Map();
  let centralCursor = centralOffset;
  let totalUncompressedBytes = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    verify(
      centralCursor + 46 <= eocd && bytes.readUInt32LE(centralCursor) === 0x0201_4b50,
      "phase1h-zip-central-entry",
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
    verify(centralEnd <= eocd, "phase1h-zip-central-entry-range");
    verify((flags & 0x0001) === 0, "phase1h-zip-encrypted-entry");
    verify(compression === 0 || compression === 8, "phase1h-zip-compression-method");
    verify(
      uncompressedBytes <= MAX_ZIP_ENTRY_BYTES,
      "phase1h-zip-entry-uncompressed-limit",
    );
    totalUncompressedBytes += uncompressedBytes;
    verify(totalUncompressedBytes <= MAX_ZIP_TOTAL_BYTES, "phase1h-zip-total-limit");
    const entryPath = decoder.decode(
      bytes.subarray(centralCursor + 46, centralCursor + 46 + nameLength),
    );
    validateZipPath(entryPath);
    verify(!byPath.has(entryPath), "phase1h-zip-duplicate-path");
    verify(
      localOffset + 30 <= centralOffset && bytes.readUInt32LE(localOffset) === 0x0403_4b50,
      "phase1h-zip-local-entry",
    );
    const localFlags = bytes.readUInt16LE(localOffset + 6);
    const localCompression = bytes.readUInt16LE(localOffset + 8);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const localNameStart = localOffset + 30;
    const dataStart = localNameStart + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedBytes;
    verify(dataEnd <= centralOffset, "phase1h-zip-local-data-range");
    verify(localFlags === flags && localCompression === compression, "phase1h-zip-local-contract");
    const localPath = decoder.decode(
      bytes.subarray(localNameStart, localNameStart + localNameLength),
    );
    verify(localPath === entryPath, "phase1h-zip-local-path-mismatch");
    const compressed = bytes.subarray(dataStart, dataEnd);
    const content = compression === 0 ? Buffer.from(compressed) : inflateRawSync(compressed);
    verify(content.length === uncompressedBytes, "phase1h-zip-entry-size");
    verify(crc32(content) === expectedCrc, "phase1h-zip-entry-crc");
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
  verify(centralCursor === eocd, "phase1h-zip-central-size");
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

function decodeXmlForLocalPathScan(value) {
  return decodeXmlAttribute(value).replace(
    /&#(?:x([0-9a-f]+)|(\d+));/giu,
    (entity, hexadecimal, decimal) => {
      const codePoint = Number.parseInt(hexadecimal ?? decimal, hexadecimal ? 16 : 10);
      return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    },
  );
}

function localPathFragmentVariants(fragments) {
  return [
    ...new Set(
      fragments.flatMap((fragment) => {
        if (typeof fragment !== "string" || fragment.length === 0) {
          return [];
        }
        return [
          fragment,
          fragment.replaceAll("\\", "/"),
          fragment.replaceAll("/", "\\"),
        ].map((variant) => variant.toLocaleLowerCase());
      }),
    ),
  ];
}

function assertNoLocalPathsInXml(xmlByPath, forbiddenFragments) {
  const localAbsolutePathPattern =
    /(?:file:\/\/|(?:^|[\s="'(>])(?:[a-z]:[\\/]|\\\\[^\\/\s<>"']+[\\/][^\\/\s<>"']+|\/\/[^/\s<>"']+\/[^/\s<>"']+))/iu;
  verify(
    Array.isArray(forbiddenFragments) && forbiddenFragments.length > 0,
    "phase1h-hwpx-local-path-fragment-contract",
  );
  const variants = localPathFragmentVariants(forbiddenFragments);
  for (const [path, xml] of xmlByPath) {
    const decoded = decodeXmlForLocalPathScan(xml);
    const lowerDecoded = decoded.toLocaleLowerCase();
    const absolutePathDetected = localAbsolutePathPattern.test(decoded);
    const forbiddenFragmentIndexes = variants.flatMap((fragment, index) =>
      lowerDecoded.includes(fragment) ? [index] : [],
    );
    verify(
      !absolutePathDetected && forbiddenFragmentIndexes.length === 0,
      "phase1h-hwpx-xml-local-path-absence",
      {
        entry: structuralHash(path),
        absolutePathDetected,
        forbiddenFragmentIndexes,
      },
    );
  }
  return {
    scannedXmlEntryCount: xmlByPath.size,
    forbiddenFragmentVariantCount: variants.length,
    localAbsolutePathAbsent: true,
    forbiddenLocalFragmentsAbsent: true,
  };
}

function requireUtf8Entry(archive, entryPath) {
  const entry = archive.byPath.get(entryPath);
  verify(entry, "phase1h-zip-required-entry", { entry: structuralHash(entryPath) });
  return new TextDecoder("utf-8", { fatal: true }).decode(entry.content);
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

function assertProductProcessDiagnosticDelta(delta, code) {
  assertProcessDiagnosticDelta(delta, `${code}-shape`);
  verify(
    delta.unexpectedDiagnosticCount === 0 &&
      delta.mainProcessDiagnosticCount === 0 &&
      delta.childStderrDiagnosticCount === 0 &&
      !delta.privateContentDetected &&
      !delta.rawPathOrUrlDetected,
    code,
    delta,
  );
}

async function launchElectronWithProcessCapture(options, processDiagnostics) {
  const originalSpawn = childProcessModule.spawn;
  let capturedLaunchCount = 0;
  childProcessModule.spawn = function phase1hCapturedSpawn(
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
    verify(capturedLaunchCount === 1, "phase1h-child-process-stream-tap", {
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
  ["madi-export-hwpx", "EXPORTER"],
  ["madi-hwp-bridge", "BRIDGE"],
  ["madi-atomic-output", "ATOMIC_OUTPUT"],
  ["hwp", "HANCOM"],
]);
const spawnTappedSidecarRoles = [
  "CORE",
  "EXPORTER",
  "BRIDGE",
  "ATOMIC_OUTPUT",
];
const processRoleCountKeys = [
  "root",
  "electron",
  "core",
  "exporter",
  "bridge",
  "atomicOutput",
  "hancom",
];
const privacySafeProcessRoles = new Set([
  "ROOT",
  "ELECTRON",
  "CORE",
  "EXPORTER",
  "BRIDGE",
  "ATOMIC_OUTPUT",
  "HANCOM",
  "OTHER",
]);

const electronProcessSubtypes = new Set([
  "NONE",
  "MAIN",
  "NETWORK_SERVICE",
  "RENDERER",
  "GPU",
  "UTILITY",
  "CRASHPAD",
  "OTHER",
]);
const tcpStateClasses = [
  "LISTEN",
  "CONNECTING",
  "CONNECTED",
  "CLOSING",
  "UNKNOWN",
];
const tcpAddressClasses = [
  "UNSPECIFIED",
  "LOOPBACK",
  "PRIVATE",
  "LINK_LOCAL",
  "PUBLIC",
  "SPECIAL",
  "PARSE_ERROR",
];
const prohibitedTcpPeerAddressClasses = new Set([
  "PRIVATE",
  "LINK_LOCAL",
  "PUBLIC",
  "SPECIAL",
]);
const ownedTcpBoundaryFailureDetailKeys = [
  "peerViolationCount",
  "listenerViolationCount",
  "classificationFailureCount",
  "identityRaceCount",
  "parserRejectedRowCount",
  "roles",
  "monitorSampleCount",
  "ownedTcpRowObservationCount",
  "unownedTcpRowObservationCount",
  "ownedProcessInstanceCountsByRole",
  "ownedElectronSubtypeCounts",
  "tcpStateObservationCounts",
  "tcpPeerRemoteAddressClassObservationCounts",
  "tcpListenerLocalAddressClassObservationCounts",
  "tcpSamplesWithPeerByRemoteAddressClass",
  "tcpMaximumConcurrentPeersByRemoteAddressClass",
  "tcpDistinctOwnedProcessInstanceCountsByRemoteAddressClass",
  "tcpPeerRolesByRemoteAddressClass",
];

function powershellProcessHelpers() {
  return [
    String.raw`function Get-MadiPhase1hCreationDate([object]$phase1hProcess) { if ($null -eq $phase1hProcess.CreationDate) { return '' }; return $phase1hProcess.CreationDate.ToUniversalTime().Ticks.ToString([System.Globalization.CultureInfo]::InvariantCulture) }`,
    String.raw`function Get-MadiPhase1hElectronSubtype([object]$phase1hProcess) { $phase1hName = ([string]$phase1hProcess.Name).ToLowerInvariant(); if ($phase1hName -notin @('electron.exe', 'madi.exe')) { return 'NONE' }; $phase1hCommand = [string]$phase1hProcess.CommandLine; if ([string]::IsNullOrWhiteSpace($phase1hCommand)) { return 'OTHER' }; if ($phase1hCommand -match '(?i)--utility-sub-type=network\.mojom\.NetworkService') { return 'NETWORK_SERVICE' }; if ($phase1hCommand -match '(?i)--type=renderer') { return 'RENDERER' }; if ($phase1hCommand -match '(?i)--type=gpu-process') { return 'GPU' }; if ($phase1hCommand -match '(?i)--type=utility') { return 'UTILITY' }; if ($phase1hCommand -match '(?i)--type=crashpad-handler') { return 'CRASHPAD' }; if ($phase1hCommand -notmatch '(?i)--type=') { return 'MAIN' }; return 'OTHER' }`,
  ];
}

function powershellTcpHelpers() {
  return [
    String.raw`function Get-MadiPhase1hTcpStateClass([string]$phase1hState) { $phase1hNormalizedState = $phase1hState.ToUpperInvariant(); if ($phase1hNormalizedState -in @('LISTENING', 'BOUND')) { return 'LISTEN' }; if ($phase1hNormalizedState -in @('SYN_SENT', 'SYN_RECEIVED')) { return 'CONNECTING' }; if ($phase1hNormalizedState -eq 'ESTABLISHED') { return 'CONNECTED' }; if ($phase1hNormalizedState -in @('FIN_WAIT_1', 'FIN_WAIT_2', 'CLOSE_WAIT', 'CLOSING', 'LAST_ACK', 'TIME_WAIT', 'DELETE_TCB')) { return 'CLOSING' }; return 'UNKNOWN' }`,
    String.raw`function Get-MadiPhase1hEndpointAddress([string]$phase1hEndpoint) { if ([string]::IsNullOrWhiteSpace($phase1hEndpoint)) { return $null }; if ($phase1hEndpoint.StartsWith('[')) { $phase1hEndBracket = $phase1hEndpoint.IndexOf(']'); if ($phase1hEndBracket -le 1) { return $null }; $phase1hHost = $phase1hEndpoint.Substring(1, $phase1hEndBracket - 1) } else { $phase1hLastColon = $phase1hEndpoint.LastIndexOf(':'); if ($phase1hLastColon -le 0) { return $null }; $phase1hHost = $phase1hEndpoint.Substring(0, $phase1hLastColon) }; $phase1hAddress = $null; if (-not [System.Net.IPAddress]::TryParse($phase1hHost, [ref]$phase1hAddress)) { return $null }; if ($phase1hAddress.IsIPv4MappedToIPv6) { return $phase1hAddress.MapToIPv4() }; return $phase1hAddress }`,
    String.raw`function Get-MadiPhase1hAddressClass([System.Net.IPAddress]$phase1hAddress) { if ($null -eq $phase1hAddress) { return 'PARSE_ERROR' }; if ($phase1hAddress.Equals([System.Net.IPAddress]::Any) -or $phase1hAddress.Equals([System.Net.IPAddress]::IPv6Any)) { return 'UNSPECIFIED' }; if ([System.Net.IPAddress]::IsLoopback($phase1hAddress)) { return 'LOOPBACK' }; $phase1hBytes = $phase1hAddress.GetAddressBytes(); if ($phase1hAddress.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork) { if ($phase1hBytes[0] -eq 10 -or ($phase1hBytes[0] -eq 172 -and $phase1hBytes[1] -ge 16 -and $phase1hBytes[1] -le 31) -or ($phase1hBytes[0] -eq 192 -and $phase1hBytes[1] -eq 168)) { return 'PRIVATE' }; if ($phase1hBytes[0] -eq 169 -and $phase1hBytes[1] -eq 254) { return 'LINK_LOCAL' }; if ($phase1hBytes[0] -eq 0 -or ($phase1hBytes[0] -eq 100 -and $phase1hBytes[1] -ge 64 -and $phase1hBytes[1] -le 127) -or ($phase1hBytes[0] -eq 192 -and $phase1hBytes[1] -eq 0 -and ($phase1hBytes[2] -eq 0 -or $phase1hBytes[2] -eq 2)) -or ($phase1hBytes[0] -eq 198 -and ($phase1hBytes[1] -eq 18 -or $phase1hBytes[1] -eq 19)) -or ($phase1hBytes[0] -eq 198 -and $phase1hBytes[1] -eq 51 -and $phase1hBytes[2] -eq 100) -or ($phase1hBytes[0] -eq 203 -and $phase1hBytes[1] -eq 0 -and $phase1hBytes[2] -eq 113) -or $phase1hBytes[0] -ge 224) { return 'SPECIAL' }; return 'PUBLIC' }; if (($phase1hBytes[0] -band 0xfe) -eq 0xfc) { return 'PRIVATE' }; if ($phase1hAddress.IsIPv6LinkLocal) { return 'LINK_LOCAL' }; if ($phase1hAddress.IsIPv6Multicast -or $phase1hAddress.IsIPv6SiteLocal -or ($phase1hBytes[0] -eq 0x20 -and $phase1hBytes[1] -eq 0x01 -and $phase1hBytes[2] -eq 0x0d -and $phase1hBytes[3] -eq 0xb8) -or ($phase1hBytes[0] -eq 0x01 -and $phase1hBytes[1] -eq 0x00 -and $phase1hBytes[2] -eq 0x00 -and $phase1hBytes[3] -eq 0x00 -and $phase1hBytes[4] -eq 0x00 -and $phase1hBytes[5] -eq 0x00 -and $phase1hBytes[6] -eq 0x00 -and $phase1hBytes[7] -eq 0x00)) { return 'SPECIAL' }; return 'PUBLIC' }`,
  ];
}

function processRole(processName) {
  const normalized = String(processName).toLocaleLowerCase().replace(/\.exe$/u, "");
  return relevantProcessRoles.get(normalized) ?? null;
}

function powershellProcessFilter() {
  return [
    "electron.exe",
    "madi.exe",
    "madi-core.exe",
    "madi-export-hwpx.exe",
    "madi-hwp-bridge.exe",
    "madi-atomic-output.exe",
    "hwp.exe",
  ]
    .map((name) => `Name='${name}'`)
    .join(" OR ");
}

function processInstanceKey(pid, creationDate) {
  return `${pid}:${creationDate}`;
}

function parseProcessSnapshot(parsed) {
  return (Array.isArray(parsed) ? parsed : [parsed]).flatMap((row) => {
    const pid = safeInteger(row?.pid, 0xffff_ffff);
    const ppid = safeInteger(row?.ppid, 0xffff_ffff);
    const role = processRole(row?.name);
    const creationDate =
      typeof row?.creationDate === "string" && /^\d{1,20}$/u.test(row.creationDate)
        ? row.creationDate
        : null;
    const parentCreationDate =
      typeof row?.parentCreationDate === "string" &&
      /^\d{1,20}$/u.test(row.parentCreationDate)
        ? row.parentCreationDate
        : null;
    const electronSubtype = electronProcessSubtypes.has(row?.electronSubtype)
      ? row.electronSubtype
      : null;
    if (
      pid === null ||
      pid <= 0 ||
      ppid === null ||
      !role ||
      creationDate === null ||
      electronSubtype === null
    ) {
      return [];
    }
    return [
      {
        pid,
        ppid,
        role,
        creationDate,
        instanceKey: processInstanceKey(pid, creationDate),
        parentInstanceKey:
          ppid > 0 && parentCreationDate !== null
            ? processInstanceKey(ppid, parentCreationDate)
            : null,
        electronSubtype,
      },
    ];
  });
}

function captureRelevantProcessSnapshot() {
  verify(process.platform === "win32", "phase1h-process-proof-platform");
  const command = [
    ...powershellProcessHelpers(),
    `$phase1hFilter = \"${powershellProcessFilter()}\"`,
    "$phase1hProcesses = @(Get-CimInstance Win32_Process -Filter $phase1hFilter -ErrorAction Stop)",
    "$phase1hByPid = @{}; foreach ($phase1hProcess in $phase1hProcesses) { $phase1hByPid[[int]$phase1hProcess.ProcessId] = $phase1hProcess }",
    "$phase1hRows = @($phase1hProcesses | ForEach-Object { $phase1hParent = $phase1hByPid[[int]$_.ParentProcessId]; [PSCustomObject]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; name = [string]$_.Name; creationDate = Get-MadiPhase1hCreationDate $_; parentCreationDate = if ($null -eq $phase1hParent) { $null } else { Get-MadiPhase1hCreationDate $phase1hParent }; electronSubtype = Get-MadiPhase1hElectronSubtype $_ } })",
    "ConvertTo-Json -InputObject @($phase1hRows) -Compress",
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
    "phase1h-process-snapshot-failed",
    {
      status: result.status,
      signalPresent: result.signal !== null,
      stderrLength: result.stderr?.length ?? 0,
    },
  );
  const parsed = JSON.parse(result.stdout || "[]");
  return parseProcessSnapshot(parsed);
}

function captureAliveProcessIds(processIds) {
  if (processIds.length === 0) {
    return [];
  }
  const ids = [...new Set(processIds)].filter(
    (pid) => Number.isSafeInteger(pid) && pid > 0 && pid <= 0xffff_ffff,
  );
  const command = [
    `$phase1hIds = @(${ids.join(",")})`,
    "$phase1hAlive = @($phase1hIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })",
    "ConvertTo-Json -InputObject $phase1hAlive -Compress",
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
    "phase1h-process-exact-pid-query-failed",
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
  const baselineInstanceKeys = new Set(baseline.map((entry) => entry.instanceKey));
  const observations = new Map();
  const observedChildren = [];
  const tcpSamples = [];
  const identityRaceCounts = new Map();
  let currentTcpSample = [];
  let globalTcpParserRejectedRowCount = 0;
  const command = [
    ...powershellProcessHelpers(),
    ...powershellTcpHelpers(),
    `$phase1hFilter = \"${powershellProcessFilter()}\"`,
    "$phase1hNetstat = Join-Path $env:SystemRoot 'System32\\netstat.exe'",
    String.raw`while ($true) { $phase1hRows = @(Get-CimInstance Win32_Process -Filter $phase1hFilter -ErrorAction Stop); $phase1hByPid = @{}; foreach ($phase1hRow in $phase1hRows) { $phase1hByPid[[int]$phase1hRow.ProcessId] = $phase1hRow }; foreach ($phase1hRow in $phase1hRows) { $phase1hParent = $phase1hByPid[[int]$phase1hRow.ParentProcessId]; $phase1hCreationDate = Get-MadiPhase1hCreationDate $phase1hRow; $phase1hParentCreationDate = if ($null -eq $phase1hParent) { '' } else { Get-MadiPhase1hCreationDate $phase1hParent }; Write-Output ("P|{0}|{1}|{2}|{3}|{4}|{5}" -f $phase1hRow.ProcessId, $phase1hRow.ParentProcessId, $phase1hRow.Name, $phase1hCreationDate, $phase1hParentCreationDate, (Get-MadiPhase1hElectronSubtype $phase1hRow)) }; $phase1hNetstatRows = @(& $phase1hNetstat -ano -p tcp); if ($LASTEXITCODE -ne 0) { throw 'phase1h-netstat-sample-failed' }; $phase1hPostRows = @(Get-CimInstance Win32_Process -Filter $phase1hFilter -ErrorAction Stop); $phase1hPostByPid = @{}; foreach ($phase1hPostRow in $phase1hPostRows) { $phase1hPostByPid[[int]$phase1hPostRow.ProcessId] = $phase1hPostRow }; foreach ($phase1hLine in $phase1hNetstatRows) { $phase1hTrimmed = $phase1hLine.Trim(); if (-not $phase1hTrimmed.StartsWith('TCP')) { continue }; $phase1hParts = @($phase1hTrimmed -split '\s+'); if ($phase1hParts.Count -lt 2 -or $phase1hParts[0] -ne 'TCP') { Write-Output 'R|PARSER'; continue }; $phase1hPid = 0; if (-not [int]::TryParse($phase1hParts[-1], [ref]$phase1hPid)) { Write-Output 'R|PARSER'; continue }; $phase1hProcess = $phase1hByPid[$phase1hPid]; if ($null -eq $phase1hProcess) { continue }; $phase1hCreationDate = Get-MadiPhase1hCreationDate $phase1hProcess; $phase1hPostProcess = $phase1hPostByPid[$phase1hPid]; if ($null -eq $phase1hPostProcess -or (Get-MadiPhase1hCreationDate $phase1hPostProcess) -cne $phase1hCreationDate -or ([string]$phase1hPostProcess.Name) -cne ([string]$phase1hProcess.Name)) { Write-Output ("R|IDENTITY|{0}|{1}" -f $phase1hPid, $phase1hCreationDate); continue }; if ($phase1hParts.Count -ne 5) { Write-Output ("T|{0}|{1}|UNKNOWN|PARSE_ERROR|PARSE_ERROR" -f $phase1hPid, $phase1hCreationDate); continue }; $phase1hStateClass = Get-MadiPhase1hTcpStateClass $phase1hParts[3]; $phase1hLocalClass = Get-MadiPhase1hAddressClass (Get-MadiPhase1hEndpointAddress $phase1hParts[1]); $phase1hRemoteClass = Get-MadiPhase1hAddressClass (Get-MadiPhase1hEndpointAddress $phase1hParts[2]); Write-Output ("T|{0}|{1}|{2}|{3}|{4}" -f $phase1hPid, $phase1hCreationDate, $phase1hStateClass, $phase1hRemoteClass, $phase1hLocalClass) }; Write-Output '__MADI_PHASE1H_PROCESS_SAMPLE__'; Start-Sleep -Milliseconds 200 }`,
  ].join("; ");
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  let stdoutRemainder = "";
  let stderrLength = 0;
  let sampleCount = 0;
  let rootPid = null;
  let rootInstanceKey = null;
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolveReady, rejectReady) => {
    readyResolve = resolveReady;
    readyReject = rejectReady;
  });
  const readyTimer = setTimeout(
    () => readyReject(new Error("phase1h-process-monitor-ready-timeout")),
    15_000,
  );
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutRemainder += chunk;
    const lines = stdoutRemainder.split(/\r?\n/u);
    stdoutRemainder = lines.pop() ?? "";
    for (const line of lines) {
      if (line === "__MADI_PHASE1H_PROCESS_SAMPLE__") {
        sampleCount += 1;
        tcpSamples.push(currentTcpSample);
        currentTcpSample = [];
        if (sampleCount === 1) {
          clearTimeout(readyTimer);
          readyResolve();
        }
        continue;
      }
      if (line === "R|PARSER") {
        globalTcpParserRejectedRowCount += 1;
        continue;
      }
      if (line.startsWith("R|IDENTITY|")) {
        const [, , pidText, creationDate] = line.split("|", 4);
        const pid = Number(pidText);
        if (
          Number.isSafeInteger(pid) &&
          pid > 0 &&
          /^\d{1,20}$/u.test(creationDate ?? "")
        ) {
          const key = processInstanceKey(pid, creationDate);
          identityRaceCounts.set(key, (identityRaceCounts.get(key) ?? 0) + 1);
        }
        continue;
      }
      if (line.startsWith("T|")) {
        const [, pidText, creationDate, stateClass, remoteClass, localClass] =
          line.split("|", 6);
        const pid = Number(pidText);
        if (
          Number.isSafeInteger(pid) &&
          pid > 0 &&
          /^\d{1,20}$/u.test(creationDate ?? "") &&
          tcpStateClasses.includes(stateClass) &&
          tcpAddressClasses.includes(remoteClass) &&
          tcpAddressClasses.includes(localClass)
        ) {
          currentTcpSample.push({
            instanceKey: processInstanceKey(pid, creationDate),
            stateClass,
            remoteClass,
            localClass,
          });
        } else {
          globalTcpParserRejectedRowCount += 1;
        }
        continue;
      }
      const [
        prefix,
        pidText,
        ppidText,
        name,
        creationDate,
        parentCreationDate,
        electronSubtype,
      ] = line.split("|", 7);
      const pid = Number(pidText);
      const ppid = Number(ppidText);
      const role = processRole(name);
      if (
        prefix === "P" &&
        Number.isSafeInteger(pid) &&
        pid > 0 &&
        Number.isSafeInteger(ppid) &&
        role &&
        /^\d{1,20}$/u.test(creationDate ?? "") &&
        (parentCreationDate === "" ||
          /^\d{1,20}$/u.test(parentCreationDate ?? "")) &&
        electronProcessSubtypes.has(electronSubtype)
      ) {
        const key = processInstanceKey(pid, creationDate);
        observations.set(key, {
          pid,
          ppid,
          role: key === rootInstanceKey ? "ROOT" : role,
          creationDate,
          instanceKey: key,
          parentInstanceKey:
            ppid > 0 && parentCreationDate
              ? processInstanceKey(ppid, parentCreationDate)
              : null,
          electronSubtype,
        });
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    stderrLength += Buffer.byteLength(chunk);
  });
  child.once("error", () => {
    clearTimeout(readyTimer);
    readyReject(new Error("phase1h-process-monitor-spawn-failed"));
  });
  child.once("exit", () => {
    if (sampleCount === 0) {
      clearTimeout(readyTimer);
      readyReject(new Error("phase1h-process-monitor-early-exit"));
    }
  });
  await ready;
  let stopped = false;
  return {
    baseline,
    baselineInstanceKeys,
    observations,
    observedChildren,
    recordObservedChildren(children) {
      for (const child of children) {
        observedChildren.push(child);
      }
    },
    recordRoot(pid) {
      rootPid = pid;
      const matches = captureRelevantProcessSnapshot().filter(
        (entry) => entry.pid === pid,
      );
      verify(matches.length === 1, "phase1h-root-process-instance-capture", {
        matchCount: matches.length,
      });
      const root = { ...matches[0], role: "ROOT" };
      rootInstanceKey = root.instanceKey;
      observations.set(root.instanceKey, root);
    },
    get rootInstanceKey() {
      return rootInstanceKey;
    },
    getOwnedProcessInstances() {
      verify(
        rootInstanceKey !== null && rootPid !== null,
        "phase1h-owned-process-root-instance",
      );
      const ownedKeys = new Set([rootInstanceKey]);
      const spawnTapUnsampledCountByRole = zeroCounts(
        spawnTappedSidecarRoles,
      );
      for (const child of observedChildren) {
        const matches = [...observations.values()].filter(
          (entry) =>
            entry.pid === child.pid &&
            entry.ppid === child.ppid &&
            entry.role === child.role &&
            child.ppid === rootPid,
        );
        verify(
          matches.length <= 1,
          "phase1h-spawn-tapped-process-instance-attribution",
          { role: child.role, matchCount: matches.length },
        );
        if (matches.length === 0) {
          spawnTapUnsampledCountByRole[child.role] += 1;
          continue;
        }
        ownedKeys.add(matches[0].instanceKey);
      }
      let changed = true;
      while (changed) {
        changed = false;
        for (const entry of observations.values()) {
          if (
            !ownedKeys.has(entry.instanceKey) &&
            entry.parentInstanceKey !== null &&
            ownedKeys.has(entry.parentInstanceKey)
          ) {
            ownedKeys.add(entry.instanceKey);
            changed = true;
          }
        }
      }
      return {
        ownedProcesses: [...ownedKeys].flatMap((key) => {
          const entry = observations.get(key);
          return entry ? [entry] : [];
        }),
        spawnTapUnsampledCountByRole,
      };
    },
    async stop() {
      if (!stopped) {
        stopped = true;
        child.kill();
        verify(
          await waitForChildExit(child, 8_000),
          "phase1h-process-monitor-stop-timeout",
        );
      }
      verify(sampleCount > 0 && stderrLength === 0, "phase1h-process-monitor-health", {
        sampleCount,
        stderrLength,
      });
      const ownership = this.getOwnedProcessInstances();
      return {
        sampleCount,
        distinctProcessCount: observations.size,
        spawnTapUnsampledCountByRole:
          ownership.spawnTapUnsampledCountByRole,
        ...summarizeOwnedTcpMonitoring({
          observations,
          ownedProcesses: ownership.ownedProcesses,
          baselineInstanceKeys,
          tcpSamples,
          identityRaceCounts,
          globalTcpParserRejectedRowCount,
        }),
      };
    },
  };
}

function zeroCounts(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function hasExactSafeCountMap(value, keys) {
  return (
    hasExactKeys(value, keys) &&
    keys.every((key) => safeInteger(value[key], 10_000_000) !== null)
  );
}

function hasPrivacySafeRoleList(value) {
  return (
    Array.isArray(value) &&
    value.length === new Set(value).size &&
    value.every((role) => privacySafeProcessRoles.has(role))
  );
}

function hasExactPrivacySafeRoleClassMap(value) {
  return (
    hasExactKeys(value, tcpAddressClasses) &&
    tcpAddressClasses.every((addressClass) =>
      hasPrivacySafeRoleList(value[addressClass]),
    )
  );
}

function countMapTotal(value, keys) {
  return keys.reduce((sum, key) => sum + value[key], 0);
}

function hasPrivacySafeOwnedTcpBoundaryFailureDetails(value) {
  if (
    !hasExactKeys(value, ownedTcpBoundaryFailureDetailKeys) ||
    safeInteger(value.peerViolationCount, 10_000_000) === null ||
    safeInteger(value.listenerViolationCount, 10_000_000) === null ||
    safeInteger(value.classificationFailureCount, 10_000_000) === null ||
    safeInteger(value.identityRaceCount, 10_000_000) === null ||
    safeInteger(value.parserRejectedRowCount, 10_000_000) === null ||
    safeInteger(value.monitorSampleCount, 10_000_000) === null ||
    safeInteger(value.ownedTcpRowObservationCount, 10_000_000) === null ||
    safeInteger(value.unownedTcpRowObservationCount, 10_000_000) === null ||
    !hasPrivacySafeRoleList(value.roles) ||
    !hasExactSafeCountMap(
      value.ownedProcessInstanceCountsByRole,
      processRoleCountKeys,
    ) ||
    !hasExactSafeCountMap(
      value.ownedElectronSubtypeCounts,
      [...electronProcessSubtypes],
    ) ||
    !hasExactSafeCountMap(value.tcpStateObservationCounts, tcpStateClasses) ||
    !hasExactSafeCountMap(
      value.tcpPeerRemoteAddressClassObservationCounts,
      tcpAddressClasses,
    ) ||
    !hasExactSafeCountMap(
      value.tcpListenerLocalAddressClassObservationCounts,
      tcpAddressClasses,
    ) ||
    !hasExactSafeCountMap(
      value.tcpSamplesWithPeerByRemoteAddressClass,
      tcpAddressClasses,
    ) ||
    !hasExactSafeCountMap(
      value.tcpMaximumConcurrentPeersByRemoteAddressClass,
      tcpAddressClasses,
    ) ||
    !hasExactSafeCountMap(
      value.tcpDistinctOwnedProcessInstanceCountsByRemoteAddressClass,
      tcpAddressClasses,
    ) ||
    !hasExactPrivacySafeRoleClassMap(
      value.tcpPeerRolesByRemoteAddressClass,
    )
  ) {
    return false;
  }
  const listenerObservationCount =
    value.tcpStateObservationCounts.LISTEN;
  const peerObservationCount =
    value.ownedTcpRowObservationCount - listenerObservationCount;
  return (
    countMapTotal(value.tcpStateObservationCounts, tcpStateClasses) ===
      value.ownedTcpRowObservationCount &&
    countMapTotal(
      value.tcpPeerRemoteAddressClassObservationCounts,
      tcpAddressClasses,
    ) === peerObservationCount &&
    countMapTotal(
      value.tcpListenerLocalAddressClassObservationCounts,
      tcpAddressClasses,
    ) === listenerObservationCount &&
    value.peerViolationCount <= peerObservationCount &&
    value.listenerViolationCount <= listenerObservationCount &&
    value.classificationFailureCount <=
      value.ownedTcpRowObservationCount &&
    tcpAddressClasses.every(
      (addressClass) =>
        value.tcpSamplesWithPeerByRemoteAddressClass[addressClass] <=
          value.monitorSampleCount &&
        value.tcpMaximumConcurrentPeersByRemoteAddressClass[addressClass] <=
          value.tcpPeerRemoteAddressClassObservationCounts[addressClass] &&
        value.tcpDistinctOwnedProcessInstanceCountsByRemoteAddressClass[
          addressClass
        ] <= value.tcpPeerRemoteAddressClassObservationCounts[addressClass],
    )
  );
}

function summarizeOwnedTcpMonitoring({
  observations,
  ownedProcesses,
  baselineInstanceKeys,
  tcpSamples,
  identityRaceCounts,
  globalTcpParserRejectedRowCount,
}) {
  const ownedKeys = new Set(ownedProcesses.map((entry) => entry.instanceKey));
  const tcpStateObservationCounts = zeroCounts(tcpStateClasses);
  const tcpPeerRemoteAddressClassObservationCounts = zeroCounts(tcpAddressClasses);
  const tcpListenerLocalAddressClassObservationCounts = zeroCounts(tcpAddressClasses);
  const tcpSamplesWithPeerByRemoteAddressClass = zeroCounts(tcpAddressClasses);
  const tcpMaximumConcurrentPeersByRemoteAddressClass = zeroCounts(tcpAddressClasses);
  const distinctPeerInstancesByRemoteAddressClass = Object.fromEntries(
    tcpAddressClasses.map((addressClass) => [addressClass, new Set()]),
  );
  const peerRolesByRemoteAddressClass = Object.fromEntries(
    tcpAddressClasses.map((addressClass) => [addressClass, new Set()]),
  );
  const ownedElectronSubtypeCounts = zeroCounts([...electronProcessSubtypes]);
  const boundaryViolationRoles = new Set();
  let ownedTcpRowObservationCount = 0;
  let unownedTcpRowObservationCount = 0;
  let ownedTcpPeerBoundaryViolationCount = 0;
  let ownedTcpListenerBoundaryViolationCount = 0;
  let ownedTcpClassificationFailureCount = 0;
  let ownedTcpBoundaryViolationRowCount = 0;

  for (const process of ownedProcesses) {
    ownedElectronSubtypeCounts[process.electronSubtype] += 1;
  }

  for (const sample of tcpSamples) {
    const samplePeerCounts = zeroCounts(tcpAddressClasses);
    for (const row of sample) {
      if (!ownedKeys.has(row.instanceKey)) {
        unownedTcpRowObservationCount += 1;
        continue;
      }
      const process = observations.get(row.instanceKey);
      const role = process?.role ?? "OTHER";
      let peerViolation = false;
      let listenerViolation = false;
      let classificationFailure = row.stateClass === "UNKNOWN";
      ownedTcpRowObservationCount += 1;
      tcpStateObservationCounts[row.stateClass] += 1;
      if (row.stateClass === "LISTEN") {
        tcpListenerLocalAddressClassObservationCounts[row.localClass] += 1;
        listenerViolation = row.localClass !== "LOOPBACK";
        classificationFailure ||= row.localClass === "PARSE_ERROR";
      } else {
        tcpPeerRemoteAddressClassObservationCounts[row.remoteClass] += 1;
        samplePeerCounts[row.remoteClass] += 1;
        distinctPeerInstancesByRemoteAddressClass[row.remoteClass].add(
          row.instanceKey,
        );
        peerRolesByRemoteAddressClass[row.remoteClass].add(role);
        peerViolation = prohibitedTcpPeerAddressClasses.has(row.remoteClass);
        classificationFailure ||=
          row.remoteClass === "UNSPECIFIED" || row.remoteClass === "PARSE_ERROR";
      }
      if (peerViolation) {
        ownedTcpPeerBoundaryViolationCount += 1;
      }
      if (listenerViolation) {
        ownedTcpListenerBoundaryViolationCount += 1;
      }
      if (classificationFailure) {
        ownedTcpClassificationFailureCount += 1;
      }
      if (peerViolation || listenerViolation || classificationFailure) {
        ownedTcpBoundaryViolationRowCount += 1;
        boundaryViolationRoles.add(role);
      }
    }
    for (const addressClass of tcpAddressClasses) {
      if (samplePeerCounts[addressClass] > 0) {
        tcpSamplesWithPeerByRemoteAddressClass[addressClass] += 1;
      }
      tcpMaximumConcurrentPeersByRemoteAddressClass[addressClass] = Math.max(
        tcpMaximumConcurrentPeersByRemoteAddressClass[addressClass],
        samplePeerCounts[addressClass],
      );
    }
  }

  let ownedTcpIdentityRaceCount = 0;
  for (const [instanceKey, count] of identityRaceCounts) {
    if (ownedKeys.has(instanceKey)) {
      ownedTcpIdentityRaceCount += count;
      boundaryViolationRoles.add(observations.get(instanceKey)?.role ?? "OTHER");
    }
  }
  const distinctUnownedRelevantProcessInstanceCount = [
    ...observations.values(),
  ].filter(
    (entry) =>
      !ownedKeys.has(entry.instanceKey) &&
      !baselineInstanceKeys.has(entry.instanceKey),
  ).length;
  const tcpDistinctOwnedProcessInstanceCountsByRemoteAddressClass =
    Object.fromEntries(
      tcpAddressClasses.map((addressClass) => [
        addressClass,
        distinctPeerInstancesByRemoteAddressClass[addressClass].size,
      ]),
    );
  const tcpPeerRolesByRemoteAddressClass = Object.fromEntries(
    tcpAddressClasses.map((addressClass) => [
      addressClass,
      [...peerRolesByRemoteAddressClass[addressClass]].sort(),
    ]),
  );
  const ownedTcpPeerNonLoopbackObservationCount = [
    "PRIVATE",
    "LINK_LOCAL",
    "PUBLIC",
    "SPECIAL",
  ].reduce(
    (sum, addressClass) =>
      sum + tcpPeerRemoteAddressClassObservationCounts[addressClass],
    0,
  );
  return {
    processIdentityMode: "PID_AND_WIN32_PROCESS_CREATION_DATE",
    processOwnershipMode:
      "MAIN_PROCESS_INSTANCE_TRANSITIVE_DESCENDANTS_AND_SPAWN_TAPPED_SIDECARS",
    ownedProcessInstanceCountsByRole: roleCounts(ownedProcesses),
    ownedElectronSubtypeCounts,
    distinctUnownedRelevantProcessInstanceCount,
    ownedTcpRowObservationCount,
    unownedTcpRowObservationCount,
    tcpStateObservationCounts,
    tcpPeerRemoteAddressClassObservationCounts,
    tcpListenerLocalAddressClassObservationCounts,
    tcpSamplesWithPeerByRemoteAddressClass,
    tcpMaximumConcurrentPeersByRemoteAddressClass,
    tcpDistinctOwnedProcessInstanceCountsByRemoteAddressClass,
    tcpPeerRolesByRemoteAddressClass,
    ownedTcpPeerNonLoopbackObservationCount,
    ownedTcpPeerBoundaryViolationCount,
    ownedTcpListenerBoundaryViolationCount,
    ownedTcpClassificationFailureCount,
    ownedTcpIdentityRaceCount,
    globalTcpParserRejectedRowCount,
    ownedTcpBoundaryViolationRowCount,
    ownedTcpBoundaryViolationRoles: [...boundaryViolationRoles].sort(),
  };
}

function roleCounts(processes) {
  const counts = {
    root: 0,
    electron: 0,
    core: 0,
    exporter: 0,
    bridge: 0,
    atomicOutput: 0,
    hancom: 0,
  };
  for (const process of processes) {
    if (process.role === "ROOT") counts.root += 1;
    if (process.role === "ELECTRON") counts.electron += 1;
    if (process.role === "CORE") counts.core += 1;
    if (process.role === "EXPORTER") counts.exporter += 1;
    if (process.role === "BRIDGE") counts.bridge += 1;
    if (process.role === "ATOMIC_OUTPUT") counts.atomicOutput += 1;
    if (process.role === "HANCOM") counts.hancom += 1;
  }
  return counts;
}

function capturedDescendants(processes, rootInstanceKey) {
  const uniqueProcesses = [
    ...new Map(processes.map((process) => [process.instanceKey, process])).values(),
  ];
  const descendantKeys = new Set([rootInstanceKey]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of uniqueProcesses) {
      if (
        !descendantKeys.has(process.instanceKey) &&
        process.parentInstanceKey !== null &&
        descendantKeys.has(process.parentInstanceKey)
      ) {
        descendantKeys.add(process.instanceKey);
        changed = true;
      }
    }
  }
  return uniqueProcesses.filter(
    (process) =>
      process.instanceKey !== rootInstanceKey &&
      descendantKeys.has(process.instanceKey),
  );
}

async function assertNoOrphanProcesses(
  processMonitor,
  mainProcessPid,
  launcherProcessPid,
  hancomStatus,
  hwpExportExercised,
  atomicOutputExercised,
) {
  const monitorHealth = await processMonitor.stop();
  const capturedNew = [...processMonitor.observations.values()].filter(
    (entry) =>
      entry.role === "ROOT" ||
      !processMonitor.baselineInstanceKeys.has(entry.instanceKey),
  );
  const observed = roleCounts(capturedNew);
  const descendantProcesses = capturedDescendants(
    capturedNew,
    processMonitor.rootInstanceKey,
  );
  const observedDescendants = roleCounts(descendantProcesses);
  const hancomObservationMatches = hwpExportExercised
    ? observed.hancom > 0
    : observed.hancom === 0;
  const spawned = roleCounts(processMonitor.observedChildren);
  const atomicOutputObservationMatches = atomicOutputExercised
    ? spawned.atomicOutput > 0
    : spawned.atomicOutput === 0;
  const requiredSpawnRoles = ["CORE", "EXPORTER", "BRIDGE"];
  if (atomicOutputExercised) {
    requiredSpawnRoles.push("ATOMIC_OUTPUT");
  }
  const requiredSpawnRolesObserved = requiredSpawnRoles.every((role) =>
    processMonitor.observedChildren.some((entry) => entry.role === role),
  );
  const bundledPathObserved = Object.fromEntries(
    ["CORE", "EXPORTER", "BRIDGE", "ATOMIC_OUTPUT"].map((role) => [
      role,
      processMonitor.observedChildren.some(
        (entry) => entry.role === role && entry.bundledPath,
      ),
    ]),
  );
  const allObservedCommandsUseExpectedPathMode =
    processMonitor.observedChildren.length > 0 &&
    processMonitor.observedChildren.every(
      (entry) => entry.bundledPath === packaged,
    );
  verify(
    observed.root === 1 &&
      observedDescendants.electron > 0 &&
      spawned.core > 0 &&
      spawned.exporter > 0 &&
      spawned.bridge > 0 &&
      hancomObservationMatches &&
      atomicOutputObservationMatches &&
      requiredSpawnRolesObserved &&
      allObservedCommandsUseExpectedPathMode,
    "phase1h-process-role-observation",
    {
      observed,
      observedDescendants,
      spawned,
      hancomStatus,
      hwpExportExercised,
      atomicOutputExercised,
      requiredSpawnRolesObserved,
      allObservedCommandsUseExpectedPathMode,
    },
  );
  const ownedTcpBoundaryFailureDetails = {
    peerViolationCount: monitorHealth.ownedTcpPeerBoundaryViolationCount,
    listenerViolationCount:
      monitorHealth.ownedTcpListenerBoundaryViolationCount,
    classificationFailureCount:
      monitorHealth.ownedTcpClassificationFailureCount,
    identityRaceCount: monitorHealth.ownedTcpIdentityRaceCount,
    parserRejectedRowCount: monitorHealth.globalTcpParserRejectedRowCount,
    roles: monitorHealth.ownedTcpBoundaryViolationRoles,
    monitorSampleCount: monitorHealth.sampleCount,
    ownedTcpRowObservationCount: monitorHealth.ownedTcpRowObservationCount,
    unownedTcpRowObservationCount:
      monitorHealth.unownedTcpRowObservationCount,
    ownedProcessInstanceCountsByRole:
      monitorHealth.ownedProcessInstanceCountsByRole,
    ownedElectronSubtypeCounts: monitorHealth.ownedElectronSubtypeCounts,
    tcpStateObservationCounts: monitorHealth.tcpStateObservationCounts,
    tcpPeerRemoteAddressClassObservationCounts:
      monitorHealth.tcpPeerRemoteAddressClassObservationCounts,
    tcpListenerLocalAddressClassObservationCounts:
      monitorHealth.tcpListenerLocalAddressClassObservationCounts,
    tcpSamplesWithPeerByRemoteAddressClass:
      monitorHealth.tcpSamplesWithPeerByRemoteAddressClass,
    tcpMaximumConcurrentPeersByRemoteAddressClass:
      monitorHealth.tcpMaximumConcurrentPeersByRemoteAddressClass,
    tcpDistinctOwnedProcessInstanceCountsByRemoteAddressClass:
      monitorHealth.tcpDistinctOwnedProcessInstanceCountsByRemoteAddressClass,
    tcpPeerRolesByRemoteAddressClass:
      monitorHealth.tcpPeerRolesByRemoteAddressClass,
  };
  verify(
    hasPrivacySafeOwnedTcpBoundaryFailureDetails(
      ownedTcpBoundaryFailureDetails,
    ),
    "phase1h-owned-tcp-diagnostics-shape",
  );
  verify(
    monitorHealth.ownedTcpPeerBoundaryViolationCount === 0 &&
      monitorHealth.ownedTcpListenerBoundaryViolationCount === 0 &&
      monitorHealth.ownedTcpClassificationFailureCount === 0 &&
      monitorHealth.ownedTcpIdentityRaceCount === 0 &&
      monitorHealth.ownedTcpBoundaryViolationRowCount === 0,
    "phase1h-owned-tcp-boundary",
    ownedTcpBoundaryFailureDetails,
  );
  const capturedPids = [
    ...new Set([
      launcherProcessPid,
      mainProcessPid,
      ...descendantProcesses.map((entry) => entry.pid),
      ...processMonitor.observedChildren.map((entry) => entry.pid),
      ...capturedNew
        .filter((entry) => hwpExportExercised && entry.role === "HANCOM")
        .map((entry) => entry.pid),
    ]),
  ];
  const proof = await poll(
    async () => {
      const current = captureRelevantProcessSnapshot();
      const newGlobalRelevant = current.filter(
        (entry) =>
          !processMonitor.baselineInstanceKeys.has(entry.instanceKey),
      );
      const exactAlive = captureAliveProcessIds(capturedPids);
      const currentInstanceKeys = new Set(
        current.map((entry) => entry.instanceKey),
      );
      const liveTreeDescendantKeys = new Set(
        capturedDescendants(
          [...capturedNew, ...current],
          processMonitor.rootInstanceKey,
        )
          .filter((entry) => currentInstanceKeys.has(entry.instanceKey))
          .map((entry) => entry.instanceKey),
      );
      return exactAlive.length === 0 && liveTreeDescendantKeys.size === 0
        ? { current, newGlobalRelevant, exactAlive, liveTreeDescendantKeys }
        : null;
    },
    "phase1h-process-orphan-exit",
    PROCESS_EXIT_TIMEOUT_MS,
  );
  return {
    baseline: roleCounts(processMonitor.baseline),
    observed,
    observedDescendants,
    captureMode: "MAIN_PROCESS_SPAWN_TAP_AND_WIN32_SNAPSHOT",
    networkCaptureMode:
      "WIN32_NETSTAT_OWNED_PROCESS_INSTANCE_TCP_STATE_ADDRESS_CLASS_SAMPLING",
    monitorSampleCount: monitorHealth.sampleCount,
    distinctObservedProcessCount: monitorHealth.distinctProcessCount,
    spawned,
    packagedPathPinningRequired: packaged,
    bundledPathObserved,
    allObservedCommandsUseExpectedPathMode,
    requiredSpawnRolesObserved,
    processIdentityMode: monitorHealth.processIdentityMode,
    processOwnershipMode: monitorHealth.processOwnershipMode,
    ownedProcessInstanceCountsByRole:
      monitorHealth.ownedProcessInstanceCountsByRole,
    spawnTapUnsampledCountByRole:
      monitorHealth.spawnTapUnsampledCountByRole,
    ownedElectronSubtypeCounts: monitorHealth.ownedElectronSubtypeCounts,
    distinctUnownedRelevantProcessInstanceCount:
      monitorHealth.distinctUnownedRelevantProcessInstanceCount,
    ownedTcpRowObservationCount: monitorHealth.ownedTcpRowObservationCount,
    unownedTcpRowObservationCount: monitorHealth.unownedTcpRowObservationCount,
    tcpStateObservationCounts: monitorHealth.tcpStateObservationCounts,
    tcpPeerRemoteAddressClassObservationCounts:
      monitorHealth.tcpPeerRemoteAddressClassObservationCounts,
    tcpListenerLocalAddressClassObservationCounts:
      monitorHealth.tcpListenerLocalAddressClassObservationCounts,
    tcpSamplesWithPeerByRemoteAddressClass:
      monitorHealth.tcpSamplesWithPeerByRemoteAddressClass,
    tcpMaximumConcurrentPeersByRemoteAddressClass:
      monitorHealth.tcpMaximumConcurrentPeersByRemoteAddressClass,
    tcpDistinctOwnedProcessInstanceCountsByRemoteAddressClass:
      monitorHealth.tcpDistinctOwnedProcessInstanceCountsByRemoteAddressClass,
    tcpPeerRolesByRemoteAddressClass:
      monitorHealth.tcpPeerRolesByRemoteAddressClass,
    ownedTcpPeerNonLoopbackObservationCount:
      monitorHealth.ownedTcpPeerNonLoopbackObservationCount,
    ownedTcpPeerBoundaryViolationCount:
      monitorHealth.ownedTcpPeerBoundaryViolationCount,
    ownedTcpListenerBoundaryViolationCount:
      monitorHealth.ownedTcpListenerBoundaryViolationCount,
    ownedTcpClassificationFailureCount:
      monitorHealth.ownedTcpClassificationFailureCount,
    ownedTcpIdentityRaceCount: monitorHealth.ownedTcpIdentityRaceCount,
    globalTcpParserRejectedRowCount:
      monitorHealth.globalTcpParserRejectedRowCount,
    ownedTcpBoundaryViolationRowCount:
      monitorHealth.ownedTcpBoundaryViolationRowCount,
    ownedTcpBoundaryViolationRoles:
      monitorHealth.ownedTcpBoundaryViolationRoles,
    exactCapturedProcessCount: capturedPids.length,
    exactCapturedProcessesExited: proof.exactAlive.length === 0,
    capturedDescendantProcessesAfterClose:
      proof.exactAlive.length + proof.liveTreeDescendantKeys.size,
    unrelatedOrConcurrentGlobalRelevantProcessCountAfterClose:
      proof.newGlobalRelevant.length,
  };
}

async function installMainChildProcessObserver(application) {
  const status = await application.evaluate(({ app }) => {
    const observerKey = "__madiPhase1hMainChildProcessObserver";
    if (Reflect.has(globalThis, observerKey)) {
      return { installed: false, processId: process.pid };
    }
    const childProcess = process.getBuiltinModule?.("node:child_process");
    if (!childProcess || typeof childProcess.spawn !== "function") {
      throw new Error("phase1h-main-child-process-module-unavailable");
    }
    const nodePath = process.getBuiltinModule?.("node:path");
    if (!nodePath || typeof nodePath.resolve !== "function") {
      throw new Error("phase1h-main-path-module-unavailable");
    }
    const expectedBundledCommands = new Map([
      ["CORE", nodePath.join(process.resourcesPath, "bin", "madi-core.exe")],
      [
        "EXPORTER",
        nodePath.join(process.resourcesPath, "bin", "madi-export-hwpx.exe"),
      ],
      [
        "BRIDGE",
        nodePath.join(
          process.resourcesPath,
          "bin",
          "hwp-bridge",
          "madi-hwp-bridge.exe",
        ),
      ],
      [
        "ATOMIC_OUTPUT",
        nodePath.join(process.resourcesPath, "bin", "madi-atomic-output.exe"),
      ],
    ]);
    const originalSpawn = childProcess.spawn;
    const records = new Map();
    const wrapper = function phase1hObservedMainSpawn(...args) {
      const child = Reflect.apply(originalSpawn, this, args);
      const commandName = String(args[0] ?? "")
        .split(/[\\/]/u)
        .at(-1)
        ?.toLocaleLowerCase()
        .replace(/\.exe$/u, "");
      const role =
        commandName === "madi-core"
          ? "CORE"
          : commandName === "madi-export-hwpx"
            ? "EXPORTER"
            : commandName === "madi-hwp-bridge"
              ? "BRIDGE"
              : commandName === "madi-atomic-output"
                ? "ATOMIC_OUTPUT"
                : null;
      if (role) {
        const expectedBundledCommand = expectedBundledCommands.get(role);
        const bundledPath =
          app.isPackaged === true &&
          typeof expectedBundledCommand === "string" &&
          nodePath.resolve(String(args[0])).toLocaleLowerCase() ===
            nodePath.resolve(expectedBundledCommand).toLocaleLowerCase();
        const record = () => {
          if (Number.isSafeInteger(child.pid) && child.pid > 0) {
            records.set(`${role}:${child.pid}`, {
              pid: child.pid,
              ppid: process.pid,
              role,
              bundledPath,
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
    "phase1h-main-child-process-observer-install",
  );
  return status.processId;
}

async function collectMainChildProcessObservations(run) {
  const result = await run.application.evaluate(() => {
    const observerKey = "__madiPhase1hMainChildProcessObserver";
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
    "phase1h-main-child-process-observer-collect",
  );
  const records = result.records.map((record) => {
    verify(
      Object.keys(record).sort().join(",") ===
        "bundledPath,pid,ppid,role" &&
        Number.isSafeInteger(record.pid) &&
        record.pid > 0 &&
        record.ppid === result.processId &&
        ["CORE", "EXPORTER", "BRIDGE", "ATOMIC_OUTPUT"].includes(
          record.role,
        ) &&
        typeof record.bundledPath === "boolean",
      "phase1h-main-child-process-observation-shape",
    );
    return record;
  });
  run.processMonitor.recordObservedChildren(records);
}

async function installMainLifecycleConsoleProbe(application) {
  const status = await application.evaluate(({ app }) => {
    const probeKey = "__madiPhase1hMainLifecycleConsoleProbe";
    if (Reflect.has(globalThis, probeKey)) {
      return { installed: false };
    }
    app.on("before-quit", () => {
      console.log("[madi-phase1h-main] before-quit");
    });
    app.on("will-quit", (event) => {
      console.log(
        event.defaultPrevented
          ? "[madi-phase1h-main] will-quit-prevented"
          : "[madi-phase1h-main] will-quit",
      );
    });
    app.on("quit", () => {
      console.log("[madi-phase1h-main] quit");
    });
    app.on("window-all-closed", () => {
      console.log("[madi-phase1h-main] window-all-closed");
    });
    Reflect.set(globalThis, probeKey, true);
    return { installed: true };
  });
  verify(
    Object.keys(status).join(",") === "installed" && status.installed === true,
    "phase1h-main-lifecycle-observer-install",
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
              MADI_HWPX_EXPORT_BIN: hwpxExporterBinary,
              MADI_HWP_BRIDGE_BIN: hwpBridgeBinary,
              MADI_ATOMIC_OUTPUT_BIN: atomicOutputBinary,
            }),
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      },
      timeout: 30_000,
    }, processDiagnostics);
    launcherProcessPid = application.process().pid;
    verify(
      Number.isSafeInteger(launcherProcessPid) && launcherProcessPid > 0,
      "phase1h-application-launcher-pid",
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
    verify(applicationProcess.stderr, "phase1h-child-stderr-unavailable");
    application.context().on("request", (request) => requestedUrls.push(request.url()));
    await application.evaluate(
      ({ dialog, shell }, plan) => {
        const state = {
          projectPath: plan.projectPath,
          hwpxPaths: [...plan.hwpxPaths],
          hwpPaths: [...(plan.hwpPaths ?? [])],
          jsonReportPaths: [...plan.jsonReportPaths],
          markdownReportPaths: [...plan.markdownReportPaths],
          calls: {
            projectOpen: 0,
            hwpxSave: 0,
            hwpSave: 0,
            jsonReportSave: 0,
            markdownReportSave: 0,
            reveal: 0,
            hwpxOverwriteConfirmationConfigured: 0,
            hwpOverwriteConfirmationConfigured: 0,
            reportOverwriteConfirmationConfigured: 0,
          },
        };
        Reflect.set(globalThis, "__madiPhase1hDialogState", state);
        dialog.showOpenDialog = async (_window, options) => {
          if (options.title === "madi 프로젝트 열기") {
            state.calls.projectOpen += 1;
            return { canceled: false, filePaths: [state.projectPath] };
          }
          return { canceled: true, filePaths: [] };
        };
        dialog.showSaveDialog = async (_window, options) => {
          if (options.title === "HWPX 내보내기") {
            state.calls.hwpxSave += 1;
            if (options.properties?.includes("showOverwriteConfirmation")) {
              state.calls.hwpxOverwriteConfirmationConfigured += 1;
            }
            const selected = state.hwpxPaths.shift();
            return selected
              ? { canceled: false, filePath: selected }
              : { canceled: true };
          }
          if (options.title === "HWP 내보내기") {
            state.calls.hwpSave += 1;
            if (options.properties?.includes("showOverwriteConfirmation")) {
              state.calls.hwpOverwriteConfirmationConfigured += 1;
            }
            const selected = state.hwpPaths.shift();
            return selected
              ? { canceled: false, filePath: selected }
              : { canceled: true };
          }
          if (options.title === "HWPX export report 저장") {
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
    await page.exposeBinding("__madiPhase1hDiagnostic", (_source, diagnostic) => {
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
        const binding = Reflect.get(globalThis, "__madiPhase1hDiagnostic");
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
    const appRuntime = await application.evaluate(({ app }) => {
      const disabledFeatures = app.commandLine
        .getSwitchValue("disable-features")
        .split(",")
        .map((feature) => feature.trim());
      return {
        isPackaged: app.isPackaged,
        appNameLength: app.getName().length,
        backgroundNetworkingDisabled: app.commandLine.hasSwitch(
          "disable-background-networking",
        ),
        componentUpdateDisabled: app.commandLine.hasSwitch(
          "disable-component-update",
        ),
        quicDisabled: app.commandLine.hasSwitch("disable-quic"),
        proxyServerDisabled: app.commandLine.hasSwitch("no-proxy-server"),
        certificateTransparencyComponentUpdaterDisabled:
          disabledFeatures.includes(
            "CertificateTransparencyComponentUpdater",
          ),
        dialMediaRouteProviderDisabled: disabledFeatures.includes(
          "DialMediaRouteProvider",
        ),
        mediaRouterDisabled: disabledFeatures.includes("MediaRouter"),
      };
    });
    const runtime = {
      ...appRuntime,
      rendererProtocol: await page.evaluate(() => window.location.protocol),
      packagedOverrideCanary:
        packaged && process.env.MADI_PHASE1H_PACKAGED_OVERRIDE_CANARY === "1",
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
      forbiddenLocalPathFragments: [
        projectPath,
        dirname(projectPath),
        basename(projectPath),
        userDataPath,
        basename(userDataPath),
        repositoryRoot,
        desktopDirectory,
      ],
      lastActionability: null,
      productProcessDiagnostics: null,
      testTransportWrapperCleanupDiagnostics: null,
      hancomStatus: null,
      hwpExportExercised: false,
      atomicOutputExercised: false,
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
      "phase1h-force-close-timeout",
    );
  } finally {
    await processMonitor?.stop().catch(() => undefined);
  }
}

async function closeWindowCleanly(run) {
  const childProcess = run.application.process();
  verify(
    childProcess.pid === run.launcherProcessPid,
    "phase1h-application-launcher-identity",
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
  verify(productQuitObserved, "phase1h-product-lifecycle-quit");
  verify(
    productLifecycle.beforeQuit >= 1 &&
      productLifecycle.willQuit >= 1 &&
      productLifecycle.quit === 1 &&
      (productLifecycle.windowAllClosed === 0 ||
        productLifecycle.windowAllClosed === 1) &&
      productLifecycle.finalWillQuitBeforeQuit,
    "phase1h-product-lifecycle-contract",
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
  assertProductProcessDiagnosticDelta(
    productCloseToQuitProcessDiagnostics,
    "phase1h-product-close-to-quit-process-diagnostic-delta",
  );
  verify(
    !postProductQuitProcessDiagnostics.privateContentDetected,
    "phase1h-product-quit-process-diagnostic-privacy",
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
    "phase1h-test-transport-wrapper-cleanup-diagnostic-delta",
  );
  verify(
    !postCleanupProcessDiagnostics.privateContentDetected,
    "phase1h-test-transport-wrapper-cleanup-private-content",
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
    run.hancomStatus,
    run.hwpExportExercised,
    run.atomicOutputExercised,
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
    `$phase1hRootPid = ${rootPid}`,
    "$phase1hProcesses = Get-CimInstance Win32_Process",
    "$phase1hIds = @($phase1hRootPid)",
    "do { $phase1hPrevious = $phase1hIds.Count; $phase1hIds += @($phase1hProcesses | Where-Object { $phase1hIds -contains $_.ParentProcessId } | ForEach-Object ProcessId); $phase1hIds = @($phase1hIds | Sort-Object -Unique) } while ($phase1hIds.Count -ne $phase1hPrevious)",
    "$phase1hRows = @($phase1hProcesses | Where-Object { $phase1hIds -contains $_.ProcessId } | ForEach-Object { $phase1hProcess = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if ($phase1hProcess) { [PSCustomObject]@{ working = [double]$phase1hProcess.WorkingSet64; private = [double]$phase1hProcess.PrivateMemorySize64 } } })",
    "$phase1hRows | ConvertTo-Json -Compress",
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
  verify(processDiagnostics !== null, "phase1h-product-process-diagnostics-unsealed");
  return {
    runtime: run.runtime,
    rendererRequestCaptureMode: "PLAYWRIGHT_CONTEXT_REQUEST_AND_WEBSOCKET_EVENTS",
    requestCount: run.requestedUrls.length,
    externalRequestCount: externalUrls.length,
    rendererExternalRequestCount: externalUrls.length,
    externalRequests: externalUrls.map(redactExternalUrl),
    externalWebSocketCount: externalWebSockets.length,
    rendererExternalWebSocketCount: externalWebSockets.length,
    externalWebSockets: externalWebSockets.map(redactExternalUrl),
    localFileBlocked: !run.localFileProbe.readable,
    localFileStatus: run.localFileProbe.status,
    pageErrors: [...run.pageErrors],
    rendererDiagnostics: [...run.rendererDiagnostics],
    ...processDiagnostics,
  };
}

function assertSecurity(evidence) {
  verify(evidence.externalRequestCount === 0, "phase1h-external-runtime-request", {
    count: evidence.externalRequestCount,
    requests: evidence.externalRequests,
  });
  verify(evidence.externalWebSocketCount === 0, "phase1h-external-runtime-websocket", {
    count: evidence.externalWebSocketCount,
    sockets: evidence.externalWebSockets,
  });
  verify(evidence.localFileBlocked, "phase1h-local-file-readable", {
    status: evidence.localFileStatus,
  });
  verify(evidence.pageErrors.length === 0, "phase1h-page-errors", {
    count: evidence.pageErrors.length,
  });
  verify(evidence.rendererDiagnostics.length === 0, "phase1h-renderer-diagnostics", {
    count: evidence.rendererDiagnostics.length,
  });
  verify(
    evidence.unexpectedDiagnosticCount === 0,
    "phase1h-main-or-child-diagnostics",
    {
      mainCount: evidence.mainProcessDiagnostics.length,
      childStderrCount: evidence.childStderrDiagnostics.length,
    },
  );
  verify(
    !evidence.privateContentDetected && !evidence.rawPathOrUrlDetected,
    "phase1h-diagnostic-privacy",
    {
      privateContentDetected: evidence.privateContentDetected,
      rawPathOrUrlDetected: evidence.rawPathOrUrlDetected,
    },
  );
  verify(evidence.runtime.isPackaged === packaged, "phase1h-runtime-package-mode");
  verify(evidence.runtime.rendererProtocol === "madi:", "phase1h-runtime-protocol");
  verify(
    evidence.runtime.backgroundNetworkingDisabled === true &&
      evidence.runtime.componentUpdateDisabled === true &&
      evidence.runtime.quicDisabled === true &&
      evidence.runtime.proxyServerDisabled === true &&
      evidence.runtime.certificateTransparencyComponentUpdaterDisabled === true &&
      evidence.runtime.dialMediaRouteProviderDisabled === true &&
      evidence.runtime.mediaRouterDisabled === true,
    "phase1h-runtime-process-network-boundary",
    {
      backgroundNetworkingDisabled:
        evidence.runtime.backgroundNetworkingDisabled,
      componentUpdateDisabled: evidence.runtime.componentUpdateDisabled,
      quicDisabled: evidence.runtime.quicDisabled,
      proxyServerDisabled: evidence.runtime.proxyServerDisabled,
      certificateTransparencyComponentUpdaterDisabled:
        evidence.runtime.certificateTransparencyComponentUpdaterDisabled,
      dialMediaRouteProviderDisabled:
        evidence.runtime.dialMediaRouteProviderDisabled,
      mediaRouterDisabled: evidence.runtime.mediaRouterDisabled,
    },
  );
  verify(
    evidence.runtime.packagedOverrideCanary === packaged,
    "phase1h-runtime-packaged-override-canary",
  );
}

async function dialogEvidence(run) {
  return run.application.evaluate(() => {
    const state = Reflect.get(globalThis, "__madiPhase1hDialogState");
    if (!state || typeof state !== "object") {
      return null;
    }
    return {
      calls: { ...state.calls },
      remaining: {
        hwpx: state.hwpxPaths.length,
        hwp: state.hwpPaths.length,
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
    "phase1h-project-open",
    60_000,
  );
  verify(phase === "saved" || phase === "dirty", "phase1h-project-open-failed", {
    phase,
    pageErrorCount: run.pageErrors.length,
  });
}

function hasExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
  );
}

function xmlAttribute(source, name) {
  const match = source.match(new RegExp(`\\b${name}="([^"]*)"`, "u"));
  return match ? decodeXmlAttribute(match[1]) : null;
}

function assertWellFormedXml(xml, path) {
  const declarationEnd = xml.indexOf("?>") + 2;
  verify(declarationEnd > 1, "phase1h-xml-declaration-terminal", {
    path: structuralHash(path),
  });
  const body = xml.slice(declarationEnd);
  const tokenPattern =
    /<!--[\s\S]*?-->|<([A-Za-z_][\w.:-]*)(?:\s+[A-Za-z_][\w.:-]*="[^"]*")*\s*\/?>|<\/([A-Za-z_][\w.:-]*)\s*>/gu;
  const stack = [];
  let cursor = 0;
  let rootCount = 0;
  for (const token of body.matchAll(tokenPattern)) {
    const gap = body.slice(cursor, token.index);
    verify(!/[<>]/u.test(gap), "phase1h-xml-unparsed-markup", {
      path: structuralHash(path),
    });
    verify(
      !/&(?!(?:amp|lt|gt|quot|apos);|#[0-9]+;|#x[0-9a-f]+;)/iu.test(gap),
      "phase1h-xml-invalid-entity",
      { path: structuralHash(path) },
    );
    const [source, openingName, closingName] = token;
    if (openingName) {
      if (stack.length === 0) rootCount += 1;
      if (!source.endsWith("/>")) stack.push(openingName);
    } else if (closingName) {
      verify(
        stack.pop() === closingName,
        "phase1h-xml-unbalanced-element",
        { path: structuralHash(path) },
      );
    }
    cursor = token.index + source.length;
  }
  const tail = body.slice(cursor);
  verify(
    !/[<>]/u.test(tail) &&
      !/&(?!(?:amp|lt|gt|quot|apos);|#[0-9]+;|#x[0-9a-f]+;)/iu.test(tail) &&
      stack.length === 0 &&
      rootCount === 1,
    "phase1h-xml-well-formed-terminal",
    { path: structuralHash(path), rootCount, openElementCount: stack.length },
  );
}

function validateXmlDocument(xml, path) {
  verify(
    xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'),
    "phase1h-xml-declaration",
    { path: structuralHash(path) },
  );
  assertWellFormedXml(xml, path);
  verify(
    !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(xml),
    "phase1h-xml-control-character",
    { path: structuralHash(path) },
  );
  verify(
    !/&(?!(?:amp|lt|gt|quot|apos);|#[0-9]+;|#x[0-9a-f]+;)/iu.test(xml),
    "phase1h-xml-invalid-entity",
    { path: structuralHash(path) },
  );
  verify(
    !/<!DOCTYPE|<!ENTITY|<\?(?!xml\b)/iu.test(xml),
    "phase1h-xml-active-declaration",
    { path: structuralHash(path) },
  );
  verify(
    !/<(?:script|macro)\b/iu.test(xml),
    "phase1h-xml-active-element",
    { path: structuralHash(path) },
  );
  const namespaceDeclarations = [
    ...xml.matchAll(/\sxmlns(?::([A-Za-z_][\w.-]*))?="([^"]*)"/gu),
  ];
  const declarationEnd = xml.indexOf("?>") + 2;
  const rootEnd = xml.indexOf(">", declarationEnd);
  verify(
    namespaceDeclarations.every((declaration) => declaration.index < rootEnd),
    "phase1h-xml-nested-namespace-rebinding",
    { path: structuralHash(path) },
  );
  const namespacePrefixes = namespaceDeclarations.map(
    (declaration) => declaration[1] ?? "",
  );
  verify(
    new Set(namespacePrefixes).size === namespacePrefixes.length,
    "phase1h-xml-duplicate-namespace-prefix",
    { path: structuralHash(path) },
  );
  for (const match of xml.matchAll(/\b(?:href|src|full-path)="([^"]+)"/giu)) {
    const reference = decodeXmlAttribute(match[1]);
    verify(
      !/^[a-z][a-z0-9+.-]*:|^\/\/|^[A-Za-z]:|\\|(?:^|\/)\.\.(?:\/|$)/iu.test(
        reference,
      ),
      "phase1h-xml-external-or-unsafe-reference",
      { path: structuralHash(path), reference: structuralHash(reference) },
    );
  }
}

function assertExactRootNamespaces(xml, path, expected) {
  const actual = new Map(
    [...xml.matchAll(/\sxmlns(?::([A-Za-z_][\w.-]*))?="([^"]*)"/gu)].map(
      (declaration) => [declaration[1] ?? "", decodeXmlAttribute(declaration[2])],
    ),
  );
  verify(
    actual.size === Object.keys(expected).length &&
      Object.entries(expected).every(([prefix, uri]) => actual.get(prefix) === uri),
    "phase1h-xml-exact-root-namespaces",
    {
      path: structuralHash(path),
      expectedCount: Object.keys(expected).length,
      actualCount: actual.size,
    },
  );
}

function sectionPathIndex(path) {
  const match = path.match(/^Contents\/section(0|[1-9]\d*)\.xml$/u);
  return match ? Number(match[1]) : null;
}

function mmToHwpunit(value) {
  return Math.round((Number(value) * 72_000) / 254);
}

function deterministicFixtureText(characterCount) {
  const prefix = [..."한국어검증 <script>alert('&')</script> EPUB XML & < > "];
  const pattern = ["가", "나", "다", "라", " "];
  const characters = prefix.slice(0, characterCount);
  while (characters.length < characterCount) {
    characters.push(pattern[(characters.length - prefix.length) % pattern.length]);
  }
  return characters.join("");
}

function verifyFixtureParagraphSequence(actual, expected) {
  const charactersPerSection = expected.fixtureTextCharactersPerSection;
  const firstCharacterCount = Math.floor(charactersPerSection / 2);
  const first = deterministicFixtureText(firstCharacterCount);
  const second = deterministicFixtureText(
    charactersPerSection - firstCharacterCount,
  );
  verify(
    actual.length === expected.sectionCount * 3,
    "phase1h-hwpx-source-paragraph-count",
    { expected: expected.sectionCount * 3, actual: actual.length },
  );
  for (let sectionIndex = 0; sectionIndex < expected.sectionCount; sectionIndex += 1) {
    const offset = sectionIndex * 3;
    verify(
      actual[offset] === first &&
        actual[offset + 1] === "" &&
        actual[offset + 2] === second,
      "phase1h-hwpx-source-paragraph-sequence",
      { sectionIndex },
    );
  }
  const sequenceHash = createHash("sha256");
  for (const text of actual) {
    sequenceHash.update(String(Buffer.byteLength(text, "utf8")));
    sequenceHash.update(":");
    sequenceHash.update(text, "utf8");
    sequenceHash.update("\0");
  }
  return sequenceHash.digest("hex");
}

function validateGeneratedHwpx(bytes, expected) {
  const archive = parseZip(bytes);
  const first = archive.entries[0];
  verify(
    first.path === "mimetype" && first.localOffset === 0 && first.compression === 0,
    "phase1h-hwpx-mimetype-container-contract",
  );
  verify(
    first.content.equals(Buffer.from("application/hwp+zip", "ascii")),
    "phase1h-hwpx-mimetype-content",
  );
  const lowerPaths = archive.entries.map((entry) => entry.path.toLocaleLowerCase());
  verify(
    new Set(lowerPaths).size === lowerPaths.length,
    "phase1h-zip-case-collision",
  );
  const sectionEntries = archive.entries
    .map((entry) => ({ entry, index: sectionPathIndex(entry.path) }))
    .filter((item) => item.index !== null)
    .sort((left, right) => left.index - right.index);
  verify(
    sectionEntries.length === expected.packageSectionCount &&
      sectionEntries.every((item, index) => item.index === index),
    "phase1h-hwpx-physical-sections",
    {
      expected: expected.packageSectionCount,
      actual: sectionEntries.length,
    },
  );
  const expectedPaths = new Set([
    "mimetype",
    "version.xml",
    "Contents/header.xml",
    "settings.xml",
    "META-INF/container.rdf",
    "Contents/content.hpf",
    "META-INF/container.xml",
    "META-INF/manifest.xml",
    ...sectionEntries.map((item) => item.entry.path),
  ]);
  verify(
    archive.entries.length === expectedPaths.size &&
      archive.entries.every((entry) => expectedPaths.has(entry.path)),
    "phase1h-hwpx-exact-entry-set",
    { expected: expectedPaths.size, actual: archive.entries.length },
  );

  const xmlByPath = new Map();
  for (const entry of archive.entries) {
    if (entry.path === "mimetype") {
      continue;
    }
    const xml = requireUtf8Entry(archive, entry.path);
    validateXmlDocument(xml, entry.path);
    xmlByPath.set(entry.path, xml);
  }
  const localPathScan = assertNoLocalPathsInXml(
    xmlByPath,
    expected.forbiddenLocalPathFragments,
  );
  const version = xmlByPath.get("version.xml");
  assertExactRootNamespaces(version, "version.xml", {
    hv: "http://www.hancom.co.kr/hwpml/2011/version",
  });
  verify(
    /<hv:HCFVersion\b/u.test(version) &&
      xmlAttribute(version, "xmlns:hv") ===
        "http://www.hancom.co.kr/hwpml/2011/version" &&
      xmlAttribute(version, "xmlVersion") === "1.31" &&
      xmlAttribute(version, "application") === "madi",
    "phase1h-hwpx-version-contract",
  );
  const settings = xmlByPath.get("settings.xml");
  assertExactRootNamespaces(settings, "settings.xml", {
    ha: "http://www.hancom.co.kr/hwpml/2011/app",
  });
  verify(
    /<ha:HWPApplicationSetting\b/u.test(settings) &&
      xmlAttribute(settings, "xmlns:ha") ===
        "http://www.hancom.co.kr/hwpml/2011/app" &&
      /<ha:CaretPosition\b[^>]*\blistIDRef="0"[^>]*\bparaIDRef="0"[^>]*\bpos="0"/u.test(
        settings,
      ),
    "phase1h-hwpx-settings-contract",
  );
  const rdf = xmlByPath.get("META-INF/container.rdf");
  assertExactRootNamespaces(rdf, "META-INF/container.rdf", {
    rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  });
  verify(
    /<rdf:RDF\b/u.test(rdf) &&
      xmlAttribute(rdf, "xmlns:rdf") ===
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "phase1h-hwpx-rdf-contract",
  );
  const manifestXml = xmlByPath.get("META-INF/manifest.xml");
  assertExactRootNamespaces(manifestXml, "META-INF/manifest.xml", {
    odf: "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0",
  });
  verify(
    /<odf:manifest\b/u.test(manifestXml) &&
      xmlAttribute(manifestXml, "xmlns:odf") ===
        "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0",
    "phase1h-hwpx-odf-manifest-contract",
  );
  const container = xmlByPath.get("META-INF/container.xml");
  assertExactRootNamespaces(container, "META-INF/container.xml", {
    ocf: "urn:oasis:names:tc:opendocument:xmlns:container",
  });
  verify(
    /<ocf:container\b/u.test(container) &&
      xmlAttribute(container, "xmlns:ocf") ===
        "urn:oasis:names:tc:opendocument:xmlns:container",
    "phase1h-hwpx-container-namespace",
  );
  const rootfiles = [...container.matchAll(/<ocf:rootfile\b([^>]*)\/>/gu)].map(
    (match) => ({
      path: xmlAttribute(match[1], "full-path"),
      mediaType: xmlAttribute(match[1], "media-type"),
    }),
  );
  verify(
    rootfiles.length === 2 &&
      rootfiles.some(
        (item) =>
          item.path === "Contents/content.hpf" &&
          item.mediaType === "application/hwpml-package+xml",
      ) &&
      rootfiles.some(
        (item) =>
          item.path === "META-INF/container.rdf" &&
          item.mediaType === "application/rdf+xml",
      ),
    "phase1h-hwpx-container-rootfiles",
  );

  const content = xmlByPath.get("Contents/content.hpf");
  assertExactRootNamespaces(content, "Contents/content.hpf", {
    opf: "http://www.idpf.org/2007/opf/",
  });
  verify(
    /<opf:package\b/u.test(content) &&
      xmlAttribute(content, "xmlns:opf") === "http://www.idpf.org/2007/opf/" &&
      /<opf:metadata\b/u.test(content) &&
      /<opf:manifest\b/u.test(content) &&
      /<opf:spine\b/u.test(content),
    "phase1h-hwpx-content-root",
  );
  const items = [...content.matchAll(/<opf:item\b([^>]*)\/>/gu)].map((match) => ({
    id: xmlAttribute(match[1], "id"),
    href: xmlAttribute(match[1], "href"),
    mediaType: xmlAttribute(match[1], "media-type"),
  }));
  verify(
    items.length === expected.packageSectionCount + 2 &&
      new Set(items.map((item) => item.id)).size === items.length &&
      new Set(items.map((item) => item.href)).size === items.length,
    "phase1h-hwpx-content-manifest-shape",
  );
  const expectedItems = new Map([
    ["header", "Contents/header.xml"],
    ["settings", "settings.xml"],
    ...sectionEntries.map((item) => [
      `section${item.index}`,
      `Contents/section${item.index}.xml`,
    ]),
  ]);
  verify(
    items.every(
      (item) =>
        expectedItems.get(item.id) === item.href &&
        item.mediaType === "application/xml" &&
        archive.byPath.has(item.href),
    ),
    "phase1h-hwpx-content-manifest-reference",
  );
  const spine = [...content.matchAll(/<opf:itemref\b([^>]*)\/>/gu)].map(
    (match) => ({
      idref: xmlAttribute(match[1], "idref"),
      linear: xmlAttribute(match[1], "linear"),
    }),
  );
  verify(
    spine.length === expected.packageSectionCount &&
      spine.every(
        (item, index) =>
          item.idref === `section${index}` &&
          item.linear === "yes" &&
          expectedItems.has(item.idref),
      ),
    "phase1h-hwpx-content-spine-reference",
  );

  const header = xmlByPath.get("Contents/header.xml");
  assertExactRootNamespaces(header, "Contents/header.xml", {
    hh: "http://www.hancom.co.kr/hwpml/2011/head",
    hc: "http://www.hancom.co.kr/hwpml/2011/core",
  });
  const headerRootTag = header.match(/<hh:head\b[^>]*>/u)?.[0] ?? "";
  verify(headerRootTag !== "", "phase1h-hwpx-header-root-element");
  verify(
    xmlAttribute(headerRootTag, "xmlns:hh") ===
      "http://www.hancom.co.kr/hwpml/2011/head" &&
      xmlAttribute(headerRootTag, "xmlns:hc") ===
        "http://www.hancom.co.kr/hwpml/2011/core",
    "phase1h-hwpx-header-root-namespace",
  );
  verify(
    Number(xmlAttribute(headerRootTag, "secCnt")) === expected.packageSectionCount,
    "phase1h-hwpx-header-section-count",
  );
  verify(
    xmlAttribute(headerRootTag, "version") === "1.5",
    "phase1h-hwpx-header-version",
  );
  verify(
    new RegExp(
      `<hh:beginNum\\b[^>]*\\bpage="${expected.pageNumberStart}"`,
      "u",
    ).test(header),
    "phase1h-hwpx-header-page-number-start",
  );
  for (const requiredTable of [
    "fontfaces",
    "charProperties",
    "paraProperties",
    "styles",
  ]) {
    verify(
      new RegExp(`<hh:${requiredTable}\\b`, "u").test(header),
      "phase1h-hwpx-header-table",
      { table: structuralHash(requiredTable) },
    );
  }
  const fontfaceBlocks = [
    ...header.matchAll(/<hh:fontface\b([^>]*)>([\s\S]*?)<\/hh:fontface>/gu),
  ];
  verify(
    fontfaceBlocks.length === 7 &&
      new Set(fontfaceBlocks.map((match) => xmlAttribute(match[1], "lang"))).size ===
        7,
    "phase1h-hwpx-fontface-languages",
  );
  let fontIds = null;
  for (const fontface of fontfaceBlocks) {
    const fontRecords = [
      ...fontface[2].matchAll(/<hh:font\b([^>]*)\/>/gu),
    ];
    const ids = fontRecords.map((match) => xmlAttribute(match[1], "id"));
    verify(
      ids.length === Number(xmlAttribute(fontface[1], "fontCnt")) &&
        new Set(ids).size === ids.length &&
        fontRecords.some(
          (record) =>
            xmlAttribute(record[1], "id") === "0" &&
            xmlAttribute(record[1], "face") === expected.fontFamily,
        ),
      "phase1h-hwpx-fontface-count",
    );
    if (fontIds === null) {
      fontIds = new Set(ids);
    } else {
      verify(
        ids.length === fontIds.size && ids.every((id) => fontIds.has(id)),
        "phase1h-hwpx-fontface-id-consistency",
      );
    }
  }
  const borderFillRecords = [
    ...header.matchAll(/<hh:borderFill\b([^>]*)\/>/gu),
  ];
  const borderFillIds = new Set(
    borderFillRecords.map((match) => xmlAttribute(match[1], "id")),
  );
  const tabRecords = [...header.matchAll(/<hh:tabPr\b([^>]*)\/>/gu)];
  const tabIds = new Set(tabRecords.map((match) => xmlAttribute(match[1], "id")));
  const charPrRecords = [
    ...header.matchAll(/<hh:charPr\b([^>]*)>([\s\S]*?)<\/hh:charPr>/gu),
  ];
  const charPrIds = new Set(
    charPrRecords.map((match) => xmlAttribute(match[1], "id")),
  );
  const paraPrRecords = [
    ...header.matchAll(/<hh:paraPr\b([^>]*)>([\s\S]*?)<\/hh:paraPr>/gu),
  ];
  const paraPrIds = new Set(
    paraPrRecords.map((match) => xmlAttribute(match[1], "id")),
  );
  const styleRecords = [...header.matchAll(/<hh:style\b([^>]*)\/>/gu)].map(
    (match) => ({
      id: xmlAttribute(match[1], "id"),
      paraPr: xmlAttribute(match[1], "paraPrIDRef"),
      charPr: xmlAttribute(match[1], "charPrIDRef"),
    }),
  );
  const styleIds = new Set(styleRecords.map((style) => style.id));
  verify(
    Number(xmlAttribute(header.match(/<hh:fontfaces\b([^>]*)>/u)?.[1] ?? "", "itemCnt")) ===
      fontfaceBlocks.length &&
      Number(
        xmlAttribute(header.match(/<hh:borderFills\b([^>]*)>/u)?.[1] ?? "", "itemCnt"),
      ) === borderFillRecords.length &&
      Number(
        xmlAttribute(
          header.match(/<hh:charProperties\b([^>]*)>/u)?.[1] ?? "",
          "itemCnt",
        ),
      ) === charPrRecords.length &&
      Number(
        xmlAttribute(
          header.match(/<hh:tabProperties\b([^>]*)>/u)?.[1] ?? "",
          "itemCnt",
        ),
      ) === tabRecords.length &&
      Number(
        xmlAttribute(
          header.match(/<hh:paraProperties\b([^>]*)>/u)?.[1] ?? "",
          "itemCnt",
        ),
      ) === paraPrRecords.length &&
      Number(xmlAttribute(header.match(/<hh:styles\b([^>]*)>/u)?.[1] ?? "", "itemCnt")) ===
        styleRecords.length &&
    borderFillRecords.length === borderFillIds.size &&
      tabRecords.length === tabIds.size &&
      charPrRecords.length === charPrIds.size &&
      paraPrRecords.length === paraPrIds.size &&
      styleRecords.length === styleIds.size &&
      charPrIds.size >= 26 &&
      paraPrIds.size === 11 &&
      styleIds.size === 11 &&
      styleRecords.every(
        (style) => paraPrIds.has(style.paraPr) && charPrIds.has(style.charPr),
      ) &&
      charPrRecords.every((record) => {
        if (!borderFillIds.has(xmlAttribute(record[1], "borderFillIDRef"))) {
          return false;
        }
        const fontRef = record[2].match(/<hh:fontRef\b([^>]*)\/>/u)?.[1];
        return (
          fontRef &&
          ["hangul", "latin", "hanja", "japanese", "other", "symbol", "user"].every(
            (language) => fontIds.has(xmlAttribute(fontRef, language)),
          )
        );
      }) &&
      paraPrRecords.every(
        (record) =>
          tabIds.has(xmlAttribute(record[1], "tabPrIDRef")) &&
          borderFillIds.has(
            xmlAttribute(record[2].match(/<hh:border\b([^>]*)\/>/u)?.[1] ?? "", "borderFillIDRef"),
          ),
      ),
    "phase1h-hwpx-style-reference-table",
  );
  const bodyCharProperty = charPrRecords.find(
    (record) => xmlAttribute(record[1], "id") === "0",
  );
  const bodyParagraphProperty = paraPrRecords.find(
    (record) => xmlAttribute(record[1], "id") === "0",
  );
  const bodyLineSpacing = bodyParagraphProperty?.[2].match(
    /<hh:lineSpacing\b([^>]*)\/>/u,
  )?.[1];
  verify(
    Number(xmlAttribute(bodyCharProperty?.[1] ?? "", "height")) ===
      expected.fontSizeHundredths &&
      xmlAttribute(bodyLineSpacing ?? "", "type") === expected.lineSpacing.type &&
      Number(xmlAttribute(bodyLineSpacing ?? "", "value")) ===
        expected.lineSpacing.value,
    "phase1h-hwpx-decimal-typography-rounding",
  );
  const charPrBodies = new Map(
    [...header.matchAll(/<hh:charPr\b([^>]*)>([\s\S]*?)<\/hh:charPr>/gu)].map(
      (match) => [xmlAttribute(match[1], "id"), match[2]],
    ),
  );
  verify(
    charPrBodies.get("1")?.includes("<hh:bold/>") &&
      charPrBodies.get("2")?.includes("<hh:italic/>") &&
      charPrBodies.get("4")?.includes("<hh:underline ") &&
      charPrBodies.get("8")?.includes("<hh:strikeout "),
    "phase1h-hwpx-rich-style-table",
  );

  const paragraphIds = [];
  const sourceParagraphTexts = [];
  const observedRichRefs = new Set();
  let sourceCharacterCount = 0;
  let observedRubyFallbackCount = 0;
  let decodedText = "";
  let runCount = 0;
  for (const { entry, index } of sectionEntries) {
    const section = xmlByPath.get(entry.path);
    assertExactRootNamespaces(section, entry.path, {
      hs: "http://www.hancom.co.kr/hwpml/2011/section",
      hp: "http://www.hancom.co.kr/hwpml/2011/paragraph",
    });
    const sectionRootTag = section.match(/<hs:sec\b[^>]*>/u)?.[0] ?? "";
    const pagePr = section.match(/<hp:pagePr\b([^>]*)>/u)?.[1] ?? "";
    const margin = section.match(/<hp:margin\b([^>]*)\/>/u)?.[1] ?? "";
    const startNum = section.match(/<hp:startNum\b([^>]*)\/>/u)?.[1] ?? "";
    verify(sectionRootTag !== "", "phase1h-hwpx-section-root-element", {
      path: structuralHash(entry.path),
    });
    verify(
      xmlAttribute(sectionRootTag, "xmlns:hs") ===
          "http://www.hancom.co.kr/hwpml/2011/section" &&
        xmlAttribute(sectionRootTag, "xmlns:hp") ===
          "http://www.hancom.co.kr/hwpml/2011/paragraph",
      "phase1h-hwpx-section-root-namespace",
      { path: structuralHash(entry.path) },
    );
    verify(
      /<hp:secPr\b/u.test(section) &&
        Number(xmlAttribute(startNum, "page")) ===
          (index === 0 ? expected.pageNumberStart : 0),
      "phase1h-hwpx-section-start-number",
      { path: structuralHash(entry.path) },
    );
    verify(
      xmlAttribute(pagePr, "landscape") === expected.page.landscape &&
        Number(xmlAttribute(pagePr, "width")) === expected.page.width &&
        Number(xmlAttribute(pagePr, "height")) === expected.page.height,
      "phase1h-hwpx-section-page-geometry",
      { path: structuralHash(entry.path) },
    );
    verify(
      Number(xmlAttribute(margin, "left")) === expected.page.left &&
        Number(xmlAttribute(margin, "right")) === expected.page.right &&
        Number(xmlAttribute(margin, "top")) === expected.page.top &&
        Number(xmlAttribute(margin, "bottom")) === expected.page.bottom &&
        Number(xmlAttribute(margin, "header")) === expected.page.header &&
        Number(xmlAttribute(margin, "footer")) === expected.page.footer &&
        Number(xmlAttribute(margin, "gutter")) === expected.page.gutter,
      "phase1h-hwpx-section-page-margin",
      { path: structuralHash(entry.path) },
    );
    verify(
      !expected.includePageNumber ||
        new RegExp(
          `<hp:pageNum\\b[^>]*\\bpos="${expected.pageNumberPosition}"[^>]*/>`,
          "u",
        ).test(section),
      "phase1h-hwpx-page-number",
    );
    const headerText = section.match(
      /<hp:header\b[\s\S]*?<hp:t>([\s\S]*?)<\/hp:t>[\s\S]*?<\/hp:header>/u,
    )?.[1];
    const footerText = section.match(
      /<hp:footer\b[\s\S]*?<hp:t>([\s\S]*?)<\/hp:t>[\s\S]*?<\/hp:footer>/u,
    )?.[1];
    verify(
      (expected.includeHeader
        ? decodeXmlAttribute(headerText ?? "") === expected.headerText
        : headerText === undefined) &&
        (expected.includeFooter
          ? decodeXmlAttribute(footerText ?? "") === expected.footerText
          : footerText === undefined),
      "phase1h-hwpx-header-footer",
    );
    for (const match of section.matchAll(/<hp:p\b([^>]*)>/gu)) {
      const id = xmlAttribute(match[1], "id");
      const paraRef = xmlAttribute(match[1], "paraPrIDRef");
      const styleRef = xmlAttribute(match[1], "styleIDRef");
      verify(
        id !== null && paraPrIds.has(paraRef) && styleIds.has(styleRef),
        "phase1h-hwpx-paragraph-reference",
      );
      paragraphIds.push(id);
    }
    for (const match of section.matchAll(/<hp:run\b([^>]*)>/gu)) {
      runCount += 1;
      const charRef = xmlAttribute(match[1], "charPrIDRef");
      verify(charPrIds.has(charRef), "phase1h-hwpx-run-reference");
      if (["1", "2", "4", "8"].includes(charRef)) {
        observedRichRefs.add(charRef);
      }
    }
    const withoutControls = section.replace(/<hp:ctrl>[\s\S]*?<\/hp:ctrl>/gu, "");
    for (const paragraph of withoutControls.matchAll(
      /<hp:p\b([^>]*)>([\s\S]*?)<\/hp:p>/gu,
    )) {
      const styleRef = xmlAttribute(paragraph[1], "styleIDRef");
      const text = [...paragraph[2].matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/gu)]
        .map((match) => decodeXmlAttribute(match[1]))
        .join("");
      decodedText += text;
      if (styleRef === "0" || styleRef === "5") {
        const rubyFallbackCount = text.split(rubyFallbackText).length - 1;
        observedRubyFallbackCount += rubyFallbackCount;
        const sourceText = text.replaceAll(rubyFallbackText, "");
        sourceCharacterCount += [...sourceText].length;
        if (!paragraph[2].includes("<hp:secPr")) {
          sourceParagraphTexts.push(sourceText);
        }
      }
    }
  }
  verify(
    new Set(paragraphIds).size === paragraphIds.length,
    "phase1h-hwpx-global-paragraph-id",
  );
  verify(
    sourceCharacterCount === expected.characterCount,
    "phase1h-hwpx-source-character-coverage",
    { expected: expected.characterCount, actual: sourceCharacterCount },
  );
  const sourceParagraphSequenceHash = verifyFixtureParagraphSequence(
    sourceParagraphTexts,
    expected,
  );
  const titlePageContactOccurrences = [...xmlByPath.entries()].flatMap(
    ([path, xml]) =>
      Array.from({ length: xml.split(expected.contactText).length - 1 }, () => path),
  );
  const contactTitleParagraphs = [
    ...xmlByPath
      .get("Contents/section0.xml")
      .matchAll(/<hp:p\b([^>]*)>([\s\S]*?)<\/hp:p>/gu),
  ].filter(
    (paragraph) =>
      xmlAttribute(paragraph[1], "styleIDRef") === "8" &&
      paragraph[2].includes(`<hp:t>${expected.contactText}</hp:t>`),
  );
  verify(
    titlePageContactOccurrences.length === 1 &&
      titlePageContactOccurrences[0] === "Contents/section0.xml" &&
      contactTitleParagraphs.length === 1,
    "phase1h-hwpx-title-page-contact-isolation",
  );
  verify(
    decodedText.includes("한국어검증") &&
      decodedText.includes("<script>alert('&')</script>") &&
      observedRichRefs.size === 4 &&
      observedRubyFallbackCount === expected.rubyCount &&
      decodedText.includes(rubyFallbackText) &&
      expected.omittedHeadingTexts.every((text) => !decodedText.includes(text)),
    "phase1h-hwpx-korean-rich-ruby-fallback",
    {
      korean: decodedText.includes("한국어검증"),
      xmlEscaping: decodedText.includes("<script>alert('&')</script>"),
      richRefCount: observedRichRefs.size,
      rubyFallbackCount: observedRubyFallbackCount,
    },
  );
  const result = {
    fileCount: archive.entries.length,
    packageSectionCount: sectionEntries.length,
    sourceCharacterCount,
    sourceParagraphSequenceHash,
    sourceParagraphSequenceVerified: true,
    paragraphIdCount: paragraphIds.length,
    runCount,
    manifestItemCount: items.length,
    spineItemCount: spine.length,
    koreanTextPresent: true,
    xmlSpecialTextRoundTripped: true,
    strongPreserved: true,
    emphasisPreserved: true,
    underlinePreserved: true,
    strikePreserved: true,
    rubyPlainTextFallback: true,
    rubyAnnotationPreserved: true,
    titlePageContactIsolated: true,
    localPathScan,
  };
  return result;
}

function validateFixtureManifest(manifest) {
  verify(
    hasExactKeys(manifest, ["formatVersion", "fixtures"]) &&
      manifest.formatVersion === 1 &&
      hasExactKeys(manifest.fixtures, ["normal", "long"]),
    "phase1h-fixture-manifest-shape",
  );
  for (const profile of ["normal", "long"]) {
    const fixture = manifest.fixtures[profile];
    verify(
      fixture &&
        typeof fixture.relativePath === "string" &&
        Number.isSafeInteger(fixture.bytes) &&
        fixture.bytes > 0 &&
        /^[a-f0-9]{64}$/u.test(fixture.sha256) &&
        fixture.ids &&
        fixture.inventory &&
        fixture.scopes,
      "phase1h-fixture-shape",
      { profile },
    );
    verify(
      fixture.inventory.scenes > 0 &&
        fixture.inventory.blocks > fixture.inventory.scenes &&
        fixture.inventory.characters > 0,
      "phase1h-fixture-inventory",
      { profile },
    );
    for (const scopeKind of ["WORK", "VOLUME", "CHAPTER", "SCENE"]) {
      const scope = fixture.scopes[scopeKind];
      verify(
        scope?.scopeKind === scopeKind &&
          scope.scopeNodeId &&
          Number.isSafeInteger(scope.sections) &&
          scope.sections > 0 &&
          Number.isSafeInteger(scope.blocks) &&
          scope.blocks > 0 &&
          Number.isSafeInteger(scope.withSpaces) &&
          scope.withSpaces > 0 &&
          Number.isSafeInteger(scope.chapters) &&
          scope.chapters > 0,
        "phase1h-fixture-scope",
        { profile, scopeKind },
      );
    }
  }
  verify(
    manifest.fixtures.normal.inventory.scenes === 60,
    "phase1h-fixture-profile-size",
  );
  const longInventory = manifest.fixtures.long.inventory;
  verify(
    Number.isSafeInteger(longInventory.scenes) &&
      longInventory.scenes >= LONG_FIXTURE_MINIMUM_SCENES &&
      Number.isSafeInteger(longInventory.characters) &&
      longInventory.characters >= LONG_FIXTURE_MINIMUM_CHARACTERS &&
      Number.isSafeInteger(longInventory.blocks) &&
      longInventory.blocks >= LONG_FIXTURE_MINIMUM_BLOCKS,
    "phase1h-long-fixture-minimum-size",
    {
      observed: {
        scenes: longInventory.scenes,
        characters: longInventory.characters,
        blocks: longInventory.blocks,
      },
      minimum: {
        scenes: LONG_FIXTURE_MINIMUM_SCENES,
        characters: LONG_FIXTURE_MINIMUM_CHARACTERS,
        blocks: LONG_FIXTURE_MINIMUM_BLOCKS,
      },
    },
  );
  return manifest;
}

async function prepareFixture(profile, manifest, temporaryRoot) {
  const fixture = manifest.fixtures[profile];
  const sourcePath = resolve(repositoryRoot, fixture.relativePath);
  verify(isWithin(sourcePath, repositoryRoot), "phase1h-fixture-source-scope");
  const sourceStats = await stat(sourcePath);
  verify(
    sourceStats.isFile() && sourceStats.size === fixture.bytes,
    "phase1h-fixture-byte-size",
    { profile },
  );
  verify((await sha256File(sourcePath)) === fixture.sha256, "phase1h-fixture-sha256", {
    profile,
  });
  const projectPath = resolve(temporaryRoot, `${profile}.madi`);
  verify(isWithin(projectPath, temporaryRoot), "phase1h-fixture-copy-scope");
  await copyFile(sourcePath, projectPath);
  return { fixture, projectPath };
}

function scopeNodeId(fixture, scopeKind) {
  const key =
    scopeKind === "WORK"
      ? "workId"
      : scopeKind === "VOLUME"
        ? "volumeId"
        : scopeKind === "CHAPTER"
          ? "chapterId"
          : "sceneId";
  const id = fixture.ids[key];
  verify(id === fixture.scopes[scopeKind].scopeNodeId, "phase1h-scope-node-identity");
  return id;
}

function expectedExport(fixture, scopeKind, splitMode) {
  const scope = fixture.scopes[scopeKind];
  verify(
    scope.withSpaces % scope.sections === 0,
    "phase1h-fixture-section-character-uniformity",
    { scopeKind },
  );
  const headingCount = scope.blocks - scope.sections * 4;
  const packageSectionCount =
    splitMode === "VOLUME" && scopeKind === "WORK"
      ? fixture.inventory.volumes
      : 1;
  return {
    scopeKind,
    sourceScopeNodeId: fixture.scopes[scopeKind].scopeNodeId,
    splitMode,
    sectionCount: scope.sections,
    packageSectionCount,
    blockCount: scope.blocks,
    characterCount: scope.withSpaces,
    fixtureTextCharactersPerSection: scope.withSpaces / scope.sections,
    headingCount,
    sceneBreakCount: scope.sections,
    rubyCount: scope.sections,
    inlineModifierCount: scope.sections * 4,
    fallbackBlockCount: scope.sections,
    configuredOmissionBlockCount: 0,
    exportedBlockCount: scope.blocks - scope.sections,
    includePageNumber: true,
    pageNumberPosition: null,
    contactText: privateContact,
    omittedHeadingTexts: [],
  };
}

function sourceHeadingCounts(fixture, scopeKind) {
  const scope = fixture.scopes[scopeKind];
  const counts =
    scopeKind === "WORK"
      ? {
          work: 1,
          volume: fixture.inventory.volumes,
          chapter: scope.chapters,
          scene: scope.sections,
        }
      : scopeKind === "VOLUME"
        ? { work: 1, volume: 1, chapter: scope.chapters, scene: scope.sections }
        : scopeKind === "CHAPTER"
          ? { work: 1, volume: 1, chapter: 1, scene: scope.sections }
          : { work: 1, volume: 1, chapter: 1, scene: 1 };
  verify(
    Object.values(counts).every((count) => Number.isSafeInteger(count) && count > 0) &&
      Object.values(counts).reduce((sum, count) => sum + count, 0) ===
        scope.blocks - scope.sections * 4,
    "phase1h-fixture-heading-inventory",
    { scopeKind },
  );
  return counts;
}

function assertReportPrivacy(text, code) {
  const leakedFragmentIndexes = privateContentFragments.flatMap((fragment, index) =>
    text.includes(fragment) ? [index] : [],
  );
  verify(leakedFragmentIndexes.length === 0, code, { leakedFragmentIndexes });
  verify(!/[A-Za-z]:\\|file:\/\/|https?:\/\/|wss?:\/\//u.test(text), `${code}-path-url`);
  return {
    privateContentAbsent: true,
    contactAbsent: !text.includes(privateContact),
    rawPathAbsent: true,
    externalUrlAbsent: true,
  };
}

function validateExportReport(report, expected, output, hwp = null) {
  verify(
    hasExactKeys(report, [
      "formatVersion",
      "outputType",
      "packageProfile",
      "sourceScope",
      "sourceScopeNodeId",
      "sourceProjectRevision",
      "sourcePublicationHash",
      "presetId",
      "presetContentHash",
      "hwpxSha256",
      "outputSha256",
      "preservedHwpxFileName",
      "logicalPackageHash",
      "byteLength",
      "coverage",
      "validation",
      "fontFamily",
      "fontInstalled",
      "page",
      "hancomReopen",
      "hwpConverted",
      "timing",
      "generatedAt",
      "madiVersion",
    ]),
    "phase1h-report-exact-shape",
  );
  verify(
    report.formatVersion === 1 &&
      report.outputType === (hwp ? "HWP" : "HWPX") &&
      report.packageProfile === "HANCOM_OFFICIAL_MODEL_1_31" &&
      report.sourceScope === expected.scopeKind &&
      report.sourceScopeNodeId === expected.sourceScopeNodeId &&
      /^[a-f0-9]{64}$/u.test(report.sourcePublicationHash) &&
      /^[a-f0-9]{64}$/u.test(report.presetContentHash) &&
      /^[a-f0-9]{64}$/u.test(report.logicalPackageHash) &&
      report.hwpxSha256 === (hwp ? hwp.preservedHwpxSha256 : output.sha256) &&
      report.outputSha256 === output.sha256 &&
      report.preservedHwpxFileName === (hwp ? hwp.preservedHwpxFileName : null) &&
      report.byteLength === output.byteLength &&
      report.hancomReopen === (hwp ? "PASSED" : "NOT_RUN") &&
      report.hwpConverted === Boolean(hwp) &&
      Number.isSafeInteger(report.sourceProjectRevision) &&
      report.sourceProjectRevision >= 0 &&
      typeof report.presetId === "string" &&
      report.presetId.length > 0 &&
      typeof report.fontFamily === "string" &&
      report.fontFamily === expected.fontFamily &&
      (report.fontInstalled === null || typeof report.fontInstalled === "boolean") &&
      typeof report.generatedAt === "string" &&
      Number.isFinite(Date.parse(report.generatedAt)) &&
      typeof report.madiVersion === "string" &&
      report.madiVersion.length > 0,
    "phase1h-report-identity",
  );
  const coverage = report.coverage;
  verify(
    hasExactKeys(coverage, [
      "packageSectionCount",
      "sourceSectionCount",
      "exportedSectionCount",
      "sourceBlockCount",
      "exportedBlockCount",
      "fallbackBlockCount",
      "configuredOmissionBlockCount",
      "rejectedBlockCount",
      "sourceCharacterCount",
      "exportedCharacterCount",
      "paragraphCount",
      "runCount",
      "headingCount",
      "sceneBreakCount",
      "rubyCount",
      "inlineModifierCount",
    ]) &&
      coverage.packageSectionCount === expected.packageSectionCount &&
      coverage.sourceSectionCount === expected.sectionCount &&
      coverage.exportedSectionCount === expected.sectionCount &&
      coverage.sourceBlockCount === expected.blockCount &&
      coverage.exportedBlockCount === expected.exportedBlockCount &&
      coverage.fallbackBlockCount === expected.fallbackBlockCount &&
      coverage.configuredOmissionBlockCount ===
        expected.configuredOmissionBlockCount &&
      coverage.rejectedBlockCount === 0 &&
      coverage.exportedBlockCount +
          coverage.fallbackBlockCount +
          coverage.configuredOmissionBlockCount +
          coverage.rejectedBlockCount ===
        coverage.sourceBlockCount &&
      coverage.sourceCharacterCount === expected.characterCount &&
      coverage.exportedCharacterCount === expected.characterCount &&
      coverage.headingCount === expected.headingCount &&
      coverage.sceneBreakCount === expected.sceneBreakCount &&
      coverage.rubyCount === expected.rubyCount &&
      coverage.inlineModifierCount === expected.inlineModifierCount &&
      coverage.paragraphCount >=
        expected.exportedBlockCount + expected.fallbackBlockCount &&
      coverage.runCount >= expected.exportedBlockCount + expected.fallbackBlockCount,
    "phase1h-report-coverage",
  );
  const validation = report.validation;
  verify(
    hasExactKeys(validation, [
      "status",
      "fatalCount",
      "errorCount",
      "warningCount",
      "infoCount",
      "messages",
    ]) &&
      Array.isArray(validation.messages) &&
      validation.messages.every((message) =>
        hasExactKeys(message, [
          "severity",
          "code",
          "description",
          "suggestion",
          "sourceNodeId",
          "sectionId",
          "hwpxPath",
        ]),
      ),
    "phase1h-report-validation-shape",
  );
  const rubyMessages = validation.messages.filter(
    (message) => message.code === "HWPX_RUBY_PLAIN_TEXT_FALLBACK",
  );
  const omissionMessages = validation.messages.filter(
    (message) => message.code === "HWPX_CONFIGURED_HEADING_OMISSION",
  );
  const fontMessages = validation.messages.filter((message) =>
    ["HWPX_FONT_NOT_INSTALLED", "HWPX_FONT_INSTALLATION_UNVERIFIED"].includes(
      message.code,
    ),
  );
  const expectedOmissionInfoCount =
    expected.configuredOmissionBlockCount > 0 ? 1 : 0;
  const expectedFontWarningCount = report.fontInstalled === false ? 1 : 0;
  const expectedFontInfoCount = report.fontInstalled === null ? 1 : 0;
  verify(
    validation.status === "VALID" &&
      validation.fatalCount === 0 &&
      validation.errorCount === 0 &&
      validation.warningCount ===
        expected.rubyCount + expectedFontWarningCount &&
      validation.infoCount ===
        expectedOmissionInfoCount + expectedFontInfoCount &&
      validation.messages.length ===
        validation.fatalCount +
          validation.errorCount +
          validation.warningCount +
          validation.infoCount &&
      rubyMessages.length === expected.rubyCount &&
      omissionMessages.length === expectedOmissionInfoCount &&
      fontMessages.length === expectedFontWarningCount + expectedFontInfoCount &&
      validation.messages.every(
        (message) =>
          ["FATAL", "ERROR", "WARNING", "INFO"].includes(message.severity) &&
          (message.code === "HWPX_RUBY_PLAIN_TEXT_FALLBACK"
            ? message.hwpxPath === "Contents/section0.xml"
            : message.code === "HWPX_CONFIGURED_HEADING_OMISSION" &&
                message.hwpxPath === "Contents/content.hpf" ||
              [
                "HWPX_FONT_NOT_INSTALLED",
                "HWPX_FONT_INSTALLATION_UNVERIFIED",
              ].includes(message.code) &&
                message.hwpxPath === null),
      ),
    "phase1h-report-validation",
  );
  verify(
    hasExactKeys(report.page, [
      "pageSizeToken",
      "customPageWidth",
      "customPageHeight",
      "orientation",
      "marginTop",
      "marginBottom",
      "marginLeft",
      "marginRight",
      "headerMargin",
      "footerMargin",
      "gutter",
      "includeTitlePage",
      "includePageNumber",
      "pageNumberStart",
      "pageNumberPosition",
      "includeHeader",
      "headerHasText",
      "includeFooter",
      "footerHasText",
    ]) &&
      Object.entries(expected.reportPage).every(
        ([key, value]) => report.page[key] === value,
      ),
    "phase1h-report-page",
  );
  verify(
    hasExactKeys(report.timing, [
      "publicationIrCompileMs",
      "semanticMappingMs",
      "styleTableMs",
      "sectionXmlMs",
      "packageDocumentsMs",
      "zipPackagingMs",
      "zipReopenMs",
      "internalValidationMs",
      "sourceCoverageMs",
      "exporterTotalMs",
      "totalMs",
      "hwpConversionMs",
      "hwpReopenMs",
    ]) &&
      Number.isFinite(report.timing.publicationIrCompileMs) &&
      report.timing.publicationIrCompileMs >= 0 &&
      Number.isFinite(report.timing.totalMs) &&
      report.timing.totalMs >= 0 &&
      [
        "semanticMappingMs",
        "styleTableMs",
        "sectionXmlMs",
        "packageDocumentsMs",
        "zipPackagingMs",
        "zipReopenMs",
        "internalValidationMs",
        "sourceCoverageMs",
        "exporterTotalMs",
      ].every(
        (key) => Number.isSafeInteger(report.timing[key]) && report.timing[key] >= 0,
      ) &&
      (hwp
        ? Number.isSafeInteger(report.timing.hwpConversionMs) &&
          report.timing.hwpConversionMs >= 0 &&
          Number.isSafeInteger(report.timing.hwpReopenMs) &&
          report.timing.hwpReopenMs >= 0
        : report.timing.hwpConversionMs === null &&
          report.timing.hwpReopenMs === null),
    "phase1h-report-timing",
  );
  const measuredExporterStageMs =
    report.timing.semanticMappingMs +
    report.timing.styleTableMs +
    report.timing.sectionXmlMs +
    report.timing.packageDocumentsMs +
    report.timing.zipPackagingMs +
    report.timing.zipReopenMs +
    report.timing.internalValidationMs +
    report.timing.sourceCoverageMs;
  const expectedTotalMs =
    report.timing.publicationIrCompileMs +
    report.timing.exporterTotalMs +
    (report.timing.hwpConversionMs ?? 0) +
    (report.timing.hwpReopenMs ?? 0);
  verify(
    report.timing.exporterTotalMs >= measuredExporterStageMs &&
      report.timing.totalMs === expectedTotalMs,
    "phase1h-report-timing-coherence",
    {
      measuredExporterStageMs,
      exporterTotalMs: report.timing.exporterTotalMs,
      expectedTotalMs,
      totalMs: report.timing.totalMs,
    },
  );
  return {
    sourceScope: report.sourceScope,
    sourceScopeNodeId: report.sourceScopeNodeId,
    sourcePublicationHash: report.sourcePublicationHash,
    presetId: report.presetId,
    presetContentHash: report.presetContentHash,
    outputSha256: report.outputSha256,
    hwpxSha256: report.hwpxSha256,
    byteLength: report.byteLength,
    validation: {
      status: validation.status,
      fatalCount: validation.fatalCount,
      errorCount: validation.errorCount,
      warningCount: validation.warningCount,
      infoCount: validation.infoCount,
      messageCount: validation.messages.length,
    },
    packageSectionCount: coverage.packageSectionCount,
    sourceSectionCount: coverage.sourceSectionCount,
    exportedSectionCount: coverage.exportedSectionCount,
    sourceBlockCount: coverage.sourceBlockCount,
    exportedBlockCount: coverage.exportedBlockCount,
    fallbackBlockCount: coverage.fallbackBlockCount,
    configuredOmissionBlockCount: coverage.configuredOmissionBlockCount,
    rejectedBlockCount: coverage.rejectedBlockCount,
    sourceCharacterCount: coverage.sourceCharacterCount,
    exportedCharacterCount: coverage.exportedCharacterCount,
    rubyCount: coverage.rubyCount,
    inlineModifierCount: coverage.inlineModifierCount,
    rubyFallbackMessageCount: rubyMessages.length,
    configuredOmissionMessageCount: omissionMessages.length,
    fontInstallationMessageCount: fontMessages.length,
    logicalPackageHash: report.logicalPackageHash,
    publicationIrCompileMs: report.timing.publicationIrCompileMs,
    reportTotalMs: report.timing.totalMs,
    exporterTotalMs: report.timing.exporterTotalMs,
    zipReopenMs: report.timing.zipReopenMs,
    sourceCoverageMs: report.timing.sourceCoverageMs,
    hancomReopen: report.hancomReopen,
  };
}

async function readAndValidateReport(reportPath, expected, output, hwp = null) {
  const bytes = await readFile(reportPath);
  verify(bytes.length > 0 && bytes.length <= 8 * 1024 * 1024, "phase1h-report-size");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const privacy = assertReportPrivacy(text, "phase1h-json-report-private-content");
  const raw = JSON.parse(text);
  return {
    raw,
    summary: validateExportReport(raw, expected, output, hwp),
    byteLength: bytes.length,
    utf8: true,
    ...privacy,
  };
}

function hwpxWorkspace(run) {
  return run.page.locator("section.hwpx-export");
}

function namedCombobox(scope, name) {
  return scope.getByRole("combobox", { name, exact: true });
}

function snapshotPanel(run) {
  return run.page.getByRole("complementary", {
    name: "Named snapshot",
    exact: true,
  });
}

async function waitForControlReady(run, control, description, timeoutMs = 60_000) {
  await poll(
    async () => {
      const count = await control.count();
      const visible = count === 1 ? await control.isVisible() : false;
      const enabled = count === 1 ? await control.isEnabled() : false;
      const workspace = hwpxWorkspace(run);
      const workspaceCount = await workspace.count();
      const workspaceBusy =
        workspaceCount === 1 && (await workspace.getAttribute("aria-busy")) === "true";
      const savePhase = await run.page
        .locator('[data-testid="save-status"]')
        .getAttribute("data-phase");
      run.lastActionability = {
        control: description,
        count,
        visible,
        enabled,
        workspaceCount,
        workspaceBusy,
        savePhase: ["saved", "dirty", "saving", "restoring", "error"].includes(
          savePhase,
        )
          ? savePhase
          : "OTHER",
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
      return {
        rendererAvailable: false,
        pageClosed: true,
        lastActionability: run.lastActionability ?? null,
      };
    }
    const workspace = hwpxWorkspace(run);
    const workspaceCount = await workspace.count();
    return {
      rendererAvailable: true,
      workspaceCount,
      workspacePhase:
        workspaceCount === 1
          ? await workspace.getAttribute("data-hwpx-phase")
          : null,
      validation:
        workspaceCount === 1
          ? await workspace.getAttribute("data-hwpx-validation")
          : null,
      workspaceBusy:
        workspaceCount === 1
          ? (await workspace.getAttribute("aria-busy")) === "true"
          : null,
      alertCount:
        workspaceCount === 1 ? await workspace.getByRole("alert").count() : null,
      lastActionability: run.lastActionability ?? null,
      dialogCallCounts: (await dialogEvidence(run).catch(() => null))?.calls ?? null,
      pageErrorCount: run.pageErrors.length,
      rendererDiagnosticCount: run.rendererDiagnostics.length,
      hancomState: run.lastHancomState ?? null,
    };
  } catch (error) {
    return {
      rendererAvailable: !run.page.isClosed(),
      structuralCaptureFailed: true,
      captureError: summarizeError(error),
    };
  }
}

async function enterHwpxExport(run) {
  const exportMode = run.page.getByRole("button", { name: "내보내기", exact: true });
  await waitForControlReady(run, exportMode, "phase1h-export-mode-enabled", 30_000);
  await exportMode.click();
  const tab = run.page.getByRole("tab", { name: "한글 문서", exact: true });
  await waitForControlReady(run, tab, "phase1h-hwpx-tab-enabled", 60_000);
  await tab.click();
  await poll(
    async () => {
      const workspace = hwpxWorkspace(run);
      return (await workspace.count()) === 1 &&
        (await workspace.getAttribute("data-hwpx-phase")) === "IDLE"
        ? true
        : null;
    },
    "phase1h-hwpx-mode-ready",
    60_000,
  );
}

async function waitForWorkspaceIdle(run, timeoutMs = OPERATION_TIMEOUT_MS) {
  await poll(
    async () => {
      const workspace = hwpxWorkspace(run);
      if ((await workspace.count()) !== 1) {
        return null;
      }
      return (await workspace.getAttribute("data-hwpx-phase")) === "IDLE" &&
        (await workspace.getAttribute("aria-busy")) !== "true"
        ? true
        : null;
    },
    "phase1h-workspace-idle",
    timeoutMs,
  );
}

async function waitForNoAlert(run) {
  await poll(
    async () => ((await hwpxWorkspace(run).getByRole("alert").count()) === 0 ? true : null),
    "phase1h-alert-cleared",
  );
}

async function assertHancomState(run) {
  const workspace = hwpxWorkspace(run);
  const outputType = namedCombobox(workspace, "출력 형식");
  const state = await outputType.evaluate((select) => {
    const option = [...select.options].find((candidate) => candidate.value === "HWP");
    return {
      selected: select.value,
      hwpPresent: Boolean(option),
      hwpDisabled: option?.disabled === true,
    };
  });
  const text = (await workspace.textContent()) ?? "";
  const status = await workspace.getAttribute("data-hwpx-hancom-status");
  const reason = await workspace.getAttribute("data-hwpx-hancom-reason");
  const allowedStatuses = new Set([
    "AVAILABLE",
    "REGISTERED_UNVERIFIED",
    "UNAVAILABLE",
  ]);
  const allowedReasons = new Set([
    "NONE",
    "NOT_WINDOWS",
    "NOT_INSTALLED",
    "BRIDGE_UNAVAILABLE",
  ]);
  const expectedMessage =
    status === "REGISTERED_UNVERIFIED"
      ? "한컴오피스는 감지됐지만 안전한 Automation 사용 조건을 확인하지 못했습니다."
      : "HWP 변환을 사용하려면 Windows용 한컴오피스 한/글이 필요합니다.";
  run.lastHancomState = {
    status: allowedStatuses.has(status) ? status : "OTHER",
    reason: allowedReasons.has(reason) ? reason : "OTHER",
    selected:
      state.selected === "HWPX" || state.selected === "HWP"
        ? state.selected
        : "OTHER",
    hwpPresent: state.hwpPresent,
    hwpDisabled: state.hwpDisabled,
    expectedMessagePresent:
      status === "AVAILABLE" ? null : text.includes(expectedMessage),
  };
  verify(
    allowedStatuses.has(status),
    "phase1h-hancom-status",
    { status, reason },
  );
  run.hancomStatus = status;
  if (status === "AVAILABLE") {
    verify(
      state.selected === "HWPX" && state.hwpPresent && !state.hwpDisabled,
      "phase1h-hancom-available",
      state,
    );
    return {
      status,
      reason: null,
      hwpOptionDisabled: false,
      securityModuleVerified: true,
      automationAttempted: false,
      hancomProcessLaunchAllowed: true,
    };
  }
  verify(
    state.selected === "HWPX" &&
      state.hwpPresent &&
      state.hwpDisabled &&
      text.includes(expectedMessage),
    "phase1h-hancom-unavailable-fail-closed",
    state,
  );
  return {
    status,
    reason: status === "UNAVAILABLE" ? reason : null,
    hwpOptionDisabled: true,
    securityModuleVerified: false,
    automationAttempted: false,
    hancomProcessLaunchAllowed: false,
  };
}

async function configureCustomPreset(run) {
  const workspace = hwpxWorkspace(run);
  await namedCombobox(workspace, "preset").selectOption({
    label: "가독성 중심 검토본",
  });
  await namedCombobox(workspace, "페이지 크기").selectOption("CUSTOM");
  await workspace.getByLabel("사용자 지정 너비(mm)", { exact: true }).fill("210.5");
  await workspace.getByLabel("사용자 지정 높이(mm)", { exact: true }).fill("297.5");
  await workspace.getByLabel("위 여백(mm)", { exact: true }).fill("25.5");
  await workspace.getByLabel("아래 여백(mm)", { exact: true }).fill("26.5");
  await workspace.getByLabel("왼쪽 여백(mm)", { exact: true }).fill("27.5");
  await workspace.getByLabel("오른쪽 여백(mm)", { exact: true }).fill("28.5");
  await workspace.getByLabel("머리말 여백(mm)", { exact: true }).fill("14.5");
  await workspace.getByLabel("꼬리말 여백(mm)", { exact: true }).fill("13.5");
  await workspace.getByLabel("제본 여백(mm)", { exact: true }).fill("2.5");
  await workspace.getByLabel("본문 글꼴", { exact: true }).fill("함초롬바탕");
  await workspace.getByLabel("본문 크기(pt)", { exact: true }).fill("11");
  const lineSpacing = workspace.locator("label").filter({ hasText: "줄간격" });
  await lineSpacing.locator("select").selectOption("PERCENT");
  await lineSpacing.locator('input[type="number"]').fill("187.5");
  const sceneTitle = workspace.getByLabel("장면 제목 포함", { exact: true });
  if (!(await sceneTitle.isChecked())) {
    await sceneTitle.check();
  }
  const pageNumber = workspace.getByLabel("페이지 번호 포함", { exact: true });
  if (!(await pageNumber.isChecked())) {
    await pageNumber.check();
  }
  await namedCombobox(workspace, "페이지 번호 위치").selectOption("BOTTOM_RIGHT");
  const header = workspace.getByLabel("머리말 포함", { exact: true });
  if (!(await header.isChecked())) {
    await header.check();
  }
  await workspace.getByLabel("머리말", { exact: true }).fill("madi HWPX 검증");
  const footer = workspace.getByLabel("꼬리말 포함", { exact: true });
  if (!(await footer.isChecked())) {
    await footer.check();
  }
  await workspace.getByLabel("꼬리말", { exact: true }).fill("로컬 제출본");
  await namedCombobox(workspace, "section 분할").selectOption("SINGLE");
  await workspace
    .getByLabel("연락처(일회성, report 제외)", { exact: true })
    .fill(privateContact);
}

async function exercisePresetCrud(run) {
  const workspace = hwpxWorkspace(run);
  const listbox = namedCombobox(workspace, "preset");
  const initialCount = await listbox.locator("option").count();
  const builtInLabels = [
    "범용 출판사 제출본",
    "가독성 중심 검토본",
    "압축 검토본",
  ];
  const initialLabels = await listbox.locator("option").allTextContents();
  verify(
    initialCount === builtInLabels.length &&
      initialLabels.every((label, index) => label === builtInLabels[index]),
    "phase1h-built-in-preset-inventory",
    { initialCount },
  );
  for (const label of builtInLabels) {
    await listbox.selectOption({ label });
    verify(
      (await listbox.inputValue()).startsWith("BUILTIN:"),
      "phase1h-built-in-preset-selection",
    );
  }
  await configureCustomPreset(run);
  await workspace.getByLabel("저장 이름", { exact: true }).fill(presetName);
  await workspace.getByRole("button", { name: "새 preset 저장", exact: true }).click();
  await poll(
    async () =>
      (await listbox.locator("option").count()) === initialCount + 1 ? true : null,
    "phase1h-preset-create",
    60_000,
  );
  await waitForWorkspaceIdle(run);
  const createdValue = await listbox.inputValue();
  verify(
    createdValue.length > 0 && !createdValue.startsWith("BUILTIN:"),
    "phase1h-preset-created-selection",
  );
  await workspace.getByLabel("본문 크기(pt)", { exact: true }).fill("11.5");
  await workspace.getByLabel("저장 이름", { exact: true }).fill(updatedPresetName);
  await workspace.getByRole("button", { name: "변경 저장", exact: true }).click();
  await poll(
    async () =>
      (await listbox.locator("option:checked").textContent()) === updatedPresetName
        ? true
        : null,
    "phase1h-preset-update",
    60_000,
  );
  await waitForWorkspaceIdle(run);
  await workspace.getByRole("button", { name: "복제", exact: true }).click();
  await poll(
    async () =>
      (await listbox.locator("option").count()) === initialCount + 2 ? true : null,
    "phase1h-preset-duplicate",
    60_000,
  );
  await waitForWorkspaceIdle(run);
  const duplicateValue = await listbox.inputValue();
  verify(duplicateValue !== createdValue, "phase1h-preset-duplicate-selection");
  await workspace.getByRole("button", { name: "삭제", exact: true }).click();
  await poll(
    async () =>
      (await listbox.locator("option").count()) === initialCount + 1 ? true : null,
    "phase1h-preset-delete",
    60_000,
  );
  await waitForWorkspaceIdle(run);
  await listbox.selectOption({ label: updatedPresetName });
  return {
    builtInCount: initialCount,
    allBuiltInsSelected: true,
    created: true,
    updated: true,
    duplicated: true,
    duplicateDeleted: true,
    presetIdFingerprint: structuralHash(createdValue),
  };
}

async function openSnapshotPanel(run) {
  const button = run.page.getByRole("button", { name: "Snapshot", exact: true });
  await waitForControlReady(run, button, "phase1h-snapshot-toolbar-ready");
  await button.click();
  await snapshotPanel(run).waitFor({ timeout: 30_000 });
}

async function closeGlobalPanel(run) {
  const button = run.page.getByRole("button", { name: "개발 패널", exact: true });
  await waitForControlReady(run, button, "phase1h-development-panel-ready");
  await button.click();
  await poll(
    async () => ((await snapshotPanel(run).count()) === 0 ? true : null),
    "phase1h-snapshot-panel-close",
  );
}

async function createHwpxSnapshot(run) {
  await openSnapshotPanel(run);
  const panel = snapshotPanel(run);
  const existingIds = await panel
    .locator("[data-snapshot-id]")
    .evaluateAll((items) => items.map((item) => item.getAttribute("data-snapshot-id")));
  await panel.getByLabel("이름", { exact: true }).fill(snapshotName);
  await panel
    .getByRole("button", { name: "현재 프로젝트 snapshot 생성", exact: true })
    .click();
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
          (item) => item.id && !existingIds.includes(item.id) && item.payloadVersion === 5,
        ) ?? null
      );
    },
    "phase1h-snapshot-create-v5",
    90_000,
  );
  await closeGlobalPanel(run);
  return {
    snapshotId: created.id,
    payloadVersion: created.payloadVersion,
    priorSnapshotCount: existingIds.length,
  };
}

async function createMutationPreset(run) {
  const workspace = hwpxWorkspace(run);
  const listbox = namedCombobox(workspace, "preset");
  const before = await listbox.locator("option").count();
  await workspace.getByLabel("저장 이름", { exact: true }).fill(mutationPresetName);
  await workspace.getByRole("button", { name: "새 preset 저장", exact: true }).click();
  await poll(
    async () => ((await listbox.locator("option").count()) === before + 1 ? true : null),
    "phase1h-snapshot-mutation-preset",
    60_000,
  );
  await waitForWorkspaceIdle(run);
}

async function restoreHwpxSnapshot(run, snapshot) {
  await openSnapshotPanel(run);
  const panel = snapshotPanel(run);
  const item = panel.locator(`[data-snapshot-id="${snapshot.snapshotId}"]`);
  verify(
    Number(await item.getAttribute("data-snapshot-payload-version")) === 5,
    "phase1h-snapshot-restore-payload-v5",
  );
  await item.getByRole("button", { name: / 복원$/u }).click();
  const dialog = run.page.getByRole("alertdialog");
  await dialog.waitFor({ timeout: 60_000 });
  const diffText = (await dialog.locator("dl").textContent()) ?? "";
  verify(
    diffText.includes("EPUB export preset") && /\+[1-9]/u.test(diffText),
    "phase1h-snapshot-preset-diff",
  );
  await dialog
    .getByRole("button", { name: "안전 snapshot 생성 후 복원", exact: true })
    .click();
  await dialog.waitFor({ state: "detached", timeout: 120_000 });
  if ((await snapshotPanel(run).count()) === 1) {
    await closeGlobalPanel(run);
  }
  await waitForWorkspaceIdle(run, 120_000);
  const listbox = namedCombobox(hwpxWorkspace(run), "preset");
  const options = await listbox.locator("option").allTextContents();
  verify(
    options.filter((name) => name === updatedPresetName).length === 1 &&
      !options.includes(mutationPresetName),
    "phase1h-snapshot-hwpx-preset-restore",
  );
  await listbox.selectOption({ label: updatedPresetName });
  return {
    payloadVersion: 5,
    diffObserved: true,
    safetySnapshotCreated: true,
    hwpxPresetRestored: true,
    mutationRemoved: true,
  };
}

async function assertReopenedPreset(run) {
  const workspace = hwpxWorkspace(run);
  const listbox = namedCombobox(workspace, "preset");
  const options = await listbox.locator("option").allTextContents();
  verify(
    options.filter((name) => name === updatedPresetName).length === 1 &&
      !options.includes(mutationPresetName),
    "phase1h-reopen-preset-inventory",
  );
  await listbox.selectOption({ label: updatedPresetName });
  const lineSpacing = workspace.locator("label").filter({ hasText: "줄간격" });
  verify(
    (await workspace.getByLabel("본문 크기(pt)", { exact: true }).inputValue()) ===
      "11.5" &&
      (await workspace.getByLabel("장면 제목 포함", { exact: true }).isChecked()) &&
      (await namedCombobox(workspace, "페이지 번호 위치").inputValue()) ===
        "BOTTOM_RIGHT" &&
      (await lineSpacing.locator("select").inputValue()) === "PERCENT" &&
      (await lineSpacing.locator('input[type="number"]').inputValue()) === "187.5",
    "phase1h-reopen-custom-preset-config",
  );
  const contact = workspace.getByLabel("연락처(일회성, report 제외)", {
    exact: true,
  });
  verify(
    (await contact.inputValue()) === "",
    "phase1h-one-time-contact-not-persisted",
  );
  await contact.fill(privateContact);
  return {
    customPresetPersisted: true,
    snapshotRestorePersisted: true,
    oneTimeContactNotPersisted: true,
  };
}

async function selectScopeAndSplit(run, fixture, scopeKind, splitMode) {
  const workspace = hwpxWorkspace(run);
  await namedCombobox(workspace, "범위").selectOption(
    scopeNodeId(fixture, scopeKind),
  );
  await namedCombobox(workspace, "section 분할").selectOption(splitMode);
  await waitForNoAlert(run);
  const expected = expectedExport(fixture, scopeKind, splitMode);
  expected.forbiddenLocalPathFragments = [...run.forbiddenLocalPathFragments];
  const headingCounts = sourceHeadingCounts(fixture, scopeKind);
  const headingInclusion = {
    work: await workspace.getByLabel("작품 제목 포함", { exact: true }).isChecked(),
    volume: await workspace.getByLabel("권 제목 포함", { exact: true }).isChecked(),
    chapter: await workspace.getByLabel("화 제목 포함", { exact: true }).isChecked(),
    scene: await workspace.getByLabel("장면 제목 포함", { exact: true }).isChecked(),
  };
  expected.headingCount = Object.entries(headingCounts).reduce(
    (count, [kind, kindCount]) =>
      count + (headingInclusion[kind] ? kindCount : 0),
    0,
  );
  expected.configuredOmissionBlockCount =
    Object.values(headingCounts).reduce((sum, count) => sum + count, 0) -
    expected.headingCount;
  expected.exportedBlockCount =
    expected.blockCount -
    expected.fallbackBlockCount -
    expected.configuredOmissionBlockCount;
  expected.pageNumberPosition = await namedCombobox(
    workspace,
    "페이지 번호 위치",
  ).inputValue();
  expected.pageNumberStart = Number(
    await workspace.getByLabel("페이지 번호 시작", { exact: true }).inputValue(),
  );
  const sizeToken = await namedCombobox(workspace, "페이지 크기").inputValue();
  let widthMm;
  let heightMm;
  if (sizeToken === "CUSTOM") {
    widthMm = Number(
      await workspace.getByLabel("사용자 지정 너비(mm)", { exact: true }).inputValue(),
    );
    heightMm = Number(
      await workspace.getByLabel("사용자 지정 높이(mm)", { exact: true }).inputValue(),
    );
  } else if (sizeToken === "LETTER") {
    widthMm = null;
    heightMm = null;
  } else {
    widthMm = null;
    heightMm = null;
  }
  const customPageWidth = widthMm;
  const customPageHeight = heightMm;
  const orientation = await namedCombobox(workspace, "방향").inputValue();
  if (orientation === "LANDSCAPE" && widthMm !== null) {
    [widthMm, heightMm] = [heightMm, widthMm];
  }
  const officialPageUnits =
    sizeToken === "A4"
      ? [59_528, 84_188]
      : sizeToken === "LETTER"
        ? [61_200, 79_200]
        : [mmToHwpunit(widthMm), mmToHwpunit(heightMm)];
  if (orientation === "LANDSCAPE" && officialPageUnits[1] > officialPageUnits[0]) {
    officialPageUnits.reverse();
  }
  expected.page = {
    landscape: orientation === "LANDSCAPE" ? "WIDELY" : "NARROWLY",
    width: officialPageUnits[0],
    height: officialPageUnits[1],
    top: mmToHwpunit(
      await workspace.getByLabel("위 여백(mm)", { exact: true }).inputValue(),
    ),
    bottom: mmToHwpunit(
      await workspace.getByLabel("아래 여백(mm)", { exact: true }).inputValue(),
    ),
    left: mmToHwpunit(
      await workspace.getByLabel("왼쪽 여백(mm)", { exact: true }).inputValue(),
    ),
    right: mmToHwpunit(
      await workspace.getByLabel("오른쪽 여백(mm)", { exact: true }).inputValue(),
    ),
    header: mmToHwpunit(
      await workspace.getByLabel("머리말 여백(mm)", { exact: true }).inputValue(),
    ),
    footer: mmToHwpunit(
      await workspace.getByLabel("꼬리말 여백(mm)", { exact: true }).inputValue(),
    ),
    gutter: mmToHwpunit(
      await workspace.getByLabel("제본 여백(mm)", { exact: true }).inputValue(),
    ),
  };
  expected.reportPage = {
    pageSizeToken: sizeToken,
    customPageWidth,
    customPageHeight,
    orientation,
    marginTop: Number(
      await workspace.getByLabel("위 여백(mm)", { exact: true }).inputValue(),
    ),
    marginBottom: Number(
      await workspace.getByLabel("아래 여백(mm)", { exact: true }).inputValue(),
    ),
    marginLeft: Number(
      await workspace.getByLabel("왼쪽 여백(mm)", { exact: true }).inputValue(),
    ),
    marginRight: Number(
      await workspace.getByLabel("오른쪽 여백(mm)", { exact: true }).inputValue(),
    ),
    headerMargin: Number(
      await workspace.getByLabel("머리말 여백(mm)", { exact: true }).inputValue(),
    ),
    footerMargin: Number(
      await workspace.getByLabel("꼬리말 여백(mm)", { exact: true }).inputValue(),
    ),
    gutter: Number(
      await workspace.getByLabel("제본 여백(mm)", { exact: true }).inputValue(),
    ),
    includeTitlePage: await workspace
      .getByLabel("표제지 포함", { exact: true })
      .isChecked(),
    includePageNumber: await workspace
      .getByLabel("페이지 번호 포함", { exact: true })
      .isChecked(),
    pageNumberStart: expected.pageNumberStart,
    pageNumberPosition: expected.pageNumberPosition,
  };
  const lineSpacing = workspace.locator("label").filter({ hasText: "줄간격" });
  expected.fontSizeHundredths = Math.round(
    Number(
      await workspace.getByLabel("본문 크기(pt)", { exact: true }).inputValue(),
    ) * 100,
  );
  expected.fontFamily = await workspace
    .getByLabel("본문 글꼴", { exact: true })
    .inputValue();
  expected.lineSpacing = {
    type: await lineSpacing.locator("select").inputValue(),
    value: Math.round(
      Number(await lineSpacing.locator('input[type="number"]').inputValue()),
    ),
  };
  expected.includeHeader = await workspace
    .getByLabel("머리말 포함", { exact: true })
    .isChecked();
  expected.headerText = expected.includeHeader
    ? await workspace.getByLabel("머리말", { exact: true }).inputValue()
    : null;
  expected.includeFooter = await workspace
    .getByLabel("꼬리말 포함", { exact: true })
    .isChecked();
  expected.footerText = expected.includeFooter
    ? await workspace.getByLabel("꼬리말", { exact: true }).inputValue()
    : null;
  Object.assign(expected.reportPage, {
    includeHeader: expected.includeHeader,
    headerHasText: Boolean(expected.headerText?.length),
    includeFooter: expected.includeFooter,
    footerHasText: Boolean(expected.footerText?.length),
  });
  expected.contactText = await workspace
    .getByLabel("연락처(일회성, report 제외)", { exact: true })
    .inputValue();
  verify(
    expected.contactText === privateContact,
    "phase1h-title-page-contact-input",
  );
  return expected;
}

async function validateFromUi(run) {
  const workspace = hwpxWorkspace(run);
  const started = performance.now();
  await workspace.getByRole("button", { name: "사전 검사", exact: true }).click();
  await poll(
    async () =>
      (await workspace.getAttribute("data-hwpx-validation")) === "VALID" &&
      (await workspace.getAttribute("data-hwpx-phase")) === "IDLE"
        ? true
        : null,
    "phase1h-validation-complete",
    OPERATION_TIMEOUT_MS,
  );
  verify(
    (await workspace.getByRole("heading", { name: "사전 검사: VALID" }).count()) === 1,
    "phase1h-validation-result-visible",
  );
  return { valid: true, wallMs: roundMilliseconds(performance.now() - started) };
}

async function chooseOutput(run, outputType = "HWPX") {
  const workspace = hwpxWorkspace(run);
  const callKey = outputType === "HWP" ? "hwpSave" : "hwpxSave";
  const before = (await dialogEvidence(run))?.calls[callKey] ?? 0;
  await workspace
    .getByRole("button", { name: "출력 파일 선택", exact: true })
    .click();
  await poll(
    async () => {
      const dialogs = await dialogEvidence(run);
      return dialogs?.calls[callKey] === before + 1 &&
        ((await workspace.textContent()) ?? "").includes("선택한 파일:")
        ? true
        : null;
    },
    "phase1h-output-selected",
    30_000,
  );
}

async function startProgressProbe(run) {
  await run.page.evaluate(() => {
    const prior = Reflect.get(globalThis, "__madiPhase1hProgressProbe");
    if (prior?.unsubscribe) prior.unsubscribe();
    const events = [];
    const unsubscribe = window.madi.onHwpxExportProgress((progress) => {
      events.push({
        stage: progress.stage,
        completed: progress.completed,
        total: progress.total,
      });
    });
    Reflect.set(globalThis, "__madiPhase1hProgressProbe", {
      events,
      unsubscribe,
    });
  });
}

async function stopProgressProbe(run) {
  return run.page.evaluate(() => {
    const probe = Reflect.get(globalThis, "__madiPhase1hProgressProbe");
    if (!probe?.unsubscribe || !Array.isArray(probe.events)) return null;
    probe.unsubscribe();
    Reflect.deleteProperty(globalThis, "__madiPhase1hProgressProbe");
    return probe.events;
  });
}

function validateProgressEvents(events, hwp = false) {
  const expectedStages = [
    "PUBLICATION_COMPILE",
    "STYLE_TABLE",
    "SECTION_XML",
    "HWPX_PACKAGE",
    "INTERNAL_VALIDATION",
    ...(hwp ? ["HWP_CONVERSION", "REOPEN_VERIFICATION"] : []),
    "FINALIZE",
  ];
  verify(
    Array.isArray(events) &&
      events.length >= expectedStages.length &&
      events.every(
        (event) =>
          hasExactKeys(event, ["stage", "completed", "total"]) &&
          expectedStages.includes(event.stage) &&
          Number.isSafeInteger(event.completed) &&
          Number.isSafeInteger(event.total) &&
          event.total > 0 &&
          event.completed >= 0 &&
          event.completed <= event.total,
      ),
    "phase1h-progress-event-contract",
  );
  const firstIndexes = expectedStages.map((stage) =>
    events.findIndex((event) => event.stage === stage),
  );
  verify(
    firstIndexes.every((index) => index >= 0) &&
      firstIndexes.every((index, position) =>
        position === 0 ? true : index > firstIndexes[position - 1],
      ),
    "phase1h-progress-stage-order",
    { firstIndexes },
  );
  return {
    eventCount: events.length,
    stages: expectedStages,
    hwpOnlyStagesAbsent: events.every(
      (event) =>
        event.stage !== "HWP_CONVERSION" &&
        event.stage !== "REOPEN_VERIFICATION",
    ),
    hwpConversionObserved: events.some((event) => event.stage === "HWP_CONVERSION"),
    reopenVerificationObserved: events.some(
      (event) => event.stage === "REOPEN_VERIFICATION",
    ),
  };
}

async function startResponsivenessProbe(run) {
  await run.page.evaluate(() => {
    const prior = Reflect.get(globalThis, "__madiPhase1hResponsivenessProbe");
    if (prior?.stop) prior.stop();
    const workspace = document.querySelector("section.hwpx-export");
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
      if (!stopped) requestAnimationFrame(onFrame);
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
        phases.add(workspace.dataset.hwpxPhase ?? "UNKNOWN");
      }
    });
    if (workspace) {
      observer.observe(workspace, {
        attributes: true,
        attributeFilter: ["data-hwpx-phase"],
      });
    }
    Reflect.set(globalThis, "__madiPhase1hResponsivenessProbe", {
      stop() {
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
    });
  });
}

async function stopResponsivenessProbe(run) {
  return run.page.evaluate(() => {
    const probe = Reflect.get(globalThis, "__madiPhase1hResponsivenessProbe");
    if (!probe?.stop) return null;
    const result = probe.stop();
    Reflect.deleteProperty(globalThis, "__madiPhase1hResponsivenessProbe");
    return result;
  });
}

function validateResponsiveness(responsiveness) {
  verify(responsiveness, "phase1h-responsiveness-probe-missing");
  verify(
    (responsiveness.frameCount > 0 ||
      responsiveness.elapsedMs <= MAX_RENDERER_FRAME_GAP_MS) &&
      (responsiveness.heartbeatCount > 0 ||
        responsiveness.elapsedMs <= MAX_RENDERER_HEARTBEAT_GAP_MS) &&
      responsiveness.maximumFrameGapMs <= MAX_RENDERER_FRAME_GAP_MS &&
      responsiveness.maximumHeartbeatGapMs <= MAX_RENDERER_HEARTBEAT_GAP_MS &&
      responsiveness.phases.includes("PREPARING") &&
      responsiveness.phases.includes("EXPORTING"),
    "phase1h-responsiveness-bound",
    {
      frameCount: responsiveness.frameCount,
      heartbeatCount: responsiveness.heartbeatCount,
      maximumFrameGapMs: roundMilliseconds(responsiveness.maximumFrameGapMs),
      maximumHeartbeatGapMs: roundMilliseconds(
        responsiveness.maximumHeartbeatGapMs,
      ),
    },
  );
  return {
    elapsedMs: roundMilliseconds(responsiveness.elapsedMs),
    frameCount: responsiveness.frameCount,
    heartbeatCount: responsiveness.heartbeatCount,
    maximumFrameGapMs: roundMilliseconds(responsiveness.maximumFrameGapMs),
    maximumHeartbeatGapMs: roundMilliseconds(responsiveness.maximumHeartbeatGapMs),
    maximumAllowedFrameGapMs: MAX_RENDERER_FRAME_GAP_MS,
    maximumAllowedHeartbeatGapMs: MAX_RENDERER_HEARTBEAT_GAP_MS,
    observedPreparing: responsiveness.phases.includes("PREPARING"),
    observedExporting: responsiveness.phases.includes("EXPORTING"),
  };
}

async function runExportFromUi(run, outputPath, expected, outputType = "HWPX") {
  await chooseOutput(run, outputType);
  await startProgressProbe(run);
  await startResponsivenessProbe(run);
  const started = performance.now();
  const workspace = hwpxWorkspace(run);
  await workspace
    .getByRole("button", { name: `${outputType} 내보내기`, exact: true })
    .click();
  const memoryPromise = (async () => {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
    return sampleApplicationMemory(run.application);
  })();
  await poll(
    async () =>
      (await workspace.getAttribute("data-hwpx-phase")) === "IDLE" &&
      (await workspace.getByRole("status", { name: "HWPX 내보내기 완료" }).count()) === 1
        ? true
        : null,
    "phase1h-export-complete",
    OPERATION_TIMEOUT_MS,
  );
  const progress = validateProgressEvents(
    await stopProgressProbe(run),
    outputType === "HWP",
  );
  const responsiveness = validateResponsiveness(await stopResponsivenessProbe(run));
  const memory = await memoryPromise;
  await poll(
    async () => ((await fileExists(outputPath)) ? true : null),
    "phase1h-output-file",
    30_000,
  );
  const bytes = await readFile(outputPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const structure = outputType === "HWPX" ? validateGeneratedHwpx(bytes, expected) : null;
  return {
    wallMs: roundMilliseconds(performance.now() - started),
    memory,
    progress,
    responsiveness,
    sha256,
    byteLength: bytes.length,
    structure,
  };
}

async function saveJsonReport(run, reportPath, expected, output, hwp = null) {
  await hwpxWorkspace(run)
    .getByRole("button", { name: "JSON report 저장", exact: true })
    .click();
  await poll(
    async () => ((await fileExists(reportPath)) ? true : null),
    "phase1h-json-report-file",
    30_000,
  );
  return readAndValidateReport(reportPath, expected, output, hwp);
}

async function saveMarkdownReport(run, reportPath, expectedReport) {
  await hwpxWorkspace(run)
    .getByRole("button", { name: "Markdown report 저장", exact: true })
    .click();
  await poll(
    async () => ((await fileExists(reportPath)) ? true : null),
    "phase1h-markdown-report-file",
    30_000,
  );
  const bytes = await readFile(reportPath);
  verify(bytes.length > 0 && bytes.length <= 8 * 1024 * 1024, "phase1h-markdown-size");
  const markdown = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  verify(
    markdown.startsWith("# madi HWPX export report") &&
      markdown.includes("- Package profile: HANCOM_OFFICIAL_MODEL_1_31") &&
      markdown.includes(`- Source scope/revision: ${expectedReport.sourceScope}/`) &&
      markdown.includes(expectedReport.sourceScopeNodeId) &&
      markdown.includes("- Physical HWPX sections:") &&
      markdown.includes("- Blocks (exported/fallback/configured omission/rejected/source):") &&
      markdown.includes("- Hancom reopen/HWP converted: NOT_RUN/false"),
    "phase1h-markdown-contract",
  );
  return {
    saved: true,
    byteLength: bytes.length,
    utf8: true,
    packageProfilePresent: true,
    sourceScopeNodeIdPresent: true,
    coveragePresent: true,
    noHancomReopenClaim: true,
    ...assertReportPrivacy(markdown, "phase1h-markdown-private-content"),
  };
}

async function revealExport(run) {
  await hwpxWorkspace(run)
    .getByRole("button", { name: "파일 위치 열기", exact: true })
    .click();
  const evidence = await dialogEvidence(run);
  verify(evidence?.calls.reveal > 0, "phase1h-reveal-not-invoked");
  return { invoked: true };
}

async function exerciseNoClobber(run, outputPath) {
  verify(!(await fileExists(outputPath)), "phase1h-no-clobber-preexisting");
  await chooseOutput(run);
  const sentinel = Buffer.from("phase1h-concurrent-owner", "utf8");
  await writeFile(outputPath, sentinel, { flag: "wx", mode: 0o600 });
  const workspace = hwpxWorkspace(run);
  await workspace.getByRole("button", { name: "HWPX 내보내기", exact: true }).click();
  await poll(
    async () =>
      (await workspace.getAttribute("data-hwpx-phase")) === "IDLE" &&
      (await workspace.getByRole("alert").count()) === 1
        ? true
        : null,
    "phase1h-no-clobber-result",
    OPERATION_TIMEOUT_MS,
  );
  verify(
    (await readFile(outputPath)).equals(sentinel) &&
      (await workspace.getByRole("status", { name: "HWPX 내보내기 완료" }).count()) === 0,
    "phase1h-no-clobber-preservation",
  );
  return {
    concurrentDestinationPreserved: true,
    exportFailedClosed: true,
    staleSuccessHidden: true,
  };
}

async function exerciseCancel(run, outputPath) {
  verify(!(await fileExists(outputPath)), "phase1h-cancel-preexisting-output");
  await chooseOutput(run);
  const workspace = hwpxWorkspace(run);
  await workspace.getByRole("button", { name: "HWPX 내보내기", exact: true }).click();
  const phaseAtCancel = await poll(
    async () => {
      const phase = await workspace.getAttribute("data-hwpx-phase");
      const cancel = workspace.getByRole("button", {
        name: "내보내기 취소",
        exact: true,
      });
      return phase !== "IDLE" && (await cancel.isEnabled()) ? phase : null;
    },
    "phase1h-cancel-enabled",
    30_000,
  );
  await workspace
    .getByRole("button", { name: "내보내기 취소", exact: true })
    .click();
  await waitForWorkspaceIdle(run, OPERATION_TIMEOUT_MS);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 750));
  verify(
    !(await fileExists(outputPath)) &&
      (await workspace.getByRole("status", { name: "HWPX 내보내기 완료" }).count()) === 0 &&
      (await workspace.locator("progress").count()) === 0,
    "phase1h-cancel-terminal-state",
  );
  return {
    accepted: true,
    phaseAtCancel: ["PREPARING", "EXPORTING"].includes(phaseAtCancel)
      ? phaseAtCancel
      : "OTHER",
    outputAbsent: true,
    lateSuccessAbsent: true,
    lateProgressAbsent: true,
  };
}

async function listGlobalHwpxTempArtifacts() {
  const entries = await readdir(tmpdir(), { withFileTypes: true });
  return new Set(
    entries
      .filter((entry) =>
        /^(?:madi-hwpx-validation-|madi-export-hwpx-|\.madi-hwpx-)/u.test(
          entry.name,
        ),
      )
      .map((entry) => entry.name),
  );
}

async function inspectOwnedTemporaryArtifacts(root) {
  const pending = [root];
  let temporaryArtifactCount = 0;
  let recoveryRegistryRecordCount = 0;
  let recoveryClaimDirectoryCount = 0;
  let symlinkCount = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const entryPath = resolve(current, entry.name);
      verify(isWithin(entryPath, root), "phase1h-temp-inspection-scope");
      if (entry.isSymbolicLink()) {
        if (/madi-hwpx|madi-hwp/iu.test(entry.name)) symlinkCount += 1;
        continue;
      }
      if (entry.isDirectory()) {
        if (/^\.madi-hwpx-(?:operation|report)-/u.test(entry.name)) {
          temporaryArtifactCount += 1;
        }
        if (/^\.madi-hwpx-recovery-claim-/u.test(entry.name)) {
          recoveryClaimDirectoryCount += 1;
        }
        pending.push(entryPath);
      } else if (/\.madi-hwpx-|\.madi-hwp-/u.test(entry.name)) {
        temporaryArtifactCount += 1;
      } else if (
        basename(current) === "hwpx-recovery-v1" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/iu.test(
          entry.name,
        )
      ) {
        recoveryRegistryRecordCount += 1;
      }
    }
  }
  return {
    temporaryArtifactCount,
    recoveryRegistryRecordCount,
    recoveryClaimDirectoryCount,
    symlinkCount,
  };
}

async function validateCleanupState(temporaryRoot, baselineGlobalArtifacts, lifecycles) {
  const currentGlobalArtifacts = await listGlobalHwpxTempArtifacts();
  const newGlobalArtifactCount = [...currentGlobalArtifacts].filter(
    (name) => !baselineGlobalArtifacts.has(name),
  ).length;
  const local = await inspectOwnedTemporaryArtifacts(temporaryRoot);
  verify(newGlobalArtifactCount === 0, "phase1h-global-temp-leak", {
    count: newGlobalArtifactCount,
  });
  verify(
    local.temporaryArtifactCount === 0 &&
      local.recoveryRegistryRecordCount === 0 &&
      local.recoveryClaimDirectoryCount === 0 &&
      local.symlinkCount === 0,
    "phase1h-owned-temp-leak",
    local,
  );
  const processesExited = lifecycles.every(
    (lifecycle) =>
      lifecycle.processTracking.exactCapturedProcessesExited &&
      lifecycle.processTracking.capturedDescendantProcessesAfterClose === 0,
  );
  verify(processesExited, "phase1h-cleanup-process-proof");
  return {
    newGlobalTemporaryArtifactCount: newGlobalArtifactCount,
    ownedTemporaryArtifactCount: local.temporaryArtifactCount,
    recoveryRegistryRecordCount: local.recoveryRegistryRecordCount,
    recoveryClaimDirectoryCount: local.recoveryClaimDirectoryCount,
    ownedTemporarySymlinkCount: local.symlinkCount,
    allCapturedProcessesExited: true,
  };
}

async function removeTemporaryRoot(temporaryRoot) {
  const canonicalTemporaryRoot = await realpath(temporaryRoot);
  const canonicalSystemTemporary = await realpath(tmpdir());
  verify(
    dirname(canonicalTemporaryRoot) === canonicalSystemTemporary &&
      basename(canonicalTemporaryRoot).startsWith("madi-phase1h-"),
    "phase1h-temporary-root-delete-scope",
  );
  const entry = await lstat(canonicalTemporaryRoot);
  verify(
    entry.isDirectory() && !entry.isSymbolicLink(),
    "phase1h-temporary-root-delete-type",
  );
  await rm(canonicalTemporaryRoot, {
    recursive: true,
    force: false,
    maxRetries: 20,
    retryDelay: 250,
  });
}

function fixtureEvidence(fixture) {
  return {
    bytes: fixture.bytes,
    sha256: fixture.sha256,
    volumes: fixture.inventory.volumes,
    chapters: fixture.inventory.chapters,
    scenes: fixture.inventory.scenes,
    characters: fixture.inventory.characters,
    blocks: fixture.inventory.blocks,
  };
}

function assertExportHardTarget({
  profile,
  runNumber,
  scopeKind,
  splitMode,
  output,
  report,
  maximumMs,
}) {
  // Publication IR compile is measured separately. Development uses the debug
  // core, so only fresh-unpacked exporter pipeline time is a hard performance
  // gate. Click wall remains an environment-dependent observation.
  const evidence = {
    profile,
    runNumber,
    scopeKind,
    splitMode,
    packaged,
    wallScope: "EXPORT_CLICK_THROUGH_OUTPUT_READ_AND_HWPX_REOPEN_VALIDATION",
    wallMs: output.wallMs,
    hardTargetScope: "EXPORTER_TOTAL_MS",
    hardTargetApplied: packaged,
    publicationIrCompileMs: report.summary.publicationIrCompileMs,
    selfReportedExporterMs: report.summary.exporterTotalMs,
    maximumMs,
  };
  verify(
    Number.isFinite(output.wallMs) &&
      output.wallMs >= 0 &&
      Number.isFinite(report.summary.publicationIrCompileMs) &&
      report.summary.publicationIrCompileMs >= 0 &&
      Number.isFinite(report.summary.exporterTotalMs) &&
      report.summary.exporterTotalMs >= 0 &&
      report.raw.timing.publicationIrCompileMs ===
        report.summary.publicationIrCompileMs &&
      report.raw.timing.exporterTotalMs === report.summary.exporterTotalMs &&
      report.raw.timing.totalMs === report.summary.reportTotalMs &&
      (!packaged || report.summary.exporterTotalMs <= maximumMs),
    `phase1h-${profile}-export-hard-target`,
    evidence,
  );
  return {
    ...evidence,
    wallWithinTarget: output.wallMs <= maximumMs,
    selfReportedWithinTarget: report.summary.exporterTotalMs <= maximumMs,
  };
}

async function completeSuccessfulExport(run, outputPath, reportPath, expected) {
  const replacingExisting = await fileExists(outputPath);
  const validation = await validateFromUi(run);
  const output = await runExportFromUi(run, outputPath, expected);
  run.atomicOutputExercised ||= replacingExisting;
  const report = await saveJsonReport(run, reportPath, expected, output);
  verify(
    output.structure.packageSectionCount ===
      report.summary.packageSectionCount &&
      output.structure.sourceCharacterCount ===
        report.summary.sourceCharacterCount &&
      output.structure.paragraphIdCount === report.raw.coverage.paragraphCount &&
      output.structure.runCount === report.raw.coverage.runCount,
    "phase1h-package-report-structural-bind",
  );
  const timing = assertExportHardTarget({
    profile: "normal",
    runNumber: null,
    scopeKind: expected.scopeKind,
    splitMode: expected.splitMode,
    output,
    report,
    maximumMs: NORMAL_EXPORT_HARD_TARGET_MS,
  });
  return { validation, output, report, timing };
}

async function completeSuccessfulHwpExport(
  run,
  outputPath,
  preservedHwpxPath,
  reportPath,
  expected,
  directHwpx,
) {
  const replacingExisting = await fileExists(outputPath);
  const workspace = hwpxWorkspace(run);
  const outputType = namedCombobox(workspace, "출력 형식");
  await outputType.selectOption("HWP");
  verify(
    (await workspace.getAttribute("data-hwpx-output-type")) === "HWP",
    "phase1h-hwp-output-type-selected",
  );
  const validation = await validateFromUi(run);
  const output = await runExportFromUi(run, outputPath, expected, "HWP");
  run.atomicOutputExercised ||= replacingExisting;
  verify(
    output.byteLength > 0 &&
      output.structure === null &&
      output.progress.hwpConversionObserved &&
      output.progress.reopenVerificationObserved &&
      !output.progress.hwpOnlyStagesAbsent,
    "phase1h-hwp-output-and-progress",
  );
  const preservedBytes = await readFile(preservedHwpxPath);
  const preservedHwpxSha256 = createHash("sha256").update(preservedBytes).digest("hex");
  const structure = validateGeneratedHwpx(preservedBytes, expected);
  const hwp = {
    preservedHwpxFileName: basename(preservedHwpxPath),
    preservedHwpxSha256,
  };
  const report = await saveJsonReport(run, reportPath, expected, output, hwp);
  const directHwpxIdentity = {
    sha256: preservedHwpxSha256,
    logicalPackageHash: report.summary.logicalPackageHash,
    sourcePublicationHash: report.raw.sourcePublicationHash,
    byteIdentical: preservedHwpxSha256 === directHwpx.output.sha256,
    logicalIdentical:
      report.summary.logicalPackageHash ===
      directHwpx.report.summary.logicalPackageHash,
    sourceIdentityIdentical:
      report.raw.sourcePublicationHash === directHwpx.report.raw.sourcePublicationHash &&
      report.raw.presetContentHash === directHwpx.report.raw.presetContentHash,
    structureIdentical:
      structure.sourceParagraphSequenceHash ===
      directHwpx.output.structure.sourceParagraphSequenceHash,
  };
  verify(
    report.raw.outputType === "HWP" &&
      report.raw.hwpConverted === true &&
      report.raw.hancomReopen === "PASSED" &&
      report.raw.hwpxSha256 === preservedHwpxSha256 &&
      report.raw.outputSha256 === output.sha256 &&
      report.raw.byteLength === output.byteLength,
    "phase1h-hwp-report-success",
  );
  verify(
    directHwpxIdentity.byteIdentical &&
      directHwpxIdentity.logicalIdentical &&
      directHwpxIdentity.sourceIdentityIdentical &&
      directHwpxIdentity.structureIdentical,
    "phase1h-hwp-preserved-hwpx-direct-identity",
    directHwpxIdentity,
  );
  run.hwpExportExercised = true;
  await outputType.selectOption("HWPX");
  return {
    validation,
    output: {
      byteLength: output.byteLength,
      sha256: output.sha256,
      wallMs: output.wallMs,
      progress: output.progress,
    },
    preservedHwpx: {
      byteLength: preservedBytes.length,
      sha256: preservedHwpxSha256,
      structure,
      directHwpxIdentity,
    },
    report: {
      outputType: report.raw.outputType,
      hwpConverted: report.raw.hwpConverted,
      hancomReopen: report.raw.hancomReopen,
      hwpConversionMs: report.raw.timing.hwpConversionMs,
      hwpReopenMs: report.raw.timing.hwpReopenMs,
      privateContentAbsent: report.privateContentAbsent,
      contactAbsent: report.contactAbsent,
      rawPathAbsent: report.rawPathAbsent,
    },
  };
}

async function runNormalStateScenario({ fixture, projectPath, userDataPath, paths }) {
  const run = await launchApplication({
    projectPath,
    userDataPath,
    dialogPlan: {
      hwpxPaths: [paths.sceneOutput],
      hwpPaths: [paths.hwpOutput],
      jsonReportPaths: [paths.sceneReport, paths.hwpReport],
      markdownReportPaths: [],
    },
  });
  try {
    reportStage("normal-state-open");
    await openProject(run);
    await enterHwpxExport(run);
    const hancom = await assertHancomState(run);
    reportStage("normal-state-preset-crud");
    const presetCrud = await exercisePresetCrud(run);
    reportStage("normal-state-snapshot-v5");
    const snapshot = await createHwpxSnapshot(run);
    await createMutationPreset(run);
    const snapshotRestore = await restoreHwpxSnapshot(run, snapshot);
    await namedCombobox(hwpxWorkspace(run), "preset").selectOption({
      label: "범용 출판사 제출본",
    });
    verify(
      !(await hwpxWorkspace(run)
        .getByLabel("장면 제목 포함", { exact: true })
        .isChecked()),
      "phase1h-built-in-scene-heading-omission",
    );
    const expected = await selectScopeAndSplit(run, fixture, "SCENE", "SINGLE");
    verify(
      expected.configuredOmissionBlockCount === 1 &&
        expected.headingCount === 3,
      "phase1h-built-in-scene-heading-omission-count",
    );
    expected.omittedHeadingTexts = ["Scene 000"];
    reportStage("normal-state-scene-export");
    const scene = await completeSuccessfulExport(
      run,
      paths.sceneOutput,
      paths.sceneReport,
      expected,
    );
    const hwp =
      hancom.status === "AVAILABLE"
        ? await completeSuccessfulHwpExport(
            run,
            paths.hwpOutput,
            paths.preservedHwpx,
            paths.hwpReport,
            expected,
            scene,
          )
        : null;
    hancom.automationAttempted = hwp !== null;
    const dialogs = await dialogEvidence(run);
    verify(
      dialogs?.calls.projectOpen === 1 &&
      dialogs.calls.hwpxSave === 1 &&
        dialogs.calls.hwpSave === (hwp ? 1 : 0) &&
      dialogs.calls.hwpxOverwriteConfirmationConfigured === 1 &&
        dialogs.calls.hwpOverwriteConfirmationConfigured === (hwp ? 1 : 0) &&
        dialogs.calls.jsonReportSave === (hwp ? 2 : 1) &&
        dialogs.calls.reportOverwriteConfirmationConfigured === (hwp ? 2 : 1) &&
      dialogs.remaining.hwpx === 0 &&
        dialogs.remaining.hwp === (hwp ? 0 : 1) &&
      dialogs.remaining.jsonReport === (hwp ? 0 : 1),
      "phase1h-state-dialog-contract",
    );
    reportStage("normal-state-close");
    const lifecycle = await closeWindowCleanly(run);
    const security = securityEvidence(run);
    assertSecurity(security);
    return {
      hancom,
      presetCrud,
      snapshot: { ...snapshot, ...snapshotRestore },
      scene: {
        scope: expected.scopeKind,
        outputBytes: scene.output.byteLength,
        outputSha256: scene.output.sha256,
        logicalPackageHash: scene.report.summary.logicalPackageHash,
        sourcePublicationHash: scene.report.summary.sourcePublicationHash,
        presetId: scene.report.summary.presetId,
        presetContentHash: scene.report.summary.presetContentHash,
        exporterTotalMs: scene.report.summary.exporterTotalMs,
        timing: scene.timing,
        validation: scene.report.summary.validation,
        sourceBlockCount: scene.report.summary.sourceBlockCount,
        exportedBlockCount: scene.report.summary.exportedBlockCount,
        fallbackBlockCount: scene.report.summary.fallbackBlockCount,
        configuredOmissionBlockCount:
          scene.report.summary.configuredOmissionBlockCount,
        rejectedBlockCount: scene.report.summary.rejectedBlockCount,
        sourceCharacterCount: scene.report.summary.sourceCharacterCount,
        exportedCharacterCount: scene.report.summary.exportedCharacterCount,
        configuredOmissionMessageCount:
          scene.report.summary.configuredOmissionMessageCount,
        structure: scene.output.structure,
      },
      hwp,
      dialogs,
      lifecycle,
      security,
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
  const run = await launchApplication({
    projectPath,
    userDataPath,
    dialogPlan: {
      hwpxPaths: [
        paths.workSingle,
        paths.workSingle,
        paths.volumeSingle,
        paths.chapterSingle,
        paths.sceneSingle,
        paths.workVolume,
        paths.noClobber,
      ],
      hwpPaths: [],
      jsonReportPaths: [
        paths.workSingleReport,
        paths.workOverwriteReport,
        paths.volumeReport,
        paths.chapterReport,
        paths.sceneReport,
        paths.workVolumeReport,
      ],
      markdownReportPaths: [paths.workVolumeMarkdown],
    },
  });
  try {
    reportStage("normal-export-reopen");
    await openProject(run);
    await enterHwpxExport(run);
    const hancom = await assertHancomState(run);
    const reopened = await assertReopenedPreset(run);
    const exports = [];

    let expected = await selectScopeAndSplit(run, fixture, "WORK", "SINGLE");
    verify(
      expected.pageNumberPosition === "BOTTOM_RIGHT",
      "phase1h-right-page-number-preset",
    );
    const work = await completeSuccessfulExport(
      run,
      paths.workSingle,
      paths.workSingleReport,
      expected,
    );
    exports.push({ scope: "WORK", splitMode: "SINGLE", ...work });

    const overwritten = await completeSuccessfulExport(
      run,
      paths.workSingle,
      paths.workOverwriteReport,
      expected,
    );
    verify(
      work.output.sha256 === overwritten.output.sha256 &&
        work.output.byteLength === overwritten.output.byteLength &&
        work.report.summary.logicalPackageHash ===
          overwritten.report.summary.logicalPackageHash,
      "phase1h-confirmed-overwrite-determinism",
    );
    exports.push({ scope: "WORK", splitMode: "SINGLE_OVERWRITE", ...overwritten });

    expected = await selectScopeAndSplit(run, fixture, "VOLUME", "SINGLE");
    exports.push({
      scope: "VOLUME",
      splitMode: "SINGLE",
      ...(await completeSuccessfulExport(
        run,
        paths.volumeSingle,
        paths.volumeReport,
        expected,
      )),
    });
    expected = await selectScopeAndSplit(run, fixture, "CHAPTER", "SINGLE");
    exports.push({
      scope: "CHAPTER",
      splitMode: "SINGLE",
      ...(await completeSuccessfulExport(
        run,
        paths.chapterSingle,
        paths.chapterReport,
        expected,
      )),
    });
    await namedCombobox(hwpxWorkspace(run), "페이지 번호 위치").selectOption(
      "BOTTOM_LEFT",
    );
    expected = await selectScopeAndSplit(run, fixture, "SCENE", "SINGLE");
    exports.push({
      scope: "SCENE",
      splitMode: "SINGLE",
      ...(await completeSuccessfulExport(
        run,
        paths.sceneSingle,
        paths.sceneReport,
        expected,
      )),
    });
    expected = await selectScopeAndSplit(run, fixture, "WORK", "VOLUME");
    const workVolume = await completeSuccessfulExport(
      run,
      paths.workVolume,
      paths.workVolumeReport,
      expected,
    );
    exports.push({ scope: "WORK", splitMode: "VOLUME", ...workVolume });
    const markdownReport = await saveMarkdownReport(
      run,
      paths.workVolumeMarkdown,
      workVolume.report.raw,
    );
    const reveal = await revealExport(run);

    await validateFromUi(run);
    const noClobber = await exerciseNoClobber(run, paths.noClobber);

    const dialogs = await dialogEvidence(run);
    verify(
      dialogs?.calls.projectOpen === 1 &&
        dialogs.calls.hwpxSave === 7 &&
        dialogs.calls.hwpxOverwriteConfirmationConfigured === 7 &&
        dialogs.calls.jsonReportSave === 6 &&
        dialogs.calls.markdownReportSave === 1 &&
        dialogs.calls.reportOverwriteConfirmationConfigured === 7 &&
        dialogs.calls.reveal === 1 &&
        dialogs.remaining.hwpx === 0 &&
        dialogs.remaining.hwp === 0 &&
        dialogs.remaining.jsonReport === 0 &&
        dialogs.remaining.markdownReport === 0,
      "phase1h-normal-dialog-contract",
    );
    reportStage("normal-export-close");
    const lifecycle = await closeWindowCleanly(run);
    const security = securityEvidence(run);
    assertSecurity(security);
    return {
      hancom,
      reopened,
      exporterHardTargetMs: NORMAL_EXPORT_HARD_TARGET_MS,
      scopes: exports.map((entry) => ({
        scope: entry.scope,
        splitMode: entry.splitMode,
        wallMs: entry.output.wallMs,
        exporterTotalMs: entry.report.summary.exporterTotalMs,
        timing: entry.timing,
        byteLength: entry.output.byteLength,
        outputSha256: entry.output.sha256,
        logicalPackageHash: entry.report.summary.logicalPackageHash,
        sourcePublicationHash: entry.report.summary.sourcePublicationHash,
        presetId: entry.report.summary.presetId,
        presetContentHash: entry.report.summary.presetContentHash,
        packageSectionCount: entry.output.structure.packageSectionCount,
        sourceSectionCount: entry.report.summary.sourceSectionCount,
        coverage: {
          exportedSectionCount: entry.report.summary.exportedSectionCount,
          sourceBlockCount: entry.report.summary.sourceBlockCount,
          exportedBlockCount: entry.report.summary.exportedBlockCount,
          fallbackBlockCount: entry.report.summary.fallbackBlockCount,
          configuredOmissionBlockCount:
            entry.report.summary.configuredOmissionBlockCount,
          rejectedBlockCount: entry.report.summary.rejectedBlockCount,
          sourceCharacterCount: entry.report.summary.sourceCharacterCount,
          exportedCharacterCount: entry.report.summary.exportedCharacterCount,
        },
        validation: entry.report.summary.validation,
      })),
      overwrite: {
        replaceExisting: true,
        byteDeterministic: true,
        logicalDeterministic: true,
      },
      pageNumberPositions: ["BOTTOM_RIGHT", "BOTTOM_LEFT"],
      noClobber,
      jsonPrivacy: exports.every(
        (entry) =>
          entry.report.privateContentAbsent &&
          entry.report.contactAbsent &&
          entry.report.rawPathAbsent,
      ),
      markdownReport,
      reveal,
      dialogs,
      lifecycle,
      security,
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
  const run = await launchApplication({
    projectPath,
    userDataPath,
    dialogPlan: {
      hwpxPaths: [paths.cancel, ...paths.outputs],
      hwpPaths: [],
      jsonReportPaths: [...paths.reports],
      markdownReportPaths: [],
    },
  });
  try {
    reportStage("long-open");
    await openProject(run);
    await enterHwpxExport(run);
    const hancom = await assertHancomState(run);
    const workspace = hwpxWorkspace(run);
    await namedCombobox(workspace, "preset").selectOption({
      label: "가독성 중심 검토본",
    });
    await workspace
      .getByLabel("연락처(일회성, report 제외)", { exact: true })
      .fill(privateContact);
    const expected = await selectScopeAndSplit(run, fixture, "WORK", "VOLUME");
    verify(
      expected.pageNumberPosition === "BOTTOM_CENTER",
      "phase1h-center-page-number-preset",
    );
    await validateFromUi(run);
    reportStage("long-cancel");
    const cancellation = await exerciseCancel(run, paths.cancel);

    const runs = [];
    for (let index = 0; index < measurementRuns; index += 1) {
      reportStage(`long-export-${index + 1}`);
      await validateFromUi(run);
      const output = await runExportFromUi(run, paths.outputs[index], expected);
      const report = await saveJsonReport(
        run,
        paths.reports[index],
        expected,
        output,
      );
      const timing = assertExportHardTarget({
        profile: "long",
        runNumber: index + 1,
        scopeKind: expected.scopeKind,
        splitMode: expected.splitMode,
        output,
        report,
        maximumMs: LONG_EXPORT_HARD_TARGET_MS,
      });
      runs.push({ output, report, timing });
    }
    const first = runs[0];
    verify(
      runs.every(
        (entry) =>
          entry.output.sha256 === first.output.sha256 &&
          entry.output.byteLength === first.output.byteLength &&
          entry.report.summary.logicalPackageHash ===
            first.report.summary.logicalPackageHash,
      ),
      "phase1h-long-determinism",
    );
    const timingKeys = [
      "publicationIrCompileMs",
      "semanticMappingMs",
      "styleTableMs",
      "sectionXmlMs",
      "packageDocumentsMs",
      "zipPackagingMs",
      "zipReopenMs",
      "internalValidationMs",
      "sourceCoverageMs",
      "exporterTotalMs",
      "totalMs",
    ];
    const phaseTiming = Object.fromEntries(
      timingKeys.map((key) => [
        key,
        summarizeMeasurements(runs.map((entry) => entry.report.raw.timing[key])),
      ]),
    );
    const frameGap = summarizeMeasurements(
      runs.map((entry) => entry.output.responsiveness.maximumFrameGapMs),
    );
    const heartbeatGap = summarizeMeasurements(
      runs.map((entry) => entry.output.responsiveness.maximumHeartbeatGapMs),
    );
    const availableMemory = runs
      .map((entry) => entry.output.memory)
      .filter((memory) => memory.available);
    verify(
      availableMemory.length === runs.length &&
        availableMemory.every(
          (sample) =>
            sample.processCount > 0 &&
            sample.workingSetBytes > 0 &&
            sample.privateBytes > 0,
        ),
      "phase1h-long-memory-sampling",
      { expectedRuns: runs.length, availableRuns: availableMemory.length },
    );
    const memory = {
      availableRuns: availableMemory.length,
      maximumWorkingSetBytes:
        availableMemory.length > 0
          ? Math.max(...availableMemory.map((sample) => sample.workingSetBytes))
          : null,
      maximumPrivateBytes:
        availableMemory.length > 0
          ? Math.max(...availableMemory.map((sample) => sample.privateBytes))
          : null,
      maximumProcessCount:
        availableMemory.length > 0
          ? Math.max(...availableMemory.map((sample) => sample.processCount))
          : null,
      firstToLastWorkingSetDeltaBytes:
        availableMemory.length === runs.length
          ? availableMemory.at(-1).workingSetBytes -
            availableMemory[0].workingSetBytes
          : null,
      firstToLastPrivateDeltaBytes:
        availableMemory.length === runs.length
          ? availableMemory.at(-1).privateBytes - availableMemory[0].privateBytes
          : null,
    };
    const dialogs = await dialogEvidence(run);
    verify(
      dialogs?.calls.projectOpen === 1 &&
        dialogs.calls.hwpxSave === measurementRuns + 1 &&
        dialogs.calls.hwpxOverwriteConfirmationConfigured ===
          measurementRuns + 1 &&
        dialogs.calls.jsonReportSave === measurementRuns &&
        dialogs.calls.reportOverwriteConfirmationConfigured === measurementRuns &&
        dialogs.remaining.hwpx === 0 &&
        dialogs.remaining.hwp === 0 &&
        dialogs.remaining.jsonReport === 0 &&
        dialogs.remaining.markdownReport === 0,
      "phase1h-long-dialog-contract",
    );
    reportStage("long-close");
    const lifecycle = await closeWindowCleanly(run);
    const security = securityEvidence(run);
    assertSecurity(security);
    return {
      hancom,
      cancellation,
      measurementRuns,
      exporterHardTargetMs: LONG_EXPORT_HARD_TARGET_MS,
      exporterTiming: phaseTiming.exporterTotalMs,
      phaseTiming,
      wallTiming: summarizeMeasurements(runs.map((entry) => entry.output.wallMs)),
      hardTargetRuns: runs.map((entry) => entry.timing),
      responsiveness: { frameGap, heartbeatGap },
      memory,
      byteLength: first.output.byteLength,
      byteDeterministic: true,
      logicalDeterministic: true,
      artifactRuns: runs.map((entry, index) => ({
        runNumber: index + 1,
        byteLength: entry.output.byteLength,
        outputSha256: entry.output.sha256,
        logicalPackageHash: entry.report.summary.logicalPackageHash,
        sourcePublicationHash: entry.report.summary.sourcePublicationHash,
        presetId: entry.report.summary.presetId,
        presetContentHash: entry.report.summary.presetContentHash,
        coverage: {
          packageSectionCount: entry.report.summary.packageSectionCount,
          sourceSectionCount: entry.report.summary.sourceSectionCount,
          exportedSectionCount: entry.report.summary.exportedSectionCount,
          sourceBlockCount: entry.report.summary.sourceBlockCount,
          exportedBlockCount: entry.report.summary.exportedBlockCount,
          fallbackBlockCount: entry.report.summary.fallbackBlockCount,
          configuredOmissionBlockCount:
            entry.report.summary.configuredOmissionBlockCount,
          rejectedBlockCount: entry.report.summary.rejectedBlockCount,
          sourceCharacterCount: entry.report.summary.sourceCharacterCount,
          exportedCharacterCount: entry.report.summary.exportedCharacterCount,
        },
        validation: entry.report.summary.validation,
      })),
      progressStages: first.output.progress.stages,
      hwpOnlyProgressStagesAbsent: first.output.progress.hwpOnlyStagesAbsent,
      packageSectionCount: first.output.structure.packageSectionCount,
      sourceSectionCount: first.report.summary.sourceSectionCount,
      sourceBlockCount: first.report.summary.sourceBlockCount,
      sourceCharacterCount: first.report.summary.sourceCharacterCount,
      pageNumberPosition: expected.pageNumberPosition,
      richSemantics: {
        strong: first.output.structure.strongPreserved,
        emphasis: first.output.structure.emphasisPreserved,
        underline: first.output.structure.underlinePreserved,
        strike: first.output.structure.strikePreserved,
        rubyPlainTextFallback: first.output.structure.rubyPlainTextFallback,
        rubyAnnotationPreserved: first.output.structure.rubyAnnotationPreserved,
      },
      dialogs,
      lifecycle,
      security,
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

function aggregateSecurity(runs) {
  return {
    networkCaptureMode:
      "RENDERER_EVENTS_AND_WIN32_NETSTAT_OWNED_PROCESS_INSTANCE_TCP_CLASSIFICATION",
    externalRequestCount: runs.reduce(
      (sum, run) => sum + run.security.externalRequestCount,
      0,
    ),
    externalWebSocketCount: runs.reduce(
      (sum, run) => sum + run.security.externalWebSocketCount,
      0,
    ),
    ownedTcpPeerNonLoopbackObservationCount: runs.reduce(
      (sum, run) =>
        sum +
        run.lifecycle.processTracking.ownedTcpPeerNonLoopbackObservationCount,
      0,
    ),
    ownedTcpPeerBoundaryViolationCount: runs.reduce(
      (sum, run) =>
        sum +
        run.lifecycle.processTracking.ownedTcpPeerBoundaryViolationCount,
      0,
    ),
    ownedTcpListenerBoundaryViolationCount: runs.reduce(
      (sum, run) =>
        sum +
        run.lifecycle.processTracking.ownedTcpListenerBoundaryViolationCount,
      0,
    ),
    ownedTcpClassificationFailureCount: runs.reduce(
      (sum, run) =>
        sum +
        run.lifecycle.processTracking.ownedTcpClassificationFailureCount,
      0,
    ),
    ownedTcpIdentityRaceCount: runs.reduce(
      (sum, run) =>
        sum + run.lifecycle.processTracking.ownedTcpIdentityRaceCount,
      0,
    ),
    globalTcpParserRejectedRowCount: runs.reduce(
      (sum, run) =>
        sum + run.lifecycle.processTracking.globalTcpParserRejectedRowCount,
      0,
    ),
    ownedTcpBoundaryViolationObserved: runs.some(
      (run) =>
        run.lifecycle.processTracking.ownedTcpBoundaryViolationRowCount > 0,
    ),
    externalRuntimeNetworkObservationCount: runs.reduce(
      (sum, run) =>
        sum +
        run.security.externalRequestCount +
        run.security.externalWebSocketCount +
        run.lifecycle.processTracking.ownedTcpPeerBoundaryViolationCount +
        run.lifecycle.processTracking.ownedTcpListenerBoundaryViolationCount,
      0,
    ),
    allRequiredSpawnRolesObserved: runs.every(
      (run) => run.lifecycle.processTracking.requiredSpawnRolesObserved,
    ),
    allProcessCommandPathModesMatched: runs.every(
      (run) =>
        run.lifecycle.processTracking.allObservedCommandsUseExpectedPathMode,
    ),
    pageErrorCount: runs.reduce((sum, run) => sum + run.security.pageErrors.length, 0),
    rendererDiagnosticCount: runs.reduce(
      (sum, run) => sum + run.security.rendererDiagnostics.length,
      0,
    ),
    unexpectedProcessDiagnosticCount: runs.reduce(
      (sum, run) => sum + run.security.unexpectedDiagnosticCount,
      0,
    ),
    allLocalFileProbesBlocked: runs.every((run) => run.security.localFileBlocked),
    allRendererProtocolsPinned: runs.every(
      (run) => run.security.runtime.rendererProtocol === "madi:",
    ),
    allModesMatched: runs.every(
      (run) => run.security.runtime.isPackaged === packaged,
    ),
    allProductBackgroundNetworkingDisabled: runs.every(
      (run) => run.security.runtime.backgroundNetworkingDisabled === true,
    ),
    allProductComponentUpdateDisabled: runs.every(
      (run) => run.security.runtime.componentUpdateDisabled === true,
    ),
    allProductQuicDisabled: runs.every(
      (run) => run.security.runtime.quicDisabled === true,
    ),
    allProductProxyServerDisabled: runs.every(
      (run) => run.security.runtime.proxyServerDisabled === true,
    ),
    allProductCertificateTransparencyComponentUpdaterDisabled: runs.every(
      (run) =>
        run.security.runtime
          .certificateTransparencyComponentUpdaterDisabled === true,
    ),
    allProductDialMediaRouteProviderDisabled: runs.every(
      (run) => run.security.runtime.dialMediaRouteProviderDisabled === true,
    ),
    allProductMediaRouterDisabled: runs.every(
      (run) => run.security.runtime.mediaRouterDisabled === true,
    ),
  };
}

async function finalizePackagedOverrideCanaries() {
  if (!packaged) return null;
  const hook = Reflect.get(
    globalThis,
    "__madiPhase1hFinalizePackagedOverrideCanaries",
  );
  verify(
    typeof hook === "function",
    "phase1h-packaged-override-finalizer-missing",
  );
  const evidence = await hook();
  verify(
    hasExactKeys(evidence, [
      "rendererRequestCount",
      "coreOverridePresent",
      "exporterOverridePresent",
      "bridgeOverridePresent",
      "atomicOutputOverridePresent",
    ]) &&
      evidence.rendererRequestCount === 0 &&
      evidence.coreOverridePresent === false &&
      evidence.exporterOverridePresent === false &&
      evidence.bridgeOverridePresent === false &&
      evidence.atomicOutputOverridePresent === false,
    "phase1h-packaged-override-finalizer-result",
  );
  return evidence;
}

async function removeKnownArtifact(filePath) {
  verify(isWithin(filePath, artifactDirectory), "phase1h-artifact-remove-scope");
  try {
    const entry = await lstat(filePath);
    verify(entry.isFile() && !entry.isSymbolicLink(), "phase1h-artifact-remove-type");
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function main() {
  reportStage("preflight");
  verify(process.platform === "win32", "phase1h-windows-only");
  const manifest = validateFixtureManifest(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  await mkdir(artifactDirectory, { recursive: true });
  await removeKnownArtifact(evidencePath);
  const baselineGlobalArtifacts = await listGlobalHwpxTempArtifacts();
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "madi-phase1h-"));
  let evidenceWritten = false;
  try {
    const normal = await prepareFixture("normal", manifest, temporaryRoot);
    const long = await prepareFixture("long", manifest, temporaryRoot);
    const normalOutput = resolve(temporaryRoot, "normal-output");
    const longOutput = resolve(temporaryRoot, "long-output");
    await Promise.all([
      mkdir(normalOutput, { recursive: true }),
      mkdir(longOutput, { recursive: true }),
    ]);
    const normalStatePaths = {
      sceneOutput: resolve(normalOutput, "state-scene-direct.hwpx"),
      sceneReport: resolve(normalOutput, "state-scene.json"),
      hwpOutput: resolve(normalOutput, "state-scene.hwp"),
      preservedHwpx: resolve(normalOutput, "state-scene.hwpx"),
      hwpReport: resolve(normalOutput, "state-scene-hwp.json"),
    };
    const normalPaths = {
      workSingle: resolve(normalOutput, "work-single.hwpx"),
      workSingleReport: resolve(normalOutput, "work-single.json"),
      workOverwriteReport: resolve(normalOutput, "work-overwrite.json"),
      volumeSingle: resolve(normalOutput, "volume-single.hwpx"),
      volumeReport: resolve(normalOutput, "volume-single.json"),
      chapterSingle: resolve(normalOutput, "chapter-single.hwpx"),
      chapterReport: resolve(normalOutput, "chapter-single.json"),
      sceneSingle: resolve(normalOutput, "scene-single.hwpx"),
      sceneReport: resolve(normalOutput, "scene-single.json"),
      workVolume: resolve(normalOutput, "work-volume.hwpx"),
      workVolumeReport: resolve(normalOutput, "work-volume.json"),
      workVolumeMarkdown: resolve(normalOutput, "work-volume.md"),
      noClobber: resolve(normalOutput, "no-clobber.hwpx"),
    };
    const longPaths = {
      cancel: resolve(longOutput, "cancel.hwpx"),
      outputs: Array.from({ length: measurementRuns }, (_, index) =>
        resolve(longOutput, `long-${index + 1}.hwpx`),
      ),
      reports: Array.from({ length: measurementRuns }, (_, index) =>
        resolve(longOutput, `long-${index + 1}.json`),
      ),
    };
    for (const filePath of [
      ...Object.values(normalStatePaths),
      ...Object.values(normalPaths),
      longPaths.cancel,
      ...longPaths.outputs,
      ...longPaths.reports,
    ]) {
      verify(isWithin(filePath, temporaryRoot), "phase1h-operation-path-scope");
    }

    const normalState = await runNormalStateScenario({
      fixture: normal.fixture,
      projectPath: normal.projectPath,
      userDataPath: resolve(temporaryRoot, "user-data-normal-state"),
      paths: normalStatePaths,
    });
    const normalExport = await runNormalExportScenario({
      fixture: normal.fixture,
      projectPath: normal.projectPath,
      userDataPath: resolve(temporaryRoot, "user-data-normal-export"),
      paths: normalPaths,
    });
    const longExport = await runLongExportScenario({
      fixture: long.fixture,
      projectPath: long.projectPath,
      userDataPath: resolve(temporaryRoot, "user-data-long"),
      paths: longPaths,
    });
    const runs = [normalState, normalExport, longExport];
    const hancomAvailable = normalState.hancom.status === "AVAILABLE";
    verify(
      runs.every(
        (run) =>
          run.hancom.status === normalState.hancom.status &&
          run.hancom.reason === normalState.hancom.reason &&
          run.hancom.hwpOptionDisabled === !hancomAvailable &&
          run.hancom.securityModuleVerified === hancomAvailable &&
          run.hancom.hancomProcessLaunchAllowed === hancomAvailable,
      ) &&
        normalState.hancom.automationAttempted === hancomAvailable &&
        Boolean(normalState.hwp) === hancomAvailable &&
        runs.slice(1).every((run) => !run.hancom.automationAttempted),
      "phase1h-hancom-consistency",
      runs.map((run) => ({ ...run.hancom, hwpExported: Boolean(run.hwp) })),
    );
    const security = aggregateSecurity(runs);
    verify(
      security.externalRequestCount === 0 &&
        security.externalWebSocketCount === 0 &&
        security.ownedTcpPeerNonLoopbackObservationCount === 0 &&
        security.ownedTcpPeerBoundaryViolationCount === 0 &&
        security.ownedTcpListenerBoundaryViolationCount === 0 &&
        security.ownedTcpClassificationFailureCount === 0 &&
        security.ownedTcpIdentityRaceCount === 0 &&
        security.ownedTcpBoundaryViolationObserved === false &&
        security.externalRuntimeNetworkObservationCount === 0 &&
        security.pageErrorCount === 0 &&
        security.rendererDiagnosticCount === 0 &&
        security.unexpectedProcessDiagnosticCount === 0 &&
        security.allLocalFileProbesBlocked &&
        security.allRendererProtocolsPinned &&
        security.allModesMatched &&
        security.allProductBackgroundNetworkingDisabled &&
        security.allProductComponentUpdateDisabled &&
        security.allProductQuicDisabled &&
        security.allProductProxyServerDisabled &&
        security.allProductCertificateTransparencyComponentUpdaterDisabled &&
        security.allProductDialMediaRouteProviderDisabled &&
        security.allProductMediaRouterDisabled &&
        security.allRequiredSpawnRolesObserved &&
        security.allProcessCommandPathModesMatched,
      "phase1h-aggregate-security",
      security,
    );
    const packagedDevelopmentOverrides =
      await finalizePackagedOverrideCanaries();
    if (packagedDevelopmentOverrides) {
      security.packagedDevelopmentOverrides = packagedDevelopmentOverrides;
    }
    const lifecycles = runs.map((run) => run.lifecycle);
    const cleanup = await validateCleanupState(
      temporaryRoot,
      baselineGlobalArtifacts,
      lifecycles,
    );
    const evidence = {
      status: "PASS",
      phase: "1H",
      packaged,
      actualElectron: true,
      generatedArtifactPolicy: "PRIVACY_SAFE_SUMMARY_ONLY",
      hancomContract: {
        availability: normalState.hancom.status,
        unavailableReason: normalState.hancom.reason,
        hwpDisabled: normalState.hancom.hwpOptionDisabled,
        securityModuleVerified: normalState.hancom.securityModuleVerified,
        comOrHwpLaunchAttempted: normalState.hancom.automationAttempted,
        hancomReopen: normalState.hwp?.report.hancomReopen ?? "NOT_RUN",
        reopenClaimed: normalState.hwp?.report.hancomReopen === "PASSED",
      },
      fixtures: {
        normal: fixtureEvidence(normal.fixture),
        long: fixtureEvidence(long.fixture),
      },
      normalState,
      normalExport,
      longExport,
      security,
      cleanup,
    };
    assertEvidencePrivacy(evidence);
    await writeJsonAtomically(evidencePath, evidence);
    evidenceWritten = true;
    process.stdout.write(
      `${JSON.stringify({
        check: packaged ? "packaged-phase1h-actual" : "dev-phase1h-actual",
        status: "PASS",
        measurementRuns,
        exporterMaxMs: longExport.exporterTiming.maxMs,
        exporterHardTargetMs: LONG_EXPORT_HARD_TARGET_MS,
        hancomReopen: normalState.hwp?.report.hancomReopen ?? "NOT_RUN",
      })}\n`,
    );
  } finally {
    await removeTemporaryRoot(temporaryRoot);
    if (!evidenceWritten && (await fileExists(evidencePath))) {
      await removeKnownArtifact(evidencePath);
    }
  }
}

try {
  await main();
} catch (error) {
  const summary = summarizeError(error);
  let evidenceWriteFailed = false;
  try {
    const failureEvidence = {
      status: "FAIL",
      phase: "1H",
      packaged,
      stage: currentStage,
      error: summary,
      context: lastFailureContext,
      hancomReopen: "NOT_RUN",
    };
    assertEvidencePrivacy(failureEvidence);
    await writeJsonAtomically(evidencePath, failureEvidence);
  } catch {
    evidenceWriteFailed = true;
  }
  process.stderr.write(
    `[electron-phase1h] failed ${JSON.stringify({
      error: summary,
      evidenceWriteFailed,
    })}\n`,
  );
  process.exitCode = 1;
}
