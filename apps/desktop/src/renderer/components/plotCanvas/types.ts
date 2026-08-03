export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type MadiCanvasNodeKind =
  | "TEXT"
  | "ENTITY_REFERENCE"
  | "SCENE_REFERENCE"
  | "GROUP";

export type JsonCanvasSide = "top" | "right" | "bottom" | "left";
export type JsonCanvasEnd = "none" | "arrow";
export type MadiCanvasLineStyle = "SOLID" | "DASHED" | "DOTTED";

export interface MadiCanvasNodeExtension {
  readonly nodeKind: MadiCanvasNodeKind;
  readonly entityId?: string;
  readonly sceneNodeId?: string;
  readonly parentGroupId?: string;
  readonly originalLabel?: string;
  readonly [key: string]: JsonValue | undefined;
}

interface MadiCanvasNodeBase {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color?: string;
  readonly madi?: MadiCanvasNodeExtension;
}

export interface MadiCanvasTextNode extends MadiCanvasNodeBase {
  readonly type: "text";
  /** Plain-text fallback. It is never inserted with innerHTML. */
  readonly text: string;
}

export interface MadiCanvasGroupNode extends MadiCanvasNodeBase {
  readonly type: "group";
  readonly label?: string;
  readonly background?: string;
  readonly backgroundStyle?: "cover" | "ratio" | "repeat";
}

export type MadiCanvasNode = MadiCanvasTextNode | MadiCanvasGroupNode;

export interface MadiCanvasEdgeExtension {
  readonly lineStyle?: MadiCanvasLineStyle;
  readonly [key: string]: JsonValue | undefined;
}

export interface MadiCanvasEdge {
  readonly id: string;
  readonly fromNode: string;
  readonly toNode: string;
  readonly fromSide?: JsonCanvasSide;
  readonly toSide?: JsonCanvasSide;
  readonly fromEnd?: JsonCanvasEnd;
  readonly toEnd?: JsonCanvasEnd;
  readonly color?: string;
  readonly label?: string;
  readonly madi?: MadiCanvasEdgeExtension;
}

/**
 * Renderer-owned structural DTO. React Flow runtime values deliberately do
 * not occur in this contract; the same object can be validated and persisted
 * as a JSON Canvas 1.0 compatible document.
 */
export interface MadiCanvasDocument {
  readonly nodes: readonly MadiCanvasNode[];
  readonly edges: readonly MadiCanvasEdge[];
}

export interface CanvasEntityReference {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly status: string;
  readonly summary: string | null;
  readonly colorToken: string | null;
  readonly aliases: readonly string[];
  readonly tags: readonly string[];
  readonly relationCount: number;
}

export interface CanvasSceneReference {
  readonly id: string;
  readonly episodeTitle: string;
  readonly sceneTitle: string;
  readonly recoveryFirstSentence: string | null;
  readonly characterCount: number;
  readonly hasSceneBreak: boolean;
}

export interface CanvasReferenceCatalog {
  readonly entities: readonly CanvasEntityReference[];
  readonly scenes: readonly CanvasSceneReference[];
}

export interface CanvasReferenceDisplay {
  readonly kind: "TEXT" | "ENTITY_REFERENCE" | "SCENE_REFERENCE" | "GROUP";
  readonly title: string;
  readonly subtitle: string | null;
  readonly description: string | null;
  readonly badge: string | null;
  readonly color: string | null;
  readonly broken: boolean;
  readonly referenceId: string | null;
}

export interface MadiCanvasPoint {
  readonly x: number;
  readonly y: number;
}

export interface MadiCanvasViewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface MadiCanvasUiState {
  readonly viewport: MadiCanvasViewport;
  readonly selectedElementId: string | null;
  readonly inspectorWidth: number;
  readonly showGrid: boolean;
  readonly showMinimap: boolean;
  readonly snapToGrid: boolean;
}

export type MadiCanvasSelection =
  | { readonly kind: "NODE"; readonly id: string }
  | { readonly kind: "EDGE"; readonly id: string };

export type CanvasAutosavePhase =
  | "clean"
  | "dirty"
  | "saving"
  | "saved"
  | "error";

export interface CanvasAutosaveState {
  readonly canvasId: string;
  readonly generation: number;
  readonly saveSequence: number;
  readonly phase: CanvasAutosavePhase;
  readonly lastSavedAt: number | null;
  readonly errorMessage: string | null;
}

export interface CanvasSaveRequest {
  readonly canvasId: string;
  readonly generation: number;
  readonly saveSequence: number;
  readonly document: MadiCanvasDocument;
}

export interface CanvasSaveResult {
  readonly canvasId: string;
  readonly generation: number;
  readonly saveSequence: number;
  readonly contentHash?: string;
  readonly revision?: number;
}

export interface CanvasPickerTextItem {
  readonly kind: "TEXT";
  readonly text: string;
}

export interface CanvasPickerEntityItem {
  readonly kind: "ENTITY_REFERENCE";
  readonly entity: CanvasEntityReference;
}

export interface CanvasPickerSceneItem {
  readonly kind: "SCENE_REFERENCE";
  readonly scene: CanvasSceneReference;
}

export type CanvasPickerItem =
  | CanvasPickerTextItem
  | CanvasPickerEntityItem
  | CanvasPickerSceneItem;

export const EMPTY_MADI_CANVAS_DOCUMENT: MadiCanvasDocument = {
  nodes: [],
  edges: []
};

export const DEFAULT_MADI_CANVAS_UI_STATE: MadiCanvasUiState = {
  viewport: { x: 0, y: 0, zoom: 1 },
  selectedElementId: null,
  inspectorWidth: 320,
  showGrid: true,
  showMinimap: false,
  snapToGrid: false
};
