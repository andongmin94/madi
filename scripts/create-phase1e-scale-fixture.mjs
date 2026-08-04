import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { CoreSidecarClient } from "./lib/core-sidecar-test.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputRoot = resolve(repositoryRoot, "output");
const fixtureDirectory = resolve(outputRoot, "test-fixtures");
const fixturePath = resolve(fixtureDirectory, "phase1e-scale.madi");
const temporaryPath = resolve(
  fixtureDirectory,
  `.phase1e-scale-${process.pid}.madi`,
);
const savedBy = "madi-phase1e-scale-fixture";
const typieBuildInfo = JSON.parse(
  await readFile(
    resolve(repositoryRoot, "packages", "typie-runtime", "BUILD_INFO.json"),
    "utf8",
  ),
);
const typieCommit = typieBuildInfo.typieCommit;
if (typeof typieCommit !== "string" || !/^[0-9a-f]{40}$/u.test(typieCommit)) {
  throw new Error("Typie BUILD_INFO.json does not contain a valid commit");
}

function verify(condition, code) {
  if (!condition) {
    throw new Error(code);
  }
}

function measurementSummary(samples) {
  verify(samples.length > 0, "scale-measurement-samples");
  const ordered = [...samples].sort((left, right) => left - right);
  return {
    samplesMs: samples.map((sample) => Number(sample.toFixed(2))),
    medianMs: Number(ordered[Math.floor(ordered.length / 2)].toFixed(2)),
    maxMs: Number(Math.max(...ordered).toFixed(2)),
  };
}

function comparable(path) {
  return process.platform === "win32" ? path.toLocaleLowerCase() : path;
}

function isWithin(path, directory) {
  const candidate = comparable(path);
  const parent = comparable(directory);
  return candidate === parent || candidate.startsWith(`${parent}${sep}`);
}

async function removeRegularFile(path) {
  try {
    const entry = await lstat(path);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`refusing to remove non-regular fixture path: ${path}`);
    }
    await unlink(path);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function padded(index, width = 3) {
  return String(index).padStart(width, "0");
}

function textNode(id, index, groupId) {
  return {
    id,
    type: "text",
    x: (index % 25) * 260,
    y: Math.floor(index / 25) * 190,
    width: 240,
    height: 150,
    text: `결정론적 플롯 메모 ${padded(index, 4)}`,
    color: String((index % 6) + 1),
    madi: {
      nodeKind: "TEXT",
      ...(groupId ? { parentGroupId: groupId } : {}),
    },
  };
}

function groupNode(id, index) {
  return {
    id,
    type: "group",
    x: (index % 5) * 1_350,
    y: Math.floor(index / 5) * 1_000,
    width: 1_250,
    height: 900,
    label: `그룹 ${padded(index, 2)}`,
    color: String((index % 6) + 1),
    madi: { nodeKind: "GROUP" },
  };
}

function entityReferenceNode(id, entityIndex, positionIndex) {
  return {
    id,
    type: "text",
    x: (positionIndex % 25) * 260,
    y: Math.floor(positionIndex / 25) * 190,
    width: 240,
    height: 150,
    text: `설정 인물 ${padded(entityIndex)}`,
    color: "4",
    madi: {
      nodeKind: "ENTITY_REFERENCE",
      entityId: `scale-entity-${padded(entityIndex)}`,
      originalLabel: `설정 인물 ${padded(entityIndex)}`,
    },
  };
}

function sceneReferenceNode(id, sceneIndex, positionIndex) {
  return {
    id,
    type: "text",
    x: (positionIndex % 25) * 260,
    y: Math.floor(positionIndex / 25) * 190,
    width: 240,
    height: 150,
    text: `장면 ${padded(sceneIndex)}`,
    color: "5",
    madi: {
      nodeKind: "SCENE_REFERENCE",
      sceneNodeId: `scale-scene-${padded(sceneIndex)}`,
      originalLabel: `장면 ${padded(sceneIndex)}`,
    },
  };
}

