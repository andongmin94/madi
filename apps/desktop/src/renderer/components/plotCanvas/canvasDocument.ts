import type {
  CanvasEntityReference,
  CanvasPickerItem,
  CanvasReferenceDisplay,
  CanvasSceneReference,
  MadiCanvasDocument,
  MadiCanvasEdge,
  MadiCanvasNode,
  MadiCanvasPoint,
  MadiCanvasSelection
} from "./types";
import {
  normalizeCanvasCoordinate,
  normalizeCanvasDimension
} from "./canvasGeometry";
import {
  MAX_JSON_CANVAS_EDGES,
  MAX_JSON_CANVAS_NODES
} from "./jsonCanvasAdapter";

export type CanvasGroupDeleteMode = "DELETE_CHILDREN" | "UNGROUP" | "CANCEL";

export interface CanvasRuntimeNodeChange {
  readonly id: string;
  readonly type: string;
  readonly position?: MadiCanvasPoint;
  readonly dimensions?: {
    readonly width: number;
    readonly height: number;
  };
  readonly selected?: boolean;
}

export type CanvasIdFactory = (prefix: "node" | "edge") => string;

export function createCanvasId(prefix: "node" | "edge"): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function withNodeExtension(
  node: MadiCanvasNode,
  extension: NonNullable<MadiCanvasNode["madi"]>
): MadiCanvasNode {
  return { ...node, madi: extension } as MadiCanvasNode;
}

function jsonCanvasPosition(position: MadiCanvasPoint): MadiCanvasPoint {
  return {
    x: normalizeCanvasCoordinate(position.x),
    y: normalizeCanvasCoordinate(position.y)
  };
}

function normalizeNodeGeometry(node: MadiCanvasNode): MadiCanvasNode {
  const x = normalizeCanvasCoordinate(node.x);
  const y = normalizeCanvasCoordinate(node.y);
  const width = normalizeCanvasDimension(node.width, 1);
  const height = normalizeCanvasDimension(node.height, 1);
  return x === node.x &&
    y === node.y &&
    width === node.width &&
    height === node.height
    ? node
    : ({ ...node, x, y, width, height } as MadiCanvasNode);
}

export function createTextCanvasNode(
  text: string,
  position: MadiCanvasPoint,
  idFactory: CanvasIdFactory = createCanvasId
): MadiCanvasNode {
  const point = jsonCanvasPosition(position);
  return {
    id: idFactory("node"),
    type: "text",
    x: point.x,
    y: point.y,
    width: 280,
    height: 160,
    text,
    madi: { nodeKind: "TEXT" }
  };
}

export function createEntityReferenceCanvasNode(
  entity: CanvasEntityReference,
  position: MadiCanvasPoint,
  idFactory: CanvasIdFactory = createCanvasId
): MadiCanvasNode {
  const point = jsonCanvasPosition(position);
  return {
    id: idFactory("node"),
    type: "text",
    x: point.x,
    y: point.y,
    width: 280,
    height: 168,
    text: entity.name,
    ...(entity.colorToken ? { color: entity.colorToken } : {}),
    madi: {
      nodeKind: "ENTITY_REFERENCE",
      entityId: entity.id,
      originalLabel: entity.name
    }
  };
}

export function createSceneReferenceCanvasNode(
  scene: CanvasSceneReference,
  position: MadiCanvasPoint,
  idFactory: CanvasIdFactory = createCanvasId
): MadiCanvasNode {
  const point = jsonCanvasPosition(position);
  return {
    id: idFactory("node"),
    type: "text",
    x: point.x,
    y: point.y,
    width: 300,
    height: 176,
    text: `${scene.episodeTitle} · ${scene.sceneTitle}`,
    madi: {
      nodeKind: "SCENE_REFERENCE",
      sceneNodeId: scene.id,
      originalLabel: scene.sceneTitle
    }
  };
}

export function createGroupCanvasNode(
  label: string,
  position: MadiCanvasPoint,
  idFactory: CanvasIdFactory = createCanvasId
): MadiCanvasNode {
  const point = jsonCanvasPosition(position);
  return {
    id: idFactory("node"),
    type: "group",
    x: point.x,
    y: point.y,
    width: 520,
    height: 360,
    label,
    madi: { nodeKind: "GROUP" }
  };
}

