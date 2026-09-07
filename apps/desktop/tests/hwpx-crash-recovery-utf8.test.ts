import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FileHwpxCrashRecoveryRegistry } from "../src/main/hwpxCrashRecovery";

const OPERATION_ID = "123e4567-e89b-42d3-a456-426614174000";
const OWNERSHIP_MARKER_NAME = ".madi-hwpx-ownership-v1.json";
const roots: string[] = [];

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
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

async function registeredFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "madi-hwpx-\ufffd-"));
  roots.push(root);
  const registryRoot = path.join(root, "registry");
  const operationPath = path.join(
    root,
    `.madi-hwpx-operation-${OPERATION_ID}`
  );
  await mkdir(operationPath);
  const owner = new FileHwpxCrashRecoveryRegistry(registryRoot, {
    ownerPid: 1234,
    isProcessAlive: () => true
  });
  await owner.register(operationPath);
  const registryFiles = (await readdir(registryRoot)).filter((name) =>
    name.endsWith(".json")
  );
  if (registryFiles.length !== 1) {
    throw new Error("Fixture registry record was not created uniquely");
  }
  return {
    registryRoot,
    operationPath,
    registryPath: path.join(registryRoot, registryFiles[0]!),
    markerPath: path.join(operationPath, OWNERSHIP_MARKER_NAME)
  };
}

async function recoverCrashedRegistry(registryRoot: string): Promise<void> {
  const recovery = new FileHwpxCrashRecoveryRegistry(registryRoot, {
    ownerPid: 5678,
    isProcessAlive: () => false
  });
  await recovery.initialize();
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("HWPX crash-recovery UTF-8 boundary", () => {
  it("preserves the managed directory when the registry record has malformed UTF-8", async () => {
    const fixture = await registeredFixture();
    await corruptReplacementCharacter(fixture.registryPath);

    await recoverCrashedRegistry(fixture.registryRoot);

    expect(await pathExists(fixture.operationPath)).toBe(true);
    expect(await pathExists(fixture.registryPath)).toBe(false);
  });

  it("preserves the managed directory when its ownership marker has malformed UTF-8", async () => {
    const fixture = await registeredFixture();
    await corruptReplacementCharacter(fixture.markerPath);

    await recoverCrashedRegistry(fixture.registryRoot);

    expect(await pathExists(fixture.operationPath)).toBe(true);
    expect(await pathExists(fixture.registryPath)).toBe(false);
  });
});
