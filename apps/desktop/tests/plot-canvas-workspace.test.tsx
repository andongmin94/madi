import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef, StrictMode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reactFlowControl = vi.hoisted(() => ({
  renderCount: 0,
  nodeArrays: [] as unknown[],
  edgeArrays: [] as unknown[],
  reconciliationCalls: 0,
  emitTransientSelectionReplay: false,
  transientSelectionReplayEmitted: false
}));

vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  const passthrough = ({ children }: { children?: React.ReactNode }) => children;
  const ReactFlow = ({
    nodes,
    edges,
    children,
    onInit,
    onNodeClick,
    onEdgeClick,
    onNodesChange,
    onEdgesChange,
    onNodeDragStop,
    onConnect,
    onMoveEnd
  }: {
    nodes: readonly any[];
    edges: readonly any[];
    children?: React.ReactNode;
    onInit?: (instance: unknown) => void;
    onNodeClick?: (event: unknown, node: any) => void;
    onEdgeClick?: (event: unknown, edge: any) => void;
    onNodesChange?: (changes: readonly any[]) => void;
    onEdgesChange?: (changes: readonly any[]) => void;
    onNodeDragStop?: () => void;
    onConnect?: (connection: any) => void;
    onMoveEnd?: (event: unknown, viewport: { x: number; y: number; zoom: number }) => void;
  }) => {
    const replayNodeIdRef = React.useRef<string | null>(null);
    const [selectionReplayPhase, setSelectionReplayPhase] = React.useState(0);
    reactFlowControl.renderCount += 1;
    reactFlowControl.nodeArrays.push(nodes);
    reactFlowControl.edgeArrays.push(edges);
    React.useEffect(() => {
      onInit?.({
        fitView: async () => true,
        setViewport: async () => true,
        setCenter: async () => true
      });
    }, [onInit]);
    React.useEffect(() => {
      const selectedNode = nodes.find((node) => node.selected);
      if (
        reactFlowControl.emitTransientSelectionReplay &&
        !reactFlowControl.transientSelectionReplayEmitted &&
        selectedNode
      ) {
        reactFlowControl.transientSelectionReplayEmitted = true;
        replayNodeIdRef.current = selectedNode.id;
        onNodesChange?.([
          { id: selectedNode.id, type: "select", selected: false }
        ]);
        setSelectionReplayPhase(1);
      }
    }, [nodes, onNodesChange]);
    React.useEffect(() => {
      if (selectionReplayPhase !== 1 || !replayNodeIdRef.current) {
        return;
      }
      onNodesChange?.([
        { id: replayNodeIdRef.current, type: "select", selected: true }
      ]);
      setSelectionReplayPhase(2);
    }, [onNodesChange, selectionReplayPhase]);
    React.useEffect(() => {
      const restoredChild = nodes.find(
        (node) => node.id === "restored-child" && node.selected
      );
      if (!restoredChild) {
        return;
      }
      reactFlowControl.reconciliationCalls += 1;
      onNodesChange?.([
        {
          id: restoredChild.id,
          type: "position",
          position: {
            x: restoredChild.position.x + 1,
            y: restoredChild.position.y + 1
          }
        },
        {
          id: restoredChild.id,
          type: "dimensions",
          dimensions: {
            width: Number(restoredChild.style?.width ?? 240) + 1,
            height: Number(restoredChild.style?.height ?? 150) + 1
          },
          setAttributes: true
        }
      ]);
    }, [nodes, onNodesChange]);
    const renderedNodes = nodes.length > 50 ? nodes.slice(0, 2) : nodes;
    const renderedEdges = edges.length > 50 ? edges.slice(0, 2) : edges;
    return React.createElement(
      "div",
      { "data-testid": "mock-react-flow" },
      ...renderedNodes.map((node) =>
        React.createElement(
          "button",
          {
            key: node.id,
            type: "button",
            "data-testid": `flow-node-${node.id}`,
            onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
              const modifier = event.ctrlKey || event.metaKey;
              const current = nodes
                .filter((candidate) => candidate.selected)
                .map((candidate) => candidate.id);
              const nextIds = modifier
                ? current.includes(node.id)
                  ? current.filter((id) => id !== node.id)
                  : [...current, node.id]
                : [node.id];
              onNodesChange?.(
                nodes.flatMap((candidate) =>
                  Boolean(candidate.selected) !== nextIds.includes(candidate.id)
                    ? [
                        {
                          id: candidate.id,
                          type: "select",
                          selected: nextIds.includes(candidate.id)
                        }
                      ]
                    : []
                )
              );
              if (!modifier) {
                onEdgesChange?.(
                  edges
                    .filter((candidate) => candidate.selected)
                    .map((candidate) => ({
                      id: candidate.id,
                      type: "select",
                      selected: false
                    }))
                );
              }
              onNodeClick?.(event, node);
            }
          },
          node.data.display.title
        )
      ),
      ...renderedEdges.map((edge) =>
        React.createElement(
          "button",
          {
            key: edge.id,
            type: "button",
            "data-testid": `flow-edge-${edge.id}`,
            onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
              const modifier = event.ctrlKey || event.metaKey;
              const current = edges
                .filter((candidate) => candidate.selected)
                .map((candidate) => candidate.id);
              const nextIds = modifier
                ? current.includes(edge.id)
                  ? current.filter((id) => id !== edge.id)
                  : [...current, edge.id]
                : [edge.id];
              onEdgesChange?.(
                edges.flatMap((candidate) =>
                  Boolean(candidate.selected) !== nextIds.includes(candidate.id)
                    ? [
                        {
                          id: candidate.id,
                          type: "select",
                          selected: nextIds.includes(candidate.id)
                        }
                      ]
                    : []
                )
              );
              if (!modifier) {
                onNodesChange?.(
                  nodes
                    .filter((candidate) => candidate.selected)
                    .map((candidate) => ({
                      id: candidate.id,
                      type: "select",
                      selected: false
                    }))
                );
              }
              onEdgeClick?.(event, edge);
            }
          },
          edge.label || edge.id
        )
      ),
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            if (nodes[0]) {
              onNodesChange?.([
                {
                  id: nodes[0].id,
                  type: "position",
                  dragging: true,
                  position: { x: 111, y: 222 }
                }
              ]);
              onNodeDragStop?.();
            }
          }
        },
        "mock drag"
      ),
      ...[300, 400].map((width, index) =>
        React.createElement(
          "button",
          {
            key: `mock-resize-${width}`,
            type: "button",
            onClick: () => {
              if (nodes[0]) {
                onNodesChange?.([
                  {
                    id: nodes[0].id,
                    type: "dimensions",
                    resizing: true,
                    dimensions: { width, height: 200 + index * 20 }
                  }
                ]);
                const onResizeEnd = nodes[0].data.onResizeEnd;
                if (typeof onResizeEnd === "function") {
                  onResizeEnd();
                }
              }
            }
          },
          `mock resize ${index + 1}`
        )
      ),
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            if (nodes[0]) {
              onNodesChange?.([
                {
                  id: nodes[0].id,
                  type: "position",
                  position: { x: 50, y: 60 }
                },
                {
                  id: nodes[0].id,
                  type: "dimensions",
                  resizing: true,
                  dimensions: { width: 320, height: 210 }
                }
              ]);
              const onResizeEnd = nodes[0].data.onResizeEnd;
              if (typeof onResizeEnd === "function") {
                onResizeEnd();
              }
            }
          }
        },
        "mock left top resize"
      ),
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            const nextIds = nodes.slice(0, 2).map((node) => node.id);
            onNodesChange?.(
              nodes.flatMap((node) =>
                Boolean(node.selected) !== nextIds.includes(node.id)
                  ? [
                      {
                        id: node.id,
                        type: "select",
                        selected: nextIds.includes(node.id)
                      }
                    ]
                  : []
              )
            );
            onEdgesChange?.(
              edges
                .filter((edge) => edge.selected)
                .map((edge) => ({ id: edge.id, type: "select", selected: false }))
            );
          }
        },
        "mock multi select"
      ),
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () =>
            nodes.length >= 2 &&
            onConnect?.({
              source: nodes[0].id,
              target: nodes[1].id,
              sourceHandle: "source-right",
              targetHandle: "target-left"
            })
        },
        "mock connect"
      ),
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () => onMoveEnd?.({}, { x: 30, y: 40, zoom: 1.2 })
        },
        "mock viewport"
      ),
      children
    );
  };
  return {
    ReactFlow,
    ReactFlowProvider: passthrough,
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
    Handle: () => null,
    NodeResizer: () => null,
    BackgroundVariant: { Dots: "dots" },
    MarkerType: { ArrowClosed: "arrowclosed" },
    Position: { Top: "top", Right: "right", Bottom: "bottom", Left: "left" }
  };
});

