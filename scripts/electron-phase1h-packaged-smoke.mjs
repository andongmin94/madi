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
  "madi-packaged-phase1h-evidence.json",
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
  let committed = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(evidence, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, evidencePath);
    committed = true;
  } finally {
    if (!committed) {
      await unlink(temporaryPath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    }
  }
}

async function main() {
  await unlink(evidencePath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  const coreOverrideCanaryPath = resolve(
    repositoryRoot,
    "output",
    "phase1h-packaged-core-override-must-not-run.exe",
  );
  const exporterOverrideCanaryPath = resolve(
    repositoryRoot,
    "output",
    "phase1h-packaged-exporter-override-must-not-run.exe",
  );
  const bridgeOverrideCanaryPath = resolve(
    repositoryRoot,
    "output",
    "phase1h-packaged-bridge-override-must-not-run.exe",
  );
  const atomicOutputOverrideCanaryPath = resolve(
    repositoryRoot,
    "output",
    "phase1h-packaged-atomic-output-override-must-not-run.exe",
  );
  if (
    existsSync(coreOverrideCanaryPath) ||
    existsSync(exporterOverrideCanaryPath) ||
    existsSync(bridgeOverrideCanaryPath) ||
    existsSync(atomicOutputOverrideCanaryPath)
  ) {
    throw new Error("Packaged Phase 1H override canary path must not exist");
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
      throw new Error("Packaged Phase 1H renderer canary did not bind");
    }
    delete process.env.MADI_PHASE1H_FAST_DIAGNOSTIC;
    process.env.MADI_PHASE1H_PACKAGED_OVERRIDE_CANARY = "1";
    process.env.MADI_PACKAGED_EXE = resolve(
      repositoryRoot,
      "output",
      "madi-win32-x64",
      "madi.exe",
    );
    process.env.MADI_PHASE1H_MANIFEST = resolve(
      repositoryRoot,
      "output",
      "test-fixtures",
      "phase1f-reader-fixtures.json",
    );
    process.env.MADI_RENDERER_URL = `http://127.0.0.1:${address.port}`;
    process.env.MADI_CORE_BIN = coreOverrideCanaryPath;
    process.env.MADI_HWPX_EXPORT_BIN = exporterOverrideCanaryPath;
    process.env.MADI_HWP_BRIDGE_BIN = bridgeOverrideCanaryPath;
    process.env.MADI_ATOMIC_OUTPUT_BIN = atomicOutputOverrideCanaryPath;
    Reflect.set(
      globalThis,
      "__madiPhase1hFinalizePackagedOverrideCanaries",
      async () => {
        wrapperStage = "canary-finalize";
        if (rendererCanary.listening) {
          await close(rendererCanary);
        }
        const evidence = {
          rendererRequestCount: rendererCanaryRequestCount,
          coreOverridePresent: existsSync(coreOverrideCanaryPath),
          exporterOverridePresent: existsSync(exporterOverrideCanaryPath),
          bridgeOverridePresent: existsSync(bridgeOverrideCanaryPath),
          atomicOutputOverridePresent: existsSync(
            atomicOutputOverrideCanaryPath,
          ),
        };
        Reflect.deleteProperty(
          globalThis,
          "__madiPhase1hFinalizePackagedOverrideCanaries",
        );
        if (
          evidence.rendererRequestCount !== 0 ||
          evidence.coreOverridePresent ||
          evidence.exporterOverridePresent ||
          evidence.bridgeOverridePresent ||
          evidence.atomicOutputOverridePresent
        ) {
          throw new Error("Packaged Phase 1H development override canary changed");
        }
        return evidence;
      },
    );

    wrapperStage = "phase1h-smoke";
    await import("./electron-phase1h-smoke.mjs");
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
    throw new Error("Packaged Phase 1H renderer override was requested");
  }
  if (
    existsSync(coreOverrideCanaryPath) ||
    existsSync(exporterOverrideCanaryPath) ||
    existsSync(bridgeOverrideCanaryPath) ||
    existsSync(atomicOutputOverrideCanaryPath)
  ) {
    throw new Error("Packaged Phase 1H binary override canary changed");
  }
  if (process.exitCode !== undefined && process.exitCode !== 0) {
    wrapperStage = "common-smoke-failed";
    const failureEvidence = JSON.parse(await readFile(evidencePath, "utf8"));
    if (
      failureEvidence?.status !== "FAIL" ||
      failureEvidence?.phase !== "1H" ||
      failureEvidence?.packaged !== true
    ) {
      throw new Error("Packaged Phase 1H common failure evidence is invalid");
    }
    return;
  }

  wrapperStage = "evidence-bind";
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  if (
    evidence?.status !== "PASS" ||
    evidence?.phase !== "1H" ||
    evidence?.packaged !== true ||
    !evidence.security ||
    typeof evidence.security !== "object"
  ) {
    throw new Error("Packaged Phase 1H evidence is not an accepted PASS");
  }
  if (
    evidence.security.packagedDevelopmentOverrides?.rendererRequestCount !== 0 ||
    evidence.security.packagedDevelopmentOverrides?.coreOverridePresent !== false ||
    evidence.security.packagedDevelopmentOverrides?.exporterOverridePresent !==
      false ||
    evidence.security.packagedDevelopmentOverrides?.bridgeOverridePresent !==
      false ||
    evidence.security.packagedDevelopmentOverrides
      ?.atomicOutputOverridePresent !== false
  ) {
    throw new Error("Packaged Phase 1H canary evidence is invalid");
  }
  process.stdout.write(
    `${JSON.stringify({
      check: "packaged-phase1h-development-overrides",
      rendererRequestCount: rendererCanaryRequestCount,
      coreOverridePresent: false,
      exporterOverridePresent: false,
      bridgeOverridePresent: false,
      atomicOutputOverridePresent: false,
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
      phase: "1H",
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
    `[electron-phase1h-wrapper] failed ${JSON.stringify({
      stage: wrapperStage,
      error: summarized,
      cleanupFailed: wrapperCleanupFailed,
      evidenceWriteFailed,
    })}\n`,
  );
  process.exitCode = 1;
}

