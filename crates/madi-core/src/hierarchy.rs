use std::path::PathBuf;
use std::str::FromStr;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use crate::error::{CoreError, Result};
use crate::model::{
    AppMeta, CreateTreeNodeParams, CreateTreeNodeResult, DeleteTreeNodeParams,
    DeleteTreeNodeResult, LoadProjectTreeParams, LoadSceneParams,
    LoadUiStateParams, LoadUiStateResult, MoveTreeNodeParams, NodeKind, ProjectRecord,
    ProjectTree, RenameTreeNodeParams, ReorderTreeNodeParams, SaveSceneParams,
    SaveSceneResult, SaveUiStateParams, SaveUiStateResult, SceneRecord,
    TreeMutationResult, TreeNode, UiStateRecord,
};
use crate::storage::{
    create_consistent_backup, database_timestamp, default_client_identifier,
    load_app_meta, load_document_record, load_document_summary, non_empty_or_generated,
    open_existing, sync_file, validate_editor_metadata, validate_non_empty,
};

const DEFAULT_EDITOR_ENGINE: &str = "typie";
const UNINITIALIZED_EDITOR_COMMIT: &str = "uninitialized";
const ORDER_STEP: f64 = 1024.0;
const MIN_ORDER_GAP: f64 = 0.000_001;

pub fn load_project_tree(params: LoadProjectTreeParams) -> Result<ProjectTree> {
    let connection = open_existing(&params.file_path)?;
    let tree = project_tree_from_connection(&connection)?;
    connection.close().map_err(|(_, error)| error)?;
    Ok(tree)
}

pub fn create_tree_node(params: CreateTreeNodeParams) -> Result<CreateTreeNodeResult> {
    validate_non_empty("parent_id", &params.parent_id)?;
    validate_non_empty("title", &params.title)?;
    validate_expected_revision(params.expected_revision)?;
    validate_position_request(
        params.before_node_id.as_deref(),
        params.after_node_id.as_deref(),
    )?;
    if params.kind == NodeKind::Work {
        return Err(CoreError::InvalidHierarchy {
            rule: "WORK is created only with its project",
        });
    }
    if params.kind != NodeKind::Scene
        && (params.document_id.is_some()
            || params.editor_engine.is_some()
            || params.editor_engine_commit.is_some()
            || params.editor_schema_version.is_some())
    {
        return Err(CoreError::InvalidInput(
            "document fields are allowed only for SCENE nodes".to_owned(),
        ));
    }

    let node_id = non_empty_or_generated("node_id", params.node_id.clone())?;
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let metadata_before = load_app_meta(&connection)?;
    let expected_revision =
        resolve_expected_revision(&metadata_before, params.expected_revision)?;
    let backup_file_path = create_consistent_backup(&connection, &params.file_path)?;

    let document_id = {
        let transaction =
            connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, expected_revision)?;
        ensure_identifier_available(&transaction, "tree node", "tree_nodes", &node_id)?;
        let parent = load_tree_node(&transaction, &params.parent_id)?;
        validate_parent_child(parent.kind, params.kind)?;
        let order_key = allocate_order_key(
            &transaction,
            &parent.project_id,
            &parent.id,
            None,
            params.before_node_id.as_deref(),
            params.after_node_id.as_deref(),
        )?;
        let now = database_timestamp(&transaction)?;

        let document_id = if params.kind == NodeKind::Scene {
            let document_id =
                non_empty_or_generated("document_id", params.document_id.clone())?;
            ensure_identifier_available(
                &transaction,
                "document",
                "documents",
                &document_id,
            )?;
            let editor_engine = params
                .editor_engine
                .as_deref()
                .unwrap_or(DEFAULT_EDITOR_ENGINE);
            let editor_engine_commit = params
                .editor_engine_commit
                .as_deref()
                .unwrap_or(UNINITIALIZED_EDITOR_COMMIT);
            let editor_schema_version = params.editor_schema_version.unwrap_or(0);
            validate_editor_metadata(
                editor_engine,
                editor_engine_commit,
                editor_schema_version,
            )?;
            transaction.execute(
                "INSERT INTO documents (
                    id, project_id, title, editor_engine, editor_engine_commit,
                    editor_schema_version, snapshot_blob, plain_text_recovery,
                    created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '', ?8, ?8)",
                params![
                    document_id,
                    parent.project_id,
                    params.title,
                    editor_engine,
                    editor_engine_commit,
                    editor_schema_version,
                    Vec::<u8>::new(),
                    now
                ],
            )?;
            Some(document_id)
        } else {
            None
        };

        transaction.execute(
            "INSERT INTO tree_nodes (
                id, project_id, parent_id, kind, title, order_key,
                document_id, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![
                node_id,
                parent.project_id,
                parent.id,
                params.kind.as_str(),
                params.title,
                order_key,
                document_id,
                now
            ],
        )?;
        bump_revision(&transaction, expected_revision, &saved_by, &now)?;
        transaction.commit()?;
        document_id
    };

    let node = load_tree_node(&connection, &node_id)?;
    let document = document_id
        .as_deref()
        .map(|id| load_document_summary(&connection, id))
        .transpose()?;
    let tree = project_tree_from_connection(&connection)?;
    let metadata = tree.metadata.clone();
    connection.close().map_err(|(_, error)| error)?;
    sync_file(&params.file_path)?;

    Ok(CreateTreeNodeResult {
        metadata,
        node,
        document,
        tree,
        backup_file_path,
    })
}

