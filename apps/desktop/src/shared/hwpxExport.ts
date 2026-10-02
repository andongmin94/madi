import type { PublicationScopeKind } from "./publication";
import type { PublicationExportMetadata } from "./epubExport";

export const HWPX_EXPORT_PRESET_FORMAT = "MADI_EXPORT_PRESET" as const;
export const HWPX_EXPORT_PRESET_VERSION = 1 as const;

export type HwpxPageSizeToken = "A4" | "LETTER" | "CUSTOM";
export type HwpxOrientation = "PORTRAIT" | "LANDSCAPE";
export type HwpxLineSpacingMode = "PERCENT" | "FIXED_PT";
export type HwpxTextAlign = "LEFT" | "CENTER" | "RIGHT" | "JUSTIFY";
export type HwpxPageNumberPosition =
  | "BOTTOM_LEFT"
  | "BOTTOM_CENTER"
  | "BOTTOM_RIGHT";
export type HwpxSceneBreakToken = "ORNAMENT" | "RULE" | "SPACE";
export type HwpxSectionSplitMode = "SINGLE" | "VOLUME";

export interface HwpxHeadingStyleConfig {
  readonly fontFamilyToken: string;
  readonly fontSizePt: number;
  readonly bold: boolean;
  readonly alignment: HwpxTextAlign;
  readonly spacingBefore: number;
  readonly spacingAfter: number;
  readonly pageBreakBefore: boolean;
}

export interface HwpxExportPresetConfig {
  readonly formatVersion: typeof HWPX_EXPORT_PRESET_VERSION;
  readonly pageSizeToken: HwpxPageSizeToken;
  readonly customPageWidth: number | null;
  readonly customPageHeight: number | null;
  readonly orientation: HwpxOrientation;
  readonly marginTop: number;
  readonly marginBottom: number;
  readonly marginLeft: number;
  readonly marginRight: number;
  readonly headerMargin: number;
  readonly footerMargin: number;
  readonly gutter: number;
  readonly fontFamilyToken: string;
  readonly fontSizePt: number;
  readonly lineSpacingMode: HwpxLineSpacingMode;
  readonly lineSpacingValue: number;
  readonly firstLineIndent: number;
  readonly paragraphSpacingBefore: number;
  readonly paragraphSpacingAfter: number;
  readonly textAlign: HwpxTextAlign;
  readonly workTitleStyle: HwpxHeadingStyleConfig;
  readonly volumeTitleStyle: HwpxHeadingStyleConfig;
  readonly chapterTitleStyle: HwpxHeadingStyleConfig;
  readonly sceneTitleStyle: HwpxHeadingStyleConfig;
  readonly includeTitlePage: boolean;
  readonly includeWorkTitle: boolean;
  readonly includeVolumeTitles: boolean;
  readonly includeChapterTitles: boolean;
  readonly includeSceneTitles: boolean;
  readonly sectionSplitMode: HwpxSectionSplitMode;
  readonly includePageNumber: boolean;
  readonly pageNumberStart: number;
  readonly pageNumberPosition: HwpxPageNumberPosition;
  readonly includeHeader: boolean;
  readonly headerText: string;
  readonly includeFooter: boolean;
  readonly footerText: string;
  readonly sceneBreakToken: HwpxSceneBreakToken;
}

