import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  WorldGraphWorkspace,
  type WorldGraphPerformanceSample,
  type WorldGraphWorkspaceProps
} from "../src/renderer/components/worldGraph/WorldGraphWorkspace";
import { shouldCenterGraphViewport } from "../src/renderer/components/worldGraph/WorldGraphCanvas";
import {
  DEFAULT_WORLD_GRAPH_UI_STATE,
  type WorldGraphEdgeView,
  type WorldGraphEntityDetailView,
  type WorldGraphNodeView,
  type WorldGraphReadModelView,
  type WorldGraphSceneContextView
} from "../src/renderer/components/worldGraph/types";

const leia: WorldGraphNodeView = {
  id: "leia",
  projectId: "project-1",
  label: "레이아",
  kind: "CHARACTER",
  status: "ACTIVE",
  summary: "북부 출신 마법사",
  colorToken: "blue",
  iconKey: "person",
  aliases: ["북부의 마법사"],
  tags: [{ id: "hero", name: "주요 인물", colorToken: null }],
  explicitSceneLinkCount: 1,
  outgoingRelationCount: 1,
  incomingRelationCount: 0,
  undirectedRelationCount: 1
};

const order: WorldGraphNodeView = {
  id: "order",
  projectId: "project-1",
  label: "북부 마법사단",
  kind: "ORGANIZATION",
  status: "ACTIVE",
  summary: "북부의 마법사 조직",
  colorToken: null,
  iconKey: null,
  aliases: [],
  tags: [{ id: "north", name: "북부", colorToken: null }],
  explicitSceneLinkCount: 0,
  outgoingRelationCount: 0,
  incomingRelationCount: 1,
  undirectedRelationCount: 0
};

const serina: WorldGraphNodeView = {
  id: "serina",
  projectId: "project-1",
  label: "세리나",
  kind: "CHARACTER",
  status: "ACTIVE",
  summary: null,
  colorToken: null,
  iconKey: null,
  aliases: [],
  tags: [],
  explicitSceneLinkCount: 0,
  outgoingRelationCount: 0,
  incomingRelationCount: 0,
  undirectedRelationCount: 1
};

const archived: WorldGraphNodeView = {
  id: "archived",
  projectId: "project-1",
  label: "옛 왕국",
  kind: "LOCATION",
  status: "ARCHIVED",
  summary: "기록에서 사라진 왕국",
  colorToken: null,
  iconKey: null,
  aliases: [],
  tags: [],
  explicitSceneLinkCount: 0,
  outgoingRelationCount: 0,
  incomingRelationCount: 0,
  undirectedRelationCount: 0
};

const member: WorldGraphEdgeView = {
  id: "member",
  projectId: "project-1",
  sourceEntityId: leia.id,
  targetEntityId: order.id,
  relationTypeId: "type-member",
  forwardLabel: "소속",
  inverseLabel: "구성원을 가짐",
  directed: true,
  colorToken: null,
  note: "정예 단원"
};

const hostile: WorldGraphEdgeView = {
  id: "hostile",
  projectId: "project-1",
  sourceEntityId: leia.id,
  targetEntityId: serina.id,
  relationTypeId: "type-hostile",
  forwardLabel: "적대",
  inverseLabel: null,
  directed: false,
  colorToken: "red",
  note: null
};

const model: WorldGraphReadModelView = {
  projectId: "project-1",
  revision: 21,
  nodes: [leia, order, serina, archived],
  edges: [member, hostile],
  stats: {
    entityCount: 4,
    relationCount: 2,
    entityKindCounts: [
      { kind: "CHARACTER", count: 2 },
      { kind: "ORGANIZATION", count: 1 },
      { kind: "LOCATION", count: 1 }
    ],
    relationTypeCounts: [
      {
        relationTypeId: "type-member",
        name: "소속",
        inverseName: "구성원을 가짐",
        directed: true,
        colorToken: null,
        isBuiltin: true,
        count: 1
      },
      {
        relationTypeId: "type-hostile",
        name: "적대",
        inverseName: null,
        directed: false,
        colorToken: "red",
        isBuiltin: true,
        count: 1
      }
    ],
    topDegreeEntities: [
      { entityId: leia.id, label: leia.label, degree: 2 },
      { entityId: order.id, label: order.label, degree: 1 }
    ],
    isolatedEntityCount: 1,
    directedRelationCount: 1,
    undirectedRelationCount: 1
  },
  diagnostics: []
};

