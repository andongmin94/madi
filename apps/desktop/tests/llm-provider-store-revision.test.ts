import { describe, expect, it } from "vitest";

import { parseProviderStore } from "../src/main/llm/providerStoreFormat";

interface StoreOptions {
  readonly revision?: number;
  readonly requiresApiKey?: boolean;
  readonly credentialId?: string | null;
  readonly encryptedCredential?: string | null;
}

function serializedStore({
  revision = 1,
  requiresApiKey = false,
  credentialId = requiresApiKey ? "provider:provider-1" : null,
  encryptedCredential = requiresApiKey
    ? Buffer.from("protected:key", "utf8").toString("base64")
    : null
}: StoreOptions = {}): string {
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
          credentialId,
          requiresApiKey,
          timeoutMs: 30_000,
          maxOutputTokens: 1_024,
          temperature: 0.2
        },
        encryptedCredential
      }
    ]
  });
}

describe("LLM provider store persisted invariants", () => {
  it("rejects revision zero as a corrupted persisted record", () => {
    expect(() => parseProviderStore(serializedStore({ revision: 0 }))).toThrowError(
      /provider revision is invalid/u
    );
  });

  it("accepts the first persisted revision", () => {
    expect(parseProviderStore(serializedStore()).providers[0]?.config.revision).toBe(
      1
    );
  });

  it("rejects a dangling credential reference on a keyless provider", () => {
    expect(() =>
      parseProviderStore(
        serializedStore({ credentialId: "provider:provider-1" })
      )
    ).toThrowError(/credential reference is invalid/u);
  });

  it("rejects a credential reference that belongs to another provider", () => {
    expect(() =>
      parseProviderStore(
        serializedStore({
          requiresApiKey: true,
          credentialId: "provider:other-provider"
        })
      )
    ).toThrowError(/credential reference is invalid/u);
  });

  it("accepts the canonical credential reference for an API-key provider", () => {
    expect(
      parseProviderStore(serializedStore({ requiresApiKey: true })).providers[0]
        ?.config.credentialId
    ).toBe("provider:provider-1");
  });
});
