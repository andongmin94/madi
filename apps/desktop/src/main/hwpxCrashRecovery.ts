import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import {
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  unlink
} from "node:fs/promises";
import type { AtomicOutputPort } from "./atomicOutputClient";
import {
  atomicOutputJournalExists,
  prepareAtomicOutputJournal,
  reconcileAtomicOutputJournal,
  writeAtomicOutputTerminal,
  type AtomicOutputJournalPreparation,
  type AtomicOutputJournalReconcileResult
} from "./atomicOutputJournal";

const RECOVERY_SCHEMA_VERSION = 1;
const OWNERSHIP_MARKER_NAME = ".madi-hwpx-ownership-v1.json";
const MAX_RECOVERY_ENTRIES = 1_024;
const MAX_RECOVERY_RECORD_BYTES = 4_096;
const MAX_RECOVERY_PATH_LENGTH = 32_767;
const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const REGISTRY_FILE_PATTERN = new RegExp(`^(${UUID_PATTERN})\\.json$`, "iu");
const MANAGED_DIRECTORY_PATTERN = new RegExp(
  `^\\.madi-hwpx-(?:operation-${UUID_PATTERN}|report-${UUID_PATTERN}-(?:json|md))$`,
  "iu"
);
const CLAIM_DIRECTORY_PATTERN = new RegExp(
  `^\\.madi-hwpx-recovery-claim-${UUID_PATTERN}$`,
  "iu"
);
const TOKEN_PATTERN = /^[0-9a-f]{64}$/u;

interface HwpxRecoveryRecord {
  readonly schemaVersion: 1;
  readonly registryId: string;
  readonly ownershipToken: string;
  readonly ownerPid: number;
  readonly directoryPath: string;
  readonly directoryName: string;
  readonly claimPath: string;
  readonly directoryDevice: string;
  readonly directoryInode: string;
  readonly createdAtUnixMs: number;
}

type RecoveryOutcome = "CLEANED" | "LIVE" | "UNTRUSTED" | "PRESERVED";
type RecoveryCandidate =
  | { readonly status: "MISSING" | "UNTRUSTED" }
  | {
      readonly status: "MATCH";
      readonly device: string;
      readonly inode: string;
    };

export interface HwpxCrashRecoveryPort {
  initialize(): Promise<void>;
  register(directoryPath: string): Promise<void>;
  prepareAtomicOutput(
    directoryPath: string,
    preparation: AtomicOutputJournalPreparation
  ): Promise<void>;
  markAtomicOutputTerminal(
    directoryPath: string,
    outcome: "COMMITTED" | "ABORTED_SAFE"
  ): Promise<void>;
  reconcileAtomicOutput(
    directoryPath: string
  ): Promise<AtomicOutputJournalReconcileResult>;
  remove(directoryPath: string): Promise<void>;
}

export interface FileHwpxCrashRecoveryRegistryOptions {
  readonly ownerPid?: number;
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly atomicOutput?: AtomicOutputPort;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafePid(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) > 0 &&
    (value as number) <= 0x7fff_ffff
  );
}

function isManagedDirectoryPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_RECOVERY_PATH_LENGTH &&
    path.isAbsolute(value) &&
    path.resolve(value) === value &&
    MANAGED_DIRECTORY_PATTERN.test(path.basename(value))
  );
}

function isClaimPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_RECOVERY_PATH_LENGTH &&
    path.isAbsolute(value) &&
    path.resolve(value) === value &&
    CLAIM_DIRECTORY_PATTERN.test(path.basename(value))
  );
}

function isFileIdentity(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,32}$/u.test(value);
}

