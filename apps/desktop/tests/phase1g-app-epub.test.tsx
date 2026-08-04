import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const epubControl = vi.hoisted(() => ({
  closeCalls: 0,
  closeImpl: async (): Promise<boolean> => true,
  prepareCalls: 0,
  prepareImpl: async (): Promise<boolean> => true,
  reloadTokens: [] as number[],
  canonicalTitles: [] as string[]
}));

vi.mock("../src/renderer/components/EpubExportMode", async () => {
  const React = await import("react");
  const EpubExportMode = React.forwardRef(function FakeEpubExportMode(
    props: any,
    ref
  ) {
    const [canonicalTitle, setCanonicalTitle] = React.useState("불러오는 중");
    const [result, setResult] = React.useState<string | null>(null);

    const reload = React.useCallback(async () => {
      const state = await props.api.getPublicationExportState({
        sessionId: props.sessionId
      });
      epubControl.canonicalTitles.push(state.metadata.publicationTitle);
      setCanonicalTitle(state.metadata.publicationTitle);
      setResult(null);
    }, [props.api, props.sessionId]);

    React.useEffect(() => {
      epubControl.reloadTokens.push(props.reloadToken);
      void reload();
    }, [props.reloadToken, reload]);

    React.useImperativeHandle(ref, () => ({
      async prepareToClose() {
        epubControl.closeCalls += 1;
        return epubControl.closeImpl();
      },
      async prepareToLeave() {
        epubControl.prepareCalls += 1;
        return epubControl.prepareImpl();
      },
      reload
    }));

    return React.createElement(
      "section",
      { role: "region", "aria-label": "가짜 EPUB 내보내기" },
      React.createElement(
        "button",
        { type: "button", onClick: () => setResult("이전 검증 결과") },
        "가짜 EPUB 결과 생성"
      ),
      React.createElement(
        "output",
        { "data-testid": "epub-canonical-title" },
        canonicalTitle
      ),
      result
        ? React.createElement(
            "output",
            { "data-testid": "epub-validation-result" },
            result
          )
        : null
    );
  });
  return { EpubExportMode };
});

import { App } from "../src/renderer/App";
import type {
  EditorChange,
  EditorReplacementDocument,
  EditorTextReplacement,
  MadiEditorAdapter
} from "../src/renderer/editor/MadiEditorAdapter";
import type {
  LoadedSceneDocument,
  MadiDesktopApi,
  NamedSnapshotSummary,
  ProjectTree,
  PublicationExportState,
  SearchHit,
  SearchProjectRequest,
  SnapshotDiffSummary
} from "../src/shared/contracts";
import { phase1bApiStubs } from "./phase1b-api-stubs";

const NOW = "2026-08-09T00:00:00.000Z";
const REVISION = 5;

const epubSnapshot: NamedSnapshotSummary = {
  id: "snapshot-epub-1",
  projectId: "project-1",
  name: "EPUB canonical 복원 기준",
  note: null,
  kind: "MANUAL",
  payloadFormat: "madi-logical-project",
  payloadVersion: 5,
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
  changedReaderPresets: 0,
  publicationMetadataChanged: false,
  coverChanged: false,
  addedExportPresets: 0,
  deletedExportPresets: 0,
  changedExportPresets: 0
};

const epubSearchHit: SearchHit = {
  occurrenceId: "scene-1:BODY:0:4",
  nodeId: "scene-1",
  sceneId: "scene-1",
  documentId: "document-1",
  nodeKind: "SCENE",
  nodeTitle: "첫 장면",
  field: "BODY",
  start: 0,
  end: 4,
  contextBefore: "",
  matchedText: "EPUB",
  contextAfter: " App 테스트 본문",
  sourceContentHash: "b".repeat(64)
};

class EpubAppEditor implements MadiEditorAdapter {
  public readonly surface = document.createElement("div");

  public async open(): Promise<void> {}
  public async getSnapshot(): Promise<Uint8Array> {
    return Uint8Array.from([1, 2, 3]);
  }
  public async getPlainText(): Promise<string> {
    return "EPUB App 테스트 본문";
  }
  public async replaceTextRanges(
    _replacements: readonly EditorTextReplacement[]
  ): Promise<EditorReplacementDocument> {
    return {
      snapshot: Uint8Array.from([1, 2, 3]),
      plainTextRecovery: "EPUB App 테스트 본문",
      semanticSceneBreakCount: 0
    };
  }
  public relocate(element: HTMLElement): void {
    element.replaceChildren(this.surface);
  }
  public revealTextRange(): void {}
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
    title: "EPUB App Test",
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
      title: "EPUB App Test",
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
    plainTextRecovery: "EPUB App 테스트 본문",
    revision: REVISION,
    updatedAt: NOW
  };
}

