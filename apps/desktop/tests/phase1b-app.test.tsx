import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type {
  EditorChange,
  EditorReplacementDocument,
  EditorTextReplacement,
  MadiEditorAdapter
} from "../src/renderer/editor/MadiEditorAdapter";
import type {
  ApplyReplacementBatchRequest,
  LoadedSceneDocument,
  MadiDesktopApi,
  ProjectTree,
  SearchHit
} from "../src/shared/contracts";
import { phase1bApiStubs } from "./phase1b-api-stubs";

const NOW = "2026-08-02T00:00:00.000Z";

const tree: ProjectTree = {
  project: {
    id: "project-1",
    title: "닫힌 성문",
    authorName: null,
    createdAt: NOW,
    updatedAt: NOW
  },
  nodes: [
    {
      id: "work-1",
      projectId: "project-1",
      parentId: null,
      kind: "WORK",
      title: "닫힌 성문",
      orderKey: 1024,
      documentId: null,
      createdAt: NOW,
      updatedAt: NOW
    },
    {
      id: "chapter-1",
      projectId: "project-1",
      parentId: "work-1",
      kind: "CHAPTER",
      title: "1화",
      orderKey: 1024,
      documentId: null,
      createdAt: NOW,
      updatedAt: NOW
    },
    {
      id: "scene-1",
      projectId: "project-1",
      parentId: "chapter-1",
      kind: "SCENE",
      title: "문 앞",
      orderKey: 1024,
      documentId: "document-1",
      createdAt: NOW,
      updatedAt: NOW
    },
    {
      id: "scene-2",
      projectId: "project-1",
      parentId: "chapter-1",
      kind: "SCENE",
      title: "빈 방",
      orderKey: 2048,
      documentId: "document-2",
      createdAt: NOW,
      updatedAt: NOW
    }
  ],
  revision: 1
};

function loadedScene(sceneId: string, revision: number): LoadedSceneDocument {
  const suffix = sceneId.at(-1) ?? "1";
  return {
    sceneId,
    id: `document-${suffix}`,
    projectId: "project-1",
    title: sceneId === "scene-1" ? "문 앞" : "빈 방",
    editorEngine: "typie",
    editorEngineCommit: "fixed-commit",
    editorSchemaVersion: 1,
    snapshot: Uint8Array.from([Number(suffix), revision]),
    plainTextRecovery:
      sceneId === "scene-1" ? "그는 문을 열었다." : "방은 비어 있었다.",
    revision,
    updatedAt: NOW
  };
}

class RelocatingEditor implements MadiEditorAdapter {
  private readonly listeners = new Set<(change: EditorChange) => void>();
  public readonly surface = document.createElement("div");
  public readonly revealedRanges: Array<readonly [number, number]> = [];
  public readonly replacementCalls: EditorTextReplacement[][] = [];

  public constructor() {
    this.surface.dataset.testid = "typie-runtime-surface";
  }

