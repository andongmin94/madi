import { useEffect, useMemo, useState } from "react";
import type { SavePhase } from "../workspace/DocumentSessionController";
import {
  IME_MANUAL_CHECKS,
  IME_RESULTS_STORAGE_KEY,
  buildImeReport,
  buildPersistedImeResults,
  createInitialImeResults,
  loadImeManualState,
  serializeImeReportJson,
  serializeImeReportMarkdown,
  type CompositionEventSummary,
  type ImeManualEnvironment,
  type ImeRuntimeEnvironment,
  type ManualResult
} from "./imeManualResults";

const AUTOSAVE_LABELS: Readonly<Record<SavePhase, string>> = {
  "no-project": "문서 없음",
  dirty: "자동 저장 대기 중",
  saving: "snapshot 저장 중",
  saved: "snapshot 저장됨",
  restoring: "문서 준비/복원 중",
  error: "저장 오류"
};

export interface ImeChecklistProps {
  readonly isComposing: boolean;
  readonly lastCompositionEvent: CompositionEventSummary | null;
  readonly savePhase: SavePhase;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly hasDocument: boolean;
  readonly busy: boolean;
  readonly environment: ImeRuntimeEnvironment;
  readonly onCreateEmptyDocument: () => void | Promise<void>;
  readonly onSaveSnapshot: () => void | Promise<void>;
  readonly onOpenProject: () => void | Promise<void>;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}

function loadState(environment: ImeRuntimeEnvironment) {
  try {
    const raw = window.localStorage.getItem(IME_RESULTS_STORAGE_KEY);
    return loadImeManualState(raw ? JSON.parse(raw) : null, environment);
  } catch {
    return loadImeManualState(null, environment);
  }
}