export function createNodeFromPickerItem(
  item: CanvasPickerItem,
  position: MadiCanvasPoint,
  idFactory: CanvasIdFactory = createCanvasId
): MadiCanvasNode {
  if (item.kind === "ENTITY_REFERENCE") {
    return createEntityReferenceCanvasNode(item.entity, position, idFactory);
  }
  if (item.kind === "SCENE_REFERENCE") {
    return createSceneReferenceCanvasNode(item.scene, position, idFactory);
  }
  return createTextCanvasNode(item.text || "새 메모", position, idFactory);
}

export function createCanvasEdge(
  fromNode: string,
  toNode: string,
  idFactory: CanvasIdFactory = createCanvasId
): MadiCanvasEdge {
  return {
    id: idFactory("edge"),
    fromNode,
    toNode,
    fromEnd: "none",
    toEnd: "arrow",
    madi: { lineStyle: "SOLID" }
  };
}

export function addCanvasNode(
  document: MadiCanvasDocument,
  node: MadiCanvasNode
): MadiCanvasDocument {
  if (document.nodes.length >= MAX_JSON_CANVAS_NODES) {
    return document;
  }
  return { ...document, nodes: [...document.nodes, normalizeNodeGeometry(node)] };
}

export function addCanvasEdge(
  document: MadiCanvasDocument,
  edge: MadiCanvasEdge
): MadiCanvasDocument {
  if (
    document.edges.length >= MAX_JSON_CANVAS_EDGES ||
    !document.nodes.some((node) => node.id === edge.fromNode) ||
    !document.nodes.some((node) => node.id === edge.toNode)
  ) {
    return document;
  }
  return { ...document, edges: [...document.edges, edge] };
}

export function updateCanvasNode(
  document: MadiCanvasDocument,
  nodeId: string,
  update: (node: MadiCanvasNode) => MadiCanvasNode
): MadiCanvasDocument {
  let changed = false;
  const nodes = document.nodes.map((node) => {
    if (node.id !== nodeId) {
      return node;
    }
    const next = normalizeNodeGeometry(update(node));
    changed ||= next !== node;
    return next;
  });
  return changed ? { ...document, nodes } : document;
}

export function updateCanvasEdge(
  document: MadiCanvasDocument,
  edgeId: string,
  update: (edge: MadiCanvasEdge) => MadiCanvasEdge
): MadiCanvasDocument {
  let changed = false;
  const edges = document.edges.map((edge) => {
    if (edge.id !== edgeId) {
      return edge;
    }
    const next = update(edge);
    changed ||= next !== edge;
    return next;
  });
  return changed ? { ...document, edges } : document;
}

