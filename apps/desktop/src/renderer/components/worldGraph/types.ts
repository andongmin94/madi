import type {
  EntityGraphDetail,
  EntityGraphRelationDetail,
  EntityGraphRelationPerspective,
  EntityKind,
  EntitySceneContext,
  EntitySceneContextLink,
  EntityStatus,
  WorldGraphDepth as MadiWorldGraphDepth,
  WorldGraphDiagnostic,
  WorldGraphEdge,
  WorldGraphFilterState as MadiWorldGraphFilterState,
  WorldGraphMode as MadiWorldGraphMode,
  WorldGraphNode,
  WorldGraphPoint as MadiWorldGraphPoint,
  WorldGraphReadModel,
  WorldGraphRelationDirection as MadiWorldGraphRelationDirection,
  WorldGraphStats,
  WorldGraphTag,
  WorldGraphTagMode as MadiWorldGraphTagMode,
  WorldGraphUiState as MadiWorldGraphUiState,
  WorldGraphViewport as MadiWorldGraphViewport
} from "../../../shared/contracts";

export const WORLD_GRAPH_ENTITY_KINDS = [
  "CHARACTER",
  "LOCATION",
  "ORGANIZATION",
  "ITEM",
  "EVENT",
  "WORLD_RULE",
  "FORESHADOWING",
  "OTHER"
] as const;

export type WorldGraphEntityKind = EntityKind;

export const WORLD_GRAPH_ENTITY_STATUSES = [
  "ACTIVE",
  "DRAFT",
  "ARCHIVED"
] as const;

export type WorldGraphEntityStatus = EntityStatus;

export type WorldGraphTagView = WorldGraphTag;

/**
 * Renderer-facing structural view of the madi-owned DTO. Cytoscape types are
 * deliberately absent so this object can cross the preload boundary safely.
 */
export type WorldGraphNodeView = WorldGraphNode;
export type WorldGraphEdgeView = WorldGraphEdge;
export type WorldGraphStatsView = WorldGraphStats;
export type WorldGraphReadModelView = WorldGraphReadModel;
export type WorldGraphRelationPerspective = EntityGraphRelationPerspective;
export type WorldGraphDetailRelationView = EntityGraphRelationDetail;
export type WorldGraphEntityDetailView = EntityGraphDetail;
export type WorldGraphSceneLinkView = EntitySceneContextLink;
export type WorldGraphSceneContextView = EntitySceneContext;
export type WorldGraphDepth = MadiWorldGraphDepth;
export type WorldGraphMode = MadiWorldGraphMode;
export type WorldGraphTagMode = MadiWorldGraphTagMode;
export type WorldGraphRelationDirection = MadiWorldGraphRelationDirection;
export type WorldGraphFilterState = MadiWorldGraphFilterState;
export type WorldGraphPoint = MadiWorldGraphPoint;
export type WorldGraphViewport = MadiWorldGraphViewport;
export type WorldGraphUiState = MadiWorldGraphUiState;

export interface WorldGraphRenderDiagnostic {
  readonly code:
    | "CROSS_PROJECT_NODE"
    | "CROSS_PROJECT_EDGE"
    | "MISSING_ENDPOINT"
    | "SELF_RELATION"
    | "DUPLICATE_EDGE_ID"
    | "DUPLICATE_UNDIRECTED_EDGE";
  readonly subjectId: string;
  readonly message: string;
}

export interface FilteredWorldGraph {
  readonly projectId: string;
  readonly revision: number;
  readonly nodes: readonly WorldGraphNodeView[];
  readonly edges: readonly WorldGraphEdgeView[];
  /** Integrity findings emitted by the Rust read model. */
  readonly diagnostics: readonly WorldGraphDiagnostic[];
  /** Renderer boundary findings; kept separate from canonical diagnostics. */
  readonly renderDiagnostics: readonly WorldGraphRenderDiagnostic[];
}

export interface WorldGraphSelection {
  readonly kind: "NODE" | "EDGE";
  readonly id: string;
}

export const DEFAULT_WORLD_GRAPH_FILTERS: WorldGraphFilterState = {
  kinds: WORLD_GRAPH_ENTITY_KINDS,
  statuses: ["ACTIVE", "DRAFT"],
  tagIds: [],
  tagMode: "ANY",
  relationTypeIds: [],
  relationDirection: "ALL",
  showIsolated: true,
  showLabels: true
};

export const DEFAULT_WORLD_GRAPH_UI_STATE: WorldGraphUiState = {
  mode: "FULL",
  focusedEntityId: null,
  depth: 1,
  filters: DEFAULT_WORLD_GRAPH_FILTERS,
  layout: "cose",
  viewport: { zoom: 1, pan: { x: 0, y: 0 } },
  nodePositions: {},
  selectedEntityId: null
};
