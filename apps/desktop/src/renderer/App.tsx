import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import type {
  DescendantScenePreview,
  DiffNamedSnapshotResult,
  ListDescendantScenesResult,
  MadiDesktopApi,
  NamedSnapshotSummary,
  ProjectTree,
  SearchHit,
  SearchProjectRequest,
  SearchProjectResult,
  TextStatisticsResult
} from "../shared/contracts";
import type {
  EditorTextReplacement,
  MadiEditorAdapterFactory
} from "./editor/MadiEditorAdapter";
import {
  Binder,
  type BinderCreateRequest,
  type BinderDeleteRequest,
  type BinderRenameRequest,
  type BinderReorderRequest,
  type BinderSelectRequest
} from "./components/Binder";
import { SaveStatusBadge } from "./components/SaveStatusBadge";
import { ImeChecklist } from "./components/ImeChecklist";
import type { CompositionEventSummary } from "./components/imeManualResults";
import { ScriveningsView } from "./components/ScriveningsView";
import {
  SearchReplacePanel,
  type SearchPanelApplyRequest,
  type SearchPanelSearchOptions
} from "./components/SearchReplacePanel";
import {
  SnapshotPanel,
  type SnapshotCreateInput
} from "./components/SnapshotPanel";
import {
  DocumentSessionController,
  type SceneReplacementPlan,
  type WorkspaceState
} from "./workspace/DocumentSessionController";
import { buildBinderTree } from "./workspace/binderTree";
import {
  orderedDescendantScenes,
  splitHighlightSegments
} from "./workspace/scrivenings";

const INITIAL_WORKSPACE: WorkspaceState = {
  savePhase: "no-project",
  session: null,
  activeSceneId: null,
  title: "새 작품",
  revision: 0,
  snapshotBytes: 0,
  snapshotFingerprint: "—",
  recoveryCharacters: 0,
  canUndo: false,
  canRedo: false,
  isComposing: false,
  lastSavedAt: "",
  errorMessage: ""
};

export interface AppProps {
  readonly api: MadiDesktopApi;
  readonly adapterFactory: MadiEditorAdapterFactory;
  readonly typieCommit: string;
  readonly editorSchemaVersion: number;
}

type EnginePhase = "loading" | "ready" | "error";
type Panel = "search" | "snapshots" | "development" | "ime";
const AUTOSAVE_DELAY_MS = 550;
const DEFAULT_BINDER_WIDTH = 300;
const WORKSPACE_PAGE_LIMIT = 200;

function publicError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function automaticRestoreSnapshotName(): string {
  return `복원 전 자동 저장 — ${new Date().toLocaleString("ko-KR")}`;
}

async function loadAllDescendantScenes(
  api: MadiDesktopApi,
  sessionId: string,
  scopeNodeId: string
): Promise<ListDescendantScenesResult> {
  const scenes: DescendantScenePreview[] = [];
  const seenSceneIds = new Set<string>();
  let offset = 0;
  let first: ListDescendantScenesResult | null = null;

  for (;;) {
    const page = await api.listDescendantScenes({
      sessionId,
      scopeNodeId,
      offset,
      limit: WORKSPACE_PAGE_LIMIT
    });
    first ??= page;
    if (
      page.scopeNodeId !== scopeNodeId ||
      page.offset !== offset ||
      page.revision !== first.revision
    ) {
      throw new Error(
        "연속 원고를 읽는 동안 프로젝트가 변경되었습니다. 다시 시도하세요."
      );
    }
    for (const scene of page.scenes) {
      if (seenSceneIds.has(scene.sceneId)) {
        throw new Error("연속 원고 페이지에 중복 장면이 있습니다.");
      }
      seenSceneIds.add(scene.sceneId);
      scenes.push(scene);
    }
    if (!page.hasMore) {
      if (scenes.length !== page.totalScenes) {
        throw new Error("연속 원고의 전체 장면 수가 일치하지 않습니다.");
      }
      return {
        ...first,
        scenes,
        totalScenes: page.totalScenes,
        offset: 0,
        limit: scenes.length,
        nextOffset: null,
        hasMore: false
      };
    }
    if (
      page.nextOffset === null ||
      page.nextOffset <= offset ||
      page.nextOffset > page.totalScenes
    ) {
      throw new Error("연속 원고 페이지 정보가 올바르지 않습니다.");
    }
    offset = page.nextOffset;
  }
}

async function searchAllProject(
  api: MadiDesktopApi,
  request: Omit<SearchProjectRequest, "offset" | "limit">
): Promise<SearchProjectResult> {
  const hits: SearchHit[] = [];
  const occurrenceIds = new Set<string>();
  let offset = 0;
  let first: SearchProjectResult | null = null;

  for (;;) {
    const page = await api.searchProject({
      ...request,
      offset,
      limit: WORKSPACE_PAGE_LIMIT
    });
    first ??= page;
    if (
      page.offset !== offset ||
      page.revision !== first.revision ||
      page.query !== first.query ||
      page.scopeNodeId !== first.scopeNodeId ||
      page.caseSensitive !== first.caseSensitive ||
      page.target !== first.target
    ) {
      throw new Error(
        "검색 결과를 읽는 동안 프로젝트가 변경되었습니다. 다시 검색하세요."
      );
    }
    for (const hit of page.hits) {
      if (occurrenceIds.has(hit.occurrenceId)) {
        throw new Error("검색 결과 페이지에 중복 항목이 있습니다.");
      }
      occurrenceIds.add(hit.occurrenceId);
      hits.push(hit);
    }
    if (!page.hasMore) {
      if (hits.length !== page.totalMatches) {
        throw new Error("검색 결과의 전체 일치 수가 일치하지 않습니다.");
      }
      return {
        ...first,
        hits,
        offset: 0,
        limit: hits.length,
        hasMore: false
      };
    }
    const nextOffset = page.offset + page.hits.length;
    if (page.hits.length === 0 || nextOffset <= offset) {
      throw new Error("검색 결과 페이지 정보가 올바르지 않습니다.");
    }
    offset = nextOffset;
  }
}

function expandedNodeIds(
  tree: ProjectTree,
  collapsedNodeIds: ReadonlySet<string>
): string[] {
  return tree.nodes
    .filter(
      (node) =>
        node.kind !== "SCENE" && !collapsedNodeIds.has(node.id)
    )
    .map((node) => node.id);
}

