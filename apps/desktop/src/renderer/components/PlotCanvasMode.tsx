import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from "react";
import type {
  CanvasRecord,
  CanvasSort,
  CanvasSummary,
  DescendantScenePreview,
  EntityAliasRecord,
  EntityRecord,
  EntityRelationRecord,
  MadiDesktopApi,
  PlotCanvasUiState,
  PlotCanvasViewState,
  ProjectTree,
  TagRecord
} from "../../shared/contracts";
import {
  JsonCanvasAdapter,
  PlotCanvasWorkspace,
  type CanvasAutosaveState,
  type CanvasEntityReference,
  type CanvasPickerItem,
  type CanvasReferenceCatalog,
  type CanvasSaveRequest,
  type CanvasSceneReference,
  type MadiCanvasDocument,
  type MadiCanvasUiState,
  type PlotCanvasWorkspaceHandle
} from "./plotCanvas";
import "./plotCanvasMode.css";

const EMPTY_UI_STATE: PlotCanvasUiState = {
  lastCanvasId: null,
  canvasStates: {}
};

export interface PlotCanvasModeHandle {
  flush(): Promise<void>;
  addEntityReference(entityId: string): boolean;
}

export interface PlotCanvasModeProps {
  readonly api: MadiDesktopApi;
  readonly sessionId: string;
  readonly projectTree: ProjectTree;
  readonly entities: readonly EntityRecord[];
  readonly aliases: ReadonlyMap<string, readonly EntityAliasRecord[]>;
  readonly tags: ReadonlyMap<string, readonly TagRecord[]>;
  readonly relations: readonly EntityRelationRecord[];
  readonly interactionBlocked?: boolean;
  readonly pendingEntityId?: string | null;
  readonly onPendingEntityHandled?: (entityId: string, added: boolean) => void;
  readonly onProjectRevision: (revision: number) => void;
  readonly onOpenEntity: (entityId: string) => void;
  readonly onOpenScene: (sceneNodeId: string) => void;
}

interface ImportDraft {
  readonly fileName: string;
  readonly name: string;
  readonly document: MadiCanvasDocument;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly brokenReferenceCount: number;
}

