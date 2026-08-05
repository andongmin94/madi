import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLlmScopeSha256 } from "../src/main/llm/openAiCompatibleClient";
import {
  FileLlmProviderStore,
  type LlmSecretProtector
} from "../src/main/llm/providerStore";
import {
  LlmRuntimeService,
  type LlmInvoker
} from "../src/main/llm/service";

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

async function createService(invoker: LlmInvoker) {
  const directory = await mkdtemp(path.join(tmpdir(), "madi-llm-service-"));
  directories.push(directory);
  const store = new FileLlmProviderStore(directory, new TestProtector());
  const service = new LlmRuntimeService(store, invoker);
  await service.initialize();
  await service.saveProvider({
    provider: {
      id: "provider-1",
      name: "Provider",
      kind: "OPENAI_COMPATIBLE",
      baseUrl: "https://example.com/v1",
      model: "model",
      requiresApiKey: true,
      timeoutMs: 30_000,
      maxOutputTokens: 1_024,
      temperature: 0.2
    },
    expectedRevision: null,
    apiKey: "api-key"
  });
  return service;
}

function invocation(requestId = "request-1") {
  const scope = {
    kind: "SELECTION" as const,
    sourceId: "scene-1",
    manuscriptText: "선택한 원고",
    contextText: null
  };
  return {
    invocation: {
      requestId,
      providerId: "provider-1",
      expectedProviderRevision: 1,
      task: "REWRITE_SELECTION" as const,
      systemInstruction: "",
      userInstruction: "다듬어 주세요.",
      scope,
      consent: {
        confirmedAt: "2026-08-22T10:00:00.000Z",
        scopeSha256: createLlmScopeSha256(scope)
      }
    }
  };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("LlmRuntimeService", () => {
  it("resolves config and protected credential before invoking the provider", async () => {
    const invoker = vi.fn(async ({ config, apiKey, request }) => ({
      requestId: request.requestId,
      providerId: config.id,
      model: config.model,
      responseId: null,
      text: "제안문",
      finishReason: "stop",
      usage: { inputTokens: null, outputTokens: null, totalTokens: null }
    }));
    const service = await createService(invoker);

    const result = await service.invoke(invocation());

    expect(result.text).toBe("제안문");
    expect(invoker).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "api-key",
        config: expect.objectContaining({ revision: 1 })
      })
    );
  });

  it("cancels an active request without retaining it", async () => {
    const invoker = vi.fn(
      ({ signal }: Parameters<LlmInvoker>[0]) =>
        new Promise<never>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("cancelled"), { code: "CANCELLED" })),
            { once: true }
          );
        })
    );
    const service = await createService(invoker);
    const pending = service.invoke(invocation("cancel-me"));

    expect(service.cancel("cancel-me")).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect(service.cancel("cancel-me")).toBe(false);
  });

  it("keeps the rest of the app usable when the optional provider store cannot initialize", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "madi-llm-unavailable-"));
    directories.push(directory);
    const invalidDirectoryPath = path.join(directory, "not-a-directory");
    await writeFile(invalidDirectoryPath, "occupied", "utf8");
    const store = new FileLlmProviderStore(
      invalidDirectoryPath,
      new TestProtector()
    );
    const service = new LlmRuntimeService(store, vi.fn());

    await service.initialize();

    expect(service.getStatus().providerStore).toBe("UNAVAILABLE");
    expect(() => service.listProviders()).toThrowError(/unavailable/u);
  });
});