export function applyCanvasRuntimeNodeChanges(
  document: MadiCanvasDocument,
  changes: readonly CanvasRuntimeNodeChange[]
): MadiCanvasDocument {
  const byId = new Map<string, CanvasRuntimeNodeChange>();
  for (const change of changes) {
    const previous = byId.get(change.id);
    byId.set(
      change.id,
      previous && previous.type !== "remove" && change.type !== "remove"
        ? { ...previous, ...change }
        : change
    );
  }
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  const nextAbsolutePosition = (node: MadiCanvasNode): MadiCanvasPoint => {
    const direct = byId.get(node.id)?.position;
    const parentId = node.madi?.parentGroupId;
    const parent = parentId ? nodeById.get(parentId) : undefined;
    if (direct) {
      if (parent?.type === "group") {
        const parentPosition = nextAbsolutePosition(parent);
        return {
          x: parentPosition.x + direct.x,
          y: parentPosition.y + direct.y
        };
      }
      return direct;
    }
    if (parent?.type === "group") {
      const nextParent = nextAbsolutePosition(parent);
      return {
        x: node.x + nextParent.x - parent.x,
        y: node.y + nextParent.y - parent.y
      };
    }
    return { x: node.x, y: node.y };
  };
  const hasMovedAncestor = (node: MadiCanvasNode): boolean => {
    let parentId = node.madi?.parentGroupId;
    while (parentId) {
      if (byId.get(parentId)?.position) {
        return true;
      }
      parentId = nodeById.get(parentId)?.madi?.parentGroupId;
    }
    return false;
  };
  let changed = false;
  const nodes = document.nodes.map((node) => {
    const change = byId.get(node.id);
    if (!change && !hasMovedAncestor(node)) {
      return node;
    }
    if (change?.type === "remove") {
      changed = true;
      return null;
    }
    const position = change?.position ??
      (node.madi?.parentGroupId ? nextAbsolutePosition(node) : undefined);
    const dimensions = change?.dimensions;
    if (!position && !dimensions) {
      return node;
    }
    const canonicalPosition = position
      ? jsonCanvasPosition(
          change?.position ? nextAbsolutePosition(node) : position
        )
      : undefined;
    const next = {
      ...node,
      ...(canonicalPosition ?? {}),
      ...(dimensions
        ? {
            width: normalizeCanvasDimension(dimensions.width, node.width),
            height: normalizeCanvasDimension(dimensions.height, node.height)
          }
        : {})
    } as MadiCanvasNode;
    if (
      next.x === node.x &&
      next.y === node.y &&
      next.width === node.width &&
      next.height === node.height
    ) {
      return node;
    }
    changed = true;
    return next;
  });
  if (!changed) {
    return document;
  }
  const retainedNodes = nodes.filter((node): node is MadiCanvasNode => node !== null);
  const retainedIds = new Set(retainedNodes.map((node) => node.id));
  return {
    ...document,
    nodes: retainedNodes,
    edges: document.edges.filter(
      (edge) => retainedIds.has(edge.fromNode) && retainedIds.has(edge.toNode)
    )
  };
}

export function deleteCanvasSelection(
  document: MadiCanvasDocument,
  selection: MadiCanvasSelection | null,
  groupDeleteMode: CanvasGroupDeleteMode = "DELETE_CHILDREN"
): MadiCanvasDocument {
  if (!selection) {
    return document;
  }
  if (selection.kind === "EDGE") {
    const edges = document.edges.filter((edge) => edge.id !== selection.id);
    return edges.length === document.edges.length ? document : { ...document, edges };
  }
  const selected = document.nodes.find((node) => node.id === selection.id);
  if (!selected) {
    return document;
  }
  if (selected.type === "group" && groupDeleteMode === "CANCEL") {
    return document;
  }
  const removedIds = new Set([selected.id]);
  if (selected.type === "group" && groupDeleteMode === "DELETE_CHILDREN") {
    let grew = true;
    while (grew) {
      grew = false;
      for (const node of document.nodes) {
        if (
          node.madi?.parentGroupId &&
          removedIds.has(node.madi.parentGroupId) &&
          !removedIds.has(node.id)
        ) {
          removedIds.add(node.id);
          grew = true;
        }
      }
    }
  }
  const nodes = document.nodes
    .filter((node) => !removedIds.has(node.id))
    .map((node) => {
      if (
        selected.type === "group" &&
        groupDeleteMode === "UNGROUP" &&
        node.madi?.parentGroupId === selected.id
      ) {
        const { parentGroupId: _removed, ...madi } = node.madi;
        return withNodeExtension(node, madi as NonNullable<MadiCanvasNode["madi"]>);
      }
      return node;
    });
  return {
    ...document,
    nodes,
    edges: document.edges.filter(
      (edge) => !removedIds.has(edge.fromNode) && !removedIds.has(edge.toNode)
    )
  };
}

