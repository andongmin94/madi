import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
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
const savedBy = "madi-phase1c-story-bible";

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
  constructor(processLabel) {
    this.processLabel = processLabel;
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
    this.child.once("error", () => this.rejectPending("core-process-error"));
    this.child.stdin.on("error", () => this.rejectPending("core-stdin-error"));
    this.child.stdout.on("data", (chunk) => this.acceptOutput(chunk));
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
    const id = `${this.processLabel}-${++this.nextId}`;
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
            () => rejectShutdown(new VerificationError("core-shutdown-timeout")),
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

function buildTypieDocument(host, before, after) {
  const editor = createEmptyEditor(host);
  try {
    insertText(editor, before);
    if (after !== undefined) {
      insertSceneBreak(editor);
      moveToDocumentEnd(editor);
      insertText(editor, after);
    }
    const plainText = editor.prose_text_annotated();
    const snapshot = extractSnapshot(editor);
    const semanticSceneBreaks = countSemanticSceneBreakNodes(editor);
    const restored = restoreEditor(host, snapshot);
    try {
      verify(
        restored.prose_text_annotated() === plainText,
        "typie-fixture-text-roundtrip",
      );
      verify(
        countSemanticSceneBreakNodes(restored) === semanticSceneBreaks,
        "typie-fixture-scene-break-roundtrip",
      );
    } finally {
      restored.free();
    }
    return { plainText, semanticSceneBreaks, snapshot };
  } finally {
    editor.free();
  }
}

function relationInventory(relations) {
  return relations
    .map((relation) => ({
      id: relation.id,
      note: relation.note,
      relationTypeId: relation.relation_type_id,
      sourceEntityId: relation.source_entity_id,
      targetEntityId: relation.target_entity_id,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function linkInventory(links) {
  return links
    .map((link) => ({
      entityId: link.entity_id,
      note: link.note,
      role: link.role,
      sceneNodeId: link.scene_node_id,
    }))
    .sort((left, right) =>
      `${left.sceneNodeId}:${left.entityId}:${left.role}`.localeCompare(
        `${right.sceneNodeId}:${right.entityId}:${right.role}`,
      ),
    );
}

async function run() {
  verify(existsSync(coreBinary), "core-binary-missing");
  const workspace = await mkdtemp(join(tmpdir(), "madi-phase1c-story-bible-"));
  const projectPath = join(workspace, "북부의봉인.madi");
  const projectId = "project-phase1c-story-bible";
  const defaultDocumentId = "document-prologue";
  let firstProcess;
  let secondProcess;
  let host;

  try {
    host = await createTypieHost();
    firstProcess = new SidecarClient("phase1c-first");
    const created = await firstProcess.request("create_project", {
      file_path: projectPath,
      title: "북부의 봉인",
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
    verify(created.project.metadata.schema_version === 4, "schema-version-four");
    const workId = created.work_node_id;
    const defaultSceneId = created.default_scene_node_id;
    let revision = 0;

    const mutate = async (method, params, code) => {
      const expectedRevision = revision;
      const result = await firstProcess.request(method, {
        ...params,
        expected_revision: expectedRevision,
        saved_by: savedBy,
      });
      verify(
        result.metadata?.revision === expectedRevision + 1,
        `${code}-revision`,
      );
      revision = result.metadata.revision;
      return result;
    };

    const nodeDefinitions = [
      ["volume-north", workId, "VOLUME", "제1권 북부의 봉인"],
      ["volume-south", workId, "VOLUME", "제2권 유리 항구"],
      ["chapter-north-1", "volume-north", "CHAPTER", "제1화 붉은 열쇠"],
      ["chapter-north-2", "volume-north", "CHAPTER", "제2화 깨진 종"],
      ["chapter-south-1", "volume-south", "CHAPTER", "제3화 항구의 반란"],
      ["chapter-south-2", "volume-south", "CHAPTER", "제4화 세 번째 불씨"],
      ["scene-north-1-1", "chapter-north-1", "SCENE", "마법사의 귀환"],
      ["scene-north-1-2", "chapter-north-1", "SCENE", "나무의 이름"],
      ["scene-north-1-3", "chapter-north-1", "SCENE", "봉인의 문"],
      ["scene-north-2-1", "chapter-north-2", "SCENE", "깨진 종"],
      ["scene-north-2-2", "chapter-north-2", "SCENE", "검은 나침반"],
      ["scene-south-1-1", "chapter-south-1", "SCENE", "유리 항구"],
      ["scene-south-1-2", "chapter-south-1", "SCENE", "왕실 조사국"],
      ["scene-south-2-1", "chapter-south-2", "SCENE", "달빛 서약"],
      ["scene-south-2-2", "chapter-south-2", "SCENE", "마지막 신호"],
    ];
    for (const [nodeId, parentId, kind, title] of nodeDefinitions) {
      await mutate(
        "create_tree_node",
        {
          file_path: projectPath,
          node_id: nodeId,
          parent_id: parentId,
          kind,
          title,
          ...(kind === "SCENE"
            ? {
                document_id: `document-${nodeId}`,
                editor_engine: "typie",
                editor_engine_commit: TYPIE_COMMIT,
                editor_schema_version: 1,
              }
            : {}),
        },
        `create-node-${nodeId}`,
      );
    }

    const sceneDefinitions = [
      {
        sceneId: defaultSceneId,
        documentId: defaultDocumentId,
        before: "레이아는 북부 성채의 봉인 아래에서 붉은 열쇠를 발견했다.",
      },
      {
        sceneId: "scene-north-1-1",
        before: "북부의 마법사는 붉은 열쇠를 들어 오래된 문양을 비추었다.",
        after: "봉인의 문 너머에서 세 번째 불씨가 푸르게 타올랐다.",
      },
      {
        sceneId: "scene-north-1-2",
        before: "정원사는 레이아나무의 잎이 유난히 붉다고 기록했다.",
      },
      {
        sceneId: "scene-north-1-3",
        before: "세리나는 봉인의 문 앞에서 레이아의 귀환을 기다렸다.",
      },
      {
        sceneId: "scene-north-2-1",
        before: "도윤은 깨진 종의 예언을 북부 마법사단에 전달했다.",
      },
      {
        sceneId: "scene-north-2-2",
        before: "미라는 검은 나침반이 유리 항구를 가리키는 것을 보았다.",
      },
      {
        sceneId: "scene-south-1-1",
        before: "카엘은 유리 항구 반란의 원인을 왕실 조사국에 보고했다.",
      },
      {
        sceneId: "scene-south-1-2",
        before: "왕실 조사국은 첫 번째 봉인의 기록을 비밀 서고로 옮겼다.",
      },
      {
        sceneId: "scene-south-2-1",
        before: "달빛 서약과 마력 보존 법칙은 같은 밤에 선포되었다.",
      },
      {
        sceneId: "scene-south-2-2",
        before: "북부력 마지막 날, 세 번째 불씨가 깨진 종 아래에서 꺼졌다.",
      },
    ];
    const sceneFixtures = sceneDefinitions.map((definition) => ({
      ...definition,
      documentId:
        definition.documentId ?? `document-${definition.sceneId}`,
      ...buildTypieDocument(host, definition.before, definition.after),
    }));
    verify(sceneFixtures.length === 10, "scene-fixture-count");
    verify(
      sceneFixtures.reduce(
        (total, fixture) => total + fixture.semanticSceneBreaks,
        0,
      ) === 1,
      "scene-break-count",
    );
    for (const fixture of sceneFixtures) {
      await mutate(
        "save_scene",
        {
          file_path: projectPath,
          scene_id: fixture.sceneId,
          editor_engine: "typie",
          editor_engine_commit: TYPIE_COMMIT,
          editor_schema_version: 1,
          snapshot_base64: Buffer.from(fixture.snapshot).toString("base64"),
          plain_text_recovery: fixture.plainText,
        },
        `save-scene-${fixture.sceneId}`,
      );
    }

    const tree = await firstProcess.request("load_project_tree", {
      file_path: projectPath,
    });
    const hierarchy = {
      works: tree.nodes.filter((node) => node.kind === "WORK").length,
      volumes: tree.nodes.filter((node) => node.kind === "VOLUME").length,
      chapters: tree.nodes.filter((node) => node.kind === "CHAPTER").length,
      scenes: tree.nodes.filter((node) => node.kind === "SCENE").length,
    };
    verify(equalJson(hierarchy, { works: 1, volumes: 2, chapters: 5, scenes: 10 }), "hierarchy-counts");

    const entityDefinitions = [
      ["entity-leia", "CHARACTER", "레이아", "북부의 마법사"],
      ["entity-serina", "CHARACTER", "세리나", "유리칼의 주인"],
      ["entity-doyun", "CHARACTER", "도윤", "기록관"],
      ["entity-mira", "CHARACTER", "미라", "항해사"],
      ["entity-kael", "CHARACTER", "카엘", "조사관"],
      ["entity-north-castle", "LOCATION", "북부 성채", "봉인의 거점"],
      ["entity-sealed-door", "LOCATION", "봉인의 문", "고대의 문"],
      ["entity-glass-port", "LOCATION", "유리 항구", "남부의 항구"],
      ["entity-mage-order", "ORGANIZATION", "북부 마법사단", "북부 수호 조직"],
      ["entity-royal-office", "ORGANIZATION", "왕실 조사국", "왕실 직속 기관"],
      ["entity-red-key", "ITEM", "붉은 열쇠", "봉인을 여는 열쇠"],
      ["entity-black-compass", "ITEM", "검은 나침반", "불씨를 찾는 도구"],
      ["entity-first-seal", "EVENT", "첫 번째 봉인", "백 년 전 사건"],
      ["entity-port-revolt", "EVENT", "유리 항구 반란", "남부의 반란"],
      ["entity-magic-law", "WORLD_RULE", "마력 보존 법칙", "마력은 소멸하지 않는다"],
      ["entity-moon-vow", "WORLD_RULE", "달빛 서약", "달이 뜰 때만 효력이 있다"],
      ["entity-broken-bell", "FORESHADOWING", "깨진 종의 예언", "세 번째 종소리"],
      ["entity-third-ember", "FORESHADOWING", "세 번째 불씨", "마지막 봉인의 신호"],
      ["entity-calendar", "OTHER", "북부력", "북부 지방의 달력"],
    ];
    const entities = new Map();
    for (const [entityId, kind, name, summary] of entityDefinitions) {
      const result = await mutate(
        "create_entity",
        {
          file_path: projectPath,
          entity_id: entityId,
          document_id: `document-${entityId}`,
          kind,
          name,
          summary,
          status: "ACTIVE",
          color_token: null,
          icon_key: null,
          attributes: {},
          editor_engine: "typie",
          editor_engine_commit: TYPIE_COMMIT,
          editor_schema_version: 1,
        },
        `create-entity-${entityId}`,
      );
      entities.set(entityId, result.entity);
    }
    verify(entities.size === 19, "entity-total");
    const kindCounts = Object.fromEntries(
      [
        "CHARACTER",
        "LOCATION",
        "ORGANIZATION",
        "ITEM",
        "EVENT",
        "WORLD_RULE",
        "FORESHADOWING",
        "OTHER",
      ].map((kind) => [
        kind,
        [...entities.values()].filter((entity) => entity.kind === kind).length,
      ]),
    );
    verify(kindCounts.CHARACTER >= 5, "entity-character-minimum");
    verify(kindCounts.LOCATION >= 3, "entity-location-minimum");
    verify(kindCounts.ORGANIZATION >= 2, "entity-organization-minimum");
    verify(kindCounts.ITEM >= 2, "entity-item-minimum");
    verify(kindCounts.EVENT >= 2, "entity-event-minimum");
    verify(kindCounts.WORLD_RULE >= 2, "entity-world-rule-minimum");
    verify(kindCounts.FORESHADOWING >= 2, "entity-foreshadowing-minimum");

    const aliasDefinitions = [
      ["alias-leia-mage", "entity-leia", "북부의 마법사"],
      ["alias-leia-short", "entity-leia", "레아"],
      ["alias-serina-blade", "entity-serina", "유리칼"],
      ["alias-order-short", "entity-mage-order", "마법사단"],
    ];
    for (const [aliasId, entityId, alias] of aliasDefinitions) {
      await mutate(
        "create_entity_alias",
        {
          file_path: projectPath,
          alias_id: aliasId,
          entity_id: entityId,
          alias,
        },
        `create-alias-${aliasId}`,
      );
    }

    const tagDefinitions = [
      ["tag-north", "북부", "blue"],
      ["tag-magic", "마법", "violet"],
      ["tag-royal", "왕실", "gold"],
      ["tag-secret", "비밀", "gray"],
      ["tag-foreshadow", "복선", "red"],
    ];
    for (const [tagId, name, colorToken] of tagDefinitions) {
      await mutate(
        "create_tag",
        {
          file_path: projectPath,
          tag_id: tagId,
          name,
          color_token: colorToken,
        },
        `create-tag-${tagId}`,
      );
    }
    await mutate(
      "set_entity_tags",
      {
        file_path: projectPath,
        entity_id: "entity-leia",
        tag_ids: ["tag-north", "tag-magic"],
      },
      "set-leia-tags",
    );
    await mutate(
      "set_entity_tags",
      {
        file_path: projectPath,
        entity_id: "entity-third-ember",
        tag_ids: ["tag-secret", "tag-foreshadow"],
      },
      "set-foreshadow-tags",
    );

    const relationTypes = await firstProcess.request("list_relation_types", {
      file_path: projectPath,
    });
    verify(relationTypes.relation_types.length >= 10, "builtin-relation-types");
    const relationTypeByName = new Map(
      relationTypes.relation_types.map((type) => [type.name, type.id]),
    );
    for (const name of [
      "관련됨",
      "동맹",
      "적대",
      "소속",
      "위치함",
      "소유함",
      "원인",
      "암시함",
      "회수함",
    ]) {
      verify(relationTypeByName.has(name), `builtin-relation-${name}`);
    }
    const customType = await mutate(
      "create_relation_type",
      {
        file_path: projectPath,
        relation_type_id: "relation-type-mentor",
        name: "스승",
        inverse_name: "제자",
        directed: true,
        color_token: "violet",
      },
      "create-custom-relation-type",
    );
    verify(customType.relation_type.is_builtin === false, "custom-type-flag");

    const relationDefinitions = [
      ["relation-01", "entity-leia", "소속", "entity-mage-order", "단원"],
      ["relation-02", "entity-leia", "소유함", "entity-red-key", "휴대 중"],
      ["relation-03", "entity-leia", "적대", "entity-serina", null],
      ["relation-04", "entity-red-key", "암시함", "entity-sealed-door", null],
      ["relation-05", "entity-port-revolt", "회수함", "entity-broken-bell", null],
      ["relation-06", "entity-doyun", "소속", "entity-mage-order", null],
      ["relation-07", "entity-mira", "소속", "entity-royal-office", null],
      ["relation-08", "entity-kael", "동맹", "entity-doyun", null],
      ["relation-09", "entity-serina", "소유함", "entity-black-compass", null],
      ["relation-10", "entity-mage-order", "위치함", "entity-north-castle", null],
      ["relation-11", "entity-royal-office", "위치함", "entity-glass-port", null],
      ["relation-12", "entity-first-seal", "원인", "entity-port-revolt", null],
      ["relation-13", "entity-magic-law", "관련됨", "entity-moon-vow", null],
      ["relation-14", "entity-third-ember", "암시함", "entity-port-revolt", null],
      ["relation-15", "entity-north-castle", "관련됨", "entity-glass-port", null],
      ["relation-16", "entity-leia", "스승", "entity-doyun", "기초 마법"],
    ];
    for (const [relationId, sourceEntityId, typeName, targetEntityId, note] of
      relationDefinitions) {
      const relationTypeId =
        typeName === "스승"
          ? "relation-type-mentor"
          : relationTypeByName.get(typeName);
      verify(relationTypeId !== undefined, `relation-type-${relationId}`);
      await mutate(
        "create_entity_relation",
        {
          file_path: projectPath,
          relation_id: relationId,
          source_entity_id: sourceEntityId,
          relation_type_id: relationTypeId,
          target_entity_id: targetEntityId,
          note,
        },
        `create-relation-${relationId}`,
      );
    }
    const initialRelations = await firstProcess.request(
      "list_entity_relations",
      { file_path: projectPath },
    );
    verify(initialRelations.relations.length === 16, "relation-total");
    const hostility = initialRelations.relations.find(
      (relation) => relation.id === "relation-03",
    );
    verify(hostility !== undefined, "undirected-relation-created");
    const serinaRelations = await firstProcess.request(
      "list_entity_relations",
      { file_path: projectPath, entity_id: "entity-serina" },
    );
    verify(
      serinaRelations.relations.some((relation) => relation.id === "relation-03"),
      "undirected-inverse-visible",
    );

    const linkDefinitions = [
      [defaultSceneId, "entity-leia", "POV", null],
      [defaultSceneId, "entity-serina", "APPEARS", null],
      ["scene-north-1-1", "entity-red-key", "RELATED", "봉인의 열쇠"],
      ["scene-north-2-1", "entity-broken-bell", "MENTIONED", null],
    ];
    for (const [sceneNodeId, entityId, role, note] of linkDefinitions) {
      await mutate(
        "create_scene_entity_link",
        {
          file_path: projectPath,
          scene_node_id: sceneNodeId,
          entity_id: entityId,
          role,
          note,
        },
        `create-link-${sceneNodeId}-${entityId}-${role}`,
      );
    }
    const initialLinks = await firstProcess.request("list_scene_entity_links", {
      file_path: projectPath,
    });
    verify(initialLinks.links.length === 4, "initial-link-total");
    for (const role of ["POV", "APPEARS", "RELATED", "MENTIONED"]) {
      verify(
        initialLinks.links.some((link) => link.role === role),
        `link-role-${role}`,
      );
    }

    const initialWorldGraph = await firstProcess.request("get_world_graph", {
      file_path: projectPath,
    });
    verify(initialWorldGraph.project_id === projectId, "graph-project-id");
    verify(initialWorldGraph.nodes.length === 19, "graph-node-total");
    verify(initialWorldGraph.edges.length === 16, "graph-edge-total");
    verify(
      initialWorldGraph.stats.entity_count === 19 &&
        initialWorldGraph.stats.relation_count === 16,
      "graph-stats-totals",
    );
    const graphLeia = initialWorldGraph.nodes.find(
      (node) => node.id === "entity-leia",
    );
    verify(
      graphLeia?.aliases.length === 2 &&
        graphLeia.tags.length === 2 &&
        graphLeia.explicit_scene_link_count === 1,
      "graph-node-metadata",
    );
    const directedGraphEdge = initialWorldGraph.edges.find(
      (edge) => edge.id === "relation-01",
    );
    verify(
      directedGraphEdge?.directed === true &&
        directedGraphEdge.source_entity_id === "entity-leia" &&
        directedGraphEdge.target_entity_id === "entity-mage-order" &&
        directedGraphEdge.forward_label.length > 0 &&
        directedGraphEdge.inverse_label?.length > 0,
      "graph-directed-edge",
    );
    const undirectedGraphEdges = initialWorldGraph.edges.filter(
      (edge) => edge.id === "relation-03",
    );
    verify(
      undirectedGraphEdges.length === 1 &&
        undirectedGraphEdges[0].directed === false,
      "graph-undirected-single-edge",
    );
    const graphStats = await firstProcess.request("get_world_graph_stats", {
      file_path: projectPath,
    });
    verify(
      equalJson(graphStats.stats, initialWorldGraph.stats),
      "graph-stats-command",
    );
    const mageOrderGraphDetail = await firstProcess.request(
      "get_entity_graph_detail",
      { file_path: projectPath, entity_id: "entity-mage-order" },
    );
    const inverseMembership = mageOrderGraphDetail.incoming_relations.find(
      (relation) => relation.edge.id === "relation-01",
    );
    verify(
      inverseMembership?.display_label === directedGraphEdge.inverse_label &&
        inverseMembership.perspective === "INCOMING",
      "graph-inverse-detail-label",
    );
    const leiaSceneContext = await firstProcess.request(
      "get_entity_scene_context",
      { file_path: projectPath, entity_id: "entity-leia" },
    );
    verify(
      leiaSceneContext.links.some(
        (link) => link.scene_node_id === defaultSceneId && link.role === "POV",
      ),
      "graph-scene-context",
    );

    const linksBeforeDiscovery = linkInventory(initialLinks.links);
    const mentions = await firstProcess.request("discover_entity_mentions", {
      file_path: projectPath,
      entity_id: "entity-leia",
      offset: 0,
      limit: 100,
    });
    verify(mentions.total_scenes >= 4, "mention-scene-total");
    verify(
      mentions.candidates.some(
        (candidate) =>
          candidate.scene_node_id === "scene-north-1-1" &&
          candidate.matched_alias === "북부의 마법사",
      ),
      "mention-alias-candidate",
    );
    verify(
      mentions.candidates.some(
        (candidate) => candidate.scene_node_id === "scene-north-1-2",
      ),
      "mention-false-positive-candidate",
    );
    const linksAfterDiscovery = await firstProcess.request(
      "list_scene_entity_links",
      { file_path: projectPath },
    );
    verify(
      equalJson(linkInventory(linksAfterDiscovery.links), linksBeforeDiscovery),
      "mention-discovery-created-canonical-link",
    );
    await mutate(
      "promote_entity_mention",
      {
        file_path: projectPath,
        entity_id: "entity-leia",
        scene_node_id: "scene-north-1-1",
        role: "MENTIONED",
        note: "별칭 후보에서 명시적 연결로 승격",
      },
      "promote-mention",
    );
    const linksAfterPromotion = await firstProcess.request(
      "list_scene_entity_links",
      { file_path: projectPath },
    );
    verify(linksAfterPromotion.links.length === 5, "promoted-link-total");
    verify(
      !linksAfterPromotion.links.some(
        (link) =>
          link.scene_node_id === "scene-north-1-2" &&
          link.entity_id === "entity-leia",
      ),
      "false-positive-became-canonical",
    );

    const originalNote = buildTypieDocument(
      host,
      "레이아는 북부 마법사단의 봉인술을 익혔다. 붉은 열쇠의 주인이다.",
    );
    await mutate(
      "save_entity_note",
      {
        file_path: projectPath,
        owner_kind: "ENTITY",
        owner_id: "entity-leia",
        document_id: "document-entity-leia",
        generation: 1,
        save_sequence: 1,
        editor_engine: "typie",
        editor_engine_commit: TYPIE_COMMIT,
        editor_schema_version: 1,
        snapshot_base64: Buffer.from(originalNote.snapshot).toString("base64"),
        plain_text_recovery: originalNote.plainText,
      },
      "save-original-entity-note",
    );
    const loadedOriginalNote = await firstProcess.request("load_entity_note", {
      file_path: projectPath,
      owner_kind: "ENTITY",
      owner_id: "entity-leia",
    });
    verify(
      loadedOriginalNote.document.plain_text_recovery === originalNote.plainText,
      "entity-note-original-text",
    );
    verify(
      Buffer.from(loadedOriginalNote.document.snapshot_base64, "base64").equals(
        Buffer.from(originalNote.snapshot),
      ),
      "entity-note-original-snapshot",
    );
    const entitySearchChecks = [
      ["레이아", "NAME"],
      ["레아", "ALIAS"],
      ["북부", "TAG"],
      ["봉인술", "NOTE"],
    ];
    for (const [searchQuery, expectedField] of entitySearchChecks) {
      const search = await firstProcess.request("search_entities", {
        file_path: projectPath,
        query: searchQuery,
        offset: 0,
        limit: 100,
      });
      const leiaHit = search.hits.find(
        (hit) => hit.entity.id === "entity-leia",
      );
      verify(leiaHit !== undefined, `entity-search-${expectedField}-hit`);
      verify(
        leiaHit.matched_fields.includes(expectedField),
        `entity-search-${expectedField}-field`,
      );
    }
    const deleteImpact = await firstProcess.request(
      "get_entity_delete_impact",
      {
        file_path: projectPath,
        entity_id: "entity-leia",
      },
    );
    verify(deleteImpact.impact.relation_count === 4, "delete-impact-relations");
    verify(deleteImpact.impact.scene_link_count === 2, "delete-impact-links");
    verify(deleteImpact.impact.mention_scene_count >= 4, "delete-impact-mentions");
    verify(deleteImpact.impact.alias_count === 2, "delete-impact-aliases");
    verify(deleteImpact.impact.tag_count === 2, "delete-impact-tags");
    verify(
      deleteImpact.impact.note_character_count > 0,
      "delete-impact-note-characters",
    );

    const snapshotDeletedTagId = "tag-snapshot-delete";
    const snapshotDeletedRelationTypeId = "relation-type-snapshot-delete";
    await mutate(
      "create_tag",
      {
        file_path: projectPath,
        tag_id: snapshotDeletedTagId,
        name: "snapshot 삭제 후보 태그",
        color_token: "slate",
      },
      "create-snapshot-delete-tag",
    );
    await mutate(
      "create_relation_type",
      {
        file_path: projectPath,
        relation_type_id: snapshotDeletedRelationTypeId,
        name: "snapshot 삭제 후보 관계",
        inverse_name: null,
        directed: false,
        color_token: "slate",
      },
      "create-snapshot-delete-relation-type",
    );
    const baselineTagInventory = await firstProcess.request("list_tags", {
      file_path: projectPath,
    });
    const baselineRelationTypeInventory = await firstProcess.request(
      "list_relation_types",
      { file_path: projectPath },
    );

    const graphUiStateBeforeSnapshot = {
      mode: "FULL",
      focused_entity_id: null,
      depth: 1,
      filters: {
        kinds: ["CHARACTER", "LOCATION"],
        statuses: ["ACTIVE", "DRAFT"],
        tag_ids: ["tag-north"],
        tag_mode: "ANY",
        relation_type_ids: [],
        relation_direction: "ALL",
        show_isolated: true,
        show_labels: true,
      },
      layout: "cose",
      viewport: { zoom: 1, pan: { x: 0, y: 0 } },
      node_positions: { "entity-leia": { x: 12, y: 24 } },
      selected_entity_id: "entity-leia",
    };
    const graphUiSaveBeforeSnapshot = await firstProcess.request(
      "save_ui_state",
      {
        file_path: projectPath,
        key: "world-graph.v1",
        value: graphUiStateBeforeSnapshot,
      },
    );
    verify(
      graphUiSaveBeforeSnapshot.metadata.revision === revision,
      "graph-ui-save-changed-revision",
    );

    const baselineSnapshot = await mutate(
      "create_named_snapshot",
      {
        file_path: projectPath,
        name: "Phase 1C 설정 기준",
        note: "설정·관계·장면 연결·Typie 노트 복원 기준",
        kind: "MANUAL",
      },
      "create-phase1c-snapshot",
    );
    verify(
      baselineSnapshot.snapshot.payload_version === 2,
      "snapshot-payload-version-two",
    );

    const baselineRelationInventory = relationInventory(initialRelations.relations);
    const baselineLinkInventory = linkInventory(linksAfterPromotion.links);
    const leia = entities.get("entity-leia");
    await mutate(
      "update_entity",
      {
        file_path: projectPath,
        entity_id: "entity-leia",
        kind: leia.kind,
        name: "레이아 아렌",
        summary: "임시로 변경된 요약",
        status: leia.status,
        color_token: "violet",
        icon_key: "person",
        attributes: { phase: "mutated" },
      },
      "mutate-entity",
    );
    await mutate(
      "update_entity_relation",
      {
        file_path: projectPath,
        relation_id: "relation-01",
        relation_type_id: relationTypeByName.get("소속"),
        target_entity_id: "entity-mage-order",
        note: "임시 관계 메모",
      },
      "mutate-relation",
    );
    await mutate(
      "create_scene_entity_link",
      {
        file_path: projectPath,
        scene_node_id: "scene-north-1-2",
        entity_id: "entity-leia",
        role: "RELATED",
        note: "복원으로 제거될 false-positive link",
      },
      "mutate-scene-link",
    );
    const changedNote = buildTypieDocument(
      host,
      "이 노트는 snapshot diff와 복원 검증을 위해 잠시 변경되었다.",
    );
    await mutate(
      "save_entity_note",
      {
        file_path: projectPath,
        owner_kind: "ENTITY",
        owner_id: "entity-leia",
        document_id: "document-entity-leia",
        generation: 2,
        save_sequence: 2,
        editor_engine: "typie",
        editor_engine_commit: TYPIE_COMMIT,
        editor_schema_version: 1,
        snapshot_base64: Buffer.from(changedNote.snapshot).toString("base64"),
        plain_text_recovery: changedNote.plainText,
      },
      "mutate-entity-note",
    );
    await mutate(
      "create_tag",
      {
        file_path: projectPath,
        tag_id: "tag-snapshot-added",
        name: "snapshot 추가 태그",
        color_token: "amber",
      },
      "mutate-add-tag",
    );
    await mutate(
      "update_tag",
      {
        file_path: projectPath,
        tag_id: "tag-north",
        name: "북부 변경",
        color_token: "cyan",
      },
      "mutate-change-tag",
    );
    await mutate(
      "delete_tag",
      {
        file_path: projectPath,
        tag_id: snapshotDeletedTagId,
      },
      "mutate-delete-tag",
    );
    await mutate(
      "create_relation_type",
      {
        file_path: projectPath,
        relation_type_id: "relation-type-snapshot-added",
        name: "snapshot 추가 관계",
        inverse_name: "snapshot 추가 역관계",
        directed: true,
        color_token: "amber",
      },
      "mutate-add-relation-type",
    );
    await mutate(
      "update_relation_type",
      {
        file_path: projectPath,
        relation_type_id: "relation-type-mentor",
        name: "스승 변경",
        inverse_name: "제자 변경",
        directed: true,
        color_token: "cyan",
      },
      "mutate-change-relation-type",
    );
    await mutate(
      "delete_relation_type",
      {
        file_path: projectPath,
        relation_type_id: snapshotDeletedRelationTypeId,
      },
      "mutate-delete-relation-type",
    );

    const graphUiStateAfterSnapshot = {
      ...graphUiStateBeforeSnapshot,
      mode: "FOCUSED",
      focused_entity_id: "entity-third-ember",
      depth: 3,
      viewport: { zoom: 1.5, pan: { x: 91, y: -17 } },
      node_positions: {
        "entity-leia": { x: 40, y: 80 },
        "entity-third-ember": { x: 140, y: 160 },
      },
      selected_entity_id: "entity-third-ember",
    };
    await firstProcess.request("save_ui_state", {
      file_path: projectPath,
      key: "world-graph.v1",
      value: graphUiStateAfterSnapshot,
    });

    const diff = await firstProcess.request("diff_named_snapshot", {
      file_path: projectPath,
      snapshot_id: baselineSnapshot.snapshot.id,
    });
    verify(diff.snapshot.payload_version === 2, "diff-payload-version");
    verify(diff.summary.changed_entities >= 1, "diff-changed-entities");
    verify(diff.summary.changed_relations >= 1, "diff-changed-relations");
    verify(diff.summary.changed_scene_links >= 1, "diff-changed-scene-links");
    verify(diff.summary.changed_entity_notes >= 1, "diff-changed-entity-notes");
    verify(diff.summary.added_entities === 0, "diff-added-entities");
    verify(diff.summary.deleted_entities === 0, "diff-deleted-entities");
    verify(diff.summary.added_tags === 1, "diff-added-tags");
    verify(diff.summary.deleted_tags === 1, "diff-deleted-tags");
    verify(diff.summary.changed_tags === 1, "diff-changed-tags");
    verify(
      diff.summary.added_relation_types === 1,
      "diff-added-relation-types",
    );
    verify(
      diff.summary.deleted_relation_types === 1,
      "diff-deleted-relation-types",
    );
    verify(
      diff.summary.changed_relation_types === 1,
      "diff-changed-relation-types",
    );

    const restored = await mutate(
      "restore_named_snapshot",
      {
        file_path: projectPath,
        snapshot_id: baselineSnapshot.snapshot.id,
        auto_snapshot_name: "Phase 1C 설정 복원 전 안전 저장",
      },
      "restore-phase1c-snapshot",
    );
    verify(
      restored.restored_snapshot.id === baselineSnapshot.snapshot.id,
      "restore-target",
    );
    verify(
      restored.safety_snapshot.kind === "AUTO_BEFORE_RESTORE" &&
        restored.safety_snapshot.payload_version === 2,
      "restore-safety-snapshot-v2",
    );
    verify(
      equalJson(restored.changes_before_restore, diff.summary),
      "restore-diff-summary",
    );
    const graphUiAfterRestore = await firstProcess.request("load_ui_state", {
      file_path: projectPath,
      key: "world-graph.v1",
    });
    verify(
      equalJson(graphUiAfterRestore.state?.value, graphUiStateAfterSnapshot),
      "graph-ui-state-was-preserved-across-named-snapshot-restore",
    );

    const restoredEntities = await firstProcess.request("list_entities", {
      file_path: projectPath,
      sort: "NAME_ASC",
    });
    const restoredLeia = restoredEntities.entities.find(
      (entity) => entity.id === "entity-leia",
    );
    verify(restoredEntities.entities.length === 19, "restored-entity-total");
    verify(restoredLeia?.name === "레이아", "restored-entity-name");
    verify(restoredLeia?.summary === "북부의 마법사", "restored-entity-summary");
    verify(equalJson(restoredLeia?.attributes, {}), "restored-entity-attributes");
    const restoredRelations = await firstProcess.request(
      "list_entity_relations",
      { file_path: projectPath },
    );
    verify(
      equalJson(
        relationInventory(restoredRelations.relations),
        baselineRelationInventory,
      ),
      "restored-relations",
    );
    const restoredLinks = await firstProcess.request("list_scene_entity_links", {
      file_path: projectPath,
    });
    verify(
      equalJson(linkInventory(restoredLinks.links), baselineLinkInventory),
      "restored-scene-links",
    );
    const restoredNote = await firstProcess.request("load_entity_note", {
      file_path: projectPath,
      owner_kind: "ENTITY",
      owner_id: "entity-leia",
    });
    verify(
      restoredNote.document.plain_text_recovery === originalNote.plainText,
      "restored-entity-note-text",
    );
    verify(
      Buffer.from(restoredNote.document.snapshot_base64, "base64").equals(
        Buffer.from(originalNote.snapshot),
      ),
      "restored-entity-note-snapshot",
    );
    const restoredTagInventory = await firstProcess.request("list_tags", {
      file_path: projectPath,
    });
    const restoredRelationTypeInventory = await firstProcess.request(
      "list_relation_types",
      { file_path: projectPath },
    );
    verify(
      equalJson(restoredTagInventory.tags, baselineTagInventory.tags),
      "restored-tag-inventory",
    );
    verify(
      equalJson(
        restoredRelationTypeInventory.relation_types,
        baselineRelationTypeInventory.relation_types,
      ),
      "restored-relation-type-inventory",
    );
    await mutate(
      "delete_tag",
      {
        file_path: projectPath,
        tag_id: snapshotDeletedTagId,
      },
      "cleanup-snapshot-delete-tag",
    );
    await mutate(
      "delete_relation_type",
      {
        file_path: projectPath,
        relation_type_id: snapshotDeletedRelationTypeId,
      },
      "cleanup-snapshot-delete-relation-type",
    );

    const snapshotsBeforeRestart = await firstProcess.request(
      "list_named_snapshots",
      { file_path: projectPath },
    );
    verify(
      snapshotsBeforeRestart.snapshots.every(
        (snapshot) => snapshot.payload_version === 2,
      ),
      "snapshot-inventory-v2",
    );
    const finalWorldGraph = await firstProcess.request("get_world_graph", {
      file_path: projectPath,
    });
    verify(
      finalWorldGraph.nodes.length === 19 &&
        finalWorldGraph.edges.length === 16 &&
        finalWorldGraph.revision === revision,
      "final-world-graph",
    );
    await firstProcess.close();
    firstProcess = undefined;

    secondProcess = new SidecarClient("phase1c-second");
    const reopened = await secondProcess.request("open_project", {
      file_path: projectPath,
    });
    verify(reopened.metadata.revision === revision, "restart-revision");
    verify(reopened.metadata.schema_version === 4, "restart-schema-version");
    const restartEntities = await secondProcess.request("list_entities", {
      file_path: projectPath,
      sort: "NAME_ASC",
    });
    verify(restartEntities.entities.length === 19, "restart-entity-total");
    verify(
      restartEntities.entities.some(
        (entity) => entity.id === "entity-leia" && entity.name === "레이아",
      ),
      "restart-entity-data",
    );
    const restartAliases = await secondProcess.request("list_entity_aliases", {
      file_path: projectPath,
      entity_id: "entity-leia",
    });
    verify(restartAliases.aliases.length === 2, "restart-aliases");
    const restartTags = await secondProcess.request("list_entity_tags", {
      file_path: projectPath,
      entity_id: "entity-leia",
    });
    verify(
      equalJson(
        restartTags.tags.map((tag) => tag.id).sort(),
        ["tag-magic", "tag-north"],
      ),
      "restart-tags",
    );
    const restartTagInventory = await secondProcess.request("list_tags", {
      file_path: projectPath,
    });
    verify(
      restartTagInventory.tags.length === tagDefinitions.length &&
        !restartTagInventory.tags.some(
          (tag) => tag.id === snapshotDeletedTagId,
        ),
      "restart-clean-tag-inventory",
    );
    const restartRelationTypeInventory = await secondProcess.request(
      "list_relation_types",
      { file_path: projectPath },
    );
    verify(
      restartRelationTypeInventory.relation_types.length ===
        relationTypes.relation_types.length + 1 &&
        !restartRelationTypeInventory.relation_types.some(
          (type) => type.id === snapshotDeletedRelationTypeId,
        ),
      "restart-clean-relation-type-inventory",
    );
    const restartRelations = await secondProcess.request(
      "list_entity_relations",
      { file_path: projectPath },
    );
    const restartLinks = await secondProcess.request("list_scene_entity_links", {
      file_path: projectPath,
    });
    verify(
      equalJson(
        relationInventory(restartRelations.relations),
        baselineRelationInventory,
      ),
      "restart-relations",
    );
    verify(
      equalJson(linkInventory(restartLinks.links), baselineLinkInventory),
      "restart-links",
    );
    const restartNote = await secondProcess.request("load_entity_note", {
      file_path: projectPath,
      owner_kind: "ENTITY",
      owner_id: "entity-leia",
    });
    verify(
      restartNote.document.plain_text_recovery === originalNote.plainText,
      "restart-entity-note",
    );
    const restartMentions = await secondProcess.request(
      "discover_entity_mentions",
      {
        file_path: projectPath,
        entity_id: "entity-leia",
        offset: 0,
        limit: 100,
      },
    );
    verify(
      restartMentions.candidates.some(
        (candidate) => candidate.scene_node_id === "scene-north-1-2",
      ),
      "restart-false-positive-candidate",
    );
    const restartSnapshots = await secondProcess.request(
      "list_named_snapshots",
      { file_path: projectPath },
    );
    verify(
      restartSnapshots.snapshots.length === snapshotsBeforeRestart.snapshots.length,
      "restart-snapshot-total",
    );
    const restartWorldGraph = await secondProcess.request("get_world_graph", {
      file_path: projectPath,
    });
    verify(
      equalJson(restartWorldGraph, finalWorldGraph),
      "restart-world-graph-roundtrip",
    );
    const restartGraphUiState = await secondProcess.request("load_ui_state", {
      file_path: projectPath,
      key: "world-graph.v1",
    });
    verify(
      equalJson(restartGraphUiState.state?.value, graphUiStateAfterSnapshot),
      "restart-world-graph-ui-state",
    );
    await secondProcess.close();
    secondProcess = undefined;

    process.stdout.write(
      `${JSON.stringify(
        {
          phase: "1C+1D",
          coreProcesses: 2,
          hierarchy,
          entities: {
            total: entities.size,
            kinds: kindCounts,
            aliases: aliasDefinitions.length,
            tags: tagDefinitions.length,
          },
          relations: {
            builtins: relationTypes.relation_types.length,
            custom: 1,
            total: initialRelations.relations.length,
            undirectedInverseVisible: true,
          },
          sceneLinks: {
            initial: initialLinks.links.length,
            promoted: linksAfterPromotion.links.length,
            roles: ["POV", "APPEARS", "RELATED", "MENTIONED"],
          },
          mentionDiscovery: {
            candidates: mentions.candidates.length,
            scenes: mentions.total_scenes,
            name: true,
            alias: true,
            falsePositiveNotCanonical: true,
          },
          entityNote: {
            ownerKind: "ENTITY",
            typieCommit: TYPIE_COMMIT,
            snapshotAndRecoveryRestored: true,
          },
          snapshots: {
            payloadVersion: 2,
            diff: diff.summary,
            restoreVerified: true,
          },
          worldGraph: {
            nodes: finalWorldGraph.nodes.length,
            edges: finalWorldGraph.edges.length,
            directed: finalWorldGraph.stats.directed_relation_count,
            undirected: finalWorldGraph.stats.undirected_relation_count,
            inverseDetailLabel: true,
            sceneContext: true,
            uiStateExcludedFromNamedSnapshot: true,
            processRestartRoundTrip: true,
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
      : (error?.stack?.match(/test-phase1c-story-bible\.mjs:(\d+):(\d+)/)?.[0] ??
        "unknown-location");
  process.stderr.write(`phase1c-story-bible: ${code} ${location}\n`);
  process.exitCode = 1;
}
