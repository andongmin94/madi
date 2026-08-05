import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

const MAXIMUM_STDOUT_BYTES = 1024 * 1024;
const MAXIMUM_LINE_BYTES = 256 * 1024;
const PROBE_TIMEOUT_MS = 10_000;
const CONVERT_TIMEOUT_MS = 300_000;
const REOPEN_TIMEOUT_MS = 120_000;
const PROCESS_TIMEOUT_GRACE_MS = 2_000;
const PROCESS_CLOSE_TIMEOUT_MS = 15_000;
const PROCESS_FORCE_CLOSE_TIMEOUT_MS = 5_000;

type BridgeCommand = "probe" | "convert" | "reopen-verify";

export interface ResolveHwpBridgeBinaryOptions {
  readonly appPath: string;
  readonly resourcesPath: string;
  readonly isPackaged: boolean;
  readonly platform?: NodeJS.Platform;
  readonly environment?: NodeJS.ProcessEnv;
}

export interface HwpBridgeProbeResult {
  readonly available: boolean;
  readonly availabilityCode: string;
  readonly hancomVersion: string | null;
}

export interface HwpBridgeConversionResult {
  readonly outputPath: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly hancomVersion: string | null;
}

export interface HwpBridgeReopenResult {
  readonly verified: true;
  readonly hancomVersion: string | null;
}

export interface HwpBridgePort {
  probe(): Promise<HwpBridgeProbeResult>;
  convert(
    operationId: string,
    inputHwpx: string,
    outputHwp: string
  ): Promise<HwpBridgeConversionResult>;
  reopen(
    operationId: string,
    inputHwp: string
  ): Promise<HwpBridgeReopenResult>;
  cancel(operationId: string): Promise<boolean>;
  dispose(): Promise<void>;
}

export class HwpBridgeOperationError extends Error {
  public constructor(public readonly code: string) {
    super("The local HWP bridge could not complete the operation");
    this.name = "HwpBridgeOperationError";
  }
}

export class HwpBridgeCancelledError extends Error {
  public constructor() {
    super("The local HWP bridge operation was cancelled");
    this.name = "HwpBridgeCancelledError";
  }
}

interface ActiveBridgeProcess {
  readonly operationId: string;
  readonly requestId: string;
  readonly command: BridgeCommand;
  readonly child: ChildProcessWithoutNullStreams;
  readonly timeout: NodeJS.Timeout;
  readonly closed: Promise<void>;
  readonly resolveClosed: () => void;
  readonly cancelAcknowledged: Promise<boolean>;
  readonly resolveCancelAcknowledged: (cancelled: boolean) => void;
  cancelRequestId: string | null;
  forceKillTimeout: NodeJS.Timeout | null;
  closedFlag: boolean;
  cancellationRequested: boolean;
  terminalError: Error | null;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function exact(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void {
  const keys = Object.keys(value);
  if (
    keys.length !== expected.length ||
    expected.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    throw new Error(`Invalid ${label}`);
  }
}

function exactWithOptionalVersion(
  value: Record<string, unknown>,
  required: readonly string[],
  label: string
): void {
  const keys = Object.keys(value);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    keys.some((key) => !required.includes(key) && key !== "hancomVersion") ||
    keys.length !== required.length + ("hancomVersion" in value ? 1 : 0)
  ) {
    throw new Error(`Invalid ${label}`);
  }
}

function text(value: unknown, label: string, maximumLength: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function optionalVersion(value: Record<string, unknown>): string | null {
  return "hancomVersion" in value
    ? text(value.hancomVersion, "Hancom version", 256)
    : null;
}

function nonNegativeInteger(
  value: unknown,
  label: string,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > maximum
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value as number;
}

function sha256(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error("Invalid HWP bridge SHA-256");
  }
  return value;
}

function requestId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(value)) {
    throw new Error("Invalid HWP bridge operation id");
  }
  return value;
}

