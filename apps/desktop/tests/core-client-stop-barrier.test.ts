import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JsonRpcCoreClient } from "../src/main/coreClient";

type WriteCallback = (error?: Error | null) => void;

class FakeCoreProcess extends EventEmitter {
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly kill = vi.fn(
    (_signal?: NodeJS.Signals | number) => true
  );
  public readonly unref = vi.fn();
  public readonly requests: Array<{ id: number; method: string }> = [];
  public readonly stdin = {
    destroy: vi.fn(),
    write: vi.fn((payload: string, _encoding: string, callback: WriteCallback) => {
      const request = JSON.parse(payload.trim()) as {
        id: number;
        method: string;
      };
      this.requests.push(request);
      callback();
      return true;
    })
  };

  public respond(index: number, result: unknown): void {
    const request = this.requests[index];
    if (!request) {
      throw new Error("missing request");
    }
    this.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`
    );
  }

  public asChildProcess(): ChildProcessWithoutNullStreams {
    return this as unknown as ChildProcessWithoutNullStreams;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("core sidecar restart barrier", () => {
  it("fails closed when a timed-out core does not stop, then recovers after late close", async () => {
    vi.useFakeTimers();
    const firstChild = new FakeCoreProcess();
    const secondChild = new FakeCoreProcess();
    const children = [firstChild, secondChild];
    const spawnProcess = vi.fn(() => {
      const child = children.shift();
      if (!child) {
        throw new Error("unexpected extra spawn");
      }
      return child.asChildProcess();
    });
    const client = new JsonRpcCoreClient("madi-core", {
      spawnProcess,
      requestTimeoutMs: () => 25
    });

    const timedOut = client.request("save_scene", { sceneId: "scene-1" });
    const timedOutRejection = expect(timedOut).rejects.toThrow(
      "Core command save_scene timed out"
    );
    await vi.advanceTimersByTimeAsync(25);
    await timedOutRejection;

    const blocked = client.request("load_ui_state", { key: "reader" });
    let blockedSettled = false;
    void blocked.then(
      () => {
        blockedSettled = true;
      },
      () => {
        blockedSettled = true;
      }
    );
    expect(spawnProcess).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(14_999);
    expect(blockedSettled).toBe(false);
    expect(firstChild.kill).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(firstChild.kill).toHaveBeenCalledTimes(2);
    expect(firstChild.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    expect(blockedSettled).toBe(false);

    const blockedRejection = expect(blocked).rejects.toThrow(
      "previous local core did not stop"
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await blockedRejection;
    expect(spawnProcess).toHaveBeenCalledTimes(1);

    await expect(
      client.request("load_ui_state", { key: "still-blocked" })
    ).rejects.toThrow("previous local core did not stop");

    firstChild.emit("close", null, "SIGKILL");

    const recovered = client.request("load_ui_state", { key: "reader" });
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(secondChild.requests.map(({ method }) => method)).toEqual([
      "load_ui_state"
    ]);
    secondChild.respond(0, { state: "reader" });
    await expect(recovered).resolves.toEqual({ state: "reader" });
    client.dispose();
  });

  it("clears restart watchdogs when disposed while a failed core is still stopping", async () => {
    vi.useFakeTimers();
    const child = new FakeCoreProcess();
    const client = new JsonRpcCoreClient("madi-core", {
      spawnProcess: () => child.asChildProcess(),
      requestTimeoutMs: () => 25
    });

    const timedOut = client.request("save_scene", { sceneId: "scene-1" });
    const timedOutRejection = expect(timedOut).rejects.toThrow(
      "Core command save_scene timed out"
    );
    await vi.advanceTimersByTimeAsync(25);
    await timedOutRejection;

    expect(child.kill).toHaveBeenCalledTimes(1);
    client.dispose();
    expect(child.kill).toHaveBeenCalledTimes(2);
    expect(child.unref).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(
      child.kill.mock.calls.some(([signal]) => signal === "SIGKILL")
    ).toBe(false);
    await expect(
      client.request("load_ui_state", { key: "after-dispose" })
    ).rejects.toThrow("The local core is not available");
  });
});
