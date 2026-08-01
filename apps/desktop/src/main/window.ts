import path from "node:path";
import {
  BrowserWindow,
  type Event,
  type Session,
  type WebPreferences
} from "electron";
import { IPC_EVENTS } from "../shared/contracts";
import { MADI_APP_ENTRY_URL } from "./appProtocol";

export const SECURE_WEB_PREFERENCES = Object.freeze({
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false
}) satisfies Readonly<WebPreferences>;

export interface WindowTarget {
  readonly rendererUrl: string;
  readonly isDevelopment: boolean;
}

export function resolveRendererDirectory(
  compiledMainDirectory: string
): string {
  return path.resolve(
    compiledMainDirectory,
    "..",
    "..",
    "renderer"
  );
}

export function resolveWindowTarget(
  compiledMainDirectory: string,
  developmentUrl: string | undefined
): WindowTarget {
  if (developmentUrl) {
    const parsed = new URL(developmentUrl);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
    ) {
      throw new Error("MADI_RENDERER_URL must use a loopback address");
    }
    return {
      rendererUrl: parsed.toString(),
      isDevelopment: true
    };
  }

  return {
    rendererUrl: MADI_APP_ENTRY_URL,
    isDevelopment: false
  };
}

function mayNavigateTo(candidate: string, rendererUrl: string): boolean {
  try {
    const requested = new URL(candidate);
    const expected = new URL(rendererUrl);
    requested.hash = "";
    requested.search = "";
    expected.hash = "";
    expected.search = "";
    return requested.toString() === expected.toString();
  } catch {
    return false;
  }
}

function isAllowedNetworkUrl(
  candidate: string,
  target: WindowTarget
): boolean {
  try {
    const url = new URL(candidate);
    if (["data:", "blob:", "devtools:"].includes(url.protocol)) {
      return true;
    }
    if (!target.isDevelopment) {
      return url.protocol === "madi:" && url.hostname === "app";
    }

    const renderer = new URL(target.rendererUrl);
    const isRendererProtocol =
      url.protocol === renderer.protocol ||
      (renderer.protocol === "http:" && url.protocol === "ws:") ||
      (renderer.protocol === "https:" && url.protocol === "wss:");
    return (
      isRendererProtocol &&
      url.hostname === renderer.hostname &&
      url.port === renderer.port
    );
  } catch {
    return false;
  }
}

export function installRuntimeNetworkGuard(
  electronSession: Session,
  target: WindowTarget
): void {
  electronSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false)
  );
  electronSession.setPermissionCheckHandler(() => false);
  electronSession.webRequest.onBeforeRequest(
    { urls: ["*://*/*"] },
    (details, callback) => {
      callback({ cancel: !isAllowedNetworkUrl(details.url, target) });
    }
  );
}

export function createMainWindow(
  preloadPath: string,
  target: WindowTarget
): BrowserWindow {
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 880,
    minHeight: 620,
    show: false,
    backgroundColor: "#f4f1e9",
    autoHideMenuBar: true,
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      preload: preloadPath
    }
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!mayNavigateTo(url, target.rendererUrl)) {
      event.preventDefault();
    }
  });
  window.once("ready-to-show", () => window.show());
  void window.loadURL(target.rendererUrl);
  return window;
}

export interface SafeWindowClose {
  complete(readyToClose: boolean): boolean;
  dispose(): void;
}

export const SAFE_WINDOW_CLOSE_RESPONSE_TIMEOUT_MS = 15_000;
export const SAFE_WINDOW_CLOSE_AUTHORIZATION_DELAY_MS = 100;

export function installSafeWindowClose(
  window: BrowserWindow,
  responseTimeoutMs = SAFE_WINDOW_CLOSE_RESPONSE_TIMEOUT_MS
): SafeWindowClose {
  let authorized = false;
  let closeScheduled = false;
  let requestPending = false;
  let responseTimeout: ReturnType<typeof setTimeout> | undefined;
  let authorizedCloseTimeout: ReturnType<typeof setTimeout> | undefined;

  const resetPendingRequest = () => {
    requestPending = false;
    if (responseTimeout) {
      clearTimeout(responseTimeout);
      responseTimeout = undefined;
    }
  };

  const closeAfterRendererFailure = () => {
    resetPendingRequest();
    closeScheduled = false;
    if (authorizedCloseTimeout) {
      clearTimeout(authorizedCloseTimeout);
      authorizedCloseTimeout = undefined;
    }
    if (!authorized && !window.isDestroyed()) {
      authorized = true;
      window.close();
    }
  };

  const onRendererGone = () => {
    closeAfterRendererFailure();
  };

  const onClose = (event: Event) => {
    if (authorized) {
      return;
    }
    if (window.webContents.isDestroyed()) {
      resetPendingRequest();
      authorized = true;
      return;
    }
    event.preventDefault();
    if (!requestPending && !closeScheduled) {
      requestPending = true;
      responseTimeout = setTimeout(() => {
        responseTimeout = undefined;
        requestPending = false;
      }, responseTimeoutMs);
      try {
        window.webContents.send(IPC_EVENTS.closeRequested);
      } catch {
        resetPendingRequest();
        if (window.webContents.isDestroyed()) {
          closeAfterRendererFailure();
        }
      }
    }
  };
  window.on("close", onClose);
  window.webContents.on("render-process-gone", onRendererGone);

  return {
    complete(readyToClose: boolean) {
      if (!requestPending) {
        return false;
      }
      resetPendingRequest();
      if (readyToClose && !window.isDestroyed()) {
        closeScheduled = true;
        authorizedCloseTimeout = setTimeout(() => {
          authorizedCloseTimeout = undefined;
          closeScheduled = false;
          if (!window.isDestroyed()) {
            authorized = true;
            window.close();
          }
        }, SAFE_WINDOW_CLOSE_AUTHORIZATION_DELAY_MS);
      }
      return true;
    },
    dispose() {
      resetPendingRequest();
      if (authorizedCloseTimeout) {
        clearTimeout(authorizedCloseTimeout);
        authorizedCloseTimeout = undefined;
      }
      window.removeListener("close", onClose);
      if (!window.webContents.isDestroyed()) {
        window.webContents.removeListener(
          "render-process-gone",
          onRendererGone
        );
      }
    }
  };
}
