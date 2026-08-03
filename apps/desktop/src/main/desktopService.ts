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
import type {
  CreateEntityAliasRequest,
  CreateEntityRelationRequest,
  CreateEntityRequest,
  CreateRelationTypeRequest,
  CreateSceneEntityLinkRequest,
  CreateTagRequest,
  DeleteEntityAliasRequest,
  DeleteEntityAliasResult,
  DeleteEntityRelationRequest,
  DeleteEntityRelationResult,
  DeleteEntityRequest,
  DeleteEntityResult,
  DeleteRelationTypeRequest,
  DeleteRelationTypeResult,
  DeleteSceneEntityLinkRequest,
  DeleteSceneEntityLinkResult,
  DeleteTagRequest,
  DeleteTagResult,
  DiscoverEntityMentionsRequest,
  DiscoverEntityMentionsResult,
  EntityAliasMutationResult,
  EntityAliasRecord,
  EntityDeleteImpact,
  EntityDeleteImpactRequest,
  EntityDeleteImpactResult,
  EntityKind,
  EntityMutationResult,
  EntityRecord,
  EntityRelationMutationResult,
  EntityRelationRecord,
  EntitySearchHit,
  EntitySort,
  EntityStatus,
  JsonObject,
  ListEntitiesRequest,
  ListEntitiesResult,
  ListEntityAliasesRequest,
  ListEntityAliasesResult,
  ListEntityRelationsRequest,
  ListEntityRelationsResult,
  ListEntityTagsRequest,
  ListEntityTagsResult,
  ListRelationTypesResult,
  ListSceneEntityLinksRequest,
  ListSceneEntityLinksResult,
  ListTagsResult,
  LoadedEntityNote,
  LoadEntityNoteRequest,
  PromoteEntityMentionRequest,
  RelationTypeMutationResult,
  RelationTypeRecord,
  SaveEntityNoteRequest,
  SaveEntityNoteResult,
  SceneEntityLinkMutationResult,
  SceneEntityLinkRecord,
  SceneEntityRole,
  SearchEntitiesRequest,
  SearchEntitiesResult,
  SetEntityTagsRequest,
  SetEntityTagsResult,
  TagMutationResult,
  TagRecord,
  UpdateEntityRelationRequest,
  UpdateEntityRequest,
  UpdateRelationTypeRequest,
  UpdateTagRequest
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
const ENTITY_KINDS = new Set<EntityKind>([
  "CHARACTER",
  "LOCATION",
  "ORGANIZATION",
  "ITEM",
  "EVENT",
  "WORLD_RULE",
  "FORESHADOWING",
  "OTHER"
]);
const ENTITY_STATUSES = new Set<EntityStatus>([
  "ACTIVE",
  "DRAFT",
  "ARCHIVED"
]);
const ENTITY_SORTS = new Set<EntitySort>(["NAME_ASC", "UPDATED_DESC"]);
const SCENE_ENTITY_ROLES = new Set<SceneEntityRole>([
  "APPEARS",
  "POV",
  "MENTIONED",
  "RELATED"
]);
const ENTITY_SEARCH_FIELDS = new Set<EntitySearchHit["matchedFields"][number]>([
  "NAME",
  "ALIAS",
  "SUMMARY",
  "TAG",
  "NOTE"
]);
const MAX_ATTRIBUTES_JSON_BYTES = 1024 * 1024;

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
  const optionalCount = (key: string): number =>
    summary[key] === undefined ? 0 : requiredInteger(summary, key);
  return {
    added: parseSnapshotNodeCounts(summary.added),
    deleted: parseSnapshotNodeCounts(summary.deleted),
    renamedNodes: requiredInteger(summary, "renamed_nodes"),
    reorderedNodes: requiredInteger(summary, "reordered_nodes"),
    changedSceneBodies: requiredInteger(summary, "changed_scene_bodies"),
    characterCountDelta: requiredNumber(summary, "character_count_delta"),
    addedEntities: optionalCount("added_entities"),
    deletedEntities: optionalCount("deleted_entities"),
    changedEntities: optionalCount("changed_entities"),
    addedTags: optionalCount("added_tags"),
    deletedTags: optionalCount("deleted_tags"),
    changedTags: optionalCount("changed_tags"),
    addedRelationTypes: optionalCount("added_relation_types"),
    deletedRelationTypes: optionalCount("deleted_relation_types"),
    changedRelationTypes: optionalCount("changed_relation_types"),
    addedRelations: optionalCount("added_relations"),
    deletedRelations: optionalCount("deleted_relations"),
    changedRelations: optionalCount("changed_relations"),
    changedSceneLinks: optionalCount("changed_scene_links"),
    changedEntityNotes: optionalCount("changed_entity_notes")
  };
}

function validateEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  label: string
): T {
  if (typeof value !== "string" || !allowed.has(value as T)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as T;
}

function parseEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  label: string
): T {
  if (typeof value !== "string" || !allowed.has(value as T)) {
    throw new Error(`The local core returned invalid ${label}`);
  }
  return value as T;
}

function validateNullableInputText(
  value: unknown,
  label: string,
  maximumLength: number,
  allowEmpty = true
): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  return validateExactText(value, label, maximumLength, allowEmpty);
}

function validateStringArray(
  value: unknown,
  label: string,
  maximumItems: number
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new Error(`Invalid ${label}`);
  }
  const identifiers = value.map((item) =>
    validateNodeId(item, `${label} item`)
  );
  if (new Set(identifiers).size !== identifiers.length) {
    throw new Error(`Invalid duplicate ${label}`);
  }
  return identifiers;
}

function validateEnumArray<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  label: string
): T[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length > allowed.size) {
    throw new Error(`Invalid ${label}`);
  }
  const items = value.map((item) => validateEnum(item, allowed, label));
  if (new Set(items).size !== items.length) {
    throw new Error(`Invalid duplicate ${label}`);
  }
  return items;
}

