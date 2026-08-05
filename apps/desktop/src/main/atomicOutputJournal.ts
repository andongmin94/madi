import { createHash } from "node:crypto";
import path from "node:path";
import { lstat, open } from "node:fs/promises";
import type {
  AtomicOutputIdentity,
  AtomicOutputPort,
  AtomicOutputRecoveryArtifact
} from "./atomicOutputClient";

const JOURNAL_SCHEMA_VERSION = 1;
const PREPARED_FILE_NAME = ".madi-atomic-output-prepared-v1.json";
const COMMITTED_FILE_NAME = ".madi-atomic-output-committed-v1.json";
const ABORTED_FILE_NAME = ".madi-atomic-output-aborted-v1.json";
const MAX_JOURNAL_BYTES = 16 * 1024;
const MAX_PATH_LENGTH = 32_767;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/u;
const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PRIVATE_FILE_PATTERN = new RegExp(
  `^(?:madi-atomic-backup|madi-atomic-rollback)-${UUID_PATTERN}\\.bin$`,
  "iu"
);
const RECOVERY_FILE_PATTERN = new RegExp(
  `^.+\\.madi-recovery-${UUID_PATTERN}(?:\\.[^.]+)?$`,
  "iu"
);
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const VOLUME_PATTERN = /^[0-9a-f]{16}$/u;
const FILE_ID_PATTERN = /^[0-9a-f]{32}$/u;

export interface AtomicOutputJournalPreparation {
  readonly stagedPath: string;
  readonly destinationPath: string;
  readonly backupPath: string;
  readonly rollbackPath: string;
  readonly recoveryPath: string;
  readonly maximumBytes: number;
  readonly expected: AtomicOutputIdentity;
  readonly stagedIdentity: AtomicOutputIdentity;
}

export interface AtomicOutputPreparedIntent {
  readonly schemaVersion: 1;
  readonly registryId: string;
  readonly ownershipToken: string;
  readonly stagedFileName: string;
  readonly destinationPath: string;
  readonly backupFileName: string;
  readonly rollbackFileName: string;
  readonly recoveryPath: string;
  readonly maximumBytes: number;
  readonly expected: AtomicOutputIdentity;
  readonly stagedIdentity: AtomicOutputIdentity;
}

interface AtomicOutputTerminalMarker {
  readonly schemaVersion: 1;
  readonly registryId: string;
  readonly ownershipToken: string;
  readonly intentSha256: string;
  readonly outcome: "COMMITTED" | "ABORTED_SAFE";
}

export interface AtomicOutputJournalOwner {
  readonly registryId: string;
  readonly ownershipToken: string;
}

export type AtomicOutputJournalReconcileResult =
  | { readonly status: "NO_INTENT" | "SAFE"; readonly recoveryFileName: null }
  | {
      readonly status: "RECOVERY_PUBLISHED";
      readonly recoveryFileName: string;
    }
  | { readonly status: "RECOVERY_REQUIRED"; readonly recoveryFileName: null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\n") === [...keys].sort().join("\n");
}

function validIdentity(value: unknown): value is AtomicOutputIdentity {
  if (!isRecord(value) || !exact(value, ["byteLength", "fileId", "sha256", "volumeSerialNumber"])) {
    return false;
  }
  return (
    Number.isSafeInteger(value.byteLength) &&
    (value.byteLength as number) > 0 &&
    (value.byteLength as number) <= 512 * 1024 * 1024 &&
    typeof value.sha256 === "string" &&
    HASH_PATTERN.test(value.sha256) &&
    typeof value.volumeSerialNumber === "string" &&
    VOLUME_PATTERN.test(value.volumeSerialNumber) &&
    typeof value.fileId === "string" &&
    FILE_ID_PATTERN.test(value.fileId)
  );
}

function validAbsolutePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PATH_LENGTH &&
    path.isAbsolute(value) &&
    path.resolve(value) === value
  );
}

function validSimpleFileName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 255 &&
    path.basename(value) === value &&
    value !== "." &&
    value !== ".."
  );
}

