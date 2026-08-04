import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  EpubExportProgress,
  EpubExportPresetConfig,
  EpubTargetProfile,
  PublicationExportMetadata
} from "../shared/epubExport";
import type { PublicationDocument } from "../shared/publication";
import { validateEpubExportProgress } from "../shared/epubExportValidation";

const MAX_STDOUT_BYTES = 32 * 1024 * 1024;
const MAX_STDOUT_LINE_BYTES = 16 * 1024 * 1024;
const EXPORT_TIMEOUT_MS = 10 * 60_000;
const PROCESS_CLOSE_TIMEOUT_MS = 15_000;
const PROCESS_FORCE_CLOSE_TIMEOUT_MS = 5_000;

async function removeOperationTemporaryFile(filePath: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await unlink(filePath);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      if (attempt === 2) {
        throw new Error("The EPUB utility temporary file could not be removed");
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }
}

export interface ResolveEpubExporterBinaryOptions {
  readonly appPath: string;
  readonly resourcesPath: string;
  readonly isPackaged: boolean;
  readonly platform?: NodeJS.Platform;
  readonly environment?: NodeJS.ProcessEnv;
}

export interface EpubExporterCoverInput {
  readonly mediaType: "image/png" | "image/jpeg";
  readonly originalName: string;
  readonly bytesBase64: string;
}

export interface EpubExporterRunInput {
  readonly operationId: string;
  readonly mode: "EXPORT" | "VALIDATE_ONLY";
  readonly document: PublicationDocument;
  readonly sourcePublicationHash: string;
  readonly metadata: PublicationExportMetadata;
  readonly config: EpubExportPresetConfig;
  readonly outputPath: string;
  readonly replaceExisting: boolean;
  readonly cover: EpubExporterCoverInput | null;
}

export interface EpubUtilityValidationMessage {
  readonly code: string;
  readonly severity: "FATAL" | "ERROR" | "WARNING" | "INFO";
  readonly description: string;
  readonly sourceNodeId: string | null;
  readonly epubPath: string | null;
  readonly suggestion: string | null;
}

export interface EpubUtilityResult {
  readonly mode: "EXPORT" | "VALIDATE_ONLY";
  readonly outputPath: string | null;
  readonly summary: {
    readonly byteLength: number;
    readonly sha256: string;
    readonly logicalPackageHash: string;
    readonly targetProfile: EpubTargetProfile;
    readonly sourcePublicationHash: string;
    readonly validationReport: {
      readonly status: "PASS" | "FAIL";
      readonly fatalCount: number;
      readonly errorCount: number;
      readonly warningCount: number;
      readonly infoCount: number;
      readonly messages: readonly EpubUtilityValidationMessage[];
    };
    readonly exportTiming: {
      readonly contentSplitMs: number;
      readonly xhtmlGenerationMs: number;
      readonly packageDocumentsMs: number;
      readonly zipPackagingMs: number;
      readonly internalValidationMs: number;
      readonly totalMs: number;
    };
    readonly statistics: {
      readonly fileCount: number;
      readonly xhtmlCount: number;
      readonly sourceSectionCount: number;
      readonly exportedSectionCount: number;
      readonly sourceBlockCount: number;
      readonly exportedBlockCount: number;
      readonly fallbackBlockCount: number;
      readonly rejectedBlockCount: number;
      readonly sourceCharacterCount: number;
      readonly exportedCharacterCount: number;
      readonly sceneBreakCount: number;
      readonly rubyCount: number;
      readonly headingCount: number;
      readonly coverIncluded: boolean;
    };
  };
}

export interface EpubExporterPort {
  run(
    input: EpubExporterRunInput,
    onProgress: (progress: EpubExportProgress) => void
  ): Promise<EpubUtilityResult>;
  cancel(operationId: string): Promise<boolean>;
  dispose(): Promise<void>;
}

export class EpubUtilityValidationError extends Error {
  public constructor(
    public readonly report: EpubUtilityResult["summary"]["validationReport"]
  ) {
    super("The EPUB utility found an invalid package");
    this.name = "EpubUtilityValidationError";
  }
}

export class EpubExportCancelledError extends Error {
  public constructor() {
    super("The EPUB export was cancelled");
    this.name = "EpubExportCancelledError";
  }
}

