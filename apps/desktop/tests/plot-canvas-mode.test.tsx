import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef, startTransition } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const workspaceControl = vi.hoisted(() => ({
  flushCalls: 0,
  flushImpl: async (): Promise<void> => undefined,
  addedItems: [] as unknown[],
  addedCanvasItems: [] as Array<{ canvasId: string; item: unknown }>,
  lastSavePromise: null as Promise<unknown> | null
}));

vi.mock("../src/renderer/components/plotCanvas", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/renderer/components/plotCanvas")
  >();
  const React = await import("react");
  const PlotCanvasWorkspace = React.forwardRef(function FakePlotCanvasWorkspace(
    props: any,
    ref
  ) {
    React.useImperativeHandle(ref, () => ({
      async flush() {
        workspaceControl.flushCalls += 1;
        await workspaceControl.flushImpl();
      },
      getDocument: () => props.document,
      addPickerItem(item: unknown) {
        workspaceControl.addedItems.push(item);
        workspaceControl.addedCanvasItems.push({ canvasId: props.canvasId, item });
      }
    }));
    const save = () => {
      const request = {
        canvasId: props.canvasId,
        generation: 12,
        saveSequence: 34,
        document: {
          ...props.document,
          nodes: [
            ...props.document.nodes,
            {
              id: "workspace-added",
              type: "text",
              x: 10,
              y: 20,
              width: 240,
              height: 140,
              text: "workspace edit",
              madi: { nodeKind: "TEXT" }
            }
          ]
        }
      };
      const promise = Promise.resolve().then(() => props.onSave(request));
      workspaceControl.lastSavePromise = promise;
      void promise.catch(() => undefined);
    };
    return React.createElement(
      "section",
      {
        role: "region",
        "aria-label": "가짜 Plot Canvas",
        "data-testid": "fake-plot-canvas",
        "data-canvas-id": props.canvasId,
        "data-initial-zoom": String(props.initialUiState?.viewport.zoom ?? "none"),
        "data-scene-ids": props.catalog.scenes
          .map((scene: { readonly id: string }) => scene.id)
          .join(",")
      },
      React.createElement("button", { type: "button", onClick: save }, "workspace save"),
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () =>
            props.onUiStateChange({
              viewport: { x: 90, y: -20, zoom: 1.4 },
              selectedElementId: "node-restored",
              inspectorWidth: 410,
              showGrid: false,
              showMinimap: true,
              snapToGrid: true
            })
        },
        "workspace UI change"
      ),
      React.createElement(
        "button",
        { type: "button", onClick: () => props.onOpenEntity("entity-1") },
        "workspace entity open"
      ),
      React.createElement(
        "button",
        { type: "button", onClick: () => props.onOpenScene("scene-1") },
        "workspace scene open"
      )
    );
  });
  return { ...actual, PlotCanvasWorkspace };
});

import {
  PlotCanvasMode,
  type PlotCanvasModeHandle,
  type PlotCanvasModeProps
} from "../src/renderer/components/PlotCanvasMode";
import type {
  CanvasRecord,
  CanvasSummary,
  EntityRecord,
  MadiCanvasDocument,
  MadiDesktopApi,
  PlotCanvasUiState,
  ProjectTree
} from "../src/shared/contracts";
import { phase1bApiStubs } from "./phase1b-api-stubs";

const NOW = "2026-08-08T00:00:00.000Z";
const EMPTY_DOCUMENT: MadiCanvasDocument = { nodes: [], edges: [] };
const DOCUMENT_WITH_CONTENT: MadiCanvasDocument = {
  nodes: [
    {
      id: "node-1",
      type: "text",
      x: 10,
      y: 20,
      width: 240,
      height: 140,
      text: "플롯 메모",
      madi: { nodeKind: "TEXT" }
    },
    {
      id: "node-2",
      type: "text",
      x: 320,
      y: 20,
      width: 260,
      height: 150,
      text: "레이아",
      madi: {
        nodeKind: "ENTITY_REFERENCE",
        entityId: "entity-1",
        originalLabel: "레이아"
      }
    }
  ],
  edges: [
    {
      id: "edge-1",
      fromNode: "node-1",
      toNode: "node-2",
      fromEnd: "none",
      toEnd: "arrow"
    }
  ]
};

