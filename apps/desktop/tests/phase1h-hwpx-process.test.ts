import { EventEmitter } from "node:events";
import { existsSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import childProcess, {
  spawn as namedSpawn,
  type ChildProcessWithoutNullStreams
} from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HwpxExporterRunInput } from "../src/main/hwpxExportClient";
import { ProcessHwpxExporter } from "../src/main/hwpxExportClient";
import { BUILT_IN_HWPX_PRESETS } from "../src/shared/hwpxBuiltins";
import { readerPublication } from "./reader-lab-fixtures";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  default: { spawn: spawnMock },
  spawn: spawnMock
}));

const mockedDefaultSpawn = vi.mocked(childProcess.spawn);
const mockedNamedSpawn = vi.mocked(namedSpawn);
const OPERATION_ID = "123e4567-e89b-42d3-a456-426614174000";
const SOURCE_HASH = "a".repeat(64);
const PRESET_HASH = "b".repeat(64);
const OUTPUT_HASH = "c".repeat(64);
const LOGICAL_HASH = "d".repeat(64);
const temporaryDirectories: string[] = [];

type FakeChild = Omit<
  ChildProcessWithoutNullStreams,
  "stdin" | "stdout" | "stderr" | "kill"
> & {
  readonly stdin: EventEmitter & {
    end: ReturnType<typeof vi.fn>;
  };
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly kill: ReturnType<typeof vi.fn>;
};

function createChild(
  onInput?: (
    source: string,
    child: FakeChild,
    callback?: (error?: Error | null) => void
  ) => void
): FakeChild {
  const events = new EventEmitter();
  const stdin = new EventEmitter() as FakeChild["stdin"];
  const child = Object.assign(events, {
    stdin,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true)
  }) as unknown as FakeChild;
  stdin.end = vi.fn(
    (
      source: string,
      _encoding?: BufferEncoding,
      callback?: (error?: Error | null) => void
    ) => onInput?.(source, child, callback)
  );
  return child;
}