function absoluteDocumentPath(
  value: string,
  extension: ".hwpx" | ".hwp",
  label: string
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 32_000 ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    !path.isAbsolute(value) ||
    path.extname(value).toLocaleLowerCase() !== extension
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return path.resolve(value);
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.normalize(path.resolve(left));
  const normalizedRight = path.normalize(path.resolve(right));
  return process.platform === "win32"
    ? normalizedLeft.toLocaleLowerCase() === normalizedRight.toLocaleLowerCase()
    : normalizedLeft === normalizedRight;
}

function parseError(
  response: Record<string, unknown>,
  request: { readonly requestId: string; readonly command: string }
): Error {
  exact(
    response,
    ["requestId", "command", "status", "errorCode", "message"],
    "HWP bridge error"
  );
  if (
    response.requestId !== request.requestId ||
    response.command !== request.command ||
    response.status !== "ERROR"
  ) {
    throw new Error("Invalid HWP bridge error identity");
  }
  const code = text(response.errorCode, "HWP bridge error code", 128);
  text(response.message, "HWP bridge error message", 2_000);
  return code === "CANCELLED"
    ? new HwpBridgeCancelledError()
    : new HwpBridgeOperationError(code);
}

function parseProbe(
  value: unknown,
  expectedRequestId: string
): HwpBridgeProbeResult {
  const response = record(value, "HWP bridge probe response");
  if (response.status === "ERROR") {
    throw parseError(response, { requestId: expectedRequestId, command: "probe" });
  }
  exactWithOptionalVersion(
    response,
    ["requestId", "command", "status", "available", "availabilityCode"],
    "HWP bridge probe response"
  );
  if (
    response.requestId !== expectedRequestId ||
    response.command !== "probe" ||
    response.status !== "SUCCESS" ||
    typeof response.available !== "boolean"
  ) {
    throw new Error("Invalid HWP bridge probe response");
  }
  const availabilityCode = text(
    response.availabilityCode,
    "HWP bridge availability code",
    128
  );
  if (
    (response.available && availabilityCode !== "AVAILABLE") ||
    (!response.available && availabilityCode === "AVAILABLE")
  ) {
    throw new Error("Invalid HWP bridge availability response");
  }
  return {
    available: response.available,
    availabilityCode,
    hancomVersion: optionalVersion(response)
  };
}

function parseConversion(
  value: unknown,
  expectedRequestId: string,
  expectedOutputPath: string
): HwpBridgeConversionResult {
  const response = record(value, "HWP bridge conversion response");
  if (response.status === "ERROR") {
    throw parseError(response, { requestId: expectedRequestId, command: "convert" });
  }
  exactWithOptionalVersion(
    response,
    ["requestId", "command", "status", "outputPath", "byteLength", "sha256"],
    "HWP bridge conversion response"
  );
  const outputPath = absoluteDocumentPath(
    text(response.outputPath, "HWP bridge output path", 32_000),
    ".hwp",
    "HWP bridge output path"
  );
  if (
    response.requestId !== expectedRequestId ||
    response.command !== "convert" ||
    response.status !== "SUCCESS" ||
    !samePath(outputPath, expectedOutputPath)
  ) {
    throw new Error("Invalid HWP bridge conversion response");
  }
  return {
    outputPath,
    byteLength: nonNegativeInteger(
      response.byteLength,
      "HWP bridge byte length",
      512 * 1024 * 1024
    ),
    sha256: sha256(response.sha256),
    hancomVersion: optionalVersion(response)
  };
}

function parseReopen(
  value: unknown,
  expectedRequestId: string
): HwpBridgeReopenResult {
  const response = record(value, "HWP bridge reopen response");
  if (response.status === "ERROR") {
    throw parseError(response, {
      requestId: expectedRequestId,
      command: "reopen-verify"
    });
  }
  exactWithOptionalVersion(
    response,
    ["requestId", "command", "status", "verified"],
    "HWP bridge reopen response"
  );
  if (
    response.requestId !== expectedRequestId ||
    response.command !== "reopen-verify" ||
    response.status !== "SUCCESS" ||
    response.verified !== true
  ) {
    throw new Error("Invalid HWP bridge reopen response");
  }
  return { verified: true, hancomVersion: optionalVersion(response) };
}