function publicationState(title: string): PublicationExportState {
  return {
    metadata: {
      projectId: "project-1",
      publicationTitle: title,
      creatorName: "작가",
      language: "ko",
      identifier: "urn:uuid:phase1g-app-test",
      publisher: null,
      description: null,
      rights: null,
      subjects: [],
      coverAssetId: null,
      createdAt: NOW,
      updatedAt: NOW
    },
    cover: null,
    presets: [],
    duplicatePresetNames: [],
    revision: REVISION
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

interface EpubAppEnvironment {
  readonly api: MadiDesktopApi;
  requestClose(): void;
}

function createEnvironment(withSnapshot = false): EpubAppEnvironment {
  let closeListener: (() => void) | null = null;
  let restored = false;
  const editor = new EpubAppEditor();
  const api = {
    ...phase1bApiStubs(),
    createProject: vi.fn(async () => null),
    openProject: vi.fn(async () => ({
      sessionId: "session-1",
      fileName: "epub-app-test.madi",
      projectId: "project-1",
      workNodeId: "work-1",
      sceneId: "scene-1",
      documentId: "document-1",
      title: "EPUB App Test",
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
      plainText: "EPUB App 테스트 본문",
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
      snapshots: withSnapshot ? [epubSnapshot] : [],
      revision: REVISION
    })),
    searchProject: vi.fn(async (request: SearchProjectRequest) => ({
      query: request.query,
      caseSensitive: request.caseSensitive,
      target: request.target,
      scopeNodeId: request.scopeNodeId ?? "work-1",
      totalMatches: 1,
      sceneCount: 1,
      offset: request.offset ?? 0,
      limit: request.limit ?? 100,
      hasMore: false,
      hits: [epubSearchHit],
      revision: REVISION
    })),
    applyReplacementBatch: vi.fn(async () => {
      throw new Error("EPUB replacement must remain blocked in this test");
    }),
    createNamedSnapshot: vi.fn(async () => ({
      snapshot: epubSnapshot,
      revision: REVISION
    })),
    diffNamedSnapshot: vi.fn(async () => ({
      snapshot: epubSnapshot,
      summary: emptySnapshotDiff,
      revision: REVISION
    })),
    restoreNamedSnapshot: vi.fn(async () => {
      restored = true;
      return {
        restoredSnapshot: epubSnapshot,
        safetySnapshot: {
          ...epubSnapshot,
          id: "snapshot-epub-safety",
          name: "복원 전 자동 안전 snapshot",
          kind: "AUTO_BEFORE_RESTORE" as const
        },
        changesBeforeRestore: emptySnapshotDiff,
        revision: REVISION
      };
    }),
    getPublicationExportState: vi.fn(async () =>
      publicationState(restored ? "복원된 출판 제목" : "현재 출판 제목")
    ),
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
    requestClose() {
      closeListener?.();
    }
  };
}

async function openEpub(withSnapshot = false): Promise<EpubAppEnvironment> {
  const environment = createEnvironment(withSnapshot);
  fireEvent.click(await screen.findByRole("button", { name: ".madi 열기" }));
  const epubButton = screen.getByRole("button", { name: "EPUB" });
  await waitFor(
    () => expect((epubButton as HTMLButtonElement).disabled).toBe(false),
    { timeout: 10_000 }
  );
  fireEvent.click(epubButton);
  await screen.findByRole("region", { name: "가짜 EPUB 내보내기" });
  await waitFor(() =>
    expect(screen.getByTestId("epub-canonical-title").textContent).toBe(
      "현재 출판 제목"
    )
  );
  return environment;
}

async function openRestoreConfirmation(): Promise<HTMLButtonElement> {
  fireEvent.click(screen.getByRole("button", { name: "Snapshot" }));
  await screen.findByRole("complementary", { name: "Named snapshot" });
  fireEvent.click(
    await screen.findByRole("button", { name: `${epubSnapshot.name} 복원` })
  );
  const dialog = await screen.findByRole("alertdialog");
  const confirm = within(dialog).getByRole("button", {
    name: "안전 snapshot 생성 후 복원"
  }) as HTMLButtonElement;
  await waitFor(() => expect(confirm.disabled).toBe(false));
  return confirm;
}

describe("Phase 1G App EPUB lifecycle", () => {
  beforeEach(() => {
    epubControl.closeCalls = 0;
    epubControl.closeImpl = async () => true;
    epubControl.prepareCalls = 0;
    epubControl.prepareImpl = async () => true;
    epubControl.reloadTokens = [];
    epubControl.canonicalTitles = [];
    document.documentElement.inert = false;
    delete document.documentElement.dataset.closePending;
  });

  it("waits for prepareToLeave before switching modes and fails closed on refusal", async () => {
    await openEpub();
    const pending = deferred<boolean>();
    epubControl.prepareImpl = () => pending.promise;

    fireEvent.click(screen.getByRole("button", { name: "원고" }));
    await waitFor(() => expect(epubControl.prepareCalls).toBe(1));
    expect(
      screen.getByRole("button", { name: "EPUB" }).getAttribute("aria-pressed")
    ).toBe("true");

    pending.resolve(true);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "원고" }).getAttribute("aria-pressed")
      ).toBe("true")
    );

    fireEvent.click(screen.getByRole("button", { name: "EPUB" }));
    await screen.findByRole("region", { name: "가짜 EPUB 내보내기" });
    epubControl.prepareImpl = async () => false;
    fireEvent.click(screen.getByRole("button", { name: "원고" }));
    await waitFor(() => expect(epubControl.prepareCalls).toBe(2));
    expect(
      screen.getByRole("button", { name: "EPUB" }).getAttribute("aria-pressed")
    ).toBe("true");
  });

  it("waits before creating a project and blocks opening another project on refusal", async () => {
    const { api } = await openEpub();
    const pending = deferred<boolean>();
    epubControl.prepareImpl = () => pending.promise;

    fireEvent.click(screen.getByRole("button", { name: "새 프로젝트" }));
    await waitFor(() => expect(epubControl.prepareCalls).toBe(1));
    expect(api.createProject).not.toHaveBeenCalled();

    pending.resolve(true);
    await waitFor(() => expect(api.createProject).toHaveBeenCalledTimes(1));

    epubControl.prepareImpl = async () => false;
    fireEvent.click(screen.getByRole("button", { name: ".madi 열기" }));
    await waitFor(() => expect(epubControl.prepareCalls).toBe(2));
    expect(api.openProject).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "EPUB" }).getAttribute("aria-pressed")
    ).toBe("true");
  });

  it("fails snapshot restore closed when prepareToLeave refuses", async () => {
    const { api } = await openEpub(true);
    const confirm = await openRestoreConfirmation();
    const prepareCallsBeforeRestore = epubControl.prepareCalls;
    const pending = deferred<boolean>();
    epubControl.prepareImpl = () => pending.promise;

    fireEvent.click(confirm);
    await waitFor(() =>
      expect(epubControl.prepareCalls).toBe(prepareCallsBeforeRestore + 1)
    );
    expect(api.restoreNamedSnapshot).not.toHaveBeenCalled();

    pending.resolve(false);
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("alert")
          .some((alert) =>
            alert.textContent?.includes(
              "EPUB metadata와 진행 중인 작업을 정리하지 못했습니다."
            )
          )
      ).toBe(true)
    );
    expect(api.restoreNamedSnapshot).not.toHaveBeenCalled();
    expect(epubControl.reloadTokens).toEqual([0]);
  });

  it("persists EPUB metadata before snapshot creation", async () => {
    const { api } = await openEpub(true);
    fireEvent.click(screen.getByRole("button", { name: "Snapshot" }));
    await screen.findByRole("complementary", { name: "Named snapshot" });
    fireEvent.change(screen.getByRole("textbox", { name: "이름" }), {
      target: { value: "EPUB metadata 포함" }
    });
    const pending = deferred<boolean>();
    epubControl.prepareImpl = () => pending.promise;

    fireEvent.click(
      screen.getByRole("button", { name: "현재 프로젝트 snapshot 생성" })
    );
    await waitFor(() => expect(epubControl.prepareCalls).toBe(1));
    expect(api.createNamedSnapshot).not.toHaveBeenCalled();

    pending.resolve(true);
    await waitFor(() => expect(api.createNamedSnapshot).toHaveBeenCalledTimes(1));
  });

  it("fails snapshot diff closed when EPUB metadata cannot be persisted", async () => {
    const { api } = await openEpub(true);
    fireEvent.click(screen.getByRole("button", { name: "Snapshot" }));
    await screen.findByRole("complementary", { name: "Named snapshot" });
    const item = screen
      .getByText(epubSnapshot.name)
      .closest<HTMLElement>("[data-snapshot-id]");
    if (!item) {
      throw new Error("snapshot item missing");
    }
    epubControl.prepareImpl = async () => false;

    fireEvent.click(within(item).getByRole("button", { name: "차이 보기" }));
    await waitFor(() => expect(epubControl.prepareCalls).toBe(1));
    expect(api.diffNamedSnapshot).not.toHaveBeenCalled();
  });

  it("fails semantic replacement closed when EPUB metadata cannot be persisted", async () => {
    const { api } = await openEpub();
    fireEvent.click(screen.getByRole("button", { name: "검색 · 치환" }));
    await screen.findByRole("complementary", {
      name: "프로젝트 검색 및 선택 치환"
    });
    fireEvent.change(screen.getByRole("searchbox", { name: "찾을 문자열" }), {
      target: { value: "EPUB" }
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));
    const selection = await screen.findByRole("checkbox", {
      name: "본문 일치: EPUB 선택"
    });
    await waitFor(() =>
      expect((selection as HTMLInputElement).checked).toBe(true)
    );
    fireEvent.change(screen.getByRole("textbox", { name: "바꿀 문자열" }), {
      target: { value: "전자책" }
    });
    const applyButton = screen.getByRole("button", {
      name: "선택 항목 치환 적용"
    }) as HTMLButtonElement;
    await waitFor(() => expect(applyButton.disabled).toBe(false));
    const prepareCallsBeforeApply = epubControl.prepareCalls;
    epubControl.prepareImpl = async () => false;

    fireEvent.click(applyButton);
    await waitFor(() =>
      expect(epubControl.prepareCalls).toBe(prepareCallsBeforeApply + 1)
    );
    expect(api.applyReplacementBatch).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "EPUB" }).getAttribute("aria-pressed")
    ).toBe("true");
  });

  it("acks close through prepareToClose without waiting for ordinary leave drain", async () => {
    const environment = await openEpub();
    const pendingLeave = deferred<boolean>();
    epubControl.prepareImpl = () => pendingLeave.promise;

    environment.requestClose();

    await waitFor(() =>
      expect(environment.api.completeCloseRequest).toHaveBeenCalledWith({
        readyToClose: true
      })
    );
    expect(epubControl.closeCalls).toBe(1);
    expect(epubControl.prepareCalls).toBe(0);
  });

  it("reports not-ready when prepareToClose refuses", async () => {
    const environment = await openEpub();
    const pending = deferred<boolean>();
    epubControl.closeImpl = () => pending.promise;

    environment.requestClose();
    await waitFor(() => expect(epubControl.closeCalls).toBe(1));
    expect(epubControl.prepareCalls).toBe(0);
    expect(environment.api.completeCloseRequest).not.toHaveBeenCalled();

    pending.resolve(false);
    await waitFor(() =>
      expect(environment.api.completeCloseRequest).toHaveBeenCalledWith({
        readyToClose: false
      })
    );
    expect(environment.api.completeCloseRequest).not.toHaveBeenCalledWith({
      readyToClose: true
    });
    expect(document.documentElement.inert).not.toBe(true);
  });

  it("reloads canonical EPUB state and clears stale results after snapshot restore", async () => {
    const { api } = await openEpub(true);
    fireEvent.click(screen.getByRole("button", { name: "가짜 EPUB 결과 생성" }));
    expect(screen.getByTestId("epub-validation-result").textContent).toBe(
      "이전 검증 결과"
    );

    const confirm = await openRestoreConfirmation();
    const prepareCallsBeforeRestore = epubControl.prepareCalls;
    const pending = deferred<boolean>();
    epubControl.prepareImpl = () => pending.promise;
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(epubControl.prepareCalls).toBe(prepareCallsBeforeRestore + 1)
    );
    expect(api.restoreNamedSnapshot).not.toHaveBeenCalled();

    pending.resolve(true);
    await waitFor(() => expect(api.restoreNamedSnapshot).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(epubControl.reloadTokens).toEqual([0, 1]));
    await waitFor(() =>
      expect(screen.getByTestId("epub-canonical-title").textContent).toBe(
        "복원된 출판 제목"
      )
    );
    expect(screen.queryByTestId("epub-validation-result")).toBeNull();
    expect(epubControl.canonicalTitles).toEqual([
      "현재 출판 제목",
      "복원된 출판 제목"
    ]);
    expect(
      screen.getByRole("button", { name: "EPUB" }).getAttribute("aria-pressed")
    ).toBe("true");
  });
});
