import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LlmAssistantOverlay } from "../src/renderer/components/llm/LlmAssistantOverlay";
import type { MadiEditorAdapter } from "../src/renderer/editor/MadiEditorAdapter";
import { LlmEditorAccess } from "../src/renderer/llm/editorAccess";
import type { MadiLlmApi } from "../src/shared/llmIpc";

function editorAccess(text = "현재 원고 내용") {
  const access = new LlmEditorAccess();
  const adapter: MadiEditorAdapter = {
    open: vi.fn(async () => undefined),
    getSnapshot: vi.fn(async () => new Uint8Array()),
    getPlainText: vi.fn(async () => text),
    focus: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    insertSceneBreak: vi.fn(),
    onChanged: vi.fn(() => () => undefined)
  };
  access.attach(adapter);
  return access;
}

const provider = {
  config: {
    schemaVersion: 1 as const,
    id: "provider-1",
    revision: 2,
    name: "테스트 제공자",
    kind: "OPENAI_COMPATIBLE" as const,
    baseUrl: "https://example.com/v1",
    model: "example-model",
    credentialId: "provider:provider-1",
    requiresApiKey: true,
    timeoutMs: 30_000,
    maxOutputTokens: 2_048,
    temperature: 0.3
  },
  credentialState: "AVAILABLE" as const
};

function fakeApi(): MadiLlmApi {
  return {
    getStatus: vi.fn(async () => ({
      providerStore: "AVAILABLE" as const,
      credentialStorage: "AVAILABLE" as const
    })),
    listProviders: vi.fn(async () => [provider]),
    saveProvider: vi.fn(async (request) => ({
      config: {
        schemaVersion: 1,
        revision:
          request.expectedRevision === null ? 1 : request.expectedRevision + 1,
        credentialId: request.provider.requiresApiKey
          ? `provider:${request.provider.id}`
          : null,
        ...request.provider
      },
      credentialState: request.provider.requiresApiKey
        ? "AVAILABLE"
        : "NOT_REQUIRED"
    })),
    deleteProvider: vi.fn(async () => undefined),
    invoke: vi.fn(async (request) => ({
      requestId: request.invocation.requestId,
      providerId: request.invocation.providerId,
      model: "example-model",
      responseId: "response-1",
      text: "AI가 제안한 문장",
      finishReason: "stop",
      usage: {
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: 18
      }
    })),
    cancel: vi.fn(async () => ({ cancelled: true }))
  };
}

describe("LlmAssistantOverlay", () => {
  it("requires explicit scope confirmation before invoking a provider", async () => {
    const api = fakeApi();
    render(
      <LlmAssistantOverlay
        api={api}
        editorAccess={editorAccess()}
        createId={() => "request-1"}
        createScopeHash={async () => "a".repeat(64)}
        copyText={vi.fn(async () => undefined)}
        now={() => new Date("2026-08-22T10:00:00.000Z")}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "AI 보조 열기" }));
    await screen.findByText("테스트 제공자 · example-model");
    fireEvent.click(
      screen.getByRole("button", { name: "현재 편집 문서 불러오기" })
    );
    await waitFor(() =>
      expect(screen.getByDisplayValue("현재 원고 내용")).toBeTruthy()
    );

    const send = screen.getByRole("button", { name: "제안 요청" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    expect(api.invoke).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /위 제공자와 원고 범위를 확인했습니다/u
      })
    );
    fireEvent.click(send);

    await screen.findByDisplayValue("AI가 제안한 문장");
    expect(api.invoke).toHaveBeenCalledTimes(1);
    expect(api.invoke).toHaveBeenCalledWith({
      invocation: expect.objectContaining({
        requestId: "request-1",
        providerId: "provider-1",
        expectedProviderRevision: 2,
        scope: expect.objectContaining({
          manuscriptText: "현재 원고 내용",
          contextText: null
        }),
        consent: {
          confirmedAt: "2026-08-22T10:00:00.000Z",
          scopeSha256: "a".repeat(64)
        }
      })
    });
  });

  it("creates a provider without reading a stored API key back into the renderer", async () => {
    const api = fakeApi();
    vi.mocked(api.listProviders).mockResolvedValueOnce([]);
    render(
      <LlmAssistantOverlay
        api={api}
        editorAccess={editorAccess()}
        createId={() => "new-provider"}
        createScopeHash={async () => "b".repeat(64)}
        now={() => new Date("2026-08-22T10:00:00.000Z")}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "AI 보조 열기" }));
    fireEvent.click(screen.getByRole("button", { name: "제공자 설정" }));
    await screen.findByText("등록된 제공자가 없습니다.");

    fireEvent.change(screen.getByLabelText("이름"), {
      target: { value: "로컬 모델" }
    });
    fireEvent.change(screen.getByLabelText("모델"), {
      target: { value: "local-model" }
    });
    fireEvent.change(screen.getByLabelText(/OpenAI-compatible Base URL/u), {
      target: { value: "http://127.0.0.1:11434/v1" }
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "API 키 필요" }));
    fireEvent.click(screen.getByRole("button", { name: "제공자 저장" }));

    await waitFor(() => expect(api.saveProvider).toHaveBeenCalledTimes(1));
    expect(api.saveProvider).toHaveBeenCalledWith({
      provider: expect.objectContaining({
        id: "new-provider",
        name: "로컬 모델",
        model: "local-model",
        baseUrl: "http://127.0.0.1:11434/v1",
        requiresApiKey: false
      }),
      expectedRevision: null,
      apiKey: null
    });
    expect(screen.queryByDisplayValue(/private|secret|api-key/iu)).toBeNull();
  });
});
