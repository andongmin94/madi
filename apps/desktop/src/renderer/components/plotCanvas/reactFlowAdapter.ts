import {
  MarkerType,
  Position,
  type Edge,
  type Node
} from "@xyflow/react";
import {
  normalizeCanvasCoordinate,
  normalizeCanvasDimension
} from "./canvasGeometry";
import { resolveCanvasNodeDisplay } from "./canvasDocument";
import type {
  CanvasReferenceCatalog,
  MadiCanvasDocument,
  MadiCanvasEdge,
  MadiCanvasNode,
  MadiCanvasSelection
} from "./types";

interface ReactFlowCanvasNodeData extends Record<string, unknown> {
  readonly canonicalNode: MadiCanvasNode;
  readonly display: ReturnType<typeof resolveCanvasNodeDisplay>;
}

interface ReactFlowCanvasEdgeData extends Record<string, unknown> {
  readonly canonicalEdge: MadiCanvasEdge;
}

export type ReactFlowCanvasNode = Node<ReactFlowCanvasNodeData, "madiCard">;
export type ReactFlowCanvasEdge = Edge<ReactFlowCanvasEdgeData>;

export interface ReactFlowCanvasModel {
  readonly nodes: readonly ReactFlowCanvasNode[];
  readonly edges: readonly ReactFlowCanvasEdge[];
}

function handlePosition(side: MadiCanvasEdge["fromSide"]): Position | undefined {
  switch (side) {
    case "top":
      return Position.Top;
    case "right":
      return Position.Right;
    case "bottom":
      return Position.Bottom;
    case "left":
      return Position.Left;
    default:
      return undefined;
  }
}

function colorValue(color: string | undefined, fallback: string): string {
  if (!color) {
    return fallback;
  }
  const presets: Readonly<Record<string, string>> = {
    "1": "#ef4444",
    "2": "#f97316",
    "3": "#eab308",
    "4": "#22c55e",
    "5": "#06b6d4",
    "6": "#8b5cf6"
  };
  if (presets[color]) {
    return presets[color];
  }
  return /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.test(color)
    ? color
    : fallback;
}

function toReactFlowNodes(
  document: MadiCanvasDocument,
  catalog: CanvasReferenceCatalog,
  selection: MadiCanvasSelection | null
): ReactFlowCanvasNode[] {
  const entities = new Map(catalog.entities.map((entity) => [entity.id, entity]));
  const scenes = new Map(catalog.scenes.map((scene) => [scene.id, scene]));
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  const ordered = [...document.nodes].sort((left, right) => {
    if (left.type === right.type) {
      return 0;
    }
    return left.type === "group" ? -1 : 1;
  });
  return ordered.map((node) => {
    const parentId = node.madi?.parentGroupId;
    const parent = parentId ? byId.get(parentId) : undefined;
    const display = resolveCanvasNodeDisplay(node, entities, scenes);
    return {
      id: node.id,
      type: "madiCard",
      position: parent
        ? { x: node.x - parent.x, y: node.y - parent.y }
        : { x: node.x, y: node.y },
      ...(parent?.type === "group"
        ? { parentId: parent.id, extent: "parent" as const }
        : {}),
      data: { canonicalNode: node, display },
      selected: selection?.kind === "NODE" && selection.id === node.id,
      draggable: true,
      selectable: true,
      connectable: true,
      deletable: false,
      focusable: true,
      zIndex: document.nodes.indexOf(node),
      width: node.width,
      height: node.height,
      measured: { width: node.width, height: node.height },
      style: {
        width: node.width,
        height: node.height,
        ...(display.color
          ? ({ "--madi-canvas-node-accent": colorValue(display.color, "#64748b") } as object)
          : {})
      },
      ariaLabel: `${display.title}, ${display.subtitle ?? display.kind}${
        display.broken ? ", 연결 끊김" : ""
      }`
    };
  });
}

