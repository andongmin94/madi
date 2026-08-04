use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;

use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::{CoreError, Result};
use crate::model::AppMeta;
use crate::storage::{
    database_timestamp, default_client_identifier, load_app_meta, open_existing, sync_file,
    validate_non_empty,
};

pub const READER_PRESET_FORMAT: &str = "MADI_READER_PRESET";
pub const READER_PRESET_VERSION: i64 = 1;

const MAX_ID_CHARS: usize = 256;
const MAX_NAME_CHARS: usize = 500;
const MAX_SOURCE_VERSION_CHARS: usize = 128;
const MAX_SUPPORTED_CONTROLS: usize = 4;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReaderPresetSourceKind {
    BuiltinTemplate,
    Custom,
    Duplicated,
    Imported,
}

impl ReaderPresetSourceKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::BuiltinTemplate => "BUILTIN_TEMPLATE",
            Self::Custom => "CUSTOM",
            Self::Duplicated => "DUPLICATED",
            Self::Imported => "IMPORTED",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "BUILTIN_TEMPLATE" => Ok(Self::BuiltinTemplate),
            "CUSTOM" => Ok(Self::Custom),
            "DUPLICATED" => Ok(Self::Duplicated),
            "IMPORTED" => Ok(Self::Imported),
            _ => Err(CoreError::Integrity(
                "reader preset source kind is invalid".to_owned(),
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReaderVerificationStatus {
    Generic,
    UnverifiedSimulation,
    UserDefined,
}

impl ReaderVerificationStatus {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Generic => "GENERIC",
            Self::UnverifiedSimulation => "UNVERIFIED_SIMULATION",
            Self::UserDefined => "USER_DEFINED",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "GENERIC" => Ok(Self::Generic),
            "UNVERIFIED_SIMULATION" => Ok(Self::UnverifiedSimulation),
            "USER_DEFINED" => Ok(Self::UserDefined),
            _ => Err(CoreError::Integrity(
                "reader preset verification status is invalid".to_owned(),
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PlatformFamily {
    Generic,
    PlatformLike,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReaderSupportedControl {
    Typography,
    Spacing,
    Viewport,
    Theme,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlatformProfile {
    pub id: String,
    pub name: String,
    pub version: i64,
    pub family: PlatformFamily,
    pub verification_status: ReaderVerificationStatus,
    pub verified_at: Option<String>,
    pub supported_controls: Vec<ReaderSupportedControl>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReaderDeviceCategory {
    Phone,
    Tablet,
    Desktop,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceProfile {
    pub id: String,
    pub name: String,
    pub category: ReaderDeviceCategory,
    pub viewport_width: f64,
    pub viewport_height: f64,
    pub safe_area_top: f64,
    pub safe_area_bottom: f64,
    pub reader_chrome_height: f64,
    pub pixel_ratio: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReaderFontToken {
    SystemSans,
    SystemSerif,
    KoreanSans,
    KoreanSerif,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReaderTextAlign {
    Left,
    Justify,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReaderTheme {
    Light,
    Sepia,
    Dark,
    Custom,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReaderScrollMode {
    Continuous,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReaderSettings {
    pub font_family_token: ReaderFontToken,
    pub font_size: f64,
    pub line_height: f64,
    pub paragraph_spacing: f64,
    pub first_line_indent: f64,
    pub horizontal_padding: f64,
    pub vertical_padding: f64,
    pub text_align: ReaderTextAlign,
    pub theme: ReaderTheme,
    pub background_color: String,
    pub text_color: String,
    pub scroll_mode: ReaderScrollMode,
    pub show_chapter_title: bool,
    pub show_scene_title: bool,
    pub show_scene_break: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BodyStyleToken {
    Prose,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ChapterTitleStyleToken {
    ChapterDefault,
    ChapterCompact,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SceneTitleStyleToken {
    SceneDefault,
    SceneHidden,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SceneBreakStyleToken {
    Diamonds,
    Rule,
    Space,
    Hidden,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkStyle {
    pub body_style_token: BodyStyleToken,
    pub chapter_title_style_token: ChapterTitleStyleToken,
    pub scene_title_style_token: SceneTitleStyleToken,
    pub scene_break_style_token: SceneBreakStyleToken,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReaderRenderConfig {
    pub format_version: i64,
    pub platform: PlatformProfile,
    pub device: DeviceProfile,
    pub settings: ReaderSettings,
    pub work_style: WorkStyle,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReaderPresetRecord {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub source_kind: ReaderPresetSourceKind,
    pub source_id: Option<String>,
    pub source_version: Option<String>,
    pub verification_status: ReaderVerificationStatus,
    pub preset_format: String,
    pub preset_version: i64,
    pub preset_json: ReaderRenderConfig,
    pub content_hash: String,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ListReaderPresetsParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ListReaderPresetsResult {
    pub metadata: AppMeta,
    pub presets: Vec<ReaderPresetRecord>,
    pub duplicate_names: Vec<String>,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CreateReaderPresetParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    #[serde(default)]
    pub preset_id: Option<String>,
    pub name: String,
    pub source_kind: ReaderPresetSourceKind,
    #[serde(default)]
    pub source_id: Option<String>,
    #[serde(default)]
    pub source_version: Option<String>,
    pub verification_status: ReaderVerificationStatus,
    pub preset_format: String,
    pub preset_version: i64,
    pub preset_json: ReaderRenderConfig,
    pub expected_revision: i64,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UpdateReaderPresetParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub preset_id: String,
    pub name: String,
    pub verification_status: ReaderVerificationStatus,
    pub preset_json: ReaderRenderConfig,
    pub expected_revision: i64,
    pub expected_preset_revision: i64,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DuplicateReaderPresetParams {
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
pub struct DeleteReaderPresetParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub preset_id: String,
    pub expected_revision: i64,
    pub expected_preset_revision: i64,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReaderPresetMutationResult {
    pub metadata: AppMeta,
    pub preset: ReaderPresetRecord,
    pub no_op: bool,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeleteReaderPresetResult {
    pub metadata: AppMeta,
    pub deleted_preset_id: String,
    pub revision: i64,
}

pub fn list_reader_presets(params: ListReaderPresetsParams) -> Result<ListReaderPresetsResult> {
    let connection = open_existing(&params.file_path)?;
    let metadata = load_app_meta(&connection)?;
    let presets = load_project_presets(&connection, &metadata.project_id)?;
    let duplicate_names = duplicate_names(&presets);
    let revision = metadata.revision;
    connection.close().map_err(|(_, error)| error)?;
    Ok(ListReaderPresetsResult {
        metadata,
        presets,
        duplicate_names,
        revision,
    })
}

pub fn create_reader_preset(
    params: CreateReaderPresetParams,
) -> Result<ReaderPresetMutationResult> {
    validate_identifier(
        "preset_id",
        params.preset_id.as_deref().unwrap_or("generated"),
    )?;
    validate_name(&params.name)?;
    validate_preset_envelope(
        params.source_kind,
        params.source_id.as_deref(),
        params.source_version.as_deref(),
        params.verification_status,
        &params.preset_format,
        params.preset_version,
        &params.preset_json,
    )?;
    validate_revision(params.expected_revision, "expected_revision")?;
    let preset_id = params
        .preset_id
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    validate_identifier("preset_id", &preset_id)?;
    let (preset_json, content_hash) = canonical_reader_config(&params.preset_json)?;
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let before = load_app_meta(&connection)?;
    let now = database_timestamp(&connection)?;
    {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_project_revision(&transaction, params.expected_revision)?;
        let inserted = transaction.execute(
            "INSERT INTO reader_presets (
                id, project_id, name, source_kind, source_id, source_version,
                verification_status, preset_format, preset_version, preset_json,
                content_hash, revision, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0, ?12, ?12)",
            params![
                preset_id,
                before.project_id,
                params.name,
                params.source_kind.as_str(),
                params.source_id,
                params.source_version,
                params.verification_status.as_str(),
                READER_PRESET_FORMAT,
                READER_PRESET_VERSION,
                preset_json,
                content_hash,
                now,
            ],
        );
        match inserted {
            Ok(1) => {}
            Err(error) if is_unique_constraint(&error) => {
                return Err(CoreError::IdentifierConflict {
                    entity: "reader preset",
                    id: preset_id,
                });
            }
            Ok(_) => {
                return Err(CoreError::Integrity(
                    "reader preset insert failed".to_owned(),
                ))
            }
            Err(error) => return Err(error.into()),
        }
        bump_project_revision(&transaction, params.expected_revision, &saved_by, &now)?;
        transaction.commit()?;
    }
    let preset = load_project_preset(&connection, &before.project_id, &preset_id)?;
    let metadata = load_app_meta(&connection)?;
    let revision = metadata.revision;
    connection.close().map_err(|(_, error)| error)?;
    sync_file(&params.file_path)?;
    Ok(ReaderPresetMutationResult {
        metadata,
        preset,
        no_op: false,
        revision,
    })
}

pub fn update_reader_preset(
    params: UpdateReaderPresetParams,
) -> Result<ReaderPresetMutationResult> {
    validate_identifier("preset_id", &params.preset_id)?;
    validate_name(&params.name)?;
    validate_revision(params.expected_revision, "expected_revision")?;
    validate_revision(params.expected_preset_revision, "expected_preset_revision")?;
    validate_reader_config(&params.preset_json)?;
    if params.verification_status != params.preset_json.platform.verification_status {
        return Err(CoreError::InvalidInput(
            "verification_status must match preset_json.platform.verificationStatus".to_owned(),
        ));
    }
    let (preset_json, content_hash) = canonical_reader_config(&params.preset_json)?;
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let before = load_app_meta(&connection)?;
    ensure_metadata_revision(before.revision, params.expected_revision)?;
    let current = load_project_preset(&connection, &before.project_id, &params.preset_id)?;
    ensure_preset_revision(current.revision, params.expected_preset_revision)?;
    validate_source_status(
        current.source_kind,
        params.verification_status,
        &params.preset_json,
    )?;
    if current.name == params.name
        && current.verification_status == params.verification_status
        && current.content_hash == content_hash
    {
        let revision = before.revision;
        connection.close().map_err(|(_, error)| error)?;
        return Ok(ReaderPresetMutationResult {
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
            "UPDATE reader_presets
             SET name = ?1, verification_status = ?2, preset_json = ?3,
                 content_hash = ?4, revision = revision + 1, updated_at = ?5
             WHERE id = ?6 AND project_id = ?7 AND revision = ?8",
            params![
                params.name,
                params.verification_status.as_str(),
                preset_json,
                content_hash,
                now,
                params.preset_id,
                before.project_id,
                params.expected_preset_revision,
            ],
        )?;
        if changed != 1 {
            return Err(CoreError::ReaderPresetRevisionConflict {
                expected: params.expected_preset_revision,
                actual: current.revision,
            });
        }
        bump_project_revision(&transaction, params.expected_revision, &saved_by, &now)?;
        transaction.commit()?;
    }
    let preset = load_project_preset(&connection, &before.project_id, &params.preset_id)?;
    let metadata = load_app_meta(&connection)?;
    let revision = metadata.revision;
    connection.close().map_err(|(_, error)| error)?;
    sync_file(&params.file_path)?;
    Ok(ReaderPresetMutationResult {
        metadata,
        preset,
        no_op: false,
        revision,
    })
}

pub fn duplicate_reader_preset(
    params: DuplicateReaderPresetParams,
) -> Result<ReaderPresetMutationResult> {
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
    let source = load_project_preset(&connection, &before.project_id, &params.source_preset_id)?;
    let name = params
        .name
        .unwrap_or_else(|| format!("{} copy", source.name));
    validate_name(&name)?;
    let mut config = source.preset_json.clone();
    config.platform.verification_status = ReaderVerificationStatus::UserDefined;
    config.platform.verified_at = None;
    validate_source_status(
        ReaderPresetSourceKind::Duplicated,
        ReaderVerificationStatus::UserDefined,
        &config,
    )?;
    let (preset_json, content_hash) = canonical_reader_config(&config)?;
    let now = database_timestamp(&connection)?;
    {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_project_revision(&transaction, params.expected_revision)?;
        let inserted = transaction.execute(
            "INSERT INTO reader_presets (
                id, project_id, name, source_kind, source_id, source_version,
                verification_status, preset_format, preset_version, preset_json,
                content_hash, revision, created_at, updated_at
             ) VALUES (?1, ?2, ?3, 'DUPLICATED', ?4, ?5, 'USER_DEFINED',
                       ?6, ?7, ?8, ?9, 0, ?10, ?10)",
            params![
                preset_id,
                before.project_id,
                name,
                source.id,
                source.content_hash,
                READER_PRESET_FORMAT,
                READER_PRESET_VERSION,
                preset_json,
                content_hash,
                now,
            ],
        );
        match inserted {
            Ok(1) => {}
            Err(error) if is_unique_constraint(&error) => {
                return Err(CoreError::IdentifierConflict {
                    entity: "reader preset",
                    id: preset_id,
                });
            }
            Ok(_) => {
                return Err(CoreError::Integrity(
                    "reader preset duplicate failed".to_owned(),
                ))
            }
            Err(error) => return Err(error.into()),
        }
        bump_project_revision(&transaction, params.expected_revision, &saved_by, &now)?;
        transaction.commit()?;
    }
    let preset = load_project_preset(&connection, &before.project_id, &preset_id)?;
    let metadata = load_app_meta(&connection)?;
    let revision = metadata.revision;
    connection.close().map_err(|(_, error)| error)?;
    sync_file(&params.file_path)?;
    Ok(ReaderPresetMutationResult {
        metadata,
        preset,
        no_op: false,
        revision,
    })
}

pub fn delete_reader_preset(params: DeleteReaderPresetParams) -> Result<DeleteReaderPresetResult> {
    validate_identifier("preset_id", &params.preset_id)?;
    validate_revision(params.expected_revision, "expected_revision")?;
    validate_revision(params.expected_preset_revision, "expected_preset_revision")?;
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let before = load_app_meta(&connection)?;
    ensure_metadata_revision(before.revision, params.expected_revision)?;
    let current = load_project_preset(&connection, &before.project_id, &params.preset_id)?;
    ensure_preset_revision(current.revision, params.expected_preset_revision)?;
    let now = database_timestamp(&connection)?;
    {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_project_revision(&transaction, params.expected_revision)?;
        let changed = transaction.execute(
            "DELETE FROM reader_presets
             WHERE id = ?1 AND project_id = ?2 AND revision = ?3",
            params![
                params.preset_id,
                before.project_id,
                params.expected_preset_revision
            ],
        )?;
        if changed != 1 {
            return Err(CoreError::ReaderPresetRevisionConflict {
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
    Ok(DeleteReaderPresetResult {
        metadata,
        deleted_preset_id: params.preset_id,
        revision,
    })
}

pub(crate) fn canonical_reader_config(config: &ReaderRenderConfig) -> Result<(String, String)> {
    validate_reader_config(config)?;
    let mut normalized = config.clone();
    normalized.settings.background_color.make_ascii_lowercase();
    normalized.settings.text_color.make_ascii_lowercase();
    let value = canonical_value(serde_json::to_value(normalized)?);
    let json = serde_json::to_string(&value)?;
    let hash = format!("{:x}", Sha256::digest(json.as_bytes()));
    Ok((json, hash))
}

pub(crate) fn validate_reader_config(config: &ReaderRenderConfig) -> Result<()> {
    if config.format_version != READER_PRESET_VERSION || config.platform.version != 1 {
        return invalid("unsupported reader preset format version");
    }
    validate_bounded_text("platform.id", &config.platform.id, MAX_ID_CHARS)?;
    validate_bounded_text("platform.name", &config.platform.name, MAX_NAME_CHARS)?;
    validate_bounded_text("device.id", &config.device.id, MAX_ID_CHARS)?;
    validate_bounded_text("device.name", &config.device.name, MAX_NAME_CHARS)?;
    if let Some(verified_at) = config.platform.verified_at.as_deref() {
        validate_iso_timestamp(verified_at)?;
    }
    if config.platform.supported_controls.len() > MAX_SUPPORTED_CONTROLS {
        return invalid("supportedControls exceeds the safe item limit");
    }
    let mut controls = HashSet::new();
    for control in &config.platform.supported_controls {
        if !controls.insert(*control) {
            return invalid("supportedControls contains a duplicate");
        }
    }
    bounded(
        "device.viewportWidth",
        config.device.viewport_width,
        280.0,
        2560.0,
    )?;
    bounded(
        "device.viewportHeight",
        config.device.viewport_height,
        400.0,
        2160.0,
    )?;
    bounded(
        "device.safeAreaTop",
        config.device.safe_area_top,
        0.0,
        200.0,
    )?;
    bounded(
        "device.safeAreaBottom",
        config.device.safe_area_bottom,
        0.0,
        200.0,
    )?;
    bounded(
        "device.readerChromeHeight",
        config.device.reader_chrome_height,
        0.0,
        200.0,
    )?;
    bounded("device.pixelRatio", config.device.pixel_ratio, 0.5, 8.0)?;
    let vertical_reserved = config.device.safe_area_top
        + config.device.safe_area_bottom
        + config.device.reader_chrome_height;
    if vertical_reserved >= config.device.viewport_height {
        return invalid("device safe areas and chrome must leave visible reader height");
    }
    bounded("settings.fontSize", config.settings.font_size, 10.0, 40.0)?;
    bounded("settings.lineHeight", config.settings.line_height, 1.0, 3.0)?;
    bounded(
        "settings.paragraphSpacing",
        config.settings.paragraph_spacing,
        0.0,
        120.0,
    )?;
    bounded(
        "settings.firstLineIndent",
        config.settings.first_line_indent,
        0.0,
        120.0,
    )?;
    bounded(
        "settings.horizontalPadding",
        config.settings.horizontal_padding,
        0.0,
        200.0,
    )?;
    bounded(
        "settings.verticalPadding",
        config.settings.vertical_padding,
        0.0,
        200.0,
    )?;
    if config.settings.horizontal_padding * 2.0 >= config.device.viewport_width {
        return invalid("horizontal padding must leave visible reader width");
    }
    let effective_height = config.device.viewport_height - vertical_reserved;
    if config.settings.vertical_padding * 2.0 >= effective_height {
        return invalid("vertical padding must leave visible reader height");
    }
    validate_color(
        "settings.backgroundColor",
        &config.settings.background_color,
    )?;
    validate_color("settings.textColor", &config.settings.text_color)?;
    Ok(())
}

fn validate_preset_envelope(
    source_kind: ReaderPresetSourceKind,
    source_id: Option<&str>,
    source_version: Option<&str>,
    verification_status: ReaderVerificationStatus,
    preset_format: &str,
    preset_version: i64,
    config: &ReaderRenderConfig,
) -> Result<()> {
    if preset_format != READER_PRESET_FORMAT || preset_version != READER_PRESET_VERSION {
        return invalid("unsupported reader preset envelope");
    }
    if let Some(source_id) = source_id {
        validate_bounded_text("source_id", source_id, MAX_ID_CHARS)?;
    }
    if let Some(source_version) = source_version {
        validate_bounded_text("source_version", source_version, MAX_SOURCE_VERSION_CHARS)?;
    }
    match source_kind {
        ReaderPresetSourceKind::BuiltinTemplate | ReaderPresetSourceKind::Imported => {
            if source_id.is_none() || source_version.is_none() {
                return invalid("preset provenance requires source_id and source_version");
            }
        }
        ReaderPresetSourceKind::Custom => {
            if source_id.is_some() || source_version.is_some() {
                return invalid("custom preset cannot claim source provenance");
            }
        }
        ReaderPresetSourceKind::Duplicated => {
            if source_id.is_none() || source_version.is_none() {
                return invalid("duplicated preset requires source provenance");
            }
        }
    }
    if verification_status != config.platform.verification_status {
        return invalid("verification_status must match preset_json.platform.verificationStatus");
    }
    validate_source_status(source_kind, verification_status, config)?;
    validate_reader_config(config)
}

fn validate_source_status(
    source_kind: ReaderPresetSourceKind,
    status: ReaderVerificationStatus,
    config: &ReaderRenderConfig,
) -> Result<()> {
    match status {
        ReaderVerificationStatus::Generic => {
            if source_kind != ReaderPresetSourceKind::BuiltinTemplate
                || config.platform.family != PlatformFamily::Generic
            {
                return invalid("GENERIC profiles must be generic builtin templates");
            }
        }
        ReaderVerificationStatus::UnverifiedSimulation => {
            if source_kind != ReaderPresetSourceKind::BuiltinTemplate
                || config.platform.family != PlatformFamily::PlatformLike
                || config.platform.verified_at.is_some()
            {
                return invalid("platform-like profiles must be unverified builtin simulations");
            }
        }
        ReaderVerificationStatus::UserDefined => {
            if matches!(source_kind, ReaderPresetSourceKind::BuiltinTemplate)
                || config.platform.verified_at.is_some()
            {
                return invalid("builtin template cannot claim USER_DEFINED status");
            }
        }
    }
    Ok(())
}

pub(crate) fn load_project_presets(
    connection: &Connection,
    project_id: &str,
) -> Result<Vec<ReaderPresetRecord>> {
    let mut statement = connection.prepare(
        "SELECT id, project_id, name, source_kind, source_id, source_version,
                verification_status, preset_format, preset_version, preset_json,
                content_hash, revision, created_at, updated_at
         FROM reader_presets WHERE project_id = ?1
         ORDER BY name COLLATE NOCASE, id",
    )?;
    let rows = statement.query_map([project_id], reader_preset_row)?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(CoreError::from)
        .and_then(validate_loaded_presets)
}

fn load_project_preset(
    connection: &Connection,
    project_id: &str,
    preset_id: &str,
) -> Result<ReaderPresetRecord> {
    let preset = connection
        .query_row(
            "SELECT id, project_id, name, source_kind, source_id, source_version,
                    verification_status, preset_format, preset_version, preset_json,
                    content_hash, revision, created_at, updated_at
             FROM reader_presets WHERE id = ?1 AND project_id = ?2",
            params![preset_id, project_id],
            reader_preset_row,
        )
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("reader preset id {preset_id}")))?;
    validate_loaded_preset(preset)
}

fn reader_preset_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReaderPresetRecord> {
    let source_kind: String = row.get(3)?;
    let status: String = row.get(6)?;
    let preset_json: String = row.get(9)?;
    let config = serde_json::from_str::<ReaderRenderConfig>(&preset_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(9, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let source_kind = ReaderPresetSourceKind::parse(&source_kind).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let verification_status = ReaderVerificationStatus::parse(&status).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(ReaderPresetRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        name: row.get(2)?,
        source_kind,
        source_id: row.get(4)?,
        source_version: row.get(5)?,
        verification_status,
        preset_format: row.get(7)?,
        preset_version: row.get(8)?,
        preset_json: config,
        content_hash: row.get(10)?,
        revision: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

fn validate_loaded_presets(presets: Vec<ReaderPresetRecord>) -> Result<Vec<ReaderPresetRecord>> {
    presets.into_iter().map(validate_loaded_preset).collect()
}

pub(crate) fn validate_loaded_preset(preset: ReaderPresetRecord) -> Result<ReaderPresetRecord> {
    validate_identifier("reader preset id", &preset.id)?;
    validate_name(&preset.name)?;
    validate_preset_envelope(
        preset.source_kind,
        preset.source_id.as_deref(),
        preset.source_version.as_deref(),
        preset.verification_status,
        &preset.preset_format,
        preset.preset_version,
        &preset.preset_json,
    )?;
    validate_revision(preset.revision, "reader preset revision")?;
    let (_, expected_hash) = canonical_reader_config(&preset.preset_json)?;
    if preset.content_hash != expected_hash {
        return Err(CoreError::Integrity(
            "reader preset canonical content hash is invalid".to_owned(),
        ));
    }
    Ok(preset)
}

fn duplicate_names(presets: &[ReaderPresetRecord]) -> Vec<String> {
    let mut counts = BTreeMap::new();
    for preset in presets {
        *counts.entry(preset.name.clone()).or_insert(0usize) += 1;
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

fn validate_iso_timestamp(value: &str) -> Result<()> {
    let bytes = value.as_bytes();
    let exact_shape = bytes.len() == 24
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[10] == b'T'
        && bytes[13] == b':'
        && bytes[16] == b':'
        && bytes[19] == b'.'
        && bytes[23] == b'Z'
        && bytes.iter().enumerate().all(|(index, byte)| {
            matches!(index, 4 | 7 | 10 | 13 | 16 | 19 | 23) || byte.is_ascii_digit()
        });
    if !exact_shape {
        return invalid("verifiedAt must be an exact UTC ISO timestamp");
    }
    let number = |start: usize, end: usize| -> u32 {
        value[start..end].parse::<u32>().expect("shape checked")
    };
    let year = number(0, 4);
    let month = number(5, 7);
    let day = number(8, 10);
    let hour = number(11, 13);
    let minute = number(14, 16);
    let second = number(17, 19);
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 400 == 0 || (year % 4 == 0 && year % 100 != 0) => 29,
        2 => 28,
        _ => 0,
    };
    if day == 0 || day > max_day || hour > 23 || minute > 59 || second > 59 {
        return invalid("verifiedAt must be a valid UTC ISO timestamp");
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
        return Err(CoreError::ReaderPresetRevisionConflict { expected, actual });
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
    validate_bounded_text("saved_by", &value, 256)?;
    Ok(value)
}

fn validate_identifier(field: &str, value: &str) -> Result<()> {
    validate_bounded_text(field, value, MAX_ID_CHARS)
}

fn validate_name(value: &str) -> Result<()> {
    validate_bounded_text("reader preset name", value, MAX_NAME_CHARS)
}

fn validate_bounded_text(field: &str, value: &str, max_chars: usize) -> Result<()> {
    validate_non_empty(field, value)?;
    if value.encode_utf16().count() > max_chars {
        return invalid(&format!("{field} exceeds {max_chars} characters"));
    }
    Ok(())
}

fn validate_revision(value: i64, field: &str) -> Result<()> {
    if value < 0 {
        return invalid(&format!("{field} must be non-negative"));
    }
    Ok(())
}

fn bounded(field: &str, value: f64, min: f64, max: f64) -> Result<()> {
    if !value.is_finite() || value < min || value > max {
        return invalid(&format!("{field} is outside the supported range"));
    }
    Ok(())
}

fn validate_color(field: &str, value: &str) -> Result<()> {
    let valid = value.len() == 7
        && value.starts_with('#')
        && value.as_bytes()[1..]
            .iter()
            .all(|byte| byte.is_ascii_hexdigit());
    if !valid {
        return invalid(&format!("{field} must use #RRGGBB"));
    }
    Ok(())
}

fn invalid<T>(message: &str) -> Result<T> {
    Err(CoreError::InvalidInput(message.to_owned()))
}

fn is_unique_constraint(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(code, _)
            if code.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_PRIMARYKEY
                || code.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE
    )
}
