import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from "react";
import type { ProjectTree } from "../../shared/contracts";
import {
  calculateScriveningsStats,
  orderedDescendantScenes,
  sceneTrailNode,
  splitHighlightSegments,
  type ScriveningsScene,
  type ScriveningsScenePreview
} from "../workspace/scrivenings";

export interface ScriveningsActivationRequest {
  readonly fromSceneId: string | null;
  readonly fromDocumentId: string | null;
  readonly toSceneId: string;
  readonly toDocumentId: string;
  readonly reason: "BODY" | "TITLE";
}

export interface ScriveningsSceneTitleRequest {
  readonly sceneId: string;
  readonly documentId: string;
}

export interface ScriveningsDeactivationRequest {
  readonly sceneId: string;
  readonly documentId: string;
}

export interface ScriveningsViewProps {
  readonly projectTree: ProjectTree;
  readonly selectedNodeId: string;
  readonly scenePreviews: readonly ScriveningsScenePreview[];
  /** Supplying this prop makes active-scene state controlled. */
  readonly activeSceneId?: string | null;
  readonly defaultActiveSceneId?: string | null;
  /**
   * Must settle IME composition and save the current scene before resolving.
   * Rejecting keeps the current live editor mounted and exposes an error.
   */
  readonly onActivateScene: (
    request: ScriveningsActivationRequest
  ) => Promise<void>;
  readonly onActiveSceneChange?: (sceneId: string | null) => void;
  readonly onSceneTitleClick?: (
    request: ScriveningsSceneTitleRequest
  ) => void;
  /** Rejecting has the same keep-current-editor behavior as activation. */
  readonly onDeactivateScene?: (
    request: ScriveningsDeactivationRequest
  ) => Promise<void>;
  readonly onActivationError?: (
    error: unknown,
    request: ScriveningsActivationRequest | ScriveningsDeactivationRequest
  ) => void;
  readonly renderLiveEditor?: (scene: ScriveningsScene) => ReactNode;
  readonly searchQuery?: string;
  readonly searchCaseSensitive?: boolean;
  readonly windowOverscan?: number;
  readonly initialHeavySceneCount?: number;
  readonly className?: string;
}

interface HighlightedTextProps {
  readonly value: string;
  readonly query: string;
  readonly caseSensitive: boolean;
}

function HighlightedText({
  value,
  query,
  caseSensitive
}: HighlightedTextProps) {
  return splitHighlightSegments(value, query, caseSensitive).map(
    (segment, index) =>
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

interface ReadOnlySceneBodyProps {
  readonly scene: ScriveningsScene;
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly onActivate: () => void;
  readonly pending: boolean;
}

function keyboardActivation(
  event: KeyboardEvent<HTMLDivElement>,
  activate: () => void
): void {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    activate();
  }
}

function ReadOnlySceneBody({
  scene,
  query,
  caseSensitive,
  onActivate,
  pending
}: ReadOnlySceneBodyProps) {
  const preview = scene.preview;
  if (!preview) {
    return (
      <div className="scrivenings__preview scrivenings__preview--loading">
        본문 미리보기를 불러오는 중입니다.
      </div>
    );
  }

  const content = preview.blocks?.length ? (
    preview.blocks.map((block, index) =>
      block.kind === "SCENE_BREAK" ? (
        <div
          key={`break-${index}`}
          className="scrivenings__scene-break"
          role="separator"
          aria-label="장면 구분"
        >
          * * *
        </div>
      ) : (
        <p key={`paragraph-${index}`}>
          <HighlightedText
            value={block.text}
            query={query}
            caseSensitive={caseSensitive}
          />
        </p>
      )
    )
  ) : preview.plainTextRecovery ? (
    <p style={{ whiteSpace: "pre-wrap" }}>
      <HighlightedText
        value={preview.plainTextRecovery}
        query={query}
        caseSensitive={caseSensitive}
      />
    </p>
  ) : (
    <p className="scrivenings__empty-scene">빈 장면</p>
  );

  return (
    <div
      className="scrivenings__preview"
      role="button"
      tabIndex={pending ? -1 : 0}
      aria-label={`${scene.title || "새 장면"} 장면 편집`}
      aria-disabled={pending}
      onClick={pending ? undefined : onActivate}
      onKeyDown={(event) => {
        if (!pending) {
          keyboardActivation(event, onActivate);
        }
      }}
    >
      {content}
    </div>
  );
}

function activationErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "장면을 전환하지 못했습니다.";
}

