use std::path::PathBuf;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use madi_publication::PublicationDocument;
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub type Result<T> = std::result::Result<T, HwpxError>;

#[derive(Debug, Error)]
pub enum HwpxError {
    #[error("HWPX export request is invalid: {0}")]
    InvalidRequest(&'static str),
    #[error("Publication IR does not match the HWPX export request")]
    PublicationMismatch,
    #[error("Publication IR is invalid")]
    InvalidPublication,
    #[error("HWPX export was cancelled")]
    Cancelled,
    #[error("destination already exists")]
    DestinationExists,
    #[error("destination path is invalid")]
    InvalidDestination,
    #[error("HWPX package generation failed")]
    Package,
    #[error("HWPX internal validation failed")]
    ValidationFailed(HwpxValidationReport),
    #[error("HWPX output could not be written")]
    Output,
    #[error("HWPX JSON contract is invalid")]
    Json(#[from] serde_json::Error),
}

impl From<zip::result::ZipError> for HwpxError {
    fn from(_: zip::result::ZipError) -> Self {
        Self::Package
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HwpxPageSizeToken {
    A4,
    Letter,
    Custom,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HwpxOrientation {
    Portrait,
    Landscape,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HwpxPageSettings {
    pub page_size_token: HwpxPageSizeToken,
    pub orientation: HwpxOrientation,
    pub custom_width_mm: Option<f64>,
    pub custom_height_mm: Option<f64>,
    pub margin_top_mm: f64,
    pub margin_bottom_mm: f64,
    pub margin_left_mm: f64,
    pub margin_right_mm: f64,
    pub header_margin_mm: f64,
    pub footer_margin_mm: f64,
    pub gutter_mm: f64,
}

impl Default for HwpxPageSettings {
    fn default() -> Self {
        Self {
            page_size_token: HwpxPageSizeToken::A4,
            orientation: HwpxOrientation::Portrait,
            custom_width_mm: None,
            custom_height_mm: None,
            margin_top_mm: 20.0,
            margin_bottom_mm: 20.0,
            margin_left_mm: 25.0,
            margin_right_mm: 25.0,
            header_margin_mm: 15.0,
            footer_margin_mm: 15.0,
            gutter_mm: 0.0,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "mode",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
pub enum HwpxLineSpacing {
    Percent { percent: f64 },
    Fixed { hwpunit: u32 },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HwpxTextAlign {
    Justify,
    Left,
    Right,
    Center,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HwpxBodyStyle {
    pub font_family: String,
    pub font_size_pt: f64,
    pub line_spacing: HwpxLineSpacing,
    pub first_line_indent_hwpunit: i32,
    pub paragraph_spacing_before_hwpunit: i32,
    pub paragraph_spacing_after_hwpunit: i32,
    pub text_align: HwpxTextAlign,
}

impl Default for HwpxBodyStyle {
    fn default() -> Self {
        Self {
            font_family: "함초롬바탕".to_owned(),
            font_size_pt: 10.0,
            line_spacing: HwpxLineSpacing::Percent { percent: 160.0 },
            first_line_indent_hwpunit: 1000,
            paragraph_spacing_before_hwpunit: 0,
            paragraph_spacing_after_hwpunit: 0,
            text_align: HwpxTextAlign::Justify,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HwpxHeadingStyle {
    pub font_family: String,
    pub font_size_pt: f64,
    pub bold: bool,
    pub alignment: HwpxTextAlign,
    pub spacing_before_hwpunit: i32,
    pub spacing_after_hwpunit: i32,
    pub page_break_before: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HwpxHeadingStyles {
    pub work: HwpxHeadingStyle,
    pub volume: HwpxHeadingStyle,
    pub chapter: HwpxHeadingStyle,
    pub scene: HwpxHeadingStyle,
}

impl Default for HwpxHeadingStyles {
    fn default() -> Self {
        Self {
            work: HwpxHeadingStyle {
                font_family: "함초롬바탕".to_owned(),
                font_size_pt: 22.0,
                bold: true,
                alignment: HwpxTextAlign::Center,
                spacing_before_hwpunit: 0,
                spacing_after_hwpunit: 2400,
                page_break_before: false,
            },
            volume: HwpxHeadingStyle {
                font_family: "함초롬바탕".to_owned(),
                font_size_pt: 18.0,
                bold: true,
                alignment: HwpxTextAlign::Center,
                spacing_before_hwpunit: 1800,
                spacing_after_hwpunit: 1800,
                page_break_before: true,
            },
            chapter: HwpxHeadingStyle {
                font_family: "함초롬바탕".to_owned(),
                font_size_pt: 16.0,
                bold: true,
                alignment: HwpxTextAlign::Left,
                spacing_before_hwpunit: 1400,
                spacing_after_hwpunit: 1200,
                page_break_before: true,
            },
            scene: HwpxHeadingStyle {
                font_family: "함초롬바탕".to_owned(),
                font_size_pt: 12.0,
                bold: true,
                alignment: HwpxTextAlign::Left,
                spacing_before_hwpunit: 1000,
                spacing_after_hwpunit: 600,
                page_break_before: false,
            },
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HwpxSceneBreakToken {
    Ornament,
    Rule,
    Space,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HwpxPageNumberPosition {
    BottomLeft,
    BottomCenter,
    BottomRight,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HwpxSectionSplitMode {
    Single,
    Volume,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HwpxExportOptions {
    pub section_split_mode: HwpxSectionSplitMode,
    pub page: HwpxPageSettings,
    pub body: HwpxBodyStyle,
    pub headings: HwpxHeadingStyles,
    pub include_title_page: bool,
    pub include_work_title: bool,
    pub include_volume_titles: bool,
    pub include_chapter_titles: bool,
    pub include_scene_titles: bool,
    pub chapter_starts_on_new_page: bool,
    pub scene_break_token: HwpxSceneBreakToken,
    pub include_page_number: bool,
    pub page_number_start: u32,
    pub page_number_position: HwpxPageNumberPosition,
    pub include_header: bool,
    pub header_text: String,
    pub include_footer: bool,
    pub footer_text: String,
}

impl Default for HwpxExportOptions {
    fn default() -> Self {
        Self {
            section_split_mode: HwpxSectionSplitMode::Single,
            page: HwpxPageSettings::default(),
            body: HwpxBodyStyle::default(),
            headings: HwpxHeadingStyles::default(),
            include_title_page: false,
            include_work_title: true,
            include_volume_titles: true,
            include_chapter_titles: true,
            include_scene_titles: true,
            chapter_starts_on_new_page: true,
            scene_break_token: HwpxSceneBreakToken::Ornament,
            include_page_number: false,
            page_number_start: 1,
            page_number_position: HwpxPageNumberPosition::BottomCenter,
            include_header: false,
            header_text: String::new(),
            include_footer: false,
            footer_text: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HwpxExportMetadata {
    pub title: String,
    pub author_name: String,
    pub subtitle: Option<String>,
    pub genre: Option<String>,
    /// One-shot front-matter data. It is intentionally absent from reports.
    pub contact: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HwpxExportRequest {
    pub project_id: String,
    pub scope_node_id: String,
    pub expected_project_revision: i64,
    pub source_publication_hash: String,
    pub preset_id: String,
    pub preset_content_hash: String,
    pub metadata: HwpxExportMetadata,
    pub options: HwpxExportOptions,
    pub output_path: PathBuf,
    pub replace_existing: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HwpxValidationStatus {
    Pass,
    Fail,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HwpxValidationSeverity {
    Fatal,
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HwpxValidationMessage {
    pub code: String,
    pub severity: HwpxValidationSeverity,
    pub description: String,
    pub source_node_id: Option<String>,
    pub hwpx_path: Option<String>,
    pub suggestion: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HwpxValidationReport {
    pub status: HwpxValidationStatus,
    pub fatal_count: u64,
    pub error_count: u64,
    pub warning_count: u64,
    pub info_count: u64,
    pub messages: Vec<HwpxValidationMessage>,
}

impl Default for HwpxValidationReport {
    fn default() -> Self {
        Self {
            status: HwpxValidationStatus::Pass,
            fatal_count: 0,
            error_count: 0,
            warning_count: 0,
            info_count: 0,
            messages: Vec::new(),
        }
    }
}

impl HwpxValidationReport {
    pub(crate) fn push(&mut self, message: HwpxValidationMessage) {
        match message.severity {
            HwpxValidationSeverity::Fatal => self.fatal_count += 1,
            HwpxValidationSeverity::Error => self.error_count += 1,
            HwpxValidationSeverity::Warning => self.warning_count += 1,
            HwpxValidationSeverity::Info => self.info_count += 1,
        }
        if self.fatal_count > 0 || self.error_count > 0 {
            self.status = HwpxValidationStatus::Fail;
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
pub struct HwpxExportTiming {
    pub semantic_mapping_ms: u64,
    pub style_table_ms: u64,
    pub section_xml_ms: u64,
    pub package_documents_ms: u64,
    pub zip_packaging_ms: u64,
    pub zip_reopen_ms: u64,
    pub internal_validation_ms: u64,
    pub source_coverage_ms: u64,
    pub exporter_total_ms: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HwpxPackageStatistics {
    pub file_count: u64,
    pub section_count: u64,
    pub exported_section_count: u64,
    pub paragraph_count: u64,
    pub run_count: u64,
    pub text_count: u64,
    pub source_section_count: u64,
    pub source_block_count: u64,
    pub exported_block_count: u64,
    pub fallback_block_count: u64,
    pub configured_omission_block_count: u64,
    pub rejected_block_count: u64,
    pub source_character_count: u64,
    pub exported_character_count: u64,
    pub heading_count: u64,
    pub scene_break_count: u64,
    pub ruby_count: u64,
    pub ruby_fallback_count: u64,
    pub strong_segment_count: u64,
    pub emphasis_segment_count: u64,
    pub underline_segment_count: u64,
    pub strike_segment_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HwpxCompileSummary {
    pub byte_length: u64,
    pub sha256: String,
    pub logical_package_hash: String,
    pub package_xml_version: String,
    pub source_publication_hash: String,
    pub preset_id: String,
    pub preset_content_hash: String,
    pub font_family: String,
    pub validation_report: HwpxValidationReport,
    pub export_timing: HwpxExportTiming,
    pub statistics: HwpxPackageStatistics,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HwpxExportResult {
    pub output_path: PathBuf,
    pub byte_length: u64,
    pub sha256: String,
    pub logical_package_hash: String,
    pub package_xml_version: String,
    pub source_publication_hash: String,
    pub preset_id: String,
    pub preset_content_hash: String,
    pub font_family: String,
    pub validation_report: HwpxValidationReport,
    pub export_timing: HwpxExportTiming,
    pub statistics: HwpxPackageStatistics,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompiledHwpx {
    pub bytes: Vec<u8>,
    pub summary: HwpxCompileSummary,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HwpxProgressStage {
    PublicationIr,
    StyleTable,
    SectionXml,
    PackageDocuments,
    ZipPackaging,
    InternalValidation,
    WriteOutput,
    Complete,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HwpxProgressEvent {
    pub stage: HwpxProgressStage,
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
            Err(HwpxError::Cancelled)
        } else {
            Ok(())
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HwpxUtilityMode {
    Export,
    ValidateOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HwpxUtilityInput {
    pub operation_id: String,
    pub mode: HwpxUtilityMode,
    pub document: PublicationDocument,
    pub request: HwpxExportRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum HwpxUtilityMessage {
    Progress {
        stage: HwpxProgressStage,
        completed: u64,
        total: u64,
    },
    Result {
        mode: HwpxUtilityMode,
        output_path: Option<PathBuf>,
        summary: HwpxCompileSummary,
    },
    Error {
        code: String,
        description: String,
        validation_report: Option<HwpxValidationReport>,
    },
}
