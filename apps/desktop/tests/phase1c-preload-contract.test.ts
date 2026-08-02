import { describe, expect, it, vi } from "vitest";
import { CORE_METHODS } from "../src/main/coreClient";
import { createMadiDesktopApi } from "../src/preload/bridge";
import {
  ALLOWED_IPC_CHANNELS,
  IPC_CHANNELS
} from "../src/shared/contracts";

describe("Phase 1C preload capabilities", () => {
  it("maps every Story Bible operation to one fixed IPC channel", async () => {
    const calls: string[] = [];
    const invoke = vi.fn(async (channel: string): Promise<unknown> => {
      calls.push(channel);
      if (channel === IPC_CHANNELS.loadEntityNote) {
        return {
          ownerKind: "ENTITY",
          ownerId: "entity-1",
          id: "entity-document-1",
          projectId: "project-1",
          title: "레이아 노트",
          editorEngine: "typie",
          editorEngineCommit: "fixed-commit",
          editorSchemaVersion: 1,
          snapshot: Uint8Array.from([1, 2, 3]),
          plainTextRecovery: "노트",
          revision: 3,
          updatedAt: "2026-08-02T00:00:00.000Z"
        };
      }
      return undefined;
    });
    const api = createMadiDesktopApi(invoke);
    const sessionId = "session-id";

    await api.listEntities({ sessionId });
    await api.searchEntities({ sessionId, query: "레이아" });
    await api.createEntity({
      sessionId,
      kind: "CHARACTER",
      name: "레이아",
      editorEngine: "typie",
      editorEngineCommit: "fixed-commit",
      editorSchemaVersion: 1
    });
    await api.updateEntity({
      sessionId,
      entityId: "entity-1",
      kind: "CHARACTER",
      name: "레이아",
      summary: null,
      status: "ACTIVE",
      colorToken: null,
      iconKey: null,
      attributes: {}
    });
    await api.getEntityDeleteImpact({ sessionId, entityId: "entity-1" });
    await api.deleteEntity({
      sessionId,
      entityId: "entity-1",
      confirmed: true
    });
    const loaded = await api.loadEntityNote({
      sessionId,
      ownerKind: "ENTITY",
      ownerId: "entity-1"
    });
    const outgoing = Uint8Array.from([4, 5, 6]);
    await api.saveEntityNote({
      sessionId,
      ownerKind: "ENTITY",
      ownerId: "entity-1",
      documentId: "entity-document-1",
      generation: 1,
      saveSequence: 1,
      editorEngine: "typie",
      editorEngineCommit: "fixed-commit",
      editorSchemaVersion: 1,
      snapshot: outgoing,
      plainTextRecovery: "노트"
    });
    await api.listEntityAliases({ sessionId, entityId: "entity-1" });
    await api.createEntityAlias({
      sessionId,
      entityId: "entity-1",
      alias: "레아"
    });
    await api.deleteEntityAlias({ sessionId, aliasId: "alias-1" });
    await api.listTags({ sessionId });
    await api.createTag({ sessionId, name: "북부" });
    await api.updateTag({
      sessionId,
      tagId: "tag-1",
      name: "북부",
      colorToken: null
    });
    await api.deleteTag({ sessionId, tagId: "tag-1" });
    await api.listEntityTags({ sessionId, entityId: "entity-1" });
    await api.setEntityTags({
      sessionId,
      entityId: "entity-1",
      tagIds: ["tag-1"]
    });
    await api.listRelationTypes({ sessionId });
    await api.createRelationType({
      sessionId,
      name: "동맹",
      inverseName: "동맹",
      directed: false
    });
    await api.updateRelationType({
      sessionId,
      relationTypeId: "relation-type-1",
      name: "동맹",
      inverseName: "동맹",
      directed: false,
      colorToken: null
    });
    await api.deleteRelationType({ sessionId, relationTypeId: "custom-1" });
    await api.listEntityRelations({ sessionId, entityId: "entity-1" });
    await api.createEntityRelation({
      sessionId,
      sourceEntityId: "entity-1",
      relationTypeId: "relation-type-1",
      targetEntityId: "entity-2"
    });
    await api.updateEntityRelation({
      sessionId,
      relationId: "relation-1",
      relationTypeId: "relation-type-1",
      targetEntityId: "entity-2",
      note: null
    });
    await api.deleteEntityRelation({ sessionId, relationId: "relation-1" });
    await api.listSceneEntityLinks({ sessionId, sceneNodeId: "scene-1" });
    await api.createSceneEntityLink({
      sessionId,
      sceneNodeId: "scene-1",
      entityId: "entity-1",
      role: "APPEARS"
    });
    await api.deleteSceneEntityLink({
      sessionId,
      sceneNodeId: "scene-1",
      entityId: "entity-1",
      role: "APPEARS"
    });
    await api.discoverEntityMentions({ sessionId, entityId: "entity-1" });
    await api.promoteEntityMention({
      sessionId,
      sceneNodeId: "scene-1",
      entityId: "entity-1",
      role: "MENTIONED"
    });

    expect(calls).toEqual([
      IPC_CHANNELS.listEntities,
      IPC_CHANNELS.searchEntities,
      IPC_CHANNELS.createEntity,
      IPC_CHANNELS.updateEntity,
      IPC_CHANNELS.getEntityDeleteImpact,
      IPC_CHANNELS.deleteEntity,
      IPC_CHANNELS.loadEntityNote,
      IPC_CHANNELS.saveEntityNote,
      IPC_CHANNELS.listEntityAliases,
      IPC_CHANNELS.createEntityAlias,
      IPC_CHANNELS.deleteEntityAlias,
      IPC_CHANNELS.listTags,
      IPC_CHANNELS.createTag,
      IPC_CHANNELS.updateTag,
      IPC_CHANNELS.deleteTag,
      IPC_CHANNELS.listEntityTags,
      IPC_CHANNELS.setEntityTags,
      IPC_CHANNELS.listRelationTypes,
      IPC_CHANNELS.createRelationType,
      IPC_CHANNELS.updateRelationType,
      IPC_CHANNELS.deleteRelationType,
      IPC_CHANNELS.listEntityRelations,
      IPC_CHANNELS.createEntityRelation,
      IPC_CHANNELS.updateEntityRelation,
      IPC_CHANNELS.deleteEntityRelation,
      IPC_CHANNELS.listSceneEntityLinks,
      IPC_CHANNELS.createSceneEntityLink,
      IPC_CHANNELS.deleteSceneEntityLink,
      IPC_CHANNELS.discoverEntityMentions,
      IPC_CHANNELS.promoteEntityMention
    ]);
    expect(loaded.snapshot).toEqual(Uint8Array.from([1, 2, 3]));
    expect(ALLOWED_IPC_CHANNELS).toEqual(Object.values(IPC_CHANNELS));
    expect(Object.isFrozen(api)).toBe(true);
    expect("invoke" in api).toBe(false);
    expect(CORE_METHODS).toContain("promote_entity_mention");
  });

  it("deep-copies entity note bytes in both bridge directions", async () => {
    let bridgedSnapshot: Uint8Array | undefined;
    const sourceSnapshot = Uint8Array.from([7, 8, 9]);
    const invoke = vi.fn(
      async (channel: string, request?: unknown): Promise<unknown> => {
        if (channel === IPC_CHANNELS.loadEntityNote) {
          return {
            ownerKind: "ENTITY",
            ownerId: "entity-1",
            id: "entity-document-1",
            projectId: "project-1",
            title: "노트",
            editorEngine: "typie",
            editorEngineCommit: "fixed-commit",
            editorSchemaVersion: 1,
            snapshot: sourceSnapshot,
            plainTextRecovery: "노트",
            revision: 1,
            updatedAt: "2026-08-02T00:00:00.000Z"
          };
        }
        bridgedSnapshot = (request as { snapshot: Uint8Array }).snapshot;
        return {
          ownerKind: "ENTITY",
          ownerId: "entity-1",
          documentId: "entity-document-1",
          generation: 1,
          saveSequence: 1,
          revision: 2,
          updatedAt: "2026-08-02T00:00:00.000Z"
        };
      }
    );
    const api = createMadiDesktopApi(invoke);
    const loaded = await api.loadEntityNote({
      sessionId: "session-id",
      ownerKind: "ENTITY",
      ownerId: "entity-1"
    });
    const outgoing = Uint8Array.from([4, 5, 6]);
    await api.saveEntityNote({
      sessionId: "session-id",
      ownerKind: "ENTITY",
      ownerId: "entity-1",
      documentId: "entity-document-1",
      generation: 1,
      saveSequence: 1,
      editorEngine: "typie",
      editorEngineCommit: "fixed-commit",
      editorSchemaVersion: 1,
      snapshot: outgoing,
      plainTextRecovery: "노트"
    });

    expect(loaded.snapshot).toEqual(sourceSnapshot);
    expect(loaded.snapshot).not.toBe(sourceSnapshot);
    expect(bridgedSnapshot).toEqual(outgoing);
    expect(bridgedSnapshot).not.toBe(outgoing);
    sourceSnapshot[0] = 99;
    outgoing[0] = 99;
    expect(loaded.snapshot[0]).toBe(7);
    expect(bridgedSnapshot?.[0]).toBe(4);
  });
});
