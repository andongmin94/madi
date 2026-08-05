import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AtomicOutputIdentity,
  AtomicOutputPort,
  AtomicOutputRecoveryResult
} from "../src/main/atomicOutputClient";
import type { AtomicOutputJournalPreparation } from "../src/main/atomicOutputJournal";
import { FileHwpxCrashRecoveryRegistry } from "../src/main/hwpxCrashRecovery";

const OPERATION_ID = "123e4567-e89b-42d3-a456-426614174000";
const OWNER_PID = 424_242;
const OWNERSHIP_MARKER = ".madi-hwpx-ownership-v1.json";
const ATOMIC_PREPARED_MARKER = ".madi-atomic-output-prepared-v1.json";
const PRIVATE_ID = "123e4567-e89b-42d3-a456-426614174001";
const RECOVERY_ID = "123e4567-e89b-42d3-a456-426614174002";
const EXPECTED: AtomicOutputIdentity = {
  byteLength: 11,
  sha256: "a".repeat(64),
  volumeSerialNumber: "b".repeat(16),
  fileId: "c".repeat(32)
};
const STAGED: AtomicOutputIdentity = {
  byteLength: 8,
  sha256: "d".repeat(64),
  volumeSerialNumber: "b".repeat(16),
  fileId: "e".repeat(32)
};
const temporaryRoots: string[] = [];

async function fixture(): Promise<{
  readonly root: string;
  readonly registryRoot: string;
  readonly operationPath: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "madi-hwpx-recovery-test-"));
  temporaryRoots.push(root);
  const registryRoot = path.join(root, "registry");
  const operationPath = path.join(
    root,
    `.madi-hwpx-operation-${OPERATION_ID}`
  );
  await mkdir(operationPath);
  return { root, registryRoot, operationPath };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function soleRegistryRecord(registryRoot: string): Promise<{
  readonly fileName: string;
  readonly value: Record<string, unknown>;
}> {
  const entries = (await readdir(registryRoot)).filter((name) =>
    name.endsWith(".json")
  );
  expect(entries).toHaveLength(1);
  return {
    fileName: entries[0]!,
    value: JSON.parse(
      await readFile(path.join(registryRoot, entries[0]!), "utf8")
    ) as Record<string, unknown>
  };
}

function journalPreparation(value: {
  readonly root: string;
  readonly operationPath: string;
}): AtomicOutputJournalPreparation {
  const outputDirectory = path.join(value.root, "output");
  return {
    stagedPath: path.join(value.operationPath, "publication.hwpx"),
    destinationPath: path.join(outputDirectory, "publication.hwpx"),
    backupPath: path.join(
      value.operationPath,
      `madi-atomic-backup-${PRIVATE_ID}.bin`
    ),
    rollbackPath: path.join(
      value.operationPath,
      `madi-atomic-rollback-${PRIVATE_ID}.bin`
    ),
    recoveryPath: path.join(
      outputDirectory,
      `publication.madi-recovery-${RECOVERY_ID}.hwpx`
    ),
    maximumBytes: 1024,
    expected: EXPECTED,
    stagedIdentity: STAGED
  };
}

function atomicPort(recovery: AtomicOutputRecoveryResult): AtomicOutputPort {
  return {
    inspect: vi.fn(async () => EXPECTED),
    commit: vi.fn(async () => ({
      stagedIdentity: STAGED,
      backupIdentity: EXPECTED
    })),
    recover: vi.fn(async () => recovery),
    publishRecovery: vi.fn(async ({ expected }) => expected)
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })
    )
  );
});

