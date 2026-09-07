import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  FileLlmProviderStore,
  type LlmSecretProtector
} from "../src/main/llm/providerStore";

class TestProtector implements LlmSecretProtector {
  isAvailable(): boolean {
    return true;
  }

  encrypt(secret: string): Uint8Array {
    return Buffer.from(`protected:${secret}`, "utf8");
  }

  decrypt(payload: Uint8Array): string {
    return Buffer.from(payload).toString("utf8").slice("protected:".length);
  }
}

const directories: string[] = [];

const providerDraft = {
  id: "provider-1",
  name: "Original provider",
  kind: "OPENAI_COMPATIBLE" as const,
  baseUrl: "https://example.com/v1",
  model: "model",
  requiresApiKey: true,
  timeoutMs: 30_000,
  maxOutputTokens: 1_024,
  temperature: 0.2
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("LLM provider identity canonicalization", () => {
  it("rejects a duplicate whose raw id normalizes to an existing provider", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "madi-llm-id-"));
    directories.push(directory);
    const store = new FileLlmProviderStore(directory, new TestProtector());
    await store.initialize();
    await store.saveProvider(providerDraft, null, "original-key");

    await expect(
      store.saveProvider(
        {
          ...providerDraft,
          id: " provider-1 ",
          name: "Replacement provider"
        },
        null,
        "replacement-key"
      )
    ).rejects.toMatchObject({ code: "PROVIDER_EXISTS" });

    expect(store.listProviders()).toHaveLength(1);
    expect(store.getProvider("provider-1").name).toBe("Original provider");
    expect(store.getCredential("provider-1")).toBe("original-key");
  });

  it("uses the same canonical identity for revision-checked updates", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "madi-llm-id-"));
    directories.push(directory);
    const store = new FileLlmProviderStore(directory, new TestProtector());
    await store.initialize();
    await store.saveProvider(providerDraft, null, "original-key");

    const updated = await store.saveProvider(
      {
        ...providerDraft,
        id: " provider-1 ",
        name: "Updated provider"
      },
      1,
      null
    );

    expect(updated.config.id).toBe("provider-1");
    expect(updated.config.revision).toBe(2);
    expect(updated.config.name).toBe("Updated provider");
    expect(store.getCredential("provider-1")).toBe("original-key");
  });
});
