import path from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import type { BrowserWindow, SaveDialogOptions } from "electron";
import type {
  ApplyReplacementBatchRequest,
  ApplyReplacementBatchResult,
  CanvasMutationResult,
  CanvasRecord,
  CanvasSort,
  CanvasSummary,
  CompilePublicationRequest,
  CompilePublicationResult,
  CreateCanvasRequest,
  CreateReaderPresetRequest,
  CreateNamedSnapshotRequest,
  CreateNodeRequest,
  CreateProjectRequest,
  DeleteCanvasRequest,
  DeleteCanvasResult,
  DeleteNamedSnapshotRequest,
  DeleteNamedSnapshotResult,
  DeleteNodeRequest,
  DeleteReaderPresetRequest,
  DeleteReaderPresetResult,
  DiffNamedSnapshotRequest,
  DiffNamedSnapshotResult,
  DuplicateCanvasRequest,
  DuplicateReaderPresetRequest,
  ExportCanvasRequest,
  ExportCanvasResult,
  LoadedSceneDocument,
  LoadedDocument,
  LoadSceneDocumentRequest,
  LoadDocumentRequest,
  LoadCanvasRequest,
  LoadPlotCanvasUiStateResult,
  LoadReaderLabUiStateResult,
  LoadUiStateResult,
  ListDescendantScenesRequest,
  ListDescendantScenesResult,
  ListCanvasesRequest,
  ListCanvasesResult,
  ListNamedSnapshotsResult,
  ListReaderPresetsRequest,
  ListReaderPresetsResult,
  MoveNodeRequest,
  NamedSnapshotKind,
  NamedSnapshotMutationResult,
  NamedSnapshotSummary,
  PickCanvasImportResult,
  OpenProjectRequest,
  PlainTextRecovery,
  ProjectRecord,
  ProjectTree,
  ProjectSession,
  PublicationDiagnostic,
  PublicationDiagnosticCode,
  PublicationDiagnosticSeverity,
  PublicationSourceStatistics,
  PublicationStatsResult,
  ReaderPresetMutationResult,
  ReaderPresetRecord,
  ReaderPresetSourceKind,
  ReaderLabUiState,
  ReaderPaneOverrides,
  ReaderPaneUiState,
  ReaderRenderConfig,
  ReaderVerificationStatus,
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
  SaveCanvasRequest,
  SaveCanvasResult,
  SavePlotCanvasUiStateRequest,
  SaveReaderLabUiStateRequest,
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
  TreeNodeRecord,
  UpdateReaderPresetRequest,
  ValidatePublicationRequest,
  ValidatePublicationResult
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
  EntityGraphDetail,
  EntityGraphRelationDetail,
  EntityGraphRelationPerspective,
  EntityGraphRequest,
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
  EntitySceneContext,
  JsonObject,
  MadiCanvasDocument,
  PlotCanvasUiState,
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
  LoadWorldGraphUiStateResult,
  LoadedEntityNote,
  LoadEntityNoteRequest,
  PromoteEntityMentionRequest,
  RelationTypeMutationResult,
  RelationTypeRecord,
  SaveEntityNoteRequest,
  SaveEntityNoteResult,
  SaveWorldGraphUiStateRequest,
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
  UpdateCanvasRequest,
  UpdateEntityRequest,
  UpdateRelationTypeRequest,
  UpdateTagRequest,
  WorldGraphDepth,
  WorldGraphDiagnostic,
  WorldGraphDiagnosticCode,
  WorldGraphDiagnosticSeverity,
  WorldGraphEdge,
  WorldGraphFilterState,
  WorldGraphLayout,
  WorldGraphMode,
  WorldGraphNode,
  WorldGraphPoint,
  WorldGraphReadModel,
  WorldGraphRelationDirection,
  WorldGraphRelationTypeCount,
  WorldGraphStats,
  WorldGraphStatsResult,
  WorldGraphTag,
  WorldGraphTagMode,
  WorldGraphTopDegreeEntity,
  WorldGraphUiState
} from "../shared/contracts";
import type { CoreClient } from "./coreClient";
import { ProjectSessionRegistry } from "./projectSessions";
import { validatePublicationDocument } from "../shared/publicationValidation";
import { validateReaderRenderConfig } from "../shared/readerConfigValidation";
import { validateReaderLabUiState } from "../shared/readerLabStateValidation";
import { EPUB_RECOVERY_PRESERVED_ERROR } from "../shared/epubExport";
import type {
  CancelEpubExportRequest,
  ChooseEpubOutputRequest,
  ChoosePublicationCoverRequest,
  CreateEpubExportPresetRequest,
  DeleteEpubExportPresetRequest,
  DeleteEpubExportPresetResult,
  DuplicateEpubExportPresetRequest,
  EpubExportPresetConfig,
  EpubExportPresetMutationResult,
  EpubExportPresetRecord,
  EpubExportReport,
  EpubOutputSelection,
  PublicationCoverAsset,
  PublicationCoverMutationResult,
  PublicationExportMetadata,
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
  validateEpubExportPresetConfig,
  validateEpubIdentifier,
  validateEpubOperationId,
  validateEpubPresetName,
  validatePublicationMetadataInput,
  validatePublicationMetadataStateInput
} from "../shared/epubExportValidation";
import { IPC_EVENTS } from "../shared/contracts";
import type {
  EpubExporterPort,
  EpubExporterRunInput,
  EpubUtilityResult
} from "./epubExportClient";
import {
  EpubExportCancelledError,
  EpubUtilityValidationError
} from "./epubExportClient";
import type {
  CancelHwpxExportRequest,
  ChooseHwpxOutputRequest,
  CreateHwpxExportPresetRequest,
  DeleteHwpxExportPresetRequest,
  DeleteHwpxExportPresetResult,
  DuplicateHwpxExportPresetRequest,
  HwpxExportPresetConfig,
  HwpxExportPresetMutationResult,
  HwpxExportPresetRecord,
  HwpxExportReport,
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
  validateHwpxExportPresetConfig,
  validateHwpxIdentifier,
  validateHwpxOperationId,
  validateHwpxPresetName
} from "../shared/hwpxExportValidation";
import type {
  HwpxExporterPort,
  HwpxExporterRunInput,
  HwpxUtilityResult
} from "./hwpxExportClient";
import {
  HwpxExportCancelledError,
  HwpxUtilityValidationError
} from "./hwpxExportClient";
import type { HwpBridgePort } from "./hwpBridgeClient";
import {
  HwpBridgeCancelledError,
  HwpBridgeOperationError
} from "./hwpBridgeClient";
import type { FontInstallationPort } from "./fontInstallation";
import { WindowsFontInstallationDetector } from "./fontInstallation";
import type { HwpxCrashRecoveryPort } from "./hwpxCrashRecovery";
import {
  AtomicOutputError,
  type AtomicOutputIdentity,
  type AtomicOutputPort
} from "./atomicOutputClient";
import { BUILT_IN_HWPX_PRESETS } from "../shared/hwpxBuiltins";

const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;
const MAX_RECOVERY_TEXT_CODE_UNITS = 32 * 1024 * 1024;
const UI_STATE_KEY = "workspace.v1";
const WORLD_GRAPH_UI_STATE_KEY = "world-graph.v1";
const PLOT_CANVAS_UI_STATE_KEY = "plot-canvas.v1";
const READER_LAB_UI_STATE_KEY = "reader-lab.v1";
const MAX_CANVAS_FILE_BYTES = 8 * 1024 * 1024;
const MAX_COVER_FILE_BYTES = 10 * 1024 * 1024;
const MAX_COVER_BASE64_LENGTH = Math.ceil(MAX_COVER_FILE_BYTES / 3) * 4;
const MAX_EPUB_FILE_BYTES = 512 * 1024 * 1024;
const MAX_EPUB_REPORT_BYTES = 8 * 1024 * 1024;
const MAX_HWPX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_HWPX_REPORT_BYTES = 8 * 1024 * 1024;
const MAX_CANVAS_NODES = 500;
const MAX_CANVAS_EDGES = 1_000;
const MAX_WORLD_GRAPH_NODES = 500;
const MAX_WORLD_GRAPH_EDGES = 2_000;
const MAX_WORLD_GRAPH_ALIASES = 1_500;
const MAX_WORLD_GRAPH_SCENE_LINKS = 2_000;
const MAX_WORLD_GRAPH_RELATION_TYPES = 2_000;
const MAX_WORLD_GRAPH_DIAGNOSTICS = 2_000;
const MAX_WORLD_GRAPH_COORDINATE = 1_000_000;
const WORLD_GRAPH_UI_STATE_NUMBER_TOLERANCE = 1e-9;
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
const PUBLICATION_DIAGNOSTIC_CODES = new Set<PublicationDiagnosticCode>([
  "UNSUPPORTED_BLOCK",
  "UNSUPPORTED_INLINE_MODIFIER",
  "INVALID_SEMANTIC_DOCUMENT",
  "EMPTY_SCOPE"
]);
const PUBLICATION_DIAGNOSTIC_SEVERITIES =
  new Set<PublicationDiagnosticSeverity>(["INFO", "WARNING", "ERROR"]);
