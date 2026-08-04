import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent
} from "electron";
import { performance } from "node:perf_hooks";
import { deserialize, serialize } from "node:v8";
import {
  IPC_CHANNELS,
  type ApplyReplacementBatchRequest,
  type CompleteCloseRequest,
  type CompilePublicationRequest,
  type CreateCanvasRequest,
  type CreateReaderPresetRequest,
  type CreateNamedSnapshotRequest,
  type CreateNodeRequest,
  type CreateProjectRequest,
  type DeleteNodeRequest,
  type DeleteCanvasRequest,
  type DeleteNamedSnapshotRequest,
  type DeleteReaderPresetRequest,
  type DiffNamedSnapshotRequest,
  type DuplicateCanvasRequest,
  type DuplicateReaderPresetRequest,
  type EntityGraphRequest,
  type ExportCanvasRequest,
  type LoadSceneDocumentRequest,
  type LoadDocumentRequest,
  type ListDescendantScenesRequest,
  type ListCanvasesRequest,
  type LoadCanvasRequest,
  type MoveNodeRequest,
  type OpenProjectRequest,
  type RecoverPlainTextRequest,
  type RenameNamedSnapshotRequest,
  type RenameNodeRequest,
  type ReorderNodeRequest,
  type SaveSceneDocumentRequest,
  type SaveDocumentRequest,
  type SaveCanvasRequest,
  type SavePlotCanvasUiStateRequest,
  type SaveReaderLabUiStateRequest,
  type SaveUiStateRequest,
  type SaveWorldGraphUiStateRequest,
  type ScopeNodeRequest,
  type SearchProjectRequest,
  type RestoreNamedSnapshotRequest,
  type SessionRequest,
  type UpdateReaderPresetRequest,
  type ValidatePublicationRequest
} from "../shared/contracts";
import type {
  CreateEntityAliasRequest,
  CreateEntityRelationRequest,
  CreateEntityRequest,
  CreateRelationTypeRequest,
  CreateSceneEntityLinkRequest,
  CreateTagRequest,
  DeleteEntityAliasRequest,
  DeleteEntityRelationRequest,
  DeleteEntityRequest,
  DeleteRelationTypeRequest,
  DeleteSceneEntityLinkRequest,
  DeleteTagRequest,
  DiscoverEntityMentionsRequest,
  EntityDeleteImpactRequest,
  ListEntitiesRequest,
  ListEntityAliasesRequest,
  ListEntityRelationsRequest,
  ListEntityTagsRequest,
  ListSceneEntityLinksRequest,
  LoadEntityNoteRequest,
  PromoteEntityMentionRequest,
  SaveEntityNoteRequest,
  SearchEntitiesRequest,
  SetEntityTagsRequest,
  UpdateEntityRelationRequest,
  UpdateCanvasRequest,
  UpdateEntityRequest,
  UpdateRelationTypeRequest,
  UpdateTagRequest
} from "../shared/contracts";
import type { DesktopService } from "./desktopService";

function requireObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid request");
  }
  return value as Record<string, unknown>;
}

