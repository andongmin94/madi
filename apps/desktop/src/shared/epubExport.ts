import type { PublicationScopeKind } from "./publication";

export const EPUB_EXPORT_PRESET_FORMAT = "MADI_EXPORT_PRESET" as const;
export const EPUB_EXPORT_PRESET_VERSION = 1 as const;

export const EPUB_RECOVERY_PRESERVED_ERROR =
  "EPUB_RECOVERY_DIRECTORY_PRESERVED";

export type EpubTargetProfile =
  | "EPUB_3_4_DRAFT_2026_08"
  | "EPUB_3_3_COMPATIBILITY";
export type EpubSplitMode = "CHAPTER" | "SCENE";
export type EpubSceneBreakStyleToken = "ORNAMENT" | "RULE" | "SPACE";
export type EpubBodyStyleToken =
  | "REFLOWABLE_PROSE"
  | "INDENTED_PROSE"
  | "SPACED_PROSE";
export type EpubStylesheetToken =
  | "MADI_CLASSIC"
  | "MADI_MODERN"
  | "MADI_MINIMAL";

export interface EpubExportPresetConfig {
  readonly formatVersion: typeof EPUB_EXPORT_PRESET_VERSION;
  readonly targetProfile: EpubTargetProfile;
  readonly splitMode: EpubSplitMode;
  readonly tocDepth: 1 | 2 | 3 | 4;
  readonly includeChapterTitles: boolean;
  readonly includeSceneTitles: boolean;
  readonly sceneBreakStyleToken: EpubSceneBreakStyleToken;
  readonly bodyStyleToken: EpubBodyStyleToken;
  readonly includeCover: boolean;
  readonly stylesheetToken: EpubStylesheetToken;
}

