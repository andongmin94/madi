import {
  IPC_CHANNELS,
  type ApplyReplacementBatchRequest,
  type ApplyReplacementBatchResult,
  IPC_EVENTS,
  type CompleteCloseRequest,
  type CompilePublicationRequest,
  type CompilePublicationResult,
  type CanvasMutationResult,
  type CanvasRecord,
  type CreateCanvasRequest,
  type CreateReaderPresetRequest,
  type CreateNamedSnapshotRequest,
  type CreateNodeRequest,
  type CreateProjectRequest,
  type DeleteNodeRequest,
  type DeleteCanvasRequest,
  type DeleteCanvasResult,
  type DeleteReaderPresetRequest,
  type DeleteReaderPresetResult,
  type DeleteNamedSnapshotRequest,
  type DeleteNamedSnapshotResult,
  type DiffNamedSnapshotRequest,
  type DiffNamedSnapshotResult,
  type DuplicateCanvasRequest,
  type DuplicateReaderPresetRequest,
  type EntityGraphDetail,
  type EntityGraphRequest,
  type EntitySceneContext,
  type ExportCanvasRequest,
  type ExportCanvasResult,
  type LoadedSceneDocument,
  type LoadedDocument,
  type LoadSceneDocumentRequest,
  type LoadDocumentRequest,
  type LoadCanvasRequest,
  type LoadPlotCanvasUiStateResult,
  type LoadReaderLabUiStateResult,
  type LoadUiStateResult,
  type LoadWorldGraphUiStateResult,
  type ListDescendantScenesRequest,
  type ListDescendantScenesResult,
  type ListCanvasesRequest,
  type ListCanvasesResult,
  type ListNamedSnapshotsResult,
  type ListReaderPresetsRequest,
  type ListReaderPresetsResult,
  type MadiDesktopApi,
  type NamedSnapshotMutationResult,
  type MoveNodeRequest,
  type OpenProjectRequest,
  type PlainTextRecovery,
  type PickCanvasImportResult,
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
  type SaveCanvasRequest,
  type SaveCanvasResult,
  type SavePlotCanvasUiStateRequest,
  type SaveReaderLabUiStateRequest,
  type SaveUiStateRequest,
  type SaveWorldGraphUiStateRequest,
  type ScopeNodeRequest,
  type SearchProjectRequest,
  type SearchProjectResult,
  type SessionRequest,
  type RestoreNamedSnapshotRequest,
  type RestoreNamedSnapshotResult,
  type TextStatisticsResult,
  type PublicationStatsResult,
  type ReaderPresetMutationResult,
  type UpdateReaderPresetRequest,
  type ValidatePublicationRequest,
  type ValidatePublicationResult,
  type WorldGraphReadModel,
  type WorldGraphStatsResult
} from "../shared/contracts";
import type {
  CancelEpubExportRequest,
  ChooseEpubOutputRequest,
  ChoosePublicationCoverRequest,
  CreateEpubExportPresetRequest,
  DeleteEpubExportPresetRequest,
  DeleteEpubExportPresetResult,
  DuplicateEpubExportPresetRequest,
  EpubExportPresetMutationResult,
  EpubExportProgress,
  EpubOutputSelection,
  PublicationCoverMutationResult,
  PublicationExportState,
  PublicationMetadataMutationResult,
  RevealEpubExportRequest,
  RunEpubExportRequest,
  RunEpubExportResult,
  SaveEpubExportReportRequest,
  SaveEpubExportReportResult,
  UpdateEpubExportPresetRequest,
  UpdatePublicationMetadataRequest,
  ValidateEpubExportRequest,
  ValidateEpubExportResult
} from "../shared/epubExport";
import {
  validateEpubExportProgress,
  validateEpubOperationId,
  validateRunEpubExportResult
} from "../shared/epubExportValidation";
import type {
  CancelHwpxExportRequest,
  ChooseHwpxOutputRequest,
  CreateHwpxExportPresetRequest,
  DeleteHwpxExportPresetRequest,
  DeleteHwpxExportPresetResult,
  DuplicateHwpxExportPresetRequest,
  HwpxExportPresetMutationResult,
  HwpxExportProgress,
  HwpxExportState,
  HwpxOutputSelection,
  RevealHwpxExportRequest,
  RunHwpxExportRequest,
  RunHwpxExportResult,
  SaveHwpxExportReportRequest,
  SaveHwpxExportReportResult,
  UpdateHwpxExportPresetRequest,
  ValidateHwpxExportRequest,
  ValidateHwpxExportResult
} from "../shared/hwpxExport";
import {
  validateDeleteHwpxPresetResult,
  validateHwpxExportState,
  validateHwpxExportProgress,
  validateHwpxOutputSelection,
  validateHwpxOperationId,
  validateHwpxPresetMutationResult,
  validateSaveHwpxExportReportResult,
  validateValidateHwpxExportResult,
  validateRunHwpxExportResult
} from "../shared/hwpxExportValidation";
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
  EntityDeleteImpactRequest,
  EntityDeleteImpactResult,
  EntityMutationResult,
  EntityRelationMutationResult,
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
  SaveEntityNoteRequest,
  SaveEntityNoteResult,
  SceneEntityLinkMutationResult,
  SearchEntitiesRequest,
  SearchEntitiesResult,
  SetEntityTagsRequest,
  SetEntityTagsResult,
  TagMutationResult,
  UpdateEntityRelationRequest,
  UpdateCanvasRequest,
  UpdateEntityRequest,
  UpdateRelationTypeRequest,
  UpdateTagRequest
} from "../shared/contracts";

