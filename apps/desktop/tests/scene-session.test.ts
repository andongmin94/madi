import { describe, expect, it, vi } from "vitest";
import type {
  LoadedSceneDocument,
  MadiDesktopApi,
  ProjectSession,
  ProjectTree,
  SaveSceneDocumentResult
} from "../src/shared/contracts";
import type {
  EditorChange,
  MadiEditorAdapter
} from "../src/renderer/editor/MadiEditorAdapter";
import { DocumentSessionController } from "../src/renderer/workspace/DocumentSessionController";

class SceneEditor implements MadiEditorAdapter {
  public readonly opened: Array<Uint8Array | undefined> = [];
  public snapshot = Uint8Array.from([1, 2, 3]);
  public plainText = "장면 A 본문";
  private readonly listeners = new Set<(change: EditorChange) => void>();

  public async open(snapshot?: Uint8Array): Promise<void> {
    this.opened.push(snapshot ? Uint8Array.from(snapshot) : undefined);
  }

  public async getSnapshot(): Promise<Uint8Array> {
    return Uint8Array.from(this.snapshot);
  }

  public async getPlainText(): Promise<string> {
    return this.plainText;
  }

  public focus(): void {}
  public undo(): void {}
  public redo(): void {}
  public insertSceneBreak(): void {}