export function duplicateCanvasNodes(
  document: MadiCanvasDocument,
  nodeIds: readonly string[],
  idFactory: CanvasIdFactory = createCanvasId
): { readonly document: MadiCanvasDocument; readonly duplicatedNodeIds: readonly string[] } {
  const selected = new Set(nodeIds);
  const duplicatedNodeCount = document.nodes.filter((node) =>
    selected.has(node.id)
  ).length;
  const duplicatedEdgeCount = document.edges.filter(
    (edge) => selected.has(edge.fromNode) && selected.has(edge.toNode)
  ).length;
  if (
    duplicatedNodeCount === 0 ||
    document.nodes.length + duplicatedNodeCount > MAX_JSON_CANVAS_NODES ||
    document.edges.length + duplicatedEdgeCount > MAX_JSON_CANVAS_EDGES
  ) {
    return { document, duplicatedNodeIds: [] };
  }
  const idMap = new Map<string, string>();
  for (const node of document.nodes) {
    if (selected.has(node.id)) {
      idMap.set(node.id, idFactory("node"));
    }
  }
  const duplicatedNodes = document.nodes
    .filter((node) => selected.has(node.id))
    .map((node) => {
      const newId = idMap.get(node.id)!;
      const oldParent = node.madi?.parentGroupId;
      return normalizeNodeGeometry({
        ...node,
        id: newId,
        x: normalizeCanvasCoordinate(node.x + 32),
        y: normalizeCanvasCoordinate(node.y + 32),
        ...(node.madi
          ? {
              madi: {
                ...node.madi,
                ...(oldParent && idMap.has(oldParent)
                  ? { parentGroupId: idMap.get(oldParent) }
                  : {})
              }
            }
          : {})
      } as MadiCanvasNode);
    });
  const duplicatedEdges = document.edges
    .filter((edge) => idMap.has(edge.fromNode) && idMap.has(edge.toNode))
    .map(
      (edge): MadiCanvasEdge => ({
        ...edge,
        id: idFactory("edge"),
        fromNode: idMap.get(edge.fromNode)!,
        toNode: idMap.get(edge.toNode)!
      })
    );
  if (duplicatedNodes.length === 0) {
    return { document, duplicatedNodeIds: [] };
  }
  return {
    document: {
      ...document,
      nodes: [...document.nodes, ...duplicatedNodes],
      edges: [...document.edges, ...duplicatedEdges]
    },
    duplicatedNodeIds: duplicatedNodes.map((node) => node.id)
  };
}

export function reorderCanvasNode(
  document: MadiCanvasDocument,
  nodeId: string,
  direction: "FRONT" | "BACK"
): MadiCanvasDocument {
  const selected = document.nodes.find((node) => node.id === nodeId);
  if (!selected) {
    return document;
  }
  const rest = document.nodes.filter((node) => node.id !== nodeId);
  return {
    ...document,
    nodes: direction === "FRONT" ? [...rest, selected] : [selected, ...rest]
  };
}

export function relinkEntityReference(
  document: MadiCanvasDocument,
  nodeId: string,
  entity: CanvasEntityReference
): MadiCanvasDocument {
  return updateCanvasNode(document, nodeId, (node) => {
    if (node.type !== "text" || node.madi?.nodeKind !== "ENTITY_REFERENCE") {
      return node;
    }
    return {
      ...node,
      text: entity.name,
      ...(entity.colorToken ? { color: entity.colorToken } : {}),
      madi: {
        ...node.madi,
        entityId: entity.id,
        originalLabel: entity.name
      }
    };
  });
}

export function relinkSceneReference(
  document: MadiCanvasDocument,
  nodeId: string,
  scene: CanvasSceneReference
): MadiCanvasDocument {
  return updateCanvasNode(document, nodeId, (node) => {
    if (node.type !== "text" || node.madi?.nodeKind !== "SCENE_REFERENCE") {
      return node;
    }
    return {
      ...node,
      text: `${scene.episodeTitle} · ${scene.sceneTitle}`,
      madi: {
        ...node.madi,
        sceneNodeId: scene.id,
        originalLabel: scene.sceneTitle
      }
    };
  });
}

export function convertReferenceToText(
  document: MadiCanvasDocument,
  nodeId: string
): MadiCanvasDocument {
  return updateCanvasNode(document, nodeId, (node) => {
    if (node.type !== "text" || !node.madi || node.madi.nodeKind === "TEXT") {
      return node;
    }
    const { entityId: _entity, sceneNodeId: _scene, originalLabel: _label, ...rest } =
      node.madi;
    return { ...node, madi: { ...rest, nodeKind: "TEXT" } };
  });
}

