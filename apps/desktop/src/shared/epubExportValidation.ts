import {
  EPUB_EXPORT_PRESET_VERSION,
  type EpubExportProgress,
  type EpubExportPresetConfig,
  type EpubExportReport,
  type PublicationExportMetadata,
  type RunEpubExportResult
} from "./epubExport";

const TARGET_PROFILES = new Set([
  "EPUB_3_4_DRAFT_2026_08",
  "EPUB_3_3_COMPATIBILITY"
]);
const SPLIT_MODES = new Set(["CHAPTER", "SCENE"]);
const SCENE_BREAK_STYLES = new Set(["ORNAMENT", "RULE", "SPACE"]);
const BODY_STYLES = new Set([
  "REFLOWABLE_PROSE",
  "INDENTED_PROSE",
  "SPACED_PROSE"
]);
const STYLESHEETS = new Set([
  "MADI_CLASSIC",
  "MADI_MODERN",
  "MADI_MINIMAL"
]);
const LANGUAGE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EXPORT_STAGES = new Set([
  "PUBLICATION_COMPILE",
  "XHTML_GENERATION",
  "PACKAGE_GENERATION",
  "INTERNAL_VALIDATION",
  "EPUBCHECK",
  "FINALIZE"
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
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
    throw new Error(`Invalid ${label} fields`);
  }
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
    (!allowEmpty && value.trim().length === 0) ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
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

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid ${label}`);
  }
  return value;
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

export function validateEpubExportPresetConfig(
  value: unknown
): EpubExportPresetConfig {
  const input = record(value, "EPUB export preset");
  exactKeys(
    input,
    [
      "formatVersion",
      "targetProfile",
      "splitMode",
      "tocDepth",
      "includeChapterTitles",
      "includeSceneTitles",
      "sceneBreakStyleToken",
      "bodyStyleToken",
      "includeCover",
      "stylesheetToken"
    ],
    "EPUB export preset"
  );
  if (input.formatVersion !== EPUB_EXPORT_PRESET_VERSION) {
    throw new Error("Unsupported EPUB export preset version");
  }
  if (
    !Number.isSafeInteger(input.tocDepth) ||
    (input.tocDepth as number) < 1 ||
    (input.tocDepth as number) > 4
  ) {
    throw new Error("Invalid EPUB TOC depth");
  }
  return {
    formatVersion: EPUB_EXPORT_PRESET_VERSION,
    targetProfile: enumValue(
      input.targetProfile,
      TARGET_PROFILES,
      "EPUB target profile"
    ),
    splitMode: enumValue(input.splitMode, SPLIT_MODES, "EPUB split mode"),
    tocDepth: input.tocDepth as 1 | 2 | 3 | 4,
    includeChapterTitles: boolean(
      input.includeChapterTitles,
      "include chapter titles"
    ),
    includeSceneTitles: boolean(
      input.includeSceneTitles,
      "include scene titles"
    ),
    sceneBreakStyleToken: enumValue(
      input.sceneBreakStyleToken,
      SCENE_BREAK_STYLES,
      "EPUB scene break style"
    ),
    bodyStyleToken: enumValue(
      input.bodyStyleToken,
      BODY_STYLES,
      "EPUB body style"
    ),
    includeCover: boolean(input.includeCover, "include cover"),
    stylesheetToken: enumValue(
      input.stylesheetToken,
      STYLESHEETS,
      "EPUB stylesheet"
    )
  };
}

export function validatePublicationMetadataInput(
  value: unknown
): Omit<
  PublicationExportMetadata,
  "projectId" | "coverAssetId" | "createdAt" | "updatedAt"
> {
  return validatePublicationMetadataFields(value, false);
}

export function validatePublicationMetadataStateInput(
  value: unknown
): Omit<
  PublicationExportMetadata,
  "projectId" | "coverAssetId" | "createdAt" | "updatedAt"
> {
  return validatePublicationMetadataFields(value, true);
}

function validatePublicationMetadataFields(
  value: unknown,
  allowEmptyCreator: boolean
): Omit<
  PublicationExportMetadata,
  "projectId" | "coverAssetId" | "createdAt" | "updatedAt"
> {
  const input = record(value, "publication metadata");
  exactKeys(
    input,
    [
      "publicationTitle",
      "creatorName",
      "language",
      "identifier",
      "publisher",
      "description",
      "rights",
      "subjects"
    ],
    "publication metadata"
  );
  const language = text(input.language, "publication language", 35);
  if (!LANGUAGE_PATTERN.test(language)) {
    throw new Error("Invalid publication language");
  }
  if (!Array.isArray(input.subjects) || input.subjects.length > 64) {
    throw new Error("Invalid publication subjects");
  }
  const subjects = input.subjects.map((subject) =>
    text(subject, "publication subject", 500)
  );
  if (new Set(subjects).size !== subjects.length) {
    throw new Error("Duplicate publication subject");
  }
  return {
    publicationTitle: text(input.publicationTitle, "publication title", 1_000),
    creatorName: text(
      input.creatorName,
      "publication creator",
      500,
      allowEmptyCreator
    ),
    language,
    identifier: text(input.identifier, "publication identifier", 1_000),
    publisher: nullableText(input.publisher, "publication publisher", 1_000),
    description: nullableText(
      input.description,
      "publication description",
      20_000
    ),
    rights: nullableText(input.rights, "publication rights", 10_000),
    subjects
  };
}

export function validateEpubOperationId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error("Invalid EPUB export operation id");
  }
  return value.toLowerCase();
}

export function validateEpubExportProgress(value: unknown): EpubExportProgress {
  const input = record(value, "EPUB export progress");
  exactKeys(
    input,
    ["operationId", "stage", "completed", "total"],
    "EPUB export progress"
  );
  const completed = input.completed;
  const total = input.total;
  if (
    !Number.isSafeInteger(completed) ||
    !Number.isSafeInteger(total) ||
    (completed as number) < 0 ||
    (total as number) < 1 ||
    (completed as number) > (total as number) ||
    (total as number) > 1_000_000
  ) {
    throw new Error("Invalid EPUB export progress values");
  }
  return {
    operationId: validateEpubOperationId(input.operationId),
    stage: enumValue(input.stage, EXPORT_STAGES, "EPUB export stage"),
    completed: completed as number,
    total: total as number
  };
}

export function validateRunEpubExportResult(
  value: unknown
): RunEpubExportResult {
  const input = record(value, "EPUB export result");
  if (input.status === "CANCELLED") {
    exactKeys(
      input,
      ["status", "operationId"],
      "cancelled EPUB export result"
    );
    return {
      status: "CANCELLED",
      operationId: validateEpubOperationId(input.operationId)
    };
  }
  if (input.status === "FAILED") {
    exactKeys(
      input,
      ["status", "operationId", "code"],
      "failed EPUB export result"
    );
    if (input.code !== "DESTINATION_CHANGED") {
      throw new Error("Invalid EPUB export failure code");
    }
    return {
      status: "FAILED",
      operationId: validateEpubOperationId(input.operationId),
      code: "DESTINATION_CHANGED"
    };
  }
  if (input.status !== "COMPLETED") {
    throw new Error("Invalid EPUB export result status");
  }
  exactKeys(
    input,
    [
      "status",
      "operationId",
      "fileName",
      "byteLength",
      "sha256",
      "report",
      "revision"
    ],
    "completed EPUB export result"
  );
  const fileName = text(input.fileName, "EPUB export file name", 1_000);
  if (
    /[\\/:]/u.test(fileName) ||
    !fileName.toLocaleLowerCase().endsWith(".epub")
  ) {
    throw new Error("Invalid EPUB export file name");
  }
  if (
    !Number.isSafeInteger(input.byteLength) ||
    (input.byteLength as number) < 1 ||
    (input.byteLength as number) > 512 * 1024 * 1024
  ) {
    throw new Error("Invalid EPUB export byte length");
  }
  if (
    typeof input.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(input.sha256)
  ) {
    throw new Error("Invalid EPUB export SHA-256");
  }
  if (
    !Number.isSafeInteger(input.revision) ||
    (input.revision as number) < 0
  ) {
    throw new Error("Invalid EPUB export revision");
  }
  const report = record(input.report, "EPUB export report");
  return {
    status: "COMPLETED",
    operationId: validateEpubOperationId(input.operationId),
    fileName,
    byteLength: input.byteLength as number,
    sha256: input.sha256,
    report: report as unknown as EpubExportReport,
    revision: input.revision as number
  };
}

export function validateEpubPresetName(value: unknown): string {
  return text(value, "EPUB export preset name", 500);
}

export function validateEpubIdentifier(value: unknown, label: string): string {
  return text(value, label, 256);
}