export type Invoke = (
  channel: string,
  ...arguments_: readonly unknown[]
) => Promise<unknown>;

export type Subscribe = (
  channel: string,
  listener: (payload?: unknown) => void
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

    async saveWorldGraphUiState(
      request: SaveWorldGraphUiStateRequest
    ): Promise<void> {
      await invoke(IPC_CHANNELS.saveWorldGraphUiState, request);
    },

    async loadWorldGraphUiState(
      request: SessionRequest
    ): Promise<LoadWorldGraphUiStateResult> {
      return (await invoke(
        IPC_CHANNELS.loadWorldGraphUiState,
        request
      )) as LoadWorldGraphUiStateResult;
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

    async listEntities(
      request: ListEntitiesRequest
    ): Promise<ListEntitiesResult> {
      return (await invoke(IPC_CHANNELS.listEntities, request)) as ListEntitiesResult;
    },

    async searchEntities(
      request: SearchEntitiesRequest
    ): Promise<SearchEntitiesResult> {
      return (await invoke(
        IPC_CHANNELS.searchEntities,
        request
      )) as SearchEntitiesResult;
    },

    async createEntity(
      request: CreateEntityRequest
    ): Promise<EntityMutationResult> {
      return (await invoke(
        IPC_CHANNELS.createEntity,
        request
      )) as EntityMutationResult;
    },

    async updateEntity(
      request: UpdateEntityRequest
    ): Promise<EntityMutationResult> {
      return (await invoke(
        IPC_CHANNELS.updateEntity,
        request
      )) as EntityMutationResult;
    },

    async getEntityDeleteImpact(
      request: EntityDeleteImpactRequest
    ): Promise<EntityDeleteImpactResult> {
      return (await invoke(
        IPC_CHANNELS.getEntityDeleteImpact,
        request
      )) as EntityDeleteImpactResult;
    },

    async deleteEntity(
      request: DeleteEntityRequest
    ): Promise<DeleteEntityResult> {
      return (await invoke(
        IPC_CHANNELS.deleteEntity,
        request
      )) as DeleteEntityResult;
    },

    async loadEntityNote(
      request: LoadEntityNoteRequest
    ): Promise<LoadedEntityNote> {
      const note = (await invoke(
        IPC_CHANNELS.loadEntityNote,
        request
      )) as LoadedEntityNote;
      return { ...note, snapshot: copyBytes(note.snapshot) };
    },

    async saveEntityNote(
      request: SaveEntityNoteRequest
    ): Promise<SaveEntityNoteResult> {
      return (await invoke(IPC_CHANNELS.saveEntityNote, {
        ...request,
        snapshot: copyBytes(request.snapshot)
      })) as SaveEntityNoteResult;
    },

    async listEntityAliases(
      request: ListEntityAliasesRequest
    ): Promise<ListEntityAliasesResult> {
      return (await invoke(
        IPC_CHANNELS.listEntityAliases,
        request
      )) as ListEntityAliasesResult;
    },

    async createEntityAlias(
      request: CreateEntityAliasRequest
    ): Promise<EntityAliasMutationResult> {
      return (await invoke(
        IPC_CHANNELS.createEntityAlias,
        request
      )) as EntityAliasMutationResult;
    },

    async deleteEntityAlias(
      request: DeleteEntityAliasRequest
    ): Promise<DeleteEntityAliasResult> {
      return (await invoke(
        IPC_CHANNELS.deleteEntityAlias,
        request
      )) as DeleteEntityAliasResult;
    },

    async listTags(request: SessionRequest): Promise<ListTagsResult> {
      return (await invoke(IPC_CHANNELS.listTags, request)) as ListTagsResult;
    },

    async createTag(request: CreateTagRequest): Promise<TagMutationResult> {
      return (await invoke(IPC_CHANNELS.createTag, request)) as TagMutationResult;
    },

    async updateTag(request: UpdateTagRequest): Promise<TagMutationResult> {
      return (await invoke(IPC_CHANNELS.updateTag, request)) as TagMutationResult;
    },

    async deleteTag(request: DeleteTagRequest): Promise<DeleteTagResult> {
      return (await invoke(IPC_CHANNELS.deleteTag, request)) as DeleteTagResult;
    },

    async listEntityTags(
      request: ListEntityTagsRequest
    ): Promise<ListEntityTagsResult> {
      return (await invoke(
        IPC_CHANNELS.listEntityTags,
        request
      )) as ListEntityTagsResult;
    },

    async setEntityTags(
      request: SetEntityTagsRequest
    ): Promise<SetEntityTagsResult> {
      return (await invoke(
        IPC_CHANNELS.setEntityTags,
        request
      )) as SetEntityTagsResult;
    },

    async listRelationTypes(
      request: SessionRequest
    ): Promise<ListRelationTypesResult> {
      return (await invoke(
        IPC_CHANNELS.listRelationTypes,
        request
      )) as ListRelationTypesResult;
    },

    async createRelationType(
      request: CreateRelationTypeRequest
    ): Promise<RelationTypeMutationResult> {
      return (await invoke(
        IPC_CHANNELS.createRelationType,
        request
      )) as RelationTypeMutationResult;
    },

    async updateRelationType(
      request: UpdateRelationTypeRequest
    ): Promise<RelationTypeMutationResult> {
      return (await invoke(
        IPC_CHANNELS.updateRelationType,
        request
      )) as RelationTypeMutationResult;
    },

    async deleteRelationType(
      request: DeleteRelationTypeRequest
    ): Promise<DeleteRelationTypeResult> {
      return (await invoke(
        IPC_CHANNELS.deleteRelationType,
        request
      )) as DeleteRelationTypeResult;
    },

    async listEntityRelations(
      request: ListEntityRelationsRequest
    ): Promise<ListEntityRelationsResult> {
      return (await invoke(
        IPC_CHANNELS.listEntityRelations,
        request
      )) as ListEntityRelationsResult;
    },

    async createEntityRelation(
      request: CreateEntityRelationRequest
    ): Promise<EntityRelationMutationResult> {
      return (await invoke(
        IPC_CHANNELS.createEntityRelation,
        request
      )) as EntityRelationMutationResult;
    },

    async updateEntityRelation(
      request: UpdateEntityRelationRequest
    ): Promise<EntityRelationMutationResult> {
      return (await invoke(
        IPC_CHANNELS.updateEntityRelation,
        request
      )) as EntityRelationMutationResult;
    },

    async deleteEntityRelation(
      request: DeleteEntityRelationRequest
    ): Promise<DeleteEntityRelationResult> {
      return (await invoke(
        IPC_CHANNELS.deleteEntityRelation,
        request
      )) as DeleteEntityRelationResult;
    },

    async listSceneEntityLinks(
      request: ListSceneEntityLinksRequest
    ): Promise<ListSceneEntityLinksResult> {
      return (await invoke(
        IPC_CHANNELS.listSceneEntityLinks,
        request
      )) as ListSceneEntityLinksResult;
    },

    async createSceneEntityLink(
      request: CreateSceneEntityLinkRequest
    ): Promise<SceneEntityLinkMutationResult> {
      return (await invoke(
        IPC_CHANNELS.createSceneEntityLink,
        request
      )) as SceneEntityLinkMutationResult;
    },

    async deleteSceneEntityLink(
      request: DeleteSceneEntityLinkRequest
    ): Promise<DeleteSceneEntityLinkResult> {
      return (await invoke(
        IPC_CHANNELS.deleteSceneEntityLink,
        request
      )) as DeleteSceneEntityLinkResult;
    },

    async discoverEntityMentions(
      request: DiscoverEntityMentionsRequest
    ): Promise<DiscoverEntityMentionsResult> {
      return (await invoke(
        IPC_CHANNELS.discoverEntityMentions,
        request
      )) as DiscoverEntityMentionsResult;
    },

    async promoteEntityMention(
      request: PromoteEntityMentionRequest
    ): Promise<SceneEntityLinkMutationResult> {
      return (await invoke(
        IPC_CHANNELS.promoteEntityMention,
        request
      )) as SceneEntityLinkMutationResult;
    },

    async getWorldGraph(
      request: SessionRequest
    ): Promise<WorldGraphReadModel> {
      return (await invoke(
        IPC_CHANNELS.getWorldGraph,
        request
      )) as WorldGraphReadModel;
    },

    async getWorldGraphStats(
      request: SessionRequest
    ): Promise<WorldGraphStatsResult> {
      return (await invoke(
        IPC_CHANNELS.getWorldGraphStats,
        request
      )) as WorldGraphStatsResult;
    },

    async getEntityGraphDetail(
      request: EntityGraphRequest
    ): Promise<EntityGraphDetail> {
      return (await invoke(
        IPC_CHANNELS.getEntityGraphDetail,
        request
      )) as EntityGraphDetail;
    },

    async getEntitySceneContext(
      request: EntityGraphRequest
    ): Promise<EntitySceneContext> {
      return (await invoke(
        IPC_CHANNELS.getEntitySceneContext,
        request
      )) as EntitySceneContext;
    },

    async listCanvases(
      request: ListCanvasesRequest
    ): Promise<ListCanvasesResult> {
      return (await invoke(
        IPC_CHANNELS.listCanvases,
        request
      )) as ListCanvasesResult;
    },

    async createCanvas(
      request: CreateCanvasRequest
    ): Promise<CanvasMutationResult> {
      return (await invoke(
        IPC_CHANNELS.createCanvas,
        request
      )) as CanvasMutationResult;
    },

    async updateCanvas(
      request: UpdateCanvasRequest
    ): Promise<CanvasMutationResult> {
      return (await invoke(
        IPC_CHANNELS.updateCanvas,
        request
      )) as CanvasMutationResult;
    },

    async duplicateCanvas(
      request: DuplicateCanvasRequest
    ): Promise<CanvasMutationResult> {
      return (await invoke(
        IPC_CHANNELS.duplicateCanvas,
        request
      )) as CanvasMutationResult;
    },

    async deleteCanvas(
      request: DeleteCanvasRequest
    ): Promise<DeleteCanvasResult> {
      return (await invoke(
        IPC_CHANNELS.deleteCanvas,
        request
      )) as DeleteCanvasResult;
    },

    async loadCanvas(request: LoadCanvasRequest): Promise<CanvasRecord> {
      return (await invoke(
        IPC_CHANNELS.loadCanvas,
        request
      )) as CanvasRecord;
    },

    async saveCanvas(request: SaveCanvasRequest): Promise<SaveCanvasResult> {
      return (await invoke(
        IPC_CHANNELS.saveCanvas,
        request
      )) as SaveCanvasResult;
    },

    async savePlotCanvasUiState(
      request: SavePlotCanvasUiStateRequest
    ): Promise<void> {
      await invoke(IPC_CHANNELS.savePlotCanvasUiState, request);
    },

    async loadPlotCanvasUiState(
      request: SessionRequest
    ): Promise<LoadPlotCanvasUiStateResult> {
      return (await invoke(
        IPC_CHANNELS.loadPlotCanvasUiState,
        request
      )) as LoadPlotCanvasUiStateResult;
    },

    async saveReaderLabUiState(
      request: SaveReaderLabUiStateRequest
    ): Promise<void> {
      await invoke(IPC_CHANNELS.saveReaderLabUiState, request);
    },

    async loadReaderLabUiState(
      request: SessionRequest
    ): Promise<LoadReaderLabUiStateResult> {
      return (await invoke(
        IPC_CHANNELS.loadReaderLabUiState,
        request
      )) as LoadReaderLabUiStateResult;
    },

    async compilePublication(
      request: CompilePublicationRequest
    ): Promise<CompilePublicationResult> {
      return (await invoke(
        IPC_CHANNELS.compilePublication,
        request
      )) as CompilePublicationResult;
    },

    async getPublicationStats(
      request: CompilePublicationRequest
    ): Promise<PublicationStatsResult> {
      return (await invoke(
        IPC_CHANNELS.getPublicationStats,
        request
      )) as PublicationStatsResult;
    },

    async validatePublication(
      request: ValidatePublicationRequest
    ): Promise<ValidatePublicationResult> {
      return (await invoke(
        IPC_CHANNELS.validatePublication,
        request
      )) as ValidatePublicationResult;
    },

    async listReaderPresets(
      request: ListReaderPresetsRequest
    ): Promise<ListReaderPresetsResult> {
      return (await invoke(
        IPC_CHANNELS.listReaderPresets,
        request
      )) as ListReaderPresetsResult;
    },

    async createReaderPreset(
      request: CreateReaderPresetRequest
    ): Promise<ReaderPresetMutationResult> {
      return (await invoke(
        IPC_CHANNELS.createReaderPreset,
        request
      )) as ReaderPresetMutationResult;
    },

    async updateReaderPreset(
      request: UpdateReaderPresetRequest
    ): Promise<ReaderPresetMutationResult> {
      return (await invoke(
        IPC_CHANNELS.updateReaderPreset,
        request
      )) as ReaderPresetMutationResult;
    },

    async duplicateReaderPreset(
      request: DuplicateReaderPresetRequest
    ): Promise<ReaderPresetMutationResult> {
      return (await invoke(
        IPC_CHANNELS.duplicateReaderPreset,
        request
      )) as ReaderPresetMutationResult;
    },

    async deleteReaderPreset(
      request: DeleteReaderPresetRequest
    ): Promise<DeleteReaderPresetResult> {
      return (await invoke(
        IPC_CHANNELS.deleteReaderPreset,
        request
      )) as DeleteReaderPresetResult;
    },

    async getPublicationExportState(
      request: SessionRequest
    ): Promise<PublicationExportState> {
      return (await invoke(
        IPC_CHANNELS.getPublicationExportState,
        request
      )) as PublicationExportState;
    },

    async updatePublicationMetadata(
      request: UpdatePublicationMetadataRequest
    ): Promise<PublicationMetadataMutationResult> {
      return (await invoke(
        IPC_CHANNELS.updatePublicationMetadata,
        request
      )) as PublicationMetadataMutationResult;
    },

    async choosePublicationCover(
      request: ChoosePublicationCoverRequest
    ): Promise<PublicationCoverMutationResult | null> {
      return (await invoke(
        IPC_CHANNELS.choosePublicationCover,
        request
      )) as PublicationCoverMutationResult | null;
    },

    async removePublicationCover(
      request: SessionRequest
    ): Promise<PublicationCoverMutationResult> {
      return (await invoke(
        IPC_CHANNELS.removePublicationCover,
        request
      )) as PublicationCoverMutationResult;
    },

    async createEpubExportPreset(
      request: CreateEpubExportPresetRequest
    ): Promise<EpubExportPresetMutationResult> {
      return (await invoke(
        IPC_CHANNELS.createEpubExportPreset,
        request
      )) as EpubExportPresetMutationResult;
    },

    async updateEpubExportPreset(
      request: UpdateEpubExportPresetRequest
    ): Promise<EpubExportPresetMutationResult> {
      return (await invoke(
        IPC_CHANNELS.updateEpubExportPreset,
        request
      )) as EpubExportPresetMutationResult;
    },

    async duplicateEpubExportPreset(
      request: DuplicateEpubExportPresetRequest
    ): Promise<EpubExportPresetMutationResult> {
      return (await invoke(
        IPC_CHANNELS.duplicateEpubExportPreset,
        request
      )) as EpubExportPresetMutationResult;
    },

    async deleteEpubExportPreset(
      request: DeleteEpubExportPresetRequest
    ): Promise<DeleteEpubExportPresetResult> {
      return (await invoke(
        IPC_CHANNELS.deleteEpubExportPreset,
        request
      )) as DeleteEpubExportPresetResult;
    },

    async chooseEpubOutput(
      request: ChooseEpubOutputRequest
    ): Promise<EpubOutputSelection | null> {
      return (await invoke(
        IPC_CHANNELS.chooseEpubOutput,
        request
      )) as EpubOutputSelection | null;
    },

    async validateEpubExport(
      request: ValidateEpubExportRequest
    ): Promise<ValidateEpubExportResult> {
      return (await invoke(
        IPC_CHANNELS.validateEpubExport,
        request
      )) as ValidateEpubExportResult;
    },

    async runEpubExport(
      request: RunEpubExportRequest
    ): Promise<RunEpubExportResult> {
      const result = validateRunEpubExportResult(
        await invoke(IPC_CHANNELS.runEpubExport, request)
      );
      if (result.operationId !== validateEpubOperationId(request.operationId)) {
        throw new Error("Mismatched EPUB export operation id");
      }
      return result;
    },

    async cancelEpubExport(request: CancelEpubExportRequest): Promise<boolean> {
      return (await invoke(IPC_CHANNELS.cancelEpubExport, request)) as boolean;
    },

    async saveEpubExportReport(
      request: SaveEpubExportReportRequest
    ): Promise<SaveEpubExportReportResult | null> {
      return (await invoke(
        IPC_CHANNELS.saveEpubExportReport,
        request
      )) as SaveEpubExportReportResult | null;
    },

    async revealEpubExport(request: RevealEpubExportRequest): Promise<boolean> {
      return (await invoke(IPC_CHANNELS.revealEpubExport, request)) as boolean;
    },

    onEpubExportProgress(
      listener: (progress: EpubExportProgress) => void
    ): () => void {
      return subscribe(IPC_EVENTS.epubExportProgress, (payload) => {
        listener(validateEpubExportProgress(payload));
      });
    },

    async getHwpxExportState(request: SessionRequest): Promise<HwpxExportState> {
      return validateHwpxExportState(
        await invoke(IPC_CHANNELS.getHwpxExportState, request)
      );
    },

    async createHwpxExportPreset(
      request: CreateHwpxExportPresetRequest
    ): Promise<HwpxExportPresetMutationResult> {
      return validateHwpxPresetMutationResult(
        await invoke(IPC_CHANNELS.createHwpxExportPreset, request)
      );
    },

    async updateHwpxExportPreset(
      request: UpdateHwpxExportPresetRequest
    ): Promise<HwpxExportPresetMutationResult> {
      return validateHwpxPresetMutationResult(
        await invoke(IPC_CHANNELS.updateHwpxExportPreset, request)
      );
    },

    async duplicateHwpxExportPreset(
      request: DuplicateHwpxExportPresetRequest
    ): Promise<HwpxExportPresetMutationResult> {
      return validateHwpxPresetMutationResult(
        await invoke(IPC_CHANNELS.duplicateHwpxExportPreset, request)
      );
    },

    async deleteHwpxExportPreset(
      request: DeleteHwpxExportPresetRequest
    ): Promise<DeleteHwpxExportPresetResult> {
      return validateDeleteHwpxPresetResult(
        await invoke(IPC_CHANNELS.deleteHwpxExportPreset, request)
      );
    },

    async chooseHwpxOutput(
      request: ChooseHwpxOutputRequest
    ): Promise<HwpxOutputSelection | null> {
      return validateHwpxOutputSelection(
        await invoke(IPC_CHANNELS.chooseHwpxOutput, request)
      );
    },

    async validateHwpxExport(
      request: ValidateHwpxExportRequest
    ): Promise<ValidateHwpxExportResult> {
      const result = validateValidateHwpxExportResult(
        await invoke(IPC_CHANNELS.validateHwpxExport, request)
      );
      if (result.operationId !== validateHwpxOperationId(request.operationId)) {
        throw new Error("Mismatched HWPX validation operation id");
      }
      return result;
    },

    async runHwpxExport(
      request: RunHwpxExportRequest
    ): Promise<RunHwpxExportResult> {
      const result = validateRunHwpxExportResult(
        await invoke(IPC_CHANNELS.runHwpxExport, request)
      );
      if (result.operationId !== validateHwpxOperationId(request.operationId)) {
        throw new Error("Mismatched HWPX export operation id");
      }
      return result;
    },

    async cancelHwpxExport(request: CancelHwpxExportRequest): Promise<boolean> {
      const result = await invoke(IPC_CHANNELS.cancelHwpxExport, request);
      if (typeof result !== "boolean") {
        throw new Error("Invalid HWPX cancellation result");
      }
      return result;
    },

    async saveHwpxExportReport(
      request: SaveHwpxExportReportRequest
    ): Promise<SaveHwpxExportReportResult | null> {
      return validateSaveHwpxExportReportResult(
        await invoke(IPC_CHANNELS.saveHwpxExportReport, request)
      );
    },

    async revealHwpxExport(request: RevealHwpxExportRequest): Promise<boolean> {
      const result = await invoke(IPC_CHANNELS.revealHwpxExport, request);
      if (typeof result !== "boolean") {
        throw new Error("Invalid HWPX reveal result");
      }
      return result;
    },

    onHwpxExportProgress(
      listener: (progress: HwpxExportProgress) => void
    ): () => void {
      return subscribe(IPC_EVENTS.hwpxExportProgress, (payload) => {
        listener(validateHwpxExportProgress(payload));
      });
    },

    async pickCanvasImport(): Promise<PickCanvasImportResult | null> {
      return (await invoke(
        IPC_CHANNELS.pickCanvasImport
      )) as PickCanvasImportResult | null;
    },

    async exportCanvas(
      request: ExportCanvasRequest
    ): Promise<ExportCanvasResult | null> {
      return (await invoke(
        IPC_CHANNELS.exportCanvas,
        request
      )) as ExportCanvasResult | null;
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
