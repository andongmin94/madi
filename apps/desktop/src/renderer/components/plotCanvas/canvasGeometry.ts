export const MAX_JSON_CANVAS_COORDINATE = 10_000_000;
export const MAX_JSON_CANVAS_DIMENSION = 100_000;

export function normalizeCanvasCoordinate(
  value: number,
  fallback = 0
): number {
  const finite = Number.isFinite(value) ? value : fallback;
  return Math.max(
    -MAX_JSON_CANVAS_COORDINATE,
    Math.min(MAX_JSON_CANVAS_COORDINATE, Math.round(finite))
  );
}

export function normalizeCanvasDimension(
  value: number,
  fallback: number
): number {
  const finite = Number.isFinite(value) ? value : fallback;
  return Math.max(
    1,
    Math.min(MAX_JSON_CANVAS_DIMENSION, Math.round(finite))
  );
}
