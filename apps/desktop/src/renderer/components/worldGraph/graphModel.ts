import {
  DEFAULT_WORLD_GRAPH_FILTERS,
  WORLD_GRAPH_ENTITY_KINDS,
  WORLD_GRAPH_ENTITY_STATUSES,
  type FilteredWorldGraph,
  type WorldGraphDepth,
  type WorldGraphRenderDiagnostic,
  type WorldGraphEdgeView,
  type WorldGraphEntityKind,
  type WorldGraphEntityStatus,
  type WorldGraphFilterState,
  type WorldGraphNodeView,
  type WorldGraphReadModelView,
  type WorldGraphUiState
} from "./types";

export interface WorldGraphSearchResult {
  readonly node: WorldGraphNodeView;
  readonly matchedBy: "LABEL" | "ALIAS" | "TAG" | "SUMMARY";
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");
}

function hasSelectedTags(
  node: WorldGraphNodeView,
  selectedTagIds: ReadonlySet<string>,
  mode: WorldGraphFilterState["tagMode"]
): boolean {
  if (selectedTagIds.size === 0) {
    return true;
  }
  const nodeTags = new Set(node.tags.map((tag) => tag.id));
  return mode === "ALL"
    ? [...selectedTagIds].every((tagId) => nodeTags.has(tagId))
    : [...selectedTagIds].some((tagId) => nodeTags.has(tagId));
}

