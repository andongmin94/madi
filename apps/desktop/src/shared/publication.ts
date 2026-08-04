export const PUBLICATION_DOCUMENT_FORMAT_VERSION = 1 as const;
export const READER_PRESET_FORMAT = "MADI_READER_PRESET" as const;
export const READER_PRESET_VERSION = 1 as const;

export type PublicationScopeKind = "WORK" | "VOLUME" | "CHAPTER" | "SCENE";

export interface PublicationSourceReference {
  readonly sourceNodeId: string;
  readonly sceneNodeId: string;
  readonly documentId: string;
  readonly blockId: string;
  readonly start: number | null;
  readonly end: number | null;
  readonly rangeVerified: boolean;
}

export type PublicationInline =
  | { readonly kind: "TEXT"; readonly text: string }
  | { readonly kind: "STRONG"; readonly children: readonly PublicationInline[] }
  | {
      readonly kind: "EMPHASIS";
      readonly children: readonly PublicationInline[];
    }
  | {
      readonly kind: "UNDERLINE";
      readonly children: readonly PublicationInline[];
    }
  | { readonly kind: "STRIKE"; readonly children: readonly PublicationInline[] }
  | {
      readonly kind: "RUBY";
      readonly annotation: string;
      readonly children: readonly PublicationInline[];
    };

export type PublicationBlock =
  | {
      readonly kind: "HEADING";
      readonly id: string;
      readonly level: 1 | 2 | 3 | 4;
      readonly text: string;
      readonly source: PublicationSourceReference;
    }
  | {
      readonly kind: "PARAGRAPH";
      readonly id: string;
      readonly inlines: readonly PublicationInline[];
      readonly source: PublicationSourceReference;
    }
  | {
      readonly kind: "SCENE_BREAK";
      readonly id: string;
      readonly source: PublicationSourceReference;
    }
  | {
      readonly kind: "QUOTE";
      readonly id: string;
      readonly inlines: readonly PublicationInline[];
      readonly source: PublicationSourceReference;
    }
  | {
      readonly kind: "UNSUPPORTED";
      readonly id: string;
      readonly nodeType: string;
      readonly text: string;
      readonly source: PublicationSourceReference;
    };

export interface PublicationSection {
  readonly id: string;
  readonly sourceNodeId: string;
  readonly kind: "SCENE";
  readonly title: string;
  readonly parentTitles: readonly string[];
  readonly blocks: readonly PublicationBlock[];
}

export interface PublicationMetadata {
  readonly title: string;
  readonly authorName: string | null;
  readonly language: "ko";
}

export interface PublicationSourceStatistics {
  readonly withSpaces: number;
  readonly withoutSpaces: number;
  readonly paragraphCount: number;
  readonly sceneCount: number;
  readonly chapterCount: number;
}

export interface PublicationDocument {
  readonly formatVersion: typeof PUBLICATION_DOCUMENT_FORMAT_VERSION;
  readonly projectId: string;
  readonly projectRevision: number;
  readonly scopeNodeId: string;
  readonly scopeKind: PublicationScopeKind;
  readonly metadata: PublicationMetadata;
  readonly sections: readonly PublicationSection[];
  readonly stats: PublicationSourceStatistics;
}

export type PublicationDiagnosticSeverity = "INFO" | "WARNING" | "ERROR";
export type PublicationDiagnosticCode =
  | "UNSUPPORTED_BLOCK"
  | "UNSUPPORTED_INLINE_MODIFIER"
  | "INVALID_SEMANTIC_DOCUMENT"
  | "EMPTY_SCOPE";

export interface PublicationDiagnostic {
  readonly code: PublicationDiagnosticCode;
  readonly severity: PublicationDiagnosticSeverity;
  readonly sceneNodeId: string | null;
  readonly documentId: string | null;
  readonly blockId: string | null;
}

export interface CompilePublicationRequest {
  readonly sessionId: string;
  readonly scopeNodeId: string;
  readonly expectedProjectRevision: number;
}

export interface CompilePublicationResult {
  readonly document: PublicationDocument;
  readonly contentHash: string;
  readonly diagnostics: readonly PublicationDiagnostic[];
  readonly compileTimingMs: number;
  readonly revision: number;
}

export interface PublicationStatsResult {
  readonly stats: PublicationSourceStatistics;
  readonly contentHash: string;
  readonly diagnostics: readonly PublicationDiagnostic[];
  readonly compileTimingMs: number;
  readonly revision: number;
}

export interface ValidatePublicationRequest {
  readonly document: PublicationDocument;
}

export interface ValidatePublicationResult {
  readonly valid: boolean;
  readonly contentHash: string;
  readonly diagnostics: readonly PublicationDiagnostic[];
}

export type ReaderDeviceCategory = "PHONE" | "TABLET" | "DESKTOP";
export type ReaderTheme = "LIGHT" | "SEPIA" | "DARK" | "CUSTOM";
export type ReaderTextAlign = "LEFT" | "JUSTIFY";
export type ReaderScrollMode = "CONTINUOUS";
export type ReaderVerificationStatus =
  | "GENERIC"
  | "UNVERIFIED_SIMULATION"
  | "USER_DEFINED";
export type ReaderFontToken =
  | "SYSTEM_SANS"
  | "SYSTEM_SERIF"
  | "KOREAN_SANS"
  | "KOREAN_SERIF";
