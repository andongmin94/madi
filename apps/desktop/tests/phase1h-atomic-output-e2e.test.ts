// @vitest-environment node

import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ProcessAtomicOutput } from "../src/main/atomicOutputClient";
import {
  prepareAtomicOutputJournal,
  reconcileAtomicOutputJournal
} from "../src/main/atomicOutputJournal";

const MAXIMUM_BYTES = 1024 * 1024;
const OWNER = {
  registryId: "123e4567-e89b-42d3-a456-426614174000",
  ownershipToken: "a".repeat(64)
};
const PRIVATE_ID = "123e4567-e89b-42d3-a456-426614174001";
const RECOVERY_ID = "123e4567-e89b-42d3-a456-426614174002";
const binaryPath = fileURLToPath(
  new URL(
    "../../../crates/madi-atomic-output/target/debug/madi-atomic-output.exe",
    import.meta.url
  )
);
const temporaryRoots: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "madi-atomic-e2e-test-"));
  temporaryRoots.push(root);
  return root;
}

beforeAll(async () => {
  const binary = await stat(binaryPath);
  expect(binary.isFile()).toBe(true);
});

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })
    )
  );
});

describe("Phase 1H built atomic output process", () => {
  it(
    "inspects, commits, reconciles, and publishes complete bytes",
    async () => {
      const root = await temporaryDirectory();
      const destinationPath = path.join(root, "publication.hwpx");
      const stagedPath = path.join(root, "staged-publication.hwpx");
      const backupPath = path.join(root, "confirmed-destination.bin");
      const rollbackPath = path.join(root, "rollback-staged.bin");
      const recoveryPath = path.join(root, "publication.recovery.hwpx");
      await Promise.all([
        writeFile(destinationPath, "confirmed A", "utf8"),
        writeFile(stagedPath, "staged S", "utf8")
      ]);
      const processPort = new ProcessAtomicOutput(binaryPath);
      const expected = await processPort.inspect(destinationPath, MAXIMUM_BYTES);
      const stagedIdentity = await processPort.inspect(stagedPath, MAXIMUM_BYTES);
      const input = {
        stagedPath,
        destinationPath,
        backupPath,
        rollbackPath,
        maximumBytes: MAXIMUM_BYTES,
        expected,
        stagedIdentity
      };

      await expect(processPort.commit(input)).resolves.toEqual({
        stagedIdentity,
        backupIdentity: expected
      });
      expect(await readFile(destinationPath, "utf8")).toBe("staged S");
      expect(await readFile(backupPath, "utf8")).toBe("confirmed A");
      await expect(processPort.recover(input)).resolves.toEqual({
        outcome: "COMMIT_COMPLETE",
        recoveryArtifact: null
      });
      const published = await processPort.publishRecovery({
        sourcePath: backupPath,
        recoveryPath,
        maximumBytes: MAXIMUM_BYTES,
        expected
      });
      expect(published.sha256).toBe(expected.sha256);
      expect(published.byteLength).toBe(expected.byteLength);
      expect(await readFile(recoveryPath, "utf8")).toBe("confirmed A");
    },
    30_000
  );

  it(
    "reconciles an ambiguous crash by publishing the confirmed backup",
    async () => {
      const root = await temporaryDirectory();
      const operationPath = path.join(root, "owned-operation");
      const outputPath = path.join(root, "output");
      await Promise.all([mkdir(operationPath), mkdir(outputPath)]);
      const stagedPath = path.join(operationPath, "publication.hwpx");
      const destinationPath = path.join(outputPath, "publication.hwpx");
      const backupPath = path.join(
        operationPath,
        `madi-atomic-backup-${PRIVATE_ID}.bin`
      );
      const rollbackPath = path.join(
        operationPath,
        `madi-atomic-rollback-${PRIVATE_ID}.bin`
      );
      const recoveryPath = path.join(
        outputPath,
        `publication.madi-recovery-${RECOVERY_ID}.hwpx`
      );
      await Promise.all([
        writeFile(destinationPath, "confirmed A", "utf8"),
        writeFile(stagedPath, "staged S", "utf8")
      ]);
      const processPort = new ProcessAtomicOutput(binaryPath);
      const expected = await processPort.inspect(destinationPath, MAXIMUM_BYTES);
      const stagedIdentity = await processPort.inspect(stagedPath, MAXIMUM_BYTES);
      await prepareAtomicOutputJournal(operationPath, OWNER, {
        stagedPath,
        destinationPath,
        backupPath,
        rollbackPath,
        recoveryPath,
        maximumBytes: MAXIMUM_BYTES,
        expected,
        stagedIdentity
      });
      await copyFile(destinationPath, backupPath);
      await writeFile(destinationPath, "foreign C", "utf8");

      await expect(
        reconcileAtomicOutputJournal(operationPath, OWNER, processPort)
      ).resolves.toEqual({
        status: "RECOVERY_PUBLISHED",
        recoveryFileName: path.basename(recoveryPath)
      });
      expect(await readFile(destinationPath, "utf8")).toBe("foreign C");
      expect(await readFile(recoveryPath, "utf8")).toBe("confirmed A");
      expect(await readFile(stagedPath, "utf8")).toBe("staged S");
    },
    30_000
  );
});
