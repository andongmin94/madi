use std::collections::{BTreeMap, HashMap, HashSet};
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

pub const JSON_CANVAS_DOCUMENT_FORMAT: &str = "JSON_CANVAS";
pub const JSON_CANVAS_DOCUMENT_VERSION: &str = "1.0";
pub const MAX_CANVAS_NODES: usize = 500;
pub const MAX_CANVAS_EDGES: usize = 1_000;
pub const MAX_CANVAS_DOCUMENT_BYTES: usize = 32 * 1024 * 1024;

const MAX_IDENTIFIER_BYTES: usize = 512;
const MAX_NODE_TEXT_BYTES: usize = 1024 * 1024;
const MAX_LABEL_BYTES: usize = 64 * 1024;
const MAX_METADATA_TEXT_BYTES: usize = 1024 * 1024;
const MAX_ABSOLUTE_COORDINATE: f64 = 10_000_000.0;
const MAX_DIMENSION: f64 = 100_000.0;

/// The persisted Plot Canvas contract. It intentionally contains no React Flow types.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct MadiCanvasDocument {
    #[serde(default)]
    pub nodes: Vec<JsonCanvasNode>,
    #[serde(default)]
    pub edges: Vec<JsonCanvasEdge>,
    #[serde(flatten)]
    pub extensions: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JsonCanvasNodeType {
    Text,
    Group,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JsonCanvasNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: JsonCanvasNodeType,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(
        default,
        rename = "backgroundStyle",
        skip_serializing_if = "Option::is_none"
    )]
    pub background_style: Option<JsonCanvasBackgroundStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub madi: Option<MadiCanvasNodeExtension>,
    #[serde(flatten)]
    pub extensions: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JsonCanvasBackgroundStyle {
    Cover,
    Ratio,
    Repeat,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MadiCanvasNodeKind {
    Text,
    EntityReference,
    SceneReference,
    Group,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MadiCanvasNodeExtension {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node_kind: Option<MadiCanvasNodeKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scene_node_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_group_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_label: Option<String>,
    #[serde(flatten)]
    pub extensions: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JsonCanvasSide {
    Top,
    Right,
    Bottom,
    Left,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JsonCanvasEnd {
    None,
    Arrow,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JsonCanvasEdge {
    pub id: String,
    #[serde(rename = "fromNode")]
    pub from_node: String,
    #[serde(rename = "toNode")]
    pub to_node: String,
    #[serde(default, rename = "fromSide", skip_serializing_if = "Option::is_none")]
    pub from_side: Option<JsonCanvasSide>,
    #[serde(default, rename = "toSide", skip_serializing_if = "Option::is_none")]
    pub to_side: Option<JsonCanvasSide>,
    #[serde(default, rename = "fromEnd", skip_serializing_if = "Option::is_none")]
    pub from_end: Option<JsonCanvasEnd>,
    #[serde(default, rename = "toEnd", skip_serializing_if = "Option::is_none")]
    pub to_end: Option<JsonCanvasEnd>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub madi: Option<MadiCanvasEdgeExtension>,
    #[serde(flatten)]
    pub extensions: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MadiCanvasLineStyle {
    Solid,
    Dashed,
    Dotted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MadiCanvasEdgeExtension {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_style: Option<MadiCanvasLineStyle>,
    #[serde(flatten)]
    pub extensions: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CanvasSummary {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub description: Option<String>,
    pub document_format: String,
    pub document_version: String,
    pub content_hash: String,
    pub revision: i64,
    pub node_count: u64,
    pub edge_count: u64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CanvasRecord {
    #[serde(flatten)]
    pub summary: CanvasSummary,
    pub document: MadiCanvasDocument,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CanvasSort {
    NameAsc,
    NameDesc,
    UpdatedAsc,
    #[default]
    UpdatedDesc,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ListCanvasesParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    #[serde(default)]
    pub sort: CanvasSort,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ListCanvasesResult {
    pub metadata: AppMeta,
    pub canvases: Vec<CanvasSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CreateCanvasParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    #[serde(default)]
    pub canvas_id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub document: MadiCanvasDocument,
    #[serde(default)]
    pub expected_revision: Option<i64>,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CreateCanvasResult {
    pub metadata: AppMeta,
    pub canvas: CanvasRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpdateCanvasParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub canvas_id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub expected_revision: i64,
    pub expected_canvas_revision: i64,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UpdateCanvasResult {
    pub metadata: AppMeta,
    pub canvas: CanvasRecord,
    pub no_op: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DuplicateCanvasParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub source_canvas_id: String,
    #[serde(default)]
    pub canvas_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    pub expected_revision: i64,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DuplicateCanvasResult {
    pub metadata: AppMeta,
    pub canvas: CanvasRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeleteCanvasParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub canvas_id: String,
    pub expected_revision: i64,
    pub expected_canvas_revision: i64,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeleteCanvasResult {
    pub metadata: AppMeta,
    pub deleted_canvas_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LoadCanvasParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub canvas_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LoadCanvasResult {
    pub metadata: AppMeta,
    pub canvas: CanvasRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SaveCanvasParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub canvas_id: String,
    pub document: MadiCanvasDocument,
    pub expected_revision: i64,
    pub expected_canvas_revision: i64,
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SaveCanvasResult {
    pub metadata: AppMeta,
    pub canvas: CanvasRecord,
    pub no_op: bool,
}

pub fn list_canvases(params: ListCanvasesParams) -> Result<ListCanvasesResult> {
    let connection = open_existing(&params.file_path)?;
    let metadata = load_app_meta(&connection)?;
    let order = match params.sort {
        CanvasSort::NameAsc => "name COLLATE NOCASE ASC, id ASC",
        CanvasSort::NameDesc => "name COLLATE NOCASE DESC, id ASC",
        CanvasSort::UpdatedAsc => "updated_at ASC, id ASC",
        CanvasSort::UpdatedDesc => "updated_at DESC, id ASC",
    };
    let sql = format!(
        "SELECT id, project_id, name, description, document_format,
                document_version, document_json, content_hash, revision,
                created_at, updated_at
         FROM canvases WHERE project_id = ?1 ORDER BY {order}"
    );
    let canvases = {
        let mut statement = connection.prepare(&sql)?;
        let rows = statement.query_map([&metadata.project_id], canvas_row)?;
        let mut canvases = Vec::new();
        for row in rows {
            canvases.push(row?.summary);
        }
        canvases
    };
    connection.close().map_err(|(_, error)| error)?;
    Ok(ListCanvasesResult { metadata, canvases })
}

pub fn create_canvas(params: CreateCanvasParams) -> Result<CreateCanvasResult> {
    validate_canvas_metadata(&params.name, params.description.as_deref())?;
    validate_optional_revision(params.expected_revision)?;
    let canvas_id = params
        .canvas_id
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    validate_identifier("canvas_id", &canvas_id)?;
    let (document_json, content_hash) = canonical_canvas_document(&params.document)?;
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let before = load_app_meta(&connection)?;
    let expected_revision = params.expected_revision.unwrap_or(before.revision);
    let now = database_timestamp(&connection)?;
    {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_project_revision(&transaction, expected_revision)?;
        let changed = transaction.execute(
            "INSERT INTO canvases (
                id, project_id, name, description, document_format,
                document_version, document_json, content_hash, revision,
                created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?9)",
            params![
                canvas_id,
                before.project_id,
                params.name,
                params.description,
                JSON_CANVAS_DOCUMENT_FORMAT,
                JSON_CANVAS_DOCUMENT_VERSION,
                document_json,
                content_hash,
                now
            ],
        );
        match changed {
            Ok(1) => {}
            Err(error) if is_unique_constraint(&error) => {
                return Err(CoreError::IdentifierConflict {
                    entity: "canvas",
                    id: canvas_id,
                });
            }
            Err(error) => return Err(error.into()),
            Ok(_) => return Err(CoreError::Integrity("canvas insert failed".to_owned())),
        }
        bump_project_revision(&transaction, expected_revision, &saved_by, &now)?;
        transaction.commit()?;
    }
    let canvas = load_canvas_record(&connection, &before.project_id, &canvas_id)?;
    let metadata = load_app_meta(&connection)?;
    connection.close().map_err(|(_, error)| error)?;
    sync_file(&params.file_path)?;
    Ok(CreateCanvasResult { metadata, canvas })
}

pub fn update_canvas(params: UpdateCanvasParams) -> Result<UpdateCanvasResult> {
    validate_identifier("canvas_id", &params.canvas_id)?;
    validate_canvas_metadata(&params.name, params.description.as_deref())?;
    validate_required_revisions(params.expected_revision, params.expected_canvas_revision)?;
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let before = load_app_meta(&connection)?;
    let current = load_canvas_record(&connection, &before.project_id, &params.canvas_id)?;
    ensure_canvas_revision(current.summary.revision, params.expected_canvas_revision)?;
    ensure_metadata_revision(before.revision, params.expected_revision)?;
    let no_op =
        current.summary.name == params.name && current.summary.description == params.description;
    if no_op {
        connection.close().map_err(|(_, error)| error)?;
        return Ok(UpdateCanvasResult {
            metadata: before,
            canvas: current,
            no_op: true,
        });
    }
    let now = database_timestamp(&connection)?;
    {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_project_revision(&transaction, params.expected_revision)?;
        ensure_stored_canvas_revision(
            &transaction,
            &before.project_id,
            &params.canvas_id,
            params.expected_canvas_revision,
        )?;
        let changed = transaction.execute(
            "UPDATE canvases SET name = ?1, description = ?2,
                    revision = revision + 1, updated_at = ?3
             WHERE id = ?4 AND project_id = ?5 AND revision = ?6",
            params![
                params.name,
                params.description,
                now,
                params.canvas_id,
                before.project_id,
                params.expected_canvas_revision
            ],
        )?;
        if changed != 1 {
            return Err(canvas_not_found(&params.canvas_id));
        }
        bump_project_revision(&transaction, params.expected_revision, &saved_by, &now)?;
        transaction.commit()?;
    }
    let canvas = load_canvas_record(&connection, &before.project_id, &params.canvas_id)?;
    let metadata = load_app_meta(&connection)?;
    connection.close().map_err(|(_, error)| error)?;
    sync_file(&params.file_path)?;
    Ok(UpdateCanvasResult {
        metadata,
        canvas,
        no_op: false,
    })
}

pub fn duplicate_canvas(params: DuplicateCanvasParams) -> Result<DuplicateCanvasResult> {
    validate_identifier("source_canvas_id", &params.source_canvas_id)?;
    validate_required_revision(params.expected_revision)?;
    let canvas_id = params
        .canvas_id
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    validate_identifier("canvas_id", &canvas_id)?;
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let before = load_app_meta(&connection)?;
    ensure_metadata_revision(before.revision, params.expected_revision)?;
    let source = load_canvas_record(&connection, &before.project_id, &params.source_canvas_id)?;
    let name = params
        .name
        .unwrap_or_else(|| format!("{} 복사본", source.summary.name));
    validate_canvas_metadata(&name, source.summary.description.as_deref())?;
    let now = database_timestamp(&connection)?;
    {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_project_revision(&transaction, params.expected_revision)?;
        let changed = transaction.execute(
            "INSERT INTO canvases (
                id, project_id, name, description, document_format,
                document_version, document_json, content_hash, revision,
                created_at, updated_at
             ) SELECT ?1, project_id, ?2, description, document_format,
                      document_version, document_json, content_hash, 0, ?3, ?3
               FROM canvases WHERE id = ?4 AND project_id = ?5",
            params![
                canvas_id,
                name,
                now,
                params.source_canvas_id,
                before.project_id
            ],
        );
        match changed {
            Ok(1) => {}
            Err(error) if is_unique_constraint(&error) => {
                return Err(CoreError::IdentifierConflict {
                    entity: "canvas",
                    id: canvas_id,
                });
            }
            Err(error) => return Err(error.into()),
            Ok(_) => return Err(canvas_not_found(&params.source_canvas_id)),
        }
        bump_project_revision(&transaction, params.expected_revision, &saved_by, &now)?;
        transaction.commit()?;
    }
    let canvas = load_canvas_record(&connection, &before.project_id, &canvas_id)?;
    let metadata = load_app_meta(&connection)?;
    connection.close().map_err(|(_, error)| error)?;
    sync_file(&params.file_path)?;
    Ok(DuplicateCanvasResult { metadata, canvas })
}

pub fn delete_canvas(params: DeleteCanvasParams) -> Result<DeleteCanvasResult> {
    validate_identifier("canvas_id", &params.canvas_id)?;
    validate_required_revisions(params.expected_revision, params.expected_canvas_revision)?;
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let before = load_app_meta(&connection)?;
    ensure_metadata_revision(before.revision, params.expected_revision)?;
    let current = load_canvas_record(&connection, &before.project_id, &params.canvas_id)?;
    ensure_canvas_revision(current.summary.revision, params.expected_canvas_revision)?;
    let now = database_timestamp(&connection)?;
    {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_project_revision(&transaction, params.expected_revision)?;
        let changed = transaction.execute(
            "DELETE FROM canvases
             WHERE id = ?1 AND project_id = ?2 AND revision = ?3",
            params![
                params.canvas_id,
                before.project_id,
                params.expected_canvas_revision
            ],
        )?;
        if changed != 1 {
            ensure_stored_canvas_revision(
                &transaction,
                &before.project_id,
                &params.canvas_id,
                params.expected_canvas_revision,
            )?;
            return Err(canvas_not_found(&params.canvas_id));
        }
        bump_project_revision(&transaction, params.expected_revision, &saved_by, &now)?;
        transaction.commit()?;
    }
    let metadata = load_app_meta(&connection)?;
    connection.close().map_err(|(_, error)| error)?;
    sync_file(&params.file_path)?;
    Ok(DeleteCanvasResult {
        metadata,
        deleted_canvas_id: params.canvas_id,
    })
}

pub fn load_canvas(params: LoadCanvasParams) -> Result<LoadCanvasResult> {
    validate_identifier("canvas_id", &params.canvas_id)?;
    let connection = open_existing(&params.file_path)?;
    let metadata = load_app_meta(&connection)?;
    let canvas = load_canvas_record(&connection, &metadata.project_id, &params.canvas_id)?;
    connection.close().map_err(|(_, error)| error)?;
    Ok(LoadCanvasResult { metadata, canvas })
}

pub fn save_canvas(params: SaveCanvasParams) -> Result<SaveCanvasResult> {
    validate_identifier("canvas_id", &params.canvas_id)?;
    validate_required_revisions(params.expected_revision, params.expected_canvas_revision)?;
    let (document_json, content_hash) = canonical_canvas_document(&params.document)?;
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let before = load_app_meta(&connection)?;
    ensure_metadata_revision(before.revision, params.expected_revision)?;
    let current = load_canvas_record(&connection, &before.project_id, &params.canvas_id)?;
    ensure_canvas_revision(current.summary.revision, params.expected_canvas_revision)?;
    if current.summary.content_hash == content_hash {
        connection.close().map_err(|(_, error)| error)?;
        return Ok(SaveCanvasResult {
            metadata: before,
            canvas: current,
            no_op: true,
        });
    }
    let now = database_timestamp(&connection)?;
    {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_project_revision(&transaction, params.expected_revision)?;
        ensure_stored_canvas_revision(
            &transaction,
            &before.project_id,
            &params.canvas_id,
            params.expected_canvas_revision,
        )?;
        let changed = transaction.execute(
            "UPDATE canvases SET document_json = ?1, content_hash = ?2,
                    revision = revision + 1, updated_at = ?3
             WHERE id = ?4 AND project_id = ?5 AND revision = ?6",
            params![
                document_json,
                content_hash,
                now,
                params.canvas_id,
                before.project_id,
                params.expected_canvas_revision
            ],
        )?;
        if changed != 1 {
            return Err(canvas_not_found(&params.canvas_id));
        }
        bump_project_revision(&transaction, params.expected_revision, &saved_by, &now)?;
        transaction.commit()?;
    }
    let canvas = load_canvas_record(&connection, &before.project_id, &params.canvas_id)?;
    let metadata = load_app_meta(&connection)?;
    connection.close().map_err(|(_, error)| error)?;
    sync_file(&params.file_path)?;
    Ok(SaveCanvasResult {
        metadata,
        canvas,
        no_op: false,
    })
}

/// Validate and canonically serialize a JSON Canvas-compatible document.
pub fn canonical_canvas_document(document: &MadiCanvasDocument) -> Result<(String, String)> {
    validate_canvas_document(document)?;
    let document_json = serde_json::to_string(document)?;
    if document_json.len() > MAX_CANVAS_DOCUMENT_BYTES {
        return Err(CoreError::InvalidInput(format!(
            "canvas document exceeds {MAX_CANVAS_DOCUMENT_BYTES} UTF-8 bytes"
        )));
    }
    let content_hash = format!("{:x}", Sha256::digest(document_json.as_bytes()));
    Ok((document_json, content_hash))
}

pub fn validate_canvas_document(document: &MadiCanvasDocument) -> Result<()> {
    if document.nodes.len() > MAX_CANVAS_NODES {
        return Err(CoreError::InvalidInput(format!(
            "canvas nodes exceed the limit of {MAX_CANVAS_NODES}"
        )));
    }
    if document.edges.len() > MAX_CANVAS_EDGES {
        return Err(CoreError::InvalidInput(format!(
            "canvas edges exceed the limit of {MAX_CANVAS_EDGES}"
        )));
    }

    let mut node_ids = HashSet::new();
    let mut group_ids = HashSet::new();
    for node in &document.nodes {
        validate_identifier("node.id", &node.id)?;
        if !node_ids.insert(node.id.as_str()) {
            return Err(CoreError::InvalidInput(format!(
                "canvas contains duplicate node id {}",
                node.id
            )));
        }
        validate_geometry(node)?;
        validate_optional_text("node.color", node.color.as_deref(), MAX_LABEL_BYTES)?;
        validate_optional_text(
            "node.background",
            node.background.as_deref(),
            MAX_LABEL_BYTES,
        )?;
        match node.node_type {
            JsonCanvasNodeType::Text => {
                let text = node.text.as_deref().ok_or_else(|| {
                    CoreError::InvalidInput(format!("text node {} must contain text", node.id))
                })?;
                validate_bounded_text("node.text", text, MAX_NODE_TEXT_BYTES, false)?;
                if node.label.is_some()
                    || node.background.is_some()
                    || node.background_style.is_some()
                {
                    return Err(CoreError::InvalidInput(format!(
                        "text node {} contains group-only fields",
                        node.id
                    )));
                }
            }
            JsonCanvasNodeType::Group => {
                if node.text.is_some() {
                    return Err(CoreError::InvalidInput(format!(
                        "group node {} must not contain text",
                        node.id
                    )));
                }
                validate_optional_text("node.label", node.label.as_deref(), MAX_LABEL_BYTES)?;
                group_ids.insert(node.id.as_str());
            }
        }
        validate_node_extension(node)?;
    }

    validate_group_ownership(document, &group_ids)?;

    let mut edge_ids = HashSet::new();
    for edge in &document.edges {
        validate_identifier("edge.id", &edge.id)?;
        validate_identifier("edge.fromNode", &edge.from_node)?;
        validate_identifier("edge.toNode", &edge.to_node)?;
        if !edge_ids.insert(edge.id.as_str()) {
            return Err(CoreError::InvalidInput(format!(
                "canvas contains duplicate edge id {}",
                edge.id
            )));
        }
        if !node_ids.contains(edge.from_node.as_str()) || !node_ids.contains(edge.to_node.as_str())
        {
            return Err(CoreError::InvalidInput(format!(
                "edge {} references a missing node",
                edge.id
            )));
        }
        validate_optional_text("edge.color", edge.color.as_deref(), MAX_LABEL_BYTES)?;
        validate_optional_text("edge.label", edge.label.as_deref(), MAX_LABEL_BYTES)?;
    }
    Ok(())
}

fn validate_node_extension(node: &JsonCanvasNode) -> Result<()> {
    let Some(extension) = node.madi.as_ref() else {
        return Ok(());
    };
    validate_optional_text(
        "node.madi.originalLabel",
        extension.original_label.as_deref(),
        MAX_LABEL_BYTES,
    )?;
    if let Some(group_id) = extension.parent_group_id.as_deref() {
        validate_identifier("node.madi.parentGroupId", group_id)?;
    }
    match extension.node_kind {
        None => {
            if extension.entity_id.is_some() || extension.scene_node_id.is_some() {
                return Err(CoreError::InvalidInput(format!(
                    "node {} has a reference id without madi.nodeKind",
                    node.id
                )));
            }
        }
        Some(MadiCanvasNodeKind::Text) => {
            if node.node_type != JsonCanvasNodeType::Text
                || extension.entity_id.is_some()
                || extension.scene_node_id.is_some()
            {
                return Err(CoreError::InvalidInput(format!(
                    "text node {} has an invalid madi extension",
                    node.id
                )));
            }
        }
        Some(MadiCanvasNodeKind::EntityReference) => {
            if node.node_type != JsonCanvasNodeType::Text
                || extension.scene_node_id.is_some()
                || extension.entity_id.as_deref().is_none_or(str::is_empty)
            {
                return Err(CoreError::InvalidInput(format!(
                    "entity reference node {} has an invalid madi extension",
                    node.id
                )));
            }
            validate_identifier(
                "node.madi.entityId",
                extension.entity_id.as_deref().unwrap_or_default(),
            )?;
        }
        Some(MadiCanvasNodeKind::SceneReference) => {
            if node.node_type != JsonCanvasNodeType::Text
                || extension.entity_id.is_some()
                || extension.scene_node_id.as_deref().is_none_or(str::is_empty)
            {
                return Err(CoreError::InvalidInput(format!(
                    "scene reference node {} has an invalid madi extension",
                    node.id
                )));
            }
            validate_identifier(
                "node.madi.sceneNodeId",
                extension.scene_node_id.as_deref().unwrap_or_default(),
            )?;
        }
        Some(MadiCanvasNodeKind::Group) => {
            if node.node_type != JsonCanvasNodeType::Group
                || extension.entity_id.is_some()
                || extension.scene_node_id.is_some()
            {
                return Err(CoreError::InvalidInput(format!(
                    "group node {} has an invalid madi extension",
                    node.id
                )));
            }
        }
    }
    Ok(())
}

fn validate_group_ownership(
    document: &MadiCanvasDocument,
    group_ids: &HashSet<&str>,
) -> Result<()> {
    let parents = document
        .nodes
        .iter()
        .filter_map(|node| {
            node.madi
                .as_ref()
                .and_then(|extension| extension.parent_group_id.as_deref())
                .map(|parent| (node.id.as_str(), parent))
        })
        .collect::<HashMap<_, _>>();
    for (node_id, parent_id) in &parents {
        if node_id == parent_id || !group_ids.contains(parent_id) {
            return Err(CoreError::InvalidInput(format!(
                "node {node_id} has an invalid parent group {parent_id}"
            )));
        }
        let mut seen = HashSet::new();
        let mut cursor = *node_id;
        while let Some(parent) = parents.get(cursor) {
            if !seen.insert(cursor) {
                return Err(CoreError::InvalidInput(
                    "canvas group ownership contains a cycle".to_owned(),
                ));
            }
            cursor = parent;
        }
    }
    Ok(())
}

fn validate_geometry(node: &JsonCanvasNode) -> Result<()> {
    if !node.x.is_finite()
        || !node.y.is_finite()
        || !node.width.is_finite()
        || !node.height.is_finite()
        || node.x.fract() != 0.0
        || node.y.fract() != 0.0
        || node.width.fract() != 0.0
        || node.height.fract() != 0.0
        || node.x.abs() > MAX_ABSOLUTE_COORDINATE
        || node.y.abs() > MAX_ABSOLUTE_COORDINATE
        || node.width <= 0.0
        || node.height <= 0.0
        || node.width > MAX_DIMENSION
        || node.height > MAX_DIMENSION
    {
        return Err(CoreError::InvalidInput(format!(
            "node {} has invalid geometry",
            node.id
        )));
    }
    Ok(())
}

fn validate_canvas_metadata(name: &str, description: Option<&str>) -> Result<()> {
    validate_bounded_text("name", name, MAX_LABEL_BYTES, true)?;
    validate_optional_text("description", description, MAX_METADATA_TEXT_BYTES)
}

fn validate_optional_text(field: &str, value: Option<&str>, maximum: usize) -> Result<()> {
    if let Some(value) = value {
        validate_bounded_text(field, value, maximum, false)?;
    }
    Ok(())
}

fn validate_bounded_text(field: &str, value: &str, maximum: usize, non_empty: bool) -> Result<()> {
    if non_empty {
        validate_non_empty(field, value)?;
    }
    if value.len() > maximum {
        return Err(CoreError::InvalidInput(format!(
            "{field} exceeds {maximum} UTF-8 bytes"
        )));
    }
    Ok(())
}

fn validate_identifier(field: &str, value: &str) -> Result<()> {
    validate_non_empty(field, value)?;
    if value.len() > MAX_IDENTIFIER_BYTES {
        return Err(CoreError::InvalidInput(format!(
            "{field} exceeds {MAX_IDENTIFIER_BYTES} UTF-8 bytes"
        )));
    }
    Ok(())
}

fn canvas_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CanvasRecord> {
    let document_json: String = row.get(6)?;
    let document: MadiCanvasDocument = serde_json::from_str(&document_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            document_json.len(),
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })?;
    Ok(CanvasRecord {
        summary: CanvasSummary {
            id: row.get(0)?,
            project_id: row.get(1)?,
            name: row.get(2)?,
            description: row.get(3)?,
            document_format: row.get(4)?,
            document_version: row.get(5)?,
            content_hash: row.get(7)?,
            revision: row.get(8)?,
            node_count: document.nodes.len() as u64,
            edge_count: document.edges.len() as u64,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
        },
        document,
    })
}

pub(crate) fn load_canvas_record(
    connection: &Connection,
    project_id: &str,
    canvas_id: &str,
) -> Result<CanvasRecord> {
    let record = connection
        .query_row(
            "SELECT id, project_id, name, description, document_format,
                    document_version, document_json, content_hash, revision,
                    created_at, updated_at
             FROM canvases WHERE id = ?1 AND project_id = ?2",
            params![canvas_id, project_id],
            canvas_row,
        )
        .optional()?
        .ok_or_else(|| canvas_not_found(canvas_id))?;
    if record.summary.document_format != JSON_CANVAS_DOCUMENT_FORMAT
        || record.summary.document_version != JSON_CANVAS_DOCUMENT_VERSION
    {
        return Err(CoreError::Integrity(format!(
            "canvas {canvas_id} has an unsupported document identity"
        )));
    }
    let (canonical, hash) = canonical_canvas_document(&record.document)?;
    let stored: String = connection.query_row(
        "SELECT document_json FROM canvases WHERE id = ?1 AND project_id = ?2",
        params![canvas_id, project_id],
        |row| row.get(0),
    )?;
    if canonical != stored || hash != record.summary.content_hash {
        return Err(CoreError::Integrity(format!(
            "canvas {canvas_id} canonical content hash is invalid"
        )));
    }
    Ok(record)
}

fn validate_optional_revision(revision: Option<i64>) -> Result<()> {
    if revision.is_some_and(|value| value < 0) {
        return Err(CoreError::InvalidInput(
            "expected_revision must be non-negative".to_owned(),
        ));
    }
    Ok(())
}

fn validate_required_revision(revision: i64) -> Result<()> {
    if revision < 0 {
        return Err(CoreError::InvalidInput(
            "expected_revision must be non-negative".to_owned(),
        ));
    }
    Ok(())
}

fn validate_required_revisions(project_revision: i64, canvas_revision: i64) -> Result<()> {
    validate_required_revision(project_revision)?;
    if canvas_revision < 0 {
        return Err(CoreError::InvalidInput(
            "expected_canvas_revision must be non-negative".to_owned(),
        ));
    }
    Ok(())
}

fn validated_saved_by(requested: Option<&str>) -> Result<String> {
    let value = requested
        .map(str::to_owned)
        .unwrap_or_else(default_client_identifier);
    validate_non_empty("saved_by", &value)?;
    Ok(value)
}

fn ensure_metadata_revision(actual: i64, expected: i64) -> Result<()> {
    if actual != expected {
        return Err(CoreError::RevisionConflict { expected, actual });
    }
    Ok(())
}

fn ensure_project_revision(connection: &Connection, expected: i64) -> Result<()> {
    let actual: i64 = connection.query_row(
        "SELECT revision FROM app_meta WHERE singleton = 1",
        [],
        |row| row.get(0),
    )?;
    ensure_metadata_revision(actual, expected)
}

fn ensure_canvas_revision(actual: i64, expected: i64) -> Result<()> {
    if actual != expected {
        return Err(CoreError::CanvasRevisionConflict { expected, actual });
    }
    Ok(())
}

fn ensure_stored_canvas_revision(
    connection: &Connection,
    project_id: &str,
    canvas_id: &str,
    expected: i64,
) -> Result<()> {
    let actual = connection
        .query_row(
            "SELECT revision FROM canvases WHERE id = ?1 AND project_id = ?2",
            params![canvas_id, project_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .ok_or_else(|| canvas_not_found(canvas_id))?;
    ensure_canvas_revision(actual, expected)
}

fn bump_project_revision(
    transaction: &Transaction<'_>,
    expected: i64,
    saved_by: &str,
    now: &str,
) -> Result<()> {
    let changed = transaction.execute(
        "UPDATE app_meta
         SET last_saved_by = ?1, updated_at = ?2, revision = revision + 1
         WHERE singleton = 1 AND revision = ?3",
        params![saved_by, now, expected],
    )?;
    if changed != 1 {
        ensure_project_revision(transaction, expected)?;
        return Err(CoreError::Integrity(
            "project revision update failed".to_owned(),
        ));
    }
    let project_id: String = transaction.query_row(
        "SELECT project_id FROM app_meta WHERE singleton = 1",
        [],
        |row| row.get(0),
    )?;
    transaction.execute(
        "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
        params![now, project_id],
    )?;
    Ok(())
}

fn canvas_not_found(canvas_id: &str) -> CoreError {
    CoreError::NotFound(format!("canvas id {canvas_id}"))
}

fn is_unique_constraint(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(code, _)
            if code.code == rusqlite::ErrorCode::ConstraintViolation
    )
}
