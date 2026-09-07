import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
    return Buffer.from(secret, "utf8");
  }

  decrypt(payload: Uint8Array): string {
    return Buffer.from(payload).toString("utf8");
  }
}

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("LLM provider store path integrity", () => {
  it("does not treat an occupied non-file store path as an empty store", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "madi-llm-path-"));
    directories.push(directory);
    await mkdir(path.join(directory, "providers.json"));
    const store = new FileLlmProviderStore(directory, new TestProtector());

    await expect(store.initialize()).rejects.toMatchObject({
      code: "STORE_CORRUPTED"
    });
  });
});
