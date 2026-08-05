import { describe, expect, it, vi } from "vitest";
import { createMadiDesktopApi } from "../src/preload/bridge";
import { BUILT_IN_HWPX_PRESETS } from "../src/shared/hwpxBuiltins";
import { IPC_CHANNELS, IPC_EVENTS } from "../src/shared/contracts";
import type {
  HwpxExportReport,
  RunHwpxExportRequest,
  ValidateHwpxExportRequest
} from "../src/shared/hwpxExport";

const OPERATION_ID = "123e4567-e89b-42d3-a456-426614174000";

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
    preservedHwpxFileName: null,
    logicalPackageHash: "d".repeat(64),
    byteLength: 1024,
    coverage: {
      packageSectionCount: 1,
      sourceSectionCount: 1,
      exportedSectionCount: 1,
      sourceBlockCount: 2,
      exportedBlockCount: 2,
      fallbackBlockCount: 0,
      configuredOmissionBlockCount: 0,
      rejectedBlockCount: 0,
      sourceCharacterCount: 20,
      exportedCharacterCount: 20,
      paragraphCount: 2,
      runCount: 2,
      headingCount: 1,
      sceneBreakCount: 0,
      rubyCount: 0,
      inlineModifierCount: 0
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
          description: "검증 통과",
          suggestion: null,
          sourceNodeId: null,
          sectionId: "section0",
          hwpxPath: "Contents/section0.xml"
        }
      ]
    },
    fontFamily: "함초롬바탕",
    fontInstalled: null,
    page: {
      pageSizeToken: "A4",
      orientation: "PORTRAIT",
      marginTop: 25,
      marginBottom: 25,
      marginLeft: 25,
      marginRight: 25
    },
    hancomReopen: "NOT_RUN",
    hwpConverted: false,
    timing: {
      semanticMappingMs: 1,
      styleTableMs: 1,
      sectionXmlMs: 1,
      packageMs: 1,
      internalValidationMs: 1,
      zipReopenMs: 1,
      sourceCoverageMs: 1,
      totalMs: 7,
      hwpConversionMs: null,
      hwpReopenMs: null
    },
    generatedAt: "2026-08-13T00:00:00.000Z",
    madiVersion: "0.0.1"
  };
}

const validateRequest: ValidateHwpxExportRequest = {
  sessionId: "session-1",
  operationId: OPERATION_ID,
  scopeNodeId: "work-1",
  scopeKind: "WORK",
  expectedProjectRevision: 7,
  presetId: "GENERAL_SUBMISSION",
  presetContentHash: "b".repeat(64),
  metadata: {
    projectId: "project-1",
    publicationTitle: "긴 밤",
    creatorName: "마디 작가",
    language: "ko",
    identifier: "urn:madi:publication:project-1",
    publisher: null,
    description: null,
    rights: null,
    subjects: [],
    coverAssetId: null,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z"
  },
  config: BUILT_IN_HWPX_PRESETS[0]!.config,
  titlePage: { subtitle: null, genre: null, contact: null }
};

