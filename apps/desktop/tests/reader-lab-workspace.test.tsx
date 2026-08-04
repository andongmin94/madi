import { readFileSync } from "node:fs";
import { createRef, useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReaderLabWorkspace } from "../src/renderer/components/readerLab/ReaderLabWorkspace";
import { BUILTIN_READER_PRESETS } from "../src/renderer/components/readerLab/builtinTemplates";
import { defaultReaderLabUiState } from "../src/renderer/components/readerLab/readerLabState";
import type {
  ReaderLabApi,
  ReaderLabModeHandle
} from "../src/renderer/components/readerLab/types";
import type { ProjectTree } from "../src/shared/contracts";
import type {
  CompilePublicationResult,
  CreateReaderPresetRequest,
  ReaderPresetRecord
} from "../src/shared/publication";
import { readerCompileResult, readerPublication } from "./reader-lab-fixtures";

const NOW = "2026-08-09T00:00:00.000Z";

const tree: ProjectTree = {
  project: {
    id: "project-1",
    title: "Reader Lab Test",
    authorName: null,
    createdAt: NOW,
    updatedAt: NOW
  },
  nodes: [
    { id: "work-1", projectId: "project-1", parentId: null, kind: "WORK", title: "Reader Lab Test", orderKey: 1024, documentId: null, createdAt: NOW, updatedAt: NOW },
    { id: "chapter-1", projectId: "project-1", parentId: "work-1", kind: "CHAPTER", title: "1화", orderKey: 1024, documentId: null, createdAt: NOW, updatedAt: NOW },
    { id: "scene-1", projectId: "project-1", parentId: "chapter-1", kind: "SCENE", title: "첫 장면", orderKey: 1024, documentId: "document-1", createdAt: NOW, updatedAt: NOW }
  ],
  revision: 5
};

function storedPresetFromRequest(
  request: CreateReaderPresetRequest,
  id = "preset-1",
  revision = 1
): ReaderPresetRecord {
  return {
    id,
    projectId: "project-1",
    name: request.name,
    sourceKind: request.sourceKind,
    sourceId: request.sourceId ?? null,
    sourceVersion: request.sourceVersion ?? null,
    verificationStatus: request.verificationStatus,
    presetFormat: "MADI_READER_PRESET",
    presetVersion: 1,
    config: request.config,
    contentHash: "b".repeat(64),
    revision,
    createdAt: NOW,
    updatedAt: NOW
  };
}

