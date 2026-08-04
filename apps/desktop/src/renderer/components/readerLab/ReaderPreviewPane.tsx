import {
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent
} from "react";
import { createPortal } from "react-dom";
import type {
  PublicationDocument,
  PublicationSourceReference,
  ReaderRenderConfig
} from "../../../shared/publication";
import { READER_FONT_STACKS } from "./readerConfig";
import { estimateReaderStatistics } from "./readerStatistics";
import {
  buildSectionLayout,
  computeSectionWindow,
  estimateSectionHeight,
  shouldVirtualizeSections,
  type SectionLayoutItem
} from "./sectionWindowing";
import type {
  ReaderMeasuredBlockLayout,
  ReaderRenderStatistics
} from "./types";
import { PublicationBlockView } from "./PublicationContent";

const SHADOW_PREVIEW_CSS = `
:host { all: initial; display: block; contain: strict; }
* { box-sizing: border-box; }
.reader-scroll {
  position: relative; width: 100%; height: 100%; overflow: auto; overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.reader-scroll, .reader-measure-layer {
  color: var(--reader-text); background: var(--reader-background);
  font-family: var(--reader-font); font-size: var(--reader-font-size);
  line-height: var(--reader-line-height);
}
.reader-device-shell { width: 100%; height: 100%; overflow: hidden; }
.reader-device-chrome { width: 100%; background: #2f3135; border-bottom: 1px solid #151619; }
.reader-safe-viewport { width: 100%; box-sizing: border-box; overflow: hidden; }
.reader-document { min-height: 100%; padding: var(--reader-padding-v) var(--reader-padding-h); }
.reader-section { display: flow-root; min-width: 0; }
.reader-measure-layer {
  position: absolute; inset: 0 auto auto 0; width: 100%; height: auto;
  visibility: hidden; pointer-events: none; overflow: visible; z-index: -1;
}
.reader-block {
  position: relative; min-width: 0; border-radius: 4px; outline: 0;
  overflow-wrap: anywhere; word-break: normal; cursor: pointer;
}
.reader-block:focus-visible { box-shadow: 0 0 0 2px #9b7136; }
.reader-block[aria-pressed="true"] { background: color-mix(in srgb, #d7a64c 23%, transparent); }
.reader-block p, .reader-block blockquote { margin: 0 0 var(--reader-paragraph-spacing); }
.reader-block p { text-indent: var(--reader-indent); text-align: var(--reader-align); white-space: pre-wrap; }
.reader-block blockquote { padding-left: 1em; border-left: 3px solid currentColor; opacity: .86; white-space: pre-wrap; }
.reader-block h1, .reader-block h2, .reader-block h3, .reader-block h4 { margin: 1.8em 0 .9em; line-height: 1.35; }
.reader-block h1 { font-size: 1.8em; } .reader-block h2 { font-size: 1.55em; }
.reader-block h3 { font-size: 1.35em; } .reader-block h4 { font-size: 1.15em; }
.reader-block--chapter-compact h3 { margin: 1em 0 .55em; font-size: 1.12em; letter-spacing: .01em; }
.reader-scene-break { display: block; padding: 1.5em 0; text-align: center; letter-spacing: .45em; }
.reader-scene-break--rule { width: 30%; min-width: 56px; height: 1px; padding: 0; margin: 2em auto; background: currentColor; opacity: .4; }
.reader-scene-break--space { min-height: 3em; color: transparent; }
.reader-scene-break--hidden { display: none; }
.reader-unsupported { padding: .75em; margin: .75em 0; border: 1px dashed currentColor; opacity: .8; }
.reader-unsupported__label { display: block; margin-bottom: .4em; font: 600 .72em system-ui, sans-serif; }
rt { font-size: .55em; }
`;

interface ReaderPreviewPaneProps {
  readonly paneIndex: number;
  readonly paneName: string;
  readonly contentHash: string;
  readonly document: PublicationDocument;
  readonly config: ReaderRenderConfig;
  readonly zoom: number;
  readonly selectedBlockId: string | null;
  readonly scrollProgress: number;
  readonly scrollSync: boolean;
  readonly onScrollProgress: (paneIndex: number, progress: number) => void;
  readonly onSelectionScrollProgress: (
    paneIndex: number,
    progress: number
  ) => void;
  readonly onSelectBlock: (blockId: string) => void;
  readonly onOpenSource: (source: PublicationSourceReference) => void | Promise<void>;
  readonly onStatistics: (
    paneIndex: number,
    statistics: ReaderRenderStatistics,
    measurementKey: string
  ) => void;
  readonly onMeasuredBlocks: (
    paneIndex: number,
    blocks: readonly ReaderMeasuredBlockLayout[],
    measurementKey: string
  ) => void;
  readonly onFirstVisible: (paneIndex: number, contentHash: string) => void;
}

function blockSectionIndex(
  document: PublicationDocument,
  blockId: string | null
): number | null {
  if (!blockId) {
    return null;
  }
  const index = document.sections.findIndex((section) =>
    section.blocks.some((block) => block.id === blockId)
  );
  return index >= 0 ? index : null;
}

function scrollableMaximum(
  scroller: HTMLElement,
  totalHeight: number
): number {
  return Math.max(
    0,
    scroller.scrollHeight - scroller.clientHeight,
    totalHeight - scroller.clientHeight
  );
}

interface MeasuredSectionLayout {
  readonly height: number;
  readonly blockCount: number;
  readonly blockLayouts: readonly ReaderMeasuredBlockLayout[];
}

