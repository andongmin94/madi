import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BrowserWindow } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DesktopService,
  type DialogPort,
  type ShellPort
} from "../src/main/desktopService";
import type { CoreClient, CoreMethod } from "../src/main/coreClient";
import type {
  HwpxExporterPort,
  HwpxExporterRunInput,
  HwpxUtilityResult
} from "../src/main/hwpxExportClient";
import type { HwpBridgePort } from "../src/main/hwpBridgeClient";
import { HwpBridgeOperationError } from "../src/main/hwpBridgeClient";
import type { FontInstallationPort } from "../src/main/fontInstallation";
import type { HwpxCrashRecoveryPort } from "../src/main/hwpxCrashRecovery";
import { ProjectSessionRegistry } from "../src/main/projectSessions";
import { BUILT_IN_HWPX_PRESETS } from "../src/shared/hwpxBuiltins";
import type {
  HwpxExportPresetConfig,
  PublicationExportMetadata,
  RunHwpxExportRequest
} from "../src/shared/contracts";
import { readerPublication } from "./reader-lab-fixtures";

const NOW = "2026-08-13T00:00:00.000Z";
const SOURCE_HASH = "a".repeat(64);
const LOGICAL_HASH = "b".repeat(64);
const OPERATION_1 = "123e4567-e89b-42d3-a456-426614174000";
const OPERATION_2 = "123e4567-e89b-42d3-a456-426614174001";
const OPERATION_3 = "123e4567-e89b-42d3-a456-426614174002";
const OPERATION_4 = "123e4567-e89b-42d3-a456-426614174003";
const OPERATION_5 = "123e4567-e89b-42d3-a456-426614174004";
const OPERATION_6 = "123e4567-e89b-42d3-a456-426614174005";
const OPERATION_7 = "123e4567-e89b-42d3-a456-426614174006";
const OPERATION_8 = "123e4567-e89b-42d3-a456-426614174007";
const OPERATION_9 = "123e4567-e89b-42d3-a456-426614174008";
const OPERATION_10 = "123e4567-e89b-42d3-a456-426614174009";
const OPERATION_11 = "123e4567-e89b-42d3-a456-426614174010";
const OPERATION_12 = "123e4567-e89b-42d3-a456-426614174011";
const OPERATION_13 = "123e4567-e89b-42d3-a456-426614174012";
const OPERATION_14 = "123e4567-e89b-42d3-a456-426614174013";
const GENERATED_HWPX = Buffer.from("content-free HWPX fixture", "utf8");
const GENERATED_HWP = Buffer.from("content-free HWP fixture", "utf8");
const CONFIG = BUILT_IN_HWPX_PRESETS[0]!.config;
const temporaryDirectories: string[] = [];

// Exact bytes and hashes from native madi-core create/list/reopen on 451e085.
const CORE_CANONICAL_PRESETS = [
  {
    label: "default",
    canonicalJson: '{"chapterTitleStyle":{"alignment":"LEFT","bold":true,"fontFamilyToken":"함초롬바탕","fontSizePt":15.0,"pageBreakBefore":true,"spacingAfter":12.0,"spacingBefore":18.0},"customPageHeight":null,"customPageWidth":null,"firstLineIndent":10.0,"fontFamilyToken":"함초롬바탕","fontSizePt":10.5,"footerMargin":15.0,"footerText":"","formatVersion":1,"gutter":0.0,"headerMargin":15.0,"headerText":"","includeChapterTitles":true,"includeFooter":false,"includeHeader":false,"includePageNumber":true,"includeSceneTitles":false,"includeTitlePage":true,"includeVolumeTitles":true,"includeWorkTitle":true,"lineSpacingMode":"PERCENT","lineSpacingValue":180.0,"marginBottom":25.0,"marginLeft":25.0,"marginRight":25.0,"marginTop":25.0,"orientation":"PORTRAIT","pageNumberPosition":"BOTTOM_CENTER","pageNumberStart":1,"pageSizeToken":"A4","paragraphSpacingAfter":0.0,"paragraphSpacingBefore":0.0,"sceneBreakToken":"ORNAMENT","sceneTitleStyle":{"alignment":"LEFT","bold":true,"fontFamilyToken":"함초롬바탕","fontSizePt":12.0,"pageBreakBefore":false,"spacingAfter":8.0,"spacingBefore":12.0},"sectionSplitMode":"SINGLE","textAlign":"JUSTIFY","volumeTitleStyle":{"alignment":"CENTER","bold":true,"fontFamilyToken":"함초롬바탕","fontSizePt":18.0,"pageBreakBefore":true,"spacingAfter":16.0,"spacingBefore":20.0},"workTitleStyle":{"alignment":"CENTER","bold":true,"fontFamilyToken":"함초롬바탕","fontSizePt":22.0,"pageBreakBefore":false,"spacingAfter":24.0,"spacingBefore":0.0}}',
    contentHash: "826810390023a4a81e0ffb6fdc8a4ed593028e91109e9ae5afcb7a83f6955c55",
    jsHash: "db3fd19980e96fd69b73c5c27ec3490549aa35836133bbc4ab95f57099989426"
  },
  {
    label: "custom fractional",
    canonicalJson: '{"chapterTitleStyle":{"alignment":"LEFT","bold":true,"fontFamilyToken":"함초롬바탕","fontSizePt":15.0,"pageBreakBefore":true,"spacingAfter":12.0,"spacingBefore":18.0},"customPageHeight":null,"customPageWidth":null,"firstLineIndent":10.0,"fontFamilyToken":"함초롬바탕","fontSizePt":11.5,"footerMargin":15.0,"footerText":"","formatVersion":1,"gutter":0.0,"headerMargin":15.0,"headerText":"","includeChapterTitles":true,"includeFooter":false,"includeHeader":false,"includePageNumber":true,"includeSceneTitles":false,"includeTitlePage":true,"includeVolumeTitles":true,"includeWorkTitle":true,"lineSpacingMode":"PERCENT","lineSpacingValue":187.5,"marginBottom":25.0,"marginLeft":25.0,"marginRight":25.0,"marginTop":25.0,"orientation":"PORTRAIT","pageNumberPosition":"BOTTOM_CENTER","pageNumberStart":1,"pageSizeToken":"A4","paragraphSpacingAfter":0.0,"paragraphSpacingBefore":0.0,"sceneBreakToken":"ORNAMENT","sceneTitleStyle":{"alignment":"LEFT","bold":true,"fontFamilyToken":"함초롬바탕","fontSizePt":12.0,"pageBreakBefore":false,"spacingAfter":8.0,"spacingBefore":12.0},"sectionSplitMode":"SINGLE","textAlign":"JUSTIFY","volumeTitleStyle":{"alignment":"CENTER","bold":true,"fontFamilyToken":"함초롬바탕","fontSizePt":18.0,"pageBreakBefore":true,"spacingAfter":16.0,"spacingBefore":20.0},"workTitleStyle":{"alignment":"CENTER","bold":true,"fontFamilyToken":"함초롬바탕","fontSizePt":22.0,"pageBreakBefore":false,"spacingAfter":24.0,"spacingBefore":0.0}}',
    contentHash: "a6a6e9cb66e883e23fc7c76c95a2da3a832d79d9cfbcae40cdad42ec70441f47",
    jsHash: "47e965abacc99a58e154178e4a9f5a66fd114c5171a71e7384ca17d89e818770"
  }
] as const;

