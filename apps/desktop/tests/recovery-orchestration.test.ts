import { describe, expect, it, vi } from "vitest";
import type {
  MadiDesktopApi,
  ProjectSession
} from "../src/shared/contracts";
import type {
  EditorChange,
  MadiEditorAdapter
} from "../src/renderer/editor/MadiEditorAdapter";
import { DocumentSessionController } from "../src/renderer/workspace/DocumentSessionController";

class TestEditorAdapter implements MadiEditorAdapter {
  public readonly openedSnapshots: Array<Uint8Array | undefined> = [];
  public snapshot = Uint8Array.from([7, 7, 7]);
  public plainText = "복구 본문";
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