export type ReaderSupportedControl =
  | "TYPOGRAPHY"
  | "SPACING"
  | "VIEWPORT"
  | "THEME";

export interface PlatformProfile {
  readonly id: string;
  readonly name: string;
  readonly version: 1;
  readonly family: "GENERIC" | "PLATFORM_LIKE";
  readonly verificationStatus: ReaderVerificationStatus;
  readonly verifiedAt: string | null;
  readonly supportedControls: readonly ReaderSupportedControl[];
}

export interface DeviceProfile {
  readonly id: string;
  readonly name: string;
  readonly category: ReaderDeviceCategory;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly safeAreaTop: number;
  readonly safeAreaBottom: number;
  readonly readerChromeHeight: number;
  readonly pixelRatio: number;
}

export interface ReaderSettings {
  readonly fontFamilyToken: ReaderFontToken;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly paragraphSpacing: number;
  readonly firstLineIndent: number;
  readonly horizontalPadding: number;
  readonly verticalPadding: number;
  readonly textAlign: ReaderTextAlign;
  readonly theme: ReaderTheme;
  readonly backgroundColor: string;
  readonly textColor: string;
  readonly scrollMode: ReaderScrollMode;
  readonly showChapterTitle: boolean;
  readonly showSceneTitle: boolean;
  readonly showSceneBreak: boolean;
}

export interface WorkStyle {
  readonly bodyStyleToken: "PROSE";
  readonly chapterTitleStyleToken: "CHAPTER_DEFAULT" | "CHAPTER_COMPACT";
  readonly sceneTitleStyleToken: "SCENE_DEFAULT" | "SCENE_HIDDEN";
  readonly sceneBreakStyleToken: "DIAMONDS" | "RULE" | "SPACE" | "HIDDEN";
}

export interface ReaderRenderConfig {
  readonly formatVersion: typeof READER_PRESET_VERSION;
  readonly platform: PlatformProfile;
  readonly device: DeviceProfile;
  readonly settings: ReaderSettings;
  readonly workStyle: WorkStyle;
}

export type ReaderPresetSourceKind =
  | "BUILTIN_TEMPLATE"
  | "CUSTOM"
  | "DUPLICATED"
  | "IMPORTED";

export interface ReaderPresetRecord {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly sourceKind: ReaderPresetSourceKind;
  readonly sourceId: string | null;
  readonly sourceVersion: string | null;
  readonly verificationStatus: ReaderVerificationStatus;
  readonly presetFormat: typeof READER_PRESET_FORMAT;
  readonly presetVersion: typeof READER_PRESET_VERSION;
  readonly config: ReaderRenderConfig;
  readonly contentHash: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ListReaderPresetsRequest {
  readonly sessionId: string;
}

export interface ListReaderPresetsResult {
  readonly presets: readonly ReaderPresetRecord[];
  readonly duplicateNames: readonly string[];
  readonly revision: number;
}

export interface CreateReaderPresetRequest {
  readonly sessionId: string;
  readonly name: string;
  readonly sourceKind: ReaderPresetSourceKind;
  readonly sourceId?: string | null;
  readonly sourceVersion?: string | null;
  readonly verificationStatus: ReaderVerificationStatus;
  readonly config: ReaderRenderConfig;
}

export interface UpdateReaderPresetRequest {
  readonly sessionId: string;
  readonly presetId: string;
  readonly name: string;
  readonly verificationStatus: ReaderVerificationStatus;
  readonly config: ReaderRenderConfig;
  readonly expectedPresetRevision: number;
}

export interface DuplicateReaderPresetRequest {
  readonly sessionId: string;
  readonly sourcePresetId: string;
  readonly name?: string;
}

export interface DeleteReaderPresetRequest {
  readonly sessionId: string;
  readonly presetId: string;
  readonly expectedPresetRevision: number;
}

export interface ReaderPresetMutationResult {
  readonly preset: ReaderPresetRecord;
  readonly revision: number;
  readonly noOp: boolean;
}

export interface DeleteReaderPresetResult {
  readonly deletedPresetId: string;
  readonly revision: number;
}

export interface ReaderPaneUiState {
  readonly presetId: string | null;
  readonly deviceProfileId: string;
  readonly overrides: ReaderPaneOverrides;
  readonly zoom: number;
  readonly scrollProgress: number;
}

export type ReaderPaneCount = 1 | 2 | 3;

export interface ReaderPaneOverrides {
  readonly deviceCategory?: ReaderDeviceCategory;
  readonly viewportWidth?: number;
  readonly viewportHeight?: number;
  readonly readerSettings?: Partial<ReaderSettings>;
  readonly sceneBreakStyleToken?: WorkStyle["sceneBreakStyleToken"];
}

export interface ReaderLabUiState {
  readonly lastScopeNodeId: string | null;
  readonly paneCount: ReaderPaneCount;
  readonly panes: readonly ReaderPaneUiState[];
  readonly scrollSync: boolean;
  readonly leftPanelWidth: number;
  readonly rightPanelWidth: number;
  readonly selectedSourceBlockId: string | null;
  readonly diagnosticsExpanded: boolean;
}

export interface SaveReaderLabUiStateRequest {
  readonly sessionId: string;
  readonly state: ReaderLabUiState;
}

export interface LoadReaderLabUiStateResult {
  readonly state: ReaderLabUiState | null;
}
