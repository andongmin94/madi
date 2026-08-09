import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent
} from "electron";
import { describe, expect, it, vi } from "vitest";

import { registerMadiLlmIpc } from "../src/main/llm/ipc";
import type { LlmRuntimeService } from "../src/main/llm/service";
import { LLM_IPC_CHANNELS } from "../src/shared/llmIpc";

type Handler = (
  event: IpcMainInvokeEvent,
  request?: unknown
) => Promise<unknown>;

function harness(service: LlmRuntimeService) {
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
  const dispose = registerMadiLlmIpc({
    ipcMain,
    window,
    rendererUrl: "madi://app/index.html",
    service
  });
  return { dispose, event, handlers };
}

describe("madi LLM provider diagnostics IPC", () => {
  it("dispatches one exact, manuscript-free test request", async () => {
    const testProvider = vi.fn(async () => ({
      requestId: "provider-test-1",
      providerId: "provider-1",
      configuredModel: "model",
      responseModel: "model",
      status: "CONNECTED" as const,
      latencyMs: 10
    }));
    const ipc = harness({ testProvider } as unknown as LlmRuntimeService);
    const handler = ipc.handlers.get(LLM_IPC_CHANNELS.testProvider);
    if (!handler) {
      throw new Error("missing provider test IPC handler");
    }
    const request = {
      requestId: "provider-test-1",
      providerId: "provider-1",
      expectedRevision: 2
    };

    await expect(handler(ipc.event, request)).resolves.toMatchObject({
      status: "CONNECTED"
    });
    expect(testProvider).toHaveBeenCalledWith(request);
    ipc.dispose();
  });

  it("rejects extra manuscript or prompt fields before service dispatch", async () => {
    const testProvider = vi.fn(async () => null);
    const ipc = harness({ testProvider } as unknown as LlmRuntimeService);
    const handler = ipc.handlers.get(LLM_IPC_CHANNELS.testProvider);
    if (!handler) {
      throw new Error("missing provider test IPC handler");
    }

    await expect(
      handler(ipc.event, {
        requestId: "provider-test-1",
        providerId: "provider-1",
        expectedRevision: 2,
        manuscriptText: "must never cross this diagnostics boundary"
      })
    ).rejects.toThrow("The LLM operation failed");
    await expect(
      handler(ipc.event, {
        requestId: "provider-test-2",
        providerId: "provider-1",
        expectedRevision: 2,
        systemInstruction: "arbitrary prompt"
      })
    ).rejects.toThrow("The LLM operation failed");
    expect(testProvider).not.toHaveBeenCalled();
    ipc.dispose();
  });

  it("rejects a stale or invalid provider revision before service dispatch", async () => {
    const testProvider = vi.fn(async () => null);
    const ipc = harness({ testProvider } as unknown as LlmRuntimeService);
    const handler = ipc.handlers.get(LLM_IPC_CHANNELS.testProvider);
    if (!handler) {
      throw new Error("missing provider test IPC handler");
    }

    await expect(
      handler(ipc.event, {
        requestId: "provider-test-invalid-revision",
        providerId: "provider-1",
        expectedRevision: 0
      })
    ).rejects.toThrow("The LLM operation failed");
    expect(testProvider).not.toHaveBeenCalled();
    ipc.dispose();
  });
});
