import { describe, expect, it, vi } from "vitest";
import type { MadiDesktopApi, ProjectSession } from "../src/shared/contracts";
import {
  TypieEditorAdapter,
  type TypieEnginePort,
  type TypieTransactionEvent
} from "../src/renderer/editor/typie/TypieEditorAdapter";
import { DocumentSessionController } from "../src/renderer/workspace/DocumentSessionController";

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
    readTextSelection: vi.fn(() => ({
      text: "복구용",
      start: 0,
      end: 3,
      blockKey: "opaque-block"
    })),
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
  it("creates the first controller project while the unopened adapter remains locked", async () => {
    const { port } = createPort();
    const adapter = new TypieEditorAdapter(port, document.createElement("div"));
    let interactionEnabled = true;
    vi.mocked(port.setInteractionEnabled).mockImplementation((enabled) => {
      interactionEnabled = enabled;
    });
    vi.mocked(port.mount).mockImplementation(async () => {
      expect(interactionEnabled).toBe(false);
    });
    let finishInstall!: () => void;
    const installation = new Promise<void>((resolve) => {
      finishInstall = resolve;
    });
    vi.mocked(port.createEmptyDocument).mockImplementation(async () => {
      expect(interactionEnabled).toBe(false);
      await installation;
      expect(interactionEnabled).toBe(false);
    });
    const session: ProjectSession = {
      sessionId: "d98be040-afbb-4510-b875-a8cbbe7b10a5",
      fileName: "fixture.madi",
      projectId: "project-1",
      workNodeId: "work-1",
      sceneId: "scene-1",
      documentId: "document-1",
      title: "fixture",
      revision: 0
    };
    const api: Partial<MadiDesktopApi> = {
      createProject: vi.fn(async () => session),
      completeProjectOpen: vi.fn(async () => {
        expect(interactionEnabled).toBe(false);
      })
    };
    const controller = new DocumentSessionController(
      api as MadiDesktopApi,
      adapter,
      "fixed-commit",
      1
    );

    const creating = controller.createProject();
    await vi.waitFor(() =>
      expect(port.createEmptyDocument).toHaveBeenCalledTimes(1)
    );
    expect(port.setInteractionEnabled).toHaveBeenCalledExactlyOnceWith(false);
    expect(controller.getState()).toMatchObject({
      session: null,
      savePhase: "restoring"
    });
    expect(api.completeProjectOpen).not.toHaveBeenCalled();
    expect(() => adapter.undo()).toThrow("Typie editor is not open");
    await expect(adapter.getSnapshot()).rejects.toThrow(
      "Typie editor is not open"
    );

    finishInstall();
    await creating;

    expect(api.createProject).toHaveBeenCalledTimes(1);
    expect(api.completeProjectOpen).toHaveBeenCalledExactlyOnceWith({
      sessionId: session.sessionId,
      accepted: true
    });
    expect(controller.getState()).toMatchObject({
      session,
      activeSceneId: "scene-1",
      savePhase: "dirty",
      errorMessage: ""
    });
    expect(vi.mocked(port.setInteractionEnabled).mock.calls).toEqual([
      [false],
      [true]
    ]);
    expect(port.focus).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("keeps an existing document locked throughout snapshot replacement until explicit unlock", async () => {
    const { port } = createPort();
    const adapter = new TypieEditorAdapter(port, document.createElement("div"));
    await adapter.open();
    let interactionEnabled = true;
    vi.mocked(port.setInteractionEnabled).mockImplementation((enabled) => {
      interactionEnabled = enabled;
    });
    let finishRestore!: () => void;
    const restoration = new Promise<void>((resolve) => {
      finishRestore = resolve;
    });
    vi.mocked(port.restoreSnapshot).mockImplementation(async () => {
      expect(interactionEnabled).toBe(false);
      await restoration;
      expect(interactionEnabled).toBe(false);
    });

    adapter.setInteractionEnabled(false);
    const replacing = adapter.open(Uint8Array.from([1, 2, 3]));
    await vi.waitFor(() =>
      expect(port.restoreSnapshot).toHaveBeenCalledTimes(1)
    );
    expect(interactionEnabled).toBe(false);
    finishRestore();
    await replacing;
    expect(interactionEnabled).toBe(false);
    expect(port.setInteractionEnabled).toHaveBeenCalledExactlyOnceWith(false);

    adapter.setInteractionEnabled(true);
    expect(interactionEnabled).toBe(true);
    expect(vi.mocked(port.setInteractionEnabled).mock.calls).toEqual([
      [false],
      [true]
    ]);
    expect(port.mount).toHaveBeenCalledTimes(1);
  });

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
    expect(adapter.getTextSelection()).toEqual({
      text: "복구용",
      start: 0,
      end: 3,
      blockKey: "opaque-block"
    });
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

  it("rejects document commands before a document is opened", async () => {
    const { port } = createPort();
    const adapter = new TypieEditorAdapter(
      port,
      document.createElement("div")
    );

    expect(() => adapter.undo()).toThrow("Typie editor is not open");
    expect(() => adapter.getTextSelection()).toThrow(
      "Typie editor is not open"
    );
    await expect(adapter.getSnapshot()).rejects.toThrow(
      "Typie editor is not open"
    );
  });
});