export function ScriveningsView({
  projectTree,
  selectedNodeId,
  scenePreviews,
  activeSceneId: controlledActiveSceneId,
  defaultActiveSceneId = null,
  onActivateScene,
  onActiveSceneChange,
  onSceneTitleClick,
  onDeactivateScene,
  onActivationError,
  renderLiveEditor,
  searchQuery = "",
  searchCaseSensitive = false,
  windowOverscan = 2,
  initialHeavySceneCount = 6,
  className
}: ScriveningsViewProps) {
  const scenes = useMemo(
    () =>
      orderedDescendantScenes(
        projectTree,
        selectedNodeId,
        scenePreviews
      ),
    [projectTree, scenePreviews, selectedNodeId]
  );
  const stats = useMemo(() => calculateScriveningsStats(scenes), [scenes]);
  const [internalActiveSceneId, setInternalActiveSceneId] = useState<
    string | null
  >(defaultActiveSceneId);
  const controlled = controlledActiveSceneId !== undefined;
  const activeSceneId = controlled
    ? controlledActiveSceneId
    : internalActiveSceneId;
  const activeScene =
    scenes.find((scene) => scene.sceneId === activeSceneId) ?? null;
  const [pendingSceneId, setPendingSceneId] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const [activationError, setActivationError] = useState<string | null>(null);
  const blockRefs = useRef(new Map<string, HTMLElement>());
  const [nearbySceneIds, setNearbySceneIds] = useState<ReadonlySet<string>>(
    new Set()
  );

  useEffect(() => {
    if (!controlled && activeSceneId && !activeScene) {
      setInternalActiveSceneId(null);
      onActiveSceneChange?.(null);
    }
  }, [activeScene, activeSceneId, controlled, onActiveSceneChange]);

  const commitActiveScene = useCallback(
    (sceneId: string | null) => {
      if (!controlled) {
        setInternalActiveSceneId(sceneId);
      }
      onActiveSceneChange?.(sceneId);
    },
    [controlled, onActiveSceneChange]
  );

  const requestActivation = useCallback(
    async (scene: ScriveningsScene, reason: "BODY" | "TITLE") => {
      if (scene.sceneId === activeSceneId || pendingRef.current) {
        return;
      }
      const request: ScriveningsActivationRequest = {
        fromSceneId: activeScene?.sceneId ?? null,
        fromDocumentId: activeScene?.documentId ?? null,
        toSceneId: scene.sceneId,
        toDocumentId: scene.documentId,
        reason
      };
      pendingRef.current = true;
      setPendingSceneId(scene.sceneId);
      setActivationError(null);
      try {
        await onActivateScene(request);
        commitActiveScene(scene.sceneId);
      } catch (error) {
        setActivationError(activationErrorMessage(error));
        onActivationError?.(error, request);
      } finally {
        pendingRef.current = false;
        setPendingSceneId(null);
      }
    },
    [
      activeScene,
      activeSceneId,
      commitActiveScene,
      onActivateScene,
      onActivationError
    ]
  );

  const requestDeactivation = useCallback(async () => {
    if (!activeScene || !onDeactivateScene || pendingRef.current) {
      return;
    }
    const request: ScriveningsDeactivationRequest = {
      sceneId: activeScene.sceneId,
      documentId: activeScene.documentId
    };
    pendingRef.current = true;
    setPendingSceneId(activeScene.sceneId);
    setActivationError(null);
    try {
      await onDeactivateScene(request);
      commitActiveScene(null);
    } catch (error) {
      setActivationError(activationErrorMessage(error));
      onActivationError?.(error, request);
    } finally {
      pendingRef.current = false;
      setPendingSceneId(null);
    }
  }, [
    activeScene,
    commitActiveScene,
    onActivationError,
    onDeactivateScene
  ]);

  useEffect(() => {
    const Observer = window.IntersectionObserver;
    if (!Observer) {
      return;
    }
    const observer = new Observer(
      (entries) => {
        setNearbySceneIds((current) => {
          const next = new Set(current);
          for (const entry of entries) {
            const sceneId = (entry.target as HTMLElement).dataset.sceneId;
            if (!sceneId) {
              continue;
            }
            if (entry.isIntersecting) {
              next.add(sceneId);
            } else {
              next.delete(sceneId);
            }
          }
          return next;
        });
      },
      // The browser viewport (and any clipping scroll ancestor) is a safer
      // visibility root than this section, which may grow to manuscript height.
      { root: null, rootMargin: "800px 0px" }
    );
    for (const block of blockRefs.current.values()) {
      observer.observe(block);
    }
    return () => observer.disconnect();
  }, [scenes]);

  const heavySceneIds = useMemo(() => {
    const result = new Set<string>();
    const anchors: number[] = [];
    scenes.forEach((scene, index) => {
      if (nearbySceneIds.has(scene.sceneId)) {
        anchors.push(index);
      }
    });
    if (anchors.length === 0) {
      for (
        let index = 0;
        index < Math.min(initialHeavySceneCount, scenes.length);
        index += 1
      ) {
        anchors.push(index);
      }
    }
    for (const anchor of anchors) {
      const start = Math.max(0, anchor - windowOverscan);
      const end = Math.min(scenes.length - 1, anchor + windowOverscan);
      for (let index = start; index <= end; index += 1) {
        const scene = scenes[index];
        if (scene) {
          result.add(scene.sceneId);
        }
      }
    }
    if (activeSceneId) {
      result.add(activeSceneId);
    }
    if (pendingSceneId) {
      result.add(pendingSceneId);
    }
    return result;
  }, [
    activeSceneId,
    initialHeavySceneCount,
    nearbySceneIds,
    pendingSceneId,
    scenes,
    windowOverscan
  ]);

  const selectedNode = projectTree.nodes.find(
    (node) => node.id === selectedNodeId
  );
  let previousVolumeId: string | null = null;
  let previousChapterId: string | null = null;

  return (
    <section
      className={["scrivenings", className].filter(Boolean).join(" ")}
      aria-label="연속 원고 보기"
      aria-busy={pendingSceneId !== null}
    >
      <header className="scrivenings__header">
        <h2>{selectedNode?.title || "연속 원고"}</h2>
        <output className="scrivenings__stats" aria-label="선택 범위 글자 수">
          장면 {stats.sceneCount}개 · 공백 포함 {stats.charactersWithSpaces}자 ·
          공백 제외 {stats.charactersWithoutSpaces}자
          {stats.loadedSceneCount < stats.sceneCount
            ? ` · 미리보기 ${stats.sceneCount - stats.loadedSceneCount}개 로딩 중`
            : ""}
        </output>
      </header>

      {activationError && <p role="alert">{activationError}</p>}
      {scenes.length === 0 && (
        <p className="scrivenings__empty">하위 장면이 없습니다.</p>
      )}

      <div className="scrivenings__manuscript">
        {scenes.map((scene) => {
          const volume = sceneTrailNode(scene, "VOLUME");
          const chapter = sceneTrailNode(scene, "CHAPTER");
          const showVolume = Boolean(volume && volume.id !== previousVolumeId);
          const showChapter = Boolean(
            chapter &&
              (chapter.id !== previousChapterId ||
                (volume?.id ?? null) !== previousVolumeId)
          );
          previousVolumeId = volume?.id ?? null;
          previousChapterId = chapter?.id ?? null;
          const active = activeSceneId === scene.sceneId;
          const heavy = heavySceneIds.has(scene.sceneId);
          const pending = pendingSceneId !== null;

          return (
            <div key={scene.sceneId}>
              {showVolume && volume && (
                <h3 data-volume-id={volume.id}>
                  <HighlightedText
                    value={volume.title}
                    query={searchQuery}
                    caseSensitive={searchCaseSensitive}
                  />
                </h3>
              )}
              {showChapter && chapter && (
                <h4 data-chapter-id={chapter.id}>
                  <HighlightedText
                    value={chapter.title}
                    query={searchQuery}
                    caseSensitive={searchCaseSensitive}
                  />
                </h4>
              )}
              <article
                ref={(element) => {
                  if (element) {
                    blockRefs.current.set(scene.sceneId, element);
                  } else {
                    blockRefs.current.delete(scene.sceneId);
                  }
                }}
                className={`scrivenings__scene${
                  active ? " scrivenings__scene--active" : ""
                }`}
                data-scene-id={scene.sceneId}
                data-active={active ? "true" : "false"}
                data-render-mode={active ? "live" : heavy ? "full" : "light"}
              >
                <header className="scrivenings__scene-header">
                  <h5>
                    <button
                      type="button"
                      aria-current={active ? "true" : undefined}
                      disabled={pending}
                      onClick={() => {
                        onSceneTitleClick?.({
                          sceneId: scene.sceneId,
                          documentId: scene.documentId
                        });
                        void requestActivation(scene, "TITLE");
                      }}
                    >
                      <HighlightedText
                        value={scene.title || "새 장면"}
                        query={searchQuery}
                        caseSensitive={searchCaseSensitive}
                      />
                    </button>
                  </h5>
                </header>

                {active ? (
                  <div
                    className="scrivenings__live-editor"
                    data-live-editor-slot={scene.sceneId}
                    aria-label={`${scene.title || "새 장면"} 편집기`}
                  >
                    {renderLiveEditor?.(scene) ?? (
                      <p>이 위치에 활성 장면 편집기를 연결하세요.</p>
                    )}
                    {onDeactivateScene && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => void requestDeactivation()}
                      >
                        읽기 모드로 전환
                      </button>
                    )}
                  </div>
                ) : heavy ? (
                  <ReadOnlySceneBody
                    scene={scene}
                    query={searchQuery}
                    caseSensitive={searchCaseSensitive}
                    pending={pending}
                    onActivate={() => void requestActivation(scene, "BODY")}
                  />
                ) : (
                  <div
                    className="scrivenings__preview scrivenings__preview--light"
                    data-lightweight-placeholder={scene.sceneId}
                    role="button"
                    tabIndex={pending ? -1 : 0}
                    aria-disabled={pending}
                    aria-label={`${scene.title || "새 장면"} 장면 편집`}
                    onClick={
                      pending
                        ? undefined
                        : () => void requestActivation(scene, "BODY")
                    }
                    onKeyDown={(event) => {
                      if (!pending) {
                        keyboardActivation(event, () =>
                          void requestActivation(scene, "BODY")
                        );
                      }
                    }}
                  >
                    {scene.preview
                      ? `${Array.from(scene.preview.plainTextRecovery).length}자 미리보기`
                      : "본문 미리보기 로딩 중"}
                  </div>
                )}
              </article>
            </div>
          );
        })}
      </div>
    </section>
  );
}