describe("Phase 1H authenticated HWPX crash recovery", () => {
  it("removes a dead owner's paired manuscript directory on startup", async () => {
    const value = await fixture();
    const owner = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
      ownerPid: OWNER_PID,
      isProcessAlive: () => true
    });
    await owner.register(value.operationPath);
    await writeFile(path.join(value.operationPath, "publication.hwpx"), "secret");
    const record = await soleRegistryRecord(value.registryRoot);

    const recovery = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
      ownerPid: OWNER_PID + 1,
      isProcessAlive: () => false
    });
    await recovery.initialize();

    expect(await exists(value.operationPath)).toBe(false);
    expect(await exists(record.value.claimPath as string)).toBe(false);
    expect(await readdir(value.registryRoot)).toEqual([]);
  });

  it("does not touch an authenticated directory owned by a live process", async () => {
    const value = await fixture();
    const owner = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
      ownerPid: OWNER_PID,
      isProcessAlive: () => true
    });
    await owner.register(value.operationPath);
    await writeFile(path.join(value.operationPath, "publication.hwpx"), "secret");

    const concurrent = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
      ownerPid: OWNER_PID + 1,
      isProcessAlive: (pid) => pid === OWNER_PID
    });
    await concurrent.initialize();

    expect(await exists(value.operationPath)).toBe(true);
    expect((await readdir(value.registryRoot)).filter((name) => name.endsWith(".json"))).toHaveLength(1);
  });

  it("never removes an attacker-created name-only operation directory", async () => {
    const value = await fixture();
    await writeFile(path.join(value.operationPath, "foreign.txt"), "keep");

    const recovery = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
      ownerPid: OWNER_PID,
      isProcessAlive: () => false
    });
    await recovery.initialize();

    expect(await readFile(path.join(value.operationPath, "foreign.txt"), "utf8")).toBe("keep");
  });

  it("leaves a directory intact when its ownership marker token is altered", async () => {
    const value = await fixture();
    const owner = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
      ownerPid: OWNER_PID,
      isProcessAlive: () => true
    });
    await owner.register(value.operationPath);
    await writeFile(path.join(value.operationPath, "foreign.txt"), "keep");
    const markerPath = path.join(value.operationPath, OWNERSHIP_MARKER);
    const marker = JSON.parse(await readFile(markerPath, "utf8")) as Record<
      string,
      unknown
    >;
    marker.ownershipToken = "f".repeat(64);
    await writeFile(markerPath, `${JSON.stringify(marker)}\n`, "utf8");

    const recovery = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
      ownerPid: OWNER_PID + 1,
      isProcessAlive: () => false
    });
    await recovery.initialize();

    expect(await readFile(path.join(value.operationPath, "foreign.txt"), "utf8")).toBe("keep");
    expect(await readdir(value.registryRoot)).toEqual([]);
  });

  it("does not delete an unexpected directory occupying the private claim path", async () => {
    const value = await fixture();
    const owner = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
      ownerPid: OWNER_PID,
      isProcessAlive: () => true
    });
    await owner.register(value.operationPath);
    const record = await soleRegistryRecord(value.registryRoot);
    const claimPath = record.value.claimPath as string;
    await mkdir(claimPath);
    await writeFile(path.join(claimPath, "foreign.txt"), "keep");

    const recovery = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
      ownerPid: OWNER_PID + 1,
      isProcessAlive: () => false
    });
    await recovery.initialize();

    expect(await exists(value.operationPath)).toBe(true);
    expect(await readFile(path.join(claimPath, "foreign.txt"), "utf8")).toBe("keep");
    expect((await readdir(value.registryRoot)).filter((name) => name.endsWith(".json"))).toHaveLength(1);
  });

  it("finishes recovery when a crash happened after the private claim rename", async () => {
    const value = await fixture();
    const owner = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
      ownerPid: OWNER_PID,
      isProcessAlive: () => true
    });
    await owner.register(value.operationPath);
    await writeFile(path.join(value.operationPath, "publication.hwpx"), "secret");
    const record = await soleRegistryRecord(value.registryRoot);
    const claimPath = record.value.claimPath as string;
    await rename(value.operationPath, claimPath);

    const recovery = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
      ownerPid: OWNER_PID + 1,
      isProcessAlive: () => false
    });
    await recovery.initialize();

    expect(await exists(claimPath)).toBe(false);
    expect(await readdir(value.registryRoot)).toEqual([]);
  });

  it("finishes a partially removed claim whose inner marker is already gone", async () => {
    const value = await fixture();
    const owner = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
      ownerPid: OWNER_PID,
      isProcessAlive: () => true
    });
    await owner.register(value.operationPath);
    await writeFile(path.join(value.operationPath, "publication.hwpx"), "secret");
    const record = await soleRegistryRecord(value.registryRoot);
    const claimPath = record.value.claimPath as string;
    await rename(value.operationPath, claimPath);
    await unlink(path.join(claimPath, OWNERSHIP_MARKER));

    const recovery = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
      ownerPid: OWNER_PID + 1,
      isProcessAlive: () => false
    });
    await recovery.initialize();

    expect(await exists(claimPath)).toBe(false);
    expect(await readdir(value.registryRoot)).toEqual([]);
  });

  it("bounds and ignores hostile registry entries without following them", async () => {
    const value = await fixture();
    await mkdir(value.registryRoot);
    const oversizedName = "123e4567-e89b-42d3-a456-426614174010.json";
    const directoryName = "123e4567-e89b-42d3-a456-426614174011.json";
    await writeFile(path.join(value.registryRoot, oversizedName), "x".repeat(4_097));
    await mkdir(path.join(value.registryRoot, directoryName));
    await writeFile(path.join(value.registryRoot, "foreign.txt"), "keep");

    const recovery = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
      ownerPid: OWNER_PID,
      isProcessAlive: () => false
    });
    await recovery.initialize();

    expect(await exists(path.join(value.registryRoot, oversizedName))).toBe(false);
    expect(await exists(path.join(value.registryRoot, directoryName))).toBe(true);
    expect(await readFile(path.join(value.registryRoot, "foreign.txt"), "utf8")).toBe("keep");
  });

  it("fails closed instead of skipping recovery records beyond the scan bound", async () => {
    const value = await fixture();
    await mkdir(value.registryRoot);
    await Promise.all(
      Array.from({ length: 1_025 }, (_, index) => {
        const suffix = index.toString(16).padStart(12, "0");
        return writeFile(
          path.join(
            value.registryRoot,
            `123e4567-e89b-42d3-a456-${suffix}.json`
          ),
          "{}\n"
        );
      })
    );
    const recovery = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
      ownerPid: OWNER_PID,
      isProcessAlive: () => false
    });

    await expect(recovery.initialize()).rejects.toThrow(
      "exceeds the scan bound"
    );
    expect(
      (await readdir(value.registryRoot)).filter((name) => name.endsWith(".json"))
    ).toHaveLength(1_025);
  });

  it("uses the same authenticated claim protocol for normal removal", async () => {
    const value = await fixture();
    const owner = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
      ownerPid: OWNER_PID,
      isProcessAlive: () => true
    });
    await owner.register(value.operationPath);
    await writeFile(path.join(value.operationPath, "publication.hwpx"), "secret");

    await owner.remove(value.operationPath);

    expect(await exists(value.operationPath)).toBe(false);
    expect(await readdir(value.registryRoot)).toEqual([]);
  });

  it.each(["COMMITTED", "ABORTED_SAFE"] as const)(
    "cleans a dead operation with an authenticated %s terminal journal without a helper",
    async (outcome) => {
      const value = await fixture();
      await mkdir(path.join(value.root, "output"));
      const owner = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
        ownerPid: OWNER_PID,
        isProcessAlive: () => true
      });
      await owner.register(value.operationPath);
      await owner.prepareAtomicOutput(
        value.operationPath,
        journalPreparation(value)
      );
      await owner.markAtomicOutputTerminal(value.operationPath, outcome);

      const recovery = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
        ownerPid: OWNER_PID + 1,
        isProcessAlive: () => false
      });
      await recovery.initialize();

      expect(await exists(value.operationPath)).toBe(false);
      expect(await readdir(value.registryRoot)).toEqual([]);
    }
  );

  it("preserves a dead PREPARED operation when the helper is unavailable", async () => {
    const value = await fixture();
    await mkdir(path.join(value.root, "output"));
    const owner = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
      ownerPid: OWNER_PID,
      isProcessAlive: () => true
    });
    await owner.register(value.operationPath);
    await owner.prepareAtomicOutput(
      value.operationPath,
      journalPreparation(value)
    );
    const record = await soleRegistryRecord(value.registryRoot);

    const recovery = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
      ownerPid: OWNER_PID + 1,
      isProcessAlive: () => false
    });
    await recovery.initialize();

    expect(await exists(value.operationPath)).toBe(false);
    expect(await exists(record.value.claimPath as string)).toBe(true);
    expect(
      (await readdir(value.registryRoot)).filter((name) => name.endsWith(".json"))
    ).toHaveLength(1);
  });

  it.each([
    ["corrupt", "{"],
    ["oversized", "x".repeat(16 * 1024 + 1)]
  ])("preserves a dead operation with a %s PREPARED journal", async (_name, source) => {
    const value = await fixture();
    await mkdir(path.join(value.root, "output"));
    const owner = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
      ownerPid: OWNER_PID,
      isProcessAlive: () => true
    });
    await owner.register(value.operationPath);
    await owner.prepareAtomicOutput(
      value.operationPath,
      journalPreparation(value)
    );
    await writeFile(
      path.join(value.operationPath, ATOMIC_PREPARED_MARKER),
      source,
      "utf8"
    );
    const record = await soleRegistryRecord(value.registryRoot);

    const recovery = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
      ownerPid: OWNER_PID + 1,
      isProcessAlive: () => false
    });
    await expect(recovery.initialize()).resolves.toBeUndefined();

    expect(await exists(record.value.claimPath as string)).toBe(true);
    expect(
      (await readdir(value.registryRoot)).filter((name) => name.endsWith(".json"))
    ).toHaveLength(1);
  });

  it("reconciles a dead PREPARED operation before deleting its claim", async () => {
    const value = await fixture();
    await mkdir(path.join(value.root, "output"));
    const owner = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
      ownerPid: OWNER_PID,
      isProcessAlive: () => true
    });
    await owner.register(value.operationPath);
    await owner.prepareAtomicOutput(
      value.operationPath,
      journalPreparation(value)
    );
    const port = atomicPort({
      outcome: "COMMIT_COMPLETE",
      recoveryArtifact: null
    });

    const recovery = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
      ownerPid: OWNER_PID + 1,
      isProcessAlive: () => false,
      atomicOutput: port
    });
    await recovery.initialize();

    expect(port.recover).toHaveBeenCalledTimes(1);
    expect(await exists(value.operationPath)).toBe(false);
    expect(await readdir(value.registryRoot)).toEqual([]);
  });

  it("publishes a recovery copy before deleting an ambiguous dead operation", async () => {
    const value = await fixture();
    const outputDirectory = path.join(value.root, "output");
    await mkdir(outputDirectory);
    const preparation = journalPreparation(value);
    const owner = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
      ownerPid: OWNER_PID,
      isProcessAlive: () => true
    });
    await owner.register(value.operationPath);
    await owner.prepareAtomicOutput(value.operationPath, preparation);
    const record = await soleRegistryRecord(value.registryRoot);
    const port = atomicPort({
      outcome: "RECOVERY_REQUIRED",
      recoveryArtifact: { source: "BACKUP", identity: EXPECTED }
    });
    vi.mocked(port.publishRecovery).mockImplementationOnce(async (input) => {
      await writeFile(input.recoveryPath, "confirmed A", "utf8");
      return input.expected;
    });

    const recovery = new FileHwpxCrashRecoveryRegistry(value.registryRoot, {
      ownerPid: OWNER_PID + 1,
      isProcessAlive: () => false,
      atomicOutput: port
    });
    await recovery.initialize();

    expect(port.publishRecovery).toHaveBeenCalledWith({
      sourcePath: path.join(
        record.value.claimPath as string,
        path.basename(preparation.backupPath)
      ),
      recoveryPath: preparation.recoveryPath,
      maximumBytes: preparation.maximumBytes,
      expected: EXPECTED
    });
    expect(await readFile(preparation.recoveryPath, "utf8")).toBe("confirmed A");
    expect(await exists(record.value.claimPath as string)).toBe(false);
    expect(await readdir(value.registryRoot)).toEqual([]);
  });
});
