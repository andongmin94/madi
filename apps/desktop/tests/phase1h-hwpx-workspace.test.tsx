import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { HwpxExportWorkspace } from "../src/renderer/components/hwpxExport/HwpxExportWorkspace";
import type { PublicationExportModeHandle } from "../src/renderer/components/PublicationExportMode";
import { BUILT_IN_HWPX_PRESETS } from "../src/shared/hwpxBuiltins";
import type { MadiDesktopApi, ProjectTree } from "../src/shared/contracts";
import type {
  CreateHwpxExportPresetRequest,
  HwpxExportPresetRecord,
  HwpxExportReport,
  HwpxExportState,
  RunHwpxExportRequest,
  RunHwpxExportResult,
  ValidateHwpxExportRequest
} from "../src/shared/hwpxExport";
import { phase1cApiStubs } from "./phase1c-api-stubs";

const NOW = "2026-08-13T00:00:00.000Z";

const tree: ProjectTree = {
  project: {
    id: "project-1",
    title: "바람 & 별",
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
      title: "바람 & 별",
      orderKey: 1024,
      documentId: null,
      createdAt: NOW,
      updatedAt: NOW
    },
    {
      id: "scene-1",
      projectId: "project-1",
      parentId: "work-1",
      kind: "SCENE",
      title: "첫 장면",
      orderKey: 2048,
      documentId: "document-1",
      createdAt: NOW,
      updatedAt: NOW
    }
  ],
  revision: 7
};

function state(
  overrides: Partial<HwpxExportState> = {}
): HwpxExportState {
  return {
    metadata: {
      projectId: "project-1",
      publicationTitle: "바람 & 별",
      creatorName: "마디 작가",
      language: "ko",
      identifier: "urn:madi:publication:project-1",
      publisher: null,
      description: null,
      rights: null,
      subjects: [],
      coverAssetId: null,
      createdAt: NOW,
      updatedAt: NOW
    },
    presets: [],
    duplicatePresetNames: [],
    revision: 7,
    ...overrides
  };
}

function report(): HwpxExportReport {
  return {
    formatVersion: 1,
    outputType: "HWPX",
    packageProfile: "HANCOM_OFFICIAL_MODEL_1_31",
    sourceScope: "WORK",
    sourceScopeNodeId: "work-1",
    sourceProjectRevision: 7,
    sourcePublicationHash: "a".repeat(64),
    presetId: "GENERAL_SUBMISSION",
    presetContentHash: "b".repeat(64),
    hwpxSha256: "c".repeat(64),
    outputSha256: "c".repeat(64),
    logicalPackageHash: "d".repeat(64),
    byteLength: 4096,
    coverage: {
      packageSectionCount: 1,
      sourceSectionCount: 1,
      exportedSectionCount: 1,
      sourceBlockCount: 3,
      exportedBlockCount: 3,
      fallbackBlockCount: 0,
      configuredOmissionBlockCount: 0,
      rejectedBlockCount: 0,
      sourceCharacterCount: 120,
      exportedCharacterCount: 120,
      paragraphCount: 3,
      runCount: 4,
      headingCount: 1,
      sceneBreakCount: 0,
      rubyCount: 0,
      inlineModifierCount: 1
    },
    validation: {
      status: "VALID",
      fatalCount: 0,
      errorCount: 0,
      warningCount: 0,
      infoCount: 1,
      messages: [
        {
          severity: "INFO",
          code: "MADI_HWPX_OK",
          description: "내부 검증을 통과했습니다.",
          suggestion: null,
          sourceNodeId: "scene-1",
          sectionId: "section0",
          hwpxPath: "Contents/section0.xml"
        }
      ]
    },
    fontFamily: "함초롬바탕",
    fontInstalled: null,
    page: {
      pageSizeToken: "A4",
      customPageWidth: null,
      customPageHeight: null,
      orientation: "PORTRAIT",
      marginTop: 25,
      marginBottom: 25,
      marginLeft: 25,
      marginRight: 25,
      headerMargin: 15,
      footerMargin: 15,
      gutter: 0,
      includeTitlePage: true,
      includePageNumber: true,
      pageNumberStart: 1,
      pageNumberPosition: "BOTTOM_CENTER",
      includeHeader: false,
      headerHasText: false,
      includeFooter: false,
      footerHasText: false
    },
    timing: {
      publicationIrCompileMs: 1,
      semanticMappingMs: 1,
      styleTableMs: 1,
      sectionXmlMs: 2,
      packageDocumentsMs: 1,
      zipPackagingMs: 1,
      internalValidationMs: 1,
      zipReopenMs: 1,
      sourceCoverageMs: 1,
      exporterTotalMs: 9,
      totalMs: 10,
    },
    generatedAt: NOW,
    madiVersion: "0.0.1"
  };
}

