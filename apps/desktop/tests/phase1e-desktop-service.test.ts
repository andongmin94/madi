import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  DesktopService,
  type DialogPort
} from "../src/main/desktopService";
import type { CoreClient, CoreMethod } from "../src/main/coreClient";
import { ProjectSessionRegistry } from "../src/main/projectSessions";
import type { PlotCanvasUiState } from "../src/shared/contracts";

const FILE_PATH = "C:\\drafts\\plot-canvas.madi";
const PROJECT_ID = "project-1";
const UPDATED_AT = "2026-08-08T00:00:00.000Z";

interface SerializedCanvasView {
  viewport: { x: number; y: number; zoom: number };
  selected_element_id: string | null;
  inspector_width: number;
  show_grid: boolean;
  show_minimap: boolean;
  snap_to_grid: boolean;
}

interface SerializedCanvasUiState {
  last_canvas_id: string | null;
  canvas_states: Record<string, SerializedCanvasView>;
}

function createHarness(
  responder: (
    method: CoreMethod,
    params: Readonly<Record<string, unknown>>
  ) => unknown | Promise<unknown>
) {
  const request = vi.fn(
    async (
      method: CoreMethod,
      params: Readonly<Record<string, unknown>>
    ): Promise<unknown> => responder(method, params)
  );
  const core: CoreClient = { request, dispose: vi.fn() };
  const sessions = new ProjectSessionRegistry();
  const session = sessions.add({
    filePath: FILE_PATH,
    projectId: PROJECT_ID,
    title: "Plot Canvas",
    revision: 3
  });
  const dialog: DialogPort = {
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] }))
  };
  return {
    request,
    session,
    service: new DesktopService(
      {} as BrowserWindow,
      dialog,
      core,
      sessions,
      "0.0.1"
    )
  };
}

const uiState: PlotCanvasUiState = {
  lastCanvasId: "canvas-10",
  canvasStates: Object.fromEntries(
    Array.from({ length: 11 }, (_, index) => {
      const canvasId = `canvas-${String(index).padStart(2, "0")}`;
      return [
        canvasId,
        {
          viewport: { x: index * 10, y: index * -5, zoom: 0.8 },
          selectedElementId: index === 10 ? "node-generated-10" : null,
          inspectorWidth: 320,
          showGrid: true,
          showMinimap: index % 2 === 0,
          snapToGrid: true
        }
      ];
    })
  )
};

describe("Phase 1E DesktopService Canvas UI state", () => {
  it("accepts reordered core JSON but rejects a nested semantic mutation", async () => {
    let mutateResponse = false;
    const { request, service, session } = createHarness((method, params) => {
      expect(method).toBe("save_ui_state");
      const input = structuredClone(params.value) as SerializedCanvasUiState;
      const canvasStates = Object.fromEntries(
        Object.entries(input.canvas_states).reverse()
      );
      if (mutateResponse) {
        const view = canvasStates["canvas-05"]!;
        canvasStates["canvas-05"] = {
          ...view,
          viewport: { ...view.viewport, x: view.viewport.x + 1 }
        };
      }
      return {
        state: {
          project_id: PROJECT_ID,
          key: "plot-canvas.v1",
          value: { ...input, canvas_states: canvasStates },
          updated_at: UPDATED_AT
        }
      };
    });

    const input = { sessionId: session.sessionId, state: uiState };
    await expect(service.savePlotCanvasUiState(input)).resolves.toBeUndefined();
    mutateResponse = true;
    await expect(service.savePlotCanvasUiState(input)).rejects.toThrow(
      "The local core saved different plot canvas UI state"
    );

    expect(request).toHaveBeenCalledTimes(2);
    const firstValue = request.mock.calls[0]?.[1].value as SerializedCanvasUiState;
    expect(Object.keys(firstValue.canvas_states)).toHaveLength(11);
  });
});
