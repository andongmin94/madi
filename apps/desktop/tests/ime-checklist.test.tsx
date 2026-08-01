import {
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImeChecklist } from "../src/renderer/components/ImeChecklist";
import {
  IME_MANUAL_CHECKS,
  IME_RESULTS_STORAGE_KEY,
  buildImeReport,
  buildPersistedImeResults,
  createInitialImeResults,
  serializeImeReportJson,
  serializeImeReportMarkdown
} from "../src/renderer/components/imeManualResults";

const environment = {
  appVersion: "0.0.1",
  typieCommit: "fbe5c4bf860d1717a66e66bea2374a2e39f0dd26",
  editorSchemaVersion: 1,
  platform: "Win32",
  userAgent: "madi-test-runtime"
};

const manualEnvironment = {
  windowsVersion: "Windows 11 24H2",
  electronVersion: "37.10.3",
  imeNameAndVersion: "Microsoft IME 15",
  keyboardLayout: "Korean 103/106",
  displayScale: "150%",
  testDate: "2026-08-01",
  tester: "tester-a"
};

const reportEnvironment = { ...environment, ...manualEnvironment };

function renderChecklist(overrides = {}) {
  const actions = {
    onCreateEmptyDocument: vi.fn(),
    onSaveSnapshot: vi.fn(),
    onOpenProject: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn()
  };
  render(
    <ImeChecklist
      isComposing={false}
      lastCompositionEvent={null}
      savePhase="dirty"
      canUndo
      canRedo={false}
      hasDocument
      busy={false}
      environment={environment}
      {...actions}
      {...overrides}
    />
  );
  return actions;
}

