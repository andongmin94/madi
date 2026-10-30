import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  ProjectTree,
  TagRecord
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

describe("Story Bible tag rename integration", () => {
  const serina: EntityRecord = {
    ...leia,
    id: "entity-serina",
    name: "세리나",
    documentId: "document-entity-serina"
  };

  async function renderTagRenameApp(colorToken: string | null) {
    const tag: TagRecord = {
      id: "tag-shared",
      projectId: "project-1",
      name: "이전 태그",
      colorToken,
      createdAt: NOW,
      updatedAt: NOW
    };
    const keptTag: TagRecord = {
      ...tag,
      id: "tag-kept",
      name: "보존 태그",
      colorToken: null
    };
    const api: MadiDesktopApi = {
      ...createApi([]),
      listEntities: vi.fn(async () => ({ entities: [leia, serina], revision: 1 })),
      listTags: vi.fn(async () => ({ tags: [tag, keptTag], revision: 1 })),
      listEntityTags: vi.fn(async ({ entityId }) => ({
        entityId,
        tags: [tag, keptTag],
        revision: 1
      })),
      listEntityAliases: vi.fn(async () => ({ aliases: [], revision: 1 })),
      discoverEntityMentions: vi.fn(async ({ entityId }) => ({
        entityId,
        candidates: [],
        totalScenes: 0,
        offset: 0,
        limit: 200,
        hasMore: false,
        revision: 1
      })),
      searchEntities: vi.fn(async ({ query }) => ({
        query,
        hits: [],
        totalMatches: 0,
        offset: 0,
        limit: 200,
        hasMore: false,
        revision: 1
      })),
      loadEntityNote: vi.fn(async ({ ownerId }) => {
        const entity = ownerId === leia.id ? leia : serina;
        return {
          ...loadedEntity(1),
          ownerId: entity.id,
          id: entity.documentId,
          title: entity.name
        };
      }),
      updateTag: vi.fn(async ({ name }) => ({
        tag: { ...tag, name },
        revision: 2
      }))
    };
    const editor = new OwnerEditor();
    const adapterFactory = vi.fn(async (mount: HTMLElement) => {
      editor.relocate(mount);
      return editor;
    });
    render(
      <App
        api={api}
        adapterFactory={adapterFactory}
        typieCommit="fixed-commit"
        editorSchemaVersion={1}
      />
    );
    fireEvent.click(await screen.findByRole("button", { name: ".madi 열기" }));
    await waitFor(() => expect(api.listEntities).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "설정" }));
    const entries = await screen.findByRole("list", { name: "설정 엔트리" });
    await waitFor(() => {
      expect((screen.getByRole("checkbox", { name: tag.name }) as HTMLInputElement).checked)
        .toBe(true);
      expect(screen.getByTestId("entity-note-editor-mount").contains(editor.surface))
        .toBe(true);
    });
    fireEvent.click(within(entries).getByRole("button", { name: /세리나/ }));
    await waitFor(() => {
      expect(within(entries).getByRole("button", { name: /세리나/ })
        .getAttribute("aria-current")).toBe("true");
      expect((screen.getByRole("checkbox", { name: tag.name }) as HTMLInputElement).checked)
        .toBe(true);
      expect(screen.getByTestId("entity-note-editor-mount").getAttribute("data-owner-id"))
        .toBe(serina.id);
    });
    return { api, editor, adapterFactory, tag, keptTag, entries };
  }

  it.each(["blue", null])(
    "renames a shared tag with color %s while preserving links, selection and the editor",
    async (colorToken) => {
      const { api, editor, adapterFactory, tag, keptTag, entries } =
        await renderTagRenameApp(colorToken);
      const noteLoads = vi.mocked(api.loadEntityNote).mock.calls.length;
      const editorMount = screen.getByTestId("entity-note-editor-mount");
      fireEvent.click(screen.getByRole("button", { name: `${tag.name} 태그 이름 변경` }));
      fireEvent.change(screen.getByRole("textbox", { name: `${tag.name} 태그 이름` }), {
        target: { value: "수정 태그" }
      });
      fireEvent.click(screen.getByRole("button", { name: "태그 이름 저장" }));

      const filter = screen.getByRole("combobox", { name: "태그 필터" });
      await waitFor(() => {
        expect(api.updateTag).toHaveBeenCalledTimes(1);
        expect(api.updateTag).toHaveBeenCalledWith({
          sessionId: "session-1", tagId: tag.id, name: "수정 태그", colorToken
        });
        expect((screen.getByRole("checkbox", { name: "수정 태그" }) as HTMLInputElement).checked)
          .toBe(true);
        expect(within(filter).getByRole("option", { name: "수정 태그" })
          .getAttribute("value")).toBe(tag.id);
      });
      expect(within(filter).queryByRole("option", { name: tag.name })).toBeNull();
      expect((screen.getByRole("checkbox", { name: keptTag.name }) as HTMLInputElement).checked)
        .toBe(true);
      expect(within(filter).getByRole("option", { name: keptTag.name })
        .getAttribute("value")).toBe(keptTag.id);
      expect(api.createTag).not.toHaveBeenCalled();
      expect(api.deleteTag).not.toHaveBeenCalled();
      expect(api.setEntityTags).not.toHaveBeenCalled();
      expect(within(entries).getByRole("button", { name: /세리나/ })
        .getAttribute("aria-current")).toBe("true");
      expect((screen.getByRole("textbox", { name: "설정 이름" }) as HTMLInputElement).value)
        .toBe(serina.name);
      expect(screen.getByTestId("entity-note-editor-mount")).toBe(editorMount);
      expect(editorMount.contains(editor.surface)).toBe(true);
      expect(api.loadEntityNote).toHaveBeenCalledTimes(noteLoads);
      expect(adapterFactory).toHaveBeenCalledTimes(1);

      // Assert local cached tag names before the debounced backend search can run.
      const search = screen.getByRole("searchbox", { name: "설정 검색" });
      fireEvent.change(search, { target: { value: "수정 태그" } });
      expect(within(entries).getAllByRole("button")).toHaveLength(2);
      expect(within(entries).getByRole("button", { name: /레이아/ })).toBeTruthy();
      expect(within(entries).getByRole("button", { name: /세리나/ })).toBeTruthy();
      fireEvent.change(search, { target: { value: tag.name } });
      expect(within(entries).queryAllByRole("button")).toHaveLength(0);
      expect(api.searchEntities).not.toHaveBeenCalled();
      fireEvent.change(search, { target: { value: "" } });
    }
  );

  it("keeps renamed cached tags when an earlier entity mention request finishes later", async () => {
    const { api, tag, keptTag, entries } = await renderTagRenameApp("blue");
    const tagReads = vi.mocked(api.listEntityTags).mock.calls.length;
    const mentionReads = vi.mocked(api.discoverEntityMentions).mock.calls.length;
    const readyTagRead = Promise.resolve({
      entityId: leia.id,
      tags: [tag, keptTag],
      revision: 1
    });
    let finishMentions!: () => void;
    const pendingMentions = new Promise<
      Awaited<ReturnType<MadiDesktopApi["discoverEntityMentions"]>>
    >((resolve) => {
      finishMentions = () => resolve({
        entityId: leia.id,
        candidates: [],
        totalScenes: 0,
        offset: 0,
        limit: 200,
        hasMore: false,
        revision: 1
      });
    });
    vi.mocked(api.listEntityTags).mockReturnValueOnce(readyTagRead);
    vi.mocked(api.discoverEntityMentions).mockReturnValueOnce(pendingMentions);
    fireEvent.click(within(entries).getByRole("button", { name: /레이아/ }));
    await waitFor(() => {
      expect(within(entries).getByRole("button", { name: /레이아/ })
        .getAttribute("aria-current")).toBe("true");
      expect(api.listEntityTags).toHaveBeenCalledTimes(tagReads + 1);
      expect(api.listEntityTags).toHaveBeenLastCalledWith({
        sessionId: "session-1", entityId: leia.id
      });
      expect(api.discoverEntityMentions).toHaveBeenCalledTimes(mentionReads + 1);
      expect(api.discoverEntityMentions).toHaveBeenLastCalledWith(
        expect.objectContaining({ entityId: leia.id })
      );
    });
    await act(async () => { await readyTagRead; });

    fireEvent.click(screen.getByRole("button", { name: `${tag.name} 태그 이름 변경` }));
    fireEvent.change(screen.getByRole("textbox", { name: `${tag.name} 태그 이름` }), {
      target: { value: "수정 태그" }
    });
    fireEvent.click(screen.getByRole("button", { name: "태그 이름 저장" }));
    await waitFor(() => {
      expect(api.updateTag).toHaveBeenCalledTimes(1);
      expect((screen.getByRole("checkbox", { name: "수정 태그" }) as HTMLInputElement).checked)
        .toBe(true);
    });
    await act(async () => {
      finishMentions();
      await pendingMentions;
    });

    const search = screen.getByRole("searchbox", { name: "설정 검색" });
    fireEvent.change(search, { target: { value: "수정 태그" } });
    expect(within(entries).getAllByRole("button")).toHaveLength(2);
    expect(within(entries).getByRole("button", { name: /레이아/ })).toBeTruthy();
    expect(within(entries).getByRole("button", { name: /세리나/ })).toBeTruthy();
    fireEvent.change(search, { target: { value: tag.name } });
    expect(within(entries).queryAllByRole("button")).toHaveLength(0);
    expect(api.searchEntities).not.toHaveBeenCalled();
    expect(api.listEntityTags).toHaveBeenCalledTimes(tagReads + 1);
    fireEvent.change(search, { target: { value: "" } });
  });

  it("keeps the old tag, links, selected entity and editor when renaming fails", async () => {
    const { api, editor, adapterFactory, tag, entries } = await renderTagRenameApp("blue");
    vi.mocked(api.updateTag).mockRejectedValue(new Error("태그 이름 변경 실패"));
    const noteLoads = vi.mocked(api.loadEntityNote).mock.calls.length;
    const editorMount = screen.getByTestId("entity-note-editor-mount");
    fireEvent.click(screen.getByRole("button", { name: `${tag.name} 태그 이름 변경` }));
    fireEvent.change(screen.getByRole("textbox", { name: `${tag.name} 태그 이름` }), {
      target: { value: "수정 태그" }
    });
    fireEvent.click(screen.getByRole("button", { name: "태그 이름 저장" }));

    expect(await screen.findByText("태그 이름 변경 실패")).toBeTruthy();
    expect(api.updateTag).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("textbox", { name: `${tag.name} 태그 이름` }) as HTMLInputElement).value)
      .toBe("수정 태그");
    expect((screen.getByRole("button", { name: "태그 이름 저장" }) as HTMLButtonElement).disabled)
      .toBe(false);
    expect((screen.getByRole("checkbox", { name: tag.name }) as HTMLInputElement).checked)
      .toBe(true);
    const filter = screen.getByRole("combobox", { name: "태그 필터" });
    expect(within(filter).getByRole("option", { name: tag.name }).getAttribute("value"))
      .toBe(tag.id);
    expect(within(filter).queryByRole("option", { name: "수정 태그" })).toBeNull();
    expect(api.setEntityTags).not.toHaveBeenCalled();
    expect(within(entries).getByRole("button", { name: /세리나/ })
      .getAttribute("aria-current")).toBe("true");
    expect(screen.getByTestId("entity-note-editor-mount")).toBe(editorMount);
    expect(editorMount.contains(editor.surface)).toBe(true);
    expect(api.loadEntityNote).toHaveBeenCalledTimes(noteLoads);
    expect(adapterFactory).toHaveBeenCalledTimes(1);
    const search = screen.getByRole("searchbox", { name: "설정 검색" });
    fireEvent.change(search, { target: { value: tag.name } });
    expect(within(entries).getAllByRole("button")).toHaveLength(2);
    fireEvent.change(search, { target: { value: "수정 태그" } });
    expect(within(entries).queryAllByRole("button")).toHaveLength(0);
    expect(api.searchEntities).not.toHaveBeenCalled();
    fireEvent.change(search, { target: { value: "" } });
  });
});
