import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent
} from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  CORE_METHODS,
  coreRequestTimeoutMs
} from "../src/main/coreClient";
import type { DesktopService } from "../src/main/desktopService";
import { registerMadiIpc } from "../src/main/ipc";
import { ALLOWED_IPC_CHANNELS, IPC_CHANNELS } from "../src/shared/contracts";

type Handler = (
  event: IpcMainInvokeEvent,
  request?: unknown
) => Promise<unknown>;

function createTrustedIpcHarness(service: DesktopService) {
  const handlers = new Map<string, Handler>();
  const ipcMain = {
    handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler)),
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

describe("Phase 1F main Reader Lab IPC capabilities", () => {
  it("extends only bounded Publication work beyond the default RPC timeout", () => {
    expect(coreRequestTimeoutMs("compile_publication")).toBe(300_000);
    expect(coreRequestTimeoutMs("get_publication_stats")).toBe(300_000);
    expect(coreRequestTimeoutMs("validate_publication")).toBe(300_000);
    expect(coreRequestTimeoutMs("save_document")).toBe(30_000);
    expect(
      CORE_METHODS.filter((method) => coreRequestTimeoutMs(method) === 300_000)
    ).toEqual([
      "compile_publication",
      "get_publication_stats",
      "validate_publication"
    ]);
  });

  it("registers and authorizes only the ten fixed Reader handlers", async () => {
    const methods = {
      saveReaderLabUiState: vi.fn(async () => undefined),
      loadReaderLabUiState: vi.fn(async () => ({ state: null })),
      compilePublication: vi.fn(async () => ({ kind: "compile" })),
      getPublicationStats: vi.fn(async () => ({ kind: "stats" })),
      validatePublication: vi.fn(async () => ({ kind: "validate" })),
      listReaderPresets: vi.fn(async () => ({ presets: [], duplicateNames: [], revision: 1 })),
      createReaderPreset: vi.fn(async () => ({ kind: "create" })),
      updateReaderPreset: vi.fn(async () => ({ kind: "update" })),
      duplicateReaderPreset: vi.fn(async () => ({ kind: "duplicate" })),
      deleteReaderPreset: vi.fn(async () => ({ deletedPresetId: "preset-1", revision: 2 }))
    };
    const harness = createTrustedIpcHarness(methods as unknown as DesktopService);
    const cases = [
      [IPC_CHANNELS.saveReaderLabUiState, methods.saveReaderLabUiState],
      [IPC_CHANNELS.loadReaderLabUiState, methods.loadReaderLabUiState],
      [IPC_CHANNELS.compilePublication, methods.compilePublication],
      [IPC_CHANNELS.getPublicationStats, methods.getPublicationStats],
      [IPC_CHANNELS.validatePublication, methods.validatePublication],
      [IPC_CHANNELS.listReaderPresets, methods.listReaderPresets],
      [IPC_CHANNELS.createReaderPreset, methods.createReaderPreset],
      [IPC_CHANNELS.updateReaderPreset, methods.updateReaderPreset],
      [IPC_CHANNELS.duplicateReaderPreset, methods.duplicateReaderPreset],
      [IPC_CHANNELS.deleteReaderPreset, methods.deleteReaderPreset]
    ] as const;
    const request = { sessionId: "session-1" };

    for (const [channel, method] of cases) {
      const handler = harness.handlers.get(channel);
      if (!handler) {
        throw new Error(`missing Reader IPC handler ${channel}`);
      }
      await handler(harness.event, request);
      expect(method).toHaveBeenLastCalledWith(request);
      await expect(handler(harness.event, null)).rejects.toThrow("Invalid request");
      await expect(handler(harness.event, [])).rejects.toThrow("Invalid request");
    }

    expect([...harness.handlers.keys()].sort()).toEqual(
      [...ALLOWED_IPC_CHANNELS].sort()
    );
    const channelNames = cases.map(([channel]) => channel).join(" ");
    expect(channelNames).not.toMatch(
      /generic|read-file|write-file|open-url|execute-script|shell/u
    );
    harness.dispose();
  });
});
