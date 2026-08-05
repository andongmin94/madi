use std::collections::{BTreeMap, HashSet};
use std::io::Cursor;
use std::path::PathBuf;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use image::{ImageFormat, ImageReader, Limits};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::{CoreError, Result};
use crate::model::AppMeta;
use crate::storage::{
    database_timestamp, default_client_identifier, load_app_meta, open_existing, sync_file,
    validate_non_empty,
};

pub const EXPORT_PRESET_FORMAT: &str = "MADI_EXPORT_PRESET";
pub const EXPORT_PRESET_VERSION: i64 = 1;
pub const MAX_COVER_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_COVER_DIMENSION: u32 = 10_000;
pub const MAX_COVER_PIXELS: u64 = 40_000_000;

const MAX_ID_CHARS: usize = 256;
const MAX_TITLE_CHARS: usize = 1_000;
const MAX_CREATOR_CHARS: usize = 500;
const MAX_PRESET_NAME_CHARS: usize = 500;
const MAX_IDENTIFIER_CHARS: usize = 1_000;
const MAX_PUBLISHER_CHARS: usize = 1_000;
const MAX_DESCRIPTION_CHARS: usize = 20_000;
const MAX_RIGHTS_CHARS: usize = 10_000;
const MAX_SUBJECTS: usize = 64;
const MAX_SUBJECT_CHARS: usize = 500;
const MAX_ORIGINAL_NAME_CHARS: usize = 255;
const MAX_COVER_BASE64_CHARS: usize = MAX_COVER_BYTES.div_ceil(3) * 4;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PublicationAssetKind {
    Cover,
}

