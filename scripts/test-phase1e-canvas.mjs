import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  CoreRpcError,
  CoreSidecarClient,
} from "./lib/core-sidecar-test.mjs";

const savedBy = "madi-phase1e-canvas-integration";

function verify(condition, code) {
  if (!condition) {
    throw new Error(code);
  }
}

function canonical(value) {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonical(nested)]),
    );
  }
  return value;
}

function equalJson(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function textNode(id, text, x, y, parentGroupId) {
  return {
    id,
    type: "text",
    x,
    y,
    width: 280,
    height: 150,
    text,
    color: "1",
    madi: {
      nodeKind: "TEXT",
      ...(parentGroupId ? { parentGroupId } : {}),
    },
  };
}

function referenceNode(id, text, x, y, nodeKind, referenceId) {
  return {
    id,
    type: "text",
    x,
    y,
    width: 260,
    height: 140,
    text,
    color: nodeKind === "ENTITY_REFERENCE" ? "4" : "5",
    madi: {
      nodeKind,
      ...(nodeKind === "ENTITY_REFERENCE"
        ? { entityId: referenceId }
        : { sceneNodeId: referenceId }),
      originalLabel: text,
    },
  };
}

function groupNode(id, label, x) {
  return {
    id,
    type: "group",
    x,
    y: 0,
    width: 1_500,
    height: 900,
    label,
    color: "2",
    madi: { nodeKind: "GROUP" },
  };
}

function edge(id, fromNode, toNode, label = "다음") {
  return {
    id,
    fromNode,
    toNode,
    fromEnd: "none",
    toEnd: "arrow",
    color: "3",
    label,
    madi: { lineStyle: "SOLID" },
  };
}

function primaryDocument() {
  const nodes = [
    groupNode("group-act-1", "1부", 0),
    groupNode("group-act-2", "2부", 1_650),
  ];
  for (let index = 0; index < 10; index += 1) {
    nodes.push(
      textNode(
        `text-${index + 1}`,
        `${index + 1}번째 플롯 메모`,
        100 + (index % 5) * 290 + (index >= 5 ? 1_650 : 0),
        100 + (index % 2) * 210,
        index < 5 ? "group-act-1" : "group-act-2",
      ),
    );
  }
  for (let index = 0; index < 5; index += 1) {
    nodes.push(
      referenceNode(
        `entity-reference-${index + 1}`,
        `인물 ${index + 1}`,
        150 + index * 300,
        520,
        "ENTITY_REFERENCE",
        `entity-${index + 1}`,
      ),
      referenceNode(
        `scene-reference-${index + 1}`,
        `장면 ${index + 1}`,
        1_800 + index * 300,
        520,
        "SCENE_REFERENCE",
        `scene-${index + 1}`,
      ),
    );
  }
  const connectableIds = nodes
    .filter((node) => node.type === "text")
    .map((node) => node.id);
  const edges = Array.from({ length: 15 }, (_, index) =>
    edge(
      `edge-${index + 1}`,
      connectableIds[index],
      connectableIds[index + 1],
      index === 14 ? "결말" : "다음",
    ),
  );
  return { nodes, edges };
}

function secondaryDocument(index) {
  return {
    nodes: [
      textNode(`canvas-${index}-a`, `${index}번 캔버스 시작`, 40, 80),
      textNode(`canvas-${index}-b`, `${index}번 캔버스 끝`, 420, 80),
    ],
    edges: [
      edge(
        `canvas-${index}-edge`,
        `canvas-${index}-a`,
        `canvas-${index}-b`,
      ),
    ],
  };
}

function inventory(canvases) {
  return canvases
    .map((canvas) => ({
      id: canvas.id,
      name: canvas.name,
      description: canvas.description,
      contentHash: canvas.content_hash,
      revision: canvas.revision,
      nodes: canvas.node_count,
      edges: canvas.edge_count,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function run() {
  const workspace = await mkdtemp(join(tmpdir(), "madi-phase1e-canvas-"));
  const projectPath = join(workspace, "plot-canvas-integration.madi");
  let first;
  let second;
  try {
    first = new CoreSidecarClient("phase1e-first");
    const created = await first.request("create_project", {
      file_path: projectPath,
      title: "Phase 1E 통합 작품",
      created_by: savedBy,
      project_id: "phase1e-integration-project",
      document_id: "default-document",
      document_title: "기본 장면",
      editor_engine: "typie",
      editor_engine_commit: "phase1e-integration",
      editor_schema_version: 1,
    });
    verify(created.project.metadata.schema_version === 6, "schema-v6");
    let revision = created.project.metadata.revision;

    const mutate = async (method, params) => {
      const before = revision;
      const result = await first.request(method, {
        ...params,
        expected_revision: before,
        saved_by: savedBy,
      });
      verify(result.metadata.revision === before + 1, `${method}-revision`);
      revision = result.metadata.revision;
      return result;
    };

    for (let index = 1; index <= 5; index += 1) {
      await mutate("create_tree_node", {
        file_path: projectPath,
        node_id: `scene-${index}`,
        parent_id: created.default_chapter_node_id,
        kind: "SCENE",
        title: `${index}번째 장면`,
        document_id: `scene-document-${index}`,
        editor_engine: "typie",
        editor_engine_commit: "phase1e-integration",
        editor_schema_version: 1,
      });
      await mutate("create_entity", {
        file_path: projectPath,
        entity_id: `entity-${index}`,
        document_id: `entity-document-${index}`,
        kind: "CHARACTER",
        name: `인물 ${index}`,
        summary: `${index}번째 설정 인물`,
        status: "ACTIVE",
        color_token: String(index),
        icon_key: null,
        attributes: {},
        editor_engine: "typie",
        editor_engine_commit: "phase1e-integration",
        editor_schema_version: 1,
      });
    }

    const documents = [
      primaryDocument(),
      secondaryDocument(2),
      secondaryDocument(3),
      secondaryDocument(4),
    ];
    const names = ["전체 플롯", "인물 관계 구상", "1부 사건 흐름", "결말 후보"];
    const canvasRecords = new Map();
    let primaryCanvasRevision = 0;
    for (let index = 0; index < 4; index += 1) {
      const result = await mutate("create_canvas", {
        file_path: projectPath,
        canvas_id: `canvas-${index + 1}`,
        name: names[index],
        description: `${names[index]} 설명`,
        document: documents[index],
      });
      verify(/^[0-9a-f]{64}$/.test(result.canvas.content_hash), "canvas-hash");
      canvasRecords.set(result.canvas.id, result.canvas);
    }

    const updatedFourth = await mutate("update_canvas", {
      file_path: projectPath,
      canvas_id: "canvas-4",
      name: "결말 후보 정리",
      description: "열린 결말과 닫힌 결말",
      expected_canvas_revision: 0,
    });
    canvasRecords.set("canvas-4", updatedFourth.canvas);

    const duplicate = await mutate("duplicate_canvas", {
      file_path: projectPath,
      source_canvas_id: "canvas-4",
      canvas_id: "canvas-temporary-copy",
      name: "삭제할 복제본",
    });
    verify(duplicate.canvas.content_hash === updatedFourth.canvas.content_hash, "duplicate-hash");
    await mutate("delete_canvas", {
      file_path: projectPath,
      canvas_id: "canvas-temporary-copy",
      expected_canvas_revision: 0,
    });

    const noOpBeforeRevision = revision;
    const noOp = await first.request("save_canvas", {
      file_path: projectPath,
      canvas_id: "canvas-1",
      document: documents[0],
      expected_revision: revision,
      expected_canvas_revision: primaryCanvasRevision,
      saved_by: savedBy,
    });
    verify(noOp.no_op === true, "save-noop-flag");
    verify(noOp.metadata.revision === noOpBeforeRevision, "save-noop-project-revision");
    verify(
      noOp.canvas.revision === primaryCanvasRevision,
      "save-noop-canvas-revision",
    );

    for (const stale of [
      {
        expected_revision: revision - 1,
        expected_canvas_revision: primaryCanvasRevision,
      },
      { expected_revision: revision, expected_canvas_revision: 99 },
    ]) {
      let error;
      try {
        await first.request("save_canvas", {
          file_path: projectPath,
          canvas_id: "canvas-1",
          document: documents[0],
          saved_by: savedBy,
          ...stale,
        });
      } catch (candidate) {
        error = candidate;
      }
      verify(error instanceof CoreRpcError && error.code === -32001, "stale-save-rejected");
    }

    const renamedEntity = await mutate("update_entity", {
      file_path: projectPath,
      entity_id: "entity-1",
      kind: "CHARACTER",
      name: "인물 1 개명",
      summary: "개명 후 현재 canonical 표시",
      status: "ACTIVE",
      color_token: "1",
      icon_key: null,
      attributes: {},
    });
    verify(renamedEntity.entity.name === "인물 1 개명", "entity-rename-canonical");
    const deletedEntity = await mutate("delete_entity", {
      file_path: projectPath,
      entity_id: "entity-2",
      confirmed: true,
    });
    verify(deletedEntity.deleted_entity_id === "entity-2", "entity-delete-canonical");
    const primaryWithBrokenReference = await first.request("load_canvas", {
      file_path: projectPath,
      canvas_id: "canvas-1",
    });
    const retainedBrokenReference = primaryWithBrokenReference.canvas.document.nodes.find(
      (node) => node.id === "entity-reference-2",
    );
    verify(
      retainedBrokenReference?.madi?.entityId === "entity-2",
      "deleted-entity-reference-retained",
    );
    const relinkedDocument = structuredClone(primaryWithBrokenReference.canvas.document);
    const relinkedReference = relinkedDocument.nodes.find(
      (node) => node.id === "entity-reference-2",
    );
    relinkedReference.text = "인물 3";
    relinkedReference.madi.entityId = "entity-3";
    relinkedReference.madi.originalLabel = "인물 3";
    const relinked = await mutate("save_canvas", {
      file_path: projectPath,
      canvas_id: "canvas-1",
      document: relinkedDocument,
      expected_canvas_revision: primaryCanvasRevision,
    });
    primaryCanvasRevision = relinked.canvas.revision;
    documents[0] = relinkedDocument;
    verify(primaryCanvasRevision === 1, "broken-reference-relink-revision");

    const baseline = await mutate("create_named_snapshot", {
      file_path: projectPath,
      snapshot_id: "phase1e-canvas-baseline",
      name: "Phase 1E Canvas 기준",
      note: "Canvas restore 검증",
      kind: "MANUAL",
    });
    verify(baseline.snapshot.payload_version === 4, "snapshot-payload-v4");

    const changedDocument = structuredClone(documents[0]);
    changedDocument.nodes[2].x += 77;
    changedDocument.nodes[2].width += 40;
    changedDocument.edges[0].label = "수정된 연결";
    changedDocument.nodes.push(textNode("text-after-snapshot", "스냅샷 이후", 3_200, 760));
    changedDocument.edges.push(edge("edge-after-snapshot", "scene-reference-5", "text-after-snapshot"));
    const changed = await mutate("save_canvas", {
      file_path: projectPath,
      canvas_id: "canvas-1",
      document: changedDocument,
      expected_canvas_revision: primaryCanvasRevision,
    });
    verify(changed.no_op === false, "changed-save-flag");
    verify(
      changed.canvas.revision === primaryCanvasRevision + 1,
      "changed-canvas-revision",
    );

    const diff = await first.request("diff_named_snapshot", {
      file_path: projectPath,
      snapshot_id: "phase1e-canvas-baseline",
    });
    verify(diff.summary.changed_canvases === 1, "snapshot-changed-canvases");
    verify(diff.summary.added_canvases === 0, "snapshot-added-canvases");
    verify(diff.summary.deleted_canvases === 0, "snapshot-deleted-canvases");
    verify(diff.summary.canvas_node_count_delta === 1, "snapshot-node-delta");
    verify(diff.summary.canvas_edge_count_delta === 1, "snapshot-edge-delta");

    const restored = await mutate("restore_named_snapshot", {
      file_path: projectPath,
      snapshot_id: "phase1e-canvas-baseline",
      auto_snapshot_name: "Phase 1E Canvas 복원 전",
    });
    verify(restored.restored_snapshot.payload_version === 4, "restored-payload-v4");
    verify(restored.safety_snapshot.payload_version === 4, "safety-payload-v4");
    verify(equalJson(restored.changes_before_restore, diff.summary), "restore-diff");

    const beforeRestart = await first.request("list_canvases", {
      file_path: projectPath,
      sort: "NAME_ASC",
    });
    verify(beforeRestart.canvases.length === 4, "canvas-count-before-restart");
    const beforeInventory = inventory(beforeRestart.canvases);
    const primaryBeforeRestart = await first.request("load_canvas", {
      file_path: projectPath,
      canvas_id: "canvas-1",
    });
    verify(equalJson(primaryBeforeRestart.canvas.document, documents[0]), "restored-document");
    verify(primaryBeforeRestart.canvas.node_count === 22, "restored-node-count");
    verify(primaryBeforeRestart.canvas.edge_count === 15, "restored-edge-count");
    const totalCounts = beforeRestart.canvases.reduce(
      (counts, canvas) => ({
        nodes: counts.nodes + canvas.node_count,
        edges: counts.edges + canvas.edge_count,
      }),
      { nodes: 0, edges: 0 },
    );

    await first.close();
    first = undefined;
    second = new CoreSidecarClient("phase1e-second");
    const reopened = await second.request("open_project", {
      file_path: projectPath,
    });
    verify(reopened.metadata.schema_version === 6, "reopen-schema-v6");
    verify(reopened.metadata.revision === revision, "reopen-revision");
    const afterRestart = await second.request("list_canvases", {
      file_path: projectPath,
      sort: "NAME_ASC",
    });
    verify(equalJson(inventory(afterRestart.canvases), beforeInventory), "reopen-inventory");
    const primaryAfterRestart = await second.request("load_canvas", {
      file_path: projectPath,
      canvas_id: "canvas-1",
    });
    verify(
      equalJson(primaryAfterRestart.canvas.document, primaryBeforeRestart.canvas.document),
      "reopen-document",
    );
    const snapshots = await second.request("list_named_snapshots", {
      file_path: projectPath,
    });
    verify(
      snapshots.snapshots.some(
        (snapshot) =>
          snapshot.id === "phase1e-canvas-baseline" &&
          snapshot.payload_version === 4,
      ),
      "reopen-snapshot-v4",
    );
    await second.close();
    second = undefined;

    process.stdout.write(
      `${JSON.stringify(
        {
          phase: "1E",
          schemaVersion: 6,
          coreProcesses: 2,
          canvases: 4,
          nodes: totalCounts.nodes,
          edges: totalCounts.edges,
          requiredPrimaryCanvas: {
            textNodes: 10,
            entityReferences: 5,
            sceneReferences: 5,
            groups: 2,
            edges: 15,
          },
          crud: {
            create: true,
            update: true,
            duplicate: true,
            delete: true,
            noOpSave: true,
            staleProjectRevisionRejected: true,
            staleCanvasRevisionRejected: true,
          },
          referenceLifecycle: {
            canonicalRename: true,
            deletedReferenceRetained: true,
            brokenReferenceRelinked: true,
          },
          snapshot: {
            payloadVersion: 4,
            changedCanvases: diff.summary.changed_canvases,
            nodeDelta: diff.summary.canvas_node_count_delta,
            edgeDelta: diff.summary.canvas_edge_count_delta,
            restored: true,
          },
          contentHashes: beforeInventory.map((canvas) => canvas.contentHash),
          processRestartRoundTrip: true,
          finalRevision: revision,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    if (first) {
      await first.forceStop();
    }
    if (second) {
      await second.forceStop();
    }
    const resolvedWorkspace = resolve(workspace);
    const safeRoot = resolve(tmpdir());
    if (
      resolvedWorkspace.startsWith(`${safeRoot}\\`) ||
      resolvedWorkspace.startsWith(`${safeRoot}/`)
    ) {
      await rm(resolvedWorkspace, { recursive: true, force: true });
    }
  }
}

try {
  await run();
} catch (error) {
  process.stderr.write(
    `phase1e-canvas: ${error instanceof Error ? error.message : "unexpected failure"}\n`,
  );
  process.exitCode = 1;
}
