import type {
  PublicationBlock,
  PublicationDocument,
  PublicationInline,
  PublicationSourceReference
} from "./publication";

export const PUBLICATION_LIMITS = {
  sections: 20_000,
  blocksPerSection: 100_000,
  blocks: 250_000,
  inlineNodes: 1_000_000,
  inlineChildren: 100_000,
  textCharacters: 10_000_000,
  idCharacters: 256,
  titleCharacters: 1_000,
  nodeTypeCharacters: 256,
  parentTitles: 64,
  inlineDepth: 16
} as const;

interface ValidationBudget {
  blocks: number;
  inlineNodes: number;
  textCharacters: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[]
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isBoundedString(
  value: unknown,
  maximum: number,
  allowEmpty = false
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    (allowEmpty || value.length > 0)
  );
}

function countText(
  value: unknown,
  budget: ValidationBudget,
  maximum: number,
  allowEmpty = true
): value is string {
  if (!isBoundedString(value, maximum, allowEmpty)) {
    return false;
  }
  budget.textCharacters += value.length;
  return budget.textCharacters <= PUBLICATION_LIMITS.textCharacters;
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSource(value: unknown): value is PublicationSourceReference {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "sourceNodeId",
      "sceneNodeId",
      "documentId",
      "blockId",
      "start",
      "end",
      "rangeVerified"
    ])
  ) {
    return false;
  }
  const verifiedPair =
    isFiniteNonNegativeInteger(value.start) &&
    isFiniteNonNegativeInteger(value.end) &&
    value.end >= value.start &&
    value.end <= PUBLICATION_LIMITS.textCharacters;
  const explicitlyUnmapped = value.start === null && value.end === null;
  const hasSceneDocument =
    isBoundedString(value.sceneNodeId, PUBLICATION_LIMITS.idCharacters) &&
    isBoundedString(value.documentId, PUBLICATION_LIMITS.idCharacters);
  const rangeIsConsistent =
    value.rangeVerified === true
      ? hasSceneDocument && verifiedPair
      : value.rangeVerified === false &&
        hasSceneDocument &&
        explicitlyUnmapped;
  return (
    isBoundedString(value.sourceNodeId, PUBLICATION_LIMITS.idCharacters) &&
    isBoundedString(value.blockId, PUBLICATION_LIMITS.idCharacters) &&
    rangeIsConsistent
  );
}

function isInline(
  value: unknown,
  budget: ValidationBudget,
  depth = 0
): value is PublicationInline {
  if (
    !isRecord(value) ||
    depth > PUBLICATION_LIMITS.inlineDepth ||
    typeof value.kind !== "string" ||
    ++budget.inlineNodes > PUBLICATION_LIMITS.inlineNodes
  ) {
    return false;
  }
  if (value.kind === "TEXT") {
    if (!hasExactKeys(value, ["kind", "text"])) {
      return false;
    }
    return countText(
      value.text,
      budget,
      PUBLICATION_LIMITS.textCharacters
    );
  }
  if (value.kind === "RUBY") {
    return (
      hasExactKeys(value, ["kind", "annotation", "children"]) &&
      countText(
        value.annotation,
        budget,
        PUBLICATION_LIMITS.textCharacters,
        false
      ) &&
      Array.isArray(value.children) &&
      value.children.length > 0 &&
      value.children.length <= PUBLICATION_LIMITS.inlineChildren &&
      value.children.every((child) => isInline(child, budget, depth + 1))
    );
  }
  if (
    value.kind === "STRONG" ||
    value.kind === "EMPHASIS" ||
    value.kind === "UNDERLINE" ||
    value.kind === "STRIKE"
  ) {
    return (
      hasExactKeys(value, ["kind", "children"]) &&
      Array.isArray(value.children) &&
      value.children.length > 0 &&
      value.children.length <= PUBLICATION_LIMITS.inlineChildren &&
      value.children.every((child) => isInline(child, budget, depth + 1))
    );
  }
  return false;
}

