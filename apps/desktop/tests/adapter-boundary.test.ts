import { describe, expect, it, vi } from "vitest";
import {
  TypieEditorAdapter,
  type TypieEnginePort,
  type TypieTransactionEvent
} from "../src/renderer/editor/typie/TypieEditorAdapter";

function createPort() {
  let transactionListener:
    | ((event: TypieTransactionEvent) => void)
    | undefined;

  const port: TypieEnginePort = {
    mount: vi.fn(async () => undefined),
    createEmptyDocument: vi.fn(async () => undefined),
    restoreSnapshot: vi.fn(async () => undefined),
    exportSnapshot: vi.fn(async () => Uint8Array.from([9, 8, 7])),
    exportPlainText: vi.fn(async () => "복구용 본문"),
    setInteractionEnabled: vi.fn(),
    revealTextRange: vi.fn(),
    focus: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    insertSemanticSceneBreak: vi.fn(),
    onTransaction: vi.fn((listener) => {
      transactionListener = listener;
      return () => {
        transactionListener = undefined;
      };
    })
  };

  return {
    port,
    emit(event: TypieTransactionEvent) {
      transactionListener?.(event);
    }
  };
}

describe("MadiEditorAdapter boundary", () => {
  it("mounts once and moves snapshots through copies", async () => {
    const { port } = createPort();
    const mount = document.createElement("div");
    const adapter = new TypieEditorAdapter(port, mount);
    const original = Uint8Array.from([1, 2, 3]);

    await adapter.open(original);
    original[0] = 99;

    expect(port.mount).toHaveBeenCalledTimes(1);
    expect(port.mount).toHaveBeenCalledWith(mount);
    expect(port.restoreSnapshot).toHaveBeenCalledWith(
      Uint8Array.from([1, 2, 3])
    );

    await adapter.open();
    expect(port.mount).toHaveBeenCalledTimes(1);
    expect(port.createEmptyDocument).toHaveBeenCalledTimes(1);

    const snapshot = await adapter.getSnapshot();
    expect(snapshot).toEqual(Uint8Array.from([9, 8, 7]));
    expect(await adapter.getPlainText()).toBe("복구용 본문");
  });

  it("delegates editing commands and normalizes transaction events", async () => {
    const { port, emit } = createPort();
    const adapter = new TypieEditorAdapter(
      port,
      document.createElement("div")
    );
    await adapter.open();
    const changed = vi.fn();
    const unsubscribe = adapter.onChanged(changed);

    adapter.focus();
    adapter.setInteractionEnabled(false);
    adapter.setInteractionEnabled(true);
    adapter.revealTextRange(2, 4, { focus: false });
    adapter.undo();
    adapter.redo();
    adapter.insertSceneBreak();
    emit({
      revision: 4,
      origin: "scene-break",
      canUndo: true,
      canRedo: false,
      isComposing: false
    });

    expect(port.focus).toHaveBeenCalledTimes(1);
    expect(port.setInteractionEnabled).toHaveBeenNthCalledWith(1, false);
    expect(port.setInteractionEnabled).toHaveBeenNthCalledWith(2, true);
    expect(port.revealTextRange).toHaveBeenCalledWith(2, 4, {
      focus: false
    });
    expect(port.undo).toHaveBeenCalledTimes(1);
    expect(port.redo).toHaveBeenCalledTimes(1);
    expect(port.insertSemanticSceneBreak).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith({
      revision: 4,
      reason: "scene-break",
      canUndo: true,
      canRedo: false,
      isComposing: false
    });

    unsubscribe();
    emit({
      revision: 5,
      origin: "input",
      canUndo: true,
      canRedo: false,
      isComposing: true
    });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("forwards composition-only state events without disguising them as content", async () => {
    const { port, emit } = createPort();
    const adapter = new TypieEditorAdapter(
      port,
      document.createElement("div")
    );
    await adapter.open();
    const changed = vi.fn();
    adapter.onChanged(changed);

    emit({
      revision: 7,
      origin: "composition-state",
      canUndo: true,
      canRedo: false,
      isComposing: false
    });

    expect(changed).toHaveBeenCalledWith({
      revision: 7,
      reason: "composition-state",
      canUndo: true,
      canRedo: false,
      isComposing: false
    });
  });

  it("cannot be used before a document is opened", async () => {
    const { port } = createPort();
    const adapter = new TypieEditorAdapter(
      port,
      document.createElement("div")
    );

    expect(() => adapter.undo()).toThrow("Typie editor is not open");
    await expect(adapter.getSnapshot()).rejects.toThrow(
      "Typie editor is not open"
    );
  });
});