import {
  PlotCanvasWorkspace,
  type PlotCanvasWorkspaceHandle,
  type PlotCanvasWorkspaceProps
} from "../src/renderer/components/plotCanvas/PlotCanvasWorkspace";
import type {
  CanvasEntityReference,
  CanvasSceneReference,
  MadiCanvasDocument,
  MadiCanvasUiState
} from "../src/renderer/components/plotCanvas/types";

const entity: CanvasEntityReference = {
  id: "entity-leia",
  name: "레이아",
  kind: "CHARACTER",
  status: "ACTIVE",
  summary: "북부 출신 마법사",
  colorToken: "#4263eb",
  aliases: ["북부의 마법사"],
  tags: ["주요 인물", "북부"],
  relationCount: 4
};

const scene: CanvasSceneReference = {
  id: "scene-1",
  episodeTitle: "1화 귀환",
  sceneTitle: "성문 앞",
  recoveryFirstSentence: "레이아가 돌아왔다.",
  characterCount: 890,
  hasSceneBreak: false
};

const initialDocument: MadiCanvasDocument = {
  nodes: [
    {
      id: "text-1",
      type: "text",
      x: 10,
      y: 20,
      width: 260,
      height: 140,
      text: "첫 번째 메모",
      madi: { nodeKind: "TEXT" }
    },
    {
      id: "entity-1",
      type: "text",
      x: 360,
      y: 20,
      width: 280,
      height: 160,
      text: "레이아",
      madi: {
        nodeKind: "ENTITY_REFERENCE",
        entityId: entity.id,
        originalLabel: entity.name
      }
    }
  ],
  edges: [
    {
      id: "edge-1",
      fromNode: "text-1",
      toNode: "entity-1",
      fromEnd: "none",
      toEnd: "arrow",
      label: "만남",
      madi: { lineStyle: "SOLID" }
    }
  ]
};

