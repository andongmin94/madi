import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  DesktopService,
  type DialogPort
} from "../src/main/desktopService";
import type {
  CoreClient,
  CoreMethod
} from "../src/main/coreClient";
import { ProjectSessionRegistry } from "../src/main/projectSessions";
import type {
  NamedSnapshotKind,
  TreeNodeKind
} from "../src/shared/contracts";

const FILE_PATH = "C:\\drafts\\dragon.madi";
const CREATED_AT = "2026-08-02T00:00:00.000Z";
const UPDATED_AT = "2026-08-02T00:01:00.000Z";

function coreNode(input: {
  readonly id: string;
  readonly kind: TreeNodeKind;
  readonly parentId: string | null;
  readonly documentId?: string | null;
  readonly title?: string;
  readonly orderKey?: number;
}) {
  return {
    id: input.id,
    project_id: "project-1",
    parent_id: input.parentId,
    kind: input.kind,
    title: input.title ?? input.id,
    order_key: input.orderKey ?? 1,
    document_id: input.documentId ?? null,
    created_at: CREATED_AT,
    updated_at: UPDATED_AT
  };
}

function coreSnapshot(
  id: string,
  kind: NamedSnapshotKind = "MANUAL",
  name = "퇴고 전"
) {
  return {
    id,
    project_id: "project-1",
    name,
    note: "논리 snapshot",
    kind,
    payload_format: "madi-logical-project",
    payload_version: 1,
    payload_bytes: 321,
    content_hash: "a".repeat(64),
    created_at: CREATED_AT,
    updated_at: UPDATED_AT
  };
}

const coreDiff = {
  added: { volumes: 1, chapters: 2, scenes: 3 },
  deleted: { volumes: 0, chapters: 1, scenes: 2 },
  renamed_nodes: 4,
  reordered_nodes: 5,
  changed_scene_bodies: 6,
  character_count_delta: -127,
  added_entities: 7,
  deleted_entities: 8,
  changed_entities: 9,
  added_relations: 10,
  deleted_relations: 11,
  changed_relations: 12,
  changed_scene_links: 13,
  changed_entity_notes: 14,
  added_tags: 15,
  deleted_tags: 16,
  changed_tags: 17,
  added_relation_types: 18,
  deleted_relation_types: 19,
  changed_relation_types: 20
};

function createHarness(
  responder: (
    method: CoreMethod,
    params: Readonly<Record<string, unknown>>
  ) => unknown | Promise<unknown>
) {
  const request = vi.fn(
    async (
      method: CoreMethod,
      params: Readonly<Record<string, unknown>>
    ): Promise<unknown> => responder(method, params)
  );
  const core: CoreClient = { request, dispose: vi.fn() };
  const sessions = new ProjectSessionRegistry();
  const session = sessions.add({
    filePath: FILE_PATH,
    projectId: "project-1",
    documentId: "document-1",
    sceneId: "scene-1",
    workNodeId: "work-1",
    title: "용 이야기",
    revision: 3
  });
  const dialog: DialogPort = {
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] }))
  };
  const service = new DesktopService(
    {} as BrowserWindow,
    dialog,
    core,
    sessions,
    "0.0.1"
  );
  return { request, service, session, sessions };
}

