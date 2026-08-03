import { describe, expect, it } from "vitest";
import {
  applyCanvasRuntimeNodeChanges,
  canonicalizeJsonCanvas,
  parseJsonCanvas
} from "../src/renderer/components/plotCanvas";
import { ReactFlowAdapter } from "../src/renderer/components/plotCanvas/reactFlowAdapter";
import type {
  CanvasReferenceCatalog,
  MadiCanvasDocument,
  MadiCanvasEdge,
  MadiCanvasNode
} from "../src/renderer/components/plotCanvas/types";

function createScaleFixture(): {
  readonly document: MadiCanvasDocument;
  readonly catalog: CanvasReferenceCatalog;
} {
  const entities = Array.from({ length: 200 }, (_, index) => ({
    id: `entity-${index}`,
    name: `설정 ${index}`,
    kind: index % 2 === 0 ? "CHARACTER" : "LOCATION",
    status: "ACTIVE",
    summary: `성능 검증 설정 ${index}`,
    colorToken: null,
    aliases: [`별칭 ${index}`],
    tags: [`태그 ${index % 10}`],
    relationCount: index % 9
  }));
  const scenes = Array.from({ length: 200 }, (_, index) => ({
    id: `scene-${index}`,
    episodeTitle: `${Math.floor(index / 5) + 1}화`,
    sceneTitle: `장면 ${index}`,
    recoveryFirstSentence: `성능 검증 문장 ${index}`,
    characterCount: 800 + index,
    hasSceneBreak: index % 3 === 0
  }));
  const entityNodes = entities.map(
    (entity, index): MadiCanvasNode => ({
      id: `node-entity-${index}`,
      type: "text",
      x: (index % 25) * 320,
      y: Math.floor(index / 25) * 210,
      width: 280,
      height: 168,
      text: entity.name,
      madi: {
        nodeKind: "ENTITY_REFERENCE",
        entityId: entity.id,
        originalLabel: entity.name
      }
    })
  );
  const sceneNodes = scenes.map(
    (scene, index): MadiCanvasNode => ({
      id: `node-scene-${index}`,
      type: "text",
      x: (index % 25) * 320,
      y: 1800 + Math.floor(index / 25) * 210,
      width: 300,
      height: 176,
      text: `${scene.episodeTitle} · ${scene.sceneTitle}`,
      madi: {
        nodeKind: "SCENE_REFERENCE",
        sceneNodeId: scene.id,
        originalLabel: scene.sceneTitle
      }
    })
  );
  const textNodes = Array.from(
    { length: 90 },
    (_, index): MadiCanvasNode => ({
      id: `node-text-${index}`,
      type: "text",
      x: (index % 15) * 320,
      y: 3600 + Math.floor(index / 15) * 190,
      width: 280,
      height: 150,
      text: `플롯 메모 ${index}`,
      madi: { nodeKind: "TEXT" }
    })
  );
  const groups = Array.from(
    { length: 10 },
    (_, index): MadiCanvasNode => ({
      id: `node-group-${index}`,
      type: "group",
      x: index * 560,
      y: 4800,
      width: 520,
      height: 360,
      label: `그룹 ${index}`,
      madi: { nodeKind: "GROUP" }
    })
  );
  const nodes = [...entityNodes, ...sceneNodes, ...textNodes, ...groups];
  const edges = Array.from(
    { length: 1_000 },
    (_, index): MadiCanvasEdge => ({
      id: `edge-${index}`,
      fromNode: nodes[index % nodes.length].id,
      toNode: nodes[(index * 7 + 11) % nodes.length].id,
      fromEnd: "none",
      toEnd: index % 3 === 0 ? "none" : "arrow",
      label: `흐름 ${index}`,
      madi: {
        lineStyle:
          index % 3 === 0 ? "SOLID" : index % 3 === 1 ? "DASHED" : "DOTTED"
      }
    })
  );
  return { document: { nodes, edges }, catalog: { entities, scenes } };
}

function measure(operation: () => void): number {
  const startedAt = performance.now();
  operation();
  return performance.now() - startedAt;
}

function summarize(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)),
    maximumMs: Number(Math.max(...values).toFixed(3)),
    runsMs: values.map((value) => Number(value.toFixed(3)))
  };
}

describe("Plot Canvas renderer performance", () => {
  it(
    "converts and validates 500 nodes / 1000 edges without loss across five runs",
    () => {
      const fixture = createScaleFixture();
      const serialized = canonicalizeJsonCanvas(fixture.document);
      const parseRuns: number[] = [];
      const adapterRuns: number[] = [];
      const searchRuns: number[] = [];
      const multiDragRuns: number[] = [];
      const serializeRuns: number[] = [];
      for (let run = 0; run < 5; run += 1) {
        let parsed!: MadiCanvasDocument;
        parseRuns.push(
          measure(() => {
            parsed = parseJsonCanvas(serialized);
          })
        );
        let runtime!: ReturnType<typeof ReactFlowAdapter.toReactFlow>;
        adapterRuns.push(
          measure(() => {
            runtime = ReactFlowAdapter.toReactFlow(parsed, fixture.catalog);
          })
        );
        searchRuns.push(
          measure(() => {
            const result = runtime.nodes.filter((node) =>
              node.data.display.title.includes("설정 19")
            );
            expect(result.length).toBeGreaterThan(0);
          })
        );
        multiDragRuns.push(
          measure(() => {
            const moved = applyCanvasRuntimeNodeChanges(
              parsed,
              parsed.nodes.slice(0, 100).map((node) => ({
                id: node.id,
                type: "position",
                position: { x: node.x + 8, y: node.y + 8 }
              }))
            );
            expect(moved.nodes).toHaveLength(500);
            expect(moved.edges).toHaveLength(1_000);
          })
        );
        serializeRuns.push(
          measure(() => {
            expect(canonicalizeJsonCanvas(parsed).length).toBe(serialized.length);
          })
        );
        expect(runtime.nodes).toHaveLength(500);
        expect(runtime.edges).toHaveLength(1_000);
      }
      const result = {
        fixture: { nodes: 500, edges: 1_000, entityReferences: 200, sceneReferences: 200 },
        jsonValidationParse: summarize(parseRuns),
        reactFlowConversion: summarize(adapterRuns),
        nodeSearch: summarize(searchRuns),
        multiNodeDragDtoUpdate: summarize(multiDragRuns),
        canonicalSerialization: summarize(serializeRuns),
        serializedBytes: new TextEncoder().encode(serialized).byteLength
      };
      console.info(`PLOT_CANVAS_RENDERER_PERFORMANCE ${JSON.stringify(result)}`);
      expect(result.jsonValidationParse.maximumMs).toBeLessThan(1_000);
      expect(result.reactFlowConversion.maximumMs).toBeLessThan(500);
      expect(result.nodeSearch.maximumMs).toBeLessThan(250);
      expect(result.multiNodeDragDtoUpdate.maximumMs).toBeLessThan(250);
      expect(result.canonicalSerialization.maximumMs).toBeLessThan(1_000);
    },
    20_000
  );
});