const detail: WorldGraphEntityDetailView = {
  projectId: "project-1",
  revision: 21,
  entity: leia,
  outgoingRelations: [
    {
      edge: member,
      counterpartEntityId: order.id,
      displayLabel: "소속",
      perspective: "OUTGOING"
    }
  ],
  incomingRelations: [],
  undirectedRelations: [
    {
      edge: hostile,
      counterpartEntityId: serina.id,
      displayLabel: "적대",
      perspective: "UNDIRECTED"
    }
  ]
};

const scenes: WorldGraphSceneContextView = {
  projectId: "project-1",
  revision: 21,
  entityId: leia.id,
  links: [
    {
      sceneNodeId: "scene-1",
      sceneTitle: "성문 앞",
      role: "POV",
      note: null
    }
  ]
};

const orderDetail: WorldGraphEntityDetailView = {
  projectId: "project-1",
  revision: 21,
  entity: order,
  outgoingRelations: [],
  incomingRelations: [
    {
      edge: member,
      counterpartEntityId: leia.id,
      displayLabel: "구성원을 가짐",
      perspective: "INCOMING"
    }
  ],
  undirectedRelations: []
};

const orderScenes: WorldGraphSceneContextView = {
  projectId: "project-1",
  revision: 21,
  entityId: order.id,
  links: []
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function props(
  overrides: Partial<WorldGraphWorkspaceProps> = {}
): WorldGraphWorkspaceProps {
  return {
    model,
    onLoadEntityDetail: vi.fn(async () => detail),
    onLoadEntitySceneContext: vi.fn(async () => scenes),
    onLoadMentionCount: vi.fn(async () => 7),
    onOpenEntity: vi.fn(),
    onOpenRelation: vi.fn(),
    onOpenScene: vi.fn(),
    ...overrides
  };
}

function openAccessibleGraphList(): HTMLElement {
  fireEvent.click(screen.getByText("키보드용 그래프 목록"));
  return screen.getByRole("region", { name: "그래프 설정 목록" });
}

describe("WorldGraphWorkspace", () => {
  it("provides keyboard selection, lazy detail, inverse-aware relation data and scene navigation", async () => {
    const onLoadEntityDetail = vi.fn(async () => detail);
    const onLoadEntitySceneContext = vi.fn(async () => scenes);
    const onLoadMentionCount = vi.fn(async () => 7);
    const onOpenEntity = vi.fn();
    const onOpenScene = vi.fn();
    render(
      <WorldGraphWorkspace
        {...props({
          onLoadEntityDetail,
          onLoadEntitySceneContext,
          onLoadMentionCount,
          onOpenEntity,
          onOpenScene
        })}
      />
    );

    expect(screen.getByTestId("world-graph-canvas").getAttribute("role")).toBe(
      "img"
    );
    const list = openAccessibleGraphList();
    const leiaButton = within(list).getByRole("button", {
      name: "레이아 · CHARACTER"
    });
    fireEvent.click(leiaButton);

    await waitFor(() => expect(onLoadEntityDetail).toHaveBeenCalledWith("leia"));
    expect(onLoadEntitySceneContext).toHaveBeenCalledWith("leia");
    expect(onLoadMentionCount).toHaveBeenCalledWith("leia");
    const detailPanel = screen.getByTestId("world-graph-detail");
    expect(within(detailPanel).getByRole("heading", { name: "레이아" })).toBeTruthy();
    expect(within(detailPanel).getByText(/별칭: 북부의 마법사/)).toBeTruthy();
    expect(within(detailPanel).getByText("7개")).toBeTruthy();
    expect(within(detailPanel).getByText(/후보는 자동으로 canonical/)).toBeTruthy();
    expect(within(detailPanel).getByText("정예 단원")).toBeTruthy();

    fireEvent.click(within(detailPanel).getByRole("button", { name: "성문 앞 · POV" }));
    expect(onOpenScene).toHaveBeenCalledWith("scene-1");
    fireEvent.click(
      within(detailPanel).getByRole("button", { name: "설정 상세에서 열기" })
    );
    expect(onOpenEntity).toHaveBeenCalledWith("leia");

    fireEvent.doubleClick(leiaButton);
    expect(onOpenEntity).toHaveBeenCalledWith("leia");
  });

  it("commits the selected node shell before any lazy detail response", async () => {
    const pendingDetail = deferred<WorldGraphEntityDetailView>();
    const pendingScenes = deferred<WorldGraphSceneContextView>();
    const pendingMentions = deferred<number>();
    const onLoadEntityDetail = vi.fn(() => pendingDetail.promise);
    const onLoadEntitySceneContext = vi.fn(() => pendingScenes.promise);
    const onLoadMentionCount = vi.fn(() => pendingMentions.promise);
    render(
      <WorldGraphWorkspace
        {...props({
          onLoadEntityDetail,
          onLoadEntitySceneContext,
          onLoadMentionCount
        })}
      />
    );

    const list = openAccessibleGraphList();
    fireEvent.click(
      within(list).getByRole("button", { name: "레이아 · CHARACTER" })
    );

    const panel = screen.getByTestId("world-graph-detail");
    expect(within(panel).getByRole("heading", { name: "레이아" })).toBeTruthy();
    expect(within(panel).getByText("북부 출신 마법사")).toBeTruthy();
    expect(within(panel).getByText("세부정보 불러오는 중")).toBeTruthy();
    expect(within(panel).getByText("장면 연결 불러오는 중")).toBeTruthy();
    await waitFor(() => {
      expect(onLoadEntityDetail).toHaveBeenCalledTimes(1);
      expect(onLoadEntitySceneContext).toHaveBeenCalledTimes(1);
      expect(onLoadMentionCount).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      pendingDetail.resolve(detail);
      pendingScenes.resolve(scenes);
      pendingMentions.resolve(7);
      await Promise.all([
        pendingDetail.promise,
        pendingScenes.promise,
        pendingMentions.promise
      ]);
    });
    expect(await within(panel).findByText("7개")).toBeTruthy();
  });

  it("passes only the selected entity id from Graph to the optional Canvas entry point", () => {
    const onAddEntityToCanvas = vi.fn();
    render(
      <WorldGraphWorkspace
        {...props({ onAddEntityToCanvas })}
      />
    );
    const list = openAccessibleGraphList();
    fireEvent.click(
      within(list).getByRole("button", { name: "레이아 · CHARACTER" })
    );
    fireEvent.click(
      within(screen.getByTestId("world-graph-detail")).getByRole("button", {
        name: "캔버스에 추가"
      })
    );

    expect(onAddEntityToCanvas.mock.calls).toEqual([[leia.id]]);
    expect(typeof onAddEntityToCanvas.mock.calls[0]?.[0]).toBe("string");
  });

  it("reuses revision-scoped detail cache entries on A to B to A selection", async () => {
    const onLoadEntityDetail = vi.fn(async (entityId: string) =>
      entityId === leia.id ? detail : orderDetail
    );
    const onLoadEntitySceneContext = vi.fn(async (entityId: string) =>
      entityId === leia.id ? scenes : orderScenes
    );
    const onLoadMentionCount = vi.fn(async (entityId: string) =>
      entityId === leia.id ? 7 : 0
    );
    render(
      <WorldGraphWorkspace
        {...props({
          onLoadEntityDetail,
          onLoadEntitySceneContext,
          onLoadMentionCount
        })}
      />
    );
    const list = openAccessibleGraphList();

    fireEvent.click(
      within(list).getByRole("button", { name: "레이아 · CHARACTER" })
    );
    await waitFor(() => expect(onLoadEntityDetail).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("7개")).toBeTruthy();
    fireEvent.click(
      within(list).getByRole("button", { name: "북부 마법사단 · ORGANIZATION" })
    );
    await waitFor(() => expect(onLoadEntityDetail).toHaveBeenCalledTimes(2));
    fireEvent.click(
      within(list).getByRole("button", { name: "레이아 · CHARACTER" })
    );
    expect(
      within(screen.getByTestId("world-graph-detail")).getByRole("heading", {
        name: "레이아"
      })
    ).toBeTruthy();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(onLoadEntityDetail).toHaveBeenCalledTimes(2);
    expect(onLoadEntitySceneContext).toHaveBeenCalledTimes(2);
    expect(onLoadMentionCount).toHaveBeenCalledTimes(2);
  });

  it("blocks a late A response after B becomes the current selection", async () => {
    const leiaDetail = deferred<WorldGraphEntityDetailView>();
    const leiaScenes = deferred<WorldGraphSceneContextView>();
    const leiaMentions = deferred<number>();
    const nextDetail = deferred<WorldGraphEntityDetailView>();
    const nextScenes = deferred<WorldGraphSceneContextView>();
    const nextMentions = deferred<number>();
    const detailA = {
      ...detail,
      outgoingRelations: [
        {
          ...detail.outgoingRelations[0],
          edge: { ...member, note: "A 응답" }
        }
      ]
    };
    const detailB = {
      ...orderDetail,
      incomingRelations: [
        {
          ...orderDetail.incomingRelations[0],
          edge: { ...member, note: "B 응답" }
        }
      ]
    };
    render(
      <WorldGraphWorkspace
        {...props({
          onLoadEntityDetail: (entityId) =>
            entityId === leia.id ? leiaDetail.promise : nextDetail.promise,
          onLoadEntitySceneContext: (entityId) =>
            entityId === leia.id ? leiaScenes.promise : nextScenes.promise,
          onLoadMentionCount: (entityId) =>
            entityId === leia.id ? leiaMentions.promise : nextMentions.promise
        })}
      />
    );
    const list = openAccessibleGraphList();
    fireEvent.click(
      within(list).getByRole("button", { name: "레이아 · CHARACTER" })
    );
    fireEvent.click(
      within(list).getByRole("button", { name: "북부 마법사단 · ORGANIZATION" })
    );

    await act(async () => {
      nextDetail.resolve(detailB);
      nextScenes.resolve(orderScenes);
      nextMentions.resolve(0);
      await Promise.all([nextDetail.promise, nextScenes.promise, nextMentions.promise]);
    });
    expect(await screen.findByText("B 응답")).toBeTruthy();

    await act(async () => {
      leiaDetail.resolve(detailA);
      leiaScenes.resolve(scenes);
      leiaMentions.resolve(7);
      await Promise.all([leiaDetail.promise, leiaScenes.promise, leiaMentions.promise]);
    });
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    const panel = screen.getByTestId("world-graph-detail");
    expect(
      within(panel).getByRole("heading", { name: "북부 마법사단" })
    ).toBeTruthy();
    expect(within(panel).getByText("B 응답")).toBeTruthy();
    expect(within(panel).queryByText("A 응답")).toBeNull();
  });

  it("shows directed and undirected edge detail and exposes navigation, never mutation", () => {
    const onOpenRelation = vi.fn();
    render(<WorldGraphWorkspace {...props({ onOpenRelation })} />);
    fireEvent.click(screen.getByText("키보드용 그래프 목록"));
    const edgeList = screen.getByRole("region", { name: "그래프 관계 목록" });

    fireEvent.click(
      within(edgeList).getByRole("button", {
        name: "레이아 → 소속 → 북부 마법사단"
      })
    );
    const detailPanel = screen.getByTestId("world-graph-detail");
    expect(within(detailPanel).getByText("방향 관계 →")).toBeTruthy();
    expect(
      within(detailPanel).getByText("역방향 label: 구성원을 가짐")
    ).toBeTruthy();
    expect(within(detailPanel).getByText(/관계를 생성·수정·삭제할 수 없습니다/)).toBeTruthy();
    expect(within(detailPanel).queryByRole("form")).toBeNull();
    fireEvent.click(
      within(detailPanel).getByRole("button", { name: "관계 편집에서 열기" })
    );
    expect(onOpenRelation).toHaveBeenCalledWith("member", "leia");

    fireEvent.click(
      within(edgeList).getByRole("button", {
        name: "레이아 — 적대 — 세리나"
      })
    );
    expect(within(detailPanel).getByText("무방향 관계 —")).toBeTruthy();
    expect(within(detailPanel).queryByText(/역방향 label/)).toBeNull();
  });

  it("combines filters, full/focused mode and search reveal while persisting UI state", async () => {
    const onUiStateChange = vi.fn();
    const onSelectedEntityChange = vi.fn();
    render(
      <WorldGraphWorkspace
        {...props({ onUiStateChange, onSelectedEntityChange })}
      />
    );
    fireEvent.click(screen.getByText("필터"));
    fireEvent.click(screen.getByRole("checkbox", { name: "등장인물" }));
    await waitFor(() =>
      expect(screen.getByText("표시 설정 1개")).toBeTruthy()
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "세계관 설정 검색" }), {
      target: { value: "옛 왕국" }
    });
    const results = screen.getByRole("list", { name: "세계관 설정 검색 결과" });
    fireEvent.click(within(results).getByRole("button", { name: /옛 왕국/ }));
    expect(
      screen.getByText(/해당 설정을 표시하도록 필요한 필터만 조정/)
    ).toBeTruthy();
    expect(onSelectedEntityChange).toHaveBeenCalledWith("archived");

    fireEvent.change(screen.getByRole("combobox", { name: "중심 그래프 깊이" }), {
      target: { value: "3" }
    });
    fireEvent.change(screen.getByRole("combobox", { name: "중심 설정" }), {
      target: { value: "leia" }
    });
    expect(
      screen.getByRole("button", { name: "중심 그래프" }).getAttribute("aria-pressed")
    ).toBe("true");
    await waitFor(() =>
      expect(onUiStateChange).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "FOCUSED",
          focusedEntityId: "leia",
          depth: 3,
          layout: expect.stringMatching(/cose|preset/),
          viewport: expect.objectContaining({ zoom: expect.any(Number) })
        })
      )
    );
  });

  it("recenters when an already selected node becomes the focus", async () => {
    render(<WorldGraphWorkspace {...props()} />);
    const list = openAccessibleGraphList();
    fireEvent.click(
      within(list).getByRole("button", { name: "레이아 · CHARACTER" })
    );
    const workspace = screen.getByTestId("world-graph-workspace");
    expect(workspace.dataset.centerRequest).toBe("0");

    fireEvent.click(screen.getByRole("button", { name: "중심 그래프" }));

    await waitFor(() => {
      expect(workspace.dataset.mode).toBe("FOCUSED");
      expect(workspace.dataset.focusedEntityId).toBe("leia");
      expect(workspace.dataset.centerRequest).toBe("1");
    });
  });

  it("does not rerun layout for selection, edge detail, lazy commit, or visible search focus", async () => {
    const samples: WorldGraphPerformanceSample[] = [];
    render(
      <WorldGraphWorkspace
        {...props({
          onPerformanceSample: (sample) => samples.push(sample),
          onLoadEntityDetail: async (entityId) =>
            entityId === leia.id ? detail : orderDetail,
          onLoadEntitySceneContext: async (entityId) =>
            entityId === leia.id ? scenes : orderScenes,
          onLoadMentionCount: async () => 0
        })}
      />
    );
    await waitFor(() => {
      const layoutSamples = samples.filter((sample) => "layoutMs" in sample);
      expect(layoutSamples.length).toBeGreaterThan(0);
    });
    const initialLayoutCount = samples.filter(
      (sample) => "layoutMs" in sample
    ).length;
    const list = openAccessibleGraphList();
    fireEvent.click(
      within(list).getByRole("button", { name: "레이아 · CHARACTER" })
    );
    expect(
      within(screen.getByTestId("world-graph-detail")).getByRole("heading", {
        name: "레이아"
      })
    ).toBeTruthy();
    await screen.findByText("0개");

    const edgeList = screen.getByRole("region", { name: "그래프 관계 목록" });
    fireEvent.click(
      within(edgeList).getByRole("button", {
        name: "레이아 → 소속 → 북부 마법사단"
      })
    );
    fireEvent.change(screen.getByRole("searchbox", { name: "세계관 설정 검색" }), {
      target: { value: "북부 마법사단" }
    });
    fireEvent.click(
      within(
        screen.getByRole("list", { name: "세계관 설정 검색 결과" })
      ).getByRole("button", { name: /북부 마법사단/ })
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("world-graph-workspace").dataset.selectedId
      ).toBe(order.id)
    );
    await new Promise((resolve) => window.setTimeout(resolve, 30));

    expect(
      samples.filter((sample) => "layoutMs" in sample)
    ).toHaveLength(initialLayoutCount);
    expect(
      samples.some(
        (sample) =>
          "reactSelectionCommitMs" in sample &&
          "detailShellRenderMs" in sample
      )
    ).toBe(true);
    expect(
      samples.some(
        (sample) =>
          "cytoscapeNodeLookupMs" in sample &&
          "neighborHighlightMs" in sample
      )
    ).toBe(true);
    expect(
      samples.some(
        (sample) =>
          "entityDetailRpcMs" in sample &&
          "sceneContextRpcMs" in sample &&
          "mentionDiscoveryRpcMs" in sample
      )
    ).toBe(true);
    expect(samples.some((sample) => "reactDetailCommitMs" in sample)).toBe(true);
    expect(samples.some((sample) => "searchClickHandlerMs" in sample)).toBe(true);
    expect(JSON.stringify(samples)).not.toMatch(/레이아|마법사단|project-1/);
  });

  it("preserves a restored viewport until an explicit center request", () => {
    expect(shouldCenterGraphViewport("leia", 0)).toBe(false);
    expect(shouldCenterGraphViewport("leia", 1)).toBe(true);
    expect(shouldCenterGraphViewport(null, 1)).toBe(false);
  });

  it("prunes deleted tag and relation type filters when the model changes", async () => {
    const onUiStateChange = vi.fn();
    const initialUiState = {
      ...DEFAULT_WORLD_GRAPH_UI_STATE,
      filters: {
        ...DEFAULT_WORLD_GRAPH_UI_STATE.filters,
        tagIds: ["hero"],
        relationTypeIds: ["type-member"]
      }
    };
    const rendered = render(
      <WorldGraphWorkspace
        {...props({ onUiStateChange })}
        initialUiState={initialUiState}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId("world-graph-workspace").dataset.visibleNodeCount).toBe(
        "1"
      )
    );

    const updatedModel: WorldGraphReadModelView = {
      ...model,
      revision: model.revision + 1,
      nodes: model.nodes.map((node) =>
        node.id === leia.id ? { ...node, tags: [] } : node
      ),
      edges: [hostile],
      stats: {
        ...model.stats,
        relationCount: 1,
        relationTypeCounts: model.stats.relationTypeCounts.filter(
          (item) => item.relationTypeId !== "type-member"
        )
      }
    };
    rendered.rerender(
      <WorldGraphWorkspace
        {...props({ model: updatedModel, onUiStateChange })}
        initialUiState={initialUiState}
      />
    );

    await waitFor(() => {
      const workspace = screen.getByTestId("world-graph-workspace");
      expect(workspace.dataset.visibleNodeCount).toBe("3");
      expect(onUiStateChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          filters: expect.objectContaining({
            tagIds: [],
            relationTypeIds: []
          })
        })
      );
    });
  });

  it("discards stale lazy detail responses", async () => {
    const staleDetail = { ...detail, revision: 20 };
    const staleScenes = { ...scenes, revision: 20 };
    render(
      <WorldGraphWorkspace
        {...props({
          initialUiState: {
            ...DEFAULT_WORLD_GRAPH_UI_STATE,
            selectedEntityId: leia.id
          },
          onLoadEntityDetail: vi.fn(async () => staleDetail),
          onLoadEntitySceneContext: vi.fn(async () => staleScenes)
        })}
      />
    );
    expect(
      await screen.findByText(/오래된 그래프 상세 응답을 버렸습니다/)
    ).toBeTruthy();
  });

  it("applies asynchronously restored project UI state without a remount", async () => {
    const baseProps = props();
    const rendered = render(
      <WorldGraphWorkspace {...baseProps} initialUiState={null} />
    );
    const restored = {
      ...DEFAULT_WORLD_GRAPH_UI_STATE,
      mode: "FOCUSED" as const,
      focusedEntityId: leia.id,
      depth: 2 as const,
      layout: "preset" as const,
      viewport: { zoom: 1.25, pan: { x: 12, y: -8 } },
      nodePositions: { leia: { x: 20, y: 30 } },
      selectedEntityId: leia.id
    };
    rendered.rerender(
      <WorldGraphWorkspace {...baseProps} initialUiState={restored} />
    );
    await waitFor(() => {
      const workspace = screen.getByTestId("world-graph-workspace");
      expect(workspace.dataset.mode).toBe("FOCUSED");
      expect(workspace.dataset.depth).toBe("2");
      expect(workspace.dataset.focusedEntityId).toBe("leia");
      expect(workspace.dataset.viewportZoom).toBe("1.25");
      expect(workspace.dataset.selectedPositionX).toBe("20");
      expect(workspace.dataset.selectedPositionY).toBe("30");
      expect(workspace.dataset.totalNodeCount).toBe(String(model.nodes.length));
      expect(workspace.dataset.totalEdgeCount).toBe(String(model.edges.length));
    });
  });

  it("ignores a parent's structurally equal normalized state echo", async () => {
    const onEcho = vi.fn();
    const emptyModel: WorldGraphReadModelView = {
      ...model,
      nodes: [],
      edges: [],
      stats: {
        ...model.stats,
        entityCount: 0,
        relationCount: 0,
        topDegreeEntities: []
      }
    };
    function EchoHarness() {
      const [state, setState] = useState(DEFAULT_WORLD_GRAPH_UI_STATE);
      return (
        <WorldGraphWorkspace
          {...props({ model: emptyModel })}
          initialUiState={state}
          onUiStateChange={(next) => {
            onEcho(next);
            setState({
              ...next,
              filters: { ...next.filters },
              viewport: { ...next.viewport, pan: { ...next.viewport.pan } },
              nodePositions: { ...next.nodePositions }
            });
          }}
        />
      );
    }
    render(<EchoHarness />);
    await waitFor(() => expect(onEcho).toHaveBeenCalled());
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(onEcho.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("renders an explicit empty state", () => {
    render(
      <WorldGraphWorkspace
        {...props({
          model: {
            ...model,
            nodes: [],
            edges: [],
            stats: {
              ...model.stats,
              entityCount: 0,
              relationCount: 0,
              topDegreeEntities: []
            }
          }
        })}
      />
    );
    expect(screen.getByText("아직 연결된 세계관 설정이 없습니다.")).toBeTruthy();
    expect(screen.getByText(/Story Bible에서 설정과 관계를 추가/)).toBeTruthy();
  });
});
