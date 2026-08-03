import type cytoscape from "cytoscape";

export const WORLD_GRAPH_COSE_ITERATIONS = 200;

/** One production/test source of truth for the built-in offline COSE layout. */
export function createWorldGraphCoseLayoutOptions(
  fit: boolean
): cytoscape.CoseLayoutOptions {
  return {
    name: "cose",
    animate: false,
    randomize: true,
    fit,
    padding: 36,
    nodeRepulsion: 500_000,
    idealEdgeLength: 90,
    edgeElasticity: 100,
    nestingFactor: 1.2,
    gravity: 0.4,
    numIter: WORLD_GRAPH_COSE_ITERATIONS,
    initialTemp: 150,
    coolingFactor: 0.95,
    minTemp: 1
  };
}