const READER_PRESET_SOURCE_KINDS = new Set<ReaderPresetSourceKind>([
  "BUILTIN_TEMPLATE",
  "CUSTOM",
  "DUPLICATED",
  "IMPORTED"
]);
const READER_VERIFICATION_STATUSES = new Set<ReaderVerificationStatus>([
  "GENERIC",
  "UNVERIFIED_SIMULATION",
  "USER_DEFINED"
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
const WORLD_GRAPH_DIAGNOSTIC_CODES = new Set<WorldGraphDiagnosticCode>([
  "SELF_RELATION",
  "CROSS_PROJECT_RELATION",
  "DANGLING_RELATION_MEMBER",
  "DUPLICATE_UNDIRECTED_RELATION",
  "INVALID_ENTITY_TAG",
  "INVALID_SCENE_LINK"
]);
const WORLD_GRAPH_DIAGNOSTIC_SEVERITIES =
  new Set<WorldGraphDiagnosticSeverity>(["ERROR", "WARNING"]);
const ENTITY_GRAPH_RELATION_PERSPECTIVES =
  new Set<EntityGraphRelationPerspective>([
    "OUTGOING",
    "INCOMING",
    "UNDIRECTED"
  ]);
const WORLD_GRAPH_MODES = new Set<WorldGraphMode>(["FULL", "FOCUSED"]);
const WORLD_GRAPH_TAG_MODES = new Set<WorldGraphTagMode>(["ANY", "ALL"]);
const WORLD_GRAPH_RELATION_DIRECTIONS =
  new Set<WorldGraphRelationDirection>([
    "ALL",
    "DIRECTED",
    "UNDIRECTED"
  ]);
const WORLD_GRAPH_LAYOUTS = new Set<WorldGraphLayout>(["cose", "preset"]);
const CANVAS_SORTS = new Set<CanvasSort>([
  "NAME_ASC",
  "NAME_DESC",
  "UPDATED_ASC",
  "UPDATED_DESC"
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
  const revision = requiredInteger(
    asRecord(response.metadata, `${label} metadata`),
    "revision",
    `${label} revision`
  );
  if (
    response.revision !== undefined &&
    requiredInteger(response, "revision", `${label} top-level revision`) !==
      revision
  ) {
    throw new Error(`The local core returned mismatched ${label} revisions`);
  }
  return revision;
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
  assertExactKeys(counts, ["volumes", "chapters", "scenes"], "snapshot node counts");
  return {
    volumes: requiredInteger(counts, "volumes"),
    chapters: requiredInteger(counts, "chapters"),
    scenes: requiredInteger(counts, "scenes")
  };
}

function parseSnapshotDiff(value: unknown): SnapshotDiffSummary {
  const summary = asRecord(value, "snapshot diff summary");
  const keys = [
    "added",
    "deleted",
    "renamed_nodes",
    "reordered_nodes",
    "changed_scene_bodies",
    "character_count_delta",
    "added_entities",
    "deleted_entities",
    "changed_entities",
    "added_tags",
    "deleted_tags",
    "changed_tags",
    "added_relation_types",
    "deleted_relation_types",
    "changed_relation_types",
    "added_relations",
    "deleted_relations",
    "changed_relations",
    "changed_scene_links",
    "changed_entity_notes",
    "added_canvases",
    "deleted_canvases",
    "changed_canvases",
    "canvas_node_count_delta",
    "canvas_edge_count_delta",
    "added_reader_presets",
    "deleted_reader_presets",
    "changed_reader_presets",
    "publication_metadata_changed",
    "cover_changed",
    "added_export_presets",
    "deleted_export_presets",
    "changed_export_presets"
  ] as const;
  assertExactKeys(summary, keys, "snapshot diff summary");
  const signedDelta = (key: string): number => {
    const value = requiredNumber(summary, key);
    if (!Number.isSafeInteger(value)) {
      throw new Error(`The local core returned invalid ${key}`);
    }
    return value;
  };
  return {
    added: parseSnapshotNodeCounts(summary.added),
    deleted: parseSnapshotNodeCounts(summary.deleted),
    renamedNodes: requiredInteger(summary, "renamed_nodes"),
    reorderedNodes: requiredInteger(summary, "reordered_nodes"),
    changedSceneBodies: requiredInteger(summary, "changed_scene_bodies"),
    characterCountDelta: signedDelta("character_count_delta"),
    addedEntities: requiredInteger(summary, "added_entities"),
    deletedEntities: requiredInteger(summary, "deleted_entities"),
    changedEntities: requiredInteger(summary, "changed_entities"),
    addedTags: requiredInteger(summary, "added_tags"),
    deletedTags: requiredInteger(summary, "deleted_tags"),
    changedTags: requiredInteger(summary, "changed_tags"),
    addedRelationTypes: requiredInteger(summary, "added_relation_types"),
    deletedRelationTypes: requiredInteger(summary, "deleted_relation_types"),
    changedRelationTypes: requiredInteger(summary, "changed_relation_types"),
    addedRelations: requiredInteger(summary, "added_relations"),
    deletedRelations: requiredInteger(summary, "deleted_relations"),
    changedRelations: requiredInteger(summary, "changed_relations"),
    changedSceneLinks: requiredInteger(summary, "changed_scene_links"),
    changedEntityNotes: requiredInteger(summary, "changed_entity_notes"),
    addedCanvases: requiredInteger(summary, "added_canvases"),
    deletedCanvases: requiredInteger(summary, "deleted_canvases"),
    changedCanvases: requiredInteger(summary, "changed_canvases"),
    canvasNodeCountDelta: signedDelta("canvas_node_count_delta"),
    canvasEdgeCountDelta: signedDelta("canvas_edge_count_delta"),
    addedReaderPresets: requiredInteger(summary, "added_reader_presets"),
    deletedReaderPresets: requiredInteger(summary, "deleted_reader_presets"),
    changedReaderPresets: requiredInteger(summary, "changed_reader_presets"),
    publicationMetadataChanged: requiredBoolean(
      summary,
      "publication_metadata_changed"
    ),
    coverChanged: requiredBoolean(summary, "cover_changed"),
    addedExportPresets: requiredInteger(summary, "added_export_presets"),
    deletedExportPresets: requiredInteger(summary, "deleted_export_presets"),
    changedExportPresets: requiredInteger(summary, "changed_export_presets")
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

function assertExactKeys(
  record: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
  label: string
): void {
  const allowed = new Set(allowedKeys);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new Error(`Invalid ${label}`);
  }
}

function assertRequiredExactKeys(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  label: string
): void {
  assertExactKeys(record, keys, label);
  if (keys.some((key) => !Object.hasOwn(record, key))) {
    throw new Error(`Invalid ${label}`);
  }
}

function parseBoundedCoreText(
  record: Readonly<Record<string, unknown>>,
  key: string,
  maximumLength: number,
  label: string,
  allowEmpty = false
): string {
  const value = record[key];
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.length > maximumLength
  ) {
    throw new Error(`The local core returned invalid ${label}`);
  }
  return value;
}

function parseCoreId(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string
): string {
  return parseBoundedCoreText(record, key, 128, label);
}

function parseRequiredNullableCoreText(
  record: Readonly<Record<string, unknown>>,
  key: string,
  maximumLength: number,
  label: string
): string | null {
  const value = record[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.length > maximumLength) {
    throw new Error(`The local core returned invalid ${label}`);
  }
  return value;
}

function parseWorldGraphTag(value: unknown): WorldGraphTag {
  const tag = asRecord(value, "world graph tag");
  assertExactKeys(tag, ["id", "name", "color_token"], "world graph tag");
  return {
    id: parseCoreId(tag, "id", "world graph tag id"),
    name: parseBoundedCoreText(tag, "name", 200, "world graph tag name"),
    colorToken: parseRequiredNullableCoreText(
      tag,
      "color_token",
      128,
      "world graph tag color token"
    )
  };
}

function parseWorldGraphNode(value: unknown): WorldGraphNode {
  const node = asRecord(value, "world graph node");
  assertExactKeys(
    node,
    [
      "id",
      "project_id",
      "label",
      "kind",
      "status",
      "summary",
      "color_token",
      "icon_key",
      "aliases",
      "tags",
      "explicit_scene_link_count",
      "outgoing_relation_count",
      "incoming_relation_count",
      "undirected_relation_count"
    ],
    "world graph node"
  );
  const aliases = requiredArray(
    node,
    "aliases",
    MAX_WORLD_GRAPH_ALIASES,
    "world graph aliases"
  ).map((alias) => {
    if (typeof alias !== "string" || alias.length === 0 || alias.length > 500) {
      throw new Error("The local core returned invalid world graph alias");
    }
    return alias;
  });
  if (new Set(aliases).size !== aliases.length) {
    throw new Error("The local core returned duplicate world graph aliases");
  }
  const tags = requiredArray(
    node,
    "tags",
    MAX_WORLD_GRAPH_NODES,
    "world graph tags"
  ).map(parseWorldGraphTag);
  if (new Set(tags.map((tag) => tag.id)).size !== tags.length) {
    throw new Error("The local core returned duplicate world graph tags");
  }
  return {
    id: parseCoreId(node, "id", "world graph node id"),
    projectId: parseCoreId(
      node,
      "project_id",
      "world graph node project id"
    ),
    label: parseBoundedCoreText(
      node,
      "label",
      500,
      "world graph node label"
    ),
    kind: parseEnum(node.kind, ENTITY_KINDS, "world graph entity kind"),
    status: parseEnum(
      node.status,
      ENTITY_STATUSES,
      "world graph entity status"
    ),
    summary: parseRequiredNullableCoreText(
      node,
      "summary",
      10_000,
      "world graph entity summary"
    ),
    colorToken: parseRequiredNullableCoreText(
      node,
      "color_token",
      128,
      "world graph entity color token"
    ),
    iconKey: parseRequiredNullableCoreText(
      node,
      "icon_key",
      128,
      "world graph entity icon key"
    ),
    aliases,
    tags,
    explicitSceneLinkCount: requiredInteger(
      node,
      "explicit_scene_link_count"
    ),
    outgoingRelationCount: requiredInteger(
      node,
      "outgoing_relation_count"
    ),
    incomingRelationCount: requiredInteger(
      node,
      "incoming_relation_count"
    ),
    undirectedRelationCount: requiredInteger(
      node,
      "undirected_relation_count"
    )
  };
}

function parseWorldGraphEdge(value: unknown): WorldGraphEdge {
  const edge = asRecord(value, "world graph edge");
  assertExactKeys(
    edge,
    [
      "id",
      "project_id",
      "source_entity_id",
      "target_entity_id",
      "relation_type_id",
      "forward_label",
      "inverse_label",
      "directed",
      "color_token",
      "note"
    ],
    "world graph edge"
  );
  return {
    id: parseCoreId(edge, "id", "world graph edge id"),
    projectId: parseCoreId(
      edge,
      "project_id",
      "world graph edge project id"
    ),
    sourceEntityId: parseCoreId(
      edge,
      "source_entity_id",
      "world graph edge source entity id"
    ),
    targetEntityId: parseCoreId(
      edge,
      "target_entity_id",
      "world graph edge target entity id"
    ),
    relationTypeId: parseCoreId(
      edge,
      "relation_type_id",
      "world graph edge relation type id"
    ),
    forwardLabel: parseBoundedCoreText(
      edge,
      "forward_label",
      200,
      "world graph edge label"
    ),
    inverseLabel: parseRequiredNullableCoreText(
      edge,
      "inverse_label",
      200,
      "world graph edge inverse label"
    ),
    directed: requiredBoolean(edge, "directed"),
    colorToken: parseRequiredNullableCoreText(
      edge,
      "color_token",
      128,
      "world graph edge color token"
    ),
    note: parseRequiredNullableCoreText(
      edge,
      "note",
      10_000,
      "world graph edge note"
    )
  };
}

function parseWorldGraphRelationTypeCount(
  value: unknown
): WorldGraphRelationTypeCount {
  const count = asRecord(value, "world graph relation type count");
  assertExactKeys(
    count,
    [
      "relation_type_id",
      "name",
      "inverse_name",
      "directed",
      "color_token",
      "is_builtin",
      "count"
    ],
    "world graph relation type count"
  );
  return {
    relationTypeId: parseCoreId(
      count,
      "relation_type_id",
      "world graph relation type id"
    ),
    name: parseBoundedCoreText(
      count,
      "name",
      200,
      "world graph relation type name"
    ),
    inverseName: parseRequiredNullableCoreText(
      count,
      "inverse_name",
      200,
      "world graph relation type inverse name"
    ),
    directed: requiredBoolean(count, "directed"),
    colorToken: parseRequiredNullableCoreText(
      count,
      "color_token",
      128,
      "world graph relation type color token"
    ),
    isBuiltin: requiredBoolean(count, "is_builtin"),
    count: requiredInteger(count, "count")
  };
}

function parseWorldGraphStats(value: unknown): WorldGraphStats {
  const stats = asRecord(value, "world graph stats");
  assertExactKeys(
    stats,
    [
      "entity_count",
      "relation_count",
      "entity_kind_counts",
      "relation_type_counts",
      "top_degree_entities",
      "isolated_entity_count",
      "directed_relation_count",
      "undirected_relation_count"
    ],
    "world graph stats"
  );
  const entityKindCounts = requiredArray(
    stats,
    "entity_kind_counts",
    ENTITY_KINDS.size,
    "world graph entity kind counts"
  ).map((value, index) => {
    const count = asRecord(value, "world graph entity kind count");
    assertExactKeys(count, ["kind", "count"], "world graph entity kind count");
    const kind = parseEnum(
      count.kind,
      ENTITY_KINDS,
      "world graph entity kind count kind"
    );
    if (kind !== [...ENTITY_KINDS][index]) {
      throw new Error("The local core returned unordered entity kind counts");
    }
    return { kind, count: requiredInteger(count, "count") };
  });
  if (entityKindCounts.length !== ENTITY_KINDS.size) {
    throw new Error("The local core returned incomplete entity kind counts");
  }
  const relationTypeCounts = requiredArray(
    stats,
    "relation_type_counts",
    MAX_WORLD_GRAPH_RELATION_TYPES,
    "world graph relation type counts"
  ).map(parseWorldGraphRelationTypeCount);
  if (
    new Set(relationTypeCounts.map((count) => count.relationTypeId)).size !==
    relationTypeCounts.length
  ) {
    throw new Error("The local core returned duplicate relation type counts");
  }
  const topDegreeEntities: readonly WorldGraphTopDegreeEntity[] = requiredArray(
    stats,
    "top_degree_entities",
    5,
    "world graph top degree entities"
  ).map((value) => {
    const entity = asRecord(value, "world graph top degree entity");
    assertExactKeys(
      entity,
      ["entity_id", "label", "degree"],
      "world graph top degree entity"
    );
    const degree = requiredInteger(entity, "degree");
    if (degree === 0) {
      throw new Error("The local core returned an isolated top degree entity");
    }
    return {
      entityId: parseCoreId(
        entity,
        "entity_id",
        "world graph top degree entity id"
      ),
      label: parseBoundedCoreText(
        entity,
        "label",
        500,
        "world graph top degree entity label"
      ),
      degree
    };
  });
  if (
    new Set(topDegreeEntities.map((entity) => entity.entityId)).size !==
      topDegreeEntities.length ||
    topDegreeEntities.some(
      (entity, index) =>
        index > 0 && topDegreeEntities[index - 1]!.degree < entity.degree
    )
  ) {
    throw new Error("The local core returned invalid top degree entities");
  }
  const parsed: WorldGraphStats = {
    entityCount: requiredInteger(stats, "entity_count"),
    relationCount: requiredInteger(stats, "relation_count"),
    entityKindCounts,
    relationTypeCounts,
    topDegreeEntities,
    isolatedEntityCount: requiredInteger(stats, "isolated_entity_count"),
    directedRelationCount: requiredInteger(stats, "directed_relation_count"),
    undirectedRelationCount: requiredInteger(
      stats,
      "undirected_relation_count"
    )
  };
  if (
    parsed.entityCount > MAX_WORLD_GRAPH_NODES ||
    parsed.relationCount > MAX_WORLD_GRAPH_EDGES ||
    parsed.isolatedEntityCount > parsed.entityCount ||
    parsed.directedRelationCount + parsed.undirectedRelationCount !==
      parsed.relationCount ||
    entityKindCounts.reduce((sum, item) => sum + item.count, 0) !==
      parsed.entityCount ||
    relationTypeCounts.reduce((sum, item) => sum + item.count, 0) !==
      parsed.relationCount
  ) {
    throw new Error("The local core returned inconsistent world graph stats");
  }
  return parsed;
}

function parseWorldGraphDiagnostic(value: unknown): WorldGraphDiagnostic {
  const diagnostic = asRecord(value, "world graph diagnostic");
  assertExactKeys(
    diagnostic,
    ["code", "severity", "record_id", "message"],
    "world graph diagnostic"
  );
  const recordId = diagnostic.record_id;
  return {
    code: parseEnum(
      diagnostic.code,
      WORLD_GRAPH_DIAGNOSTIC_CODES,
      "world graph diagnostic code"
    ),
    severity: parseEnum(
      diagnostic.severity,
      WORLD_GRAPH_DIAGNOSTIC_SEVERITIES,
      "world graph diagnostic severity"
    ),
    recordId:
      recordId === null
        ? null
        : parseCoreId(diagnostic, "record_id", "world graph diagnostic record id"),
    message: parseBoundedCoreText(
      diagnostic,
      "message",
      2_000,
      "world graph diagnostic message"
    )
  };
}

function parseWorldGraphDiagnostics(
  record: Readonly<Record<string, unknown>>
): readonly WorldGraphDiagnostic[] {
  return requiredArray(
    record,
    "diagnostics",
    MAX_WORLD_GRAPH_DIAGNOSTICS,
    "world graph diagnostics"
  ).map(parseWorldGraphDiagnostic);
}

function validateWorldGraphRevision(
  response: Readonly<Record<string, unknown>>,
  sessionRevision: number
): number {
  const revision = requiredInteger(response, "revision", "world graph revision");
  if (revision < sessionRevision) {
    throw new Error("The local core returned a stale world graph response");
  }
  return revision;
}

function parseWorldGraphReadModel(
  value: unknown,
  expectedProjectId: string,
  sessionRevision: number
): WorldGraphReadModel {
  const response = asRecord(value, "world graph response");
  assertExactKeys(
    response,
    ["project_id", "revision", "nodes", "edges", "stats", "diagnostics"],
    "world graph response"
  );
  const projectId = parseCoreId(response, "project_id", "world graph project id");
  if (projectId !== expectedProjectId) {
    throw new Error("The local core returned a cross-project world graph");
  }
  const nodes = requiredArray(
    response,
    "nodes",
    MAX_WORLD_GRAPH_NODES,
    "world graph nodes"
  ).map(parseWorldGraphNode);
  const edges = requiredArray(
    response,
    "edges",
    MAX_WORLD_GRAPH_EDGES,
    "world graph edges"
  ).map(parseWorldGraphEdge);
  const stats = parseWorldGraphStats(response.stats);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edgeIds = new Set(edges.map((edge) => edge.id));
  const undirectedKeys = edges
    .filter((edge) => !edge.directed)
    .map((edge) => {
      const [left, right] = [edge.sourceEntityId, edge.targetEntityId].sort();
      return `${edge.relationTypeId}\u0000${left}\u0000${right}`;
    });
  const relationTypes = new Map(
    stats.relationTypeCounts.map((count) => [count.relationTypeId, count])
  );
  const aggregateAliasCount = nodes.reduce(
    (sum, node) => sum + node.aliases.length,
    0
  );
  const aggregateTagCount = nodes.reduce((sum, node) => sum + node.tags.length, 0);
  const aggregateSceneLinkCount = nodes.reduce(
    (sum, node) => sum + node.explicitSceneLinkCount,
    0
  );
  if (
    nodeIds.size !== nodes.length ||
    edgeIds.size !== edges.length ||
    new Set(undirectedKeys).size !== undirectedKeys.length ||
    aggregateAliasCount > MAX_WORLD_GRAPH_ALIASES ||
    aggregateTagCount > MAX_WORLD_GRAPH_EDGES ||
    aggregateSceneLinkCount > MAX_WORLD_GRAPH_SCENE_LINKS ||
    nodes.some((node) => node.projectId !== projectId) ||
    edges.some(
      (edge) =>
        edge.projectId !== projectId ||
        edge.sourceEntityId === edge.targetEntityId ||
        !nodeIds.has(edge.sourceEntityId) ||
        !nodeIds.has(edge.targetEntityId)
    ) ||
    stats.entityCount !== nodes.length ||
    stats.relationCount !== edges.length
  ) {
    throw new Error("The local core returned an inconsistent world graph");
  }
  for (const edge of edges) {
    const type = relationTypes.get(edge.relationTypeId);
    if (
      !type ||
      type.name !== edge.forwardLabel ||
      type.inverseName !== edge.inverseLabel ||
      type.directed !== edge.directed ||
      type.colorToken !== edge.colorToken
    ) {
      throw new Error("The local core returned inconsistent graph edge metadata");
    }
  }
  for (const kindCount of stats.entityKindCounts) {
    if (nodes.filter((node) => node.kind === kindCount.kind).length !== kindCount.count) {
      throw new Error("The local core returned inconsistent graph kind counts");
    }
  }
  for (const typeCount of stats.relationTypeCounts) {
    if (
      edges.filter((edge) => edge.relationTypeId === typeCount.relationTypeId)
        .length !== typeCount.count
    ) {
      throw new Error("The local core returned inconsistent graph relation counts");
    }
  }
  for (const node of nodes) {
    const outgoing = edges.filter(
      (edge) => edge.directed && edge.sourceEntityId === node.id
    ).length;
    const incoming = edges.filter(
      (edge) => edge.directed && edge.targetEntityId === node.id
    ).length;
    const undirected = edges.filter(
      (edge) =>
        !edge.directed &&
        (edge.sourceEntityId === node.id || edge.targetEntityId === node.id)
    ).length;
    if (
      node.outgoingRelationCount !== outgoing ||
      node.incomingRelationCount !== incoming ||
      node.undirectedRelationCount !== undirected
    ) {
      throw new Error("The local core returned inconsistent graph node degrees");
    }
  }
  const positiveDegrees = nodes
    .map((node) => ({
      entityId: node.id,
      label: node.label,
      degree:
        node.outgoingRelationCount +
        node.incomingRelationCount +
        node.undirectedRelationCount
    }))
    .filter((entity) => entity.degree > 0)
    .sort((left, right) => right.degree - left.degree);
  const topIds = new Set(
    stats.topDegreeEntities.map((entity) => entity.entityId)
  );
  const lowestTopDegree = stats.topDegreeEntities.at(-1)?.degree ?? 0;
  if (
    stats.topDegreeEntities.length !== Math.min(5, positiveDegrees.length) ||
    stats.topDegreeEntities.some((top) => {
      const node = positiveDegrees.find(
        (candidate) => candidate.entityId === top.entityId
      );
      return !node || node.label !== top.label || node.degree !== top.degree;
    }) ||
    positiveDegrees.some(
      (entity) => !topIds.has(entity.entityId) && entity.degree > lowestTopDegree
    )
  ) {
    throw new Error("The local core returned inconsistent top degree entities");
  }
  const isolated = nodes.filter(
    (node) =>
      node.outgoingRelationCount +
        node.incomingRelationCount +
        node.undirectedRelationCount ===
      0
  ).length;
  if (isolated !== stats.isolatedEntityCount) {
    throw new Error("The local core returned inconsistent isolated entity stats");
  }
  return {
    projectId,
    revision: validateWorldGraphRevision(response, sessionRevision),
    nodes,
    edges,
    stats,
    diagnostics: parseWorldGraphDiagnostics(response)
  };
}

function parseWorldGraphStatsResult(
  value: unknown,
  expectedProjectId: string,
  sessionRevision: number
): WorldGraphStatsResult {
  const response = asRecord(value, "world graph stats response");
  assertExactKeys(
    response,
    ["project_id", "revision", "stats", "diagnostics"],
    "world graph stats response"
  );
  const projectId = parseCoreId(
    response,
    "project_id",
    "world graph stats project id"
  );
  if (projectId !== expectedProjectId) {
    throw new Error("The local core returned cross-project graph stats");
  }
  return {
    projectId,
    revision: validateWorldGraphRevision(response, sessionRevision),
    stats: parseWorldGraphStats(response.stats),
    diagnostics: parseWorldGraphDiagnostics(response)
  };
}

function parseEntityGraphRelationDetail(
  value: unknown,
  expectedEntityId: string,
  expectedProjectId: string,
  expectedPerspective: EntityGraphRelationPerspective
): EntityGraphRelationDetail {
  const detail = asRecord(value, "entity graph relation detail");
  assertExactKeys(
    detail,
    ["edge", "counterpart_entity_id", "display_label", "perspective"],
    "entity graph relation detail"
  );
  const edge = parseWorldGraphEdge(detail.edge);
  const counterpartEntityId = parseCoreId(
    detail,
    "counterpart_entity_id",
    "entity graph counterpart id"
  );
  const perspective = parseEnum(
    detail.perspective,
    ENTITY_GRAPH_RELATION_PERSPECTIVES,
    "entity graph relation perspective"
  );
  const displayLabel = parseBoundedCoreText(
    detail,
    "display_label",
    200,
    "entity graph display label"
  );
  const expectedDisplayLabel =
    perspective === "INCOMING"
      ? (edge.inverseLabel ?? edge.forwardLabel)
      : edge.forwardLabel;
  const endpointsAreValid =
    perspective === "OUTGOING"
      ? edge.directed &&
        edge.sourceEntityId === expectedEntityId &&
        edge.targetEntityId === counterpartEntityId
      : perspective === "INCOMING"
        ? edge.directed &&
          edge.targetEntityId === expectedEntityId &&
          edge.sourceEntityId === counterpartEntityId
        : !edge.directed &&
          ((edge.sourceEntityId === expectedEntityId &&
            edge.targetEntityId === counterpartEntityId) ||
            (edge.targetEntityId === expectedEntityId &&
              edge.sourceEntityId === counterpartEntityId));
  if (
    edge.projectId !== expectedProjectId ||
    perspective !== expectedPerspective ||
    counterpartEntityId === expectedEntityId ||
    displayLabel !== expectedDisplayLabel ||
    !endpointsAreValid
  ) {
    throw new Error("The local core returned inconsistent entity graph detail");
  }
  return { edge, counterpartEntityId, displayLabel, perspective };
}

function parseEntityGraphDetail(
  value: unknown,
  expectedEntityId: string,
  expectedProjectId: string,
  sessionRevision: number
): EntityGraphDetail {
  const response = asRecord(value, "entity graph detail response");
  assertExactKeys(
    response,
    [
      "project_id",
      "revision",
      "entity",
      "outgoing_relations",
      "incoming_relations",
      "undirected_relations"
    ],
    "entity graph detail response"
  );
  const projectId = parseCoreId(
    response,
    "project_id",
    "entity graph detail project id"
  );
  if (projectId !== expectedProjectId) {
    throw new Error("The local core returned cross-project entity graph detail");
  }
  const entity = parseWorldGraphNode(response.entity);
  if (entity.id !== expectedEntityId || entity.projectId !== projectId) {
    throw new Error("The local core returned detail for another graph entity");
  }
  const parseRelations = (
    key: string,
    perspective: EntityGraphRelationPerspective
  ): readonly EntityGraphRelationDetail[] =>
    requiredArray(
      response,
      key,
      MAX_WORLD_GRAPH_EDGES,
      `entity graph ${key}`
    ).map((relation) =>
      parseEntityGraphRelationDetail(
        relation,
        expectedEntityId,
        projectId,
        perspective
      )
    );
  const outgoingRelations = parseRelations("outgoing_relations", "OUTGOING");
  const incomingRelations = parseRelations("incoming_relations", "INCOMING");
  const undirectedRelations = parseRelations(
    "undirected_relations",
    "UNDIRECTED"
  );
  const relations = [
    ...outgoingRelations,
    ...incomingRelations,
    ...undirectedRelations
  ];
  if (
    relations.length > MAX_WORLD_GRAPH_EDGES ||
    new Set(relations.map((relation) => relation.edge.id)).size !==
      relations.length ||
    entity.outgoingRelationCount !== outgoingRelations.length ||
    entity.incomingRelationCount !== incomingRelations.length ||
    entity.undirectedRelationCount !== undirectedRelations.length
  ) {
    throw new Error("The local core returned duplicate or incomplete graph detail");
  }
  return {
    projectId,
    revision: validateWorldGraphRevision(response, sessionRevision),
    entity,
    outgoingRelations,
    incomingRelations,
    undirectedRelations
  };
}

function parseEntitySceneContext(
  value: unknown,
  expectedEntityId: string,
  expectedProjectId: string,
  sessionRevision: number
): EntitySceneContext {
  const response = asRecord(value, "entity scene context response");
  assertExactKeys(
    response,
    ["project_id", "revision", "entity_id", "links"],
    "entity scene context response"
  );
  const projectId = parseCoreId(
    response,
    "project_id",
    "entity scene context project id"
  );
  const entityId = parseCoreId(
    response,
    "entity_id",
    "entity scene context entity id"
  );
  if (projectId !== expectedProjectId || entityId !== expectedEntityId) {
    throw new Error("The local core returned cross-project entity scene context");
  }
  const links = requiredArray(
    response,
    "links",
    MAX_WORLD_GRAPH_SCENE_LINKS,
    "entity scene context links"
  ).map((value) => {
    const link = asRecord(value, "entity scene context link");
    assertExactKeys(
      link,
      ["scene_node_id", "scene_title", "role", "note"],
      "entity scene context link"
    );
    return {
      sceneNodeId: parseCoreId(
        link,
        "scene_node_id",
        "entity scene context scene id"
      ),
      sceneTitle: parseBoundedCoreText(
        link,
        "scene_title",
        500,
        "entity scene context scene title"
      ),
      role: parseEnum(
        link.role,
        SCENE_ENTITY_ROLES,
        "entity scene context role"
      ),
      note: parseRequiredNullableCoreText(
        link,
        "note",
        10_000,
        "entity scene context note"
      )
    };
  });
  if (
    new Set(links.map((link) => `${link.sceneNodeId}\u0000${link.role}`)).size !==
    links.length
  ) {
    throw new Error("The local core returned duplicate entity scene links");
  }
  return {
    projectId,
    revision: validateWorldGraphRevision(response, sessionRevision),
    entityId,
    links
  };
}

function validateWorldGraphPoint(value: unknown, label: string): WorldGraphPoint {
  const point = asRecord(value, label);
  assertExactKeys(point, ["x", "y"], label);
  const x = requiredNumber(point, "x", `${label} x`);
  const y = requiredNumber(point, "y", `${label} y`);
  if (
    Math.abs(x) > MAX_WORLD_GRAPH_COORDINATE ||
    Math.abs(y) > MAX_WORLD_GRAPH_COORDINATE
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return { x, y };
}

function validateNullableGraphEntityId(value: unknown, label: string): string | null {
  return value === null ? null : validateNodeId(value, label);
}

function validateRequiredEnumArray<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  label: string
): readonly T[] {
  const parsed = validateEnumArray(value, allowed, label);
  if (!parsed) {
    throw new Error(`${label} is required`);
  }
  return parsed;
}

function validateRequiredStringArray(
  value: unknown,
  label: string,
  maximumItems: number
): readonly string[] {
  const parsed = validateStringArray(value, label, maximumItems);
  if (!parsed) {
    throw new Error(`${label} is required`);
  }
  return parsed;
}

function validateWorldGraphUiState(value: unknown): WorldGraphUiState {
  const state = asRecord(value, "world graph UI state");
  assertExactKeys(
    state,
    [
      "mode",
      "focusedEntityId",
      "depth",
      "filters",
      "layout",
      "viewport",
      "nodePositions",
      "selectedEntityId"
    ],
    "world graph UI state"
  );
  const mode = validateEnum(state.mode, WORLD_GRAPH_MODES, "world graph mode");
  const focusedEntityId = validateNullableGraphEntityId(
    state.focusedEntityId,
    "Focused graph entity id"
  );
  if (mode === "FOCUSED" && focusedEntityId === null) {
    throw new Error("Focused graph mode requires an entity");
  }
  if (
    !Number.isSafeInteger(state.depth) ||
    (state.depth !== 1 && state.depth !== 2 && state.depth !== 3)
  ) {
    throw new Error("Invalid world graph depth");
  }
  const filters = asRecord(state.filters, "world graph filters");
  assertExactKeys(
    filters,
    [
      "kinds",
      "statuses",
      "tagIds",
      "tagMode",
      "relationTypeIds",
      "relationDirection",
      "showIsolated",
      "showLabels"
    ],
    "world graph filters"
  );
  if (
    typeof filters.showIsolated !== "boolean" ||
    typeof filters.showLabels !== "boolean"
  ) {
    throw new Error("Invalid world graph filter flags");
  }
  const parsedFilters: WorldGraphFilterState = {
    kinds: validateRequiredEnumArray(
      filters.kinds,
      ENTITY_KINDS,
      "world graph entity kinds"
    ),
    statuses: validateRequiredEnumArray(
      filters.statuses,
      ENTITY_STATUSES,
      "world graph entity statuses"
    ),
    tagIds: validateRequiredStringArray(
      filters.tagIds,
      "world graph tag ids",
      MAX_WORLD_GRAPH_NODES
    ),
    tagMode: validateEnum(
      filters.tagMode,
      WORLD_GRAPH_TAG_MODES,
      "world graph tag mode"
    ),
    relationTypeIds: validateRequiredStringArray(
      filters.relationTypeIds,
      "world graph relation type ids",
      MAX_WORLD_GRAPH_RELATION_TYPES
    ),
    relationDirection: validateEnum(
      filters.relationDirection,
      WORLD_GRAPH_RELATION_DIRECTIONS,
      "world graph relation direction"
    ),
    showIsolated: filters.showIsolated,
    showLabels: filters.showLabels
  };
  const layout = validateEnum(
    state.layout,
    WORLD_GRAPH_LAYOUTS,
    "world graph layout"
  );
  const viewport = asRecord(state.viewport, "world graph viewport");
  assertExactKeys(viewport, ["zoom", "pan"], "world graph viewport");
  const zoom = requiredNumber(viewport, "zoom", "world graph zoom");
  if (zoom < 0.05 || zoom > 10) {
    throw new Error("Invalid world graph zoom");
  }
  const nodePositions = asRecord(
    state.nodePositions,
    "world graph node positions"
  );
  const positionEntries = Object.entries(nodePositions);
  if (positionEntries.length > MAX_WORLD_GRAPH_NODES) {
    throw new Error("Invalid world graph node positions");
  }
  const parsedPositions = Object.fromEntries(
    positionEntries.map(([entityId, point]) => [
      validateNodeId(entityId, "Positioned entity id"),
      validateWorldGraphPoint(point, "world graph node position")
    ])
  );
  if (Object.keys(parsedPositions).length !== positionEntries.length) {
    throw new Error("Invalid duplicate world graph node positions");
  }
  return {
    mode,
    focusedEntityId,
    depth: state.depth as WorldGraphDepth,
    filters: parsedFilters,
    layout,
    viewport: {
      zoom,
      pan: validateWorldGraphPoint(viewport.pan, "world graph viewport pan")
    },
    nodePositions: parsedPositions,
    selectedEntityId: validateNullableGraphEntityId(
      state.selectedEntityId,
      "Selected graph entity id"
    )
  };
}

function serializeWorldGraphUiState(
  state: WorldGraphUiState
): Readonly<Record<string, unknown>> {
  return {
    mode: state.mode,
    focused_entity_id: state.focusedEntityId,
    depth: state.depth,
    filters: {
      kinds: state.filters.kinds,
      statuses: state.filters.statuses,
      tag_ids: state.filters.tagIds,
      tag_mode: state.filters.tagMode,
      relation_type_ids: state.filters.relationTypeIds,
      relation_direction: state.filters.relationDirection,
      show_isolated: state.filters.showIsolated,
      show_labels: state.filters.showLabels
    },
    layout: state.layout,
    viewport: {
      zoom: state.viewport.zoom,
      pan: state.viewport.pan
    },
    node_positions: state.nodePositions,
    selected_entity_id: state.selectedEntityId
  };
}

function parseSavedWorldGraphUiState(value: unknown): WorldGraphUiState {
  const state = asRecord(value, "saved world graph UI state");
  assertExactKeys(
    state,
    [
      "mode",
      "focused_entity_id",
      "depth",
      "filters",
      "layout",
      "viewport",
      "node_positions",
      "selected_entity_id"
    ],
    "saved world graph UI state"
  );
  const filters = asRecord(state.filters, "saved world graph filters");
  assertExactKeys(
    filters,
    [
      "kinds",
      "statuses",
      "tag_ids",
      "tag_mode",
      "relation_type_ids",
      "relation_direction",
      "show_isolated",
      "show_labels"
    ],
    "saved world graph filters"
  );
  return validateWorldGraphUiState({
    mode: state.mode,
    focusedEntityId: state.focused_entity_id,
    depth: state.depth,
    filters: {
      kinds: filters.kinds,
      statuses: filters.statuses,
      tagIds: filters.tag_ids,
      tagMode: filters.tag_mode,
      relationTypeIds: filters.relation_type_ids,
      relationDirection: filters.relation_direction,
      showIsolated: filters.show_isolated,
      showLabels: filters.show_labels
    },
    layout: state.layout,
    viewport: state.viewport,
    nodePositions: state.node_positions,
    selectedEntityId: state.selected_entity_id
  });
}

function parseWorldGraphUiStateRecord(
  value: unknown,
  expectedProjectId: string
): WorldGraphUiState {
  const record = asRecord(value, "world graph UI state record");
  assertExactKeys(
    record,
    ["project_id", "key", "value", "updated_at"],
    "world graph UI state record"
  );
  if (
    parseCoreId(record, "project_id", "world graph UI state project id") !==
      expectedProjectId ||
    parseBoundedCoreText(
      record,
      "key",
      128,
      "world graph UI state key"
    ) !== WORLD_GRAPH_UI_STATE_KEY
  ) {
    throw new Error("The local core returned cross-project graph UI state");
  }
  parseBoundedCoreText(
    record,
    "updated_at",
    128,
    "world graph UI state timestamp"
  );
  return parseSavedWorldGraphUiState(record.value);
}

function worldGraphUiStateMatches(
  stored: WorldGraphUiState,
  requested: WorldGraphUiState
): boolean {
  const sameNumber = (left: number, right: number): boolean =>
    Math.abs(left - right) <= WORLD_GRAPH_UI_STATE_NUMBER_TOLERANCE;
  const samePoint = (left: WorldGraphPoint, right: WorldGraphPoint): boolean =>
    sameNumber(left.x, right.x) && sameNumber(left.y, right.y);
  const sameArray = <T>(left: readonly T[], right: readonly T[]): boolean =>
    left.length === right.length &&
    left.every((value, index) => value === right[index]);
  const storedPositionEntries = Object.entries(stored.nodePositions);
  const requestedPositionEntries = Object.entries(requested.nodePositions);
  if (
    stored.mode !== requested.mode ||
    stored.focusedEntityId !== requested.focusedEntityId ||
    stored.depth !== requested.depth ||
    stored.layout !== requested.layout ||
    stored.selectedEntityId !== requested.selectedEntityId ||
    stored.filters.tagMode !== requested.filters.tagMode ||
    stored.filters.relationDirection !== requested.filters.relationDirection ||
    stored.filters.showIsolated !== requested.filters.showIsolated ||
    stored.filters.showLabels !== requested.filters.showLabels ||
    !sameArray(stored.filters.kinds, requested.filters.kinds) ||
    !sameArray(stored.filters.statuses, requested.filters.statuses) ||
    !sameArray(stored.filters.tagIds, requested.filters.tagIds) ||
    !sameArray(
      stored.filters.relationTypeIds,
      requested.filters.relationTypeIds
    ) ||
    !sameNumber(stored.viewport.zoom, requested.viewport.zoom) ||
    !samePoint(stored.viewport.pan, requested.viewport.pan) ||
    storedPositionEntries.length !== requestedPositionEntries.length
  ) {
    return false;
  }
  return requestedPositionEntries.every(([entityId, position]) => {
    const storedPosition = stored.nodePositions[entityId];
    return storedPosition !== undefined && samePoint(storedPosition, position);
  });
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

function validateCanvasId(value: unknown, label = "Canvas id"): string {
  return validateShortText(value, label, 128);
}

function validateCanvasRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("Invalid canvas revision");
  }
  return value as number;
}

function validateCanvasDocument(value: unknown): MadiCanvasDocument {
  const document = asRecord(value, "JSON Canvas document");
  if (!Array.isArray(document.nodes) || !Array.isArray(document.edges)) {
    throw new Error("JSON Canvas requires nodes and edges arrays");
  }
  if (
    document.nodes.length > MAX_CANVAS_NODES ||
    document.edges.length > MAX_CANVAS_EDGES
  ) {
    throw new Error("JSON Canvas exceeds the supported element limit");
  }
  for (const nodeValue of document.nodes) {
    const node = asRecord(nodeValue, "JSON Canvas node");
    validateCanvasId(node.id, "Canvas node id");
    if (node.type !== "text" && node.type !== "group") {
      throw new Error("Only text and group JSON Canvas nodes are supported");
    }
    for (const key of ["x", "y", "width", "height"] as const) {
      const maximum = key === "x" || key === "y" ? 10_000_000 : 100_000;
      if (
        typeof node[key] !== "number" ||
        !Number.isSafeInteger(node[key]) ||
        Math.abs(node[key] as number) > maximum
      ) {
        throw new Error(`Invalid JSON Canvas node ${key}`);
      }
    }
    if ((node.width as number) <= 0 || (node.height as number) <= 0) {
      throw new Error("JSON Canvas node dimensions must be positive");
    }
  }
  for (const edgeValue of document.edges) {
    const edge = asRecord(edgeValue, "JSON Canvas edge");
    validateCanvasId(edge.id, "Canvas edge id");
    validateCanvasId(edge.fromNode, "Canvas edge source id");
    validateCanvasId(edge.toNode, "Canvas edge target id");
  }
  let encoded: string;
  try {
    encoded = JSON.stringify(document);
  } catch {
    throw new Error("JSON Canvas document is not serializable");
  }
  if (Buffer.byteLength(encoded, "utf8") > MAX_CANVAS_FILE_BYTES) {
    throw new Error("JSON Canvas document is too large");
  }
  return document as unknown as MadiCanvasDocument;
}

function parseCanvasDescription(
  record: Readonly<Record<string, unknown>>
): string | null {
  const value = record.description;
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.length > 20_000) {
    throw new Error("The local core returned invalid canvas description");
  }
  return value;
}

function parseCanvasSummary(
  value: unknown,
  expectedProjectId: string
): CanvasSummary {
  const canvas = asRecord(value, "canvas");
  const projectId = requiredString(canvas, "project_id", "canvas project id");
  if (projectId !== expectedProjectId) {
    throw new Error("The local core returned a cross-project canvas");
  }
  if (
    requiredString(canvas, "document_format") !== "JSON_CANVAS" ||
    requiredString(canvas, "document_version") !== "1.0"
  ) {
    throw new Error("The local core returned an unsupported canvas format");
  }
  const nodeCount = requiredInteger(canvas, "node_count");
  const edgeCount = requiredInteger(canvas, "edge_count");
  if (nodeCount > MAX_CANVAS_NODES || edgeCount > MAX_CANVAS_EDGES) {
    throw new Error("The local core returned an oversized canvas");
  }
  return {
    id: requiredString(canvas, "id", "canvas id"),
    projectId,
    name: requiredString(canvas, "name", "canvas name"),
    description: parseCanvasDescription(canvas),
    documentFormat: "JSON_CANVAS",
    documentVersion: "1.0",
    contentHash: validateSha256(canvas.content_hash, "canvas content hash"),
    revision: requiredInteger(canvas, "revision", "canvas revision"),
    nodeCount,
    edgeCount,
    createdAt: requiredString(canvas, "created_at"),
    updatedAt: requiredString(canvas, "updated_at")
  };
}

function parseCanvasRecord(
  value: unknown,
  expectedProjectId: string
): CanvasRecord {
  const canvas = asRecord(value, "canvas record");
  return {
    ...parseCanvasSummary(canvas, expectedProjectId),
    document: validateCanvasDocument(canvas.document)
  };
}

function validatePlotCanvasUiState(value: unknown): PlotCanvasUiState {
  const state = asRecord(value, "plot canvas UI state");
  const lastCanvasId =
    state.lastCanvasId === null
      ? null
      : validateCanvasId(state.lastCanvasId, "Last canvas id");
  const states = asRecord(state.canvasStates, "plot canvas view states");
  const entries = Object.entries(states);
  if (entries.length > 1_000) {
    throw new Error("Too many plot canvas UI states");
  }
  const canvasStates: Record<string, PlotCanvasUiState["canvasStates"][string]> = {};
  for (const [canvasIdValue, viewValue] of entries) {
    const canvasId = validateCanvasId(canvasIdValue, "Canvas UI state id");
    const view = asRecord(viewValue, "plot canvas view state");
    const viewport = asRecord(view.viewport, "plot canvas viewport");
    const x = requiredNumber(viewport, "x");
    const y = requiredNumber(viewport, "y");
    const zoom = requiredNumber(viewport, "zoom");
    const inspectorWidth = requiredNumber(view, "inspectorWidth");
    if (
      Math.abs(x) > 10_000_000 ||
      Math.abs(y) > 10_000_000 ||
      zoom < 0.02 ||
      zoom > 10 ||
      inspectorWidth < 240 ||
      inspectorWidth > 720 ||
      typeof view.showGrid !== "boolean" ||
      typeof view.showMinimap !== "boolean" ||
      typeof view.snapToGrid !== "boolean"
    ) {
      throw new Error("Invalid plot canvas UI state");
    }
    canvasStates[canvasId] = {
      viewport: { x, y, zoom },
      selectedElementId:
        view.selectedElementId === null
          ? null
          : validateCanvasId(view.selectedElementId, "Selected canvas element id"),
      inspectorWidth,
      showGrid: view.showGrid,
      showMinimap: view.showMinimap,
      snapToGrid: view.snapToGrid
    };
  }
  return { lastCanvasId, canvasStates };
}

function serializePlotCanvasUiState(
  state: PlotCanvasUiState
): Readonly<Record<string, unknown>> {
  return {
    last_canvas_id: state.lastCanvasId,
    canvas_states: Object.fromEntries(
      Object.entries(state.canvasStates).map(([canvasId, view]) => [
        canvasId,
        {
          viewport: view.viewport,
          selected_element_id: view.selectedElementId,
          inspector_width: view.inspectorWidth,
          show_grid: view.showGrid,
          show_minimap: view.showMinimap,
          snap_to_grid: view.snapToGrid
        }
      ])
    )
  };
}

function parseSavedPlotCanvasUiState(value: unknown): PlotCanvasUiState {
  const state = asRecord(value, "saved plot canvas UI state");
  const storedStates = asRecord(state.canvas_states, "saved plot canvas states");
  return validatePlotCanvasUiState({
    lastCanvasId: state.last_canvas_id,
    canvasStates: Object.fromEntries(
      Object.entries(storedStates).map(([canvasId, viewValue]) => {
        const view = asRecord(viewValue, "saved plot canvas view state");
        return [
          canvasId,
          {
            viewport: view.viewport,
            selectedElementId: view.selected_element_id,
            inspectorWidth: view.inspector_width,
            showGrid: view.show_grid,
            showMinimap: view.show_minimap,
            snapToGrid: view.snap_to_grid
          }
        ];
      })
    )
  });
}

function parsePlotCanvasUiStateRecord(
  value: unknown,
  expectedProjectId: string
): PlotCanvasUiState {
  const record = asRecord(value, "plot canvas UI state record");
  if (
    requiredString(record, "project_id") !== expectedProjectId ||
    requiredString(record, "key") !== PLOT_CANVAS_UI_STATE_KEY
  ) {
    throw new Error("The local core returned cross-project canvas UI state");
  }
  requiredString(record, "updated_at");
  return parseSavedPlotCanvasUiState(record.value);
}

function safeCanvasFileName(value: unknown): string {
  const raw = typeof value === "string" && value.trim() ? value.trim() : "새 캔버스";
  const baseName = path.basename(raw).replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_");
  const limited = (baseName || "새 캔버스").slice(0, 180);
  return limited.toLocaleLowerCase().endsWith(".canvas")
    ? limited
    : `${limited}.canvas`;
}

function canonicalCanvasJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalCanvasJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalCanvasJson(record[key])}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new Error("Canvas contains a non-JSON value");
  }
  return encoded;
}

