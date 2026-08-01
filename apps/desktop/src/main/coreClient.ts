import { existsSync } from "node:fs";
import path from "node:path";
import {
  spawn,
  type ChildProcessWithoutNullStreams
} from "node:child_process";

export const CORE_METHODS = [
  "create_project",
  "open_project",
  "save_document",
  "load_document",
  "inspect_project",
  "recover_plain_text",
  "load_project_tree",
  "create_tree_node",
  "rename_tree_node",
  "move_tree_node",
  "reorder_tree_node",
  "delete_tree_node",
  "load_scene",
  "save_scene",
  "save_ui_state",
  "load_ui_state"
] as const;

export type CoreMethod = (typeof CORE_METHODS)[number];

export interface CoreClient {
  request(
    method: CoreMethod,
    params: Readonly<Record<string, unknown>>
  ): Promise<unknown>;
  dispose(): void;
}

interface PendingRequest {
  readonly method: CoreMethod;
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: NodeJS.Timeout;
}

interface RpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: number;
  readonly result?: unknown;
  readonly error?: {
    readonly code?: number;
  };
}

export interface ResolveCoreBinaryOptions {
  readonly appPath: string;
  readonly resourcesPath: string;
  readonly isPackaged: boolean;
  readonly platform?: NodeJS.Platform;
  readonly environment?: NodeJS.ProcessEnv;
}

const MAX_RPC_LINE_BYTES = 128 * 1024 * 1024;
const RPC_TIMEOUT_MS = 30_000;

export function resolveCoreBinary({
  appPath,
  resourcesPath,
  isPackaged,
  platform = process.platform,
  environment = process.env
}: ResolveCoreBinaryOptions): string {
  const override = environment.MADI_CORE_BIN?.trim();
  if (override) {
    return path.resolve(override);
  }

  const executable = platform === "win32" ? "madi-core.exe" : "madi-core";
  const packagedCandidate = path.join(resourcesPath, "bin", executable);

  if (isPackaged) {
    return packagedCandidate;
  }

  const candidates = [
    path.resolve(appPath, "..", "..", "target", "debug", executable),
    path.resolve(
      appPath,
      "..",
      "..",
      "crates",
      "madi-core",
      "target",
      "debug",
      executable
    ),
    path.resolve(
      appPath,
      "..",
      "..",
      "core",
      "target",
      "debug",
      executable
    ),
    packagedCandidate
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

export class JsonRpcCoreClient implements CoreClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private stdoutBuffer = Buffer.alloc(0);
  private readonly pending = new Map<number, PendingRequest>();
  private disposed = false;

  public constructor(private readonly binaryPath: string) {}

  public request(
    method: CoreMethod,
    params: Readonly<Record<string, unknown>>
  ): Promise<unknown> {
    if (!CORE_METHODS.includes(method)) {
      return Promise.reject(new Error("Unsupported core command"));
    }
    if (this.disposed) {
      return Promise.reject(new Error("The local core is not available"));
    }

    const id = this.nextId++;
    const child = this.ensureChild();

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Core command ${method} timed out`));
      }, RPC_TIMEOUT_MS);

      this.pending.set(id, { method, resolve, reject, timeout });

      const payload = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params
      });

      child.stdin.write(`${payload}\n`, "utf8", (error) => {
        if (!error) {
          return;
        }
        const pending = this.pending.get(id);
        if (!pending) {
          return;
        }
        clearTimeout(pending.timeout);
        this.pending.delete(id);
        pending.reject(new Error(`Core command ${method} could not be sent`));
      });
    });
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.rejectAll(new Error("The local core was stopped"));

    if (this.child) {
      const child = this.child;
      this.child = undefined;
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      child.kill();
      child.unref();
    }
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child) {
      return this.child;
    }

    const child = spawn(this.binaryPath, ["serve"], {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    child.stdout.on("data", (chunk: Buffer) => {
      this.consumeStdout(chunk);
    });

    // Always drain stderr so a noisy child cannot deadlock. It is deliberately
    // not logged because sidecar diagnostics must never leak manuscript text.
    child.stderr.on("data", () => undefined);

    child.on("error", () => {
      this.rejectAll(new Error("The local madi core could not be started"));
      this.child = undefined;
    });

    child.on("exit", () => {
      this.rejectAll(new Error("The local madi core stopped unexpectedly"));
      this.child = undefined;
    });

    this.child = child;
    return child;
  }

  private consumeStdout(chunk: Buffer): void {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
    if (this.stdoutBuffer.byteLength > MAX_RPC_LINE_BYTES) {
      this.rejectAll(new Error("The local core returned an oversized response"));
      this.dispose();
      return;
    }

    let newlineIndex = this.stdoutBuffer.indexOf(0x0a);
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.subarray(0, newlineIndex).toString("utf8");
      this.stdoutBuffer = this.stdoutBuffer.subarray(newlineIndex + 1);
      if (line.trim()) {
        this.consumeLine(line);
      }
      newlineIndex = this.stdoutBuffer.indexOf(0x0a);
    }
  }

  private consumeLine(line: string): void {
    let response: RpcResponse;
    try {
      response = JSON.parse(line) as RpcResponse;
    } catch {
      this.rejectAll(new Error("The local core returned invalid JSON"));
      return;
    }

    if (
      response.jsonrpc !== "2.0" ||
      !Number.isSafeInteger(response.id)
    ) {
      this.rejectAll(new Error("The local core returned an invalid response"));
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(response.id);

    if (response.error) {
      const code =
        typeof response.error.code === "number" &&
        Number.isSafeInteger(response.error.code)
        ? ` (${response.error.code})`
        : "";
      pending.reject(
        new Error(`Core command ${pending.method} failed${code}`)
      );
      return;
    }

    pending.resolve(response.result);
  }

  private rejectAll(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
  }
}
