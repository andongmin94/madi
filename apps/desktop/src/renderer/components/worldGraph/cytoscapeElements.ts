import type cytoscape from "cytoscape";
import type {
  FilteredWorldGraph,
  WorldGraphEdgeView,
  WorldGraphEntityKind,
  WorldGraphSelection
} from "./types";

const KIND_COLORS: Readonly<Record<WorldGraphEntityKind, string>> = {
  CHARACTER: "#4f7cac",
  LOCATION: "#3f8f72",
  ORGANIZATION: "#8a63a8",
  ITEM: "#a8723f",
  EVENT: "#bf5b60",
  WORLD_RULE: "#547789",
  FORESHADOWING: "#b48619",
  OTHER: "#6f7580"
};

const KIND_SHAPES: Readonly<
  Record<WorldGraphEntityKind, cytoscape.Css.Node["shape"]>
> = {
  CHARACTER: "ellipse",
  LOCATION: "round-rectangle",
  ORGANIZATION: "hexagon",
  ITEM: "diamond",
  EVENT: "ellipse",
  WORLD_RULE: "rectangle",
  FORESHADOWING: "star",
  OTHER: "octagon"
};

const NAMED_COLOR_TOKENS: Readonly<Record<string, string>> = {
  red: "#b94f55",
  orange: "#bd6e31",
  amber: "#b48619",
  yellow: "#a68a25",
  green: "#3f8f72",
  teal: "#328c8c",
  blue: "#4f7cac",
  indigo: "#5d62a8",
  violet: "#7656a8",
  purple: "#8a63a8",
  pink: "#b95f89",
  gray: "#6f7580",
  grey: "#6f7580"
};

export function resolveGraphColor(
  token: string | null,
  fallback: string
): string {
  if (!token) {
    return fallback;
  }
  const normalized = token.trim().toLocaleLowerCase("en-US");
  if (NAMED_COLOR_TOKENS[normalized]) {
    return NAMED_COLOR_TOKENS[normalized];
  }
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(
    normalized
  )
    ? normalized
    : fallback;
}

function truncatedLabel(label: string, maximum = 26): string {
  const codePoints = [...label];
  return codePoints.length > maximum
    ? `${codePoints.slice(0, maximum - 1).join("")}…`
    : label;
}

function neighborIds(
  graph: FilteredWorldGraph,
  selectedNodeId: string
): ReadonlySet<string> {
  const result = new Set([selectedNodeId]);
  for (const edge of graph.edges) {
    if (edge.sourceEntityId === selectedNodeId) {
      result.add(edge.targetEntityId);
    } else if (edge.targetEntityId === selectedNodeId) {
      result.add(edge.sourceEntityId);
    }
  }
  return result;
}

function degreeByNodeId(
  graph: FilteredWorldGraph
): ReadonlyMap<string, number> {
  const degrees = new Map<string, number>();
  for (const edge of graph.edges) {
    degrees.set(edge.sourceEntityId, (degrees.get(edge.sourceEntityId) ?? 0) + 1);
    degrees.set(edge.targetEntityId, (degrees.get(edge.targetEntityId) ?? 0) + 1);
  }
  return degrees;
}

function edgeClasses(
  edge: WorldGraphEdgeView,
  selection: WorldGraphSelection | null
): string {
  const classes = [edge.directed ? "directed" : "undirected"];
  if (!selection) {
    return classes.join(" ");
  }
  if (selection.kind === "EDGE") {
    classes.push(selection.id === edge.id ? "selected" : "dimmed");
  } else if (
    edge.sourceEntityId === selection.id ||
    edge.targetEntityId === selection.id
  ) {
    classes.push("connected");
  } else {
    classes.push("dimmed");
  }
  return classes.join(" ");
}

