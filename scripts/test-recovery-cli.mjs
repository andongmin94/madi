import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { TYPIE_COMMIT } from "./lib/typie-test-runtime.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const executableName =
  process.platform === "win32" ? "madi-core.exe" : "madi-core";
const coreBinary =
  process.env.MADI_CORE_BIN?.trim() ||
  resolve(
    repositoryRoot,
    "crates",
    "madi-core",
    "target",
    "debug",
    executableName,
  );
const manuscript =
  "용은 오래된 산맥 위를 날았다.\n\n***\n\n둘째 장면의 한글 복구 본문.";

function runCore(args, expectedSuccess = true) {
  const result = spawnSync(coreBinary, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (expectedSuccess && result.status !== 0) {
    throw new Error(
      `madi-core ${args[0]} failed: ${JSON.stringify(
        result.stderr?.trim() ?? result.error?.message ?? "",
      )}`,
    );
  }
  if (!expectedSuccess && result.status === 0) {
    throw new Error(`madi-core ${args[0]} unexpectedly succeeded`);
  }
  return result;
}

const workspace = await mkdtemp(join(tmpdir(), "madi-recovery-cli-"));
const projectPath = join(workspace, "드래곤을죽이다.madi");
const snapshotPath = join(workspace, "opaque.snapshot");
const recoveryInputPath = join(workspace, "recovery-input.txt");
const recoveryOutputPath = join(workspace, "recovered.txt");
const corruptPath = join(workspace, "corrupt.madi");
const documentId = "phase05-recovery-document";

try {
  await Promise.all([
    writeFile(snapshotPath, new Uint8Array([0x4d, 0x41, 0x44, 0x49])),
    writeFile(recoveryInputPath, manuscript, "utf8"),
  ]);
  runCore([
    "create-project",
    "--file-path",
    projectPath,
    "--title",
    "드래곤을죽이다",
    "--document-id",
    documentId,
    "--editor-engine",
    "typie",
    "--editor-engine-commit",
    TYPIE_COMMIT,
    "--editor-schema-version",
    "1",
  ]);
  runCore([
    "save-document",
    "--file-path",
    projectPath,
    "--document-id",
    documentId,
    "--title",
    "본문",
    "--editor-engine",
    "typie",
    "--editor-engine-commit",
    TYPIE_COMMIT,
    "--editor-schema-version",
    "1",
    "--snapshot-file",
    snapshotPath,
    "--plain-text-file",
    recoveryInputPath,
    "--expected-revision",
    "0",
  ]);

  const recovered = runCore([
    "recover-plain-text",
    "--file-path",
    projectPath,
    "--document-id",
    documentId,
    "--output",
    recoveryOutputPath,
  ]);
  const recoveredBytes = await readFile(recoveryOutputPath);
  if (recoveredBytes.toString("utf8") !== manuscript) {
    throw new Error("Recovery CLI did not preserve Korean UTF-8 bytes");
  }
  if (!recoveredBytes.toString("utf8").includes("\n\n***\n\n")) {
    throw new Error("Recovery CLI did not preserve the scene-break marker");
  }
  if (
    recovered.stdout.includes(manuscript) ||
    recovered.stderr.includes(manuscript)
  ) {
    throw new Error("Output-file recovery leaked the manuscript to a log");
  }

  const noClobber = runCore(
    [
      "recover-plain-text",
      "--file-path",
      projectPath,
      "--document-id",
      documentId,
      "--output",
      recoveryOutputPath,
    ],
    false,
  );
  if (
    noClobber.stdout.includes(manuscript) ||
    noClobber.stderr.includes(manuscript) ||
    (await readFile(recoveryOutputPath, "utf8")) !== manuscript
  ) {
    throw new Error("No-clobber error path leaked or changed the manuscript");
  }

  const missingDocument = runCore(
    [
      "recover-plain-text",
      "--file-path",
      projectPath,
      "--document-id",
      "missing-document",
      "--output",
      join(workspace, "missing.txt"),
    ],
    false,
  );
  if (
    missingDocument.stdout.includes(manuscript) ||
    missingDocument.stderr.includes(manuscript)
  ) {
    throw new Error("Missing-document error leaked the manuscript");
  }

  await writeFile(corruptPath, `not sqlite\n${manuscript}`, "utf8");
  const corrupt = runCore(
    [
      "recover-plain-text",
      "--file-path",
      corruptPath,
      "--output",
      join(workspace, "corrupt.txt"),
    ],
    false,
  );
  if (
    corrupt.stdout.includes(manuscript) ||
    corrupt.stderr.includes(manuscript)
  ) {
    throw new Error("Corrupt-file error leaked the manuscript");
  }

  const databaseHeader = (await readFile(projectPath))
    .subarray(0, 16)
    .toString("binary");
  if (databaseHeader !== "SQLite format 3\u0000") {
    throw new Error("Phase 0.5 unexpectedly encrypted the .madi fixture");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        executable: executableName,
        electronDependency: false,
        utf8: true,
        sceneBreakMarker: true,
        outputCreatedWithoutClobber: true,
        errorPathsRedacted: [
          "existing-output",
          "missing-document",
          "corrupt-database",
        ],
        encrypted: false,
        recoveredUtf8Bytes: recoveredBytes.byteLength,
        recoveredSha256: createHash("sha256")
          .update(recoveredBytes)
          .digest("hex"),
      },
      null,
      2,
    )}\n`,
  );
} finally {
  const safePrefix = resolve(tmpdir());
  const resolvedWorkspace = resolve(workspace);
  if (
    resolvedWorkspace.startsWith(`${safePrefix}\\`) ||
    resolvedWorkspace.startsWith(`${safePrefix}/`)
  ) {
    await rm(resolvedWorkspace, { recursive: true, force: true });
  }
}
