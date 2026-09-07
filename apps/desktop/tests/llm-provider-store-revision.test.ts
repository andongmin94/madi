import { describe, expect, it } from "vitest";

import { parseProviderStore } from "../src/main/llm/providerStoreFormat";

function serializedStore(revision: number): string {
  return JSON.stringify({
    schemaVersion: 1,
    providers: [
      {
        config: {
          schemaVersion: 1,
          id: "provider-1",
          revision,
          name: "Provider",
          kind: "OPENAI_COMPATIBLE",
          baseUrl: "http://127.0.0.1:11434/v1",
          model: "model",
          credentialId: null,
          requiresApiKey: false,
          timeoutMs: 30_000,
          maxOutputTokens: 1_024,
          temperature: 0.2
        },
        encryptedCredential: null
      }
    ]
  });
}

describe("LLM provider store revisions", () => {
  it("rejects revision zero as a corrupted persisted record", () => {
    expect(() => parseProviderStore(serializedStore(0))).toThrowError(
      /provider revision is invalid/u
    );
  });

  it("accepts the first persisted revision", () => {
    expect(parseProviderStore(serializedStore(1)).providers[0]?.config.revision).toBe(
      1
    );
  });
});