interface ActiveProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly reject: (error: Error) => void;
  readonly timeout: NodeJS.Timeout;
  readonly closed: Promise<void>;
  readonly resolveClosed: () => void;
  forceKillTimeout: NodeJS.Timeout | null;
  cancelled: boolean;
  closedFlag: boolean;
  terminalError: Error | null;
  cleanupError: Error | null;
  temporaryCleanupEligible: boolean;
}

export function resolveEpubExporterBinary({
  appPath,
  resourcesPath,
  isPackaged,
  platform = process.platform,
  environment = process.env
}: ResolveEpubExporterBinaryOptions): string {
  const executable = platform === "win32" ? "madi-export-epub.exe" : "madi-export-epub";
  const packaged = path.join(resourcesPath, "bin", executable);
  if (isPackaged) {
    return packaged;
  }
  const override = environment.MADI_EPUB_EXPORT_BIN?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.resolve(
    appPath,
    "..",
    "..",
    "crates",
    "madi-export-epub",
    "target",
    "debug",
    executable
  );
}

function options(config: EpubExportPresetConfig): Record<string, unknown> {
  return {
    targetProfile: config.targetProfile,
    splitMode: config.splitMode,
    includeCover: config.includeCover,
    includeSceneTitles: config.includeSceneTitles,
    includeChapterTitles: config.includeChapterTitles,
    tocDepth: config.tocDepth,
    sceneBreakStyleToken: config.sceneBreakStyleToken,
    bodyStyleToken: config.bodyStyleToken,
    stylesheetToken: config.stylesheetToken
  };
}

function utilityInput(input: EpubExporterRunInput): Record<string, unknown> {
  return {
    operationId: input.operationId,
    mode: input.mode,
    document: input.document,
    request: {
      projectId: input.document.projectId,
      scopeNodeId: input.document.scopeNodeId,
      expectedProjectRevision: input.document.projectRevision,
      sourcePublicationHash: input.sourcePublicationHash,
      metadata: {
        title: input.metadata.publicationTitle,
        creatorName: input.metadata.creatorName,
        language: input.metadata.language,
        identifier: input.metadata.identifier,
        publisher: input.metadata.publisher,
        description: input.metadata.description,
        rights: input.metadata.rights,
        subjects: input.metadata.subjects
      },
      options: options(input.config),
      outputPath: input.outputPath,
      replaceExisting: input.replaceExisting,
      cover: input.cover
    }
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The EPUB utility returned an invalid message");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`The EPUB utility returned invalid ${label}`);
  }
}

function safeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`The EPUB utility returned invalid ${label}`);
  }
  return value as number;
}

function safeString(value: unknown, label: string, maximum = 20_000): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    throw new Error(`The EPUB utility returned invalid ${label}`);
  }
  return value;
}

function safeNullableString(
  value: unknown,
  label: string,
  maximum = 20_000
): string | null {
  return value === null ? null : safeString(value, label, maximum);
}

function safeHash(value: unknown, label: string): string {
  const hash = safeString(value, label, 64);
  if (!/^[0-9a-f]{64}$/u.test(hash)) {
    throw new Error(`The EPUB utility returned invalid ${label}`);
  }
  return hash;
}

function safeNullableEpubPath(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  const epubPath = safeString(value, "validation EPUB path", 1_000);
  if (
    epubPath.includes("\\") ||
    epubPath.startsWith("/") ||
    /^[a-z]:/iu.test(epubPath) ||
    /[\u0000-\u001f\u007f]/u.test(epubPath)
  ) {
    throw new Error("The EPUB utility returned an unsafe validation path");
  }
  const parts = epubPath.split("/");
  if (
    parts.some(
      (part) => part.length === 0 || part === "." || part === ".."
    )
  ) {
    throw new Error("The EPUB utility returned an unsafe validation path");
  }
  return epubPath;
}

function publicProfile(value: unknown): EpubTargetProfile {
  if (
    value === "EPUB_3_4_DRAFT_2026_08" ||
    value === "EPUB_3_3_COMPATIBILITY"
  ) {
    return value;
  }
  throw new Error("The EPUB utility returned an invalid profile");
}

