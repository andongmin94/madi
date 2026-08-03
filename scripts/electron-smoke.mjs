import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  stat
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
  const requestedUrls = [];
  const pageErrors = [];
  application
    .context()
    .on("request", (request) => requestedUrls.push(request.url()));

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

const binderTypeLabels = {
  VOLUME: "권",
  CHAPTER: "화",
  SCENE: "장면"
};

function binderRows(page, type) {
  const typeSelector = type ? `[data-node-type="${type}"]` : "";
  return page.locator(
    `.binder [role="treeitem"]${typeSelector}[data-node-id]`
  );
}

function binderRowById(page, nodeId) {
  return page.locator(
    `.binder [role="treeitem"][data-node-id="${nodeId}"]`
  );
}

function directBinderRow(row) {
  return row.locator(":scope > .binder__row");
}

async function pollBinderUi(probe, description, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) {
      return value;
    }
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 50));
  }
  throw new Error(`Timed out while waiting for Binder UI: ${description}`);
}

async function binderNodeIds(page, type) {
  return binderRows(page, type).evaluateAll((elements) =>
    elements.map((element) => element.dataset.nodeId ?? "")
  );
}

async function binderRowByTitle(page, type, title) {
  const matches = await binderRows(page, type).evaluateAll(
    (elements, expectedTitle) =>
      elements
        .filter((element) => {
          const titleButton = element.querySelector(
            ":scope > .binder__row > .binder__title"
          );
          return titleButton?.textContent?.trim() === expectedTitle;
        })
        .map((element) => element.dataset.nodeId ?? ""),
    title
  );
  if (matches.length !== 1 || !matches[0]) {
    throw new Error(
      `Expected exactly one direct Binder ${type} row titled ${JSON.stringify(
        title
      )}, found ${matches.length}`
    );
  }
  return binderRowById(page, matches[0]);
}

async function waitForBinderTitle(page, nodeId, title) {
  await pollBinderUi(
    async () =>
      (
        (await directBinderRow(binderRowById(page, nodeId))
          .locator(":scope > .binder__title")
          .textContent()
          .catch(() => "")) ?? ""
      ).trim() === title,
    `node ${nodeId} title`
  );
}

async function pageWaitForSelectedBinderRow(page, nodeId) {
  if (!nodeId) {
    throw new Error("Selected Binder row is missing its node id");
  }
  await pollBinderUi(
    async () =>
      (await binderRowById(page, nodeId)
        .getAttribute("aria-selected")
        .catch(() => null)) === "true",
    `node ${nodeId} selection`
  );
}

async function renameBinderNode(page, nodeId, nextTitle) {
  const row = binderRowById(page, nodeId);
  const controls = directBinderRow(row);
  const currentTitle = (
    (await controls.locator(":scope > .binder__title").textContent()) ?? ""
  ).trim();
  if (!currentTitle) {
    throw new Error(`Binder node ${nodeId} has no direct title`);
  }
  await controls
    .getByRole("button", {
      name: `${currentTitle} 이름 변경`,
      exact: true
    })
    .click();
  await controls
    .getByRole("textbox", {
      name: `${currentTitle} 이름`,
      exact: true
    })
    .fill(nextTitle);
  await controls
    .getByRole("button", { name: "이름 저장", exact: true })
    .click();
  await waitForBinderTitle(page, nodeId, nextTitle);
}

async function addBinderChild(
  page,
  { parentType, parentTitle, childType, childTitle }
) {
  const beforeIds = new Set(await binderNodeIds(page, childType));
  const parentRow = await binderRowByTitle(page, parentType, parentTitle);
  const typeLabel = binderTypeLabels[childType];
  if (!typeLabel) {
    throw new Error(`Unsupported Binder child type: ${childType}`);
  }
  await directBinderRow(parentRow)
    .getByRole("button", {
      name: `${parentTitle}에 ${typeLabel} 추가`,
      exact: true
    })
    .click();

  const createdNodeId = await pollBinderUi(
    async () => {
      const created = (await binderNodeIds(page, childType)).filter(
        (nodeId) => !beforeIds.has(nodeId)
      );
      return created.length === 1 ? created[0] : "";
    },
    `${childType} creation`
  );
  if (typeof createdNodeId !== "string" || !createdNodeId) {
    throw new Error(`Binder ${childType} creation did not expose one new row`);
  }
  const createdRow = binderRowById(page, createdNodeId);
  await directBinderRow(createdRow).waitFor({
    state: "attached",
    timeout: 30_000
  });
  await pageWaitForSelectedBinderRow(page, createdNodeId);
  await renameBinderNode(page, createdNodeId, childTitle);
  return createdNodeId;
}

async function selectBinderScene(page, title) {
  const row = await binderRowByTitle(page, "SCENE", title);
  await directBinderRow(row)
    .getByRole("button", { name: title, exact: true })
    .click();
  await pageWaitForSelectedBinderRow(
    page,
    await row.getAttribute("data-node-id")
  );
  await page
    .locator('[data-testid="save-status"][data-phase="saved"]')
    .waitFor({ timeout: 30_000 });
}

async function waitForSiblingOrder(page, parentId, expectedNodeIds) {
  await pollBinderUi(
    async () => {
      const evidence = await readBinderEvidence(page);
      const children = evidence
        .filter((node) => node.parentId === parentId)
        .map((node) => node.id);
      return JSON.stringify(children) === JSON.stringify(expectedNodeIds);
    },
    `sibling order under ${parentId}`
  );
}

async function waitForBinderCounts(page, expectedCounts) {
  await pollBinderUi(
    async () => {
      const counts = await Promise.all(
        Object.keys(expectedCounts).map((type) => binderRows(page, type).count())
      );
      return Object.values(expectedCounts).every(
        (expected, index) => counts[index] === expected
      );
    },
    `counts ${JSON.stringify(expectedCounts)}`
  );
}

async function readBinderEvidence(page) {
  return binderRows(page).evaluateAll((elements) =>
    elements.map((element) => {
      const row = element.querySelector(":scope > .binder__row");
      const parent = element.parentElement?.closest(
        '[role="treeitem"][data-node-id]'
      );
      return {
        id: element.dataset.nodeId ?? "",
        type: element.dataset.nodeType ?? "",
        title:
          row?.querySelector(":scope > .binder__title")?.textContent?.trim() ??
          "",
        parentId: parent?.dataset.nodeId ?? null
      };
    })
  );
}

function verifyBinderEvidence(evidence, expectation, stage) {
  const actualCounts = Object.fromEntries(
    Object.keys(expectation.counts).map((type) => [
      type,
      evidence.filter((node) => node.type === type).length
    ])
  );
  const actualTitles = Object.fromEntries(
    Object.keys(expectation.titles).map((type) => [
      type,
      evidence
        .filter((node) => node.type === type)
        .map((node) => node.title)
        .sort()
    ])
  );
  const expectedTitles = Object.fromEntries(
    Object.entries(expectation.titles).map(([type, titles]) => [
      type,
      [...titles].sort()
    ])
  );
  const uniqueTitles = new Set(evidence.map((node) => node.title));
  const siblingOrder = evidence
    .filter((node) => node.parentId === expectation.siblingParentId)
    .map((node) => node.id);
  const hierarchyMatches = Object.entries(expectation.parentById).every(
    ([nodeId, parentId]) =>
      evidence.find((node) => node.id === nodeId)?.parentId === parentId
  );
  if (
    JSON.stringify(actualCounts) !== JSON.stringify(expectation.counts) ||
    JSON.stringify(actualTitles) !== JSON.stringify(expectedTitles) ||
    uniqueTitles.size !== evidence.length ||
    JSON.stringify(siblingOrder) !==
      JSON.stringify(expectation.siblingSceneIds) ||
    !hierarchyMatches
  ) {
    throw new Error(
      `${stage} Binder evidence mismatch: ${JSON.stringify({
        actualCounts,
        actualTitles,
        uniqueTitleCount: uniqueTitles.size,
        nodeCount: evidence.length,
        siblingOrder,
        hierarchyMatches
      })}`
    );
  }
  return { actualCounts, actualTitles, siblingOrder };
}

function storyEntityRows(page) {
  return page.locator(
    '.story-bible__entities li[data-entity-id]'
  );
}

function storyEntityRowById(page, entityId) {
  return page.locator(
    `.story-bible__entities li[data-entity-id="${entityId}"]`
  );
}

async function storyEntityIds(page) {
  return storyEntityRows(page).evaluateAll((elements) =>
    elements.map((element) => element.dataset.entityId ?? "")
  );
}

async function waitForStoryEntityId(page, name) {
  const entityId = await pollBinderUi(
    async () => {
      const matches = await storyEntityRows(page).evaluateAll(
        (elements, expectedName) =>
          elements
            .filter(
              (element) =>
                element.querySelector("strong")?.textContent?.trim() ===
                expectedName
            )
            .map((element) => element.dataset.entityId ?? ""),
        name
      );
      return matches.length === 1 ? matches[0] : "";
    },
    `Story Bible entity ${JSON.stringify(name)}`
  );
  if (typeof entityId !== "string" || !entityId) {
    throw new Error(`Story Bible entity ${JSON.stringify(name)} has no id`);
  }
  return entityId;
}

async function createStoryEntityThroughUi(page, kind) {
  const beforeIds = new Set(await storyEntityIds(page));
  await page
    .getByRole("combobox", { name: "새 설정 타입" })
    .selectOption(kind);
  await page.getByRole("button", { name: "새 엔트리 생성" }).click();
  const entityId = await pollBinderUi(
    async () => {
      const created = (await storyEntityIds(page)).filter(
        (candidate) => !beforeIds.has(candidate)
      );
      return created.length === 1 ? created[0] : "";
    },
    `Story Bible ${kind} creation`
  );
  if (typeof entityId !== "string" || !entityId) {
    throw new Error(`Story Bible ${kind} creation did not expose one id`);
  }
  await pollBinderUi(
    async () =>
      (await storyEntityRowById(page, entityId)
        .getByRole("button")
        .getAttribute("aria-current")) === "true",
    `Story Bible ${kind} selection`
  );
  return entityId;
}

function storyNoteInput(page) {
  return page.locator(
    ".story-bible__typie-mount .typie-runtime__ime-input"
  );
}

function singleParagraphImeProjection(text) {
  return `\u2028${text}\u2029`;
}

function snapshotItemByName(snapshotPanel, name) {
  return snapshotPanel
    .locator("li[data-snapshot-id]")
    .filter({ hasText: name });
}

async function readRendererHeapBytes(page) {
  return page.evaluate(() => {
    const memory = Reflect.get(performance, "memory");
    const usedJsHeapSize =
      memory && typeof memory === "object"
        ? Reflect.get(memory, "usedJSHeapSize")
        : null;
    return typeof usedJsHeapSize === "number" &&
      Number.isFinite(usedJsHeapSize)
      ? usedJsHeapSize
      : null;
  });
}

async function readWorldGraphEvidence(page) {
  return page.locator('[data-testid="world-graph-workspace"]').evaluate(
    (workspace) => {
      const numeric = (value) => {
        if (typeof value !== "string" || value.trim() === "") {
          return null;
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };
      const host = workspace.closest('[data-testid="world-graph-host"]');
      const canvasHost = workspace.querySelector(
        '[data-testid="world-graph-canvas"]'
      );
      const canvases = canvasHost
        ? [...canvasHost.querySelectorAll("canvas")]
        : [];
      const canvasDimensions = canvases.map((canvas) => ({
        width: canvas instanceof HTMLCanvasElement ? canvas.width : 0,
        height: canvas instanceof HTMLCanvasElement ? canvas.height : 0,
        clientWidth: canvas instanceof HTMLElement ? canvas.clientWidth : 0,
        clientHeight: canvas instanceof HTMLElement ? canvas.clientHeight : 0
      }));
      let nonTransparentSamples = 0;
      for (const canvas of canvases) {
        if (
          !(canvas instanceof HTMLCanvasElement) ||
          canvas.width === 0 ||
          canvas.height === 0
        ) {
          continue;
        }
        const context = canvas.getContext("2d");
        if (!context) {
          continue;
        }
        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height
        ).data;
        const stride = Math.max(
          4,
          Math.floor(pixels.length / 8_000 / 4) * 4
        );
        for (let index = 3; index < pixels.length; index += stride) {
          if (pixels[index] !== 0) {
            nonTransparentSamples += 1;
          }
        }
      }
      const nodeRegion = workspace.querySelector(
        '[aria-label="그래프 설정 목록"]'
      );
      const edgeRegion = workspace.querySelector(
        '[aria-label="그래프 관계 목록"]'
      );
      const stats = workspace.querySelector('[aria-label="그래프 통계"]');
      return {
        projectId: workspace.getAttribute("data-project-id") ?? "",
        revision: numeric(workspace.getAttribute("data-revision")),
        busy: workspace.getAttribute("aria-busy") === "true",
        state: {
          mode: workspace.getAttribute("data-mode") ?? "",
          depth: numeric(workspace.getAttribute("data-depth")),
          focusedEntityId:
            workspace.getAttribute("data-focused-entity-id") ?? "",
          selectedKind: workspace.getAttribute("data-selected-kind") ?? "",
          selectedId: workspace.getAttribute("data-selected-id") ?? "",
          layout: workspace.getAttribute("data-layout") ?? "",
          positionCount: numeric(
            workspace.getAttribute("data-position-count")
          ),
          viewport: {
            zoom: numeric(workspace.getAttribute("data-viewport-zoom")),
            panX: numeric(workspace.getAttribute("data-viewport-pan-x")),
            panY: numeric(workspace.getAttribute("data-viewport-pan-y"))
          },
          visibleNodeCount: numeric(
            workspace.getAttribute("data-visible-node-count")
          ),
          visibleEdgeCount: numeric(
            workspace.getAttribute("data-visible-edge-count")
          )
        },
        canvas: {
          elementCount: canvases.length,
          dimensions: canvasDimensions,
          nonTransparentSamples,
          hostWidth:
            canvasHost instanceof HTMLElement
              ? canvasHost.getBoundingClientRect().width
              : 0,
          hostHeight:
            canvasHost instanceof HTMLElement
              ? canvasHost.getBoundingClientRect().height
              : 0
        },
        accessible: {
          nodeIds: nodeRegion
            ? [...nodeRegion.querySelectorAll("button[data-entity-id]")].map(
                (button) => button.getAttribute("data-entity-id") ?? ""
              )
            : [],
          nodeLabels: nodeRegion
            ? [...nodeRegion.querySelectorAll("button[data-entity-id]")].map(
                (button) => button.textContent?.trim() ?? ""
              )
            : [],
          edgeIds: edgeRegion
            ? [...edgeRegion.querySelectorAll("button[data-relation-id]")].map(
                (button) => button.getAttribute("data-relation-id") ?? ""
              )
            : [],
          edgeLabels: edgeRegion
            ? [...edgeRegion.querySelectorAll("button[data-relation-id]")].map(
                (button) => button.textContent?.trim() ?? ""
              )
            : []
        },
        statsText: stats?.textContent?.replace(/\s+/gu, " ").trim() ?? "",
        performance: {
          ipcMs: numeric(host?.getAttribute("data-graph-ipc-ms") ?? null),
          elementConversionMs: numeric(
            host?.getAttribute("data-graph-elements-ms") ?? null
          ),
          filterMs: numeric(
            host?.getAttribute("data-graph-filter-ms") ?? null
          ),
          bfsMs: numeric(host?.getAttribute("data-graph-bfs-ms") ?? null),
          searchFocusMs: numeric(
            host?.getAttribute("data-graph-search-ms") ?? null
          ),
          layoutMs: numeric(
            host?.getAttribute("data-graph-layout-ms") ?? null
          ),
          displayMs: numeric(
            host?.getAttribute("data-graph-display-ms") ?? null
          )
        }
      };
    }
  );
}

