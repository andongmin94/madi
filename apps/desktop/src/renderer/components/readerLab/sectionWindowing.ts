import type {
  PublicationSection,
  ReaderRenderConfig
} from "../../../shared/publication";
import { publicationBlockText } from "./readerStatistics";

export interface SectionLayoutItem {
  readonly section: PublicationSection;
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly height: number;
}

export interface SectionWindow {
  readonly items: readonly SectionLayoutItem[];
  readonly paddingBefore: number;
  readonly paddingAfter: number;
  readonly totalHeight: number;
}

export function estimateSectionHeight(
  section: PublicationSection,
  config: ReaderRenderConfig
): number {
  const contentWidth = Math.max(
    80,
    config.device.viewportWidth - config.settings.horizontalPadding * 2
  );
  const charactersPerLine = Math.max(
    1,
    Math.floor(contentWidth / (config.settings.fontSize * 0.78))
  );
  const lineHeight = config.settings.fontSize * config.settings.lineHeight;
  let height = lineHeight * 2.5;
  for (const block of section.blocks) {
    if (block.kind === "SCENE_BREAK") {
      height += Math.max(28, config.settings.paragraphSpacing * 2);
      continue;
    }
    if (block.kind === "HEADING") {
      height += lineHeight * 2;
      continue;
    }
    const characters = Array.from(publicationBlockText(block)).length;
    const lines = Math.max(1, Math.ceil(characters / charactersPerLine));
    height += lines * lineHeight + config.settings.paragraphSpacing;
  }
  return Math.max(120, Math.ceil(height));
}

export function buildSectionLayout(
  sections: readonly PublicationSection[],
  config: ReaderRenderConfig,
  measuredHeights: ReadonlyMap<string, number> = new Map()
): readonly SectionLayoutItem[] {
  let offset = 0;
  return sections.map((section, index) => {
    const measured = measuredHeights.get(section.id);
    const height =
      measured !== undefined && measured > 0
        ? measured
        : estimateSectionHeight(section, config);
    const item = {
      section,
      index,
      start: offset,
      end: offset + height,
      height
    };
    offset += height;
    return item;
  });
}

export function computeSectionWindow(
  layout: readonly SectionLayoutItem[],
  scrollTop: number,
  viewportHeight: number,
  overscan = 900
): SectionWindow {
  const totalHeight = layout.at(-1)?.end ?? 0;
  if (layout.length === 0) {
    return { items: [], paddingBefore: 0, paddingAfter: 0, totalHeight: 0 };
  }
  const windowStart = Math.max(0, scrollTop - overscan);
  const windowEnd = Math.max(windowStart, scrollTop + viewportHeight + overscan);
  let first = layout.findIndex((item) => item.end >= windowStart);
  if (first < 0) {
    first = layout.length - 1;
  }
  let last = first;
  while (last + 1 < layout.length && layout[last + 1]!.start <= windowEnd) {
    last += 1;
  }
  const items = layout.slice(first, last + 1);
  return {
    items,
    paddingBefore: items[0]?.start ?? 0,
    paddingAfter: Math.max(0, totalHeight - (items.at(-1)?.end ?? 0)),
    totalHeight
  };
}

export function shouldVirtualizeSections(
  sections: readonly PublicationSection[],
  charactersWithSpaces: number
): boolean {
  return sections.length > 12 || charactersWithSpaces > 100_000;
}
