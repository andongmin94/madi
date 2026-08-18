export type EditorChangeReason =
  | "content"
  | "history"
  | "scene-break"
  | "composition-state"
  | "restore";

/**
 * Stable madi-owned identifier used by Publication IR conversion. The Typie
 * implementation maps this identifier to its pinned semantic node without
 * exposing an engine-specific type to the rest of the application.
 */
export const MADI_SCENE_BREAK_SEMANTIC_ID = "madi.scene-break.v1";

/**
 * Typie does not expose an authoritative canUndo/canRedo query at the pinned
 * commit. UI booleans are recent-command heuristics, not a promise that the
 * complete engine history stack is available.
 */
export const MADI_HISTORY_STATE_CONTRACT = "recent-command-heuristic";

export interface EditorChange {
  readonly revision: number;
  readonly reason: EditorChangeReason;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly isComposing: boolean;
}

/**
 * One non-collapsed selection mapped to annotated recovery-text Unicode-scalar
 * offsets. `blockKey` is an opaque same-document identity.
 */
export interface EditorTextSelection {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly blockKey: string;
}

export interface EditorTextReplacement {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly expectedText: string;
  readonly replacement: string;
}

export interface EditorReplacementDocument {
  readonly snapshot: Uint8Array;
  readonly plainTextRecovery: string;
  readonly semanticSceneBreakCount: number;
}

/**
 * The rest of madi may only depend on this interface. Typie crate/WASM types
 * belong behind the adapter implementation.
 */
export interface MadiEditorAdapter {
  open(snapshot?: Uint8Array): Promise<void>;
  getSnapshot(): Promise<Uint8Array>;
  getPlainText(): Promise<string>;
  /**
   * Returns an exact same-block text selection, or `null` when the current
   * selection cannot be mapped without ambiguity to annotated recovery text.
   */
  getTextSelection?(): EditorTextSelection | null;
  /** Moves the one live editor surface between workspace blocks. */
  relocate?(mountElement: HTMLElement): void;
  /**
   * Applies validated replacements to Typie's semantic document. Implementors
   * must restore the original document when any replacement or invariant fails.
   */
  replaceTextRanges?(
    replacements: readonly EditorTextReplacement[]
  ): Promise<EditorReplacementDocument>;
  /** Disables user-driven mutations during a guarded editor operation. */
  setInteractionEnabled?(enabled: boolean): void;
  /** Selects a range expressed in annotated recovery-text offsets. */
  revealTextRange?(
    start: number,
    end: number,
    options?: { readonly focus?: boolean }
  ): void;
  focus(): void;
  undo(): void;
  redo(): void;
  insertSceneBreak(): void;
  onChanged(listener: (change: EditorChange) => void): () => void;
}

export type MadiEditorAdapterFactory = (
  mountElement: HTMLElement
) => Promise<MadiEditorAdapter>;
