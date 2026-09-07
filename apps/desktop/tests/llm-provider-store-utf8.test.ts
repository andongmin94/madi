import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { LlmProviderFileRepository } from "../src/main/llm/providerStoreFile";

const directories: string[] = [];

async function createDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "madi-llm-store-utf8-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("LLM provider store UTF-8 boundary", () => {
  it("rejects malformed UTF-8 instead of accepting replacement characters", async () => {
    const directory = await createDirectory();
    const prefix = Buffer.from(
      '{"schemaVersion":1,"providers":[{"config":{"schemaVersion":1,"id":"local-provider","revision":1,"name":"',
      "utf8"
    );
    const invalidUtf8 = Buffer.from([0x80]);
    const suffix = Buffer.from(
      '","kind":"OPENAI_COMPATIBLE","baseUrl":"http://127.0.0.1:11434/v1","model":"model","credentialId":null,"requiresApiKey":false,"timeoutMs":30000,"maxOutputTokens":1024,"temperature":0.2},"encryptedCredential":null}]}',
      "utf8"
    );
    await writeFile(
      path.join(directory, "providers.json"),
      Buffer.concat([prefix, invalidUtf8, suffix])
    );

    const repository = new LlmProviderFileRepository(directory);

    await expect(repository.load()).rejects.toMatchObject({
      code: "STORE_CORRUPTED"
    });
  });
});
