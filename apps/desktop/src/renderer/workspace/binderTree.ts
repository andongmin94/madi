import type { TreeNodeRecord } from "../../shared/contracts";

export type BinderNodeType = "WORK" | "VOLUME" | "CHAPTER" | "SCENE";

export type BinderCreatableNodeType = Exclude<BinderNodeType, "WORK">;

interface BinderNodeBase<Type extends BinderNodeType> {
  readonly id: string;
  readonly type: Type;
  readonly title: string;
}

export interface BinderSceneNode extends BinderNodeBase<"SCENE"> {}

export interface BinderChapterNode extends BinderNodeBase<"CHAPTER"> {
  readonly children: readonly BinderSceneNode[];
}

export interface BinderVolumeNode extends BinderNodeBase<"VOLUME"> {
  readonly children: readonly BinderChapterNode[];
}

export interface BinderWorkNode extends BinderNodeBase<"WORK"> {
  readonly children: readonly (BinderVolumeNode | BinderChapterNode)[];
}

export type BinderNode =
  | BinderWorkNode
  | BinderVolumeNode
  | BinderChapterNode
  | BinderSceneNode;

export const BINDER_DEFAULT_TITLES = Object.freeze({
  WORK: "새 작품",
  VOLUME: "새 권",
  CHAPTER: "새 화",
  SCENE: "새 장면"
}) satisfies Readonly<Record<BinderNodeType, string>>;

export const BINDER_TYPE_LABELS = Object.freeze({
  WORK: "작품",
  VOLUME: "권",
  CHAPTER: "화",
  SCENE: "장면"
}) satisfies Readonly<Record<BinderNodeType, string>>;

const WORK_CHILD_TYPES = ["VOLUME", "CHAPTER"] as const;
const VOLUME_CHILD_TYPES = ["CHAPTER"] as const;
const CHAPTER_CHILD_TYPES = ["SCENE"] as const;

export function binderDisplayTitle(node: BinderNode): string {
  return node.title.trim() || BINDER_DEFAULT_TITLES[node.type];
}

export function binderChildren(node: BinderNode): readonly BinderNode[] {
  return node.type === "SCENE" ? [] : node.children;
}

export function allowedBinderChildTypes(
  node: BinderNode
): readonly BinderCreatableNodeType[] {
  switch (node.type) {
    case "WORK":
      return WORK_CHILD_TYPES;
    case "VOLUME":
      return VOLUME_CHILD_TYPES;
    case "CHAPTER":
      return CHAPTER_CHILD_TYPES;
    case "SCENE":
      return [];
  }
}

export function normalizedBinderTitle(
  type: BinderNodeType,
  candidate: string
): string {
  return candidate.trim() || BINDER_DEFAULT_TITLES[type];
}

export function canMoveBinderNode(
  siblingIndex: number,
  siblingCount: number,
  direction: "up" | "down"
): boolean {
  return direction === "up"
    ? siblingIndex > 0
    : siblingIndex >= 0 && siblingIndex < siblingCount - 1;
}

export function buildBinderTree(
  records: readonly TreeNodeRecord[]
): BinderWorkNode {
  const workRecords = records.filter((record) => record.kind === "WORK");
  if (workRecords.length !== 1) {
    throw new Error("프로젝트에는 작품 노드가 정확히 하나 있어야 합니다.");
  }
  const byParent = new Map<string | null, TreeNodeRecord[]>();
  for (const record of records) {
    const siblings = byParent.get(record.parentId) ?? [];
    siblings.push(record);
    byParent.set(record.parentId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((left, right) =>
      left.orderKey === right.orderKey
        ? left.id.localeCompare(right.id)
        : left.orderKey - right.orderKey
    );
  }

  const buildScene = (record: TreeNodeRecord): BinderSceneNode => {
    if (record.kind !== "SCENE") {
      throw new Error("장면 계층이 올바르지 않습니다.");
    }
    return { id: record.id, type: "SCENE", title: record.title };
  };
  const buildChapter = (record: TreeNodeRecord): BinderChapterNode => {
    if (record.kind !== "CHAPTER") {
      throw new Error("화 계층이 올바르지 않습니다.");
    }
    const children = byParent.get(record.id) ?? [];
    return {
      id: record.id,
      type: "CHAPTER",
      title: record.title,
      children: children.map(buildScene)
    };
  };
  const buildVolume = (record: TreeNodeRecord): BinderVolumeNode => {
    if (record.kind !== "VOLUME") {
      throw new Error("권 계층이 올바르지 않습니다.");
    }
    const children = byParent.get(record.id) ?? [];
    return {
      id: record.id,
      type: "VOLUME",
      title: record.title,
      children: children.map(buildChapter)
    };
  };

  const work = workRecords[0]!;
  const children = (byParent.get(work.id) ?? []).map((record) => {
    if (record.kind === "VOLUME") {
      return buildVolume(record);
    }
    return buildChapter(record);
  });
  return { id: work.id, type: "WORK", title: work.title, children };
}