function withIpcCloneTiming<T extends object>(
  request: Readonly<Record<string, unknown>>,
  result: T
): T & { readonly ipcSerializeDeserializeMs: number } {
  const startedAt = performance.now();
  deserialize(serialize(request));
  deserialize(serialize(result));
  return {
    ...result,
    ipcSerializeDeserializeMs: performance.now() - startedAt
  };
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

  ipcMain.handle(
    IPC_CHANNELS.saveWorldGraphUiState,
    async (event, rawRequest: unknown) => {
      authorize(event);
      await service.saveWorldGraphUiState(
        requireObject(rawRequest) as unknown as SaveWorldGraphUiStateRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.loadWorldGraphUiState,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.loadWorldGraphUiState(
        requireObject(rawRequest) as unknown as SessionRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.savePlotCanvasUiState,
    async (event, rawRequest: unknown) => {
      authorize(event);
      await service.savePlotCanvasUiState(
        requireObject(rawRequest) as unknown as SavePlotCanvasUiStateRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.loadPlotCanvasUiState,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.loadPlotCanvasUiState(
        requireObject(rawRequest) as unknown as SessionRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.saveReaderLabUiState,
    async (event, rawRequest: unknown) => {
      authorize(event);
      await service.saveReaderLabUiState(
        requireObject(rawRequest) as unknown as SaveReaderLabUiStateRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.loadReaderLabUiState,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.loadReaderLabUiState(
        requireObject(rawRequest) as unknown as SessionRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.compilePublication,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.compilePublication(
        requireObject(rawRequest) as unknown as CompilePublicationRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.getPublicationStats,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.getPublicationStats(
        requireObject(rawRequest) as unknown as CompilePublicationRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.validatePublication,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.validatePublication(
        requireObject(rawRequest) as unknown as ValidatePublicationRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.listReaderPresets,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.listReaderPresets(
        requireObject(rawRequest) as unknown as SessionRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.createReaderPreset,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.createReaderPreset(
        requireObject(rawRequest) as unknown as CreateReaderPresetRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.updateReaderPreset,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.updateReaderPreset(
        requireObject(rawRequest) as unknown as UpdateReaderPresetRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.duplicateReaderPreset,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.duplicateReaderPreset(
        requireObject(rawRequest) as unknown as DuplicateReaderPresetRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.deleteReaderPreset,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.deleteReaderPreset(
        requireObject(rawRequest) as unknown as DeleteReaderPresetRequest
      );
    }
  );

  ipcMain.handle(IPC_CHANNELS.listCanvases, async (event, rawRequest) => {
    authorize(event);
    return service.listCanvases(
      requireObject(rawRequest) as unknown as ListCanvasesRequest
    );
  });

  ipcMain.handle(IPC_CHANNELS.createCanvas, async (event, rawRequest) => {
    authorize(event);
    return service.createCanvas(
      requireObject(rawRequest) as unknown as CreateCanvasRequest
    );
  });

  ipcMain.handle(IPC_CHANNELS.updateCanvas, async (event, rawRequest) => {
    authorize(event);
    return service.updateCanvas(
      requireObject(rawRequest) as unknown as UpdateCanvasRequest
    );
  });

  ipcMain.handle(IPC_CHANNELS.duplicateCanvas, async (event, rawRequest) => {
    authorize(event);
    return service.duplicateCanvas(
      requireObject(rawRequest) as unknown as DuplicateCanvasRequest
    );
  });

  ipcMain.handle(IPC_CHANNELS.deleteCanvas, async (event, rawRequest) => {
    authorize(event);
    return service.deleteCanvas(
      requireObject(rawRequest) as unknown as DeleteCanvasRequest
    );
  });

  ipcMain.handle(IPC_CHANNELS.loadCanvas, async (event, rawRequest) => {
    authorize(event);
    return service.loadCanvas(
      requireObject(rawRequest) as unknown as LoadCanvasRequest
    );
  });

  ipcMain.handle(IPC_CHANNELS.saveCanvas, async (event, rawRequest) => {
    authorize(event);
    return service.saveCanvas(
      requireObject(rawRequest) as unknown as SaveCanvasRequest
    );
  });

  ipcMain.handle(IPC_CHANNELS.pickCanvasImport, async (event) => {
    authorize(event);
    return service.pickCanvasImport();
  });

  ipcMain.handle(IPC_CHANNELS.exportCanvas, async (event, rawRequest) => {
    authorize(event);
    return service.exportCanvas(
      requireObject(rawRequest) as unknown as ExportCanvasRequest
    );
  });

  ipcMain.handle(
    IPC_CHANNELS.listDescendantScenes,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.listDescendantScenes(
        requireObject(rawRequest) as unknown as ListDescendantScenesRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.searchProject,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.searchProject(
        requireObject(rawRequest) as unknown as SearchProjectRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.getTextStatistics,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.getTextStatistics(
        requireObject(rawRequest) as unknown as ScopeNodeRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.applyReplacementBatch,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.applyReplacementBatch(
        requireObject(rawRequest) as unknown as ApplyReplacementBatchRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.createNamedSnapshot,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.createNamedSnapshot(
        requireObject(rawRequest) as unknown as CreateNamedSnapshotRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.listNamedSnapshots,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.listNamedSnapshots(
        requireObject(rawRequest) as unknown as SessionRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.renameNamedSnapshot,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.renameNamedSnapshot(
        requireObject(rawRequest) as unknown as RenameNamedSnapshotRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.deleteNamedSnapshot,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.deleteNamedSnapshot(
        requireObject(rawRequest) as unknown as DeleteNamedSnapshotRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.diffNamedSnapshot,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.diffNamedSnapshot(
        requireObject(rawRequest) as unknown as DiffNamedSnapshotRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.restoreNamedSnapshot,
    async (event, rawRequest: unknown) => {
      authorize(event);
      return service.restoreNamedSnapshot(
        requireObject(rawRequest) as unknown as RestoreNamedSnapshotRequest
      );
    }
  );

  ipcMain.handle(IPC_CHANNELS.listEntities, async (event, rawRequest) => {
    authorize(event);
    return service.listEntities(
      requireObject(rawRequest) as unknown as ListEntitiesRequest
    );
  });

  ipcMain.handle(IPC_CHANNELS.searchEntities, async (event, rawRequest) => {
    authorize(event);
    return service.searchEntities(
      requireObject(rawRequest) as unknown as SearchEntitiesRequest
    );
  });

  ipcMain.handle(IPC_CHANNELS.createEntity, async (event, rawRequest) => {
    authorize(event);
    return service.createEntity(
      requireObject(rawRequest) as unknown as CreateEntityRequest
    );
  });

  ipcMain.handle(IPC_CHANNELS.updateEntity, async (event, rawRequest) => {
    authorize(event);
    return service.updateEntity(
      requireObject(rawRequest) as unknown as UpdateEntityRequest
    );
  });

  ipcMain.handle(
    IPC_CHANNELS.getEntityDeleteImpact,
    async (event, rawRequest) => {
      authorize(event);
      return service.getEntityDeleteImpact(
        requireObject(rawRequest) as unknown as EntityDeleteImpactRequest
      );
    }
  );

  ipcMain.handle(IPC_CHANNELS.deleteEntity, async (event, rawRequest) => {
    authorize(event);
    return service.deleteEntity(
      requireObject(rawRequest) as unknown as DeleteEntityRequest
    );
  });

  ipcMain.handle(IPC_CHANNELS.loadEntityNote, async (event, rawRequest) => {
    authorize(event);
    return service.loadEntityNote(
      requireObject(rawRequest) as unknown as LoadEntityNoteRequest
    );
  });

  ipcMain.handle(IPC_CHANNELS.saveEntityNote, async (event, rawRequest) => {
    authorize(event);
    return service.saveEntityNote(
      requireObject(rawRequest) as unknown as SaveEntityNoteRequest
    );
  });

  ipcMain.handle(
    IPC_CHANNELS.listEntityAliases,
    async (event, rawRequest) => {
      authorize(event);
      return service.listEntityAliases(
        requireObject(rawRequest) as unknown as ListEntityAliasesRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.createEntityAlias,
    async (event, rawRequest) => {
      authorize(event);
      return service.createEntityAlias(
        requireObject(rawRequest) as unknown as CreateEntityAliasRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.deleteEntityAlias,
    async (event, rawRequest) => {
      authorize(event);
      return service.deleteEntityAlias(
        requireObject(rawRequest) as unknown as DeleteEntityAliasRequest
      );
    }
  );

  ipcMain.handle(IPC_CHANNELS.listTags, async (event, rawRequest) => {
    authorize(event);
    return service.listTags(
      requireObject(rawRequest) as unknown as SessionRequest
    );
  });

  ipcMain.handle(IPC_CHANNELS.createTag, async (event, rawRequest) => {
    authorize(event);
    return service.createTag(
      requireObject(rawRequest) as unknown as CreateTagRequest
    );
  });

  ipcMain.handle(IPC_CHANNELS.updateTag, async (event, rawRequest) => {
    authorize(event);
    return service.updateTag(
      requireObject(rawRequest) as unknown as UpdateTagRequest
    );
  });

  ipcMain.handle(IPC_CHANNELS.deleteTag, async (event, rawRequest) => {
    authorize(event);
    return service.deleteTag(
      requireObject(rawRequest) as unknown as DeleteTagRequest
    );
  });

  ipcMain.handle(IPC_CHANNELS.listEntityTags, async (event, rawRequest) => {
    authorize(event);
    return service.listEntityTags(
      requireObject(rawRequest) as unknown as ListEntityTagsRequest
    );
  });

  ipcMain.handle(IPC_CHANNELS.setEntityTags, async (event, rawRequest) => {
    authorize(event);
    return service.setEntityTags(
      requireObject(rawRequest) as unknown as SetEntityTagsRequest
    );
  });

  ipcMain.handle(IPC_CHANNELS.listRelationTypes, async (event, rawRequest) => {
    authorize(event);
    return service.listRelationTypes(
      requireObject(rawRequest) as unknown as SessionRequest
    );
  });

  ipcMain.handle(
    IPC_CHANNELS.createRelationType,
    async (event, rawRequest) => {
      authorize(event);
      return service.createRelationType(
        requireObject(rawRequest) as unknown as CreateRelationTypeRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.updateRelationType,
    async (event, rawRequest) => {
      authorize(event);
      return service.updateRelationType(
        requireObject(rawRequest) as unknown as UpdateRelationTypeRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.deleteRelationType,
    async (event, rawRequest) => {
      authorize(event);
      return service.deleteRelationType(
        requireObject(rawRequest) as unknown as DeleteRelationTypeRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.listEntityRelations,
    async (event, rawRequest) => {
      authorize(event);
      return service.listEntityRelations(
        requireObject(rawRequest) as unknown as ListEntityRelationsRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.createEntityRelation,
    async (event, rawRequest) => {
      authorize(event);
      return service.createEntityRelation(
        requireObject(rawRequest) as unknown as CreateEntityRelationRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.updateEntityRelation,
    async (event, rawRequest) => {
      authorize(event);
      return service.updateEntityRelation(
        requireObject(rawRequest) as unknown as UpdateEntityRelationRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.deleteEntityRelation,
    async (event, rawRequest) => {
      authorize(event);
      return service.deleteEntityRelation(
        requireObject(rawRequest) as unknown as DeleteEntityRelationRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.listSceneEntityLinks,
    async (event, rawRequest) => {
      authorize(event);
      return service.listSceneEntityLinks(
        requireObject(rawRequest) as unknown as ListSceneEntityLinksRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.createSceneEntityLink,
    async (event, rawRequest) => {
      authorize(event);
      return service.createSceneEntityLink(
        requireObject(rawRequest) as unknown as CreateSceneEntityLinkRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.deleteSceneEntityLink,
    async (event, rawRequest) => {
      authorize(event);
      return service.deleteSceneEntityLink(
        requireObject(rawRequest) as unknown as DeleteSceneEntityLinkRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.discoverEntityMentions,
    async (event, rawRequest) => {
      authorize(event);
      const request = requireObject(rawRequest);
      const result = await service.discoverEntityMentions(
        request as unknown as DiscoverEntityMentionsRequest
      );
      return withIpcCloneTiming(request, result);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.promoteEntityMention,
    async (event, rawRequest) => {
      authorize(event);
      return service.promoteEntityMention(
        requireObject(rawRequest) as unknown as PromoteEntityMentionRequest
      );
    }
  );

  ipcMain.handle(IPC_CHANNELS.getWorldGraph, async (event, rawRequest) => {
    authorize(event);
    return service.getWorldGraph(
      requireObject(rawRequest) as unknown as SessionRequest
    );
  });

  ipcMain.handle(
    IPC_CHANNELS.getWorldGraphStats,
    async (event, rawRequest) => {
      authorize(event);
      return service.getWorldGraphStats(
        requireObject(rawRequest) as unknown as SessionRequest
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.getEntityGraphDetail,
    async (event, rawRequest) => {
      authorize(event);
      const request = requireObject(rawRequest);
      const result = await service.getEntityGraphDetail(
        request as unknown as EntityGraphRequest
      );
      return withIpcCloneTiming(request, result);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.getEntitySceneContext,
    async (event, rawRequest) => {
      authorize(event);
      const request = requireObject(rawRequest);
      const result = await service.getEntitySceneContext(
        request as unknown as EntityGraphRequest
      );
      return withIpcCloneTiming(request, result);
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