function toReactFlowEdges(
  document: MadiCanvasDocument,
  selection: MadiCanvasSelection | null
): ReactFlowCanvasEdge[] {
  return document.edges.map((edge) => {
    const stroke = colorValue(edge.color, "#64748b");
    const lineStyle = edge.madi?.lineStyle ?? "SOLID";
    return {
      id: edge.id,
      source: edge.fromNode,
      target: edge.toNode,
      ...(edge.fromSide
        ? { sourceHandle: `source-${edge.fromSide}`, sourcePosition: handlePosition(edge.fromSide) }
        : {}),
      ...(edge.toSide
        ? { targetHandle: `target-${edge.toSide}`, targetPosition: handlePosition(edge.toSide) }
        : {}),
      label: edge.label,
      ...(edge.fromEnd === "arrow"
        ? { markerStart: { type: MarkerType.ArrowClosed, color: stroke } }
        : {}),
      ...(edge.toEnd === "arrow"
        ? { markerEnd: { type: MarkerType.ArrowClosed, color: stroke } }
        : {}),
      style: {
        stroke,
        strokeWidth: 1.75,
        ...(lineStyle === "DASHED"
          ? { strokeDasharray: "8 5" }
          : lineStyle === "DOTTED"
            ? { strokeDasharray: "2 5" }
            : {})
      },
      labelStyle: { fill: "#334155", fontSize: 12, fontWeight: 600 },
      labelShowBg: true,
      labelBgPadding: [5, 3],
      labelBgBorderRadius: 4,
      selected: selection?.kind === "EDGE" && selection.id === edge.id,
      selectable: true,
      deletable: false,
      focusable: true,
      data: { canonicalEdge: edge },
      ariaLabel: `${edge.label || "제목 없는 연결선"}, ${edge.fromNode}에서 ${edge.toNode}`
    };
  });
}

export function toReactFlowModel(
  document: MadiCanvasDocument,
  catalog: CanvasReferenceCatalog,
  selection: MadiCanvasSelection | null = null
): ReactFlowCanvasModel {
  return {
    nodes: toReactFlowNodes(document, catalog, selection),
    edges: toReactFlowEdges(document, selection)
  };
}

export function fromReactFlowModel(
  model: ReactFlowCanvasModel,
  previousDocument: MadiCanvasDocument
): MadiCanvasDocument {
  const runtimeById = new Map(model.nodes.map((node) => [node.id, node]));
  const previousById = new Map(previousDocument.nodes.map((node) => [node.id, node]));
  const nodes = model.nodes.map((runtime) => {
    const canonical = runtime.data.canonicalNode ?? previousById.get(runtime.id);
    if (!canonical) {
      throw new Error(`React Flow node '${runtime.id}'에 canonical DTO가 없습니다.`);
    }
    const parent = runtime.parentId ? runtimeById.get(runtime.parentId) : undefined;
    const width =
      runtime.measured?.width ??
      (typeof runtime.style?.width === "number" ? runtime.style.width : canonical.width);
    const height =
      runtime.measured?.height ??
      (typeof runtime.style?.height === "number" ? runtime.style.height : canonical.height);
    return {
      ...canonical,
      x: normalizeCanvasCoordinate(
        runtime.position.x + (parent?.position.x ?? 0)
      ),
      y: normalizeCanvasCoordinate(
        runtime.position.y + (parent?.position.y ?? 0)
      ),
      width: normalizeCanvasDimension(width, canonical.width),
      height: normalizeCanvasDimension(height, canonical.height)
    } as MadiCanvasNode;
  });
  const previousEdges = new Map(previousDocument.edges.map((edge) => [edge.id, edge]));
  const edges = model.edges.map((runtime) => {
    const canonical = runtime.data?.canonicalEdge ?? previousEdges.get(runtime.id);
    if (!canonical) {
      throw new Error(`React Flow edge '${runtime.id}'에 canonical DTO가 없습니다.`);
    }
    return {
      ...canonical,
      fromNode: runtime.source,
      toNode: runtime.target,
      ...(typeof runtime.label === "string" ? { label: runtime.label } : {})
    };
  });
  return { ...previousDocument, nodes, edges };
}

export const ReactFlowAdapter = {
  toReactFlow: toReactFlowModel,
  fromReactFlow: fromReactFlowModel
} as const;
