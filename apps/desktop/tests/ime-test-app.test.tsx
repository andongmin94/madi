import {
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { MadiDesktopApi } from "../src/shared/contracts";
import type {
  EditorChange,
  MadiEditorAdapter
} from "../src/renderer/editor/MadiEditorAdapter";
import { phase1bApiStubs } from "./phase1b-api-stubs";

class EmptyTestEditor implements MadiEditorAdapter {
  private readonly listeners = new Set<(change: EditorChange) => void>();

  public async open(): Promise<void> {}

  public async getSnapshot(): Promise<Uint8Array> {
    return Uint8Array.from([5, 4, 3]);
  }

  public async getPlainText(): Promise<string> {
    return "";
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
        revision: 1,
        reason: "content",
        canUndo: true,
        canRedo: false,
        isComposing: false
      });
    }
  }
}

function phase1ApiStubs(): Pick<
  MadiDesktopApi,
  | "getProjectTree"
  | "createNode"
  | "renameNode"
  | "moveNode"
  | "reorderNode"
  | "deleteNode"
  | "loadSceneDocument"
  | "saveSceneDocument"
  | "saveUiState"
  | "loadUiState"
  | "listDescendantScenes"
  | "searchProject"
  | "getTextStatistics"
  | "applyReplacementBatch"
  | "createNamedSnapshot"
  | "listNamedSnapshots"
  | "renameNamedSnapshot"
  | "deleteNamedSnapshot"
  | "diffNamedSnapshot"
  | "restoreNamedSnapshot"
> {
  const tree = {
    project: {
      id: "ime-project",
      title: "새 작품",
      authorName: null,
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z"
    },
    nodes: [
      {
        id: "ime-work",
        projectId: "ime-project",
        parentId: null,
        kind: "WORK" as const,
        title: "새 작품",
        orderKey: 1024,
        documentId: null,
        createdAt: "2026-08-02T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z"
      }
    ],
    revision: 0
  };
  return {
    ...phase1bApiStubs(),
    getProjectTree: vi.fn(async () => tree),
    createNode: vi.fn(async () => tree),
    renameNode: vi.fn(async () => tree),
    moveNode: vi.fn(async () => tree),
    reorderNode: vi.fn(async () => tree),
    deleteNode: vi.fn(async () => tree),
    loadSceneDocument: vi.fn(async () => {
      throw new Error("not used");
    }),
    saveSceneDocument: vi.fn(async () => {
      throw new Error("not used");
    }),
    saveUiState: vi.fn(async () => undefined),
    loadUiState: vi.fn(async () => ({ state: null }))
  };
}

function installMemoryStorage(): void {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() {
        return values.size;
      },
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value)
    } satisfies Storage
  });
}

