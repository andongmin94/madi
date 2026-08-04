import { spawnSync } from "node:child_process";
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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { _electron as electron } from "playwright-core";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const desktopDirectory = resolve(repositoryRoot, "apps", "desktop");
const desktopRequire = createRequire(
  new URL("../apps/desktop/package.json", import.meta.url),
);
const packagedExecutable = process.env.MADI_PACKAGED_EXE?.trim();
const packaged = Boolean(packagedExecutable);
const reloadProbe = process.env.MADI_PHASE1E_RELOAD_PROBE === "1";
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
const fixturePath = resolve(
  process.env.MADI_PHASE1E_FIXTURE?.trim() ||
    resolve(repositoryRoot, "output", "test-fixtures", "phase1e-scale.madi"),
);
const artifactDirectory = resolve(repositoryRoot, "output", "playwright");
const artifactPrefix = `${
  packaged ? "madi-packaged-phase1e" : "madi-electron-phase1e"
}${reloadProbe ? "-reload-probe" : ""}`;
const firstScreenshotPath = resolve(
  artifactDirectory,
  `${artifactPrefix}-first-run.png`,
);
const reopenedScreenshotPath = resolve(
  artifactDirectory,
  `${artifactPrefix}-reopened.png`,
);
const evidencePath = resolve(
  artifactDirectory,
  `${artifactPrefix}-evidence.json`,
);
const WINDOW_CLOSE_TIMEOUT_MS = 195_000;

const largeCanvas = {
  id: "large-canvas-500-1000",
  name: "대규모 단일 캔버스",
  nodes: 500,
  edges: 1_000,
};
const generalCanvas = {
  id: "general-canvas-00",
  name: "일반 캔버스 00",
  nodes: 100,
  edges: 200,
};
const dragNodeId = "large-text-000";
const dragNodeText = "결정론적 플롯 메모 0000";
const multiSelectNodeIds = ["large-entity-012", "large-entity-013"];
const importedCanvasName = "Phase 1E 가져온 캔버스";
const textNodeValue = "Phase 1E Electron autosave note";
const flushedTextNodeValue = `${textNodeValue} / switch flush`;
const snapshotName = "Phase 1E actual checkpoint";
const snapshotMutationValue = "Phase 1E snapshot mutation";
const regularEdgeSourceId = "general-00-entity-012";
const regularEdgeTargetId = "general-00-entity-013";
const measurementRuns = 5;
const privateContentFragments = [
  "결정론적 플롯 메모",
  "설정 인물",
  "결정론적 scale reference",
  "장면 000",
  "흐름 0",
  "일반 캔버스",
  "대규모 단일 캔버스",
  importedCanvasName,
  textNodeValue,
  snapshotName,
  snapshotMutationValue,
];

function reportStage(stage) {
  process.stderr.write(`[electron-phase1e] ${stage}\n`);
}

function verify(condition, code, details = undefined) {
  if (!condition) {
    throw new Error(
      details === undefined ? code : `${code}: ${JSON.stringify(details)}`,
    );
  }
}

function assertEvidencePrivacy(evidence) {
  const serialized = JSON.stringify(evidence);
  const leakedFragmentIndexes = privateContentFragments.flatMap((fragment, index) =>
    serialized.includes(fragment) ? [index] : [],
  );
  verify(leakedFragmentIndexes.length === 0, "evidence-private-content-redaction", {
    leakedFragmentIndexes,
  });
}

function redactCanvasEntries(entries) {
  return entries.map((entry, index) => ({
    index,
    current: entry.current,
    disabled: entry.disabled,
    numericSummary: [...entry.summary.matchAll(/\d+/gu)]
      .slice(0, 2)
      .map((match) => Number(match[0])),
  }));
}

function redactExternalUrl(candidate) {
  try {
    const parsed = new URL(candidate);
    return { protocol: parsed.protocol, host: parsed.host };
  } catch {
    return { protocol: "invalid", host: "" };
  }
}

function summarizeError(error) {
  if (!(error instanceof Error)) {
    return { name: "NonError", messageLength: String(error).length };
  }
  return {
    name: error.name,
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
    samplesMs: samples.map(roundMilliseconds),
    medianMs: roundMilliseconds(median),
    maxMs: roundMilliseconds(Math.max(...samples)),
  };
}

