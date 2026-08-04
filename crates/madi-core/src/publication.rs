use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;
use std::str::FromStr;
use std::time::Instant;

use madi_publication::{
    canonical_publication_document, compile_publication, validate_publication_document,
    CompileInput, HeadingInput, PublicationDiagnostic, PublicationDiagnosticCode,
    PublicationDiagnosticSeverity, PublicationDocument, PublicationScopeKind,
    PublicationSourceStatistics, SceneInput, PINNED_TYPIE_COMMIT, SUPPORTED_TYPIE_SCHEMA_VERSION,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::error::{CoreError, Result};
use crate::model::{AppMeta, NodeKind};
use crate::storage::{load_app_meta, open_existing, validate_non_empty};

const SUPPORTED_EDITOR_ENGINE: &str = "typie";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CompilePublicationParams {
    #[serde(alias = "path")]
    pub file_path: PathBuf,
    pub scope_node_id: String,
    pub expected_revision: i64,
}

pub type GetPublicationStatsParams = CompilePublicationParams;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CorePublicationDiagnosticCode {
    UnsupportedBlock,
    UnsupportedInlineModifier,
    InvalidSemanticDocument,
    EmptyScope,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CorePublicationDiagnosticSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CorePublicationDiagnostic {
    pub code: CorePublicationDiagnosticCode,
    pub severity: CorePublicationDiagnosticSeverity,
    pub scene_node_id: Option<String>,
    pub document_id: Option<String>,
    pub block_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CompilePublicationResult {
    pub metadata: AppMeta,
    pub document: PublicationDocument,
    pub content_hash: String,
    pub diagnostics: Vec<CorePublicationDiagnostic>,
    pub compile_timing_ms: f64,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PublicationStatsResult {
    pub metadata: AppMeta,
    pub stats: PublicationSourceStatistics,
    pub content_hash: String,
    pub diagnostics: Vec<CorePublicationDiagnostic>,
    pub compile_timing_ms: f64,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ValidatePublicationParams {
    pub document: PublicationDocument,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ValidatePublicationResult {
    pub valid: bool,
    pub content_hash: String,
    pub diagnostics: Vec<CorePublicationDiagnostic>,
}

#[derive(Debug, Clone)]
struct StoredTreeNode {
    id: String,
    parent_id: Option<String>,
    kind: NodeKind,
    title: String,
    order_key: f64,
    document_id: Option<String>,
}

#[derive(Debug, Clone)]
struct StoredDocument {
    id: String,
    editor_engine: String,
    editor_engine_commit: String,
    editor_schema_version: i64,
    snapshot: Vec<u8>,
}

pub fn compile_publication_scope(
    params: CompilePublicationParams,
) -> Result<CompilePublicationResult> {
    let started = Instant::now();
    let connection = open_existing(&params.file_path)?;
    let metadata = load_app_meta(&connection)?;
    ensure_revision(&metadata, params.expected_revision)?;
    let input = load_compile_input(&connection, &metadata, &params.scope_node_id)?;
    let output = compile_publication(input)?;
    let revision = metadata.revision;
    connection.close().map_err(|(_, error)| error)?;
    Ok(CompilePublicationResult {
        metadata,
        document: output.document,
        content_hash: output.content_hash,
        diagnostics: output
            .diagnostics
            .into_iter()
            .map(CorePublicationDiagnostic::from)
            .collect(),
        compile_timing_ms: started.elapsed().as_secs_f64() * 1_000.0,
        revision,
    })
}

pub fn get_publication_stats(params: GetPublicationStatsParams) -> Result<PublicationStatsResult> {
    let compiled = compile_publication_scope(params)?;
    Ok(PublicationStatsResult {
        metadata: compiled.metadata,
        stats: compiled.document.stats,
        content_hash: compiled.content_hash,
        diagnostics: compiled.diagnostics,
        compile_timing_ms: compiled.compile_timing_ms,
        revision: compiled.revision,
    })
}

pub fn validate_publication(
    params: ValidatePublicationParams,
) -> Result<ValidatePublicationResult> {
    let content_hash = publication_value_hash(&params.document)?;
    match validate_publication_document(&params.document) {
        Ok(()) => {
            let canonical = canonical_publication_document(&params.document)?;
            let canonical_hash = format!("{:x}", Sha256::digest(canonical.as_bytes()));
            Ok(ValidatePublicationResult {
                valid: true,
                content_hash: canonical_hash,
                diagnostics: Vec::new(),
            })
        }
        Err(_) => Ok(ValidatePublicationResult {
            valid: false,
            content_hash,
            diagnostics: vec![CorePublicationDiagnostic {
                code: CorePublicationDiagnosticCode::InvalidSemanticDocument,
                severity: CorePublicationDiagnosticSeverity::Error,
                scene_node_id: None,
                document_id: None,
                block_id: None,
            }],
        }),
    }
}

fn load_compile_input(
    connection: &Connection,
    metadata: &AppMeta,
    scope_node_id: &str,
) -> Result<CompileInput> {
    validate_non_empty("scope_node_id", scope_node_id)?;
    let (project_title, author_name): (String, Option<String>) = connection
        .query_row(
            "SELECT title, author_name FROM projects WHERE id = ?1",
            [&metadata.project_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| CoreError::Integrity("project row is missing".to_owned()))?;
    let nodes = load_tree_nodes(connection, &metadata.project_id)?;
    let by_id: HashMap<_, _> = nodes.iter().map(|node| (node.id.as_str(), node)).collect();
    let scope = by_id
        .get(scope_node_id)
        .copied()
        .ok_or_else(|| CoreError::NodeNotFound {
            node_id: scope_node_id.to_owned(),
        })?;
    let mut children: HashMap<Option<&str>, Vec<&StoredTreeNode>> = HashMap::new();
    for node in &nodes {
        children
            .entry(node.parent_id.as_deref())
            .or_default()
            .push(node);
    }
    for values in children.values_mut() {
        values.sort_by(|left, right| {
            left.order_key
                .total_cmp(&right.order_key)
                .then_with(|| left.id.cmp(&right.id))
        });
    }
    let mut scene_nodes = Vec::new();
    collect_scene_nodes(scope, &children, &mut scene_nodes)?;
    let mut seen_heading_nodes = HashSet::new();
    let mut chapter_nodes = HashSet::new();
    let mut scenes = Vec::with_capacity(scene_nodes.len());
    for scene in scene_nodes {
        let document_id = scene
            .document_id
            .as_deref()
            .ok_or_else(|| CoreError::Integrity("SCENE is missing its document id".to_owned()))?;
        let document = load_stored_document(connection, &metadata.project_id, document_id)?;
        validate_document_identity(&document)?;
        let path = ancestor_path(scene, &by_id)?;
        let mut headings = Vec::new();
        let mut parent_titles = Vec::new();
        for node in &path {
            if node.kind != NodeKind::Scene {
                parent_titles.push(node.title.clone());
            }
            if node.kind == NodeKind::Chapter {
                chapter_nodes.insert(node.id.clone());
            }
            if seen_heading_nodes.insert(node.id.clone()) {
                headings.push(HeadingInput {
                    source_node_id: node.id.clone(),
                    level: heading_level(node.kind),
                    text: node.title.clone(),
                });
            }
        }
        scenes.push(SceneInput {
            scene_node_id: scene.id.clone(),
            document_id: document.id,
            title: scene.title.clone(),
            parent_titles,
            headings,
            snapshot: document.snapshot,
        });
    }
    Ok(CompileInput {
        project_id: metadata.project_id.clone(),
        project_revision: metadata.revision,
        scope_node_id: scope.id.clone(),
        scope_kind: scope_kind(scope.kind),
        title: project_title,
        author_name,
        chapter_count: chapter_nodes.len() as u64,
        scenes,
    })
}

fn load_tree_nodes(connection: &Connection, project_id: &str) -> Result<Vec<StoredTreeNode>> {
    let mut statement = connection.prepare(
        "SELECT id, parent_id, kind, title, order_key, document_id
         FROM tree_nodes WHERE project_id = ?1",
    )?;
    let rows = statement.query_map([project_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, f64>(4)?,
            row.get::<_, Option<String>>(5)?,
        ))
    })?;
    let mut nodes = Vec::new();
    for row in rows {
        let (id, parent_id, kind, title, order_key, document_id) = row?;
        if !order_key.is_finite() {
            return Err(CoreError::Integrity(
                "tree order key is not finite".to_owned(),
            ));
        }
        nodes.push(StoredTreeNode {
            id,
            parent_id,
            kind: NodeKind::from_str(&kind)
                .map_err(|_| CoreError::Integrity("tree kind is invalid".to_owned()))?,
            title,
            order_key,
            document_id,
        });
    }
    Ok(nodes)
}

fn collect_scene_nodes<'a>(
    node: &'a StoredTreeNode,
    children: &HashMap<Option<&'a str>, Vec<&'a StoredTreeNode>>,
    output: &mut Vec<&'a StoredTreeNode>,
) -> Result<()> {
    if node.kind == NodeKind::Scene {
        output.push(node);
        return Ok(());
    }
    if let Some(descendants) = children.get(&Some(node.id.as_str())) {
        for child in descendants {
            collect_scene_nodes(child, children, output)?;
        }
    }
    Ok(())
}

fn ancestor_path<'a>(
    scene: &'a StoredTreeNode,
    by_id: &HashMap<&str, &'a StoredTreeNode>,
) -> Result<Vec<&'a StoredTreeNode>> {
    let mut path = vec![scene];
    let mut current = scene;
    let mut visited = HashSet::new();
    visited.insert(scene.id.as_str());
    while let Some(parent_id) = current.parent_id.as_deref() {
        let parent = by_id
            .get(parent_id)
            .copied()
            .ok_or_else(|| CoreError::Integrity("tree node parent is missing".to_owned()))?;
        if !visited.insert(parent.id.as_str()) {
            return Err(CoreError::Integrity(
                "tree hierarchy contains a cycle".to_owned(),
            ));
        }
        path.push(parent);
        current = parent;
    }
    path.reverse();
    if path.first().is_none_or(|node| node.kind != NodeKind::Work) {
        return Err(CoreError::Integrity(
            "scene ancestry does not begin at WORK".to_owned(),
        ));
    }
    Ok(path)
}

fn load_stored_document(
    connection: &Connection,
    project_id: &str,
    document_id: &str,
) -> Result<StoredDocument> {
    connection
        .query_row(
            "SELECT id, editor_engine, editor_engine_commit, editor_schema_version, snapshot_blob
             FROM documents WHERE id = ?1 AND project_id = ?2",
            params![document_id, project_id],
            |row| {
                Ok(StoredDocument {
                    id: row.get(0)?,
                    editor_engine: row.get(1)?,
                    editor_engine_commit: row.get(2)?,
                    editor_schema_version: row.get(3)?,
                    snapshot: row.get(4)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("document id {document_id}")))
}

fn validate_document_identity(document: &StoredDocument) -> Result<()> {
    if document.editor_engine != SUPPORTED_EDITOR_ENGINE
        || document.editor_engine_commit != PINNED_TYPIE_COMMIT
        || document.editor_schema_version != SUPPORTED_TYPIE_SCHEMA_VERSION
    {
        return Err(CoreError::InvalidInput(
            "publication compilation requires the pinned Typie engine and schema".to_owned(),
        ));
    }
    Ok(())
}

fn heading_level(kind: NodeKind) -> u8 {
    match kind {
        NodeKind::Work => 1,
        NodeKind::Volume => 2,
        NodeKind::Chapter => 3,
        NodeKind::Scene => 4,
    }
}

fn scope_kind(kind: NodeKind) -> PublicationScopeKind {
    match kind {
        NodeKind::Work => PublicationScopeKind::Work,
        NodeKind::Volume => PublicationScopeKind::Volume,
        NodeKind::Chapter => PublicationScopeKind::Chapter,
        NodeKind::Scene => PublicationScopeKind::Scene,
    }
}

fn ensure_revision(metadata: &AppMeta, expected: i64) -> Result<()> {
    if expected < 0 {
        return Err(CoreError::InvalidInput(
            "expected_revision must be non-negative".to_owned(),
        ));
    }
    if metadata.revision != expected {
        return Err(CoreError::RevisionConflict {
            expected,
            actual: metadata.revision,
        });
    }
    Ok(())
}

fn publication_value_hash(document: &PublicationDocument) -> Result<String> {
    let value = canonical_value(serde_json::to_value(document)?);
    let json = serde_json::to_string(&value)?;
    Ok(format!("{:x}", Sha256::digest(json.as_bytes())))
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

impl From<PublicationDiagnostic> for CorePublicationDiagnostic {
    fn from(value: PublicationDiagnostic) -> Self {
        Self {
            code: match value.code {
                PublicationDiagnosticCode::UnsupportedBlock => {
                    CorePublicationDiagnosticCode::UnsupportedBlock
                }
                PublicationDiagnosticCode::UnsupportedInlineModifier => {
                    CorePublicationDiagnosticCode::UnsupportedInlineModifier
                }
                PublicationDiagnosticCode::InvalidSemanticDocument => {
                    CorePublicationDiagnosticCode::InvalidSemanticDocument
                }
                PublicationDiagnosticCode::EmptyScope => CorePublicationDiagnosticCode::EmptyScope,
            },
            severity: match value.severity {
                PublicationDiagnosticSeverity::Info => CorePublicationDiagnosticSeverity::Info,
                PublicationDiagnosticSeverity::Warning => {
                    CorePublicationDiagnosticSeverity::Warning
                }
                PublicationDiagnosticSeverity::Error => CorePublicationDiagnosticSeverity::Error,
            },
            scene_node_id: value.scene_node_id,
            document_id: value.document_id,
            block_id: value.block_id,
        }
    }
}
