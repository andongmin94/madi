import { describe, expect, it } from "vitest";
import { BUILT_IN_HWPX_PRESETS } from "../src/shared/hwpxBuiltins";
import {
  validateHwpxExportReport,
  validateHwpxExportPresetConfig,
  validateHwpxExportProgress,
  validateHwpxOperationId,
  validateRunHwpxExportResult
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

    expect(validateHwpxExportReport(valid)).toEqual(valid);
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
