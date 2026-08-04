import type {
  PublicationBlock,
  PublicationDocument,
  PublicationInline,
  ReaderRenderConfig
} from "../../../shared/publication";
import type {
  ReaderLayoutDiagnostic,
  ReaderMeasuredBlockLayout,
  ReaderRenderStatistics
} from "./types";

export function publicationInlineText(
  inlines: readonly PublicationInline[]
): string {
  return inlines
    .map((inline) =>
      inline.kind === "TEXT"
        ? inline.text
        : publicationInlineText(inline.children)
    )
    .join("");
}

export function publicationBlockText(block: PublicationBlock): string {
  switch (block.kind) {
    case "HEADING":
      return block.text;
    case "PARAGRAPH":
    case "QUOTE":
      return publicationInlineText(block.inlines);
    case "UNSUPPORTED":
      return block.text;
    case "SCENE_BREAK":
      return "";
  }
}

interface ParagraphEstimate {
  readonly block: PublicationBlock;
  readonly lineCount: number;
  readonly height: number;
  readonly empty: boolean;
}

function estimateParagraphs(
  document: PublicationDocument,
  config: ReaderRenderConfig
): readonly ParagraphEstimate[] {
  const contentWidth = Math.max(
    80,
    config.device.viewportWidth - config.settings.horizontalPadding * 2
  );
  const charactersPerLine = Math.max(
    1,
    Math.floor(contentWidth / (config.settings.fontSize * 0.78))
  );
  const lineHeightPx = config.settings.fontSize * config.settings.lineHeight;
  const estimates: ParagraphEstimate[] = [];

  for (const section of document.sections) {
    for (const block of section.blocks) {
      if (
        block.kind !== "PARAGRAPH" &&
        block.kind !== "QUOTE" &&
        block.kind !== "UNSUPPORTED"
      ) {
        continue;
      }
      const text = publicationBlockText(block);
      const explicitLines = text.split("\n");
      const lineCount = Math.max(
        1,
        explicitLines.reduce(
          (total, line) =>
            total + Math.max(1, Math.ceil(Array.from(line).length / charactersPerLine)),
          0
        )
      );
      estimates.push({
        block,
        lineCount,
        height: lineCount * lineHeightPx + config.settings.paragraphSpacing,
        empty: text.trim().length === 0
      });
    }
  }
  return estimates;
}

function countEmptyRuns(estimates: readonly ParagraphEstimate[]): number {
  let runs = 0;
  let consecutive = 0;
  for (const estimate of estimates) {
    if (estimate.empty) {
      consecutive += 1;
      continue;
    }
    if (consecutive >= 3) {
      runs += 1;
    }
    consecutive = 0;
  }
  return runs + (consecutive >= 3 ? 1 : 0);
}

export function estimateReaderStatistics(
  document: PublicationDocument,
  config: ReaderRenderConfig
): ReaderRenderStatistics {
  const estimates = estimateParagraphs(document, config);
  const effectiveViewportHeight = Math.max(
    1,
    config.device.viewportHeight -
      config.device.safeAreaTop -
      config.device.safeAreaBottom -
      config.device.readerChromeHeight
  );
  const headingHeight =
    document.sections.length * config.settings.fontSize * config.settings.lineHeight * 2.1;
  const breakHeight = document.sections.reduce(
    (total, section) =>
      total +
      section.blocks.filter((block) => block.kind === "SCENE_BREAK").length *
        Math.max(28, config.settings.paragraphSpacing * 2),
    0
  );
  const renderedContentHeight = Math.ceil(
    config.settings.verticalPadding * 2 +
      headingHeight +
      breakHeight +
      estimates.reduce((total, estimate) => total + estimate.height, 0)
  );
  const estimatedScreenCount = Math.max(
    1,
    Math.ceil(renderedContentHeight / effectiveViewportHeight)
  );
  return {
    measurementStatus: "ESTIMATED",
    measuredSectionCount: 0,
    measuredBlockCount: 0,
    totalSectionCount: document.sections.length,
    renderedContentHeight,
    viewportHeight: effectiveViewportHeight,
    estimatedScreenCount,
    averageCharactersPerScreen: Math.round(
      document.stats.withSpaces / estimatedScreenCount
    ),
    longestParagraphLineCount: estimates.reduce(
      (max, estimate) => Math.max(max, estimate.lineCount),
      0
    ),
    paragraphsAtLeastEightLines: estimates.filter(
      (estimate) => estimate.lineCount >= 8
    ).length,
    consecutiveEmptyParagraphRuns: countEmptyRuns(estimates),
    horizontalOverflowCount: 0
  };
}

