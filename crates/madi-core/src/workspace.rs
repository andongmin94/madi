use std::collections::{HashMap, HashSet};
use std::str::FromStr;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::{CoreError, Result};
use crate::model::{
    AppMeta, ApplyReplacementBatchParams, ApplyReplacementBatchResult,
    CreateNamedSnapshotParams, CreateNamedSnapshotResult, DeleteNamedSnapshotParams,
    DeleteNamedSnapshotResult, DiffNamedSnapshotParams, DiffNamedSnapshotResult,
    GetTextStatisticsParams, ListDescendantScenesParams,
    ListDescendantScenesResult, ListNamedSnapshotsParams, ListNamedSnapshotsResult,
    NamedSnapshotKind, NamedSnapshotSummary, NodeKind, RenameNamedSnapshotParams,
    RenameNamedSnapshotResult, RestoreNamedSnapshotParams,
    RestoreNamedSnapshotResult, SceneDocumentPreview, SceneTextStatistics,
    SceneWorkspaceRecord, SearchField, SearchHit, SearchProjectParams,
    SearchProjectResult, SearchTarget,
    SnapshotDiffSummary, SnapshotNodeCounts, TextStatisticsResult, TransformedSceneDocument,
    TreeNode,
};
use crate::storage::{
    create_consistent_backup, database_timestamp, default_client_identifier,
    load_app_meta, open_existing, sync_file, validate_editor_metadata,
    validate_non_empty,
};

const SNAPSHOT_PAYLOAD_FORMAT: &str = "MADI_LOGICAL_JSON";
const SNAPSHOT_PAYLOAD_VERSION: i64 = 1;
const SNAPSHOT_DOCUMENT_FORMAT: &str = "madi.logical-snapshot";
const SNAPSHOT_UI_STATE_KEY: &str = "workspace.v1";
const SEARCH_CONTEXT_CHARS: usize = 32;
const DEFAULT_SEARCH_LIMIT: u64 = 1_000;
const MAX_SEARCH_LIMIT: u64 = 5_000;
const DEFAULT_DESCENDANT_LIMIT: u64 = 1_000;
const MAX_DESCENDANT_LIMIT: u64 = 1_000;
const MAX_DESCENDANT_ENCODED_TEXT_BYTES: usize = 64 * 1024 * 1024;

pub fn list_descendant_scenes(
    params: ListDescendantScenesParams,
) -> Result<ListDescendantScenesResult> {
    validate_non_empty("scope_node_id", &params.scope_node_id)?;
    let limit = params.limit.unwrap_or(DEFAULT_DESCENDANT_LIMIT);
    if limit == 0 || limit > MAX_DESCENDANT_LIMIT {
        return Err(CoreError::InvalidInput(format!(
            "descendant scene limit must be between 1 and {MAX_DESCENDANT_LIMIT}"
        )));
    }
    let mut connection = open_existing(&params.file_path)?;
    let result = {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
        let metadata = load_app_meta(&transaction)?;
        let (scope, nodes) =
            ordered_subtree(&transaction, &metadata.project_id, &params.scope_node_id)?;
        let scene_nodes = nodes
            .into_iter()
            .filter(|node| node.kind == NodeKind::Scene)
            .collect::<Vec<_>>();
        let total_scenes = scene_nodes.len() as u64;
        let mut scenes = Vec::new();
        let mut text_bytes = 0_usize;
        for scene in scene_nodes
            .into_iter()
            .skip(params.offset.min(usize::MAX as u64) as usize)
            .take(limit as usize)
        {
            let document_id = scene.document_id.as_deref().ok_or_else(|| {
                CoreError::Integrity("SCENE is missing its document link".to_owned())
            })?;
            let stored = transaction
                .query_row(
                    "SELECT id, project_id, title, plain_text_recovery, updated_at
                     FROM documents WHERE id = ?1",
                    [document_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                        ))
                    },
                )
                .optional()?
                .ok_or_else(|| {
                    CoreError::Integrity(format!("document {document_id} is missing"))
                })?;
            let next_text_bytes =
                text_bytes.saturating_add(estimated_json_string_bytes(&stored.3));
            if next_text_bytes > MAX_DESCENDANT_ENCODED_TEXT_BYTES {
                if scenes.is_empty() {
                    return Err(CoreError::InvalidInput(format!(
                        "scene {document_id} recovery text exceeds the Scrivenings preview response limit"
                    )));
                }
                break;
            }
            text_bytes = next_text_bytes;
            scenes.push(SceneWorkspaceRecord {
                document: SceneDocumentPreview {
                    id: stored.0,
                    project_id: stored.1,
                    title: stored.2,
                    source_content_hash: hash_plain_text(&stored.3),
                    plain_text_recovery: stored.3,
                    updated_at: stored.4,
                },
                scene,
            });
        }
        let returned_end = params.offset.saturating_add(scenes.len() as u64);
        let has_more = returned_end < total_scenes;
        transaction.commit()?;
        ListDescendantScenesResult {
            metadata,
            scope,
            scenes,
            total_scenes,
            offset: params.offset,
            limit,
            next_offset: has_more.then_some(returned_end),
            has_more,
        }
    };
    connection.close().map_err(|(_, error)| error)?;
    Ok(result)
}

