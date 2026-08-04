import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonRpcCoreClient } from "../src/main/coreClient";

interface CapturedRequest {
  readonly jsonrpc: "2.0";
  readonly id: number;
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
}

type WriteCallback = (error?: Error | null) => void;
type WriteBehavior = (
  request: CapturedRequest,
  callback: WriteCallback
) => void;

class FakeCoreStdin {
  public readonly destroy = vi.fn();

  public constructor(
    private readonly capture: (
      payload: string,
      callback: WriteCallback
    ) => void
  ) {}

  public write(
    payload: string,
    encoding: string,
    callback: WriteCallback
  ): boolean {
    expect(encoding).toBe("utf8");
    this.capture(payload, callback);
    return true;
  }
}

class FakeCoreProcess extends EventEmitter {
  public readonly stdin: FakeCoreStdin;
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly requests: CapturedRequest[] = [];
  public readonly kill = vi.fn(() => true);
  public readonly unref = vi.fn();
  public writeBehavior: WriteBehavior | undefined;

  public constructor(writeBehavior?: WriteBehavior) {
    super();
    this.writeBehavior = writeBehavior;
    this.stdin = new FakeCoreStdin((payload, callback) => {
      const request = JSON.parse(payload.trim()) as CapturedRequest;
      this.requests.push(request);
      if (this.writeBehavior) {
        this.writeBehavior(request, callback);
      } else {
        callback();
      }
    });
  }

  public respond(requestIndex: number, result: unknown): void {
    const request = this.requests[requestIndex];
    if (!request) {
      throw new Error(`Missing captured request ${requestIndex}`);
    }
    this.respondTo(request, result);
  }

