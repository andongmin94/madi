import type {
  CanvasReferenceCatalog,
  JsonCanvasEnd,
  JsonCanvasSide,
  JsonValue,
  MadiCanvasDocument,
  MadiCanvasEdge,
  MadiCanvasEdgeExtension,
  MadiCanvasGroupNode,
  MadiCanvasLineStyle,
  MadiCanvasNode,
  MadiCanvasNodeExtension,
  MadiCanvasNodeKind,
  MadiCanvasTextNode
} from "./types";
import {
  MAX_JSON_CANVAS_COORDINATE,
  MAX_JSON_CANVAS_DIMENSION
} from "./canvasGeometry";

export const JSON_CANVAS_DOCUMENT_FORMAT = "JSON_CANVAS";
export const JSON_CANVAS_DOCUMENT_VERSION = "1.0";
export const MAX_JSON_CANVAS_BYTES = 8 * 1024 * 1024;
export const MAX_JSON_CANVAS_NODES = 500;
export const MAX_JSON_CANVAS_EDGES = 1_000;

const NODE_KINDS = new Set<MadiCanvasNodeKind>([
  "TEXT",
  "ENTITY_REFERENCE",
  "SCENE_REFERENCE",
  "GROUP"
]);
const SIDES = new Set<JsonCanvasSide>(["top", "right", "bottom", "left"]);
const ENDS = new Set<JsonCanvasEnd>(["none", "arrow"]);
const LINE_STYLES = new Set<MadiCanvasLineStyle>(["SOLID", "DASHED", "DOTTED"]);

export class JsonCanvasValidationError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "JsonCanvasValidationError";
    this.path = path;
  }
}

export interface JsonCanvasImportPreview {
  readonly document: MadiCanvasDocument;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly entityReferenceCount: number;
  readonly sceneReferenceCount: number;
  readonly brokenReferenceCount: number;
}

function fail(path: string, message: string): never {
  throw new JsonCanvasValidationError(path, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  path: string,
  maxLength = 1_000_000
): string {
  if (typeof value !== "string") {
    return fail(path, "문자열이어야 합니다.");
  }
  if (value.length === 0) {
    return fail(path, "비어 있을 수 없습니다.");
  }
  if (value.length > maxLength) {
    return fail(path, `${maxLength}자를 초과할 수 없습니다.`);
  }
  return value;
}

function optionalString(
  value: unknown,
  path: string,
  maxLength = 1_000_000
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    return fail(path, "문자열이어야 합니다.");
  }
  if (value.length > maxLength) {
    return fail(path, `${maxLength}자를 초과할 수 없습니다.`);
  }
  return value;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return fail(path, "JSON Canvas 1.0 정수여야 합니다.");
  }
  if (Math.abs(value) > MAX_JSON_CANVAS_COORDINATE) {
    return fail(path, "허용 좌표 범위를 벗어났습니다.");
  }
  return value;
}

function positiveSize(value: unknown, path: string): number {
  const size = finiteNumber(value, path);
  if (size <= 0 || size > MAX_JSON_CANVAS_DIMENSION) {
    return fail(path, "0보다 크고 100000 이하여야 합니다.");
  }
  return size;
}

function optionalEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  path: string
): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !allowed.has(value as T)) {
    return fail(path, "지원하지 않는 값입니다.");
  }
  return value as T;
}

function assertJsonValue(
  value: unknown,
  path: string,
  ancestors: ReadonlySet<object> = new Set(),
  depth = 0
): asserts value is JsonValue {
  if (depth > 64) {
    fail(path, "JSON 중첩 깊이가 너무 큽니다.");
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail(path, "JSON 숫자는 유한해야 합니다.");
    }
    return;
  }
  if (typeof value !== "object") {
    fail(path, "JSON 값이어야 합니다.");
  }
  if (ancestors.has(value)) {
    fail(path, "순환 참조를 포함할 수 없습니다.");
  }
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertJsonValue(item, `${path}[${index}]`, nextAncestors, depth + 1)
    );
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) {
      fail(`${path}.${key}`, "undefined는 JSON 값이 아닙니다.");
    }
    assertJsonValue(item, `${path}.${key}`, nextAncestors, depth + 1);
  }
}

