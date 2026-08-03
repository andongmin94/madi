import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const executableName =
  process.platform === "win32" ? "madi-core.exe" : "madi-core";

export const coreBinary =
  process.env.MADI_CORE_BIN?.trim() ||
  resolve(
    repositoryRoot,
    "crates",
    "madi-core",
    "target",
    "debug",
    executableName,
  );

export class CoreRpcError extends Error {
  constructor(method, code, message) {
    super(message);
    this.name = "CoreRpcError";
    this.method = method;
    this.code = code;
  }
}

export class CoreSidecarClient {
  constructor(label, options = {}) {
    if (!existsSync(coreBinary)) {
      throw new Error(`madi-core binary is missing: ${coreBinary}`);
    }
    this.label = label;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 10_000;
    this.child = spawn(coreBinary, ["serve"], {
      cwd: repositoryRoot,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.resume();
    this.buffer = "";
    this.nextId = 0;
    this.pending = new Map();
    this.exited = false;
    this.exitPromise = new Promise((resolveExit) => {
      this.child.once("close", (code) => {
        this.exited = true;
        this.#rejectPending(new Error("madi-core exited with pending RPCs"));
        resolveExit(code);
      });
    });
    this.child.once("error", (error) => this.#rejectPending(error));
    this.child.stdin.on("error", (error) => this.#rejectPending(error));
    this.child.stdout.on("data", (chunk) => this.#acceptOutput(chunk));
  }

  request(method, params) {
    if (this.exited) {
      return Promise.reject(new Error("madi-core request after exit"));
    }
    const id = `${this.label}-${++this.nextId}`;
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new Error(`${method} timed out`));
      }, this.timeoutMs);
      this.pending.set(id, {
        method,
        resolve: resolveRequest,
        reject: rejectRequest,
        timer,
      });
      this.child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
        (error) => {
          if (!error) {
            return;
          }
          const pending = this.pending.get(id);
          if (pending) {
            this.pending.delete(id);
            clearTimeout(pending.timer);
            pending.reject(error);
          }
        },
      );
    });
  }

  async close() {
    if (!this.exited) {
      this.child.stdin.end();
    }
    let timer;
    const code = await Promise.race([
      this.exitPromise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("madi-core shutdown timed out")),
          this.shutdownTimeoutMs,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    if (code !== 0) {
      throw new Error(`madi-core exited with code ${String(code)}`);
    }
    if (this.buffer.trim().length !== 0) {
      throw new Error("madi-core left an incomplete JSON response");
    }
  }

  async forceStop() {
    if (this.exited) {
      return;
    }
    this.child.stdin.end();
    let timer;
    const stopped = await Promise.race([
      this.exitPromise.then(() => true),
      new Promise((resolveStop) => {
        timer = setTimeout(() => resolveStop(false), 1_000);
      }),
    ]).finally(() => clearTimeout(timer));
    if (!stopped && !this.exited) {
      this.child.kill();
      await this.exitPromise;
    }
  }

  #acceptOutput(chunk) {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length > 0) {
        this.#acceptLine(line);
      }
      newline = this.buffer.indexOf("\n");
    }
  }

  #acceptLine(line) {
    let response;
    try {
      response = JSON.parse(line);
    } catch (error) {
      this.#rejectPending(error);
      return;
    }
    const pending = this.pending.get(String(response.id));
    if (!pending) {
      this.#rejectPending(new Error("unmatched JSON-RPC response"));
      return;
    }
    this.pending.delete(String(response.id));
    clearTimeout(pending.timer);
    if (response.error !== undefined) {
      pending.reject(
        new CoreRpcError(
          pending.method,
          response.error?.code,
          String(response.error?.message ?? "madi-core RPC failed"),
        ),
      );
      return;
    }
    if (!("result" in response)) {
      pending.reject(new Error("madi-core response has no result"));
      return;
    }
    pending.resolve(response.result);
  }

  #rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
