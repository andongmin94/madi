import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type {
  EditorChange,
  MadiEditorAdapter
} from "../src/renderer/editor/MadiEditorAdapter";
import type {
  LoadedSceneDocument,
  MadiDesktopApi,
  ProjectTree,
  WorldGraphNode,
  WorldGraphReadModel,
  WorldGraphUiState
} from "../src/shared/contracts";
import { phase1bApiStubs } from "./phase1b-api-stubs";

const NOW = "2026-08-02T00:00:00.000Z";
const REVISION = 5;

class GraphAppEditor implements MadiEditorAdapter {
  public readonly surface = document.createElement("div");

  public async open(): Promise<void> {}
  public async getSnapshot(): Promise<Uint8Array> {
    return Uint8Array.from([1, 2, 3]);
  }
  public async getPlainText(): Promise<string> {
    return "그래프 앱 테스트 본문";
  }
  public relocate(element: HTMLElement): void {
    element.replaceChildren(this.surface);
  }
  public revealTextRange(): void {}
  public focus(): void {}
  public undo(): void {}
  public redo(): void {}
  public insertSceneBreak(): void {}
  public onChanged(_listener: (change: EditorChange) => void): () => void {
    return () => undefined;
  }
}

const tree: ProjectTree = {
  project: {
    id: "project-1",
    title: "세계관 테스트",
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
      title: "세계관 테스트",
      orderKey: 1024,
      documentId: null,
      createdAt: NOW,
      updatedAt: NOW
    },
    {
      id: "volume-1",
      projectId: "project-1",
      parentId: "work-1",
      kind: "VOLUME",
      title: "1권",
      orderKey: 1024,
      documentId: null,
      createdAt: NOW,
      updatedAt: NOW
    },
    {
      id: "chapter-1",
      projectId: "project-1",
      parentId: "volume-1",
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
      title: "첫 장면",
      orderKey: 1024,
      documentId: "document-1",
      createdAt: NOW,
      updatedAt: NOW
    }
  ],
  revision: REVISION
};

const freshNode: WorldGraphNode = {
  id: "entity-1",
  projectId: "project-1",
  label: "최신 설정",
  kind: "CHARACTER",
  status: "ACTIVE",
  summary: "현재 revision의 설정",
  colorToken: null,
  iconKey: null,
  aliases: [],
  tags: [],
  explicitSceneLinkCount: 0,
  outgoingRelationCount: 0,
  incomingRelationCount: 0,
  undirectedRelationCount: 0
};

function graphModel(revision: number, label: string): WorldGraphReadModel {
  return {
    projectId: "project-1",
    revision,
    nodes: [{ ...freshNode, label }],
    edges: [],
    stats: {
      entityCount: 1,
      relationCount: 0,
      entityKindCounts: [
        { kind: "CHARACTER", count: 1 },
        { kind: "LOCATION", count: 0 },
        { kind: "ORGANIZATION", count: 0 },
        { kind: "ITEM", count: 0 },
        { kind: "EVENT", count: 0 },
        { kind: "WORLD_RULE", count: 0 },
        { kind: "FORESHADOWING", count: 0 },
        { kind: "OTHER", count: 0 }
      ],
      relationTypeCounts: [],
      topDegreeEntities: [],
      isolatedEntityCount: 1,
      directedRelationCount: 0,
      undirectedRelationCount: 0
    },
    diagnostics: []
  };
}

const restoredState: WorldGraphUiState = {
  mode: "FOCUSED",
  focusedEntityId: freshNode.id,
  depth: 2,
  filters: {
    kinds: ["CHARACTER"],
    statuses: ["ACTIVE", "DRAFT"],
    tagIds: [],
    tagMode: "ANY",
    relationTypeIds: [],
    relationDirection: "ALL",
    showIsolated: true,
    showLabels: true
  },
  layout: "preset",
  viewport: { zoom: 1.1, pan: { x: 12, y: -8 } },
  nodePositions: { [freshNode.id]: { x: 120, y: 80 } },
  selectedEntityId: freshNode.id
};

function loadedScene(): LoadedSceneDocument {
  return {
    sceneId: "scene-1",
    id: "document-1",
    projectId: "project-1",
    title: "첫 장면",
    editorEngine: "typie",
    editorEngineCommit: "fixed-commit",
    editorSchemaVersion: 1,
    snapshot: Uint8Array.from([1, 2, 3]),
    plainTextRecovery: "그래프 앱 테스트 본문",
    revision: REVISION,
    updatedAt: NOW
  };
}

