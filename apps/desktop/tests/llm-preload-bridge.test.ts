import { describe, expect, it, vi } from "vitest";

import { createMadiLlmApi } from "../src/preload/llmBridge";
import { LLM_IPC_CHANNELS } from "../src/shared/llmIpc";

const provider = {
  id: "provider-1",
  name: "Provider",
  kind: "OPENAI_COMPATIBLE" as const,
  baseUrl: "https://example.com/v1",
  model: "model",
  requiresApiKey: true,
  timeoutMs: 30_000,
  maxOutputTokens: 1_024,
  temperature: 0.2
};

describe("madi LLM preload bridge", () => {
  it("exposes only the seven closed LLM operations", () => {
    const invoke = vi.fn(async () => undefined);
    const api = createMadiLlmApi(invoke);

    expect(Object.keys(api).sort()).toEqual([
      "cancel",
      "deleteProvider",
      "getStatus",
      "invoke",
      "listProviders",
      "saveProvider",
      "testProvider"
    ]);
    expect(Object.isFrozen(api)).toBe(true);
  });

  it("routes provider mutations and diagnostics through fixed channels", async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    const api = createMadiLlmApi(invoke);
    const saveRequest = {
      provider,
      expectedRevision: null,
      apiKey: "secret"
    };
    const testRequest = {
      requestId: "provider-test-1",
      providerId: provider.id,
      expectedRevision: 1
    };

    await api.saveProvider(saveRequest);
    await api.deleteProvider({ providerId: provider.id, expectedRevision: 1 });
    await api.testProvider(testRequest);

    expect(invoke).toHaveBeenNthCalledWith(
      1,
      LLM_IPC_CHANNELS.saveProvider,
      saveRequest
    );
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      LLM_IPC_CHANNELS.deleteProvider,
      { providerId: provider.id, expectedRevision: 1 }
    );
    expect(invoke).toHaveBeenNthCalledWith(
      3,
      LLM_IPC_CHANNELS.testProvider,
      testRequest
    );
  });
});
