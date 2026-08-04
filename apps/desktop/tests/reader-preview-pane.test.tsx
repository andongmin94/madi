import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BUILTIN_READER_PRESETS } from "../src/renderer/components/readerLab/builtinTemplates";
import { ReaderPreviewPane } from "../src/renderer/components/readerLab/ReaderPreviewPane";
import { estimateReaderStatistics } from "../src/renderer/components/readerLab/readerStatistics";
import {
  readerPublication,
  readerHierarchySource,
  readerParagraph,
  readerSection,
  readerSource
} from "./reader-lab-fixtures";

describe("Reader Lab isolated semantic preview", () => {
  it("renders manuscript markup as text in Shadow DOM without executable or external nodes", async () => {
    const raw = '<script>globalThis.pwned=true</script><img src="https://outside.invalid/a.png">';
    const document = readerPublication({
      sections: [readerSection(1, raw)]
    });
    const onOpenSource = vi.fn();
    const { getByTestId } = render(
      <ReaderPreviewPane
        paneIndex={0}
        paneName="보안 preview"
        contentHash={"a".repeat(64)}
        document={document}
        config={BUILTIN_READER_PRESETS[0]!.config}
        zoom={1}
        selectedBlockId={null}
        scrollProgress={0}
        scrollSync={false}
        onScrollProgress={vi.fn()}
        onSelectionScrollProgress={vi.fn()}
        onSelectBlock={vi.fn()}
        onOpenSource={onOpenSource}
        onStatistics={vi.fn()}
        onMeasuredBlocks={vi.fn()}
        onFirstVisible={vi.fn()}
      />
    );
    const host = getByTestId("reader-shadow-host-1");
    await waitFor(() => expect(host.shadowRoot).not.toBeNull());
    const shadow = host.shadowRoot!;
    expect(shadow.textContent).toContain(raw);
    expect(shadow.querySelector("script")).toBeNull();
    expect(shadow.querySelector("img")).toBeNull();
    expect(shadow.querySelector("link")).toBeNull();
    expect(shadow.querySelector("iframe")).toBeNull();
    expect(shadow.querySelector("[src], [href]")).toBeNull();

    const paragraph = shadow.querySelector<HTMLElement>(
      '[data-reader-block-id="paragraph-1"]'
    )!;
    fireEvent.click(paragraph);
    expect(onOpenSource).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneNodeId: "scene-1",
        blockId: "paragraph-1",
        rangeVerified: true
      })
    );
  });

  it("omits hidden scene breaks from keyboard order", async () => {
    const breakId = "hidden-break";
    const section = readerSection(1, "본문", [
      {
        kind: "SCENE_BREAK",
        id: breakId,
        source: readerSource(breakId)
      }
    ]);
    const base = BUILTIN_READER_PRESETS[0]!.config;
    const hidden = {
      ...base,
      settings: { ...base.settings, showSceneBreak: false },
      workStyle: { ...base.workStyle, sceneBreakStyleToken: "HIDDEN" as const }
    };
    const { getByTestId } = render(
      <ReaderPreviewPane
        paneIndex={0}
        paneName="숨김 테스트"
        contentHash={"a".repeat(64)}
        document={readerPublication({ sections: [section] })}
        config={hidden}
        zoom={1}
        selectedBlockId={null}
        scrollProgress={0}
        scrollSync={false}
        onScrollProgress={vi.fn()}
        onSelectionScrollProgress={vi.fn()}
        onSelectBlock={vi.fn()}
        onOpenSource={vi.fn()}
        onStatistics={vi.fn()}
        onMeasuredBlocks={vi.fn()}
        onFirstVisible={vi.fn()}
      />
    );
    const host = getByTestId("reader-shadow-host-1");
    await waitFor(() => expect(host.shadowRoot).not.toBeNull());
    expect(
      host.shadowRoot!.querySelector(`[data-reader-block-id="${breakId}"]`)
    ).toBeNull();
    expect(
      host.shadowRoot!.querySelectorAll('[role="button"][tabindex="0"]')
        .length
    ).toBe(1);
  });

  it("applies compact chapter and hidden scene WorkStyle tokens", async () => {
    const section = readerSection(1);
    const config = {
      ...BUILTIN_READER_PRESETS[0]!.config,
      workStyle: {
        ...BUILTIN_READER_PRESETS[0]!.config.workStyle,
        chapterTitleStyleToken: "CHAPTER_COMPACT" as const,
        sceneTitleStyleToken: "SCENE_HIDDEN" as const
      }
    };
    const { getByTestId } = render(
      <ReaderPreviewPane
        paneIndex={0}
        paneName="work style"
        contentHash={"a".repeat(64)}
        document={readerPublication({
          sections: [
            {
              ...section,
              blocks: [
                {
                  kind: "HEADING",
                  id: "chapter-heading",
                  level: 3,
                  text: "1화",
                  source: readerHierarchySource(
                    "chapter-heading",
                    "chapter-1",
                    "scene-1",
                    "document-1"
                  )
                },
                ...section.blocks
              ]
            }
          ]
        })}
        config={config}
        zoom={1}
        selectedBlockId={null}
        scrollProgress={0}
        scrollSync={false}
        onScrollProgress={vi.fn()}
        onSelectionScrollProgress={vi.fn()}
        onSelectBlock={vi.fn()}
        onOpenSource={vi.fn()}
        onStatistics={vi.fn()}
        onMeasuredBlocks={vi.fn()}
        onFirstVisible={vi.fn()}
      />
    );
    const host = getByTestId("reader-shadow-host-1");
    await waitFor(() => expect(host.shadowRoot).not.toBeNull());
    expect(
      host.shadowRoot!.querySelector('[data-reader-block-id="chapter-heading"]')
        ?.classList.contains("reader-block--chapter-compact")
    ).toBe(true);
    expect(
      host.shadowRoot!.querySelector('[data-reader-block-id="heading-1"]')
    ).toBeNull();
  });

  it("reserves chrome and safe areas consistently with effective viewport statistics", async () => {
    const config = BUILTIN_READER_PRESETS[0]!.config;
    const document = readerPublication();
    const statistics = estimateReaderStatistics(document, config);
    const { getByTestId } = render(
      <ReaderPreviewPane
        paneIndex={0}
        paneName="viewport 테스트"
        contentHash={"a".repeat(64)}
        document={document}
        config={config}
        zoom={1}
        selectedBlockId={null}
        scrollProgress={0}
        scrollSync={false}
        onScrollProgress={vi.fn()}
        onSelectionScrollProgress={vi.fn()}
        onSelectBlock={vi.fn()}
        onOpenSource={vi.fn()}
        onStatistics={vi.fn()}
        onMeasuredBlocks={vi.fn()}
        onFirstVisible={vi.fn()}
      />
    );
    const host = getByTestId("reader-shadow-host-1");
    await waitFor(() => expect(host.shadowRoot).not.toBeNull());
    const pane = host.closest<HTMLElement>("[data-reader-pane]")!;
    await waitFor(() =>
      expect(pane.dataset.readerMeasurementStatus).toBe("complete")
    );
    expect(pane.dataset.readerCanonicalSectionCount).toBe("1");
    expect(pane.dataset.readerCanonicalBlockCount).toBe("2");
    expect(pane.dataset.readerMountedSectionCount).toBe("1");
    expect(pane.dataset.readerDeviceCategory).toBe(config.device.category);
    expect(pane.dataset.readerViewportWidth).toBe(
      String(config.device.viewportWidth)
    );
    expect(
      host.shadowRoot!.querySelector<HTMLElement>(
        '[data-reader-measurement-status="complete"]'
      )?.dataset.readerMeasuredSectionCount
    ).toBe("1");
    const chrome = host.shadowRoot!.querySelector<HTMLElement>(
      ".reader-device-chrome"
    )!;
    const viewport = host.shadowRoot!.querySelector<HTMLElement>(
      ".reader-safe-viewport"
    )!;
    expect(chrome.style.height).toBe(`${config.device.readerChromeHeight}px`);
    expect(viewport.style.height).toBe(
      `${config.device.viewportHeight - config.device.readerChromeHeight}px`
    );
    expect(viewport.style.paddingTop).toBe(`${config.device.safeAreaTop}px`);
    expect(viewport.style.paddingBottom).toBe(`${config.device.safeAreaBottom}px`);
    expect(statistics.viewportHeight).toBe(
      config.device.viewportHeight -
        config.device.readerChromeHeight -
        config.device.safeAreaTop -
        config.device.safeAreaBottom
    );
  });

  it("guards programmatic scroll sync from feedback and preserves measurement identity", async () => {
    const document = readerPublication();
    const config = BUILTIN_READER_PRESETS[0]!.config;
    const onScrollProgress = vi.fn();
    const onMeasuredBlocks = vi.fn();
    const props = {
      paneIndex: 0,
      paneName: "scroll guard",
      contentHash: "a".repeat(64),
      document,
      config,
      zoom: 1,
      selectedBlockId: null,
      scrollSync: true,
      onScrollProgress,
      onSelectionScrollProgress: vi.fn(),
      onSelectBlock: vi.fn(),
      onOpenSource: vi.fn(),
      onStatistics: vi.fn(),
      onMeasuredBlocks,
      onFirstVisible: vi.fn()
    } as const;
    const rendered = render(
      <ReaderPreviewPane {...props} scrollProgress={0} />
    );
    const host = rendered.getByTestId("reader-shadow-host-1");
    await waitFor(() => expect(host.shadowRoot).not.toBeNull());
    const scroller = host.shadowRoot!.querySelector<HTMLElement>(
      ".reader-scroll"
    )!;
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      value: 2_000
    });
    Object.defineProperty(scroller, "clientHeight", {
      configurable: true,
      value: 500
    });
    await waitFor(() => expect(onMeasuredBlocks).toHaveBeenCalledTimes(2));

    for (let index = 1; index <= 10; index += 1) {
      rendered.rerender(
        <ReaderPreviewPane {...props} scrollProgress={index / 10} />
      );
      fireEvent.scroll(scroller);
    }
    expect(onScrollProgress).not.toHaveBeenCalled();
    expect(onMeasuredBlocks).toHaveBeenCalledTimes(2);

    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    scroller.scrollTop = 900;
    fireEvent.scroll(scroller);
    expect(onScrollProgress).toHaveBeenLastCalledWith(0, 0.6);
  });

  it("keeps restored scroll authoritative and persists later selection alignment per pane", async () => {
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockReturnValue(2_000);
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockReturnValue(500);
    try {
      const document = readerPublication({
        sections: Array.from({ length: 12 }, (_, index) =>
          readerSection(index + 1, `복원 본문 ${index + 1}`)
        )
      });
      const config = BUILTIN_READER_PRESETS[0]!.config;
      const onScrollProgress = vi.fn();
      const onSelectionScrollProgress = vi.fn();
      const stableProps = {
        paneIndex: 0,
        paneName: "restored scroll",
        contentHash: "d".repeat(64),
        document,
        config,
        zoom: 1,
        scrollSync: true,
        onScrollProgress,
        onSelectionScrollProgress,
        onSelectBlock: vi.fn(),
        onOpenSource: vi.fn(),
        onStatistics: vi.fn(),
        onMeasuredBlocks: vi.fn(),
        onFirstVisible: vi.fn()
      } as const;
      const rendered = render(
        <ReaderPreviewPane
          {...stableProps}
          selectedBlockId="paragraph-1"
          scrollProgress={0.4}
        />
      );
      const host = rendered.getByTestId("reader-shadow-host-1");
      await waitFor(() => expect(host.shadowRoot).not.toBeNull());
      const scroller = host.shadowRoot!.querySelector<HTMLElement>(
        ".reader-scroll"
      )!;

      await waitFor(() => expect(scroller.scrollTop).toBe(600));
      expect(onSelectionScrollProgress).not.toHaveBeenCalled();

      rendered.rerender(
        <ReaderPreviewPane
          {...stableProps}
          selectedBlockId="paragraph-12"
          scrollProgress={0.4}
        />
      );
      await waitFor(() =>
        expect(onSelectionScrollProgress).toHaveBeenCalledTimes(1)
      );
      const alignedProgress = onSelectionScrollProgress.mock.calls[0]?.[1];
      expect(alignedProgress).toBeGreaterThan(0.4);
      expect(alignedProgress).toBeLessThanOrEqual(1);
      expect(scroller.scrollTop).toBeCloseTo(alignedProgress * 1_500, 5);
      expect(onScrollProgress).not.toHaveBeenCalled();

      rendered.rerender(
        <ReaderPreviewPane
          {...stableProps}
          selectedBlockId="paragraph-12"
          scrollProgress={alignedProgress}
        />
      );
      await waitFor(() =>
        expect(scroller.scrollTop).toBeCloseTo(alignedProgress * 1_500, 5)
      );
      expect(onSelectionScrollProgress).toHaveBeenCalledTimes(1);
    } finally {
      scrollHeightSpy.mockRestore();
      clientHeightSpy.mockRestore();
    }
  });

  it("releases programmatic scroll suppression when scroll effects are cleaned up", async () => {
    const document = readerPublication({
      sections: Array.from({ length: 12 }, (_, index) =>
        readerSection(index + 1, `cleanup 본문 ${index + 1}`)
      )
    });
    const config = BUILTIN_READER_PRESETS[0]!.config;
    const onScrollProgress = vi.fn();
    const onSelectionScrollProgress = vi.fn();
    const stableProps = {
      paneIndex: 0,
      paneName: "suppression cleanup",
      contentHash: "e".repeat(64),
      document,
      zoom: 1,
      scrollProgress: 0,
      scrollSync: true,
      onScrollProgress,
      onSelectionScrollProgress,
      onSelectBlock: vi.fn(),
      onOpenSource: vi.fn(),
      onStatistics: vi.fn(),
      onMeasuredBlocks: vi.fn(),
      onFirstVisible: vi.fn()
    } as const;
    const rendered = render(
      <ReaderPreviewPane
        {...stableProps}
        config={config}
        selectedBlockId="paragraph-1"
      />
    );
    const host = rendered.getByTestId("reader-shadow-host-1");
    await waitFor(() => expect(host.shadowRoot).not.toBeNull());
    const scroller = host.shadowRoot!.querySelector<HTMLElement>(
      ".reader-scroll"
    )!;
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      value: 2_000
    });
    Object.defineProperty(scroller, "clientHeight", {
      configurable: true,
      value: 500
    });
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(() => 91);
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame");
    try {
      rendered.rerender(
        <ReaderPreviewPane
          {...stableProps}
          config={config}
          selectedBlockId="paragraph-12"
        />
      );
      await waitFor(() =>
        expect(onSelectionScrollProgress).toHaveBeenCalledTimes(1)
      );

      rendered.rerender(
        <ReaderPreviewPane
          {...stableProps}
          config={{ ...config }}
          selectedBlockId="paragraph-12"
        />
      );
      expect(cancelFrame).toHaveBeenCalledWith(91);

      onScrollProgress.mockClear();
      scroller.scrollTop = 750;
      fireEvent.scroll(scroller);
      expect(onScrollProgress).toHaveBeenCalledWith(0, 0.5);

      Object.defineProperty(scroller, "scrollHeight", {
        configurable: true,
        value: 100_000
      });
      onScrollProgress.mockClear();
      rendered.rerender(
        <ReaderPreviewPane
          {...stableProps}
          config={{ ...config }}
          selectedBlockId="paragraph-12"
          scrollProgress={0.2}
        />
      );
      expect(scroller.scrollTop).toBe(19_900);
      rendered.rerender(
        <ReaderPreviewPane
          {...stableProps}
          config={{
            ...config,
            settings: {
              ...config.settings,
              fontSize: config.settings.fontSize + 1
            }
          }}
          selectedBlockId="paragraph-12"
          scrollProgress={0.2}
        />
      );

      scroller.scrollTop = 49_750;
      fireEvent.scroll(scroller);
      expect(onScrollProgress).toHaveBeenCalledWith(0, 0.5);
    } finally {
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
    }
  });

  it("moves keyboard focus within one section and across an offscreen 450-scene window", async () => {
    const sections = Array.from({ length: 450 }, (_, index) =>
      readerSection(index + 1, `장면 ${index + 1} ${"가".repeat(1_400)}`)
    );
    const longDocument = readerPublication({ sections });
    const config = BUILTIN_READER_PRESETS[0]!.config;
    const onSelectBlock = vi.fn();
    const onStatistics = vi.fn();
    const onMeasuredBlocks = vi.fn();
    const rendered = render(
      <ReaderPreviewPane
        paneIndex={0}
        paneName="keyboard window"
        contentHash={"a".repeat(64)}
        document={longDocument}
        config={config}
        zoom={1}
        selectedBlockId={null}
        scrollProgress={0}
        scrollSync={false}
        onScrollProgress={vi.fn()}
        onSelectionScrollProgress={vi.fn()}
        onSelectBlock={onSelectBlock}
        onOpenSource={vi.fn()}
        onStatistics={onStatistics}
        onMeasuredBlocks={onMeasuredBlocks}
        onFirstVisible={vi.fn()}
      />
    );
    const host = rendered.getByTestId("reader-shadow-host-1");
    await waitFor(() => expect(host.shadowRoot).not.toBeNull());
    const shadow = host.shadowRoot!;
    const firstHeading = shadow.querySelector<HTMLElement>(
      '[data-reader-block-id="heading-1"]'
    )!;
    firstHeading.focus();

    fireEvent.keyDown(firstHeading, { key: "ArrowDown" });
    expect(shadow.activeElement?.getAttribute("data-reader-block-id")).toBe(
      "paragraph-1"
    );
    expect(onSelectBlock).toHaveBeenLastCalledWith("paragraph-1");

    fireEvent.keyDown(shadow.activeElement as HTMLElement, { key: "End" });
    await waitFor(() =>
      expect(shadow.activeElement?.getAttribute("data-reader-block-id")).toBe(
        "paragraph-450"
      )
    );
    expect(shadow.querySelectorAll("[data-reader-section-id]").length).toBeLessThan(
      450
    );

    fireEvent.keyDown(shadow.activeElement as HTMLElement, { key: "Home" });
    await waitFor(() =>
      expect(shadow.activeElement?.getAttribute("data-reader-block-id")).toBe(
        "heading-1"
      )
    );

    rendered.rerender(
      <ReaderPreviewPane
        paneIndex={0}
        paneName="keyboard window"
        contentHash={"a".repeat(64)}
        document={longDocument}
        config={config}
        zoom={1}
        selectedBlockId="paragraph-450"
        scrollProgress={0}
        scrollSync={false}
        onScrollProgress={vi.fn()}
        onSelectionScrollProgress={vi.fn()}
        onSelectBlock={onSelectBlock}
        onOpenSource={vi.fn()}
        onStatistics={onStatistics}
        onMeasuredBlocks={onMeasuredBlocks}
        onFirstVisible={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(
        shadow.querySelectorAll('[data-reader-block-id][tabindex="0"]').length
      ).toBe(1)
    );
    expect(
      shadow
        .querySelector('[data-reader-block-id][tabindex="0"]')
        ?.getAttribute("data-reader-block-id")
    ).not.toBe("paragraph-450");

    await waitFor(
      () =>
        expect(
          onStatistics.mock.calls.some(
            ([, statistics]) => statistics.measuredSectionCount >= 25
          )
        ).toBe(true),
      { timeout: 10_000 }
    );
    for (let index = 0; index < 10; index += 1) {
      rendered.rerender(
        <ReaderPreviewPane
          paneIndex={0}
          paneName="keyboard window"
          contentHash={"a".repeat(64)}
          document={longDocument}
          config={config}
          zoom={1}
          selectedBlockId={null}
          scrollProgress={index / 10}
          scrollSync={false}
          onScrollProgress={vi.fn()}
          onSelectionScrollProgress={vi.fn()}
          onSelectBlock={onSelectBlock}
          onOpenSource={vi.fn()}
          onStatistics={onStatistics}
          onMeasuredBlocks={onMeasuredBlocks}
          onFirstVisible={vi.fn()}
        />
      );
    }
    await waitFor(
      () =>
        expect(
          onStatistics.mock.calls.some(
            ([, statistics]) =>
              statistics.measurementStatus === "COMPLETE" &&
              statistics.measuredSectionCount === 450 &&
              statistics.measuredBlockCount === 900
          )
        ).toBe(true),
      { timeout: 10_000 }
    );
    const pane = host.closest<HTMLElement>("[data-reader-pane]")!;
    expect(pane.dataset.readerCanonicalBlockCount).toBe("900");
    expect(pane.dataset.readerMeasuredBlockCount).toBe("900");
    expect(
      onStatistics.mock.calls.filter(
        ([, statistics]) => statistics.measuredSectionCount === 1
      )
    ).toHaveLength(1);
    expect(
      shadow.querySelectorAll("[data-reader-measure-section-id]").length
    ).toBeLessThanOrEqual(1);
    expect(onMeasuredBlocks).toHaveBeenCalledTimes(2);
    expect(onMeasuredBlocks.mock.calls[0]?.[1]).toEqual([]);

    rendered.rerender(
      <ReaderPreviewPane
        paneIndex={0}
        paneName="keyboard window"
        contentHash={"b".repeat(64)}
        document={longDocument}
        config={{
          ...config,
          settings: { ...config.settings, fontSize: config.settings.fontSize + 1 }
        }}
        zoom={1}
        selectedBlockId={null}
        scrollProgress={0}
        scrollSync={false}
        onScrollProgress={vi.fn()}
        onSelectionScrollProgress={vi.fn()}
        onSelectBlock={onSelectBlock}
        onOpenSource={vi.fn()}
        onStatistics={onStatistics}
        onMeasuredBlocks={onMeasuredBlocks}
        onFirstVisible={vi.fn()}
      />
    );
    expect(pane.dataset.readerMeasuredBlockCount).toBe("0");
  }, 15_000);

  it("isolates repeated config generations and replaces replayed section measurements", async () => {
    const sections = Array.from({ length: 60 }, (_, index) => {
      const sceneIndex = index + 1;
      return readerSection(sceneIndex, `장면 ${sceneIndex}`, [
        readerParagraph(
          `extra-a-${sceneIndex}`,
          "추가 문단 A",
          `scene-${sceneIndex}`,
          `document-${sceneIndex}`
        ),
        readerParagraph(
          `extra-b-${sceneIndex}`,
          "추가 문단 B",
          `scene-${sceneIndex}`,
          `document-${sceneIndex}`
        ),
        readerParagraph(
          `extra-c-${sceneIndex}`,
          "추가 문단 C",
          `scene-${sceneIndex}`,
          `document-${sceneIndex}`
        )
      ]);
    });
    const document = readerPublication({ sections });
    const baseConfig = BUILTIN_READER_PRESETS[0]!.config;
    const alternateConfig = {
      ...baseConfig,
      device: {
        ...baseConfig.device,
        viewportWidth: baseConfig.device.viewportWidth + 40
      }
    };
    const onStatistics = vi.fn();
    const onMeasuredBlocks = vi.fn();
    const stableProps = {
      paneIndex: 0,
      paneName: "generation isolation",
      contentHash: "c".repeat(64),
      document,
      zoom: 1,
      selectedBlockId: null,
      scrollProgress: 0,
      scrollSync: false,
      onScrollProgress: vi.fn(),
      onSelectionScrollProgress: vi.fn(),
      onSelectBlock: vi.fn(),
      onOpenSource: vi.fn(),
      onStatistics,
      onMeasuredBlocks,
      onFirstVisible: vi.fn()
    } as const;
    const rendered = render(
      <ReaderPreviewPane {...stableProps} config={baseConfig} />
    );
    const host = rendered.getByTestId("reader-shadow-host-1");
    await waitFor(() => expect(host.shadowRoot).not.toBeNull());
    const pane = host.closest<HTMLElement>("[data-reader-pane]")!;
    const firstGeneration = Number(pane.dataset.readerMeasurementGeneration);

    await waitFor(() =>
      expect(
        onStatistics.mock.calls.some(
          ([, statistics]) => statistics.measuredSectionCount >= 1
        )
      ).toBe(true)
    );

    for (let index = 0; index < 5; index += 1) {
      rendered.rerender(
        <ReaderPreviewPane
          {...stableProps}
          config={{
            ...baseConfig,
            device: { ...baseConfig.device },
            settings: { ...baseConfig.settings },
            workStyle: { ...baseConfig.workStyle }
          }}
        />
      );
    }
    expect(Number(pane.dataset.readerMeasurementGeneration)).toBe(
      firstGeneration
    );

    rendered.rerender(
      <ReaderPreviewPane {...stableProps} config={alternateConfig} />
    );
    const alternateGeneration = Number(
      pane.dataset.readerMeasurementGeneration
    );
    expect(alternateGeneration).toBeGreaterThan(firstGeneration);

    rendered.rerender(
      <ReaderPreviewPane {...stableProps} config={baseConfig} />
    );
    expect(Number(pane.dataset.readerMeasurementGeneration)).toBeGreaterThan(
      alternateGeneration
    );
    expect(pane.dataset.readerMeasuredBlockCount).toBe("0");

    await waitFor(
      () => {
        expect(pane.dataset.readerMeasurementStatus).toBe("complete");
        expect(pane.dataset.readerCanonicalBlockCount).toBe("300");
        expect(pane.dataset.readerMeasuredBlockCount).toBe("300");
      },
      { timeout: 10_000 }
    );
    const finalStatistics = onStatistics.mock.calls.at(-1)?.[1];
    expect(finalStatistics?.measurementStatus).toBe("COMPLETE");
    expect(finalStatistics?.measuredSectionCount).toBe(60);
    expect(finalStatistics?.measuredBlockCount).toBe(300);
    expect(
      host.shadowRoot!.querySelectorAll("[data-reader-measure-section-id]")
        .length
    ).toBeLessThanOrEqual(1);
  }, 15_000);
});