interface MeasurementAccumulator {
  readonly sections: Map<string, MeasuredSectionLayout>;
}

interface FullScopeMeasurementProps {
  readonly document: PublicationDocument;
  readonly config: ReaderRenderConfig;
  readonly estimated: ReaderRenderStatistics;
  readonly customProperties: CSSProperties;
  readonly onStatistics: (statistics: ReaderRenderStatistics) => void;
  readonly onMeasuredBlocks: (
    blocks: readonly ReaderMeasuredBlockLayout[]
  ) => void;
}

const MEASUREMENT_PROGRESS_INTERVAL = 25;
const PROVISIONAL_SECTION_COUNT = 4;
const MEASUREMENT_CACHE_LIMIT = 4;
const ignoreBlockSelection = () => undefined;
const ignoreSourceNavigation = () => undefined;

interface ReaderAnalysisSnapshot {
  readonly key: string;
  readonly contentHash: string;
  readonly config: ReaderRenderConfig;
  readonly estimated: ReaderRenderStatistics;
  readonly layout: readonly SectionLayoutItem[];
}

interface ReaderMeasurementCacheEntry {
  readonly analysis?: ReaderAnalysisSnapshot;
  readonly statistics?: ReaderRenderStatistics;
  readonly measuredBlocks?: readonly ReaderMeasuredBlockLayout[];
}

interface ReaderConfigStageTimings {
  readonly key: string;
  readonly visibleUpdateMs: number | null;
  readonly analysisStartMs: number | null;
  readonly analysisReadyMs: number | null;
  readonly measurementCompleteMs: number | null;
  readonly analysisStatus:
    | "PENDING_ANALYSIS"
    | "MEASURING"
    | "COMPLETE"
    | "CACHED";
}

function scheduleIdleWork(work: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(work, { timeout: 100 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(work, 0);
  return () => window.clearTimeout(handle);
}

export function readerPreviewMeasurementKey(
  contentHash: string,
  config: ReaderRenderConfig
): string {
  return `${contentHash}:${JSON.stringify(config)}`;
}

function provisionalLayout(
  document: PublicationDocument,
  config: ReaderRenderConfig,
  virtualized: boolean
): readonly SectionLayoutItem[] {
  return buildSectionLayout(
    virtualized
      ? document.sections.slice(0, PROVISIONAL_SECTION_COUNT)
      : document.sections,
    config
  );
}

function pendingStatistics(
  document: PublicationDocument,
  config: ReaderRenderConfig,
  previous: ReaderRenderStatistics | null
): ReaderRenderStatistics {
  const viewportHeight = Math.max(
    1,
    config.device.viewportHeight -
      config.device.safeAreaTop -
      config.device.safeAreaBottom -
      config.device.readerChromeHeight
  );
  return {
    measurementStatus: "MEASURING",
    measuredSectionCount: 0,
    measuredBlockCount: 0,
    totalSectionCount: document.sections.length,
    renderedContentHeight: previous?.renderedContentHeight ?? viewportHeight,
    viewportHeight,
    estimatedScreenCount: previous?.estimatedScreenCount ?? 1,
    averageCharactersPerScreen:
      previous?.averageCharactersPerScreen ?? document.stats.withSpaces,
    longestParagraphLineCount: previous?.longestParagraphLineCount ?? 0,
    paragraphsAtLeastEightLines: previous?.paragraphsAtLeastEightLines ?? 0,
    consecutiveEmptyParagraphRuns: previous?.consecutiveEmptyParagraphRuns ?? 0,
    horizontalOverflowCount: 0
  };
}

function updateMeasurementCache(
  cache: Map<string, ReaderMeasurementCacheEntry>,
  key: string,
  patch: ReaderMeasurementCacheEntry
): void {
  const current = cache.get(key) ?? {};
  cache.delete(key);
  cache.set(key, { ...current, ...patch });
  while (cache.size > MEASUREMENT_CACHE_LIMIT) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) {
      break;
    }
    cache.delete(oldest);
  }
}

