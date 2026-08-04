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
  "load_ui_state",
  "list_descendant_scenes",
  "search_project",
  "get_text_statistics",
  "apply_replacement_batch",
  "create_named_snapshot",
  "list_named_snapshots",
  "rename_named_snapshot",
  "delete_named_snapshot",
  "diff_named_snapshot",
  "restore_named_snapshot",
  "list_entities",
  "search_entities",
  "create_entity",
  "update_entity",
  "get_entity_delete_impact",
  "delete_entity",
  "load_entity_note",
  "save_entity_note",
  "list_entity_aliases",
  "create_entity_alias",
  "delete_entity_alias",
  "list_tags",
  "create_tag",
  "update_tag",
  "delete_tag",
  "list_entity_tags",
  "set_entity_tags",
  "list_relation_types",
  "create_relation_type",
  "update_relation_type",
  "delete_relation_type",
  "list_entity_relations",
  "create_entity_relation",
  "update_entity_relation",
  "delete_entity_relation",
  "list_scene_entity_links",
  "create_scene_entity_link",
  "delete_scene_entity_link",
  "discover_entity_mentions",
  "promote_entity_mention",
  "get_world_graph",
  "get_world_graph_stats",
  "get_entity_graph_detail",
  "get_entity_scene_context",
  "list_canvases",
  "create_canvas",
  "update_canvas",
  "duplicate_canvas",
  "delete_canvas",
  "load_canvas",
  "save_canvas",
  "compile_publication",
  "get_publication_stats",
  "validate_publication",
  "list_reader_presets",
  "create_reader_preset",
  "update_reader_preset",
  "duplicate_reader_preset",
  "delete_reader_preset",
  "get_publication_export_state",
  "update_publication_metadata",
  "set_publication_cover",
  "remove_publication_cover",
  "list_export_presets",
  "create_export_preset",
  "update_export_preset",
  "duplicate_export_preset",
  "delete_export_preset"
] as const;

export type CoreMethod = (typeof CORE_METHODS)[number];

export interface CoreClient {
  request(
    method: CoreMethod,
    params: Readonly<Record<string, unknown>>
  ): Promise<unknown>;
  dispose(): void;
}

interface QueuedRequest {
  readonly id: number;
  readonly method: CoreMethod;
  readonly payload: string;
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
}

interface ActiveRequest extends QueuedRequest {
  readonly timeout: NodeJS.Timeout;
}

interface JsonRpcCoreClientOptions {
  readonly spawnProcess?: (
    binaryPath: string
  ) => ChildProcessWithoutNullStreams;
  readonly requestTimeoutMs?: (method: CoreMethod) => number;
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
const PUBLICATION_RPC_TIMEOUT_MS = 5 * 60_000;
const PUBLICATION_RPC_METHODS = new Set<CoreMethod>([
  "compile_publication",
  "get_publication_stats",
  "validate_publication"
]);

export function coreRequestTimeoutMs(method: CoreMethod): number {
  return PUBLICATION_RPC_METHODS.has(method)
    ? PUBLICATION_RPC_TIMEOUT_MS
    : RPC_TIMEOUT_MS;
}

function spawnCoreProcess(
  binaryPath: string
): ChildProcessWithoutNullStreams {
  return spawn(binaryPath, ["serve"], {
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });
}

export function resolveCoreBinary({
  appPath,
  resourcesPath,
  isPackaged,
  platform = process.platform,
  environment = process.env
}: ResolveCoreBinaryOptions): string {
  const executable = platform === "win32" ? "madi-core.exe" : "madi-core";
  const packagedCandidate = path.join(resourcesPath, "bin", executable);

  if (isPackaged) {
    return packagedCandidate;
  }

  const override = environment.MADI_CORE_BIN?.trim();
  if (override) {
    return path.resolve(override);
  }

  return path.resolve(
    appPath,
    "..",
    "..",
    "crates",
    "madi-core",
    "target",
    "debug",
    executable
  );
}

export class JsonRpcCoreClient implements CoreClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private stdoutBuffer = Buffer.alloc(0);
  private readonly queue: QueuedRequest[] = [];
  private activeRequest: ActiveRequest | undefined;
  private dispatching = false;
  private disposed = false;

