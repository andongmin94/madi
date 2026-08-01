export const IPC_CHANNELS = {
  createProject: "madi:create-project",
  openProject: "madi:open-project",
  saveDocument: "madi:save-document",
  loadDocument: "madi:load-document",
  recoverPlainText: "madi:recover-plain-text",
  getProjectTree: "madi:get-project-tree",
  createNode: "madi:create-node",
  renameNode: "madi:rename-node",
  moveNode: "madi:move-node",
  reorderNode: "madi:reorder-node",
  deleteNode: "madi:delete-node",
  loadSceneDocument: "madi:load-scene-document",
  saveSceneDocument: "madi:save-scene-document",
  saveUiState: "madi:save-ui-state",
  loadUiState: "madi:load-ui-state",
  listDescendantScenes: "madi:list-descendant-scenes",
  searchProject: "madi:search-project",
  getTextStatistics: "madi:get-text-statistics",
  applyReplacementBatch: "madi:apply-replacement-batch",
  createNamedSnapshot: "madi:create-named-snapshot",
  listNamedSnapshots: "madi:list-named-snapshots",
  renameNamedSnapshot: "madi:rename-named-snapshot",
  deleteNamedSnapshot: "madi:delete-named-snapshot",
  diffNamedSnapshot: "madi:diff-named-snapshot",
  restoreNamedSnapshot: "madi:restore-named-snapshot",
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
  readonly sceneId?: string;
  readonly workNodeId?: string;
  readonly title: string;
  readonly revision: number;
}

export type TreeNodeKind = "WORK" | "VOLUME" | "CHAPTER" | "SCENE";