  public async open(): Promise<void> {}
  public async getSnapshot(): Promise<Uint8Array> {
    return Uint8Array.from([9, 9, 9]);
  }
  public async getPlainText(): Promise<string> {
    return "수정된 현재 장면";
  }
  public relocate(element: HTMLElement): void {
    element.replaceChildren(this.surface);
  }
  public revealTextRange(start: number, end: number): void {
    this.revealedRanges.push([start, end]);
  }
  public async replaceTextRanges(
    replacements: readonly EditorTextReplacement[]
  ): Promise<EditorReplacementDocument> {
    this.replacementCalls.push([...replacements]);
    return {
      snapshot: Uint8Array.from([7, 7, 7]),
      plainTextRecovery: "별은 비어 있었다.",
      semanticSceneBreakCount: 0
    };
  }
  public focus(): void {}
  public undo(): void {}
  public redo(): void {}
  public insertSceneBreak(): void {}
  public onChanged(listener: (change: EditorChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  public emitDirty(): void {
    for (const listener of this.listeners) {
      listener({
        revision: 2,
        reason: "content",
        canUndo: true,
        canRedo: false,
        isComposing: false
      });
    }
  }
}

function createApi(calls: string[]): MadiDesktopApi {
  let revision = 1;
  const bodyHit: SearchHit = {
    occurrenceId: "scene-2:BODY:0:1",
    nodeId: "scene-2",
    sceneId: "scene-2",
    documentId: "document-2",
    nodeKind: "SCENE",
    nodeTitle: "빈 방",
    field: "BODY",
    start: 0,
    end: 1,
    contextBefore: "",
    matchedText: "방",
    contextAfter: "은 비어 있었다.",
    sourceContentHash: "b".repeat(64)
  };
  const automaticSnapshot = {
    id: "snapshot-auto",
    projectId: "project-1",
    name: "전체 치환 전",
    note: null,
    kind: "AUTO_BEFORE_REPLACE" as const,
    payloadFormat: "madi-logical-project",
    payloadVersion: 1,
    payloadBytes: 100,
    contentHash: "f".repeat(64),
    createdAt: NOW,
    updatedAt: NOW
  };
  return {
    ...phase1bApiStubs(),
    createProject: vi.fn(async () => null),
    openProject: vi.fn(async () => ({
      sessionId: "session-1",
      fileName: "닫힌성문.madi",
      projectId: "project-1",
      documentId: "document-1",
      sceneId: "scene-1",
      workNodeId: "work-1",
      title: "닫힌 성문",
      revision
    })),
    saveDocument: vi.fn(async () => ({
      documentId: "document-1",
      revision: ++revision,
      updatedAt: NOW
    })),
    loadDocument: vi.fn(async () => loadedScene("scene-1", revision)),
    recoverPlainText: vi.fn(async () => ({
      documentId: "document-1",
      plainText: "그는 문을 열었다.",
      revision
    })),
    getProjectTree: vi.fn(async () => ({ ...tree, revision })),
    createNode: vi.fn(async () => ({ ...tree, revision })),
    renameNode: vi.fn(async () => ({ ...tree, revision })),
    moveNode: vi.fn(async () => ({ ...tree, revision })),
    reorderNode: vi.fn(async () => ({ ...tree, revision })),
    deleteNode: vi.fn(async () => ({ ...tree, revision })),
    loadSceneDocument: vi.fn(async ({ sceneId }) => {
      calls.push(`load:${sceneId}`);
      return loadedScene(sceneId, revision);
    }),
    saveSceneDocument: vi.fn(async (request) => {
      calls.push(`save:${request.sceneId}`);
      revision += 1;
      return {
        sceneId: request.sceneId,
        documentId: request.documentId,
        revision,
        updatedAt: NOW,
        generation: request.generation,
        saveSequence: request.saveSequence
      };
    }),
    saveUiState: vi.fn(async () => undefined),
    loadUiState: vi.fn(async () => ({
      state: {
        selectedNodeId: "work-1",
        expandedNodeIds: ["work-1", "chapter-1"],
        binderWidth: 300
      }
    })),
    listDescendantScenes: vi.fn(async (request) => {
      const allScenes = [
        {
          sceneId: "scene-1",
          documentId: "document-1",
          plainTextRecovery: "그는 문을 열었다.",
          sourceContentHash: "a".repeat(64),
          updatedAt: NOW
        },
        {
          sceneId: "scene-2",
          documentId: "document-2",
          plainTextRecovery: "방은 비어 있었다.",
          sourceContentHash: "b".repeat(64),
          updatedAt: NOW
        }
      ];
      const offset = request.offset ?? 0;
      const scenes = allScenes.slice(offset, offset + 1);
      const nextOffset = offset + scenes.length;
      return {
        scopeNodeId: request.scopeNodeId,
        scenes,
        totalScenes: allScenes.length,
        offset,
        limit: 1,
        nextOffset: nextOffset < allScenes.length ? nextOffset : null,
        hasMore: nextOffset < allScenes.length,
        revision
      };
    }),
    searchProject: vi.fn(async (request) => ({
      query: request.query,
      caseSensitive: request.caseSensitive,
      target: request.target,
      scopeNodeId: request.scopeNodeId ?? "work-1",
      totalMatches: 1,
      sceneCount: 1,
      offset: request.offset ?? 0,
      limit: request.limit ?? 100,
      hasMore: false,
      hits: [bodyHit],
      revision
    })),
    getTextStatistics: vi.fn(async (request) => ({
      scopeNodeId: request.scopeNodeId,
      sceneCount: request.scopeNodeId === "scene-1" ? 1 : 2,
      withSpaces: 18,
      withoutSpaces: 14,
      scenes: [
        {
          sceneId: "scene-1",
          documentId: "document-1",
          withSpaces: 9,
          withoutSpaces: 7
        },
        {
          sceneId: "scene-2",
          documentId: "document-2",
          withSpaces: 9,
          withoutSpaces: 7
        }
      ],
      revision
    })),
    applyReplacementBatch: vi.fn(async (request: ApplyReplacementBatchRequest) => {
      revision += 1;
      return {
        safetySnapshot: automaticSnapshot,
        changedSceneIds: request.transformedScenes.map(
          (scene) => scene.sceneId
        ),
        changedScenes: request.transformedScenes.length,
        changedOccurrences: request.transformedScenes.reduce(
          (total, scene) => total + scene.occurrenceCount,
          0
        ),
        revision
      };
    }),
    listNamedSnapshots: vi.fn(async () => ({ snapshots: [], revision })),
    getAppVersion: vi.fn(async () => "0.0.1"),
    onCloseRequested: vi.fn(() => () => undefined),
    completeCloseRequest: vi.fn(async () => true)
  };
}

describe("Phase 1B App renderer integration", () => {
  it("moves one live editor through ordered Scrivenings and back to SCENE mode", async () => {
    const calls: string[] = [];
    const api = createApi(calls);
    const editor = new RelocatingEditor();
    render(
      <App
        api={api}
        adapterFactory={vi.fn(async (mount) => {
          editor.relocate(mount);
          return editor;
        })}
        typieCommit="fixed-commit"
        editorSchemaVersion={1}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: ".madi 열기" }));
    expect(await screen.findByRole("region", { name: "연속 원고 보기" })).toBeTruthy();
    const blocks = document.querySelectorAll("[data-scene-id]");
    expect(Array.from(blocks).map((block) => block.getAttribute("data-scene-id"))).toEqual([
      "scene-1",
      "scene-2"
    ]);
    await waitFor(() => {
      expect(document.querySelectorAll("[data-live-editor-slot]")).toHaveLength(1);
      expect(document.querySelectorAll("[data-testid='typie-runtime-surface']")).toHaveLength(1);
    });

    editor.emitDirty();
    fireEvent.click(screen.getByRole("button", { name: "빈 방 장면 편집" }));
    await waitFor(() => {
      expect(
        document
          .querySelector('[data-scene-id="scene-2"]')
          ?.getAttribute("data-active")
      ).toBe("true");
    });
    expect(calls.indexOf("save:scene-1")).toBeLessThan(
      calls.lastIndexOf("load:scene-2")
    );
    expect(document.querySelectorAll("[data-live-editor-slot]")).toHaveLength(1);

    const binder = screen.getByRole("tree", { name: "작품 Binder 트리" });
    fireEvent.click(within(binder).getByRole("button", { name: "문 앞" }));
    await waitFor(() => {
      expect(
        screen.getByTestId("typie-editor-mount").contains(editor.surface)
      ).toBe(true);
    });
    expect(document.querySelectorAll("[data-live-editor-slot]")).toHaveLength(0);
  });

  it("opens an exact BODY search hit in the single editor and reveals its range", async () => {
    const api = createApi([]);
    const editor = new RelocatingEditor();
    render(
      <App
        api={api}
        adapterFactory={vi.fn(async (mount) => {
          editor.relocate(mount);
          return editor;
        })}
        typieCommit="fixed-commit"
        editorSchemaVersion={1}
      />
    );
    fireEvent.click(await screen.findByRole("button", { name: ".madi 열기" }));
    await screen.findByRole("region", { name: "연속 원고 보기" });
    fireEvent.click(screen.getByRole("button", { name: "검색 · 치환" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "찾을 문자열" }), {
      target: { value: "방" }
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "본문 방 은 비어 있었다." })
    );

    await waitFor(() => expect(editor.revealedRanges).toEqual([[0, 1]]));
    expect(screen.getByTestId("typie-editor-mount").contains(editor.surface)).toBe(
      true
    );
  });