export function resolveCanvasNodeDisplay(
  node: MadiCanvasNode,
  entities: ReadonlyMap<string, CanvasEntityReference>,
  scenes: ReadonlyMap<string, CanvasSceneReference>
): CanvasReferenceDisplay {
  if (node.type === "group") {
    return {
      kind: "GROUP",
      title: node.label || "제목 없는 그룹",
      subtitle: "그룹",
      description: null,
      badge: null,
      color: node.color ?? null,
      broken: false,
      referenceId: null
    };
  }
  if (node.madi?.nodeKind === "ENTITY_REFERENCE") {
    const entityId = node.madi.entityId ?? "";
    const entity = entities.get(entityId);
    return entity
      ? {
          kind: "ENTITY_REFERENCE",
          title: entity.name,
          subtitle: `${entity.kind} · ${entity.status}`,
          description: entity.summary,
          badge: `별칭 ${entity.aliases.length} · 관계 ${entity.relationCount}`,
          color: entity.colorToken ?? node.color ?? null,
          broken: false,
          referenceId: entity.id
        }
      : {
          kind: "ENTITY_REFERENCE",
          title: "삭제된 설정",
          subtitle: `원래 이름: ${node.madi.originalLabel || node.text}`,
          description: null,
          badge: "연결 끊김",
          color: node.color ?? null,
          broken: true,
          referenceId: entityId || null
        };
  }
  if (node.madi?.nodeKind === "SCENE_REFERENCE") {
    const sceneId = node.madi.sceneNodeId ?? "";
    const scene = scenes.get(sceneId);
    return scene
      ? {
          kind: "SCENE_REFERENCE",
          title: scene.sceneTitle,
          subtitle: scene.episodeTitle,
          description: scene.recoveryFirstSentence,
          badge: `${scene.characterCount.toLocaleString()}자${scene.hasSceneBreak ? " · 장면 구분" : ""}`,
          color: node.color ?? null,
          broken: false,
          referenceId: scene.id
        }
      : {
          kind: "SCENE_REFERENCE",
          title: "삭제된 장면",
          subtitle: `원래 이름: ${node.madi.originalLabel || node.text}`,
          description: null,
          badge: "연결 끊김",
          color: node.color ?? null,
          broken: true,
          referenceId: sceneId || null
        };
  }
  return {
    kind: "TEXT",
    title: node.text || "빈 메모",
    subtitle: "텍스트",
    description: null,
    badge: null,
    color: node.color ?? null,
    broken: false,
    referenceId: null
  };
}

export function selectionExists(
  document: MadiCanvasDocument,
  selection: MadiCanvasSelection | null
): boolean {
  if (!selection) {
    return false;
  }
  return selection.kind === "NODE"
    ? document.nodes.some((node) => node.id === selection.id)
    : document.edges.some((edge) => edge.id === selection.id);
}

export interface CanvasSessionHistory {
  readonly past: readonly MadiCanvasDocument[];
  readonly present: MadiCanvasDocument;
  readonly future: readonly MadiCanvasDocument[];
  readonly limit: number;
  readonly coalesceKey: string | null;
}

export function createCanvasSessionHistory(
  document: MadiCanvasDocument,
  limit = 100
): CanvasSessionHistory {
  return { past: [], present: document, future: [], limit, coalesceKey: null };
}

export function commitCanvasHistory(
  history: CanvasSessionHistory,
  document: MadiCanvasDocument,
  coalesceKey: string | null = null
): CanvasSessionHistory {
  if (history.present === document) {
    return history;
  }
  if (coalesceKey && history.coalesceKey === coalesceKey) {
    return { ...history, present: document, future: [], coalesceKey };
  }
  const past = [...history.past, history.present].slice(-history.limit);
  return { ...history, past, present: document, future: [], coalesceKey };
}

export function endCanvasHistoryCoalescing(
  history: CanvasSessionHistory
): CanvasSessionHistory {
  return history.coalesceKey ? { ...history, coalesceKey: null } : history;
}

export function undoCanvasHistory(history: CanvasSessionHistory): CanvasSessionHistory {
  const previous = history.past.at(-1);
  if (!previous) {
    return history;
  }
  return {
    ...history,
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, history.limit),
    coalesceKey: null
  };
}

export function redoCanvasHistory(history: CanvasSessionHistory): CanvasSessionHistory {
  const next = history.future[0];
  if (!next) {
    return history;
  }
  return {
    ...history,
    past: [...history.past, history.present].slice(-history.limit),
    present: next,
    future: history.future.slice(1),
    coalesceKey: null
  };
}
