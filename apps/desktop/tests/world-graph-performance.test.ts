import cytoscape from "cytoscape";
import { describe, expect, it } from "vitest";
import {
  collectNeighborhoodNodeIds,
  filterWorldGraph,
  normalizeWorldGraphUiState,
  searchWorldGraphNodes
} from "../src/renderer/components/worldGraph/graphModel";
import { toCytoscapeElements } from "../src/renderer/components/worldGraph/cytoscapeElements";
import { createWorldGraphCoseLayoutOptions } from "../src/renderer/components/worldGraph/worldGraphLayout";
import {
  DEFAULT_WORLD_GRAPH_FILTERS,
  type WorldGraphEdgeView,
  type WorldGraphNodeView,
  type WorldGraphReadModelView
} from "../src/renderer/components/worldGraph/types";

interface TimingSummary {
  readonly medianMs: number;
  readonly maximumMs: number;
  readonly runsMs: readonly number[];
}

function summarize(values: readonly number[]): TimingSummary {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)),
    maximumMs: Number(Math.max(...sorted).toFixed(3)),
    runsMs: values.map((value) => Number(value.toFixed(3)))
  };
}

function measure(operation: () => void): number {
  const startedAt = performance.now();
  operation();
  return performance.now() - startedAt;
}

function largeFixture(): WorldGraphReadModelView {
  const nodes: WorldGraphNodeView[] = Array.from({ length: 500 }, (_, index) => ({
    id: `entity-${index}`,
    projectId: "project-scale",
    label: `설정 ${String(index).padStart(3, "0")}`,
    kind: [
      "CHARACTER",
      "LOCATION",
      "ORGANIZATION",
      "ITEM",
      "EVENT",
      "WORLD_RULE",
      "FORESHADOWING",
      "OTHER"
    ][index % 8] as WorldGraphNodeView["kind"],
    status: index % 11 === 0 ? "DRAFT" : "ACTIVE",
    summary: `성능 검증 설정 ${index}의 요약`,
    colorToken: null,
    iconKey: null,
    aliases: [
      `별칭 ${index}-0`,
      `별칭 ${index}-1`,
      `별칭 ${index}-2`
    ],
    tags: [
      {
        id: `tag-${index % 10}`,
        name: `태그 ${index % 10}`,
        colorToken: null
      }
    ],
    explicitSceneLinkCount: 4,
    outgoingRelationCount: 4,
    incomingRelationCount: 4,
    undirectedRelationCount: 0
  }));
  const edges: WorldGraphEdgeView[] = Array.from({ length: 2_000 }, (_, index) => {
    const sourceIndex = index % 500;
    const targetIndex =
      (sourceIndex + Math.floor(index / 500) + 1) % 500;
    const directed = index % 2 === 0;
    return {
      id: `relation-${index}`,
      projectId: "project-scale",
      sourceEntityId: `entity-${sourceIndex}`,
      targetEntityId: `entity-${targetIndex}`,
      relationTypeId: directed ? "type-directed" : "type-undirected",
      forwardLabel: directed ? "소속" : "적대",
      inverseLabel: directed ? "구성원을 가짐" : null,
      directed,
      colorToken: null,
      note: null
    };
  });
  return {
    projectId: "project-scale",
    revision: 100,
    nodes,
    edges,
    stats: {
      entityCount: 500,
      relationCount: 2_000,
      entityKindCounts: [],
      relationTypeCounts: [],
      topDegreeEntities: [],
      isolatedEntityCount: 0,
      directedRelationCount: 1_000,
      undirectedRelationCount: 1_000
    },
    diagnostics: []
  };
}

