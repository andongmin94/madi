import type {
  DescendantScenePreview,
  ProjectTree,
  TreeNodeKind,
  TreeNodeRecord
} from "../../shared/contracts";

export type ScriveningsReadOnlyBlock =
  | {
      readonly kind: "PARAGRAPH";
      readonly text: string;
    }
  | {
      readonly kind: "SCENE_BREAK";
    };

/**
 * A renderer-owned projection of a scene. It deliberately contains no Typie
 * document, node or snapshot types.
 */
export interface ScriveningsScenePreview extends DescendantScenePreview {
  readonly blocks?: readonly ScriveningsReadOnlyBlock[];
}

export interface ScriveningsTrailNode {
  readonly id: string;
  readonly kind: TreeNodeKind;
  readonly title: string;
}

export interface ScriveningsScene {
  readonly sceneId: string;
  readonly documentId: string;
  readonly title: string;
  readonly trail: readonly ScriveningsTrailNode[];
  readonly preview: ScriveningsScenePreview | null;
}

export interface ScriveningsSelectionStats {
  readonly sceneCount: number;
  readonly loadedSceneCount: number;
  readonly charactersWithSpaces: number;
  readonly charactersWithoutSpaces: number;
}

export interface HighlightSegment {
  readonly text: string;
  readonly matched: boolean;
  readonly start: number;
  readonly end: number;
}

const CHILD_KINDS = Object.freeze({
  WORK: new Set<TreeNodeKind>(["VOLUME", "CHAPTER"]),
  VOLUME: new Set<TreeNodeKind>(["CHAPTER"]),
  CHAPTER: new Set<TreeNodeKind>(["SCENE"]),
  SCENE: new Set<TreeNodeKind>()
}) satisfies Readonly<Record<TreeNodeKind, ReadonlySet<TreeNodeKind>>>;

function compareTreeOrder(left: TreeNodeRecord, right: TreeNodeRecord): number {
  return left.orderKey === right.orderKey
    ? left.id.localeCompare(right.id)
    : left.orderKey - right.orderKey;
}

function trailNode(record: TreeNodeRecord): ScriveningsTrailNode {
  return {
    id: record.id,
    kind: record.kind,
    title: record.title
  };
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

/**
 * Resolves SCENE descendants in Binder order. WORK, VOLUME, CHAPTER and SCENE
 * selections are accepted so the same projection can serve both workspace
 * modes. Missing previews remain explicit instead of being mistaken for empty
 * documents.
 */
export function orderedDescendantScenes(
  tree: ProjectTree,
  selectedNodeId: string,
  previews: readonly ScriveningsScenePreview[]
): readonly ScriveningsScene[] {
  const byId = new Map(tree.nodes.map((node) => [node.id, node]));
  const selected = byId.get(selectedNodeId);
  if (!selected) {
    throw new Error(`선택한 Binder 노드를 찾을 수 없습니다: ${selectedNodeId}`);
  }

  const byParent = new Map<string | null, TreeNodeRecord[]>();
  for (const node of tree.nodes) {
    const siblings = byParent.get(node.parentId) ?? [];
    siblings.push(node);
    byParent.set(node.parentId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort(compareTreeOrder);
  }

  const previewByScene = new Map<string, ScriveningsScenePreview>();
  for (const preview of previews) {
    if (previewByScene.has(preview.sceneId)) {
      throw new Error(`장면 미리보기가 중복되었습니다: ${preview.sceneId}`);
    }
    previewByScene.set(preview.sceneId, preview);
  }

  const ancestorTrail: ScriveningsTrailNode[] = [];
  const ancestorIds = new Set<string>();
  let ancestor: TreeNodeRecord | undefined = selected;
  while (ancestor) {
    if (ancestorIds.has(ancestor.id)) {
      throw new Error("Binder 계층에 순환 참조가 있습니다.");
    }
    ancestorIds.add(ancestor.id);
    ancestorTrail.unshift(trailNode(ancestor));
    ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined;
  }

  const result: ScriveningsScene[] = [];
  const visiting = new Set<string>();
  const visit = (
    node: TreeNodeRecord,
    trail: readonly ScriveningsTrailNode[]
  ): void => {
    if (visiting.has(node.id)) {
      throw new Error("Binder 계층에 순환 참조가 있습니다.");
    }
    visiting.add(node.id);

    if (node.kind === "SCENE") {
      if (!node.documentId) {
        throw new Error(`장면에 documentId가 없습니다: ${node.id}`);
      }
      const preview = previewByScene.get(node.id) ?? null;
      if (preview && preview.documentId !== node.documentId) {
        throw new Error(`장면 미리보기의 documentId가 다릅니다: ${node.id}`);
      }
      result.push({
        sceneId: node.id,
        documentId: node.documentId,
        title: node.title,
        trail,
        preview
      });
      visiting.delete(node.id);
      return;
    }

    const children = byParent.get(node.id) ?? [];
    for (const child of children) {
      if (!CHILD_KINDS[node.kind].has(child.kind)) {
        throw new Error(
          `허용되지 않은 Binder 계층입니다: ${node.kind} -> ${child.kind}`
        );
      }
      visit(child, [...trail, trailNode(child)]);
    }
    visiting.delete(node.id);
  };

  visit(selected, ancestorTrail);
  return result;
}

export function calculateScriveningsStats(
  scenes: readonly ScriveningsScene[]
): ScriveningsSelectionStats {
  let loadedSceneCount = 0;
  let charactersWithSpaces = 0;
  let charactersWithoutSpaces = 0;

  for (const scene of scenes) {
    if (!scene.preview) {
      continue;
    }
    loadedSceneCount += 1;
    charactersWithSpaces += codePointLength(
      scene.preview.plainTextRecovery
    );
    charactersWithoutSpaces += codePointLength(
      scene.preview.plainTextRecovery.replace(/\s/gu, "")
    );
  }

  return {
    sceneCount: scenes.length,
    loadedSceneCount,
    charactersWithSpaces,
    charactersWithoutSpaces
  };
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function splitHighlightSegments(
  value: string,
  query: string,
  caseSensitive = false
): readonly HighlightSegment[] {
  if (!query) {
    return [{ text: value, matched: false, start: 0, end: value.length }];
  }

  const expression = new RegExp(
    escapeRegularExpression(query),
    caseSensitive ? "gu" : "giu"
  );
  const segments: HighlightSegment[] = [];
  let cursor = 0;

  for (const match of value.matchAll(expression)) {
    const start = match.index;
    const matchedText = match[0];
    if (start > cursor) {
      segments.push({
        text: value.slice(cursor, start),
        matched: false,
        start: cursor,
        end: start
      });
    }
    segments.push({
      text: matchedText,
      matched: true,
      start,
      end: start + matchedText.length
    });
    cursor = start + matchedText.length;
  }

  if (segments.length === 0) {
    return [{ text: value, matched: false, start: 0, end: value.length }];
  }
  if (cursor < value.length) {
    segments.push({
      text: value.slice(cursor),
      matched: false,
      start: cursor,
      end: value.length
    });
  }
  return segments;
}

export function sceneTrailNode(
  scene: ScriveningsScene,
  kind: TreeNodeKind
): ScriveningsTrailNode | null {
  return scene.trail.find((node) => node.kind === kind) ?? null;
}