describe("Phase 1H preload HWPX boundary", () => {
  it("maps the bounded capabilities to fixed channels", async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === IPC_CHANNELS.chooseHwpxOutput) {
        return {
          selectionId: "selection-1",
          fileName: "긴-밤.hwpx",
          outputType: "HWPX"
        };
      }
      if (channel === IPC_CHANNELS.validateHwpxExport) {
        return {
          operationId: OPERATION_ID,
          sourcePublicationHash: "a".repeat(64),
          report: report(),
          revision: 7
        };
      }
      if (channel === IPC_CHANNELS.runHwpxExport) {
        return { status: "CANCELLED", operationId: OPERATION_ID };
      }
      return true;
    });
    const api = createMadiDesktopApi(invoke);
    const choose = {
      sessionId: "session-1",
      suggestedFileName: "긴-밤.hwpx",
      outputType: "HWPX" as const
    };
    const run: RunHwpxExportRequest = {
      ...validateRequest,
      outputSelectionId: "selection-1",
      outputType: "HWPX"
    };

    await api.chooseHwpxOutput(choose);
    await api.validateHwpxExport(validateRequest);
    await api.runHwpxExport(run);
    await api.cancelHwpxExport({ sessionId: "session-1", operationId: OPERATION_ID });
    await api.revealHwpxExport({ sessionId: "session-1", operationId: OPERATION_ID });

    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.chooseHwpxOutput, choose],
      [IPC_CHANNELS.validateHwpxExport, validateRequest],
      [IPC_CHANNELS.runHwpxExport, run],
      [IPC_CHANNELS.cancelHwpxExport, { sessionId: "session-1", operationId: OPERATION_ID }],
      [IPC_CHANNELS.revealHwpxExport, { sessionId: "session-1", operationId: OPERATION_ID }]
    ]);
  });

  it("validates exact progress before notifying the renderer", () => {
    let emit: ((payload: unknown) => void) | undefined;
    const unsubscribe = vi.fn();
    const api = createMadiDesktopApi(vi.fn(), (channel, listener) => {
      if (channel === IPC_EVENTS.hwpxExportProgress) {
        emit = listener;
        return unsubscribe;
      }
      return vi.fn();
    });
    const listener = vi.fn();
    const stop = api.onHwpxExportProgress(listener);
    emit?.({
      operationId: OPERATION_ID.toUpperCase(),
      stage: "INTERNAL_VALIDATION",
      completed: 4,
      total: 5
    });
    expect(listener).toHaveBeenCalledWith({
      operationId: OPERATION_ID,
      stage: "INTERNAL_VALIDATION",
      completed: 4,
      total: 5
    });
    expect(() =>
      emit?.({
        operationId: OPERATION_ID,
        stage: "INTERNAL_VALIDATION",
        completed: 4,
        total: 5,
        contact: "private"
      })
    ).toThrow();
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("rejects mismatched operation identities and nested report tampering", async () => {
    const wrongOperation = createMadiDesktopApi(
      vi.fn(async () => ({
        operationId: "123e4567-e89b-42d3-a456-426614174001",
        sourcePublicationHash: "a".repeat(64),
        report: report(),
        revision: 7
      }))
    );
    await expect(wrongOperation.validateHwpxExport(validateRequest)).rejects.toThrow(
      /operation id/u
    );

    const hostileReport = report();
    const hostile = createMadiDesktopApi(
      vi.fn(async () => ({
        status: "COMPLETED",
        operationId: OPERATION_ID,
        fileName: "긴-밤.hwpx",
        byteLength: 1024,
        sha256: "c".repeat(64),
        report: {
          ...hostileReport,
          validation: {
            ...hostileReport.validation,
            messages: [
              { ...hostileReport.validation.messages[0], sourceText: "private" }
            ]
          }
        },
        revision: 7
      }))
    );
    await expect(
      hostile.runHwpxExport({
        ...validateRequest,
        outputSelectionId: "selection-1",
        outputType: "HWPX"
      })
    ).rejects.toThrow(/message fields/u);
  });

  it("accepts only basename-only typed HWP conversion preservation failures", async () => {
    const failedReport: HwpxExportReport = {
      ...report(),
      outputType: "HWP",
      outputSha256: null,
      preservedHwpxFileName: "긴-밤.hwpx",
      byteLength: null,
      timing: {
        ...report().timing,
        hwpConversionMs: 25
      }
    };
    const run: RunHwpxExportRequest = {
      ...validateRequest,
      outputSelectionId: "selection-1",
      outputType: "HWP"
    };
    const api = createMadiDesktopApi(
      vi.fn(async () => ({
        status: "FAILED",
        operationId: OPERATION_ID,
        code: "HWP_CONVERSION_FAILED",
        preservedHwpxFileName: "긴-밤.hwpx",
        report: failedReport
      }))
    );
    await expect(api.runHwpxExport(run)).resolves.toMatchObject({
      code: "HWP_CONVERSION_FAILED",
      preservedHwpxFileName: "긴-밤.hwpx"
    });

    const hostile = createMadiDesktopApi(
      vi.fn(async () => ({
        status: "FAILED",
        operationId: OPERATION_ID,
        code: "HWP_CONVERSION_FAILED",
        preservedHwpxFileName: "C:\\private\\긴-밤.hwpx",
        report: failedReport
      }))
    );
    await expect(hostile.runHwpxExport(run)).rejects.toThrow(/preserved HWPX/u);
  });
});
