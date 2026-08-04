import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
import type {
  CompilePublicationResult,
  PublicationDocument,
  PublicationSourceReference,
  ReaderLabUiState,
  ReaderPaneOverrides,
  ReaderPresetRecord,
  ReaderRenderConfig,
  ReaderSettings
} from "../../../shared/publication";
import { validatePublicationDocument } from "../../../shared/publicationValidation";
import { validateReaderRenderConfig } from "../../../shared/readerConfigValidation";
import { BUILTIN_READER_PRESETS, DEFAULT_READER_PRESET } from "./builtinTemplates";
import { ReaderDiagnostics } from "./ReaderDiagnostics";
import { ReaderPreviewPane } from "./ReaderPreviewPane";
import { ReaderScopePresetPanel } from "./ReaderScopePresetPanel";
import { ReaderSettingsPanel } from "./ReaderSettingsPanel";
import { applyReaderOverrides } from "./readerConfig";
import {
  buildReaderDiagnostics,
  estimateReaderStatistics
} from "./readerStatistics";
import {
  defaultReaderLabUiState,
  normalizeReaderLabUiState,
  readerScopeOptions,
  storedPresetOptions,
  updateReaderPane
} from "./readerLabState";
import type {
  ReaderLabModeHandle,
  ReaderLabModeProps,
  ReaderMeasuredBlockLayout,
  ReaderPresetOption,
  ReaderRenderStatistics
} from "./types";

interface CompileContext {
  readonly sessionId: string;
  readonly projectId: string;
  readonly projectRevision: number;
}

interface CompileEffectSuppression {
  readonly sessionId: string;
  readonly projectRevision: number;
  readonly scopeNodeId: string;
}

function compileEffectContextsEqual(
  left: CompileEffectSuppression | null,
  right: CompileEffectSuppression
): boolean {
  return (
    left !== null &&
    left.sessionId === right.sessionId &&
    left.projectRevision === right.projectRevision &&
    left.scopeNodeId === right.scopeNodeId
  );
}

function publicError(_error: unknown, fallback: string): string {
  return fallback;
}

function replaceStoredPreset(
  presets: readonly ReaderPresetRecord[],
  preset: ReaderPresetRecord
): readonly ReaderPresetRecord[] {
  const index = presets.findIndex((item) => item.id === preset.id);
  if (index < 0) {
    return [...presets, preset].sort((left, right) =>
      left.name.localeCompare(right.name, "ko")
    );
  }
  return presets.map((item) => (item.id === preset.id ? preset : item));
}

function mergeOverrides(
  current: ReaderPaneOverrides,
  patch: ReaderPaneOverrides
): ReaderPaneOverrides {
  return {
    ...current,
    ...patch,
    ...(patch.readerSettings
      ? {
          readerSettings: {
            ...(current.readerSettings ?? {}),
            ...patch.readerSettings
          }
        }
      : {})
  };
}

