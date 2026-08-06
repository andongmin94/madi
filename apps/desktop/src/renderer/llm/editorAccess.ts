import type {
  EditorChange,
  MadiEditorAdapter,
  MadiEditorAdapterFactory
} from "../editor/MadiEditorAdapter";

export interface ActiveLlmEditorDocument {
  readonly plainText: string;
  readonly revision: number;
  readonly isComposing: boolean;
}

export class LlmEditorAccess {
  private adapter: MadiEditorAdapter | null = null;
  private unsubscribe: (() => void) | null = null;
  private revision = 0;
  private isComposing = false;

  attach(adapter: MadiEditorAdapter): void {
    this.unsubscribe?.();
    this.adapter = adapter;
    this.revision = 0;
    this.isComposing = false;
    this.unsubscribe = adapter.onChanged((change: EditorChange) => {
      this.revision = change.revision;
      this.isComposing = change.isComposing;
    });
  }

  async readCurrentDocument(): Promise<ActiveLlmEditorDocument> {
    const adapter = this.adapter;
    if (!adapter) {
      throw new Error("편집기가 아직 준비되지 않았습니다.");
    }
    if (this.isComposing) {
      throw new Error("한글 조합이 끝난 뒤 다시 시도하세요.");
    }
    const plainText = await adapter.getPlainText();
    return {
      plainText,
      revision: this.revision,
      isComposing: this.isComposing
    };
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.adapter = null;
    this.revision = 0;
    this.isComposing = false;
  }
}

export function createLlmTrackedEditorFactory(
  baseFactory: MadiEditorAdapterFactory,
  access: LlmEditorAccess
): MadiEditorAdapterFactory {
  return async (mountElement) => {
    const adapter = await baseFactory(mountElement);
    access.attach(adapter);
    return adapter;
  };
}