function createApi(): MadiDesktopApi {
  let graphLoads = 0;
  return {
    ...phase1bApiStubs(),
    createProject: vi.fn(async () => null),
    openProject: vi.fn(async () => ({
      sessionId: "session-1",
      fileName: "세계관테스트.madi",
      projectId: "project-1",
      workNodeId: "work-1",
      sceneId: "scene-1",
      documentId: "document-1",
      title: "세계관 테스트",
      revision: REVISION
    })),
    saveDocument: vi.fn(async () => ({
      documentId: "document-1",
      revision: REVISION,
      updatedAt: NOW
    })),
    loadDocument: vi.fn(async () => loadedScene()),
    recoverPlainText: vi.fn(async () => ({
      documentId: "document-1",
      plainText: "그래프 앱 테스트 본문",
      revision: REVISION
    })),
    getProjectTree: vi.fn(async () => tree),
    createNode: vi.fn(async () => tree),
    renameNode: vi.fn(async () => tree),
    moveNode: vi.fn(async () => tree),
    reorderNode: vi.fn(async () => tree),
    deleteNode: vi.fn(async () => tree),
    loadSceneDocument: vi.fn(async () => loadedScene()),
    saveSceneDocument: vi.fn(async (request) => ({
      sceneId: request.sceneId,
      documentId: request.documentId,
      revision: REVISION,
      updatedAt: NOW,
      generation: request.generation,
      saveSequence: request.saveSequence
    })),
    saveUiState: vi.fn(async () => undefined),
    loadUiState: vi.fn(async () => ({
      state: {
        selectedNodeId: "scene-1",
        expandedNodeIds: ["work-1"],
        binderWidth: 300
      }
    })),
    loadWorldGraphUiState: vi.fn(async () => ({ state: restoredState })),
    saveWorldGraphUiState: vi.fn(async () => undefined),
    getWorldGraph: vi.fn(async () => {
      graphLoads += 1;
      return graphLoads === 1
        ? graphModel(REVISION - 1, "폐기할 오래된 설정")
        : graphModel(REVISION, freshNode.label);
    }),
    getEntityGraphDetail: vi.fn(async () => ({
      projectId: "project-1",
      revision: REVISION,
      entity: freshNode,
      outgoingRelations: [],
      incomingRelations: [],
      undirectedRelations: []
    })),
    getEntitySceneContext: vi.fn(async () => ({
      projectId: "project-1",
      revision: REVISION,
      entityId: freshNode.id,
      links: [
        {
          sceneNodeId: "scene-1",
          sceneTitle: "첫 장면",
          role: "POV" as const,
          note: null
        }
      ]
    })),
    discoverEntityMentions: vi.fn(async (request) => ({
      entityId: request.entityId,
      candidates: [],
      totalScenes: 0,
      offset: request.offset ?? 0,
      limit: request.limit ?? 200,
      hasMore: false,
      revision: REVISION
    })),
    getAppVersion: vi.fn(async () => "0.0.1"),
    onCloseRequested: vi.fn(() => () => undefined),
    completeCloseRequest: vi.fn(async () => true)
  };
}

function deferredVoid(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function renderOpenedGraph(api: MadiDesktopApi): Promise<void> {
  const editor = new GraphAppEditor();
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
  const graphButton = screen.getByRole("button", { name: "그래프" });
  await waitFor(() =>
    expect((graphButton as HTMLButtonElement).disabled).toBe(false)
  );
  fireEvent.click(graphButton);
  await waitFor(() => expect(api.getWorldGraph).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole("region", { name: "세계관 그래프" })).toBeTruthy();
  await waitFor(() =>
    expect(screen.getAllByText(freshNode.label).length).toBeGreaterThan(0)
  );
}

async function settleGraphStatePersistence(): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, 550));
}

