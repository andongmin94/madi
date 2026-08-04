import type {
  CompilePublicationResult,
  PublicationBlock,
  PublicationDocument,
  PublicationScopeKind,
  PublicationSection,
  PublicationSourceReference
} from "../src/shared/publication";

export const READER_NOW = "2026-08-09T00:00:00.000Z";

export function readerSource(
  blockId: string,
  sceneNodeId = "scene-1",
  documentId = "document-1",
  rangeVerified = true
): PublicationSourceReference {
  return {
    sourceNodeId: sceneNodeId,
    sceneNodeId,
    documentId,
    blockId,
    start: rangeVerified ? 0 : null,
    end: rangeVerified ? 4 : null,
    rangeVerified
  };
}

export function readerParagraph(
  id: string,
  text: string,
  sceneNodeId = "scene-1",
  documentId = "document-1"
): PublicationBlock {
  return {
    kind: "PARAGRAPH",
    id,
    inlines: [{ kind: "TEXT", text }],
    source: readerSource(id, sceneNodeId, documentId)
  };
}

export function readerHierarchySource(
  blockId: string,
  sourceNodeId: string,
  sceneNodeId = sourceNodeId,
  documentId = sourceNodeId.replace(/^scene-/u, "document-")
): PublicationSourceReference {
  return {
    sourceNodeId,
    sceneNodeId,
    documentId,
    blockId,
    start: null,
    end: null,
    rangeVerified: false
  };
}

export function readerSection(
  index: number,
  text = `한국어 Reader Lab 본문 ${index}`,
  extraBlocks: readonly PublicationBlock[] = []
): PublicationSection {
  const sceneNodeId = `scene-${index}`;
  const documentId = `document-${index}`;
  const headingId = `heading-${index}`;
  return {
    id: `section-${index}`,
    sourceNodeId: sceneNodeId,
    kind: "SCENE",
    title: `${index}번째 장면`,
    parentTitles: ["작품", "1권", "1화"],
    blocks: [
      {
        kind: "HEADING",
        id: headingId,
        level: 4,
        text: `${index}번째 장면`,
        source: readerHierarchySource(headingId, sceneNodeId)
      },
      readerParagraph(`paragraph-${index}`, text, sceneNodeId, documentId),
      ...extraBlocks
    ]
  };
}

export function readerPublication(
  options: {
    readonly scopeNodeId?: string;
    readonly scopeKind?: PublicationScopeKind;
    readonly revision?: number;
    readonly sections?: readonly PublicationSection[];
    readonly title?: string;
  } = {}
): PublicationDocument {
  const sections = options.sections ?? [readerSection(1)];
  const texts = sections.flatMap((section) =>
    section.blocks.flatMap((block) =>
      block.kind === "UNSUPPORTED"
        ? [block.text]
        : block.kind === "PARAGRAPH" || block.kind === "QUOTE"
          ? [
              block.inlines
                .map((inline) => (inline.kind === "TEXT" ? inline.text : ""))
                .join("")
            ]
          : []
    )
  );
  const joined = texts.join("");
  return {
    formatVersion: 1,
    projectId: "project-1",
    projectRevision: options.revision ?? 5,
    scopeNodeId: options.scopeNodeId ?? "scene-1",
    scopeKind: options.scopeKind ?? "SCENE",
    metadata: {
      title: options.title ?? "Reader Lab Test",
      authorName: "테스트 작가",
      language: "ko"
    },
    sections,
    stats: {
      withSpaces: Array.from(joined).length,
      withoutSpaces: Array.from(joined.replace(/\s/gu, "")).length,
      paragraphCount: sections.reduce(
        (count, section) =>
          count +
          section.blocks.filter(
            (block) =>
              block.kind === "PARAGRAPH" ||
              block.kind === "QUOTE" ||
              (block.kind === "UNSUPPORTED" && block.nodeType === "paragraph")
          ).length,
        0
      ),
      sceneCount: sections.length,
      chapterCount: new Set(
        sections.flatMap((section) =>
          section.blocks
            .filter(
              (block) => block.kind === "HEADING" && block.level === 3
            )
            .map((block) => block.source.blockId)
        )
      ).size
    }
  };
}

export function readerCompileResult(
  document = readerPublication()
): CompilePublicationResult {
  return {
    document,
    contentHash: "a".repeat(64),
    diagnostics: [],
    compileTimingMs: 7.5,
    revision: document.projectRevision
  };
}
