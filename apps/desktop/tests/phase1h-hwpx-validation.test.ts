import { describe, expect, it } from "vitest";
import { BUILT_IN_HWPX_PRESETS } from "../src/shared/hwpxBuiltins";
import {
  validateHwpxExportReport,
  validateHwpxExportPresetConfig,
  validateHwpxExportState,
  validateHwpxExportProgress,
  validateHwpxOperationId,
  validateHwpxPresetMutationResult,
  validateRunHwpxExportResult,
  validateValidateHwpxExportResult
} from "../src/shared/hwpxExportValidation";

const OPERATION_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("Phase 1H HWPX shared validation", () => {
  it("accepts every built-in editable submission preset", () => {
    expect(BUILT_IN_HWPX_PRESETS.map((preset) => preset.name)).toEqual([
      "범용 출판사 제출본",
      "가독성 중심 검토본",
      "압축 검토본"
    ]);

    for (const preset of BUILT_IN_HWPX_PRESETS) {
      expect(validateHwpxExportPresetConfig(preset.config)).toEqual(
        preset.config
      );
      expect(preset.config.pageSizeToken).toBe("A4");
      expect(preset.config.orientation).toBe("PORTRAIT");
      expect(preset.config.sectionSplitMode).toBe("SINGLE");
    }
  });

  it("accepts the canonical zero revision for newly created presets", () => {
    const preset = {
      id: "preset-1",
      projectId: "project-1",
      kind: "HWPX",
      name: "신규 제출본",
      presetFormat: "MADI_EXPORT_PRESET",
      presetVersion: 1,
      config: BUILT_IN_HWPX_PRESETS[0]!.config,
      contentHash: "a".repeat(64),
      revision: 0,
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z"
    };
    const mutation = { preset, revision: 1, noOp: false };
    const state = {
      metadata: {
        projectId: "project-1",
        publicationTitle: "새 작품",
        creatorName: "",
        language: "ko",
        identifier: "urn:madi:publication:project-1",
        publisher: null,
        description: null,
        rights: null,
        subjects: [],
        coverAssetId: null,
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:00:00.000Z"
      },
      presets: [preset],
      duplicatePresetNames: [],
      hancom: { status: "UNAVAILABLE", reason: "NOT_INSTALLED" },
      revision: 1
    };

    expect(validateHwpxPresetMutationResult(mutation)).toEqual(mutation);
    expect(validateHwpxExportState(state)).toEqual(state);
    expect(() =>
      validateHwpxPresetMutationResult({
        ...mutation,
        preset: { ...preset, revision: -1 }
      })
    ).toThrow(/preset revision/u);
  });

  it("rejects extra fields, unsafe numeric values, and disabled hidden text", () => {
    const base = BUILT_IN_HWPX_PRESETS[0]!.config;

    expect(() =>
      validateHwpxExportPresetConfig({ ...base, arbitraryXml: "<script/>" })
    ).toThrow(/fields/u);
    expect(() =>
      validateHwpxExportPresetConfig({ ...base, fontSizePt: Number.NaN })
    ).toThrow(/font size/u);
    expect(() =>
      validateHwpxExportPresetConfig({
        ...base,
        includeHeader: false,
        headerText: "숨은 머리말"
      })
    ).toThrow(/Disabled header/u);
    expect(() =>
      validateHwpxExportPresetConfig({
        ...base,
        pageSizeToken: "CUSTOM",
        customPageWidth: null,
        customPageHeight: null
      })
    ).toThrow(/custom page dimensions/u);
    expect(() =>
      validateHwpxExportPresetConfig({
        ...base,
        customPageWidth: 210
      })
    ).toThrow(/custom page dimensions/u);
  });

  it("uses an exact bounded content-free progress contract", () => {
    expect(
      validateHwpxExportProgress({
        operationId: OPERATION_ID.toUpperCase(),
        stage: "SECTION_XML",
        completed: 4,
        total: 10
      })
    ).toEqual({
      operationId: OPERATION_ID,
      stage: "SECTION_XML",
      completed: 4,
      total: 10
    });
    expect(() =>
      validateHwpxExportProgress({
        operationId: OPERATION_ID,
        stage: "SECTION_XML",
        completed: 4,
        total: 10,
        manuscriptText: "금지"
      })
    ).toThrow(/fields/u);
    expect(() =>
      validateHwpxExportProgress({
        operationId: OPERATION_ID,
        stage: "SECTION_XML",
        completed: 1,
        total: 1_000_001
      })
    ).toThrow(/values/u);
    expect(validateHwpxOperationId(OPERATION_ID)).toBe(OPERATION_ID);
  });

  it("rejects report coverage loss and hostile nested message fields", () => {
    const valid = {
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
      hancomReopen: "NOT_RUN",
      hwpConverted: false,
      timing: {
        publicationIrCompileMs: 1,
        semanticMappingMs: 1,
        styleTableMs: 1,
        sectionXmlMs: 1,
        packageDocumentsMs: 1,
        zipPackagingMs: 1,
        internalValidationMs: 1,
        zipReopenMs: 1,
        sourceCoverageMs: 1,
        exporterTotalMs: 8,
        totalMs: 9,
        hwpConversionMs: null,
        hwpReopenMs: null
      },
      generatedAt: "2026-08-13T00:00:00.000Z",
      madiVersion: "0.0.1"
    };

    expect(validateHwpxExportReport(valid)).toEqual(valid);
    const fractionalCompileReport = {
      ...valid,
      timing: {
        ...valid.timing,
        publicationIrCompileMs: 1.25,
        totalMs: 9.25
      }
    };
    expect(validateHwpxExportReport(fractionalCompileReport)).toEqual(
      fractionalCompileReport
    );
    const oldTiming: Record<string, unknown> = { ...valid.timing };
    delete oldTiming.packageDocumentsMs;
    oldTiming.packageMs = 1;
    expect(() =>
      validateHwpxExportReport({
        ...valid,
        timing: oldTiming
      })
    ).toThrow(/timing fields/u);
    expect(() =>
      validateHwpxExportReport({
        ...valid,
        timing: { ...valid.timing, exporterTotalMs: 7, totalMs: 8 }
      })
    ).toThrow(/timing/u);
    expect(() =>
      validateHwpxExportReport({
        ...valid,
        timing: { ...valid.timing, totalMs: 10 }
      })
    ).toThrow(/timing/u);
    const validationOnlyReport = {
      ...valid,
      hwpxSha256: null,
      outputSha256: null,
      byteLength: null
    };
    expect(
      validateValidateHwpxExportResult({
        operationId: OPERATION_ID,
        sourcePublicationHash: valid.sourcePublicationHash,
        report: validationOnlyReport,
        revision: valid.sourceProjectRevision
      })
    ).toMatchObject({ report: validationOnlyReport });
    expect(() =>
      validateValidateHwpxExportResult({
        operationId: OPERATION_ID,
        sourcePublicationHash: valid.sourcePublicationHash,
        report: valid,
        revision: valid.sourceProjectRevision
      })
    ).toThrow(/semantic state/u);
    expect(() =>
      validateValidateHwpxExportResult({
        operationId: OPERATION_ID,
        sourcePublicationHash: valid.sourcePublicationHash,
        report: validationOnlyReport,
        revision: valid.sourceProjectRevision + 1
      })
    ).toThrow(/source identity/u);
    expect(() =>
      validateHwpxExportReport({
        ...valid,
        outputSha256: "e".repeat(64)
      })
    ).toThrow(/semantic state/u);
    expect(() =>
      validateHwpxExportReport({
        ...valid,
        hwpConverted: true,
        timing: { ...valid.timing, totalMs: 10, hwpConversionMs: 1 }
      })
    ).toThrow(/semantic state/u);
    const customPageReport = {
      ...valid,
      page: {
        ...valid.page,
        pageSizeToken: "CUSTOM",
        customPageWidth: 180,
        customPageHeight: 250
      }
    };
    expect(validateHwpxExportReport(customPageReport)).toEqual(
      customPageReport
    );
    expect(() =>
      validateHwpxExportReport({
        ...valid,
        page: { ...valid.page, customPageWidth: 210 }
      })
    ).toThrow(/custom page dimensions/u);
    expect(() =>
      validateHwpxExportReport({
        ...valid,
        page: { ...valid.page, headerHasText: true }
      })
    ).toThrow(/header or footer/u);
    expect(() =>
      validateHwpxExportReport({
        ...valid,
        coverage: { ...valid.coverage, exportedCharacterCount: 19 }
      })
    ).toThrow(/validation outcome/u);
    expect(() =>
      validateHwpxExportReport({
        ...valid,
        validation: {
          ...valid.validation,
          messages: [
            { ...valid.validation.messages[0], manuscriptText: "원고 유출" }
          ]
        }
      })
    ).toThrow(/message fields/u);
    expect(() =>
      validateHwpxExportReport({
        ...valid,
        validation: {
          ...valid.validation,
          messages: [
            { ...valid.validation.messages[0], hwpxPath: "C:\\private\\draft.hwpx" }
          ]
        }
      })
    ).toThrow(/validation path/u);

    const failedReport = {
      ...valid,
      outputType: "HWP",
      outputSha256: null,
      preservedHwpxFileName: "submission.hwpx",
      byteLength: null,
      timing: {
        ...valid.timing,
        totalMs: 51,
        hwpConversionMs: 42
      }
    };
    expect(
      validateRunHwpxExportResult({
        status: "FAILED",
        operationId: OPERATION_ID,
        code: "HWP_CONVERSION_FAILED",
        preservedHwpxFileName: "submission.hwpx",
        report: failedReport
      })
    ).toMatchObject({
      code: "HWP_CONVERSION_FAILED",
      preservedHwpxFileName: "submission.hwpx"
    });
    expect(() =>
      validateRunHwpxExportResult({
        status: "COMPLETED",
        operationId: OPERATION_ID,
        fileName: "submission.hwpx",
        byteLength: 1024,
        sha256: "c".repeat(64),
        report: valid,
        revision: 8
      })
    ).toThrow(/report identity/u);
    expect(() =>
      validateRunHwpxExportResult({
        status: "FAILED",
        operationId: OPERATION_ID,
        code: "HWP_CONVERSION_FAILED",
        preservedHwpxFileName: "submission.hwpx",
        report: {
          ...failedReport,
          outputSha256: "e".repeat(64),
          byteLength: 2048
        }
      })
    ).toThrow(/semantic state/u);

    const completedHwpReport = {
      ...failedReport,
      outputSha256: "e".repeat(64),
      byteLength: 2048,
      hwpConverted: true,
      hancomReopen: "PASSED",
      timing: {
        ...failedReport.timing,
        totalMs: 59,
        hwpReopenMs: 8
      }
    };
    expect(
      validateRunHwpxExportResult({
        status: "COMPLETED",
        operationId: OPERATION_ID,
        fileName: "submission.hwp",
        byteLength: 2048,
        sha256: "e".repeat(64),
        report: completedHwpReport,
        revision: 7
      })
    ).toMatchObject({ status: "COMPLETED", fileName: "submission.hwp" });
    expect(() =>
      validateRunHwpxExportResult({
        status: "COMPLETED",
        operationId: OPERATION_ID,
        fileName: "submission.hwp",
        byteLength: 2048,
        sha256: "e".repeat(64),
        report: {
          ...completedHwpReport,
          hancomReopen: "NOT_RUN",
          timing: { ...completedHwpReport.timing, totalMs: 51, hwpReopenMs: null }
        },
        revision: 7
      })
    ).toThrow(/semantic state/u);
    expect(() =>
      validateRunHwpxExportResult({
        status: "FAILED",
        operationId: OPERATION_ID,
        code: "HWP_CONVERSION_FAILED",
        preservedHwpxFileName: "C:\\private\\submission.hwpx",
        report: failedReport
      })
    ).toThrow(/preserved HWPX/u);
    expect(() =>
      validateRunHwpxExportResult({
        status: "FAILED",
        operationId: OPERATION_ID,
        code: "DESTINATION_CHANGED",
        preservedHwpxFileName: "submission.hwpx"
      })
    ).toThrow(/fields/u);
  });
});
