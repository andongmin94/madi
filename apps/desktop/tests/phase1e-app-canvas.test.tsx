import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ChangeEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const canvasControl = vi.hoisted(() => ({
  flushCalls: 0,
  flushImpl: async (): Promise<void> => undefined,
  onLayoutMount: null as (() => void) | null,
  pendingEntityIds: [] as string[],
  targetCanvasIds: [] as string[]
}));

vi.mock("../src/renderer/components/PlotCanvasMode", async () => {
  const React = await import("react");
  const PlotCanvasMode = React.forwardRef(function FakePlotCanvasMode(
    props: any,
    ref
  ) {
    const [targetCanvasId, setTargetCanvasId] = React.useState("canvas-a");
    React.useImperativeHandle(ref, () => ({
      async flush() {
        canvasControl.flushCalls += 1;
        await canvasControl.flushImpl();
      }
    }));
    React.useLayoutEffect(() => {
      const onLayoutMount = canvasControl.onLayoutMount;
      canvasControl.onLayoutMount = null;
      onLayoutMount?.();
    }, []);
    return React.createElement(
      "section",
      {
        role: "region",
        "aria-label": "가짜 App Plot Canvas",
        "data-pending-entity-id": props.pendingEntityId ?? "",
        "data-interaction-blocked": String(Boolean(props.interactionBlocked))
      },
      "Canvas integration boundary",
      props.pendingEntityId
        ? React.createElement(
            "section",
            {
              role: "dialog",
              "aria-label": "가짜 대상 Canvas 선택"
            },
            React.createElement(
              "select",
              {
                "aria-label": "가짜 대상 Canvas",
                value: targetCanvasId,
                onChange: (event: ChangeEvent<HTMLSelectElement>) =>
                  setTargetCanvasId(event.currentTarget.value)
              },
              React.createElement("option", { value: "canvas-a" }, "전체 플롯"),
              React.createElement("option", { value: "canvas-b" }, "결말 후보")
            ),
            React.createElement(
              "button",
              {
                type: "button",
                onClick: () => {
                  canvasControl.pendingEntityIds.push(props.pendingEntityId);
                  canvasControl.targetCanvasIds.push(targetCanvasId);
                  props.onPendingEntityHandled(props.pendingEntityId, true);
                }
              },
              "가짜 대상에 추가"
            )
          )
        : null
    );
  });
  return { PlotCanvasMode };
});

vi.mock(
  "../src/renderer/components/worldGraph/WorldGraphWorkspace",
  async () => {
    const React = await import("react");
    function WorldGraphWorkspace(props: any) {
      return React.createElement(
        "section",
        { role: "region", "aria-label": "가짜 App Graph" },
        React.createElement(
          "button",
          {
            type: "button",
            onClick: () => props.onAddEntityToCanvas?.("entity-1")
          },
          "그래프 설정을 캔버스에 추가"
        )
      );
    }
    return { WorldGraphWorkspace };
  }
);

import { App } from "../src/renderer/App";
import type {
  EditorChange,
  EditorReplacementDocument,
  EditorTextReplacement,
  MadiEditorAdapter
} from "../src/renderer/editor/MadiEditorAdapter";
import type {
  EntityRecord,
  LoadedEntityNote,
  LoadedSceneDocument,
  MadiDesktopApi,
  NamedSnapshotSummary,
  ProjectTree,
  SnapshotDiffSummary,
  WorldGraphReadModel
} from "../src/shared/contracts";
import { phase1bApiStubs } from "./phase1b-api-stubs";

const NOW = "2026-08-08T00:00:00.000Z";
const REVISION = 5;
const CANVAS_TRANSITION_TIMEOUT_MS = 10_000;

const manualSnapshot: NamedSnapshotSummary = {
  id: "snapshot-canvas-1",
  projectId: "project-1",
  name: "Canvas 복원 기준",
  note: null,
  kind: "MANUAL",
  payloadFormat: "madi-logical-project",
  payloadVersion: 1,
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
  changedReaderPresets: 0
};

class CanvasAppEditor implements MadiEditorAdapter {
  public readonly surface = document.createElement("div");

