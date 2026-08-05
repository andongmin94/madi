import { describe, expect, it, vi } from "vitest";

import {
  createLlmScopeSha256,
  invokeOpenAiCompatible,
  LlmClientError
} from "../src/main/llm/openAiCompatibleClient";
import {
  type LlmInvocationRequest,
  type LlmInvocationScope,
  parseLlmProviderConfig
} from "../src/shared/llm";

const config = parseLlmProviderConfig({
  schemaVersion: 1,
  id: "provider-1",
  revision: 4,
  name: "Example provider",
  kind: "OPENAI_COMPATIBLE",
  baseUrl: "https://example.com/v1",
  model: "example-model",
  credentialId: "credential-1",
  requiresApiKey: true,
  timeoutMs: 10_000,
  maxOutputTokens: 1_024,
  temperature: 0.2
});

const scope: LlmInvocationScope = {
  kind: "SELECTION",
  sourceId: "scene-1",
  manuscriptText: "원고 비밀 문장",
  contextText: "등장인물 설정"
};

function requestForScope(value: LlmInvocationScope = scope): LlmInvocationRequest {
  return {
    requestId: "request-1",
    providerId: config.id,
    expectedProviderRevision: config.revision,
    task: "REWRITE_SELECTION",
    systemInstruction: "문체를 유지한다.",
    userInstruction: "더 자연스럽게 다듬어 주세요.",
    scope: value,
    consent: {
      confirmedAt: "2026-08-22T10:00:00.000Z",
      scopeSha256: createLlmScopeSha256(value)
    }
  };
}

describe("OpenAI-compatible madi LLM client", () => {
  it("sends only the explicitly confirmed scope and returns a proposal", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe("https://example.com/v1/chat/completions");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer api-secret");
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        messages: Array<{ role: string; content: string }>;
        stream: boolean;
      };
      expect(body.model).toBe("example-model");
      expect(body.stream).toBe(false);
      expect(body.messages.at(-1)?.content).toContain(scope.manuscriptText);
      expect(body.messages.at(-1)?.content).toContain(scope.contextText);
      return new Response(
        JSON.stringify({
          id: "response-1",
          model: "example-model-2026",
          choices: [
            {
              message: { role: "assistant", content: "다듬은 제안문" },
              finish_reason: "stop"
            }
          ],
          usage: {
            prompt_tokens: 40,
            completion_tokens: 12,
            total_tokens: 52
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    });

    const result = await invokeOpenAiCompatible({
      config,
      request: requestForScope(),
      apiKey: "api-secret",
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      requestId: "request-1",
      providerId: "provider-1",
      model: "example-model-2026",
      responseId: "response-1",
      text: "다듬은 제안문",
      finishReason: "stop",
      usage: {
        inputTokens: 40,
        outputTokens: 12,
        totalTokens: 52
      }
    });
  });

  it("refuses a scope changed after user confirmation before any network call", async () => {
    const request = requestForScope();
    const fetchImpl = vi.fn<typeof fetch>();
    const changedRequest: LlmInvocationRequest = {
      ...request,
      scope: {
        ...request.scope,
        manuscriptText: "확인 뒤 바뀐 원고"
      }
    };

    await expect(
      invokeOpenAiCompatible({
        config,
        request: changedRequest,
        apiKey: "api-secret",
        fetchImpl
      })
    ).rejects.toMatchObject({ code: "CONSENT_MISMATCH" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not include provider response bodies, manuscript, or API keys in errors", async () => {
    const privateResponse = `${scope.manuscriptText} api-secret provider-private-message`;
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(privateResponse, { status: 401 })
    );

    let thrown: unknown;
    try {
      await invokeOpenAiCompatible({
        config,
        request: requestForScope(),
        apiKey: "api-secret",
        fetchImpl
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LlmClientError);
    const serialized = JSON.stringify(thrown, Object.getOwnPropertyNames(thrown as object));
    expect(serialized).not.toContain(scope.manuscriptText);
    expect(serialized).not.toContain("api-secret");
    expect(serialized).not.toContain("provider-private-message");
    expect(thrown).toMatchObject({
      code: "AUTHENTICATION_FAILED",
      status: 401,
      retryable: false
    });
  });

  it("rejects an oversized response before parsing it", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response("{}", {
        status: 200,
        headers: { "content-length": String(4 * 1024 * 1024 + 1) }
      })
    );

    await expect(
      invokeOpenAiCompatible({
        config,
        request: requestForScope(),
        apiKey: "api-secret",
        fetchImpl
      })
    ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });

  it("accepts array-form text content used by some compatible providers", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: [
                  { type: "text", text: "첫 문장" },
                  { type: "text", text: " 둘째 문장" }
                ]
              }
            }
          ]
        }),
        { status: 200 }
      )
    );

    const result = await invokeOpenAiCompatible({
      config,
      request: requestForScope(),
      apiKey: "api-secret",
      fetchImpl
    });

    expect(result.text).toBe("첫 문장 둘째 문장");
  });
});
