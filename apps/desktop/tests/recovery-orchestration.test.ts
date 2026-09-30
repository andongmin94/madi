import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import type {
  MadiDesktopApi,
  ProjectSession,
  TreeNodeKind
} from "../src/shared/contracts";
import {
  DesktopService,
  type DialogPort
} from "../src/main/desktopService";
import type { CoreClient, CoreMethod } from "../src/main/coreClient";
import { ProjectSessionRegistry } from "../src/main/projectSessions";
import type {
  EditorChange,
  MadiEditorAdapter
} from "../src/renderer/editor/MadiEditorAdapter";
import { DocumentSessionController } from "../src/renderer/workspace/DocumentSessionController";
import { phase1bApiStubs } from "./phase1b-api-stubs";

class TestEditorAdapter implements MadiEditorAdapter {
  public readonly openedSnapshots: Array<Uint8Array | undefined> = [];
  public snapshot = Uint8Array.from([7, 7, 7]);
  public plainText = "복구 본문";
  public readonly interactionStates: boolean[] = [];
  private readonly listeners = new Set<(change: EditorChange) => void>();

  public async open(snapshot?: Uint8Array): Promise<void> {
    this.openedSnapshots.push(
      snapshot === undefined ? undefined : Uint8Array.from(snapshot)
    );
  }

  public async getSnapshot(): Promise<Uint8Array> {
    return Uint8Array.from(this.snapshot);
  }

  public async getPlainText(): Promise<string> {
    return this.plainText;
  }

  public focus(): void {}
  public setInteractionEnabled(enabled: boolean): void {
    this.interactionStates.push(enabled);
  }
  public undo(): void {}
  public redo(): void {}
  public insertSceneBreak(): void {}

  public onChanged(listener: (change: EditorChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public emitChanged(): void {
    for (const listener of this.listeners) {
      listener({
        revision: 12,
        reason: "content",
        canUndo: true,
        canRedo: false,
        isComposing: false
      });
    }
  }

  public emitCompositionState(isComposing: boolean): void {
    for (const listener of this.listeners) {
      listener({
        revision: 12,
        reason: "composition-state",
        canUndo: true,
        canRedo: false,
        isComposing
      });
    }
  }
}

function createApi() {
  const session: ProjectSession = {
    sessionId: "4f336251-9411-49e6-8302-736f1ec11558",
    fileName: "드래곤을죽이다.madi",
    projectId: "project-id",
    documentId: "document-id",
    title: "드래곤을 죽이다",
    revision: 8
  };
  const api: MadiDesktopApi = {
    ...phase1bApiStubs(),
    getProjectTree: vi.fn(async () => ({
      project: {
        id: session.projectId,
        title: session.title,
        authorName: null,
        createdAt: "2026-08-02T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z"
      },
      nodes: [],
      revision: session.revision
    })),
    createNode: vi.fn(async () => {
      throw new Error("not used");
    }),
    renameNode: vi.fn(async () => {
      throw new Error("not used");
    }),
    moveNode: vi.fn(async () => {
      throw new Error("not used");
    }),
    reorderNode: vi.fn(async () => {
      throw new Error("not used");
    }),
    deleteNode: vi.fn(async () => {
      throw new Error("not used");
    }),
    loadSceneDocument: vi.fn(async () => {
      throw new Error("not used");
    }),
    saveSceneDocument: vi.fn(async () => {
      throw new Error("not used");
    }),
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
    createProject: vi.fn(async () => session),
    openProject: vi.fn(async () => session),
    loadDocument: vi.fn(async () => ({
      id: "document-id",
      projectId: "project-id",
      title: "드래곤을 죽이다",
      editorEngine: "typie",
      editorEngineCommit: "fixed-commit",
      editorSchemaVersion: 1,
      snapshot: Uint8Array.from([2, 4, 6, 8]),
      plainTextRecovery: "첫 문장\n* * *\n둘째 문장",
      revision: 8,
      updatedAt: "2026-07-29T00:00:00.000Z"
    })),
    saveDocument: vi.fn(async () => ({
      documentId: "document-id",
      revision: 9,
      updatedAt: "2026-07-29T00:01:00.000Z"
    })),
    recoverPlainText: vi.fn(async () => ({
      documentId: "document-id",
      plainText: "복구 본문",
      revision: 9
    })),
    getAppVersion: vi.fn(async () => "0.0.1"),
    onCloseRequested: vi.fn(() => () => undefined),
    completeCloseRequest: vi.fn(async () => true)
  };
  return { api, session };
}

describe("restart/open recovery orchestration", () => {
  it("opens a user-selected project, loads it, then restores the adapter", async () => {
    const { api, session } = createApi();
    const editor = new TestEditorAdapter();
    const controller = new DocumentSessionController(
      api,
      editor,
      "fixed-commit",
      1
    );

    await controller.openProject();

    expect(api.openProject).toHaveBeenCalledTimes(1);
    expect(api.loadDocument).toHaveBeenCalledWith({
      sessionId: session.sessionId,
      documentId: session.documentId
    });
    expect(editor.openedSnapshots).toEqual([
      Uint8Array.from([2, 4, 6, 8])
    ]);
    expect(controller.getState()).toMatchObject({
      savePhase: "saved",
      revision: 8,
      snapshotBytes: 4,
      recoveryCharacters: 16
    });
  });

  it("keeps a change made during save in the dirty state", async () => {
    const { api } = createApi();
    const editor = new TestEditorAdapter();
    const controller = new DocumentSessionController(
      api,
      editor,
      "fixed-commit",
      1
    );
    await controller.openProject();

    let resolveSave:
      | ((value: {
          documentId: string;
          revision: number;
          updatedAt: string;
        }) => void)
      | undefined;
    vi.mocked(api.saveDocument).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        })
    );

    editor.emitChanged();
    const saving = controller.save();
    await vi.waitFor(() => {
      expect(resolveSave).toBeTypeOf("function");
    });
    expect(controller.getState().savePhase).toBe("saving");

    editor.emitChanged();
    resolveSave?.({
      documentId: "document-id",
      revision: 9,
      updatedAt: "2026-07-29T00:01:00.000Z"
    });
    await saving;

    expect(controller.getState().savePhase).toBe("dirty");
  });

