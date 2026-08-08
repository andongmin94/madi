import { performance } from "node:perf_hooks";

import type {
  LlmInvocationRequest,
  LlmInvocationResult,
  LlmInvocationScope
} from "../../shared/llm";
import type {
  DeleteLlmProviderRequest,
  InvokeLlmRequest,
  LlmProviderSummary,
  LlmProviderTestResult,
  LlmRuntimeStatus,
  SaveLlmProviderRequest,
  TestLlmProviderRequest
} from "../../shared/llmIpc";
import {
  createLlmScopeSha256,
  invokeOpenAiCompatible
} from "./openAiCompatibleClient";
import {
  FileLlmProviderStore,
  LlmProviderStoreError
} from "./providerStore";

const PROVIDER_TEST_EXPECTED_TEXT = "MADI_OK";
const PROVIDER_TEST_SYSTEM_INSTRUCTION =
  "This is a connectivity test. Do not infer or request manuscript content. Reply with exactly MADI_OK.";
const PROVIDER_TEST_USER_INSTRUCTION = "Reply with exactly MADI_OK.";

export type LlmInvoker = typeof invokeOpenAiCompatible;

export class LlmRuntimeService {
  private readonly activeRequests = new Map<string, AbortController>();
  private initializationError: Error | null = null;

  constructor(
    private readonly store: FileLlmProviderStore,
    private readonly invoker: LlmInvoker = invokeOpenAiCompatible
  ) {}

  async initialize(): Promise<void> {
    try {
      await this.store.initialize();
      this.initializationError = null;
    } catch (error) {
      this.initializationError =
        error instanceof Error ? error : new Error("LLM provider store failed");
    }
  }

  getStatus(): LlmRuntimeStatus {
    return {
      providerStore: this.initializationError === null ? "AVAILABLE" : "UNAVAILABLE",
      credentialStorage: this.store.isCredentialStorageAvailable()
        ? "AVAILABLE"
        : "UNAVAILABLE"
    };
  }

  listProviders(): readonly LlmProviderSummary[] {
    this.requireAvailable();
    return this.store.listProviders();
  }

  async saveProvider(
    request: SaveLlmProviderRequest
  ): Promise<LlmProviderSummary> {
    this.requireAvailable();
    return this.store.saveProvider(
      request.provider,
      request.expectedRevision,
      request.apiKey
    );
  }

  async deleteProvider(request: DeleteLlmProviderRequest): Promise<void> {
    this.requireAvailable();
    await this.store.deleteProvider(
      request.providerId,
      request.expectedRevision
    );
  }

  async testProvider(
    request: TestLlmProviderRequest
  ): Promise<LlmProviderTestResult> {
    this.requireAvailable();
    const config = this.store.getProvider(request.providerId);
    const apiKey = this.store.getCredential(config.id);
    const scope: LlmInvocationScope = {
      kind: "CUSTOM",
      sourceId: "madi-provider-connectivity-test-v1",
      manuscriptText: "",
      contextText: null
    };
    const invocation: LlmInvocationRequest = {
      requestId: request.requestId,
      providerId: config.id,
      expectedProviderRevision: request.expectedRevision,
      task: "CUSTOM",
      systemInstruction: PROVIDER_TEST_SYSTEM_INSTRUCTION,
      userInstruction: PROVIDER_TEST_USER_INSTRUCTION,
      scope,
      consent: {
        confirmedAt: new Date().toISOString(),
        scopeSha256: createLlmScopeSha256(scope)
      }
    };
    const startedAt = performance.now();
    const result = await this.runActiveRequest(request.requestId, (signal) =>
      this.invoker({ config, request: invocation, apiKey, signal })
    );
    const latencyMs = Math.max(
      0,
      Math.round((performance.now() - startedAt) * 100) / 100
    );
    return {
      requestId: request.requestId,
      providerId: config.id,
      configuredModel: config.model,
      responseModel: result.model,
      status:
        result.text.trim() === PROVIDER_TEST_EXPECTED_TEXT
          ? "CONNECTED"
          : "CONNECTED_UNEXPECTED_RESPONSE",
      latencyMs
    };
  }

  async invoke(request: InvokeLlmRequest): Promise<LlmInvocationResult> {
    this.requireAvailable();
    const config = this.store.getProvider(request.invocation.providerId);
    const apiKey = this.store.getCredential(config.id);
    return this.runActiveRequest(request.invocation.requestId, (signal) =>
      this.invoker({
        config,
        request: request.invocation,
        apiKey,
        signal
      })
    );
  }

  cancel(requestId: string): boolean {
    const controller = this.activeRequests.get(requestId);
    if (!controller) {
      return false;
    }
    controller.abort();
    return true;
  }

  dispose(): void {
    for (const controller of this.activeRequests.values()) {
      controller.abort();
    }
    this.activeRequests.clear();
  }

  private async runActiveRequest<TResult>(
    requestId: string,
    run: (signal: AbortSignal) => Promise<TResult>
  ): Promise<TResult> {
    if (this.activeRequests.has(requestId)) {
      throw new Error("An LLM request with this ID is already active");
    }
    const controller = new AbortController();
    this.activeRequests.set(requestId, controller);
    try {
      return await run(controller.signal);
    } finally {
      this.activeRequests.delete(requestId);
    }
  }

  private requireAvailable(): void {
    if (this.initializationError !== null) {
      throw new LlmProviderStoreError(
        "STORE_UNAVAILABLE",
        "The optional LLM provider store is unavailable."
      );
    }
  }
}
