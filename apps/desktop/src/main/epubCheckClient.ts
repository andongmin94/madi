import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { EpubValidationSeverity } from "../shared/epubExport";
import { validateEpubOperationId } from "../shared/epubExportValidation";
import { EpubExportCancelledError } from "./epubExportClient";

export const EPUB_CHECK_BUNDLE_SHA256 =
  "bcabd009a2a10ec70499c1e239bef6c53df9580253cc2a19448d804cbaabcb0c";
const ARCHIVES = [
  { name: "epubcheck-5.3.0.zip", sha256: "6c07e68584b2e2ce2f89fe06e1246dfead3eb36b46b340e7d93524f29dcff6c5" },
  { name: "temurin-jre-21.0.11+10.zip", sha256: "be26677aaa20b39a62edcaab4c8857a8b76673b0f45abc0b6143b142b62717e4" }
] as const;
const JAR_PATH = "epubcheck-5.3.0/epubcheck.jar";
const JAVA_PATH = "jdk-21.0.11+10-jre/bin/java.exe";
const MANIFEST_PATH = "bundle-manifest.json";
const MAX_REPORT_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const CHECK_TIMEOUT_MS = 120_000;
const CLOSE_TIMEOUT_MS = 15_000;
const FORCE_KILL_DELAY_MS = 5_000;
const JAVA_OFFLINE_PROPERTIES = [
  "-Djava.net.useSystemProxies=false",
  "-Dhttp.proxyHost=127.0.0.1", "-Dhttp.proxyPort=9",
  "-Dhttps.proxyHost=127.0.0.1", "-Dhttps.proxyPort=9",
  "-Djavax.xml.accessExternalDTD=", "-Djavax.xml.accessExternalSchema=",
  "-Djavax.xml.accessExternalStylesheet="
] as const;

interface BundleFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface EpubCheckResult {
  readonly status: "VALID" | "INVALID";
  readonly version: "5.3.0";
  readonly elapsedMs: number;
  readonly fatalCount: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly messages: readonly {
    readonly severity: EpubValidationSeverity;
    readonly code: string;
  }[];
}

export interface EpubCheckPort {
  run(operationId: string, epubPath: string): Promise<EpubCheckResult>;
  cancel(operationId: string): Promise<boolean>;
  dispose(): Promise<void>;
}

interface CheckOperation {
  child: ChildProcessWithoutNullStreams | null;
  cancelled: boolean;
  terminalError: Error | null;
  forceKillTimer: NodeJS.Timeout | null;
  readonly completed: Promise<void>;
  readonly resolveCompleted: () => void;
}

export function resolveEpubCheckBundle(options: {
  readonly appPath: string;
  readonly resourcesPath: string;
  readonly isPackaged: boolean;
}): string {
  return options.isPackaged
    ? path.join(options.resourcesPath, "validation")
    : path.resolve(options.appPath, "..", "..", ".tools", "phase1g-validation", "runtime");
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid EPUBCheck data");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error("Invalid EPUBCheck data");
  }
}

