import type {
  LlmInvocationRequest,
  LlmInvocationResult,
  LlmProviderConfig,
  LlmProviderKind
} from "./llm";

export const LLM_IPC_CHANNELS = Object.freeze({
  getStatus: "madi:llm:get-status",
  listProviders: "madi:llm:list-providers",
  saveProvider: "madi:llm:save-provider",
  deleteProvider: "madi:llm:delete-provider",
  testProvider: "madi:llm:test-provider",
  invoke: "madi:llm:invoke",
  cancel: "madi:llm:cancel"
});

export type LlmCredentialState =
  | "NOT_REQUIRED"
  | "AVAILABLE"
  | "MISSING"
  | "LOCKED";

export interface LlmRuntimeStatus {
  readonly providerStore: "AVAILABLE" | "UNAVAILABLE";
  readonly credentialStorage: "AVAILABLE" | "UNAVAILABLE";
}

export interface LlmProviderDraft {
  readonly id: string;
  readonly name: string;
  readonly kind: LlmProviderKind;
  readonly baseUrl: string;
  readonly model: string;
  readonly requiresApiKey: boolean;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
  readonly temperature: number;
}

export interface LlmProviderSummary {
  readonly config: LlmProviderConfig;
  readonly credentialState: LlmCredentialState;
}

export interface SaveLlmProviderRequest {
  readonly provider: LlmProviderDraft;
  readonly expectedRevision: number | null;
  readonly apiKey: string | null;
}

export interface DeleteLlmProviderRequest {
  readonly providerId: string;
  readonly expectedRevision: number;
}

export interface TestLlmProviderRequest {
  readonly requestId: string;
  readonly providerId: string;
  readonly expectedRevision: number;
}

export type LlmProviderTestStatus =
  | "CONNECTED"
  | "CONNECTED_UNEXPECTED_RESPONSE";

export interface LlmProviderTestResult {
  readonly requestId: string;
  readonly providerId: string;
  readonly configuredModel: string;
  readonly responseModel: string;
  readonly status: LlmProviderTestStatus;
  readonly latencyMs: number;
}

export interface InvokeLlmRequest {
  readonly invocation: LlmInvocationRequest;
}

export interface CancelLlmRequest {
  readonly requestId: string;
}

export interface CancelLlmResult {
  readonly cancelled: boolean;
}

export interface MadiLlmApi {
  getStatus(): Promise<LlmRuntimeStatus>;
  listProviders(): Promise<readonly LlmProviderSummary[]>;
  saveProvider(request: SaveLlmProviderRequest): Promise<LlmProviderSummary>;
  deleteProvider(request: DeleteLlmProviderRequest): Promise<void>;
  testProvider(request: TestLlmProviderRequest): Promise<LlmProviderTestResult>;
  invoke(request: InvokeLlmRequest): Promise<LlmInvocationResult>;
  cancel(request: CancelLlmRequest): Promise<CancelLlmResult>;
}