  it("tracks composition-only events without dirtying or advancing the save generation", async () => {
    const { api } = createApi();
    const editor = new TestEditorAdapter();
    const controller = new DocumentSessionController(
      api,
      editor,
      "fixed-commit",
      1
    );
    await controller.openProject();

    editor.emitCompositionState(true);
    expect(controller.getState()).toMatchObject({
      savePhase: "saved",
      isComposing: true
    });
    editor.emitCompositionState(false);
    expect(controller.getState()).toMatchObject({
      savePhase: "saved",
      isComposing: false
    });

    let resolveSave:
      | ((value: {
          documentId: string;
          revision: number;
          updatedAt: string;
        }) => void)
      | undefined;
    vi.mocked(api.saveDocument).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        })
    );

    editor.emitChanged();
    const saving = controller.save();
    await vi.waitFor(() => {
      expect(resolveSave).toBeTypeOf("function");
    });
    editor.emitCompositionState(true);
    editor.emitCompositionState(false);
    resolveSave?.({
      documentId: "document-id",
      revision: 9,
      updatedAt: "2026-07-29T00:01:00.000Z"
    });
    await saving;

    expect(controller.getState()).toMatchObject({
      savePhase: "saved",
      isComposing: false
    });
  });

  it("flushes dirty changes before replacing the current project", async () => {
    const { api } = createApi();
    const editor = new TestEditorAdapter();
    const controller = new DocumentSessionController(
      api,
      editor,
      "fixed-commit",
      1
    );
    await controller.openProject();
    vi.mocked(api.createProject).mockClear();
    vi.mocked(api.saveDocument).mockClear();

    editor.emitChanged();
    await controller.createProject();

    expect(api.saveDocument).toHaveBeenCalledTimes(1);
    expect(api.createProject).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(api.saveDocument).mock.invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(api.createProject).mock.invocationCallOrder[0] ?? 0
    );
  });

  it("keeps the current editor open when a pre-navigation save fails", async () => {
    const { api } = createApi();
    const editor = new TestEditorAdapter();
    const controller = new DocumentSessionController(
      api,
      editor,
      "fixed-commit",
      1
    );
    await controller.openProject();
    vi.mocked(api.openProject).mockClear();
    vi.mocked(api.saveDocument).mockRejectedValue(
      new Error("disk unavailable")
    );

    editor.emitChanged();
    await controller.openProject();

    expect(api.openProject).not.toHaveBeenCalled();
    expect(editor.openedSnapshots).toHaveLength(1);
    expect(controller.getState()).toMatchObject({
      savePhase: "error",
      errorMessage: "disk unavailable"
    });
  });

  it("turns a create_project zero-byte placeholder into a dirty empty Typie document", async () => {
    const { api } = createApi();
    vi.mocked(api.loadDocument).mockResolvedValue({
      id: "document-id",
      projectId: "project-id",
      title: "새 작품",
      editorEngine: "typie",
      editorEngineCommit: "fixed-commit",
      editorSchemaVersion: 1,
      snapshot: new Uint8Array(),
      plainTextRecovery: "",
      revision: 0,
      updatedAt: "2026-07-29T00:00:00.000Z"
    });
    const editor = new TestEditorAdapter();
    const controller = new DocumentSessionController(
      api,
      editor,
      "fixed-commit",
      1
    );

    await controller.openProject();

    expect(editor.openedSnapshots).toEqual([undefined]);
    expect(controller.getState().savePhase).toBe("dirty");
  });

  it.each([
    { label: "incompatible", replacementCommit: "different-commit" },
    { label: "successful", replacementCommit: "fixed-commit" },
    { label: "canceled", replacementCommit: null }
  ])("completes a $label project open before retiring the original session", async ({ replacementCommit }) => {
    const filePaths = [
      "C:\\drafts\\original.madi",
      "C:\\drafts\\incompatible.madi"
    ];
    const timestamp = "2026-09-30T00:00:00.000Z";
    const sessions = new ProjectSessionRegistry();
    const request = vi.fn(async (
      method: CoreMethod,
      params: Readonly<Record<string, unknown>>
    ): Promise<unknown> => {
      const index = filePaths.indexOf(params.file_path as string);
      if (index === -1) {
        throw new Error("Unexpected fixture project path");
      }
      const key = index === 0 ? "a" : "b";
      const node = (
        kind: TreeNodeKind,
        parentId: string | null,
        documentId: string | null = null
      ) => ({
        id: `${kind.toLowerCase()}-${key}`,
        project_id: `project-${key}`,
        parent_id: parentId,
        kind,
        title: `${kind} ${key}`,
        order_key: 1,
        document_id: documentId,
        created_at: timestamp,
        updated_at: timestamp
      });
      const scene = node("SCENE", `chapter-${key}`, `document-${key}`);
      switch (method) {
        case "open_project":
          return {
            metadata: {
              project_id: `project-${key}`,
              title: key,
              revision: 1
            }
          };
        case "load_project_tree":
          return {
            project: {
              id: `project-${key}`,
              title: key,
              author_name: null,
              created_at: timestamp,
              updated_at: timestamp
            },
            nodes: [
              node("WORK", null),
              node("CHAPTER", `work-${key}`),
              scene
            ],
            revision: 1
          };
        case "load_scene":
          return {
            scene,
            document: {
              id: `document-${key}`,
              project_id: `project-${key}`,
              editor_engine: "typie",
              editor_engine_commit:
                index === 0 ? "fixed-commit" : replacementCommit,
              editor_schema_version: 1,
              snapshot_base64: "AgQGCA==",
              plain_text_recovery: "A 본문",
              updated_at: timestamp
            },
            project_revision: 1
          };
        case "save_scene":
          return {
            metadata: { revision: 2, updated_at: timestamp },
            document: { id: `document-${key}` }
          };
        default:
          throw new Error(`Unexpected fixture core method ${method}`);
      }
    });
    const core: CoreClient = { request, dispose: vi.fn() };
    let nextOpen = 0;
    const dialog: DialogPort = {
      showSaveDialog: vi.fn(async () => ({ canceled: true })),
      showOpenDialog: vi.fn(async () => {
        const index = nextOpen++;
        return index === 1 && replacementCommit === null
          ? { canceled: true, filePaths: [] }
          : { canceled: false, filePaths: [filePaths[index]!] };
      })
    };
    const service = new DesktopService(
      {} as BrowserWindow,
      dialog,
      core,
      sessions,
      "0.0.1"
    );
    const { api } = createApi();
    api.openProject = vi.fn((input) => service.openProject(input));
    api.completeProjectOpen = vi.fn((input) => service.completeProjectOpen(input));
    api.loadSceneDocument = vi.fn((input) => service.loadSceneDocument(input));
    api.saveSceneDocument = vi.fn((input) => service.saveSceneDocument(input));
    const editor = new TestEditorAdapter();
    const controller = new DocumentSessionController(
      api,
      editor,
      "fixed-commit",
      1
    );

    await controller.openProject();
    editor.snapshot = Uint8Array.from([2, 4, 6, 8, 1]);
    editor.plainText = "A 저장 본문";
    editor.emitChanged();
    expect(await controller.save()).toBe(true);
    const originalSession = controller.getState().session!;
    expect(sessions.require(originalSession.sessionId).filePath).toBe(
      filePaths[0]
    );

    await controller.openProject();
    if (replacementCommit === "fixed-commit") {
      expect(controller.getState().session?.projectId).toBe("project-b");
      expect(editor.openedSnapshots).toHaveLength(2);
      expect(() => sessions.require(originalSession.sessionId)).toThrow(
        "The project session is no longer available"
      );
    } else {
      expect(controller.getState().session?.sessionId).toBe(originalSession.sessionId);
      expect(sessions.require(originalSession.sessionId).filePath).toBe(filePaths[0]);
      expect(editor.openedSnapshots).toHaveLength(1);
      expect(controller.getState().canUndo).toBe(true);
      if (replacementCommit !== null) {
        expect(controller.getState().errorMessage).toContain(
          "현재 엔진 commit과 호환되지 않습니다"
        );
        const rejected = vi.mocked(api.completeProjectOpen).mock.calls[1]![0];
        expect(rejected.accepted).toBe(false);
        expect(() => sessions.require(rejected.sessionId)).toThrow(
          "The project session is no longer available"
        );
      } else {
        expect(api.completeProjectOpen).toHaveBeenCalledTimes(1);
        expect(controller.getState().savePhase).toBe("saved");
      }
    }

    editor.snapshot = Uint8Array.from([2, 4, 6, 8, 2]);
    editor.plainText = "A 추가 수정";
    editor.emitChanged();
    expect(await controller.save()).toBe(true);
    expect(controller.getState().savePhase).toBe("saved");
    expect(
      request.mock.calls.filter(([method]) => method === "save_scene")
    ).toHaveLength(2);
  });

  it.each(["open", "create"] as const)(
    "restores the original snapshot after a replacement editor fails during %s",
    async (operation) => {
      const { api, session } = createApi();
      const editor = new TestEditorAdapter();
      const controller = new DocumentSessionController(api, editor, "fixed-commit", 1);
      await controller.openProject();
      const original = Uint8Array.from([2, 4, 6, 8]);
      editor.snapshot = original;
      editor.plainText = "첫 문장\n* * *\n둘째 문장";
      const originalText = editor.plainText;
      const open = vi.spyOn(editor, "open");
      open.mockImplementationOnce(async () => {
        editor.snapshot = Uint8Array.from([9, 9]);
        editor.plainText = "새 프로젝트 임시 본문";
        throw new Error("replacement editor installation failed");
      }).mockImplementationOnce(async (snapshot) => {
        editor.snapshot = Uint8Array.from(snapshot!);
        editor.plainText = originalText;
      });

      if (operation === "open") {
        await controller.openProject();
      } else {
        await controller.createProject();
      }

      expect(open.mock.calls[1]![0]).toEqual(original);
      expect(editor.snapshot).toEqual(original);
      expect(controller.getState()).toMatchObject({
        session,
        savePhase: "error",
        canUndo: false,
        canRedo: false
      });
      expect(api.completeProjectOpen).toHaveBeenLastCalledWith({
        sessionId: session.sessionId,
        accepted: false
      });
      expect(editor.interactionStates.at(-1)).toBe(true);
      expect(await controller.save()).toBe(true);
      expect(api.saveDocument).not.toHaveBeenCalled();
    }
  );

  it("keeps a failed editor restoration locked so a replacement snapshot cannot be saved to the original project", async () => {
    const { api, session } = createApi();
    const editor = new TestEditorAdapter();
    const controller = new DocumentSessionController(api, editor, "fixed-commit", 1);
    await controller.openProject();
    vi.spyOn(editor, "open")
      .mockImplementationOnce(async () => {
        editor.snapshot = Uint8Array.from([9, 9]);
        editor.plainText = "새 프로젝트 임시 본문";
        throw new Error("replacement editor installation failed");
      })
      .mockRejectedValueOnce(new Error("original editor restoration failed"));

    await controller.openProject();
    expect(controller.getState().session?.sessionId).toBe(session.sessionId);
    expect(controller.isEditorFailClosed()).toBe(true);
    expect(editor.interactionStates.at(-1)).toBe(false);
    editor.emitChanged();
    expect(controller.getState().savePhase).toBe("restoring");
    expect(await controller.save()).toBe(false);
    expect(await controller.prepareForClose()).toBe(true);
    expect(api.saveDocument).not.toHaveBeenCalled();
    expect(api.saveSceneDocument).not.toHaveBeenCalled();
    const opens = vi.mocked(api.openProject).mock.calls.length;
    await controller.openProject();
    expect(api.openProject).toHaveBeenCalledTimes(opens);
  });

  it("keeps the first project-open lock when concurrent open and create calls finish the same save", async () => {
    const { api } = createApi();
    const editor = new TestEditorAdapter();
    const controller = new DocumentSessionController(api, editor, "fixed-commit", 1);
    await controller.openProject();
    let finishSave!: (value: Awaited<ReturnType<MadiDesktopApi["saveDocument"]>>) => void;
    vi.mocked(api.saveDocument).mockImplementationOnce(() => new Promise((resolve) => {
      finishSave = resolve;
    }));
    let finishOpen!: (value: ProjectSession | null) => void;
    vi.mocked(api.openProject).mockImplementationOnce(() => new Promise((resolve) => {
      finishOpen = resolve;
    }));
    editor.emitChanged();
    const opening = controller.openProject();
    const creating = controller.createProject();
    await vi.waitFor(() => expect(finishSave).toBeTypeOf("function"));
    finishSave({
      documentId: "document-id",
      revision: 9,
      updatedAt: "2026-09-30T00:00:00.000Z"
    });
    await vi.waitFor(() => expect(finishOpen).toBeTypeOf("function"));
    await creating;
    expect(api.createProject).not.toHaveBeenCalled();
    expect(editor.interactionStates.at(-1)).toBe(false);
    expect(controller.getState().savePhase).toBe("restoring");
    expect(await controller.save()).toBe(false);
    finishOpen(null);
    await opening;
    expect(editor.interactionStates.at(-1)).toBe(true);
    expect(controller.getState().savePhase).toBe("saved");
  });

  it("keeps the editor locked if rejecting a project candidate fails", async () => {
    const { api, session } = createApi();
    const editor = new TestEditorAdapter();
    const controller = new DocumentSessionController(api, editor, "fixed-commit", 1);
    await controller.openProject();
    const compatible = await api.loadDocument({ sessionId: session.sessionId });
    vi.mocked(api.loadDocument).mockResolvedValue({
      ...compatible,
      editorEngineCommit: "different-commit"
    });
    vi.mocked(api.completeProjectOpen).mockRejectedValue(new Error("completion unavailable"));
    await controller.openProject();
    expect(controller.getState().session?.sessionId).toBe(session.sessionId);
    expect(controller.isEditorFailClosed()).toBe(true);
    expect(editor.openedSnapshots).toHaveLength(1);
    expect(editor.interactionStates.at(-1)).toBe(false);
    expect(await controller.save()).toBe(false);
    expect(await controller.prepareForClose()).toBe(true);
    expect(api.saveDocument).not.toHaveBeenCalled();
  });

  it.each([
    {
      patch: { editorEngine: "other" },
      message: "지원하지 않는 편집 엔진"
    },
    {
      patch: { editorEngineCommit: "different-commit" },
      message: "현재 엔진 commit과 호환되지 않습니다"
    },
    {
      patch: { editorSchemaVersion: 2 },
      message: "schema는 현재 버전과 호환되지 않습니다"
    }
  ])(
    "refuses an incompatible snapshot before it reaches Typie: $message",
    async ({ patch, message }) => {
      const { api } = createApi();
      const compatible = await api.loadDocument({
        sessionId: "4f336251-9411-49e6-8302-736f1ec11558"
      });
      vi.mocked(api.loadDocument).mockResolvedValue({
        ...compatible,
        ...patch
      });
      const editor = new TestEditorAdapter();
      const controller = new DocumentSessionController(
        api,
        editor,
        "fixed-commit",
        1
      );

      await controller.openProject();

      expect(editor.openedSnapshots).toHaveLength(0);
      expect(controller.getState()).toMatchObject({
        savePhase: "error"
      });
      expect(controller.getState().errorMessage).toContain(message);
    }
  );
});
