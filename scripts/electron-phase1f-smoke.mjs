import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { _electron as electron } from "playwright-core";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const desktopDirectory = resolve(repositoryRoot, "apps", "desktop");
const desktopRequire = createRequire(
  new URL("../apps/desktop/package.json", import.meta.url),
);
const packagedExecutable = process.env.MADI_PACKAGED_EXE?.trim();
const packaged = Boolean(packagedExecutable);
const electronExecutable = packagedExecutable || desktopRequire("electron");
const executableName = process.platform === "win32" ? "madi-core.exe" : "madi-core";
const coreBinary = resolve(
  repositoryRoot,
  "crates",
  "madi-core",
  "target",
  "debug",
  executableName,
);
const manifestPath = resolve(
  process.env.MADI_PHASE1F_MANIFEST?.trim() ||
    resolve(repositoryRoot, "output", "test-fixtures", "phase1f-reader-fixtures.json"),
);
const artifactDirectory = resolve(repositoryRoot, "output", "playwright");
const artifactPrefix = packaged
  ? "madi-packaged-phase1f"
  : "madi-electron-phase1f";
const evidencePath = resolve(artifactDirectory, `${artifactPrefix}-evidence.json`);
const WINDOW_CLOSE_TIMEOUT_MS = 195_000;
const normalScreenshotPath = resolve(
  artifactDirectory,
  `${artifactPrefix}-normal.png`,
);
const reopenedScreenshotPath = resolve(
  artifactDirectory,
  `${artifactPrefix}-reopened.png`,
);
const longScreenshotPath = resolve(
  artifactDirectory,
  `${artifactPrefix}-long.png`,
);
const measurementRuns = 5;
const fastDiagnostic = process.env.MADI_PHASE1F_FAST_DIAGNOSTIC === "1";
const expensiveMeasurementRuns = fastDiagnostic ? 1 : measurementRuns;
const snapshotName = "Phase 1F Reader actual checkpoint";
const customPresetName = "Phase 1F actual preset";
const updatedPresetName = "Phase 1F actual preset updated";
const privateContentFragments = [snapshotName, customPresetName, updatedPresetName];
let currentStage = "startup";
let diagnosticRun = null;
let lastFailureContext = null;

function reportStage(stage) {
  currentStage = stage;
  process.stderr.write(`[electron-phase1f] ${stage}\n`);
}

function verify(condition, code, details = undefined) {
  if (!condition) {
    throw new Error(
      details === undefined ? code : `${code}: ${JSON.stringify(details)}`,
    );
  }
}

function summarizeError(error) {
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
    "TimeoutError",
  ]);
  return {
    name: allowedNames.has(error.name) ? error.name : "OtherError",
    nameLength: error.name.length,
    messageLength: error.message.length,
    stackFrameCount: (error.stack?.match(/\n\s+at\s/gu) ?? []).length,
  };
}

function roundMilliseconds(value) {
  return Number(value.toFixed(2));
}

function summarizeMeasurements(samples) {
  verify(samples.length > 0, "measurement-samples-empty");
  const ordered = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  const median =
    ordered.length % 2 === 0
      ? (ordered[middle - 1] + ordered[middle]) / 2
      : ordered[middle];
  return {
    runs: samples.length,
    samplesMs: samples.map(roundMilliseconds),
    medianMs: roundMilliseconds(median),
    maxMs: roundMilliseconds(Math.max(...samples)),
  };
}

function readerPaneConfigurationIdentity(pane) {
  return {
    deviceProfileId: pane.deviceProfileId,
    deviceCategory: pane.deviceCategory,
    viewportWidth: pane.viewportWidth,
    viewportHeight: pane.viewportHeight,
    fontToken: pane.fontToken,
    fontSize: pane.fontSize,
    lineHeight: pane.lineHeight,
    sceneBreakStyle: pane.sceneBreakStyle,
    zoom: pane.zoom,
  };
}

function assertEvidencePrivacy(evidence) {
  const serialized = JSON.stringify(evidence);
  const leakedFragmentIndexes = privateContentFragments.flatMap((fragment, index) =>
    serialized.includes(fragment) ? [index] : [],
  );
  verify(leakedFragmentIndexes.length === 0, "reader-evidence-private-content", {
    leakedFragmentIndexes,
  });
}

function structuralHash(value) {
  let result = 2166136261;
  for (const character of String(value)) {
    result ^= character.codePointAt(0) ?? 0;
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

function redactExternalUrl(candidate) {
  try {
    const parsed = new URL(candidate);
    const allowedProtocols = new Set([
      "http:",
      "https:",
      "ws:",
      "wss:",
      "file:",
      "madi:",
    ]);
    return {
      protocol: allowedProtocols.has(parsed.protocol) ? parsed.protocol : "OTHER",
      hostPresent: parsed.host.length > 0,
      hostLength: parsed.host.length,
      hostHash: parsed.host ? structuralHash(parsed.host) : null,
    };
  } catch {
    return {
      protocol: "invalid",
      hostPresent: false,
      hostLength: 0,
      hostHash: null,
    };
  }
}

function isLocalRuntimeUrl(candidate) {
  try {
    return ["madi:", "data:", "blob:", "devtools:"].includes(
      new URL(candidate).protocol,
    );
  } catch {
    return false;
  }
}

function isAllowedRuntimeWebSocket(candidate, pageUrl) {
  try {
    const socket = new URL(candidate);
    const page = new URL(pageUrl);
    return (
      (socket.protocol === "ws:" || socket.protocol === "wss:") &&
      (page.protocol === "http:" || page.protocol === "https:") &&
      socket.hostname === page.hostname &&
      socket.port === page.port
    );
  } catch {
    return false;
  }
}

function safeDiagnosticInteger(value, maximum = 1_000_000_000) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum
    ? value
    : null;
}

function sanitizeDiagnosticValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { type: "OTHER" };
  }
  const allowedTypes = new Set([
    "Error",
    "string",
    "null",
    "undefined",
    "boolean",
    "number",
    "bigint",
    "symbol",
    "function",
    "object",
  ]);
  const type = allowedTypes.has(value.type) ? value.type : "OTHER";
  return {
    type,
    nameLength: safeDiagnosticInteger(value.nameLength),
    messageLength: safeDiagnosticInteger(value.messageLength),
    reactCode: safeDiagnosticInteger(value.reactCode, 10_000),
    resizeObserverLoop: value.resizeObserverLoop === true,
  };
}

function sanitizeRendererDiagnostic(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const allowedConsoleSources = new Set([
    "console.error",
    "console.warn",
    "console.log",
    "console.info",
    "console.debug",
    "console.trace",
    "console.table",
  ]);
  if (allowedConsoleSources.has(value.source)) {
    return {
      source: value.source,
      argumentCount: safeDiagnosticInteger(value.argumentCount),
      arguments: Array.isArray(value.arguments)
        ? value.arguments.slice(0, 8).map(sanitizeDiagnosticValue)
        : [],
    };
  }
  if (value.source === "window.error") {
    const allowedTags = new Set([
      "",
      "IMG",
      "LINK",
      "SCRIPT",
      "IFRAME",
      "VIDEO",
      "AUDIO",
      "OTHER",
    ]);
    return {
      source: "window.error",
      error: sanitizeDiagnosticValue(value.error),
      messageLength: safeDiagnosticInteger(value.messageLength),
      targetIsWindow: value.targetIsWindow === true,
      targetTag: allowedTags.has(value.targetTag) ? value.targetTag : "OTHER",
    };
  }
  return null;
}

function assertDiagnosticSanitizer() {
  const marker = "phase1f-private-diagnostic-probe";
  const sanitized = sanitizeRendererDiagnostic({
    source: "console.error",
    argumentCount: 1,
    rawMessage: marker,
    arguments: [
      {
        type: "Error",
        nameLength: 9,
        messageLength: marker.length,
        rawMessage: marker,
      },
    ],
  });
  verify(
    sanitized !== null && !JSON.stringify(sanitized).includes(marker),
    "reader-diagnostic-sanitizer",
  );
  verify(
    sanitizeRendererDiagnostic({ source: marker, rawMessage: marker }) === null,
    "reader-diagnostic-source-allowlist",
  );
  const privateNamedError = new Error(marker);
  privateNamedError.name = marker;
  const summarizedError = summarizeError(privateNamedError);
  verify(
    summarizedError.name === "OtherError" &&
      !JSON.stringify(summarizedError).includes(marker),
    "reader-error-name-sanitizer",
  );
}

async function poll(operation, description, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await operation();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 80));
  }
  throw new Error(
    `${description} timed out${
      lastError instanceof Error ? ` (${lastError.name}:${lastError.message.length})` : ""
    }`,
  );
}