  public async open(): Promise<void> {}
  public async getSnapshot(): Promise<Uint8Array> {
    return Uint8Array.from([1, 2, 3]);
  }
  public async getPlainText(): Promise<string> {
    return "캔버스 앱 테스트 본문";
  }
  public relocate(element: HTMLElement): void {
    element.replaceChildren(this.surface);
  }
  public revealTextRange(): void {}
  public async replaceTextRanges(
    _replacements: readonly EditorTextReplacement[]
  ): Promise<EditorReplacementDocument> {
    return {
      snapshot: Uint8Array.from([4, 5, 6]),
      plainTextRecovery: "치환된 캔버스 앱 테스트 본문",
      semanticSceneBreakCount: 0
    };
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
    title: "Canvas App Test",
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
      title: "Canvas App Test",
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

const entity: EntityRecord = {
  id: "entity-1",
  projectId: "project-1",
  kind: "CHARACTER",
  name: "레이아",
  summary: "북부 출신 마법사",
  documentId: "entity-document-1",
  status: "ACTIVE",
  colorToken: null,
  iconKey: null,
  attributes: {},
  duplicateName: false,
  createdAt: NOW,
  updatedAt: NOW
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
    plainTextRecovery: "캔버스 앱 테스트 본문",
    revision: REVISION,
    updatedAt: NOW
  };
}

function loadedEntityNote(): LoadedEntityNote {
  return {
    ownerKind: "ENTITY",
    ownerId: entity.id,
    id: entity.documentId,
    projectId: entity.projectId,
    title: entity.name,
    editorEngine: "typie",
    editorEngineCommit: "fixed-commit",
    editorSchemaVersion: 1,
    snapshot: Uint8Array.from([7, 8, 9]),
    plainTextRecovery: "레이아 상세 노트",
    revision: REVISION,
    updatedAt: NOW
  };
}

function graphModel(): WorldGraphReadModel {
  return {
    projectId: "project-1",
    revision: REVISION,
    nodes: [
      {
        id: entity.id,
        projectId: entity.projectId,
        label: entity.name,
        kind: entity.kind,
        status: entity.status,
        summary: entity.summary,
        colorToken: entity.colorToken,
        iconKey: entity.iconKey,
        aliases: [],
        tags: [],
        explicitSceneLinkCount: 0,
        outgoingRelationCount: 0,
        incomingRelationCount: 0,
        undirectedRelationCount: 0
      }
    ],
    edges: [],
    stats: {
      entityCount: 1,
      relationCount: 0,
      entityKindCounts: [
        { kind: "CHARACTER", count: 1 },
        { kind: "LOCATION", count: 0 },
        { kind: "ORGANIZATION", count: 0 },
        { kind: "ITEM", count: 0 },
        { kind: "EVENT", count: 0 },
        { kind: "WORLD_RULE", count: 0 },
        { kind: "FORESHADOWING", count: 0 },
        { kind: "OTHER", count: 0 }
      ],
      relationTypeCounts: [],
      topDegreeEntities: [],
      isolatedEntityCount: 1,
      directedRelationCount: 0,
      undirectedRelationCount: 0
    },
    diagnostics: []
  };
}

interface AppApiEnvironment {
  readonly api: MadiDesktopApi;
  requestClose(): void;
}

function createApi(): AppApiEnvironment {
  let closeListener: (() => void) | null = null;
  const api = {
    ...phase1bApiStubs(),
    createProject: vi.fn(async () => null),
    openProject: vi.fn(async () => ({
      sessionId: "session-1",
      fileName: "canvas-app-test.madi",
      projectId: "project-1",
      workNodeId: "work-1",
      sceneId: "scene-1",
      documentId: "document-1",
      title: "Canvas App Test",
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
      plainText: "캔버스 앱 테스트 본문",
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
        expandedNodeIds: ["work-1"],
        binderWidth: 300
      }
    })),
    listEntities: vi.fn(async () => ({ entities: [entity], revision: REVISION })),
    loadEntityNote: vi.fn(async () => loadedEntityNote()),
    saveEntityNote: vi.fn(async (request) => ({
      ownerKind: "ENTITY" as const,
      ownerId: request.ownerId,
      documentId: request.documentId,
      revision: REVISION,
      updatedAt: NOW,
      generation: request.generation,
      saveSequence: request.saveSequence
    })),
    listEntityAliases: vi.fn(async () => ({ aliases: [], revision: REVISION })),
    listTags: vi.fn(async () => ({ tags: [], revision: REVISION })),
    listEntityTags: vi.fn(async () => ({
      entityId: entity.id,
      tags: [],
      revision: REVISION
    })),
    listRelationTypes: vi.fn(async () => ({
      relationTypes: [],
      revision: REVISION
    })),
    listEntityRelations: vi.fn(async () => ({
      relations: [],
      revision: REVISION
    })),
    listSceneEntityLinks: vi.fn(async () => ({ links: [], revision: REVISION })),
    searchProject: vi.fn(async (request) => ({
      query: request.query,
      caseSensitive: request.caseSensitive,
      target: request.target,
      scopeNodeId: request.scopeNodeId ?? "work-1",
      totalMatches: 1,
      sceneCount: 1,
      offset: request.offset ?? 0,
      limit: request.limit ?? 100,
      hasMore: false,
      hits: [
        {
          occurrenceId: "scene-1:BODY:0:3",
          nodeId: "scene-1",
          sceneId: "scene-1",
          documentId: "document-1",
          nodeKind: "SCENE",
          nodeTitle: "첫 장면",
          field: "BODY",
          start: 0,
          end: 3,
          contextBefore: "",
          matchedText: "캔버스",
          contextAfter: " 앱 테스트 본문",
          sourceContentHash: "a".repeat(64)
        }
      ],
      revision: REVISION
    })),
    loadWorldGraphUiState: vi.fn(async () => ({ state: null })),
    saveWorldGraphUiState: vi.fn(async () => undefined),
    getWorldGraph: vi.fn(async () => graphModel()),
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
  return {
    api,
    requestClose() {
      closeListener?.();
    }
  };
}

function deferredVoid() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function deferredValue<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function renderApp(api: MadiDesktopApi): void {
  const editor = new CanvasAppEditor();
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
}

async function renderOpened(api: MadiDesktopApi): Promise<void> {
  renderApp(api);
  fireEvent.click(await screen.findByRole("button", { name: ".madi 열기" }));
  const canvasButton = screen.getByRole("button", { name: "캔버스" });
  await waitFor(
    () => expect((canvasButton as HTMLButtonElement).disabled).toBe(false),
    { timeout: CANVAS_TRANSITION_TIMEOUT_MS }
  );
}

async function openCanvas(api: MadiDesktopApi): Promise<void> {
  await renderOpened(api);
  const canvasButton = screen.getByRole("button", { name: "캔버스" });
  fireEvent.click(canvasButton);
  await waitFor(
    () => expect(canvasButton.getAttribute("aria-pressed")).toBe("true"),
    { timeout: CANVAS_TRANSITION_TIMEOUT_MS }
  );
  await screen.findByRole(
    "region",
    { name: "가짜 App Plot Canvas" },
    { timeout: CANVAS_TRANSITION_TIMEOUT_MS }
  );
}

beforeEach(() => {
  canvasControl.flushCalls = 0;
  canvasControl.flushImpl = async () => undefined;
  canvasControl.onLayoutMount = null;
  canvasControl.pendingEntityIds = [];
  canvasControl.targetCanvasIds = [];
});

afterEach(() => {
  document.documentElement.inert = false;
  delete document.documentElement.dataset.closePending;
});

describe("Phase 1E App canvas integration", { timeout: 25_000 }, () => {
  it("keeps mode switches disabled until the current project UI is restored", async () => {
    const { api } = createApi();
    const treeGate = deferredValue<ProjectTree>();
    vi.mocked(api.getProjectTree).mockImplementation(() => treeGate.promise);
    renderApp(api);

    fireEvent.click(await screen.findByRole("button", { name: ".madi 열기" }));
    await waitFor(
      () =>
        expect(screen.getByTestId("save-status").getAttribute("data-phase")).toBe(
          "saved"
        ),
      { timeout: CANVAS_TRANSITION_TIMEOUT_MS }
    );
    const canvasButton = screen.getByRole("button", { name: "캔버스" });
    expect((canvasButton as HTMLButtonElement).disabled).toBe(true);
    expect(canvasButton.getAttribute("aria-pressed")).toBe("false");

    treeGate.resolve(tree);
    await waitFor(
      () => expect((canvasButton as HTMLButtonElement).disabled).toBe(false),
      { timeout: CANVAS_TRANSITION_TIMEOUT_MS }
    );
  });

  it("keeps Canvas mounted until its flush finishes during a mode transition", async () => {
    const { api } = createApi();
    await openCanvas(api);
    const gate = deferredVoid();
    canvasControl.flushImpl = () => gate.promise;

    fireEvent.click(screen.getByRole("button", { name: "원고" }));
    await waitFor(() => expect(canvasControl.flushCalls).toBe(1));
    expect(screen.getByRole("region", { name: "가짜 App Plot Canvas" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "캔버스" }).getAttribute("aria-pressed")
    ).toBe("true");

    gate.resolve();
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "가짜 App Plot Canvas" })).toBeNull()
    );
    expect(
      screen.getByRole("button", { name: "원고" }).getAttribute("aria-pressed")
    ).toBe("true");
  });

  it("keeps Canvas mounted when an explicit transition flush fails", async () => {
    const { api } = createApi();
    await openCanvas(api);
    canvasControl.flushImpl = async () => {
      throw new Error("canvas disk full");
    };

    fireEvent.click(screen.getByRole("button", { name: "원고" }));

    await waitFor(() => expect(canvasControl.flushCalls).toBe(1));
    expect(screen.getByRole("region", { name: "가짜 App Plot Canvas" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "캔버스" }).getAttribute("aria-pressed")
    ).toBe("true");
  });

  it("flushes Canvas before acknowledging an application close", async () => {
    const environment = createApi();
    await openCanvas(environment.api);
    const gate = deferredVoid();
    canvasControl.flushImpl = () => gate.promise;

    environment.requestClose();
    await waitFor(() => expect(canvasControl.flushCalls).toBe(1));
    expect(environment.api.completeCloseRequest).not.toHaveBeenCalled();
    expect(document.documentElement.inert).toBe(true);
    expect(document.documentElement.dataset.closePending).toBe("true");

    gate.resolve();
    await waitFor(() =>
      expect(environment.api.completeCloseRequest).toHaveBeenCalledWith({
        readyToClose: true
      })
    );
  });

  it("rejects an immediate application close when the new Canvas flush fails", async () => {
    const environment = createApi();
    await renderOpened(environment.api);
    canvasControl.flushImpl = async () => {
      throw new Error("canvas close failed");
    };
    canvasControl.onLayoutMount = environment.requestClose;

    fireEvent.click(screen.getByRole("button", { name: "캔버스" }));
    await screen.findByRole("region", { name: "가짜 App Plot Canvas" });

    await waitFor(() =>
      expect(environment.api.completeCloseRequest).toHaveBeenCalledWith({
        readyToClose: false
      })
    );
    expect(canvasControl.flushCalls).toBe(1);
    expect(document.documentElement.dataset.closePending).toBeUndefined();
  });

  it("rejects a close when an earlier project transition becomes active before the acknowledgement", async () => {
    const environment = createApi();
    await openCanvas(environment.api);
    const transitionFlush = deferredVoid();
    const closeFlush = deferredVoid();
    const projectOpen = deferredValue<Awaited<
      ReturnType<MadiDesktopApi["openProject"]>
    >>();
    let flushSequence = 0;
    canvasControl.flushImpl = () => {
      flushSequence += 1;
      return flushSequence === 1 ? transitionFlush.promise : closeFlush.promise;
    };
    vi.mocked(environment.api.openProject).mockImplementation(
      () => projectOpen.promise
    );

    fireEvent.click(screen.getByRole("button", { name: ".madi 열기" }));
    await waitFor(() => expect(canvasControl.flushCalls).toBe(1));
    environment.requestClose();
    await waitFor(() => expect(canvasControl.flushCalls).toBe(2));
    expect(document.documentElement.inert).toBe(true);

    transitionFlush.resolve();
    await waitFor(() => expect(environment.api.openProject).toHaveBeenCalled());
    closeFlush.resolve();
    await waitFor(() =>
      expect(environment.api.completeCloseRequest).toHaveBeenCalledWith({
        readyToClose: false
      })
    );
    expect(document.documentElement.inert).toBe(false);
    expect(document.documentElement.dataset.closePending).toBeUndefined();

    projectOpen.resolve(null);
    await waitFor(() =>
      expect(screen.getByTestId("save-status").getAttribute("data-phase")).toBe(
        "saved"
      )
    );
    vi.mocked(environment.api.completeCloseRequest).mockClear();
    canvasControl.flushImpl = async () => undefined;
    environment.requestClose();
    await waitFor(() =>
      expect(environment.api.completeCloseRequest).toHaveBeenCalledWith({
        readyToClose: true
      })
    );
  });

  it("flushes before new/open and blocks both operations after a save failure", async () => {
    const { api } = createApi();
    await openCanvas(api);
    vi.mocked(api.createProject).mockClear();
    vi.mocked(api.openProject).mockClear();
    canvasControl.flushImpl = async () => {
      throw new Error("canvas transition failed");
    };

    fireEvent.click(screen.getByRole("button", { name: "새 프로젝트" }));
    await waitFor(() => expect(canvasControl.flushCalls).toBe(1));
    expect(api.createProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: ".madi 열기" }));
    await waitFor(() => expect(canvasControl.flushCalls).toBe(2));
    expect(api.openProject).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "가짜 App Plot Canvas" })).toBeTruthy();
  });

  it("routes Ctrl+S immediately after Canvas mounts only to the Canvas flush", async () => {
    const { api } = createApi();
    await renderOpened(api);
    vi.mocked(api.saveSceneDocument).mockClear();
    canvasControl.flushCalls = 0;
    canvasControl.onLayoutMount = () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "s",
          ctrlKey: true,
          bubbles: true,
          cancelable: true
        })
      );

    fireEvent.click(screen.getByRole("button", { name: "캔버스" }));
    await screen.findByRole("region", { name: "가짜 App Plot Canvas" });

    await waitFor(() => expect(canvasControl.flushCalls).toBe(1));
    expect(api.saveSceneDocument).not.toHaveBeenCalled();
  });

  it("flushes before semantic replacement and fails closed on Canvas save error", async () => {
    const { api } = createApi();
    await openCanvas(api);
    fireEvent.click(screen.getByRole("button", { name: "검색 · 치환" }));
    const query = await screen.findByRole("searchbox", {
      name: "찾을 문자열"
    });
    fireEvent.change(query, {
      target: { value: "캔버스" }
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));
    await screen.findByRole("button", {
      name: /본문 캔버스 앱 테스트 본문/
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "바꿀 문자열" }),
      {
      target: { value: "보드" }
      }
    );
    const apply = screen.getByRole("button", {
      name: "선택 항목 치환 적용"
    }) as HTMLButtonElement;
    await waitFor(() => expect(apply.disabled).toBe(false));
    canvasControl.flushCalls = 0;
    canvasControl.flushImpl = async () => {
      throw new Error("canvas replace flush failed");
    };

    fireEvent.click(apply);

    await waitFor(() => expect(canvasControl.flushCalls).toBe(1));
    expect(api.applyReplacementBatch).not.toHaveBeenCalled();
  });

  it("blocks Canvas interaction and mode transitions while snapshot preflush is pending", async () => {
    const { api } = createApi();
    await openCanvas(api);
    const gate = deferredVoid();
    canvasControl.flushImpl = async () => {
      await gate.promise;
      throw new Error("snapshot flush failed");
    };
    try {
      fireEvent.click(screen.getByRole("button", { name: "Snapshot" }));
      expect(
        await screen.findByRole("complementary", { name: "Named snapshot" })
      ).toBeTruthy();
      const snapshotName = await screen.findByRole("textbox", {
        name: "이름"
      });
      fireEvent.change(snapshotName, {
        target: { value: "Canvas 잠금 검증" }
      });
      fireEvent.click(
        screen.getByRole("button", {
          name: "현재 프로젝트 snapshot 생성"
        })
      );

      await waitFor(() => expect(canvasControl.flushCalls).toBe(1));
      await waitFor(() =>
        expect(
          screen
            .getByRole("region", { name: "가짜 App Plot Canvas" })
            .getAttribute("data-interaction-blocked")
        ).toBe("true")
      );
      expect(
        (screen.getByRole("button", { name: "원고" }) as HTMLButtonElement)
          .disabled
      ).toBe(true);
    } finally {
      gate.resolve();
      try {
        await waitFor(
          () =>
            expect(
              screen
                .getByRole("region", { name: "가짜 App Plot Canvas" })
                .getAttribute("data-interaction-blocked")
            ).toBe("false"),
          { timeout: 5_000 }
        );
      } finally {
        canvasControl.flushImpl = async () => undefined;
      }
    }

    await waitFor(() =>
      expect(
        screen
          .getAllByRole("alert")
          .some((alert) => alert.textContent?.includes("snapshot flush failed"))
      ).toBe(true)
    );
  }, 25_000);

  it("creates and restores a visible named snapshot without leaving Canvas", async () => {
    const { api } = createApi();
    let snapshots: readonly NamedSnapshotSummary[] = [];
    vi.mocked(api.listNamedSnapshots).mockImplementation(async () => ({
      snapshots,
      revision: REVISION
    }));
    vi.mocked(api.createNamedSnapshot).mockImplementation(async (request) => {
      const snapshot = {
        ...manualSnapshot,
        name: request.name,
        note: request.note ?? null
      };
      snapshots = [snapshot];
      return { snapshot, revision: REVISION };
    });
    vi.mocked(api.diffNamedSnapshot).mockResolvedValue({
      snapshot: manualSnapshot,
      summary: emptySnapshotDiff,
      revision: REVISION
    });
    vi.mocked(api.restoreNamedSnapshot).mockResolvedValue({
      restoredSnapshot: manualSnapshot,
      safetySnapshot: {
        ...manualSnapshot,
        id: "snapshot-canvas-safety",
        name: "복원 전 자동 안전 snapshot",
        kind: "AUTO_BEFORE_RESTORE"
      },
      changesBeforeRestore: emptySnapshotDiff,
      revision: REVISION
    });

    await openCanvas(api);
    fireEvent.click(screen.getByRole("button", { name: "Snapshot" }));
    const panel = await screen.findByRole("complementary", {
      name: "Named snapshot"
    });
    expect(panel).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox", { name: "이름" }), {
      target: { value: manualSnapshot.name }
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "현재 프로젝트 snapshot 생성"
      })
    );

    await waitFor(() =>
      expect(api.createNamedSnapshot).toHaveBeenCalledWith({
        sessionId: "session-1",
        name: manualSnapshot.name
      })
    );
    const restore = await screen.findByRole("button", {
      name: `${manualSnapshot.name} 복원`
    });
    fireEvent.click(restore);
    const dialog = await screen.findByRole("alertdialog");
    const confirmRestore = within(dialog).getByRole("button", {
      name: "안전 snapshot 생성 후 복원"
    }) as HTMLButtonElement;
    await waitFor(() => expect(confirmRestore.disabled).toBe(false));
    fireEvent.click(confirmRestore);

    await waitFor(() =>
      expect(api.restoreNamedSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-1",
          snapshotId: manualSnapshot.id
        })
      )
    );
    expect(
      screen.getByRole("region", { name: "가짜 App Plot Canvas" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "캔버스" }).getAttribute("aria-pressed")
    ).toBe("true");
  });

  it("keeps Story Bible relation controls uncovered for default and retained search panels", async () => {
    const { api } = createApi();
    await renderOpened(api);

    fireEvent.click(screen.getByRole("button", { name: "설정" }));
    await screen.findByRole("region", { name: "설정 작업 공간" });
    fireEvent.click(await screen.findByText("관계 타입 관리"));
    expect(
      screen.getByRole("textbox", { name: "관계 타입 이름" })
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "캔버스" }));
    await screen.findByRole(
      "region",
      { name: "가짜 App Plot Canvas" },
      { timeout: 5_000 }
    );
    fireEvent.click(screen.getByRole("button", { name: "검색 · 치환" }));
    expect(
      await screen.findByRole("searchbox", { name: "찾을 문자열" })
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "설정" }));
    await screen.findByRole("region", { name: "설정 작업 공간" });
    expect(
      screen.queryByRole("searchbox", { name: "찾을 문자열" })
    ).toBeNull();
    fireEvent.click(await screen.findByText("관계 타입 관리"));
    expect(
      screen.getByRole("textbox", { name: "관계 타입 이름" })
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "그래프" }));
    expect(
      await screen.findByRole("region", { name: "가짜 App Graph" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("searchbox", { name: "찾을 문자열" })
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "그래프 설정을 캔버스에 추가" })
    ).toBeTruthy();
  });

  it("carries only the selected entity id from Graph into the Canvas pending item", async () => {
    const { api } = createApi();
    await renderOpened(api);
    fireEvent.click(screen.getByRole("button", { name: "그래프" }));
    await screen.findByRole("region", { name: "가짜 App Graph" });

    fireEvent.click(
      screen.getByRole("button", { name: "그래프 설정을 캔버스에 추가" })
    );
    await screen.findByRole("region", { name: "가짜 App Plot Canvas" });
    const dialog = await screen.findByRole("dialog", {
      name: "가짜 대상 Canvas 선택"
    });
    expect(canvasControl.pendingEntityIds).toEqual([]);
    fireEvent.change(
      screen.getByRole("combobox", { name: "가짜 대상 Canvas" }),
      { target: { value: "canvas-b" } }
    );
    fireEvent.click(
      screen.getByRole("button", { name: "가짜 대상에 추가" })
    );
    await waitFor(() =>
      expect(canvasControl.pendingEntityIds).toEqual(["entity-1"])
    );
    expect(canvasControl.targetCanvasIds).toEqual(["canvas-b"]);
    expect(dialog).toBeTruthy();
    expect(api.createEntityRelation).not.toHaveBeenCalled();
    expect(api.updateEntityRelation).not.toHaveBeenCalled();
    expect(api.deleteEntityRelation).not.toHaveBeenCalled();
  });
});
