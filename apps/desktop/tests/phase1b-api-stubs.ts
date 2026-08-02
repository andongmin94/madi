import { vi } from "vitest";
import type { MadiDesktopApi } from "../src/shared/contracts";
import { phase1cApiStubs, type Phase1cApi } from "./phase1c-api-stubs";

type Phase1bApi = Pick<
  MadiDesktopApi,
  | "listDescendantScenes"
  | "searchProject"
  | "getTextStatistics"
  | "applyReplacementBatch"
  | "createNamedSnapshot"
  | "listNamedSnapshots"
  | "renameNamedSnapshot"
  | "deleteNamedSnapshot"
  | "diffNamedSnapshot"
  | "restoreNamedSnapshot"
> & Phase1cApi;

export function phase1bApiStubs(): Phase1bApi {
  return {
    ...phase1cApiStubs(),
    listDescendantScenes: vi.fn(async (request) => ({
      scopeNodeId: request.scopeNodeId,
      scenes: [],
      totalScenes: 0,
      offset: request.offset ?? 0,
      limit: request.limit ?? 50,
      nextOffset: null,
      hasMore: false,
      revision: 0
    })),
    searchProject: vi.fn(async (request) => ({
      query: request.query,
      caseSensitive: request.caseSensitive,
      target: request.target,
      scopeNodeId: request.scopeNodeId ?? "project",
      totalMatches: 0,
      sceneCount: 0,
      offset: request.offset ?? 0,
      limit: request.limit ?? 100,
      hasMore: false,
      hits: [],
      revision: 0
    })),
    getTextStatistics: vi.fn(async (request) => ({
      scopeNodeId: request.scopeNodeId,
      sceneCount: 0,
      withSpaces: 0,
      withoutSpaces: 0,
      scenes: [],
      revision: 0
    })),
    applyReplacementBatch: vi.fn(async () => {
      throw new Error("not used");
    }),
    createNamedSnapshot: vi.fn(async () => {
      throw new Error("not used");
    }),
    listNamedSnapshots: vi.fn(async () => ({
      snapshots: [],
      revision: 0
    })),
    renameNamedSnapshot: vi.fn(async () => {
      throw new Error("not used");
    }),
    deleteNamedSnapshot: vi.fn(async (request) => ({
      deletedSnapshotId: request.snapshotId,
      revision: 0
    })),
    diffNamedSnapshot: vi.fn(async () => {
      throw new Error("not used");
    }),
    restoreNamedSnapshot: vi.fn(async () => {
      throw new Error("not used");
    })
  };
}
