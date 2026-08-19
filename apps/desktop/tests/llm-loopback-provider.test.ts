// @vitest-environment node

import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import {
  createLlmScopeSha256,
  invokeOpenAiCompatible
} from "../src/main/llm/openAiCompatibleClient";
import {
  type LlmInvocationRequest,
  type LlmInvocationScope,
  parseLlmProviderConfig
} from "../src/shared/llm";

const servers: Server[] = [];

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
});

describe("actual loopback OpenAI-compatible transport", () => {
  it("posts a fixed connectivity scope to localhost and parses the response", async () => {
    let observedPath = "";
    let observedAuthorization: string | undefined;
    let observedBody = "";
    const server = createServer(async (request, response) => {
      observedPath = request.url ?? "";
      observedAuthorization = request.headers.authorization;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      observedBody = Buffer.concat(chunks).toString("utf8");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "loopback-response-1",
          model: "loopback-model",
          choices: [
            {
              message: { role: "assistant", content: "MADI_OK" },
              finish_reason: "stop"
            }
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 2,
            total_tokens: 14
          }
        })
      );
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("loopback server did not expose a TCP port");
    }

    const config = parseLlmProviderConfig({
      schemaVersion: 1,
      id: "loopback-provider",
      revision: 1,
      name: "Loopback provider",
      kind: "OPENAI_COMPATIBLE",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      model: "loopback-model",
      credentialId: null,
      requiresApiKey: false,
      timeoutMs: 5_000,
      maxOutputTokens: 128,
      temperature: 0
    });
    const scope: LlmInvocationScope = {
      kind: "CUSTOM",
      sourceId: "madi-provider-connectivity-test-v1",
      manuscriptText: "",
      contextText: null
    };
    const invocation: LlmInvocationRequest = {
      requestId: "loopback-request-1",
      providerId: config.id,
      expectedProviderRevision: config.revision,
      task: "CUSTOM",
      systemInstruction:
        "This is a connectivity test. Reply with exactly MADI_OK.",
      userInstruction: "Reply with exactly MADI_OK.",
      scope,
      consent: {
        confirmedAt: "2026-08-22T10:00:00.000Z",
        scopeSha256: createLlmScopeSha256(scope)
      }
    };

    const result = await invokeOpenAiCompatible({
      config,
      request: invocation,
      apiKey: null
    });

    expect(result).toMatchObject({
      requestId: "loopback-request-1",
      providerId: "loopback-provider",
      model: "loopback-model",
      text: "MADI_OK",
      finishReason: "stop",
      usage: {
        inputTokens: 12,
        outputTokens: 2,
        totalTokens: 14
      }
    });
    expect(observedPath).toBe("/v1/chat/completions");
    expect(observedAuthorization).toBeUndefined();
    expect(observedBody).toContain("MADI_OK");
    expect(observedBody).not.toContain("SECRET_MANUSCRIPT_SENTINEL");
    const parsed = JSON.parse(observedBody) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(parsed.messages.at(-1)?.content).toContain("[작업 대상 원고]\n");
  });
});