export function toCytoscapeElements(
  graph: FilteredWorldGraph,
  showLabels: boolean,
  selection: WorldGraphSelection | null
): cytoscape.ElementDefinition[] {
  const neighbors =
    selection?.kind === "NODE" ? neighborIds(graph, selection.id) : null;
  const selectedEdge =
    selection?.kind === "EDGE"
      ? graph.edges.find((edge) => edge.id === selection.id)
      : null;
  const selectedEndpoints = selectedEdge
    ? new Set([selectedEdge.sourceEntityId, selectedEdge.targetEntityId])
    : null;
  const degrees = degreeByNodeId(graph);
  return [
    ...graph.nodes.map((node): cytoscape.ElementDefinition => {
      const classes = [`kind-${node.kind.toLocaleLowerCase("en-US")}`];
      if (node.status === "ARCHIVED") {
        classes.push("archived");
      }
      if (selection?.kind === "NODE") {
        if (node.id === selection.id) {
          classes.push("selected");
        } else if (neighbors?.has(node.id)) {
          classes.push("neighbor");
        } else {
          classes.push("dimmed");
        }
      } else if (selection?.kind === "EDGE") {
        classes.push(selectedEndpoints?.has(node.id) ? "endpoint" : "dimmed");
      }
      const degree = degrees.get(node.id) ?? 0;
      const size = 38 + Math.min(10, Math.sqrt(degree) * 2.5);
      return {
        group: "nodes",
        data: {
          id: node.id,
          label: showLabels
            ? `${node.iconKey ? `${node.iconKey} ` : ""}${truncatedLabel(node.label)}`
            : "",
          fullLabel: node.label,
          kind: node.kind,
          shape: KIND_SHAPES[node.kind],
          color: resolveGraphColor(node.colorToken, KIND_COLORS[node.kind]),
          size,
          width: node.kind === "EVENT" ? size * 1.35 : size,
          height: node.kind === "EVENT" ? size * 0.78 : size
        },
        classes: classes.join(" ")
      };
    }),
    ...graph.edges.map((edge): cytoscape.ElementDefinition => ({
      group: "edges",
      data: {
        id: edge.id,
        source: edge.sourceEntityId,
        target: edge.targetEntityId,
        label: showLabels ? edge.forwardLabel : "",
        fullLabel: edge.forwardLabel,
        inverseLabel: edge.inverseLabel ?? "",
        relationTypeId: edge.relationTypeId,
        directed: edge.directed,
        lineColor: resolveGraphColor(edge.colorToken, "#748091"),
        targetArrowShape: edge.directed ? "triangle" : "none"
      },
      classes: edgeClasses(edge, selection)
    }))
  ];
}

export const WORLD_GRAPH_KIND_COLORS = KIND_COLORS;
export const WORLD_GRAPH_KIND_SHAPES = KIND_SHAPES;

export const WORLD_GRAPH_CYTOSCAPE_STYLES = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      shape: "data(shape)",
      width: "data(width)",
      height: "data(height)",
      "background-color": "data(color)",
      "border-color": "#f4f7fb",
      "border-width": 2,
      color: "#eef3f9",
      "font-size": 10,
      "font-family": "system-ui, sans-serif",
      "text-valign": "bottom",
      "text-margin-y": 8,
      "text-background-color": "#18202b",
      "text-background-opacity": 0.86,
      "text-background-padding": 3,
      "text-wrap": "ellipsis",
      "text-max-width": 150,
      "overlay-opacity": 0
    }
  },
  {
    selector: "node.archived",
    style: { opacity: 0.48, "border-style": "dashed" }
  },
  {
    selector: "edge",
    style: {
      width: 1.8,
      label: "data(label)",
      "line-color": "data(lineColor)",
      "target-arrow-color": "data(lineColor)",
      "target-arrow-shape": "data(targetArrowShape)",
      "curve-style": "bezier",
      color: "#cfd8e5",
      "font-size": 8,
      "min-zoomed-font-size": 7,
      "text-rotation": "autorotate",
      "text-background-color": "#18202b",
      "text-background-opacity": 0.8,
      "text-background-padding": 2,
      "overlay-opacity": 0
    }
  },
  {
    selector: "node.selected, node.endpoint",
    style: {
      "border-color": "#ffd166",
      "border-width": 5,
      "z-index": 20
    }
  },
  {
    selector: "node.neighbor",
    style: { "border-color": "#8bd3dd", "border-width": 3 }
  },
  {
    selector: "edge.selected, edge.connected",
    style: {
      width: 4,
      color: "#ffffff",
      "font-size": 11,
      "min-zoomed-font-size": 0,
      "line-color": "#ffd166",
      "target-arrow-color": "#ffd166",
      "z-index": 20
    }
  },
  {
    selector: ".dimmed",
    style: { opacity: 0.16 }
  }
] as unknown as cytoscape.StylesheetJson;
