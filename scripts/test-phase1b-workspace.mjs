import { spawn } from "node:child_process";
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
  dispatch,
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
const savedBy = "madi-phase1b-workspace";
const query = "불씨";
const replacement = "별빛";

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
    const id = `phase1b-${++this.nextId}`;

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

function semanticDocumentFingerprint(entry) {
  if (entry.node.type === "text") {
    return "";
  }
  return JSON.stringify({
    node: entry.node,
    modifiers: entry.modifiers,
    carry: entry.carry ?? [],
    children: entry.children
      .map(semanticDocumentFingerprint)
      .filter((child) => child !== ""),
  });
}

function editorStructure(editor) {
  return semanticDocumentFingerprint(
    editor.materialize_at(editor.current_heads(), []).root,
  );
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
    const structure = editorStructure(editor);
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
      verify(
        editorStructure(restored) === structure,
        `fixture-structure-restore-${definition.sceneId}`,
      );
    } finally {
      restored.free();
    }

    return {
      ...definition,
      plainText,
      semanticCount,
      snapshot,
      structure,
    };
  } finally {
    editor.free();
  }
}

function scalarSlice(text, start, end) {
  return Array.from(text).slice(start, end).join("");
}

function expectedReplacementText(text, replacements) {
  const characters = Array.from(text);
  const ordered = [...replacements].sort(
    (left, right) => right.start - left.start || right.end - left.end,
  );
  for (const entry of ordered) {
    verify(
      scalarSlice(text, entry.start, entry.end) === entry.expectedText,
      `replacement-source-range-${entry.id}`,
    );
    characters.splice(
      entry.start,
      entry.end - entry.start,
      ...Array.from(entry.replacement),
    );
  }
  return characters.join("");
}

function sceneIds(descendants) {
  return descendants.scenes.map((entry) => entry.scene.id);
}

function assertDescendantOrder(descendants, expected, code) {
  verify(descendants.total_scenes === expected.length, `${code}-total`);
  verify(descendants.has_more === false, `${code}-pagination`);
  verify(equalJson(sceneIds(descendants), expected), `${code}-order`);
}

