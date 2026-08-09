import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LlmProviderDiagnostics } from "../src/renderer/components/llm/LlmProviderDiagnostics";
import type { MadiLlmApi } from "../src/shared/llmIpc";

const provider = {
  config: {
    schemaVersion: 1 as const,
    id: "provider-1",
    revision: 4,
    name: "로컬 모델",
    kind: "OPENAI_COMPATIBLE" as const,
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "local-model",
    credentialId: null,
    requiresApiKey: false,
    timeoutMs: 30_000,
    maxOutputTokens: 1_024,
    temperature: 0.2
  },
  credentialState: "NOT_REQUIRED" as const
};

function fakeApi(): MadiLlmApi {
  return {
    getStatus: vi.fn(async () => ({
      providerStore: "AVAILABLE" as const,
      credentialStorage: "AVAILABLE" as const
    })),
    listProviders: vi.fn(async () => [provider]),
    saveProvider: vi.fn(async () => provider),
    deleteProvider: vi.fn(async () => undefined),
    testProvider: vi.fn(async (request) => ({
      requestId: request.requestId,
      providerId: request.providerId,
      configuredModel: "local-model",
      responseModel: "local-model",
      status: "CONNECTED" as const,
      latencyMs: 18.42
    })),
    invoke: vi.fn(async () => {
      throw new Error("not used");
    }),
    cancel: vi.fn(async () => ({ cancelled: true }))
  };
}

describe("LlmProviderDiagnostics", () => {
  it("tests one stored provider without asking for manuscript text", async () => {
    const api = fakeApi();
    render(
      <LlmProviderDiagnostics api={api} createId={() => "provider-test-1"} />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "AI 제공자 연결 점검" })
    );
    await screen.findByText("로컬 모델 · local-model");
    expect(screen.getByText(/원고는 전송하지 않습니다/u)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "연결 점검" }));

    await screen.findByText("연결 확인 완료");
    expect(api.testProvider).toHaveBeenCalledWith({
      requestId: "provider-test-1",
      providerId: "provider-1",
      expectedRevision: 4
    });
    expect(api.invoke).not.toHaveBeenCalled();
    expect(screen.getByText(/18.42ms/u)).toBeTruthy();
  });

  it("cancels a pending connectivity test through the shared request boundary", async () => {
    const api = fakeApi();
    let resolveTest:
      | ((value: Awaited<ReturnType<MadiLlmApi["testProvider"]>>) => void)
      | undefined;
    vi.mocked(api.testProvider).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTest = resolve;
        })
    );
    render(
      <LlmProviderDiagnostics api={api} createId={() => "cancel-test-1"} />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "AI 제공자 연결 점검" })
    );
    await screen.findByText("로컬 모델 · local-model");
    fireEvent.click(screen.getByRole("button", { name: "연결 점검" }));
    fireEvent.click(await screen.findByRole("button", { name: "취소" }));

    expect(api.cancel).toHaveBeenCalledWith({ requestId: "cancel-test-1" });
    resolveTest?.({
      requestId: "cancel-test-1",
      providerId: "provider-1",
      configuredModel: "local-model",
      responseModel: "local-model",
      status: "CONNECTED",
      latencyMs: 20
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "취소" })).toBeNull()
    );
  });

  it("keeps testing disabled when the protected credential is unavailable", async () => {
    const api = fakeApi();
    vi.mocked(api.listProviders).mockResolvedValueOnce([
      {
        ...provider,
        config: {
          ...provider.config,
          baseUrl: "https://example.com/v1",
          credentialId: "provider:provider-1",
          requiresApiKey: true
        },
        credentialState: "LOCKED"
      }
    ]);
    render(
      <LlmProviderDiagnostics api={api} createId={() => "locked-test"} />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "AI 제공자 연결 점검" })
    );
    await screen.findByText("로컬 모델 · local-model");

    const run = screen.getByRole("button", { name: "연결 점검" });
    expect((run as HTMLButtonElement).disabled).toBe(true);
    expect(api.testProvider).not.toHaveBeenCalled();
  });
});