export function resolveHwpBridgeBinary({
  appPath,
  resourcesPath,
  isPackaged,
  platform = process.platform,
  environment = process.env
}: ResolveHwpBridgeBinaryOptions): string {
  const executable = platform === "win32" ? "madi-hwp-bridge.exe" : "madi-hwp-bridge";
  if (isPackaged) {
    return path.join(resourcesPath, "bin", "hwp-bridge", executable);
  }
  const override = environment.MADI_HWP_BRIDGE_BIN?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.resolve(
    appPath,
    "..",
    "..",
    "sidecars",
    "hwp-bridge",
    "bin",
    "Debug",
    "net10.0-windows",
    "win-x86",
    executable
  );
}

export class ProcessHwpBridge implements HwpBridgePort {
  private readonly active = new Map<string, ActiveBridgeProcess>();
  private disposed = false;

  public constructor(private readonly binaryPath: string) {}

  private terminate(active: ActiveBridgeProcess, error: Error): void {
    if (active.closedFlag) {
      return;
    }
    active.terminalError ??= error;
    clearTimeout(active.timeout);
    try {
      active.child.kill();
    } catch {
      // The bounded close watchdog remains authoritative.
    }
    active.forceKillTimeout ??= setTimeout(() => {
      if (!active.closedFlag) {
        try {
          active.child.kill("SIGKILL");
        } catch {
          // The close bound below reports a child that cannot be stopped.
        }
      }
    }, PROCESS_CLOSE_TIMEOUT_MS);
  }

