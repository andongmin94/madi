import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { createMadiDesktopApi } from "../src/preload/bridge";
import { EpubExportWorkspace } from "../src/renderer/components/epubExport/EpubExportWorkspace";
import type {
  PublicationExportModeHandle,
  PublicationExportModeProps
} from "../src/renderer/components/PublicationExportMode";
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  type ProjectTree
} from "../src/shared/contracts";
import { EPUB_RECOVERY_PRESERVED_ERROR } from "../src/shared/epubExport";
import type {
  CreateEpubExportPresetRequest,
  DeleteEpubExportPresetRequest,
  DuplicateEpubExportPresetRequest,
  EpubExportPresetConfig,
  EpubExportPresetRecord,
  EpubExportProgress,
  EpubExportReport,
  PublicationCoverAsset,
  PublicationExportMetadata,
  PublicationMetadataMutationResult,
  PublicationExportState,
  RunEpubExportRequest,
  RunEpubExportResult,
  UpdateEpubExportPresetRequest,
  UpdatePublicationMetadataRequest,
  ValidateEpubExportRequest,
  ValidateEpubExportResult
} from "../src/shared/epubExport";

const NOW = "2026-08-09T00:00:00.000Z";
const OPERATION_1 = "123e4567-e89b-42d3-a456-426614174000";
const OPERATION_2 = "123e4567-e89b-42d3-a456-426614174001";

