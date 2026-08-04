import { describe, expect, it } from "vitest";
import type {
  EpubExportPresetConfig,
  PublicationExportMetadata
} from "../src/shared/epubExport";
import {
  validateEpubExportPresetConfig,
  validateEpubExportProgress,
  validatePublicationMetadataInput,
  validatePublicationMetadataStateInput
} from "../src/shared/epubExportValidation";

const config: EpubExportPresetConfig = {
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

const metadata: Omit<
  PublicationExportMetadata,
  "projectId" | "coverAssetId" | "createdAt" | "updatedAt"
> = {
  publicationTitle: "긴 밤의 문장",
  creatorName: "마디 작가",
  language: "ko-KR",
  identifier: "urn:madi:publication:project-1",
  publisher: "madi",
  description: "장편소설",
  rights: "All rights reserved.",
  subjects: ["소설", "장편"]
};

describe("Phase 1G EPUB renderer boundary validation", () => {
  it("accepts both fixed profiles and returns a complete preset unchanged", () => {
    expect(validateEpubExportPresetConfig(config)).toEqual(config);
    expect(
      validateEpubExportPresetConfig({
        ...config,
        targetProfile: "EPUB_3_3_COMPATIBILITY",
        splitMode: "SCENE",
        tocDepth: 4,
        includeCover: true,
        sceneBreakStyleToken: "RULE",
        bodyStyleToken: "INDENTED_PROSE",
        stylesheetToken: "MADI_MINIMAL"
      })
    ).toEqual({
      ...config,
      targetProfile: "EPUB_3_3_COMPATIBILITY",
      splitMode: "SCENE",
      tocDepth: 4,
      includeCover: true,
      sceneBreakStyleToken: "RULE",
      bodyStyleToken: "INDENTED_PROSE",
      stylesheetToken: "MADI_MINIMAL"
    });
  });

  it.each([
    [{ ...config, formatVersion: 2 }, "version"],
    [{ ...config, targetProfile: "EPUB_LATEST" }, "profile"],
    [{ ...config, splitMode: "PAGE" }, "split"],
    [{ ...config, tocDepth: 0 }, "TOC"],
    [{ ...config, tocDepth: 2.5 }, "TOC"],
    [{ ...config, includeCover: "yes" }, "cover"],
    [{ ...config, sceneBreakStyleToken: "CUSTOM_CSS" }, "scene break"],
    [{ ...config, executableScript: "alert(1)" }, "fields"]
  ])("rejects a malformed or expanded preset (%s)", (candidate, message) => {
    expect(() => validateEpubExportPresetConfig(candidate)).toThrow(message);
  });

  it("accepts bounded publication metadata and preserves nullable fields", () => {
    expect(validatePublicationMetadataInput(metadata)).toEqual(metadata);
    expect(
      validatePublicationMetadataInput({
        ...metadata,
        language: "en-Latn-US",
        publisher: null,
        description: null,
        rights: null,
        subjects: []
      })
    ).toEqual({
      ...metadata,
      language: "en-Latn-US",
      publisher: null,
      description: null,
      rights: null,
      subjects: []
    });
  });

  it.each([
    [{ ...metadata, creatorName: "" }, "creator"],
    [{ ...metadata, publicationTitle: "   " }, "title"],
    [{ ...metadata, language: "ko_kr" }, "language"],
    [{ ...metadata, identifier: "" }, "identifier"],
    [{ ...metadata, subjects: ["소설", "소설"] }, "Duplicate"],
    [{ ...metadata, subjects: "소설" }, "subjects"],
    [{ ...metadata, remoteCoverUrl: "https://example.com/cover.png" }, "fields"]
  ])("rejects invalid or capability-expanding metadata (%s)", (candidate, message) => {
    expect(() => validatePublicationMetadataInput(candidate)).toThrow(message);
  });

  it("allows the persisted bootstrap state to have no creator without weakening mutations", () => {
    expect(
      validatePublicationMetadataStateInput({ ...metadata, creatorName: "" })
    ).toEqual({ ...metadata, creatorName: "" });
    expect(() =>
      validatePublicationMetadataInput({ ...metadata, creatorName: "" })
    ).toThrow("creator");
  });

  it("strictly validates content-free progress events", () => {
    const operationId = "123e4567-e89b-42d3-a456-426614174000";
    expect(
      validateEpubExportProgress({
        operationId: operationId.toUpperCase(),
        stage: "XHTML_GENERATION",
        completed: 7,
        total: 12
      })
    ).toEqual({
      operationId,
      stage: "XHTML_GENERATION",
      completed: 7,
      total: 12
    });

    for (const candidate of [
      { operationId, stage: "READ_MANUSCRIPT", completed: 1, total: 1 },
      { operationId, stage: "FINALIZE", completed: 2, total: 1 },
      { operationId, stage: "FINALIZE", completed: -1, total: 1 },
      { operationId, stage: "FINALIZE", completed: 0, total: 0 },
      { operationId: "operation-1", stage: "FINALIZE", completed: 1, total: 1 },
      {
        operationId,
        stage: "FINALIZE",
        completed: 1,
        total: 1,
        manuscriptText: "must never cross the event bridge"
      }
    ]) {
      expect(() => validateEpubExportProgress(candidate)).toThrow();
    }
  });
});
