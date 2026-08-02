import { describe, expect, it, vi } from "vitest";
import type {
  LoadedEntityNote,
  LoadedSceneDocument,
  MadiDesktopApi,
  ProjectSession,
  ProjectTree,
  SaveSceneDocumentResult
} from "../src/shared/contracts";
import type {
  EditorChange,
  EditorReplacementDocument,
  EditorTextReplacement,
  MadiEditorAdapter
} from "../src/renderer/editor/MadiEditorAdapter";
import { DocumentSessionController } from "../src/renderer/workspace/DocumentSessionController";
import { phase1cApiStubs } from "./phase1c-api-stubs";

class SceneEditor implements MadiEditorAdapter {
  public readonly opened: Array<Uint8Array | undefined> = [];
  public snapshot = Uint8Array.from([1, 2, 3]);
  public plainText = "장면 A 본문";
  public readonly interactionStates: boolean[] = [];
  public undoCalls = 0;
  public sceneBreakCalls = 0;
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

  public async replaceTextRanges(
    replacements: readonly EditorTextReplacement[]
  ): Promise<EditorReplacementDocument> {
    return {
      snapshot: Uint8Array.from([7, replacements.length]),
      plainTextRecovery: "치환된 본문",
      semanticSceneBreakCount: 0
    };
  }

  public setInteractionEnabled(enabled: boolean): void {
    this.interactionStates.push(enabled);
  }

