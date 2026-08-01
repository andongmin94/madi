export const IPC_CHANNELS = {
  createProject: "madi:create-project",
  openProject: "madi:open-project",
  saveDocument: "madi:save-document",
  loadDocument: "madi:load-document",
  recoverPlainText: "madi:recover-plain-text",
  getAppVersion: "madi:get-app-version",
  completeCloseRequest: "madi:complete-close-request"
} as const;

export const IPC_EVENTS = {
  closeRequested: "madi:close-requested"
} as const;

export type MadiIpcChannel =
  (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const ALLOWED_IPC_CHANNELS = Object.freeze(
  Object.values(IPC_CHANNELS)
) as readonly MadiIpcChannel[];

export interface ProjectSession {
  readonly sessionId: string;
  readonly fileName: string;
  readonly projectId: string;
  readonly documentId?: string;
  readonly title: string;
  readonly revision: number;
}

export interface CreateProjectRequest {
  readonly title: string;
  readonly suggestedFileName?: string;
  readonly editorEngine: "typie";
  readonly editorEngineCommit: string;
  readonly editorSchemaVersion: number;
}

export interface OpenProjectRequest {
  readonly documentId?: string;
}

export interface SaveDocumentRequest {
  readonly sessionId: string;
  readonly documentId?: string;
  readonly title: string;
  readonly editorEngine: "typie";
  readonly editorEngineCommit: string;
  readonly editorSchemaVersion: number;
  readonly snapshot: Uint8Array;
  readonly plainTextRecovery: string;
}

export interface SaveDocumentResult {
  readonly documentId: string;
  readonly revision: number;
  readonly updatedAt: string;
}

export interface LoadDocumentRequest {
  readonly sessionId: string;
  readonly documentId?: string;
}

export interface LoadedDocument {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly editorEngine: string;
  readonly editorEngineCommit: string;
  readonly editorSchemaVersion: number;
  readonly snapshot: Uint8Array;
  readonly plainTextRecovery: string;
  readonly revision: number;
  readonly updatedAt: string;
}

export interface RecoverPlainTextRequest {
  readonly sessionId: string;
  readonly documentId?: string;
}

export interface PlainTextRecovery {
  readonly documentId: string;
  readonly plainText: string;
  readonly revision: number;
}

export interface CompleteCloseRequest {
  readonly readyToClose: boolean;
}

/**
 * The complete renderer capability surface. In particular, it intentionally
 * has no generic `invoke`, file-system path, process, shell, or RPC method.
 */
export interface MadiDesktopApi {
  createProject(
    request: CreateProjectRequest
  ): Promise<ProjectSession | null>;
  openProject(
    request?: OpenProjectRequest
  ): Promise<ProjectSession | null>;
  saveDocument(request: SaveDocumentRequest): Promise<SaveDocumentResult>;
  loadDocument(request: LoadDocumentRequest): Promise<LoadedDocument>;
  recoverPlainText(
    request: RecoverPlainTextRequest
  ): Promise<PlainTextRecovery>;
  getAppVersion(): Promise<string>;
  onCloseRequested(listener: () => void): () => void;
  completeCloseRequest(request: CompleteCloseRequest): Promise<boolean>;
}