async function waitForWorldGraph(page, expectedNodeCount, expectedEdgeCount) {
  const workspace = page.locator('[data-testid="world-graph-workspace"]');
  await workspace.waitFor({ state: "visible", timeout: 30_000 });
  const evidence = await pollBinderUi(
    async () => {
      const current = await readWorldGraphEvidence(page).catch(() => null);
      if (
        !current ||
        current.busy ||
        current.state.visibleNodeCount !== expectedNodeCount ||
        current.state.visibleEdgeCount !== expectedEdgeCount ||
        current.accessible.nodeIds.length !== expectedNodeCount ||
        current.accessible.edgeIds.length !== expectedEdgeCount ||
        current.canvas.elementCount === 0 ||
        current.canvas.hostWidth <= 0 ||
        current.canvas.hostHeight <= 0 ||
        current.canvas.nonTransparentSamples === 0 ||
        !current.canvas.dimensions.every(
          (dimension) => dimension.width > 0 && dimension.height > 0
        ) ||
        current.state.layout !== "preset" ||
        (current.state.positionCount ?? 0) < expectedNodeCount ||
        current.performance.ipcMs === null ||
        current.performance.elementConversionMs === null ||
        current.performance.filterMs === null ||
        current.performance.layoutMs === null ||
        current.performance.displayMs === null
      ) {
        return null;
      }
      return current;
    },
    `world graph ${expectedNodeCount} nodes and ${expectedEdgeCount} edges`,
    60_000
  );
  return evidence;
}

async function openWorldGraph(page, expectedNodeCount, expectedEdgeCount) {
  const heapBeforeBytes = await readRendererHeapBytes(page);
  const startedAt = Date.now();
  await page.getByRole("button", { name: "그래프", exact: true }).click();
  await page
    .locator('[data-testid="world-graph-workspace"]')
    .waitFor({ state: "visible", timeout: 30_000 });
  const workspaceVisibleMs = Date.now() - startedAt;
  const evidence = await waitForWorldGraph(
    page,
    expectedNodeCount,
    expectedEdgeCount
  );
  return {
    evidence,
    timing: {
      clickToWorkspaceVisibleMs: workspaceVisibleMs,
      clickToReadyMs: Date.now() - startedAt
    },
    memory: {
      heapBeforeBytes,
      heapAfterBytes: await readRendererHeapBytes(page)
    }
  };
}

async function openWorldGraphAccessibleList(page) {
  const details = page.locator("details.world-graph-accessible-list");
  if ((await details.getAttribute("open")) === null) {
    await details.locator("summary").click();
  }
  await details.locator('[aria-label="그래프 설정 목록"]').waitFor({
    state: "visible",
    timeout: 30_000
  });
}

async function openWorldGraphFilters(page) {
  const details = page.locator("details.world-graph-filter");
  if ((await details.getAttribute("open")) === null) {
    await details.locator("summary").click();
  }
  await details.getByRole("group", { name: "표시 방식" }).waitFor({
    state: "visible",
    timeout: 30_000
  });
}

async function waitForWorldGraphState(page, expectation, description) {
  return pollBinderUi(
    async () => {
      const evidence = await readWorldGraphEvidence(page).catch(() => null);
      if (!evidence || evidence.busy) {
        return null;
      }
      return Object.entries(expectation).every(
        ([key, value]) => evidence.state[key] === value
      )
        ? evidence
        : null;
    },
    description,
    60_000
  );
}

async function zoomWorldGraphCanvas(page) {
  const startedAt = performance.now();
  const canvas = page.locator('[data-testid="world-graph-canvas"]');
  const before = await readWorldGraphEvidence(page);
  const bounds = await canvas.boundingBox();
  if (!bounds) {
    throw new Error("World Graph canvas has no visible bounding box");
  }
  await page.mouse.move(
    bounds.x + bounds.width * 0.72,
    bounds.y + bounds.height * 0.72
  );
  const wheelDelta =
    (before.state.viewport.zoom ?? 1) >= 2.8 ? 480 : -480;
  await page.mouse.wheel(0, wheelDelta);
  const viewportChanged = async () => {
    const evidence = await readWorldGraphEvidence(page);
    const beforeViewport = before.state.viewport;
    const afterViewport = evidence.state.viewport;
    return beforeViewport.zoom !== null &&
      afterViewport.zoom !== null &&
      beforeViewport.panX !== null &&
      afterViewport.panX !== null &&
      beforeViewport.panY !== null &&
      afterViewport.panY !== null &&
      (Math.abs(afterViewport.zoom - beforeViewport.zoom) > 0.0001 ||
        Math.abs(afterViewport.panX - beforeViewport.panX) > 0.01 ||
        Math.abs(afterViewport.panY - beforeViewport.panY) > 0.01)
      ? evidence
      : null;
  };
  let method = "playwright-wheel";
  let after = await pollBinderUi(
    viewportChanged,
    "World Graph Playwright wheel viewport change",
    2_000
  ).catch(() => null);
  if (!after) {
    method = "cytoscape-dom-fallback";
    const changedThroughCytoscape = await canvas.evaluate((element) => {
      const registry = Reflect.get(element, "_cyreg");
      const cy =
        registry && typeof registry === "object"
          ? Reflect.get(registry, "cy")
          : null;
      if (
        !cy ||
        typeof cy.zoom !== "function" ||
        typeof cy.panBy !== "function"
      ) {
        return false;
      }
      const currentZoom = cy.zoom();
      cy.zoom(currentZoom >= 2.8 ? 2.35 : Math.min(3, currentZoom * 1.2));
      cy.panBy({ x: 31, y: 19 });
      return true;
    });
    if (!changedThroughCytoscape) {
      throw new Error("World Graph canvas did not expose its Cytoscape instance");
    }
    after = await pollBinderUi(
      viewportChanged,
      "World Graph deterministic Cytoscape viewport change",
      10_000
    );
  }
  return {
    method,
    before: before.state.viewport,
    after: after.state.viewport,
    observedMs: Number((performance.now() - startedAt).toFixed(2))
  };
}

async function readWorldGraphDataset(page) {
  return page.locator('[data-testid="world-graph-workspace"]').evaluate(
    (workspace) => {
      const numberAttribute = (name) => {
        const value = workspace.getAttribute(name);
        if (value === null || value === "") {
          return null;
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };
      const host = workspace.closest('[data-testid="world-graph-host"]');
      const hostNumber = (name) => {
        const value = host?.getAttribute(name);
        if (value === null || value === undefined || value === "") {
          return null;
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };
      return {
        projectId: workspace.getAttribute("data-project-id") ?? "",
        revision: numberAttribute("data-revision"),
        busy: workspace.getAttribute("aria-busy") === "true",
        mode: workspace.getAttribute("data-mode") ?? "",
        depth: numberAttribute("data-depth"),
        focusedEntityId:
          workspace.getAttribute("data-focused-entity-id") ?? "",
        selectedKind: workspace.getAttribute("data-selected-kind") ?? "",
        selectedId: workspace.getAttribute("data-selected-id") ?? "",
        layout: workspace.getAttribute("data-layout") ?? "",
        positionCount: numberAttribute("data-position-count"),
        selectedPosition: {
          x: numberAttribute("data-selected-position-x"),
          y: numberAttribute("data-selected-position-y")
        },
        totalNodeCount: numberAttribute("data-total-node-count"),
        totalEdgeCount: numberAttribute("data-total-edge-count"),
        viewport: {
          zoom: numberAttribute("data-viewport-zoom"),
          panX: numberAttribute("data-viewport-pan-x"),
          panY: numberAttribute("data-viewport-pan-y")
        },
        visibleNodeCount: numberAttribute("data-visible-node-count"),
        visibleEdgeCount: numberAttribute("data-visible-edge-count"),
        centerRequest: numberAttribute("data-center-request"),
        autoLayoutRequest: numberAttribute("data-auto-layout-request"),
        performance: {
          ipcMs: hostNumber("data-graph-ipc-ms"),
          elementConversionMs: hostNumber("data-graph-elements-ms"),
          filterMs: hostNumber("data-graph-filter-ms"),
          bfsMs: hostNumber("data-graph-bfs-ms"),
          searchFocusMs: hostNumber("data-graph-search-ms"),
          layoutMs: hostNumber("data-graph-layout-ms"),
          displayMs: hostNumber("data-graph-display-ms")
        }
      };
    }
  );
}

async function waitForScaleGraphState(page, expectation, description) {
  return pollBinderUi(
    async () => {
      const state = await readWorldGraphDataset(page).catch(() => null);
      if (!state || state.busy) {
        return null;
      }
      return Object.entries(expectation).every(
        ([key, value]) => state[key] === value
      )
        ? state
        : null;
    },
    description,
    60_000
  );
}

function maximumMetric(values) {
  return Math.max(...values.filter((value) => Number.isFinite(value)));
}

async function dragSelectedWorldGraphNode(page) {
  const canvas = page.locator('[data-testid="world-graph-canvas"]');
  for (const detailsSelector of [
    "details.world-graph-accessible-list",
    "details.world-graph-filter"
  ]) {
    const details = page.locator(detailsSelector);
    if ((await details.getAttribute("open")) !== null) {
      await details.locator("summary").click();
    }
  }
  await canvas.scrollIntoViewIfNeeded();

  let before = await readWorldGraphDataset(page);
  const previousCenterRequest = before.centerRequest;
  await page.getByRole("button", { name: "중심 그래프", exact: true }).click();
  await pollBinderUi(
    async () => {
      const current = await readWorldGraphDataset(page);
      return current.centerRequest !== previousCenterRequest ? current : null;
    },
    "scale selected node explicit center request"
  );
  await page.waitForTimeout(300);
  await canvas.scrollIntoViewIfNeeded();
  before = await readWorldGraphDataset(page);
  const bounds = await canvas.boundingBox();
  if (!bounds) {
    throw new Error("Scale World Graph canvas has no bounding box for drag");
  }

  const renderedEvidence = await canvas.evaluate((element, selectedId) => {
    const registry = Reflect.get(element, "_cyreg");
    const cy =
      registry && typeof registry === "object"
        ? Reflect.get(registry, "cy")
        : null;
    const node = cy?.getElementById?.(selectedId);
    if (!node?.nonempty?.()) {
      return null;
    }
    return {
      model: node.position(),
      rendered: node.renderedPosition(),
      renderedBounds: node.renderedBoundingBox(),
      zoom: cy.zoom(),
      pan: cy.pan(),
      grabbable: node.grabbable(),
      locked: node.locked()
    };
  }, before.selectedId);
  if (!renderedEvidence) {
    throw new Error("Selected scale node is absent from Cytoscape");
  }
  const formulaRendered = {
    x:
      before.selectedPosition.x * before.viewport.zoom +
      before.viewport.panX,
    y:
      before.selectedPosition.y * before.viewport.zoom +
      before.viewport.panY
  };
  const start = {
    pageX: bounds.x + renderedEvidence.rendered.x,
    pageY: bounds.y + renderedEvidence.rendered.y
  };
  if (
    start.pageX < bounds.x + 4 ||
    start.pageX > bounds.x + bounds.width - 4 ||
    start.pageY < bounds.y + 4 ||
    start.pageY > bounds.y + bounds.height - 4
  ) {
    throw new Error(
      `Selected scale node is outside the actual canvas: ${JSON.stringify({
        bounds,
        state: before,
        renderedEvidence,
        formulaRendered,
        start
      })}`
    );
  }

  const horizontalRoom = bounds.x + bounds.width - start.pageX;
  const verticalRoom = bounds.y + bounds.height - start.pageY;
  const deltaX = horizontalRoom > 80 ? 48 : -48;
  const deltaY = verticalRoom > 70 ? 36 : -36;
  const hitEvidence = await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    const host = document.querySelector('[data-testid="world-graph-canvas"]');
    return {
      withinCanvas: Boolean(target && host?.contains(target)),
      tagName: target?.tagName ?? "",
      className:
        target instanceof HTMLElement || target instanceof SVGElement
          ? String(target.className)
          : ""
    };
  }, { x: start.pageX, y: start.pageY });
  if (!hitEvidence.withinCanvas) {
    throw new Error(
      `Scale pointer target is covered: ${JSON.stringify({
        start,
        hitEvidence
      })}`
    );
  }
  await page.mouse.move(start.pageX, start.pageY);
  await page.mouse.down();
  await page.mouse.move(start.pageX + deltaX, start.pageY + deltaY, {
    steps: 10
  });
  await page.mouse.up();

  const after = await pollBinderUi(
    async () => {
      const current = await readWorldGraphDataset(page);
      const xChanged =
        Number.isFinite(current.selectedPosition.x) &&
        Math.abs(current.selectedPosition.x - before.selectedPosition.x) > 2;
      const yChanged =
        Number.isFinite(current.selectedPosition.y) &&
        Math.abs(current.selectedPosition.y - before.selectedPosition.y) > 2;
      return xChanged || yChanged ? current : null;
    },
    "scale actual pointer node drag",
    10_000
  );
  return {
    method: "playwright-pointer",
    entityId: before.selectedId,
    renderedStart: { x: start.pageX, y: start.pageY },
    renderedModelEvidence: renderedEvidence,
    formulaRendered,
    formulaDelta: {
      x: renderedEvidence.rendered.x - formulaRendered.x,
      y: renderedEvidence.rendered.y - formulaRendered.y
    },
    renderedDelta: { x: deltaX, y: deltaY },
    hitEvidence,
    before: before.selectedPosition,
    after: after.selectedPosition
  };
}