function sanitizeReadModel(model: WorldGraphReadModelView): FilteredWorldGraph {
  const renderDiagnostics: WorldGraphRenderDiagnostic[] = [];
  const nodes = model.nodes.filter((node) => {
    if (node.projectId === model.projectId) {
      return true;
    }
    renderDiagnostics.push({
      code: "CROSS_PROJECT_NODE",
      subjectId: node.id,
      message: `다른 작품의 설정 ${node.id}을 그래프에서 제외했습니다.`
    });
    return false;
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const seenEdgeIds = new Set<string>();
  const seenUndirectedKeys = new Set<string>();
  const edges = model.edges.filter((edge) => {
    if (edge.projectId !== model.projectId) {
      renderDiagnostics.push({
        code: "CROSS_PROJECT_EDGE",
        subjectId: edge.id,
        message: `다른 작품의 관계 ${edge.id}을 그래프에서 제외했습니다.`
      });
      return false;
    }
    if (seenEdgeIds.has(edge.id)) {
      renderDiagnostics.push({
        code: "DUPLICATE_EDGE_ID",
        subjectId: edge.id,
        message: `중복된 관계 ID ${edge.id}을 한 번만 표시합니다.`
      });
      return false;
    }
    seenEdgeIds.add(edge.id);
    if (edge.sourceEntityId === edge.targetEntityId) {
      renderDiagnostics.push({
        code: "SELF_RELATION",
        subjectId: edge.id,
        message: `손상된 자기 관계 ${edge.id}을 렌더링하지 않았습니다.`
      });
      return false;
    }
    if (
      !nodeIds.has(edge.sourceEntityId) ||
      !nodeIds.has(edge.targetEntityId)
    ) {
      renderDiagnostics.push({
        code: "MISSING_ENDPOINT",
        subjectId: edge.id,
        message: `끝점이 없는 관계 ${edge.id}을 렌더링하지 않았습니다.`
      });
      return false;
    }
    if (!edge.directed) {
      const endpoints = [edge.sourceEntityId, edge.targetEntityId].sort();
      const key = `${edge.relationTypeId}\u0000${endpoints[0]}\u0000${endpoints[1]}`;
      if (seenUndirectedKeys.has(key)) {
        renderDiagnostics.push({
          code: "DUPLICATE_UNDIRECTED_EDGE",
          subjectId: edge.id,
          message: `역방향으로 중복된 무방향 관계 ${edge.id}을 한 번만 표시합니다.`
        });
        return false;
      }
      seenUndirectedKeys.add(key);
    }
    return true;
  });
  return {
    projectId: model.projectId,
    revision: model.revision,
    nodes,
    edges,
    diagnostics: model.diagnostics,
    renderDiagnostics
  };
}

export function filterWorldGraph(
  model: WorldGraphReadModelView,
  filters: WorldGraphFilterState
): FilteredWorldGraph {
  const safe = sanitizeReadModel(model);
  const kinds = new Set(filters.kinds);
  const statuses = new Set(filters.statuses);
  const tagIds = new Set(filters.tagIds);
  const relationTypeIds = new Set(filters.relationTypeIds);
  let nodes = safe.nodes.filter(
    (node) =>
      kinds.has(node.kind) &&
      statuses.has(node.status) &&
      hasSelectedTags(node, tagIds, filters.tagMode)
  );
  let nodeIds = new Set(nodes.map((node) => node.id));
  let edges = safe.edges.filter(
    (edge) =>
      nodeIds.has(edge.sourceEntityId) &&
      nodeIds.has(edge.targetEntityId) &&
      (relationTypeIds.size === 0 ||
        relationTypeIds.has(edge.relationTypeId)) &&
      (filters.relationDirection === "ALL" ||
        (filters.relationDirection === "DIRECTED" && edge.directed) ||
        (filters.relationDirection === "UNDIRECTED" && !edge.directed))
  );

  if (!filters.showIsolated) {
    const connectedNodeIds = new Set<string>();
    for (const edge of edges) {
      connectedNodeIds.add(edge.sourceEntityId);
      connectedNodeIds.add(edge.targetEntityId);
    }
    nodes = nodes.filter((node) => connectedNodeIds.has(node.id));
    nodeIds = new Set(nodes.map((node) => node.id));
    edges = edges.filter(
      (edge) =>
        nodeIds.has(edge.sourceEntityId) && nodeIds.has(edge.targetEntityId)
    );
  }

  return { ...safe, nodes, edges };
}

export function collectNeighborhoodNodeIds(
  nodes: readonly WorldGraphNodeView[],
  edges: readonly WorldGraphEdgeView[],
  centerEntityId: string,
  depth: WorldGraphDepth
): ReadonlySet<string> {
  const validNodeIds = new Set(nodes.map((node) => node.id));
  if (!validNodeIds.has(centerEntityId)) {
    return new Set();
  }
  const adjacency = new Map<string, Set<string>>();
  for (const nodeId of validNodeIds) {
    adjacency.set(nodeId, new Set());
  }
  for (const edge of edges) {
    if (
      !validNodeIds.has(edge.sourceEntityId) ||
      !validNodeIds.has(edge.targetEntityId)
    ) {
      continue;
    }
    // Navigation intentionally treats directed and undirected relations as
    // bidirectional adjacency. Direction remains visual and semantic metadata.
    adjacency.get(edge.sourceEntityId)?.add(edge.targetEntityId);
    adjacency.get(edge.targetEntityId)?.add(edge.sourceEntityId);
  }

  const visited = new Set([centerEntityId]);
  let frontier = [centerEntityId];
  for (let hop = 0; hop < depth && frontier.length > 0; hop += 1) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      const neighbors = [...(adjacency.get(nodeId) ?? [])].sort((left, right) =>
        left.localeCompare(right, "en-US")
      );
      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          next.push(neighborId);
        }
      }
    }
    frontier = next;
  }
  return visited;
}

export function focusWorldGraph(
  graph: FilteredWorldGraph,
  centerEntityId: string,
  depth: WorldGraphDepth
): FilteredWorldGraph {
  const visibleNodeIds = collectNeighborhoodNodeIds(
    graph.nodes,
    graph.edges,
    centerEntityId,
    depth
  );
  const nodes = graph.nodes.filter((node) => visibleNodeIds.has(node.id));
  const edges = graph.edges.filter(
    (edge) =>
      visibleNodeIds.has(edge.sourceEntityId) &&
      visibleNodeIds.has(edge.targetEntityId)
  );
  return { ...graph, nodes, edges };
}

