import type { ProjectTree, TreeNodeRecord } from "../../../shared/contracts";
import type {
  ReaderLabUiState,
  ReaderPaneCount,
  ReaderPaneOverrides,
  ReaderPaneUiState,
  ReaderPresetRecord,
  ReaderSettings
} from "../../../shared/publication";
import { BUILTIN_READER_PRESETS, DEFAULT_READER_PRESET } from "./builtinTemplates";
import { READER_LIMITS } from "../../../shared/readerConfigValidation";
import { normalizeZoom } from "./readerConfig";
import type { ReaderPresetOption } from "./types";

export interface ReaderScopeOption {
  readonly nodeId: string;
  readonly kind: TreeNodeRecord["kind"];
  readonly title: string;
  readonly label: string;
}

const SCOPE_KIND_LABEL: Readonly<Record<TreeNodeRecord["kind"], string>> = {
  WORK: "작품 전체",
  VOLUME: "현재 권",
  CHAPTER: "현재 화",
  SCENE: "현재 장면"
};

function ancestors(tree: ProjectTree, nodeId: string | null): readonly TreeNodeRecord[] {
  const byId = new Map(tree.nodes.map((node) => [node.id, node]));
  const result: TreeNodeRecord[] = [];
  let cursor = nodeId ? byId.get(nodeId) : undefined;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    result.push(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return result;
}

function isDescendantOf(
  byId: ReadonlyMap<string, TreeNodeRecord>,
  node: TreeNodeRecord,
  ancestorId: string
): boolean {
  let parentId = node.parentId;
  const seen = new Set<string>();
  while (parentId && !seen.has(parentId)) {
    if (parentId === ancestorId) {
      return true;
    }
    seen.add(parentId);
    parentId = byId.get(parentId)?.parentId ?? null;
  }
  return false;
}

export function readerScopeOptions(
  tree: ProjectTree,
  selectedNodeId: string | null,
  activeSceneId: string | null,
  restoredScopeNodeId: string | null = null
): readonly ReaderScopeOption[] {
  const byId = new Map(tree.nodes.map((node) => [node.id, node]));
  const selected = selectedNodeId ? byId.get(selectedNodeId) ?? null : null;
  const restored = restoredScopeNodeId
    ? byId.get(restoredScopeNodeId) ?? null
    : null;
  const activeScene = activeSceneId
    ? tree.nodes.find((node) => node.id === activeSceneId && node.kind === "SCENE") ?? null
    : null;
  const firstProjectScene = tree.nodes.find((node) => node.kind === "SCENE") ?? null;
  const firstSelectedScene =
    selected && selected.kind !== "SCENE"
      ? tree.nodes.find(
          (node) =>
            node.kind === "SCENE" && isDescendantOf(byId, node, selected.id)
        ) ?? null
      : null;
  const basis =
    activeScene ??
    (selected?.kind === "SCENE" ? selected : null) ??
    firstSelectedScene ??
    firstProjectScene;
  const candidates = [
    ...ancestors(tree, basis?.id ?? null),
    ...(selected ? [selected] : []),
    ...(restored ? [restored] : []),
    ...(tree.nodes.find((node) => node.kind === "WORK")
      ? [tree.nodes.find((node) => node.kind === "WORK")!]
      : [])
  ];
  const seen = new Set<string>();
  const options: ReaderScopeOption[] = [];
  for (const node of candidates) {
    if (seen.has(node.id)) {
      continue;
    }
    seen.add(node.id);
    options.push({
      nodeId: node.id,
      kind: node.kind,
      title: node.title,
      label:
        node.id === selected?.id && !ancestors(tree, basis?.id ?? null).some((item) => item.id === node.id)
          ? `Binder 선택 · ${node.title || SCOPE_KIND_LABEL[node.kind]}`
          : `${SCOPE_KIND_LABEL[node.kind]} · ${node.title || "제목 없음"}`
    });
  }
  return options;
}

function defaultPane(index: number): ReaderPaneUiState {
  const preset = BUILTIN_READER_PRESETS[index] ?? DEFAULT_READER_PRESET;
  return {
    presetId: preset.id,
    deviceProfileId: preset.config.device.id,
    overrides: {},
    zoom: 1,
    scrollProgress: 0
  };
}

export function defaultReaderLabUiState(
  scopeNodeId: string | null
): ReaderLabUiState {
  return {
    lastScopeNodeId: scopeNodeId,
    paneCount: 1,
    panes: [defaultPane(0), defaultPane(5), defaultPane(10)],
    scrollSync: false,
    leftPanelWidth: 270,
    rightPanelWidth: 320,
    selectedSourceBlockId: null,
    diagnosticsExpanded: true
  };
}

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function sanitizeSettings(
  value: ReaderPaneOverrides["readerSettings"]
): Partial<ReaderSettings> {
  if (!value) {
    return {};
  }
  return {
    ...(value.fontFamilyToken ? { fontFamilyToken: value.fontFamilyToken } : {}),
    ...(value.fontSize !== undefined
      ? { fontSize: bounded(value.fontSize, READER_LIMITS.fontSize.min, READER_LIMITS.fontSize.max, 16) }
      : {}),
    ...(value.lineHeight !== undefined
      ? { lineHeight: bounded(value.lineHeight, READER_LIMITS.lineHeight.min, READER_LIMITS.lineHeight.max, 1.75) }
      : {}),
    ...(value.paragraphSpacing !== undefined
      ? { paragraphSpacing: bounded(value.paragraphSpacing, READER_LIMITS.paragraphSpacing.min, READER_LIMITS.paragraphSpacing.max, 12) }
      : {}),
    ...(value.firstLineIndent !== undefined
      ? { firstLineIndent: bounded(value.firstLineIndent, READER_LIMITS.firstLineIndent.min, READER_LIMITS.firstLineIndent.max, 0) }
      : {}),
    ...(value.horizontalPadding !== undefined
      ? { horizontalPadding: bounded(value.horizontalPadding, READER_LIMITS.padding.min, READER_LIMITS.padding.max, 24) }
      : {}),
    ...(value.verticalPadding !== undefined
      ? { verticalPadding: bounded(value.verticalPadding, READER_LIMITS.padding.min, READER_LIMITS.padding.max, 32) }
      : {}),
    ...(value.textAlign ? { textAlign: value.textAlign } : {}),
    ...(value.theme ? { theme: value.theme } : {}),
    ...(value.backgroundColor ? { backgroundColor: value.backgroundColor } : {}),
    ...(value.textColor ? { textColor: value.textColor } : {}),
    ...(value.scrollMode ? { scrollMode: value.scrollMode } : {}),
    ...(value.showChapterTitle !== undefined ? { showChapterTitle: value.showChapterTitle } : {}),
    ...(value.showSceneTitle !== undefined ? { showSceneTitle: value.showSceneTitle } : {}),
    ...(value.showSceneBreak !== undefined ? { showSceneBreak: value.showSceneBreak } : {})
  };
}

function sanitizeOverrides(value: ReaderPaneOverrides): ReaderPaneOverrides {
  return {
    ...(value.deviceCategory ? { deviceCategory: value.deviceCategory } : {}),
    ...(value.viewportWidth !== undefined
      ? { viewportWidth: bounded(value.viewportWidth, READER_LIMITS.viewportWidth.min, READER_LIMITS.viewportWidth.max, 390) }
      : {}),
    ...(value.viewportHeight !== undefined
      ? { viewportHeight: bounded(value.viewportHeight, READER_LIMITS.viewportHeight.min, READER_LIMITS.viewportHeight.max, 844) }
      : {}),
    ...(value.readerSettings ? { readerSettings: sanitizeSettings(value.readerSettings) } : {}),
    ...(value.sceneBreakStyleToken
      ? { sceneBreakStyleToken: value.sceneBreakStyleToken }
      : {})
  };
}

export function storedPresetOptions(
  presets: readonly ReaderPresetRecord[],
  duplicateNames: readonly string[]
): readonly ReaderPresetOption[] {
  const duplicates = new Set(duplicateNames);
  return presets.map((preset) => ({
    ...preset,
    builtin: false,
    duplicateName: duplicates.has(preset.name)
  }));
}

export function normalizeReaderLabUiState(
  value: ReaderLabUiState | null,
  scopeOptions: readonly ReaderScopeOption[],
  presetOptions: readonly ReaderPresetOption[]
): ReaderLabUiState {
  const fallbackScopeId = scopeOptions[0]?.nodeId ?? null;
  const fallback = defaultReaderLabUiState(fallbackScopeId);
  if (!value) {
    return fallback;
  }
  const validScopeIds = new Set(scopeOptions.map((option) => option.nodeId));
  const validPresets = new Map(presetOptions.map((preset) => [preset.id, preset]));
  const paneCount: ReaderPaneCount =
    value.paneCount === 2 || value.paneCount === 3 ? value.paneCount : 1;
  const panes = [0, 1, 2].map((index) => {
    const incoming = value.panes[index] ?? defaultPane(index);
    const preset =
      (incoming.presetId ? validPresets.get(incoming.presetId) : undefined) ??
      presetOptions[index] ??
      DEFAULT_READER_PRESET;
    return {
      presetId: preset.id,
      deviceProfileId: preset.config.device.id,
      overrides: sanitizeOverrides(incoming.overrides),
      zoom: normalizeZoom(incoming.zoom),
      scrollProgress: bounded(incoming.scrollProgress, 0, 1, 0)
    } satisfies ReaderPaneUiState;
  });
  return {
    lastScopeNodeId:
      value.lastScopeNodeId && validScopeIds.has(value.lastScopeNodeId)
        ? value.lastScopeNodeId
        : fallbackScopeId,
    paneCount,
    panes,
    scrollSync: value.scrollSync,
    leftPanelWidth: bounded(value.leftPanelWidth, 220, 520, fallback.leftPanelWidth),
    rightPanelWidth: bounded(value.rightPanelWidth, 260, 560, fallback.rightPanelWidth),
    selectedSourceBlockId: value.selectedSourceBlockId,
    diagnosticsExpanded: value.diagnosticsExpanded
  };
}

export function updateReaderPane(
  state: ReaderLabUiState,
  index: number,
  patch: Partial<ReaderPaneUiState>
): ReaderLabUiState {
  return {
    ...state,
    panes: state.panes.map((pane, paneIndex) =>
      paneIndex === index ? { ...pane, ...patch } : pane
    )
  };
}