function validateUnknownFields(
  record: Record<string, unknown>,
  known: ReadonlySet<string>,
  path: string
): void {
  for (const [key, value] of Object.entries(record)) {
    if (!known.has(key)) {
      assertJsonValue(value, `${path}.${key}`);
    }
  }
}

function validateNodeExtension(
  value: unknown,
  path: string,
  defaultKind: MadiCanvasNodeKind
): MadiCanvasNodeExtension {
  if (value === undefined) {
    return { nodeKind: defaultKind };
  }
  if (!isRecord(value)) {
    return fail(path, "객체여야 합니다.");
  }
  validateUnknownFields(
    value,
    new Set(["nodeKind", "entityId", "sceneNodeId", "parentGroupId", "originalLabel"]),
    path
  );
  const kind = requiredString(value.nodeKind, `${path}.nodeKind`, 64);
  if (!NODE_KINDS.has(kind as MadiCanvasNodeKind)) {
    return fail(`${path}.nodeKind`, "지원하지 않는 nodeKind입니다.");
  }
  const nodeKind = kind as MadiCanvasNodeKind;
  const entityId = optionalString(value.entityId, `${path}.entityId`, 256);
  const sceneNodeId = optionalString(value.sceneNodeId, `${path}.sceneNodeId`, 256);
  if (nodeKind === "ENTITY_REFERENCE" && !entityId) {
    return fail(`${path}.entityId`, "Entity reference에는 entityId가 필요합니다.");
  }
  if (nodeKind === "SCENE_REFERENCE" && !sceneNodeId) {
    return fail(`${path}.sceneNodeId`, "Scene reference에는 sceneNodeId가 필요합니다.");
  }
  if (nodeKind === "GROUP" && defaultKind !== "GROUP") {
    return fail(`${path}.nodeKind`, "text node는 GROUP이 될 수 없습니다.");
  }
  if (defaultKind === "GROUP" && nodeKind !== "GROUP") {
    return fail(`${path}.nodeKind`, "group node의 nodeKind는 GROUP이어야 합니다.");
  }
  return {
    ...value,
    nodeKind,
    ...(entityId === undefined ? {} : { entityId }),
    ...(sceneNodeId === undefined ? {} : { sceneNodeId }),
    ...((value.parentGroupId === undefined
      ? {}
      : {
          parentGroupId: requiredString(
            value.parentGroupId,
            `${path}.parentGroupId`,
            256
          )
        }) as object),
    ...((value.originalLabel === undefined
      ? {}
      : {
          originalLabel: optionalString(
            value.originalLabel,
            `${path}.originalLabel`,
            20_000
          )
        }) as object)
  } as MadiCanvasNodeExtension;
}

function validateNode(value: unknown, path: string): MadiCanvasNode {
  if (!isRecord(value)) {
    return fail(path, "node는 객체여야 합니다.");
  }
  validateUnknownFields(
    value,
    new Set([
      "id",
      "type",
      "x",
      "y",
      "width",
      "height",
      "color",
      "madi",
      "text",
      "label",
      "background",
      "backgroundStyle"
    ]),
    path
  );
  const id = requiredString(value.id, `${path}.id`, 256);
  const type = requiredString(value.type, `${path}.type`, 32);
  const base = {
    ...value,
    id,
    x: finiteNumber(value.x, `${path}.x`),
    y: finiteNumber(value.y, `${path}.y`),
    width: positiveSize(value.width, `${path}.width`),
    height: positiveSize(value.height, `${path}.height`),
    ...(value.color === undefined
      ? {}
      : { color: requiredString(value.color, `${path}.color`, 64) })
  };
  if (type === "text") {
    const madi = validateNodeExtension(value.madi, `${path}.madi`, "TEXT");
    return {
      ...base,
      type,
      text:
        typeof value.text === "string"
          ? optionalString(value.text, `${path}.text`)
          : fail(`${path}.text`, "text node에는 text 문자열이 필요합니다."),
      madi
    } as MadiCanvasTextNode;
  }
  if (type === "group") {
    const madi = validateNodeExtension(value.madi, `${path}.madi`, "GROUP");
    return {
      ...base,
      type,
      ...(value.label === undefined
        ? {}
        : { label: optionalString(value.label, `${path}.label`, 20_000) }),
      ...(value.background === undefined
        ? {}
        : {
            background: requiredString(
              value.background,
              `${path}.background`,
              64
            )
          }),
      ...(value.backgroundStyle === undefined
        ? {}
        : value.backgroundStyle === "cover" ||
            value.backgroundStyle === "ratio" ||
            value.backgroundStyle === "repeat"
          ? { backgroundStyle: value.backgroundStyle }
          : fail(`${path}.backgroundStyle`, "지원하지 않는 배경 방식입니다.")),
      madi
    } as MadiCanvasGroupNode;
  }
  return fail(
    `${path}.type`,
    "text와 group만 지원합니다. 외부 link/file/HTML node는 허용하지 않습니다."
  );
}

