import path from "node:path";
import { randomUUID } from "node:crypto";
import type { BrowserWindow, SaveDialogOptions } from "electron";
import type {
  CreateProjectRequest,
  LoadedDocument,
  LoadDocumentRequest,
  OpenProjectRequest,
  PlainTextRecovery,
  ProjectSession,
  RecoverPlainTextRequest,
  SaveDocumentRequest,
  SaveDocumentResult
} from "../shared/contracts";
import type { CoreClient } from "./coreClient";
import { ProjectSessionRegistry } from "./projectSessions";

const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;
const MAX_RECOVERY_TEXT_CODE_UNITS = 32 * 1024 * 1024;

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

    return this.sessions.add({
      filePath,
      projectId: metadata
        ? optionalString(metadata, "project_id") ?? projectId
        : projectId,
      documentId:
        optionalString(response, "default_document_id") ?? documentId,
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
    const meta = optionalRecord(opened, "metadata") ?? opened;
    const document = firstDocument(opened);
    const projectId = requiredString(meta, "project_id", "project id");
    const title =
      optionalString(meta, "title") ??
      (document ? optionalString(document, "title") : undefined) ??
      path.basename(filePath, path.extname(filePath));
    const documentId =
      requestedDocumentId ??
      optionalString(opened, "document_id") ??
      (document ? optionalString(document, "id") : undefined);
    const revision =
      typeof meta.revision === "number"
        ? requiredInteger(meta, "revision")
        : 0;

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
}
