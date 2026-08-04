import path from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  session,
  shell
} from "electron";
import { installMadiAppProtocol } from "./appProtocol";
import {
  JsonRpcCoreClient,
  resolveCoreBinary
} from "./coreClient";
import { DesktopService } from "./desktopService";
import { registerMadiIpc } from "./ipc";
import { ProjectSessionRegistry } from "./projectSessions";
import {
  ProcessEpubExporter,
  resolveEpubExporterBinary
} from "./epubExportClient";
import { EpubShutdownCoordinator } from "./epubShutdownCoordinator";
import {
  createMainWindow,
  installSafeWindowClose,
  installRuntimeNetworkGuard,
  resolveRendererDirectory,
  resolveWindowTarget
} from "./window";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "madi",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      codeCache: true
    }
  }
]);
app.enableSandbox();

let core: JsonRpcCoreClient | undefined;
let disposeIpc: (() => void) | undefined;
let networkGuardInstalled = false;
let appProtocolInstalled = false;
const epubShutdown = new EpubShutdownCoordinator<
  DesktopService,
  ProcessEpubExporter
>({
  abortPreparation: () => {
    const coreAtShutdown = core;
    core = undefined;
    coreAtShutdown?.dispose();
  },
  requestFinalQuit: () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      app.quit();
    }
  },
  scheduleRetry: (callback, delayMs) => {
    setTimeout(callback, delayMs);
  },
  recoverApplication: () => {
    dialog.showErrorBox(
      "madi 종료 보류",
      "EPUB 임시 파일 정리를 완료하지 못했습니다. 작업 창을 복구했으니 잠시 후 다시 종료해 주세요."
    );
    void openApplicationWindow();
  }
});
let epubShutdownStartScheduled = false;

function scheduleEpubShutdown(): void {
  if (
    epubShutdownStartScheduled ||
    epubShutdown.isInProgress ||
    epubShutdown.isComplete
  ) {
    return;
  }
  epubShutdownStartScheduled = true;
  // Start cleanup on the next Node turn. An accepted close leaves a 100 ms
  // authorization gap before the window disappears, while crash and quit
  // fallbacks unwind their native lifecycle callback before cleanup begins.
  setImmediate(() => {
    epubShutdownStartScheduled = false;
    epubShutdown.beginShutdown();
  });
}

async function openApplicationWindow(): Promise<void> {
  const target = resolveWindowTarget(
    {
      isPackaged: app.isPackaged,
      developmentUrl: process.env.MADI_RENDERER_URL?.trim() || undefined
    }
  );
  const preloadPath = path.resolve(
    __dirname,
    "..",
    "preload",
    "index.cjs"
  );

  if (!target.isDevelopment && !appProtocolInstalled) {
    installMadiAppProtocol(
      protocol,
      resolveRendererDirectory(__dirname)
    );
    appProtocolInstalled = true;
  }

  if (!networkGuardInstalled) {
    installRuntimeNetworkGuard(session.defaultSession, target);
    networkGuardInstalled = true;
  }

  const window = createMainWindow(preloadPath, target);
  const safeClose = installSafeWindowClose(window);

  if (!core) {
    const binaryPath = resolveCoreBinary({
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      isPackaged: app.isPackaged
    });
    core = new JsonRpcCoreClient(binaryPath);
  }
  const epubExporter = epubShutdown.getOrCreateExporter(
    () => new ProcessEpubExporter(
      resolveEpubExporterBinary({
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
        isPackaged: app.isPackaged
      })
    )
  );

  disposeIpc?.();
  const service = new DesktopService(
    window,
    dialog,
    core,
    new ProjectSessionRegistry(),
    app.getVersion(),
    epubExporter,
    shell
  );
  epubShutdown.registerService(service);
  disposeIpc = registerMadiIpc({
    ipcMain,
    window,
    rendererUrl: target.rendererUrl,
    service,
    appVersion: app.getVersion(),
    onCloseReady: (readyToClose) => {
      if (readyToClose && process.platform !== "darwin") {
        scheduleEpubShutdown();
      }
      return safeClose.complete(readyToClose);
    }
  });

  window.once("closed", () => {
    safeClose.dispose();
    disposeIpc?.();
    disposeIpc = undefined;
    void epubShutdown.releaseService(service).catch(() => {
      // Keep the service registered so application quit remains fail-closed.
    });
  });
}

void app.whenReady().then(openApplicationWindow);

app.on("activate", () => {
  if (
    process.platform === "darwin" &&
    !disposeIpc &&
    !epubShutdown.isInProgress &&
    !epubShutdown.isComplete
  ) {
    void openApplicationWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    if (epubShutdown.isComplete) {
      app.quit();
    } else {
      scheduleEpubShutdown();
    }
  }
});

app.on("will-quit", (event) => {
  if (!epubShutdown.isComplete) {
    event.preventDefault();
    // The renderer has already authorized every window close at will-quit.
    // Scheduling shutdown now bounds any abandoned PREPARING compilation
    // after a renderer crash; a refused close never reaches this point.
    scheduleEpubShutdown();
    return;
  }
  disposeIpc?.();
  core?.dispose();
});
