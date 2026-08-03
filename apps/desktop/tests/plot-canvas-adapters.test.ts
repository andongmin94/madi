import { MarkerType } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import {
  JsonCanvasValidationError,
  MAX_JSON_CANVAS_EDGES,
  addCanvasEdge,
  addCanvasNode,
  applyCanvasRuntimeNodeChanges,
  canonicalizeJsonCanvas,
  convertReferenceToText,
  createCanvasEdge,
  createEntityReferenceCanvasNode,
  createGroupCanvasNode,
  createJsonCanvasImportPreview,
  createSceneReferenceCanvasNode,
  createTextCanvasNode,
  deleteCanvasSelection,
  duplicateCanvasNodes,
  parseJsonCanvas,
  relinkEntityReference,
  resolveCanvasNodeDisplay,
  validateMadiCanvasDocument
} from "../src/renderer/components/plotCanvas";
import { ReactFlowAdapter } from "../src/renderer/components/plotCanvas/reactFlowAdapter";
import type {
  CanvasEntityReference,
  CanvasReferenceCatalog,
  CanvasSceneReference,
  MadiCanvasDocument
} from "../src/renderer/components/plotCanvas/types";

const entity: CanvasEntityReference = {
  id: "entity-leia",
  name: "레이아",
  kind: "CHARACTER",
  status: "ACTIVE",
  summary: "북부 출신 마법사",
  colorToken: "#4263eb",
  aliases: ["북부의 마법사"],
  tags: ["주요 인물"],
  relationCount: 4
};

const replacementEntity: CanvasEntityReference = {
  ...entity,
  id: "entity-serina",
  name: "세리나",
  aliases: []
};

const scene: CanvasSceneReference = {
  id: "scene-17-2",
  episodeTitle: "17화 귀환",
  sceneTitle: "성문 앞",
  recoveryFirstSentence: "레이아는 닫힌 성문을 올려다봤다.",
  characterCount: 1280,
  hasSceneBreak: true
};

const catalog: CanvasReferenceCatalog = {
  entities: [entity, replacementEntity],
  scenes: [scene]
};

let sequence = 0;
const idFactory = (prefix: "node" | "edge") => `${prefix}-${++sequence}`;

function fixture(): MadiCanvasDocument {
  sequence = 0;
  const group = createGroupCanvasNode("1부", { x: 20, y: 30 }, idFactory);
  const text = {
    ...createTextCanvasNode("핵심 갈등", { x: 60, y: 90 }, idFactory),
    madi: { nodeKind: "TEXT" as const, parentGroupId: group.id }
  };
  const entityNode = createEntityReferenceCanvasNode(
    entity,
    { x: 600, y: 100 },
    idFactory
  );
  const sceneNode = createSceneReferenceCanvasNode(
    scene,
    { x: 600, y: 340 },
    idFactory
  );
  const edge = {
    ...createCanvasEdge(entityNode.id, sceneNode.id, idFactory),
    label: "결심 뒤 이동",
    color: "#ef4444",
    fromEnd: "arrow" as const,
    toEnd: "arrow" as const,
    madi: { lineStyle: "DOTTED" as const }
  };
  return {
    nodes: [group, text, entityNode, sceneNode],
    edges: [edge]
  };
}

