import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CanvasAutosaveController,
  commitCanvasHistory,
  createCanvasSessionHistory,
  createTextCanvasNode,
  endCanvasHistoryCoalescing,
  redoCanvasHistory,
  undoCanvasHistory
} from "../src/renderer/components/plotCanvas";
import type {
  CanvasSaveRequest,
  CanvasSaveResult,
  MadiCanvasDocument
} from "../src/renderer/components/plotCanvas/types";

function documentWithText(text: string, x = 0): MadiCanvasDocument {
  return {
    nodes: [
      {
        ...createTextCanvasNode(text, { x, y: 0 }, () => "node-1"),
        width: 240,
        height: 140
      }
    ],
    edges: []
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("canvas session history", () => {
  it("supports undo/redo and coalesces a continuous drag into one entry", () => {
    const initial = documentWithText("A", 0);
    let history = createCanvasSessionHistory(initial);
    history = commitCanvasHistory(history, documentWithText("A", 10), "drag:node-1");
    history = commitCanvasHistory(history, documentWithText("A", 20), "drag:node-1");
    history = commitCanvasHistory(history, documentWithText("A", 30), "drag:node-1");
    expect(history.past).toHaveLength(1);
    expect(history.present.nodes[0].x).toBe(30);

    history = endCanvasHistoryCoalescing(history);
    history = commitCanvasHistory(history, documentWithText("수정", 30));
    expect(history.past).toHaveLength(2);
    history = undoCanvasHistory(history);
    expect((history.present.nodes[0] as { text: string }).text).toBe("A");
    history = undoCanvasHistory(history);
    expect(history.present.nodes[0].x).toBe(0);
    history = redoCanvasHistory(history);
    expect(history.present.nodes[0].x).toBe(30);
  });

  it("caps per-canvas history at 100 entries", () => {
    let history = createCanvasSessionHistory(documentWithText("0"));
    for (let index = 1; index <= 130; index += 1) {
      history = commitCanvasHistory(history, documentWithText(String(index)));
    }
    expect(history.past).toHaveLength(100);
  });
});

describe("CanvasAutosaveController", () => {
  it("debounces for 500ms and reports dirty/saving/saved with request identity", async () => {
    vi.useFakeTimers();
    const requests: CanvasSaveRequest[] = [];
    const controller = new CanvasAutosaveController(
      "canvas-a",
      documentWithText("A"),
      async (request) => {
        requests.push(request);
        return {
          canvasId: request.canvasId,
          generation: request.generation,
          saveSequence: request.saveSequence,
          revision: 2
        };
      },
      { now: () => 1234 }
    );
    const phases: string[] = [];
    controller.subscribe((state) => phases.push(state.phase));
    controller.update(documentWithText("B"));
    expect(controller.state.phase).toBe("dirty");
    await vi.advanceTimersByTimeAsync(499);
    expect(requests).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      canvasId: "canvas-a",
      generation: 1,
      saveSequence: 1,
      document: { nodes: [{ text: "B" }] }
    });
    expect(controller.state).toMatchObject({
      phase: "saved",
      lastSavedAt: 1234,
      saveSequence: 1
    });
    expect(phases).toEqual(expect.arrayContaining(["dirty", "saving", "saved"]));
    controller.dispose();
  });

  it("flushes immediately and skips a write when content returns to the saved value", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => undefined);
    const initial = documentWithText("A");
    const controller = new CanvasAutosaveController("canvas-a", initial, save);
    controller.update(documentWithText("B"));
    controller.update(documentWithText("A"));
    await controller.flush();
    expect(save).not.toHaveBeenCalled();
    expect(controller.state.phase).toBe("saved");
    controller.dispose();
  });

  it("records a debounce save failure without leaking an unhandled rejection", async () => {
    vi.useFakeTimers();
    const controller = new CanvasAutosaveController(
      "canvas-a",
      documentWithText("A"),
      async () => {
        throw new Error("background disk full");
      }
    );
    controller.update(documentWithText("B"));

    await vi.advanceTimersByTimeAsync(500);

    expect(controller.state).toMatchObject({
      phase: "error",
      errorMessage: "background disk full"
    });
    expect(controller.document.nodes[0]).toMatchObject({ text: "B" });
    controller.dispose();
  });

  it("queues an additional save for edits made while a write is in flight", async () => {
    const first = deferred<CanvasSaveResult>();
    const second = deferred<CanvasSaveResult>();
    const requests: CanvasSaveRequest[] = [];
    const save = vi.fn((request: CanvasSaveRequest) => {
      requests.push(request);
      return requests.length === 1 ? first.promise : second.promise;
    });
    const controller = new CanvasAutosaveController(
      "canvas-a",
      documentWithText("A"),
      save
    );
    controller.update(documentWithText("B"));
    const flushing = controller.flush();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    controller.update(documentWithText("C"));
    first.resolve({
      canvasId: "canvas-a",
      generation: 1,
      saveSequence: 1
    });
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(requests[1].document.nodes[0]).toMatchObject({ text: "C" });
    second.resolve({
      canvasId: "canvas-a",
      generation: 1,
      saveSequence: 2
    });
    await flushing;
    expect(controller.state).toMatchObject({ phase: "saved", saveSequence: 2 });
    controller.dispose();
  });

  it("ignores stale responses after a canvas generation switch", async () => {
    const oldSave = deferred<CanvasSaveResult>();
    const save = vi.fn(() => oldSave.promise);
    const controller = new CanvasAutosaveController(
      "canvas-a",
      documentWithText("A"),
      save
    );
    controller.update(documentWithText("A changed"));
    const flushing = controller.flush();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    controller.activate("canvas-b", documentWithText("B"));
    oldSave.resolve({ canvasId: "canvas-a", generation: 1, saveSequence: 1 });
    await flushing;
    expect(controller.state).toMatchObject({
      canvasId: "canvas-b",
      generation: 2,
      phase: "clean"
    });
    controller.dispose();
  });

  it("keeps the current edit after an error and can retry it", async () => {
    let attempt = 0;
    const controller = new CanvasAutosaveController(
      "canvas-a",
      documentWithText("A"),
      async (request) => {
        attempt += 1;
        if (attempt === 1) {
          throw new Error("disk full");
        }
        return {
          canvasId: request.canvasId,
          generation: request.generation,
          saveSequence: request.saveSequence
        };
      }
    );
    controller.update(documentWithText("unsaved"));
    await expect(controller.flush()).rejects.toThrow("disk full");
    expect(controller.state).toMatchObject({
      phase: "error",
      errorMessage: "disk full"
    });
    expect(controller.document.nodes[0]).toMatchObject({ text: "unsaved" });
    await controller.flush();
    expect(controller.state.phase).toBe("saved");
    controller.dispose();
  });

  it("retains an invalid edit, enters error, and rejects explicit flush before save", async () => {
    const save = vi.fn(async () => undefined);
    const controller = new CanvasAutosaveController(
      "canvas-a",
      documentWithText("A"),
      save
    );
    const invalid = {
      ...documentWithText("편집 유지"),
      nodes: [
        {
          ...documentWithText("편집 유지").nodes[0],
          color: "x".repeat(65)
        }
      ]
    } as MadiCanvasDocument;
    controller.update(invalid);

    await expect(controller.flush()).rejects.toThrow(/64자/);
    expect(save).not.toHaveBeenCalled();
    expect(controller.state).toMatchObject({
      phase: "error",
      errorMessage: expect.stringMatching(/64자/)
    });
    expect(controller.document).toBe(invalid);
    controller.dispose();
  });
});