function validateEdgeExtension(
  value: unknown,
  path: string
): MadiCanvasEdgeExtension | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return fail(path, "객체여야 합니다.");
  }
  validateUnknownFields(value, new Set(["lineStyle"]), path);
  return {
    ...value,
    ...(value.lineStyle === undefined
      ? {}
      : {
          lineStyle: optionalEnum(value.lineStyle, LINE_STYLES, `${path}.lineStyle`)
        })
  } as MadiCanvasEdgeExtension;
}

function validateEdge(value: unknown, path: string): MadiCanvasEdge {
  if (!isRecord(value)) {
    return fail(path, "edge는 객체여야 합니다.");
  }
  validateUnknownFields(
    value,
    new Set([
      "id",
      "fromNode",
      "toNode",
      "fromSide",
      "toSide",
      "fromEnd",
      "toEnd",
      "color",
      "label",
      "madi"
    ]),
    path
  );
  const madi = validateEdgeExtension(value.madi, `${path}.madi`);
  return {
    ...value,
    id: requiredString(value.id, `${path}.id`, 256),
    fromNode: requiredString(value.fromNode, `${path}.fromNode`, 256),
    toNode: requiredString(value.toNode, `${path}.toNode`, 256),
    ...(value.fromSide === undefined
      ? {}
      : { fromSide: optionalEnum(value.fromSide, SIDES, `${path}.fromSide`) }),
    ...(value.toSide === undefined
      ? {}
      : { toSide: optionalEnum(value.toSide, SIDES, `${path}.toSide`) }),
    ...(value.fromEnd === undefined
      ? {}
      : { fromEnd: optionalEnum(value.fromEnd, ENDS, `${path}.fromEnd`) }),
    ...(value.toEnd === undefined
      ? {}
      : { toEnd: optionalEnum(value.toEnd, ENDS, `${path}.toEnd`) }),
    ...(value.color === undefined
      ? {}
      : { color: requiredString(value.color, `${path}.color`, 64) }),
    ...(value.label === undefined
      ? {}
      : { label: optionalString(value.label, `${path}.label`, 20_000) }),
    ...(madi === undefined ? {} : { madi })
  } as MadiCanvasEdge;
}

function assertGroupGraph(nodes: readonly MadiCanvasNode[]): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    const parentId = node.madi?.parentGroupId;
    if (!parentId) {
      continue;
    }
    const parent = byId.get(parentId);
    if (!parent || parent.type !== "group") {
      fail(`nodes[${node.id}].madi.parentGroupId`, "존재하는 group을 가리켜야 합니다.");
    }
    const visited = new Set([node.id]);
    let cursor: MadiCanvasNode | undefined = parent;
    while (cursor) {
      if (visited.has(cursor.id)) {
        fail(`nodes[${node.id}].madi.parentGroupId`, "group 순환을 만들 수 없습니다.");
      }
      visited.add(cursor.id);
      const nextId: string | undefined = cursor.madi?.parentGroupId;
      cursor = nextId ? byId.get(nextId) : undefined;
    }
  }
}

