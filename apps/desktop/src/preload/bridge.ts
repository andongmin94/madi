import {
  IPC_CHANNELS,
  IPC_EVENTS,
  type CompleteCloseRequest,
  type CreateProjectRequest,
  type LoadedDocument,
  type LoadDocumentRequest,
  type MadiDesktopApi,
  type OpenProjectRequest,
  type PlainTextRecovery,
  type ProjectSession,
  type RecoverPlainTextRequest,
  type SaveDocumentRequest,
  type SaveDocumentResult
} from "../shared/contracts";

export type Invoke = (
  channel: string,
  ...arguments_: readonly unknown[]
) => Promise<unknown>;

export type Subscribe = (
  channel: string,
  listener: () => void
) => () => void;

function copyBytes(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(bytes);
}

/**
 * Kept separate from Electron's contextBridge so the capability surface can
 * be unit-tested without loading an Electron process.
 */
export function createMadiDesktopApi(
  invoke: Invoke,
  subscribe: Subscribe = () => () => undefined
): MadiDesktopApi {
  const closeRequestListeners = new Set<() => void>();
  let closeRequestBuffered = false;

  subscribe(IPC_EVENTS.closeRequested, () => {
    if (closeRequestListeners.size === 0) {
      closeRequestBuffered = true;
      return;
    }
    for (const listener of closeRequestListeners) {
      listener();
    }
  });

  return Object.freeze({
    async createProject(
      request: CreateProjectRequest
    ): Promise<ProjectSession | null> {
      return (await invoke(
        IPC_CHANNELS.createProject,
        request
      )) as ProjectSession | null;
    },

    async openProject(
      request: OpenProjectRequest = {}
    ): Promise<ProjectSession | null> {
      return (await invoke(
        IPC_CHANNELS.openProject,
        request
      )) as ProjectSession | null;
    },

    async saveDocument(
      request: SaveDocumentRequest
    ): Promise<SaveDocumentResult> {
      return (await invoke(IPC_CHANNELS.saveDocument, {
        ...request,
        snapshot: copyBytes(request.snapshot)
      })) as SaveDocumentResult;
    },

    async loadDocument(
      request: LoadDocumentRequest
    ): Promise<LoadedDocument> {
      const document = (await invoke(
        IPC_CHANNELS.loadDocument,
        request
      )) as LoadedDocument;

      return {
        ...document,
        snapshot: copyBytes(document.snapshot)
      };
    },

    async recoverPlainText(
      request: RecoverPlainTextRequest
    ): Promise<PlainTextRecovery> {
      return (await invoke(
        IPC_CHANNELS.recoverPlainText,
        request
      )) as PlainTextRecovery;
    },

    async getAppVersion(): Promise<string> {
      return (await invoke(IPC_CHANNELS.getAppVersion)) as string;
    },

    onCloseRequested(listener: () => void): () => void {
      closeRequestListeners.add(listener);
      if (closeRequestBuffered) {
        closeRequestBuffered = false;
        listener();
      }
      return () => {
        closeRequestListeners.delete(listener);
      };
    },

    async completeCloseRequest(
      request: CompleteCloseRequest
    ): Promise<boolean> {
      return (await invoke(
        IPC_CHANNELS.completeCloseRequest,
        request
      )) as boolean;
    }
  }) satisfies MadiDesktopApi;
}
