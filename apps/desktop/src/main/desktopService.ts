import path from "node:path";
import { randomUUID } from "node:crypto";
import type { BrowserWindow, SaveDialogOptions } from "electron";
import type {
  ApplyReplacementBatchRequest,
  ApplyReplacementBatchResult,
  CreateNamedSnapshotRequest,
  CreateNodeRequest,
  CreateProjectRequest,
  DeleteNamedSnapshotRequest,
  DeleteNamedSnapshotResult,
  DeleteNodeRequest,
  DiffNamedSnapshotRequest,
  DiffNamedSnapshotResult,
  LoadedSceneDocument,
  LoadedDocument,
  LoadSceneDocumentRequest,
  LoadDocumentRequest,
  LoadUiStateResult,
  ListDescendantScenesRequest,
  ListDescendantScenesResult,
  ListNamedSnapshotsResult,
  MoveNodeRequest,
  NamedSnapshotKind,
  NamedSnapshotMutationResult,
  NamedSnapshotSummary,
  OpenProjectRequest,
  PlainTextRecovery,
  ProjectRecord,
  ProjectTree,
  ProjectSession,
  RecoverPlainTextRequest,
  RenameNamedSnapshotRequest,
  RenameNodeRequest,
  ReorderNodeRequest,
  RestoreNamedSnapshotRequest,
  RestoreNamedSnapshotResult,
  SaveSceneDocumentRequest,
  SaveSceneDocumentResult,
  SaveDocumentRequest,
  SaveDocumentResult,
  SaveUiStateRequest,
  ScopeNodeRequest,
  SearchField,
  SearchHit,
  SearchProjectRequest,
  SearchProjectResult,
  SearchTarget,
  SessionRequest,
  SnapshotDiffSummary,
  SnapshotNodeCounts,
  TextStatisticsResult,
  TreeNodeKind,
  TreeNodeRecord
} from "../shared/contracts";
import type { CoreClient } from "./coreClient";
import { ProjectSessionRegistry } from "./projectSessions";

const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;
const MAX_RECOVERY_TEXT_CODE_UNITS = 32 * 1024 * 1024;
const UI_STATE_KEY = "workspace.v1";
const TREE_NODE_KINDS = new Set<TreeNodeKind>([
  "WORK",
  "VOLUME",
  "CHAPTER",
  "SCENE"
]);
const SEARCH_TARGETS = new Set<SearchTarget>(["TITLES", "BODIES", "ALL"]);
const SEARCH_FIELDS = new Set<SearchField>(["TITLE", "BODY"]);
const SNAPSHOT_KINDS = new Set<NamedSnapshotKind>([
  "MANUAL",
  "AUTO_BEFORE_REPLACE",
  "AUTO_BEFORE_RESTORE"
]);

export interface DialogPort {
  showSaveDialog(
    window: BrowserWindow,
    options: SaveDialogOptions
  ): Promise<{ readonly canceled: boolean; readonly filePath?: string }>;
  showOpenDialog(
    window: BrowserWindow,
    options: Electron.OpenDialogOptions
  ): Promise<{
    readonly canceled: boolean;
    readonly filePaths: readonly string[];
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`The local core returned invalid ${label}`);
  }
  return value;
}

function requiredString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label = key
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`The local core returned invalid ${label}`);
  }
  return value;
}

function requiredText(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label = key
): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`The local core returned invalid ${label}`);
  }
  return value;
}

function optionalString(
  record: Readonly<Record<string, unknown>>,
  key: string
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requiredInteger(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label = key
): number {
  const value = record[key];
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error(`The local core returned invalid ${label}`);
  }
  return value;
}

function requiredNumber(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label = key
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`The local core returned invalid ${label}`);
  }
  return value;
}

function requiredBoolean(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label = key
): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`The local core returned invalid ${label}`);
  }
  return value;
}

function validatePageNumber(
  value: unknown,
  label: string,
  { allowZero, maximum }: { readonly allowZero: boolean; readonly maximum: number }
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < (allowZero ? 0 : 1) ||
    value > maximum
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function validateSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function nullableString(
  record: Readonly<Record<string, unknown>>,
  key: string
): string | null {
  const value = record[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`The local core returned invalid ${key}`);
  }
  return value;
}

function parseTreeNode(value: unknown): TreeNodeRecord {
  const node = asRecord(value, "tree node");
  const kind = requiredString(node, "kind") as TreeNodeKind;
  if (!TREE_NODE_KINDS.has(kind)) {
    throw new Error("The local core returned invalid tree node kind");
  }
  return {
    id: requiredString(node, "id", "tree node id"),
    projectId: requiredString(node, "project_id", "tree node project id"),
    parentId: nullableString(node, "parent_id"),
    kind,
    title: requiredString(node, "title", "tree node title"),
    orderKey: requiredNumber(node, "order_key", "tree node order"),
    documentId: nullableString(node, "document_id"),
    createdAt: requiredString(node, "created_at"),
    updatedAt: requiredString(node, "updated_at")
  };
}

function parseProjectTree(value: unknown): ProjectTree {
  const response = asRecord(value, "project tree response");
  const tree = optionalRecord(response, "tree") ?? response;
  const metadata = optionalRecord(response, "metadata");
  const projectValue = asRecord(tree.project, "project tree project");
  const nodesValue = tree.nodes;
  if (!Array.isArray(nodesValue)) {
    throw new Error("The local core returned invalid project tree nodes");
  }
  const project: ProjectRecord = {
    id: requiredString(projectValue, "id", "project id"),
    title: requiredString(projectValue, "title", "project title"),
    authorName: nullableString(projectValue, "author_name"),
    createdAt: requiredString(projectValue, "created_at"),
    updatedAt: requiredString(projectValue, "updated_at")
  };
  return {
    project,
    nodes: nodesValue.map(parseTreeNode),
    revision: metadata
      ? requiredInteger(metadata, "revision", "project revision")
      : requiredInteger(response, "revision", "project revision")
  };
}

