import {
  spawn,
  type ChildProcessWithoutNullStreams
} from "node:child_process";
import path from "node:path";

const PROCESS_TIMEOUT_MS = 60_000;
const TERMINATION_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 16 * 1024;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const VOLUME_PATTERN = /^[0-9a-f]{16}$/u;
const FILE_ID_PATTERN = /^[0-9a-f]{32}$/u;

export interface AtomicOutputIdentity {
  readonly byteLength: number;
  readonly sha256: string;
  readonly volumeSerialNumber: string;
  readonly fileId: string;
}

export interface AtomicOutputCommitInput {
  readonly stagedPath: string;
  readonly destinationPath: string;
  readonly backupPath: string;
  readonly rollbackPath: string;
  readonly maximumBytes: number;
  readonly expected: AtomicOutputIdentity;
  readonly stagedIdentity: AtomicOutputIdentity;
}

export type AtomicOutputRecoveryInput = AtomicOutputCommitInput;

export type AtomicOutputRecoveryArtifact = {
  readonly source: "STAGED" | "BACKUP" | "ROLLBACK";
  readonly identity: AtomicOutputIdentity;
};

export type AtomicOutputRecoveryResult =
  | {
      readonly outcome:
        | "COMMIT_COMPLETE"
        | "ROLLED_BACK"
        | "DESTINATION_CHANGED"
        | "NOTHING_TO_DO";
      readonly recoveryArtifact: null;
    }
  | {
      readonly outcome: "RECOVERY_REQUIRED";
      readonly recoveryArtifact: AtomicOutputRecoveryArtifact;
    };

export interface AtomicOutputPort {
  inspect(filePath: string, maximumBytes: number): Promise<AtomicOutputIdentity>;
  commit(input: AtomicOutputCommitInput): Promise<{
    readonly stagedIdentity: AtomicOutputIdentity;
    readonly backupIdentity: AtomicOutputIdentity;
  }>;
  recover(input: AtomicOutputRecoveryInput): Promise<AtomicOutputRecoveryResult>;
  publishRecovery(input: {
    readonly sourcePath: string;
    readonly recoveryPath: string;
    readonly maximumBytes: number;
    readonly expected: AtomicOutputIdentity;
  }): Promise<AtomicOutputIdentity>;
}

export type AtomicOutputErrorCode =
  | "INVALID_REQUEST"
  | "DESTINATION_CHANGED"
  | "RECOVERY_REQUIRED"
  | "UNSUPPORTED"
  | "IO_FAILED";

export class AtomicOutputError extends Error {
  public constructor(
    public readonly code: AtomicOutputErrorCode
  ) {
    super(`The atomic output utility failed: ${code}`);
    this.name = "AtomicOutputError";
  }
}

export interface ResolveAtomicOutputBinaryOptions {
  readonly appPath: string;
  readonly resourcesPath: string;
  readonly isPackaged: boolean;
  readonly platform?: NodeJS.Platform;
  readonly environment?: NodeJS.ProcessEnv;
}

export function resolveAtomicOutputBinary({
  appPath,
  resourcesPath,
  isPackaged,
  platform = process.platform,
  environment = process.env
}: ResolveAtomicOutputBinaryOptions): string {
  const executable = platform === "win32" ? "madi-atomic-output.exe" : "madi-atomic-output";
  if (isPackaged) {
    return path.join(resourcesPath, "bin", executable);
  }
  const override = environment.MADI_ATOMIC_OUTPUT_BIN?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.resolve(
    appPath,
    "..",
    "..",
    "crates",
    "madi-atomic-output",
    "target",
    "debug",
    executable
  );
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The atomic output utility returned invalid JSON");
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error("The atomic output utility returned an invalid response");
  }
}