pub fn rename_tree_node(params: RenameTreeNodeParams) -> Result<TreeMutationResult> {
    validate_non_empty("node_id", &params.node_id)?;
    validate_non_empty("title", &params.title)?;
    validate_expected_revision(params.expected_revision)?;
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let metadata_before = load_app_meta(&connection)?;
    let expected_revision =
        resolve_expected_revision(&metadata_before, params.expected_revision)?;
    let backup_file_path = create_consistent_backup(&connection, &params.file_path)?;

    {
        let transaction =
            connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, expected_revision)?;
        let node = load_tree_node(&transaction, &params.node_id)?;
        let now = database_timestamp(&transaction)?;
        transaction.execute(
            "UPDATE tree_nodes SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![params.title, now, params.node_id],
        )?;
        if node.kind == NodeKind::Scene {
            let document_id = node.document_id.ok_or_else(|| {
                CoreError::Integrity("SCENE is missing its document link".to_owned())
            })?;
            transaction.execute(
                "UPDATE documents SET title = ?1, updated_at = ?2 WHERE id = ?3",
                params![params.title, now, document_id],
            )?;
        }
        if node.kind == NodeKind::Work {
            transaction.execute(
                "UPDATE projects SET title = ?1, updated_at = ?2 WHERE id = ?3",
                params![params.title, now, node.project_id],
            )?;
            transaction.execute(
                "UPDATE app_meta SET title = ?1 WHERE singleton = 1",
                [params.title.as_str()],
            )?;
        }
        bump_revision(&transaction, expected_revision, &saved_by, &now)?;
        transaction.commit()?;
    }

    finish_tree_mutation(
        connection,
        &params.file_path,
        &params.node_id,
        backup_file_path,
    )
}