export function buildReaderDiagnostics(
  document: PublicationDocument,
  config: ReaderRenderConfig,
  lineThreshold = 8,
  measuredBlocks: readonly ReaderMeasuredBlockLayout[] = []
): readonly ReaderLayoutDiagnostic[] {
  const estimates = estimateParagraphs(document, config);
  const measuredByBlockId = new Map(
    measuredBlocks.map((measurement) => [measurement.blockId, measurement])
  );
  const diagnostics: ReaderLayoutDiagnostic[] = [];
  const effectiveViewportHeight = Math.max(
    1,
    config.device.viewportHeight -
      config.device.safeAreaTop -
      config.device.safeAreaBottom -
      config.device.readerChromeHeight
  );

  for (const estimate of estimates) {
    const measured = measuredByBlockId.get(estimate.block.id);
    const lineCount = measured?.lineCount ?? estimate.lineCount;
    const renderedHeight = measured?.renderedHeight ?? estimate.height;
    if (estimate.block.kind === "UNSUPPORTED") {
      diagnostics.push({
        id: `unsupported:${estimate.block.id}`,
        code: "UNSUPPORTED_BLOCK",
        message: "지원하지 않는 block을 안전한 plain text로 표시했습니다.",
        blockId: estimate.block.id,
        source: estimate.block.source
      });
    }
    if (lineCount >= lineThreshold) {
      diagnostics.push({
        id: `long:${estimate.block.id}`,
        code: "LONG_PARAGRAPH",
        message: measured
          ? `이 문단은 전체 scope 실제 render에서 ${lineCount}줄로 측정됐습니다.`
          : `이 문단은 현재 설정에서 약 ${lineCount}줄로 표시됩니다.`,
        blockId: estimate.block.id,
        source: estimate.block.source
      });
    }
    if (renderedHeight > effectiveViewportHeight) {
      diagnostics.push({
        id: `viewport:${estimate.block.id}`,
        code: "PARAGRAPH_TALLER_THAN_VIEWPORT",
        message: measured
          ? "이 문단은 실제 render에서 한 화면보다 길게 측정됐습니다."
          : "이 문단은 현재 설정에서 한 화면보다 길게 표시될 수 있습니다.",
        blockId: estimate.block.id,
        source: estimate.block.source
      });
    }
  }

  for (const section of document.sections) {
    for (let index = 1; index < section.blocks.length; index += 1) {
      const current = section.blocks[index]!;
      const previous = section.blocks[index - 1]!;
      if (current.kind === "SCENE_BREAK" && previous.kind === "SCENE_BREAK") {
        diagnostics.push({
          id: `break:${current.id}`,
          code: "CONSECUTIVE_SCENE_BREAKS",
          message: "장면 구분선이 연속으로 배치된 구간입니다.",
          blockId: current.id,
          source: current.source
        });
      }
    }
  }

  let emptyStart: ParagraphEstimate | null = null;
  let emptyCount = 0;
  for (const estimate of estimates) {
    if (estimate.empty) {
      emptyStart ??= estimate;
      emptyCount += 1;
      continue;
    }
    if (emptyStart && emptyCount >= 3) {
      diagnostics.push({
        id: `empty:${emptyStart.block.id}`,
        code: "CONSECUTIVE_EMPTY_PARAGRAPHS",
        message: `빈 문단이 ${emptyCount}개 연속된 구간입니다.`,
        blockId: emptyStart.block.id,
        source: emptyStart.block.source
      });
    }
    emptyStart = null;
    emptyCount = 0;
  }
  if (emptyStart && emptyCount >= 3) {
    diagnostics.push({
      id: `empty:${emptyStart.block.id}`,
      code: "CONSECUTIVE_EMPTY_PARAGRAPHS",
      message: `빈 문단이 ${emptyCount}개 연속된 구간입니다.`,
      blockId: emptyStart.block.id,
      source: emptyStart.block.source
    });
  }

  return diagnostics;
}
