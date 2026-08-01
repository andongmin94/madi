export type ManualResult = "NOT TESTED" | "PASS" | "FAIL";

export interface ImeManualCheck {
  readonly id: string;
  readonly label: string;
}

export const IME_MANUAL_CHECKS = [
  { id: "continuous-korean", label: "한글 문장 연속 입력" },
  { id: "syllable-composition", label: "초성·중성·종성 조합" },
  { id: "compound-characters", label: "복합모음과 겹받침" },
  { id: "enter-after-composition", label: "조합 직후 Enter" },
  { id: "undo-after-composition", label: "조합 직후 Undo" },
  { id: "redo-after-undo", label: "Undo 후 Redo" },
  { id: "cursor-after-composition", label: "조합 직후 방향키 이동" },
  { id: "selection-delete", label: "선택 후 삭제" },
  { id: "internal-copy-paste", label: "한글 문장 복사·붙여넣기" },
  {
    id: "external-copy-paste",
    label: "한글 또는 Word 계열 프로그램에서 붙여넣기"
  },
  { id: "scene-break-input", label: "장면 구분선 앞뒤에서 입력" },
  { id: "rapid-input", label: "빠른 입력 시 중복·누락 확인" },
  { id: "save-full-exit", label: "저장 후 앱 완전 종료" },
  { id: "relaunch-restore", label: "재실행 후 동일 문서 복원" },
  {
    id: "korean-5000-characters",
    label: "5,000자 이상 한글 원고 입력 또는 붙여넣기"
  }
] as const satisfies readonly ImeManualCheck[];

export const IME_RESULTS_STORAGE_KEY =
  "madi.phase-0-5.ime-manual-results.v2";

export interface CompositionEventSummary {
  readonly type: "compositionstart" | "compositionupdate" | "compositionend";
  readonly dataLength: number;
  readonly observedAt: string;
}

export interface ImeRuntimeEnvironment {
  readonly appVersion: string;
  readonly typieCommit: string;
  readonly editorSchemaVersion: number;
  readonly platform: string;
  readonly userAgent: string;
}

export interface ImeManualEnvironment {
  readonly windowsVersion: string;
  readonly electronVersion: string;
  readonly imeNameAndVersion: string;
  readonly keyboardLayout: string;
  readonly displayScale: string;
  readonly testDate: string;
  readonly tester: string;
}

export interface ImeTestEnvironment
  extends ImeRuntimeEnvironment,
    ImeManualEnvironment {}

export type ImeResultMap = Readonly<Record<string, ManualResult>>;

export interface PersistedImeResults {
  readonly schemaVersion: 2;
  readonly updatedAt: string;
  readonly environment: ImeTestEnvironment;
  readonly results: ImeResultMap;
  readonly lastCompositionEvent: CompositionEventSummary | null;
}

export interface ImeReport extends PersistedImeResults {
  readonly reportType: "madi-phase-0-5-ime-manual-report";
}

export interface LoadedImeManualState {
  readonly results: ImeResultMap;
  readonly manualEnvironment: ImeManualEnvironment;
  readonly lastCompositionEvent: CompositionEventSummary | null;
  readonly resetForEnvironmentChange: boolean;
}

const VALID_RESULTS = new Set<ManualResult>([
  "NOT TESTED",
  "PASS",
  "FAIL"
]);

export function createInitialImeResults(): ImeResultMap {
  return Object.fromEntries(
    IME_MANUAL_CHECKS.map(({ id }) => [id, "NOT TESTED"])
  );
}

export function createInitialManualEnvironment(): ImeManualEnvironment {
  return {
    windowsVersion: "",
    electronVersion: "",
    imeNameAndVersion: "",
    keyboardLayout: "",
    displayScale: "",
    testDate: "",
    tester: ""
  };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 500) : "";
}

function normalizeManualEnvironment(value: unknown): ImeManualEnvironment {
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<ImeManualEnvironment>)
      : {};
  return {
    windowsVersion: readString(candidate.windowsVersion),
    electronVersion: readString(candidate.electronVersion),
    imeNameAndVersion: readString(candidate.imeNameAndVersion),
    keyboardLayout: readString(candidate.keyboardLayout),
    displayScale: readString(candidate.displayScale),
    testDate: readString(candidate.testDate),
    tester: readString(candidate.tester)
  };
}

function normalizeCompositionEvent(
  value: unknown
): CompositionEventSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<CompositionEventSummary>;
  if (
    candidate.type !== "compositionstart" &&
    candidate.type !== "compositionupdate" &&
    candidate.type !== "compositionend"
  ) {
    return null;
  }
  if (
    !Number.isInteger(candidate.dataLength) ||
    (candidate.dataLength ?? -1) < 0 ||
    typeof candidate.observedAt !== "string"
  ) {
    return null;
  }
  return {
    type: candidate.type,
    dataLength: candidate.dataLength ?? 0,
    observedAt: candidate.observedAt.slice(0, 100)
  };
}

