import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  DesktopService,
  type DialogPort
} from "../src/main/desktopService";
import {
  CORE_METHODS,
  type CoreClient,
  type CoreMethod
} from "../src/main/coreClient";
import { ProjectSessionRegistry } from "../src/main/projectSessions";

const FILE_PATH = "C:\\drafts\\story-bible.madi";
const CREATED_AT = "2026-08-02T00:00:00.000Z";
const UPDATED_AT = "2026-08-02T00:01:00.000Z";

function coreEntity(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: "entity-1",
    project_id: "project-1",
    kind: "CHARACTER",
    name: "레이아",
    summary: "북부의 마법사",
    document_id: "entity-document-1",
    status: "ACTIVE",
    color_token: "violet",
    icon_key: "person",
    attributes: { age: 29 },
    duplicate_name: false,
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    ...overrides
  };
}

function coreTag(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: "tag-1",
    project_id: "project-1",
    name: "북부",
    color_token: "blue",
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    ...overrides
  };
}

function coreRelationType(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: "relation-type-1",
    project_id: "project-1",
    name: "소속",
    inverse_name: "구성원을 가짐",
    directed: true,
    color_token: "blue",
    is_builtin: true,
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    ...overrides
  };
}

function coreRelation(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: "relation-1",
    project_id: "project-1",
    source_entity_id: "entity-1",
    relation_type_id: "relation-type-1",
    target_entity_id: "entity-2",
    note: "단장",
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    ...overrides
  };
}

function coreLink(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    scene_node_id: "scene-1",
    entity_id: "entity-1",
    role: "APPEARS",
    note: null,
    created_at: CREATED_AT,
    ...overrides
  };
}

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
  return {
    request,
    sessions,
    session,
    service: new DesktopService(
      {} as BrowserWindow,
      dialog,
      core,
      sessions,
      "0.0.1"
    )
  };
}

