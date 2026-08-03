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
  listEntities: "madi:list-entities",
  searchEntities: "madi:search-entities",
  createEntity: "madi:create-entity",
  updateEntity: "madi:update-entity",
  getEntityDeleteImpact: "madi:get-entity-delete-impact",
  deleteEntity: "madi:delete-entity",
  loadEntityNote: "madi:load-entity-note",
  saveEntityNote: "madi:save-entity-note",
  listEntityAliases: "madi:list-entity-aliases",
  createEntityAlias: "madi:create-entity-alias",
  deleteEntityAlias: "madi:delete-entity-alias",
  listTags: "madi:list-tags",
  createTag: "madi:create-tag",
  updateTag: "madi:update-tag",
  deleteTag: "madi:delete-tag",
  listEntityTags: "madi:list-entity-tags",
  setEntityTags: "madi:set-entity-tags",
  listRelationTypes: "madi:list-relation-types",
  createRelationType: "madi:create-relation-type",
  updateRelationType: "madi:update-relation-type",
  deleteRelationType: "madi:delete-relation-type",
  listEntityRelations: "madi:list-entity-relations",
  createEntityRelation: "madi:create-entity-relation",
  updateEntityRelation: "madi:update-entity-relation",
  deleteEntityRelation: "madi:delete-entity-relation",
  listSceneEntityLinks: "madi:list-scene-entity-links",
  createSceneEntityLink: "madi:create-scene-entity-link",
  deleteSceneEntityLink: "madi:delete-scene-entity-link",
  discoverEntityMentions: "madi:discover-entity-mentions",
  promoteEntityMention: "madi:promote-entity-mention",
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
  readonly addedEntities: number;
  readonly deletedEntities: number;
  readonly changedEntities: number;
  readonly addedTags: number;
  readonly deletedTags: number;
  readonly changedTags: number;
  readonly addedRelationTypes: number;
  readonly deletedRelationTypes: number;
  readonly changedRelationTypes: number;
  readonly addedRelations: number;
  readonly deletedRelations: number;
  readonly changedRelations: number;
  readonly changedSceneLinks: number;
  readonly changedEntityNotes: number;
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

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type EntityKind =
  | "CHARACTER"
  | "LOCATION"
  | "ORGANIZATION"
  | "ITEM"
  | "EVENT"
  | "WORLD_RULE"
  | "FORESHADOWING"
  | "OTHER";

export type EntityStatus = "ACTIVE" | "DRAFT" | "ARCHIVED";
export type EntitySort = "NAME_ASC" | "UPDATED_DESC";