  it("selects the first active-scene match in the live Typie editor", async () => {
    const api = createApi([]);
    vi.mocked(api.searchProject).mockImplementation(async (request) => ({
      query: request.query,
      caseSensitive: request.caseSensitive,
      target: request.target,
      scopeNodeId: request.scopeNodeId ?? "work-1",
      totalMatches: 1,
      sceneCount: 1,
      offset: 0,
      limit: request.limit ?? 100,
      hasMore: false,
      hits: [
        {
          occurrenceId: "scene-1:BODY:0:1",
          nodeId: "scene-1",
          sceneId: "scene-1",
          documentId: "document-1",
          nodeKind: "SCENE",
          nodeTitle: "문 앞",
          field: "BODY",
          start: 0,
          end: 1,
          contextBefore: "",
          matchedText: "그",
          contextAfter: "는 문을 열었다.",
          sourceContentHash: "a".repeat(64)
        }
      ],
      revision: 1
    }));
    const editor = new RelocatingEditor();
    render(
      <App
        api={api}
        adapterFactory={vi.fn(async (mount) => {
          editor.relocate(mount);
          return editor;
        })}
        typieCommit="fixed-commit"
        editorSchemaVersion={1}
      />
    );
    fireEvent.click(await screen.findByRole("button", { name: ".madi 열기" }));
    await screen.findByRole("region", { name: "연속 원고 보기" });
    fireEvent.click(screen.getByRole("button", { name: "검색 · 치환" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "찾을 문자열" }), {
      target: { value: "그" }
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));

    await waitFor(() => expect(editor.revealedRanges).toEqual([[0, 1]]));
  });