  public constructor(
    private readonly binaryPath: string,
    private readonly options: JsonRpcCoreClientOptions = {}
  ) {}

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
    let payload: string;
    try {
      payload = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params
      });
    } catch {
      return Promise.reject(
        new Error(`Core command ${method} could not be encoded`)
      );
    }

    return new Promise<unknown>((resolve, reject) => {
      this.queue.push({ id, method, payload, resolve, reject });
      this.dispatchNext();
    });
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.rejectAll(new Error("The local core was stopped"));
    this.stopChild(this.child);
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child) {
      return this.child;
    }

    const child = (this.options.spawnProcess ?? spawnCoreProcess)(
      this.binaryPath
    );
    this.stdoutBuffer = Buffer.alloc(0);
    this.child = child;

    child.stdout.on("data", (chunk: Buffer) => {
      if (this.child === child) {
        this.consumeStdout(chunk);
      }
    });

    // Always drain stderr so a noisy child cannot deadlock. It is deliberately
    // not logged because sidecar diagnostics must never leak manuscript text.
    child.stderr.on("data", () => undefined);

    child.on("error", () => {
      if (this.child === child) {
        this.failTransport(
          new Error("The local madi core could not be started"),
          child
        );
      }
    });

    child.on("exit", () => {
      if (this.child === child) {
        this.failTransport(
          new Error("The local madi core stopped unexpectedly"),
          child
        );
      }
    });

    return child;
  }

  private dispatchNext(): void {
    if (
      this.disposed ||
      this.activeRequest ||
      this.dispatching ||
      this.queue.length === 0
    ) {
      return;
    }

    const request = this.queue.shift();
    if (!request) {
      return;
    }

    this.dispatching = true;
    try {
      this.dispatchRequest(request);
    } finally {
      this.dispatching = false;
    }

    if (!this.activeRequest) {
      this.dispatchNext();
    }
  }

  private dispatchRequest(request: QueuedRequest): void {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.ensureChild();
    } catch {
      request.reject(new Error("The local madi core could not be started"));
      this.rejectQueued(
        new Error("The local madi core could not be started")
      );
      this.stopChild(this.child);
      return;
    }

    const timeout = setTimeout(() => {
      if (this.activeRequest?.id !== request.id) {
        return;
      }
      this.failTransport(
        new Error(`Core command ${request.method} timed out`),
        child
      );
    }, (this.options.requestTimeoutMs ?? coreRequestTimeoutMs)(request.method));

    this.activeRequest = { ...request, timeout };

    try {
      child.stdin.write(`${request.payload}\n`, "utf8", (error) => {
        if (!error || this.activeRequest?.id !== request.id) {
          return;
        }
        this.failTransport(
          new Error(`Core command ${request.method} could not be sent`),
          child
        );
      });
    } catch {
      if (this.activeRequest?.id === request.id) {
        this.failTransport(
          new Error(`Core command ${request.method} could not be sent`),
          child
        );
      }
    }
  }

  private consumeStdout(chunk: Buffer): void {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
    if (this.stdoutBuffer.byteLength > MAX_RPC_LINE_BYTES) {
      this.failTransport(
        new Error("The local core returned an oversized response"),
        this.child
      );
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
      this.failTransport(
        new Error("The local core returned invalid JSON"),
        this.child
      );
      return;
    }

    if (
      response.jsonrpc !== "2.0" ||
      !Number.isSafeInteger(response.id)
    ) {
      this.failTransport(
        new Error("The local core returned an invalid response"),
        this.child
      );
      return;
    }

    const pending = this.activeRequest;
    if (!pending || pending.id !== response.id) {
      this.failTransport(
        new Error("The local core returned an unexpected response"),
        this.child
      );
      return;
    }

    clearTimeout(pending.timeout);
    this.activeRequest = undefined;

    if (response.error) {
      const code =
        typeof response.error.code === "number" &&
        Number.isSafeInteger(response.error.code)
        ? ` (${response.error.code})`
        : "";
      pending.reject(
        new Error(`Core command ${pending.method} failed${code}`)
      );
    } else {
      pending.resolve(response.result);
    }

    this.dispatchNext();
  }

  private rejectAll(error: Error): void {
    if (this.activeRequest) {
      clearTimeout(this.activeRequest.timeout);
      this.activeRequest.reject(error);
      this.activeRequest = undefined;
    }
    this.rejectQueued(error);
  }

  private rejectQueued(error: Error): void {
    for (const request of this.queue.splice(0)) {
      request.reject(error);
    }
  }

  private failTransport(
    error: Error,
    child: ChildProcessWithoutNullStreams | undefined
  ): void {
    this.rejectAll(error);
    this.stopChild(child);
  }

  private stopChild(
    child: ChildProcessWithoutNullStreams | undefined
  ): void {
    if (!child) {
      return;
    }
    if (this.child === child) {
      this.child = undefined;
      this.stdoutBuffer = Buffer.alloc(0);
    }
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    child.kill();
    child.unref();
  }
}
