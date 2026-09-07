import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProcessAtomicOutput } from "../src/main/atomicOutputClient";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  default: { spawn: spawnMock },
  spawn: spawnMock
}));

type FakeChild = Omit<
  ChildProcessWithoutNullStreams,
  "stdin" | "stdout" | "stderr" | "kill"
> & {
  readonly stdin: EventEmitter & {
    end: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
  };
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly kill: ReturnType<typeof vi.fn>;
};

function malformedUtf8Child(): FakeChild {
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
      _source: string,
      _encoding: BufferEncoding,
      callback?: (error?: Error | null) => void
    ) => {
      callback?.(null);
      return true;
    }
  );
  stdin.end = vi.fn(() => {
    child.stdout.write(
      Buffer.concat([
        Buffer.from('{"status":"INSPECTED","identity":{"byteLength":1,"sha256":"', "utf8"),
        Buffer.from([0x80]),
        Buffer.from('"}}', "utf8")
      ])
    );
    queueMicrotask(() => child.emit("close", 0, null));
  });
  return child;
}

afterEach(() => {
  spawnMock.mockReset();
});

describe("atomic output UTF-8 boundary", () => {
  it("rejects malformed UTF-8 before JSON response validation", async () => {
    const child = malformedUtf8Child();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const output = new ProcessAtomicOutput("fixture-atomic-output");

    await expect(
      output.inspect("C:\\publication.hwpx", 1024)
    ).rejects.toThrow("invalid UTF-8");
  });
});