  it("applies only selected BODY hits through the semantic replacement batch", async () => {
    const api = createApi([]);
    const editor = new RelocatingEditor();
    render(
      <App
        api={api}
        adapterFactory={vi.fn(async (mount) => {
          editor.relocate(mount);
          return editor;
        })}
        typieCommit="fixed-commit"
        editorSchemaVersion={1}
      />
    );
    fireEvent.click(await screen.findByRole("button", { name: ".madi 열기" }));
    await screen.findByRole("region", { name: "연속 원고 보기" });
    fireEvent.click(screen.getByRole("button", { name: "검색 · 치환" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "찾을 문자열" }), {
      target: { value: "방" }
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));
    await screen.findByRole("button", { name: "본문 방 은 비어 있었다." });
    fireEvent.change(screen.getByRole("textbox", { name: "바꿀 문자열" }), {
      target: { value: "별" }
    });
    const apply = screen.getByRole("button", {
      name: "선택 항목 치환 적용"
    }) as HTMLButtonElement;
    await waitFor(() => expect(apply.disabled).toBe(false));
    fireEvent.click(apply);

    await waitFor(() =>
      expect(vi.mocked(api.applyReplacementBatch)).toHaveBeenCalledTimes(1)
    );
    expect(editor.replacementCalls).toEqual([
      [
        {
          id: "scene-2:BODY:0:1",
          start: 0,
          end: 1,
          expectedText: "방",
          replacement: "별"
        }
      ]
    ]);
    expect(vi.mocked(api.applyReplacementBatch)).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "방",
        replacement: "별",
        caseSensitive: false,
        transformedScenes: [
          expect.objectContaining({
            sceneId: "scene-2",
            documentId: "document-2",
            sourceContentHash: "b".repeat(64),
            occurrenceCount: 1
          })
        ]
      })
    );
  });
});