function validateNodeId(value: unknown, label = "Node id"): string {
  return validateShortText(value, label, 128);
}

function optionalRecord(
  record: Readonly<Record<string, unknown>>,
  key: string
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function firstDocument(
  record: Readonly<Record<string, unknown>>
): Record<string, unknown> | undefined {
  const document = optionalRecord(record, "document");
  if (document) {
    return document;
  }
  const documents = record.documents;
  if (!Array.isArray(documents)) {
    return undefined;
  }
  const first = documents[0];
  return isRecord(first) ? first : undefined;
}

function validateShortText(
  value: unknown,
  label: string,
  maximumLength: number
): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) {
    throw new Error(`${label} has an invalid length`);
  }
  return normalized;
}

function validateSessionId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new Error("Invalid project session");
  }
  return value;
}

function validateOptionalDocumentId(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return validateShortText(value, "Document id", 128);
}

function safeSuggestedFileName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "드래곤을죽이다.madi";
  }
  const baseName = path.basename(value.trim()).replace(
    /[<>:"/\\|?*\u0000-\u001f]/g,
    "_"
  );
  const limited = baseName.slice(0, 180) || "드래곤을죽이다.madi";
  return limited.toLocaleLowerCase().endsWith(".madi")
    ? limited
    : `${limited}.madi`;
}

function ensureMadiExtension(filePath: string): string {
  return filePath.toLocaleLowerCase().endsWith(".madi")
    ? filePath
    : `${filePath}.madi`;
}

function encodeSnapshot(snapshot: Uint8Array): string {
  return Buffer.from(
    snapshot.buffer,
    snapshot.byteOffset,
    snapshot.byteLength
  ).toString("base64");
}

function decodeSnapshot(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("The local core returned invalid snapshot data");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength > MAX_SNAPSHOT_BYTES) {
    throw new Error("The local core returned an oversized snapshot");
  }
  return Uint8Array.from(bytes);
}

function responseRevision(
  response: Readonly<Record<string, unknown>>,
  label: string
): number {
  return requiredInteger(
    asRecord(response.metadata, `${label} metadata`),
    "revision",
    `${label} revision`
  );
}

function validateExactText(
  value: unknown,
  label: string,
  maximumLength: number,
  allowEmpty = false
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.length > maximumLength
  ) {
    throw new Error(`${label} has an invalid length`);
  }
  return value;
}

function optionalNullableText(
  record: Readonly<Record<string, unknown>>,
  key: string
): string | null {
  const value = record[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`The local core returned invalid ${key}`);
  }
  return value;
}

function parseNamedSnapshot(value: unknown): NamedSnapshotSummary {
  const snapshot = asRecord(value, "named snapshot");
  const kind = requiredString(snapshot, "kind") as NamedSnapshotKind;
  if (!SNAPSHOT_KINDS.has(kind)) {
    throw new Error("The local core returned invalid named snapshot kind");
  }
  const contentHash = requiredString(snapshot, "content_hash");
  if (!/^[0-9a-f]{64}$/iu.test(contentHash)) {
    throw new Error("The local core returned invalid snapshot hash");
  }
  return {
    id: requiredString(snapshot, "id"),
    projectId: requiredString(snapshot, "project_id"),
    name: requiredString(snapshot, "name"),
    note: optionalNullableText(snapshot, "note"),
    kind,
    payloadFormat: requiredString(snapshot, "payload_format"),
    payloadVersion: requiredInteger(snapshot, "payload_version"),
    payloadBytes: requiredInteger(snapshot, "payload_bytes"),
    contentHash,
    createdAt: requiredString(snapshot, "created_at"),
    updatedAt: requiredString(snapshot, "updated_at")
  };
}

function parseSnapshotNodeCounts(value: unknown): SnapshotNodeCounts {
  const counts = asRecord(value, "snapshot node counts");
  return {
    volumes: requiredInteger(counts, "volumes"),
    chapters: requiredInteger(counts, "chapters"),
    scenes: requiredInteger(counts, "scenes")
  };
}

function parseSnapshotDiff(value: unknown): SnapshotDiffSummary {
  const summary = asRecord(value, "snapshot diff summary");
  return {
    added: parseSnapshotNodeCounts(summary.added),
    deleted: parseSnapshotNodeCounts(summary.deleted),
    renamedNodes: requiredInteger(summary, "renamed_nodes"),
    reorderedNodes: requiredInteger(summary, "reordered_nodes"),
    changedSceneBodies: requiredInteger(summary, "changed_scene_bodies"),
    characterCountDelta: requiredNumber(summary, "character_count_delta")
  };
}

function validateSnapshotId(value: unknown): string {
  return validateShortText(value, "Snapshot id", 128);
}

export class DesktopService {
  public constructor(
    private readonly window: BrowserWindow,
    private readonly dialog: DialogPort,
    private readonly core: CoreClient,
    private readonly sessions: ProjectSessionRegistry,
    private readonly appVersion: string
  ) {}