async function launchApplication({ projectPath, userDataPath }) {
  let application;
  try {
    application = await electron.launch({
      executablePath: electronExecutable,
      args: packaged
        ? [`--user-data-dir=${userDataPath}`]
        : [".", `--user-data-dir=${userDataPath}`],
      cwd: packaged ? dirname(electronExecutable) : desktopDirectory,
      env: {
        ...process.env,
        ...(packaged ? {} : { MADI_CORE_BIN: coreBinary }),
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      },
      timeout: 30_000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLocaleLowerCase() : "";
    lastFailureContext = {
      rendererAvailable: false,
      launch: {
        ...summarizeError(error),
        processFailedToLaunch: message.includes("process failed to launch"),
        targetClosed: message.includes("target page, context or browser has been closed"),
        spawnFailure: message.includes("spawn"),
        executableMissing: message.includes("enoent"),
        accessDenied: message.includes("eperm") || message.includes("access is denied"),
        timeout: message.includes("timeout"),
        crashed: message.includes("crash"),
      },
    };
    throw error;
  }
  try {
    const requestedUrls = [];
    const websocketUrls = [];
    const pageErrors = [];
    const rendererDiagnostics = [];
    const diagnosticIndexes = new Map();
    const dialogEvidence = [];
    application.context().on("request", (request) => requestedUrls.push(request.url()));
    await application.evaluate(
    ({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath],
      });
    },
    projectPath,
  );
  const page = await application.firstWindow({ timeout: 30_000 });
  page.on("websocket", (socket) => websocketUrls.push(socket.url()));
  const appRuntime = await application.evaluate(({ app }) => ({
    isPackaged: app.isPackaged,
    appName: app.getName(),
  }));
  const runtime = {
    ...appRuntime,
    rendererProtocol: await page.evaluate(() => window.location.protocol),
    packagedOverrideCanary:
      packaged && process.env.MADI_PHASE1F_PACKAGED_OVERRIDE_CANARY === "1",
  };
  page.on("dialog", (dialog) => {
    dialogEvidence.push({ type: dialog.type(), messageLength: dialog.message().length });
    void dialog.accept();
  });
  page.on("pageerror", (error) => {
    const reactCode = error.message.match(/Minified React error #(\d+)/u)?.[1];
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
    pageErrors.push({
      name: allowedNames.has(error.name) ? error.name : "OtherError",
      nameLength: error.name.length,
      messageLength: error.message.length,
      reactCode: reactCode ? Number(reactCode) : null,
      maximumUpdateDepth: error.message.includes("Maximum update depth exceeded"),
      tooManyRerenders: error.message.includes("Too many re-renders"),
    });
  });
  await page.exposeBinding("__madiPhase1fDiagnostic", (_source, diagnostic) => {
    const sanitized = sanitizeRendererDiagnostic(diagnostic);
    if (!sanitized) {
      return;
    }
    const key = JSON.stringify(sanitized);
    const index = diagnosticIndexes.get(key);
    if (index !== undefined) {
      rendererDiagnostics[index] = {
        ...rendererDiagnostics[index],
        occurrences: rendererDiagnostics[index].occurrences + 1,
      };
    } else if (rendererDiagnostics.length < 100) {
      diagnosticIndexes.set(key, rendererDiagnostics.length);
      rendererDiagnostics.push({ ...sanitized, occurrences: 1 });
    }
  });
  await page.addInitScript(() => {
    const summarize = (value) => {
      if (value instanceof Error) {
        return {
          type: "Error",
          nameLength: value.name.length,
          messageLength: value.message.length,
          reactCode: Number(value.message.match(/Minified React error #(\d+)/u)?.[1] ?? 0) || null,
          resizeObserverLoop:
            value.message === "ResizeObserver loop completed with undelivered notifications.",
        };
      }
      if (typeof value === "string") {
        return {
          type: "string",
          messageLength: value.length,
          reactCode: Number(value.match(/Minified React error #(\d+)/u)?.[1] ?? 0) || null,
          resizeObserverLoop:
            value === "ResizeObserver loop completed with undelivered notifications.",
        };
      }
      return { type: value === null ? "null" : typeof value };
    };
    const report = (diagnostic) => {
      const binding = Reflect.get(globalThis, "__madiPhase1fDiagnostic");
      if (typeof binding === "function") {
        void binding(diagnostic).catch(() => undefined);
      }
    };
    for (const method of [
      "error",
      "warn",
      "log",
      "info",
      "debug",
      "trace",
      "table",
    ]) {
      console[method] = (...args) => {
        report({
          source: `console.${method}`,
          argumentCount: args.length,
          arguments: args.slice(0, 8).map(summarize),
        });
      };
    }
    window.addEventListener(
      "error",
      (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const tag = target?.tagName ?? "";
        const allowedTags = new Set(["IMG", "LINK", "SCRIPT", "IFRAME", "VIDEO", "AUDIO"]);
        report({
          source: "window.error",
          error: summarize(event.error),
          messageLength: event.message.length,
          targetIsWindow: event.target === window,
          targetTag: allowedTags.has(tag) ? tag : tag ? "OTHER" : "",
        });
      },
      { capture: true },
    );
  });
  await page.context().setOffline(true);
  await page.reload({ waitUntil: "load" });
  await page.locator(".engine-pill--ready").waitFor({ timeout: 30_000 });
  const localFileProbeUrl = pathToFileURL(resolve(repositoryRoot, "package.json")).toString();
  const localFileProbe = await page.evaluate(async (url) => {
    try {
      const response = await fetch(url);
      return { readable: response.ok, status: response.status };
    } catch {
      return { readable: false, status: 0 };
    }
  }, localFileProbeUrl);
    return {
      application,
      page,
      requestedUrls,
      websocketUrls,
      pageErrors,
      rendererDiagnostics,
      dialogEvidence,
      localFileProbeUrl,
      localFileProbe,
      runtime,
    };
  } catch (error) {
    try {
      await closeApplicationsOrThrow([application]);
    } catch (cleanupError) {
      lastFailureContext = {
        rendererAvailable: false,
        postLaunchSetup: summarizeError(error),
        postLaunchCleanup: summarizeError(cleanupError),
      };
      throw cleanupError;
    }
    throw error;
  }
}

async function waitForChildExit(childProcess, timeoutMs) {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
    return true;
  }
  return new Promise((resolveExit) => {
    const finish = (exited) => {
      clearTimeout(timer);
      childProcess.off("exit", onExit);
      resolveExit(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    childProcess.once("exit", onExit);
  });
}

async function forceCloseApplication(application) {
  let childProcess;
  try {
    childProcess = application.process();
  } catch {
    return;
  }
  if (process.platform === "win32" && childProcess.pid && childProcess.exitCode === null) {
    spawnSync("taskkill", ["/PID", String(childProcess.pid), "/T", "/F"], {
      stdio: "ignore",
      timeout: 5_000,
      windowsHide: true,
    });
  } else if (childProcess.exitCode === null && childProcess.signalCode === null) {
    childProcess.kill();
  }
  if (!(await waitForChildExit(childProcess, 5_000))) {
    throw new Error("reader-application-process-did-not-exit");
  }
}

async function closeApplicationsOrThrow(applications) {
  const results = await Promise.allSettled(
    applications.map((application) => forceCloseApplication(application)),
  );
  const failureCount = results.filter((result) => result.status === "rejected").length;
  if (failureCount > 0) {
    lastFailureContext = {
      ...(lastFailureContext ?? { rendererAvailable: false }),
      applicationCleanupFailureCount: failureCount,
    };
    throw new Error("reader-application-cleanup-failed");
  }
}

async function closeWindowCleanly(run) {
  const windowClosed = run.page.waitForEvent("close", {
    timeout: WINDOW_CLOSE_TIMEOUT_MS,
  });
  await run.application.evaluate(({ BrowserWindow }) => {
    setTimeout(() => BrowserWindow.getAllWindows()[0]?.close(), 100);
  });
  await windowClosed;
  await new Promise((resolveClose) => setTimeout(resolveClose, 350));
  await forceCloseApplication(run.application);
}

function sampleApplicationMemory(application) {
  const rootPid = application.process().pid;
  if (process.platform !== "win32" || !Number.isSafeInteger(rootPid)) {
    return { available: false };
  }
  const command = [
    `$readerRootPid = ${rootPid}`,
    "$readerProcesses = Get-CimInstance Win32_Process",
    "$readerIds = @($readerRootPid)",
    "do { $readerPrevious = $readerIds.Count; $readerIds += @($readerProcesses | Where-Object { $readerIds -contains $_.ParentProcessId } | ForEach-Object ProcessId); $readerIds = @($readerIds | Sort-Object -Unique) } while ($readerIds.Count -ne $readerPrevious)",
    "$readerRows = @($readerProcesses | Where-Object { $readerIds -contains $_.ProcessId } | ForEach-Object { $readerProcess = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if ($readerProcess) { [PSCustomObject]@{ name = $_.Name; working = [double]$readerProcess.WorkingSet64; private = [double]$readerProcess.PrivateMemorySize64 } } })",
    "$readerRows | ConvertTo-Json -Compress",
  ].join("; ");
  const sampled = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8", timeout: 8_000, windowsHide: true },
  );
  if (sampled.status !== 0 || !sampled.stdout.trim()) {
    return { available: false };
  }
  try {
    const parsed = JSON.parse(sampled.stdout);
    const rows = (Array.isArray(parsed) ? parsed : [parsed]).filter(
      (row) => row && Number.isFinite(row.working) && Number.isFinite(row.private),
    );
    return {
      available: true,
      processCount: rows.length,
      workingSetBytes: Math.round(rows.reduce((sum, row) => sum + row.working, 0)),
      privateBytes: Math.round(rows.reduce((sum, row) => sum + row.private, 0)),
    };
  } catch {
    return { available: false };
  }
}

async function openProject(run) {
  await run.page.getByRole("button", { name: ".madi 열기", exact: true }).click();
  const phase = await poll(
    async () => {
      if (run.pageErrors.length > 0) {
        return "page-error";
      }
      const current = await run.page
        .locator('[data-testid="save-status"]')
        .getAttribute("data-phase");
      return current === "saved" || current === "dirty" || current === "error"
        ? current
        : null;
    },
    "project-open",
    60_000,
  );
  verify(phase === "saved" || phase === "dirty", "project-open-failed", {
    phase,
    pageErrorCount: run.pageErrors.length,
  });
}

async function enterReaderLab(run) {
  const button = run.page.getByRole("button", { name: "Reader Lab", exact: true });
  await poll(
    async () => ((await button.isEnabled()) ? true : null),
    "reader-mode-enabled",
    30_000,
  );
  await button.click();
  await waitForReaderReady(run);
}

async function waitForReaderReady(run, expectedScopeKind = undefined, timeoutMs = 90_000) {
  return poll(
    async () => {
      if (run.pageErrors.length > 0) {
        return { ready: false, pageErrorCount: run.pageErrors.length };
      }
      const workspace = run.page.locator('section[aria-label="읽기 실험실"]');
      if ((await workspace.count()) !== 1) {
        return null;
      }
      const status = await workspace.getAttribute("data-reader-compile-status");
      const scopeKind = await workspace.getAttribute("data-reader-scope-kind");
      if (
        status === "ready" &&
        (!expectedScopeKind || scopeKind === expectedScopeKind)
      ) {
        return { ready: true, status, scopeKind };
      }
      if (status === "error") {
        return {
          ready: false,
          status,
          alertCount: await run.page.getByRole("alert").count(),
        };
      }
      return null;
    },
    "reader-ready",
    timeoutMs,
  ).then((result) => {
    verify(result.ready, "reader-not-ready", result);
    return result;
  });
}

async function readReaderEvidence(page) {
  return page.locator('section[aria-label="읽기 실험실"]').evaluate((workspace) => {
    const numeric = (element, name) => {
      const raw = element.getAttribute(name);
      if (raw === null || raw === "") {
        return null;
      }
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    };
    const panes = [...workspace.querySelectorAll("[data-reader-pane]")].map((pane) => {
      const host = pane.querySelector(".reader-shadow-host");
      const root = host?.shadowRoot ?? null;
      const blocks = root ? [...root.querySelectorAll("[data-reader-block-id]")] : [];
      const scroller = root?.querySelector(".reader-scroll") ?? null;
      const firstParagraph = root?.querySelector("[data-reader-paragraph='true']") ?? null;
      const paragraphStyle =
        firstParagraph instanceof HTMLElement ? getComputedStyle(firstParagraph) : null;
      const paragraphFontSize = paragraphStyle
        ? Number.parseFloat(paragraphStyle.fontSize)
        : Number.NaN;
      const paragraphLineHeight = paragraphStyle
        ? Number.parseFloat(paragraphStyle.lineHeight)
        : Number.NaN;
      const maximumScroll =
        scroller instanceof HTMLElement
          ? Math.max(0, scroller.scrollHeight - scroller.clientHeight)
          : Number.NaN;
      return {
        pane: numeric(pane, "data-reader-pane"),
        virtualized: pane.getAttribute("data-virtualized") === "true",
        canonicalSections: numeric(pane, "data-reader-canonical-section-count"),
        canonicalBlocks: numeric(pane, "data-reader-canonical-block-count"),
        mountedSections: numeric(pane, "data-reader-mounted-section-count"),
        mountedBlocks: scroller
          ? numeric(scroller, "data-reader-mounted-block-count")
          : null,
        shadowReady: scroller instanceof HTMLElement && blocks.length > 0,
        paintedWidth:
          host instanceof HTMLElement ? host.getBoundingClientRect().width : null,
        paintedHeight:
          host instanceof HTMLElement ? host.getBoundingClientRect().height : null,
        paragraphFontSize: Number.isFinite(paragraphFontSize)
          ? paragraphFontSize
          : null,
        paragraphLineHeightRatio:
          Number.isFinite(paragraphLineHeight) && paragraphFontSize > 0
            ? paragraphLineHeight / paragraphFontSize
            : null,
        measurementStatus: pane.getAttribute("data-reader-measurement-status"),
        measuredSections: numeric(pane, "data-reader-measured-section-count"),
        measuredBlocks: numeric(pane, "data-reader-measured-block-count"),
        totalSections: numeric(pane, "data-reader-total-section-count"),
        renderedHeight: numeric(pane, "data-reader-rendered-height"),
        screenCount: numeric(pane, "data-reader-screen-count"),
        longestParagraphLines: numeric(pane, "data-reader-longest-paragraph-lines"),
        paragraphsAtLeastEightLines: numeric(
          pane,
          "data-reader-eight-line-paragraph-count",
        ),
        overflowCount: numeric(pane, "data-reader-overflow-count"),
        deviceCategory: pane.getAttribute("data-reader-device-category"),
        viewportWidth: numeric(pane, "data-reader-viewport-width"),
        viewportHeight: numeric(pane, "data-reader-viewport-height"),
        fontToken: pane.getAttribute("data-reader-font-token"),
        fontSize: numeric(pane, "data-reader-font-size"),
        lineHeight: numeric(pane, "data-reader-line-height"),
        horizontalPadding: numeric(pane, "data-reader-horizontal-padding"),
        verticalPadding: numeric(pane, "data-reader-vertical-padding"),
        theme: pane.getAttribute("data-reader-theme"),
        sceneBreakStyle: pane.getAttribute("data-reader-scene-break-style"),
        zoom: numeric(pane, "data-reader-zoom"),
        scrollProgress: numeric(pane, "data-reader-scroll-progress"),
        actualScrollProgress: Number.isFinite(maximumScroll)
          ? maximumScroll > 0
            ? scroller.scrollTop / maximumScroll
            : 0
          : null,
        selectedBlockPresent:
          (pane.getAttribute("data-reader-selected-source-block-id") ?? "").length > 0,
        selectedVisibleCount: blocks.filter(
          (block) => block.getAttribute("aria-pressed") === "true",
        ).length,
        rovingTargetCount:
          blocks.filter((block) => block.getAttribute("tabindex") === "0").length +
          (scroller?.getAttribute("tabindex") === "0" ? 1 : 0),
        externalElementCount: root
          ? root.querySelectorAll(
              "script,iframe,object,embed,link,[src],[href],[style*='url(']",
            ).length
          : 0,
      };
    });
    return {
      compileStatus: workspace.getAttribute("data-reader-compile-status"),
      scopeKind: workspace.getAttribute("data-reader-scope-kind"),
      projectRevision: numeric(workspace, "data-reader-project-revision"),
      coreCompileMs: numeric(workspace, "data-reader-core-compile-ms"),
      ipcRoundTripMs: numeric(workspace, "data-reader-ipc-round-trip-ms"),
      validationMs: numeric(workspace, "data-reader-validation-ms"),
      firstVisibleMs: numeric(workspace, "data-reader-first-visible-ms"),
      sourceStats: {
        withSpaces: numeric(workspace, "data-reader-source-with-spaces"),
        withoutSpaces: numeric(workspace, "data-reader-source-without-spaces"),
        paragraphs: numeric(workspace, "data-reader-source-paragraph-count"),
        scenes: numeric(workspace, "data-reader-source-scene-count"),
        chapters: numeric(workspace, "data-reader-source-chapter-count"),
      },
      diagnosticCount: numeric(workspace, "data-reader-diagnostic-count"),
      diagnosticMeasurementStatus: workspace.getAttribute(
        "data-reader-diagnostic-measurement-status",
      ),
      layoutDiagnosticsStatus: workspace.getAttribute(
        "data-reader-layout-diagnostics-status",
      ),
      scrollSync: workspace.getAttribute("data-reader-scroll-sync") === "true",
      leftPanelWidth: numeric(workspace, "data-reader-left-panel-width"),
      rightPanelWidth: numeric(workspace, "data-reader-right-panel-width"),
      diagnosticsExpanded:
        workspace.getAttribute("data-reader-diagnostics-expanded") === "true",
      paneCount: panes.length,
      panes,
      alertCount: workspace.querySelectorAll('[role="alert"]').length,
    };
  });
}

async function readReaderIdentity(page) {
  return page.locator('section[aria-label="읽기 실험실"]').evaluate((workspace) => {
    const numeric = (element, name) => {
      const raw = element.getAttribute(name);
      if (raw === null || raw === "") {
        return null;
      }
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    };
    return {
      paneCount: workspace.querySelectorAll("[data-reader-pane]").length,
      scrollSync: workspace.getAttribute("data-reader-scroll-sync") === "true",
      leftPanelWidth: numeric(workspace, "data-reader-left-panel-width"),
      rightPanelWidth: numeric(workspace, "data-reader-right-panel-width"),
      diagnosticsExpanded:
        workspace.getAttribute("data-reader-diagnostics-expanded") === "true",
      panes: [...workspace.querySelectorAll("[data-reader-pane]")].map((pane) => ({
        presetId:
          pane.parentElement?.getAttribute("data-reader-preset-id") ?? "",
        deviceProfileId:
          pane.getAttribute("data-reader-device-profile-id") ?? "",
        deviceCategory:
          pane.getAttribute("data-reader-device-category") ?? "",
        viewportWidth: numeric(pane, "data-reader-viewport-width"),
        viewportHeight: numeric(pane, "data-reader-viewport-height"),
        fontToken: pane.getAttribute("data-reader-font-token") ?? "",
        fontSize: numeric(pane, "data-reader-font-size"),
        lineHeight: numeric(pane, "data-reader-line-height"),
        sceneBreakStyle:
          pane.getAttribute("data-reader-scene-break-style") ?? "",
        zoom: numeric(pane, "data-reader-zoom"),
        selectedBlockId:
          pane.getAttribute("data-reader-selected-source-block-id") ?? "",
        scrollProgress: numeric(pane, "data-reader-scroll-progress"),
        actualScrollProgress: (() => {
          const scroller = pane.querySelector(".reader-shadow-host")?.shadowRoot
            ?.querySelector(".reader-scroll");
          if (!(scroller instanceof HTMLElement)) {
            return null;
          }
          const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
          return maximum > 0 ? scroller.scrollTop / maximum : 0;
        })(),
      })),
    };
  });
}

async function selectScope(run, scope) {
  const startedAt = performance.now();
  await run.page
    .getByRole("listbox", { name: "Reader 범위", exact: true })
    .selectOption(scope.scopeNodeId);
  await waitForReaderReady(run, scope.scopeKind, 120_000);
  const evidence = await poll(
    async () => {
      const current = await readReaderEvidence(run.page);
      return current.scopeKind === scope.scopeKind &&
        Number.isFinite(current.firstVisibleMs)
        ? current
        : null;
    },
    "reader-scope-first-visible-metric",
    30_000,
  );
  const pane = evidence.panes[0];
  verify(evidence.scopeKind === scope.scopeKind, "scope-kind-mismatch", {
    expected: scope.scopeKind,
    actual: evidence.scopeKind,
  });
  verify(
    pane?.canonicalSections === scope.sections &&
      pane?.canonicalBlocks === scope.blocks,
    "scope-count-mismatch",
    {
      expectedSections: scope.sections,
      expectedBlocks: scope.blocks,
      actualSections: pane?.canonicalSections,
      actualBlocks: pane?.canonicalBlocks,
    },
  );
  verify(
    evidence.sourceStats.withSpaces === scope.withSpaces &&
      evidence.sourceStats.withoutSpaces === scope.withoutSpaces &&
      evidence.sourceStats.paragraphs === scope.paragraphs &&
      evidence.sourceStats.scenes === scope.sections &&
      evidence.sourceStats.chapters === scope.chapters,
    "scope-source-stats-mismatch",
    {
      expected: {
        withSpaces: scope.withSpaces,
        withoutSpaces: scope.withoutSpaces,
        paragraphs: scope.paragraphs,
        scenes: scope.sections,
        chapters: scope.chapters,
      },
      actual: evidence.sourceStats,
    },
  );
  return {
    scopeKind: scope.scopeKind,
    elapsedMs: roundMilliseconds(performance.now() - startedAt),
    coreCompileMs: evidence.coreCompileMs,
    ipcRoundTripMs: evidence.ipcRoundTripMs,
    validationMs: evidence.validationMs,
    firstVisibleMs: evidence.firstVisibleMs,
    canonicalSections: pane.canonicalSections,
    canonicalBlocks: pane.canonicalBlocks,
    sourceStats: evidence.sourceStats,
  };
}

async function refreshReader(run, stagePrefix) {
  const button = run.page.getByRole("button", {
    name: "미리보기 새로고침",
    exact: true,
  });
  const startedAt = performance.now();
  reportStage(`${stagePrefix}-click`);
  await button.click();
  reportStage(`${stagePrefix}-busy`);
  await poll(
    async () => {
      const status = await run.page
        .locator('section[aria-label="읽기 실험실"]')
        .getAttribute("data-reader-compile-status");
      return status === "busy" ? true : null;
    },
    "reader-refresh-busy",
    30_000,
  );
  reportStage(`${stagePrefix}-ready`);
  await waitForReaderReady(run, undefined, 120_000);
  reportStage(`${stagePrefix}-first-visible`);
  const evidence = await poll(
    async () => {
      const current = await readReaderEvidence(run.page);
      return Number.isFinite(current.firstVisibleMs) ? current : null;
    },
    "reader-first-visible-metric",
    30_000,
  );
  return {
    elapsedMs: performance.now() - startedAt,
    coreCompileMs: evidence.coreCompileMs,
    ipcRoundTripMs: evidence.ipcRoundTripMs,
    validationMs: evidence.validationMs,
    firstVisibleMs: evidence.firstVisibleMs,
  };
}

async function waitForTwoAnimationFrames(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
}

async function setPaneCount(run, paneCount) {
  const startedAt = performance.now();
  await run.page
    .getByRole("button", { name: `${paneCount} pane`, exact: true })
    .click();
  const evidence = await poll(
    async () => {
      const current = await readReaderEvidence(run.page);
      return current.paneCount === paneCount &&
        current.panes.every(
          (pane) =>
            pane.shadowReady &&
            (pane.mountedSections ?? 0) > 0 &&
            (pane.mountedBlocks ?? 0) > 0,
        )
        ? current
        : null;
    },
    `reader-${paneCount}-pane-visible`,
    60_000,
  );
  await waitForTwoAnimationFrames(run.page);
  const paintedEvidence = await readReaderEvidence(run.page);
  verify(
    paintedEvidence.paneCount === paneCount &&
      paintedEvidence.panes.every(
        (pane) => pane.shadowReady && (pane.mountedBlocks ?? 0) > 0,
      ),
    "reader-pane-paint-incomplete",
    {
      paneCount: paintedEvidence.paneCount,
      shadowReady: paintedEvidence.panes.map((pane) => pane.shadowReady),
      mountedBlocks: paintedEvidence.panes.map((pane) => pane.mountedBlocks),
    },
  );
  return {
    elapsedMs: performance.now() - startedAt,
    evidence: paintedEvidence,
  };
}

async function activatePane(run, paneIndex) {
  const tab = run.page.getByRole("tab", {
    name: new RegExp(`^${paneIndex + 1}\\.`),
    exact: false,
  });
  await tab.click();
  await poll(
    async () =>
      (await tab.getAttribute("aria-selected")) === "true" ? true : null,
    "reader-active-pane",
    30_000,
  );
}

async function choosePreset(run, paneIndex, presetId) {
  await activatePane(run, paneIndex);
  const listbox = run.page.getByRole("listbox", {
    name: "Reader preset",
    exact: true,
  });
  await listbox.selectOption(presetId);
  await poll(
    async () => ((await listbox.inputValue()) === presetId ? true : null),
    "preset-selection",
  );
}

async function measurePresetVisible(run, paneIndex, presetId, expectedWidth) {
  const startedAt = performance.now();
  await choosePreset(run, paneIndex, presetId);
  await poll(
    async () =>
      Number(
        await run.page
          .locator(`[data-reader-pane="${paneIndex + 1}"]`)
          .getAttribute("data-reader-viewport-width"),
      ) === expectedWidth
        ? true
        : null,
    "reader-preset-visible",
  );
  await waitForTwoAnimationFrames(run.page);
  await poll(
    async () => {
      const pane = (await readReaderEvidence(run.page)).panes[paneIndex];
      return pane?.shadowReady &&
        Number.isFinite(pane.paintedWidth) &&
        Number.isFinite(pane.zoom) &&
        Math.abs(pane.paintedWidth - expectedWidth * pane.zoom) <= 1
        ? true
        : null;
    },
    "reader-preset-painted",
  );
  return performance.now() - startedAt;
}

async function setNumberControl(
  run,
  label,
  value,
  paneIndex,
  attribute,
  stagePrefix = null,
) {
  if (stagePrefix) {
    reportStage(`${stagePrefix}-activate`);
  }
  await activatePane(run, paneIndex);
  const input = run.page.getByLabel(label, { exact: true });
  const startedAt = performance.now();
  if (stagePrefix) {
    reportStage(`${stagePrefix}-input`);
  }
  await input.fill(String(value));
  await input.blur();
  if (stagePrefix) {
    reportStage(`${stagePrefix}-state`);
  }
  await poll(
    async () => {
      const pane = run.page.locator(`[data-reader-pane="${paneIndex + 1}"]`);
      return Number(await pane.getAttribute(attribute)) === value ? true : null;
    },
    "reader-setting-visible",
  );
  if (stagePrefix) {
    reportStage(`${stagePrefix}-paint`);
  }
  await waitForTwoAnimationFrames(run.page);
  await poll(
    async () => {
      const pane = (await readReaderEvidence(run.page)).panes[paneIndex];
      if (!pane?.shadowReady) {
        return null;
      }
      if (attribute === "data-reader-font-size") {
        return Number.isFinite(pane.paragraphFontSize) &&
          Math.abs(pane.paragraphFontSize - value) <= 0.1
          ? true
          : null;
      }
      if (attribute === "data-reader-line-height") {
        return Number.isFinite(pane.paragraphLineHeightRatio) &&
          Math.abs(pane.paragraphLineHeightRatio - value) <= 0.03
          ? true
          : null;
      }
      if (attribute === "data-reader-zoom") {
        return Number.isFinite(pane.paintedWidth) &&
          Number.isFinite(pane.viewportWidth) &&
          Math.abs(pane.paintedWidth - pane.viewportWidth * value) <= 1
          ? true
          : null;
      }
      if (attribute === "data-reader-viewport-width") {
        return Number.isFinite(pane.paintedWidth) &&
          Number.isFinite(pane.zoom) &&
          Math.abs(pane.paintedWidth - value * pane.zoom) <= 1
          ? true
          : null;
      }
      if (attribute === "data-reader-viewport-height") {
        return Number.isFinite(pane.paintedHeight) &&
          Number.isFinite(pane.zoom) &&
          Math.abs(pane.paintedHeight - value * pane.zoom) <= 1
          ? true
          : null;
      }
      return true;
    },
    "reader-setting-painted",
  );
  return performance.now() - startedAt;
}

async function setSelectControl(
  run,
  label,
  value,
  paneIndex,
  attribute,
  stagePrefix = null,
) {
  if (stagePrefix) {
    reportStage(`${stagePrefix}-activate`);
  }
  await activatePane(run, paneIndex);
  if (stagePrefix) {
    reportStage(`${stagePrefix}-select`);
  }
  const select = run.page
    .locator(".reader-settings")
    .getByText(label, { exact: true })
    .locator("..")
    .locator("select");
  const selectCount = await select.count();
  verify(selectCount === 1, "reader-select-control-count", {
    count: selectCount,
  });
  await select.selectOption(value);
  if (stagePrefix) {
    reportStage(`${stagePrefix}-state`);
  }
  await poll(
    async () => {
      const pane = run.page.locator(`[data-reader-pane="${paneIndex + 1}"]`);
      return (await pane.getAttribute(attribute)) === value ? true : null;
    },
    "reader-select-setting-visible",
  );
  if (stagePrefix) {
    reportStage(`${stagePrefix}-paint`);
  }
  await waitForTwoAnimationFrames(run.page);
}

async function setWorkspaceNumberControl(
  run,
  label,
  value,
  attribute,
  stagePrefix = null,
) {
  const input = run.page.getByLabel(label, { exact: true });
  if (stagePrefix) {
    reportStage(`${stagePrefix}-input`);
  }
  await input.fill(String(value));
  await input.blur();
  if (stagePrefix) {
    reportStage(`${stagePrefix}-state`);
  }
  await poll(
    async () => {
      const workspace = run.page.locator('section[aria-label="읽기 실험실"]');
      return Number(await workspace.getAttribute(attribute)) === value ? true : null;
    },
    "reader-workspace-setting-visible",
  );
  if (stagePrefix) {
    reportStage(`${stagePrefix}-paint`);
  }
  await waitForTwoAnimationFrames(run.page);
  verify(run.pageErrors.length === 0, "reader-workspace-setting-page-error", {
    count: run.pageErrors.length,
  });
}

async function setDiagnosticsExpanded(run, expanded) {
  const workspace = run.page.locator('section[aria-label="읽기 실험실"]');
  const current =
    (await workspace.getAttribute("data-reader-diagnostics-expanded")) === "true";
  if (current !== expanded) {
    await workspace
      .locator('section[aria-label="Reader 검토 후보"]')
      .locator(".reader-diagnostics__toggle")
      .click();
  }
  await poll(
    async () =>
      ((await workspace.getAttribute("data-reader-diagnostics-expanded")) ===
      String(expanded)
        ? true
        : null),
    "reader-diagnostics-expanded",
  );
}

async function waitForMeasurementComplete(
  run,
  timeoutMs = 180_000,
  { requireLayoutDiagnostics = false } = {},
) {
  return poll(
    async () => {
      const evidence = await readReaderEvidence(run.page);
      return evidence.paneCount > 0 &&
        evidence.panes.every(
          (pane) =>
            pane.measurementStatus === "complete" &&
            pane.measuredSections === pane.totalSections &&
            pane.measuredBlocks === pane.canonicalBlocks,
        ) &&
        (!requireLayoutDiagnostics ||
          evidence.layoutDiagnosticsStatus === "complete")
        ? evidence
        : null;
    },
    "reader-full-scope-measurement",
    timeoutMs,
  );
}

async function readMountedBlockIds(page, paneIndex, maximum = 3) {
  return page
    .locator(`[data-testid="reader-shadow-host-${paneIndex + 1}"]`)
    .evaluate((host, limit) =>
      [...(host.shadowRoot?.querySelectorAll("[data-reader-block-id]") ?? [])]
        .slice(0, limit)
        .map((block) => block.getAttribute("data-reader-block-id"))
        .filter((id) => Boolean(id)),
    maximum);
}

async function scrollPane(run, paneIndex, progress) {
  await waitForTwoAnimationFrames(run.page);
  const startedAt = performance.now();
  await run.page
    .locator(`[data-testid="reader-shadow-host-${paneIndex + 1}"]`)
    .evaluate((host, nextProgress) => {
      const scroller = host.shadowRoot?.querySelector(".reader-scroll");
      if (!(scroller instanceof HTMLElement)) {
        throw new Error("reader-scroll-missing");
      }
      const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      scroller.scrollTop = maximum * nextProgress;
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    }, progress);
  const evidence = await poll(
    async () => {
      const current = await readReaderEvidence(run.page);
      const source = current.panes[paneIndex]?.scrollProgress;
      const actualSource = current.panes[paneIndex]?.actualScrollProgress;
      if (!Number.isFinite(source) || !Number.isFinite(actualSource)) {
        return null;
      }
      return Math.abs(source - progress) <= 0.02 &&
        Math.abs(actualSource - progress) <= 0.02 &&
        current.panes.every(
        (pane) =>
          Number.isFinite(pane.scrollProgress) &&
          Number.isFinite(pane.actualScrollProgress) &&
          Math.abs(pane.scrollProgress - source) <= 0.02 &&
          Math.abs(pane.actualScrollProgress - actualSource) <= 0.02 &&
          Math.abs(pane.actualScrollProgress - pane.scrollProgress) <= 0.02,
      )
        ? current
        : null;
    },
    "reader-scroll-sync",
    30_000,
  );
  return {
    elapsedMs: performance.now() - startedAt,
    progress: evidence.panes[paneIndex].scrollProgress,
    actualProgress: evidence.panes[paneIndex].actualScrollProgress,
  };
}

async function scrollPaneIndependent(run, paneIndex, progress) {
  await waitForTwoAnimationFrames(run.page);
  const before = await readReaderEvidence(run.page);
  verify(
    before.scrollSync === false &&
      before.panes.every(
        (pane) =>
          Number.isFinite(pane.scrollProgress) &&
          Number.isFinite(pane.actualScrollProgress),
      ),
    "reader-independent-scroll-precondition",
    {
      scrollSync: before.scrollSync,
      stateFinite: before.panes.map((pane) => Number.isFinite(pane.scrollProgress)),
      actualFinite: before.panes.map((pane) =>
        Number.isFinite(pane.actualScrollProgress),
      ),
    },
  );
  const startedAt = performance.now();
  await run.page
    .locator(`[data-testid="reader-shadow-host-${paneIndex + 1}"]`)
    .evaluate((host, nextProgress) => {
      const scroller = host.shadowRoot?.querySelector(".reader-scroll");
      if (!(scroller instanceof HTMLElement)) {
        throw new Error("reader-scroll-missing");
      }
      const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      scroller.scrollTop = maximum * nextProgress;
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    }, progress);
  const evidence = await poll(
    async () => {
      const current = await readReaderEvidence(run.page);
      const source = current.panes[paneIndex];
      if (
        !Number.isFinite(source?.scrollProgress) ||
        !Number.isFinite(source?.actualScrollProgress) ||
        Math.abs(source.scrollProgress - progress) > 0.02 ||
        Math.abs(source.actualScrollProgress - progress) > 0.02
      ) {
        return null;
      }
      return current.panes.every((pane, index) => {
        if (index === paneIndex) {
          return true;
        }
        const previous = before.panes[index];
        return (
          Number.isFinite(pane.scrollProgress) &&
          Number.isFinite(pane.actualScrollProgress) &&
          Math.abs(pane.scrollProgress - previous.scrollProgress) <= 0.02 &&
          Math.abs(
            pane.actualScrollProgress - previous.actualScrollProgress,
          ) <= 0.02
        );
      })
        ? current
        : null;
    },
    "reader-independent-scroll",
    30_000,
  );
  return {
    elapsedMs: performance.now() - startedAt,
    sourceState: evidence.panes[paneIndex].scrollProgress,
    sourceActual: evidence.panes[paneIndex].actualScrollProgress,
    otherPanesUnchanged: true,
  };
}

async function verifyKeyboardNavigation(run, paneIndex) {
  const host = run.page.locator(`[data-testid="reader-shadow-host-${paneIndex + 1}"]`);
  const initialId = await poll(
    async () =>
      host.evaluate((element) => {
        const target = element.shadowRoot?.querySelector(
          '[data-reader-block-id][tabindex="0"]',
        );
        if (!(target instanceof HTMLElement)) {
          return null;
        }
        target.focus();
        return target.getAttribute("data-reader-block-id");
      }),
    "reader-keyboard-roving-target",
    30_000,
  );
  await run.page.keyboard.press("ArrowDown");
  const afterArrow = await host.evaluate((element) => ({
    activeId:
      element.shadowRoot?.activeElement?.getAttribute("data-reader-block-id") ?? null,
    rovingCount: element.shadowRoot?.querySelectorAll(
      '[data-reader-block-id][tabindex="0"], .reader-scroll[tabindex="0"]',
    ).length ?? 0,
  }));
  await run.page.keyboard.press("End");
  const afterEnd = await host.evaluate((element) => ({
    activePresent: Boolean(
      element.shadowRoot?.activeElement?.getAttribute("data-reader-block-id"),
    ),
    rovingCount: element.shadowRoot?.querySelectorAll(
      '[data-reader-block-id][tabindex="0"], .reader-scroll[tabindex="0"]',
    ).length ?? 0,
  }));
  verify(
    initialId && afterArrow.activeId && afterArrow.activeId !== initialId,
    "reader-keyboard-arrow-failed",
    {
      initialPresent: Boolean(initialId),
      nextPresent: Boolean(afterArrow.activeId),
      changed: afterArrow.activeId !== initialId,
    },
  );
  verify(
    afterArrow.rovingCount === 1 && afterEnd.rovingCount === 1 && afterEnd.activePresent,
    "reader-keyboard-roving-failed",
    { afterArrow, afterEnd },
  );
  return {
    arrowChanged: true,
    homeEndActive: afterEnd.activePresent,
    rovingTargetCount: afterEnd.rovingCount,
  };
}

async function selectComparisonBlock(run, paneIndex, key) {
  const host = run.page.locator(
    `[data-testid="reader-shadow-host-${paneIndex + 1}"]`,
  );
  const previousId = await poll(
    async () =>
      host.evaluate((element) => {
        const target = element.shadowRoot?.querySelector(
          '[data-reader-block-id][tabindex="0"]',
        );
        if (!(target instanceof HTMLElement)) {
          return null;
        }
        target.focus();
        return target.getAttribute("data-reader-block-id");
      }),
    "reader-comparison-roving-target",
    30_000,
  );
  const startedAt = performance.now();
  await run.page.keyboard.press(key);
  const selected = await poll(
    async () =>
      run.page.locator('section[aria-label="읽기 실험실"]').evaluate((workspace) => {
        const panes = [...workspace.querySelectorAll("[data-reader-pane]")];
        const selectedId =
          panes[0]?.getAttribute("data-reader-selected-source-block-id") ?? "";
        if (!selectedId || panes.length !== 3) {
          return null;
        }
        const pressedPaneCount = panes.filter((pane) => {
          const host = pane.querySelector(".reader-shadow-host");
          const target = host?.shadowRoot?.querySelector(
            `[data-reader-block-id="${CSS.escape(selectedId)}"]`,
          );
          return (
            pane.getAttribute("data-reader-selected-source-block-id") === selectedId &&
            target?.getAttribute("aria-pressed") === "true"
          );
        }).length;
        return pressedPaneCount === panes.length
          ? { selectedId, pressedPaneCount }
          : null;
      }),
    "reader-comparison-highlight",
    30_000,
  );
  verify(selected.selectedId !== previousId, "reader-comparison-selection-unchanged", {
    previousPresent: Boolean(previousId),
    selectedPresent: Boolean(selected.selectedId),
    changed: selected.selectedId !== previousId,
  });
  return {
    elapsedMs: performance.now() - startedAt,
    selectedId: selected.selectedId,
    pressedPaneCount: selected.pressedPaneCount,
  };
}

async function selectBlockAndOpenSource(run, blockId, expectedSource) {
  const startedAt = performance.now();
  const target = run.page
    .locator('[data-testid="reader-shadow-host-1"]')
    .locator(`[data-reader-block-id="${blockId}"]`);
  verify((await target.count()) === 1, "reader-source-block-missing", {
    targetCount: await target.count(),
  });
  await target.click();
  const navigationSelection = await poll(
    async () => {
      const manuscriptPressed =
        (await run.page
          .getByRole("button", { name: "원고", exact: true })
          .getAttribute("aria-pressed")) === "true";
      const selected = await run.page
        .locator(`[data-node-id="${expectedSource.sceneNodeId}"]`)
        .getAttribute("aria-selected");
      const selection = await run.page.locator(".typie-runtime").evaluate((surface) => {
        const rawStart = surface.getAttribute("data-last-programmatic-selection-start");
        const rawEnd = surface.getAttribute("data-last-programmatic-selection-end");
        const start = rawStart === null ? Number.NaN : Number(rawStart);
        const end = rawEnd === null ? Number.NaN : Number(rawEnd);
        return {
          start: Number.isSafeInteger(start) ? start : null,
          end: Number.isSafeInteger(end) ? end : null,
        };
      }).catch(() => ({ start: null, end: null }));
      const exactMatched =
        expectedSource.start === undefined ||
        (selection.start === expectedSource.start && selection.end === expectedSource.end);
      return manuscriptPressed &&
        selected === "true" &&
        (expectedSource.start === undefined ||
          (selection.start !== null && selection.end !== null)) &&
        exactMatched
        ? selection
        : null;
    },
    "reader-source-navigation",
    30_000,
  );
  const navigationMs = performance.now() - startedAt;
  await enterReaderLab(run);
  const reopened = await poll(
    async () => {
      const evidence = await readReaderEvidence(run.page);
      const exactSelection = await run.page
        .locator('section[aria-label="읽기 실험실"]')
        .evaluate((workspace, expectedBlockId) => {
          const panes = [...workspace.querySelectorAll("[data-reader-pane]")];
          const matchedPaneCount = panes.filter((pane) => {
            const host = pane.querySelector(".reader-shadow-host");
            const targets = host?.shadowRoot?.querySelectorAll(
              `[data-reader-block-id="${CSS.escape(expectedBlockId)}"]`,
            );
            const pressed = host?.shadowRoot?.querySelectorAll(
              '[data-reader-block-id][aria-pressed="true"]',
            );
            return (
              pane.getAttribute("data-reader-selected-source-block-id") ===
                expectedBlockId &&
              targets?.length === 1 &&
              targets[0]?.getAttribute("aria-pressed") === "true" &&
              pressed?.length === 1
            );
          }).length;
          return { paneCount: panes.length, matchedPaneCount };
        }, blockId);
      return evidence.paneCount === 3 &&
        exactSelection.paneCount === 3 &&
        exactSelection.matchedPaneCount === 3
        ? evidence
        : null;
    },
    "reader-selection-after-return",
    60_000,
  );
  return {
    navigationMs,
    exactRangeMatched:
      expectedSource.start === undefined ||
      (navigationSelection.start === expectedSource.start &&
        navigationSelection.end === expectedSource.end),
    selectedPaneCount: reopened.panes.filter((pane) => pane.selectedBlockPresent)
      .length,
    visibleSelectedPaneCount: reopened.panes.filter(
      (pane) => pane.selectedVisibleCount === 1,
    ).length,
  };
}

async function exerciseDiagnosticNavigation(run, expectedSceneId) {
  await waitForMeasurementComplete(run, 120_000, {
    requireLayoutDiagnostics: true,
  });
  const section = run.page.locator('section[aria-label="Reader 검토 후보"]');
  const toggle = section.locator(".reader-diagnostics__toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  const candidates = section.locator("button:not(.reader-diagnostics__toggle)");
  const candidateCount = await candidates.count();
  verify(candidateCount > 0, "reader-diagnostic-candidate-missing", {
    candidateCount,
  });
  const first = candidates.first();
  await first.focus();
  const startedAt = performance.now();
  await run.page.keyboard.press("Enter");
  await poll(
    async () => {
      const manuscriptPressed =
        (await run.page
          .getByRole("button", { name: "원고", exact: true })
          .getAttribute("aria-pressed")) === "true";
      const selected = await run.page
        .locator(`[data-node-id="${expectedSceneId}"]`)
        .getAttribute("aria-selected");
      return manuscriptPressed && selected === "true" ? true : null;
    },
    "reader-diagnostic-source-navigation",
    30_000,
  );
  const navigationMs = performance.now() - startedAt;
  await enterReaderLab(run);
  const restored = await readReaderEvidence(run.page);
  verify(
    restored.paneCount === 3 &&
      restored.panes.every((pane) => pane.selectedBlockPresent),
    "reader-diagnostic-selection-restore",
    {
      paneCount: restored.paneCount,
      selected: restored.panes.map((pane) => pane.selectedBlockPresent),
    },
  );
  return {
    candidateCount,
    keyboardActivated: true,
    navigationMs: roundMilliseconds(navigationMs),
    selectedPaneCount: restored.panes.filter((pane) => pane.selectedBlockPresent)
      .length,
  };
}

async function createCustomPreset(run, paneIndex, fontSize) {
  await activatePane(run, paneIndex);
  await run.page.getByLabel("preset 이름", { exact: true }).fill(customPresetName);
  await setNumberControl(
    run,
    "글자 크기",
    fontSize,
    paneIndex,
    "data-reader-font-size",
  );
  const listbox = run.page.getByRole("listbox", {
    name: "Reader preset",
    exact: true,
  });
  const previousCount = await listbox.locator("option").count();
  await run.page
    .getByRole("button", { name: "새 preset 저장", exact: true })
    .click();
  const presetId = await poll(
    async () => {
      const value = await listbox.inputValue();
      const count = await listbox.locator("option").count();
      return !value.startsWith("builtin:") && count === previousCount + 1
        ? value
        : null;
    },
    "reader-custom-preset-create",
  );
  return { presetId, optionCount: previousCount + 1, fontSize };
}

async function exercisePresetCrud(run, paneIndex) {
  const created = await createCustomPreset(run, paneIndex, 20);
  const listbox = run.page.getByRole("listbox", {
    name: "Reader preset",
    exact: true,
  });
  await run.page.getByRole("button", { name: "복제", exact: true }).click();
  const duplicateId = await poll(
    async () => {
      const value = await listbox.inputValue();
      const count = await listbox.locator("option").count();
      return value !== created.presetId &&
        !value.startsWith("builtin:") &&
        count === created.optionCount + 1
        ? value
        : null;
    },
    "reader-preset-duplicate",
  );
  await run.page.getByLabel("preset 이름", { exact: true }).fill(updatedPresetName);
  await setNumberControl(
    run,
    "줄간격",
    2.1,
    paneIndex,
    "data-reader-line-height",
  );
  await run.page
    .getByRole("button", { name: "변경 저장", exact: true })
    .click();
  await poll(
    async () =>
      (await run.page.getByText("저장하지 않은 사용자 변경", { exact: true }).count()) === 0
        ? true
        : null,
    "reader-preset-update",
  );
  await run.page.getByRole("button", { name: "삭제", exact: true }).click();
  await poll(
    async () => {
      const values = await listbox.locator("option").evaluateAll((options) =>
        options.map((option) => option.value),
      );
      return !values.includes(duplicateId) && values.includes(created.presetId)
        ? true
        : null;
    },
    "reader-preset-delete",
  );
  await choosePreset(run, paneIndex, created.presetId);
  return {
    customPresetId: created.presetId,
    created: true,
    duplicated: true,
    updated: true,
    deleted: true,
    remainingStoredPresetCount:
      (await listbox.locator("option").count()) - 11,
    snapshotFontSize: created.fontSize,
  };
}

async function openSnapshotPanel(run, stagePrefix = null) {
  if (stagePrefix) {
    reportStage(`${stagePrefix}-click-snapshot`);
  }
  await run.page.getByRole("button", { name: "Snapshot", exact: true }).click();
  if (stagePrefix) {
    reportStage(`${stagePrefix}-panel-visible`);
  }
  await run.page
    .getByRole("complementary", { name: "Named snapshot", exact: true })
    .waitFor({ timeout: 30_000 });
}

async function closeGlobalPanel(run) {
  await run.page.getByRole("button", { name: "개발 패널", exact: true }).click();
  await poll(
    async () =>
      (await run.page
        .getByRole("complementary", { name: "Named snapshot", exact: true })
        .count()) === 0
        ? true
        : null,
    "snapshot-panel-close",
  );
}

async function createReaderSnapshot(run) {
  reportStage("normal-snapshot-create-reader-ready");
  await waitForTwoAnimationFrames(run.page);
  let stableKey = "";
  let stableObservationCount = 0;
  await poll(
    async () => {
      const workspace = run.page.locator('section[aria-label="읽기 실험실"]');
      const status = await workspace.getAttribute("data-reader-compile-status");
      const revision = await workspace.getAttribute("data-reader-project-revision");
      const scopeKind = await workspace.getAttribute("data-reader-scope-kind");
      const readerBusy = await workspace.getAttribute("aria-busy");
      const refreshEnabled = await run.page
        .getByRole("button", { name: "미리보기 새로고침", exact: true })
        .isEnabled();
      const paneCount = await workspace.locator("[data-reader-pane]").count();
      if (
        status !== "ready" ||
        !revision ||
        !scopeKind ||
        readerBusy === "true" ||
        !refreshEnabled ||
        paneCount === 0
      ) {
        stableKey = "";
        stableObservationCount = 0;
        return null;
      }
      const nextKey = `${revision}:${scopeKind}:${paneCount}`;
      if (nextKey === stableKey) {
        stableObservationCount += 1;
      } else {
        stableKey = nextKey;
        stableObservationCount = 1;
      }
      return stableObservationCount >= 4 ? true : null;
    },
    "reader-stable-before-snapshot",
    120_000,
  );
  reportStage("normal-snapshot-create-panel-open");
  await openSnapshotPanel(run);
  const panel = run.page.getByRole("complementary", {
    name: "Named snapshot",
    exact: true,
  });
  const existingIds = await panel
    .locator("[data-snapshot-id]")
    .evaluateAll((items) => items.map((item) => item.getAttribute("data-snapshot-id")));
  await panel.getByLabel("이름", { exact: true }).fill(snapshotName);
  await panel
    .getByRole("button", { name: "현재 프로젝트 snapshot 생성", exact: true })
    .click();
  const created = await poll(
    async () => {
      const items = await panel.locator("[data-snapshot-id]").evaluateAll((nodes) =>
        nodes.map((node) => ({
          id: node.getAttribute("data-snapshot-id"),
          payloadVersion: Number(
            node.getAttribute("data-snapshot-payload-version"),
          ),
        })),
      );
      return items.find(
        (item) =>
          item.id &&
          !existingIds.includes(item.id) &&
          Number.isSafeInteger(item.payloadVersion),
      ) ?? null;
    },
    "reader-snapshot-create",
    60_000,
  );
  await closeGlobalPanel(run);
  verify(created.payloadVersion === 5, "reader-snapshot-payload-version", {
    observed: created.payloadVersion,
  });
  return {
    snapshotId: created.id,
    payloadVersion: created.payloadVersion,
    previousCount: existingIds.length,
  };
}

async function restoreReaderSnapshot(
  run,
  snapshotId,
  customPresetId,
  paneIndex,
  expectedFontSize,
  previousCount,
) {
  await openSnapshotPanel(run, "normal-snapshot-restore");
  const panel = run.page.getByRole("complementary", {
    name: "Named snapshot",
    exact: true,
  });
  reportStage("normal-snapshot-restore-target-item");
  const item = panel.locator(`[data-snapshot-id="${snapshotId}"]`);
  const observedPayloadVersion = Number(
    await item.getAttribute("data-snapshot-payload-version"),
  );
  verify(observedPayloadVersion === 5, "reader-restore-payload-version", {
    observed: observedPayloadVersion,
  });
  reportStage("normal-snapshot-restore-click-restore");
  await item.getByRole("button", { name: / 복원$/u }).click();
  const dialog = run.page.getByRole("alertdialog");
  reportStage("normal-snapshot-restore-dialog-visible");
  await dialog.waitFor({ timeout: 30_000 });
  reportStage("normal-snapshot-restore-read-diff");
  const readerPresetDiff = await dialog.locator("dl").evaluate((list) => {
    const row = [...list.querySelectorAll("div")].find(
      (candidate) => candidate.querySelector("dt")?.textContent?.trim() === "Reader preset",
    );
    const numbers = row?.querySelector("dd")?.textContent?.match(/\d+/gu) ?? [];
    return numbers.slice(0, 3).map(Number);
  });
  verify(
    readerPresetDiff.length === 3 &&
      readerPresetDiff[0] === 0 &&
      readerPresetDiff[1] === 0 &&
      readerPresetDiff[2] === 1,
    "reader-snapshot-diff-mismatch",
    { counts: readerPresetDiff },
  );
  reportStage("normal-snapshot-restore-confirm");
  await dialog
    .getByRole("button", { name: "안전 snapshot 생성 후 복원", exact: true })
    .click();
  reportStage("normal-snapshot-restore-dialog-detached");
  await dialog.waitFor({ state: "detached", timeout: 90_000 });
  reportStage("normal-snapshot-restore-safety-count");
  await poll(
    async () =>
      (await panel.locator("[data-snapshot-id]").count()) === previousCount + 2
        ? true
        : null,
    "reader-snapshot-safety-count",
    60_000,
  );
  await closeGlobalPanel(run);
  reportStage("normal-snapshot-restore-reader-ready");
  await waitForReaderReady(run, undefined, 120_000);
  reportStage("normal-snapshot-restore-preset-select");
  await choosePreset(run, paneIndex, customPresetId);
  reportStage("normal-snapshot-restore-font-check");
  const restoredFontSize = Number(
    await run.page
      .locator(`[data-reader-pane="${paneIndex + 1}"]`)
      .getAttribute("data-reader-font-size"),
  );
  verify(restoredFontSize === expectedFontSize, "reader-snapshot-preset-restore", {
    expectedFontSize,
    restoredFontSize,
  });
  return {
    payloadVersion: observedPayloadVersion,
    readerPresetDiff: {
      added: readerPresetDiff[0],
      deleted: readerPresetDiff[1],
      changed: readerPresetDiff[2],
    },
    safetySnapshotCreated: true,
    restoredFontSize,
  };
}

async function readPresetSelections(run) {
  const values = [];
  for (let index = 0; index < 3; index += 1) {
    await activatePane(run, index);
    values.push(
      await run.page
        .getByRole("listbox", { name: "Reader preset", exact: true })
        .inputValue(),
    );
  }
  return values;
}

async function readFirstSectionBlockIds(page, maximum = 4) {
  return page.locator('[data-testid="reader-shadow-host-1"]').evaluate(
    (host, limit) =>
      [...(host.shadowRoot?.querySelector(".reader-section")?.querySelectorAll(
        '[data-reader-block-id][data-reader-source-range="exact"]',
      ) ?? [])]
        .slice(0, limit)
        .map((block) => block.getAttribute("data-reader-block-id"))
        .filter((id) => Boolean(id)),
    maximum,
  );
}

function securityEvidence(run) {
  const externalUrls = run.requestedUrls.filter(
    (url) => url !== run.localFileProbeUrl && !isLocalRuntimeUrl(url),
  );
  const externalWebSockets = run.websocketUrls.filter(
    (url) => !isAllowedRuntimeWebSocket(url, run.page.url()),
  );
  return {
    runtime: run.runtime,
    requestCount: run.requestedUrls.length,
    externalRequestCount: externalUrls.length,
    externalRequests: externalUrls.map(redactExternalUrl),
    externalWebSocketCount: externalWebSockets.length,
    externalWebSockets: externalWebSockets.map(redactExternalUrl),
    localFileBlocked: !run.localFileProbe.readable,
    localFileStatus: run.localFileProbe.status,
    pageErrors: [...run.pageErrors],
    rendererDiagnostics: [...run.rendererDiagnostics],
    dialogs: [...run.dialogEvidence],
  };
}

function assertSecurity(evidence) {
  verify(evidence.externalRequestCount === 0, "reader-external-runtime-request", {
    count: evidence.externalRequestCount,
    requests: evidence.externalRequests,
  });
  verify(evidence.externalWebSocketCount === 0, "reader-external-runtime-websocket", {
    count: evidence.externalWebSocketCount,
    sockets: evidence.externalWebSockets,
  });
  verify(evidence.localFileBlocked, "reader-local-file-readable", {
    status: evidence.localFileStatus,
  });
  verify(evidence.pageErrors.length === 0, "reader-page-errors", {
    count: evidence.pageErrors.length,
    errors: evidence.pageErrors,
  });
  verify(evidence.rendererDiagnostics.length === 0, "reader-renderer-diagnostics", {
    count: evidence.rendererDiagnostics.length,
    diagnostics: evidence.rendererDiagnostics,
  });
  verify(
    evidence.runtime.isPackaged === packaged,
    "reader-runtime-package-mode",
    { expected: packaged, actual: evidence.runtime.isPackaged },
  );
  verify(
    evidence.runtime.rendererProtocol === "madi:",
    "reader-runtime-renderer-protocol",
    { protocol: evidence.runtime.rendererProtocol },
  );
  verify(
    evidence.runtime.packagedOverrideCanary === packaged,
    "reader-runtime-packaged-override-canary",
    {
      expected: packaged,
      actual: evidence.runtime.packagedOverrideCanary,
    },
  );
}

async function readFailureContext() {
  const run = diagnosticRun;
  if (!run || run.page.isClosed()) {
    return { rendererAvailable: false };
  }
  const reader = await readReaderEvidence(run.page).catch(() => null);
  const shell = await run.page.locator("body").evaluate((body) => {
    const buttons = [...body.querySelectorAll("button")];
    const countButtons = (label) =>
      buttons.filter((button) => button.textContent?.trim() === label);
    const restoreButtons = countButtons("복원");
    const confirmButtons = countButtons("안전 snapshot 생성 후 복원");
    const refreshButtons = countButtons("미리보기 새로고침");
    const refreshButton = refreshButtons[0] ?? null;
    const refreshRect = refreshButton?.getBoundingClientRect() ?? null;
    const refreshStyle = refreshButton
      ? globalThis.getComputedStyle(refreshButton)
      : null;
    const refreshCenter =
      refreshRect && refreshRect.width > 0 && refreshRect.height > 0
        ? {
            x: refreshRect.left + refreshRect.width / 2,
            y: refreshRect.top + refreshRect.height / 2,
          }
        : null;
    const refreshHitTarget = refreshCenter
      ? document.elementFromPoint(refreshCenter.x, refreshCenter.y)
      : null;
    const refreshHitZone = !refreshHitTarget
      ? "NONE"
      : refreshButton === refreshHitTarget || refreshButton?.contains(refreshHitTarget)
        ? "TARGET"
        : refreshHitTarget.closest(".reader-preview-toolbar")
          ? "TOOLBAR_SIBLING"
          : refreshHitTarget.closest(".reader-error")
            ? "READER_ERROR"
            : refreshHitTarget.closest(".reader-save-blocked")
              ? "SAVE_BLOCKED"
              : refreshHitTarget.closest(".reader-loading")
                ? "READER_LOADING"
                : refreshHitTarget.closest(".reader-pane-tabs")
                  ? "PANE_TABS"
                  : refreshHitTarget.closest(".reader-settings")
                    ? "READER_SETTINGS"
                    : refreshHitTarget.closest(".reader-scope-presets")
                      ? "SCOPE_PRESETS"
                      : refreshHitTarget.closest(".reader-lab")
                        ? "READER_OTHER"
                        : refreshHitTarget.closest(".toolbar")
                          ? "APP_TOOLBAR"
                          : refreshHitTarget.closest(".titlebar")
                            ? "TITLEBAR"
                            : "OTHER";
    const refreshHitTag = refreshHitTarget?.tagName ?? "";
    const allowedRefreshHitTags = new Set([
      "",
      "BUTTON",
      "DIV",
      "HEADER",
      "INPUT",
      "LABEL",
      "MAIN",
      "P",
      "SECTION",
      "SPAN",
    ]);
    return {
      savePhase:
        body
          .querySelector('[data-testid="save-status"]')
          ?.getAttribute("data-phase") ?? "missing",
      readerRegionCount: body.querySelectorAll(
        'section[aria-label="읽기 실험실"]',
      ).length,
      pressedModeCount: body.querySelectorAll(
        '.mode-switch button[aria-pressed="true"]',
      ).length,
      alertCount: body.querySelectorAll('[role="alert"]').length,
      snapshotPanelCount: body.querySelectorAll(
        '[role="complementary"][aria-label="Named snapshot"]',
      ).length,
      snapshotItemCount: body.querySelectorAll("[data-snapshot-id]").length,
      alertDialogCount: body.querySelectorAll('[role="alertdialog"]').length,
      restoreButtonCount: restoreButtons.length,
      restoreButtonEnabledCount: restoreButtons.filter(
        (button) => !button.disabled,
      ).length,
      confirmButtonCount: confirmButtons.length,
      confirmButtonEnabledCount: confirmButtons.filter(
        (button) => !button.disabled,
      ).length,
      activeReaderPaneIndexes: [
        ...body.querySelectorAll('[data-reader-pane-tab][aria-selected="true"]'),
      ]
        .map((tab) => Number(tab.getAttribute("data-reader-pane-tab")))
        .filter((index) => Number.isSafeInteger(index)),
      readerSettingsSelectCount: body.querySelectorAll(
        ".reader-settings select",
      ).length,
      readerSettingsNumberInputCount: body.querySelectorAll(
        '.reader-settings input[type="number"]',
      ).length,
      readerSettingsDisabledControlCount: [
        ...body.querySelectorAll(".reader-settings select, .reader-settings input"),
      ].filter((control) => control.disabled).length,
      readerAriaBusy:
        body
          .querySelector('section[aria-label="읽기 실험실"]')
          ?.getAttribute("aria-busy") === "true",
      readerSaveBlockedCount: body.querySelectorAll(".reader-save-blocked").length,
      readerErrorCount: body.querySelectorAll(".reader-error").length,
      readerLoadingCount: body.querySelectorAll(".reader-loading").length,
      refreshButton: {
        count: refreshButtons.length,
        enabled: refreshButton ? !refreshButton.disabled : false,
        displayed: refreshStyle ? refreshStyle.display !== "none" : false,
        visible: refreshStyle ? refreshStyle.visibility === "visible" : false,
        pointerEventsEnabled: refreshStyle
          ? refreshStyle.pointerEvents !== "none"
          : false,
        finiteBox: refreshRect
          ? [
              refreshRect.left,
              refreshRect.top,
              refreshRect.width,
              refreshRect.height,
            ].every(Number.isFinite)
          : false,
        positiveBox: refreshRect
          ? refreshRect.width > 0 && refreshRect.height > 0
          : false,
        intersectsViewport: refreshRect
          ? refreshRect.right > 0 &&
            refreshRect.bottom > 0 &&
            refreshRect.left < globalThis.innerWidth &&
            refreshRect.top < globalThis.innerHeight
          : false,
        hitTargetOrDescendant:
          refreshButton !== null &&
          refreshHitTarget !== null &&
          (refreshButton === refreshHitTarget ||
            refreshButton.contains(refreshHitTarget)),
        hitZone: refreshHitZone,
        hitTag: allowedRefreshHitTags.has(refreshHitTag)
          ? refreshHitTag
          : "OTHER",
        hitTargetDisabled:
          refreshHitTarget instanceof HTMLButtonElement ||
          refreshHitTarget instanceof HTMLInputElement
            ? refreshHitTarget.disabled
            : false,
      },
    };
  });
  return {
    rendererAvailable: true,
    shell,
    reader,
    pageErrorCount: run.pageErrors.length,
    pageErrors: [...run.pageErrors],
    rendererDiagnosticCount: run.rendererDiagnostics.length,
    rendererDiagnostics: [...run.rendererDiagnostics],
    externalRequestCount: run.requestedUrls.filter(
      (url) => url !== run.localFileProbeUrl && !isLocalRuntimeUrl(url),
    ).length,
    externalWebSocketCount: run.websocketUrls.filter(
      (url) => !isAllowedRuntimeWebSocket(url, run.page.url()),
    ).length,
  };
}

async function runNormalScenario({ fixture, projectPath, userDataPath }) {
  let firstRun;
  let secondRun;
  try {
    reportStage("normal-launch");
    firstRun = await launchApplication({ projectPath, userDataPath });
    diagnosticRun = firstRun;
    await openProject(firstRun);
    const memoryBefore = sampleApplicationMemory(firstRun.application);
    reportStage("normal-reader-enter");
    await enterReaderLab(firstRun);
    const scopeResults = [];
    for (const kind of ["CHAPTER", "SCENE", "VOLUME", "WORK"]) {
      reportStage(`normal-scope-${kind.toLocaleLowerCase()}`);
      scopeResults.push(await selectScope(firstRun, fixture.scopes[kind]));
    }

    reportStage("normal-compile-five");
    const compileSamples = [];
    const coreCompileSamples = [];
    const ipcSamples = [];
    const validationSamples = [];
    const firstVisibleSamples = [];
    for (let index = 0; index < expensiveMeasurementRuns; index += 1) {
      const sample = await refreshReader(firstRun, `normal-refresh-${index + 1}`);
      compileSamples.push(sample.elapsedMs);
      coreCompileSamples.push(sample.coreCompileMs);
      ipcSamples.push(sample.ipcRoundTripMs);
      validationSamples.push(sample.validationMs);
      firstVisibleSamples.push(sample.firstVisibleMs);
    }

    reportStage("normal-three-pane-five");
    const twoPane = await setPaneCount(firstRun, 2);
    verify(twoPane.evidence.paneCount === 2, "reader-two-pane-actual");
    const threePaneSamples = [];
    for (let index = 0; index < expensiveMeasurementRuns; index += 1) {
      await setPaneCount(firstRun, 1);
      const sample = await setPaneCount(firstRun, 3);
      threePaneSamples.push(sample.elapsedMs);
    }
    reportStage("normal-preset-visible-five");
    const presetVisibleSamples = [];
    for (let index = 0; index < expensiveMeasurementRuns; index += 1) {
      presetVisibleSamples.push(
        await measurePresetVisible(
          firstRun,
          0,
          index % 2 === 0
            ? "builtin:generic-desktop"
            : "builtin:generic-small-phone",
          index % 2 === 0 ? 960 : 360,
        ),
      );
    }
    await choosePreset(firstRun, 0, "builtin:generic-small-phone");
    await choosePreset(firstRun, 1, "builtin:generic-tablet");
    await choosePreset(firstRun, 2, "builtin:munpia-like-desktop");
    reportStage("normal-full-measurement");
    const normalMeasurementStartedAt = performance.now();
    await setNumberControl(
      firstRun,
      "줄간격",
      1.91,
      2,
      "data-reader-line-height",
    );
    const configuredPanes = await waitForMeasurementComplete(firstRun, 120_000, {
      requireLayoutDiagnostics: true,
    });
    const diagnosticsMeasurementMs =
      performance.now() - normalMeasurementStartedAt;
    verify(
      configuredPanes.diagnosticMeasurementStatus === "COMPLETE" &&
        (configuredPanes.diagnosticCount ?? 0) > 0,
      "reader-normal-diagnostics-incomplete",
      {
        status: configuredPanes.diagnosticMeasurementStatus,
        count: configuredPanes.diagnosticCount,
      },
    );
    verify(
      configuredPanes.panes.every(
        (pane) => pane.externalElementCount === 0 && pane.rovingTargetCount === 1,
      ),
      "reader-pane-isolation-or-roving",
      {
        externalCounts: configuredPanes.panes.map((pane) => pane.externalElementCount),
        rovingCounts: configuredPanes.panes.map((pane) => pane.rovingTargetCount),
      },
    );

    reportStage("normal-setting-five");
    const settingSamples = [];
    for (let index = 0; index < expensiveMeasurementRuns; index += 1) {
      settingSamples.push(
        await setNumberControl(
          firstRun,
          "글자 크기",
          index % 2 === 0 ? 19 : 18,
          1,
          "data-reader-font-size",
        ),
      );
    }
    await setNumberControl(
      firstRun,
      "줄간격",
      1.95,
      1,
      "data-reader-line-height",
    );

    reportStage("normal-source-selection-five");
    const mountedExactIds = await readFirstSectionBlockIds(firstRun.page, 4);
    const firstBody = fixture.scopes.WORK.firstBody;
    const firstSectionIds = [
      firstBody.id,
      ...mountedExactIds.filter((id) => id !== firstBody.id),
    ];
    verify(
      firstBody.rangeVerified === true &&
        Number.isSafeInteger(firstBody.start) &&
        Number.isSafeInteger(firstBody.end) &&
        firstBody.start <= firstBody.end &&
        firstSectionIds.length >= 2,
      "reader-first-section-blocks",
      {
        count: firstSectionIds.length,
        firstBodyRangeVerified: firstBody.rangeVerified,
      },
    );
    verify(mountedExactIds.includes(firstBody.id), "reader-first-body-mounted", {
      matched: mountedExactIds.includes(firstBody.id),
    });
    const sourceSelectionSamples = [];
    const sourceNavigationSamples = [];
    for (let index = 0; index < expensiveMeasurementRuns; index += 1) {
      reportStage(`normal-source-${index + 1}-comparison`);
      const comparison = await selectComparisonBlock(
        firstRun,
        0,
        index % 2 === 0 ? "ArrowDown" : "ArrowUp",
      );
      verify(
        comparison.pressedPaneCount === 3,
        "reader-comparison-highlight-pane-count",
        { pressedPaneCount: comparison.pressedPaneCount },
      );
      reportStage(`normal-source-${index + 1}-navigation`);
      const navigationBlockId =
        index === 0 ? firstBody.id : comparison.selectedId;
      const selected = await selectBlockAndOpenSource(
        firstRun,
        navigationBlockId,
        index === 0
          ? {
              sceneNodeId: firstBody.sceneNodeId,
              start: firstBody.start,
              end: firstBody.end,
              rangeVerified: firstBody.rangeVerified,
            }
          : { sceneNodeId: fixture.ids.sceneId },
      );
      verify(selected.exactRangeMatched, "reader-source-range-mismatch");
      verify(
        selected.visibleSelectedPaneCount === 3,
        "reader-source-return-highlight-pane-count",
        { visibleSelectedPaneCount: selected.visibleSelectedPaneCount },
      );
      sourceSelectionSamples.push(comparison.elapsedMs);
      sourceNavigationSamples.push(selected.navigationMs);
      reportStage(`normal-source-${index + 1}-validated`);
    }
    const keyboard = await verifyKeyboardNavigation(firstRun, 0);

    reportStage("normal-diagnostic-navigation");
    const diagnosticNavigation = await exerciseDiagnosticNavigation(
      firstRun,
      fixture.ids.sceneId,
    );

    reportStage("normal-scroll-five");
    const sync = firstRun.page.getByLabel("scroll sync", { exact: true });
    await sync.uncheck();
    const independentScroll = await scrollPaneIndependent(firstRun, 0, 0.2);
    await sync.check();
    const scrollSamples = [];
    for (const progress of [0.15, 0.3, 0.45, 0.6, 0.35]) {
      const sample = await scrollPane(firstRun, 0, progress);
      scrollSamples.push(sample.elapsedMs);
    }
    const synced = await readReaderEvidence(firstRun.page);
    verify(
      synced.panes.every(
        (pane) =>
          Number.isFinite(pane.actualScrollProgress) &&
          Math.abs(pane.scrollProgress - synced.panes[0].scrollProgress) <= 0.02 &&
          Math.abs(
            pane.actualScrollProgress - synced.panes[0].actualScrollProgress,
          ) <= 0.02 &&
          Math.abs(pane.actualScrollProgress - pane.scrollProgress) <= 0.02,
      ),
      "reader-scroll-sync-final",
      {
        stateProgress: synced.panes.map((pane) => pane.scrollProgress),
        actualProgress: synced.panes.map((pane) => pane.actualScrollProgress),
      },
    );

    reportStage("normal-preset-crud");
    const presetCrud = await exercisePresetCrud(firstRun, 2);
    reportStage("normal-snapshot-create");
    const snapshot = await createReaderSnapshot(firstRun);
    await choosePreset(firstRun, 2, presetCrud.customPresetId);
    await setNumberControl(
      firstRun,
      "글자 크기",
      23,
      2,
      "data-reader-font-size",
    );
    await firstRun.page
      .getByRole("button", { name: "변경 저장", exact: true })
      .click();
    await poll(
      async () =>
        (await firstRun.page
          .getByText("저장하지 않은 사용자 변경", { exact: true })
          .count()) === 0
          ? true
          : null,
      "reader-preset-mutation-save",
    );
    reportStage("normal-snapshot-restore");
    const snapshotRestore = await restoreReaderSnapshot(
      firstRun,
      snapshot.snapshotId,
      presetCrud.customPresetId,
      2,
      presetCrud.snapshotFontSize,
      snapshot.previousCount,
    );

    reportStage("normal-state-prepare-scope");
    await selectScope(firstRun, fixture.scopes.WORK);
    reportStage("normal-state-prepare-pane-count");
    await setPaneCount(firstRun, 3);
    reportStage("normal-state-prepare-presets");
    await choosePreset(firstRun, 0, "builtin:generic-small-phone");
    await choosePreset(firstRun, 1, "builtin:generic-tablet");
    await choosePreset(firstRun, 2, presetCrud.customPresetId);
    reportStage("normal-state-prepare-sync");
    await sync.check();
    reportStage("normal-state-prepare-pane-one");
    await setSelectControl(
      firstRun,
      "분류",
      "TABLET",
      0,
      "data-reader-device-category",
      "normal-state-prepare-pane-one-category",
    );
    await setNumberControl(
      firstRun,
      "viewport 너비",
      412,
      0,
      "data-reader-viewport-width",
      "normal-state-prepare-pane-one-width",
    );
    await setNumberControl(
      firstRun,
      "viewport 높이",
      780,
      0,
      "data-reader-viewport-height",
      "normal-state-prepare-pane-one-height",
    );
    await setSelectControl(
      firstRun,
      "글꼴 token",
      "KOREAN_SERIF",
      0,
      "data-reader-font-token",
      "normal-state-prepare-pane-one-font",
    );
    await setNumberControl(
      firstRun,
      "글자 크기",
      20,
      0,
      "data-reader-font-size",
      "normal-state-prepare-pane-one-font-size",
    );
    await setNumberControl(
      firstRun,
      "줄간격",
      1.65,
      0,
      "data-reader-line-height",
      "normal-state-prepare-pane-one-line-height",
    );
    await setSelectControl(
      firstRun,
      "장면 구분",
      "RULE",
      0,
      "data-reader-scene-break-style",
      "normal-state-prepare-pane-one-break",
    );
    reportStage("normal-state-prepare-pane-two");
    await setNumberControl(
      firstRun,
      "viewport 너비",
      812,
      1,
      "data-reader-viewport-width",
      "normal-state-prepare-pane-two-width",
    );
    await setSelectControl(
      firstRun,
      "글꼴 token",
      "SYSTEM_SERIF",
      1,
      "data-reader-font-token",
      "normal-state-prepare-pane-two-font",
    );
    await setNumberControl(
      firstRun,
      "글자 크기",
      19,
      1,
      "data-reader-font-size",
      "normal-state-prepare-pane-two-font-size",
    );
    await setSelectControl(
      firstRun,
      "장면 구분",
      "SPACE",
      1,
      "data-reader-scene-break-style",
      "normal-state-prepare-pane-two-break",
    );
    reportStage("normal-state-prepare-pane-three");
    await setNumberControl(
      firstRun,
      "viewport 너비",
      1000,
      2,
      "data-reader-viewport-width",
      "normal-state-prepare-pane-three-width",
    );
    await setSelectControl(
      firstRun,
      "글꼴 token",
      "SYSTEM_SANS",
      2,
      "data-reader-font-token",
      "normal-state-prepare-pane-three-font",
    );
    await setSelectControl(
      firstRun,
      "장면 구분",
      "HIDDEN",
      2,
      "data-reader-scene-break-style",
      "normal-state-prepare-pane-three-break",
    );
    reportStage("normal-state-prepare-zooms");
    await setNumberControl(
      firstRun,
      "미리보기 zoom",
      1.1,
      0,
      "data-reader-zoom",
      "normal-state-prepare-pane-one-zoom",
    );
    await setNumberControl(
      firstRun,
      "미리보기 zoom",
      0.95,
      1,
      "data-reader-zoom",
      "normal-state-prepare-pane-two-zoom",
    );
    await setNumberControl(
      firstRun,
      "미리보기 zoom",
      1.15,
      2,
      "data-reader-zoom",
      "normal-state-prepare-pane-three-zoom",
    );
    reportStage("normal-state-prepare-panels");
    await setWorkspaceNumberControl(
      firstRun,
      "왼쪽 panel 폭",
      333,
      "data-reader-left-panel-width",
      "normal-state-prepare-left-panel",
    );
    await setWorkspaceNumberControl(
      firstRun,
      "오른쪽 panel 폭",
      444,
      "data-reader-right-panel-width",
      "normal-state-prepare-right-panel",
    );
    reportStage("normal-state-prepare-diagnostics");
    await setDiagnosticsExpanded(firstRun, false);
    reportStage("normal-state-prepare-independent-scrolls");
    await sync.uncheck();
    const savedScrollTargets = [0.2, 0.45, 0.7];
    for (let paneIndex = 0; paneIndex < savedScrollTargets.length; paneIndex += 1) {
      await scrollPaneIndependent(
        firstRun,
        paneIndex,
        savedScrollTargets[paneIndex],
      );
    }
    reportStage("normal-state-prepare-identity");
    const expectedPresetSelections = await readPresetSelections(firstRun);
    const beforeClose = await readReaderEvidence(firstRun.page);
    const beforeCloseIdentity = await readReaderIdentity(firstRun.page);
    verify(
      beforeCloseIdentity.panes.length === 3 &&
        JSON.stringify(beforeCloseIdentity.panes.map((pane) => pane.presetId)) ===
          JSON.stringify(expectedPresetSelections) &&
        beforeCloseIdentity.scrollSync === false &&
        beforeCloseIdentity.leftPanelWidth === 333 &&
        beforeCloseIdentity.rightPanelWidth === 444 &&
        beforeCloseIdentity.diagnosticsExpanded === false &&
        beforeCloseIdentity.panes.every(
          (pane, paneIndex) =>
            pane.selectedBlockId.length > 0 &&
            Number.isFinite(pane.zoom) &&
            Number.isFinite(pane.scrollProgress) &&
            Number.isFinite(pane.actualScrollProgress) &&
            Math.abs(
              pane.scrollProgress - savedScrollTargets[paneIndex],
            ) <= 0.02 &&
            Math.abs(
              pane.actualScrollProgress - savedScrollTargets[paneIndex],
            ) <= 0.02 &&
            Math.abs(pane.actualScrollProgress - pane.scrollProgress) <= 0.02,
        ),
      "reader-before-close-identity",
      {
        paneCount: beforeCloseIdentity.panes.length,
        presetIdsMatched:
          JSON.stringify(beforeCloseIdentity.panes.map((pane) => pane.presetId)) ===
          JSON.stringify(expectedPresetSelections),
        scrollSync: beforeCloseIdentity.scrollSync,
        panelWidths: [
          beforeCloseIdentity.leftPanelWidth,
          beforeCloseIdentity.rightPanelWidth,
        ],
        diagnosticsExpanded: beforeCloseIdentity.diagnosticsExpanded,
        zooms: beforeCloseIdentity.panes.map((pane) => pane.zoom),
        selectedPresent: beforeCloseIdentity.panes.map(
          (pane) => pane.selectedBlockId.length > 0,
        ),
        progressFinite: beforeCloseIdentity.panes.map((pane) =>
          Number.isFinite(pane.scrollProgress) &&
          Number.isFinite(pane.actualScrollProgress),
        ),
        progressTargetsMatched: beforeCloseIdentity.panes.map(
          (pane, paneIndex) =>
            Math.abs(
              pane.scrollProgress - savedScrollTargets[paneIndex],
            ) <= 0.02 &&
            Math.abs(
              pane.actualScrollProgress - savedScrollTargets[paneIndex],
            ) <= 0.02,
        ),
      },
    );
    await mkdir(artifactDirectory, { recursive: true });
    await firstRun.page.screenshot({ path: normalScreenshotPath, fullPage: true });
    const memoryAfter = sampleApplicationMemory(firstRun.application);
    const firstSecurity = securityEvidence(firstRun);
    assertSecurity(firstSecurity);
    reportStage("normal-close");
    await closeWindowCleanly(firstRun);
    firstRun = undefined;

    reportStage("normal-reopen");
    const reopenStartedAt = performance.now();
    secondRun = await launchApplication({ projectPath, userDataPath });
    diagnosticRun = secondRun;
    await openProject(secondRun);
    await enterReaderLab(secondRun);
    const reopenedState = await poll(
      async () => {
        const evidence = await readReaderEvidence(secondRun.page);
        const identity = await readReaderIdentity(secondRun.page);
        const scopeValue = await secondRun.page
          .getByRole("listbox", { name: "Reader 범위", exact: true })
          .inputValue();
        const presetIdsMatched =
          JSON.stringify(identity.panes.map((pane) => pane.presetId)) ===
          JSON.stringify(expectedPresetSelections);
        const selectedIdsMatched =
          JSON.stringify(identity.panes.map((pane) => pane.selectedBlockId)) ===
          JSON.stringify(
            beforeCloseIdentity.panes.map((pane) => pane.selectedBlockId),
          );
        const scrollProgressMatched = identity.panes.every(
          (pane, index) =>
            Number.isFinite(pane.scrollProgress) &&
            Number.isFinite(pane.actualScrollProgress) &&
            Math.abs(
              pane.scrollProgress -
                beforeCloseIdentity.panes[index].scrollProgress,
            ) <= 0.02 &&
            Math.abs(
              pane.actualScrollProgress -
                beforeCloseIdentity.panes[index].actualScrollProgress,
            ) <= 0.02 &&
            Math.abs(pane.actualScrollProgress - pane.scrollProgress) <= 0.02,
        );
        const readerUiStateMatched =
          identity.scrollSync === beforeCloseIdentity.scrollSync &&
          identity.leftPanelWidth === beforeCloseIdentity.leftPanelWidth &&
          identity.rightPanelWidth === beforeCloseIdentity.rightPanelWidth &&
          identity.diagnosticsExpanded ===
            beforeCloseIdentity.diagnosticsExpanded &&
          identity.panes.every(
            (pane, index) =>
              Number.isFinite(pane.zoom) &&
              Math.abs(pane.zoom - beforeCloseIdentity.panes[index].zoom) <=
                0.0001,
          ) &&
          JSON.stringify(
            identity.panes.map(readerPaneConfigurationIdentity),
          ) ===
            JSON.stringify(
              beforeCloseIdentity.panes.map(readerPaneConfigurationIdentity),
            );
        return evidence.paneCount === 3 &&
          evidence.scopeKind === "WORK" &&
          scopeValue === fixture.scopes.WORK.scopeNodeId &&
          presetIdsMatched &&
          selectedIdsMatched &&
          scrollProgressMatched &&
          readerUiStateMatched
          ? { evidence, identity }
          : null;
      },
      "reader-reopen-state",
      90_000,
    );
    const reopenElapsedMs = performance.now() - reopenStartedAt;
    const reopened = reopenedState.evidence;
    const reopenedIdentity = reopenedState.identity;
    const reopenedPresetSelections = await readPresetSelections(secondRun);
    verify(
      JSON.stringify(reopenedPresetSelections) ===
        JSON.stringify(expectedPresetSelections),
      "reader-reopen-preset-selections",
      {
        expectedStoredCount: expectedPresetSelections.filter(
          (value) => !value.startsWith("builtin:"),
        ).length,
        actualStoredCount: reopenedPresetSelections.filter(
          (value) => !value.startsWith("builtin:"),
        ).length,
        matched:
          JSON.stringify(reopenedPresetSelections) ===
          JSON.stringify(expectedPresetSelections),
      },
    );
    const selectedIdsMatched =
      JSON.stringify(reopenedIdentity.panes.map((pane) => pane.selectedBlockId)) ===
      JSON.stringify(beforeCloseIdentity.panes.map((pane) => pane.selectedBlockId));
    verify(selectedIdsMatched, "reader-reopen-selected-block", {
      expectedPresent: beforeCloseIdentity.panes.map(
        (pane) => pane.selectedBlockId.length > 0,
      ),
      actualPresent: reopenedIdentity.panes.map(
        (pane) => pane.selectedBlockId.length > 0,
      ),
      matched: selectedIdsMatched,
    });
    const scrollProgressMatched = reopenedIdentity.panes.every(
      (pane, index) =>
        Number.isFinite(pane.actualScrollProgress) &&
        Math.abs(
          pane.scrollProgress - beforeCloseIdentity.panes[index].scrollProgress,
        ) <= 0.02 &&
        Math.abs(
          pane.actualScrollProgress -
            beforeCloseIdentity.panes[index].actualScrollProgress,
        ) <= 0.02 &&
        Math.abs(pane.actualScrollProgress - pane.scrollProgress) <= 0.02,
    );
    verify(scrollProgressMatched, "reader-reopen-scroll-progress", {
      expected: beforeCloseIdentity.panes.map((pane) =>
        roundMilliseconds(pane.scrollProgress),
      ),
      actual: reopenedIdentity.panes.map((pane) =>
        roundMilliseconds(pane.scrollProgress),
      ),
      actualShadow: reopenedIdentity.panes.map((pane) =>
        roundMilliseconds(pane.actualScrollProgress),
      ),
      matched: scrollProgressMatched,
    });
    const readerUiStateMatched =
      reopenedIdentity.scrollSync === beforeCloseIdentity.scrollSync &&
      reopenedIdentity.leftPanelWidth === beforeCloseIdentity.leftPanelWidth &&
      reopenedIdentity.rightPanelWidth === beforeCloseIdentity.rightPanelWidth &&
      reopenedIdentity.diagnosticsExpanded ===
        beforeCloseIdentity.diagnosticsExpanded &&
      reopenedIdentity.panes.every(
        (pane, index) =>
          Math.abs(pane.zoom - beforeCloseIdentity.panes[index].zoom) <= 0.0001,
      ) &&
      JSON.stringify(
        reopenedIdentity.panes.map(readerPaneConfigurationIdentity),
      ) ===
        JSON.stringify(
          beforeCloseIdentity.panes.map(readerPaneConfigurationIdentity),
        );
    verify(readerUiStateMatched, "reader-reopen-ui-state", {
      scrollSyncMatched:
        reopenedIdentity.scrollSync === beforeCloseIdentity.scrollSync,
      panelWidthsMatched:
        reopenedIdentity.leftPanelWidth === beforeCloseIdentity.leftPanelWidth &&
        reopenedIdentity.rightPanelWidth === beforeCloseIdentity.rightPanelWidth,
      diagnosticsExpandedMatched:
        reopenedIdentity.diagnosticsExpanded ===
        beforeCloseIdentity.diagnosticsExpanded,
      zoomsMatched: reopenedIdentity.panes.map(
        (pane, index) =>
          Math.abs(pane.zoom - beforeCloseIdentity.panes[index].zoom) <= 0.0001,
      ),
      resolvedConfigsMatched:
        JSON.stringify(
          reopenedIdentity.panes.map(readerPaneConfigurationIdentity),
        ) ===
        JSON.stringify(
          beforeCloseIdentity.panes.map(readerPaneConfigurationIdentity),
        ),
    });
    await secondRun.page.screenshot({ path: reopenedScreenshotPath, fullPage: true });
    const secondSecurity = securityEvidence(secondRun);
    assertSecurity(secondSecurity);
    await closeWindowCleanly(secondRun);
    secondRun = undefined;

    return {
      fixture: fixtureEvidence(fixture),
      scopes: scopeResults,
      compile: {
        external: summarizeMeasurements(compileSamples),
        core: summarizeMeasurements(coreCompileSamples),
        ipc: summarizeMeasurements(ipcSamples),
        validation: summarizeMeasurements(validationSamples),
        firstVisible: summarizeMeasurements(firstVisibleSamples),
      },
      threePaneFirstVisible: summarizeMeasurements(threePaneSamples),
      paneModes: {
        one: true,
        two: twoPane.evidence.paneCount === 2,
        three: configuredPanes.paneCount === 3,
      },
      settingVisible: summarizeMeasurements(settingSamples),
      presetVisible: summarizeMeasurements(presetVisibleSamples),
      sourceSelection: summarizeMeasurements(sourceSelectionSamples),
      sourceNavigation: summarizeMeasurements(sourceNavigationSamples),
      scrollSync: summarizeMeasurements(scrollSamples),
      independentScroll,
      keyboard,
      diagnostics: {
        calculationMs: roundMilliseconds(diagnosticsMeasurementMs),
        count: configuredPanes.diagnosticCount,
        measurementStatus: configuredPanes.diagnosticMeasurementStatus,
        layoutStatus: configuredPanes.layoutDiagnosticsStatus,
        navigation: diagnosticNavigation,
      },
      configuredPanes: configuredPanes.panes.map((pane) => ({
        deviceCategory: pane.deviceCategory,
        viewportWidth: pane.viewportWidth,
        viewportHeight: pane.viewportHeight,
        measurementStatus: pane.measurementStatus,
        canonicalSections: pane.canonicalSections,
        canonicalBlocks: pane.canonicalBlocks,
        externalElementCount: pane.externalElementCount,
        rovingTargetCount: pane.rovingTargetCount,
      })),
      presetCrud: {
        created: presetCrud.created,
        duplicated: presetCrud.duplicated,
        updated: presetCrud.updated,
        deleted: presetCrud.deleted,
        remainingStoredPresetCount: presetCrud.remainingStoredPresetCount,
      },
      snapshot: snapshotRestore,
      persistence: {
        paneCount: reopened.paneCount,
        scopeKind: reopened.scopeKind,
        presetSelectionsMatched: true,
        selectedBlockIdsMatched: selectedIdsMatched,
        selectedBlockPaneCount: reopenedIdentity.panes.filter(
          (pane) => pane.selectedBlockId.length > 0,
        ).length,
        scrollProgressMatched,
        readerUiStateMatched,
        scrollSync: reopenedIdentity.scrollSync,
        panelWidths: [
          reopenedIdentity.leftPanelWidth,
          reopenedIdentity.rightPanelWidth,
        ],
        diagnosticsExpanded: reopenedIdentity.diagnosticsExpanded,
        zooms: reopenedIdentity.panes.map((pane) => pane.zoom),
        resolvedPaneConfigs: reopenedIdentity.panes.map((pane) => ({
          deviceCategory: pane.deviceCategory,
          viewportWidth: pane.viewportWidth,
          viewportHeight: pane.viewportHeight,
          fontToken: pane.fontToken,
          fontSize: pane.fontSize,
          lineHeight: pane.lineHeight,
          sceneBreakStyle: pane.sceneBreakStyle,
        })),
        savedScrollProgress: beforeCloseIdentity.panes.map((pane) =>
          roundMilliseconds(pane.scrollProgress),
        ),
        reopenedScrollProgress: reopenedIdentity.panes.map((pane) =>
          roundMilliseconds(pane.scrollProgress),
        ),
        reopenedActualScrollProgress: reopenedIdentity.panes.map((pane) =>
          roundMilliseconds(pane.actualScrollProgress),
        ),
        newProcessRestoreMs: roundMilliseconds(reopenElapsedMs),
      },
      memory: {
        before: memoryBefore,
        after: memoryAfter,
        workingSetDeltaBytes:
          memoryBefore.available && memoryAfter.available
            ? memoryAfter.workingSetBytes - memoryBefore.workingSetBytes
            : null,
        privateDeltaBytes:
          memoryBefore.available && memoryAfter.available
            ? memoryAfter.privateBytes - memoryBefore.privateBytes
            : null,
      },
      security: { firstRun: firstSecurity, reopened: secondSecurity },
      screenshots: { normal: true, reopened: true },
      beforeClose: {
        canonicalSections: beforeClose.panes[0].canonicalSections,
        canonicalBlocks: beforeClose.panes[0].canonicalBlocks,
        paneCount: beforeClose.paneCount,
      },
    };
  } catch (error) {
    if (firstRun || secondRun) {
      lastFailureContext = await readFailureContext().catch(() => ({
        rendererAvailable: false,
      }));
    }
    throw error;
  } finally {
    const applications = [firstRun?.application, secondRun?.application].filter(
      (application) => application !== undefined,
    );
    if (applications.length > 0) {
      await closeApplicationsOrThrow(applications);
    }
  }
}

async function runLongScenario({ fixture, projectPath, userDataPath }) {
  let run;
  try {
    reportStage("long-launch");
    run = await launchApplication({ projectPath, userDataPath });
    diagnosticRun = run;
    await openProject(run);
    const memoryBefore = sampleApplicationMemory(run.application);
    await enterReaderLab(run);
    reportStage("long-work-compile");
    const workScope = await selectScope(run, fixture.scopes.WORK);
    reportStage("long-work-initial-measurement");
    await waitForMeasurementComplete(run, 300_000);
    const compileSamples = [];
    const coreCompileSamples = [];
    const ipcSamples = [];
    const validationSamples = [];
    const firstVisibleSamples = [];
    for (let index = 0; index < expensiveMeasurementRuns; index += 1) {
      const sample = await refreshReader(run, `long-refresh-${index + 1}`);
      compileSamples.push(sample.elapsedMs);
      coreCompileSamples.push(sample.coreCompileMs);
      ipcSamples.push(sample.ipcRoundTripMs);
      validationSamples.push(sample.validationMs);
      firstVisibleSamples.push(sample.firstVisibleMs);
      await waitForMeasurementComplete(run, 300_000);
    }

    reportStage("long-three-pane");
    const threePaneSamples = [];
    for (let index = 0; index < expensiveMeasurementRuns; index += 1) {
      await setPaneCount(run, 1);
      const sample = await setPaneCount(run, 3);
      threePaneSamples.push(sample.elapsedMs);
    }
    await choosePreset(run, 0, "builtin:kakao-like-mobile");
    await choosePreset(run, 1, "builtin:series-like-mobile");
    await choosePreset(run, 2, "builtin:munpia-like-desktop");

    reportStage("long-setting-five");
    const settingSamples = [];
    for (let index = 0; index < expensiveMeasurementRuns; index += 1) {
      settingSamples.push(
        await setNumberControl(
          run,
          "글자 크기",
          index % 2 === 0 ? 19 : 18,
          2,
          "data-reader-font-size",
        ),
      );
    }

    reportStage("long-full-measurement");
    const longMeasurementStartedAt = performance.now();
    await setNumberControl(
      run,
      "줄간격",
      1.91,
      2,
      "data-reader-line-height",
    );
    const measured = await waitForMeasurementComplete(run, 300_000, {
      requireLayoutDiagnostics: true,
    });
    const diagnosticsMeasurementMs = performance.now() - longMeasurementStartedAt;
    verify(
      measured.diagnosticMeasurementStatus === "COMPLETE" &&
        (measured.diagnosticCount ?? 0) > 0,
      "reader-long-diagnostics-incomplete",
      {
        status: measured.diagnosticMeasurementStatus,
        count: measured.diagnosticCount,
      },
    );
    verify(
      measured.panes.every(
        (pane) =>
          pane.canonicalSections === fixture.scopes.WORK.sections &&
          pane.canonicalBlocks === fixture.scopes.WORK.blocks &&
          pane.measuredBlocks === fixture.scopes.WORK.blocks,
      ),
      "long-reader-block-loss",
      {
        expectedSections: fixture.scopes.WORK.sections,
        expectedBlocks: fixture.scopes.WORK.blocks,
        panes: measured.panes.map((pane) => ({
          sections: pane.canonicalSections,
          blocks: pane.canonicalBlocks,
          measuredBlocks: pane.measuredBlocks,
        })),
      },
    );
    verify(
      measured.panes.every(
        (pane) =>
          pane.virtualized &&
          pane.mountedSections > 0 &&
          pane.mountedSections < pane.canonicalSections &&
          pane.mountedSections <= 32 &&
          pane.externalElementCount === 0 &&
          pane.rovingTargetCount === 1,
      ),
      "long-reader-virtualization",
      {
        panes: measured.panes.map((pane) => ({
          virtualized: pane.virtualized,
          mountedSections: pane.mountedSections,
          canonicalSections: pane.canonicalSections,
          externalElementCount: pane.externalElementCount,
          rovingTargetCount: pane.rovingTargetCount,
        })),
      },
    );
    const keyboard = await verifyKeyboardNavigation(run, 0);

    reportStage("long-scroll-five");
    await run.page.getByLabel("scroll sync", { exact: true }).check();
    const scrollSamples = [];
    let previousMountedBlockIds = await Promise.all(
      measured.panes.map((_, paneIndex) =>
        readMountedBlockIds(run.page, paneIndex, 8),
      ),
    );
    verify(
      previousMountedBlockIds.every((ids) => ids.length > 0),
      "long-reader-initial-window-empty",
      { mountedIdCounts: previousMountedBlockIds.map((ids) => ids.length) },
    );
    const virtualWindowChanges = [];
    for (const progress of [0.1, 0.25, 0.5, 0.75, 0.42]) {
      const sample = await scrollPane(run, 0, progress);
      scrollSamples.push(sample.elapsedMs);
      const changedWindow = await poll(
        async () => {
          const current = await readReaderEvidence(run.page);
          const mountedBlockIds = await Promise.all(
            current.panes.map((_, paneIndex) =>
              readMountedBlockIds(run.page, paneIndex, 8),
            ),
          );
          const changed = mountedBlockIds.map(
            (ids, paneIndex) =>
              ids.length > 0 &&
              JSON.stringify(ids) !==
                JSON.stringify(previousMountedBlockIds[paneIndex]),
          );
          return current.panes.every(
            (pane) =>
              pane.shadowReady &&
              pane.virtualized &&
              pane.mountedSections > 0 &&
              pane.mountedSections <= 32 &&
              pane.mountedSections < pane.canonicalSections &&
              pane.mountedBlocks > 0,
          ) && changed.every(Boolean)
            ? { current, mountedBlockIds, changed }
            : null;
        },
        "long-reader-window-change",
        30_000,
      );
      previousMountedBlockIds = changedWindow.mountedBlockIds;
      virtualWindowChanges.push({
        progress,
        changedPaneCount: changedWindow.changed.filter(Boolean).length,
        mountedSections: changedWindow.current.panes.map(
          (pane) => pane.mountedSections,
        ),
        mountedBlocks: changedWindow.current.panes.map(
          (pane) => pane.mountedBlocks,
        ),
      });
    }
    const memoryAfter = sampleApplicationMemory(run.application);
    await run.page.screenshot({ path: longScreenshotPath, fullPage: true });
    const security = securityEvidence(run);
    assertSecurity(security);
    await closeWindowCleanly(run);
    run = undefined;
    return {
      fixture: fixtureEvidence(fixture),
      workScope,
      compile: {
        external: summarizeMeasurements(compileSamples),
        core: summarizeMeasurements(coreCompileSamples),
        ipc: summarizeMeasurements(ipcSamples),
        validation: summarizeMeasurements(validationSamples),
        firstVisible: summarizeMeasurements(firstVisibleSamples),
      },
      threePaneFirstVisible: summarizeMeasurements(threePaneSamples),
      settingVisible: summarizeMeasurements(settingSamples),
      scrollSync: summarizeMeasurements(scrollSamples),
      virtualWindowChanges,
      keyboard,
      diagnostics: {
        calculationMs: roundMilliseconds(diagnosticsMeasurementMs),
        count: measured.diagnosticCount,
        measurementStatus: measured.diagnosticMeasurementStatus,
        layoutStatus: measured.layoutDiagnosticsStatus,
      },
      panes: measured.panes.map((pane) => ({
        virtualized: pane.virtualized,
        canonicalSections: pane.canonicalSections,
        canonicalBlocks: pane.canonicalBlocks,
        mountedSections: pane.mountedSections,
        mountedBlocks: pane.mountedBlocks,
        measuredSections: pane.measuredSections,
        measuredBlocks: pane.measuredBlocks,
        totalSections: pane.totalSections,
        measurementStatus: pane.measurementStatus,
        renderedHeight: pane.renderedHeight,
        screenCount: pane.screenCount,
        longestParagraphLines: pane.longestParagraphLines,
        paragraphsAtLeastEightLines: pane.paragraphsAtLeastEightLines,
        overflowCount: pane.overflowCount,
        deviceCategory: pane.deviceCategory,
        viewportWidth: pane.viewportWidth,
        viewportHeight: pane.viewportHeight,
        externalElementCount: pane.externalElementCount,
        rovingTargetCount: pane.rovingTargetCount,
      })),
      noCrash: true,
      blockLoss: 0,
      memory: {
        before: memoryBefore,
        after: memoryAfter,
        workingSetDeltaBytes:
          memoryBefore.available && memoryAfter.available
            ? memoryAfter.workingSetBytes - memoryBefore.workingSetBytes
            : null,
        privateDeltaBytes:
          memoryBefore.available && memoryAfter.available
            ? memoryAfter.privateBytes - memoryBefore.privateBytes
            : null,
      },
      security,
      screenshot: true,
    };
  } catch (error) {
    if (run) {
      lastFailureContext = await readFailureContext().catch(() => ({
        rendererAvailable: false,
      }));
    }
    throw error;
  } finally {
    if (run) {
      await closeApplicationsOrThrow([run.application]);
    }
  }
}

function hasExactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function fixtureEvidence(fixture) {
  return {
    bytes: fixture.bytes,
    sha256: fixture.sha256,
    revision: fixture.revision,
    inventory: {
      volumes: fixture.inventory.volumes,
      chapters: fixture.inventory.chapters,
      scenes: fixture.inventory.scenes,
      characters: fixture.inventory.characters,
      paragraphs: fixture.inventory.paragraphs,
      sceneBreaks: fixture.inventory.sceneBreaks,
      sections: fixture.inventory.sections,
      blocks: fixture.inventory.blocks,
    },
  };
}

function validateFixtureManifest(manifest) {
  verify(
    hasExactKeys(manifest, ["formatVersion", "fixtures"]) &&
      hasExactKeys(manifest.fixtures, ["normal", "long"]),
    "reader-fixture-manifest-shape",
  );
  verify(manifest?.formatVersion === 1, "reader-fixture-manifest-version");
  for (const profile of ["normal", "long"]) {
    const fixture = manifest.fixtures?.[profile];
    verify(
      hasExactKeys(fixture, [
        "relativePath",
        "bytes",
        "sha256",
        "projectId",
        "revision",
        "ids",
        "inventory",
        "scopes",
        "compileWork",
      ]) &&
        typeof fixture.relativePath === "string" &&
        Number.isSafeInteger(fixture.bytes) &&
        fixture.bytes > 0 &&
        /^[a-f0-9]{64}$/u.test(fixture.sha256) &&
        typeof fixture.projectId === "string" &&
        Number.isSafeInteger(fixture.revision) &&
        fixture.revision >= 0 &&
        hasExactKeys(fixture.ids, [
          "workId",
          "volumeId",
          "chapterId",
          "sceneId",
          "documentId",
        ]) &&
        Object.values(fixture.ids).every(
          (identifier) => typeof identifier === "string" && identifier.length > 0,
        ) &&
        hasExactKeys(fixture.inventory, [
          "volumes",
          "chapters",
          "scenes",
          "characters",
          "paragraphs",
          "sceneBreaks",
          "sections",
          "blocks",
        ]) &&
        Object.values(fixture.inventory).every(
          (count) => Number.isSafeInteger(count) && count >= 0,
        ) &&
        hasExactKeys(fixture.scopes, ["WORK", "VOLUME", "CHAPTER", "SCENE"]) &&
        hasExactKeys(fixture.compileWork, [
          "runs",
          "samplesMs",
          "medianMs",
          "maxMs",
          "contentHash",
        ]),
      "reader-fixture-entry",
      { profile },
    );
    for (const kind of ["SCENE", "CHAPTER", "VOLUME", "WORK"]) {
      const scope = fixture.scopes?.[kind];
      verify(
        hasExactKeys(scope, [
          "scopeNodeId",
          "scopeKind",
          "sections",
          "blocks",
          "withSpaces",
          "withoutSpaces",
          "paragraphs",
          "chapters",
          "contentHash",
          "firstBody",
        ]) &&
          hasExactKeys(scope.firstBody, [
            "id",
            "sourceBlockId",
            "sceneNodeId",
            "documentId",
            "start",
            "end",
            "rangeVerified",
          ]) &&
          scope.scopeKind === kind &&
          typeof scope.scopeNodeId === "string" &&
          Number.isSafeInteger(scope.sections) &&
          Number.isSafeInteger(scope.blocks),
        "reader-fixture-scope",
        { profile, kind },
      );
    }
  }
  const normal = manifest.fixtures.normal.inventory;
  const long = manifest.fixtures.long.inventory;
  verify(
    normal.volumes === 2 &&
      normal.chapters === 20 &&
      normal.scenes === 60 &&
      normal.characters >= 150_000 &&
      normal.characters <= 250_000,
    "reader-normal-fixture-shape",
    {
      volumes: normal.volumes,
      chapters: normal.chapters,
      scenes: normal.scenes,
      characters: normal.characters,
    },
  );
  verify(
    long.chapters >= 150 && long.scenes >= 450 && long.characters >= 600_000,
    "reader-long-fixture-shape",
    {
      chapters: long.chapters,
      scenes: long.scenes,
      characters: long.characters,
    },
  );
}

async function prepareFixture(profile, manifest, temporaryRoot) {
  const fixture = manifest.fixtures[profile];
  const sourcePath = resolve(repositoryRoot, fixture.relativePath);
  const sourceStats = await stat(sourcePath);
  verify(sourceStats.size === fixture.bytes, "reader-fixture-byte-size", {
    profile,
    expected: fixture.bytes,
    actual: sourceStats.size,
  });
  const sourceHash = createHash("sha256")
    .update(await readFile(sourcePath))
    .digest("hex");
  verify(sourceHash === fixture.sha256, "reader-fixture-sha256", {
    profile,
    matched: sourceHash === fixture.sha256,
  });
  const projectPath = resolve(temporaryRoot, `${profile}.madi`);
  await copyFile(sourcePath, projectPath);
  return { fixture, projectPath };
}

async function main() {
  const startedAt = performance.now();
  assertDiagnosticSanitizer();
  await mkdir(artifactDirectory, { recursive: true });
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  validateFixtureManifest(manifest);
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "madi-phase1f-"));
  try {
    const normalPrepared = await prepareFixture("normal", manifest, temporaryRoot);
    const longPrepared = await prepareFixture("long", manifest, temporaryRoot);
    const runNormal = () =>
      runNormalScenario({
        ...normalPrepared,
        userDataPath: resolve(temporaryRoot, "normal-user-data"),
      });
    const runLong = () =>
      runLongScenario({
        ...longPrepared,
        userDataPath: resolve(temporaryRoot, "long-user-data"),
      });
    let normal;
    let long;
    if (fastDiagnostic) {
      long = await runLong();
      normal = await runNormal();
    } else {
      normal = await runNormal();
      long = await runLong();
    }
    const evidence = {
      status: fastDiagnostic ? "DIAGNOSTIC_PASS" : "PASS",
      phase: "1F",
      packaged,
      logicalFormatVersion: 1,
      snapshotPayloadVersion: normal.snapshot.payloadVersion,
      measurementRuns: expensiveMeasurementRuns,
      elapsedMs: roundMilliseconds(performance.now() - startedAt),
      normal,
      long,
      security: {
        externalRequestCount:
          normal.security.firstRun.externalRequestCount +
          normal.security.reopened.externalRequestCount +
          long.security.externalRequestCount,
        externalWebSocketCount:
          normal.security.firstRun.externalWebSocketCount +
          normal.security.reopened.externalWebSocketCount +
          long.security.externalWebSocketCount,
        pageErrorCount:
          normal.security.firstRun.pageErrors.length +
          normal.security.reopened.pageErrors.length +
          long.security.pageErrors.length,
        rendererDiagnosticCount:
          normal.security.firstRun.rendererDiagnostics.length +
          normal.security.reopened.rendererDiagnostics.length +
          long.security.rendererDiagnostics.length,
        allLocalFileProbesBlocked:
          normal.security.firstRun.localFileBlocked &&
          normal.security.reopened.localFileBlocked &&
          long.security.localFileBlocked,
      },
    };
    assertEvidencePrivacy(evidence);
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    reportStage("pass");
  } finally {
    try {
      await rm(temporaryRoot, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 250,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.toLocaleLowerCase() : "";
      lastFailureContext = {
        rendererAvailable: false,
        cleanup: {
          ...summarizeError(error),
          resourceBusy: message.includes("ebusy") || message.includes("resource busy"),
          accessDenied: message.includes("eperm") || message.includes("access is denied"),
          directoryNotEmpty: message.includes("enotempty"),
        },
      };
      throw error;
    }
  }
}

try {
  await main();
} catch (error) {
  const failure = {
    status: "FAIL",
    phase: "1F",
    packaged,
    stage: currentStage,
    error: summarizeError(error),
    context:
      lastFailureContext ??
      (await readFailureContext().catch(() => ({ rendererAvailable: false }))),
  };
  try {
    assertEvidencePrivacy(failure);
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(evidencePath, `${JSON.stringify(failure, null, 2)}\n`, "utf8");
  } catch {
    // The fallback intentionally emits no error message or user-derived data.
  }
  process.stderr.write(
    `[electron-phase1f] failed ${JSON.stringify(summarizeError(error))}\n`,
  );
  process.exitCode = 1;
}
