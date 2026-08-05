import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AtomicOutputIdentity,
  AtomicOutputPort,
  AtomicOutputRecoveryResult
} from "../src/main/atomicOutputClient";
import {
  atomicOutputJournalExists,
  prepareAtomicOutputJournal,
  reconcileAtomicOutputJournal,
  writeAtomicOutputTerminal,
  type AtomicOutputJournalPreparation
} from "../src/main/atomicOutputJournal";

const REGISTRY_ID = "123e4567-e89b-42d3-a456-426614174000";
const OWNERSHIP_TOKEN = "a".repeat(64);
const PRIVATE_ID = "123e4567-e89b-42d3-a456-426614174001";
const RECOVERY_ID = "123e4567-e89b-42d3-a456-426614174002";
const PREPARED_FILE_NAME = ".madi-atomic-output-prepared-v1.json";
const COMMITTED_FILE_NAME = ".madi-atomic-output-committed-v1.json";
const ABORTED_FILE_NAME = ".madi-atomic-output-aborted-v1.json";
const EXPECTED: AtomicOutputIdentity = {
  byteLength: 11,
  sha256: "b".repeat(64),
  volumeSerialNumber: "c".repeat(16),
  fileId: "d".repeat(32)
};
const STAGED: AtomicOutputIdentity = {
  byteLength: 8,
  sha256: "e".repeat(64),
  volumeSerialNumber: "c".repeat(16),
  fileId: "f".repeat(32)
};
const owner = {
  registryId: REGISTRY_ID,
  ownershipToken: OWNERSHIP_TOKEN
};
const temporaryRoots: string[] = [];

interface JournalFixture {
  readonly root: string;
  readonly directoryPath: string;
  readonly preparation: AtomicOutputJournalPreparation;
}

async function fixture(): Promise<JournalFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "madi-atomic-journal-test-"));
  temporaryRoots.push(root);
  const directoryPath = path.join(root, "owned-operation");
  const outputDirectory = path.join(root, "output");
  await Promise.all([mkdir(directoryPath), mkdir(outputDirectory)]);
  return {
    root,
    directoryPath,
    preparation: {
      stagedPath: path.join(directoryPath, "publication.hwpx"),
      destinationPath: path.join(outputDirectory, "publication.hwpx"),
      backupPath: path.join(
        directoryPath,
        `madi-atomic-backup-${PRIVATE_ID}.bin`
      ),
      rollbackPath: path.join(
        directoryPath,
        `madi-atomic-rollback-${PRIVATE_ID}.bin`
      ),
      recoveryPath: path.join(
        outputDirectory,
        `publication.madi-recovery-${RECOVERY_ID}.hwpx`
      ),
      maximumBytes: 1024,
      expected: EXPECTED,
      stagedIdentity: STAGED
    }
  };
}

function atomicPort(
  recovery: AtomicOutputRecoveryResult = {
    outcome: "NOTHING_TO_DO",
    recoveryArtifact: null
  }
): AtomicOutputPort {
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

async function prepare(value: JournalFixture): Promise<void> {
  await prepareAtomicOutputJournal(
    value.directoryPath,
    owner,
    value.preparation
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })
    )
  );
});