interface PendingEntityTargetDraft {
  readonly entityId: string;
  readonly canvasId: string;
  readonly submitting: boolean;
  readonly submissionId: number | null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function canvasNameFromFile(fileName: string): string {
  const withoutExtension = fileName.replace(/\.canvas$/iu, "").trim();
  return withoutExtension || "가져온 캔버스";
}

function firstSentence(value: string): string | null {
  const compact = value.replace(/\s+/gu, " ").trim();
  if (!compact) {
    return null;
  }
  const end = compact.search(/[.!?。！？](?:\s|$)/u);
  return (end >= 0 ? compact.slice(0, end + 1) : compact.slice(0, 140)).slice(
    0,
    140
  );
}

function toCanvasDocument(record: CanvasRecord): MadiCanvasDocument {
  return JsonCanvasAdapter.validate(record.document);
}

function toCanvasSummary(record: CanvasRecord): CanvasSummary {
  return {
    id: record.id,
    projectId: record.projectId,
    name: record.name,
    description: record.description,
    documentFormat: record.documentFormat,
    documentVersion: record.documentVersion,
    contentHash: record.contentHash,
    revision: record.revision,
    nodeCount: record.nodeCount,
    edgeCount: record.edgeCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function toComponentUiState(
  state: PlotCanvasViewState | undefined
): MadiCanvasUiState | null {
  if (!state) {
    return null;
  }
  return {
    viewport: state.viewport,
    selectedElementId: state.selectedElementId,
    inspectorWidth: state.inspectorWidth,
    showGrid: state.showGrid,
    showMinimap: state.showMinimap,
    snapToGrid: state.snapToGrid
  };
}

export const PlotCanvasMode = forwardRef<
  PlotCanvasModeHandle,
  PlotCanvasModeProps
>(function PlotCanvasMode(
  {
    api,
    sessionId,
    projectTree,
    entities,
    aliases,
    tags,
    relations,
    interactionBlocked = false,
    pendingEntityId = null,
    onPendingEntityHandled,
    onProjectRevision,
    onOpenEntity,
    onOpenScene
  },
  forwardedRef
) {
  const [sort, setSort] = useState<CanvasSort>("UPDATED_DESC");
  const [canvases, setCanvases] = useState<readonly CanvasSummary[]>([]);
  const [active, setActive] = useState<CanvasRecord | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [uiState, setUiState] =
    useState<PlotCanvasUiState>(EMPTY_UI_STATE);
  const [scenes, setScenes] = useState<readonly CanvasSceneReference[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [autosave, setAutosave] = useState<CanvasAutosaveState | null>(null);
  const [importDraft, setImportDraft] = useState<ImportDraft | null>(null);
  const [pendingEntityTarget, setPendingEntityTarget] =
    useState<PendingEntityTargetDraft | null>(null);
  const workspaceRef = useRef<PlotCanvasWorkspaceHandle>(null);
  const workspaceCanvasIdRef = useRef<string | null>(null);
  const activeRef = useRef<CanvasRecord | null>(null);
  const uiStateRef = useRef(uiState);
  const uiSaveTimerRef = useRef<number | null>(null);
  const loadGenerationRef = useRef(0);
  const sceneLoadGenerationRef = useRef(0);
  const handledPendingEntityRef = useRef<string | null>(null);
  const pendingEntitySubmissionSequenceRef = useRef(0);
  const processedPendingEntitySubmissionRef = useRef<number | null>(null);
  const onProjectRevisionRef = useRef(onProjectRevision);
  activeRef.current = active;
  uiStateRef.current = uiState;
  onProjectRevisionRef.current = onProjectRevision;

  const entityCatalog = useMemo<readonly CanvasEntityReference[]>(() => {
    const relationCounts = new Map<string, number>();
    for (const relation of relations) {
      relationCounts.set(
        relation.sourceEntityId,
        (relationCounts.get(relation.sourceEntityId) ?? 0) + 1
      );
      relationCounts.set(
        relation.targetEntityId,
        (relationCounts.get(relation.targetEntityId) ?? 0) + 1
      );
    }
    return entities.map((entity) => ({
      id: entity.id,
      name: entity.name,
      kind: entity.kind,
      status: entity.status,
      summary: entity.summary,
      colorToken: entity.colorToken,
      aliases: (aliases.get(entity.id) ?? []).map((alias) => alias.alias),
      tags: (tags.get(entity.id) ?? []).map((tag) => tag.name),
      relationCount: relationCounts.get(entity.id) ?? 0
    }));
  }, [aliases, entities, relations, tags]);

  const catalog = useMemo<CanvasReferenceCatalog>(
    () => ({ entities: entityCatalog, scenes }),
    [entityCatalog, scenes]
  );

  const persistUiState = useCallback(async (): Promise<void> => {
    if (uiSaveTimerRef.current !== null) {
      window.clearTimeout(uiSaveTimerRef.current);
      uiSaveTimerRef.current = null;
    }
    await api.savePlotCanvasUiState({
      sessionId,
      state: uiStateRef.current
    });
  }, [api, sessionId]);

  const scheduleUiStateSave = useCallback(() => {
    if (uiSaveTimerRef.current !== null) {
      window.clearTimeout(uiSaveTimerRef.current);
    }
    uiSaveTimerRef.current = window.setTimeout(() => {
      void persistUiState().catch((reason: unknown) => {
        setError(errorMessage(reason, "캔버스 화면 상태를 저장하지 못했습니다."));
      });
    }, 500);
  }, [persistUiState]);

  const updateSummary = useCallback((record: CanvasRecord) => {
    setCanvases((current) =>
      current.map((summary) =>
        summary.id === record.id ? toCanvasSummary(record) : summary
      )
    );
  }, []);

  const loadCanvas = useCallback(
    async (canvasId: string): Promise<void> => {
      const generation = ++loadGenerationRef.current;
      setBusy(true);
      try {
        const record = await api.loadCanvas({ sessionId, canvasId });
        if (generation !== loadGenerationRef.current) {
          return;
        }
        JsonCanvasAdapter.validate(record.document);
        activeRef.current = record;
        setActive(record);
        setNameDraft(record.name);
        setDescriptionDraft(record.description ?? "");
        setUiState((current) => {
          const next = { ...current, lastCanvasId: record.id };
          uiStateRef.current = next;
          return next;
        });
        setError("");
      } catch (reason) {
        if (generation === loadGenerationRef.current) {
          setError(errorMessage(reason, "캔버스를 불러오지 못했습니다."));
        }
      } finally {
        if (generation === loadGenerationRef.current) {
          setBusy(false);
        }
      }
    },
    [api, sessionId]
  );

  const reloadListForSort = useCallback(
    async (
      requestedSort: CanvasSort,
      preferredCanvasId?: string | null
    ): Promise<void> => {
      const result = await api.listCanvases({
        sessionId,
        sort: requestedSort
      });
      setCanvases(result.canvases);
      onProjectRevisionRef.current(result.revision);
      const preferred =
        preferredCanvasId ?? uiStateRef.current.lastCanvasId ?? result.canvases[0]?.id;
      const target = result.canvases.find((canvas) => canvas.id === preferred);
      if (target) {
        await loadCanvas(target.id);
      } else {
        activeRef.current = null;
        setActive(null);
        setNameDraft("");
        setDescriptionDraft("");
        setBusy(false);
      }
    },
    [api, loadCanvas, sessionId]
  );

  const reloadList = useCallback(
    (preferredCanvasId?: string | null) =>
      reloadListForSort(sort, preferredCanvasId),
    [reloadListForSort, sort]
  );

  useEffect(() => {
    let cancelled = false;
    const sceneGeneration = ++sceneLoadGenerationRef.current;
    const workNodeId = projectTree.nodes.find((node) => node.kind === "WORK")?.id;
    if (!workNodeId) {
      setBusy(false);
      setError("작품 루트 노드를 찾지 못해 장면 목록을 불러올 수 없습니다.");
      return () => undefined;
    }
    setBusy(true);
    const loadAllScenes = async (): Promise<{
      readonly scenes: readonly DescendantScenePreview[];
      readonly revision: number;
    } | null> => {
      const accumulated: DescendantScenePreview[] = [];
      let offset = 0;
      let revision: number | null = null;
      while (true) {
        const result = await api.listDescendantScenes({
          sessionId,
          scopeNodeId: workNodeId,
          offset,
          limit: 1_000
        });
        if (
          cancelled ||
          sceneGeneration !== sceneLoadGenerationRef.current
        ) {
          return null;
        }
        if (revision !== null && result.revision !== revision) {
          throw new Error("장면 목록이 변경되어 다시 불러와야 합니다.");
        }
        if (result.offset !== offset) {
          throw new Error("장면 목록 페이지 응답이 요청과 다릅니다.");
        }
        revision = result.revision;
        accumulated.push(...result.scenes);
        if (!result.hasMore) {
          return { scenes: accumulated, revision };
        }
        if (result.nextOffset === null || result.nextOffset <= offset) {
          throw new Error("장면 목록 페이지 정보가 올바르지 않습니다.");
        }
        offset = result.nextOffset;
      }
    };
    void Promise.all([
      api.loadPlotCanvasUiState({ sessionId }),
      loadAllScenes()
    ])
      .then(async ([savedUi, sceneResult]) => {
        if (
          cancelled ||
          !sceneResult ||
          sceneGeneration !== sceneLoadGenerationRef.current
        ) {
          return;
        }
        const restored = savedUi.state ?? EMPTY_UI_STATE;
        uiStateRef.current = restored;
        setUiState(restored);
        const byId = new Map(projectTree.nodes.map((node) => [node.id, node]));
        setScenes(
          sceneResult.scenes.map((scene) => {
            const sceneNode = byId.get(scene.sceneId);
            const parent = sceneNode?.parentId ? byId.get(sceneNode.parentId) : undefined;
            return {
              id: scene.sceneId,
              episodeTitle: parent?.title ?? "장면",
              sceneTitle: sceneNode?.title ?? "삭제된 장면",
              recoveryFirstSentence: firstSentence(scene.plainTextRecovery),
              characterCount: Array.from(scene.plainTextRecovery).length,
              hasSceneBreak: /(?:^|\n)\s*(?:\*{3,}|#{1,3}\s)/u.test(
                scene.plainTextRecovery
              )
            };
          })
        );
        onProjectRevisionRef.current(sceneResult.revision);
        await reloadListForSort("UPDATED_DESC", restored.lastCanvasId);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setBusy(false);
          setError(errorMessage(reason, "캔버스 작업 공간을 준비하지 못했습니다."));
        }
      });
    return () => {
      cancelled = true;
      if (uiSaveTimerRef.current !== null) {
        window.clearTimeout(uiSaveTimerRef.current);
      }
    };
  }, [api, projectTree, reloadListForSort, sessionId]);

  const flush = useCallback(async (): Promise<void> => {
    await workspaceRef.current?.flush();
    await persistUiState();
  }, [persistUiState]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      flush,
      addEntityReference(entityId: string): boolean {
        const entity = entityCatalog.find((candidate) => candidate.id === entityId);
        if (!entity || !workspaceRef.current) {
          return false;
        }
        const duplicate = workspaceRef.current
          .getDocument()
          .nodes.some(
            (node) =>
              node.madi?.nodeKind === "ENTITY_REFERENCE" &&
              node.madi.entityId === entityId
          );
        if (
          duplicate &&
          !window.confirm(
            `'${entity.name}' 설정은 현재 캔버스에 이미 있습니다. 중복으로 추가할까요?`
          )
        ) {
          return false;
        }
        workspaceRef.current.addPickerItem({
          kind: "ENTITY_REFERENCE",
          entity
        });
        return true;
      }
    }),
    [entityCatalog, flush]
  );

  useEffect(() => {
    if (!pendingEntityId) {
      handledPendingEntityRef.current = null;
      setPendingEntityTarget((current) => (current ? null : current));
      return;
    }
    if (
      handledPendingEntityRef.current === pendingEntityId ||
      busy
    ) {
      return;
    }
    handledPendingEntityRef.current = pendingEntityId;
    const entity = entityCatalog.find(
      (candidate) => candidate.id === pendingEntityId
    );
    const targetCanvasId = canvases.some((canvas) => canvas.id === active?.id)
      ? active!.id
      : canvases[0]?.id;
    if (!entity || !targetCanvasId) {
      onPendingEntityHandled?.(pendingEntityId, false);
      return;
    }
    setPendingEntityTarget({
      entityId: pendingEntityId,
      canvasId: targetCanvasId,
      submitting: false,
      submissionId: null
    });
  }, [active, busy, canvases, entityCatalog, onPendingEntityHandled, pendingEntityId]);

  const selectCanvas = useCallback(
    async (canvasId: string): Promise<void> => {
      if (canvasId === activeRef.current?.id) {
        return;
      }
      try {
        await flush();
        await loadCanvas(canvasId);
        scheduleUiStateSave();
      } catch (reason) {
        setError(errorMessage(reason, "캔버스를 전환하지 못했습니다."));
      }
    },
    [flush, loadCanvas, scheduleUiStateSave]
  );

  const finishPendingEntity = useCallback(
    (entityId: string, added: boolean) => {
      setPendingEntityTarget(null);
      onPendingEntityHandled?.(entityId, added);
    },
    [onPendingEntityHandled]
  );

  const bindWorkspaceHandle = useCallback(
    (handle: PlotCanvasWorkspaceHandle | null) => {
      workspaceRef.current = handle;
      workspaceCanvasIdRef.current = handle ? active?.id ?? null : null;
    },
    [active?.id]
  );

  const confirmPendingEntityTarget = useCallback(async (): Promise<void> => {
    const draft = pendingEntityTarget;
    if (!draft || draft.submitting) {
      return;
    }
    const entity = entityCatalog.find(
      (candidate) => candidate.id === draft.entityId
    );
    if (!entity) {
      finishPendingEntity(draft.entityId, false);
      return;
    }
    const submissionId = ++pendingEntitySubmissionSequenceRef.current;
    setPendingEntityTarget({ ...draft, submitting: true, submissionId });
    if (activeRef.current?.id === draft.canvasId) {
      return;
    }
    try {
      await flush();
      await loadCanvas(draft.canvasId);
      if (activeRef.current?.id !== draft.canvasId) {
        throw new Error("선택한 캔버스를 불러오지 못했습니다.");
      }
      scheduleUiStateSave();
    } catch (reason) {
      setError(
        errorMessage(reason, "선택한 캔버스에 설정을 추가하지 못했습니다.")
      );
      finishPendingEntity(draft.entityId, false);
    }
  }, [
    entityCatalog,
    finishPendingEntity,
    flush,
    loadCanvas,
    pendingEntityTarget,
    scheduleUiStateSave
  ]);

  useEffect(() => {
    const draft = pendingEntityTarget;
    if (
      !draft?.submitting ||
      draft.submissionId === null ||
      active?.id !== draft.canvasId ||
      workspaceCanvasIdRef.current !== draft.canvasId ||
      processedPendingEntitySubmissionRef.current === draft.submissionId
    ) {
      return;
    }
    processedPendingEntitySubmissionRef.current = draft.submissionId;
    const entity = entityCatalog.find(
      (candidate) => candidate.id === draft.entityId
    );
    const workspace = workspaceRef.current;
    if (!entity || !workspace) {
      finishPendingEntity(draft.entityId, false);
      return;
    }
    try {
      const duplicate = workspace
        .getDocument()
        .nodes.some(
          (node) =>
            node.madi?.nodeKind === "ENTITY_REFERENCE" &&
            node.madi.entityId === draft.entityId
        );
      if (
        duplicate &&
        !window.confirm(
          `'${entity.name}' 설정은 선택한 캔버스에 이미 있습니다. 중복으로 추가할까요?`
        )
      ) {
        finishPendingEntity(draft.entityId, false);
        return;
      }
      workspace.addPickerItem({
        kind: "ENTITY_REFERENCE",
        entity
      });
      finishPendingEntity(draft.entityId, true);
    } catch (reason) {
      setError(
        errorMessage(reason, "선택한 캔버스에 설정을 추가하지 못했습니다.")
      );
      finishPendingEntity(draft.entityId, false);
    }
  }, [active?.id, entityCatalog, finishPendingEntity, pendingEntityTarget]);

  const createCanvas = useCallback(
    async (name = "새 캔버스", document?: MadiCanvasDocument): Promise<void> => {
      try {
        await flush();
        const result = await api.createCanvas({
          sessionId,
          name,
          ...(document ? { document } : {})
        });
        onProjectRevisionRef.current(result.revision);
        await reloadList(result.canvas.id);
      } catch (reason) {
        setError(errorMessage(reason, "새 캔버스를 만들지 못했습니다."));
      }
    },
    [api, flush, reloadList, sessionId]
  );

  const saveMetadata = useCallback(async (): Promise<void> => {
    const record = activeRef.current;
    if (!record) {
      return;
    }
    try {
      await workspaceRef.current?.flush();
      const result = await api.updateCanvas({
        sessionId,
        canvasId: record.id,
        name: nameDraft,
        description: descriptionDraft.trim() || null,
        expectedCanvasRevision: activeRef.current?.revision ?? record.revision
      });
      activeRef.current = result.canvas;
      setActive(result.canvas);
      setNameDraft(result.canvas.name);
      setDescriptionDraft(result.canvas.description ?? "");
      updateSummary(result.canvas);
      onProjectRevisionRef.current(result.revision);
      setError("");
    } catch (reason) {
      setError(errorMessage(reason, "캔버스 정보를 저장하지 못했습니다."));
    }
  }, [api, descriptionDraft, nameDraft, sessionId, updateSummary]);

  const duplicateActive = useCallback(async (): Promise<void> => {
    const record = activeRef.current;
    if (!record) {
      return;
    }
    try {
      await flush();
      const result = await api.duplicateCanvas({
        sessionId,
        sourceCanvasId: record.id,
        name: `${record.name} 복사본`
      });
      onProjectRevisionRef.current(result.revision);
      await reloadList(result.canvas.id);
    } catch (reason) {
      setError(errorMessage(reason, "캔버스를 복제하지 못했습니다."));
    }
  }, [api, flush, reloadList, sessionId]);

  const deleteActive = useCallback(async (): Promise<void> => {
    const record = activeRef.current;
    if (
      !record ||
      !window.confirm(
        `'${record.name}' 캔버스를 삭제할까요?\n노드 ${record.nodeCount}개 · 연결선 ${record.edgeCount}개`
      )
    ) {
      return;
    }
    try {
      await flush();
      const result = await api.deleteCanvas({
        sessionId,
        canvasId: record.id,
        expectedCanvasRevision: activeRef.current?.revision ?? record.revision
      });
      onProjectRevisionRef.current(result.revision);
      setUiState((current) => {
        const nextStates = { ...current.canvasStates };
        delete nextStates[record.id];
        const next = { lastCanvasId: null, canvasStates: nextStates };
        uiStateRef.current = next;
        return next;
      });
      await reloadList(null);
    } catch (reason) {
      setError(errorMessage(reason, "캔버스를 삭제하지 못했습니다."));
    }
  }, [api, flush, reloadList, sessionId]);

  const saveDocument = useCallback(
    async (request: CanvasSaveRequest) => {
      const record = activeRef.current;
      if (!record || request.canvasId !== record.id) {
        throw new Error("오래된 캔버스 저장 요청을 차단했습니다.");
      }
      const result = await api.saveCanvas({
        sessionId,
        canvasId: request.canvasId,
        document: request.document,
        expectedCanvasRevision: record.revision,
        generation: request.generation,
        saveSequence: request.saveSequence
      });
      if (
        result.canvasId !== request.canvasId ||
        result.generation !== request.generation ||
        result.saveSequence !== request.saveSequence
      ) {
        throw new Error("오래된 캔버스 저장 응답을 차단했습니다.");
      }
      if (activeRef.current?.id === result.canvasId) {
        activeRef.current = result.canvas;
        setActive(result.canvas);
        updateSummary(result.canvas);
      }
      onProjectRevisionRef.current(result.revision);
      return {
        canvasId: result.canvasId,
        generation: result.generation,
        saveSequence: result.saveSequence,
        contentHash: result.canvas.contentHash,
        revision: result.canvas.revision
      };
    },
    [api, sessionId, updateSummary]
  );

  const searchEntityReferences = useCallback(
    async (query: string): Promise<readonly CanvasEntityReference[]> => {
      const trimmed = query.trim();
      if (!trimmed) {
        return entityCatalog;
      }
      const result = await api.searchEntities({
        sessionId,
        query: trimmed,
        offset: 0,
        limit: 20
      });
      const byId = new Map(entityCatalog.map((entity) => [entity.id, entity]));
      return result.hits.map((hit) =>
        byId.get(hit.entity.id) ?? {
          id: hit.entity.id,
          name: hit.entity.name,
          kind: hit.entity.kind,
          status: hit.entity.status,
          summary: hit.entity.summary,
          colorToken: hit.entity.colorToken,
          aliases: [],
          tags: [],
          relationCount: 0
        }
      );
    },
    [api, entityCatalog, sessionId]
  );

  const pickImport = useCallback(async (): Promise<void> => {
    try {
      const selected = await api.pickCanvasImport();
      if (!selected) {
        return;
      }
      const preview = JsonCanvasAdapter.preview(selected.source, catalog);
      setImportDraft({
        fileName: selected.fileName,
        name: canvasNameFromFile(selected.fileName),
        document: preview.document,
        nodeCount: preview.nodeCount,
        edgeCount: preview.edgeCount,
        brokenReferenceCount: preview.brokenReferenceCount
      });
    } catch (reason) {
      setError(errorMessage(reason, "JSON Canvas를 가져오지 못했습니다."));
    }
  }, [api, catalog]);

  const exportActive = useCallback(async (): Promise<void> => {
    const record = activeRef.current;
    if (!record) {
      return;
    }
    try {
      await workspaceRef.current?.flush();
      await api.exportCanvas({
        sessionId,
        canvasId: record.id,
        suggestedFileName: record.name
      });
    } catch (reason) {
      setError(errorMessage(reason, "JSON Canvas를 내보내지 못했습니다."));
    }
  }, [api, sessionId]);

  const changeSort = useCallback(
    async (nextSort: CanvasSort): Promise<void> => {
      try {
        await flush();
        setSort(nextSort);
        await reloadListForSort(nextSort, activeRef.current?.id ?? null);
      } catch (reason) {
        setError(errorMessage(reason, "캔버스 정렬을 바꾸지 못했습니다."));
      }
    },
    [flush, reloadListForSort]
  );

  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const canvas of canvases) {
      const key = canvas.name.toLocaleLowerCase("ko-KR");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [canvases]);

  return (
    <section
      className="plot-canvas-mode"
      aria-label="캔버스 작업 공간"
      aria-busy={busy || interactionBlocked}
      inert={interactionBlocked ? true : undefined}
    >
      <aside className="plot-canvas-list" aria-label="캔버스 목록">
        <header>
          <h2>캔버스</h2>
          <button type="button" onClick={() => void createCanvas()}>
            새 캔버스
          </button>
        </header>
        <label>
          정렬
          <select
            aria-label="캔버스 정렬"
            value={sort}
            onChange={(event) =>
              void changeSort(event.currentTarget.value as CanvasSort)
            }
          >
            <option value="UPDATED_DESC">최근 수정순</option>
            <option value="UPDATED_ASC">오래된 수정순</option>
            <option value="NAME_ASC">이름 오름차순</option>
            <option value="NAME_DESC">이름 내림차순</option>
          </select>
        </label>
        <div role="list" className="plot-canvas-list__items">
          {canvases.map((canvas) => {
            const duplicated =
              (duplicateNames.get(canvas.name.toLocaleLowerCase("ko-KR")) ?? 0) > 1;
            return (
              <button
                key={canvas.id}
                type="button"
                role="listitem"
                aria-current={active?.id === canvas.id ? "true" : undefined}
                onClick={() => void selectCanvas(canvas.id)}
              >
                <strong>{canvas.name}</strong>
                <span>
                  노드 {canvas.nodeCount} · 연결선 {canvas.edgeCount}
                </span>
                {duplicated ? <small>중복 이름</small> : null}
              </button>
            );
          })}
          {!busy && canvases.length === 0 ? (
            <p>아직 캔버스가 없습니다. 새 캔버스를 만들어 보세요.</p>
          ) : null}
        </div>
        <div className="plot-canvas-list__file-actions">
          <button type="button" onClick={() => void pickImport()}>
            .canvas 가져오기
          </button>
          <button type="button" disabled={!active} onClick={() => void exportActive()}>
            .canvas 내보내기
          </button>
        </div>
      </aside>

      <main className="plot-canvas-mode__editor">
        {error ? <p className="plot-canvas-mode__error" role="alert">{error}</p> : null}
        {active ? (
          <>
            <header className="plot-canvas-metadata">
              <label>
                이름
                <input
                  aria-label="캔버스 이름"
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.currentTarget.value)}
                />
              </label>
              <label>
                설명
                <input
                  aria-label="캔버스 설명"
                  value={descriptionDraft}
                  onChange={(event) => setDescriptionDraft(event.currentTarget.value)}
                />
              </label>
              <button type="button" onClick={() => void saveMetadata()}>
                정보 저장
              </button>
              <button type="button" onClick={() => void duplicateActive()}>
                캔버스 복제
              </button>
              <button type="button" className="danger" onClick={() => void deleteActive()}>
                캔버스 삭제
              </button>
            </header>
            <PlotCanvasWorkspace
              key={active.id}
              ref={bindWorkspaceHandle}
              canvasId={active.id}
              document={toCanvasDocument(active)}
              documentVersion={`${active.id}:${active.revision}`}
              catalog={catalog}
              initialUiState={toComponentUiState(uiState.canvasStates[active.id])}
              onSearchEntities={searchEntityReferences}
              onSave={saveDocument}
              onAutosaveStateChange={setAutosave}
              onUiStateChange={(viewState) => {
                setUiState((current) => {
                  const next = {
                    lastCanvasId: active.id,
                    canvasStates: {
                      ...current.canvasStates,
                      [active.id]: viewState
                    }
                  };
                  uiStateRef.current = next;
                  return next;
                });
                scheduleUiStateSave();
              }}
              onOpenEntity={onOpenEntity}
              onOpenScene={onOpenScene}
            />
          </>
        ) : (
          <section className="workspace-empty" aria-busy={busy}>
            {busy ? "캔버스 불러오는 중…" : "왼쪽에서 캔버스를 만들거나 선택하세요."}
          </section>
        )}
        {autosave ? (
          <output className="plot-canvas-mode__save" data-phase={autosave.phase}>
            {autosave.phase === "saving"
              ? "저장 중"
              : autosave.phase === "dirty"
                ? "저장 대기"
                : autosave.phase === "error"
                  ? "저장 실패 · 편집 유지"
                  : "저장됨"}
          </output>
        ) : null}
      </main>