pub fn move_tree_node(params: MoveTreeNodeParams) -> Result<TreeMutationResult> {
    validate_non_empty("node_id", &params.node_id)?;
    validate_non_empty("new_parent_id", &params.new_parent_id)?;
    validate_expected_revision(params.expected_revision)?;
    validate_position_request(
        params.before_node_id.as_deref(),
        params.after_node_id.as_deref(),
    )?;
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let metadata_before = load_app_meta(&connection)?;
    let expected_revision =
        resolve_expected_revision(&metadata_before, params.expected_revision)?;
    let backup_file_path = create_consistent_backup(&connection, &params.file_path)?;

    {
        let transaction =
            connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, expected_revision)?;
        let node = load_tree_node(&transaction, &params.node_id)?;
        if node.kind == NodeKind::Work {
            return Err(CoreError::WorkMutationForbidden { operation: "move" });
        }
        let parent = load_tree_node(&transaction, &params.new_parent_id)?;
        if node.project_id != parent.project_id {
            return Err(CoreError::InvalidHierarchy {
                rule: "a node cannot move to another project",
            });
        }
        validate_parent_child(parent.kind, node.kind)?;
        if node.id == parent.id || is_descendant(&transaction, &node.id, &parent.id)? {
            return Err(CoreError::InvalidHierarchy {
                rule: "a node cannot become a child of itself or its descendant",
            });
        }
        let order_key = allocate_order_key(
            &transaction,
            &node.project_id,
            &parent.id,
            Some(&node.id),
            params.before_node_id.as_deref(),
            params.after_node_id.as_deref(),
        )?;
        let now = database_timestamp(&transaction)?;
        transaction.execute(
            "UPDATE tree_nodes
             SET parent_id = ?1, order_key = ?2, updated_at = ?3
             WHERE id = ?4",
            params![parent.id, order_key, now, node.id],
        )?;
        bump_revision(&transaction, expected_revision, &saved_by, &now)?;
        transaction.commit()?;
    }

    finish_tree_mutation(
        connection,
        &params.file_path,
        &params.node_id,
        backup_file_path,
    )
}

pub fn reorder_tree_node(params: ReorderTreeNodeParams) -> Result<TreeMutationResult> {
    validate_non_empty("node_id", &params.node_id)?;
    validate_expected_revision(params.expected_revision)?;
    validate_position_request(
        params.before_node_id.as_deref(),
        params.after_node_id.as_deref(),
    )?;
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let metadata_before = load_app_meta(&connection)?;
    let expected_revision =
        resolve_expected_revision(&metadata_before, params.expected_revision)?;
    let backup_file_path = create_consistent_backup(&connection, &params.file_path)?;

    {
        let transaction =
            connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, expected_revision)?;
        let node = load_tree_node(&transaction, &params.node_id)?;
        if node.kind == NodeKind::Work {
            return Err(CoreError::WorkMutationForbidden {
                operation: "reorder",
            });
        }
        let parent_id = node.parent_id.as_deref().ok_or_else(|| {
            CoreError::Integrity("non-WORK node is missing its parent".to_owned())
        })?;
        let order_key = allocate_order_key(
            &transaction,
            &node.project_id,
            parent_id,
            Some(&node.id),
            params.before_node_id.as_deref(),
            params.after_node_id.as_deref(),
        )?;
        let now = database_timestamp(&transaction)?;
        transaction.execute(
            "UPDATE tree_nodes SET order_key = ?1, updated_at = ?2 WHERE id = ?3",
            params![order_key, now, node.id],
        )?;
        bump_revision(&transaction, expected_revision, &saved_by, &now)?;
        transaction.commit()?;
    }

    finish_tree_mutation(
        connection,
        &params.file_path,
        &params.node_id,
        backup_file_path,
    )
}

