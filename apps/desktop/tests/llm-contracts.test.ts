import { describe, expect, it } from "vitest";

import {
  LlmContractError,
  parseLlmProviderConfig,
  resolveOpenAiCompatibleChatUrl
} from "../src/shared/llm";

const baseProvider = {
  schemaVersion: 1,
  id: "provider-1",
  revision: 3,
  name: "My provider",
  kind: "OPENAI_COMPATIBLE",
  baseUrl: "https://example.com/v1",
  model: "example-model",
  credentialId: "credential-1",
  requiresApiKey: true,
  timeoutMs: 30_000,
  maxOutputTokens: 2_048,
  temperature: 0.4
} as const;

describe("madi LLM provider contracts", () => {
  it("normalizes a remote HTTPS provider without exposing a secret", () => {
    const config = parseLlmProviderConfig(baseProvider);

    expect(config.baseUrl).toBe("https://example.com/v1");
    expect(resolveOpenAiCompatibleChatUrl(config)).toBe(
      "https://example.com/v1/chat/completions"
    );
    expect(config).not.toHaveProperty("apiKey");
  });

  it("allows loopback HTTP for a user-owned local model", () => {
    const config = parseLlmProviderConfig({
      ...baseProvider,
      baseUrl: "http://127.0.0.1:11434/v1/",
      credentialId: null,
      requiresApiKey: false
    });

    expect(config.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(resolveOpenAiCompatibleChatUrl(config)).toBe(
      "http://127.0.0.1:11434/v1/chat/completions"
    );
  });

  it.each([
    "http://example.com/v1",
    "ftp://example.com/v1",
    "https://user:secret@example.com/v1",
    "https://example.com/v1?token=secret",
    "https://example.com/v1#fragment"
  ])("rejects an unsafe provider URL: %s", (baseUrl) => {
    expect(() =>
      parseLlmProviderConfig({
        ...baseProvider,
        baseUrl
      })
    ).toThrowError(LlmContractError);
  });

  it("rejects unknown fields and missing credential references", () => {
    expect(() =>
      parseLlmProviderConfig({
        ...baseProvider,
        apiKey: "must-not-live-in-config"
      })
    ).toThrowError(/unsupported fields/u);

    expect(() =>
      parseLlmProviderConfig({
        ...baseProvider,
        credentialId: null
      })
    ).toThrowError(/credential reference/u);
  });

  it("adds the OpenAI-compatible path below a custom base path", () => {
    const config = parseLlmProviderConfig({
      ...baseProvider,
      baseUrl: "https://example.com/gateway"
    });

    expect(resolveOpenAiCompatibleChatUrl(config)).toBe(
      "https://example.com/gateway/v1/chat/completions"
    );
  });
});
