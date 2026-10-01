import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EPUB_CHECK_BUNDLE_SHA256, ProcessEpubCheck, resolveEpubCheckBundle } from "../src/main/epubCheckClient";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ default: { spawn: spawnMock }, spawn: spawnMock }));

const OPERATION_ID = "123e4567-e89b-42d3-a456-426614174000";
const directories: string[] = [];
const FIXTURE_FILES = [
  { path: "epubcheck-5.3.0/epubcheck.jar", content: "content-free JAR fixture" },
  { path: "epubcheck-5.3.0/lib/helper.jar", content: "content-free transitive fixture" },
  { path: "jdk-21.0.11+10-jre/NOTICE", content: "content-free notice fixture" },
  { path: "jdk-21.0.11+10-jre/bin/java.exe", content: "content-free executable fixture" },
  { path: "jdk-21.0.11+10-jre/bin/server/jvm.dll", content: "content-free runtime fixture" }
];

function digest(bytes: string): string { return createHash("sha256").update(bytes).digest("hex"); }

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

async function bundle() {
  const directory = await mkdtemp(path.join(tmpdir(), "madi-check-client-test-"));
  directories.push(directory);
  const files = FIXTURE_FILES.map((file) => ({ path: file.path, bytes: Buffer.byteLength(file.content), sha256: digest(file.content) }));
  for (const file of FIXTURE_FILES) {
    await mkdir(path.dirname(path.join(directory, file.path)), { recursive: true });
    await writeFile(path.join(directory, file.path), file.content);
  }
  const expectedHash = digest(JSON.stringify(files));
  const manifest = {
    schemaVersion: 1, epubCheckVersion: "5.3.0", javaVersion: "21.0.11+10",
    archives: [
      { name: "epubcheck-5.3.0.zip", sha256: "6c07e68584b2e2ce2f89fe06e1246dfead3eb36b46b340e7d93524f29dcff6c5" },
      { name: "temurin-jre-21.0.11+10.zip", sha256: "be26677aaa20b39a62edcaab4c8857a8b76673b0f45abc0b6143b142b62717e4" }
    ], files, bundleSha256: expectedHash
  };
  await writeFile(path.join(directory, "bundle-manifest.json"), JSON.stringify(manifest));
  const input = path.join(directory, "..", `${path.basename(directory)}.epub`);
  await writeFile(input, "content-free EPUB fixture");
  return { directory, input, expectedHash, manifest, checker: new ProcessEpubCheck(directory, expectedHash) };
}

function fakeChild() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true)
  });
}

function observeSpawn() {
  const child = fakeChild();
  const started = deferred<string>();
  spawnMock.mockImplementation((_command: string, args: string[]) => {
    started.resolve(args[args.indexOf("--json") + 1]!);
    return child as unknown as ChildProcessWithoutNullStreams;
  });
  return { child, started };
}

async function finish(child: ReturnType<typeof fakeChild>, reportPath: string, messages: unknown[] = [], code = 0) {
  await writeFile(reportPath, JSON.stringify({ messages }));
  child.emit("exit", code, null);
  child.emit("close", code, null);
}

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  spawnMock.mockReset();
  await Promise.all(directories.splice(0).map(async (directory) => {
    await rm(directory, { recursive: true, force: true });
    await rm(path.join(directory, "..", `${path.basename(directory)}.epub`), { force: true });
  }));
});

