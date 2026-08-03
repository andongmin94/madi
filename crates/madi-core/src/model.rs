use std::path::PathBuf;
use std::{fmt, str::FromStr};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum NodeKind {
    Work,
    Volume,
    Chapter,
    Scene,
}

impl NodeKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Work => "WORK",
            Self::Volume => "VOLUME",
            Self::Chapter => "CHAPTER",
            Self::Scene => "SCENE",
        }
    }
}

impl fmt::Display for NodeKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for NodeKind {
    type Err = String;

    fn from_str(value: &str) -> std::result::Result<Self, Self::Err> {
        match value {
            "WORK" => Ok(Self::Work),
            "VOLUME" => Ok(Self::Volume),
            "CHAPTER" => Ok(Self::Chapter),
            "SCENE" => Ok(Self::Scene),
            _ => Err(format!("unsupported node kind {value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppMeta {
    pub format_name: String,
    pub format_version: i64,
    pub schema_version: i64,
    pub created_by: String,
    pub last_saved_by: String,
    pub project_id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MigrationRecord {
    pub version: i64,
    pub applied_at: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DocumentSummary {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub editor_engine: String,
    pub editor_engine_commit: String,
    pub editor_schema_version: i64,
    pub snapshot_bytes: u64,
    pub plain_text_bytes: u64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DocumentRecord {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub editor_engine: String,
    pub editor_engine_commit: String,
    pub editor_schema_version: i64,
    pub snapshot_base64: String,
    pub plain_text_recovery: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectInspection {
    pub file_path: PathBuf,
    pub application_id: i64,
    pub metadata: AppMeta,
    pub documents: Vec<DocumentSummary>,
    pub schema_migrations: Vec<MigrationRecord>,
    pub integrity_check: String,
    pub file_size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateProjectParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub title: String,
    #[serde(default)]
    pub created_by: Option<String>,
    #[serde(default)]
    pub author_name: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub document_id: Option<String>,
    #[serde(default)]
    pub document_title: Option<String>,
    #[serde(default)]
    pub editor_engine: Option<String>,
    #[serde(default)]
    pub editor_engine_commit: Option<String>,
    #[serde(default)]
    pub editor_schema_version: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateProjectResult {
    pub default_document_id: String,
    pub work_node_id: String,
    pub default_chapter_node_id: String,
    pub default_scene_node_id: String,
    pub project: ProjectInspection,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OpenProjectParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
}

pub type InspectProjectParams = OpenProjectParams;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SaveDocumentPayload {
    pub id: String,
    #[serde(default)]
    pub project_id: Option<String>,
    pub title: String,
    pub editor_engine: String,
    pub editor_engine_commit: String,
    pub editor_schema_version: i64,
    pub snapshot_base64: String,
    pub plain_text_recovery: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SaveDocumentParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub document: SaveDocumentPayload,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SaveDocumentResult {
    pub metadata: AppMeta,
    pub document: DocumentSummary,
    pub backup_file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LoadDocumentParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    #[serde(default)]
    pub document_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecoverPlainTextParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    #[serde(default)]
    pub document_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecoverPlainTextResult {
    pub document_id: String,
    pub title: String,
    pub plain_text_recovery: String,
    pub project_revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectRecord {
    pub id: String,
    pub title: String,
    pub author_name: Option<String>,
    pub work_node_id: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TreeNode {
    pub id: String,
    pub project_id: String,
    pub parent_id: Option<String>,
    pub kind: NodeKind,
    pub title: String,
    pub order_key: f64,
    pub document_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProjectTree {
    pub metadata: AppMeta,
    pub project: ProjectRecord,
    pub nodes: Vec<TreeNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LoadProjectTreeParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CreateTreeNodeParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub parent_id: String,
    pub kind: NodeKind,
    pub title: String,
    #[serde(default)]
    pub node_id: Option<String>,
    #[serde(default)]
    pub document_id: Option<String>,
    #[serde(default)]
    pub editor_engine: Option<String>,
    #[serde(default)]
    pub editor_engine_commit: Option<String>,
    #[serde(default)]
    pub editor_schema_version: Option<i64>,
    #[serde(default)]
    pub before_node_id: Option<String>,
    #[serde(default)]
    pub after_node_id: Option<String>,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CreateTreeNodeResult {
    pub metadata: AppMeta,
    pub node: TreeNode,
    pub document: Option<DocumentSummary>,
    pub tree: ProjectTree,
    pub backup_file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RenameTreeNodeParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub node_id: String,
    pub title: String,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MoveTreeNodeParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub node_id: String,
    pub new_parent_id: String,
    #[serde(default)]
    pub before_node_id: Option<String>,
    #[serde(default)]
    pub after_node_id: Option<String>,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReorderTreeNodeParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub node_id: String,
    #[serde(default)]
    pub before_node_id: Option<String>,
    #[serde(default)]
    pub after_node_id: Option<String>,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TreeMutationResult {
    pub metadata: AppMeta,
    pub node: TreeNode,
    pub tree: ProjectTree,
    pub backup_file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeleteTreeNodeParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub node_id: String,
    pub recursive: bool,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DeleteTreeNodeResult {
    pub metadata: AppMeta,
    pub deleted_node_ids: Vec<String>,
    pub deleted_document_ids: Vec<String>,
    pub tree: ProjectTree,
    pub backup_file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LoadSceneParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub scene_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SceneRecord {
    pub scene: TreeNode,
    pub document: DocumentRecord,
    pub project_revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SaveSceneParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub scene_id: String,
    pub editor_engine: String,
    pub editor_engine_commit: String,
    pub editor_schema_version: i64,
    pub snapshot_base64: String,
    pub plain_text_recovery: String,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SaveSceneResult {
    pub metadata: AppMeta,
    pub scene: TreeNode,
    pub document: DocumentSummary,
    pub backup_file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UiStateRecord {
    pub project_id: String,
    pub key: String,
    pub value: serde_json::Value,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SaveUiStateResult {
    pub metadata: AppMeta,
    pub state: UiStateRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SaveUiStateParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub key: String,
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LoadUiStateParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LoadUiStateResult {
    pub metadata: AppMeta,
    pub state: Option<UiStateRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ListDescendantScenesParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    #[serde(alias = "node_id")]
    pub scope_node_id: String,
    #[serde(default)]
    pub offset: u64,
    #[serde(default)]
    pub limit: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SceneWorkspaceRecord {
    pub scene: TreeNode,
    pub document: SceneDocumentPreview,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SceneDocumentPreview {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub plain_text_recovery: String,
    pub source_content_hash: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ListDescendantScenesResult {
    pub metadata: AppMeta,
    pub scope: TreeNode,
    pub scenes: Vec<SceneWorkspaceRecord>,
    pub total_scenes: u64,
    pub offset: u64,
    pub limit: u64,
    pub next_offset: Option<u64>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SearchTarget {
    Titles,
    Bodies,
    #[default]
    All,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SearchField {
    Title,
    Body,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SearchProjectParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub query: String,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub target: SearchTarget,
    #[serde(default, alias = "node_id")]
    pub scope_node_id: Option<String>,
    #[serde(default)]
    pub offset: u64,
    #[serde(default)]
    pub limit: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SearchHit {
    pub occurrence_id: String,
    pub node_id: String,
    pub scene_id: Option<String>,
    pub document_id: Option<String>,
    pub node_kind: NodeKind,
    pub node_title: String,
    pub field: SearchField,
    pub start_char: u64,
    pub end_char: u64,
    pub context_before: String,
    pub matched_text: String,
    pub context_after: String,
    pub source_content_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SearchProjectResult {
    pub metadata: AppMeta,
    pub query: String,
    pub case_sensitive: bool,
    pub target: SearchTarget,
    pub scope_node_id: String,
    pub total_matches: u64,
    pub scene_count: u64,
    pub offset: u64,
    pub limit: u64,
    pub has_more: bool,
    pub hits: Vec<SearchHit>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GetTextStatisticsParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    #[serde(default, alias = "node_id")]
    pub scope_node_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SceneTextStatistics {
    pub scene_id: String,
    pub document_id: String,
    pub with_spaces: u64,
    pub without_spaces: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TextStatisticsResult {
    pub metadata: AppMeta,
    pub scope_node_id: String,
    pub scene_count: u64,
    pub with_spaces: u64,
    pub without_spaces: u64,
    pub scenes: Vec<SceneTextStatistics>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum NamedSnapshotKind {
    #[default]
    Manual,
    AutoBeforeReplace,
    AutoBeforeRestore,
}

impl NamedSnapshotKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "MANUAL",
            Self::AutoBeforeReplace => "AUTO_BEFORE_REPLACE",
            Self::AutoBeforeRestore => "AUTO_BEFORE_RESTORE",
        }
    }
}

impl FromStr for NamedSnapshotKind {
    type Err = String;

    fn from_str(value: &str) -> std::result::Result<Self, Self::Err> {
        match value {
            "MANUAL" => Ok(Self::Manual),
            "AUTO_BEFORE_REPLACE" => Ok(Self::AutoBeforeReplace),
            "AUTO_BEFORE_RESTORE" => Ok(Self::AutoBeforeRestore),
            _ => Err(format!("unsupported named snapshot kind {value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NamedSnapshotSummary {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub note: Option<String>,
    pub kind: NamedSnapshotKind,
    pub payload_format: String,
    pub payload_version: i64,
    pub payload_bytes: u64,
    pub content_hash: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateNamedSnapshotParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub name: String,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub kind: NamedSnapshotKind,
    #[serde(default)]
    pub snapshot_id: Option<String>,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateNamedSnapshotResult {
    pub metadata: AppMeta,
    pub snapshot: NamedSnapshotSummary,
    pub backup_file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ListNamedSnapshotsParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ListNamedSnapshotsResult {
    pub metadata: AppMeta,
    pub snapshots: Vec<NamedSnapshotSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RenameNamedSnapshotParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub snapshot_id: String,
    pub name: String,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RenameNamedSnapshotResult {
    pub metadata: AppMeta,
    pub snapshot: NamedSnapshotSummary,
    pub backup_file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeleteNamedSnapshotParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub snapshot_id: String,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeleteNamedSnapshotResult {
    pub metadata: AppMeta,
    pub deleted_snapshot_id: String,
    pub backup_file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DiffNamedSnapshotParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub snapshot_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct SnapshotNodeCounts {
    pub volumes: u64,
    pub chapters: u64,
    pub scenes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct SnapshotDiffSummary {
    pub added: SnapshotNodeCounts,
    pub deleted: SnapshotNodeCounts,
    pub renamed_nodes: u64,
    pub reordered_nodes: u64,
    pub changed_scene_bodies: u64,
    pub character_count_delta: i64,
    pub added_entities: u64,
    pub deleted_entities: u64,
    pub changed_entities: u64,
    pub added_relations: u64,
    pub deleted_relations: u64,
    pub changed_relations: u64,
    pub changed_scene_links: u64,
    pub changed_entity_notes: u64,
    pub added_tags: u64,
    pub deleted_tags: u64,
    pub changed_tags: u64,
    pub added_relation_types: u64,
    pub deleted_relation_types: u64,
    pub changed_relation_types: u64,
    pub added_canvases: u64,
    pub deleted_canvases: u64,
    pub changed_canvases: u64,
    pub canvas_node_count_delta: i64,
    pub canvas_edge_count_delta: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DiffNamedSnapshotResult {
    pub metadata: AppMeta,
    pub snapshot: NamedSnapshotSummary,
    pub summary: SnapshotDiffSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RestoreNamedSnapshotParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub snapshot_id: String,
    #[serde(default)]
    pub auto_snapshot_name: Option<String>,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RestoreNamedSnapshotResult {
    pub metadata: AppMeta,
    pub restored_snapshot: NamedSnapshotSummary,
    pub safety_snapshot: NamedSnapshotSummary,
    pub changes_before_restore: SnapshotDiffSummary,
    pub backup_file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransformedSceneDocument {
    pub scene_id: String,
    pub document_id: String,
    pub editor_engine: String,
    pub editor_engine_commit: String,
    pub editor_schema_version: i64,
    pub snapshot_base64: String,
    pub plain_text_recovery: String,
    pub occurrence_count: u64,
    #[serde(default)]
    pub source_content_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplyReplacementBatchParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub expected_revision: i64,
    pub query: String,
    pub replacement: String,
    #[serde(default)]
    pub case_sensitive: bool,
    pub transformed_scenes: Vec<TransformedSceneDocument>,
    #[serde(default)]
    pub saved_by: Option<String>,
    #[serde(default)]
    pub auto_snapshot_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplyReplacementBatchResult {
    pub metadata: AppMeta,
    pub safety_snapshot: NamedSnapshotSummary,
    pub changed_scene_ids: Vec<String>,
    pub changed_scenes: u64,
    pub changed_occurrences: u64,
    pub backup_file_path: PathBuf,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EntityKind {
    Character,
    Location,
    Organization,
    Item,
    Event,
    WorldRule,
    Foreshadowing,
    Other,
}

impl EntityKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Character => "CHARACTER",
            Self::Location => "LOCATION",
            Self::Organization => "ORGANIZATION",
            Self::Item => "ITEM",
            Self::Event => "EVENT",
            Self::WorldRule => "WORLD_RULE",
            Self::Foreshadowing => "FORESHADOWING",
            Self::Other => "OTHER",
        }
    }
}

impl FromStr for EntityKind {
    type Err = String;

    fn from_str(value: &str) -> std::result::Result<Self, Self::Err> {
        match value {
            "CHARACTER" => Ok(Self::Character),
            "LOCATION" => Ok(Self::Location),
            "ORGANIZATION" => Ok(Self::Organization),
            "ITEM" => Ok(Self::Item),
            "EVENT" => Ok(Self::Event),
            "WORLD_RULE" => Ok(Self::WorldRule),
            "FORESHADOWING" => Ok(Self::Foreshadowing),
            "OTHER" => Ok(Self::Other),
            _ => Err(format!("unsupported entity kind {value}")),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, Default)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EntityStatus {
    #[default]
    Active,
    Draft,
    Archived,
}

impl EntityStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Active => "ACTIVE",
            Self::Draft => "DRAFT",
            Self::Archived => "ARCHIVED",
        }
    }
}

impl FromStr for EntityStatus {
    type Err = String;

    fn from_str(value: &str) -> std::result::Result<Self, Self::Err> {
        match value {
            "ACTIVE" => Ok(Self::Active),
            "DRAFT" => Ok(Self::Draft),
            "ARCHIVED" => Ok(Self::Archived),
            _ => Err(format!("unsupported entity status {value}")),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EntitySort {
    #[default]
    NameAsc,
    UpdatedDesc,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SceneEntityRole {
    Appears,
    Pov,
    Mentioned,
    Related,
}

impl SceneEntityRole {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Appears => "APPEARS",
            Self::Pov => "POV",
            Self::Mentioned => "MENTIONED",
            Self::Related => "RELATED",
        }
    }
}

impl FromStr for SceneEntityRole {
    type Err = String;

    fn from_str(value: &str) -> std::result::Result<Self, Self::Err> {
        match value {
            "APPEARS" => Ok(Self::Appears),
            "POV" => Ok(Self::Pov),
            "MENTIONED" => Ok(Self::Mentioned),
            "RELATED" => Ok(Self::Related),
            _ => Err(format!("unsupported scene entity role {value}")),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DocumentOwnerKind {
    Scene,
    Entity,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EntityAliasRecord {
    pub id: String,
    pub entity_id: String,
    pub alias: String,
    pub normalized_alias: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TagRecord {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub color_token: Option<String>,
    pub created_at: String,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EntityRecord {
    pub id: String,
    pub project_id: String,
    pub kind: EntityKind,
    pub name: String,
    pub summary: Option<String>,
    pub document_id: String,
    pub status: EntityStatus,
    pub color_token: Option<String>,
    pub icon_key: Option<String>,
    pub attributes: serde_json::Value,
    pub duplicate_name: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ListEntitiesParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub kinds: Vec<EntityKind>,
    #[serde(default)]
    pub statuses: Vec<EntityStatus>,
    #[serde(default)]
    pub tag_ids: Vec<String>,
    #[serde(default)]
    pub sort: EntitySort,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ListEntitiesResult {
    pub metadata: AppMeta,
    pub entities: Vec<EntityRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CreateEntityParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub kind: EntityKind,
    pub name: String,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub status: EntityStatus,
    #[serde(default)]
    pub color_token: Option<String>,
    #[serde(default)]
    pub icon_key: Option<String>,
    #[serde(default = "default_attributes")]
    pub attributes: serde_json::Value,
    #[serde(default)]
    pub entity_id: Option<String>,
    #[serde(default)]
    pub document_id: Option<String>,
    #[serde(default)]
    pub editor_engine: Option<String>,
    #[serde(default)]
    pub editor_engine_commit: Option<String>,
    #[serde(default)]
    pub editor_schema_version: Option<i64>,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

fn default_attributes() -> serde_json::Value {
    serde_json::json!({})
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CreateEntityResult {
    pub metadata: AppMeta,
    pub entity: EntityRecord,
    pub document: DocumentSummary,
    pub backup_file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UpdateEntityParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub entity_id: String,
    pub kind: EntityKind,
    pub name: String,
    pub summary: Option<String>,
    pub status: EntityStatus,
    pub color_token: Option<String>,
    pub icon_key: Option<String>,
    pub attributes: serde_json::Value,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UpdateEntityResult {
    pub metadata: AppMeta,
    pub entity: EntityRecord,
    pub backup_file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EntityDeleteImpact {
    pub entity_id: String,
    pub relation_count: u64,
    pub scene_link_count: u64,
    pub mention_scene_count: u64,
    pub alias_count: u64,
    pub tag_count: u64,
    pub note_character_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GetEntityDeleteImpactParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub entity_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EntityDeleteImpactResult {
    pub metadata: AppMeta,
    pub impact: EntityDeleteImpact,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeleteEntityParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub entity_id: String,
    pub confirmed: bool,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeleteEntityResult {
    pub metadata: AppMeta,
    pub deleted_entity_id: String,
    pub deleted_document_id: String,
    pub impact: EntityDeleteImpact,
    pub backup_file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LoadEntityNoteParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub owner_kind: DocumentOwnerKind,
    pub owner_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EntityNoteRecord {
    pub owner_kind: DocumentOwnerKind,
    pub owner_id: String,
    pub document_id: String,
    pub document: DocumentRecord,
    pub project_revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SaveEntityNoteParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub owner_kind: DocumentOwnerKind,
    pub owner_id: String,
    pub document_id: String,
    pub generation: u64,
    pub save_sequence: u64,
    pub editor_engine: String,
    pub editor_engine_commit: String,
    pub editor_schema_version: i64,
    pub snapshot_base64: String,
    pub plain_text_recovery: String,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SaveEntityNoteResult {
    pub metadata: AppMeta,
    pub owner_kind: DocumentOwnerKind,
    pub owner_id: String,
    pub generation: u64,
    pub save_sequence: u64,
    pub document: DocumentSummary,
    pub backup_file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ListEntityAliasesParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub entity_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ListEntityAliasesResult {
    pub metadata: AppMeta,
    pub aliases: Vec<EntityAliasRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateEntityAliasParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub entity_id: String,
    pub alias: String,
    #[serde(default)]
    pub alias_id: Option<String>,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateEntityAliasResult {
    pub metadata: AppMeta,
    pub alias: EntityAliasRecord,
    pub backup_file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeleteEntityAliasParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub alias_id: String,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeleteEntityAliasResult {
    pub metadata: AppMeta,
    pub deleted_alias_id: String,
    pub backup_file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ListTagsParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ListTagsResult {
    pub metadata: AppMeta,
    pub tags: Vec<TagRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ListEntityTagsParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub entity_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ListEntityTagsResult {
    pub metadata: AppMeta,
    pub entity_id: String,
    pub tags: Vec<TagRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateTagParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub name: String,
    #[serde(default)]
    pub color_token: Option<String>,
    #[serde(default)]
    pub tag_id: Option<String>,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TagMutationResult {
    pub metadata: AppMeta,
    pub tag: TagRecord,
    pub backup_file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpdateTagParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub tag_id: String,
    pub name: String,
    #[serde(default)]
    pub color_token: Option<String>,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeleteTagParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub tag_id: String,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeleteTagResult {
    pub metadata: AppMeta,
    pub deleted_tag_id: String,
    pub backup_file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SetEntityTagsParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub entity_id: String,
    pub tag_ids: Vec<String>,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SetEntityTagsResult {
    pub metadata: AppMeta,
    pub entity_id: String,
    pub tags: Vec<TagRecord>,
    pub backup_file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RelationTypeRecord {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub inverse_name: Option<String>,
    pub directed: bool,
    pub color_token: Option<String>,
    pub is_builtin: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ListRelationTypesParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ListRelationTypesResult {
    pub metadata: AppMeta,
    pub relation_types: Vec<RelationTypeRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateRelationTypeParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub name: String,
    #[serde(default)]
    pub inverse_name: Option<String>,
    pub directed: bool,
    #[serde(default)]
    pub color_token: Option<String>,
    #[serde(default)]
    pub relation_type_id: Option<String>,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RelationTypeMutationResult {
    pub metadata: AppMeta,
    pub relation_type: RelationTypeRecord,
    pub backup_file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpdateRelationTypeParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub relation_type_id: String,
    pub name: String,
    #[serde(default)]
    pub inverse_name: Option<String>,
    pub directed: bool,
    #[serde(default)]
    pub color_token: Option<String>,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeleteRelationTypeParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub relation_type_id: String,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeleteRelationTypeResult {
    pub metadata: AppMeta,
    pub deleted_relation_type_id: String,
    pub backup_file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EntityRelationRecord {
    pub id: String,
    pub project_id: String,
    pub source_entity_id: String,
    pub relation_type_id: String,
    pub target_entity_id: String,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ListEntityRelationsParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    #[serde(default)]
    pub entity_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ListEntityRelationsResult {
    pub metadata: AppMeta,
    pub relations: Vec<EntityRelationRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateEntityRelationParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub source_entity_id: String,
    pub relation_type_id: String,
    pub target_entity_id: String,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub relation_id: Option<String>,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EntityRelationMutationResult {
    pub metadata: AppMeta,
    pub relation: EntityRelationRecord,
    pub backup_file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpdateEntityRelationParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub relation_id: String,
    pub relation_type_id: String,
    pub target_entity_id: String,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeleteEntityRelationParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub relation_id: String,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeleteEntityRelationResult {
    pub metadata: AppMeta,
    pub deleted_relation_id: String,
    pub backup_file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SceneEntityLinkRecord {
    pub scene_node_id: String,
    pub entity_id: String,
    pub role: SceneEntityRole,
    pub note: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ListSceneEntityLinksParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    #[serde(default)]
    pub scene_node_id: Option<String>,
    #[serde(default)]
    pub entity_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ListSceneEntityLinksResult {
    pub metadata: AppMeta,
    pub links: Vec<SceneEntityLinkRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateSceneEntityLinkParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub scene_node_id: String,
    pub entity_id: String,
    pub role: SceneEntityRole,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SceneEntityLinkMutationResult {
    pub metadata: AppMeta,
    pub link: SceneEntityLinkRecord,
    pub backup_file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeleteSceneEntityLinkParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub scene_node_id: String,
    pub entity_id: String,
    pub role: SceneEntityRole,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeleteSceneEntityLinkResult {
    pub metadata: AppMeta,
    pub deleted_link: DeletedSceneEntityLink,
    pub backup_file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeletedSceneEntityLink {
    pub scene_node_id: String,
    pub entity_id: String,
    pub role: SceneEntityRole,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EntityMentionMatch {
    pub matched_term: String,
    pub alias_id: Option<String>,
    pub start_char: u64,
    pub end_char: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EntityMentionCandidate {
    pub occurrence_id: String,
    pub entity_id: String,
    pub scene_node_id: String,
    pub scene_title: String,
    pub document_id: String,
    pub matched_alias: String,
    pub context_before: String,
    pub matched_text: String,
    pub context_after: String,
    pub start: u64,
    pub end: u64,
    pub already_linked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DiscoverEntityMentionsParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub entity_id: String,
    #[serde(default)]
    pub offset: u64,
    #[serde(default)]
    pub limit: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DiscoverEntityMentionsResult {
    pub metadata: AppMeta,
    pub entity_id: String,
    pub total_scenes: u64,
    pub offset: u64,
    pub limit: u64,
    pub has_more: bool,
    pub candidates: Vec<EntityMentionCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PromoteEntityMentionParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub entity_id: String,
    pub scene_node_id: String,
    #[serde(default = "default_mentioned_role")]
    pub role: SceneEntityRole,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

fn default_mentioned_role() -> SceneEntityRole {
    SceneEntityRole::Mentioned
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SearchEntitiesParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub query: String,
    #[serde(default)]
    pub offset: u64,
    #[serde(default)]
    pub limit: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EntitySearchHit {
    pub entity: EntityRecord,
    pub matched_fields: Vec<String>,
    pub matched_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SearchEntitiesResult {
    pub metadata: AppMeta,
    pub query: String,
    pub total_matches: u64,
    pub offset: u64,
    pub limit: u64,
    pub has_more: bool,
    pub hits: Vec<EntitySearchHit>,
}

/// Read-only graph tag metadata derived from the Story Bible tag tables.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorldGraphTag {
    pub id: String,
    pub name: String,
    pub color_token: Option<String>,
}

/// A graph node owned by Madi rather than by any renderer or layout library.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorldGraphNode {
    pub id: String,
    pub project_id: String,
    pub label: String,
    pub kind: EntityKind,
    pub status: EntityStatus,
    pub summary: Option<String>,
    pub color_token: Option<String>,
    pub icon_key: Option<String>,
    pub aliases: Vec<String>,
    pub tags: Vec<WorldGraphTag>,
    pub explicit_scene_link_count: u64,
    pub outgoing_relation_count: u64,
    pub incoming_relation_count: u64,
    pub undirected_relation_count: u64,
}

/// A single canonical relation projected into graph semantics.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorldGraphEdge {
    pub id: String,
    pub project_id: String,
    pub source_entity_id: String,
    pub target_entity_id: String,
    pub relation_type_id: String,
    pub forward_label: String,
    pub inverse_label: Option<String>,
    pub directed: bool,
    pub color_token: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorldGraphEntityKindCount {
    pub kind: EntityKind,
    pub count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorldGraphRelationTypeCount {
    pub relation_type_id: String,
    pub name: String,
    pub inverse_name: Option<String>,
    pub directed: bool,
    pub color_token: Option<String>,
    pub is_builtin: bool,
    pub count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorldGraphDegreeEntry {
    pub entity_id: String,
    pub label: String,
    pub degree: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorldGraphStats {
    pub entity_count: u64,
    pub relation_count: u64,
    pub entity_kind_counts: Vec<WorldGraphEntityKindCount>,
    pub relation_type_counts: Vec<WorldGraphRelationTypeCount>,
    pub isolated_entity_count: u64,
    pub directed_relation_count: u64,
    pub undirected_relation_count: u64,
    pub top_degree_entities: Vec<WorldGraphDegreeEntry>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WorldGraphDiagnosticCode {
    SelfRelation,
    CrossProjectRelation,
    DanglingRelationMember,
    DuplicateUndirectedRelation,
    InvalidEntityTag,
    InvalidSceneLink,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WorldGraphDiagnosticSeverity {
    Error,
    Warning,
}

/// A corrupt canonical record is excluded from the rendered graph and reported here.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorldGraphDiagnostic {
    pub code: WorldGraphDiagnosticCode,
    pub severity: WorldGraphDiagnosticSeverity,
    pub record_id: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GetWorldGraphParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
}

/// Complete, non-paginated Phase 1D graph for one project revision.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorldGraphReadModel {
    pub project_id: String,
    pub revision: i64,
    pub nodes: Vec<WorldGraphNode>,
    pub edges: Vec<WorldGraphEdge>,
    pub stats: WorldGraphStats,
    pub diagnostics: Vec<WorldGraphDiagnostic>,
}

pub type GetWorldGraphStatsParams = GetWorldGraphParams;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GetWorldGraphStatsResult {
    pub project_id: String,
    pub revision: i64,
    pub stats: WorldGraphStats,
    pub diagnostics: Vec<WorldGraphDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GetEntityGraphDetailParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub entity_id: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WorldGraphRelationPerspective {
    Outgoing,
    Incoming,
    Undirected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorldGraphRelationDetail {
    pub edge: WorldGraphEdge,
    pub counterpart_entity_id: String,
    pub display_label: String,
    pub perspective: WorldGraphRelationPerspective,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EntityGraphDetail {
    pub project_id: String,
    pub revision: i64,
    pub entity: WorldGraphNode,
    pub outgoing_relations: Vec<WorldGraphRelationDetail>,
    pub incoming_relations: Vec<WorldGraphRelationDetail>,
    pub undirected_relations: Vec<WorldGraphRelationDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GetEntitySceneContextParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub entity_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorldGraphSceneLink {
    pub scene_node_id: String,
    pub scene_title: String,
    pub role: SceneEntityRole,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EntitySceneContext {
    pub project_id: String,
    pub revision: i64,
    pub entity_id: String,
    pub links: Vec<WorldGraphSceneLink>,
}