function sameRuntimeEnvironment(
  stored: Partial<ImeRuntimeEnvironment>,
  current: ImeRuntimeEnvironment
): boolean {
  return (
    stored.appVersion === current.appVersion &&
    stored.typieCommit === current.typieCommit &&
    stored.editorSchemaVersion === current.editorSchemaVersion &&
    stored.platform === current.platform &&
    stored.userAgent === current.userAgent
  );
}

export function normalizeImeResults(value: unknown): ImeResultMap {
  const fallback = createInitialImeResults();
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const candidate = value as Partial<PersistedImeResults>;
  if (
    candidate.schemaVersion !== 2 ||
    !candidate.results ||
    typeof candidate.results !== "object"
  ) {
    return fallback;
  }
  return Object.fromEntries(
    IME_MANUAL_CHECKS.map(({ id }) => {
      const result = candidate.results?.[id];
      return [id, VALID_RESULTS.has(result as ManualResult) ? result : "NOT TESTED"];
    })
  ) as ImeResultMap;
}

export function loadImeManualState(
  value: unknown,
  currentEnvironment: ImeRuntimeEnvironment
): LoadedImeManualState {
  const fallback = {
    results: createInitialImeResults(),
    manualEnvironment: createInitialManualEnvironment(),
    lastCompositionEvent: null,
    resetForEnvironmentChange: false
  } satisfies LoadedImeManualState;
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const candidate = value as Partial<PersistedImeResults>;
  if (
    candidate.schemaVersion !== 2 ||
    !candidate.environment ||
    typeof candidate.environment !== "object"
  ) {
    return fallback;
  }
  if (!sameRuntimeEnvironment(candidate.environment, currentEnvironment)) {
    return {
      ...fallback,
      resetForEnvironmentChange: true
    };
  }
  return {
    results: normalizeImeResults(candidate),
    manualEnvironment: normalizeManualEnvironment(candidate.environment),
    lastCompositionEvent: normalizeCompositionEvent(
      candidate.lastCompositionEvent
    ),
    resetForEnvironmentChange: false
  };
}

export function buildPersistedImeResults(
  results: ImeResultMap,
  environment: ImeTestEnvironment,
  lastCompositionEvent: CompositionEventSummary | null,
  updatedAt = new Date().toISOString()
): PersistedImeResults {
  return {
    schemaVersion: 2,
    updatedAt,
    environment: {
      ...environment,
      ...normalizeManualEnvironment(environment)
    },
    results: Object.fromEntries(
      IME_MANUAL_CHECKS.map(({ id }) => [id, results[id] ?? "NOT TESTED"])
    ),
    lastCompositionEvent: normalizeCompositionEvent(lastCompositionEvent)
  };
}

export function buildImeReport(
  results: ImeResultMap,
  environment: ImeTestEnvironment,
  lastCompositionEvent: CompositionEventSummary | null,
  updatedAt = new Date().toISOString()
): ImeReport {
  return {
    reportType: "madi-phase-0-5-ime-manual-report",
    ...buildPersistedImeResults(
      results,
      environment,
      lastCompositionEvent,
      updatedAt
    )
  };
}

export function serializeImeReportJson(report: ImeReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function escapeMarkdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function serializeImeReportMarkdown(report: ImeReport): string {
  const composition = report.lastCompositionEvent
    ? `${report.lastCompositionEvent.type}, dataLength=${report.lastCompositionEvent.dataLength}, ${report.lastCompositionEvent.observedAt}`
    : "관찰 전";
  const rows = IME_MANUAL_CHECKS.map(
    ({ id, label }, index) =>
      `| ${index + 1} | ${escapeMarkdownCell(label)} | ${report.results[id] ?? "NOT TESTED"} |`
  ).join("\n");
  return `# madi Phase 0.5 한국어 IME 수동 검사 결과

- 생성 시각: ${report.updatedAt}
- madi app version: ${escapeMarkdownCell(report.environment.appVersion)}
- Typie commit: \`${report.environment.typieCommit}\`
- editor schema: ${report.environment.editorSchemaVersion}
- platform: ${escapeMarkdownCell(report.environment.platform)}
- user agent: ${escapeMarkdownCell(report.environment.userAgent)}
- Windows version: ${escapeMarkdownCell(report.environment.windowsVersion || "미입력")}
- Electron version: ${escapeMarkdownCell(report.environment.electronVersion || "미입력")}
- 한국어 IME: ${escapeMarkdownCell(report.environment.imeNameAndVersion || "미입력")}
- keyboard layout: ${escapeMarkdownCell(report.environment.keyboardLayout || "미입력")}
- display scale: ${escapeMarkdownCell(report.environment.displayScale || "미입력")}
- test date: ${escapeMarkdownCell(report.environment.testDate || "미입력")}
- tester: ${escapeMarkdownCell(report.environment.tester || "미입력")}
- 마지막 composition event: ${escapeMarkdownCell(composition)}

> 이 보고서는 수동 체크 상태와 실행 환경만 포함하며 원고 본문을 포함하지 않는다.

| # | 항목 | 결과 |
|---:|---|---|
${rows}
`;
}
