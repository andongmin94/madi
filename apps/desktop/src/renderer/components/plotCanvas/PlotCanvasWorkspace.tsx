import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { CanvasAutosaveController } from "./canvasAutosave";
import {
  MAX_JSON_CANVAS_EDGES,
  MAX_JSON_CANVAS_NODES,
  canonicalizeJsonCanvas
} from "./jsonCanvasAdapter";
import {
  addCanvasEdge,
  addCanvasNode,
  applyCanvasRuntimeNodeChanges,
  commitCanvasHistory,
  createCanvasEdge,
  createCanvasSessionHistory,
  createGroupCanvasNode,
  createNodeFromPickerItem,
  createTextCanvasNode,
  deleteCanvasSelection,
  duplicateCanvasNodes,
  endCanvasHistoryCoalescing,
  redoCanvasHistory,
  resolveCanvasNodeDisplay,
  undoCanvasHistory,
  type CanvasGroupDeleteMode,
  type CanvasRuntimeNodeChange,
  type CanvasSessionHistory
} from "./canvasDocument";
import { CanvasInspector } from "./CanvasInspector";
import { CanvasNodePicker } from "./CanvasNodePicker";
import { PlotCanvasNode } from "./PlotCanvasNode";
import { toReactFlowModel } from "./reactFlowAdapter";
import type {
  CanvasAutosaveState,
  CanvasEntityReference,
  CanvasPickerItem,
  CanvasReferenceDisplay,
  CanvasReferenceCatalog,
  CanvasSaveRequest,
  CanvasSaveResult,
  MadiCanvasDocument,
  MadiCanvasNode,
  MadiCanvasNodeKind,
  MadiCanvasSelection,
  MadiCanvasUiState
} from "./types";
import { DEFAULT_MADI_CANVAS_UI_STATE } from "./types";
import "./plotCanvas.css";

const PLOT_CANVAS_NODE_TYPES = { madiCard: PlotCanvasNode };
const PLOT_CANVAS_SNAP_GRID: [number, number] = [16, 16];
const PLOT_CANVAS_PAN_BUTTONS = [1, 2];
const PLOT_CANVAS_MULTI_SELECT_KEYS = ["Control", "Meta"];

type CanvasFlowModel = ReturnType<typeof toReactFlowModel>;
type CanvasFlowNode = CanvasFlowModel["nodes"][number];
type WorkspaceCanvasFlowNode = Omit<CanvasFlowNode, "data"> & {
  readonly data: CanvasFlowNode["data"] & {
    readonly onResizeEnd: () => void;
  };
};
interface WorkspaceCanvasFlowModel {
  readonly nodes: readonly WorkspaceCanvasFlowNode[];
  readonly edges: CanvasFlowModel["edges"];
}

function sameReferenceDisplay(
  left: CanvasReferenceDisplay,
  right: CanvasReferenceDisplay
): boolean {
  return (
    left.kind === right.kind &&
    left.title === right.title &&
    left.subtitle === right.subtitle &&
    left.description === right.description &&
    left.badge === right.badge &&
    left.color === right.color &&
    left.broken === right.broken &&
    left.referenceId === right.referenceId
  );
}

function canReuseCanvasFlowNode(
  previous: WorkspaceCanvasFlowNode,
  next: WorkspaceCanvasFlowNode
): boolean {
  return (
    previous.data.canonicalNode === next.data.canonicalNode &&
    previous.data.onResizeEnd === next.data.onResizeEnd &&
    sameReferenceDisplay(previous.data.display, next.data.display) &&
    previous.position.x === next.position.x &&
    previous.position.y === next.position.y &&
    previous.parentId === next.parentId &&
    previous.extent === next.extent &&
    previous.selected === next.selected &&
    previous.zIndex === next.zIndex &&
    previous.width === next.width &&
    previous.height === next.height &&
    previous.measured?.width === next.measured?.width &&
    previous.measured?.height === next.measured?.height
  );
}

function canReuseCanvasFlowEdge(
  previous: CanvasFlowModel["edges"][number],
  next: CanvasFlowModel["edges"][number]
): boolean {
  return (
    previous.data?.canonicalEdge === next.data?.canonicalEdge &&
    previous.selected === next.selected
  );
}