pub fn delete_tree_node(params: DeleteTreeNodeParams) -> Result<DeleteTreeNodeResult> {
    validate_non_empty("node_id", &params.node_id)?;
    validate_expected_revision(params.expected_revision)?;
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let metadata_before = load_app_meta(&connection)?;
    let expected_revision =
        resolve_expected_revision(&metadata_before, params.expected_revision)?;
    let backup_file_path = create_consistent_backup(&connection, &params.file_path)?;

    let (deleted_node_ids, deleted_document_ids) = {
        let transaction =
            connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, expected_revision)?;
        let node = load_tree_node(&transaction, &params.node_id)?;
        if node.kind == NodeKind::Work {
            return Err(CoreError::WorkMutationForbidden { operation: "delete" });
        }
        let subtree = load_subtree(&transaction, &node.id)?;
        if subtree.len() > 1 && !params.recursive {
            return Err(CoreError::RecursiveDeleteRequired {
                node_id: node.id,
            });
        }
        let deleted_node_ids = subtree
            .iter()
            .map(|entry| entry.0.clone())
            .collect::<Vec<_>>();
        let deleted_document_ids = subtree
            .iter()
            .filter_map(|entry| entry.1.clone())
            .collect::<Vec<_>>();
        transaction.execute("DELETE FROM tree_nodes WHERE id = ?1", [&params.node_id])?;
        for document_id in &deleted_document_ids {
            transaction.execute("DELETE FROM documents WHERE id = ?1", [document_id])?;
        }
        let now = database_timestamp(&transaction)?;
        bump_revision(&transaction, expected_revision, &saved_by, &now)?;
        transaction.commit()?;
        (deleted_node_ids, deleted_document_ids)
    };

    let tree = project_tree_from_connection(&connection)?;
    let metadata = tree.metadata.clone();
    connection.close().map_err(|(_, error)| error)?;
    sync_file(&params.file_path)?;
    Ok(DeleteTreeNodeResult {
        metadata,
        deleted_node_ids,
        deleted_document_ids,
        tree,
        backup_file_path,
    })
}

pub fn load_scene(params: LoadSceneParams) -> Result<SceneRecord> {
    validate_non_empty("scene_id", &params.scene_id)?;
    let connection = open_existing(&params.file_path)?;
    let scene = load_tree_node(&connection, &params.scene_id)?;
    ensure_scene(&scene)?;
    let document_id = scene.document_id.as_deref().ok_or_else(|| {
        CoreError::Integrity("SCENE is missing its document link".to_owned())
    })?;
    let document = load_document_record(&connection, document_id)?;
    let project_revision = load_app_meta(&connection)?.revision;
    connection.close().map_err(|(_, error)| error)?;
    Ok(SceneRecord {
        scene,
        document,
        project_revision,
    })
}

pub fn save_scene(params: SaveSceneParams) -> Result<SaveSceneResult> {
    validate_non_empty("scene_id", &params.scene_id)?;
    validate_editor_metadata(
        &params.editor_engine,
        &params.editor_engine_commit,
        params.editor_schema_version,
    )?;
    validate_expected_revision(params.expected_revision)?;
    let snapshot = BASE64_STANDARD
        .decode(params.snapshot_base64.as_bytes())
        .map_err(|_| {
            CoreError::InvalidInput(
                "snapshot_base64 is not valid standard base64".to_owned(),
            )
        })?;
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let metadata_before = load_app_meta(&connection)?;
    let expected_revision =
        resolve_expected_revision(&metadata_before, params.expected_revision)?;
    let backup_file_path = create_consistent_backup(&connection, &params.file_path)?;

    let document_id = {
        let transaction =
            connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, expected_revision)?;
        let scene = load_tree_node(&transaction, &params.scene_id)?;
        ensure_scene(&scene)?;
        let document_id = scene.document_id.ok_or_else(|| {
            CoreError::Integrity("SCENE is missing its document link".to_owned())
        })?;
        let now = database_timestamp(&transaction)?;
        let changed = transaction.execute(
            "UPDATE documents SET
                title = ?1,
                editor_engine = ?2,
                editor_engine_commit = ?3,
                editor_schema_version = ?4,
                snapshot_blob = ?5,
                plain_text_recovery = ?6,
                updated_at = ?7
             WHERE id = ?8",
            params![
                scene.title,
                params.editor_engine,
                params.editor_engine_commit,
                params.editor_schema_version,
                snapshot,
                params.plain_text_recovery,
                now,
                document_id
            ],
        )?;
        if changed != 1 {
            return Err(CoreError::Integrity(
                "SCENE document link does not resolve".to_owned(),
            ));
        }
        bump_revision(&transaction, expected_revision, &saved_by, &now)?;
        transaction.commit()?;
        document_id
    };

    let scene = load_tree_node(&connection, &params.scene_id)?;
    let document = load_document_summary(&connection, &document_id)?;
    let metadata = load_app_meta(&connection)?;
    connection.close().map_err(|(_, error)| error)?;
    sync_file(&params.file_path)?;
    Ok(SaveSceneResult {
        metadata,
        scene,
        document,
        backup_file_path,
    })
}

