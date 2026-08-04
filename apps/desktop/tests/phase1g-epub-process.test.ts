import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import childProcess, {
  spawn as namedSpawn,
  type ChildProcessWithoutNullStreams
} from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EpubExporterRunInput } from "../src/main/epubExportClient";
import { ProcessEpubExporter } from "../src/main/epubExportClient";
import { readerPublication } from "./reader-lab-fixtures";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  default: { spawn: spawnMock },
  spawn: spawnMock
}));

const mockedDefaultSpawn = vi.mocked(childProcess.spawn);
const mockedNamedSpawn = vi.mocked(namedSpawn);

function returnChildFromSpawn(child: FakeChild): void {
  const spawnedChild = child as unknown as ReturnType<typeof namedSpawn>;
  spawnMock.mockReturnValue(spawnedChild);
  mockedDefaultSpawn.mockReturnValue(spawnedChild);
  mockedNamedSpawn.mockReturnValue(spawnedChild);
}

const OPERATION_ID = "123e4567-e89b-42d3-a456-426614174000";
const HASH = "a".repeat(64);
const temporaryDirectories: string[] = [];

type FakeChild = Omit<
  ChildProcessWithoutNullStreams,
  "stdin" | "stdout" | "stderr" | "kill"
> & {
  readonly stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly kill: ReturnType<typeof vi.fn>;
};

function createChild(
  onInput?: (child: FakeChild) => void
): FakeChild {
  const events = new EventEmitter();
  const stdin = new EventEmitter() as EventEmitter & {
    end: ReturnType<typeof vi.fn>;
  };
  const child = Object.assign(events, {
    stdin,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true)
  }) as unknown as FakeChild;
  stdin.end = vi.fn(() => onInput?.(child));
  return child;
}