impl PublicationAssetKind {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Cover => "COVER",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "COVER" => Ok(Self::Cover),
            _ => Err(CoreError::Integrity(
                "publication asset kind is invalid".to_owned(),
            )),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PublicationMetadataRecord {
    pub project_id: String,
    pub publication_title: String,
    pub creator_name: String,
    pub language: String,
    pub identifier: String,
    pub publisher: Option<String>,
    pub description: Option<String>,
    pub rights: Option<String>,
    pub subjects: Vec<String>,
    pub cover_asset_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PublicationAssetRecord {
    pub id: String,
    pub project_id: String,
    pub kind: PublicationAssetKind,
    pub media_type: String,
    pub original_name: String,
    pub sha256: String,
    pub bytes_base64: String,
    pub byte_length: u64,
    pub width: u32,
    pub height: u32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EpubStylesheetToken {
    MadiClassic,
    MadiModern,
    MadiMinimal,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EpubExportPresetConfig {
    pub format_version: i64,
    pub target_profile: EpubTargetProfile,
    pub split_mode: EpubSplitMode,
    pub toc_depth: u8,
    pub include_chapter_titles: bool,
    pub include_scene_titles: bool,
    pub scene_break_style_token: EpubSceneBreakStyleToken,
    pub body_style_token: EpubBodyStyleToken,
    pub include_cover: bool,
    pub stylesheet_token: EpubStylesheetToken,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExportPresetKind {
    Epub,
    Hwpx,
}

impl ExportPresetKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Epub => "EPUB",
            Self::Hwpx => "HWPX",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "EPUB" => Ok(Self::Epub),
            "HWPX" => Ok(Self::Hwpx),
            _ => Err(CoreError::Integrity(
                "export preset kind is invalid".to_owned(),
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HwpxPageSizeToken {
    A4,
    Letter,
    Custom,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HwpxOrientation {
    Portrait,
    Landscape,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HwpxLineSpacingMode {
    Percent,
    FixedPt,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HwpxTextAlign {
    Left,
    Center,
    Right,
    Justify,
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
pub enum HwpxSceneBreakToken {
    Ornament,
    Rule,
    Space,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HwpxSectionSplitMode {
    Single,
    Volume,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HwpxHeadingStyleConfig {
    pub font_family_token: String,
    pub font_size_pt: f64,
    pub bold: bool,
    pub alignment: HwpxTextAlign,
    pub spacing_before: f64,
    pub spacing_after: f64,
    pub page_break_before: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HwpxExportPresetConfig {
    pub format_version: i64,
    pub page_size_token: HwpxPageSizeToken,
    pub custom_page_width: Option<f64>,
    pub custom_page_height: Option<f64>,
    pub orientation: HwpxOrientation,
    pub margin_top: f64,
    pub margin_bottom: f64,
    pub margin_left: f64,
    pub margin_right: f64,
    pub header_margin: f64,
    pub footer_margin: f64,
    pub gutter: f64,
    pub font_family_token: String,
    pub font_size_pt: f64,
    pub line_spacing_mode: HwpxLineSpacingMode,
    pub line_spacing_value: f64,
    pub first_line_indent: f64,
    pub paragraph_spacing_before: f64,
    pub paragraph_spacing_after: f64,
    pub text_align: HwpxTextAlign,
    pub work_title_style: HwpxHeadingStyleConfig,
    pub volume_title_style: HwpxHeadingStyleConfig,
    pub chapter_title_style: HwpxHeadingStyleConfig,
    pub scene_title_style: HwpxHeadingStyleConfig,
    pub include_title_page: bool,
    pub include_work_title: bool,
    pub include_volume_titles: bool,
    pub include_chapter_titles: bool,
    pub include_scene_titles: bool,
    pub section_split_mode: HwpxSectionSplitMode,
    pub include_page_number: bool,
    pub page_number_start: i64,
    pub page_number_position: HwpxPageNumberPosition,
    pub include_header: bool,
    pub header_text: String,
    pub include_footer: bool,
    pub footer_text: String,
    pub scene_break_token: HwpxSceneBreakToken,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ExportPresetConfig {
    Epub(EpubExportPresetConfig),
    Hwpx(HwpxExportPresetConfig),
}

impl Serialize for ExportPresetConfig {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Epub(config) => config.serialize(serializer),
            Self::Hwpx(config) => config.serialize(serializer),
        }
    }
}

impl ExportPresetConfig {
    pub const fn kind(&self) -> ExportPresetKind {
        match self {
            Self::Epub(_) => ExportPresetKind::Epub,
            Self::Hwpx(_) => ExportPresetKind::Hwpx,
        }
    }

    fn deserialize_for_kind(
        kind: ExportPresetKind,
        value: Value,
    ) -> std::result::Result<Self, serde_json::Error> {
        match kind {
            ExportPresetKind::Epub => serde_json::from_value(value).map(Self::Epub),
            ExportPresetKind::Hwpx => serde_json::from_value(value).map(Self::Hwpx),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ExportPresetRecord {
    pub id: String,
    pub project_id: String,
    pub kind: ExportPresetKind,
    pub name: String,
    pub preset_format: String,
    pub preset_version: i64,
    pub preset_json: ExportPresetConfig,
    pub content_hash: String,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}

impl<'de> Deserialize<'de> for ExportPresetRecord {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct WireRecord {
            id: String,
            project_id: String,
            kind: ExportPresetKind,
            name: String,
            preset_format: String,
            preset_version: i64,
            preset_json: Value,
            content_hash: String,
            revision: i64,
            created_at: String,
            updated_at: String,
        }

        let wire = WireRecord::deserialize(deserializer)?;
        let preset_json = ExportPresetConfig::deserialize_for_kind(wire.kind, wire.preset_json)
            .map_err(serde::de::Error::custom)?;
        Ok(Self {
            id: wire.id,
            project_id: wire.project_id,
            kind: wire.kind,
            name: wire.name,
            preset_format: wire.preset_format,
            preset_version: wire.preset_version,
            preset_json,
            content_hash: wire.content_hash,
            revision: wire.revision,
            created_at: wire.created_at,
            updated_at: wire.updated_at,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GetPublicationExportStateParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PublicationExportStateResult {
    pub metadata: AppMeta,
    pub publication_metadata: PublicationMetadataRecord,
    pub cover_asset: Option<PublicationAssetRecord>,
    pub export_presets: Vec<ExportPresetRecord>,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpdatePublicationMetadataParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub publication_title: String,
    pub creator_name: String,
    pub language: String,
    pub identifier: String,
    #[serde(default)]
    pub publisher: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub rights: Option<String>,
    #[serde(default)]
    pub subjects: Vec<String>,
    #[serde(default)]
    pub cover_asset_id: Option<String>,
    pub expected_revision: i64,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PublicationMetadataMutationResult {
    pub metadata: AppMeta,
    pub publication_metadata: PublicationMetadataRecord,
    pub no_op: bool,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SetPublicationCoverParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    #[serde(default)]
    pub asset_id: Option<String>,
    pub media_type: String,
    pub original_name: String,
    pub bytes_base64: String,
    pub expected_revision: i64,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PublicationCoverMutationResult {
    pub metadata: AppMeta,
    pub asset: PublicationAssetRecord,
    pub publication_metadata: PublicationMetadataRecord,
    pub no_op: bool,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RemovePublicationCoverParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub expected_revision: i64,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RemovePublicationCoverResult {
    pub metadata: AppMeta,
    pub deleted_asset_id: Option<String>,
    pub publication_metadata: PublicationMetadataRecord,
    pub no_op: bool,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ListExportPresetsParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ListExportPresetsResult {
    pub metadata: AppMeta,
    pub presets: Vec<ExportPresetRecord>,
    pub duplicate_names: Vec<String>,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CreateExportPresetParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    #[serde(default)]
    pub preset_id: Option<String>,
    pub kind: ExportPresetKind,
    pub name: String,
    pub preset_json: ExportPresetConfig,
    pub expected_revision: i64,
    #[serde(default)]
    pub saved_by: Option<String>,
}

impl<'de> Deserialize<'de> for CreateExportPresetParams {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct WireParams {
            #[serde(alias = "path")]
            file_path: PathBuf,
            #[serde(default)]
            preset_id: Option<String>,
            kind: ExportPresetKind,
            name: String,
            preset_json: Value,
            expected_revision: i64,
            #[serde(default)]
            saved_by: Option<String>,
        }

        let wire = WireParams::deserialize(deserializer)?;
        let preset_json = ExportPresetConfig::deserialize_for_kind(wire.kind, wire.preset_json)
            .map_err(serde::de::Error::custom)?;
        Ok(Self {
            file_path: wire.file_path,
            preset_id: wire.preset_id,
            kind: wire.kind,
            name: wire.name,
            preset_json,
            expected_revision: wire.expected_revision,
            saved_by: wire.saved_by,
        })
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct UpdateExportPresetParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub preset_id: String,
    pub kind: ExportPresetKind,
    pub name: String,
    pub preset_json: ExportPresetConfig,
    pub expected_revision: i64,
    pub expected_preset_revision: i64,
    #[serde(default)]
    pub saved_by: Option<String>,
}

impl<'de> Deserialize<'de> for UpdateExportPresetParams {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct WireParams {
            #[serde(alias = "path")]
            file_path: PathBuf,
            preset_id: String,
            kind: ExportPresetKind,
            name: String,
            preset_json: Value,
            expected_revision: i64,
            expected_preset_revision: i64,
            #[serde(default)]
            saved_by: Option<String>,
        }

        let wire = WireParams::deserialize(deserializer)?;
        let preset_json = ExportPresetConfig::deserialize_for_kind(wire.kind, wire.preset_json)
            .map_err(serde::de::Error::custom)?;
        Ok(Self {
            file_path: wire.file_path,
            preset_id: wire.preset_id,
            kind: wire.kind,
            name: wire.name,
            preset_json,
            expected_revision: wire.expected_revision,
            expected_preset_revision: wire.expected_preset_revision,
            saved_by: wire.saved_by,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DuplicateExportPresetParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub source_preset_id: String,
    #[serde(default)]
    pub preset_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    pub expected_revision: i64,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeleteExportPresetParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub preset_id: String,
    pub expected_revision: i64,
    pub expected_preset_revision: i64,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExportPresetMutationResult {
    pub metadata: AppMeta,
    pub preset: ExportPresetRecord,
    pub no_op: bool,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeleteExportPresetResult {
    pub metadata: AppMeta,
    pub deleted_preset_id: String,
    pub revision: i64,
}

pub fn stable_publication_identifier(project_id: &str) -> String {
    format!(
        "urn:madi:publication:{:x}",
        Sha256::digest(project_id.as_bytes())
    )
}

pub(crate) fn seed_publication_metadata(
    transaction: &Transaction<'_>,
    project_id: &str,
    title: &str,
    author_name: Option<&str>,
    now: &str,
) -> Result<()> {
    let creator_name = author_name.unwrap_or_default();
    transaction.execute(
        "INSERT OR IGNORE INTO publication_metadata (
            project_id, publication_title, creator_name, language, identifier,
            publisher, description, rights, subjects_json, cover_asset_id,
            created_at, updated_at
         ) VALUES (?1, ?2, ?3, 'ko-KR', ?4, NULL, NULL, NULL, '[]', NULL, ?5, ?5)",
        params![
            project_id,
            title,
            creator_name,
            stable_publication_identifier(project_id),
            now,
        ],
    )?;
    Ok(())
}

pub fn get_publication_export_state(
    params: GetPublicationExportStateParams,
) -> Result<PublicationExportStateResult> {
    let connection = open_existing(&params.file_path)?;
    let metadata = load_app_meta(&connection)?;
    let publication_metadata = load_publication_metadata(&connection, &metadata.project_id)?;
    let cover_asset = load_project_cover(&connection, &metadata.project_id)?;
    ensure_cover_reference(&publication_metadata, cover_asset.as_ref())?;
    let export_presets = load_project_export_presets(&connection, &metadata.project_id)?;
    let revision = metadata.revision;
    connection.close().map_err(|(_, error)| error)?;
    Ok(PublicationExportStateResult {
        metadata,
        publication_metadata,
        cover_asset,
        export_presets,
        revision,
    })
}

pub fn update_publication_metadata(
    params: UpdatePublicationMetadataParams,
) -> Result<PublicationMetadataMutationResult> {
    validate_revision(params.expected_revision, "expected_revision")?;
    let mut candidate = PublicationMetadataRecord {
        project_id: String::new(),
        publication_title: params.publication_title,
        creator_name: params.creator_name,
        language: params.language,
        identifier: params.identifier,
        publisher: normalized_optional(params.publisher),
        description: normalized_optional(params.description),
        rights: normalized_optional(params.rights),
        subjects: params.subjects,
        cover_asset_id: params.cover_asset_id,
        created_at: String::new(),
        updated_at: String::new(),
    };
    validate_publication_metadata_values(&candidate)?;
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let before = load_app_meta(&connection)?;
    ensure_metadata_revision(before.revision, params.expected_revision)?;
    let current = load_publication_metadata(&connection, &before.project_id)?;
    let current_cover = load_project_cover(&connection, &before.project_id)?;
    ensure_cover_reference(&current, current_cover.as_ref())?;
    if candidate.cover_asset_id.is_none() {
        candidate.cover_asset_id.clone_from(&current.cover_asset_id);
    }
    if let Some(asset_id) = candidate.cover_asset_id.as_deref() {
        ensure_project_cover_id(&connection, &before.project_id, asset_id)?;
    }
    if publication_metadata_values_equal(&current, &candidate) {
        let revision = before.revision;
        connection.close().map_err(|(_, error)| error)?;
        return Ok(PublicationMetadataMutationResult {
            metadata: before,
            publication_metadata: current,
            no_op: true,
            revision,
        });
    }
    let now = database_timestamp(&connection)?;
    {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_project_revision(&transaction, params.expected_revision)?;
        if let Some(asset_id) = candidate.cover_asset_id.as_deref() {
            ensure_project_cover_id(&transaction, &before.project_id, asset_id)?;
        }
        let subjects_json = canonical_subjects_json(&candidate.subjects)?;
        let changed = transaction.execute(
            "UPDATE publication_metadata
             SET publication_title = ?1, creator_name = ?2, language = ?3,
                 identifier = ?4, publisher = ?5, description = ?6, rights = ?7,
                 subjects_json = ?8, cover_asset_id = ?9, updated_at = ?10
             WHERE project_id = ?11",
            params![
                candidate.publication_title,
                candidate.creator_name,
                candidate.language,
                candidate.identifier,
                candidate.publisher,
                candidate.description,
                candidate.rights,
                subjects_json,
                candidate.cover_asset_id,
                now,
                before.project_id,
            ],
        )?;
        if changed != 1 {
            return Err(CoreError::Integrity(
                "publication metadata update did not affect one row".to_owned(),
            ));
        }
        bump_project_revision(&transaction, params.expected_revision, &saved_by, &now)?;
        transaction.commit()?;
    }
    let publication_metadata = load_publication_metadata(&connection, &before.project_id)?;
    let metadata = load_app_meta(&connection)?;
    let revision = metadata.revision;
    connection.close().map_err(|(_, error)| error)?;
    sync_file(&params.file_path)?;
    Ok(PublicationMetadataMutationResult {
        metadata,
        publication_metadata,
        no_op: false,
        revision,
    })
}

pub fn set_publication_cover(
    params: SetPublicationCoverParams,
) -> Result<PublicationCoverMutationResult> {
    validate_revision(params.expected_revision, "expected_revision")?;
    validate_original_name(&params.original_name, &params.media_type)?;
    if let Some(asset_id) = params.asset_id.as_deref() {
        validate_identifier("asset_id", asset_id)?;
    }
    if params.bytes_base64.len() > MAX_COVER_BASE64_CHARS {
        return invalid("bytes_base64 exceeds the maximum encoded cover size");
    }
    let bytes = BASE64_STANDARD
        .decode(params.bytes_base64.as_bytes())
        .map_err(|_| {
            CoreError::InvalidInput("bytes_base64 is not valid standard base64".to_owned())
        })?;
    let dimensions = validate_cover_bytes(&params.media_type, &bytes)?;
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let before = load_app_meta(&connection)?;
    ensure_metadata_revision(before.revision, params.expected_revision)?;
    let publication_before = load_publication_metadata(&connection, &before.project_id)?;
    let existing = load_project_cover(&connection, &before.project_id)?;
    ensure_cover_reference(&publication_before, existing.as_ref())?;
    if let Some(current) = existing.as_ref() {
        if current.media_type == params.media_type
            && current.original_name == params.original_name
            && current.sha256 == sha256
            && current.width == dimensions.0
            && current.height == dimensions.1
            && publication_before.cover_asset_id.as_deref() == Some(current.id.as_str())
        {
            let revision = before.revision;
            let asset = current.clone();
            connection.close().map_err(|(_, error)| error)?;
            return Ok(PublicationCoverMutationResult {
                metadata: before,
                asset,
                publication_metadata: publication_before,
                no_op: true,
                revision,
            });
        }
    }
    let asset_id = existing
        .as_ref()
        .map(|asset| asset.id.clone())
        .or(params.asset_id)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    validate_identifier("asset_id", &asset_id)?;
    let now = database_timestamp(&connection)?;
    {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_project_revision(&transaction, params.expected_revision)?;
        let write = if existing.is_some() {
            transaction.execute(
                "UPDATE publication_assets
                 SET media_type = ?1, original_name = ?2, sha256 = ?3, bytes = ?4,
                     width = ?5, height = ?6, updated_at = ?7
                 WHERE id = ?8 AND project_id = ?9 AND kind = 'COVER'",
                params![
                    params.media_type,
                    params.original_name,
                    sha256,
                    bytes,
                    dimensions.0,
                    dimensions.1,
                    now,
                    asset_id,
                    before.project_id,
                ],
            )
        } else {
            transaction.execute(
                "INSERT INTO publication_assets (
                    id, project_id, kind, media_type, original_name, sha256, bytes,
                    width, height, created_at, updated_at
                 ) VALUES (?1, ?2, 'COVER', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
                params![
                    asset_id,
                    before.project_id,
                    params.media_type,
                    params.original_name,
                    sha256,
                    bytes,
                    dimensions.0,
                    dimensions.1,
                    now,
                ],
            )
        };
        match write {
            Ok(1) => {}
            Err(error) if is_unique_constraint(&error) => {
                return Err(CoreError::IdentifierConflict {
                    entity: "publication asset",
                    id: asset_id,
                });
            }
            Ok(_) => {
                return Err(CoreError::Integrity(
                    "publication cover write did not affect one row".to_owned(),
                ))
            }
            Err(error) => return Err(error.into()),
        }
        transaction.execute(
            "UPDATE publication_metadata SET cover_asset_id = ?1, updated_at = ?2
             WHERE project_id = ?3",
            params![asset_id, now, before.project_id],
        )?;
        bump_project_revision(&transaction, params.expected_revision, &saved_by, &now)?;
        transaction.commit()?;
    }
    let asset = load_project_cover(&connection, &before.project_id)?.ok_or_else(|| {
        CoreError::Integrity("publication cover disappeared after write".to_owned())
    })?;
    let publication_metadata = load_publication_metadata(&connection, &before.project_id)?;
    let metadata = load_app_meta(&connection)?;
    let revision = metadata.revision;
    connection.close().map_err(|(_, error)| error)?;
    sync_file(&params.file_path)?;
    Ok(PublicationCoverMutationResult {
        metadata,
        asset,
        publication_metadata,
        no_op: false,
        revision,
    })
}

pub fn remove_publication_cover(
    params: RemovePublicationCoverParams,
) -> Result<RemovePublicationCoverResult> {
    validate_revision(params.expected_revision, "expected_revision")?;
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let before = load_app_meta(&connection)?;
    ensure_metadata_revision(before.revision, params.expected_revision)?;
    let existing = load_project_cover(&connection, &before.project_id)?;
    let publication_before = load_publication_metadata(&connection, &before.project_id)?;
    ensure_cover_reference(&publication_before, existing.as_ref())?;
    if existing.is_none() {
        let revision = before.revision;
        connection.close().map_err(|(_, error)| error)?;
        return Ok(RemovePublicationCoverResult {
            metadata: before,
            deleted_asset_id: None,
            publication_metadata: publication_before,
            no_op: true,
            revision,
        });
    }
    let deleted_asset_id = existing.map(|asset| asset.id).expect("checked");
    let now = database_timestamp(&connection)?;
    {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_project_revision(&transaction, params.expected_revision)?;
        transaction.execute(
            "UPDATE publication_metadata SET cover_asset_id = NULL, updated_at = ?1
             WHERE project_id = ?2",
            params![now, before.project_id],
        )?;
        let changed = transaction.execute(
            "DELETE FROM publication_assets
             WHERE id = ?1 AND project_id = ?2 AND kind = 'COVER'",
            params![deleted_asset_id, before.project_id],
        )?;
        if changed != 1 {
            return Err(CoreError::Integrity(
                "publication cover delete did not affect one row".to_owned(),
            ));
        }
        bump_project_revision(&transaction, params.expected_revision, &saved_by, &now)?;
        transaction.commit()?;
    }
    let publication_metadata = load_publication_metadata(&connection, &before.project_id)?;
    let metadata = load_app_meta(&connection)?;
    let revision = metadata.revision;
    connection.close().map_err(|(_, error)| error)?;
    sync_file(&params.file_path)?;
    Ok(RemovePublicationCoverResult {
        metadata,
        deleted_asset_id: Some(deleted_asset_id),
        publication_metadata,
        no_op: false,
        revision,
    })
}

pub fn list_export_presets(params: ListExportPresetsParams) -> Result<ListExportPresetsResult> {
    let connection = open_existing(&params.file_path)?;
    let metadata = load_app_meta(&connection)?;
    let presets = load_project_export_presets(&connection, &metadata.project_id)?;
    let duplicate_names = duplicate_names(&presets);
    let revision = metadata.revision;
    connection.close().map_err(|(_, error)| error)?;
    Ok(ListExportPresetsResult {
        metadata,
        presets,
        duplicate_names,
        revision,
    })
}

pub fn create_export_preset(
    params: CreateExportPresetParams,
) -> Result<ExportPresetMutationResult> {
    validate_name(&params.name)?;
    validate_revision(params.expected_revision, "expected_revision")?;
    let kind = params.kind;
    let preset_id = params
        .preset_id
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    validate_identifier("preset_id", &preset_id)?;
    let (preset_json, content_hash) = canonical_export_preset(kind, &params.preset_json)?;
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let before = load_app_meta(&connection)?;
    ensure_metadata_revision(before.revision, params.expected_revision)?;
    let now = database_timestamp(&connection)?;
    {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_project_revision(&transaction, params.expected_revision)?;
        let inserted = transaction.execute(
            "INSERT INTO export_presets (
                id, project_id, kind, name, preset_format, preset_version,
                preset_json, content_hash, revision, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?9)",
            params![
                preset_id,
                before.project_id,
                kind.as_str(),
                params.name,
                EXPORT_PRESET_FORMAT,
                EXPORT_PRESET_VERSION,
                preset_json,
                content_hash,
                now,
            ],
        );
        match inserted {
            Ok(1) => {}
            Err(error) if is_unique_constraint(&error) => {
                return Err(CoreError::IdentifierConflict {
                    entity: "export preset",
                    id: preset_id,
                });
            }
            Ok(_) => {
                return Err(CoreError::Integrity(
                    "export preset insert did not affect one row".to_owned(),
                ))
            }
            Err(error) => return Err(error.into()),
        }
        bump_project_revision(&transaction, params.expected_revision, &saved_by, &now)?;
        transaction.commit()?;
    }
    mutation_result(
        connection,
        &params.file_path,
        &before.project_id,
        &preset_id,
        false,
    )
}

pub fn update_export_preset(
    params: UpdateExportPresetParams,
) -> Result<ExportPresetMutationResult> {
    validate_identifier("preset_id", &params.preset_id)?;
    validate_name(&params.name)?;
    validate_revision(params.expected_revision, "expected_revision")?;
    validate_revision(params.expected_preset_revision, "expected_preset_revision")?;
    let kind = params.kind;
    let (preset_json, content_hash) = canonical_export_preset(kind, &params.preset_json)?;
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let before = load_app_meta(&connection)?;
    ensure_metadata_revision(before.revision, params.expected_revision)?;
    let current = load_project_export_preset(&connection, &before.project_id, &params.preset_id)?;
    ensure_preset_revision(current.revision, params.expected_preset_revision)?;
    if current.kind != kind {
        return Err(CoreError::InvalidInput(
            "export preset kind cannot be changed".to_owned(),
        ));
    }
    if current.name == params.name && current.content_hash == content_hash {
        let revision = before.revision;
        connection.close().map_err(|(_, error)| error)?;
        return Ok(ExportPresetMutationResult {
            metadata: before,
            preset: current,
            no_op: true,
            revision,
        });
    }
    let now = database_timestamp(&connection)?;
    {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_project_revision(&transaction, params.expected_revision)?;
        let changed = transaction.execute(
            "UPDATE export_presets
             SET name = ?1, preset_json = ?2, content_hash = ?3,
                 revision = revision + 1, updated_at = ?4
             WHERE id = ?5 AND project_id = ?6 AND kind = ?7 AND revision = ?8",
            params![
                params.name,
                preset_json,
                content_hash,
                now,
                params.preset_id,
                before.project_id,
                kind.as_str(),
                params.expected_preset_revision,
            ],
        )?;
        if changed != 1 {
            return Err(CoreError::ExportPresetRevisionConflict {
                expected: params.expected_preset_revision,
                actual: current.revision,
            });
        }
        bump_project_revision(&transaction, params.expected_revision, &saved_by, &now)?;
        transaction.commit()?;
    }
    mutation_result(
        connection,
        &params.file_path,
        &before.project_id,
        &params.preset_id,
        false,
    )
}

pub fn duplicate_export_preset(
    params: DuplicateExportPresetParams,
) -> Result<ExportPresetMutationResult> {
    validate_identifier("source_preset_id", &params.source_preset_id)?;
    validate_revision(params.expected_revision, "expected_revision")?;
    let preset_id = params
        .preset_id
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    validate_identifier("preset_id", &preset_id)?;
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let before = load_app_meta(&connection)?;
    ensure_metadata_revision(before.revision, params.expected_revision)?;
    let source =
        load_project_export_preset(&connection, &before.project_id, &params.source_preset_id)?;
    let name = params
        .name
        .unwrap_or_else(|| format!("{} copy", source.name));
    validate_name(&name)?;
    let (preset_json, content_hash) = canonical_export_preset(source.kind, &source.preset_json)?;
    let now = database_timestamp(&connection)?;
    {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_project_revision(&transaction, params.expected_revision)?;
        let inserted = transaction.execute(
            "INSERT INTO export_presets (
                id, project_id, kind, name, preset_format, preset_version,
                preset_json, content_hash, revision, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?9)",
            params![
                preset_id,
                before.project_id,
                source.kind.as_str(),
                name,
                EXPORT_PRESET_FORMAT,
                EXPORT_PRESET_VERSION,
                preset_json,
                content_hash,
                now,
            ],
        );
        match inserted {
            Ok(1) => {}
            Err(error) if is_unique_constraint(&error) => {
                return Err(CoreError::IdentifierConflict {
                    entity: "export preset",
                    id: preset_id,
                });
            }
            Ok(_) => {
                return Err(CoreError::Integrity(
                    "export preset duplicate did not affect one row".to_owned(),
                ))
            }
            Err(error) => return Err(error.into()),
        }
        bump_project_revision(&transaction, params.expected_revision, &saved_by, &now)?;
        transaction.commit()?;
    }
    mutation_result(
        connection,
        &params.file_path,
        &before.project_id,
        &preset_id,
        false,
    )
}

pub fn delete_export_preset(params: DeleteExportPresetParams) -> Result<DeleteExportPresetResult> {
    validate_identifier("preset_id", &params.preset_id)?;
    validate_revision(params.expected_revision, "expected_revision")?;
    validate_revision(params.expected_preset_revision, "expected_preset_revision")?;
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let before = load_app_meta(&connection)?;
    ensure_metadata_revision(before.revision, params.expected_revision)?;
    let current = load_project_export_preset(&connection, &before.project_id, &params.preset_id)?;
    ensure_preset_revision(current.revision, params.expected_preset_revision)?;
    let now = database_timestamp(&connection)?;
    {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_project_revision(&transaction, params.expected_revision)?;
        let changed = transaction.execute(
            "DELETE FROM export_presets
             WHERE id = ?1 AND project_id = ?2 AND kind = ?3 AND revision = ?4",
            params![
                params.preset_id,
                before.project_id,
                current.kind.as_str(),
                params.expected_preset_revision,
            ],
        )?;
        if changed != 1 {
            return Err(CoreError::ExportPresetRevisionConflict {
                expected: params.expected_preset_revision,
                actual: current.revision,
            });
        }
        bump_project_revision(&transaction, params.expected_revision, &saved_by, &now)?;
        transaction.commit()?;
    }
    let metadata = load_app_meta(&connection)?;
    let revision = metadata.revision;
    connection.close().map_err(|(_, error)| error)?;
    sync_file(&params.file_path)?;
    Ok(DeleteExportPresetResult {
        metadata,
        deleted_preset_id: params.preset_id,
        revision,
    })
}

fn mutation_result(
    connection: Connection,
    file_path: &std::path::Path,
    project_id: &str,
    preset_id: &str,
    no_op: bool,
) -> Result<ExportPresetMutationResult> {
    let preset = load_project_export_preset(&connection, project_id, preset_id)?;
    let metadata = load_app_meta(&connection)?;
    let revision = metadata.revision;
    connection.close().map_err(|(_, error)| error)?;
    sync_file(file_path)?;
    Ok(ExportPresetMutationResult {
        metadata,
        preset,
        no_op,
        revision,
    })
}

pub(crate) fn load_publication_metadata(
    connection: &Connection,
    project_id: &str,
) -> Result<PublicationMetadataRecord> {
    ensure_no_foreign_publication_rows(connection, project_id, "publication_metadata")?;
    let record = connection
        .query_row(
            "SELECT project_id, publication_title, creator_name, language, identifier,
                    publisher, description, rights, subjects_json, cover_asset_id,
                    created_at, updated_at
             FROM publication_metadata WHERE project_id = ?1",
            [project_id],
            |row| {
                let subjects_json: String = row.get(8)?;
                let subjects =
                    serde_json::from_str::<Vec<String>>(&subjects_json).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            8,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?;
                Ok(PublicationMetadataRecord {
                    project_id: row.get(0)?,
                    publication_title: row.get(1)?,
                    creator_name: row.get(2)?,
                    language: row.get(3)?,
                    identifier: row.get(4)?,
                    publisher: row.get(5)?,
                    description: row.get(6)?,
                    rights: row.get(7)?,
                    subjects,
                    cover_asset_id: row.get(9)?,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| CoreError::Integrity("publication metadata row is missing".to_owned()))?;
    validate_loaded_publication_metadata(record)
}

pub(crate) fn load_project_cover(
    connection: &Connection,
    project_id: &str,
) -> Result<Option<PublicationAssetRecord>> {
    ensure_no_foreign_publication_rows(connection, project_id, "publication_assets")?;
    let record = connection
        .query_row(
            "SELECT id, project_id, kind, media_type, original_name, sha256, bytes,
                    width, height, created_at, updated_at
             FROM publication_assets
             WHERE project_id = ?1 AND kind = 'COVER'",
            [project_id],
            publication_asset_row,
        )
        .optional()?;
    record.map(validate_loaded_publication_asset).transpose()
}

pub(crate) fn load_project_export_presets(
    connection: &Connection,
    project_id: &str,
) -> Result<Vec<ExportPresetRecord>> {
    ensure_no_foreign_publication_rows(connection, project_id, "export_presets")?;
    let mut statement = connection.prepare(
        "SELECT id, project_id, kind, name, preset_format, preset_version,
                preset_json, content_hash, revision, created_at, updated_at
         FROM export_presets WHERE project_id = ?1
         ORDER BY kind, name COLLATE NOCASE, id",
    )?;
    let rows = statement.query_map([project_id], export_preset_row)?;
    rows.collect::<std::result::Result<Vec<_>, _>>()?
        .into_iter()
        .map(validate_loaded_export_preset)
        .collect()
}

fn load_project_export_preset(
    connection: &Connection,
    project_id: &str,
    preset_id: &str,
) -> Result<ExportPresetRecord> {
    ensure_no_foreign_publication_rows(connection, project_id, "export_presets")?;
    let preset = connection
        .query_row(
            "SELECT id, project_id, kind, name, preset_format, preset_version,
                    preset_json, content_hash, revision, created_at, updated_at
             FROM export_presets
             WHERE id = ?1 AND project_id = ?2",
            params![preset_id, project_id],
            export_preset_row,
        )
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("export preset id {preset_id}")))?;
    validate_loaded_export_preset(preset)
}

fn ensure_no_foreign_publication_rows(
    connection: &Connection,
    project_id: &str,
    table: &'static str,
) -> Result<()> {
    let statement = match table {
        "publication_metadata" => {
            "SELECT count(*) FROM publication_metadata WHERE project_id <> ?1"
        }
        "publication_assets" => "SELECT count(*) FROM publication_assets WHERE project_id <> ?1",
        "export_presets" => "SELECT count(*) FROM export_presets WHERE project_id <> ?1",
        _ => {
            return Err(CoreError::Integrity(
                "publication ownership check requested an unknown table".to_owned(),
            ))
        }
    };
    let foreign_count: i64 = connection.query_row(statement, [project_id], |row| row.get(0))?;
    if foreign_count != 0 {
        return Err(CoreError::Integrity(format!(
            "{table} contains records owned by a foreign project"
        )));
    }
    Ok(())
}

fn publication_asset_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PublicationAssetRecord> {
    let kind: String = row.get(2)?;
    let kind = PublicationAssetKind::parse(&kind).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let bytes: Vec<u8> = row.get(6)?;
    let width: Option<i64> = row.get(7)?;
    let height: Option<i64> = row.get(8)?;
    Ok(PublicationAssetRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        kind,
        media_type: row.get(3)?,
        original_name: row.get(4)?,
        sha256: row.get(5)?,
        bytes_base64: BASE64_STANDARD.encode(&bytes),
        byte_length: bytes.len() as u64,
        width: u32::try_from(width.unwrap_or_default()).unwrap_or_default(),
        height: u32::try_from(height.unwrap_or_default()).unwrap_or_default(),
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn export_preset_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ExportPresetRecord> {
    let kind_text: String = row.get(2)?;
    let kind = ExportPresetKind::parse(&kind_text).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let preset_json: String = row.get(6)?;
    let config = match kind {
        ExportPresetKind::Epub => serde_json::from_str::<EpubExportPresetConfig>(&preset_json)
            .map(ExportPresetConfig::Epub),
        ExportPresetKind::Hwpx => serde_json::from_str::<HwpxExportPresetConfig>(&preset_json)
            .map(ExportPresetConfig::Hwpx),
    }
    .map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(ExportPresetRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        kind,
        name: row.get(3)?,
        preset_format: row.get(4)?,
        preset_version: row.get(5)?,
        preset_json: config,
        content_hash: row.get(7)?,
        revision: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

pub(crate) fn validate_loaded_publication_metadata(
    record: PublicationMetadataRecord,
) -> Result<PublicationMetadataRecord> {
    validate_identifier("publication metadata project_id", &record.project_id)?;
    validate_publication_metadata_values(&record)?;
    Ok(record)
}

pub(crate) fn validate_loaded_publication_asset(
    record: PublicationAssetRecord,
) -> Result<PublicationAssetRecord> {
    validate_identifier("publication asset id", &record.id)?;
    validate_identifier("publication asset project_id", &record.project_id)?;
    if record.kind != PublicationAssetKind::Cover {
        return Err(CoreError::Integrity(
            "only COVER publication assets are supported".to_owned(),
        ));
    }
    validate_original_name(&record.original_name, &record.media_type)?;
    let bytes = BASE64_STANDARD
        .decode(record.bytes_base64.as_bytes())
        .map_err(|_| CoreError::Integrity("publication asset bytes are not base64".to_owned()))?;
    let dimensions = validate_cover_bytes(&record.media_type, &bytes)
        .map_err(|error| CoreError::Integrity(error.to_string()))?;
    let expected_hash = format!("{:x}", Sha256::digest(&bytes));
    if record.sha256 != expected_hash
        || record.byte_length != bytes.len() as u64
        || dimensions != (record.width, record.height)
    {
        return Err(CoreError::Integrity(
            "publication asset hash, size, or dimensions are invalid".to_owned(),
        ));
    }
    Ok(record)
}

pub(crate) fn validate_loaded_export_preset(
    record: ExportPresetRecord,
) -> Result<ExportPresetRecord> {
    validate_identifier("export preset id", &record.id)?;
    validate_identifier("export preset project_id", &record.project_id)?;
    validate_name(&record.name)?;
    validate_revision(record.revision, "export preset revision")?;
    if record.preset_format != EXPORT_PRESET_FORMAT
        || record.preset_version != EXPORT_PRESET_VERSION
    {
        return Err(CoreError::Integrity(
            "export preset envelope is invalid".to_owned(),
        ));
    }
    ensure_preset_kind_matches_config(record.kind, &record.preset_json)?;
    let (_, expected_hash) = canonical_export_preset(record.kind, &record.preset_json)?;
    if record.content_hash != expected_hash {
        return Err(CoreError::Integrity(
            "export preset canonical content hash is invalid".to_owned(),
        ));
    }
    Ok(record)
}

pub(crate) fn canonical_export_preset(
    kind: ExportPresetKind,
    config: &ExportPresetConfig,
) -> Result<(String, String)> {
    ensure_preset_kind_matches_config(kind, config)?;
    validate_export_preset(config)?;
    let value = canonical_value(serde_json::to_value(config)?);
    let json = serde_json::to_string(&value)?;
    let hash = format!("{:x}", Sha256::digest(json.as_bytes()));
    Ok((json, hash))
}

pub fn validate_export_preset(config: &ExportPresetConfig) -> Result<()> {
    match config {
        ExportPresetConfig::Epub(config) => validate_epub_export_preset(config),
        ExportPresetConfig::Hwpx(config) => validate_hwpx_export_preset(config),
    }
}

fn ensure_preset_kind_matches_config(
    kind: ExportPresetKind,
    config: &ExportPresetConfig,
) -> Result<()> {
    if kind != config.kind() {
        return Err(CoreError::InvalidInput(
            "export preset kind does not match preset_json".to_owned(),
        ));
    }
    Ok(())
}

fn validate_epub_export_preset(config: &EpubExportPresetConfig) -> Result<()> {
    if config.format_version != EXPORT_PRESET_VERSION {
        return invalid("unsupported EPUB export preset format version");
    }
    if !(1..=4).contains(&config.toc_depth) {
        return invalid("tocDepth must be between 1 and 4");
    }
    Ok(())
}

fn validate_hwpx_export_preset(config: &HwpxExportPresetConfig) -> Result<()> {
    if config.format_version != EXPORT_PRESET_VERSION {
        return invalid("unsupported HWPX export preset format version");
    }
    match config.page_size_token {
        HwpxPageSizeToken::Custom => {
            validate_number_range("customPageWidth", config.custom_page_width, 50.0, 500.0)?;
            validate_number_range("customPageHeight", config.custom_page_height, 50.0, 500.0)?;
        }
        HwpxPageSizeToken::A4 | HwpxPageSizeToken::Letter => {
            if config.custom_page_width.is_some() || config.custom_page_height.is_some() {
                return invalid("custom page dimensions are only valid for CUSTOM page size");
            }
        }
    }
    for (name, value) in [
        ("marginTop", config.margin_top),
        ("marginBottom", config.margin_bottom),
        ("marginLeft", config.margin_left),
        ("marginRight", config.margin_right),
        ("headerMargin", config.header_margin),
        ("footerMargin", config.footer_margin),
        ("gutter", config.gutter),
    ] {
        validate_number_range(name, Some(value), 0.0, 100.0)?;
    }
    validate_font_family_token("fontFamilyToken", &config.font_family_token)?;
    validate_number_range("fontSizePt", Some(config.font_size_pt), 6.0, 72.0)?;
    match config.line_spacing_mode {
        HwpxLineSpacingMode::Percent => validate_number_range(
            "lineSpacingValue",
            Some(config.line_spacing_value),
            50.0,
            400.0,
        )?,
        HwpxLineSpacingMode::FixedPt => validate_number_range(
            "lineSpacingValue",
            Some(config.line_spacing_value),
            6.0,
            200.0,
        )?,
    }
    validate_number_range(
        "firstLineIndent",
        Some(config.first_line_indent),
        -100.0,
        100.0,
    )?;
    validate_number_range(
        "paragraphSpacingBefore",
        Some(config.paragraph_spacing_before),
        0.0,
        100.0,
    )?;
    validate_number_range(
        "paragraphSpacingAfter",
        Some(config.paragraph_spacing_after),
        0.0,
        100.0,
    )?;
    for (name, heading) in [
        ("workTitleStyle", &config.work_title_style),
        ("volumeTitleStyle", &config.volume_title_style),
        ("chapterTitleStyle", &config.chapter_title_style),
        ("sceneTitleStyle", &config.scene_title_style),
    ] {
        validate_heading_style(name, heading)?;
    }
    if !(1..=1_000_000).contains(&config.page_number_start) {
        return invalid("pageNumberStart must be between 1 and 1000000");
    }
    validate_bounded_xml_text("headerText", &config.header_text, 1_000)?;
    validate_bounded_xml_text("footerText", &config.footer_text, 1_000)?;
    if !config.include_header && !config.header_text.is_empty() {
        return invalid("headerText must be empty when includeHeader is false");
    }
    if !config.include_footer && !config.footer_text.is_empty() {
        return invalid("footerText must be empty when includeFooter is false");
    }
    Ok(())
}

fn validate_heading_style(name: &str, style: &HwpxHeadingStyleConfig) -> Result<()> {
    validate_font_family_token(&format!("{name}.fontFamilyToken"), &style.font_family_token)?;
    validate_number_range(
        &format!("{name}.fontSizePt"),
        Some(style.font_size_pt),
        6.0,
        72.0,
    )?;
    validate_number_range(
        &format!("{name}.spacingBefore"),
        Some(style.spacing_before),
        0.0,
        100.0,
    )?;
    validate_number_range(
        &format!("{name}.spacingAfter"),
        Some(style.spacing_after),
        0.0,
        100.0,
    )?;
    Ok(())
}

fn validate_number_range(name: &str, value: Option<f64>, minimum: f64, maximum: f64) -> Result<()> {
    let Some(value) = value else {
        return invalid(&format!("{name} is required"));
    };
    if !value.is_finite() || value < minimum || value > maximum {
        return invalid(&format!(
            "{name} must be a finite number between {minimum} and {maximum}"
        ));
    }
    Ok(())
}

fn validate_font_family_token(name: &str, value: &str) -> Result<()> {
    let length = value.chars().count();
    if length == 0 || length > 128 || value.trim() != value {
        return invalid(&format!("{name} must contain 1 to 128 trimmed characters"));
    }
    if value.chars().any(|character| {
        character.is_control() || matches!(character, '<' | '>' | '&' | '\"' | '\'')
    }) {
        return invalid(&format!("{name} contains unsafe characters"));
    }
    Ok(())
}

fn validate_bounded_xml_text(name: &str, value: &str, maximum: usize) -> Result<()> {
    if value.chars().count() > maximum {
        return invalid(&format!("{name} exceeds {maximum} characters"));
    }
    if value.chars().any(is_invalid_xml_character) {
        return invalid(&format!("{name} contains an invalid XML character"));
    }
    Ok(())
}

fn is_invalid_xml_character(character: char) -> bool {
    !matches!(
        character as u32,
        0x9 | 0xA | 0xD | 0x20..=0xD7FF | 0xE000..=0xFFFD | 0x10000..=0x10FFFF
    )
}

pub fn validate_cover_bytes(media_type: &str, bytes: &[u8]) -> Result<(u32, u32)> {
    if bytes.is_empty() || bytes.len() > MAX_COVER_BYTES {
        return invalid(&format!(
            "cover bytes must be between 1 and {MAX_COVER_BYTES} bytes"
        ));
    }
    let dimensions = match media_type {
        "image/png" => validate_png(bytes)?,
        "image/jpeg" => validate_jpeg(bytes)?,
        _ => return invalid("cover media_type must be image/png or image/jpeg"),
    };
    validate_dimensions(dimensions.0, dimensions.1)?;
    validate_decodable_image(media_type, bytes, dimensions)?;
    Ok(dimensions)
}

fn validate_decodable_image(
    media_type: &str,
    bytes: &[u8],
    expected_dimensions: (u32, u32),
) -> Result<()> {
    let format = match media_type {
        "image/png" => ImageFormat::Png,
        "image/jpeg" => ImageFormat::Jpeg,
        _ => return invalid("cover media_type is unsupported"),
    };
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_COVER_DIMENSION);
    limits.max_image_height = Some(MAX_COVER_DIMENSION);
    limits.max_alloc = Some(256 * 1024 * 1024);
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(limits);
    let decoded = reader
        .decode()
        .map_err(|_| CoreError::InvalidInput("cover image payload is malformed".to_owned()))?;
    if (decoded.width(), decoded.height()) != expected_dimensions {
        return invalid("cover decoder dimensions do not match the image header");
    }
    Ok(())
}

fn validate_png(bytes: &[u8]) -> Result<(u32, u32)> {
    const SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if bytes.len() < 45 || bytes.get(..8) != Some(SIGNATURE) {
        return invalid("cover media_type image/png does not match PNG magic bytes");
    }
    let mut cursor = 8_usize;
    let mut dimensions = None;
    let mut requires_palette = false;
    let mut saw_palette = false;
    let mut saw_idat = false;
    let mut saw_iend = false;
    let mut compressed_image_data = Vec::new();
    while cursor < bytes.len() {
        if bytes.len() - cursor < 12 {
            return invalid("PNG contains a truncated chunk");
        }
        let length =
            u32::from_be_bytes(bytes[cursor..cursor + 4].try_into().expect("length")) as usize;
        let chunk_end = cursor
            .checked_add(12)
            .and_then(|value| value.checked_add(length))
            .filter(|value| *value <= bytes.len())
            .ok_or_else(|| CoreError::InvalidInput("PNG chunk length is invalid".to_owned()))?;
        let kind = &bytes[cursor + 4..cursor + 8];
        if !kind.iter().all(u8::is_ascii_alphabetic) {
            return invalid("PNG chunk type is invalid");
        }
        let data = &bytes[cursor + 8..cursor + 8 + length];
        let expected_crc = u32::from_be_bytes(
            bytes[cursor + 8 + length..chunk_end]
                .try_into()
                .expect("CRC length"),
        );
        let actual_crc = crc32(&bytes[cursor + 4..cursor + 8 + length]);
        if expected_crc != actual_crc {
            return invalid("PNG chunk CRC is invalid");
        }
        match kind {
            b"IHDR" => {
                if cursor != 8 || dimensions.is_some() || length != 13 {
                    return invalid("PNG IHDR is missing or malformed");
                }
                let width = u32::from_be_bytes(data[0..4].try_into().expect("width"));
                let height = u32::from_be_bytes(data[4..8].try_into().expect("height"));
                let bit_depth = data[8];
                let color_type = data[9];
                requires_palette = color_type == 3;
                let valid_depth = match color_type {
                    0 => matches!(bit_depth, 1 | 2 | 4 | 8 | 16),
                    2 => matches!(bit_depth, 8 | 16),
                    3 => matches!(bit_depth, 1 | 2 | 4 | 8),
                    4 | 6 => matches!(bit_depth, 8 | 16),
                    _ => false,
                };
                if !valid_depth || data[10] != 0 || data[11] != 0 || data[12] > 1 {
                    return invalid("PNG IHDR encoding parameters are unsupported");
                }
                dimensions = Some((width, height));
            }
            b"PLTE" => {
                if dimensions.is_none()
                    || saw_palette
                    || saw_idat
                    || length == 0
                    || length > 768
                    || length % 3 != 0
                {
                    return invalid("PNG PLTE is malformed or misplaced");
                }
                saw_palette = true;
            }
            b"IDAT" => {
                if dimensions.is_none()
                    || (requires_palette && !saw_palette)
                    || length == 0
                    || saw_iend
                {
                    return invalid("PNG IDAT placement is invalid");
                }
                saw_idat = true;
                compressed_image_data.extend_from_slice(data);
            }
            b"IEND" => {
                if length != 0 || !saw_idat || saw_iend || chunk_end != bytes.len() {
                    return invalid("PNG IEND is malformed or has trailing polyglot bytes");
                }
                saw_iend = true;
            }
            _ if kind[0].is_ascii_uppercase() => {
                return invalid("PNG contains an unsupported critical chunk");
            }
            _ => {}
        }
        cursor = chunk_end;
    }
    if !saw_iend {
        return invalid("PNG is missing its exact terminal IEND chunk");
    }
    if compressed_image_data.len() < 6 {
        return invalid("PNG compressed image payload is truncated");
    }
    let compression_method = compressed_image_data[0] & 0x0f;
    let window_size = compressed_image_data[0] >> 4;
    let zlib_header = u16::from_be_bytes([compressed_image_data[0], compressed_image_data[1]]);
    if compression_method != 8
        || window_size > 7
        || zlib_header % 31 != 0
        || compressed_image_data[1] & 0x20 != 0
    {
        return invalid("PNG IDAT does not contain a safe zlib stream header");
    }
    dimensions.ok_or_else(|| CoreError::InvalidInput("PNG is missing IHDR".to_owned()))
}

fn validate_jpeg(bytes: &[u8]) -> Result<(u32, u32)> {
    if bytes.len() < 14 || !bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return invalid("cover media_type image/jpeg does not match JPEG magic bytes");
    }
    let mut cursor = 2_usize;
    let mut dimensions = None;
    let mut saw_scan = false;
    let mut saw_entropy_data = false;
    while cursor < bytes.len() {
        if bytes[cursor] != 0xff {
            if saw_scan {
                saw_entropy_data = true;
                cursor += 1;
                continue;
            }
            return invalid("JPEG marker framing is invalid");
        }
        while cursor < bytes.len() && bytes[cursor] == 0xff {
            cursor += 1;
        }
        if cursor >= bytes.len() {
            return invalid("JPEG marker is truncated");
        }
        let marker = bytes[cursor];
        cursor += 1;
        if saw_scan && marker == 0x00 {
            saw_entropy_data = true;
            continue;
        }
        if (0xd0..=0xd7).contains(&marker) {
            if !saw_scan {
                return invalid("JPEG restart marker occurs outside scan data");
            }
            continue;
        }
        if marker == 0xd9 {
            if !saw_scan || !saw_entropy_data || dimensions.is_none() || cursor != bytes.len() {
                return invalid("JPEG EOI is missing, premature, or followed by polyglot bytes");
            }
            return Ok(dimensions.expect("checked"));
        }
        if matches!(marker, 0x01 | 0xd8) {
            return invalid("JPEG contains an invalid standalone marker");
        }
        if bytes.len() - cursor < 2 {
            return invalid("JPEG segment length is truncated");
        }
        let segment_length = u16::from_be_bytes(
            bytes[cursor..cursor + 2]
                .try_into()
                .expect("segment length"),
        ) as usize;
        if segment_length < 2 || cursor + segment_length > bytes.len() {
            return invalid("JPEG segment length is invalid");
        }
        let data = &bytes[cursor + 2..cursor + segment_length];
        if is_sof_marker(marker) {
            let component_count = data.get(5).copied().unwrap_or_default() as usize;
            if data
                .first()
                .is_none_or(|precision| !matches!(precision, 8 | 12))
                || component_count == 0
                || component_count > 4
                || data.len() != 6 + component_count * 3
                || dimensions.is_some()
            {
                return invalid("JPEG frame header is malformed or duplicated");
            }
            let height = u16::from_be_bytes(data[1..3].try_into().expect("height")) as u32;
            let width = u16::from_be_bytes(data[3..5].try_into().expect("width")) as u32;
            dimensions = Some((width, height));
        }
        if marker == 0xda {
            let component_count = data.first().copied().unwrap_or_default() as usize;
            if dimensions.is_none()
                || component_count == 0
                || component_count > 4
                || data.len() != 4 + component_count * 2
            {
                return invalid("JPEG scan header is malformed");
            }
            saw_scan = true;
        }
        cursor += segment_length;
    }
    invalid("JPEG is missing its exact terminal EOI marker")
}

fn is_sof_marker(marker: u8) -> bool {
    matches!(
        marker,
        0xc0 | 0xc1 | 0xc2 | 0xc3 | 0xc5 | 0xc6 | 0xc7 | 0xc9 | 0xca | 0xcb | 0xcd | 0xce | 0xcf
    )
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffff_u32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            let mask = 0_u32.wrapping_sub(crc & 1);
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}

fn validate_dimensions(width: u32, height: u32) -> Result<()> {
    if width == 0
        || height == 0
        || width > MAX_COVER_DIMENSION
        || height > MAX_COVER_DIMENSION
        || u64::from(width) * u64::from(height) > MAX_COVER_PIXELS
    {
        return invalid("cover dimensions exceed the supported safe bounds");
    }
    Ok(())
}

fn validate_publication_metadata_values(record: &PublicationMetadataRecord) -> Result<()> {
    validate_bounded_text(
        "publication_title",
        &record.publication_title,
        MAX_TITLE_CHARS,
    )?;
    validate_optional_bounded_text("creator_name", &record.creator_name, MAX_CREATOR_CHARS)?;
    validate_language(&record.language)?;
    validate_identifier_value(&record.identifier)?;
    for (field, value, maximum) in [
        (
            "publisher",
            record.publisher.as_deref(),
            MAX_PUBLISHER_CHARS,
        ),
        (
            "description",
            record.description.as_deref(),
            MAX_DESCRIPTION_CHARS,
        ),
        ("rights", record.rights.as_deref(), MAX_RIGHTS_CHARS),
    ] {
        if let Some(value) = value {
            validate_bounded_text(field, value, maximum)?;
        }
    }
    canonical_subjects_json(&record.subjects)?;
    if let Some(asset_id) = record.cover_asset_id.as_deref() {
        validate_identifier("cover_asset_id", asset_id)?;
    }
    Ok(())
}

fn validate_language(value: &str) -> Result<()> {
    if value.len() > 64
        || value.starts_with('-')
        || value.ends_with('-')
        || value.split('-').any(|part| {
            part.is_empty()
                || part.len() > 8
                || !part.bytes().all(|byte| byte.is_ascii_alphanumeric())
        })
        || value.split('-').next().is_none_or(|part| {
            part.len() < 2 || !part.bytes().all(|byte| byte.is_ascii_alphabetic())
        })
    {
        return invalid("language must be a bounded BCP 47-style language tag");
    }
    Ok(())
}

fn validate_identifier_value(value: &str) -> Result<()> {
    validate_bounded_text("identifier", value, MAX_IDENTIFIER_CHARS)
}

fn validate_original_name(value: &str, media_type: &str) -> Result<()> {
    validate_bounded_text("original_name", value, MAX_ORIGINAL_NAME_CHARS)?;
    if matches!(value, "." | "..")
        || value.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
        })
    {
        return invalid("original_name must be a filename without a path or reserved characters");
    }
    let lowercase = value.to_ascii_lowercase();
    let extension_matches = match media_type {
        "image/png" => lowercase.ends_with(".png"),
        "image/jpeg" => lowercase.ends_with(".jpg") || lowercase.ends_with(".jpeg"),
        _ => false,
    };
    if !extension_matches {
        return invalid("original_name extension must match cover media_type");
    }
    Ok(())
}

fn canonical_subjects_json(subjects: &[String]) -> Result<String> {
    if subjects.len() > MAX_SUBJECTS {
        return invalid(&format!("subjects exceeds {MAX_SUBJECTS} items"));
    }
    let mut seen = HashSet::new();
    for subject in subjects {
        validate_bounded_text("subject", subject, MAX_SUBJECT_CHARS)?;
        if !seen.insert(subject.as_str()) {
            return invalid("subjects contains a duplicate value");
        }
    }
    Ok(serde_json::to_string(subjects)?)
}

fn publication_metadata_values_equal(
    current: &PublicationMetadataRecord,
    candidate: &PublicationMetadataRecord,
) -> bool {
    current.publication_title == candidate.publication_title
        && current.creator_name == candidate.creator_name
        && current.language == candidate.language
        && current.identifier == candidate.identifier
        && current.publisher == candidate.publisher
        && current.description == candidate.description
        && current.rights == candidate.rights
        && current.subjects == candidate.subjects
        && current.cover_asset_id == candidate.cover_asset_id
}

fn ensure_cover_reference(
    publication_metadata: &PublicationMetadataRecord,
    cover_asset: Option<&PublicationAssetRecord>,
) -> Result<()> {
    match (
        publication_metadata.cover_asset_id.as_deref(),
        cover_asset.map(|asset| asset.id.as_str()),
    ) {
        (None, None) => Ok(()),
        (Some(expected), Some(actual)) if expected == actual => Ok(()),
        _ => Err(CoreError::Integrity(
            "publication metadata and project cover reference disagree".to_owned(),
        )),
    }
}

fn normalized_optional(value: Option<String>) -> Option<String> {
    value.and_then(|value| (!value.trim().is_empty()).then_some(value))
}

fn ensure_project_cover_id(
    connection: &Connection,
    project_id: &str,
    asset_id: &str,
) -> Result<()> {
    let exists = connection.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM publication_assets
            WHERE id = ?1 AND project_id = ?2 AND kind = 'COVER'
         )",
        params![asset_id, project_id],
        |row| row.get::<_, bool>(0),
    )?;
    if !exists {
        return Err(CoreError::NotFound(format!(
            "publication cover asset id {asset_id}"
        )));
    }
    Ok(())
}

fn ensure_project_revision(transaction: &Transaction<'_>, expected: i64) -> Result<()> {
    let actual: i64 = transaction.query_row(
        "SELECT revision FROM app_meta WHERE singleton = 1",
        [],
        |row| row.get(0),
    )?;
    ensure_metadata_revision(actual, expected)
}

fn ensure_metadata_revision(actual: i64, expected: i64) -> Result<()> {
    if actual != expected {
        return Err(CoreError::RevisionConflict { expected, actual });
    }
    Ok(())
}

fn ensure_preset_revision(actual: i64, expected: i64) -> Result<()> {
    if actual != expected {
        return Err(CoreError::ExportPresetRevisionConflict { expected, actual });
    }
    Ok(())
}

fn bump_project_revision(
    transaction: &Transaction<'_>,
    expected: i64,
    saved_by: &str,
    now: &str,
) -> Result<()> {
    let changed = transaction.execute(
        "UPDATE app_meta
         SET revision = revision + 1, updated_at = ?1, last_saved_by = ?2
         WHERE singleton = 1 AND revision = ?3",
        params![now, saved_by, expected],
    )?;
    if changed != 1 {
        ensure_project_revision(transaction, expected)?;
        return Err(CoreError::Integrity(
            "project revision update did not affect one row".to_owned(),
        ));
    }
    transaction.execute(
        "UPDATE projects SET updated_at = ?1
         WHERE id = (SELECT project_id FROM app_meta WHERE singleton = 1)",
        [now],
    )?;
    Ok(())
}

fn validated_saved_by(value: Option<&str>) -> Result<String> {
    let value = value
        .map(ToOwned::to_owned)
        .unwrap_or_else(default_client_identifier);
    validate_bounded_text("saved_by", &value, MAX_ID_CHARS)?;
    Ok(value)
}

fn validate_identifier(field: &str, value: &str) -> Result<()> {
    validate_bounded_text(field, value, MAX_ID_CHARS)
}

fn validate_name(value: &str) -> Result<()> {
    validate_bounded_text("export preset name", value, MAX_PRESET_NAME_CHARS)
}

fn validate_bounded_text(field: &str, value: &str, max_chars: usize) -> Result<()> {
    validate_non_empty(field, value)?;
    if value.encode_utf16().count() > max_chars || value.chars().any(is_unsafe_text_control) {
        return invalid(&format!("{field} exceeds its safe text bounds"));
    }
    Ok(())
}

fn validate_optional_bounded_text(field: &str, value: &str, max_chars: usize) -> Result<()> {
    if value.encode_utf16().count() > max_chars || value.chars().any(is_unsafe_text_control) {
        return invalid(&format!("{field} exceeds its safe text bounds"));
    }
    Ok(())
}

fn is_unsafe_text_control(character: char) -> bool {
    matches!(
        character,
        '\u{0000}'..='\u{0008}' | '\u{000b}' | '\u{000c}' | '\u{000e}'..='\u{001f}' | '\u{007f}'
    )
}

fn validate_revision(value: i64, field: &str) -> Result<()> {
    if value < 0 {
        return invalid(&format!("{field} must be non-negative"));
    }
    Ok(())
}

fn duplicate_names(presets: &[ExportPresetRecord]) -> Vec<String> {
    let mut counts = BTreeMap::new();
    for preset in presets {
        *counts.entry(preset.name.clone()).or_insert(0_usize) += 1;
    }
    counts
        .into_iter()
        .filter_map(|(name, count)| (count > 1).then_some(name))
        .collect()
}

fn canonical_value(value: Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.into_iter().map(canonical_value).collect()),
        Value::Object(values) => {
            let values: BTreeMap<_, _> = values
                .into_iter()
                .map(|(key, value)| (key, canonical_value(value)))
                .collect();
            Value::Object(values.into_iter().collect())
        }
        scalar => scalar,
    }
}

fn is_unique_constraint(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(code, _)
            if code.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_PRIMARYKEY
                || code.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE
    )
}

fn invalid<T>(message: &str) -> Result<T> {
    Err(CoreError::InvalidInput(message.to_owned()))
}
