import type {
  DeleteLlmProviderRequest,
  InvokeLlmRequest,
  LlmProviderSummary,
  LlmRuntimeStatus,
  SaveLlmProviderRequest
} from "../../shared/llmIpc";
import type { LlmInvocationResult } from "../../shared/llm";
import { invokeOpenAiCompatible } from "./openAiCompatibleClient";
import {
  FileLlmProviderStore,
  LlmProviderStoreError
} from "./providerStore";

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

  async saveProvider(request: SaveLlmProviderRequest): Promise<LlmProviderSummary> {
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

  async invoke(request: InvokeLlmRequest): Promise<LlmInvocationResult> {
    this.requireAvailable();
    const requestId = request.invocation.requestId;
    if (this.activeRequests.has(requestId)) {
      throw new Error("An LLM request with this ID is already active");
    }
    const config = this.store.getProvider(request.invocation.providerId);
    const apiKey = this.store.getCredential(config.id);
    const controller = new AbortController();
    this.activeRequests.set(requestId, controller);
    try {
      return await this.invoker({
        config,
        request: request.invocation,
        apiKey,
        signal: controller.signal
      });
    } finally {
      this.activeRequests.delete(requestId);
    }
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

  private requireAvailable(): void {
    if (this.initializationError !== null) {
      throw new LlmProviderStoreError(
        "STORE_UNAVAILABLE",
        "The optional LLM provider store is unavailable."
      );
  }
  }
}