  private async waitForClosed(active: ActiveBridgeProcess): Promise<void> {
    const bounded = (timeoutMs: number): Promise<void> =>
      new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("The local HWP bridge did not stop")),
          timeoutMs
        );
        void active.closed.then(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
    try {
      await bounded(PROCESS_CLOSE_TIMEOUT_MS);
    } catch {
      active.child.kill("SIGKILL");
      await bounded(PROCESS_FORCE_CLOSE_TIMEOUT_MS);
    }
  }

  private run<T>(
    operationIdValue: string,
    command: BridgeCommand,
    request: Readonly<Record<string, unknown>>,
    timeoutMs: number,
    parse: (value: unknown) => T
  ): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new Error("The local HWP bridge is not available"));
    }
    const operationId = requestId(operationIdValue);
    if (this.active.has(operationId)) {
      return Promise.reject(new Error("The HWP bridge operation is already running"));
    }
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.binaryPath, [], {
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch {
      return Promise.reject(new HwpBridgeOperationError("START_FAILED"));
    }
    return new Promise<T>((resolve, reject) => {
      let resolveClosed!: () => void;
      const closed = new Promise<void>((closedResolve) => {
        resolveClosed = closedResolve;
      });
      let resolveCancelAcknowledged!: (cancelled: boolean) => void;
      const cancelAcknowledged = new Promise<boolean>((acknowledgedResolve) => {
        resolveCancelAcknowledged = acknowledgedResolve;
      });
      const timeout = setTimeout(() => {
        const current = this.active.get(operationId);
        if (current) {
          this.terminate(
            current,
            new HwpBridgeOperationError("PROCESS_TIMEOUT")
          );
        }
      }, timeoutMs + PROCESS_TIMEOUT_GRACE_MS);
      const active: ActiveBridgeProcess = {
        operationId,
        requestId: requestId(text(request.requestId, "HWP bridge request id", 64)),
        command,
        child,
        timeout,
        closed,
        resolveClosed,
        cancelAcknowledged,
        resolveCancelAcknowledged,
        cancelRequestId: null,
        forceKillTimeout: null,
        closedFlag: false,
        cancellationRequested: false,
        terminalError: null
      };
      this.active.set(operationId, active);
      let stdout = Buffer.alloc(0);
      let stdoutBytes = 0;
      let result: T | null = null;
      let terminalReceived = false;
      const fail = (error: Error): void => this.terminate(active, error);
      const parseLine = (line: Buffer): void => {
        if (line.byteLength === 0 || active.closedFlag || active.terminalError) {
          return;
        }
        if (line.byteLength > MAXIMUM_LINE_BYTES) {
          fail(new HwpBridgeOperationError("RESPONSE_TOO_LARGE"));
          return;
        }
        try {
          const message = record(
            JSON.parse(line.toString("utf8")) as unknown,
            "HWP bridge message"
          );
          if (message.command === "cancel") {
            exact(
              message,
              ["requestId", "command", "status", "cancelled"],
              "HWP bridge cancellation response"
            );
            if (
              active.cancelRequestId === null ||
              message.requestId !== active.cancelRequestId ||
              message.status !== "SUCCESS" ||
              message.cancelled !== true
            ) {
              throw new Error("Invalid HWP bridge cancellation response");
            }
            active.resolveCancelAcknowledged(true);
            return;
          }
          if (terminalReceived) {
            throw new Error("Duplicate HWP bridge terminal response");
          }
          terminalReceived = true;
          try {
            result = parse(message);
          } catch (error) {
            if (
              error instanceof HwpBridgeOperationError ||
              error instanceof HwpBridgeCancelledError
            ) {
              this.terminate(active, error);
              return;
            }
            throw error;
          }
        } catch (error) {
          fail(new HwpBridgeOperationError("INVALID_RESPONSE"));
        }
      };
      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > MAXIMUM_STDOUT_BYTES) {
          fail(new HwpBridgeOperationError("RESPONSE_TOO_LARGE"));
          return;
        }
        stdout = Buffer.concat([stdout, chunk]);
        let newline = stdout.indexOf(0x0a);
        while (newline >= 0 && !active.terminalError) {
          parseLine(stdout.subarray(0, newline));
          stdout = stdout.subarray(newline + 1);
          newline = stdout.indexOf(0x0a);
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (chunk.byteLength > 0) {
          // Never retain or surface bridge diagnostics because the child has
          // access to manuscript paths and content. Typed stdout is the only
          // accepted protocol channel.
          fail(new HwpBridgeOperationError("DIAGNOSTIC_OUTPUT"));
        }
      });
      child.stdin.on("error", () => {
        if (!terminalReceived) {
          fail(new HwpBridgeOperationError("INPUT_STREAM_FAILED"));
        }
      });
      child.on("error", () =>
        fail(new HwpBridgeOperationError("START_FAILED"))
      );
      child.on("close", (code) => {
        try {
          clearTimeout(timeout);
          if (active.forceKillTimeout) {
            clearTimeout(active.forceKillTimeout);
          }
          if (!active.terminalError && stdout.byteLength > 0) {
            parseLine(stdout);
          }
          const terminal =
            active.terminalError ??
            (active.cancellationRequested
              ? new HwpBridgeCancelledError()
              : code !== 0 || !terminalReceived || result === null
                ? new HwpBridgeOperationError("PROCESS_EXIT")
                : null);
          if (terminal) {
            reject(terminal);
          } else {
            resolve(result!);
          }
        } catch {
          reject(new HwpBridgeOperationError("PROCESS_SHUTDOWN_FAILED"));
        } finally {
          active.closedFlag = true;
          if (this.active.get(operationId) === active) {
            this.active.delete(operationId);
          }
          active.resolveClosed();
        }
      });
      try {
        child.stdin.write(
          `${JSON.stringify(request)}\n`,
          "utf8",
          (error) => {
            if (
              !error ||
              active.closedFlag ||
              this.active.get(operationId) !== active ||
              terminalReceived
            ) {
              return;
            }
            fail(new HwpBridgeOperationError("INPUT_WRITE_FAILED"));
          }
        );
      } catch {
        if (
          !active.closedFlag &&
          this.active.get(operationId) === active &&
          !terminalReceived
        ) {
          fail(new HwpBridgeOperationError("INPUT_WRITE_FAILED"));
        }
      }
    });
  }

  public probe(): Promise<HwpBridgeProbeResult> {
    const operationId = `probe-${randomUUID()}`;
    return this.run(
      operationId,
      "probe",
      { requestId: operationId, command: "probe", timeoutMs: PROBE_TIMEOUT_MS },
      PROBE_TIMEOUT_MS,
      (response) => parseProbe(response, operationId)
    );
  }

  public convert(
    operationIdValue: string,
    inputHwpxValue: string,
    outputHwpValue: string
  ): Promise<HwpBridgeConversionResult> {
    const operationId = requestId(operationIdValue);
    const inputHwpx = absoluteDocumentPath(
      inputHwpxValue,
      ".hwpx",
      "HWP bridge input path"
    );
    const outputHwp = absoluteDocumentPath(
      outputHwpValue,
      ".hwp",
      "HWP bridge output path"
    );
    return this.run(
      operationId,
      "convert",
      {
        requestId: operationId,
        command: "convert",
        inputHwpx,
        outputHwp,
        overwrite: false,
        timeoutMs: CONVERT_TIMEOUT_MS
      },
      CONVERT_TIMEOUT_MS,
      (response) => parseConversion(response, operationId, outputHwp)
    );
  }

  public reopen(
    operationIdValue: string,
    inputHwpValue: string
  ): Promise<HwpBridgeReopenResult> {
    const operationId = requestId(operationIdValue);
    const inputHwp = absoluteDocumentPath(
      inputHwpValue,
      ".hwp",
      "HWP bridge reopen path"
    );
    return this.run(
      operationId,
      "reopen-verify",
      {
        requestId: operationId,
        command: "reopen-verify",
        inputHwp,
        timeoutMs: REOPEN_TIMEOUT_MS
      },
      REOPEN_TIMEOUT_MS,
      (response) => parseReopen(response, operationId)
    );
  }

  public async cancel(operationIdValue: string): Promise<boolean> {
    const operationId = requestId(operationIdValue);
    const active = this.active.get(operationId);
    if (!active || active.closedFlag || active.command === "probe") {
      return false;
    }
    if (active.cancellationRequested) {
      await this.waitForClosed(active);
      return true;
    }
    active.cancellationRequested = true;
    active.cancelRequestId = `cancel-${randomUUID()}`;
    const cancelRequestId = active.cancelRequestId;
    try {
      active.child.stdin.write(
        `${JSON.stringify({
          requestId: cancelRequestId,
          command: "cancel",
          targetRequestId: active.requestId
        })}\n`,
        "utf8",
        (error) => {
          if (
            !error ||
            active.closedFlag ||
            this.active.get(operationId) !== active ||
            active.cancelRequestId !== cancelRequestId
          ) {
            return;
          }
          this.terminate(active, new HwpBridgeCancelledError());
        }
      );
    } catch {
      if (
        !active.closedFlag &&
        this.active.get(operationId) === active &&
        active.cancelRequestId === cancelRequestId
      ) {
        this.terminate(active, new HwpBridgeCancelledError());
      }
    }
    let acknowledgementTimeout: NodeJS.Timeout | null = null;
    try {
      await Promise.race([
        active.cancelAcknowledged,
        active.closed.then(() => false),
        new Promise<never>((_resolve, reject) => {
          acknowledgementTimeout = setTimeout(
            () => reject(new Error("The local HWP bridge did not acknowledge cancellation")),
            PROCESS_TIMEOUT_GRACE_MS
          );
        })
      ]);
    } catch {
      this.terminate(active, new HwpBridgeCancelledError());
    } finally {
      if (acknowledgementTimeout) {
        clearTimeout(acknowledgementTimeout);
      }
    }
    await this.waitForClosed(active);
    return true;
  }

  public async dispose(): Promise<void> {
    if (this.disposed && this.active.size === 0) {
      return;
    }
    this.disposed = true;
    const results = await Promise.allSettled(
      [...this.active.values()].map(async (active) => {
        this.terminate(
          active,
          new HwpBridgeOperationError("BRIDGE_DISPOSED")
        );
        await this.waitForClosed(active);
      })
    );
    if (
      this.active.size > 0 ||
      results.some((result) => result.status === "rejected")
    ) {
      throw new Error("The local HWP bridge did not shut down cleanly");
    }
  }
}
