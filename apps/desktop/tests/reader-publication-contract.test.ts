import { describe, expect, it } from "vitest";
import { BUILTIN_READER_PRESETS } from "../src/renderer/components/readerLab/builtinTemplates";
import { applyReaderOverrides } from "../src/renderer/components/readerLab/readerConfig";
import { validatePublicationDocument } from "../src/shared/publicationValidation";
import { validateReaderRenderConfig } from "../src/shared/readerConfigValidation";
import { readerPublication, readerSection } from "./reader-lab-fixtures";

describe("Reader Lab canonical runtime contracts", () => {
  it("accepts verified pairs and explicit unverified null source ranges", () => {
    const document = readerPublication();
    expect(validatePublicationDocument(document)).toBe(document);
    expect(document.sections[0]?.blocks[0]?.source).toMatchObject({
      start: null,
      end: null,
      rangeVerified: false
    });
  });

  it("rejects mixed-null, reversed, and falsely verified source ranges", () => {
    const base = readerPublication();
    const source = base.sections[0]!.blocks[0]!.source;
    for (const invalidSource of [
      { ...source, start: null, end: 4, rangeVerified: false },
      { ...source, start: 4, end: null, rangeVerified: false },
      { ...source, start: null, end: null, rangeVerified: true },
      { ...source, start: 0, end: 4, rangeVerified: false },
      { ...source, start: 9, end: 2, rangeVerified: true }
    ]) {
      const document = {
        ...base,
        sections: [
          {
            ...base.sections[0]!,
            blocks: [{ ...base.sections[0]!.blocks[0]!, source: invalidSource }]
          }
        ]
      };
      expect(() => validatePublicationDocument(document)).toThrow(
        /runtime validation/
      );
    }
  });

  it("accepts a verified zero-length caret range for an empty authored block", () => {
    const base = readerPublication();
    const block = base.sections[0]!.blocks[1]!;
    const document = {
      ...base,
      sections: [
        {
          ...base.sections[0]!,
          blocks: [
            base.sections[0]!.blocks[0]!,
            {
              ...block,
              source: { ...block.source, start: 4, end: 4, rangeVerified: true }
            }
          ]
        }
      ]
    };
    expect(validatePublicationDocument(document)).toBe(document);
  });

  it("allows a stable source identity to differ from its rendered block identity", () => {
    const base = readerPublication();
    const block = base.sections[0]!.blocks[1]!;
    const document = {
      ...base,
      sections: [
        {
          ...base.sections[0]!,
          blocks: [
            base.sections[0]!.blocks[0]!,
            {
              ...block,
              source: { ...block.source, blockId: "source-dot-hash" }
            }
          ]
        }
      ]
    };
    expect(validatePublicationDocument(document)).toBe(document);
  });

  it("keeps unique stable block identities across sections", () => {
    const duplicated = readerSection(2);
    const first = readerSection(1);
    const duplicateBlock = {
      ...duplicated.blocks[1]!,
      id: first.blocks[1]!.id,
      source: {
        ...duplicated.blocks[1]!.source,
        blockId: first.blocks[1]!.id
      }
    };
    expect(() =>
      validatePublicationDocument(
        readerPublication({
          sections: [
            first,
            { ...duplicated, blocks: [duplicated.blocks[0]!, duplicateBlock] }
          ]
        })
      )
    ).toThrow(/runtime validation/);
  });

  it("rejects duplicate source block and section source identities", () => {
    const first = readerSection(1);
    const second = readerSection(2);
    const repeatedSourceBlock = {
      ...second.blocks[1]!,
      source: {
        ...second.blocks[1]!.source,
        blockId: first.blocks[1]!.source.blockId
      }
    };
    expect(() =>
      validatePublicationDocument(
        readerPublication({
          sections: [
            first,
            { ...second, blocks: [second.blocks[0]!, repeatedSourceBlock] }
          ]
        })
      )
    ).toThrow(/runtime validation/);
    expect(() =>
      validatePublicationDocument(
        readerPublication({
          sections: [
            first,
            { ...second, sourceNodeId: first.sourceNodeId }
          ]
        })
      )
    ).toThrow(/runtime validation/);
  });

  it("validates all eleven editable built-in simulations without aliases", () => {
    expect(BUILTIN_READER_PRESETS).toHaveLength(11);
    for (const preset of BUILTIN_READER_PRESETS) {
      expect(validateReaderRenderConfig(preset.config)).toEqual(preset.config);
      expect(preset.sourceVersion).toBe("1");
      expect(preset.config.platform.verificationStatus).toBe(
        preset.config.platform.family === "PLATFORM_LIKE"
          ? "UNVERIFIED_SIMULATION"
          : "GENERIC"
      );
    }
  });

  it("rejects arbitrary font, CSS color, and out-of-range viewport values", () => {
    const base = BUILTIN_READER_PRESETS[0]!.config;
    for (const invalid of [
      { ...base, settings: { ...base.settings, fontFamilyToken: "url(http://font)" } },
      { ...base, settings: { ...base.settings, backgroundColor: "url(http://x)" } },
      { ...base, device: { ...base.device, viewportWidth: 279 } },
      {
        ...base,
        platform: { ...base.platform, name: "x".repeat(501) }
      },
      {
        ...base,
        platform: {
          ...base.platform,
          family: "GENERIC",
          verificationStatus: "UNVERIFIED_SIMULATION"
        }
      },
      {
        ...base,
        platform: { ...base.platform, verifiedAt: "not-a-timestamp" }
      },
      {
        ...base,
        platform: { ...base.platform, verifiedAt: "2026-02-30T12:34:56.789Z" }
      },
      { ...base, importedCss: "https://example.invalid/style.css" },
      {
        ...base,
        settings: {
          ...base.settings,
          externalFontUrl: "https://example.invalid/font.woff2"
        }
      },
      {
        ...base,
        device: {
          ...base.device,
          viewportHeight: 400,
          safeAreaTop: 100,
          safeAreaBottom: 100,
          readerChromeHeight: 200
        }
      },
      {
        ...base,
        device: { ...base.device, viewportWidth: 280 },
        settings: { ...base.settings, horizontalPadding: 140 }
      }
    ]) {
      expect(() => validateReaderRenderConfig(invalid)).toThrow();
    }

    expect(
      validateReaderRenderConfig({
        ...base,
        platform: { ...base.platform, verifiedAt: "2028-02-29T12:34:56.789Z" }
      }).platform.verifiedAt
    ).toBe("2028-02-29T12:34:56.789Z");
  });

  it("repairs relational viewport and padding overrides before render validation", () => {
    const builtin = BUILTIN_READER_PRESETS[0]!.config;
    const highInsetBase = validateReaderRenderConfig({
      ...builtin,
      device: {
        ...builtin.device,
        viewportHeight: 720,
        safeAreaTop: 150,
        safeAreaBottom: 150,
        readerChromeHeight: 150
      },
      settings: {
        ...builtin.settings,
        verticalPadding: 100
      }
    });
    const resolved = applyReaderOverrides(highInsetBase, {
      viewportWidth: 280,
      viewportHeight: 400,
      readerSettings: {
        horizontalPadding: 200,
        verticalPadding: 200
      }
    });

    expect(resolved.device.viewportHeight).toBe(451);
    expect(resolved.settings.horizontalPadding).toBe(139);
    expect(resolved.settings.verticalPadding).toBe(0);
    expect(validateReaderRenderConfig(resolved)).toEqual(resolved);
  });

  it("rejects oversized Publication breadth and text before unbounded traversal", () => {
    const base = readerPublication();
    expect(() =>
      validatePublicationDocument({
        ...base,
        sections: Array.from({ length: 20_001 }, () => base.sections[0])
      })
    ).toThrow(/runtime validation/);
    const block = base.sections[0]!.blocks[1]!;
    if (block.kind !== "PARAGRAPH") {
      throw new Error("fixture paragraph missing");
    }
    expect(() =>
      validatePublicationDocument({
        ...base,
        sections: [
          {
            ...base.sections[0]!,
            blocks: [
              base.sections[0]!.blocks[0]!,
              {
                ...block,
                inlines: [{ kind: "TEXT", text: "가".repeat(10_000_001) }]
              }
            ]
          }
        ]
      })
    ).toThrow(/runtime validation/);
  });

  it("rejects unknown Publication fields at every executable trust boundary", () => {
    const base = readerPublication();
    const block = base.sections[0]!.blocks[1]!;
    expect(() =>
      validatePublicationDocument({ ...base, html: "<script>bad()</script>" })
    ).toThrow(/runtime validation/);
    expect(() =>
      validatePublicationDocument({
        ...base,
        sections: [
          {
            ...base.sections[0]!,
            blocks: [
              base.sections[0]!.blocks[0]!,
              { ...block, href: "https://example.invalid" }
            ]
          }
        ]
      })
    ).toThrow(/runtime validation/);
  });

  it("matches Rust structural and derived-stat invariants", () => {
    const base = readerPublication();
    const heading = base.sections[0]!.blocks[0]!;
    const paragraph = base.sections[0]!.blocks[1]!;
    if (heading.kind !== "HEADING" || paragraph.kind !== "PARAGRAPH") {
      throw new Error("fixture block kinds are invalid");
    }
    const invalidBlocks = [
      {
        ...heading,
        source: { ...heading.source, start: 0, end: 1, rangeVerified: true }
      },
      { ...paragraph, inlines: [{ kind: "STRONG", children: [] }] },
      {
        ...paragraph,
        inlines: [{ kind: "RUBY", annotation: "", children: [{ kind: "TEXT", text: "가" }] }]
      },
      {
        kind: "UNSUPPORTED",
        id: "unsupported-empty-type",
        nodeType: "",
        text: "본문",
        source: { ...paragraph.source, blockId: "unsupported-source" }
      }
    ];
    for (const invalidBlock of invalidBlocks) {
      expect(() =>
        validatePublicationDocument({
          ...base,
          sections: [
            {
              ...base.sections[0]!,
              blocks: [invalidBlock, paragraph]
            }
          ]
        })
      ).toThrow(/runtime validation/);
    }
    expect(() =>
      validatePublicationDocument({
        ...base,
        sections: [{ ...base.sections[0]!, title: "" }]
      })
    ).toThrow(/runtime validation/);
    expect(() =>
      validatePublicationDocument({
        ...base,
        stats: { ...base.stats, withSpaces: base.stats.withSpaces + 1 }
      })
    ).toThrow(/runtime validation/);
  });
});
