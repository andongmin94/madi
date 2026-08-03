import cytoscape from "cytoscape";
import { describe, expect, it, vi } from "vitest";
import { applyWorldGraphSelectionStyles } from "../src/renderer/components/worldGraph/WorldGraphCanvas";
import { toCytoscapeElements } from "../src/renderer/components/worldGraph/cytoscapeElements";
import {
  loadWorldGraphDetailBundle,
  StaleWorldGraphDetailError,
  WorldGraphDetailCache
} from "../src/renderer/components/worldGraph/worldGraphInteraction";
import type {
  FilteredWorldGraph,
  WorldGraphEntityDetailView,
  WorldGraphNodeView,
  WorldGraphSceneContextView
} from "../src/renderer/components/worldGraph/types";

const entity: WorldGraphNodeView = {
  id: "entity-a",
  projectId: "project-1",
  label: "레이아",
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
  undirectedRelationCount: 0
};

const detail: WorldGraphEntityDetailView = {
  projectId: "project-1",
  revision: 7,
  entity,
  outgoingRelations: [],
  incomingRelations: [],
  undirectedRelations: []
};

const sceneContext: WorldGraphSceneContextView = {
  projectId: "project-1",
  revision: 7,
  entityId: entity.id,
  links: []
};

const identity = {
  projectId: "project-1",
  projectRevision: 7,
  entityId: entity.id
};

describe("World Graph interaction hardening primitives", () => {
  it("starts independent detail reads in parallel and returns content-free timings", async () => {
    const started: string[] = [];
    const detailLoader = vi.fn(async () => {
      started.push("detail");
      return detail;
    });
    const sceneLoader = vi.fn(async () => {
      started.push("scene");
      return sceneContext;
    });
    const mentionLoader = vi.fn(async () => {
      started.push("mention");
      return 3;
    });

    const pending = loadWorldGraphDetailBundle(identity, {
      detail: detailLoader,
      sceneContext: sceneLoader,
      mentionCount: mentionLoader
    });

    expect(started).toEqual(["detail", "scene", "mention"]);
    const result = await pending;
    expect(result.bundle).toEqual({ detail, sceneContext, mentionCount: 3 });
    expect(result.timing).toEqual({
      entityDetailRpcMs: expect.any(Number),
      sceneContextRpcMs: expect.any(Number),
      mentionDiscoveryRpcMs: expect.any(Number),
      lazyRpcRoundTripMs: expect.any(Number)
    });
    expect(JSON.stringify(result.timing)).not.toMatch(/레이아|entity-a|project-1/);
  });

  it("keys the session cache by project/revision/entity and invalidates prior revisions", () => {
    const cache = new WorldGraphDetailCache();
    const bundle = { detail, sceneContext, mentionCount: 3 };
    cache.set(identity, bundle);
    expect(cache.get(identity)).toBe(bundle);
    expect(
      cache.get({ ...identity, projectId: "project-2" })
    ).toBeNull();
    expect(cache.get({ ...identity, entityId: "entity-b" })).toBeNull();

    cache.activate(identity.projectId, identity.projectRevision + 1);
    expect(cache.get({ ...identity, projectRevision: 8 })).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("rejects a response from another revision before it can enter the cache", async () => {
    await expect(
      loadWorldGraphDetailBundle(identity, {
        detail: async () => ({ ...detail, revision: 6 }),
        sceneContext: async () => sceneContext,
        mentionCount: async () => 0
      })
    ).rejects.toBeInstanceOf(StaleWorldGraphDetailError);
  });

  it("updates only transient selection classes without regenerating element data or layout", () => {
    const neighbor: WorldGraphNodeView = {
      ...entity,
      id: "entity-b",
      label: "마법사단"
    };
    const graph: FilteredWorldGraph = {
      projectId: "project-1",
      revision: 7,
      nodes: [entity, neighbor],
      edges: [
        {
          id: "edge-1",
          projectId: "project-1",
          sourceEntityId: entity.id,
          targetEntityId: neighbor.id,
          relationTypeId: "member",
          forwardLabel: "소속",
          inverseLabel: "구성원을 가짐",
          directed: true,
          colorToken: null,
          note: null
        }
      ],
      diagnostics: [],
      renderDiagnostics: []
    };
    const cy = cytoscape({
      headless: true,
      elements: toCytoscapeElements(graph, true, null)
    });
    const dataBefore = cy.elements().map((item) => item.data());
    const layout = vi.spyOn(cy, "layout");

    const timing = applyWorldGraphSelectionStyles(cy, graph, {
      kind: "NODE",
      id: entity.id
    });

    expect(cy.getElementById(entity.id).hasClass("selected")).toBe(true);
    expect(cy.getElementById(neighbor.id).hasClass("neighbor")).toBe(true);
    expect(cy.getElementById("edge-1").hasClass("connected")).toBe(true);
    expect(cy.elements().map((item) => item.data())).toEqual(dataBefore);
    expect(layout).not.toHaveBeenCalled();
    expect(timing.cytoscapeNodeLookupMs).toBeGreaterThanOrEqual(0);
    expect(timing.neighborHighlightMs).toBeGreaterThanOrEqual(0);
    cy.destroy();
  });
});