function canvasRecord(
  id: string,
  name: string,
  revision: number,
  document: MadiCanvasDocument = EMPTY_DOCUMENT
): CanvasRecord {
  return {
    id,
    projectId: "project-1",
    name,
    description: `${name} 설명`,
    documentFormat: "JSON_CANVAS",
    documentVersion: "1.0",
    document,
    contentHash: id.padEnd(64, "0").slice(0, 64),
    revision,
    nodeCount: document.nodes.length,
    edgeCount: document.edges.length,
    createdAt: NOW,
    updatedAt: NOW
  };
}

function summary(record: CanvasRecord): CanvasSummary {
  const { document: _document, ...canvasSummary } = record;
  return canvasSummary;
}

const tree: ProjectTree = {
  project: {
    id: "project-1",
    title: "Canvas Test",
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
      title: "Canvas Test",
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
      title: "성문 앞",
      orderKey: 1024,
      documentId: "document-1",
      createdAt: NOW,
      updatedAt: NOW
    }
  ],
  revision: 9
};

const entity: EntityRecord = {
  id: "entity-1",
  projectId: "project-1",
  kind: "CHARACTER",
  name: "레이아",
  summary: "북부 출신 마법사",
  documentId: "entity-document-1",
  status: "ACTIVE",
  colorToken: "#4263eb",
  iconKey: null,
  attributes: {},
  duplicateName: false,
  createdAt: NOW,
  updatedAt: NOW
};

interface CanvasApiEnvironment {
  readonly api: MadiDesktopApi;
  readonly store: Map<string, CanvasRecord>;
}