describe("Phase 1C DesktopService RPC contract", () => {
  it("keeps every Story Bible RPC on the fixed sidecar allowlist", () => {
    const phase1cMethods = [
      "list_entities",
      "search_entities",
      "create_entity",
      "update_entity",
      "get_entity_delete_impact",
      "delete_entity",
      "load_entity_note",
      "save_entity_note",
      "list_entity_aliases",
      "create_entity_alias",
      "delete_entity_alias",
      "list_tags",
      "create_tag",
      "update_tag",
      "delete_tag",
      "list_entity_tags",
      "set_entity_tags",
      "list_relation_types",
      "create_relation_type",
      "update_relation_type",
      "delete_relation_type",
      "list_entity_relations",
      "create_entity_relation",
      "update_entity_relation",
      "delete_entity_relation",
      "list_scene_entity_links",
      "create_scene_entity_link",
      "delete_scene_entity_link",
      "discover_entity_mentions",
      "promote_entity_mention"
    ];

    expect(CORE_METHODS).toEqual(expect.arrayContaining(phase1cMethods));
    expect(new Set(CORE_METHODS).size).toBe(CORE_METHODS.length);
    expect(CORE_METHODS).not.toContain("invoke");
    expect(CORE_METHODS).not.toContain("execute_sql");
  });

  it("maps entity CRUD and owner-safe entity note bytes without leaking Typie internals", async () => {
    const harness = createHarness((method) => {
      switch (method) {
        case "list_entities":
          return { metadata: { revision: 3 }, entities: [coreEntity()] };
        case "create_entity":
          return {
            metadata: { revision: 4 },
            entity: coreEntity(),
            document: {
              id: "entity-document-1",
              project_id: "project-1"
            },
            backup_file_path: `${FILE_PATH}.bak`
          };
        case "update_entity":
          return {
            metadata: { revision: 5 },
            entity: coreEntity({ summary: null, attributes: { age: 30 } }),
            backup_file_path: `${FILE_PATH}.bak`
          };
        case "load_entity_note":
          return {
            owner_kind: "ENTITY",
            owner_id: "entity-1",
            document_id: "entity-document-1",
            document: {
              id: "entity-document-1",
              project_id: "project-1",
              title: "레이아 상세 노트",
              editor_engine: "typie",
              editor_engine_commit: "fixed-commit",
              editor_schema_version: 1,
              snapshot_base64: "AQID",
              plain_text_recovery: "상세 노트",
              created_at: CREATED_AT,
              updated_at: UPDATED_AT
            },
            project_revision: 5
          };
        case "save_entity_note":
          return {
            metadata: { revision: 6, updated_at: UPDATED_AT },
            owner_kind: "ENTITY",
            owner_id: "entity-1",
            generation: 2,
            save_sequence: 7,
            document: {
              id: "entity-document-1",
              project_id: "project-1"
            },
            backup_file_path: `${FILE_PATH}.bak`
          };
        default:
          throw new Error(`unexpected method ${method}`);
      }
    });

    const listed = await harness.service.listEntities({
      sessionId: harness.session.sessionId,
      kinds: ["CHARACTER"],
      statuses: ["ACTIVE"],
      tagIds: ["tag-1"],
      sort: "NAME_ASC"
    });
    const created = await harness.service.createEntity({
      sessionId: harness.session.sessionId,
      kind: "CHARACTER",
      name: " 레이아 ",
      summary: "북부의 마법사",
      status: "ACTIVE",
      colorToken: "violet",
      iconKey: "person",
      attributes: { age: 29 },
      editorEngine: "typie",
      editorEngineCommit: "fixed-commit",
      editorSchemaVersion: 1
    });
    const updated = await harness.service.updateEntity({
      sessionId: harness.session.sessionId,
      entityId: "entity-1",
      kind: "CHARACTER",
      name: "레이아",
      summary: null,
      status: "ACTIVE",
      colorToken: "violet",
      iconKey: "person",
      attributes: { age: 30 }
    });
    const loaded = await harness.service.loadEntityNote({
      sessionId: harness.session.sessionId,
      ownerKind: "ENTITY",
      ownerId: "entity-1"
    });
    const outgoing = Uint8Array.from([4, 5, 6]);
    const saved = await harness.service.saveEntityNote({
      sessionId: harness.session.sessionId,
      ownerKind: "ENTITY",
      ownerId: "entity-1",
      documentId: "entity-document-1",
      generation: 2,
      saveSequence: 7,
      editorEngine: "typie",
      editorEngineCommit: "fixed-commit",
      editorSchemaVersion: 1,
      snapshot: outgoing,
      plainTextRecovery: "변경된 상세 노트"
    });

    expect(listed.entities[0]).toMatchObject({
      id: "entity-1",
      kind: "CHARACTER",
      attributes: { age: 29 }
    });
    expect(created.revision).toBe(4);
    expect(updated.entity).toMatchObject({ summary: null, attributes: { age: 30 } });
    expect(loaded).toMatchObject({
      ownerKind: "ENTITY",
      ownerId: "entity-1",
      id: "entity-document-1",
      plainTextRecovery: "상세 노트",
      revision: 5
    });
    expect(loaded.snapshot).toEqual(Uint8Array.from([1, 2, 3]));
    expect(saved).toMatchObject({
      ownerKind: "ENTITY",
      ownerId: "entity-1",
      generation: 2,
      saveSequence: 7,
      revision: 6
    });
    expect(outgoing).toEqual(Uint8Array.from([4, 5, 6]));
    expect(harness.request.mock.calls.at(-1)).toEqual([
      "save_entity_note",
      expect.objectContaining({
        file_path: FILE_PATH,
        owner_kind: "ENTITY",
        owner_id: "entity-1",
        document_id: "entity-document-1",
        snapshot_base64: "BAUG",
        expected_revision: 5
      })
    ]);
  });

  it("maps aliases, tags, relations, scene links and mention candidates", async () => {
    let revision = 3;
    const harness = createHarness((method) => {
      const read = (payload: Readonly<Record<string, unknown>>) => ({
        metadata: { revision },
        ...payload
      });
      const mutate = (payload: Readonly<Record<string, unknown>>) => {
        revision += 1;
        return { metadata: { revision }, ...payload };
      };
      switch (method) {
        case "list_entity_aliases":
          return read({
            aliases: [
              {
                id: "alias-1",
                entity_id: "entity-1",
                alias: "북부의 마법사",
                normalized_alias: "북부의 마법사",
                created_at: CREATED_AT
              }
            ]
          });
        case "create_entity_alias":
          return mutate({
            alias: {
              id: "alias-2",
              entity_id: "entity-1",
              alias: "레아",
              normalized_alias: "레아",
              created_at: CREATED_AT
            }
          });
        case "list_tags":
          return read({ tags: [coreTag()] });
        case "list_entity_tags":
          return read({ entity_id: "entity-1", tags: [coreTag()] });
        case "set_entity_tags":
          return mutate({ entity_id: "entity-1", tags: [coreTag()] });
        case "list_relation_types":
          return read({ relation_types: [coreRelationType()] });
        case "create_entity_relation":
          return mutate({ relation: coreRelation() });
        case "list_entity_relations":
          return read({ relations: [coreRelation()] });
        case "create_scene_entity_link":
          return mutate({ link: coreLink() });
        case "list_scene_entity_links":
          return read({ links: [coreLink()] });
        case "discover_entity_mentions":
          return read({
            entity_id: "entity-1",
            total_scenes: 1,
            offset: 0,
            limit: 100,
            has_more: false,
            candidates: [
              {
                occurrence_id: "mention-1",
                entity_id: "entity-1",
                scene_node_id: "scene-1",
                scene_title: "귀환",
                document_id: "document-1",
                matched_alias: "레아",
                context_before: "마침내 ",
                matched_text: "레아",
                context_after: "가 돌아왔다.",
                start: 4,
                end: 6,
                already_linked: false
              }
            ]
          });
        case "promote_entity_mention":
          return mutate({ link: coreLink({ role: "MENTIONED" }) });
        default:
          throw new Error(`unexpected method ${method}`);
      }
    });
    const sessionId = harness.session.sessionId;

    expect(
      await harness.service.listEntityAliases({ sessionId, entityId: "entity-1" })
    ).toMatchObject({ aliases: [{ normalizedAlias: "북부의 마법사" }] });
    await harness.service.createEntityAlias({
      sessionId,
      entityId: "entity-1",
      alias: "레아"
    });
    expect(await harness.service.listTags({ sessionId })).toMatchObject({
      tags: [{ id: "tag-1", colorToken: "blue" }]
    });
    expect(
      await harness.service.listEntityTags({ sessionId, entityId: "entity-1" })
    ).toMatchObject({ entityId: "entity-1", tags: [{ name: "북부" }] });
    await harness.service.setEntityTags({
      sessionId,
      entityId: "entity-1",
      tagIds: ["tag-1"]
    });
    expect(await harness.service.listRelationTypes({ sessionId })).toMatchObject({
      relationTypes: [{ inverseName: "구성원을 가짐", directed: true }]
    });
    await harness.service.createEntityRelation({
      sessionId,
      sourceEntityId: "entity-1",
      relationTypeId: "relation-type-1",
      targetEntityId: "entity-2",
      note: "단장"
    });
    expect(
      await harness.service.listEntityRelations({
        sessionId,
        entityId: "entity-1"
      })
    ).toMatchObject({ relations: [{ targetEntityId: "entity-2" }] });
    await harness.service.createSceneEntityLink({
      sessionId,
      sceneNodeId: "scene-1",
      entityId: "entity-1",
      role: "APPEARS"
    });
    expect(
      await harness.service.listSceneEntityLinks({
        sessionId,
        sceneNodeId: "scene-1"
      })
    ).toMatchObject({ links: [{ role: "APPEARS" }] });
    expect(
      await harness.service.discoverEntityMentions({
        sessionId,
        entityId: "entity-1"
      })
    ).toMatchObject({
      candidates: [
        {
          occurrenceId: "mention-1",
          sceneNodeId: "scene-1",
          matchedAlias: "레아",
          start: 4,
          end: 6,
          alreadyLinked: false
        }
      ]
    });
    await harness.service.promoteEntityMention({
      sessionId,
      entityId: "entity-1",
      sceneNodeId: "scene-1",
      role: "MENTIONED"
    });

    expect(harness.request).toHaveBeenCalledWith("set_entity_tags", {
      file_path: FILE_PATH,
      entity_id: "entity-1",
      tag_ids: ["tag-1"],
      expected_revision: 4,
      saved_by: "madi/0.0.1"
    });
  });

  it("maps full-record updates and destructive identity confirmations", async () => {
    let revision = 3;
    const harness = createHarness((method) => {
      const mutate = (payload: Readonly<Record<string, unknown>>) => {
        revision += 1;
        return { metadata: { revision }, ...payload };
      };
      switch (method) {
        case "update_tag":
          return mutate({ tag: coreTag({ name: "북부 핵심" }) });
        case "delete_tag":
          return mutate({ deleted_tag_id: "tag-1" });
        case "create_relation_type":
          return mutate({
            relation_type: coreRelationType({
              id: "relation-type-custom",
              name: "스승",
              inverse_name: "제자",
              is_builtin: false
            })
          });
        case "update_relation_type":
          return mutate({
            relation_type: coreRelationType({
              id: "relation-type-custom",
              name: "선생",
              inverse_name: "학생",
              is_builtin: false
            })
          });
        case "delete_relation_type":
          return mutate({ deleted_relation_type_id: "relation-type-custom" });
        case "update_entity_relation":
          return mutate({ relation: coreRelation({ note: null }) });
        case "delete_entity_relation":
          return mutate({ deleted_relation_id: "relation-1" });
        case "delete_scene_entity_link":
          return mutate({
            deleted_link: {
              scene_node_id: "scene-1",
              entity_id: "entity-1",
              role: "APPEARS"
            }
          });
        case "delete_entity_alias":
          return mutate({ deleted_alias_id: "alias-1" });
        case "get_entity_delete_impact":
          return {
            metadata: { revision },
            impact: {
              entity_id: "entity-1",
              relation_count: 2,
              scene_link_count: 3,
              mention_scene_count: 4,
              alias_count: 1,
              tag_count: 2,
              note_character_count: 42
            }
          };
        case "delete_entity":
          return mutate({
            deleted_entity_id: "entity-1",
            deleted_document_id: "entity-document-1",
            impact: {
              entity_id: "entity-1",
              relation_count: 2,
              scene_link_count: 3,
              mention_scene_count: 4,
              alias_count: 1,
              tag_count: 2,
              note_character_count: 42
            }
          });
        default:
          throw new Error(`unexpected method ${method}`);
      }
    });
    const sessionId = harness.session.sessionId;

    await harness.service.updateTag({
      sessionId,
      tagId: "tag-1",
      name: "북부 핵심",
      colorToken: null
    });
    await harness.service.deleteTag({ sessionId, tagId: "tag-1" });
    await harness.service.createRelationType({
      sessionId,
      name: "스승",
      inverseName: "제자",
      directed: true,
      colorToken: "violet"
    });
    await harness.service.updateRelationType({
      sessionId,
      relationTypeId: "relation-type-custom",
      name: "선생",
      inverseName: "학생",
      directed: true,
      colorToken: null
    });
    await harness.service.deleteRelationType({
      sessionId,
      relationTypeId: "relation-type-custom"
    });
    await harness.service.updateEntityRelation({
      sessionId,
      relationId: "relation-1",
      relationTypeId: "relation-type-1",
      targetEntityId: "entity-2",
      note: null
    });
    await harness.service.deleteEntityRelation({
      sessionId,
      relationId: "relation-1"
    });
    await harness.service.deleteSceneEntityLink({
      sessionId,
      sceneNodeId: "scene-1",
      entityId: "entity-1",
      role: "APPEARS"
    });
    await harness.service.deleteEntityAlias({
      sessionId,
      aliasId: "alias-1"
    });
    const impact = await harness.service.getEntityDeleteImpact({
      sessionId,
      entityId: "entity-1"
    });
    const deleted = await harness.service.deleteEntity({
      sessionId,
      entityId: "entity-1",
      confirmed: true
    });

    expect(impact).toMatchObject({
      impact: {
        entityId: "entity-1",
        relationCount: 2,
        sceneLinkCount: 3,
        mentionSceneCount: 4,
        aliasCount: 1,
        tagCount: 2,
        noteCharacterCount: 42
      },
      revision: 12
    });
    expect(deleted).toMatchObject({
      deletedEntityId: "entity-1",
      revision: 13
    });
    expect(harness.request).toHaveBeenLastCalledWith("delete_entity", {
      file_path: FILE_PATH,
      entity_id: "entity-1",
      confirmed: true,
      expected_revision: 12,
      saved_by: "madi/0.0.1"
    });
  });

  it("requires explicit deletion and rejects malformed owners before RPC", async () => {
    const harness = createHarness(() => {
      throw new Error("core must not be called");
    });

    await expect(
      harness.service.deleteEntity({
        sessionId: harness.session.sessionId,
        entityId: "entity-1",
        confirmed: false as true
      })
    ).rejects.toThrow("explicit confirmation");
    await expect(
      harness.service.loadEntityNote({
        sessionId: harness.session.sessionId,
        ownerKind: "SCENE" as "ENTITY",
        ownerId: "entity-1"
      })
    ).rejects.toThrow("owner kind");
    await expect(
      harness.service.createEntityRelation({
        sessionId: harness.session.sessionId,
        sourceEntityId: "entity-1",
        relationTypeId: "relation-type-1",
        targetEntityId: "entity-1"
      })
    ).rejects.toThrow("Self relations");
    await expect(
      harness.service.searchEntities({
        sessionId: harness.session.sessionId,
        query: "레이아",
        limit: 2_001
      })
    ).rejects.toThrow("Invalid Entity search limit");
    await expect(
      harness.service.discoverEntityMentions({
        sessionId: harness.session.sessionId,
        entityId: "entity-1",
        limit: 2_001
      })
    ).rejects.toThrow("Invalid Mention limit");
    expect(harness.request).not.toHaveBeenCalled();
  });
});