function returnChild(child: FakeChild): void {
  const spawned = child as unknown as ReturnType<typeof namedSpawn>;
  spawnMock.mockReturnValue(spawned);
  mockedDefaultSpawn.mockReturnValue(spawned);
  mockedNamedSpawn.mockReturnValue(spawned);
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
      fontFamily: "함초롬바탕",
      validationReport: {
        status: "PASS",
        fatalCount: 0,
        errorCount: 0,
        warningCount: 0,
        infoCount: 0,
        messages: []
      },
      exportTiming: {
        styleTableMs: 1,
        sectionXmlMs: 1,
        packageDocumentsMs: 1,
        zipPackagingMs: 1,
        internalValidationMs: 1,
        zipReopenMs: 1,
        sourceCoverageMs: 1,
        totalMs: 7
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

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "madi-hwpx-process-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.useRealTimers();
  spawnMock.mockReset();
  mockedDefaultSpawn.mockReset();
  mockedNamedSpawn.mockReset();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("Phase 1H HWPX child-process boundary", () => {
  it("sends only the typed Publication IR contract and parses the final strict shape", async () => {
    const directory = await makeTemporaryDirectory();
    const outputPath = path.join(directory, "output.hwpx");
    let serialized = "";
    const child = createChild((source, current) => {
      serialized = source;
      current.stdout.write(
        `${JSON.stringify({
          kind: "PROGRESS",
          stage: "INTERNAL_VALIDATION",
          completed: 1,
          total: 1
        })}\n${JSON.stringify(result(outputPath))}\n`
      );
      queueMicrotask(() => current.emit("close", 0));
    });
    returnChild(child);
    const exporter = new ProcessHwpxExporter("fixture-hwpx-exporter");
    const progress = vi.fn();

    await expect(exporter.run(input(outputPath), progress)).resolves.toMatchObject({
      mode: "EXPORT",
      outputPath,
      summary: {
        packageXmlVersion: "1.31",
        sourcePublicationHash: SOURCE_HASH,
        presetContentHash: PRESET_HASH
      }
    });
    const request = JSON.parse(serialized) as Record<string, unknown>;
    expect(Object.keys(request).sort()).toEqual([
      "document",
      "mode",
      "operationId",
      "request"
    ]);
    expect(
      (
        (
          (request.request as Record<string, unknown>).options as Record<
            string,
            unknown
          >
        ).headings as Record<string, Record<string, unknown>>
      ).work.fontFamily
    ).toBe(input(outputPath).config.workTitleStyle.fontFamilyToken);
    expect(serialized).not.toMatch(/typie|snapshot_base64|plain_text_recovery/iu);
    expect(progress).toHaveBeenCalledWith({
      operationId: OPERATION_ID,
      stage: "INTERNAL_VALIDATION",
      completed: 1,
      total: 1
    });
    expect(spawnMock).toHaveBeenCalledWith("fixture-hwpx-exporter", [], {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    await exporter.dispose();
  });

  it("rejects hostile result fields without exposing the payload", async () => {
    const directory = await makeTemporaryDirectory();
    const outputPath = path.join(directory, "output.hwpx");
    const child = createChild((_source, current) => {
      current.stdout.write(
        `${JSON.stringify({ ...result(outputPath), manuscriptText: "secret" })}\n`
      );
      queueMicrotask(() => current.emit("close", 1));
    });
    returnChild(child);
    const exporter = new ProcessHwpxExporter("fixture-hwpx-exporter");

    await expect(exporter.run(input(outputPath), vi.fn())).rejects.toThrow(
      "invalid message"
    );
    expect(child.kill).toHaveBeenCalled();
    await exporter.dispose();
  });

  it("rejects any child stderr without retaining private diagnostics", async () => {
    const directory = await makeTemporaryDirectory();
    const outputPath = path.join(directory, "output.hwpx");
    const child = createChild((_source, current) => {
      current.stderr.write("private manuscript sentinel");
      current.stdout.write(`${JSON.stringify(result(outputPath))}\n`);
      queueMicrotask(() => current.emit("close", 0));
    });
    returnChild(child);
    const exporter = new ProcessHwpxExporter("fixture-hwpx-exporter");

    await expect(exporter.run(input(outputPath), vi.fn())).rejects.toThrow(
      "unexpected diagnostics"
    );
    expect(child.kill).toHaveBeenCalledTimes(1);
    await exporter.dispose();
  });

  it("terminates and releases the child when the initial stdin end throws", async () => {
    const directory = await makeTemporaryDirectory();
    const child = createChild(() => {
      throw new Error("fixture synchronous input failure");
    });
    returnChild(child);
    const exporter = new ProcessHwpxExporter("fixture-hwpx-exporter");
    const run = exporter.run(input(path.join(directory, "output.hwpx")), vi.fn());
    const rejection = expect(run).rejects.toThrow("input stream failed");

    expect(child.kill).toHaveBeenCalledTimes(1);
    child.emit("close", null);

    await rejection;
    await expect(exporter.dispose()).resolves.toBeUndefined();
  });

  it("terminates on an asynchronous stdin end error before a terminal response", async () => {
    const directory = await makeTemporaryDirectory();
    const child = createChild((_source, current, callback) => {
      queueMicrotask(() => {
        callback?.(new Error("fixture asynchronous input failure"));
        current.emit("close", null);
      });
    });
    returnChild(child);
    const exporter = new ProcessHwpxExporter("fixture-hwpx-exporter");

    await expect(
      exporter.run(input(path.join(directory, "output.hwpx")), vi.fn())
    ).rejects.toThrow("input stream failed");
    expect(child.kill).toHaveBeenCalledTimes(1);
    await expect(exporter.dispose()).resolves.toBeUndefined();
  });

  it("ignores a late stdin callback error after a valid terminal response", async () => {
    const directory = await makeTemporaryDirectory();
    const outputPath = path.join(directory, "output.hwpx");
    const child = createChild((_source, current, callback) => {
      current.stdout.write(`${JSON.stringify(result(outputPath))}\n`);
      queueMicrotask(() => {
        callback?.(new Error("late fixture input failure"));
        current.emit("close", 0);
      });
    });
    returnChild(child);
    const exporter = new ProcessHwpxExporter("fixture-hwpx-exporter");

    await expect(exporter.run(input(outputPath), vi.fn())).resolves.toMatchObject({
      outputPath
    });
    expect(child.kill).not.toHaveBeenCalled();
    await exporter.dispose();
  });

  it("rejects protocol data emitted after a terminal result", async () => {
    const directory = await makeTemporaryDirectory();
    const outputPath = path.join(directory, "output.hwpx");
    const child = createChild((_source, current) => {
      current.stdout.write(
        `${JSON.stringify(result(outputPath))}\n${JSON.stringify({
          kind: "PROGRESS",
          stage: "COMPLETE",
          completed: 1,
          total: 1
        })}\n`
      );
      queueMicrotask(() => current.emit("close", 0));
    });
    returnChild(child);
    const exporter = new ProcessHwpxExporter("fixture-hwpx-exporter");

    await expect(exporter.run(input(outputPath), vi.fn())).rejects.toThrow(
      "invalid message"
    );
    expect(child.kill).toHaveBeenCalledTimes(1);
    await exporter.dispose();
  });

  it("preserves a foreign operation temporary path and never spawns", async () => {
    const directory = await makeTemporaryDirectory();
    const outputPath = path.join(directory, "output.hwpx");
    const temporaryPath = path.join(
      directory,
      `.madi-hwpx-${OPERATION_ID}.tmp`
    );
    await writeFile(temporaryPath, "foreign owner", "utf8");
    const exporter = new ProcessHwpxExporter("fixture-hwpx-exporter");

    await expect(exporter.run(input(outputPath), vi.fn())).rejects.toThrow(
      "already occupied"
    );
    expect(existsSync(temporaryPath)).toBe(true);
    expect(spawnMock).not.toHaveBeenCalled();
    await exporter.dispose();
  });

  it("rejects a non-canonical operation id before deriving a temporary path", async () => {
    const directory = await makeTemporaryDirectory();
    const exporter = new ProcessHwpxExporter("fixture-hwpx-exporter");
    const unsafe = {
      ...input(path.join(directory, "output.hwpx")),
      operationId: "../foreign-owner"
    };

    await expect(exporter.run(unsafe, vi.fn())).rejects.toThrow(
      "operation id is invalid"
    );
    expect(spawnMock).not.toHaveBeenCalled();
    await exporter.dispose();
  });

  it("cleans an owned temporary file even when the child exits before progress", async () => {
    const directory = await makeTemporaryDirectory();
    const outputPath = path.join(directory, "output.hwpx");
    const temporaryPath = path.join(
      directory,
      `.madi-hwpx-${OPERATION_ID}.tmp`
    );
    const child = createChild((_source, current) => {
      void writeFile(temporaryPath, "partial owned output", "utf8").then(() =>
        current.emit("close", null)
      );
    });
    returnChild(child);
    const exporter = new ProcessHwpxExporter("fixture-hwpx-exporter");

    await expect(exporter.run(input(outputPath), vi.fn())).rejects.toThrow(
      "did not complete"
    );
    expect(existsSync(temporaryPath)).toBe(false);
    await exporter.dispose();
  });

  it("retains a failed temporary cleanup in the disposal backlog", async () => {
    const directory = await makeTemporaryDirectory();
    const outputPath = path.join(directory, "output.hwpx");
    const temporaryPath = path.join(
      directory,
      `.madi-hwpx-${OPERATION_ID}.tmp`
    );
    const child = createChild((_source, current) => {
      void mkdir(temporaryPath).then(() => current.emit("close", null));
    });
    returnChild(child);
    const exporter = new ProcessHwpxExporter("fixture-hwpx-exporter");

    await expect(exporter.run(input(outputPath), vi.fn())).rejects.toThrow(
      "temporary file could not be removed"
    );
    await rm(temporaryPath, { recursive: true, force: false });
    await expect(exporter.dispose()).resolves.toBeUndefined();
  });

  it("waits for child close before cancellation resolves", async () => {
    const directory = await makeTemporaryDirectory();
    const child = createChild();
    returnChild(child);
    const exporter = new ProcessHwpxExporter("fixture-hwpx-exporter");
    const run = exporter.run(input(path.join(directory, "output.hwpx")), vi.fn());
    void run.catch(() => undefined);
    let settled = false;
    const cancellation = exporter.cancel(OPERATION_ID).then((accepted) => {
      settled = true;
      return accepted;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(child.kill).toHaveBeenCalledTimes(1);

    child.emit("close", null);
    await expect(cancellation).resolves.toBe(true);
    await expect(run).rejects.toThrow("cancelled");
    await exporter.dispose();
  });

  it("does not convert a received close into cancellation during cleanup", async () => {
    const directory = await makeTemporaryDirectory();
    const outputPath = path.join(directory, "output.hwpx");
    const child = createChild((_source, current) => {
      current.stdout.write(`${JSON.stringify(result(outputPath))}\n`);
    });
    returnChild(child);
    const exporter = new ProcessHwpxExporter("fixture-hwpx-exporter");
    const run = exporter.run(input(outputPath), vi.fn());

    child.emit("close", 0);
    await expect(exporter.cancel(OPERATION_ID)).resolves.toBe(false);
    await expect(run).resolves.toMatchObject({ outputPath });
    expect(child.kill).not.toHaveBeenCalled();
    await exporter.dispose();
  });

  it("does not overwrite a received terminal result with cancellation", async () => {
    const directory = await makeTemporaryDirectory();
    const outputPath = path.join(directory, "output.hwpx");
    const child = createChild((_source, current) => {
      current.stdout.write(`${JSON.stringify(result(outputPath))}\n`);
    });
    returnChild(child);
    const exporter = new ProcessHwpxExporter("fixture-hwpx-exporter");
    const run = exporter.run(input(outputPath), vi.fn());

    await expect(exporter.cancel(OPERATION_ID)).resolves.toBe(false);
    expect(child.kill).not.toHaveBeenCalled();
    child.emit("close", 0);

    await expect(run).resolves.toMatchObject({ outputPath });
    await exporter.dispose();
  });

  it("escalates timeout but does not settle run before child close", async () => {
    vi.useFakeTimers();
    const directory = await makeTemporaryDirectory();
    const child = createChild();
    returnChild(child);
    const exporter = new ProcessHwpxExporter("fixture-hwpx-exporter");
    const run = exporter.run(input(path.join(directory, "output.hwpx")), vi.fn());
    const rejection = expect(run).rejects.toThrow("timed out");
    let runSettled = false;
    void run.then(
      () => {
        runSettled = true;
      },
      () => {
        runSettled = true;
      }
    );

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(child.kill.mock.calls).toEqual([[]]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(child.kill.mock.calls).toEqual([[], ["SIGKILL"]]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runSettled).toBe(false);

    child.emit("close", null);
    await rejection;
    await expect(exporter.dispose()).resolves.toBeUndefined();
  });

  it("lets a received result close normally when disposal races with exit", async () => {
    const directory = await makeTemporaryDirectory();
    const outputPath = path.join(directory, "output.hwpx");
    const child = createChild((_source, current) => {
      current.stdout.write(`${JSON.stringify(result(outputPath))}\n`);
    });
    returnChild(child);
    const exporter = new ProcessHwpxExporter("fixture-hwpx-exporter");
    const run = exporter.run(input(outputPath), vi.fn());
    const disposal = exporter.dispose();

    expect(child.kill).not.toHaveBeenCalled();
    child.emit("close", 0);

    await expect(run).resolves.toMatchObject({ outputPath });
    await expect(disposal).resolves.toBeUndefined();
  });

  it("waits for close when disposal owns an active child", async () => {
    const directory = await makeTemporaryDirectory();
    const child = createChild();
    returnChild(child);
    const exporter = new ProcessHwpxExporter("fixture-hwpx-exporter");
    const run = exporter.run(input(path.join(directory, "output.hwpx")), vi.fn());
    const runRejection = expect(run).rejects.toThrow("disposed");
    let settled = false;
    const disposal = exporter.dispose().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(child.kill).toHaveBeenCalledTimes(1);
    child.emit("close", null);

    await expect(disposal).resolves.toBeUndefined();
    await runRejection;
  });

  it("does not clean a temporary path while its child is still live", async () => {
    vi.useFakeTimers();
    const directory = await makeTemporaryDirectory();
    const outputPath = path.join(directory, "output.hwpx");
    const temporaryPath = path.join(
      directory,
      `.madi-hwpx-${OPERATION_ID}.tmp`
    );
    const child = createChild(() => {
      writeFileSync(temporaryPath, "live child output", "utf8");
    });
    returnChild(child);
    const exporter = new ProcessHwpxExporter("fixture-hwpx-exporter");
    const run = exporter.run(input(outputPath), vi.fn());
    const runRejection = expect(run).rejects.toThrow("disposed");
    let runSettled = false;
    void run.then(
      () => {
        runSettled = true;
      },
      () => {
        runSettled = true;
      }
    );
    const disposal = exporter.dispose();
    const disposalRejection = expect(disposal).rejects.toThrow(
      "did not shut down cleanly"
    );

    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await disposalRejection;
    expect(runSettled).toBe(false);
    expect(existsSync(temporaryPath)).toBe(true);

    child.emit("close", null);
    await runRejection;
    await expect(exporter.dispose()).resolves.toBeUndefined();
    expect(existsSync(temporaryPath)).toBe(false);
  });
});