function isBlock(value: unknown, budget: ValidationBudget): value is PublicationBlock {
  if (
    !isRecord(value) ||
    !isBoundedString(value.id, PUBLICATION_LIMITS.idCharacters) ||
    !isSource(value.source) ||
    ++budget.blocks > PUBLICATION_LIMITS.blocks
  ) {
    return false;
  }
  switch (value.kind) {
    case "HEADING":
      return (
        hasExactKeys(value, ["kind", "id", "level", "text", "source"]) &&
        value.source.rangeVerified === false &&
        value.source.start === null &&
        value.source.end === null &&
        (value.level === 1 ||
          value.level === 2 ||
          value.level === 3 ||
          value.level === 4) &&
        countText(value.text, budget, PUBLICATION_LIMITS.titleCharacters)
      );
    case "PARAGRAPH":
    case "QUOTE":
      return (
        value.source.sourceNodeId === value.source.sceneNodeId &&
        hasExactKeys(value, ["kind", "id", "inlines", "source"]) &&
        Array.isArray(value.inlines) &&
        value.inlines.length <= PUBLICATION_LIMITS.inlineChildren &&
        value.inlines.every((inline) => isInline(inline, budget))
      );
    case "SCENE_BREAK":
      return (
        hasExactKeys(value, ["kind", "id", "source"]) &&
        value.source.sourceNodeId === value.source.sceneNodeId
      );
    case "UNSUPPORTED":
      return (
        value.source.sourceNodeId === value.source.sceneNodeId &&
        hasExactKeys(value, ["kind", "id", "nodeType", "text", "source"]) &&
        isBoundedString(value.nodeType, PUBLICATION_LIMITS.nodeTypeCharacters) &&
        countText(value.text, budget, PUBLICATION_LIMITS.textCharacters)
      );
    default:
      return false;
  }
}

function countInlineCharacters(
  inlines: readonly PublicationInline[]
): { withSpaces: number; withoutSpaces: number } {
  let withSpaces = 0;
  let withoutSpaces = 0;
  const visit = (items: readonly PublicationInline[]): void => {
    for (const inline of items) {
      if (inline.kind === "TEXT") {
        for (const character of inline.text) {
          withSpaces += 1;
          if (!/\p{White_Space}/u.test(character)) {
            withoutSpaces += 1;
          }
        }
      } else {
        visit(inline.children);
      }
    }
  };
  visit(inlines);
  return { withSpaces, withoutSpaces };
}

