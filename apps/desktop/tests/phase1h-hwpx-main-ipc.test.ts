import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent
} from "electron";
import { describe, expect, it, vi } from "vitest";
import type { DesktopService } from "../src/main/desktopService";
import { registerMadiIpc } from "../src/main/ipc";
import { IPC_CHANNELS } from "../src/shared/contracts";
import { BUILT_IN_HWPX_PRESETS } from "../src/shared/hwpxBuiltins";

type Handler = (
  event: IpcMainInvokeEvent,
  request?: unknown
) => Promise<unknown>;

function harness(service: DesktopService) {
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

describe("Phase 1H main HWPX IPC request shapes", () => {
  it("rejects an extra manuscript field before every service dispatch", async () => {
    const methods = {
      runEpubIpcTask: vi.fn(async <T>(task: () => Promise<T>) => task()),
      runHwpxIpcTask: vi.fn(async <T>(task: () => Promise<T>) => task()),
      getHwpxExportState: vi.fn(async () => null),
      createHwpxExportPreset: vi.fn(async () => null),
      updateHwpxExportPreset: vi.fn(async () => null),
      duplicateHwpxExportPreset: vi.fn(async () => null),
      deleteHwpxExportPreset: vi.fn(async () => null),
      chooseHwpxOutput: vi.fn(async () => null),
      validateHwpxExport: vi.fn(async () => null),
      runHwpxExport: vi.fn(async () => null),
      cancelHwpxExport: vi.fn(async () => null),
      saveHwpxExportReport: vi.fn(async () => null),
      revealHwpxExport: vi.fn(async () => null)
    };
    const ipc = harness(methods as unknown as DesktopService);
    const session = { sessionId: "session-1" };
    const operationId = "123e4567-e89b-42d3-a456-426614174000";
    const config = BUILT_IN_HWPX_PRESETS[0]!.config;
    const validateRequest = {
      ...session,
      operationId,
      scopeNodeId: "work-1",
      scopeKind: "WORK",
      expectedProjectRevision: 7,
      presetId: "GENERAL_SUBMISSION",
      presetContentHash: "0".repeat(64),
      metadata: {
        projectId: "project-1",
        publicationTitle: "긴 밤의 문장",
        creatorName: "마디 작가",
        language: "ko",
        identifier: "urn:madi:publication:project-1",
        publisher: null,
        description: null,
        rights: null,
        subjects: [],
        coverAssetId: null,
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z"
      },
      config,
      titlePage: { subtitle: null, genre: null, contact: null }
    };
    const cases = [
      [IPC_CHANNELS.getHwpxExportState, methods.getHwpxExportState, session],
      [
        IPC_CHANNELS.createHwpxExportPreset,
        methods.createHwpxExportPreset,
        { ...session, name: "제출본", config }
      ],
      [
        IPC_CHANNELS.updateHwpxExportPreset,
        methods.updateHwpxExportPreset,
        {
          ...session,
          presetId: "custom-1",
          name: "제출본",
          config,
          expectedPresetRevision: 2
        }
      ],
      [
        IPC_CHANNELS.duplicateHwpxExportPreset,
        methods.duplicateHwpxExportPreset,
        { ...session, sourcePresetId: "custom-1", name: "제출본 복사" }
      ],
      [
        IPC_CHANNELS.deleteHwpxExportPreset,
        methods.deleteHwpxExportPreset,
        { ...session, presetId: "custom-1", expectedPresetRevision: 2 }
      ],
      [
        IPC_CHANNELS.chooseHwpxOutput,
        methods.chooseHwpxOutput,
        { ...session, suggestedFileName: "제출본.hwpx", outputType: "HWPX" }
      ],
      [IPC_CHANNELS.validateHwpxExport, methods.validateHwpxExport, validateRequest],
      [
        IPC_CHANNELS.runHwpxExport,
        methods.runHwpxExport,
        {
          ...validateRequest,
          outputSelectionId: "selection-1",
          outputType: "HWPX"
        }
      ],
      [
        IPC_CHANNELS.cancelHwpxExport,
        methods.cancelHwpxExport,
        { ...session, operationId }
      ],
      [
        IPC_CHANNELS.saveHwpxExportReport,
        methods.saveHwpxExportReport,
        { ...session, operationId, format: "JSON" }
      ],
      [
        IPC_CHANNELS.revealHwpxExport,
        methods.revealHwpxExport,
        { ...session, operationId }
      ]
    ] as const;

    for (const [channel, method, request] of cases) {
      const handler = ipc.handlers.get(channel);
      if (!handler) {
        throw new Error(`missing HWPX IPC handler ${channel}`);
      }
      await expect(
        handler(ipc.event, {
          ...request,
          manuscriptText: "must never cross the IPC boundary"
        })
      ).rejects.toThrow("Invalid request shape");
      expect(method).not.toHaveBeenCalled();
    }

    ipc.dispose();
  });
});
