import { act, cleanup, render } from "@testing-library/react";
import type { Core, CytoscapeOptions } from "cytoscape";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorldGraphCanvas,
  type WorldGraphCanvasProps
} from "../src/renderer/components/worldGraph/WorldGraphCanvas";
import type { FilteredWorldGraph } from "../src/renderer/components/worldGraph/types";

const { createdCores } = vi.hoisted(() => ({ createdCores: [] as Core[] }));

vi.mock("cytoscape", async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof import("cytoscape") }>();
  return {
    ...actual,
    default: (options: CytoscapeOptions) => {
      // Enable the pinned library's real animation loop in its headless renderer.
      const cy = actual.default({ ...options, styleEnabled: true });
      createdCores.push(cy);
      return cy;
    }
  };
});

const graph: FilteredWorldGraph = {
  projectId: "project-a",
  revision: 1,
  nodes: [
    {
      id: "entity-a",
      projectId: "project-a",
      label: "설정",
      kind: "CHARACTER",
      status: "ACTIVE",
      summary: null,
      colorToken: null,
      iconKey: null,
      aliases: [],
      tags: [],
      explicitSceneLinkCount: 0,
      outgoingRelationCount: 0,
      incomingRelationCount: 0,
      undirectedRelationCount: 0
    }
  ],
  edges: [],
  diagnostics: [],
  renderDiagnostics: []
};

function props(): WorldGraphCanvasProps {
  return {
    graph,
    selection: null,
    showLabels: false,
    centerEntityId: null,
    centerRequest: 0,
    centerRequestStartedAt: null,
    nodePositions: { "entity-a": { x: 20, y: 30 } },
    viewport: { zoom: 1, pan: { x: 10, y: 15 } },
    autoLayoutRequest: 0,
    onSelectionChange: vi.fn(),
    onOpenEntity: vi.fn(),
    onNodePositionChange: vi.fn(),
    onViewportChange: vi.fn()
  };
}

let frames: Map<number, FrameRequestCallback>;
let nextFrameId: number;

function frame(timestamp: number): void {
  const pending = [...frames.values()];
  frames.clear();
  act(() => {
    for (const callback of pending) callback(timestamp);
  });
}

beforeEach(() => {
  frames = new Map();
  nextFrameId = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = ++nextFrameId;
    frames.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
});

afterEach(() => {
  cleanup();
  createdCores.length = 0;
});

describe("World Graph viewport ownership", () => {
  it("preserves real local animation through structurally equal viewport echoes", () => {
    const initial = props();
    const rendered = render(<WorldGraphCanvas {...initial} />);
    const cy = createdCores[0];
    frame(0);
    act(() => {
      cy.animate({ pan: { x: 100, y: 120 }, duration: 180 });
    });
    frame(100);
    frame(190);
    const animatedPan = { ...cy.pan() };
    expect(cy.animated()).toBe(true);
    expect(animatedPan).not.toEqual(initial.viewport!.pan);

    const equalViewport = () => ({ zoom: 1, pan: { x: 10, y: 15 } });
    rendered.rerender(<WorldGraphCanvas {...initial} viewport={equalViewport()} />);
    expect(cy.pan()).toEqual(animatedPan);
    frame(280);
    expect(cy.animated()).toBe(false);
    expect(cy.pan()).toEqual({ x: 100, y: 120 });
    rendered.rerender(<WorldGraphCanvas {...initial} viewport={equalViewport()} />);
    expect(cy.pan()).toEqual({ x: 100, y: 120 });
  });

  it("applies changed externally restored viewport values without relayout", () => {
    const initial = props();
    const rendered = render(<WorldGraphCanvas {...initial} />);
    const cy = createdCores[0];
    const layout = vi.spyOn(cy, "layout");
    rendered.rerender(
      <WorldGraphCanvas
        {...initial}
        viewport={{ zoom: 1.25, pan: { x: 12, y: -8 } }}
      />
    );
    expect(cy.zoom()).toBe(1.25);
    expect(cy.pan()).toEqual({ x: 12, y: -8 });
    expect(layout).not.toHaveBeenCalled();
  });
});