describe("Phase 0.5 IME Test screen orchestration", () => {
  beforeEach(() => {
    installMemoryStorage();
    document.documentElement.inert = false;
    delete document.documentElement.dataset.closePending;
  });

  it("creates an empty Typie document, autosaves it, and redacts composition data", async () => {
    const api: MadiDesktopApi = {
      ...phase1ApiStubs(),
      createProject: vi.fn(async () => ({
        sessionId: "ime-session",
        fileName: "ime-check.madi",
        projectId: "ime-project",
        documentId: "ime-document",
        title: "새 작품",
        revision: 0
      })),
      openProject: vi.fn(async () => null),
      loadDocument: vi.fn(),
      saveDocument: vi.fn(async () => ({
        documentId: "ime-document",
        revision: 1,
        updatedAt: "2026-07-30T00:00:00.000Z"
      })),
      recoverPlainText: vi.fn(),
      getAppVersion: vi.fn(async () => "0.0.1"),
      onCloseRequested: vi.fn(() => () => undefined),
      completeCloseRequest: vi.fn(async () => true)
    };
    const editor = new EmptyTestEditor();

    render(
      <App
        api={api}
        adapterFactory={vi.fn(async () => editor)}
        typieCommit="fbe5c4bf860d1717a66e66bea2374a2e39f0dd26"
        editorSchemaVersion={1}
      />
    );

    const imePanelButton = screen.getByRole("button", {
      name: "한국어 IME 체크"
    });
    await waitFor(() => {
      expect((imePanelButton as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(imePanelButton);
    const createButton = await screen.findByRole("button", {
      name: "테스트용 빈 문서 생성"
    });
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(api.createProject).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId("ime-autosave-status").textContent).toBe(
        "자동 저장 대기 중"
      );
    });
    const mount = screen.getByTestId("typie-editor-mount");
    fireEvent.compositionStart(mount, { data: "비" });
    await new Promise((resolve) => window.setTimeout(resolve, 1_300));
    expect(api.saveDocument).not.toHaveBeenCalled();

    fireEvent.compositionEnd(mount, { data: "비밀" });
    await waitFor(
      () => {
        expect(api.saveDocument).toHaveBeenCalledTimes(1);
      },
      { timeout: 2_500 }
    );
    expect(api.saveDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: Uint8Array.from([5, 4, 3]),
        plainTextRecovery: ""
      })
    );
    expect(screen.getByTestId("ime-autosave-status").textContent).toBe(
      "snapshot 저장됨"
    );

    const lastEvent = screen.getByTestId("last-composition-event");
    expect(lastEvent.textContent).toContain("compositionend · dataLength 2");
    expect(lastEvent.textContent).not.toContain("비밀");
  });

  it("cancels window unload until a dirty document is saved", async () => {
    let requestClose: (() => void) | undefined;
    let resolveSave:
      | ((value: {
          documentId: string;
          revision: number;
          updatedAt: string;
        }) => void)
      | undefined;
    let resolveCloseAck: ((accepted: boolean) => void) | undefined;
    const api: MadiDesktopApi = {
      ...phase1ApiStubs(),
      createProject: vi.fn(async () => ({
        sessionId: "close-session",
        fileName: "close-check.madi",
        projectId: "close-project",
        documentId: "close-document",
        title: "새 작품",
        revision: 0
      })),
      openProject: vi.fn(async () => null),
      loadDocument: vi.fn(),
      saveDocument: vi.fn(
        () =>
          new Promise<{
            documentId: string;
            revision: number;
            updatedAt: string;
          }>((resolve) => {
            resolveSave = resolve;
          })
      ),
      recoverPlainText: vi.fn(),
      getAppVersion: vi.fn(async () => "0.0.1"),
      onCloseRequested: vi.fn((listener: () => void) => {
        requestClose = listener;
        return () => {
          requestClose = undefined;
        };
      }),
      completeCloseRequest: vi.fn(async (request) => {
        if (!request.readyToClose) {
          return true;
        }
        return new Promise<boolean>((resolve) => {
          resolveCloseAck = resolve;
        });
      })
    };
    const editor = new EmptyTestEditor();

    render(
      <App
        api={api}
        adapterFactory={vi.fn(async () => editor)}
        typieCommit="fbe5c4bf860d1717a66e66bea2374a2e39f0dd26"
        editorSchemaVersion={1}
      />
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "새 프로젝트" })
    );
    await waitFor(() => {
      expect(api.createProject).toHaveBeenCalledTimes(1);
    });
    editor.emitChanged();

    const mount = screen.getByTestId("typie-editor-mount");
    fireEvent.compositionStart(mount, { data: "비" });
    requestClose?.();

    await waitFor(() => {
      expect(api.completeCloseRequest).toHaveBeenCalledWith({
        readyToClose: false
      });
    });
    expect(api.saveDocument).not.toHaveBeenCalled();

    fireEvent.compositionEnd(mount, { data: "비밀" });
    vi.mocked(api.completeCloseRequest).mockClear();
    requestClose?.();

    await waitFor(() => {
      expect(api.saveDocument).toHaveBeenCalledTimes(1);
    });
    expect(api.completeCloseRequest).not.toHaveBeenCalled();

    resolveSave?.({
      documentId: "close-document",
      revision: 1,
      updatedAt: "2026-07-30T00:00:00.000Z"
    });
    await waitFor(() => {
      expect(api.completeCloseRequest).toHaveBeenCalledWith({
        readyToClose: true
      });
    });
    expect(document.documentElement.inert).toBe(true);
    expect(document.documentElement.dataset.closePending).toBe("true");

    resolveCloseAck?.(false);
    await waitFor(() => {
      expect(document.documentElement.inert).toBe(false);
    });
    expect(document.documentElement.dataset.closePending).toBeUndefined();

    vi.mocked(api.completeCloseRequest).mockClear();
    vi.mocked(api.completeCloseRequest).mockResolvedValue(true);
    requestClose?.();
    await waitFor(() => {
      expect(api.completeCloseRequest).toHaveBeenCalledWith({
        readyToClose: true
      });
    });
    expect(document.documentElement.inert).toBe(true);
    expect(document.documentElement.dataset.closePending).toBe("true");

    document.documentElement.inert = false;
    delete document.documentElement.dataset.closePending;
  });
});
