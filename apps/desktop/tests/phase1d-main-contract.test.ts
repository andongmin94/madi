import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  DesktopService,
  type DialogPort
} from "../src/main/desktopService";
import {
  CORE_METHODS,
  type CoreClient,
  type CoreMethod
} from "../src/main/coreClient";
import { ProjectSessionRegistry } from "../src/main/projectSessions";
import type { WorldGraphUiState } from "../src/shared/contracts";

const FILE_PATH = "C:\\drafts\\world-graph.madi";
const PROJECT_ID = "project-1";
const SESSION_REVISION = 3;

function kindCounts() {
  return [
    { kind: "CHARACTER", count: 1 },
    { kind: "LOCATION", count: 0 },
    { kind: "ORGANIZATION", count: 1 },
    { kind: "ITEM", count: 0 },
    { kind: "EVENT", count: 0 },
    { kind: "WORLD_RULE", count: 0 },
    { kind: "FORESHADOWING", count: 0 },
    { kind: "OTHER", count: 0 }
  ];
}

function graphNode(
  id: string,
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    id,
    project_id: PROJECT_ID,
    label: id === "entity-1" ? "레이아" : "북부 마법사단",
    kind: id === "entity-1" ? "CHARACTER" : "ORGANIZATION",
    status: "ACTIVE",
    summary: id === "entity-1" ? "북부의 마법사" : null,
    color_token: id === "entity-1" ? "violet" : null,
    icon_key: id === "entity-1" ? "person" : null,
    aliases: id === "entity-1" ? ["레아"] : [],
    tags:
      id === "entity-1"
        ? [{ id: "tag-1", name: "북부", color_token: "blue" }]
        : [],
    explicit_scene_link_count: id === "entity-1" ? 1 : 0,
    outgoing_relation_count: id === "entity-1" ? 1 : 0,
    incoming_relation_count: id === "entity-2" ? 1 : 0,
    undirected_relation_count: 0,
    ...overrides
  };
}

function graphEdge(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: "relation-1",
    project_id: PROJECT_ID,
    source_entity_id: "entity-1",
    target_entity_id: "entity-2",
    relation_type_id: "relation-type-1",
    forward_label: "소속",
    inverse_label: "구성원을 가짐",
    directed: true,
    color_token: "blue",
    note: "단장",
    ...overrides
  };
}

function graphStats(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    entity_count: 2,
    relation_count: 1,
    entity_kind_counts: kindCounts(),
    relation_type_counts: [
      {
        relation_type_id: "relation-type-1",
        name: "소속",
        inverse_name: "구성원을 가짐",
        directed: true,
        color_token: "blue",
        is_builtin: true,
        count: 1
      }
    ],
    top_degree_entities: [
      { entity_id: "entity-1", label: "레이아", degree: 1 },
      { entity_id: "entity-2", label: "북부 마법사단", degree: 1 }
    ],
    isolated_entity_count: 0,
    directed_relation_count: 1,
    undirected_relation_count: 0,
    ...overrides
  };
}

function graphResponse(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    project_id: PROJECT_ID,
    revision: SESSION_REVISION,
    nodes: [graphNode("entity-1"), graphNode("entity-2")],
    edges: [graphEdge()],
    stats: graphStats(),
    diagnostics: [],
    ...overrides
  };
}

function createHarness(
  responder: (
    method: CoreMethod,
    params: Readonly<Record<string, unknown>>
  ) => unknown | Promise<unknown>
) {
  const request = vi.fn(
    async (
      method: CoreMethod,
      params: Readonly<Record<string, unknown>>
    ): Promise<unknown> => responder(method, params)
  );
  const core: CoreClient = { request, dispose: vi.fn() };
  const sessions = new ProjectSessionRegistry();
  const session = sessions.add({
    filePath: FILE_PATH,
    projectId: PROJECT_ID,
    title: "용 이야기",
    revision: SESSION_REVISION
  });
  const dialog: DialogPort = {
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] }))
  };
  return {
    request,
    session,
    service: new DesktopService(
      {} as BrowserWindow,
      dialog,
      core,
      sessions,
      "0.0.1"
    )
  };
}