describe("JSON Canvas adapter", () => {
  it("validates, deterministically serializes and round-trips supported JSON Canvas fields", () => {
    const source = fixture();
    const canonical = canonicalizeJsonCanvas(source);
    expect(canonical.endsWith("\n")).toBe(true);
    expect(canonical.indexOf('"edges"')).toBeLessThan(canonical.indexOf('"nodes"'));
    expect(parseJsonCanvas(canonical)).toEqual(validateMadiCanvasDocument(source));
    expect(canonicalizeJsonCanvas(parseJsonCanvas(canonical))).toBe(canonical);
  });

  it("preserves inert unknown extension data while rejecting executable/url node types", () => {
    const source = fixture();
    const extended = {
      ...source,
      vendor: { version: 1, note: "inert" },
      nodes: source.nodes.map((node, index) =>
        index === 0 ? { ...node, vendorFlag: true } : node
      )
    };
    const validated = validateMadiCanvasDocument(extended);
    expect((validated as unknown as { vendor: unknown }).vendor).toEqual({
      version: 1,
      note: "inert"
    });
    expect(
      (validated.nodes[0] as unknown as { vendorFlag: unknown }).vendorFlag
    ).toBe(true);

    expect(() =>
      validateMadiCanvasDocument({
        nodes: [
          {
            id: "link-1",
            type: "link",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            url: "https://example.invalid"
          }
        ],
        edges: []
      })
    ).toThrow(JsonCanvasValidationError);
  });

  it("rejects duplicate ids, missing endpoints and malformed reference extensions", () => {
    const source = fixture();
    expect(() =>
      validateMadiCanvasDocument({
        ...source,
        nodes: [{ ...source.nodes[0], x: 20.5 }, ...source.nodes.slice(1)]
      })
    ).toThrow(/정수/);
    expect(() =>
      validateMadiCanvasDocument({
        ...source,
        nodes: [...source.nodes, { ...source.nodes[0] }]
      })
    ).toThrow(/중복 id/);
    expect(() =>
      validateMadiCanvasDocument({
        ...source,
        edges: [{ ...source.edges[0], toNode: "missing" }]
      })
    ).toThrow(/endpoint/);
    expect(() =>
      validateMadiCanvasDocument({
        nodes: [
          {
            id: "broken-shape",
            type: "text",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            text: "fallback",
            madi: { nodeKind: "ENTITY_REFERENCE" }
          }
        ],
        edges: []
      })
    ).toThrow(/entityId/);
  });

  it("enforces the authoritative 500 node / 1000 edge import boundary", () => {
    const source = fixture();
    expect(MAX_JSON_CANVAS_EDGES).toBe(1_000);
    expect(() =>
      validateMadiCanvasDocument({
        ...source,
        edges: Array.from({ length: 1_001 }, (_, index) => ({
          ...source.edges[0],
          id: `limit-edge-${index}`
        }))
      })
    ).toThrow(/최대 1000개/);
  });

  it("previews references without requiring referenced records to exist", () => {
    const source = fixture();
    const preview = createJsonCanvasImportPreview(
      canonicalizeJsonCanvas(source),
      { entities: [], scenes: [] }
    );
    expect(preview).toMatchObject({
      nodeCount: 4,
      edgeCount: 1,
      entityReferenceCount: 1,
      sceneReferenceCount: 1,
      brokenReferenceCount: 2
    });
  });
});

