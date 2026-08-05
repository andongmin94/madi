import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

import {
  FileLlmProviderStore,
  type LlmSecretProtector
} from "../src/main/llm/providerStore";

class TestProtector implements LlmSecretProtector {
  constructor(private available = true) {}

  isAvailable(): boolean {
    return this.available;
  }

  encrypt(secret: string): Uint8Array {
    if (!this.available) {
      throw new Error("unavailable");
    }
    return Buffer.from(`protected:${secret}`, "utf8");
  }

  decrypt(payload: Uint8Array): string {
    if (!this.available) {
      throw new Error("unavailable");
    }
    const source = Buffer.from(payload).toString("utf8");
    if (!source.startsWith("protected:")) {
      throw new Error("invalid");
    }
    return source.slice("protected:".length);
  }

  setAvailable(value: boolean): void {
    this.available = value;
  }
}

const directories: string[] = [];

async function createDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "madi-llm-store-"));
  directories.push(directory);
  return directory;
}

const remoteDraft = {
  id: "remote-provider",
  name: "Remote provider",
  kind: "OPENAI_COMPATIBLE" as const,
  baseUrl: "https://example.com/v1",
  model: "example-model",
  requiresApiKey: true,
  timeoutMs: 30_000,
  maxOutputTokens: 2_048,
  temperature: 0.3
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("FileLlmProviderStore", () => {
  it("persists encrypted credentials outside the project without plaintext leakage", async () => {
    const directory = await createDirectory();
    const store = new FileLlmProviderStore(directory, new TestProtector());
    await store.initialize();

    const created = await store.saveProvider(
      remoteDraft,
      null,
      "private-api-key"
    );

    expect(created.config.revision).toBe(1);
    expect(created.credentialState).toBe("AVAILABLE");
    expect(store.getCredential(remoteDraft.id)).toBe("private-api-key");
    const serialized = await readFile(
      path.join(directory, "providers.json"),
      "utf8"
    );
    expect(serialized).not.toContain("private-api-key");
    expect(serialized).toContain("encryptedCredential");
  });

  it("preserves a credential during a revision-checked config update", async () => {
    const directory = await createDirectory();
    const store = new FileLlmProviderStore(directory, new TestProtector());
    await store.initialize();
    await store.saveProvider(remoteDraft, null, "first-key");

    const updated = await store.saveProvider(
      { ...remoteDraft, name: "Updated provider" },
      1,
      null
    );

    expect(updated.config.revision).toBe(2);
    expect(updated.config.name).toBe("Updated provider");
    expect(store.getCredential(remoteDraft.id)).toBe("first-key");
    await expect(
      store.saveProvider(remoteDraft, 1, null)
    ).rejects.toMatchObject({ code: "REVISION_MISMATCH" });
  });

  it("supports a loopback provider without protected credential storage", async () => {
    const directory = await createDirectory();
    const protector = new TestProtector(false);
    const store = new FileLlmProviderStore(directory, protector);
    await store.initialize();

    const provider = await store.saveProvider(
      {
        ...remoteDraft,
        id: "local-provider",
        name: "Local provider",
        baseUrl: "http://127.0.0.1:11434/v1",
        requiresApiKey: false
      },
      null,
      null
    );

    expect(provider.credentialState).toBe("NOT_REQUIRED");
    expect(store.getCredential(provider.config.id)).toBeNull();
  });

  it("marks an encrypted credential locked when OS protection becomes unavailable", async () => {
    const directory = await createDirectory();
    const protector = new TestProtector();
    const store = new FileLlmProviderStore(directory, protector);
    await store.initialize();
    await store.saveProvider(remoteDraft, null, "private-key");

    protector.setAvailable(false);

    expect(store.listProviders()[0]?.credentialState).toBe("LOCKED");
    expect(() => store.getCredential(remoteDraft.id)).toThrowError(
      /credential storage is unavailable/u
    );
  });

  it("recovers a previously committed backup when the primary JSON is corrupt", async () => {
    const directory = await createDirectory();
    const store = new FileLlmProviderStore(directory, new TestProtector());
    await store.initialize();
    await store.saveProvider(remoteDraft, null, "recoverable-key");
    const primaryPath = path.join(directory, "providers.json");
    const backupPath = path.join(directory, "providers.json.bak");
    const committed = await readFile(primaryPath, "utf8");
    await writeFile(backupPath, committed, "utf8");
    await writeFile(primaryPath, "{broken", "utf8");

    const reopened = new FileLlmProviderStore(directory, new TestProtector());
    await reopened.initialize();

    expect(reopened.listProviders()).toHaveLength(1);
    expect(reopened.getCredential(remoteDraft.id)).toBe("recoverable-key");
  });

  it("deletes provider configuration and its encrypted credential together", async () => {
    const directory = await createDirectory();
    const store = new FileLlmProviderStore(directory, new TestProtector());
    await store.initialize();
    await store.saveProvider(remoteDraft, null, "delete-key");

    await store.deleteProvider(remoteDraft.id, 1);

    expect(store.listProviders()).toEqual([]);
    expect(() => store.getCredential(remoteDraft.id)).toThrowError(
      /does not exist/u
    );
  });
});