const METADATA: PublicationExportMetadata = {
  projectId: "project-1",
  publicationTitle: "테스트 작품",
  creatorName: "테스트 작가",
  language: "ko",
  identifier: "urn:madi:test:project-1",
  publisher: null,
  description: null,
  rights: null,
  subjects: [],
  coverAssetId: null,
  createdAt: NOW,
  updatedAt: NOW
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function persistedMetadata(): Record<string, unknown> {
  return {
    project_id: METADATA.projectId,
    publication_title: METADATA.publicationTitle,
    creator_name: METADATA.creatorName,
    language: METADATA.language,
    identifier: METADATA.identifier,
    publisher: METADATA.publisher,
    description: METADATA.description,
    rights: METADATA.rights,
    subjects: METADATA.subjects,
    cover_asset_id: null,
    created_at: NOW,
    updated_at: NOW
  };
}

function persistedHwpxPreset(
  id = "custom-hwpx",
  config: HwpxExportPresetConfig = CONFIG,
  revision = 2,
  contentHash: string = CORE_CANONICAL_PRESETS[0].contentHash
): Record<string, unknown> {
  return {
    id,
    project_id: METADATA.projectId,
    kind: "HWPX",
    name: "사용자 HWPX",
    preset_format: "MADI_EXPORT_PRESET",
    preset_version: 1,
    preset_json: config,
    content_hash: contentHash,
    revision,
    created_at: NOW,
    updated_at: NOW
  };
}

function exportState(
  exportPresets: readonly Record<string, unknown>[] = [persistedHwpxPreset()]
): Record<string, unknown> {
  return {
    metadata: { revision: 5 },
    publication_metadata: persistedMetadata(),
    cover_asset: null,
    export_presets: exportPresets,
    revision: 5
  };
}

function utilityResult(
  input: HwpxExporterRunInput,
  document: ReturnType<typeof readerPublication>
): HwpxUtilityResult {
  const blocks = document.sections.flatMap((section) => section.blocks);
  return {
    mode: input.mode,
    outputPath: input.mode === "EXPORT" ? input.outputPath : null,
    summary: {
      byteLength: GENERATED_HWPX.byteLength,
      sha256: sha256(GENERATED_HWPX),
      logicalPackageHash: LOGICAL_HASH,
      packageXmlVersion: "1.31",
      sourcePublicationHash: input.sourcePublicationHash,
      presetId: input.presetId,
      presetContentHash: input.presetContentHash,
      fontFamily: input.config.fontFamilyToken,
      validationReport: {
        status: "PASS",
        fatalCount: 0,
        errorCount: 0,
        warningCount: 1,
        infoCount: 0,
        messages: [
          {
            code: "HWPX_CONFIGURED_HEADING_OMISSION",
            severity: "WARNING",
            description: "제목 텍스트를 일반 문단으로 보존했습니다.",
            sourceNodeId: document.sections[0]!.sourceNodeId,
            hwpxPath: "Contents/section0.xml",
            suggestion: null
          }
        ]
      },
      exportTiming: {
        semanticMappingMs: 1,
        styleTableMs: 1,
        sectionXmlMs: 1,
        packageDocumentsMs: 1,
        zipPackagingMs: 1,
        internalValidationMs: 1,
        zipReopenMs: 1,
        sourceCoverageMs: 1,
        exporterTotalMs: 8
      },
      statistics: {
        fileCount: 9,
        sectionCount: 1,
        exportedSectionCount: document.sections.length,
        paragraphCount: blocks.length + 3,
        runCount: blocks.length + 3,
        textCount: blocks.length + 2,
        sourceSectionCount: document.sections.length,
        sourceBlockCount: blocks.length,
        exportedBlockCount: blocks.length - 1,
        fallbackBlockCount: 0,
        configuredOmissionBlockCount: 1,
        rejectedBlockCount: 0,
        sourceCharacterCount: document.stats.withSpaces,
        exportedCharacterCount: document.stats.withSpaces,
        headingCount: 0,
        sceneBreakCount: 0,
        rubyCount: 0,
        rubyFallbackCount: 0,
        strongSegmentCount: 0,
        emphasisSegmentCount: 0,
        underlineSegmentCount: 0,
        strikeSegmentCount: 0
      }
    }
  };
}

function createHarness(options: {
  readonly bridge?: HwpBridgePort;
  readonly fontInstallation?: FontInstallationPort;
  readonly preset?: Record<string, unknown>;
} = {}) {
  const document = readerPublication({ revision: 5 });
  const request = vi.fn(
    async (
      method: CoreMethod,
      params: Readonly<Record<string, unknown>>
    ): Promise<unknown> => {
      if (method === "get_publication_export_state") {
        return options.preset ? exportState([options.preset]) : exportState();
      }
      if (method === "compile_publication") {
        return {
          metadata: { revision: 5 },
          document,
          content_hash: SOURCE_HASH,
          diagnostics: [],
          compile_timing_ms: 1,
          revision: 5
        };
      }
      if (method === "create_export_preset") {
        return {
          metadata: { revision: 6 },
          preset: {
            ...persistedHwpxPreset(params.preset_id as string, params.preset_json as HwpxExportPresetConfig, 0),
            name: params.name
          },
          no_op: false,
          revision: 6
        };
      }
      throw new Error(`Unexpected core method: ${method}`);
    }
  );
  const core: CoreClient = { request, dispose: vi.fn() };
  const sessions = new ProjectSessionRegistry();
  const session = sessions.add({
    filePath: "C:\\drafts\\phase1h.madi",
    projectId: "project-1",
    title: "테스트 작품",
    revision: 5
  });
  const dialog: DialogPort = {
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] }))
  };
  const run = vi.fn(
    async (input: HwpxExporterRunInput): Promise<HwpxUtilityResult> => {
      if (input.mode === "EXPORT") {
        await writeFile(input.outputPath, GENERATED_HWPX);
      }
      return utilityResult(input, document);
    }
  );
  const exporter: HwpxExporterPort = {
    run,
    cancel: vi.fn(async () => false),
    dispose: vi.fn(async () => undefined)
  };
  const send = vi.fn();
  const window = { webContents: { send } } as unknown as BrowserWindow;
  const shell: ShellPort = { showItemInFolder: vi.fn() };
  const fontInstallation: FontInstallationPort =
    options.fontInstallation ?? { isInstalled: vi.fn(async () => true) };
  const crashRecovery: HwpxCrashRecoveryPort = {
    initialize: vi.fn(async () => undefined),
    register: vi.fn(async () => undefined),
    prepareAtomicOutput: vi.fn(async () => undefined),
    markAtomicOutputTerminal: vi.fn(async () => undefined),
    reconcileAtomicOutput: vi.fn(async () => ({
      status: "SAFE" as const,
      recoveryFileName: null
    })),
    remove: vi.fn(async () => undefined)
  };
  const service = new DesktopService(
    window,
    dialog,
    core,
    sessions,
    "0.0.1",
    undefined,
    shell,
    exporter,
    options.bridge,
    fontInstallation,
    "win32",
    crashRecovery
  );
  return {
    dialog,
    document,
    request,
    run,
    crashRecovery,
    service,
    session,
    sessions,
    shell,
    send
  };
}