function props(overrides: Partial<PlotCanvasWorkspaceProps> = {}): PlotCanvasWorkspaceProps {
  return {
    canvasId: "canvas-1",
    document: initialDocument,
    catalog: { entities: [entity], scenes: [scene] },
    onSave: async (request) => ({
      canvasId: request.canvasId,
      generation: request.generation,
      saveSequence: request.saveSequence
    }),
    ...overrides
  };
}

function openAccessibleList() {
  fireEvent.click(screen.getByText("키보드용 노드·연결선 목록"));
  return screen.getByRole("region", { name: "캔버스 노드 목록" });
}

beforeEach(() => {
  reactFlowControl.renderCount = 0;
  reactFlowControl.nodeArrays = [];
  reactFlowControl.edgeArrays = [];
  reactFlowControl.reconciliationCalls = 0;
  reactFlowControl.emitTransientSelectionReplay = false;
  reactFlowControl.transientSelectionReplayEmitted = false;
});

describe("PlotCanvasWorkspace", () => {
  it("stabilizes controlled React Flow inputs and ignores equivalent callback echoes", async () => {
    const onUiStateChange = vi.fn();
    render(<PlotCanvasWorkspace {...props({ onUiStateChange })} />);

    await waitFor(() => expect(reactFlowControl.renderCount).toBeGreaterThan(0));
    expect(reactFlowControl.renderCount).toBeLessThan(5);
    expect(new Set(reactFlowControl.nodeArrays).size).toBe(1);
    expect(new Set(reactFlowControl.edgeArrays).size).toBe(1);
    expect(onUiStateChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "mock viewport" }));
    fireEvent.click(screen.getByRole("button", { name: "mock viewport" }));
    await waitFor(() => expect(onUiStateChange).toHaveBeenCalledTimes(1));
    expect(new Set(reactFlowControl.nodeArrays).size).toBe(1);
    expect(new Set(reactFlowControl.edgeArrays).size).toBe(1);
  });

  it("reuses unchanged React Flow elements across a controlled position echo", async () => {
    render(<PlotCanvasWorkspace {...props()} />);
    await waitFor(() => expect(reactFlowControl.nodeArrays.length).toBeGreaterThan(0));
    const beforeNodes = reactFlowControl.nodeArrays.at(-1) as readonly any[];
    const beforeEdges = reactFlowControl.edgeArrays.at(-1) as readonly any[];
    const beforeText = beforeNodes.find((node) => node.id === "text-1");
    const beforeEntity = beforeNodes.find((node) => node.id === "entity-1");
    const beforeEdge = beforeEdges.find((edge) => edge.id === "edge-1");

    fireEvent.click(screen.getByRole("button", { name: "mock drag" }));
    await waitFor(() => {
      const latest = reactFlowControl.nodeArrays.at(-1) as readonly any[];
      expect(latest.find((node) => node.id === "text-1")?.position).toEqual({
        x: 111,
        y: 222
      });
    });

    const afterNodes = reactFlowControl.nodeArrays.at(-1) as readonly any[];
    const afterEdges = reactFlowControl.edgeArrays.at(-1) as readonly any[];
    const afterText = afterNodes.find((node) => node.id === "text-1");
    expect(afterText).not.toBe(beforeText);
    expect(afterText).toMatchObject({
      width: 260,
      height: 140,
      measured: { width: 260, height: 140 }
    });
    expect(afterNodes.find((node) => node.id === "entity-1")).toBe(beforeEntity);
    expect(afterEdges.find((edge) => edge.id === "edge-1")).toBe(beforeEdge);
  });

  it("edits nodes and edges through the accessible list and inspector", async () => {
    const onDocumentChange = vi.fn();
    render(<PlotCanvasWorkspace {...props({ onDocumentChange })} />);
    const list = openAccessibleList();
    fireEvent.click(within(list).getByRole("button", { name: "첫 번째 메모 · TEXT" }));
    const inspector = screen.getByTestId("plot-canvas-inspector");
    fireEvent.change(within(inspector).getByRole("textbox", { name: "텍스트" }), {
      target: { value: "수정된 메모" }
    });
    expect(onDocumentChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        nodes: expect.arrayContaining([expect.objectContaining({ text: "수정된 메모" })])
      })
    );
    fireEvent.change(within(inspector).getByRole("spinbutton", { name: "너비" }), {
      target: { value: "100000.8" }
    });
    fireEvent.change(within(inspector).getByRole("spinbutton", { name: "높이" }), {
      target: { value: "-8.3" }
    });
    expect(onDocumentChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({ width: 100_000, height: 1 })
        ])
      })
    );

    fireEvent.click(screen.getByTestId("flow-edge-edge-1"));
    expect(within(inspector).getByText(/공식 관계와는 별개/)).toBeTruthy();
    fireEvent.change(within(inspector).getByRole("textbox", { name: "Label" }), {
      target: { value: "결심" }
    });
    fireEvent.change(within(inspector).getByRole("combobox", { name: "화살표" }), {
      target: { value: "BOTH" }
    });
    expect(onDocumentChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        edges: [expect.objectContaining({ fromEnd: "arrow", toEnd: "arrow" })]
      })
    );
  });

  it("keeps normal node and edge inspection while selection change owns Ctrl multi-select", async () => {
    render(<PlotCanvasWorkspace {...props()} />);
    const inspector = screen.getByTestId("plot-canvas-inspector");

    fireEvent.click(screen.getByTestId("flow-node-text-1"));
    expect(
      (within(inspector).getByRole("textbox", {
        name: "텍스트"
      }) as HTMLTextAreaElement).value
    ).toBe("첫 번째 메모");

    fireEvent.click(screen.getByTestId("flow-edge-edge-1"));
    expect(
      (within(inspector).getByRole("textbox", {
        name: "Label"
      }) as HTMLInputElement).value
    ).toBe("만남");

    fireEvent.click(screen.getByTestId("flow-node-text-1"));
    fireEvent.click(screen.getByTestId("flow-node-entity-1"), {
      ctrlKey: true
    });
    await waitFor(() => {
      const latest = reactFlowControl.nodeArrays.at(-1) as readonly {
        readonly id: string;
        readonly selected?: boolean;
      }[];
      expect(
        latest
          .filter((node) => node.selected)
          .map((node) => node.id)
          .sort()
      ).toEqual(["entity-1", "text-1"]);
    });
  });

  it("supports drag, multi-select, connect, duplicate, delete and session undo/redo", async () => {
    render(<PlotCanvasWorkspace {...props()} />);
    const workspace = screen.getByTestId("plot-canvas-workspace");
    fireEvent.click(screen.getByRole("button", { name: "mock drag" }));
    expect(screen.getByTestId("flow-node-text-1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "mock multi select" }));
    fireEvent.keyDown(workspace, { key: "d", ctrlKey: true });
    await waitFor(() => expect(workspace.dataset.nodeCount).toBe("4"));
    fireEvent.keyDown(workspace, { key: "z", ctrlKey: true });
    await waitFor(() => expect(workspace.dataset.nodeCount).toBe("2"));
    fireEvent.keyDown(workspace, { key: "y", ctrlKey: true });
    await waitFor(() => expect(workspace.dataset.nodeCount).toBe("4"));
    fireEvent.click(screen.getByRole("button", { name: "mock connect" }));
    await waitFor(() => expect(Number(workspace.dataset.edgeCount)).toBeGreaterThan(1));
    fireEvent.click(screen.getByTestId("flow-node-text-1"));
    fireEvent.keyDown(workspace, { key: "Delete" });
    await waitFor(() => expect(Number(workspace.dataset.nodeCount)).toBeLessThan(4));
  });

  it("ends resize coalescing after each gesture so Undo reverts only the latest resize", async () => {
    render(<PlotCanvasWorkspace {...props()} />);
    const latestWidth = () => {
      const nodes = reactFlowControl.nodeArrays.at(-1) as readonly {
        readonly id: string;
        readonly style?: { readonly width?: number };
      }[];
      return nodes.find((node) => node.id === "text-1")?.style?.width;
    };

    fireEvent.click(screen.getByRole("button", { name: "mock resize 1" }));
    await waitFor(() => expect(latestWidth()).toBe(300));
    fireEvent.click(screen.getByRole("button", { name: "mock resize 2" }));
    await waitFor(() => expect(latestWidth()).toBe(400));

    fireEvent.click(screen.getByRole("button", { name: "실행 취소" }));
    await waitFor(() => expect(latestWidth()).toBe(300));
  });

  it("ignores React Flow mount reconciliation for a restored selected grouped child", async () => {
    const groupedDocument: MadiCanvasDocument = {
      nodes: [
        {
          id: "restored-group",
          type: "group",
          x: 0,
          y: 0,
          width: 1_250,
          height: 900,
          label: "복원 그룹",
          madi: { nodeKind: "GROUP" }
        },
        {
          id: "restored-child",
          type: "text",
          x: 100,
          y: 75,
          width: 240,
          height: 150,
          text: "복원 선택 노드",
          madi: { nodeKind: "TEXT", parentGroupId: "restored-group" }
        }
      ],
      edges: []
    };
    const onDocumentChange = vi.fn();
    const onParentUiStateChange = vi.fn();
    const restoredUiState = {
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedElementId: "restored-child",
      inspectorWidth: 320,
      showGrid: true,
      showMinimap: false,
      snapToGrid: false
    } as const;
    reactFlowControl.emitTransientSelectionReplay = true;
    function ConcurrentParent() {
      const [savedUiState, setSavedUiState] =
        useState<MadiCanvasUiState>(restoredUiState);
      return (
        <PlotCanvasWorkspace
          {...props({
            document: groupedDocument,
            initialUiState: savedUiState,
            onDocumentChange,
            onUiStateChange: (next) => {
              onParentUiStateChange(next);
              setSavedUiState(next);
            }
          })}
        />
      );
    }
    render(
      <StrictMode>
        <ConcurrentParent />
      </StrictMode>
    );

    await waitFor(() =>
      expect(reactFlowControl.reconciliationCalls).toBeGreaterThan(0)
    );
    expect(onDocumentChange).not.toHaveBeenCalled();
    expect(reactFlowControl.renderCount).toBeLessThan(12);
    expect(onParentUiStateChange).toHaveBeenCalled();
    const child = (reactFlowControl.nodeArrays.at(-1) as readonly any[]).find(
      (node) => node.id === "restored-child"
    );
    expect(child).toMatchObject({
      position: { x: 100, y: 75 },
      selected: true,
      style: { width: 240, height: 150 }
    });
    const uiChangeCount = onParentUiStateChange.mock.calls.length;
    fireEvent.click(screen.getByTestId("flow-node-restored-child"));
    expect(onParentUiStateChange).toHaveBeenCalledTimes(uiChangeCount);
  });

  it("keeps the anchor position emitted in the same batch as a left/top resize", () => {
    const onDocumentChange = vi.fn();
    render(<PlotCanvasWorkspace {...props({ onDocumentChange })} />);

    fireEvent.click(
      screen.getByRole("button", { name: "mock left top resize" })
    );
    expect(onDocumentChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: "text-1",
            x: 50,
            y: 60,
            width: 320,
            height: 210
          })
        ])
      })
    );
  });

  it("finds local aliases/tags and adds a node with the Ctrl+K keyboard flow", async () => {
    const onDocumentChange = vi.fn();
    render(<PlotCanvasWorkspace {...props({ onDocumentChange })} />);
    const workspace = screen.getByTestId("plot-canvas-workspace");
    fireEvent.keyDown(workspace, { key: "k", ctrlKey: true });
    const search = screen.getByRole("searchbox", {
      name: "설정, 장면 또는 텍스트 검색"
    });
    fireEvent.change(search, { target: { value: "북부" } });
    expect(screen.getByRole("option", { name: /레이아/ })).toBeTruthy();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() =>
      expect(onDocumentChange).toHaveBeenCalledWith(
        expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({
              madi: expect.objectContaining({
                nodeKind: "ENTITY_REFERENCE",
                entityId: entity.id
              })
            })
          ])
        })
      )
    );
  });

  it("debounces and merges optional canonical entity search results", async () => {
    vi.useFakeTimers();
    const remote: CanvasEntityReference = {
      ...entity,
      id: "entity-remote",
      name: "검색된 인물",
      aliases: []
    };
    const onSearchEntities = vi.fn(async () => [remote]);
    render(
      <PlotCanvasWorkspace
        {...props({
          catalog: { entities: [], scenes: [] },
          onSearchEntities
        })}
      />
    );
    fireEvent.keyDown(screen.getByTestId("plot-canvas-workspace"), {
      key: "k",
      ctrlKey: true
    });
    const search = screen.getByRole("searchbox", {
      name: "설정, 장면 또는 텍스트 검색"
    });
    fireEvent.change(search, { target: { value: "검색" } });
    await vi.advanceTimersByTimeAsync(179);
    expect(onSearchEntities).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();
    expect(onSearchEntities).toHaveBeenCalledWith("검색");
    expect(screen.getByRole("option", { name: /검색된 인물/ })).toBeTruthy();
    vi.useRealTimers();
  });

  it("searches existing canvas text nodes and restores their inspector selection", () => {
    const onUiStateChange = vi.fn();
    render(<PlotCanvasWorkspace {...props({ onUiStateChange })} />);
    fireEvent.keyDown(screen.getByTestId("plot-canvas-workspace"), {
      key: "k",
      ctrlKey: true
    });
    fireEvent.change(
      screen.getByRole("searchbox", { name: "설정, 장면 또는 텍스트 검색" }),
      { target: { value: "첫 번째" } }
    );
    fireEvent.click(screen.getByRole("option", { name: /캔버스 메모로 이동.*첫 번째/ }));
    const textEditor =
      within(screen.getByTestId("plot-canvas-inspector")).getByRole("textbox", {
        name: "텍스트"
      });
    expect((textEditor as HTMLTextAreaElement).value).toBe("첫 번째 메모");
    expect(onUiStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectedElementId: "text-1" })
    );
  });

  it("resolves renamed reference metadata dynamically without mutating the canvas document", () => {
    const onDocumentChange = vi.fn();
    const rendered = render(
      <PlotCanvasWorkspace {...props({ onDocumentChange })} />
    );
    const list = openAccessibleList();
    const originalEntityRuntime = (
      reactFlowControl.nodeArrays.at(-1) as readonly any[]
    ).find((node) => node.id === "entity-1");
    const latestEntityDisplay = () => {
      const nodes = reactFlowControl.nodeArrays.at(-1) as readonly {
        readonly id: string;
        readonly data: {
          readonly display: {
            readonly title: string;
            readonly subtitle: string | null;
            readonly broken: boolean;
          };
        };
      }[];
      return nodes.find((node) => node.id === "entity-1")?.data.display;
    };
    const renamed = {
      ...entity,
      name: "장군 레이아",
      kind: "LOCATION",
      status: "ARCHIVED"
    };
    rendered.rerender(
      <PlotCanvasWorkspace
        {...props({
          catalog: { entities: [renamed], scenes: [scene] },
          onDocumentChange
        })}
      />
    );
    fireEvent.click(
      within(list).getByRole("button", {
        name: "장군 레이아 · ENTITY_REFERENCE"
      })
    );
    expect(latestEntityDisplay()).toMatchObject({
      title: "장군 레이아",
      subtitle: "LOCATION · ARCHIVED",
      broken: false
    });
    expect(
      (reactFlowControl.nodeArrays.at(-1) as readonly any[]).find(
        (node) => node.id === "entity-1"
      )
    ).not.toBe(originalEntityRuntime);
    expect(onDocumentChange).not.toHaveBeenCalled();

    rendered.rerender(
      <PlotCanvasWorkspace
        {...props({
          catalog: { entities: [], scenes: [scene] },
          onDocumentChange
        })}
      />
    );
    expect(
      within(list).getByRole("button", {
        name: "삭제된 설정 · ENTITY_REFERENCE · 연결 끊김"
      })
    ).toBeTruthy();
    expect(screen.getByTestId("plot-canvas-workspace").dataset.nodeCount).toBe(
      "2"
    );
    expect(latestEntityDisplay()).toMatchObject({
      title: "삭제된 설정",
      subtitle: "원래 이름: 레이아",
      broken: true
    });
    expect(onDocumentChange).not.toHaveBeenCalled();
  });

  it("keeps session history when a save advances only the external revision", async () => {
    let latest = initialDocument;
    const rendered = render(
      <PlotCanvasWorkspace
        {...props({
          documentVersion: 1,
          onDocumentChange: (document) => {
            latest = document;
          }
        })}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "텍스트" }));
    expect(screen.getByTestId("plot-canvas-workspace").dataset.nodeCount).toBe("3");
    rendered.rerender(
      <PlotCanvasWorkspace
        {...props({
          document: latest,
          documentVersion: 2,
          onDocumentChange: (document) => {
            latest = document;
          }
        })}
      />
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "실행 취소" }).hasAttribute("disabled")
      ).toBe(false)
    );
    fireEvent.click(screen.getByRole("button", { name: "실행 취소" }));
    await waitFor(() =>
      expect(screen.getByTestId("plot-canvas-workspace").dataset.nodeCount).toBe("2")
    );
  });

  it("exposes DTO-only addPickerItem and flush methods for Story/Graph integration", async () => {
    const workspaceRef = createRef<PlotCanvasWorkspaceHandle>();
    const onDocumentChange = vi.fn();
    const onSave = vi.fn(async (request) => ({
      canvasId: request.canvasId,
      generation: request.generation,
      saveSequence: request.saveSequence
    }));
    render(
      <PlotCanvasWorkspace
        ref={workspaceRef}
        {...props({ onDocumentChange, onSave })}
      />
    );
    workspaceRef.current!.addPickerItem({ kind: "ENTITY_REFERENCE", entity });
    expect(onDocumentChange).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({ madi: expect.objectContaining({ entityId: entity.id }) })
        ])
      })
    );
    await workspaceRef.current!.flush();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ canvasId: "canvas-1", document: expect.any(Object) })
    );
    expect("nodes" in workspaceRef.current!.getDocument()).toBe(true);
  });

  it("navigates healthy references and preserves/relinks broken references", () => {
    const onOpenEntity = vi.fn();
    const brokenDocument: MadiCanvasDocument = {
      nodes: [
        {
          id: "broken",
          type: "text",
          x: 0,
          y: 0,
          width: 260,
          height: 140,
          text: "사라진 인물",
          madi: {
            nodeKind: "ENTITY_REFERENCE",
            entityId: "deleted",
            originalLabel: "사라진 인물"
          }
        }
      ],
      edges: []
    };
    const onDocumentChange = vi.fn();
    render(
      <PlotCanvasWorkspace
        {...props({ document: brokenDocument, onDocumentChange, onOpenEntity })}
      />
    );
    fireEvent.click(screen.getByTestId("flow-node-broken"));
    expect(screen.getByText("원래 이름: 사라진 인물")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "다시 연결할 설정" }), {
      target: { value: entity.id }
    });
    expect(onDocumentChange).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: [expect.objectContaining({ madi: expect.objectContaining({ entityId: entity.id }) })]
      })
    );
  });

  it("reports inspector width and viewport controls as project UI state", () => {
    const onUiStateChange = vi.fn();
    render(<PlotCanvasWorkspace {...props({ onUiStateChange })} />);
    fireEvent.change(screen.getByRole("slider", { name: "상세 패널 너비" }), {
      target: { value: "410" }
    });
    fireEvent.click(screen.getByRole("button", { name: "mock viewport" }));
    expect(onUiStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        inspectorWidth: 410,
        viewport: { x: 30, y: 40, zoom: 1.2 }
      })
    );
  });

  it("shows accessible errors and leaves a 500-node/1000-edge canvas unchanged at capacity", () => {
    const nodes = Array.from({ length: 500 }, (_, index) => ({
      id: `limit-node-${index}`,
      type: "text" as const,
      x: index,
      y: 0,
      width: 180,
      height: 100,
      text: `노드 ${index}`,
      madi: { nodeKind: "TEXT" as const }
    }));
    const edges = Array.from({ length: 1_000 }, (_, index) => ({
      id: `limit-edge-${index}`,
      fromNode: "limit-node-0",
      toNode: "limit-node-1",
      fromEnd: "none" as const,
      toEnd: "arrow" as const
    }));
    const onDocumentChange = vi.fn();
    render(
      <PlotCanvasWorkspace
        {...props({ document: { nodes, edges }, onDocumentChange })}
      />
    );
    const workspace = screen.getByTestId("plot-canvas-workspace");

    fireEvent.click(screen.getByRole("button", { name: /^텍스트$/u }));
    expect(screen.getByRole("alert").textContent).toContain("최대 500개");
    expect(workspace.dataset.nodeCount).toBe("500");
    expect(onDocumentChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "mock connect" }));
    expect(screen.getByRole("alert").textContent).toContain("최대 1000개");
    expect(workspace.dataset.edgeCount).toBe("1000");
    expect(onDocumentChange).not.toHaveBeenCalled();
  }, 10_000);
});
