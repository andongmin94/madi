use std::path::PathBuf;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use madi_publication::PublicationDocument;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use thiserror::Error;

pub type Result<T> = std::result::Result<T, EpubError>;

#[derive(Debug, Error)]
pub enum EpubError {
    #[error("EPUB export request is invalid: {0}")]
    InvalidRequest(&'static str),
    #[error("Publication IR does not match the export request")]
    PublicationMismatch,
    #[error("Publication IR is invalid")]
    InvalidPublication,
    #[error("cover image is invalid: {0}")]
    InvalidCover(&'static str),
    #[error("EPUB export was cancelled")]
    Cancelled,
    #[error("destination already exists")]
    DestinationExists,
    #[error("destination path is invalid")]
    InvalidDestination,
    #[error("EPUB package generation failed")]
    Package,
    #[error("EPUB internal validation failed")]
    ValidationFailed(EpubValidationReport),
    #[error("EPUB output could not be written")]
    Output,
    #[error("EPUB JSON contract is invalid")]
    Json(#[from] serde_json::Error),
}

impl From<zip::result::ZipError> for EpubError {
    fn from(_: zip::result::ZipError) -> Self {
        Self::Package
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum EpubTargetProfile {
    #[serde(rename = "EPUB_3_4_DRAFT_2026_08")]
    Epub34Draft202608,
    #[serde(rename = "EPUB_3_3_COMPATIBILITY")]
    Epub33Compatibility,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EpubSplitMode {
    Chapter,
    Scene,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EpubStylesheetToken {
    MadiClassic,
    MadiModern,
    MadiMinimal,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EpubSceneBreakStyleToken {
    Ornament,
    Rule,
    Space,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EpubBodyStyleToken {
    ReflowableProse,
    IndentedProse,
    SpacedProse,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EpubExportOptions {
    pub target_profile: EpubTargetProfile,
    pub split_mode: EpubSplitMode,
    pub include_cover: bool,
    pub include_scene_titles: bool,
    pub include_chapter_titles: bool,
    pub toc_depth: u8,
    pub scene_break_style_token: EpubSceneBreakStyleToken,
    pub body_style_token: EpubBodyStyleToken,
    pub stylesheet_token: EpubStylesheetToken,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EpubPublicationMetadata {
    pub title: String,
    pub creator_name: String,
    pub language: String,
    pub identifier: String,
    pub publisher: Option<String>,
    pub description: Option<String>,
    pub rights: Option<String>,
    pub subjects: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum EpubCoverMediaType {
    #[serde(rename = "image/png")]
    Png,
    #[serde(rename = "image/jpeg")]
    Jpeg,
}

impl EpubCoverMediaType {
    pub(crate) fn media_type(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
        }
    }

    pub(crate) fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpg",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EpubCoverInput {
    pub media_type: EpubCoverMediaType,
    pub original_name: String,
    #[serde(rename = "bytesBase64", with = "base64_bytes")]
    pub bytes: Vec<u8>,
}

mod base64_bytes {
    use super::*;

    pub fn serialize<S>(bytes: &[u8], serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&BASE64_STANDARD.encode(bytes))
    }

    pub fn deserialize<'de, D>(deserializer: D) -> std::result::Result<Vec<u8>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let encoded = String::deserialize(deserializer)?;
        BASE64_STANDARD
            .decode(encoded)
            .map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EpubExportRequest {
    pub project_id: String,
    pub scope_node_id: String,
    pub expected_project_revision: i64,
    pub source_publication_hash: String,
    pub metadata: EpubPublicationMetadata,
    pub options: EpubExportOptions,
    pub output_path: PathBuf,
    pub replace_existing: bool,
    pub cover: Option<EpubCoverInput>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EpubValidationStatus {
    Pass,
    Fail,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EpubValidationSeverity {
    Fatal,
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EpubValidationMessage {
    pub code: String,
    pub severity: EpubValidationSeverity,
    pub description: String,
    pub source_node_id: Option<String>,
    pub epub_path: Option<String>,
    pub suggestion: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EpubValidationReport {
    pub status: EpubValidationStatus,
    pub fatal_count: u64,
    pub error_count: u64,
    pub warning_count: u64,
    pub info_count: u64,
    pub messages: Vec<EpubValidationMessage>,
}

impl Default for EpubValidationReport {
    fn default() -> Self {
        Self {
            status: EpubValidationStatus::Pass,
            fatal_count: 0,
            error_count: 0,
            warning_count: 0,
            info_count: 0,
            messages: Vec::new(),
        }
    }
}

impl EpubValidationReport {
    pub(crate) fn push(&mut self, message: EpubValidationMessage) {
        match message.severity {
            EpubValidationSeverity::Fatal => self.fatal_count += 1,
            EpubValidationSeverity::Error => self.error_count += 1,
            EpubValidationSeverity::Warning => self.warning_count += 1,
            EpubValidationSeverity::Info => self.info_count += 1,
        }
        if self.fatal_count > 0 || self.error_count > 0 {
            self.status = EpubValidationStatus::Fail;
        }
        self.messages.push(message);
    }

    pub(crate) fn append(&mut self, mut other: Self) {
        for message in other.messages.drain(..) {
            self.push(message);
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EpubExportTiming {
    pub content_split_ms: u64,
    pub xhtml_generation_ms: u64,
    pub package_documents_ms: u64,
    pub zip_packaging_ms: u64,
    pub internal_validation_ms: u64,
    pub total_ms: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EpubPackageStatistics {
    pub file_count: u64,
    pub xhtml_count: u64,
    pub source_section_count: u64,
    pub exported_section_count: u64,
    pub source_block_count: u64,
    pub exported_block_count: u64,
    pub fallback_block_count: u64,
    pub rejected_block_count: u64,
    pub source_character_count: u64,
    pub exported_character_count: u64,
    pub scene_break_count: u64,
    pub ruby_count: u64,
    pub heading_count: u64,
    pub cover_included: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EpubCompileSummary {
    pub byte_length: u64,
    pub sha256: String,
    pub logical_package_hash: String,
    pub target_profile: EpubTargetProfile,
    pub source_publication_hash: String,
    pub validation_report: EpubValidationReport,
    pub export_timing: EpubExportTiming,
    pub statistics: EpubPackageStatistics,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EpubExportResult {
    pub output_path: PathBuf,
    pub byte_length: u64,
    pub sha256: String,
    pub logical_package_hash: String,
    pub target_profile: EpubTargetProfile,
    pub source_publication_hash: String,
    pub validation_report: EpubValidationReport,
    pub export_timing: EpubExportTiming,
    pub statistics: EpubPackageStatistics,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompiledEpub {
    pub bytes: Vec<u8>,
    pub summary: EpubCompileSummary,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EpubProgressStage {
    PublicationIr,
    ContentSplit,
    XhtmlGeneration,
    PackageDocuments,
    ZipPackaging,
    InternalValidation,
    WriteOutput,
    Complete,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EpubProgressEvent {
    pub stage: EpubProgressStage,
    pub completed: u64,
    pub total: u64,
}

#[derive(Debug, Clone, Default)]
pub struct CancellationToken(Arc<AtomicBool>);

impl CancellationToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }

    pub(crate) fn check(&self) -> Result<()> {
        if self.is_cancelled() {
            Err(EpubError::Cancelled)
        } else {
            Ok(())
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EpubUtilityMode {
    Export,
    ValidateOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EpubUtilityInput {
    pub operation_id: String,
    pub mode: EpubUtilityMode,
    pub document: PublicationDocument,
    pub request: EpubExportRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum EpubUtilityMessage {
    Progress {
        stage: EpubProgressStage,
        completed: u64,
        total: u64,
    },
    Result {
        mode: EpubUtilityMode,
        output_path: Option<PathBuf>,
        summary: EpubCompileSummary,
    },
    Error {
        code: String,
        description: String,
        validation_report: Option<EpubValidationReport>,
    },
}