export interface HwpxExportPresetRecord {
  readonly id: string;
  readonly projectId: string;
  readonly kind: "HWPX";
  readonly name: string;
  readonly presetFormat: typeof HWPX_EXPORT_PRESET_FORMAT;
  readonly presetVersion: typeof HWPX_EXPORT_PRESET_VERSION;
  readonly config: HwpxExportPresetConfig;
  readonly contentHash: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface HwpxExportState {
  readonly metadata: PublicationExportMetadata;
  readonly presets: readonly HwpxExportPresetRecord[];
  readonly duplicatePresetNames: readonly string[];
  readonly revision: number;
}

export interface CreateHwpxExportPresetRequest {
  readonly sessionId: string;
  readonly name: string;
  readonly config: HwpxExportPresetConfig;
}

export interface UpdateHwpxExportPresetRequest {
  readonly sessionId: string;
  readonly presetId: string;
  readonly name: string;
  readonly config: HwpxExportPresetConfig;
  readonly expectedPresetRevision: number;
}

export interface DuplicateHwpxExportPresetRequest {
  readonly sessionId: string;
  readonly sourcePresetId: string;
  readonly name?: string;
}

export interface DeleteHwpxExportPresetRequest {
  readonly sessionId: string;
  readonly presetId: string;
  readonly expectedPresetRevision: number;
}

export interface HwpxExportPresetMutationResult {
  readonly preset: HwpxExportPresetRecord;
  readonly revision: number;
  readonly noOp: boolean;
}

export interface DeleteHwpxExportPresetResult {
  readonly deletedPresetId: string;
  readonly revision: number;
}

export interface ChooseHwpxOutputRequest {
  readonly sessionId: string;
  readonly suggestedFileName: string;
}

/** Opaque main-process selection; the renderer never receives an absolute path. */
export interface HwpxOutputSelection {
  readonly selectionId: string;
  readonly fileName: string;
}

export type HwpxValidationSeverity = "FATAL" | "ERROR" | "WARNING" | "INFO";

export interface HwpxValidationMessage {
  readonly severity: HwpxValidationSeverity;
  readonly code: string;
  readonly description: string;
  readonly suggestion: string | null;
  readonly sourceNodeId: string | null;
  readonly sectionId: string | null;
  readonly hwpxPath: string | null;
}

export interface HwpxValidationReport {
  readonly status: "VALID" | "INVALID" | "CANCELLED";
  readonly fatalCount: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly messages: readonly HwpxValidationMessage[];
}

export interface HwpxCoverage {
  /** Physical Contents/sectionN.xml entry count. */
  readonly packageSectionCount: number;
  readonly sourceSectionCount: number;
  readonly exportedSectionCount: number;
  readonly sourceBlockCount: number;
  readonly exportedBlockCount: number;
  readonly fallbackBlockCount: number;
  /** Heading blocks intentionally omitted by include* preset switches. */
  readonly configuredOmissionBlockCount: number;
  readonly rejectedBlockCount: number;
  readonly sourceCharacterCount: number;
  readonly exportedCharacterCount: number;
  readonly paragraphCount: number;
  readonly runCount: number;
  readonly headingCount: number;
  readonly sceneBreakCount: number;
  readonly rubyCount: number;
  readonly inlineModifierCount: number;
}

export interface HwpxExportTiming {
  readonly publicationIrCompileMs: number;
  readonly semanticMappingMs: number;
  readonly styleTableMs: number;
  readonly sectionXmlMs: number;
  readonly packageDocumentsMs: number;
  readonly zipPackagingMs: number;
  readonly zipReopenMs: number;
  readonly internalValidationMs: number;
  readonly sourceCoverageMs: number;
  readonly exporterTotalMs: number;
  readonly totalMs: number;
}

export interface HwpxReportPageConfig {
  readonly pageSizeToken: HwpxPageSizeToken;
  readonly customPageWidth: number | null;
  readonly customPageHeight: number | null;
  readonly orientation: HwpxOrientation;
  readonly marginTop: number;
  readonly marginBottom: number;
  readonly marginLeft: number;
  readonly marginRight: number;
  readonly headerMargin: number;
  readonly footerMargin: number;
  readonly gutter: number;
  readonly includeTitlePage: boolean;
  readonly includePageNumber: boolean;
  readonly pageNumberStart: number;
  readonly pageNumberPosition: HwpxPageNumberPosition;
  readonly includeHeader: boolean;
  readonly headerHasText: boolean;
  readonly includeFooter: boolean;
  readonly footerHasText: boolean;
}

export interface HwpxExportReport {
  readonly formatVersion: 1;
  readonly outputType: "HWPX";
  readonly packageProfile: "HANCOM_OFFICIAL_MODEL_1_31";
  readonly sourceScope: PublicationScopeKind;
  readonly sourceScopeNodeId: string;
  readonly sourceProjectRevision: number;
  readonly sourcePublicationHash: string;
  readonly presetId: string;
  readonly presetContentHash: string;
  readonly hwpxSha256: string | null;
  readonly outputSha256: string | null;
  readonly logicalPackageHash: string;
  readonly byteLength: number | null;
  readonly coverage: HwpxCoverage;
  readonly validation: HwpxValidationReport;
  readonly fontFamily: string;
  readonly fontInstalled: boolean | null;
  readonly page: HwpxReportPageConfig;
  readonly timing: HwpxExportTiming;
  readonly generatedAt: string;
  readonly madiVersion: string;
}

export type HwpxExportStage =
  | "PUBLICATION_COMPILE"
  | "STYLE_TABLE"
  | "SECTION_XML"
  | "HWPX_PACKAGE"
  | "INTERNAL_VALIDATION"
  | "FINALIZE";

export interface HwpxExportProgress {
  readonly operationId: string;
  readonly stage: HwpxExportStage;
  readonly completed: number;
  readonly total: number;
}

export interface HwpxTitlePageInput {
  readonly subtitle: string | null;
  readonly genre: string | null;
  readonly contact: string | null;
}

export interface ValidateHwpxExportRequest {
  readonly sessionId: string;
  readonly operationId: string;
  readonly scopeNodeId: string;
  readonly scopeKind: PublicationScopeKind;
  readonly expectedProjectRevision: number;
  readonly presetId: string;
  readonly presetContentHash: string;
  readonly metadata: PublicationExportMetadata;
  readonly config: HwpxExportPresetConfig;
  readonly titlePage: HwpxTitlePageInput;
}

export interface ValidateHwpxExportResult {
  readonly operationId: string;
  readonly sourcePublicationHash: string;
  readonly report: HwpxExportReport;
  readonly revision: number;
}

export interface RunHwpxExportRequest extends ValidateHwpxExportRequest {
  readonly outputSelectionId: string;
}

export type RunHwpxExportResult =
  | {
      readonly status: "COMPLETED";
      readonly operationId: string;
      readonly fileName: string;
      readonly byteLength: number;
      readonly sha256: string;
      readonly report: HwpxExportReport;
      readonly revision: number;
    }
  | { readonly status: "CANCELLED"; readonly operationId: string }
  | {
      readonly status: "FAILED";
      readonly operationId: string;
      readonly code: "DESTINATION_CHANGED";
    }
  | {
      readonly status: "FAILED";
      readonly operationId: string;
      readonly code: "RECOVERY_REQUIRED";
      readonly recoveryFileName: string | null;
    };

export interface CancelHwpxExportRequest {
  readonly sessionId: string;
  readonly operationId: string;
}

export interface SaveHwpxExportReportRequest {
  readonly sessionId: string;
  readonly operationId: string;
  readonly format: "JSON" | "MARKDOWN";
}

export interface SaveHwpxExportReportResult {
  readonly fileName: string;
  readonly byteLength: number;
}

export interface RevealHwpxExportRequest {
  readonly sessionId: string;
  readonly operationId: string;
}

export interface HwpxScopeChoice {
  readonly id: string;
  readonly kind: PublicationScopeKind;
  readonly title: string;
}
