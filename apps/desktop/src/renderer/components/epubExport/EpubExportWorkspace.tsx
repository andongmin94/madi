import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from "react";
import { EPUB_RECOVERY_PRESERVED_ERROR } from "../../../shared/epubExport";
import type {
  CompletedRunEpubExportResult,
  EpubExportPresetConfig,
  EpubExportProgress,
  EpubExportReport,
  EpubOutputSelection,
  EpubValidationMessage,
  PublicationExportMetadata,
  PublicationExportState,
  ValidateEpubExportResult
} from "../../../shared/epubExport";
import {
  validateEpubExportPresetConfig,
  validatePublicationMetadataInput
} from "../../../shared/epubExportValidation";
import type {
  EpubExportModeHandle,
  EpubExportModeProps
} from "../EpubExportMode";

const DEFAULT_CONFIG: EpubExportPresetConfig = {
  formatVersion: 1,
  targetProfile: "EPUB_3_4_DRAFT_2026_08",
  splitMode: "CHAPTER",
  tocDepth: 3,
  includeChapterTitles: true,
  includeSceneTitles: true,
  sceneBreakStyleToken: "ORNAMENT",
  bodyStyleToken: "REFLOWABLE_PROSE",
  includeCover: false,
  stylesheetToken: "MADI_CLASSIC"
};

type OperationPhase =
  | "IDLE"
  | "PREPARING"
  | "VALIDATING"
  | "EXPORTING"
  | "CANCELLING";

interface PersistedMetadata {
  readonly metadata: PublicationExportMetadata;
  readonly revision: number;
}

function isRecoveryPreservedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(EPUB_RECOVERY_PRESERVED_ERROR)
  );
}

function reportInputKey(
  revision: number,
  scopeNodeId: string,
  metadata: ReturnType<typeof editableMetadata>,
  config: EpubExportPresetConfig,
  coverSha256: string | null
): string {
  return JSON.stringify({ revision, scopeNodeId, metadata, config, coverSha256 });
}

function editableMetadata(metadata: PublicationExportMetadata) {
  return {
    publicationTitle: metadata.publicationTitle,
    creatorName: metadata.creatorName,
    language: metadata.language,
    identifier: metadata.identifier,
    publisher: metadata.publisher,
    description: metadata.description,
    rights: metadata.rights,
    subjects: [...metadata.subjects]
  };
}

function suggestedEpubName(title: string): string {
  return `${title.trim() || "작품"}.epub`;
}

function stageLabel(stage: EpubExportProgress["stage"]): string {
  switch (stage) {
    case "PUBLICATION_COMPILE":
      return "Publication IR 생성";
    case "XHTML_GENERATION":
      return "XHTML 생성";
    case "PACKAGE_GENERATION":
      return "EPUB package 생성";
    case "INTERNAL_VALIDATION":
      return "madi 내부 검증";
    case "EPUBCHECK":
      return "EPUBCheck";
    case "FINALIZE":
      return "원자적 저장";
  }
}

function severityLabel(message: EpubValidationMessage): string {
  return `${message.severity} · ${message.code}`;
}

export const EpubExportWorkspace = forwardRef<
  EpubExportModeHandle,
  EpubExportModeProps