function identity(value: unknown): AtomicOutputIdentity {
  const parsed = record(value);
  exact(parsed, ["byteLength", "sha256", "volumeSerialNumber", "fileId"]);
  if (
    !Number.isSafeInteger(parsed.byteLength) ||
    (parsed.byteLength as number) < 1 ||
    (parsed.byteLength as number) > 512 * 1024 * 1024 ||
    typeof parsed.sha256 !== "string" ||
    !HASH_PATTERN.test(parsed.sha256) ||
    typeof parsed.volumeSerialNumber !== "string" ||
    !VOLUME_PATTERN.test(parsed.volumeSerialNumber) ||
    typeof parsed.fileId !== "string" ||
    !FILE_ID_PATTERN.test(parsed.fileId)
  ) {
    throw new Error("The atomic output utility returned an invalid identity");
  }
  return parsed as unknown as AtomicOutputIdentity;
}

function parseFailure(value: Record<string, unknown>): never {
  exact(value, ["status", "code"]);
  if (
    ![
      "INVALID_REQUEST",
      "DESTINATION_CHANGED",
      "RECOVERY_REQUIRED",
      "UNSUPPORTED",
      "IO_FAILED"
    ].includes(value.code as string)
  ) {
    throw new Error("The atomic output utility returned an invalid error");
  }
  throw new AtomicOutputError(value.code as AtomicOutputErrorCode);
}

function recoveryArtifact(value: unknown): AtomicOutputRecoveryArtifact {
  const parsed = record(value);
  exact(parsed, ["source", "identity"]);
  if (!["STAGED", "BACKUP", "ROLLBACK"].includes(parsed.source as string)) {
    throw new Error("The atomic output utility returned an invalid recovery artifact");
  }
  return {
    source: parsed.source as AtomicOutputRecoveryArtifact["source"],
    identity: identity(parsed.identity)
  };
}

export class ProcessAtomicOutput implements AtomicOutputPort {
  public constructor(private readonly binaryPath: string) {}

  public async inspect(filePath: string, maximumBytes: number): Promise<AtomicOutputIdentity> {
    const response = await this.request({ mode: "INSPECT", path: filePath, maximumBytes });
    if (response.status === "FAILED") {
      return parseFailure(response);
    }
    exact(response, ["status", "identity"]);
    if (response.status !== "INSPECTED") {
      throw new Error("The atomic output utility returned an invalid inspect result");
    }
    return identity(response.identity);
  }

  public async commit(input: AtomicOutputCommitInput): Promise<{
    readonly stagedIdentity: AtomicOutputIdentity;
    readonly backupIdentity: AtomicOutputIdentity;
  }> {
    const response = await this.request({ mode: "COMMIT", ...input });
    if (response.status === "FAILED") {
      return parseFailure(response);
    }
    exact(response, ["status", "stagedIdentity", "backupIdentity"]);
    if (response.status !== "COMMITTED") {
      throw new Error("The atomic output utility returned an invalid commit result");
    }
    return {
      stagedIdentity: identity(response.stagedIdentity),
      backupIdentity: identity(response.backupIdentity)
    };
  }

  public async recover(input: AtomicOutputRecoveryInput): Promise<AtomicOutputRecoveryResult> {
    const response = await this.request({ mode: "RECOVER", ...input });
    if (response.status === "FAILED") {
      return parseFailure(response);
    }
    exact(response, [
      "status",
      "outcome",
      ...(response.recoveryArtifact === undefined ? [] : ["recoveryArtifact"])
    ]);
    if (
      response.status !== "RECOVERED" ||
      ![
        "COMMIT_COMPLETE",
        "ROLLED_BACK",
        "DESTINATION_CHANGED",
        "NOTHING_TO_DO",
        "RECOVERY_REQUIRED"
      ].includes(response.outcome as string)
    ) {
      throw new Error("The atomic output utility returned an invalid recovery result");
    }
    if (response.outcome === "RECOVERY_REQUIRED") {
      return {
        outcome: "RECOVERY_REQUIRED",
        recoveryArtifact: recoveryArtifact(response.recoveryArtifact)
      };
    }
    if (response.recoveryArtifact !== undefined) {
      throw new Error("The atomic output utility returned an unexpected recovery artifact");
    }
    return {
      outcome: response.outcome as
        | "COMMIT_COMPLETE"
        | "ROLLED_BACK"
        | "DESTINATION_CHANGED"
        | "NOTHING_TO_DO",
      recoveryArtifact: null
    };
  }