describe("Phase 0.5 IME manual checklist", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        key: (index: number) => [...values.keys()][index] ?? null,
        get length() {
          return values.size;
        },
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value)
      } satisfies Storage
    });
    window.localStorage.clear();
  });

  it("starts with exactly 15 NOT TESTED checkboxes", () => {
    renderChecklist();

    const checkboxes = screen.getAllByRole("checkbox");
    expect(IME_MANUAL_CHECKS).toHaveLength(15);
    expect(IME_MANUAL_CHECKS.map(({ label }) => label)).toEqual([
      "한글 문장 연속 입력",
      "초성·중성·종성 조합",
      "복합모음과 겹받침",
      "조합 직후 Enter",
      "조합 직후 Undo",
      "Undo 후 Redo",
      "조합 직후 방향키 이동",
      "선택 후 삭제",
      "한글 문장 복사·붙여넣기",
      "한글 또는 Word 계열 프로그램에서 붙여넣기",
      "장면 구분선 앞뒤에서 입력",
      "빠른 입력 시 중복·누락 확인",
      "저장 후 앱 완전 종료",
      "재실행 후 동일 문서 복원",
      "5,000자 이상 한글 원고 입력 또는 붙여넣기"
    ]);
    expect(checkboxes).toHaveLength(15);
    for (const checkbox of checkboxes) {
      expect((checkbox as HTMLInputElement).checked).toBe(false);
    }
    expect(screen.getAllByText("NOT TESTED")).toHaveLength(15);
  });

  it("marks only a human-selected item PASS and persists redacted run data", async () => {
    renderChecklist();

    fireEvent.click(screen.getAllByRole("checkbox")[0]!);

    expect(screen.getAllByText("PASS")).toHaveLength(1);
    expect(screen.getAllByText("NOT TESTED")).toHaveLength(14);
    await waitFor(() => {
      const saved = JSON.parse(
        window.localStorage.getItem(IME_RESULTS_STORAGE_KEY) ?? "{}"
      ) as Record<string, unknown>;
      expect(saved).toMatchObject({
        schemaVersion: 2,
        environment: {
          ...environment,
          windowsVersion: "",
          imeNameAndVersion: "",
          tester: ""
        },
        lastCompositionEvent: null
      });
      expect(JSON.stringify(saved)).not.toContain("manuscript");
      expect(JSON.stringify(saved)).not.toContain("원고 본문");
    });
  });

  it("persists the required manual environment and redacted composition summary", async () => {
    renderChecklist({
      lastCompositionEvent: {
        type: "compositionend",
        dataLength: 2,
        observedAt: "2026-08-01T10:00:00.000Z"
      }
    });

    for (const [label, value] of [
      ["Windows version", manualEnvironment.windowsVersion],
      ["Electron version", manualEnvironment.electronVersion],
      ["한국어 IME 이름/version", manualEnvironment.imeNameAndVersion],
      ["Keyboard layout", manualEnvironment.keyboardLayout],
      ["Display scale", manualEnvironment.displayScale],
      ["Test date", manualEnvironment.testDate],
      ["Tester", manualEnvironment.tester]
    ] as const) {
      fireEvent.change(screen.getByLabelText(label), {
        target: { value }
      });
    }

    await waitFor(() => {
      const saved = JSON.parse(
        window.localStorage.getItem(IME_RESULTS_STORAGE_KEY) ?? "{}"
      ) as Record<string, unknown>;
      expect(saved).toMatchObject({
        schemaVersion: 2,
        environment: reportEnvironment,
        lastCompositionEvent: {
          type: "compositionend",
          dataLength: 2
        }
      });
      expect(JSON.stringify(saved)).not.toContain("비밀");
    });
  });

  it("resets old PASS results when the app or Typie runtime identity changes", () => {
    const oldEnvironment = {
      ...reportEnvironment,
      typieCommit: "1111111111111111111111111111111111111111"
    };
    const oldResults = {
      ...createInitialImeResults(),
      [IME_MANUAL_CHECKS[0]!.id]: "PASS" as const
    };
    window.localStorage.setItem(
      IME_RESULTS_STORAGE_KEY,
      JSON.stringify(
        buildPersistedImeResults(oldResults, oldEnvironment, null)
      )
    );

    renderChecklist();

    expect(screen.getAllByText("NOT TESTED")).toHaveLength(15);
    expect(screen.getByText(/실행 환경이 이전 기록과 달라/)).toBeTruthy();
  });

  it("records FAIL separately and exposes the real document actions", () => {
    const actions = renderChecklist();
    const firstLabel = IME_MANUAL_CHECKS[0]!.label;

    fireEvent.click(
      screen.getByRole("button", { name: `${firstLabel}: FAIL 기록` })
    );
    expect(
      screen
        .getAllByText("FAIL")
        .filter((element) => element.tagName === "OUTPUT")
    ).toHaveLength(1);

    fireEvent.click(
      screen.getByRole("button", { name: "테스트용 빈 문서 생성" })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "snapshot 지금 저장" })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "저장한 .madi 열기" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(actions.onCreateEmptyDocument).toHaveBeenCalledTimes(1);
    expect(actions.onSaveSnapshot).toHaveBeenCalledTimes(1);
    expect(actions.onOpenProject).toHaveBeenCalledTimes(1);
    expect(actions.onUndo).toHaveBeenCalledTimes(1);
    expect(actions.onRedo).not.toHaveBeenCalled();
    expect(screen.getByTestId("ime-autosave-status").textContent).toBe(
      "자동 저장 대기 중"
    );
    expect(screen.getByText(/최근 명령 기반 추정/)).toBeTruthy();
  });

  it("exports environment, results and redacted composition metadata only", () => {
    const results = {
      ...createInitialImeResults(),
      [IME_MANUAL_CHECKS[0]!.id]: "PASS" as const
    };
    const report = buildImeReport(
      results,
      reportEnvironment,
      {
        type: "compositionend",
        dataLength: 3,
        observedAt: "2026-07-30T10:00:00.000Z"
      },
      "2026-07-30T10:01:00.000Z"
    );
    const json = serializeImeReportJson(report);
    const markdown = serializeImeReportMarkdown(report);

    expect(Object.keys(report.results)).toHaveLength(15);
    expect(json).toContain('"dataLength": 3');
    expect(json).toContain('"tester": "tester-a"');
    expect(markdown).toContain("Microsoft IME 15");
    expect(markdown).toContain("madi Phase 0.5 한국어 IME 수동 검사 결과");
    expect(json).not.toContain("composition data");
    expect(json).not.toContain("원고 내용");
    expect(markdown).toContain("원고 본문을 포함하지 않는다");
  });
});