function createCanvasApi(
  restoredState: PlotCanvasUiState | null = null
): CanvasApiEnvironment {
  const store = new Map<string, CanvasRecord>([
    ["canvas-a", canvasRecord("canvas-a", "전체 플롯", 3, DOCUMENT_WITH_CONTENT)],
    ["canvas-b", canvasRecord("canvas-b", "결말 후보", 7)],
    ["canvas-c", canvasRecord("canvas-c", "인물 동선", 2)]
  ]);
  let projectRevision = 20;
  let created = 0;
  const listCanvases = vi.fn(
    async (request: Parameters<MadiDesktopApi["listCanvases"]>[0]) => {
      const canvases = [...store.values()].map(summary);
      const sorted = [...canvases].sort((left, right) => {
        if (request.sort === "NAME_ASC") {
          return left.name.localeCompare(right.name, "ko-KR");
        }
        if (request.sort === "NAME_DESC") {
          return right.name.localeCompare(left.name, "ko-KR");
        }
        return right.revision - left.revision;
      });
      return { canvases: sorted, revision: projectRevision };
    }
  );
  const api = {
    ...phase1bApiStubs(),
    listDescendantScenes: vi.fn(async () => ({
      scopeNodeId: "work-1",
      scenes: [
        {
          sceneId: "scene-1",
          documentId: "document-1",
          title: "성문 앞",
          orderPath: [1024, 1024],
          plainTextRecovery: "레이아가 돌아왔다. 다음 문장.",
          editorEngine: "typie",
          editorSchemaVersion: 1,
          updatedAt: NOW
        }
      ],
      totalScenes: 1,
      offset: 0,
      limit: 1000,
      nextOffset: null,
      hasMore: false,
      revision: projectRevision
    })),
    listCanvases,
    loadCanvas: vi.fn(
      async (request: Parameters<MadiDesktopApi["loadCanvas"]>[0]) => {
        const record = store.get(request.canvasId);
        if (!record) {
          throw new Error("missing canvas");
        }
        return record;
      }
    ),
    createCanvas: vi.fn(
      async (request: Parameters<MadiDesktopApi["createCanvas"]>[0]) => {
        created += 1;
        projectRevision += 1;
        const record = canvasRecord(
          `canvas-new-${created}`,
          request.name,
          1,
          request.document ?? EMPTY_DOCUMENT
        );
        store.set(record.id, record);
        return { canvas: record, revision: projectRevision, noOp: false };
      }
    ),
    updateCanvas: vi.fn(
      async (request: Parameters<MadiDesktopApi["updateCanvas"]>[0]) => {
        const current = store.get(request.canvasId)!;
        const record: CanvasRecord = {
          ...current,
          name: request.name,
          description: request.description,
          revision: current.revision + 1
        };
        store.set(record.id, record);
        projectRevision += 1;
        return { canvas: record, revision: projectRevision, noOp: false };
      }
    ),
    duplicateCanvas: vi.fn(
      async (request: Parameters<MadiDesktopApi["duplicateCanvas"]>[0]) => {
        const source = store.get(request.sourceCanvasId)!;
        created += 1;
        projectRevision += 1;
        const record = canvasRecord(
          `canvas-new-${created}`,
          request.name ?? `${source.name} 복사본`,
          1,
          source.document
        );
        store.set(record.id, record);
        return { canvas: record, revision: projectRevision, noOp: false };
      }
    ),
    deleteCanvas: vi.fn(
      async (request: Parameters<MadiDesktopApi["deleteCanvas"]>[0]) => {
        store.delete(request.canvasId);
        projectRevision += 1;
        return { deletedCanvasId: request.canvasId, revision: projectRevision };
      }
    ),
    saveCanvas: vi.fn(
      async (request: Parameters<MadiDesktopApi["saveCanvas"]>[0]) => {
        const current = store.get(request.canvasId)!;
        const record = canvasRecord(
          current.id,
          current.name,
          current.revision + 1,
          request.document
        );
        store.set(record.id, record);
        projectRevision += 1;
        return {
          canvasId: request.canvasId,
          generation: request.generation,
          saveSequence: request.saveSequence,
          canvas: record,
          revision: projectRevision,
          noOp: false
        };
      }
    ),
    savePlotCanvasUiState: vi.fn(async () => undefined),
    loadPlotCanvasUiState: vi.fn(async () => ({ state: restoredState })),
    pickCanvasImport: vi.fn(async () => null),
    exportCanvas: vi.fn(async () => ({ fileName: "canvas.canvas", bytes: 120 }))
  } as unknown as MadiDesktopApi;
  return { api, store };
}

function modeProps(
  api: MadiDesktopApi,
  overrides: Partial<PlotCanvasModeProps> = {}
): PlotCanvasModeProps {
  return {
    api,
    sessionId: "session-1",
    projectTree: tree,
    entities: [entity],
    aliases: new Map(),
    tags: new Map(),
    relations: [],
    onProjectRevision: vi.fn(),
    onOpenEntity: vi.fn(),
    onOpenScene: vi.fn(),
    ...overrides
  };
}

async function renderReady(
  api: MadiDesktopApi,
  overrides: Partial<PlotCanvasModeProps> = {},
  ref = createRef<PlotCanvasModeHandle>()
) {
  render(<PlotCanvasMode ref={ref} {...modeProps(api, overrides)} />);
  await screen.findByRole("region", { name: "가짜 Plot Canvas" });
  return ref;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  workspaceControl.flushCalls = 0;
  workspaceControl.flushImpl = async () => undefined;
  workspaceControl.addedItems = [];
  workspaceControl.addedCanvasItems = [];
  workspaceControl.lastSavePromise = null;
});