const graphUiState: WorldGraphUiState = {
  mode: "FOCUSED",
  focusedEntityId: "entity-1",
  depth: 2,
  filters: {
    kinds: ["CHARACTER", "ORGANIZATION"],
    statuses: ["ACTIVE", "DRAFT"],
    tagIds: ["tag-1"],
    tagMode: "ANY",
    relationTypeIds: ["relation-type-1"],
    relationDirection: "ALL",
    showIsolated: true,
    showLabels: false
  },
  layout: "preset",
  viewport: { zoom: 1.25, pan: { x: 25, y: -40 } },
  nodePositions: {
    "entity-1": { x: 100, y: 200 },
    "entity-2": { x: 300, y: 400 }
  },
  selectedEntityId: "entity-1"
};

interface SerializedGraphUiState extends Record<string, unknown> {
  filters: Record<string, unknown>;
  viewport: {
    zoom: number;
    pan: { x: number; y: number };
  };
  node_positions: Record<string, { x: number; y: number }>;
  selected_entity_id: string | null;
}

function createGraphUiRoundTripHarness(
  mutateStored: (state: SerializedGraphUiState) => void
) {
  return createHarness((method, params) => {
    if (method !== "save_ui_state") {
      throw new Error(`unexpected method ${method}`);
    }
    const stored = structuredClone(params.value) as SerializedGraphUiState;
    mutateStored(stored);
    return {
      state: {
        project_id: PROJECT_ID,
        key: "world-graph.v1",
        value: stored,
        updated_at: "2026-08-02T00:00:00.000Z"
      }
    };
  });
}

