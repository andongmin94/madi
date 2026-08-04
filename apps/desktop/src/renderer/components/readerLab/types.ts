import type { ProjectTree } from "../../../shared/contracts";
import type {
  CompilePublicationRequest,
  CompilePublicationResult,
  CreateReaderPresetRequest,
  DeleteReaderPresetRequest,
  DeleteReaderPresetResult,
  DuplicateReaderPresetRequest,
  ListReaderPresetsRequest,
  ListReaderPresetsResult,
  LoadReaderLabUiStateResult,
  PublicationSourceReference,
  ReaderLabUiState,
  ReaderPresetMutationResult,
  ReaderPresetRecord,
  UpdateReaderPresetRequest
} from "../../../shared/publication";

/** The narrow capability surface consumed by the lazy Reader Lab chunk. */
export interface ReaderLabApi {
  compilePublication(
    request: CompilePublicationRequest
  ): Promise<CompilePublicationResult>;
  listReaderPresets(
    request: ListReaderPresetsRequest
  ): Promise<ListReaderPresetsResult>;
  createReaderPreset(
    request: CreateReaderPresetRequest
  ): Promise<ReaderPresetMutationResult>;
  updateReaderPreset(
    request: UpdateReaderPresetRequest
  ): Promise<ReaderPresetMutationResult>;
  duplicateReaderPreset(
    request: DuplicateReaderPresetRequest
  ): Promise<ReaderPresetMutationResult>;
  deleteReaderPreset(
    request: DeleteReaderPresetRequest
  ): Promise<DeleteReaderPresetResult>;
  saveReaderLabUiState(request: {
    readonly sessionId: string;
    readonly state: ReaderLabUiState;
  }): Promise<void>;
  loadReaderLabUiState(request: {
    readonly sessionId: string;
  }): Promise<LoadReaderLabUiStateResult>;
}

export interface ReaderLabModeHandle {
  persistUiState(): Promise<void>;
  refresh(): Promise<void>;
}

export interface ReaderLabModeProps {
  readonly api: ReaderLabApi;
  readonly sessionId: string;
  readonly projectId: string;
  readonly projectRevision: number;
  /** Changes only when snapshot restore requires preset/UI-state revalidation. */
  readonly reloadToken: number;
  readonly projectTree: ProjectTree;
  readonly initialScopeNodeId: string | null;
  readonly activeSceneId: string | null;
  readonly interactionBlocked: boolean;
  /** Returns the authoritative project revision after flush, or null on failure. */
  readonly onBeforeCompile: () => Promise<number | null>;
  readonly onProjectRevision: (revision: number) => void;
  readonly onOpenSource: (
    source: PublicationSourceReference
  ) => void | Promise<void>;
}

/** Built-ins are renderer-owned immutable options; stored presets stay canonical. */
export interface ReaderPresetOption extends ReaderPresetRecord {
  readonly builtin: boolean;
  readonly duplicateName: boolean;
}

export interface ReaderRenderStatistics {
  readonly measurementStatus: "ESTIMATED" | "MEASURING" | "COMPLETE";
  readonly measuredSectionCount: number;
  readonly measuredBlockCount: number;
  readonly totalSectionCount: number;
  readonly renderedContentHeight: number;
  readonly viewportHeight: number;
  readonly estimatedScreenCount: number;
  readonly averageCharactersPerScreen: number;
  readonly longestParagraphLineCount: number;
  readonly paragraphsAtLeastEightLines: number;
  readonly consecutiveEmptyParagraphRuns: number;
  readonly horizontalOverflowCount: number;
}

export interface ReaderMeasuredBlockLayout {
  readonly blockId: string;
  readonly lineCount: number;
  readonly renderedHeight: number;
  readonly horizontalOverflow: boolean;
}

export type ReaderLayoutDiagnosticCode =
  | "LONG_PARAGRAPH"
  | "CONSECUTIVE_EMPTY_PARAGRAPHS"
  | "HORIZONTAL_OVERFLOW"
  | "PARAGRAPH_TALLER_THAN_VIEWPORT"
  | "CONSECUTIVE_SCENE_BREAKS"
  | "UNSUPPORTED_BLOCK";

export interface ReaderLayoutDiagnostic {
  readonly id: string;
  readonly code: ReaderLayoutDiagnosticCode;
  readonly message: string;
  readonly blockId: string;
  readonly source: PublicationSourceReference;
}