  public async createProject(
    input: CreateProjectRequest
  ): Promise<ProjectSession | null> {
    const title = validateShortText(input?.title, "Project title", 500);
    if (input.editorEngine !== "typie") {
      throw new Error("Unsupported editor engine");
    }
    const editorEngineCommit = validateShortText(
      input.editorEngineCommit,
      "Editor engine commit",
      128
    );
    if (
      !Number.isSafeInteger(input.editorSchemaVersion) ||
      input.editorSchemaVersion < 0
    ) {
      throw new Error("Invalid editor schema version");
    }
    const suggestedFileName = safeSuggestedFileName(input?.suggestedFileName);
    const result = await this.dialog.showSaveDialog(this.window, {
      title: "새 madi 프로젝트",
      defaultPath: suggestedFileName,
      filters: [{ name: "madi 프로젝트", extensions: ["madi"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"]
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    const filePath = ensureMadiExtension(result.filePath);
    const projectId = randomUUID();
    const documentId = randomUUID();
    const response = asRecord(
      await this.core.request("create_project", {
        file_path: filePath,
        title,
        created_by: `madi/${this.appVersion}`,
        project_id: projectId,
        document_id: documentId,
        document_title: title,
        editor_engine: input.editorEngine,
        editor_engine_commit: editorEngineCommit,
        editor_schema_version: input.editorSchemaVersion
      }),
      "create_project response"
    );
    const project = optionalRecord(response, "project");
    const metadata = project
      ? optionalRecord(project, "metadata")
      : undefined;
    const revision = metadata
      ? requiredInteger(metadata, "revision")
      : 0;

    const defaultSceneId = optionalString(
      response,
      "default_scene_node_id"
    );
    const workNodeId = optionalString(response, "work_node_id");
    return this.sessions.add({
      filePath,
      projectId: metadata
        ? optionalString(metadata, "project_id") ?? projectId
        : projectId,
      documentId:
        optionalString(response, "default_document_id") ?? documentId,
      ...(defaultSceneId ? { sceneId: defaultSceneId } : {}),
      ...(workNodeId ? { workNodeId } : {}),
      title: metadata ? optionalString(metadata, "title") ?? title : title,
      revision
    });
  }

  public async openProject(
    input: OpenProjectRequest = {}
  ): Promise<ProjectSession | null> {
    const requestedDocumentId = validateOptionalDocumentId(input.documentId);
    const selection = await this.dialog.showOpenDialog(this.window, {
      title: "madi 프로젝트 열기",
      filters: [{ name: "madi 프로젝트", extensions: ["madi"] }],
      properties: ["openFile", "dontAddToRecent"]
    });

    if (selection.canceled || selection.filePaths.length !== 1) {
      return null;
    }

    const filePath = selection.filePaths[0]!;
    const opened = asRecord(
      await this.core.request("open_project", { file_path: filePath }),
      "open_project response"
    );
    const tree = parseProjectTree(
      await this.core.request("load_project_tree", { file_path: filePath })
    );
    const meta = optionalRecord(opened, "metadata") ?? opened;
    const document = firstDocument(opened);
    const projectId = requiredString(meta, "project_id", "project id");
    const title =
      optionalString(meta, "title") ??
      (document ? optionalString(document, "title") : undefined) ??
      path.basename(filePath, path.extname(filePath));
    const scenes = tree.nodes.filter((node) => node.kind === "SCENE");
    const selectedScene =
      scenes.find((node) => node.documentId === requestedDocumentId) ??
      scenes[0];
    const documentId =
      requestedDocumentId ??
      selectedScene?.documentId ??
      optionalString(opened, "document_id") ??
      (document ? optionalString(document, "id") : undefined);
    const revision = tree.revision;
    const workNode = tree.nodes.find((node) => node.kind === "WORK");

    const sessionInput: {
      filePath: string;
      projectId: string;
      documentId?: string;
      title: string;
      revision: number;
    } = { filePath, projectId, title, revision };
    if (documentId !== undefined) {
      sessionInput.documentId = documentId;
    }
    if (selectedScene !== undefined) {
      Object.assign(sessionInput, { sceneId: selectedScene.id });
    }
    if (workNode !== undefined) {
      Object.assign(sessionInput, { workNodeId: workNode.id });
    }
    sessionInput.title = tree.project.title;
    return this.sessions.add(sessionInput);
  }

  public async saveDocument(
    input: SaveDocumentRequest
  ): Promise<SaveDocumentResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const requestedDocumentId = validateOptionalDocumentId(input.documentId);
    if (
      session.documentId &&
      requestedDocumentId &&
      requestedDocumentId !== session.documentId
    ) {
      throw new Error("Document does not belong to this project session");
    }

    const documentId =
      session.documentId ?? requestedDocumentId ?? randomUUID();
    const title = validateShortText(input.title, "Document title", 500);
    if (input.editorEngine !== "typie") {
      throw new Error("Unsupported editor engine");
    }
    const editorEngineCommit = validateShortText(
      input.editorEngineCommit,
      "Editor engine commit",
      128
    );
    if (
      !Number.isSafeInteger(input.editorSchemaVersion) ||
      input.editorSchemaVersion < 0
    ) {
      throw new Error("Invalid editor schema version");
    }
    if (!(input.snapshot instanceof Uint8Array)) {
      throw new Error("Snapshot must be binary data");
    }
    if (input.snapshot.byteLength > MAX_SNAPSHOT_BYTES) {
      throw new Error("Snapshot is too large");
    }
    if (
      typeof input.plainTextRecovery !== "string" ||
      input.plainTextRecovery.length > MAX_RECOVERY_TEXT_CODE_UNITS
    ) {
      throw new Error("Plain-text recovery copy is too large");
    }

    const response = asRecord(
      await this.core.request("save_document", {
        file_path: session.filePath,
        expected_revision: session.revision,
        document: {
          id: documentId,
          project_id: session.projectId,
          title,
          editor_engine: input.editorEngine,
          editor_engine_commit: editorEngineCommit,
          editor_schema_version: input.editorSchemaVersion,
          snapshot_base64: encodeSnapshot(input.snapshot),
          plain_text_recovery: input.plainTextRecovery
        }
      }),
      "save_document response"
    );

    const metadata = asRecord(
      response.metadata,
      "save_document metadata"
    );
    const savedDocument = asRecord(
      response.document,
      "save_document document"
    );
    const revision = requiredInteger(metadata, "revision");
    const updatedAt = requiredString(metadata, "updated_at");
    const savedDocumentId = requiredString(
      savedDocument,
      "id",
      "document id"
    );

    this.sessions.update(sessionId, {
      documentId: savedDocumentId,
      title,
      revision
    });

    return { documentId: savedDocumentId, revision, updatedAt };
  }

  public async loadDocument(
    input: LoadDocumentRequest
  ): Promise<LoadedDocument> {
    const session = this.sessions.require(
      validateSessionId(input?.sessionId)
    );
    const documentId =
      validateOptionalDocumentId(input.documentId) ?? session.documentId;
    const params: Record<string, unknown> = {
      file_path: session.filePath
    };
    if (documentId !== undefined) {
      params.document_id = documentId;
    }

    const document = asRecord(
      await this.core.request("load_document", params),
      "load_document response"
    );
    const loadedDocumentId = requiredString(document, "id", "document id");
    const revision = session.revision;

    this.sessions.update(session.sessionId, {
      documentId: loadedDocumentId,
      title: requiredString(document, "title"),
      revision
    });

    return {
      id: loadedDocumentId,
      projectId:
        optionalString(document, "project_id") ?? session.projectId,
      title: requiredString(document, "title"),
      editorEngine: requiredString(document, "editor_engine"),
      editorEngineCommit: requiredString(document, "editor_engine_commit"),
      editorSchemaVersion: requiredInteger(
        document,
        "editor_schema_version"
      ),
      snapshot: decodeSnapshot(
        requiredText(document, "snapshot_base64")
      ),
      plainTextRecovery: requiredText(
        document,
        "plain_text_recovery"
      ),
      revision,
      updatedAt: requiredString(document, "updated_at")
    };
  }

  public async recoverPlainText(
    input: RecoverPlainTextRequest
  ): Promise<PlainTextRecovery> {
    const session = this.sessions.require(
      validateSessionId(input?.sessionId)
    );
    const documentId =
      validateOptionalDocumentId(input.documentId) ?? session.documentId;
    const params: Record<string, unknown> = {
      file_path: session.filePath
    };
    if (documentId !== undefined) {
      params.document_id = documentId;
    }

    const response = asRecord(
      await this.core.request("recover_plain_text", params),
      "recover_plain_text response"
    );

    return {
      documentId:
        optionalString(response, "document_id") ??
        documentId ??
        requiredString(response, "id", "document id"),
      plainText: requiredText(response, "plain_text_recovery"),
      revision:
        typeof response.project_revision === "number"
          ? requiredInteger(response, "project_revision")
          : session.revision
    };
  }

  public async getProjectTree(input: SessionRequest): Promise<ProjectTree> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const tree = parseProjectTree(
      await this.core.request("load_project_tree", {
        file_path: session.filePath
      })
    );
    this.updateSessionFromTree(sessionId, tree);
    return tree;
  }

  public async createNode(input: CreateNodeRequest): Promise<ProjectTree> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const parentId = validateNodeId(input.parentId, "Parent node id");
    if (
      input.kind !== "VOLUME" &&
      input.kind !== "CHAPTER" &&
      input.kind !== "SCENE"
    ) {
      throw new Error("Invalid tree node kind");
    }
    const title = validateShortText(input.title, "Node title", 500);
    const editorEngineCommit = validateShortText(
      input.editorEngineCommit,
      "Editor engine commit",
      128
    );
    if (
      !Number.isSafeInteger(input.editorSchemaVersion) ||
      input.editorSchemaVersion < 0
    ) {
      throw new Error("Invalid editor schema version");
    }
    const params: Record<string, unknown> = {
      file_path: session.filePath,
      parent_id: parentId,
      kind: input.kind,
      title,
      expected_revision: session.revision,
      saved_by: `madi/${this.appVersion}`
    };
    if (input.kind === "SCENE") {
      Object.assign(params, {
        editor_engine: "typie",
        editor_engine_commit: editorEngineCommit,
        editor_schema_version: input.editorSchemaVersion
      });
    }
    const tree = parseProjectTree(
      await this.core.request("create_tree_node", params)
    );
    this.updateSessionFromTree(sessionId, tree);
    return tree;
  }

  public async renameNode(input: RenameNodeRequest): Promise<ProjectTree> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const tree = parseProjectTree(
      await this.core.request("rename_tree_node", {
        file_path: session.filePath,
        node_id: validateNodeId(input.nodeId),
        title: validateShortText(input.title, "Node title", 500),
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      })
    );
    this.updateSessionFromTree(sessionId, tree);
    return tree;
  }

  public async moveNode(input: MoveNodeRequest): Promise<ProjectTree> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const tree = parseProjectTree(
      await this.core.request("move_tree_node", {
        file_path: session.filePath,
        node_id: validateNodeId(input.nodeId),
        new_parent_id: validateNodeId(input.newParentId, "New parent id"),
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      })
    );
    this.updateSessionFromTree(sessionId, tree);
    return tree;
  }

