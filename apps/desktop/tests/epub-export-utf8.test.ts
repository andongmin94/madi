import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ProcessEpubExporter,
  type EpubExporterRunInput
} from "../src/main/epubExportClient";
import { readerPublication } from "./reader-lab-fixtures";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  default: { spawn: spawnMock },
  spawn: spawnMock
}));

const OPERATION_ID = "123e4567-e89b-42d3-a456-426614174000";
const SOURCE_HASH = "a".repeat(64);
const OUTPUT_HASH = "b".repeat(64);
const LOGICAL_HASH = "c".repeat(64);
const directories: string[] = [];

type FakeChild = Omit<
  ChildProcessWithoutNullStreams,
  "stdin" | "stdout" | "stderr" | "kill"
> & {
  readonly stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly kill: ReturnType<typeof vi.fn>;
};

function childReturningMalformedResult(outputPath: string): FakeChild {
  const events = new EventEmitter();
  const stdin = new EventEmitter() as FakeChild["stdin"];
  const child = Object.assign(events, {
    stdin,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true)
  }) as unknown as FakeChild;
  stdin.end = vi.fn(() => {
    const source = `${JSON.stringify(result(outputPath))}\n`;
    const bytes = Buffer.from(source, "utf8");
    const replacement = Buffer.from("�", "utf8");
    const index = bytes.indexOf(replacement);
    if (index < 0) {
      throw new Error("Fixture replacement marker is missing");
    }
    const malformed = Buffer.concat([
      bytes.subarray(0, index),
      Buffer.from([0xff]),
      bytes.subarray(index + replacement.byteLength)
    ]);
    child.stdout.write(malformed);
    queueMicrotask(() => child.emit("close", 0));
  });
  return child;
}

function input(outputPath: string): EpubExporterRunInput {
  return {
    operationId: OPERATION_ID,
    mode: "EXPORT",
    document: readerPublication({ revision: 5 }),
    sourcePublicationHash: SOURCE_HASH,
    metadata: {
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
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z"
    },
    config: {
      formatVersion: 1,
      targetProfile: "EPUB_3_3_COMPATIBILITY",
      splitMode: "CHAPTER",
      tocDepth: 3,
      includeChapterTitles: true,
      includeSceneTitles: true,
      sceneBreakStyleToken: "ORNAMENT",
      bodyStyleToken: "REFLOWABLE_PROSE",
      includeCover: false,
      stylesheetToken: "MADI_CLASSIC"
    },
    outputPath,
    replaceExisting: true,
    cover: null
  };
}

function result(outputPath: string): Record<string, unknown> {
  return {
    kind: "RESULT",
    mode: "EXPORT",
    outputPath,
    summary: {
      byteLength: 128,
      sha256: OUTPUT_HASH,
      logicalPackageHash: LOGICAL_HASH,
      targetProfile: "EPUB_3_3_COMPATIBILITY",
      sourcePublicationHash: SOURCE_HASH,
      validationReport: {
        status: "PASS",
        fatalCount: 0,
        errorCount: 0,
        warningCount: 0,
        infoCount: 1,
        messages: [
          {
            code: "TEST_INFO",
            severity: "INFO",
            description: "accepted � marker",
            sourceNodeId: null,
            epubPath: null,
            suggestion: null
          }
        ]
      },
      exportTiming: {
        contentSplitMs: 1,
        xhtmlGenerationMs: 1,
        packageDocumentsMs: 1,
        zipPackagingMs: 1,
        internalValidationMs: 1,
        totalMs: 5
      },
      statistics: {
        fileCount: 4,
        xhtmlCount: 1,
        sourceSectionCount: 1,
        exportedSectionCount: 1,
        sourceBlockCount: 1,
        exportedBlockCount: 1,
        fallbackBlockCount: 0,
        rejectedBlockCount: 0,
        sourceCharacterCount: 12,
        exportedCharacterCount: 12,
        sceneBreakCount: 0,
        rubyCount: 0,
        headingCount: 0,
        coverIncluded: false
      }
    }
  };
}

afterEach(async () => {
  spawnMock.mockReset();
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("EPUB exporter UTF-8 boundary", () => {
  it("rejects malformed UTF-8 that a replacement decoder could accept as a valid result", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "madi-epub-utf8-"));
    directories.push(directory);
    const outputPath = path.join(directory, "publication.epub");
    const child = childReturningMalformedResult(outputPath);
    spawnMock.mockReturnValue(
      child as unknown as ChildProcessWithoutNullStreams
    );
    const exporter = new ProcessEpubExporter("fixture-exporter");

    await expect(exporter.run(input(outputPath), vi.fn())).rejects.toThrow(
      "malformed JSON"
    );
    expect(child.kill).toHaveBeenCalledTimes(1);
    await exporter.dispose();
  });
});
