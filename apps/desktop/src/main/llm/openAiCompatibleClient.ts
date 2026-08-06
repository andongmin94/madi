import { createHash } from "node:crypto";

import {
  type LlmInvocationRequest,
  type LlmInvocationResult,
  type LlmInvocationScope,
  type LlmProviderConfig,
  resolveOpenAiCompatibleChatUrl,
  serializeLlmScopeForConsent
} from "../../shared/llm";

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_MANUSCRIPT_CHARACTERS = 1_000_000;
const MAX_CONTEXT_CHARACTERS = 200_000;
const MAX_INSTRUCTION_CHARACTERS = 32_000;

export type LlmClientErrorCode =
  | "INVALID_REQUEST"
  | "CONSENT_MISMATCH"
  | "MISSING_API_KEY"
  | "INVALID_API_KEY"
  | "CANCELLED"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "AUTHENTICATION_FAILED"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_REJECTED"
  | "RESPONSE_TOO_LARGE"
  | "INVALID_PROVIDER_RESPONSE";

export class LlmClientError extends Error {
  readonly code: LlmClientErrorCode;
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(
    code: LlmClientErrorCode,
    message: string,
    options: { readonly status?: number; readonly retryable?: boolean } = {}
  ) {
    super(message);
    this.name = "LlmClientError";
    this.code = code;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
  }
}

export interface OpenAiCompatibleInvocationOptions {
  readonly config: LlmProviderConfig;
  readonly request: LlmInvocationRequest;
  readonly apiKey: string | null;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createLlmScopeSha256(scope: LlmInvocationScope): string {
  return createHash("sha256")
    .update(serializeLlmScopeForConsent(scope), "utf8")
    .digest("hex");
}

function validateTextLength(value: string, maximum: number, field: string): void {
  if (value.length > maximum || /\u0000/u.test(value)) {
    throw new LlmClientError(
      "INVALID_REQUEST",
      `${field} is outside the allowed range.`
    );
  }
}

function validateInvocation(
  config: LlmProviderConfig,
  request: LlmInvocationRequest
): void {
  if (
    request.providerId !== config.id ||
    request.expectedProviderRevision !== config.revision ||
    request.requestId.trim().length === 0 ||
    request.requestId.length > 128
  ) {
    throw new LlmClientError(
      "INVALID_REQUEST",
      "The provider or request revision no longer matches."
    );
  }
  validateTextLength(
    request.systemInstruction,
    MAX_INSTRUCTION_CHARACTERS,
    "System instruction"
  );
  validateTextLength(
    request.userInstruction,
    MAX_INSTRUCTION_CHARACTERS,
    "User instruction"
  );
  validateTextLength(
    request.scope.manuscriptText,
    MAX_MANUSCRIPT_CHARACTERS,
    "Manuscript scope"
  );
  if (request.scope.contextText !== null) {
    validateTextLength(
      request.scope.contextText,
      MAX_CONTEXT_CHARACTERS,
      "Context scope"
    );
  }
  const confirmedAt = Date.parse(request.consent.confirmedAt);
  if (!Number.isFinite(confirmedAt)) {
    throw new LlmClientError(
      "INVALID_REQUEST",
      "The explicit-consent timestamp is invalid."
    );
  }
  const currentScopeHash = createLlmScopeSha256(request.scope);
  if (
    !/^[0-9a-f]{64}$/u.test(request.consent.scopeSha256) ||
    request.consent.scopeSha256 !== currentScopeHash
  ) {
    throw new LlmClientError(
      "CONSENT_MISMATCH",
      "The selected manuscript scope changed after confirmation."
    );
  }
}

function validateApiKey(
  config: LlmProviderConfig,
  apiKey: string | null
): string | null {
  const normalized = apiKey?.trim() ?? "";
  if (config.requiresApiKey && normalized.length === 0) {
    throw new LlmClientError(
      "MISSING_API_KEY",
      "This provider requires an API key."
    );
  }
  if (normalized.length > 4_096 || /[\r\n\u0000]/u.test(normalized)) {
    throw new LlmClientError(
      "INVALID_API_KEY",
      "The API key is outside the allowed range."
    );
  }
  return normalized.length === 0 ? null : normalized;
}

function buildUserContent(request: LlmInvocationRequest): string {
  const sections = [request.userInstruction.trim()];
  if (
    request.scope.contextText !== null &&
    request.scope.contextText.length > 0
  ) {
    sections.push(`[참고 컨텍스트]\n${request.scope.contextText}`);
  }
  sections.push(`[작업 대상 원고]\n${request.scope.manuscriptText}`);
  return sections.filter((section) => section.length > 0).join("\n\n");
}

function buildRequestBody(
  config: LlmProviderConfig,
  request: LlmInvocationRequest
): Record<string, unknown> {
  const messages: Array<Record<string, string>> = [];
  if (request.systemInstruction.trim().length > 0) {
    messages.push({
      role: "system",
      content: request.systemInstruction.trim()
    });
  }
  messages.push({ role: "user", content: buildUserContent(request) });
  return {
    model: config.model,
    messages,
    temperature: config.temperature,
    max_tokens: config.maxOutputTokens,
    stream: false
  };
}

async function readResponseBytes(response: Response): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (Number.isFinite(parsedLength) && parsedLength > MAX_RESPONSE_BYTES) {
      throw new LlmClientError(
        "RESPONSE_TOO_LARGE",
        "The provider response exceeds the safe limit."
      );
    }
  }
  if (response.body === null) {
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    const chunk = result.value;
    total += chunk.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new LlmClientError(
        "RESPONSE_TOO_LARGE",
        "The provider response exceeds the safe limit."
      );
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function parseProviderJson(response: Response): Promise<unknown> {
  const bytes = await readResponseBytes(response);
  if (bytes.byteLength === 0) {
    return null;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    );
  } catch {
    throw new LlmClientError(
      "INVALID_PROVIDER_RESPONSE",
      "The provider returned an invalid JSON response."
    );
  }
}

