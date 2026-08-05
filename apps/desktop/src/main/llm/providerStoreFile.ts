import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat
} from "node:fs/promises";
import path from "node:path";

import {
  parseProviderStore,
  serializeProviderStore
} from "./providerStoreFormat";
import {
  LLM_PROVIDER_STORE_BACKUP_FILE_NAME,
  LLM_PROVIDER_STORE_FILE_NAME,
  LLM_PROVIDER_STORE_MAX_BYTES,
  LlmProviderStoreError,
  type StoredLlmProvider
} from "./providerStoreTypes";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const details = await stat(filePath);
    return details.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function readBounded(filePath: string): Promise<string> {
  const details = await stat(filePath);
  if (!details.isFile() || details.size > LLM_PROVIDER_STORE_MAX_BYTES) {
    throw new LlmProviderStoreError(
      "STORE_CORRUPTED",
      "The LLM provider store exceeds the safe limit."
    );
  }
  return readFile(filePath, "utf8");
}

export class LlmProviderFileRepository {
  private readonly storePath: string;
  private readonly backupPath: string;

  constructor(private readonly directoryPath: string) {
    this.storePath = path.join(directoryPath, LLM_PROVIDER_STORE_FILE_NAME);
    this.backupPath = path.join(
      directoryPath,
      LLM_PROVIDER_STORE_BACKUP_FILE_NAME
    );
  }

  async load(): Promise<readonly StoredLlmProvider[]> {
    await mkdir(this.directoryPath, { recursive: true });
    const [storeExists, backupExists] = await Promise.all([
      fileExists(this.storePath),
      fileExists(this.backupPath)
    ]);
    if (!storeExists && backupExists) {
      const restored = parseProviderStore(await readBounded(this.backupPath));
      await rename(this.backupPath, this.storePath);
      await this.removeStaleTemporaryFiles();
      return restored.providers;
    }
    if (!storeExists) {
      await this.removeStaleTemporaryFiles();
      return [];
    }
    try {
      const current = parseProviderStore(await readBounded(this.storePath));
      await rm(this.backupPath, { force: true });
      await this.removeStaleTemporaryFiles();
      return current.providers;
    } catch (error) {
      if (!backupExists) {
        throw error;
      }
      const backup = parseProviderStore(await readBounded(this.backupPath));
      await rm(this.storePath, { force: true });
      await rename(this.backupPath, this.storePath);
      await this.removeStaleTemporaryFiles();
      return backup.providers;
    }
  }

  async write(providers: readonly StoredLlmProvider[]): Promise<void> {
    const source = serializeProviderStore(providers);
    if (Buffer.byteLength(source, "utf8") > LLM_PROVIDER_STORE_MAX_BYTES) {
      throw new LlmProviderStoreError(
        "STORE_UNAVAILABLE",
        "The LLM provider store exceeds the safe limit."
      );
    }
    await mkdir(this.directoryPath, { recursive: true });
    const temporaryPath = path.join(
      this.directoryPath,
      `.providers-${randomUUID()}.tmp`
    );
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(source, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    let movedCurrentToBackup = false;
    try {
      await rm(this.backupPath, { force: true });
      if (await fileExists(this.storePath)) {
        await rename(this.storePath, this.backupPath);
        movedCurrentToBackup = true;
      }
      await rename(temporaryPath, this.storePath);
      await rm(this.backupPath, { force: true });
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      if (movedCurrentToBackup && !(await fileExists(this.storePath))) {
        await rename(this.backupPath, this.storePath).catch(() => undefined);
      }
      throw error;
    }
  }

  private async removeStaleTemporaryFiles(): Promise<void> {
    const entries = await readdir(this.directoryPath, { withFileTypes: true });
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() &&
            entry.name.startsWith(".providers-") &&
            entry.name.endsWith(".tmp")
        )
        .map((entry) =>
          rm(path.join(this.directoryPath, entry.name), { force: true })
        )
    );
  }
}
