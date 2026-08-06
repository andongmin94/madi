import type { LlmProviderConfig } from "../../shared/llm";
import type {
  LlmCredentialState,
  LlmProviderDraft,
  LlmProviderSummary
} from "../../shared/llmIpc";
import {
  decodeStoredCredential,
  draftToProviderConfig,
  encodeEncryptedCredential
} from "./providerStoreFormat";
import { LlmProviderFileRepository } from "./providerStoreFile";
import {
  LlmProviderStoreError,
  type LlmSecretProtector,
  type StoredLlmProvider
} from "./providerStoreTypes";

export {
  LlmProviderStoreError,
  type LlmSecretProtector
} from "./providerStoreTypes";

export class FileLlmProviderStore {
  private readonly repository: LlmProviderFileRepository;
  private providers = new Map<string, StoredLlmProvider>();
  private initialized = false;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    directoryPath: string,
    private readonly protector: LlmSecretProtector
  ) {
    this.repository = new LlmProviderFileRepository(directoryPath);
  }

  isCredentialStorageAvailable(): boolean {
    return this.protector.isAvailable();
  }

  async initialize(): Promise<void> {
    const providers = await this.repository.load();
    this.providers = new Map(
      providers.map((provider) => [provider.config.id, provider])
    );
    this.initialized = true;
  }

  listProviders(): readonly LlmProviderSummary[] {
    this.requireInitialized();
    return [...this.providers.values()]
      .sort((left, right) => left.config.name.localeCompare(right.config.name))
      .map((provider) => this.summary(provider));
  }

  getProvider(providerId: string): LlmProviderConfig {
    return { ...this.requireProvider(providerId).config };
  }

  getCredential(providerId: string): string | null {
    const provider = this.requireProvider(providerId);
    if (!provider.config.requiresApiKey) {
      return null;
    }
    if (provider.encryptedCredential === null) {
      throw new LlmProviderStoreError(
        "CREDENTIAL_REQUIRED",
        "The provider has no stored credential."
      );
    }
    if (!this.protector.isAvailable()) {
      throw new LlmProviderStoreError(
        "CREDENTIAL_STORAGE_UNAVAILABLE",
        "Protected credential storage is unavailable."
      );
    }
    try {
      const secret = this.protector.decrypt(
        decodeStoredCredential(provider.encryptedCredential)
      );
      if (
        secret.trim().length === 0 ||
        secret.length > 4_096 ||
        /[\r\n\u0000]/u.test(secret)
      ) {
        throw new Error("invalid secret");
      }
      return secret;
    } catch {
      throw new LlmProviderStoreError(
        "INVALID_CREDENTIAL",
        "The stored provider credential could not be decrypted."
      );
    }
  }

  async saveProvider(
    draft: LlmProviderDraft,
    expectedRevision: number | null,
    apiKey: string | null
  ): Promise<LlmProviderSummary> {
    return this.enqueueMutation(async () => {
      const current = this.providers.get(draft.id);
      if (expectedRevision === null) {
        if (current) {
          throw new LlmProviderStoreError(
            "PROVIDER_EXISTS",
            "A provider with this ID already exists."
          );
        }
      } else if (!current) {
        throw new LlmProviderStoreError(
          "PROVIDER_NOT_FOUND",
          "The provider no longer exists."
        );
      } else if (current.config.revision !== expectedRevision) {
        throw new LlmProviderStoreError(
          "REVISION_MISMATCH",
          "The provider changed before it could be saved."
        );
      }
      const revision = current ? current.config.revision + 1 : 1;
      const config = draftToProviderConfig(draft, revision);
      const encryptedCredential = this.resolveEncryptedCredential(
        config,
        current,
        apiKey
      );
      const next: StoredLlmProvider = { config, encryptedCredential };
      const nextProviders = new Map(this.providers);
      nextProviders.set(config.id, next);
      await this.repository.write([...nextProviders.values()]);
      this.providers = nextProviders;
      return this.summary(next);
    });
  }

  async deleteProvider(
    providerId: string,
    expectedRevision: number
  ): Promise<void> {
    await this.enqueueMutation(async () => {
      const current = this.requireProvider(providerId);
      if (current.config.revision !== expectedRevision) {
        throw new LlmProviderStoreError(
          "REVISION_MISMATCH",
          "The provider changed before it could be deleted."
        );
      }
      const nextProviders = new Map(this.providers);
      nextProviders.delete(providerId);
      await this.repository.write([...nextProviders.values()]);
      this.providers = nextProviders;
    });
  }

  private resolveEncryptedCredential(
    config: LlmProviderConfig,
    current: StoredLlmProvider | undefined,
    apiKey: string | null
  ): string | null {
    if (!config.requiresApiKey) {
      return null;
    }
    const normalizedKey = apiKey?.trim() ?? "";
    if (normalizedKey.length > 0) {
      if (
        normalizedKey.length > 4_096 ||
        /[\r\n\u0000]/u.test(normalizedKey)
      ) {
        throw new LlmProviderStoreError(
          "INVALID_CREDENTIAL",
          "The provider credential is outside the allowed range."
        );
      }
      if (!this.protector.isAvailable()) {
        throw new LlmProviderStoreError(
          "CREDENTIAL_STORAGE_UNAVAILABLE",
          "Protected credential storage is unavailable."
        );
      }
      return encodeEncryptedCredential(this.protector.encrypt(normalizedKey));
    }
    if (current?.encryptedCredential) {
      return current.encryptedCredential;
    }
    throw new LlmProviderStoreError(
      "CREDENTIAL_REQUIRED",
      "An API key is required for this provider."
    );
  }

  private summary(provider: StoredLlmProvider): LlmProviderSummary {
    let credentialState: LlmCredentialState = "NOT_REQUIRED";
    if (provider.config.requiresApiKey) {
      credentialState =
        provider.encryptedCredential === null
          ? "MISSING"
          : this.protector.isAvailable()
            ? "AVAILABLE"
            : "LOCKED";
    }
    return {
      config: { ...provider.config },
      credentialState
    };
  }

  private requireInitialized(): void {
    if (!this.initialized) {
      throw new LlmProviderStoreError(
        "STORE_UNAVAILABLE",
        "The LLM provider store is not initialized."
      );
    }
  }

  private requireProvider(providerId: string): StoredLlmProvider {
    this.requireInitialized();
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new LlmProviderStoreError(
        "PROVIDER_NOT_FOUND",
        "The provider does not exist."
      );
    }
    return provider;
  }

  private enqueueMutation<T>(task: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(task, task);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}