export interface EntityRecord {
  readonly id: string;
  readonly projectId: string;
  readonly kind: EntityKind;
  readonly name: string;
  readonly summary: string | null;
  readonly documentId: string;
  readonly status: EntityStatus;
  readonly colorToken: string | null;
  readonly iconKey: string | null;
  readonly attributes: JsonObject;
  readonly duplicateName: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ListEntitiesRequest extends SessionRequest {
  readonly query?: string;
  readonly kinds?: readonly EntityKind[];
  readonly statuses?: readonly EntityStatus[];
  readonly tagIds?: readonly string[];
  readonly sort?: EntitySort;
}

export interface ListEntitiesResult {
  readonly entities: readonly EntityRecord[];
  readonly revision: number;
}

export interface EntitySearchHit {
  readonly entity: EntityRecord;
  readonly matchedFields: readonly (
    | "NAME"
    | "ALIAS"
    | "SUMMARY"
    | "TAG"
    | "NOTE"
  )[];
  readonly matchedText: string;
}

export interface SearchEntitiesRequest extends SessionRequest {
  readonly query: string;
  readonly offset?: number;
  readonly limit?: number;
}

export interface SearchEntitiesResult {
  readonly query: string;
  readonly hits: readonly EntitySearchHit[];
  readonly totalMatches: number;
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
  readonly revision: number;
}

export interface CreateEntityRequest extends SessionRequest {
  readonly kind: EntityKind;
  readonly name: string;
  readonly summary?: string | null;
  readonly status?: EntityStatus;
  readonly colorToken?: string | null;
  readonly iconKey?: string | null;
  readonly attributes?: JsonObject;
  readonly editorEngine: "typie";
  readonly editorEngineCommit: string;
  readonly editorSchemaVersion: number;
}

export interface UpdateEntityRequest extends SessionRequest {
  readonly entityId: string;
  readonly kind: EntityKind;
  readonly name: string;
  readonly summary: string | null;
  readonly status: EntityStatus;
  readonly colorToken: string | null;
  readonly iconKey: string | null;
  readonly attributes: JsonObject;
}

export interface EntityMutationResult {
  readonly entity: EntityRecord;
  readonly revision: number;
}

export interface EntityDeleteImpactRequest extends SessionRequest {
  readonly entityId: string;
}

export interface EntityDeleteImpact {
  readonly entityId: string;
  readonly relationCount: number;
  readonly sceneLinkCount: number;
  readonly mentionSceneCount: number;
  readonly aliasCount: number;
  readonly tagCount: number;
  readonly noteCharacterCount: number;
}

export interface EntityDeleteImpactResult {
  readonly impact: EntityDeleteImpact;
  readonly revision: number;
}

export interface DeleteEntityRequest extends EntityDeleteImpactRequest {
  readonly confirmed: true;
}

export interface DeleteEntityResult {
  readonly deletedEntityId: string;
  readonly impact: EntityDeleteImpact;
  readonly revision: number;
}

export interface LoadEntityNoteRequest extends SessionRequest {
  readonly ownerKind: "ENTITY";
  readonly ownerId: string;
}

export interface LoadedEntityNote extends LoadedDocument {
  readonly ownerKind: "ENTITY";
  readonly ownerId: string;
}

export interface SaveEntityNoteRequest extends SessionRequest {
  readonly ownerKind: "ENTITY";
  readonly ownerId: string;
  readonly documentId: string;
  readonly generation: number;
  readonly saveSequence: number;
  readonly editorEngine: "typie";
  readonly editorEngineCommit: string;
  readonly editorSchemaVersion: number;
  readonly snapshot: Uint8Array;
  readonly plainTextRecovery: string;
}

export interface SaveEntityNoteResult extends SaveDocumentResult {
  readonly ownerKind: "ENTITY";
  readonly ownerId: string;
  readonly generation: number;
  readonly saveSequence: number;
}

export interface EntityAliasRecord {
  readonly id: string;
  readonly entityId: string;
  readonly alias: string;
  readonly normalizedAlias: string;
  readonly createdAt: string;
}

export interface ListEntityAliasesRequest extends SessionRequest {
  readonly entityId: string;
}

export interface ListEntityAliasesResult {
  readonly aliases: readonly EntityAliasRecord[];
  readonly revision: number;
}

export interface CreateEntityAliasRequest extends ListEntityAliasesRequest {
  readonly alias: string;
}

export interface EntityAliasMutationResult {
  readonly alias: EntityAliasRecord;
  readonly revision: number;
}

export interface DeleteEntityAliasRequest extends SessionRequest {
  readonly aliasId: string;
}

export interface DeleteEntityAliasResult {
  readonly deletedAliasId: string;
  readonly revision: number;
}

export interface TagRecord {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly colorToken: string | null;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}

export interface ListTagsResult {
  readonly tags: readonly TagRecord[];
  readonly revision: number;
}

export interface CreateTagRequest extends SessionRequest {
  readonly name: string;
  readonly colorToken?: string | null;
}

export interface UpdateTagRequest extends SessionRequest {
  readonly tagId: string;
  readonly name: string;
  readonly colorToken: string | null;
}

export interface TagMutationResult {
  readonly tag: TagRecord;
  readonly revision: number;
}

export interface DeleteTagRequest extends SessionRequest {
  readonly tagId: string;
}

export interface DeleteTagResult {
  readonly deletedTagId: string;
  readonly revision: number;
}

export interface SetEntityTagsRequest extends SessionRequest {
  readonly entityId: string;
  readonly tagIds: readonly string[];
}

export interface ListEntityTagsRequest extends SessionRequest {
  readonly entityId: string;
}

export interface ListEntityTagsResult {
  readonly entityId: string;
  readonly tags: readonly TagRecord[];
  readonly revision: number;
}

export interface SetEntityTagsResult {
  readonly entityId: string;
  readonly tags: readonly TagRecord[];
  readonly revision: number;
}

export interface RelationTypeRecord {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly inverseName: string | null;
  readonly directed: boolean;
  readonly colorToken: string | null;
  readonly isBuiltin: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ListRelationTypesResult {
  readonly relationTypes: readonly RelationTypeRecord[];
  readonly revision: number;
}

export interface CreateRelationTypeRequest extends SessionRequest {
  readonly name: string;
  readonly inverseName?: string | null;
  readonly directed: boolean;
  readonly colorToken?: string | null;
}

export interface UpdateRelationTypeRequest extends SessionRequest {
  readonly relationTypeId: string;
  readonly name: string;
  readonly inverseName: string | null;
  readonly directed: boolean;
  readonly colorToken: string | null;
}

export interface RelationTypeMutationResult {
  readonly relationType: RelationTypeRecord;
  readonly revision: number;
}

export interface DeleteRelationTypeRequest extends SessionRequest {
  readonly relationTypeId: string;
}

export interface DeleteRelationTypeResult {
  readonly deletedRelationTypeId: string;
  readonly revision: number;
}

export interface EntityRelationRecord {
  readonly id: string;
  readonly projectId: string;
  readonly sourceEntityId: string;
  readonly relationTypeId: string;
  readonly targetEntityId: string;
  readonly note: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ListEntityRelationsRequest extends SessionRequest {
  readonly entityId?: string;
}

export interface ListEntityRelationsResult {
  readonly relations: readonly EntityRelationRecord[];
  readonly revision: number;
}

export interface CreateEntityRelationRequest extends SessionRequest {
  readonly sourceEntityId: string;
  readonly relationTypeId: string;
  readonly targetEntityId: string;
  readonly note?: string | null;
}

export interface UpdateEntityRelationRequest extends SessionRequest {
  readonly relationId: string;
  readonly relationTypeId: string;
  readonly targetEntityId: string;
  readonly note: string | null;
}

export interface EntityRelationMutationResult {
  readonly relation: EntityRelationRecord;
  readonly revision: number;
}

export interface DeleteEntityRelationRequest extends SessionRequest {
  readonly relationId: string;
}

export interface DeleteEntityRelationResult {
  readonly deletedRelationId: string;
  readonly revision: number;
}

export type SceneEntityRole = "APPEARS" | "POV" | "MENTIONED" | "RELATED";

export interface SceneEntityLinkRecord {
  readonly sceneNodeId: string;
  readonly entityId: string;
  readonly role: SceneEntityRole;
  readonly note: string | null;
  readonly createdAt: string;
}

export interface ListSceneEntityLinksRequest extends SessionRequest {
  readonly sceneNodeId?: string;
  readonly entityId?: string;
}

export interface ListSceneEntityLinksResult {
  readonly links: readonly SceneEntityLinkRecord[];
  readonly revision: number;
}

export interface CreateSceneEntityLinkRequest extends SessionRequest {
  readonly sceneNodeId: string;
  readonly entityId: string;
  readonly role: SceneEntityRole;
  readonly note?: string | null;
}

export interface SceneEntityLinkMutationResult {
  readonly link: SceneEntityLinkRecord;
  readonly revision: number;
}

export interface DeleteSceneEntityLinkRequest extends SessionRequest {
  readonly sceneNodeId: string;
  readonly entityId: string;
  readonly role: SceneEntityRole;
}

export interface DeleteSceneEntityLinkResult {
  readonly deletedLink: Pick<
    SceneEntityLinkRecord,
    "sceneNodeId" | "entityId" | "role"
  >;
  readonly revision: number;
}

export interface DiscoverEntityMentionsRequest extends SessionRequest {
  readonly entityId: string;
  readonly offset?: number;
  readonly limit?: number;
}

export interface EntityMentionCandidate {
  readonly occurrenceId: string;
  readonly entityId: string;
  readonly sceneNodeId: string;
  readonly documentId: string;
  readonly sceneTitle: string;
  readonly matchedAlias: string;
  readonly start: number;
  readonly end: number;
  readonly contextBefore: string;
  readonly matchedText: string;
  readonly contextAfter: string;
  readonly alreadyLinked: boolean;
}

export interface DiscoverEntityMentionsResult {
  readonly entityId: string;
  readonly candidates: readonly EntityMentionCandidate[];
  readonly totalScenes: number;
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
  readonly revision: number;
}

export interface PromoteEntityMentionRequest extends SessionRequest {
  readonly entityId: string;
  readonly sceneNodeId: string;
  readonly role: SceneEntityRole;
  readonly note?: string | null;
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
  listEntities(request: ListEntitiesRequest): Promise<ListEntitiesResult>;
  searchEntities(request: SearchEntitiesRequest): Promise<SearchEntitiesResult>;
  createEntity(request: CreateEntityRequest): Promise<EntityMutationResult>;
  updateEntity(request: UpdateEntityRequest): Promise<EntityMutationResult>;
  getEntityDeleteImpact(
    request: EntityDeleteImpactRequest
  ): Promise<EntityDeleteImpactResult>;
  deleteEntity(request: DeleteEntityRequest): Promise<DeleteEntityResult>;
  loadEntityNote(request: LoadEntityNoteRequest): Promise<LoadedEntityNote>;
  saveEntityNote(
    request: SaveEntityNoteRequest
  ): Promise<SaveEntityNoteResult>;
  listEntityAliases(
    request: ListEntityAliasesRequest
  ): Promise<ListEntityAliasesResult>;
  createEntityAlias(
    request: CreateEntityAliasRequest
  ): Promise<EntityAliasMutationResult>;
  deleteEntityAlias(
    request: DeleteEntityAliasRequest
  ): Promise<DeleteEntityAliasResult>;
  listTags(request: SessionRequest): Promise<ListTagsResult>;
  createTag(request: CreateTagRequest): Promise<TagMutationResult>;
  updateTag(request: UpdateTagRequest): Promise<TagMutationResult>;
  deleteTag(request: DeleteTagRequest): Promise<DeleteTagResult>;
  listEntityTags(
    request: ListEntityTagsRequest
  ): Promise<ListEntityTagsResult>;
  setEntityTags(request: SetEntityTagsRequest): Promise<SetEntityTagsResult>;
  listRelationTypes(
    request: SessionRequest
  ): Promise<ListRelationTypesResult>;
  createRelationType(
    request: CreateRelationTypeRequest
  ): Promise<RelationTypeMutationResult>;
  updateRelationType(
    request: UpdateRelationTypeRequest
  ): Promise<RelationTypeMutationResult>;
  deleteRelationType(
    request: DeleteRelationTypeRequest
  ): Promise<DeleteRelationTypeResult>;
  listEntityRelations(
    request: ListEntityRelationsRequest
  ): Promise<ListEntityRelationsResult>;
  createEntityRelation(
    request: CreateEntityRelationRequest
  ): Promise<EntityRelationMutationResult>;
  updateEntityRelation(
    request: UpdateEntityRelationRequest
  ): Promise<EntityRelationMutationResult>;
  deleteEntityRelation(
    request: DeleteEntityRelationRequest
  ): Promise<DeleteEntityRelationResult>;
  listSceneEntityLinks(
    request: ListSceneEntityLinksRequest
  ): Promise<ListSceneEntityLinksResult>;
  createSceneEntityLink(
    request: CreateSceneEntityLinkRequest
  ): Promise<SceneEntityLinkMutationResult>;
  deleteSceneEntityLink(
    request: DeleteSceneEntityLinkRequest
  ): Promise<DeleteSceneEntityLinkResult>;
  discoverEntityMentions(
    request: DiscoverEntityMentionsRequest
  ): Promise<DiscoverEntityMentionsResult>;
  promoteEntityMention(
    request: PromoteEntityMentionRequest
  ): Promise<SceneEntityLinkMutationResult>;
  getAppVersion(): Promise<string>;
  onCloseRequested(listener: () => void): () => void;
  completeCloseRequest(request: CompleteCloseRequest): Promise<boolean>;
}