function configsEqual(left: ReaderRenderConfig, right: ReaderRenderConfig): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function duplicatePresetNames(
  presets: readonly ReaderPresetRecord[]
): readonly string[] {
  const counts = new Map<string, number>();
  for (const preset of presets) {
    counts.set(preset.name, (counts.get(preset.name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right, "ko"));
}

function markDuplicatePresetOptions(
  presets: readonly ReaderPresetOption[]
): readonly ReaderPresetOption[] {
  const counts = new Map<string, number>();
  for (const preset of presets) {
    counts.set(preset.name, (counts.get(preset.name) ?? 0) + 1);
  }
  return presets.map((preset) => ({
    ...preset,
    duplicateName: (counts.get(preset.name) ?? 0) > 1
  }));
}

function asUserDefinedConfig(config: ReaderRenderConfig): ReaderRenderConfig {
  return validateReaderRenderConfig({
    ...config,
    platform: {
      ...config.platform,
      verificationStatus: "USER_DEFINED",
      verifiedAt: null
    }
  });
}

function exactSourceOrSceneFallback(
  source: PublicationSourceReference
): PublicationSourceReference {
  return source.rangeVerified
    ? source
    : { ...source, start: null, end: null };
}

export const ReaderLabWorkspace = forwardRef<
  ReaderLabModeHandle,
  ReaderLabModeProps
>(function ReaderLabWorkspace(
  {
    api,
    sessionId,
    projectId,
    projectRevision,
    reloadToken,
    projectTree,
    initialScopeNodeId,
    activeSceneId,
    interactionBlocked,
    onBeforeCompile,
    onProjectRevision,
    onOpenSource
  },
  ref
) {
  const initialScopes = readerScopeOptions(
    projectTree,
    initialScopeNodeId,
    activeSceneId,
    initialScopeNodeId
  );
  const [uiState, setUiState] = useState<ReaderLabUiState>(() =>
    defaultReaderLabUiState(initialScopes[0]?.nodeId ?? null)
  );
  const [uiStateReady, setUiStateReady] = useState(false);
  const [storedPresets, setStoredPresets] = useState<readonly ReaderPresetRecord[]>([]);
  const [duplicateNames, setDuplicateNames] = useState<readonly string[]>([]);
  const [publication, setPublication] = useState<CompilePublicationResult | null>(null);
  const [compileBusy, setCompileBusy] = useState(false);
  const [presetBusy, setPresetBusy] = useState(false);
  const [compileError, setCompileError] = useState("");
  const [stateError, setStateError] = useState("");
  const [uiStateSaveError, setUiStateSaveError] = useState("");
  const [saveBlocked, setSaveBlocked] = useState(false);
  const [viewingLastSaved, setViewingLastSaved] = useState(false);
  const [compileRoundTripMs, setCompileRoundTripMs] = useState<number | null>(null);
  const [compileValidationMs, setCompileValidationMs] = useState<number | null>(null);
  const [firstVisibleMs, setFirstVisibleMs] = useState<number | null>(null);
  const [activePaneIndex, setActivePaneIndex] = useState(0);
  const [presetName, setPresetName] = useState(DEFAULT_READER_PRESET.name);
  const [paneStatistics, setPaneStatistics] = useState<
    Readonly<Record<number, ReaderRenderStatistics>>
  >({});
  const [paneMeasuredBlocks, setPaneMeasuredBlocks] = useState<
    Readonly<Record<number, readonly ReaderMeasuredBlockLayout[]>>
  >({});
  const loadGenerationRef = useRef(0);
  const uiStatePersistGenerationRef = useRef(0);
  const loadedSessionRef = useRef<string | null>(null);
  const compileGenerationRef = useRef(0);
  const suppressedPresetEffectRef = useRef<CompileEffectSuppression | null>(
    null
  );
  const acceptedCompileEffectRef = useRef<CompileEffectSuppression | null>(
    null
  );
  const processedCompileEffectRef = useRef<CompileEffectSuppression | null>(
    null
  );
  const pendingCompileEffectRef = useRef<CompileEffectSuppression | null>(
    null
  );
  const firstVisibleContextRef = useRef<{
    readonly contentHash: string;
    readonly startedAt: number;
  } | null>(null);
  const uiStateRef = useRef(uiState);
  const contextRef = useRef<CompileContext>({
    sessionId,
    projectId,
    projectRevision
  });
  const beforeCompileRef = useRef(onBeforeCompile);
  const projectRevisionRef = useRef(onProjectRevision);
  const openSourceRef = useRef(onOpenSource);
  uiStateRef.current = uiState;
  contextRef.current = { sessionId, projectId, projectRevision };
  beforeCompileRef.current = onBeforeCompile;
  projectRevisionRef.current = onProjectRevision;
  openSourceRef.current = onOpenSource;

  const scopeOptions = useMemo(
    () =>
      readerScopeOptions(
        projectTree,
        initialScopeNodeId,
        activeSceneId,
        uiState.lastScopeNodeId
      ),
    [activeSceneId, initialScopeNodeId, projectTree, uiState.lastScopeNodeId]
  );
  const storedOptions = useMemo(
    () => storedPresetOptions(storedPresets, duplicateNames),
    [duplicateNames, storedPresets]
  );
  const presetOptions = useMemo<readonly ReaderPresetOption[]>(
    () => markDuplicatePresetOptions([...BUILTIN_READER_PRESETS, ...storedOptions]),
    [storedOptions]
  );
  const renderConfigKey = uiState.panes
    .map((pane) => `${pane.presetId ?? ""}:${JSON.stringify(pane.overrides)}`)
    .join("|");
  const resolvedConfigs = useMemo(
    () =>
      uiState.panes.map((pane) => {
        const preset =
          presetOptions.find((item) => item.id === pane.presetId) ??
          DEFAULT_READER_PRESET;
        return applyReaderOverrides(preset.config, pane.overrides);
      }),
    [presetOptions, renderConfigKey]
  );

  useEffect(() => {
    const generation = ++loadGenerationRef.current;
    if (loadedSessionRef.current !== sessionId) {
      loadedSessionRef.current = sessionId;
      setUiStateReady(false);
    }
    setStateError("");
    setUiStateSaveError("");
    void Promise.all([
      api.listReaderPresets({ sessionId }),
      api.loadReaderLabUiState({ sessionId })
    ])
      .then(([presetResult, stateResult]) => {
        if (generation !== loadGenerationRef.current) {
          return;
        }
        const validatedPresets = presetResult.presets.map((preset) => ({
          ...preset,
          config: validateReaderRenderConfig(preset.config)
        }));
        const options = markDuplicatePresetOptions([
          ...BUILTIN_READER_PRESETS,
          ...storedPresetOptions(validatedPresets, presetResult.duplicateNames)
        ]);
        const restoredScopes = readerScopeOptions(
          projectTree,
          initialScopeNodeId,
          activeSceneId,
          stateResult.state?.lastScopeNodeId ?? initialScopeNodeId
        );
        const restored = normalizeReaderLabUiState(
          stateResult.state,
          restoredScopes,
          options
        );
        setStoredPresets(validatedPresets);
        setDuplicateNames(presetResult.duplicateNames);
        setUiState(restored);
        const selected =
          options.find((preset) => preset.id === restored.panes[0]?.presetId) ??
          DEFAULT_READER_PRESET;
        setPresetName(selected.name);
        setUiStateReady(true);
        projectRevisionRef.current(presetResult.revision);
      })
      .catch((error: unknown) => {
        if (generation !== loadGenerationRef.current) {
          return;
        }
        const fallback = defaultReaderLabUiState(initialScopes[0]?.nodeId ?? null);
        setUiState(fallback);
        setStoredPresets([]);
        setDuplicateNames([]);
        setPresetName(DEFAULT_READER_PRESET.name);
        setStateError(publicError(error, "Reader Lab 상태를 불러오지 못했습니다."));
        setUiStateReady(true);
      });
    return () => {
      ++loadGenerationRef.current;
    };
  }, [api, reloadToken, sessionId]);

  useEffect(
    () => () => {
      ++compileGenerationRef.current;
    },
    [sessionId]
  );

  useEffect(() => {
    if (!uiStateReady) {
      return;
    }
    setUiState((current) =>
      normalizeReaderLabUiState(current, scopeOptions, presetOptions)
    );
  }, [presetOptions, projectTree, scopeOptions, uiStateReady]);

  const persistUiState = useCallback(async (): Promise<void> => {
    if (!uiStateReady) {
      return;
    }
    await api.saveReaderLabUiState({
      sessionId: contextRef.current.sessionId,
      state: uiStateRef.current
    });
  }, [api, uiStateReady]);

  useEffect(() => {
    const generation = ++uiStatePersistGenerationRef.current;
    if (!uiStateReady || compileBusy) {
      return;
    }
    const timer = window.setTimeout(() => {
      void persistUiState()
        .then(() => {
          if (generation === uiStatePersistGenerationRef.current) {
            setUiStateSaveError("");
          }
        })
        .catch((error: unknown) => {
          if (generation === uiStatePersistGenerationRef.current) {
            setUiStateSaveError(
              publicError(error, "Reader Lab 상태를 저장하지 못했습니다.")
            );
          }
        });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      if (generation === uiStatePersistGenerationRef.current) {
        uiStatePersistGenerationRef.current += 1;
      }
    };
  }, [compileBusy, persistUiState, uiState, uiStateReady]);

  const compileScope = useCallback(
    async (preflight: boolean): Promise<void> => {
      const scopeNodeId = uiStateRef.current.lastScopeNodeId;
      if (!scopeNodeId) {
        setPublication(null);
        setCompileError("미리볼 수 있는 원고 범위가 없습니다.");
        return;
      }
      const generation = ++compileGenerationRef.current;
      let expectedRevision = contextRef.current.projectRevision;
      if (preflight) {
        let flushedRevision: number | null = null;
        try {
          flushedRevision = await beforeCompileRef.current();
        } catch {
          flushedRevision = null;
        }
        if (generation !== compileGenerationRef.current) {
          return;
        }
        if (flushedRevision === null) {
          setSaveBlocked(true);
          setViewingLastSaved(false);
          setPublication(null);
          setCompileBusy(false);
          setCompileError("");
          return;
        }
        expectedRevision = flushedRevision;
      }
      const currentContext = contextRef.current;
      const expected: CompileContext = {
        sessionId: currentContext.sessionId,
        projectId: currentContext.projectId,
        projectRevision: expectedRevision
      };
      if (preflight) {
        setSaveBlocked(false);
        setViewingLastSaved(false);
      } else {
        setSaveBlocked(true);
        setViewingLastSaved(true);
      }
      setCompileBusy(true);
      setCompileError("");
      setPublication(null);
      setCompileRoundTripMs(null);
      setCompileValidationMs(null);
      setFirstVisibleMs(null);
      firstVisibleContextRef.current = null;
      const startedAt = performance.now();
      try {
        const result = await api.compilePublication({
          sessionId: expected.sessionId,
          scopeNodeId,
          expectedProjectRevision: expected.projectRevision
        });
        const responseAt = performance.now();
        const current = contextRef.current;
        if (
          generation !== compileGenerationRef.current ||
          current.sessionId !== expected.sessionId ||
          current.projectId !== expected.projectId ||
          current.projectRevision > expected.projectRevision ||
          uiStateRef.current.lastScopeNodeId !== scopeNodeId
        ) {
          return;
        }
        const validationStartedAt = performance.now();
        const document = validatePublicationDocument(result.document);
        const validationDuration = performance.now() - validationStartedAt;
        if (
          document.projectId !== expected.projectId ||
          document.projectRevision !== expected.projectRevision ||
          document.scopeNodeId !== scopeNodeId ||
          result.revision !== expected.projectRevision
        ) {
          throw new Error("오래된 Publication compile 응답을 적용하지 않았습니다.");
        }
        firstVisibleContextRef.current = {
          contentHash: result.contentHash,
          startedAt
        };
        setPublication({ ...result, document });
        acceptedCompileEffectRef.current = {
          sessionId: expected.sessionId,
          projectRevision: result.revision,
          scopeNodeId
        };
        setCompileRoundTripMs(responseAt - startedAt);
        setCompileValidationMs(validationDuration);
        setPaneStatistics({});
        setPaneMeasuredBlocks({});
        projectRevisionRef.current(result.revision);
      } catch (error) {
        if (generation === compileGenerationRef.current) {
          setCompileError(publicError(error, "Publication IR을 만들지 못했습니다."));
        }
      } finally {
        if (generation === compileGenerationRef.current) {
          setCompileBusy(false);
        }
      }
    },
    [api]
  );

  useEffect(() => {
    const scopeNodeId = uiState.lastScopeNodeId;
    if (!uiStateReady || !scopeNodeId) {
      return;
    }
    const effectContext: CompileEffectSuppression = {
      sessionId,
      projectRevision,
      scopeNodeId
    };
    const alreadyProcessed = compileEffectContextsEqual(
      processedCompileEffectRef.current,
      effectContext
    );
    if (interactionBlocked) {
      pendingCompileEffectRef.current = alreadyProcessed ? null : effectContext;
      return;
    }
    const wasPending = compileEffectContextsEqual(
      pendingCompileEffectRef.current,
      effectContext
    );
    pendingCompileEffectRef.current = null;
    if (alreadyProcessed && !wasPending) {
      return;
    }
    processedCompileEffectRef.current = effectContext;
    const suppressedPreset = suppressedPresetEffectRef.current;
    if (
      suppressedPreset?.sessionId === sessionId &&
      suppressedPreset.projectRevision === projectRevision &&
      suppressedPreset.scopeNodeId === scopeNodeId
    ) {
      suppressedPresetEffectRef.current = null;
      return;
    }
    suppressedPresetEffectRef.current = null;
    const acceptedCompile = acceptedCompileEffectRef.current;
    if (
      acceptedCompile?.sessionId === sessionId &&
      acceptedCompile.projectRevision === projectRevision &&
      acceptedCompile.scopeNodeId === scopeNodeId
    ) {
      acceptedCompileEffectRef.current = null;
      return;
    }
    acceptedCompileEffectRef.current = null;
    void compileScope(true);
  }, [
    compileScope,
    interactionBlocked,
    projectRevision,
    sessionId,
    uiState.lastScopeNodeId,
    uiStateReady
  ]);

  useImperativeHandle(
    ref,
    () => ({
      persistUiState,
      async refresh() {
        await compileScope(true);
      }
    }),
    [compileScope, persistUiState]
  );

  const activePane = uiState.panes[activePaneIndex] ?? uiState.panes[0]!;
  const activePreset =
    presetOptions.find((preset) => preset.id === activePane.presetId) ??
    DEFAULT_READER_PRESET;
  const activeConfig = resolvedConfigs[activePaneIndex] ?? DEFAULT_READER_PRESET.config;
  const activeStatistics =
    paneStatistics[activePaneIndex] ??
    (publication
      ? estimateReaderStatistics(publication.document, activeConfig)
      : null);
  const presetDirty =
    presetName !== activePreset.name ||
    !configsEqual(activeConfig, activePreset.config);

  useEffect(() => {
    setPresetName(activePreset.name);
  }, [activePaneIndex, activePreset.id]);

  const patchActivePane = (patch: Parameters<typeof updateReaderPane>[2]) =>
    setUiState((current) => updateReaderPane(current, activePaneIndex, patch));

  const patchActiveOverrides = (patch: ReaderPaneOverrides) => {
    patchActivePane({
      overrides: mergeOverrides(activePane.overrides, patch)
    });
  };

  const choosePreset = (presetId: string) => {
    const preset = presetOptions.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }
    patchActivePane({
      presetId: preset.id,
      deviceProfileId: preset.config.device.id,
      overrides: {}
    });
    setPresetName(preset.name);
  };

  const acceptPresetMutation = (
    preset: ReaderPresetRecord,
    revision: number
  ) => {
    const nextPresets = replaceStoredPreset(storedPresets, preset);
    setStoredPresets(nextPresets);
    setDuplicateNames(duplicatePresetNames(nextPresets));
    patchActivePane({
      presetId: preset.id,
      deviceProfileId: preset.config.device.id,
      overrides: {}
    });
    setPresetName(preset.name);
    const current = contextRef.current;
    const scopeNodeId = uiStateRef.current.lastScopeNodeId;
    suppressedPresetEffectRef.current = scopeNodeId
      ? {
          sessionId: current.sessionId,
          projectRevision: revision,
          scopeNodeId
        }
      : null;
    onProjectRevision(revision);
  };

  const savePreset = async () => {
    const name = presetName.trim();
    if (!name) {
      return;
    }
    setPresetBusy(true);
    setStateError("");
    try {
      const userConfig = asUserDefinedConfig(activeConfig);
      const result = activePreset.builtin
        ? await api.createReaderPreset({
            sessionId,
            name,
            sourceKind: "CUSTOM",
            sourceId: null,
            sourceVersion: null,
            verificationStatus: "USER_DEFINED",
            config: userConfig
          })
        : await api.updateReaderPreset({
            sessionId,
            presetId: activePreset.id,
            name,
            verificationStatus: "USER_DEFINED",
            config: userConfig,
            expectedPresetRevision: activePreset.revision
          });
      acceptPresetMutation(result.preset, result.revision);
    } catch (error) {
      setStateError(publicError(error, "Reader preset을 저장하지 못했습니다."));
    } finally {
      setPresetBusy(false);
    }
  };

  const duplicatePreset = async () => {
    setPresetBusy(true);
    setStateError("");
    try {
      const name = `${activePreset.name} 복제`;
      const userConfig = asUserDefinedConfig(activeConfig);
      const result = activePreset.builtin
        ? await api.createReaderPreset({
            sessionId,
            name,
            sourceKind: "DUPLICATED",
            sourceId: activePreset.sourceId,
            sourceVersion: activePreset.sourceVersion,
            verificationStatus: "USER_DEFINED",
            config: userConfig
          })
        : await api.duplicateReaderPreset({
            sessionId,
            sourcePresetId: activePreset.id,
            name
          });
      acceptPresetMutation(result.preset, result.revision);
    } catch (error) {
      setStateError(publicError(error, "Reader preset을 복제하지 못했습니다."));
    } finally {
      setPresetBusy(false);
    }
  };

  const deletePreset = async () => {
    if (activePreset.builtin || !window.confirm(`“${activePreset.name}” preset을 삭제할까요?`)) {
      return;
    }
    setPresetBusy(true);
    setStateError("");
    try {
      const result = await api.deleteReaderPreset({
        sessionId,
        presetId: activePreset.id,
        expectedPresetRevision: activePreset.revision
      });
      const nextPresets = storedPresets.filter(
        (preset) => preset.id !== result.deletedPresetId
      );
      setStoredPresets(nextPresets);
      setDuplicateNames(duplicatePresetNames(nextPresets));
      patchActivePane({
        presetId: DEFAULT_READER_PRESET.id,
        deviceProfileId: DEFAULT_READER_PRESET.config.device.id,
        overrides: {}
      });
      setPresetName(DEFAULT_READER_PRESET.name);
      const current = contextRef.current;
      const scopeNodeId = uiStateRef.current.lastScopeNodeId;
      suppressedPresetEffectRef.current = scopeNodeId
        ? {
            sessionId: current.sessionId,
            projectRevision: result.revision,
            scopeNodeId
          }
        : null;
      onProjectRevision(result.revision);
    } catch (error) {
      setStateError(publicError(error, "Reader preset을 삭제하지 못했습니다."));
    } finally {
      setPresetBusy(false);
    }
  };

  const onPaneProgress = useCallback((paneIndex: number, progress: number) => {
    const current = uiStateRef.current;
    let changed = false;
    const panes = current.panes.map((pane, index) => {
      if (!current.scrollSync && index !== paneIndex) {
        return pane;
      }
      if (Math.abs(pane.scrollProgress - progress) <= 0.001) {
        return pane;
      }
      changed = true;
      return { ...pane, scrollProgress: progress };
    });
    if (!changed) {
      return;
    }
    const next = { ...current, panes };
    uiStateRef.current = next;
    setUiState(next);
  }, []);

  const onPaneSelectionProgress = useCallback(
    (paneIndex: number, progress: number) => {
      const current = uiStateRef.current;
      const pane = current.panes[paneIndex];
      if (!pane || Math.abs(pane.scrollProgress - progress) <= 0.001) {
        return;
      }
      const next = {
        ...current,
        panes: current.panes.map((item, index) =>
          index === paneIndex ? { ...item, scrollProgress: progress } : item
        )
      };
      uiStateRef.current = next;
      setUiState(next);
    },
    []
  );

  const onPaneStatistics = useCallback(
    (paneIndex: number, statistics: ReaderRenderStatistics) => {
      setPaneStatistics((current) => {
        const previous = current[paneIndex];
        return previous && JSON.stringify(previous) === JSON.stringify(statistics)
          ? current
          : { ...current, [paneIndex]: statistics };
      });
    },
    []
  );

  const onPaneMeasuredBlocks = useCallback(
    (paneIndex: number, blocks: readonly ReaderMeasuredBlockLayout[]) => {
      setPaneMeasuredBlocks((current) => {
        const previous = current[paneIndex] ?? [];
        if (
          previous.length === blocks.length &&
          previous.every(
            (block, index) =>
              JSON.stringify(block) === JSON.stringify(blocks[index])
          )
        ) {
          return current;
        }
        return { ...current, [paneIndex]: blocks };
      });
    },
    []
  );

  const onPaneFirstVisible = useCallback(
    (_paneIndex: number, contentHash: string) => {
      const context = firstVisibleContextRef.current;
      if (!context || context.contentHash !== contentHash) {
        return;
      }
      setFirstVisibleMs((current) =>
        current ?? Math.max(0, performance.now() - context.startedAt)
      );
    },
    []
  );

  const selectSourceBlock = useCallback((blockId: string) => {
    const current = uiStateRef.current;
    if (current.selectedSourceBlockId === blockId) {
      return;
    }
    const next = {
      ...current,
      selectedSourceBlockId: blockId
    };
    uiStateRef.current = next;
    setUiState(next);
  }, []);

  const openSource = useCallback((source: PublicationSourceReference) => {
    void Promise.resolve(
      openSourceRef.current(exactSourceOrSceneFallback(source))
    ).catch(() => {
      setStateError("원고의 해당 위치를 열지 못했습니다.");
    });
  }, []);

  const layoutDiagnostics = useMemo(
    () => {
      if (!publication) {
        return [];
      }
      const measuredBlocks = paneMeasuredBlocks[activePaneIndex] ?? [];
      const diagnostics = [
        ...buildReaderDiagnostics(
          publication.document,
          activeConfig,
          8,
          measuredBlocks
        )
      ];
      for (const measurement of measuredBlocks) {
        if (!measurement.horizontalOverflow) {
          continue;
        }
        const blockId = measurement.blockId;
        const block = publication.document.sections
          .flatMap((section) => section.blocks)
          .find((candidate) => candidate.id === blockId);
        if (!block) {
          continue;
        }
        diagnostics.push({
          id: `overflow:${block.id}`,
          code: "HORIZONTAL_OVERFLOW",
          message: "전체 scope 실제 render에서 horizontal overflow가 측정됐습니다.",
          blockId: block.id,
          source: block.source
        });
      }
      return diagnostics;
    }, [activeConfig, activePaneIndex, paneMeasuredBlocks, publication]
  );
  const panelStyle = {
    "--reader-left-panel": `${uiState.leftPanelWidth}px`,
    "--reader-right-panel": `${uiState.rightPanelWidth}px`
  } as CSSProperties;
  const allBusy = interactionBlocked || compileBusy || presetBusy || !uiStateReady;
  const moveActivePane = (key: string) => {
    const count = uiState.paneCount;
    const next =
      key === "Home"
        ? 0
        : key === "End"
          ? count - 1
          : key === "ArrowRight"
            ? (activePaneIndex + 1) % count
            : key === "ArrowLeft"
              ? (activePaneIndex - 1 + count) % count
              : activePaneIndex;
    if (next === activePaneIndex) {
      return;
    }
    setActivePaneIndex(next);
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(`[data-reader-pane-tab="${next}"]`)
        ?.focus();
    });
  };

  return (
    <section
      className="reader-lab"
      aria-label="읽기 실험실"
      aria-busy={allBusy}
      data-reader-compile-status={
        compileBusy
          ? "busy"
          : compileError
            ? "error"
            : publication
              ? "ready"
              : "idle"
      }
      data-reader-core-compile-ms={publication?.compileTimingMs.toFixed(3)}
      data-reader-ipc-round-trip-ms={compileRoundTripMs?.toFixed(3)}
      data-reader-validation-ms={compileValidationMs?.toFixed(3)}
      data-reader-first-visible-ms={firstVisibleMs?.toFixed(3)}
      data-reader-project-revision={publication?.document.projectRevision}
      data-reader-scope-kind={publication?.document.scopeKind}
      data-reader-source-with-spaces={publication?.document.stats.withSpaces}
      data-reader-source-without-spaces={publication?.document.stats.withoutSpaces}
      data-reader-source-paragraph-count={publication?.document.stats.paragraphCount}
      data-reader-source-scene-count={publication?.document.stats.sceneCount}
      data-reader-source-chapter-count={publication?.document.stats.chapterCount}
      data-reader-diagnostic-count={
        (publication?.diagnostics.length ?? 0) + layoutDiagnostics.length
      }
      data-reader-diagnostic-measurement-status={
        activeStatistics?.measurementStatus ?? ""
      }
      data-reader-scroll-sync={String(uiState.scrollSync)}
      data-reader-left-panel-width={uiState.leftPanelWidth}
      data-reader-right-panel-width={uiState.rightPanelWidth}
      data-reader-diagnostics-expanded={String(uiState.diagnosticsExpanded)}
      style={panelStyle}
    >
      <ReaderScopePresetPanel
        scopes={scopeOptions}
        scopeNodeId={uiState.lastScopeNodeId}
        presets={presetOptions}
        selectedPresetId={activePane.presetId}
        presetName={presetName}
        presetDirty={presetDirty}
        busy={allBusy}
        leftPanelWidth={uiState.leftPanelWidth}
        onScope={(lastScopeNodeId) =>
          setUiState((current) => ({ ...current, lastScopeNodeId }))
        }
        onPreset={choosePreset}
        onPresetName={setPresetName}
        onSavePreset={() => void savePreset()}
        onDuplicatePreset={() => void duplicatePreset()}
        onDeletePreset={() => void deletePreset()}
        onResetPreset={() => {
          patchActivePane({ overrides: {} });
          setPresetName(activePreset.name);
        }}
        onLeftPanelWidth={(leftPanelWidth) =>
          setUiState((current) => ({ ...current, leftPanelWidth }))
        }
      />

      <main className="reader-preview-workspace">
        <header className="reader-preview-toolbar">
          <div role="group" aria-label="preview pane 수">
            {([1, 2, 3] as const).map((paneCount) => (
              <button
                type="button"
                key={paneCount}
                aria-pressed={uiState.paneCount === paneCount}
                disabled={allBusy}
                onClick={() => {
                  setUiState((current) => ({ ...current, paneCount }));
                  setActivePaneIndex((current) => Math.min(current, paneCount - 1));
                }}
              >
                {paneCount} pane
              </button>
            ))}
          </div>
          <label className="reader-check">
            <input
              type="checkbox"
              checked={uiState.scrollSync}
              disabled={allBusy || uiState.paneCount === 1}
              onChange={(event) => {
                const scrollSync = event.currentTarget.checked;
                setUiState((current) => ({
                  ...current,
                  scrollSync
                }));
              }}
            />
            scroll sync
          </label>
          <button type="button" disabled={allBusy} onClick={() => void compileScope(true)}>
            미리보기 새로고침
          </button>
          {publication && (
            <span className="reader-compile-metrics">
              compile {publication.compileTimingMs.toFixed(1)}ms · IPC {compileRoundTripMs?.toFixed(1) ?? "—"}ms · validate {compileValidationMs?.toFixed(1) ?? "—"}ms · first visible {firstVisibleMs?.toFixed(1) ?? "—"}ms
            </span>
          )}
        </header>

        <div className="reader-preview-status" data-testid="reader-preview-status">
          {saveBlocked && !viewingLastSaved && (
            <section className="reader-save-blocked" role="alert">
              <strong>현재 장면을 저장하지 못해 미리보기를 갱신할 수 없습니다.</strong>
              <div>
                <button type="button" onClick={() => void compileScope(true)}>다시 저장</button>
                <button type="button" onClick={() => void compileScope(false)}>마지막 저장본 보기</button>
              </div>
            </section>
          )}
          {saveBlocked && viewingLastSaved && (
            <p className="reader-stale-badge" role="status">
              마지막 저장본 보기 · 현재 편집 내용은 포함되지 않았습니다.
            </p>
          )}
          {(compileError || stateError || uiStateSaveError) && (
            <p className="reader-error" role="alert">
              {compileError || stateError || uiStateSaveError}
            </p>
          )}
          {compileBusy && (
            <section className="reader-loading" aria-live="polite">
              Publication IR을 만들고 첫 화면을 준비하는 중…
            </section>
          )}
        </div>
        {!compileBusy && publication && (
          <>
            <div
              className="reader-pane-tabs"
              role="tablist"
              aria-label="활성 preview pane"
              onKeyDown={(event) => {
                if (
                  event.key === "ArrowLeft" ||
                  event.key === "ArrowRight" ||
                  event.key === "Home" ||
                  event.key === "End"
                ) {
                  event.preventDefault();
                  moveActivePane(event.key);
                }
              }}
            >
              {uiState.panes.slice(0, uiState.paneCount).map((pane, index) => {
                const preset =
                  presetOptions.find((item) => item.id === pane.presetId) ??
                  DEFAULT_READER_PRESET;
                return (
                  <button
                    type="button"
                    role="tab"
                    key={index}
                    aria-selected={activePaneIndex === index}
                    tabIndex={activePaneIndex === index ? 0 : -1}
                    data-reader-pane-tab={index}
                    onClick={() => setActivePaneIndex(index)}
                  >
                    {index + 1}. {preset.name}
                  </button>
                );
              })}
            </div>
            <div
              className={`reader-panes reader-panes--${uiState.paneCount}`}
              data-testid="reader-preview-panes"
            >
              {uiState.panes.slice(0, uiState.paneCount).map((pane, index) => {
                const preset =
                  presetOptions.find((item) => item.id === pane.presetId) ??
                  DEFAULT_READER_PRESET;
                const config = resolvedConfigs[index] ?? preset.config;
                return (
                  <div
                    className="reader-pane-slot"
                    key={index}
                    data-reader-preset-id={pane.presetId ?? ""}
                    onMouseDown={() => setActivePaneIndex(index)}
                    onFocusCapture={() => setActivePaneIndex(index)}
                  >
                    <ReaderPreviewPane
                      paneIndex={index}
                      paneName={preset.name}
                      contentHash={publication.contentHash}
                      document={publication.document}
                      config={config}
                      zoom={pane.zoom}
                      selectedBlockId={uiState.selectedSourceBlockId}
                      scrollProgress={pane.scrollProgress}
                      scrollSync={uiState.scrollSync}
                      onScrollProgress={onPaneProgress}
                      onSelectionScrollProgress={onPaneSelectionProgress}
                      onSelectBlock={selectSourceBlock}
                      onOpenSource={openSource}
                      onStatistics={onPaneStatistics}
                      onMeasuredBlocks={onPaneMeasuredBlocks}
                      onFirstVisible={onPaneFirstVisible}
                    />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>

      <div className="reader-right-panel">
        <ReaderSettingsPanel
          document={publication?.document ?? null}
          config={activeConfig}
          statistics={activeStatistics}
          zoom={activePane.zoom}
          onOverrides={patchActiveOverrides}
          onZoom={(zoom) => patchActivePane({ zoom })}
        />
        <ReaderDiagnostics
          expanded={uiState.diagnosticsExpanded}
          document={publication?.document ?? null}
          coreDiagnostics={publication?.diagnostics ?? []}
          layoutDiagnostics={layoutDiagnostics}
          onExpanded={(diagnosticsExpanded) =>
            setUiState((current) => ({ ...current, diagnosticsExpanded }))
          }
          onOpenSource={openSource}
          onSelectBlock={selectSourceBlock}
        />
        <label className="reader-control reader-panel-width">
          <span>오른쪽 panel 폭</span>
          <input
            type="range"
            min={260}
            max={560}
            value={uiState.rightPanelWidth}
            onChange={(event) => {
              const rightPanelWidth = event.currentTarget.valueAsNumber;
              if (!Number.isFinite(rightPanelWidth)) {
                return;
              }
              setUiState((current) => ({
                ...current,
                rightPanelWidth
              }));
            }}
          />
        </label>
      </div>
    </section>
  );
});