pub fn save_ui_state(params: SaveUiStateParams) -> Result<SaveUiStateResult> {
    validate_non_empty("key", &params.key)?;
    let value_json = serde_json::to_string(&params.value)?;
    let mut connection = open_existing(&params.file_path)?;
    let metadata = load_app_meta(&connection)?;
    let state = {
        let transaction =
            connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let now = database_timestamp(&transaction)?;
        transaction.execute(
            "INSERT INTO ui_state (project_id, key, value_json, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(project_id, key) DO UPDATE SET
                value_json = excluded.value_json,
                updated_at = excluded.updated_at",
            params![metadata.project_id, params.key, value_json, now],
        )?;
        transaction.commit()?;
        UiStateRecord {
            project_id: metadata.project_id.clone(),
            key: params.key,
            value: params.value,
            updated_at: now,
        }
    };
    connection.close().map_err(|(_, error)| error)?;
    sync_file(&params.file_path)?;
    Ok(SaveUiStateResult { metadata, state })
}

pub fn load_ui_state(params: LoadUiStateParams) -> Result<LoadUiStateResult> {
    validate_non_empty("key", &params.key)?;
    let connection = open_existing(&params.file_path)?;
    let metadata = load_app_meta(&connection)?;
    let stored = connection
        .query_row(
            "SELECT value_json, updated_at
             FROM ui_state WHERE project_id = ?1 AND key = ?2",
            params![metadata.project_id, params.key],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let state = stored
        .map(|(value_json, updated_at)| -> Result<UiStateRecord> {
            Ok(UiStateRecord {
                project_id: metadata.project_id.clone(),
                key: params.key.clone(),
                value: serde_json::from_str(&value_json)?,
                updated_at,
            })
        })
        .transpose()?;
    connection.close().map_err(|(_, error)| error)?;
    Ok(LoadUiStateResult { metadata, state })
}

fn finish_tree_mutation(
    connection: Connection,
    file_path: &PathBuf,
    node_id: &str,
    backup_file_path: PathBuf,
) -> Result<TreeMutationResult> {
    let node = load_tree_node(&connection, node_id)?;
    let tree = project_tree_from_connection(&connection)?;
    let metadata = tree.metadata.clone();
    connection.close().map_err(|(_, error)| error)?;
    sync_file(file_path)?;
    Ok(TreeMutationResult {
        metadata,
        node,
        tree,
        backup_file_path,
    })
}

fn project_tree_from_connection(connection: &Connection) -> Result<ProjectTree> {
    let metadata = load_app_meta(connection)?;
    let project = load_project_record(connection, &metadata.project_id)?;
    let nodes = load_tree_nodes(connection, &metadata.project_id)?;
    Ok(ProjectTree {
        metadata,
        project,
        nodes,
    })
}

fn load_project_record(connection: &Connection, project_id: &str) -> Result<ProjectRecord> {
    connection
        .query_row(
            "SELECT p.id, p.title, p.author_name, p.created_at, p.updated_at, n.id
             FROM projects p
             JOIN tree_nodes n ON n.project_id = p.id AND n.kind = 'WORK'
             WHERE p.id = ?1",
            [project_id],
            |row| {
                Ok(ProjectRecord {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    author_name: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                    work_node_id: row.get(5)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| {
            CoreError::Integrity(
                "project row or unique WORK root is missing".to_owned(),
            )
        })
}

fn load_tree_nodes(connection: &Connection, project_id: &str) -> Result<Vec<TreeNode>> {
    let stored = {
        let mut statement = connection.prepare(
            "SELECT id, project_id, parent_id, kind, title, order_key,
                    document_id, created_at, updated_at
             FROM tree_nodes
             WHERE project_id = ?1
             ORDER BY CASE kind WHEN 'WORK' THEN 0 ELSE 1 END,
                      COALESCE(parent_id, ''), order_key, id",
        )?;
        let rows = statement.query_map([project_id], stored_node_from_row)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()?
    };
    stored.into_iter().map(TreeNode::try_from).collect()
}

fn load_tree_node(connection: &Connection, node_id: &str) -> Result<TreeNode> {
    let stored = connection
        .query_row(
            "SELECT id, project_id, parent_id, kind, title, order_key,
                    document_id, created_at, updated_at
             FROM tree_nodes WHERE id = ?1",
            [node_id],
            stored_node_from_row,
        )
        .optional()?
        .ok_or_else(|| CoreError::NodeNotFound {
            node_id: node_id.to_owned(),
        })?;
    TreeNode::try_from(stored)
}

#[derive(Debug)]
struct StoredNode {
    id: String,
    project_id: String,
    parent_id: Option<String>,
    kind: String,
    title: String,
    order_key: f64,
    document_id: Option<String>,
    created_at: String,
    updated_at: String,
}

fn stored_node_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredNode> {
    Ok(StoredNode {
        id: row.get(0)?,
        project_id: row.get(1)?,
        parent_id: row.get(2)?,
        kind: row.get(3)?,
        title: row.get(4)?,
        order_key: row.get(5)?,
        document_id: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

impl TryFrom<StoredNode> for TreeNode {
    type Error = CoreError;

    fn try_from(stored: StoredNode) -> Result<Self> {
        let kind = NodeKind::from_str(&stored.kind).map_err(|_| {
            CoreError::Integrity("tree_nodes.kind is invalid".to_owned())
        })?;
        if !stored.order_key.is_finite() {
            return Err(CoreError::Integrity(
                "tree_nodes.order_key is not finite".to_owned(),
            ));
        }
        Ok(Self {
            id: stored.id,
            project_id: stored.project_id,
            parent_id: stored.parent_id,
            kind,
            title: stored.title,
            order_key: stored.order_key,
            document_id: stored.document_id,
            created_at: stored.created_at,
            updated_at: stored.updated_at,
        })
    }
}

fn validate_parent_child(parent: NodeKind, child: NodeKind) -> Result<()> {
    let allowed = matches!(
        (parent, child),
        (NodeKind::Work, NodeKind::Volume)
            | (NodeKind::Work, NodeKind::Chapter)
            | (NodeKind::Volume, NodeKind::Chapter)
            | (NodeKind::Chapter, NodeKind::Scene)
    );
    if !allowed {
        return Err(CoreError::InvalidHierarchy {
            rule: "allowed edges are WORK->VOLUME|CHAPTER, VOLUME->CHAPTER, CHAPTER->SCENE",
        });
    }
    Ok(())
}

fn ensure_scene(node: &TreeNode) -> Result<()> {
    if node.kind != NodeKind::Scene {
        return Err(CoreError::NodeKindMismatch {
            node_id: node.id.clone(),
            expected: "SCENE",
            actual: node.kind.to_string(),
        });
    }
    Ok(())
}

fn validate_expected_revision(expected_revision: Option<i64>) -> Result<()> {
    if expected_revision.is_some_and(|revision| revision < 0) {
        return Err(CoreError::InvalidInput(
            "expected_revision must be non-negative".to_owned(),
        ));
    }
    Ok(())
}

fn resolve_expected_revision(metadata: &AppMeta, requested: Option<i64>) -> Result<i64> {
    let expected = requested.unwrap_or(metadata.revision);
    if expected != metadata.revision {
        return Err(CoreError::RevisionConflict {
            expected,
            actual: metadata.revision,
        });
    }
    Ok(expected)
}

fn ensure_revision(transaction: &Transaction<'_>, expected: i64) -> Result<()> {
    let actual: i64 = transaction.query_row(
        "SELECT revision FROM app_meta WHERE singleton = 1",
        [],
        |row| row.get(0),
    )?;
    if actual != expected {
        return Err(CoreError::RevisionConflict { expected, actual });
    }
    Ok(())
}

fn bump_revision(
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
        let actual: i64 = transaction.query_row(
            "SELECT revision FROM app_meta WHERE singleton = 1",
            [],
            |row| row.get(0),
        )?;
        return Err(CoreError::RevisionConflict { expected, actual });
    }
    transaction.execute(
        "UPDATE projects SET updated_at = ?1
         WHERE id = (SELECT project_id FROM app_meta WHERE singleton = 1)",
        [now],
    )?;
    Ok(())
}

fn validated_saved_by(requested: Option<&str>) -> Result<String> {
    let value = requested
        .map(str::to_owned)
        .unwrap_or_else(default_client_identifier);
    validate_non_empty("saved_by", &value)?;
    Ok(value)
}

fn ensure_identifier_available(
    transaction: &Transaction<'_>,
    entity: &'static str,
    table: &'static str,
    id: &str,
) -> Result<()> {
    let sql = match table {
        "tree_nodes" => "SELECT 1 FROM tree_nodes WHERE id = ?1",
        "documents" => "SELECT 1 FROM documents WHERE id = ?1",
        _ => {
            return Err(CoreError::Integrity(
                "unsupported identifier namespace".to_owned(),
            ))
        }
    };
    let exists = transaction
        .query_row(sql, [id], |_| Ok(()))
        .optional()?
        .is_some();
    if exists {
        return Err(CoreError::IdentifierConflict {
            entity,
            id: id.to_owned(),
        });
    }
    Ok(())
}

fn validate_position_request(before: Option<&str>, after: Option<&str>) -> Result<()> {
    if before.is_some() && after.is_some() {
        return Err(CoreError::InvalidTreePosition {
            reason: "before_node_id and after_node_id are mutually exclusive",
        });
    }
    if let Some(id) = before {
        validate_non_empty("before_node_id", id)?;
    }
    if let Some(id) = after {
        validate_non_empty("after_node_id", id)?;
    }
    Ok(())
}

fn allocate_order_key(
    transaction: &Transaction<'_>,
    project_id: &str,
    parent_id: &str,
    exclude_node_id: Option<&str>,
    before_node_id: Option<&str>,
    after_node_id: Option<&str>,
) -> Result<f64> {
    let mut siblings = load_sibling_order(
        transaction,
        project_id,
        parent_id,
        exclude_node_id,
    )?;
    let mut insertion_index = position_index(&siblings, before_node_id, after_node_id)?;
    let mut order_key = midpoint_for_index(&siblings, insertion_index);
    if !order_key.is_finite()
        || has_exhausted_gap(&siblings, insertion_index)
    {
        rebalance_siblings(transaction, project_id, parent_id, exclude_node_id)?;
        siblings = load_sibling_order(
            transaction,
            project_id,
            parent_id,
            exclude_node_id,
        )?;
        insertion_index = position_index(&siblings, before_node_id, after_node_id)?;
        order_key = midpoint_for_index(&siblings, insertion_index);
    }
    if !order_key.is_finite() {
        return Err(CoreError::InvalidTreePosition {
            reason: "a finite order key could not be allocated",
        });
    }
    Ok(order_key)
}

fn load_sibling_order(
    transaction: &Transaction<'_>,
    project_id: &str,
    parent_id: &str,
    exclude_node_id: Option<&str>,
) -> Result<Vec<(String, f64)>> {
    let mut statement = transaction.prepare(
        "SELECT id, order_key FROM tree_nodes
         WHERE project_id = ?1 AND parent_id = ?2
           AND (?3 IS NULL OR id <> ?3)
         ORDER BY order_key, id",
    )?;
    let rows = statement.query_map(
        params![project_id, parent_id, exclude_node_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

fn position_index(
    siblings: &[(String, f64)],
    before_node_id: Option<&str>,
    after_node_id: Option<&str>,
) -> Result<usize> {
    if let Some(before) = before_node_id {
        return siblings
            .iter()
            .position(|entry| entry.0 == before)
            .ok_or(CoreError::InvalidTreePosition {
                reason: "before_node_id must name a sibling",
            });
    }
    if let Some(after) = after_node_id {
        return siblings
            .iter()
            .position(|entry| entry.0 == after)
            .map(|index| index + 1)
            .ok_or(CoreError::InvalidTreePosition {
                reason: "after_node_id must name a sibling",
            });
    }
    Ok(siblings.len())
}

fn midpoint_for_index(siblings: &[(String, f64)], index: usize) -> f64 {
    match (index.checked_sub(1), siblings.get(index)) {
        (Some(left), Some(right)) => (siblings[left].1 + right.1) / 2.0,
        (None, Some(right)) => right.1 - ORDER_STEP,
        (Some(left), None) => siblings[left].1 + ORDER_STEP,
        (None, None) => ORDER_STEP,
    }
}

fn has_exhausted_gap(siblings: &[(String, f64)], index: usize) -> bool {
    match (index.checked_sub(1), siblings.get(index)) {
        (Some(left), Some(right)) => {
            right.1 - siblings[left].1 <= MIN_ORDER_GAP
        }
        _ => false,
    }
}

fn rebalance_siblings(
    transaction: &Transaction<'_>,
    project_id: &str,
    parent_id: &str,
    exclude_node_id: Option<&str>,
) -> Result<()> {
    transaction.execute_batch("DROP INDEX tree_nodes_sibling_order;")?;
    if let Some(excluded) = exclude_node_id {
        transaction.execute(
            "UPDATE tree_nodes SET order_key = ?1
             WHERE id = ?2 AND project_id = ?3 AND parent_id = ?4",
            params![-ORDER_STEP, excluded, project_id, parent_id],
        )?;
    }
    let sibling_ids = {
        let mut statement = transaction.prepare(
            "SELECT id FROM tree_nodes
             WHERE project_id = ?1 AND parent_id = ?2
               AND (?3 IS NULL OR id <> ?3)
             ORDER BY order_key, id",
        )?;
        let rows = statement.query_map(
            params![project_id, parent_id, exclude_node_id],
            |row| row.get::<_, String>(0),
        )?;
        rows.collect::<std::result::Result<Vec<_>, _>>()?
    };
    for (index, sibling_id) in sibling_ids.iter().enumerate() {
        transaction.execute(
            "UPDATE tree_nodes SET order_key = ?1 WHERE id = ?2",
            params![(index as f64 + 1.0) * ORDER_STEP, sibling_id],
        )?;
    }
    transaction.execute_batch(
        "CREATE UNIQUE INDEX tree_nodes_sibling_order
         ON tree_nodes(project_id, COALESCE(parent_id, ''), order_key);",
    )?;
    Ok(())
}

fn is_descendant(
    transaction: &Transaction<'_>,
    node_id: &str,
    candidate_id: &str,
) -> Result<bool> {
    let found: i64 = transaction.query_row(
        "WITH RECURSIVE descendants(id) AS (
            SELECT id FROM tree_nodes WHERE parent_id = ?1
            UNION ALL
            SELECT child.id FROM tree_nodes child
            JOIN descendants parent ON child.parent_id = parent.id
         )
         SELECT EXISTS(SELECT 1 FROM descendants WHERE id = ?2)",
        params![node_id, candidate_id],
        |row| row.get(0),
    )?;
    Ok(found != 0)
}

fn load_subtree(
    transaction: &Transaction<'_>,
    node_id: &str,
) -> Result<Vec<(String, Option<String>)>> {
    let mut statement = transaction.prepare(
        "WITH RECURSIVE subtree(id, document_id, depth) AS (
            SELECT id, document_id, 0 FROM tree_nodes WHERE id = ?1
            UNION ALL
            SELECT child.id, child.document_id, parent.depth + 1
            FROM tree_nodes child
            JOIN subtree parent ON child.parent_id = parent.id
         )
         SELECT id, document_id FROM subtree ORDER BY depth DESC, id",
    )?;
    let rows = statement.query_map([node_id], |row| Ok((row.get(0)?, row.get(1)?)))?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}
