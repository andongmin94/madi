import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const evidencePath = resolve(
  repositoryRoot,
  "output",
  "playwright",
  "madi-packaged-phase1g-evidence.json",
);
let wrapperStage = "preflight";
let wrapperCleanupFailed = false;

function summarizeWrapperError(error) {
  if (!(error instanceof Error)) {
    return { name: "NonError", messageLength: String(error).length };
  }
  const allowedNames = new Set([
    "Error",
    "TypeError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "URIError",
    "EvalError",
    "AggregateError",
  ]);
  return {
    name: allowedNames.has(error.name) ? error.name : "OtherError",
    nameLength: error.name.length,
    messageLength: error.message.length,
    stackFrameCount: (error.stack?.match(/\n\s+at\s/gu) ?? []).length,
  };
}

function listen(server) {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error) => {
      server.off("listening", onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolveListen();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

function close(server) {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) {
        rejectClose(error);
      } else {
        resolveClose();
      }
    });
  });
}

async function writeEvidenceAtomically(evidence) {
  const temporaryPath = `${evidencePath}.${process.pid}.${randomUUID()}.wrapper.tmp`;
  await mkdir(dirname(evidencePath), { recursive: true });
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporaryPath, evidencePath);
  } catch (error) {
    if (error?.code !== "EEXIST" && error?.code !== "EPERM") {
      throw error;
    }
    await unlink(evidencePath).catch((unlinkError) => {
      if (unlinkError?.code !== "ENOENT") {
        throw unlinkError;
      }
    });
    await rename(temporaryPath, evidencePath);
  }
}

async function main() {
  const coreOverrideCanaryPath = resolve(
    repositoryRoot,
    "output",
    "phase1g-packaged-core-override-must-not-run.exe",
  );
  const exporterOverrideCanaryPath = resolve(
    repositoryRoot,
    "output",
    "phase1g-packaged-exporter-override-must-not-run.exe",
  );
  if (existsSync(coreOverrideCanaryPath) || existsSync(exporterOverrideCanaryPath)) {
    throw new Error("Packaged Phase 1G override canary path must not exist");
  }

  let rendererCanaryRequestCount = 0;
  const rendererCanary = createServer((_request, response) => {
    rendererCanaryRequestCount += 1;
    response.writeHead(204, {
      "Content-Security-Policy": "default-src 'none'",
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end();
  });
  rendererCanary.unref();

  let operationError;
  let operationStage;
  try {
    wrapperStage = "canary-listen";
    await listen(rendererCanary);
    const address = rendererCanary.address();
    if (!address || typeof address === "string") {
      throw new Error("Packaged Phase 1G renderer canary did not bind");
    }
    delete process.env.MADI_PHASE1G_FAST_DIAGNOSTIC;
    process.env.MADI_PHASE1G_PACKAGED_OVERRIDE_CANARY = "1";
    process.env.MADI_PACKAGED_EXE = resolve(
      repositoryRoot,
      "output",
      "madi-win32-x64",
      "madi.exe",
    );
    process.env.MADI_PHASE1G_MANIFEST = resolve(
      repositoryRoot,
      "output",
      "test-fixtures",
      "phase1f-reader-fixtures.json",
    );
    process.env.MADI_RENDERER_URL = `http://127.0.0.1:${address.port}`;
    process.env.MADI_CORE_BIN = coreOverrideCanaryPath;
    process.env.MADI_EPUB_EXPORT_BIN = exporterOverrideCanaryPath;

    wrapperStage = "phase1g-smoke";
    await import("./electron-phase1g-smoke.mjs");
  } catch (error) {
    operationError = error;
    operationStage = wrapperStage;
  }

  let cleanupError;
  if (rendererCanary.listening) {
    wrapperStage = "canary-close";
    try {
      await close(rendererCanary);
    } catch (error) {
      cleanupError = error;
      wrapperCleanupFailed = true;
    }
  }
  if (operationError) {
    wrapperStage = operationStage;
    throw operationError;
  }
  if (cleanupError) {
    throw cleanupError;
  }

  wrapperStage = "canary-verify";
  if (rendererCanaryRequestCount !== 0) {
    throw new Error("Packaged Phase 1G renderer override was requested");
  }
  if (existsSync(coreOverrideCanaryPath) || existsSync(exporterOverrideCanaryPath)) {
    throw new Error("Packaged Phase 1G binary override canary changed");
  }
  if (process.exitCode !== undefined && process.exitCode !== 0) {
    wrapperStage = "common-smoke-failed";
    await writeEvidenceAtomically({
      status: "FAIL",
      phase: "1G",
      packaged: true,
      stage: wrapperStage,
      error: {
        name: "Error",
        nameLength: 5,
        messageLength: 0,
        stackFrameCount: 0,
      },
      context: {
        wrapper: true,
        commonSmokeFailed: true,
        cleanupFailed: wrapperCleanupFailed,
      },
    });
    return;
  }

  wrapperStage = "evidence-bind";
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  if (
    evidence?.status !== "PASS" ||
    evidence?.phase !== "1G" ||
    evidence?.packaged !== true ||
    !evidence.security ||
    typeof evidence.security !== "object"
  ) {
    throw new Error("Packaged Phase 1G evidence is not an accepted PASS");
  }
  await writeEvidenceAtomically({
    ...evidence,
    security: {
      ...evidence.security,
      packagedDevelopmentOverrides: {
        rendererRequestCount: rendererCanaryRequestCount,
        coreOverridePresent: false,
        exporterOverridePresent: false,
      },
    },
  });
  process.stdout.write(
    `${JSON.stringify({
      check: "packaged-phase1g-development-overrides",
      rendererRequestCount: rendererCanaryRequestCount,
      coreOverridePresent: false,
      exporterOverridePresent: false,
    })}\n`,
  );
}

try {
  await main();
} catch (error) {
  const summarized = summarizeWrapperError(error);
  let evidenceWriteFailed = false;
  try {
    await writeEvidenceAtomically({
      status: "FAIL",
      phase: "1G",
      packaged: true,
      stage: wrapperStage,
      error: summarized,
      context: {
        wrapper: true,
        cleanupFailed: wrapperCleanupFailed,
      },
    });
  } catch {
    evidenceWriteFailed = true;
  }
  process.stderr.write(
    `[electron-phase1g-wrapper] failed ${JSON.stringify({
      stage: wrapperStage,
      error: summarized,
      cleanupFailed: wrapperCleanupFailed,
      evidenceWriteFailed,
    })}\n`,
  );
  process.exitCode = 1;
}
