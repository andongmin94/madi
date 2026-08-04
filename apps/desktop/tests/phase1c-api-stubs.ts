import { vi } from "vitest";
import type {
  MadiDesktopApi,
  WorldGraphReadModel
} from "../src/shared/contracts";

export type Phase1cApi = Pick<
  MadiDesktopApi,
  | "listEntities"
  | "searchEntities"
  | "createEntity"
  | "updateEntity"
  | "getEntityDeleteImpact"
  | "deleteEntity"
  | "loadEntityNote"
  | "saveEntityNote"
  | "listEntityAliases"
  | "createEntityAlias"
  | "deleteEntityAlias"
  | "listTags"
  | "listEntityTags"
  | "createTag"
  | "updateTag"
  | "deleteTag"
  | "setEntityTags"
  | "listRelationTypes"
  | "createRelationType"
  | "updateRelationType"
  | "deleteRelationType"
  | "listEntityRelations"
  | "createEntityRelation"
  | "updateEntityRelation"
  | "deleteEntityRelation"
  | "listSceneEntityLinks"
  | "createSceneEntityLink"
  | "deleteSceneEntityLink"
  | "discoverEntityMentions"
  | "promoteEntityMention"
  | "saveWorldGraphUiState"
  | "loadWorldGraphUiState"
  | "getWorldGraph"
  | "getWorldGraphStats"
  | "getEntityGraphDetail"
  | "getEntitySceneContext"
  | "listCanvases"
  | "createCanvas"
  | "updateCanvas"
  | "duplicateCanvas"
  | "deleteCanvas"
  | "loadCanvas"
  | "saveCanvas"
  | "savePlotCanvasUiState"
  | "loadPlotCanvasUiState"
  | "pickCanvasImport"
  | "exportCanvas"
  | "saveReaderLabUiState"
  | "loadReaderLabUiState"
  | "compilePublication"
  | "getPublicationStats"
  | "validatePublication"
  | "listReaderPresets"
  | "createReaderPreset"
  | "updateReaderPreset"
  | "duplicateReaderPreset"
  | "deleteReaderPreset"
  | "getPublicationExportState"
  | "updatePublicationMetadata"
  | "choosePublicationCover"
  | "removePublicationCover"
  | "createEpubExportPreset"
  | "updateEpubExportPreset"
  | "duplicateEpubExportPreset"
  | "deleteEpubExportPreset"
  | "chooseEpubOutput"
  | "validateEpubExport"
  | "runEpubExport"
  | "cancelEpubExport"
  | "saveEpubExportReport"
  | "revealEpubExport"
  | "onEpubExportProgress"
>;

function unused(): never {
  throw new Error("Phase 1C API is not used by this test");
}