async function runPhase1dScaleElectronSmoke(scaleFixturePath) {
  const fixture = resolve(scaleFixturePath);
  const fixtureStats = await stat(fixture);
  if (!fixtureStats.isFile() || fixtureStats.size === 0) {
    throw new Error("Phase 1D scale fixture is missing or empty");
  }
  const scaleWorkspace = await mkdtemp(join(tmpdir(), "madi-scale-smoke-"));
  const scaleProjectPath = join(scaleWorkspace, "phase1d-scale-copy.madi");
  const scaleUserDataPath = join(scaleWorkspace, "electron-user-data");
  const scaleFullScreenshot = join(
    artifactDirectory,
    packaged
      ? "madi-packaged-phase1d-scale-full.png"
      : "madi-electron-phase1d-scale-full.png"
  );
  const scalePersistedScreenshot = join(
    artifactDirectory,
    packaged
      ? "madi-packaged-phase1d-scale-persisted.png"
      : "madi-electron-phase1d-scale-persisted.png"
  );
  const scaleReopenedScreenshot = join(
    artifactDirectory,
    packaged
      ? "madi-packaged-phase1d-scale-reopened.png"
      : "madi-electron-phase1d-scale-reopened.png"
  );
  let firstApplication;
  let secondApplication;
  try {
    await mkdir(artifactDirectory, { recursive: true });
    await copyFile(fixture, scaleProjectPath);
    const firstRun = await launchApplication(
      scaleProjectPath,
      scaleUserDataPath
    );
    firstApplication = firstRun.application;
    const firstPage = firstRun.page;
    reportStage("Phase 1D scale first window ready");
    await firstPage.getByRole("button", { name: ".madi 열기" }).click();
    try {
      await firstPage
        .locator('[data-testid="save-status"][data-phase="saved"]')
        .waitFor({ timeout: 60_000 });
    } catch (error) {
      const diagnostics = await firstPage.locator("body").evaluate((body) => ({
        savePhase:
          body.querySelector('[data-testid="save-status"]')?.getAttribute(
            "data-phase"
          ) ?? "missing",
        alerts: [...body.querySelectorAll('[role="alert"]')].map(
          (element) => element.textContent?.trim() ?? ""
        ),
        text: body.textContent?.slice(0, 2_000) ?? ""
      }));
      throw new Error(
        `Scale fixture did not open: ${JSON.stringify(diagnostics)}; ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    const firstEntry = await openWorldGraph(firstPage, 500, 2_000);
    const fullEvidence = firstEntry.evidence;
    if (
      fullEvidence.accessible.nodeIds.length !== 500 ||
      fullEvidence.accessible.edgeIds.length !== 2_000 ||
      fullEvidence.accessible.nodeIds[0] !== "scale-entity-000" ||
      fullEvidence.accessible.nodeIds.at(-1) !== "scale-entity-499" ||
      fullEvidence.state.positionCount !== 500 ||
      fullEvidence.canvas.elementCount === 0 ||
      fullEvidence.canvas.nonTransparentSamples === 0
    ) {
      throw new Error(
        `Scale full graph evidence is incomplete: ${JSON.stringify({
          state: fullEvidence.state,
          nodeCount: fullEvidence.accessible.nodeIds.length,
          edgeCount: fullEvidence.accessible.edgeIds.length,
          firstNode: fullEvidence.accessible.nodeIds[0],
          lastNode: fullEvidence.accessible.nodeIds.at(-1),
          canvas: fullEvidence.canvas
        })}`
      );
    }
    await firstPage.screenshot({ path: scaleFullScreenshot });

    const initialGraphReady = {
      reportedLayoutMs: fullEvidence.performance.layoutMs,
      observedReadyMs: firstEntry.timing.clickToReadyMs
    };
    const layoutRuns = [];
    const workspace = firstPage.locator(
      '[data-testid="world-graph-workspace"]'
    );
    for (let run = 1; run <= 5; run += 1) {
      const startedAt = performance.now();
      await firstPage
        .getByRole("button", { name: "자동 배치 다시 실행", exact: true })
        .click();
      await pollBinderUi(
        async () =>
          Number(await workspace.getAttribute("data-auto-layout-request")) ===
          run,
        `scale automatic layout request ${run}`,
        30_000
      );
      await firstPage.evaluate(
        () =>
          new Promise((resolveFrame) =>
            requestAnimationFrame(() => requestAnimationFrame(resolveFrame))
          )
      );
      const state = await pollBinderUi(
        async () => {
          const current = await readWorldGraphDataset(firstPage);
          return current.performance.layoutMs !== null &&
            current.positionCount === 500
            ? current
            : null;
        },
        `scale automatic layout completion ${run}`,
        30_000
      );
      layoutRuns.push({
        run,
        reportedMs: state.performance.layoutMs,
        observedReadyMs: Number((performance.now() - startedAt).toFixed(2))
      });
    }

    await openWorldGraphFilters(firstPage);
    const scaleTagFilter = firstPage
      .getByRole("group", { name: "태그" })
      .locator('input[value="scale-tag-7"]');
    const filterStartedAt = performance.now();
    await scaleTagFilter.check();
    const taggedEvidence = await waitForWorldGraph(firstPage, 25, 0);
    const filterObservedMs = Number(
      (performance.now() - filterStartedAt).toFixed(2)
    );
    await scaleTagFilter.uncheck();
    await waitForWorldGraph(firstPage, 500, 2_000);
    const relationTypeFilter = firstPage
      .getByRole("group", { name: "관계 타입" })
      .locator('input[value="phase-1d-project:builtin-membership"]');
    await relationTypeFilter.check();
    const directionFilter = firstPage.getByRole("combobox", {
      name: "관계 방향 필터"
    });
    await directionFilter.selectOption("DIRECTED");
    const labelFilter = firstPage.getByRole("checkbox", {
      name: "관계 label 표시",
      exact: true
    });
    await labelFilter.uncheck();
    await waitForWorldGraph(firstPage, 500, 2_000);

    const searchStartedAt = performance.now();
    const search = firstPage.locator('[data-testid="world-graph-search"]');
    await search.fill("별칭 321-2");
    const searchResults = firstPage.getByRole("list", {
      name: "세계관 설정 검색 결과"
    });
    const searchedEntityId = "scale-entity-321";
    await searchResults
      .locator(`button[data-entity-id="${searchedEntityId}"]`)
      .waitFor({ state: "visible", timeout: 30_000 });
    const searchResultReadyMs = Number(
      (performance.now() - searchStartedAt).toFixed(2)
    );
    const searchResultCount = await searchResults
      .locator("button[data-entity-id]")
      .count();
    const searchFocusStartedAt = performance.now();
    await searchResults
      .locator(`button[data-entity-id="${searchedEntityId}"]`)
      .click();
    const searchedState = await pollBinderUi(
      async () => {
        const current = await readWorldGraphDataset(firstPage);
        return current.selectedKind === "NODE" &&
          current.selectedId === searchedEntityId
          ? current
          : null;
      },
      "scale alias search focus"
    );
    const searchFocusObservedMs = Number(
      (performance.now() - searchFocusStartedAt).toFixed(2)
    );

    await openWorldGraphAccessibleList(firstPage);
    const selectionEntityId = "scale-entity-400";
    const selectionStartedAt = performance.now();
    await firstPage
      .getByRole("region", { name: "그래프 설정 목록" })
      .locator(`button[data-entity-id="${selectionEntityId}"]`)
      .click();
    await pollBinderUi(
      async () => {
        const current = await readWorldGraphDataset(firstPage);
        return current.selectedKind === "NODE" &&
          current.selectedId === selectionEntityId;
      },
      "scale accessible node selection response"
    );
    const selectionObservedMs = Number(
      (performance.now() - selectionStartedAt).toFixed(2)
    );
    await firstPage
      .locator('[data-testid="world-graph-detail"]')
      .getByRole("heading", { name: "대규모 설정 400", exact: true })
      .waitFor({ timeout: 30_000 });
    const detailObservedMs = Number(
      (performance.now() - selectionStartedAt).toFixed(2)
    );

    const focusedEntityId = "scale-entity-000";
    const focusRuns = [];
    const centerStartedAt = performance.now();
    await firstPage
      .getByRole("combobox", { name: "중심 설정" })
      .selectOption(focusedEntityId);
    const focusExpectations = [
      { depth: 1, nodes: 9, edges: 26 },
      { depth: 2, nodes: 17, edges: 58 },
      { depth: 3, nodes: 25, edges: 90 }
    ];
    for (const expectation of focusExpectations) {
      const startedAt =
        expectation.depth === 1 ? centerStartedAt : performance.now();
      if (expectation.depth !== 1) {
        await firstPage
          .getByRole("combobox", { name: "중심 그래프 깊이" })
          .selectOption(String(expectation.depth));
      }
      await waitForWorldGraph(
        firstPage,
        expectation.nodes,
        expectation.edges
      );
      const focusedState = await waitForScaleGraphState(
        firstPage,
        {
          mode: "FOCUSED",
          depth: expectation.depth,
          focusedEntityId
        },
        `scale focused depth ${expectation.depth}`
      );
      focusRuns.push({
        depth: expectation.depth,
        visibleNodeCount: focusedState.visibleNodeCount,
        visibleEdgeCount: focusedState.visibleEdgeCount,
        bfsMs: focusedState.performance.bfsMs,
        observedMs: Number((performance.now() - startedAt).toFixed(2))
      });
    }

    await openWorldGraphAccessibleList(firstPage);
    await firstPage
      .getByRole("region", { name: "그래프 설정 목록" })
      .locator(`button[data-entity-id="${focusedEntityId}"]`)
      .click();
    await waitForScaleGraphState(
      firstPage,
      {
        selectedKind: "NODE",
        selectedId: focusedEntityId,
        positionCount: 500,
        totalNodeCount: 500,
        totalEdgeCount: 2_000
      },
      "scale selected node before pointer drag"
    );
    const canonicalBefore = {
      projectId: fullEvidence.projectId,
      revision: fullEvidence.revision,
      nodeCount: fullEvidence.accessible.nodeIds.length,
      edgeCount: fullEvidence.accessible.edgeIds.length
    };
    const dragInteraction = await dragSelectedWorldGraphNode(firstPage);
    const viewportInteraction = await zoomWorldGraphCanvas(firstPage);
    const persistedState = await waitForScaleGraphState(
      firstPage,
      {
        mode: "FOCUSED",
        depth: 3,
        focusedEntityId,
        selectedKind: "NODE",
        selectedId: focusedEntityId,
        layout: "preset",
        positionCount: 500,
        visibleNodeCount: 25,
        visibleEdgeCount: 90
      },
      "scale final persisted state"
    );
    const canonicalAfter = {
      projectId: persistedState.projectId,
      revision: persistedState.revision,
      nodeCount: persistedState.totalNodeCount,
      edgeCount: persistedState.totalEdgeCount
    };
    if (
      canonicalBefore.projectId !== canonicalAfter.projectId ||
      canonicalBefore.revision !== canonicalAfter.revision ||
      canonicalBefore.nodeCount !== canonicalAfter.nodeCount ||
      canonicalBefore.edgeCount !== canonicalAfter.edgeCount ||
      dragInteraction.entityId !== focusedEntityId
    ) {
      throw new Error(
        `Scale pointer drag changed canonical graph data: ${JSON.stringify({
          canonicalBefore,
          canonicalAfter,
          dragInteraction
        })}`
      );
    }
    await firstPage.waitForTimeout(900);
    await firstPage.screenshot({ path: scalePersistedScreenshot });

    const layoutReported = layoutRuns.map((run) => run.reportedMs ?? NaN);
    const focusedBfs = focusRuns.map((run) => run.bfsMs ?? NaN);
    const conditionalBreaches = [];
    const recordConditionalBreach = (metric, targetMs, actualMs) => {
      if (Number.isFinite(actualMs) && actualMs > targetMs) {
        conditionalBreaches.push({ metric, targetMs, actualMs });
      }
    };
    recordConditionalBreach(
      "graph read model + IPC",
      1_000,
      fullEvidence.performance.ipcMs
    );
    recordConditionalBreach(
      "tag filter observed response",
      250,
      filterObservedMs
    );
    recordConditionalBreach(
      "alias search result ready",
      250,
      searchResultReadyMs
    );
    recordConditionalBreach(
      "alias search result click to focus",
      250,
      searchFocusObservedMs
    );
    recordConditionalBreach(
      "node selection response",
      250,
      selectionObservedMs
    );
    recordConditionalBreach(
      "node selection to detail heading",
      250,
      detailObservedMs
    );
    recordConditionalBreach(
      "pan/zoom response",
      250,
      viewportInteraction.observedMs
    );
    for (const run of focusRuns) {
      recordConditionalBreach(
        `focused depth ${run.depth} observed response`,
        250,
        run.observedMs
      );
    }
    if (
      searchResultCount !== 1 ||
      fullEvidence.performance.ipcMs === null ||
      !layoutReported.every((value) => Number.isFinite(value)) ||
      maximumMetric(layoutReported) > 5_000 ||
      initialGraphReady.observedReadyMs > 5_000 ||
      !focusedBfs.every((value) => Number.isFinite(value)) ||
      firstRun.pageErrors.length > 0 ||
      firstRun.requestedUrls.some(
        (url) =>
          url !== firstRun.localFileProbeUrl && !isLocalRuntimeUrl(url)
      ) ||
      firstRun.localFileProbe.readable
    ) {
      throw new Error(
        `Phase 1D scale first-run gate failed: ${JSON.stringify({
          searchResultCount,
          graphPerformance: fullEvidence.performance,
          initialGraphReady,
          layoutRuns,
          filterObservedMs,
          filterMs: taggedEvidence.performance.filterMs,
          searchResultReadyMs,
          searchFocusObservedMs,
          searchFocusMs: searchedState.performance.searchFocusMs,
          focusRuns,
          selectionObservedMs,
          detailObservedMs,
          viewportInteraction,
          pageErrors: firstRun.pageErrors
        })}`
      );
    }

    const firstWindowClosed = firstPage.waitForEvent("close", {
      timeout: 30_000
    });
    await firstApplication.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close();
    });
    await firstWindowClosed;
    await forceCloseApplication(firstApplication);
    firstApplication = undefined;
    reportStage("Phase 1D scale first process closed with UI state saved");

    const secondRun = await launchApplication(
      scaleProjectPath,
      scaleUserDataPath
    );
    secondApplication = secondRun.application;
    const secondPage = secondRun.page;
    await secondPage.getByRole("button", { name: ".madi 열기" }).click();
    await secondPage
      .locator('[data-testid="save-status"][data-phase="saved"]')
      .waitFor({ timeout: 30_000 });
    let reopenedEntry;
    try {
      reopenedEntry = await openWorldGraph(secondPage, 25, 90);
    } catch (error) {
      const [dataset, evidence, pageState] = await Promise.all([
        readWorldGraphDataset(secondPage).catch((failure) => ({
          error: failure instanceof Error ? failure.message : String(failure)
        })),
        readWorldGraphEvidence(secondPage).catch((failure) => ({
          error: failure instanceof Error ? failure.message : String(failure)
        })),
        secondPage.locator("body").evaluate((body) => ({
          savePhase:
            body.querySelector('[data-testid="save-status"]')?.getAttribute(
              "data-phase"
            ) ?? "missing",
          alerts: [...body.querySelectorAll('[role="alert"]')].map(
            (element) => element.textContent?.trim() ?? ""
          )
        }))
      ]);
      throw new Error(
        `Phase 1D scale reopen readiness failed: ${JSON.stringify({
          dataset,
          evidence,
          pageState
        })}; ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const reopenedEvidence = reopenedEntry.evidence;
    await openWorldGraphFilters(secondPage);
    await openWorldGraphAccessibleList(secondPage);
    const reopenedState = await readWorldGraphDataset(secondPage);
    const viewportMatches = ["zoom", "panX", "panY"].every((key) => {
      const expected = persistedState.viewport[key];
      const actual = reopenedState.viewport[key];
      return (
        typeof expected === "number" &&
        typeof actual === "number" &&
        Math.abs(expected - actual) < 0.001
      );
    });
    const reopenedRelationTypeFilter = secondPage
      .getByRole("group", { name: "관계 타입" })
      .locator('input[value="phase-1d-project:builtin-membership"]');
    const reopenedDirectionFilter = secondPage.getByRole("combobox", {
      name: "관계 방향 필터"
    });
    const reopenedLabelFilter = secondPage.getByRole("checkbox", {
      name: "관계 label 표시",
      exact: true
    });
    const dragPositionMatches = ["x", "y"].every((key) => {
      const expected = dragInteraction.after[key];
      const actual = reopenedState.selectedPosition[key];
      return (
        typeof expected === "number" &&
        typeof actual === "number" &&
        Math.abs(expected - actual) < 0.001
      );
    });
    const reopenedCanonical = {
      projectId: reopenedState.projectId,
      revision: reopenedState.revision,
      nodeCount: reopenedState.totalNodeCount,
      edgeCount: reopenedState.totalEdgeCount
    };
    recordConditionalBreach(
      "restart graph read model + IPC",
      1_000,
      reopenedEvidence.performance.ipcMs
    );
    if (
      reopenedState.mode !== "FOCUSED" ||
      reopenedState.depth !== 3 ||
      reopenedState.focusedEntityId !== focusedEntityId ||
      reopenedState.selectedKind !== "NODE" ||
      reopenedState.selectedId !== focusedEntityId ||
      reopenedState.layout !== "preset" ||
      reopenedState.positionCount !== 500 ||
      reopenedState.visibleNodeCount !== 25 ||
      reopenedState.visibleEdgeCount !== 90 ||
      !viewportMatches ||
      !dragPositionMatches ||
      JSON.stringify(reopenedCanonical) !== JSON.stringify(canonicalBefore) ||
      !(await reopenedRelationTypeFilter.isChecked()) ||
      (await reopenedDirectionFilter.inputValue()) !== "DIRECTED" ||
      (await reopenedLabelFilter.isChecked()) ||
      reopenedEvidence.canvas.elementCount === 0 ||
      reopenedEvidence.canvas.nonTransparentSamples === 0 ||
      reopenedEntry.timing.clickToReadyMs > 5_000 ||
      secondRun.pageErrors.length > 0 ||
      secondRun.requestedUrls.some(
        (url) =>
          url !== secondRun.localFileProbeUrl && !isLocalRuntimeUrl(url)
      ) ||
      secondRun.localFileProbe.readable
    ) {
      throw new Error(
        `Phase 1D scale restart gate failed: ${JSON.stringify({
          expected: persistedState,
          actual: reopenedState,
          viewportMatches,
          dragPositionMatches,
          canonicalBefore,
          reopenedCanonical,
          relationTypeFilter: await reopenedRelationTypeFilter.isChecked(),
          direction: await reopenedDirectionFilter.inputValue(),
          showLabels: await reopenedLabelFilter.isChecked(),
          pageErrors: secondRun.pageErrors
        })}`
      );
    }
    await secondPage.screenshot({ path: scaleReopenedScreenshot });

    const sortedLayouts = [...layoutReported].sort((left, right) => left - right);
    const externalRuntimeRequestUrls = [
      ...firstRun.requestedUrls.filter(
        (url) =>
          url !== firstRun.localFileProbeUrl && !isLocalRuntimeUrl(url)
      ),
      ...secondRun.requestedUrls.filter(
        (url) =>
          url !== secondRun.localFileProbeUrl && !isLocalRuntimeUrl(url)
      )
    ];
    const acceptance = {
      phase1dScaleElectron: true,
      packaged,
      appIsPackaged: firstRun.runtime.isPackaged,
      fixture: {
        source: "output/test-fixtures/phase1d-scale.madi",
        bytes: fixtureStats.size,
        entities: 500,
        aliases: 1_500,
        relations: 2_000,
        sceneLinks: 2_000
      },
      fullGraph: {
        nodes: fullEvidence.accessible.nodeIds.length,
        edges: fullEvidence.accessible.edgeIds.length,
        positionCount: fullEvidence.state.positionCount,
        actualCytoscapeCanvas: fullEvidence.canvas
      },
      performance: {
        initialGraphReady,
        graphEntry: {
          ...firstEntry.timing,
          memory: firstEntry.memory,
          metrics: fullEvidence.performance
        },
        layoutRuns,
        layoutMedianMs: sortedLayouts[2],
        layoutMaximumMs: maximumMetric(layoutReported),
        filter: {
          tagId: "scale-tag-7",
          visibleNodes: taggedEvidence.state.visibleNodeCount,
          visibleEdges: taggedEvidence.state.visibleEdgeCount,
          internalMs: taggedEvidence.performance.filterMs,
          observedMs: filterObservedMs
        },
        search: {
          alias: "별칭 321-2",
          entityId: searchedEntityId,
          resultCount: searchResultCount,
          internalFocusMs: searchedState.performance.searchFocusMs,
          resultReadyMs: searchResultReadyMs,
          clickToFocusMs: searchFocusObservedMs
        },
        focused: focusRuns,
        selection: {
          entityId: selectionEntityId,
          responseMs: selectionObservedMs,
          lazyDetailReadyMs: detailObservedMs
        },
        viewportInteraction,
        dragInteraction
      },
      canonicalIntegrity: {
        before: canonicalBefore,
        afterDrag: canonicalAfter,
        reopened: reopenedCanonical,
        unchanged: true
      },
      decision:
        conditionalBreaches.length > 0
          ? "CONDITIONAL TECHNICAL GO — PRIVATE LOCAL"
          : "TECHNICAL GO — PRIVATE LOCAL",
      conditionalBreaches,
      persistedState,
      restart: {
        ...reopenedEntry.timing,
        memory: reopenedEntry.memory,
        metrics: reopenedEvidence.performance,
        restoredState: reopenedState,
        viewportMatches,
        dragPositionMatches,
        actualCytoscapeCanvas: reopenedEvidence.canvas
      },
      externalRuntimeRequests: externalRuntimeRequestUrls.length,
      externalRuntimeRequestUrls,
      arbitraryLocalFileReadBlocked: true,
      networkEmulationOffline: true,
      screenshots: [
        packaged
          ? "output/playwright/madi-packaged-phase1d-scale-full.png"
          : "output/playwright/madi-electron-phase1d-scale-full.png",
        packaged
          ? "output/playwright/madi-packaged-phase1d-scale-persisted.png"
          : "output/playwright/madi-electron-phase1d-scale-persisted.png",
        packaged
          ? "output/playwright/madi-packaged-phase1d-scale-reopened.png"
          : "output/playwright/madi-electron-phase1d-scale-reopened.png"
      ]
    };
    process.stdout.write(`${JSON.stringify(acceptance, null, 2)}\n`);
    reportStage(
      "Phase 1D scale 500-node/2,000-edge graph and process restart verified"
    );
  } finally {
    if (firstApplication) {
      await forceCloseApplication(firstApplication);
    }
    if (secondApplication) {
      await forceCloseApplication(secondApplication);
    }
    const resolvedScaleWorkspace = resolve(scaleWorkspace);
    const resolvedTemporaryRoot = resolve(tmpdir());
    if (
      resolvedScaleWorkspace.startsWith(`${resolvedTemporaryRoot}\\`) ||
      resolvedScaleWorkspace.startsWith(`${resolvedTemporaryRoot}/`)
    ) {
      await rm(resolvedScaleWorkspace, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100
      });
    }
  }
}

const scaleFixturePath = process.env.MADI_SCALE_FIXTURE?.trim();

if (scaleFixturePath) {
  await runPhase1dScaleElectronSmoke(scaleFixturePath);
} else {

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
const phase1bScreenshot = join(
  artifactDirectory,
  packaged
    ? "madi-packaged-phase1b.png"
    : "madi-electron-phase1b.png"
);
const phase1cScreenshot = join(
  artifactDirectory,
  packaged
    ? "madi-packaged-phase1c.png"
    : "madi-electron-phase1c.png"
);
const phase1cReopenedScreenshot = join(
  artifactDirectory,
  packaged
    ? "madi-packaged-phase1c-reopened.png"
    : "madi-electron-phase1c-reopened.png"
);
const phase1dScreenshot = join(
  artifactDirectory,
  packaged
    ? "madi-packaged-phase1d.png"
    : "madi-electron-phase1d.png"
);
const phase1dReopenedScreenshot = join(
  artifactDirectory,
  packaged
    ? "madi-packaged-phase1d-reopened.png"
    : "madi-electron-phase1d-reopened.png"
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
  await waitForBinderCounts(firstPage, {
    WORK: 1,
    VOLUME: 0,
    CHAPTER: 1,
    SCENE: 1
  });
  const initialBinder = await readBinderEvidence(firstPage);
  const initialWork = initialBinder.find((node) => node.type === "WORK");
  const initialChapter = initialBinder.find(
    (node) => node.type === "CHAPTER"
  );
  const initialScene = initialBinder.find((node) => node.type === "SCENE");
  if (!initialWork || !initialChapter || !initialScene) {
    throw new Error("The new project did not expose its default Binder rows");
  }
  const binderTitles = {
    work: "드래곤을 죽이다",
    defaultChapter: "프롤로그 장",
    defaultScene: "용의 비상",
    volumeOne: "제1권 불씨",
    volumeTwo: "제2권 재의 왕좌",
    chapterOne: "제1장 잿빛 징조",
    chapterTwo: "제2장 검은 숲",
    sceneOne: "산맥의 그림자",
    sceneTwo: "불길한 전갈",
    sceneThree: "닫힌 성문",
    sceneFour: "왕좌 아래의 불",
    sceneFive: "북쪽 감시탑",
    sceneSix: "재의 서고",
    sceneSeven: "침묵의 회랑",
    sceneEight: "붉은 봉화",
    sceneNine: "마지막 서약",
    sceneTen: "용의 심장"
  };
  await renameBinderNode(firstPage, initialWork.id, binderTitles.work);
  await renameBinderNode(
    firstPage,
    initialChapter.id,
    binderTitles.defaultChapter
  );
  await renameBinderNode(
    firstPage,
    initialScene.id,
    binderTitles.defaultScene
  );
  reportStage("default Binder rows renamed through direct row controls");

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

  const pointerCanvas = await readCanvasEvidence(firstPage);
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

  const volumeOneId = await addBinderChild(firstPage, {
    parentType: "WORK",
    parentTitle: binderTitles.work,
    childType: "VOLUME",
    childTitle: binderTitles.volumeOne
  });
  const volumeTwoId = await addBinderChild(firstPage, {
    parentType: "WORK",
    parentTitle: binderTitles.work,
    childType: "VOLUME",
    childTitle: binderTitles.volumeTwo
  });
  const chapterOneId = await addBinderChild(firstPage, {
    parentType: "VOLUME",
    parentTitle: binderTitles.volumeOne,
    childType: "CHAPTER",
    childTitle: binderTitles.chapterOne
  });
  const chapterTwoId = await addBinderChild(firstPage, {
    parentType: "VOLUME",
    parentTitle: binderTitles.volumeTwo,
    childType: "CHAPTER",
    childTitle: binderTitles.chapterTwo
  });

  const shortSceneFixtures = [
    {
      title: binderTitles.sceneOne,
      text: "서윤은 산등성이에서 검은 비늘을 주웠다."
    },
    {
      title: binderTitles.sceneTwo,
      text: "전령은 숨을 고르며 용이 깨어났다고 말했다."
    }
  ];
  const sceneOneId = await addBinderChild(firstPage, {
    parentType: "CHAPTER",
    parentTitle: binderTitles.chapterOne,
    childType: "SCENE",
    childTitle: binderTitles.sceneOne
  });
  await input.fill(shortSceneFixtures[0].text);
  const sceneTwoId = await addBinderChild(firstPage, {
    parentType: "CHAPTER",
    parentTitle: binderTitles.chapterOne,
    childType: "SCENE",
    childTitle: binderTitles.sceneTwo
  });
  await input.fill(shortSceneFixtures[1].text);

  await selectBinderScene(firstPage, binderTitles.sceneOne);
  const firstShortSceneDiagnostics = await readDiagnostics(firstPage);
  await selectBinderScene(firstPage, binderTitles.sceneTwo);
  const secondShortSceneDiagnostics = await readDiagnostics(firstPage);
  const shortSceneRecoveryCharacters = shortSceneFixtures.map((fixture) =>
    Array.from(fixture.text).length
  );
  if (
    parseDiagnosticInteger(firstShortSceneDiagnostics.recovery) !==
      shortSceneRecoveryCharacters[0] ||
    parseDiagnosticInteger(secondShortSceneDiagnostics.recovery) !==
      shortSceneRecoveryCharacters[1]
  ) {
    throw new Error(
      `Scene switch did not preserve short-scene recovery counts: ${JSON.stringify(
        {
          expected: shortSceneRecoveryCharacters,
          actual: [
            parseDiagnosticInteger(firstShortSceneDiagnostics.recovery),
            parseDiagnosticInteger(secondShortSceneDiagnostics.recovery)
          ]
        }
      )}`
    );
  }

  const sceneTwoRow = await binderRowByTitle(
    firstPage,
    "SCENE",
    binderTitles.sceneTwo
  );
  await directBinderRow(sceneTwoRow)
    .getByRole("button", {
      name: `${binderTitles.sceneTwo} 위로 이동`,
      exact: true
    })
    .click();
  await waitForSiblingOrder(firstPage, chapterOneId, [
    sceneTwoId,
    sceneOneId
  ]);

  const sceneThreeId = await addBinderChild(firstPage, {
    parentType: "CHAPTER",
    parentTitle: binderTitles.chapterTwo,
    childType: "SCENE",
    childTitle: binderTitles.sceneThree
  });
  const sceneFourId = await addBinderChild(firstPage, {
    parentType: "CHAPTER",
    parentTitle: binderTitles.chapterTwo,
    childType: "SCENE",
    childTitle: binderTitles.sceneFour
  });
  const phase1bSearchToken = "마디검증어";
  const phase1bReplacementToken = "마디치환완료";
  const phase1bSceneFixtures = [
    {
      title: binderTitles.sceneFour,
      text: `${phase1bSearchToken}가 왕좌 아래에서 희미하게 빛났다.`
    },
    {
      title: binderTitles.sceneFive,
      text: `경비대장은 ${phase1bSearchToken}를 북쪽 기록에 남겼다.`
    },
    {
      title: binderTitles.sceneSix,
      text: `서윤은 재의 서고에서 ${phase1bSearchToken}를 찾아냈다.`
    },
    {
      title: binderTitles.sceneSeven,
      text: `침묵의 회랑 끝에서 ${phase1bSearchToken}라는 메아리가 돌아왔다.`
    },
    {
      title: binderTitles.sceneEight,
      text: `붉은 봉화의 암호는 ${phase1bSearchToken} 하나뿐이었다.`
    },
    {
      title: binderTitles.sceneNine,
      text: `마지막 서약문에는 ${phase1bSearchToken}가 선명했다.`
    },
    {
      title: binderTitles.sceneTen,
      text: `용의 심장은 ${phase1bSearchToken}를 기억하고 있었다.`
    }
  ];
  await input.fill(phase1bSceneFixtures[0].text);
  const phase1bAdditionalSceneIds = [];
  for (const fixture of phase1bSceneFixtures.slice(1)) {
    const sceneId = await addBinderChild(firstPage, {
      parentType: "CHAPTER",
      parentTitle: binderTitles.chapterTwo,
      childType: "SCENE",
      childTitle: fixture.title
    });
    phase1bAdditionalSceneIds.push(sceneId);
    await input.fill(fixture.text);
  }
  await selectBinderScene(firstPage, binderTitles.sceneThree);
  const selectedSceneFixture = `${longFixture} 선택 장면 전용 본문`;
  await input.fill(selectedSceneFixture);
  await firstPage.getByRole("button", { name: "장면 구분선" }).click();
  await input.focus();
  await input.pressSequentially("세 번째 장면 끝", { delay: 10 });
  await firstPage.getByRole("button", { name: "저장" }).click();
  await firstPage
    .locator('[data-testid="save-status"][data-phase="saved"]')
    .waitFor({ timeout: 30_000 });
  await firstPage.waitForFunction(() => {
    const canvases = document.querySelectorAll(".typie-runtime__canvas");
    const firstCanvas = canvases[0];
    return (
      canvases.length >= 2 &&
      firstCanvas instanceof HTMLCanvasElement &&
      Number(firstCanvas.dataset.semanticSceneBreaks ?? "0") >= 1
    );
  });
  const canvas = await readCanvasEvidence(firstPage);
  await waitForBinderCounts(firstPage, {
    WORK: 1,
    VOLUME: 2,
    CHAPTER: 3,
    SCENE: 11
  });

  const binderExpectation = {
    counts: {
      WORK: 1,
      VOLUME: 2,
      CHAPTER: 3,
      SCENE: 11
    },
    titles: {
      WORK: [binderTitles.work],
      VOLUME: [binderTitles.volumeOne, binderTitles.volumeTwo],
      CHAPTER: [
        binderTitles.defaultChapter,
        binderTitles.chapterOne,
        binderTitles.chapterTwo
      ],
      SCENE: [
        binderTitles.defaultScene,
        binderTitles.sceneOne,
        binderTitles.sceneTwo,
        binderTitles.sceneThree,
        binderTitles.sceneFour,
        binderTitles.sceneFive,
        binderTitles.sceneSix,
        binderTitles.sceneSeven,
        binderTitles.sceneEight,
        binderTitles.sceneNine,
        binderTitles.sceneTen
      ]
    },
    siblingParentId: chapterOneId,
    siblingSceneIds: [sceneTwoId, sceneOneId],
    parentById: {
      [initialWork.id]: null,
      [initialChapter.id]: initialWork.id,
      [initialScene.id]: initialChapter.id,
      [volumeOneId]: initialWork.id,
      [volumeTwoId]: initialWork.id,
      [chapterOneId]: volumeOneId,
      [chapterTwoId]: volumeTwoId,
      [sceneOneId]: chapterOneId,
      [sceneTwoId]: chapterOneId,
      [sceneThreeId]: chapterTwoId,
      [sceneFourId]: chapterTwoId,
      ...Object.fromEntries(
        phase1bAdditionalSceneIds.map((sceneId) => [sceneId, chapterTwoId])
      )
    }
  };
  const firstBinderEvidence = await readBinderEvidence(firstPage);
  const verifiedFirstBinder = verifyBinderEvidence(
    firstBinderEvidence,
    binderExpectation,
    "first run"
  );
  reportStage("Binder hierarchy, scene saves, and sibling reorder verified");

  const workRow = await binderRowByTitle(
    firstPage,
    "WORK",
    binderTitles.work
  );
  await directBinderRow(workRow)
    .getByRole("button", { name: binderTitles.work, exact: true })
    .click();
  const scrivenings = firstPage.getByRole("region", {
    name: "연속 원고 보기"
  });
  await scrivenings.waitFor({ state: "visible", timeout: 30_000 });
  await scrivenings
    .getByRole("heading", { name: binderTitles.work, exact: true })
    .waitFor({ timeout: 30_000 });
  await pollBinderUi(
    async () =>
      (await scrivenings.locator("article[data-scene-id]").count()) === 11 &&
      (await scrivenings.locator("[data-live-editor-slot]").count()) === 1,
    "11-scene Scrivenings with one live editor"
  );
  const scriveningsEvidence = {
    sceneCount: await scrivenings.locator("article[data-scene-id]").count(),
    liveEditorCount: await scrivenings
      .locator("[data-live-editor-slot]")
      .count(),
    readonlyOrLightCount: await scrivenings
      .locator(
        'article[data-scene-id]:not([data-active="true"]) .scrivenings__preview'
      )
      .count(),
    stats:
      (await scrivenings
        .locator('[aria-label="선택 범위 글자 수"]')
        .textContent())?.trim() ?? ""
  };
  if (
    scriveningsEvidence.sceneCount !== 11 ||
    scriveningsEvidence.liveEditorCount !== 1 ||
    scriveningsEvidence.readonlyOrLightCount !== 10 ||
    !scriveningsEvidence.stats.includes("장면 11개")
  ) {
    throw new Error(
      `Scrivenings did not preserve the one-live-editor invariant: ${JSON.stringify(
        scriveningsEvidence
      )}`
    );
  }

  await firstPage
    .getByRole("button", { name: "Snapshot", exact: true })
    .click();
  const snapshotPanel = firstPage.getByRole("complementary", {
    name: "Named snapshot"
  });
  await snapshotPanel
    .getByRole("textbox", { name: "이름", exact: true })
    .fill("Electron Phase 1B 기준점");
  await snapshotPanel
    .getByRole("textbox", { name: "메모 (선택)", exact: true })
    .fill("11개 장면 검색·치환·복원 검증 전");
  await snapshotPanel
    .getByRole("button", { name: "현재 프로젝트 snapshot 생성" })
    .click();
  await snapshotPanel
    .getByText("Electron Phase 1B 기준점", { exact: true })
    .waitFor({ timeout: 30_000 });

  await firstPage.getByRole("button", { name: "검색 · 치환" }).click();
  const searchPanel = firstPage.getByRole("complementary", {
    name: "프로젝트 검색 및 선택 치환"
  });
  await searchPanel
    .getByRole("combobox", { name: "검색 대상" })
    .selectOption("BODIES");
  await searchPanel
    .getByRole("radio", { name: "작품 전체", exact: true })
    .check();
  await searchPanel
    .getByRole("searchbox", { name: "찾을 문자열" })
    .fill(phase1bSearchToken);
  await searchPanel.getByRole("button", { name: "검색", exact: true }).click();
  await searchPanel
    .getByText(/전체 7개 · 본문 7개 · 제목 0개 · 7개 장면/u)
    .waitFor({ timeout: 30_000 });
  await searchPanel
    .getByRole("textbox", { name: "바꿀 문자열" })
    .fill(phase1bReplacementToken);
  const applyReplacementButton = searchPanel.getByRole("button", {
    name: "선택 항목 치환 적용"
  });
  await pollBinderUi(
    async () => !(await applyReplacementButton.isDisabled()),
    "semantic replacement enabled"
  );
  await applyReplacementButton.click();
  await searchPanel
    .getByText(/전체 0개 · 본문 0개 · 제목 0개 · 0개 장면/u)
    .waitFor({ timeout: 60_000 });
  await searchPanel
    .getByRole("searchbox", { name: "찾을 문자열" })
    .fill(phase1bReplacementToken);
  await searchPanel.getByRole("button", { name: "검색", exact: true }).click();
  await searchPanel
    .getByText(/전체 7개 · 본문 7개 · 제목 0개 · 7개 장면/u)
    .waitFor({ timeout: 30_000 });

  await firstPage
    .getByRole("button", { name: "Snapshot", exact: true })
    .click();
  await snapshotPanel
    .getByText("저장된 snapshot 2개", { exact: true })
    .waitFor({ timeout: 30_000 });
  await snapshotPanel
    .getByRole("button", { name: "Electron Phase 1B 기준점 복원" })
    .click();
  const restoreDialog = snapshotPanel.getByRole("alertdialog");
  await restoreDialog.waitFor({ state: "visible", timeout: 30_000 });
  const confirmRestore = restoreDialog.getByRole("button", {
    name: "안전 snapshot 생성 후 복원"
  });
  await pollBinderUi(
    async () => !(await confirmRestore.isDisabled()),
    "named snapshot restore confirmation"
  );
  await confirmRestore.click();
  await snapshotPanel
    .getByText("저장된 snapshot 3개", { exact: true })
    .waitFor({ timeout: 60_000 });

  await firstPage.getByRole("button", { name: "검색 · 치환" }).click();
  await searchPanel
    .getByRole("radio", { name: "작품 전체", exact: true })
    .check();
  await searchPanel
    .getByRole("searchbox", { name: "찾을 문자열" })
    .fill(phase1bSearchToken);
  await searchPanel.getByRole("button", { name: "검색", exact: true }).click();
  await searchPanel
    .getByText(/전체 7개 · 본문 7개 · 제목 0개 · 7개 장면/u)
    .waitFor({ timeout: 30_000 });
  await firstPage.screenshot({ path: phase1bScreenshot });
  const phase1bAcceptance = {
    sceneCount: 11,
    searchedOccurrences: 7,
    transformedScenes: 7,
    autoBeforeReplaceSnapshot: true,
    autoBeforeRestoreSnapshot: true,
    namedSnapshotRestore: true,
    restoredOccurrences: 7,
    scrivenings: scriveningsEvidence
  };
  reportStage(
    "Phase 1B Scrivenings, Korean search, semantic replace, and snapshot restore verified"
  );

  const phase1cFixture = {
    protagonistName: "아린",
    protagonistSummary: "북쪽 기록을 좇는 초안 단계의 주인공",
    protagonistStatus: "DRAFT",
    protagonistAlias: phase1bSearchToken,
    protagonistTag: "Phase 1C 핵심",
    protagonistNote: "아린은 잿빛 성채의 봉인을 기억한다. Phase 1C Typie 상세 노트.",
    locationName: "잿빛 성채",
    relationTypeName: "인도자",
    relationTypeInverseName: "길을 받는 이",
    relationNote: "아린이 잿빛 성채로 향하는 길을 연다.",
    snapshotName: "Electron Phase 1C 기준점",
    temporaryName: "아린 임시 변경"
  };

  await firstPage
    .getByRole("button", { name: "설정", exact: true })
    .click();
  await firstPage
    .getByRole("region", { name: "설정 작업 공간" })
    .waitFor({ state: "visible", timeout: 30_000 });

  const protagonistId = await createStoryEntityThroughUi(
    firstPage,
    "CHARACTER"
  );
  const protagonistNameInput = firstPage.getByRole("textbox", {
    name: "설정 이름"
  });
  await protagonistNameInput.fill(phase1cFixture.protagonistName);
  await protagonistNameInput.blur();
  if (
    (await waitForStoryEntityId(
      firstPage,
      phase1cFixture.protagonistName
    )) !== protagonistId
  ) {
    throw new Error("Story Bible protagonist identity changed after rename");
  }
  await firstPage
    .getByRole("combobox", { name: "설정 상태 변경" })
    .selectOption(phase1cFixture.protagonistStatus);
  await pollBinderUi(
    async () =>
      (
        (await storyEntityRowById(firstPage, protagonistId)
          .locator("small")
          .textContent()) ?? ""
      ).includes("초안"),
    "Story Bible protagonist status"
  );
  const protagonistSummaryInput = firstPage.getByRole("textbox", {
    name: "설정 한 줄 요약"
  });
  await protagonistSummaryInput.fill(phase1cFixture.protagonistSummary);
  await protagonistSummaryInput.blur();
  await firstPage.waitForTimeout(300);

  const aliasInput = firstPage.getByRole("textbox", { name: "새 별칭" });
  await aliasInput.fill(phase1cFixture.protagonistAlias);
  await firstPage.getByRole("button", { name: "별칭 추가" }).click();
  try {
    await pollBinderUi(
      async () =>
        (await aliasInput.inputValue()) === "" &&
        (await firstPage
          .getByRole("region", { name: "별칭" })
          .getByRole("button", {
            name: `${phase1cFixture.protagonistAlias} 별칭 삭제`,
            exact: true
          })
          .isVisible()
          .catch(() => false)),
      "Story Bible alias creation and mention discovery",
      60_000
    );
  } catch (error) {
    const aliasEvidence = {
      inputValue: await aliasInput.inputValue().catch(() => "<detached>"),
      aliasVisible: await firstPage
        .getByRole("region", { name: "별칭" })
        .getByRole("button", {
          name: `${phase1cFixture.protagonistAlias} 별칭 삭제`,
          exact: true
        })
        .isVisible()
        .catch(() => false),
      alerts: await firstPage.getByRole("alert").allTextContents()
    };
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; state: ${JSON.stringify(aliasEvidence)}`
    );
  }

  const tagInput = firstPage.getByRole("textbox", { name: "새 태그" });
  await tagInput.fill(phase1cFixture.protagonistTag);
  await firstPage
    .getByRole("button", { name: "태그 생성 및 연결" })
    .click();
  await pollBinderUi(
    async () =>
      (await tagInput.inputValue()) === "" &&
      (await firstPage
        .getByRole("checkbox", { name: phase1cFixture.protagonistTag })
        .isChecked()
        .catch(() => false)),
    "Story Bible tag creation and assignment"
  );

  const protagonistNoteInput = storyNoteInput(firstPage);
  await protagonistNoteInput.waitFor({ state: "attached", timeout: 30_000 });
  await protagonistNoteInput.fill(phase1cFixture.protagonistNote);
  await firstPage
    .locator('[data-testid="save-status"][data-phase="dirty"]')
    .waitFor({ timeout: 30_000 });
  await firstPage.getByRole("button", { name: "저장", exact: true }).click();
  await firstPage
    .locator('[data-testid="save-status"][data-phase="saved"]')
    .waitFor({ timeout: 30_000 });

  const locationId = await createStoryEntityThroughUi(
    firstPage,
    "LOCATION"
  );
  const locationNameInput = firstPage.getByRole("textbox", {
    name: "설정 이름"
  });
  await locationNameInput.fill(phase1cFixture.locationName);
  await locationNameInput.blur();
  if (
    (await waitForStoryEntityId(firstPage, phase1cFixture.locationName)) !==
    locationId
  ) {
    throw new Error("Story Bible location identity changed after rename");
  }

  await storyEntityRowById(firstPage, protagonistId)
    .getByRole("button")
    .click();
  await pollBinderUi(
    async () =>
      (await storyEntityRowById(firstPage, protagonistId)
        .getByRole("button")
        .getAttribute("aria-current")) === "true",
    "Story Bible protagonist reselection"
  );

  const relationTypeManager = firstPage.locator(
    "details.relation-type-manager"
  );
  await relationTypeManager.locator("summary").click();
  await firstPage
    .getByRole("textbox", { name: "관계 타입 이름" })
    .fill(phase1cFixture.relationTypeName);
  await firstPage
    .getByRole("textbox", { name: "관계 타입 역방향 이름" })
    .fill(phase1cFixture.relationTypeInverseName);
  await firstPage
    .getByRole("checkbox", { name: "방향 관계" })
    .check();
  await firstPage
    .getByRole("button", { name: "관계 타입 생성" })
    .click();
  const customRelationTypeRow = relationTypeManager
    .locator("li[data-relation-type-id]")
    .filter({ hasText: phase1cFixture.relationTypeName });
  await customRelationTypeRow.waitFor({ state: "attached", timeout: 30_000 });
  const customRelationTypeId = await customRelationTypeRow.getAttribute(
    "data-relation-type-id"
  );
  if (!customRelationTypeId) {
    throw new Error("Custom directed relation type has no id");
  }
  await pollBinderUi(
    async () =>
      (await firstPage
        .getByRole("textbox", { name: "관계 타입 이름" })
        .inputValue()) === "",
    "custom relation type persistence"
  );

  await firstPage
    .getByRole("combobox", { name: "관계 타입" })
    .selectOption(customRelationTypeId);
  await firstPage
    .getByRole("combobox", { name: "관계 대상 설정 검색" })
    .selectOption(locationId);
  await firstPage
    .getByRole("textbox", { name: "관계 메모" })
    .fill(phase1cFixture.relationNote);
  await firstPage.getByRole("button", { name: "관계 추가" }).click();
  const outgoingRelations = firstPage.getByRole("region", {
    name: "나가는 관계"
  });
  const customRelationRow = outgoingRelations
    .locator("li[data-relation-id]")
    .filter({ hasText: phase1cFixture.relationTypeName });
  await customRelationRow.waitFor({ state: "attached", timeout: 30_000 });
  const customRelationId = await customRelationRow.getAttribute(
    "data-relation-id"
  );
  if (!customRelationId) {
    throw new Error("Custom directed relation has no id");
  }

  const mentionSection = firstPage.getByRole("region", {
    name: "본문에서 찾은 후보"
  });
  await pollBinderUi(
    async () =>
      (await mentionSection.locator("li[data-mention-id]").count()) === 7,
    "seven automatic alias mention candidates",
    60_000
  );
  const promotedMentionRow = mentionSection
    .locator("li[data-mention-id]")
    .filter({ hasText: binderTitles.sceneFour });
  await promotedMentionRow.waitFor({ state: "attached", timeout: 30_000 });
  const promotedMentionId = await promotedMentionRow.getAttribute(
    "data-mention-id"
  );
  if (!promotedMentionId) {
    throw new Error("Automatic mention candidate has no occurrence id");
  }
  await promotedMentionRow
    .getByRole("button", { name: "언급으로 연결" })
    .click();
  await promotedMentionRow
    .getByText("명시적 연결됨", { exact: true })
    .waitFor({ timeout: 30_000 });
  const promotedLinkSelector =
    `[data-scene-link-id="${sceneFourId}:${protagonistId}:MENTIONED"]`;
  await firstPage.locator(promotedLinkSelector).waitFor({
    state: "attached",
    timeout: 30_000
  });

  await firstPage
    .getByRole("button", { name: "원고", exact: true })
    .click();
  await selectBinderScene(firstPage, binderTitles.sceneThree);
  await firstPage
    .getByRole("button", { name: "설정 연결", exact: true })
    .click();
  const sceneEntityInspector = firstPage.getByRole("complementary", {
    name: "이 장면의 설정"
  });
  await sceneEntityInspector
    .getByRole("combobox", { name: "장면에 연결할 설정" })
    .selectOption(protagonistId);
  await sceneEntityInspector
    .getByRole("combobox", { name: "장면 설정 역할" })
    .selectOption("POV");
  await sceneEntityInspector
    .getByRole("button", { name: "설정 연결", exact: true })
    .click();
  const explicitSceneLinkSelector =
    `[data-scene-link-id="${sceneThreeId}:${protagonistId}:POV"]`;
  await sceneEntityInspector.locator(explicitSceneLinkSelector).waitFor({
    state: "attached",
    timeout: 30_000
  });

  await firstPage
    .getByRole("button", { name: "Snapshot", exact: true })
    .click();
  await snapshotPanel
    .getByRole("textbox", { name: "이름", exact: true })
    .fill(phase1cFixture.snapshotName);
  await snapshotPanel
    .getByRole("textbox", { name: "메모 (선택)", exact: true })
    .fill("설정·관계·장면 연결·ENTITY 노트 기준점");
  await snapshotPanel
    .getByRole("button", { name: "현재 프로젝트 snapshot 생성" })
    .click();
  await snapshotPanel
    .getByText("저장된 snapshot 4개", { exact: true })
    .waitFor({ timeout: 30_000 });
  const phase1cSnapshotItem = snapshotItemByName(
    snapshotPanel,
    phase1cFixture.snapshotName
  );
  await phase1cSnapshotItem.waitFor({ state: "attached", timeout: 30_000 });
  const phase1cSnapshotMetadata = (
    await phase1cSnapshotItem.locator(".snapshot-metadata").innerText()
  ).trim();
  if (!/형식\s+[^\r\n]+ v2/u.test(phase1cSnapshotMetadata)) {
    throw new Error(
      `Phase 1C named snapshot is not payload v2: ${phase1cSnapshotMetadata}`
    );
  }

  await firstPage
    .getByRole("button", { name: "설정", exact: true })
    .click();
  await storyEntityRowById(firstPage, protagonistId)
    .getByRole("button")
    .click();
  const temporaryNameInput = firstPage.getByRole("textbox", {
    name: "설정 이름"
  });
  await temporaryNameInput.fill(phase1cFixture.temporaryName);
  await temporaryNameInput.blur();
  if (
    (await waitForStoryEntityId(firstPage, phase1cFixture.temporaryName)) !==
    protagonistId
  ) {
    throw new Error("Temporary Story Bible mutation changed entity identity");
  }

  await firstPage
    .getByRole("button", { name: "원고", exact: true })
    .click();
  await firstPage
    .getByRole("button", { name: "Snapshot", exact: true })
    .click();
  await snapshotPanel
    .getByRole("button", {
      name: `${phase1cFixture.snapshotName} 복원`
    })
    .click();
  const phase1cRestoreDialog = snapshotPanel.getByRole("alertdialog");
  await phase1cRestoreDialog.waitFor({ state: "visible", timeout: 30_000 });
  const confirmPhase1cRestore = phase1cRestoreDialog.getByRole("button", {
    name: "안전 snapshot 생성 후 복원"
  });
  await pollBinderUi(
    async () => !(await confirmPhase1cRestore.isDisabled()),
    "Phase 1C named snapshot restore confirmation"
  );
  const phase1cDiffText = (
    await phase1cRestoreDialog
      .locator(".snapshot-diff--compact")
      .innerText()
  ).trim();
  if (!/설정 변화\s+\+0 · −0 · 변경 1/u.test(phase1cDiffText)) {
    throw new Error(
      `Phase 1C temporary entity mutation was not reported: ${phase1cDiffText}`
    );
  }
  await confirmPhase1cRestore.click();
  await snapshotPanel
    .getByText("저장된 snapshot 5개", { exact: true })
    .waitFor({ timeout: 60_000 });

  await firstPage
    .getByRole("button", { name: "설정", exact: true })
    .click();
  await firstPage
    .getByRole("region", { name: "설정 작업 공간" })
    .waitFor({ state: "visible", timeout: 30_000 });
  if (
    (await storyEntityIds(firstPage)).length !== 2 ||
    (await waitForStoryEntityId(
      firstPage,
      phase1cFixture.protagonistName
    )) !== protagonistId ||
    (await waitForStoryEntityId(firstPage, phase1cFixture.locationName)) !==
      locationId
  ) {
    throw new Error("Phase 1C snapshot restore changed entity identity or count");
  }
  await storyEntityRowById(firstPage, protagonistId)
    .getByRole("button")
    .click();
  try {
    await pollBinderUi(
      async () =>
        (await firstPage
          .getByRole("textbox", { name: "설정 한 줄 요약" })
          .inputValue()) === phase1cFixture.protagonistSummary &&
        (await firstPage
          .getByRole("combobox", { name: "설정 상태 변경" })
          .inputValue()) === phase1cFixture.protagonistStatus &&
        (await storyNoteInput(firstPage).inputValue()) ===
          singleParagraphImeProjection(phase1cFixture.protagonistNote),
      "restored Story Bible metadata and ENTITY Typie note",
      60_000
    );
  } catch (error) {
    const restoreEvidence = {
      name: await firstPage
        .getByRole("textbox", { name: "설정 이름" })
        .inputValue()
        .catch(() => "<detached>"),
      summary: await firstPage
        .getByRole("textbox", { name: "설정 한 줄 요약" })
        .inputValue()
        .catch(() => "<detached>"),
      status: await firstPage
        .getByRole("combobox", { name: "설정 상태 변경" })
        .inputValue()
        .catch(() => "<detached>"),
      note: await storyNoteInput(firstPage)
        .inputValue()
        .catch(() => "<detached>"),
      alerts: await firstPage.getByRole("alert").allTextContents()
    };
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; state: ${JSON.stringify(restoreEvidence)}`
    );
  }
  await firstPage
    .getByRole("region", { name: "별칭" })
    .getByRole("button", {
      name: `${phase1cFixture.protagonistAlias} 별칭 삭제`,
      exact: true
    })
    .waitFor({ timeout: 30_000 });
  if (
    !(await firstPage
      .getByRole("checkbox", { name: phase1cFixture.protagonistTag })
      .isChecked())
  ) {
    throw new Error("Phase 1C snapshot restore did not restore the entity tag");
  }
  const restoredCustomRelationTypeId = await relationTypeManager
    .locator("li[data-relation-type-id]")
    .filter({ hasText: phase1cFixture.relationTypeName })
    .getAttribute("data-relation-type-id");
  const restoredCustomRelationId = await firstPage
    .getByRole("region", { name: "나가는 관계" })
    .locator("li[data-relation-id]")
    .filter({ hasText: phase1cFixture.relationTypeName })
    .getAttribute("data-relation-id");
  if (
    restoredCustomRelationTypeId !== customRelationTypeId ||
    restoredCustomRelationId !== customRelationId ||
    !(await firstPage.locator(promotedLinkSelector).isVisible()) ||
    !(await firstPage.locator(explicitSceneLinkSelector).isVisible())
  ) {
    throw new Error(
      "Phase 1C snapshot restore changed relation or scene-link identity"
    );
  }
  await pollBinderUi(
    async () =>
      (await mentionSection.locator("li[data-mention-id]").count()) === 7,
    "restored automatic mention candidates",
    60_000
  );
  await firstPage.screenshot({ path: phase1cScreenshot });
  const phase1cAcceptance = {
    entityCount: 2,
    entityIds: {
      protagonist: protagonistId,
      location: locationId
    },
    metadata: {
      name: phase1cFixture.protagonistName,
      summary: phase1cFixture.protagonistSummary,
      status: phase1cFixture.protagonistStatus,
      alias: phase1cFixture.protagonistAlias,
      tag: phase1cFixture.protagonistTag
    },
    entityNoteCharacters: Array.from(phase1cFixture.protagonistNote).length,
    customDirectedRelation: {
      relationTypeId: customRelationTypeId,
      relationId: customRelationId,
      name: phase1cFixture.relationTypeName,
      inverseName: phase1cFixture.relationTypeInverseName,
      targetEntityId: locationId
    },
    automaticMentionCandidates: 7,
    promotedMention: {
      occurrenceId: promotedMentionId,
      sceneId: sceneFourId,
      role: "MENTIONED"
    },
    manuscriptSceneLink: {
      sceneId: sceneThreeId,
      entityId: protagonistId,
      role: "POV"
    },
    namedSnapshot: {
      payloadVersion: 2,
      countAfterRestore: 5,
      temporaryEntityMutationDetected: true,
      restored: true
    }
  };
  reportStage(
    "Phase 1C Story Bible, mention promotion, scene link, and snapshot v2 restore verified"
  );

  const firstGraphEntry = await openWorldGraph(firstPage, 2, 1);
  const initialGraphEvidence = firstGraphEntry.evidence;
  if (
    JSON.stringify([...initialGraphEvidence.accessible.nodeIds].sort()) !==
      JSON.stringify([protagonistId, locationId].sort()) ||
    initialGraphEvidence.accessible.edgeIds.length !== 1 ||
    initialGraphEvidence.accessible.edgeIds[0] !== customRelationId ||
    !initialGraphEvidence.statsText.includes("전체 설정 2개") ||
    !initialGraphEvidence.statsText.includes("표시 설정 2개") ||
    !initialGraphEvidence.statsText.includes("전체 관계 1개") ||
    !initialGraphEvidence.statsText.includes("표시 관계 1개")
  ) {
    throw new Error(
      `Phase 1D full graph did not expose the canonical two-node/one-edge model: ${JSON.stringify(
        initialGraphEvidence
      )}`
    );
  }

  await openWorldGraphAccessibleList(firstPage);
  const graphNodeRegion = firstPage.getByRole("region", {
    name: "그래프 설정 목록"
  });
  const graphEdgeRegion = firstPage.getByRole("region", {
    name: "그래프 관계 목록"
  });
  const protagonistGraphButton = graphNodeRegion.locator(
    `button[data-entity-id="${protagonistId}"]`
  );
  await protagonistGraphButton.click();
  await waitForWorldGraphState(
    firstPage,
    { selectedKind: "NODE", selectedId: protagonistId },
    "accessible protagonist graph-node selection"
  );
  const graphDetail = firstPage.locator('[data-testid="world-graph-detail"]');
  await graphDetail
    .getByRole("heading", { name: phase1cFixture.protagonistName, exact: true })
    .waitFor({ timeout: 30_000 });
  await graphDetail
    .getByRole("region", { name: "명시적 장면 연결" })
    .getByRole("button", {
      name: `${binderTitles.sceneThree} · POV`,
      exact: true
    })
    .waitFor({ timeout: 30_000 });
  await graphDetail
    .getByRole("region", { name: "명시적 장면 연결" })
    .getByRole("button", {
      name: `${binderTitles.sceneFour} · MENTIONED`,
      exact: true
    })
    .waitFor({ timeout: 30_000 });
  await graphDetail
    .getByRole("region", { name: "본문 자동 언급 후보" })
    .getByText("7개", { exact: true })
    .waitFor({ timeout: 30_000 });

  const graphCanvas = firstPage.locator(
    '[data-testid="world-graph-canvas"]'
  );
  await graphCanvas.focus();
  await graphCanvas.press("Enter");
  const keyboardDetailFocus = await pollBinderUi(
    () =>
      firstPage.evaluate(
        () => document.activeElement?.id === "world-graph-detail"
      ),
    "World Graph Enter key detail focus"
  );
  await graphCanvas.focus();
  await graphCanvas.press("Escape");
  await waitForWorldGraphState(
    firstPage,
    { selectedKind: "", selectedId: "" },
    "World Graph Escape key selection clear"
  );
  await protagonistGraphButton.click();

  const graphEdgeButton = graphEdgeRegion.locator(
    `button[data-relation-id="${customRelationId}"]`
  );
  await graphEdgeButton.click();
  await waitForWorldGraphState(
    firstPage,
    { selectedKind: "EDGE", selectedId: customRelationId },
    "accessible directed graph-edge selection"
  );
  await graphDetail
    .getByRole("heading", {
      name: phase1cFixture.relationTypeName,
      exact: true
    })
    .waitFor({ timeout: 30_000 });
  await graphDetail
    .getByText("방향 관계 →", { exact: true })
    .waitFor({ timeout: 30_000 });
  await graphDetail
    .getByText(
      `역방향 label: ${phase1cFixture.relationTypeInverseName}`,
      { exact: true }
    )
    .waitFor({ timeout: 30_000 });
  await graphDetail
    .getByText(`관계 메모: ${phase1cFixture.relationNote}`, { exact: true })
    .waitFor({ timeout: 30_000 });
  await graphDetail
    .getByRole("button", { name: "관계 편집에서 열기", exact: true })
    .click();
  try {
    await firstPage
      .getByRole("region", { name: "설정 작업 공간" })
      .waitFor({ state: "visible", timeout: 30_000 });
  } catch (error) {
    const navigationEvidence = {
      pageErrors: firstRun.pageErrors,
      alerts: await firstPage.getByRole("alert").allTextContents(),
      status: await firstPage.getByRole("status").allTextContents(),
      graph: await readWorldGraphEvidence(firstPage).catch(() => null),
      storyBibleVisible: await firstPage
        .getByRole("region", { name: "설정 작업 공간" })
        .isVisible()
        .catch(() => false)
    };
    throw new Error(
      `World Graph relation navigation failed: ${
        error instanceof Error ? error.message : String(error)
      }; state: ${JSON.stringify(navigationEvidence)}`
    );
  }
  const relationNavigation = await pollBinderUi(
    async () =>
      (await firstPage
        .getByRole("textbox", { name: "설정 이름" })
        .inputValue()) === phase1cFixture.protagonistName &&
      (await storyEntityRowById(firstPage, protagonistId)
        .getByRole("button")
        .getAttribute("aria-current")) === "true",
    "World Graph edge to Story Bible relation navigation"
  );

  await openWorldGraph(firstPage, 2, 1);
  await openWorldGraphAccessibleList(firstPage);
  await firstPage
    .getByRole("region", { name: "그래프 설정 목록" })
    .locator(`button[data-entity-id="${protagonistId}"]`)
    .click();
  await waitForWorldGraphState(
    firstPage,
    { selectedKind: "NODE", selectedId: protagonistId },
    "protagonist selection before Story Bible detail navigation"
  );
  await firstPage
    .locator('[data-testid="world-graph-detail"]')
    .getByRole("button", { name: "설정 상세에서 열기", exact: true })
    .click();
  await firstPage
    .getByRole("region", { name: "설정 작업 공간" })
    .waitFor({ state: "visible", timeout: 30_000 });
  const entityNavigation = await pollBinderUi(
    async () =>
      (await firstPage
        .getByRole("textbox", { name: "설정 이름" })
        .inputValue()) === phase1cFixture.protagonistName,
    "World Graph node to Story Bible entity navigation"
  );

  await openWorldGraph(firstPage, 2, 1);
  await openWorldGraphAccessibleList(firstPage);
  await firstPage
    .getByRole("region", { name: "그래프 설정 목록" })
    .locator(`button[data-entity-id="${protagonistId}"]`)
    .click();
  await firstPage
    .locator('[data-testid="world-graph-detail"]')
    .getByRole("region", { name: "명시적 장면 연결" })
    .getByRole("button", {
      name: `${binderTitles.sceneThree} · POV`,
      exact: true
    })
    .waitFor({ timeout: 30_000 });
  await firstPage
    .locator('[data-testid="world-graph-detail"]')
    .getByRole("button", {
      name: `${binderTitles.sceneThree} · POV`,
      exact: true
    })
    .click();
  await pageWaitForSelectedBinderRow(firstPage, sceneThreeId);
  const sceneNavigation =
    (await binderRowById(firstPage, sceneThreeId).getAttribute("aria-selected")) ===
    "true";

  await openWorldGraph(firstPage, 2, 1);
  const graphSearch = firstPage.locator('[data-testid="world-graph-search"]');
  await graphSearch.fill(phase1cFixture.protagonistAlias);
  const graphSearchResults = firstPage.getByRole("list", {
    name: "세계관 설정 검색 결과"
  });
  await graphSearchResults
    .locator(`button[data-entity-id="${protagonistId}"]`)
    .waitFor({ state: "visible", timeout: 30_000 });
  const searchResultCount = await graphSearchResults
    .locator("button[data-entity-id]")
    .count();
  await graphSearchResults
    .locator(`button[data-entity-id="${protagonistId}"]`)
    .click();
  await waitForWorldGraphState(
    firstPage,
    { mode: "FULL", selectedKind: "NODE", selectedId: protagonistId },
    "World Graph alias search focus"
  );

  await firstPage
    .getByRole("button", { name: "전체 그래프", exact: true })
    .click();
  const fullModeEvidence = await waitForWorldGraphState(
    firstPage,
    { mode: "FULL" },
    "World Graph full mode"
  );
  await firstPage
    .getByRole("button", { name: "중심 그래프", exact: true })
    .click();
  const focusedDepthEvidence = [];
  for (const depth of [1, 2, 3]) {
    await firstPage
      .getByRole("combobox", { name: "중심 그래프 깊이" })
      .selectOption(String(depth));
    const depthEvidence = await waitForWorldGraphState(
      firstPage,
      {
        mode: "FOCUSED",
        depth,
        focusedEntityId: protagonistId,
        visibleNodeCount: 2,
        visibleEdgeCount: 1
      },
      `World Graph focused depth ${depth}`
    );
    focusedDepthEvidence.push({
      depth,
      visibleNodeCount: depthEvidence.state.visibleNodeCount,
      visibleEdgeCount: depthEvidence.state.visibleEdgeCount
    });
  }

  await openWorldGraphFilters(firstPage);
  const tagFilter = firstPage.getByRole("checkbox", {
    name: phase1cFixture.protagonistTag,
    exact: true
  });
  await tagFilter.check();
  const taggedGraphEvidence = await waitForWorldGraph(firstPage, 1, 0);
  await tagFilter.uncheck();
  await waitForWorldGraph(firstPage, 2, 1);
  const relationTypeFilter = firstPage.getByRole("checkbox", {
    name: `${phase1cFixture.relationTypeName} (1)`,
    exact: true
  });
  await relationTypeFilter.check();
  const directionFilter = firstPage.getByRole("combobox", {
    name: "관계 방향 필터"
  });
  await directionFilter.selectOption("DIRECTED");
  const labelFilter = firstPage.getByRole("checkbox", {
    name: "관계 label 표시",
    exact: true
  });
  await labelFilter.uncheck();
  await waitForWorldGraph(firstPage, 2, 1);

  const viewportInteraction = await zoomWorldGraphCanvas(firstPage);
  await openWorldGraphAccessibleList(firstPage);
  await firstPage
    .getByRole("region", { name: "그래프 설정 목록" })
    .locator(`button[data-entity-id="${protagonistId}"]`)
    .click();
  const persistedGraphEvidence = await waitForWorldGraphState(
    firstPage,
    {
      mode: "FOCUSED",
      depth: 3,
      focusedEntityId: protagonistId,
      selectedKind: "NODE",
      selectedId: protagonistId,
      layout: "preset",
      positionCount: 2,
      visibleNodeCount: 2,
      visibleEdgeCount: 1
    },
    "final persisted World Graph state"
  );
  await firstPage.waitForTimeout(800);
  const finalGraphEvidence = await readWorldGraphEvidence(firstPage);
  if (
    searchResultCount !== 1 ||
    !(await relationTypeFilter.isChecked()) ||
    (await directionFilter.inputValue()) !== "DIRECTED" ||
    (await labelFilter.isChecked()) ||
    finalGraphEvidence.performance.searchFocusMs === null ||
    finalGraphEvidence.performance.bfsMs === null ||
    !keyboardDetailFocus ||
    !relationNavigation ||
    !entityNavigation ||
    !sceneNavigation
  ) {
    throw new Error(
      `Phase 1D graph interaction acceptance failed: ${JSON.stringify({
        searchResultCount,
        keyboardDetailFocus,
        relationNavigation,
        entityNavigation,
        sceneNavigation,
        finalGraphEvidence
      })}`
    );
  }
  await firstPage.screenshot({ path: phase1dScreenshot });
  const phase1dAcceptance = {
    canonicalGraph: {
      nodeCount: 2,
      edgeCount: 1,
      nodeIds: initialGraphEvidence.accessible.nodeIds,
      edgeId: customRelationId,
      directed: true,
      actualCytoscapeCanvas: true,
      canvas: initialGraphEvidence.canvas,
      statsText: initialGraphEvidence.statsText
    },
    graphEntry: {
      ...firstGraphEntry.timing,
      memory: firstGraphEntry.memory,
      performance: initialGraphEvidence.performance
    },
    accessibility: {
      nodeSelection: true,
      edgeSelection: true,
      enterMovesFocusToDetail: keyboardDetailFocus,
      escapeClearsSelection: true
    },
    nodeDetail: {
      entityId: protagonistId,
      explicitSceneLinks: [
        { sceneId: sceneThreeId, role: "POV" },
        { sceneId: sceneFourId, role: "MENTIONED" }
      ],
      automaticMentionCandidates: 7
    },
    edgeDetail: {
      relationId: customRelationId,
      forwardLabel: phase1cFixture.relationTypeName,
      inverseLabel: phase1cFixture.relationTypeInverseName,
      note: phase1cFixture.relationNote,
      readOnly: true
    },
    navigation: {
      entity: entityNavigation,
      relation: relationNavigation,
      scene: sceneNavigation
    },
    search: {
      queryMatchedAlias: phase1cFixture.protagonistAlias,
      resultCount: searchResultCount,
      selectedEntityId: protagonistId
    },
    modes: {
      fullVisibleNodeCount: fullModeEvidence.state.visibleNodeCount,
      focusedDepths: focusedDepthEvidence
    },
    filters: {
      tagFilteredNodeCount: taggedGraphEvidence.state.visibleNodeCount,
      tagFilteredEdgeCount: taggedGraphEvidence.state.visibleEdgeCount,
      relationTypeId: customRelationTypeId,
      relationDirection: "DIRECTED",
      showLabels: false
    },
    viewportInteraction,
    persistedUiState: persistedGraphEvidence.state,
    finalPerformance: finalGraphEvidence.performance
  };
  reportStage(
    "Phase 1D real Cytoscape graph, accessibility, detail, search/filter, navigation, and persisted UI state verified"
  );

  await firstPage
    .getByRole("button", { name: "원고", exact: true })
    .click();

  await selectBinderScene(firstPage, binderTitles.sceneThree);

  const persistedBinderWidth = 420;
  const binderWidthControl = firstPage.getByRole("slider", {
    name: "Binder 폭"
  });
  await binderWidthControl.focus();
  await binderWidthControl.press("Home");
  for (let step = 220; step < persistedBinderWidth; step += 10) {
    await binderWidthControl.press("ArrowRight");
  }
  await pollBinderUi(
    async () =>
      Number(await binderWidthControl.inputValue()) === persistedBinderWidth,
    "Binder width change"
  );
  const volumeOneBeforeClose = await binderRowByTitle(
    firstPage,
    "VOLUME",
    binderTitles.volumeOne
  );
  await directBinderRow(volumeOneBeforeClose)
    .getByRole("button", {
      name: `${binderTitles.volumeOne} 접기`,
      exact: true
    })
    .click();
  await pollBinderUi(
    async () =>
      (await volumeOneBeforeClose.getAttribute("aria-expanded")) === "false",
    "collapsed Binder state"
  );
  await firstPage.waitForTimeout(700);
  reportStage("per-project Binder selection, expansion, and width state saved");

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
    pointerCanvas.cursorPage !== 1 ||
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
  await waitForBinderCounts(secondPage, {
    WORK: 1,
    VOLUME: 2
  });
  const restoredSelectedSceneRow = await binderRowByTitle(
    secondPage,
    "SCENE",
    binderTitles.sceneThree
  );
  const restoredSelectedNodeId = await restoredSelectedSceneRow.getAttribute(
    "data-node-id"
  );
  await pageWaitForSelectedBinderRow(
    secondPage,
    restoredSelectedNodeId
  );
  const restoredBinderWidth = Number(
    await secondPage
      .getByRole("slider", { name: "Binder 폭" })
      .inputValue()
  );
  const restoredVolumeOne = await binderRowByTitle(
    secondPage,
    "VOLUME",
    binderTitles.volumeOne
  );
  const restoredVolumeOneCollapsed =
    (await restoredVolumeOne.getAttribute("aria-expanded")) === "false";
  if (
    restoredSelectedNodeId !== sceneThreeId ||
    restoredBinderWidth !== persistedBinderWidth ||
    !restoredVolumeOneCollapsed
  ) {
    throw new Error(
      `Restart did not restore per-project Binder UI state: ${JSON.stringify({
        expected: {
          selectedNodeId: sceneThreeId,
          binderWidth: persistedBinderWidth,
          collapsedNodeId: volumeOneId
        },
        actual: {
          selectedNodeId: restoredSelectedNodeId,
          binderWidth: restoredBinderWidth,
          volumeOneCollapsed: restoredVolumeOneCollapsed
        }
      })}`
    );
  }
  await directBinderRow(restoredVolumeOne)
    .getByRole("button", {
      name: `${binderTitles.volumeOne} 펼치기`,
      exact: true
    })
    .click();
  await waitForBinderCounts(secondPage, binderExpectation.counts);
  const restoredBinderEvidence = await readBinderEvidence(secondPage);
  const verifiedRestoredBinder = verifyBinderEvidence(
    restoredBinderEvidence,
    binderExpectation,
    "restart"
  );
  if (
    JSON.stringify(restoredBinderEvidence) !==
    JSON.stringify(firstBinderEvidence)
  ) {
    throw new Error("Restart changed Binder node identity or DOM order");
  }
  const restoredDiagnostics = await readDiagnostics(secondPage);
  const restoredCanvas = await readCanvasEvidence(secondPage);
  await secondPage.screenshot({ path: restoredScreenshot });
  reportStage("restart restore evidence captured");

  const restoredShortSceneCharacters = [];
  for (const fixture of shortSceneFixtures) {
    await selectBinderScene(secondPage, fixture.title);
    const diagnostics = await readDiagnostics(secondPage);
    restoredShortSceneCharacters.push(
      parseDiagnosticInteger(diagnostics.recovery)
    );
  }
  if (
    JSON.stringify(restoredShortSceneCharacters) !==
    JSON.stringify(shortSceneRecoveryCharacters)
  ) {
    throw new Error(
      `Restart changed short-scene recovery counts: ${JSON.stringify({
        expected: shortSceneRecoveryCharacters,
        actual: restoredShortSceneCharacters
      })}`
    );
  }
  reportStage("restart Binder and short-scene recovery verified");

  const reopenedWorkRow = await binderRowByTitle(
    secondPage,
    "WORK",
    binderTitles.work
  );
  await directBinderRow(reopenedWorkRow)
    .getByRole("button", { name: binderTitles.work, exact: true })
    .click();
  const reopenedScrivenings = secondPage.getByRole("region", {
    name: "연속 원고 보기"
  });
  await pollBinderUi(
    async () =>
      (await reopenedScrivenings.locator("article[data-scene-id]").count()) ===
        11 &&
      (await reopenedScrivenings.locator("[data-live-editor-slot]").count()) ===
        1,
    "reopened 11-scene Scrivenings"
  );
  await secondPage
    .getByRole("button", { name: "Snapshot", exact: true })
    .click();
  const reopenedSnapshotPanel = secondPage.getByRole("complementary", {
    name: "Named snapshot"
  });
  await reopenedSnapshotPanel
    .getByText("저장된 snapshot 5개", { exact: true })
    .waitFor({ timeout: 30_000 });
  await secondPage.getByRole("button", { name: "검색 · 치환" }).click();
  const reopenedSearchPanel = secondPage.getByRole("complementary", {
    name: "프로젝트 검색 및 선택 치환"
  });
  await reopenedSearchPanel
    .getByRole("combobox", { name: "검색 대상" })
    .selectOption("BODIES");
  await reopenedSearchPanel
    .getByRole("radio", { name: "작품 전체", exact: true })
    .check();
  await reopenedSearchPanel
    .getByRole("searchbox", { name: "찾을 문자열" })
    .fill(phase1bSearchToken);
  await reopenedSearchPanel
    .getByRole("button", { name: "검색", exact: true })
    .click();
  await reopenedSearchPanel
    .getByText(/전체 7개 · 본문 7개 · 제목 0개 · 7개 장면/u)
    .waitFor({ timeout: 30_000 });
  const phase1bReopenAcceptance = {
    scriveningsSceneCount: 11,
    liveEditorCount: 1,
    namedSnapshotCount: 5,
    restoredSearchOccurrences: 7
  };
  reportStage("restart Phase 1B Scrivenings, search, and snapshots verified");

  await secondPage
    .getByRole("button", { name: "설정", exact: true })
    .click();
  await secondPage
    .getByRole("region", { name: "설정 작업 공간" })
    .waitFor({ state: "visible", timeout: 30_000 });
  const reopenedProtagonistId = await waitForStoryEntityId(
    secondPage,
    phase1cFixture.protagonistName
  );
  const reopenedLocationId = await waitForStoryEntityId(
    secondPage,
    phase1cFixture.locationName
  );
  if (
    (await storyEntityIds(secondPage)).length !== 2 ||
    reopenedProtagonistId !== protagonistId ||
    reopenedLocationId !== locationId
  ) {
    throw new Error(
      "Restart changed Phase 1C Story Bible entity identity or count"
    );
  }
  await storyEntityRowById(secondPage, protagonistId)
    .getByRole("button")
    .click();
  await pollBinderUi(
    async () =>
      (await secondPage
        .getByRole("textbox", { name: "설정 이름" })
        .inputValue()) === phase1cFixture.protagonistName &&
      (await secondPage
        .getByRole("textbox", { name: "설정 한 줄 요약" })
        .inputValue()) === phase1cFixture.protagonistSummary &&
      (await secondPage
        .getByRole("combobox", { name: "설정 상태 변경" })
        .inputValue()) === phase1cFixture.protagonistStatus &&
      (await storyNoteInput(secondPage).inputValue()) ===
        singleParagraphImeProjection(phase1cFixture.protagonistNote),
    "reopened Story Bible metadata and ENTITY Typie note",
    60_000
  );
  await secondPage
    .getByRole("region", { name: "별칭" })
    .getByRole("button", {
      name: `${phase1cFixture.protagonistAlias} 별칭 삭제`,
      exact: true
    })
    .waitFor({ timeout: 30_000 });
  if (
    !(await secondPage
      .getByRole("checkbox", { name: phase1cFixture.protagonistTag })
      .isChecked())
  ) {
    throw new Error("Restart did not restore the Phase 1C entity tag");
  }

  const reopenedRelationTypeManager = secondPage.locator(
    "details.relation-type-manager"
  );
  const reopenedRelationTypeId = await reopenedRelationTypeManager
    .locator("li[data-relation-type-id]")
    .filter({ hasText: phase1cFixture.relationTypeName })
    .getAttribute("data-relation-type-id");
  const reopenedRelationId = await secondPage
    .getByRole("region", { name: "나가는 관계" })
    .locator("li[data-relation-id]")
    .filter({ hasText: phase1cFixture.relationTypeName })
    .getAttribute("data-relation-id");
  const reopenedPromotedLink = secondPage.locator(promotedLinkSelector);
  const reopenedExplicitLink = secondPage.locator(explicitSceneLinkSelector);
  if (
    reopenedRelationTypeId !== customRelationTypeId ||
    reopenedRelationId !== customRelationId ||
    !(await reopenedPromotedLink.isVisible()) ||
    !(await reopenedExplicitLink.isVisible())
  ) {
    throw new Error(
      "Restart changed the Phase 1C relation type, relation, or scene links"
    );
  }
  const reopenedMentionSection = secondPage.getByRole("region", {
    name: "본문에서 찾은 후보"
  });
  await pollBinderUi(
    async () =>
      (await reopenedMentionSection.locator("li[data-mention-id]").count()) ===
      7,
    "reopened automatic mention candidates",
    60_000
  );
  const reopenedPromotedMention = reopenedMentionSection
    .locator("li[data-mention-id]")
    .filter({ hasText: binderTitles.sceneFour });
  await reopenedPromotedMention
    .getByText("명시적 연결됨", { exact: true })
    .waitFor({ timeout: 30_000 });
  await reopenedRelationTypeManager.locator("summary").click();
  await secondPage.screenshot({ path: phase1cReopenedScreenshot });
  const phase1cReopenAcceptance = {
    entityCount: 2,
    stableEntityIds: true,
    aliasRestored: true,
    tagRestored: true,
    entityNoteCharacters: Array.from(phase1cFixture.protagonistNote).length,
    stableRelationTypeId: reopenedRelationTypeId === customRelationTypeId,
    stableRelationId: reopenedRelationId === customRelationId,
    restoredSceneLinks: [
      { sceneId: sceneFourId, role: "MENTIONED" },
      { sceneId: sceneThreeId, role: "POV" }
    ],
    automaticMentionCandidates: 7,
    namedSnapshotCount: 5,
    processRestartRestore: true
  };
  reportStage(
    "restart Phase 1C entities, alias, tag, relation, links, mentions, and ENTITY note verified"
  );

  const reopenedGraphEntry = await openWorldGraph(secondPage, 2, 1);
  await openWorldGraphAccessibleList(secondPage);
  await openWorldGraphFilters(secondPage);
  const reopenedGraphEvidence = await readWorldGraphEvidence(secondPage);
  const reopenedRelationTypeFilter = secondPage.getByRole("checkbox", {
    name: `${phase1cFixture.relationTypeName} (1)`,
    exact: true
  });
  const reopenedDirectionFilter = secondPage.getByRole("combobox", {
    name: "관계 방향 필터"
  });
  const reopenedLabelFilter = secondPage.getByRole("checkbox", {
    name: "관계 label 표시",
    exact: true
  });
  const reopenedProtagonistGraphButton = secondPage
    .getByRole("region", { name: "그래프 설정 목록" })
    .locator(`button[data-entity-id="${protagonistId}"]`);
  const restoredViewportMatches = ["zoom", "panX", "panY"].every((key) => {
    const expected = finalGraphEvidence.state.viewport[key];
    const actual = reopenedGraphEvidence.state.viewport[key];
    return (
      typeof expected === "number" &&
      typeof actual === "number" &&
      Math.abs(expected - actual) < 0.001
    );
  });
  const reopenedDetail = secondPage.locator(
    '[data-testid="world-graph-detail"]'
  );
  await reopenedDetail
    .getByRole("heading", { name: phase1cFixture.protagonistName, exact: true })
    .waitFor({ timeout: 30_000 });
  await reopenedDetail
    .getByRole("region", { name: "본문 자동 언급 후보" })
    .getByText("7개", { exact: true })
    .waitFor({ timeout: 30_000 });
  if (
    reopenedGraphEvidence.state.mode !== "FOCUSED" ||
    reopenedGraphEvidence.state.depth !== 3 ||
    reopenedGraphEvidence.state.focusedEntityId !== protagonistId ||
    reopenedGraphEvidence.state.selectedKind !== "NODE" ||
    reopenedGraphEvidence.state.selectedId !== protagonistId ||
    reopenedGraphEvidence.state.layout !== "preset" ||
    reopenedGraphEvidence.state.positionCount !== 2 ||
    reopenedGraphEvidence.state.visibleNodeCount !== 2 ||
    reopenedGraphEvidence.state.visibleEdgeCount !== 1 ||
    reopenedGraphEvidence.canvas.elementCount === 0 ||
    reopenedGraphEvidence.canvas.nonTransparentSamples === 0 ||
    (await reopenedProtagonistGraphButton.getAttribute("aria-pressed")) !==
      "true" ||
    !(await reopenedRelationTypeFilter.isChecked()) ||
    (await reopenedDirectionFilter.inputValue()) !== "DIRECTED" ||
    (await reopenedLabelFilter.isChecked()) ||
    !restoredViewportMatches
  ) {
    throw new Error(
      `Restart did not restore project-specific Phase 1D graph UI state: ${JSON.stringify(
        {
          expected: finalGraphEvidence.state,
          actual: reopenedGraphEvidence,
          relationTypeFilter: await reopenedRelationTypeFilter.isChecked(),
          relationDirection: await reopenedDirectionFilter.inputValue(),
          showLabels: await reopenedLabelFilter.isChecked(),
          selectedNodePressed:
            await reopenedProtagonistGraphButton.getAttribute("aria-pressed"),
          restoredViewportMatches
        }
      )}`
    );
  }
  await secondPage.screenshot({ path: phase1dReopenedScreenshot });
  const phase1dReopenAcceptance = {
    graphEntry: {
      ...reopenedGraphEntry.timing,
      memory: reopenedGraphEntry.memory,
      performance: reopenedGraphEvidence.performance
    },
    restoredUiState: reopenedGraphEvidence.state,
    projectSpecificRestore: {
      focusedMode: true,
      focusedEntityId: protagonistId,
      depth: 3,
      relationTypeId: customRelationTypeId,
      relationDirection: "DIRECTED",
      showLabels: false,
      lastSelectedEntityId: protagonistId,
      nodePositionCount: 2,
      viewportMatches: restoredViewportMatches
    },
    actualCytoscapeCanvas: {
      restored: true,
      canvas: reopenedGraphEvidence.canvas
    },
    canonicalGraph: {
      nodeIds: reopenedGraphEvidence.accessible.nodeIds,
      edgeIds: reopenedGraphEvidence.accessible.edgeIds
    },
    detailReloaded: {
      entityId: protagonistId,
      automaticMentionCandidates: 7
    },
    processRestartRestore: true
  };
  reportStage(
    "restart Phase 1D focused graph, filters, node positions, viewport, selection, detail, and real canvas verified"
  );

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

  const externalRuntimeRequestUrls = [
    ...firstRun.requestedUrls.filter(
      (url) =>
        url !== firstRun.localFileProbeUrl && !isLocalRuntimeUrl(url)
    ),
    ...secondRun.requestedUrls.filter(
      (url) =>
        url !== secondRun.localFileProbeUrl && !isLocalRuntimeUrl(url)
    )
  ];
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
        binderAcceptance: {
          counts: verifiedFirstBinder.actualCounts,
          titles: verifiedFirstBinder.actualTitles,
          uniqueTitles: true,
          siblingOrderBeforeRestart: verifiedFirstBinder.siblingOrder,
          siblingOrderAfterRestart: verifiedRestoredBinder.siblingOrder,
          processRestartRestore: true
        },
        uiStateRestore: {
          selectedNodeId: restoredSelectedNodeId,
          selectedNonFallbackScene: restoredSelectedNodeId === sceneThreeId,
          collapsedNodeId: volumeOneId,
          binderWidth: restoredBinderWidth
        },
        shortSceneRecovery: {
          sceneCount: shortSceneFixtures.length,
          charactersBeforeRestart: shortSceneRecoveryCharacters,
          charactersAfterRestart: restoredShortSceneCharacters,
          saveBeforeLoad: true
        },
        phase1bAcceptance,
        phase1bReopenAcceptance,
        phase1cAcceptance,
        phase1cReopenAcceptance,
        phase1dAcceptance,
        phase1dReopenAcceptance,
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
        externalRuntimeRequests: externalRuntimeRequestUrls.length,
        externalRuntimeRequestUrls,
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
            : "output/playwright/madi-electron-ime-checklist.png",
          packaged
            ? "output/playwright/madi-packaged-phase1b.png"
            : "output/playwright/madi-electron-phase1b.png",
          packaged
            ? "output/playwright/madi-packaged-phase1c.png"
            : "output/playwright/madi-electron-phase1c.png",
          packaged
            ? "output/playwright/madi-packaged-phase1c-reopened.png"
            : "output/playwright/madi-electron-phase1c-reopened.png",
          packaged
            ? "output/playwright/madi-packaged-phase1d.png"
            : "output/playwright/madi-electron-phase1d.png",
          packaged
            ? "output/playwright/madi-packaged-phase1d-reopened.png"
            : "output/playwright/madi-electron-phase1d-reopened.png"
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
}
