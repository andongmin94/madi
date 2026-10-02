import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from "react";
import { BUILT_IN_HWPX_PRESETS } from "../../../shared/hwpxBuiltins";
import type {
  HwpxExportPresetConfig,
  HwpxExportProgress,
  HwpxExportReport,
  HwpxExportState,
  HwpxHeadingStyleConfig,
  HwpxOutputSelection,
  HwpxValidationMessage,
  RunHwpxExportResult,
  ValidateHwpxExportResult
} from "../../../shared/hwpxExport";
import { validateHwpxExportPresetConfig } from "../../../shared/hwpxExportValidation";
import type {
  PublicationExportModeHandle,
  PublicationExportModeProps
} from "../PublicationExportMode";
import "./hwpxExport.css";

type Phase = "IDLE" | "PREPARING" | "VALIDATING" | "EXPORTING" | "CANCELLING";

const ZERO_HASH = "0".repeat(64);

function stageLabel(stage: HwpxExportProgress["stage"]): string {
  switch (stage) {
    case "PUBLICATION_COMPILE":
      return "Publication IR 생성";
    case "STYLE_TABLE":
      return "스타일·글꼴 표 생성";
    case "SECTION_XML":
      return "본문 XML 생성";
    case "HWPX_PACKAGE":
      return "HWPX package 생성";
    case "INTERNAL_VALIDATION":
      return "madi 내부 검증";
    case "FINALIZE":
      return "원자적 저장";
  }
}

function suggestedName(title: string): string {
  return `${title.trim() || "작품"}.hwpx`;
}

function sameConfig(left: HwpxExportPresetConfig, right: HwpxExportPresetConfig): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "한글 문서 내보내기 작업을 완료하지 못했습니다.";
}

export const HwpxExportWorkspace = forwardRef<
  PublicationExportModeHandle,
  PublicationExportModeProps