pub fn search_project(params: SearchProjectParams) -> Result<SearchProjectResult> {
    validate_non_empty("query", &params.query)?;
    let limit = params.limit.unwrap_or(DEFAULT_SEARCH_LIMIT);
    if limit == 0 || limit > MAX_SEARCH_LIMIT {
        return Err(CoreError::InvalidInput(format!(
            "search limit must be between 1 and {MAX_SEARCH_LIMIT}"
        )));
    }
    let mut connection = open_existing(&params.file_path)?;
    let result = {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
        let metadata = load_app_meta(&transaction)?;
        let scope_node_id = resolve_scope_node_id(
            &transaction,
            &metadata.project_id,
            params.scope_node_id.as_deref(),
        )?;
        let (_, nodes) = ordered_subtree(&transaction, &metadata.project_id, &scope_node_id)?;
        let mut accumulator = SearchAccumulator::new(params.offset, limit);

        if matches!(params.target, SearchTarget::Titles | SearchTarget::All) {
            for node in &nodes {
                accumulator.add_text(
                    node,
                    None,
                    SearchField::Title,
                    &node.title,
                    &params.query,
                    params.case_sensitive,
                    None,
                );
            }
        }

        if matches!(params.target, SearchTarget::Bodies | SearchTarget::All) {
            for node in nodes.iter().filter(|node| node.kind == NodeKind::Scene) {
                let document_id = node.document_id.as_deref().ok_or_else(|| {
                    CoreError::Integrity("SCENE is missing its document link".to_owned())
                })?;
                let plain_text = transaction
                    .query_row(
                        "SELECT plain_text FROM search_documents WHERE document_id = ?1",
                        [document_id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?
                    .ok_or_else(|| {
                        CoreError::Integrity(format!(
                            "search projection is missing document {document_id}"
                        ))
                    })?;
                let source_content_hash = hash_plain_text(&plain_text);
                accumulator.add_text(
                    node,
                    Some(document_id),
                    SearchField::Body,
                    &plain_text,
                    &params.query,
                    params.case_sensitive,
                    Some(&source_content_hash),
                );
            }
        }

        let total_matches = accumulator.total_matches;
        let scene_count = accumulator.matched_scene_ids.len() as u64;
        let has_more = total_matches
            > params
                .offset
                .saturating_add(accumulator.hits.len() as u64);
        let hits = accumulator.hits;
        transaction.commit()?;
        SearchProjectResult {
            metadata,
            query: params.query,
            case_sensitive: params.case_sensitive,
            target: params.target,
            scope_node_id,
            total_matches,
            scene_count,
            offset: params.offset,
            limit,
            has_more,
            hits,
        }
    };
    connection.close().map_err(|(_, error)| error)?;
    Ok(result)
}

pub fn get_text_statistics(params: GetTextStatisticsParams) -> Result<TextStatisticsResult> {
    let mut connection = open_existing(&params.file_path)?;
    let result = {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
        let metadata = load_app_meta(&transaction)?;
        let scope_node_id = resolve_scope_node_id(
            &transaction,
            &metadata.project_id,
            params.scope_node_id.as_deref(),
        )?;
        let (_, nodes) = ordered_subtree(&transaction, &metadata.project_id, &scope_node_id)?;
        let mut scenes = Vec::new();
        let mut with_spaces = 0_u64;
        let mut without_spaces = 0_u64;
        for scene in nodes.into_iter().filter(|node| node.kind == NodeKind::Scene) {
            let document_id = scene.document_id.ok_or_else(|| {
                CoreError::Integrity("SCENE is missing its document link".to_owned())
            })?;
            let plain_text: String = transaction.query_row(
                "SELECT plain_text FROM search_documents WHERE document_id = ?1",
                [&document_id],
                |row| row.get(0),
            )?;
            let scene_with_spaces = plain_text.chars().count() as u64;
            let scene_without_spaces = plain_text
                .chars()
                .filter(|character| !character.is_whitespace())
                .count() as u64;
            with_spaces += scene_with_spaces;
            without_spaces += scene_without_spaces;
            scenes.push(SceneTextStatistics {
                scene_id: scene.id,
                document_id,
                with_spaces: scene_with_spaces,
                without_spaces: scene_without_spaces,
            });
        }
        let scene_count = scenes.len() as u64;
        transaction.commit()?;
        TextStatisticsResult {
            metadata,
            scope_node_id,
            scene_count,
            with_spaces,
            without_spaces,
            scenes,
        }
    };
    connection.close().map_err(|(_, error)| error)?;
    Ok(result)
}

pub fn create_named_snapshot(
    params: CreateNamedSnapshotParams,
) -> Result<CreateNamedSnapshotResult> {
    validate_snapshot_name_and_note(&params.name, params.note.as_deref())?;
    if params.kind != NamedSnapshotKind::Manual {
        return Err(CoreError::InvalidInput(
            "automatic snapshot kinds are reserved for core safety operations".to_owned(),
        ));
    }
    validate_optional_revision(params.expected_revision)?;
    let snapshot_id = params
        .snapshot_id
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    validate_non_empty("snapshot_id", &snapshot_id)?;
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let before = load_app_meta(&connection)?;
    let expected_revision = resolve_expected_revision(&before, params.expected_revision)?;
    let backup_file_path = create_consistent_backup(&connection, &params.file_path)?;
    {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, expected_revision)?;
        let identifier_exists: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM named_snapshots WHERE id = ?1)",
            [&snapshot_id],
            |row| row.get(0),
        )?;
        if identifier_exists {
            return Err(CoreError::IdentifierConflict {
                entity: "named snapshot",
                id: snapshot_id,
            });
        }
        let now = database_timestamp(&transaction)?;
        insert_snapshot(
            &transaction,
            &snapshot_id,
            &params.name,
            params.note.as_deref(),
            params.kind,
            &now,
        )?;
        bump_revision(&transaction, expected_revision, &saved_by, &now)?;
        transaction.commit()?;
    }
    let snapshot = load_snapshot_summary(&connection, &snapshot_id)?;
    let metadata = load_app_meta(&connection)?;
    connection.close().map_err(|(_, error)| error)?;
    sync_file(&params.file_path)?;
    Ok(CreateNamedSnapshotResult {
        metadata,
        snapshot,
        backup_file_path,
    })
}

pub fn list_named_snapshots(
    params: ListNamedSnapshotsParams,
) -> Result<ListNamedSnapshotsResult> {
    let mut connection = open_existing(&params.file_path)?;
    let result = {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
        let metadata = load_app_meta(&transaction)?;
        let snapshots = load_snapshot_summaries(&transaction, &metadata.project_id)?;
        transaction.commit()?;
        ListNamedSnapshotsResult { metadata, snapshots }
    };
    connection.close().map_err(|(_, error)| error)?;
    Ok(result)
}

pub fn rename_named_snapshot(
    params: RenameNamedSnapshotParams,
) -> Result<RenameNamedSnapshotResult> {
    validate_non_empty("snapshot_id", &params.snapshot_id)?;
    validate_non_empty("name", &params.name)?;
    validate_optional_revision(params.expected_revision)?;
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let before = load_app_meta(&connection)?;
    let expected_revision = resolve_expected_revision(&before, params.expected_revision)?;
    let backup_file_path = create_consistent_backup(&connection, &params.file_path)?;
    {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, expected_revision)?;
        let now = database_timestamp(&transaction)?;
        let changed = transaction.execute(
            "UPDATE named_snapshots SET name = ?1, updated_at = ?2
             WHERE id = ?3 AND project_id = ?4",
            params![params.name, now, params.snapshot_id, before.project_id],
        )?;
        if changed != 1 {
            return Err(snapshot_not_found(&params.snapshot_id));
        }
        bump_revision(&transaction, expected_revision, &saved_by, &now)?;
        transaction.commit()?;
    }
    let snapshot = load_snapshot_summary(&connection, &params.snapshot_id)?;
    let metadata = load_app_meta(&connection)?;
    connection.close().map_err(|(_, error)| error)?;
    sync_file(&params.file_path)?;
    Ok(RenameNamedSnapshotResult {
        metadata,
        snapshot,
        backup_file_path,
    })
}

pub fn delete_named_snapshot(
    params: DeleteNamedSnapshotParams,
) -> Result<DeleteNamedSnapshotResult> {
    validate_non_empty("snapshot_id", &params.snapshot_id)?;
    validate_optional_revision(params.expected_revision)?;
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let before = load_app_meta(&connection)?;
    let expected_revision = resolve_expected_revision(&before, params.expected_revision)?;
    let backup_file_path = create_consistent_backup(&connection, &params.file_path)?;
    {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, expected_revision)?;
        let changed = transaction.execute(
            "DELETE FROM named_snapshots WHERE id = ?1 AND project_id = ?2",
            params![params.snapshot_id, before.project_id],
        )?;
        if changed != 1 {
            return Err(snapshot_not_found(&params.snapshot_id));
        }
        let now = database_timestamp(&transaction)?;
        bump_revision(&transaction, expected_revision, &saved_by, &now)?;
        transaction.commit()?;
    }
    let metadata = load_app_meta(&connection)?;
    connection.close().map_err(|(_, error)| error)?;
    sync_file(&params.file_path)?;
    Ok(DeleteNamedSnapshotResult {
        metadata,
        deleted_snapshot_id: params.snapshot_id,
        backup_file_path,
    })
}

pub fn diff_named_snapshot(params: DiffNamedSnapshotParams) -> Result<DiffNamedSnapshotResult> {
    validate_non_empty("snapshot_id", &params.snapshot_id)?;
    let mut connection = open_existing(&params.file_path)?;
    let result = {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
        let metadata = load_app_meta(&transaction)?;
        let (snapshot, payload_blob) = load_snapshot(&transaction, &params.snapshot_id)?;
        if snapshot.project_id != metadata.project_id {
            return Err(snapshot_not_found(&params.snapshot_id));
        }
        let target = decode_snapshot_payload(&snapshot, &payload_blob)?;
        let current = capture_snapshot_payload(&transaction)?;
        let summary = diff_payloads(&target, &current);
        transaction.commit()?;
        DiffNamedSnapshotResult {
            metadata,
            snapshot,
            summary,
        }
    };
    connection.close().map_err(|(_, error)| error)?;
    Ok(result)
}

