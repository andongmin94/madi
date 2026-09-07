import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FileLlmProviderStore,
  type LlmSecretProtector
} from "../src/main/llm/providerStore";
import { LlmRuntimeService } from "../src/main/llm/service";

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

describe("LlmRuntimeService disposal", () => {
  it("remains unavailable after disposal and cannot be reinitialized", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "madi-llm-dispose-"));
    directories.push(directory);
    const store = new FileLlmProviderStore(directory, new TestProtector());
    const invoker = vi.fn();
    const service = new LlmRuntimeService(store, invoker);

    await service.initialize();
    expect(service.getStatus()).toEqual({
      providerStore: "AVAILABLE",
      credentialStorage: "AVAILABLE"
    });

    service.dispose();

    expect(service.getStatus()).toEqual({
      providerStore: "UNAVAILABLE",
      credentialStorage: "UNAVAILABLE"
    });
    expect(() => service.listProviders()).toThrowError(/unavailable/u);
    await service.initialize();
    expect(service.getStatus()).toEqual({
      providerStore: "UNAVAILABLE",
      credentialStorage: "UNAVAILABLE"
    });
    expect(() => service.listProviders()).toThrowError(/unavailable/u);
    expect(invoker).not.toHaveBeenCalled();
  });
});