describe("Phase 1H atomic output crash journal", () => {
  it("writes one bounded PREPARED intent and refuses an overwrite", async () => {
    const value = await fixture();

    await prepare(value);

    const parsed = JSON.parse(
      await readFile(path.join(value.directoryPath, PREPARED_FILE_NAME), "utf8")
    ) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      schemaVersion: 1,
      registryId: REGISTRY_ID,
      ownershipToken: OWNERSHIP_TOKEN,
      stagedFileName: "publication.hwpx",
      destinationPath: value.preparation.destinationPath,
      maximumBytes: 1024,
      expected: EXPECTED,
      stagedIdentity: STAGED
    });
    expect(await atomicOutputJournalExists(value.directoryPath)).toBe(true);
    await expect(prepare(value)).rejects.toMatchObject({ code: "EEXIST" });
  });

  it.each([
    "NOTHING_TO_DO",
    "COMMIT_COMPLETE",
    "ROLLED_BACK",
    "DESTINATION_CHANGED"
  ] as const)("reconciles the PREPARED %s crash state as safe", async (outcome) => {
    const value = await fixture();
    await prepare(value);
    const port = atomicPort({ outcome, recoveryArtifact: null });

    await expect(
      reconcileAtomicOutputJournal(value.directoryPath, owner, port)
    ).resolves.toEqual({ status: "SAFE", recoveryFileName: null });
    expect(port.recover).toHaveBeenCalledWith({
      stagedPath: value.preparation.stagedPath,
      destinationPath: value.preparation.destinationPath,
      backupPath: value.preparation.backupPath,
      rollbackPath: value.preparation.rollbackPath,
      maximumBytes: value.preparation.maximumBytes,
      expected: value.preparation.expected,
      stagedIdentity: value.preparation.stagedIdentity
    });
  });

  it.each(["COMMITTED", "ABORTED_SAFE"] as const)(
    "trusts one authenticated %s terminal marker without starting the helper",
    async (outcome) => {
      const value = await fixture();
      await prepare(value);
      await writeAtomicOutputTerminal(value.directoryPath, owner, outcome);

      await expect(
        reconcileAtomicOutputJournal(value.directoryPath, owner)
      ).resolves.toEqual({ status: "SAFE", recoveryFileName: null });
    }
  );

  it("allows only one terminal marker for an intent", async () => {
    const value = await fixture();
    await prepare(value);
    await writeAtomicOutputTerminal(value.directoryPath, owner, "COMMITTED");

    await expect(
      writeAtomicOutputTerminal(value.directoryPath, owner, "ABORTED_SAFE")
    ).rejects.toThrow("already has a terminal marker");
  });

  it.each([
    ["corrupt", "{"],
    ["oversized", "x".repeat(16 * 1024 + 1)],
    ["owner-mismatched", null]
  ] as const)("preserves a %s PREPARED journal", async (_name, source) => {
    const value = await fixture();
    await prepare(value);
    const preparedPath = path.join(value.directoryPath, PREPARED_FILE_NAME);
    if (source === null) {
      const parsed = JSON.parse(await readFile(preparedPath, "utf8")) as Record<
        string,
        unknown
      >;
      parsed.ownershipToken = "0".repeat(64);
      await writeFile(preparedPath, `${JSON.stringify(parsed)}\n`, "utf8");
    } else {
      await writeFile(preparedPath, source, "utf8");
    }
    const port = atomicPort();

    expect(await atomicOutputJournalExists(value.directoryPath)).toBe(true);
    await expect(
      reconcileAtomicOutputJournal(value.directoryPath, owner, port)
    ).resolves.toEqual({
      status: "RECOVERY_REQUIRED",
      recoveryFileName: null
    });
    expect(port.recover).not.toHaveBeenCalled();
  });

  it.each([
    ["corrupt", "{"],
    ["oversized", "x".repeat(16 * 1024 + 1)],
    ["intent-mismatched", null]
  ] as const)("preserves a %s terminal marker", async (_name, source) => {
    const value = await fixture();
    await prepare(value);
    await writeAtomicOutputTerminal(value.directoryPath, owner, "COMMITTED");
    const markerPath = path.join(value.directoryPath, COMMITTED_FILE_NAME);
    if (source === null) {
      const parsed = JSON.parse(await readFile(markerPath, "utf8")) as Record<
        string,
        unknown
      >;
      parsed.intentSha256 = "0".repeat(64);
      await writeFile(markerPath, `${JSON.stringify(parsed)}\n`, "utf8");
    } else {
      await writeFile(markerPath, source, "utf8");
    }
    const port = atomicPort();

    await expect(
      reconcileAtomicOutputJournal(value.directoryPath, owner, port)
    ).resolves.toEqual({
      status: "RECOVERY_REQUIRED",
      recoveryFileName: null
    });
    expect(port.recover).not.toHaveBeenCalled();
  });

  it("preserves an intent with contradictory terminal markers", async () => {
    const value = await fixture();
    await prepare(value);
    await writeAtomicOutputTerminal(value.directoryPath, owner, "COMMITTED");
    const committed = JSON.parse(
      await readFile(path.join(value.directoryPath, COMMITTED_FILE_NAME), "utf8")
    ) as Record<string, unknown>;
    committed.outcome = "ABORTED_SAFE";
    await writeFile(
      path.join(value.directoryPath, ABORTED_FILE_NAME),
      `${JSON.stringify(committed)}\n`,
      "utf8"
    );
    const port = atomicPort();

    await expect(
      reconcileAtomicOutputJournal(value.directoryPath, owner, port)
    ).resolves.toEqual({
      status: "RECOVERY_REQUIRED",
      recoveryFileName: null
    });
    expect(port.recover).not.toHaveBeenCalled();
  });

  it.each(["STAGED", "BACKUP", "ROLLBACK"] as const)(
    "publishes and verifies a %s recovery artifact",
    async (source) => {
      const value = await fixture();
      await prepare(value);
      const port = atomicPort({
        outcome: "RECOVERY_REQUIRED",
        recoveryArtifact: { source, identity: EXPECTED }
      });
      const expectedSourcePath = {
        STAGED: value.preparation.stagedPath,
        BACKUP: value.preparation.backupPath,
        ROLLBACK: value.preparation.rollbackPath
      }[source];

      await expect(
        reconcileAtomicOutputJournal(value.directoryPath, owner, port)
      ).resolves.toEqual({
        status: "RECOVERY_PUBLISHED",
        recoveryFileName: path.basename(value.preparation.recoveryPath)
      });
      expect(port.publishRecovery).toHaveBeenCalledWith({
        sourcePath: expectedSourcePath,
        recoveryPath: value.preparation.recoveryPath,
        maximumBytes: value.preparation.maximumBytes,
        expected: EXPECTED
      });
    }
  );

  it("accepts an already-published recovery only after inspecting its content", async () => {
    const value = await fixture();
    await prepare(value);
    const port = atomicPort({
      outcome: "RECOVERY_REQUIRED",
      recoveryArtifact: { source: "BACKUP", identity: EXPECTED }
    });
    vi.mocked(port.publishRecovery).mockRejectedValueOnce(new Error("exists"));

    await expect(
      reconcileAtomicOutputJournal(value.directoryPath, owner, port)
    ).resolves.toEqual({
      status: "RECOVERY_PUBLISHED",
      recoveryFileName: path.basename(value.preparation.recoveryPath)
    });
    expect(port.inspect).toHaveBeenCalledWith(
      value.preparation.recoveryPath,
      value.preparation.maximumBytes
    );
  });

  it("preserves the journal when a published recovery identity does not match", async () => {
    const value = await fixture();
    await prepare(value);
    const port = atomicPort({
      outcome: "RECOVERY_REQUIRED",
      recoveryArtifact: { source: "BACKUP", identity: EXPECTED }
    });
    vi.mocked(port.publishRecovery).mockResolvedValueOnce({
      ...EXPECTED,
      sha256: "0".repeat(64)
    });

    await expect(
      reconcileAtomicOutputJournal(value.directoryPath, owner, port)
    ).resolves.toEqual({
      status: "RECOVERY_REQUIRED",
      recoveryFileName: null
    });
  });

  it("preserves a valid PREPARED intent when no helper is available", async () => {
    const value = await fixture();
    await prepare(value);

    await expect(
      reconcileAtomicOutputJournal(value.directoryPath, owner)
    ).resolves.toEqual({
      status: "RECOVERY_REQUIRED",
      recoveryFileName: null
    });
  });
});
