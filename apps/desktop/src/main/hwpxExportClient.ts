import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import type {
  HwpxExportPresetConfig,
  HwpxExportProgress,
  HwpxTitlePageInput,
  HwpxValidationSeverity,
  PublicationExportMetadata
} from "../shared/contracts";
import type { PublicationDocument } from "../shared/publication";
import {
  validateHwpxExportProgress,
  validateHwpxOperationId
} from "../shared/hwpxExportValidation";

const MAX_STDOUT_BYTES = 32 * 1024 * 1024;
const MAX_STDOUT_LINE_BYTES = 16 * 1024 * 1024;
const MAX_HWPX_FILE_BYTES = 512 * 1024 * 1024;
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
        throw new Error("The HWPX utility temporary file could not be removed");
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }
}

export interface ResolveHwpxExporterBinaryOptions {
  readonly appPath: string;
  readonly resourcesPath: string;
  readonly isPackaged: boolean;
  readonly platform?: NodeJS.Platform;
  readonly environment?: NodeJS.ProcessEnv;
}

export interface HwpxExporterRunInput {
  readonly operationId: string;
  readonly mode: "EXPORT" | "VALIDATE_ONLY";
  readonly document: PublicationDocument;
  readonly sourcePublicationHash: string;
  readonly presetId: string;
  readonly presetContentHash: string;
  readonly metadata: PublicationExportMetadata;
  readonly titlePage: HwpxTitlePageInput;
  readonly config: HwpxExportPresetConfig;
  readonly outputPath: string;
  readonly replaceExisting: boolean;
}

export interface HwpxUtilityValidationMessage {
  readonly code: string;
  readonly severity: HwpxValidationSeverity;
  readonly description: string;
  readonly sourceNodeId: string | null;
  readonly hwpxPath: string | null;
  readonly suggestion: string | null;
}

export interface HwpxUtilityResult {
  readonly mode: "EXPORT" | "VALIDATE_ONLY";
  readonly outputPath: string | null;
  readonly summary: {
    readonly byteLength: number;
    readonly sha256: string;
    readonly logicalPackageHash: string;
    readonly packageXmlVersion: string;
    readonly sourcePublicationHash: string;
    readonly presetId: string;
    readonly presetContentHash: string;
    readonly fontFamily: string;
    readonly validationReport: {
      readonly status: "PASS" | "FAIL";
      readonly fatalCount: number;
      readonly errorCount: number;
      readonly warningCount: number;
      readonly infoCount: number;
      readonly messages: readonly HwpxUtilityValidationMessage[];
    };
    readonly exportTiming: {
      readonly styleTableMs: number;
      readonly sectionXmlMs: number;
      readonly packageDocumentsMs: number;
      readonly zipPackagingMs: number;
      readonly internalValidationMs: number;
      readonly zipReopenMs: number;
      readonly sourceCoverageMs: number;
      readonly totalMs: number;
    };
    readonly statistics: {
      readonly fileCount: number;
      readonly sectionCount: number;
      readonly exportedSectionCount: number;
      readonly paragraphCount: number;
      readonly runCount: number;
      readonly textCount: number;
      readonly sourceSectionCount: number;
      readonly sourceBlockCount: number;
      readonly exportedBlockCount: number;
      readonly fallbackBlockCount: number;
      readonly configuredOmissionBlockCount: number;
      readonly rejectedBlockCount: number;
      readonly sourceCharacterCount: number;
      readonly exportedCharacterCount: number;
      readonly headingCount: number;
      readonly sceneBreakCount: number;
      readonly rubyCount: number;
      readonly rubyFallbackCount: number;
      readonly strongSegmentCount: number;
      readonly emphasisSegmentCount: number;
      readonly underlineSegmentCount: number;
      readonly strikeSegmentCount: number;
    };
  };
}

export interface HwpxExporterPort {
  run(
    input: HwpxExporterRunInput,
    onProgress: (progress: HwpxExportProgress) => void
  ): Promise<HwpxUtilityResult>;
  cancel(operationId: string): Promise<boolean>;
  dispose(): Promise<void>;
}