pub fn restore_named_snapshot(
    params: RestoreNamedSnapshotParams,
) -> Result<RestoreNamedSnapshotResult> {
    validate_non_empty("snapshot_id", &params.snapshot_id)?;
    validate_optional_revision(params.expected_revision)?;
    if let Some(name) = params.auto_snapshot_name.as_deref() {
        validate_non_empty("auto_snapshot_name", name)?;
    }
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let before = load_app_meta(&connection)?;
    let expected_revision = resolve_expected_revision(&before, params.expected_revision)?;
    let backup_file_path = create_consistent_backup(&connection, &params.file_path)?;
    let safety_snapshot_id = Uuid::new_v4().to_string();
    let changes_before_restore;
    {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, expected_revision)?;
        let (target_summary, target_blob) = load_snapshot(&transaction, &params.snapshot_id)?;
        if target_summary.project_id != before.project_id {
            return Err(snapshot_not_found(&params.snapshot_id));
        }
        let current_payload = capture_snapshot_payload(&transaction)?;
        let now = database_timestamp(&transaction)?;
        let safety_name = params.auto_snapshot_name.clone().unwrap_or_else(|| {
            format!("복원 전 자동 저장 — {}", display_timestamp(&now))
        });
        insert_snapshot_payload(
            &transaction,
            &safety_snapshot_id,
            &safety_name,
            None,
            NamedSnapshotKind::AutoBeforeRestore,
            &current_payload,
            &now,
        )?;
        let target_payload = decode_snapshot_payload(&target_summary, &target_blob)?;
        changes_before_restore = diff_payloads(&target_payload, &current_payload);
        validate_snapshot_payload(&target_payload, &before.project_id)?;
        restore_payload(&transaction, &target_payload)?;
        bump_revision(&transaction, expected_revision, &saved_by, &now)?;
        transaction.commit()?;
    }
    let restored_snapshot = load_snapshot_summary(&connection, &params.snapshot_id)?;
    let safety_snapshot = load_snapshot_summary(&connection, &safety_snapshot_id)?;
    let metadata = load_app_meta(&connection)?;
    connection.close().map_err(|(_, error)| error)?;
    sync_file(&params.file_path)?;
    Ok(RestoreNamedSnapshotResult {
        metadata,
        restored_snapshot,
        safety_snapshot,
        changes_before_restore,
        backup_file_path,
    })
}

pub fn apply_replacement_batch(
    params: ApplyReplacementBatchParams,
) -> Result<ApplyReplacementBatchResult> {
    validate_non_empty("query", &params.query)?;
    if params.query == params.replacement {
        return Err(CoreError::InvalidInput(
            "query and replacement must differ".to_owned(),
        ));
    }
    if params.expected_revision < 0 {
        return Err(CoreError::InvalidInput(
            "expected_revision must be non-negative".to_owned(),
        ));
    }
    if params.transformed_scenes.is_empty() {
        return Err(CoreError::InvalidInput(
            "transformed_scenes must not be empty".to_owned(),
        ));
    }
    if let Some(name) = params.auto_snapshot_name.as_deref() {
        validate_non_empty("auto_snapshot_name", name)?;
    }
    let prepared = prepare_transformed_scenes(&params.transformed_scenes)?;
    let changed_occurrences = params
        .transformed_scenes
        .iter()
        .try_fold(0_u64, |total, scene| {
            total.checked_add(scene.occurrence_count).ok_or_else(|| {
                CoreError::InvalidInput("replacement occurrence count overflow".to_owned())
            })
        })?;
    let saved_by = validated_saved_by(params.saved_by.as_deref())?;
    let mut connection = open_existing(&params.file_path)?;
    let before = load_app_meta(&connection)?;
    if params.expected_revision != before.revision {
        return Err(CoreError::RevisionConflict {
            expected: params.expected_revision,
            actual: before.revision,
        });
    }
    let backup_file_path = create_consistent_backup(&connection, &params.file_path)?;
    let safety_snapshot_id = Uuid::new_v4().to_string();
    {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, params.expected_revision)?;
        validate_batch_targets(
            &transaction,
            &before.project_id,
            &prepared,
            &params.query,
            &params.replacement,
            params.case_sensitive,
        )?;
        let now = database_timestamp(&transaction)?;
        let safety_name = params.auto_snapshot_name.clone().unwrap_or_else(|| {
            format!("전체 치환 전 — {}", display_timestamp(&now))
        });
        insert_snapshot(
            &transaction,
            &safety_snapshot_id,
            &safety_name,
            Some(&format!(
                "query={:?}, replacement={:?}, occurrences={changed_occurrences}",
                params.query, params.replacement
            )),
            NamedSnapshotKind::AutoBeforeReplace,
            &now,
        )?;
        for scene in &prepared {
            let changed = transaction.execute(
                "UPDATE documents SET
                    editor_engine = ?1,
                    editor_engine_commit = ?2,
                    editor_schema_version = ?3,
                    snapshot_blob = ?4,
                    plain_text_recovery = ?5,
                    updated_at = ?6
                 WHERE id = ?7 AND project_id = ?8",
                params![
                    scene.source.editor_engine,
                    scene.source.editor_engine_commit,
                    scene.source.editor_schema_version,
                    scene.snapshot_blob,
                    scene.source.plain_text_recovery,
                    now,
                    scene.source.document_id,
                    before.project_id
                ],
            )?;
            if changed != 1 {
                return Err(CoreError::Integrity(format!(
                    "replacement target document {} disappeared",
                    scene.source.document_id
                )));
            }
        }
        bump_revision(&transaction, params.expected_revision, &saved_by, &now)?;
        transaction.commit()?;
    }
    let safety_snapshot = load_snapshot_summary(&connection, &safety_snapshot_id)?;
    let metadata = load_app_meta(&connection)?;
    let changed_scene_ids = params
        .transformed_scenes
        .iter()
        .map(|scene| scene.scene_id.clone())
        .collect::<Vec<_>>();
    connection.close().map_err(|(_, error)| error)?;
    sync_file(&params.file_path)?;
    Ok(ApplyReplacementBatchResult {
        metadata,
        safety_snapshot,
        changed_scenes: changed_scene_ids.len() as u64,
        changed_occurrences,
        changed_scene_ids,
        backup_file_path,
    })
}

#[derive(Debug)]
struct PreparedTransformedScene<'a> {
    source: &'a TransformedSceneDocument,
    snapshot_blob: Vec<u8>,
}

fn prepare_transformed_scenes(
    scenes: &[TransformedSceneDocument],
) -> Result<Vec<PreparedTransformedScene<'_>>> {
    let mut scene_ids = HashSet::new();
    let mut document_ids = HashSet::new();
    let mut prepared = Vec::with_capacity(scenes.len());
    for scene in scenes {
        validate_non_empty("scene_id", &scene.scene_id)?;
        validate_non_empty("document_id", &scene.document_id)?;
        validate_editor_metadata(
            &scene.editor_engine,
            &scene.editor_engine_commit,
            scene.editor_schema_version,
        )?;
        if scene.occurrence_count == 0 {
            return Err(CoreError::InvalidInput(format!(
                "replacement target {} has zero occurrences",
                scene.scene_id
            )));
        }
        if !scene_ids.insert(scene.scene_id.as_str()) {
            return Err(CoreError::InvalidInput(format!(
                "duplicate replacement scene {}",
                scene.scene_id
            )));
        }
        if !document_ids.insert(scene.document_id.as_str()) {
            return Err(CoreError::InvalidInput(format!(
                "duplicate replacement document {}",
                scene.document_id
            )));
        }
        let snapshot_blob = BASE64_STANDARD
            .decode(scene.snapshot_base64.as_bytes())
            .map_err(|_| {
                CoreError::InvalidInput(format!(
                    "snapshot_base64 is invalid for scene {}",
                    scene.scene_id
                ))
            })?;
        if snapshot_blob.is_empty() {
            return Err(CoreError::InvalidInput(format!(
                "replacement snapshot is empty for scene {}",
                scene.scene_id
            )));
        }
        prepared.push(PreparedTransformedScene {
            source: scene,
            snapshot_blob,
        });
    }
    Ok(prepared)
}