function parseRecoveryRecord(
  source: string,
  expectedRegistryId: string
): HwpxRecoveryRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }
  const expectedKeys = [
    "claimPath",
    "createdAtUnixMs",
    "directoryDevice",
    "directoryInode",
    "directoryName",
    "directoryPath",
    "ownerPid",
    "ownershipToken",
    "registryId",
    "schemaVersion"
  ];
  if (Object.keys(value).sort().join("\n") !== expectedKeys.join("\n")) {
    return null;
  }
  if (
    value.schemaVersion !== RECOVERY_SCHEMA_VERSION ||
    typeof value.registryId !== "string" ||
    value.registryId.toLocaleLowerCase() !==
      expectedRegistryId.toLocaleLowerCase() ||
    typeof value.ownershipToken !== "string" ||
    !TOKEN_PATTERN.test(value.ownershipToken) ||
    !isSafePid(value.ownerPid) ||
    !isManagedDirectoryPath(value.directoryPath) ||
    typeof value.directoryName !== "string" ||
    value.directoryName !== path.basename(value.directoryPath) ||
    !isClaimPath(value.claimPath) ||
    path.dirname(value.claimPath) !== path.dirname(value.directoryPath) ||
    path.basename(value.claimPath) !==
      `.madi-hwpx-recovery-claim-${value.registryId}` ||
    !isFileIdentity(value.directoryDevice) ||
    !isFileIdentity(value.directoryInode) ||
    !Number.isSafeInteger(value.createdAtUnixMs) ||
    (value.createdAtUnixMs as number) < 0
  ) {
    return null;
  }
  return {
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    registryId: value.registryId,
    ownershipToken: value.ownershipToken,
    ownerPid: value.ownerPid,
    directoryPath: value.directoryPath,
    directoryName: value.directoryName,
    claimPath: value.claimPath,
    directoryDevice: value.directoryDevice,
    directoryInode: value.directoryInode,
    createdAtUnixMs: value.createdAtUnixMs as number
  };
}