function validateJsonObject(value: unknown, label: string): JsonObject {
  if (!isRecord(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  if (
    serialized.length === 0 ||
    Buffer.byteLength(serialized, "utf8") > MAX_ATTRIBUTES_JSON_BYTES
  ) {
    throw new Error(`${label} is too large`);
  }
  const parsed: unknown = JSON.parse(serialized);
  if (!isRecord(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as JsonObject;
}

function parseJsonObject(value: unknown, label: string): JsonObject {
  let parsed: unknown = value;
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > MAX_ATTRIBUTES_JSON_BYTES) {
      throw new Error(`The local core returned oversized ${label}`);
    }
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(`The local core returned invalid ${label}`);
    }
  }
  try {
    return validateJsonObject(parsed, `Core ${label}`);
  } catch {
    throw new Error(`The local core returned invalid ${label}`);
  }
}

function parseEntity(value: unknown): EntityRecord {
  const entity = asRecord(value, "entity");
  return {
    id: requiredString(entity, "id", "entity id"),
    projectId: requiredString(entity, "project_id", "entity project id"),
    kind: parseEnum(entity.kind, ENTITY_KINDS, "entity kind"),
    name: requiredString(entity, "name", "entity name"),
    summary: optionalNullableText(entity, "summary"),
    documentId: requiredString(entity, "document_id", "entity document id"),
    status: parseEnum(entity.status, ENTITY_STATUSES, "entity status"),
    colorToken: optionalNullableText(entity, "color_token"),
    iconKey: optionalNullableText(entity, "icon_key"),
    attributes: parseJsonObject(
      entity.attributes ?? entity.attributes_json,
      "entity attributes"
    ),
    duplicateName:
      entity.duplicate_name === undefined
        ? false
        : requiredBoolean(entity, "duplicate_name"),
    createdAt: requiredString(entity, "created_at"),
    updatedAt: requiredString(entity, "updated_at")
  };
}

function parseEntityAlias(value: unknown): EntityAliasRecord {
  const alias = asRecord(value, "entity alias");
  return {
    id: requiredString(alias, "id", "entity alias id"),
    entityId: requiredString(alias, "entity_id"),
    alias: requiredString(alias, "alias"),
    normalizedAlias: requiredString(alias, "normalized_alias"),
    createdAt: requiredString(alias, "created_at")
  };
}

function parseTag(value: unknown): TagRecord {
  const tag = asRecord(value, "tag");
  return {
    id: requiredString(tag, "id", "tag id"),
    projectId: requiredString(tag, "project_id", "tag project id"),
    name: requiredString(tag, "name", "tag name"),
    colorToken: optionalNullableText(tag, "color_token"),
    createdAt: requiredString(tag, "created_at"),
    updatedAt:
      tag.updated_at === undefined
        ? null
        : optionalNullableText(tag, "updated_at")
  };
}

function parseRelationType(value: unknown): RelationTypeRecord {
  const relationType = asRecord(value, "relation type");
  return {
    id: requiredString(relationType, "id", "relation type id"),
    projectId: requiredString(relationType, "project_id"),
    name: requiredString(relationType, "name"),
    inverseName: optionalNullableText(relationType, "inverse_name"),
    directed: requiredBoolean(relationType, "directed"),
    colorToken: optionalNullableText(relationType, "color_token"),
    isBuiltin: requiredBoolean(relationType, "is_builtin"),
    createdAt: requiredString(relationType, "created_at"),
    updatedAt: requiredString(relationType, "updated_at")
  };
}

function parseEntityRelation(value: unknown): EntityRelationRecord {
  const relation = asRecord(value, "entity relation");
  return {
    id: requiredString(relation, "id", "entity relation id"),
    projectId: requiredString(relation, "project_id"),
    sourceEntityId: requiredString(relation, "source_entity_id"),
    relationTypeId: requiredString(relation, "relation_type_id"),
    targetEntityId: requiredString(relation, "target_entity_id"),
    note: optionalNullableText(relation, "note"),
    createdAt: requiredString(relation, "created_at"),
    updatedAt: requiredString(relation, "updated_at")
  };
}

function parseSceneEntityLink(value: unknown): SceneEntityLinkRecord {
  const link = asRecord(value, "scene entity link");
  return {
    sceneNodeId: requiredString(link, "scene_node_id"),
    entityId: requiredString(link, "entity_id"),
    role: parseEnum(link.role, SCENE_ENTITY_ROLES, "scene entity role"),
    note: optionalNullableText(link, "note"),
    createdAt: requiredString(link, "created_at")
  };
}

function parseEntityDeleteImpact(
  value: unknown,
  expectedEntityId?: string
): EntityDeleteImpact {
  const impact = asRecord(value, "entity delete impact");
  const entityId = requiredString(impact, "entity_id");
  if (expectedEntityId && entityId !== expectedEntityId) {
    throw new Error("The local core returned delete impact for another entity");
  }
  return {
    entityId,
    relationCount: requiredInteger(impact, "relation_count"),
    sceneLinkCount: requiredInteger(impact, "scene_link_count"),
    mentionSceneCount: requiredInteger(impact, "mention_scene_count"),
    aliasCount: requiredInteger(impact, "alias_count"),
    tagCount: requiredInteger(impact, "tag_count"),
    noteCharacterCount: requiredInteger(impact, "note_character_count")
  };
}

function requiredArray(
  record: Readonly<Record<string, unknown>>,
  key: string,
  maximumItems: number,
  label: string
): readonly unknown[] {
  const value = record[key];
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new Error(`The local core returned invalid ${label}`);
  }
  return value;
}

