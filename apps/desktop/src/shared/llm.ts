export const MADI_LLM_PROVIDER_SCHEMA_VERSION = 1 as const;
export const MADI_LLM_MAX_TIMEOUT_MS = 300_000;
export const MADI_LLM_MAX_OUTPUT_TOKENS = 32_768;

export type LlmProviderKind = "OPENAI_COMPATIBLE";
export type LlmTaskKind =
  | "REWRITE_SELECTION"
  | "CONTINUE_SCENE"
  | "SUMMARIZE_SCOPE"
  | "EXTRACT_STORY_BIBLE"
  | "CHECK_CONSISTENCY"
  | "CUSTOM";

export type LlmScopeKind = "SELECTION" | "SCENE" | "CHAPTER" | "CUSTOM";

export interface LlmProviderConfig {
  readonly schemaVersion: typeof MADI_LLM_PROVIDER_SCHEMA_VERSION;
  readonly id: string;
  readonly revision: number;
  readonly name: string;
  readonly kind: LlmProviderKind;
  readonly baseUrl: string;
  readonly model: string;
  readonly credentialId: string | null;
  readonly requiresApiKey: boolean;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
  readonly temperature: number;
}

export interface LlmInvocationScope {
  readonly kind: LlmScopeKind;
  readonly sourceId: string | null;
  readonly manuscriptText: string;
  readonly contextText: string | null;
}

export interface LlmInvocationConsent {
  readonly confirmedAt: string;
  readonly scopeSha256: string;
}

export interface LlmInvocationRequest {
  readonly requestId: string;
  readonly providerId: string;
  readonly expectedProviderRevision: number;
  readonly task: LlmTaskKind;
  readonly systemInstruction: string;
  readonly userInstruction: string;
  readonly scope: LlmInvocationScope;
  readonly consent: LlmInvocationConsent;
}

export interface LlmUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
}

export interface LlmInvocationResult {
  readonly requestId: string;
  readonly providerId: string;
  readonly model: string;
  readonly responseId: string | null;
  readonly text: string;
  readonly finishReason: string | null;
  readonly usage: LlmUsage;
}

export type LlmContractErrorCode =
  | "INVALID_PROVIDER_CONFIG"
  | "UNSAFE_PROVIDER_URL"
  | "INVALID_INVOCATION";

export class LlmContractError extends Error {
  readonly code: LlmContractErrorCode;

  constructor(code: LlmContractErrorCode, message: string) {
    super(message);
    this.name = "LlmContractError";
    this.code = code;
  }
}

const PROVIDER_KEYS = new Set([
  "schemaVersion",
  "id",
  "revision",
  "name",
  "kind",
  "baseUrl",
  "model",
  "credentialId",
  "requiresApiKey",
  "timeoutMs",
  "maxOutputTokens",
  "temperature"
]);

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  value: unknown,
  field: string,
  minimumLength: number,
  maximumLength: number
): string {
  if (typeof value !== "string") {
    throw new LlmContractError(
      "INVALID_PROVIDER_CONFIG",
      `${field} must be a string.`
    );
  }
  const normalized = value.trim();
  if (
    normalized.length < minimumLength ||
    normalized.length > maximumLength ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new LlmContractError(
      "INVALID_PROVIDER_CONFIG",
      `${field} is outside the allowed range.`
    );
  }
  return normalized;
}

function requireInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new LlmContractError(
      "INVALID_PROVIDER_CONFIG",
      `${field} is outside the allowed range.`
    );
  }
  return value as number;
}

function requireNumber(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new LlmContractError(
      "INVALID_PROVIDER_CONFIG",
      `${field} is outside the allowed range.`
    );
  }
  return value;
}

export function isLoopbackLlmUrl(url: URL): boolean {
  return LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
}

export function normalizeLlmBaseUrl(source: string): string {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new LlmContractError(
      "UNSAFE_PROVIDER_URL",
      "Provider URL is not a valid absolute URL."
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new LlmContractError(
      "UNSAFE_PROVIDER_URL",
      "Provider URL must not include credentials, query parameters, or fragments."
    );
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackLlmUrl(url))) {
    throw new LlmContractError(
      "UNSAFE_PROVIDER_URL",
      "Remote providers require HTTPS; HTTP is allowed only for loopback endpoints."
    );
  }
  url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
  return url.toString();
}

export function resolveOpenAiCompatibleChatUrl(config: LlmProviderConfig): string {
  const url = new URL(config.baseUrl);
  const basePath = url.pathname.replace(/\/+$/u, "");
  if (basePath.endsWith("/chat/completions")) {
    return url.toString();
  }
  if (basePath.endsWith("/v1")) {
    url.pathname = `${basePath}/chat/completions`;
    return url.toString();
  }
  const prefix = basePath === "" || basePath === "/" ? "" : basePath;
  url.pathname = `${prefix}/v1/chat/completions`;
  return url.toString();
}

export function parseLlmProviderConfig(value: unknown): LlmProviderConfig {
  if (!isRecord(value)) {
    throw new LlmContractError(
      "INVALID_PROVIDER_CONFIG",
      "Provider config must be an object."
    );
  }
  const unknownKeys = Object.keys(value).filter((key) => !PROVIDER_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new LlmContractError(
      "INVALID_PROVIDER_CONFIG",
      "Provider config contains unsupported fields."
    );
  }
  if (value.schemaVersion !== MADI_LLM_PROVIDER_SCHEMA_VERSION) {
    throw new LlmContractError(
      "INVALID_PROVIDER_CONFIG",
      "Provider config schema version is unsupported."
    );
  }
  if (value.kind !== "OPENAI_COMPATIBLE") {
    throw new LlmContractError(
      "INVALID_PROVIDER_CONFIG",
      "Provider kind is unsupported."
    );
  }
  if (typeof value.requiresApiKey !== "boolean") {
    throw new LlmContractError(
      "INVALID_PROVIDER_CONFIG",
      "requiresApiKey must be a boolean."
    );
  }
  const credentialId =
    value.credentialId === null
      ? null
      : requireString(value.credentialId, "credentialId", 1, 128);
  const config: LlmProviderConfig = {
    schemaVersion: MADI_LLM_PROVIDER_SCHEMA_VERSION,
    id: requireString(value.id, "id", 1, 128),
    revision: requireInteger(value.revision, "revision", 0, Number.MAX_SAFE_INTEGER),
    name: requireString(value.name, "name", 1, 120),
    kind: "OPENAI_COMPATIBLE",
    baseUrl: normalizeLlmBaseUrl(requireString(value.baseUrl, "baseUrl", 1, 2_048)),
    model: requireString(value.model, "model", 1, 256),
    credentialId,
    requiresApiKey: value.requiresApiKey,
    timeoutMs: requireInteger(value.timeoutMs, "timeoutMs", 1_000, MADI_LLM_MAX_TIMEOUT_MS),
    maxOutputTokens: requireInteger(
      value.maxOutputTokens,
      "maxOutputTokens",
      1,
      MADI_LLM_MAX_OUTPUT_TOKENS
    ),
    temperature: requireNumber(value.temperature, "temperature", 0, 2)
  };
  if (config.requiresApiKey && config.credentialId === null) {
    throw new LlmContractError(
      "INVALID_PROVIDER_CONFIG",
      "An API-key provider requires a credential reference."
    );
  }
  return config;
}
