import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent
} from "react";
import { WorldGraphCanvas } from "./WorldGraphCanvas";
import {
  explainHiddenNode,
  filterWorldGraph,
  focusWorldGraph,
  kindLabel,
  normalizeWorldGraphUiState,
  revealNodeInFilters,
  searchWorldGraphNodes,
  statusLabel,
  worldGraphUiStateFingerprint
} from "./graphModel";
import {
  DEFAULT_WORLD_GRAPH_UI_STATE,
  WORLD_GRAPH_ENTITY_KINDS,
  WORLD_GRAPH_ENTITY_STATUSES,
  type FilteredWorldGraph,
  type WorldGraphDetailRelationView,
  type WorldGraphEdgeView,
  type WorldGraphEntityDetailView,
  type WorldGraphEntityKind,
  type WorldGraphEntityStatus,
  type WorldGraphFilterState,
  type WorldGraphNodeView,
  type WorldGraphPoint,
  type WorldGraphReadModelView,
  type WorldGraphSceneContextView,
  type WorldGraphSelection,
  type WorldGraphUiState,
  type WorldGraphViewport
} from "./types";
import {
  loadWorldGraphDetailBundle,
  WorldGraphDetailCache,
  type WorldGraphPerformanceSample
} from "./worldGraphInteraction";
import "./worldGraph.css";

export type { WorldGraphPerformanceSample } from "./worldGraphInteraction";

export interface WorldGraphWorkspaceProps {
  readonly model: WorldGraphReadModelView | null;
  readonly initialUiState?: WorldGraphUiState | null;
  readonly busy?: boolean;
  readonly errorMessage?: string | null;
  readonly onUiStateChange?: (state: WorldGraphUiState) => void;
  readonly onLoadEntityDetail?: (
    entityId: string
  ) => WorldGraphEntityDetailView | Promise<WorldGraphEntityDetailView>;
  readonly onLoadEntitySceneContext?: (
    entityId: string
  ) => WorldGraphSceneContextView | Promise<WorldGraphSceneContextView>;
  /** Uses existing mention discovery lazily; the graph never promotes a match. */
  readonly onLoadMentionCount?: (
    entityId: string
  ) => number | Promise<number>;
  readonly onOpenEntity: (entityId: string) => void | Promise<void>;
  readonly onOpenRelation: (
    relationId: string,
    sourceEntityId: string
  ) => void | Promise<void>;
  readonly onOpenScene: (sceneId: string) => void | Promise<void>;
  readonly onAddEntityToCanvas?: (
    entityId: string
  ) => void | Promise<void>;
  readonly onSelectedEntityChange?: (entityId: string | null) => void;
  readonly onPerformanceSample?: (
    sample: WorldGraphPerformanceSample
  ) => void;
}

const SEARCH_MATCH_LABELS = {
  LABEL: "이름",
  ALIAS: "별칭",
  TAG: "태그",
  SUMMARY: "요약"
} as const;

function toggleValue<T extends string>(
  values: readonly T[],
  value: T,
  checked: boolean
): readonly T[] {
  return checked
    ? [...new Set([...values, value])]
    : values.filter((candidate) => candidate !== value);
}

function counterpartLabel(
  nodes: readonly WorldGraphNodeView[],
  relation: WorldGraphDetailRelationView
): string {
  return (
    nodes.find((node) => node.id === relation.counterpartEntityId)?.label ??
    "삭제된 설정"
  );
}

function derivedDetail(
  model: WorldGraphReadModelView,
  entity: WorldGraphNodeView
): WorldGraphEntityDetailView {
  const detail = (
    edge: WorldGraphEdgeView,
    counterpartEntityId: string,
    perspective: WorldGraphDetailRelationView["perspective"],
    displayLabel: string
  ): WorldGraphDetailRelationView => ({
    edge,
    counterpartEntityId,
    perspective,
    displayLabel
  });
  const related = model.edges.filter(
    (edge) =>
      edge.sourceEntityId === entity.id || edge.targetEntityId === entity.id
  );
  return {
    projectId: model.projectId,
    revision: model.revision,
    entity,
    outgoingRelations: related
      .filter((edge) => edge.directed && edge.sourceEntityId === entity.id)
      .map((edge) =>
        detail(edge, edge.targetEntityId, "OUTGOING", edge.forwardLabel)
      ),
    incomingRelations: related
      .filter((edge) => edge.directed && edge.targetEntityId === entity.id)
      .map((edge) =>
        detail(
          edge,
          edge.sourceEntityId,
          "INCOMING",
          edge.inverseLabel ?? edge.forwardLabel
        )
      ),
    undirectedRelations: related
      .filter((edge) => !edge.directed)
      .map((edge) =>
        detail(
          edge,
          edge.sourceEntityId === entity.id
            ? edge.targetEntityId
            : edge.sourceEntityId,
          "UNDIRECTED",
          edge.forwardLabel
        )
      )
  };
}

