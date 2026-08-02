import { describe, expect, it, vi } from "vitest";
import {
  ALLOWED_IPC_CHANNELS,
  IPC_CHANNELS,
  IPC_EVENTS,
  type LoadedDocument
} from "../src/shared/contracts";
import { createMadiDesktopApi } from "../src/preload/bridge";

const loadedDocument: LoadedDocument = {
  id: "document-id",
  projectId: "project-id",
  title: "드래곤을 죽이다",
  editorEngine: "typie",
  editorEngineCommit: "0123456789abcdef",
  editorSchemaVersion: 1,
  snapshot: Uint8Array.from([3, 1, 4]),
  plainTextRecovery: "드래곤",
  revision: 2,
  updatedAt: "2026-07-29T00:00:00.000Z"
};

describe("preload capability API", () => {
  it("exposes only the fixed document and safe-close capabilities", () => {
    const api = createMadiDesktopApi(vi.fn());

    expect(Object.keys(api).sort()).toEqual(
      [
        "createProject",
        "createEntity",
        "createEntityAlias",
        "createEntityRelation",
        "createRelationType",
        "createSceneEntityLink",
        "createTag",
        "createNode",
        "deleteNode",
        "deleteNamedSnapshot",
        "deleteEntity",
        "deleteEntityAlias",
        "deleteEntityRelation",
        "deleteRelationType",
        "deleteSceneEntityLink",
        "deleteTag",
        "diffNamedSnapshot",
        "getAppVersion",
        "getEntityDeleteImpact",
        "getProjectTree",
        "getTextStatistics",
        "applyReplacementBatch",
        "createNamedSnapshot",
        "listDescendantScenes",
        "listNamedSnapshots",
        "listEntities",
        "listEntityAliases",
        "listEntityRelations",
        "listEntityTags",
        "listRelationTypes",
        "listSceneEntityLinks",
        "listTags",
        "loadDocument",
        "loadEntityNote",
        "loadSceneDocument",
        "loadUiState",
        "moveNode",
        "onCloseRequested",
        "openProject",
        "recoverPlainText",
        "promoteEntityMention",
        "renameNamedSnapshot",
        "renameNode",
        "reorderNode",
        "restoreNamedSnapshot",
        "saveDocument",
        "saveEntityNote",
        "saveSceneDocument",
        "saveUiState",
        "searchProject",
        "searchEntities",
        "setEntityTags",
        "discoverEntityMentions",
        "updateEntity",
        "updateEntityRelation",
        "updateRelationType",
        "updateTag",
        "completeCloseRequest"
      ].sort()
    );
    expect(Object.isFrozen(api)).toBe(true);
    expect(ALLOWED_IPC_CHANNELS).toEqual(Object.values(IPC_CHANNELS));
    expect("invoke" in api).toBe(false);
  });

  it("buffers close requests until the renderer listener is registered", () => {
    let emitCloseRequest: (() => void) | undefined;
    const subscribe = vi.fn(
      (channel: string, listener: () => void) => {
        expect(channel).toBe(IPC_EVENTS.closeRequested);
        emitCloseRequest = listener;
        return vi.fn();
      }
    );
    const api = createMadiDesktopApi(vi.fn(), subscribe);

    emitCloseRequest?.();
    const firstListener = vi.fn();
    const unsubscribe = api.onCloseRequested(firstListener);

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(firstListener).toHaveBeenCalledTimes(1);

    emitCloseRequest?.();
    expect(firstListener).toHaveBeenCalledTimes(2);

    unsubscribe();
    emitCloseRequest?.();
    expect(firstListener).toHaveBeenCalledTimes(2);

    const replacementListener = vi.fn();
    api.onCloseRequested(replacementListener);
    expect(replacementListener).toHaveBeenCalledTimes(1);
  });

  it("maps every method to a fixed channel and copies binary values", async () => {
    const calls: string[] = [];
    let closeRequested: (() => void) | undefined;
    const subscribe = vi.fn(
      (channel: string, listener: () => void) => {
        expect(channel).toBe(IPC_EVENTS.closeRequested);
        closeRequested = listener;
        return () => {
          closeRequested = undefined;
        };
      }
    );
    const invoke = vi.fn(async (channel: string): Promise<unknown> => {
      calls.push(channel);
      if (channel === IPC_CHANNELS.loadDocument) {
        return loadedDocument;
      }
      if (channel === IPC_CHANNELS.loadSceneDocument) {
        return { ...loadedDocument, sceneId: "scene-id" };
      }
      if (channel === IPC_CHANNELS.getAppVersion) {
        return "0.0.1";
      }
      if (channel === IPC_CHANNELS.createProject) {
        return null;
      }
      if (channel === IPC_CHANNELS.openProject) {
        return null;
      }
      if (channel === IPC_CHANNELS.saveDocument) {
        return {
          documentId: "document-id",
          revision: 3,
          updatedAt: "2026-07-29T00:00:00.000Z"
        };
      }
      if (channel === IPC_CHANNELS.saveSceneDocument) {
        return {
          sceneId: "scene-id",
          documentId: "document-id",
          revision: 4,
          updatedAt: "2026-08-02T00:00:00.000Z",
          generation: 1,
          saveSequence: 1
        };
      }
      if (channel === IPC_CHANNELS.loadUiState) {
        return { state: null };
      }
      if (channel === IPC_CHANNELS.saveUiState) {
        return undefined;
      }
      if (
        channel === IPC_CHANNELS.getProjectTree ||
        channel === IPC_CHANNELS.createNode ||
        channel === IPC_CHANNELS.renameNode ||
        channel === IPC_CHANNELS.moveNode ||
        channel === IPC_CHANNELS.reorderNode ||
        channel === IPC_CHANNELS.deleteNode
      ) {
        return {
          project: {
            id: "project-id",
            title: "새 작품",
            authorName: null,
            createdAt: "2026-08-02T00:00:00.000Z",
            updatedAt: "2026-08-02T00:00:00.000Z"
          },
          nodes: [],
          revision: 4
        };
      }
      if (channel === IPC_CHANNELS.completeCloseRequest) {
        return true;
      }
      return {
        documentId: "document-id",
        plainText: "복구",
        revision: 3
      };
    });
    const api = createMadiDesktopApi(invoke, subscribe);
    const outgoing = Uint8Array.from([1, 2]);

    await api.createProject({
      title: "새 작품",
      editorEngine: "typie",
      editorEngineCommit: "commit",
      editorSchemaVersion: 0
    });
    await api.openProject();
    await api.saveDocument({
      sessionId: "session",
      documentId: "document-id",
      title: "새 작품",
      editorEngine: "typie",
      editorEngineCommit: "commit",
      editorSchemaVersion: 1,
      snapshot: outgoing,
      plainTextRecovery: "복구"
    });
    const restored = await api.loadDocument({ sessionId: "session" });
    await api.recoverPlainText({ sessionId: "session" });
    await api.getProjectTree({ sessionId: "session" });
    await api.createNode({
      sessionId: "session",
      parentId: "chapter-id",
      kind: "SCENE",
      title: "새 장면",
      editorEngineCommit: "commit",
      editorSchemaVersion: 1
    });
    await api.renameNode({
      sessionId: "session",
      nodeId: "scene-id",
      title: "첫 장면"
    });
    await api.moveNode({
      sessionId: "session",
      nodeId: "scene-id",
      newParentId: "other-chapter"
    });
    await api.reorderNode({
      sessionId: "session",
      nodeId: "scene-id",
      direction: "up"
    });
    await api.deleteNode({
      sessionId: "session",
      nodeId: "scene-id",
      recursive: true
    });
    const loadedScene = await api.loadSceneDocument({
      sessionId: "session",
      sceneId: "scene-id"
    });
    await api.saveSceneDocument({
      sessionId: "session",
      sceneId: "scene-id",
      documentId: "document-id",
      generation: 1,
      saveSequence: 1,
      editorEngine: "typie",
      editorEngineCommit: "commit",
      editorSchemaVersion: 1,
      snapshot: outgoing,
      plainTextRecovery: "복구"
    });
    await api.saveUiState({
      sessionId: "session",
      state: {
        selectedNodeId: "scene-id",
        expandedNodeIds: ["work-id"],
        binderWidth: 300
      }
    });
    await api.loadUiState({ sessionId: "session" });
    await api.getAppVersion();
    const listener = vi.fn();
    const unsubscribe = api.onCloseRequested(listener);
    closeRequested?.();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    const closeAccepted = await api.completeCloseRequest({
      readyToClose: true
    });

    expect(calls).toEqual([
      IPC_CHANNELS.createProject,
      IPC_CHANNELS.openProject,
      IPC_CHANNELS.saveDocument,
      IPC_CHANNELS.loadDocument,
      IPC_CHANNELS.recoverPlainText,
      IPC_CHANNELS.getProjectTree,
      IPC_CHANNELS.createNode,
      IPC_CHANNELS.renameNode,
      IPC_CHANNELS.moveNode,
      IPC_CHANNELS.reorderNode,
      IPC_CHANNELS.deleteNode,
      IPC_CHANNELS.loadSceneDocument,
      IPC_CHANNELS.saveSceneDocument,
      IPC_CHANNELS.saveUiState,
      IPC_CHANNELS.loadUiState,
      IPC_CHANNELS.getAppVersion,
      IPC_CHANNELS.completeCloseRequest
    ]);
    expect(restored.snapshot).toEqual(Uint8Array.from([3, 1, 4]));
    expect(restored.snapshot).not.toBe(loadedDocument.snapshot);
    expect(loadedScene.snapshot).toEqual(Uint8Array.from([3, 1, 4]));
    expect(loadedScene.snapshot).not.toBe(loadedDocument.snapshot);
    expect(closeAccepted).toBe(true);
  });
});
