import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent
} from "electron";
import {
  IPC_CHANNELS,
  type CompleteCloseRequest,
  type CreateNodeRequest,
  type CreateProjectRequest,
  type DeleteNodeRequest,
  type LoadSceneDocumentRequest,
  type LoadDocumentRequest,
  type MoveNodeRequest,
  type OpenProjectRequest,
  type RecoverPlainTextRequest,
  type RenameNodeRequest,
  type ReorderNodeRequest,
  type SaveSceneDocumentRequest,
  type SaveDocumentRequest,
  type SaveUiStateRequest,
  type SessionRequest
} from "../shared/contracts";
import type { DesktopService } from "./desktopService";

function requireObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid request");
  }
  return value as Record<string, unknown>;
}

function normalizedUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

export function isTrustedIpcSender(
  event: IpcMainInvokeEvent,
  window: BrowserWindow,
  rendererUrl: string
): boolean {
  if (
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  ) {
    return false;
  }

  const actual = normalizedUrl(event.senderFrame.url);
  const expected = normalizedUrl(rendererUrl);
  if (!actual || !expected) {
    return false;
  }

  const expectedUrl = new URL(expected);
  const actualUrl = new URL(actual);
  if (expectedUrl.protocol === "http:" || expectedUrl.protocol === "https:") {
    return (
      actualUrl.origin === expectedUrl.origin &&
      actualUrl.pathname === expectedUrl.pathname
    );
  }
  return actual === expected;
}

export interface RegisterIpcOptions {
  readonly ipcMain: IpcMain;
  readonly window: BrowserWindow;
  readonly rendererUrl: string;
  readonly service: DesktopService;
  readonly appVersion: string;
  readonly onCloseReady: (readyToClose: boolean) => boolean;
}

export function registerMadiIpc({
  ipcMain,
  window,
  rendererUrl,
  service,
  appVersion,
  onCloseReady
}: RegisterIpcOptions): () => void {
  const authorize = (event: IpcMainInvokeEvent): void => {
    if (!isTrustedIpcSender(event, window, rendererUrl)) {
      throw new Error("Rejected IPC sender");
    }
  };

  ipcMain.handle(
    IPC_CHANNELS.createProject,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.createProject(
        requireObject(rawRequest) as unknown as CreateProjectRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.openProject,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.openProject(
        requireObject(rawRequest) as unknown as OpenProjectRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.saveDocument,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.saveDocument(
        requireObject(rawRequest) as unknown as SaveDocumentRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.loadDocument,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.loadDocument(
        requireObject(rawRequest) as unknown as LoadDocumentRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.recoverPlainText,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.recoverPlainText(
        requireObject(rawRequest) as unknown as RecoverPlainTextRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.getProjectTree,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.getProjectTree(
        requireObject(rawRequest) as unknown as SessionRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.createNode,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.createNode(
        requireObject(rawRequest) as unknown as CreateNodeRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.renameNode,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.renameNode(
        requireObject(rawRequest) as unknown as RenameNodeRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.moveNode,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.moveNode(
        requireObject(rawRequest) as unknown as MoveNodeRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.reorderNode,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.reorderNode(
        requireObject(rawRequest) as unknown as ReorderNodeRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.deleteNode,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.deleteNode(
        requireObject(rawRequest) as unknown as DeleteNodeRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.loadSceneDocument,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.loadSceneDocument(
        requireObject(rawRequest) as unknown as LoadSceneDocumentRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.saveSceneDocument,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.saveSceneDocument(
        requireObject(rawRequest) as unknown as SaveSceneDocumentRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.saveUiState,
    async (event, rawRequest: unknown) => {
      authorize(event);
      await service.saveUiState(
        requireObject(rawRequest) as unknown as SaveUiStateRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.loadUiState,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.loadUiState(
        requireObject(rawRequest) as unknown as SessionRequest
      );
    }
  );

  ipcMain.handle(IPC_CHANNELS.getAppVersion, async (event) => {
    authorize(event);
    return appVersion;
  });

  ipcMain.handle(
    IPC_CHANNELS.completeCloseRequest,
    async (event, rawRequest: unknown) => {
      authorize(event);
      const request =
        requireObject(rawRequest) as unknown as CompleteCloseRequest;
      if (typeof request.readyToClose !== "boolean") {
        throw new Error("Invalid close request");
      }
      return onCloseReady(request.readyToClose);
    }
  );

  return () => {
    for (const channel of Object.values(IPC_CHANNELS)) {
      ipcMain.removeHandler(channel);
    }
  };
}
