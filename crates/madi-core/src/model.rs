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