function parseValidationReport(value: unknown): EpubUtilityResult["summary"]["validationReport"] {
  const report = asObject(value);
  exactKeys(
    report,
    ["status", "fatalCount", "errorCount", "warningCount", "infoCount", "messages"],
    "validation report"
  );
  if (report.status !== "PASS" && report.status !== "FAIL") {
    throw new Error("The EPUB utility returned invalid validation status");
  }
  if (!Array.isArray(report.messages) || report.messages.length > 100_000) {
    throw new Error("The EPUB utility returned invalid validation messages");
  }
  const messages = report.messages.map((value) => {
    const message = asObject(value);
    exactKeys(
      message,
      ["code", "severity", "description", "sourceNodeId", "epubPath", "suggestion"],
      "validation message"
    );
    if (
      message.severity !== "FATAL" &&
      message.severity !== "ERROR" &&
      message.severity !== "WARNING" &&
      message.severity !== "INFO"
    ) {
      throw new Error("The EPUB utility returned invalid validation severity");
    }
    const severity = message.severity as EpubUtilityValidationMessage["severity"];
    const code = safeString(message.code, "validation code", 128);
    if (!/^[A-Z][A-Z0-9_]{2,127}$/u.test(code)) {
      throw new Error("The EPUB utility returned an invalid validation code");
    }
    return {
      code,
      severity,
      description: safeString(message.description, "validation description", 2_000),
      sourceNodeId: safeNullableString(message.sourceNodeId, "validation source node", 256),
      epubPath: safeNullableEpubPath(message.epubPath),
      suggestion: safeNullableString(message.suggestion, "validation suggestion", 2_000)
    };
  });
  const fatalCount = safeInteger(report.fatalCount, "fatal count");
  const errorCount = safeInteger(report.errorCount, "error count");
  const warningCount = safeInteger(report.warningCount, "warning count");
  const infoCount = safeInteger(report.infoCount, "info count");
  const observed: Record<EpubUtilityValidationMessage["severity"], number> = {
    FATAL: 0,
    ERROR: 0,
    WARNING: 0,
    INFO: 0
  };
  for (const message of messages) {
    observed[message.severity] += 1;
  }
  if (
    observed.FATAL !== fatalCount ||
    observed.ERROR !== errorCount ||
    observed.WARNING !== warningCount ||
    observed.INFO !== infoCount ||
    (report.status === "PASS" ? fatalCount + errorCount !== 0 : fatalCount + errorCount === 0)
  ) {
    throw new Error("The EPUB utility returned inconsistent validation counts");
  }
  return {
    status: report.status,
    fatalCount,
    errorCount,
    warningCount,
    infoCount,
    messages
  };
}