export class HwpxUtilityValidationError extends Error {
  public constructor(
    public readonly report: HwpxUtilityResult["summary"]["validationReport"]
  ) {
    super("The HWPX utility found an invalid package");
    this.name = "HwpxUtilityValidationError";
  }
}

export class HwpxExportCancelledError extends Error {
  public constructor() {
    super("The HWPX export was cancelled");
    this.name = "HwpxExportCancelledError";
  }
}

interface ActiveProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly temporaryPath: string | null;
  readonly timeout: NodeJS.Timeout;
  readonly closed: Promise<void>;
  readonly resolveClosed: () => void;
  forceKillTimeout: NodeJS.Timeout | null;
  closeReceived: boolean;
  closedFlag: boolean;
  resultReceived: boolean;
  cancelled: boolean;
  terminalError: Error | null;
  cleanupError: Error | null;
}

export function resolveHwpxExporterBinary({
  appPath,
  resourcesPath,
  isPackaged,
  platform = process.platform,
  environment = process.env
}: ResolveHwpxExporterBinaryOptions): string {
  const executable =
    platform === "win32" ? "madi-export-hwpx.exe" : "madi-export-hwpx";
  if (isPackaged) {
    return path.join(resourcesPath, "bin", executable);
  }
  const override = environment.MADI_HWPX_EXPORT_BIN?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.resolve(
    appPath,
    "..",
    "..",
    "crates",
    "madi-export-hwpx",
    "target",
    "debug",
    executable
  );
}

function hwpunit(value: number): number {
  return Math.round(value * 100);
}

function options(config: HwpxExportPresetConfig): Record<string, unknown> {
  const fixedSpacing = hwpunit(config.lineSpacingValue);
  return {
    page: {
      pageSizeToken: config.pageSizeToken,
      orientation: config.orientation,
      customWidthMm: config.customPageWidth,
      customHeightMm: config.customPageHeight,
      marginTopMm: config.marginTop,
      marginBottomMm: config.marginBottom,
      marginLeftMm: config.marginLeft,
      marginRightMm: config.marginRight,
      headerMarginMm: config.headerMargin,
      footerMarginMm: config.footerMargin,
      gutterMm: config.gutter
    },
    body: {
      fontFamily: config.fontFamilyToken,
      fontSizePt: config.fontSizePt,
      lineSpacing:
        config.lineSpacingMode === "PERCENT"
          ? { mode: "PERCENT", percent: config.lineSpacingValue }
          : { mode: "FIXED", hwpunit: fixedSpacing },
      firstLineIndentHwpunit: hwpunit(config.firstLineIndent),
      paragraphSpacingBeforeHwpunit: hwpunit(
        config.paragraphSpacingBefore
      ),
      paragraphSpacingAfterHwpunit: hwpunit(config.paragraphSpacingAfter),
      textAlign: config.textAlign
    },
    headings: {
      work: headingOptions(config.workTitleStyle),
      volume: headingOptions(config.volumeTitleStyle),
      chapter: headingOptions(config.chapterTitleStyle),
      scene: headingOptions(config.sceneTitleStyle)
    },
    includeTitlePage: config.includeTitlePage,
    includeWorkTitle: config.includeWorkTitle,
    includeVolumeTitles: config.includeVolumeTitles,
    includeChapterTitles: config.includeChapterTitles,
    includeSceneTitles: config.includeSceneTitles,
    chapterStartsOnNewPage: config.chapterTitleStyle.pageBreakBefore,
    sectionSplitMode: config.sectionSplitMode,
    sceneBreakToken: config.sceneBreakToken,
    includePageNumber: config.includePageNumber,
    pageNumberStart: config.pageNumberStart,
    pageNumberPosition: config.pageNumberPosition,
    includeHeader: config.includeHeader,
    headerText: config.headerText,
    includeFooter: config.includeFooter,
    footerText: config.footerText
  };
}

function headingOptions(
  value: HwpxExportPresetConfig["workTitleStyle"]
): Record<string, unknown> {
  return {
    fontFamily: value.fontFamilyToken,
    fontSizePt: value.fontSizePt,
    bold: value.bold,
    alignment: value.alignment,
    spacingBeforeHwpunit: hwpunit(value.spacingBefore),
    spacingAfterHwpunit: hwpunit(value.spacingAfter),
    pageBreakBefore: value.pageBreakBefore
  };
}

