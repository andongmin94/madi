import path from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  safeStorage,
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
import {
  ProcessHwpxExporter,
  resolveHwpxExporterBinary
} from "./hwpxExportClient";
import {
  ProcessHwpBridge,
  resolveHwpBridgeBinary
} from "./hwpBridgeClient";
import { FileHwpxCrashRecoveryRegistry } from "./hwpxCrashRecovery";
import {
  ProcessAtomicOutput,
  resolveAtomicOutputBinary
} from "./atomicOutputClient";
import { EpubShutdownCoordinator } from "./epubShutdownCoordinator";
import { ElectronSafeStorageProtector } from "./llm/electronSecretProtector";
import { registerMadiLlmIpc } from "./llm/ipc";
import { FileLlmProviderStore } from "./llm/providerStore";
import { LlmRuntimeService } from "./llm/service";
import {
  createMainWindow,
  installRuntimeProcessNetworkBoundary,
  installSafeWindowClose,
  installRuntimeNetworkGuard,
  resolveRendererDirectory,
  resolveWindowTarget
} from "./window";

installRuntimeProcessNetworkBoundary(app.commandLine);
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
let disposeLlmIpc: (() => void) | undefined;
let llmService: LlmRuntimeService | undefined;
let networkGuardInstalled = false;
let appProtocolInstalled = false;
let hwpxCrashRecovery: FileHwpxCrashRecoveryRegistry | undefined;
let atomicOutput: ProcessAtomicOutput | undefined;

class ProcessExportRuntime {
  public readonly epub: ProcessEpubExporter;
  public readonly hwpx: ProcessHwpxExporter;
  public readonly hwpBridge: ProcessHwpBridge;

  public constructor() {
    const options = {
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      isPackaged: app.isPackaged
    };
    this.epub = new ProcessEpubExporter(resolveEpubExporterBinary(options));
    this.hwpx = new ProcessHwpxExporter(resolveHwpxExporterBinary(options));
    this.hwpBridge = new ProcessHwpBridge(resolveHwpBridgeBinary(options));
  }

  public async dispose(): Promise<void> {
    const results = await Promise.allSettled([
      this.epub.dispose(),
      this.hwpx.dispose(),
      this.hwpBridge.dispose()
    ]);
    if (results.some((result) => result.status === "rejected")) {
      throw new Error("One or more export utilities did not shut down cleanly");
    }
  }
}

const epubShutdown = new EpubShutdownCoordinator<
  DesktopService,
  ProcessExportRuntime
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
      "내보내기 임시 파일 정리를 완료하지 못했습니다. 작업 창을 복구했으니 잠시 후 다시 종료해 주세요."
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
  setImmediate(() => {
    epubShutdownStartScheduled = false;
    epubShutdown.beginShutdown();
  });
}

async function getOrCreateLlmService(): Promise<LlmRuntimeService> {
  if (llmService) {
    return llmService;
  }
  const store = new FileLlmProviderStore(
    path.join(app.getPath("userData"), "llm-providers-v1"),
    new ElectronSafeStorageProtector(safeStorage)
  );
  const service = new LlmRuntimeService(store);
  await service.initialize();
  llmService = service;
  return service;
}

async function openApplicationWindow(): Promise<void> {
  if (!atomicOutput) {
    atomicOutput = new ProcessAtomicOutput(
      resolveAtomicOutputBinary({
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
        isPackaged: app.isPackaged
      })
    );
  }
  if (!hwpxCrashRecovery) {
    hwpxCrashRecovery = new FileHwpxCrashRecoveryRegistry(
      path.join(app.getPath("userData"), "hwpx-recovery-v1"),
      { atomicOutput }
    );
  }
  await hwpxCrashRecovery.initialize();
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
  const exportRuntime = epubShutdown.getOrCreateExporter(
    () => new ProcessExportRuntime()
  );
  const optionalLlmService = await getOrCreateLlmService();

  disposeIpc?.();
  disposeLlmIpc?.();
  const service = new DesktopService(
    window,
    dialog,
    core,
    new ProjectSessionRegistry(),
    app.getVersion(),
    exportRuntime.epub,
    shell,
    exportRuntime.hwpx,
    exportRuntime.hwpBridge,
    undefined,
    process.platform,
    hwpxCrashRecovery,
    atomicOutput
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
  disposeLlmIpc = registerMadiLlmIpc({
    ipcMain,
    window,
    rendererUrl: target.rendererUrl,
    service: optionalLlmService
  });

  window.once("closed", () => {
    safeClose.dispose();
    disposeIpc?.();
    disposeIpc = undefined;
    disposeLlmIpc?.();
    disposeLlmIpc = undefined;
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
    scheduleEpubShutdown();
    return;
  }
  disposeIpc?.();
  disposeLlmIpc?.();
  llmService?.dispose();
  core?.dispose();
});