function FullScopeMeasurement({
  document,
  config,
  estimated,
  customProperties,
  onStatistics,
  onMeasuredBlocks
}: FullScopeMeasurementProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [measurementStarted, setMeasurementStarted] = useState(
    document.sections.length === 0
  );
  const accumulatorRef = useRef<MeasurementAccumulator>({
    sections: new Map()
  });
  const section = measurementStarted
    ? document.sections[sectionIndex] ?? null
    : null;

  useEffect(() => {
    if (document.sections.length === 0) {
      return;
    }
    return scheduleIdleWork(() => setMeasurementStarted(true));
  }, [document.sections.length]);

  useLayoutEffect(() => {
    if (sectionIndex !== 0) {
      return;
    }
    onMeasuredBlocks([]);
    onStatistics({
      ...estimated,
      measurementStatus:
        document.sections.length === 0 ? "COMPLETE" : "MEASURING",
      measuredSectionCount: 0,
      measuredBlockCount: 0,
      totalSectionCount: document.sections.length
    });
  }, [document.sections.length, estimated, onMeasuredBlocks, onStatistics, sectionIndex]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !section) {
      return;
    }
    const accumulator = accumulatorRef.current;
    const sectionElement = root.querySelector<HTMLElement>(
      "[data-reader-measure-section-id]"
    );
    const sectionHeight = sectionElement
      ? Math.ceil(
          Math.max(
            sectionElement.getBoundingClientRect().height,
            sectionElement.scrollHeight
          )
        )
      : 0;
    const measuredHeight =
      sectionHeight > 0
        ? sectionHeight
        : estimateSectionHeight(section, config);
    const blockLayouts: ReaderMeasuredBlockLayout[] = [];

    for (const paragraph of root.querySelectorAll<HTMLElement>(
      "[data-reader-paragraph='true']"
    )) {
      const block = paragraph.closest<HTMLElement>(
        "[data-reader-measure-block-id]"
      );
      const blockId = block?.dataset.readerMeasureBlockId;
      const lineHeight = Number.parseFloat(getComputedStyle(paragraph).lineHeight);
      const paragraphHeight = paragraph.getBoundingClientRect().height;
      const horizontalOverflow =
        paragraph.clientWidth > 0 &&
        paragraph.scrollWidth > paragraph.clientWidth + 1;
      if (Number.isFinite(lineHeight) && lineHeight > 0 && paragraphHeight > 0) {
        const lineCount = Math.max(1, Math.round(paragraphHeight / lineHeight));
        if (blockId) {
          blockLayouts.push({
            blockId,
            lineCount,
            renderedHeight: paragraphHeight,
            horizontalOverflow
          });
        }
      }
    }

    accumulator.sections.set(section.id, {
      height: measuredHeight,
      blockCount: root.querySelectorAll("[data-reader-measure-block-id]").length,
      blockLayouts
    });
    const sectionMeasurements = [...accumulator.sections.values()];
    const measuredSectionCount = accumulator.sections.size;
    const measuredBlockCount = sectionMeasurements.reduce(
      (count, measurement) => count + measurement.blockCount,
      0
    );
    const measuredBlockLayouts = sectionMeasurements.flatMap(
      (measurement) => measurement.blockLayouts
    );
    const nextSectionIndex = sectionIndex + 1;
    const complete =
      nextSectionIndex === document.sections.length &&
      measuredSectionCount === document.sections.length;
    if (
      complete ||
      measuredSectionCount === 1 ||
      measuredSectionCount % MEASUREMENT_PROGRESS_INTERVAL === 0
    ) {
      const renderedContentHeight = complete
        ? Math.max(
            1,
            Math.ceil(
              sectionMeasurements.reduce(
                (height, measurement) => height + measurement.height,
                0
              ) + config.settings.verticalPadding * 2
            )
          )
        : estimated.renderedContentHeight;
      const screenCount = complete
        ? Math.max(
            1,
            Math.ceil(renderedContentHeight / estimated.viewportHeight)
          )
        : estimated.estimatedScreenCount;
      onStatistics({
        ...estimated,
        measurementStatus: complete ? "COMPLETE" : "MEASURING",
        measuredSectionCount,
        measuredBlockCount,
        totalSectionCount: document.sections.length,
        renderedContentHeight,
        estimatedScreenCount: screenCount,
        averageCharactersPerScreen: Math.round(
          document.stats.withSpaces / screenCount
        ),
        longestParagraphLineCount:
          complete && measuredBlockLayouts.length > 0
            ? measuredBlockLayouts.reduce(
                (longest, layout) => Math.max(longest, layout.lineCount),
                0
              )
            : estimated.longestParagraphLineCount,
        paragraphsAtLeastEightLines:
          complete && measuredBlockLayouts.length > 0
            ? measuredBlockLayouts.filter((layout) => layout.lineCount >= 8).length
            : estimated.paragraphsAtLeastEightLines,
        horizontalOverflowCount: measuredBlockLayouts.filter(
          (layout) => layout.horizontalOverflow
        ).length
      });
      if (complete) {
        onMeasuredBlocks(measuredBlockLayouts);
      }
    }

    return scheduleIdleWork(() => setSectionIndex(nextSectionIndex));
  }, [config, document, estimated, onMeasuredBlocks, onStatistics, section, sectionIndex]);

  if (!measurementStarted) {
    return (
      <span
        hidden
        data-reader-measurement-status="measuring"
        data-reader-measured-section-count={0}
        data-reader-measured-block-count={0}
        data-reader-total-section-count={document.sections.length}
      />
    );
  }
  if (!section) {
    return (
      <span
        hidden
        data-reader-measurement-status="complete"
        data-reader-measured-section-count={document.sections.length}
        data-reader-measured-block-count={[...accumulatorRef.current.sections.values()].reduce(
          (count, measurement) => count + measurement.blockCount,
          0
        )}
        data-reader-total-section-count={document.sections.length}
      />
    );
  }
  return (
    <div
      ref={rootRef}
      className="reader-measure-layer"
      style={customProperties}
      aria-hidden="true"
      data-reader-measurement-status="measuring"
      data-reader-measured-section-count={sectionIndex}
      data-reader-total-section-count={document.sections.length}
      data-reader-measure-section-index={sectionIndex}
    >
      <div className="reader-document">
        <section
          className="reader-section"
          data-reader-measure-section-id={section.id}
        >
          {section.blocks.map((block) => (
            <PublicationBlockView
              key={block.id}
              block={block}
              config={config}
              selected={false}
              measurement
              onSelect={ignoreBlockSelection}
              onOpenSource={ignoreSourceNavigation}
            />
          ))}
        </section>
      </div>
    </div>
  );
}

