import { Handle, NodeResizer, Position } from "@xyflow/react";
import { MAX_JSON_CANVAS_DIMENSION } from "./canvasGeometry";
import type { CanvasReferenceDisplay, MadiCanvasNode } from "./types";

interface PlotCanvasNodeData {
  readonly canonicalNode: MadiCanvasNode;
  readonly display: CanvasReferenceDisplay;
  readonly onResizeEnd?: () => void;
}

interface PlotCanvasNodeProps {
  readonly id: string;
  readonly data: PlotCanvasNodeData;
  readonly selected?: boolean;
}

const KIND_LABELS: Readonly<Record<CanvasReferenceDisplay["kind"], string>> = {
  TEXT: "텍스트",
  ENTITY_REFERENCE: "설정 참조",
  SCENE_REFERENCE: "장면 참조",
  GROUP: "그룹"
};

function edgeHandles() {
  return (
    <>
      <Handle
        id="target-top"
        type="target"
        position={Position.Top}
        style={{ left: "40%" }}
      />
      <Handle
        id="source-top"
        type="source"
        position={Position.Top}
        style={{ left: "60%" }}
      />
      <Handle
        id="target-right"
        type="target"
        position={Position.Right}
        style={{ top: "40%" }}
      />
      <Handle
        id="source-right"
        type="source"
        position={Position.Right}
        style={{ top: "60%" }}
      />
      <Handle
        id="target-bottom"
        type="target"
        position={Position.Bottom}
        style={{ left: "40%" }}
      />
      <Handle
        id="source-bottom"
        type="source"
        position={Position.Bottom}
        style={{ left: "60%" }}
      />
      <Handle
        id="target-left"
        type="target"
        position={Position.Left}
        style={{ top: "40%" }}
      />
      <Handle
        id="source-left"
        type="source"
        position={Position.Left}
        style={{ top: "60%" }}
      />
    </>
  );
}

export function PlotCanvasNode({ id, data, selected = false }: PlotCanvasNodeProps) {
  const { canonicalNode: node, display } = data;
  const isGroup = node.type === "group";
  return (
    <article
      className={`plot-canvas-node plot-canvas-node--${display.kind.toLowerCase()}${
        display.broken ? " plot-canvas-node--broken" : ""
      }`}
      data-testid={`plot-canvas-node-${id}`}
      data-node-kind={display.kind}
      data-broken={String(display.broken)}
      aria-label={`${display.title}, ${KIND_LABELS[display.kind]}`}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={isGroup ? 280 : 180}
        minHeight={isGroup ? 180 : 100}
        maxWidth={MAX_JSON_CANVAS_DIMENSION}
        maxHeight={MAX_JSON_CANVAS_DIMENSION}
        onResizeEnd={data.onResizeEnd}
      />
      <header className="plot-canvas-node__header">
        <span className="plot-canvas-node__kind">{KIND_LABELS[display.kind]}</span>
        {display.broken ? (
          <span className="plot-canvas-node__broken" role="status">
            연결 끊김
          </span>
        ) : null}
      </header>
      <strong className="plot-canvas-node__title">{display.title}</strong>
      {display.subtitle ? (
        <span className="plot-canvas-node__subtitle">{display.subtitle}</span>
      ) : null}
      {display.description ? (
        <p className="plot-canvas-node__description">{display.description}</p>
      ) : null}
      {display.badge ? (
        <span className="plot-canvas-node__badge">{display.badge}</span>
      ) : null}
      {edgeHandles()}
    </article>
  );
}