describe("Phase 1B DesktopService RPC contract", () => {
  it("decodes scene snapshot base64 into fresh Uint8Array values", async () => {
    const { request, service, session } = createHarness((method) => {
      if (method !== "load_scene") {
        throw new Error(`unexpected method ${method}`);
      }
      return {
        scene: coreNode({
          id: "scene-2",
          kind: "SCENE",
          parentId: "chapter-1",
          documentId: "document-2",
          title: "새 장면"
        }),
        document: {
          id: "document-2",
          project_id: "project-1",
          editor_engine: "typie",
          editor_engine_commit: "fixed-commit",
          editor_schema_version: 1,
          snapshot_base64: "AQID",
          plain_text_recovery: "새 장면 본문",
          updated_at: UPDATED_AT
        },
        project_revision: 4
      };
    });

    const first = await service.loadSceneDocument({
      sessionId: session.sessionId,
      sceneId: "scene-2"
    });
    const second = await service.loadSceneDocument({
      sessionId: session.sessionId,
      sceneId: "scene-2"
    });

    expect(first).toMatchObject({
      sceneId: "scene-2",
      id: "document-2",
      projectId: "project-1",
      title: "새 장면",
      editorEngine: "typie",
      editorEngineCommit: "fixed-commit",
      editorSchemaVersion: 1,
      plainTextRecovery: "새 장면 본문",
      revision: 4,
      updatedAt: UPDATED_AT
    });
    expect(first.snapshot).toEqual(Uint8Array.from([1, 2, 3]));
    expect(second.snapshot).toEqual(Uint8Array.from([1, 2, 3]));
    expect(second.snapshot).not.toBe(first.snapshot);
    first.snapshot[0] = 99;
    expect(second.snapshot[0]).toBe(1);
    expect(request.mock.calls).toEqual([
      ["load_scene", { file_path: FILE_PATH, scene_id: "scene-2" }],
      ["load_scene", { file_path: FILE_PATH, scene_id: "scene-2" }]
    ]);
  });

  it("maps Scrivenings, search and statistics RPCs and strictly camel-cases results", async () => {
    const { request, service, session, sessions } = createHarness((method) => {
      switch (method) {
        case "list_descendant_scenes":
          return {
            scope: coreNode({
              id: "volume-1",
              kind: "VOLUME",
              parentId: "work-1",
              title: "제1권"
            }),
            scenes: [
              {
                scene: coreNode({
                  id: "scene-1",
                  kind: "SCENE",
                  parentId: "chapter-1",
                  documentId: "document-1",
                  title: "귀환"
                }),
                document: {
                  id: "document-1",
                  plain_text_recovery: "용이 돌아왔다.",
                  source_content_hash: "b".repeat(64),
                  updated_at: UPDATED_AT
                }
              }
            ],
            total_scenes: 1,
            offset: 0,
            limit: 50,
            next_offset: null,
            has_more: false,
            metadata: { revision: 4 }
          };
        case "search_project":
          return {
            query: "용",
            case_sensitive: false,
            target: "ALL",
            scope_node_id: "work-1",
            total_matches: 1,
            scene_count: 1,
            hits: [
              {
                occurrence_id: "occurrence-1",
                node_id: "scene-1",
                scene_id: "scene-1",
                document_id: "document-1",
                node_kind: "SCENE",
                node_title: "귀환",
                field: "BODY",
                start_char: 0,
                end_char: 1,
                context_before: "",
                matched_text: "용",
                context_after: "이 돌아왔다.",
                source_content_hash: "b".repeat(64)
              }
            ],
            offset: 0,
            limit: 100,
            has_more: false,
            metadata: { revision: 5 }
          };
        case "get_text_statistics":
          return {
            scope_node_id: "work-1",
            scene_count: 1,
            with_spaces: 8,
            without_spaces: 7,
            scenes: [
              {
                scene_id: "scene-1",
                document_id: "document-1",
                with_spaces: 8,
                without_spaces: 7
              }
            ],
            metadata: { revision: 6 }
          };
        default:
          throw new Error(`unexpected method ${method}`);
      }
    });

    const scenes = await service.listDescendantScenes({
      sessionId: session.sessionId,
      scopeNodeId: "volume-1",
      offset: 0,
      limit: 50
    });
    const search = await service.searchProject({
      sessionId: session.sessionId,
      query: "용",
      caseSensitive: false,
      target: "ALL",
      offset: 0,
      limit: 100
    });
    const statistics = await service.getTextStatistics({
      sessionId: session.sessionId,
      scopeNodeId: "work-1"
    });

    expect(scenes).toEqual({
      scopeNodeId: "volume-1",
      scenes: [
        {
          sceneId: "scene-1",
          documentId: "document-1",
          plainTextRecovery: "용이 돌아왔다.",
          sourceContentHash: "b".repeat(64),
          updatedAt: UPDATED_AT
        }
      ],
      totalScenes: 1,
      offset: 0,
      limit: 50,
      nextOffset: null,
      hasMore: false,
      revision: 4
    });
    expect(search).toMatchObject({
      query: "용",
      caseSensitive: false,
      target: "ALL",
      scopeNodeId: "work-1",
      totalMatches: 1,
      sceneCount: 1,
      offset: 0,
      limit: 100,
      hasMore: false,
      revision: 5,
      hits: [
        {
          occurrenceId: "occurrence-1",
          nodeId: "scene-1",
          sceneId: "scene-1",
          documentId: "document-1",
          nodeKind: "SCENE",
          nodeTitle: "귀환",
          field: "BODY",
          start: 0,
          end: 1,
          matchedText: "용",
          sourceContentHash: "b".repeat(64)
        }
      ]
    });
    expect(statistics).toEqual({
      scopeNodeId: "work-1",
      sceneCount: 1,
      withSpaces: 8,
      withoutSpaces: 7,
      scenes: [
        {
          sceneId: "scene-1",
          documentId: "document-1",
          withSpaces: 8,
          withoutSpaces: 7
        }
      ],
      revision: 6
    });
    expect(request.mock.calls).toEqual([
      [
        "list_descendant_scenes",
        {
          file_path: FILE_PATH,
          scope_node_id: "volume-1",
          offset: 0,
          limit: 50
        }
      ],
      [
        "search_project",
        {
          file_path: FILE_PATH,
          query: "용",
          case_sensitive: false,
          target: "ALL",
          offset: 0,
          limit: 100
        }
      ],
      [
        "get_text_statistics",
        { file_path: FILE_PATH, scope_node_id: "work-1" }
      ]
    ]);
    expect(sessions.require(session.sessionId).revision).toBe(6);
  });

  it("maps named snapshot CRUD and diff with logical payload metadata", async () => {
    const { request, service, session, sessions } = createHarness((method) => {
      switch (method) {
        case "create_named_snapshot":
          return {
            snapshot: coreSnapshot("snapshot-1"),
            metadata: { revision: 4 }
          };
        case "list_named_snapshots":
          return {
            snapshots: [coreSnapshot("snapshot-1")],
            metadata: { revision: 4 }
          };
        case "rename_named_snapshot":
          return {
            snapshot: coreSnapshot("snapshot-1", "MANUAL", "새 이름"),
            metadata: { revision: 5 }
          };
        case "delete_named_snapshot":
          return {
            deleted_snapshot_id: "snapshot-1",
            metadata: { revision: 6 }
          };
        case "diff_named_snapshot":
          return {
            snapshot: coreSnapshot("snapshot-2"),
            summary: coreDiff,
            metadata: { revision: 6 }
          };
        default:
          throw new Error(`unexpected method ${method}`);
      }
    });

    const created = await service.createNamedSnapshot({
      sessionId: session.sessionId,
      name: "  퇴고 전  ",
      note: "논리 snapshot"
    });
    const listed = await service.listNamedSnapshots({
      sessionId: session.sessionId
    });
    const renamed = await service.renameNamedSnapshot({
      sessionId: session.sessionId,
      snapshotId: "snapshot-1",
      name: "  새 이름  "
    });
    const deleted = await service.deleteNamedSnapshot({
      sessionId: session.sessionId,
      snapshotId: "snapshot-1"
    });
    const difference = await service.diffNamedSnapshot({
      sessionId: session.sessionId,
      snapshotId: "snapshot-2"
    });

    expect(created.snapshot).toMatchObject({
      id: "snapshot-1",
      projectId: "project-1",
      name: "퇴고 전",
      note: "논리 snapshot",
      kind: "MANUAL",
      payloadFormat: "madi-logical-project",
      payloadVersion: 1,
      payloadBytes: 321,
      contentHash: "a".repeat(64),
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT
    });
    expect(listed.snapshots).toHaveLength(1);
    expect(renamed.snapshot.name).toBe("새 이름");
    expect(deleted).toEqual({
      deletedSnapshotId: "snapshot-1",
      revision: 6
    });
    expect(difference.summary).toEqual({
      added: { volumes: 1, chapters: 2, scenes: 3 },
      deleted: { volumes: 0, chapters: 1, scenes: 2 },
      renamedNodes: 4,
      reorderedNodes: 5,
      changedSceneBodies: 6,
      characterCountDelta: -127,
      addedEntities: 7,
      deletedEntities: 8,
      changedEntities: 9,
      addedRelations: 10,
      deletedRelations: 11,
      changedRelations: 12,
      changedSceneLinks: 13,
      changedEntityNotes: 14,
      addedTags: 15,
      deletedTags: 16,
      changedTags: 17,
      addedRelationTypes: 18,
      deletedRelationTypes: 19,
      changedRelationTypes: 20,
      addedCanvases: 0,
      deletedCanvases: 0,
      changedCanvases: 0,
      canvasNodeCountDelta: 0,
      canvasEdgeCountDelta: 0
    });
    expect(request.mock.calls).toEqual([
      [
        "create_named_snapshot",
        {
          file_path: FILE_PATH,
          name: "퇴고 전",
          note: "논리 snapshot",
          kind: "MANUAL",
          expected_revision: 3,
          saved_by: "madi/0.0.1"
        }
      ],
      ["list_named_snapshots", { file_path: FILE_PATH }],
      [
        "rename_named_snapshot",
        {
          file_path: FILE_PATH,
          snapshot_id: "snapshot-1",
          name: "새 이름",
          expected_revision: 4,
          saved_by: "madi/0.0.1"
        }
      ],
      [
        "delete_named_snapshot",
        {
          file_path: FILE_PATH,
          snapshot_id: "snapshot-1",
          expected_revision: 5,
          saved_by: "madi/0.0.1"
        }
      ],
      [
        "diff_named_snapshot",
        { file_path: FILE_PATH, snapshot_id: "snapshot-2" }
      ]
    ]);
    expect(sessions.require(session.sessionId).revision).toBe(6);
  });

  it("serializes replacement documents and atomically parses replacement and restore results", async () => {
    const { request, service, session, sessions } = createHarness((method) => {
      switch (method) {
        case "apply_replacement_batch":
          return {
            safety_snapshot: coreSnapshot(
              "snapshot-replace",
              "AUTO_BEFORE_REPLACE",
              "치환 직전"
            ),
            changed_scene_ids: ["scene-1"],
            changed_scenes: 1,
            changed_occurrences: 2,
            metadata: { revision: 4 }
          };
        case "restore_named_snapshot":
          return {
            restored_snapshot: coreSnapshot("snapshot-manual"),
            safety_snapshot: coreSnapshot(
              "snapshot-restore",
              "AUTO_BEFORE_RESTORE",
              "복원 직전"
            ),
            changes_before_restore: coreDiff,
            metadata: { revision: 5 }
          };
        case "load_project_tree":
          return {
            project: {
              id: "project-1",
              title: "복원된 용 이야기",
              author_name: null,
              created_at: CREATED_AT,
              updated_at: UPDATED_AT
            },
            nodes: [
              coreNode({
                id: "work-restored",
                kind: "WORK",
                parentId: null,
                title: "복원된 용 이야기"
              }),
              coreNode({
                id: "scene-restored",
                kind: "SCENE",
                parentId: "chapter-restored",
                documentId: "document-restored",
                title: "복원 장면"
              })
            ],
            revision: 5
          };
        default:
          throw new Error(`unexpected method ${method}`);
      }
    });
    const bytes = Uint8Array.from([1, 2, 3]);

    const replaced = await service.applyReplacementBatch({
      sessionId: session.sessionId,
      expectedRevision: 3,
      query: "용",
      replacement: "별",
      caseSensitive: false,
      autoSnapshotName: "치환 직전",
      transformedScenes: [
        {
          sceneId: "scene-1",
          documentId: "document-1",
          editorEngine: "typie",
          editorEngineCommit: "fixed-commit",
          editorSchemaVersion: 1,
          snapshot: bytes,
          plainTextRecovery: "별과 별",
          occurrenceCount: 2,
          sourceContentHash: "b".repeat(64)
        }
      ]
    });
    const restored = await service.restoreNamedSnapshot({
      sessionId: session.sessionId,
      snapshotId: "snapshot-manual",
      autoSnapshotName: "복원 직전"
    });

    expect(replaced).toMatchObject({
      changedSceneIds: ["scene-1"],
      changedScenes: 1,
      changedOccurrences: 2,
      revision: 4,
      safetySnapshot: {
        id: "snapshot-replace",
        kind: "AUTO_BEFORE_REPLACE",
        payloadFormat: "madi-logical-project"
      }
    });
    expect(restored).toMatchObject({
      restoredSnapshot: { id: "snapshot-manual", kind: "MANUAL" },
      safetySnapshot: {
        id: "snapshot-restore",
        kind: "AUTO_BEFORE_RESTORE"
      },
      changesBeforeRestore: {
        renamedNodes: 4,
        changedSceneBodies: 6,
        characterCountDelta: -127
      },
      revision: 5
    });
    expect(request.mock.calls).toEqual([
      [
        "apply_replacement_batch",
        {
          file_path: FILE_PATH,
          expected_revision: 3,
          query: "용",
          replacement: "별",
          case_sensitive: false,
          transformed_scenes: [
            {
              scene_id: "scene-1",
              document_id: "document-1",
              editor_engine: "typie",
              editor_engine_commit: "fixed-commit",
              editor_schema_version: 1,
              snapshot_base64: "AQID",
              plain_text_recovery: "별과 별",
              occurrence_count: 2,
              source_content_hash: "b".repeat(64)
            }
          ],
          saved_by: "madi/0.0.1",
          auto_snapshot_name: "치환 직전"
        }
      ],
      [
        "restore_named_snapshot",
        {
          file_path: FILE_PATH,
          snapshot_id: "snapshot-manual",
          expected_revision: 4,
          saved_by: "madi/0.0.1",
          auto_snapshot_name: "복원 직전"
        }
      ],
      ["load_project_tree", { file_path: FILE_PATH }]
    ]);
    expect(sessions.require(session.sessionId)).toMatchObject({
      revision: 5,
      title: "복원된 용 이야기",
      workNodeId: "work-restored",
      sceneId: "scene-restored",
      documentId: "document-restored"
    });
    expect(bytes).toEqual(Uint8Array.from([1, 2, 3]));
  });

  it("rejects stale or malformed input before RPC and rejects malformed core payloads", async () => {
    const inputHarness = createHarness(() => {
      throw new Error("core must not be called");
    });

    await expect(
      inputHarness.service.applyReplacementBatch({
        sessionId: inputHarness.session.sessionId,
        expectedRevision: 2,
        query: "용",
        replacement: "별",
        caseSensitive: false,
        transformedScenes: []
      })
    ).rejects.toThrow("preview is stale");
    await expect(
      inputHarness.service.searchProject({
        sessionId: inputHarness.session.sessionId,
        query: "용",
        caseSensitive: false,
        target: "INVALID" as "ALL"
      })
    ).rejects.toThrow("Invalid search target");
    expect(inputHarness.request).not.toHaveBeenCalled();

    const rangeHarness = createHarness(() => ({
      query: "용",
      case_sensitive: false,
      target: "ALL",
      scope_node_id: "work-1",
      total_matches: 1,
      scene_count: 1,
      hits: [
        {
          occurrence_id: "occurrence-1",
          node_id: "scene-1",
          scene_id: "scene-1",
          document_id: "document-1",
          node_kind: "SCENE",
          node_title: "귀환",
          field: "BODY",
          start_char: 1,
          end_char: 1,
          context_before: "",
          matched_text: "용",
          context_after: "",
          source_content_hash: "b".repeat(64)
        }
      ],
      offset: 0,
      limit: 100,
      has_more: false,
      metadata: { revision: 4 }
    }));
    await expect(
      rangeHarness.service.searchProject({
        sessionId: rangeHarness.session.sessionId,
        query: "용",
        caseSensitive: false,
        target: "ALL"
      })
    ).rejects.toThrow("invalid search range");
    expect(rangeHarness.sessions.require(rangeHarness.session.sessionId).revision).toBe(3);

    const hashHarness = createHarness(() => ({
      snapshots: [
        {
          ...coreSnapshot("snapshot-invalid"),
          content_hash: "not-a-sha256"
        }
      ],
      metadata: { revision: 3 }
    }));
    await expect(
      hashHarness.service.listNamedSnapshots({
        sessionId: hashHarness.session.sessionId
      })
    ).rejects.toThrow("invalid snapshot hash");

    const invalidDiffHarness = createHarness(() => ({
      snapshot: coreSnapshot("snapshot-invalid-diff"),
      summary: { ...coreDiff, added_tags: -1 },
      metadata: { revision: 3 }
    }));
    await expect(
      invalidDiffHarness.service.diffNamedSnapshot({
        sessionId: invalidDiffHarness.session.sessionId,
        snapshotId: "snapshot-invalid-diff"
      })
    ).rejects.toThrow("invalid added_tags");

    const {
      added_tags: _addedTags,
      deleted_tags: _deletedTags,
      changed_tags: _changedTags,
      added_relation_types: _addedRelationTypes,
      deleted_relation_types: _deletedRelationTypes,
      changed_relation_types: _changedRelationTypes,
      ...legacyDiff
    } = coreDiff;
    const legacyDiffHarness = createHarness(() => ({
      snapshot: coreSnapshot("snapshot-legacy-diff"),
      summary: legacyDiff,
      metadata: { revision: 3 }
    }));
    const parsedLegacyDiff = await legacyDiffHarness.service.diffNamedSnapshot({
      sessionId: legacyDiffHarness.session.sessionId,
      snapshotId: "snapshot-legacy-diff"
    });
    expect(parsedLegacyDiff.summary).toMatchObject({
      addedTags: 0,
      deletedTags: 0,
      changedTags: 0,
      addedRelationTypes: 0,
      deletedRelationTypes: 0,
      changedRelationTypes: 0
    });
  });
});