export interface PublicationExportMetadata {
  readonly projectId: string;
  readonly publicationTitle: string;
  readonly creatorName: string;
  readonly language: string;
  readonly identifier: string;
  readonly publisher: string | null;
  readonly description: string | null;
  readonly rights: string | null;
  readonly subjects: readonly string[];
  readonly coverAssetId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PublicationCoverAsset {
  readonly id: string;
  readonly projectId: string;
  readonly kind: "COVER";
  readonly mediaType: "image/jpeg" | "image/png";
  readonly originalName: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EpubExportPresetRecord {
  readonly id: string;
  readonly projectId: string;
  readonly kind: "EPUB";
  readonly name: string;
  readonly presetFormat: typeof EPUB_EXPORT_PRESET_FORMAT;
  readonly presetVersion: typeof EPUB_EXPORT_PRESET_VERSION;
  readonly config: EpubExportPresetConfig;
  readonly contentHash: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PublicationExportState {
  readonly metadata: PublicationExportMetadata;
  readonly cover: PublicationCoverAsset | null;
  readonly presets: readonly EpubExportPresetRecord[];
  readonly duplicatePresetNames: readonly string[];
  readonly revision: number;
}

export interface UpdatePublicationMetadataRequest {
  readonly sessionId: string;
  readonly publicationTitle: string;
  readonly creatorName: string;
  readonly language: string;
  readonly identifier: string;
  readonly publisher: string | null;
  readonly description: string | null;
  readonly rights: string | null;
  readonly subjects: readonly string[];
}

export interface PublicationMetadataMutationResult {
  readonly metadata: PublicationExportMetadata;
  readonly revision: number;
  readonly noOp: boolean;
}

export interface ChoosePublicationCoverRequest {
  readonly sessionId: string;
}

export interface PublicationCoverMutationResult {
  readonly cover: PublicationCoverAsset | null;
  readonly metadata: PublicationExportMetadata;
  readonly revision: number;
  readonly noOp: boolean;
}

export interface CreateEpubExportPresetRequest {
  readonly sessionId: string;
  readonly name: string;
  readonly config: EpubExportPresetConfig;
}

export interface UpdateEpubExportPresetRequest {
  readonly sessionId: string;
  readonly presetId: string;
  readonly name: string;
  readonly config: EpubExportPresetConfig;
  readonly expectedPresetRevision: number;
}

export interface DuplicateEpubExportPresetRequest {
  readonly sessionId: string;
  readonly sourcePresetId: string;
  readonly name?: string;
}

export interface DeleteEpubExportPresetRequest {
  readonly sessionId: string;
  readonly presetId: string;
  readonly expectedPresetRevision: number;
}

export interface EpubExportPresetMutationResult {
  readonly preset: EpubExportPresetRecord;
  readonly revision: number;
  readonly noOp: boolean;
}

export interface DeleteEpubExportPresetResult {
  readonly deletedPresetId: string;
  readonly revision: number;
}

export interface ChooseEpubOutputRequest {
  readonly sessionId: string;
  readonly suggestedFileName: string;
}

/** Opaque main-process selection; the renderer never receives an absolute path. */
export interface EpubOutputSelection {
  readonly selectionId: string;
  readonly fileName: string;
}

export type EpubValidationSeverity = "FATAL" | "ERROR" | "WARNING" | "INFO";

export interface EpubValidationMessage {
  readonly severity: EpubValidationSeverity;
  readonly code: string;
  readonly description: string;
  readonly suggestion: string | null;
  readonly sourceNodeId: string | null;
  readonly sectionId: string | null;
  readonly epubPath: string | null;
}

export type EpubValidationStatus = "VALID" | "INVALID" | "CANCELLED";

export interface EpubValidationReport {
  readonly status: EpubValidationStatus;
  readonly fatalCount: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly messages: readonly EpubValidationMessage[];
  readonly epubCheck: {
    readonly status: "NOT_RUN" | "VALID" | "INVALID" | "UNAVAILABLE";
    readonly version: "5.3.0" | null;
    readonly compatibilityOnly: boolean;
  };
}

export interface EpubCoverage {
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
}

export interface EpubExportTiming {
  readonly splitMs: number;
  readonly xhtmlMs: number;
  readonly navigationMs: number;
  readonly packageMs: number;
  readonly internalValidationMs: number;
  readonly epubCheckMs: number | null;
  readonly totalMs: number;
}

export interface EpubExportReport {
  readonly formatVersion: 1;
  readonly targetProfile: EpubTargetProfile;
  readonly sourceProjectRevision: number;
  readonly sourcePublicationHash: string;
  readonly epubSha256: string | null;
  readonly logicalPackageHash: string;
  readonly byteLength: number | null;
  readonly fileCount: number;
  readonly xhtmlCount: number;
  readonly coverage: EpubCoverage;
  readonly coverIncluded: boolean;
  readonly validation: EpubValidationReport;
  readonly timing: EpubExportTiming;
  readonly generatedAt: string;
  readonly madiVersion: string;
}

export type EpubExportStage =
  | "PUBLICATION_COMPILE"
  | "XHTML_GENERATION"
  | "PACKAGE_GENERATION"
  | "INTERNAL_VALIDATION"
  | "EPUBCHECK"
  | "FINALIZE";

export interface EpubExportProgress {
  readonly operationId: string;
  readonly stage: EpubExportStage;
  readonly completed: number;
  readonly total: number;
}

export interface ValidateEpubExportRequest {
  readonly sessionId: string;
  readonly operationId: string;
  readonly scopeNodeId: string;
  readonly expectedProjectRevision: number;
  readonly metadata: PublicationExportMetadata;
  readonly config: EpubExportPresetConfig;
}

export interface ValidateEpubExportResult {
  readonly operationId: string;
  readonly sourcePublicationHash: string;
  readonly report: EpubExportReport;
  readonly revision: number;
}

export interface RunEpubExportRequest
  extends ValidateEpubExportRequest {
  readonly outputSelectionId: string;
}

export interface CompletedRunEpubExportResult {
  readonly status: "COMPLETED";
  readonly operationId: string;
  readonly fileName: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly report: EpubExportReport;
  readonly revision: number;
}

export interface CancelledRunEpubExportResult {
  readonly status: "CANCELLED";
  readonly operationId: string;
}

export interface FailedRunEpubExportResult {
  readonly status: "FAILED";
  readonly operationId: string;
  readonly code: "DESTINATION_CHANGED";
}

export type RunEpubExportResult =
  | CompletedRunEpubExportResult
  | CancelledRunEpubExportResult
  | FailedRunEpubExportResult;

export interface CancelEpubExportRequest {
  readonly sessionId: string;
  readonly operationId: string;
}

export interface SaveEpubExportReportRequest {
  readonly sessionId: string;
  readonly operationId: string;
  readonly format: "JSON" | "MARKDOWN";
}

export interface SaveEpubExportReportResult {
  readonly fileName: string;
  readonly byteLength: number;
}

export interface RevealEpubExportRequest {
  readonly sessionId: string;
  readonly operationId: string;
}

export interface EpubScopeChoice {
  readonly id: string;
  readonly kind: PublicationScopeKind;
  readonly title: string;
}