function providerStatusError(status: number): LlmClientError {
  if (status === 401 || status === 403) {
    return new LlmClientError(
      "AUTHENTICATION_FAILED",
      "The provider rejected the configured credential.",
      { status }
    );
  }
  if (status === 429) {
    return new LlmClientError(
      "RATE_LIMITED",
      "The provider is rate limiting requests.",
      { status, retryable: true }
    );
  }
  if (status >= 500) {
    return new LlmClientError(
      "PROVIDER_UNAVAILABLE",
      "The provider is temporarily unavailable.",
      { status, retryable: true }
    );
  }
  return new LlmClientError(
    "PROVIDER_REJECTED",
    "The provider rejected the request.",
    { status }
  );
}

function textFromContent(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const parts = value.flatMap((part) => {
    if (
      !isRecord(part) ||
      part.type !== "text" ||
      typeof part.text !== "string"
    ) {
      return [];
    }
    return [part.text];
  });
  return parts.length === 0 ? null : parts.join("");
}

function optionalTokenCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : null;
}

function parseInvocationResult(
  config: LlmProviderConfig,
  request: LlmInvocationRequest,
  payload: unknown
): LlmInvocationResult {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    throw new LlmClientError(
      "INVALID_PROVIDER_RESPONSE",
      "The provider response does not contain an assistant choice."
    );
  }
  const firstChoice = payload.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    throw new LlmClientError(
      "INVALID_PROVIDER_RESPONSE",
      "The provider response does not contain an assistant message."
    );
  }
  const text = textFromContent(firstChoice.message.content);
  if (text === null) {
    throw new LlmClientError(
      "INVALID_PROVIDER_RESPONSE",
      "The provider response does not contain text output."
    );
  }
  const usage = isRecord(payload.usage) ? payload.usage : {};
  return {
    requestId: request.requestId,
    providerId: config.id,
    model: typeof payload.model === "string" ? payload.model : config.model,
    responseId: typeof payload.id === "string" ? payload.id : null,
    text,
    finishReason:
      typeof firstChoice.finish_reason === "string"
        ? firstChoice.finish_reason
        : null,
    usage: {
      inputTokens: optionalTokenCount(usage.prompt_tokens),
      outputTokens: optionalTokenCount(usage.completion_tokens),
      totalTokens: optionalTokenCount(usage.total_tokens)
    }
  };
}

export async function invokeOpenAiCompatible(
  options: OpenAiCompatibleInvocationOptions
): Promise<LlmInvocationResult> {
  validateInvocation(options.config, options.request);
  const apiKey = validateApiKey(options.config, options.apiKey);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.config.timeoutMs);
  const onExternalAbort = (): void => controller.abort();
  if (options.signal?.aborted) {
    controller.abort();
  } else {
    options.signal?.addEventListener("abort", onExternalAbort, { once: true });
  }
  try {
    const headers = new Headers({
      "content-type": "application/json",
      accept: "application/json"
    });
    if (apiKey !== null) {
      headers.set("authorization", `Bearer ${apiKey}`);
    }
    const response = await (options.fetchImpl ?? fetch)(
      resolveOpenAiCompatibleChatUrl(options.config),
      {
        method: "POST",
        headers,
        body: JSON.stringify(buildRequestBody(options.config, options.request)),
        redirect: "error",
        signal: controller.signal
      }
    );
    if (!response.ok) {
      await readResponseBytes(response).catch(() => new Uint8Array());
      throw providerStatusError(response.status);
    }
    const payload = await parseProviderJson(response);
    return parseInvocationResult(options.config, options.request, payload);
  } catch (error) {
    if (error instanceof LlmClientError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new LlmClientError(
        timedOut ? "TIMEOUT" : "CANCELLED",
        timedOut
          ? "The provider request timed out."
          : "The provider request was cancelled.",
        { retryable: timedOut }
      );
    }
    throw new LlmClientError(
      "NETWORK_ERROR",
      "The provider request could not be completed.",
      { retryable: true }
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}
