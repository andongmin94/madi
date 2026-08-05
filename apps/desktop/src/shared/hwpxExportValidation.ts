import {
  HWPX_EXPORT_PRESET_VERSION,
  type HwpxExportPresetConfig,
  type HwpxExportPresetMutationResult,
  type HwpxExportPresetRecord,
  type HwpxExportProgress,
  type HwpxExportReport,
  type HwpxExportState,
  type HwpxHeadingStyleConfig,
  type HwpxOutputSelection,
  type DeleteHwpxExportPresetResult,
  type SaveHwpxExportReportResult,
  type ValidateHwpxExportResult,
  type RunHwpxExportResult
} from "./hwpxExport";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const XML_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const PAGE_SIZES = new Set(["A4", "LETTER", "CUSTOM"]);
const ORIENTATIONS = new Set(["PORTRAIT", "LANDSCAPE"]);
const LINE_SPACING_MODES = new Set(["PERCENT", "FIXED_PT"]);
const ALIGNMENTS = new Set(["LEFT", "CENTER", "RIGHT", "JUSTIFY"]);
const PAGE_NUMBER_POSITIONS = new Set([
  "BOTTOM_LEFT",
  "BOTTOM_CENTER",
  "BOTTOM_RIGHT"
]);
const SCENE_BREAKS = new Set(["ORNAMENT", "RULE", "SPACE"]);
const SECTION_SPLITS = new Set(["SINGLE", "VOLUME"]);
const EXPORT_STAGES = new Set([
  "PUBLICATION_COMPILE",
  "STYLE_TABLE",
  "SECTION_XML",
  "HWPX_PACKAGE",
  "INTERNAL_VALIDATION",
  "HWP_CONVERSION",
  "REOPEN_VERIFICATION",
  "FINALIZE"
]);
const OUTPUT_TYPES = new Set(["HWPX", "HWP"]);
const SCOPE_KINDS = new Set(["WORK", "VOLUME", "CHAPTER", "SCENE"]);
const VALIDATION_STATUSES = new Set(["VALID", "INVALID", "CANCELLED"]);
const VALIDATION_SEVERITIES = new Set(["FATAL", "ERROR", "WARNING", "INFO"]);
const REOPEN_STATUSES = new Set(["NOT_RUN", "PASSED", "FAILED"]);
const HASH_PATTERN = /^[0-9a-f]{64}$/u;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  input: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void {
  const actual = Object.keys(input).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error(`Invalid ${label} fields`);
  }
}

