export type EditorChangeReason =
  | "content"
  | "history"
  | "scene-break"
  | "composition-state"
  | "restore";

/**
 * Stable madi-owned identifier used by future Publication IR conversion.
 * The Typie implementation maps this identifier to its pinned semantic node
 * without exposing that engine-specific shape to the rest of the app.
 */
export const MADI_SCENE_BREAK_SEMANTIC_ID = "madi.scene-break.v1";

/**
 * Typie does not expose an authoritative canUndo/canRedo query at the pinned
 * commit. UI booleans are therefore recent-command heuristics, not a promise
 * that the complete engine history stack is available.
 */
export const MADI_HISTORY_STATE_CONTRACT = "recent-command-heuristic";

export interface EditorChange {
  readonly revision: number;
  readonly reason: EditorChangeReason;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly isComposing: boolean;
}

/** Unicode-scalar offsets over the annotated recovery-text view. */
export interface EditorTextSelection {
  readonly text: string;
  readonly start: number;
  readonly end: number;
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
   * Returns the current non-collapsed text selection as annotated recovery-text
   * scalar offsets. `null` means there is no safely mappable text selection.
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
  /**
   * Disables every user-driven editor mutation while madi temporarily uses the
   * one live engine for a project-wide atomic operation.
   */
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
