import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readerControl = vi.hoisted(() => ({
  persistCalls: 0,
  persistImpl: async (): Promise<void> => undefined,
  preflightRevision: null as number | null,
  preflightCalls: 0,
  reloadTokens: [] as number[]
}));

vi.mock("../src/renderer/components/ReaderLabMode", async () => {
  const React = await import("react");
  const ReaderLabMode = React.forwardRef(function FakeReaderLabMode(
    props: any,
    ref
  ) {
    const [revision, setRevision] = React.useState<number | null>(null);
    React.useEffect(() => {
      readerControl.reloadTokens.push(props.reloadToken);
    }, [props.reloadToken]);
    React.useImperativeHandle(ref, () => ({
      async persistUiState() {
        readerControl.persistCalls += 1;
        await readerControl.persistImpl();
      },
      async refresh() {}
    }));
    return React.createElement(
      "section",
      { role: "region", "aria-label": "가짜 Reader Lab" },
      React.createElement(
        "button",
        {
          type: "button",
          onClick: async () => {
            readerControl.preflightCalls += 1;
            const next = await props.onBeforeCompile();
            readerControl.preflightRevision = next;
            setRevision(next);
          }
        },
        "가짜 Reader compile"
      ),
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () =>
            props.onOpenSource({
              sourceNodeId: "scene-1",
              sceneNodeId: "scene-1",
              documentId: "document-1",
              blockId: "source-block-1",
              start: 1,
              end: 4,
              rangeVerified: true
            })
        },
        "가짜 원고 위치 열기"
      ),
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () =>
            props.onOpenSource({
              sourceNodeId: "scene-1",
              sceneNodeId: "scene-1",
              documentId: "document-1",
              blockId: "empty-source-block",
              start: 4,
              end: 4,
              rangeVerified: true
            })
        },
        "가짜 빈 문단 위치 열기"
      ),
      React.createElement("output", { "data-testid": "preflight-revision" }, revision)
    );
  });
  return { ReaderLabMode };
});

import { App } from "../src/renderer/App";
import type {
  EditorChange,
  MadiEditorAdapter
} from "../src/renderer/editor/MadiEditorAdapter";
import type {
  LoadedSceneDocument,
  MadiDesktopApi,
  NamedSnapshotSummary,
  ProjectTree,
  SnapshotDiffSummary
} from "../src/shared/contracts";
import { phase1bApiStubs } from "./phase1b-api-stubs";

const NOW = "2026-08-09T00:00:00.000Z";
const REVISION = 5;

const readerSnapshot: NamedSnapshotSummary = {
  id: "snapshot-reader-1",
  projectId: "project-1",
  name: "Reader preset 복원 기준",
  note: null,
  kind: "MANUAL",
  payloadFormat: "madi-logical-project",
  payloadVersion: 4,
  payloadBytes: 1_024,
  contentHash: "a".repeat(64),
  createdAt: NOW,
  updatedAt: NOW
};

const emptySnapshotDiff: SnapshotDiffSummary = {
  added: { volumes: 0, chapters: 0, scenes: 0 },
  deleted: { volumes: 0, chapters: 0, scenes: 0 },
  renamedNodes: 0,
  reorderedNodes: 0,
  changedSceneBodies: 0,
  characterCountDelta: 0,
  addedEntities: 0,
  deletedEntities: 0,
  changedEntities: 0,
  addedTags: 0,
  deletedTags: 0,
  changedTags: 0,
  addedRelationTypes: 0,
  deletedRelationTypes: 0,
  changedRelationTypes: 0,
  addedRelations: 0,
  deletedRelations: 0,
  changedRelations: 0,
  changedSceneLinks: 0,
  changedEntityNotes: 0,
  addedCanvases: 0,
  deletedCanvases: 0,
  changedCanvases: 0,
  canvasNodeCountDelta: 0,
  canvasEdgeCountDelta: 0,
  addedReaderPresets: 0,
  deletedReaderPresets: 0,
  changedReaderPresets: 1,
  publicationMetadataChanged: false,
  coverChanged: false,
  addedExportPresets: 0,
  deletedExportPresets: 0,
  changedExportPresets: 0
};

class ReaderAppEditor implements MadiEditorAdapter {
  public readonly surface = document.createElement("div");
  public readonly revealed: Array<{ start: number; end: number }> = [];

  public async open(): Promise<void> {}
  public async getSnapshot(): Promise<Uint8Array> {
    return Uint8Array.from([1, 2, 3]);
  }
  public async getPlainText(): Promise<string> {
    return "Reader App 테스트 본문";
  }
  public relocate(element: HTMLElement): void {
    element.replaceChildren(this.surface);
  }
  public revealTextRange(
    start: number,
    end: number
  ): void {
    this.revealed.push({ start, end });
  }
  public focus(): void {}
  public undo(): void {}
  public redo(): void {}
  public insertSceneBreak(): void {}
  public onChanged(_listener: (change: EditorChange) => void): () => void {
    return () => undefined;
  }
}