export function searchWorldGraphNodes(
  nodes: readonly WorldGraphNodeView[],
  query: string,
  limit = 20
): readonly WorldGraphSearchResult[] {
  const needle = normalizeSearchText(query);
  if (!needle) {
    return [];
  }
  return nodes
    .flatMap((node): WorldGraphSearchResult[] => {
      if (normalizeSearchText(node.label).includes(needle)) {
        return [{ node, matchedBy: "LABEL" }];
      }
      if (node.aliases.some((alias) => normalizeSearchText(alias).includes(needle))) {
        return [{ node, matchedBy: "ALIAS" }];
      }
      if (node.tags.some((tag) => normalizeSearchText(tag.name).includes(needle))) {
        return [{ node, matchedBy: "TAG" }];
      }
      if (normalizeSearchText(node.summary ?? "").includes(needle)) {
        return [{ node, matchedBy: "SUMMARY" }];
      }
      return [];
    })
    .sort((left, right) => {
      const priority = { LABEL: 0, ALIAS: 1, TAG: 2, SUMMARY: 3 } as const;
      return (
        priority[left.matchedBy] - priority[right.matchedBy] ||
        left.node.label.localeCompare(right.node.label, "ko-KR")
      );
    })
    .slice(0, limit);
}

export function explainHiddenNode(
  node: WorldGraphNodeView,
  filters: WorldGraphFilterState
): string | null {
  if (!filters.kinds.includes(node.kind)) {
    return "설정 종류 필터에서 숨겨져 있습니다.";
  }
  if (!filters.statuses.includes(node.status)) {
    return "상태 필터에서 숨겨져 있습니다.";
  }
  if (
    !hasSelectedTags(node, new Set(filters.tagIds), filters.tagMode)
  ) {
    return "태그 필터에서 숨겨져 있습니다.";
  }
  if (
    !filters.showIsolated &&
    node.outgoingRelationCount +
      node.incomingRelationCount +
      node.undirectedRelationCount ===
      0
  ) {
    return "고립 설정 숨김 필터가 적용되어 있습니다.";
  }
  return null;
}

export function revealNodeInFilters(
  node: WorldGraphNodeView,
  filters: WorldGraphFilterState
): WorldGraphFilterState {
  const kinds = filters.kinds.includes(node.kind)
    ? filters.kinds
    : [...filters.kinds, node.kind];
  const statuses = filters.statuses.includes(node.status)
    ? filters.statuses
    : [...filters.statuses, node.status];
  const tagsMatch = hasSelectedTags(
    node,
    new Set(filters.tagIds),
    filters.tagMode
  );
  return {
    ...filters,
    kinds,
    statuses,
    tagIds: tagsMatch ? filters.tagIds : [],
    showIsolated: true
  };
}

function enumArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: readonly T[]
): readonly T[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const allowedSet = new Set<string>(allowed);
  return [...new Set(value.filter((item): item is T => typeof item === "string" && allowedSet.has(item)))];
}

