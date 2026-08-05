import type { LlmSecretProtector } from "./providerStore";

export interface ElectronSafeStoragePort {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class ElectronSafeStorageProtector implements LlmSecretProtector {
  constructor(private readonly safeStorage: ElectronSafeStoragePort) {}

  isAvailable(): boolean {
    return this.safeStorage.isEncryptionAvailable();
  }

  encrypt(secret: string): Uint8Array {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error("Protected credential storage is unavailable");
    }
    return this.safeStorage.encryptString(secret);
  }

  decrypt(payload: Uint8Array): string {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error("Protected credential storage is unavailable");
    }
    return this.safeStorage.decryptString(Buffer.from(payload));
  }
}