  public respondTo(request: CapturedRequest, result: unknown): void {
    this.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result
      })}\n`
    );
  }

  public asChildProcess(): ChildProcessWithoutNullStreams {
    return this as unknown as ChildProcessWithoutNullStreams;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("JsonRpcCoreClient sequential transport", () => {
  it("starts each timeout only when FIFO dispatch reaches that request", async () => {
    vi.useFakeTimers();
    const child = new FakeCoreProcess();
    const client = new JsonRpcCoreClient("madi-core", {
      spawnProcess: () => child.asChildProcess()
    });

    const compile = client.request("compile_publication", { scope: "book" });
    const saveParams = { state: "reader" };
    const save = client.request("save_ui_state", saveParams);
    const load = client.request("load_ui_state", { key: "reader" });
    saveParams.state = "mutated while queued";
    let saveSettled = false;
    void save.then(
      () => {
        saveSettled = true;
      },
      () => {
        saveSettled = true;
      }
    );

    expect(child.requests.map(({ method }) => method)).toEqual([
      "compile_publication"
    ]);

    await vi.advanceTimersByTimeAsync(30_001);

    expect(saveSettled).toBe(false);
    expect(child.requests.map(({ method }) => method)).toEqual([
      "compile_publication"
    ]);

    child.respond(0, { compiled: true });
    await expect(compile).resolves.toEqual({ compiled: true });
    expect(child.requests.map(({ method }) => method)).toEqual([
      "compile_publication",
      "save_ui_state"
    ]);
    expect(child.requests[1]?.params).toEqual({ state: "reader" });

    child.respond(1, { saved: true });
    await expect(save).resolves.toEqual({ saved: true });
    expect(child.requests.map(({ method }) => method)).toEqual([
      "compile_publication",
      "save_ui_state",
      "load_ui_state"
    ]);

    child.respond(2, { state: "reader" });
    await expect(load).resolves.toEqual({ state: "reader" });
    client.dispose();
  });

  it.each(["throw", "callback"] as const)(
    "ignores a stale write %s after a synchronous matching response",
    async (failureMode) => {
      let client!: JsonRpcCoreClient;
      let child!: FakeCoreProcess;
      let queued!: Promise<unknown>;
      child = new FakeCoreProcess((request, callback) => {
        if (request.method === "save_scene") {
          queued = client.request("save_ui_state", { state: "reader" });
          child.respondTo(request, { saved: true });
          if (failureMode === "throw") {
            throw new Error("stale synchronous write failure");
          }
          callback(new Error("stale callback write failure"));
          return;
        }
        callback();
      });
      client = new JsonRpcCoreClient("madi-core", {
        spawnProcess: () => child.asChildProcess()
      });

      const active = client.request("save_scene", { sceneId: "scene-1" });

      await expect(active).resolves.toEqual({ saved: true });
      expect(child.requests.map(({ method }) => method)).toEqual([
        "save_scene",
        "save_ui_state"
      ]);
      expect(child.kill).not.toHaveBeenCalled();

      child.respond(1, { saved: true });
      await expect(queued).resolves.toEqual({ saved: true });
      client.dispose();
    }
  );

  it("fails active and queued work on a synchronous write throw", async () => {
    let client!: JsonRpcCoreClient;
    let queued!: Promise<unknown>;
    const child = new FakeCoreProcess((request, callback) => {
      if (request.method === "save_scene") {
        queued = client.request("save_ui_state", { state: "reader" });
        throw new Error("synchronous write failure");
      }
      callback();
    });
    client = new JsonRpcCoreClient("madi-core", {
      spawnProcess: () => child.asChildProcess()
    });

    const active = client.request("save_scene", { sceneId: "scene-1" });

    await expect(active).rejects.toThrow(
      "Core command save_scene could not be sent"
    );
    await expect(queued).rejects.toThrow(
      "Core command save_scene could not be sent"
    );
    expect(child.requests.map(({ method }) => method)).toEqual(["save_scene"]);
    expect(child.stdin.destroy).toHaveBeenCalledOnce();
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("rejects a synchronous spawn-failure batch and respawns later", async () => {
    let client!: JsonRpcCoreClient;
    let queued!: Promise<unknown>;
    const child = new FakeCoreProcess();
    let failFirstSpawn = true;
    const spawnProcess = vi.fn(() => {
      if (failFirstSpawn) {
        failFirstSpawn = false;
        queued = client.request("save_ui_state", { state: "reader" });
        throw new Error("synchronous spawn failure");
      }
      return child.asChildProcess();
    });
    client = new JsonRpcCoreClient("madi-core", { spawnProcess });

    const active = client.request("save_scene", { sceneId: "scene-1" });

    await expect(active).rejects.toThrow(
      "The local madi core could not be started"
    );
    await expect(queued).rejects.toThrow(
      "The local madi core could not be started"
    );

    const recovered = client.request("load_ui_state", { key: "reader" });
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    child.respond(0, { state: "reader" });
    await expect(recovered).resolves.toEqual({ state: "reader" });
    client.dispose();
  });

  it("rejects both the active request and queued work when disposed", async () => {
    const child = new FakeCoreProcess();
    const client = new JsonRpcCoreClient("madi-core", {
      spawnProcess: () => child.asChildProcess()
    });
    const active = client.request("save_scene", { sceneId: "scene-1" });
    const queued = client.request("save_ui_state", { state: "reader" });
    const activeRejection = expect(active).rejects.toThrow(
      "The local core was stopped"
    );
    const queuedRejection = expect(queued).rejects.toThrow(
      "The local core was stopped"
    );

    client.dispose();

    await activeRejection;
    await queuedRejection;
    expect(child.requests.map(({ method }) => method)).toEqual(["save_scene"]);
    expect(child.kill).toHaveBeenCalledOnce();
    await expect(
      client.request("load_ui_state", { key: "reader" })
    ).rejects.toThrow("The local core is not available");
  });

  it("fails the queue and replaces a timed-out sidecar before later work", async () => {
    vi.useFakeTimers();
    const firstChild = new FakeCoreProcess();
    const secondChild = new FakeCoreProcess();
    const children = [firstChild, secondChild];
    const spawnProcess = vi.fn(() => {
      const child = children.shift();
      if (!child) {
        throw new Error("Unexpected extra sidecar spawn");
      }
      return child.asChildProcess();
    });
    const client = new JsonRpcCoreClient("madi-core", {
      spawnProcess,
      requestTimeoutMs: () => 25
    });
    const active = client.request("save_scene", { sceneId: "scene-1" });
    const queued = client.request("save_ui_state", { state: "reader" });
    const activeRejection = expect(active).rejects.toThrow(
      "Core command save_scene timed out"
    );
    const queuedRejection = expect(queued).rejects.toThrow(
      "Core command save_scene timed out"
    );

    await vi.advanceTimersByTimeAsync(25);

    await activeRejection;
    await queuedRejection;
    expect(firstChild.requests.map(({ method }) => method)).toEqual([
      "save_scene"
    ]);
    expect(firstChild.kill).toHaveBeenCalledOnce();

    const recovered = client.request("load_ui_state", { key: "reader" });
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(secondChild.requests.map(({ method }) => method)).toEqual([
      "load_ui_state"
    ]);

    firstChild.stdout.emit("data", Buffer.from("stale invalid JSON\n"));
    firstChild.emit("error", new Error("stale process error"));
    firstChild.emit("exit", 1, null);
    secondChild.respond(0, { state: "reader" });
    await expect(recovered).resolves.toEqual({ state: "reader" });
    client.dispose();
  });
});