function enumValue<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string
): T {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as T;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function number(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function nullableNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number
): number | null {
  if (value === null) {
    return null;
  }
  return number(value, label, minimum, maximum);
}

function integer(
  value: unknown,
  label: string,
  minimum = 0,
  maximum = 1_000_000_000
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value as number;
}

function nullableBoolean(value: unknown, label: string): boolean | null {
  if (value === null) {
    return null;
  }
  return boolean(value, label);
}

function nullableText(
  value: unknown,
  label: string,
  maximum: number
): string | null {
  if (value === null) {
    return null;
  }
  return text(value, label, maximum, true);
}

function hash(value: unknown, label: string): string {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  const parsed = text(value, label, 64);
  if (!Number.isFinite(Date.parse(parsed))) {
    throw new Error(`Invalid ${label}`);
  }
  return parsed;
}

function nullableHash(value: unknown, label: string): string | null {
  return value === null ? null : hash(value, label);
}

function text(
  value: unknown,
  label: string,
  maximum: number,
  allowEmpty = false
): string {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    XML_CONTROL_PATTERN.test(value) ||
    (!allowEmpty && value.trim().length === 0)
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function font(value: unknown, label: string): string {
  const parsed = text(value, label, 128);
  if (parsed.trim() !== parsed || /[<>&"']/u.test(parsed)) {
    throw new Error(`Invalid ${label}`);
  }
  return parsed;
}

function heading(value: unknown, label: string): HwpxHeadingStyleConfig {
  const input = record(value, label);
  exactKeys(
    input,
    [
      "fontFamilyToken",
      "fontSizePt",
      "bold",
      "alignment",
      "spacingBefore",
      "spacingAfter",
      "pageBreakBefore"
    ],
    label
  );
  return {
    fontFamilyToken: font(input.fontFamilyToken, `${label} font`),
    fontSizePt: number(input.fontSizePt, `${label} font size`, 6, 72),
    bold: boolean(input.bold, `${label} bold`),
    alignment: enumValue(input.alignment, ALIGNMENTS, `${label} alignment`),
    spacingBefore: number(input.spacingBefore, `${label} spacing before`, 0, 100),
    spacingAfter: number(input.spacingAfter, `${label} spacing after`, 0, 100),
    pageBreakBefore: boolean(
      input.pageBreakBefore,
      `${label} page break before`
    )
  };
}

export function validateHwpxExportPresetConfig(
  value: unknown
): HwpxExportPresetConfig {
  const input = record(value, "HWPX export preset");
  exactKeys(
    input,
    [
      "formatVersion",
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
      "fontFamilyToken",
      "fontSizePt",
      "lineSpacingMode",
      "lineSpacingValue",
      "firstLineIndent",
      "paragraphSpacingBefore",
      "paragraphSpacingAfter",
      "textAlign",
      "workTitleStyle",
      "volumeTitleStyle",
      "chapterTitleStyle",
      "sceneTitleStyle",
      "includeTitlePage",
      "includeWorkTitle",
      "includeVolumeTitles",
      "includeChapterTitles",
      "includeSceneTitles",
      "sectionSplitMode",
      "includePageNumber",
      "pageNumberStart",
      "pageNumberPosition",
      "includeHeader",
      "headerText",
      "includeFooter",
      "footerText",
      "sceneBreakToken"
    ],
    "HWPX export preset"
  );
  if (input.formatVersion !== HWPX_EXPORT_PRESET_VERSION) {
    throw new Error("Unsupported HWPX export preset version");
  }
  const pageSizeToken = enumValue<"A4" | "LETTER" | "CUSTOM">(
    input.pageSizeToken,
    PAGE_SIZES,
    "HWPX page size"
  );
  const customPageWidth = nullableNumber(
    input.customPageWidth,
    "custom page width",
    50,
    500
  );
  const customPageHeight = nullableNumber(
    input.customPageHeight,
    "custom page height",
    50,
    500
  );
  if (
    (pageSizeToken === "CUSTOM") !==
    (customPageWidth !== null && customPageHeight !== null)
  ) {
    throw new Error("Invalid HWPX custom page dimensions");
  }
  const lineSpacingMode = enumValue<"PERCENT" | "FIXED_PT">(
    input.lineSpacingMode,
    LINE_SPACING_MODES,
    "HWPX line spacing mode"
  );
  const lineSpacingValue = number(
    input.lineSpacingValue,
    "HWPX line spacing",
    lineSpacingMode === "PERCENT" ? 50 : 6,
    lineSpacingMode === "PERCENT" ? 400 : 200
  );
  const includeHeader = boolean(input.includeHeader, "include header");
  const includeFooter = boolean(input.includeFooter, "include footer");
  const headerText = text(input.headerText, "header text", 1_000, true);
  const footerText = text(input.footerText, "footer text", 1_000, true);
  if ((!includeHeader && headerText !== "") || (!includeFooter && footerText !== "")) {
    throw new Error("Disabled header or footer must not contain text");
  }
  const pageNumberStart = input.pageNumberStart;
  if (
    !Number.isSafeInteger(pageNumberStart) ||
    (pageNumberStart as number) < 1 ||
    (pageNumberStart as number) > 1_000_000
  ) {
    throw new Error("Invalid HWPX page number start");
  }
  return {
    formatVersion: HWPX_EXPORT_PRESET_VERSION,
    pageSizeToken,
    customPageWidth,
    customPageHeight,
    orientation: enumValue(input.orientation, ORIENTATIONS, "HWPX orientation"),
    marginTop: number(input.marginTop, "top margin", 0, 100),
    marginBottom: number(input.marginBottom, "bottom margin", 0, 100),
    marginLeft: number(input.marginLeft, "left margin", 0, 100),
    marginRight: number(input.marginRight, "right margin", 0, 100),
    headerMargin: number(input.headerMargin, "header margin", 0, 100),
    footerMargin: number(input.footerMargin, "footer margin", 0, 100),
    gutter: number(input.gutter, "gutter", 0, 100),
    fontFamilyToken: font(input.fontFamilyToken, "body font"),
    fontSizePt: number(input.fontSizePt, "body font size", 6, 72),
    lineSpacingMode,
    lineSpacingValue,
    firstLineIndent: number(input.firstLineIndent, "first line indent", -100, 100),
    paragraphSpacingBefore: number(
      input.paragraphSpacingBefore,
      "paragraph spacing before",
      0,
      100
    ),
    paragraphSpacingAfter: number(
      input.paragraphSpacingAfter,
      "paragraph spacing after",
      0,
      100
    ),
    textAlign: enumValue(input.textAlign, ALIGNMENTS, "body alignment"),
    workTitleStyle: heading(input.workTitleStyle, "work title style"),
    volumeTitleStyle: heading(input.volumeTitleStyle, "volume title style"),
    chapterTitleStyle: heading(input.chapterTitleStyle, "chapter title style"),
    sceneTitleStyle: heading(input.sceneTitleStyle, "scene title style"),
    includeTitlePage: boolean(input.includeTitlePage, "include title page"),
    includeWorkTitle: boolean(input.includeWorkTitle, "include work title"),
    includeVolumeTitles: boolean(input.includeVolumeTitles, "include volume titles"),
    includeChapterTitles: boolean(
      input.includeChapterTitles,
      "include chapter titles"
    ),
    includeSceneTitles: boolean(input.includeSceneTitles, "include scene titles"),
    sectionSplitMode: enumValue(
      input.sectionSplitMode,
      SECTION_SPLITS,
      "HWPX section split mode"
    ),
    includePageNumber: boolean(input.includePageNumber, "include page number"),
    pageNumberStart: pageNumberStart as number,
    pageNumberPosition: enumValue(
      input.pageNumberPosition,
      PAGE_NUMBER_POSITIONS,
      "HWPX page number position"
    ),
    includeHeader,
    headerText,
    includeFooter,
    footerText,
    sceneBreakToken: enumValue(
      input.sceneBreakToken,
      SCENE_BREAKS,
      "HWPX scene break"
    )
  };
}

export function validateHwpxOperationId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error("Invalid HWPX export operation id");
  }
  return value.toLowerCase();
}

function validateHwpxPresetRecord(value: unknown): HwpxExportPresetRecord {
  const input = record(value, "HWPX preset record");
  exactKeys(
    input,
    [
      "id",
      "projectId",
      "kind",
      "name",
      "presetFormat",
      "presetVersion",
      "config",
      "contentHash",
      "revision",
      "createdAt",
      "updatedAt"
    ],
    "HWPX preset record"
  );
  if (
    input.kind !== "HWPX" ||
    input.presetFormat !== "MADI_EXPORT_PRESET" ||
    input.presetVersion !== 1
  ) {
    throw new Error("Invalid HWPX preset identity");
  }
  return {
    id: text(input.id, "HWPX preset id", 256),
    projectId: text(input.projectId, "HWPX preset project id", 256),
    kind: "HWPX",
    name: validateHwpxPresetName(input.name),
    presetFormat: "MADI_EXPORT_PRESET",
    presetVersion: 1,
    config: validateHwpxExportPresetConfig(input.config),
    contentHash: hash(input.contentHash, "HWPX preset content hash"),
    revision: integer(input.revision, "HWPX preset revision", 1),
    createdAt: timestamp(input.createdAt, "HWPX preset created time"),
    updatedAt: timestamp(input.updatedAt, "HWPX preset updated time")
  };
}

export function validateHwpxExportState(value: unknown): HwpxExportState {
  const input = record(value, "HWPX export state");
  exactKeys(
    input,
    ["metadata", "presets", "duplicatePresetNames", "hancom", "revision"],
    "HWPX export state"
  );
  const metadataInput = record(input.metadata, "HWPX publication metadata");
  exactKeys(
    metadataInput,
    [
      "projectId",
      "publicationTitle",
      "creatorName",
      "language",
      "identifier",
      "publisher",
      "description",
      "rights",
      "subjects",
      "coverAssetId",
      "createdAt",
      "updatedAt"
    ],
    "HWPX publication metadata"
  );
  if (!Array.isArray(metadataInput.subjects) || metadataInput.subjects.length > 64) {
    throw new Error("Invalid HWPX publication subjects");
  }
  const subjects = metadataInput.subjects.map((subject) =>
    text(subject, "HWPX publication subject", 500)
  );
  if (new Set(subjects).size !== subjects.length) {
    throw new Error("Duplicate HWPX publication subject");
  }
  if (!Array.isArray(input.presets) || input.presets.length > 10_000) {
    throw new Error("Invalid HWPX presets");
  }
  const presets = input.presets.map(validateHwpxPresetRecord);
  if (new Set(presets.map((preset) => preset.id)).size !== presets.length) {
    throw new Error("Duplicate HWPX preset id");
  }
  if (
    !Array.isArray(input.duplicatePresetNames) ||
    input.duplicatePresetNames.length > presets.length
  ) {
    throw new Error("Invalid duplicate HWPX preset names");
  }
  const duplicatePresetNames = input.duplicatePresetNames.map((name) =>
    validateHwpxPresetName(name)
  );
  if (new Set(duplicatePresetNames).size !== duplicatePresetNames.length) {
    throw new Error("Duplicate HWPX duplicate-preset name");
  }
  const hancomInput = record(input.hancom, "Hancom availability");
  let hancom: HwpxExportState["hancom"];
  if (hancomInput.status === "UNAVAILABLE") {
    exactKeys(hancomInput, ["status", "reason"], "Hancom availability");
    if (
      hancomInput.reason !== "NOT_WINDOWS" &&
      hancomInput.reason !== "NOT_INSTALLED" &&
      hancomInput.reason !== "BRIDGE_UNAVAILABLE"
    ) {
      throw new Error("Invalid Hancom unavailable reason");
    }
    hancom = { status: "UNAVAILABLE", reason: hancomInput.reason };
  } else {
    exactKeys(hancomInput, ["status", "version"], "Hancom availability");
    if (
      hancomInput.status !== "REGISTERED_UNVERIFIED" &&
      hancomInput.status !== "AVAILABLE"
    ) {
      throw new Error("Invalid Hancom availability status");
    }
    hancom = {
      status: hancomInput.status,
      version: nullableText(hancomInput.version, "Hancom version", 256)
    };
  }
  return {
    metadata: {
      projectId: text(metadataInput.projectId, "HWPX metadata project id", 256),
      publicationTitle: text(metadataInput.publicationTitle, "HWPX publication title", 1_000),
      creatorName: text(metadataInput.creatorName, "HWPX publication creator", 500, true),
      language: text(metadataInput.language, "HWPX publication language", 35),
      identifier: text(metadataInput.identifier, "HWPX publication identifier", 1_000),
      publisher: nullableText(metadataInput.publisher, "HWPX publication publisher", 1_000),
      description: nullableText(
        metadataInput.description,
        "HWPX publication description",
        20_000
      ),
      rights: nullableText(metadataInput.rights, "HWPX publication rights", 10_000),
      subjects,
      coverAssetId: nullableText(metadataInput.coverAssetId, "HWPX cover asset id", 256),
      createdAt: timestamp(metadataInput.createdAt, "HWPX metadata created time"),
      updatedAt: timestamp(metadataInput.updatedAt, "HWPX metadata updated time")
    },
    presets,
    duplicatePresetNames,
    hancom,
    revision: integer(input.revision, "HWPX state revision")
  };
}

export function validateHwpxPresetMutationResult(
  value: unknown
): HwpxExportPresetMutationResult {
  const input = record(value, "HWPX preset mutation result");
  exactKeys(
    input,
    ["preset", "revision", "noOp"],
    "HWPX preset mutation result"
  );
  return {
    preset: validateHwpxPresetRecord(input.preset),
    revision: integer(input.revision, "HWPX mutation revision"),
    noOp: boolean(input.noOp, "HWPX mutation no-op")
  };
}

export function validateDeleteHwpxPresetResult(
  value: unknown
): DeleteHwpxExportPresetResult {
  const input = record(value, "delete HWPX preset result");
  exactKeys(
    input,
    ["deletedPresetId", "revision"],
    "delete HWPX preset result"
  );
  return {
    deletedPresetId: text(input.deletedPresetId, "deleted HWPX preset id", 256),
    revision: integer(input.revision, "delete HWPX preset revision")
  };
}

export function validateSaveHwpxExportReportResult(
  value: unknown
): SaveHwpxExportReportResult | null {
  if (value === null) {
    return null;
  }
  const input = record(value, "save HWPX report result");
  exactKeys(input, ["fileName", "byteLength"], "save HWPX report result");
  const fileName = text(input.fileName, "HWPX report file name", 1_000);
  if (
    /[\\/:]/u.test(fileName) ||
    (!fileName.toLocaleLowerCase().endsWith(".json") &&
      !fileName.toLocaleLowerCase().endsWith(".md"))
  ) {
    throw new Error("Invalid HWPX report file name");
  }
  return {
    fileName,
    byteLength: integer(input.byteLength, "HWPX report byte length", 1, 8 * 1024 * 1024)
  };
}

export function validateHwpxExportProgress(value: unknown): HwpxExportProgress {
  const input = record(value, "HWPX export progress");
  exactKeys(
    input,
    ["operationId", "stage", "completed", "total"],
    "HWPX export progress"
  );
  if (
    !Number.isSafeInteger(input.completed) ||
    !Number.isSafeInteger(input.total) ||
    (input.completed as number) < 0 ||
    (input.total as number) < 1 ||
    (input.completed as number) > (input.total as number) ||
    (input.total as number) > 1_000_000
  ) {
    throw new Error("Invalid HWPX export progress values");
  }
  return {
    operationId: validateHwpxOperationId(input.operationId),
    stage: enumValue(input.stage, EXPORT_STAGES, "HWPX export stage"),
    completed: input.completed as number,
    total: input.total as number
  };
}

export function validateRunHwpxExportResult(
  value: unknown
): RunHwpxExportResult {
  const input = record(value, "HWPX export result");
  if (input.status === "CANCELLED") {
    if ("preservedHwpxFileName" in input || "report" in input) {
      exactKeys(
        input,
        ["status", "operationId", "preservedHwpxFileName", "report"],
        "cancelled HWP conversion result"
      );
      const operationId = validateHwpxOperationId(input.operationId);
      const preservedHwpxFileName = text(
        input.preservedHwpxFileName,
        "preserved HWPX file name",
        1_000
      );
      const report = validateHwpxExportReport(input.report);
      if (
        /[\\/:]/u.test(preservedHwpxFileName) ||
        !preservedHwpxFileName.toLocaleLowerCase().endsWith(".hwpx") ||
        report.outputType !== "HWP" ||
        report.preservedHwpxFileName !== preservedHwpxFileName ||
        report.hwpxSha256 === null
      ) {
        throw new Error("Mismatched preserved HWPX cancellation identity");
      }
      return {
        status: "CANCELLED",
        operationId,
        preservedHwpxFileName,
        report
      };
    }
    exactKeys(input, ["status", "operationId"], "cancelled HWPX result");
    return {
      status: "CANCELLED",
      operationId: validateHwpxOperationId(input.operationId)
    };
  }
  if (input.status === "FAILED") {
    const operationId = validateHwpxOperationId(input.operationId);
    if (
      input.code === "HWP_CONVERSION_FAILED" ||
      input.code === "HWP_OUTPUT_FAILED"
    ) {
      exactKeys(
        input,
        [
          "status",
          "operationId",
          "code",
          "preservedHwpxFileName",
          "report"
        ],
        "failed HWP conversion result"
      );
      const preservedHwpxFileName = text(
        input.preservedHwpxFileName,
        "preserved HWPX file name",
        1_000
      );
      if (
        /[\\/:]/u.test(preservedHwpxFileName) ||
        !preservedHwpxFileName.toLocaleLowerCase().endsWith(".hwpx")
      ) {
        throw new Error("Invalid preserved HWPX file identity");
      }
      const report = validateHwpxExportReport(input.report);
      if (
        report.outputType !== "HWP" ||
        report.preservedHwpxFileName !== preservedHwpxFileName ||
        report.hwpxSha256 === null
      ) {
        throw new Error("Mismatched preserved HWPX report identity");
      }
      return {
        status: "FAILED",
        operationId,
        code: input.code,
        preservedHwpxFileName,
        report
      };
    }
    if (
      input.code === "DESTINATION_CHANGED" &&
      ("preservedHwpxFileName" in input || "report" in input)
    ) {
      exactKeys(
        input,
        ["status", "operationId", "code", "preservedHwpxFileName", "report"],
        "changed HWP destination result"
      );
      const preservedHwpxFileName = text(
        input.preservedHwpxFileName,
        "preserved HWPX file name",
        1_000
      );
      const report = validateHwpxExportReport(input.report);
      if (
        /[\\/:]/u.test(preservedHwpxFileName) ||
        !preservedHwpxFileName.toLocaleLowerCase().endsWith(".hwpx") ||
        report.outputType !== "HWP" ||
        report.preservedHwpxFileName !== preservedHwpxFileName ||
        report.hwpxSha256 === null
      ) {
        throw new Error("Mismatched preserved HWPX destination identity");
      }
      return {
        status: "FAILED",
        operationId,
        code: "DESTINATION_CHANGED",
        preservedHwpxFileName,
        report
      };
    }
    if (input.code === "RECOVERY_REQUIRED") {
      exactKeys(
        input,
        ["status", "operationId", "code", "recoveryFileName"],
        "recoverable HWPX output failure"
      );
      const recoveryFileName =
        input.recoveryFileName === null
          ? null
          : text(input.recoveryFileName, "recovery file name", 1_000);
      if (recoveryFileName !== null && /[\\/:]/u.test(recoveryFileName)) {
        throw new Error("Invalid HWPX recovery file name");
      }
      return {
        status: "FAILED",
        operationId,
        code: "RECOVERY_REQUIRED",
        recoveryFileName
      };
    }
    exactKeys(input, ["status", "operationId", "code"], "failed HWPX result");
    if (
      input.code !== "DESTINATION_CHANGED" &&
      input.code !== "HWP_CONVERSION_UNAVAILABLE"
    ) {
      throw new Error("Invalid HWPX export failure code");
    }
    return {
      status: "FAILED",
      operationId,
      code: input.code
    };
  }
  if (input.status !== "COMPLETED") {
    throw new Error("Invalid HWPX export result status");
  }
  exactKeys(
    input,
    ["status", "operationId", "fileName", "byteLength", "sha256", "report", "revision"],
    "completed HWPX result"
  );
  const fileName = text(input.fileName, "HWPX output file name", 1_000);
  if (
    /[\\/:]/u.test(fileName) ||
    (!fileName.toLocaleLowerCase().endsWith(".hwpx") &&
      !fileName.toLocaleLowerCase().endsWith(".hwp"))
  ) {
    throw new Error("Invalid HWPX output file name");
  }
  if (
    !Number.isSafeInteger(input.byteLength) ||
    (input.byteLength as number) < 1 ||
    (input.byteLength as number) > 512 * 1024 * 1024 ||
    typeof input.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(input.sha256) ||
    !Number.isSafeInteger(input.revision) ||
    (input.revision as number) < 0
  ) {
    throw new Error("Invalid HWPX output identity");
  }
  const report = validateHwpxExportReport(input.report);
  if (
    report.byteLength !== input.byteLength ||
    report.outputSha256 !== input.sha256 ||
    (fileName.toLocaleLowerCase().endsWith(".hwp")
      ? report.outputType !== "HWP"
      : report.outputType !== "HWPX")
  ) {
    throw new Error("Mismatched HWPX export report identity");
  }
  return {
    status: "COMPLETED",
    operationId: validateHwpxOperationId(input.operationId),
    fileName,
    byteLength: input.byteLength as number,
    sha256: input.sha256,
    report,
    revision: input.revision as number
  };
}

export function validateHwpxOutputSelection(
  value: unknown
): HwpxOutputSelection | null {
  if (value === null) {
    return null;
  }
  const input = record(value, "HWPX output selection");
  exactKeys(
    input,
    ["selectionId", "fileName", "outputType"],
    "HWPX output selection"
  );
  const fileName = text(input.fileName, "HWPX output file name", 1_000);
  const outputType = enumValue<"HWPX" | "HWP">(
    input.outputType,
    OUTPUT_TYPES,
    "HWPX output type"
  );
  if (
    /[\\/:]/u.test(fileName) ||
    !fileName.toLocaleLowerCase().endsWith(
      outputType === "HWPX" ? ".hwpx" : ".hwp"
    )
  ) {
    throw new Error("Invalid HWPX output file name");
  }
  return {
    selectionId: text(input.selectionId, "HWPX output selection id", 256),
    fileName,
    outputType
  };
}

export function validateValidateHwpxExportResult(
  value: unknown
): ValidateHwpxExportResult {
  const input = record(value, "HWPX validation result");
  exactKeys(
    input,
    ["operationId", "sourcePublicationHash", "report", "revision"],
    "HWPX validation result"
  );
  const report = validateHwpxExportReport(input.report);
  const sourcePublicationHash = hash(
    input.sourcePublicationHash,
    "HWPX source publication hash"
  );
  if (report.sourcePublicationHash !== sourcePublicationHash) {
    throw new Error("Mismatched HWPX source publication hash");
  }
  return {
    operationId: validateHwpxOperationId(input.operationId),
    sourcePublicationHash,
    report,
    revision: integer(input.revision, "HWPX validation revision")
  };
}

export function validateHwpxExportReport(value: unknown): HwpxExportReport {
  const input = record(value, "HWPX export report");
  exactKeys(
    input,
    [
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
      "madiVersion"
    ],
    "HWPX export report"
  );
  if (input.formatVersion !== 1) {
    throw new Error("Unsupported HWPX export report version");
  }
  if (input.packageProfile !== "HANCOM_OFFICIAL_MODEL_1_31") {
    throw new Error("Invalid HWPX package profile");
  }

  const coverageInput = record(input.coverage, "HWPX coverage");
  const coverageKeys = [
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
    "inlineModifierCount"
  ] as const;
  exactKeys(coverageInput, coverageKeys, "HWPX coverage");
  const coverage = Object.fromEntries(
    coverageKeys.map((key) => [key, integer(coverageInput[key], `HWPX ${key}`)])
  ) as unknown as HwpxExportReport["coverage"];
  if (
    coverage.exportedBlockCount +
      coverage.fallbackBlockCount +
      coverage.configuredOmissionBlockCount +
      coverage.rejectedBlockCount !==
      coverage.sourceBlockCount ||
    coverage.exportedSectionCount > coverage.sourceSectionCount ||
    coverage.exportedCharacterCount > coverage.sourceCharacterCount
  ) {
    throw new Error("Invalid HWPX source coverage");
  }

  const validationInput = record(input.validation, "HWPX validation report");
  exactKeys(
    validationInput,
    [
      "status",
      "fatalCount",
      "errorCount",
      "warningCount",
      "infoCount",
      "messages"
    ],
    "HWPX validation report"
  );
  if (!Array.isArray(validationInput.messages) || validationInput.messages.length > 1_000) {
    throw new Error("Invalid HWPX validation messages");
  }
  const messages = validationInput.messages.map((messageValue) => {
    const message = record(messageValue, "HWPX validation message");
    exactKeys(
      message,
      [
        "severity",
        "code",
        "description",
        "suggestion",
        "sourceNodeId",
        "sectionId",
        "hwpxPath"
      ],
      "HWPX validation message"
    );
    const hwpxPath = nullableText(message.hwpxPath, "HWPX validation path", 1_000);
    if (
      hwpxPath !== null &&
      (/^[A-Za-z]:[\\/]/u.test(hwpxPath) ||
        hwpxPath.startsWith("/") ||
        hwpxPath.split(/[\\/]/u).includes(".."))
    ) {
      throw new Error("Invalid HWPX validation path");
    }
    return {
      severity: enumValue(
        message.severity,
        VALIDATION_SEVERITIES,
        "HWPX validation severity"
      ),
      code: text(message.code, "HWPX validation code", 256),
      description: text(message.description, "HWPX validation description", 4_000),
      suggestion: nullableText(message.suggestion, "HWPX validation suggestion", 4_000),
      sourceNodeId: nullableText(message.sourceNodeId, "HWPX source node id", 256),
      sectionId: nullableText(message.sectionId, "HWPX section id", 256),
      hwpxPath
    };
  });
  const fatalCount = integer(validationInput.fatalCount, "HWPX fatal count");
  const errorCount = integer(validationInput.errorCount, "HWPX error count");
  const warningCount = integer(validationInput.warningCount, "HWPX warning count");
  const infoCount = integer(validationInput.infoCount, "HWPX info count");
  const counts = { FATAL: fatalCount, ERROR: errorCount, WARNING: warningCount, INFO: infoCount };
  if (
    (Object.keys(counts) as (keyof typeof counts)[]).some(
      (severity) => messages.filter((message) => message.severity === severity).length !== counts[severity]
    )
  ) {
    throw new Error("Mismatched HWPX validation counts");
  }
  const validation = {
    status: enumValue(
      validationInput.status,
      VALIDATION_STATUSES,
      "HWPX validation status"
    ),
    fatalCount,
    errorCount,
    warningCount,
    infoCount,
    messages
  } as HwpxExportReport["validation"];
  if (
    (validation.status === "VALID" && (fatalCount !== 0 || errorCount !== 0)) ||
    (validation.status === "INVALID" && fatalCount === 0 && errorCount === 0) ||
    (validation.status === "VALID" &&
      (coverage.rejectedBlockCount !== 0 ||
        coverage.packageSectionCount < 1 ||
        coverage.exportedSectionCount !== coverage.sourceSectionCount ||
        coverage.sourceCharacterCount !== coverage.exportedCharacterCount))
  ) {
    throw new Error("Invalid HWPX validation outcome");
  }

  const pageInput = record(input.page, "HWPX report page");
  exactKeys(
    pageInput,
    [
      "pageSizeToken",
      "orientation",
      "marginTop",
      "marginBottom",
      "marginLeft",
      "marginRight"
    ],
    "HWPX report page"
  );
  const timingInput = record(input.timing, "HWPX report timing");
  const timingKeys = [
    "semanticMappingMs",
    "styleTableMs",
    "sectionXmlMs",
    "packageMs",
    "internalValidationMs",
    "zipReopenMs",
    "sourceCoverageMs",
    "totalMs",
    "hwpConversionMs",
    "hwpReopenMs"
  ] as const;
  exactKeys(timingInput, timingKeys, "HWPX report timing");
  const generatedAt = text(input.generatedAt, "HWPX generated time", 64);
  if (!Number.isFinite(Date.parse(generatedAt))) {
    throw new Error("Invalid HWPX generated time");
  }
  const outputType = enumValue<"HWPX" | "HWP">(
    input.outputType,
    OUTPUT_TYPES,
    "HWPX output type"
  );
  const preservedHwpxFileName =
    input.preservedHwpxFileName === null
      ? null
      : text(input.preservedHwpxFileName, "preserved HWPX file name", 1_000);
  if (
    (preservedHwpxFileName !== null &&
      (/[\\/:]/u.test(preservedHwpxFileName) ||
        !preservedHwpxFileName.toLocaleLowerCase().endsWith(".hwpx"))) ||
    (outputType === "HWP") !== (preservedHwpxFileName !== null)
  ) {
    throw new Error("Invalid preserved HWPX file identity");
  }

  return {
    formatVersion: 1,
    outputType,
    packageProfile: "HANCOM_OFFICIAL_MODEL_1_31",
    sourceScope: enumValue(input.sourceScope, SCOPE_KINDS, "HWPX source scope"),
    sourceScopeNodeId: validateHwpxIdentifier(
      input.sourceScopeNodeId,
      "HWPX source scope node id"
    ),
    sourceProjectRevision: integer(
      input.sourceProjectRevision,
      "HWPX source project revision"
    ),
    sourcePublicationHash: hash(
      input.sourcePublicationHash,
      "HWPX source publication hash"
    ),
    presetId: text(input.presetId, "HWPX preset id", 256),
    presetContentHash: hash(input.presetContentHash, "HWPX preset content hash"),
    hwpxSha256: nullableHash(input.hwpxSha256, "HWPX SHA-256"),
    outputSha256: nullableHash(input.outputSha256, "HWPX output SHA-256"),
    preservedHwpxFileName,
    logicalPackageHash: hash(input.logicalPackageHash, "HWPX logical package hash"),
    byteLength:
      input.byteLength === null
        ? null
        : integer(input.byteLength, "HWPX byte length", 1, 512 * 1024 * 1024),
    coverage,
    validation,
    fontFamily: text(input.fontFamily, "HWPX font family", 128),
    fontInstalled: nullableBoolean(input.fontInstalled, "HWPX font installed"),
    page: {
      pageSizeToken: enumValue(pageInput.pageSizeToken, PAGE_SIZES, "HWPX page size"),
      orientation: enumValue(pageInput.orientation, ORIENTATIONS, "HWPX orientation"),
      marginTop: number(pageInput.marginTop, "HWPX top margin", 0, 100),
      marginBottom: number(pageInput.marginBottom, "HWPX bottom margin", 0, 100),
      marginLeft: number(pageInput.marginLeft, "HWPX left margin", 0, 100),
      marginRight: number(pageInput.marginRight, "HWPX right margin", 0, 100)
    },
    hancomReopen: enumValue(
      input.hancomReopen,
      REOPEN_STATUSES,
      "Hancom reopen status"
    ),
    hwpConverted: boolean(input.hwpConverted, "HWP converted"),
    timing: {
      semanticMappingMs: integer(timingInput.semanticMappingMs, "semantic mapping time"),
      styleTableMs: integer(timingInput.styleTableMs, "style table time"),
      sectionXmlMs: integer(timingInput.sectionXmlMs, "section XML time"),
      packageMs: integer(timingInput.packageMs, "package time"),
      internalValidationMs: integer(
        timingInput.internalValidationMs,
        "internal validation time"
      ),
      zipReopenMs: integer(timingInput.zipReopenMs, "ZIP reopen time"),
      sourceCoverageMs: integer(timingInput.sourceCoverageMs, "source coverage time"),
      totalMs: integer(timingInput.totalMs, "total export time"),
      hwpConversionMs:
        timingInput.hwpConversionMs === null
          ? null
          : integer(timingInput.hwpConversionMs, "HWP conversion time"),
      hwpReopenMs:
        timingInput.hwpReopenMs === null
          ? null
          : integer(timingInput.hwpReopenMs, "HWP reopen time")
    },
    generatedAt,
    madiVersion: text(input.madiVersion, "madi version", 128)
  };
}

export function validateHwpxPresetName(value: unknown): string {
  return text(value, "HWPX export preset name", 500);
}

export function validateHwpxIdentifier(value: unknown, label: string): string {
  return text(value, label, 256);
}
