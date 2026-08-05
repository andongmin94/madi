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

function childFor(response: Record<string, unknown>, stderr = ""): FakeChild {
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
    queueMicrotask(() => {
      child.stdout.end(`${JSON.stringify(response)}\n`);
      child.stderr.end(stderr);
      child.emit("close", 0, null);
    });
  });
  return child;
}

afterEach(() => {
  spawnMock.mockReset();
});

describe("atomic output process port", () => {
  it("rejects an otherwise valid response when the helper writes hostile stderr", async () => {
    const child = childFor(
      {
        status: "INSPECTED",
        identity: {
          byteLength: 1,
          sha256: "a".repeat(64),
          volumeSerialNumber: "b".repeat(16),
          fileId: "c".repeat(32)
        }
      },
      "hostile stderr"
    );
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    await expect(
      new ProcessAtomicOutput("C:\\madi-atomic-output.exe").inspect(
        "C:\\publication.hwpx",
        1024
      )
    ).rejects.toThrow("invalid response");
  });

  it("normalizes a synchronous spawn failure", async () => {
    spawnMock.mockImplementation(() => {
      throw new Error("host path disclosure");
    });

    await expect(
      new ProcessAtomicOutput("C:\\madi-atomic-output.exe").inspect(
        "C:\\publication.hwpx",
        1024
      )
    ).rejects.toThrow("could not start");
  });

  it("terminates and rejects an asynchronous stdin write failure once", async () => {
    const child = childFor({ status: "FAILED", code: "IO_FAILED" });
    child.stdin.write.mockImplementation(
      (
        _source: string,
        _encoding: BufferEncoding,
        callback?: (error?: Error | null) => void
      ) => {
        queueMicrotask(() => callback?.(new Error("host write disclosure")));
        return true;
      }
    );
    child.kill.mockImplementation(() => {
      queueMicrotask(() => child.emit("close", null, "SIGTERM"));
      return true;
    });
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    await expect(
      new ProcessAtomicOutput("C:\\madi-atomic-output.exe").inspect(
        "C:\\publication.hwpx",
        1024
      )
    ).rejects.toThrow("rejected its request");
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("terminates and rejects a synchronous stdin failure", async () => {
    const child = childFor({ status: "FAILED", code: "IO_FAILED" });
    child.stdin.write.mockImplementation(() => {
      throw new Error("host write disclosure");
    });
    child.kill.mockImplementation(() => {
      queueMicrotask(() => child.emit("close", null, "SIGTERM"));
      return true;
    });
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    await expect(
      new ProcessAtomicOutput("C:\\madi-atomic-output.exe").inspect(
        "C:\\publication.hwpx",
        1024
      )
    ).rejects.toThrow("rejected its request");
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});
