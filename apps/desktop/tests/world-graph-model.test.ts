import { describe, expect, it } from "vitest";
import {
  collectNeighborhoodNodeIds,
  filterWorldGraph,
  focusWorldGraph,
  normalizeWorldGraphUiState,
  searchWorldGraphNodes
} from "../src/renderer/components/worldGraph/graphModel";
import {
  toCytoscapeElements,
  WORLD_GRAPH_CYTOSCAPE_STYLES,
  WORLD_GRAPH_KIND_SHAPES
} from "../src/renderer/components/worldGraph/cytoscapeElements";
import {
  DEFAULT_WORLD_GRAPH_FILTERS,
  type WorldGraphEdgeView,
  type WorldGraphEntityKind,
  type WorldGraphNodeView,
  type WorldGraphReadModelView
} from "../src/renderer/components/worldGraph/types";

function node(
  id: string,
  kind: WorldGraphEntityKind = "CHARACTER",
  overrides: Partial<WorldGraphNodeView> = {}
): WorldGraphNodeView {
  return {
    id,
    projectId: "project-1",
    label: id.toLocaleUpperCase("en-US"),
    kind,
    status: "ACTIVE",
    summary: `${id} summary`,
    colorToken: null,
    iconKey: null,
    aliases: [],
    tags: [],
    explicitSceneLinkCount: 0,
    outgoingRelationCount: 0,
    incomingRelationCount: 0,
    undirectedRelationCount: 0,
    ...overrides
  };
}

function edge(
  id: string,
  sourceEntityId: string,
  targetEntityId: string,
  overrides: Partial<WorldGraphEdgeView> = {}
): WorldGraphEdgeView {
  return {
    id,
    projectId: "project-1",
    sourceEntityId,
    targetEntityId,
    relationTypeId: "type-directed",
    forwardLabel: "소속",
    inverseLabel: "구성원을 가짐",
    directed: true,
    colorToken: null,
    note: null,
    ...overrides
  };
}

const nodes = [
  node("a", "CHARACTER", {
    label: "레이아",
    aliases: ["북부의 마법사"],
    tags: [{ id: "hero", name: "주요 인물", colorToken: null }],
    outgoingRelationCount: 1
  }),
  node("b", "ORGANIZATION", {
    label: "마법사단",
    incomingRelationCount: 1,
    undirectedRelationCount: 1
  }),
  node("c", "LOCATION", {
    label: "북부 성채",
    tags: [
      { id: "north", name: "북부", colorToken: null },
      { id: "fort", name: "요새", colorToken: null }
    ],
    undirectedRelationCount: 2
  }),
  node("d", "ITEM", {
    label: "봉인의 열쇠",
    summary: "왕국의 문을 여는 오래된 열쇠",
    undirectedRelationCount: 1
  }),
  node("e", "EVENT", { label: "고립 사건" }),
  node("archived", "OTHER", { status: "ARCHIVED", label: "보관 설정" })
];

const edges = [
  edge("ab", "a", "b"),
  edge("bc", "b", "c", {
    relationTypeId: "type-undirected",
    forwardLabel: "적대",
    inverseLabel: null,
    directed: false
  }),
  edge("cd", "c", "d", {
    relationTypeId: "type-undirected",
    forwardLabel: "봉인 장소",
    inverseLabel: null,
    directed: false
  })
];

const model: WorldGraphReadModelView = {
  projectId: "project-1",
  revision: 14,
  nodes,
  edges,
  stats: {
    entityCount: nodes.length,
    relationCount: edges.length,
    entityKindCounts: [],
    relationTypeCounts: [],
    topDegreeEntities: [],
    isolatedEntityCount: 2,
    directedRelationCount: 1,
    undirectedRelationCount: 2
  },
  diagnostics: []
};

