import cytoscape, { type Core, type EventObject } from "cytoscape";
import {
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import {
  toCytoscapeElements,
  WORLD_GRAPH_CYTOSCAPE_STYLES
} from "./cytoscapeElements";
import { createWorldGraphCoseLayoutOptions } from "./worldGraphLayout";
import type {
  FilteredWorldGraph,
  WorldGraphPoint,
  WorldGraphSelection,
  WorldGraphViewport
} from "./types";

export interface WorldGraphCanvasProps {
  readonly graph: FilteredWorldGraph;
  readonly selection: WorldGraphSelection | null;
  readonly showLabels: boolean;
  readonly centerEntityId: string | null;
  readonly centerRequest: number;
  readonly nodePositions: Readonly<Record<string, WorldGraphPoint>>;
  readonly viewport: WorldGraphViewport | null;
  readonly autoLayoutRequest: number;
  readonly onSelectionChange: (selection: WorldGraphSelection | null) => void;
  readonly onOpenEntity: (entityId: string) => void;
  readonly onNodePositionChange: (
    entityId: string,
    position: WorldGraphPoint
  ) => void;
  readonly onViewportChange: (viewport: WorldGraphViewport) => void;
  readonly onElementConversionComplete?: (durationMs: number) => void;
  readonly onLayoutComplete?: (durationMs: number) => void;
}

function isJsdom(): boolean {
  return /jsdom/i.test(window.navigator.userAgent);
}

function selectionFromEvent(event: EventObject): WorldGraphSelection {
  return {
    kind: event.target.isNode() ? "NODE" : "EDGE",
    id: event.target.id()
  };
}

function runSelectionStyling(
  cy: Core,
  graph: FilteredWorldGraph,
  selection: WorldGraphSelection | null
): void {
  const byId = new Map(
    toCytoscapeElements(graph, true, selection).map((element) => [
      String(element.data.id),
      element.classes ?? ""
    ])
  );
  cy.batch(() => {
    cy.elements().forEach((element) => {
      element.classes(byId.get(element.id()) ?? "");
    });
  });
}

export function shouldCenterGraphViewport(
  centerEntityId: string | null,
  centerRequest: number
): boolean {
  return Boolean(centerEntityId) && centerRequest > 0;
}

export function WorldGraphCanvas({
  graph,
  selection,
  showLabels,
  centerEntityId,
  centerRequest,
  nodePositions,
  viewport,
  autoLayoutRequest,
  onSelectionChange,
  onOpenEntity,
  onNodePositionChange,
  onViewportChange,
  onElementConversionComplete,
  onLayoutComplete
}: WorldGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const callbacksRef = useRef({
    onSelectionChange,
    onOpenEntity,
    onNodePositionChange,
    onViewportChange,
    onElementConversionComplete,
    onLayoutComplete
  });
  const nodePositionsRef = useRef(nodePositions);
  const viewportRef = useRef(viewport);
  const viewportFrameRef = useRef<number | null>(null);
  const elementConversion = useMemo(() => {
    const startedAt = performance.now();
    const elements = toCytoscapeElements(graph, showLabels, null);
    return { elements, durationMs: performance.now() - startedAt };
  }, [graph, showLabels]);
  const initialElements = elementConversion.elements;

  useEffect(() => {
    callbacksRef.current = {
      onSelectionChange,
      onOpenEntity,
      onNodePositionChange,
      onViewportChange,
      onElementConversionComplete,
      onLayoutComplete
    };
  }, [
    onLayoutComplete,
    onElementConversionComplete,
    onNodePositionChange,
    onOpenEntity,
    onSelectionChange,
    onViewportChange
  ]);

  useEffect(() => {
    callbacksRef.current.onElementConversionComplete?.(
      elementConversion.durationMs
    );
  }, [elementConversion]);

  useEffect(() => {
    nodePositionsRef.current = nodePositions;
    const cy = cyRef.current;
    if (cy) {
      cy.batch(() => {
        for (const [entityId, position] of Object.entries(nodePositions)) {
          const node = cy.getElementById(entityId);
          if (node.nonempty()) {
            node.position(position);
          }
        }
      });
    }
  }, [nodePositions]);

  useEffect(() => {
    const cy = cyRef.current;
    viewportRef.current = viewport;
    if (!cy || !viewport) {
      return;
    }
    const currentPan = cy.pan();
    if (
      Math.abs(cy.zoom() - viewport.zoom) > 0.0001 ||
      Math.abs(currentPan.x - viewport.pan.x) > 0.01 ||
      Math.abs(currentPan.y - viewport.pan.y) > 0.01
    ) {
      cy.viewport({ zoom: viewport.zoom, pan: viewport.pan });
    }
  }, [viewport]);

  useEffect(() => {
    const headless = isJsdom();
    const cy = cytoscape({
      ...(headless ? { headless: true } : { container: containerRef.current }),
      elements: [],
      style: WORLD_GRAPH_CYTOSCAPE_STYLES,
      minZoom: 0.15,
      maxZoom: 3,
      boxSelectionEnabled: false,
      autoungrabify: false,
      userPanningEnabled: true,
      userZoomingEnabled: true
    });
    cyRef.current = cy;

    cy.on("tap", "node, edge", (event) => {
      callbacksRef.current.onSelectionChange(selectionFromEvent(event));
    });
    cy.on("tap", (event) => {
      if (event.target === cy) {
        callbacksRef.current.onSelectionChange(null);
      }
    });
    cy.on("dbltap", "node", (event) => {
      callbacksRef.current.onOpenEntity(event.target.id());
    });
    cy.on("dragfree", "node", (event) => {
      const position = event.target.position();
      callbacksRef.current.onNodePositionChange(event.target.id(), {
        x: position.x,
        y: position.y
      });
    });
    const emitViewport = () => {
      viewportFrameRef.current = null;
      const pan = cy.pan();
      callbacksRef.current.onViewportChange({
        zoom: cy.zoom(),
        pan: { x: pan.x, y: pan.y }
      });
    };
    cy.on("pan zoom", () => {
      if (viewportFrameRef.current !== null) {
        return;
      }
      viewportFrameRef.current = window.requestAnimationFrame(emitViewport);
    });

    return () => {
      if (viewportFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportFrameRef.current);
        viewportFrameRef.current = null;
      }
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) {
      return;
    }
    cy.batch(() => {
      cy.elements().remove();
      cy.add(initialElements);
      for (const node of cy.nodes()) {
        const saved = nodePositionsRef.current[node.id()];
        if (saved) {
          node.position(saved);
        }
      }
    });

    if (cy.nodes().length === 0) {
      return;
    }
    let hasPositionForEveryNode = true;
    cy.nodes().forEach((node) => {
      if (!nodePositionsRef.current[node.id()]) {
        hasPositionForEveryNode = false;
      }
    });
    const startedAt = performance.now();
    const layout = cy.layout(
      hasPositionForEveryNode
        ? { name: "preset", fit: !viewportRef.current }
        : createWorldGraphCoseLayoutOptions(!viewportRef.current)
    );
    layout.one("layoutstop", () => {
      for (const node of cy.nodes()) {
        const saved = nodePositionsRef.current[node.id()];
        if (saved) {
          node.position(saved);
        }
      }
      cy.nodes().forEach((node) => {
        const position = node.position();
        callbacksRef.current.onNodePositionChange(node.id(), {
          x: position.x,
          y: position.y
        });
      });
      const savedViewport = viewportRef.current;
      if (savedViewport) {
        cy.viewport({ zoom: savedViewport.zoom, pan: savedViewport.pan });
      }
      callbacksRef.current.onLayoutComplete?.(performance.now() - startedAt);
    });
    layout.run();
  }, [graph, initialElements]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || cy.nodes().length === 0 || autoLayoutRequest === 0) {
      return;
    }
    const startedAt = performance.now();
    const layout = cy.layout(createWorldGraphCoseLayoutOptions(true));
    layout.one("layoutstop", () => {
      cy.nodes().forEach((node) => {
        const position = node.position();
        callbacksRef.current.onNodePositionChange(node.id(), {
          x: position.x,
          y: position.y
        });
      });
      callbacksRef.current.onLayoutComplete?.(performance.now() - startedAt);
    });
    layout.run();
  }, [autoLayoutRequest]);

  useEffect(() => {
    if (cyRef.current) {
      runSelectionStyling(cyRef.current, graph, selection);
    }
  }, [graph, selection]);

  useEffect(() => {
    const cy = cyRef.current;
    if (
      !cy ||
      !centerEntityId ||
      !shouldCenterGraphViewport(centerEntityId, centerRequest)
    ) {
      return;
    }
    const node = cy.getElementById(centerEntityId);
    if (node.nonempty()) {
      cy.animate({ center: { eles: node }, duration: 180 });
    }
  }, [centerEntityId, centerRequest]);

  const handleCanvasKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      onSelectionChange(null);
    }
    if (event.key === "Enter" && selection?.kind === "NODE") {
      document.getElementById("world-graph-detail")?.focus();
    }
  };

  return (
    <section className="world-graph-canvas-shell" aria-label="세계관 그래프 캔버스">
      <p className="world-graph-canvas-help" id="world-graph-canvas-help">
        그래프는 읽기 전용입니다. 노드 위치만 드래그할 수 있습니다. Escape로
        선택을 해제하고 Enter로 상세 패널로 이동합니다.
      </p>
      <div
        ref={containerRef}
        className="world-graph-canvas"
        role="img"
        tabIndex={0}
        aria-describedby="world-graph-canvas-help"
        aria-label={`세계관 관계 그래프, 설정 ${graph.nodes.length}개, 관계 ${graph.edges.length}개`}
        data-testid="world-graph-canvas"
        onKeyDown={handleCanvasKeyDown}
      />
      <details className="world-graph-accessible-list">
        <summary>키보드용 그래프 목록</summary>
        <div className="world-graph-accessible-list__columns">
          <section aria-label="그래프 설정 목록">
            <h3>설정</h3>
            <ul>
              {graph.nodes.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    data-entity-id={node.id}
                    aria-pressed={selection?.kind === "NODE" && selection.id === node.id}
                    onClick={() => onSelectionChange({ kind: "NODE", id: node.id })}
                    onDoubleClick={() => onOpenEntity(node.id)}
                  >
                    {node.label} · {node.kind}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="그래프 관계 목록">
            <h3>관계</h3>
            <ul>
              {graph.edges.map((edge) => {
                const source = graph.nodes.find(
                  (node) => node.id === edge.sourceEntityId
                );
                const target = graph.nodes.find(
                  (node) => node.id === edge.targetEntityId
                );
                return (
                  <li key={edge.id}>
                    <button
                      type="button"
                      data-relation-id={edge.id}
                      aria-pressed={selection?.kind === "EDGE" && selection.id === edge.id}
                      onClick={() => onSelectionChange({ kind: "EDGE", id: edge.id })}
                    >
                      {source?.label} {edge.directed ? "→" : "—"} {edge.forwardLabel}{" "}
                      {edge.directed ? "→" : "—"} {target?.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </details>
    </section>
  );
}