/** Accepts persisted JSON defensively so stale UI state cannot break a project. */
export function normalizeWorldGraphUiState(
  value: unknown
): WorldGraphUiState {
  if (!value || typeof value !== "object") {
    return {
      mode: "FULL",
      focusedEntityId: null,
      depth: 1,
      filters: DEFAULT_WORLD_GRAPH_FILTERS,
      layout: "cose",
      viewport: { zoom: 1, pan: { x: 0, y: 0 } },
      nodePositions: {},
      selectedEntityId: null
    };
  }
  const candidate = value as Partial<WorldGraphUiState>;
  const rawFilters =
    candidate.filters && typeof candidate.filters === "object"
      ? candidate.filters
      : DEFAULT_WORLD_GRAPH_FILTERS;
  const filters: WorldGraphFilterState = {
    kinds: enumArray(
      rawFilters.kinds,
      WORLD_GRAPH_ENTITY_KINDS,
      DEFAULT_WORLD_GRAPH_FILTERS.kinds
    ),
    statuses: enumArray(
      rawFilters.statuses,
      WORLD_GRAPH_ENTITY_STATUSES,
      DEFAULT_WORLD_GRAPH_FILTERS.statuses
    ),
    tagIds: Array.isArray(rawFilters.tagIds)
      ? rawFilters.tagIds.filter((id): id is string => typeof id === "string")
      : [],
    tagMode: rawFilters.tagMode === "ALL" ? "ALL" : "ANY",
    relationTypeIds: Array.isArray(rawFilters.relationTypeIds)
      ? rawFilters.relationTypeIds.filter(
          (id): id is string => typeof id === "string"
        )
      : [],
    relationDirection:
      rawFilters.relationDirection === "DIRECTED" ||
      rawFilters.relationDirection === "UNDIRECTED"
        ? rawFilters.relationDirection
        : "ALL",
    showIsolated: rawFilters.showIsolated !== false,
    showLabels: rawFilters.showLabels !== false
  };
  const rawPositions = candidate.nodePositions;
  const nodePositions: Record<string, { x: number; y: number }> = {};
  if (rawPositions && typeof rawPositions === "object") {
    for (const [id, point] of Object.entries(rawPositions)) {
      if (
        point &&
        typeof point === "object" &&
        Number.isFinite((point as { x?: unknown }).x) &&
        Number.isFinite((point as { y?: unknown }).y)
      ) {
        nodePositions[id] = {
          x: (point as { x: number }).x,
          y: (point as { y: number }).y
        };
      }
    }
  }
  const viewport = candidate.viewport;
  const safeViewport =
    viewport &&
    Number.isFinite(viewport.zoom) &&
    viewport.zoom > 0 &&
    Number.isFinite(viewport.pan?.x) &&
    Number.isFinite(viewport.pan?.y)
      ? viewport
      : { zoom: 1, pan: { x: 0, y: 0 } };
  return {
    mode: candidate.mode === "FOCUSED" ? "FOCUSED" : "FULL",
    focusedEntityId:
      typeof candidate.focusedEntityId === "string"
        ? candidate.focusedEntityId
        : null,
    depth: candidate.depth === 2 || candidate.depth === 3 ? candidate.depth : 1,
    filters,
    layout: candidate.layout === "preset" ? "preset" : "cose",
    viewport: safeViewport,
    nodePositions,
    selectedEntityId:
      typeof candidate.selectedEntityId === "string"
        ? candidate.selectedEntityId
        : null
  };
}

/** Stable comparison key used to ignore normalized parent echoes. */
export function worldGraphUiStateFingerprint(value: unknown): string {
  const normalized = normalizeWorldGraphUiState(value);
  const sortedPositions = Object.fromEntries(
    Object.entries(normalized.nodePositions).sort(([left], [right]) =>
      left.localeCompare(right, "en-US")
    )
  );
  return JSON.stringify({ ...normalized, nodePositions: sortedPositions });
}

export function kindLabel(kind: WorldGraphEntityKind): string {
  const labels: Readonly<Record<WorldGraphEntityKind, string>> = {
    CHARACTER: "등장인물",
    LOCATION: "장소",
    ORGANIZATION: "조직",
    ITEM: "물건",
    EVENT: "사건",
    WORLD_RULE: "세계 규칙",
    FORESHADOWING: "복선",
    OTHER: "기타"
  };
  return labels[kind];
}

export function statusLabel(status: WorldGraphEntityStatus): string {
  const labels: Readonly<Record<WorldGraphEntityStatus, string>> = {
    ACTIVE: "활성",
    DRAFT: "초안",
    ARCHIVED: "보관됨"
  };
  return labels[status];
}