describe("World Graph pure model", () => {
  it("uses stable bidirectional BFS for directed and undirected edges at depth 1/2/3", () => {
    expect(
      [...collectNeighborhoodNodeIds(nodes, edges, "a", 1)]
    ).toEqual(["a", "b"]);
    expect(
      [...collectNeighborhoodNodeIds(nodes, edges, "a", 2)]
    ).toEqual(["a", "b", "c"]);
    expect(
      [...collectNeighborhoodNodeIds(nodes, edges, "a", 3)]
    ).toEqual(["a", "b", "c", "d"]);
    expect(
      [...collectNeighborhoodNodeIds(nodes, edges, "b", 1)]
    ).toEqual(["b", "a", "c"]);

    const focused = focusWorldGraph(
      filterWorldGraph(model, DEFAULT_WORLD_GRAPH_FILTERS),
      "a",
      2
    );
    expect(focused.nodes.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(focused.edges.map((item) => item.id)).toEqual(["ab", "bc"]);
  });

  it("combines kind, status, tag ANY/ALL, relation type and isolation filters", () => {
    const anyTags = filterWorldGraph(model, {
      ...DEFAULT_WORLD_GRAPH_FILTERS,
      tagIds: ["north", "missing"],
      tagMode: "ANY"
    });
    expect(anyTags.nodes.map((item) => item.id)).toEqual(["c"]);

    const allTags = filterWorldGraph(model, {
      ...DEFAULT_WORLD_GRAPH_FILTERS,
      tagIds: ["north", "fort"],
      tagMode: "ALL"
    });
    expect(allTags.nodes.map((item) => item.id)).toEqual(["c"]);

    const wrongAllTags = filterWorldGraph(model, {
      ...DEFAULT_WORLD_GRAPH_FILTERS,
      tagIds: ["north", "missing"],
      tagMode: "ALL"
    });
    expect(wrongAllTags.nodes).toHaveLength(0);

    const status = filterWorldGraph(model, {
      ...DEFAULT_WORLD_GRAPH_FILTERS,
      kinds: ["OTHER"],
      statuses: ["ARCHIVED"]
    });
    expect(status.nodes.map((item) => item.id)).toEqual(["archived"]);

    const relationType = filterWorldGraph(model, {
      ...DEFAULT_WORLD_GRAPH_FILTERS,
      relationTypeIds: ["type-undirected"],
      relationDirection: "UNDIRECTED",
      showIsolated: false
    });
    expect(relationType.nodes.map((item) => item.id)).toEqual(["b", "c", "d"]);
    expect(relationType.edges.map((item) => item.id)).toEqual(["bc", "cd"]);
  });

  it("searches name, alias, tag and summary in deterministic priority order", () => {
    expect(searchWorldGraphNodes(nodes, "레이아")[0]).toMatchObject({
      node: { id: "a" },
      matchedBy: "LABEL"
    });
    expect(searchWorldGraphNodes(nodes, "북부의 마법사")[0]).toMatchObject({
      node: { id: "a" },
      matchedBy: "ALIAS"
    });
    expect(searchWorldGraphNodes(nodes, "요새")[0]).toMatchObject({
      node: { id: "c" },
      matchedBy: "TAG"
    });
    expect(searchWorldGraphNodes(nodes, "왕국의 문")[0]).toMatchObject({
      node: { id: "d" },
      matchedBy: "SUMMARY"
    });
  });

  it("keeps core diagnostics separate and rejects corrupt renderer input", () => {
    const corruptModel: WorldGraphReadModelView = {
      ...model,
      nodes: [...nodes, node("foreign", "OTHER", { projectId: "project-2" })],
      edges: [
        ...edges,
        edge("bc-reversed", "c", "b", {
          relationTypeId: "type-undirected",
          forwardLabel: "적대",
          inverseLabel: null,
          directed: false
        }),
        edge("self", "a", "a"),
        edge("foreign-edge", "a", "b", { projectId: "project-2" }),
        edge("missing", "a", "not-found")
      ],
      diagnostics: [
        {
          code: "INVALID_SCENE_LINK",
          severity: "WARNING",
          recordId: "link-1",
          message: "core finding"
        }
      ]
    };
    const filtered = filterWorldGraph(corruptModel, DEFAULT_WORLD_GRAPH_FILTERS);
    expect(filtered.diagnostics).toHaveLength(1);
    expect(filtered.renderDiagnostics.map((item) => item.code)).toEqual([
      "CROSS_PROJECT_NODE",
      "DUPLICATE_UNDIRECTED_EDGE",
      "SELF_RELATION",
      "CROSS_PROJECT_EDGE",
      "MISSING_ENDPOINT"
    ]);
    expect(filtered.edges.map((item) => item.id)).toEqual(["ab", "bc", "cd"]);
  });

  it("converts all entity styles and directed/undirected semantics without domain mutation", () => {
    expect(WORLD_GRAPH_KIND_SHAPES).toEqual({
      CHARACTER: "ellipse",
      LOCATION: "round-rectangle",
      ORGANIZATION: "hexagon",
      ITEM: "diamond",
      EVENT: "ellipse",
      WORLD_RULE: "rectangle",
      FORESHADOWING: "star",
      OTHER: "octagon"
    });
    const filtered = filterWorldGraph(model, {
      ...DEFAULT_WORLD_GRAPH_FILTERS,
      statuses: ["ACTIVE", "ARCHIVED"]
    });
    const elements = toCytoscapeElements(filtered, true, {
      kind: "NODE",
      id: "a"
    });
    const a = elements.find((element) => element.data.id === "a");
    const c = elements.find((element) => element.data.id === "c");
    const b = elements.find((element) => element.data.id === "b");
    const directed = elements.find((element) => element.data.id === "ab");
    const undirected = elements.find((element) => element.data.id === "bc");
    expect(a?.data.shape).toBe("ellipse");
    expect(c?.data.shape).toBe("round-rectangle");
    expect(a?.classes).toContain("selected");
    expect(b?.classes).toContain("neighbor");
    expect(c?.classes).toContain("dimmed");
    expect(directed?.data.targetArrowShape).toBe("triangle");
    expect(directed?.classes).toContain("directed");
    expect(undirected?.data.targetArrowShape).toBe("none");
    expect(undirected?.classes).toContain("undirected");
    expect(model.edges).toEqual(edges);
    expect(
      WORLD_GRAPH_CYTOSCAPE_STYLES.some(
        (rule) => rule.selector === "node.selected, node.endpoint"
      )
    ).toBe(true);
  });

  it("normalizes untrusted persisted state and keeps the shared DTO shape", () => {
    expect(
      normalizeWorldGraphUiState({
        mode: "FOCUSED",
        focusedEntityId: "a",
        depth: 3,
        layout: "preset",
        filters: {
          ...DEFAULT_WORLD_GRAPH_FILTERS,
          statuses: ["ACTIVE", "INVALID"]
        },
        viewport: { zoom: 1.4, pan: { x: 9, y: -4 } },
        nodePositions: {
          a: { x: 12, y: 22 },
          broken: { x: "bad", y: 3 }
        },
        selectedEntityId: "a"
      })
    ).toMatchObject({
      mode: "FOCUSED",
      focusedEntityId: "a",
      depth: 3,
      layout: "preset",
      filters: { statuses: ["ACTIVE"] },
      viewport: { zoom: 1.4, pan: { x: 9, y: -4 } },
      nodePositions: { a: { x: 12, y: 22 } },
      selectedEntityId: "a"
    });
  });
});