fn validate_batch_targets(
    connection: &Connection,
    project_id: &str,
    scenes: &[PreparedTransformedScene<'_>],
    query: &str,
    replacement: &str,
    case_sensitive: bool,
) -> Result<()> {
    for scene in scenes {
        let stored = connection
            .query_row(
                "SELECT n.document_id, d.plain_text_recovery, d.snapshot_blob,
                        d.editor_engine, d.editor_engine_commit, d.editor_schema_version
                 FROM tree_nodes n
                 JOIN documents d ON d.id = n.document_id
                 WHERE n.id = ?1 AND n.project_id = ?2 AND n.kind = 'SCENE'",
                params![scene.source.scene_id, project_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, i64>(5)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| CoreError::NodeNotFound {
                node_id: scene.source.scene_id.clone(),
            })?;
        if stored.0 != scene.source.document_id {
            return Err(CoreError::Integrity(format!(
                "scene {} is not linked to document {}",
                scene.source.scene_id, scene.source.document_id
            )));
        }
        if stored.1 == scene.source.plain_text_recovery {
            return Err(CoreError::InvalidInput(format!(
                "replacement target {} did not change plain text",
                scene.source.scene_id
            )));
        }
        if stored.2 == scene.snapshot_blob {
            return Err(CoreError::InvalidInput(format!(
                "replacement target {} did not change its semantic snapshot",
                scene.source.scene_id
            )));
        }
        if stored.3 != scene.source.editor_engine
            || stored.4 != scene.source.editor_engine_commit
            || stored.5 != scene.source.editor_schema_version
        {
            return Err(CoreError::InvalidInput(format!(
                "replacement target {} changed editor identity",
                scene.source.scene_id
            )));
        }
        let source_content_hash = hash_plain_text(&stored.1);
        if let Some(expected_hash) = scene.source.source_content_hash.as_deref() {
            if expected_hash != source_content_hash {
                return Err(CoreError::SourceContentConflict {
                    scene_id: scene.source.scene_id.clone(),
                });
            }
        }
        validate_plain_text_replacement(
            &stored.1,
            &scene.source.plain_text_recovery,
            query,
            replacement,
            scene.source.occurrence_count,
            case_sensitive,
            &scene.source.scene_id,
        )?;
    }
    Ok(())
}

fn resolve_scope_node_id(
    connection: &Connection,
    project_id: &str,
    requested: Option<&str>,
) -> Result<String> {
    if let Some(node_id) = requested {
        validate_non_empty("scope_node_id", node_id)?;
        let belongs: bool = connection.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM tree_nodes WHERE id = ?1 AND project_id = ?2
             )",
            params![node_id, project_id],
            |row| row.get(0),
        )?;
        if !belongs {
            return Err(CoreError::NodeNotFound {
                node_id: node_id.to_owned(),
            });
        }
        return Ok(node_id.to_owned());
    }
    connection
        .query_row(
            "SELECT id FROM tree_nodes
             WHERE project_id = ?1 AND kind = 'WORK'",
            [project_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| CoreError::Integrity("WORK root is missing".to_owned()))
}

fn ordered_subtree(
    connection: &Connection,
    project_id: &str,
    scope_node_id: &str,
) -> Result<(TreeNode, Vec<TreeNode>)> {
    let all_nodes = load_all_nodes(connection, project_id)?;
    let scope = all_nodes
        .iter()
        .find(|node| node.id == scope_node_id)
        .cloned()
        .ok_or_else(|| CoreError::NodeNotFound {
            node_id: scope_node_id.to_owned(),
        })?;
    let mut children: HashMap<String, Vec<TreeNode>> = HashMap::new();
    for node in &all_nodes {
        if let Some(parent_id) = node.parent_id.as_deref() {
            children
                .entry(parent_id.to_owned())
                .or_default()
                .push(node.clone());
        }
    }
    for siblings in children.values_mut() {
        siblings.sort_by(|left, right| {
            left.order_key
                .total_cmp(&right.order_key)
                .then_with(|| left.id.cmp(&right.id))
        });
    }
    let mut ordered = Vec::new();
    let mut visited = HashSet::new();
    append_subtree(&scope, &children, &mut visited, &mut ordered)?;
    Ok((scope, ordered))
}

fn append_subtree(
    node: &TreeNode,
    children: &HashMap<String, Vec<TreeNode>>,
    visited: &mut HashSet<String>,
    ordered: &mut Vec<TreeNode>,
) -> Result<()> {
    if !visited.insert(node.id.clone()) {
        return Err(CoreError::Integrity(
            "tree hierarchy contains a cycle".to_owned(),
        ));
    }
    ordered.push(node.clone());
    if let Some(descendants) = children.get(&node.id) {
        for child in descendants {
            append_subtree(child, children, visited, ordered)?;
        }
    }
    Ok(())
}

fn load_all_nodes(connection: &Connection, project_id: &str) -> Result<Vec<TreeNode>> {
    let mut statement = connection.prepare(
        "SELECT id, project_id, parent_id, kind, title, order_key,
                document_id, created_at, updated_at
         FROM tree_nodes WHERE project_id = ?1
         ORDER BY order_key, id",
    )?;
    let rows = statement.query_map([project_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, f64>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, String>(7)?,
            row.get::<_, String>(8)?,
        ))
    })?;
    let mut nodes = Vec::new();
    for row in rows {
        let stored = row?;
        let kind = NodeKind::from_str(&stored.3)
            .map_err(|_| CoreError::Integrity("tree_nodes.kind is invalid".to_owned()))?;
        if !stored.5.is_finite() {
            return Err(CoreError::Integrity(
                "tree_nodes.order_key is not finite".to_owned(),
            ));
        }
        nodes.push(TreeNode {
            id: stored.0,
            project_id: stored.1,
            parent_id: stored.2,
            kind,
            title: stored.4,
            order_key: stored.5,
            document_id: stored.6,
            created_at: stored.7,
            updated_at: stored.8,
        });
    }
    Ok(nodes)
}

struct SearchAccumulator {
    offset: u64,
    limit: u64,
    total_matches: u64,
    matched_scene_ids: HashSet<String>,
    hits: Vec<SearchHit>,
}

