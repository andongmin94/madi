import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  rm
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { _electron as electron } from "playwright-core";

const require = createRequire(import.meta.url);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const desktopDirectory = resolve(repositoryRoot, "apps", "desktop");
const desktopRequire = createRequire(
  new URL("../apps/desktop/package.json", import.meta.url)
);
const packagedExecutable = process.env.MADI_PACKAGED_EXE?.trim();
const electronExecutable =
  packagedExecutable || desktopRequire("electron");
const packaged = Boolean(packagedExecutable);
const executableName =
  process.platform === "win32" ? "madi-core.exe" : "madi-core";
const coreBinary = resolve(
  repositoryRoot,
  "crates",
  "madi-core",
  "target",
  "debug",
  executableName
);
const artifactDirectory = resolve(
  repositoryRoot,
  "output",
  "playwright"
);

function reportStage(stage) {
  process.stderr.write(`[electron-smoke] ${stage}\n`);
}

function isLocalRuntimeUrl(candidate) {
  const protocol = new URL(candidate).protocol;
  return ["madi:", "data:", "blob:", "devtools:"].includes(protocol);
}

async function launchApplication(projectPath, userDataPath) {
  const userDataArgument = `--user-data-dir=${userDataPath}`;
  const application = await electron.launch({
    executablePath: electronExecutable,
    args: packaged ? [userDataArgument] : [".", userDataArgument],
    cwd: packaged ? dirname(electronExecutable) : desktopDirectory,
    env: {
      ...process.env,
      ...(packaged ? {} : { MADI_CORE_BIN: coreBinary }),
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true"
    },
    timeout: 30_000
  });

  await application.evaluate(
    ({ dialog }, options) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: options.projectPath
      });
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [options.projectPath]
      });
    },
    { projectPath }
  );

  const page = await application.firstWindow({ timeout: 30_000 });
  const runtime = await application.evaluate(({ app }) => ({
    isPackaged: app.isPackaged,
    appName: app.getName(),
    userDataPath: app.getPath("userData")
  }));
  const requestedUrls = [];
  const pageErrors = [];
  page.on("request", (request) => requestedUrls.push(request.url()));
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.context().setOffline(true);
  await page.reload({ waitUntil: "load" });
  try {
    await page.locator(".engine-pill--ready").waitFor({ timeout: 30_000 });
  } catch (error) {
    const visibleState = await page
      .locator(".engine-state")
      .textContent()
      .catch(() => "engine state unavailable");
    throw new Error(
      `Electron editor did not become ready: ${visibleState}; page errors: ${JSON.stringify(
        pageErrors
      )}; ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const localFileProbeUrl = pathToFileURL(
    resolve(repositoryRoot, "package.json")
  ).toString();
  const localFileProbe = await page.evaluate(async (url) => {
    try {
      const response = await fetch(url);
      return {
        readable: response.ok,
        status: response.status
      };
    } catch {
      return {
        readable: false,
        status: 0
      };
    }
  }, localFileProbeUrl);

  return {
    application,
    page,
    requestedUrls,
    pageErrors,
    localFileProbeUrl,
    localFileProbe,
    runtime
  };
}

async function forceCloseApplication(application) {
  const childProcess = application.process();
  if (
    process.platform === "win32" &&
    childProcess.pid &&
    childProcess.exitCode === null
  ) {
    spawnSync(
      "taskkill",
      ["/PID", String(childProcess.pid), "/T", "/F"],
      {
        stdio: "ignore",
        timeout: 5_000,
        windowsHide: true
      }
    );
  } else if (
    childProcess.exitCode === null &&
    childProcess.signalCode === null
  ) {
    childProcess.kill();
  }
}

async function readDiagnostics(page) {
  return page.locator(".diagnostics").evaluate((element) =>
    Object.fromEntries(
      [...element.querySelectorAll(":scope > div")].map((row) => [
        row.querySelector("dt")?.textContent?.trim() ?? "",
        row.querySelector("dd")?.textContent?.trim() ?? ""
      ])
    )
  );
}

async function readCanvasEvidence(page) {
  return page.locator(".typie-runtime").evaluate((runtime) => {
    const canvases = [
      ...runtime.querySelectorAll(".typie-runtime__canvas")
    ];
    const canvas = canvases[0];
    if (!(canvas instanceof HTMLCanvasElement)) {
      return {
        width: 0,
        height: 0,
        pageCount: 0,
        allSurfacesRendered: false,
        nonTransparentSamples: 0,
        surfaceBackend: "unknown",
        frameKey: "unknown",
        renderRevision: "unknown",
        cursorPage: -1,
        semanticSceneBreaks: 0,
        fontDataMissingEvents: 0
      };
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return {
        width: canvas.width,
        height: canvas.height,
        pageCount: canvases.length,
        allSurfacesRendered: false,
        nonTransparentSamples: 0,
        surfaceBackend: canvas.dataset.surfaceBackend ?? "unknown",
        frameKey: canvas.dataset.frameKey ?? "unknown",
        renderRevision: canvas.dataset.renderRevision ?? "unknown",
        cursorPage: Number(canvas.dataset.cursorPage ?? "-1"),
        semanticSceneBreaks: Number(
          canvas.dataset.semanticSceneBreaks ?? "0"
        ),
        fontDataMissingEvents: Number(
          canvas.dataset.fontDataMissingEvents ?? "0"
        )
      };
    }

    const pixels = context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    ).data;
    const stride = Math.max(4, Math.floor(pixels.length / 8_000 / 4) * 4);
    let nonTransparentSamples = 0;
    for (let index = 3; index < pixels.length; index += stride) {
      if (pixels[index] !== 0) {
        nonTransparentSamples += 1;
      }
    }
    return {
      width: canvas.width,
      height: canvas.height,
      pageCount: canvases.length,
      allSurfacesRendered: canvases.every(
        (candidate) =>
          candidate instanceof HTMLCanvasElement &&
          candidate.dataset.frameKey !== "unavailable" &&
          candidate.dataset.surfaceBackend === "cpu"
      ),
      nonTransparentSamples,
      surfaceBackend: canvas.dataset.surfaceBackend ?? "unknown",
      frameKey: canvas.dataset.frameKey ?? "unknown",
      renderRevision: canvas.dataset.renderRevision ?? "unknown",
      cursorPage: Number(canvas.dataset.cursorPage ?? "-1"),
      semanticSceneBreaks: Number(
        canvas.dataset.semanticSceneBreaks ?? "0"
      ),
      fontDataMissingEvents: Number(
        canvas.dataset.fontDataMissingEvents ?? "0"
      )
    };
  });
}

function parseDiagnosticInteger(value) {
  const digits = value?.match(/[0-9,]+/)?.[0];
  return digits ? Number(digits.replaceAll(",", "")) : Number.NaN;
}

const temporaryWorkspace = await mkdtemp(
  join(tmpdir(), "madi-electron-smoke-")
);
const projectPath = join(temporaryWorkspace, "드래곤을죽이다.madi");
const userDataPath = join(temporaryWorkspace, "electron-user-data");
const firstScreenshot = join(
  artifactDirectory,
  packaged
    ? "madi-packaged-smoke-saved.png"
    : "madi-electron-smoke-saved.png"
);
const restoredScreenshot = join(
  artifactDirectory,
  packaged
    ? "madi-packaged-smoke-restored.png"
    : "madi-electron-smoke-restored.png"
);
const imeChecklistScreenshot = join(
  artifactDirectory,
  packaged
    ? "madi-packaged-ime-checklist.png"
    : "madi-electron-ime-checklist.png"
);

let firstApplication;
let secondApplication;

try {
  await mkdir(dirname(firstScreenshot), { recursive: true });

  const firstRun = await launchApplication(projectPath, userDataPath);
  firstApplication = firstRun.application;
  const firstPage = firstRun.page;
  reportStage("first window ready and offline reload complete");

  await firstPage.getByRole("button", { name: "새 프로젝트" }).click();
  const input = firstPage.locator(".typie-runtime__ime-input");
  await input.waitFor({ state: "attached", timeout: 30_000 });
  const longFixture = `첫 장면 ${"가나다라마바사아자차카타파하. ".repeat(
    340
  )}`;
  if (Array.from(longFixture).length < 5_000) {
    throw new Error("The automated multipage fixture is too short");
  }
  await input.fill(longFixture);
  await firstPage.getByRole("button", { name: "장면 구분선" }).click();
  await input.focus();
  await input.pressSequentially("둘째 장면", { delay: 10 });
  await firstPage.getByRole("button", { name: "저장" }).click();
  await firstPage
    .locator('[data-testid="save-status"][data-phase="saved"]')
    .waitFor({ timeout: 30_000 });
  await firstPage.waitForFunction(() => {
    const canvas = document.querySelector(".typie-runtime__canvas");
    return canvas instanceof HTMLCanvasElement && canvas.width > 0;
  });
  const secondPageSurface = firstPage
    .locator(".typie-runtime__canvas")
    .nth(1);
  await secondPageSurface.click({ position: { x: 220, y: 220 } });
  await firstPage.waitForFunction(() => {
    const canvas = document.querySelector(".typie-runtime__canvas");
    return canvas instanceof HTMLCanvasElement &&
      canvas.dataset.cursorPage === "1";
  });

  const canvas = await readCanvasEvidence(firstPage);
  await firstPage
    .getByRole("button", { name: "한국어 IME 체크" })
    .click();
  const imePanel = firstPage.getByRole("complementary", {
    name: "한국어 IME 수동 검사"
  });
  await imePanel
    .getByRole("button", { name: "모두 NOT TESTED로 초기화" })
    .click();
  await imePanel.evaluate((element) => {
    element.scrollTop = 0;
  });
  const imeResults = await imePanel
    .locator(".manual-result")
    .allTextContents();
  const imeChecklist = {
    itemCount: await imePanel.getByRole("checkbox").count(),
    notTestedCount: imeResults.filter(
      (result) => result.trim() === "NOT TESTED"
    ).length,
    autosaveStatus:
      (await imePanel.getByTestId("ime-autosave-status").textContent())?.trim() ??
      "",
    historyStateVisible: await imePanel
      .getByText(/최근 명령 기반 추정/)
      .isVisible(),
    compositionStateVisible: await imePanel
      .getByTestId("last-composition-event")
      .isVisible(),
    snapshotAction: await imePanel
      .getByRole("button", { name: "snapshot 지금 저장" })
      .isVisible(),
    reopenAction: await imePanel
      .getByRole("button", { name: "저장한 .madi 열기" })
      .isVisible(),
    jsonExport: await imePanel
      .getByRole("button", { name: "결과 JSON 내보내기" })
      .isVisible(),
    markdownExport: await imePanel
      .getByRole("button", { name: "결과 Markdown 내보내기" })
      .isVisible()
  };
  await firstPage.screenshot({ path: imeChecklistScreenshot });
  await firstPage.getByRole("button", { name: "개발 패널" }).click();
  const firstDiagnostics = await readDiagnostics(firstPage);
  await firstPage.screenshot({ path: firstScreenshot });
  reportStage("first document saved and UI evidence captured");

  if (
    firstRun.pageErrors.length > 0 ||
    firstRun.runtime.isPackaged !== packaged ||
    resolve(firstRun.runtime.userDataPath) !== resolve(userDataPath) ||
    firstRun.requestedUrls.some(
      (url) =>
        url !== firstRun.localFileProbeUrl && !isLocalRuntimeUrl(url)
    ) ||
    firstRun.localFileProbe.readable ||
    canvas.width === 0 ||
    canvas.height === 0 ||
    canvas.pageCount < 2 ||
    !canvas.allSurfacesRendered ||
    canvas.cursorPage !== 1 ||
    canvas.nonTransparentSamples === 0 ||
    canvas.surfaceBackend !== "cpu" ||
    canvas.frameKey === "unavailable" ||
    canvas.semanticSceneBreaks < 1 ||
    canvas.fontDataMissingEvents !== 0 ||
    imeChecklist.itemCount !== 15 ||
    imeChecklist.notTestedCount !== 15 ||
    imeChecklist.autosaveStatus !== "snapshot 저장됨" ||
    !imeChecklist.historyStateVisible ||
    !imeChecklist.compositionStateVisible ||
    !imeChecklist.snapshotAction ||
    !imeChecklist.reopenAction ||
    !imeChecklist.jsonExport ||
    !imeChecklist.markdownExport ||
    !firstDiagnostics.snapshot?.match(/^[1-9][0-9,]* bytes$/)
  ) {
    throw new Error(
      `The first Electron run did not produce valid local editor evidence: ${JSON.stringify(
        {
          pageErrors: firstRun.pageErrors,
          runtime: firstRun.runtime,
          externalUrls: firstRun.requestedUrls.filter(
            (url) =>
              url !== firstRun.localFileProbeUrl &&
              !isLocalRuntimeUrl(url)
          ),
          localFileProbe: firstRun.localFileProbe,
          canvas,
          imeChecklist,
          diagnostics: firstDiagnostics
        }
      )}`
    );
  }

  const dirtyCloseSuffix = " 종료 직전 자동 저장";
  await input.focus();
  await input.pressSequentially(dirtyCloseSuffix);
  await firstPage
    .locator('[data-testid="save-status"][data-phase="dirty"]')
    .waitFor({ timeout: 5_000 });
  const lifecycleEvents = new Set();
  let resolveLifecycle;
  const lifecycleComplete = new Promise((resolve) => {
    resolveLifecycle = resolve;
  });
  const onMainConsole = (message) => {
    const event = message.text();
    if (
      event === "[madi-smoke-main] will-quit" ||
      event === "[madi-smoke-main] quit"
    ) {
      lifecycleEvents.add(event);
      if (lifecycleEvents.size === 2) {
        resolveLifecycle();
      }
    }
  };
  firstApplication.on("console", onMainConsole);
  await firstApplication.evaluate(({ app }) => {
    app.once("will-quit", () =>
      console.log("[madi-smoke-main] will-quit")
    );
    app.once("quit", () =>
      console.log("[madi-smoke-main] quit")
    );
  });
  const windowClosed = firstPage.waitForEvent("close", {
    timeout: 10_000
  });
  reportStage("dirty close requested");
  await firstApplication.evaluate(({ BrowserWindow }) => {
    setTimeout(() => {
      BrowserWindow.getAllWindows()[0]?.close();
    }, 250);
  });
  await windowClosed;
  await Promise.race([
    lifecycleComplete,
    new Promise((_, rejectTimeout) => {
      setTimeout(
        () =>
          rejectTimeout(
            new Error(
              "Electron did not reach will-quit and quit after dirty close"
            )
          ),
        10_000
      );
    })
  ]);
  firstApplication.removeListener("console", onMainConsole);
  // Playwright 1.54 launches Windows Electron through a cmd.exe wrapper with
  // Node inspector enabled. The inspected process waits for debugger detach
  // even after Electron emitted quit, so clean up that test-only wrapper tree.
  await forceCloseApplication(firstApplication);
  firstApplication = undefined;
  reportStage("dirty close completed");

  const secondRun = await launchApplication(projectPath, userDataPath);
  secondApplication = secondRun.application;
  const secondPage = secondRun.page;
  reportStage("second window ready and offline reload complete");

  await secondPage.getByRole("button", { name: ".madi 열기" }).click();
  await secondPage
    .locator('[data-testid="save-status"][data-phase="saved"]')
    .waitFor({ timeout: 30_000 });
  const restoredDiagnostics = await readDiagnostics(secondPage);
  const restoredCanvas = await readCanvasEvidence(secondPage);
  await secondPage.screenshot({ path: restoredScreenshot });
  reportStage("restart restore evidence captured");

  if (
    secondRun.pageErrors.length > 0 ||
    secondRun.runtime.isPackaged !== packaged ||
    resolve(secondRun.runtime.userDataPath) !== resolve(userDataPath) ||
    secondRun.requestedUrls.some(
      (url) =>
        url !== secondRun.localFileProbeUrl && !isLocalRuntimeUrl(url)
    ) ||
    secondRun.localFileProbe.readable ||
    firstDiagnostics.fingerprint === restoredDiagnostics.fingerprint ||
    parseDiagnosticInteger(restoredDiagnostics.revision) !==
      parseDiagnosticInteger(firstDiagnostics.revision) + 1 ||
    parseDiagnosticInteger(restoredDiagnostics.recovery) !==
      parseDiagnosticInteger(firstDiagnostics.recovery) +
        Array.from(dirtyCloseSuffix).length ||
    restoredDiagnostics["파일"] !== "드래곤을죽이다.madi" ||
    restoredCanvas.nonTransparentSamples === 0 ||
    restoredCanvas.pageCount < 2 ||
    !restoredCanvas.allSurfacesRendered ||
    restoredCanvas.surfaceBackend !== "cpu" ||
    restoredCanvas.semanticSceneBreaks < 1 ||
    restoredCanvas.fontDataMissingEvents !== 0
  ) {
    throw new Error(
      `The restarted Electron app did not restore the same document: ${JSON.stringify(
        {
          pageErrors: secondRun.pageErrors,
          runtime: secondRun.runtime,
          externalUrls: secondRun.requestedUrls.filter(
            (url) =>
              url !== secondRun.localFileProbeUrl &&
              !isLocalRuntimeUrl(url)
          ),
          localFileProbe: secondRun.localFileProbe,
          firstDiagnostics,
          restoredDiagnostics,
          restoredCanvas
        }
      )}`
    );
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        electronWindow: true,
        packaged,
        appIsPackaged: firstRun.runtime.isPackaged,
        isolatedUserDataDirectory: true,
        typieWasmReady: true,
        canvas2dRendered: true,
        multipageSurfaceCount: canvas.pageCount,
        automatedFixtureCharacters: Array.from(longFixture).length,
        pageAwarePointerHitTest: true,
        imeChecklist,
        canvas,
        snapshotBeforeDirtyClose: firstDiagnostics.snapshot,
        restoredSnapshot: restoredDiagnostics.snapshot,
        dirtyCloseSave: {
          suffixCharacters: Array.from(dirtyCloseSuffix).length,
          revisionBefore: parseDiagnosticInteger(firstDiagnostics.revision),
          revisionAfter: parseDiagnosticInteger(restoredDiagnostics.revision),
          recoveryCharactersBefore: parseDiagnosticInteger(
            firstDiagnostics.recovery
          ),
          recoveryCharactersAfter: parseDiagnosticInteger(
            restoredDiagnostics.recovery
          )
        },
        processRestartRestore: true,
        restoredCanvas,
        arbitraryLocalFileReadBlocked: true,
        externalRuntimeRequests: 0,
        networkEmulationOffline: true,
        screenshots: [
          packaged
            ? "output/playwright/madi-packaged-smoke-saved.png"
            : "output/playwright/madi-electron-smoke-saved.png",
          packaged
            ? "output/playwright/madi-packaged-smoke-restored.png"
            : "output/playwright/madi-electron-smoke-restored.png",
          packaged
            ? "output/playwright/madi-packaged-ime-checklist.png"
            : "output/playwright/madi-electron-ime-checklist.png"
        ]
      },
      null,
      2
    )}\n`
  );
} finally {
  reportStage("cleanup started");
  if (firstApplication) {
    await forceCloseApplication(firstApplication);
  }
  if (secondApplication) {
    await forceCloseApplication(secondApplication);
  }
  const resolvedTemporaryWorkspace = resolve(temporaryWorkspace);
  const resolvedTemporaryRoot = resolve(tmpdir());
  const withinTemporaryRoot =
    resolvedTemporaryWorkspace.startsWith(`${resolvedTemporaryRoot}\\`) ||
    resolvedTemporaryWorkspace.startsWith(`${resolvedTemporaryRoot}/`);
  if (withinTemporaryRoot) {
    await rm(resolvedTemporaryWorkspace, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100
    });
  }
  reportStage("cleanup completed");
}