describe("Phase 1D DesktopService graph contracts", () => {
  it("keeps the four read-only graph RPCs on the fixed allowlist", () => {
    expect(CORE_METHODS).toEqual(
      expect.arrayContaining([
        "get_world_graph",
        "get_world_graph_stats",
        "get_entity_graph_detail",
        "get_entity_scene_context"
      ])
    );
    expect(new Set(CORE_METHODS).size).toBe(CORE_METHODS.length);
    expect(CORE_METHODS).not.toContain("execute_sql");
    expect(CORE_METHODS).not.toContain("query_world_graph");
  });

  it("maps and validates every Madi-owned graph DTO without mutation fields", async () => {
    const harness = createHarness((method) => {
      switch (method) {
        case "get_world_graph":
          return graphResponse();
        case "get_world_graph_stats":
          return {
            project_id: PROJECT_ID,
            revision: SESSION_REVISION,
            stats: graphStats(),
            diagnostics: []
          };
        case "get_entity_graph_detail":
          return {
            project_id: PROJECT_ID,
            revision: SESSION_REVISION,
            entity: graphNode("entity-1"),
            outgoing_relations: [
              {
                edge: graphEdge(),
                counterpart_entity_id: "entity-2",
                display_label: "소속",
                perspective: "OUTGOING"
              }
            ],
            incoming_relations: [],
            undirected_relations: []
          };
        case "get_entity_scene_context":
          return {
            project_id: PROJECT_ID,
            revision: SESSION_REVISION,
            entity_id: "entity-1",
            links: [
              {
                scene_node_id: "scene-1",
                scene_title: "북부의 밤",
                role: "APPEARS",
                note: null
              }
            ]
          };
        default:
          throw new Error(`unexpected method ${method}`);
      }
    });

    const request = { sessionId: harness.session.sessionId };
    const graph = await harness.service.getWorldGraph(request);
    const stats = await harness.service.getWorldGraphStats(request);
    const detail = await harness.service.getEntityGraphDetail({
      ...request,
      entityId: "entity-1"
    });
    const scenes = await harness.service.getEntitySceneContext({
      ...request,
      entityId: "entity-1"
    });

    expect(graph).toMatchObject({
      projectId: PROJECT_ID,
      revision: SESSION_REVISION,
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: "entity-1",
          aliases: ["레아"],
          tags: expect.arrayContaining([
            expect.objectContaining({ id: "tag-1", colorToken: "blue" })
          ])
        })
      ]),
      edges: expect.arrayContaining([
        expect.objectContaining({
          sourceEntityId: "entity-1",
          targetEntityId: "entity-2",
          inverseLabel: "구성원을 가짐",
          directed: true
        })
      ])
    });
    expect(stats.stats.topDegreeEntities).toHaveLength(2);
    expect(detail.outgoingRelations[0]).toMatchObject({
      counterpartEntityId: "entity-2",
      displayLabel: "소속",
      perspective: "OUTGOING"
    });
    expect(scenes.links[0]).toEqual({
      sceneNodeId: "scene-1",
      sceneTitle: "북부의 밤",
      role: "APPEARS",
      note: null
    });
    expect(harness.request.mock.calls).toEqual([
      ["get_world_graph", { file_path: FILE_PATH }],
      ["get_world_graph_stats", { file_path: FILE_PATH }],
      [
        "get_entity_graph_detail",
        { file_path: FILE_PATH, entity_id: "entity-1" }
      ],
      [
        "get_entity_scene_context",
        { file_path: FILE_PATH, entity_id: "entity-1" }
      ]
    ]);
    for (const [, params] of harness.request.mock.calls) {
      expect(params).not.toHaveProperty("expected_revision");
      expect(params).not.toHaveProperty("saved_by");
    }
  });

  it("rejects cross-project, stale, unknown, and oversized graph responses", async () => {
    const crossProject = createHarness(() =>
      graphResponse({ project_id: "project-2" })
    );
    await expect(
      crossProject.service.getWorldGraph({
        sessionId: crossProject.session.sessionId
      })
    ).rejects.toThrow(/cross-project/u);

    const stale = createHarness(() => graphResponse({ revision: 2 }));
    await expect(
      stale.service.getWorldGraph({ sessionId: stale.session.sessionId })
    ).rejects.toThrow(/stale/u);

    const unknown = createHarness(() =>
      graphResponse({ cytoscape_elements: [] })
    );
    await expect(
      unknown.service.getWorldGraph({ sessionId: unknown.session.sessionId })
    ).rejects.toThrow(/Invalid world graph response/u);

    const oversized = createHarness(() =>
      graphResponse({
        nodes: Array.from({ length: 501 }, (_, index) =>
          graphNode(`entity-${index + 1}`)
        )
      })
    );
    await expect(
      oversized.service.getWorldGraph({ sessionId: oversized.session.sessionId })
    ).rejects.toThrow(/invalid world graph nodes/u);

    const tooManyEdges = createHarness(() =>
      graphResponse({
        edges: Array.from({ length: 2_001 }, (_, index) =>
          graphEdge({ id: `relation-${index}` })
        )
      })
    );
    await expect(
      tooManyEdges.service.getWorldGraph({
        sessionId: tooManyEdges.session.sessionId
      })
    ).rejects.toThrow(/invalid world graph edges/u);

    const unexpectedRequest = createHarness(() => graphResponse());
    const requestWithExtraCapability = {
      sessionId: unexpectedRequest.session.sessionId,
      executeSql: "SELECT * FROM entities"
    };
    await expect(
      unexpectedRequest.service.getWorldGraph(requestWithExtraCapability)
    ).rejects.toThrow(/Invalid world graph request/u);
  });

  it("persists bounded graph UI state under the snapshot-excluded key", async () => {
    let savedValue: unknown;
    const harness = createHarness((method, params) => {
      if (method === "save_ui_state") {
        savedValue = params.value;
        return {
          state: {
            project_id: PROJECT_ID,
            key: "world-graph.v1",
            value: savedValue,
            updated_at: "2026-08-02T00:00:00.000Z"
          }
        };
      }
      if (method === "load_ui_state") {
        return {
          state: {
            project_id: PROJECT_ID,
            key: "world-graph.v1",
            value: savedValue,
            updated_at: "2026-08-02T00:00:00.000Z"
          }
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const request = { sessionId: harness.session.sessionId };

    await harness.service.saveWorldGraphUiState({
      ...request,
      state: graphUiState
    });
    const loaded = await harness.service.loadWorldGraphUiState(request);

    expect(harness.request.mock.calls[0]).toEqual([
      "save_ui_state",
      expect.objectContaining({
        file_path: FILE_PATH,
        key: "world-graph.v1",
        value: expect.objectContaining({
          focused_entity_id: "entity-1",
          node_positions: graphUiState.nodePositions,
          selected_entity_id: "entity-1"
        })
      })
    ]);
    expect(harness.request.mock.calls[1]).toEqual([
      "load_ui_state",
      { file_path: FILE_PATH, key: "world-graph.v1" }
    ]);
    expect(loaded.state).toEqual(graphUiState);
  });

  it("tolerates sub-1e-9 JSON float drift without rounding-boundary false positives", async () => {
    const tinyFloatDrift = createGraphUiRoundTripHarness((stored) => {
      stored.viewport.zoom += 5e-14;
      stored.viewport.pan.x += 5e-14;
      stored.viewport.pan.y -= 5e-14;
      stored.node_positions["entity-1"]!.x += 5e-14;
      stored.node_positions["entity-2"]!.y -= 5e-14;
    });
    await expect(
      tinyFloatDrift.service.saveWorldGraphUiState({
        sessionId: tinyFloatDrift.session.sessionId,
        state: graphUiState
      })
    ).resolves.toBeUndefined();

    const roundingBoundaryState: WorldGraphUiState = {
      ...graphUiState,
      nodePositions: {
        ...graphUiState.nodePositions,
        "entity-1": { x: -999_425.9970870885, y: 200 }
      }
    };
    const jsonRoundTripDrift = createGraphUiRoundTripHarness((stored) => {
      stored.node_positions["entity-1"]!.x = -999_425.9970870884;
    });
    expect(
      roundingBoundaryState.nodePositions["entity-1"]!.x.toFixed(9)
    ).not.toBe(
      (-999_425.9970870884).toFixed(9)
    );
    await expect(
      jsonRoundTripDrift.service.saveWorldGraphUiState({
        sessionId: jsonRoundTripDrift.session.sessionId,
        state: roundingBoundaryState
      })
    ).resolves.toBeUndefined();
  });

  it("rejects meaningful graph UI state changes returned by the core", async () => {

    const meaningfulPositionDrift = createGraphUiRoundTripHarness((stored) => {
      stored.node_positions["entity-1"]!.x += 2e-9;
    });
    await expect(
      meaningfulPositionDrift.service.saveWorldGraphUiState({
        sessionId: meaningfulPositionDrift.session.sessionId,
        state: graphUiState
      })
    ).rejects.toThrow(/saved different world graph UI state/u);

    const changedFilter = createGraphUiRoundTripHarness((stored) => {
      stored.filters.show_labels = true;
    });
    await expect(
      changedFilter.service.saveWorldGraphUiState({
        sessionId: changedFilter.session.sessionId,
        state: graphUiState
      })
    ).rejects.toThrow(/saved different world graph UI state/u);

    const changedSelection = createGraphUiRoundTripHarness((stored) => {
      stored.selected_entity_id = "entity-2";
    });
    await expect(
      changedSelection.service.saveWorldGraphUiState({
        sessionId: changedSelection.session.sessionId,
        state: graphUiState
      })
    ).rejects.toThrow(/saved different world graph UI state/u);
  });

  it("returns null for legacy projects and rejects unsafe graph UI state", async () => {
    const legacy = createHarness(() => ({ state: null }));
    await expect(
      legacy.service.loadWorldGraphUiState({
        sessionId: legacy.session.sessionId
      })
    ).resolves.toEqual({ state: null });

    const crossProject = createHarness(() => ({
      state: {
        project_id: "project-2",
        key: "world-graph.v1",
        value: {},
        updated_at: "2026-08-02T00:00:00.000Z"
      }
    }));
    await expect(
      crossProject.service.loadWorldGraphUiState({
        sessionId: crossProject.session.sessionId
      })
    ).rejects.toThrow(/cross-project/u);

    const invalid = createHarness(() => undefined);
    await expect(
      invalid.service.saveWorldGraphUiState({
        sessionId: invalid.session.sessionId,
        state: {
          ...graphUiState,
          viewport: { ...graphUiState.viewport, zoom: Number.POSITIVE_INFINITY }
        }
      })
    ).rejects.toThrow(/world graph zoom/u);
    await expect(
      invalid.service.saveWorldGraphUiState({
        sessionId: invalid.session.sessionId,
        state: {
          ...graphUiState,
          nodePositions: Object.fromEntries(
            Array.from({ length: 501 }, (_, index) => [
              `entity-${index}`,
              { x: index, y: index }
            ])
          )
        }
      })
    ).rejects.toThrow(/node positions/u);
  });

  it("parses the 500 node / 2,000 edge IPC payload five times within budget", async () => {
    const nodes = Array.from({ length: 500 }, (_, index) => ({
      ...graphNode(`entity-${index.toString().padStart(3, "0")}`),
      label: `설정 ${index.toString().padStart(3, "0")}`,
      kind: "CHARACTER",
      aliases: [`별칭-${index}-a`, `별칭-${index}-b`, `별칭-${index}-c`],
      tags: [{ id: "tag-1", name: "대규모", color_token: null }],
      explicit_scene_link_count: 4,
      outgoing_relation_count: 4,
      incoming_relation_count: 4
    }));
    const edges = Array.from({ length: 2_000 }, (_, index) => ({
      ...graphEdge(),
      id: `relation-${index.toString().padStart(4, "0")}`,
      source_entity_id: `entity-${(index % 500).toString().padStart(3, "0")}`,
      target_entity_id: `entity-${((index + 1) % 500)
        .toString()
        .padStart(3, "0")}`
    }));
    const response = graphResponse({
      nodes,
      edges,
      stats: graphStats({
        entity_count: 500,
        relation_count: 2_000,
        entity_kind_counts: [
          { kind: "CHARACTER", count: 500 },
          ...kindCounts().slice(1).map((item) => ({ ...item, count: 0 }))
        ],
        relation_type_counts: [
          {
            relation_type_id: "relation-type-1",
            name: "소속",
            inverse_name: "구성원을 가짐",
            directed: true,
            color_token: "blue",
            is_builtin: true,
            count: 2_000
          }
        ],
        top_degree_entities: nodes.slice(0, 5).map((node) => ({
          entity_id: node.id,
          label: node.label,
          degree: 8
        })),
        directed_relation_count: 2_000
      })
    });
    const harness = createHarness(() => response);
    const durations: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      const startedAt = performance.now();
      const graph = await harness.service.getWorldGraph({
        sessionId: harness.session.sessionId
      });
      durations.push(performance.now() - startedAt);
      expect(graph.nodes).toHaveLength(500);
      expect(graph.edges).toHaveLength(2_000);
    }
    const sorted = [...durations].sort((left, right) => left - right);
    const measurement = {
      payloadBytes: Buffer.byteLength(JSON.stringify(response), "utf8"),
      runs: durations.map((duration) => Number(duration.toFixed(2))),
      medianMs: Number(sorted[2]!.toFixed(2)),
      maximumMs: Number(Math.max(...durations).toFixed(2))
    };
    console.info(
      `[phase1d-contract-performance] ${JSON.stringify(measurement)}`
    );
    expect(measurement.maximumMs).toBeLessThan(1_000);
  });
});
