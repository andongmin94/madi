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
});

describe("HWP bridge completion ownership", () => {
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