function hash(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function boundedJson(filePath: string, maximumBytes: number): Promise<unknown> {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > maximumBytes) {
    throw new Error("Invalid EPUBCheck data");
  }
  const bytes = await readFile(filePath);
  if (bytes.byteLength !== metadata.size || bytes.byteLength > maximumBytes) {
    throw new Error("Invalid EPUBCheck data");
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

async function removeReportDirectory(directory: string): Promise<void> {
  if (!path.isAbsolute(directory) || path.relative(path.resolve(tmpdir()), path.dirname(directory)) !== "" ||
      !/^madi-epubcheck-[A-Za-z0-9]{6}$/u.test(path.basename(directory))) {
    throw new Error("The EPUBCheck report directory ownership is invalid");
  }
  let metadata;
  try { metadata = await lstat(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error("The EPUBCheck report directory could not be checked");
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || path.relative(directory, await realpath(directory)) !== "") {
    throw new Error("The EPUBCheck report directory ownership is invalid");
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

function parseBundleFiles(value: unknown, expectedBundleSha256: string): readonly BundleFile[] {
  const manifest = object(value);
  exactKeys(manifest, ["schemaVersion", "epubCheckVersion", "javaVersion", "archives", "files", "bundleSha256"]);
  if (manifest.schemaVersion !== 1 || manifest.epubCheckVersion !== "5.3.0" || manifest.javaVersion !== "21.0.11+10" ||
      !Array.isArray(manifest.archives) || manifest.archives.length !== ARCHIVES.length ||
      manifest.bundleSha256 !== expectedBundleSha256 || !Array.isArray(manifest.files) ||
      manifest.files.length < 2 || manifest.files.length > 1_024) {
    throw new Error("Invalid EPUBCheck bundle");
  }
  for (const expected of ARCHIVES) {
    const matches = manifest.archives.filter((entry: unknown) => {
      const archive = object(entry);
      exactKeys(archive, ["name", "sha256"]);
      return archive.name === expected.name && archive.sha256 === expected.sha256;
    });
    if (matches.length !== 1) throw new Error("Invalid EPUBCheck bundle");
  }
  const files: BundleFile[] = [];
  const caseInsensitivePaths = new Set<string>();
  let totalBytes = 0;
  for (const entry of manifest.files) {
    const file = object(entry);
    exactKeys(file, ["path", "bytes", "sha256"]);
    if (typeof file.path !== "string" || file.path.length > 1_024 ||
        !/^(?:epubcheck-5\.3\.0|jdk-21\.0\.11\+10-jre)\/[A-Za-z0-9_+./-]+$/u.test(file.path) ||
        file.path.split("/").some((part) => part === "" || part === "." || part === ".." || part.endsWith(".")) ||
        !Number.isSafeInteger(file.bytes) || (file.bytes as number) < 0 || (file.bytes as number) > 128 * 1024 * 1024 ||
        typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(file.sha256) ||
        (files.length > 0 && files[files.length - 1]!.path >= file.path) ||
        caseInsensitivePaths.has(file.path.toLowerCase())) {
      throw new Error("Invalid EPUBCheck bundle");
    }
    totalBytes += file.bytes as number;
    caseInsensitivePaths.add(file.path.toLowerCase());
    files.push({ path: file.path, bytes: file.bytes as number, sha256: file.sha256 });
  }
  if (totalBytes > 256 * 1024 * 1024 || hash(JSON.stringify(files)) !== expectedBundleSha256 ||
      !files.some((file) => file.path === JAR_PATH) || !files.some((file) => file.path === JAVA_PATH)) {
    throw new Error("Invalid EPUBCheck bundle");
  }
  return files;
}

async function verifyBundle(directory: string, expectedBundleSha256: string, checkCancellation: () => void): Promise<void> {
  try {
    const root = await lstat(directory);
    if (!root.isDirectory() || root.isSymbolicLink() || path.relative(path.resolve(directory), await realpath(directory)) !== "") {
      throw new Error("Invalid EPUBCheck bundle");
    }
    const files = parseBundleFiles(await boundedJson(path.join(directory, MANIFEST_PATH), 1024 * 1024), expectedBundleSha256);
    const expected = new Map(files.map((file) => [file.path, file]));
    const directories = new Set<string>();
    for (const file of files) {
      const parts = file.path.split("/");
      for (let length = 1; length < parts.length; length += 1) directories.add(parts.slice(0, length).join("/"));
    }
    const observed = new Set<string>();
    const visit = async (relativeDirectory: string): Promise<void> => {
      for (const name of await readdir(path.join(directory, relativeDirectory))) {
        checkCancellation();
        const relative = relativeDirectory ? `${relativeDirectory}/${name}` : name;
        const absolute = path.join(directory, relative);
        const metadata = await lstat(absolute);
        if (metadata.isSymbolicLink()) throw new Error("Invalid EPUBCheck bundle");
        if (metadata.isDirectory()) {
          if (!directories.has(relative)) throw new Error("Invalid EPUBCheck bundle");
          await visit(relative);
        } else if (relative !== MANIFEST_PATH) {
          const file = expected.get(relative);
          if (!metadata.isFile() || !file || metadata.size !== file.bytes) throw new Error("Invalid EPUBCheck bundle");
          const digest = createHash("sha256");
          for await (const bytes of createReadStream(absolute)) {
            checkCancellation();
            digest.update(bytes as Buffer);
          }
          if (digest.digest("hex") !== file.sha256) throw new Error("Invalid EPUBCheck bundle");
          observed.add(relative);
        }
      }
    };
    await visit("");
    if (observed.size !== files.length) throw new Error("Invalid EPUBCheck bundle");
    checkCancellation();
  } catch (error) {
    if (error instanceof EpubExportCancelledError) throw error;
    throw new Error("The EPUBCheck runtime bundle is missing or does not match its pinned identity");
  }
}

function parseReport(value: unknown, exitCode: number | null, elapsedMs: number): EpubCheckResult {
  const report = object(value);
  if (!Array.isArray(report.messages) || report.messages.length > 10_000) throw new Error("Invalid EPUBCheck report");
  const messages: { severity: EpubValidationSeverity; code: string }[] = [];
  for (const entry of report.messages) {
    const message = object(entry);
    if (typeof message.severity !== "string" || !["FATAL", "ERROR", "WARNING", "INFO", "USAGE"].includes(message.severity) ||
        typeof message.ID !== "string" || !/^[A-Z][A-Z0-9]{1,15}-[0-9]{3}$/u.test(message.ID)) {
      throw new Error("Invalid EPUBCheck report");
    }
    messages.push({ severity: message.severity === "USAGE" ? "ERROR" : message.severity as EpubValidationSeverity, code: message.ID });
  }
  if (exitCode !== 0 && !messages.some((message) => message.severity === "FATAL" || message.severity === "ERROR")) {
    messages.push({ severity: "ERROR", code: "EPUBCHECK_PROCESS_FAILED" });
  }
  const count = (severity: EpubValidationSeverity): number => messages.filter((message) => message.severity === severity).length;
  return {
    status: exitCode === 0 && count("FATAL") === 0 && count("ERROR") === 0 ? "VALID" : "INVALID",
    version: "5.3.0", elapsedMs,
    fatalCount: count("FATAL"), errorCount: count("ERROR"), warningCount: count("WARNING"), infoCount: count("INFO"), messages
  };
}

export class ProcessEpubCheck implements EpubCheckPort {
  private readonly active = new Map<string, CheckOperation>();
  private readonly ownedReportDirectories = new Set<string>();
  private disposed = false;

  public constructor(private readonly bundleDirectory: string, private readonly expectedBundleSha256 = EPUB_CHECK_BUNDLE_SHA256) {}

  private checkCancellation(operation: CheckOperation): void {
    if (operation.cancelled || this.disposed) throw new EpubExportCancelledError();
  }

  private terminate(operation: CheckOperation, error: Error): void {
    operation.terminalError ??= error;
    if (!operation.child) return;
    try { operation.child.kill("SIGTERM"); } catch { /* The close receipt remains required. */ }
    operation.forceKillTimer ??= setTimeout(() => {
      try { operation.child?.kill("SIGKILL"); } catch { /* The close waiter reports failure. */ }
    }, FORCE_KILL_DELAY_MS);
  }

  private async waitForCompletion(operation: CheckOperation): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        operation.completed,
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("The EPUBCheck process did not close")), CLOSE_TIMEOUT_MS); })
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }

  private execute(operation: CheckOperation, epubPath: string, reportPath: string): Promise<{ exitCode: number | null; elapsedMs: number }> {
    this.checkCancellation(operation);
    const environment = { ...process.env };
    for (const name of Object.keys(environment)) {
      if (["JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS", "CLASSPATH", "JAVA_HOME"].includes(name.toUpperCase())) delete environment[name];
    }
    const startedAt = performance.now();
    const child = spawn(path.join(this.bundleDirectory, JAVA_PATH), [
      "-Duser.language=en", "-Duser.country=US", ...JAVA_OFFLINE_PROPERTIES,
      "-jar", path.join(this.bundleDirectory, JAR_PATH), epubPath,
      "--profile", "default", "--json", reportPath, "--locale", "en", "--quiet"
    ], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], cwd: this.bundleDirectory, env: environment });
    operation.child = child;
    return new Promise((resolve, reject) => {
      let outputBytes = 0;
      const timeout = setTimeout(() => this.terminate(operation, new Error("The EPUBCheck validation timed out")), CHECK_TIMEOUT_MS);
      const drain = (bytes: Buffer): void => {
        outputBytes += bytes.byteLength;
        if (outputBytes > MAX_OUTPUT_BYTES) this.terminate(operation, new Error("The EPUBCheck process returned too much data"));
      };
      child.stdout.on("data", drain);
      child.stderr.on("data", drain);
      child.on("error", () => this.terminate(operation, new Error("The EPUBCheck process could not start")));
      child.stdin.on("error", () => this.terminate(operation, new Error("The EPUBCheck input stream failed")));
      child.once("close", (code) => {
        clearTimeout(timeout);
        if (operation.forceKillTimer) clearTimeout(operation.forceKillTimer);
        operation.forceKillTimer = null;
        operation.child = null;
        if (operation.terminalError) reject(operation.terminalError);
        else resolve({ exitCode: code, elapsedMs: performance.now() - startedAt });
      });
      child.stdin.end();
    });
  }

  public run(operationId: string, epubPath: string): Promise<EpubCheckResult> {
    try {
      if (validateEpubOperationId(operationId) !== operationId || !path.isAbsolute(epubPath)) throw new Error("Invalid EPUBCheck operation");
    } catch { return Promise.reject(new Error("The EPUBCheck operation input is invalid")); }
    if (this.disposed || this.active.has(operationId)) return Promise.reject(new Error("The EPUBCheck operation is not available"));
    let resolveCompleted!: () => void;
    const completed = new Promise<void>((resolve) => { resolveCompleted = resolve; });
    const operation: CheckOperation = { child: null, cancelled: false, terminalError: null, forceKillTimer: null, completed, resolveCompleted };
    this.active.set(operationId, operation);
    return (async () => {
      let directory: string | undefined;
      try {
        await verifyBundle(this.bundleDirectory, this.expectedBundleSha256, () => this.checkCancellation(operation));
        const input = await lstat(epubPath);
        if (!input.isFile() || input.isSymbolicLink() || input.size < 1 || input.size > 512 * 1024 * 1024) throw new Error("The EPUBCheck input file is invalid");
        this.checkCancellation(operation);
        directory = await mkdtemp(path.join(tmpdir(), "madi-epubcheck-"));
        this.ownedReportDirectories.add(directory);
        const reportPath = path.join(directory, "report.json");
        const result = await this.execute(operation, epubPath, reportPath);
        this.checkCancellation(operation);
        let report: EpubCheckResult;
        try { report = parseReport(await boundedJson(reportPath, MAX_REPORT_BYTES), result.exitCode, result.elapsedMs); }
        catch { throw new Error("The EPUBCheck process returned an invalid validation report"); }
        this.checkCancellation(operation);
        return report;
      } catch (error) {
        if (error instanceof EpubExportCancelledError) throw error;
        if (error instanceof Error && /^The EPUBCheck /u.test(error.message)) throw error;
        throw new Error("The EPUBCheck validation could not complete");
      } finally {
        try {
          if (directory) {
            await removeReportDirectory(directory);
            this.ownedReportDirectories.delete(directory);
          }
        } catch { throw new Error("The EPUBCheck report directory could not be removed"); }
        finally { this.active.delete(operationId); operation.resolveCompleted(); }
      }
    })();
  }

  public async cancel(operationId: string): Promise<boolean> {
    const operation = this.active.get(operationId);
    if (!operation) return false;
    operation.cancelled = true;
    this.terminate(operation, new EpubExportCancelledError());
    await this.waitForCompletion(operation);
    return true;
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
    const results = await Promise.allSettled([...this.active.values()].map(async (operation) => {
      operation.cancelled = true;
      this.terminate(operation, new EpubExportCancelledError());
      await this.waitForCompletion(operation);
    }));
    if (this.active.size > 0 || results.some((result) => result.status === "rejected")) throw new Error("The EPUBCheck processes did not shut down cleanly");
    const cleanup = await Promise.allSettled([...this.ownedReportDirectories].map(async (directory) => {
      await removeReportDirectory(directory);
      this.ownedReportDirectories.delete(directory);
    }));
    if (cleanup.some((result) => result.status === "rejected") || this.ownedReportDirectories.size > 0) throw new Error("The EPUBCheck reports did not shut down cleanly");
  }
}