describe("PlotCanvasMode integration", () => {
  it("does not restart project loading when the revision observer identity changes", async () => {
    const { api } = createCanvasApi({ lastCanvasId: "canvas-a", canvasStates: {} });
    const props = modeProps(api);
    const rendered = render(<PlotCanvasMode {...props} />);
    await screen.findByRole("region", { name: "가짜 Plot Canvas" });
    const listCalls = vi.mocked(api.listCanvases).mock.calls.length;
    const uiLoadCalls = vi.mocked(api.loadPlotCanvasUiState).mock.calls.length;

    rendered.rerender(
      <PlotCanvasMode {...props} onProjectRevision={vi.fn()} />
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(api.listCanvases).toHaveBeenCalledTimes(listCalls);
    expect(api.loadPlotCanvasUiState).toHaveBeenCalledTimes(uiLoadCalls);
  });

  it("accumulates every descendant-scene page before publishing the picker catalog", async () => {
    const { api } = createCanvasApi({ lastCanvasId: "canvas-a", canvasStates: {} });
    vi.mocked(api.listDescendantScenes).mockImplementation(async (request) => {
      const common = {
        scopeNodeId: "work-1",
        totalScenes: 1_001,
        limit: 1_000,
        revision: 20
      } as const;
      if (request.offset === 0) {
        return {
          ...common,
          scenes: [
            {
              sceneId: "scene-1",
              documentId: "document-1",
              title: "성문 앞",
              orderPath: [1024, 1024],
              plainTextRecovery: "첫 페이지 장면.",
              editorEngine: "typie" as const,
              editorSchemaVersion: 1 as const,
              sourceContentHash: "a".repeat(64),
              updatedAt: NOW
            }
          ],
          offset: 0,
          nextOffset: 1_000,
          hasMore: true
        };
      }
      return {
        ...common,
        scenes: [
          {
            sceneId: "scene-1001",
            documentId: "document-1001",
            title: "마지막 장면",
            orderPath: [2048, 1024],
            plainTextRecovery: "두 번째 페이지 장면.",
            editorEngine: "typie" as const,
            editorSchemaVersion: 1 as const,
            sourceContentHash: "b".repeat(64),
            updatedAt: NOW
          }
        ],
        offset: 1_000,
        nextOffset: null,
        hasMore: false
      };
    });

    await renderReady(api);
    expect(api.listDescendantScenes).toHaveBeenNthCalledWith(1, {
      sessionId: "session-1",
      scopeNodeId: "work-1",
      offset: 0,
      limit: 1_000
    });
    expect(api.listDescendantScenes).toHaveBeenNthCalledWith(2, {
      sessionId: "session-1",
      scopeNodeId: "work-1",
      offset: 1_000,
      limit: 1_000
    });
    expect(screen.getByTestId("fake-plot-canvas").dataset.sceneIds).toBe(
      "scene-1,scene-1001"
    );
  });

  it("restores the last canvas/view state, persists UI state and flushes before sort", async () => {
    const restored: PlotCanvasUiState = {
      lastCanvasId: "canvas-b",
      canvasStates: {
        "canvas-b": {
          viewport: { x: 12, y: -8, zoom: 1.25 },
          selectedElementId: null,
          inspectorWidth: 390,
          showGrid: false,
          showMinimap: true,
          snapToGrid: true
        }
      }
    };
    const { api } = createCanvasApi(restored);
    const ref = await renderReady(api);
    expect(screen.getByTestId("fake-plot-canvas").dataset.canvasId).toBe("canvas-b");
    expect(screen.getByTestId("fake-plot-canvas").dataset.initialZoom).toBe("1.25");
    expect(api.loadPlotCanvasUiState).toHaveBeenCalledWith({ sessionId: "session-1" });

    fireEvent.click(screen.getByRole("button", { name: "workspace UI change" }));
    await ref.current!.flush();
    expect(api.savePlotCanvasUiState).toHaveBeenLastCalledWith({
      sessionId: "session-1",
      state: expect.objectContaining({
        lastCanvasId: "canvas-b",
        canvasStates: expect.objectContaining({
          "canvas-b": expect.objectContaining({
            viewport: { x: 90, y: -20, zoom: 1.4 },
            inspectorWidth: 410
          })
        })
      })
    });

    const savesBeforeSort = workspaceControl.flushCalls;
    fireEvent.change(screen.getByRole("combobox", { name: "캔버스 정렬" }), {
      target: { value: "NAME_ASC" }
    });
    await waitFor(() =>
      expect(api.listCanvases).toHaveBeenLastCalledWith({
        sessionId: "session-1",
        sort: "NAME_ASC"
      })
    );
    expect(workspaceControl.flushCalls).toBeGreaterThan(savesBeforeSort);
  });

  it("performs metadata, duplicate, count-confirmed delete and create transactions", async () => {
    const { api } = createCanvasApi({ lastCanvasId: "canvas-a", canvasStates: {} });
    await renderReady(api);
    fireEvent.change(screen.getByRole("textbox", { name: "캔버스 이름" }), {
      target: { value: "수정된 플롯" }
    });
    fireEvent.change(screen.getByRole("textbox", { name: "캔버스 설명" }), {
      target: { value: "새 설명" }
    });
    fireEvent.click(screen.getByRole("button", { name: "정보 저장" }));
    await waitFor(() =>
      expect(api.updateCanvas).toHaveBeenCalledWith({
        sessionId: "session-1",
        canvasId: "canvas-a",
        name: "수정된 플롯",
        description: "새 설명",
        expectedCanvasRevision: 3
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "캔버스 복제" }));
    await waitFor(() => expect(api.duplicateCanvas).toHaveBeenCalledTimes(1));
    expect(api.duplicateCanvas).toHaveBeenLastCalledWith({
      sessionId: "session-1",
      sourceCanvasId: "canvas-a",
      name: "수정된 플롯 복사본"
    });
    await waitFor(() =>
      expect(screen.getByTestId("fake-plot-canvas").dataset.canvasId).toMatch(
        /canvas-new-/
      )
    );

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "캔버스 삭제" }));
    await waitFor(() => expect(api.deleteCanvas).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith(
      expect.stringMatching(/노드 2개 · 연결선 1개/)
    );
    expect(api.deleteCanvas).toHaveBeenCalledWith(
      expect.objectContaining({ expectedCanvasRevision: 1 })
    );
    confirm.mockRestore();

    fireEvent.click(screen.getByRole("button", { name: "새 캔버스" }));
    await waitFor(() =>
      expect(api.createCanvas).toHaveBeenCalledWith({
        sessionId: "session-1",
        name: "새 캔버스"
      })
    );
    expect(workspaceControl.flushCalls).toBeGreaterThanOrEqual(3);
  });

  it("saves with expected revision/generation/sequence and rejects stale responses", async () => {
    const { api } = createCanvasApi({ lastCanvasId: "canvas-a", canvasStates: {} });
    await renderReady(api);
    fireEvent.click(screen.getByRole("button", { name: "workspace save" }));
    await workspaceControl.lastSavePromise;
    expect(api.saveCanvas).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        canvasId: "canvas-a",
        expectedCanvasRevision: 3,
        generation: 12,
        saveSequence: 34,
        document: expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({ id: "workspace-added" })
          ])
        })
      })
    );
    expect(api.createEntityRelation).not.toHaveBeenCalled();
    expect(api.updateEntityRelation).not.toHaveBeenCalled();
    expect(api.deleteEntityRelation).not.toHaveBeenCalled();

    vi.mocked(api.saveCanvas).mockImplementationOnce(async (request) => ({
      canvasId: request.canvasId,
      generation: request.generation,
      saveSequence: request.saveSequence - 1,
      canvas: canvasRecord("canvas-a", "전체 플롯", 5, request.document),
      revision: 22,
      noOp: false
    }));
    fireEvent.click(screen.getByRole("button", { name: "workspace save" }));
    await expect(workspaceControl.lastSavePromise).rejects.toThrow(/오래된 캔버스 저장 응답/);
  });

  it("awaits A→B flush and discards an older B load after C wins", async () => {
    const { api, store } = createCanvasApi({
      lastCanvasId: "canvas-a",
      canvasStates: {}
    });
    await renderReady(api);
    vi.mocked(api.loadCanvas).mockClear();
    const gate = deferred<void>();
    workspaceControl.flushImpl = () => gate.promise;
    fireEvent.click(screen.getByText("결말 후보").closest("button")!);
    await Promise.resolve();
    expect(api.loadCanvas).not.toHaveBeenCalled();
    gate.resolve(undefined);
    await waitFor(() =>
      expect(api.loadCanvas).toHaveBeenCalledWith({
        sessionId: "session-1",
        canvasId: "canvas-b"
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId("fake-plot-canvas").dataset.canvasId).toBe("canvas-b")
    );

    workspaceControl.flushImpl = async () => undefined;
    const oldLoad = deferred<CanvasRecord>();
    const winningLoad = deferred<CanvasRecord>();
    vi.mocked(api.loadCanvas).mockImplementation(async (request) => {
      if (request.canvasId === "canvas-a") {
        return oldLoad.promise;
      }
      if (request.canvasId === "canvas-c") {
        return winningLoad.promise;
      }
      return store.get(request.canvasId)!;
    });
    fireEvent.click(screen.getByText("전체 플롯").closest("button")!);
    fireEvent.click(screen.getByText("인물 동선").closest("button")!);
    winningLoad.resolve(store.get("canvas-c")!);
    await waitFor(() =>
      expect(screen.getByTestId("fake-plot-canvas").dataset.canvasId).toBe("canvas-c")
    );
    oldLoad.resolve(store.get("canvas-a")!);
    await Promise.resolve();
    expect(screen.getByTestId("fake-plot-canvas").dataset.canvasId).toBe("canvas-c");
  });

  it("keeps the current Canvas selected when its explicit flush fails", async () => {
    const { api } = createCanvasApi({ lastCanvasId: "canvas-a", canvasStates: {} });
    await renderReady(api);
    vi.mocked(api.loadCanvas).mockClear();
    workspaceControl.flushImpl = async () => {
      throw new Error("disk full");
    };

    fireEvent.click(screen.getByText("결말 후보").closest("button")!);

    await waitFor(() => expect(workspaceControl.flushCalls).toBe(1));
    expect(api.loadCanvas).not.toHaveBeenCalled();
    expect(screen.getByTestId("fake-plot-canvas").dataset.canvasId).toBe("canvas-a");
  });

  it("previews import into a new canvas, exports, navigates and handles pending entity DTOs", async () => {
    const { api } = createCanvasApi({ lastCanvasId: "canvas-a", canvasStates: {} });
    const imported: MadiCanvasDocument = {
      nodes: [
        {
          id: "broken-entity",
          type: "text",
          x: 0,
          y: 0,
          width: 240,
          height: 140,
          text: "삭제된 설정",
          madi: {
            nodeKind: "ENTITY_REFERENCE",
            entityId: "missing-entity",
            originalLabel: "옛 인물"
          }
        }
      ],
      edges: []
    };
    vi.mocked(api.pickCanvasImport).mockResolvedValue({
      fileName: "결말 후보.canvas",
      source: JSON.stringify(imported)
    });
    const onOpenEntity = vi.fn();
    const onOpenScene = vi.fn();
    const onPendingEntityHandled = vi.fn();
    const rendered = render(
      <PlotCanvasMode
        {...modeProps(api, {
          pendingEntityId: "entity-1",
          onPendingEntityHandled,
          onOpenEntity,
          onOpenScene
        })}
      />
    );
    await screen.findByRole("region", { name: "가짜 Plot Canvas" });
    const targetDialog = await screen.findByRole("dialog", {
      name: "설정을 추가할 캔버스 선택"
    });
    expect(workspaceControl.addedItems).toEqual([]);
    expect(
      (within(targetDialog).getByRole("combobox", {
        name: "대상 캔버스"
      }) as HTMLSelectElement).value
    ).toBe("canvas-a");
    vi.mocked(api.loadCanvas).mockClear();
    const flushesBeforeTargetSelection = workspaceControl.flushCalls;
    fireEvent.change(
      within(targetDialog).getByRole("combobox", { name: "대상 캔버스" }),
      { target: { value: "canvas-b" } }
    );
    fireEvent.click(
      within(targetDialog).getByRole("button", {
        name: "선택한 캔버스에 추가"
      })
    );
    await waitFor(() =>
      expect(workspaceControl.addedItems).toContainEqual({
        kind: "ENTITY_REFERENCE",
        entity: expect.objectContaining({ id: "entity-1", name: "레이아" })
      })
    );
    expect(workspaceControl.flushCalls).toBeGreaterThan(
      flushesBeforeTargetSelection
    );
    expect(api.loadCanvas).toHaveBeenCalledWith({
      sessionId: "session-1",
      canvasId: "canvas-b"
    });
    expect(screen.getByTestId("fake-plot-canvas").dataset.canvasId).toBe(
      "canvas-b"
    );
    expect(onPendingEntityHandled).toHaveBeenCalledWith("entity-1", true);
    expect(api.createEntityRelation).not.toHaveBeenCalled();
    expect(api.updateEntityRelation).not.toHaveBeenCalled();
    expect(api.deleteEntityRelation).not.toHaveBeenCalled();
    rendered.rerender(
      <PlotCanvasMode
        {...modeProps(api, { onOpenEntity, onOpenScene, pendingEntityId: null })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "workspace entity open" }));
    fireEvent.click(screen.getByRole("button", { name: "workspace scene open" }));
    expect(onOpenEntity).toHaveBeenCalledWith("entity-1");
    expect(onOpenScene).toHaveBeenCalledWith("scene-1");

    fireEvent.click(screen.getByRole("button", { name: ".canvas 가져오기" }));
    const preview = await screen.findByRole("dialog", {
      name: "JSON Canvas 가져오기 미리보기"
    });
    expect(preview.textContent).toContain("노드 1개 · 연결선 0개 · 끊어진 참조 1개");
    const importName = screen.getByRole("textbox", {
      name: "새 캔버스 이름"
    }) as HTMLInputElement;
    expect(importName.value).toBe("결말 후보");
    startTransition(() => {
      fireEvent.change(importName, { target: { value: "새 결말 캔버스" } });
    });
    await waitFor(() => expect(importName.value).toBe("새 결말 캔버스"));
    fireEvent.click(screen.getByRole("button", { name: "새 캔버스로 가져오기" }));
    await waitFor(() =>
      expect(api.createCanvas).toHaveBeenCalledWith({
        sessionId: "session-1",
        name: "새 결말 캔버스",
        document: imported
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId("fake-plot-canvas").dataset.canvasId).toMatch(
        /canvas-new-/
      )
    );
    fireEvent.click(screen.getByRole("button", { name: ".canvas 내보내기" }));
    await waitFor(() => expect(api.exportCanvas).toHaveBeenCalledTimes(1));
    expect(api.exportCanvas).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        suggestedFileName: "새 결말 캔버스"
      })
    );
  });

  it("reports cancel and duplicate rejection from the explicit target dialog", async () => {
    const { api } = createCanvasApi({
      lastCanvasId: "canvas-a",
      canvasStates: {}
    });
    const onPendingEntityHandled = vi.fn();
    const rendered = render(
      <PlotCanvasMode
        {...modeProps(api, {
          pendingEntityId: "entity-1",
          onPendingEntityHandled
        })}
      />
    );
    const firstDialog = await screen.findByRole("dialog", {
      name: "설정을 추가할 캔버스 선택"
    });
    fireEvent.click(within(firstDialog).getByRole("button", { name: "취소" }));
    expect(onPendingEntityHandled).toHaveBeenLastCalledWith("entity-1", false);
    expect(workspaceControl.addedItems).toEqual([]);

    rendered.rerender(
      <PlotCanvasMode
        {...modeProps(api, {
          pendingEntityId: null,
          onPendingEntityHandled
        })}
      />
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "설정을 추가할 캔버스 선택" })
      ).toBeNull()
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    rendered.rerender(
      <PlotCanvasMode
        {...modeProps(api, {
          pendingEntityId: "entity-1",
          onPendingEntityHandled
        })}
      />
    );
    const duplicateDialog = await screen.findByRole("dialog", {
      name: "설정을 추가할 캔버스 선택"
    });
    fireEvent.click(
      within(duplicateDialog).getByRole("button", {
        name: "선택한 캔버스에 추가"
      })
    );
    await waitFor(() =>
      expect(onPendingEntityHandled).toHaveBeenLastCalledWith(
        "entity-1",
        false
      )
    );
    expect(confirm).toHaveBeenCalledWith(
      expect.stringMatching(/레이아.*이미.*중복/)
    );
    expect(workspaceControl.addedItems).toEqual([]);
  });

  it("waits for a delayed target load and inserts exactly once into the committed target workspace", async () => {
    const { api, store } = createCanvasApi({
      lastCanvasId: "canvas-a",
      canvasStates: {}
    });
    const onPendingEntityHandled = vi.fn();
    render(
      <PlotCanvasMode
        {...modeProps(api, {
          pendingEntityId: "entity-1",
          onPendingEntityHandled
        })}
      />
    );
    const dialog = await screen.findByRole("dialog", {
      name: "설정을 추가할 캔버스 선택"
    });
    const targetLoad = deferred<CanvasRecord>();
    vi.mocked(api.loadCanvas).mockClear();
    vi.mocked(api.loadCanvas).mockImplementation(async (request) => {
      if (request.canvasId === "canvas-b") {
        return targetLoad.promise;
      }
      const record = store.get(request.canvasId);
      if (!record) {
        throw new Error("missing canvas");
      }
      return record;
    });
    fireEvent.change(
      within(dialog).getByRole("combobox", { name: "대상 캔버스" }),
      { target: { value: "canvas-b" } }
    );
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "선택한 캔버스에 추가"
      })
    );

    await waitFor(() =>
      expect(api.loadCanvas).toHaveBeenCalledWith({
        sessionId: "session-1",
        canvasId: "canvas-b"
      })
    );
    expect(workspaceControl.addedCanvasItems).toEqual([]);
    expect(onPendingEntityHandled).not.toHaveBeenCalled();
    expect(screen.getByTestId("fake-plot-canvas").dataset.canvasId).toBe(
      "canvas-a"
    );

    targetLoad.resolve(store.get("canvas-b")!);
    await waitFor(() =>
      expect(onPendingEntityHandled).toHaveBeenCalledWith("entity-1", true)
    );
    expect(workspaceControl.addedCanvasItems).toEqual([
      {
        canvasId: "canvas-b",
        item: {
          kind: "ENTITY_REFERENCE",
          entity: expect.objectContaining({ id: "entity-1", name: "레이아" })
        }
      }
    ]);
    expect(screen.getByTestId("fake-plot-canvas").dataset.canvasId).toBe(
      "canvas-b"
    );
  });

  it("reports a target-switch flush failure without loading or adding", async () => {
    const { api } = createCanvasApi({
      lastCanvasId: "canvas-a",
      canvasStates: {}
    });
    const onPendingEntityHandled = vi.fn();
    render(
      <PlotCanvasMode
        {...modeProps(api, {
          pendingEntityId: "entity-1",
          onPendingEntityHandled
        })}
      />
    );
    const dialog = await screen.findByRole("dialog", {
      name: "설정을 추가할 캔버스 선택"
    });
    vi.mocked(api.loadCanvas).mockClear();
    workspaceControl.flushImpl = async () => {
      throw new Error("target flush rejected");
    };
    fireEvent.change(
      within(dialog).getByRole("combobox", { name: "대상 캔버스" }),
      { target: { value: "canvas-b" } }
    );
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "선택한 캔버스에 추가"
      })
    );

    await waitFor(() =>
      expect(onPendingEntityHandled).toHaveBeenCalledWith("entity-1", false)
    );
    expect(api.loadCanvas).not.toHaveBeenCalled();
    expect(workspaceControl.addedItems).toEqual([]);
    expect(screen.getByRole("alert").textContent).toContain(
      "target flush rejected"
    );
  });
});