describe("pinned EPUBCheck runtime", () => {
  it("resolves only the development tool bundle or packaged resources bundle", () => {
    const appPath = path.resolve("repository", "apps", "desktop");
    const resourcesPath = path.resolve("package", "resources");
    vi.stubEnv("JAVA_HOME", "untrusted-runtime");
    vi.stubEnv("MADI_EPUBCHECK_RUNTIME", "untrusted-runtime");
    expect(resolveEpubCheckBundle({ appPath, resourcesPath, isPackaged: false })).toBe(path.resolve("repository", ".tools", "phase1g-validation", "runtime"));
    expect(resolveEpubCheckBundle({ appPath, resourcesPath, isPackaged: true })).toBe(path.join(resourcesPath, "validation"));
  });

  it("requires the source-pinned full-tree digest rather than a self-consistent replacement manifest", async () => {
    const fixture = await bundle();
    expect(fixture.expectedHash).not.toBe(EPUB_CHECK_BUNDLE_SHA256);
    await expect(new ProcessEpubCheck(fixture.directory).run(OPERATION_ID, fixture.input)).rejects.toThrow("pinned identity");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it.each(["epubcheck-5.3.0/lib/helper.jar", "jdk-21.0.11+10-jre/bin/server/jvm.dll"])("rejects a changed %s before spawning", async (relative) => {
    const fixture = await bundle();
    await writeFile(path.join(fixture.directory, relative), "modified content-free fixture");
    await expect(fixture.checker.run(OPERATION_ID, fixture.input)).rejects.toThrow("pinned identity");
    expect(spawnMock).not.toHaveBeenCalled();
    await fixture.checker.dispose();
  });

  it("rejects an extra payload file and a rehashed transitive replacement", async () => {
    const fixture = await bundle();
    const relative = "epubcheck-5.3.0/lib/helper.jar";
    const replacement = "replacement of the same trusted component";
    await writeFile(path.join(fixture.directory, relative), replacement);
    const replacementFiles = fixture.manifest.files.map((file) => file.path === relative ? { ...file, bytes: Buffer.byteLength(replacement), sha256: digest(replacement) } : file);
    await writeFile(path.join(fixture.directory, "bundle-manifest.json"), JSON.stringify({ ...fixture.manifest, files: replacementFiles, bundleSha256: digest(JSON.stringify(replacementFiles)) }));
    await expect(fixture.checker.run(OPERATION_ID, fixture.input)).rejects.toThrow("pinned identity");
    await writeFile(path.join(fixture.directory, relative), FIXTURE_FILES[1]!.content);
    await writeFile(path.join(fixture.directory, "bundle-manifest.json"), JSON.stringify(fixture.manifest));
    await writeFile(path.join(fixture.directory, "epubcheck-5.3.0", "extra.jar"), "extra fixture");
    await expect(fixture.checker.run(OPERATION_ID, fixture.input)).rejects.toThrow("pinned identity");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("rejects a wrong archive identity and an invalid operation before spawn", async () => {
    const fixture = await bundle();
    fixture.manifest.archives[0]!.sha256 = "0".repeat(64);
    await writeFile(path.join(fixture.directory, "bundle-manifest.json"), JSON.stringify(fixture.manifest));
    await expect(fixture.checker.run(OPERATION_ID, fixture.input)).rejects.toThrow("pinned identity");
    await expect(fixture.checker.run("../escape", fixture.input)).rejects.toThrow("input is invalid");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("uses the verified absolute JVM/JAR with sanitized options and reports only severity/code", async () => {
    const fixture = await bundle();
    const { child, started } = observeSpawn();
    for (const name of ["JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS", "CLASSPATH", "JAVA_HOME"]) vi.stubEnv(name, "untrusted fixture");
    const operation = fixture.checker.run(OPERATION_ID, fixture.input);
    const reportPath = await started.promise;
    const [command, args, options] = spawnMock.mock.calls[0]!;
    expect(command).toBe(path.join(fixture.directory, "jdk-21.0.11+10-jre/bin/java.exe"));
    expect(args).toContain(path.join(fixture.directory, "epubcheck-5.3.0/epubcheck.jar"));
    expect(args).toContain("-Djavax.xml.accessExternalDTD=");
    expect(args).toContain("-Dhttp.proxyHost=127.0.0.1");
    expect(options).toMatchObject({ shell: false, windowsHide: true, cwd: fixture.directory });
    for (const name of ["JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS", "CLASSPATH", "JAVA_HOME"]) expect(options.env).not.toHaveProperty(name);
    child.stderr.write("content-free unreturned detail");
    await finish(child, reportPath, [{ severity: "WARNING", ID: "OPF-003", message: "content-free unreturned detail", locations: [{ path: "unreturned.epub" }] }]);
    await expect(operation).resolves.toMatchObject({ status: "VALID", version: "5.3.0", warningCount: 1, messages: [{ severity: "WARNING", code: "OPF-003" }] });
    expect(existsSync(path.dirname(reportPath))).toBe(false);
    await fixture.checker.dispose();
  });

  it("returns INVALID for fatal/error reports and unsuccessful exits without an error message", async () => {
    const fixture = await bundle();
    let observed = observeSpawn();
    let operation = fixture.checker.run(OPERATION_ID, fixture.input);
    await finish(observed.child, await observed.started.promise, [{ severity: "ERROR", ID: "RSC-005", message: "unreturned fixture" }], 1);
    await expect(operation).resolves.toMatchObject({ status: "INVALID", errorCount: 1, messages: [{ severity: "ERROR", code: "RSC-005" }] });
    observed = observeSpawn();
    operation = fixture.checker.run(OPERATION_ID, fixture.input);
    await finish(observed.child, await observed.started.promise, [], 2);
    await expect(operation).resolves.toMatchObject({ status: "INVALID", errorCount: 1, messages: [{ code: "EPUBCHECK_PROCESS_FAILED" }] });
  });

  it.each([{ notMessages: [] }, { messages: [{ severity: "UNKNOWN", ID: "RSC-005" }] }, { messages: [{ severity: "ERROR", ID: "dynamic unreturned detail" }] }])("rejects malformed reports after close", async (report) => {
    const fixture = await bundle();
    const { child, started } = observeSpawn();
    const operation = fixture.checker.run(OPERATION_ID, fixture.input);
    void operation.catch(() => undefined);
    const reportPath = await started.promise;
    await writeFile(reportPath, JSON.stringify(report));
    child.emit("close", 0, null);
    await expect(operation).rejects.toThrow("invalid validation report");
    expect(existsSync(path.dirname(reportPath))).toBe(false);
  });

  it("holds cancellation and report ownership until the exact child closes", async () => {
    const fixture = await bundle();
    const { child, started } = observeSpawn();
    const operation = fixture.checker.run(OPERATION_ID, fixture.input);
    void operation.catch(() => undefined);
    const reportPath = await started.promise;
    let cancelled = false;
    const cancellation = fixture.checker.cancel(OPERATION_ID).then(() => { cancelled = true; });
    child.emit("exit", 1, null);
    await Promise.resolve();
    expect(cancelled).toBe(false);
    expect(existsSync(path.dirname(reportPath))).toBe(true);
    child.emit("close", 1, null);
    await expect(operation).rejects.toThrow("cancelled");
    await cancellation;
    expect(existsSync(path.dirname(reportPath))).toBe(false);
    expect(await fixture.checker.cancel(OPERATION_ID)).toBe(false);
  });

  it("cancels preparation without launching Java and blocks work after disposal", async () => {
    const fixture = await bundle();
    const operation = fixture.checker.run(OPERATION_ID, fixture.input);
    void operation.catch(() => undefined);
    await fixture.checker.cancel(OPERATION_ID);
    await expect(operation).rejects.toThrow("cancelled");
    expect(spawnMock).not.toHaveBeenCalled();
    await fixture.checker.dispose();
    await expect(fixture.checker.run(OPERATION_ID, fixture.input)).rejects.toThrow("not available");
  });

  it("keeps shutdown pending until Java closes and cleans its report afterwards", async () => {
    const fixture = await bundle();
    const { child, started } = observeSpawn();
    const operation = fixture.checker.run(OPERATION_ID, fixture.input);
    void operation.catch(() => undefined);
    const reportPath = await started.promise;
    let disposed = false;
    const shutdown = fixture.checker.dispose().then(() => { disposed = true; });
    await Promise.resolve();
    expect(disposed).toBe(false);
    expect(existsSync(path.dirname(reportPath))).toBe(true);
    child.emit("close", 1, null);
    await expect(operation).rejects.toThrow("cancelled");
    await shutdown;
    expect(disposed).toBe(true);
    expect(existsSync(path.dirname(reportPath))).toBe(false);
  });

  it("times out without settling or deleting the report before close", async () => {
    const fixture = await bundle();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { child, started } = observeSpawn();
    const operation = fixture.checker.run(OPERATION_ID, fixture.input);
    void operation.catch(() => undefined);
    const reportPath = await started.promise;
    let settled = false;
    void operation.finally(() => { settled = true; }).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(settled).toBe(false);
    expect(existsSync(path.dirname(reportPath))).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    child.emit("close", 1, null);
    await expect(operation).rejects.toThrow("timed out");
    expect(existsSync(path.dirname(reportPath))).toBe(false);
  });

  it("rejects an oversized JSON report without returning its contents", async () => {
    const fixture = await bundle();
    const { child, started } = observeSpawn();
    const operation = fixture.checker.run(OPERATION_ID, fixture.input);
    void operation.catch(() => undefined);
    const reportPath = await started.promise;
    await writeFile(reportPath, "{}");
    await truncate(reportPath, 8 * 1024 * 1024 + 1);
    child.emit("close", 0, null);
    await expect(operation).rejects.toThrow("invalid validation report");
    expect(existsSync(path.dirname(reportPath))).toBe(false);
  });

  it("terminates oversized stdout/stderr but preserves report ownership until close", async () => {
    const fixture = await bundle();
    const { child, started } = observeSpawn();
    const operation = fixture.checker.run(OPERATION_ID, fixture.input);
    void operation.catch(() => undefined);
    const reportPath = await started.promise;
    child.stderr.write(Buffer.alloc(32 * 1024 * 1024 + 1));
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(existsSync(path.dirname(reportPath))).toBe(true);
    child.emit("close", 1, null);
    await expect(operation).rejects.toThrow("too much data");
    expect(existsSync(path.dirname(reportPath))).toBe(false);
  });

  it("fails closed at the cancel bound and retains ownership until a later close receipt", async () => {
    const fixture = await bundle();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { child, started } = observeSpawn();
    const operation = fixture.checker.run(OPERATION_ID, fixture.input);
    void operation.catch(() => undefined);
    const reportPath = await started.promise;
    const cancellation = fixture.checker.cancel(OPERATION_ID);
    void cancellation.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(cancellation).rejects.toThrow("did not close");
    expect(existsSync(path.dirname(reportPath))).toBe(true);
    child.emit("close", 1, null);
    await expect(operation).rejects.toThrow("cancelled");
    await fixture.checker.dispose();
    expect(existsSync(path.dirname(reportPath))).toBe(false);
  });
});
