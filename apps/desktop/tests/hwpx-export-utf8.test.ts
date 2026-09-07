import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ProcessHwpxExporter,
  type HwpxExporterRunInput
} from "../src/main/hwpxExportClient";
import { BUILT_IN_HWPX_PRESETS } from "../src/shared/hwpxBuiltins";
import { readerPublication } from "./reader-lab-fixtures";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  default: { spawn: spawnMock },
  spawn: spawnMock
}));

const OPERATION_ID = "123e4567-e89b-42d3-a456-426614174000";
const SOURCE_HASH = "a".repeat(64);
const PRESET_HASH = "b".repeat(64);
const OUTPUT_HASH = "c".repeat(64);
const LOGICAL_HASH = "d".repeat(64);
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

function input(outputPath: string): HwpxExporterRunInput {
  return {
    operationId: OPERATION_ID,
    mode: "EXPORT",
    document: readerPublication({ revision: 5 }),
    sourcePublicationHash: SOURCE_HASH,
    presetId: "ONE_OFF",
    presetContentHash: PRESET_HASH,
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
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z"
    },
    titlePage: { subtitle: null, genre: null, contact: null },
    config: BUILT_IN_HWPX_PRESETS[0]!.config,
    outputPath,
    replaceExisting: true
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
      packageXmlVersion: "1.31",
      sourcePublicationHash: SOURCE_HASH,
      presetId: "ONE_OFF",
      presetContentHash: PRESET_HASH,
      fontFamily: BUILT_IN_HWPX_PRESETS[0]!.config.fontFamilyToken,
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
            hwpxPath: null,
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
        exportedSectionCount: 1,
        paragraphCount: 5,
        runCount: 5,
        textCount: 4,
        sourceSectionCount: 1,
        sourceBlockCount: 2,
        exportedBlockCount: 1,
        fallbackBlockCount: 0,
        configuredOmissionBlockCount: 1,
        rejectedBlockCount: 0,
        sourceCharacterCount: 21,
        exportedCharacterCount: 21,
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

afterEach(async () => {
  spawnMock.mockReset();
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("HWPX exporter UTF-8 boundary", () => {
  it("rejects malformed UTF-8 that a replacement decoder could accept as a valid result", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "madi-hwpx-utf8-"));
    directories.push(directory);
    const outputPath = path.join(directory, "publication.hwpx");
    const child = childReturningMalformedResult(outputPath);
    spawnMock.mockReturnValue(
      child as unknown as ChildProcessWithoutNullStreams
    );
    const exporter = new ProcessHwpxExporter("fixture-hwpx-exporter");

    await expect(exporter.run(input(outputPath), vi.fn())).rejects.toThrow(
      "invalid message"
    );
    expect(child.kill).toHaveBeenCalledTimes(1);
    await exporter.dispose();
  });
});
