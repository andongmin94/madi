import { EventEmitter } from "node:events";
import path from "node:path";
import { PassThrough } from "node:stream";
import childProcess, {
  spawn as namedSpawn,
  type ChildProcessWithoutNullStreams
} from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProcessHwpBridge } from "../src/main/hwpBridgeClient";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  default: { spawn: spawnMock },
  spawn: spawnMock
}));

const mockedDefaultSpawn = vi.mocked(childProcess.spawn);
const mockedNamedSpawn = vi.mocked(namedSpawn);
const OPERATION_ID = "123e4567-e89b-42d3-a456-426614174000";
const OUTPUT_HASH = "a".repeat(64);

type FakeChild = Omit<
  ChildProcessWithoutNullStreams,
  "stdin" | "stdout" | "stderr" | "kill"
> & {
  readonly stdin: EventEmitter & {
    write: ReturnType<typeof vi.fn>;
  };
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly kill: ReturnType<typeof vi.fn>;
};

function createChild(
  onInput: (
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
  stdin.write = vi.fn(
    (
      source: string,
      _encoding?: BufferEncoding,
      callback?: (error?: Error | null) => void
    ) => {
      onInput(source, child, callback);
      return true;
    }
  );
  return child;
}

function returnChild(child: FakeChild): void {
  const spawned = child as unknown as ReturnType<typeof namedSpawn>;
  spawnMock.mockReturnValue(spawned);
  mockedDefaultSpawn.mockReturnValue(spawned);
  mockedNamedSpawn.mockReturnValue(spawned);
}

afterEach(() => {
  spawnMock.mockReset();
  mockedDefaultSpawn.mockReset();
  mockedNamedSpawn.mockReset();
  vi.useRealTimers();
});

describe("HWP bridge completion ownership", () => {
  it("waits for natural close after an error and keeps primary and cleanup codes", async () => {
    const child = createChild((source, current) => {
      const request = JSON.parse(source) as Record<string, unknown>;
      current.stdout.write(`${JSON.stringify({
        requestId: request.requestId, command: "probe", status: "ERROR",
        errorCode: "OPEN_FAILED", cleanupErrorCode: "NATIVE_EXIT_FAILED",
        message: "The bridge operation failed safely."
      })}\n`);
    });
    returnChild(child);
    const bridge = new ProcessHwpBridge("fixture-hwp-bridge.exe");
    const probe = bridge.probe();
    let settled = false;
    void probe.catch(() => { settled = true; });
    const disposal = bridge.dispose();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(child.kill).not.toHaveBeenCalled();
    child.emit("close", 0);
    await expect(probe).rejects.toMatchObject({ code: "OPEN_FAILED", cleanupErrorCode: "NATIVE_EXIT_FAILED" });
    await expect(disposal).resolves.toBeUndefined();
  });

  it("does not replace a committed success with a losing cancellation", async () => {
    const input = path.resolve("C:\\staging\\publication.hwpx");
    const output = path.resolve("C:\\staging\\publication.hwp");
    const child = createChild((source, current) => {
      const request = JSON.parse(source) as Record<string, unknown>;
      if (request.command === "cancel") {
        current.stdout.write(`${JSON.stringify({ requestId: request.requestId, command: "cancel", status: "SUCCESS", cancelled: false })}\n`);
        current.stdout.write(`${JSON.stringify({ requestId: OPERATION_ID, command: "convert", status: "SUCCESS", outputPath: output, byteLength: 128, sha256: OUTPUT_HASH })}\n`);
        queueMicrotask(() => current.emit("close", 0));
      }
    });
    returnChild(child);
    const bridge = new ProcessHwpBridge("fixture-hwp-bridge.exe");
    const conversion = bridge.convert(OPERATION_ID, input, output);
    await expect(bridge.cancel(OPERATION_ID)).resolves.toBe(false);
    await expect(conversion).resolves.toMatchObject({ sha256: OUTPUT_HASH });
    expect(child.kill).not.toHaveBeenCalled();
    await bridge.dispose();
  });

  it.each(["duplicate", "malformed", "stderr"] as const)("still rejects %s after a valid error", async (kind) => {
    const child = createChild((source, current) => {
      const request = JSON.parse(source) as Record<string, unknown>;
      const response = `${JSON.stringify({ requestId: request.requestId, command: "probe", status: "ERROR", errorCode: "OPEN_FAILED", message: "The bridge failed safely." })}\n`;
      current.stdout.write(response);
      if (kind === "duplicate") current.stdout.write(response);
      if (kind === "malformed") current.stdout.write("{invalid}\n");
      if (kind === "stderr") current.stderr.write("synthetic private sentinel");
      queueMicrotask(() => current.emit("close", 0));
    });
    returnChild(child);
    const bridge = new ProcessHwpBridge("fixture-hwp-bridge.exe");
    await expect(bridge.probe()).rejects.toMatchObject({ code: kind === "stderr" ? "DIAGNOSTIC_OUTPUT" : "INVALID_RESPONSE" });
    expect(child.kill).toHaveBeenCalledTimes(1);
    await bridge.dispose();
  });

  it.each([null, "bad code", 12])("rejects an invalid cleanup code %s", async (cleanupErrorCode) => {
    const child = createChild((source, current) => {
      const request = JSON.parse(source) as Record<string, unknown>;
      current.stdout.write(`${JSON.stringify({ requestId: request.requestId, command: "probe", status: "ERROR", errorCode: "OPEN_FAILED", cleanupErrorCode, message: "The bridge failed safely." })}\n`);
      queueMicrotask(() => current.emit("close", 0));
    });
    returnChild(child);
    const bridge = new ProcessHwpBridge("fixture-hwp-bridge.exe");
    await expect(bridge.probe()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await bridge.dispose();
  });

  it("does not treat cancellation cleanup failure as benign cancellation", async () => {
    const child = createChild((source, current) => {
      const request = JSON.parse(source) as Record<string, unknown>;
      current.stdout.write(`${JSON.stringify({ requestId: request.requestId, command: "probe", status: "ERROR", errorCode: "CANCELLED", cleanupErrorCode: "WORKER_CLEANUP_TIMEOUT", message: "The bridge failed safely." })}\n`);
      queueMicrotask(() => current.emit("close", 0));
    });
    returnChild(child);
    const bridge = new ProcessHwpBridge("fixture-hwp-bridge.exe");
    await expect(bridge.probe()).rejects.toMatchObject({ name: "HwpBridgeOperationError", code: "CANCELLED", cleanupErrorCode: "WORKER_CLEANUP_TIMEOUT" });
    await bridge.dispose();
  });

  it("uses a bounded close watchdog after a typed error instead of killing immediately", async () => {
    vi.useFakeTimers();
    const child = createChild((source, current) => {
      const request = JSON.parse(source) as Record<string, unknown>;
      current.stdout.write(`${JSON.stringify({ requestId: request.requestId, command: "probe", status: "ERROR", errorCode: "OPEN_FAILED", message: "The bridge failed safely." })}\n`);
    });
    returnChild(child);
    const bridge = new ProcessHwpBridge("fixture-hwp-bridge.exe");
    const probe = bridge.probe();
    void probe.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
    child.emit("close", null);
    await expect(probe).rejects.toMatchObject({ code: "OPEN_FAILED", cleanupErrorCode: "PROCESS_SHUTDOWN_TIMEOUT" });
    await bridge.dispose();
  });

  it.each(["OPEN_FAILED", "CANCELLED"])("rejects a never-closing child with cleanup failure after %s", async (errorCode) => {
    vi.useFakeTimers();
    const input = path.resolve("C:\\staging\\publication.hwpx");
    const output = path.resolve("C:\\staging\\publication.hwp");
    const child = createChild((source, current) => {
      const request = JSON.parse(source) as Record<string, unknown>;
      current.stdout.write(`${JSON.stringify({ requestId: request.requestId, command: "convert", status: "ERROR", errorCode, message: "The bridge failed safely." })}\n`);
    });
    returnChild(child);
    const bridge = new ProcessHwpBridge("fixture-hwp-bridge.exe");
    let settled = false;
    const outcome = bridge.convert(OPERATION_ID, input, output).catch((error: unknown) => {
      settled = true;
      return error;
    });
    await vi.advanceTimersByTimeAsync(34_999);
    expect(settled).toBe(false);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    await vi.advanceTimersByTimeAsync(1);
    await expect(outcome).resolves.toMatchObject({
      name: "HwpBridgeOperationError", code: errorCode, cleanupErrorCode: "PROCESS_SHUTDOWN_TIMEOUT"
    });
    // No close was emitted. The operation settles, but ownership remains and
    // cannot be reused or reported as successfully disposed.
    await expect(bridge.convert(OPERATION_ID, input, output)).rejects.toThrow("already running");
    const disposal = bridge.dispose();
    const disposalResult = disposal.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(disposalResult).resolves.toMatchObject({ message: "The local HWP bridge did not shut down cleanly" });
  });

  it("preserves success if it arrives before a cancel ack or a late cancel write error", async () => {
    vi.useFakeTimers();
    const input = path.resolve("C:\\staging\\publication.hwpx");
    const output = path.resolve("C:\\staging\\publication.hwp");
    const child = createChild((source, current, callback) => {
      const request = JSON.parse(source) as Record<string, unknown>;
      if (request.command === "cancel") {
        current.stdout.write(`${JSON.stringify({ requestId: OPERATION_ID, command: "convert", status: "SUCCESS", outputPath: output, byteLength: 128, sha256: OUTPUT_HASH })}\n`);
        callback?.(new Error("late synthetic cancellation write failure"));
      }
    });
    returnChild(child);
    const bridge = new ProcessHwpBridge("fixture-hwp-bridge.exe");
    const conversion = bridge.convert(OPERATION_ID, input, output);
    const cancellation = bridge.cancel(OPERATION_ID);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(child.kill).not.toHaveBeenCalled();
    child.emit("close", 0);
    await expect(cancellation).resolves.toBe(false);
    await expect(conversion).resolves.toMatchObject({ sha256: OUTPUT_HASH });
    await bridge.dispose();
  });

  it("reserves the service cleanup budget inside the request watchdog", async () => {
    vi.useFakeTimers();
    const child = createChild(() => undefined);
    returnChild(child);
    const bridge = new ProcessHwpBridge("fixture-hwp-bridge.exe");
    const probe = bridge.probe();
    void probe.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(17_999);
    expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
    child.emit("close", null);
    await expect(probe).rejects.toMatchObject({ code: "PROCESS_TIMEOUT" });
    await bridge.dispose();
  });
  it("preserves a completed conversion while the child is still closing", async () => {
    const input = path.resolve("C:\\staging\\publication.hwpx");
    const output = path.resolve("C:\\staging\\publication.hwp");
    const child = createChild((source, current) => {
      const request = JSON.parse(source) as Record<string, unknown>;
      if (request.command !== "convert") {
        throw new Error("unexpected bridge command");
      }
      current.stdout.write(
        `${JSON.stringify({
          requestId: request.requestId,
          command: "convert",
          status: "SUCCESS",
          outputPath: output,
          byteLength: 128,
          sha256: OUTPUT_HASH
        })}\n`
      );
    });
    returnChild(child);
    const bridge = new ProcessHwpBridge("fixture-hwp-bridge.exe");

    const conversion = bridge.convert(OPERATION_ID, input, output);
    await Promise.resolve();

    await expect(bridge.cancel(OPERATION_ID)).resolves.toBe(false);
    expect(child.stdin.write).toHaveBeenCalledTimes(1);
    expect(child.kill).not.toHaveBeenCalled();

    let disposalSettled = false;
    const disposal = bridge.dispose().then(() => {
      disposalSettled = true;
    });
    await Promise.resolve();

    expect(disposalSettled).toBe(false);
    expect(child.kill).not.toHaveBeenCalled();

    child.emit("close", 0);

    await expect(conversion).resolves.toEqual({
      outputPath: output,
      byteLength: 128,
      sha256: OUTPUT_HASH,
      hancomVersion: null
    });
    await expect(disposal).resolves.toBeUndefined();
    expect(disposalSettled).toBe(true);
  });
});
