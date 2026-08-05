import {
  type LlmProviderConfig,
  parseLlmProviderConfig
} from "../../shared/llm";
import type { LlmProviderDraft } from "../../shared/llmIpc";
import {
  LLM_PROVIDER_MAX_ENCRYPTED_CREDENTIAL_BYTES,
  LLM_PROVIDER_STORE_MAX_COUNT,
  LLM_PROVIDER_STORE_SCHEMA_VERSION,
  LlmProviderStoreError,
  type StoredLlmProvider,
  type StoredLlmProviderFile
} from "./providerStoreTypes";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function decodeStoredCredential(value: string): Uint8Array {
  if (
    value.length === 0 ||
    value.length > LLM_PROVIDER_MAX_ENCRYPTED_CREDENTIAL_BYTES * 2 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)
  ) {
    throw new LlmProviderStoreError(
      "STORE_CORRUPTED",
      "The encrypted credential record is invalid."
    );
  }
  const bytes = Buffer.from(value, "base64");
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > LLM_PROVIDER_MAX_ENCRYPTED_CREDENTIAL_BYTES ||
    bytes.toString("base64") !== value
  ) {
    throw new LlmProviderStoreError(
      "STORE_CORRUPTED",
      "The encrypted credential record is invalid."
    );
  }
  return bytes;
}

export function encodeEncryptedCredential(bytes: Uint8Array): string {
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > LLM_PROVIDER_MAX_ENCRYPTED_CREDENTIAL_BYTES
  ) {
    throw new LlmProviderStoreError(
      "INVALID_CREDENTIAL",
      "The encrypted provider credential exceeds the safe limit."
    );
  }
  return Buffer.from(bytes).toString("base64");
}

export function parseProviderStore(source: string): StoredLlmProviderFile {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new LlmProviderStoreError(
      "STORE_CORRUPTED",
      "The LLM provider store contains invalid JSON."
    );
  }
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !["schemaVersion", "providers"].includes(key)) ||
    value.schemaVersion !== LLM_PROVIDER_STORE_SCHEMA_VERSION ||
    !Array.isArray(value.providers) ||
    value.providers.length > LLM_PROVIDER_STORE_MAX_COUNT
  ) {
    throw new LlmProviderStoreError(
      "STORE_CORRUPTED",
      "The LLM provider store shape is invalid."
    );
  }
  const ids = new Set<string>();
  const providers = value.providers.map((entry): StoredLlmProvider => {
    if (
      !isRecord(entry) ||
      Object.keys(entry).some((key) => !["config", "encryptedCredential"].includes(key))
    ) {
      throw new LlmProviderStoreError(
        "STORE_CORRRUPTED",
        "An LLM provider record is invalid."
      );
    }
    const config = parseLlmProviderConfig(entry.config);
    if (ids.has(config.id)) {
      throw new LlmProviderStoreError(
        "STORE_CORRUPTED",
        "The LLM provider store contains duplicate IDs."
      );
    }
    ids.add(config.id);
    if (
      entry.encryptedCredential !== null &&
      typeof entry.encryptedCredential !== "string"
    ) {
      throw new LlmProviderStoreError(
        "STORE_CORRRUPTED",
        "An LLM credential record is invalid."
      );
    }
    if (entry.encryptedCredential !== null) {
      decodeStoredCredential(entry.encryptedCredential);
    }
    if (!config.requiresApiKey && entry.encryptedCredential !== null) {
      throw new LlmProviderStoreError(
        "STORE_CORRUPTED",
        "A keyless provider must not retain an encrypted credential."
      );
    }
    return {
      config,
      encryptedCredential: entry.encryptedCredential
    };
  });
  return {
    schemaVersion: LLM_PROVIDER_STORE_SCHEMA_VERSION,
    providers
  };
}

export function draftToProviderConfig(
  draft: LlmProviderDraft,
  revision: number
): LlmProviderConfig {
  return parseLlmProviderConfig({
    schemaVersion: 1,
    id: draft.id,
    revision,
    name: draft.name,
    kind: draft.kind,
    baseUrl: draft.baseUrl,
    model: draft.model,
    credentialId: draft.requiresApiKey ? `provider:${draft.id}` : null,
    requiresApiKey: draft.requiresApiKey,
    timeoutMs: draft.timeoutMs,
    maxOutputTokens: draft.maxOutputTokens,
    temperature: draft.temperature
  });
}

export function serializeProviderStore(
  providers: readonly StoredLlmProvider[]
): string {
  const sorted = [...providers].sort((left, right) =>
    left.config.id.localeCompare(right.config.id)
  );
  return `${JSON.stringify(
    {
      schemaVersion: LLM_PROVIDER_STORE_SCHEMA_VERSION,
      providers: sorted
    },
    null,
    2
  )}\n`;
}