  public focus(): void {}
  public undo(): void {
    this.undoCalls += 1;
  }
  public redo(): void {}
  public insertSceneBreak(): void {
    this.sceneBreakCalls += 1;
  }

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

function loadedEntityNote(
  entityId: string,
  revision: number
): LoadedEntityNote {
  return {
    ownerKind: "ENTITY",
    ownerId: entityId,
    id: `entity-document-${entityId}`,
    projectId: "project-1",
    title: `설정 ${entityId}`,
    editorEngine: "typie",
    editorEngineCommit: "fixed-commit",
    editorSchemaVersion: 1,
    snapshot: Uint8Array.from([revision, 7]),
    plainTextRecovery: `${entityId} 상세 노트`,
    revision,
    updatedAt: "2026-08-02T00:02:00.000Z"
  };
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
  const api: MadiDesktopApi = {
    ...phase1cApiStubs(),
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
    listDescendantScenes: vi.fn(async () => {
      throw new Error("not used");
    }),
    searchProject: vi.fn(async () => {
      throw new Error("not used");
    }),
    getTextStatistics: vi.fn(async () => {
      throw new Error("not used");
    }),
    applyReplacementBatch: vi.fn(async () => {
      throw new Error("not used");
    }),
    createNamedSnapshot: vi.fn(async () => {
      throw new Error("not used");
    }),
    listNamedSnapshots: vi.fn(async () => {
      throw new Error("not used");
    }),
    renameNamedSnapshot: vi.fn(async () => {
      throw new Error("not used");
    }),
    deleteNamedSnapshot: vi.fn(async () => {
      throw new Error("not used");
    }),
    diffNamedSnapshot: vi.fn(async () => {
      throw new Error("not used");
    }),
    restoreNamedSnapshot: vi.fn(async () => {
      throw new Error("not used");
    }),
    getAppVersion: vi.fn(async () => "0.0.1"),
    onCloseRequested: vi.fn(() => () => undefined),
    completeCloseRequest: vi.fn(async () => true)
  };
  return Object.assign(api, overrides);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe("Phase 1A scene session safety", () => {
  it("uses one owner-aware editor session across scene and entity notes", async () => {
    const calls: string[] = [];
    const api = createApi({
      saveSceneDocument: vi.fn(async (request) => {
        calls.push(`save-scene:${request.sceneId}`);
        return {
          sceneId: request.sceneId,
          documentId: request.documentId,
          revision: 2,
          updatedAt: "2026-08-02T00:01:00.000Z",
          generation: request.generation,
          saveSequence: request.saveSequence
        };
      }),
      loadEntityNote: vi.fn(async ({ ownerId }) => {
        calls.push(`load-entity:${ownerId}`);
        return loadedEntityNote(ownerId, 2);
      }),
      saveEntityNote: vi.fn(async (request) => {
        calls.push(`save-entity:${request.ownerId}`);
        return {
          ownerKind: "ENTITY" as const,
          ownerId: request.ownerId,
          documentId: request.documentId,
          revision: 3,
          updatedAt: "2026-08-02T00:03:00.000Z",
          generation: request.generation,
          saveSequence: request.saveSequence
        };
      }),
      loadSceneDocument: vi.fn(async ({ sceneId }) => {
        calls.push(`load-scene:${sceneId}`);
        return loadedScene(sceneId, 3);
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
    expect(await controller.selectEntityNote("entity-a")).toBe(true);
    expect(calls.slice(0, 2)).toEqual([
      "save-scene:scene-a",
      "load-entity:entity-a"
    ]);
    expect(controller.getState()).toMatchObject({
      activeOwnerKind: "ENTITY",
      activeOwnerId: "entity-a",
      activeEntityId: "entity-a",
      activeSceneId: null
    });

    editor.plainText = "수정한 설정 노트";
    editor.emitContentChange();
    expect(await controller.selectEntityNote("entity-b")).toBe(true);
    expect(calls.slice(-2)).toEqual([
      "save-entity:entity-a",
      "load-entity:entity-b"
    ]);
    expect(controller.getState()).toMatchObject({
      activeOwnerKind: "ENTITY",
      activeOwnerId: "entity-b"
    });

    editor.plainText = "수정한 두 번째 설정 노트";
    editor.emitContentChange();
    expect(await controller.selectScene("scene-b")).toBe(true);
    expect(calls.slice(-2)).toEqual([
      "save-entity:entity-b",
      "load-scene:scene-b"
    ]);
    expect(api.saveEntityNote).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        ownerKind: "ENTITY" as const,
        ownerId: "entity-a",
        documentId: "entity-document-entity-a"
      })
    );
    expect(controller.getState()).toMatchObject({
      activeOwnerKind: "SCENE",
      activeOwnerId: "scene-b",
      activeEntityId: null,
      activeSceneId: "scene-b"
    });
  });

  it("rejects a stale entity save response without switching or overwriting owners", async () => {
    const api = createApi({
      loadEntityNote: vi.fn(async ({ ownerId }) => loadedEntityNote(ownerId, 2)),
      saveEntityNote: vi.fn(async (request) => ({
        ownerKind: "ENTITY" as const,
        ownerId: "entity-stale",
        documentId: request.documentId,
        revision: 3,
        updatedAt: "2026-08-02T00:03:00.000Z",
        generation: request.generation,
        saveSequence: request.saveSequence
      }))
    });
    const editor = new SceneEditor();
    const controller = new DocumentSessionController(
      api,
      editor,
      "fixed-commit",
      1
    );

    await controller.createProject();
    expect(await controller.selectEntityNote("entity-a")).toBe(true);
    editor.plainText = "저장 실패해도 유지할 노트";
    editor.emitContentChange();

    expect(await controller.save()).toBe(false);
    expect(controller.getState()).toMatchObject({
      activeOwnerKind: "ENTITY",
      activeOwnerId: "entity-a",
      savePhase: "error"
    });
    expect(controller.getState().errorMessage).toContain("owner");
    expect(api.saveSceneDocument).toHaveBeenCalledTimes(1);
  });

  it("flushes a dirty entity note before close", async () => {
    const api = createApi({
      loadEntityNote: vi.fn(async ({ ownerId }) => loadedEntityNote(ownerId, 2)),
      saveEntityNote: vi.fn(async (request) => ({
        ownerKind: "ENTITY" as const,
        ownerId: request.ownerId,
        documentId: request.documentId,
        revision: 3,
        updatedAt: "2026-08-02T00:03:00.000Z",
        generation: request.generation,
        saveSequence: request.saveSequence
      }))
    });
    const editor = new SceneEditor();
    const controller = new DocumentSessionController(
      api,
      editor,
      "fixed-commit",
      1
    );

    await controller.createProject();
    await controller.selectEntityNote("entity-a");
    editor.plainText = "종료 전 저장할 설정 노트";
    editor.emitContentChange();

    expect(await controller.prepareForClose()).toBe(true);
    expect(api.saveEntityNote).toHaveBeenCalledTimes(1);
    expect(controller.getState().savePhase).toBe("saved");
  });

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

  it("locks user interaction and refuses Ctrl+S while semantic replacement borrows the live editor", async () => {
    const pendingTarget = deferred<LoadedSceneDocument>();
    const api = createApi({
      loadSceneDocument: vi.fn(async ({ sceneId }) => {
        if (sceneId === "scene-b") {
          return pendingTarget.promise;
        }
        return loadedScene(sceneId, 1);
      }),
      applyReplacementBatch: vi.fn(async () => ({
        safetySnapshot: {
          id: "snapshot-before-replace",
          projectId: "project-1",
          name: "치환 전",
          note: null,
          kind: "AUTO_BEFORE_REPLACE" as const,
          payloadFormat: "madi-logical-project",
          payloadVersion: 1,
          payloadBytes: 100,
          contentHash: "a".repeat(64),
          createdAt: "2026-08-02T00:00:00.000Z",
          updatedAt: "2026-08-02T00:00:00.000Z"
        },
        changedSceneIds: ["scene-b"],
        changedScenes: 1,
        changedOccurrences: 1,
        revision: 2
      }))
    });
    const editor = new SceneEditor();
    const controller = new DocumentSessionController(
      api,
      editor,
      "fixed-commit",
      1
    );
    await controller.openProject();

    const replacement = controller.applySemanticReplacementBatch(
      [
        {
          sceneId: "scene-b",
          documentId: "document-b",
          sourceContentHash: "b".repeat(64),
          replacements: [
            {
              id: "scene-b:0",
              start: 0,
              end: 1,
              expectedText: "장",
              replacement: "별"
            }
          ]
        }
      ],
      1,
      "장",
      "별",
      false
    );
    await vi.waitFor(() => expect(editor.interactionStates).toEqual([false]));

    expect(await controller.save()).toBe(false);
    controller.undo();
    controller.insertSceneBreak();
    expect(api.saveSceneDocument).not.toHaveBeenCalled();
    expect(editor.undoCalls).toBe(0);
    expect(editor.sceneBreakCalls).toBe(0);

    pendingTarget.resolve(loadedScene("scene-b", 1));
    expect(await replacement).not.toBeNull();
    expect(api.applyReplacementBatch).toHaveBeenCalledTimes(1);
    expect(api.saveSceneDocument).not.toHaveBeenCalled();
    expect(editor.interactionStates).toEqual([false, true]);
  });

  it("aborts a replacement if an unexpected editor mutation crosses the lock", async () => {
    const pendingTarget = deferred<LoadedSceneDocument>();
    const api = createApi({
      loadSceneDocument: vi.fn(async ({ sceneId }) =>
        sceneId === "scene-b"
          ? pendingTarget.promise
          : loadedScene(sceneId, 1)
      ),
      applyReplacementBatch: vi.fn(async () => {
        throw new Error("must not commit");
      })
    });
    const editor = new SceneEditor();
    const controller = new DocumentSessionController(
      api,
      editor,
      "fixed-commit",
      1
    );
    await controller.openProject();

    const replacement = controller.applySemanticReplacementBatch(
      [
        {
          sceneId: "scene-b",
          documentId: "document-b",
          sourceContentHash: "b".repeat(64),
          replacements: [
            {
              id: "scene-b:0",
              start: 0,
              end: 1,
              expectedText: "장",
              replacement: "별"
            }
          ]
        }
      ],
      1,
      "장",
      "별",
      false
    );
    await vi.waitFor(() => expect(editor.interactionStates).toEqual([false]));
    editor.emitContentChange();
    pendingTarget.resolve(loadedScene("scene-b", 1));

    expect(await replacement).toBeNull();
    expect(api.applyReplacementBatch).not.toHaveBeenCalled();
    expect(api.saveSceneDocument).not.toHaveBeenCalled();
    expect(editor.interactionStates).toEqual([false, true]);
    expect(controller.getState().errorMessage).toContain(
      "프로젝트 작업 중 편집기 변경"
    );
  });

  it("stays fail-closed if a committed replacement cannot reload the original scene", async () => {
    let originalLoads = 0;
    const api = createApi({
      loadSceneDocument: vi.fn(async ({ sceneId }) => {
        if (sceneId === "scene-a") {
          originalLoads += 1;
          if (originalLoads > 1) {
            throw new Error("reload failed");
          }
        }
        return loadedScene(sceneId, 1);
      }),
      applyReplacementBatch: vi.fn(async () => ({
        safetySnapshot: {
          id: "snapshot-before-replace",
          projectId: "project-1",
          name: "치환 전",
          note: null,
          kind: "AUTO_BEFORE_REPLACE" as const,
          payloadFormat: "madi-logical-project",
          payloadVersion: 1,
          payloadBytes: 100,
          contentHash: "a".repeat(64),
          createdAt: "2026-08-02T00:00:00.000Z",
          updatedAt: "2026-08-02T00:00:00.000Z"
        },
        changedSceneIds: ["scene-b"],
        changedScenes: 1,
        changedOccurrences: 1,
        revision: 2
      }))
    });
    const editor = new SceneEditor();
    const controller = new DocumentSessionController(
      api,
      editor,
      "fixed-commit",
      1
    );
    await controller.openProject();

    const result = await controller.applySemanticReplacementBatch(
      [
        {
          sceneId: "scene-b",
          documentId: "document-b",
          sourceContentHash: "b".repeat(64),
          replacements: [
            {
              id: "scene-b:0",
              start: 0,
              end: 1,
              expectedText: "장",
              replacement: "별"
            }
          ]
        }
      ],
      1,
      "장",
      "별",
      false
    );

    expect(result).toBeNull();
    expect(controller.getState().savePhase).toBe("restoring");
    expect(editor.interactionStates).toEqual([false]);
    expect(await controller.save()).toBe(false);
    expect(controller.isEditorFailClosed()).toBe(true);
    expect(await controller.prepareForClose()).toBe(true);
    expect(api.saveSceneDocument).not.toHaveBeenCalled();
  });

  it("keeps a named-restore style exclusive operation locked through storage reload", async () => {
    const releaseRestore = deferred<void>();
    const api = createApi();
    const editor = new SceneEditor();
    const controller = new DocumentSessionController(
      api,
      editor,
      "fixed-commit",
      1
    );
    await controller.openProject();

    const operation = controller.runExclusiveEditorOperation(async () => {
      await releaseRestore.promise;
      await controller.reloadSceneFromStorage("scene-a", 2);
      return "restored";
    });
    await vi.waitFor(() => expect(editor.interactionStates).toEqual([false]));
    expect(controller.getState().savePhase).toBe("restoring");
    expect(await controller.save()).toBe(false);
    expect(api.saveSceneDocument).not.toHaveBeenCalled();

    releaseRestore.resolve();
    expect(await operation).toBe("restored");
    expect(editor.interactionStates).toEqual([false, true]);
    expect(controller.getState().savePhase).toBe("saved");
  });
});
