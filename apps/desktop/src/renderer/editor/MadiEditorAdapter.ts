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

/**
 * The rest of madi may only depend on this interface. Typie crate/WASM types
 * belong behind the adapter implementation.
 */
export interface MadiEditorAdapter {
  open(snapshot?: Uint8Array): Promise<void>;
  getSnapshot(): Promise<Uint8Array>;
  getPlainText(): Promise<string>;
  focus(): void;
  undo(): void;
  redo(): void;
  insertSceneBreak(): void;
  onChanged(listener: (change: EditorChange) => void): () => void;
}

export type MadiEditorAdapterFactory = (
  mountElement: HTMLElement
) => Promise<MadiEditorAdapter>;
