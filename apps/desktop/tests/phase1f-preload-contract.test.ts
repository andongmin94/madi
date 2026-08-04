import { describe, expect, it, vi } from "vitest";
import { createMadiDesktopApi } from "../src/preload/bridge";
import {
  ALLOWED_IPC_CHANNELS,
  IPC_CHANNELS,
  type ReaderLabUiState,
  type ReaderRenderConfig
} from "../src/shared/contracts";

const config: ReaderRenderConfig = {
  formatVersion: 1,
  platform: {
    id: "generic-reader",
    name: "Generic Reader",
    version: 1,
    family: "GENERIC",
    verificationStatus: "GENERIC",
    verifiedAt: null,
    supportedControls: ["TYPOGRAPHY"]
  },
  device: {
    id: "phone-360x720",
    name: "Phone 360×720",
    category: "PHONE",
    viewportWidth: 360,
    viewportHeight: 720,
    safeAreaTop: 0,
    safeAreaBottom: 0,
    readerChromeHeight: 44,
    pixelRatio: 1
  },
  settings: {
    fontFamilyToken: "KOREAN_SERIF",
    fontSize: 18,
    lineHeight: 1.75,
    paragraphSpacing: 14,
    firstLineIndent: 18,
    horizontalPadding: 24,
    verticalPadding: 20,
    textAlign: "LEFT",
    theme: "LIGHT",
    backgroundColor: "#fffdf8",
    textColor: "#24231f",
    scrollMode: "CONTINUOUS",
    showChapterTitle: true,
    showSceneTitle: true,
    showSceneBreak: true
  },
  workStyle: {
    bodyStyleToken: "PROSE",
    chapterTitleStyleToken: "CHAPTER_DEFAULT",
    sceneTitleStyleToken: "SCENE_DEFAULT",
    sceneBreakStyleToken: "DIAMONDS"
  }
};

const emptyPane = {
  presetId: null,
  deviceProfileId: "phone-360x720",
  overrides: {},
  zoom: 1,
  scrollProgress: 0
};

const uiState: ReaderLabUiState = {
  lastScopeNodeId: "work-1",
  paneCount: 1,
  panes: [emptyPane, emptyPane, emptyPane],
  scrollSync: true,
  leftPanelWidth: 300,
  rightPanelWidth: 340,
  selectedSourceBlockId: null,
  diagnosticsExpanded: false
};

describe("Phase 1F preload Reader Lab capabilities", () => {
  it("maps the bounded Reader API to fixed IPC channels", async () => {
    const responses = new Map<string, unknown>([
      [IPC_CHANNELS.saveReaderLabUiState, undefined],
      [IPC_CHANNELS.loadReaderLabUiState, { state: uiState }],
      [IPC_CHANNELS.compilePublication, { marker: "compile" }],
      [IPC_CHANNELS.getPublicationStats, { marker: "stats" }],
      [IPC_CHANNELS.validatePublication, { marker: "validate" }],
      [IPC_CHANNELS.listReaderPresets, { presets: [], duplicateNames: [], revision: 4 }],
      [IPC_CHANNELS.createReaderPreset, { marker: "create" }],
      [IPC_CHANNELS.updateReaderPreset, { marker: "update" }],
      [IPC_CHANNELS.duplicateReaderPreset, { marker: "duplicate" }],
      [IPC_CHANNELS.deleteReaderPreset, { deletedPresetId: "preset-1", revision: 5 }]
    ]);
    const invoke = vi.fn(async (channel: string) => responses.get(channel));
    const api = createMadiDesktopApi(invoke);
    const sessionId = "session-1";
    const scopeRequest = {
      sessionId,
      scopeNodeId: "work-1",
      expectedProjectRevision: 4
    };
    const document = {
      formatVersion: 1 as const,
      projectId: "project-1",
      projectRevision: 4,
      scopeNodeId: "work-1",
      scopeKind: "WORK" as const,
      metadata: { title: "작품", authorName: null, language: "ko" as const },
      sections: [],
      stats: {
        withSpaces: 0,
        withoutSpaces: 0,
        paragraphCount: 0,
        sceneCount: 0,
        chapterCount: 0
      }
    };
    const createRequest = {
      sessionId,
      name: "내 독서환경",
      sourceKind: "CUSTOM" as const,
      verificationStatus: "USER_DEFINED" as const,
      config
    };
    const updateRequest = {
      sessionId,
      presetId: "preset-1",
      name: "내 독서환경",
      verificationStatus: "USER_DEFINED" as const,
      config,
      expectedPresetRevision: 1
    };
    const duplicateRequest = { sessionId, sourcePresetId: "preset-1" };
    const deleteRequest = {
      sessionId,
      presetId: "preset-1",
      expectedPresetRevision: 1
    };

    await api.saveReaderLabUiState({ sessionId, state: uiState });
    await api.loadReaderLabUiState({ sessionId });
    await api.compilePublication(scopeRequest);
    await api.getPublicationStats(scopeRequest);
    await api.validatePublication({ document });
    await api.listReaderPresets({ sessionId });
    await api.createReaderPreset(createRequest);
    await api.updateReaderPreset(updateRequest);
    await api.duplicateReaderPreset(duplicateRequest);
    await api.deleteReaderPreset(deleteRequest);

    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.saveReaderLabUiState, { sessionId, state: uiState }],
      [IPC_CHANNELS.loadReaderLabUiState, { sessionId }],
      [IPC_CHANNELS.compilePublication, scopeRequest],
      [IPC_CHANNELS.getPublicationStats, scopeRequest],
      [IPC_CHANNELS.validatePublication, { document }],
      [IPC_CHANNELS.listReaderPresets, { sessionId }],
      [IPC_CHANNELS.createReaderPreset, createRequest],
      [IPC_CHANNELS.updateReaderPreset, updateRequest],
      [IPC_CHANNELS.duplicateReaderPreset, duplicateRequest],
      [IPC_CHANNELS.deleteReaderPreset, deleteRequest]
    ]);
  });

  it("exposes no generic RPC, filesystem, URL, or executable-content power", () => {
    const api = createMadiDesktopApi(vi.fn());
    const readerChannels = [
      IPC_CHANNELS.saveReaderLabUiState,
      IPC_CHANNELS.loadReaderLabUiState,
      IPC_CHANNELS.compilePublication,
      IPC_CHANNELS.getPublicationStats,
      IPC_CHANNELS.validatePublication,
      IPC_CHANNELS.listReaderPresets,
      IPC_CHANNELS.createReaderPreset,
      IPC_CHANNELS.updateReaderPreset,
      IPC_CHANNELS.duplicateReaderPreset,
      IPC_CHANNELS.deleteReaderPreset
    ];

    expect(ALLOWED_IPC_CHANNELS).toEqual(expect.arrayContaining(readerChannels));
    expect(new Set(ALLOWED_IPC_CHANNELS).size).toBe(ALLOWED_IPC_CHANNELS.length);
    for (const capability of [
      "invoke",
      "readFile",
      "writeFile",
      "openUrl",
      "executeScript",
      "loadFont",
      "shell"
    ]) {
      expect(capability in api).toBe(false);
    }
  });
});