export function phase1cApiStubs(): Phase1cApi {
  return {
    listEntities: vi.fn(async () => ({ entities: [], revision: 0 })),
    searchEntities: vi.fn(async (request) => ({
      query: request.query,
      hits: [],
      totalMatches: 0,
      offset: request.offset ?? 0,
      limit: request.limit ?? 100,
      hasMore: false,
      revision: 0
    })),
    createEntity: vi.fn(async () => unused()),
    updateEntity: vi.fn(async () => unused()),
    getEntityDeleteImpact: vi.fn(async () => unused()),
    deleteEntity: vi.fn(async () => unused()),
    loadEntityNote: vi.fn(async () => unused()),
    saveEntityNote: vi.fn(async () => unused()),
    listEntityAliases: vi.fn(async () => ({ aliases: [], revision: 0 })),
    createEntityAlias: vi.fn(async () => unused()),
    deleteEntityAlias: vi.fn(async () => unused()),
    listTags: vi.fn(async () => ({ tags: [], revision: 0 })),
    listEntityTags: vi.fn(async (request) => ({
      entityId: request.entityId,
      tags: [],
      revision: 0
    })),
    createTag: vi.fn(async () => unused()),
    updateTag: vi.fn(async () => unused()),
    deleteTag: vi.fn(async () => unused()),
    setEntityTags: vi.fn(async () => unused()),
    listRelationTypes: vi.fn(async () => ({ relationTypes: [], revision: 0 })),
    createRelationType: vi.fn(async () => unused()),
    updateRelationType: vi.fn(async () => unused()),
    deleteRelationType: vi.fn(async () => unused()),
    listEntityRelations: vi.fn(async () => ({ relations: [], revision: 0 })),
    createEntityRelation: vi.fn(async () => unused()),
    updateEntityRelation: vi.fn(async () => unused()),
    deleteEntityRelation: vi.fn(async () => unused()),
    listSceneEntityLinks: vi.fn(async () => ({ links: [], revision: 0 })),
    createSceneEntityLink: vi.fn(async () => unused()),
    deleteSceneEntityLink: vi.fn(async () => unused()),
    discoverEntityMentions: vi.fn(async (request) => ({
      entityId: request.entityId,
      candidates: [],
      totalScenes: 0,
      offset: request.offset ?? 0,
      limit: request.limit ?? 100,
      hasMore: false,
      revision: 0
    })),
    promoteEntityMention: vi.fn(async () => unused()),
    saveWorldGraphUiState: vi.fn(async () => undefined),
    loadWorldGraphUiState: vi.fn(async () => ({ state: null })),
    getWorldGraph: vi.fn(async (): Promise<WorldGraphReadModel> => ({
      projectId: "project-id",
      revision: 0,
      nodes: [],
      edges: [],
      stats: {
        entityCount: 0,
        relationCount: 0,
        entityKindCounts: [
          { kind: "CHARACTER", count: 0 },
          { kind: "LOCATION", count: 0 },
          { kind: "ORGANIZATION", count: 0 },
          { kind: "ITEM", count: 0 },
          { kind: "EVENT", count: 0 },
          { kind: "WORLD_RULE", count: 0 },
          { kind: "FORESHADOWING", count: 0 },
          { kind: "OTHER", count: 0 }
        ],
        relationTypeCounts: [],
        topDegreeEntities: [],
        isolatedEntityCount: 0,
        directedRelationCount: 0,
        undirectedRelationCount: 0
      },
      diagnostics: []
    })),
    getWorldGraphStats: vi.fn(async () => unused()),
    getEntityGraphDetail: vi.fn(async () => unused()),
    getEntitySceneContext: vi.fn(async () => unused()),
    listCanvases: vi.fn(async () => ({ canvases: [], revision: 0 })),
    createCanvas: vi.fn(async () => unused()),
    updateCanvas: vi.fn(async () => unused()),
    duplicateCanvas: vi.fn(async () => unused()),
    deleteCanvas: vi.fn(async () => unused()),
    loadCanvas: vi.fn(async () => unused()),
    saveCanvas: vi.fn(async () => unused()),
    savePlotCanvasUiState: vi.fn(async () => undefined),
    loadPlotCanvasUiState: vi.fn(async () => ({ state: null })),
    pickCanvasImport: vi.fn(async () => null),
    exportCanvas: vi.fn(async () => null),
    saveReaderLabUiState: vi.fn(async () => undefined),
    loadReaderLabUiState: vi.fn(async () => ({ state: null })),
    compilePublication: vi.fn(async () => unused()),
    getPublicationStats: vi.fn(async () => unused()),
    validatePublication: vi.fn(async () => unused()),
    listReaderPresets: vi.fn(async () => ({
      presets: [],
      duplicateNames: [],
      revision: 0
    })),
    createReaderPreset: vi.fn(async () => unused()),
    updateReaderPreset: vi.fn(async () => unused()),
    duplicateReaderPreset: vi.fn(async () => unused()),
    deleteReaderPreset: vi.fn(async () => unused()),
    getPublicationExportState: vi.fn(async () => unused()),
    updatePublicationMetadata: vi.fn(async () => unused()),
    choosePublicationCover: vi.fn(async () => unused()),
    removePublicationCover: vi.fn(async () => unused()),
    createEpubExportPreset: vi.fn(async () => unused()),
    updateEpubExportPreset: vi.fn(async () => unused()),
    duplicateEpubExportPreset: vi.fn(async () => unused()),
    deleteEpubExportPreset: vi.fn(async () => unused()),
    chooseEpubOutput: vi.fn(async () => unused()),
    validateEpubExport: vi.fn(async () => unused()),
    runEpubExport: vi.fn(async () => unused()),
    cancelEpubExport: vi.fn(async () => unused()),
    saveEpubExportReport: vi.fn(async () => unused()),
    revealEpubExport: vi.fn(async () => unused()),
    onEpubExportProgress: vi.fn(() => () => undefined)
  };
}