function readerApi(
  compilePublication: ReaderLabApi["compilePublication"] = vi.fn(
    async () => readerCompileResult()
  )
): ReaderLabApi {
  return {
    compilePublication,
    listReaderPresets: vi.fn(async () => ({
      presets: [],
      duplicateNames: [],
      revision: 5
    })),
    createReaderPreset: vi.fn(async (request) => ({
      preset: storedPresetFromRequest(request),
      revision: 6,
      noOp: false
    })),
    updateReaderPreset: vi.fn(async () => {
      throw new Error("unexpected update");
    }),
    duplicateReaderPreset: vi.fn(async () => {
      throw new Error("unexpected duplicate");
    }),
    deleteReaderPreset: vi.fn(async (request) => ({
      deletedPresetId: request.presetId,
      revision: 7
    })),
    saveReaderLabUiState: vi.fn(async () => undefined),
    loadReaderLabUiState: vi.fn(async () => ({ state: null }))
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

function renderWorkspace(
  options: {
    readonly api?: ReaderLabApi;
    readonly revision?: number;
    readonly onBeforeCompile?: () => Promise<number | null>;
    readonly onProjectRevision?: (revision: number) => void;
    readonly onOpenSource?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const onOpenSource = options.onOpenSource ?? vi.fn();
  const props = {
    api: options.api ?? readerApi(),
    sessionId: "session-1",
    projectId: "project-1",
    projectRevision: options.revision ?? 5,
    reloadToken: 0,
    projectTree: tree,
    initialScopeNodeId: "chapter-1",
    activeSceneId: "scene-1",
    interactionBlocked: false,
    onBeforeCompile: options.onBeforeCompile ?? vi.fn(async () => 5),
    onProjectRevision: options.onProjectRevision ?? vi.fn(),
    onOpenSource
  };
  return { ...render(<ReaderLabWorkspace {...props} />), props, onOpenSource };
}

describe("Reader Lab workspace orchestration", () => {
  it("uses the authoritative post-flush revision and falls back to scene navigation for unverified ranges", async () => {
    const compilePublication = vi.fn(async (request) =>
      readerCompileResult(
        readerPublication({
          revision: request.expectedProjectRevision,
          scopeNodeId: request.scopeNodeId,
          scopeKind: request.scopeNodeId === "scene-1" ? "SCENE" : "CHAPTER"
        })
      )
    );
    const onOpenSource = vi.fn();
    const { getByTestId } = renderWorkspace({
      api: readerApi(compilePublication),
      revision: 5,
      onBeforeCompile: vi.fn(async () => 6),
      onOpenSource
    });
    await waitFor(() => expect(compilePublication).toHaveBeenCalledTimes(1));
    expect(compilePublication).toHaveBeenCalledWith(
      expect.objectContaining({ expectedProjectRevision: 6 })
    );
    const host = await waitFor(() => getByTestId("reader-shadow-host-1"));
    await waitFor(() => expect(host.shadowRoot).not.toBeNull());
    const lab = screen.getByLabelText("읽기 실험실");
    await waitFor(() =>
      expect(lab.getAttribute("data-reader-first-visible-ms")).not.toBeNull()
    );
    for (const attribute of [
      "data-reader-core-compile-ms",
      "data-reader-ipc-round-trip-ms",
      "data-reader-validation-ms",
      "data-reader-first-visible-ms"
    ]) {
      expect(Number.isFinite(Number(lab.getAttribute(attribute)))).toBe(true);
    }
    expect(lab.getAttribute("data-reader-compile-status")).toBe("ready");
    expect(lab.getAttribute("data-reader-project-revision")).toBe("6");
    const heading = host.shadowRoot!.querySelector<HTMLElement>(
      '[data-reader-block-id="heading-1"]'
    )!;
    fireEvent.click(heading);
    expect(onOpenSource).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneNodeId: "scene-1",
        start: null,
        end: null,
        rangeVerified: false
      })
    );
  });

  it("compiles an immediate scope change and suppresses only the following preset revision", async () => {
    const compilePublication = vi.fn(async (request) =>
      readerCompileResult(
        readerPublication({
          revision: request.expectedProjectRevision,
          scopeNodeId: request.scopeNodeId,
          scopeKind: request.scopeNodeId === "chapter-1" ? "CHAPTER" : "SCENE"
        })
      )
    );
    const api = readerApi(compilePublication);
    function Harness() {
      const [revision, setRevision] = useState(5);
      return (
        <ReaderLabWorkspace
          api={api}
          sessionId="session-1"
          projectId="project-1"
          projectRevision={revision}
          reloadToken={0}
          projectTree={tree}
          initialScopeNodeId="chapter-1"
          activeSceneId="scene-1"
          interactionBlocked={false}
          onBeforeCompile={async () => revision}
          onProjectRevision={setRevision}
          onOpenSource={vi.fn()}
        />
      );
    }
    render(<Harness />);

    await waitFor(() => expect(compilePublication).toHaveBeenCalledTimes(1));
    const lab = await screen.findByLabelText("읽기 실험실");
    await waitFor(() => expect(lab.dataset.readerScopeKind).toBe("SCENE"));

    fireEvent.change(screen.getByLabelText("Reader 범위"), {
      target: { value: "chapter-1" }
    });
    await waitFor(() => expect(compilePublication).toHaveBeenCalledTimes(2));
    expect(compilePublication.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ scopeNodeId: "chapter-1" })
    );
    await waitFor(() => expect(lab.dataset.readerScopeKind).toBe("CHAPTER"));

    fireEvent.change(screen.getByLabelText("글자 크기"), {
      target: { value: "21" }
    });
    fireEvent.click(screen.getByRole("button", { name: "새 preset 저장" }));
    await waitFor(() => expect(api.createReaderPreset).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(compilePublication).toHaveBeenCalledTimes(2);
    expect(lab.dataset.readerScopeKind).toBe("CHAPTER");
  });

  it("defers a restored revision compile until the exclusive restore releases interaction", async () => {
    const compilePublication = vi.fn(async (request) =>
      readerCompileResult(
        readerPublication({
          revision: request.expectedProjectRevision,
          scopeNodeId: request.scopeNodeId,
          scopeKind: request.scopeNodeId === "scene-1" ? "SCENE" : "CHAPTER"
        })
      )
    );
    const api = readerApi(compilePublication);
    const initialPreflight = vi.fn(async () => 5);
    const blockedPreflight = vi.fn(async () => null);
    const acceptedPreflight = vi.fn(async () => 6);
    const rendered = renderWorkspace({
      api,
      revision: 5,
      onBeforeCompile: initialPreflight
    });
    const lab = await screen.findByLabelText("읽기 실험실");
    await waitFor(() => expect(compilePublication).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(lab.dataset.readerProjectRevision).toBe("5"));

    rendered.rerender(
      <ReaderLabWorkspace
        {...rendered.props}
        projectRevision={6}
        reloadToken={1}
        interactionBlocked
        onBeforeCompile={blockedPreflight}
      />
    );
    await waitFor(() => expect(api.listReaderPresets).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.loadReaderLabUiState).toHaveBeenCalledTimes(2));
    expect(compilePublication).toHaveBeenCalledTimes(1);
    expect(blockedPreflight).not.toHaveBeenCalled();
    expect(screen.queryByText(/현재 장면을 저장하지 못해/)).toBeNull();

    rendered.rerender(
      <ReaderLabWorkspace
        {...rendered.props}
        projectRevision={6}
        reloadToken={1}
        interactionBlocked={false}
        onBeforeCompile={acceptedPreflight}
      />
    );
    await waitFor(() => expect(compilePublication).toHaveBeenCalledTimes(2));
    expect(compilePublication.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ expectedProjectRevision: 6 })
    );
    expect(acceptedPreflight).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(lab.dataset.readerProjectRevision).toBe("6"));
    expect(lab.dataset.readerCompileStatus).toBe("ready");

    for (let toggle = 0; toggle < 2; toggle += 1) {
      rendered.rerender(
        <ReaderLabWorkspace
          {...rendered.props}
          projectRevision={6}
          reloadToken={1}
          interactionBlocked
          onBeforeCompile={acceptedPreflight}
        />
      );
      rendered.rerender(
        <ReaderLabWorkspace
          {...rendered.props}
          projectRevision={6}
          reloadToken={1}
          interactionBlocked={false}
          onBeforeCompile={acceptedPreflight}
        />
      );
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(compilePublication).toHaveBeenCalledTimes(2);
    expect(acceptedPreflight).toHaveBeenCalledTimes(1);
  });

  it("captures control values before queued Reader state updates", async () => {
    const { getByRole } = renderWorkspace();
    const lab = await screen.findByLabelText("읽기 실험실");
    await waitFor(() => expect(lab.dataset.readerCompileStatus).toBe("ready"));

    fireEvent.change(getByRole("slider", { name: "오른쪽 panel 폭" }), {
      target: { value: "444" }
    });
    expect(lab.dataset.readerRightPanelWidth).toBe("444");

    fireEvent.click(getByRole("button", { name: "2 pane" }));
    const scrollSync = getByRole("checkbox", { name: "scroll sync" });
    expect(scrollSync.hasAttribute("disabled")).toBe(false);
    fireEvent.click(scrollSync);
    expect(lab.dataset.readerScrollSync).toBe("true");
  });

  it("defers the latest UI state autosave until a long compile completes", async () => {
    vi.useFakeTimers();
    try {
      const pendingCompile = deferred<CompilePublicationResult>();
      const compilePublication = vi.fn(() => pendingCompile.promise);
      const api = readerApi(compilePublication);
      renderWorkspace({ api });

      await act(async () => {
        for (let turn = 0; turn < 8; turn += 1) {
          await Promise.resolve();
        }
      });
      expect(compilePublication).toHaveBeenCalledTimes(1);

      const lab = screen.getByLabelText("읽기 실험실");
      expect(lab.dataset.readerCompileStatus).toBe("busy");
      fireEvent.change(screen.getByRole("slider", { name: "오른쪽 panel 폭" }), {
        target: { value: "444" }
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(48_000);
      });
      expect(api.saveReaderLabUiState).not.toHaveBeenCalled();

      await act(async () => {
        pendingCompile.resolve(readerCompileResult());
        for (let turn = 0; turn < 4; turn += 1) {
          await Promise.resolve();
        }
      });
      expect(lab.dataset.readerCompileStatus).toBe("ready");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(349);
      });
      expect(api.saveReaderLabUiState).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(api.saveReaderLabUiState).toHaveBeenCalledTimes(1);
      expect(api.saveReaderLabUiState).toHaveBeenCalledWith(
        expect.objectContaining({
          state: expect.objectContaining({ rightPanelWidth: 444 })
        })
      );
      expect(screen.queryByText("Reader Lab 상태를 저장하지 못했습니다.")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps refresh actionable beside errors and recovers only from the latest UI save", async () => {
    vi.useFakeTimers();
    let readerStyles: HTMLStyleElement | null = null;
    try {
      readerStyles = document.createElement("style");
      readerStyles.textContent = readFileSync(
        "src/renderer/components/readerLab/readerLab.css",
        "utf8"
      );
      document.head.append(readerStyles);
      const staleSave = deferred<void>();
      const compilePublication = vi.fn(async () => readerCompileResult());
      const saveReaderLabUiState = vi
        .fn<ReaderLabApi["saveReaderLabUiState"]>()
        .mockRejectedValueOnce(new Error("timed out"))
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(() => staleSave.promise)
        .mockResolvedValueOnce(undefined);
      const api = {
        ...readerApi(compilePublication),
        saveReaderLabUiState
      };
      renderWorkspace({ api });

      await act(async () => {
        for (let turn = 0; turn < 10; turn += 1) {
          await Promise.resolve();
        }
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });
      const alert = screen.getByText("Reader Lab 상태를 저장하지 못했습니다.");
      const status = screen.getByTestId("reader-preview-status");
      const refresh = screen.getByRole("button", { name: "미리보기 새로고침" });
      const workspace = refresh.closest(".reader-preview-workspace");
      const lab = screen.getByLabelText("읽기 실험실");
      expect(status.contains(alert)).toBe(true);
      expect(status.contains(refresh)).toBe(false);
      expect(status.parentElement).toBe(workspace);
      expect(refresh.closest(".reader-preview-toolbar")?.parentElement).toBe(
        workspace
      );
      expect(refresh.hasAttribute("disabled")).toBe(false);
      expect(getComputedStyle(lab).gridTemplateColumns).toContain(
        "minmax(320px, 1fr)"
      );
      expect(getComputedStyle(lab).gridTemplateColumns).toContain("30vw");
      expect(
        getComputedStyle(refresh.closest(".reader-preview-toolbar")!).flexWrap
      ).toBe("wrap");
      expect(getComputedStyle(status).gridArea).toBe("status");

      fireEvent.click(refresh);
      await act(async () => {
        for (let turn = 0; turn < 8; turn += 1) {
          await Promise.resolve();
        }
      });
      expect(compilePublication).toHaveBeenCalledTimes(2);

      fireEvent.change(screen.getByRole("slider", { name: "왼쪽 panel 폭" }), {
        target: { value: "520" }
      });
      fireEvent.change(screen.getByRole("slider", { name: "오른쪽 panel 폭" }), {
        target: { value: "560" }
      });
      expect(lab.dataset.readerLeftPanelWidth).toBe("520");
      expect(lab.dataset.readerRightPanelWidth).toBe("560");
      expect(lab.style.getPropertyValue("--reader-left-panel")).toBe("520px");
      expect(lab.style.getPropertyValue("--reader-right-panel")).toBe("560px");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });
      expect(saveReaderLabUiState).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByText("Reader Lab 상태를 저장하지 못했습니다.")
      ).toBeNull();

      fireEvent.change(screen.getByRole("slider", { name: "오른쪽 panel 폭" }), {
        target: { value: "559" }
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });
      expect(saveReaderLabUiState).toHaveBeenCalledTimes(3);
      fireEvent.change(screen.getByRole("slider", { name: "오른쪽 panel 폭" }), {
        target: { value: "558" }
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });
      expect(saveReaderLabUiState).toHaveBeenCalledTimes(4);
      await act(async () => {
        staleSave.reject(new Error("stale timeout"));
        await Promise.resolve();
      });
      expect(
        screen.queryByText("Reader Lab 상태를 저장하지 못했습니다.")
      ).toBeNull();
    } finally {
      readerStyles?.remove();
      vi.useRealTimers();
    }
  });

  it("hides an old preview after save failure until explicit last-saved viewing", async () => {
    const compilePublication = vi.fn(async () => readerCompileResult());
    const onBeforeCompile = vi
      .fn<() => Promise<number | null>>()
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(null);
    renderWorkspace({ api: readerApi(compilePublication), onBeforeCompile });
    await screen.findByTestId("reader-preview-panes");

    fireEvent.click(screen.getByRole("button", { name: "미리보기 새로고침" }));
    await screen.findByText(/현재 장면을 저장하지 못해/);
    expect(screen.queryByTestId("reader-preview-panes")).toBeNull();
    expect(compilePublication).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "마지막 저장본 보기" }));
    await screen.findByText(/마지막 저장본 보기 · 현재 편집 내용은 포함되지 않았습니다/);
    await screen.findByTestId("reader-preview-panes");
    expect(compilePublication).toHaveBeenCalledTimes(2);
  });

  it("resolves core source block identity to the rendered block and exact source", async () => {
    const base = readerPublication();
    const section = base.sections[0]!;
    const paragraph = section.blocks[1]!;
    const document = {
      ...base,
      sections: [
        {
          ...section,
          blocks: [
            section.blocks[0]!,
            {
              ...paragraph,
              source: { ...paragraph.source, blockId: "source-dot-hash" }
            }
          ]
        }
      ]
    };
    const compilePublication = vi.fn(async () => ({
      ...readerCompileResult(document),
      diagnostics: [
        {
          code: "UNSUPPORTED_INLINE_MODIFIER" as const,
          severity: "WARNING" as const,
          sceneNodeId: "scene-1",
          documentId: "document-1",
          blockId: "source-dot-hash"
        }
      ]
    }));
    const onOpenSource = vi.fn();
    const { getByTestId } = renderWorkspace({
      api: readerApi(compilePublication),
      onOpenSource
    });
    const diagnostic = await screen.findByRole("button", {
      name: /지원하지 않는 inline modifier/
    });
    fireEvent.click(diagnostic);
    expect(onOpenSource).toHaveBeenCalledWith(
      expect.objectContaining({
        blockId: "source-dot-hash",
        start: 0,
        end: 4,
        rangeVerified: true
      })
    );
    const host = getByTestId("reader-shadow-host-1");
    await waitFor(() =>
      expect(
        host.shadowRoot
          ?.querySelector('[data-reader-block-id="paragraph-1"]')
          ?.getAttribute("aria-pressed")
      ).toBe("true")
    );
  });

  it("persists a clicked exact block before source navigation and restores it across three panes", async () => {
    let persisted = {
      ...defaultReaderLabUiState("scene-1"),
      paneCount: 3 as const
    };
    const api = {
      ...readerApi(),
      loadReaderLabUiState: vi.fn(async () => ({ state: persisted })),
      saveReaderLabUiState: vi.fn(async (request) => {
        persisted = request.state;
      })
    } satisfies ReaderLabApi;
    const workspaceRef = createRef<ReaderLabModeHandle>();
    const onOpenSource = vi.fn(async () => {
      await workspaceRef.current?.persistUiState();
    });
    const props = {
      api,
      sessionId: "session-1",
      projectId: "project-1",
      projectRevision: 5,
      reloadToken: 0,
      projectTree: tree,
      initialScopeNodeId: "chapter-1",
      activeSceneId: "scene-1",
      interactionBlocked: false,
      onBeforeCompile: vi.fn(async () => 5),
      onProjectRevision: vi.fn(),
      onOpenSource
    };
    const first = render(<ReaderLabWorkspace ref={workspaceRef} {...props} />);
    const hosts = await screen.findAllByTestId(/reader-shadow-host-/);
    expect(hosts).toHaveLength(3);
    await waitFor(() =>
      expect(hosts.every((host) => host.shadowRoot !== null)).toBe(true)
    );
    const exactParagraph = hosts[0]!.shadowRoot!.querySelector<HTMLElement>(
      '[data-reader-block-id="paragraph-1"][data-reader-source-range="exact"]'
    );
    expect(exactParagraph).not.toBeNull();

    fireEvent.click(exactParagraph!);
    await waitFor(() => expect(onOpenSource).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(api.saveReaderLabUiState).toHaveBeenCalledWith(
        expect.objectContaining({
          state: expect.objectContaining({
            paneCount: 3,
            selectedSourceBlockId: "paragraph-1"
          })
        })
      )
    );
    expect(onOpenSource).toHaveBeenCalledWith(
      expect.objectContaining({
        blockId: "paragraph-1",
        start: 0,
        end: 4,
        rangeVerified: true
      })
    );

    first.unmount();
    render(<ReaderLabWorkspace ref={workspaceRef} {...props} />);
    const restoredHosts = await screen.findAllByTestId(/reader-shadow-host-/);
    expect(restoredHosts).toHaveLength(3);
    await waitFor(() =>
      expect(
        restoredHosts.every(
          (host) =>
            host.shadowRoot
              ?.querySelector('[data-reader-block-id="paragraph-1"]')
              ?.getAttribute("aria-pressed") === "true"
        )
      ).toBe(true)
    );
  });

  it("persists a manual scroll synchronously before an immediate transition", async () => {
    const api = readerApi();
    const workspaceRef = createRef<ReaderLabModeHandle>();
    const { getByTestId } = render(
      <ReaderLabWorkspace
        ref={workspaceRef}
        api={api}
        sessionId="session-1"
        projectId="project-1"
        projectRevision={5}
        reloadToken={0}
        projectTree={tree}
        initialScopeNodeId="chapter-1"
        activeSceneId="scene-1"
        interactionBlocked={false}
        onBeforeCompile={async () => 5}
        onProjectRevision={vi.fn()}
        onOpenSource={vi.fn()}
      />
    );
    const host = await waitFor(() => getByTestId("reader-shadow-host-1"));
    await waitFor(() => expect(host.shadowRoot).not.toBeNull());
    const scroller = host.shadowRoot!.querySelector<HTMLElement>(
      ".reader-scroll"
    )!;
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      value: 2_000
    });
    Object.defineProperty(scroller, "clientHeight", {
      configurable: true,
      value: 500
    });
    vi.mocked(api.saveReaderLabUiState).mockClear();

    scroller.scrollTop = 600;
    fireEvent.scroll(scroller);
    await workspaceRef.current?.persistUiState();

    expect(api.saveReaderLabUiState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        state: expect.objectContaining({
          panes: expect.arrayContaining([
            expect.objectContaining({ scrollProgress: 0.4 })
          ])
        })
      })
    );
  });

  it("discards a stale compile response after a newer project revision", async () => {
    const first = deferred<CompilePublicationResult>();
    const second = deferred<CompilePublicationResult>();
    const compilePublication = vi
      .fn<ReaderLabApi["compilePublication"]>()
      .mockImplementationOnce(async () => first.promise)
      .mockImplementationOnce(async () => second.promise);
    let flushRevision = 5;
    const api = readerApi(compilePublication);
    const rendered = renderWorkspace({
      api,
      revision: 5,
      onBeforeCompile: async () => flushRevision
    });
    await waitFor(() => expect(compilePublication).toHaveBeenCalledTimes(1));
    flushRevision = 6;
    rendered.rerender(
      <ReaderLabWorkspace
        {...rendered.props}
        projectRevision={6}
        onBeforeCompile={async () => 6}
      />
    );
    await waitFor(() => expect(compilePublication).toHaveBeenCalledTimes(2));

    first.resolve(
      readerCompileResult(readerPublication({ revision: 5, title: "폐기할 응답" }))
    );
    second.resolve(
      readerCompileResult(readerPublication({ revision: 6, title: "최신 응답" }))
    );
    const host = await screen.findByTestId("reader-shadow-host-1");
    await waitFor(() => expect(host.shadowRoot?.textContent).toContain("1번째 장면"));
    expect(screen.getByText(/compile 7.5ms/)).toBeTruthy();
  });

  it("updates config and saves a USER_DEFINED preset without recompiling Publication IR", async () => {
    const compilePublication = vi.fn(async () => readerCompileResult());
    const api = readerApi(compilePublication);
    renderWorkspace({ api });
    await screen.findByTestId("reader-preview-panes");
    expect(compilePublication).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("글자 크기"), {
      target: { value: "21" }
    });
    expect(compilePublication).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "새 preset 저장" }));
    await waitFor(() => expect(api.createReaderPreset).toHaveBeenCalledTimes(1));
    const request = vi.mocked(api.createReaderPreset).mock.calls[0]![0];
    expect(request.verificationStatus).toBe("USER_DEFINED");
    expect(request.sourceKind).toBe("CUSTOM");
    expect(request.sourceId).toBeNull();
    expect(request.sourceVersion).toBeNull();
    expect(request.config.platform.verificationStatus).toBe("USER_DEFINED");
    expect(request.config.platform.verifiedAt).toBeNull();
    expect(compilePublication).toHaveBeenCalledTimes(1);

    const presetSelect = screen.getByLabelText("Reader preset") as HTMLSelectElement;
    await waitFor(() =>
      expect(
        Array.from(presetSelect.options).filter((option) =>
          option.textContent?.includes("중복 이름")
        )
      ).toHaveLength(2)
    );

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(api.deleteReaderPreset).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        Array.from(presetSelect.options).filter((option) =>
          option.textContent?.includes("중복 이름")
        )
      ).toHaveLength(0)
    );
    confirm.mockRestore();
    expect(compilePublication).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "3 pane" }));
    await waitFor(() =>
      expect(screen.getAllByTestId(/reader-shadow-host-/)).toHaveLength(3)
    );
    const tabs = screen.getAllByRole("tab");
    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: "End" });
    await waitFor(() => expect(document.activeElement).toBe(tabs[2]));
    expect(tabs[2]?.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("Reader 범위").tagName).toBe("SELECT");
    expect(presetSelect.tagName).toBe("SELECT");
  });

  it("revalidates restored presets and UI state without a preset-only IR recompile", async () => {
    const builtin = BUILTIN_READER_PRESETS[0]!;
    const stored = storedPresetFromRequest({
      sessionId: "session-1",
      name: "snapshot preset",
      sourceKind: "CUSTOM",
      sourceId: builtin.sourceId,
      sourceVersion: builtin.sourceVersion,
      verificationStatus: "USER_DEFINED",
      config: {
        ...builtin.config,
        platform: {
          ...builtin.config.platform,
          verificationStatus: "USER_DEFINED",
          verifiedAt: null
        }
      }
    }, "snapshot-preset");
    const listReaderPresets = vi
      .fn<ReaderLabApi["listReaderPresets"]>()
      .mockResolvedValueOnce({
        presets: [stored],
        duplicateNames: [],
        revision: 5
      })
      .mockResolvedValueOnce({
        presets: [],
        duplicateNames: [],
        revision: 5
      });
    const persisted = defaultReaderLabUiState("scene-1");
    const api = {
      ...readerApi(),
      listReaderPresets,
      loadReaderLabUiState: vi.fn(async () => ({
        state: {
          ...persisted,
          panes: persisted.panes.map((pane, index) =>
            index === 0 ? { ...pane, presetId: stored.id } : pane
          )
        }
      }))
    } satisfies ReaderLabApi;
    const rendered = renderWorkspace({ api });
    await screen.findByTestId("reader-preview-panes");
    const presetSelect = screen.getByLabelText("Reader preset") as HTMLSelectElement;
    expect(presetSelect.value).toBe(stored.id);
    expect(api.compilePublication).toHaveBeenCalledTimes(1);

    rendered.rerender(
      <ReaderLabWorkspace {...rendered.props} reloadToken={1} />
    );
    await waitFor(() => expect(listReaderPresets).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(presetSelect.value).toBe(builtin.id));
    expect(api.loadReaderLabUiState).toHaveBeenCalledTimes(2);
    expect(api.compilePublication).toHaveBeenCalledTimes(1);
  });
});