export function validateMadiCanvasDocument(value: unknown): MadiCanvasDocument {
  if (!isRecord(value)) {
    return fail("$", "JSON Canvas document는 객체여야 합니다.");
  }
  validateUnknownFields(value, new Set(["nodes", "edges"]), "$");
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    return fail("$", "nodes와 edges 배열이 필요합니다.");
  }
  if (value.nodes.length > MAX_JSON_CANVAS_NODES) {
    return fail("$.nodes", `최대 ${MAX_JSON_CANVAS_NODES}개까지 지원합니다.`);
  }
  if (value.edges.length > MAX_JSON_CANVAS_EDGES) {
    return fail("$.edges", `최대 ${MAX_JSON_CANVAS_EDGES}개까지 지원합니다.`);
  }
  const nodes = value.nodes.map((node, index) =>
    validateNode(node, `$.nodes[${index}]`)
  );
  const edges = value.edges.map((edge, index) =>
    validateEdge(edge, `$.edges[${index}]`)
  );
  const allIds = new Set<string>();
  for (const [kind, elements] of [
    ["node", nodes],
    ["edge", edges]
  ] as const) {
    for (const element of elements) {
      if (allIds.has(element.id)) {
        fail(`$.${kind}s`, `중복 id '${element.id}'를 허용하지 않습니다.`);
      }
      allIds.add(element.id);
    }
  }
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const edge of edges) {
    if (!nodeIds.has(edge.fromNode) || !nodeIds.has(edge.toNode)) {
      fail(`$.edges[${edge.id}]`, "edge endpoint가 존재하지 않습니다.");
    }
  }
  assertGroupGraph(nodes);
  return { ...value, nodes, edges } as MadiCanvasDocument;
}

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Readonly<Record<string, JsonValue>>;
    const sorted: Record<string, JsonValue> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortJson(record[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalizeJsonCanvas(document: MadiCanvasDocument): string {
  const validated = validateMadiCanvasDocument(document);
  assertJsonValue(validated, "$document");
  return JSON.stringify(sortJson(validated), null, 2) + "\n";
}

export function parseJsonCanvas(source: string): MadiCanvasDocument {
  if (new TextEncoder().encode(source).byteLength > MAX_JSON_CANVAS_BYTES) {
    return fail("$", `파일이 ${MAX_JSON_CANVAS_BYTES} bytes를 초과합니다.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (error) {
    return fail(
      "$",
      `올바른 JSON이 아닙니다: ${error instanceof Error ? error.message : "unknown"}`
    );
  }
  return validateMadiCanvasDocument(parsed);
}

export function createJsonCanvasImportPreview(
  source: string,
  catalog: CanvasReferenceCatalog
): JsonCanvasImportPreview {
  const document = parseJsonCanvas(source);
  const entityIds = new Set(catalog.entities.map((entity) => entity.id));
  const sceneIds = new Set(catalog.scenes.map((scene) => scene.id));
  let entityReferenceCount = 0;
  let sceneReferenceCount = 0;
  let brokenReferenceCount = 0;
  for (const node of document.nodes) {
    if (node.madi?.nodeKind === "ENTITY_REFERENCE") {
      entityReferenceCount += 1;
      if (!entityIds.has(node.madi.entityId ?? "")) {
        brokenReferenceCount += 1;
      }
    }
    if (node.madi?.nodeKind === "SCENE_REFERENCE") {
      sceneReferenceCount += 1;
      if (!sceneIds.has(node.madi.sceneNodeId ?? "")) {
        brokenReferenceCount += 1;
      }
    }
  }
  return {
    document,
    nodeCount: document.nodes.length,
    edgeCount: document.edges.length,
    entityReferenceCount,
    sceneReferenceCount,
    brokenReferenceCount
  };
}

export const JsonCanvasAdapter = {
  parse: parseJsonCanvas,
  validate: validateMadiCanvasDocument,
  serialize: canonicalizeJsonCanvas,
  preview: createJsonCanvasImportPreview
} as const;