export function WorldGraphWorkspace({
  model,
  initialUiState = null,
  busy = false,
  errorMessage = null,
  onUiStateChange,
  onLoadEntityDetail,
  onLoadEntitySceneContext,
  onLoadMentionCount,
  onOpenEntity,
  onOpenRelation,
  onOpenScene,
  onAddEntityToCanvas,
  onSelectedEntityChange,
  onPerformanceSample
}: WorldGraphWorkspaceProps) {
  const [uiState, setUiState] = useState<WorldGraphUiState>(() =>
    normalizeWorldGraphUiState(initialUiState)
  );
  const [selection, setSelection] = useState<WorldGraphSelection | null>(() =>
    initialUiState?.selectedEntityId
      ? { kind: "NODE", id: initialUiState.selectedEntityId }
      : null
  );
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [autoLayoutRequest, setAutoLayoutRequest] = useState(0);
  const [centerRequest, setCenterRequest] = useState(0);
  const [detail, setDetail] = useState<WorldGraphEntityDetailView | null>(null);
  const [sceneContext, setSceneContext] =
    useState<WorldGraphSceneContextView | null>(null);
  const [mentionResult, setMentionResult] = useState<{
    readonly key: string;
    readonly count: number;
  } | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState("");
  const appliedProjectRef = useRef<string | null>(null);
  const appliedExternalFingerprintRef = useRef<string | null>(null);
  const lastEmittedFingerprintRef = useRef<string | null>(null);
  const detailRequestRef = useRef(0);
  const detailErrorKeyRef = useRef<string | null>(null);
  const detailCacheRef = useRef(new WorldGraphDetailCache());
  const selectionStartedAtRef = useRef<number | null>(null);
  const centerStartedAtRef = useRef<number | null>(null);
  const detailCommitStartedAtRef = useRef<{
    readonly commitStartedAt: number;
    readonly requestStartedAt: number;
  } | null>(null);
  const externalCallbacksRef = useRef({
    onUiStateChange,
    onLoadEntityDetail,
    onLoadEntitySceneContext,
    onLoadMentionCount,
    onSelectedEntityChange,
    onPerformanceSample
  });
  externalCallbacksRef.current = {
    onUiStateChange,
    onLoadEntityDetail,
    onLoadEntitySceneContext,
    onLoadMentionCount,
    onSelectedEntityChange,
    onPerformanceSample
  };
  const initialStateFingerprint = initialUiState
    ? worldGraphUiStateFingerprint(initialUiState)
    : null;

  useEffect(() => {
    const projectId = model?.projectId ?? null;
    const projectChanged = projectId !== appliedProjectRef.current;
    const newExternalState =
      initialStateFingerprint !== null &&
      initialStateFingerprint !== appliedExternalFingerprintRef.current &&
      initialStateFingerprint !== lastEmittedFingerprintRef.current;
    if (!projectChanged && !newExternalState) {
      return;
    }
    appliedProjectRef.current = projectId;
    appliedExternalFingerprintRef.current = initialStateFingerprint;
    const restored = normalizeWorldGraphUiState(initialUiState);
    setUiState(restored);
    setSelection(
      restored.selectedEntityId
        ? { kind: "NODE", id: restored.selectedEntityId }
        : null
    );
    setQuery("");
    setNotice("");
  }, [initialStateFingerprint, initialUiState, model?.projectId]);

  useEffect(() => {
    lastEmittedFingerprintRef.current = worldGraphUiStateFingerprint(uiState);
    externalCallbacksRef.current.onUiStateChange?.(uiState);
  }, [uiState]);

  useEffect(() => {
    if (!model) {
      return;
    }
    const validIds = new Set(model.nodes.map((node) => node.id));
    const validTagIds = new Set(
      model.nodes.flatMap((node) => node.tags.map((tag) => tag.id))
    );
    const validRelationTypeIds = new Set(
      model.stats.relationTypeCounts.map((item) => item.relationTypeId)
    );
    setUiState((current) => {
      const nodePositions = Object.fromEntries(
        Object.entries(current.nodePositions).filter(([id]) => validIds.has(id))
      );
      const focusedEntityId =
        current.focusedEntityId && validIds.has(current.focusedEntityId)
          ? current.focusedEntityId
          : null;
      const selectedEntityId =
        current.selectedEntityId && validIds.has(current.selectedEntityId)
          ? current.selectedEntityId
          : null;
      const tagIds = current.filters.tagIds.filter((id) => validTagIds.has(id));
      const relationTypeIds = current.filters.relationTypeIds.filter((id) =>
        validRelationTypeIds.has(id)
      );
      const filtersChanged =
        tagIds.length !== current.filters.tagIds.length ||
        relationTypeIds.length !== current.filters.relationTypeIds.length;
      if (
        Object.keys(nodePositions).length ===
          Object.keys(current.nodePositions).length &&
        focusedEntityId === current.focusedEntityId &&
        selectedEntityId === current.selectedEntityId &&
        !filtersChanged
      ) {
        return current;
      }
      return {
        ...current,
        mode: focusedEntityId ? current.mode : "FULL",
        focusedEntityId,
        selectedEntityId,
        filters: filtersChanged
          ? { ...current.filters, tagIds, relationTypeIds }
          : current.filters,
        nodePositions
      };
    });
    const validEdgeIds = new Set(model.edges.map((edge) => edge.id));
    if (
      selection &&
      ((selection.kind === "NODE" && !validIds.has(selection.id)) ||
        (selection.kind === "EDGE" && !validEdgeIds.has(selection.id)))
    ) {
      setSelection(null);
    }
  }, [model, selection]);

  useEffect(() => {
    if (model) {
      detailCacheRef.current.activate(model.projectId, model.revision);
    }
  }, [model?.projectId, model?.revision]);

  const graphComputation = useMemo(() => {
    if (!model) {
      return { graph: null, filterMs: 0, bfsMs: 0 };
    }
    const filterStartedAt = performance.now();
    const filtered = filterWorldGraph(model, uiState.filters);
    const filterMs = performance.now() - filterStartedAt;
    if (uiState.mode === "FOCUSED" && uiState.focusedEntityId) {
      const bfsStartedAt = performance.now();
      const graph = focusWorldGraph(
        filtered,
        uiState.focusedEntityId,
        uiState.depth
      );
      return {
        graph,
        filterMs,
        bfsMs: performance.now() - bfsStartedAt
      };
    }
    return { graph: filtered, filterMs, bfsMs: 0 };
  }, [model, uiState.depth, uiState.filters, uiState.focusedEntityId, uiState.mode]);
  const filteredGraph = graphComputation.graph;

  useEffect(() => {
    if (model) {
      externalCallbacksRef.current.onPerformanceSample?.({
        filterMs: graphComputation.filterMs,
        bfsMs: graphComputation.bfsMs
      });
    }
  }, [graphComputation, model]);

  useEffect(() => {
    if (!model || !externalCallbacksRef.current.onPerformanceSample) {
      return;
    }
    const startedAt = performance.now();
    const frame = window.requestAnimationFrame(() => {
      externalCallbacksRef.current.onPerformanceSample?.({
        displayMs: performance.now() - startedAt
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [model?.projectId, model?.revision]);

  const searchResults = useMemo(
    () => searchWorldGraphNodes(model?.nodes ?? [], query),
    [model?.nodes, query]
  );
  const allTags = useMemo(() => {
    const tags = new Map<string, { id: string; name: string }>();
    for (const node of model?.nodes ?? []) {
      for (const tag of node.tags) {
        tags.set(tag.id, { id: tag.id, name: tag.name });
      }
    }
    return [...tags.values()].sort((left, right) =>
      left.name.localeCompare(right.name, "ko-KR")
    );
  }, [model?.nodes]);
  const relationTypes = model?.stats.relationTypeCounts ?? [];

  const selectedNode =
    selection?.kind === "NODE"
      ? model?.nodes.find((node) => node.id === selection.id) ?? null
      : null;
  const selectedEdge =
    selection?.kind === "EDGE"
      ? model?.edges.find((edge) => edge.id === selection.id) ?? null
      : null;

  const visibleDetail =
    selectedNode &&
    model &&
    detail?.projectId === model.projectId &&
    detail.revision === model.revision &&
    detail.entity.id === selectedNode.id
      ? detail
      : null;
  const visibleSceneContext =
    selectedNode &&
    model &&
    sceneContext?.projectId === model.projectId &&
    sceneContext.revision === model.revision &&
    sceneContext.entityId === selectedNode.id
      ? sceneContext
      : null;
  const selectedDetailKey =
    selectedNode && model
      ? JSON.stringify([model.projectId, model.revision, selectedNode.id])
      : null;
  const visibleMentionCount =
    visibleDetail &&
    visibleSceneContext &&
    mentionResult?.key === selectedDetailKey
      ? mentionResult.count
      : null;
  const visibleDetailError =
    selectedDetailKey === detailErrorKeyRef.current ? detailError : "";

  useLayoutEffect(() => {
    const startedAt = selectionStartedAtRef.current;
    if (startedAt === null || !selectedNode) {
      return;
    }
    const durationMs = performance.now() - startedAt;
    selectionStartedAtRef.current = null;
    externalCallbacksRef.current.onPerformanceSample?.({
      reactSelectionCommitMs: durationMs,
      detailShellRenderMs: durationMs
    });
  }, [selectedNode, selection]);

  useLayoutEffect(() => {
    const pending = detailCommitStartedAtRef.current;
    if (
      !pending ||
      !visibleDetail ||
      !visibleSceneContext ||
      visibleMentionCount === null
    ) {
      return;
    }
    detailCommitStartedAtRef.current = null;
    const now = performance.now();
    externalCallbacksRef.current.onPerformanceSample?.({
      reactDetailCommitMs: now - pending.commitStartedAt,
      fullLazyDetailMs: now - pending.requestStartedAt
    });
  }, [visibleDetail, visibleMentionCount, visibleSceneContext]);

  useEffect(() => {
    const requestId = ++detailRequestRef.current;
    detailErrorKeyRef.current = null;
    setDetailError("");
    setSceneContext(null);
    setMentionResult(null);
    if (!selectedNode || !model) {
      setDetail(null);
      setDetailBusy(false);
      return;
    }
    const identity = {
      projectId: model.projectId,
      projectRevision: model.revision,
      entityId: selectedNode.id
    };
    const cached = detailCacheRef.current.get(identity);
    if (cached) {
      setDetail(cached.detail);
      setSceneContext(cached.sceneContext);
      setMentionResult({
        key: JSON.stringify([
          identity.projectId,
          identity.projectRevision,
          identity.entityId
        ]),
        count: cached.mentionCount
      });
      setDetailBusy(false);
      externalCallbacksRef.current.onPerformanceSample?.({ detailCacheHit: 1 });
      return;
    }
    setDetail(null);
    setDetailBusy(true);
    externalCallbacksRef.current.onPerformanceSample?.({ detailCacheHit: 0 });
    const requestStartedAt = performance.now();
    const detailLoader = externalCallbacksRef.current.onLoadEntityDetail;
    const sceneLoader = externalCallbacksRef.current.onLoadEntitySceneContext;
    const mentionLoader = externalCallbacksRef.current.onLoadMentionCount;
    void loadWorldGraphDetailBundle(identity, {
      detail: () =>
        detailLoader
          ? detailLoader(selectedNode.id)
          : derivedDetail(model, selectedNode),
      sceneContext: () =>
        sceneLoader
          ? sceneLoader(selectedNode.id)
          : {
              projectId: model.projectId,
              revision: model.revision,
              entityId: selectedNode.id,
              links: []
            },
      mentionCount: () => (mentionLoader ? mentionLoader(selectedNode.id) : 0)
    })
      .then(({ bundle, timing }) => {
        if (requestId !== detailRequestRef.current) {
          return;
        }
        detailCacheRef.current.set(identity, bundle);
        detailCommitStartedAtRef.current = {
          commitStartedAt: performance.now(),
          requestStartedAt
        };
        externalCallbacksRef.current.onPerformanceSample?.(timing);
        setDetail(bundle.detail);
        setSceneContext(bundle.sceneContext);
        setMentionResult({
          key: JSON.stringify([
            identity.projectId,
            identity.projectRevision,
            identity.entityId
          ]),
          count: bundle.mentionCount
        });
      })
      .catch((error: unknown) => {
        if (requestId === detailRequestRef.current) {
          detailErrorKeyRef.current = JSON.stringify([
            identity.projectId,
            identity.projectRevision,
            identity.entityId
          ]);
          setDetailError(
            error instanceof Error
              ? error.message
              : "설정의 그래프 상세정보를 불러오지 못했습니다."
          );
        }
      })
      .finally(() => {
        if (requestId === detailRequestRef.current) {
          setDetailBusy(false);
        }
      });
  }, [model, selectedNode]);

  const updateFilters = (
    update: (filters: WorldGraphFilterState) => WorldGraphFilterState
  ) => {
    setUiState((current) => ({
      ...current,
      filters: update(current.filters)
    }));
  };

  const select = (nextSelection: WorldGraphSelection | null) => {
    selectionStartedAtRef.current =
      nextSelection?.kind === "NODE" ? performance.now() : null;
    detailErrorKeyRef.current = null;
    setDetailError("");
    setSelection(nextSelection);
    const entityId = nextSelection?.kind === "NODE" ? nextSelection.id : null;
    setUiState((current) => ({
      ...current,
      selectedEntityId: entityId ?? current.selectedEntityId
    }));
    if (nextSelection?.kind === "NODE" || nextSelection === null) {
      externalCallbacksRef.current.onSelectedEntityChange?.(entityId);
    }
  };

  const centerNode = (
    node: WorldGraphNodeView,
    focusMode: boolean,
    source: "SEARCH" | "NAVIGATION" = "NAVIGATION"
  ) => {
    const focusStartedAt = performance.now();
    selectionStartedAtRef.current = focusStartedAt;
    centerStartedAtRef.current = focusStartedAt;
    detailErrorKeyRef.current = null;
    setDetailError("");
    const hiddenReason =
      explainHiddenNode(node, uiState.filters) ??
      (filteredGraph && !filteredGraph.nodes.some((item) => item.id === node.id)
        ? "현재 중심 범위 또는 관계 필터에서 숨겨져 있습니다."
        : null);
    if (hiddenReason) {
      setNotice(`${hiddenReason} 해당 설정을 표시하도록 필요한 필터만 조정했습니다.`);
    } else {
      setNotice("");
    }
    setUiState((current) => {
      const useAsFocusedEntity = focusMode || current.mode === "FOCUSED";
      return {
        ...current,
        mode: focusMode ? "FOCUSED" : current.mode,
        focusedEntityId: useAsFocusedEntity
          ? node.id
          : current.focusedEntityId,
        filters: explainHiddenNode(node, current.filters)
          ? revealNodeInFilters(node, current.filters)
          : current.filters,
        selectedEntityId: node.id
      };
    });
    setSelection({ kind: "NODE", id: node.id });
    externalCallbacksRef.current.onSelectedEntityChange?.(node.id);
    setCenterRequest((value) => value + 1);
    setQuery("");
    if (source === "SEARCH") {
      externalCallbacksRef.current.onPerformanceSample?.({
        searchClickHandlerMs: performance.now() - focusStartedAt
      });
    }
  };

  const changeMultiFilter = <T extends string>(
    event: ChangeEvent<HTMLInputElement>,
    key: "kinds" | "statuses" | "tagIds" | "relationTypeIds"
  ) => {
    updateFilters((filters) => ({
      ...filters,
      [key]: toggleValue(
        filters[key] as readonly T[],
        event.target.value as T,
        event.target.checked
      )
    }));
  };

  if (!model) {
    return (
      <section className="world-graph world-graph__empty" aria-label="세계관 그래프">
        <h2>{busy ? "세계관 그래프를 불러오는 중입니다." : "세계관 그래프를 열 수 없습니다."}</h2>
        {errorMessage && <p role="alert">{errorMessage}</p>}
      </section>
    );
  }

  // Numeric-only evidence for real-window drag tests. Keep the Cytoscape
  // instance private to WorldGraphCanvas; these values are the saved UI model.
  const selectedModelPosition =
    selection?.kind === "NODE" ? uiState.nodePositions[selection.id] : undefined;

  return (
    <section
      className="world-graph"
      aria-label="세계관 그래프"
      data-testid="world-graph-workspace"
      data-project-id={model.projectId}
      data-revision={model.revision}
      data-mode={uiState.mode}
      data-depth={uiState.depth}
      data-focused-entity-id={uiState.focusedEntityId ?? ""}
      data-selected-kind={selection?.kind ?? ""}
      data-selected-id={selection?.id ?? ""}
      data-layout={uiState.layout}
      data-position-count={Object.keys(uiState.nodePositions).length}
      data-selected-position-x={selectedModelPosition?.x ?? ""}
      data-selected-position-y={selectedModelPosition?.y ?? ""}
      data-total-node-count={model.nodes.length}
      data-total-edge-count={model.edges.length}
      data-viewport-zoom={uiState.viewport.zoom}
      data-viewport-pan-x={uiState.viewport.pan.x}
      data-viewport-pan-y={uiState.viewport.pan.y}
      data-visible-node-count={filteredGraph?.nodes.length ?? 0}
      data-visible-edge-count={filteredGraph?.edges.length ?? 0}
      data-center-request={centerRequest}
      data-auto-layout-request={autoLayoutRequest}
      aria-busy={busy || detailBusy}
    >
      <header className="world-graph__toolbar">
        <label className="world-graph__search">
          설정 검색
          <input
            type="search"
            aria-label="세계관 설정 검색"
            data-testid="world-graph-search"
            value={query}
            placeholder="이름, 별칭, 태그, 요약"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query.trim() && (
            <ul
              className="world-graph__search-results"
              aria-label="세계관 설정 검색 결과"
            >
              {searchResults.length === 0 ? (
                <li>검색 결과가 없습니다.</li>
              ) : (
                searchResults.map((result) => (
                  <li key={result.node.id}>
                    <button
                      type="button"
                      data-entity-id={result.node.id}
                      onClick={() => centerNode(result.node, false, "SEARCH")}
                    >
                      <span>
                        <strong>{result.node.label}</strong> · {kindLabel(result.node.kind)}
                      </span>
                      <small>{SEARCH_MATCH_LABELS[result.matchedBy]} 일치</small>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </label>

        <div role="group" aria-label="그래프 보기 모드">
          <button
            type="button"
            aria-pressed={uiState.mode === "FULL"}
            onClick={() =>
              setUiState((current) => ({ ...current, mode: "FULL" }))
            }
          >
            전체 그래프
          </button>
          <button
            type="button"
            aria-pressed={uiState.mode === "FOCUSED"}
            disabled={!uiState.focusedEntityId && !selectedNode}
            onClick={() => {
              const entityId = uiState.focusedEntityId ?? selectedNode?.id ?? null;
              if (entityId) {
                centerStartedAtRef.current = performance.now();
                setUiState((current) => ({
                  ...current,
                  mode: "FOCUSED",
                  focusedEntityId: entityId
                }));
                setCenterRequest((value) => value + 1);
              }
            }}
          >
            중심 그래프
          </button>
        </div>

        <label>
          중심 설정
          <select
            aria-label="중심 설정"
            value={uiState.focusedEntityId ?? ""}
            onChange={(event) => {
              const node = model.nodes.find((item) => item.id === event.target.value);
              if (node) {
                centerNode(node, true);
              }
            }}
          >
            <option value="">중심 선택</option>
            {model.nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.label} · {kindLabel(node.kind)}
              </option>
            ))}
          </select>
        </label>

        <label>
          관계 깊이
          <select
            aria-label="중심 그래프 깊이"
            value={uiState.depth}
            onChange={(event) =>
              setUiState((current) => ({
                ...current,
                depth: Number(event.target.value) as 1 | 2 | 3
              }))
            }
          >
            <option value={1}>1단계</option>
            <option value={2}>2단계</option>
            <option value={3}>3단계</option>
          </select>
        </label>

        <details className="world-graph-filter">
          <summary>필터</summary>
          <div>
            <fieldset>
              <legend>설정 종류</legend>
              {WORLD_GRAPH_ENTITY_KINDS.map((kind) => (
                <label key={kind}>
                  <input
                    type="checkbox"
                    value={kind}
                    checked={uiState.filters.kinds.includes(kind)}
                    onChange={(event) =>
                      changeMultiFilter<WorldGraphEntityKind>(event, "kinds")
                    }
                  />
                  {kindLabel(kind)}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>상태</legend>
              {WORLD_GRAPH_ENTITY_STATUSES.map((status) => (
                <label key={status}>
                  <input
                    type="checkbox"
                    value={status}
                    checked={uiState.filters.statuses.includes(status)}
                    onChange={(event) =>
                      changeMultiFilter<WorldGraphEntityStatus>(event, "statuses")
                    }
                  />
                  {statusLabel(status)}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>태그</legend>
              <label>
                결합 방식
                <select
                  aria-label="태그 필터 방식"
                  value={uiState.filters.tagMode}
                  onChange={(event) =>
                    updateFilters((filters) => ({
                      ...filters,
                      tagMode: event.target.value === "ALL" ? "ALL" : "ANY"
                    }))
                  }
                >
                  <option value="ANY">하나라도 포함</option>
                  <option value="ALL">모두 포함</option>
                </select>
              </label>
              {allTags.map((tag) => (
                <label key={tag.id}>
                  <input
                    type="checkbox"
                    value={tag.id}
                    checked={uiState.filters.tagIds.includes(tag.id)}
                    onChange={(event) => changeMultiFilter<string>(event, "tagIds")}
                  />
                  {tag.name}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>관계 타입</legend>
              {relationTypes.map((type) => (
                <label key={type.relationTypeId}>
                  <input
                    type="checkbox"
                    value={type.relationTypeId}
                    checked={uiState.filters.relationTypeIds.includes(
                      type.relationTypeId
                    )}
                    onChange={(event) =>
                      changeMultiFilter<string>(event, "relationTypeIds")
                    }
                  />
                  {type.name} ({type.count})
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>표시 방식</legend>
              <label>
                관계 방향
                <select
                  aria-label="관계 방향 필터"
                  value={uiState.filters.relationDirection}
                  onChange={(event) =>
                    updateFilters((filters) => ({
                      ...filters,
                      relationDirection: event.target.value as
                        | "ALL"
                        | "DIRECTED"
                        | "UNDIRECTED"
                    }))
                  }
                >
                  <option value="ALL">모든 관계</option>
                  <option value="DIRECTED">방향 관계만</option>
                  <option value="UNDIRECTED">무방향 관계만</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={uiState.filters.showIsolated}
                  onChange={(event) =>
                    updateFilters((filters) => ({
                      ...filters,
                      showIsolated: event.target.checked
                    }))
                  }
                />
                고립 설정 표시
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={uiState.filters.showLabels}
                  onChange={(event) =>
                    updateFilters((filters) => ({
                      ...filters,
                      showLabels: event.target.checked
                    }))
                  }
                />
                관계 label 표시
              </label>
            </fieldset>
          </div>
        </details>

        <button
          type="button"
          onClick={() => setAutoLayoutRequest((value) => value + 1)}
        >
          자동 배치 다시 실행
        </button>
        <button
          type="button"
          onClick={() => {
            setUiState((current) => ({
              ...current,
              layout: "cose",
              viewport: DEFAULT_WORLD_GRAPH_UI_STATE.viewport,
              nodePositions: {}
            }));
            setAutoLayoutRequest((value) => value + 1);
          }}
        >
          레이아웃 초기화
        </button>
      </header>

      {(notice || errorMessage) && (
        <p className="world-graph__notice" role="status">
          {errorMessage || notice}
        </p>
      )}
      {model.diagnostics.length > 0 && (
        <ul className="world-graph__diagnostics" aria-label="core 그래프 진단">
          {model.diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.code}:${diagnostic.recordId ?? index}`}>
              {diagnostic.severity}: {diagnostic.message}
            </li>
          ))}
        </ul>
      )}
      {filteredGraph && filteredGraph.renderDiagnostics.length > 0 && (
        <ul className="world-graph__diagnostics" aria-label="renderer 그래프 진단">
          {filteredGraph.renderDiagnostics.map((diagnostic) => (
            <li key={`${diagnostic.code}:${diagnostic.subjectId}`}>
              {diagnostic.message}
            </li>
          ))}
        </ul>
      )}

      <div className="world-graph__body">
        <main className="world-graph__stage">
          <div className="world-graph__summary" aria-label="그래프 통계">
            <span>전체 설정 {model.stats.entityCount.toLocaleString("ko-KR")}개</span>
            <span>표시 설정 {filteredGraph?.nodes.length.toLocaleString("ko-KR") ?? 0}개</span>
            <span>전체 관계 {model.stats.relationCount.toLocaleString("ko-KR")}개</span>
            <span>표시 관계 {filteredGraph?.edges.length.toLocaleString("ko-KR") ?? 0}개</span>
            <span>고립 설정 {model.stats.isolatedEntityCount.toLocaleString("ko-KR")}개</span>
            <details>
              <summary>관계가 많은 설정</summary>
              <ol>
                {model.stats.topDegreeEntities.map((entry) => (
                  <li key={entry.entityId}>
                    {entry.label} ({entry.degree})
                  </li>
                ))}
              </ol>
            </details>
            <details>
              <summary>종류별 설정 수</summary>
              <ul>
                {model.stats.entityKindCounts.map((entry) => (
                  <li key={entry.kind}>
                    {kindLabel(entry.kind)} {entry.count.toLocaleString("ko-KR")}개
                  </li>
                ))}
              </ul>
            </details>
            <details>
              <summary>타입별 관계 수</summary>
              <ul>
                {model.stats.relationTypeCounts.map((entry) => (
                  <li key={entry.relationTypeId}>
                    {entry.name} {entry.count.toLocaleString("ko-KR")}개
                  </li>
                ))}
              </ul>
            </details>
          </div>
          {!filteredGraph || model.nodes.length === 0 ? (
            <div className="world-graph__empty">
              <h2>아직 연결된 세계관 설정이 없습니다.</h2>
              <p>Story Bible에서 설정과 관계를 추가하면 여기에 표시됩니다.</p>
            </div>
          ) : filteredGraph.nodes.length === 0 ? (
            <div className="world-graph__empty">
              <h2>현재 필터로 표시할 설정이 없습니다.</h2>
              <p>필터를 조정하거나 전체 그래프로 돌아가세요.</p>
            </div>
          ) : (
            <WorldGraphCanvas
              graph={filteredGraph}
              selection={selection}
              showLabels={uiState.filters.showLabels}
              centerEntityId={selectedNode?.id ?? uiState.focusedEntityId}
              centerRequest={centerRequest}
              centerRequestStartedAt={centerStartedAtRef.current}
              nodePositions={uiState.nodePositions}
              viewport={
                initialUiState &&
                (initialUiState.layout === "preset" ||
                  Object.keys(initialUiState.nodePositions).length > 0 ||
                  initialUiState.viewport.zoom !== 1 ||
                  initialUiState.viewport.pan.x !== 0 ||
                  initialUiState.viewport.pan.y !== 0)
                  ? uiState.viewport
                  : null
              }
              autoLayoutRequest={autoLayoutRequest}
              onSelectionChange={select}
              onOpenEntity={(entityId) => void onOpenEntity(entityId)}
              onNodePositionChange={(entityId: string, position: WorldGraphPoint) =>
                setUiState((current) => ({
                  ...current,
                  layout: "preset",
                  nodePositions: {
                    ...current.nodePositions,
                    [entityId]: position
                  }
                }))
              }
              onViewportChange={(viewport: WorldGraphViewport) =>
                setUiState((current) => ({ ...current, viewport }))
              }
              onElementConversionComplete={(elementConversionMs) =>
                externalCallbacksRef.current.onPerformanceSample?.({
                  elementConversionMs
                })
              }
              onLayoutComplete={(layoutMs) =>
                externalCallbacksRef.current.onPerformanceSample?.({ layoutMs })
              }
              onInteractionPerformance={(sample) =>
                externalCallbacksRef.current.onPerformanceSample?.(sample)
              }
            />
          )}
        </main>

        <aside
          className="world-graph-detail"
          id="world-graph-detail"
          tabIndex={-1}
          aria-label="선택 항목 상세"
          data-testid="world-graph-detail"
        >
          <p className="eyebrow">READ-ONLY DETAIL</p>
          {!selectedNode && !selectedEdge ? (
            <>
              <h2>선택 항목 상세</h2>
              <p>설정이나 관계를 선택하면 세부정보를 표시합니다.</p>
              <p>그래프에서는 canonical 설정이나 관계를 변경하지 않습니다.</p>
            </>
          ) : selectedNode ? (
            <NodeDetail
              nodes={model.nodes}
              entity={selectedNode}
              detail={visibleDetail}
              sceneContext={visibleSceneContext}
              mentionCount={visibleMentionCount}
              busy={detailBusy}
              error={visibleDetailError}
              onSelectCounterpart={(entityId) => {
                const node = model.nodes.find((candidate) => candidate.id === entityId);
                if (node) {
                  centerNode(node, true);
                }
              }}
              onOpenEntity={() => void onOpenEntity(selectedNode.id)}
              onAddToCanvas={
                onAddEntityToCanvas
                  ? () => void onAddEntityToCanvas(selectedNode.id)
                  : undefined
              }
              onOpenScene={(sceneId) => void onOpenScene(sceneId)}
            />
          ) : selectedEdge ? (
            <EdgeDetail
              edge={selectedEdge}
              nodes={model.nodes}
              onOpenRelation={() =>
                void onOpenRelation(selectedEdge.id, selectedEdge.sourceEntityId)
              }
              onSelectEntity={(entityId) => {
                const node = model.nodes.find((candidate) => candidate.id === entityId);
                if (node) {
                  centerNode(node, false);
                }
              }}
            />
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function NodeDetail({
  nodes,
  entity,
  detail,
  sceneContext,
  mentionCount,
  busy,
  error,
  onSelectCounterpart,
  onOpenEntity,
  onAddToCanvas,
  onOpenScene
}: {
  readonly nodes: readonly WorldGraphNodeView[];
  readonly entity: WorldGraphNodeView;
  readonly detail: WorldGraphEntityDetailView | null;
  readonly sceneContext: WorldGraphSceneContextView | null;
  readonly mentionCount: number | null;
  readonly busy: boolean;
  readonly error: string;
  readonly onSelectCounterpart: (entityId: string) => void;
  readonly onOpenEntity: () => void;
  readonly onAddToCanvas?: () => void;
  readonly onOpenScene: (sceneId: string) => void;
}) {
  return (
    <>
      <h2>{entity.label}</h2>
      <div className="world-graph-detail__badges">
        <span>{kindLabel(entity.kind)}</span>
        <span>{statusLabel(entity.status)}</span>
        {entity.tags.map((tag) => (
          <span key={tag.id}>#{tag.name}</span>
        ))}
      </div>
      {entity.summary && <p>{entity.summary}</p>}
      {entity.aliases.length > 0 && <p>별칭: {entity.aliases.join(", ")}</p>}
      <div className="world-graph-detail__actions">
        <button type="button" onClick={onOpenEntity}>
          설정 상세에서 열기
        </button>
        {onAddToCanvas && (
          <button type="button" onClick={onAddToCanvas}>
            캔버스에 추가
          </button>
        )}
      </div>
      {busy && <p role="status">장면과 본문 후보를 불러오는 중입니다.</p>}
      {error && <p role="alert">{error}</p>}
      {detail ? (
        <>
          <RelationDetailList
            title="나가는 관계"
            nodes={nodes}
            relations={detail.outgoingRelations}
            onSelectCounterpart={onSelectCounterpart}
          />
          <RelationDetailList
            title="들어오는 관계"
            nodes={nodes}
            relations={detail.incomingRelations}
            onSelectCounterpart={onSelectCounterpart}
          />
          <RelationDetailList
            title="무방향 관계"
            nodes={nodes}
            relations={detail.undirectedRelations}
            onSelectCounterpart={onSelectCounterpart}
          />
        </>
      ) : (
        <section aria-label="상세 관계 목록">
          <h3>상세 관계</h3>
          <p>세부정보 불러오는 중</p>
        </section>
      )}
      <section aria-label="명시적 장면 연결">
        <h3>명시적 장면 연결 ({sceneContext?.links.length ?? entity.explicitSceneLinkCount})</h3>
        {sceneContext === null ? (
          <p>장면 연결 불러오는 중</p>
        ) : sceneContext.links.length > 0 ? (
          <ul>
            {sceneContext.links.map((link) => (
              <li key={`${link.sceneNodeId}:${link.role}`}>
                <button type="button" onClick={() => onOpenScene(link.sceneNodeId)}>
                  {link.sceneTitle} · {link.role}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>명시적 장면 연결이 없습니다.</p>
        )}
      </section>
      <section aria-label="본문 자동 언급 후보">
        <h3>본문 자동 언급 후보</h3>
        <p>{mentionCount === null ? "선택 후 계산 중" : `${mentionCount}개`}</p>
        <small>후보는 자동으로 canonical 장면 연결이나 관계가 되지 않습니다.</small>
      </section>
    </>
  );
}

function RelationDetailList({
  title,
  nodes,
  relations,
  onSelectCounterpart
}: {
  readonly title: string;
  readonly nodes: readonly WorldGraphNodeView[];
  readonly relations: readonly WorldGraphDetailRelationView[];
  readonly onSelectCounterpart: (entityId: string) => void;
}) {
  return (
    <section aria-label={title}>
      <h3>{title} ({relations.length})</h3>
      {relations.length === 0 ? (
        <p>관계가 없습니다.</p>
      ) : (
        <ul>
          {relations.map((relation) => (
            <li key={relation.edge.id}>
              <button
                type="button"
                onClick={() => onSelectCounterpart(relation.counterpartEntityId)}
              >
                {relation.perspective === "INCOMING" ? "← " : ""}
                {relation.displayLabel}
                {relation.perspective === "OUTGOING" ? " → " : " — "}
                {counterpartLabel(nodes, relation)}
              </button>
              {relation.edge.note && <p>{relation.edge.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EdgeDetail({
  edge,
  nodes,
  onOpenRelation,
  onSelectEntity
}: {
  readonly edge: WorldGraphEdgeView;
  readonly nodes: readonly WorldGraphNodeView[];
  readonly onOpenRelation: () => void;
  readonly onSelectEntity: (entityId: string) => void;
}) {
  const source = nodes.find((node) => node.id === edge.sourceEntityId);
  const target = nodes.find((node) => node.id === edge.targetEntityId);
  return (
    <>
      <h2>{edge.forwardLabel}</h2>
      <p>{edge.directed ? "방향 관계 →" : "무방향 관계 —"}</p>
      <p>
        <button type="button" onClick={() => onSelectEntity(edge.sourceEntityId)}>
          {source?.label ?? "삭제된 설정"}
        </button>{" "}
        {edge.directed ? "→" : "—"}{" "}
        <button type="button" onClick={() => onSelectEntity(edge.targetEntityId)}>
          {target?.label ?? "삭제된 설정"}
        </button>
      </p>
      {edge.directed && (
        <p>역방향 label: {edge.inverseLabel ?? edge.forwardLabel}</p>
      )}
      {edge.note && <p>관계 메모: {edge.note}</p>}
      <button type="button" onClick={onOpenRelation}>
        관계 편집에서 열기
      </button>
      <p>이 화면에서는 관계를 생성·수정·삭제할 수 없습니다.</p>
    </>
  );
}
