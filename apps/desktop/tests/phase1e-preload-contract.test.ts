import { describe, expect, it, vi } from "vitest";
import { createMadiDesktopApi } from "../src/preload/bridge";
import {
  ALLOWED_IPC_CHANNELS,
  IPC_CHANNELS,
  type CanvasMutationResult,
  type CanvasRecord,
  type DeleteCanvasResult,
  type ExportCanvasResult,
  type ListCanvasesResult,
  type LoadPlotCanvasUiStateResult,
  type PickCanvasImportResult,
  type SaveCanvasResult
} from "../src/shared/contracts";

const document = {
  nodes: [
    {
      id: "node-1",
      type: "text" as const,
      x: 10,
      y: 20,
      width: 240,
      height: 120,
      text: "첫 장면"
    }
  ],
  edges: []
};

const canvas: CanvasRecord = {
  id: "canvas-1",
  projectId: "project-1",
  name: "전체 플롯",
  description: null,
  documentFormat: "JSON_CANVAS",
  documentVersion: "1.0",
  contentHash: "a".repeat(64),
  revision: 2,
  nodeCount: 1,
  edgeCount: 0,
  createdAt: "2026-08-08T00:00:00.000Z",
  updatedAt: "2026-08-08T00:01:00.000Z",
  document
};