describe("React Flow adapter boundary", () => {
  it("resolves canonical entity/scene labels at render time and maps groups and edge semantics", () => {
    const source = fixture();
    const runtime = ReactFlowAdapter.toReactFlow(source, catalog, {
      kind: "EDGE",
      id: source.edges[0].id
    });
    const group = runtime.nodes.find((node) => node.data.display.kind === "GROUP")!;
    const groupedText = runtime.nodes.find(
      (node) => node.data.display.title === "핵심 갈등"
    )!;
    const entityRuntime = runtime.nodes.find(
      (node) => node.data.display.kind === "ENTITY_REFERENCE"
    )!;
    expect(runtime.nodes[0].id).toBe(group.id);
    expect(groupedText.parentId).toBe(group.id);
    expect(groupedText.position).toEqual({ x: 40, y: 60 });
    expect(groupedText).toMatchObject({
      width: groupedText.data.canonicalNode.width,
      height: groupedText.data.canonicalNode.height,
      measured: {
        width: groupedText.data.canonicalNode.width,
        height: groupedText.data.canonicalNode.height
      }
    });
    expect(entityRuntime.data.display).toMatchObject({
      title: "레이아",
      subtitle: "CHARACTER · ACTIVE",
      broken: false,
      badge: "별칭 1 · 관계 4"
    });
    expect(runtime.edges[0]).toMatchObject({
      label: "결심 뒤 이동",
      selected: true,
      markerStart: { type: MarkerType.ArrowClosed },
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { strokeDasharray: "2 5" }
    });
    expect(ReactFlowAdapter.fromReactFlow(runtime, source)).toEqual(source);
  });

  it("renders deleted references as broken without deleting the planning node", () => {
    const source = fixture();
    const referenceNode = source.nodes.find(
      (node) => node.madi?.nodeKind === "ENTITY_REFERENCE"
    )!;
    const display = resolveCanvasNodeDisplay(referenceNode, new Map(), new Map());
    expect(display).toMatchObject({
      title: "삭제된 설정",
      subtitle: "원래 이름: 레이아",
      broken: true
    });
    expect(ReactFlowAdapter.toReactFlow(source, { entities: [], scenes: [] }).nodes).toHaveLength(
      source.nodes.length
    );
  });

  it("preserves imported colors but never forwards arbitrary CSS values to render sinks", () => {
    const unsafeColor = "url(https://attacker.invalid/pixel)";
    const source = fixture();
    const unsafeDocument: MadiCanvasDocument = {
      ...source,
      nodes: source.nodes.map((node) => ({ ...node, color: unsafeColor })),
      edges: source.edges.map((edge) => ({ ...edge, color: unsafeColor }))
    };
    const unsafeCatalog: CanvasReferenceCatalog = {
      ...catalog,
      entities: catalog.entities.map((item) => ({
        ...item,
        colorToken: unsafeColor
      }))
    };
    const runtime = ReactFlowAdapter.toReactFlow(unsafeDocument, unsafeCatalog);

    for (const node of runtime.nodes) {
      expect(
        (node.style as Readonly<Record<string, string | number>>)[
          "--madi-canvas-node-accent"
        ]
      ).toBe("#64748b");
      expect(node.data.canonicalNode.color).toBe(unsafeColor);
    }
    expect(runtime.edges[0].style?.stroke).toBe("#64748b");
    expect(
      (runtime.edges[0].markerEnd as { readonly color?: string }).color
    ).toBe("#64748b");
    expect(runtime.edges[0].data?.canonicalEdge.color).toBe(unsafeColor);
    expect(ReactFlowAdapter.fromReactFlow(runtime, unsafeDocument)).toEqual(
      unsafeDocument
    );
  });
});

