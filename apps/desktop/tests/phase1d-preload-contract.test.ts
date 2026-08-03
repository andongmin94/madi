import { describe, expect, it, vi } from "vitest";
import { CORE_METHODS } from "../src/main/coreClient";
import { createMadiDesktopApi } from "../src/preload/bridge";
import {
  ALLOWED_IPC_CHANNELS,
  IPC_CHANNELS,
  type WorldGraphUiState
} from "../src/shared/contracts";

const state: WorldGraphUiState = {
  mode: "FULL",
  focusedEntityId: null,
  depth: 1,
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
  layout: "cose",
  viewport: { zoom: 1, pan: { x: 0, y: 0 } },
  nodePositions: {},
  selectedEntityId: null
};

describe("Phase 1D preload graph capabilities", () => {
  it("exposes only six fixed graph and graph-state IPC capabilities", async () => {
    const invoke = vi.fn(async (): Promise<unknown> => ({ state: null }));
    const api = createMadiDesktopApi(invoke);
    const sessionId = "session-id";

    await api.saveWorldGraphUiState({ sessionId, state });
    await api.loadWorldGraphUiState({ sessionId });
    await api.getWorldGraph({ sessionId });
    await api.getWorldGraphStats({ sessionId });
    await api.getEntityGraphDetail({ sessionId, entityId: "entity-1" });
    await api.getEntitySceneContext({ sessionId, entityId: "entity-1" });

    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.saveWorldGraphUiState, { sessionId, state }],
      [IPC_CHANNELS.loadWorldGraphUiState, { sessionId }],
      [IPC_CHANNELS.getWorldGraph, { sessionId }],
      [IPC_CHANNELS.getWorldGraphStats, { sessionId }],
      [
        IPC_CHANNELS.getEntityGraphDetail,
        { sessionId, entityId: "entity-1" }
      ],
      [
        IPC_CHANNELS.getEntitySceneContext,
        { sessionId, entityId: "entity-1" }
      ]
    ]);
    expect(ALLOWED_IPC_CHANNELS).toEqual(Object.values(IPC_CHANNELS));
    expect(new Set(ALLOWED_IPC_CHANNELS).size).toBe(
      ALLOWED_IPC_CHANNELS.length
    );
    expect(Object.isFrozen(api)).toBe(true);
    expect("invoke" in api).toBe(false);
    expect("executeSql" in api).toBe(false);
    expect("cytoscape" in api).toBe(false);
  });

  it("keeps the renderer DTO boundary free of generic core commands", () => {
    expect(CORE_METHODS).toEqual(
      expect.arrayContaining([
        "get_world_graph",
        "get_world_graph_stats",
        "get_entity_graph_detail",
        "get_entity_scene_context"
      ])
    );
    expect(CORE_METHODS).not.toContain("invoke");
    expect(CORE_METHODS).not.toContain("execute_sql");
    expect(CORE_METHODS).not.toContain("cytoscape");
  });
});
