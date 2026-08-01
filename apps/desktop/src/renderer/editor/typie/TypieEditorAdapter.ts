import type {
  EditorChange,
  EditorChangeReason,
  MadiEditorAdapter
} from "../MadiEditorAdapter";

/**
 * This is the only port the eventual generated Typie WASM bindings must
 * implement. It intentionally avoids exporting any Typie-specific type.
 */
export interface TypieEnginePort {
  mount(element: HTMLElement): Promise<void>;
  createEmptyDocument(): Promise<void>;
  restoreSnapshot(snapshot: Uint8Array): Promise<void>;
  exportSnapshot(): Promise<Uint8Array>;
  exportPlainText(): Promise<string>;
  focus(): void;
  undo(): void;
  redo(): void;
  insertSemanticSceneBreak(): void;
  onTransaction(listener: (event: TypieTransactionEvent) => void): () => void;
}

export interface TypieTransactionEvent {
  readonly revision: number;
  readonly origin:
    | "input"
    | "history"
    | "scene-break"
    | "composition-state"
    | "restore";
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly isComposing: boolean;
}

function toReason(origin: TypieTransactionEvent["origin"]): EditorChangeReason {
  switch (origin) {
    case "history":
      return "history";
    case "scene-break":
      return "scene-break";
    case "composition-state":
      return "composition-state";
    case "restore":
      return "restore";
    case "input":
      return "content";
  }
}

export class TypieEditorAdapter implements MadiEditorAdapter {
  private readonly listeners = new Set<(change: EditorChange) => void>();
  private mounted = false;
  private opened = false;

  public constructor(
    private readonly port: TypieEnginePort,
    private readonly mountElement: HTMLElement
  ) {
    this.port.onTransaction((event) => {
      const change: EditorChange = {
        revision: event.revision,
        reason: toReason(event.origin),
        canUndo: event.canUndo,
        canRedo: event.canRedo,
        isComposing: event.isComposing
      };
      for (const listener of this.listeners) {
        listener(change);
      }
    });
  }

  public async open(snapshot?: Uint8Array): Promise<void> {
    if (!this.mounted) {
      await this.port.mount(this.mountElement);
      this.mounted = true;
    }

    if (snapshot === undefined) {
      await this.port.createEmptyDocument();
    } else {
      await this.port.restoreSnapshot(Uint8Array.from(snapshot));
    }
    this.opened = true;
  }

  public async getSnapshot(): Promise<Uint8Array> {
    this.requireOpen();
    return Uint8Array.from(await this.port.exportSnapshot());
  }

  public async getPlainText(): Promise<string> {
    this.requireOpen();
    return this.port.exportPlainText();
  }

  public focus(): void {
    this.requireOpen();
    this.port.focus();
  }

  public undo(): void {
    this.requireOpen();
    this.port.undo();
  }

  public redo(): void {
    this.requireOpen();
    this.port.redo();
  }

  public insertSceneBreak(): void {
    this.requireOpen();
    this.port.insertSemanticSceneBreak();
  }

  public onChanged(listener: (change: EditorChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private requireOpen(): void {
    if (!this.opened) {
      throw new Error("Typie editor is not open");
    }
  }
}