export interface ProjectRecord {
  readonly id: string;
  readonly title: string;
  readonly authorName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TreeNodeRecord {
  readonly id: string;
  readonly projectId: string;
  readonly parentId: string | null;
  readonly kind: TreeNodeKind;
  readonly title: string;
  readonly orderKey: number;
  readonly documentId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectTree {
  readonly project: ProjectRecord;
  readonly nodes: readonly TreeNodeRecord[];
  readonly revision: number;
}

export interface SessionRequest {
  readonly sessionId: string;
}

export interface CreateNodeRequest extends SessionRequest {
  readonly parentId: string;
  readonly kind: Exclude<TreeNodeKind, "WORK">;
  readonly title: string;
  readonly editorEngineCommit: string;
  readonly editorSchemaVersion: number;
}

export interface RenameNodeRequest extends SessionRequest {
  readonly nodeId: string;
  readonly title: string;
}

export interface MoveNodeRequest extends SessionRequest {
  readonly nodeId: string;
  readonly newParentId: string;
}

export interface ReorderNodeRequest extends SessionRequest {
  readonly nodeId: string;
  readonly direction: "up" | "down";
}

export interface DeleteNodeRequest extends SessionRequest {
  readonly nodeId: string;
  readonly recursive: boolean;
}

export interface LoadSceneDocumentRequest extends SessionRequest {
  readonly sceneId: string;
}

export interface LoadedSceneDocument extends LoadedDocument {
  readonly sceneId: string;
}

export interface SaveSceneDocumentRequest extends SessionRequest {
  readonly sceneId: string;
  readonly documentId: string;
  readonly generation: number;
  readonly saveSequence: number;
  readonly editorEngine: "typie";
  readonly editorEngineCommit: string;
  readonly editorSchemaVersion: number;
  readonly snapshot: Uint8Array;
  readonly plainTextRecovery: string;
}

export interface SaveSceneDocumentResult extends SaveDocumentResult {
  readonly sceneId: string;
  readonly generation: number;
  readonly saveSequence: number;
}

export interface ProjectUiState {
  readonly selectedNodeId: string | null;
  readonly expandedNodeIds: readonly string[];
  readonly binderWidth: number;
}

export interface SaveUiStateRequest extends SessionRequest {
  readonly state: ProjectUiState;
}

export interface LoadUiStateResult {
  readonly state: ProjectUiState | null;
}

export interface ScopeNodeRequest extends SessionRequest {
  readonly scopeNodeId: string;
}

export interface ListDescendantScenesRequest extends ScopeNodeRequest {
  readonly offset?: number;
  readonly limit?: number;
}

export interface DescendantScenePreview {
  readonly sceneId: string;
  readonly documentId: string;
  readonly plainTextRecovery: string;
  readonly sourceContentHash: string;
  readonly updatedAt: string;
}

export interface ListDescendantScenesResult {
  readonly scopeNodeId: string;
  readonly scenes: readonly DescendantScenePreview[];
  readonly totalScenes: number;
  readonly offset: number;
  readonly limit: number;
  readonly nextOffset: number | null;
  readonly hasMore: boolean;
  readonly revision: number;
}

export type SearchTarget = "TITLES" | "BODIES" | "ALL";
export type SearchField = "TITLE" | "BODY";

export interface SearchProjectRequest extends SessionRequest {
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly target: SearchTarget;
  readonly scopeNodeId?: string;
  readonly offset?: number;
  readonly limit?: number;
}

export interface SearchHit {
  readonly occurrenceId: string;
  readonly nodeId: string;
  readonly sceneId: string | null;
  readonly documentId: string | null;
  readonly nodeKind: TreeNodeKind;
  readonly nodeTitle: string;
  readonly field: SearchField;
  /** Unicode-scalar offsets into the title or annotated recovery string. */
  readonly start: number;
  readonly end: number;
  readonly contextBefore: string;
  readonly matchedText: string;
  readonly contextAfter: string;
  readonly sourceContentHash: string | null;
}

export interface SearchProjectResult {
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly target: SearchTarget;
  readonly scopeNodeId: string;
  readonly totalMatches: number;
  readonly sceneCount: number;
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
  readonly hits: readonly SearchHit[];
  readonly revision: number;
}

export interface SceneTextStatistics {
  readonly sceneId: string;
  readonly documentId: string;
  readonly withSpaces: number;
  readonly withoutSpaces: number;
}

export interface TextStatisticsResult {
  readonly scopeNodeId: string;
  readonly sceneCount: number;
  readonly withSpaces: number;
  readonly withoutSpaces: number;
  readonly scenes: readonly SceneTextStatistics[];
  readonly revision: number;
}

export type NamedSnapshotKind =
  | "MANUAL"
  | "AUTO_BEFORE_REPLACE"
  | "AUTO_BEFORE_RESTORE";

export interface NamedSnapshotSummary {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly note: string | null;
  readonly kind: NamedSnapshotKind;
  readonly payloadFormat: string;
  readonly payloadVersion: number;
  readonly payloadBytes: number;
  readonly contentHash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateNamedSnapshotRequest extends SessionRequest {
  readonly name: string;
  readonly note?: string;
}

export interface NamedSnapshotMutationResult {
  readonly snapshot: NamedSnapshotSummary;
  readonly revision: number;
}

export interface ListNamedSnapshotsResult {
  readonly snapshots: readonly NamedSnapshotSummary[];
  readonly revision: number;
}

export interface RenameNamedSnapshotRequest extends SessionRequest {
  readonly snapshotId: string;
  readonly name: string;
}

export interface DeleteNamedSnapshotRequest extends SessionRequest {
  readonly snapshotId: string;
}

export interface DeleteNamedSnapshotResult {
  readonly deletedSnapshotId: string;
  readonly revision: number;
}

export interface SnapshotNodeCounts {
  readonly volumes: number;
  readonly chapters: number;
  readonly scenes: number;
}

export interface SnapshotDiffSummary {
  readonly added: SnapshotNodeCounts;
  readonly deleted: SnapshotNodeCounts;
  readonly renamedNodes: number;
  readonly reorderedNodes: number;
  readonly changedSceneBodies: number;
  readonly characterCountDelta: number;
}

export interface DiffNamedSnapshotRequest extends SessionRequest {
  readonly snapshotId: string;
}

export interface DiffNamedSnapshotResult {
  readonly snapshot: NamedSnapshotSummary;
  readonly summary: SnapshotDiffSummary;
  readonly revision: number;
}

export interface RestoreNamedSnapshotRequest extends SessionRequest {
  readonly snapshotId: string;
  readonly autoSnapshotName?: string;
}

export interface RestoreNamedSnapshotResult {
  readonly restoredSnapshot: NamedSnapshotSummary;
  readonly safetySnapshot: NamedSnapshotSummary;
  readonly changesBeforeRestore: SnapshotDiffSummary;
  readonly revision: number;
}

export interface TransformedSceneDocument {
  readonly sceneId: string;
  readonly documentId: string;
  readonly editorEngine: "typie";
  readonly editorEngineCommit: string;
  readonly editorSchemaVersion: number;
  readonly snapshot: Uint8Array;
  readonly plainTextRecovery: string;
  readonly occurrenceCount: number;
  readonly sourceContentHash: string;
}

export interface ApplyReplacementBatchRequest extends SessionRequest {
  readonly expectedRevision: number;
  readonly query: string;
  readonly replacement: string;
  readonly caseSensitive: boolean;
  readonly transformedScenes: readonly TransformedSceneDocument[];
  readonly autoSnapshotName?: string;
}

export interface ApplyReplacementBatchResult {
  readonly safetySnapshot: NamedSnapshotSummary;
  readonly changedSceneIds: readonly string[];
  readonly changedScenes: number;
  readonly changedOccurrences: number;
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
  getProjectTree(request: SessionRequest): Promise<ProjectTree>;
  createNode(request: CreateNodeRequest): Promise<ProjectTree>;
  renameNode(request: RenameNodeRequest): Promise<ProjectTree>;
  moveNode(request: MoveNodeRequest): Promise<ProjectTree>;
  reorderNode(request: ReorderNodeRequest): Promise<ProjectTree>;
  deleteNode(request: DeleteNodeRequest): Promise<ProjectTree>;
  loadSceneDocument(
    request: LoadSceneDocumentRequest
  ): Promise<LoadedSceneDocument>;
  saveSceneDocument(
    request: SaveSceneDocumentRequest
  ): Promise<SaveSceneDocumentResult>;
  saveUiState(request: SaveUiStateRequest): Promise<void>;
  loadUiState(request: SessionRequest): Promise<LoadUiStateResult>;
  listDescendantScenes(
    request: ListDescendantScenesRequest
  ): Promise<ListDescendantScenesResult>;
  searchProject(request: SearchProjectRequest): Promise<SearchProjectResult>;
  getTextStatistics(request: ScopeNodeRequest): Promise<TextStatisticsResult>;
  applyReplacementBatch(
    request: ApplyReplacementBatchRequest
  ): Promise<ApplyReplacementBatchResult>;
  createNamedSnapshot(
    request: CreateNamedSnapshotRequest
  ): Promise<NamedSnapshotMutationResult>;
  listNamedSnapshots(
    request: SessionRequest
  ): Promise<ListNamedSnapshotsResult>;
  renameNamedSnapshot(
    request: RenameNamedSnapshotRequest
  ): Promise<NamedSnapshotMutationResult>;
  deleteNamedSnapshot(
    request: DeleteNamedSnapshotRequest
  ): Promise<DeleteNamedSnapshotResult>;
  diffNamedSnapshot(
    request: DiffNamedSnapshotRequest
  ): Promise<DiffNamedSnapshotResult>;
  restoreNamedSnapshot(
    request: RestoreNamedSnapshotRequest
  ): Promise<RestoreNamedSnapshotResult>;
  getAppVersion(): Promise<string>;
  onCloseRequested(listener: () => void): () => void;
  completeCloseRequest(request: CompleteCloseRequest): Promise<boolean>;
}