function downloadText(
  fileName: string,
  mediaType: string,
  content: string
): void {
  const url = URL.createObjectURL(
    new Blob([content], { type: `${mediaType};charset=utf-8` })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function resultClassName(result: ManualResult): string {
  return result.toLocaleLowerCase().replace(" ", "-");
}

export function ImeChecklist({
  isComposing,
  lastCompositionEvent,
  savePhase,
  canUndo,
  canRedo,
  hasDocument,
  busy,
  environment,
  onCreateEmptyDocument,
  onSaveSnapshot,
  onOpenProject,
  onUndo,
  onRedo
}: ImeChecklistProps) {
  const [manualState, setManualState] = useState(() =>
    loadState(environment)
  );
  const reportEnvironment = useMemo(
    () => ({ ...environment, ...manualState.manualEnvironment }),
    [environment, manualState.manualEnvironment]
  );

  useEffect(() => {
    if (!lastCompositionEvent) {
      return;
    }
    setManualState((current) => ({
      ...current,
      lastCompositionEvent
    }));
  }, [lastCompositionEvent]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        IME_RESULTS_STORAGE_KEY,
        JSON.stringify(
          buildPersistedImeResults(
            manualState.results,
            reportEnvironment,
            manualState.lastCompositionEvent
          )
        )
      );
    } catch {
      // The checklist remains usable if local storage is unavailable.
    }
  }, [manualState, reportEnvironment]);

  const setResult = (id: string, result: ManualResult) => {
    setManualState((current) => ({
      ...current,
      results: { ...current.results, [id]: result },
      resetForEnvironmentChange: false
    }));
  };

  const setEnvironmentField = (
    field: keyof ImeManualEnvironment,
    value: string
  ) => {
    setManualState((current) => ({
      ...current,
      manualEnvironment: {
        ...current.manualEnvironment,
        [field]: value.slice(0, 500)
      }
    }));
  };

  const exportReport = (format: "json" | "markdown") => {
    const report = buildImeReport(
      manualState.results,
      reportEnvironment,
      manualState.lastCompositionEvent
    );
    const day = report.updatedAt.slice(0, 10);
    if (format === "json") {
      downloadText(
        `madi-ime-manual-${day}.json`,
        "application/json",
        serializeImeReportJson(report)
      );
      return;
    }
    downloadText(
      `madi-ime-manual-${day}.md`,
      "text/markdown",
      serializeImeReportMarkdown(report)
    );
  };

  return (
    <aside className="side-panel ime-panel" aria-label="한국어 IME 수동 검사">
      <div className="side-panel__heading">
        <div>
          <p className="eyebrow">MANUAL ONLY</p>
          <h2>한국어 IME Test</h2>
        </div>
        <span
          className={`composition-indicator ${
            isComposing ? "composition-indicator--active" : ""
          }`}
        >
          {isComposing ? "조합 중" : "조합 대기"}
        </span>
      </div>

      <section className="ime-test-status" aria-label="IME 시험 상태">
        <dl>
          <div>
            <dt>Autosave</dt>
            <dd data-testid="ime-autosave-status">
              {AUTOSAVE_LABELS[savePhase]}
            </dd>
          </div>
          <div>
            <dt>Undo / Redo</dt>
            <dd>
              {canUndo ? "Undo 가능" : "Undo 없음"} ·{" "}
              {canRedo ? "Redo 가능" : "Redo 없음"} · 최근 명령 기반 추정
            </dd>
          </div>
          <div>
            <dt>마지막 조합 이벤트</dt>
            <dd data-testid="last-composition-event">
              {manualState.lastCompositionEvent
                ? `${manualState.lastCompositionEvent.type} · dataLength ${manualState.lastCompositionEvent.dataLength} · ${manualState.lastCompositionEvent.observedAt}`
                : "아직 관찰되지 않음"}
            </dd>
          </div>
        </dl>
        <p>
          composition event는 종류·문자 수·시각만 기록합니다. 입력 문자나 원고
          본문은 기록하지 않습니다.
        </p>
      </section>

      {manualState.resetForEnvironmentChange && (
        <p className="ime-environment-warning" role="status">
          앱 또는 Typie 실행 환경이 이전 기록과 달라 15개 결과를 모두 NOT
          TESTED로 초기화했습니다.
        </p>
      )}

      <fieldset className="ime-environment">
        <legend>수동 시험 환경</legend>
        <label>
          Windows version
          <input
            value={manualState.manualEnvironment.windowsVersion}
            onChange={(event) =>
              setEnvironmentField("windowsVersion", event.target.value)
            }
          />
        </label>
        <label>
          Electron version
          <input
            value={manualState.manualEnvironment.electronVersion}
            onChange={(event) =>
              setEnvironmentField("electronVersion", event.target.value)
            }
          />
        </label>
        <label>
          한국어 IME 이름/version
          <input
            value={manualState.manualEnvironment.imeNameAndVersion}
            onChange={(event) =>
              setEnvironmentField("imeNameAndVersion", event.target.value)
            }
          />
        </label>
        <label>
          Keyboard layout
          <input
            value={manualState.manualEnvironment.keyboardLayout}
            onChange={(event) =>
              setEnvironmentField("keyboardLayout", event.target.value)
            }
          />
        </label>
        <label>
          Display scale
          <input
            value={manualState.manualEnvironment.displayScale}
            onChange={(event) =>
              setEnvironmentField("displayScale", event.target.value)
            }
          />
        </label>
        <label>
          Test date
          <input
            type="date"
            value={manualState.manualEnvironment.testDate}
            onChange={(event) =>
              setEnvironmentField("testDate", event.target.value)
            }
          />
        </label>
        <label>
          Tester
          <input
            value={manualState.manualEnvironment.tester}
            onChange={(event) =>
              setEnvironmentField("tester", event.target.value)
            }
          />
        </label>
      </fieldset>

      <div className="ime-actions" aria-label="IME 시험 문서 작업">
        <button
          type="button"
          className="quiet-button"
          disabled={busy}
          onClick={() => void onCreateEmptyDocument()}
        >
          테스트용 빈 문서 생성
        </button>
        <button
          type="button"
          className="quiet-button"
          disabled={!hasDocument || busy}
          onClick={() => void onSaveSnapshot()}
        >
          snapshot 지금 저장
        </button>
        <button
          type="button"
          className="quiet-button"
          disabled={busy}
          onClick={() => void onOpenProject()}
        >
          저장한 .madi 열기
        </button>
        <div className="ime-history-actions">
          <button
            type="button"
            className="quiet-button"
            disabled={!hasDocument || !canUndo || busy}
            onClick={onUndo}
          >
            Undo
          </button>
          <button
            type="button"
            className="quiet-button"
            disabled={!hasDocument || !canRedo || busy}
            onClick={onRedo}
          >
            Redo
          </button>
        </div>
      </div>

      <div className="ime-reopen-guide">
        <strong>완전 종료 복원 시험</strong>
        <ol>
          <li>snapshot 저장 완료를 확인합니다.</li>
          <li>Electron 창을 닫고 프로세스가 끝날 때까지 기다립니다.</li>
          <li>madi를 다시 실행해 ‘저장한 .madi 열기’를 누릅니다.</li>
        </ol>
      </div>

      <p className="panel-copy">
        왼쪽의 실제 Typie mount에서 항목을 수행하세요. 체크박스를 사람이
        선택한 항목만 PASS가 됩니다. 실패는 FAIL 버튼으로 기록합니다.
      </p>
      <ol className="ime-checks">
        {IME_MANUAL_CHECKS.map(({ id, label }) => {
          const result = manualState.results[id] ?? "NOT TESTED";
          return (
            <li key={id}>
              <label>
                <input
                  type="checkbox"
                  checked={result === "PASS"}
                  onChange={(event) =>
                    setResult(id, event.target.checked ? "PASS" : "NOT TESTED")
                  }
                />
                <span>{label}</span>
              </label>
              <div className="manual-result-controls">
                <output
                  className={`manual-result manual-result--${resultClassName(
                    result
                  )}`}
                  aria-live="polite"
                >
                  {result}
                </output>
                <button
                  type="button"
                  className="manual-fail"
                  aria-pressed={result === "FAIL"}
                  aria-label={`${label}: FAIL 기록`}
                  onClick={() =>
                    setResult(id, result === "FAIL" ? "NOT TESTED" : "FAIL")
                  }
                >
                  FAIL
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="ime-report-actions">
        <button
          type="button"
          className="quiet-button"
          onClick={() => exportReport("json")}
        >
          결과 JSON 내보내기
        </button>
        <button
          type="button"
          className="quiet-button"
          onClick={() => exportReport("markdown")}
        >
          결과 Markdown 내보내기
        </button>
      </div>
      <button
        type="button"
        className="quiet-button ime-reset"
        onClick={() =>
          setManualState((current) => ({
            ...current,
            results: createInitialImeResults(),
            resetForEnvironmentChange: false
          }))
        }
      >
        모두 NOT TESTED로 초기화
      </button>
    </aside>
  );
}
