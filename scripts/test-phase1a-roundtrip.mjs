import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MADI_SCENE_BREAK_SEMANTIC_ID,
  TYPIE_COMMIT,
  countSemanticSceneBreakNodes,
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
const requestTimeoutMs = 30_000;
const shutdownTimeoutMs = 10_000;
const savedBy = "madi-phase1a-roundtrip";

class VerificationError extends Error {
  constructor(code) {
    super(code);
    this.name = "VerificationError";
    this.code = code;
  }
}

function verify(condition, code) {
  if (!condition) {
    throw new VerificationError(code);
  }
}

function equalJson(left, right) {
  const canonicalize = (value) => {
    if (Array.isArray(value)) {
      return value.map(canonicalize);
    }
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
          .map(([key, nested]) => [key, canonicalize(nested)]),
      );
    }
    return value;
  };
  return (
    JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
  );
}

class SidecarClient {
  constructor() {
    this.child = spawn(coreBinary, ["serve"], {
      cwd: repositoryRoot,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr.resume();
    this.child.stdout.setEncoding("utf8");
    this.buffer = "";
    this.nextId = 0;
    this.pending = new Map();
    this.exited = false;

    this.exitPromise = new Promise((resolveExit) => {
      this.child.once("close", (code) => {
        this.exited = true;
        this.rejectPending("core-closed-with-pending-request");
        resolveExit(code);
      });
    });
    this.child.once("error", () => {
      this.rejectPending("core-process-error");
    });
    this.child.stdin.on("error", () => {
      this.rejectPending("core-stdin-error");
    });
    this.child.stdout.on("data", (chunk) => {
      this.acceptOutput(chunk);
    });
  }

  rejectPending(code) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new VerificationError(code));
    }
    this.pending.clear();
  }

  acceptOutput(chunk) {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length > 0) {
        this.acceptLine(line);
      }
      newline = this.buffer.indexOf("\n");
    }
  }

  acceptLine(line) {
    let response;
    try {
      response = JSON.parse(line);
    } catch {
      this.rejectPending("core-invalid-json-response");
      return;
    }

    const entry = this.pending.get(String(response.id));
    if (!entry) {
      this.rejectPending("core-unmatched-json-rpc-response");
      return;
    }
    this.pending.delete(String(response.id));
    clearTimeout(entry.timer);

    if (response.error !== undefined) {
      const rpcCode = Number.isInteger(response.error?.code)
        ? String(response.error.code)
        : "unknown";
      entry.reject(
        new VerificationError(`rpc-${entry.method}-failed-${rpcCode}`),
      );
      return;
    }
    if (!("result" in response)) {
      entry.reject(new VerificationError("core-missing-json-rpc-result"));
      return;
    }
    entry.resolve(response.result);
  }

  request(method, params) {
    verify(!this.exited, "core-request-after-exit");
    const id = `phase1a-${++this.nextId}`;

    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new VerificationError(`rpc-${method}-timeout`));
      }, requestTimeoutMs);
      this.pending.set(id, {
        method,
        reject: rejectRequest,
        resolve: resolveRequest,
        timer,
      });

      const payload = `${JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      })}\n`;
      this.child.stdin.write(payload, (error) => {
        if (!error) {
          return;
        }
        const entry = this.pending.get(id);
        if (entry) {
          this.pending.delete(id);
          clearTimeout(entry.timer);
          entry.reject(new VerificationError(`rpc-${method}-write-failed`));
        }
      });
    });
  }

  async close() {
    if (!this.exited) {
      this.child.stdin.end();
    }
    let shutdownTimer;
    try {
      const code = await Promise.race([
        this.exitPromise,
        new Promise((_, rejectShutdown) => {
          shutdownTimer = setTimeout(
            () =>
              rejectShutdown(new VerificationError("core-shutdown-timeout")),
            shutdownTimeoutMs,
          );
        }),
      ]);
      verify(code === 0, "core-nonzero-exit");
      verify(this.buffer.trim().length === 0, "core-trailing-output");
    } finally {
      clearTimeout(shutdownTimer);
    }
  }

  async forceStop() {
    if (this.exited) {
      return;
    }
    this.child.stdin.end();
    let stopTimer;
    const stopped = await Promise.race([
      this.exitPromise.then(() => true),
      new Promise((resolveStop) => {
        stopTimer = setTimeout(() => resolveStop(false), 1_000);
      }),
    ]);
    clearTimeout(stopTimer);
    if (!stopped && !this.exited) {
      this.child.kill();
      await this.exitPromise;
    }
  }
}