export function ReaderPreviewPane({
  paneIndex,
  paneName,
  contentHash,
  document,
  config,
  zoom,
  selectedBlockId,
  scrollProgress,
  scrollSync,
  onScrollProgress,
  onSelectionScrollProgress,
  onSelectBlock,
  onOpenSource,
  onStatistics,
  onMeasuredBlocks,
  onFirstVisible
}: ReaderPreviewPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [shadowRoot, setShadowRoot] = useState<ShadowRoot | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [measuredHeights, setMeasuredHeights] = useState<ReadonlyMap<string, number>>(
    () => new Map()
  );
  const applyingExternalScrollRef = useRef(false);
  const previousSelectedBlockIdRef = useRef(selectedBlockId);
  const pendingKeyboardFocusRef = useRef<string | null>(null);
  const firstVisibleKeyRef = useRef<string | null>(null);
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(
    selectedBlockId
  );
  const requestedMeasurementKey = useMemo(
    () => readerPreviewMeasurementKey(contentHash, config),
    [config, contentHash]
  );
  const measurementRequestRef = useRef({
    key: requestedMeasurementKey,
    generation: 1,
    startedAt: performance.now()
  });
  if (measurementRequestRef.current.key !== requestedMeasurementKey) {
    measurementRequestRef.current = {
      key: requestedMeasurementKey,
      generation: measurementRequestRef.current.generation + 1,
      startedAt: performance.now()
    };
  }
  const measurementGeneration = measurementRequestRef.current.generation;
  const measurementCacheRef = useRef(
    new Map<string, ReaderMeasurementCacheEntry>()
  );
  const [visibleSnapshot, setVisibleSnapshot] = useState(() => ({
    key: requestedMeasurementKey,
    generation: measurementGeneration,
    config
  }));
  const visibleSnapshotRef = useRef(visibleSnapshot);
  visibleSnapshotRef.current = visibleSnapshot;
  const visibleConfig = visibleSnapshot.config;
  const visibleMeasurementKey = visibleSnapshot.key;
  const visibleMeasurementGeneration = visibleSnapshot.generation;
  const measurementInstanceKey = `${visibleMeasurementGeneration}:${visibleMeasurementKey}`;
  const [analysisSnapshot, setAnalysisSnapshot] = useState<ReaderAnalysisSnapshot | null>(
    null
  );
  const [stageTimings, setStageTimings] = useState<ReaderConfigStageTimings>(() => ({
    key: requestedMeasurementKey,
    visibleUpdateMs: 0,
    analysisStartMs: null,
    analysisReadyMs: null,
    measurementCompleteMs: null,
    analysisStatus: "PENDING_ANALYSIS"
  }));
  const [observedStatistics, setObservedStatistics] = useState<{
    readonly key: string;
    readonly value: ReaderRenderStatistics;
  } | null>(null);
  const cachedMeasurement = measurementCacheRef.current.get(visibleMeasurementKey);
  const completedStatistics =
    observedStatistics?.key === visibleMeasurementKey
      ? observedStatistics.value
      : cachedMeasurement?.statistics;
  const paneStatistics = useMemo(
    () =>
      completedStatistics ??
      pendingStatistics(document, visibleConfig, observedStatistics?.value ?? null),
    [completedStatistics, document, observedStatistics?.value, visibleConfig]
  );
  const visibleConfigPending =
    visibleMeasurementKey !== requestedMeasurementKey ||
    visibleMeasurementGeneration !== measurementGeneration;
  const renderedPaneStatistics = visibleConfigPending
    ? pendingStatistics(document, config, paneStatistics)
    : paneStatistics;
  const canonicalBlockCount = useMemo(
    () =>
      document.sections.reduce(
        (count, section) => count + section.blocks.length,
        0
      ),
    [document.sections]
  );
  const virtualized = shouldVirtualizeSections(
    document.sections,
    document.stats.withSpaces
  );
  const initialLayout = useMemo(
    () => provisionalLayout(document, visibleConfig, virtualized),
    [document, visibleConfig, virtualized]
  );
  const layout =
    analysisSnapshot?.key === visibleMeasurementKey ||
    analysisSnapshot?.contentHash === contentHash
      ? analysisSnapshot.layout
      : initialLayout;
  const selectedSectionIndex = blockSectionIndex(document, selectedBlockId);
  const navigableBlockIds = useMemo(
    () =>
      document.sections.flatMap((section) =>
        section.blocks
          .filter((block) => {
            if (block.kind === "SCENE_BREAK") {
              return (
                visibleConfig.settings.showSceneBreak &&
                visibleConfig.workStyle.sceneBreakStyleToken !== "HIDDEN"
              );
            }
            if (block.kind === "HEADING" && block.level === 3) {
              return visibleConfig.settings.showChapterTitle;
            }
            if (block.kind === "HEADING" && block.level === 4) {
              return (
                visibleConfig.settings.showSceneTitle &&
                visibleConfig.workStyle.sceneTitleStyleToken !== "SCENE_HIDDEN"
              );
            }
            return true;
          })
          .map((block) => block.id)
      ),
    [
      visibleConfig.settings.showChapterTitle,
      visibleConfig.settings.showSceneBreak,
      visibleConfig.settings.showSceneTitle,
      visibleConfig.workStyle.sceneBreakStyleToken,
      visibleConfig.workStyle.sceneTitleStyleToken,
      document.sections
    ]
  );
  const selectSourceBlock = useCallback(
    (blockId: string) => {
      setActiveSourceBlockId(blockId);
      onSelectBlock(blockId);
    },
    [onSelectBlock]
  );
  const windowed = useMemo(
    () =>
      virtualized
        ? computeSectionWindow(
            layout,
            scrollTop,
            visibleConfig.device.viewportHeight,
            900
          )
        : {
            items: layout,
            paddingBefore: 0,
            paddingAfter: 0,
            totalHeight: layout.at(-1)?.end ?? 0
          },
    [layout, scrollTop, virtualized, visibleConfig.device.viewportHeight]
  );
  const mountedNavigableBlockIds = useMemo(() => {
    const navigable = new Set(navigableBlockIds);
    return windowed.items.flatMap(({ section }) =>
      section.blocks
        .map((block) => block.id)
        .filter((blockId) => navigable.has(blockId))
    );
  }, [navigableBlockIds, windowed.items]);
  useEffect(() => {
    setActiveSourceBlockId((current) => {
      if (
        selectedBlockId &&
        mountedNavigableBlockIds.includes(selectedBlockId)
      ) {
        return selectedBlockId;
      }
      return current && mountedNavigableBlockIds.includes(current)
        ? current
        : mountedNavigableBlockIds[0] ?? null;
    });
  }, [mountedNavigableBlockIds, selectedBlockId]);

  useLayoutEffect(() => {
    if (
      visibleMeasurementKey === requestedMeasurementKey &&
      visibleMeasurementGeneration === measurementGeneration
    ) {
      return;
    }
    applyingExternalScrollRef.current = false;
    const request = measurementRequestRef.current;
    const nextConfig = config;
    const frame = window.requestAnimationFrame(() => {
      if (
        measurementRequestRef.current.key !== request.key ||
        measurementRequestRef.current.generation !== request.generation
      ) {
        return;
      }
      setVisibleSnapshot({
        key: request.key,
        generation: request.generation,
        config: nextConfig
      });
      setStageTimings({
        key: request.key,
        visibleUpdateMs: Math.max(0, performance.now() - request.startedAt),
        analysisStartMs: null,
        analysisReadyMs: null,
        measurementCompleteMs: null,
        analysisStatus: "PENDING_ANALYSIS"
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    config,
    measurementGeneration,
    requestedMeasurementKey,
    visibleMeasurementKey
  ]);

  useEffect(() => {
    const request = measurementRequestRef.current;
    if (
      request.key !== visibleMeasurementKey ||
      request.generation !== visibleMeasurementGeneration
    ) {
      return;
    }
    const cached = measurementCacheRef.current.get(visibleMeasurementKey);
    if (cached?.analysis) {
      setAnalysisSnapshot(cached.analysis);
      if (cached.statistics && cached.measuredBlocks) {
        setObservedStatistics({
          key: visibleMeasurementKey,
          value: cached.statistics
        });
        onStatistics(paneIndex, cached.statistics, visibleMeasurementKey);
        onMeasuredBlocks(
          paneIndex,
          cached.measuredBlocks,
          visibleMeasurementKey
        );
        setStageTimings((current) =>
          current.key === visibleMeasurementKey
            ? {
                ...current,
                analysisReadyMs: Math.max(
                  0,
                  performance.now() - request.startedAt
                ),
                measurementCompleteMs: Math.max(
                  0,
                  performance.now() - request.startedAt
                ),
                analysisStatus: "CACHED"
              }
            : current
        );
        return;
      }
    }
    setMeasuredHeights((current) =>
      current.size === 0 ? current : new Map()
    );
    return scheduleIdleWork(() => {
      if (
        measurementRequestRef.current.key !== visibleMeasurementKey ||
        measurementRequestRef.current.generation !== visibleMeasurementGeneration ||
        visibleSnapshotRef.current.key !== visibleMeasurementKey
      ) {
        return;
      }
      const analysisStartedAt = performance.now();
      setStageTimings((current) =>
        current.key === visibleMeasurementKey
          ? {
              ...current,
              analysisStartMs: Math.max(0, analysisStartedAt - request.startedAt)
            }
          : current
      );
      const snapshot: ReaderAnalysisSnapshot = {
        key: visibleMeasurementKey,
        contentHash,
        config: visibleConfig,
        estimated: estimateReaderStatistics(document, visibleConfig),
        layout: buildSectionLayout(document.sections, visibleConfig)
      };
      if (
        measurementRequestRef.current.key !== visibleMeasurementKey ||
        measurementRequestRef.current.generation !== visibleMeasurementGeneration ||
        visibleSnapshotRef.current.key !== visibleMeasurementKey
      ) {
        return;
      }
      updateMeasurementCache(
        measurementCacheRef.current,
        visibleMeasurementKey,
        { analysis: snapshot }
      );
      setAnalysisSnapshot(snapshot);
      setStageTimings((current) =>
        current.key === visibleMeasurementKey
          ? {
              ...current,
              analysisReadyMs: Math.max(0, performance.now() - request.startedAt),
              analysisStatus: "MEASURING"
            }
          : current
      );
    });
  }, [
    contentHash,
    document,
    onMeasuredBlocks,
    onStatistics,
    paneIndex,
    visibleConfig,
    visibleMeasurementGeneration,
    visibleMeasurementKey
  ]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    setShadowRoot(host.shadowRoot ?? host.attachShadow({ mode: "open" }));
  }, []);

  useLayoutEffect(() => {
    const next = new Map(measuredHeights);
    let changed = false;
    for (const element of shadowRoot?.querySelectorAll<HTMLElement>(
      "[data-reader-section-id]"
    ) ?? []) {
      const id = element.dataset.readerSectionId;
      const height = Math.ceil(element.getBoundingClientRect().height);
      if (id && height > 0 && next.get(id) !== height) {
        next.set(id, height);
        changed = true;
      }
    }
    if (changed) {
      setMeasuredHeights(next);
    }
  }, [
    selectedBlockId,
    shadowRoot,
    visibleMeasurementKey,
    windowed.items
  ]);

  useEffect(() => {
    if (
      analysisSnapshot?.key !== visibleMeasurementKey ||
      measuredHeights.size === 0
    ) {
      return;
    }
    const expectedAnalysis = analysisSnapshot;
    return scheduleIdleWork(() => {
      if (
        visibleSnapshotRef.current.key !== visibleMeasurementKey ||
        measurementRequestRef.current.key !== visibleMeasurementKey
      ) {
        return;
      }
      const nextAnalysis = {
        ...expectedAnalysis,
        layout: buildSectionLayout(
          document.sections,
          expectedAnalysis.config,
          measuredHeights
        )
      };
      setAnalysisSnapshot((current) =>
        current?.key === expectedAnalysis.key ? nextAnalysis : current
      );
      updateMeasurementCache(
        measurementCacheRef.current,
        visibleMeasurementKey,
        { analysis: nextAnalysis }
      );
    });
  }, [
    analysisSnapshot?.key,
    document.sections,
    measuredHeights,
    visibleMeasurementKey
  ]);

  useLayoutEffect(() => {
    const blockId = pendingKeyboardFocusRef.current;
    if (!blockId || !shadowRoot) {
      return;
    }
    const target = Array.from(
      shadowRoot.querySelectorAll<HTMLElement>("[data-reader-block-id]")
    ).find((element) => element.dataset.readerBlockId === blockId);
    if (target) {
      pendingKeyboardFocusRef.current = null;
      target.focus();
    }
  }, [shadowRoot, windowed.items]);

  useLayoutEffect(() => {
    if (
      !shadowRoot ||
      firstVisibleKeyRef.current === visibleMeasurementKey ||
      !shadowRoot.querySelector(".reader-document")
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      if (firstVisibleKeyRef.current === visibleMeasurementKey) {
        return;
      }
      firstVisibleKeyRef.current = visibleMeasurementKey;
      onFirstVisible(paneIndex, contentHash);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    contentHash,
    onFirstVisible,
    paneIndex,
    shadowRoot,
    visibleMeasurementKey,
    windowed.items
  ]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    const maxScroll = scrollableMaximum(scroller, windowed.totalHeight);
    const target = maxScroll * scrollProgress;
    if (Math.abs(scroller.scrollTop - target) > 2) {
      applyingExternalScrollRef.current = true;
      scroller.scrollTop = target;
      setScrollTop(target);
      const frame = window.requestAnimationFrame(() => {
        applyingExternalScrollRef.current = false;
      });
      return () => {
        window.cancelAnimationFrame(frame);
        applyingExternalScrollRef.current = false;
      };
    }
    return undefined;
  }, [scrollProgress, shadowRoot, windowed.totalHeight]);

  useEffect(() => {
    const previousSelectedBlockId = previousSelectedBlockIdRef.current;
    previousSelectedBlockIdRef.current = selectedBlockId;
    if (
      !scrollSync ||
      previousSelectedBlockId === selectedBlockId ||
      selectedSectionIndex === null
    ) {
      return;
    }
    const scroller = scrollerRef.current;
    const section = layout[selectedSectionIndex];
    if (!scroller || !section) {
      return;
    }
    const maximum = scrollableMaximum(scroller, windowed.totalHeight);
    const target = maximum > 0 ? Math.min(section.start, maximum) : 0;
    applyingExternalScrollRef.current = true;
    scroller.scrollTop = target;
    setScrollTop(target);
    onSelectionScrollProgress(
      paneIndex,
      maximum > 0 ? target / maximum : 0
    );
    const frame = window.requestAnimationFrame(() => {
      applyingExternalScrollRef.current = false;
    });
    return () => {
      window.cancelAnimationFrame(frame);
      applyingExternalScrollRef.current = false;
    };
  }, [
    config,
    layout,
    onSelectionScrollProgress,
    paneIndex,
    scrollSync,
    selectedBlockId,
    selectedSectionIndex,
    windowed.totalHeight
  ]);

  const customProperties = {
    "--reader-background": visibleConfig.settings.backgroundColor,
    "--reader-text": visibleConfig.settings.textColor,
    "--reader-font": READER_FONT_STACKS[visibleConfig.settings.fontFamilyToken],
    "--reader-font-size": `${visibleConfig.settings.fontSize}px`,
    "--reader-line-height": String(visibleConfig.settings.lineHeight),
    "--reader-paragraph-spacing": `${visibleConfig.settings.paragraphSpacing}px`,
    "--reader-indent": `${visibleConfig.settings.firstLineIndent}px`,
    "--reader-padding-h": `${visibleConfig.settings.horizontalPadding}px`,
    "--reader-padding-v": `${visibleConfig.settings.verticalPadding}px`,
    "--reader-align":
      visibleConfig.settings.textAlign === "JUSTIFY" ? "justify" : "left"
  } as CSSProperties;
  const reportStatistics = useCallback(
    (statistics: ReaderRenderStatistics) => {
      if (
        measurementRequestRef.current.key !== visibleMeasurementKey ||
        measurementRequestRef.current.generation !== visibleMeasurementGeneration ||
        visibleSnapshotRef.current.key !== visibleMeasurementKey
      ) {
        return;
      }
      setObservedStatistics({ key: visibleMeasurementKey, value: statistics });
      if (statistics.measurementStatus === "COMPLETE") {
        updateMeasurementCache(
          measurementCacheRef.current,
          visibleMeasurementKey,
          { statistics }
        );
        const request = measurementRequestRef.current;
        setStageTimings((current) =>
          current.key === visibleMeasurementKey
            ? {
                ...current,
                measurementCompleteMs: Math.max(
                  0,
                  performance.now() - request.startedAt
                ),
                analysisStatus: "COMPLETE"
              }
            : current
        );
      }
      onStatistics(paneIndex, statistics, visibleMeasurementKey);
    },
    [
      onStatistics,
      paneIndex,
      visibleMeasurementGeneration,
      visibleMeasurementKey
    ]
  );
  const reportMeasuredBlocks = useCallback(
    (blocks: readonly ReaderMeasuredBlockLayout[]) => {
      if (
        measurementRequestRef.current.key !== visibleMeasurementKey ||
        measurementRequestRef.current.generation !== visibleMeasurementGeneration ||
        visibleSnapshotRef.current.key !== visibleMeasurementKey
      ) {
        return;
      }
      updateMeasurementCache(
        measurementCacheRef.current,
        visibleMeasurementKey,
        { measuredBlocks: blocks }
      );
      onMeasuredBlocks(paneIndex, blocks, visibleMeasurementKey);
    },
    [
      onMeasuredBlocks,
      paneIndex,
      visibleMeasurementGeneration,
      visibleMeasurementKey
    ]
  );

  const onScroll = () => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    setScrollTop(scroller.scrollTop);
    if (applyingExternalScrollRef.current) {
      return;
    }
    const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    onScrollProgress(paneIndex, maximum > 0 ? scroller.scrollTop / maximum : 0);
  };

  const onSourceListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    const target = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-reader-block-id]"
    );
    const currentId = target?.dataset.readerBlockId;
    if (!currentId) {
      return;
    }
    const currentIndex = navigableBlockIds.indexOf(currentId);
    if (currentIndex < 0) {
      return;
    }
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? navigableBlockIds.length - 1
          : event.key === "ArrowDown"
            ? Math.min(navigableBlockIds.length - 1, currentIndex + 1)
            : Math.max(0, currentIndex - 1);
    const blockId = navigableBlockIds[nextIndex];
    if (!blockId || blockId === currentId) {
      return;
    }
    event.preventDefault();
    pendingKeyboardFocusRef.current = blockId;
    selectSourceBlock(blockId);
    const mountedTarget = Array.from(
      shadowRoot?.querySelectorAll<HTMLElement>("[data-reader-block-id]") ?? []
    ).find((element) => element.dataset.readerBlockId === blockId);
    if (mountedTarget) {
      pendingKeyboardFocusRef.current = null;
      mountedTarget.focus();
    }
    const sectionIndex = blockSectionIndex(document, blockId);
    const section = sectionIndex === null ? null : layout[sectionIndex];
    const scroller = scrollerRef.current;
    if (section && scroller) {
      const maximum = scrollableMaximum(scroller, windowed.totalHeight);
      const target = maximum > 0 ? Math.min(section.start, maximum) : 0;
      scroller.scrollTop = target;
      setScrollTop(target);
      onScrollProgress(
        paneIndex,
        maximum > 0 ? target / maximum : 0
      );
    }
  };
  const measurementCached =
    !visibleConfigPending &&
    cachedMeasurement?.statistics?.measurementStatus === "COMPLETE" &&
    cachedMeasurement.measuredBlocks !== undefined;

  return (
    <section
      className="reader-preview-pane"
      aria-label={`${paneName} 독서 미리보기`}
      data-reader-pane={paneIndex + 1}
      data-virtualized={String(virtualized)}
      data-reader-canonical-section-count={document.sections.length}
      data-reader-canonical-block-count={canonicalBlockCount}
      data-reader-mounted-section-count={windowed.items.length}
      data-reader-measurement-status={renderedPaneStatistics.measurementStatus.toLocaleLowerCase()}
      data-reader-measured-section-count={renderedPaneStatistics.measuredSectionCount}
      data-reader-measured-block-count={renderedPaneStatistics.measuredBlockCount}
      data-reader-total-section-count={renderedPaneStatistics.totalSectionCount}
      data-reader-measurement-generation={measurementGeneration}
      data-reader-config-stage={
        visibleConfigPending
          ? "pending-visible"
          : stageTimings.key === visibleMeasurementKey
            ? stageTimings.analysisStatus.toLocaleLowerCase()
            : "pending-analysis"
      }
      data-reader-visible-update-ms={
        stageTimings.key === visibleMeasurementKey
          ? stageTimings.visibleUpdateMs?.toFixed(3)
          : undefined
      }
      data-reader-analysis-start-ms={
        stageTimings.key === visibleMeasurementKey
          ? stageTimings.analysisStartMs?.toFixed(3)
          : undefined
      }
      data-reader-analysis-ready-ms={
        stageTimings.key === visibleMeasurementKey
          ? stageTimings.analysisReadyMs?.toFixed(3)
          : undefined
      }
      data-reader-measurement-complete-ms={
        stageTimings.key === visibleMeasurementKey
          ? stageTimings.measurementCompleteMs?.toFixed(3)
          : undefined
      }
      data-reader-rendered-height={renderedPaneStatistics.renderedContentHeight}
      data-reader-screen-count={renderedPaneStatistics.estimatedScreenCount}
      data-reader-longest-paragraph-lines={renderedPaneStatistics.longestParagraphLineCount}
      data-reader-eight-line-paragraph-count={renderedPaneStatistics.paragraphsAtLeastEightLines}
      data-reader-overflow-count={renderedPaneStatistics.horizontalOverflowCount}
      data-reader-device-category={visibleConfig.device.category}
      data-reader-device-profile-id={visibleConfig.device.id}
      data-reader-viewport-width={visibleConfig.device.viewportWidth}
      data-reader-viewport-height={visibleConfig.device.viewportHeight}
      data-reader-font-token={visibleConfig.settings.fontFamilyToken}
      data-reader-font-size={visibleConfig.settings.fontSize}
      data-reader-line-height={visibleConfig.settings.lineHeight}
      data-reader-horizontal-padding={visibleConfig.settings.horizontalPadding}
      data-reader-vertical-padding={visibleConfig.settings.verticalPadding}
      data-reader-theme={visibleConfig.settings.theme}
      data-reader-scene-break-style={visibleConfig.workStyle.sceneBreakStyleToken}
      data-reader-zoom={zoom.toFixed(4)}
      data-reader-scroll-progress={scrollProgress.toFixed(6)}
      data-reader-selected-source-block-id={selectedBlockId ?? ""}
    >
      <header className="reader-preview-pane__header">
        <strong>{paneName}</strong>
        <span>
          {visibleConfig.device.category} · {visibleConfig.device.viewportWidth}×
          {visibleConfig.device.viewportHeight}
        </span>
        <span>
          {renderedPaneStatistics.measurementStatus === "COMPLETE"
            ? `측정 ${renderedPaneStatistics.estimatedScreenCount}화면`
            : "측정 중…"}
        </span>
      </header>
      <div className="reader-device-stage">
        <div
          className="reader-device-frame"
          style={{
            width: visibleConfig.device.viewportWidth * zoom,
            height: visibleConfig.device.viewportHeight * zoom
          }}
        >
          <div
            ref={hostRef}
            className="reader-shadow-host"
            data-testid={`reader-shadow-host-${paneIndex + 1}`}
            style={{
              width: visibleConfig.device.viewportWidth,
              height: visibleConfig.device.viewportHeight,
              transform: `scale(${zoom})`
            }}
          />
        </div>
      </div>
      {shadowRoot &&
        createPortal(
          <>
            <style>{SHADOW_PREVIEW_CSS}</style>
            <div
              className="reader-device-shell"
              style={{ backgroundColor: visibleConfig.settings.backgroundColor }}
            >
              <div
                className="reader-device-chrome"
                style={{ height: visibleConfig.device.readerChromeHeight }}
                aria-hidden="true"
              />
              <div
                className="reader-safe-viewport"
                style={{
                  height:
                    visibleConfig.device.viewportHeight -
                    visibleConfig.device.readerChromeHeight,
                  paddingTop: visibleConfig.device.safeAreaTop,
                  paddingBottom: visibleConfig.device.safeAreaBottom
                }}
              >
                <div
                  ref={scrollerRef}
                  className="reader-scroll"
                  style={customProperties}
                  onScroll={onScroll}
                  onKeyDownCapture={onSourceListKeyDown}
                  aria-label={`${paneName} source block 목록`}
                  tabIndex={mountedNavigableBlockIds.length === 0 ? 0 : -1}
                  data-reader-mounted-block-count={mountedNavigableBlockIds.length}
                >
                  <div
                    className="reader-document"
                    data-publication-format={document.formatVersion}
                  >
                    {windowed.paddingBefore > 0 && (
                      <div
                        aria-hidden="true"
                        style={{ height: windowed.paddingBefore }}
                        data-reader-window-spacer="before"
                      />
                    )}
                    {windowed.items.map(({ section }) => (
                      <section
                        className="reader-section"
                        key={section.id}
                        data-reader-section-id={section.id}
                        aria-label={section.title || "제목 없는 장면"}
                      >
                        {section.blocks.map((block) => (
                          <PublicationBlockView
                            key={block.id}
                            block={block}
                            config={visibleConfig}
                            selected={block.id === selectedBlockId}
                            tabIndex={block.id === activeSourceBlockId ? 0 : -1}
                            onSelect={selectSourceBlock}
                            onOpenSource={onOpenSource}
                          />
                        ))}
                      </section>
                    ))}
                    {windowed.paddingAfter > 0 && (
                      <div
                        aria-hidden="true"
                        style={{ height: windowed.paddingAfter }}
                        data-reader-window-spacer="after"
                      />
                    )}
                  </div>
                  {!visibleConfigPending &&
                    analysisSnapshot?.key === visibleMeasurementKey &&
                    !measurementCached && (
                      <FullScopeMeasurement
                        key={measurementInstanceKey}
                        document={document}
                        config={analysisSnapshot.config}
                        estimated={analysisSnapshot.estimated}
                        customProperties={customProperties}
                        onStatistics={reportStatistics}
                        onMeasuredBlocks={reportMeasuredBlocks}
                      />
                    )}
                  {measurementCached && (
                    <span
                      hidden
                      data-reader-measurement-status="complete"
                      data-reader-measured-section-count={
                        cachedMeasurement.statistics?.measuredSectionCount ?? 0
                      }
                      data-reader-measured-block-count={
                        cachedMeasurement.statistics?.measuredBlockCount ?? 0
                      }
                      data-reader-total-section-count={document.sections.length}
                    />
                  )}
                </div>
              </div>
            </div>
          </>,
          shadowRoot
        )}
    </section>
  );
}