function parseUtilityResult(
  message: Readonly<Record<string, unknown>>,
  expected: EpubExporterRunInput
): EpubUtilityResult {
  exactKeys(message, ["kind", "mode", "outputPath", "summary"], "result");
  if (message.mode !== expected.mode) {
    throw new Error("The EPUB utility returned another operation mode");
  }
  const outputPath = safeNullableString(message.outputPath, "output path", 32_000);
  if (
    (expected.mode === "EXPORT" && path.resolve(outputPath ?? "") !== path.resolve(expected.outputPath)) ||
    (expected.mode === "VALIDATE_ONLY" && outputPath !== null)
  ) {
    throw new Error("The EPUB utility returned another output path");
  }
  const summary = asObject(message.summary);
  exactKeys(
    summary,
    [
      "byteLength",
      "sha256",
      "logicalPackageHash",
      "targetProfile",
      "sourcePublicationHash",
      "validationReport",
      "exportTiming",
      "statistics"
    ],
    "summary"
  );
  const timing = asObject(summary.exportTiming);
  exactKeys(
    timing,
    [
      "contentSplitMs",
      "xhtmlGenerationMs",
      "packageDocumentsMs",
      "zipPackagingMs",
      "internalValidationMs",
      "totalMs"
    ],
    "export timing"
  );
  const statistics = asObject(summary.statistics);
  exactKeys(
    statistics,
    [
      "fileCount",
      "xhtmlCount",
      "sourceSectionCount",
      "exportedSectionCount",
      "sourceBlockCount",
      "exportedBlockCount",
      "fallbackBlockCount",
      "rejectedBlockCount",
      "sourceCharacterCount",
      "exportedCharacterCount",
      "sceneBreakCount",
      "rubyCount",
      "headingCount",
      "coverIncluded"
    ],
    "package statistics"
  );
  if (typeof statistics.coverIncluded !== "boolean") {
    throw new Error("The EPUB utility returned invalid cover statistics");
  }
  const result: EpubUtilityResult = {
    mode: expected.mode,
    outputPath,
    summary: {
      byteLength: safeInteger(summary.byteLength, "EPUB byte length"),
      sha256: safeHash(summary.sha256, "EPUB hash"),
      logicalPackageHash: safeHash(summary.logicalPackageHash, "logical package hash"),
      targetProfile: publicProfile(summary.targetProfile),
      sourcePublicationHash: safeHash(summary.sourcePublicationHash, "source publication hash"),
      validationReport: parseValidationReport(summary.validationReport),
      exportTiming: {
        contentSplitMs: safeInteger(timing.contentSplitMs, "content split timing"),
        xhtmlGenerationMs: safeInteger(timing.xhtmlGenerationMs, "XHTML timing"),
        packageDocumentsMs: safeInteger(timing.packageDocumentsMs, "package documents timing"),
        zipPackagingMs: safeInteger(timing.zipPackagingMs, "ZIP timing"),
        internalValidationMs: safeInteger(timing.internalValidationMs, "validation timing"),
        totalMs: safeInteger(timing.totalMs, "total timing")
      },
      statistics: {
        fileCount: safeInteger(statistics.fileCount, "file count"),
        xhtmlCount: safeInteger(statistics.xhtmlCount, "XHTML count"),
        sourceSectionCount: safeInteger(statistics.sourceSectionCount, "source section count"),
        exportedSectionCount: safeInteger(statistics.exportedSectionCount, "exported section count"),
        sourceBlockCount: safeInteger(statistics.sourceBlockCount, "source block count"),
        exportedBlockCount: safeInteger(statistics.exportedBlockCount, "exported block count"),
        fallbackBlockCount: safeInteger(statistics.fallbackBlockCount, "fallback block count"),
        rejectedBlockCount: safeInteger(statistics.rejectedBlockCount, "rejected block count"),
        sourceCharacterCount: safeInteger(statistics.sourceCharacterCount, "source character count"),
        exportedCharacterCount: safeInteger(statistics.exportedCharacterCount, "exported character count"),
        sceneBreakCount: safeInteger(statistics.sceneBreakCount, "scene break count"),
        rubyCount: safeInteger(statistics.rubyCount, "ruby count"),
        headingCount: safeInteger(statistics.headingCount, "heading count"),
        coverIncluded: statistics.coverIncluded
      }
    }
  };
  if (
    result.summary.sourcePublicationHash !== expected.sourcePublicationHash ||
    result.summary.targetProfile !== expected.config.targetProfile
  ) {
    throw new Error("The EPUB utility returned a mismatched summary");
  }
  return result;
}

function mapProgressStage(value: unknown): EpubExportProgress["stage"] {
  switch (value) {
    case "PUBLICATION_IR":
      return "XHTML_GENERATION";
    case "CONTENT_SPLIT":
    case "XHTML_GENERATION":
      return "XHTML_GENERATION";
    case "PACKAGE_DOCUMENTS":
    case "ZIP_PACKAGING":
      return "PACKAGE_GENERATION";
    case "INTERNAL_VALIDATION":
      return "INTERNAL_VALIDATION";
    case "WRITE_OUTPUT":
    case "COMPLETE":
      return "FINALIZE";
    default:
      throw new Error("The EPUB utility returned an invalid progress stage");
  }
}

function safeProgressNumber(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("The EPUB utility returned invalid progress");
  }
  return value as number;
}

export class ProcessEpubExporter implements EpubExporterPort {
  private readonly active = new Map<string, ActiveProcess>();
  private readonly ownedTemporaryPaths = new Set<string>();
  private disposed = false;

  public constructor(private readonly binaryPath: string) {}

  private requestTermination(active: ActiveProcess, error: Error): void {
    if (active.closedFlag) {
      return;
    }
    active.terminalError ??= error;
    clearTimeout(active.timeout);
    active.child.kill();
    if (active.forceKillTimeout === null) {
      active.forceKillTimeout = setTimeout(() => {
        if (!active.closedFlag) {
          active.child.kill("SIGKILL");
        }
      }, PROCESS_CLOSE_TIMEOUT_MS);
    }
  }