function snapshotInventory(result) {
  return result.snapshots
    .map((snapshot) => ({
      contentHash: snapshot.content_hash,
      id: snapshot.id,
      kind: snapshot.kind,
      name: snapshot.name,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function run() {
  verify(existsSync(coreBinary), "core-binary-missing");
  verify(
    MADI_SCENE_BREAK_SEMANTIC_ID === "madi.scene-break.v1",
    "scene-break-semantic-id",
  );

  const workspace = await mkdtemp(join(tmpdir(), "madi-phase1b-workspace-"));
  const projectPath = join(workspace, "불씨의지도.madi");
  const projectTitle = "불씨의 지도";
  const projectId = "project-phase1b-workspace";
  const defaultDocumentId = "document-prologue";
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
      document_title: "프롤로그",
      editor_engine: "typie",
      editor_engine_commit: TYPIE_COMMIT,
      editor_schema_version: 1,
    });
    verify(created.project.metadata.revision === 0, "create-project-revision");
    verify(created.project.metadata.project_id === projectId, "create-project-id");
    verify(
      created.default_document_id === defaultDocumentId,
      "create-default-document-id",
    );

    const workId = created.work_node_id;
    const defaultSceneId = created.default_scene_node_id;
    let revision = 0;
    const nodeDefinitions = [
      {
        id: "volume-north",
        parentId: workId,
        kind: "VOLUME",
        title: "제1권 북쪽의 봉인",
      },
      {
        id: "volume-south",
        parentId: workId,
        kind: "VOLUME",
        title: "제2권 남쪽의 성문",
      },
      {
        id: "chapter-north-1",
        parentId: "volume-north",
        kind: "CHAPTER",
        title: "제1장 잿빛 능선",
      },
      {
        id: "chapter-north-2",
        parentId: "volume-north",
        kind: "CHAPTER",
        title: "제2장 검은 숲",
      },
      {
        id: "chapter-south-1",
        parentId: "volume-south",
        kind: "CHAPTER",
        title: "제3장 닫힌 항구",
      },
      {
        id: "chapter-south-2",
        parentId: "volume-south",
        kind: "CHAPTER",
        title: "제4장 유리 왕좌",
      },
      {
        id: "scene-north-1-1",
        parentId: "chapter-north-1",
        kind: "SCENE",
        title: "산맥의 신호",
        documentId: "document-north-1-1",
      },
      {
        id: "scene-north-1-2",
        parentId: "chapter-north-1",
        kind: "SCENE",
        title: "파수꾼의 편지",
        documentId: "document-north-1-2",
      },
      {
        id: "scene-north-1-3",
        parentId: "chapter-north-1",
        kind: "SCENE",
        title: "눈 덮인 동굴",
        documentId: "document-north-1-3",
      },
      {
        id: "scene-north-2-1",
        parentId: "chapter-north-2",
        kind: "SCENE",
        title: "까마귀 길",
        documentId: "document-north-2-1",
      },
      {
        id: "scene-north-2-2",
        parentId: "chapter-north-2",
        kind: "SCENE",
        title: "고요한 야영지",
        documentId: "document-north-2-2",
      },
      {
        id: "scene-south-1-1",
        parentId: "chapter-south-1",
        kind: "SCENE",
        title: "소금 바람",
        documentId: "document-south-1-1",
      },
      {
        id: "scene-south-1-2",
        parentId: "chapter-south-1",
        kind: "SCENE",
        title: "잠긴 창고",
        documentId: "document-south-1-2",
      },
      {
        id: "scene-south-2-1",
        parentId: "chapter-south-2",
        kind: "SCENE",
        title: "거울 회랑",
        documentId: "document-south-2-1",
      },
      {
        id: "scene-south-2-2",
        parentId: "chapter-south-2",
        kind: "SCENE",
        title: "왕좌 아래",
        documentId: "document-south-2-2",
      },
    ];

    for (const definition of nodeDefinitions) {
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
      verify(
        result.metadata.revision === revision,
        `create-node-revision-${definition.id}`,
      );
      verify(result.node.id === definition.id, `create-node-id-${definition.id}`);
    }

    const fixtureDefinitions = [
      {
        sceneId: defaultSceneId,
        documentId: defaultDocumentId,
        title: "프롤로그",
        before:
          "프롤로그의 새벽, 서윤은 성벽 아래에서 불씨를 품은 봉인을 발견했다.",
        expectedSemanticCount: 0,
      },
      {
        sceneId: "scene-north-1-1",
        documentId: "document-north-1-1",
        title: "산맥의 신호",
        before: "산맥의 바람이 오래된 깃발을 세차게 흔들었다.",
        after: "동굴 안에서는 작은 불씨가 푸른 숨결처럼 살아났다.",
        expectedSemanticCount: 1,
      },
      {
        sceneId: "scene-north-1-2",
        documentId: "document-north-1-2",
        title: "파수꾼의 편지",
        before: "파수꾼은 불씨가 사라지기 전에 북문을 닫으라는 편지를 남겼다.",
        expectedSemanticCount: 0,
      },
      {
        sceneId: "scene-north-1-3",
        documentId: "document-north-1-3",
        title: "눈 덮인 동굴",
        before: "눈 덮인 동굴에서 불씨는 유리병 벽에 붉은 그림자를 새겼다.",
        expectedSemanticCount: 0,
      },
      {
        sceneId: "scene-north-2-1",
        documentId: "document-north-2-1",
        title: "까마귀 길",
        before: "까마귀 떼가 불씨를 실은 마차 위로 낮게 원을 그렸다.",
        expectedSemanticCount: 0,
      },
      {
        sceneId: "scene-north-2-2",
        documentId: "document-north-2-2",
        title: "고요한 야영지",
        before: "고요한 야영지에는 젖은 장작 냄새와 말발굽 자국만 남아 있었다.",
        expectedSemanticCount: 0,
      },
      {
        sceneId: "scene-south-1-1",
        documentId: "document-south-1-1",
        title: "소금 바람",
        before: "소금기 어린 바람이 빈 부두의 밧줄을 느리게 울렸다.",
        expectedSemanticCount: 0,
      },
      {
        sceneId: "scene-south-1-2",
        documentId: "document-south-1-2",
        title: "잠긴 창고",
        before: "잠긴 창고 바닥에는 낯선 왕가의 문장이 희미하게 찍혀 있었다.",
        expectedSemanticCount: 0,
      },
      {
        sceneId: "scene-south-2-1",
        documentId: "document-south-2-1",
        title: "거울 회랑",
        before: "거울 회랑을 지날 때마다 서윤의 발소리가 한 박자 늦게 돌아왔다.",
        expectedSemanticCount: 0,
      },
      {
        sceneId: "scene-south-2-2",
        documentId: "document-south-2-2",
        title: "왕좌 아래",
        before: "왕좌 아래의 계단은 지하 호수로 이어지는 차가운 숨을 내뿜었다.",
        expectedSemanticCount: 0,
      },
    ];
    const fixtures = fixtureDefinitions.map((definition) =>
      buildSceneFixture(host, definition),
    );
    verify(fixtures.length === 10, "fixture-scene-count");
    verify(
      new Set(fixtures.map((fixture) => fixture.plainText)).size ===
        fixtures.length,
      "fixture-bodies-not-distinct",
    );
    verify(
      fixtures.reduce(
        (total, fixture) => total + fixture.semanticCount,
        0,
      ) === 1,
      "fixture-semantic-scene-break-total",
    );

    for (const fixture of fixtures) {
      const result = await firstProcess.request("save_scene", {
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
      verify(
        result.metadata.revision === revision,
        `save-scene-revision-${fixture.sceneId}`,
      );
      verify(result.scene.id === fixture.sceneId, `save-scene-id-${fixture.sceneId}`);
    }

    const tree = await firstProcess.request("load_project_tree", {
      file_path: projectPath,
    });
    const hierarchy = Object.fromEntries(
      ["WORK", "VOLUME", "CHAPTER", "SCENE"].map((kind) => [
        kind,
        tree.nodes.filter((node) => node.kind === kind).length,
      ]),
    );
    verify(hierarchy.WORK === 1, "hierarchy-work-count");
    verify(hierarchy.VOLUME === 2, "hierarchy-volume-count");
    verify(hierarchy.CHAPTER >= 4, "hierarchy-chapter-count");
    verify(hierarchy.SCENE >= 10, "hierarchy-scene-count");

    const initialWork = await firstProcess.request("list_descendant_scenes", {
      file_path: projectPath,
      scope_node_id: workId,
      offset: 0,
      limit: 20,
    });
    const initialNorth = await firstProcess.request("list_descendant_scenes", {
      file_path: projectPath,
      scope_node_id: "volume-north",
      offset: 0,
      limit: 20,
    });
    const initialSouth = await firstProcess.request("list_descendant_scenes", {
      file_path: projectPath,
      scope_node_id: "volume-south",
      offset: 0,
      limit: 20,
    });
    const expectedWorkOrder = fixtures.map((fixture) => fixture.sceneId);
    const expectedNorthOrder = fixtures.slice(1, 6).map((fixture) => fixture.sceneId);
    const expectedSouthOrder = fixtures.slice(6).map((fixture) => fixture.sceneId);
    assertDescendantOrder(initialWork, expectedWorkOrder, "initial-work");
    assertDescendantOrder(initialNorth, expectedNorthOrder, "initial-north");
    assertDescendantOrder(initialSouth, expectedSouthOrder, "initial-south");

    const previewByScene = new Map(
      initialWork.scenes.map((entry) => [entry.scene.id, entry.document]),
    );
    for (const fixture of fixtures) {
      const preview = previewByScene.get(fixture.sceneId);
      verify(preview !== undefined, `preview-missing-${fixture.sceneId}`);
      verify(
        preview.plain_text_recovery === fixture.plainText,
        `preview-text-${fixture.sceneId}`,
      );
      verify(
        /^[0-9a-f]{64}$/.test(preview.source_content_hash),
        `preview-hash-${fixture.sceneId}`,
      );
      verify(
        !("snapshot_base64" in preview),
        `preview-snapshot-leak-${fixture.sceneId}`,
      );
    }

    const baselineSnapshot = await firstProcess.request(
      "create_named_snapshot",
      {
        file_path: projectPath,
        name: "Phase 1B 치환 전 기준",
        note: "한국어 exact search와 선택 치환 통합 검증 기준",
        kind: "MANUAL",
        expected_revision: revision,
        saved_by: savedBy,
      },
    );
    revision += 1;
    verify(
      baselineSnapshot.metadata.revision === revision,
      "manual-snapshot-revision",
    );
    verify(baselineSnapshot.snapshot.kind === "MANUAL", "manual-snapshot-kind");

    const searchBefore = await firstProcess.request("search_project", {
      file_path: projectPath,
      query,
      case_sensitive: true,
      target: "BODIES",
      scope_node_id: workId,
      offset: 0,
      limit: 20,
    });
    verify(searchBefore.total_matches === 5, "search-before-total");
    verify(searchBefore.scene_count === 5, "search-before-scenes");
    verify(searchBefore.hits.length === 5, "search-before-hit-count");
    verify(searchBefore.has_more === false, "search-before-pagination");
    for (const hit of searchBefore.hits) {
      verify(hit.field === "BODY", `search-hit-field-${hit.occurrence_id}`);
      verify(hit.matched_text === query, `search-hit-text-${hit.occurrence_id}`);
      verify(hit.scene_id !== null, `search-hit-scene-${hit.occurrence_id}`);
      verify(hit.document_id !== null, `search-hit-document-${hit.occurrence_id}`);
      verify(
        hit.source_content_hash ===
          previewByScene.get(hit.scene_id)?.source_content_hash,
        `search-hit-hash-${hit.occurrence_id}`,
      );
    }

    const selectedHits = searchBefore.hits.slice(0, 3);
    verify(selectedHits.length === 3, "selected-hit-count");
    verify(
      new Set(selectedHits.map((hit) => hit.scene_id)).size === 3,
      "selected-hits-not-three-scenes",
    );
    verify(
      selectedHits.some((hit) => hit.scene_id === "scene-north-1-1"),
      "semantic-scene-not-selected",
    );

    const selectedByScene = new Map();
    for (const hit of selectedHits) {
      const entries = selectedByScene.get(hit.scene_id) ?? [];
      entries.push(hit);
      selectedByScene.set(hit.scene_id, entries);
    }

    const fixtureByScene = new Map(
      fixtures.map((fixture) => [fixture.sceneId, fixture]),
    );
    const transformedScenes = [];
    const transformedExpectations = new Map();
    for (const [sceneId, hits] of selectedByScene) {
      const fixture = fixtureByScene.get(sceneId);
      verify(fixture !== undefined, `selected-fixture-${sceneId}`);
      const loaded = await firstProcess.request("load_scene", {
        file_path: projectPath,
        scene_id: sceneId,
      });
      const sourceSnapshot = Buffer.from(
        loaded.document.snapshot_base64,
        "base64",
      );
      verify(
        sourceSnapshot.equals(Buffer.from(fixture.snapshot)),
        `selected-source-snapshot-${sceneId}`,
      );
      verify(
        loaded.document.plain_text_recovery === fixture.plainText,
        `selected-source-text-${sceneId}`,
      );

      const editor = restoreEditor(host, sourceSnapshot);
      try {
        const originalText = editor.prose_text_annotated();
        const originalSemanticCount = countSemanticSceneBreakNodes(editor);
        const originalStructure = editorStructure(editor);
        const replacements = hits
          .map((hit) => ({
            id: hit.occurrence_id,
            start: hit.start_char,
            end: hit.end_char,
            expectedText: hit.matched_text,
            replacement,
          }))
          .sort(
            (left, right) =>
              right.start - left.start || right.end - left.end,
          );
        const expectedText = expectedReplacementText(originalText, replacements);
        const tick = dispatch(editor, [
          {
            type: "tracked_range",
            op: {
              type: "replace_many_from_prose_annotated",
              expected_text: originalText,
              replacements: replacements.map((entry) => ({
                id: entry.id,
                start: entry.start,
                end: entry.end,
                expected_text: entry.expectedText,
                replacement: entry.replacement,
              })),
            },
          },
        ]);
        const outcomes = new Map(
          tick.events
            .filter((event) => event.type === "tracked_range_replace_result")
            .map((event) => [event.id, event.outcome]),
        );
        for (const entry of replacements) {
          verify(
            outcomes.get(entry.id) === "replaced",
            `typie-replacement-outcome-${entry.id}`,
          );
        }
        verify(
          editor.prose_text_annotated() === expectedText,
          `typie-replacement-text-${sceneId}`,
        );
        verify(
          countSemanticSceneBreakNodes(editor) === originalSemanticCount,
          `typie-replacement-semantic-${sceneId}`,
        );
        verify(
          editorStructure(editor) === originalStructure,
          `typie-replacement-structure-${sceneId}`,
        );
        const nextSnapshot = extractSnapshot(editor);
        verify(
          !Buffer.from(nextSnapshot).equals(sourceSnapshot),
          `typie-replacement-snapshot-unchanged-${sceneId}`,
        );
        transformedScenes.push({
          scene_id: sceneId,
          document_id: fixture.documentId,
          editor_engine: "typie",
          editor_engine_commit: TYPIE_COMMIT,
          editor_schema_version: 1,
          snapshot_base64: Buffer.from(nextSnapshot).toString("base64"),
          plain_text_recovery: expectedText,
          occurrence_count: replacements.length,
          source_content_hash: hits[0].source_content_hash,
        });
        transformedExpectations.set(sceneId, {
          plainText: expectedText,
          semanticCount: originalSemanticCount,
          snapshot: nextSnapshot,
          structure: originalStructure,
        });
      } finally {
        editor.free();
      }
    }
    verify(transformedScenes.length === 3, "transformed-scene-count");
    verify(
      transformedScenes.every(
        (scene) =>
          typeof scene.source_content_hash === "string" &&
          /^[0-9a-f]{64}$/.test(scene.source_content_hash),
      ),
      "transformed-source-hashes",
    );

    const applied = await firstProcess.request("apply_replacement_batch", {
      file_path: projectPath,
      expected_revision: revision,
      query,
      replacement,
      case_sensitive: true,
      transformed_scenes: transformedScenes,
      saved_by: savedBy,
      auto_snapshot_name: "선택 치환 전 안전 저장",
    });
    revision += 1;
    verify(applied.metadata.revision === revision, "apply-revision");
    verify(applied.changed_scenes === 3, "apply-changed-scenes");
    verify(applied.changed_occurrences === 3, "apply-changed-occurrences");
    verify(
      applied.safety_snapshot.kind === "AUTO_BEFORE_REPLACE",
      "apply-safety-kind",
    );
    verify(
      equalJson(
        [...applied.changed_scene_ids].sort(),
        transformedScenes.map((scene) => scene.scene_id).sort(),
      ),
      "apply-changed-scene-ids",
    );

    const searchOriginalAfter = await firstProcess.request("search_project", {
      file_path: projectPath,
      query,
      case_sensitive: true,
      target: "BODIES",
      scope_node_id: workId,
      offset: 0,
      limit: 20,
    });
    const searchReplacementAfter = await firstProcess.request(
      "search_project",
      {
        file_path: projectPath,
        query: replacement,
        case_sensitive: true,
        target: "BODIES",
        scope_node_id: workId,
        offset: 0,
        limit: 20,
      },
    );
    verify(searchOriginalAfter.total_matches === 2, "search-original-after");
    verify(
      searchReplacementAfter.total_matches === 3,
      "search-replacement-after",
    );

    for (const [sceneId, expected] of transformedExpectations) {
      const loaded = await firstProcess.request("load_scene", {
        file_path: projectPath,
        scene_id: sceneId,
      });
      const snapshot = Buffer.from(loaded.document.snapshot_base64, "base64");
      verify(
        loaded.document.plain_text_recovery === expected.plainText,
        `applied-text-${sceneId}`,
      );
      verify(
        snapshot.equals(Buffer.from(expected.snapshot)),
        `applied-snapshot-${sceneId}`,
      );
      const editor = restoreEditor(host, snapshot);
      try {
        verify(
          countSemanticSceneBreakNodes(editor) === expected.semanticCount,
          `applied-semantic-${sceneId}`,
        );
        verify(
          editorStructure(editor) === expected.structure,
          `applied-structure-${sceneId}`,
        );
      } finally {
        editor.free();
      }
    }

    const reordered = await firstProcess.request("reorder_tree_node", {
      file_path: projectPath,
      node_id: "scene-north-1-3",
      before_node_id: "scene-north-1-1",
      expected_revision: revision,
      saved_by: savedBy,
    });
    revision += 1;
    verify(reordered.metadata.revision === revision, "reorder-revision");
    const northAfterReorder = await firstProcess.request(
      "list_descendant_scenes",
      {
        file_path: projectPath,
        scope_node_id: "volume-north",
        offset: 0,
        limit: 20,
      },
    );
    verify(
      !equalJson(sceneIds(northAfterReorder), expectedNorthOrder),
      "reorder-did-not-change-order",
    );

    const diff = await firstProcess.request("diff_named_snapshot", {
      file_path: projectPath,
      snapshot_id: applied.safety_snapshot.id,
    });
    verify(diff.summary.changed_scene_bodies === 3, "diff-changed-bodies");
    verify(diff.summary.reordered_nodes >= 1, "diff-reordered-nodes");
    verify(diff.summary.renamed_nodes === 0, "diff-renamed-nodes");
    verify(diff.summary.character_count_delta === 0, "diff-character-delta");
    verify(
      equalJson(diff.summary.added, { volumes: 0, chapters: 0, scenes: 0 }),
      "diff-added-nodes",
    );
    verify(
      equalJson(diff.summary.deleted, { volumes: 0, chapters: 0, scenes: 0 }),
      "diff-deleted-nodes",
    );

    const restored = await firstProcess.request("restore_named_snapshot", {
      file_path: projectPath,
      snapshot_id: applied.safety_snapshot.id,
      auto_snapshot_name: "기준 복원 전 안전 저장",
      expected_revision: revision,
      saved_by: savedBy,
    });
    revision += 1;
    verify(restored.metadata.revision === revision, "restore-revision");
    verify(
      restored.restored_snapshot.id === applied.safety_snapshot.id,
      "restore-target-id",
    );
    verify(
      restored.safety_snapshot.kind === "AUTO_BEFORE_RESTORE",
      "restore-safety-kind",
    );
    verify(
      equalJson(restored.changes_before_restore, diff.summary),
      "restore-diff-summary",
    );

    const restoredWork = await firstProcess.request("list_descendant_scenes", {
      file_path: projectPath,
      scope_node_id: workId,
      offset: 0,
      limit: 20,
    });
    const restoredNorth = await firstProcess.request("list_descendant_scenes", {
      file_path: projectPath,
      scope_node_id: "volume-north",
      offset: 0,
      limit: 20,
    });
    const restoredSouth = await firstProcess.request("list_descendant_scenes", {
      file_path: projectPath,
      scope_node_id: "volume-south",
      offset: 0,
      limit: 20,
    });
    assertDescendantOrder(restoredWork, expectedWorkOrder, "restored-work");
    assertDescendantOrder(restoredNorth, expectedNorthOrder, "restored-north");
    assertDescendantOrder(restoredSouth, expectedSouthOrder, "restored-south");

    for (const fixture of fixtures) {
      const loaded = await firstProcess.request("load_scene", {
        file_path: projectPath,
        scene_id: fixture.sceneId,
      });
      const snapshot = Buffer.from(loaded.document.snapshot_base64, "base64");
      verify(
        loaded.document.plain_text_recovery === fixture.plainText,
        `restored-text-${fixture.sceneId}`,
      );
      verify(
        snapshot.equals(Buffer.from(fixture.snapshot)),
        `restored-snapshot-${fixture.sceneId}`,
      );
      const editor = restoreEditor(host, snapshot);
      try {
        verify(
          countSemanticSceneBreakNodes(editor) === fixture.semanticCount,
          `restored-semantic-${fixture.sceneId}`,
        );
        verify(
          editorStructure(editor) === fixture.structure,
          `restored-structure-${fixture.sceneId}`,
        );
      } finally {
        editor.free();
      }
    }

    const searchRestored = await firstProcess.request("search_project", {
      file_path: projectPath,
      query,
      case_sensitive: true,
      target: "BODIES",
      scope_node_id: workId,
      offset: 0,
      limit: 20,
    });
    const replacementSearchRestored = await firstProcess.request(
      "search_project",
      {
        file_path: projectPath,
        query: replacement,
        case_sensitive: true,
        target: "BODIES",
        scope_node_id: workId,
        offset: 0,
        limit: 20,
      },
    );
    verify(searchRestored.total_matches === 5, "search-restored-original");
    verify(
      replacementSearchRestored.total_matches === 0,
      "search-restored-replacement",
    );

    const snapshotsBeforeRestart = await firstProcess.request(
      "list_named_snapshots",
      { file_path: projectPath },
    );
    const snapshotKinds = snapshotsBeforeRestart.snapshots.map(
      (snapshot) => snapshot.kind,
    );
    verify(snapshotKinds.includes("MANUAL"), "snapshot-list-manual");
    verify(
      snapshotKinds.includes("AUTO_BEFORE_REPLACE"),
      "snapshot-list-before-replace",
    );
    verify(
      snapshotKinds.includes("AUTO_BEFORE_RESTORE"),
      "snapshot-list-before-restore",
    );
    const inventoryBeforeRestart = snapshotInventory(snapshotsBeforeRestart);

    await firstProcess.close();
    firstProcess = undefined;

    secondProcess = new SidecarClient();
    const reopened = await secondProcess.request("open_project", {
      file_path: projectPath,
    });
    verify(reopened.metadata.revision === revision, "restart-revision");
    verify(reopened.metadata.project_id === projectId, "restart-project-id");

    const restartWork = await secondProcess.request("list_descendant_scenes", {
      file_path: projectPath,
      scope_node_id: workId,
      offset: 0,
      limit: 20,
    });
    const restartNorth = await secondProcess.request("list_descendant_scenes", {
      file_path: projectPath,
      scope_node_id: "volume-north",
      offset: 0,
      limit: 20,
    });
    const restartSouth = await secondProcess.request("list_descendant_scenes", {
      file_path: projectPath,
      scope_node_id: "volume-south",
      offset: 0,
      limit: 20,
    });
    assertDescendantOrder(restartWork, expectedWorkOrder, "restart-work");
    assertDescendantOrder(restartNorth, expectedNorthOrder, "restart-north");
    assertDescendantOrder(restartSouth, expectedSouthOrder, "restart-south");
    verify(
      restartWork.scenes.every(
        (entry, index) =>
          entry.document.plain_text_recovery === fixtures[index].plainText,
      ),
      "restart-scrivenings-text",
    );

    const restartSearch = await secondProcess.request("search_project", {
      file_path: projectPath,
      query,
      case_sensitive: true,
      target: "BODIES",
      scope_node_id: workId,
      offset: 0,
      limit: 20,
    });
    verify(restartSearch.total_matches === 5, "restart-search-total");
    verify(
      equalJson(
        restartSearch.hits.map((hit) => ({
          sceneId: hit.scene_id,
          start: hit.start_char,
          end: hit.end_char,
          text: hit.matched_text,
          hash: hit.source_content_hash,
        })),
        searchRestored.hits.map((hit) => ({
          sceneId: hit.scene_id,
          start: hit.start_char,
          end: hit.end_char,
          text: hit.matched_text,
          hash: hit.source_content_hash,
        })),
      ),
      "restart-search-results",
    );

    const snapshotsAfterRestart = await secondProcess.request(
      "list_named_snapshots",
      { file_path: projectPath },
    );
    verify(
      equalJson(snapshotInventory(snapshotsAfterRestart), inventoryBeforeRestart),
      "restart-snapshot-list",
    );

    await secondProcess.close();
    secondProcess = undefined;

    const kindCounts = Object.fromEntries(
      ["MANUAL", "AUTO_BEFORE_REPLACE", "AUTO_BEFORE_RESTORE"].map(
        (kind) => [
          kind,
          snapshotKinds.filter((candidate) => candidate === kind).length,
        ],
      ),
    );
    process.stdout.write(
      `${JSON.stringify(
        {
          phase: "1B",
          coreProcesses: 2,
          hierarchy: {
            works: hierarchy.WORK,
            volumes: hierarchy.VOLUME,
            chapters: hierarchy.CHAPTER,
            scenes: hierarchy.SCENE,
          },
          scrivenings: {
            workScenes: expectedWorkOrder.length,
            volumeScenes: [expectedNorthOrder.length, expectedSouthOrder.length],
            workAndVolumeOrderVerified: true,
          },
          exactKoreanSearch: {
            query,
            before: searchBefore.total_matches,
            selected: selectedHits.length,
            afterOriginal: searchOriginalAfter.total_matches,
            afterReplacement: searchReplacementAfter.total_matches,
            restored: searchRestored.total_matches,
          },
          atomicReplacement: {
            typieCommit: TYPIE_COMMIT,
            operation: "replace_many_from_prose_annotated",
            changedScenes: applied.changed_scenes,
            changedOccurrences: applied.changed_occurrences,
            sourceContentHashes: true,
            semanticSceneBreakPreserved: true,
            structurePreserved: true,
          },
          snapshots: {
            kinds: kindCounts,
            diff: diff.summary,
            originalTextRestored: true,
            originalOrderRestored: true,
          },
          processRestartRoundTrip: true,
          finalRevision: revision,
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
      : (error?.stack?.match(/test-phase1b-workspace\.mjs:(\d+):(\d+)/)?.[0] ??
        "unknown-location");
  process.stderr.write(`phase1b-workspace: ${code} ${location}\n`);
  process.exitCode = 1;
}