function isLocalRuntimeUrl(candidate) {
  try {
    const protocol = new URL(candidate).protocol;
    return ["madi:", "data:", "blob:", "devtools:"].includes(protocol);
  } catch {
    return false;
  }
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
      lastError instanceof Error ? `: ${lastError.message}` : ""
    }`,
  );
}

async function launchApplication({ projectPath, canvasPath, userDataPath }) {
  const userDataArgument = `--user-data-dir=${userDataPath}`;
  const application = await electron.launch({
    executablePath: electronExecutable,
    args: packaged ? [userDataArgument] : [".", userDataArgument],
    cwd: packaged ? dirname(electronExecutable) : desktopDirectory,
    env: {
      ...process.env,
      ...(packaged ? {} : { MADI_CORE_BIN: coreBinary }),
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
    timeout: 30_000,
  });
  const requestedUrls = [];
  const pageErrors = [];
  const rendererErrorDiagnostics = [];
  const rendererErrorDiagnosticKeys = new Map();
  application
    .context()
    .on("request", (request) => requestedUrls.push(request.url()));

  await application.evaluate(
    ({ dialog }, paths) => {
      const calls = [];
      Reflect.set(globalThis, "__madiPhase1eDialogEvidence", calls);
      const extensionsFrom = (options) =>
        (options?.filters ?? [])
          .flatMap((filter) => filter.extensions ?? [])
          .map((extension) => String(extension).toLocaleLowerCase());
      const pathFor = (extensions) => {
        if (extensions.includes("madi")) {
          return paths.projectPath;
        }
        if (extensions.includes("canvas")) {
          return paths.canvasPath;
        }
        throw new Error(
          `Unexpected Phase 1E dialog filter: ${JSON.stringify(extensions)}`,
        );
      };
      dialog.showOpenDialog = async (_window, options) => {
        const extensions = extensionsFrom(options);
        const selectedPath = pathFor(extensions);
        calls.push({
          kind: "open",
          extensions,
          selectedPath,
        });
        return { canceled: false, filePaths: [selectedPath] };
      };
      dialog.showSaveDialog = async (_window, options) => {
        const extensions = extensionsFrom(options);
        const selectedPath = pathFor(extensions);
        calls.push({
          kind: "save",
          extensions,
          selectedPath,
        });
        return { canceled: false, filePath: selectedPath };
      };
    },
    { projectPath, canvasPath },
  );

  const page = await application.firstWindow({ timeout: 30_000 });
  const runtime = await application.evaluate(({ app }) => ({
    isPackaged: app.isPackaged,
    appName: app.getName(),
    userDataPath: app.getPath("userData"),
  }));
  page.on("pageerror", (error) => {
    const reactCode = error.message.match(/Minified React error #(\d+)/u)?.[1];
    pageErrors.push({
      name: error.name,
      messageLength: error.message.length,
      hasStack: Boolean(error.stack),
      hasCause: error.cause !== undefined,
      reactCode: reactCode ? Number(reactCode) : null,
      maximumUpdateDepth: error.message.includes("Maximum update depth exceeded"),
      tooManyRerenders: error.message.includes("Too many re-renders"),
    });
  });
  await page.exposeBinding(
    "__madiPhase1eReportDiagnostic",
    (_source, diagnostic) => {
      if (
        diagnostic &&
        typeof diagnostic === "object"
      ) {
        const key = JSON.stringify(diagnostic);
        const existingIndex = rendererErrorDiagnosticKeys.get(key);
        if (existingIndex !== undefined) {
          const existing = rendererErrorDiagnostics[existingIndex];
          rendererErrorDiagnostics[existingIndex] = {
            ...existing,
            occurrences: existing.occurrences + 1,
          };
        } else if (rendererErrorDiagnostics.length < 100) {
          rendererErrorDiagnosticKeys.set(key, rendererErrorDiagnostics.length);
          rendererErrorDiagnostics.push({ ...diagnostic, occurrences: 1 });
        }
      }
    },
  );
  await page.addInitScript(() => {
    const hash = (value) => {
      let result = 2166136261;
      for (const character of String(value)) {
        result ^= character.codePointAt(0) ?? 0;
        result = Math.imul(result, 16777619);
      }
      return (result >>> 0).toString(16).padStart(8, "0");
    };
    const knownStackNames = [
      "SelectionListenerInner",
      "StoreUpdater",
      "ResizeControl",
      "NodeWrapper",
      "BatchProvider",
      "ReactFlow",
      "PlotCanvasWorkspace",
    ];
    const summarizeText = (value) => ({
      length: Array.from(value).length,
      reactCode: Number(
        value.match(/Minified React error #(\d+)/u)?.[1] ?? 0,
      ) || null,
      maximumUpdateDepth: value.includes("Maximum update depth exceeded"),
      tooManyRerenders: value.includes("Too many re-renders"),
      resizeObserverLoop:
        value === "ResizeObserver loop completed with undelivered notifications.",
    });
    const summarizeUrl = (value) => {
      if (!value) {
        return { present: false, protocol: "", extension: "" };
      }
      try {
        const parsed = new URL(value, window.location.href);
        const extension = parsed.pathname.match(/\.([a-z0-9]+)$/iu)?.[1] ?? "";
        const allowedExtensions = new Set([
          "js",
          "css",
          "woff",
          "woff2",
          "wasm",
          "png",
          "jpg",
          "jpeg",
          "svg",
          "madi",
        ]);
        return {
          present: true,
          protocol: parsed.protocol,
          extension: allowedExtensions.has(extension.toLocaleLowerCase())
            ? extension.toLocaleLowerCase()
            : extension
              ? `hash:${hash(extension)}`
              : "",
        };
      } catch {
        return { present: true, protocol: "invalid", extension: "" };
      }
    };
    const summarizeStack = (value) => {
      const lines = typeof value === "string" ? value.split(/\r?\n/u).slice(1) : [];
      return {
        frameCount: lines.length,
        knownFrames: knownStackNames.filter((name) => value?.includes(name)),
        frames: lines.slice(0, 8).map((line) => {
          const location = line.match(
            /(?:^|[\\/])([^\\/():]+\.js):(\d+):(\d+)\)?\s*$/u,
          );
          const functionName = line.match(/^\s*at\s+([^\s(]+)(?:\s|\()/u)?.[1];
          return {
            functionHash: hash(functionName ?? "anonymous"),
            file: location?.[1] ?? "unknown",
            line: location ? Number(location[2]) : null,
            column: location ? Number(location[3]) : null,
          };
        }),
      };
    };
    const summarize = (value) => {
      if (value instanceof Error) {
        const cause = value.cause instanceof Error ? value.cause : null;
        return {
          type: "Error",
          nameHash: hash(value.name),
          message: summarizeText(value.message),
          stack: summarizeStack(value.stack),
          cause: cause
            ? {
                nameHash: hash(cause.name),
                message: summarizeText(cause.message),
                stack: summarizeStack(cause.stack),
              }
            : null,
        };
      }
      if (typeof value === "string") {
        return { type: "string", ...summarizeText(value) };
      }
      return {
        type: value === null ? "null" : typeof value,
        constructorHash:
          value && typeof value === "object"
            ? hash(value.constructor?.name ?? "object")
            : null,
      };
    };
    const report = (diagnostic) => {
      const binding = Reflect.get(
        globalThis,
        "__madiPhase1eReportDiagnostic",
      );
      if (typeof binding === "function") {
        void binding(diagnostic).catch(() => undefined);
      }
    };
    for (const method of ["error", "warn"]) {
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
        const elementTarget =
          event.target instanceof Element ? event.target : null;
        const tagName = elementTarget?.tagName ?? "";
        const allowedTags = new Set([
          "IMG",
          "LINK",
          "SCRIPT",
          "VIDEO",
          "AUDIO",
          "SOURCE",
          "IFRAME",
        ]);
        const source =
          elementTarget?.getAttribute("src") ??
          elementTarget?.getAttribute("href") ??
          "";
        report({
          source: "window.error",
          error: summarize(event.error),
          message: summarizeText(event.message ?? ""),
          filename: summarizeUrl(event.filename ?? ""),
          target: {
            isWindow: event.target === window,
            tag: allowedTags.has(tagName)
              ? tagName
              : tagName
                ? `hash:${hash(tagName)}`
                : "",
            source: summarizeUrl(source),
          },
        });
      },
      { capture: true },
    );
  });
  await page.context().setOffline(true);
  await page.reload({ waitUntil: "load" });
  await page.locator(".engine-pill--ready").waitFor({ timeout: 30_000 });

  const localFileProbeUrl = pathToFileURL(
    resolve(repositoryRoot, "package.json"),
  ).toString();
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
    pageErrors,
    rendererErrorDiagnostics,
    localFileProbeUrl,
    localFileProbe,
    runtime,
  };
}

async function forceCloseApplication(application) {
  let childProcess;
  try {
    childProcess = application.process();
  } catch {
    return;
  }
  if (
    process.platform === "win32" &&
    childProcess.pid &&
    childProcess.exitCode === null
  ) {
    spawnSync("taskkill", ["/PID", String(childProcess.pid), "/T", "/F"], {
      stdio: "ignore",
      timeout: 5_000,
      windowsHide: true,
    });
  } else if (
    childProcess.exitCode === null &&
    childProcess.signalCode === null
  ) {
    childProcess.kill();
  }
}

function sampleApplicationProcessTree(application, elapsedMs) {
  const rootPid = application.process().pid;
  if (process.platform !== "win32" || !Number.isSafeInteger(rootPid)) {
    return {
      elapsedMs: roundMilliseconds(elapsedMs),
      available: false,
    };
  }
  const command = [
    `$probeRootPid = ${rootPid}`,
    "$probeProcesses = Get-CimInstance Win32_Process",
    "$probeIds = @($probeRootPid)",
    "do { $probePreviousCount = $probeIds.Count; $probeIds += @($probeProcesses | Where-Object { $probeIds -contains $_.ParentProcessId } | ForEach-Object ProcessId); $probeIds = @($probeIds | Sort-Object -Unique) } while ($probeIds.Count -ne $probePreviousCount)",
    "$probeRows = @($probeProcesses | Where-Object { $probeIds -contains $_.ProcessId } | ForEach-Object { $probeProcess = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if ($probeProcess) { [PSCustomObject]@{ name = $_.Name; cpu = [double]$probeProcess.CPU } } })",
    "$probeRows | ConvertTo-Json -Compress",
  ].join("; ");
  const sampled = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    },
  );
  if (sampled.status !== 0 || !sampled.stdout.trim()) {
    return {
      elapsedMs: roundMilliseconds(elapsedMs),
      available: false,
    };
  }
  try {
    const parsed = JSON.parse(sampled.stdout);
    const rows = (Array.isArray(parsed) ? parsed : [parsed]).flatMap((row) =>
      row && typeof row.name === "string" && Number.isFinite(row.cpu)
        ? [{ name: row.name.toLocaleLowerCase(), cpu: Number(row.cpu) }]
        : [],
    );
    const electronRows = rows.filter((row) => row.name.includes("electron"));
    const coreRows = rows.filter((row) => row.name.includes("madi-core"));
    const sum = (values) => values.reduce((total, value) => total + value.cpu, 0);
    return {
      elapsedMs: roundMilliseconds(elapsedMs),
      available: true,
      processCount: rows.length,
      electronProcessCount: electronRows.length,
      coreProcessCount: coreRows.length,
      totalCpuSeconds: roundMilliseconds(sum(rows)),
      electronCpuSeconds: roundMilliseconds(sum(electronRows)),
      maxElectronCpuSeconds: roundMilliseconds(
        Math.max(0, ...electronRows.map((row) => row.cpu)),
      ),
      coreCpuSeconds: roundMilliseconds(sum(coreRows)),
    };
  } catch {
    return {
      elapsedMs: roundMilliseconds(elapsedMs),
      available: false,
    };
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

async function readDialogEvidence(application) {
  return application.evaluate(() => {
    const value = Reflect.get(globalThis, "__madiPhase1eDialogEvidence");
    return Array.isArray(value) ? value : [];
  });
}

async function openProject(page, pageErrors) {
  await page.getByRole("button", { name: ".madi 열기" }).click();
  const result = await poll(
    async () => {
      if (pageErrors.length > 0) {
        return { phase: "page-error", pageErrors: [...pageErrors] };
      }
      const current = await page
        .locator('[data-testid="save-status"]')
        .getAttribute("data-phase");
      if (current === "error") {
        const diagnostics = await page.locator("body").evaluate((body) => ({
          alertCount: body.querySelectorAll('[role="alert"]').length,
          canvasWorkspaceCount: body.querySelectorAll(
            '[data-testid="plot-canvas-workspace"]',
          ).length,
          modeButtonCount: body.querySelectorAll(".mode-switch button").length,
        }));
        return { phase: current, diagnostics };
      }
      return current === "saved" || current === "dirty"
        ? { phase: current }
        : null;
    },
    "project open completion",
    60_000,
  );
  verify(
    result.phase === "saved" || result.phase === "dirty",
    "project-open-failed",
    result,
  );
  return result.phase;
}

async function enterCanvasMode(page, pageErrors) {
  await page.getByRole("button", { name: "캔버스", exact: true }).click();
  const result = await poll(
    async () => {
      if (pageErrors.length > 0) {
        return { ready: false, pageErrors: [...pageErrors] };
      }
      const regionCount = await page
        .getByRole("region", { name: "캔버스 작업 공간" })
        .count();
      const workspaceCount = await page
        .locator('[data-testid="plot-canvas-workspace"]')
        .count();
      return regionCount > 0 && workspaceCount > 0
        ? { ready: true, pageErrors: [] }
        : null;
    },
    "Plot Canvas workspace",
    30_000,
  ).catch(async (error) => ({
    ready: false,
    pageErrors: [...pageErrors],
    timeout: summarizeError(error),
    diagnostics: await page.locator("body").evaluate((body) => ({
      savePhase:
        body
          .querySelector('[data-testid="save-status"]')
          ?.getAttribute("data-phase") ?? "missing",
      canvasPressed:
        body.querySelector('.mode-switch button[aria-pressed="true"]') !== null,
      alertCount: body.querySelectorAll('[role="alert"]').length,
      canvasModePresent: body.querySelector(".plot-canvas-mode") !== null,
      canvasListItemCount: body.querySelectorAll(
        '.plot-canvas-list [role="listitem"]',
      ).length,
      workspaceCount: body.querySelectorAll(
        '[data-testid="plot-canvas-workspace"]',
      ).length,
    })),
  }));
  verify(result.ready, "canvas-renderer-not-ready", result);
}

async function readWorkspaceEvidence(page) {
  return page.locator('[data-testid="plot-canvas-workspace"]').evaluate(
    (workspace) => {
      const firstNode = workspace.querySelector(".react-flow__node");
      const firstNodeBounds = firstNode?.getBoundingClientRect();
      return {
        canvasId: workspace.getAttribute("data-canvas-id") ?? "",
        nodeCount: Number(workspace.getAttribute("data-node-count")),
        edgeCount: Number(workspace.getAttribute("data-edge-count")),
        autosavePhase: workspace.getAttribute("data-autosave-phase") ?? "",
        renderedNodeCount: workspace.querySelectorAll(".react-flow__node").length,
        renderedEdgeCount: workspace.querySelectorAll(".react-flow__edge").length,
        edgeSvgCount: workspace.querySelectorAll(
          "svg.react-flow__edges, .react-flow__edges svg",
        ).length,
        handleCount: workspace.querySelectorAll(".react-flow__handle").length,
        selectedNodeCount: workspace.querySelectorAll(
          ".react-flow__node.selected",
        ).length,
        viewportTransform:
          workspace.querySelector(".react-flow__viewport")?.getAttribute("style") ??
          "",
        firstNode: firstNode
          ? {
              id: firstNode.getAttribute("data-id") ?? "",
              style: firstNode.getAttribute("style") ?? "",
              bounds: firstNodeBounds
                ? {
                    x: firstNodeBounds.x,
                    y: firstNodeBounds.y,
                    width: firstNodeBounds.width,
                    height: firstNodeBounds.height,
                  }
                : null,
            }
          : null,
      };
    },
  );
}

async function readAlertTaxonomy(page) {
  return page.locator('[role="alert"]').evaluateAll((alerts) =>
    alerts.map((alert) => {
      const value = alert.textContent ?? "";
      const normalized = value.toLocaleLowerCase();
      return {
        length: Array.from(value).length,
        source: alert.closest(".plot-canvas-workspace")
          ? "workspace"
          : alert.closest(".plot-canvas-mode")
            ? "mode"
            : "application",
        categories: [
          normalized.includes("saved different plot canvas ui state")
            ? "UI_STATE_ROUND_TRIP"
            : null,
          normalized.includes("invalid plot canvas ui state")
            ? "UI_STATE_INVALID"
            : null,
          normalized.includes("too many plot canvas ui states")
            ? "UI_STATE_LIMIT"
            : null,
          normalized.includes("selected canvas element id")
            ? "UI_STATE_SELECTED_ID"
            : null,
          normalized.includes("stale") ||
          normalized.includes("revision") ||
          value.includes("오래된")
            ? "STALE_REVISION"
            : null,
          normalized.includes("ui state") || value.includes("화면 상태")
            ? "UI_STATE"
            : null,
          normalized.includes("invalid") || value.includes("올바르지")
            ? "VALIDATION"
            : null,
          value.includes("저장") ? "SAVE" : null,
          value.includes("불러오") ? "LOAD" : null,
          value.includes("전환") ? "SWITCH" : null,
        ].filter(Boolean),
      };
    }),
  );
}

async function readUiStateShape(page) {
  return page.locator(".plot-canvas-mode").evaluate((mode) => {
    const workspace = mode.querySelector('[data-testid="plot-canvas-workspace"]');
    const selected = workspace?.querySelector(
      ".react-flow__node.selected, .react-flow__edge.selected",
    );
    const selectedId = selected?.getAttribute("data-id") ?? "";
    const viewportStyle =
      workspace?.querySelector(".react-flow__viewport")?.getAttribute("style") ??
      "";
    const numericViewportValues =
      viewportStyle.match(/-?\d+(?:\.\d+)?/gu)?.map(Number) ?? [];
    const inspector = mode.querySelector(".plot-canvas-inspector");
    const inspectorWidth = inspector?.getBoundingClientRect().width ?? 0;
    return {
      selectedElementIdLength: selectedId.length,
      selectedElementIdKind: selectedId.startsWith("node-")
        ? "generated-node"
        : selectedId.startsWith("edge-")
          ? "generated-edge"
          : selectedId
            ? "fixture-element"
            : "none",
      canvasStateCount: mode.querySelectorAll(
        '.plot-canvas-list [role="listitem"]',
      ).length,
      viewportNumberCount: numericViewportValues.length,
      viewportFinite: numericViewportValues.every(Number.isFinite),
      viewportMaximumAbsolute:
        numericViewportValues.length > 0
          ? Math.max(...numericViewportValues.map(Math.abs))
          : 0,
      inspectorWidth: Math.round(inspectorWidth),
      toggles: Array.from(
        workspace?.querySelectorAll('button[aria-pressed="true"]') ?? [],
      ).length,
    };
  });
}

async function waitForCanvas(page, expected, timeoutMs = 35_000) {
  return poll(
    async () => {
      const evidence = await readWorkspaceEvidence(page).catch(() => null);
      return evidence &&
        evidence.canvasId === expected.id &&
        evidence.nodeCount === expected.nodes &&
        evidence.edgeCount === expected.edges
        ? evidence
        : null;
    },
    `canvas ${expected.id} ${expected.nodes}/${expected.edges}`,
    timeoutMs,
  ).catch(async (error) => {
    const diagnostics = {
      expected: {
        id: expected.id,
        nodes: expected.nodes,
        edges: expected.edges,
      },
      workspace: await readWorkspaceEvidence(page).catch(() => null),
      canvases: redactCanvasEntries(
        await readCanvasList(page).catch(() => []),
      ),
      alerts: await readAlertTaxonomy(page).catch(() => []),
      uiState: await readUiStateShape(page).catch(() => null),
    };
    throw new Error(
      `canvas-wait-failed: ${JSON.stringify({
        error: summarizeError(error),
        diagnostics,
      })}`,
    );
  });
}

async function canvasListItemByName(page, expected) {
  const items = page.locator('.plot-canvas-list [role="listitem"]');
  const matchCount = await items.evaluateAll((elements, expectedName) => {
    for (const element of elements) {
      element.removeAttribute("data-phase1e-target");
    }
    const matches = elements.filter(
      (element) =>
        element.querySelector("strong")?.textContent?.trim() === expectedName,
    );
    if (matches.length === 1) {
      matches[0].setAttribute("data-phase1e-target", "true");
    }
    return matches.length;
  }, expected.name);
  verify(matchCount === 1, "canvas-list-selector-count", {
    expectedId: expected.id,
    count: matchCount,
  });
  return page.locator(
    '.plot-canvas-list [role="listitem"][data-phase1e-target="true"]',
  );
}

async function selectCanvas(page, expected) {
  const item = await canvasListItemByName(page, expected);
  const currentBefore = (await readCanvasList(page)).find(
    (entry) => entry.current,
  );
  await item.evaluate((element) => {
    element.dataset.phase1eActivation = "pending";
    element.addEventListener(
      "click",
      () => {
        element.dataset.phase1eActivation = "observed";
      },
      { once: true },
    );
  });
  await item.focus();
  await item.press("Enter");
  return waitForCanvas(page, expected).catch(async (error) => {
    const mode = await page.locator(".plot-canvas-mode").evaluate((element) => ({
      busy: element.getAttribute("aria-busy"),
      alertCount: element.querySelectorAll('[role="alert"]').length,
    }));
    throw new Error(
      `canvas-select-failed: ${JSON.stringify({
        error: summarizeError(error),
        activation: await item.getAttribute("data-phase1e-activation"),
        currentBefore: redactCanvasEntries(currentBefore ? [currentBefore] : []),
        currentAfter: redactCanvasEntries(
          (await readCanvasList(page)).filter((entry) => entry.current),
        ),
        mode,
      })}`,
    );
  });
}

async function readCanvasList(page) {
  return page.locator('.plot-canvas-list [role="listitem"]').evaluateAll(
    (items) =>
      items.map((item) => ({
        name: item.querySelector("strong")?.textContent?.trim() ?? "",
        summary: item.querySelector("span")?.textContent?.trim() ?? "",
        current: item.getAttribute("aria-current") === "true",
        disabled: item instanceof HTMLButtonElement ? item.disabled : undefined,
      })),
  );
}

async function fitView(page) {
  const startedAt = performance.now();
  await page.getByRole("button", { name: "화면 맞춤", exact: true }).click();
  await page.waitForTimeout(240);
  const evidence = await readWorkspaceEvidence(page);
  verify(
    /scale\([^)]*\)/u.test(evidence.viewportTransform),
    "fit-view-transform-missing",
    evidence,
  );
  return {
    observedMs: performance.now() - startedAt,
    viewportTransform: evidence.viewportTransform,
  };
}

async function focusExistingTextNode(page, query, expectedValue) {
  await page
    .getByRole("button", { name: "노드 추가…", exact: true })
    .focus();
  const startedAt = performance.now();
  await page.keyboard.press("Control+K");
  const search = page.getByRole("searchbox", {
    name: "설정, 장면 또는 텍스트 검색",
  });
  await search.waitFor({ timeout: 10_000 });
  await search.fill(query);
  const options = page.getByRole("option");
  const optionMatchCount = await options.evaluateAll((elements, expectedText) => {
    for (const element of elements) {
      element.removeAttribute("data-phase1e-search-target");
    }
    const matches = elements.filter(
      (element) =>
        element.querySelector("span")?.textContent?.trim() ===
          "캔버스 메모로 이동" &&
        element.querySelector("strong")?.textContent?.trim() === expectedText,
    );
    if (matches.length === 1) {
      matches[0].setAttribute("data-phase1e-search-target", "true");
    }
    return matches.length;
  }, query);
  verify(optionMatchCount === 1, "ctrl-k-text-option-count", {
    queryCharacters: Array.from(query).length,
    optionMatchCount,
  });
  const option = page.locator(
    '[role="option"][data-phase1e-search-target="true"]',
  );
  await option.waitFor({ timeout: 10_000 });
  await option.click();
  await page
    .getByRole("dialog", { name: "캔버스 노드 추가" })
    .waitFor({ state: "hidden", timeout: 10_000 });
  await page.waitForTimeout(220);
  const inspectorValue = await page
    .getByTestId("plot-canvas-inspector")
    .getByRole("textbox", { name: "텍스트" })
    .inputValue();
  verify(
    inspectorValue === expectedValue,
    "ctrl-k-focused-wrong-text-node",
    {
      inspectorValueLength: inspectorValue.length,
      expectedValueLength: expectedValue.length,
    },
  );
  return {
    observedMs: performance.now() - startedAt,
    valueMatched: true,
    valueLength: inspectorValue.length,
  };
}

async function selectNodesWithModifier(page) {
  await fitView(page);
  await page.keyboard.press("Escape");
  await poll(
    async () =>
      (await page.locator(".react-flow__node.selected").count()) === 0 || null,
    "multi-selection reset",
    10_000,
  );
  const hitPoints = [];
  for (const nodeId of multiSelectNodeIds) {
    const hitPoint = await page.evaluate((targetNodeId) => {
      const node = document.querySelector(
        `.react-flow__node[data-id="${CSS.escape(targetNodeId)}"]`,
      );
      const stage = document.querySelector(".plot-canvas-stage");
      if (!(node instanceof HTMLElement) || !(stage instanceof HTMLElement)) {
        return null;
      }
      const bounds = node.getBoundingClientRect();
      const stageBounds = stage.getBoundingClientRect();
      const left = Math.max(bounds.left + 3, stageBounds.left + 3);
      const right = Math.min(bounds.right - 3, stageBounds.right - 3);
      const top = Math.max(bounds.top + 3, stageBounds.top + 3);
      const bottom = Math.min(bounds.bottom - 3, stageBounds.bottom - 3);
      const candidates = [
        { x: (left + right) / 2, y: (top + bottom) / 2 },
      ];
      for (let y = top; y <= bottom; y += 6) {
        for (let x = left; x <= right; x += 6) {
          candidates.push({ x, y });
        }
      }
      for (const candidate of candidates) {
        const target = document.elementFromPoint(candidate.x, candidate.y);
        const hit = target?.closest(".react-flow__node");
        const isControl = Boolean(
          target?.closest(
            ".react-flow__handle, .react-flow__resize-control, button, input, textarea",
          ),
        );
        if (hit?.getAttribute("data-id") === targetNodeId && !isControl) {
            return {
              x: candidate.x,
              y: candidate.y,
              hitNodeId: hit.getAttribute("data-id"),
              targetClass: target?.getAttribute("class") ?? "",
              bounds: {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
              },
            };
        }
      }
      return null;
    }, nodeId);
    verify(Boolean(hitPoint), "multi-select-node-hit-point-missing", {
      nodeId,
    });
    hitPoints.push(hitPoint);
  }
  const startedAt = performance.now();
  await page.mouse.click(hitPoints[0].x, hitPoints[0].y);
  try {
    await poll(
      async () => {
        const selectedNodeIds = await page
          .locator(".react-flow__node.selected")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("data-id") ?? "").sort(),
          );
        return selectedNodeIds.length === 1 &&
          selectedNodeIds[0] === multiSelectNodeIds[0]
          ? selectedNodeIds
          : null;
      },
      "initial single selection",
      10_000,
    );
  } catch (error) {
    const diagnostics = await page.evaluate(({ point, nodeId }) => {
      const target = document.elementFromPoint(point.x, point.y);
      const node = document.querySelector(
        `.react-flow__node[data-id="${CSS.escape(nodeId)}"]`,
      );
      return {
        targetTag: target?.tagName ?? "",
        targetClass: target?.getAttribute("class") ?? "",
        targetNodeId:
          target?.closest(".react-flow__node")?.getAttribute("data-id") ?? "",
        nodeClass: node?.getAttribute("class") ?? "",
        selectedNodeIds: [...document.querySelectorAll(".react-flow__node.selected")]
          .map((candidate) => candidate.getAttribute("data-id") ?? "")
          .sort(),
        inspectorControlCount:
          document
            .querySelector('[data-testid="plot-canvas-inspector"]')
            ?.querySelectorAll("input, textarea, button").length ?? 0,
        activeElement: {
          tag: document.activeElement?.tagName ?? "",
          class: document.activeElement?.getAttribute("class") ?? "",
        },
      };
    }, { point: hitPoints[0], nodeId: multiSelectNodeIds[0] });
    throw new Error(
      `multi-select-first-click-failed: ${JSON.stringify({
        error: summarizeError(error),
        hitPoints,
        diagnostics,
      })}`,
    );
  }
  await page.keyboard.down("Control");
  try {
    await page.mouse.click(hitPoints[1].x, hitPoints[1].y);
  } finally {
    await page.keyboard.up("Control");
  }
  let lastObserved = null;
  let evidence;
  try {
    evidence = await poll(
      async () => {
        const current = await readWorkspaceEvidence(page);
        const selectedNodeIds = await page
          .locator(".react-flow__node.selected")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("data-id") ?? "").sort(),
          );
        lastObserved = { current, selectedNodeIds };
        return current.selectedNodeCount === 2 &&
          JSON.stringify(selectedNodeIds) ===
            JSON.stringify([...multiSelectNodeIds].sort())
          ? { current, selectedNodeIds }
          : null;
      },
      "actual multi-selection",
      10_000,
    );
  } catch (error) {
    throw new Error(
      `multi-select-state-failed: ${JSON.stringify({
        error: summarizeError(error),
        hitPoints,
        lastObserved,
      })}`,
    );
  }
  return {
    observedMs: performance.now() - startedAt,
    selectedNodeCount: evidence.current.selectedNodeCount,
    selectedNodeIds: evidence.selectedNodeIds,
    hitPoints,
  };
}

async function readNodePosition(page, nodeId) {
  return page
    .locator(`.react-flow__node[data-id="${nodeId}"]`)
    .evaluate((node) => {
      const transform = node.getAttribute("style") ?? "";
      const match = transform.match(
        /translate\(\s*(-?[0-9.]+)px\s*,\s*(-?[0-9.]+)px\s*\)/u,
      );
      return {
        id: node.getAttribute("data-id") ?? "",
        transform,
        x: match ? Number(match[1]) : null,
        y: match ? Number(match[2]) : null,
        selected: node.classList.contains("selected"),
      };
    });
}

async function waitForAutosave(page, expectedPhase, timeoutMs = 30_000) {
  await page
    .locator(
      `[data-testid="plot-canvas-workspace"][data-autosave-phase="${expectedPhase}"]`,
    )
    .waitFor({ timeout: timeoutMs });
}

async function waitForAutosaveMutation(page, code) {
  await waitForAutosave(page, "dirty", 5_000).catch(async () => {
    const phase = (await readWorkspaceEvidence(page)).autosavePhase;
    verify(phase === "saving" || phase === "saved", `${code}-never-dirty`, {
      phase,
    });
  });
  await waitForAutosave(page, "saved", 30_000);
}

async function dragTextNode(page, onCheckpoint = async () => undefined) {
  await focusExistingTextNode(page, dragNodeText, dragNodeText);
  await onCheckpoint("focus-complete");
  const node = page.locator(`.react-flow__node[data-id="${dragNodeId}"]`);
  const bounds = await node.boundingBox();
  verify(Boolean(bounds), "drag-node-bounds-missing");
  const before = await readNodePosition(page, dragNodeId);
  verify(
    Number.isFinite(before.x) && Number.isFinite(before.y),
    "drag-node-position-unreadable",
    before,
  );
  const start = {
    x: bounds.x + Math.min(80, bounds.width * 0.45),
    y: bounds.y + Math.min(40, bounds.height * 0.3),
  };
  const hit = await page.evaluate(({ x, y, nodeId }) => {
    const target = document.elementFromPoint(x, y);
    const node = document.querySelector(
      `.react-flow__node[data-id="${CSS.escape(nodeId)}"]`,
    );
    return {
      withinNode: Boolean(target && node?.contains(target)),
      targetTag: target?.tagName ?? "",
      targetClass:
        target instanceof HTMLElement || target instanceof SVGElement
          ? String(target.className)
          : "",
    };
  }, { ...start, nodeId: dragNodeId });
  verify(hit.withinNode, "drag-pointer-target-covered", { start, hit, bounds });

  const startedAt = performance.now();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 18, start.y + 14, { steps: 8 });
  await page.mouse.up();
  await onCheckpoint("pointer-up");
  const after = await poll(
    async () => {
      const current = await readNodePosition(page, dragNodeId);
      return current.transform !== before.transform ? current : null;
    },
    "actual pointer node drag",
    10_000,
  );
  const dragObservedMs = performance.now() - startedAt;
  const autosaveStartedAt = performance.now();
  await waitForAutosave(page, "dirty", 5_000).catch(async () => {
    const phase = (await readWorkspaceEvidence(page)).autosavePhase;
    verify(
      phase === "saving" || phase === "saved",
      "drag-autosave-never-dirty",
      { phase },
    );
  });
  await waitForAutosave(page, "saved", 30_000);
  await onCheckpoint("autosave-saved");
  return {
    dragObservedMs,
    autosaveObservedMs: performance.now() - autosaveStartedAt,
    pointer: { start, delta: { x: 18, y: 14 }, hit },
    before,
    after,
  };
}

async function addTextAndWaitForAutosave(page, value = textNodeValue) {
  const workspace = page.locator('[data-testid="plot-canvas-workspace"]');
  const beforeCount = Number(await workspace.getAttribute("data-node-count"));
  const startedAt = performance.now();
  await page.getByRole("button", { name: "텍스트", exact: true }).click();
  await poll(
    async () =>
      Number(await workspace.getAttribute("data-node-count")) === beforeCount + 1,
    "text node addition",
  );
  const editor = page
    .getByTestId("plot-canvas-inspector")
    .getByRole("textbox", { name: "텍스트" });
  await editor.fill(value);
  await waitForAutosave(page, "dirty", 5_000).catch(async () => {
    const phase = (await readWorkspaceEvidence(page)).autosavePhase;
    verify(
      phase === "saving" || phase === "saved",
      "text-add-autosave-never-dirty",
      { phase },
    );
  });
  await waitForAutosave(page, "saved", 30_000);
  const selectedNodeId = await page
    .locator(".react-flow__node.selected")
    .getAttribute("data-id");
  return {
    observedMs: performance.now() - startedAt,
    beforeCount,
    afterCount: Number(await workspace.getAttribute("data-node-count")),
    selectedNodeId,
    valueMatched: (await editor.inputValue()) === value,
    valueLength: (await editor.inputValue()).length,
  };
}

async function readNodeSize(page, nodeId) {
  return page
    .locator(`.react-flow__node[data-id="${nodeId}"]`)
    .evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        width: Number.parseFloat(style.width),
        height: Number.parseFloat(style.height),
      };
    });
}

async function resizeNodeWithUndoRedo(page, nodeId) {
  verify(Boolean(nodeId), "added-text-node-selection-missing");
  const node = page.locator(`.react-flow__node[data-id="${nodeId}"]`);
  await node.waitFor({ timeout: 10_000 });
  const before = await readNodeSize(page, nodeId);
  const inspector = page.getByTestId("plot-canvas-inspector");
  const widthInput = inspector.getByRole("spinbutton", {
    name: "너비",
    exact: true,
  });
  const heightInput = inspector.getByRole("spinbutton", {
    name: "높이",
    exact: true,
  });
  const expected = { width: before.width + 32, height: before.height + 24 };
  const startedAt = performance.now();
  await widthInput.fill(String(expected.width));
  await heightInput.fill(String(expected.height));
  const resized = await poll(
    async () => {
      const current = await readNodeSize(page, nodeId);
      return current.width === expected.width && current.height === expected.height
        ? current
        : null;
    },
    "inspector node resize",
    10_000,
  );
  await waitForAutosaveMutation(page, "resize-autosave");

  const toolbar = page.locator(".plot-canvas-toolbar");
  await toolbar.getByRole("button", { name: "실행 취소", exact: true }).click();
  const heightUndone = await poll(
    async () => {
      const current = await readNodeSize(page, nodeId);
      return current.width === expected.width && current.height === before.height
        ? current
        : null;
    },
    "height resize undo",
    10_000,
  );
  await waitForAutosaveMutation(page, "height-resize-undo-autosave");
  await toolbar.getByRole("button", { name: "실행 취소", exact: true }).click();
  const fullyUndone = await poll(
    async () => {
      const current = await readNodeSize(page, nodeId);
      return current.width === before.width && current.height === before.height
        ? current
        : null;
    },
    "width resize undo",
    10_000,
  );
  await waitForAutosaveMutation(page, "width-resize-undo-autosave");
  await toolbar.getByRole("button", { name: "다시 실행", exact: true }).click();
  const widthRedone = await poll(
    async () => {
      const current = await readNodeSize(page, nodeId);
      return current.width === expected.width && current.height === before.height
        ? current
        : null;
    },
    "width resize redo",
    10_000,
  );
  await waitForAutosaveMutation(page, "width-resize-redo-autosave");
  await toolbar.getByRole("button", { name: "다시 실행", exact: true }).click();
  const fullyRedone = await poll(
    async () => {
      const current = await readNodeSize(page, nodeId);
      return current.width === resized.width && current.height === resized.height
        ? current
        : null;
    },
    "height resize redo",
    10_000,
  );
  await waitForAutosaveMutation(page, "height-resize-redo-autosave");
  return {
    observedMs: performance.now() - startedAt,
    before,
    resized,
    undo: { height: heightUndone, full: fullyUndone },
    redo: { width: widthRedone, full: fullyRedone },
    controls: { width: true, height: true },
  };
}

async function createAndDeleteRegularEdge(page) {
  await fitView(page);
  const source = page.locator(
    `.react-flow__node[data-id="${regularEdgeSourceId}"] [data-handleid="source-right"]`,
  );
  const target = page.locator(
    `.react-flow__node[data-id="${regularEdgeTargetId}"] [data-handleid="target-left"]`,
  );
  const [sourceBounds, targetBounds] = await Promise.all([
    source.boundingBox(),
    target.boundingBox(),
  ]);
  verify(Boolean(sourceBounds) && Boolean(targetBounds), "edge-handle-bounds-missing", {
    sourcePresent: Boolean(sourceBounds),
    targetPresent: Boolean(targetBounds),
  });
  const from = {
    x: sourceBounds.x + sourceBounds.width / 2,
    y: sourceBounds.y + sourceBounds.height / 2,
  };
  const to = {
    x: targetBounds.x + targetBounds.width / 2,
    y: targetBounds.y + targetBounds.height / 2,
  };
  const handleHits = await page.evaluate(({ from, to }) => {
    const describe = ({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return {
        handleId: target?.closest(".react-flow__handle")?.getAttribute("data-handleid") ??
          "",
        targetClass: target?.getAttribute("class") ?? "",
      };
    };
    return { from: describe(from), to: describe(to) };
  }, { from, to });
  verify(
    handleHits.from.handleId === "source-right" &&
      handleHits.to.handleId === "target-left",
    "edge-pointer-target-covered",
    handleHits,
  );

  const workspace = page.locator('[data-testid="plot-canvas-workspace"]');
  const startedAt = performance.now();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await poll(
    async () => Number(await workspace.getAttribute("data-edge-count")) === 201,
    "regular canvas edge create",
    10_000,
  );
  await waitForAutosaveMutation(page, "edge-create-autosave");
  const selectedEdgeCount = await page.locator(".react-flow__edge.selected").count();
  verify(selectedEdgeCount === 1, "created-edge-not-selected", {
    selectedEdgeCount,
  });
  await page
    .locator(".plot-canvas-toolbar")
    .getByRole("button", { name: "삭제", exact: true })
    .click();
  await poll(
    async () => Number(await workspace.getAttribute("data-edge-count")) === 200,
    "regular canvas edge delete",
    10_000,
  );
  await waitForAutosaveMutation(page, "edge-delete-autosave");
  return {
    observedMs: performance.now() - startedAt,
    edgeCountAfterCreate: 201,
    edgeCountAfterDelete: 200,
    selectedEdgeCount,
    pointer: { from, to, handleHits },
  };
}

async function enterSnapshotMode(page) {
  await page.getByRole("button", { name: "Snapshot", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Named snapshot" });
  await panel.waitFor({ timeout: 30_000 });
  return panel;
}

async function createNamedSnapshotCheckpoint(page) {
  const panel = await enterSnapshotMode(page);
  const list = panel.getByRole("region", { name: "저장된 snapshot" });
  const beforeCount = await list.locator("li[data-snapshot-id]").count();
  await panel.getByRole("textbox", { name: "이름", exact: true }).fill(snapshotName);
  const startedAt = performance.now();
  await panel
    .getByRole("button", { name: "현재 프로젝트 snapshot 생성", exact: true })
    .click();
  const snapshotId = await poll(
    async () => {
      const items = list.locator("li[data-snapshot-id]");
      const matches = await items.evaluateAll((elements, expectedName) =>
        elements
          .filter(
            (element) =>
              element.querySelector("strong")?.textContent?.trim() === expectedName,
          )
          .map((element) => element.getAttribute("data-snapshot-id") ?? ""),
      snapshotName);
      const count = await items.count();
      return count === beforeCount + 1 && matches.length === 1 && matches[0]
        ? matches[0]
        : null;
    },
    "named snapshot create",
    30_000,
  );
  const item = list.locator(`li[data-snapshot-id="${snapshotId}"]`);
  const payloadVersion4 = await item
    .locator(".snapshot-metadata div")
    .evaluateAll((rows) =>
      rows.some(
        (row) =>
          row.querySelector("dt")?.textContent?.trim() === "형식" &&
          /\bv4\b/u.test(row.querySelector("dd")?.textContent ?? ""),
      ),
    );
  verify(payloadVersion4, "named-snapshot-payload-not-v4");
  return {
    snapshotId,
    beforeCount,
    afterCount: beforeCount + 1,
    payloadVersion: 4,
    observedMs: performance.now() - startedAt,
  };
}

async function diffAndRestoreNamedSnapshot(page, pageErrors, snapshot) {
  const panel = await enterSnapshotMode(page);
  const list = panel.getByRole("region", { name: "저장된 snapshot" });
  const item = list.locator(
    `li[data-snapshot-id="${snapshot.snapshotId}"]`,
  );
  verify((await item.count()) === 1, "named-snapshot-item-missing");
  const startedAt = performance.now();
  await item.getByRole("button", { name: "차이 보기", exact: true }).click();
  const diff = panel.getByRole("region", { name: "Snapshot 차이" });
  await diff.waitFor({ timeout: 30_000 });
  const counts = await diff.locator(".snapshot-diff").evaluate((summary) => {
    const rows = [...summary.querySelectorAll(":scope > div")];
    const valueFor = (label) =>
      rows
        .find((row) => row.querySelector("dt")?.textContent?.trim() === label)
        ?.querySelector("dd")
        ?.textContent?.replaceAll(/\s+/gu, " ")
        .trim() ?? "";
    const canvasMatch = valueFor("Plot Canvas").match(
      /\+(\d+)\s*·\s*−(\d+)\s*·\s*변경\s*(\d+)/u,
    );
    const elementMatch = valueFor("Canvas node/edge").match(
      /node\s*([+-]?\d+)\s*·\s*edge\s*([+-]?\d+)/u,
    );
    return {
      addedCanvases: canvasMatch ? Number(canvasMatch[1]) : null,
      deletedCanvases: canvasMatch ? Number(canvasMatch[2]) : null,
      changedCanvases: canvasMatch ? Number(canvasMatch[3]) : null,
      canvasNodeDelta: elementMatch ? Number(elementMatch[1]) : null,
      canvasEdgeDelta: elementMatch ? Number(elementMatch[2]) : null,
    };
  });
  verify(
    counts.addedCanvases === 0 &&
      counts.deletedCanvases === 0 &&
      counts.changedCanvases === 1 &&
      counts.canvasNodeDelta === 1 &&
      counts.canvasEdgeDelta === 0,
    "named-snapshot-canvas-diff-counts",
    counts,
  );

  await item
    .locator("button")
    .filter({ hasText: /^복원$/u })
    .click();
  const confirmation = page.getByRole("alertdialog");
  await confirmation.waitFor({ timeout: 30_000 });
  const confirmButton = confirmation.getByRole("button", {
    name: "안전 snapshot 생성 후 복원",
    exact: true,
  });
  await confirmButton.waitFor({ state: "visible", timeout: 30_000 });
  await poll(
    async () => (await confirmButton.isEnabled()) || null,
    "named snapshot restore diff ready",
    30_000,
  );
  await confirmButton.click();
  await confirmation.waitFor({ state: "hidden", timeout: 60_000 });
  const afterRestoreSnapshotCount = await poll(
    async () => {
      const count = await list.locator("li[data-snapshot-id]").count();
      return count === snapshot.afterCount + 1 ? count : null;
    },
    "automatic safety snapshot after restore",
    30_000,
  );
  await enterCanvasMode(page, pageErrors);
  return {
    observedMs: performance.now() - startedAt,
    payloadVersion: snapshot.payloadVersion,
    diff: counts,
    automaticSafetySnapshotCreated: true,
    afterRestoreSnapshotCount,
  };
}

async function assertCanvasListEntry(page, name, nodes, edges) {
  return poll(
    async () => {
      const entries = await readCanvasList(page);
      const entry = entries.find((candidate) => candidate.name === name);
      return entry &&
        entry.summary.includes(`노드 ${nodes}`) &&
        entry.summary.includes(`연결선 ${edges}`)
        ? entry
        : null;
    },
    `canvas list entry ${nodes}/${edges}`,
    30_000,
  );
}

async function waitForExport(path) {
  return poll(
    async () => {
      const fileStat = await stat(path).catch(() => null);
      return fileStat?.isFile() && fileStat.size > 0 ? fileStat : null;
    },
    "JSON Canvas export",
    15_000,
  );
}

async function runReloadProbe() {
  const fixtureStat = await stat(fixturePath);
  verify(fixtureStat.isFile() && fixtureStat.size > 0, "phase1e-fixture-missing", {
    fixturePath,
  });
  const coreStat = await stat(coreBinary);
  verify(coreStat.isFile() && coreStat.size > 0, "debug-core-missing", {
    coreBinary,
  });

  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "madi-phase1e-reload-probe-"),
  );
  const projectPath = join(temporaryDirectory, "phase1e-reload-probe.madi");
  const canvasPath = join(temporaryDirectory, "phase1e-reload-probe.canvas");
  const userDataPath = join(temporaryDirectory, "electron-user-data");
  const requestedReloadCeilingMs = Number(
    process.env.MADI_PHASE1E_RELOAD_CEILING_MS,
  );
  const reloadCeilingMs =
    Number.isSafeInteger(requestedReloadCeilingMs) &&
    requestedReloadCeilingMs >= 5_000 &&
    requestedReloadCeilingMs <= 60_000
      ? requestedReloadCeilingMs
      : 60_000;
  let run;
  let cpuSampleTimer;
  let evidenceWritten = false;
  const cpuSamples = [];
  const rendererDiagnosticTimeline = [];
  let observedRendererDiagnosticSignature = "[]";
  const checkpointRendererDiagnostics = async (stage, activeRun) => {
    await activeRun.page.waitForTimeout(50);
    const diagnostics = JSON.parse(
      JSON.stringify(activeRun.rendererErrorDiagnostics),
    );
    const signature = JSON.stringify(diagnostics);
    if (
      diagnostics.length > 0 &&
      signature !== observedRendererDiagnosticSignature
    ) {
      observedRendererDiagnosticSignature = signature;
      rendererDiagnosticTimeline.push({ stage, count: diagnostics.length, diagnostics });
    }
  };
  const partialEvidence = {
    phase: "1E",
    probe: "dragged-group-child-reload",
    mode: "development",
    fixturePath,
    projectPath,
    reloadCeilingMs,
  };
  try {
    await mkdir(artifactDirectory, { recursive: true });
    await copyFile(fixturePath, projectPath);
    reportStage("reload probe launching offline Electron process");
    run = await launchApplication({ projectPath, canvasPath, userDataPath });
    await openProject(run.page, run.pageErrors);
    await enterCanvasMode(run.page, run.pageErrors);
    await selectCanvas(run.page, largeCanvas);
    const dragRuns = [];
    for (let index = 0; index < measurementRuns; index += 1) {
      dragRuns.push(
        await dragTextNode(run.page, (phase) =>
          checkpointRendererDiagnostics(
            `reload-drag-${index + 1}-${phase}`,
            run,
          ),
        ),
      );
      await checkpointRendererDiagnostics(`reload-drag-${index + 1}`, run);
    }
    const drag = dragRuns.at(-1);
    await selectCanvas(run.page, generalCanvas);
    const beforeReload = await readWorkspaceEvidence(run.page);
    reportStage("reload probe five pointer drags saved and general canvas active");

    const item = await canvasListItemByName(run.page, largeCanvas);
    await item.evaluate((element) => {
      element.dataset.phase1eActivation = "pending";
      element.addEventListener(
        "click",
        () => {
          element.dataset.phase1eActivation = "observed";
        },
        { once: true },
      );
    });
    await item.focus();

    const reloadStartedAt = performance.now();
    const sampleCpu = () => {
      cpuSamples.push(
        sampleApplicationProcessTree(
          run.application,
          performance.now() - reloadStartedAt,
        ),
      );
    };
    sampleCpu();
    cpuSampleTimer = setInterval(sampleCpu, 2_000);
    const reloadAttempt = (async () => {
      await item.press("Enter");
      const workspace = await waitForCanvas(
        run.page,
        largeCanvas,
        reloadCeilingMs,
      );
      return { kind: "loaded", workspace };
    })().catch((error) => ({
      kind: "error",
      error: summarizeError(error),
    }));
    let ceilingTimer;
    const outcome = await Promise.race([
      reloadAttempt,
      new Promise((resolveCeiling) => {
        ceilingTimer = setTimeout(
          () => resolveCeiling({ kind: "timeout" }),
          reloadCeilingMs,
        );
      }),
    ]).finally(() => clearTimeout(ceilingTimer));
    clearInterval(cpuSampleTimer);
    cpuSampleTimer = undefined;
    sampleCpu();

    let afterReload = null;
    let reloadedPosition = null;
    if (outcome.kind === "loaded") {
      afterReload = outcome.workspace;
      reloadedPosition = await readNodePosition(run.page, dragNodeId);
    } else {
      await forceCloseApplication(run.application);
    }
    const firstCpu = cpuSamples.find((sample) => sample.available);
    const availableCpu = cpuSamples.filter((sample) => sample.available);
    const cpu = firstCpu
      ? {
          sampleCount: availableCpu.length,
          maxElectronCpuDeltaSeconds: roundMilliseconds(
            Math.max(
              0,
              ...availableCpu.map(
                (sample) =>
                  sample.maxElectronCpuSeconds - firstCpu.maxElectronCpuSeconds,
              ),
            ),
          ),
          coreCpuDeltaSeconds: roundMilliseconds(
            Math.max(
              0,
              ...availableCpu.map(
                (sample) => sample.coreCpuSeconds - firstCpu.coreCpuSeconds,
              ),
            ),
          ),
          samples: cpuSamples,
        }
      : { sampleCount: 0, samples: cpuSamples };
    const probeUrls = new Set([run.localFileProbeUrl]);
    const externalRuntimeRequestUrls = run.requestedUrls.filter(
      (url) => !probeUrls.has(url) && !isLocalRuntimeUrl(url),
    );
    const positionRestored =
      reloadedPosition !== null &&
      reloadedPosition.x === drag.after.x &&
      reloadedPosition.y === drag.after.y;
    const passed =
      outcome.kind === "loaded" &&
      afterReload.nodeCount === largeCanvas.nodes &&
      afterReload.edgeCount === largeCanvas.edges &&
      afterReload.renderedNodeCount === largeCanvas.nodes &&
      afterReload.renderedEdgeCount === largeCanvas.edges &&
      positionRestored &&
      run.pageErrors.length === 0 &&
      run.rendererErrorDiagnostics.length === 0 &&
      externalRuntimeRequestUrls.length === 0 &&
      !run.localFileProbe.readable;
    const evidence = {
      ...partialEvidence,
      status: passed ? "PASS" : "FAIL",
      outcome:
        outcome.kind === "loaded"
          ? { kind: outcome.kind }
          : outcome,
      elapsedMs: roundMilliseconds(performance.now() - reloadStartedAt),
      beforeReload,
      afterReload,
      drag: {
        runs: dragRuns,
        before: drag.before,
        after: drag.after,
        positionRestored,
      },
      cpu,
      pageErrors: run.pageErrors,
      rendererErrorDiagnostics: run.rendererErrorDiagnostics,
      rendererDiagnosticTimeline,
      security: {
        offline: true,
        externalRuntimeRequests: externalRuntimeRequestUrls.length,
        externalRuntimeRequestUrls: externalRuntimeRequestUrls.map(redactExternalUrl),
        localFileBlocked: !run.localFileProbe.readable,
      },
    };
    assertEvidencePrivacy(evidence);
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    evidenceWritten = true;
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    verify(passed, `reload-probe-${outcome.kind}`, {
      cpuSampleCount: availableCpu.length,
      pageErrorCount: run.pageErrors.length,
    });
    await closeWindowCleanly(run);
    run = undefined;
    return evidence;
  } catch (error) {
    if (!evidenceWritten) {
      const failureEvidence = {
        ...partialEvidence,
        status: "FAIL",
        error: summarizeError(error),
        cpuSamples,
        pageErrors: run?.pageErrors ?? [],
        rendererErrorDiagnostics: run?.rendererErrorDiagnostics ?? [],
        rendererDiagnosticTimeline,
      };
      assertEvidencePrivacy(failureEvidence);
      await mkdir(artifactDirectory, { recursive: true });
      await writeFile(
        evidencePath,
        `${JSON.stringify(failureEvidence, null, 2)}\n`,
        "utf8",
      );
    }
    throw new Error(
      `phase1e-reload-probe-failed: ${JSON.stringify(summarizeError(error))}`,
    );
  } finally {
    if (cpuSampleTimer) {
      clearInterval(cpuSampleTimer);
    }
    if (run) {
      await forceCloseApplication(run.application);
    }
    await new Promise((resolveCleanup) => setTimeout(resolveCleanup, 300));
    await rm(temporaryDirectory, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 250,
    }).catch(() => undefined);
  }
}

async function runSmoke() {
  const fixtureStat = await stat(fixturePath);
  verify(fixtureStat.isFile() && fixtureStat.size > 0, "phase1e-fixture-missing", {
    fixturePath,
  });
  if (packaged) {
    const executableStat = await stat(electronExecutable);
    verify(
      executableStat.isFile() && executableStat.size > 0,
      "packaged-executable-missing",
      { electronExecutable },
    );
  } else {
    const coreStat = await stat(coreBinary);
    verify(coreStat.isFile() && coreStat.size > 0, "debug-core-missing", {
      coreBinary,
    });
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "madi-phase1e-electron-"));
  const projectPath = join(temporaryDirectory, "phase1e-electron-copy.madi");
  const canvasPath = join(temporaryDirectory, "phase1e-general-export.canvas");
  const userDataPath = join(temporaryDirectory, "electron-user-data");
  let firstRun;
  let secondRun;
  let firstRunDiagnostics;
  let currentStage = "setup";
  let failureContext = {};
  const rendererDiagnosticTimeline = [];
  let observedRendererDiagnosticSignature = "[]";
  const checkpointRendererDiagnostics = async (stage, run) => {
    await run.page.waitForTimeout(50);
    const diagnostics = JSON.parse(
      JSON.stringify(run.rendererErrorDiagnostics),
    );
    const signature = JSON.stringify(diagnostics);
    if (
      diagnostics.length > 0 &&
      signature !== observedRendererDiagnosticSignature
    ) {
      observedRendererDiagnosticSignature = signature;
      rendererDiagnosticTimeline.push({
        stage,
        count: diagnostics.length,
        diagnostics,
      });
    }
  };
  const partialEvidence = {
    phase: "1E",
    mode: packaged ? "packaged" : "development",
    fixturePath,
    projectPath,
    canvasPath,
  };
  try {
    await mkdir(artifactDirectory, { recursive: true });
    await copyFile(fixturePath, projectPath);

    currentStage = "first-launch";
    reportStage("launching first offline Electron process");
    firstRun = await launchApplication({ projectPath, canvasPath, userDataPath });
    await openProject(firstRun.page, firstRun.pageErrors);
    await enterCanvasMode(firstRun.page, firstRun.pageErrors);
    reportStage("project open and Canvas mode ready");
    await checkpointRendererDiagnostics("canvas-ready", firstRun);

    const renderSamples = [];
    const renderEvidence = [];
    for (let index = 0; index < measurementRuns; index += 1) {
      await selectCanvas(firstRun.page, generalCanvas);
      const startedAt = performance.now();
      const current = await selectCanvas(firstRun.page, largeCanvas);
      renderSamples.push(performance.now() - startedAt);
      renderEvidence.push(current);
    }
    const largeRender = renderEvidence.at(-1);
    verify(
      largeRender.renderedNodeCount === largeCanvas.nodes &&
        largeRender.renderedEdgeCount === largeCanvas.edges,
      "large-canvas-rendered-dom-counts",
      largeRender,
    );
    reportStage("large 500/1000 rendered in five switch runs");
    await checkpointRendererDiagnostics("canvas-switch-runs", firstRun);

    const fitRuns = [];
    for (let index = 0; index < measurementRuns; index += 1) {
      fitRuns.push(await fitView(firstRun.page));
      await checkpointRendererDiagnostics(`canvas-fit-${index + 1}`, firstRun);
    }

    const searchRuns = [];
    for (let index = 0; index < measurementRuns; index += 1) {
      searchRuns.push(
        await focusExistingTextNode(firstRun.page, dragNodeText, dragNodeText),
      );
      await checkpointRendererDiagnostics(`canvas-search-${index + 1}`, firstRun);
    }

    const multiSelectionRuns = [];
    for (let index = 0; index < measurementRuns; index += 1) {
      multiSelectionRuns.push(await selectNodesWithModifier(firstRun.page));
      await checkpointRendererDiagnostics(
        `canvas-multi-selection-${index + 1}`,
        firstRun,
      );
    }
    verify(
      multiSelectionRuns.every((run) => run.selectedNodeCount >= 2),
      "multi-selection-five-runs",
      multiSelectionRuns,
    );

    const dragRuns = [];
    for (let index = 0; index < measurementRuns; index += 1) {
      dragRuns.push(
        await dragTextNode(firstRun.page, (phase) =>
          checkpointRendererDiagnostics(
            `canvas-drag-${index + 1}-${phase}`,
            firstRun,
          ),
        ),
      );
      await checkpointRendererDiagnostics(`canvas-drag-${index + 1}`, firstRun);
    }
    const dragBefore = dragRuns[0].before;
    const dragAfter = dragRuns.at(-1).after;
    verify(
      Math.abs(dragAfter.x - dragBefore.x) > 10 &&
        Math.abs(dragAfter.y - dragBefore.y) > 5,
      "five-pointer-drags-did-not-move-node",
      { dragBefore, dragAfter },
    );
    reportStage("fit/search/multi-select/pointer drag five-run evidence captured");
    await checkpointRendererDiagnostics("canvas-interactions", firstRun);

    await selectCanvas(firstRun.page, generalCanvas);
    const textAddition = await addTextAndWaitForAutosave(firstRun.page);
    await checkpointRendererDiagnostics("canvas-text-add", firstRun);
    verify(
      textAddition.afterCount === 101 && textAddition.valueMatched,
      "text-add-autosave-result",
      textAddition,
    );
    const resizeUndoRedo = await resizeNodeWithUndoRedo(
      firstRun.page,
      textAddition.selectedNodeId,
    );
    await checkpointRendererDiagnostics("canvas-resize-undo-redo", firstRun);
    const regularEdgeCreateDelete = await createAndDeleteRegularEdge(
      firstRun.page,
    );
    await checkpointRendererDiagnostics("canvas-edge-create-delete", firstRun);
    await assertCanvasListEntry(firstRun.page, generalCanvas.name, 101, 200);
    reportStage("text add, resize, Undo/Redo, and cap-safe edge create/delete verified");
    await checkpointRendererDiagnostics("canvas-editing", firstRun);

    await focusExistingTextNode(firstRun.page, textNodeValue, textNodeValue);
    const textEditor = firstRun.page
      .getByTestId("plot-canvas-inspector")
      .getByRole("textbox", { name: "텍스트" });
    await textEditor.fill(flushedTextNodeValue);
    await waitForAutosave(firstRun.page, "dirty", 5_000);
    const switchFlushStartedAt = performance.now();
    await selectCanvas(firstRun.page, largeCanvas);
    const switchFlushMs = performance.now() - switchFlushStartedAt;
    await selectCanvas(firstRun.page, {
      ...generalCanvas,
      nodes: 101,
    });
    await focusExistingTextNode(
      firstRun.page,
      flushedTextNodeValue,
      flushedTextNodeValue,
    );
    verify(
      (await textEditor.inputValue()) === flushedTextNodeValue,
      "canvas-switch-flush-text-missing",
    );
    reportStage("autosave and canvas-switch flush verified");
    await checkpointRendererDiagnostics("canvas-switch-flush", firstRun);

    await firstRun.page
      .getByRole("button", { name: ".canvas 내보내기", exact: true })
      .click();
    const exportedStat = await waitForExport(canvasPath);
    const exportedSource = await readFile(canvasPath, "utf8");
    const exportedDocument = JSON.parse(exportedSource);
    verify(
      exportedDocument.nodes?.length === 101 &&
        exportedDocument.edges?.length === 200,
      "exported-json-canvas-counts",
      {
        nodes: exportedDocument.nodes?.length,
        edges: exportedDocument.edges?.length,
      },
    );

    await firstRun.page
      .getByRole("button", { name: ".canvas 가져오기", exact: true })
      .click();
    const preview = firstRun.page.getByRole("dialog", {
      name: "JSON Canvas 가져오기 미리보기",
    });
    await preview.waitFor({ timeout: 15_000 });
    const previewText = (await preview.textContent())?.replaceAll(/\s+/gu, " ").trim();
    verify(
      previewText?.includes("노드 101개") && previewText.includes("연결선 200개"),
      "json-canvas-preview-counts",
      { previewTextLength: previewText?.length ?? 0 },
    );
    await preview.getByLabel("새 캔버스 이름").fill(importedCanvasName);
    await preview
      .getByRole("button", { name: "새 캔버스로 가져오기", exact: true })
      .click();
    const importedWorkspace = await poll(
      async () => {
        const current = await readWorkspaceEvidence(firstRun.page);
        return current.nodeCount === 101 &&
          current.edgeCount === 200 &&
          current.canvasId !== generalCanvas.id
          ? current
          : null;
      },
      "imported canvas active",
      30_000,
    );
    const importedEntry = await assertCanvasListEntry(
      firstRun.page,
      importedCanvasName,
      101,
      200,
    );
    const listAfterImport = await readCanvasList(firstRun.page);
    verify(listAfterImport.length === 12, "imported-canvas-list-count", {
      count: listAfterImport.length,
      entries: redactCanvasEntries(listAfterImport),
    });
    reportStage("JSON Canvas export, preview, and new-canvas import verified");
    await checkpointRendererDiagnostics("canvas-export-import", firstRun);

    await selectCanvas(firstRun.page, {
      ...generalCanvas,
      nodes: 101,
    });
    const namedSnapshotCreation = await createNamedSnapshotCheckpoint(firstRun.page);
    await enterCanvasMode(firstRun.page, firstRun.pageErrors);
    await waitForCanvas(firstRun.page, {
      ...generalCanvas,
      nodes: 101,
    });
    const snapshotMutation = await addTextAndWaitForAutosave(
      firstRun.page,
      snapshotMutationValue,
    );
    verify(
      snapshotMutation.afterCount === 102 && snapshotMutation.valueMatched,
      "named-snapshot-mutation-result",
      snapshotMutation,
    );
    const namedSnapshotRestore = await diffAndRestoreNamedSnapshot(
      firstRun.page,
      firstRun.pageErrors,
      namedSnapshotCreation,
    );
    await waitForCanvas(firstRun.page, {
      ...generalCanvas,
      nodes: 101,
    });
    await assertCanvasListEntry(firstRun.page, generalCanvas.name, 101, 200);
    await assertCanvasListEntry(
      firstRun.page,
      importedCanvasName,
      101,
      200,
    );
    reportStage("named snapshot v4 create, Canvas diff, and safe restore verified");
    await checkpointRendererDiagnostics("canvas-snapshot-restore", firstRun);

    await selectCanvas(firstRun.page, largeCanvas);
    await focusExistingTextNode(firstRun.page, dragNodeText, dragNodeText);
    await firstRun.page.waitForTimeout(800);
    const persistedDragPosition = await readNodePosition(firstRun.page, dragNodeId);
    verify(
      persistedDragPosition.x === dragAfter.x && persistedDragPosition.y === dragAfter.y,
      "drag-position-changed-before-close",
      { persistedDragPosition, dragAfter },
    );
    const currentBeforeClose = await readCanvasList(firstRun.page);
    verify(
      currentBeforeClose.find((entry) => entry.name === largeCanvas.name)?.current ===
        true,
      "last-canvas-not-large-before-close",
      redactCanvasEntries(currentBeforeClose),
    );
    await firstRun.page.screenshot({ path: firstScreenshotPath });

    const firstDialogEvidence = await readDialogEvidence(firstRun.application);
    const firstMadiDialogs = firstDialogEvidence.filter((call) =>
      call.extensions.includes("madi"),
    );
    const firstCanvasDialogs = firstDialogEvidence.filter((call) =>
      call.extensions.includes("canvas"),
    );
    verify(
      firstMadiDialogs.length === 1 &&
        firstMadiDialogs[0].selectedPath === projectPath &&
        firstCanvasDialogs.length === 2 &&
        firstCanvasDialogs.every((call) => call.selectedPath === canvasPath) &&
        firstCanvasDialogs.some((call) => call.kind === "save") &&
        firstCanvasDialogs.some((call) => call.kind === "open"),
      "dialog-filter-path-separation",
      firstDialogEvidence,
    );

    reportStage("closing first process through the real window lifecycle");
    await checkpointRendererDiagnostics("first-close-ready", firstRun);
    firstRunDiagnostics = {
      runtime: firstRun.runtime,
      requestedUrls: firstRun.requestedUrls,
      pageErrors: firstRun.pageErrors,
      rendererErrorDiagnostics: firstRun.rendererErrorDiagnostics,
      localFileProbeUrl: firstRun.localFileProbeUrl,
      localFileProbe: firstRun.localFileProbe,
    };
    await closeWindowCleanly(firstRun);
    firstRun = undefined;

    currentStage = "reopen-launch";
    reportStage("launching a new offline Electron process");
    secondRun = await launchApplication({ projectPath, canvasPath, userDataPath });
    currentStage = "reopen-project-open";
    reportStage("new offline Electron process launched");
    await openProject(secondRun.page, secondRun.pageErrors);
    currentStage = "reopen-canvas-mode";
    reportStage("reopened project loaded");
    await enterCanvasMode(secondRun.page, secondRun.pageErrors);
    currentStage = "reopen-large-canvas";
    reportStage("reopened Canvas mode ready");
    const reopenedLarge = await waitForCanvas(secondRun.page, largeCanvas);
    currentStage = "reopen-last-canvas";
    const reopenedList = await readCanvasList(secondRun.page);
    const reopenedCurrent = reopenedList.find((entry) => entry.current);
    failureContext = {
      reopenedCanvasCount: reopenedList.length,
      currentEntries: redactCanvasEntries(
        reopenedList.filter((entry) => entry.current),
      ),
    };
    verify(
      reopenedCurrent?.name === largeCanvas.name,
      "last-canvas-not-restored",
      {
        currentEntries: redactCanvasEntries(
          reopenedList.filter((entry) => entry.current),
        ),
        entries: redactCanvasEntries(reopenedList),
      },
    );
    currentStage = "reopen-general-entry";
    await assertCanvasListEntry(secondRun.page, generalCanvas.name, 101, 200);
    currentStage = "reopen-imported-entry";
    await assertCanvasListEntry(secondRun.page, importedCanvasName, 101, 200);
    currentStage = "reopen-canvas-count";
    verify(reopenedList.length === 12, "reopened-canvas-list-count", {
      count: reopenedList.length,
      entries: redactCanvasEntries(reopenedList),
    });
    currentStage = "reopen-drag-position-read";
    const reopenedDragPosition = await readNodePosition(
      secondRun.page,
      dragNodeId,
    );
    failureContext = {
      ...failureContext,
      reopenedDragPosition: {
        x: reopenedDragPosition.x,
        y: reopenedDragPosition.y,
        selected: reopenedDragPosition.selected,
      },
      persistedDragPosition: {
        x: persistedDragPosition.x,
        y: persistedDragPosition.y,
        selected: persistedDragPosition.selected,
      },
    };
    currentStage = "reopen-drag-position-match";
    verify(
      reopenedDragPosition.x === persistedDragPosition.x &&
        reopenedDragPosition.y === persistedDragPosition.y,
      "reopened-drag-position-mismatch",
      { reopenedDragPosition, persistedDragPosition },
    );
    currentStage = "reopen-screenshot";
    await secondRun.page.screenshot({ path: reopenedScreenshotPath });
    currentStage = "reopen-dialog-evidence";
    const secondDialogEvidence = await readDialogEvidence(secondRun.application);

    const runs = [firstRunDiagnostics, secondRun];
    const allRequests = [
      ...firstRunDiagnostics.requestedUrls,
      ...secondRun.requestedUrls,
    ];
    const probeUrls = new Set(
      runs.map((run) => run.localFileProbeUrl),
    );
    const externalRuntimeRequestUrls = allRequests.filter(
      (url) => !probeUrls.has(url) && !isLocalRuntimeUrl(url),
    );
    const allPageErrors = runs.flatMap((run) => run.pageErrors);
    const allRendererErrorDiagnostics = runs.flatMap(
      (run) => run.rendererErrorDiagnostics,
    );
    const localFileProbes = runs.map((run) => run.localFileProbe);
    failureContext = {
      ...failureContext,
      security: {
        externalRuntimeRequestCount: externalRuntimeRequestUrls.length,
        pageErrorCount: allPageErrors.length,
        rendererErrorDiagnosticCount: allRendererErrorDiagnostics.length,
        rendererErrorDiagnostics: allRendererErrorDiagnostics,
        rendererDiagnosticTimeline,
        localFileProbeCount: localFileProbes.length,
        localFileBlocked: localFileProbes.every((probe) => !probe.readable),
      },
    };
    currentStage = "security-external-requests";
    verify(
      externalRuntimeRequestUrls.length === 0,
      "external-runtime-requests-detected",
      externalRuntimeRequestUrls.map(redactExternalUrl),
    );
    currentStage = "security-page-errors";
    verify(allPageErrors.length === 0, "electron-page-errors", allPageErrors);
    currentStage = "security-renderer-diagnostics";
    verify(
      allRendererErrorDiagnostics.length === 0,
      "electron-renderer-error-diagnostics",
      allRendererErrorDiagnostics,
    );
    currentStage = "security-local-file";
    verify(
      localFileProbes.every((probe) => !probe.readable),
      "local-file-read-was-not-blocked",
      localFileProbes,
    );

    currentStage = "evidence-build";
    const evidence = {
      ...partialEvidence,
      status: "PASS",
      fixture: {
        bytes: fixtureStat.size,
        copiedBytes: (await stat(projectPath)).size,
      },
      runtime: {
        first: firstRunDiagnostics.runtime,
        reopened: secondRun.runtime,
      },
      counts: {
        initialCanvasCount: 11,
        afterImportCanvasCount: listAfterImport.length,
        reopenedCanvasCount: reopenedList.length,
        large: {
          canonicalNodes: reopenedLarge.nodeCount,
          canonicalEdges: reopenedLarge.edgeCount,
          renderedNodes: reopenedLarge.renderedNodeCount,
          renderedEdges: reopenedLarge.renderedEdgeCount,
        },
        editedGeneral: { nodes: 101, edges: 200 },
        imported: {
          id: importedWorkspace.canvasId,
          nodes: importedWorkspace.nodeCount,
          edges: importedWorkspace.edgeCount,
        },
      },
      measurements: {
        canvasSwitchRender: summarizeMeasurements(renderSamples),
        fitView: summarizeMeasurements(fitRuns.map((run) => run.observedMs)),
        ctrlKSearchFocus: summarizeMeasurements(
          searchRuns.map((run) => run.observedMs),
        ),
        multiSelection: summarizeMeasurements(
          multiSelectionRuns.map((run) => run.observedMs),
        ),
        pointerDrag: summarizeMeasurements(
          dragRuns.map((run) => run.dragObservedMs),
        ),
        dragAutosave: summarizeMeasurements(
          dragRuns.map((run) => run.autosaveObservedMs),
        ),
        textAddAutosave: summarizeMeasurements([textAddition.observedMs]),
        resizeUndoRedo: summarizeMeasurements([resizeUndoRedo.observedMs]),
        regularEdgeCreateDelete: summarizeMeasurements([
          regularEdgeCreateDelete.observedMs,
        ]),
        canvasSwitchFlush: summarizeMeasurements([switchFlushMs]),
        namedSnapshotCreate: summarizeMeasurements([
          namedSnapshotCreation.observedMs,
        ]),
        namedSnapshotDiffRestore: summarizeMeasurements([
          namedSnapshotRestore.observedMs,
        ]),
      },
      fitView: fitRuns,
      searchFocus: searchRuns,
      multiSelection: multiSelectionRuns,
      drag: {
        nodeId: dragNodeId,
        before: dragBefore,
        after: dragAfter,
        beforeClose: persistedDragPosition,
        reopened: reopenedDragPosition,
        runs: dragRuns,
      },
      textAddition,
      resizeUndoRedo,
      regularEdgeCreateDelete,
      exportImport: {
        exportedBytes: exportedStat.size,
        previewCountsMatched: true,
        previewTextLength: previewText?.length ?? 0,
        importedEntry: redactCanvasEntries([importedEntry])[0],
        importedCanvasId: importedWorkspace.canvasId,
      },
      namedSnapshot: {
        creation: namedSnapshotCreation,
        mutation: snapshotMutation,
        restore: namedSnapshotRestore,
      },
      persistence: {
        activeBeforeCloseMatched: true,
        activeAfterReopenMatched: true,
        draggedNodeRestored: true,
        generalCountsRestored: true,
        importedCountsRestored: true,
      },
      dialogs: {
        first: firstDialogEvidence,
        reopened: secondDialogEvidence,
        filterPathsSeparated: true,
      },
      security: {
        offline: true,
        externalRuntimeRequests: externalRuntimeRequestUrls.length,
        externalRuntimeRequestUrls: externalRuntimeRequestUrls.map(redactExternalUrl),
        pageErrors: allPageErrors,
        rendererErrorDiagnostics: allRendererErrorDiagnostics,
        localFileProbes,
        localFileBlocked: true,
      },
      screenshots: {
        firstRun: firstScreenshotPath,
        reopened: reopenedScreenshotPath,
      },
    };
    currentStage = "evidence-privacy";
    assertEvidencePrivacy(evidence);
    currentStage = "evidence-write";
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    currentStage = "second-close";
    await closeWindowCleanly(secondRun);
    secondRun = undefined;
    return evidence;
  } catch (error) {
    const diagnosticRun = firstRun ?? secondRun;
    const failureEvidence = {
      ...partialEvidence,
      status: "FAIL",
      stage: currentStage,
      context: failureContext,
      error: summarizeError(error),
      renderer: diagnosticRun
        ? await diagnosticRun.page
            .locator("body")
            .evaluate((body) => ({
              savePhase:
                body
                  .querySelector('[data-testid="save-status"]')
                  ?.getAttribute("data-phase") ?? "missing",
              alertCount: body.querySelectorAll('[role="alert"]').length,
              canvasModePresent: body.querySelector(".plot-canvas-mode") !== null,
              canvasListItemCount: body.querySelectorAll(
                '.plot-canvas-list [role="listitem"]',
              ).length,
              workspace: (() => {
                const workspace = body.querySelector(
                  '[data-testid="plot-canvas-workspace"]',
                );
                return workspace
                  ? {
                      canvasId: workspace.getAttribute("data-canvas-id") ?? "",
                      nodeCount: Number(workspace.getAttribute("data-node-count")),
                      edgeCount: Number(workspace.getAttribute("data-edge-count")),
                      autosavePhase:
                        workspace.getAttribute("data-autosave-phase") ?? "",
                      renderedNodeCount:
                        workspace.querySelectorAll(".react-flow__node").length,
                      renderedEdgeCount:
                        workspace.querySelectorAll(".react-flow__edge").length,
                      selectedNodeCount: workspace.querySelectorAll(
                        ".react-flow__node.selected",
                      ).length,
                    }
                  : null;
              })(),
            }))
            .catch(() => null)
        : null,
      pageErrors: diagnosticRun?.pageErrors ?? [],
      rendererErrorDiagnostics: diagnosticRun?.rendererErrorDiagnostics ?? [],
    };
    assertEvidencePrivacy(failureEvidence);
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(
      evidencePath,
      `${JSON.stringify(failureEvidence, null, 2)}\n`,
      "utf8",
    );
    throw new Error(
      `phase1e-smoke-failed: ${JSON.stringify(summarizeError(error))}`,
    );
  } finally {
    if (firstRun) {
      await forceCloseApplication(firstRun.application);
    }
    if (secondRun) {
      await forceCloseApplication(secondRun.application);
    }
    await new Promise((resolveCleanup) => setTimeout(resolveCleanup, 300));
    await rm(temporaryDirectory, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 250,
    }).catch(() => undefined);
  }
}

await (reloadProbe ? runReloadProbe() : runSmoke());