>(function EpubExportWorkspace(
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
  const [state, setState] = useState<PublicationExportState | null>(null);
  const [metadataDraft, setMetadataDraft] = useState<ReturnType<
    typeof editableMetadata
  > | null>(null);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [presetName, setPresetName] = useState("나의 EPUB 설정");
  const [scopeNodeId, setScopeNodeId] = useState(
    initialScopeNodeId ?? projectTree.nodes.find((node) => node.kind === "WORK")?.id ?? ""
  );
  const [output, setOutput] = useState<EpubOutputSelection | null>(null);
  const [phase, setPhase] = useState<OperationPhase>("IDLE");
  const [progress, setProgress] = useState<EpubExportProgress | null>(null);
  const [validationResult, setValidationResult] =
    useState<ValidateEpubExportResult | null>(null);
  const [exportResult, setExportResult] =
    useState<CompletedRunEpubExportResult | null>(null);
  const [validationResultInputKey, setValidationResultInputKey] = useState<string | null>(null);
  const [exportResultInputKey, setExportResultInputKey] = useState<string | null>(null);
  const [auxiliaryBusy, setAuxiliaryBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeOperationRef = useRef<string | null>(null);
  const cancelledOperationRef = useRef<string | null>(null);
  const operationCompletionRef = useRef<Promise<void>>(Promise.resolve());
  const operationCompletionResolveRef = useRef<{
    readonly operationId: string;
    readonly resolve: () => void;
  } | null>(null);
  const phaseRef = useRef<OperationPhase>(phase);
  const operationSessionKeyRef = useRef<string | null>(null);
  const mainOperationRef = useRef<string | null>(null);
  const auxiliaryTaskRef = useRef<Promise<boolean> | null>(null);
  const loadTasksRef = useRef(new Set<Promise<boolean>>());
  const closeLoadBarrierRef = useRef(false);
  const leaveLoadBarrierRef = useRef(false);
  const prepareToCloseTaskRef = useRef<Promise<boolean> | null>(null);
  const prepareToLeaveTaskRef = useRef<Promise<boolean> | null>(null);
  const metadataDirtyRef = useRef(false);
  const metadataDraftRef = useRef<typeof metadataDraft>(null);
  const metadataDraftGenerationRef = useRef(0);
  const persistMetadataRef = useRef<() => Promise<PersistedMetadata | null>>(
    async () => null
  );
  const loadGenerationRef = useRef(0);
  const stateRef = useRef(state);
  const sessionKeyRef = useRef(`${sessionId}\u0000${projectId}`);
  const onProjectRevisionRef = useRef(onProjectRevision);
  stateRef.current = state;
  onProjectRevisionRef.current = onProjectRevision;
  phaseRef.current = phase;
  sessionKeyRef.current = `${sessionId}\u0000${projectId}`;

  const operationIsCurrent = (operationId: string): boolean =>
    activeOperationRef.current === operationId &&
    operationSessionKeyRef.current === sessionKeyRef.current;

  const beginOperation = (operationId: string): void => {
    if (activeOperationRef.current) {
      throw new Error("An EPUB operation is already active");
    }
    let resolveCompletion!: () => void;
    operationCompletionRef.current = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    operationCompletionResolveRef.current = {
      operationId,
      resolve: resolveCompletion
    };
    activeOperationRef.current = operationId;
    operationSessionKeyRef.current = sessionKeyRef.current;
    setPhase("PREPARING");
  };

  const finishOperation = (operationId: string): void => {
    if (activeOperationRef.current === operationId) {
      activeOperationRef.current = null;
      operationSessionKeyRef.current = null;
      setPhase("IDLE");
    }
    if (mainOperationRef.current === operationId) {
      mainOperationRef.current = null;
    }
    if (cancelledOperationRef.current === operationId) {
      cancelledOperationRef.current = null;
    }
    const completion = operationCompletionResolveRef.current;
    if (completion?.operationId === operationId) {
      operationCompletionResolveRef.current = null;
      completion.resolve();
    }
  };

  const selectedPreset = useMemo(
    () => state?.presets.find((preset) => preset.id === selectedPresetId) ?? null,
    [selectedPresetId, state]
  );
  const currentReportInputKey = useMemo(
    () =>
      state && metadataDraft
        ? reportInputKey(
            Math.max(projectRevision, state.revision),
            scopeNodeId,
            metadataDraft,
            config,
            state.cover?.sha256 ?? null
          )
        : null,
    [config, metadataDraft, projectRevision, scopeNodeId, state]
  );
  const activeReport: EpubExportReport | null =
    exportResult && exportResultInputKey === currentReportInputKey
      ? exportResult.report
      : validationResult && validationResultInputKey === currentReportInputKey
        ? validationResult.report
        : null;
  const activeReportOperationId =
    exportResult && exportResultInputKey === currentReportInputKey
      ? exportResult.operationId
      : validationResult && validationResultInputKey === currentReportInputKey
        ? validationResult.operationId
        : null;
  const operationBusy = phase !== "IDLE";
  const visibleProgress =
    operationBusy ||
    exportResultInputKey === currentReportInputKey ||
    validationResultInputKey === currentReportInputKey
      ? progress
      : null;
  const busy = interactionBlocked || operationBusy || auxiliaryBusy;

  const load = useCallback((resetDraft = false): Promise<void> => {
    if (closeLoadBarrierRef.current || leaveLoadBarrierRef.current) {
      return Promise.resolve();
    }
    const generation = ++loadGenerationRef.current;
    const sessionKey = sessionKeyRef.current;
    setError(null);
    const task = (async (): Promise<boolean> => {
      try {
        const next = await api.getPublicationExportState({ sessionId });
        if (
          generation !== loadGenerationRef.current ||
          sessionKey !== sessionKeyRef.current ||
          next.metadata.projectId !== projectId
        ) {
          return true;
        }
        setState(next);
        if (resetDraft || !metadataDirtyRef.current || stateRef.current === null) {
          const nextDraft = editableMetadata(next.metadata);
          metadataDraftGenerationRef.current += 1;
          metadataDraftRef.current = nextDraft;
          metadataDirtyRef.current = false;
          setMetadataDraft(nextDraft);
        }
        onProjectRevisionRef.current(next.revision);
        setSelectedPresetId((current) => {
          const selected = current
            ? next.presets.find((preset) => preset.id === current) ?? null
            : null;
          if (selected) {
            if (resetDraft) {
              setConfig(selected.config);
              setPresetName(selected.name);
            }
            return selected.id;
          }
          if (current || resetDraft) {
            setConfig(DEFAULT_CONFIG);
            setPresetName("나의 EPUB 설정");
          }
          return null;
        });
        return true;
      } catch {
        if (
          generation !== loadGenerationRef.current ||
          sessionKey !== sessionKeyRef.current
        ) {
          return true;
        }
        setError("출판 metadata와 EPUB preset을 불러오지 못했습니다.");
        return false;
      }
    })();
    loadTasksRef.current.add(task);
    const untrack = () => {
      loadTasksRef.current.delete(task);
    };
    void task.then(untrack, untrack);
    return task.then(() => undefined);
  }, [api, projectId, sessionId]);

  const drainLoads = async (): Promise<boolean> => {
    while (loadTasksRef.current.size > 0) {
      const results = await Promise.all([...loadTasksRef.current]);
      if (results.some((result) => !result)) {
        return false;
      }
    }
    return true;
  };

  const runAuxiliary = async <T,>(task: () => Promise<T>): Promise<T | null> => {
    if (auxiliaryTaskRef.current || activeOperationRef.current) {
      return null;
    }
    const sessionKey = sessionKeyRef.current;
    setAuxiliaryBusy(true);
    const resultPromise = Promise.resolve().then(task);
    const trackedPromise = resultPromise.then(
      () => true,
      () => false
    );
    auxiliaryTaskRef.current = trackedPromise;
    try {
      const result = await resultPromise;
      return sessionKey === sessionKeyRef.current ? result : null;
    } catch (taskError) {
      if (sessionKey === sessionKeyRef.current) {
        throw taskError;
      }
      return null;
    } finally {
      if (auxiliaryTaskRef.current === trackedPromise) {
        auxiliaryTaskRef.current = null;
        setAuxiliaryBusy(false);
      }
    }
  };

  const cancelActive = useCallback(async (): Promise<boolean> => {
    const operationId = activeOperationRef.current;
    if (!operationId) {
      return true;
    }
    const previousPhase = phaseRef.current;
    const completion = operationCompletionRef.current;
    setPhase("CANCELLING");
    cancelledOperationRef.current = operationId;
    try {
      if (previousPhase === "PREPARING") {
        setProgress(null);
        await completion;
        cancelledOperationRef.current = null;
        return activeOperationRef.current !== operationId;
      }
      const accepted = await api.cancelEpubExport({ sessionId, operationId });
      if (!accepted) {
        cancelledOperationRef.current = null;
        if (activeOperationRef.current !== operationId) {
          return true;
        }
        setPhase(previousPhase);
        return false;
      }
      setProgress(null);
      await completion;
      cancelledOperationRef.current = null;
      return activeOperationRef.current !== operationId;
    } catch {
      cancelledOperationRef.current = null;
      if (activeOperationRef.current === operationId) {
        setPhase(previousPhase);
      }
      setError("진행 중인 EPUB 작업을 취소하지 못했습니다.");
      return false;
    }
  }, [api, sessionId]);

  const cancelActiveForClose = useCallback(async (): Promise<boolean> => {
    const operationId = activeOperationRef.current;
    if (!operationId) {
      return true;
    }
    const previousPhase = phaseRef.current;
    const completion = operationCompletionRef.current;
    setPhase("CANCELLING");
    cancelledOperationRef.current = operationId;
    try {
      if (mainOperationRef.current !== operationId) {
        // Local preparation has not crossed the IPC boundary yet. Drain it so
        // it cannot start a new main-process operation after close approval.
        setProgress(null);
        await completion;
        return activeOperationRef.current !== operationId;
      }
      const accepted = await api.cancelEpubExport({ sessionId, operationId });
      if (!accepted) {
        if (activeOperationRef.current !== operationId) {
          return true;
        }
        cancelledOperationRef.current = null;
        setPhase(previousPhase);
        return false;
      }
      setProgress(null);
      // Main now owns the accepted cancellation. App shutdown must be allowed
      // to reach will-quit, where the core and service drain are bounded.
      return true;
    } catch {
      cancelledOperationRef.current = null;
      if (activeOperationRef.current === operationId) {
        setPhase(previousPhase);
      }
      setError("진행 중인 EPUB 작업을 취소하지 못했습니다.");
      return false;
    }
  }, [api, sessionId]);

  const settleMetadataForLeave = async (): Promise<boolean> => {
    for (;;) {
      const auxiliaryTask = auxiliaryTaskRef.current;
      if (auxiliaryTask) {
        if (!(await auxiliaryTask)) {
          return false;
        }
        continue;
      }
      if (!metadataDirtyRef.current) {
        return (
          activeOperationRef.current === null &&
          auxiliaryTaskRef.current === null
        );
      }
      const persisted = await runAuxiliary(() => persistMetadataRef.current());
      if (persisted === null && auxiliaryTaskRef.current === null) {
        return false;
      }
    }
  };

  const prepareToLeave = useCallback((): Promise<boolean> => {
    const existing = prepareToLeaveTaskRef.current;
    if (existing) {
      return existing;
    }
    leaveLoadBarrierRef.current = true;
    const task = (async () => {
      if (!(await drainLoads())) {
        return false;
      }
      if (activeOperationRef.current) {
        if (!(await cancelActive())) {
          return false;
        }
      }
      return settleMetadataForLeave();
    })();
    prepareToLeaveTaskRef.current = task;
    const clearTask = () => {
      if (prepareToLeaveTaskRef.current === task) {
        prepareToLeaveTaskRef.current = null;
        leaveLoadBarrierRef.current = false;
      }
    };
    void task.then(clearTask, clearTask);
    return task;
  }, [cancelActive]);

  const prepareToClose = useCallback((): Promise<boolean> => {
    const existing = prepareToCloseTaskRef.current;
    if (existing) {
      return existing;
    }
    closeLoadBarrierRef.current = true;
    const task = (async () => {
      if (!(await drainLoads())) {
        return false;
      }
      const operationId = activeOperationRef.current;
      if (operationId) {
        if (!(await cancelActiveForClose())) {
          return false;
        }
        if (activeOperationRef.current === operationId) {
          // Metadata is persisted before an operation crosses into main. If
          // that invariant is broken, refuse close rather than lose a draft.
          return (
            !metadataDirtyRef.current && auxiliaryTaskRef.current === null
          );
        }
      }
      return settleMetadataForLeave();
    })();
    prepareToCloseTaskRef.current = task;
    const clearTask = (ready: boolean) => {
      if (prepareToCloseTaskRef.current === task) {
        prepareToCloseTaskRef.current = null;
        if (!ready) {
          closeLoadBarrierRef.current = false;
        }
      }
    };
    void task.then(clearTask, () => clearTask(false));
    return task;
  }, [cancelActiveForClose]);

  useImperativeHandle(
    ref,
    () => ({
      prepareToClose,
      prepareToLeave,
      reload: () => load(true)
    }),
    [load, prepareToClose, prepareToLeave]
  );

  useEffect(() => {
    void load(true);
  }, [load, reloadToken]);

  useEffect(() => {
    setScopeNodeId((current) => {
      if (projectTree.nodes.some((node) => node.id === current)) {
        return current;
      }
      const requested = initialScopeNodeId
        ? projectTree.nodes.find((node) => node.id === initialScopeNodeId)
        : null;
      return (
        requested?.id ??
        projectTree.nodes.find((node) => node.kind === "WORK")?.id ??
        projectTree.nodes[0]?.id ??
        ""
      );
    });
  }, [initialScopeNodeId, projectTree, reloadToken]);

  useEffect(() => {
    onOperationBusyChange(operationBusy || auxiliaryBusy);
    return () => onOperationBusyChange(false);
  }, [auxiliaryBusy, onOperationBusyChange, operationBusy]);

  useEffect(
    () =>
      api.onEpubExportProgress((next) => {
        if (next.operationId === activeOperationRef.current) {
          setProgress(next);
        }
      }),
    [api]
  );

  useEffect(
    () => () => {
      const operationId = activeOperationRef.current;
      if (operationId) {
        void api.cancelEpubExport({ sessionId, operationId });
      }
    },
    [api, sessionId]
  );

  const persistMetadata = async (): Promise<PersistedMetadata | null> => {
    const draft = metadataDraftRef.current;
    if (!draft) {
      return null;
    }
    const sessionKey = sessionKeyRef.current;
    const draftGeneration = metadataDraftGenerationRef.current;
    try {
      const valid = validatePublicationMetadataInput(draft);
      const result = await api.updatePublicationMetadata({
        sessionId,
        ...valid
      });
      if (sessionKey !== sessionKeyRef.current) {
        return null;
      }
      setState((current) =>
        current
          ? { ...current, metadata: result.metadata, revision: result.revision }
          : current
      );
      if (draftGeneration === metadataDraftGenerationRef.current) {
        const canonicalDraft = editableMetadata(result.metadata);
        metadataDraftRef.current = canonicalDraft;
        metadataDirtyRef.current = false;
        setMetadataDraft(canonicalDraft);
      }
      onProjectRevision(result.revision);
      return { metadata: result.metadata, revision: result.revision };
    } catch {
      if (sessionKey === sessionKeyRef.current) {
        setError("제목·작가·언어·식별자를 확인한 뒤 metadata를 저장하세요.");
      }
      return null;
    }
  };
  persistMetadataRef.current = persistMetadata;

  const updateMetadataDraft = (
    update: Partial<NonNullable<typeof metadataDraft>>
  ): void => {
    const current = metadataDraftRef.current;
    if (!current) {
      return;
    }
    const next = { ...current, ...update };
    metadataDraftGenerationRef.current += 1;
    metadataDraftRef.current = next;
    metadataDirtyRef.current = true;
    setMetadataDraft(next);
  };

  const saveMetadata = async (): Promise<void> => {
    try {
      await runAuxiliary(() => persistMetadata());
    } catch {
      setError("출판 metadata를 저장하지 못했습니다.");
    }
  };

  const prepareOperation = async (
    operationId: string
  ): Promise<PersistedMetadata | null> => {
    setError(null);
    const flushedRevision = await onBeforeExport();
    if (
      !operationIsCurrent(operationId) ||
      cancelledOperationRef.current === operationId
    ) {
      return null;
    }
    if (flushedRevision === null) {
      setError("원고 저장에 실패해 EPUB 작업을 시작하지 않았습니다.");
      return null;
    }
    let persistedMetadata: PersistedMetadata | null = null;
    do {
      persistedMetadata = await persistMetadata();
      if (
        !operationIsCurrent(operationId) ||
        cancelledOperationRef.current === operationId
      ) {
        return null;
      }
      if (persistedMetadata === null) {
        return null;
      }
    } while (metadataDirtyRef.current);
    try {
      validateEpubExportPresetConfig(config);
    } catch {
      setError("EPUB 설정이 유효하지 않습니다.");
      return null;
    }
    if (!scopeNodeId) {
      setError("내보낼 작품 범위를 선택하세요.");
      return null;
    }
    if (config.includeCover && !stateRef.current?.cover) {
      setError("표지 포함 설정을 사용하려면 PNG 또는 JPEG 표지를 선택하세요.");
      return null;
    }
    return persistedMetadata;
  };

  const validate = async (): Promise<void> => {
    if (activeOperationRef.current) {
      return;
    }
    const operationId = crypto.randomUUID();
    beginOperation(operationId);
    setProgress(null);
    setValidationResult(null);
    setExportResult(null);
    try {
      const prepared = await prepareOperation(operationId);
      if (
        !prepared ||
        !operationIsCurrent(operationId) ||
        cancelledOperationRef.current === operationId
      ) {
        return;
      }
      setPhase("VALIDATING");
      mainOperationRef.current = operationId;
      const result = await api.validateEpubExport({
        sessionId,
        operationId,
        scopeNodeId,
        expectedProjectRevision: prepared.revision,
        metadata: prepared.metadata,
        config
      });
      if (
        operationIsCurrent(operationId) &&
        cancelledOperationRef.current !== operationId
      ) {
        const inputKey = reportInputKey(
          result.revision,
          scopeNodeId,
          editableMetadata(prepared.metadata),
          config,
          stateRef.current?.cover?.sha256 ?? null
        );
        setValidationResult(result);
        setValidationResultInputKey(inputKey);
        onProjectRevision(result.revision);
      }
    } catch {
      if (
        operationIsCurrent(operationId) &&
        cancelledOperationRef.current !== operationId
      ) {
        setError("EPUB 사전 검사를 완료하지 못했습니다.");
      }
    } finally {
      finishOperation(operationId);
    }
  };

  const chooseOutput = async (): Promise<void> => {
    if (!metadataDraft) {
      return;
    }
    try {
      const selection = await runAuxiliary(() =>
        api.chooseEpubOutput({
          sessionId,
          suggestedFileName: suggestedEpubName(metadataDraft.publicationTitle)
        })
      );
      if (selection) {
        setOutput(selection);
      }
    } catch {
      setError("EPUB 저장 위치를 선택하지 못했습니다.");
    }
  };

  const runExport = async (): Promise<void> => {
    if (!output) {
      setError("EPUB 저장 위치를 먼저 선택하세요.");
      return;
    }
    if (activeOperationRef.current) {
      return;
    }
    const operationId = crypto.randomUUID();
    beginOperation(operationId);
    setProgress(null);
    setValidationResult(null);
    setExportResult(null);
    try {
      const prepared = await prepareOperation(operationId);
      if (
        !prepared ||
        !operationIsCurrent(operationId) ||
        cancelledOperationRef.current === operationId
      ) {
        return;
      }
      setPhase("EXPORTING");
      setOutput(null);
      mainOperationRef.current = operationId;
      const result = await api.runEpubExport({
        sessionId,
        operationId,
        scopeNodeId,
        expectedProjectRevision: prepared.revision,
        metadata: prepared.metadata,
        config,
        outputSelectionId: output.selectionId
      });
      if (result.status === "CANCELLED") {
        return;
      }
      if (result.status === "FAILED") {
        if (
          operationIsCurrent(operationId) &&
          cancelledOperationRef.current !== operationId
        ) {
          setError(
            "EPUB 생성 또는 검증에 실패했습니다. 기존 파일은 변경하지 않았습니다."
          );
        }
        return;
      }
      if (
        operationIsCurrent(operationId) &&
        cancelledOperationRef.current !== operationId
      ) {
        const inputKey = reportInputKey(
          result.revision,
          scopeNodeId,
          editableMetadata(prepared.metadata),
          config,
          stateRef.current?.cover?.sha256 ?? null
        );
        setExportResult(result);
        setExportResultInputKey(inputKey);
        onProjectRevision(result.revision);
      }
    } catch (error) {
      if (
        operationIsCurrent(operationId) &&
        cancelledOperationRef.current !== operationId
      ) {
        setError(
          isRecoveryPreservedError(error)
            ? `동시 파일 변경으로 확인했던 원본은 .madi-epub-operation-${operationId} 복구 디렉터리에 보존했습니다.`
            : "EPUB 생성 또는 검증에 실패했습니다. 기존 파일은 변경하지 않았습니다."
        );
      }
    } finally {
      finishOperation(operationId);
    }
  };

  const createPreset = async (): Promise<void> => {
    try {
      const sessionKey = sessionKeyRef.current;
      await runAuxiliary(async () => {
        const result = await api.createEpubExportPreset({
          sessionId,
          name: presetName,
          config
        });
        if (sessionKey !== sessionKeyRef.current) {
          return;
        }
        onProjectRevision(result.revision);
        await load(false);
        if (sessionKey === sessionKeyRef.current) {
          setSelectedPresetId(result.preset.id);
          setConfig(result.preset.config);
          setPresetName(result.preset.name);
        }
      });
    } catch {
      setError("EPUB preset을 저장하지 못했습니다.");
    }
  };

  const updatePreset = async (): Promise<void> => {
    if (!selectedPreset) {
      return;
    }
    try {
      const sessionKey = sessionKeyRef.current;
      await runAuxiliary(async () => {
        const result = await api.updateEpubExportPreset({
          sessionId,
          presetId: selectedPreset.id,
          expectedPresetRevision: selectedPreset.revision,
          name: presetName,
          config
        });
        if (sessionKey !== sessionKeyRef.current) {
          return;
        }
        onProjectRevision(result.revision);
        await load(false);
      });
    } catch {
      setError("EPUB preset 변경을 저장하지 못했습니다.");
    }
  };

  const duplicatePreset = async (): Promise<void> => {
    if (!selectedPreset) {
      return;
    }
    try {
      const sessionKey = sessionKeyRef.current;
      await runAuxiliary(async () => {
        const result = await api.duplicateEpubExportPreset({
          sessionId,
          sourcePresetId: selectedPreset.id,
          name: `${selectedPreset.name} 복사본`
        });
        if (sessionKey !== sessionKeyRef.current) {
          return;
        }
        onProjectRevision(result.revision);
        await load(false);
        if (sessionKey === sessionKeyRef.current) {
          setSelectedPresetId(result.preset.id);
          setConfig(result.preset.config);
          setPresetName(result.preset.name);
        }
      });
    } catch {
      setError("EPUB preset을 복제하지 못했습니다.");
    }
  };

  const deletePreset = async (): Promise<void> => {
    if (!selectedPreset) {
      return;
    }
    try {
      const sessionKey = sessionKeyRef.current;
      await runAuxiliary(async () => {
        const result = await api.deleteEpubExportPreset({
          sessionId,
          presetId: selectedPreset.id,
          expectedPresetRevision: selectedPreset.revision
        });
        if (sessionKey !== sessionKeyRef.current) {
          return;
        }
        onProjectRevision(result.revision);
        setSelectedPresetId(null);
        setConfig(DEFAULT_CONFIG);
        await load(false);
      });
    } catch {
      setError("EPUB preset을 삭제하지 못했습니다.");
    }
  };

  if (!state || !metadataDraft) {
    return (
      <section
        className="epub-export epub-export--loading"
        aria-busy={error === null}
      >
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button type="button" onClick={() => void load(true)}>
              다시 불러오기
            </button>
          </>
        ) : (
          "EPUB 출판 정보를 불러오는 중…"
        )}
      </section>
    );
  }

  const messages = activeReport?.validation.messages ?? [];

  const chooseCover = async (): Promise<void> => {
    try {
      const sessionKey = sessionKeyRef.current;
      await runAuxiliary(async () => {
        const result = await api.choosePublicationCover({ sessionId });
        if (!result || sessionKey !== sessionKeyRef.current) {
          return;
        }
        onProjectRevision(result.revision);
        await load(false);
      });
    } catch {
      setError("표지를 저장하지 못했습니다.");
    }
  };

  const removeCover = async (): Promise<void> => {
    try {
      const sessionKey = sessionKeyRef.current;
      await runAuxiliary(async () => {
        const result = await api.removePublicationCover({ sessionId });
        if (sessionKey !== sessionKeyRef.current) {
          return;
        }
        onProjectRevision(result.revision);
        await load(false);
      });
    } catch {
      setError("표지를 제거하지 못했습니다.");
    }
  };

  const saveReport = async (format: "JSON" | "MARKDOWN"): Promise<void> => {
    if (!activeReportOperationId) {
      return;
    }
    try {
      await runAuxiliary(() =>
        api.saveEpubExportReport({
          sessionId,
          operationId: activeReportOperationId,
          format
        })
      );
    } catch (error) {
      setError(
        isRecoveryPreservedError(error)
          ? `동시 파일 변경으로 확인했던 원본 report는 .madi-epub-report-${activeReportOperationId}-${format === "JSON" ? "json" : "md"} 복구 디렉터리에 보존했습니다.`
          : `${format === "JSON" ? "JSON" : "Markdown"} report를 저장하지 못했습니다.`
      );
    }
  };

  const revealExport = async (): Promise<void> => {
    if (!exportResult || exportResultInputKey !== currentReportInputKey) {
      return;
    }
    try {
      await runAuxiliary(() =>
        api.revealEpubExport({ sessionId, operationId: exportResult.operationId })
      );
    } catch {
      setError("생성 파일 위치를 열지 못했습니다.");
    }
  };

  return (
    <section
      className="epub-export"
      aria-busy={operationBusy || auxiliaryBusy}
      data-epub-profile={config.targetProfile}
      data-epub-phase={phase}
      data-epub-validation-status={activeReport?.validation.status ?? "NOT_RUN"}
      data-epub-block-loss={
        activeReport
          ? activeReport.coverage.sourceBlockCount -
            activeReport.coverage.exportedBlockCount -
            activeReport.coverage.fallbackBlockCount
          : undefined
      }
    >
      <header className="epub-export__header">
        <div>
          <p className="eyebrow">PHASE 1G · PUBLICATION IR ONLY</p>
          <h2>EPUB 내보내기</h2>
          <p>원고 저장본을 Publication IR로 컴파일한 뒤 별도 Rust process에서 생성합니다.</p>
        </div>
        <span className="engine-pill">revision {Math.max(projectRevision, state.revision)}</span>
      </header>

      {error && <p className="epub-export__error" role="alert">{error}</p>}

      <div className="epub-export__grid">
        <fieldset disabled={busy} className="epub-export__panel">
          <legend>출판 metadata</legend>
          <label>제목<input value={metadataDraft.publicationTitle} onChange={(event) => updateMetadataDraft({ publicationTitle: event.currentTarget.value })} /></label>
          <label>작가<input value={metadataDraft.creatorName} required onChange={(event) => updateMetadataDraft({ creatorName: event.currentTarget.value })} /></label>
          <label>언어<input value={metadataDraft.language} onChange={(event) => updateMetadataDraft({ language: event.currentTarget.value })} /></label>
          <label>식별자<input value={metadataDraft.identifier} onChange={(event) => updateMetadataDraft({ identifier: event.currentTarget.value })} /></label>
          <label>출판사<input value={metadataDraft.publisher ?? ""} onChange={(event) => updateMetadataDraft({ publisher: event.currentTarget.value || null })} /></label>
          <label>설명<textarea value={metadataDraft.description ?? ""} onChange={(event) => updateMetadataDraft({ description: event.currentTarget.value || null })} /></label>
          <label>권리<textarea value={metadataDraft.rights ?? ""} onChange={(event) => updateMetadataDraft({ rights: event.currentTarget.value || null })} /></label>
          <label>주제 (쉼표 구분)<input value={metadataDraft.subjects.join(", ")} onChange={(event) => updateMetadataDraft({ subjects: event.currentTarget.value.split(",").map((value) => value.trim()).filter(Boolean) })} /></label>
          <button type="button" onClick={() => void saveMetadata()}>metadata 저장</button>
          <div className="epub-export__cover">
            <span>표지: {state.cover ? `${state.cover.mediaType} · ${state.cover.width}×${state.cover.height}` : "없음"}</span>
            <button type="button" onClick={() => void chooseCover()}>PNG/JPEG 선택</button>
            <button type="button" disabled={!state.cover} onClick={() => void removeCover()}>표지 제거</button>
          </div>
        </fieldset>

        <fieldset disabled={busy} className="epub-export__panel">
          <legend>EPUB 설정</legend>
          <label>대상 범위<select value={scopeNodeId} onChange={(event) => setScopeNodeId(event.currentTarget.value)}>{projectTree.nodes.map((node) => <option key={node.id} value={node.id}>{node.kind} · {node.title}</option>)}</select></label>
          <label>profile<select value={config.targetProfile} onChange={(event) => setConfig({ ...config, targetProfile: event.currentTarget.value as EpubExportPresetConfig["targetProfile"] })}><option value="EPUB_3_4_DRAFT_2026_08">EPUB 3.4 Draft</option><option value="EPUB_3_3_COMPATIBILITY">EPUB 3.3 호환</option></select></label>
          {config.targetProfile === "EPUB_3_4_DRAFT_2026_08" ? <p className="epub-export__notice">현재 W3C Candidate Recommendation Draft를 기준으로 생성합니다. 출판사와 유통처가 요구하는 버전을 먼저 확인하세요.</p> : <p className="epub-export__notice">현재 안정 규격과 EPUBCheck 5.3.0 production validator를 기준으로 생성합니다.</p>}
          <label>분할<select value={config.splitMode} onChange={(event) => setConfig({ ...config, splitMode: event.currentTarget.value as EpubExportPresetConfig["splitMode"] })}><option value="CHAPTER">CHAPTER</option><option value="SCENE">SCENE</option></select></label>
          <label>목차 깊이<input type="number" min={1} max={4} value={config.tocDepth} onChange={(event) => setConfig({ ...config, tocDepth: Number(event.currentTarget.value) as 1 | 2 | 3 | 4 })} /></label>
          <label><input type="checkbox" checked={config.includeChapterTitles} onChange={(event) => setConfig({ ...config, includeChapterTitles: event.currentTarget.checked })} /> chapter 제목</label>
          <label><input type="checkbox" checked={config.includeSceneTitles} onChange={(event) => setConfig({ ...config, includeSceneTitles: event.currentTarget.checked })} /> scene 제목</label>
          <label><input type="checkbox" checked={config.includeCover} onChange={(event) => setConfig({ ...config, includeCover: event.currentTarget.checked })} /> 표지 포함</label>
          <label>scene break<select value={config.sceneBreakStyleToken} onChange={(event) => setConfig({ ...config, sceneBreakStyleToken: event.currentTarget.value as EpubExportPresetConfig["sceneBreakStyleToken"] })}><option value="ORNAMENT">ORNAMENT</option><option value="RULE">RULE</option><option value="SPACE">SPACE</option></select></label>
          <label>본문 스타일<select value={config.bodyStyleToken} onChange={(event) => setConfig({ ...config, bodyStyleToken: event.currentTarget.value as EpubExportPresetConfig["bodyStyleToken"] })}><option value="REFLOWABLE_PROSE">REFLOWABLE</option><option value="INDENTED_PROSE">INDENTED</option><option value="SPACED_PROSE">SPACED</option></select></label>
          <label>stylesheet<select value={config.stylesheetToken} onChange={(event) => setConfig({ ...config, stylesheetToken: event.currentTarget.value as EpubExportPresetConfig["stylesheetToken"] })}><option value="MADI_CLASSIC">MADI CLASSIC</option><option value="MADI_MODERN">MADI MODERN</option><option value="MADI_MINIMAL">MADI MINIMAL</option></select></label>

          <label>preset<select value={selectedPresetId ?? ""} onChange={(event) => { const id = event.currentTarget.value || null; setSelectedPresetId(id); const preset = state.presets.find((item) => item.id === id); if (preset) { setConfig(preset.config); setPresetName(preset.name); } else { setConfig(DEFAULT_CONFIG); } }}><option value="">기본 설정</option>{state.presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
          <label>preset 이름<input value={presetName} onChange={(event) => setPresetName(event.currentTarget.value)} /></label>
          <div className="epub-export__button-row"><button type="button" onClick={() => void createPreset()}>새 preset 저장</button><button type="button" disabled={!selectedPreset} onClick={() => void updatePreset()}>변경 저장</button><button type="button" disabled={!selectedPreset} onClick={() => void duplicatePreset()}>복제</button><button type="button" disabled={!selectedPreset} onClick={() => void deletePreset()}>삭제</button></div>
        </fieldset>
      </div>

      <section className="epub-export__actions" aria-label="EPUB 실행">
        <div className="epub-export__button-row">
          <button type="button" disabled={busy} onClick={() => void validate()}>사전 검사</button>
          <button type="button" disabled={busy} onClick={() => void chooseOutput()}>저장 위치 선택</button>
          <span>{output?.fileName ?? "저장 위치 미선택"}</span>
          <button type="button" disabled={busy || !output} onClick={() => void runExport()}>EPUB 내보내기</button>
          <button type="button" disabled={!operationBusy || phase === "CANCELLING"} onClick={() => void cancelActive()}>취소</button>
        </div>
        {visibleProgress && <div className="epub-export__progress" role="status" aria-live="polite"><span>{stageLabel(visibleProgress.stage)}</span><progress aria-label={`${stageLabel(visibleProgress.stage)} 진행률`} value={visibleProgress.completed} max={visibleProgress.total} /><span>{visibleProgress.completed}/{visibleProgress.total}</span></div>}
      </section>

      {activeReport && (
        <section className="epub-export__validation" aria-label="EPUB validation report">
          <header><h3>검증 결과 · {activeReport.validation.status}</h3><span>F {activeReport.validation.fatalCount} · E {activeReport.validation.errorCount} · W {activeReport.validation.warningCount} · I {activeReport.validation.infoCount}</span></header>
          <dl className="epub-export__summary"><div><dt>block coverage</dt><dd>{activeReport.coverage.exportedBlockCount + activeReport.coverage.fallbackBlockCount}/{activeReport.coverage.sourceBlockCount}</dd></div><div><dt>character coverage</dt><dd>{activeReport.coverage.exportedCharacterCount}/{activeReport.coverage.sourceCharacterCount}</dd></div><div><dt>EPUBCheck</dt><dd>{activeReport.validation.epubCheck.status}{activeReport.validation.epubCheck.compatibilityOnly ? " · 보조 호환성 검사" : ""}</dd></div><div><dt>total</dt><dd>{activeReport.timing.totalMs.toFixed(1)} ms</dd></div></dl>
          {messages.length === 0 ? <p>검증 메시지가 없습니다.</p> : <ol className="epub-export__messages">{messages.map((message, index) => <li key={`${message.code}:${message.epubPath ?? ""}:${index}`}><button type="button" disabled={!message.sourceNodeId} onClick={() => message.sourceNodeId && void onOpenSource(message.sourceNodeId)}><strong>{severityLabel(message)}</strong><span>{message.description}</span>{message.suggestion && <small>{message.suggestion}</small>}{message.epubPath && <code>{message.epubPath}</code>}</button></li>)}</ol>}
          <div className="epub-export__button-row"><button type="button" disabled={busy} onClick={() => void saveReport("JSON")}>JSON report 저장</button><button type="button" disabled={busy} onClick={() => void saveReport("MARKDOWN")}>Markdown report 저장</button>{exportResult && exportResultInputKey === currentReportInputKey && <button type="button" disabled={busy} onClick={() => void revealExport()}>파일 위치 열기</button>}</div>
        </section>
      )}

      {exportResult && exportResultInputKey === currentReportInputKey && <p className="epub-export__success" role="status">{exportResult.fileName} · {exportResult.byteLength.toLocaleString()} bytes · SHA-256 {exportResult.sha256}</p>}
    </section>
  );
});
