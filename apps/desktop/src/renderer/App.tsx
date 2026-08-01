import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import type { MadiDesktopApi } from "../shared/contracts";
import type { ProjectTree } from "../shared/contracts";
import type { MadiEditorAdapterFactory } from "./editor/MadiEditorAdapter";
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
import {
  DocumentSessionController,
  type WorkspaceState
} from "./workspace/DocumentSessionController";
import { buildBinderTree } from "./workspace/binderTree";

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
type Panel = "development" | "ime";
const AUTOSAVE_DELAY_MS = 550;

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
  const [binderWidth, setBinderWidth] = useState(300);
  const [treeError, setTreeError] = useState("");
  const [uiStateReady, setUiStateReady] = useState(false);
  const [panel, setPanel] = useState<Panel>("development");
  const [lastCompositionEvent, setLastCompositionEvent] =
    useState<CompositionEventSummary | null>(null);
  const [compositionEventActive, setCompositionEventActive] =
    useState<boolean | null>(null);
  const closeAttemptRef = useRef<Promise<void> | null>(null);
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
      setUiStateReady(false);
      setProjectTree(null);
      setSelectedNodeId(null);
      setCollapsedNodeIds(new Set());
      setTreeError("");
      return;
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
        if (storedUi.state) {
          setBinderWidth(
            Math.min(640, Math.max(220, storedUi.state.binderWidth))
          );
        }
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
    return api.onCloseRequested(() => {
      if (!closeAttemptRef.current) {
        closeAttemptRef.current = Promise.resolve(
          controller?.flushPendingChanges(
            () => compositionActiveRef.current
          ) ?? true
        )
          .then(async (documentReady) => {
            let readyToClose = documentReady;
            if (
              readyToClose &&
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
    } else if (!(await flushBeforeStructureChange())) {
      return;
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
          setSelectedNodeId(created.id);
        }
      } else if (created) {
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
      setProjectTree(
        await api.renameNode({ sessionId: session.sessionId, nodeId, title })
      );
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
      setProjectTree(next);
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
          setSelectedNodeId(switched ? fallback.id : null);
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
      setProjectTree(
        await api.reorderNode({
          sessionId: session.sessionId,
          nodeId,
          direction
        })
      );
      setTreeError("");
    } catch (error) {
      setTreeError(
        error instanceof Error ? error.message : "순서 변경 실패"
      );
    }
  };

  const hasDocument =
    enginePhase === "ready" &&
    !!workspace.session?.documentId &&
    !!workspace.activeSceneId &&
    (!selectedNode || selectedNode.kind === "SCENE");
  const busy =
    workspace.savePhase === "saving" ||
    workspace.savePhase === "restoring";

  return (
    <main className="app-shell">
      <header className="titlebar">
        <div className="wordmark" aria-label="madi">
          madi
          <span>phase 1A</span>
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
        <div className="panel-switch" role="group" aria-label="검증 패널">
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
              selectedNodeId={selectedNodeId}
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
              <span>{selectedScene ? "현재 장면" : "선택한 항목"}</span>
              <strong>{selectedNode?.title ?? "장면을 선택하세요"}</strong>
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
              hasDocument ? "" : " typie-editor-mount--inactive"
            }`}
            aria-label="Typie WASM editor mount"
            aria-hidden={!hasDocument}
            inert={hasDocument ? undefined : true}
            onMouseDown={() => hasDocument && controller?.focus()}
          />
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
          {enginePhase === "ready" && workspace.session && selectedNode && !selectedScene && (
            <div className="empty-document non-scene-selection">
              <strong>{selectedNode.title}</strong>
              <span>본문을 편집하려면 Binder에서 장면을 선택하세요.</span>
            </div>
          )}
          {enginePhase === "ready" && hasDocument && workspace.recoveryCharacters === 0 && (
            <div className="empty-scene-hint">빈 장면입니다. 여기에 본문을 입력하세요.</div>
          )}
        </section>

        <div className="inspector-drawer">
        {panel === "ime" && imeEnvironment ? (
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
        <span>
          {isComposing ? "IME composing" : "IME idle"} · local only
        </span>
      </footer>
    </main>
  );
}