function replacementPlans(
  hits: readonly SearchHit[],
  replacement: string
): readonly SceneReplacementPlan[] {
  const byScene = new Map<
    string,
    {
      documentId: string;
      sourceContentHash: string;
      replacements: EditorTextReplacement[];
    }
  >();
  const occurrenceIds = new Set<string>();

  for (const hit of hits) {
    if (
      hit.field !== "BODY" ||
      !hit.sceneId ||
      !hit.documentId ||
      !hit.sourceContentHash ||
      !Number.isSafeInteger(hit.start) ||
      !Number.isSafeInteger(hit.end) ||
      hit.start < 0 ||
      hit.end <= hit.start ||
      occurrenceIds.has(hit.occurrenceId)
    ) {
      throw new Error("치환 미리보기에 유효하지 않은 본문 결과가 있습니다.");
    }
    occurrenceIds.add(hit.occurrenceId);
    const existing = byScene.get(hit.sceneId);
    if (
      existing &&
      (existing.documentId !== hit.documentId ||
        existing.sourceContentHash !== hit.sourceContentHash)
    ) {
      throw new Error("한 장면의 치환 결과가 서로 다른 문서를 가리킵니다.");
    }
    const group = existing ?? {
      documentId: hit.documentId,
      sourceContentHash: hit.sourceContentHash,
      replacements: []
    };
    group.replacements.push({
      id: hit.occurrenceId,
      start: hit.start,
      end: hit.end,
      expectedText: hit.matchedText,
      replacement
    });
    byScene.set(hit.sceneId, group);
  }

  return [...byScene.entries()].map(([sceneId, group]) => {
    const replacements = [...group.replacements].sort(
      (left, right) => left.start - right.start || left.end - right.end
    );
    for (let index = 1; index < replacements.length; index += 1) {
      if (replacements[index]!.start < replacements[index - 1]!.end) {
        throw new Error(
          "서로 겹치는 검색 결과는 같은 일괄치환에 포함할 수 없습니다."
        );
      }
    }
    return {
      sceneId,
      documentId: group.documentId,
      sourceContentHash: group.sourceContentHash,
      replacements
    };
  });
}