      {pendingEntityTarget ? (
        <section
          className="plot-canvas-import-preview"
          role="dialog"
          aria-modal="true"
          aria-labelledby="plot-canvas-target-title"
          aria-busy={pendingEntityTarget.submitting}
        >
          <h2 id="plot-canvas-target-title">설정을 추가할 캔버스 선택</h2>
          <p>
            ‘{entityCatalog.find((entity) => entity.id === pendingEntityTarget.entityId)?.name ?? "설정"}’을
            추가할 캔버스를 선택하세요.
          </p>
          <label>
            대상 캔버스
            <select
              autoFocus
              aria-label="대상 캔버스"
              value={pendingEntityTarget.canvasId}
              disabled={pendingEntityTarget.submitting}
              onChange={(event) => {
                const canvasId = event.currentTarget.value;
                setPendingEntityTarget((current) =>
                  current ? { ...current, canvasId } : current
                );
              }}
            >
              {canvases.map((canvas) => (
                <option key={canvas.id} value={canvas.id}>
                  {canvas.name} · 노드 {canvas.nodeCount} · 연결선 {canvas.edgeCount}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={pendingEntityTarget.submitting}
            onClick={() => void confirmPendingEntityTarget()}
          >
            선택한 캔버스에 추가
          </button>
          <button
            type="button"
            disabled={pendingEntityTarget.submitting}
            onClick={() => finishPendingEntity(pendingEntityTarget.entityId, false)}
          >
            취소
          </button>
        </section>
      ) : null}

      {importDraft ? (
        <section
          className="plot-canvas-import-preview"
          role="dialog"
          aria-modal="true"
          aria-label="JSON Canvas 가져오기 미리보기"
        >
          <h2>새 캔버스로 가져오기</h2>
          <p>{importDraft.fileName}</p>
          <p>
            노드 {importDraft.nodeCount}개 · 연결선 {importDraft.edgeCount}개 · 끊어진 참조 {importDraft.brokenReferenceCount}개
          </p>
          <label>
            새 캔버스 이름
            <input
              value={importDraft.name}
              onChange={(event) => {
                const name = event.currentTarget.value;
                setImportDraft((current) =>
                  current ? { ...current, name } : null
                );
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              const draft = importDraft;
              setImportDraft(null);
              void createCanvas(draft.name, draft.document);
            }}
          >
            새 캔버스로 가져오기
          </button>
          <button type="button" onClick={() => setImportDraft(null)}>
            취소
          </button>
        </section>
      ) : null}
    </section>
  );
});