function deterministicEdges(prefix, nodeIds, count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-edge-${padded(index, 4)}`,
    fromNode: nodeIds[index % nodeIds.length],
    toNode: nodeIds[(index * 17 + 1) % nodeIds.length],
    fromEnd: index % 7 === 0 ? "arrow" : "none",
    toEnd: "arrow",
    color: String((index % 6) + 1),
    label: `흐름 ${padded(index, 4)}`,
    madi: {
      lineStyle:
        index % 3 === 0 ? "DASHED" : index % 3 === 1 ? "SOLID" : "DOTTED",
    },
  }));
}

function generalDocument(canvasIndex) {
  const prefix = `general-${padded(canvasIndex, 2)}`;
  const nodes = [];
  for (let index = 0; index < 5; index += 1) {
    nodes.push(groupNode(`${prefix}-group-${padded(index, 2)}`, index));
  }
  for (let index = 0; index < 25; index += 1) {
    nodes.push(
      textNode(
        `${prefix}-text-${padded(index)}`,
        index,
        `${prefix}-group-${padded(index % 5, 2)}`,
      ),
    );
  }
  for (let index = 0; index < 35; index += 1) {
    nodes.push(
      entityReferenceNode(
        `${prefix}-entity-${padded(index)}`,
        (canvasIndex * 35 + index) % 200,
        30 + index,
      ),
    );
  }
  for (let index = 0; index < 35; index += 1) {
    nodes.push(
      sceneReferenceNode(
        `${prefix}-scene-${padded(index)}`,
        (canvasIndex * 35 + index) % 200,
        65 + index,
      ),
    );
  }
  verify(nodes.length === 100, "general-node-count");
  return {
    nodes,
    edges: deterministicEdges(prefix, nodes.map((node) => node.id), 200),
  };
}

function largeDocument() {
  const prefix = "large";
  const nodes = [];
  for (let index = 0; index < 10; index += 1) {
    nodes.push(groupNode(`${prefix}-group-${padded(index, 2)}`, index));
  }
  for (let index = 0; index < 90; index += 1) {
    nodes.push(
      textNode(
        `${prefix}-text-${padded(index)}`,
        index,
        `${prefix}-group-${padded(index % 10, 2)}`,
      ),
    );
  }
  for (let index = 0; index < 200; index += 1) {
    nodes.push(
      entityReferenceNode(
        `${prefix}-entity-${padded(index)}`,
        index,
        100 + index,
      ),
    );
  }
  for (let index = 0; index < 200; index += 1) {
    nodes.push(
      sceneReferenceNode(
        `${prefix}-scene-${padded(index)}`,
        index,
        300 + index,
      ),
    );
  }
  verify(nodes.length === 500, "large-node-count");
  return {
    nodes,
    edges: deterministicEdges(prefix, nodes.map((node) => node.id), 1_000),
  };
}

function inventory(canvases) {
  return canvases
    .map((canvas) => ({
      id: canvas.id,
      contentHash: canvas.content_hash,
      revision: canvas.revision,
      nodes: canvas.node_count,
      edges: canvas.edge_count,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function createFixture() {
  let client;
  let reopenClient;
  try {
    client = new CoreSidecarClient("phase1e-scale-create", {
      timeoutMs: 120_000,
    });
    const created = await client.request("create_project", {
      file_path: temporaryPath,
      title: "Phase 1E Scale Fixture",
      created_by: savedBy,
      project_id: "phase1e-scale-project",
      document_id: "scale-default-document",
      document_title: "기본 장면",
      editor_engine: "typie",
      editor_engine_commit: typieCommit,
      editor_schema_version: 1,
    });
    verify(created.project.metadata.schema_version === 7, "scale-schema-v7");
    let revision = 0;
    const mutate = async (method, params) => {
      const before = revision;
      const result = await client.request(method, {
        ...params,
        expected_revision: before,
        saved_by: savedBy,
      });
      verify(result.metadata.revision === before + 1, `${method}-revision`);
      revision = result.metadata.revision;
      return result;
    };

    const entityKinds = [
      "CHARACTER",
      "LOCATION",
      "ORGANIZATION",
      "ITEM",
      "EVENT",
      "WORLD_RULE",
      "FORESHADOWING",
      "OTHER",
    ];
    for (let index = 0; index < 200; index += 1) {
      await mutate("create_tree_node", {
        file_path: temporaryPath,
        node_id: `scale-scene-${padded(index)}`,
        parent_id: created.default_chapter_node_id,
        kind: "SCENE",
        title: `장면 ${padded(index)}`,
        document_id: `scale-scene-document-${padded(index)}`,
        editor_engine: "typie",
        editor_engine_commit: typieCommit,
        editor_schema_version: 1,
      });
      await mutate("create_entity", {
        file_path: temporaryPath,
        entity_id: `scale-entity-${padded(index)}`,
        document_id: `scale-entity-document-${padded(index)}`,
        kind: entityKinds[index % entityKinds.length],
        name: `설정 인물 ${padded(index)}`,
        summary: `결정론적 scale reference ${padded(index)}`,
        status: index % 5 === 0 ? "DRAFT" : "ACTIVE",
        color_token: String((index % 6) + 1),
        icon_key: null,
        attributes: {},
        editor_engine: "typie",
        editor_engine_commit: typieCommit,
        editor_schema_version: 1,
      });
    }

    for (let index = 0; index < 10; index += 1) {
      const document = generalDocument(index);
      await mutate("create_canvas", {
        file_path: temporaryPath,
        canvas_id: `general-canvas-${padded(index, 2)}`,
        name: `일반 캔버스 ${padded(index, 2)}`,
        description: "100 nodes / 200 edges",
        document,
      });
    }
    await mutate("create_canvas", {
      file_path: temporaryPath,
      canvas_id: "large-canvas-500-1000",
      name: "대규모 단일 캔버스",
      description: "500 nodes / 1000 edges",
      document: largeDocument(),
    });

    const beforeClose = await client.request("list_canvases", {
      file_path: temporaryPath,
      sort: "NAME_ASC",
    });
    const beforeInventory = inventory(beforeClose.canvases);
    verify(beforeInventory.length === 11, "scale-canvas-count");
    verify(
      beforeInventory
        .filter((canvas) => canvas.id.startsWith("general-canvas-"))
        .every((canvas) => canvas.nodes === 100 && canvas.edges === 200),
      "scale-general-counts",
    );
    const large = beforeInventory.find(
      (canvas) => canvas.id === "large-canvas-500-1000",
    );
    verify(large?.nodes === 500 && large.edges === 1_000, "scale-large-counts");
    verify(
      beforeInventory.every((canvas) => /^[0-9a-f]{64}$/.test(canvas.contentHash)),
      "scale-content-hashes",
    );

    await client.close();
    client = undefined;
    reopenClient = new CoreSidecarClient("phase1e-scale-reopen", {
      timeoutMs: 120_000,
    });
    const reopened = await reopenClient.request("open_project", {
      file_path: temporaryPath,
    });
    verify(reopened.metadata.revision === revision, "scale-reopen-revision");
    const afterClose = await reopenClient.request("list_canvases", {
      file_path: temporaryPath,
      sort: "NAME_ASC",
    });
    verify(
      JSON.stringify(inventory(afterClose.canvases)) ===
        JSON.stringify(beforeInventory),
      "scale-reopen-inventory",
    );
    const largeLoadSamples = [];
    let loadedLarge;
    for (let index = 0; index < 5; index += 1) {
      const startedAt = performance.now();
      loadedLarge = await reopenClient.request("load_canvas", {
        file_path: temporaryPath,
        canvas_id: "large-canvas-500-1000",
      });
      largeLoadSamples.push(performance.now() - startedAt);
      verify(
        loadedLarge.canvas.document.nodes.length === 500,
        `scale-reopen-nodes-${index}`,
      );
      verify(
        loadedLarge.canvas.document.edges.length === 1_000,
        `scale-reopen-edges-${index}`,
      );
    }
    verify(
      loadedLarge.canvas.document.nodes.filter(
        (node) => node.madi?.nodeKind === "ENTITY_REFERENCE",
      ).length === 200,
      "scale-entity-reference-count",
    );
    verify(
      loadedLarge.canvas.document.nodes.filter(
        (node) => node.madi?.nodeKind === "SCENE_REFERENCE",
      ).length === 200,
      "scale-scene-reference-count",
    );
    verify(
      loadedLarge.canvas.document.nodes.filter(
        (node) =>
          node.madi?.nodeKind === "TEXT" || node.madi?.nodeKind === "GROUP",
      ).length === 100,
      "scale-text-group-count",
    );
    await reopenClient.close();
    reopenClient = undefined;
    return {
      inventory: beforeInventory,
      revision,
      reopenLargeCanvasLoad: measurementSummary(largeLoadSamples),
    };
  } finally {
    if (client) {
      await client.forceStop();
    }
    if (reopenClient) {
      await reopenClient.forceStop();
    }
  }
}

if (
  dirname(fixturePath) !== fixtureDirectory ||
  dirname(temporaryPath) !== fixtureDirectory ||
  dirname(fixtureDirectory) !== outputRoot ||
  !isWithin(fixturePath, outputRoot) ||
  !isWithin(temporaryPath, outputRoot)
) {
  throw new Error("Phase 1E fixture path escaped output/test-fixtures");
}

await mkdir(fixtureDirectory, { recursive: true });
await removeRegularFile(temporaryPath);
await removeRegularFile(`${temporaryPath}.bak`);
await removeRegularFile(`${temporaryPath}.bak.previous`);

let created;
try {
  created = await createFixture();
  await removeRegularFile(fixturePath);
  await rename(temporaryPath, fixturePath);
  await removeRegularFile(`${temporaryPath}.bak`);
  await removeRegularFile(`${temporaryPath}.bak.previous`);

  let finalClient = new CoreSidecarClient("phase1e-scale-final", {
    timeoutMs: 120_000,
  });
  try {
    const reopened = await finalClient.request("open_project", {
      file_path: fixturePath,
    });
    verify(reopened.metadata.revision === created.revision, "final-reopen-revision");
    const canvases = await finalClient.request("list_canvases", {
      file_path: fixturePath,
      sort: "NAME_ASC",
    });
    verify(
      JSON.stringify(inventory(canvases.canvases)) ===
        JSON.stringify(created.inventory),
      "final-reopen-inventory",
    );
    await finalClient.close();
    finalClient = undefined;
  } finally {
    if (finalClient) {
      await finalClient.forceStop();
    }
  }

  const fixtureStats = await stat(fixturePath);
  const documentSetSha256 = createHash("sha256")
    .update(
      created.inventory
        .map((canvas) => `${canvas.id}:${canvas.contentHash}`)
        .join("\n"),
    )
    .digest("hex");
  process.stdout.write(
    `${JSON.stringify(
      {
        fixture: "output/test-fixtures/phase1e-scale.madi",
        bytes: fixtureStats.size,
        schemaVersion: 7,
        canvases: 11,
        general: {
          canvases: 10,
          nodesPerCanvas: 100,
          edgesPerCanvas: 200,
        },
        large: {
          nodes: 500,
          edges: 1_000,
          entityReferences: 200,
          sceneReferences: 200,
          textAndGroupNodes: 100,
        },
        canonicalReferences: {
          entities: 200,
          scenes: 200,
        },
        total: {
          nodes: 1_500,
          edges: 3_000,
        },
        documentSetSha256,
        processRestartRoundTrip: true,
        reopenLargeCanvasLoad: {
          boundary: "Rust/SQLite sidecar JSON-RPC load_canvas",
          runs: 5,
          ...created.reopenLargeCanvasLoad,
        },
        finalRevision: created.revision,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  await removeRegularFile(temporaryPath);
  await removeRegularFile(`${temporaryPath}.bak`);
  await removeRegularFile(`${temporaryPath}.bak.previous`);
  throw error;
}