function runRequest(
  sessionId: string,
  operationId: string,
  outputSelectionId: string,
  overrides: Partial<RunHwpxExportRequest> = {}
): RunHwpxExportRequest {
  return {
    sessionId,
    operationId,
    scopeNodeId: "scene-1",
    scopeKind: "SCENE",
    expectedProjectRevision: 5,
    presetId: "GENERAL_SUBMISSION",
    presetContentHash: "0".repeat(64),
    metadata: METADATA,
    config: CONFIG,
    titlePage: { subtitle: null, genre: null, contact: null },
    outputSelectionId,
    outputType: "HWPX",
    ...overrides
  };
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "madi-hwpx-service-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("Phase 1H DesktopService HWPX trust boundary", () => {
  it("filters mixed core presets and sends the mandatory HWPX kind on create", async () => {
    const harness = createHarness();
    await expect(
      harness.service.getPublicationExportState({
        sessionId: harness.session.sessionId
      })
    ).resolves.toMatchObject({ presets: [] });
    await expect(
      harness.service.getHwpxExportState({ sessionId: harness.session.sessionId })
    ).resolves.toMatchObject({
      presets: [{ id: "custom-hwpx", kind: "HWPX" }]
    });

    await harness.service.createHwpxExportPreset({
      sessionId: harness.session.sessionId,
      name: "새 HWPX",
      config: CONFIG
    });
    const createCall = harness.request.mock.calls.find(
      ([method]) => method === "create_export_preset"
    );
    expect(createCall?.[1]).toMatchObject({
      kind: "HWPX",
      name: "새 HWPX",
      preset_json: CONFIG,
      expected_revision: 5
    });
  });

  it.each(CORE_CANONICAL_PRESETS)(
    "accepts the native core-canonical $label preset and forwards its exact hash",
    async ({ canonicalJson, contentHash, jsHash }) => {
      const config = JSON.parse(canonicalJson) as HwpxExportPresetConfig;
      expect(sha256(canonicalJson)).toBe(contentHash);
      expect(sha256(canonical(config))).toBe(jsHash);
      expect(jsHash).not.toBe(contentHash);
      const harness = createHarness({
        preset: persistedHwpxPreset("custom-hwpx", config, 2, contentHash)
      });
      const {
        outputSelectionId: _outputSelectionId,
        outputType: _outputType,
        ...validationRequest
      } = runRequest(harness.session.sessionId, OPERATION_1, "unused", {
        presetId: "custom-hwpx",
        presetContentHash: contentHash,
        config
      });

      const result = await harness.service.validateHwpxExport(validationRequest);
      expect(result.report.validation.status).toBe("VALID");
      expect(harness.run).toHaveBeenCalledTimes(1);
      expect(harness.run.mock.calls[0]![0]).toMatchObject({
        mode: "VALIDATE_ONLY",
        presetId: "custom-hwpx",
        presetContentHash: contentHash,
        config
      });
    }
  );

  it.each(["hash", "config"] as const)(
    "rejects a stale custom preset %s before compilation or utility startup",
    async (mismatch) => {
      const oracle = CORE_CANONICAL_PRESETS[1];
      const config = JSON.parse(oracle.canonicalJson) as HwpxExportPresetConfig;
      const harness = createHarness({
        preset: persistedHwpxPreset("custom-hwpx", config, 2, oracle.contentHash)
      });
      const {
        outputSelectionId: _outputSelectionId,
        outputType: _outputType,
        ...validationRequest
      } = runRequest(harness.session.sessionId, OPERATION_1, "unused", {
        presetId: "custom-hwpx",
        presetContentHash: mismatch === "hash" ? oracle.jsHash : oracle.contentHash,
        config: mismatch === "config" ? { ...config, marginTop: config.marginTop + 1 } : config
      });

      await expect(
        harness.service.validateHwpxExport(validationRequest)
      ).rejects.toThrow("The selected HWPX export preset is stale");
      expect(harness.request.mock.calls.map(([method]) => method)).toEqual([
        "get_publication_export_state"
      ]);
      expect(harness.run).not.toHaveBeenCalled();
    }
  );

  it("derives the built-in hash, verifies IR coverage, and commits staged bytes", async () => {
    const harness = createHarness();
    const directory = await makeTemporaryDirectory();
    const outputPath = path.join(directory, "submission.hwpx");
    vi.mocked(harness.dialog.showSaveDialog).mockResolvedValueOnce({
      canceled: false,
      filePath: outputPath
    });
    const selection = await harness.service.chooseHwpxOutput({
      sessionId: harness.session.sessionId,
      suggestedFileName: "submission.hwpx",
      outputType: "HWPX"
    });
    if (!selection) {
      throw new Error("expected HWPX selection");
    }

    const result = await harness.service.runHwpxExport(
      runRequest(harness.session.sessionId, OPERATION_1, selection.selectionId)
    );
    expect(result).toMatchObject({
      status: "COMPLETED",
      operationId: OPERATION_1,
      fileName: "submission.hwpx",
      sha256: sha256(GENERATED_HWPX),
      report: {
        validation: { status: "VALID" },
        coverage: {
          sourceBlockCount: 2,
          exportedBlockCount: 1,
          fallbackBlockCount: 0,
          configuredOmissionBlockCount: 1,
          rejectedBlockCount: 0
        }
      }
    });
    if (result.status !== "COMPLETED") {
      throw new Error("expected completed HWPX export");
    }
    expect(result.report.page).toEqual({
      pageSizeToken: CONFIG.pageSizeToken,
      customPageWidth: CONFIG.customPageWidth,
      customPageHeight: CONFIG.customPageHeight,
      orientation: CONFIG.orientation,
      marginTop: CONFIG.marginTop,
      marginBottom: CONFIG.marginBottom,
      marginLeft: CONFIG.marginLeft,
      marginRight: CONFIG.marginRight,
      headerMargin: CONFIG.headerMargin,
      footerMargin: CONFIG.footerMargin,
      gutter: CONFIG.gutter,
      includeTitlePage: CONFIG.includeTitlePage,
      includePageNumber: CONFIG.includePageNumber,
      pageNumberStart: CONFIG.pageNumberStart,
      pageNumberPosition: CONFIG.pageNumberPosition,
      includeHeader: CONFIG.includeHeader,
      headerHasText: CONFIG.headerText.length > 0,
      includeFooter: CONFIG.includeFooter,
      footerHasText: CONFIG.footerText.length > 0
    });
    expect(result.report.timing).toMatchObject({
      publicationIrCompileMs: 1,
      semanticMappingMs: 1,
      exporterTotalMs: 8,
      totalMs: 9
    });
    expect(harness.run.mock.calls[0]![0].presetContentHash).toBe(
      sha256(canonical(CONFIG))
    );
    expect(harness.run.mock.calls[0]![0].presetContentHash).not.toBe(
      "0".repeat(64)
    );
    const registeredPath = vi.mocked(harness.crashRecovery.register).mock
      .calls[0]![0];
    expect(path.basename(registeredPath)).toBe(
      `.madi-hwpx-operation-${OPERATION_1}`
    );
    expect(harness.crashRecovery.register).toHaveBeenCalledTimes(1);
    expect(harness.crashRecovery.remove).toHaveBeenCalledWith(registeredPath);
    expect(
      vi.mocked(harness.crashRecovery.register).mock.invocationCallOrder[0]
    ).toBeLessThan(harness.run.mock.invocationCallOrder[0]!);
    expect(harness.run.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(harness.crashRecovery.remove).mock.invocationCallOrder[0]!
    );
    await expect(readFile(outputPath)).resolves.toEqual(GENERATED_HWPX);
  });

  it("rejects a modified built-in configuration before starting the utility", async () => {
    const harness = createHarness();
    const directory = await makeTemporaryDirectory();
    const outputPath = path.join(directory, "submission.hwpx");
    vi.mocked(harness.dialog.showSaveDialog).mockResolvedValueOnce({
      canceled: false,
      filePath: outputPath
    });
    const selection = await harness.service.chooseHwpxOutput({
      sessionId: harness.session.sessionId,
      suggestedFileName: "submission.hwpx",
      outputType: "HWPX"
    });
    if (!selection) {
      throw new Error("expected HWPX selection");
    }

    await expect(
      harness.service.runHwpxExport(
        runRequest(harness.session.sessionId, OPERATION_2, selection.selectionId, {
          config: { ...CONFIG, marginTop: CONFIG.marginTop + 1 }
        })
      )
    ).rejects.toThrow("built-in preset configuration was modified");
    expect(harness.run).not.toHaveBeenCalled();
  });

  it("stages content-free JSON and Markdown reports without private text", async () => {
    const harness = createHarness();
    const directory = await makeTemporaryDirectory();
    const headerSentinel = "PRIVATE_HEADER_<script>_SENTINEL";
    const footerSentinel = "PRIVATE_FOOTER_[link]_SENTINEL";
    const contactSentinel = "private-contact@example.invalid";
    const bodySentinel = "한국어 Reader Lab 본문 1";
    const privateSentinels = [
      headerSentinel,
      footerSentinel,
      contactSentinel,
      bodySentinel
    ];
    const privateConfig: HwpxExportPresetConfig = {
      ...CONFIG,
      includeHeader: true,
      headerText: headerSentinel,
      includeFooter: true,
      footerText: footerSentinel
    };
    vi.mocked(harness.dialog.showSaveDialog)
      .mockResolvedValueOnce({
        canceled: false,
        filePath: path.join(directory, "submission.hwpx")
      })
      .mockResolvedValueOnce({
        canceled: false,
        filePath: path.join(directory, "report.json")
      })
      .mockResolvedValueOnce({
        canceled: false,
        filePath: path.join(directory, "report.md")
      });
    const selection = await harness.service.chooseHwpxOutput({
      sessionId: harness.session.sessionId,
      suggestedFileName: "submission.hwpx",
      outputType: "HWPX"
    });
    if (!selection) {
      throw new Error("expected HWPX selection");
    }
    const result = await harness.service.runHwpxExport(
      runRequest(harness.session.sessionId, OPERATION_2, selection.selectionId, {
        presetId: "ONE_OFF",
        presetContentHash: "0".repeat(64),
        config: privateConfig,
        titlePage: {
          subtitle: null,
          genre: null,
          contact: contactSentinel
        }
      })
    );
    if (result.status !== "COMPLETED") {
      throw new Error("expected completed private-text HWPX export");
    }
    expect(result.report.page).toMatchObject({
      includeHeader: true,
      headerHasText: true,
      includeFooter: true,
      footerHasText: true
    });
    for (const sentinel of privateSentinels) {
      expect(JSON.stringify(result.report)).not.toContain(sentinel);
    }
    vi.mocked(harness.crashRecovery.register).mockClear();
    vi.mocked(harness.crashRecovery.remove).mockClear();

    await expect(
      harness.service.saveHwpxExportReport({
        sessionId: harness.session.sessionId,
        operationId: OPERATION_2,
        format: "JSON"
      })
    ).resolves.toMatchObject({ fileName: "report.json" });
    await expect(
      harness.service.saveHwpxExportReport({
        sessionId: harness.session.sessionId,
        operationId: OPERATION_2,
        format: "MARKDOWN"
      })
    ).resolves.toMatchObject({ fileName: "report.md" });

    const registeredPath = vi.mocked(harness.crashRecovery.register).mock
      .calls[0]![0];
    expect(path.basename(registeredPath)).toBe(
      `.madi-hwpx-report-${OPERATION_2}-json`
    );
    expect(harness.crashRecovery.remove).toHaveBeenCalledWith(registeredPath);
    const jsonReport = await readFile(path.join(directory, "report.json"), "utf8");
    const markdownReport = await readFile(
      path.join(directory, "report.md"),
      "utf8"
    );
    expect(jsonReport).toContain('"formatVersion": 1');
    expect(markdownReport).toContain("# madi HWPX export report");
    expect(markdownReport).toContain("- Publication IR compile: 1 ms");
    expect(markdownReport).toContain("- HWPX semantic mapping: 1 ms");
    expect(markdownReport).toContain("- HWPX exporter: 8 ms");
    expect(markdownReport).toContain("- Total: 9 ms");
    for (const sentinel of privateSentinels) {
      expect(jsonReport).not.toContain(sentinel);
      expect(markdownReport).not.toContain(sentinel);
    }
  });

  it("fails closed when another writer claims a no-clobber destination", async () => {
    const harness = createHarness();
    const directory = await makeTemporaryDirectory();
    const outputPath = path.join(directory, "submission.hwpx");
    vi.mocked(harness.dialog.showSaveDialog).mockResolvedValueOnce({
      canceled: false,
      filePath: outputPath
    });
    const selection = await harness.service.chooseHwpxOutput({
      sessionId: harness.session.sessionId,
      suggestedFileName: "submission.hwpx",
      outputType: "HWPX"
    });
    if (!selection) {
      throw new Error("expected HWPX selection");
    }
    const foreign = Buffer.from("concurrent owner", "utf8");
    await writeFile(outputPath, foreign);

    await expect(
      harness.service.runHwpxExport(
        runRequest(harness.session.sessionId, OPERATION_3, selection.selectionId)
      )
    ).resolves.toEqual({
      status: "FAILED",
      operationId: OPERATION_3,
      code: "DESTINATION_CHANGED"
    });
    await expect(readFile(outputPath)).resolves.toEqual(foreign);
  });

  it("keeps validated HWPX staged, converts and reopens HWP, then commits only verified bytes", async () => {
    const convert = vi.fn(
      async (
        _operationId: string,
        inputHwpx: string,
        outputHwp: string
      ) => {
        await expect(readFile(inputHwpx)).resolves.toEqual(GENERATED_HWPX);
        await writeFile(outputHwp, GENERATED_HWP);
        return {
          outputPath: outputHwp,
          byteLength: GENERATED_HWP.byteLength,
          sha256: sha256(GENERATED_HWP),
          hancomVersion: "Hancom 2024"
        };
      }
    );
    const reopen = vi.fn(async () => ({
      verified: true as const,
      hancomVersion: "Hancom 2024"
    }));
    const bridge: HwpBridgePort = {
      probe: vi.fn(async () => ({
        available: true,
        availabilityCode: "AVAILABLE",
        hancomVersion: "Hancom 2024"
      })),
      convert,
      reopen,
      cancel: vi.fn(async () => false),
      dispose: vi.fn(async () => undefined)
    };
    const harness = createHarness({ bridge });
    const directory = await makeTemporaryDirectory();
    const outputPath = path.join(directory, "submission.hwp");
    vi.mocked(harness.dialog.showSaveDialog).mockResolvedValueOnce({
      canceled: false,
      filePath: outputPath
    });
    const selection = await harness.service.chooseHwpxOutput({
      sessionId: harness.session.sessionId,
      suggestedFileName: "submission.hwp",
      outputType: "HWP"
    });
    if (!selection) {
      throw new Error("expected HWP selection");
    }

    const result = await harness.service.runHwpxExport(
      runRequest(harness.session.sessionId, OPERATION_4, selection.selectionId, {
        outputType: "HWP"
      })
    );
    expect(result).toMatchObject({
      status: "COMPLETED",
      operationId: OPERATION_4,
      byteLength: GENERATED_HWP.byteLength,
      sha256: sha256(GENERATED_HWP),
      report: {
        outputType: "HWP",
        hwpxSha256: sha256(GENERATED_HWPX),
        outputSha256: sha256(GENERATED_HWP),
        preservedHwpxFileName: "submission.hwpx",
        byteLength: GENERATED_HWP.byteLength,
        hancomReopen: "PASSED",
        hwpConverted: true,
        timing: {
          hwpConversionMs: expect.any(Number),
          hwpReopenMs: expect.any(Number)
        }
      }
    });
    if (result.status !== "COMPLETED") {
      throw new Error("expected completed HWP export");
    }
    expect(result.report.timing.totalMs).toBe(
      result.report.timing.publicationIrCompileMs +
        result.report.timing.exporterTotalMs +
        (result.report.timing.hwpConversionMs ?? 0) +
        (result.report.timing.hwpReopenMs ?? 0)
    );
    expect(convert).toHaveBeenCalledWith(
      OPERATION_4,
      expect.stringMatching(/publication\.hwpx$/u),
      expect.stringMatching(/publication\.hwp$/u)
    );
    expect(reopen).toHaveBeenCalledWith(
      OPERATION_4,
      expect.stringMatching(/publication\.hwp$/u)
    );
    expect(
      harness.send.mock.calls.map(([, progress]) => progress)
    ).toEqual([
      {
        operationId: OPERATION_4,
        stage: "PUBLICATION_COMPILE",
        completed: 0,
        total: 1
      },
      {
        operationId: OPERATION_4,
        stage: "PUBLICATION_COMPILE",
        completed: 1,
        total: 1
      },
      {
        operationId: OPERATION_4,
        stage: "HWP_CONVERSION",
        completed: 0,
        total: 1
      },
      {
        operationId: OPERATION_4,
        stage: "HWP_CONVERSION",
        completed: 1,
        total: 1
      },
      {
        operationId: OPERATION_4,
        stage: "REOPEN_VERIFICATION",
        completed: 0,
        total: 1
      },
      {
        operationId: OPERATION_4,
        stage: "REOPEN_VERIFICATION",
        completed: 1,
        total: 1
      },
      {
        operationId: OPERATION_4,
        stage: "FINALIZE",
        completed: 0,
        total: 1
      },
      {
        operationId: OPERATION_4,
        stage: "FINALIZE",
        completed: 1,
        total: 1
      }
    ]);
    await expect(readFile(outputPath)).resolves.toEqual(GENERATED_HWP);
    await expect(
      readFile(path.join(directory, "submission.hwpx"))
    ).resolves.toEqual(GENERATED_HWPX);
  });

  it("reports registered-but-unverified Hancom and does not start an HWP export", async () => {
    const bridge: HwpBridgePort = {
      probe: vi.fn(async () => ({
        available: false,
        availabilityCode: "SECURITY_MODULE_REQUIRED",
        hancomVersion: "Hancom 2024"
      })),
      convert: vi.fn(),
      reopen: vi.fn(),
      cancel: vi.fn(async () => false),
      dispose: vi.fn(async () => undefined)
    };
    const harness = createHarness({ bridge });
    await expect(
      harness.service.getHwpxExportState({
        sessionId: harness.session.sessionId
      })
    ).resolves.toMatchObject({
      hancom: { status: "REGISTERED_UNVERIFIED", version: "Hancom 2024" }
    });
    const directory = await makeTemporaryDirectory();
    vi.mocked(harness.dialog.showSaveDialog).mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(directory, "submission.hwp")
    });
    const selection = await harness.service.chooseHwpxOutput({
      sessionId: harness.session.sessionId,
      suggestedFileName: "submission.hwp",
      outputType: "HWP"
    });
    if (!selection) {
      throw new Error("expected HWP selection");
    }
    await expect(
      harness.service.runHwpxExport(
        runRequest(harness.session.sessionId, OPERATION_5, selection.selectionId, {
          outputType: "HWP"
        })
      )
    ).resolves.toEqual({
      status: "FAILED",
      operationId: OPERATION_5,
      code: "HWP_CONVERSION_UNAVAILABLE"
    });
    expect(harness.run).not.toHaveBeenCalled();
  });

  it("adds a warning when the exact selected font is not installed", async () => {
    const fontInstallation: FontInstallationPort = {
      isInstalled: vi.fn(async () => false)
    };
    const harness = createHarness({ fontInstallation });
    const directory = await makeTemporaryDirectory();
    vi.mocked(harness.dialog.showSaveDialog).mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(directory, "font-warning.hwpx")
    });
    const selection = await harness.service.chooseHwpxOutput({
      sessionId: harness.session.sessionId,
      suggestedFileName: "font-warning.hwpx",
      outputType: "HWPX"
    });
    if (!selection) {
      throw new Error("expected HWPX selection");
    }
    const result = await harness.service.runHwpxExport(
      runRequest(harness.session.sessionId, OPERATION_6, selection.selectionId)
    );
    expect(result).toMatchObject({
      status: "COMPLETED",
      report: {
        fontInstalled: false,
        validation: {
          warningCount: 2,
          messages: expect.arrayContaining([
            expect.objectContaining({
              severity: "WARNING",
              code: "HWPX_FONT_NOT_INSTALLED"
            })
          ])
        }
      }
    });
    expect(fontInstallation.isInstalled).toHaveBeenCalledWith("함초롬바탕");
  });

  it("reports unverifiable font state honestly without claiming absence", async () => {
    const fontInstallation: FontInstallationPort = {
      isInstalled: vi.fn(async () => null)
    };
    const harness = createHarness({ fontInstallation });
    const {
      outputSelectionId: _outputSelectionId,
      outputType: _outputType,
      ...validationRequest
    } = runRequest(harness.session.sessionId, OPERATION_7, "unused");
    const result = await harness.service.validateHwpxExport(validationRequest);
    expect(result.report).toMatchObject({
      fontInstalled: null,
      validation: {
        infoCount: 1,
        messages: expect.arrayContaining([
          expect.objectContaining({
            severity: "INFO",
            code: "HWPX_FONT_INSTALLATION_UNVERIFIED"
          })
        ])
      }
    });
  });

  it("replaces untrusted utility prose with content-free validation text", async () => {
    const harness = createHarness();
    vi.mocked(harness.run).mockImplementationOnce(async (input) => {
      const result = utilityResult(input, harness.document);
      return {
        ...result,
        summary: {
          ...result.summary,
          validationReport: {
            ...result.summary.validationReport,
            messages: result.summary.validationReport.messages.map((message) => ({
              ...message,
              description: "PRIVATE_BODY_AND_CONTACT_SENTINEL",
              suggestion: "PRIVATE_BODY_AND_CONTACT_SENTINEL"
            }))
          }
        }
      };
    });
    const {
      outputSelectionId: _outputSelectionId,
      outputType: _outputType,
      ...validationRequest
    } = runRequest(harness.session.sessionId, OPERATION_12, "unused");
    const result = await harness.service.validateHwpxExport(validationRequest);
    expect(JSON.stringify(result.report)).not.toContain(
      "PRIVATE_BODY_AND_CONTACT_SENTINEL"
    );
    expect(result.report.validation.messages[0]?.description).toBe(
      "HWPX 내부 검증 메시지: HWPX_CONFIGURED_HEADING_OMISSION"
    );
  });

  it("rejects an exporter-provided font family that differs from the preset", async () => {
    const harness = createHarness();
    vi.mocked(harness.run).mockImplementationOnce(async (input) => {
      const result = utilityResult(input, harness.document);
      return {
        ...result,
        summary: { ...result.summary, fontFamily: "PRIVATE_SENTINEL" }
      };
    });
    const {
      outputSelectionId: _outputSelectionId,
      outputType: _outputType,
      ...validationRequest
    } = runRequest(harness.session.sessionId, OPERATION_13, "unused");
    await expect(
      harness.service.validateHwpxExport(validationRequest)
    ).rejects.toThrow("publication content loss");
  });

  it("honors cancellation while the safe Hancom probe is still pending", async () => {
    let resolveProbe!: () => void;
    const probeGate = new Promise<void>((resolve) => {
      resolveProbe = resolve;
    });
    const bridge: HwpBridgePort = {
      probe: vi.fn(async () => {
        await probeGate;
        return {
          available: true,
          availabilityCode: "AVAILABLE",
          hancomVersion: "Hancom 2024"
        };
      }),
      convert: vi.fn(),
      reopen: vi.fn(),
      cancel: vi.fn(async () => false),
      dispose: vi.fn(async () => undefined)
    };
    const harness = createHarness({ bridge });
    const directory = await makeTemporaryDirectory();
    vi.mocked(harness.dialog.showSaveDialog).mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(directory, "cancelled.hwp")
    });
    const selection = await harness.service.chooseHwpxOutput({
      sessionId: harness.session.sessionId,
      suggestedFileName: "cancelled.hwp",
      outputType: "HWP"
    });
    if (!selection) {
      throw new Error("expected HWP selection");
    }
    const run = harness.service.runHwpxExport(
      runRequest(harness.session.sessionId, OPERATION_8, selection.selectionId, {
        outputType: "HWP"
      })
    );
    await Promise.resolve();
    await expect(
      harness.service.cancelHwpxExport({
        sessionId: harness.session.sessionId,
        operationId: OPERATION_8
      })
    ).resolves.toBe(true);
    resolveProbe();

    await expect(run).resolves.toEqual({
      status: "CANCELLED",
      operationId: OPERATION_8
    });
    expect(harness.run).not.toHaveBeenCalled();
  });

  it("preserves and reveals a no-clobber HWPX companion when conversion fails", async () => {
    const bridge: HwpBridgePort = {
      probe: vi.fn(async () => ({
        available: true,
        availabilityCode: "AVAILABLE",
        hancomVersion: "Hancom 2024"
      })),
      convert: vi.fn(async () => {
        throw new HwpBridgeOperationError("CONVERSION_FAILED");
      }),
      reopen: vi.fn(),
      cancel: vi.fn(async () => false),
      dispose: vi.fn(async () => undefined)
    };
    const harness = createHarness({ bridge });
    const directory = await makeTemporaryDirectory();
    const outputPath = path.join(directory, "failed.hwp");
    const companionPath = path.join(directory, "failed.hwpx");
    vi.mocked(harness.dialog.showSaveDialog).mockResolvedValueOnce({
      canceled: false,
      filePath: outputPath
    });
    const selection = await harness.service.chooseHwpxOutput({
      sessionId: harness.session.sessionId,
      suggestedFileName: "failed.hwp",
      outputType: "HWP"
    });
    if (!selection) {
      throw new Error("expected HWP selection");
    }

    const result = await harness.service.runHwpxExport(
      runRequest(harness.session.sessionId, OPERATION_9, selection.selectionId, {
        outputType: "HWP"
      })
    );
    expect(result).toMatchObject({
      status: "FAILED",
      operationId: OPERATION_9,
      code: "HWP_CONVERSION_FAILED",
      preservedHwpxFileName: "failed.hwpx",
      report: {
        outputType: "HWP",
        preservedHwpxFileName: "failed.hwpx",
        hwpxSha256: sha256(GENERATED_HWPX),
        outputSha256: null,
        hwpConverted: false,
        hancomReopen: "NOT_RUN"
      }
    });
    await expect(readFile(companionPath)).resolves.toEqual(GENERATED_HWPX);
    await expect(readFile(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      harness.service.revealHwpxExport({
        sessionId: harness.session.sessionId,
        operationId: OPERATION_9
      })
    ).resolves.toBe(true);
    expect(harness.shell.showItemInFolder).toHaveBeenCalledWith(companionPath);
  });

  it("never overwrites an unconfirmed HWPX companion", async () => {
    const bridge: HwpBridgePort = {
      probe: vi.fn(async () => ({
        available: true,
        availabilityCode: "AVAILABLE",
        hancomVersion: "Hancom 2024"
      })),
      convert: vi.fn(async () => {
        throw new HwpBridgeOperationError("CONVERSION_FAILED");
      }),
      reopen: vi.fn(),
      cancel: vi.fn(async () => false),
      dispose: vi.fn(async () => undefined)
    };
    const harness = createHarness({ bridge });
    const directory = await makeTemporaryDirectory();
    const outputPath = path.join(directory, "occupied.hwp");
    const companionPath = path.join(directory, "occupied.hwpx");
    const foreign = Buffer.from("foreign companion owner", "utf8");
    await writeFile(companionPath, foreign);
    vi.mocked(harness.dialog.showSaveDialog).mockResolvedValueOnce({
      canceled: false,
      filePath: outputPath
    });
    const selection = await harness.service.chooseHwpxOutput({
      sessionId: harness.session.sessionId,
      suggestedFileName: "occupied.hwp",
      outputType: "HWP"
    });
    if (!selection) {
      throw new Error("expected HWP selection");
    }

    const result = await harness.service.runHwpxExport(
      runRequest(
        harness.session.sessionId,
        OPERATION_10,
        selection.selectionId,
        { outputType: "HWP" }
      )
    );
    expect(result).toMatchObject({
      status: "FAILED",
      operationId: OPERATION_10,
      code: "HWP_CONVERSION_FAILED"
    });
    await expect(readFile(companionPath)).resolves.toEqual(foreign);
    if (!("preservedHwpxFileName" in result)) {
      throw new Error("expected a preserved HWPX result");
    }
    expect(result.preservedHwpxFileName).toMatch(
      /^occupied\.madi-preserved-[0-9a-f-]+\.hwpx$/
    );
    await expect(
      readFile(path.join(directory, result.preservedHwpxFileName))
    ).resolves.toEqual(GENERATED_HWPX);
    expect(bridge.convert).toHaveBeenCalledTimes(1);
  });

  it("keeps the bridge input isolated from the public HWPX companion", async () => {
    const directory = await makeTemporaryDirectory();
    const outputPath = path.join(directory, "isolated.hwp");
    const companionPath = path.join(directory, "isolated.hwpx");
    const foreign = Buffer.from("external companion mutation", "utf8");
    const bridge: HwpBridgePort = {
      probe: vi.fn(async () => ({
        available: true,
        availabilityCode: "AVAILABLE",
        hancomVersion: "Hancom 2024"
      })),
      convert: vi.fn(async (_operationId, inputHwpx) => {
        await writeFile(companionPath, foreign);
        expect(await readFile(inputHwpx)).toEqual(GENERATED_HWPX);
        throw new HwpBridgeOperationError("CONVERSION_FAILED");
      }),
      reopen: vi.fn(),
      cancel: vi.fn(async () => false),
      dispose: vi.fn(async () => undefined)
    };
    const harness = createHarness({ bridge });
    vi.mocked(harness.dialog.showSaveDialog).mockResolvedValueOnce({
      canceled: false,
      filePath: outputPath
    });
    const selection = await harness.service.chooseHwpxOutput({
      sessionId: harness.session.sessionId,
      suggestedFileName: "isolated.hwp",
      outputType: "HWP"
    });
    if (!selection) {
      throw new Error("expected HWP selection");
    }

    await expect(
      harness.service.runHwpxExport(
        runRequest(
          harness.session.sessionId,
          OPERATION_11,
          selection.selectionId,
          { outputType: "HWP" }
        )
      )
    ).resolves.toMatchObject({
      status: "FAILED",
      operationId: OPERATION_11,
      code: "HWP_CONVERSION_FAILED",
      preservedHwpxFileName: expect.stringMatching(
        /^isolated\.madi-preserved-[0-9a-f-]{36}\.hwpx$/u
      )
    });
    await expect(readFile(companionPath)).resolves.toEqual(foreign);
    const recovered = (await readdir(directory)).find((name) =>
      /^isolated\.madi-preserved-[0-9a-f-]{36}\.hwpx$/u.test(name)
    );
    expect(recovered).toBeTypeOf("string");
    await expect(readFile(path.join(directory, recovered!))).resolves.toEqual(
      GENERATED_HWPX
    );
    expect(bridge.convert).toHaveBeenCalledTimes(1);
  });

  it("reports the preserved HWPX when another writer claims the final HWP name", async () => {
    const directory = await makeTemporaryDirectory();
    const outputPath = path.join(directory, "claimed.hwp");
    const companionPath = path.join(directory, "claimed.hwpx");
    const foreign = Buffer.from("concurrent HWP owner", "utf8");
    const bridge: HwpBridgePort = {
      probe: vi.fn(async () => ({
        available: true,
        availabilityCode: "AVAILABLE",
        hancomVersion: "Hancom 2024"
      })),
      convert: vi.fn(async (_operationId, _inputHwpx, stagedHwp) => {
        await writeFile(stagedHwp, GENERATED_HWP);
        return {
          outputPath: stagedHwp,
          byteLength: GENERATED_HWP.byteLength,
          sha256: sha256(GENERATED_HWP),
          hancomVersion: "Hancom 2024"
        };
      }),
      reopen: vi.fn(async () => {
        await writeFile(outputPath, foreign);
        return { verified: true as const, hancomVersion: "Hancom 2024" };
      }),
      cancel: vi.fn(async () => false),
      dispose: vi.fn(async () => undefined)
    };
    const harness = createHarness({ bridge });
    vi.mocked(harness.dialog.showSaveDialog).mockResolvedValueOnce({
      canceled: false,
      filePath: outputPath
    });
    const selection = await harness.service.chooseHwpxOutput({
      sessionId: harness.session.sessionId,
      suggestedFileName: "claimed.hwp",
      outputType: "HWP"
    });
    if (!selection) {
      throw new Error("expected HWP selection");
    }

    await expect(
      harness.service.runHwpxExport(
        runRequest(
          harness.session.sessionId,
          OPERATION_14,
          selection.selectionId,
          { outputType: "HWP" }
        )
      )
    ).resolves.toMatchObject({
      status: "FAILED",
      operationId: OPERATION_14,
      code: "DESTINATION_CHANGED",
      preservedHwpxFileName: "claimed.hwpx"
    });
    await expect(readFile(outputPath)).resolves.toEqual(foreign);
    await expect(readFile(companionPath)).resolves.toEqual(GENERATED_HWPX);
  });
});