  public async reorderNode(input: ReorderNodeRequest): Promise<ProjectTree> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    if (input.direction !== "up" && input.direction !== "down") {
      throw new Error("Invalid reorder direction");
    }
    const nodeId = validateNodeId(input.nodeId);
    const current = await this.getProjectTree({ sessionId });
    const node = current.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
      throw new Error("Tree node was not found");
    }
    const siblings = current.nodes
      .filter((candidate) => candidate.parentId === node.parentId)
      .sort((left, right) => left.orderKey - right.orderKey);
    const index = siblings.findIndex((candidate) => candidate.id === nodeId);
    const adjacent =
      input.direction === "up" ? siblings[index - 1] : siblings[index + 1];
    if (!adjacent) {
      return current;
    }
    const placement =
      input.direction === "up"
        ? { before_node_id: adjacent.id }
        : { after_node_id: adjacent.id };
    const tree = parseProjectTree(
      await this.core.request("reorder_tree_node", {
        file_path: session.filePath,
        node_id: nodeId,
        ...placement,
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      })
    );
    this.updateSessionFromTree(sessionId, tree);
    return tree;
  }

  public async deleteNode(input: DeleteNodeRequest): Promise<ProjectTree> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    if (typeof input.recursive !== "boolean") {
      throw new Error("Delete mode is required");
    }
    const response = asRecord(
      await this.core.request("delete_tree_node", {
        file_path: session.filePath,
        node_id: validateNodeId(input.nodeId),
        recursive: input.recursive,
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "delete tree node response"
    );
    const deletedDocumentIds = Array.isArray(response.deleted_document_ids)
      ? response.deleted_document_ids.filter(
          (value): value is string => typeof value === "string"
        )
      : [];
    const tree = parseProjectTree(response);
    if (
      session.documentId &&
      deletedDocumentIds.includes(session.documentId)
    ) {
      this.sessions.clearActiveDocument(sessionId, tree.revision);
    }
    this.updateSessionFromTree(sessionId, tree);
    return tree;
  }

  public async loadSceneDocument(
    input: LoadSceneDocumentRequest
  ): Promise<LoadedSceneDocument> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const response = asRecord(
      await this.core.request("load_scene", {
        file_path: session.filePath,
        scene_id: validateNodeId(input.sceneId, "Scene id")
      }),
      "load scene response"
    );
    const scene = parseTreeNode(response.scene);
    if (scene.kind !== "SCENE" || !scene.documentId) {
      throw new Error("The local core returned an invalid scene");
    }
    const document = asRecord(response.document, "scene document");
    const revision = requiredInteger(
      response,
      "project_revision",
      "project revision"
    );
    const documentId = requiredString(document, "id", "document id");
    if (documentId !== scene.documentId) {
      throw new Error("Scene document relation is inconsistent");
    }
    this.sessions.updateProject(sessionId, {
      documentId,
      sceneId: scene.id,
      revision
    });
    return {
      sceneId: scene.id,
      id: documentId,
      projectId:
        optionalString(document, "project_id") ?? session.projectId,
      title: scene.title,
      editorEngine: requiredString(document, "editor_engine"),
      editorEngineCommit: requiredString(document, "editor_engine_commit"),
      editorSchemaVersion: requiredInteger(
        document,
        "editor_schema_version"
      ),
      snapshot: decodeSnapshot(requiredText(document, "snapshot_base64")),
      plainTextRecovery: requiredText(document, "plain_text_recovery"),
      revision,
      updatedAt: requiredString(document, "updated_at")
    };
  }

  public async saveSceneDocument(
    input: SaveSceneDocumentRequest
  ): Promise<SaveSceneDocumentResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const sceneId = validateNodeId(input.sceneId, "Scene id");
    const documentId = validateNodeId(input.documentId, "Document id");
    if (
      !Number.isSafeInteger(input.generation) ||
      input.generation < 0 ||
      !Number.isSafeInteger(input.saveSequence) ||
      input.saveSequence < 1
    ) {
      throw new Error("Invalid scene save token");
    }
    if (input.editorEngine !== "typie") {
      throw new Error("Unsupported editor engine");
    }
    const editorEngineCommit = validateShortText(
      input.editorEngineCommit,
      "Editor engine commit",
      128
    );
    if (
      !Number.isSafeInteger(input.editorSchemaVersion) ||
      input.editorSchemaVersion < 0 ||
      !(input.snapshot instanceof Uint8Array) ||
      input.snapshot.byteLength > MAX_SNAPSHOT_BYTES ||
      typeof input.plainTextRecovery !== "string" ||
      input.plainTextRecovery.length > MAX_RECOVERY_TEXT_CODE_UNITS
    ) {
      throw new Error("Invalid scene document payload");
    }
    const response = asRecord(
      await this.core.request("save_scene", {
        file_path: session.filePath,
        scene_id: sceneId,
        editor_engine: "typie",
        editor_engine_commit: editorEngineCommit,
        editor_schema_version: input.editorSchemaVersion,
        snapshot_base64: encodeSnapshot(input.snapshot),
        plain_text_recovery: input.plainTextRecovery,
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "save scene response"
    );
    const metadata = asRecord(response.metadata, "save scene metadata");
    const document = asRecord(response.document, "saved scene document");
    const savedDocumentId = requiredString(document, "id", "document id");
    if (savedDocumentId !== documentId) {
      throw new Error("Scene save response targeted another document");
    }
    const revision = requiredInteger(metadata, "revision");
    const updatedAt = requiredString(metadata, "updated_at");
    this.sessions.updateProject(sessionId, {
      documentId,
      sceneId,
      revision
    });
    return {
      sceneId,
      documentId,
      revision,
      updatedAt,
      generation: input.generation,
      saveSequence: input.saveSequence
    };
  }

  public async saveUiState(input: SaveUiStateRequest): Promise<void> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const selectedNodeId =
      input.state?.selectedNodeId === null
        ? null
        : validateNodeId(input.state?.selectedNodeId, "Selected node id");
    if (
      !Array.isArray(input.state?.expandedNodeIds) ||
      input.state.expandedNodeIds.length > 1_000 ||
      !Number.isFinite(input.state?.binderWidth) ||
      input.state.binderWidth < 220 ||
      input.state.binderWidth > 640
    ) {
      throw new Error("Invalid project UI state");
    }
    const expandedNodeIds = input.state.expandedNodeIds.map((nodeId) =>
      validateNodeId(nodeId, "Expanded node id")
    );
    await this.core.request("save_ui_state", {
      file_path: session.filePath,
      key: UI_STATE_KEY,
      value: {
        selected_node_id: selectedNodeId,
        expanded_node_ids: expandedNodeIds,
        binder_width: input.state.binderWidth
      }
    });
  }

  public async loadUiState(
    input: SessionRequest
  ): Promise<LoadUiStateResult> {
    const session = this.sessions.require(
      validateSessionId(input?.sessionId)
    );
    const response = asRecord(
      await this.core.request("load_ui_state", {
        file_path: session.filePath,
        key: UI_STATE_KEY
      }),
      "load UI state response"
    );
    const stateRecord = optionalRecord(response, "state");
    if (!stateRecord) {
      return { state: null };
    }
    const value = asRecord(stateRecord.value, "saved UI state");
    const selectedRaw = value.selected_node_id;
    const selectedNodeId =
      selectedRaw === null
        ? null
        : validateNodeId(selectedRaw, "Saved selected node id");
    if (!Array.isArray(value.expanded_node_ids)) {
      throw new Error("The local core returned invalid expanded nodes");
    }
    const binderWidth = requiredNumber(
      value,
      "binder_width",
      "saved binder width"
    );
    return {
      state: {
        selectedNodeId,
        expandedNodeIds: value.expanded_node_ids.map((nodeId) =>
          validateNodeId(nodeId, "Saved expanded node id")
        ),
        binderWidth
      }
    };
  }

  public async listDescendantScenes(
    input: ListDescendantScenesRequest
  ): Promise<ListDescendantScenesResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const scopeNodeId = validateNodeId(input.scopeNodeId, "Scope node id");
    const offset = validatePageNumber(input.offset, "Scrivenings offset", {
      allowZero: true,
      maximum: Number.MAX_SAFE_INTEGER
    });
    const limit = validatePageNumber(input.limit, "Scrivenings limit", {
      allowZero: false,
      maximum: 1_000
    });
    const response = asRecord(
      await this.core.request("list_descendant_scenes", {
        file_path: session.filePath,
        scope_node_id: scopeNodeId,
        ...(offset === undefined ? {} : { offset }),
        ...(limit === undefined ? {} : { limit })
      }),
      "descendant scenes response"
    );
    const scope = parseTreeNode(response.scope);
    if (scope.id !== scopeNodeId || scope.kind === "SCENE") {
      throw new Error("The local core returned an invalid Scrivenings scope");
    }
    if (!Array.isArray(response.scenes)) {
      throw new Error("The local core returned invalid descendant scenes");
    }
    const scenes = response.scenes.map((value) => {
      const pair = asRecord(value, "descendant scene");
      const scene = parseTreeNode(pair.scene);
      const document = asRecord(pair.document, "descendant scene document");
      const documentId = requiredString(document, "id", "document id");
      if (
        scene.kind !== "SCENE" ||
        scene.documentId === null ||
        scene.documentId !== documentId
      ) {
        throw new Error("The local core returned an inconsistent scene preview");
      }
      return {
        sceneId: scene.id,
        documentId,
        plainTextRecovery: requiredText(
          document,
          "plain_text_recovery",
          "scene recovery text"
        ),
        sourceContentHash: validateSha256(
          document.source_content_hash,
          "scene source content hash"
        ),
        updatedAt: requiredString(document, "updated_at")
      };
    });
    const revision = responseRevision(response, "descendant scenes");
    this.sessions.updateProject(sessionId, { revision });
    const nextOffsetRaw = response.next_offset;
    const nextOffset =
      nextOffsetRaw === null
        ? null
        : requiredInteger(response, "next_offset");
    return {
      scopeNodeId,
      scenes,
      totalScenes: requiredInteger(response, "total_scenes"),
      offset: requiredInteger(response, "offset"),
      limit: requiredInteger(response, "limit"),
      nextOffset,
      hasMore: requiredBoolean(response, "has_more"),
      revision
    };
  }

  public async searchProject(
    input: SearchProjectRequest
  ): Promise<SearchProjectResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const query = validateExactText(input.query, "Search query", 2_000);
    if (typeof input.caseSensitive !== "boolean") {
      throw new Error("Search case mode is required");
    }
    if (!SEARCH_TARGETS.has(input.target)) {
      throw new Error("Invalid search target");
    }
    const scopeNodeId = input.scopeNodeId
      ? validateNodeId(input.scopeNodeId, "Search scope node id")
      : undefined;
    const offset = validatePageNumber(input.offset, "Search offset", {
      allowZero: true,
      maximum: Number.MAX_SAFE_INTEGER
    });
    const limit = validatePageNumber(input.limit, "Search limit", {
      allowZero: false,
      maximum: 5_000
    });
    const response = asRecord(
      await this.core.request("search_project", {
        file_path: session.filePath,
        query,
        case_sensitive: input.caseSensitive,
        target: input.target,
        ...(scopeNodeId ? { scope_node_id: scopeNodeId } : {}),
        ...(offset === undefined ? {} : { offset }),
        ...(limit === undefined ? {} : { limit })
      }),
      "project search response"
    );
    if (!Array.isArray(response.hits)) {
      throw new Error("The local core returned invalid search hits");
    }
    const hits: SearchHit[] = response.hits.map((value) => {
      const hit = asRecord(value, "search hit");
      const nodeKind = requiredString(hit, "node_kind") as TreeNodeKind;
      const field = requiredString(hit, "field") as SearchField;
      if (!TREE_NODE_KINDS.has(nodeKind) || !SEARCH_FIELDS.has(field)) {
        throw new Error("The local core returned invalid search hit metadata");
      }
      const start = requiredInteger(hit, "start_char");
      const end = requiredInteger(hit, "end_char");
      if (end <= start) {
        throw new Error("The local core returned an invalid search range");
      }
      return {
        occurrenceId: requiredString(hit, "occurrence_id"),
        nodeId: requiredString(hit, "node_id"),
        sceneId: nullableString(hit, "scene_id"),
        documentId: nullableString(hit, "document_id"),
        nodeKind,
        nodeTitle: requiredString(hit, "node_title"),
        field,
        start,
        end,
        contextBefore: requiredText(hit, "context_before"),
        matchedText: requiredText(hit, "matched_text"),
        contextAfter: requiredText(hit, "context_after"),
        sourceContentHash: nullableString(hit, "source_content_hash")
      };
    });
    const target = requiredString(response, "target") as SearchTarget;
    if (!SEARCH_TARGETS.has(target)) {
      throw new Error("The local core returned an invalid search target");
    }
    const revision = responseRevision(response, "project search");
    this.sessions.updateProject(sessionId, { revision });
    return {
      query: requiredText(response, "query"),
      caseSensitive: response.case_sensitive === true,
      target,
      scopeNodeId: requiredString(response, "scope_node_id"),
      totalMatches: requiredInteger(response, "total_matches"),
      sceneCount: requiredInteger(response, "scene_count"),
      offset: requiredInteger(response, "offset"),
      limit: requiredInteger(response, "limit"),
      hasMore: requiredBoolean(response, "has_more"),
      hits,
      revision
    };
  }

  public async getTextStatistics(
    input: ScopeNodeRequest
  ): Promise<TextStatisticsResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const scopeNodeId = validateNodeId(input.scopeNodeId, "Statistics scope node id");
    const response = asRecord(
      await this.core.request("get_text_statistics", {
        file_path: session.filePath,
        scope_node_id: scopeNodeId
      }),
      "text statistics response"
    );
    if (!Array.isArray(response.scenes)) {
      throw new Error("The local core returned invalid scene statistics");
    }
    const revision = responseRevision(response, "text statistics");
    this.sessions.updateProject(sessionId, { revision });
    return {
      scopeNodeId: requiredString(response, "scope_node_id"),
      sceneCount: requiredInteger(response, "scene_count"),
      withSpaces: requiredInteger(response, "with_spaces"),
      withoutSpaces: requiredInteger(response, "without_spaces"),
      scenes: response.scenes.map((value) => {
        const scene = asRecord(value, "scene text statistics");
        return {
          sceneId: requiredString(scene, "scene_id"),
          documentId: requiredString(scene, "document_id"),
          withSpaces: requiredInteger(scene, "with_spaces"),
          withoutSpaces: requiredInteger(scene, "without_spaces")
        };
      }),
      revision
    };
  }

  public async applyReplacementBatch(
    input: ApplyReplacementBatchRequest
  ): Promise<ApplyReplacementBatchResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    if (
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision !== session.revision
    ) {
      throw new Error("Replacement preview is stale; search again before applying");
    }
    const query = validateExactText(input.query, "Replacement query", 2_000);
    const replacement = validateExactText(
      input.replacement,
      "Replacement text",
      32_000,
      true
    );
    if (typeof input.caseSensitive !== "boolean") {
      throw new Error("Replacement case mode is required");
    }
    if (
      !Array.isArray(input.transformedScenes) ||
      input.transformedScenes.length === 0 ||
      input.transformedScenes.length > 10_000
    ) {
      throw new Error("Invalid replacement batch");
    }
    const sceneIds = new Set<string>();
    const documentIds = new Set<string>();
    const transformedScenes = input.transformedScenes.map((scene) => {
      const sceneId = validateNodeId(scene.sceneId, "Replacement scene id");
      const documentId = validateNodeId(
        scene.documentId,
        "Replacement document id"
      );
      if (
        sceneIds.has(sceneId) ||
        documentIds.has(documentId) ||
        scene.editorEngine !== "typie" ||
        !Number.isSafeInteger(scene.editorSchemaVersion) ||
        scene.editorSchemaVersion < 0 ||
        !(scene.snapshot instanceof Uint8Array) ||
        scene.snapshot.byteLength === 0 ||
        scene.snapshot.byteLength > MAX_SNAPSHOT_BYTES ||
        typeof scene.plainTextRecovery !== "string" ||
        scene.plainTextRecovery.length > MAX_RECOVERY_TEXT_CODE_UNITS ||
        !Number.isSafeInteger(scene.occurrenceCount) ||
        scene.occurrenceCount < 1
      ) {
        throw new Error("Invalid transformed scene document");
      }
      sceneIds.add(sceneId);
      documentIds.add(documentId);
      return {
        scene_id: sceneId,
        document_id: documentId,
        editor_engine: "typie",
        editor_engine_commit: validateShortText(
          scene.editorEngineCommit,
          "Editor engine commit",
          128
        ),
        editor_schema_version: scene.editorSchemaVersion,
        snapshot_base64: encodeSnapshot(scene.snapshot),
        plain_text_recovery: scene.plainTextRecovery,
        occurrence_count: scene.occurrenceCount,
        source_content_hash: validateSha256(
          scene.sourceContentHash,
          "replacement source content hash"
        )
      };
    });
    const response = asRecord(
      await this.core.request("apply_replacement_batch", {
        file_path: session.filePath,
        expected_revision: input.expectedRevision,
        query,
        replacement,
        case_sensitive: input.caseSensitive,
        transformed_scenes: transformedScenes,
        saved_by: `madi/${this.appVersion}`,
        ...(input.autoSnapshotName
          ? {
              auto_snapshot_name: validateShortText(
                input.autoSnapshotName,
                "Automatic snapshot name",
                500
              )
            }
          : {})
      }),
      "replacement batch response"
    );
    const changedSceneIds = Array.isArray(response.changed_scene_ids)
      ? response.changed_scene_ids.map((value) =>
          validateNodeId(value, "Changed scene id")
        )
      : (() => {
          throw new Error("The local core returned invalid changed scenes");
        })();
    const revision = responseRevision(response, "replacement batch");
    this.sessions.updateProject(sessionId, { revision });
    return {
      safetySnapshot: parseNamedSnapshot(response.safety_snapshot),
      changedSceneIds,
      changedScenes: requiredInteger(response, "changed_scenes"),
      changedOccurrences: requiredInteger(response, "changed_occurrences"),
      revision
    };
  }

  public async createNamedSnapshot(
    input: CreateNamedSnapshotRequest
  ): Promise<NamedSnapshotMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const response = asRecord(
      await this.core.request("create_named_snapshot", {
        file_path: session.filePath,
        name: validateShortText(input.name, "Snapshot name", 500),
        note:
          input.note === undefined
            ? null
            : validateExactText(input.note, "Snapshot note", 10_000, true),
        kind: "MANUAL",
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "create named snapshot response"
    );
    const revision = responseRevision(response, "create named snapshot");
    this.sessions.updateProject(sessionId, { revision });
    return { snapshot: parseNamedSnapshot(response.snapshot), revision };
  }

  public async listNamedSnapshots(
    input: SessionRequest
  ): Promise<ListNamedSnapshotsResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const response = asRecord(
      await this.core.request("list_named_snapshots", {
        file_path: session.filePath
      }),
      "list named snapshots response"
    );
    if (!Array.isArray(response.snapshots)) {
      throw new Error("The local core returned invalid named snapshots");
    }
    const revision = responseRevision(response, "list named snapshots");
    this.sessions.updateProject(sessionId, { revision });
    return {
      snapshots: response.snapshots.map(parseNamedSnapshot),
      revision
    };
  }

  public async renameNamedSnapshot(
    input: RenameNamedSnapshotRequest
  ): Promise<NamedSnapshotMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const response = asRecord(
      await this.core.request("rename_named_snapshot", {
        file_path: session.filePath,
        snapshot_id: validateSnapshotId(input.snapshotId),
        name: validateShortText(input.name, "Snapshot name", 500),
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "rename named snapshot response"
    );
    const revision = responseRevision(response, "rename named snapshot");
    this.sessions.updateProject(sessionId, { revision });
    return { snapshot: parseNamedSnapshot(response.snapshot), revision };
  }

  public async deleteNamedSnapshot(
    input: DeleteNamedSnapshotRequest
  ): Promise<DeleteNamedSnapshotResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const response = asRecord(
      await this.core.request("delete_named_snapshot", {
        file_path: session.filePath,
        snapshot_id: validateSnapshotId(input.snapshotId),
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "delete named snapshot response"
    );
    const revision = responseRevision(response, "delete named snapshot");
    this.sessions.updateProject(sessionId, { revision });
    return {
      deletedSnapshotId: requiredString(response, "deleted_snapshot_id"),
      revision
    };
  }

  public async diffNamedSnapshot(
    input: DiffNamedSnapshotRequest
  ): Promise<DiffNamedSnapshotResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const response = asRecord(
      await this.core.request("diff_named_snapshot", {
        file_path: session.filePath,
        snapshot_id: validateSnapshotId(input.snapshotId)
      }),
      "diff named snapshot response"
    );
    const revision = responseRevision(response, "diff named snapshot");
    this.sessions.updateProject(sessionId, { revision });
    return {
      snapshot: parseNamedSnapshot(response.snapshot),
      summary: parseSnapshotDiff(response.summary),
      revision
    };
  }

  public async restoreNamedSnapshot(
    input: RestoreNamedSnapshotRequest
  ): Promise<RestoreNamedSnapshotResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const response = asRecord(
      await this.core.request("restore_named_snapshot", {
        file_path: session.filePath,
        snapshot_id: validateSnapshotId(input.snapshotId),
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`,
        ...(input.autoSnapshotName
          ? {
              auto_snapshot_name: validateShortText(
                input.autoSnapshotName,
                "Automatic snapshot name",
                500
              )
            }
          : {})
      }),
      "restore named snapshot response"
    );
    const revision = responseRevision(response, "restore named snapshot");
    const tree = parseProjectTree(
      await this.core.request("load_project_tree", {
        file_path: session.filePath
      })
    );
    const activeScene =
      tree.nodes.find(
        (node) => node.kind === "SCENE" && node.id === session.sceneId
      ) ?? tree.nodes.find((node) => node.kind === "SCENE");
    this.sessions.clearActiveDocument(sessionId, revision);
    this.sessions.updateProject(sessionId, {
      title: tree.project.title,
      revision,
      ...(activeScene?.documentId
        ? { documentId: activeScene.documentId, sceneId: activeScene.id }
        : {}),
      ...(tree.nodes.find((node) => node.kind === "WORK")
        ? {
            workNodeId: tree.nodes.find((node) => node.kind === "WORK")!.id
          }
        : {})
    });
    return {
      restoredSnapshot: parseNamedSnapshot(response.restored_snapshot),
      safetySnapshot: parseNamedSnapshot(response.safety_snapshot),
      changesBeforeRestore: parseSnapshotDiff(
        response.changes_before_restore
      ),
      revision
    };
  }

  private updateSessionFromTree(
    sessionId: string,
    tree: ProjectTree
  ): void {
    const workNode = tree.nodes.find((node) => node.kind === "WORK");
    this.sessions.updateProject(sessionId, {
      title: tree.project.title,
      revision: tree.revision,
      ...(workNode ? { workNodeId: workNode.id } : {})
    });
  }
}