describe("World Graph 500/2,000 renderer performance", () => {
  it(
    "measures five filter/search/BFS/element/cose runs without dropping canonical data",
    () => {
      const model = largeFixture();
      const filtered = filterWorldGraph(model, DEFAULT_WORLD_GRAPH_FILTERS);
      expect(filtered.nodes).toHaveLength(500);
      expect(filtered.edges).toHaveLength(2_000);

      const filterRuns: number[] = [];
      const searchRuns: number[] = [];
      const bfsRuns: number[] = [];
      const elementRuns: number[] = [];
      const layoutRuns: number[] = [];
      const stateRestoreRuns: number[] = [];
      const heapDeltaRunsMb: number[] = [];
      const persistedState = {
        mode: "FOCUSED",
        focusedEntityId: "entity-0",
        depth: 3,
        filters: DEFAULT_WORLD_GRAPH_FILTERS,
        layout: "preset",
        viewport: { zoom: 0.85, pan: { x: 14, y: -22 } },
        nodePositions: Object.fromEntries(
          model.nodes.map((item, index) => [
            item.id,
            { x: index * 1.5, y: (index % 31) * 2.25 }
          ])
        ),
        selectedEntityId: "entity-0"
      };

      for (let run = 0; run < 5; run += 1) {
        let runGraph = filtered;
        filterRuns.push(
          measure(() => {
            runGraph = filterWorldGraph(model, DEFAULT_WORLD_GRAPH_FILTERS);
          })
        );
        searchRuns.push(
          measure(() => {
            const results = searchWorldGraphNodes(model.nodes, "설정 499");
            expect(results[0]?.node.id).toBe("entity-499");
          })
        );
        bfsRuns.push(
          measure(() => {
            for (const depth of [1, 2, 3] as const) {
              expect(
                collectNeighborhoodNodeIds(
                  runGraph.nodes,
                  runGraph.edges,
                  "entity-0",
                  depth
                ).size
              ).toBeGreaterThan(0);
            }
          })
        );
        let elements = toCytoscapeElements(runGraph, true, null);
        elementRuns.push(
          measure(() => {
            elements = toCytoscapeElements(runGraph, true, null);
          })
        );
        expect(elements).toHaveLength(2_500);
        stateRestoreRuns.push(
          measure(() => {
            const restored = normalizeWorldGraphUiState(persistedState);
            expect(Object.keys(restored.nodePositions)).toHaveLength(500);
            expect(restored.viewport.zoom).toBe(0.85);
          })
        );
        const heapBefore = process.memoryUsage().heapUsed;
        const cy = cytoscape({ headless: true, elements });
        layoutRuns.push(
          measure(() => {
            cy.layout(createWorldGraphCoseLayoutOptions(false)).run();
          })
        );
        expect(cy.nodes()).toHaveLength(500);
        expect(cy.edges()).toHaveLength(2_000);
        heapDeltaRunsMb.push(
          (process.memoryUsage().heapUsed - heapBefore) / (1024 * 1024)
        );
        cy.destroy();
      }

      const result = {
        fixture: { entities: 500, aliases: 1_500, relations: 2_000 },
        filter: summarize(filterRuns),
        search: summarize(searchRuns),
        bfsDepths123: summarize(bfsRuns),
        elementConversion: summarize(elementRuns),
        coseLayout: summarize(layoutRuns),
        stateNormalizeRestore: summarize(stateRestoreRuns),
        heapDeltaApproximate: {
          medianMb: Number(
            [...heapDeltaRunsMb]
              .sort((left, right) => left - right)
              [Math.floor(heapDeltaRunsMb.length / 2)].toFixed(3)
          ),
          maximumMb: Number(Math.max(...heapDeltaRunsMb).toFixed(3)),
          runsMb: heapDeltaRunsMb.map((value) => Number(value.toFixed(3))),
          note: "process.memoryUsage heap delta; GC timing is nondeterministic"
        }
      };
      console.info(`WORLD_GRAPH_RENDERER_PERFORMANCE ${JSON.stringify(result)}`);

      expect(result.filter.maximumMs).toBeLessThan(250);
      expect(result.search.maximumMs).toBeLessThan(250);
      expect(result.bfsDepths123.maximumMs).toBeLessThan(250);
      expect(result.elementConversion.maximumMs).toBeLessThan(250);
      expect(result.stateNormalizeRestore.maximumMs).toBeLessThan(250);
      expect(result.coseLayout.maximumMs).toBeLessThan(5_000);
    },
    30_000
  );
});
