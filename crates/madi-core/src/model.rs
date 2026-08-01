use std::path::PathBuf;

use serde::{Deserialize, Serialize};

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