describe("Phase 1D App graph integration", () => {
  it("restores graph state, drops stale data, opens Graph, and persists", async () => {
    const api = createApi();
    const editor = new GraphAppEditor();
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
    await waitFor(() => {
      expect(api.loadWorldGraphUiState).toHaveBeenCalledWith({
        sessionId: "session-1"
      });
      expect(api.getWorldGraph).not.toHaveBeenCalled();
    });

    const graphButton = screen.getByRole("button", { name: "그래프" });
    await waitFor(() => expect((graphButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(graphButton);

    expect(
      await screen.findByRole("region", { name: "세계관 그래프" })
    ).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(freshNode.label).length).toBeGreaterThan(0));
    expect(screen.queryByText("폐기할 오래된 설정")).toBeNull();
    expect(api.getWorldGraph).toHaveBeenCalledTimes(2);

    const savesBeforeExit = vi.mocked(api.saveWorldGraphUiState).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "원고" }));
    await waitFor(() =>
      expect(vi.mocked(api.saveWorldGraphUiState).mock.calls.length).toBeGreaterThan(
        savesBeforeExit
      )
    );
    expect(api.saveWorldGraphUiState).toHaveBeenLastCalledWith({
      sessionId: "session-1",
      state: expect.objectContaining({
        mode: "FOCUSED",
        focusedEntityId: freshNode.id,
        depth: 2,
        selectedEntityId: freshNode.id
      })
    });
  });

  it("awaits the current graph state before every project create/open entry", async () => {
    const api = createApi();
    await renderOpenedGraph(api);
    await settleGraphStatePersistence();
    vi.mocked(api.saveWorldGraphUiState).mockClear();

    const createSave = deferredVoid();
    vi.mocked(api.saveWorldGraphUiState).mockImplementationOnce(
      () => createSave.promise
    );
    fireEvent.click(screen.getByRole("button", { name: "새 프로젝트" }));
    await waitFor(() => expect(api.saveWorldGraphUiState).toHaveBeenCalledTimes(1));
    expect(api.createProject).not.toHaveBeenCalled();
    createSave.resolve();
    await waitFor(() => expect(api.createProject).toHaveBeenCalledTimes(1));

    const openCallsBefore = vi.mocked(api.openProject).mock.calls.length;
    const openSave = deferredVoid();
    vi.mocked(api.saveWorldGraphUiState).mockImplementationOnce(
      () => openSave.promise
    );
    fireEvent.click(screen.getByRole("button", { name: ".madi 열기" }));
    await waitFor(() => expect(api.saveWorldGraphUiState).toHaveBeenCalledTimes(2));
    expect(api.openProject).toHaveBeenCalledTimes(openCallsBefore);
    openSave.resolve();
    await waitFor(() =>
      expect(api.openProject).toHaveBeenCalledTimes(openCallsBefore + 1)
    );
  });

  it("fails closed without an unhandled rejection when graph state saving fails", async () => {
    const api = createApi();
    await renderOpenedGraph(api);
    await settleGraphStatePersistence();
    vi.mocked(api.saveWorldGraphUiState).mockClear();
    vi.mocked(api.saveWorldGraphUiState).mockRejectedValue(
      new Error("graph state save rejected")
    );

    const openCallsBefore = vi.mocked(api.openProject).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: ".madi 열기" }));
    expect(await screen.findByText("graph state save rejected")).toBeTruthy();
    expect(api.openProject).toHaveBeenCalledTimes(openCallsBefore);
    expect(screen.getByRole("region", { name: "세계관 그래프" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "새 프로젝트" }));
    await waitFor(() => expect(api.saveWorldGraphUiState).toHaveBeenCalledTimes(2));
    expect(api.createProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "원고" }));
    await waitFor(() => expect(api.saveWorldGraphUiState).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("region", { name: "세계관 그래프" })).toBeTruthy();

    fireEvent.click(screen.getByText("키보드용 그래프 목록"));
    fireEvent.click(
      screen.getByRole("button", { name: "최신 설정 · CHARACTER" })
    );
    await screen.findByTestId("world-graph-detail");
    fireEvent.click(
      screen.getByRole("button", { name: "설정 상세에서 열기" })
    );
    await waitFor(() => expect(api.saveWorldGraphUiState).toHaveBeenCalledTimes(4));
    expect(api.loadEntityNote).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "세계관 그래프" })).toBeTruthy();
  });

  it("keeps Graph mode when opening an entity note fails", async () => {
    const api = createApi();
    vi.mocked(api.loadEntityNote).mockRejectedValue(
      new Error("entity note load rejected")
    );
    await renderOpenedGraph(api);

    fireEvent.click(screen.getByText("키보드용 그래프 목록"));
    fireEvent.click(
      screen.getByRole("button", { name: "최신 설정 · CHARACTER" })
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "설정 상세에서 열기" })
    );

    expect(
      (await screen.findAllByText("entity note load rejected")).length
    ).toBeGreaterThan(0);
    expect(api.loadEntityNote).toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "세계관 그래프" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "설정 작업 공간" })).toBeNull();
  });
});
