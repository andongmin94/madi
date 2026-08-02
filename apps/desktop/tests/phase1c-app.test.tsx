import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type {
  EditorChange,
  MadiEditorAdapter
} from "../src/renderer/editor/MadiEditorAdapter";
import type {
  EntityRecord,
  LoadedEntityNote,
  LoadedSceneDocument,
  MadiDesktopApi,
  ProjectTree
} from "../src/shared/contracts";
import { phase1bApiStubs } from "./phase1b-api-stubs";

const NOW = "2026-08-02T00:00:00.000Z";

class OwnerEditor implements MadiEditorAdapter {
  public readonly surface = document.createElement("div");
  public plainText = "장면 본문";
  public readonly reveals: Array<readonly [number, number]> = [];
  private readonly listeners = new Set<(change: EditorChange) => void>();

  public constructor() {
    this.surface.dataset.testid = "phase1c-typie-surface";
  }

  public async open(): Promise<void> {}
  public async getSnapshot(): Promise<Uint8Array> {
    return Uint8Array.from([7, 8, 9]);
  }
  public async getPlainText(): Promise<string> {
    return this.plainText;
  }
  public relocate(element: HTMLElement): void {
    element.replaceChildren(this.surface);
  }
  public revealTextRange(start: number, end: number): void {
    this.reveals.push([start, end]);
  }
  public focus(): void {}
  public undo(): void {}
  public redo(): void {}
  public insertSceneBreak(): void {}
  public onChanged(listener: (change: EditorChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  public emitDirty(): void {
    for (const listener of this.listeners) {
      listener({
        revision: 1,
        reason: "content",
        canUndo: true,
        canRedo: false,
        isComposing: false
      });
    }
  }
}

const tree: ProjectTree = {
  project: {
    id: "project-1",
    title: "닫힌 성문",
    authorName: null,
    createdAt: NOW,
    updatedAt: NOW
  },
  nodes: [
    {
      id: "work-1",
      projectId: "project-1",
      parentId: null,
      kind: "WORK",
      title: "닫힌 성문",
      orderKey: 1024,
      documentId: null,
      createdAt: NOW,
      updatedAt: NOW
    },
    {
      id: "volume-1",
      projectId: "project-1",
      parentId: "work-1",
      kind: "VOLUME",
      title: "1권",
      orderKey: 1024,
      documentId: null,
      createdAt: NOW,
      updatedAt: NOW
    },
    {
      id: "chapter-1",
      projectId: "project-1",
      parentId: "volume-1",
      kind: "CHAPTER",
      title: "1화",
      orderKey: 1024,
      documentId: null,
      createdAt: NOW,
      updatedAt: NOW
    },
    {
      id: "scene-1",
      projectId: "project-1",
      parentId: "chapter-1",
      kind: "SCENE",
      title: "성문 앞",
      orderKey: 1024,
      documentId: "document-scene-1",
      createdAt: NOW,
      updatedAt: NOW
    }
  ],
  revision: 1
};

const leia: EntityRecord = {
  id: "entity-leia",
  projectId: "project-1",
  kind: "CHARACTER",
  name: "레이아",
  summary: "북부의 마법사",
  documentId: "document-entity-leia",
  status: "ACTIVE",
  colorToken: null,
  iconKey: "person",
  attributes: {},
  duplicateName: false,
  createdAt: NOW,
  updatedAt: NOW
};

function loadedScene(revision: number): LoadedSceneDocument {
  return {
    sceneId: "scene-1",
    id: "document-scene-1",
    projectId: "project-1",
    title: "성문 앞",
    editorEngine: "typie",
    editorEngineCommit: "fixed-commit",
    editorSchemaVersion: 1,
    snapshot: Uint8Array.from([1, revision]),
    plainTextRecovery: "레이아는 문을 열었다.",
    revision,
    updatedAt: NOW
  };
}

function loadedEntity(revision: number): LoadedEntityNote {
  return {
    ownerKind: "ENTITY",
    ownerId: leia.id,
    id: leia.documentId,
    projectId: "project-1",
    title: leia.name,
    editorEngine: "typie",
    editorEngineCommit: "fixed-commit",
    editorSchemaVersion: 1,
    snapshot: Uint8Array.from([2, revision]),
    plainTextRecovery: "레이아 상세 노트",
    revision,
    updatedAt: NOW
  };
}

function createApi(calls: string[]): MadiDesktopApi {
  let revision = 1;
  return {
    ...phase1bApiStubs(),
    createProject: vi.fn(async () => null),
    openProject: vi.fn(async () => ({
      sessionId: "session-1",
      fileName: "닫힌성문.madi",
      projectId: "project-1",
      workNodeId: "work-1",
      sceneId: "scene-1",
      documentId: "document-scene-1",
      title: "닫힌 성문",
      revision
    })),
    saveDocument: vi.fn(async () => ({
      documentId: "document-scene-1",
      revision: ++revision,
      updatedAt: NOW
    })),
    loadDocument: vi.fn(async () => loadedScene(revision)),
    recoverPlainText: vi.fn(async () => ({
      documentId: "document-scene-1",
      plainText: "레이아는 문을 열었다.",
      revision
    })),
    getProjectTree: vi.fn(async () => ({ ...tree, revision })),
    createNode: vi.fn(async () => ({ ...tree, revision })),
    renameNode: vi.fn(async () => ({ ...tree, revision })),
    moveNode: vi.fn(async () => ({ ...tree, revision })),
    reorderNode: vi.fn(async () => ({ ...tree, revision })),
    deleteNode: vi.fn(async () => ({ ...tree, revision })),
    loadSceneDocument: vi.fn(async () => {
      calls.push("load-scene");
      return loadedScene(revision);
    }),
    saveSceneDocument: vi.fn(async (request) => ({
      sceneId: request.sceneId,
      documentId: request.documentId,
      revision: ++revision,
      updatedAt: NOW,
      generation: request.generation,
      saveSequence: request.saveSequence
    })),
    saveUiState: vi.fn(async () => undefined),
    loadUiState: vi.fn(async () => ({
      state: {
        selectedNodeId: "scene-1",
        expandedNodeIds: ["work-1"],
        binderWidth: 300
      }
    })),
    listDescendantScenes: vi.fn(async (request) => ({
      scopeNodeId: request.scopeNodeId,
      scenes: [],
      totalScenes: 0,
      offset: request.offset ?? 0,
      limit: request.limit ?? 200,
      nextOffset: null,
      hasMore: false,
      revision
    })),
    getTextStatistics: vi.fn(async (request) => ({
      scopeNodeId: request.scopeNodeId,
      sceneCount: 1,
      withSpaces: 12,
      withoutSpaces: 10,
      scenes: [],
      revision
    })),
    listEntities: vi.fn(async () => ({ entities: [leia], revision })),
    listEntityAliases: vi.fn(async () => ({
      aliases: [
        {
          id: "alias-leia",
          entityId: leia.id,
          alias: "리아",
          normalizedAlias: "리아",
          createdAt: NOW
        }
      ],
      revision
    })),
    listTags: vi.fn(async () => ({ tags: [], revision })),
    listEntityTags: vi.fn(async () => ({
      entityId: leia.id,
      tags: [],
      revision
    })),
    listRelationTypes: vi.fn(async () => ({ relationTypes: [], revision })),
    listEntityRelations: vi.fn(async () => ({ relations: [], revision })),
    listSceneEntityLinks: vi.fn(async () => ({
      links: [
        {
          sceneNodeId: "scene-1",
          entityId: leia.id,
          role: "POV" as const,
          note: null,
          createdAt: NOW
        }
      ],
      revision
    })),
    discoverEntityMentions: vi.fn(async (request) => ({
      entityId: leia.id,
      candidates: [
        {
          occurrenceId: "mention-1",
          entityId: leia.id,
          sceneNodeId: "scene-1",
          documentId: "document-scene-1",
          sceneTitle: "성문 앞",
          matchedAlias: "레이아",
          start: 0,
          end: 3,
          contextBefore: "",
          matchedText: "레이아",
          contextAfter: "는 문을 열었다.",
          alreadyLinked: true
        }
      ],
      totalScenes: 1,
      offset: request.offset ?? 0,
      limit: request.limit ?? 200,
      hasMore: false,
      revision
    })),
    loadEntityNote: vi.fn(async () => {
      calls.push("load-entity");
      return loadedEntity(revision);
    }),
    saveEntityNote: vi.fn(async (request) => {
      calls.push("save-entity");
      return {
        ownerKind: "ENTITY" as const,
        ownerId: request.ownerId,
        documentId: request.documentId,
        revision: ++revision,
        updatedAt: NOW,
        generation: request.generation,
        saveSequence: request.saveSequence
      };
    }),
    getAppVersion: vi.fn(async () => "0.0.1"),
    onCloseRequested: vi.fn(() => () => undefined),
    completeCloseRequest: vi.fn(async () => true)
  };
}

describe("Phase 1C App renderer integration", () => {
  it("switches one live Typie adapter between scene and entity owners with save-before-switch", async () => {
    const calls: string[] = [];
    const api = createApi(calls);
    const editor = new OwnerEditor();
    render(
      <App
        api={api}
        adapterFactory={vi.fn(async (mount) => {
          editor.relocate(mount);
          return editor;
        })}
        typieCommit="fixed-commit"
        editorSchemaVersion={1}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: ".madi 열기" }));
    await waitFor(() => expect(api.listEntities).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "설정" }));

    expect(await screen.findByRole("region", { name: "설정 작업 공간" })).toBeTruthy();
    await waitFor(() => {
      expect(
        screen.getByTestId("entity-note-editor-mount").contains(editor.surface)
      ).toBe(true);
    });
    expect(screen.getByDisplayValue("레이아")).toBeTruthy();
    expect(screen.getByText("리아")).toBeTruthy();
    expect(document.querySelectorAll("[data-testid='phase1c-typie-surface']")).toHaveLength(1);

    editor.plainText = "수정한 레이아 노트";
    editor.emitDirty();
    fireEvent.click(screen.getByRole("button", { name: "원고" }));
    await waitFor(() => expect(api.saveEntityNote).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("typie-editor-mount").contains(editor.surface)).toBe(true)
    );
    expect(calls.indexOf("save-entity")).toBeLessThan(calls.lastIndexOf("load-scene"));
  });
});