>(function HwpxExportWorkspace(
  {
    api,
    sessionId,
    projectId,
    projectRevision,
    projectTree,
    initialScopeNodeId,
    reloadToken,
    interactionBlocked,
    onBeforeExport,
    onProjectRevision,
    onOpenSource,
    onOperationBusyChange
  },
  ref
) {
  const initialBuiltIn = BUILT_IN_HWPX_PRESETS[0]!;
  const [state, setState] = useState<HwpxExportState | null>(null);
  const [config, setConfig] = useState<HwpxExportPresetConfig>(
    initialBuiltIn.config
  );
  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    `BUILTIN:${initialBuiltIn.id}`
  );
  const [presetName, setPresetName] = useState("나의 HWPX 설정");
  const [scopeNodeId, setScopeNodeId] = useState(
    initialScopeNodeId ??
      projectTree.nodes.find((node) => node.kind === "WORK")?.id ??
      projectTree.nodes[0]?.id ??
      ""
  );
  const [output, setOutput] = useState<HwpxOutputSelection | null>(null);
  const [titlePage, setTitlePage] = useState({
    subtitle: "",
    genre: "",
    contact: ""
  });
  const [phase, setPhase] = useState<Phase>("IDLE");
  const [progress, setProgress] = useState<HwpxExportProgress | null>(null);
  const [validationResult, setValidationResult] =
    useState<ValidateHwpxExportResult | null>(null);
  const [exportResult, setExportResult] = useState<
    Extract<RunHwpxExportResult, { status: "COMPLETED" }> | null
  >(null);
  const [resultKey, setResultKey] = useState<string | null>(null);
  const [validationKey, setValidationKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auxiliaryBusy, setAuxiliaryBusy] = useState(false);
  const activeOperationRef = useRef<string | null>(null);
  const mainOperationRef = useRef<string | null>(null);
  const savedPreparationRef = useRef<string | null>(null);
  const completionRef = useRef<Promise<void>>(Promise.resolve());
  const completionResolveRef = useRef<(() => void) | null>(null);
  const auxiliaryRef = useRef<Promise<unknown> | null>(null);
  const loadTasksRef = useRef(new Set<Promise<boolean>>());
  const loadGenerationRef = useRef(0);
  const phaseRef = useRef(phase);
  const stateRef = useRef(state);
  const closeBarrierRef = useRef(false);
  const onProjectRevisionRef = useRef(onProjectRevision);
  onProjectRevisionRef.current = onProjectRevision;
  phaseRef.current = phase;
  stateRef.current = state;

  const scopes = useMemo(
    () =>
      projectTree.nodes.filter((node) =>
        ["WORK", "VOLUME", "CHAPTER", "SCENE"].includes(node.kind)
      ),
    [projectTree.nodes]
  );
  const selectedScope = scopes.find((node) => node.id === scopeNodeId) ?? scopes[0];
  const customPreset = state?.presets.find((preset) => preset.id === selectedPresetId);
  const builtIn = selectedPresetId.startsWith("BUILTIN:")
    ? BUILT_IN_HWPX_PRESETS.find(
        (preset) => `BUILTIN:${preset.id}` === selectedPresetId
      )
    : undefined;
  const effectivePreset =
    customPreset && sameConfig(customPreset.config, config)
      ? { id: customPreset.id, hash: customPreset.contentHash }
      : builtIn && sameConfig(builtIn.config, config)
        ? { id: builtIn.id, hash: ZERO_HASH }
        : { id: "ONE_OFF", hash: ZERO_HASH };
  const currentKey = JSON.stringify({
    revision: Math.max(projectRevision, state?.revision ?? 0),
    scopeNodeId,
    config,
    titlePage,
    preset: effectivePreset
  });
  const busy = phase !== "IDLE" || auxiliaryBusy;

  useEffect(() => {
    onOperationBusyChange(busy);
  }, [busy, onOperationBusyChange]);

  const load = useCallback((): Promise<boolean> => {
    if (closeBarrierRef.current) {
      return Promise.resolve(false);
    }
    const generation = ++loadGenerationRef.current;
    const task = (async (): Promise<boolean> => {
      try {
        const next = await api.getHwpxExportState({ sessionId });
        if (
          closeBarrierRef.current ||
          generation !== loadGenerationRef.current
        ) {
          return true;
        }
        if (next.metadata.projectId !== projectId) {
          throw new Error("현재 프로젝트의 HWPX 내보내기 상태가 아닙니다.");
        }
        setState(next);
        onProjectRevisionRef.current(next.revision);
        setSelectedPresetId((current) => {
          if (current.startsWith("BUILTIN:")) {
            return current;
          }
          if (next.presets.some((preset) => preset.id === current)) {
            return current;
          }
          setConfig(initialBuiltIn.config);
          setPresetName("나의 HWPX 설정");
          return `BUILTIN:${initialBuiltIn.id}`;
        });
        setError(null);
        return true;
      } catch (loadError) {
        if (
          !closeBarrierRef.current &&
          generation === loadGenerationRef.current
        ) {
          setError(errorMessage(loadError));
        }
        return false;
      }
    })();
    loadTasksRef.current.add(task);
    void task.finally(() => loadTasksRef.current.delete(task));
    return task;
  }, [api, initialBuiltIn, projectId, sessionId]);

  useEffect(() => {
    closeBarrierRef.current = false;
    loadGenerationRef.current += 1;
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  useEffect(() => {
    if (scopes.some((scope) => scope.id === scopeNodeId)) {
      return;
    }
    setScopeNodeId(
      scopes.find((scope) => scope.kind === "WORK")?.id ?? scopes[0]?.id ?? ""
    );
  }, [scopeNodeId, scopes]);

  useEffect(
    () =>
      api.onHwpxExportProgress((next) => {
        if (next.operationId === activeOperationRef.current) {
          setProgress(next);
        }
      }),
    [api]
  );

  const tracked = useCallback(async <T,>(task: () => Promise<T>): Promise<T> => {
    if (auxiliaryRef.current) {
      throw new Error("다른 HWPX 설정 작업이 진행 중입니다.");
    }
    setAuxiliaryBusy(true);
    const promise = task();
    auxiliaryRef.current = promise;
    try {
      return await promise;
    } finally {
      if (auxiliaryRef.current === promise) {
        auxiliaryRef.current = null;
      }
      setAuxiliaryBusy(false);
    }
  }, []);

  const settle = useCallback(async (close: boolean): Promise<boolean> => {
    closeBarrierRef.current = true;
    try {
      const loadResults = await Promise.all([...loadTasksRef.current]);
      if (loadResults.some((result) => !result)) {
        closeBarrierRef.current = false;
        return false;
      }
      if (auxiliaryRef.current) {
        await auxiliaryRef.current;
      }
      const operationId = activeOperationRef.current;
      if (!operationId) {
        if (!close) {
          closeBarrierRef.current = false;
        }
        return true;
      }
      const previous = phaseRef.current;
      const crossedMainBoundary = mainOperationRef.current === operationId;
      if (previous === "PREPARING" && !crossedMainBoundary) {
        if (close && savedPreparationRef.current === operationId) {
          return true;
        }
        await completionRef.current;
        if (!close) {
          closeBarrierRef.current = false;
        }
        return true;
      }
      setPhase("CANCELLING");
      const accepted = await api.cancelHwpxExport({ sessionId, operationId });
      if (!accepted) {
        await completionRef.current;
        return activeOperationRef.current === null;
      }
      if (close && mainOperationRef.current === operationId) {
        return true;
      }
      await completionRef.current;
      if (!close) {
        closeBarrierRef.current = false;
      }
      return true;
    } catch (settleError) {
      closeBarrierRef.current = false;
      setError(errorMessage(settleError));
      return false;
    }
  }, [api, sessionId]);

  useImperativeHandle(
    ref,
    () => ({
      prepareToClose: () => settle(true),
      prepareToLeave: () => settle(false),
      reload: async () => {
        await load();
      }
    }),
    [load, settle]
  );

  const beginOperation = (): string => {
    const operationId = crypto.randomUUID();
    activeOperationRef.current = operationId;
    mainOperationRef.current = null;
    savedPreparationRef.current = null;
    completionRef.current = new Promise<void>((resolve) => {
      completionResolveRef.current = resolve;
    });
    setPhase("PREPARING");
    setProgress(null);
    setError(null);
    return operationId;
  };

  const finishOperation = () => {
    activeOperationRef.current = null;
    mainOperationRef.current = null;
    savedPreparationRef.current = null;
    completionResolveRef.current?.();
    completionResolveRef.current = null;
    setPhase("IDLE");
    setProgress(null);
  };

  const operationRequest = async (operationId: string) => {
    const savedRevision = await onBeforeExport();
    if (savedRevision === null) {
      throw new Error("현재 원고를 저장하지 못해 내보내기를 중단했습니다.");
    }
    if (
      closeBarrierRef.current ||
      activeOperationRef.current !== operationId
    ) {
      return null;
    }
    savedPreparationRef.current = operationId;
    const canonical = await api.getHwpxExportState({ sessionId });
    if (
      closeBarrierRef.current ||
      activeOperationRef.current !== operationId
    ) {
      return null;
    }
    if (canonical.metadata.projectId !== projectId) {
      throw new Error("현재 프로젝트의 HWPX 내보내기 상태가 아닙니다.");
    }
    setState(canonical);
    onProjectRevision(canonical.revision);
    if (!selectedScope) {
      throw new Error("내보낼 범위를 선택하세요.");
    }
    return {
      sessionId,
      operationId,
      scopeNodeId: selectedScope.id,
      scopeKind: selectedScope.kind,
      expectedProjectRevision: canonical.revision,
      presetId: effectivePreset.id,
      presetContentHash: effectivePreset.hash,
      metadata: canonical.metadata,
      config: validateHwpxExportPresetConfig(config),
      titlePage: {
        subtitle: titlePage.subtitle.trim() || null,
        genre: titlePage.genre.trim() || null,
        contact: titlePage.contact.trim() || null
      }
    } as const;
  };

  const validate = async () => {
    const operationId = beginOperation();
    try {
      const request = await operationRequest(operationId);
      if (request === null) {
        return;
      }
      setPhase("VALIDATING");
      mainOperationRef.current = operationId;
      const result = await api.validateHwpxExport(request);
      if (activeOperationRef.current !== operationId) {
        return;
      }
      setValidationResult(result);
      setValidationKey(JSON.stringify({ ...JSON.parse(currentKey), revision: result.revision }));
      setExportResult(null);
      setResultKey(null);
    } catch (validationError) {
      setError(errorMessage(validationError));
    } finally {
      finishOperation();
    }
  };

  const chooseOutput = async () => {
    try {
      await tracked(async () => {
        const selection = await api.chooseHwpxOutput({
          sessionId,
          suggestedFileName: suggestedName(
            state?.metadata.publicationTitle ?? "작품"
          ),
        });
        setOutput(selection);
      });
    } catch (outputError) {
      setError(errorMessage(outputError));
    }
  };

  const runExport = async () => {
    if (!output) {
      setError("먼저 출력 파일을 선택하세요.");
      return;
    }
    if (validationResult?.report.validation.status !== "VALID" || validationKey !== currentKey) {
      setError("현재 설정으로 사전 검사를 다시 통과해야 합니다.");
      return;
    }
    const operationId = beginOperation();
    try {
      const request = await operationRequest(operationId);
      if (request === null) {
        return;
      }
      setPhase("EXPORTING");
      mainOperationRef.current = operationId;
      setOutput(null);
      const result = await api.runHwpxExport({
        ...request,
        outputSelectionId: output.selectionId,
      });
      if (activeOperationRef.current !== operationId) {
        return;
      }
      if (result.status === "CANCELLED") {
        return;
      }
      if (result.status === "FAILED") {
        if (result.code === "RECOVERY_REQUIRED") {
          setError(
            result.recoveryFileName
              ? `출력 충돌을 자동 복구하지 못했습니다. 보존 파일 '${result.recoveryFileName}'을 확인해 주세요.`
              : "출력 충돌을 자동 복구하지 못했습니다. 보존된 복구 작업을 다시 시작한 뒤 확인해 주세요."
          );
          return;
        }
        setError(
          "선택 이후 출력 파일이 변경되어 저장하지 않았습니다."
        );
        return;
      }
      setExportResult(result);
      setResultKey(JSON.stringify({ ...JSON.parse(currentKey), revision: result.revision }));
      setValidationResult({
        operationId: result.operationId,
        sourcePublicationHash: result.report.sourcePublicationHash,
        report: result.report,
        revision: result.revision
      });
      setValidationKey(JSON.stringify({ ...JSON.parse(currentKey), revision: result.revision }));
      onProjectRevision(result.revision);
    } catch (exportError) {
      setError(errorMessage(exportError));
    } finally {
      finishOperation();
    }
  };

  const selectPreset = (value: string) => {
    setSelectedPresetId(value);
    const nextBuiltIn = BUILT_IN_HWPX_PRESETS.find(
      (preset) => `BUILTIN:${preset.id}` === value
    );
    const nextCustom = state?.presets.find((preset) => preset.id === value);
    if (nextBuiltIn) {
      setConfig(nextBuiltIn.config);
      setPresetName(`${nextBuiltIn.name} 사본`);
    } else if (nextCustom) {
      setConfig(nextCustom.config);
      setPresetName(nextCustom.name);
    }
  };

  const createPreset = async () => {
    try {
      await tracked(async () => {
      const result = await api.createHwpxExportPreset({
        sessionId,
        name: presetName,
        config
      });
      onProjectRevision(result.revision);
      await load();
      setSelectedPresetId(result.preset.id);
      setPresetName(result.preset.name);
      setConfig(result.preset.config);
      });
    } catch (presetError) {
      setError(errorMessage(presetError));
    }
  };

  const updatePreset = async () => {
    if (!customPreset) {
      return;
    }
    try {
      await tracked(async () => {
      const result = await api.updateHwpxExportPreset({
        sessionId,
        presetId: customPreset.id,
        name: presetName,
        config,
        expectedPresetRevision: customPreset.revision
      });
      onProjectRevision(result.revision);
      await load();
      });
    } catch (presetError) {
      setError(errorMessage(presetError));
    }
  };

  const duplicatePreset = async () => {
    if (!customPreset) {
      await createPreset();
      return;
    }
    try {
      await tracked(async () => {
      const result = await api.duplicateHwpxExportPreset({
        sessionId,
        sourcePresetId: customPreset.id,
        name: `${customPreset.name} 사본`
      });
      onProjectRevision(result.revision);
      await load();
      setSelectedPresetId(result.preset.id);
      setPresetName(result.preset.name);
      setConfig(result.preset.config);
      });
    } catch (presetError) {
      setError(errorMessage(presetError));
    }
  };

  const deletePreset = async () => {
    if (!customPreset) {
      return;
    }
    try {
      await tracked(async () => {
      const result = await api.deleteHwpxExportPreset({
        sessionId,
        presetId: customPreset.id,
        expectedPresetRevision: customPreset.revision
      });
      onProjectRevision(result.revision);
      setSelectedPresetId(`BUILTIN:${initialBuiltIn.id}`);
      setConfig(initialBuiltIn.config);
      setPresetName("나의 HWPX 설정");
      await load();
      });
    } catch (presetError) {
      setError(errorMessage(presetError));
    }
  };

  if (!state) {
    return error ? (
      <section className="hwpx-export" aria-busy="false">
        <p role="alert">{error}</p>
        <button type="button" onClick={() => void load()}>
          다시 시도
        </button>
      </section>
    ) : (
      <p role="status" aria-busy="true">
        HWPX 내보내기 상태 불러오는 중…
      </p>
    );
  }

  const visibleValidation = validationKey === currentKey ? validationResult : null;
  const visibleExport = resultKey === currentKey ? exportResult : null;
  const validationMessages = visibleValidation?.report.validation.messages ?? [];
  const updateHeadingStyle = (
    key:
      | "workTitleStyle"
      | "volumeTitleStyle"
      | "chapterTitleStyle"
      | "sceneTitleStyle",
    patch: Partial<HwpxHeadingStyleConfig>
  ) => {
    setConfig({ ...config, [key]: { ...config[key], ...patch } });
  };

  return (
    <section
      className="hwpx-export"
      aria-label="한글 문서 내보내기"
      aria-busy={busy}
      data-hwpx-phase={phase}
      data-hwpx-validation={visibleValidation?.report.validation.status ?? "NONE"}
      data-hwpx-output-type="HWPX"
    >
      <header>
        <h2>한글 문서</h2>
        <p>
          HWPX 파일을 만들고 madi 내부 검증기로 검사합니다.
        </p>
      </header>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy || interactionBlocked}>
        <legend>내보내기 범위</legend>
        <label>
          범위
          <select value={scopeNodeId} onChange={(event) => setScopeNodeId(event.target.value)}>
            {scopes.map((scope) => (
              <option key={scope.id} value={scope.id}>
                {scope.kind} · {scope.title}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset disabled={busy || interactionBlocked}>
        <legend>제출 preset</legend>
        <label>
          preset
          <select value={selectedPresetId} onChange={(event) => selectPreset(event.target.value)}>
            <optgroup label="기본 예시">
              {BUILT_IN_HWPX_PRESETS.map((preset) => (
                <option key={preset.id} value={`BUILTIN:${preset.id}`}>
                  {preset.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="사용자 preset">
              {state.presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        {builtIn && <p>{builtIn.description}</p>}
        <label>
          저장 이름
          <input
            value={presetName}
            maxLength={500}
            onChange={(event) => setPresetName(event.target.value)}
          />
        </label>
        <div className="hwpx-export__actions">
          <button type="button" onClick={() => void createPreset()}>
            새 preset 저장
          </button>
          <button type="button" disabled={!customPreset} onClick={() => void updatePreset()}>
            변경 저장
          </button>
          <button type="button" onClick={() => void duplicatePreset()}>
            복제
          </button>
          <button type="button" disabled={!customPreset} onClick={() => void deletePreset()}>
            삭제
          </button>
          <button type="button" onClick={() => selectPreset(`BUILTIN:${initialBuiltIn.id}`)}>
            기본값으로 재설정
          </button>
        </div>
      </fieldset>

      <fieldset disabled={busy || interactionBlocked}>
        <legend>페이지와 본문</legend>
        <label>
          페이지 크기
          <select
            value={config.pageSizeToken}
            onChange={(event) =>
              setConfig({
                ...config,
                pageSizeToken: event.target.value as HwpxExportPresetConfig["pageSizeToken"],
                customPageWidth: event.target.value === "CUSTOM" ? 210 : null,
                customPageHeight: event.target.value === "CUSTOM" ? 297 : null
              })
            }
          >
            <option value="A4">A4</option>
            <option value="LETTER">Letter</option>
            <option value="CUSTOM">사용자 지정</option>
          </select>
        </label>
        <label>
          방향
          <select
            value={config.orientation}
            onChange={(event) =>
              setConfig({
                ...config,
                orientation: event.target.value as HwpxExportPresetConfig["orientation"]
              })
            }
          >
            <option value="PORTRAIT">세로</option>
            <option value="LANDSCAPE">가로</option>
          </select>
        </label>
        {config.pageSizeToken === "CUSTOM" && (
          <div className="hwpx-export__grid">
            <label>
              사용자 지정 너비(mm)
              <input
                type="number"
                min={50}
                max={500}
                value={config.customPageWidth ?? 210}
                onChange={(event) =>
                  setConfig({ ...config, customPageWidth: Number(event.target.value) })
                }
              />
            </label>
            <label>
              사용자 지정 높이(mm)
              <input
                type="number"
                min={50}
                max={500}
                value={config.customPageHeight ?? 297}
                onChange={(event) =>
                  setConfig({ ...config, customPageHeight: Number(event.target.value) })
                }
              />
            </label>
          </div>
        )}
        <div className="hwpx-export__grid">
          {([
            ["위 여백(mm)", "marginTop"],
            ["아래 여백(mm)", "marginBottom"],
            ["왼쪽 여백(mm)", "marginLeft"],
            ["오른쪽 여백(mm)", "marginRight"],
            ["머리말 여백(mm)", "headerMargin"],
            ["꼬리말 여백(mm)", "footerMargin"]
          ] as const).map(([label, key]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                min={0}
                max={100}
                value={config[key]}
                onChange={(event) => setConfig({ ...config, [key]: Number(event.target.value) })}
              />
            </label>
          ))}
          <label>
            제본 여백(mm)
            <input
              type="number"
              min={0}
              max={100}
              value={config.gutter}
              onChange={(event) => setConfig({ ...config, gutter: Number(event.target.value) })}
            />
          </label>
        </div>
        <label>
          본문 글꼴
          <input
            list="hwpx-font-family-suggestions"
            value={config.fontFamilyToken}
            maxLength={128}
            onChange={(event) => setConfig({ ...config, fontFamilyToken: event.target.value })}
          />
          <datalist id="hwpx-font-family-suggestions">
            <option value="함초롬바탕" />
            <option value="함초롬돋움" />
            <option value="바탕" />
            <option value="맑은 고딕" />
          </datalist>
        </label>
        <label>
          본문 크기(pt)
          <input
            type="number"
            min={6}
            max={72}
            step={0.5}
            value={config.fontSizePt}
            onChange={(event) => setConfig({ ...config, fontSizePt: Number(event.target.value) })}
          />
        </label>
        <label>
          줄간격
          <select
            value={config.lineSpacingMode}
            onChange={(event) =>
              setConfig({
                ...config,
                lineSpacingMode: event.target.value as HwpxExportPresetConfig["lineSpacingMode"],
                lineSpacingValue: event.target.value === "PERCENT" ? 180 : 18
              })
            }
          >
            <option value="PERCENT">글자 대비 비율(%)</option>
            <option value="FIXED_PT">고정(pt)</option>
          </select>
          <input
            type="number"
            min={config.lineSpacingMode === "PERCENT" ? 50 : 6}
            max={config.lineSpacingMode === "PERCENT" ? 400 : 200}
            value={config.lineSpacingValue}
            onChange={(event) => setConfig({ ...config, lineSpacingValue: Number(event.target.value) })}
          />
        </label>
        <label>
          첫 줄 들여쓰기(pt)
          <input
            type="number"
            min={-100}
            max={100}
            value={config.firstLineIndent}
            onChange={(event) => setConfig({ ...config, firstLineIndent: Number(event.target.value) })}
          />
        </label>
        <label>
          문단 앞 간격(pt)
          <input
            type="number"
            min={0}
            max={100}
            value={config.paragraphSpacingBefore}
            onChange={(event) =>
              setConfig({ ...config, paragraphSpacingBefore: Number(event.target.value) })
            }
          />
        </label>
        <label>
          문단 뒤 간격(pt)
          <input
            type="number"
            min={0}
            max={100}
            value={config.paragraphSpacingAfter}
            onChange={(event) =>
              setConfig({ ...config, paragraphSpacingAfter: Number(event.target.value) })
            }
          />
        </label>
        <label>
          본문 정렬
          <select
            value={config.textAlign}
            onChange={(event) =>
              setConfig({
                ...config,
                textAlign: event.target.value as HwpxExportPresetConfig["textAlign"]
              })
            }
          >
            <option value="LEFT">왼쪽</option>
            <option value="CENTER">가운데</option>
            <option value="RIGHT">오른쪽</option>
            <option value="JUSTIFY">양쪽</option>
          </select>
        </label>
      </fieldset>

      <fieldset disabled={busy || interactionBlocked}>
        <legend>제목 스타일</legend>
        {(
          [
            ["작품", "workTitleStyle"],
            ["권", "volumeTitleStyle"],
            ["화", "chapterTitleStyle"],
            ["장면", "sceneTitleStyle"]
          ] as const
        ).map(([label, key]) => (
          <section key={key} className="hwpx-export__heading-style" aria-label={`${label} 제목`}>
            <h3>{label} 제목</h3>
            <label>
              글꼴
              <input
                list="hwpx-font-family-suggestions"
                maxLength={128}
                value={config[key].fontFamilyToken}
                onChange={(event) =>
                  updateHeadingStyle(key, { fontFamilyToken: event.target.value })
                }
              />
            </label>
            <label>
              크기(pt)
              <input
                type="number"
                min={6}
                max={72}
                step={0.5}
                value={config[key].fontSizePt}
                onChange={(event) =>
                  updateHeadingStyle(key, { fontSizePt: Number(event.target.value) })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={config[key].bold}
                onChange={(event) => updateHeadingStyle(key, { bold: event.target.checked })}
              />
              굵게
            </label>
            <label>
              정렬
              <select
                value={config[key].alignment}
                onChange={(event) =>
                  updateHeadingStyle(key, {
                    alignment: event.target.value as HwpxHeadingStyleConfig["alignment"]
                  })
                }
              >
                <option value="LEFT">왼쪽</option>
                <option value="CENTER">가운데</option>
                <option value="RIGHT">오른쪽</option>
                <option value="JUSTIFY">양쪽</option>
              </select>
            </label>
            <label>
              앞 간격(pt)
              <input
                type="number"
                min={0}
                max={100}
                value={config[key].spacingBefore}
                onChange={(event) =>
                  updateHeadingStyle(key, { spacingBefore: Number(event.target.value) })
                }
              />
            </label>
            <label>
              뒤 간격(pt)
              <input
                type="number"
                min={0}
                max={100}
                value={config[key].spacingAfter}
                onChange={(event) =>
                  updateHeadingStyle(key, { spacingAfter: Number(event.target.value) })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={config[key].pageBreakBefore}
                onChange={(event) =>
                  updateHeadingStyle(key, { pageBreakBefore: event.target.checked })
                }
              />
              앞에서 페이지 나누기
            </label>
          </section>
        ))}
      </fieldset>

      <fieldset disabled={busy || interactionBlocked}>
        <legend>문서 요소</legend>
        <label>
          <input
            type="checkbox"
            checked={config.includeTitlePage}
            onChange={(event) => {
              const includeTitlePage = event.target.checked;
              setConfig({ ...config, includeTitlePage });
              if (!includeTitlePage) {
                setTitlePage({ subtitle: "", genre: "", contact: "" });
              }
            }}
          />
          표제지 포함
        </label>
        {(
          [
            ["작품 제목 포함", "includeWorkTitle"],
            ["권 제목 포함", "includeVolumeTitles"],
            ["화 제목 포함", "includeChapterTitles"]
          ] as const
        ).map(([label, key]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={config[key]}
              onChange={(event) => setConfig({ ...config, [key]: event.target.checked })}
            />
            {label}
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            checked={config.includeSceneTitles}
            onChange={(event) => setConfig({ ...config, includeSceneTitles: event.target.checked })}
          />
          장면 제목 포함
        </label>
        <label>
          section 분할
          <select
            value={config.sectionSplitMode}
            onChange={(event) =>
              setConfig({
                ...config,
                sectionSplitMode: event.target.value as HwpxExportPresetConfig["sectionSplitMode"]
              })
            }
          >
            <option value="SINGLE">문서 전체를 하나의 section으로</option>
            <option value="VOLUME">권마다 section 분리</option>
          </select>
        </label>
        <label>
          장면 구분
          <select
            value={config.sceneBreakToken}
            onChange={(event) =>
              setConfig({
                ...config,
                sceneBreakToken: event.target.value as HwpxExportPresetConfig["sceneBreakToken"]
              })
            }
          >
            <option value="ORNAMENT">장식 기호</option>
            <option value="RULE">구분선</option>
            <option value="SPACE">공백</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={config.includePageNumber}
            onChange={(event) => setConfig({ ...config, includePageNumber: event.target.checked })}
          />
          페이지 번호 포함
        </label>
        <label>
          페이지 번호 시작
          <input
            type="number"
            min={1}
            value={config.pageNumberStart}
            onChange={(event) => setConfig({ ...config, pageNumberStart: Number(event.target.value) })}
          />
        </label>
        <label>
          페이지 번호 위치
          <select
            value={config.pageNumberPosition}
            onChange={(event) =>
              setConfig({
                ...config,
                pageNumberPosition: event.target.value as HwpxExportPresetConfig["pageNumberPosition"]
              })
            }
          >
            <option value="BOTTOM_LEFT">하단 왼쪽</option>
            <option value="BOTTOM_CENTER">하단 중앙</option>
            <option value="BOTTOM_RIGHT">하단 오른쪽</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={config.includeHeader}
            onChange={(event) =>
              setConfig({
                ...config,
                includeHeader: event.target.checked,
                headerText: event.target.checked ? config.headerText : ""
              })
            }
          />
          머리말 포함
        </label>
        <label>
          머리말
          <input
            disabled={!config.includeHeader}
            value={config.headerText}
            onChange={(event) => setConfig({ ...config, headerText: event.target.value })}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={config.includeFooter}
            onChange={(event) =>
              setConfig({
                ...config,
                includeFooter: event.target.checked,
                footerText: event.target.checked ? config.footerText : ""
              })
            }
          />
          꼬리말 포함
        </label>
        <label>
          꼬리말
          <input
            disabled={!config.includeFooter}
            value={config.footerText}
            onChange={(event) => setConfig({ ...config, footerText: event.target.value })}
          />
        </label>
        {config.includeTitlePage && (
          <div className="hwpx-export__grid">
            <label>
              부제(일회성)
              <input
                value={titlePage.subtitle}
                onChange={(event) => setTitlePage({ ...titlePage, subtitle: event.target.value })}
              />
            </label>
            <label>
              장르(일회성)
              <input
                value={titlePage.genre}
                onChange={(event) => setTitlePage({ ...titlePage, genre: event.target.value })}
              />
            </label>
            <label>
              연락처(일회성, report 제외)
              <input
                value={titlePage.contact}
                onChange={(event) => setTitlePage({ ...titlePage, contact: event.target.value })}
              />
            </label>
          </div>
        )}
      </fieldset>

      <div className="hwpx-export__actions">
        <button type="button" disabled={busy || interactionBlocked} onClick={() => void validate()}>
          사전 검사
        </button>
        <button type="button" disabled={busy || interactionBlocked} onClick={() => void chooseOutput()}>
          출력 파일 선택
        </button>
        <button
          type="button"
          disabled={
            busy ||
            interactionBlocked ||
            !output ||
            visibleValidation?.report.validation.status !== "VALID"
          }
          onClick={() => void runExport()}
        >
          HWPX 내보내기
        </button>
        <button
          type="button"
          disabled={phase === "IDLE" || phase === "CANCELLING"}
          onClick={() => void settle(false)}
        >
          내보내기 취소
        </button>
      </div>
      {output && <p>선택한 파일: {output.fileName}</p>}

      {progress && (
        <div role="status" aria-live="polite">
          <label>
            {stageLabel(progress.stage)}
            <progress value={progress.completed} max={progress.total} />
          </label>
        </div>
      )}

      {visibleValidation && (
        <section aria-label="HWPX 검증 결과">
          <h3>사전 검사: {visibleValidation.report.validation.status}</h3>
          <p>
            fatal {visibleValidation.report.validation.fatalCount}, error{" "}
            {visibleValidation.report.validation.errorCount}, warning{" "}
            {visibleValidation.report.validation.warningCount}
          </p>
          <ul>
            {validationMessages.map((message, index) => (
              <ValidationMessage
                key={`${message.code}:${index}`}
                message={message}
                onOpenSource={onOpenSource}
              />
            ))}
          </ul>
        </section>
      )}

      {visibleExport && (
        <ExportSuccess
          api={api}
          sessionId={sessionId}
          result={visibleExport}
          report={visibleExport.report}
        />
      )}
    </section>
  );
});

function ValidationMessage({
  message,
  onOpenSource
}: {
  readonly message: HwpxValidationMessage;
  readonly onOpenSource: (sourceNodeId: string) => void | Promise<void>;
}) {
  return (
    <li>
      <strong>
        {message.severity} · {message.code}
      </strong>{" "}
      {message.description}
      {message.suggestion && <span> — {message.suggestion}</span>}
      {message.sourceNodeId && (
        <button type="button" onClick={() => void onOpenSource(message.sourceNodeId!)}>
          원문 위치 열기
        </button>
      )}
    </li>
  );
}

function ExportSuccess({
  api,
  sessionId,
  result,
  report
}: {
  readonly api: PublicationExportModeProps["api"];
  readonly sessionId: string;
  readonly result: Extract<RunHwpxExportResult, { status: "COMPLETED" }>;
  readonly report: HwpxExportReport;
}) {
  return (
    <section className="hwpx-export__success" role="status" aria-label="HWPX 내보내기 완료">
      <h3>내보내기 완료</h3>
      <p>
        {result.fileName} · {result.byteLength.toLocaleString()} bytes
      </p>
      <p>
        block {report.coverage.exportedBlockCount} exported, {report.coverage.fallbackBlockCount}{" "}
        fallback, {report.coverage.configuredOmissionBlockCount} preset omission,{" "}
        {report.coverage.rejectedBlockCount} rejected
      </p>
      <div className="hwpx-export__actions">
        <button
          type="button"
          onClick={() => void api.revealHwpxExport({ sessionId, operationId: result.operationId })}
        >
          파일 위치 열기
        </button>
        <button
          type="button"
          onClick={() =>
            void api.saveHwpxExportReport({
              sessionId,
              operationId: result.operationId,
              format: "JSON"
            })
          }
        >
          JSON report 저장
        </button>
        <button
          type="button"
          onClick={() =>
            void api.saveHwpxExportReport({
              sessionId,
              operationId: result.operationId,
              format: "MARKDOWN"
            })
          }
        >
          Markdown report 저장
        </button>
      </div>
    </section>
  );
}