function buildSceneFixture(host, definition) {
  const editor = createEmptyEditor(host);
  try {
    insertText(editor, definition.before);
    if (definition.after !== undefined) {
      insertSceneBreak(editor);
      moveToDocumentEnd(editor);
      insertText(editor, definition.after);
    }

    const plainText = editor.prose_text_annotated();
    const semanticCount = countSemanticSceneBreakNodes(editor);
    verify(
      semanticCount === definition.expectedSemanticCount,
      `fixture-semantic-count-${definition.sceneId}`,
    );
    const snapshot = extractSnapshot(editor);
    const restored = restoreEditor(host, snapshot);
    try {
      verify(
        restored.prose_text_annotated() === plainText,
        `fixture-text-restore-${definition.sceneId}`,
      );
      verify(
        countSemanticSceneBreakNodes(restored) === semanticCount,
        `fixture-semantic-restore-${definition.sceneId}`,
      );
    } finally {
      restored.free();
    }

    return {
      sceneId: definition.sceneId,
      snapshot,
      plainText,
      semanticCount,
      title: definition.title,
    };
  } finally {
    editor.free();
  }
}

function expectedNode(id, parentId, kind, title, documentId = null) {
  return { id, parentId, kind, title, documentId };
}

async function run() {
  verify(existsSync(coreBinary), "core-binary-missing");
  verify(
    MADI_SCENE_BREAK_SEMANTIC_ID === "madi.scene-break.v1",
    "scene-break-semantic-id",
  );

  const workspace = await mkdtemp(join(tmpdir(), "madi-phase1a-roundtrip-"));
  const projectPath = join(workspace, "드래곤을죽이다.madi");
  const projectId = "project-phase1a-roundtrip";
  const defaultDocumentId = "document-scene-default";
  const projectTitle = "드래곤을 죽이다";
  const defaultTitle = "프롤로그";
  const uiStateKey = "binder";
  let firstProcess;
  let secondProcess;
  let host;

  try {
    host = await createTypieHost();
    firstProcess = new SidecarClient();
    const created = await firstProcess.request("create_project", {
      file_path: projectPath,
      title: projectTitle,
      author_name: "안동민",
      created_by: savedBy,
      project_id: projectId,
      document_id: defaultDocumentId,
      document_title: defaultTitle,
      editor_engine: "typie",
      editor_engine_commit: TYPIE_COMMIT,
      editor_schema_version: 1,
    });
    verify(created.project.metadata.revision === 0, "create-project-revision");
    verify(created.project.metadata.project_id === projectId, "create-project-id");

    const workId = created.work_node_id;
    const defaultChapterId = created.default_chapter_node_id;
    const defaultSceneId = created.default_scene_node_id;
    verify(
      created.default_document_id === defaultDocumentId,
      "create-default-document-id",
    );

    const expectedNodes = [
      expectedNode(workId, null, "WORK", projectTitle),
      expectedNode(defaultChapterId, workId, "CHAPTER", defaultTitle),
      expectedNode(
        defaultSceneId,
        defaultChapterId,
        "SCENE",
        defaultTitle,
        defaultDocumentId,
      ),
    ];
    let revision = 0;

    const createNode = async (definition) => {
      const params = {
        file_path: projectPath,
        parent_id: definition.parentId,
        node_id: definition.id,
        kind: definition.kind,
        title: definition.title,
        expected_revision: revision,
        saved_by: savedBy,
      };
      if (definition.kind === "SCENE") {
        params.document_id = definition.documentId;
        params.editor_engine = "typie";
        params.editor_engine_commit = TYPIE_COMMIT;
        params.editor_schema_version = 1;
      }
      const result = await firstProcess.request("create_tree_node", params);
      revision += 1;
      verify(result.metadata.revision === revision, `create-revision-${definition.id}`);
      verify(result.node.id === definition.id, `create-node-id-${definition.id}`);
      expectedNodes.push(
        expectedNode(
          definition.id,
          definition.parentId,
          definition.kind,
          definition.title,
          definition.documentId ?? null,
        ),
      );
    };

    const nodesToCreate = [
      {
        id: "volume-1",
        parentId: workId,
        kind: "VOLUME",
        title: "제1권 불씨",
      },
      {
        id: "volume-2",
        parentId: workId,
        kind: "VOLUME",
        title: "제2권 재의 왕좌",
      },
      {
        id: "chapter-volume-1-a",
        parentId: "volume-1",
        kind: "CHAPTER",
        title: "제1장 잿빛 징조",
      },
      {
        id: "chapter-volume-1-b",
        parentId: "volume-1",
        kind: "CHAPTER",
        title: "제2장 검은 숲",
      },
      {
        id: "chapter-volume-2-a",
        parentId: "volume-2",
        kind: "CHAPTER",
        title: "제3장 왕성의 문",
      },
      {
        id: "scene-volume-1-a-1",
        parentId: "chapter-volume-1-a",
        kind: "SCENE",
        title: "산맥의 그림자",
        documentId: "document-scene-volume-1-a-1",
      },
      {
        id: "scene-volume-1-a-2",
        parentId: "chapter-volume-1-a",
        kind: "SCENE",
        title: "불길한 전갈",
        documentId: "document-scene-volume-1-a-2",
      },
      {
        id: "scene-volume-1-b-1",
        parentId: "chapter-volume-1-b",
        kind: "SCENE",
        title: "숲의 추격",
        documentId: "document-scene-volume-1-b-1",
      },
      {
        id: "scene-volume-2-a-1",
        parentId: "chapter-volume-2-a",
        kind: "SCENE",
        title: "닫힌 성문",
        documentId: "document-scene-volume-2-a-1",
      },
      {
        id: "scene-volume-2-a-2",
        parentId: "chapter-volume-2-a",
        kind: "SCENE",
        title: "왕좌 아래의 불",
        documentId: "document-scene-volume-2-a-2",
      },
    ];
    for (const definition of nodesToCreate) {
      await createNode(definition);
    }

    const reorderResult = await firstProcess.request("reorder_tree_node", {
      file_path: projectPath,
      node_id: "scene-volume-1-a-2",
      before_node_id: "scene-volume-1-a-1",
      expected_revision: revision,
      saved_by: savedBy,
    });
    revision += 1;
    verify(reorderResult.metadata.revision === revision, "reorder-revision");

    const fixtures = [
      buildSceneFixture(host, {
        sceneId: defaultSceneId,
        title: defaultTitle,
        before: "프롤로그에서 용은 오래된 산맥 위를 천천히 날았다.",
        expectedSemanticCount: 0,
      }),
      buildSceneFixture(host, {
        sceneId: "scene-volume-1-a-1",
        title: "산맥의 그림자",
        before: "서윤은 산등성이에서 검게 갈라진 비늘을 발견했다.",
        after: "밤이 내리자 멀리서 용의 울음이 골짜기를 흔들었다.",
        expectedSemanticCount: 1,
      }),
      buildSceneFixture(host, {
        sceneId: "scene-volume-2-a-1",
        title: "닫힌 성문",
        before: "성문은 굳게 닫혀 있었고 횃불만 바람에 떨렸다.",
        expectedSemanticCount: 0,
      }),
    ];

    for (const fixture of fixtures) {
      const saved = await firstProcess.request("save_scene", {
        file_path: projectPath,
        scene_id: fixture.sceneId,
        editor_engine: "typie",
        editor_engine_commit: TYPIE_COMMIT,
        editor_schema_version: 1,
        snapshot_base64: Buffer.from(fixture.snapshot).toString("base64"),
        plain_text_recovery: fixture.plainText,
        expected_revision: revision,
        saved_by: savedBy,
      });
      revision += 1;
      verify(saved.metadata.revision === revision, `save-revision-${fixture.sceneId}`);
      verify(saved.scene.id === fixture.sceneId, `save-scene-id-${fixture.sceneId}`);
      verify(saved.document.title === fixture.title, `save-title-${fixture.sceneId}`);
    }

    const uiState = {
      selected_node_id: "scene-volume-1-a-2",
      collapsed_node_ids: ["volume-2", "chapter-volume-1-b"],
      active_panel: "binder",
    };
    const savedUi = await firstProcess.request("save_ui_state", {
      file_path: projectPath,
      key: uiStateKey,
      value: uiState,
    });
    verify(savedUi.metadata.revision === revision, "ui-save-changed-revision");
    verify(equalJson(savedUi.state.value, uiState), "ui-save-value");

    await firstProcess.close();
    firstProcess = undefined;

    secondProcess = new SidecarClient();
    const opened = await secondProcess.request("open_project", {
      file_path: projectPath,
    });
    verify(opened.metadata.revision === revision, "reopen-revision");
    verify(opened.metadata.project_id === projectId, "reopen-project-id");
    verify(opened.metadata.title === projectTitle, "reopen-project-title");

    const tree = await secondProcess.request("load_project_tree", {
      file_path: projectPath,
    });
    verify(tree.metadata.revision === revision, "tree-revision");
    verify(tree.project.id === projectId, "tree-project-id");
    verify(tree.project.title === projectTitle, "tree-project-title");
    verify(tree.project.author_name === "안동민", "tree-author-name");
    verify(tree.project.work_node_id === workId, "tree-work-node-id");
    verify(tree.nodes.length === expectedNodes.length, "tree-node-count");

    const actualById = new Map(tree.nodes.map((node) => [node.id, node]));
    for (const expected of expectedNodes) {
      const actual = actualById.get(expected.id);
      verify(actual !== undefined, `tree-missing-node-${expected.id}`);
      verify(actual.parent_id === expected.parentId, `tree-parent-${expected.id}`);
      verify(actual.kind === expected.kind, `tree-kind-${expected.id}`);
      verify(actual.title === expected.title, `tree-title-${expected.id}`);
      verify(
        actual.document_id === expected.documentId,
        `tree-document-${expected.id}`,
      );
    }

    const hierarchy = Object.fromEntries(
      ["WORK", "VOLUME", "CHAPTER", "SCENE"].map((kind) => [
        kind,
        tree.nodes.filter((node) => node.kind === kind).length,
      ]),
    );
    verify(hierarchy.WORK === 1, "hierarchy-work-count");
    verify(hierarchy.VOLUME >= 2, "hierarchy-volume-count");
    verify(hierarchy.CHAPTER >= 3, "hierarchy-chapter-count");
    verify(hierarchy.SCENE >= 5, "hierarchy-scene-count");

    const reorderedSceneIds = tree.nodes
      .filter((node) => node.parent_id === "chapter-volume-1-a")
      .sort((left, right) => left.order_key - right.order_key)
      .map((node) => node.id);
    verify(
      equalJson(reorderedSceneIds, [
        "scene-volume-1-a-2",
        "scene-volume-1-a-1",
      ]),
      "scene-reorder-not-persisted",
    );

    const loadedUi = await secondProcess.request("load_ui_state", {
      file_path: projectPath,
      key: uiStateKey,
    });
    verify(loadedUi.metadata.revision === revision, "ui-load-revision");
    verify(loadedUi.state?.key === uiStateKey, "ui-load-key");
    verify(loadedUi.state?.project_id === projectId, "ui-load-project-id");
    verify(equalJson(loadedUi.state?.value, uiState), "ui-load-value");

    const snapshotHashes = [];
    for (const fixture of fixtures) {
      const loaded = await secondProcess.request("load_scene", {
        file_path: projectPath,
        scene_id: fixture.sceneId,
      });
      const loadedSnapshot = Buffer.from(
        loaded.document.snapshot_base64,
        "base64",
      );
      verify(loaded.project_revision === revision, `scene-revision-${fixture.sceneId}`);
      verify(loaded.scene.id === fixture.sceneId, `scene-id-${fixture.sceneId}`);
      verify(loaded.scene.title === fixture.title, `scene-title-${fixture.sceneId}`);
      verify(
        loaded.document.id === loaded.scene.document_id,
        `scene-document-link-${fixture.sceneId}`,
      );
      verify(
        loaded.document.title === fixture.title,
        `scene-document-title-${fixture.sceneId}`,
      );
      verify(loaded.document.editor_engine === "typie", `scene-engine-${fixture.sceneId}`);
      verify(
        loaded.document.editor_engine_commit === TYPIE_COMMIT,
        `scene-engine-commit-${fixture.sceneId}`,
      );
      verify(
        loaded.document.editor_schema_version === 1,
        `scene-schema-version-${fixture.sceneId}`,
      );
      verify(
        loadedSnapshot.equals(Buffer.from(fixture.snapshot)),
        `scene-snapshot-bytes-${fixture.sceneId}`,
      );
      verify(
        loaded.document.plain_text_recovery === fixture.plainText,
        `scene-plain-text-${fixture.sceneId}`,
      );

      const restored = restoreEditor(host, loadedSnapshot);
      try {
        verify(
          restored.prose_text_annotated() === fixture.plainText,
          `scene-typie-text-${fixture.sceneId}`,
        );
        verify(
          countSemanticSceneBreakNodes(restored) === fixture.semanticCount,
          `scene-semantic-count-${fixture.sceneId}`,
        );
      } finally {
        restored.free();
      }
      snapshotHashes.push({
        sceneId: fixture.sceneId,
        sha256: createHash("sha256").update(loadedSnapshot).digest("hex"),
      });
    }

    await secondProcess.close();
    secondProcess = undefined;

    process.stdout.write(
      `${JSON.stringify(
        {
          phase: "1A",
          fileName: "드래곤을죽이다.madi",
          coreProcesses: 2,
          processRestartRoundTrip: true,
          hierarchy: {
            works: hierarchy.WORK,
            volumes: hierarchy.VOLUME,
            chapters: hierarchy.CHAPTER,
            scenes: hierarchy.SCENE,
          },
          reorderedSceneIds,
          savedScenes: fixtures.length,
          exactSnapshotBytes: true,
          exactPlainText: true,
          semanticSceneBreak: {
            id: MADI_SCENE_BREAK_SEMANTIC_ID,
            count: fixtures.reduce(
              (total, fixture) => total + fixture.semanticCount,
              0,
            ),
            preserved: true,
          },
          uiStateRestored: true,
          finalRevision: revision,
          snapshotHashes,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    if (firstProcess) {
      await firstProcess.forceStop();
    }
    if (secondProcess) {
      await secondProcess.forceStop();
    }
    if (host) {
      host.free();
    }
    const safePrefix = resolve(tmpdir());
    const resolvedWorkspace = resolve(workspace);
    if (
      resolvedWorkspace.startsWith(`${safePrefix}\\`) ||
      resolvedWorkspace.startsWith(`${safePrefix}/`)
    ) {
      await rm(resolvedWorkspace, { recursive: true, force: true });
    }
  }
}

try {
  await run();
} catch (error) {
  const code =
    error instanceof VerificationError ? error.code : "unexpected-failure";
  const location =
    error instanceof VerificationError
      ? ""
      : (error?.stack?.match(/test-phase1a-roundtrip\.mjs:(\d+):(\d+)/)?.[0] ??
        "unknown-location");
  process.stderr.write(`phase1a-roundtrip: ${code} ${location}\n`);
  process.exitCode = 1;
}