function customPreset(): HwpxExportPresetRecord {
  return {
    id: "preset-1",
    projectId: "project-1",
    kind: "HWPX",
    name: "나의 설정",
    presetFormat: "MADI_EXPORT_PRESET",
    presetVersion: 1,
    config: BUILT_IN_HWPX_PRESETS[0]!.config,
    contentHash: "e".repeat(64),
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function harness(
  options: {
    readonly getState?: () => Promise<HwpxExportState>;
    readonly handle?: ReturnType<typeof createRef<PublicationExportModeHandle>>;
    readonly onBeforeExport?: () => Promise<number | null>;
    readonly onProjectRevision?: (revision: number) => void;
    readonly run?: (
      request: RunHwpxExportRequest
    ) => Promise<RunHwpxExportResult>;
  } = {}
) {
  let current = state();
  const getState = vi.fn(options.getState ?? (async () => current));
  const validate = vi.fn(async (request: ValidateHwpxExportRequest) => ({
    operationId: request.operationId,
    sourcePublicationHash: "a".repeat(64),
    report: report(),
    revision: 7
  }));
  const run = vi.fn(
    options.run ??
      (async (request: RunHwpxExportRequest): Promise<RunHwpxExportResult> => ({
        status: "COMPLETED",
        operationId: request.operationId,
        fileName: "바람과-별.hwpx",
        byteLength: 4096,
        sha256: "c".repeat(64),
        report: report(),
        revision: 7
      }))
  );
  const createPreset = vi.fn(async (_request: CreateHwpxExportPresetRequest) => {
    const preset = customPreset();
    current = state({ ...current, presets: [preset] });
    return { preset, revision: 8, noOp: false };
  });
  const api = {
    ...phase1cApiStubs(),
    getHwpxExportState: getState,
    validateHwpxExport: validate,
    runHwpxExport: run,
    chooseHwpxOutput: vi.fn(async () => ({
      selectionId: "selection-1",
      fileName: "바람과-별.hwpx",
    })),
    createHwpxExportPreset: createPreset,
    onHwpxExportProgress: vi.fn(() => () => undefined)
  } as unknown as MadiDesktopApi;
  const onBeforeExport = vi.fn(options.onBeforeExport ?? (async () => 7));

  const workspace = (onProjectRevision: (revision: number) => void) => (
    <HwpxExportWorkspace
      ref={options.handle}
      api={api}
      sessionId="session-1"
      projectId="project-1"
      projectRevision={7}
      projectTree={tree}
      initialScopeNodeId="work-1"
      reloadToken={0}
      interactionBlocked={false}
      onBeforeExport={onBeforeExport}
      onProjectRevision={onProjectRevision}
      onOpenSource={vi.fn()}
      onOperationBusyChange={vi.fn()}
    />
  );
  const rendered = render(workspace(options.onProjectRevision ?? vi.fn()));
  return {
    api, createPreset, getState, onBeforeExport, run, validate,
    rerender(onProjectRevision: (revision: number) => void) {
      rendered.rerender(workspace(onProjectRevision));
    }
  };
}

describe("Phase 1H HWPX export workspace", () => {
  it("rejects canonical state from another project before updating the parent revision", async () => {
    const onProjectRevision = vi.fn();
    const { validate, run } = harness({
      onProjectRevision,
      getState: async () => state({
        metadata: { ...state().metadata, projectId: "other-project" }
      })
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "현재 프로젝트의 HWPX 내보내기 상태가 아닙니다."
    );
    expect(onProjectRevision).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "출력 파일 선택" })).toBeNull();
  });

  it("rejects a different project returned during export preparation", async () => {
    let loads = 0;
    const onProjectRevision = vi.fn();
    const { validate, run } = harness({
      onProjectRevision,
      getState: async () => ++loads === 1 ? state() : state({
        metadata: { ...state().metadata, projectId: "other-project" },
        revision: 99
      })
    });
    await screen.findByRole("region", { name: "한글 문서 내보내기" });
    fireEvent.click(screen.getByRole("button", { name: "사전 검사" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "현재 프로젝트의 HWPX 내보내기 상태가 아닙니다."
    );
    expect(onProjectRevision).toHaveBeenCalledTimes(1);
    expect(onProjectRevision).toHaveBeenCalledWith(7);
    expect(validate).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("does not reload canonical state when parent revision callback identity changes", async () => {
    const firstCallback = vi.fn();
    const latestCallback = vi.fn();
    const { getState, rerender } = harness({ onProjectRevision: firstCallback });
    await screen.findByRole("region", { name: "한글 문서 내보내기" });
    expect(getState).toHaveBeenCalledTimes(1);
    expect(firstCallback).toHaveBeenCalledWith(7);

    await act(async () => {
      rerender(latestCallback);
    });
    expect(getState).toHaveBeenCalledTimes(1);
    expect(latestCallback).not.toHaveBeenCalled();
  });

  it("uses the latest parent revision callback for an explicit canonical reload", async () => {
    const handle = createRef<PublicationExportModeHandle>();
    const firstCallback = vi.fn();
    const latestCallback = vi.fn();
    let loads = 0;
    const { getState, rerender } = harness({
      handle,
      onProjectRevision: firstCallback,
      getState: async () => state({ revision: ++loads === 1 ? 7 : 8 })
    });
    await screen.findByRole("region", { name: "한글 문서 내보내기" });
    await act(async () => {
      rerender(latestCallback);
    });
    firstCallback.mockClear();
    latestCallback.mockClear();
    await act(async () => {
      await handle.current!.reload();
    });
    expect(getState).toHaveBeenCalledTimes(2);
    expect(firstCallback).not.toHaveBeenCalled();
    expect(latestCallback).toHaveBeenCalledTimes(1);
    expect(latestCallback).toHaveBeenCalledWith(8);
  });

  it("exposes labelled HWPX document settings", async () => {
    harness();
    const region = await screen.findByRole("region", {
      name: "한글 문서 내보내기"
    });
    expect(region.getAttribute("data-hwpx-output-type")).toBe("HWPX");
    expect(screen.queryByRole("combobox", { name: "출력 형식" })).toBeNull();
    expect(screen.queryByRole("button", { name: "HWP 내보내기" })).toBeNull();
    expect(screen.getByLabelText("본문 글꼴")).toBeTruthy();
    expect(screen.getByLabelText("문단 앞 간격(pt)")).toBeTruthy();
    expect(screen.getByRole("region", { name: "화 제목" })).toBeTruthy();
    expect(screen.getByLabelText("페이지 번호 위치")).toBeTruthy();
    expect(screen.getByLabelText("연락처(일회성, report 제외)")).toBeTruthy();
  });

  it("requires current preflight, then exports the opaque selected destination", async () => {
    const { api, onBeforeExport, run, validate } = harness();
    await screen.findByRole("region", { name: "한글 문서 내보내기" });

    fireEvent.change(screen.getByLabelText("연락처(일회성, report 제외)"), {
      target: { value: "writer@example.test" }
    });
    fireEvent.click(screen.getByRole("button", { name: "출력 파일 선택" }));
    await screen.findByText("선택한 파일: 바람과-별.hwpx");
    expect((screen.getByRole("button", { name: "HWPX 내보내기" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "사전 검사" }));
    await screen.findByRole("heading", { name: "사전 검사: VALID" });
    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate.mock.calls[0]![0]).toMatchObject({
      sessionId: "session-1",
      scopeNodeId: "work-1",
      scopeKind: "WORK",
      expectedProjectRevision: 7,
      titlePage: { contact: "writer@example.test" }
    });

    const exportButton = screen.getByRole("button", { name: "HWPX 내보내기" });
    await waitFor(() => expect((exportButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(exportButton);
    await screen.findByRole("status", { name: "HWPX 내보내기 완료" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toMatchObject({
      outputSelectionId: "selection-1",
    });
    expect(onBeforeExport).toHaveBeenCalledTimes(2);
    expect(api.chooseHwpxOutput).toHaveBeenCalledTimes(1);
  });

  it("invalidates a successful preflight after settings change", async () => {
    harness();
    await screen.findByRole("region", { name: "한글 문서 내보내기" });
    fireEvent.click(screen.getByRole("button", { name: "출력 파일 선택" }));
    await screen.findByText("선택한 파일: 바람과-별.hwpx");
    fireEvent.click(screen.getByRole("button", { name: "사전 검사" }));
    await screen.findByRole("heading", { name: "사전 검사: VALID" });

    fireEvent.change(screen.getByLabelText("본문 크기(pt)"), {
      target: { value: "12" }
    });
    expect(screen.queryByRole("heading", { name: "사전 검사: VALID" })).toBeNull();
    expect((screen.getByRole("button", { name: "HWPX 내보내기" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("copies a built-in preset into canonical project storage", async () => {
    const { createPreset } = harness();
    await screen.findByRole("region", { name: "한글 문서 내보내기" });
    fireEvent.change(screen.getByLabelText("저장 이름"), {
      target: { value: "출판사 A 제출본" }
    });
    fireEvent.click(screen.getByRole("button", { name: "새 preset 저장" }));
    await waitFor(() => expect(createPreset).toHaveBeenCalledTimes(1));
    expect(createPreset.mock.calls[0]![0]).toMatchObject({
      sessionId: "session-1",
      name: "출판사 A 제출본",
      config: BUILT_IN_HWPX_PRESETS[0]!.config
    });
  });

  it("drains pending canonical loads before close and seals post-close IPC", async () => {
    const handle = createRef<PublicationExportModeHandle>();
    const pending = deferred<HwpxExportState>();
    let calls = 0;
    const { getState } = harness({
      handle,
      getState: async () => {
        calls += 1;
        return calls === 1 ? state() : pending.promise;
      }
    });
    await screen.findByRole("region", { name: "한글 문서 내보내기" });

    const reload = handle.current!.reload();
    let closeSettled = false;
    const close = handle.current!.prepareToClose().then((value) => {
      closeSettled = true;
      return value;
    });
    await Promise.resolve();
    expect(closeSettled).toBe(false);
    pending.resolve(state());
    await reload;
    await expect(close).resolves.toBe(true);
    expect(getState).toHaveBeenCalledTimes(2);

    await handle.current!.reload();
    expect(getState).toHaveBeenCalledTimes(2);
  });

  it("hands a saved pending canonical request to close without launching validation later", async () => {
    const handle = createRef<PublicationExportModeHandle>();
    const pending = deferred<HwpxExportState>();
    let calls = 0;
    const { getState, validate } = harness({
      handle,
      getState: async () => {
        calls += 1;
        return calls === 1 ? state() : pending.promise;
      }
    });
    await screen.findByRole("region", { name: "한글 문서 내보내기" });

    fireEvent.click(screen.getByRole("button", { name: "사전 검사" }));
    await waitFor(() => expect(getState).toHaveBeenCalledTimes(2));
    await expect(handle.current!.prepareToClose()).resolves.toBe(true);
    expect(validate).not.toHaveBeenCalled();

    pending.resolve(state());
    await Promise.resolve();
    await Promise.resolve();
    expect(validate).not.toHaveBeenCalled();
  });

  it("waits for local save preparation before approving close", async () => {
    const handle = createRef<PublicationExportModeHandle>();
    const save = deferred<number | null>();
    const { getState, validate } = harness({
      handle,
      onBeforeExport: () => save.promise
    });
    await screen.findByRole("region", { name: "한글 문서 내보내기" });

    fireEvent.click(screen.getByRole("button", { name: "사전 검사" }));
    let closeSettled = false;
    const close = handle.current!.prepareToClose().then((result) => {
      closeSettled = true;
      return result;
    });
    await Promise.resolve();
    expect(closeSettled).toBe(false);

    save.resolve(7);
    await expect(close).resolves.toBe(true);
    expect(getState).toHaveBeenCalledTimes(1);
    expect(validate).not.toHaveBeenCalled();
  });
});