export function isPublicationDocument(value: unknown): value is PublicationDocument {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "formatVersion",
      "projectId",
      "projectRevision",
      "scopeNodeId",
      "scopeKind",
      "metadata",
      "sections",
      "stats"
    ]) ||
    value.formatVersion !== 1
  ) {
    return false;
  }
  if (
    !isBoundedString(value.projectId, PUBLICATION_LIMITS.idCharacters) ||
    !isFiniteNonNegativeInteger(value.projectRevision) ||
    !isBoundedString(value.scopeNodeId, PUBLICATION_LIMITS.idCharacters) ||
    !(
      value.scopeKind === "WORK" ||
      value.scopeKind === "VOLUME" ||
      value.scopeKind === "CHAPTER" ||
      value.scopeKind === "SCENE"
    ) ||
    !isRecord(value.metadata) ||
    !hasExactKeys(value.metadata, ["title", "authorName", "language"]) ||
    !isBoundedString(value.metadata.title, PUBLICATION_LIMITS.titleCharacters) ||
    (value.metadata.authorName !== null &&
      !isBoundedString(value.metadata.authorName, PUBLICATION_LIMITS.titleCharacters, true)) ||
    value.metadata.language !== "ko" ||
    !Array.isArray(value.sections) ||
    value.sections.length > PUBLICATION_LIMITS.sections ||
    !isRecord(value.stats) ||
    !hasExactKeys(value.stats, [
      "withSpaces",
      "withoutSpaces",
      "paragraphCount",
      "sceneCount",
      "chapterCount"
    ])
  ) {
    return false;
  }

  const sectionIds = new Set<string>();
  const sectionSourceNodeIds = new Set<string>();
  const blockIds = new Set<string>();
  const sourceBlockIds = new Set<string>();
  const chapterSourceBlockIds = new Set<string>();
  let derivedWithSpaces = 0;
  let derivedWithoutSpaces = 0;
  let derivedParagraphCount = 0;
  const budget: ValidationBudget = {
    blocks: 0,
    inlineNodes: 0,
    textCharacters: value.metadata.title.length +
      (value.metadata.authorName?.length ?? 0)
  };
  for (const section of value.sections) {
    if (
      !isRecord(section) ||
      !hasExactKeys(section, [
        "id",
        "sourceNodeId",
        "kind",
        "title",
        "parentTitles",
        "blocks"
      ]) ||
      !isBoundedString(section.id, PUBLICATION_LIMITS.idCharacters) ||
      sectionIds.has(section.id) ||
      !isBoundedString(section.sourceNodeId, PUBLICATION_LIMITS.idCharacters) ||
      sectionSourceNodeIds.has(section.sourceNodeId) ||
      section.kind !== "SCENE" ||
      !isBoundedString(section.title, PUBLICATION_LIMITS.titleCharacters) ||
      !Array.isArray(section.parentTitles) ||
      section.parentTitles.length > PUBLICATION_LIMITS.parentTitles ||
      section.parentTitles.some(
        (title) =>
          !isBoundedString(title, PUBLICATION_LIMITS.titleCharacters, true)
      ) ||
      !Array.isArray(section.blocks) ||
      section.blocks.length > PUBLICATION_LIMITS.blocksPerSection
    ) {
      return false;
    }
    budget.textCharacters +=
      section.title.length +
      section.parentTitles.reduce((total, title) => total + title.length, 0);
    if (budget.textCharacters > PUBLICATION_LIMITS.textCharacters) {
      return false;
    }
    sectionIds.add(section.id);
    sectionSourceNodeIds.add(section.sourceNodeId);
    for (const block of section.blocks) {
      if (
        !isBlock(block, budget) ||
        blockIds.has(block.id) ||
        sourceBlockIds.has(block.source.blockId)
      ) {
        return false;
      }
      if (block.source.sceneNodeId !== section.sourceNodeId) {
        return false;
      }
      blockIds.add(block.id);
      sourceBlockIds.add(block.source.blockId);
      if (block.kind === "HEADING" && block.level === 3) {
        chapterSourceBlockIds.add(block.source.blockId);
      } else if (block.kind === "PARAGRAPH" || block.kind === "QUOTE") {
        const counts = countInlineCharacters(block.inlines);
        derivedWithSpaces += counts.withSpaces;
        derivedWithoutSpaces += counts.withoutSpaces;
        derivedParagraphCount += 1;
      } else if (block.kind === "UNSUPPORTED") {
        for (const character of block.text) {
          derivedWithSpaces += 1;
          if (!/\p{White_Space}/u.test(character)) {
            derivedWithoutSpaces += 1;
          }
        }
        if (block.nodeType === "paragraph") {
          derivedParagraphCount += 1;
        }
      }
    }
  }

  return (
    isFiniteNonNegativeInteger(value.stats.withSpaces) &&
    value.stats.withSpaces <= PUBLICATION_LIMITS.textCharacters &&
    isFiniteNonNegativeInteger(value.stats.withoutSpaces) &&
    value.stats.withoutSpaces <= value.stats.withSpaces &&
    isFiniteNonNegativeInteger(value.stats.paragraphCount) &&
    value.stats.paragraphCount <= PUBLICATION_LIMITS.blocks &&
    isFiniteNonNegativeInteger(value.stats.sceneCount) &&
    isFiniteNonNegativeInteger(value.stats.chapterCount) &&
    value.stats.chapterCount <= PUBLICATION_LIMITS.sections &&
    value.stats.sceneCount === value.sections.length &&
    value.stats.withSpaces === derivedWithSpaces &&
    value.stats.withoutSpaces === derivedWithoutSpaces &&
    value.stats.paragraphCount === derivedParagraphCount &&
    value.stats.chapterCount === chapterSourceBlockIds.size
  );
}

export function validatePublicationDocument(value: unknown): PublicationDocument {
  if (!isPublicationDocument(value)) {
    throw new Error("Publication IR v1 runtime validation에 실패했습니다.");
  }
  return value;
}