function recoveryRecordsMatch(
  registry: HwpxRecoveryRecord,
  marker: HwpxRecoveryRecord
): boolean {
  return (
    registry.schemaVersion === marker.schemaVersion &&
    registry.registryId === marker.registryId &&
    registry.ownershipToken === marker.ownershipToken &&
    registry.ownerPid === marker.ownerPid &&
    registry.directoryPath === marker.directoryPath &&
    registry.directoryName === marker.directoryName &&
    registry.claimPath === marker.claimPath &&
    registry.directoryDevice === marker.directoryDevice &&
    registry.directoryInode === marker.directoryInode &&
    registry.createdAtUnixMs === marker.createdAtUnixMs
  );
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function readBoundedRegularFile(filePath: string): Promise<string | null> {
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
    pathIdentity.size < 1 ||
    pathIdentity.size > MAX_RECOVERY_RECORD_BYTES
  ) {
    return null;
  }
  const handle = await open(filePath, "r");
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.size < 1 ||
      before.size > MAX_RECOVERY_RECORD_BYTES ||
      before.dev !== pathIdentity.dev ||
      before.ino !== pathIdentity.ino
    ) {
      return null;
    }
    const bytes = Buffer.allocUnsafe(MAX_RECOVERY_RECORD_BYTES + 1);
    let byteLength = 0;
    while (byteLength < bytes.byteLength) {
      const result = await handle.read(
        bytes,
        byteLength,
        bytes.byteLength - byteLength,
        byteLength
      );
      if (result.bytesRead === 0) {
        break;
      }
      byteLength += result.bytesRead;
    }
    const [after, finalPathIdentity] = await Promise.all([
      handle.stat(),
      lstat(filePath)
    ]);
    if (
      byteLength < 1 ||
      byteLength > MAX_RECOVERY_RECORD_BYTES ||
      byteLength !== after.size ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      after.dev !== finalPathIdentity.dev ||
      after.ino !== finalPathIdentity.ino ||
      !finalPathIdentity.isFile() ||
      finalPathIdentity.isSymbolicLink()
    ) {
      return null;
    }
    return bytes.subarray(0, byteLength).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function writeExclusiveSynced(
  filePath: string,
  source: string
): Promise<void> {
  if (Buffer.byteLength(source, "utf8") > MAX_RECOVERY_RECORD_BYTES) {
    throw new Error("The HWPX recovery record exceeds the size limit");
  }
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(source, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function unlinkIfPresent(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

async function unlinkRegistryFileIfRegular(filePath: string): Promise<void> {
  let identity;
  try {
    identity = await lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (!identity.isFile() || identity.isSymbolicLink()) {
    return;
  }
  await unlinkIfPresent(filePath);
}

export class FileHwpxCrashRecoveryRegistry
  implements HwpxCrashRecoveryPort
{
  private readonly registryRoot: string;
  private readonly ownerPid: number;
  private readonly isProcessAlive: (pid: number) => boolean;
  private readonly currentRegistrations = new Map<string, string>();
  private readonly currentRecords = new Map<string, HwpxRecoveryRecord>();
  private readonly atomicOutput: AtomicOutputPort | undefined;
  private initialization: Promise<void> | null = null;

  public constructor(
    registryRoot: string,
    options: FileHwpxCrashRecoveryRegistryOptions = {}
  ) {
    const resolvedRoot = path.resolve(registryRoot);
    if (
      resolvedRoot.length < 1 ||
      resolvedRoot.length > MAX_RECOVERY_PATH_LENGTH
    ) {
      throw new Error("The HWPX recovery registry path is invalid");
    }
    const ownerPid = options.ownerPid ?? process.pid;
    if (!isSafePid(ownerPid)) {
      throw new Error("The HWPX recovery owner process is invalid");
    }
    this.registryRoot = resolvedRoot;
    this.ownerPid = ownerPid;
    this.isProcessAlive = options.isProcessAlive ?? processIsAlive;
    this.atomicOutput = options.atomicOutput;
  }

  public initialize(): Promise<void> {
    if (this.initialization) {
      return this.initialization;
    }
    const attempt = this.initializeOnce();
    this.initialization = attempt;
    void attempt.catch(() => {
      if (this.initialization === attempt) {
        this.initialization = null;
      }
    });
    return attempt;
  }

  private async initializeOnce(): Promise<void> {
    await mkdir(this.registryRoot, { recursive: true, mode: 0o700 });
    const rootIdentity = await lstat(this.registryRoot);
    if (!rootIdentity.isDirectory() || rootIdentity.isSymbolicLink()) {
      throw new Error("The HWPX recovery registry is not a regular directory");
    }
    const entries = await readdir(this.registryRoot, { withFileTypes: true });
    const candidates = entries
      .filter(
        (entry) => entry.isFile() && REGISTRY_FILE_PATTERN.test(entry.name)
      )
      .sort((left, right) => left.name.localeCompare(right.name));
    if (candidates.length > MAX_RECOVERY_ENTRIES) {
      throw new Error("The HWPX recovery registry exceeds the scan bound");
    }
    for (const candidate of candidates) {
      await this.recoverRegistryFile(candidate.name, false);
    }
  }

  private async inspectRecoveryCandidate(
    record: HwpxRecoveryRecord,
    candidatePath: string,
    requireMarker: boolean
  ): Promise<RecoveryCandidate> {
    let directoryIdentity;
    try {
      directoryIdentity = await lstat(candidatePath, { bigint: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { status: "MISSING" };
      }
      throw error;
    }
    if (
      !directoryIdentity.isDirectory() ||
      directoryIdentity.isSymbolicLink() ||
      directoryIdentity.dev.toString() !== record.directoryDevice ||
      directoryIdentity.ino.toString() !== record.directoryInode
    ) {
      return { status: "UNTRUSTED" };
    }
    const markerSource = await readBoundedRegularFile(
      path.join(candidatePath, OWNERSHIP_MARKER_NAME)
    );
    if (markerSource) {
      const marker = parseRecoveryRecord(markerSource, record.registryId);
      if (!marker || !recoveryRecordsMatch(record, marker)) {
        return { status: "UNTRUSTED" };
      }
    } else if (requireMarker) {
      return { status: "UNTRUSTED" };
    }
    const finalIdentity = await lstat(candidatePath, { bigint: true });
    if (
      !finalIdentity.isDirectory() ||
      finalIdentity.isSymbolicLink() ||
      finalIdentity.dev !== directoryIdentity.dev ||
      finalIdentity.ino !== directoryIdentity.ino
    ) {
      return { status: "UNTRUSTED" };
    }
    return {
      status: "MATCH",
      device: finalIdentity.dev.toString(),
      inode: finalIdentity.ino.toString()
    };
  }

  private async recoverRegistryFile(
    fileName: string,
    ignoreLiveOwner: boolean
  ): Promise<RecoveryOutcome> {
    const match = REGISTRY_FILE_PATTERN.exec(fileName);
    if (!match) {
      return "UNTRUSTED";
    }
    const registryPath = path.join(this.registryRoot, fileName);
    const registrySource = await readBoundedRegularFile(registryPath);
    const registry = registrySource
      ? parseRecoveryRecord(registrySource, match[1]!)
      : null;
    if (!registry) {
      await unlinkRegistryFileIfRegular(registryPath);
      return "UNTRUSTED";
    }
    if (!ignoreLiveOwner && this.isProcessAlive(registry.ownerPid)) {
      return "LIVE";
    }
    const [original, claimed] = await Promise.all([
      this.inspectRecoveryCandidate(registry, registry.directoryPath, true),
      this.inspectRecoveryCandidate(registry, registry.claimPath, false)
    ]);
    if (claimed.status === "UNTRUSTED") {
      return "UNTRUSTED";
    }
    if (claimed.status === "MISSING" && original.status === "UNTRUSTED") {
      await unlinkRegistryFileIfRegular(registryPath);
      return "UNTRUSTED";
    }
    if (claimed.status === "MISSING" && original.status === "MISSING") {
      await unlinkIfPresent(registryPath);
      return "CLEANED";
    }
    if (claimed.status === "MISSING") {
      try {
        await rename(registry.directoryPath, registry.claimPath);
      } catch (error) {
        if (
          ["EEXIST", "ENOTEMPTY", "EPERM"].includes(
            (error as NodeJS.ErrnoException).code ?? ""
          )
        ) {
          return "UNTRUSTED";
        }
        throw error;
      }
    }
    const finalClaim = await this.inspectRecoveryCandidate(
      registry,
      registry.claimPath,
      false
    );
    if (finalClaim.status !== "MATCH") {
      return "UNTRUSTED";
    }
    if (await atomicOutputJournalExists(registry.claimPath)) {
      const reconciliation = await reconcileAtomicOutputJournal(
        registry.claimPath,
        registry,
        this.atomicOutput
      );
      if (
        reconciliation.status === "RECOVERY_REQUIRED" ||
        reconciliation.status === "NO_INTENT"
      ) {
        return "PRESERVED";
      }
    }
    await rm(registry.claimPath, {
      recursive: true,
      force: false,
      maxRetries: 3,
      retryDelay: 100
    });
    await unlinkIfPresent(registryPath);
    return "CLEANED";
  }

  public async register(directoryPath: string): Promise<void> {
    await this.initialize();
    const resolvedDirectory = path.resolve(directoryPath);
    if (!isManagedDirectoryPath(resolvedDirectory)) {
      throw new Error("The HWPX recovery directory path is invalid");
    }
    if (this.currentRegistrations.has(resolvedDirectory)) {
      throw new Error("The HWPX recovery directory is already registered");
    }
    const directoryIdentity = await lstat(resolvedDirectory, { bigint: true });
    if (!directoryIdentity.isDirectory() || directoryIdentity.isSymbolicLink()) {
      throw new Error("The HWPX recovery target is not a regular directory");
    }
    const registryId = randomUUID();
    const record: HwpxRecoveryRecord = {
      schemaVersion: RECOVERY_SCHEMA_VERSION,
      registryId,
      ownershipToken: randomBytes(32).toString("hex"),
      ownerPid: this.ownerPid,
      directoryPath: resolvedDirectory,
      directoryName: path.basename(resolvedDirectory),
      claimPath: path.join(
        path.dirname(resolvedDirectory),
        `.madi-hwpx-recovery-claim-${registryId}`
      ),
      directoryDevice: directoryIdentity.dev.toString(),
      directoryInode: directoryIdentity.ino.toString(),
      createdAtUnixMs: Date.now()
    };
    try {
      await lstat(record.claimPath);
      throw new Error("The HWPX recovery claim path already exists");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    const source = `${JSON.stringify(record)}\n`;
    const markerPath = path.join(resolvedDirectory, OWNERSHIP_MARKER_NAME);
    const registryPath = path.join(
      this.registryRoot,
      `${record.registryId}.json`
    );
    let markerWritten = false;
    let registryWritten = false;
    try {
      await writeExclusiveSynced(markerPath, source);
      markerWritten = true;
      const finalDirectoryIdentity = await lstat(resolvedDirectory, {
        bigint: true
      });
      if (
        !finalDirectoryIdentity.isDirectory() ||
        finalDirectoryIdentity.isSymbolicLink() ||
        finalDirectoryIdentity.dev !== directoryIdentity.dev ||
        finalDirectoryIdentity.ino !== directoryIdentity.ino
      ) {
        throw new Error("The HWPX recovery target changed during registration");
      }
      await writeExclusiveSynced(registryPath, source);
      registryWritten = true;
      this.currentRegistrations.set(resolvedDirectory, registryPath);
      this.currentRecords.set(resolvedDirectory, record);
    } catch (error) {
      if (registryWritten) {
        await unlinkIfPresent(registryPath);
      }
      if (markerWritten) {
        await unlinkIfPresent(markerPath);
      }
      throw error;
    }
  }

  private requireCurrentRecord(directoryPath: string): HwpxRecoveryRecord {
    const resolvedDirectory = path.resolve(directoryPath);
    const record = this.currentRecords.get(resolvedDirectory);
    if (!record) {
      throw new Error("The HWPX recovery directory is not registered by this process");
    }
    return record;
  }

  public async prepareAtomicOutput(
    directoryPath: string,
    preparation: AtomicOutputJournalPreparation
  ): Promise<void> {
    const record = this.requireCurrentRecord(directoryPath);
    await prepareAtomicOutputJournal(record.directoryPath, record, preparation);
  }

  public async markAtomicOutputTerminal(
    directoryPath: string,
    outcome: "COMMITTED" | "ABORTED_SAFE"
  ): Promise<void> {
    const record = this.requireCurrentRecord(directoryPath);
    await writeAtomicOutputTerminal(record.directoryPath, record, outcome);
  }

  public async reconcileAtomicOutput(
    directoryPath: string
  ): Promise<AtomicOutputJournalReconcileResult> {
    const record = this.requireCurrentRecord(directoryPath);
    if (!this.atomicOutput) {
      return { status: "RECOVERY_REQUIRED", recoveryFileName: null };
    }
    return reconcileAtomicOutputJournal(
      record.directoryPath,
      record,
      this.atomicOutput
    );
  }

  public async remove(directoryPath: string): Promise<void> {
    const resolvedDirectory = path.resolve(directoryPath);
    const registryPath = this.currentRegistrations.get(resolvedDirectory);
    if (!registryPath) {
      return;
    }
    const outcome = await this.recoverRegistryFile(
      path.basename(registryPath),
      true
    );
    if (outcome !== "CLEANED") {
      throw new Error("The authenticated HWPX recovery directory was not removed");
    }
    this.currentRegistrations.delete(resolvedDirectory);
    this.currentRecords.delete(resolvedDirectory);
  }
}