const tree: ProjectTree = {
  project: {
    id: "project-1",
    title: "Reader App Test",
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
      title: "Reader App Test",
      orderKey: 1024,
      documentId: null,
      createdAt: NOW,
      updatedAt: NOW
    },
    {
      id: "chapter-1",
      projectId: "project-1",
      parentId: "work-1",
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
      title: "첫 장면",
      orderKey: 1024,
      documentId: "document-1",
      createdAt: NOW,
      updatedAt: NOW
    }
  ],
  revision: REVISION
};

function loadedScene(): LoadedSceneDocument {
  return {
    sceneId: "scene-1",
    id: "document-1",
    projectId: "project-1",
    title: "첫 장면",
    editorEngine: "typie",
    editorEngineCommit: "fixed-commit",
    editorSchemaVersion: 1,
    snapshot: Uint8Array.from([1, 2, 3]),
    plainTextRecovery: "Reader App 테스트 본문",
    revision: REVISION,
    updatedAt: NOW
  };
}

interface ReaderAppEnvironment {
  readonly api: MadiDesktopApi;
  readonly editor: ReaderAppEditor;
  requestClose(): void;
}

function createEnvironment(withSnapshot = false): ReaderAppEnvironment {
  let closeListener: (() => void) | null = null;
  const editor = new ReaderAppEditor();
  const api = {
    ...phase1bApiStubs(),
    createProject: vi.fn(async () => null),
    openProject: vi.fn(async () => ({
      sessionId: "session-1",
      fileName: "reader-app-test.madi",
      projectId: "project-1",
      workNodeId: "work-1",
      sceneId: "scene-1",
      documentId: "document-1",
      title: "Reader App Test",
      revision: REVISION
    })),
    saveDocument: vi.fn(async () => ({
      documentId: "document-1",
      revision: REVISION,
      updatedAt: NOW
    })),
    loadDocument: vi.fn(async () => loadedScene()),
    recoverPlainText: vi.fn(async () => ({
      documentId: "document-1",
      plainText: "Reader App 테스트 본문",
      revision: REVISION
    })),
    getProjectTree: vi.fn(async () => tree),
    createNode: vi.fn(async () => tree),
    renameNode: vi.fn(async () => tree),
    moveNode: vi.fn(async () => tree),
    reorderNode: vi.fn(async () => tree),
    deleteNode: vi.fn(async () => tree),
    loadSceneDocument: vi.fn(async () => loadedScene()),
    saveSceneDocument: vi.fn(async (request) => ({
      sceneId: request.sceneId,
      documentId: request.documentId,
      revision: REVISION,
      updatedAt: NOW,
      generation: request.generation,
      saveSequence: request.saveSequence
    })),
    saveUiState: vi.fn(async () => undefined),
    loadUiState: vi.fn(async () => ({
      state: {
        selectedNodeId: "scene-1",
        expandedNodeIds: ["work-1", "chapter-1"],
        binderWidth: 300
      }
    })),
    listEntities: vi.fn(async () => ({ entities: [], revision: REVISION })),
    listEntityAliases: vi.fn(async () => ({ aliases: [], revision: REVISION })),
    listTags: vi.fn(async () => ({ tags: [], revision: REVISION })),
    listRelationTypes: vi.fn(async () => ({ relationTypes: [], revision: REVISION })),
    listEntityRelations: vi.fn(async () => ({ relations: [], revision: REVISION })),
    listSceneEntityLinks: vi.fn(async () => ({ links: [], revision: REVISION })),
    loadWorldGraphUiState: vi.fn(async () => ({ state: null })),
    saveWorldGraphUiState: vi.fn(async () => undefined),
    listNamedSnapshots: vi.fn(async () => ({
      snapshots: withSnapshot ? [readerSnapshot] : [],
      revision: REVISION
    })),
    diffNamedSnapshot: vi.fn(async () => ({
      snapshot: readerSnapshot,
      summary: emptySnapshotDiff,
      revision: REVISION
    })),
    restoreNamedSnapshot: vi.fn(async () => ({
      restoredSnapshot: readerSnapshot,
      safetySnapshot: {
        ...readerSnapshot,
        id: "snapshot-reader-safety",
        name: "복원 전 자동 안전 snapshot",
        kind: "AUTO_BEFORE_RESTORE" as const
      },
      changesBeforeRestore: emptySnapshotDiff,
      revision: REVISION
    })),
    getAppVersion: vi.fn(async () => "0.0.1"),
    onCloseRequested: vi.fn((listener: () => void) => {
      closeListener = listener;
      return () => {
        if (closeListener === listener) {
          closeListener = null;
        }
      };
    }),
    completeCloseRequest: vi.fn(async () => true)
  } as unknown as MadiDesktopApi;
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
  return {
    api,
    editor,
    requestClose() {
      closeListener?.();
    }
  };
}