interface FlowInstancePort {
  fitView(options?: { readonly padding?: number; readonly duration?: number }): Promise<boolean>;
  setViewport(
    viewport: { readonly x: number; readonly y: number; readonly zoom: number },
    options?: { readonly duration?: number }
  ): Promise<boolean>;
  setCenter(
    x: number,
    y: number,
    options?: { readonly zoom?: number; readonly duration?: number }
  ): Promise<boolean>;
}

export interface PlotCanvasWorkspaceHandle {
  flush(): Promise<void>;
  getDocument(): MadiCanvasDocument;
  addPickerItem(item: CanvasPickerItem): void;
}

export interface PlotCanvasWorkspaceProps {
  readonly canvasId: string;
  readonly document: MadiCanvasDocument;
  /** Change this when the same canvas is replaced by snapshot/import content. */
  readonly documentVersion?: string | number;
  readonly catalog: CanvasReferenceCatalog;
  readonly initialUiState?: MadiCanvasUiState | null;
  readonly onDocumentChange?: (document: MadiCanvasDocument) => void;
  readonly onSave?: (
    request: CanvasSaveRequest
  ) => Promise<CanvasSaveResult | void>;
  readonly onAutosaveStateChange?: (state: CanvasAutosaveState) => void;
  readonly onUiStateChange?: (state: MadiCanvasUiState) => void;
  readonly onOpenEntity?: (entityId: string) => void;
  readonly onOpenScene?: (sceneNodeId: string) => void;
  readonly onSearchEntities?: (
    query: string
  ) => Promise<readonly CanvasEntityReference[]>;
  readonly onConfirmGroupDelete?: (
    group: MadiCanvasNode,
    childCount: number
  ) => CanvasGroupDeleteMode;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(
    element?.closest("input, textarea, select, [contenteditable='true']")
  );
}

function handleSide(handleId: string | null | undefined):
  | "top"
  | "right"
  | "bottom"
  | "left"
  | undefined {
  const side = handleId?.split("-").at(-1);
  return side === "top" ||
    side === "right" ||
    side === "bottom" ||
    side === "left"
    ? side
    : undefined;
}

function autosaveLabel(state: CanvasAutosaveState): string {
  switch (state.phase) {
    case "dirty":
      return "저장 대기";
    case "saving":
      return "저장 중…";
    case "saved":
      return state.lastSavedAt
        ? `저장됨 ${new Date(state.lastSavedAt).toLocaleTimeString("ko-KR")}`
        : "저장됨";
    case "error":
      return `저장 실패: ${state.errorMessage ?? "알 수 없는 오류"}`;
    default:
      return "변경 없음";
  }
}

function sameSelection(
  left: MadiCanvasSelection | null,
  right: MadiCanvasSelection | null
): boolean {
  return left === right ||
    (left !== null &&
      right !== null &&
      left.kind === right.kind &&
      left.id === right.id);
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return (
    left === right ||
    (left.length === right.length &&
      left.every((value, index) => value === right[index]))
  );
}

interface RuntimeSelectionChange {
  readonly id: string;
  readonly selected: boolean;
}

function applyRuntimeSelectionChanges(
  current: readonly string[],
  changes: readonly RuntimeSelectionChange[]
): readonly string[] {
  const next = [...current];
  for (const change of changes) {
    const index = next.indexOf(change.id);
    if (change.selected && index < 0) {
      next.push(change.id);
    } else if (!change.selected && index >= 0) {
      next.splice(index, 1);
    }
  }
  return sameIds(current, next) ? current : next;
}

function sameUiState(left: MadiCanvasUiState, right: MadiCanvasUiState): boolean {
  return (
    left === right ||
    (left.viewport.x === right.viewport.x &&
      left.viewport.y === right.viewport.y &&
      left.viewport.zoom === right.viewport.zoom &&
      left.selectedElementId === right.selectedElementId &&
      left.inspectorWidth === right.inspectorWidth &&
      left.showGrid === right.showGrid &&
      left.showMinimap === right.showMinimap &&
      left.snapToGrid === right.snapToGrid)
  );
}

function canvasCapacityError(
  document: MadiCanvasDocument,
  additionalNodes: number,
  additionalEdges: number
): string | null {
  if (document.nodes.length + additionalNodes > MAX_JSON_CANVAS_NODES) {
    return `노드는 최대 ${MAX_JSON_CANVAS_NODES}개까지 추가할 수 있습니다.`;
  }
  if (document.edges.length + additionalEdges > MAX_JSON_CANVAS_EDGES) {
    return `연결선은 최대 ${MAX_JSON_CANVAS_EDGES}개까지 추가할 수 있습니다.`;
  }
  return null;
}