  public onChanged(listener: (change: EditorChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public emitContentChange(): void {
    for (const listener of this.listeners) {
      listener({
        reason: "content",
        revision: 1,
        canUndo: true,
        canRedo: false,
        isComposing: false
      });
    }
  }
}

const session: ProjectSession = {
  sessionId: "d98be040-afbb-4510-b875-a8cbbe7b10a5",
  fileName: "드래곤을죽이다.madi",
  projectId: "project-1",
  workNodeId: "work-1",
  sceneId: "scene-a",
  documentId: "document-a",
  title: "드래곤을죽이다",
  revision: 1
};

const emptyTree: ProjectTree = {
  project: {
    id: "project-1",
    title: "드래곤을죽이다",
    authorName: null,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z"
  },
  nodes: [],
  revision: 1
};

function loadedScene(sceneId: string, revision: number): LoadedSceneDocument {
  return {
    sceneId,
    id: `document-${sceneId.at(-1)}`,
    projectId: "project-1",
    title: `장면 ${sceneId.at(-1)?.toLocaleUpperCase()}`,
    editorEngine: "typie",
    editorEngineCommit: "fixed-commit",
    editorSchemaVersion: 1,
    snapshot: Uint8Array.from([revision, 9]),
    plainTextRecovery: `${sceneId} 본문`,
    revision,
    updatedAt: "2026-08-02T00:01:00.000Z"
  };
}

function createApi(overrides: Partial<MadiDesktopApi> = {}): MadiDesktopApi {
  const unusedTree = vi.fn(async () => emptyTree);
  return {
    createProject: vi.fn(async () => session),
    openProject: vi.fn(async () => session),
    saveDocument: vi.fn(async () => ({
      documentId: "document-a",
      revision: 2,
      updatedAt: "2026-08-02T00:01:00.000Z"
    })),
    loadDocument: vi.fn(async () => loadedScene("scene-a", 1)),
    recoverPlainText: vi.fn(async () => ({
      documentId: "document-a",
      plainText: "장면 A 본문",
      revision: 1
    })),
    getProjectTree: unusedTree,
    createNode: unusedTree,
    renameNode: unusedTree,
    moveNode: unusedTree,
    reorderNode: unusedTree,
    deleteNode: unusedTree,
    loadSceneDocument: vi.fn(async ({ sceneId }) => loadedScene(sceneId, 2)),
    saveSceneDocument: vi.fn(async (request) => ({
      sceneId: request.sceneId,
      documentId: request.documentId,
      revision: 2,
      updatedAt: "2026-08-02T00:01:00.000Z",
      generation: request.generation,
      saveSequence: request.saveSequence
    })),
    saveUiState: vi.fn(async () => undefined),
    loadUiState: vi.fn(async () => ({ state: null })),
    getAppVersion: vi.fn(async () => "0.0.1"),
    onCloseRequested: vi.fn(() => () => undefined),
    completeCloseRequest: vi.fn(async () => true),
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe("Phase 1A scene session safety", () => {
  it("saves scene A before loading scene B", async () => {
    const calls: string[] = [];
    const api = createApi({
      saveSceneDocument: vi.fn(async (request) => {
        calls.push(`save:${request.sceneId}`);
        return {
          sceneId: request.sceneId,
          documentId: request.documentId,
          revision: 2,
          updatedAt: "2026-08-02T00:01:00.000Z",
          generation: request.generation,
          saveSequence: request.saveSequence
        };
      }),
      loadSceneDocument: vi.fn(async ({ sceneId }) => {
        calls.push(`load:${sceneId}`);
        return loadedScene(sceneId, 2);
      })
    });
    const editor = new SceneEditor();
    const controller = new DocumentSessionController(
      api,
      editor,
      "fixed-commit",
      1
    );

    await controller.createProject();
    expect(await controller.selectScene("scene-b")).toBe(true);

    expect(calls).toEqual(["save:scene-a", "load:scene-b"]);
    expect(controller.getState()).toMatchObject({
      activeSceneId: "scene-b",
      savePhase: "saved",
      revision: 2
    });
    expect(editor.opened).toEqual([undefined, Uint8Array.from([2, 9])]);
  });

  it("coalesces rapid A to B to C selection without loading stale B", async () => {
    const pendingSave = deferred<SaveSceneDocumentResult>();
    const loaded: string[] = [];
    const api = createApi({
      saveSceneDocument: vi.fn(() => pendingSave.promise),
      loadSceneDocument: vi.fn(async ({ sceneId }) => {
        loaded.push(sceneId);
        return loadedScene(sceneId, 2);
      })
    });
    const controller = new DocumentSessionController(
      api,
      new SceneEditor(),
      "fixed-commit",
      1
    );
    await controller.createProject();

    const toB = controller.selectScene("scene-b");
    const toC = controller.selectScene("scene-c");
    pendingSave.resolve({
      sceneId: "scene-a",
      documentId: "document-a",
      revision: 2,
      updatedAt: "2026-08-02T00:01:00.000Z",
      generation: 1,
      saveSequence: 1
    });

    expect(await toB).toBe(false);
    expect(await toC).toBe(true);
    expect(loaded).toEqual(["scene-c"]);
    expect(controller.getState().activeSceneId).toBe("scene-c");
  });

  it("keeps scene A mounted when its save fails", async () => {
    const api = createApi({
      saveSceneDocument: vi.fn(async () => {
        throw new Error("disk full");
      })
    });
    const editor = new SceneEditor();
    const controller = new DocumentSessionController(
      api,
      editor,
      "fixed-commit",
      1
    );
    await controller.createProject();

    expect(await controller.selectScene("scene-b")).toBe(false);
    expect(controller.getState()).toMatchObject({
      activeSceneId: "scene-a",
      savePhase: "error"
    });
    expect(editor.opened).toEqual([undefined]);
    expect(api.loadSceneDocument).not.toHaveBeenCalled();
  });

  it.each(["sceneId", "documentId", "generation", "saveSequence"] as const)(
    "rejects a save response whose %s does not match the active scene",
    async (mismatch) => {
      const api = createApi({
        saveSceneDocument: vi.fn(async (request) => {
          const matching: SaveSceneDocumentResult = {
            sceneId: request.sceneId,
            documentId: request.documentId,
            revision: 99,
            updatedAt: "2026-08-02T00:01:00.000Z",
            generation: request.generation,
            saveSequence: request.saveSequence
          };
          switch (mismatch) {
            case "sceneId":
              return { ...matching, sceneId: "scene-stale" };
            case "documentId":
              return { ...matching, documentId: "document-stale" };
            case "generation":
              return { ...matching, generation: request.generation + 1 };
            case "saveSequence":
              return { ...matching, saveSequence: request.saveSequence + 1 };
          }
        })
      });
      const editor = new SceneEditor();
      const controller = new DocumentSessionController(
        api,
        editor,
        "fixed-commit",
        1
      );
      await controller.createProject();

      expect(await controller.selectScene("scene-b")).toBe(false);
      expect(controller.getState()).toMatchObject({
        activeSceneId: "scene-a",
        revision: 1,
        savePhase: "error"
      });
      expect(editor.opened).toEqual([undefined]);
      expect(api.loadSceneDocument).not.toHaveBeenCalled();
    }
  );

  it("does not write an unchanged snapshot again after a dirty event", async () => {
    const api = createApi();
    const editor = new SceneEditor();
    const controller = new DocumentSessionController(
      api,
      editor,
      "fixed-commit",
      1
    );
    await controller.createProject();

    expect(await controller.save()).toBe(true);
    editor.emitContentChange();
    expect(controller.getState().savePhase).toBe("dirty");
    expect(await controller.save()).toBe(true);

    expect(api.saveSceneDocument).toHaveBeenCalledTimes(1);
    expect(controller.getState().savePhase).toBe("saved");
  });

  it("opens a valid project with no remaining scenes in Binder-only mode", async () => {
    const sceneLessSession: ProjectSession = {
      sessionId: session.sessionId,
      fileName: session.fileName,
      projectId: session.projectId,
      workNodeId: session.workNodeId,
      title: session.title,
      revision: 7
    };
    const api = createApi({
      openProject: vi.fn(async () => sceneLessSession)
    });
    const editor = new SceneEditor();
    const controller = new DocumentSessionController(
      api,
      editor,
      "fixed-commit",
      1
    );

    await controller.openProject();

    expect(controller.getState()).toMatchObject({
      session: sceneLessSession,
      activeSceneId: null,
      savePhase: "saved",
      revision: 7
    });
    expect(editor.opened).toEqual([undefined]);
    expect(api.loadDocument).not.toHaveBeenCalled();
    expect(api.loadSceneDocument).not.toHaveBeenCalled();
  });
});
