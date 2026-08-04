import type {
  PublicationDocument,
  ReaderDeviceCategory,
  ReaderFontToken,
  ReaderPaneOverrides,
  ReaderRenderConfig,
  ReaderSettings,
  ReaderTheme,
  WorkStyle
} from "../../../shared/publication";
import { READER_FONT_TOKENS, READER_LIMITS } from "../../../shared/readerConfigValidation";
import { defaultThemeColors } from "./readerConfig";
import type { ReaderRenderStatistics } from "./types";

interface ReaderSettingsPanelProps {
  readonly document: PublicationDocument | null;
  readonly config: ReaderRenderConfig;
  readonly statistics: ReaderRenderStatistics | null;
  readonly measurementPending: boolean;
  readonly zoom: number;
  readonly onOverrides: (patch: ReaderPaneOverrides) => void;
  readonly onZoom: (zoom: number) => void;
}

function NumberControl({
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly onChange: (value: number) => void;
}) {
  return (
    <label className="reader-control">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber;
          if (Number.isFinite(next)) {
            onChange(Math.min(max, Math.max(min, next)));
          }
        }}
      />
    </label>
  );
}

export function ReaderSettingsPanel({
  document,
  config,
  statistics,
  measurementPending,
  zoom,
  onOverrides,
  onZoom
}: ReaderSettingsPanelProps) {
  const settingsPatch = (patch: Partial<ReaderSettings>) =>
    onOverrides({ readerSettings: patch });
  const devicePatch = (patch: {
    readonly deviceCategory?: ReaderDeviceCategory;
    readonly viewportWidth?: number;
    readonly viewportHeight?: number;
  }) => onOverrides(patch);
  const maximumHorizontalPadding = Math.min(
    READER_LIMITS.padding.max,
    Math.floor((config.device.viewportWidth - 1) / 2)
  );
  const effectiveViewportHeight =
    config.device.viewportHeight -
    config.device.readerChromeHeight -
    config.device.safeAreaTop -
    config.device.safeAreaBottom;
  const measurementComplete =
    !measurementPending && statistics?.measurementStatus === "COMPLETE";
  const measurementRunning =
    measurementPending || statistics?.measurementStatus === "MEASURING";
  const maximumVerticalPadding = Math.min(
    READER_LIMITS.padding.max,
    Math.floor((effectiveViewportHeight - 1) / 2)
  );
  const minimumViewportWidth = Math.max(
    READER_LIMITS.viewportWidth.min,
    config.settings.horizontalPadding * 2 + 1
  );
  const minimumViewportHeight = Math.max(
    READER_LIMITS.viewportHeight.min,
    config.device.readerChromeHeight +
      config.device.safeAreaTop +
      config.device.safeAreaBottom +
      config.settings.verticalPadding * 2 +
      1
  );

  return (
    <aside className="reader-settings" aria-label="독서 설정과 통계">
      <header>
        <p className="reader-eyebrow">ACTIVE PANE</p>
        <h2>독서 설정</h2>
      </header>

      <fieldset>
        <legend>기기</legend>
        <label className="reader-control">
          <span>분류</span>
          <select
            value={config.device.category}
            onChange={(event) =>
              devicePatch({
                deviceCategory: event.currentTarget.value as ReaderDeviceCategory
              })
            }
          >
            <option value="PHONE">모바일</option>
            <option value="TABLET">태블릿</option>
            <option value="DESKTOP">데스크톱</option>
          </select>
        </label>
        <NumberControl
          label="viewport 너비"
          value={config.device.viewportWidth}
          min={minimumViewportWidth}
          max={READER_LIMITS.viewportWidth.max}
          step={1}
          onChange={(viewportWidth) => devicePatch({ viewportWidth })}
        />
        <NumberControl
          label="viewport 높이"
          value={config.device.viewportHeight}
          min={minimumViewportHeight}
          max={READER_LIMITS.viewportHeight.max}
          step={1}
          onChange={(viewportHeight) => devicePatch({ viewportHeight })}
        />
        <NumberControl
          label="미리보기 zoom"
          value={zoom}
          min={READER_LIMITS.zoom.min}
          max={READER_LIMITS.zoom.max}
          step={0.05}
          onChange={onZoom}
        />
      </fieldset>

      <fieldset>
        <legend>글자와 문단</legend>
        <label className="reader-control">
          <span>글꼴 token</span>
          <select
            value={config.settings.fontFamilyToken}
            onChange={(event) =>
              settingsPatch({
                fontFamilyToken: event.currentTarget.value as ReaderFontToken
              })
            }
          >
            {READER_FONT_TOKENS.map((token) => (
              <option key={token} value={token}>
                {token}
              </option>
            ))}
          </select>
        </label>
        <NumberControl label="글자 크기" value={config.settings.fontSize} min={10} max={40} step={1} onChange={(fontSize) => settingsPatch({ fontSize })} />
        <NumberControl label="줄간격" value={config.settings.lineHeight} min={1} max={3} step={0.05} onChange={(lineHeight) => settingsPatch({ lineHeight })} />
        <NumberControl label="문단간격" value={config.settings.paragraphSpacing} min={0} max={120} step={1} onChange={(paragraphSpacing) => settingsPatch({ paragraphSpacing })} />
        <NumberControl label="첫 줄 들여쓰기" value={config.settings.firstLineIndent} min={0} max={120} step={1} onChange={(firstLineIndent) => settingsPatch({ firstLineIndent })} />
        <NumberControl label="가로 여백" value={config.settings.horizontalPadding} min={0} max={maximumHorizontalPadding} step={1} onChange={(horizontalPadding) => settingsPatch({ horizontalPadding })} />
        <NumberControl label="세로 여백" value={config.settings.verticalPadding} min={0} max={maximumVerticalPadding} step={1} onChange={(verticalPadding) => settingsPatch({ verticalPadding })} />
        <label className="reader-control">
          <span>정렬</span>
          <select
            value={config.settings.textAlign}
            onChange={(event) =>
              settingsPatch({
                textAlign: event.currentTarget.value as ReaderSettings["textAlign"]
              })
            }
          >
            <option value="LEFT">왼쪽</option>
            <option value="JUSTIFY">양쪽</option>
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>테마와 표시</legend>
        <label className="reader-control">
          <span>테마</span>
          <select
            value={config.settings.theme}
            onChange={(event) => {
              const theme = event.currentTarget.value as ReaderTheme;
              settingsPatch({ theme, ...defaultThemeColors(theme) });
            }}
          >
            <option value="LIGHT">light</option>
            <option value="SEPIA">sepia</option>
            <option value="DARK">dark</option>
            <option value="CUSTOM">custom</option>
          </select>
        </label>
        {config.settings.theme === "CUSTOM" && (
          <>
            <label className="reader-control">
              <span>배경색</span>
              <input type="color" value={config.settings.backgroundColor} onChange={(event) => settingsPatch({ backgroundColor: event.currentTarget.value })} />
            </label>
            <label className="reader-control">
              <span>글자색</span>
              <input type="color" value={config.settings.textColor} onChange={(event) => settingsPatch({ textColor: event.currentTarget.value })} />
            </label>
          </>
        )}
        <label className="reader-check"><input type="checkbox" checked={config.settings.showChapterTitle} onChange={(event) => settingsPatch({ showChapterTitle: event.currentTarget.checked })} />화 제목 표시</label>
        <label className="reader-check"><input type="checkbox" checked={config.settings.showSceneTitle} onChange={(event) => settingsPatch({ showSceneTitle: event.currentTarget.checked })} />장면 제목 표시</label>
        <label className="reader-control">
          <span>장면 구분</span>
          <select
            value={config.workStyle.sceneBreakStyleToken}
            onChange={(event) =>
              onOverrides({
                sceneBreakStyleToken: event.currentTarget
                  .value as WorkStyle["sceneBreakStyleToken"]
              })
            }
          >
            <option value="DIAMONDS">◆ ◆ ◆</option>
            <option value="RULE">선</option>
            <option value="SPACE">여백</option>
            <option value="HIDDEN">숨김</option>
          </select>
        </label>
      </fieldset>

      <section className="reader-statistics" aria-label="독서환경 통계">
        <h3>통계</h3>
        {measurementRunning && (
          <p role="status">
            측정 중…
            {statistics
              ? ` · ${statistics.measuredSectionCount}/${statistics.totalSectionCount} section`
              : ""}
          </p>
        )}
        <dl>
          <div><dt>공백 포함</dt><dd>{document?.stats.withSpaces.toLocaleString() ?? "—"}자</dd></div>
          <div><dt>공백 제외</dt><dd>{document?.stats.withoutSpaces.toLocaleString() ?? "—"}자</dd></div>
          <div><dt>문단</dt><dd>{document?.stats.paragraphCount.toLocaleString() ?? "—"}</dd></div>
          <div><dt>장면 / 화</dt><dd>{document ? `${document.stats.sceneCount} / ${document.stats.chapterCount}` : "—"}</dd></div>
          <div><dt>content 높이</dt><dd>{statistics ? `${measurementComplete ? "" : "약 "}${statistics.renderedContentHeight.toLocaleString()}px` : "—"}</dd></div>
          <div><dt>effective viewport</dt><dd>{statistics ? `${statistics.viewportHeight}px` : "—"}</dd></div>
          <div><dt>{measurementComplete ? "측정 화면 수" : "예상 화면 수"}</dt><dd>{statistics?.estimatedScreenCount ?? "—"}</dd></div>
          <div><dt>화면당 평균 글자</dt><dd>{statistics?.averageCharactersPerScreen.toLocaleString() ?? "—"}</dd></div>
          <div><dt>{measurementComplete ? "최장 문단 측정 줄" : "최장 문단 추정 줄"}</dt><dd>{statistics?.longestParagraphLineCount ?? "—"}</dd></div>
          <div><dt>{measurementComplete ? "8줄 이상 측정" : "8줄 이상 추정"}</dt><dd>{statistics?.paragraphsAtLeastEightLines ?? "—"}</dd></div>
          <div><dt>연속 빈 문단 구간</dt><dd>{statistics?.consecutiveEmptyParagraphRuns ?? "—"}</dd></div>
          <div><dt>{measurementComplete ? "전체 scope overflow" : "측정 중 overflow"}</dt><dd>{statistics?.horizontalOverflowCount ?? "—"}</dd></div>
        </dl>
        <p>{measurementComplete ? "동일한 Shadow CSS로 전체 scope를 순차 측정했습니다." : "측정 완료 전에는 현재 설정 기반 추정치를 표시합니다."}</p>
        <p>줄 수와 측정값은 브라우저·설치 글꼴에 따라 달라질 수 있습니다.</p>
      </section>
    </aside>
  );
}