export const PlotCanvasWorkspace = forwardRef<
  PlotCanvasWorkspaceHandle,
  PlotCanvasWorkspaceProps
>(function PlotCanvasWorkspace(
  {
    canvasId,
    document,
    documentVersion = 0,
    catalog,
    initialUiState = null,
    onDocumentChange,
    onSave,
    onAutosaveStateChange,
    onUiStateChange,
    onOpenEntity,
    onOpenScene,
    onSearchEntities,
    onConfirmGroupDelete
  },
  forwardedRef
) {
  const saveCallbackRef = useRef(onSave);
  saveCallbackRef.current = onSave;
  const documentCallbackRef = useRef(onDocumentChange);
  documentCallbackRef.current = onDocumentChange;
  const autosaveCallbackRef = useRef(onAutosaveStateChange);
  autosaveCallbackRef.current = onAutosaveStateChange;
  const uiStateCallbackRef = useRef(onUiStateChange);
  uiStateCallbackRef.current = onUiStateChange;

  const historyRef = useRef<CanvasSessionHistory>(
    createCanvasSessionHistory(document)
  );
  const [history, setHistory] = useState(historyRef.current);
  const [selection, setSelection] = useState<MadiCanvasSelection | null>(() => {
    const selectedId = initialUiState?.selectedElementId;
    if (!selectedId) {
      return null;
    }
    return document.nodes.some((node) => node.id === selectedId)
      ? { kind: "NODE", id: selectedId }
      : document.edges.some((edge) => edge.id === selectedId)
        ? { kind: "EDGE", id: selectedId }
        : null;
  });
  const [selectedNodeIds, setSelectedNodeIds] = useState<readonly string[]>(() =>
    selection?.kind === "NODE" ? [selection.id] : []
  );
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<readonly string[]>(() =>
    selection?.kind === "EDGE" ? [selection.id] : []
  );
  const selectedNodeIdsRef = useRef(selectedNodeIds);
  const selectedEdgeIdsRef = useRef(selectedEdgeIds);
  selectedNodeIdsRef.current = selectedNodeIds;
  selectedEdgeIdsRef.current = selectedEdgeIds;
  const [uiState, setUiStateValue] = useState<MadiCanvasUiState>(
    initialUiState ?? DEFAULT_MADI_CANVAS_UI_STATE
  );
  const uiStateValueRef = useRef(uiState);
  const [picker, setPicker] = useState<{
    readonly open: boolean;
    readonly preferredKind: MadiCanvasNodeKind | null;
  }>({ open: false, preferredKind: null });
  const [workspaceError, setWorkspaceError] = useState("");
  const flowInstanceRef = useRef<FlowInstancePort | null>(null);

  const autosaveRef = useRef<CanvasAutosaveController | null>(null);
  if (!autosaveRef.current) {
    autosaveRef.current = new CanvasAutosaveController(
      canvasId,
      document,
      async (request) => saveCallbackRef.current?.(request)
    );
  }
  const autosave = autosaveRef.current;
  const [autosaveState, setAutosaveState] = useState(autosave.state);

  useEffect(
    () =>
      autosave.subscribe((state) => {
        setAutosaveState(state);
        autosaveCallbackRef.current?.(state);
      }),
    [autosave]
  );
  useEffect(() => () => autosave.dispose(), [autosave]);

  const activeDocumentKeyRef = useRef(`${canvasId}:${documentVersion}`);
  useEffect(() => {
    const nextKey = `${canvasId}:${documentVersion}`;
    if (activeDocumentKeyRef.current === nextKey) {
      return;
    }
    if (
      autosave.state.canvasId === canvasId &&
      canonicalizeJsonCanvas(document) ===
        canonicalizeJsonCanvas(historyRef.current.present)
    ) {
      // A successful save can advance the database revision without changing
      // the document. Keep the session-local Undo/Redo history in that case.
      activeDocumentKeyRef.current = nextKey;
      return;
    }
    let cancelled = false;
    void autosave
      .flush()
      .then(() => {
        if (cancelled) {
          return;
        }
        activeDocumentKeyRef.current = nextKey;
        autosave.activate(canvasId, document);
        const nextHistory = createCanvasSessionHistory(document);
        historyRef.current = nextHistory;
        setHistory(nextHistory);
        const nextUi = initialUiState ?? DEFAULT_MADI_CANVAS_UI_STATE;
        uiStateValueRef.current = nextUi;
        setUiStateValue(nextUi);
        setSelection(null);
        selectedNodeIdsRef.current = [];
        selectedEdgeIdsRef.current = [];
        setSelectedNodeIds([]);
        setSelectedEdgeIds([]);
        setWorkspaceError("");
        void flowInstanceRef.current?.setViewport(nextUi.viewport);
      })
      .catch(() => {
        // Keep the current document mounted. The autosave controller already
        // exposes the error and an explicit parent flush can fail closed.
      });
    return () => {
      cancelled = true;
    };
  }, [autosave, canvasId, document, documentVersion, initialUiState]);

  const setUiState = useCallback(
    (update: (current: MadiCanvasUiState) => MadiCanvasUiState) => {
      const current = uiStateValueRef.current;
      const next = update(current);
      if (sameUiState(current, next)) {
        return;
      }
      uiStateValueRef.current = next;
      setUiStateValue(next);
      uiStateCallbackRef.current?.(next);
    },
    []
  );

  const publishSelection = useCallback(
    (nodeIds: readonly string[], edgeIds: readonly string[]) => {
      selectedNodeIdsRef.current = nodeIds;
      selectedEdgeIdsRef.current = edgeIds;
      setSelectedNodeIds((current) =>
        sameIds(current, nodeIds) ? current : nodeIds
      );
      setSelectedEdgeIds((current) =>
        sameIds(current, edgeIds) ? current : edgeIds
      );
      const next = nodeIds.length > 0
        ? ({ kind: "NODE", id: nodeIds.at(-1)! } as const)
        : edgeIds.length > 0
          ? ({ kind: "EDGE", id: edgeIds.at(-1)! } as const)
          : null;
      setSelection((current) => (sameSelection(current, next) ? current : next));
      setUiState((current) => ({
        ...current,
        selectedElementId: next?.id ?? null
      }));
    },
    [setUiState]
  );

  const select = useCallback(
    (next: MadiCanvasSelection | null) => {
      publishSelection(
        next?.kind === "NODE" ? [next.id] : [],
        next?.kind === "EDGE" ? [next.id] : []
      );
    },
    [publishSelection]
  );

  const publishHistory = useCallback(
    (next: CanvasSessionHistory) => {
      historyRef.current = next;
      setHistory(next);
      autosave.update(next.present);
      documentCallbackRef.current?.(next.present);
    },
    [autosave]
  );

  const commit = useCallback(
    (nextDocument: MadiCanvasDocument, coalesceKey: string | null = null) => {
      const next = commitCanvasHistory(
        historyRef.current,
        nextDocument,
        coalesceKey
      );
      if (next !== historyRef.current) {
        publishHistory(next);
      }
    },
    [publishHistory]
  );

  const undo = useCallback(() => {
    const next = undoCanvasHistory(historyRef.current);
    if (next !== historyRef.current) {
      publishHistory(next);
    }
  }, [publishHistory]);

  const redo = useCallback(() => {
    const next = redoCanvasHistory(historyRef.current);
    if (next !== historyRef.current) {
      publishHistory(next);
    }
  }, [publishHistory]);

  const endHistoryCoalescing = useCallback(() => {
    const next = endCanvasHistoryCoalescing(historyRef.current);
    if (next !== historyRef.current) {
      historyRef.current = next;
      setHistory(next);
    }
  }, []);

  const viewportCenter = useCallback(() => {
    const { x, y, zoom } = uiState.viewport;
    return { x: (460 - x) / zoom, y: (320 - y) / zoom };
  }, [uiState.viewport]);

  const addPickerItem = useCallback(
    (item: CanvasPickerItem) => {
      const current = historyRef.current.present;
      const capacityError = canvasCapacityError(current, 1, 0);
      if (capacityError) {
        setWorkspaceError(capacityError);
        setPicker({ open: false, preferredKind: null });
        return;
      }
      const node = createNodeFromPickerItem(item, viewportCenter());
      setWorkspaceError("");
      commit(addCanvasNode(current, node));
      select({ kind: "NODE", id: node.id });
      setPicker({ open: false, preferredKind: null });
    },
    [commit, select, viewportCenter]
  );

  useImperativeHandle(
    forwardedRef,
    () => ({
      flush: () => autosave.flush(),
      getDocument: () => historyRef.current.present,
      addPickerItem
    }),
    [addPickerItem, autosave]
  );

  const addText = useCallback(() => {
    const current = historyRef.current.present;
    const capacityError = canvasCapacityError(current, 1, 0);
    if (capacityError) {
      setWorkspaceError(capacityError);
      return;
    }
    const node = createTextCanvasNode("새 메모", viewportCenter());
    setWorkspaceError("");
    commit(addCanvasNode(current, node));
    select({ kind: "NODE", id: node.id });
  }, [commit, select, viewportCenter]);

  const addGroup = useCallback(() => {
    const current = historyRef.current.present;
    const capacityError = canvasCapacityError(current, 1, 0);
    if (capacityError) {
      setWorkspaceError(capacityError);
      return;
    }
    const node = createGroupCanvasNode("새 그룹", viewportCenter());
    setWorkspaceError("");
    commit(addCanvasNode(current, node));
    select({ kind: "NODE", id: node.id });
  }, [commit, select, viewportCenter]);

  const duplicateSelected = useCallback(() => {
    const ids =
      selectedNodeIds.length > 0
        ? selectedNodeIds
        : selection?.kind === "NODE"
          ? [selection.id]
          : [];
    const current = historyRef.current.present;
    const selectedIds = new Set(ids);
    const additionalNodes = current.nodes.filter((node) =>
      selectedIds.has(node.id)
    ).length;
    const additionalEdges = current.edges.filter(
      (edge) => selectedIds.has(edge.fromNode) && selectedIds.has(edge.toNode)
    ).length;
    if (additionalNodes === 0) {
      return;
    }
    const capacityError = canvasCapacityError(
      current,
      additionalNodes,
      additionalEdges
    );
    if (capacityError) {
      setWorkspaceError(capacityError);
      return;
    }
    const duplicated = duplicateCanvasNodes(current, ids);
    if (duplicated.document !== historyRef.current.present) {
      setWorkspaceError("");
      commit(duplicated.document);
      const lastId = duplicated.duplicatedNodeIds.at(-1);
      if (lastId) {
        select({ kind: "NODE", id: lastId });
      }
    }
  }, [commit, select, selectedNodeIds, selection]);

  const deleteSelected = useCallback(() => {
    if (!selection && selectedNodeIds.length === 0) {
      return;
    }
    let next = historyRef.current.present;
    const nodeIds =
      selectedNodeIds.length > 0
        ? selectedNodeIds
        : selection?.kind === "NODE"
          ? [selection.id]
          : [];
    for (const nodeId of nodeIds) {
      const node = next.nodes.find((candidate) => candidate.id === nodeId);
      let mode: CanvasGroupDeleteMode = "DELETE_CHILDREN";
      if (node?.type === "group") {
        const childCount = next.nodes.filter(
          (candidate) => candidate.madi?.parentGroupId === node.id
        ).length;
        mode = onConfirmGroupDelete
          ? onConfirmGroupDelete(node, childCount)
          : window.confirm(
                `그룹 안의 노드 ${childCount}개도 함께 삭제하시겠습니까?\n취소를 누르면 그룹만 해제합니다.`
              )
            ? "DELETE_CHILDREN"
            : "UNGROUP";
      }
      next = deleteCanvasSelection(next, { kind: "NODE", id: nodeId }, mode);
    }
    if (selection?.kind === "EDGE") {
      next = deleteCanvasSelection(next, selection);
    }
    if (next !== historyRef.current.present) {
      commit(next);
      select(null);
    }
  }, [commit, onConfirmGroupDelete, select, selectedNodeIds, selection]);

  const previousReactFlowModelRef = useRef<WorkspaceCanvasFlowModel | null>(null);
  const reactFlowModel = useMemo<WorkspaceCanvasFlowModel>(() => {
    const model = toReactFlowModel(history.present, catalog, selection);
    const selectedNodes = new Set(selectedNodeIds);
    const selectedEdges = new Set(selectedEdgeIds);
    const previousNodes = new Map(
      previousReactFlowModelRef.current?.nodes.map((node) => [node.id, node]) ?? []
    );
    const previousEdges = new Map(
      previousReactFlowModelRef.current?.edges.map((edge) => [edge.id, edge]) ?? []
    );
    const nodes = model.nodes.map((node): WorkspaceCanvasFlowNode => {
      const next = {
        ...node,
        data: { ...node.data, onResizeEnd: endHistoryCoalescing },
        ...(selectedNodeIds.length + selectedEdgeIds.length > 1
          ? { selected: selectedNodes.has(node.id) }
          : {})
      };
      const previous = previousNodes.get(node.id);
      return previous && canReuseCanvasFlowNode(previous, next) ? previous : next;
    });
    const edges = (
      selectedNodeIds.length + selectedEdgeIds.length > 1
        ? model.edges.map((edge) => ({
            ...edge,
            selected: selectedEdges.has(edge.id)
          }))
        : model.edges
    ).map((edge) => {
      const previous = previousEdges.get(edge.id);
      return previous && canReuseCanvasFlowEdge(previous, edge) ? previous : edge;
    });
    return {
      nodes,
      edges
    };
  }, [
    catalog,
    endHistoryCoalescing,
    history.present,
    selectedEdgeIds,
    selectedNodeIds,
    selection
  ]);
  useLayoutEffect(() => {
    previousReactFlowModelRef.current = reactFlowModel;
  }, [reactFlowModel]);
  const reactFlowNodes = useMemo(
    () => [...reactFlowModel.nodes],
    [reactFlowModel.nodes]
  );
  const reactFlowEdges = useMemo(
    () => [...reactFlowModel.edges],
    [reactFlowModel.edges]
  );

  const handleNodeSelectionChanges = useCallback(
    (changes: readonly RuntimeSelectionChange[]) => {
      if (changes.length === 0) {
        return;
      }
      publishSelection(
        applyRuntimeSelectionChanges(selectedNodeIdsRef.current, changes),
        selectedEdgeIdsRef.current
      );
    },
    [publishSelection]
  );

  const handleEdgeSelectionChanges = useCallback(
    (changes: readonly RuntimeSelectionChange[]) => {
      if (changes.length === 0) {
        return;
      }
      publishSelection(
        selectedNodeIdsRef.current,
        applyRuntimeSelectionChanges(selectedEdgeIdsRef.current, changes)
      );
    },
    [publishSelection]
  );

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLocaleLowerCase() === "s") {
      event.preventDefault();
      void autosave.flush().catch(() => {
        // The visible autosave state reports the failure without creating an
        // unhandled rejection from a keyboard event.
      });
      return;
    }
    if (modifier && event.key.toLocaleLowerCase() === "k") {
      event.preventDefault();
      setPicker({ open: true, preferredKind: null });
      return;
    }
    if (isEditableTarget(event.target)) {
      return;
    }
    if (modifier && event.key.toLocaleLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        redo();
      } else {
        undo();
      }
      return;
    }
    if (modifier && event.key.toLocaleLowerCase() === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if (modifier && event.key.toLocaleLowerCase() === "d") {
      event.preventDefault();
      duplicateSelected();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelected();
      return;
    }
    if (event.key === "Escape") {
      if (picker.open) {
        setPicker({ open: false, preferredKind: null });
      } else {
        select(null);
      }
    }
  };

  const displayMaps = useMemo(
    () => ({
      entities: new Map(catalog.entities.map((entity) => [entity.id, entity])),
      scenes: new Map(catalog.scenes.map((scene) => [scene.id, scene]))
    }),
    [catalog]
  );

  return (
    <main
      className="plot-canvas-workspace"
      data-testid="plot-canvas-workspace"
      data-canvas-id={canvasId}
      data-node-count={history.present.nodes.length}
      data-edge-count={history.present.edges.length}
      data-autosave-phase={autosaveState.phase}
      onKeyDown={handleKeyDown}
    >
      <header className="plot-canvas-toolbar" aria-label="Plot Canvas 도구">
        <div className="plot-canvas-toolbar__group">
          <button type="button" onClick={addText}>
            텍스트
          </button>
          <button
            type="button"
            onClick={() => setPicker({ open: true, preferredKind: "ENTITY_REFERENCE" })}
          >
            설정 참조
          </button>
          <button
            type="button"
            onClick={() => setPicker({ open: true, preferredKind: "SCENE_REFERENCE" })}
          >
            장면 참조
          </button>
          <button type="button" onClick={addGroup}>
            그룹
          </button>
          <button
            type="button"
            onClick={() => setPicker({ open: true, preferredKind: null })}
            title="Ctrl+K"
          >
            노드 추가…
          </button>
        </div>
        <div className="plot-canvas-toolbar__group">
          <button type="button" onClick={undo} disabled={history.past.length === 0}>
            실행 취소
          </button>
          <button type="button" onClick={redo} disabled={history.future.length === 0}>
            다시 실행
          </button>
          <button type="button" onClick={duplicateSelected} disabled={!selection}>
            복제
          </button>
          <button type="button" onClick={deleteSelected} disabled={!selection}>
            삭제
          </button>
        </div>
        <div className="plot-canvas-toolbar__group">
          <button
            type="button"
            onClick={() => void flowInstanceRef.current?.fitView({ padding: 0.15, duration: 180 })}
          >
            화면 맞춤
          </button>
          <button
            type="button"
            aria-pressed={uiState.showGrid}
            onClick={() =>
              setUiState((current) => ({ ...current, showGrid: !current.showGrid }))
            }
          >
            격자
          </button>
          <button
            type="button"
            aria-pressed={uiState.showMinimap}
            onClick={() =>
              setUiState((current) => ({
                ...current,
                showMinimap: !current.showMinimap
              }))
            }
          >
            미니맵
          </button>
          <button
            type="button"
            aria-pressed={uiState.snapToGrid}
            onClick={() =>
              setUiState((current) => ({
                ...current,
                snapToGrid: !current.snapToGrid
              }))
            }
          >
            격자 맞춤
          </button>
          <button
            type="button"
            onClick={() => void autosave.flush().catch(() => undefined)}
            title="Ctrl+S"
          >
            저장
          </button>
          <span
            className={`plot-canvas-save-state plot-canvas-save-state--${autosaveState.phase}`}
            role="status"
          >
            {autosaveLabel(autosaveState)}
          </span>
        </div>
      </header>

      {workspaceError ? (
        <p className="plot-canvas-workspace__error" role="alert">
          {workspaceError}
        </p>
      ) : null}

      <section className="plot-canvas-stage" aria-label="Plot Canvas">
        <ReactFlowProvider>
          <ReactFlow
            nodes={reactFlowNodes}
            edges={reactFlowEdges}
            nodeTypes={PLOT_CANVAS_NODE_TYPES}
            defaultViewport={uiState.viewport}
            minZoom={0.15}
            maxZoom={3}
            snapToGrid={uiState.snapToGrid}
            snapGrid={PLOT_CANVAS_SNAP_GRID}
            panOnDrag={PLOT_CANVAS_PAN_BUTTONS}
            selectionOnDrag
            multiSelectionKeyCode={PLOT_CANVAS_MULTI_SELECT_KEYS}
            deleteKeyCode={null}
            fitView={false}
            onInit={(instance) => {
              flowInstanceRef.current = instance;
            }}
            onMoveEnd={(_event, viewport) =>
              setUiState((current) => ({ ...current, viewport }))
            }
            onNodeDoubleClick={(_event, node) => {
              const display = node.data.display;
              if (display.kind === "ENTITY_REFERENCE" && !display.broken) {
                onOpenEntity?.(display.referenceId!);
              }
              if (display.kind === "SCENE_REFERENCE" && !display.broken) {
                onOpenScene?.(display.referenceId!);
              }
            }}
            onNodesChange={(changes) => {
              handleNodeSelectionChanges(
                changes.flatMap((change) =>
                  change.type === "select"
                    ? [{ id: change.id, selected: change.selected }]
                  : []
                )
              );
              const userResizeNodeIds = new Set(
                changes.flatMap((change) =>
                  change.type === "dimensions" &&
                  change.resizing !== undefined
                    ? [change.id]
                    : []
                )
              );
              const runtimeChanges: CanvasRuntimeNodeChange[] = [];
              for (const change of changes) {
                if (
                  change.type === "position" &&
                  (change.dragging !== undefined ||
                    userResizeNodeIds.has(change.id)) &&
                  change.position
                ) {
                  runtimeChanges.push({
                    id: change.id,
                    type: change.type,
                    position: change.position
                  });
                }
                if (
                  change.type === "dimensions" &&
                  change.resizing !== undefined &&
                  change.dimensions
                ) {
                  runtimeChanges.push({
                    id: change.id,
                    type: change.type,
                    dimensions: change.dimensions
                  });
                }
              }
              const next = applyCanvasRuntimeNodeChanges(
                historyRef.current.present,
                runtimeChanges
              );
              const positionIds = runtimeChanges
                .filter(
                  (change) =>
                    change.position && !userResizeNodeIds.has(change.id)
                )
                .map((change) => change.id)
                .sort();
              const dimensionIds = [...userResizeNodeIds].sort();
              const coalesceKey =
                positionIds.length > 0
                  ? `drag:${positionIds.join(",")}`
                  : dimensionIds.length > 0
                    ? `resize:${dimensionIds.join(",")}`
                    : null;
              commit(next, coalesceKey);
            }}
            onEdgesChange={(changes) =>
              handleEdgeSelectionChanges(
                changes.flatMap((change) =>
                  change.type === "select"
                    ? [{ id: change.id, selected: change.selected }]
                    : []
                )
              )
            }
            onNodeDragStop={endHistoryCoalescing}
            onConnect={(connection) => {
              if (!connection.source || !connection.target) {
                return;
              }
              const current = historyRef.current.present;
              const capacityError = canvasCapacityError(current, 0, 1);
              if (capacityError) {
                setWorkspaceError(capacityError);
                return;
              }
              const edge = {
                ...createCanvasEdge(connection.source, connection.target),
                ...(handleSide(connection.sourceHandle)
                  ? { fromSide: handleSide(connection.sourceHandle) }
                  : {}),
                ...(handleSide(connection.targetHandle)
                  ? { toSide: handleSide(connection.targetHandle) }
                  : {})
              };
              setWorkspaceError("");
              commit(addCanvasEdge(current, edge));
              select({ kind: "EDGE", id: edge.id });
            }}
          >
            {uiState.showGrid ? (
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
            ) : null}
            <Controls showInteractive={false} />
            {uiState.showMinimap ? (
              <MiniMap pannable zoomable ariaLabel="Plot Canvas 미니맵" />
            ) : null}
          </ReactFlow>
        </ReactFlowProvider>
      </section>

      <CanvasInspector
        document={history.present}
        catalog={catalog}
        selection={selection}
        width={uiState.inspectorWidth}
        onWidthChange={(inspectorWidth) =>
          setUiState((current) => ({ ...current, inspectorWidth }))
        }
        onDocumentChange={commit}
        onDuplicate={duplicateSelected}
        onDelete={deleteSelected}
        onOpenEntity={onOpenEntity}
        onOpenScene={onOpenScene}
      />

      <details className="plot-canvas-accessible-list">
        <summary>키보드용 노드·연결선 목록</summary>
        <div>
          <section aria-label="캔버스 노드 목록">
            <h2>노드</h2>
            <ul>
              {history.present.nodes.map((node) => {
                const display = resolveCanvasNodeDisplay(
                  node,
                  displayMaps.entities,
                  displayMaps.scenes
                );
                return (
                  <li key={node.id}>
                    <button
                      type="button"
                      aria-pressed={selection?.kind === "NODE" && selection.id === node.id}
                      onClick={() => select({ kind: "NODE", id: node.id })}
                      onDoubleClick={() => {
                        if (display.kind === "ENTITY_REFERENCE" && !display.broken) {
                          onOpenEntity?.(display.referenceId!);
                        }
                        if (display.kind === "SCENE_REFERENCE" && !display.broken) {
                          onOpenScene?.(display.referenceId!);
                        }
                      }}
                    >
                      {display.title} · {display.kind}
                      {display.broken ? " · 연결 끊김" : ""}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
          <section aria-label="캔버스 연결선 목록">
            <h2>연결선</h2>
            <ul>
              {history.present.edges.map((edge) => (
                <li key={edge.id}>
                  <button
                    type="button"
                    aria-pressed={selection?.kind === "EDGE" && selection.id === edge.id}
                    onClick={() => select({ kind: "EDGE", id: edge.id })}
                  >
                    {edge.fromNode} → {edge.label || "제목 없음"} → {edge.toNode}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </details>

      <CanvasNodePicker
        open={picker.open}
        preferredKind={picker.preferredKind}
        catalog={catalog}
        onSearchEntities={onSearchEntities}
        existingTextNodes={history.present.nodes.flatMap((node) =>
          node.type === "text" && node.madi?.nodeKind === "TEXT"
            ? [{ id: node.id, text: node.text }]
            : []
        )}
        onFocusNode={(nodeId) => {
          const node = historyRef.current.present.nodes.find(
            (candidate) => candidate.id === nodeId
          );
          if (node) {
            select({ kind: "NODE", id: node.id });
            void flowInstanceRef.current?.setCenter(node.x, node.y, {
              zoom: Math.max(uiState.viewport.zoom, 0.8),
              duration: 180
            });
          }
        }}
        onPick={addPickerItem}
        onClose={() => setPicker({ open: false, preferredKind: null })}
      />
    </main>
  );
});
