import { describe, expect, it } from "vitest";
import { BUILTIN_READER_PRESETS } from "../src/renderer/components/readerLab/builtinTemplates";
import {
  buildReaderDiagnostics,
  estimateReaderStatistics
} from "../src/renderer/components/readerLab/readerStatistics";
import {
  buildSectionLayout,
  computeSectionWindow,
  shouldVirtualizeSections
} from "../src/renderer/components/readerLab/sectionWindowing";
import { readerPublication, readerSection, readerSource } from "./reader-lab-fixtures";

describe("Reader Lab long-work model", () => {
  it("windows a 450-scene, 600k+ character work without mounting all sections", () => {
    const longText = "가".repeat(1_400);
    const sections = Array.from({ length: 450 }, (_, index) =>
      readerSection(index + 1, longText)
    );
    const document = readerPublication({
      scopeNodeId: "work-1",
      scopeKind: "WORK",
      sections
    });
    expect(document.stats.withSpaces).toBeGreaterThan(600_000);
    expect(shouldVirtualizeSections(sections, document.stats.withSpaces)).toBe(true);

    const config = BUILTIN_READER_PRESETS[0]!.config;
    const layout = buildSectionLayout(sections, config);
    const atStart = computeSectionWindow(layout, 0, config.device.viewportHeight);
    const nearEnd = computeSectionWindow(
      layout,
      layout.at(-1)!.end - config.device.viewportHeight,
      config.device.viewportHeight
    );
    expect(atStart.items.length).toBeLessThan(12);
    expect(nearEnd.items.length).toBeLessThan(12);
    expect(nearEnd.items[0]!.index).toBeGreaterThan(430);
    expect(atStart.paddingAfter).toBeGreaterThan(0);
    expect(nearEnd.paddingBefore).toBeGreaterThan(0);
  });

  it("recalculates section estimates when typography or viewport changes", () => {
    const sections = [readerSection(1, "가".repeat(4_000))];
    const base = BUILTIN_READER_PRESETS[0]!.config;
    const larger = {
      ...base,
      device: { ...base.device, viewportWidth: 280 },
      settings: { ...base.settings, fontSize: 28, lineHeight: 2.2 }
    };
    const baseHeight = buildSectionLayout(sections, base)[0]!.height;
    const changedHeight = buildSectionLayout(sections, larger)[0]!.height;
    expect(changedHeight).toBeGreaterThan(baseHeight * 2);
  });

  it("reports fixed, non-judgmental diagnostics without echoing node types", () => {
    const unsupportedId = "unsupported-1";
    const sections = [
      readerSection(1, "가".repeat(2_000), [
        {
          kind: "UNSUPPORTED",
          id: unsupportedId,
          nodeType: "<script src=https://outside.invalid>",
          text: "안전한 fallback",
          source: readerSource(unsupportedId)
        },
        {
          kind: "SCENE_BREAK",
          id: "break-1",
          source: readerSource("break-1")
        },
        {
          kind: "SCENE_BREAK",
          id: "break-2",
          source: readerSource("break-2")
        }
      ])
    ];
    const document = readerPublication({ sections });
    const config = BUILTIN_READER_PRESETS[0]!.config;
    const diagnostics = buildReaderDiagnostics(document, config);
    expect(diagnostics.some((item) => item.code === "UNSUPPORTED_BLOCK")).toBe(true);
    expect(diagnostics.some((item) => item.code === "LONG_PARAGRAPH")).toBe(true);
    expect(diagnostics.some((item) => item.code === "CONSECUTIVE_SCENE_BREAKS")).toBe(true);
    expect(JSON.stringify(diagnostics)).not.toContain("outside.invalid");
    expect(JSON.stringify(diagnostics)).not.toMatch(/문장이 나쁘|독자가 이탈|호흡이 잘못/);
  });

  it("keeps source and estimated render statistics separate", () => {
    const document = readerPublication({
      sections: [readerSection(1, "한글 문단 ".repeat(500))]
    });
    const statistics = estimateReaderStatistics(
      document,
      BUILTIN_READER_PRESETS[0]!.config
    );
    expect(document.stats.withSpaces).toBeGreaterThan(0);
    expect(statistics.renderedContentHeight).toBeGreaterThan(0);
    expect(statistics.estimatedScreenCount).toBeGreaterThan(1);
    expect(statistics.longestParagraphLineCount).toBeGreaterThanOrEqual(8);
  });
});