async function openReader(withSnapshot = false): Promise<ReaderAppEnvironment> {
  const environment = createEnvironment(withSnapshot);
  fireEvent.click(await screen.findByRole("button", { name: ".madi 열기" }));
  const readerButton = screen.getByRole("button", { name: "Reader Lab" });
  await waitFor(
    () => expect((readerButton as HTMLButtonElement).disabled).toBe(false),
    { timeout: 10_000 }
  );
  fireEvent.click(readerButton);
  await screen.findByRole("region", { name: "가짜 Reader Lab" });
  return environment;
}

describe("Phase 1F App Reader Lab lifecycle", () => {
  beforeEach(() => {
    readerControl.persistCalls = 0;
    readerControl.persistImpl = async () => undefined;
    readerControl.preflightRevision = null;
    readerControl.preflightCalls = 0;
    readerControl.reloadTokens = [];
  });

  it("enters the lazy mode, exposes authoritative post-flush revision, and opens source range", async () => {
    const { editor } = await openReader();
    const readerButton = screen.getByRole("button", { name: "Reader Lab" });
    expect(readerButton.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "가짜 Reader compile" }));
    await waitFor(() => expect(readerControl.preflightRevision).toBe(REVISION));
    expect(readerControl.preflightCalls).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "가짜 원고 위치 열기" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "원고" }).getAttribute("aria-pressed")
      ).toBe("true")
    );
    expect(readerControl.persistCalls).toBe(1);
    expect(editor.revealed).toEqual([{ start: 1, end: 4 }]);
  });

  it("fails closed when Reader UI state cannot persist on transition or close", async () => {
    const environment = await openReader();
    readerControl.persistImpl = async () => {
      throw new Error("private detail must not surface");
    };

    fireEvent.click(screen.getByRole("button", { name: "원고" }));
    await waitFor(() => expect(readerControl.persistCalls).toBe(1));
    expect(
      screen
        .getByRole("button", { name: "Reader Lab" })
        .getAttribute("aria-pressed")
    ).toBe("true");

    environment.requestClose();
    await waitFor(() =>
      expect(environment.api.completeCloseRequest).toHaveBeenCalledWith({
        readyToClose: false
      })
    );
    expect(readerControl.persistCalls).toBe(2);
    expect(document.documentElement.inert).not.toBe(true);
  });

  it("passes a verified empty-block caret range to the Typie adapter", async () => {
    const { editor } = await openReader();
    fireEvent.click(
      screen.getByRole("button", { name: "가짜 빈 문단 위치 열기" })
    );
    await waitFor(() => expect(editor.revealed).toEqual([{ start: 4, end: 4 }]));
  });

  it("revalidates Reader presets after a named snapshot v4 restore", async () => {
    const { api } = await openReader(true);
    await waitFor(() => expect(readerControl.reloadTokens).toEqual([0]));

    fireEvent.click(screen.getByRole("button", { name: "Snapshot" }));
    await screen.findByRole("complementary", { name: "Named snapshot" });
    fireEvent.click(
      await screen.findByRole("button", {
        name: `${readerSnapshot.name} 복원`
      })
    );
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", {
      name: "안전 snapshot 생성 후 복원"
    }) as HTMLButtonElement;
    await waitFor(() => expect(confirm.disabled).toBe(false));
    fireEvent.click(confirm);

    await waitFor(() => expect(api.restoreNamedSnapshot).toHaveBeenCalled());
    await waitFor(() => expect(readerControl.reloadTokens).toEqual([0, 1]));
    expect(
      screen.getByRole("button", { name: "Reader Lab" }).getAttribute("aria-pressed")
    ).toBe("true");
  });

  it("keeps the committed restore and Reader reload when ancillary UI reload fails", async () => {
    const { api } = await openReader(true);
    await waitFor(() => expect(readerControl.reloadTokens).toEqual([0]));
    vi.mocked(api.listEntities).mockReset();
    vi.mocked(api.listEntities)
      .mockResolvedValueOnce({ entities: [], revision: REVISION })
      .mockRejectedValueOnce(new Error("private ancillary failure"));

    fireEvent.click(screen.getByRole("button", { name: "Snapshot" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: `${readerSnapshot.name} 복원`
      })
    );
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", {
      name: "안전 snapshot 생성 후 복원"
    }) as HTMLButtonElement;
    await waitFor(() => expect(confirm.disabled).toBe(false));
    fireEvent.click(confirm);

    await waitFor(() => expect(api.restoreNamedSnapshot).toHaveBeenCalled());
    await waitFor(() => expect(readerControl.reloadTokens).toEqual([0, 1]));
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("alert")
          .some((alert) =>
            alert.textContent?.includes("Snapshot 복원은 완료됐지만")
          )
      ).toBe(true)
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Reader Lab" }).getAttribute("aria-pressed")
    ).toBe("true");
  });
});