const tree: ProjectTree = {
  project: {
    id: "project-1",
    title: "긴 밤의 문장",
    authorName: "마디 작가",
    createdAt: NOW,
    updatedAt: NOW
  },
  nodes: [
    {
      id: "work-1",
      projectId: "project-1",
      parentId: null,
      kind: "WORK",
      title: "긴 밤의 문장",
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
      title: "1장",
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
  revision: 7
};

const defaultConfig: EpubExportPresetConfig = {
  formatVersion: 1,
  targetProfile: "EPUB_3_4_DRAFT_2026_08",
  splitMode: "CHAPTER",
  tocDepth: 3,
  includeChapterTitles: true,
  includeSceneTitles: true,
  sceneBreakStyleToken: "ORNAMENT",
  bodyStyleToken: "REFLOWABLE_PROSE",
  includeCover: false,
  stylesheetToken: "MADI_CLASSIC"
};

function metadata(overrides: Partial<PublicationExportMetadata> = {}): PublicationExportMetadata {
  return {
    projectId: "project-1",
    publicationTitle: "긴 밤의 문장",
    creatorName: "마디 작가",
    language: "ko",
    identifier: "urn:madi:publication:project-1",
    publisher: null,
    description: null,
    rights: null,
    subjects: ["소설"],
    coverAssetId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function coverAsset(): PublicationCoverAsset {
  return {
    id: "cover-1",
    projectId: "project-1",
    kind: "COVER",
    mediaType: "image/png",
    originalName: "cover.png",
    sha256: "c".repeat(64),
    byteLength: 4096,
    width: 1600,
    height: 2560,
    createdAt: NOW,
    updatedAt: NOW
  };
}

function preset(
  id = "preset-1",
  name = "기존 설정",
  revision = 1,
  config: EpubExportPresetConfig = defaultConfig
): EpubExportPresetRecord {
  return {
    id,
    projectId: "project-1",
    kind: "EPUB",
    name,
    presetFormat: "MADI_EXPORT_PRESET",
    presetVersion: 1,
    config,
    contentHash: "a".repeat(64),
    revision,
    createdAt: NOW,
    updatedAt: NOW
  };
}

function report(
  profile: EpubExportPresetConfig["targetProfile"] = "EPUB_3_3_COMPATIBILITY"
): EpubExportReport {
  return {
    formatVersion: 1,
    targetProfile: profile,
    sourceProjectRevision: 9,
    sourcePublicationHash: "b".repeat(64),
    epubSha256: "d".repeat(64),
    logicalPackageHash: "e".repeat(64),
    byteLength: 12_345,
    fileCount: 8,
    xhtmlCount: 3,
    coverage: {
      sourceSectionCount: 2,
      exportedSectionCount: 2,
      sourceBlockCount: 10,
      exportedBlockCount: 10,
      fallbackBlockCount: 0,
      rejectedBlockCount: 0,
      sourceCharacterCount: 1200,
      exportedCharacterCount: 1200,
      sceneBreakCount: 1,
      rubyCount: 1,
      headingCount: 2
    },
    coverIncluded: true,
    validation: {
      status: "VALID",
      fatalCount: 0,
      errorCount: 0,
      warningCount: 0,
      infoCount: 1,
      messages: [
        {
          severity: "INFO",
          code: "MADI_EPUB_OK",
          description: "내부 구조 검증을 통과했습니다.",
          suggestion: null,
          sourceNodeId: "scene-1",
          sectionId: "section-1",
          epubPath: "EPUB/text/chapter-1.xhtml"
        }
      ],
      epubCheck: {
        status: profile === "EPUB_3_3_COMPATIBILITY" ? "VALID" : "NOT_RUN",
        version: profile === "EPUB_3_3_COMPATIBILITY" ? "5.3.0" : null,
        compatibilityOnly: profile === "EPUB_3_4_DRAFT_2026_08"
      }
    },
    timing: {
      splitMs: 1,
      xhtmlMs: 2,
      navigationMs: 1,
      packageMs: 3,
      internalValidationMs: 2,
      epubCheckMs: profile === "EPUB_3_3_COMPATIBILITY" ? 10 : null,
      totalMs: 19
    },
    generatedAt: NOW,
    madiVersion: "0.0.1"
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

interface HarnessOptions {
  readonly presets?: readonly EpubExportPresetRecord[];
  readonly getState?: () => Promise<PublicationExportState>;
  readonly beforeExport?: () => Promise<number | null>;
  readonly updateMetadata?: (
    request: UpdatePublicationMetadataRequest,
    currentState: PublicationExportState
  ) => Promise<PublicationMetadataMutationResult>;
  readonly validate?: (
    request: ValidateEpubExportRequest
  ) => Promise<ValidateEpubExportResult>;
  readonly run?: (request: RunEpubExportRequest) => Promise<RunEpubExportResult>;
}

function createHarness(options: HarnessOptions = {}) {
  let nextPresetNumber = 2;
  let currentState: PublicationExportState = {
    metadata: metadata(),
    cover: null,
    presets: options.presets ?? [],
    duplicatePresetNames: [],
    revision: 7
  };
  const eventListeners = new Map<string, (payload?: unknown) => void>();
  const subscribe = vi.fn(
    (channel: string, listener: (payload?: unknown) => void) => {
      eventListeners.set(channel, listener);
      return () => eventListeners.delete(channel);
    }
  );
  const invoke = vi.fn(async (channel: string, rawRequest?: unknown) => {
    switch (channel) {
      case IPC_CHANNELS.getPublicationExportState:
        return options.getState ? options.getState() : currentState;
      case IPC_CHANNELS.updatePublicationMetadata: {
        const request = rawRequest as UpdatePublicationMetadataRequest;
        if (options.updateMetadata) {
          const result = await options.updateMetadata(request, currentState);
          currentState = {
            ...currentState,
            metadata: result.metadata,
            revision: result.revision
          };
          return result;
        }
        const revision = currentState.revision + 1;
        const nextMetadata = metadata({
          ...request,
          projectId: currentState.metadata.projectId,
          coverAssetId: currentState.metadata.coverAssetId,
          createdAt: currentState.metadata.createdAt,
          updatedAt: NOW
        });
        currentState = { ...currentState, metadata: nextMetadata, revision };
        return { metadata: nextMetadata, revision, noOp: false };
      }
      case IPC_CHANNELS.choosePublicationCover: {
        const cover = coverAsset();
        const revision = currentState.revision + 1;
        const nextMetadata = metadata({
          ...currentState.metadata,
          coverAssetId: cover.id
        });
        currentState = {
          ...currentState,
          cover,
          metadata: nextMetadata,
          revision
        };
        return { cover, metadata: nextMetadata, revision, noOp: false };
      }
      case IPC_CHANNELS.removePublicationCover: {
        const revision = currentState.revision + 1;
        const nextMetadata = metadata({
          ...currentState.metadata,
          coverAssetId: null
        });
        currentState = {
          ...currentState,
          cover: null,
          metadata: nextMetadata,
          revision
        };
        return { cover: null, metadata: nextMetadata, revision, noOp: false };
      }
      case IPC_CHANNELS.createEpubExportPreset: {
        const request = rawRequest as CreateEpubExportPresetRequest;
        const created = preset(
          `preset-${nextPresetNumber++}`,
          request.name,
          1,
          request.config
        );
        const revision = currentState.revision + 1;
        currentState = {
          ...currentState,
          presets: [...currentState.presets, created],
          revision
        };
        return { preset: created, revision, noOp: false };
      }
      case IPC_CHANNELS.updateEpubExportPreset: {
        const request = rawRequest as UpdateEpubExportPresetRequest;
        const updated = preset(
          request.presetId,
          request.name,
          request.expectedPresetRevision + 1,
          request.config
        );
        const revision = currentState.revision + 1;
        currentState = {
          ...currentState,
          presets: currentState.presets.map((item) =>
            item.id === updated.id ? updated : item
          ),
          revision
        };
        return { preset: updated, revision, noOp: false };
      }
      case IPC_CHANNELS.duplicateEpubExportPreset: {
        const request = rawRequest as DuplicateEpubExportPresetRequest;
        const source = currentState.presets.find(
          (item) => item.id === request.sourcePresetId
        )!;
        const duplicated = preset(
          `preset-${nextPresetNumber++}`,
          request.name ?? `${source.name} 복사본`,
          1,
          source.config
        );
        const revision = currentState.revision + 1;
        currentState = {
          ...currentState,
          presets: [...currentState.presets, duplicated],
          revision
        };
        return { preset: duplicated, revision, noOp: false };
      }
      case IPC_CHANNELS.deleteEpubExportPreset: {
        const request = rawRequest as DeleteEpubExportPresetRequest;
        const revision = currentState.revision + 1;
        currentState = {
          ...currentState,
          presets: currentState.presets.filter(
            (item) => item.id !== request.presetId
          ),
          revision
        };
        return { deletedPresetId: request.presetId, revision };
      }
      case IPC_CHANNELS.chooseEpubOutput:
        return { selectionId: "output-1", fileName: "긴 밤의 문장.epub" };
      case IPC_CHANNELS.validateEpubExport: {
        const request = rawRequest as ValidateEpubExportRequest;
        return options.validate
          ? options.validate(request)
          : {
              operationId: request.operationId,
              sourcePublicationHash: "b".repeat(64),
              report: report(request.config.targetProfile),
              revision: request.expectedProjectRevision
            };
      }
      case IPC_CHANNELS.runEpubExport: {
        const request = rawRequest as RunEpubExportRequest;
        return options.run
          ? options.run(request)
          : {
              status: "COMPLETED",
              operationId: request.operationId,
              fileName: "긴 밤의 문장.epub",
              byteLength: 12_345,
              sha256: "d".repeat(64),
              report: report(request.config.targetProfile),
              revision: request.expectedProjectRevision
            };
      }
      case IPC_CHANNELS.cancelEpubExport:
      case IPC_CHANNELS.revealEpubExport:
        return true;
      case IPC_CHANNELS.saveEpubExportReport:
        return { fileName: "긴 밤의 문장-report.json", byteLength: 2048 };
      default:
        throw new Error(`Unexpected IPC channel: ${channel}`);
    }
  });
  const api = createMadiDesktopApi(invoke, subscribe);
  const onBeforeExport = vi.fn(
    options.beforeExport ?? (async () => currentState.revision)
  );
  const onProjectRevision = vi.fn();
  const onOpenSource = vi.fn();
  const onOperationBusyChange = vi.fn();

  return {
    api,
    invoke,
    onBeforeExport,
    onProjectRevision,
    onOpenSource,
    onOperationBusyChange,
    setState(next: PublicationExportState) {
      currentState = next;
    },
    getState() {
      return currentState;
    },
    callsFor(channel: string) {
      return invoke.mock.calls.filter(([calledChannel]) => calledChannel === channel);
    },
    emitProgress(progress: EpubExportProgress) {
      eventListeners.get(IPC_EVENTS.epubExportProgress)?.(progress);
    }
  };
}

function renderWorkspace(
  harness = createHarness(),
  overrides: Partial<PublicationExportModeProps> & {
    readonly ref?: ReturnType<typeof createRef<PublicationExportModeHandle>>;
  } = {}
) {
  const props: PublicationExportModeProps = {
    api: harness.api,
    sessionId: "session-1",
    projectId: "project-1",
    projectRevision: 7,
    projectTree: tree,
    initialScopeNodeId: "work-1",
    reloadToken: 0,
    interactionBlocked: false,
    onBeforeExport: harness.onBeforeExport,
    onProjectRevision: harness.onProjectRevision,
    onOpenSource: harness.onOpenSource,
    onOperationBusyChange: harness.onOperationBusyChange,
    ...overrides
  };
  const rendered = render(
    <EpubExportWorkspace ref={overrides.ref} {...props} />
  );
  return {
    ...rendered,
    harness,
    rerenderWorkspace(next: Partial<PublicationExportModeProps>) {
      Object.assign(props, next);
      rendered.rerender(
        <EpubExportWorkspace ref={overrides.ref} {...props} />
      );
    }
  };
}

describe("Phase 1G EPUB export workspace", () => {
  it("recovers from an initial export-state load failure", async () => {
    let attempts = 0;
    const recoveredState: PublicationExportState = {
      metadata: metadata(),
      cover: null,
      presets: [],
      duplicatePresetNames: [],
      revision: 7
    };
    const harness = createHarness({
      getState: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("transient");
        }
        return recoveredState;
      }
    });
    renderWorkspace(harness);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "출판 metadata와 EPUB preset을 불러오지 못했습니다."
    );
    expect(screen.getByRole("button", { name: "다시 불러오기" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    expect(await screen.findByLabelText("profile")).toBeTruthy();
    expect(attempts).toBe(2);
  });

  it.each(["prepareToClose", "prepareToLeave"] as const)(
    "drains a pending reloadToken load before %s resolves true",
    async (method) => {
      const reload = deferred<PublicationExportState>();
      let attempts = 0;
      const loadedState: PublicationExportState = {
        metadata: metadata(),
        cover: null,
        presets: [],
        duplicatePresetNames: [],
        revision: 7
      };
      const harness = createHarness({
        getState: async () => {
          attempts += 1;
          return attempts === 1 ? loadedState : reload.promise;
        }
      });
      const handle = createRef<PublicationExportModeHandle>();
      const view = renderWorkspace(harness, { ref: handle });
      await screen.findByLabelText("profile");

      view.rerenderWorkspace({ reloadToken: 1 });
      await waitFor(() => expect(attempts).toBe(2));
      const preparation = handle.current![method]();
      let ready: boolean | undefined;
      void preparation.then((result) => {
        ready = result;
      });

      await act(async () => {
        await handle.current!.reload();
        view.rerenderWorkspace({ reloadToken: 2 });
        await Promise.resolve();
      });
      expect(attempts).toBe(2);
      expect(ready).toBeUndefined();

      await act(async () => {
        reload.resolve({ ...loadedState, revision: 8 });
        await preparation;
      });
      expect(ready).toBe(true);
    }
  );

  it.each(["prepareToClose", "prepareToLeave"] as const)(
    "fails %s closed when its pending current reload fails, then permits recovery",
    async (method) => {
      const reload = deferred<PublicationExportState>();
      let attempts = 0;
      const loadedState: PublicationExportState = {
        metadata: metadata(),
        cover: null,
        presets: [],
        duplicatePresetNames: [],
        revision: 7
      };
      const harness = createHarness({
        getState: async () => {
          attempts += 1;
          if (attempts === 1 || attempts === 3) {
            return loadedState;
          }
          return reload.promise;
        }
      });
      const handle = createRef<PublicationExportModeHandle>();
      const view = renderWorkspace(harness, { ref: handle });
      await screen.findByLabelText("profile");

      view.rerenderWorkspace({ reloadToken: 1 });
      await waitFor(() => expect(attempts).toBe(2));
      const preparation = handle.current![method]();
      await act(async () => {
        reload.reject(new Error("fixture reload failure"));
        await expect(preparation).resolves.toBe(false);
      });
      expect(screen.getByRole("alert").textContent).toContain(
        "출판 metadata와 EPUB preset을 불러오지 못했습니다."
      );

      await act(async () => {
        await handle.current!.reload();
      });
      expect(attempts).toBe(3);
      expect(
        screen.queryByText("출판 metadata와 EPUB preset을 불러오지 못했습니다.")
      ).toBeNull();
    }
  );

  it("does not issue hidden export-state IPC after close approval", async () => {
    const handle = createRef<PublicationExportModeHandle>();
    const view = renderWorkspace(createHarness(), { ref: handle });
    await screen.findByLabelText("profile");
    await expect(handle.current!.prepareToClose()).resolves.toBe(true);
    const loadCount = view.harness.callsFor(
      IPC_CHANNELS.getPublicationExportState
    ).length;

    await act(async () => {
      await handle.current!.reload();
      view.rerenderWorkspace({ reloadToken: 1 });
      await Promise.resolve();
    });
    expect(
      view.harness.callsFor(IPC_CHANNELS.getPublicationExportState)
    ).toHaveLength(loadCount);
  });

  it("labels EPUB 3.4 as a draft and EPUB 3.3 as the stable compatibility path", async () => {
    renderWorkspace();

    expect(await screen.findByText(/Candidate Recommendation Draft/u)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("profile"), {
      target: { value: "EPUB_3_3_COMPATIBILITY" }
    });

    expect(
      screen.getByText(/안정 규격과 EPUBCheck 5\.3\.0 production validator/u)
    ).toBeTruthy();
    expect(
      screen
        .getByLabelText("EPUB 실행")
        .closest("section")
        ?.parentElement?.getAttribute("data-epub-profile")
    ).toBe("EPUB_3_3_COMPATIBILITY");
  });

  it("blocks invalid metadata before invoking the mutation boundary", async () => {
    const { harness } = renderWorkspace();
    const creator = await screen.findByLabelText("작가");

    fireEvent.change(creator, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "metadata 저장" }));

    expect(
      (await screen.findByText(/제목·작가·언어·식별자를 확인/u)).getAttribute(
        "role"
      )
    ).toBe("alert");
    expect(harness.callsFor(IPC_CHANNELS.updatePublicationMetadata)).toHaveLength(0);
  });

  it("creates, updates, duplicates, and deletes project-local EPUB presets", async () => {
    const harness = createHarness({ presets: [preset()] });
    renderWorkspace(harness);
    const presetSelect = await screen.findByLabelText("preset");
    const nameInput = screen.getByLabelText("preset 이름");

    fireEvent.change(nameInput, { target: { value: "새 설정" } });
    fireEvent.click(screen.getByRole("button", { name: "새 preset 저장" }));
    await waitFor(() =>
      expect(harness.callsFor(IPC_CHANNELS.createEpubExportPreset)).toHaveLength(1)
    );
    await waitFor(() =>
      expect((presetSelect as HTMLSelectElement).value).toBe("preset-2")
    );

    fireEvent.change(nameInput, { target: { value: "변경 설정" } });
    fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));
    await waitFor(() =>
      expect(harness.callsFor(IPC_CHANNELS.updateEpubExportPreset)).toHaveLength(1)
    );
    expect(harness.callsFor(IPC_CHANNELS.updateEpubExportPreset)[0]?.[1]).toEqual(
      expect.objectContaining({
        presetId: "preset-2",
        name: "변경 설정",
        expectedPresetRevision: 1
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "복제" }));
    await waitFor(() =>
      expect(harness.callsFor(IPC_CHANNELS.duplicateEpubExportPreset)).toHaveLength(1)
    );
    await waitFor(() =>
      expect((presetSelect as HTMLSelectElement).value).toBe("preset-3")
    );
    expect(harness.callsFor(IPC_CHANNELS.duplicateEpubExportPreset)[0]?.[1]).toEqual(
      expect.objectContaining({
        sourcePresetId: "preset-2",
        name: "변경 설정 복사본"
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    await waitFor(() =>
      expect(harness.callsFor(IPC_CHANNELS.deleteEpubExportPreset)).toHaveLength(1)
    );
    expect(harness.callsFor(IPC_CHANNELS.deleteEpubExportPreset)[0]?.[1]).toEqual(
      expect.objectContaining({ presetId: "preset-3", expectedPresetRevision: 1 })
    );
    await waitFor(() =>
      expect((presetSelect as HTMLSelectElement).value).toBe("")
    );
  });

  it("selects and removes a validated local cover without exposing a path", async () => {
    const { harness } = renderWorkspace();
    await screen.findByText("표지: 없음");

    fireEvent.click(screen.getByRole("button", { name: "PNG/JPEG 선택" }));
    expect(await screen.findByText(/표지: image\/png · 1600×2560/u)).toBeTruthy();
    expect(harness.callsFor(IPC_CHANNELS.choosePublicationCover)[0]?.[1]).toEqual({
      sessionId: "session-1"
    });

    fireEvent.click(screen.getByRole("button", { name: "표지 제거" }));
    await waitFor(() => expect(screen.getByText("표지: 없음")).toBeTruthy());
    expect(harness.callsFor(IPC_CHANNELS.removePublicationCover)[0]?.[1]).toEqual({
      sessionId: "session-1"
    });
  });

  it("preserves dirty metadata and one-off config through cover refresh", async () => {
    const harness = createHarness({ presets: [preset()] });
    renderWorkspace(harness);
    await screen.findByLabelText("profile");
    fireEvent.change(screen.getByLabelText("preset"), {
      target: { value: "preset-1" }
    });
    fireEvent.change(screen.getByLabelText("설명"), {
      target: { value: "저장 전 설명" }
    });
    fireEvent.change(screen.getByLabelText("profile"), {
      target: { value: "EPUB_3_3_COMPATIBILITY" }
    });

    fireEvent.click(screen.getByRole("button", { name: "PNG/JPEG 선택" }));
    await screen.findByText(/표지: image\/png/u);

    expect((screen.getByLabelText("설명") as HTMLTextAreaElement).value).toBe(
      "저장 전 설명"
    );
    expect((screen.getByLabelText("profile") as HTMLSelectElement).value).toBe(
      "EPUB_3_3_COMPATIBILITY"
    );
  });

  it("saves dirty metadata before leaving and cancels local preparation durably", async () => {
    const handle = createRef<PublicationExportModeHandle>();
    const beforeExport = deferred<number | null>();
    const harness = createHarness({ beforeExport: () => beforeExport.promise });
    renderWorkspace(harness, { ref: handle });
    await screen.findByLabelText("설명");

    fireEvent.change(screen.getByLabelText("설명"), {
      target: { value: "종료 전에 저장할 설명" }
    });
    await expect(handle.current!.prepareToLeave()).resolves.toBe(true);
    expect(harness.callsFor(IPC_CHANNELS.updatePublicationMetadata)[0]?.[1]).toEqual(
      expect.objectContaining({ description: "종료 전에 저장할 설명" })
    );

    fireEvent.click(screen.getByRole("button", { name: "사전 검사" }));
    await waitFor(() =>
      expect(
        screen
          .getByLabelText("EPUB 실행")
          .closest("section")
          ?.parentElement?.getAttribute("data-epub-phase")
      ).toBe("PREPARING")
    );
    const leave = handle.current!.prepareToLeave();
    expect(harness.callsFor(IPC_CHANNELS.cancelEpubExport)).toHaveLength(0);
    beforeExport.resolve(harness.getState().revision);
    await expect(leave).resolves.toBe(true);
    expect(harness.callsFor(IPC_CHANNELS.validateEpubExport)).toHaveLength(0);
    expect(harness.callsFor(IPC_CHANNELS.cancelEpubExport)).toHaveLength(0);
  });

  it("hands an accepted main cancellation to close before validation settles", async () => {
    const handle = createRef<PublicationExportModeHandle>();
    const validation = deferred<ValidateEpubExportResult>();
    const harness = createHarness({ validate: () => validation.promise });
    renderWorkspace(harness, { ref: handle });
    await screen.findByLabelText("profile");

    fireEvent.click(screen.getByRole("button", { name: "사전 검사" }));
    await waitFor(() =>
      expect(harness.callsFor(IPC_CHANNELS.validateEpubExport)).toHaveLength(1)
    );
    const request = harness.callsFor(IPC_CHANNELS.validateEpubExport)[0]?.[1] as
      | ValidateEpubExportRequest
      | undefined;
    expect(request).toBeDefined();

    const close = handle.current!.prepareToClose();
    await waitFor(() =>
      expect(harness.callsFor(IPC_CHANNELS.cancelEpubExport)).toHaveLength(1)
    );
    await expect(close).resolves.toBe(true);

    await act(async () => {
      validation.resolve({
        operationId: request!.operationId,
        sourcePublicationHash: "b".repeat(64),
        report: report(),
        revision: request!.expectedProjectRevision
      });
      await validation.promise;
    });
    await waitFor(() =>
      expect(
        screen
          .getByLabelText("EPUB 실행")
          .closest("section")
          ?.parentElement?.getAttribute("data-epub-phase")
      ).toBe("IDLE")
    );
    expect(screen.queryByLabelText("EPUB validation report")).toBeNull();
  });

  it("fails close closed when dirty metadata cannot be persisted", async () => {
    const handle = createRef<PublicationExportModeHandle>();
    const harness = createHarness({
      updateMetadata: async () => {
        throw new Error("fixture metadata failure");
      }
    });
    renderWorkspace(harness, { ref: handle });
    await screen.findByLabelText("설명");
    fireEvent.change(screen.getByLabelText("설명"), {
      target: { value: "저장 실패를 검증할 설명" }
    });

    await expect(handle.current!.prepareToClose()).resolves.toBe(false);
    expect(
      harness.callsFor(IPC_CHANNELS.updatePublicationMetadata)
    ).toHaveLength(1);
    expect(harness.callsFor(IPC_CHANNELS.cancelEpubExport)).toHaveLength(0);
  });

  it("serializes duplicate leave saves and preserves an edit made before a delayed response", async () => {
    const handle = createRef<PublicationExportModeHandle>();
    const firstSave = deferred<PublicationMetadataMutationResult>();
    const secondSave = deferred<PublicationMetadataMutationResult>();
    let saveNumber = 0;
    const harness = createHarness({
      updateMetadata: async () => {
        saveNumber += 1;
        return saveNumber === 1 ? firstSave.promise : secondSave.promise;
      }
    });
    renderWorkspace(harness, { ref: handle });
    const description = (await screen.findByLabelText(
      "설명"
    )) as HTMLTextAreaElement;

    fireEvent.change(description, { target: { value: "첫 번째 설명" } });
    const firstLeave = handle.current!.prepareToLeave();
    const duplicateLeave = handle.current!.prepareToLeave();
    expect(firstLeave).toBe(duplicateLeave);
    await waitFor(() =>
      expect(harness.callsFor(IPC_CHANNELS.updatePublicationMetadata)).toHaveLength(1)
    );
    expect(description.closest("fieldset")?.hasAttribute("disabled")).toBe(true);

    fireEvent.change(description, { target: { value: "응답 전에 바꾼 설명" } });
    expect(description.value).toBe("응답 전에 바꾼 설명");
    firstSave.resolve({
      metadata: metadata({
        description: "첫 번째 설명",
        updatedAt: "2026-08-09T01:00:00.000Z"
      }),
      revision: 8,
      noOp: false
    });

    await waitFor(() =>
      expect(harness.callsFor(IPC_CHANNELS.updatePublicationMetadata)).toHaveLength(2)
    );
    expect(description.value).toBe("응답 전에 바꾼 설명");
    expect(
      harness.callsFor(IPC_CHANNELS.updatePublicationMetadata)[1]?.[1]
    ).toEqual(expect.objectContaining({ description: "응답 전에 바꾼 설명" }));

    secondSave.resolve({
      metadata: metadata({
        description: "응답 전에 바꾼 설명",
        updatedAt: "2026-08-09T02:00:00.000Z"
      }),
      revision: 9,
      noOp: false
    });
    await expect(firstLeave).resolves.toBe(true);
    await expect(duplicateLeave).resolves.toBe(true);
    await waitFor(() =>
      expect(description.closest("fieldset")?.hasAttribute("disabled")).toBe(false)
    );
    expect(description.value).toBe("응답 전에 바꾼 설명");
  });

  it("passes each exact canonical metadata response to validation and export", async () => {
    const canonicalMetadata: PublicationExportMetadata[] = [];
    const harness = createHarness({
      updateMetadata: async (request, currentState) => {
        const sequence = canonicalMetadata.length + 1;
        const next = metadata({
          publicationTitle: request.publicationTitle,
          creatorName: request.creatorName,
          language: request.language,
          identifier: request.identifier,
          publisher: `canonical-publisher-${sequence}`,
          description: request.description,
          rights: request.rights,
          subjects: request.subjects,
          coverAssetId: currentState.metadata.coverAssetId,
          createdAt: currentState.metadata.createdAt,
          updatedAt: `2026-08-09T0${sequence}:30:00.000Z`
        });
        canonicalMetadata.push(next);
        return {
          metadata: next,
          revision: currentState.revision + 1,
          noOp: false
        };
      }
    });
    renderWorkspace(harness);
    await screen.findByLabelText("profile");

    fireEvent.click(screen.getByRole("button", { name: "사전 검사" }));
    await waitFor(() =>
      expect(harness.callsFor(IPC_CHANNELS.validateEpubExport)).toHaveLength(1)
    );
    const validationRequest = harness.callsFor(
      IPC_CHANNELS.validateEpubExport
    )[0]?.[1] as ValidateEpubExportRequest;
    expect(validationRequest.metadata).toEqual(canonicalMetadata[0]);
    expect(validationRequest.metadata.updatedAt).toBe(
      "2026-08-09T01:30:00.000Z"
    );

    fireEvent.click(screen.getByRole("button", { name: "저장 위치 선택" }));
    await screen.findByText("긴 밤의 문장.epub");
    fireEvent.click(screen.getByRole("button", { name: "EPUB 내보내기" }));
    await waitFor(() =>
      expect(harness.callsFor(IPC_CHANNELS.runEpubExport)).toHaveLength(1)
    );
    const exportRequest = harness.callsFor(IPC_CHANNELS.runEpubExport)[0]?.[1] as
      | RunEpubExportRequest
      | undefined;
    expect(exportRequest?.metadata).toEqual(canonicalMetadata[1]);
    expect(exportRequest?.metadata.updatedAt).toBe(
      "2026-08-09T02:30:00.000Z"
    );
  });

  it("reports the preserved recovery directory instead of claiming the original was unchanged", async () => {
    const harness = createHarness({
      run: async () => {
        throw new Error(EPUB_RECOVERY_PRESERVED_ERROR);
      }
    });
    renderWorkspace(harness);
    await screen.findByLabelText("profile");
    fireEvent.click(screen.getByRole("button", { name: "저장 위치 선택" }));
    await screen.findByText("긴 밤의 문장.epub");
    fireEvent.click(screen.getByRole("button", { name: "EPUB 내보내기" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        ".madi-epub-operation-"
      )
    );
    expect(screen.getByRole("alert").textContent).not.toContain(
      "기존 파일은 변경하지 않았습니다"
    );
  });

  it("authoritatively reconciles changed and deleted presets on reload", async () => {
    const harness = createHarness({ presets: [preset()] });
    const view = renderWorkspace(harness);
    await screen.findByLabelText("preset");
    fireEvent.change(screen.getByLabelText("preset"), {
      target: { value: "preset-1" }
    });
    const restoredConfig = {
      ...defaultConfig,
      targetProfile: "EPUB_3_3_COMPATIBILITY" as const,
      splitMode: "SCENE" as const
    };
    harness.setState({
      ...harness.getState(),
      presets: [preset("preset-1", "복원된 설정", 2, restoredConfig)],
      revision: 8
    });
    view.rerenderWorkspace({ reloadToken: 1, projectRevision: 8 });
    await waitFor(() =>
      expect((screen.getByLabelText("preset 이름") as HTMLInputElement).value).toBe(
        "복원된 설정"
      )
    );
    expect((screen.getByLabelText("profile") as HTMLSelectElement).value).toBe(
      "EPUB_3_3_COMPATIBILITY"
    );

    harness.setState({ ...harness.getState(), presets: [], revision: 9 });
    view.rerenderWorkspace({ reloadToken: 2, projectRevision: 9 });
    await waitFor(() =>
      expect((screen.getByLabelText("preset") as HTMLSelectElement).value).toBe("")
    );
    expect((screen.getByLabelText("profile") as HTMLSelectElement).value).toBe(
      "EPUB_3_4_DRAFT_2026_08"
    );
  });

  it.each([
    ["WORK node", { ...tree, nodes: [tree.nodes[0]!] }, "work-1"],
    [
      "first valid node",
      {
        ...tree,
        nodes: [{ ...tree.nodes[1]!, parentId: null }]
      },
      "chapter-1"
    ]
  ] as const)(
    "falls back a removed snapshot scope to the %s and uses it in the next request",
    async (_label, restoredTree, expectedScopeNodeId) => {
      const view = renderWorkspace();
      const scope = (await screen.findByLabelText(
        "대상 범위"
      )) as HTMLSelectElement;
      fireEvent.change(scope, { target: { value: "scene-1" } });
      expect(scope.value).toBe("scene-1");

      view.rerenderWorkspace({
        projectTree: restoredTree,
        reloadToken: 1
      });
      await waitFor(() => expect(scope.value).toBe(expectedScopeNodeId));

      fireEvent.click(screen.getByRole("button", { name: "사전 검사" }));
      await waitFor(() =>
        expect(
          view.harness.callsFor(IPC_CHANNELS.validateEpubExport)
        ).toHaveLength(1)
      );
      expect(
        view.harness.callsFor(IPC_CHANNELS.validateEpubExport)[0]?.[1]
      ).toEqual(expect.objectContaining({ scopeNodeId: expectedScopeNodeId }));
    }
  );

  it("shows only active-operation progress, cancels it, and ignores its late result", async () => {
    const validation = deferred<ValidateEpubExportResult>();
    const harness = createHarness({ validate: () => validation.promise });
    renderWorkspace(harness);
    await screen.findByLabelText("profile");

    fireEvent.click(screen.getByRole("button", { name: "사전 검사" }));
    await waitFor(() =>
      expect(harness.callsFor(IPC_CHANNELS.validateEpubExport)).toHaveLength(1)
    );
    const request = harness.callsFor(IPC_CHANNELS.validateEpubExport)[0]?.[1] as
      | ValidateEpubExportRequest
      | undefined;
    expect(request).toBeDefined();

    act(() => {
      harness.emitProgress({
        operationId: OPERATION_2,
        stage: "EPUBCHECK",
        completed: 1,
        total: 1
      });
    });
    expect(screen.queryByText("EPUBCheck")).toBeNull();

    act(() => {
      harness.emitProgress({
        operationId: request!.operationId,
        stage: "XHTML_GENERATION",
        completed: 4,
        total: 10
      });
    });
    expect(screen.getByText("XHTML 생성")).toBeTruthy();
    expect(screen.getByText("4/10")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    await waitFor(() =>
      expect(harness.callsFor(IPC_CHANNELS.cancelEpubExport)).toHaveLength(1)
    );
    expect(harness.callsFor(IPC_CHANNELS.cancelEpubExport)[0]?.[1]).toEqual({
      sessionId: "session-1",
      operationId: request!.operationId
    });
    await waitFor(() => expect(screen.queryByText("XHTML 생성")).toBeNull());

    await act(async () => {
      validation.resolve({
        operationId: request!.operationId,
        sourcePublicationHash: "b".repeat(64),
        report: report(),
        revision: request!.expectedProjectRevision
      });
      await validation.promise;
    });
    expect(screen.queryByLabelText("EPUB validation report")).toBeNull();
  });

  it("exports, renders validation coverage, opens source, and saves/reveals reports", async () => {
    const exported = deferred<RunEpubExportResult>();
    const harness = createHarness({ run: () => exported.promise });
    const view = renderWorkspace(harness);
    await screen.findByLabelText("profile");
    fireEvent.change(screen.getByLabelText("profile"), {
      target: { value: "EPUB_3_3_COMPATIBILITY" }
    });

    fireEvent.click(screen.getByRole("button", { name: "저장 위치 선택" }));
    expect(await screen.findByText("긴 밤의 문장.epub")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "EPUB 내보내기" }));
    await waitFor(() =>
      expect(harness.callsFor(IPC_CHANNELS.runEpubExport)).toHaveLength(1)
    );
    const request = harness.callsFor(IPC_CHANNELS.runEpubExport)[0]?.[1] as
      | RunEpubExportRequest
      | undefined;
    expect(request).toEqual(
      expect.objectContaining({
        outputSelectionId: "output-1",
        scopeNodeId: "work-1",
        config: expect.objectContaining({
          targetProfile: "EPUB_3_3_COMPATIBILITY"
        })
      })
    );

    act(() => {
      harness.emitProgress({
        operationId: request!.operationId,
        stage: "FINALIZE",
        completed: 1,
        total: 1
      });
    });
    expect(screen.getByText("원자적 저장")).toBeTruthy();

    await act(async () => {
      exported.resolve({
        status: "COMPLETED",
        operationId: request!.operationId,
        fileName: "긴 밤의 문장.epub",
        byteLength: 12_345,
        sha256: "d".repeat(64),
        report: report("EPUB_3_3_COMPATIBILITY"),
        revision: request!.expectedProjectRevision
      });
      await exported.promise;
    });

    const validationReport = await screen.findByLabelText(
      "EPUB validation report"
    );
    expect(validationReport.textContent).toContain("검증 결과 · VALID");
    expect(validationReport.textContent).toContain("10/10");
    expect(validationReport.textContent).toContain("1200/1200");
    expect(validationReport.textContent).toContain("EPUBCheckVALID");
    expect(validationReport.textContent).not.toContain("보조 호환성 검사");
    expect(
      document.querySelector(".epub-export__success")?.textContent
    ).toContain("12,345 bytes");
    expect(
      screen
        .getByLabelText("EPUB 실행")
        .closest("section")
        ?.parentElement?.getAttribute("data-epub-block-loss")
    ).toBe("0");

    fireEvent.click(screen.getByRole("button", { name: /MADI_EPUB_OK/u }));
    expect(harness.onOpenSource).toHaveBeenCalledWith("scene-1");

    fireEvent.click(screen.getByRole("button", { name: "JSON report 저장" }));
    await waitFor(() =>
      expect(harness.callsFor(IPC_CHANNELS.saveEpubExportReport)).toHaveLength(1)
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Markdown report 저장" }).hasAttribute("disabled")
      ).toBe(false)
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Markdown report 저장" })
    );
    await waitFor(() =>
      expect(harness.callsFor(IPC_CHANNELS.saveEpubExportReport)).toHaveLength(2)
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "파일 위치 열기" }).hasAttribute("disabled")
      ).toBe(false)
    );
    fireEvent.click(screen.getByRole("button", { name: "파일 위치 열기" }));
    expect(harness.callsFor(IPC_CHANNELS.saveEpubExportReport).map((call) => call[1]))
      .toEqual([
        { sessionId: "session-1", operationId: request!.operationId, format: "JSON" },
        { sessionId: "session-1", operationId: request!.operationId, format: "MARKDOWN" }
      ]);
    await waitFor(() =>
      expect(harness.callsFor(IPC_CHANNELS.revealEpubExport)).toHaveLength(1)
    );
    expect(harness.callsFor(IPC_CHANNELS.revealEpubExport)[0]?.[1]).toEqual({
      sessionId: "session-1",
      operationId: request!.operationId
    });

    act(() => {
      harness.emitProgress({
        operationId: OPERATION_1 === request!.operationId ? OPERATION_2 : OPERATION_1,
        stage: "EPUBCHECK",
        completed: 1,
        total: 1
      });
    });
    expect(screen.getByText("원자적 저장")).toBeTruthy();

    view.rerenderWorkspace({
      projectRevision: request!.expectedProjectRevision + 1
    });
    expect(screen.queryByLabelText("EPUB validation report")).toBeNull();
    expect(document.querySelector(".epub-export__success")).toBeNull();
    expect(screen.queryByText("원자적 저장")).toBeNull();
  });

  it("treats a structured export cancellation as neither success nor failure", async () => {
    const exported = deferred<RunEpubExportResult>();
    const harness = createHarness({ run: () => exported.promise });
    renderWorkspace(harness);
    await screen.findByLabelText("profile");

    fireEvent.click(screen.getByRole("button", { name: "저장 위치 선택" }));
    expect(await screen.findByText("긴 밤의 문장.epub")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "EPUB 내보내기" }));
    await waitFor(() =>
      expect(harness.callsFor(IPC_CHANNELS.runEpubExport)).toHaveLength(1)
    );
    const request = harness.callsFor(IPC_CHANNELS.runEpubExport)[0]?.[1] as
      | RunEpubExportRequest
      | undefined;
    const revisionCallsBeforeCancellation =
      harness.onProjectRevision.mock.calls.length;

    await act(async () => {
      exported.resolve({
        status: "CANCELLED",
        operationId: request!.operationId
      });
      await exported.promise;
    });

    await waitFor(() =>
      expect(
        screen
          .getByLabelText("EPUB 실행")
          .closest("section")
          ?.parentElement?.getAttribute("data-epub-phase")
      ).toBe("IDLE")
    );
    expect(document.querySelector(".epub-export__success")).toBeNull();
    expect(document.querySelector(".epub-export__error")).toBeNull();
    expect(screen.queryByLabelText("EPUB validation report")).toBeNull();
    expect(harness.onProjectRevision).toHaveBeenCalledTimes(
      revisionCallsBeforeCancellation
    );
  });

  it("renders a destination conflict as the existing fail-closed message", async () => {
    const exported = deferred<RunEpubExportResult>();
    const harness = createHarness({ run: () => exported.promise });
    renderWorkspace(harness);
    await screen.findByLabelText("profile");

    fireEvent.click(screen.getByRole("button", { name: "저장 위치 선택" }));
    expect(await screen.findByText("긴 밤의 문장.epub")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "EPUB 내보내기" }));
    await waitFor(() =>
      expect(harness.callsFor(IPC_CHANNELS.runEpubExport)).toHaveLength(1)
    );
    const request = harness.callsFor(IPC_CHANNELS.runEpubExport)[0]?.[1] as
      | RunEpubExportRequest
      | undefined;
    const revisionCallsBeforeFailure = harness.onProjectRevision.mock.calls.length;

    await act(async () => {
      exported.resolve({
        status: "FAILED",
        operationId: request!.operationId,
        code: "DESTINATION_CHANGED"
      });
      await exported.promise;
    });

    expect(
      await screen.findByText(
        "EPUB 생성 또는 검증에 실패했습니다. 기존 파일은 변경하지 않았습니다."
      )
    ).toBeTruthy();
    expect(document.querySelector(".epub-export__success")).toBeNull();
    expect(screen.queryByLabelText("EPUB validation report")).toBeNull();
    expect(harness.onProjectRevision).toHaveBeenCalledTimes(
      revisionCallsBeforeFailure
    );
  });
});