describe("canvas document editing", () => {
  it("applies group drag, child drag and resize as canonical absolute coordinates", () => {
    const source = fixture();
    const group = source.nodes[0];
    const child = source.nodes[1];
    const movedGroup = applyCanvasRuntimeNodeChanges(source, [
      { id: group.id, type: "position", position: { x: 120, y: 130 } }
    ]);
    expect(movedGroup.nodes.find((node) => node.id === child.id)).toMatchObject({
      x: 160,
      y: 190
    });
    const movedChild = applyCanvasRuntimeNodeChanges(movedGroup, [
      {
        id: child.id,
        type: "position",
        position: { x: 90, y: 100 },
        dimensions: { width: 360, height: 220 }
      }
    ]);
    expect(movedChild.nodes.find((node) => node.id === child.id)).toMatchObject({
      x: 210,
      y: 230,
      width: 360,
      height: 220
    });
  });

  it("rounds and clamps runtime and React Flow geometry before canonical commit", () => {
    const source = fixture();
    const target = source.nodes[2];
    const changed = applyCanvasRuntimeNodeChanges(source, [
      {
        id: target.id,
        type: "dimensions",
        position: { x: 10_000_000.6, y: -10_000_000.6 },
        dimensions: { width: 100_000.8, height: 0 }
      }
    ]);
    expect(changed.nodes.find((node) => node.id === target.id)).toMatchObject({
      x: 10_000_000,
      y: -10_000_000,
      width: 100_000,
      height: 1
    });

    const runtime = ReactFlowAdapter.toReactFlow(source, catalog);
    const runtimeTarget = runtime.nodes.find((node) => node.id === target.id)!;
    runtimeTarget.position = { x: -10_000_000.6, y: 10_000_000.6 };
    runtimeTarget.measured = { width: -8.4, height: 100_000.9 };
    expect(
      ReactFlowAdapter.fromReactFlow(runtime, source).nodes.find(
        (node) => node.id === target.id
      )
    ).toMatchObject({
      x: -10_000_000,
      y: 10_000_000,
      width: 1,
      height: 100_000
    });
  });

  it("duplicates selected subgraphs, deletes/ungroups groups, and keeps edges valid", () => {
    const source = fixture();
    sequence = 100;
    const duplicated = duplicateCanvasNodes(
      source,
      [source.nodes[2].id, source.nodes[3].id],
      idFactory
    );
    expect(duplicated.duplicatedNodeIds).toHaveLength(2);
    expect(duplicated.document.nodes).toHaveLength(6);
    expect(duplicated.document.edges).toHaveLength(2);

    const ungrouped = deleteCanvasSelection(
      source,
      { kind: "NODE", id: source.nodes[0].id },
      "UNGROUP"
    );
    expect(ungrouped.nodes).toHaveLength(3);
    expect(ungrouped.nodes[0].madi?.parentGroupId).toBeUndefined();
    const deleted = deleteCanvasSelection(
      source,
      { kind: "NODE", id: source.nodes[0].id },
      "DELETE_CHILDREN"
    );
    expect(deleted.nodes).toHaveLength(2);
  });

  it("relinks a broken reference or converts it to ordinary text", () => {
    const source = fixture();
    const reference = source.nodes.find(
      (node) => node.madi?.nodeKind === "ENTITY_REFERENCE"
    )!;
    const relinked = relinkEntityReference(source, reference.id, replacementEntity);
    expect(relinked.nodes.find((node) => node.id === reference.id)).toMatchObject({
      text: "세리나",
      madi: { entityId: "entity-serina", originalLabel: "세리나" }
    });
    const converted = convertReferenceToText(relinked, reference.id);
    expect(converted.nodes.find((node) => node.id === reference.id)).toMatchObject({
      text: "세리나",
      madi: { nodeKind: "TEXT" }
    });
  });

  it("adds only edges whose endpoints exist", () => {
    const first = createTextCanvasNode("A", { x: 0, y: 0 }, () => "a");
    const second = createTextCanvasNode("B", { x: 200, y: 0 }, () => "b");
    const source = addCanvasNode(addCanvasNode({ nodes: [], edges: [] }, first), second);
    expect(addCanvasEdge(source, createCanvasEdge("a", "missing"))).toBe(source);
    expect(addCanvasEdge(source, createCanvasEdge("a", "b")).edges).toHaveLength(1);
  });

  it("fails closed when document editing helpers reach node and edge limits", () => {
    const nodes = Array.from({ length: 500 }, (_, index) => ({
      ...createTextCanvasNode(`N${index}`, { x: index, y: 0 }, () => `n-${index}`)
    }));
    const edges = Array.from({ length: 1_000 }, (_, index) => ({
      ...createCanvasEdge("n-0", "n-1", () => `e-${index}`)
    }));
    const full: MadiCanvasDocument = { nodes, edges };
    expect(
      addCanvasNode(
        full,
        createTextCanvasNode("overflow", { x: 0, y: 0 }, () => "overflow")
      )
    ).toBe(full);
    expect(
      addCanvasEdge(full, createCanvasEdge("n-0", "n-1", () => "overflow-edge"))
    ).toBe(full);
    expect(duplicateCanvasNodes(full, ["n-0"]).document).toBe(full);
  });
});