function input(outputPath: string): EpubExporterRunInput {
  return {
    operationId: OPERATION_ID,
    mode: "EXPORT",
    document: readerPublication({ revision: 5 }),
    sourcePublicationHash: HASH,
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

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "madi-epub-process-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.useRealTimers();
  mockedDefaultSpawn.mockReset();
  mockedNamedSpawn.mockReset();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("Phase 1G EPUB child-process boundary", () => {
  it("waits for close and temporary-file cleanup before cancellation resolves", async () => {
    const directory = await makeTemporaryDirectory();
    const outputPath = path.join(directory, "output.epub");
    const temporaryPath = path.join(
      directory,
      `.madi-epub-${OPERATION_ID}.tmp`
    );
    const child = createChild();
    returnChildFromSpawn(child);
    const exporter = new ProcessEpubExporter("fixture-exporter");
    const run = exporter.run(input(outputPath), vi.fn());
    void run.catch(() => undefined);
    child.stdout.write(
      `${JSON.stringify({
        kind: "PROGRESS",
        stage: "WRITE_OUTPUT",
        completed: 1,
        total: 1
      })}\n`
    );
    await writeFile(temporaryPath, "content-free fixture", "utf8");
    let cancellationSettled = false;

    const cancellation = exporter.cancel(OPERATION_ID).then((accepted) => {
      cancellationSettled = true;
      return accepted;
    });
    await Promise.resolve();

    expect(cancellationSettled).toBe(false);
    expect(existsSync(temporaryPath)).toBe(true);
    expect(child.kill).toHaveBeenCalledTimes(1);

    child.emit("close", null);
    await expect(cancellation).resolves.toBe(true);
    await expect(run).rejects.toThrow("cancelled");
    expect(existsSync(temporaryPath)).toBe(false);
    await expect(exporter.cancel(OPERATION_ID)).resolves.toBe(false);
    await exporter.dispose();
  });

  it("rejects and preserves a pre-existing temporary-path collision", async () => {
    const directory = await makeTemporaryDirectory();
    const outputPath = path.join(directory, "output.epub");
    const temporaryPath = path.join(
      directory,
      `.madi-epub-${OPERATION_ID}.tmp`
    );
    const foreignBytes = Buffer.from("foreign temporary owner", "utf8");
    await writeFile(temporaryPath, foreignBytes);
    const exporter = new ProcessEpubExporter("fixture-exporter");

    await expect(exporter.run(input(outputPath), vi.fn())).rejects.toThrow(
      "already occupied"
    );
    await expect(readFile(temporaryPath)).resolves.toEqual(foreignBytes);
    await exporter.dispose();
  });

  it("preserves a foreign temporary file created after spawn but before WRITE_OUTPUT", async () => {
    const directory = await makeTemporaryDirectory();
    const outputPath = path.join(directory, "output.epub");
    const temporaryPath = path.join(
      directory,
      `.madi-epub-${OPERATION_ID}.tmp`
    );
    const foreignBytes = Buffer.from("late foreign temporary owner", "utf8");
    const child = createChild();
    returnChildFromSpawn(child);
    const exporter = new ProcessEpubExporter("fixture-exporter");
    const run = exporter.run(input(outputPath), vi.fn());
    void run.catch(() => undefined);

    await writeFile(temporaryPath, foreignBytes);
    child.emit("close", 1);

    await expect(run).rejects.toThrow("did not complete");
    await expect(readFile(temporaryPath)).resolves.toEqual(foreignBytes);
    await exporter.dispose();
  });

  it("rejects malformed utility output without surfacing the payload", async () => {
    const directory = await makeTemporaryDirectory();
    const child = createChild((current) => {
      current.stdout.write("{not-json}\n");
      queueMicrotask(() => current.emit("close", 1));
    });
    returnChildFromSpawn(child);
    const exporter = new ProcessEpubExporter("fixture-exporter");

    await expect(
      exporter.run(input(path.join(directory, "output.epub")), vi.fn())
    ).rejects.toThrow("malformed JSON");
    expect(child.kill).toHaveBeenCalled();
    await exporter.dispose();
  });

  it("turns an early stdin failure into a bounded generic error", async () => {
    const directory = await makeTemporaryDirectory();
    const child = createChild((current) => {
      current.stdin.emit("error", new Error("fixture EPIPE"));
      queueMicrotask(() => current.emit("close", 1));
    });
    returnChildFromSpawn(child);
    const exporter = new ProcessEpubExporter("fixture-exporter");

    await expect(
      exporter.run(input(path.join(directory, "output.epub")), vi.fn())
    ).rejects.toThrow("input stream failed");
    expect(child.kill).toHaveBeenCalled();
    await exporter.dispose();
  });

  it("rejects progress beyond the shared preload bound before forwarding it", async () => {
    const directory = await makeTemporaryDirectory();
    const child = createChild((current) => {
      current.stdout.write(
        `${JSON.stringify({
          kind: "PROGRESS",
          stage: "XHTML_GENERATION",
          completed: 1,
          total: 1_000_001
        })}\n`
      );
      queueMicrotask(() => current.emit("close", 1));
    });
    returnChildFromSpawn(child);
    const onProgress = vi.fn();
    const exporter = new ProcessEpubExporter("fixture-exporter");

    await expect(
      exporter.run(input(path.join(directory, "output.epub")), onProgress)
    ).rejects.toThrow("invalid message");
    expect(onProgress).not.toHaveBeenCalled();
    await exporter.dispose();
  });

  it("escalates an export timeout from graceful termination to SIGKILL", async () => {
    vi.useFakeTimers();
    const directory = await makeTemporaryDirectory();
    const child = createChild();
    returnChildFromSpawn(child);
    const exporter = new ProcessEpubExporter("fixture-exporter");
    const run = exporter.run(
      input(path.join(directory, "timeout.epub")),
      vi.fn()
    );
    const rejectedRun = expect(run).rejects.toThrow("timed out");

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenNthCalledWith(1);

    await vi.advanceTimersByTimeAsync(14_999);
    expect(
      child.kill.mock.calls.some(([signal]) => signal === "SIGKILL")
    ).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(
      child.kill.mock.calls.some(([signal]) => signal === "SIGKILL")
    ).toBe(true);

    child.emit("close", null);
    await rejectedRun;
    await exporter.dispose();
  });

  it("bounds cancellation when the child never emits close", async () => {
    vi.useFakeTimers();
    const directory = await makeTemporaryDirectory();
    const child = createChild();
    returnChildFromSpawn(child);
    const exporter = new ProcessEpubExporter("fixture-exporter");
    const run = exporter.run(
      input(path.join(directory, "missing-close.epub")),
      vi.fn()
    );
    const rejectedRun = expect(run).rejects.toThrow("cancelled");
    let cancellationSettled = false;
    const cancellation = exporter.cancel(OPERATION_ID).finally(() => {
      cancellationSettled = true;
    });
    const rejectedCancellation = expect(cancellation).rejects.toThrow(
      "did not stop"
    );

    await vi.advanceTimersByTimeAsync(14_999);
    expect(cancellationSettled).toBe(false);
    expect(child.kill).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(cancellationSettled).toBe(false);
    expect(
      child.kill.mock.calls.some(([signal]) => signal === "SIGKILL")
    ).toBe(true);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(cancellationSettled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejectedCancellation;

    child.emit("close", null);
    await rejectedRun;
    await exporter.dispose();
  });

  it("keeps dispose pending until every active child closes", async () => {
    vi.useFakeTimers();
    const directory = await makeTemporaryDirectory();
    const child = createChild();
    returnChildFromSpawn(child);
    const exporter = new ProcessEpubExporter("fixture-exporter");
    const run = exporter.run(
      input(path.join(directory, "dispose.epub")),
      vi.fn()
    );
    const rejectedRun = expect(run).rejects.toThrow("disposed");
    let disposeSettled = false;
    const disposal = exporter.dispose().then(() => {
      disposeSettled = true;
    });

    await Promise.resolve();
    expect(disposeSettled).toBe(false);
    expect(child.kill).toHaveBeenCalledTimes(1);

    child.emit("close", null);
    await disposal;
    await rejectedRun;
    expect(disposeSettled).toBe(true);
    await expect(
      exporter.run(input(path.join(directory, "after-dispose.epub")), vi.fn())
    ).rejects.toThrow("not available");
  });

  it("retains a failed temporary cleanup and retries it on dispose", async () => {
    const directory = await makeTemporaryDirectory();
    const outputPath = path.join(directory, "cleanup.epub");
    const temporaryPath = path.join(
      directory,
      `.madi-epub-${OPERATION_ID}.tmp`
    );
    const child = createChild();
    returnChildFromSpawn(child);
    const exporter = new ProcessEpubExporter("fixture-exporter");
    const run = exporter.run(input(outputPath), vi.fn());
    const rejectedRun = expect(run).rejects.toThrow(
      "temporary file could not be removed"
    );
    child.stdout.write(
      `${JSON.stringify({
        kind: "PROGRESS",
        stage: "WRITE_OUTPUT",
        completed: 1,
        total: 1
      })}\n`
    );
    await mkdir(temporaryPath);

    child.emit("close", 1);
    await rejectedRun;
    expect(existsSync(temporaryPath)).toBe(true);

    await expect(exporter.dispose()).rejects.toThrow(
      "did not shut down cleanly"
    );

    await rm(temporaryPath, { recursive: true, force: true });
    await expect(exporter.dispose()).resolves.toBeUndefined();
    expect(existsSync(temporaryPath)).toBe(false);
  });
});