  public async publishRecovery(input: {
    readonly sourcePath: string;
    readonly recoveryPath: string;
    readonly maximumBytes: number;
    readonly expected: AtomicOutputIdentity;
  }): Promise<AtomicOutputIdentity> {
    const response = await this.request({ mode: "PUBLISH", ...input });
    if (response.status === "FAILED") {
      return parseFailure(response);
    }
    exact(response, ["status", "identity"]);
    if (response.status !== "PUBLISHED") {
      throw new Error("The atomic output utility returned an invalid publish result");
    }
    return identity(response.identity);
  }

  private request(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(this.binaryPath, [], {
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"]
        });
      } catch (error) {
        reject(
          new Error("The atomic output utility could not start", {
            cause: error
          })
        );
        return;
      }
      const chunks: Buffer[] = [];
      let byteLength = 0;
      let stderrByteLength = 0;
      let responseTooLarge = false;
      let settled = false;
      let pendingFailure: Error | null = null;
      let terminationTimeout: ReturnType<typeof setTimeout> | null = null;
      const settleFailure = (error: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (terminationTimeout) {
          clearTimeout(terminationTimeout);
        }
        reject(error);
      };
      const terminate = (error: Error): void => {
        if (settled || pendingFailure) {
          return;
        }
        pendingFailure = error;
        try {
          child.kill();
        } catch {
          settleFailure(error);
          return;
        }
        terminationTimeout = setTimeout(() => {
          settleFailure(error);
        }, TERMINATION_TIMEOUT_MS);
      };
      const timeout = setTimeout(() => {
        terminate(new Error("The atomic output utility timed out"));
      }, PROCESS_TIMEOUT_MS);
      child.stdout.on("data", (chunk: Buffer) => {
        byteLength += chunk.byteLength;
        if (byteLength > MAX_RESPONSE_BYTES) {
          responseTooLarge = true;
          terminate(new Error("The atomic output utility returned an invalid response"));
          return;
        }
        chunks.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrByteLength += chunk.byteLength;
        terminate(new Error("The atomic output utility returned an invalid response"));
      });
      child.stdin.on("error", (error) => {
        terminate(
          new Error("The atomic output utility rejected its request", {
            cause: error
          })
        );
      });
      child.on("error", (error) => {
        settleFailure(
          new Error("The atomic output utility could not start", { cause: error })
        );
      });
      child.on("close", (code, signal) => {
        if (settled) {
          return;
        }
        clearTimeout(timeout);
        if (terminationTimeout) {
          clearTimeout(terminationTimeout);
        }
        if (pendingFailure) {
          settleFailure(pendingFailure);
          return;
        }
        settled = true;
        if (
          code !== 0 ||
          signal !== null ||
          responseTooLarge ||
          byteLength < 2 ||
          byteLength > MAX_RESPONSE_BYTES ||
          stderrByteLength !== 0
        ) {
          reject(new Error("The atomic output utility returned an invalid response"));
          return;
        }
        try {
          resolve(record(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
        } catch {
          reject(new Error("The atomic output utility returned invalid JSON"));
        }
      });
      try {
        const request = JSON.stringify(input);
        child.stdin.write(request, "utf8", (error) => {
          if (error) {
            terminate(
              new Error("The atomic output utility rejected its request", {
                cause: error
              })
            );
          }
        });
        child.stdin.end();
      } catch (error) {
        terminate(
          new Error("The atomic output utility rejected its request", {
            cause: error
          })
        );
      }
    });
  }
}
