import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@xyflow/react", () => ({
  Handle: ({ id, type }: { id: string; type: string }) => (
    <span data-testid={`handle-${id}`} data-handle-type={type} />
  ),
  NodeResizer: () => null,
  Position: {
    Top: "top",
    Right: "right",
    Bottom: "bottom",
    Left: "left"
  },
  MarkerType: { ArrowClosed: "arrowclosed" }
}));

import { PlotCanvasNode } from "../src/renderer/components/plotCanvas/PlotCanvasNode";
import { ReactFlowAdapter } from "../src/renderer/components/plotCanvas/reactFlowAdapter";
import type {
  CanvasReferenceDisplay,
  MadiCanvasDocument
} from "../src/renderer/components/plotCanvas/types";

const document: MadiCanvasDocument = {
  nodes: [
    {
      id: "group-1",
      type: "group",
      x: 20,
      y: 30,
      width: 520,
      height: 360,
      label: "1부",
      madi: { nodeKind: "GROUP" }
    },
    {
      id: "text-1",
      type: "text",
      x: 640,
      y: 80,
      width: 240,
      height: 140,
      text: "결말",
      madi: { nodeKind: "TEXT" }
    }
  ],
  edges: [
    {
      id: "edge-group-text",
      fromNode: "group-1",
      fromSide: "right",
      fromEnd: "none",
      toNode: "text-1",
      toSide: "left",
      toEnd: "arrow",
      label: "부에서 결말로"
    }
  ]
};

const groupDisplay: CanvasReferenceDisplay = {
  kind: "GROUP",
  title: "1부",
  subtitle: null,
  description: null,
  badge: null,
  color: null,
  broken: false,
  referenceId: null
};

describe("Plot Canvas group edge endpoint", () => {
  it("renders group handles and round-trips a canonical group edge", () => {
    render(
      <PlotCanvasNode
        id="group-1"
        data={{ canonicalNode: document.nodes[0], display: groupDisplay }}
      />
    );
    expect(screen.getAllByTestId(/^handle-/u)).toHaveLength(8);
    expect(screen.getByTestId("handle-source-right").dataset.handleType).toBe(
      "source"
    );
    expect(screen.getByTestId("handle-target-left").dataset.handleType).toBe(
      "target"
    );

    const runtime = ReactFlowAdapter.toReactFlow(
      document,
      { entities: [], scenes: [] },
      null
    );
    expect(runtime.nodes.find((node) => node.id === "group-1")?.connectable).toBe(
      true
    );
    expect(runtime.edges[0]).toMatchObject({
      source: "group-1",
      sourceHandle: "source-right",
      target: "text-1",
      targetHandle: "target-left"
    });
    expect(ReactFlowAdapter.fromReactFlow(runtime, document)).toEqual(document);
  });
});
