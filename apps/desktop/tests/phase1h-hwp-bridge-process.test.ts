import { EventEmitter } from "node:events";
import path from "node:path";
import { PassThrough } from "node:stream";
import childProcess, {
  spawn as namedSpawn,
  type ChildProcessWithoutNullStreams
} from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProcessHwpBridge,
  resolveHwpBridgeBinary
} from "../src/main/hwpBridgeClient";

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
});

describe("Phase 1H local HWP bridge process boundary", () => {
  it("uses the packaged fixed executable path", () => {
    expect(
      resolveHwpBridgeBinary({
        appPath: "C:\\app",
        resourcesPath: "C:\\resources",
        isPackaged: true,
        platform: "win32",
        environment: {}
      })
    ).toBe(
      path.join(
        "C:\\resources",
        "bin",
        "hwp-bridge",
        "madi-hwp-bridge.exe"
      )
    );
  });

  it("probes with a strict one-line request and accepts only a real safe success", async () => {
    let request: Record<string, unknown> | null = null;
    const child = createChild((source, current) => {
      request = JSON.parse(source) as Record<string, unknown>;
      current.stdout.write(
        `${JSON.stringify({
          requestId: request.requestId,
          command: "probe",
          status: "SUCCESS",
          available: true,
          availabilityCode: "AVAILABLE",
          hancomVersion: "Hancom 2024"
        })}\n`
      );
      queueMicrotask(() => current.emit("close", 0));
    });
    returnChild(child);
    const bridge = new ProcessHwpBridge("fixture-hwp-bridge.exe");

    await expect(bridge.probe()).resolves.toEqual({
      available: true,
      availabilityCode: "AVAILABLE",
      hancomVersion: "Hancom 2024"
    });
    expect(request).toMatchObject({ command: "probe", timeoutMs: 10_000 });
    expect(Object.keys(request!).sort()).toEqual([
      "command",
      "requestId",
      "timeoutMs"
    ]);
    expect(spawnMock).toHaveBeenCalledWith("fixture-hwp-bridge.exe", [], {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    await bridge.dispose();
  });

  it("rejects hostile response fields and terminates only its child", async () => {
    const child = createChild((source, current) => {
      const request = JSON.parse(source) as Record<string, unknown>;
      current.stdout.write(
        `${JSON.stringify({
          requestId: request.requestId,
          command: "probe",
          status: "SUCCESS",
          available: true,
          availabilityCode: "AVAILABLE",
          manuscriptText: "private draft"
        })}\n`
      );
      queueMicrotask(() => current.emit("close", 0));
    });
    returnChild(child);
    const bridge = new ProcessHwpBridge("fixture-hwp-bridge.exe");

    await expect(bridge.probe()).rejects.toMatchObject({
      code: "INVALID_RESPONSE"
    });
    expect(child.kill).toHaveBeenCalledTimes(1);
    await bridge.dispose();
  });

  it("rejects any bridge stderr without retaining private diagnostics", async () => {
    const child = createChild((source, current) => {
      const request = JSON.parse(source) as Record<string, unknown>;
      current.stderr.write("private manuscript sentinel");
      current.stdout.write(
        `${JSON.stringify({
          requestId: request.requestId,
          command: "probe",
          status: "SUCCESS",
          available: false,
          availabilityCode: "NOT_INSTALLED"
        })}\n`
      );
      queueMicrotask(() => current.emit("close", 0));
    });
    returnChild(child);
    const bridge = new ProcessHwpBridge("fixture-hwp-bridge.exe");

    await expect(bridge.probe()).rejects.toMatchObject({
      code: "DIAGNOSTIC_OUTPUT"
    });
    expect(child.kill).toHaveBeenCalledTimes(1);
    await bridge.dispose();
  });

  it("terminates its owned child immediately after a typed bridge error", async () => {
    const child = createChild((source, current) => {
      const request = JSON.parse(source) as Record<string, unknown>;
      current.stdout.write(
        `${JSON.stringify({
          requestId: request.requestId,
          command: "probe",
          status: "ERROR",
          errorCode: "AUTOMATION_FAILED",
          message: "The bridge operation failed."
        })}\n`
      );
      queueMicrotask(() => current.emit("close", 1));
    });
    returnChild(child);
    const bridge = new ProcessHwpBridge("fixture-hwp-bridge.exe");

    await expect(bridge.probe()).rejects.toMatchObject({
      code: "AUTOMATION_FAILED"
    });
    expect(child.kill).toHaveBeenCalledTimes(1);
    await bridge.dispose();
  });

  it("converts with no-clobber and uses the typed in-process cancellation channel", async () => {
    const requests: Record<string, unknown>[] = [];
    const child = createChild((source, current) => {
      const request = JSON.parse(source) as Record<string, unknown>;
      requests.push(request);
      if (request.command === "cancel") {
        current.stdout.write(
          `${JSON.stringify({
            requestId: request.requestId,
            command: "cancel",
            status: "SUCCESS",
            cancelled: true
          })}\n${JSON.stringify({
            requestId: OPERATION_ID,
            command: "convert",
            status: "ERROR",
            errorCode: "CANCELLED",
            message: "The bridge operation was cancelled."
          })}\n`
        );
        queueMicrotask(() => current.emit("close", 0));
      }
    });
    returnChild(child);
    const bridge = new ProcessHwpBridge("fixture-hwp-bridge.exe");
    const input = path.resolve("C:\\staging\\publication.hwpx");
    const output = path.resolve("C:\\staging\\publication.hwp");
    const conversion = bridge.convert(OPERATION_ID, input, output);
    void conversion.catch(() => undefined);

    await expect(bridge.cancel(OPERATION_ID)).resolves.toBe(true);
    await expect(conversion).rejects.toThrow("cancelled");
    expect(requests[0]).toEqual({
      requestId: OPERATION_ID,
      command: "convert",
      inputHwpx: input,
      outputHwp: output,
      overwrite: false,
      timeoutMs: 300_000
    });
    expect(requests[1]).toMatchObject({
      command: "cancel",
      targetRequestId: OPERATION_ID
    });
    expect(child.kill).toHaveBeenCalledTimes(1);
    await bridge.dispose();
  });

  it("strictly validates conversion output identity", async () => {
    const input = path.resolve("C:\\staging\\publication.hwpx");
    const output = path.resolve("C:\\staging\\publication.hwp");
    const child = createChild((source, current) => {
      const request = JSON.parse(source) as Record<string, unknown>;
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
      queueMicrotask(() => current.emit("close", 0));
    });
    returnChild(child);
    const bridge = new ProcessHwpBridge("fixture-hwp-bridge.exe");

    await expect(bridge.convert(OPERATION_ID, input, output)).resolves.toEqual({
      outputPath: output,
      byteLength: 128,
      sha256: OUTPUT_HASH,
      hancomVersion: null
    });
    await bridge.dispose();
  });

  it("terminates and releases a process when the initial stdin write throws", async () => {
    const child = createChild(() => {
      throw new Error("fixture write failure");
    });
    returnChild(child);
    const bridge = new ProcessHwpBridge("fixture-hwp-bridge.exe");
    const probe = bridge.probe();
    expect(child.kill).toHaveBeenCalledTimes(1);
    child.emit("close", null);

    await expect(probe).rejects.toMatchObject({ code: "INPUT_WRITE_FAILED" });
    await expect(bridge.dispose()).resolves.toBeUndefined();
  });

  it("terminates and releases a process on an asynchronous initial write error", async () => {
    const child = createChild((_source, current, callback) => {
      queueMicrotask(() => {
        callback?.(new Error("fixture async write failure"));
        current.emit("close", null);
      });
    });
    returnChild(child);
    const bridge = new ProcessHwpBridge("fixture-hwp-bridge.exe");

    await expect(bridge.probe()).rejects.toMatchObject({
      code: "INPUT_WRITE_FAILED"
    });
    expect(child.kill).toHaveBeenCalledTimes(1);
    await expect(bridge.dispose()).resolves.toBeUndefined();
  });

  it("ignores a late write callback error after a terminal response", async () => {
    let writeCallback: ((error?: Error | null) => void) | undefined;
    const child = createChild((source, current, callback) => {
      writeCallback = callback;
      const request = JSON.parse(source) as Record<string, unknown>;
      current.stdout.write(
        `${JSON.stringify({
          requestId: request.requestId,
          command: "probe",
          status: "SUCCESS",
          available: false,
          availabilityCode: "NOT_INSTALLED"
        })}\n`
      );
      queueMicrotask(() => {
        writeCallback?.(new Error("late fixture error"));
        current.emit("close", 0);
      });
    });
    returnChild(child);
    const bridge = new ProcessHwpBridge("fixture-hwp-bridge.exe");

    await expect(bridge.probe()).resolves.toEqual({
      available: false,
      availabilityCode: "NOT_INSTALLED",
      hancomVersion: null
    });
    expect(child.kill).not.toHaveBeenCalled();
    await bridge.dispose();
  });

  it("contains a cancellation write failure to the owned child and waits for close", async () => {
    let writes = 0;
    const child = createChild((_source, _current, callback) => {
      writes += 1;
      if (writes === 2) {
        callback?.(new Error("fixture cancellation write failure"));
      }
    });
    returnChild(child);
    const bridge = new ProcessHwpBridge("fixture-hwp-bridge.exe");
    const input = path.resolve("C:\\staging\\publication.hwpx");
    const output = path.resolve("C:\\staging\\publication.hwp");
    const conversion = bridge.convert(OPERATION_ID, input, output);
    void conversion.catch(() => undefined);
    const cancellation = bridge.cancel(OPERATION_ID);
    expect(child.kill).toHaveBeenCalledTimes(1);
    child.emit("close", null);

    await expect(cancellation).resolves.toBe(true);
    await expect(conversion).rejects.toThrow("cancelled");
    await bridge.dispose();
  });
});
