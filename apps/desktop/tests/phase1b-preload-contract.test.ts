import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent
} from "electron";
import { describe, expect, it, vi } from "vitest";
import { registerMadiIpc } from "../src/main/ipc";
import type { DesktopService } from "../src/main/desktopService";
import { createMadiDesktopApi } from "../src/preload/bridge";
import {
  ALLOWED_IPC_CHANNELS,
  IPC_CHANNELS
} from "../src/shared/contracts";

describe("Phase 1B preload and IPC capabilities", () => {
  it("exposes every Phase 1B operation through one fixed allowlisted channel", async () => {
    const calls: Array<{
      readonly channel: string;
      readonly request: unknown;
    }> = [];
    const invoke = vi.fn(
      async (channel: string, request?: unknown): Promise<unknown> => {
        calls.push({ channel, request });
        return undefined;
      }
    );
    const api = createMadiDesktopApi(invoke);
    const sessionId = "session-id";

    await api.listDescendantScenes({ sessionId, scopeNodeId: "work-id" });
    await api.searchProject({
      sessionId,
      query: "용",
      caseSensitive: false,
      target: "ALL",
      scopeNodeId: "chapter-id"
    });
    await api.getTextStatistics({ sessionId, scopeNodeId: "chapter-id" });
    await api.createNamedSnapshot({ sessionId, name: "퇴고 전", note: "메모" });
    await api.listNamedSnapshots({ sessionId });
    await api.renameNamedSnapshot({
      sessionId,
      snapshotId: "snapshot-id",
      name: "새 이름"
    });
    await api.deleteNamedSnapshot({ sessionId, snapshotId: "snapshot-id" });
    await api.diffNamedSnapshot({ sessionId, snapshotId: "snapshot-id" });
    await api.restoreNamedSnapshot({
      sessionId,
      snapshotId: "snapshot-id",
      autoSnapshotName: "복원 직전"
    });

    expect(calls.map(({ channel }) => channel)).toEqual([
      IPC_CHANNELS.listDescendantScenes,
      IPC_CHANNELS.searchProject,
      IPC_CHANNELS.getTextStatistics,
      IPC_CHANNELS.createNamedSnapshot,
      IPC_CHANNELS.listNamedSnapshots,
      IPC_CHANNELS.renameNamedSnapshot,
      IPC_CHANNELS.deleteNamedSnapshot,
      IPC_CHANNELS.diffNamedSnapshot,
      IPC_CHANNELS.restoreNamedSnapshot
    ]);
    expect(new Set(ALLOWED_IPC_CHANNELS).size).toBe(
      Object.keys(IPC_CHANNELS).length
    );
    expect(ALLOWED_IPC_CHANNELS).toEqual(Object.values(IPC_CHANNELS));
    expect(Object.isFrozen(ALLOWED_IPC_CHANNELS)).toBe(true);
    expect("invoke" in api).toBe(false);
  });

  it("deep-copies every transformed Typie snapshot before crossing contextBridge", async () => {
    let bridgedRequest: unknown;
    const invoke = vi.fn(
      async (_channel: string, request: unknown): Promise<unknown> => {
        bridgedRequest = request;
        return {
          changedSceneIds: ["scene-1"],
          changedScenes: 1,
          changedOccurrences: 1,
          revision: 2
        };
      }
    );
    const api = createMadiDesktopApi(invoke);
    const original = Uint8Array.from([1, 2, 3]);

    await api.applyReplacementBatch({
      sessionId: "session-id",
      expectedRevision: 1,
      query: "용",
      replacement: "별",
      caseSensitive: false,
      transformedScenes: [
        {
          sceneId: "scene-1",
          documentId: "document-1",
          editorEngine: "typie",
          editorEngineCommit: "fixed-commit",
          editorSchemaVersion: 1,
          snapshot: original,
          plainTextRecovery: "별",
          occurrenceCount: 1,
          sourceContentHash: "b".repeat(64)
        }
      ]
    });

    const request = bridgedRequest as {
      readonly transformedScenes: readonly [{ readonly snapshot: Uint8Array }];
    };
    expect(request.transformedScenes[0].snapshot).toEqual(
      Uint8Array.from([1, 2, 3])
    );
    expect(request.transformedScenes[0].snapshot).not.toBe(original);
    original[0] = 99;
    expect(request.transformedScenes[0].snapshot[0]).toBe(1);
  });

  it("registers the complete allowlist and rejects malformed raw IPC payloads", async () => {
    type Handler = (
      event: IpcMainInvokeEvent,
      request?: unknown
    ) => Promise<unknown>;
    const handlers = new Map<string, Handler>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: Handler) => {
        handlers.set(channel, handler);
      }),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel))
    } as unknown as IpcMain;
    const frame = { url: "madi://app/index.html" };
    const webContents = { mainFrame: frame };
    const window = {
      isDestroyed: () => false,
      webContents
    } as unknown as BrowserWindow;
    const event = {
      sender: webContents,
      senderFrame: frame
    } as unknown as IpcMainInvokeEvent;
    const searchProject = vi.fn(async () => ({ hits: [] }));
    const service = { searchProject } as unknown as DesktopService;

    const dispose = registerMadiIpc({
      ipcMain,
      window,
      rendererUrl: "madi://app/index.html",
      service,
      appVersion: "0.0.1",
      onCloseReady: () => true
    });

    expect([...handlers.keys()].sort()).toEqual(
      [...ALLOWED_IPC_CHANNELS].sort()
    );
    const handler = handlers.get(IPC_CHANNELS.searchProject);
    if (!handler) {
      throw new Error("search handler was not registered");
    }
    const request = {
      sessionId: "session-id",
      query: "용",
      caseSensitive: false,
      target: "ALL"
    };
    await handler(event, request);
    expect(searchProject).toHaveBeenCalledWith(request);
    await expect(handler(event, null)).rejects.toThrow("Invalid request");
    await expect(handler(event, [])).rejects.toThrow("Invalid request");

    dispose();
    expect(handlers.size).toBe(0);
  });
});