  private async waitForClosed(active: ActiveProcess): Promise<void> {
    const wait = async (timeoutMs: number): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("The EPUB utility did not stop")),
          timeoutMs
        );
        void active.closed.then(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
    try {
      await wait(PROCESS_CLOSE_TIMEOUT_MS);
    } catch {
      active.child.kill("SIGKILL");
      await wait(PROCESS_FORCE_CLOSE_TIMEOUT_MS);
    }
    if (active.cleanupError) {
      throw active.cleanupError;
    }
  }

  public run(
    input: EpubExporterRunInput,
    onProgress: (progress: EpubExportProgress) => void
  ): Promise<EpubUtilityResult> {
    if (this.disposed) {
      return Promise.reject(new Error("The EPUB utility is not available"));
    }
    if (this.active.has(input.operationId)) {
      return Promise.reject(new Error("The EPUB operation is already running"));
    }
    const temporaryPath =
      input.mode === "EXPORT"
        ? path.join(
            path.dirname(input.outputPath),
            `.madi-epub-${input.operationId}.tmp`
          )
        : null;
    if (temporaryPath && existsSync(temporaryPath)) {
      return Promise.reject(
        new Error("The EPUB utility temporary path is already occupied")
      );
    }
    const child = spawn(this.binaryPath, [], {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    return new Promise<EpubUtilityResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const active = this.active.get(input.operationId);
        if (!active || active.closedFlag) {
          return;
        }
        this.requestTermination(active, new Error("The EPUB utility timed out"));
      }, EXPORT_TIMEOUT_MS);
      let resolveClosed!: () => void;
      const closed = new Promise<void>((resolve) => {
        resolveClosed = resolve;
      });
      const active: ActiveProcess = {
        child,
        reject,
        timeout,
        closed,
        resolveClosed,
        forceKillTimeout: null,
        cancelled: false,
        closedFlag: false,
        terminalError: null,
        cleanupError: null,
        temporaryCleanupEligible: false
      };
      this.active.set(input.operationId, active);
      let stdout = Buffer.alloc(0);
      let totalStdoutBytes = 0;
      let result: EpubUtilityResult | null = null;
      const fail = (error: Error): void => {
        this.requestTermination(active, error);
      };

      const parseLineUnsafe = (line: Buffer): void => {
        if (line.byteLength === 0) {
          return;
        }
        if (line.byteLength > MAX_STDOUT_LINE_BYTES) {
          fail(new Error("The EPUB utility returned an oversized message"));
          return;
        }
        let message: Record<string, unknown>;
        try {
          message = asObject(JSON.parse(line.toString("utf8")) as unknown);
        } catch {
          fail(new Error("The EPUB utility returned malformed JSON"));
          return;
        }
        if (message.kind === "PROGRESS") {
          exactKeys(
            message,
            ["kind", "stage", "completed", "total"],
            "progress"
          );
          const completed = safeProgressNumber(message.completed);
          const total = safeProgressNumber(message.total);
          if (total < 1 || completed > total) {
            fail(new Error("The EPUB utility returned invalid progress"));
            return;
          }
          if (message.stage === "WRITE_OUTPUT") {
            active.temporaryCleanupEligible = true;
            if (temporaryPath) {
              this.ownedTemporaryPaths.add(temporaryPath);
            }
          }
          onProgress(validateEpubExportProgress({
            operationId: input.operationId,
            stage: mapProgressStage(message.stage),
            completed,
            total
          }));
          return;
        }
        if (message.kind === "RESULT") {
          if (result) {
            fail(new Error("The EPUB utility returned duplicate results"));
            return;
          }
          result = parseUtilityResult(message, input);
          return;
        }
        if (message.kind === "ERROR") {
          exactKeys(
            message,
            ["kind", "code", "description", "validationReport"],
            "error"
          );
          const code = safeString(message.code, "error code", 128);
          safeString(message.description, "error description", 2_000);
          if (code === "VALIDATION_FAILED" && message.validationReport !== null) {
            fail(
              new EpubUtilityValidationError(
                parseValidationReport(message.validationReport)
              )
            );
            return;
          }
          if (message.validationReport !== null) {
            fail(new Error("The EPUB utility returned an unexpected report"));
            return;
          }
          fail(new Error("The EPUB utility rejected the export"));
          return;
        }
        fail(new Error("The EPUB utility returned an unsupported message"));
      };

      const parseLine = (line: Buffer): void => {
        try {
          parseLineUnsafe(line);
        } catch {
          fail(new Error("The EPUB utility returned an invalid message"));
        }
      };

      child.stdout.on("data", (chunk: Buffer) => {
        if (active.terminalError) {
          return;
        }
        totalStdoutBytes += chunk.byteLength;
        if (totalStdoutBytes > MAX_STDOUT_BYTES) {
          fail(new Error("The EPUB utility returned too much data"));
          return;
        }
        stdout = Buffer.concat([stdout, chunk]);
        let newline = stdout.indexOf(0x0a);
        while (newline >= 0 && !active.terminalError) {
          const line = stdout.subarray(0, newline);
          stdout = stdout.subarray(newline + 1);
          parseLine(line);
          newline = stdout.indexOf(0x0a);
        }
      });
      child.stderr.on("data", () => {
        // Drain only. Utility errors are typed JSON and manuscript text is never logged.
      });
      child.stdin.on("error", () =>
        fail(new Error("The EPUB utility input stream failed"))
      );
      child.on("error", () => fail(new Error("The EPUB utility could not start")));
      child.on("close", async (code) => {
        try {
          clearTimeout(timeout);
          if (active.forceKillTimeout) {
            clearTimeout(active.forceKillTimeout);
            active.forceKillTimeout = null;
          }
          if (temporaryPath && active.temporaryCleanupEligible) {
            try {
              await removeOperationTemporaryFile(temporaryPath);
              this.ownedTemporaryPaths.delete(temporaryPath);
            } catch {
              this.ownedTemporaryPaths.add(temporaryPath);
              active.cleanupError = new Error(
                "The EPUB utility temporary file could not be removed"
              );
            }
          }
          if (!active.terminalError && stdout.byteLength > 0) {
            parseLine(stdout);
          }
          const terminalError =
            active.terminalError ??
            active.cleanupError ??
            (active.cancelled
              ? new EpubExportCancelledError()
              : code !== 0 || !result
                ? new Error("The EPUB utility did not complete")
                : null);
          if (terminalError) {
            reject(terminalError);
          } else {
            resolve(result!);
          }
        } catch (error) {
          reject(error as Error);
        } finally {
          active.closedFlag = true;
          if (this.active.get(input.operationId) === active) {
            this.active.delete(input.operationId);
          }
          active.resolveClosed();
        }
      });
      child.stdin.end(`${JSON.stringify(utilityInput(input))}\n`, "utf8");
    });
  }

  public async cancel(operationId: string): Promise<boolean> {
    const active = this.active.get(operationId);
    if (!active || active.closedFlag) {
      return false;
    }
    active.cancelled = true;
    this.requestTermination(active, new EpubExportCancelledError());
    await this.waitForClosed(active);
    return true;
  }

  public async dispose(): Promise<void> {
    if (
      this.disposed &&
      this.active.size === 0 &&
      this.ownedTemporaryPaths.size === 0
    ) {
      return;
    }
    this.disposed = true;
    await Promise.allSettled(
      [...this.active.entries()].map(async ([operationId, active]) => {
        if (!active.terminalError) {
          active.cancelled = true;
          this.requestTermination(
            active,
            new Error("The EPUB utility was disposed")
          );
        } else {
          active.child.kill("SIGKILL");
        }
        await this.waitForClosed(active);
        this.active.delete(operationId);
      })
    );
    const cleanupResults = await Promise.allSettled(
      [...this.ownedTemporaryPaths].map(async (filePath) => {
        await removeOperationTemporaryFile(filePath);
        this.ownedTemporaryPaths.delete(filePath);
      })
    );
    if (
      this.active.size > 0 ||
      this.ownedTemporaryPaths.size > 0 ||
      cleanupResults.some((result) => result.status === "rejected")
    ) {
      throw new Error("The EPUB utility did not shut down cleanly");
    }
  }
}