function parsePublicationDiagnostic(value: unknown): PublicationDiagnostic {
  const diagnostic = asRecord(value, "publication diagnostic");
  const diagnosticKeys = [
    "code",
    "severity",
    "scene_node_id",
    "document_id",
    "block_id"
  ] as const;
  assertExactKeys(
    diagnostic,
    diagnosticKeys,
    "publication diagnostic"
  );
  if (diagnosticKeys.some((key) => !Object.hasOwn(diagnostic, key))) {
    throw new Error("The local core omitted a publication diagnostic field");
  }
  return {
    code: parseEnum(
      diagnostic.code,
      PUBLICATION_DIAGNOSTIC_CODES,
      "publication diagnostic code"
    ),
    severity: parseEnum(
      diagnostic.severity,
      PUBLICATION_DIAGNOSTIC_SEVERITIES,
      "publication diagnostic severity"
    ),
    sceneNodeId: optionalNullableText(diagnostic, "scene_node_id"),
    documentId: optionalNullableText(diagnostic, "document_id"),
    blockId: optionalNullableText(diagnostic, "block_id")
  };
}

function parsePublicationDiagnostics(value: unknown): PublicationDiagnostic[] {
  if (!Array.isArray(value) || value.length > 100_000) {
    throw new Error("The local core returned invalid publication diagnostics");
  }
  return value.map(parsePublicationDiagnostic);
}

function parsePublicationSourceStatistics(
  value: unknown
): PublicationSourceStatistics {
  const stats = asRecord(value, "publication source statistics");
  assertExactKeys(
    stats,
    ["withSpaces", "withoutSpaces", "paragraphCount", "sceneCount", "chapterCount"],
    "publication source statistics"
  );
  return {
    withSpaces: requiredInteger(stats, "withSpaces"),
    withoutSpaces: requiredInteger(stats, "withoutSpaces"),
    paragraphCount: requiredInteger(stats, "paragraphCount"),
    sceneCount: requiredInteger(stats, "sceneCount"),
    chapterCount: requiredInteger(stats, "chapterCount")
  };
}

function parseReaderPreset(
  value: unknown,
  expectedProjectId: string,
  validateConfig: (value: unknown) => ReaderRenderConfig
): ReaderPresetRecord {
  const preset = asRecord(value, "reader preset");
  const presetKeys = [
    "id",
    "project_id",
    "name",
    "source_kind",
    "source_id",
    "source_version",
    "verification_status",
    "preset_format",
    "preset_version",
    "preset_json",
    "content_hash",
    "revision",
    "created_at",
    "updated_at"
  ] as const;
  assertExactKeys(
    preset,
    presetKeys,
    "reader preset"
  );
  if (presetKeys.some((key) => !Object.hasOwn(preset, key))) {
    throw new Error("The local core omitted a reader preset field");
  }
  const projectId = requiredString(preset, "project_id");
  if (projectId !== expectedProjectId) {
    throw new Error("The local core returned a cross-project reader preset");
  }
  const presetFormat = requiredString(preset, "preset_format");
  const presetVersion = requiredInteger(preset, "preset_version");
  if (presetFormat !== "MADI_READER_PRESET" || presetVersion !== 1) {
    throw new Error("The local core returned an unsupported reader preset");
  }
  const verificationStatus = parseEnum(
    preset.verification_status,
    READER_VERIFICATION_STATUSES,
    "reader preset verification status"
  );
  const config = validateConfig(preset.preset_json);
  if (config.platform.verificationStatus !== verificationStatus) {
    throw new Error(
      "The local core returned inconsistent reader preset verification status"
    );
  }
  return {
    id: requiredString(preset, "id"),
    projectId,
    name: requiredString(preset, "name"),
    sourceKind: parseEnum(
      preset.source_kind,
      READER_PRESET_SOURCE_KINDS,
      "reader preset source kind"
    ),
    sourceId: optionalNullableText(preset, "source_id"),
    sourceVersion: optionalNullableText(preset, "source_version"),
    verificationStatus,
    presetFormat: "MADI_READER_PRESET",
    presetVersion: 1,
    config,
    contentHash: validateSha256(preset.content_hash, "reader preset hash"),
    revision: requiredInteger(preset, "revision"),
    createdAt: requiredString(preset, "created_at"),
    updatedAt: requiredString(preset, "updated_at")
  };
}

function parsePublicationExportMetadata(
  value: unknown,
  expectedProjectId: string
): PublicationExportMetadata {
  const metadata = asRecord(value, "publication metadata");
  assertExactKeys(
    metadata,
    [
      "project_id",
      "publication_title",
      "creator_name",
      "language",
      "identifier",
      "publisher",
      "description",
      "rights",
      "subjects",
      "cover_asset_id",
      "created_at",
      "updated_at"
    ],
    "publication metadata"
  );
  const projectId = requiredString(metadata, "project_id");
  if (projectId !== expectedProjectId) {
    throw new Error("The local core returned cross-project publication metadata");
  }
  if (!Array.isArray(metadata.subjects) || metadata.subjects.length > 64) {
    throw new Error("The local core returned invalid publication subjects");
  }
  const subjects = metadata.subjects.map((subject) =>
    validateShortText(subject, "Publication subject", 500)
  );
  if (new Set(subjects).size !== subjects.length) {
    throw new Error("The local core returned duplicate publication subjects");
  }
  const editable = validatePublicationMetadataStateInput({
    publicationTitle: requiredString(metadata, "publication_title"),
    creatorName: requiredText(metadata, "creator_name"),
    language: requiredString(metadata, "language"),
    identifier: requiredString(metadata, "identifier"),
    publisher: optionalNullableText(metadata, "publisher"),
    description: optionalNullableText(metadata, "description"),
    rights: optionalNullableText(metadata, "rights"),
    subjects
  });
  return {
    projectId,
    ...editable,
    coverAssetId: optionalNullableText(metadata, "cover_asset_id"),
    createdAt: requiredString(metadata, "created_at"),
    updatedAt: requiredString(metadata, "updated_at")
  };
}

function parsePublicationCover(
  value: unknown,
  expectedProjectId: string
): PublicationCoverAsset {
  const asset = asRecord(value, "publication cover asset");
  assertExactKeys(
    asset,
    [
      "id",
      "project_id",
      "kind",
      "media_type",
      "original_name",
      "sha256",
      "bytes_base64",
      "byte_length",
      "width",
      "height",
      "created_at",
      "updated_at"
    ],
    "publication cover asset"
  );
  const projectId = requiredString(asset, "project_id");
  if (projectId !== expectedProjectId || asset.kind !== "COVER") {
    throw new Error("The local core returned a cross-project publication cover");
  }
  const mediaType = requiredString(asset, "media_type");
  if (mediaType !== "image/jpeg" && mediaType !== "image/png") {
    throw new Error("The local core returned an unsupported cover media type");
  }
  const originalName = requiredString(asset, "original_name");
  if (path.basename(originalName) !== originalName) {
    throw new Error("The local core returned an unsafe cover name");
  }
  const byteLength = requiredInteger(asset, "byte_length");
  const width = requiredInteger(asset, "width");
  const height = requiredInteger(asset, "height");
  if (
    byteLength < 1 ||
    byteLength > MAX_COVER_FILE_BYTES ||
    width < 1 ||
    height < 1
  ) {
    throw new Error("The local core returned invalid cover dimensions");
  }
  const bytesBase64 = requiredString(asset, "bytes_base64");
  if (bytesBase64.length > MAX_COVER_BASE64_LENGTH) {
    throw new Error("The local core returned oversized cover bytes");
  }
  const decoded = Buffer.from(bytesBase64, "base64");
  const sha256 = validateSha256(asset.sha256, "publication cover hash");
  if (
    decoded.byteLength !== byteLength ||
    decoded.toString("base64") !== bytesBase64 ||
    createHash("sha256").update(decoded).digest("hex") !== sha256
  ) {
    throw new Error("The local core returned invalid cover bytes");
  }
  return {
    id: requiredString(asset, "id"),
    projectId,
    kind: "COVER",
    mediaType,
    originalName,
    sha256,
    byteLength,
    width,
    height,
    createdAt: requiredString(asset, "created_at"),
    updatedAt: requiredString(asset, "updated_at")
  };
}

function parseEpubExportPreset(
  value: unknown,
  expectedProjectId: string
): EpubExportPresetRecord {
  const preset = asRecord(value, "EPUB export preset");
  assertExactKeys(
    preset,
    [
      "id",
      "project_id",
      "kind",
      "name",
      "preset_format",
      "preset_version",
      "preset_json",
      "content_hash",
      "revision",
      "created_at",
      "updated_at"
    ],
    "EPUB export preset"
  );
  const projectId = requiredString(preset, "project_id");
  if (
    projectId !== expectedProjectId ||
    preset.kind !== "EPUB" ||
    preset.preset_format !== "MADI_EXPORT_PRESET" ||
    preset.preset_version !== 1
  ) {
    throw new Error("The local core returned an unsupported EPUB export preset");
  }
  return {
    id: requiredString(preset, "id"),
    projectId,
    kind: "EPUB",
    name: validateEpubPresetName(preset.name),
    presetFormat: "MADI_EXPORT_PRESET",
    presetVersion: 1,
    config: validateEpubExportPresetConfig(preset.preset_json),
    contentHash: validateSha256(preset.content_hash, "EPUB export preset hash"),
    revision: requiredInteger(preset, "revision"),
    createdAt: requiredString(preset, "created_at"),
    updatedAt: requiredString(preset, "updated_at")
  };
}

function parseHwpxExportPreset(
  value: unknown,
  expectedProjectId: string
): HwpxExportPresetRecord {
  const preset = asRecord(value, "HWPX export preset");
  assertExactKeys(
    preset,
    [
      "id",
      "project_id",
      "kind",
      "name",
      "preset_format",
      "preset_version",
      "preset_json",
      "content_hash",
      "revision",
      "created_at",
      "updated_at"
    ],
    "HWPX export preset"
  );
  const projectId = requiredString(preset, "project_id");
  if (
    projectId !== expectedProjectId ||
    preset.kind !== "HWPX" ||
    preset.preset_format !== "MADI_EXPORT_PRESET" ||
    preset.preset_version !== 1
  ) {
    throw new Error("The local core returned an unsupported HWPX export preset");
  }
  return {
    id: requiredString(preset, "id"),
    projectId,
    kind: "HWPX",
    name: validateHwpxPresetName(preset.name),
    presetFormat: "MADI_EXPORT_PRESET",
    presetVersion: 1,
    config: validateHwpxExportPresetConfig(preset.preset_json),
    contentHash: validateSha256(preset.content_hash, "HWPX export preset hash"),
    revision: requiredInteger(preset, "revision"),
    createdAt: requiredString(preset, "created_at"),
    updatedAt: requiredString(preset, "updated_at")
  };
}

function parseExportPresets(
  value: unknown,
  expectedProjectId: string
): {
  readonly epub: EpubExportPresetRecord[];
  readonly hwpx: HwpxExportPresetRecord[];
} {
  if (!Array.isArray(value) || value.length > 10_000) {
    throw new Error("The local core returned invalid export presets");
  }
  const epub: EpubExportPresetRecord[] = [];
  const hwpx: HwpxExportPresetRecord[] = [];
  for (const candidate of value) {
    const record = asRecord(candidate, "export preset");
    if (record.kind === "EPUB") {
      epub.push(parseEpubExportPreset(record, expectedProjectId));
    } else if (record.kind === "HWPX") {
      hwpx.push(parseHwpxExportPreset(record, expectedProjectId));
    } else {
      throw new Error("The local core returned an unsupported export preset kind");
    }
  }
  const identities = [...epub, ...hwpx].map((preset) => preset.id);
  if (new Set(identities).size !== identities.length) {
    throw new Error("The local core returned duplicate export preset identities");
  }
  return { epub, hwpx };
}

function duplicateNames(values: readonly { readonly name: string }[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value.name, (counts.get(value.name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name)
    .sort();
}

interface EpubOutputSelectionRecord {
  readonly sessionId: string;
  readonly filePath: string;
  readonly fileName: string;
  readonly replaceExisting: boolean;
  readonly maximumBytes: number;
  readonly existingFile: {
    readonly byteLength: number;
    readonly sha256: string;
    readonly device: number;
    readonly inode: number;
  } | null;
}

interface EpubOperationRecord {
  readonly sessionId: string;
  readonly report: EpubExportReport;
  readonly outputPath: string | null;
}

interface HwpxOutputSelectionRecord {
  readonly sessionId: string;
  readonly filePath: string;
  readonly fileName: string;
  readonly outputType: "HWPX" | "HWP";
  readonly replaceExisting: boolean;
  readonly maximumBytes: number;
  readonly existingFile: {
    readonly byteLength: number;
    readonly sha256: string;
    readonly device: number;
    readonly inode: number;
  } | null;
  readonly atomicIdentity: AtomicOutputIdentity | null;
}

interface HwpxOperationRecord {
  readonly sessionId: string;
  readonly report: HwpxExportReport;
  readonly outputPath: string | null;
}

class HwpxDestinationChangedError extends Error {
  public constructor() {
    super("The HWPX destination changed after selection");
    this.name = "HwpxDestinationChangedError";
  }
}

class HwpxRecoveryRequiredError extends Error {
  public constructor(public readonly recoveryFileName: string | null) {
    super("The HWPX output requires recovery");
    this.name = "HwpxRecoveryRequiredError";
  }
}

class EpubDestinationChangedError extends Error {
  public constructor() {
    super("The EPUB destination changed after selection");
    this.name = "EpubDestinationChangedError";
  }
}

export interface ShellPort {
  showItemInFolder(filePath: string): void;
}

function safeEpubFileName(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const base = path
    .basename(raw || "작품.epub")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_")
    .replace(/[. ]+$/u, "")
    .slice(0, 180);
  let safe = base || "작품.epub";
  if (!safe.toLocaleLowerCase().endsWith(".epub")) {
    safe = `${safe}.epub`;
  }
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(safe)) {
    safe = `_${safe}`;
  }
  return safe;
}

function safeHwpxFileName(
  value: unknown,
  outputType: "HWPX" | "HWP"
): string {
  const extension = outputType === "HWPX" ? ".hwpx" : ".hwp";
  const raw = typeof value === "string" ? value.trim() : "";
  const base = path
    .basename(raw || `작품${extension}`)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_")
    .replace(/[. ]+$/u, "")
    .slice(0, 180);
  let safe = base || `작품${extension}`;
  if (!safe.toLocaleLowerCase().endsWith(extension)) {
    safe = `${safe}${extension}`;
  }
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(safe)) {
    safe = `_${safe}`;
  }
  return safe;
}

function stagedHwpxDirectory(destination: string, operationId: string): string {
  return path.join(
    path.dirname(destination),
    `.madi-hwpx-operation-${operationId}`
  );
}

function stagedHwpxPath(stagedDirectory: string): string {
  return path.join(stagedDirectory, "publication.hwpx");
}

function stagedHwpPath(stagedDirectory: string): string {
  return path.join(stagedDirectory, "publication.hwp");
}

function stagedPreservedHwpxPath(stagedDirectory: string): string {
  return path.join(stagedDirectory, "preserved-publication.hwpx");
}

function stagedRecoveryHwpxPath(stagedDirectory: string): string {
  return path.join(stagedDirectory, "recovery-publication.hwpx");
}

function preservedHwpxCompanionPath(hwpDestination: string): string {
  return path.join(
    path.dirname(hwpDestination),
    `${path.basename(hwpDestination, path.extname(hwpDestination))}.hwpx`
  );
}

