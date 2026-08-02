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

import {
  TYPIE_COMMIT,
  assertSemanticSceneBreak,
  countSceneBreaks,
  createEmptyEditor,
  createTypieHost,
  extractSnapshot,
  insertSceneBreak,
  insertText,
  moveToDocumentEnd,
  restoreEditor,
} from "./lib/typie-test-runtime.mjs";

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
const rounds = 20;
const documentId = "phase05-endurance-document";

function runCore(args) {
  const result = spawnSync(coreBinary, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    const detail =
      result.error instanceof Error ? `: ${result.error.message}` : "";
    throw new Error(
      `madi-core ${args[0]} failed with status ${String(
        result.status,
      )}${detail}; stderr=${JSON.stringify(result.stderr?.trim() ?? "")}`,
    );
  }
  const output = result.stdout.trim();
  return output ? JSON.parse(output) : undefined;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertProjectInspection(inspected, expectedRevision) {
  if (
    inspected.application_id !== 0x4d414449 ||
    inspected.integrity_check !== "ok" ||
    inspected.metadata.format_name !== "madi" ||
    inspected.metadata.format_version !== 1 ||
    inspected.metadata.schema_version !== 3 ||
    inspected.metadata.revision !== expectedRevision
  ) {
    throw new Error(
      `Invalid .madi metadata at revision ${expectedRevision}: ${JSON.stringify(
        inspected,
      )}`,
    );
  }
  if (
    inspected.schema_migrations.length !== 3 ||
    inspected.schema_migrations[0]?.version !== 1 ||
    inspected.schema_migrations[1]?.version !== 2 ||
    inspected.schema_migrations[2]?.version !== 3
  ) {
    throw new Error("Schema migration record changed during endurance test");
  }
  if (
    inspected.documents.length !== 1 ||
    inspected.documents[0]?.id !== documentId ||
    inspected.documents[0]?.editor_engine_commit !== TYPIE_COMMIT ||
    inspected.documents[0]?.editor_schema_version !== 1
  ) {
    throw new Error("Document order or editor metadata changed");
  }
}

function assertOrderedRounds(annotatedText, throughRound) {
  let previousIndex = -1;
  for (let round = 1; round <= throughRound; round += 1) {
    const token = `[회차-${String(round).padStart(2, "0")}]`;
    const tokenIndex = annotatedText.indexOf(token);
    if (tokenIndex <= previousIndex) {
      throw new Error(
        `Document content order changed at round ${round}: ${JSON.stringify(
          token,
        )}`,
      );
    }
    previousIndex = tokenIndex;
  }
}

const workspace = await mkdtemp(join(tmpdir(), "madi-endurance-"));
const projectPath = join(workspace, "20회-저장-복원.madi");
const snapshotPath = join(workspace, "current.snapshot");
const recoveryPath = join(workspace, "current.recovery.txt");
const roundReports = [];

try {
  runCore([
    "create-project",
    "--file-path",
    projectPath,
    "--title",
    "20회 저장 복원 검증",
    "--document-id",
    documentId,
    "--editor-engine",
    "typie",
    "--editor-engine-commit",
    TYPIE_COMMIT,
    "--editor-schema-version",
    "1",
  ]);

  let host = await createTypieHost();
  let editor = createEmptyEditor(host);
  insertText(editor, "첫 장면: 용은 오래된 산맥 위를 날았다.");
  insertSceneBreak(editor);
  moveToDocumentEnd(editor);
  insertText(editor, "둘째 장면: 마을의 종이 울렸다.");
  assertSemanticSceneBreak(editor);
  let snapshot = extractSnapshot(editor);
  let plainText = editor.prose_text_annotated();
  editor.free();
  host.free();

  await Promise.all([
    writeFile(snapshotPath, snapshot),
    writeFile(recoveryPath, plainText, "utf8"),
  ]);
  const initialSave = runCore([
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
    recoveryPath,
    "--expected-revision",
    "0",
  ]);
  if (initialSave.metadata.revision !== 1) {
    throw new Error("Initial project revision did not advance to 1");
  }

  for (let round = 1; round <= rounds; round += 1) {
    // A fresh core process opens the last saved graph.
    const before = runCore([
      "load-document",
      "--file-path",
      projectPath,
      "--document-id",
      documentId,
    ]);
    const beforeSnapshot = Buffer.from(before.snapshot_base64, "base64");

    // A fresh WASM host restores, modifies, and closes the document.
    host = await createTypieHost();
    editor = restoreEditor(host, beforeSnapshot);
    assertSemanticSceneBreak(editor);
    moveToDocumentEnd(editor);
    insertText(
      editor,
      ` [회차-${String(round).padStart(2, "0")}]`,
    );
    snapshot = extractSnapshot(editor);
    plainText = editor.prose_text_annotated();
    assertOrderedRounds(plainText, round);
    assertSemanticSceneBreak(editor);
    editor.free();
    host.free();

    await Promise.all([
      writeFile(snapshotPath, snapshot),
      writeFile(recoveryPath, plainText, "utf8"),
    ]);
    const expectedRevision = round;
    const saveResult = runCore([
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
      recoveryPath,
      "--expected-revision",
      String(expectedRevision),
    ]);
    const savedRevision = expectedRevision + 1;
    if (saveResult.metadata.revision !== savedRevision) {
      throw new Error(`Revision did not advance at round ${round}`);
    }

    // All save handles are closed. Reopen again in three separate core
    // processes and compare the persisted bytes and recovery representation.
    const loaded = runCore([
      "load-document",
      "--file-path",
      projectPath,
      "--document-id",
      documentId,
    ]);
    const recovered = runCore([
      "recover-plain-text",
      "--file-path",
      projectPath,
      "--document-id",
      documentId,
      "--json",
    ]);
    const inspected = runCore([
      "inspect-project",
      "--file-path",
      projectPath,
    ]);
    const storedSnapshot = Buffer.from(loaded.snapshot_base64, "base64");
    if (sha256(storedSnapshot) !== sha256(snapshot)) {
      throw new Error(`Snapshot bytes changed at round ${round}`);
    }
    if (loaded.plain_text_recovery !== plainText) {
      throw new Error(`Loaded recovery text changed at round ${round}`);
    }
    if (recovered.plain_text_recovery !== plainText) {
      throw new Error(`CLI recovery text changed at round ${round}`);
    }
    assertProjectInspection(inspected, savedRevision);

    host = await createTypieHost();
    editor = restoreEditor(host, storedSnapshot);
    if (editor.prose_text_annotated() !== plainText) {
      throw new Error(`Canonical Typie meaning changed at round ${round}`);
    }
    assertOrderedRounds(editor.prose_text_annotated(), round);
    assertSemanticSceneBreak(editor);
    editor.free();
    host.free();

    roundReports.push({
      round,
      revision: savedRevision,
      snapshotBytes: storedSnapshot.byteLength,
      snapshotSha256: sha256(storedSnapshot),
      recoveryUtf8Bytes: Buffer.byteLength(plainText, "utf8"),
      sceneBreaks: countSceneBreaks(plainText),
      migrations: inspected.schema_migrations.map(({ version }) => version),
    });
  }

  const header = (await readFile(projectPath))
    .subarray(0, 16)
    .toString("binary");
  if (header !== "SQLite format 3\u0000") {
    throw new Error("Endurance fixture is not a readable SQLite file");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        rounds,
        finalRevision: roundReports.at(-1)?.revision,
        exactStoredSnapshotComparison: true,
        canonicalTypieComparison: true,
        utf8RecoveryComparison: true,
        semanticSceneBreakId: "madi.scene-break.v1",
        semanticSceneBreaks: roundReports.at(-1)?.sceneBreaks,
        orderedContent: true,
        sqliteQuickCheck: "ok",
        schemaMigrationVersions: [1, 2, 3],
        perRound: roundReports,
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