function parsePrepared(
  source: string,
  owner: AtomicOutputJournalOwner
): AtomicOutputPreparedIntent | null {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    !exact(value, [
      "backupFileName",
      "destinationPath",
      "expected",
      "maximumBytes",
      "ownershipToken",
      "recoveryPath",
      "registryId",
      "rollbackFileName",
      "schemaVersion",
      "stagedFileName",
      "stagedIdentity"
    ]) ||
    value.schemaVersion !== JOURNAL_SCHEMA_VERSION ||
    value.registryId !== owner.registryId ||
    value.ownershipToken !== owner.ownershipToken ||
    !TOKEN_PATTERN.test(owner.ownershipToken) ||
    !validSimpleFileName(value.stagedFileName) ||
    !validSimpleFileName(value.backupFileName) ||
    !PRIVATE_FILE_PATTERN.test(value.backupFileName) ||
    !validSimpleFileName(value.rollbackFileName) ||
    !PRIVATE_FILE_PATTERN.test(value.rollbackFileName) ||
    value.backupFileName === value.rollbackFileName ||
    !validAbsolutePath(value.destinationPath) ||
    !validAbsolutePath(value.recoveryPath) ||
    path.dirname(value.destinationPath) !== path.dirname(value.recoveryPath) ||
    value.destinationPath === value.recoveryPath ||
    !RECOVERY_FILE_PATTERN.test(path.basename(value.recoveryPath)) ||
    !Number.isSafeInteger(value.maximumBytes) ||
    (value.maximumBytes as number) < 1 ||
    (value.maximumBytes as number) > 512 * 1024 * 1024 ||
    !validIdentity(value.expected) ||
    !validIdentity(value.stagedIdentity)
  ) {
    return null;
  }
  return value as unknown as AtomicOutputPreparedIntent;
}

