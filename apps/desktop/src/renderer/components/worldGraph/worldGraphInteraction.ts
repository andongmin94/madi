import type {
  WorldGraphEntityDetailView,
  WorldGraphSceneContextView
} from "./types";

/**
 * Numeric-only samples. Callers may retain these in memory for median/max
 * summaries, but must not attach entity names, notes, manuscript text, or IDs.
 * RPC timings cover the renderer callback boundary, including the IPC work that
 * is observable from the renderer. Main/preload may add a narrower
 * ipcSerializeDeserializeMs measurement when available.
 */
export interface WorldGraphPerformanceSample {
  readonly filterMs?: number;
  readonly bfsMs?: number;
  readonly searchClickHandlerMs?: number;
  readonly searchFocusMs?: number;
  readonly reactSelectionCommitMs?: number;
  readonly cytoscapeNodeLookupMs?: number;
  readonly nodeFocusAnimationStartMs?: number;
  readonly neighborHighlightMs?: number;
  readonly detailShellRenderMs?: number;
  readonly entityDetailRpcMs?: number;
  readonly sceneContextRpcMs?: number;
  readonly mentionDiscoveryRpcMs?: number;
  readonly ipcSerializeDeserializeMs?: number;
  readonly lazyRpcRoundTripMs?: number;
  readonly reactDetailCommitMs?: number;
  readonly fullLazyDetailMs?: number;
  /** 1 for a cache hit and 0 for a loader request; numeric for aggregation. */
  readonly detailCacheHit?: 0 | 1;
  readonly elementConversionMs?: number;
  readonly layoutMs?: number;
  readonly displayMs?: number;
}

export interface WorldGraphDetailIdentity {
  readonly projectId: string;
  readonly projectRevision: number;
  readonly entityId: string;
}

export interface WorldGraphDetailBundle {
  readonly detail: WorldGraphEntityDetailView;
  readonly sceneContext: WorldGraphSceneContextView;
  readonly mentionCount: number;
}

export interface WorldGraphDetailLoaders {
  readonly detail: () =>
    | WorldGraphEntityDetailView
    | Promise<WorldGraphEntityDetailView>;
  readonly sceneContext: () =>
    | WorldGraphSceneContextView
    | Promise<WorldGraphSceneContextView>;
  readonly mentionCount: () => number | Promise<number>;
}

export interface WorldGraphDetailLoadResult {
  readonly bundle: WorldGraphDetailBundle;
  readonly timing: Pick<
    WorldGraphPerformanceSample,
    | "entityDetailRpcMs"
    | "sceneContextRpcMs"
    | "mentionDiscoveryRpcMs"
    | "lazyRpcRoundTripMs"
  >;
}

export class StaleWorldGraphDetailError extends Error {
  constructor() {
    super("오래된 그래프 상세 응답을 버렸습니다. 그래프를 새로 고쳐 주세요.");
    this.name = "StaleWorldGraphDetailError";
  }
}

interface CachedWorldGraphDetail {
  readonly identity: WorldGraphDetailIdentity;
  readonly bundle: WorldGraphDetailBundle;
}

function cacheKey(identity: WorldGraphDetailIdentity): string {
  return JSON.stringify([
    identity.projectId,
    identity.projectRevision,
    identity.entityId
  ]);
}

/** Session-local cache. Activating a new canonical revision drops older data. */
export class WorldGraphDetailCache {
  readonly #entries = new Map<string, CachedWorldGraphDetail>();
  readonly #activeRevisionByProject = new Map<string, number>();

  activate(projectId: string, projectRevision: number): void {
    const activeRevision = this.#activeRevisionByProject.get(projectId);
    if (activeRevision === projectRevision) {
      return;
    }
    this.#activeRevisionByProject.set(projectId, projectRevision);
    for (const [key, entry] of this.#entries) {
      if (
        entry.identity.projectId === projectId &&
        entry.identity.projectRevision !== projectRevision
      ) {
        this.#entries.delete(key);
      }
    }
  }

  get(identity: WorldGraphDetailIdentity): WorldGraphDetailBundle | null {
    this.activate(identity.projectId, identity.projectRevision);
    return this.#entries.get(cacheKey(identity))?.bundle ?? null;
  }

  set(
    identity: WorldGraphDetailIdentity,
    bundle: WorldGraphDetailBundle
  ): void {
    this.activate(identity.projectId, identity.projectRevision);
    this.#entries.set(cacheKey(identity), { identity, bundle });
  }

  get size(): number {
    return this.#entries.size;
  }
}

function validateBundle(
  identity: WorldGraphDetailIdentity,
  bundle: WorldGraphDetailBundle
): void {
  if (
    bundle.detail.projectId !== identity.projectId ||
    bundle.sceneContext.projectId !== identity.projectId ||
    bundle.detail.revision !== identity.projectRevision ||
    bundle.sceneContext.revision !== identity.projectRevision ||
    bundle.detail.entity.id !== identity.entityId ||
    bundle.sceneContext.entityId !== identity.entityId
  ) {
    throw new StaleWorldGraphDetailError();
  }
}

async function timed<T>(
  operation: () => T | Promise<T>
): Promise<{ readonly value: T; readonly durationMs: number }> {
  const startedAt = performance.now();
  const value = await operation();
  return { value, durationMs: performance.now() - startedAt };
}

/** Starts all independent reads before awaiting any one of them. */
export async function loadWorldGraphDetailBundle(
  identity: WorldGraphDetailIdentity,
  loaders: WorldGraphDetailLoaders
): Promise<WorldGraphDetailLoadResult> {
  const startedAt = performance.now();
  const [detail, sceneContext, mentionCount] = await Promise.all([
    timed(loaders.detail),
    timed(loaders.sceneContext),
    timed(loaders.mentionCount)
  ]);
  const bundle: WorldGraphDetailBundle = {
    detail: detail.value,
    sceneContext: sceneContext.value,
    mentionCount: mentionCount.value
  };
  validateBundle(identity, bundle);
  return {
    bundle,
    timing: {
      entityDetailRpcMs: detail.durationMs,
      sceneContextRpcMs: sceneContext.durationMs,
      mentionDiscoveryRpcMs: mentionCount.durationMs,
      lazyRpcRoundTripMs: performance.now() - startedAt
    }
  };
}