function validateRequiredNullableInputText(
  value: unknown,
  label: string,
  maximumLength: number,
  allowEmpty = true
): string | null {
  const validated = validateNullableInputText(
    value,
    label,
    maximumLength,
    allowEmpty
  );
  if (validated === undefined) {
    throw new Error(`${label} is required`);
  }
  return validated;
}

function validateEditorPayload(
  input: {
    readonly editorEngine: unknown;
    readonly editorEngineCommit: unknown;
    readonly editorSchemaVersion: unknown;
    readonly snapshot: unknown;
    readonly plainTextRecovery: unknown;
  },
  label: string
): {
  readonly editorEngineCommit: string;
  readonly editorSchemaVersion: number;
  readonly snapshotBase64: string;
  readonly plainTextRecovery: string;
} {
  if (input.editorEngine !== "typie") {
    throw new Error("Unsupported editor engine");
  }
  if (
    !Number.isSafeInteger(input.editorSchemaVersion) ||
    (input.editorSchemaVersion as number) < 0 ||
    !(input.snapshot instanceof Uint8Array) ||
    input.snapshot.byteLength > MAX_SNAPSHOT_BYTES ||
    typeof input.plainTextRecovery !== "string" ||
    input.plainTextRecovery.length > MAX_RECOVERY_TEXT_CODE_UNITS
  ) {
    throw new Error(`Invalid ${label} payload`);
  }
  return {
    editorEngineCommit: validateShortText(
      input.editorEngineCommit,
      "Editor engine commit",
      128
    ),
    editorSchemaVersion: input.editorSchemaVersion as number,
    snapshotBase64: encodeSnapshot(input.snapshot),
    plainTextRecovery: input.plainTextRecovery
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

  public async listEntities(
    input: ListEntitiesRequest
  ): Promise<ListEntitiesResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const query =
      input.query === undefined
        ? undefined
        : validateExactText(input.query, "Entity query", 2_000, true);
    const kinds = validateEnumArray(input.kinds, ENTITY_KINDS, "entity kind");
    const statuses = validateEnumArray(
      input.statuses,
      ENTITY_STATUSES,
      "entity status"
    );
    const tagIds = validateStringArray(input.tagIds, "entity tag ids", 500);
    const sort =
      input.sort === undefined
        ? undefined
        : validateEnum(input.sort, ENTITY_SORTS, "entity sort");
    const response = asRecord(
      await this.core.request("list_entities", {
        file_path: session.filePath,
        ...(query === undefined ? {} : { query }),
        ...(kinds === undefined ? {} : { kinds }),
        ...(statuses === undefined ? {} : { statuses }),
        ...(tagIds === undefined ? {} : { tag_ids: tagIds }),
        ...(sort === undefined ? {} : { sort })
      }),
      "entity list response"
    );
    const entities = requiredArray(
      response,
      "entities",
      50_000,
      "entity list"
    ).map(parseEntity);
    if (entities.some((entity) => entity.projectId !== session.projectId)) {
      throw new Error("The local core returned a cross-project entity");
    }
    const revision = responseRevision(response, "entity list");
    this.sessions.updateProject(sessionId, { revision });
    return { entities, revision };
  }

  public async searchEntities(
    input: SearchEntitiesRequest
  ): Promise<SearchEntitiesResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const query = validateExactText(input.query, "Entity search query", 2_000);
    const offset = validatePageNumber(input.offset, "Entity search offset", {
      allowZero: true,
      maximum: Number.MAX_SAFE_INTEGER
    });
    const limit = validatePageNumber(input.limit, "Entity search limit", {
      allowZero: false,
      maximum: 2_000
    });
    const response = asRecord(
      await this.core.request("search_entities", {
        file_path: session.filePath,
        query,
        ...(offset === undefined ? {} : { offset }),
        ...(limit === undefined ? {} : { limit })
      }),
      "entity search response"
    );
    const hits: EntitySearchHit[] = requiredArray(
      response,
      "hits",
      2_000,
      "entity search hits"
    ).map((value) => {
      const hit = asRecord(value, "entity search hit");
      const entity = parseEntity(hit.entity);
      if (entity.projectId !== session.projectId) {
        throw new Error("The local core returned a cross-project entity hit");
      }
      const matchedFields = requiredArray(
        hit,
        "matched_fields",
        ENTITY_SEARCH_FIELDS.size,
        "entity search fields"
      ).map((field) =>
        parseEnum(field, ENTITY_SEARCH_FIELDS, "entity search field")
      );
      if (new Set(matchedFields).size !== matchedFields.length) {
        throw new Error("The local core returned duplicate entity search fields");
      }
      return {
        entity,
        matchedFields,
        matchedText: requiredText(hit, "matched_text")
      };
    });
    const revision = responseRevision(response, "entity search");
    this.sessions.updateProject(sessionId, { revision });
    return {
      query: requiredText(response, "query"),
      hits,
      totalMatches: requiredInteger(response, "total_matches"),
      offset: requiredInteger(response, "offset"),
      limit: requiredInteger(response, "limit"),
      hasMore: requiredBoolean(response, "has_more"),
      revision
    };
  }

  public async createEntity(
    input: CreateEntityRequest
  ): Promise<EntityMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const kind = validateEnum(input.kind, ENTITY_KINDS, "entity kind");
    const name = validateShortText(input.name, "Entity name", 500);
    const status =
      input.status === undefined
        ? undefined
        : validateEnum(input.status, ENTITY_STATUSES, "entity status");
    if (input.editorEngine !== "typie") {
      throw new Error("Unsupported editor engine");
    }
    if (
      !Number.isSafeInteger(input.editorSchemaVersion) ||
      input.editorSchemaVersion < 0
    ) {
      throw new Error("Invalid entity editor schema version");
    }
    const response = asRecord(
      await this.core.request("create_entity", {
        file_path: session.filePath,
        kind,
        name,
        summary:
          validateNullableInputText(input.summary, "Entity summary", 10_000) ??
          null,
        ...(status === undefined ? {} : { status }),
        color_token:
          validateNullableInputText(
            input.colorToken,
            "Entity color token",
            128,
            false
          ) ?? null,
        icon_key:
          validateNullableInputText(
            input.iconKey,
            "Entity icon key",
            128,
            false
          ) ?? null,
        attributes:
          input.attributes === undefined
            ? {}
            : validateJsonObject(input.attributes, "Entity attributes"),
        editor_engine: "typie",
        editor_engine_commit: validateShortText(
          input.editorEngineCommit,
          "Editor engine commit",
          128
        ),
        editor_schema_version: input.editorSchemaVersion,
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "create entity response"
    );
    const entity = parseEntity(response.entity);
    const document = asRecord(response.document, "created entity document");
    if (
      entity.projectId !== session.projectId ||
      requiredString(document, "id", "entity document id") !==
        entity.documentId ||
      requiredString(document, "project_id", "entity document project id") !==
        session.projectId
    ) {
      throw new Error("The local core returned an inconsistent entity document");
    }
    const revision = responseRevision(response, "create entity");
    this.sessions.updateProject(sessionId, { revision });
    return { entity, revision };
  }

  public async updateEntity(
    input: UpdateEntityRequest
  ): Promise<EntityMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const response = asRecord(
      await this.core.request("update_entity", {
        file_path: session.filePath,
        entity_id: validateNodeId(input.entityId, "Entity id"),
        kind: validateEnum(input.kind, ENTITY_KINDS, "entity kind"),
        name: validateShortText(input.name, "Entity name", 500),
        summary: validateRequiredNullableInputText(
          input.summary,
          "Entity summary",
          10_000
        ),
        status: validateEnum(input.status, ENTITY_STATUSES, "entity status"),
        color_token: validateRequiredNullableInputText(
          input.colorToken,
          "Entity color token",
          128,
          false
        ),
        icon_key: validateRequiredNullableInputText(
          input.iconKey,
          "Entity icon key",
          128,
          false
        ),
        attributes: validateJsonObject(input.attributes, "Entity attributes"),
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "update entity response"
    );
    const entity = parseEntity(response.entity);
    if (entity.projectId !== session.projectId || entity.id !== input.entityId) {
      throw new Error("The local core updated another entity");
    }
    const revision = responseRevision(response, "update entity");
    this.sessions.updateProject(sessionId, { revision });
    return { entity, revision };
  }

  public async getEntityDeleteImpact(
    input: EntityDeleteImpactRequest
  ): Promise<EntityDeleteImpactResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const entityId = validateNodeId(input.entityId, "Entity id");
    const response = asRecord(
      await this.core.request("get_entity_delete_impact", {
        file_path: session.filePath,
        entity_id: entityId
      }),
      "entity delete impact response"
    );
    const impact = parseEntityDeleteImpact(response.impact ?? response, entityId);
    const revision = response.metadata
      ? responseRevision(response, "entity delete impact")
      : session.revision;
    this.sessions.updateProject(sessionId, { revision });
    return { impact, revision };
  }

  public async deleteEntity(
    input: DeleteEntityRequest
  ): Promise<DeleteEntityResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const entityId = validateNodeId(input.entityId, "Entity id");
    if (input.confirmed !== true) {
      throw new Error("Entity deletion requires explicit confirmation");
    }
    const response = asRecord(
      await this.core.request("delete_entity", {
        file_path: session.filePath,
        entity_id: entityId,
        confirmed: true,
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "delete entity response"
    );
    const deletedEntityId = requiredString(response, "deleted_entity_id");
    if (deletedEntityId !== entityId) {
      throw new Error("The local core deleted another entity");
    }
    requiredString(response, "deleted_document_id");
    const impact = parseEntityDeleteImpact(response.impact, entityId);
    const revision = responseRevision(response, "delete entity");
    this.sessions.updateProject(sessionId, { revision });
    return { deletedEntityId, impact, revision };
  }

  public async loadEntityNote(
    input: LoadEntityNoteRequest
  ): Promise<LoadedEntityNote> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    if (input.ownerKind !== "ENTITY") {
      throw new Error("Invalid entity note owner kind");
    }
    const ownerId = validateNodeId(input.ownerId, "Entity note owner id");
    const response = asRecord(
      await this.core.request("load_entity_note", {
        file_path: session.filePath,
        owner_kind: "ENTITY",
        owner_id: ownerId
      }),
      "load entity note response"
    );
    if (
      response.owner_kind !== "ENTITY" ||
      requiredString(response, "owner_id") !== ownerId
    ) {
      throw new Error("The local core returned another entity note owner");
    }
    const document = asRecord(response.document, "entity note document");
    const documentId = requiredString(response, "document_id");
    const projectId = requiredString(document, "project_id");
    if (
      requiredString(document, "id") !== documentId ||
      projectId !== session.projectId
    ) {
      throw new Error("Entity note document relation is inconsistent");
    }
    const revision = requiredInteger(response, "project_revision");
    this.sessions.updateProject(sessionId, { revision });
    return {
      ownerKind: "ENTITY",
      ownerId,
      id: documentId,
      projectId,
      title: requiredString(document, "title"),
      editorEngine: requiredString(document, "editor_engine"),
      editorEngineCommit: requiredString(document, "editor_engine_commit"),
      editorSchemaVersion: requiredInteger(document, "editor_schema_version"),
      snapshot: decodeSnapshot(requiredText(document, "snapshot_base64")),
      plainTextRecovery: requiredText(document, "plain_text_recovery"),
      revision,
      updatedAt: requiredString(document, "updated_at")
    };
  }

  public async saveEntityNote(
    input: SaveEntityNoteRequest
  ): Promise<SaveEntityNoteResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    if (input.ownerKind !== "ENTITY") {
      throw new Error("Invalid entity note owner kind");
    }
    const ownerId = validateNodeId(input.ownerId, "Entity note owner id");
    const documentId = validateNodeId(input.documentId, "Entity note document id");
    if (
      !Number.isSafeInteger(input.generation) ||
      input.generation < 0 ||
      !Number.isSafeInteger(input.saveSequence) ||
      input.saveSequence < 1
    ) {
      throw new Error("Invalid entity note save token");
    }
    const editor = validateEditorPayload(input, "entity note");
    const response = asRecord(
      await this.core.request("save_entity_note", {
        file_path: session.filePath,
        owner_kind: "ENTITY",
        owner_id: ownerId,
        document_id: documentId,
        generation: input.generation,
        save_sequence: input.saveSequence,
        editor_engine: "typie",
        editor_engine_commit: editor.editorEngineCommit,
        editor_schema_version: editor.editorSchemaVersion,
        snapshot_base64: editor.snapshotBase64,
        plain_text_recovery: editor.plainTextRecovery,
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "save entity note response"
    );
    const document = asRecord(response.document, "saved entity note document");
    if (
      response.owner_kind !== "ENTITY" ||
      requiredString(response, "owner_id") !== ownerId ||
      requiredString(document, "id") !== documentId ||
      requiredString(document, "project_id") !== session.projectId ||
      requiredInteger(response, "generation") !== input.generation ||
      requiredInteger(response, "save_sequence") !== input.saveSequence
    ) {
      throw new Error("The local core returned a stale entity note save");
    }
    const metadata = asRecord(response.metadata, "save entity note metadata");
    const revision = requiredInteger(metadata, "revision");
    const updatedAt = requiredString(metadata, "updated_at");
    this.sessions.updateProject(sessionId, { revision });
    return {
      ownerKind: "ENTITY",
      ownerId,
      documentId,
      generation: input.generation,
      saveSequence: input.saveSequence,
      revision,
      updatedAt
    };
  }

  public async listEntityAliases(
    input: ListEntityAliasesRequest
  ): Promise<ListEntityAliasesResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const entityId = validateNodeId(input.entityId, "Entity id");
    const response = asRecord(
      await this.core.request("list_entity_aliases", {
        file_path: session.filePath,
        entity_id: entityId
      }),
      "entity alias list response"
    );
    const aliases = requiredArray(
      response,
      "aliases",
      100_000,
      "entity aliases"
    ).map(parseEntityAlias);
    if (aliases.some((alias) => alias.entityId !== entityId)) {
      throw new Error("The local core returned an alias for another entity");
    }
    const revision = responseRevision(response, "entity alias list");
    this.sessions.updateProject(sessionId, { revision });
    return { aliases, revision };
  }

  public async createEntityAlias(
    input: CreateEntityAliasRequest
  ): Promise<EntityAliasMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const entityId = validateNodeId(input.entityId, "Entity id");
    const response = asRecord(
      await this.core.request("create_entity_alias", {
        file_path: session.filePath,
        entity_id: entityId,
        alias: validateShortText(input.alias, "Entity alias", 500),
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "create entity alias response"
    );
    const alias = parseEntityAlias(response.alias);
    if (alias.entityId !== entityId) {
      throw new Error("The local core created an alias for another entity");
    }
    const revision = responseRevision(response, "create entity alias");
    this.sessions.updateProject(sessionId, { revision });
    return { alias, revision };
  }

  public async deleteEntityAlias(
    input: DeleteEntityAliasRequest
  ): Promise<DeleteEntityAliasResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const aliasId = validateNodeId(input.aliasId, "Entity alias id");
    const response = asRecord(
      await this.core.request("delete_entity_alias", {
        file_path: session.filePath,
        alias_id: aliasId,
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "delete entity alias response"
    );
    const deletedAliasId = requiredString(response, "deleted_alias_id");
    if (deletedAliasId !== aliasId) {
      throw new Error("The local core deleted another entity alias");
    }
    const revision = responseRevision(response, "delete entity alias");
    this.sessions.updateProject(sessionId, { revision });
    return { deletedAliasId, revision };
  }

  public async listTags(input: SessionRequest): Promise<ListTagsResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const response = asRecord(
      await this.core.request("list_tags", { file_path: session.filePath }),
      "tag list response"
    );
    const tags = requiredArray(response, "tags", 50_000, "tags").map(parseTag);
    if (tags.some((tag) => tag.projectId !== session.projectId)) {
      throw new Error("The local core returned a cross-project tag");
    }
    const revision = responseRevision(response, "tag list");
    this.sessions.updateProject(sessionId, { revision });
    return { tags, revision };
  }

  public async createTag(input: CreateTagRequest): Promise<TagMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const response = asRecord(
      await this.core.request("create_tag", {
        file_path: session.filePath,
        name: validateShortText(input.name, "Tag name", 200),
        color_token:
          validateNullableInputText(
            input.colorToken,
            "Tag color token",
            128,
            false
          ) ?? null,
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "create tag response"
    );
    const tag = parseTag(response.tag);
    if (tag.projectId !== session.projectId) {
      throw new Error("The local core created a cross-project tag");
    }
    const revision = responseRevision(response, "create tag");
    this.sessions.updateProject(sessionId, { revision });
    return { tag, revision };
  }

  public async updateTag(input: UpdateTagRequest): Promise<TagMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const tagId = validateNodeId(input.tagId, "Tag id");
    const response = asRecord(
      await this.core.request("update_tag", {
        file_path: session.filePath,
        tag_id: tagId,
        name: validateShortText(input.name, "Tag name", 200),
        color_token: validateRequiredNullableInputText(
          input.colorToken,
          "Tag color token",
          128,
          false
        ),
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "update tag response"
    );
    const tag = parseTag(response.tag);
    if (tag.id !== tagId || tag.projectId !== session.projectId) {
      throw new Error("The local core updated another tag");
    }
    const revision = responseRevision(response, "update tag");
    this.sessions.updateProject(sessionId, { revision });
    return { tag, revision };
  }

  public async deleteTag(input: DeleteTagRequest): Promise<DeleteTagResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const tagId = validateNodeId(input.tagId, "Tag id");
    const response = asRecord(
      await this.core.request("delete_tag", {
        file_path: session.filePath,
        tag_id: tagId,
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "delete tag response"
    );
    const deletedTagId = requiredString(response, "deleted_tag_id");
    if (deletedTagId !== tagId) {
      throw new Error("The local core deleted another tag");
    }
    const revision = responseRevision(response, "delete tag");
    this.sessions.updateProject(sessionId, { revision });
    return { deletedTagId, revision };
  }

  public async listEntityTags(
    input: ListEntityTagsRequest
  ): Promise<ListEntityTagsResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const entityId = validateNodeId(input.entityId, "Entity id");
    const response = asRecord(
      await this.core.request("list_entity_tags", {
        file_path: session.filePath,
        entity_id: entityId
      }),
      "entity tag list response"
    );
    if (requiredString(response, "entity_id") !== entityId) {
      throw new Error("The local core returned tags for another entity");
    }
    const tags = requiredArray(response, "tags", 500, "entity tags").map(
      parseTag
    );
    if (
      tags.some((tag) => tag.projectId !== session.projectId) ||
      new Set(tags.map((tag) => tag.id)).size !== tags.length
    ) {
      throw new Error("The local core returned invalid entity tags");
    }
    const revision = responseRevision(response, "entity tag list");
    this.sessions.updateProject(sessionId, { revision });
    return { entityId, tags, revision };
  }

  public async setEntityTags(
    input: SetEntityTagsRequest
  ): Promise<SetEntityTagsResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const entityId = validateNodeId(input.entityId, "Entity id");
    const tagIds = validateStringArray(input.tagIds, "entity tag ids", 500);
    if (!tagIds) {
      throw new Error("Entity tag ids are required");
    }
    const response = asRecord(
      await this.core.request("set_entity_tags", {
        file_path: session.filePath,
        entity_id: entityId,
        tag_ids: tagIds,
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "set entity tags response"
    );
    if (requiredString(response, "entity_id") !== entityId) {
      throw new Error("The local core tagged another entity");
    }
    const tags = requiredArray(response, "tags", 500, "entity tags").map(
      parseTag
    );
    if (
      tags.some((tag) => tag.projectId !== session.projectId) ||
      new Set(tags.map((tag) => tag.id)).size !== tags.length
    ) {
      throw new Error("The local core returned invalid entity tags");
    }
    const revision = responseRevision(response, "set entity tags");
    this.sessions.updateProject(sessionId, { revision });
    return { entityId, tags, revision };
  }

  public async listRelationTypes(
    input: SessionRequest
  ): Promise<ListRelationTypesResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const response = asRecord(
      await this.core.request("list_relation_types", {
        file_path: session.filePath
      }),
      "relation type list response"
    );
    const relationTypes = requiredArray(
      response,
      "relation_types",
      50_000,
      "relation types"
    ).map(parseRelationType);
    if (relationTypes.some((value) => value.projectId !== session.projectId)) {
      throw new Error("The local core returned a cross-project relation type");
    }
    const revision = responseRevision(response, "relation type list");
    this.sessions.updateProject(sessionId, { revision });
    return { relationTypes, revision };
  }

  public async createRelationType(
    input: CreateRelationTypeRequest
  ): Promise<RelationTypeMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    if (typeof input.directed !== "boolean") {
      throw new Error("Relation type direction is required");
    }
    const response = asRecord(
      await this.core.request("create_relation_type", {
        file_path: session.filePath,
        name: validateShortText(input.name, "Relation type name", 200),
        inverse_name:
          validateNullableInputText(
            input.inverseName,
            "Relation inverse name",
            200,
            false
          ) ?? null,
        directed: input.directed,
        color_token:
          validateNullableInputText(
            input.colorToken,
            "Relation color token",
            128,
            false
          ) ?? null,
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "create relation type response"
    );
    const relationType = parseRelationType(response.relation_type);
    if (relationType.projectId !== session.projectId) {
      throw new Error("The local core created a cross-project relation type");
    }
    const revision = responseRevision(response, "create relation type");
    this.sessions.updateProject(sessionId, { revision });
    return { relationType, revision };
  }

  public async updateRelationType(
    input: UpdateRelationTypeRequest
  ): Promise<RelationTypeMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const relationTypeId = validateNodeId(
      input.relationTypeId,
      "Relation type id"
    );
    if (typeof input.directed !== "boolean") {
      throw new Error("Relation type direction is required");
    }
    const response = asRecord(
      await this.core.request("update_relation_type", {
        file_path: session.filePath,
        relation_type_id: relationTypeId,
        name: validateShortText(input.name, "Relation type name", 200),
        inverse_name: validateRequiredNullableInputText(
          input.inverseName,
          "Relation inverse name",
          200,
          false
        ),
        directed: input.directed,
        color_token: validateRequiredNullableInputText(
          input.colorToken,
          "Relation color token",
          128,
          false
        ),
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "update relation type response"
    );
    const relationType = parseRelationType(response.relation_type);
    if (
      relationType.id !== relationTypeId ||
      relationType.projectId !== session.projectId
    ) {
      throw new Error("The local core updated another relation type");
    }
    const revision = responseRevision(response, "update relation type");
    this.sessions.updateProject(sessionId, { revision });
    return { relationType, revision };
  }

  public async deleteRelationType(
    input: DeleteRelationTypeRequest
  ): Promise<DeleteRelationTypeResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const relationTypeId = validateNodeId(
      input.relationTypeId,
      "Relation type id"
    );
    const response = asRecord(
      await this.core.request("delete_relation_type", {
        file_path: session.filePath,
        relation_type_id: relationTypeId,
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "delete relation type response"
    );
    const deletedRelationTypeId = requiredString(
      response,
      "deleted_relation_type_id"
    );
    if (deletedRelationTypeId !== relationTypeId) {
      throw new Error("The local core deleted another relation type");
    }
    const revision = responseRevision(response, "delete relation type");
    this.sessions.updateProject(sessionId, { revision });
    return { deletedRelationTypeId, revision };
  }

  public async listEntityRelations(
    input: ListEntityRelationsRequest
  ): Promise<ListEntityRelationsResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const entityId =
      input.entityId === undefined
        ? undefined
        : validateNodeId(input.entityId, "Entity id");
    const response = asRecord(
      await this.core.request("list_entity_relations", {
        file_path: session.filePath,
        ...(entityId === undefined ? {} : { entity_id: entityId })
      }),
      "entity relation list response"
    );
    const relations = requiredArray(
      response,
      "relations",
      200_000,
      "entity relations"
    ).map(parseEntityRelation);
    if (
      relations.some(
        (relation) =>
          relation.projectId !== session.projectId ||
          (entityId !== undefined &&
            relation.sourceEntityId !== entityId &&
            relation.targetEntityId !== entityId)
      )
    ) {
      throw new Error("The local core returned an invalid entity relation");
    }
    const revision = responseRevision(response, "entity relation list");
    this.sessions.updateProject(sessionId, { revision });
    return { relations, revision };
  }

  public async createEntityRelation(
    input: CreateEntityRelationRequest
  ): Promise<EntityRelationMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const sourceEntityId = validateNodeId(
      input.sourceEntityId,
      "Source entity id"
    );
    const targetEntityId = validateNodeId(
      input.targetEntityId,
      "Target entity id"
    );
    if (sourceEntityId === targetEntityId) {
      throw new Error("Self relations are not supported");
    }
    const relationTypeId = validateNodeId(
      input.relationTypeId,
      "Relation type id"
    );
    const response = asRecord(
      await this.core.request("create_entity_relation", {
        file_path: session.filePath,
        source_entity_id: sourceEntityId,
        relation_type_id: relationTypeId,
        target_entity_id: targetEntityId,
        note:
          validateNullableInputText(input.note, "Relation note", 10_000) ?? null,
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "create entity relation response"
    );
    const relation = parseEntityRelation(response.relation);
    if (
      relation.projectId !== session.projectId ||
      relation.sourceEntityId !== sourceEntityId ||
      relation.targetEntityId !== targetEntityId ||
      relation.relationTypeId !== relationTypeId
    ) {
      throw new Error("The local core created another entity relation");
    }
    const revision = responseRevision(response, "create entity relation");
    this.sessions.updateProject(sessionId, { revision });
    return { relation, revision };
  }

  public async updateEntityRelation(
    input: UpdateEntityRelationRequest
  ): Promise<EntityRelationMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const relationId = validateNodeId(input.relationId, "Entity relation id");
    const response = asRecord(
      await this.core.request("update_entity_relation", {
        file_path: session.filePath,
        relation_id: relationId,
        relation_type_id: validateNodeId(
          input.relationTypeId,
          "Relation type id"
        ),
        target_entity_id: validateNodeId(
          input.targetEntityId,
          "Target entity id"
        ),
        note: validateRequiredNullableInputText(
          input.note,
          "Relation note",
          10_000
        ),
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "update entity relation response"
    );
    const relation = parseEntityRelation(response.relation);
    if (relation.id !== relationId || relation.projectId !== session.projectId) {
      throw new Error("The local core updated another entity relation");
    }
    const revision = responseRevision(response, "update entity relation");
    this.sessions.updateProject(sessionId, { revision });
    return { relation, revision };
  }

  public async deleteEntityRelation(
    input: DeleteEntityRelationRequest
  ): Promise<DeleteEntityRelationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const relationId = validateNodeId(input.relationId, "Entity relation id");
    const response = asRecord(
      await this.core.request("delete_entity_relation", {
        file_path: session.filePath,
        relation_id: relationId,
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "delete entity relation response"
    );
    const deletedRelationId = requiredString(response, "deleted_relation_id");
    if (deletedRelationId !== relationId) {
      throw new Error("The local core deleted another entity relation");
    }
    const revision = responseRevision(response, "delete entity relation");
    this.sessions.updateProject(sessionId, { revision });
    return { deletedRelationId, revision };
  }

  public async listSceneEntityLinks(
    input: ListSceneEntityLinksRequest
  ): Promise<ListSceneEntityLinksResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const sceneNodeId =
      input.sceneNodeId === undefined
        ? undefined
        : validateNodeId(input.sceneNodeId, "Scene node id");
    const entityId =
      input.entityId === undefined
        ? undefined
        : validateNodeId(input.entityId, "Entity id");
    const response = asRecord(
      await this.core.request("list_scene_entity_links", {
        file_path: session.filePath,
        ...(sceneNodeId === undefined ? {} : { scene_node_id: sceneNodeId }),
        ...(entityId === undefined ? {} : { entity_id: entityId })
      }),
      "scene entity link list response"
    );
    const links = requiredArray(
      response,
      "links",
      200_000,
      "scene entity links"
    ).map(parseSceneEntityLink);
    if (
      links.some(
        (link) =>
          (sceneNodeId !== undefined && link.sceneNodeId !== sceneNodeId) ||
          (entityId !== undefined && link.entityId !== entityId)
      )
    ) {
      throw new Error("The local core returned an out-of-scope scene link");
    }
    const revision = responseRevision(response, "scene entity link list");
    this.sessions.updateProject(sessionId, { revision });
    return { links, revision };
  }

  public async createSceneEntityLink(
    input: CreateSceneEntityLinkRequest
  ): Promise<SceneEntityLinkMutationResult> {
    return this.mutateSceneEntityLink("create_scene_entity_link", input);
  }

  public async deleteSceneEntityLink(
    input: DeleteSceneEntityLinkRequest
  ): Promise<DeleteSceneEntityLinkResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const sceneNodeId = validateNodeId(input.sceneNodeId, "Scene node id");
    const entityId = validateNodeId(input.entityId, "Entity id");
    const role = validateEnum(input.role, SCENE_ENTITY_ROLES, "scene entity role");
    const response = asRecord(
      await this.core.request("delete_scene_entity_link", {
        file_path: session.filePath,
        scene_node_id: sceneNodeId,
        entity_id: entityId,
        role,
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "delete scene entity link response"
    );
    const deleted = asRecord(response.deleted_link, "deleted scene entity link");
    const deletedLink = {
      sceneNodeId: requiredString(deleted, "scene_node_id"),
      entityId: requiredString(deleted, "entity_id"),
      role: parseEnum(deleted.role, SCENE_ENTITY_ROLES, "scene entity role")
    };
    if (
      deletedLink.sceneNodeId !== sceneNodeId ||
      deletedLink.entityId !== entityId ||
      deletedLink.role !== role
    ) {
      throw new Error("The local core deleted another scene entity link");
    }
    const revision = responseRevision(response, "delete scene entity link");
    this.sessions.updateProject(sessionId, { revision });
    return { deletedLink, revision };
  }

  public async discoverEntityMentions(
    input: DiscoverEntityMentionsRequest
  ): Promise<DiscoverEntityMentionsResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const entityId = validateNodeId(input.entityId, "Entity id");
    const offset = validatePageNumber(input.offset, "Mention offset", {
      allowZero: true,
      maximum: Number.MAX_SAFE_INTEGER
    });
    const limit = validatePageNumber(input.limit, "Mention limit", {
      allowZero: false,
      maximum: 2_000
    });
    const response = asRecord(
      await this.core.request("discover_entity_mentions", {
        file_path: session.filePath,
        entity_id: entityId,
        ...(offset === undefined ? {} : { offset }),
        ...(limit === undefined ? {} : { limit })
      }),
      "entity mention response"
    );
    if (requiredString(response, "entity_id") !== entityId) {
      throw new Error("The local core discovered mentions for another entity");
    }
    const candidates = requiredArray(
      response,
      "candidates",
      2_000,
      "entity mention candidates"
    ).map((value) => {
      const candidate = asRecord(value, "entity mention candidate");
      const start = requiredInteger(candidate, "start");
      const end = requiredInteger(candidate, "end");
      if (end <= start || requiredString(candidate, "entity_id") !== entityId) {
        throw new Error("The local core returned an invalid mention candidate");
      }
      return {
        occurrenceId: requiredString(candidate, "occurrence_id"),
        entityId,
        sceneNodeId: requiredString(candidate, "scene_node_id"),
        documentId: requiredString(candidate, "document_id"),
        sceneTitle: requiredString(candidate, "scene_title"),
        matchedAlias: requiredString(candidate, "matched_alias"),
        start,
        end,
        contextBefore: requiredText(candidate, "context_before"),
        matchedText: requiredString(candidate, "matched_text"),
        contextAfter: requiredText(candidate, "context_after"),
        alreadyLinked: requiredBoolean(candidate, "already_linked")
      };
    });
    const revision = responseRevision(response, "entity mentions");
    this.sessions.updateProject(sessionId, { revision });
    return {
      entityId,
      candidates,
      totalScenes: requiredInteger(response, "total_scenes"),
      offset: requiredInteger(response, "offset"),
      limit: requiredInteger(response, "limit"),
      hasMore: requiredBoolean(response, "has_more"),
      revision
    };
  }

  public async promoteEntityMention(
    input: PromoteEntityMentionRequest
  ): Promise<SceneEntityLinkMutationResult> {
    return this.mutateSceneEntityLink("promote_entity_mention", input);
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

  private async mutateSceneEntityLink(
    method: "create_scene_entity_link" | "promote_entity_mention",
    input: CreateSceneEntityLinkRequest | PromoteEntityMentionRequest
  ): Promise<SceneEntityLinkMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const sceneNodeId = validateNodeId(input.sceneNodeId, "Scene node id");
    const entityId = validateNodeId(input.entityId, "Entity id");
    const role = validateEnum(input.role, SCENE_ENTITY_ROLES, "scene entity role");
    const response = asRecord(
      await this.core.request(method, {
        file_path: session.filePath,
        scene_node_id: sceneNodeId,
        entity_id: entityId,
        role,
        note:
          validateNullableInputText(input.note, "Scene link note", 10_000) ??
          null,
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      method === "promote_entity_mention"
        ? "promote entity mention response"
        : "create scene entity link response"
    );
    const link = parseSceneEntityLink(response.link);
    if (
      link.sceneNodeId !== sceneNodeId ||
      link.entityId !== entityId ||
      link.role !== role
    ) {
      throw new Error("The local core created another scene entity link");
    }
    const revision = responseRevision(response, "scene entity link mutation");
    this.sessions.updateProject(sessionId, { revision });
    return { link, revision };
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