async function removeOwnedHwpxDirectory(directoryPath: string): Promise<void> {
  try {
    await rm(directoryPath, {
      recursive: true,
      force: false,
      maxRetries: 3,
      retryDelay: 100
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw new Error("The owned HWPX temporary directory could not be removed");
  }
}

async function existingEpubIdentity(
  filePath: string,
  maximumBytes = MAX_EPUB_FILE_BYTES
): Promise<NonNullable<EpubOutputSelectionRecord["existingFile"]>> {
  const selectedPath = await lstat(filePath);
  if (!selectedPath.isFile() || selectedPath.isSymbolicLink()) {
    throw new Error("The selected destination must be a regular file");
  }
  const handle = await open(filePath, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 0 || before.size > maximumBytes) {
      throw new Error("EPUB destination is not a file or exceeds the size limit");
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < before.size) {
      const bytesToRead = Math.min(buffer.byteLength, before.size - offset);
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, offset);
      if (bytesRead === 0) {
        throw new Error("The EPUB destination changed while it was selected");
      }
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const [afterHandle, afterPath] = await Promise.all([
      handle.stat(),
      lstat(filePath)
    ]);
    if (
      !afterHandle.isFile() ||
      !afterPath.isFile() ||
      afterPath.isSymbolicLink() ||
      before.size !== afterHandle.size ||
      before.mtimeMs !== afterHandle.mtimeMs ||
      before.ctimeMs !== afterHandle.ctimeMs ||
      afterHandle.dev !== afterPath.dev ||
      afterHandle.ino !== afterPath.ino ||
      afterHandle.size !== afterPath.size ||
      afterHandle.mtimeMs !== afterPath.mtimeMs ||
      afterHandle.ctimeMs !== afterPath.ctimeMs
    ) {
      throw new Error("The EPUB destination changed while it was selected");
    }
    return {
      byteLength: afterHandle.size,
      sha256: hash.digest("hex"),
      device: afterHandle.dev,
      inode: afterHandle.ino
    };
  } finally {
    await handle.close();
  }
}

async function readBoundedFile(
  filePath: string,
  maximumBytes: number
): Promise<Buffer> {
  const handle = await open(filePath, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > maximumBytes) {
      throw new Error("Selected file is too large or is not a file");
    }
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        offset
      );
      if (bytesRead === 0) {
        throw new Error("Selected file changed while it was read");
      }
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== before.size || bytes.byteLength > maximumBytes) {
      throw new Error("Selected file changed while it was read");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function stagedEpubDirectory(destination: string, operationId: string): string {
  return path.join(
    path.dirname(destination),
    `.madi-epub-operation-${operationId}`
  );
}

function stagedEpubPath(stagedDirectory: string): string {
  return path.join(stagedDirectory, "publication.epub");
}

async function removeStagedEpub(filePath: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await unlink(filePath);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      if (attempt === 2) {
        throw new Error("The staged EPUB file could not be removed");
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function removeOwnedEpubDirectory(directoryPath: string): Promise<void> {
  try {
    await rm(directoryPath, {
      recursive: true,
      force: false,
      maxRetries: 3,
      retryDelay: 100
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw new Error("The owned EPUB temporary directory could not be removed");
  }
}

function editableMetadataForValidation(metadata: PublicationExportMetadata) {
  return {
    publicationTitle: metadata.publicationTitle,
    creatorName: metadata.creatorName,
    language: metadata.language,
    identifier: metadata.identifier,
    publisher: metadata.publisher,
    description: metadata.description,
    rights: metadata.rights,
    subjects: metadata.subjects
  };
}

function assertEpubMutationRevision(
  previousRevision: number,
  nextRevision: number,
  noOp: boolean,
  label: string
): void {
  const expectedRevision = noOp ? previousRevision : previousRevision + 1;
  if (nextRevision !== expectedRevision) {
    throw new Error(`The local core returned an invalid ${label} revision`);
  }
}

function assertEditablePublicationMetadata(
  actual: PublicationExportMetadata,
  expected: ReturnType<typeof validatePublicationMetadataInput>
): void {
  if (
    canonicalCanvasJson(editableMetadataForValidation(actual)) !==
    canonicalCanvasJson(expected)
  ) {
    throw new Error("The local core returned different publication metadata");
  }
}

function assertEpubPresetContent(
  preset: EpubExportPresetRecord,
  expected: {
    readonly id: string;
    readonly name?: string;
    readonly config: EpubExportPresetConfig;
    readonly revision: number;
  }
): void {
  if (
    preset.id !== expected.id ||
    (expected.name !== undefined && preset.name !== expected.name) ||
    preset.revision !== expected.revision ||
    canonicalCanvasJson(preset.config) !== canonicalCanvasJson(expected.config)
  ) {
    throw new Error("The local core returned a different EPUB export preset");
  }
}

function validationMessagesForDocument(
  messages: EpubUtilityResult["summary"]["validationReport"]["messages"],
  document: CompilePublicationResult["document"]
): EpubExportReport["validation"]["messages"] {
  const sourceNodeIds = new Set<string>();
  for (const section of document.sections) {
    sourceNodeIds.add(section.sourceNodeId);
    for (const block of section.blocks) {
      sourceNodeIds.add(block.source.sourceNodeId);
    }
  }
  return messages.map((message) => {
    if (
      message.sourceNodeId !== null &&
      !sourceNodeIds.has(message.sourceNodeId)
    ) {
      throw new Error("The EPUB utility returned an unknown source node");
    }
    return { ...message, sectionId: null };
  });
}

function reportFromUtility(
  utility: EpubUtilityResult,
  document: CompilePublicationResult["document"],
  config: EpubExportPresetConfig,
  sourceProjectRevision: number,
  appVersion: string
): EpubExportReport {
  const { summary } = utility;
  const statistics = summary.statistics;
  const coveredBlocks =
    statistics.exportedBlockCount +
    statistics.fallbackBlockCount +
    statistics.rejectedBlockCount;
  const blocks = document.sections.flatMap((section) => section.blocks);
  const countRuby = (
    inlines: readonly import("../shared/publication").PublicationInline[]
  ): number =>
    inlines.reduce(
      (count, inline) =>
        count +
        (inline.kind === "RUBY" ? 1 : 0) +
        (inline.kind === "TEXT" ? 0 : countRuby(inline.children)),
      0
    );
  const expectedRubyCount = blocks.reduce(
    (count, block) =>
      count +
      (block.kind === "PARAGRAPH" || block.kind === "QUOTE"
        ? countRuby(block.inlines)
        : 0),
    0
  );
  if (
    summary.validationReport.status !== "PASS" ||
    statistics.sourceSectionCount !== document.sections.length ||
    statistics.sourceBlockCount !== blocks.length ||
    statistics.sourceCharacterCount !== document.stats.withSpaces ||
    statistics.sceneBreakCount !==
      blocks.filter((block) => block.kind === "SCENE_BREAK").length ||
    statistics.rubyCount !== expectedRubyCount ||
    statistics.headingCount !==
      blocks.filter((block) => block.kind === "HEADING").length ||
    statistics.coverIncluded !== config.includeCover ||
    statistics.sourceSectionCount !== statistics.exportedSectionCount ||
    statistics.sourceBlockCount !== coveredBlocks ||
    statistics.rejectedBlockCount !== 0 ||
    statistics.sourceCharacterCount !== statistics.exportedCharacterCount
  ) {
    throw new Error("The EPUB utility reported publication content loss");
  }
  return {
    formatVersion: 1,
    targetProfile: summary.targetProfile,
    sourceProjectRevision,
    sourcePublicationHash: summary.sourcePublicationHash,
    epubSha256: utility.mode === "EXPORT" ? summary.sha256 : null,
    logicalPackageHash: summary.logicalPackageHash,
    byteLength: utility.mode === "EXPORT" ? summary.byteLength : null,
    fileCount: statistics.fileCount,
    xhtmlCount: statistics.xhtmlCount,
    coverage: {
      sourceSectionCount: statistics.sourceSectionCount,
      exportedSectionCount: statistics.exportedSectionCount,
      sourceBlockCount: statistics.sourceBlockCount,
      exportedBlockCount: statistics.exportedBlockCount,
      fallbackBlockCount: statistics.fallbackBlockCount,
      rejectedBlockCount: statistics.rejectedBlockCount,
      sourceCharacterCount: statistics.sourceCharacterCount,
      exportedCharacterCount: statistics.exportedCharacterCount,
      sceneBreakCount: statistics.sceneBreakCount,
      rubyCount: statistics.rubyCount,
      headingCount: statistics.headingCount
    },
    coverIncluded: statistics.coverIncluded,
    validation: {
      status: summary.validationReport.status === "PASS" ? "VALID" : "INVALID",
      fatalCount: summary.validationReport.fatalCount,
      errorCount: summary.validationReport.errorCount,
      warningCount: summary.validationReport.warningCount,
      infoCount: summary.validationReport.infoCount,
      messages: validationMessagesForDocument(
        summary.validationReport.messages,
        document
      ),
      epubCheck: {
        status: "UNAVAILABLE",
        version: null,
        compatibilityOnly:
          summary.targetProfile === "EPUB_3_4_DRAFT_2026_08"
      }
    },
    timing: {
      splitMs: summary.exportTiming.contentSplitMs,
      xhtmlMs: summary.exportTiming.xhtmlGenerationMs,
      navigationMs: summary.exportTiming.packageDocumentsMs,
      packageMs: summary.exportTiming.zipPackagingMs,
      internalValidationMs: summary.exportTiming.internalValidationMs,
      epubCheckMs: null,
      totalMs: summary.exportTiming.totalMs
    },
    generatedAt: new Date().toISOString(),
    madiVersion: appVersion
  };
}

function markdownExportReport(report: EpubExportReport): string {
  const lines = [
    "# madi EPUB export report",
    "",
    `- Profile: ${report.targetProfile}`,
    `- Project revision: ${report.sourceProjectRevision}`,
    `- Publication IR SHA-256: ${report.sourcePublicationHash}`,
    `- EPUB SHA-256: ${report.epubSha256 ?? "not written"}`,
    `- Logical package SHA-256: ${report.logicalPackageHash}`,
    `- Files/XHTML: ${report.fileCount}/${report.xhtmlCount}`,
    `- Sections: ${report.coverage.exportedSectionCount}/${report.coverage.sourceSectionCount}`,
    `- Blocks: ${report.coverage.exportedBlockCount + report.coverage.fallbackBlockCount}/${report.coverage.sourceBlockCount}`,
    `- Characters: ${report.coverage.exportedCharacterCount}/${report.coverage.sourceCharacterCount}`,
    `- Scene breaks/Ruby: ${report.coverage.sceneBreakCount}/${report.coverage.rubyCount}`,
    `- Cover: ${report.coverIncluded ? "included" : "not included"}`,
    `- Internal validation: ${report.validation.status}`,
    `- EPUBCheck: ${report.validation.epubCheck.status} (${report.validation.epubCheck.version ?? "not available"})`,
    `- Validation F/E/W/I: ${report.validation.fatalCount}/${report.validation.errorCount}/${report.validation.warningCount}/${report.validation.infoCount}`,
    `- Total: ${report.timing.totalMs} ms`,
    `- Generated: ${report.generatedAt}`,
    `- madi: ${report.madiVersion}`,
    ""
  ];
  if (report.validation.messages.length > 0) {
    lines.push("## Validation messages", "");
    for (const message of report.validation.messages) {
      lines.push(
        `- ${message.severity} ${message.code}: ${message.description}${message.epubPath ? ` [${message.epubPath}]` : ""}${message.suggestion ? ` — ${message.suggestion}` : ""}`
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

function validationFailureReport(
  document: CompilePublicationResult["document"],
  sourcePublicationHash: string,
  profile: EpubExportReport["targetProfile"],
  validation: EpubUtilityValidationError["report"],
  appVersion: string
): EpubExportReport {
  const blocks = document.sections.flatMap((section) => section.blocks);
  const countRuby = (inlines: readonly import("../shared/publication").PublicationInline[]): number =>
    inlines.reduce(
      (count, inline) =>
        count +
        (inline.kind === "RUBY" ? 1 : 0) +
        (inline.kind === "TEXT" ? 0 : countRuby(inline.children)),
      0
    );
  return {
    formatVersion: 1,
    targetProfile: profile,
    sourceProjectRevision: document.projectRevision,
    sourcePublicationHash,
    epubSha256: null,
    logicalPackageHash: "0".repeat(64),
    byteLength: null,
    fileCount: 0,
    xhtmlCount: 0,
    coverage: {
      sourceSectionCount: document.sections.length,
      exportedSectionCount: 0,
      sourceBlockCount: blocks.length,
      exportedBlockCount: 0,
      fallbackBlockCount: 0,
      rejectedBlockCount: blocks.length,
      sourceCharacterCount: document.stats.withSpaces,
      exportedCharacterCount: 0,
      sceneBreakCount: blocks.filter((block) => block.kind === "SCENE_BREAK").length,
      rubyCount: blocks.reduce(
        (count, block) =>
          count +
          (block.kind === "PARAGRAPH" || block.kind === "QUOTE"
            ? countRuby(block.inlines)
            : 0),
        0
      ),
      headingCount: blocks.filter((block) => block.kind === "HEADING").length
    },
    coverIncluded: false,
    validation: {
      status: "INVALID",
      fatalCount: validation.fatalCount,
      errorCount: validation.errorCount,
      warningCount: validation.warningCount,
      infoCount: validation.infoCount,
      messages: validationMessagesForDocument(validation.messages, document),
      epubCheck: {
        status: "NOT_RUN",
        version: null,
        compatibilityOnly: profile === "EPUB_3_4_DRAFT_2026_08"
      }
    },
    timing: {
      splitMs: 0,
      xhtmlMs: 0,
      navigationMs: 0,
      packageMs: 0,
      internalValidationMs: 0,
      epubCheckMs: null,
      totalMs: 0
    },
    generatedAt: new Date().toISOString(),
    madiVersion: appVersion
  };
}

function canonicalJsonSha256(value: unknown): string {
  return createHash("sha256")
    .update(canonicalCanvasJson(value), "utf8")
    .digest("hex");
}

function validateHwpxFrontMatterText(
  value: unknown,
  label: string
): string | null {
  if (value === null) {
    return null;
  }
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 20_000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function assertHwpxPresetContent(
  preset: HwpxExportPresetRecord,
  expected: {
    readonly id: string;
    readonly name?: string;
    readonly config: HwpxExportPresetConfig;
    readonly revision: number;
  }
): void {
  if (
    preset.id !== expected.id ||
    (expected.name !== undefined && preset.name !== expected.name) ||
    preset.revision !== expected.revision ||
    canonicalCanvasJson(preset.config) !== canonicalCanvasJson(expected.config)
  ) {
    throw new Error("The local core returned a different HWPX export preset");
  }
}

interface HwpxInlineCounts {
  readonly ruby: number;
  readonly strong: number;
  readonly emphasis: number;
  readonly underline: number;
  readonly strike: number;
}

const HWPX_VALIDATION_CODES = new Set([
  "HWPX_ACTIVE_CONTENT",
  "HWPX_ARCHIVE_SIZE",
  "HWPX_CASE_COLLIDING_ENTRY",
  "HWPX_CHAR_PROPERTY_REFERENCE",
  "HWPX_CONFIGURED_HEADING_OMISSION",
  "HWPX_CONFIGURED_OMISSION_SEQUENCE",
  "HWPX_CONTAINER_DANGLING_ROOT",
  "HWPX_CONTAINER_STRUCTURE",
  "HWPX_CONTENT_STRUCTURE",
  "HWPX_DOCUMENT_COUNTS",
  "HWPX_DUPLICATE_ENTRY",
  "HWPX_DUPLICATE_PARAGRAPH_ID",
  "HWPX_DUPLICATE_XML_ID",
  "HWPX_ENTRY_COUNT",
  "HWPX_ENTRY_PATH",
  "HWPX_ENTRY_READ",
  "HWPX_ENTRY_SIZE",
  "HWPX_ENTRY_TRUNCATED",
  "HWPX_EXTERNAL_REFERENCE",
  "HWPX_FILE_COUNT_MISMATCH",
  "HWPX_HEADER_ROOT",
  "HWPX_HEADER_TABLE_COUNT",
  "HWPX_INLINE_STYLE_COVERAGE",
  "HWPX_INLINE_TABLE_COVERAGE",
  "HWPX_MANIFEST_DUPLICATE_ID",
  "HWPX_MANIFEST_REQUIRED_ID",
  "HWPX_MANIFEST_RESOURCE",
  "HWPX_MIMETYPE",
  "HWPX_NAMESPACE",
  "HWPX_ODF_MANIFEST_STRUCTURE",
  "HWPX_PAGE_SETTINGS",
  "HWPX_PARAGRAPH_REFERENCE",
  "HWPX_PARA_PROPERTY_REFERENCE",
  "HWPX_PUBLICATION_BLOCK_COUNT",
  "HWPX_PUBLICATION_SCALAR_COVERAGE",
  "HWPX_PUBLICATION_SECTION_SPLIT",
  "HWPX_RDF_STRUCTURE",
  "HWPX_REQUIRED_ENTRY_MISSING",
  "HWPX_RUBY_PLAIN_TEXT_FALLBACK",
  "HWPX_RUN_REFERENCE",
  "HWPX_SECTION_FILE_COVERAGE",
  "HWPX_SECTION_MANIFEST_COVERAGE",
  "HWPX_SECTION_STRUCTURE",
  "HWPX_SETTINGS_STRUCTURE",
  "HWPX_SOURCE_BLOCK_MISSING",
  "HWPX_SOURCE_BLOCK_PLAN",
  "HWPX_SOURCE_BLOCK_SEQUENCE",
  "HWPX_SOURCE_COVERAGE",
  "HWPX_SOURCE_DISPOSITION",
  "HWPX_SPINE_DANGLING_REF",
  "HWPX_SPINE_ORDER",
  "HWPX_STYLE_REFERENCE",
  "HWPX_UNCOMPRESSED_SIZE",
  "HWPX_UNEXPECTED_PACKAGE_ENTRY",
  "HWPX_UNSUPPORTED_BLOCK_FALLBACK",
  "HWPX_UNSUPPORTED_COMPRESSION",
  "HWPX_UNSUPPORTED_PROTECTED_PACKAGE",
  "HWPX_VERSION_STRUCTURE",
  "HWPX_XML_WELL_FORMED",
  "HWPX_ZIP_REOPEN"
]);

function hwpxInlineCounts(
  inlines: readonly import("../shared/publication").PublicationInline[]
): HwpxInlineCounts {
  let ruby = 0;
  let strong = 0;
  let emphasis = 0;
  let underline = 0;
  let strike = 0;
  for (const inline of inlines) {
    if (inline.kind === "TEXT") {
      continue;
    }
    switch (inline.kind) {
      case "RUBY":
        ruby += 1;
        break;
      case "STRONG":
        strong += 1;
        break;
      case "EMPHASIS":
        emphasis += 1;
        break;
      case "UNDERLINE":
        underline += 1;
        break;
      case "STRIKE":
        strike += 1;
        break;
    }
    const nested = hwpxInlineCounts(inline.children);
    ruby += nested.ruby;
    strong += nested.strong;
    emphasis += nested.emphasis;
    underline += nested.underline;
    strike += nested.strike;
  }
  return { ruby, strong, emphasis, underline, strike };
}

function hwpxHeadingIncluded(
  level: 1 | 2 | 3 | 4,
  config: HwpxExportPresetConfig
): boolean {
  switch (level) {
    case 1:
      return config.includeWorkTitle;
    case 2:
      return config.includeVolumeTitles;
    case 3:
      return config.includeChapterTitles;
    case 4:
      return config.includeSceneTitles;
  }
}

function hwpxValidationMessagesForDocument(
  messages: HwpxUtilityResult["summary"]["validationReport"]["messages"],
  document: CompilePublicationResult["document"]
): HwpxExportReport["validation"]["messages"] {
  const sectionBySourceNode = new Map<string, string>();
  for (const section of document.sections) {
    sectionBySourceNode.set(section.sourceNodeId, section.id);
    for (const block of section.blocks) {
      sectionBySourceNode.set(block.source.sourceNodeId, section.id);
    }
  }
  return messages.map((message) => {
    if (!HWPX_VALIDATION_CODES.has(message.code)) {
      throw new Error("The HWPX utility returned an unknown validation code");
    }
    if (
      message.sourceNodeId !== null &&
      !sectionBySourceNode.has(message.sourceNodeId)
    ) {
      throw new Error("The HWPX utility returned an unknown source node");
    }
    if (
      message.hwpxPath !== null &&
      message.hwpxPath !== "mimetype" &&
      message.hwpxPath !== "version.xml" &&
      message.hwpxPath !== "settings.xml" &&
      message.hwpxPath !== "Contents/header.xml" &&
      message.hwpxPath !== "Contents/content.hpf" &&
      message.hwpxPath !== "META-INF/container.xml" &&
      message.hwpxPath !== "META-INF/container.rdf" &&
      message.hwpxPath !== "META-INF/manifest.xml" &&
      !/^Contents\/section(?:0|[1-9][0-9]*)\.xml$/u.test(message.hwpxPath)
    ) {
      throw new Error("The HWPX utility returned an unknown package path");
    }
    return {
      code: message.code,
      severity: message.severity,
      description: `HWPX 내부 검증 메시지: ${message.code}`,
      sourceNodeId: message.sourceNodeId,
      hwpxPath: message.hwpxPath,
      suggestion: null,
      sectionId:
        message.sourceNodeId === null
          ? null
          : sectionBySourceNode.get(message.sourceNodeId) ?? null
    };
  });
}

function hwpxReportFromUtility(
  utility: HwpxUtilityResult,
  document: CompilePublicationResult["document"],
  config: HwpxExportPresetConfig,
  sourcePublicationHash: string,
  presetId: string,
  presetContentHash: string,
  sourceProjectRevision: number,
  appVersion: string
): HwpxExportReport {
  const { summary } = utility;
  const statistics = summary.statistics;
  const blocks = document.sections.flatMap((section) => section.blocks);
  let expectedRuby = 0;
  let expectedStrong = 0;
  let expectedEmphasis = 0;
  let expectedUnderline = 0;
  let expectedStrike = 0;
  let expectedFallback = 0;
  let expectedConfiguredOmission = 0;
  let expectedHeadings = 0;
  for (const block of blocks) {
    if (block.kind === "UNSUPPORTED") {
      expectedFallback += 1;
      continue;
    }
    if (block.kind === "HEADING") {
      if (hwpxHeadingIncluded(block.level, config)) {
        expectedHeadings += 1;
      } else {
        expectedConfiguredOmission += 1;
      }
      continue;
    }
    if (block.kind === "PARAGRAPH" || block.kind === "QUOTE") {
      const counts = hwpxInlineCounts(block.inlines);
      expectedRuby += counts.ruby;
      expectedStrong += counts.strong;
      expectedEmphasis += counts.emphasis;
      expectedUnderline += counts.underline;
      expectedStrike += counts.strike;
      if (counts.ruby > 0) {
        expectedFallback += 1;
      }
    }
  }
  const expectedSceneBreaks = blocks.filter(
    (block) => block.kind === "SCENE_BREAK"
  ).length;
  const expectedPackageSectionCount =
    config.sectionSplitMode === "SINGLE"
      ? 1
      : Math.max(
          1,
          blocks.filter(
            (block) => block.kind === "HEADING" && block.level === 2
          ).length
        );
  const expectedExported =
    blocks.length - expectedFallback - expectedConfiguredOmission;
  if (
    summary.validationReport.status !== "PASS" ||
    summary.packageXmlVersion !== "1.31" ||
    summary.sourcePublicationHash !== sourcePublicationHash ||
    summary.presetId !== presetId ||
    summary.presetContentHash !== presetContentHash ||
    summary.fontFamily !== config.fontFamilyToken ||
    statistics.sourceSectionCount !== document.sections.length ||
    statistics.exportedSectionCount !== document.sections.length ||
    statistics.sectionCount !== expectedPackageSectionCount ||
    statistics.sourceBlockCount !== blocks.length ||
    statistics.exportedBlockCount !== expectedExported ||
    statistics.fallbackBlockCount !== expectedFallback ||
    statistics.configuredOmissionBlockCount !== expectedConfiguredOmission ||
    statistics.rejectedBlockCount !== 0 ||
    statistics.exportedBlockCount +
      statistics.fallbackBlockCount +
      statistics.configuredOmissionBlockCount +
      statistics.rejectedBlockCount !==
      statistics.sourceBlockCount ||
    statistics.sourceCharacterCount !== document.stats.withSpaces ||
    statistics.exportedCharacterCount !== document.stats.withSpaces ||
    statistics.headingCount !== expectedHeadings ||
    statistics.sceneBreakCount !== expectedSceneBreaks ||
    statistics.rubyCount !== expectedRuby ||
    statistics.rubyFallbackCount !== expectedRuby ||
    statistics.strongSegmentCount !== expectedStrong ||
    statistics.emphasisSegmentCount !== expectedEmphasis ||
    statistics.underlineSegmentCount !== expectedUnderline ||
    statistics.strikeSegmentCount !== expectedStrike ||
    statistics.paragraphCount < expectedExported + expectedFallback ||
    statistics.runCount < expectedExported + expectedFallback
  ) {
    throw new Error("The HWPX utility reported publication content loss");
  }
  return {
    formatVersion: 1,
    outputType: "HWPX",
    packageProfile: "HANCOM_OFFICIAL_MODEL_1_31",
    sourceScope: document.scopeKind,
    sourceScopeNodeId: document.scopeNodeId,
    sourceProjectRevision,
    sourcePublicationHash: summary.sourcePublicationHash,
    presetId,
    presetContentHash,
    hwpxSha256: utility.mode === "EXPORT" ? summary.sha256 : null,
    outputSha256: utility.mode === "EXPORT" ? summary.sha256 : null,
    preservedHwpxFileName: null,
    logicalPackageHash: summary.logicalPackageHash,
    byteLength: utility.mode === "EXPORT" ? summary.byteLength : null,
    coverage: {
      packageSectionCount: statistics.sectionCount,
      sourceSectionCount: statistics.sourceSectionCount,
      exportedSectionCount: statistics.exportedSectionCount,
      sourceBlockCount: statistics.sourceBlockCount,
      exportedBlockCount: statistics.exportedBlockCount,
      fallbackBlockCount: statistics.fallbackBlockCount,
      configuredOmissionBlockCount:
        statistics.configuredOmissionBlockCount,
      rejectedBlockCount: statistics.rejectedBlockCount,
      sourceCharacterCount: statistics.sourceCharacterCount,
      exportedCharacterCount: statistics.exportedCharacterCount,
      paragraphCount: statistics.paragraphCount,
      runCount: statistics.runCount,
      headingCount: statistics.headingCount,
      sceneBreakCount: statistics.sceneBreakCount,
      rubyCount: statistics.rubyCount,
      inlineModifierCount:
        statistics.strongSegmentCount +
        statistics.emphasisSegmentCount +
        statistics.underlineSegmentCount +
        statistics.strikeSegmentCount
    },
    validation: {
      status: "VALID",
      fatalCount: summary.validationReport.fatalCount,
      errorCount: summary.validationReport.errorCount,
      warningCount: summary.validationReport.warningCount,
      infoCount: summary.validationReport.infoCount,
      messages: hwpxValidationMessagesForDocument(
        summary.validationReport.messages,
        document
      )
    },
    fontFamily: summary.fontFamily,
    fontInstalled: null,
    page: {
      pageSizeToken: config.pageSizeToken,
      orientation: config.orientation,
      marginTop: config.marginTop,
      marginBottom: config.marginBottom,
      marginLeft: config.marginLeft,
      marginRight: config.marginRight
    },
    hancomReopen: "NOT_RUN",
    hwpConverted: false,
    timing: {
      semanticMappingMs: 0,
      styleTableMs: summary.exportTiming.styleTableMs,
      sectionXmlMs: summary.exportTiming.sectionXmlMs,
      packageMs:
        summary.exportTiming.packageDocumentsMs +
        summary.exportTiming.zipPackagingMs,
      internalValidationMs: summary.exportTiming.internalValidationMs,
      zipReopenMs: summary.exportTiming.zipReopenMs,
      sourceCoverageMs: summary.exportTiming.sourceCoverageMs,
      totalMs: summary.exportTiming.totalMs,
      hwpConversionMs: null,
      hwpReopenMs: null
    },
    generatedAt: new Date().toISOString(),
    madiVersion: appVersion
  };
}

function hwpxValidationFailureReport(
  document: CompilePublicationResult["document"],
  sourcePublicationHash: string,
  config: HwpxExportPresetConfig,
  presetId: string,
  presetContentHash: string,
  validation: HwpxUtilityValidationError["report"],
  appVersion: string
): HwpxExportReport {
  const blocks = document.sections.flatMap((section) => section.blocks);
  let rubyCount = 0;
  let inlineModifierCount = 0;
  for (const block of blocks) {
    if (block.kind === "PARAGRAPH" || block.kind === "QUOTE") {
      const counts = hwpxInlineCounts(block.inlines);
      rubyCount += counts.ruby;
      inlineModifierCount +=
        counts.strong + counts.emphasis + counts.underline + counts.strike;
    }
  }
  return {
    formatVersion: 1,
    outputType: "HWPX",
    packageProfile: "HANCOM_OFFICIAL_MODEL_1_31",
    sourceScope: document.scopeKind,
    sourceScopeNodeId: document.scopeNodeId,
    sourceProjectRevision: document.projectRevision,
    sourcePublicationHash,
    presetId,
    presetContentHash,
    hwpxSha256: null,
    outputSha256: null,
    preservedHwpxFileName: null,
    logicalPackageHash: "0".repeat(64),
    byteLength: null,
    coverage: {
      packageSectionCount: 0,
      sourceSectionCount: document.sections.length,
      exportedSectionCount: 0,
      sourceBlockCount: blocks.length,
      exportedBlockCount: 0,
      fallbackBlockCount: 0,
      configuredOmissionBlockCount: 0,
      rejectedBlockCount: blocks.length,
      sourceCharacterCount: document.stats.withSpaces,
      exportedCharacterCount: 0,
      paragraphCount: 0,
      runCount: 0,
      headingCount: blocks.filter((block) => block.kind === "HEADING").length,
      sceneBreakCount: blocks.filter((block) => block.kind === "SCENE_BREAK").length,
      rubyCount,
      inlineModifierCount
    },
    validation: {
      status: "INVALID",
      fatalCount: validation.fatalCount,
      errorCount: validation.errorCount,
      warningCount: validation.warningCount,
      infoCount: validation.infoCount,
      messages: hwpxValidationMessagesForDocument(validation.messages, document)
    },
    fontFamily: config.fontFamilyToken,
    fontInstalled: null,
    page: {
      pageSizeToken: config.pageSizeToken,
      orientation: config.orientation,
      marginTop: config.marginTop,
      marginBottom: config.marginBottom,
      marginLeft: config.marginLeft,
      marginRight: config.marginRight
    },
    hancomReopen: "NOT_RUN",
    hwpConverted: false,
    timing: {
      semanticMappingMs: 0,
      styleTableMs: 0,
      sectionXmlMs: 0,
      packageMs: 0,
      internalValidationMs: 0,
      zipReopenMs: 0,
      sourceCoverageMs: 0,
      totalMs: 0,
      hwpConversionMs: null,
      hwpReopenMs: null
    },
    generatedAt: new Date().toISOString(),
    madiVersion: appVersion
  };
}

function hwpxReportWithFontInstallation(
  report: HwpxExportReport,
  installed: boolean | null
): HwpxExportReport {
  if (installed === true) {
    return { ...report, fontInstalled: true };
  }
  if (report.validation.messages.length >= 1_000) {
    return { ...report, fontInstalled: installed };
  }
  const message =
    installed === false
      ? {
          severity: "WARNING" as const,
          code: "HWPX_FONT_NOT_INSTALLED",
          description: `선택한 글꼴 '${report.fontFamily}'을(를) Windows 설치 글꼴에서 확인하지 못했습니다.`,
          suggestion: "설치된 글꼴을 선택하거나 이 문서를 열 환경에 해당 글꼴을 설치하세요."
        }
      : {
          severity: "INFO" as const,
          code: "HWPX_FONT_INSTALLATION_UNVERIFIED",
          description: `선택한 글꼴 '${report.fontFamily}'의 설치 여부를 이 환경에서 확인할 수 없습니다.`,
          suggestion: "문서를 열 Windows 환경에서 글꼴 설치 상태를 확인하세요."
        };
  return {
    ...report,
    fontInstalled: installed,
    validation: {
      ...report.validation,
      warningCount:
        report.validation.warningCount + (message.severity === "WARNING" ? 1 : 0),
      infoCount:
        report.validation.infoCount + (message.severity === "INFO" ? 1 : 0),
      messages: [
        ...report.validation.messages,
        {
          ...message,
          sourceNodeId: null,
          sectionId: null,
          hwpxPath: null
        }
      ]
    }
  };
}

function hwpxReportForHwp(
  report: HwpxExportReport,
  options: {
    readonly preservedHwpxFileName: string;
    readonly outputSha256: string | null;
    readonly byteLength: number | null;
    readonly hwpConverted: boolean;
    readonly hancomReopen: "NOT_RUN" | "PASSED" | "FAILED";
    readonly hwpConversionMs: number;
    readonly hwpReopenMs: number | null;
  }
): HwpxExportReport {
  const bridgeTiming = options.hwpConversionMs + (options.hwpReopenMs ?? 0);
  return {
    ...report,
    outputType: "HWP",
    outputSha256: options.outputSha256,
    preservedHwpxFileName: options.preservedHwpxFileName,
    byteLength: options.byteLength,
    hwpConverted: options.hwpConverted,
    hancomReopen: options.hancomReopen,
    timing: {
      ...report.timing,
      totalMs: report.timing.totalMs + bridgeTiming,
      hwpConversionMs: options.hwpConversionMs,
      hwpReopenMs: options.hwpReopenMs
    }
  };
}

function markdownHwpxExportReport(report: HwpxExportReport): string {
  const lines = [
    "# madi HWPX export report",
    "",
    `- Output: ${report.outputType}`,
    `- Package profile: ${report.packageProfile}`,
    `- Source scope/revision: ${report.sourceScope} (${report.sourceScopeNodeId})/${report.sourceProjectRevision}`,
    `- Publication IR SHA-256: ${report.sourcePublicationHash}`,
    `- Preset/hash: ${report.presetId}/${report.presetContentHash}`,
    `- HWPX SHA-256: ${report.hwpxSha256 ?? "not written"}`,
    `- Output SHA-256: ${report.outputSha256 ?? "not written"}`,
    `- Preserved HWPX: ${report.preservedHwpxFileName ?? "not applicable"}`,
    `- Logical package SHA-256: ${report.logicalPackageHash}`,
    `- Publication IR sections: ${report.coverage.exportedSectionCount}/${report.coverage.sourceSectionCount}`,
    `- Physical HWPX sections: ${report.coverage.packageSectionCount}`,
    `- Blocks (exported/fallback/configured omission/rejected/source): ${report.coverage.exportedBlockCount}/${report.coverage.fallbackBlockCount}/${report.coverage.configuredOmissionBlockCount}/${report.coverage.rejectedBlockCount}/${report.coverage.sourceBlockCount}`,
    `- Characters: ${report.coverage.exportedCharacterCount}/${report.coverage.sourceCharacterCount}`,
    `- Paragraphs/runs/headings: ${report.coverage.paragraphCount}/${report.coverage.runCount}/${report.coverage.headingCount}`,
    `- Scene breaks/Ruby/inline modifiers: ${report.coverage.sceneBreakCount}/${report.coverage.rubyCount}/${report.coverage.inlineModifierCount}`,
    `- Internal validation: ${report.validation.status}`,
    `- Validation F/E/W/I: ${report.validation.fatalCount}/${report.validation.errorCount}/${report.validation.warningCount}/${report.validation.infoCount}`,
    `- Font installed: ${report.fontFamily}/${report.fontInstalled === null ? "unverified" : report.fontInstalled}`,
    `- Hancom reopen/HWP converted: ${report.hancomReopen}/${report.hwpConverted}`,
    `- Total: ${report.timing.totalMs} ms`,
    `- Generated: ${report.generatedAt}`,
    `- madi: ${report.madiVersion}`,
    ""
  ];
  if (report.validation.messages.length > 0) {
    lines.push("## Validation messages", "");
    for (const message of report.validation.messages) {
      lines.push(
        `- ${message.severity} ${message.code}: ${message.description}${message.hwpxPath ? ` [${message.hwpxPath}]` : ""}${message.suggestion ? ` — ${message.suggestion}` : ""}`
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

export class DesktopService {
  private readonly epubOutputSelections = new Map<
    string,
    EpubOutputSelectionRecord
  >();
  private readonly epubOperations = new Map<string, EpubOperationRecord>();
  private readonly usedEpubOperationIds = new Set<string>();
  private readonly activeEpubOperations = new Map<
    string,
    {
      readonly sessionId: string;
      readonly phase: "PREPARING" | "EXPORTING" | "FINALIZING";
    }
  >();
  private readonly cancelledEpubOperations = new Set<string>();
  private readonly epubOperationCompletions = new Map<
    string,
    {
      readonly promise: Promise<{ readonly cleanupFailed: boolean }>;
      readonly resolve: (result: { readonly cleanupFailed: boolean }) => void;
    }
  >();
  private readonly epubIpcCompletions = new Set<Promise<void>>();
  private readonly ownedEpubTemporaryPaths = new Map<
    string,
    "FILE" | "DIRECTORY"
  >();
  private epubShuttingDown = false;
  private epubShutdownPromise: Promise<void> | null = null;
  private readonly hwpxOutputSelections = new Map<
    string,
    HwpxOutputSelectionRecord
  >();
  private readonly hwpxOperations = new Map<string, HwpxOperationRecord>();
  private readonly usedHwpxOperationIds = new Set<string>();
  private readonly activeHwpxOperations = new Map<
    string,
    {
      readonly sessionId: string;
      readonly phase:
        | "PREPARING"
        | "EXPORTING"
        | "PROCESSING"
        | "FINALIZING";
    }
  >();
  private readonly cancelledHwpxOperations = new Set<string>();
  private readonly hwpxOperationCompletions = new Map<
    string,
    {
      readonly promise: Promise<{ readonly cleanupFailed: boolean }>;
      readonly resolve: (result: { readonly cleanupFailed: boolean }) => void;
    }
  >();
  private readonly hwpxIpcCompletions = new Set<Promise<void>>();
  private readonly ownedHwpxTemporaryDirectories = new Set<string>();
  private readonly registeredHwpxRecoveryDirectories = new Set<string>();
  private readonly preservedHwpxRecoveryDirectories = new Set<string>();
  private hwpxShuttingDown = false;
  private hwpxShutdownPromise: Promise<void> | null = null;
  private hancomProbePromise: Promise<HwpxExportState["hancom"]> | null = null;

  public constructor(
    private readonly window: BrowserWindow,
    private readonly dialog: DialogPort,
    private readonly core: CoreClient,
    private readonly sessions: ProjectSessionRegistry,
    private readonly appVersion: string,
    private readonly epubExporter?: EpubExporterPort,
    private readonly shellPort?: ShellPort,
    private readonly hwpxExporter?: HwpxExporterPort,
    private readonly hwpBridge?: HwpBridgePort,
    private readonly fontInstallation: FontInstallationPort =
      new WindowsFontInstallationDetector(),
    private readonly runtimePlatform: NodeJS.Platform = process.platform,
    private readonly hwpxCrashRecovery?: HwpxCrashRecoveryPort,
    private readonly atomicOutput?: AtomicOutputPort
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

  public async saveWorldGraphUiState(
    input: SaveWorldGraphUiStateRequest
  ): Promise<void> {
    if (!isRecord(input)) {
      throw new Error("Invalid world graph UI state request");
    }
    assertExactKeys(
      input,
      ["sessionId", "state"],
      "world graph UI state request"
    );
    const session = this.sessions.require(validateSessionId(input.sessionId));
    const state = validateWorldGraphUiState(input.state);
    const response = asRecord(
      await this.core.request("save_ui_state", {
        file_path: session.filePath,
        key: WORLD_GRAPH_UI_STATE_KEY,
        value: serializeWorldGraphUiState(state)
      }),
      "save world graph UI state response"
    );
    const stored = parseWorldGraphUiStateRecord(
      response.state,
      session.projectId
    );
    if (!worldGraphUiStateMatches(stored, state)) {
      throw new Error("The local core saved different world graph UI state");
    }
  }

  public async loadWorldGraphUiState(
    input: SessionRequest
  ): Promise<LoadWorldGraphUiStateResult> {
    if (!isRecord(input)) {
      throw new Error("Invalid world graph UI state request");
    }
    assertExactKeys(
      input,
      ["sessionId"],
      "world graph UI state request"
    );
    const session = this.sessions.require(validateSessionId(input.sessionId));
    const response = asRecord(
      await this.core.request("load_ui_state", {
        file_path: session.filePath,
        key: WORLD_GRAPH_UI_STATE_KEY
      }),
      "load world graph UI state response"
    );
    const stateRecord = optionalRecord(response, "state");
    if (!stateRecord) {
      return { state: null };
    }
    return {
      state: parseWorldGraphUiStateRecord(stateRecord, session.projectId)
    };
  }

  public async savePlotCanvasUiState(
    input: SavePlotCanvasUiStateRequest
  ): Promise<void> {
    const session = this.sessions.require(validateSessionId(input?.sessionId));
    const state = validatePlotCanvasUiState(input?.state);
    const response = asRecord(
      await this.core.request("save_ui_state", {
        file_path: session.filePath,
        key: PLOT_CANVAS_UI_STATE_KEY,
        value: serializePlotCanvasUiState(state)
      }),
      "save plot canvas UI state response"
    );
    const saved = parsePlotCanvasUiStateRecord(
      response.state,
      session.projectId
    );
    if (
      canonicalCanvasJson(serializePlotCanvasUiState(saved)) !==
      canonicalCanvasJson(serializePlotCanvasUiState(state))
    ) {
      throw new Error("The local core saved different plot canvas UI state");
    }
  }

  public async loadPlotCanvasUiState(
    input: SessionRequest
  ): Promise<LoadPlotCanvasUiStateResult> {
    const session = this.sessions.require(validateSessionId(input?.sessionId));
    const response = asRecord(
      await this.core.request("load_ui_state", {
        file_path: session.filePath,
        key: PLOT_CANVAS_UI_STATE_KEY
      }),
      "load plot canvas UI state response"
    );
    const stateRecord = optionalRecord(response, "state");
    return {
      state: stateRecord
        ? parsePlotCanvasUiStateRecord(stateRecord, session.projectId)
        : null
    };
  }

  public async saveReaderLabUiState(
    input: SaveReaderLabUiStateRequest
  ): Promise<void> {
    const session = this.sessions.require(validateSessionId(input?.sessionId));
    const state = validateReaderLabUiState(input?.state);
    const response = asRecord(
      await this.core.request("save_ui_state", {
        file_path: session.filePath,
        key: READER_LAB_UI_STATE_KEY,
        value: state
      }),
      "save reader lab UI state response"
    );
    const savedRecord = asRecord(response.state, "reader lab UI state record");
    if (
      requiredString(savedRecord, "project_id") !== session.projectId ||
      requiredString(savedRecord, "key") !== READER_LAB_UI_STATE_KEY
    ) {
      throw new Error("The local core returned cross-project Reader Lab UI state");
    }
    const saved = validateReaderLabUiState(savedRecord.value);
    if (canonicalCanvasJson(saved) !== canonicalCanvasJson(state)) {
      throw new Error("The local core saved different Reader Lab UI state");
    }
  }

  public async loadReaderLabUiState(
    input: SessionRequest
  ): Promise<LoadReaderLabUiStateResult> {
    const session = this.sessions.require(validateSessionId(input?.sessionId));
    const response = asRecord(
      await this.core.request("load_ui_state", {
        file_path: session.filePath,
        key: READER_LAB_UI_STATE_KEY
      }),
      "load reader lab UI state response"
    );
    const stateRecord = optionalRecord(response, "state");
    if (!stateRecord) {
      return { state: null };
    }
    if (
      requiredString(stateRecord, "project_id") !== session.projectId ||
      requiredString(stateRecord, "key") !== READER_LAB_UI_STATE_KEY
    ) {
      throw new Error("The local core returned cross-project Reader Lab UI state");
    }
    return { state: validateReaderLabUiState(stateRecord.value) };
  }

  public async compilePublication(
    input: CompilePublicationRequest
  ): Promise<CompilePublicationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const scopeNodeId = validateNodeId(input.scopeNodeId, "Publication scope node id");
    if (
      !Number.isSafeInteger(input.expectedProjectRevision) ||
      input.expectedProjectRevision < 0 ||
      input.expectedProjectRevision !== session.revision
    ) {
      throw new Error("Publication compile project revision is stale");
    }
    const response = asRecord(
      await this.core.request("compile_publication", {
        file_path: session.filePath,
        scope_node_id: scopeNodeId,
        expected_revision: input.expectedProjectRevision
      }),
      "compile publication response"
    );
    const revision = responseRevision(response, "compile publication");
    const document = validatePublicationDocument(response.document);
    if (
      document.projectId !== session.projectId ||
      document.projectRevision !== revision ||
      revision !== input.expectedProjectRevision ||
      document.scopeNodeId !== scopeNodeId
    ) {
      throw new Error("The local core compiled another Publication scope");
    }
    const compileTimingMs = requiredNumber(response, "compile_timing_ms");
    if (compileTimingMs < 0) {
      throw new Error("The local core returned invalid publication timing");
    }
    const result: CompilePublicationResult = {
      document,
      contentHash: validateSha256(response.content_hash, "publication content hash"),
      diagnostics: parsePublicationDiagnostics(response.diagnostics),
      compileTimingMs,
      revision
    };
    this.sessions.updateProject(sessionId, { revision });
    return result;
  }

  public async getPublicationStats(
    input: CompilePublicationRequest
  ): Promise<PublicationStatsResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const scopeNodeId = validateNodeId(input.scopeNodeId, "Publication scope node id");
    if (
      !Number.isSafeInteger(input.expectedProjectRevision) ||
      input.expectedProjectRevision < 0 ||
      input.expectedProjectRevision !== session.revision
    ) {
      throw new Error("Publication stats project revision is stale");
    }
    const response = asRecord(
      await this.core.request("get_publication_stats", {
        file_path: session.filePath,
        scope_node_id: scopeNodeId,
        expected_revision: input.expectedProjectRevision
      }),
      "publication stats response"
    );
    const revision = responseRevision(response, "publication stats");
    if (revision !== input.expectedProjectRevision) {
      throw new Error("The local core returned stale Publication statistics");
    }
    const compileTimingMs = requiredNumber(response, "compile_timing_ms");
    if (compileTimingMs < 0) {
      throw new Error("The local core returned invalid publication stats timing");
    }
    this.sessions.updateProject(sessionId, { revision });
    return {
      stats: parsePublicationSourceStatistics(response.stats),
      contentHash: validateSha256(response.content_hash, "publication stats hash"),
      diagnostics: parsePublicationDiagnostics(response.diagnostics),
      compileTimingMs,
      revision
    };
  }

  public async validatePublication(
    input: ValidatePublicationRequest
  ): Promise<ValidatePublicationResult> {
    const document = validatePublicationDocument(input?.document);
    const response = asRecord(
      await this.core.request("validate_publication", { document }),
      "validate publication response"
    );
    return {
      valid: requiredBoolean(response, "valid"),
      contentHash: validateSha256(response.content_hash, "validated publication hash"),
      diagnostics: parsePublicationDiagnostics(response.diagnostics)
    };
  }

  public async listReaderPresets(
    input: ListReaderPresetsRequest
  ): Promise<ListReaderPresetsResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const response = asRecord(
      await this.core.request("list_reader_presets", {
        file_path: session.filePath
      }),
      "list reader presets response"
    );
    if (!Array.isArray(response.presets)) {
      throw new Error("The local core returned invalid reader preset list");
    }
    const presets = response.presets.map((preset) =>
      parseReaderPreset(preset, session.projectId, validateReaderRenderConfig)
    );
    const nameCounts = new Map<string, number>();
    for (const preset of presets) {
      nameCounts.set(preset.name, (nameCounts.get(preset.name) ?? 0) + 1);
    }
    const revision = responseRevision(response, "list reader presets");
    if (!Array.isArray(response.duplicate_names)) {
      throw new Error("The local core returned invalid duplicate reader preset names");
    }
    const duplicateNames = response.duplicate_names.map((name) =>
      validateShortText(name, "Duplicate Reader preset name", 500)
    );
    const computedDuplicateNames = [...nameCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([name]) => name)
      .sort();
    if (
      canonicalCanvasJson([...new Set(duplicateNames)].sort()) !==
      canonicalCanvasJson(computedDuplicateNames)
    ) {
      throw new Error("The local core returned inconsistent duplicate reader preset names");
    }
    this.sessions.updateProject(sessionId, { revision });
    return {
      presets,
      duplicateNames: computedDuplicateNames,
      revision
    };
  }

  public async createReaderPreset(
    input: CreateReaderPresetRequest
  ): Promise<ReaderPresetMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const sourceKind = validateEnum(
      input.sourceKind,
      READER_PRESET_SOURCE_KINDS,
      "reader preset source kind"
    );
    const verificationStatus = validateEnum(
      input.verificationStatus,
      READER_VERIFICATION_STATUSES,
      "reader preset verification status"
    );
    const config = validateReaderRenderConfig(input.config);
    const response = asRecord(
      await this.core.request("create_reader_preset", {
        file_path: session.filePath,
        preset_id: randomUUID(),
        name: validateShortText(input.name, "Reader preset name", 500),
        source_kind: sourceKind,
        source_id:
          input.sourceId === undefined || input.sourceId === null
            ? null
            : validateShortText(input.sourceId, "Reader preset source id", 256),
        source_version:
          input.sourceVersion === undefined || input.sourceVersion === null
            ? null
            : validateShortText(
                input.sourceVersion,
                "Reader preset source version",
                128
              ),
        verification_status: verificationStatus,
        preset_format: "MADI_READER_PRESET",
        preset_version: 1,
        preset_json: config,
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "create reader preset response"
    );
    const revision = responseRevision(response, "create reader preset");
    const preset = parseReaderPreset(
      response.preset,
      session.projectId,
      validateReaderRenderConfig
    );
    const noOp = requiredBoolean(response, "no_op");
    this.sessions.updateProject(sessionId, { revision });
    return { preset, revision, noOp };
  }

  public async updateReaderPreset(
    input: UpdateReaderPresetRequest
  ): Promise<ReaderPresetMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    if (
      !Number.isSafeInteger(input.expectedPresetRevision) ||
      input.expectedPresetRevision < 0
    ) {
      throw new Error("Invalid expected Reader preset revision");
    }
    const response = asRecord(
      await this.core.request("update_reader_preset", {
        file_path: session.filePath,
        preset_id: validateShortText(input.presetId, "Reader preset id", 128),
        name: validateShortText(input.name, "Reader preset name", 500),
        verification_status: validateEnum(
          input.verificationStatus,
          READER_VERIFICATION_STATUSES,
          "reader preset verification status"
        ),
        preset_json: validateReaderRenderConfig(input.config),
        expected_revision: session.revision,
        expected_preset_revision: input.expectedPresetRevision,
        saved_by: `madi/${this.appVersion}`
      }),
      "update reader preset response"
    );
    const revision = responseRevision(response, "update reader preset");
    const preset = parseReaderPreset(
      response.preset,
      session.projectId,
      validateReaderRenderConfig
    );
    const noOp = requiredBoolean(response, "no_op");
    this.sessions.updateProject(sessionId, { revision });
    return { preset, revision, noOp };
  }

  public async duplicateReaderPreset(
    input: DuplicateReaderPresetRequest
  ): Promise<ReaderPresetMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const response = asRecord(
      await this.core.request("duplicate_reader_preset", {
        file_path: session.filePath,
        source_preset_id: validateShortText(
          input.sourcePresetId,
          "Source Reader preset id",
          128
        ),
        preset_id: randomUUID(),
        ...(input.name === undefined
          ? {}
          : { name: validateShortText(input.name, "Reader preset name", 500) }),
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "duplicate reader preset response"
    );
    const revision = responseRevision(response, "duplicate reader preset");
    const preset = parseReaderPreset(
      response.preset,
      session.projectId,
      validateReaderRenderConfig
    );
    const noOp = requiredBoolean(response, "no_op");
    this.sessions.updateProject(sessionId, { revision });
    return { preset, revision, noOp };
  }

  public async deleteReaderPreset(
    input: DeleteReaderPresetRequest
  ): Promise<DeleteReaderPresetResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const presetId = validateShortText(input.presetId, "Reader preset id", 128);
    if (
      !Number.isSafeInteger(input.expectedPresetRevision) ||
      input.expectedPresetRevision < 0
    ) {
      throw new Error("Invalid expected Reader preset revision");
    }
    const response = asRecord(
      await this.core.request("delete_reader_preset", {
        file_path: session.filePath,
        preset_id: presetId,
        expected_revision: session.revision,
        expected_preset_revision: input.expectedPresetRevision,
        saved_by: `madi/${this.appVersion}`
      }),
      "delete reader preset response"
    );
    const deletedPresetId = requiredString(response, "deleted_preset_id");
    if (deletedPresetId !== presetId) {
      throw new Error("The local core deleted another Reader preset");
    }
    const revision = responseRevision(response, "delete reader preset");
    this.sessions.updateProject(sessionId, { revision });
    return { deletedPresetId, revision };
  }

  public async getPublicationExportState(
    input: SessionRequest
  ): Promise<PublicationExportState> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const response = asRecord(
      await this.core.request("get_publication_export_state", {
        file_path: session.filePath
      }),
      "publication export state response"
    );
    assertRequiredExactKeys(
      response,
      [
        "metadata",
        "publication_metadata",
        "cover_asset",
        "export_presets",
        "revision"
      ],
      "publication export state response"
    );
    const metadata = parsePublicationExportMetadata(
      response.publication_metadata,
      session.projectId
    );
    const cover =
      response.cover_asset === null
        ? null
        : parsePublicationCover(response.cover_asset, session.projectId);
    if (metadata.coverAssetId !== (cover?.id ?? null)) {
      throw new Error("The local core returned inconsistent publication cover state");
    }
    const presets = parseExportPresets(
      response.export_presets,
      session.projectId
    ).epub;
    const revision = responseRevision(response, "publication export state");
    this.sessions.updateProject(sessionId, { revision });
    return {
      metadata,
      cover,
      presets,
      duplicatePresetNames: duplicateNames(presets),
      revision
    };
  }

  private getHancomAutomationAvailability(): Promise<HwpxExportState["hancom"]> {
    if (this.runtimePlatform !== "win32") {
      return Promise.resolve({ status: "UNAVAILABLE", reason: "NOT_WINDOWS" });
    }
    if (!this.hwpBridge) {
      return Promise.resolve({
        status: "UNAVAILABLE",
        reason: "BRIDGE_UNAVAILABLE"
      });
    }
    if (!this.hancomProbePromise) {
      this.hancomProbePromise = this.hwpBridge
        .probe()
        .then((probe): HwpxExportState["hancom"] => {
          if (probe.available) {
            return { status: "AVAILABLE", version: probe.hancomVersion };
          }
          if (probe.availabilityCode === "NOT_INSTALLED") {
            return { status: "UNAVAILABLE", reason: "NOT_INSTALLED" };
          }
          return {
            status: "REGISTERED_UNVERIFIED",
            version: probe.hancomVersion
          };
        })
        .catch((error): HwpxExportState["hancom"] => {
          if (
            error instanceof HwpBridgeOperationError &&
            error.code === "NOT_INSTALLED"
          ) {
            return { status: "UNAVAILABLE", reason: "NOT_INSTALLED" };
          }
          return { status: "UNAVAILABLE", reason: "BRIDGE_UNAVAILABLE" };
        });
    }
    return this.hancomProbePromise;
  }

  private async reportWithFontInstallation(
    report: HwpxExportReport
  ): Promise<HwpxExportReport> {
    let installed: boolean | null = null;
    try {
      installed = await this.fontInstallation.isInstalled(report.fontFamily);
    } catch {
      // Font detection is read-only best effort; the report remains explicit.
    }
    return hwpxReportWithFontInstallation(report, installed);
  }

  public async getHwpxExportState(
    input: SessionRequest
  ): Promise<HwpxExportState> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const response = asRecord(
      await this.core.request("get_publication_export_state", {
        file_path: session.filePath
      }),
      "publication export state response"
    );
    assertRequiredExactKeys(
      response,
      [
        "metadata",
        "publication_metadata",
        "cover_asset",
        "export_presets",
        "revision"
      ],
      "publication export state response"
    );
    const metadata = parsePublicationExportMetadata(
      response.publication_metadata,
      session.projectId
    );
    const presets = parseExportPresets(
      response.export_presets,
      session.projectId
    ).hwpx;
    const revision = responseRevision(response, "publication export state");
    this.sessions.updateProject(sessionId, { revision });
    return {
      metadata,
      presets,
      duplicatePresetNames: duplicateNames(presets),
      hancom: await this.getHancomAutomationAvailability(),
      revision
    };
  }

  public async createHwpxExportPreset(
    input: CreateHwpxExportPresetRequest
  ): Promise<HwpxExportPresetMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const presetId = randomUUID();
    const name = validateHwpxPresetName(input.name);
    const config = validateHwpxExportPresetConfig(input.config);
    const response = asRecord(
      await this.core.request("create_export_preset", {
        file_path: session.filePath,
        preset_id: presetId,
        kind: "HWPX",
        name,
        preset_json: config,
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "create HWPX export preset response"
    );
    assertRequiredExactKeys(
      response,
      ["metadata", "preset", "no_op", "revision"],
      "create HWPX export preset response"
    );
    const revision = responseRevision(response, "create HWPX export preset");
    const preset = parseHwpxExportPreset(response.preset, session.projectId);
    const noOp = requiredBoolean(response, "no_op");
    if (noOp) {
      throw new Error("The local core did not create the HWPX export preset");
    }
    assertHwpxPresetContent(preset, {
      id: presetId,
      name,
      config,
      revision: 0
    });
    assertEpubMutationRevision(
      session.revision,
      revision,
      false,
      "HWPX export preset creation"
    );
    this.sessions.updateProject(sessionId, { revision });
    return { preset, revision, noOp };
  }

  public async updateHwpxExportPreset(
    input: UpdateHwpxExportPresetRequest
  ): Promise<HwpxExportPresetMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    if (
      !Number.isSafeInteger(input.expectedPresetRevision) ||
      input.expectedPresetRevision < 0
    ) {
      throw new Error("Invalid expected HWPX export preset revision");
    }
    const presetId = validateHwpxIdentifier(
      input.presetId,
      "HWPX export preset id"
    );
    const name = validateHwpxPresetName(input.name);
    const config = validateHwpxExportPresetConfig(input.config);
    const response = asRecord(
      await this.core.request("update_export_preset", {
        file_path: session.filePath,
        preset_id: presetId,
        kind: "HWPX",
        name,
        preset_json: config,
        expected_revision: session.revision,
        expected_preset_revision: input.expectedPresetRevision,
        saved_by: `madi/${this.appVersion}`
      }),
      "update HWPX export preset response"
    );
    assertRequiredExactKeys(
      response,
      ["metadata", "preset", "no_op", "revision"],
      "update HWPX export preset response"
    );
    const revision = responseRevision(response, "update HWPX export preset");
    const preset = parseHwpxExportPreset(response.preset, session.projectId);
    const noOp = requiredBoolean(response, "no_op");
    assertHwpxPresetContent(preset, {
      id: presetId,
      name,
      config,
      revision: input.expectedPresetRevision + (noOp ? 0 : 1)
    });
    assertEpubMutationRevision(
      session.revision,
      revision,
      noOp,
      "HWPX export preset update"
    );
    this.sessions.updateProject(sessionId, { revision });
    return { preset, revision, noOp };
  }

  public async duplicateHwpxExportPreset(
    input: DuplicateHwpxExportPresetRequest
  ): Promise<HwpxExportPresetMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const sourcePresetId = validateHwpxIdentifier(
      input.sourcePresetId,
      "source HWPX export preset id"
    );
    const state = await this.getHwpxExportState({ sessionId });
    if (state.revision !== session.revision) {
      throw new Error("HWPX export presets changed before duplication");
    }
    const source = state.presets.find((preset) => preset.id === sourcePresetId);
    if (!source) {
      throw new Error("The source HWPX export preset is unavailable");
    }
    const presetId = randomUUID();
    const name =
      input.name === undefined ? undefined : validateHwpxPresetName(input.name);
    const response = asRecord(
      await this.core.request("duplicate_export_preset", {
        file_path: session.filePath,
        source_preset_id: sourcePresetId,
        preset_id: presetId,
        ...(name === undefined ? {} : { name }),
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "duplicate HWPX export preset response"
    );
    assertRequiredExactKeys(
      response,
      ["metadata", "preset", "no_op", "revision"],
      "duplicate HWPX export preset response"
    );
    const revision = responseRevision(response, "duplicate HWPX export preset");
    const preset = parseHwpxExportPreset(response.preset, session.projectId);
    const noOp = requiredBoolean(response, "no_op");
    if (noOp) {
      throw new Error("The local core did not duplicate the HWPX export preset");
    }
    assertHwpxPresetContent(preset, {
      id: presetId,
      ...(name === undefined ? {} : { name }),
      config: source.config,
      revision: 0
    });
    assertEpubMutationRevision(
      session.revision,
      revision,
      false,
      "HWPX export preset duplication"
    );
    this.sessions.updateProject(sessionId, { revision });
    return { preset, revision, noOp };
  }

  public async deleteHwpxExportPreset(
    input: DeleteHwpxExportPresetRequest
  ): Promise<DeleteHwpxExportPresetResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const presetId = validateHwpxIdentifier(
      input.presetId,
      "HWPX export preset id"
    );
    if (
      !Number.isSafeInteger(input.expectedPresetRevision) ||
      input.expectedPresetRevision < 0
    ) {
      throw new Error("Invalid expected HWPX export preset revision");
    }
    const response = asRecord(
      await this.core.request("delete_export_preset", {
        file_path: session.filePath,
        preset_id: presetId,
        expected_revision: session.revision,
        expected_preset_revision: input.expectedPresetRevision,
        saved_by: `madi/${this.appVersion}`
      }),
      "delete HWPX export preset response"
    );
    assertRequiredExactKeys(
      response,
      ["metadata", "deleted_preset_id", "revision"],
      "delete HWPX export preset response"
    );
    const deletedPresetId = requiredString(response, "deleted_preset_id");
    if (deletedPresetId !== presetId) {
      throw new Error("The local core deleted another HWPX export preset");
    }
    const revision = responseRevision(response, "delete HWPX export preset");
    if (revision !== session.revision + 1) {
      throw new Error("The local core returned an invalid preset deletion revision");
    }
    this.sessions.updateProject(sessionId, { revision });
    return { deletedPresetId, revision };
  }

  public async updatePublicationMetadata(
    input: UpdatePublicationMetadataRequest
  ): Promise<PublicationMetadataMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const metadata = validatePublicationMetadataInput({
      publicationTitle: input.publicationTitle,
      creatorName: input.creatorName,
      language: input.language,
      identifier: input.identifier,
      publisher: input.publisher,
      description: input.description,
      rights: input.rights,
      subjects: input.subjects
    });
    const response = asRecord(
      await this.core.request("update_publication_metadata", {
        file_path: session.filePath,
        publication_title: metadata.publicationTitle,
        creator_name: metadata.creatorName,
        language: metadata.language,
        identifier: metadata.identifier,
        publisher: metadata.publisher,
        description: metadata.description,
        rights: metadata.rights,
        subjects: metadata.subjects,
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "update publication metadata response"
    );
    assertRequiredExactKeys(
      response,
      ["metadata", "publication_metadata", "no_op", "revision"],
      "update publication metadata response"
    );
    const revision = responseRevision(response, "update publication metadata");
    const publicationMetadata = parsePublicationExportMetadata(
      response.publication_metadata,
      session.projectId
    );
    const noOp = requiredBoolean(response, "no_op");
    assertEditablePublicationMetadata(publicationMetadata, metadata);
    assertEpubMutationRevision(
      session.revision,
      revision,
      noOp,
      "publication metadata"
    );
    this.sessions.updateProject(sessionId, { revision });
    return { metadata: publicationMetadata, revision, noOp };
  }

  public async choosePublicationCover(
    input: ChoosePublicationCoverRequest
  ): Promise<PublicationCoverMutationResult | null> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const selection = await this.dialog.showOpenDialog(this.window, {
      title: "EPUB 표지 선택",
      filters: [{ name: "PNG 또는 JPEG 이미지", extensions: ["png", "jpg", "jpeg"] }],
      properties: ["openFile", "dontAddToRecent"]
    });
    if (selection.canceled || selection.filePaths.length !== 1) {
      return null;
    }
    const filePath = selection.filePaths[0]!;
    const bytes = await readBoundedFile(filePath, MAX_COVER_FILE_BYTES);
    const isPng =
      bytes.byteLength >= 8 &&
      bytes.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      );
    const isJpeg =
      bytes.byteLength >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff;
    if (!isPng && !isJpeg) {
      throw new Error("Cover must be a valid PNG or JPEG image");
    }
    const currentState = await this.getPublicationExportState({ sessionId });
    const expectedRevision = currentState.revision;
    const assetId = currentState.cover?.id ?? randomUUID();
    const mediaType = isPng ? "image/png" : "image/jpeg";
    const originalName = path.basename(filePath);
    const expectedSha256 = createHash("sha256").update(bytes).digest("hex");
    const response = asRecord(
      await this.core.request("set_publication_cover", {
        file_path: session.filePath,
        asset_id: assetId,
        media_type: mediaType,
        original_name: originalName,
        bytes_base64: bytes.toString("base64"),
        expected_revision: expectedRevision,
        saved_by: `madi/${this.appVersion}`
      }),
      "set publication cover response"
    );
    assertRequiredExactKeys(
      response,
      ["metadata", "asset", "publication_metadata", "no_op", "revision"],
      "set publication cover response"
    );
    const revision = responseRevision(response, "set publication cover");
    const cover = parsePublicationCover(response.asset, session.projectId);
    const metadata = parsePublicationExportMetadata(
      response.publication_metadata,
      session.projectId
    );
    if (metadata.coverAssetId !== cover.id) {
      throw new Error("The local core did not attach the saved publication cover");
    }
    const noOp = requiredBoolean(response, "no_op");
    if (
      cover.id !== assetId ||
      cover.mediaType !== mediaType ||
      cover.originalName !== originalName ||
      cover.sha256 !== expectedSha256 ||
      cover.byteLength !== bytes.byteLength
    ) {
      throw new Error("The local core saved a different publication cover");
    }
    assertEpubMutationRevision(
      expectedRevision,
      revision,
      noOp,
      "publication cover"
    );
    this.sessions.updateProject(sessionId, { revision });
    return { cover, metadata, revision, noOp };
  }

  public async removePublicationCover(
    input: SessionRequest
  ): Promise<PublicationCoverMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const currentState = await this.getPublicationExportState({ sessionId });
    const expectedRevision = currentState.revision;
    const expectedDeletedAssetId = currentState.cover?.id ?? null;
    const response = asRecord(
      await this.core.request("remove_publication_cover", {
        file_path: session.filePath,
        expected_revision: expectedRevision,
        saved_by: `madi/${this.appVersion}`
      }),
      "remove publication cover response"
    );
    assertRequiredExactKeys(
      response,
      [
        "metadata",
        "deleted_asset_id",
        "publication_metadata",
        "no_op",
        "revision"
      ],
      "remove publication cover response"
    );
    const revision = responseRevision(response, "remove publication cover");
    const metadata = parsePublicationExportMetadata(
      response.publication_metadata,
      session.projectId
    );
    if (metadata.coverAssetId !== null) {
      throw new Error("The local core retained the removed publication cover");
    }
    const noOp = requiredBoolean(response, "no_op");
    const deletedAssetId = response.deleted_asset_id;
    if (
      noOp !== (expectedDeletedAssetId === null) ||
      deletedAssetId !== expectedDeletedAssetId
    ) {
      throw new Error("The local core returned an invalid removed cover identity");
    }
    assertEpubMutationRevision(
      expectedRevision,
      revision,
      noOp,
      "publication cover removal"
    );
    this.sessions.updateProject(sessionId, { revision });
    return { cover: null, metadata, revision, noOp };
  }

  public async createEpubExportPreset(
    input: CreateEpubExportPresetRequest
  ): Promise<EpubExportPresetMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const presetId = randomUUID();
    const name = validateEpubPresetName(input.name);
    const config = validateEpubExportPresetConfig(input.config);
    const response = asRecord(
      await this.core.request("create_export_preset", {
        file_path: session.filePath,
        preset_id: presetId,
        kind: "EPUB",
        name,
        preset_json: config,
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "create EPUB export preset response"
    );
    assertRequiredExactKeys(
      response,
      ["metadata", "preset", "no_op", "revision"],
      "create EPUB export preset response"
    );
    const revision = responseRevision(response, "create EPUB export preset");
    const preset = parseEpubExportPreset(response.preset, session.projectId);
    const noOp = requiredBoolean(response, "no_op");
    if (noOp) {
      throw new Error("The local core did not create the EPUB export preset");
    }
    assertEpubPresetContent(preset, {
      id: presetId,
      name,
      config,
      revision: 0
    });
    assertEpubMutationRevision(
      session.revision,
      revision,
      false,
      "EPUB export preset creation"
    );
    this.sessions.updateProject(sessionId, { revision });
    return { preset, revision, noOp };
  }

  public async updateEpubExportPreset(
    input: UpdateEpubExportPresetRequest
  ): Promise<EpubExportPresetMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    if (
      !Number.isSafeInteger(input.expectedPresetRevision) ||
      input.expectedPresetRevision < 0
    ) {
      throw new Error("Invalid expected EPUB export preset revision");
    }
    const presetId = validateEpubIdentifier(
      input.presetId,
      "EPUB export preset id"
    );
    const name = validateEpubPresetName(input.name);
    const config = validateEpubExportPresetConfig(input.config);
    const response = asRecord(
      await this.core.request("update_export_preset", {
        file_path: session.filePath,
        preset_id: presetId,
        kind: "EPUB",
        name,
        preset_json: config,
        expected_revision: session.revision,
        expected_preset_revision: input.expectedPresetRevision,
        saved_by: `madi/${this.appVersion}`
      }),
      "update EPUB export preset response"
    );
    assertRequiredExactKeys(
      response,
      ["metadata", "preset", "no_op", "revision"],
      "update EPUB export preset response"
    );
    const revision = responseRevision(response, "update EPUB export preset");
    const preset = parseEpubExportPreset(response.preset, session.projectId);
    const noOp = requiredBoolean(response, "no_op");
    assertEpubPresetContent(preset, {
      id: presetId,
      name,
      config,
      revision: input.expectedPresetRevision + (noOp ? 0 : 1)
    });
    assertEpubMutationRevision(
      session.revision,
      revision,
      noOp,
      "EPUB export preset update"
    );
    this.sessions.updateProject(sessionId, { revision });
    return { preset, revision, noOp };
  }

  public async duplicateEpubExportPreset(
    input: DuplicateEpubExportPresetRequest
  ): Promise<EpubExportPresetMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const sourcePresetId = validateEpubIdentifier(
      input.sourcePresetId,
      "source EPUB export preset id"
    );
    const state = await this.getPublicationExportState({ sessionId });
    if (state.revision !== session.revision) {
      throw new Error("EPUB export presets changed before duplication");
    }
    const source = state.presets.find((preset) => preset.id === sourcePresetId);
    if (!source) {
      throw new Error("The source EPUB export preset is unavailable");
    }
    const presetId = randomUUID();
    const name =
      input.name === undefined ? undefined : validateEpubPresetName(input.name);
    const response = asRecord(
      await this.core.request("duplicate_export_preset", {
        file_path: session.filePath,
        source_preset_id: sourcePresetId,
        preset_id: presetId,
        ...(name === undefined ? {} : { name }),
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "duplicate EPUB export preset response"
    );
    assertRequiredExactKeys(
      response,
      ["metadata", "preset", "no_op", "revision"],
      "duplicate EPUB export preset response"
    );
    const revision = responseRevision(response, "duplicate EPUB export preset");
    const preset = parseEpubExportPreset(response.preset, session.projectId);
    const noOp = requiredBoolean(response, "no_op");
    if (noOp) {
      throw new Error("The local core did not duplicate the EPUB export preset");
    }
    assertEpubPresetContent(preset, {
      id: presetId,
      ...(name === undefined ? {} : { name }),
      config: source.config,
      revision: 0
    });
    assertEpubMutationRevision(
      session.revision,
      revision,
      false,
      "EPUB export preset duplication"
    );
    this.sessions.updateProject(sessionId, { revision });
    return { preset, revision, noOp };
  }

  public async deleteEpubExportPreset(
    input: DeleteEpubExportPresetRequest
  ): Promise<DeleteEpubExportPresetResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const presetId = validateEpubIdentifier(
      input.presetId,
      "EPUB export preset id"
    );
    if (
      !Number.isSafeInteger(input.expectedPresetRevision) ||
      input.expectedPresetRevision < 0
    ) {
      throw new Error("Invalid expected EPUB export preset revision");
    }
    const response = asRecord(
      await this.core.request("delete_export_preset", {
        file_path: session.filePath,
        preset_id: presetId,
        expected_revision: session.revision,
        expected_preset_revision: input.expectedPresetRevision,
        saved_by: `madi/${this.appVersion}`
      }),
      "delete EPUB export preset response"
    );
    assertRequiredExactKeys(
      response,
      ["metadata", "deleted_preset_id", "revision"],
      "delete EPUB export preset response"
    );
    const deletedPresetId = requiredString(response, "deleted_preset_id");
    if (deletedPresetId !== presetId) {
      throw new Error("The local core deleted another EPUB export preset");
    }
    const revision = responseRevision(response, "delete EPUB export preset");
    if (revision !== session.revision + 1) {
      throw new Error("The local core returned an invalid preset deletion revision");
    }
    this.sessions.updateProject(sessionId, { revision });
    return { deletedPresetId, revision };
  }

  public async chooseEpubOutput(
    input: ChooseEpubOutputRequest
  ): Promise<EpubOutputSelection | null> {
    const sessionId = validateSessionId(input?.sessionId);
    this.sessions.require(sessionId);
    const fileName = safeEpubFileName(input.suggestedFileName);
    const selection = await this.dialog.showSaveDialog(this.window, {
      title: "EPUB 내보내기",
      defaultPath: fileName,
      filters: [{ name: "EPUB publication", extensions: ["epub"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"]
    });
    if (selection.canceled || !selection.filePath) {
      return null;
    }
    if (!selection.filePath.toLocaleLowerCase().endsWith(".epub")) {
      throw new Error("EPUB destination must use the .epub extension");
    }
    const filePath = selection.filePath;
    const resolvedPath = path.resolve(filePath);
    let replaceExisting = false;
    let existingFile: EpubOutputSelectionRecord["existingFile"] = null;
    try {
      const existing = await stat(resolvedPath);
      if (!existing.isFile()) {
        throw new Error("EPUB destination is not a file");
      }
      replaceExisting = true;
      existingFile = await existingEpubIdentity(resolvedPath);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      ) {
        throw error;
      }
    }
    const selectionId = randomUUID();
    this.epubOutputSelections.set(selectionId, {
      sessionId,
      filePath: resolvedPath,
      fileName: path.basename(resolvedPath),
      replaceExisting,
      maximumBytes: MAX_EPUB_FILE_BYTES,
      existingFile
    });
    while (this.epubOutputSelections.size > 32) {
      this.epubOutputSelections.delete(
        this.epubOutputSelections.keys().next().value as string
      );
    }
    return { selectionId, fileName: path.basename(resolvedPath) };
  }

  private async prepareEpubUtilityInput(
    input: ValidateEpubExportRequest,
    mode: EpubExporterRunInput["mode"],
    outputPath: string,
    replaceExisting: boolean
  ): Promise<{
    readonly utilityInput: EpubExporterRunInput;
    readonly revision: number;
    readonly document: CompilePublicationResult["document"];
  }> {
    if (!this.epubExporter) {
      throw new Error("The local EPUB utility is unavailable");
    }
    const sessionId = validateSessionId(input?.sessionId);
    const operationId = validateEpubOperationId(input.operationId);
    const session = this.sessions.require(sessionId);
    if (
      !Number.isSafeInteger(input.expectedProjectRevision) ||
      input.expectedProjectRevision < 0 ||
      input.expectedProjectRevision !== session.revision
    ) {
      throw new Error("EPUB export project revision is stale");
    }
    const config = validateEpubExportPresetConfig(input.config);
    const rendererMetadataRecord = asRecord(
      input.metadata,
      "EPUB export metadata"
    );
    assertExactKeys(
      rendererMetadataRecord,
      [
        "projectId",
        "publicationTitle",
        "creatorName",
        "language",
        "identifier",
        "publisher",
        "description",
        "rights",
        "subjects",
        "coverAssetId",
        "createdAt",
        "updatedAt"
      ],
      "EPUB export metadata"
    );
    const rendererMetadata = validatePublicationMetadataInput({
      publicationTitle: rendererMetadataRecord.publicationTitle,
      creatorName: rendererMetadataRecord.creatorName,
      language: rendererMetadataRecord.language,
      identifier: rendererMetadataRecord.identifier,
      publisher: rendererMetadataRecord.publisher,
      description: rendererMetadataRecord.description,
      rights: rendererMetadataRecord.rights,
      subjects: rendererMetadataRecord.subjects
    });
    const exportStateResponse = asRecord(
      await this.core.request("get_publication_export_state", {
        file_path: session.filePath
      }),
      "publication export state response"
    );
    assertRequiredExactKeys(
      exportStateResponse,
      [
        "metadata",
        "publication_metadata",
        "cover_asset",
        "export_presets",
        "revision"
      ],
      "publication export state response"
    );
    const stateRevision = responseRevision(
      exportStateResponse,
      "publication export state"
    );
    if (this.cancelledEpubOperations.delete(operationId)) {
      throw new EpubExportCancelledError();
    }
    if (stateRevision !== input.expectedProjectRevision) {
      this.sessions.updateProject(sessionId, { revision: stateRevision });
      throw new Error("EPUB export project revision changed");
    }
    const metadata = parsePublicationExportMetadata(
      exportStateResponse.publication_metadata,
      session.projectId
    );
    const canonicalMetadata = validatePublicationMetadataInput(
      editableMetadataForValidation(metadata)
    );
    if (
      input.metadata.projectId !== session.projectId ||
      rendererMetadataRecord.coverAssetId !== metadata.coverAssetId ||
      rendererMetadataRecord.createdAt !== metadata.createdAt ||
      rendererMetadataRecord.updatedAt !== metadata.updatedAt ||
      canonicalCanvasJson(rendererMetadata) !== canonicalCanvasJson(canonicalMetadata)
    ) {
      throw new Error("EPUB export metadata is stale");
    }
    let cover: EpubExporterRunInput["cover"] = null;
    if (config.includeCover) {
      if (exportStateResponse.cover_asset === null || metadata.coverAssetId === null) {
        throw new Error("EPUB cover is missing");
      }
      const coverRecord = asRecord(
        exportStateResponse.cover_asset,
        "publication cover asset"
      );
      const parsedCover = parsePublicationCover(coverRecord, session.projectId);
      if (parsedCover.id !== metadata.coverAssetId) {
        throw new Error("EPUB cover metadata is inconsistent");
      }
      cover = {
        mediaType: parsedCover.mediaType,
        originalName: parsedCover.originalName,
        bytesBase64: requiredString(coverRecord, "bytes_base64")
      };
    }
    this.window.webContents.send(IPC_EVENTS.epubExportProgress, {
      operationId,
      stage: "PUBLICATION_COMPILE",
      completed: 0,
      total: 1
    });
    let compiled: CompilePublicationResult;
    let cancelled = false;
    try {
      compiled = await this.compilePublication({
        sessionId,
        scopeNodeId: validateNodeId(input.scopeNodeId, "EPUB scope node id"),
        expectedProjectRevision: stateRevision
      });
    } finally {
      cancelled = this.cancelledEpubOperations.delete(operationId);
    }
    if (cancelled) {
      throw new EpubExportCancelledError();
    }
    this.window.webContents.send(IPC_EVENTS.epubExportProgress, {
      operationId,
      stage: "PUBLICATION_COMPILE",
      completed: 1,
      total: 1
    });
    return {
      utilityInput: {
        operationId,
        mode,
        document: compiled.document,
        sourcePublicationHash: compiled.contentHash,
        metadata,
        config,
        outputPath,
        replaceExisting,
        cover
      },
      revision: compiled.revision,
      document: compiled.document
    };
  }

  private rememberEpubOperation(
    operationId: string,
    record: EpubOperationRecord
  ): void {
    this.epubOperations.set(operationId, record);
    while (this.epubOperations.size > 20) {
      this.epubOperations.delete(this.epubOperations.keys().next().value as string);
    }
  }

  private beginEpubOperation(operationId: string, sessionId: string): void {
    if (this.epubShuttingDown) {
      throw new Error("EPUB operations are shutting down");
    }
    if (
      this.usedEpubOperationIds.has(operationId) ||
      this.activeEpubOperations.has(operationId)
    ) {
      throw new Error("EPUB operation id was already used");
    }
    this.usedEpubOperationIds.add(operationId);
    while (this.usedEpubOperationIds.size > 1_024) {
      this.usedEpubOperationIds.delete(
        this.usedEpubOperationIds.values().next().value as string
      );
    }
    this.activeEpubOperations.set(operationId, {
      sessionId,
      phase: "PREPARING"
    });
    let resolveCompletion!: (result: {
      readonly cleanupFailed: boolean;
    }) => void;
    const promise = new Promise<{ readonly cleanupFailed: boolean }>((resolve) => {
      resolveCompletion = resolve;
    });
    this.epubOperationCompletions.set(operationId, {
      promise,
      resolve: resolveCompletion
    });
  }

  private finishEpubOperation(
    operationId: string,
    cleanupFailed = false
  ): void {
    this.activeEpubOperations.delete(operationId);
    this.cancelledEpubOperations.delete(operationId);
    const completion = this.epubOperationCompletions.get(operationId);
    this.epubOperationCompletions.delete(operationId);
    completion?.resolve({ cleanupFailed });
  }

  public async runEpubIpcTask<T>(task: () => Promise<T>): Promise<T> {
    if (this.epubShuttingDown) {
      throw new Error("EPUB operations are shutting down");
    }
    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    this.epubIpcCompletions.add(completion);
    try {
      return await task();
    } finally {
      this.epubIpcCompletions.delete(completion);
      resolveCompletion();
    }
  }

  private transitionEpubOperationToExporting(
    operationId: string,
    sessionId: string
  ): void {
    if (
      this.epubShuttingDown ||
      this.cancelledEpubOperations.delete(operationId)
    ) {
      throw new EpubExportCancelledError();
    }
    this.activeEpubOperations.set(operationId, {
      sessionId,
      phase: "EXPORTING"
    });
  }

  private async cleanupOwnedEpubTemporaryPath(filePath: string): Promise<void> {
    const kind = this.ownedEpubTemporaryPaths.get(filePath);
    if (!kind) {
      return;
    }
    try {
      if (kind === "DIRECTORY") {
        await removeOwnedEpubDirectory(filePath);
      } else {
        await removeStagedEpub(filePath);
      }
      this.ownedEpubTemporaryPaths.delete(filePath);
    } catch {
      throw new Error("An owned EPUB temporary file could not be removed");
    }
  }

  private async commitStagedEpub(
    stagedPath: string,
    stagedDirectory: string,
    selection: EpubOutputSelectionRecord
  ): Promise<void> {
    if (!selection.replaceExisting) {
      try {
        await link(stagedPath, selection.filePath);
      } catch (error) {
        if (
          error instanceof Error &&
          (error as NodeJS.ErrnoException).code === "EEXIST"
        ) {
          throw new EpubDestinationChangedError();
        }
        throw error;
      }
      return;
    }
    if (!selection.existingFile) {
      throw new Error("The confirmed EPUB destination identity is missing");
    }
    const backupPath = path.join(
      stagedDirectory,
      "confirmed-destination.epub"
    );
    await rename(selection.filePath, backupPath);
    try {
      const claimed = await existingEpubIdentity(
        backupPath,
        selection.maximumBytes
      );
      if (
        claimed.byteLength !== selection.existingFile.byteLength ||
        claimed.sha256 !== selection.existingFile.sha256
      ) {
        throw new Error("The confirmed EPUB destination changed during export");
      }
      await link(stagedPath, selection.filePath);
    } catch (error) {
      try {
        await link(backupPath, selection.filePath);
      } catch {
        // A concurrent writer now owns the destination. Preserve the displaced
        // confirmed file in the private operation directory instead of
        // overwriting either file or deleting the only recoverable copy.
        this.ownedEpubTemporaryPaths.delete(stagedDirectory);
        throw new Error(EPUB_RECOVERY_PRESERVED_ERROR);
      }
      throw error;
    }
  }

  private async waitForEpubOperationCompletion(
    completion: Promise<{ readonly cleanupFailed: boolean }>
  ): Promise<{ readonly cleanupFailed: boolean }> {
    let timeout: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        completion,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("The EPUB operation did not stop")),
            25_000
          );
        })
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private async waitForEpubIpcCompletion(
    completion: Promise<void>
  ): Promise<void> {
    let timeout: NodeJS.Timeout | null = null;
    try {
      await Promise.race([
        completion,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("The EPUB IPC task did not stop")),
            25_000
          );
        })
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  public async validateEpubExport(
    input: ValidateEpubExportRequest
  ): Promise<ValidateEpubExportResult> {
    const operationId = validateEpubOperationId(input?.operationId);
    const sessionId = validateSessionId(input?.sessionId);
    this.sessions.require(sessionId);
    this.beginEpubOperation(operationId, sessionId);
    try {
      const prepared = await this.prepareEpubUtilityInput(
        input,
        "VALIDATE_ONLY",
        path.join(tmpdir(), `madi-epub-validation-${operationId}.epub`),
        false
      );
      try {
        this.transitionEpubOperationToExporting(operationId, sessionId);
        const utility = await this.epubExporter!.run(
          prepared.utilityInput,
          (progress) =>
            this.window.webContents.send(IPC_EVENTS.epubExportProgress, progress)
        );
        this.activeEpubOperations.set(operationId, {
          sessionId,
          phase: "FINALIZING"
        });
        const report = reportFromUtility(
          utility,
          prepared.document,
          prepared.utilityInput.config,
          prepared.revision,
          this.appVersion
        );
        this.rememberEpubOperation(operationId, {
          sessionId: input.sessionId,
          report,
          outputPath: null
        });
        return {
          operationId,
          sourcePublicationHash: utility.summary.sourcePublicationHash,
          report,
          revision: prepared.revision
        };
      } catch (error) {
        if (!(error instanceof EpubUtilityValidationError)) {
          throw error;
        }
        const report = validationFailureReport(
          prepared.document,
          prepared.utilityInput.sourcePublicationHash,
          prepared.utilityInput.config.targetProfile,
          error.report,
          this.appVersion
        );
        this.rememberEpubOperation(operationId, {
          sessionId: input.sessionId,
          report,
          outputPath: null
        });
        return {
          operationId,
          sourcePublicationHash: prepared.utilityInput.sourcePublicationHash,
          report,
          revision: prepared.revision
        };
      }
    } finally {
      this.finishEpubOperation(operationId);
    }
  }

  public async runEpubExport(
    input: RunEpubExportRequest
  ): Promise<RunEpubExportResult> {
    const operationId = validateEpubOperationId(input?.operationId);
    const sessionId = validateSessionId(input?.sessionId);
    this.sessions.require(sessionId);
    const selectionId = validateEpubIdentifier(
      input.outputSelectionId,
      "EPUB output selection id"
    );
    const selection = this.epubOutputSelections.get(selectionId);
    if (!selection || selection.sessionId !== input.sessionId) {
      throw new Error("EPUB output selection is missing or belongs to another project");
    }
    this.beginEpubOperation(operationId, sessionId);
    this.epubOutputSelections.delete(selectionId);
    const stagedDirectory = stagedEpubDirectory(
      selection.filePath,
      operationId
    );
    const stagedPath = stagedEpubPath(stagedDirectory);
    let stagedDirectoryOwned = false;
    let committed = false;
    try {
      await mkdir(stagedDirectory);
      stagedDirectoryOwned = true;
      this.ownedEpubTemporaryPaths.set(stagedDirectory, "DIRECTORY");
      const prepared = await this.prepareEpubUtilityInput(
        input,
        "EXPORT",
        stagedPath,
        true
      );
      this.transitionEpubOperationToExporting(operationId, sessionId);
      const utility = await this.epubExporter!.run(
        prepared.utilityInput,
        (progress) =>
          this.window.webContents.send(IPC_EVENTS.epubExportProgress, progress)
      );
      this.activeEpubOperations.set(operationId, {
        sessionId,
        phase: "FINALIZING"
      });
      const report = reportFromUtility(
        utility,
        prepared.document,
        prepared.utilityInput.config,
        prepared.revision,
        this.appVersion
      );
      if (report.validation.status !== "VALID" || utility.outputPath === null) {
        throw new Error("The EPUB utility did not produce a valid output");
      }
      const stagedIdentity = await existingEpubIdentity(stagedPath);
      if (
        stagedIdentity.byteLength < 1 ||
        stagedIdentity.byteLength > MAX_EPUB_FILE_BYTES ||
        stagedIdentity.byteLength !== utility.summary.byteLength ||
        stagedIdentity.sha256 !== utility.summary.sha256
      ) {
        throw new Error("The generated EPUB does not match the export result");
      }
      await this.commitStagedEpub(
        stagedPath,
        stagedDirectory,
        selection
      );
      committed = true;
      this.rememberEpubOperation(operationId, {
        sessionId: input.sessionId,
        report,
        outputPath: selection.filePath
      });
      return {
        status: "COMPLETED",
        operationId,
        fileName: selection.fileName,
        byteLength: utility.summary.byteLength,
        sha256: utility.summary.sha256,
        report,
        revision: prepared.revision
      };
    } catch (error) {
      if (error instanceof EpubExportCancelledError) {
        return {
          status: "CANCELLED",
          operationId
        };
      }
      if (error instanceof EpubDestinationChangedError) {
        return {
          status: "FAILED",
          operationId,
          code: "DESTINATION_CHANGED"
        };
      }
      throw error;
    } finally {
      let cleanupFailed = false;
      try {
        if (stagedDirectoryOwned) {
          await this.cleanupOwnedEpubTemporaryPath(stagedDirectory);
        }
      } catch {
        cleanupFailed = true;
        if (!committed) {
          throw new Error("The staged EPUB file could not be removed");
        }
      } finally {
        this.finishEpubOperation(operationId, cleanupFailed);
      }
    }
  }

  public prepareEpubShutdown(): Promise<void> {
    if (this.epubShutdownPromise) {
      return this.epubShutdownPromise;
    }
    this.epubShuttingDown = true;
    const attempt = Promise.all([
      this.shutdownEpubOperations(),
      this.prepareHwpxShutdown()
    ]).then(() => undefined);
    this.epubShutdownPromise = attempt;
    void attempt.catch(() => {
      if (this.epubShutdownPromise === attempt) {
        this.epubShutdownPromise = null;
      }
    });
    return attempt;
  }

  private async shutdownEpubOperations(): Promise<void> {
    const operations = [...this.activeEpubOperations.entries()];
    const ipcCompletions = [...this.epubIpcCompletions];
    const results = await Promise.allSettled([
      ...operations.map(async ([operationId, active]) => {
        const completionPromise = this.epubOperationCompletions.get(operationId)
          ?.promise;
        if (!completionPromise) {
          throw new Error("The EPUB completion state is missing");
        }
        if (active.phase === "PREPARING") {
          this.cancelledEpubOperations.add(operationId);
        } else if (active.phase === "EXPORTING") {
          try {
            await this.epubExporter?.cancel(operationId);
          } catch {
            // Exporter disposal runs concurrently at application shutdown and
            // owns its process-scoped cleanup backlog.
          }
        }
        return this.waitForEpubOperationCompletion(completionPromise);
      }),
      ...ipcCompletions.map((completion) =>
        this.waitForEpubIpcCompletion(completion)
      )
    ]);
    if (results.some((result) => result.status === "rejected")) {
      // A bounded wait expiring does not transfer ownership of a path away
      // from the still-running task. Let the next shutdown attempt observe its
      // completion instead of deleting a file that task may still be using.
      throw new Error("EPUB operations did not stop within the shutdown bound");
    }
    const cleanupResults = await Promise.allSettled(
      [...this.ownedEpubTemporaryPaths.keys()].map((filePath) =>
        this.cleanupOwnedEpubTemporaryPath(filePath)
      )
    );
    if (
      cleanupResults.some((result) => result.status === "rejected") ||
      this.ownedEpubTemporaryPaths.size > 0
    ) {
      throw new Error("EPUB operations did not shut down cleanly");
    }
  }

  public async cancelEpubExport(input: CancelEpubExportRequest): Promise<boolean> {
    const operationId = validateEpubOperationId(input?.operationId);
    const sessionId = validateSessionId(input?.sessionId);
    const active = this.activeEpubOperations.get(operationId);
    if (!active || active.sessionId !== sessionId) {
      return false;
    }
    if (active.phase === "PREPARING") {
      this.cancelledEpubOperations.add(operationId);
      return true;
    }
    if (active.phase === "EXPORTING") {
      return this.epubExporter?.cancel(operationId) ?? false;
    }
    return false;
  }

  public async saveEpubExportReport(
    input: SaveEpubExportReportRequest
  ): Promise<SaveEpubExportReportResult | null> {
    const operationId = validateEpubOperationId(input?.operationId);
    const sessionId = validateSessionId(input?.sessionId);
    const record = this.epubOperations.get(operationId);
    if (!record || record.sessionId !== sessionId) {
      throw new Error("EPUB export report is unavailable");
    }
    if (input.format !== "JSON" && input.format !== "MARKDOWN") {
      throw new Error("Unsupported EPUB export report format");
    }
    const extension = input.format === "JSON" ? "json" : "md";
    const result = await this.dialog.showSaveDialog(this.window, {
      title: "EPUB export report 저장",
      defaultPath: `madi-epub-export-report.${extension}`,
      filters: [
        {
          name: input.format === "JSON" ? "JSON report" : "Markdown report",
          extensions: [extension]
        }
      ],
      properties: ["createDirectory", "showOverwriteConfirmation"]
    });
    if (result.canceled || !result.filePath) {
      return null;
    }
    if (!result.filePath.toLocaleLowerCase().endsWith(`.${extension}`)) {
      throw new Error(`EPUB report destination must use the .${extension} extension`);
    }
    const filePath = path.resolve(result.filePath);
    const source =
      input.format === "JSON"
        ? `${JSON.stringify(record.report, null, 2)}\n`
        : markdownExportReport(record.report);
    const byteLength = Buffer.byteLength(source, "utf8");
    if (byteLength < 1 || byteLength > MAX_EPUB_REPORT_BYTES) {
      throw new Error("EPUB export report exceeds the size limit");
    }
    let existingFile: EpubOutputSelectionRecord["existingFile"] = null;
    let replaceExisting = false;
    try {
      existingFile = await existingEpubIdentity(
        filePath,
        MAX_EPUB_REPORT_BYTES
      );
      replaceExisting = true;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      ) {
        throw error;
      }
    }
    const stagedDirectory = path.join(
      path.dirname(filePath),
      `.madi-epub-report-${operationId}-${extension}`
    );
    const stagedPath = path.join(stagedDirectory, `report.${extension}`);
    let stagedDirectoryOwned = false;
    let committed = false;
    try {
      await mkdir(stagedDirectory);
      stagedDirectoryOwned = true;
      this.ownedEpubTemporaryPaths.set(stagedDirectory, "DIRECTORY");
      const handle = await open(stagedPath, "wx");
      try {
        await handle.writeFile(source, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.commitStagedEpub(stagedPath, stagedDirectory, {
        sessionId,
        filePath,
        fileName: path.basename(filePath),
        replaceExisting,
        maximumBytes: MAX_EPUB_REPORT_BYTES,
        existingFile
      });
      committed = true;
    } finally {
      if (stagedDirectoryOwned) {
        try {
          await this.cleanupOwnedEpubTemporaryPath(stagedDirectory);
        } catch {
          if (!committed) {
            throw new Error("The staged EPUB report could not be removed");
          }
        }
      }
    }
    return {
      fileName: path.basename(filePath),
      byteLength
    };
  }

  public async revealEpubExport(input: RevealEpubExportRequest): Promise<boolean> {
    const operationId = validateEpubOperationId(input?.operationId);
    const sessionId = validateSessionId(input?.sessionId);
    const record = this.epubOperations.get(operationId);
    if (
      !record?.outputPath ||
      record.sessionId !== sessionId ||
      !this.shellPort
    ) {
      return false;
    }
    const fileStat = await stat(record.outputPath);
    if (!fileStat.isFile()) {
      return false;
    }
    this.shellPort.showItemInFolder(record.outputPath);
    return true;
  }

  public async chooseHwpxOutput(
    input: ChooseHwpxOutputRequest
  ): Promise<HwpxOutputSelection | null> {
    const sessionId = validateSessionId(input?.sessionId);
    this.sessions.require(sessionId);
    if (input.outputType !== "HWPX" && input.outputType !== "HWP") {
      throw new Error("Unsupported HWPX output type");
    }
    const extension = input.outputType === "HWPX" ? "hwpx" : "hwp";
    const fileName = safeHwpxFileName(input.suggestedFileName, input.outputType);
    const selection = await this.dialog.showSaveDialog(this.window, {
      title: input.outputType === "HWPX" ? "HWPX 내보내기" : "HWP 내보내기",
      defaultPath: fileName,
      filters: [
        {
          name: input.outputType === "HWPX" ? "HWPX publication" : "HWP document",
          extensions: [extension]
        }
      ],
      properties: ["createDirectory", "showOverwriteConfirmation"]
    });
    if (selection.canceled || !selection.filePath) {
      return null;
    }
    if (!selection.filePath.toLocaleLowerCase().endsWith(`.${extension}`)) {
      throw new Error(`HWPX destination must use the .${extension} extension`);
    }
    const resolvedPath = path.resolve(selection.filePath);
    let replaceExisting = false;
    let existingFile: HwpxOutputSelectionRecord["existingFile"] = null;
    let atomicIdentity: AtomicOutputIdentity | null = null;
    try {
      const existing = await stat(resolvedPath);
      if (!existing.isFile()) {
        throw new Error("HWPX destination is not a file");
      }
      replaceExisting = true;
      existingFile = await existingEpubIdentity(
        resolvedPath,
        MAX_HWPX_FILE_BYTES
      );
      if (!this.atomicOutput) {
        throw new Error("The atomic output utility is unavailable");
      }
      atomicIdentity = await this.atomicOutput.inspect(
        resolvedPath,
        MAX_HWPX_FILE_BYTES
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      ) {
        throw error;
      }
    }
    const selectionId = randomUUID();
    this.hwpxOutputSelections.set(selectionId, {
      sessionId,
      filePath: resolvedPath,
      fileName: path.basename(resolvedPath),
      outputType: input.outputType,
      replaceExisting,
      maximumBytes: MAX_HWPX_FILE_BYTES,
      existingFile,
      atomicIdentity
    });
    while (this.hwpxOutputSelections.size > 32) {
      this.hwpxOutputSelections.delete(
        this.hwpxOutputSelections.keys().next().value as string
      );
    }
    return {
      selectionId,
      fileName: path.basename(resolvedPath),
      outputType: input.outputType
    };
  }

  private async prepareHwpxUtilityInput(
    input: ValidateHwpxExportRequest,
    mode: HwpxExporterRunInput["mode"],
    outputPath: string,
    replaceExisting: boolean
  ): Promise<{
    readonly utilityInput: HwpxExporterRunInput;
    readonly revision: number;
    readonly document: CompilePublicationResult["document"];
  }> {
    if (!this.hwpxExporter) {
      throw new Error("The local HWPX utility is unavailable");
    }
    const sessionId = validateSessionId(input?.sessionId);
    const operationId = validateHwpxOperationId(input.operationId);
    const session = this.sessions.require(sessionId);
    if (
      !Number.isSafeInteger(input.expectedProjectRevision) ||
      input.expectedProjectRevision < 0 ||
      input.expectedProjectRevision !== session.revision
    ) {
      throw new Error("HWPX export project revision is stale");
    }
    const scopeKind = validateEnum(
      input.scopeKind,
      TREE_NODE_KINDS,
      "HWPX scope kind"
    );
    const suppliedConfig = validateHwpxExportPresetConfig(input.config);
    const presetId = validateHwpxIdentifier(input.presetId, "HWPX preset id");
    const suppliedPresetHash = validateSha256(
      input.presetContentHash,
      "HWPX preset content hash"
    );
    const rendererMetadataRecord = asRecord(
      input.metadata,
      "HWPX export metadata"
    );
    assertExactKeys(
      rendererMetadataRecord,
      [
        "projectId",
        "publicationTitle",
        "creatorName",
        "language",
        "identifier",
        "publisher",
        "description",
        "rights",
        "subjects",
        "coverAssetId",
        "createdAt",
        "updatedAt"
      ],
      "HWPX export metadata"
    );
    const rendererMetadata = validatePublicationMetadataInput({
      publicationTitle: rendererMetadataRecord.publicationTitle,
      creatorName: rendererMetadataRecord.creatorName,
      language: rendererMetadataRecord.language,
      identifier: rendererMetadataRecord.identifier,
      publisher: rendererMetadataRecord.publisher,
      description: rendererMetadataRecord.description,
      rights: rendererMetadataRecord.rights,
      subjects: rendererMetadataRecord.subjects
    });
    const titlePageRecord = asRecord(input.titlePage, "HWPX title page");
    assertExactKeys(
      titlePageRecord,
      ["subtitle", "genre", "contact"],
      "HWPX title page"
    );
    const titlePage = {
      subtitle: validateHwpxFrontMatterText(
        titlePageRecord.subtitle,
        "HWPX subtitle"
      ),
      genre: validateHwpxFrontMatterText(titlePageRecord.genre, "HWPX genre"),
      contact: validateHwpxFrontMatterText(
        titlePageRecord.contact,
        "HWPX contact"
      )
    };
    if (
      !suppliedConfig.includeTitlePage &&
      (titlePage.subtitle !== null ||
        titlePage.genre !== null ||
        titlePage.contact !== null)
    ) {
      throw new Error("HWPX title-page fields require the title page option");
    }
    const exportStateResponse = asRecord(
      await this.core.request("get_publication_export_state", {
        file_path: session.filePath
      }),
      "publication export state response"
    );
    assertRequiredExactKeys(
      exportStateResponse,
      [
        "metadata",
        "publication_metadata",
        "cover_asset",
        "export_presets",
        "revision"
      ],
      "publication export state response"
    );
    const stateRevision = responseRevision(
      exportStateResponse,
      "publication export state"
    );
    if (this.cancelledHwpxOperations.delete(operationId)) {
      throw new HwpxExportCancelledError();
    }
    if (stateRevision !== input.expectedProjectRevision) {
      this.sessions.updateProject(sessionId, { revision: stateRevision });
      throw new Error("HWPX export project revision changed");
    }
    const metadata = parsePublicationExportMetadata(
      exportStateResponse.publication_metadata,
      session.projectId
    );
    const canonicalMetadata = validatePublicationMetadataInput(
      editableMetadataForValidation(metadata)
    );
    if (
      input.metadata.projectId !== session.projectId ||
      rendererMetadataRecord.coverAssetId !== metadata.coverAssetId ||
      rendererMetadataRecord.createdAt !== metadata.createdAt ||
      rendererMetadataRecord.updatedAt !== metadata.updatedAt ||
      canonicalCanvasJson(rendererMetadata) !== canonicalCanvasJson(canonicalMetadata)
    ) {
      throw new Error("HWPX export metadata is stale");
    }
    const storedPresets = parseExportPresets(
      exportStateResponse.export_presets,
      session.projectId
    ).hwpx;
    let config: HwpxExportPresetConfig;
    let presetContentHash: string;
    const builtIn = BUILT_IN_HWPX_PRESETS.find(
      (candidate) => candidate.id === presetId
    );
    if (builtIn) {
      const canonicalBuiltIn = validateHwpxExportPresetConfig(builtIn.config);
      if (
        canonicalCanvasJson(suppliedConfig) !==
        canonicalCanvasJson(canonicalBuiltIn)
      ) {
        throw new Error("The HWPX built-in preset configuration was modified");
      }
      config = canonicalBuiltIn;
      presetContentHash = canonicalJsonSha256(config);
    } else if (presetId === "ONE_OFF") {
      config = suppliedConfig;
      presetContentHash = canonicalJsonSha256(config);
    } else {
      const stored = storedPresets.find((preset) => preset.id === presetId);
      if (!stored) {
        throw new Error("The selected HWPX export preset is unavailable");
      }
      const computedHash = canonicalJsonSha256(stored.config);
      if (
        stored.contentHash !== computedHash ||
        suppliedPresetHash !== stored.contentHash ||
        canonicalCanvasJson(suppliedConfig) !== canonicalCanvasJson(stored.config)
      ) {
        throw new Error("The selected HWPX export preset is stale");
      }
      config = stored.config;
      presetContentHash = stored.contentHash;
    }
    this.window.webContents.send(IPC_EVENTS.hwpxExportProgress, {
      operationId,
      stage: "PUBLICATION_COMPILE",
      completed: 0,
      total: 1
    });
    let compiled: CompilePublicationResult;
    let cancelled = false;
    try {
      compiled = await this.compilePublication({
        sessionId,
        scopeNodeId: validateNodeId(input.scopeNodeId, "HWPX scope node id"),
        expectedProjectRevision: stateRevision
      });
    } finally {
      cancelled = this.cancelledHwpxOperations.delete(operationId);
    }
    if (cancelled) {
      throw new HwpxExportCancelledError();
    }
    if (compiled.document.scopeKind !== scopeKind) {
      throw new Error("The HWPX scope kind does not match Publication IR");
    }
    this.window.webContents.send(IPC_EVENTS.hwpxExportProgress, {
      operationId,
      stage: "PUBLICATION_COMPILE",
      completed: 1,
      total: 1
    });
    return {
      utilityInput: {
        operationId,
        mode,
        document: compiled.document,
        sourcePublicationHash: compiled.contentHash,
        presetId,
        presetContentHash,
        metadata,
        titlePage,
        config,
        outputPath,
        replaceExisting
      },
      revision: compiled.revision,
      document: compiled.document
    };
  }

  private rememberHwpxOperation(
    operationId: string,
    record: HwpxOperationRecord
  ): void {
    this.hwpxOperations.set(operationId, record);
    while (this.hwpxOperations.size > 20) {
      this.hwpxOperations.delete(this.hwpxOperations.keys().next().value as string);
    }
  }

  private beginHwpxOperation(operationId: string, sessionId: string): void {
    if (this.hwpxShuttingDown) {
      throw new Error("HWPX operations are shutting down");
    }
    if (
      this.usedHwpxOperationIds.has(operationId) ||
      this.activeHwpxOperations.has(operationId)
    ) {
      throw new Error("HWPX operation id was already used");
    }
    this.usedHwpxOperationIds.add(operationId);
    while (this.usedHwpxOperationIds.size > 1_024) {
      this.usedHwpxOperationIds.delete(
        this.usedHwpxOperationIds.values().next().value as string
      );
    }
    this.activeHwpxOperations.set(operationId, {
      sessionId,
      phase: "PREPARING"
    });
    let resolveCompletion!: (result: {
      readonly cleanupFailed: boolean;
    }) => void;
    const promise = new Promise<{ readonly cleanupFailed: boolean }>((resolve) => {
      resolveCompletion = resolve;
    });
    this.hwpxOperationCompletions.set(operationId, {
      promise,
      resolve: resolveCompletion
    });
  }

  private finishHwpxOperation(
    operationId: string,
    cleanupFailed = false
  ): void {
    this.activeHwpxOperations.delete(operationId);
    this.cancelledHwpxOperations.delete(operationId);
    const completion = this.hwpxOperationCompletions.get(operationId);
    this.hwpxOperationCompletions.delete(operationId);
    completion?.resolve({ cleanupFailed });
  }

  public async runHwpxIpcTask<T>(task: () => Promise<T>): Promise<T> {
    if (this.hwpxShuttingDown) {
      throw new Error("HWPX operations are shutting down");
    }
    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    this.hwpxIpcCompletions.add(completion);
    try {
      return await task();
    } finally {
      this.hwpxIpcCompletions.delete(completion);
      resolveCompletion();
    }
  }

  private transitionHwpxOperationToExporting(
    operationId: string,
    sessionId: string
  ): void {
    if (
      this.hwpxShuttingDown ||
      this.cancelledHwpxOperations.delete(operationId)
    ) {
      throw new HwpxExportCancelledError();
    }
    this.activeHwpxOperations.set(operationId, {
      sessionId,
      phase: "EXPORTING"
    });
  }

  private ensureHwpxOperationContinues(operationId: string): void {
    if (
      this.hwpxShuttingDown ||
      this.cancelledHwpxOperations.has(operationId)
    ) {
      throw new HwpxExportCancelledError();
    }
  }

  private transitionHwpxOperationToFinalizing(
    operationId: string,
    sessionId: string
  ): void {
    this.ensureHwpxOperationContinues(operationId);
    this.activeHwpxOperations.set(operationId, {
      sessionId,
      phase: "FINALIZING"
    });
  }

  private transitionHwpxOperationToProcessing(
    operationId: string,
    sessionId: string
  ): void {
    this.ensureHwpxOperationContinues(operationId);
    this.activeHwpxOperations.set(operationId, {
      sessionId,
      phase: "PROCESSING"
    });
  }

  private async cleanupOwnedHwpxDirectory(directoryPath: string): Promise<void> {
    if (!this.ownedHwpxTemporaryDirectories.has(directoryPath)) {
      return;
    }
    if (this.preservedHwpxRecoveryDirectories.has(directoryPath)) {
      return;
    }
    if (this.registeredHwpxRecoveryDirectories.has(directoryPath)) {
      if (!this.hwpxCrashRecovery) {
        throw new Error("The HWPX crash recovery registry is unavailable");
      }
      await this.hwpxCrashRecovery.remove(directoryPath);
      this.registeredHwpxRecoveryDirectories.delete(directoryPath);
    } else {
      await removeOwnedHwpxDirectory(directoryPath);
    }
    this.ownedHwpxTemporaryDirectories.delete(directoryPath);
  }

  private async registerOwnedHwpxDirectory(
    directoryPath: string
  ): Promise<void> {
    this.ownedHwpxTemporaryDirectories.add(directoryPath);
    if (!this.hwpxCrashRecovery) {
      throw new Error("The HWPX crash recovery registry is unavailable");
    }
    await this.hwpxCrashRecovery.register(directoryPath);
    this.registeredHwpxRecoveryDirectories.add(directoryPath);
  }

  private async commitStagedHwpx(
    stagedPath: string,
    selection: HwpxOutputSelectionRecord
  ): Promise<void> {
    if (!selection.replaceExisting) {
      try {
        await link(stagedPath, selection.filePath);
      } catch (error) {
        if (
          error instanceof Error &&
          (error as NodeJS.ErrnoException).code === "EEXIST"
        ) {
          throw new HwpxDestinationChangedError();
        }
        throw error;
      }
      return;
    }
    if (!selection.existingFile) {
      throw new Error("The confirmed HWPX destination identity is missing");
    }
    if (!selection.atomicIdentity || !this.atomicOutput || !this.hwpxCrashRecovery) {
      throw new Error("The recoverable atomic output utility is unavailable");
    }
    const stagedDirectory = path.dirname(stagedPath);
    const privateId = randomUUID();
    const backupPath = path.join(
      stagedDirectory,
      `madi-atomic-backup-${privateId}.bin`
    );
    const rollbackPath = path.join(
      stagedDirectory,
      `madi-atomic-rollback-${privateId}.bin`
    );
    const extension = path.extname(selection.filePath);
    const baseName = path.basename(selection.filePath, extension);
    const recoveryPath = path.join(
      path.dirname(selection.filePath),
      `${baseName}.madi-recovery-${randomUUID()}${extension}`
    );
    const stagedIdentity = await this.atomicOutput.inspect(
      stagedPath,
      selection.maximumBytes
    );
    await this.hwpxCrashRecovery.prepareAtomicOutput(stagedDirectory, {
      stagedPath,
      destinationPath: selection.filePath,
      backupPath,
      rollbackPath,
      recoveryPath,
      maximumBytes: selection.maximumBytes,
      expected: selection.atomicIdentity,
      stagedIdentity
    });
    try {
      await this.atomicOutput.commit({
        stagedPath,
        destinationPath: selection.filePath,
        backupPath,
        rollbackPath,
        maximumBytes: selection.maximumBytes,
        expected: selection.atomicIdentity,
        stagedIdentity
      });
      await this.hwpxCrashRecovery.markAtomicOutputTerminal(
        stagedDirectory,
        "COMMITTED"
      );
    } catch (error) {
      const reconciliation =
        await this.hwpxCrashRecovery.reconcileAtomicOutput(stagedDirectory);
      if (reconciliation.status === "RECOVERY_REQUIRED") {
        this.preservedHwpxRecoveryDirectories.add(stagedDirectory);
        throw new HwpxRecoveryRequiredError(null);
      }
      await this.hwpxCrashRecovery.markAtomicOutputTerminal(
        stagedDirectory,
        "ABORTED_SAFE"
      );
      if (reconciliation.status === "RECOVERY_PUBLISHED") {
        throw new HwpxRecoveryRequiredError(reconciliation.recoveryFileName);
      }
      if (
        error instanceof AtomicOutputError &&
        error.code === "DESTINATION_CHANGED"
      ) {
        throw new HwpxDestinationChangedError();
      }
      throw error;
    }
  }

  public async validateHwpxExport(
    input: ValidateHwpxExportRequest
  ): Promise<ValidateHwpxExportResult> {
    const operationId = validateHwpxOperationId(input?.operationId);
    const sessionId = validateSessionId(input?.sessionId);
    this.sessions.require(sessionId);
    this.beginHwpxOperation(operationId, sessionId);
    try {
      const prepared = await this.prepareHwpxUtilityInput(
        input,
        "VALIDATE_ONLY",
        path.join(tmpdir(), `madi-hwpx-validation-${operationId}.hwpx`),
        false
      );
      try {
        this.transitionHwpxOperationToExporting(operationId, sessionId);
        const utility = await this.hwpxExporter!.run(
          prepared.utilityInput,
          (progress) =>
            this.window.webContents.send(IPC_EVENTS.hwpxExportProgress, progress)
        );
        this.transitionHwpxOperationToProcessing(operationId, sessionId);
        const report = await this.reportWithFontInstallation(
          hwpxReportFromUtility(
            utility,
            prepared.document,
            prepared.utilityInput.config,
            prepared.utilityInput.sourcePublicationHash,
            prepared.utilityInput.presetId,
            prepared.utilityInput.presetContentHash,
            prepared.revision,
            this.appVersion
          )
        );
        this.transitionHwpxOperationToFinalizing(operationId, sessionId);
        this.rememberHwpxOperation(operationId, {
          sessionId,
          report,
          outputPath: null
        });
        return {
          operationId,
          sourcePublicationHash: utility.summary.sourcePublicationHash,
          report,
          revision: prepared.revision
        };
      } catch (error) {
        if (!(error instanceof HwpxUtilityValidationError)) {
          throw error;
        }
        const report = await this.reportWithFontInstallation(
          hwpxValidationFailureReport(
            prepared.document,
            prepared.utilityInput.sourcePublicationHash,
            prepared.utilityInput.config,
            prepared.utilityInput.presetId,
            prepared.utilityInput.presetContentHash,
            error.report,
            this.appVersion
          )
        );
        this.transitionHwpxOperationToFinalizing(operationId, sessionId);
        this.rememberHwpxOperation(operationId, {
          sessionId,
          report,
          outputPath: null
        });
        return {
          operationId,
          sourcePublicationHash: prepared.utilityInput.sourcePublicationHash,
          report,
          revision: prepared.revision
        };
      }
    } finally {
      this.finishHwpxOperation(operationId);
    }
  }

  public async runHwpxExport(
    input: RunHwpxExportRequest
  ): Promise<RunHwpxExportResult> {
    const operationId = validateHwpxOperationId(input?.operationId);
    const sessionId = validateSessionId(input?.sessionId);
    this.sessions.require(sessionId);
    if (input.outputType !== "HWPX" && input.outputType !== "HWP") {
      throw new Error("Unsupported HWPX output type");
    }
    const selectionId = validateHwpxIdentifier(
      input.outputSelectionId,
      "HWPX output selection id"
    );
    const selection = this.hwpxOutputSelections.get(selectionId);
    if (
      !selection ||
      selection.sessionId !== sessionId ||
      selection.outputType !== input.outputType
    ) {
      throw new Error("HWPX output selection is missing or belongs to another project");
    }
    this.beginHwpxOperation(operationId, sessionId);
    this.hwpxOutputSelections.delete(selectionId);
    if (input.outputType === "HWP") {
      let hancom: HwpxExportState["hancom"];
      try {
        hancom = await this.getHancomAutomationAvailability();
        this.ensureHwpxOperationContinues(operationId);
      } catch (error) {
        this.finishHwpxOperation(operationId);
        if (error instanceof HwpxExportCancelledError) {
          return { status: "CANCELLED", operationId };
        }
        throw new Error("The local HWP bridge availability check failed");
      }
      if (hancom.status !== "AVAILABLE" || !this.hwpBridge) {
        this.finishHwpxOperation(operationId);
        return {
          status: "FAILED",
          operationId,
          code: "HWP_CONVERSION_UNAVAILABLE"
        };
      }
    }
    const stagedDirectory = stagedHwpxDirectory(
      selection.filePath,
      operationId
    );
    const stagedPath = stagedHwpxPath(stagedDirectory);
    const stagedHwp = stagedHwpPath(stagedDirectory);
    const stagedPreservedHwpx = stagedPreservedHwpxPath(stagedDirectory);
    const stagedRecoveryHwpx = stagedRecoveryHwpxPath(stagedDirectory);
    const hwpOutput = input.outputType === "HWP";
    let preservedHwpxPath = hwpOutput
      ? preservedHwpxCompanionPath(selection.filePath)
      : null;
    let stagedDirectoryOwned = false;
    let committed = false;
    let hwpxPreserved = false;
    let trustedHwpxIdentity: NonNullable<
      HwpxOutputSelectionRecord["existingFile"]
    > | null = null;
    let reportForFailure: HwpxExportReport | null = null;
    const publishAlternatePreservedHwpx = async (
      expected: NonNullable<HwpxOutputSelectionRecord["existingFile"]>
    ): Promise<void> => {
      if (!preservedHwpxPath) {
        throw new Error("The preserved HWPX destination is unavailable");
      }
      const extension = path.extname(preservedHwpxPath);
      const base = path.basename(preservedHwpxPath, extension);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const candidate = path.join(
          path.dirname(preservedHwpxPath),
          `${base}.madi-preserved-${randomUUID()}${extension}`
        );
        try {
          await link(stagedRecoveryHwpx, candidate);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            continue;
          }
          try {
            await copyFile(
              stagedRecoveryHwpx,
              candidate,
              fsConstants.COPYFILE_EXCL
            );
          } catch (copyError) {
            if ((copyError as NodeJS.ErrnoException).code === "EEXIST") {
              continue;
            }
            throw copyError;
          }
        }
        const candidateHandle = await open(candidate, "r+");
        try {
          await candidateHandle.sync();
        } finally {
          await candidateHandle.close();
        }
        const visible = await existingEpubIdentity(
          candidate,
          MAX_HWPX_FILE_BYTES
        );
        if (
          visible.byteLength !== expected.byteLength ||
          visible.sha256 !== expected.sha256
        ) {
          throw new Error("The preserved HWPX output identity changed");
        }
        preservedHwpxPath = candidate;
        return;
      }
      throw new Error("A no-clobber HWPX recovery name is unavailable");
    };
    const ensurePreservedHwpxIdentity = async (
      expected: NonNullable<HwpxOutputSelectionRecord["existingFile"]>
    ): Promise<void> => {
      if (!hwpxPreserved || !preservedHwpxPath) {
        return;
      }
      try {
        const visible = await existingEpubIdentity(
          preservedHwpxPath,
          MAX_HWPX_FILE_BYTES
        );
        if (
          visible.byteLength === expected.byteLength &&
          visible.sha256 === expected.sha256
        ) {
          return;
        }
      } catch {
        // Publish an alternate no-clobber copy below.
      }
      await publishAlternatePreservedHwpx(expected);
    };
    try {
      await mkdir(stagedDirectory);
      stagedDirectoryOwned = true;
      await this.registerOwnedHwpxDirectory(stagedDirectory);
      const prepared = await this.prepareHwpxUtilityInput(
        input,
        "EXPORT",
        stagedPath,
        true
      );
      this.transitionHwpxOperationToExporting(operationId, sessionId);
      const utility = await this.hwpxExporter!.run(
        prepared.utilityInput,
        (progress) => {
          if (!hwpOutput || progress.stage !== "FINALIZE") {
            this.window.webContents.send(
              IPC_EVENTS.hwpxExportProgress,
              progress
            );
          }
        }
      );
      this.transitionHwpxOperationToProcessing(operationId, sessionId);
      const hwpxReport = await this.reportWithFontInstallation(
        hwpxReportFromUtility(
          utility,
          prepared.document,
          prepared.utilityInput.config,
          prepared.utilityInput.sourcePublicationHash,
          prepared.utilityInput.presetId,
          prepared.utilityInput.presetContentHash,
          prepared.revision,
          this.appVersion
        )
      );
      this.ensureHwpxOperationContinues(operationId);
      if (
        hwpxReport.validation.status !== "VALID" ||
        utility.outputPath === null
      ) {
        throw new Error("The HWPX utility did not produce a valid output");
      }
      const stagedIdentity = await existingEpubIdentity(
        stagedPath,
        MAX_HWPX_FILE_BYTES
      );
      if (
        stagedIdentity.byteLength < 1 ||
        stagedIdentity.byteLength !== utility.summary.byteLength ||
        stagedIdentity.sha256 !== utility.summary.sha256
      ) {
        throw new Error("The generated HWPX does not match the export result");
      }
      trustedHwpxIdentity = stagedIdentity;

      let outputPath = stagedPath;
      let outputIdentity = stagedIdentity;
      let report = hwpxReport;
      if (hwpOutput) {
        const bridge = this.hwpBridge!;
        let conversionMs = 0;
        let reopenMs: number | null = null;
        await copyFile(
          stagedPath,
          stagedPreservedHwpx,
          fsConstants.COPYFILE_EXCL
        );
        await copyFile(
          stagedPath,
          stagedRecoveryHwpx,
          fsConstants.COPYFILE_EXCL
        );
        const preservedStagedHandle = await open(stagedPreservedHwpx, "r+");
        try {
          await preservedStagedHandle.sync();
        } finally {
          await preservedStagedHandle.close();
        }
        const recoveryStagedHandle = await open(stagedRecoveryHwpx, "r+");
        try {
          await recoveryStagedHandle.sync();
        } finally {
          await recoveryStagedHandle.close();
        }
        const preservedStagedIdentity = await existingEpubIdentity(
          stagedPreservedHwpx,
          MAX_HWPX_FILE_BYTES
        );
        const recoveryStagedIdentity = await existingEpubIdentity(
          stagedRecoveryHwpx,
          MAX_HWPX_FILE_BYTES
        );
        if (
          preservedStagedIdentity.byteLength !== stagedIdentity.byteLength ||
          preservedStagedIdentity.sha256 !== stagedIdentity.sha256 ||
          recoveryStagedIdentity.byteLength !== stagedIdentity.byteLength ||
          recoveryStagedIdentity.sha256 !== stagedIdentity.sha256
        ) {
          throw new Error("The preserved HWPX staging copy does not match the export");
        }
        try {
          await link(stagedPreservedHwpx, preservedHwpxPath!);
        } catch (error) {
          if (
            error instanceof Error &&
            (error as NodeJS.ErrnoException).code === "EEXIST"
          ) {
            await publishAlternatePreservedHwpx(stagedIdentity);
          } else {
            throw error;
          }
        }
        hwpxPreserved = true;
        await ensurePreservedHwpxIdentity(stagedIdentity);
        const preservedHwpxFileName = path.basename(preservedHwpxPath!);
        reportForFailure = hwpxReportForHwp(hwpxReport, {
          preservedHwpxFileName,
          outputSha256: null,
          byteLength: null,
          hwpConverted: false,
          hancomReopen: "NOT_RUN",
          hwpConversionMs: 0,
          hwpReopenMs: null
        });
        this.rememberHwpxOperation(operationId, {
          sessionId,
          report: reportForFailure,
          outputPath: preservedHwpxPath
        });
        this.window.webContents.send(IPC_EVENTS.hwpxExportProgress, {
          operationId,
          stage: "HWP_CONVERSION",
          completed: 0,
          total: 1
        });
        this.ensureHwpxOperationContinues(operationId);
        const bridgeInputIdentity = await existingEpubIdentity(
          stagedPath,
          MAX_HWPX_FILE_BYTES
        );
        if (
          bridgeInputIdentity.byteLength !== stagedIdentity.byteLength ||
          bridgeInputIdentity.sha256 !== stagedIdentity.sha256
        ) {
          throw new HwpBridgeOperationError("INPUT_IDENTITY_MISMATCH");
        }
        this.ensureHwpxOperationContinues(operationId);
        this.transitionHwpxOperationToExporting(operationId, sessionId);
        const conversionStartedAt = Date.now();
        let conversion: Awaited<ReturnType<HwpBridgePort["convert"]>>;
        try {
          conversion = await bridge.convert(operationId, stagedPath, stagedHwp);
        } catch (error) {
          conversionMs = Math.max(0, Date.now() - conversionStartedAt);
          reportForFailure = hwpxReportForHwp(hwpxReport, {
            preservedHwpxFileName,
            outputSha256: null,
            byteLength: null,
            hwpConverted: false,
            hancomReopen: "NOT_RUN",
            hwpConversionMs: conversionMs,
            hwpReopenMs: null
          });
          throw error instanceof HwpBridgeCancelledError ||
            error instanceof HwpBridgeOperationError
            ? error
            : new HwpBridgeOperationError("CONVERSION_FAILED");
        }
        conversionMs = Math.max(0, Date.now() - conversionStartedAt);
        this.transitionHwpxOperationToProcessing(operationId, sessionId);
        const postConversionInputIdentity = await existingEpubIdentity(
          stagedPath,
          MAX_HWPX_FILE_BYTES
        );
        if (
          postConversionInputIdentity.byteLength !== stagedIdentity.byteLength ||
          postConversionInputIdentity.sha256 !== stagedIdentity.sha256
        ) {
          throw new HwpBridgeOperationError("INPUT_IDENTITY_MISMATCH");
        }
        reportForFailure = hwpxReportForHwp(hwpxReport, {
          preservedHwpxFileName,
          outputSha256: null,
          byteLength: null,
          hwpConverted: false,
          hancomReopen: "NOT_RUN",
          hwpConversionMs: conversionMs,
          hwpReopenMs: null
        });
        this.ensureHwpxOperationContinues(operationId);
        let convertedIdentity: Awaited<ReturnType<typeof existingEpubIdentity>>;
        try {
          convertedIdentity = await existingEpubIdentity(
            stagedHwp,
            MAX_HWPX_FILE_BYTES
          );
          if (
            convertedIdentity.byteLength < 1 ||
            convertedIdentity.byteLength !== conversion.byteLength ||
            convertedIdentity.sha256 !== conversion.sha256
          ) {
            throw new HwpBridgeOperationError("OUTPUT_IDENTITY_MISMATCH");
          }
        } catch (error) {
          throw error instanceof HwpBridgeOperationError
            ? error
            : new HwpBridgeOperationError("OUTPUT_IDENTITY_MISMATCH");
        }
        reportForFailure = hwpxReportForHwp(hwpxReport, {
          preservedHwpxFileName,
          outputSha256: convertedIdentity.sha256,
          byteLength: convertedIdentity.byteLength,
          hwpConverted: true,
          hancomReopen: "NOT_RUN",
          hwpConversionMs: conversionMs,
          hwpReopenMs: null
        });
        this.window.webContents.send(IPC_EVENTS.hwpxExportProgress, {
          operationId,
          stage: "HWP_CONVERSION",
          completed: 1,
          total: 1
        });
        this.window.webContents.send(IPC_EVENTS.hwpxExportProgress, {
          operationId,
          stage: "REOPEN_VERIFICATION",
          completed: 0,
          total: 1
        });
        this.ensureHwpxOperationContinues(operationId);
        this.transitionHwpxOperationToExporting(operationId, sessionId);
        const reopenStartedAt = Date.now();
        try {
          await bridge.reopen(operationId, stagedHwp);
        } catch (error) {
          reopenMs = Math.max(0, Date.now() - reopenStartedAt);
          reportForFailure = hwpxReportForHwp(hwpxReport, {
            preservedHwpxFileName,
            outputSha256: convertedIdentity.sha256,
            byteLength: convertedIdentity.byteLength,
            hwpConverted: true,
            hancomReopen: "FAILED",
            hwpConversionMs: conversionMs,
            hwpReopenMs: reopenMs
          });
          throw error instanceof HwpBridgeCancelledError ||
            error instanceof HwpBridgeOperationError
            ? error
            : new HwpBridgeOperationError("REOPEN_FAILED");
        }
        reopenMs = Math.max(0, Date.now() - reopenStartedAt);
        this.transitionHwpxOperationToProcessing(operationId, sessionId);
        const reopenedIdentity = await existingEpubIdentity(
          stagedHwp,
          MAX_HWPX_FILE_BYTES
        );
        if (
          reopenedIdentity.byteLength !== convertedIdentity.byteLength ||
          reopenedIdentity.sha256 !== convertedIdentity.sha256
        ) {
          throw new HwpBridgeOperationError("REOPEN_IDENTITY_MISMATCH");
        }
        await ensurePreservedHwpxIdentity(stagedIdentity);
        const finalPreservedHwpxFileName = path.basename(preservedHwpxPath!);
        this.window.webContents.send(IPC_EVENTS.hwpxExportProgress, {
          operationId,
          stage: "REOPEN_VERIFICATION",
          completed: 1,
          total: 1
        });
        outputPath = stagedHwp;
        outputIdentity = reopenedIdentity;
        report = hwpxReportForHwp(hwpxReport, {
          preservedHwpxFileName: finalPreservedHwpxFileName,
          outputSha256: reopenedIdentity.sha256,
          byteLength: reopenedIdentity.byteLength,
          hwpConverted: true,
          hancomReopen: "PASSED",
          hwpConversionMs: conversionMs,
          hwpReopenMs: reopenMs
        });
        reportForFailure = report;
      }

      this.transitionHwpxOperationToFinalizing(operationId, sessionId);
      if (hwpOutput) {
        this.window.webContents.send(IPC_EVENTS.hwpxExportProgress, {
          operationId,
          stage: "FINALIZE",
          completed: 0,
          total: 1
        });
      }
      await this.commitStagedHwpx(outputPath, selection);
      committed = true;
      if (hwpOutput) {
        this.window.webContents.send(IPC_EVENTS.hwpxExportProgress, {
          operationId,
          stage: "FINALIZE",
          completed: 1,
          total: 1
        });
      }
      this.rememberHwpxOperation(operationId, {
        sessionId,
        report,
        outputPath: selection.filePath
      });
      return {
        status: "COMPLETED",
        operationId,
        fileName: selection.fileName,
        byteLength: outputIdentity.byteLength,
        sha256: outputIdentity.sha256,
        report,
        revision: prepared.revision
      };
    } catch (error) {
      if (hwpxPreserved) {
        try {
          if (!trustedHwpxIdentity) {
            throw new Error("The trusted HWPX identity is unavailable");
          }
          await ensurePreservedHwpxIdentity(trustedHwpxIdentity);
          if (reportForFailure && preservedHwpxPath) {
            reportForFailure = {
              ...reportForFailure,
              preservedHwpxFileName: path.basename(preservedHwpxPath)
            };
          }
        } catch {
          throw new Error("A verified public HWPX recovery copy could not be preserved");
        }
      }
      if (hwpxPreserved && reportForFailure && preservedHwpxPath) {
        this.rememberHwpxOperation(operationId, {
          sessionId,
          report: reportForFailure,
          outputPath: preservedHwpxPath
        });
      }
      if (
        error instanceof HwpxExportCancelledError ||
        error instanceof HwpBridgeCancelledError
      ) {
        if (hwpxPreserved && reportForFailure && preservedHwpxPath) {
          return {
            status: "CANCELLED",
            operationId,
            preservedHwpxFileName: path.basename(preservedHwpxPath),
            report: reportForFailure
          };
        }
        return { status: "CANCELLED", operationId };
      }
      if (error instanceof HwpxDestinationChangedError) {
        if (hwpxPreserved && reportForFailure && preservedHwpxPath) {
          return {
            status: "FAILED",
            operationId,
            code: "DESTINATION_CHANGED",
            preservedHwpxFileName: path.basename(preservedHwpxPath),
            report: reportForFailure
          };
        }
        return {
          status: "FAILED",
          operationId,
          code: "DESTINATION_CHANGED"
        };
      }
      if (error instanceof HwpxRecoveryRequiredError) {
        return {
          status: "FAILED",
          operationId,
          code: "RECOVERY_REQUIRED",
          recoveryFileName: error.recoveryFileName
        };
      }
      if (error instanceof HwpBridgeOperationError) {
        if (!hwpxPreserved || !reportForFailure || !preservedHwpxPath) {
          throw error;
        }
        return {
          status: "FAILED",
          operationId,
          code: "HWP_CONVERSION_FAILED",
          preservedHwpxFileName: path.basename(preservedHwpxPath),
          report: reportForFailure
        };
      }
      if (hwpxPreserved && reportForFailure && preservedHwpxPath) {
        return {
          status: "FAILED",
          operationId,
          code: "HWP_OUTPUT_FAILED",
          preservedHwpxFileName: path.basename(preservedHwpxPath),
          report: reportForFailure
        };
      }
      throw error;
    } finally {
      let cleanupFailed = false;
      try {
        if (stagedDirectoryOwned) {
          await this.cleanupOwnedHwpxDirectory(stagedDirectory);
        }
      } catch {
        cleanupFailed = true;
        if (!committed && !hwpxPreserved) {
          throw new Error("The staged HWPX/HWP files could not be removed");
        }
      } finally {
        this.finishHwpxOperation(operationId, cleanupFailed);
      }
    }
  }

  public prepareHwpxShutdown(): Promise<void> {
    if (this.hwpxShutdownPromise) {
      return this.hwpxShutdownPromise;
    }
    this.hwpxShuttingDown = true;
    const attempt = this.shutdownHwpxOperations();
    this.hwpxShutdownPromise = attempt;
    void attempt.catch(() => {
      if (this.hwpxShutdownPromise === attempt) {
        this.hwpxShutdownPromise = null;
      }
    });
    return attempt;
  }

  private async waitForHwpxCompletion<T>(
    completion: Promise<T>,
    label: string
  ): Promise<T> {
    let timeout: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        completion,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error(label)), 25_000);
        })
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private async shutdownHwpxOperations(): Promise<void> {
    const operations = [...this.activeHwpxOperations.entries()];
    const ipcCompletions = [...this.hwpxIpcCompletions];
    const results = await Promise.allSettled([
      ...operations.map(async ([operationId, active]) => {
        const completion = this.hwpxOperationCompletions.get(operationId)?.promise;
        if (!completion) {
          throw new Error("The HWPX completion state is missing");
        }
        if (active.phase === "PREPARING") {
          this.cancelledHwpxOperations.add(operationId);
        } else if (active.phase === "PROCESSING") {
          this.cancelledHwpxOperations.add(operationId);
        } else if (active.phase === "EXPORTING") {
          this.cancelledHwpxOperations.add(operationId);
          await Promise.allSettled([
            this.hwpxExporter?.cancel(operationId),
            this.hwpBridge?.cancel(operationId)
          ]);
        }
        return this.waitForHwpxCompletion(
          completion,
          "The HWPX operation did not stop"
        );
      }),
      ...ipcCompletions.map((completion) =>
        this.waitForHwpxCompletion(completion, "The HWPX IPC task did not stop")
      )
    ]);
    if (results.some((result) => result.status === "rejected")) {
      throw new Error("HWPX operations did not stop within the shutdown bound");
    }
    const cleanup = await Promise.allSettled(
      [...this.ownedHwpxTemporaryDirectories].map((directory) =>
        this.cleanupOwnedHwpxDirectory(directory)
      )
    );
    if (
      cleanup.some((result) => result.status === "rejected") ||
      this.ownedHwpxTemporaryDirectories.size > 0
    ) {
      throw new Error("HWPX operations did not shut down cleanly");
    }
  }

  public async cancelHwpxExport(
    input: CancelHwpxExportRequest
  ): Promise<boolean> {
    const operationId = validateHwpxOperationId(input?.operationId);
    const sessionId = validateSessionId(input?.sessionId);
    const active = this.activeHwpxOperations.get(operationId);
    if (!active || active.sessionId !== sessionId) {
      return false;
    }
    if (active.phase === "PREPARING") {
      this.cancelledHwpxOperations.add(operationId);
      return true;
    }
    if (active.phase === "PROCESSING") {
      this.cancelledHwpxOperations.add(operationId);
      return true;
    }
    if (active.phase === "EXPORTING") {
      const results = await Promise.allSettled([
        this.hwpxExporter?.cancel(operationId) ?? Promise.resolve(false),
        this.hwpBridge?.cancel(operationId) ?? Promise.resolve(false)
      ]);
      const accepted = results.some(
        (result) => result.status === "fulfilled" && result.value === true
      );
      if (accepted) {
        this.cancelledHwpxOperations.add(operationId);
      }
      return accepted;
    }
    return false;
  }

  public async saveHwpxExportReport(
    input: SaveHwpxExportReportRequest
  ): Promise<SaveHwpxExportReportResult | null> {
    const operationId = validateHwpxOperationId(input?.operationId);
    const sessionId = validateSessionId(input?.sessionId);
    const record = this.hwpxOperations.get(operationId);
    if (!record || record.sessionId !== sessionId) {
      throw new Error("HWPX export report is unavailable");
    }
    if (input.format !== "JSON" && input.format !== "MARKDOWN") {
      throw new Error("Unsupported HWPX export report format");
    }
    const extension = input.format === "JSON" ? "json" : "md";
    const result = await this.dialog.showSaveDialog(this.window, {
      title: "HWPX export report 저장",
      defaultPath: `madi-hwpx-export-report.${extension}`,
      filters: [
        {
          name: input.format === "JSON" ? "JSON report" : "Markdown report",
          extensions: [extension]
        }
      ],
      properties: ["createDirectory", "showOverwriteConfirmation"]
    });
    if (result.canceled || !result.filePath) {
      return null;
    }
    if (!result.filePath.toLocaleLowerCase().endsWith(`.${extension}`)) {
      throw new Error(`HWPX report destination must use the .${extension} extension`);
    }
    const filePath = path.resolve(result.filePath);
    const source =
      input.format === "JSON"
        ? `${JSON.stringify(record.report, null, 2)}\n`
        : markdownHwpxExportReport(record.report);
    const byteLength = Buffer.byteLength(source, "utf8");
    if (byteLength < 1 || byteLength > MAX_HWPX_REPORT_BYTES) {
      throw new Error("HWPX export report exceeds the size limit");
    }
    let existingFile: HwpxOutputSelectionRecord["existingFile"] = null;
    let atomicIdentity: AtomicOutputIdentity | null = null;
    let replaceExisting = false;
    try {
      existingFile = await existingEpubIdentity(filePath, MAX_HWPX_REPORT_BYTES);
      if (!this.atomicOutput) {
        throw new Error("The atomic output utility is unavailable");
      }
      atomicIdentity = await this.atomicOutput.inspect(
        filePath,
        MAX_HWPX_REPORT_BYTES
      );
      replaceExisting = true;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      ) {
        throw error;
      }
    }
    const stagedDirectory = path.join(
      path.dirname(filePath),
      `.madi-hwpx-report-${operationId}-${extension}`
    );
    const stagedPath = path.join(stagedDirectory, `report.${extension}`);
    let stagedDirectoryOwned = false;
    let committed = false;
    try {
      await mkdir(stagedDirectory);
      stagedDirectoryOwned = true;
      await this.registerOwnedHwpxDirectory(stagedDirectory);
      const handle = await open(stagedPath, "wx");
      try {
        await handle.writeFile(source, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.commitStagedHwpx(stagedPath, {
        sessionId,
        filePath,
        fileName: path.basename(filePath),
        outputType: "HWPX",
        replaceExisting,
        maximumBytes: MAX_HWPX_REPORT_BYTES,
        existingFile,
        atomicIdentity
      });
      committed = true;
    } finally {
      if (stagedDirectoryOwned) {
        try {
          await this.cleanupOwnedHwpxDirectory(stagedDirectory);
        } catch {
          if (!committed) {
            throw new Error("The staged HWPX report could not be removed");
          }
        }
      }
    }
    return { fileName: path.basename(filePath), byteLength };
  }

  public async revealHwpxExport(input: RevealHwpxExportRequest): Promise<boolean> {
    const operationId = validateHwpxOperationId(input?.operationId);
    const sessionId = validateSessionId(input?.sessionId);
    const record = this.hwpxOperations.get(operationId);
    if (
      !record?.outputPath ||
      record.sessionId !== sessionId ||
      !this.shellPort
    ) {
      return false;
    }
    const fileStat = await stat(record.outputPath);
    if (!fileStat.isFile()) {
      return false;
    }
    this.shellPort.showItemInFolder(record.outputPath);
    return true;
  }

  public async listCanvases(
    input: ListCanvasesRequest
  ): Promise<ListCanvasesResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const sort = input.sort ?? "UPDATED_DESC";
    if (!CANVAS_SORTS.has(sort)) {
      throw new Error("Invalid canvas sort");
    }
    const response = asRecord(
      await this.core.request("list_canvases", {
        file_path: session.filePath,
        sort
      }),
      "list canvases response"
    );
    if (!Array.isArray(response.canvases)) {
      throw new Error("The local core returned invalid canvas list");
    }
    const revision = responseRevision(response, "list canvases");
    this.sessions.updateProject(sessionId, { revision });
    return {
      canvases: response.canvases.map((canvas) =>
        parseCanvasSummary(canvas, session.projectId)
      ),
      revision
    };
  }

  public async createCanvas(
    input: CreateCanvasRequest
  ): Promise<CanvasMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const name = validateShortText(input.name, "Canvas name", 500);
    const description =
      input.description === undefined || input.description === null
        ? null
        : validateExactText(input.description, "Canvas description", 20_000, true);
    const document = validateCanvasDocument(
      input.document ?? { nodes: [], edges: [] }
    );
    const response = asRecord(
      await this.core.request("create_canvas", {
        file_path: session.filePath,
        canvas_id: randomUUID(),
        name,
        description,
        document,
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "create canvas response"
    );
    const revision = responseRevision(response, "create canvas");
    const canvas = parseCanvasRecord(response.canvas, session.projectId);
    this.sessions.updateProject(sessionId, { revision });
    return { canvas, revision, noOp: false };
  }

  public async updateCanvas(
    input: UpdateCanvasRequest
  ): Promise<CanvasMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const response = asRecord(
      await this.core.request("update_canvas", {
        file_path: session.filePath,
        canvas_id: validateCanvasId(input.canvasId),
        name: validateShortText(input.name, "Canvas name", 500),
        description:
          input.description === null
            ? null
            : validateExactText(
                input.description,
                "Canvas description",
                20_000,
                true
              ),
        expected_revision: session.revision,
        expected_canvas_revision: validateCanvasRevision(
          input.expectedCanvasRevision
        ),
        saved_by: `madi/${this.appVersion}`
      }),
      "update canvas response"
    );
    const revision = responseRevision(response, "update canvas");
    const canvas = parseCanvasRecord(response.canvas, session.projectId);
    const noOp = requiredBoolean(response, "no_op");
    this.sessions.updateProject(sessionId, { revision });
    return { canvas, revision, noOp };
  }

  public async duplicateCanvas(
    input: DuplicateCanvasRequest
  ): Promise<CanvasMutationResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const response = asRecord(
      await this.core.request("duplicate_canvas", {
        file_path: session.filePath,
        source_canvas_id: validateCanvasId(
          input.sourceCanvasId,
          "Source canvas id"
        ),
        canvas_id: randomUUID(),
        ...(input.name === undefined
          ? {}
          : { name: validateShortText(input.name, "Canvas name", 500) }),
        expected_revision: session.revision,
        saved_by: `madi/${this.appVersion}`
      }),
      "duplicate canvas response"
    );
    const revision = responseRevision(response, "duplicate canvas");
    const canvas = parseCanvasRecord(response.canvas, session.projectId);
    this.sessions.updateProject(sessionId, { revision });
    return { canvas, revision, noOp: false };
  }

  public async deleteCanvas(
    input: DeleteCanvasRequest
  ): Promise<DeleteCanvasResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const canvasId = validateCanvasId(input.canvasId);
    const response = asRecord(
      await this.core.request("delete_canvas", {
        file_path: session.filePath,
        canvas_id: canvasId,
        expected_revision: session.revision,
        expected_canvas_revision: validateCanvasRevision(
          input.expectedCanvasRevision
        ),
        saved_by: `madi/${this.appVersion}`
      }),
      "delete canvas response"
    );
    const deletedCanvasId = requiredString(response, "deleted_canvas_id");
    if (deletedCanvasId !== canvasId) {
      throw new Error("The local core deleted another canvas");
    }
    const revision = responseRevision(response, "delete canvas");
    this.sessions.updateProject(sessionId, { revision });
    return { deletedCanvasId, revision };
  }

  public async loadCanvas(input: LoadCanvasRequest): Promise<CanvasRecord> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const canvasId = validateCanvasId(input.canvasId);
    const response = asRecord(
      await this.core.request("load_canvas", {
        file_path: session.filePath,
        canvas_id: canvasId
      }),
      "load canvas response"
    );
    const revision = responseRevision(response, "load canvas");
    const canvas = parseCanvasRecord(response.canvas, session.projectId);
    if (canvas.id !== canvasId) {
      throw new Error("The local core loaded another canvas");
    }
    this.sessions.updateProject(sessionId, { revision });
    return canvas;
  }

  public async saveCanvas(input: SaveCanvasRequest): Promise<SaveCanvasResult> {
    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const canvasId = validateCanvasId(input.canvasId);
    if (
      !Number.isSafeInteger(input.generation) ||
      input.generation < 0 ||
      !Number.isSafeInteger(input.saveSequence) ||
      input.saveSequence < 0
    ) {
      throw new Error("Invalid canvas save sequence");
    }
    const response = asRecord(
      await this.core.request("save_canvas", {
        file_path: session.filePath,
        canvas_id: canvasId,
        document: validateCanvasDocument(input.document),
        expected_revision: session.revision,
        expected_canvas_revision: validateCanvasRevision(
          input.expectedCanvasRevision
        ),
        saved_by: `madi/${this.appVersion}`
      }),
      "save canvas response"
    );
    const revision = responseRevision(response, "save canvas");
    const canvas = parseCanvasRecord(response.canvas, session.projectId);
    if (canvas.id !== canvasId) {
      throw new Error("The local core saved another canvas");
    }
    const noOp = requiredBoolean(response, "no_op");
    this.sessions.updateProject(sessionId, { revision });
    return {
      canvas,
      canvasId,
      revision,
      noOp,
      generation: input.generation,
      saveSequence: input.saveSequence
    };
  }

  public async pickCanvasImport(): Promise<PickCanvasImportResult | null> {
    const selection = await this.dialog.showOpenDialog(this.window, {
      title: "JSON Canvas 가져오기",
      filters: [{ name: "JSON Canvas", extensions: ["canvas"] }],
      properties: ["openFile", "dontAddToRecent"]
    });
    if (selection.canceled || selection.filePaths.length !== 1) {
      return null;
    }
    const filePath = selection.filePaths[0]!;
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size > MAX_CANVAS_FILE_BYTES) {
      throw new Error("Canvas import file is too large or is not a file");
    }
    const bytes = await readFile(filePath);
    let source: string;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("Canvas import must be valid UTF-8");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(source) as unknown;
    } catch {
      throw new Error("Canvas import is malformed JSON");
    }
    validateCanvasDocument(parsed);
    return { fileName: path.basename(filePath), source };
  }

  public async exportCanvas(
    input: ExportCanvasRequest
  ): Promise<ExportCanvasResult | null> {
    const canvas = await this.loadCanvas({
      sessionId: input.sessionId,
      canvasId: input.canvasId
    });
    const selection = await this.dialog.showSaveDialog(this.window, {
      title: "JSON Canvas 내보내기",
      defaultPath: safeCanvasFileName(input.suggestedFileName ?? canvas.name),
      filters: [{ name: "JSON Canvas", extensions: ["canvas"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"]
    });
    if (selection.canceled || !selection.filePath) {
      return null;
    }
    const filePath = selection.filePath.toLocaleLowerCase().endsWith(".canvas")
      ? selection.filePath
      : `${selection.filePath}.canvas`;
    const source = `${canonicalCanvasJson(canvas.document)}\n`;
    await writeFile(filePath, source, { encoding: "utf8", flag: "w" });
    return {
      fileName: path.basename(filePath),
      bytes: Buffer.byteLength(source, "utf8")
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

  public async getWorldGraph(
    input: SessionRequest
  ): Promise<WorldGraphReadModel> {
    if (!isRecord(input)) {
      throw new Error("Invalid world graph request");
    }
    assertExactKeys(input, ["sessionId"], "world graph request");
    const sessionId = validateSessionId(input.sessionId);
    const session = this.sessions.require(sessionId);
    const graph = parseWorldGraphReadModel(
      await this.core.request("get_world_graph", {
        file_path: session.filePath
      }),
      session.projectId,
      session.revision
    );
    this.sessions.updateProject(sessionId, { revision: graph.revision });
    return graph;
  }

  public async getWorldGraphStats(
    input: SessionRequest
  ): Promise<WorldGraphStatsResult> {
    if (!isRecord(input)) {
      throw new Error("Invalid world graph stats request");
    }
    assertExactKeys(input, ["sessionId"], "world graph stats request");
    const sessionId = validateSessionId(input.sessionId);
    const session = this.sessions.require(sessionId);
    const result = parseWorldGraphStatsResult(
      await this.core.request("get_world_graph_stats", {
        file_path: session.filePath
      }),
      session.projectId,
      session.revision
    );
    this.sessions.updateProject(sessionId, { revision: result.revision });
    return result;
  }

  public async getEntityGraphDetail(
    input: EntityGraphRequest
  ): Promise<EntityGraphDetail> {
    if (!isRecord(input)) {
      throw new Error("Invalid entity graph detail request");
    }
    assertExactKeys(
      input,
      ["sessionId", "entityId"],
      "entity graph detail request"
    );
    const sessionId = validateSessionId(input.sessionId);
    const session = this.sessions.require(sessionId);
    const entityId = validateNodeId(input.entityId, "Graph entity id");
    const detail = parseEntityGraphDetail(
      await this.core.request("get_entity_graph_detail", {
        file_path: session.filePath,
        entity_id: entityId
      }),
      entityId,
      session.projectId,
      session.revision
    );
    this.sessions.updateProject(sessionId, { revision: detail.revision });
    return detail;
  }

  public async getEntitySceneContext(
    input: EntityGraphRequest
  ): Promise<EntitySceneContext> {
    if (!isRecord(input)) {
      throw new Error("Invalid entity scene context request");
    }
    assertExactKeys(
      input,
      ["sessionId", "entityId"],
      "entity scene context request"
    );
    const sessionId = validateSessionId(input.sessionId);
    const session = this.sessions.require(sessionId);
    const entityId = validateNodeId(input.entityId, "Graph entity id");
    const context = parseEntitySceneContext(
      await this.core.request("get_entity_scene_context", {
        file_path: session.filePath,
        entity_id: entityId
      }),
      entityId,
      session.projectId,
      session.revision
    );
    this.sessions.updateProject(sessionId, { revision: context.revision });
    return context;
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
