import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AtomicOutputIdentity,
  AtomicOutputPort
} from "../src/main/atomicOutputClient";
import {
  prepareAtomicOutputJournal,
  reconcileAtomicOutputJournal,
  writeAtomicOutputTerminal
} from "../src/main/atomicOutputJournal";

const PRIVATE_ID = "123e4567-e89b-42d3-a456-426614174001";
const RECOVERY_ID = "123e4567-e89b-42d3-a456-426614174002";
const PREPARED_FILE_NAME = ".madi-atomic-output-prepared-v1.json";
const COMMITTED_FILE_NAME = ".madi-atomic-output-committed-v1.json";
const owner = {
  registryId: "registry-\ufffd-sentinel",
  ownershipToken: "a".repeat(64)
};
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
const roots: string[] = [];

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "madi-journal-utf8-"));
  roots.push(root);
  const directoryPath = path.join(root, "operation");
  const outputDirectory = path.join(root, "output");
  await Promise.all([mkdir(directoryPath), mkdir(outputDirectory)]);
  await prepareAtomicOutputJournal(directoryPath, owner, {
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
  });
  return { directoryPath };
}

async function corruptReplacementCharacter(filePath: string): Promise<void> {
  const source = await readFile(filePath);
  const encodedReplacement = Buffer.from("\ufffd", "utf8");
  const index = source.indexOf(encodedReplacement);
  if (index < 0) {
    throw new Error("Fixture replacement character was not found");
  }
  await writeFile(
    filePath,
    Buffer.concat([
      source.subarray(0, index),
      Buffer.from([0xff]),
      source.subarray(index + encodedReplacement.byteLength)
    ])
  );
}

function atomicPort(): AtomicOutputPort {
  return {
    inspect: vi.fn(async () => EXPECTED),
    commit: vi.fn(async () => ({
      stagedIdentity: STAGED,
      backupIdentity: EXPECTED
    })),
    recover: vi.fn(async () => ({
      outcome: "NOTHING_TO_DO" as const,
      recoveryArtifact: null
    })),
    publishRecovery: vi.fn(async ({ expected }) => expected)
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("atomic output journal UTF-8 boundary", () => {
  it("treats malformed PREPARED UTF-8 as untrusted before recovery", async () => {
    const { directoryPath } = await createFixture();
    await corruptReplacementCharacter(
      path.join(directoryPath, PREPARED_FILE_NAME)
    );
    const port = atomicPort();

    await expect(
      reconcileAtomicOutputJournal(directoryPath, owner, port)
    ).resolves.toEqual({
      status: "RECOVERY_REQUIRED",
      recoveryFileName: null
    });
    expect(port.recover).not.toHaveBeenCalled();
  });

  it("does not authenticate a terminal marker through replacement decoding", async () => {
    const { directoryPath } = await createFixture();
    await writeAtomicOutputTerminal(directoryPath, owner, "COMMITTED");
    await corruptReplacementCharacter(
      path.join(directoryPath, COMMITTED_FILE_NAME)
    );
    const port = atomicPort();

    await expect(
      reconcileAtomicOutputJournal(directoryPath, owner, port)
    ).resolves.toEqual({
      status: "RECOVERY_REQUIRED",
      recoveryFileName: null
    });
    expect(port.recover).not.toHaveBeenCalled();
  });
});