function utilityInput(input: HwpxExporterRunInput): Record<string, unknown> {
  return {
    operationId: input.operationId,
    mode: input.mode,
    document: input.document,
    request: {
      projectId: input.document.projectId,
      scopeNodeId: input.document.scopeNodeId,
      expectedProjectRevision: input.document.projectRevision,
      sourcePublicationHash: input.sourcePublicationHash,
      presetId: input.presetId,
      presetContentHash: input.presetContentHash,
      metadata: {
        title: input.metadata.publicationTitle,
        authorName: input.metadata.creatorName,
        subtitle: input.titlePage.subtitle,
        genre: input.titlePage.genre,
        contact: input.titlePage.contact
      },
      options: options(input.config),
      outputPath: input.outputPath,
      replaceExisting: input.replaceExisting
    }
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`The HWPX utility returned invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function exact(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`The HWPX utility returned invalid ${label}`);
  }
}

function integer(
  value: unknown,
  label: string,
  maximum = 1_000_000_000
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > maximum
  ) {
    throw new Error(`The HWPX utility returned invalid ${label}`);
  }
  return value as number;
}

function string(value: unknown, label: string, maximum = 20_000): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    throw new Error(`The HWPX utility returned invalid ${label}`);
  }
  return value;
}

function nullableString(
  value: unknown,
  label: string,
  maximum = 20_000
): string | null {
  return value === null ? null : string(value, label, maximum);
}

function hash(value: unknown, label: string): string {
  const parsed = string(value, label, 64);
  if (!/^[0-9a-f]{64}$/u.test(parsed)) {
    throw new Error(`The HWPX utility returned invalid ${label}`);
  }
  return parsed;
}

function hwpxPath(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  const parsed = string(value, "HWPX path", 1_000);
  if (
    parsed.includes("\\") ||
    parsed.startsWith("/") ||
    /^[a-z]:/iu.test(parsed) ||
    /[\u0000-\u001f\u007f]/u.test(parsed) ||
    parsed.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error("The HWPX utility returned an unsafe package path");
  }
  return parsed;
}

function validation(
  value: unknown
): HwpxUtilityResult["summary"]["validationReport"] {
  const report = object(value, "validation report");
  exact(
    report,
    ["status", "fatalCount", "errorCount", "warningCount", "infoCount", "messages"],
    "validation report"
  );
  if (report.status !== "PASS" && report.status !== "FAIL") {
    throw new Error("The HWPX utility returned invalid validation status");
  }
  if (!Array.isArray(report.messages) || report.messages.length > 1_000) {
    throw new Error("The HWPX utility returned invalid validation messages");
  }
  const messages = report.messages.map((entry) => {
    const message = object(entry, "validation message");
    exact(
      message,
      ["code", "severity", "description", "sourceNodeId", "hwpxPath", "suggestion"],
      "validation message"
    );
    if (
      message.severity !== "FATAL" &&
      message.severity !== "ERROR" &&
      message.severity !== "WARNING" &&
      message.severity !== "INFO"
    ) {
      throw new Error("The HWPX utility returned invalid validation severity");
    }
    const severity = message.severity as HwpxValidationSeverity;
    const code = string(message.code, "validation code", 128);
    if (!/^[A-Z][A-Z0-9_]{2,127}$/u.test(code)) {
      throw new Error("The HWPX utility returned invalid validation code");
    }
    return {
      code,
      severity,
      description: string(message.description, "validation description", 2_000),
      sourceNodeId: nullableString(message.sourceNodeId, "source node", 256),
      hwpxPath: hwpxPath(message.hwpxPath),
      suggestion: nullableString(message.suggestion, "suggestion", 2_000)
    };
  });
  const fatalCount = integer(report.fatalCount, "fatal count");
  const errorCount = integer(report.errorCount, "error count");
  const warningCount = integer(report.warningCount, "warning count");
  const infoCount = integer(report.infoCount, "info count");
  const observed = { FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0 };
  for (const message of messages) {
    observed[message.severity] += 1;
  }
  if (
    observed.FATAL !== fatalCount ||
    observed.ERROR !== errorCount ||
    observed.WARNING !== warningCount ||
    observed.INFO !== infoCount ||
    (report.status === "PASS"
      ? fatalCount + errorCount !== 0
      : fatalCount + errorCount === 0)
  ) {
    throw new Error("The HWPX utility returned inconsistent validation counts");
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

function parseResult(
  message: Record<string, unknown>,
  expected: HwpxExporterRunInput
): HwpxUtilityResult {
  exact(message, ["kind", "mode", "outputPath", "summary"], "result");
  if (message.mode !== expected.mode) {
    throw new Error("The HWPX utility returned another operation mode");
  }
  const outputPath = nullableString(message.outputPath, "output path", 32_000);
  if (
    (expected.mode === "EXPORT" &&
      path.resolve(outputPath ?? "") !== path.resolve(expected.outputPath)) ||
    (expected.mode === "VALIDATE_ONLY" && outputPath !== null)
  ) {
    throw new Error("The HWPX utility returned another output path");
  }
  const summary = object(message.summary, "summary");
  exact(
    summary,
    [
      "byteLength",
      "sha256",
      "logicalPackageHash",
      "packageXmlVersion",
      "sourcePublicationHash",
      "presetId",
      "presetContentHash",
      "fontFamily",
      "validationReport",
      "exportTiming",
      "statistics"
    ],
    "summary"
  );
  const timing = object(summary.exportTiming, "export timing");
  exact(
    timing,
    [
      "styleTableMs",
      "sectionXmlMs",
      "packageDocumentsMs",
      "zipPackagingMs",
      "internalValidationMs",
      "zipReopenMs",
      "sourceCoverageMs",
      "totalMs"
    ],
    "export timing"
  );
  const statistics = object(summary.statistics, "statistics");
  const statisticKeys = [
    "fileCount",
    "sectionCount",
    "exportedSectionCount",
    "paragraphCount",
    "runCount",
    "textCount",
    "sourceSectionCount",
    "sourceBlockCount",
    "exportedBlockCount",
    "fallbackBlockCount",
    "configuredOmissionBlockCount",
    "rejectedBlockCount",
    "sourceCharacterCount",
    "exportedCharacterCount",
    "headingCount",
    "sceneBreakCount",
    "rubyCount",
    "rubyFallbackCount",
    "strongSegmentCount",
    "emphasisSegmentCount",
    "underlineSegmentCount",
    "strikeSegmentCount"
  ] as const;
  exact(statistics, statisticKeys, "statistics");
  const parsedStatistics = Object.fromEntries(
    statisticKeys.map((key) => [key, integer(statistics[key], key)])
  ) as unknown as HwpxUtilityResult["summary"]["statistics"];
  const result: HwpxUtilityResult = {
    mode: expected.mode,
    outputPath,
    summary: {
      byteLength: integer(summary.byteLength, "byte length", MAX_HWPX_FILE_BYTES),
      sha256: hash(summary.sha256, "HWPX hash"),
      logicalPackageHash: hash(summary.logicalPackageHash, "logical package hash"),
      packageXmlVersion: string(summary.packageXmlVersion, "package XML version", 64),
      sourcePublicationHash: hash(
        summary.sourcePublicationHash,
        "source publication hash"
      ),
      presetId: string(summary.presetId, "preset id", 256),
      presetContentHash: hash(summary.presetContentHash, "preset hash"),
      fontFamily: string(summary.fontFamily, "font family", 128),
      validationReport: validation(summary.validationReport),
      exportTiming: {
        styleTableMs: integer(timing.styleTableMs, "style timing"),
        sectionXmlMs: integer(timing.sectionXmlMs, "section timing"),
        packageDocumentsMs: integer(
          timing.packageDocumentsMs,
          "package document timing"
        ),
        zipPackagingMs: integer(timing.zipPackagingMs, "ZIP timing"),
        internalValidationMs: integer(
          timing.internalValidationMs,
          "validation timing"
        ),
        zipReopenMs: integer(timing.zipReopenMs, "ZIP reopen timing"),
        sourceCoverageMs: integer(
          timing.sourceCoverageMs,
          "source coverage timing"
        ),
        totalMs: integer(timing.totalMs, "total timing")
      },
      statistics: parsedStatistics
    }
  };
  if (
    result.summary.sourcePublicationHash !== expected.sourcePublicationHash ||
    result.summary.presetId !== expected.presetId ||
    result.summary.presetContentHash !== expected.presetContentHash ||
    result.summary.fontFamily !== expected.config.fontFamilyToken
  ) {
    throw new Error("The HWPX utility returned a mismatched summary");
  }
  return result;
}

function progressStage(value: unknown): HwpxExportProgress["stage"] {
  switch (value) {
    case "PUBLICATION_IR":
      return "PUBLICATION_COMPILE";
    case "STYLE_TABLE":
      return "STYLE_TABLE";
    case "SECTION_XML":
      return "SECTION_XML";
    case "PACKAGE_DOCUMENTS":
    case "ZIP_PACKAGING":
      return "HWPX_PACKAGE";
    case "INTERNAL_VALIDATION":
      return "INTERNAL_VALIDATION";
    case "WRITE_OUTPUT":
    case "COMPLETE":
      return "FINALIZE";
    default:
      throw new Error("The HWPX utility returned invalid progress stage");
  }
}

export class ProcessHwpxExporter implements HwpxExporterPort {
  private readonly active = new Map<string, ActiveProcess>();
  private readonly ownedTemporaryPaths = new Set<string>();
  private disposed = false;

  public constructor(private readonly binaryPath: string) {}

  private terminate(active: ActiveProcess, error: Error): void {
    if (active.closedFlag) {
      return;
    }
    const terminationAlreadyRequested = active.terminalError !== null;
    active.terminalError ??= error;
    clearTimeout(active.timeout);
    if (active.closeReceived || terminationAlreadyRequested) {
      return;
    }
    try {
      active.child.kill();
    } catch {
      // The bounded close watchdog below remains authoritative.
    }
    active.forceKillTimeout ??= setTimeout(() => {
      if (!active.closedFlag) {
        try {
          active.child.kill("SIGKILL");
        } catch {
          // The run promise is still rejected by the settlement watchdog.
        }
      }
    }, PROCESS_CLOSE_TIMEOUT_MS);
  }

  private async waitForClosed(active: ActiveProcess): Promise<void> {
    const bounded = (timeoutMs: number): Promise<void> =>
      new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("The HWPX utility did not stop")),
          timeoutMs
        );
        void active.closed.then(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
    try {
      await bounded(PROCESS_CLOSE_TIMEOUT_MS);
    } catch {
      try {
        active.child.kill("SIGKILL");
      } catch {
        // The second bounded wait reports the shutdown failure.
      }
      await bounded(PROCESS_FORCE_CLOSE_TIMEOUT_MS);
    }
    if (active.cleanupError) {
      throw active.cleanupError;
    }
  }

  public run(
    input: HwpxExporterRunInput,
    onProgress: (progress: HwpxExportProgress) => void
  ): Promise<HwpxUtilityResult> {
    if (this.disposed) {
      return Promise.reject(new Error("The HWPX utility is not available"));
    }
    try {
      if (validateHwpxOperationId(input.operationId) !== input.operationId) {
        throw new Error("Non-canonical operation id");
      }
    } catch {
      return Promise.reject(new Error("The HWPX operation id is invalid"));
    }
    if (this.active.has(input.operationId)) {
      return Promise.reject(new Error("The HWPX operation is already running"));
    }
    const temporaryPath =
      input.mode === "EXPORT"
        ? path.join(
            path.dirname(input.outputPath),
            `.madi-hwpx-${input.operationId}.tmp`
          )
        : null;
    if (temporaryPath && existsSync(temporaryPath)) {
      return Promise.reject(
        new Error("The HWPX utility temporary path is already occupied")
      );
    }
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.binaryPath, [], {
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch {
      return Promise.reject(new Error("The HWPX utility could not start"));
    }
    return new Promise<HwpxUtilityResult>((resolve, reject) => {
      let runSettled = false;
      const resolveRun = (value: HwpxUtilityResult): void => {
        if (!runSettled) {
          runSettled = true;
          resolve(value);
        }
      };
      const rejectRun = (error: Error): void => {
        if (!runSettled) {
          runSettled = true;
          reject(error);
        }
      };
      const timeout = setTimeout(() => {
        const current = this.active.get(input.operationId);
        if (current) {
          this.terminate(current, new Error("The HWPX utility timed out"));
        }
      }, EXPORT_TIMEOUT_MS);
      let resolveClosed!: () => void;
      const closed = new Promise<void>((resolve) => {
        resolveClosed = resolve;
      });
      const active: ActiveProcess = {
        child,
        temporaryPath,
        timeout,
        closed,
        resolveClosed,
        forceKillTimeout: null,
        closeReceived: false,
        closedFlag: false,
        resultReceived: false,
        cancelled: false,
        terminalError: null,
        cleanupError: null
      };
      this.active.set(input.operationId, active);
      if (temporaryPath) {
        // The canonical UUID path was absent before this owned child started.
        // Register it before writing stdin so a kill between tempfile creation
        // and the first WRITE_OUTPUT message cannot leave an untracked file.
        this.ownedTemporaryPaths.add(temporaryPath);
      }
      let stdout = Buffer.alloc(0);
      let totalStdoutBytes = 0;
      let result: HwpxUtilityResult | null = null;
      let terminalReceived = false;
      const fail = (error: Error): void => this.terminate(active, error);
      const parseLine = (line: Buffer): void => {
        if (line.byteLength === 0 || active.closedFlag || active.terminalError) {
          return;
        }
        if (line.byteLength > MAX_STDOUT_LINE_BYTES) {
          fail(new Error("The HWPX utility returned an oversized message"));
          return;
        }
        try {
          const message = object(JSON.parse(line.toString("utf8")) as unknown, "message");
          if (message.kind === "PROGRESS") {
            if (terminalReceived) {
              throw new Error("The HWPX utility returned data after completion");
            }
            exact(message, ["kind", "stage", "completed", "total"], "progress");
            const completed = integer(
              message.completed,
              "progress completed",
              1_000_000
            );
            const total = integer(message.total, "progress total", 1_000_000);
            if (total < 1 || completed > total || total > 1_000_000) {
              throw new Error("The HWPX utility returned invalid progress");
            }
            onProgress(
              validateHwpxExportProgress({
                operationId: input.operationId,
                stage: progressStage(message.stage),
                completed,
                total
              })
            );
            return;
          }
          if (message.kind === "RESULT") {
            if (terminalReceived) {
              throw new Error("The HWPX utility returned duplicate results");
            }
            terminalReceived = true;
            result = parseResult(message, input);
            active.resultReceived = true;
            return;
          }
          if (message.kind === "ERROR") {
            if (terminalReceived) {
              throw new Error("The HWPX utility returned duplicate terminal messages");
            }
            terminalReceived = true;
            exact(
              message,
              ["kind", "code", "description", "validationReport"],
              "error"
            );
            const code = string(message.code, "error code", 128);
            string(message.description, "error description", 2_000);
            if (code === "VALIDATION_FAILED" && message.validationReport !== null) {
              fail(new HwpxUtilityValidationError(validation(message.validationReport)));
              return;
            }
            if (code === "CANCELLED") {
              fail(new HwpxExportCancelledError());
              return;
            }
            if (message.validationReport !== null) {
              throw new Error("The HWPX utility returned an unexpected report");
            }
            fail(new Error("The HWPX utility rejected the export"));
            return;
          }
          throw new Error("The HWPX utility returned an unsupported message");
        } catch (error) {
          fail(
            error instanceof HwpxUtilityValidationError ||
              error instanceof HwpxExportCancelledError
              ? error
              : new Error("The HWPX utility returned an invalid message")
          );
        }
      };
      child.stdout.on("data", (chunk: Buffer) => {
        if (active.closeReceived || active.closedFlag || active.terminalError) {
          return;
        }
        totalStdoutBytes += chunk.byteLength;
        if (totalStdoutBytes > MAX_STDOUT_BYTES) {
          fail(new Error("The HWPX utility returned too much data"));
          return;
        }
        stdout = Buffer.concat([stdout, chunk]);
        let newline = stdout.indexOf(0x0a);
        while (newline >= 0 && !active.terminalError) {
          parseLine(stdout.subarray(0, newline));
          stdout = stdout.subarray(newline + 1);
          newline = stdout.indexOf(0x0a);
        }
      });
      child.stderr.on("data", () => {
        // A successful utility run is silent on stderr. Treat any diagnostic
        // output as a protocol failure without retaining its potentially
        // private contents; typed JSON on stdout is the sole result channel.
        fail(new Error("The HWPX utility wrote unexpected diagnostics"));
      });
      child.stdin.on("error", () => {
        if (!terminalReceived && !active.closeReceived && !active.closedFlag) {
          fail(new Error("The HWPX utility input stream failed"));
        }
      });
      child.on("error", () => fail(new Error("The HWPX utility could not start")));
      child.on("close", async (code) => {
        if (active.closeReceived) {
          return;
        }
        active.closeReceived = true;
        try {
          clearTimeout(timeout);
          if (active.forceKillTimeout) {
            clearTimeout(active.forceKillTimeout);
            active.forceKillTimeout = null;
          }
          if (temporaryPath) {
            try {
              await removeOperationTemporaryFile(temporaryPath);
              this.ownedTemporaryPaths.delete(temporaryPath);
            } catch {
              this.ownedTemporaryPaths.add(temporaryPath);
              active.cleanupError = new Error(
                "The HWPX utility temporary file could not be removed"
              );
            }
          }
          if (!active.terminalError && stdout.byteLength > 0) {
            parseLine(stdout);
          }
          const terminal =
            active.terminalError ??
            active.cleanupError ??
            (active.cancelled
              ? new HwpxExportCancelledError()
              : code !== 0 || !terminalReceived || !result
                ? new Error("The HWPX utility did not complete")
                : null);
          if (terminal) {
            rejectRun(terminal);
          } else {
            resolveRun(result!);
          }
        } catch {
          rejectRun(new Error("The HWPX utility failed during shutdown"));
        } finally {
          active.closedFlag = true;
          if (this.active.get(input.operationId) === active) {
            this.active.delete(input.operationId);
          }
          active.resolveClosed();
        }
      });
      try {
        child.stdin.end(
          `${JSON.stringify(utilityInput(input))}\n`,
          "utf8",
          (error?: Error | null) => {
            if (
              !error ||
              terminalReceived ||
              active.closeReceived ||
              active.closedFlag ||
              this.active.get(input.operationId) !== active
            ) {
              return;
            }
            fail(new Error("The HWPX utility input stream failed"));
          }
        );
      } catch {
        if (
          !terminalReceived &&
          !active.closeReceived &&
          !active.closedFlag &&
          this.active.get(input.operationId) === active
        ) {
          fail(new Error("The HWPX utility input stream failed"));
        }
      }
    });
  }

  public async cancel(operationId: string): Promise<boolean> {
    const active = this.active.get(operationId);
    if (
      !active ||
      active.resultReceived ||
      active.closeReceived ||
      active.closedFlag
    ) {
      return false;
    }
    active.cancelled = true;
    this.terminate(active, new HwpxExportCancelledError());
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
    const results = await Promise.allSettled(
      [...this.active.entries()].map(async ([operationId, active]) => {
        if (!active.resultReceived && !active.closeReceived) {
          this.terminate(active, new Error("The HWPX utility was disposed"));
        }
        await this.waitForClosed(active);
        this.active.delete(operationId);
      })
    );
    const liveTemporaryPaths = new Set(
      [...this.active.values()].flatMap((active) =>
        active.temporaryPath ? [active.temporaryPath] : []
      )
    );
    const cleanupResults = await Promise.allSettled(
      [...this.ownedTemporaryPaths]
        .filter((filePath) => !liveTemporaryPaths.has(filePath))
        .map(async (filePath) => {
          await removeOperationTemporaryFile(filePath);
          this.ownedTemporaryPaths.delete(filePath);
        })
    );
    if (
      this.active.size > 0 ||
      this.ownedTemporaryPaths.size > 0 ||
      results.some((result) => result.status === "rejected") ||
      cleanupResults.some((result) => result.status === "rejected")
    ) {
      throw new Error("The HWPX utility did not shut down cleanly");
    }
  }
}