describe("Phase 1E preload Canvas capabilities", () => {
  it("maps all eleven Canvas capabilities to fixed channels with pass-through results", async () => {
    const listResult: ListCanvasesResult = {
      canvases: [canvas],
      revision: 3
    };
    const mutationResult: CanvasMutationResult = {
      canvas,
      revision: 3,
      noOp: false
    };
    const deleteResult: DeleteCanvasResult = {
      deletedCanvasId: canvas.id,
      revision: 4
    };
    const saveResult: SaveCanvasResult = {
      ...mutationResult,
      canvasId: canvas.id,
      generation: 2,
      saveSequence: 5
    };
    const uiStateResult: LoadPlotCanvasUiStateResult = {
      state: {
        lastCanvasId: canvas.id,
        canvasStates: {}
      }
    };
    const importResult: PickCanvasImportResult = {
      fileName: "outline.canvas",
      source: JSON.stringify(document)
    };
    const exportResult: ExportCanvasResult = {
      fileName: "outline.canvas",
      bytes: 128
    };
    const responses = new Map<string, unknown>([
      [IPC_CHANNELS.listCanvases, listResult],
      [IPC_CHANNELS.createCanvas, mutationResult],
      [IPC_CHANNELS.updateCanvas, mutationResult],
      [IPC_CHANNELS.duplicateCanvas, mutationResult],
      [IPC_CHANNELS.deleteCanvas, deleteResult],
      [IPC_CHANNELS.loadCanvas, canvas],
      [IPC_CHANNELS.saveCanvas, saveResult],
      [IPC_CHANNELS.savePlotCanvasUiState, undefined],
      [IPC_CHANNELS.loadPlotCanvasUiState, uiStateResult],
      [IPC_CHANNELS.pickCanvasImport, importResult],
      [IPC_CHANNELS.exportCanvas, exportResult]
    ]);
    const invoke = vi.fn(async (channel: string) => responses.get(channel));
    const api = createMadiDesktopApi(invoke);
    const sessionId = "session-1";
    const listRequest = { sessionId, sort: "UPDATED_DESC" as const };
    const createRequest = {
      sessionId,
      name: "전체 플롯",
      description: null,
      document
    };
    const updateRequest = {
      sessionId,
      canvasId: canvas.id,
      name: "1부 플롯",
      description: "초안",
      expectedCanvasRevision: 2
    };
    const duplicateRequest = {
      sessionId,
      sourceCanvasId: canvas.id,
      name: "전체 플롯 복사본"
    };
    const deleteRequest = {
      sessionId,
      canvasId: canvas.id,
      expectedCanvasRevision: 2
    };
    const loadRequest = { sessionId, canvasId: canvas.id };
    const saveRequest = {
      sessionId,
      canvasId: canvas.id,
      expectedCanvasRevision: 2,
      generation: 2,
      saveSequence: 5,
      document
    };
    const saveUiRequest = {
      sessionId,
      state: { lastCanvasId: canvas.id, canvasStates: {} }
    };
    const loadUiRequest = { sessionId };
    const exportRequest = {
      sessionId,
      canvasId: canvas.id,
      suggestedFileName: "outline.canvas"
    };

    await expect(api.listCanvases(listRequest)).resolves.toBe(listResult);
    await expect(api.createCanvas(createRequest)).resolves.toBe(mutationResult);
    await expect(api.updateCanvas(updateRequest)).resolves.toBe(mutationResult);
    await expect(api.duplicateCanvas(duplicateRequest)).resolves.toBe(
      mutationResult
    );
    await expect(api.deleteCanvas(deleteRequest)).resolves.toBe(deleteResult);
    await expect(api.loadCanvas(loadRequest)).resolves.toBe(canvas);
    await expect(api.saveCanvas(saveRequest)).resolves.toBe(saveResult);
    await expect(api.savePlotCanvasUiState(saveUiRequest)).resolves.toBeUndefined();
    await expect(api.loadPlotCanvasUiState(loadUiRequest)).resolves.toBe(
      uiStateResult
    );
    await expect(api.pickCanvasImport()).resolves.toBe(importResult);
    await expect(api.exportCanvas(exportRequest)).resolves.toBe(exportResult);

    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.listCanvases, listRequest],
      [IPC_CHANNELS.createCanvas, createRequest],
      [IPC_CHANNELS.updateCanvas, updateRequest],
      [IPC_CHANNELS.duplicateCanvas, duplicateRequest],
      [IPC_CHANNELS.deleteCanvas, deleteRequest],
      [IPC_CHANNELS.loadCanvas, loadRequest],
      [IPC_CHANNELS.saveCanvas, saveRequest],
      [IPC_CHANNELS.savePlotCanvasUiState, saveUiRequest],
      [IPC_CHANNELS.loadPlotCanvasUiState, loadUiRequest],
      [IPC_CHANNELS.pickCanvasImport],
      [IPC_CHANNELS.exportCanvas, exportRequest]
    ]);
  });

  it("keeps Canvas behind the allowlist without generic filesystem or path powers", () => {
    const api = createMadiDesktopApi(vi.fn());
    const canvasChannels = [
      IPC_CHANNELS.listCanvases,
      IPC_CHANNELS.createCanvas,
      IPC_CHANNELS.updateCanvas,
      IPC_CHANNELS.duplicateCanvas,
      IPC_CHANNELS.deleteCanvas,
      IPC_CHANNELS.loadCanvas,
      IPC_CHANNELS.saveCanvas,
      IPC_CHANNELS.savePlotCanvasUiState,
      IPC_CHANNELS.loadPlotCanvasUiState,
      IPC_CHANNELS.pickCanvasImport,
      IPC_CHANNELS.exportCanvas
    ];

    expect(ALLOWED_IPC_CHANNELS).toEqual(Object.values(IPC_CHANNELS));
    expect(ALLOWED_IPC_CHANNELS).toEqual(
      expect.arrayContaining(canvasChannels)
    );
    expect(new Set(ALLOWED_IPC_CHANNELS).size).toBe(
      ALLOWED_IPC_CHANNELS.length
    );
    expect(Object.isFrozen(api)).toBe(true);
    for (const capability of [
      "invoke",
      "executeSql",
      "readFile",
      "writeFile",
      "openPath",
      "resolvePath",
      "shell",
      "process"
    ]) {
      expect(capability in api).toBe(false);
    }
    expect(canvasChannels.join(" ")).not.toMatch(
      /read-file|write-file|open-path|resolve-path|execute-sql|shell/u
    );
  });
});