async function readBounded(filePath: string): Promise<string | null> {
  let pathIdentity;
  try {
    pathIdentity = await lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  if (
    !pathIdentity.isFile() ||
    pathIdentity.isSymbolicLink() ||
    pathIdentity.size < 2 ||
    pathIdentity.size > MAX_JOURNAL_BYTES
  ) {
    throw new Error("The atomic output journal is not a bounded regular file");
  }
  const handle = await open(filePath, "r");
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.size !== pathIdentity.size ||
      before.dev !== pathIdentity.dev ||
      before.ino !== pathIdentity.ino
    ) {
      throw new Error("The atomic output journal changed while opening");
    }
    const bytes = Buffer.allocUnsafe(MAX_JOURNAL_BYTES + 1);
    let length = 0;
    while (length < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, length, bytes.byteLength - length, length);
      if (bytesRead === 0) {
        break;
      }
      length += bytesRead;
    }
    const after = await handle.stat();
    if (
      length !== before.size ||
      length > MAX_JOURNAL_BYTES ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size
    ) {
      throw new Error("The atomic output journal changed while reading");
    }
    return bytes.subarray(0, length).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function writeExclusiveSynced(filePath: string, source: string): Promise<void> {
  if (Buffer.byteLength(source, "utf8") > MAX_JOURNAL_BYTES) {
    throw new Error("The atomic output journal exceeds the size limit");
  }
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(source, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function intentSource(intent: AtomicOutputPreparedIntent): string {
  return `${JSON.stringify(intent)}\n`;
}

function intentSha256(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

export async function prepareAtomicOutputJournal(
  directoryPath: string,
  owner: AtomicOutputJournalOwner,
  preparation: AtomicOutputJournalPreparation
): Promise<AtomicOutputPreparedIntent> {
  const resolvedDirectory = path.resolve(directoryPath);
  const stagedPath = path.resolve(preparation.stagedPath);
  const backupPath = path.resolve(preparation.backupPath);
  const rollbackPath = path.resolve(preparation.rollbackPath);
  if (
    !TOKEN_PATTERN.test(owner.ownershipToken) ||
    path.dirname(stagedPath) !== resolvedDirectory ||
    path.dirname(backupPath) !== resolvedDirectory ||
    path.dirname(rollbackPath) !== resolvedDirectory
  ) {
    throw new Error("The atomic output journal paths are outside the owned directory");
  }
  const intent: AtomicOutputPreparedIntent = {
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    registryId: owner.registryId,
    ownershipToken: owner.ownershipToken,
    stagedFileName: path.basename(stagedPath),
    destinationPath: path.resolve(preparation.destinationPath),
    backupFileName: path.basename(backupPath),
    rollbackFileName: path.basename(rollbackPath),
    recoveryPath: path.resolve(preparation.recoveryPath),
    maximumBytes: preparation.maximumBytes,
    expected: preparation.expected,
    stagedIdentity: preparation.stagedIdentity
  };
  const source = intentSource(intent);
  if (!parsePrepared(source, owner)) {
    throw new Error("The atomic output journal preparation is invalid");
  }
  await writeExclusiveSynced(path.join(resolvedDirectory, PREPARED_FILE_NAME), source);
  return intent;
}

export async function writeAtomicOutputTerminal(
  directoryPath: string,
  owner: AtomicOutputJournalOwner,
  outcome: AtomicOutputTerminalMarker["outcome"]
): Promise<void> {
  const preparedSource = await readBounded(path.join(directoryPath, PREPARED_FILE_NAME));
  if (!preparedSource || !parsePrepared(preparedSource, owner)) {
    throw new Error("The prepared atomic output journal is unavailable");
  }
  const terminal: AtomicOutputTerminalMarker = {
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    registryId: owner.registryId,
    ownershipToken: owner.ownershipToken,
    intentSha256: intentSha256(preparedSource),
    outcome
  };
  await writeExclusiveSynced(
    path.join(
      directoryPath,
      outcome === "COMMITTED" ? COMMITTED_FILE_NAME : ABORTED_FILE_NAME
    ),
    `${JSON.stringify(terminal)}\n`
  );
}

function artifactPath(
  directoryPath: string,
  intent: AtomicOutputPreparedIntent,
  artifact: AtomicOutputRecoveryArtifact
): string {
  switch (artifact.source) {
    case "STAGED":
      return path.join(directoryPath, intent.stagedFileName);
    case "BACKUP":
      return path.join(directoryPath, intent.backupFileName);
    case "ROLLBACK":
      return path.join(directoryPath, intent.rollbackFileName);
  }
}

function samePublishedContent(
  actual: AtomicOutputIdentity,
  expected: AtomicOutputIdentity
): boolean {
  return (
    actual.byteLength === expected.byteLength &&
    actual.sha256 === expected.sha256 &&
    actual.volumeSerialNumber === expected.volumeSerialNumber
  );
}

export async function reconcileAtomicOutputJournal(
  directoryPath: string,
  owner: AtomicOutputJournalOwner,
  atomicOutput: AtomicOutputPort
): Promise<AtomicOutputJournalReconcileResult> {
  const preparedSource = await readBounded(path.join(directoryPath, PREPARED_FILE_NAME));
  if (!preparedSource) {
    return { status: "NO_INTENT", recoveryFileName: null };
  }
  const intent = parsePrepared(preparedSource, owner);
  if (!intent) {
    return { status: "RECOVERY_REQUIRED", recoveryFileName: null };
  }
  const input = {
    stagedPath: path.join(directoryPath, intent.stagedFileName),
    destinationPath: intent.destinationPath,
    backupPath: path.join(directoryPath, intent.backupFileName),
    rollbackPath: path.join(directoryPath, intent.rollbackFileName),
    maximumBytes: intent.maximumBytes,
    expected: intent.expected,
    stagedIdentity: intent.stagedIdentity
  };
  let recovered;
  try {
    recovered = await atomicOutput.recover(input);
  } catch {
    return { status: "RECOVERY_REQUIRED", recoveryFileName: null };
  }
  if (recovered.outcome !== "RECOVERY_REQUIRED") {
    return { status: "SAFE", recoveryFileName: null };
  }
  const sourcePath = artifactPath(directoryPath, intent, recovered.recoveryArtifact);
  let published: AtomicOutputIdentity;
  try {
    published = await atomicOutput.publishRecovery({
      sourcePath,
      recoveryPath: intent.recoveryPath,
      maximumBytes: intent.maximumBytes,
      expected: recovered.recoveryArtifact.identity
    });
  } catch {
    try {
      published = await atomicOutput.inspect(intent.recoveryPath, intent.maximumBytes);
    } catch {
      return { status: "RECOVERY_REQUIRED", recoveryFileName: null };
    }
  }
  if (!samePublishedContent(published, recovered.recoveryArtifact.identity)) {
    return { status: "RECOVERY_REQUIRED", recoveryFileName: null };
  }
  return {
    status: "RECOVERY_PUBLISHED",
    recoveryFileName: path.basename(intent.recoveryPath)
  };
}

export async function atomicOutputJournalExists(directoryPath: string): Promise<boolean> {
  return (await readBounded(path.join(directoryPath, PREPARED_FILE_NAME))) !== null;
}
