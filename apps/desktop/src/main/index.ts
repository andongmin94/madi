import path from "node:path";
import {
  app,
  dialog,
  ipcMain,
  protocol,
  session
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

  disposeIpc?.();
  const service = new DesktopService(
    window,
    dialog,
    core,
    new ProjectSessionRegistry(),
    app.getVersion()
  );
  disposeIpc = registerMadiIpc({
    ipcMain,
    window,
    rendererUrl: target.rendererUrl,
    service,
    appVersion: app.getVersion(),
    onCloseReady: (readyToClose) => safeClose.complete(readyToClose)
  });

  window.once("closed", () => {
    safeClose.dispose();
    disposeIpc?.();
    disposeIpc = undefined;
  });
}

void app.whenReady().then(openApplicationWindow);

app.on("activate", () => {
  if (process.platform === "darwin" && !disposeIpc) {
    void openApplicationWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  disposeIpc?.();
  core?.dispose();
});