impl SearchAccumulator {
    fn new(offset: u64, limit: u64) -> Self {
        Self {
            offset,
            limit,
            total_matches: 0,
            matched_scene_ids: HashSet::new(),
            hits: Vec::with_capacity(limit.min(256) as usize),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn add_text(
        &mut self,
        node: &TreeNode,
        document_id: Option<&str>,
        field: SearchField,
        haystack: &str,
        needle: &str,
        case_sensitive: bool,
        source_content_hash: Option<&str>,
    ) {
        let mut matched_node = false;
        visit_occurrences(
            haystack,
            needle,
            case_sensitive,
            |start_char, end_char, start_byte, end_byte| {
                matched_node = true;
                let occurrence_index = self.total_matches;
                self.total_matches = self.total_matches.saturating_add(1);
                if occurrence_index < self.offset || self.hits.len() as u64 >= self.limit {
                    return;
                }
                let field_name = match field {
                    SearchField::Title => "TITLE",
                    SearchField::Body => "BODY",
                };
                let (context_before, matched_text, context_after) =
                    search_context(haystack, start_byte, end_byte);
                self.hits.push(SearchHit {
                    occurrence_id: format!(
                        "{}:{field_name}:{start_char}:{end_char}",
                        node.id
                    ),
                    node_id: node.id.clone(),
                    scene_id: (node.kind == NodeKind::Scene).then(|| node.id.clone()),
                    document_id: document_id.map(str::to_owned),
                    node_kind: node.kind,
                    node_title: node.title.clone(),
                    field,
                    start_char: start_char as u64,
                    end_char: end_char as u64,
                    context_before,
                    matched_text,
                    context_after,
                    source_content_hash: source_content_hash.map(str::to_owned),
                });
            },
        );
        if matched_node && node.kind == NodeKind::Scene {
            self.matched_scene_ids.insert(node.id.clone());
        }
    }
}

fn visit_occurrences(
    haystack: &str,
    needle: &str,
    case_sensitive: bool,
    mut visitor: impl FnMut(usize, usize, usize, usize),
) {
    if needle.is_empty() {
        return;
    }
    if case_sensitive || is_case_invariant(needle) {
        let needle_chars = needle.chars().count();
        let mut previous_byte = 0_usize;
        let mut previous_char = 0_usize;
        for (start_byte, matched) in haystack.match_indices(needle) {
            let start_char = previous_char + haystack[previous_byte..start_byte].chars().count();
            let end_byte = start_byte + matched.len();
            let end_char = start_char + needle_chars;
            visitor(start_char, end_char, start_byte, end_byte);
            previous_byte = end_byte;
            previous_char = end_char;
        }
        return;
    }

    let folded_needle = needle
        .chars()
        .flat_map(|character| character.to_lowercase())
        .collect::<Vec<_>>();
    let mut start_byte = 0_usize;
    let mut start_char = 0_usize;
    while start_byte < haystack.len() {
        if let Some((matched_bytes, matched_chars)) =
            case_insensitive_prefix(&haystack[start_byte..], &folded_needle)
        {
            visitor(
                start_char,
                start_char + matched_chars,
                start_byte,
                start_byte + matched_bytes,
            );
            start_byte += matched_bytes;
            start_char += matched_chars;
        } else {
            let character = haystack[start_byte..]
                .chars()
                .next()
                .expect("start_byte is a character boundary before the string end");
            start_byte += character.len_utf8();
            start_char += 1;
        }
    }
}

fn case_insensitive_prefix(haystack: &str, folded_needle: &[char]) -> Option<(usize, usize)> {
    let mut matched_folded = 0_usize;
    let mut matched_chars = 0_usize;
    for (byte_offset, character) in haystack.char_indices() {
        let folded_character = character.to_lowercase().collect::<Vec<_>>();
        let end = matched_folded.checked_add(folded_character.len())?;
        if end > folded_needle.len()
            || folded_character.as_slice() != &folded_needle[matched_folded..end]
        {
            return None;
        }
        matched_folded = end;
        matched_chars += 1;
        if matched_folded == folded_needle.len() {
            return Some((byte_offset + character.len_utf8(), matched_chars));
        }
    }
    None
}

fn is_case_invariant(value: &str) -> bool {
    value.chars().all(|character| {
        character.to_lowercase().eq(std::iter::once(character))
            && character.to_uppercase().eq(std::iter::once(character))
    })
}

fn search_context(haystack: &str, start_byte: usize, end_byte: usize) -> (String, String, String) {
    let mut before = haystack[..start_byte]
        .chars()
        .rev()
        .take(SEARCH_CONTEXT_CHARS)
        .collect::<Vec<_>>();
    before.reverse();
    (
        before.into_iter().collect(),
        haystack[start_byte..end_byte].to_owned(),
        haystack[end_byte..]
            .chars()
            .take(SEARCH_CONTEXT_CHARS)
            .collect(),
    )
}

#[cfg(test)]
fn find_occurrences(haystack: &str, needle: &str, case_sensitive: bool) -> Vec<(usize, usize)> {
    let mut matches = Vec::new();
    visit_occurrences(
        haystack,
        needle,
        case_sensitive,
        |start_char, end_char, _, _| matches.push((start_char, end_char)),
    );
    matches
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct LogicalSnapshotPayload {
    format: String,
    version: i64,
    app: SnapshotAppMeta,
    project: SnapshotProject,
    nodes: Vec<SnapshotNode>,
    documents: Vec<SnapshotDocument>,
    ui_state: Vec<SnapshotUiState>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct SnapshotAppMeta {
    project_id: String,
    title: String,
    created_by: String,
    created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct SnapshotProject {
    id: String,
    title: String,
    author_name: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct SnapshotNode {
    id: String,
    project_id: String,
    parent_id: Option<String>,
    kind: NodeKind,
    title: String,
    order_key: f64,
    document_id: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct SnapshotDocument {
    id: String,
    project_id: String,
    title: String,
    editor_engine: String,
    editor_engine_commit: String,
    editor_schema_version: i64,
    snapshot_base64: String,
    plain_text_recovery: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct SnapshotUiState {
    project_id: String,
    key: String,
    value: serde_json::Value,
    updated_at: String,
}

fn capture_snapshot_payload(connection: &Connection) -> Result<LogicalSnapshotPayload> {
    let metadata = load_app_meta(connection)?;
    let project = connection
        .query_row(
            "SELECT id, title, author_name, created_at, updated_at
             FROM projects WHERE id = ?1",
            [&metadata.project_id],
            |row| {
                Ok(SnapshotProject {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    author_name: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| CoreError::Integrity("project row is missing".to_owned()))?;
    let work_node_id: String = connection.query_row(
        "SELECT id FROM tree_nodes WHERE project_id = ?1 AND kind = 'WORK'",
        [&metadata.project_id],
        |row| row.get(0),
    )?;
    let (_, ordered_nodes) = ordered_subtree(connection, &metadata.project_id, &work_node_id)?;
    let nodes = ordered_nodes
        .into_iter()
        .map(|node| SnapshotNode {
            id: node.id,
            project_id: node.project_id,
            parent_id: node.parent_id,
            kind: node.kind,
            title: node.title,
            order_key: node.order_key,
            document_id: node.document_id,
            created_at: node.created_at,
            updated_at: node.updated_at,
        })
        .collect::<Vec<_>>();

    let mut documents = Vec::new();
    for node in nodes.iter().filter(|node| node.kind == NodeKind::Scene) {
        let document_id = node.document_id.as_deref().ok_or_else(|| {
            CoreError::Integrity("SCENE is missing its document link".to_owned())
        })?;
        let stored = connection
            .query_row(
                "SELECT id, project_id, title, editor_engine, editor_engine_commit,
                        editor_schema_version, snapshot_blob, plain_text_recovery,
                        created_at, updated_at
                 FROM documents WHERE id = ?1",
                [document_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, Vec<u8>>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, String>(8)?,
                        row.get::<_, String>(9)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| {
                CoreError::Integrity(format!("document {document_id} is missing"))
            })?;
        documents.push(SnapshotDocument {
            id: stored.0,
            project_id: stored.1,
            title: stored.2,
            editor_engine: stored.3,
            editor_engine_commit: stored.4,
            editor_schema_version: stored.5,
            snapshot_base64: BASE64_STANDARD.encode(stored.6),
            plain_text_recovery: stored.7,
            created_at: stored.8,
            updated_at: stored.9,
        });
    }

    let ui_state = {
        let mut statement = connection.prepare(
            "SELECT project_id, key, value_json, updated_at
             FROM ui_state
             WHERE project_id = ?1 AND key = ?2
             ORDER BY key",
        )?;
        let rows = statement.query_map(params![metadata.project_id, SNAPSHOT_UI_STATE_KEY], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?;
        let mut states = Vec::new();
        for row in rows {
            let stored = row?;
            states.push(SnapshotUiState {
                project_id: stored.0,
                key: stored.1,
                value: serde_json::from_str(&stored.2)?,
                updated_at: stored.3,
            });
        }
        states
    };

    Ok(LogicalSnapshotPayload {
        format: SNAPSHOT_DOCUMENT_FORMAT.to_owned(),
        version: SNAPSHOT_PAYLOAD_VERSION,
        app: SnapshotAppMeta {
            project_id: metadata.project_id,
            title: metadata.title,
            created_by: metadata.created_by,
            created_at: metadata.created_at,
        },
        project,
        nodes,
        documents,
        ui_state,
    })
}

fn insert_snapshot(
    transaction: &Transaction<'_>,
    snapshot_id: &str,
    name: &str,
    note: Option<&str>,
    kind: NamedSnapshotKind,
    now: &str,
) -> Result<NamedSnapshotSummary> {
    let payload = capture_snapshot_payload(transaction)?;
    insert_snapshot_payload(transaction, snapshot_id, name, note, kind, &payload, now)
}

fn insert_snapshot_payload(
    transaction: &Transaction<'_>,
    snapshot_id: &str,
    name: &str,
    note: Option<&str>,
    kind: NamedSnapshotKind,
    payload: &LogicalSnapshotPayload,
    now: &str,
) -> Result<NamedSnapshotSummary> {
    validate_non_empty("snapshot_id", snapshot_id)?;
    validate_snapshot_name_and_note(name, note)?;
    let payload_blob = serde_json::to_vec(payload)?;
    let content_hash = hash_payload(&payload_blob);
    transaction.execute(
        "INSERT INTO named_snapshots (
            id, project_id, name, note, kind, payload_format, payload_version,
            payload_blob, content_hash, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
        params![
            snapshot_id,
            payload.project.id,
            name,
            note,
            kind.as_str(),
            SNAPSHOT_PAYLOAD_FORMAT,
            SNAPSHOT_PAYLOAD_VERSION,
            payload_blob,
            content_hash,
            now
        ],
    )?;
    load_snapshot_summary(transaction, snapshot_id)
}

fn load_snapshot_summaries(
    connection: &Connection,
    project_id: &str,
) -> Result<Vec<NamedSnapshotSummary>> {
    let mut statement = connection.prepare(
        "SELECT id, project_id, name, note, kind, payload_format,
                payload_version, length(payload_blob), content_hash,
                created_at, updated_at
         FROM named_snapshots WHERE project_id = ?1
         ORDER BY created_at DESC, id",
    )?;
    let rows = statement.query_map([project_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, i64>(6)?,
            row.get::<_, i64>(7)?,
            row.get::<_, String>(8)?,
            row.get::<_, String>(9)?,
            row.get::<_, String>(10)?,
        ))
    })?;
    let mut snapshots = Vec::new();
    for row in rows {
        snapshots.push(snapshot_summary_from_stored(row?)?);
    }
    Ok(snapshots)
}

fn load_snapshot_summary(
    connection: &Connection,
    snapshot_id: &str,
) -> Result<NamedSnapshotSummary> {
    let stored = connection
        .query_row(
            "SELECT id, project_id, name, note, kind, payload_format,
                    payload_version, length(payload_blob), content_hash,
                    created_at, updated_at
             FROM named_snapshots WHERE id = ?1",
            [snapshot_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, String>(10)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| snapshot_not_found(snapshot_id))?;
    snapshot_summary_from_stored(stored)
}

type StoredSnapshotSummary = (
    String,
    String,
    String,
    Option<String>,
    String,
    String,
    i64,
    i64,
    String,
    String,
    String,
);

fn snapshot_summary_from_stored(stored: StoredSnapshotSummary) -> Result<NamedSnapshotSummary> {
    let kind = NamedSnapshotKind::from_str(&stored.4)
        .map_err(CoreError::SnapshotIntegrity)?;
    Ok(NamedSnapshotSummary {
        id: stored.0,
        project_id: stored.1,
        name: stored.2,
        note: stored.3,
        kind,
        payload_format: stored.5,
        payload_version: stored.6,
        payload_bytes: stored.7.max(0) as u64,
        content_hash: stored.8,
        created_at: stored.9,
        updated_at: stored.10,
    })
}

fn load_snapshot(
    connection: &Connection,
    snapshot_id: &str,
) -> Result<(NamedSnapshotSummary, Vec<u8>)> {
    let summary = load_snapshot_summary(connection, snapshot_id)?;
    let payload_blob = connection.query_row(
        "SELECT payload_blob FROM named_snapshots WHERE id = ?1",
        [snapshot_id],
        |row| row.get(0),
    )?;
    Ok((summary, payload_blob))
}

fn decode_snapshot_payload(
    summary: &NamedSnapshotSummary,
    payload_blob: &[u8],
) -> Result<LogicalSnapshotPayload> {
    if summary.payload_format != SNAPSHOT_PAYLOAD_FORMAT {
        return Err(CoreError::SnapshotIntegrity(format!(
            "unsupported payload format {}",
            summary.payload_format
        )));
    }
    if summary.payload_version != SNAPSHOT_PAYLOAD_VERSION {
        return Err(CoreError::SnapshotIntegrity(format!(
            "unsupported payload version {}",
            summary.payload_version
        )));
    }
    if hash_payload(payload_blob) != summary.content_hash {
        return Err(CoreError::SnapshotIntegrity(
            "content hash does not match payload".to_owned(),
        ));
    }
    let payload: LogicalSnapshotPayload = serde_json::from_slice(payload_blob)
        .map_err(|error| CoreError::SnapshotIntegrity(error.to_string()))?;
    if payload.format != SNAPSHOT_DOCUMENT_FORMAT
        || payload.version != SNAPSHOT_PAYLOAD_VERSION
    {
        return Err(CoreError::SnapshotIntegrity(
            "embedded payload identity is unsupported".to_owned(),
        ));
    }
    Ok(payload)
}

fn hash_payload(payload_blob: &[u8]) -> String {
    format!("{:x}", Sha256::digest(payload_blob))
}

fn hash_plain_text(plain_text: &str) -> String {
    hash_payload(plain_text.as_bytes())
}

fn estimated_json_string_bytes(value: &str) -> usize {
    value.chars().fold(2_usize, |total, character| {
        let encoded = match character {
            '"' | '\\' => 2,
            '\u{0000}'..='\u{001f}' => 6,
            _ => character.len_utf8(),
        };
        total.saturating_add(encoded)
    })
}

fn diff_payloads(
    target: &LogicalSnapshotPayload,
    current: &LogicalSnapshotPayload,
) -> SnapshotDiffSummary {
    let target_nodes = target
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let current_nodes = current
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let mut summary = SnapshotDiffSummary::default();
    for node in current
        .nodes
        .iter()
        .filter(|node| !target_nodes.contains_key(node.id.as_str()))
    {
        increment_node_count(&mut summary.added, node.kind);
    }
    for node in target
        .nodes
        .iter()
        .filter(|node| !current_nodes.contains_key(node.id.as_str()))
    {
        increment_node_count(&mut summary.deleted, node.kind);
    }

    let common_node_ids = target_nodes
        .keys()
        .filter(|node_id| current_nodes.contains_key(**node_id))
        .copied()
        .collect::<HashSet<_>>();
    let target_positions = sibling_positions(&target.nodes, &common_node_ids);
    let current_positions = sibling_positions(&current.nodes, &common_node_ids);
    for (node_id, target_node) in &target_nodes {
        let Some(current_node) = current_nodes.get(node_id) else {
            continue;
        };
        if target_node.title != current_node.title {
            summary.renamed_nodes += 1;
        }
        if target_node.kind != NodeKind::Work
            && target_positions.get(*node_id) != current_positions.get(*node_id)
        {
            summary.reordered_nodes += 1;
        }
    }

    let target_documents = target
        .documents
        .iter()
        .map(|document| (document.id.as_str(), document))
        .collect::<HashMap<_, _>>();
    let current_documents = current
        .documents
        .iter()
        .map(|document| (document.id.as_str(), document))
        .collect::<HashMap<_, _>>();
    for (document_id, target_document) in target_documents {
        if let Some(current_document) = current_documents.get(document_id) {
            if target_document.snapshot_base64 != current_document.snapshot_base64
                || target_document.plain_text_recovery
                    != current_document.plain_text_recovery
            {
                summary.changed_scene_bodies += 1;
            }
        }
    }
    let target_characters = target
        .documents
        .iter()
        .map(|document| document.plain_text_recovery.chars().count() as i128)
        .sum::<i128>();
    let current_characters = current
        .documents
        .iter()
        .map(|document| document.plain_text_recovery.chars().count() as i128)
        .sum::<i128>();
    summary.character_count_delta = (current_characters - target_characters)
        .clamp(i64::MIN as i128, i64::MAX as i128) as i64;
    summary
}

fn increment_node_count(counts: &mut SnapshotNodeCounts, kind: NodeKind) {
    match kind {
        NodeKind::Work => {}
        NodeKind::Volume => counts.volumes += 1,
        NodeKind::Chapter => counts.chapters += 1,
        NodeKind::Scene => counts.scenes += 1,
    }
}

fn sibling_positions<'a>(
    nodes: &'a [SnapshotNode],
    included_node_ids: &HashSet<&str>,
) -> HashMap<&'a str, (Option<&'a str>, usize)> {
    let mut sibling_indexes: HashMap<Option<&str>, usize> = HashMap::new();
    let mut positions = HashMap::new();
    for node in nodes
        .iter()
        .filter(|node| included_node_ids.contains(node.id.as_str()))
    {
        let parent_id = node.parent_id.as_deref();
        let index = sibling_indexes.entry(parent_id).or_default();
        positions.insert(node.id.as_str(), (parent_id, *index));
        *index += 1;
    }
    positions
}

fn validate_snapshot_payload(payload: &LogicalSnapshotPayload, project_id: &str) -> Result<()> {
    if payload.app.project_id != project_id || payload.project.id != project_id {
        return Err(CoreError::SnapshotIntegrity(
            "payload belongs to a different project".to_owned(),
        ));
    }
    validate_non_empty("snapshot project title", &payload.project.title)
        .map_err(|error| CoreError::SnapshotIntegrity(error.to_string()))?;
    let mut node_ids = HashSet::new();
    let mut document_ids = HashSet::new();
    let mut work_count = 0_u64;
    let mut known_kinds = HashMap::new();
    let mut sibling_orders = HashSet::new();
    for node in &payload.nodes {
        if node.project_id != project_id || !node.order_key.is_finite() {
            return Err(CoreError::SnapshotIntegrity(
                "node project or order key is invalid".to_owned(),
            ));
        }
        validate_non_empty("snapshot node id", &node.id)
            .map_err(|error| CoreError::SnapshotIntegrity(error.to_string()))?;
        validate_non_empty("snapshot node title", &node.title)
            .map_err(|error| CoreError::SnapshotIntegrity(error.to_string()))?;
        if !node_ids.insert(node.id.as_str()) {
            return Err(CoreError::SnapshotIntegrity(
                "payload contains duplicate node identifiers".to_owned(),
            ));
        }
        let order_identity = (
            node.parent_id.as_deref().unwrap_or_default().to_owned(),
            node.order_key.to_bits(),
        );
        if !sibling_orders.insert(order_identity) {
            return Err(CoreError::SnapshotIntegrity(
                "payload contains duplicate sibling order keys".to_owned(),
            ));
        }
        if node.kind == NodeKind::Work {
            work_count += 1;
            if node.parent_id.is_some() || node.document_id.is_some() {
                return Err(CoreError::SnapshotIntegrity(
                    "WORK payload node is malformed".to_owned(),
                ));
            }
        } else if node.parent_id.is_none() {
            return Err(CoreError::SnapshotIntegrity(
                "non-WORK payload node has no parent".to_owned(),
            ));
        }
        if node.kind == NodeKind::Scene {
            let document_id = node.document_id.as_deref().ok_or_else(|| {
                CoreError::SnapshotIntegrity("SCENE has no document".to_owned())
            })?;
            if !document_ids.insert(document_id) {
                return Err(CoreError::SnapshotIntegrity(
                    "multiple scenes reference one document".to_owned(),
                ));
            }
        } else if node.document_id.is_some() {
            return Err(CoreError::SnapshotIntegrity(
                "non-SCENE payload node references a document".to_owned(),
            ));
        }
        known_kinds.insert(node.id.as_str(), node.kind);
    }
    if work_count != 1 {
        return Err(CoreError::SnapshotIntegrity(
            "payload must contain exactly one WORK".to_owned(),
        ));
    }
    for node in &payload.nodes {
        let Some(parent_id) = node.parent_id.as_deref() else {
            continue;
        };
        let parent_kind = known_kinds.get(parent_id).ok_or_else(|| {
            CoreError::SnapshotIntegrity(format!("parent {parent_id} is missing"))
        })?;
        let valid = matches!(
            (*parent_kind, node.kind),
            (NodeKind::Work, NodeKind::Volume)
                | (NodeKind::Work, NodeKind::Chapter)
                | (NodeKind::Volume, NodeKind::Chapter)
                | (NodeKind::Chapter, NodeKind::Scene)
        );
        if !valid {
            return Err(CoreError::SnapshotIntegrity(
                "payload hierarchy contains an invalid edge".to_owned(),
            ));
        }
    }
    let stored_documents = payload
        .documents
        .iter()
        .map(|document| document.id.as_str())
        .collect::<HashSet<_>>();
    if stored_documents.len() != payload.documents.len() || stored_documents != document_ids {
        return Err(CoreError::SnapshotIntegrity(
            "payload document set does not match SCENE links".to_owned(),
        ));
    }
    for document in &payload.documents {
        if document.project_id != project_id {
            return Err(CoreError::SnapshotIntegrity(
                "payload document belongs to a different project".to_owned(),
            ));
        }
        validate_editor_metadata(
            &document.editor_engine,
            &document.editor_engine_commit,
            document.editor_schema_version,
        )
        .map_err(|error| CoreError::SnapshotIntegrity(error.to_string()))?;
        BASE64_STANDARD
            .decode(document.snapshot_base64.as_bytes())
            .map_err(|_| {
                CoreError::SnapshotIntegrity(format!(
                    "document {} snapshot is not base64",
                    document.id
                ))
            })?;
    }
    for state in &payload.ui_state {
        if state.project_id != project_id || state.key != SNAPSHOT_UI_STATE_KEY {
            return Err(CoreError::SnapshotIntegrity(
                "payload UI state is outside the supported workspace key".to_owned(),
            ));
        }
    }
    Ok(())
}

fn validate_plain_text_replacement(
    source: &str,
    transformed: &str,
    query: &str,
    replacement: &str,
    selected_count: u64,
    case_sensitive: bool,
    scene_id: &str,
) -> Result<()> {
    let mut occurrence_count = 0_u64;
    let mut lengths = HashMap::<usize, u64>::new();
    visit_occurrences(
        source,
        query,
        case_sensitive,
        |start_char, end_char, _, _| {
            occurrence_count = occurrence_count.saturating_add(1);
            *lengths.entry(end_char - start_char).or_default() += 1;
        },
    );
    if selected_count > occurrence_count {
        return Err(CoreError::InvalidInput(format!(
            "replacement target {scene_id} declares {selected_count} occurrences but source has {occurrence_count}"
        )));
    }

    let (minimum_removed, maximum_removed) =
        selected_character_bounds(&lengths, selected_count)?;
    let source_characters = source.chars().count() as i128;
    let transformed_characters = transformed.chars().count() as i128;
    let replacement_characters = replacement.chars().count() as i128;
    let implied_removed = source_characters
        + replacement_characters * selected_count as i128
        - transformed_characters;
    if implied_removed < minimum_removed as i128 || implied_removed > maximum_removed as i128 {
        return Err(CoreError::InvalidInput(format!(
            "replacement target {scene_id} character delta is inconsistent with occurrence_count"
        )));
    }
    validate_replacement_transduction(
        source,
        transformed,
        query,
        replacement,
        selected_count,
        case_sensitive,
        scene_id,
    )?;
    Ok(())
}

const MAX_REPLACEMENT_VALIDATION_STATES: usize = 4_096;

fn validate_replacement_transduction(
    source: &str,
    transformed: &str,
    query: &str,
    replacement: &str,
    selected_count: u64,
    case_sensitive: bool,
    scene_id: &str,
) -> Result<()> {
    let mut source_cursor = 0_usize;
    let mut states = HashSet::from([(0_usize, 0_u64)]);
    let mut validation_error = None;
    visit_occurrences(
        source,
        query,
        case_sensitive,
        |_, _, occurrence_start, occurrence_end| {
            if validation_error.is_some() {
                return;
            }
            let literal = &source[source_cursor..occurrence_start];
            let occurrence = &source[occurrence_start..occurrence_end];
            let mut next_states = HashSet::new();
            for (transformed_cursor, replacements_applied) in states.drain() {
                let Some(after_literal) = transformed_cursor.checked_add(literal.len()) else {
                    continue;
                };
                if transformed
                    .get(transformed_cursor..after_literal)
                    .is_none_or(|candidate| candidate != literal)
                {
                    continue;
                }
                if transformed[after_literal..].starts_with(occurrence) {
                    next_states.insert((after_literal + occurrence.len(), replacements_applied));
                }
                if replacements_applied < selected_count
                    && transformed[after_literal..].starts_with(replacement)
                {
                    next_states.insert((after_literal + replacement.len(), replacements_applied + 1));
                }
                if next_states.len() > MAX_REPLACEMENT_VALIDATION_STATES {
                    validation_error = Some(CoreError::InvalidInput(format!(
                        "replacement target {scene_id} is too ambiguous to validate safely"
                    )));
                    return;
                }
            }
            states = next_states;
            source_cursor = occurrence_end;
        },
    );
    if let Some(error) = validation_error {
        return Err(error);
    }
    let tail = &source[source_cursor..];
    let valid = states.into_iter().any(|(transformed_cursor, replacements_applied)| {
        replacements_applied == selected_count
            && transformed
                .get(transformed_cursor..)
                .is_some_and(|candidate| candidate == tail)
    });
    if !valid {
        return Err(CoreError::InvalidInput(format!(
            "replacement target {scene_id} is not a deterministic selected-occurrence transformation"
        )));
    }
    Ok(())
}

fn selected_character_bounds(
    lengths: &HashMap<usize, u64>,
    selected_count: u64,
) -> Result<(u64, u64)> {
    let mut ordered = lengths
        .iter()
        .map(|(length, count)| (*length as u64, *count))
        .collect::<Vec<_>>();
    ordered.sort_unstable_by_key(|(length, _)| *length);
    let minimum = take_character_lengths(&ordered, selected_count)?;
    ordered.reverse();
    let maximum = take_character_lengths(&ordered, selected_count)?;
    Ok((minimum, maximum))
}

fn take_character_lengths(lengths: &[(u64, u64)], selected_count: u64) -> Result<u64> {
    let mut remaining = selected_count;
    let mut total = 0_u64;
    for (length, available) in lengths {
        let taken = remaining.min(*available);
        total = total
            .checked_add(length.checked_mul(taken).ok_or_else(|| {
                CoreError::InvalidInput("replacement character count overflow".to_owned())
            })?)
            .ok_or_else(|| {
                CoreError::InvalidInput("replacement character count overflow".to_owned())
            })?;
        remaining -= taken;
        if remaining == 0 {
            return Ok(total);
        }
    }
    Err(CoreError::InvalidInput(
        "replacement occurrence count exceeds source matches".to_owned(),
    ))
}

fn restore_payload(transaction: &Transaction<'_>, payload: &LogicalSnapshotPayload) -> Result<()> {
    transaction.execute(
        "DELETE FROM tree_nodes WHERE project_id = ?1",
        [&payload.project.id],
    )?;
    transaction.execute(
        "DELETE FROM documents WHERE project_id = ?1",
        [&payload.project.id],
    )?;
    transaction.execute(
        "DELETE FROM ui_state WHERE project_id = ?1 AND key = ?2",
        params![payload.project.id, SNAPSHOT_UI_STATE_KEY],
    )?;
    transaction.execute(
        "UPDATE projects SET title = ?1, author_name = ?2,
            created_at = ?3, updated_at = ?4 WHERE id = ?5",
        params![
            payload.project.title,
            payload.project.author_name,
            payload.project.created_at,
            payload.project.updated_at,
            payload.project.id
        ],
    )?;
    transaction.execute(
        "UPDATE app_meta SET title = ?1, created_by = ?2, created_at = ?3
         WHERE singleton = 1 AND project_id = ?4",
        params![
            payload.app.title,
            payload.app.created_by,
            payload.app.created_at,
            payload.app.project_id
        ],
    )?;
    for document in &payload.documents {
        let snapshot_blob = BASE64_STANDARD
            .decode(document.snapshot_base64.as_bytes())
            .map_err(|_| {
                CoreError::SnapshotIntegrity(format!(
                    "document {} snapshot is not base64",
                    document.id
                ))
            })?;
        transaction.execute(
            "INSERT INTO documents (
                id, project_id, title, editor_engine, editor_engine_commit,
                editor_schema_version, snapshot_blob, plain_text_recovery,
                created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                document.id,
                document.project_id,
                document.title,
                document.editor_engine,
                document.editor_engine_commit,
                document.editor_schema_version,
                snapshot_blob,
                document.plain_text_recovery,
                document.created_at,
                document.updated_at
            ],
        )?;
    }
    for node in &payload.nodes {
        transaction.execute(
            "INSERT INTO tree_nodes (
                id, project_id, parent_id, kind, title, order_key,
                document_id, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                node.id,
                node.project_id,
                node.parent_id,
                node.kind.as_str(),
                node.title,
                node.order_key,
                node.document_id,
                node.created_at,
                node.updated_at
            ],
        )?;
    }
    for state in &payload.ui_state {
        transaction.execute(
            "INSERT INTO ui_state (project_id, key, value_json, updated_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                state.project_id,
                state.key,
                serde_json::to_string(&state.value)?,
                state.updated_at
            ],
        )?;
    }
    Ok(())
}

fn validate_snapshot_name_and_note(name: &str, _note: Option<&str>) -> Result<()> {
    validate_non_empty("name", name)?;
    Ok(())
}

fn snapshot_not_found(snapshot_id: &str) -> CoreError {
    CoreError::NotFound(format!("named snapshot id {snapshot_id}"))
}

fn validate_optional_revision(expected_revision: Option<i64>) -> Result<()> {
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

fn ensure_revision(connection: &Connection, expected: i64) -> Result<()> {
    let actual: i64 = connection.query_row(
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
        "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
        params![now, load_app_meta(transaction)?.project_id],
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

fn display_timestamp(timestamp: &str) -> String {
    timestamp
        .trim_end_matches('Z')
        .replace('T', " ")
}

#[cfg(test)]
mod tests {
    use super::find_occurrences;

    #[test]
    fn unicode_occurrences_are_non_overlapping_character_offsets() {
        assert_eq!(find_occurrences("문문문", "문문", true), vec![(0, 2)]);
        assert_eq!(find_occurrences("Alpha 알파", "alpha", false), vec![(0, 5)]);
    }
}
