import { describe, expect, it, vi } from "vitest";
import { createMadiDesktopApi } from "../src/preload/bridge";
import {
  ALLOWED_IPC_CHANNELS,
  IPC_CHANNELS,
  IPC_EVENTS
} from "../src/shared/contracts";
import type {
  EpubExportPresetConfig,
  PublicationExportMetadata
} from "../src/shared/epubExport";

const operationId = "123e4567-e89b-42d3-a456-426614174000";

const config: EpubExportPresetConfig = {
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

const metadata: PublicationExportMetadata = {
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

describe("Phase 1G preload EPUB capabilities", () => {
  it("maps every bounded EPUB capability to its fixed IPC channel", async () => {
    const response = Object.freeze({ marker: "opaque main-process result" });
    const invoke = vi.fn(async (channel: string) =>
      channel === IPC_CHANNELS.runEpubExport
        ? { status: "CANCELLED", operationId }
        : response
    );
    const api = createMadiDesktopApi(invoke);
    const session = { sessionId: "session-1" };
    const metadataRequest = {
      sessionId: session.sessionId,
      publicationTitle: metadata.publicationTitle,
      creatorName: metadata.creatorName,
      language: metadata.language,
      identifier: metadata.identifier,
      publisher: metadata.publisher,
      description: metadata.description,
      rights: metadata.rights,
      subjects: metadata.subjects
    };
    const chooseCoverRequest = { sessionId: session.sessionId };
    const createPresetRequest = {
      sessionId: session.sessionId,
      name: "유통용",
      config
    };
    const updatePresetRequest = {
      ...createPresetRequest,
      presetId: "preset-1",
      expectedPresetRevision: 2
    };
    const duplicatePresetRequest = {
      sessionId: session.sessionId,
      sourcePresetId: "preset-1",
      name: "유통용 복사본"
    };
    const deletePresetRequest = {
      sessionId: session.sessionId,
      presetId: "preset-1",
      expectedPresetRevision: 2
    };
    const chooseOutputRequest = {
      sessionId: session.sessionId,
      suggestedFileName: "긴 밤의 문장.epub"
    };
    const validateRequest = {
      sessionId: session.sessionId,
      operationId,
      scopeNodeId: "work-1",
      expectedProjectRevision: 7,
      metadata,
      config
    };
    const runRequest = {
      ...validateRequest,
      outputSelectionId: "selection-1"
    };
    const cancelRequest = { sessionId: session.sessionId, operationId };
    const saveReportRequest = {
      sessionId: session.sessionId,
      operationId,
      format: "JSON" as const
    };
    const revealRequest = { sessionId: session.sessionId, operationId };

    await api.getPublicationExportState(session);
    await api.updatePublicationMetadata(metadataRequest);
    await api.choosePublicationCover(chooseCoverRequest);
    await api.removePublicationCover(session);
    await api.createEpubExportPreset(createPresetRequest);
    await api.updateEpubExportPreset(updatePresetRequest);
    await api.duplicateEpubExportPreset(duplicatePresetRequest);
    await api.deleteEpubExportPreset(deletePresetRequest);
    await api.chooseEpubOutput(chooseOutputRequest);
    await api.validateEpubExport(validateRequest);
    await api.runEpubExport(runRequest);
    await api.cancelEpubExport(cancelRequest);
    await api.saveEpubExportReport(saveReportRequest);
    await api.revealEpubExport(revealRequest);

    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.getPublicationExportState, session],
      [IPC_CHANNELS.updatePublicationMetadata, metadataRequest],
      [IPC_CHANNELS.choosePublicationCover, chooseCoverRequest],
      [IPC_CHANNELS.removePublicationCover, session],
      [IPC_CHANNELS.createEpubExportPreset, createPresetRequest],
      [IPC_CHANNELS.updateEpubExportPreset, updatePresetRequest],
      [IPC_CHANNELS.duplicateEpubExportPreset, duplicatePresetRequest],
      [IPC_CHANNELS.deleteEpubExportPreset, deletePresetRequest],
      [IPC_CHANNELS.chooseEpubOutput, chooseOutputRequest],
      [IPC_CHANNELS.validateEpubExport, validateRequest],
      [IPC_CHANNELS.runEpubExport, runRequest],
      [IPC_CHANNELS.cancelEpubExport, cancelRequest],
      [IPC_CHANNELS.saveEpubExportReport, saveReportRequest],
      [IPC_CHANNELS.revealEpubExport, revealRequest]
    ]);
  });

  it("validates progress before exposing it and returns the event unsubscriber", () => {
    const eventListeners = new Map<string, (payload?: unknown) => void>();
    const progressUnsubscribe = vi.fn();
    const subscribe = vi.fn(
      (channel: string, listener: (payload?: unknown) => void) => {
        eventListeners.set(channel, listener);
        return channel === IPC_EVENTS.epubExportProgress
          ? progressUnsubscribe
          : vi.fn();
      }
    );
    const api = createMadiDesktopApi(vi.fn(), subscribe);
    const listener = vi.fn();
    const unsubscribe = api.onEpubExportProgress(listener);
    const emitProgress = eventListeners.get(IPC_EVENTS.epubExportProgress)!;

    emitProgress({
      operationId: operationId.toUpperCase(),
      stage: "INTERNAL_VALIDATION",
      completed: 2,
      total: 3
    });

    expect(listener).toHaveBeenCalledWith({
      operationId,
      stage: "INTERNAL_VALIDATION",
      completed: 2,
      total: 3
    });
    expect(() =>
      emitProgress({
        operationId,
        stage: "INTERNAL_VALIDATION",
        completed: 4,
        total: 3,
        sourceText: "renderer must not receive manuscript content"
      })
    ).toThrow();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(progressUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it("accepts only exact discriminated export outcomes", async () => {
    const runRequest = {
      sessionId: "session-1",
      operationId,
      scopeNodeId: "work-1",
      expectedProjectRevision: 7,
      metadata,
      config,
      outputSelectionId: "selection-1"
    };
    const cancelledApi = createMadiDesktopApi(
      vi.fn(async () => ({
        status: "CANCELLED",
        operationId: operationId.toUpperCase()
      }))
    );
    await expect(cancelledApi.runEpubExport(runRequest)).resolves.toEqual({
      status: "CANCELLED",
      operationId
    });

    const failedApi = createMadiDesktopApi(
      vi.fn(async () => ({
        status: "FAILED",
        operationId,
        code: "DESTINATION_CHANGED"
      }))
    );
    await expect(failedApi.runEpubExport(runRequest)).resolves.toEqual({
      status: "FAILED",
      operationId,
      code: "DESTINATION_CHANGED"
    });

    const completed = {
      status: "COMPLETED",
      operationId,
      fileName: "긴 밤의 문장.epub",
      byteLength: 1_024,
      sha256: "a".repeat(64),
      report: { formatVersion: 1 },
      revision: 7
    };
    const completedApi = createMadiDesktopApi(vi.fn(async () => completed));
    await expect(completedApi.runEpubExport(runRequest)).resolves.toEqual(
      completed
    );

    for (const hostile of [
      { status: "CANCELLED", operationId, fileName: "unexpected.epub" },
      { status: "FAILED", operationId },
      { status: "FAILED", operationId, code: "UNKNOWN" },
      {
        status: "FAILED",
        operationId,
        code: "DESTINATION_CHANGED",
        fileName: "unexpected.epub"
      },
      {
        status: "CANCELLED",
        operationId: "123e4567-e89b-42d3-a456-426614174001"
      },
      { ...completed, fileName: "C:\\private\\draft.epub" },
      { ...completed, sha256: "not-a-sha256" },
      { ...completed, report: null },
      { ...completed, hiddenPath: "C:\\private\\draft.epub" }
    ]) {
      const api = createMadiDesktopApi(vi.fn(async () => hostile));
      await expect(api.runEpubExport(runRequest)).rejects.toThrow();
    }
  });

  it("keeps export and reveal operations bounded without generic path powers", () => {
    const api = createMadiDesktopApi(vi.fn());
    const epubChannels = [
      IPC_CHANNELS.getPublicationExportState,
      IPC_CHANNELS.updatePublicationMetadata,
      IPC_CHANNELS.choosePublicationCover,
      IPC_CHANNELS.removePublicationCover,
      IPC_CHANNELS.createEpubExportPreset,
      IPC_CHANNELS.updateEpubExportPreset,
      IPC_CHANNELS.duplicateEpubExportPreset,
      IPC_CHANNELS.deleteEpubExportPreset,
      IPC_CHANNELS.chooseEpubOutput,
      IPC_CHANNELS.validateEpubExport,
      IPC_CHANNELS.runEpubExport,
      IPC_CHANNELS.cancelEpubExport,
      IPC_CHANNELS.saveEpubExportReport,
      IPC_CHANNELS.revealEpubExport
    ];

    expect(ALLOWED_IPC_CHANNELS).toEqual(Object.values(IPC_CHANNELS));
    expect(ALLOWED_IPC_CHANNELS).toEqual(expect.arrayContaining(epubChannels));
    expect(new Set(ALLOWED_IPC_CHANNELS).size).toBe(ALLOWED_IPC_CHANNELS.length);
    expect(Object.isFrozen(api)).toBe(true);
    for (const capability of [
      "invoke",
      "readFile",
      "writeFile",
      "resolvePath",
      "openPath",
      "spawn",
      "shell",
      "process"
    ]) {
      expect(capability in api).toBe(false);
    }
  });
});
