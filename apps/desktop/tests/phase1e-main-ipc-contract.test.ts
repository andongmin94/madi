import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent
} from "electron";
import { describe, expect, it, vi } from "vitest";
import type { DesktopService } from "../src/main/desktopService";
import { registerMadiIpc } from "../src/main/ipc";
import {
  ALLOWED_IPC_CHANNELS,
  IPC_CHANNELS
} from "../src/shared/contracts";

type Handler = (
  event: IpcMainInvokeEvent,
  request?: unknown
) => Promise<unknown>;

function createTrustedIpcHarness(service: DesktopService) {
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
  const dispose = registerMadiIpc({
    ipcMain,
    window,
    rendererUrl: "madi://app/index.html",
    service,
    appVersion: "0.0.1",
    onCloseReady: () => true
  });
  return { dispose, event, handlers };
}

describe("Phase 1E main Canvas IPC capabilities", () => {
  it("registers all eleven handlers and passes each bounded request/result through", async () => {
    const results = {
      list: { canvases: [], revision: 2 },
      create: { canvas: { id: "canvas-1" }, revision: 3, noOp: false },
      update: { canvas: { id: "canvas-1" }, revision: 4, noOp: false },
      duplicate: { canvas: { id: "canvas-2" }, revision: 5, noOp: false },
      delete: { deletedCanvasId: "canvas-1", revision: 6 },
      load: { id: "canvas-1", document: { nodes: [], edges: [] } },
      save: {
        canvas: { id: "canvas-1" },
        canvasId: "canvas-1",
        revision: 7,
        generation: 2,
        saveSequence: 4,
        noOp: false
      },
      loadUi: { state: null },
      pick: { fileName: "outline.canvas", source: "{\"nodes\":[],\"edges\":[]}" },
      export: { fileName: "outline.canvas", bytes: 24 }
    };
    const methods = {
      listCanvases: vi.fn(async () => results.list),
      createCanvas: vi.fn(async () => results.create),
      updateCanvas: vi.fn(async () => results.update),
      duplicateCanvas: vi.fn(async () => results.duplicate),
      deleteCanvas: vi.fn(async () => results.delete),
      loadCanvas: vi.fn(async () => results.load),
      saveCanvas: vi.fn(async () => results.save),
      savePlotCanvasUiState: vi.fn(async () => undefined),
      loadPlotCanvasUiState: vi.fn(async () => results.loadUi),
      pickCanvasImport: vi.fn(async () => results.pick),
      exportCanvas: vi.fn(async () => results.export)
    };
    const harness = createTrustedIpcHarness(
      methods as unknown as DesktopService
    );
    const sessionId = "session-1";
    const cases = [
      {
        channel: IPC_CHANNELS.listCanvases,
        method: methods.listCanvases,
        request: { sessionId, sort: "UPDATED_DESC" },
        result: results.list
      },
      {
        channel: IPC_CHANNELS.createCanvas,
        method: methods.createCanvas,
        request: { sessionId, name: "전체 플롯" },
        result: results.create
      },
      {
        channel: IPC_CHANNELS.updateCanvas,
        method: methods.updateCanvas,
        request: {
          sessionId,
          canvasId: "canvas-1",
          name: "1부 플롯",
          description: null,
          expectedCanvasRevision: 2
        },
        result: results.update
      },
      {
        channel: IPC_CHANNELS.duplicateCanvas,
        method: methods.duplicateCanvas,
        request: { sessionId, sourceCanvasId: "canvas-1" },
        result: results.duplicate
      },
      {
        channel: IPC_CHANNELS.deleteCanvas,
        method: methods.deleteCanvas,
        request: {
          sessionId,
          canvasId: "canvas-1",
          expectedCanvasRevision: 2
        },
        result: results.delete
      },
      {
        channel: IPC_CHANNELS.loadCanvas,
        method: methods.loadCanvas,
        request: { sessionId, canvasId: "canvas-1" },
        result: results.load
      },
      {
        channel: IPC_CHANNELS.saveCanvas,
        method: methods.saveCanvas,
        request: {
          sessionId,
          canvasId: "canvas-1",
          expectedCanvasRevision: 2,
          generation: 2,
          saveSequence: 4,
          document: { nodes: [], edges: [] }
        },
        result: results.save
      },
      {
        channel: IPC_CHANNELS.savePlotCanvasUiState,
        method: methods.savePlotCanvasUiState,
        request: {
          sessionId,
          state: { lastCanvasId: "canvas-1", canvasStates: {} }
        },
        result: undefined
      },
      {
        channel: IPC_CHANNELS.loadPlotCanvasUiState,
        method: methods.loadPlotCanvasUiState,
        request: { sessionId },
        result: results.loadUi
      },
      {
        channel: IPC_CHANNELS.exportCanvas,
        method: methods.exportCanvas,
        request: {
          sessionId,
          canvasId: "canvas-1",
          suggestedFileName: "outline.canvas"
        },
        result: results.export
      }
    ];

    for (const item of cases) {
      const handler = harness.handlers.get(item.channel);
      if (!handler) {
        throw new Error(`missing Canvas IPC handler ${item.channel}`);
      }
      await expect(handler(harness.event, item.request)).resolves.toBe(
        item.result
      );
      expect(item.method).toHaveBeenLastCalledWith(item.request);
    }
    const pickHandler = harness.handlers.get(IPC_CHANNELS.pickCanvasImport);
    if (!pickHandler) {
      throw new Error("missing Canvas import picker handler");
    }
    await expect(pickHandler(harness.event)).resolves.toBe(results.pick);
    expect(methods.pickCanvasImport).toHaveBeenCalledWith();

    expect([...harness.handlers.keys()].sort()).toEqual(
      [...ALLOWED_IPC_CHANNELS].sort()
    );
    const createHandler = harness.handlers.get(IPC_CHANNELS.createCanvas)!;
    await expect(createHandler(harness.event, null)).rejects.toThrow(
      "Invalid request"
    );
    await expect(createHandler(harness.event, [])).rejects.toThrow(
      "Invalid request"
    );

    harness.dispose();
    expect(harness.handlers.size).toBe(0);
  });

  it("does not register a generic Canvas filesystem, path, SQL, or shell channel", () => {
    const methods = {
      listCanvases: vi.fn(),
      createCanvas: vi.fn(),
      updateCanvas: vi.fn(),
      duplicateCanvas: vi.fn(),
      deleteCanvas: vi.fn(),
      loadCanvas: vi.fn(),
      saveCanvas: vi.fn(),
      savePlotCanvasUiState: vi.fn(),
      loadPlotCanvasUiState: vi.fn(),
      pickCanvasImport: vi.fn(),
      exportCanvas: vi.fn()
    };
    const harness = createTrustedIpcHarness(
      methods as unknown as DesktopService
    );
    const channelNames = [...harness.handlers.keys()].join(" ");

    expect(channelNames).not.toMatch(
      /read-file|write-file|open-path|resolve-path|execute-sql|generic-rpc|shell/u
    );
    expect(Object.keys(methods)).not.toEqual(
      expect.arrayContaining([
        "readFile",
        "writeFile",
        "openPath",
        "resolvePath",
        "executeSql",
        "invoke",
        "shell"
      ])
    );
    harness.dispose();
  });

  it("adds only finite clone timing to lazy Graph DTOs without logging payloads", async () => {
    const requestSecret = "private-session-and-entity-id";
    const responseSecret = "private manuscript mention and relation note";
    const results = {
      mentions: {
        entityId: requestSecret,
        candidates: [
          {
            occurrenceId: "mention-1",
            entityId: requestSecret,
            sceneNodeId: "scene-1",
            documentId: "document-1",
            sceneTitle: "비공개 장면",
            matchedAlias: "비공개 별칭",
            start: 4,
            end: 8,
            contextBefore: responseSecret,
            matchedText: "비공개 본문",
            contextAfter: "후속 문맥",
            alreadyLinked: false
          }
        ],
        totalScenes: 1,
        offset: 0,
        limit: 100,
        hasMore: false,
        revision: 7
      },
      detail: {
        projectId: "project-1",
        revision: 7,
        entity: {
          id: requestSecret,
          projectId: "project-1",
          label: "비공개 설정",
          kind: "CHARACTER",
          status: "ACTIVE",
          summary: responseSecret,
          colorToken: null,
          iconKey: null,
          aliases: [],
          tags: [],
          explicitSceneLinkCount: 0,
          outgoingRelationCount: 0,
          incomingRelationCount: 0,
          undirectedRelationCount: 0
        },
        outgoingRelations: [],
        incomingRelations: [],
        undirectedRelations: []
      },
      sceneContext: {
        projectId: "project-1",
        revision: 7,
        entityId: requestSecret,
        links: [
          {
            sceneNodeId: "scene-1",
            sceneTitle: "비공개 장면",
            role: "APPEARS",
            note: responseSecret
          }
        ]
      }
    };
    const methods = {
      discoverEntityMentions: vi.fn(async () => results.mentions),
      getEntityGraphDetail: vi.fn(async () => results.detail),
      getEntitySceneContext: vi.fn(async () => results.sceneContext)
    };
    const harness = createTrustedIpcHarness(
      methods as unknown as DesktopService
    );
    const consoleSpies = [
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "trace").mockImplementation(() => undefined)
    ];
    const cases = [
      {
        channel: IPC_CHANNELS.discoverEntityMentions,
        method: methods.discoverEntityMentions,
        request: {
          sessionId: requestSecret,
          entityId: requestSecret,
          offset: 0,
          limit: 100
        },
        serviceResult: results.mentions
      },
      {
        channel: IPC_CHANNELS.getEntityGraphDetail,
        method: methods.getEntityGraphDetail,
        request: { sessionId: requestSecret, entityId: requestSecret },
        serviceResult: results.detail
      },
      {
        channel: IPC_CHANNELS.getEntitySceneContext,
        method: methods.getEntitySceneContext,
        request: { sessionId: requestSecret, entityId: requestSecret },
        serviceResult: results.sceneContext
      }
    ];

    for (const item of cases) {
      const handler = harness.handlers.get(item.channel);
      if (!handler) {
        throw new Error(`missing lazy Graph IPC handler ${item.channel}`);
      }
      const value = (await handler(
        harness.event,
        item.request
      )) as Record<string, unknown>;
      const { ipcSerializeDeserializeMs, ...serviceDto } = value;

      expect(item.method).toHaveBeenLastCalledWith(item.request);
      expect(serviceDto).toEqual(item.serviceResult);
      expect(Object.keys(value).sort()).toEqual(
        [...Object.keys(item.serviceResult), "ipcSerializeDeserializeMs"].sort()
      );
      expect(ipcSerializeDeserializeMs).toEqual(expect.any(Number));
      expect(Number.isFinite(ipcSerializeDeserializeMs)).toBe(true);
      expect(ipcSerializeDeserializeMs).toBeGreaterThanOrEqual(0);
      expect(item.serviceResult).not.toHaveProperty("ipcSerializeDeserializeMs");
    }

    const serializedConsoleCalls = JSON.stringify(
      consoleSpies.flatMap((spy) => spy.mock.calls)
    );
    expect(serializedConsoleCalls).not.toContain(requestSecret);
    expect(serializedConsoleCalls).not.toContain(responseSecret);
    expect([...harness.handlers.keys()].sort()).toEqual(
      [...ALLOWED_IPC_CHANNELS].sort()
    );
    harness.dispose();
    expect(harness.handlers.size).toBe(0);
  });
});
