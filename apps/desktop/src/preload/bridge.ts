import {
  IPC_CHANNELS,
  type ApplyReplacementBatchRequest,
  type ApplyReplacementBatchResult,
  IPC_EVENTS,
  type CompleteCloseRequest,
  type CreateNamedSnapshotRequest,
  type CreateNodeRequest,
  type CreateProjectRequest,
  type DeleteNodeRequest,
  type DeleteNamedSnapshotRequest,
  type DeleteNamedSnapshotResult,
  type DiffNamedSnapshotRequest,
  type DiffNamedSnapshotResult,
  type LoadedSceneDocument,
  type LoadedDocument,
  type LoadSceneDocumentRequest,
  type LoadDocumentRequest,
  type LoadUiStateResult,
  type ListDescendantScenesRequest,
  type ListDescendantScenesResult,
  type ListNamedSnapshotsResult,
  type MadiDesktopApi,
  type NamedSnapshotMutationResult,
  type MoveNodeRequest,
  type OpenProjectRequest,
  type PlainTextRecovery,
  type ProjectTree,
  type ProjectSession,
  type RecoverPlainTextRequest,
  type RenameNamedSnapshotRequest,
  type RenameNodeRequest,
  type ReorderNodeRequest,
  type SaveSceneDocumentRequest,
  type SaveSceneDocumentResult,
  type SaveDocumentRequest,
  type SaveDocumentResult,
  type SaveUiStateRequest,
  type ScopeNodeRequest,
  type SearchProjectRequest,
  type SearchProjectResult,
  type SessionRequest,
  type RestoreNamedSnapshotRequest,
  type RestoreNamedSnapshotResult,
  type TextStatisticsResult
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

    async getProjectTree(request: SessionRequest): Promise<ProjectTree> {
      return (await invoke(
        IPC_CHANNELS.getProjectTree,
        request
      )) as ProjectTree;
    },

    async createNode(request: CreateNodeRequest): Promise<ProjectTree> {
      return (await invoke(IPC_CHANNELS.createNode, request)) as ProjectTree;
    },

    async renameNode(request: RenameNodeRequest): Promise<ProjectTree> {
      return (await invoke(IPC_CHANNELS.renameNode, request)) as ProjectTree;
    },

    async moveNode(request: MoveNodeRequest): Promise<ProjectTree> {
      return (await invoke(IPC_CHANNELS.moveNode, request)) as ProjectTree;
    },

    async reorderNode(request: ReorderNodeRequest): Promise<ProjectTree> {
      return (await invoke(IPC_CHANNELS.reorderNode, request)) as ProjectTree;
    },

    async deleteNode(request: DeleteNodeRequest): Promise<ProjectTree> {
      return (await invoke(IPC_CHANNELS.deleteNode, request)) as ProjectTree;
    },

    async loadSceneDocument(
      request: LoadSceneDocumentRequest
    ): Promise<LoadedSceneDocument> {
      const document = (await invoke(
        IPC_CHANNELS.loadSceneDocument,
        request
      )) as LoadedSceneDocument;
      return { ...document, snapshot: copyBytes(document.snapshot) };
    },

    async saveSceneDocument(
      request: SaveSceneDocumentRequest
    ): Promise<SaveSceneDocumentResult> {
      return (await invoke(IPC_CHANNELS.saveSceneDocument, {
        ...request,
        snapshot: copyBytes(request.snapshot)
      })) as SaveSceneDocumentResult;
    },

    async saveUiState(request: SaveUiStateRequest): Promise<void> {
      await invoke(IPC_CHANNELS.saveUiState, request);
    },

    async loadUiState(request: SessionRequest): Promise<LoadUiStateResult> {
      return (await invoke(
        IPC_CHANNELS.loadUiState,
        request
      )) as LoadUiStateResult;
    },

    async listDescendantScenes(
      request: ListDescendantScenesRequest
    ): Promise<ListDescendantScenesResult> {
      return (await invoke(
        IPC_CHANNELS.listDescendantScenes,
        request
      )) as ListDescendantScenesResult;
    },

    async searchProject(
      request: SearchProjectRequest
    ): Promise<SearchProjectResult> {
      return (await invoke(
        IPC_CHANNELS.searchProject,
        request
      )) as SearchProjectResult;
    },

    async getTextStatistics(
      request: ScopeNodeRequest
    ): Promise<TextStatisticsResult> {
      return (await invoke(
        IPC_CHANNELS.getTextStatistics,
        request
      )) as TextStatisticsResult;
    },

    async applyReplacementBatch(
      request: ApplyReplacementBatchRequest
    ): Promise<ApplyReplacementBatchResult> {
      return (await invoke(IPC_CHANNELS.applyReplacementBatch, {
        ...request,
        transformedScenes: request.transformedScenes.map((scene) => ({
          ...scene,
          snapshot: copyBytes(scene.snapshot)
        }))
      })) as ApplyReplacementBatchResult;
    },

    async createNamedSnapshot(
      request: CreateNamedSnapshotRequest
    ): Promise<NamedSnapshotMutationResult> {
      return (await invoke(
        IPC_CHANNELS.createNamedSnapshot,
        request
      )) as NamedSnapshotMutationResult;
    },

    async listNamedSnapshots(
      request: SessionRequest
    ): Promise<ListNamedSnapshotsResult> {
      return (await invoke(
        IPC_CHANNELS.listNamedSnapshots,
        request
      )) as ListNamedSnapshotsResult;
    },

    async renameNamedSnapshot(
      request: RenameNamedSnapshotRequest
    ): Promise<NamedSnapshotMutationResult> {
      return (await invoke(
        IPC_CHANNELS.renameNamedSnapshot,
        request
      )) as NamedSnapshotMutationResult;
    },

    async deleteNamedSnapshot(
      request: DeleteNamedSnapshotRequest
    ): Promise<DeleteNamedSnapshotResult> {
      return (await invoke(
        IPC_CHANNELS.deleteNamedSnapshot,
        request
      )) as DeleteNamedSnapshotResult;
    },

    async diffNamedSnapshot(
      request: DiffNamedSnapshotRequest
    ): Promise<DiffNamedSnapshotResult> {
      return (await invoke(
        IPC_CHANNELS.diffNamedSnapshot,
        request
      )) as DiffNamedSnapshotResult;
    },

    async restoreNamedSnapshot(
      request: RestoreNamedSnapshotRequest
    ): Promise<RestoreNamedSnapshotResult> {
      return (await invoke(
        IPC_CHANNELS.restoreNamedSnapshot,
        request
      )) as RestoreNamedSnapshotResult;
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
