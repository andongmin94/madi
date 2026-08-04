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

describe("Phase 1G main EPUB IPC request shapes", () => {
  it("rejects a hostile extra key on every outer request before service dispatch", async () => {
    const methods = {
      runEpubIpcTask: vi.fn(async <T>(task: () => Promise<T>) => task()),
      getPublicationExportState: vi.fn(async () => null),
      updatePublicationMetadata: vi.fn(async () => null),
      choosePublicationCover: vi.fn(async () => null),
      removePublicationCover: vi.fn(async () => null),
      createEpubExportPreset: vi.fn(async () => null),
      updateEpubExportPreset: vi.fn(async () => null),
      duplicateEpubExportPreset: vi.fn(async () => null),
      deleteEpubExportPreset: vi.fn(async () => null),
      chooseEpubOutput: vi.fn(async () => null),
      validateEpubExport: vi.fn(async () => null),
      runEpubExport: vi.fn(async () => null),
      cancelEpubExport: vi.fn(async () => null),
      saveEpubExportReport: vi.fn(async () => null),
      revealEpubExport: vi.fn(async () => null)
    };
    const harness = createTrustedIpcHarness(
      methods as unknown as DesktopService
    );
    const operationId = "123e4567-e89b-42d3-a456-426614174000";
    const session = { sessionId: "session-1" };
    const config = {
      formatVersion: 1,
      targetProfile: "EPUB_3_3_COMPATIBILITY",
      splitMode: "CHAPTER",
      tocDepth: 3,
      includeChapterTitles: true,
      includeSceneTitles: true,
      sceneBreakStyleToken: "ORNAMENT",
      bodyStyleToken: "REFLOWABLE_PROSE",
      includeCover: false,
      stylesheetToken: "MADI_CLASSIC"
    };
    const metadata = {
      projectId: "project-1",
      publicationTitle: "긴 밤의 문장",
      creatorName: "마디 작가",
      language: "ko",
      identifier: "urn:madi:publication:project-1",
      publisher: null,
      description: null,
      rights: null,
      subjects: ["소설"],
      coverAssetId: null,
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z"
    };
    const validateRequest = {
      ...session,
      operationId,
      scopeNodeId: "work-1",
      expectedProjectRevision: 7,
      metadata,
      config
    };
    const cases = [
      {
        channel: IPC_CHANNELS.getPublicationExportState,
        method: methods.getPublicationExportState,
        request: session
      },
      {
        channel: IPC_CHANNELS.updatePublicationMetadata,
        method: methods.updatePublicationMetadata,
        request: {
          ...session,
          publicationTitle: metadata.publicationTitle,
          creatorName: metadata.creatorName,
          language: metadata.language,
          identifier: metadata.identifier,
          publisher: metadata.publisher,
          description: metadata.description,
          rights: metadata.rights,
          subjects: metadata.subjects
        }
      },
      {
        channel: IPC_CHANNELS.choosePublicationCover,
        method: methods.choosePublicationCover,
        request: session
      },
      {
        channel: IPC_CHANNELS.removePublicationCover,
        method: methods.removePublicationCover,
        request: session
      },
      {
        channel: IPC_CHANNELS.createEpubExportPreset,
        method: methods.createEpubExportPreset,
        request: { ...session, name: "유통용", config }
      },
      {
        channel: IPC_CHANNELS.updateEpubExportPreset,
        method: methods.updateEpubExportPreset,
        request: {
          ...session,
          presetId: "preset-1",
          name: "유통용",
          config,
          expectedPresetRevision: 2
        }
      },
      {
        channel: IPC_CHANNELS.duplicateEpubExportPreset,
        method: methods.duplicateEpubExportPreset,
        request: {
          ...session,
          sourcePresetId: "preset-1",
          name: "유통용 복사본"
        }
      },
      {
        channel: IPC_CHANNELS.deleteEpubExportPreset,
        method: methods.deleteEpubExportPreset,
        request: {
          ...session,
          presetId: "preset-1",
          expectedPresetRevision: 2
        }
      },
      {
        channel: IPC_CHANNELS.chooseEpubOutput,
        method: methods.chooseEpubOutput,
        request: { ...session, suggestedFileName: "긴 밤의 문장.epub" }
      },
      {
        channel: IPC_CHANNELS.validateEpubExport,
        method: methods.validateEpubExport,
        request: validateRequest
      },
      {
        channel: IPC_CHANNELS.runEpubExport,
        method: methods.runEpubExport,
        request: { ...validateRequest, outputSelectionId: "selection-1" }
      },
      {
        channel: IPC_CHANNELS.cancelEpubExport,
        method: methods.cancelEpubExport,
        request: { ...session, operationId }
      },
      {
        channel: IPC_CHANNELS.saveEpubExportReport,
        method: methods.saveEpubExportReport,
        request: { ...session, operationId, format: "JSON" }
      },
      {
        channel: IPC_CHANNELS.revealEpubExport,
        method: methods.revealEpubExport,
        request: { ...session, operationId }
      }
    ] as const;

    for (const { channel, method, request } of cases) {
      const handler = harness.handlers.get(channel);
      if (!handler) {
        throw new Error(`missing EPUB IPC handler ${channel}`);
      }
      await expect(
        handler(harness.event, {
          ...request,
          manuscriptText: "must never cross the IPC boundary"
        })
      ).rejects.toThrow("Invalid request shape");
      expect(method).not.toHaveBeenCalled();
    }

    harness.dispose();
  });
});
