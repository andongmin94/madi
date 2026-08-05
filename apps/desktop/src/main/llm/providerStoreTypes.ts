import type { LlmProviderConfig } from "../../shared/llm";

export const LLM_PROVIDER_STORE_SCHEMA_VERSION = 1 as const;
export const LLM_PROVIDER_STORE_FILE_NAME = "providers.json";
export const LLM_PROVIDER_STORE_BACKUP_FILE_NAME = "providers.json.bak";
export const LLM_PROVIDER_STORE_MAX_BYTES = 2 * 1024 * 1024;
export const LLM_PROVIDER_STORE_MAX_COUNT = 100;
export const LLM_PROVIDER_MAX_ENCRYPTED_CREDENTIAL_BYTES = 16 * 1024;

export interface LlmSecretProtector {
  isAvailable(): boolean;
  encrypt(secret: string): Uint8Array;
  decrypt(payload: Uint8Array): string;
}

export interface StoredLlmProvider {
  readonly config: LlmProviderConfig;
  readonly encryptedCredential: string | null;
}

export interface StoredLlmProviderFile {
  readonly schemaVersion: typeof LLM_PROVIDER_STORE_SCHEMA_VERSION;
  readonly providers: readonly StoredLlmProvider[];
}

export type LlmProviderStoreErrorCode =
  | "STORE_UNAVAILABLE"
  | "STORE_CORRUPTED"
  | "PROVIDER_EXISTS"
  | "PROVIDER_NOT_FOUND"
  | "REVISION_MISMATCH"
  | "CREDENTIAL_STORAGE_UNAVAILABLE"
  | "CREDENTIAL_REQUIRED"
  | "INVALID_CREDENTIAL";

export class LlmProviderStoreError extends Error {
  readonly code: LlmProviderStoreErrorCode;

  constructor(code: LlmProviderStoreErrorCode, message: string) {
    super(message);
    this.name = "LlmProviderStoreError";
    this.code = code;
  }
}