function ToolbarButton({
  children,
  disabled,
  onClick,
  title
}: {
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly title?: string;
}) {
  return (
    <button
      type="button"
      className="toolbar-button"
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}

function SearchHighlightedLabel({
  value,
  result
}: {
  readonly value: string;
  readonly result: SearchProjectResult | null;
}) {
  if (!result?.query) {
    return value;
  }
  return splitHighlightSegments(
    value,
    result.query,
    result.caseSensitive
  ).map((segment, index) =>
    segment.matched ? (
      <mark key={`${segment.start}-${segment.end}-${index}`}>
        {segment.text}
      </mark>
    ) : (
      <span key={`${segment.start}-${segment.end}-${index}`}>
        {segment.text}
      </span>
    )
  );
}

export function App({
  api,
  adapterFactory,
  typieCommit,
  editorSchemaVersion
}: AppProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [controller, setController] =
    useState<DocumentSessionController | null>(null);
  const [workspace, setWorkspace] =
    useState<WorkspaceState>(INITIAL_WORKSPACE);
  const [enginePhase, setEnginePhase] = useState<EnginePhase>("loading");
  const [engineError, setEngineError] = useState("");
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [projectTree, setProjectTree] = useState<ProjectTree | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [binderWidth, setBinderWidth] = useState(DEFAULT_BINDER_WIDTH);
  const [treeError, setTreeError] = useState("");
  const [uiStateReady, setUiStateReady] = useState(false);
  const [panel, setPanel] = useState<Panel>("development");
  const [scenePreviews, setScenePreviews] = useState<
    readonly DescendantScenePreview[]
  >([]);
  const [scriveningsLiveSceneId, setScriveningsLiveSceneId] = useState<
    string | null
  >(null);
  const [scriveningsHighlightedSceneId, setScriveningsHighlightedSceneId] =
    useState<string | null>(null);
  const [scriveningsError, setScriveningsError] = useState("");
  const [searchResult, setSearchResult] =
    useState<SearchProjectResult | null>(null);
  const [searchError, setSearchError] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [snapshots, setSnapshots] = useState<
    readonly NamedSnapshotSummary[]
  >([]);
  const [snapshotDiff, setSnapshotDiff] =
    useState<DiffNamedSnapshotResult | null>(null);
  const [snapshotError, setSnapshotError] = useState("");
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [textStatistics, setTextStatistics] =
    useState<TextStatisticsResult | null>(null);
  const [lastCompositionEvent, setLastCompositionEvent] =
    useState<CompositionEventSummary | null>(null);
  const [compositionEventActive, setCompositionEventActive] =
    useState<boolean | null>(null);
  const closeAttemptRef = useRef<Promise<void> | null>(null);
  const projectStateSessionRef = useRef<string | null>(null);
  const compositionActiveRef = useRef(false);
  const isComposing =
    compositionEventActive ?? workspace.isComposing;
  compositionActiveRef.current = isComposing;

  const imeEnvironment = useMemo(
    () =>
      appVersion === null
        ? null
        : {
            appVersion,
            typieCommit,
            editorSchemaVersion,
            platform: navigator.platform || "unknown",
            userAgent: navigator.userAgent
          },
    [appVersion, editorSchemaVersion, typieCommit]
  );
  const binderTree = useMemo(
    () => (projectTree ? buildBinderTree(projectTree.nodes) : null),
    [projectTree]
  );
  const selectedNode =
    projectTree?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedScene = selectedNode?.kind === "SCENE" ? selectedNode : null;
  const selectedScriveningsNode =
    selectedNode && selectedNode.kind !== "SCENE" ? selectedNode : null;
  const workNode = projectTree?.nodes.find((node) => node.kind === "WORK") ?? null;
  const scriveningsScenes = useMemo(() => {
    if (!projectTree || !selectedScriveningsNode) {
      return [];
    }
    return orderedDescendantScenes(
      projectTree,
      selectedScriveningsNode.id,
      scenePreviews
    );
  }, [projectTree, scenePreviews, selectedScriveningsNode]);
  const scriveningsSceneIds = useMemo(
    () => new Set(scriveningsScenes.map((scene) => scene.sceneId)),
    [scriveningsScenes]
  );
  const visibleScriveningsLiveSceneId =
    scriveningsLiveSceneId &&
    scriveningsSceneIds.has(scriveningsLiveSceneId)
      ? scriveningsLiveSceneId
      : null;
  const binderSelectedNodeId =
    selectedScriveningsNode &&
    scriveningsHighlightedSceneId &&
    scriveningsSceneIds.has(scriveningsHighlightedSceneId)
      ? scriveningsHighlightedSceneId
      : selectedNodeId;
  const currentSceneStatistics = textStatistics?.scenes.find(
    (scene) => scene.sceneId === workspace.activeSceneId
  );

  useEffect(() => {
    let cancelled = false;
    let createdController: DocumentSessionController | undefined;
    let unsubscribe: (() => void) | undefined;

    const initialize = async () => {
      if (!mountRef.current) {
        return;
      }
      try {
        const adapter = await adapterFactory(mountRef.current);
        if (cancelled) {
          return;
        }
        createdController = new DocumentSessionController(
          api,
          adapter,
          typieCommit,
          editorSchemaVersion
        );
        unsubscribe = createdController.subscribe(setWorkspace);
        setController(createdController);
        setEnginePhase("ready");
      } catch (error) {
        if (!cancelled) {
          setEnginePhase("error");
          setEngineError(
            error instanceof Error ? error.message : "Typie 초기화 실패"
          );
        }
      }
    };

    void initialize();
    void api
      .getAppVersion()
      .then((version) => {
        if (!cancelled) {
          setAppVersion(version);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAppVersion("unknown");
        }
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
      createdController?.dispose();
    };
  }, [adapterFactory, api, editorSchemaVersion, typieCommit]);

  useEffect(() => {
    const session = workspace.session;
    if (!session || !controller) {
      projectStateSessionRef.current = null;
      setUiStateReady(false);
      setProjectTree(null);
      setSelectedNodeId(null);
      setCollapsedNodeIds(new Set());
      setTreeError("");
      setScenePreviews([]);
      setScriveningsLiveSceneId(null);
      setScriveningsHighlightedSceneId(null);
      setScriveningsError("");
      setSearchResult(null);
      setSearchError("");
      setSnapshots([]);
      setSnapshotDiff(null);
      setSnapshotError("");
      setTextStatistics(null);
      return;
    }
    if (projectStateSessionRef.current !== session.sessionId) {
      projectStateSessionRef.current = session.sessionId;
      setScenePreviews([]);
      setScriveningsLiveSceneId(null);
      setScriveningsHighlightedSceneId(null);
      setScriveningsError("");
      setSearchResult(null);
      setSearchError("");
      setSnapshots([]);
      setSnapshotDiff(null);
      setSnapshotError("");
      setTextStatistics(null);
    }
    let cancelled = false;
    setUiStateReady(false);
    const restoreStructure = async () => {
      try {
        const [tree, storedUi] = await Promise.all([
          api.getProjectTree({ sessionId: session.sessionId }),
          api
            .loadUiState({ sessionId: session.sessionId })
            .catch(() => ({ state: null }))
        ]);
        if (cancelled) {
          return;
        }
        const ids = new Set(tree.nodes.map((node) => node.id));
        const branches = tree.nodes
          .filter((node) => node.kind !== "SCENE")
          .map((node) => node.id);
        const validExpanded = new Set(
          storedUi.state?.expandedNodeIds.filter((id) => ids.has(id)) ??
            branches
        );
        const preferredId = storedUi.state?.selectedNodeId;
        const fallback =
          tree.nodes.find((node) => node.id === session.sceneId) ??
          tree.nodes.find((node) => node.kind === "SCENE") ??
          tree.nodes.find((node) => node.kind === "WORK") ??
          null;
        const target =
          (preferredId
            ? tree.nodes.find((node) => node.id === preferredId)
            : undefined) ?? fallback;
        setProjectTree(tree);
        setCollapsedNodeIds(
          new Set(branches.filter((id) => !validExpanded.has(id)))
        );
        setBinderWidth(
          storedUi.state
            ? Math.min(640, Math.max(220, storedUi.state.binderWidth))
            : DEFAULT_BINDER_WIDTH
        );
        if (
          target?.kind === "SCENE" &&
          target.id !== workspace.activeSceneId
        ) {
          const switched = await controller.selectScene(
            target.id,
            () => compositionActiveRef.current
          );
          if (!switched || cancelled) {
            return;
          }
        }
        setSelectedNodeId(target?.id ?? null);
        if (target?.kind === "SCENE") {
          setScriveningsLiveSceneId(null);
          setScriveningsHighlightedSceneId(null);
        } else {
          const activeSceneId = controller.getState().activeSceneId;
          const descendants = target
            ? orderedDescendantScenes(tree, target.id, [])
            : [];
          const activeIsDescendant = descendants.some(
            (scene) => scene.sceneId === activeSceneId
          );
          setScriveningsLiveSceneId(
            activeIsDescendant ? activeSceneId : null
          );
          setScriveningsHighlightedSceneId(
            activeIsDescendant ? activeSceneId : null
          );
        }
        setUiStateReady(true);
        setTreeError("");
      } catch (error) {
        if (!cancelled) {
          setTreeError(
            error instanceof Error ? error.message : "작품 구조 복원 실패"
          );
        }
      }
    };
    void restoreStructure();
    return () => {
      cancelled = true;
    };
  }, [api, controller, workspace.session?.sessionId]);

  useEffect(() => {
    const session = workspace.session;
    if (!session || !selectedScriveningsNode) {
      setScenePreviews([]);
      setScriveningsError("");
      return;
    }
    let cancelled = false;
    void loadAllDescendantScenes(
      api,
      session.sessionId,
      selectedScriveningsNode.id
    )
      .then((result) => {
        if (!cancelled) {
          setScenePreviews(result.scenes);
          setScriveningsError("");
          controller?.adoptProjectRevision(result.revision);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setScenePreviews([]);
          setScriveningsError(
            publicError(error, "연속 원고 미리보기를 불러오지 못했습니다.")
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    api,
    controller,
    projectTree?.revision,
    selectedScriveningsNode?.id,
    workspace.revision,
    workspace.session?.sessionId
  ]);

  useEffect(() => {
    if (!controller || !selectedScene || !mountRef.current) {
      return;
    }
    try {
      controller.relocateEditor(mountRef.current);
    } catch (error) {
      setTreeError(publicError(error, "단일 장면 편집기 이동 실패"));
    }
  }, [controller, selectedScene?.id]);

  useEffect(() => {
    if (
      !controller ||
      !selectedScriveningsNode ||
      !scriveningsLiveSceneId ||
      scriveningsSceneIds.has(scriveningsLiveSceneId)
    ) {
      return;
    }
    if (mountRef.current) {
      try {
        controller.relocateEditor(mountRef.current);
      } catch {
        // The persistent mount remains the recovery target on the next switch.
      }
    }
    setScriveningsLiveSceneId(null);
    setScriveningsHighlightedSceneId(null);
  }, [
    controller,
    scriveningsLiveSceneId,
    scriveningsSceneIds,
    selectedScriveningsNode
  ]);

  useEffect(() => {
    const session = workspace.session;
    if (!session) {
      setSnapshots([]);
      setSnapshotDiff(null);
      return;
    }
    let cancelled = false;
    void api
      .listNamedSnapshots({ sessionId: session.sessionId })
      .then((result) => {
        if (!cancelled) {
          setSnapshots(result.snapshots);
          setSnapshotError("");
          controller?.adoptProjectRevision(result.revision);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSnapshotError(
            publicError(error, "Named snapshot 목록을 불러오지 못했습니다.")
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, controller, workspace.session?.sessionId]);

  useEffect(() => {
    const session = workspace.session;
    const scopeNodeId = selectedNodeId ?? workNode?.id;
    if (!session || !scopeNodeId) {
      setTextStatistics(null);
      return;
    }
    let cancelled = false;
    void api
      .getTextStatistics({
        sessionId: session.sessionId,
        scopeNodeId
      })
      .then((result) => {
        if (!cancelled) {
          setTextStatistics(result);
          controller?.adoptProjectRevision(result.revision);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTextStatistics(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    api,
    controller,
    selectedNodeId,
    workNode?.id,
    workspace.revision,
    workspace.session?.sessionId
  ]);

  useEffect(() => {
    const saveShortcut = (event: KeyboardEvent) => {
      if (
        controller &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLocaleLowerCase() === "s"
      ) {
        event.preventDefault();
        void controller.save(() => compositionActiveRef.current);
      }
    };
    window.addEventListener("keydown", saveShortcut);
    return () => window.removeEventListener("keydown", saveShortcut);
  }, [controller]);

  useEffect(() => {
    if (!controller || !searchResult || !workspace.activeSceneId) {
      return;
    }
    const activeHit = searchResult.hits.find(
      (hit) =>
        hit.field === "BODY" && hit.sceneId === workspace.activeSceneId
    );
    if (!activeHit) {
      return;
    }
    try {
      controller.revealTextRange(activeHit.start, activeHit.end, false);
    } catch (error) {
      setSearchError(
        publicError(error, "활성 장면의 첫 검색 결과를 표시하지 못했습니다.")
      );
    }
  }, [controller, searchResult, workspace.activeSceneId]);

  useEffect(() => {
    return api.onCloseRequested(() => {
      if (!closeAttemptRef.current) {
        closeAttemptRef.current = Promise.resolve(
          controller?.prepareForClose(
            () => compositionActiveRef.current
          ) ?? true
        )
          .then(async (documentReady) => {
            let readyToClose = documentReady;
            if (
              readyToClose &&
              !controller?.isEditorFailClosed() &&
              uiStateReady &&
              workspace.session &&
              projectTree
            ) {
              try {
                await api.saveUiState({
                  sessionId: workspace.session.sessionId,
                  state: {
                    selectedNodeId,
                    expandedNodeIds: expandedNodeIds(
                      projectTree,
                      collapsedNodeIds
                    ),
                    binderWidth
                  }
                });
              } catch (error) {
                readyToClose = false;
                setTreeError(
                  error instanceof Error
                    ? error.message
                    : "UI 상태 저장 실패"
                );
              }
            }
            const root = document.documentElement;
            if (readyToClose) {
              root.inert = true;
              root.dataset.closePending = "true";
            }
            try {
              const accepted = await api.completeCloseRequest({
                readyToClose
              });
              if (readyToClose && !accepted) {
                root.inert = false;
                delete root.dataset.closePending;
              }
            } catch {
              if (readyToClose) {
                root.inert = false;
                delete root.dataset.closePending;
              }
            }
          })
          .finally(() => {
            closeAttemptRef.current = null;
          });
      }
    });
  }, [
    api,
    binderWidth,
    collapsedNodeIds,
    controller,
    projectTree,
    selectedNodeId,
    uiStateReady,
    workspace.session
  ]);

  useEffect(() => {
    if (
      !controller ||
      enginePhase !== "ready" ||
      !workspace.session ||
      workspace.savePhase !== "dirty" ||
      isComposing
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void controller.save(() => compositionActiveRef.current);
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [controller, enginePhase, isComposing, workspace]);

  useEffect(() => {
    const session = workspace.session;
    if (!session || !projectTree || !uiStateReady) {
      return;
    }
    const timer = window.setTimeout(() => {
      void api
        .saveUiState({
          sessionId: session.sessionId,
          state: {
            selectedNodeId,
            expandedNodeIds: expandedNodeIds(projectTree, collapsedNodeIds),
            binderWidth
          }
        })
        .catch((error: unknown) => {
          setTreeError(
            error instanceof Error ? error.message : "UI 상태 저장 실패"
          );
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    api,
    binderWidth,
    collapsedNodeIds,
    projectTree,
    selectedNodeId,
    uiStateReady,
    workspace.session
  ]);

  useEffect(() => {
    const recordCompositionEvent = (event: CompositionEvent) => {
      const active = event.type !== "compositionend";
      compositionActiveRef.current = active;
      setCompositionEventActive(active);
      setLastCompositionEvent({
        type: event.type as CompositionEventSummary["type"],
        dataLength: Array.from(event.data ?? "").length,
        observedAt: new Date().toISOString()
      });
    };
    window.addEventListener(
      "compositionstart",
      recordCompositionEvent,
      true
    );
    window.addEventListener(
      "compositionupdate",
      recordCompositionEvent,
      true
    );
    window.addEventListener("compositionend", recordCompositionEvent, true);
    return () => {
      window.removeEventListener(
        "compositionstart",
        recordCompositionEvent,
        true
      );
      window.removeEventListener(
        "compositionupdate",
        recordCompositionEvent,
        true
      );
      window.removeEventListener(
        "compositionend",
        recordCompositionEvent,
        true
      );
    };
  }, []);

  const flushBeforeStructureChange = async (): Promise<boolean> =>
    controller?.flushPendingChanges(
      () => compositionActiveRef.current
    ) ?? false;

  const persistCurrentUiState = async (): Promise<void> => {
    const session = workspace.session;
    if (!session || !projectTree || !uiStateReady) {
      return;
    }
    await api.saveUiState({
      sessionId: session.sessionId,
      state: {
        selectedNodeId,
        expandedNodeIds: expandedNodeIds(projectTree, collapsedNodeIds),
        binderWidth
      }
    });
  };

  const shelterEditorSurface = (): boolean => {
    if (!controller || !mountRef.current) {
      return false;
    }
    try {
      controller.relocateEditor(mountRef.current);
      return true;
    } catch (error) {
      setTreeError(publicError(error, "편집기 안전 이동에 실패했습니다."));
      return false;
    }
  };

  const selectBinderNode = async ({ nodeId, type }: BinderSelectRequest) => {
    if (!controller) {
      return;
    }
    if (type === "SCENE") {
      const switched = await controller.selectScene(
        nodeId,
        () => compositionActiveRef.current
      );
      if (!switched) {
        return;
      }
      if (mountRef.current) {
        controller.relocateEditor(mountRef.current);
      }
      setScriveningsLiveSceneId(null);
      setScriveningsHighlightedSceneId(null);
    } else if (!(await flushBeforeStructureChange())) {
      return;
    } else {
      if (!shelterEditorSurface()) {
        return;
      }
      const activeSceneId = controller.getState().activeSceneId;
      const descendants = projectTree
        ? orderedDescendantScenes(projectTree, nodeId, [])
        : [];
      const activeIsDescendant = descendants.some(
        (scene) => scene.sceneId === activeSceneId
      );
      setScriveningsLiveSceneId(
        activeIsDescendant ? activeSceneId : null
      );
      setScriveningsHighlightedSceneId(
        activeIsDescendant ? activeSceneId : null
      );
      setScenePreviews([]);
    }
    setSelectedNodeId(nodeId);
    setTreeError("");
  };

  const createBinderNode = async ({
    parentId,
    type,
    title
  }: BinderCreateRequest) => {
    const session = workspace.session;
    if (!session || !(await flushBeforeStructureChange())) {
      return;
    }
    try {
      const before = new Set(projectTree?.nodes.map((node) => node.id));
      const next = await api.createNode({
        sessionId: session.sessionId,
        parentId,
        kind: type,
        title,
        editorEngineCommit: typieCommit,
        editorSchemaVersion
      });
      setProjectTree(next);
      controller?.adoptProjectRevision(next.revision);
      setCollapsedNodeIds((current) => {
        const updated = new Set(current);
        updated.delete(parentId);
        return updated;
      });
      const created = next.nodes.find((node) => !before.has(node.id));
      if (created?.kind === "SCENE" && controller) {
        const switched = await controller.selectScene(
          created.id,
          () => compositionActiveRef.current
        );
        if (switched) {
          if (mountRef.current) {
            controller.relocateEditor(mountRef.current);
          }
          setSelectedNodeId(created.id);
          setScriveningsLiveSceneId(null);
          setScriveningsHighlightedSceneId(null);
        }
      } else if (created) {
        if (!shelterEditorSurface()) {
          return;
        }
        setScriveningsLiveSceneId(null);
        setScriveningsHighlightedSceneId(null);
        setSelectedNodeId(created.id);
      }
      setTreeError("");
    } catch (error) {
      setTreeError(
        error instanceof Error ? error.message : "노드 생성 실패"
      );
    }
  };

  const renameBinderNode = async ({ nodeId, title }: BinderRenameRequest) => {
    const session = workspace.session;
    if (!session || !(await flushBeforeStructureChange())) {
      return;
    }
    try {
      const next = await api.renameNode({
        sessionId: session.sessionId,
        nodeId,
        title
      });
      setProjectTree(next);
      controller?.adoptProjectRevision(next.revision);
      setTreeError("");
    } catch (error) {
      setTreeError(
        error instanceof Error ? error.message : "이름 변경 실패"
      );
    }
  };

  const deleteBinderNode = async ({ nodeId }: BinderDeleteRequest) => {
    const session = workspace.session;
    if (!session || !(await flushBeforeStructureChange())) {
      return;
    }
    try {
      const next = await api.deleteNode({
        sessionId: session.sessionId,
        nodeId,
        recursive: true
      });
      shelterEditorSurface();
      setProjectTree(next);
      controller?.adoptProjectRevision(next.revision);
      const selectedStillExists = next.nodes.some(
        (node) => node.id === selectedNodeId
      );
      if (!selectedStillExists) {
        const fallback =
          next.nodes.find((node) => node.kind === "SCENE") ??
          next.nodes.find((node) => node.kind === "WORK") ??
          null;
        if (fallback?.kind === "SCENE" && controller) {
          const switched = await controller.selectScene(
            fallback.id,
            () => compositionActiveRef.current
          );
          if (switched && mountRef.current) {
            controller.relocateEditor(mountRef.current);
          }
          setSelectedNodeId(switched ? fallback.id : null);
          setScriveningsLiveSceneId(null);
          setScriveningsHighlightedSceneId(null);
        } else {
          setSelectedNodeId(fallback?.id ?? null);
        }
      }
      setTreeError("");
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : "노드 삭제 실패");
    }
  };

  const reorderBinderNode = async ({
    nodeId,
    direction
  }: BinderReorderRequest) => {
    const session = workspace.session;
    if (!session || !(await flushBeforeStructureChange())) {
      return;
    }
    try {
      const next = await api.reorderNode({
        sessionId: session.sessionId,
        nodeId,
        direction
      });
      setProjectTree(next);
      controller?.adoptProjectRevision(next.revision);
      setTreeError("");
    } catch (error) {
      setTreeError(
        error instanceof Error ? error.message : "순서 변경 실패"
      );
    }
  };

  const attachScriveningsEditor = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element || !controller) {
        return;
      }
      try {
        controller.relocateEditor(element);
        setScriveningsError("");
      } catch (error) {
        setScriveningsError(
          publicError(error, "연속 원고 편집기 이동에 실패했습니다.")
        );
      }
    },
    [controller]
  );

  const activateScriveningsScene = async (sceneId: string): Promise<void> => {
    if (!controller) {
      throw new Error("편집기가 아직 준비되지 않았습니다.");
    }
    const switched = await controller.selectScene(
      sceneId,
      () => compositionActiveRef.current
    );
    if (!switched) {
      throw new Error(
        controller.getState().errorMessage || "장면을 전환하지 못했습니다."
      );
    }
    setScriveningsHighlightedSceneId(sceneId);
    setScriveningsError("");
  };

  const deactivateScriveningsScene = async (): Promise<void> => {
    if (!controller || !(await flushBeforeStructureChange())) {
      throw new Error(
        controller?.getState().errorMessage || "장면 저장에 실패했습니다."
      );
    }
    if (!mountRef.current) {
      throw new Error("편집기 안전 mount를 찾을 수 없습니다.");
    }
    controller.relocateEditor(mountRef.current);
  };

  const runProjectSearch = async (
    query: string,
    options: SearchPanelSearchOptions
  ): Promise<void> => {
    const session = workspace.session;
    if (!session || !controller) {
      throw new Error("검색할 프로젝트가 열려 있지 않습니다.");
    }
    setSearchBusy(true);
    setSearchError("");
    try {
      if (!(await flushBeforeStructureChange())) {
        throw new Error(
          controller.getState().errorMessage ||
            "현재 장면을 저장하지 못해 검색을 갱신하지 않았습니다."
        );
      }
      const result = await searchAllProject(api, {
        sessionId: session.sessionId,
        query,
        caseSensitive: options.caseSensitive,
        target: options.target,
        ...(options.scope === "CURRENT" && selectedNodeId
          ? { scopeNodeId: selectedNodeId }
          : {})
      });
      controller.adoptProjectRevision(result.revision);
      setSearchResult(result);
    } catch (error) {
      setSearchError(publicError(error, "프로젝트 검색에 실패했습니다."));
      throw error;
    } finally {
      setSearchBusy(false);
    }
  };

  const openSearchResult = async (hit: SearchHit): Promise<void> => {
    if (!controller) {
      return;
    }
    setSearchError("");
    try {
      if (hit.sceneId) {
        const switched = await controller.selectScene(
          hit.sceneId,
          () => compositionActiveRef.current
        );
        if (!switched) {
          throw new Error(
            controller.getState().errorMessage ||
              "검색 결과 장면을 열지 못했습니다."
          );
        }
        if (!mountRef.current) {
          throw new Error("단일 장면 편집기 mount를 찾을 수 없습니다.");
        }
        controller.relocateEditor(mountRef.current);
        setSelectedNodeId(hit.sceneId);
        setScriveningsLiveSceneId(null);
        setScriveningsHighlightedSceneId(null);
        if (hit.field === "BODY") {
          controller.revealTextRange(hit.start, hit.end);
        }
        return;
      }
      await selectBinderNode({ nodeId: hit.nodeId, type: hit.nodeKind });
    } catch (error) {
      setSearchError(
        publicError(error, "검색 결과 위치로 이동하지 못했습니다.")
      );
      throw error;
    }
  };

  const applySearchReplacement = async (
    request: SearchPanelApplyRequest
  ): Promise<void> => {
    if (!controller || !workspace.session) {
      throw new Error("치환할 프로젝트가 열려 있지 않습니다.");
    }
    setSearchBusy(true);
    setSearchError("");
    try {
      await persistCurrentUiState();
      const plans = replacementPlans(request.hits, request.replacement);
      const result = await controller.applySemanticReplacementBatch(
        plans,
        request.expectedRevision,
        request.query,
        request.replacement,
        request.caseSensitive,
        () => compositionActiveRef.current
      );
      if (!result) {
        throw new Error(
          controller.getState().errorMessage ||
            "의미 구조 보존 치환을 적용하지 못했습니다."
        );
      }
      const sessionId = workspace.session.sessionId;
      const [tree, nextSearch, nextSnapshots] = await Promise.all([
        api.getProjectTree({ sessionId }),
        searchAllProject(api, {
          sessionId,
          query: request.query,
          caseSensitive: request.caseSensitive,
          target: searchResult?.target ?? "BODIES",
          scopeNodeId: request.scopeNodeId
        }),
        api.listNamedSnapshots({ sessionId })
      ]);
      setProjectTree(tree);
      setSearchResult(nextSearch);
      setSnapshots(nextSnapshots.snapshots);
      setSnapshotDiff(null);
      controller.adoptProjectRevision(
        Math.max(
          result.revision,
          tree.revision,
          nextSearch.revision,
          nextSnapshots.revision
        )
      );
    } catch (error) {
      setSearchError(
        publicError(error, "선택한 검색 결과 치환에 실패했습니다.")
      );
      throw error;
    } finally {
      setSearchBusy(false);
    }
  };

  const reloadSnapshotList = async (): Promise<void> => {
    const session = workspace.session;
    if (!session || !controller) {
      return;
    }
    const result = await api.listNamedSnapshots({
      sessionId: session.sessionId
    });
    setSnapshots(result.snapshots);
    controller.adoptProjectRevision(result.revision);
  };

  const createNamedSnapshot = async (
    input: SnapshotCreateInput
  ): Promise<void> => {
    const session = workspace.session;
    if (!session || !controller) {
      throw new Error("Snapshot을 만들 프로젝트가 열려 있지 않습니다.");
    }
    setSnapshotBusy(true);
    setSnapshotError("");
    try {
      if (!(await flushBeforeStructureChange())) {
        throw new Error(
          controller.getState().errorMessage ||
            "현재 장면을 저장하지 못해 snapshot을 만들지 않았습니다."
        );
      }
      await persistCurrentUiState();
      const result = await api.createNamedSnapshot({
        sessionId: session.sessionId,
        name: input.name,
        ...(input.note ? { note: input.note } : {})
      });
      controller.adoptProjectRevision(result.revision);
      await reloadSnapshotList();
      setSnapshotDiff(null);
    } catch (error) {
      setSnapshotError(
        publicError(error, "Named snapshot 생성에 실패했습니다.")
      );
      throw error;
    } finally {
      setSnapshotBusy(false);
    }
  };

  const renameNamedSnapshot = async (
    snapshotId: string,
    name: string
  ): Promise<void> => {
    const session = workspace.session;
    if (!session || !controller) {
      throw new Error("프로젝트가 열려 있지 않습니다.");
    }
    setSnapshotBusy(true);
    setSnapshotError("");
    try {
      const result = await api.renameNamedSnapshot({
        sessionId: session.sessionId,
        snapshotId,
        name
      });
      controller.adoptProjectRevision(result.revision);
      await reloadSnapshotList();
      setSnapshotDiff((current) =>
        current?.snapshot.id === snapshotId ? null : current
      );
    } catch (error) {
      setSnapshotError(
        publicError(error, "Named snapshot 이름 변경에 실패했습니다.")
      );
      throw error;
    } finally {
      setSnapshotBusy(false);
    }
  };

  const deleteNamedSnapshot = async (snapshotId: string): Promise<void> => {
    const session = workspace.session;
    if (!session || !controller) {
      throw new Error("프로젝트가 열려 있지 않습니다.");
    }
    setSnapshotBusy(true);
    setSnapshotError("");
    try {
      const result = await api.deleteNamedSnapshot({
        sessionId: session.sessionId,
        snapshotId
      });
      controller.adoptProjectRevision(result.revision);
      setSnapshots((current) =>
        current.filter((snapshot) => snapshot.id !== snapshotId)
      );
      setSnapshotDiff((current) =>
        current?.snapshot.id === snapshotId ? null : current
      );
    } catch (error) {
      setSnapshotError(
        publicError(error, "Named snapshot 삭제에 실패했습니다.")
      );
      throw error;
    } finally {
      setSnapshotBusy(false);
    }
  };

  const requestSnapshotDiff = async (snapshotId: string): Promise<void> => {
    const session = workspace.session;
    if (!session || !controller) {
      throw new Error("프로젝트가 열려 있지 않습니다.");
    }
    setSnapshotBusy(true);
    setSnapshotError("");
    try {
      if (!(await flushBeforeStructureChange())) {
        throw new Error(
          controller.getState().errorMessage ||
            "현재 장면을 저장하지 못해 차이를 계산하지 않았습니다."
        );
      }
      const result = await api.diffNamedSnapshot({
        sessionId: session.sessionId,
        snapshotId
      });
      controller.adoptProjectRevision(result.revision);
      setSnapshotDiff(result);
    } catch (error) {
      setSnapshotError(
        publicError(error, "Snapshot 변경 요약을 계산하지 못했습니다.")
      );
      throw error;
    } finally {
      setSnapshotBusy(false);
    }
  };

  const restoreNamedSnapshot = async (snapshotId: string): Promise<void> => {
    const session = workspace.session;
    if (!session || !controller) {
      throw new Error("프로젝트가 열려 있지 않습니다.");
    }
    setSnapshotBusy(true);
    setSnapshotError("");
    try {
      await controller.runExclusiveEditorOperation(async () => {
        await persistCurrentUiState();
        const freshDiff = await api.diffNamedSnapshot({
          sessionId: session.sessionId,
          snapshotId
        });
        if (
          !snapshotDiff ||
          snapshotDiff.snapshot.id !== snapshotId ||
          snapshotDiff.revision !== freshDiff.revision ||
          JSON.stringify(snapshotDiff.summary) !==
            JSON.stringify(freshDiff.summary)
        ) {
          setSnapshotDiff(freshDiff);
          throw new Error(
            "복원 미리보기 이후 프로젝트가 변경되었습니다. 갱신된 차이를 확인한 뒤 다시 복원하세요."
          );
        }

        const result = await api.restoreNamedSnapshot({
          sessionId: session.sessionId,
          snapshotId,
          autoSnapshotName: automaticRestoreSnapshotName()
        });
        if (mountRef.current) {
          controller.relocateEditor(mountRef.current);
        }
        const [tree, restoredUi] = await Promise.all([
          api.getProjectTree({ sessionId: session.sessionId }),
          api.loadUiState({ sessionId: session.sessionId })
        ]);
        const activeBeforeRestore = controller.getState().activeSceneId;
        const restoredSelection = restoredUi.state?.selectedNodeId
          ? tree.nodes.find(
              (node) => node.id === restoredUi.state?.selectedNodeId
            ) ?? null
          : null;
        const sceneToLoad =
          (restoredSelection?.kind === "SCENE" ? restoredSelection : null) ??
          tree.nodes.find(
            (node) =>
              node.kind === "SCENE" && node.id === activeBeforeRestore
          ) ?? tree.nodes.find((node) => node.kind === "SCENE") ?? null;
        if (sceneToLoad) {
          await controller.reloadSceneFromStorage(
            sceneToLoad.id,
            result.revision
          );
        } else {
          await controller.clearActiveSceneAfterProjectRestore(
            tree.project.title,
            result.revision
          );
        }

        const previousSelection = tree.nodes.find(
          (node) => node.id === selectedNodeId
        );
        const nextSelection =
          restoredSelection ??
          previousSelection ??
          sceneToLoad ??
          tree.nodes.find((node) => node.kind === "WORK") ??
          null;
        setProjectTree(tree);
        const validIds = new Set(tree.nodes.map((node) => node.id));
        const branchIds = tree.nodes
          .filter((node) => node.kind !== "SCENE")
          .map((node) => node.id);
        setCollapsedNodeIds((current) => {
          const expanded = restoredUi.state
            ? new Set(
                restoredUi.state.expandedNodeIds.filter((id) =>
                  validIds.has(id)
                )
              )
            : new Set(
                branchIds.filter((id) => !current.has(id) && validIds.has(id))
              );
          return new Set(branchIds.filter((id) => !expanded.has(id)));
        });
        if (restoredUi.state) {
          setBinderWidth(
            Math.min(640, Math.max(220, restoredUi.state.binderWidth))
          );
        }
        setSelectedNodeId(nextSelection?.id ?? null);
        if (nextSelection && nextSelection.kind !== "SCENE" && sceneToLoad) {
          const insideSelection = orderedDescendantScenes(
            tree,
            nextSelection.id,
            []
          ).some((scene) => scene.sceneId === sceneToLoad.id);
          setScriveningsLiveSceneId(insideSelection ? sceneToLoad.id : null);
          setScriveningsHighlightedSceneId(
            insideSelection ? sceneToLoad.id : null
          );
        } else {
          setScriveningsLiveSceneId(null);
          setScriveningsHighlightedSceneId(null);
        }
        setSearchResult(null);
        setSnapshotDiff(null);
        await reloadSnapshotList();
      }, () => compositionActiveRef.current);
    } catch (error) {
      setSnapshotError(
        publicError(error, "Named snapshot 복원에 실패했습니다.")
      );
      throw error;
    } finally {
      setSnapshotBusy(false);
    }
  };

  const hasActiveDocument =
    enginePhase === "ready" &&
    !!workspace.session?.documentId &&
    !!workspace.activeSceneId;
  const hasDocument =
    hasActiveDocument &&
    (Boolean(selectedScene) || Boolean(visibleScriveningsLiveSceneId));
  const busy =
    workspace.savePhase === "saving" ||
    workspace.savePhase === "restoring";

  return (
    <main className="app-shell">
      <header className="titlebar">
        <div className="wordmark" aria-label="madi">
          madi
          <span>phase 1B</span>
        </div>
        <label className="document-title">
          <span className="sr-only">현재 작품명</span>
          <input
            value={projectTree?.project.title ?? workspace.session?.title ?? "새 작품"}
            readOnly
            maxLength={500}
            aria-label="현재 작품명"
          />
        </label>
        <SaveStatusBadge phase={workspace.savePhase} />
      </header>

      <nav className="toolbar" aria-label="문서 작업">
        <div className="toolbar__group">
          <ToolbarButton
            disabled={enginePhase !== "ready" || busy}
            onClick={() =>
              void controller?.createProject(
                () => compositionActiveRef.current
              )
            }
          >
            새 프로젝트
          </ToolbarButton>
          <ToolbarButton
            disabled={enginePhase !== "ready" || busy}
            onClick={() =>
              void controller?.openProject(
                () => compositionActiveRef.current
              )
            }
          >
            .madi 열기
          </ToolbarButton>
          <ToolbarButton
            disabled={!hasDocument || busy}
            onClick={() =>
              void controller?.save(() => compositionActiveRef.current)
            }
            title="Ctrl+S"
          >
            저장
          </ToolbarButton>
        </div>
        <span className="toolbar__divider" aria-hidden="true" />
        <div className="toolbar__group">
          <ToolbarButton
            disabled={!hasDocument || !workspace.canUndo || busy}
            onClick={() => controller?.undo()}
            title="최근 명령 기반 가능 상태(엔진 전체 history 보장 아님)"
          >
            Undo
          </ToolbarButton>
          <ToolbarButton
            disabled={!hasDocument || !workspace.canRedo || busy}
            onClick={() => controller?.redo()}
            title="최근 명령 기반 가능 상태(엔진 전체 history 보장 아님)"
          >
            Redo
          </ToolbarButton>
          <ToolbarButton
            disabled={!hasDocument || busy}
            onClick={() => controller?.insertSceneBreak()}
          >
            장면 구분선
          </ToolbarButton>
        </div>
        <div className="toolbar__spacer" />
        <div className="panel-switch" role="group" aria-label="작업 패널">
          <button
            type="button"
            aria-pressed={panel === "search"}
            disabled={!workspace.session}
            onClick={() => setPanel("search")}
          >
            검색 · 치환
          </button>
          <button
            type="button"
            aria-pressed={panel === "snapshots"}
            disabled={!workspace.session}
            onClick={() => setPanel("snapshots")}
          >
            Snapshot
          </button>
          <button
            type="button"
            aria-pressed={panel === "development"}
            onClick={() => setPanel("development")}
          >
            개발 패널
          </button>
          <button
            type="button"
            aria-pressed={panel === "ime"}
            disabled={appVersion === null}
            onClick={() => setPanel("ime")}
          >
            한국어 IME 체크
          </button>
        </div>
      </nav>

      <section
        className="workspace phase1-workspace"
        style={{ gridTemplateColumns: `${binderWidth}px minmax(0, 1fr)` }}
      >
        <div className="binder-pane">
          <label className="binder-width-control">
            <span>Binder 폭</span>
            <input
              type="range"
              min="220"
              max="640"
              step="10"
              value={binderWidth}
              onChange={(event) => setBinderWidth(Number(event.target.value))}
              aria-label="Binder 폭"
            />
          </label>
          {binderTree ? (
            <Binder
              tree={binderTree}
              selectedNodeId={binderSelectedNodeId}
              collapsedNodeIds={collapsedNodeIds}
              onSelect={(request) => void selectBinderNode(request)}
              onToggleCollapsed={(nodeId, collapsed) =>
                setCollapsedNodeIds((current) => {
                  const updated = new Set(current);
                  if (collapsed) {
                    updated.add(nodeId);
                  } else {
                    updated.delete(nodeId);
                  }
                  return updated;
                })
              }
              onCreate={(request) => void createBinderNode(request)}
              onRename={(request) => void renameBinderNode(request)}
              onDelete={(request) => void deleteBinderNode(request)}
              onReorder={(request) => void reorderBinderNode(request)}
            />
          ) : (
            <aside className="binder binder--empty" aria-label="작품 Binder">
              <h2>Binder</h2>
              <p>새 프로젝트를 만들거나 `.madi` 파일을 여세요.</p>
            </aside>
          )}
          {treeError && (
            <p className="error-message binder-error" role="alert">
              {treeError}
            </p>
          )}
        </div>
        <section className="editor-stage" aria-label="Typie 편집기">
          <header className="scene-editor-heading">
            <div>
              <span>
                {selectedScene
                  ? "현재 장면"
                  : selectedScriveningsNode
                    ? "Scrivenings 범위"
                    : "선택한 항목"}
              </span>
              <strong>
                <SearchHighlightedLabel
                  value={selectedNode?.title ?? "장면을 선택하세요"}
                  result={searchResult}
                />
              </strong>
            </div>
            <div>
              <span>마지막 저장</span>
              <strong>
                {workspace.lastSavedAt
                  ? new Date(workspace.lastSavedAt).toLocaleTimeString()
                  : "—"}
              </strong>
            </div>
          </header>
          <div
            className="single-scene-workspace"
            hidden={Boolean(selectedScriveningsNode)}
          >
            <div className="editor-stage__ruler">
              <span>0</span>
              <span>20</span>
              <span>40</span>
              <span>60</span>
              <span>80</span>
            </div>
            <div
              ref={mountRef}
              id="typie-editor-mount"
              data-testid="typie-editor-mount"
              className={`typie-editor-mount${
                selectedScene && hasActiveDocument
                  ? ""
                  : " typie-editor-mount--inactive"
              }`}
              aria-label="Typie WASM editor mount"
              aria-hidden={!selectedScene || !hasActiveDocument}
              inert={selectedScene && hasActiveDocument ? undefined : true}
              onMouseDown={() =>
                selectedScene && hasActiveDocument && controller?.focus()
              }
            />
          </div>
          {enginePhase !== "ready" && (
            <div className="engine-state" role="status">
              <div className="engine-state__mark">T</div>
              <strong>
                {enginePhase === "loading"
                  ? "Typie WASM 어댑터 준비 중"
                  : "Typie WASM 어댑터 미등록"}
              </strong>
              {engineError && <p>{engineError}</p>}
              <small>
                이 영역은 실제 Typie 런타임의 mount 경계입니다. 대체
                contenteditable 편집기를 사용하지 않습니다.
              </small>
            </div>
          )}
          {enginePhase === "ready" && !workspace.session && (
            <div className="empty-document">
              새 프로젝트를 만들거나 기존 .madi 파일을 여세요.
            </div>
          )}
          {enginePhase === "ready" &&
            selectedScene &&
            hasActiveDocument &&
            workspace.recoveryCharacters === 0 && (
              <div className="empty-scene-hint">
                빈 장면입니다. 여기에 본문을 입력하세요.
              </div>
            )}
          {enginePhase === "ready" &&
            workspace.session &&
            projectTree &&
            selectedScriveningsNode && (
              <div className="scrivenings-workspace">
                {scriveningsError && (
                  <p className="error-message" role="alert">
                    {scriveningsError}
                  </p>
                )}
                <ScriveningsView
                  projectTree={projectTree}
                  selectedNodeId={selectedScriveningsNode.id}
                  scenePreviews={scenePreviews}
                  activeSceneId={visibleScriveningsLiveSceneId}
                  onActivateScene={(request) =>
                    activateScriveningsScene(request.toSceneId)
                  }
                  onActiveSceneChange={(sceneId) => {
                    setScriveningsLiveSceneId(sceneId);
                    setScriveningsHighlightedSceneId(sceneId);
                  }}
                  onSceneTitleClick={({ sceneId }) =>
                    setScriveningsHighlightedSceneId(sceneId)
                  }
                  onDeactivateScene={() => deactivateScriveningsScene()}
                  onActivationError={(error) =>
                    setScriveningsError(
                      publicError(error, "연속 원고 장면 전환 실패")
                    )
                  }
                  searchQuery={searchResult?.query ?? ""}
                  searchCaseSensitive={
                    searchResult?.caseSensitive ?? false
                  }
                  renderLiveEditor={(scene) => (
                    <div
                      ref={attachScriveningsEditor}
                      className="typie-editor-mount scrivenings__typie-mount"
                      aria-label={`${scene.title || "새 장면"} Typie 편집기`}
                      onMouseDown={() => controller?.focus()}
                    />
                  )}
                />
              </div>
            )}
        </section>

        <div className="inspector-drawer">
        {panel === "search" ? (
          <SearchReplacePanel
            result={searchResult}
            semanticReplaceAvailable={
              controller?.canApplySemanticReplacement() ?? false
            }
            currentScopeLabel={selectedNode?.title ?? "현재 선택 범위"}
            currentScopeId={selectedNodeId}
            currentScopeAvailable={Boolean(selectedNode)}
            busy={busy || searchBusy}
            errorMessage={searchError}
            onSearch={runProjectSearch}
            onResultClick={openSearchResult}
            onApply={applySearchReplacement}
          />
        ) : panel === "snapshots" ? (
          <SnapshotPanel
            snapshots={snapshots}
            diff={snapshotDiff}
            busy={busy || snapshotBusy}
            errorMessage={snapshotError}
            onCreate={createNamedSnapshot}
            onRename={renameNamedSnapshot}
            onDelete={deleteNamedSnapshot}
            onRequestDiff={requestSnapshotDiff}
            onRestore={restoreNamedSnapshot}
          />
        ) : panel === "ime" && imeEnvironment ? (
          <ImeChecklist
            key={`${imeEnvironment.appVersion}:${imeEnvironment.typieCommit}:${imeEnvironment.editorSchemaVersion}:${imeEnvironment.platform}:${imeEnvironment.userAgent}`}
            isComposing={isComposing}
            lastCompositionEvent={lastCompositionEvent}
            savePhase={workspace.savePhase}
            canUndo={workspace.canUndo}
            canRedo={workspace.canRedo}
            hasDocument={hasDocument}
            busy={busy}
            environment={imeEnvironment}
            onCreateEmptyDocument={() =>
              controller?.createProject(
                () => compositionActiveRef.current
              )
            }
            onSaveSnapshot={() => {
              void controller?.save(() => compositionActiveRef.current);
            }}
            onOpenProject={() =>
              controller?.openProject(
                () => compositionActiveRef.current
              )
            }
            onUndo={() => controller?.undo()}
            onRedo={() => controller?.redo()}
          />
        ) : (
          <aside className="side-panel development-panel">
            <div className="side-panel__heading">
              <div>
                <p className="eyebrow">VERIFICATION</p>
                <h2>개발 패널</h2>
              </div>
              <span className={`engine-pill engine-pill--${enginePhase}`}>
                {enginePhase}
              </span>
            </div>
            <dl className="diagnostics">
              <div>
                <dt>앱 버전</dt>
                <dd>{appVersion ?? "확인 중"}</dd>
              </div>
              <div>
                <dt>편집 엔진</dt>
                <dd>Typie / WASM</dd>
              </div>
              <div>
                <dt>commit</dt>
                <dd title={typieCommit}>{typieCommit}</dd>
              </div>
              <div>
                <dt>schema</dt>
                <dd>{editorSchemaVersion}</dd>
              </div>
              <div>
                <dt>파일</dt>
                <dd>{workspace.session?.fileName ?? "—"}</dd>
              </div>
              <div>
                <dt>revision</dt>
                <dd>
                  {Math.max(projectTree?.revision ?? 0, workspace.revision)}
                </dd>
              </div>
              <div>
                <dt>snapshot</dt>
                <dd>{workspace.snapshotBytes.toLocaleString()} bytes</dd>
              </div>
              <div>
                <dt>fingerprint</dt>
                <dd>{workspace.snapshotFingerprint}</dd>
              </div>
              <div>
                <dt>recovery</dt>
                <dd>
                  {workspace.recoveryCharacters.toLocaleString()} chars
                </dd>
              </div>
              <div>
                <dt>네트워크</dt>
                <dd>외부 요청 차단</dd>
              </div>
              <div>
                <dt>history 상태</dt>
                <dd title="Typie가 authoritative stack query를 제공하지 않음">
                  최근 명령 기반 추정
                </dd>
              </div>
            </dl>
            <button
              type="button"
              className="quiet-button"
              disabled={!hasDocument}
              onClick={() => void controller?.checkPlainTextRecovery()}
            >
              plain text 복구 사본 확인
            </button>
            {workspace.errorMessage && (
              <p className="error-message" role="alert">
                {workspace.errorMessage}
              </p>
            )}
            <p className="privacy-note">
              원고 본문은 이 패널이나 console 로그에 표시하지 않습니다.
            </p>
          </aside>
        )}
        </div>
      </section>

      <footer className="statusbar">
        <span>{workspace.session?.fileName ?? "열린 프로젝트 없음"}</span>
        {workspace.session && (
          <span aria-label="현재 장면 글자 수">
            현재 장면 · 공백 포함 {currentSceneStatistics?.withSpaces ?? 0}자 ·
            공백 제외 {currentSceneStatistics?.withoutSpaces ?? 0}자
          </span>
        )}
        {workspace.session && textStatistics && (
          <span aria-label="현재 선택 범위 글자 수">
            선택 범위 · 장면 {textStatistics.sceneCount}개 · 공백 포함{" "}
            {textStatistics.withSpaces}자 · 공백 제외{" "}
            {textStatistics.withoutSpaces}자
          </span>
        )}
        <span>
          {isComposing ? "IME composing" : "IME idle"} · local only
        </span>
      </footer>
    </main>
  );
}
