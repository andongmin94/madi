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

function failingChild(): FakeChild {
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
      callback?.(new Error("fixture write failure"));
      return true;
    }
  );
  stdin.end = vi.fn();
  return child;
}

function inspect(process: ProcessAtomicOutput): Promise<unknown> {
  return process.inspect("C:\\publication.hwpx", 1024);
}

afterEach(() => {
  vi.useRealTimers();
  spawnMock.mockReset();
});

describe("atomic output owned-process shutdown", () => {
  it("keeps the failed request pending until the owned child actually closes", async () => {
    const child = failingChild();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const request = inspect(
      new ProcessAtomicOutput("C:\\madi-atomic-output.exe")
    );
    let settled = false;
    void request.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );

    await Promise.resolve();

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenNthCalledWith(1);
    expect(settled).toBe(false);

    child.emit("close", null, "SIGTERM");

    await expect(request).rejects.toThrow("rejected its request");
    expect(settled).toBe(true);
  });

  it("escalates to SIGKILL and reports an explicit shutdown failure", async () => {
    vi.useFakeTimers();
    const child = failingChild();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const request = inspect(
      new ProcessAtomicOutput("C:\\madi-atomic-output.exe")
    );
    let settled = false;
    void request.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenNthCalledWith(1);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(settled).toBe(false);
    expect(child.kill).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenCalledTimes(2);
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(settled).toBe(false);

    const rejected = expect(request).rejects.toThrow("did not stop");
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(settled).toBe(true);
  });
});
