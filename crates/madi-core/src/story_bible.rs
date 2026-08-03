use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::str::FromStr;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction, TransactionBehavior};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::{CoreError, Result};
use crate::model::*;
use crate::storage::{
    create_consistent_backup, database_timestamp, default_client_identifier, load_app_meta,
    open_existing, sync_file, validate_editor_metadata, validate_non_empty,
};

const DEFAULT_EDITOR_ENGINE: &str = "typie";
const DEFAULT_EDITOR_COMMIT: &str = "uninitialized";
const DEFAULT_SEARCH_LIMIT: u64 = 200;
const MAX_SEARCH_LIMIT: u64 = 2_000;
const MENTION_CONTEXT_CHARS: usize = 32;

struct MutationSetup {
    connection: Connection,
    before: AppMeta,
    expected_revision: i64,
    saved_by: String,
    backup_file_path: PathBuf,
}

fn prepare_mutation(
    file_path: &Path,
    expected_revision: Option<i64>,
    saved_by: Option<&str>,
) -> Result<MutationSetup> {
    if expected_revision.is_some_and(|revision| revision < 0) {
        return Err(CoreError::InvalidInput(
            "expected_revision must be non-negative".to_owned(),
        ));
    }
    let saved_by = saved_by
        .map(str::to_owned)
        .unwrap_or_else(default_client_identifier);
    validate_non_empty("saved_by", &saved_by)?;
    let connection = open_existing(file_path)?;
    let before = load_app_meta(&connection)?;
    let resolved = expected_revision.unwrap_or(before.revision);
    if resolved != before.revision {
        return Err(CoreError::RevisionConflict {
            expected: resolved,
            actual: before.revision,
        });
    }
    let backup_file_path = create_consistent_backup(&connection, file_path)?;
    Ok(MutationSetup {
        connection,
        before,
        expected_revision: resolved,
        saved_by,
        backup_file_path,
    })
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
        "UPDATE app_meta SET last_saved_by = ?1, updated_at = ?2,
             revision = revision + 1
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
    Ok(())
}

fn finish_mutation(setup: MutationSetup, file_path: &Path) -> Result<(AppMeta, PathBuf)> {
    let metadata = load_app_meta(&setup.connection)?;
    setup.connection.close().map_err(|(_, error)| error)?;
    sync_file(file_path)?;
    Ok((metadata, setup.backup_file_path))
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let value = value.trim().to_owned();
        (!value.is_empty()).then_some(value)
    })
}

pub(crate) fn normalize_alias(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn validate_attributes(attributes: &serde_json::Value) -> Result<String> {
    if !attributes.is_object() {
        return Err(CoreError::InvalidInput(
            "attributes must be a JSON object".to_owned(),
        ));
    }
    let encoded = serde_json::to_string(attributes)?;
    if encoded.len() > 1024 * 1024 {
        return Err(CoreError::InvalidInput(
            "attributes JSON must not exceed 1 MiB".to_owned(),
        ));
    }
    Ok(encoded)
}

fn entity_not_found(entity_id: &str) -> CoreError {
    CoreError::NotFound(format!("entity id {entity_id}"))
}

fn load_entity_record(connection: &Connection, entity_id: &str) -> Result<EntityRecord> {
    connection
        .query_row(
            "SELECT e.id, e.project_id, e.kind, e.name, e.summary, e.document_id,
                    e.status, e.color_token, e.icon_key, e.attributes_json,
                    EXISTS(
                        SELECT 1 FROM entities duplicate
                        WHERE duplicate.project_id = e.project_id
                          AND duplicate.name = e.name AND duplicate.id <> e.id
                    ), e.created_at, e.updated_at
             FROM entities e WHERE e.id = ?1",
            [entity_id],
            entity_from_row,
        )
        .optional()?
        .ok_or_else(|| entity_not_found(entity_id))
}

fn load_project_entity_record(
    connection: &Connection,
    project_id: &str,
    entity_id: &str,
) -> Result<EntityRecord> {
    let entity = load_entity_record(connection, entity_id)?;
    if entity.project_id != project_id {
        return Err(entity_not_found(entity_id));
    }
    Ok(entity)
}

fn entity_from_row(row: &Row<'_>) -> rusqlite::Result<EntityRecord> {
    let kind = row.get::<_, String>(2)?;
    let status = row.get::<_, String>(6)?;
    let attributes_json = row.get::<_, String>(9)?;
    Ok(EntityRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        kind: EntityKind::from_str(&kind).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, error.into())
        })?,
        name: row.get(3)?,
        summary: row.get(4)?,
        document_id: row.get(5)?,
        status: EntityStatus::from_str(&status).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, error.into())
        })?,
        color_token: row.get(7)?,
        icon_key: row.get(8)?,
        attributes: serde_json::from_str(&attributes_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(9, rusqlite::types::Type::Text, error.into())
        })?,
        duplicate_name: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

fn load_all_entities(connection: &Connection, project_id: &str) -> Result<Vec<EntityRecord>> {
    let mut statement = connection.prepare(
        "SELECT e.id, e.project_id, e.kind, e.name, e.summary, e.document_id,
                e.status, e.color_token, e.icon_key, e.attributes_json,
                EXISTS(
                    SELECT 1 FROM entities duplicate
                    WHERE duplicate.project_id = e.project_id
                      AND duplicate.name = e.name AND duplicate.id <> e.id
                ), e.created_at, e.updated_at
         FROM entities e WHERE e.project_id = ?1",
    )?;
    let rows = statement.query_map([project_id], entity_from_row)?;
    let mut entities = Vec::new();
    for row in rows {
        entities.push(row?);
    }
    Ok(entities)
}

pub fn list_entities(params: ListEntitiesParams) -> Result<ListEntitiesResult> {
    let connection = open_existing(&params.file_path)?;
    let metadata = load_app_meta(&connection)?;
    let query = params
        .query
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);
    let kind_filter = params.kinds.into_iter().collect::<HashSet<_>>();
    let status_filter = params.statuses.into_iter().collect::<HashSet<_>>();
    let tag_filter = params.tag_ids.into_iter().collect::<HashSet<_>>();
    let loaded_entities = load_all_entities(&connection, &metadata.project_id)?;
    let mut entities = Vec::with_capacity(loaded_entities.len());
    for entity in loaded_entities {
        if !kind_filter.is_empty() && !kind_filter.contains(&entity.kind) {
            continue;
        }
        if !status_filter.is_empty() && !status_filter.contains(&entity.status) {
            continue;
        }
        if !tag_filter.is_empty() {
            let attached = load_entity_tag_ids(&connection, &entity.id)?;
            if !tag_filter.iter().all(|tag| attached.contains(tag)) {
                continue;
            }
        }
        let query_matches = if let Some(query) = query.as_ref() {
            entity.name.to_lowercase().contains(query)
                || entity
                    .summary
                    .as_deref()
                    .is_some_and(|summary| summary.to_lowercase().contains(query))
                || load_aliases(&connection, &entity.id)?
                    .iter()
                    .any(|alias| alias.alias.to_lowercase().contains(query))
        } else {
            true
        };
        if query_matches {
            entities.push(entity);
        }
    }
    match params.sort {
        EntitySort::NameAsc => entities.sort_by(|left, right| {
            left.name
                .to_lowercase()
                .cmp(&right.name.to_lowercase())
                .then_with(|| left.id.cmp(&right.id))
        }),
        EntitySort::UpdatedDesc => entities.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| left.id.cmp(&right.id))
        }),
    }
    connection.close().map_err(|(_, error)| error)?;
    Ok(ListEntitiesResult { metadata, entities })
}

pub fn create_entity(params: CreateEntityParams) -> Result<CreateEntityResult> {
    validate_non_empty("name", &params.name)?;
    let attributes_json = validate_attributes(&params.attributes)?;
    let entity_id = params
        .entity_id
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let document_id = params
        .document_id
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    validate_non_empty("entity_id", &entity_id)?;
    validate_non_empty("document_id", &document_id)?;
    let editor_engine = params
        .editor_engine
        .unwrap_or_else(|| DEFAULT_EDITOR_ENGINE.to_owned());
    let editor_commit = params
        .editor_engine_commit
        .unwrap_or_else(|| DEFAULT_EDITOR_COMMIT.to_owned());
    let editor_schema = params.editor_schema_version.unwrap_or(0);
    validate_editor_metadata(&editor_engine, &editor_commit, editor_schema)?;
    let mut setup = prepare_mutation(
        &params.file_path,
        params.expected_revision,
        params.saved_by.as_deref(),
    )?;
    {
        let transaction = setup
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, setup.expected_revision)?;
        let entity_exists: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM entities WHERE id = ?1)",
            [&entity_id],
            |row| row.get(0),
        )?;
        let document_exists: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM documents WHERE id = ?1)",
            [&document_id],
            |row| row.get(0),
        )?;
        if entity_exists {
            return Err(CoreError::IdentifierConflict {
                entity: "story bible entity",
                id: entity_id,
            });
        }
        if document_exists {
            return Err(CoreError::IdentifierConflict {
                entity: "entity note document",
                id: document_id,
            });
        }
        let now = database_timestamp(&transaction)?;
        transaction.execute(
            "INSERT INTO documents (
                id, project_id, title, editor_engine, editor_engine_commit,
                editor_schema_version, snapshot_blob, plain_text_recovery,
                created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, X'', '', ?7, ?7)",
            params![
                document_id,
                setup.before.project_id,
                params.name.trim(),
                editor_engine,
                editor_commit,
                editor_schema,
                now
            ],
        )?;
        transaction.execute(
            "INSERT INTO entities (
                id, project_id, kind, name, summary, document_id, status,
                color_token, icon_key, attributes_json, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
            params![
                entity_id,
                setup.before.project_id,
                params.kind.as_str(),
                params.name.trim(),
                clean_optional(params.summary),
                document_id,
                params.status.as_str(),
                clean_optional(params.color_token),
                clean_optional(params.icon_key),
                attributes_json,
                now
            ],
        )?;
        bump_revision(&transaction, setup.expected_revision, &setup.saved_by, &now)?;
        transaction.commit()?;
    }
    let entity =
        load_project_entity_record(&setup.connection, &setup.before.project_id, &entity_id)?;
    let document = load_document_summary(&setup.connection, &document_id)?;
    let (metadata, backup_file_path) = finish_mutation(setup, &params.file_path)?;
    Ok(CreateEntityResult {
        metadata,
        entity,
        document,
        backup_file_path,
    })
}

pub fn update_entity(params: UpdateEntityParams) -> Result<UpdateEntityResult> {
    validate_non_empty("entity_id", &params.entity_id)?;
    validate_non_empty("name", &params.name)?;
    let attributes_json = validate_attributes(&params.attributes)?;
    let mut setup = prepare_mutation(
        &params.file_path,
        params.expected_revision,
        params.saved_by.as_deref(),
    )?;
    {
        let transaction = setup
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, setup.expected_revision)?;
        let now = database_timestamp(&transaction)?;
        let document_id = transaction
            .query_row(
                "SELECT document_id FROM entities WHERE id = ?1 AND project_id = ?2",
                params![params.entity_id, setup.before.project_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| entity_not_found(&params.entity_id))?;
        let changed = transaction.execute(
            "UPDATE entities SET kind = ?1, name = ?2, summary = ?3, status = ?4,
                color_token = ?5, icon_key = ?6, attributes_json = ?7, updated_at = ?8
             WHERE id = ?9 AND project_id = ?10",
            params![
                params.kind.as_str(),
                params.name.trim(),
                clean_optional(params.summary),
                params.status.as_str(),
                clean_optional(params.color_token),
                clean_optional(params.icon_key),
                attributes_json,
                now,
                params.entity_id,
                setup.before.project_id
            ],
        )?;
        if changed != 1 {
            return Err(entity_not_found(&params.entity_id));
        }
        transaction.execute(
            "UPDATE documents SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![params.name.trim(), now, document_id],
        )?;
        bump_revision(&transaction, setup.expected_revision, &setup.saved_by, &now)?;
        transaction.commit()?;
    }
    let entity = load_project_entity_record(
        &setup.connection,
        &setup.before.project_id,
        &params.entity_id,
    )?;
    let (metadata, backup_file_path) = finish_mutation(setup, &params.file_path)?;
    Ok(UpdateEntityResult {
        metadata,
        entity,
        backup_file_path,
    })
}

pub fn load_entity_note(params: LoadEntityNoteParams) -> Result<EntityNoteRecord> {
    if params.owner_kind != DocumentOwnerKind::Entity {
        return Err(CoreError::InvalidInput(
            "load_entity_note owner_kind must be ENTITY".to_owned(),
        ));
    }
    validate_non_empty("owner_id", &params.owner_id)?;
    let connection = open_existing(&params.file_path)?;
    let metadata = load_app_meta(&connection)?;
    let document_id = connection
        .query_row(
            "SELECT document_id FROM entities WHERE id = ?1 AND project_id = ?2",
            params![params.owner_id, metadata.project_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| entity_not_found(&params.owner_id))?;
    let document = load_document_record(&connection, &document_id)?;
    connection.close().map_err(|(_, error)| error)?;
    Ok(EntityNoteRecord {
        owner_kind: DocumentOwnerKind::Entity,
        owner_id: params.owner_id,
        document_id,
        document,
        project_revision: metadata.revision,
    })
}

pub fn save_entity_note(params: SaveEntityNoteParams) -> Result<SaveEntityNoteResult> {
    if params.owner_kind != DocumentOwnerKind::Entity {
        return Err(CoreError::InvalidInput(
            "save_entity_note owner_kind must be ENTITY".to_owned(),
        ));
    }
    validate_non_empty("owner_id", &params.owner_id)?;
    validate_non_empty("document_id", &params.document_id)?;
    validate_editor_metadata(
        &params.editor_engine,
        &params.editor_engine_commit,
        params.editor_schema_version,
    )?;
    let snapshot_blob = BASE64_STANDARD
        .decode(params.snapshot_base64.as_bytes())
        .map_err(|_| CoreError::InvalidInput("snapshot_base64 is not valid base64".to_owned()))?;
    let mut setup = prepare_mutation(
        &params.file_path,
        params.expected_revision,
        params.saved_by.as_deref(),
    )?;
    {
        let transaction = setup
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, setup.expected_revision)?;
        let linked_document = transaction
            .query_row(
                "SELECT document_id FROM entities WHERE id = ?1 AND project_id = ?2",
                params![params.owner_id, setup.before.project_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| entity_not_found(&params.owner_id))?;
        if linked_document != params.document_id {
            return Err(CoreError::InvalidInput(
                "document_id is not owned by the requested entity".to_owned(),
            ));
        }
        let now = database_timestamp(&transaction)?;
        let changed = transaction.execute(
            "UPDATE documents SET editor_engine = ?1, editor_engine_commit = ?2,
                editor_schema_version = ?3, snapshot_blob = ?4,
                plain_text_recovery = ?5, updated_at = ?6
             WHERE id = ?7 AND project_id = ?8",
            params![
                params.editor_engine,
                params.editor_engine_commit,
                params.editor_schema_version,
                snapshot_blob,
                params.plain_text_recovery,
                now,
                params.document_id,
                setup.before.project_id
            ],
        )?;
        if changed != 1 {
            return Err(CoreError::Integrity(
                "entity note document disappeared during save".to_owned(),
            ));
        }
        transaction.execute(
            "UPDATE entities SET updated_at = ?1 WHERE id = ?2",
            params![now, params.owner_id],
        )?;
        bump_revision(&transaction, setup.expected_revision, &setup.saved_by, &now)?;
        transaction.commit()?;
    }
    let document = load_document_summary(&setup.connection, &params.document_id)?;
    let (metadata, backup_file_path) = finish_mutation(setup, &params.file_path)?;
    Ok(SaveEntityNoteResult {
        metadata,
        owner_kind: DocumentOwnerKind::Entity,
        owner_id: params.owner_id,
        generation: params.generation,
        save_sequence: params.save_sequence,
        document,
        backup_file_path,
    })
}

fn load_document_summary(connection: &Connection, document_id: &str) -> Result<DocumentSummary> {
    connection
        .query_row(
            "SELECT id, project_id, title, editor_engine, editor_engine_commit,
                    editor_schema_version, length(snapshot_blob),
                    length(CAST(plain_text_recovery AS BLOB)), created_at, updated_at
             FROM documents WHERE id = ?1",
            [document_id],
            |row| {
                Ok(DocumentSummary {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    title: row.get(2)?,
                    editor_engine: row.get(3)?,
                    editor_engine_commit: row.get(4)?,
                    editor_schema_version: row.get(5)?,
                    snapshot_bytes: row.get::<_, i64>(6)?.max(0) as u64,
                    plain_text_bytes: row.get::<_, i64>(7)?.max(0) as u64,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("document id {document_id}")))
}

fn load_document_record(connection: &Connection, document_id: &str) -> Result<DocumentRecord> {
    connection
        .query_row(
            "SELECT id, project_id, title, editor_engine, editor_engine_commit,
                    editor_schema_version, snapshot_blob, plain_text_recovery,
                    created_at, updated_at FROM documents WHERE id = ?1",
            [document_id],
            |row| {
                Ok(DocumentRecord {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    title: row.get(2)?,
                    editor_engine: row.get(3)?,
                    editor_engine_commit: row.get(4)?,
                    editor_schema_version: row.get(5)?,
                    snapshot_base64: BASE64_STANDARD.encode(row.get::<_, Vec<u8>>(6)?),
                    plain_text_recovery: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("document id {document_id}")))
}

fn load_aliases(connection: &Connection, entity_id: &str) -> Result<Vec<EntityAliasRecord>> {
    let mut statement = connection.prepare(
        "SELECT id, entity_id, alias, normalized_alias, created_at
         FROM entity_aliases WHERE entity_id = ?1 ORDER BY alias, id",
    )?;
    let rows = statement.query_map([entity_id], |row| {
        Ok(EntityAliasRecord {
            id: row.get(0)?,
            entity_id: row.get(1)?,
            alias: row.get(2)?,
            normalized_alias: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;
    let mut aliases = Vec::new();
    for row in rows {
        aliases.push(row?);
    }
    Ok(aliases)
}

pub fn list_entity_aliases(params: ListEntityAliasesParams) -> Result<ListEntityAliasesResult> {
    validate_non_empty("entity_id", &params.entity_id)?;
    let connection = open_existing(&params.file_path)?;
    let metadata = load_app_meta(&connection)?;
    load_project_entity_record(&connection, &metadata.project_id, &params.entity_id)?;
    let aliases = load_aliases(&connection, &params.entity_id)?;
    connection.close().map_err(|(_, error)| error)?;
    Ok(ListEntityAliasesResult { metadata, aliases })
}

pub fn create_entity_alias(params: CreateEntityAliasParams) -> Result<CreateEntityAliasResult> {
    validate_non_empty("entity_id", &params.entity_id)?;
    validate_non_empty("alias", &params.alias)?;
    let normalized = normalize_alias(&params.alias);
    validate_non_empty("normalized_alias", &normalized)?;
    let alias_id = params
        .alias_id
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut setup = prepare_mutation(
        &params.file_path,
        params.expected_revision,
        params.saved_by.as_deref(),
    )?;
    {
        let transaction = setup
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, setup.expected_revision)?;
        let belongs: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM entities WHERE id = ?1 AND project_id = ?2)",
            params![params.entity_id, setup.before.project_id],
            |row| row.get(0),
        )?;
        if !belongs {
            return Err(entity_not_found(&params.entity_id));
        }
        let duplicate: bool = transaction.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM entity_aliases
                WHERE entity_id = ?1 AND normalized_alias = ?2
             )",
            params![params.entity_id, normalized],
            |row| row.get(0),
        )?;
        if duplicate {
            return Err(CoreError::InvalidInput(
                "the normalized alias already exists for this entity".to_owned(),
            ));
        }
        let now = database_timestamp(&transaction)?;
        transaction.execute(
            "INSERT INTO entity_aliases (id, entity_id, alias, normalized_alias, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                alias_id,
                params.entity_id,
                params.alias.trim(),
                normalized,
                now
            ],
        )?;
        transaction.execute(
            "UPDATE entities SET updated_at = ?1 WHERE id = ?2",
            params![now, params.entity_id],
        )?;
        bump_revision(&transaction, setup.expected_revision, &setup.saved_by, &now)?;
        transaction.commit()?;
    }
    let alias = setup.connection.query_row(
        "SELECT id, entity_id, alias, normalized_alias, created_at
         FROM entity_aliases WHERE id = ?1",
        [&alias_id],
        |row| {
            Ok(EntityAliasRecord {
                id: row.get(0)?,
                entity_id: row.get(1)?,
                alias: row.get(2)?,
                normalized_alias: row.get(3)?,
                created_at: row.get(4)?,
            })
        },
    )?;
    let (metadata, backup_file_path) = finish_mutation(setup, &params.file_path)?;
    Ok(CreateEntityAliasResult {
        metadata,
        alias,
        backup_file_path,
    })
}

pub fn delete_entity_alias(params: DeleteEntityAliasParams) -> Result<DeleteEntityAliasResult> {
    validate_non_empty("alias_id", &params.alias_id)?;
    let mut setup = prepare_mutation(
        &params.file_path,
        params.expected_revision,
        params.saved_by.as_deref(),
    )?;
    {
        let transaction = setup
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, setup.expected_revision)?;
        let entity_id = transaction
            .query_row(
                "SELECT a.entity_id FROM entity_aliases a JOIN entities e ON e.id = a.entity_id
                 WHERE a.id = ?1 AND e.project_id = ?2",
                params![params.alias_id, setup.before.project_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| CoreError::NotFound(format!("alias id {}", params.alias_id)))?;
        transaction.execute(
            "DELETE FROM entity_aliases WHERE id = ?1",
            [&params.alias_id],
        )?;
        let now = database_timestamp(&transaction)?;
        transaction.execute(
            "UPDATE entities SET updated_at = ?1 WHERE id = ?2",
            params![now, entity_id],
        )?;
        bump_revision(&transaction, setup.expected_revision, &setup.saved_by, &now)?;
        transaction.commit()?;
    }
    let (metadata, backup_file_path) = finish_mutation(setup, &params.file_path)?;
    Ok(DeleteEntityAliasResult {
        metadata,
        deleted_alias_id: params.alias_id,
        backup_file_path,
    })
}

fn tag_from_row(row: &Row<'_>) -> rusqlite::Result<TagRecord> {
    Ok(TagRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        name: row.get(2)?,
        color_token: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: Some(row.get(5)?),
    })
}

fn load_tag(connection: &Connection, tag_id: &str) -> Result<TagRecord> {
    connection
        .query_row(
            "SELECT id, project_id, name, color_token, created_at, updated_at
             FROM tags WHERE id = ?1",
            [tag_id],
            tag_from_row,
        )
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("tag id {tag_id}")))
}

fn load_entity_tag_ids(connection: &Connection, entity_id: &str) -> Result<HashSet<String>> {
    let mut statement = connection
        .prepare("SELECT tag_id FROM entity_tags WHERE entity_id = ?1 ORDER BY tag_id")?;
    let rows = statement.query_map([entity_id], |row| row.get::<_, String>(0))?;
    let mut ids = HashSet::new();
    for row in rows {
        ids.insert(row?);
    }
    Ok(ids)
}

fn load_entity_tags(connection: &Connection, entity_id: &str) -> Result<Vec<TagRecord>> {
    let mut statement = connection.prepare(
        "SELECT t.id, t.project_id, t.name, t.color_token, t.created_at, t.updated_at
         FROM tags t JOIN entity_tags et ON et.tag_id = t.id
         WHERE et.entity_id = ?1 ORDER BY t.name, t.id",
    )?;
    let rows = statement.query_map([entity_id], tag_from_row)?;
    let mut tags = Vec::new();
    for row in rows {
        tags.push(row?);
    }
    Ok(tags)
}

pub fn list_tags(params: ListTagsParams) -> Result<ListTagsResult> {
    let connection = open_existing(&params.file_path)?;
    let metadata = load_app_meta(&connection)?;
    let mut statement = connection.prepare(
        "SELECT id, project_id, name, color_token, created_at, updated_at
         FROM tags WHERE project_id = ?1 ORDER BY name, id",
    )?;
    let rows = statement.query_map([&metadata.project_id], tag_from_row)?;
    let mut tags = Vec::new();
    for row in rows {
        tags.push(row?);
    }
    drop(statement);
    connection.close().map_err(|(_, error)| error)?;
    Ok(ListTagsResult { metadata, tags })
}

pub fn list_entity_tags(params: ListEntityTagsParams) -> Result<ListEntityTagsResult> {
    validate_non_empty("entity_id", &params.entity_id)?;
    let connection = open_existing(&params.file_path)?;
    let metadata = load_app_meta(&connection)?;
    load_project_entity_record(&connection, &metadata.project_id, &params.entity_id)?;
    let tags = load_entity_tags(&connection, &params.entity_id)?;
    connection.close().map_err(|(_, error)| error)?;
    Ok(ListEntityTagsResult {
        metadata,
        entity_id: params.entity_id,
        tags,
    })
}

pub fn create_tag(params: CreateTagParams) -> Result<TagMutationResult> {
    validate_non_empty("name", &params.name)?;
    let tag_id = params.tag_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut setup = prepare_mutation(
        &params.file_path,
        params.expected_revision,
        params.saved_by.as_deref(),
    )?;
    {
        let transaction = setup
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, setup.expected_revision)?;
        let now = database_timestamp(&transaction)?;
        transaction.execute(
            "INSERT INTO tags (id, project_id, name, color_token, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![
                tag_id,
                setup.before.project_id,
                params.name.trim(),
                clean_optional(params.color_token),
                now
            ],
        )?;
        bump_revision(&transaction, setup.expected_revision, &setup.saved_by, &now)?;
        transaction.commit()?;
    }
    let tag = load_tag(&setup.connection, &tag_id)?;
    let (metadata, backup_file_path) = finish_mutation(setup, &params.file_path)?;
    Ok(TagMutationResult {
        metadata,
        tag,
        backup_file_path,
    })
}

pub fn update_tag(params: UpdateTagParams) -> Result<TagMutationResult> {
    validate_non_empty("tag_id", &params.tag_id)?;
    validate_non_empty("name", &params.name)?;
    let mut setup = prepare_mutation(
        &params.file_path,
        params.expected_revision,
        params.saved_by.as_deref(),
    )?;
    {
        let transaction = setup
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, setup.expected_revision)?;
        let now = database_timestamp(&transaction)?;
        let changed = transaction.execute(
            "UPDATE tags SET name = ?1, color_token = ?2, updated_at = ?3
             WHERE id = ?4 AND project_id = ?5",
            params![
                params.name.trim(),
                clean_optional(params.color_token),
                now,
                params.tag_id,
                setup.before.project_id
            ],
        )?;
        if changed != 1 {
            return Err(CoreError::NotFound(format!("tag id {}", params.tag_id)));
        }
        bump_revision(&transaction, setup.expected_revision, &setup.saved_by, &now)?;
        transaction.commit()?;
    }
    let tag = load_tag(&setup.connection, &params.tag_id)?;
    let (metadata, backup_file_path) = finish_mutation(setup, &params.file_path)?;
    Ok(TagMutationResult {
        metadata,
        tag,
        backup_file_path,
    })
}

pub fn delete_tag(params: DeleteTagParams) -> Result<DeleteTagResult> {
    validate_non_empty("tag_id", &params.tag_id)?;
    let mut setup = prepare_mutation(
        &params.file_path,
        params.expected_revision,
        params.saved_by.as_deref(),
    )?;
    {
        let transaction = setup
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, setup.expected_revision)?;
        let changed = transaction.execute(
            "DELETE FROM tags WHERE id = ?1 AND project_id = ?2",
            params![params.tag_id, setup.before.project_id],
        )?;
        if changed != 1 {
            return Err(CoreError::NotFound(format!("tag id {}", params.tag_id)));
        }
        let now = database_timestamp(&transaction)?;
        bump_revision(&transaction, setup.expected_revision, &setup.saved_by, &now)?;
        transaction.commit()?;
    }
    let (metadata, backup_file_path) = finish_mutation(setup, &params.file_path)?;
    Ok(DeleteTagResult {
        metadata,
        deleted_tag_id: params.tag_id,
        backup_file_path,
    })
}

pub fn set_entity_tags(params: SetEntityTagsParams) -> Result<SetEntityTagsResult> {
    validate_non_empty("entity_id", &params.entity_id)?;
    let unique = params.tag_ids.iter().collect::<HashSet<_>>();
    if unique.len() != params.tag_ids.len() {
        return Err(CoreError::InvalidInput(
            "tag_ids must not contain duplicates".to_owned(),
        ));
    }
    let mut setup = prepare_mutation(
        &params.file_path,
        params.expected_revision,
        params.saved_by.as_deref(),
    )?;
    {
        let transaction = setup
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, setup.expected_revision)?;
        let entity_exists: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM entities WHERE id = ?1 AND project_id = ?2)",
            params![params.entity_id, setup.before.project_id],
            |row| row.get(0),
        )?;
        if !entity_exists {
            return Err(entity_not_found(&params.entity_id));
        }
        for tag_id in &params.tag_ids {
            let valid: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM tags WHERE id = ?1 AND project_id = ?2)",
                params![tag_id, setup.before.project_id],
                |row| row.get(0),
            )?;
            if !valid {
                return Err(CoreError::InvalidInput(format!(
                    "tag {tag_id} does not belong to this project"
                )));
            }
        }
        transaction.execute(
            "DELETE FROM entity_tags WHERE entity_id = ?1",
            [&params.entity_id],
        )?;
        for tag_id in &params.tag_ids {
            transaction.execute(
                "INSERT INTO entity_tags (entity_id, tag_id) VALUES (?1, ?2)",
                params![params.entity_id, tag_id],
            )?;
        }
        let now = database_timestamp(&transaction)?;
        transaction.execute(
            "UPDATE entities SET updated_at = ?1 WHERE id = ?2",
            params![now, params.entity_id],
        )?;
        bump_revision(&transaction, setup.expected_revision, &setup.saved_by, &now)?;
        transaction.commit()?;
    }
    let tags = load_entity_tags(&setup.connection, &params.entity_id)?;
    let (metadata, backup_file_path) = finish_mutation(setup, &params.file_path)?;
    Ok(SetEntityTagsResult {
        metadata,
        entity_id: params.entity_id,
        tags,
        backup_file_path,
    })
}

fn relation_type_from_row(row: &Row<'_>) -> rusqlite::Result<RelationTypeRecord> {
    Ok(RelationTypeRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        name: row.get(2)?,
        inverse_name: row.get(3)?,
        directed: row.get(4)?,
        color_token: row.get(5)?,
        is_builtin: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn load_relation_type(
    connection: &Connection,
    relation_type_id: &str,
) -> Result<RelationTypeRecord> {
    connection
        .query_row(
            "SELECT id, project_id, name, inverse_name, directed, color_token,
                    is_builtin, created_at, updated_at
             FROM relation_types WHERE id = ?1",
            [relation_type_id],
            relation_type_from_row,
        )
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("relation type id {relation_type_id}")))
}

pub fn list_relation_types(params: ListRelationTypesParams) -> Result<ListRelationTypesResult> {
    let connection = open_existing(&params.file_path)?;
    let metadata = load_app_meta(&connection)?;
    let mut statement = connection.prepare(
        "SELECT id, project_id, name, inverse_name, directed, color_token,
                is_builtin, created_at, updated_at
         FROM relation_types WHERE project_id = ?1
         ORDER BY is_builtin DESC, name, id",
    )?;
    let rows = statement.query_map([&metadata.project_id], relation_type_from_row)?;
    let mut relation_types = Vec::new();
    for row in rows {
        relation_types.push(row?);
    }
    drop(statement);
    connection.close().map_err(|(_, error)| error)?;
    Ok(ListRelationTypesResult {
        metadata,
        relation_types,
    })
}

pub fn create_relation_type(
    params: CreateRelationTypeParams,
) -> Result<RelationTypeMutationResult> {
    validate_non_empty("name", &params.name)?;
    let relation_type_id = params
        .relation_type_id
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let inverse_name = clean_optional(params.inverse_name);
    let mut setup = prepare_mutation(
        &params.file_path,
        params.expected_revision,
        params.saved_by.as_deref(),
    )?;
    {
        let transaction = setup
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, setup.expected_revision)?;
        let now = database_timestamp(&transaction)?;
        transaction.execute(
            "INSERT INTO relation_types (
                id, project_id, name, inverse_name, directed, color_token,
                is_builtin, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?7)",
            params![
                relation_type_id,
                setup.before.project_id,
                params.name.trim(),
                inverse_name,
                params.directed,
                clean_optional(params.color_token),
                now
            ],
        )?;
        bump_revision(&transaction, setup.expected_revision, &setup.saved_by, &now)?;
        transaction.commit()?;
    }
    let relation_type = load_relation_type(&setup.connection, &relation_type_id)?;
    let (metadata, backup_file_path) = finish_mutation(setup, &params.file_path)?;
    Ok(RelationTypeMutationResult {
        metadata,
        relation_type,
        backup_file_path,
    })
}

pub fn update_relation_type(
    params: UpdateRelationTypeParams,
) -> Result<RelationTypeMutationResult> {
    validate_non_empty("relation_type_id", &params.relation_type_id)?;
    validate_non_empty("name", &params.name)?;
    let inverse_name = clean_optional(params.inverse_name);
    let mut setup = prepare_mutation(
        &params.file_path,
        params.expected_revision,
        params.saved_by.as_deref(),
    )?;
    {
        let transaction = setup
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, setup.expected_revision)?;
        if !params.directed {
            let reverse_duplicates: i64 = transaction.query_row(
                "SELECT count(*) FROM entity_relations a
                 JOIN entity_relations b
                   ON b.relation_type_id = a.relation_type_id
                  AND b.source_entity_id = a.target_entity_id
                  AND b.target_entity_id = a.source_entity_id
                  AND b.id > a.id
                 WHERE a.relation_type_id = ?1",
                [&params.relation_type_id],
                |row| row.get(0),
            )?;
            if reverse_duplicates != 0 {
                return Err(CoreError::InvalidInput(
                    "relation type cannot become undirected while reverse duplicates exist"
                        .to_owned(),
                ));
            }
        }
        let now = database_timestamp(&transaction)?;
        let changed = transaction.execute(
            "UPDATE relation_types SET name = ?1, inverse_name = ?2, directed = ?3,
                color_token = ?4, updated_at = ?5
             WHERE id = ?6 AND project_id = ?7",
            params![
                params.name.trim(),
                inverse_name,
                params.directed,
                clean_optional(params.color_token),
                now,
                params.relation_type_id,
                setup.before.project_id
            ],
        )?;
        if changed != 1 {
            return Err(CoreError::NotFound(format!(
                "relation type id {}",
                params.relation_type_id
            )));
        }
        bump_revision(&transaction, setup.expected_revision, &setup.saved_by, &now)?;
        transaction.commit()?;
    }
    let relation_type = load_relation_type(&setup.connection, &params.relation_type_id)?;
    let (metadata, backup_file_path) = finish_mutation(setup, &params.file_path)?;
    Ok(RelationTypeMutationResult {
        metadata,
        relation_type,
        backup_file_path,
    })
}

pub fn delete_relation_type(params: DeleteRelationTypeParams) -> Result<DeleteRelationTypeResult> {
    validate_non_empty("relation_type_id", &params.relation_type_id)?;
    let mut setup = prepare_mutation(
        &params.file_path,
        params.expected_revision,
        params.saved_by.as_deref(),
    )?;
    {
        let transaction = setup
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, setup.expected_revision)?;
        let stored = transaction
            .query_row(
                "SELECT is_builtin, project_id FROM relation_types WHERE id = ?1",
                [&params.relation_type_id],
                |row| Ok((row.get::<_, bool>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
            .ok_or_else(|| {
                CoreError::NotFound(format!("relation type id {}", params.relation_type_id))
            })?;
        if stored.1 != setup.before.project_id {
            return Err(CoreError::NotFound(format!(
                "relation type id {}",
                params.relation_type_id
            )));
        }
        if stored.0 {
            return Err(CoreError::InvalidInput(
                "built-in relation types cannot be deleted".to_owned(),
            ));
        }
        let in_use: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM entity_relations WHERE relation_type_id = ?1)",
            [&params.relation_type_id],
            |row| row.get(0),
        )?;
        if in_use {
            return Err(CoreError::InvalidInput(
                "relation type is in use and cannot be deleted".to_owned(),
            ));
        }
        transaction.execute(
            "DELETE FROM relation_types WHERE id = ?1",
            [&params.relation_type_id],
        )?;
        let now = database_timestamp(&transaction)?;
        bump_revision(&transaction, setup.expected_revision, &setup.saved_by, &now)?;
        transaction.commit()?;
    }
    let (metadata, backup_file_path) = finish_mutation(setup, &params.file_path)?;
    Ok(DeleteRelationTypeResult {
        metadata,
        deleted_relation_type_id: params.relation_type_id,
        backup_file_path,
    })
}

fn relation_from_row(row: &Row<'_>) -> rusqlite::Result<EntityRelationRecord> {
    Ok(EntityRelationRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        source_entity_id: row.get(2)?,
        relation_type_id: row.get(3)?,
        target_entity_id: row.get(4)?,
        note: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn load_relation(connection: &Connection, relation_id: &str) -> Result<EntityRelationRecord> {
    connection
        .query_row(
            "SELECT id, project_id, source_entity_id, relation_type_id,
                    target_entity_id, note, created_at, updated_at
             FROM entity_relations WHERE id = ?1",
            [relation_id],
            relation_from_row,
        )
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("entity relation id {relation_id}")))
}

pub fn list_entity_relations(
    params: ListEntityRelationsParams,
) -> Result<ListEntityRelationsResult> {
    if let Some(entity_id) = params.entity_id.as_deref() {
        validate_non_empty("entity_id", entity_id)?;
    }
    let connection = open_existing(&params.file_path)?;
    let metadata = load_app_meta(&connection)?;
    let mut statement = connection.prepare(
        "SELECT id, project_id, source_entity_id, relation_type_id,
                target_entity_id, note, created_at, updated_at
         FROM entity_relations
         WHERE project_id = ?1
           AND (?2 IS NULL OR source_entity_id = ?2 OR target_entity_id = ?2)
         ORDER BY updated_at DESC, id",
    )?;
    let rows = statement.query_map(
        params![metadata.project_id, params.entity_id],
        relation_from_row,
    )?;
    let mut relations = Vec::new();
    for row in rows {
        relations.push(row?);
    }
    drop(statement);
    connection.close().map_err(|(_, error)| error)?;
    Ok(ListEntityRelationsResult {
        metadata,
        relations,
    })
}

fn validate_relation_members(
    transaction: &Transaction<'_>,
    project_id: &str,
    source_entity_id: &str,
    relation_type_id: &str,
    target_entity_id: &str,
    excluding_relation_id: Option<&str>,
) -> Result<()> {
    if source_entity_id == target_entity_id {
        return Err(CoreError::InvalidInput(
            "self relations are not supported in schema version 4".to_owned(),
        ));
    }
    let source_project = transaction
        .query_row(
            "SELECT project_id FROM entities WHERE id = ?1",
            [source_entity_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| entity_not_found(source_entity_id))?;
    let target_project = transaction
        .query_row(
            "SELECT project_id FROM entities WHERE id = ?1",
            [target_entity_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| entity_not_found(target_entity_id))?;
    let relation_type = transaction
        .query_row(
            "SELECT project_id, directed FROM relation_types WHERE id = ?1",
            [relation_type_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?)),
        )
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("relation type id {relation_type_id}")))?;
    if source_project != project_id || target_project != project_id || relation_type.0 != project_id
    {
        return Err(CoreError::InvalidInput(
            "cross-project entity relations are forbidden".to_owned(),
        ));
    }
    let duplicate: bool = if relation_type.1 {
        transaction.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM entity_relations
                WHERE project_id = ?1 AND source_entity_id = ?2
                  AND relation_type_id = ?3 AND target_entity_id = ?4
                  AND (?5 IS NULL OR id <> ?5)
             )",
            params![
                project_id,
                source_entity_id,
                relation_type_id,
                target_entity_id,
                excluding_relation_id
            ],
            |row| row.get(0),
        )?
    } else {
        transaction.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM entity_relations
                WHERE project_id = ?1 AND relation_type_id = ?2
                  AND ((source_entity_id = ?3 AND target_entity_id = ?4)
                    OR (source_entity_id = ?4 AND target_entity_id = ?3))
                  AND (?5 IS NULL OR id <> ?5)
             )",
            params![
                project_id,
                relation_type_id,
                source_entity_id,
                target_entity_id,
                excluding_relation_id
            ],
            |row| row.get(0),
        )?
    };
    if duplicate {
        return Err(CoreError::InvalidInput(
            "an equivalent entity relation already exists".to_owned(),
        ));
    }
    Ok(())
}

pub fn create_entity_relation(
    params: CreateEntityRelationParams,
) -> Result<EntityRelationMutationResult> {
    validate_non_empty("source_entity_id", &params.source_entity_id)?;
    validate_non_empty("relation_type_id", &params.relation_type_id)?;
    validate_non_empty("target_entity_id", &params.target_entity_id)?;
    let relation_id = params
        .relation_id
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut setup = prepare_mutation(
        &params.file_path,
        params.expected_revision,
        params.saved_by.as_deref(),
    )?;
    {
        let transaction = setup
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, setup.expected_revision)?;
        validate_relation_members(
            &transaction,
            &setup.before.project_id,
            &params.source_entity_id,
            &params.relation_type_id,
            &params.target_entity_id,
            None,
        )?;
        let now = database_timestamp(&transaction)?;
        transaction.execute(
            "INSERT INTO entity_relations (
                id, project_id, source_entity_id, relation_type_id,
                target_entity_id, note, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![
                relation_id,
                setup.before.project_id,
                params.source_entity_id,
                params.relation_type_id,
                params.target_entity_id,
                clean_optional(params.note),
                now
            ],
        )?;
        bump_revision(&transaction, setup.expected_revision, &setup.saved_by, &now)?;
        transaction.commit()?;
    }
    let relation = load_relation(&setup.connection, &relation_id)?;
    let (metadata, backup_file_path) = finish_mutation(setup, &params.file_path)?;
    Ok(EntityRelationMutationResult {
        metadata,
        relation,
        backup_file_path,
    })
}

pub fn update_entity_relation(
    params: UpdateEntityRelationParams,
) -> Result<EntityRelationMutationResult> {
    validate_non_empty("relation_id", &params.relation_id)?;
    validate_non_empty("relation_type_id", &params.relation_type_id)?;
    validate_non_empty("target_entity_id", &params.target_entity_id)?;
    let mut setup = prepare_mutation(
        &params.file_path,
        params.expected_revision,
        params.saved_by.as_deref(),
    )?;
    {
        let transaction = setup
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, setup.expected_revision)?;
        let existing = transaction
            .query_row(
                "SELECT source_entity_id, project_id FROM entity_relations WHERE id = ?1",
                [&params.relation_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
            .ok_or_else(|| {
                CoreError::NotFound(format!("entity relation id {}", params.relation_id))
            })?;
        if existing.1 != setup.before.project_id {
            return Err(CoreError::NotFound(format!(
                "entity relation id {}",
                params.relation_id
            )));
        }
        validate_relation_members(
            &transaction,
            &setup.before.project_id,
            &existing.0,
            &params.relation_type_id,
            &params.target_entity_id,
            Some(&params.relation_id),
        )?;
        let now = database_timestamp(&transaction)?;
        transaction.execute(
            "UPDATE entity_relations SET relation_type_id = ?1,
                target_entity_id = ?2, note = ?3, updated_at = ?4
             WHERE id = ?5",
            params![
                params.relation_type_id,
                params.target_entity_id,
                clean_optional(params.note),
                now,
                params.relation_id
            ],
        )?;
        bump_revision(&transaction, setup.expected_revision, &setup.saved_by, &now)?;
        transaction.commit()?;
    }
    let relation = load_relation(&setup.connection, &params.relation_id)?;
    let (metadata, backup_file_path) = finish_mutation(setup, &params.file_path)?;
    Ok(EntityRelationMutationResult {
        metadata,
        relation,
        backup_file_path,
    })
}

pub fn delete_entity_relation(
    params: DeleteEntityRelationParams,
) -> Result<DeleteEntityRelationResult> {
    validate_non_empty("relation_id", &params.relation_id)?;
    let mut setup = prepare_mutation(
        &params.file_path,
        params.expected_revision,
        params.saved_by.as_deref(),
    )?;
    {
        let transaction = setup
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, setup.expected_revision)?;
        let changed = transaction.execute(
            "DELETE FROM entity_relations WHERE id = ?1 AND project_id = ?2",
            params![params.relation_id, setup.before.project_id],
        )?;
        if changed != 1 {
            return Err(CoreError::NotFound(format!(
                "entity relation id {}",
                params.relation_id
            )));
        }
        let now = database_timestamp(&transaction)?;
        bump_revision(&transaction, setup.expected_revision, &setup.saved_by, &now)?;
        transaction.commit()?;
    }
    let (metadata, backup_file_path) = finish_mutation(setup, &params.file_path)?;
    Ok(DeleteEntityRelationResult {
        metadata,
        deleted_relation_id: params.relation_id,
        backup_file_path,
    })
}

fn scene_link_from_row(row: &Row<'_>) -> rusqlite::Result<SceneEntityLinkRecord> {
    let role = row.get::<_, String>(2)?;
    Ok(SceneEntityLinkRecord {
        scene_node_id: row.get(0)?,
        entity_id: row.get(1)?,
        role: SceneEntityRole::from_str(&role).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                2,
                rusqlite::types::Type::Text,
                std::io::Error::new(std::io::ErrorKind::InvalidData, error).into(),
            )
        })?,
        note: row.get(3)?,
        created_at: row.get(4)?,
    })
}

pub fn list_scene_entity_links(
    params: ListSceneEntityLinksParams,
) -> Result<ListSceneEntityLinksResult> {
    let connection = open_existing(&params.file_path)?;
    let metadata = load_app_meta(&connection)?;
    let mut statement = connection.prepare(
        "SELECT l.scene_node_id, l.entity_id, l.role, l.note, l.created_at
         FROM scene_entity_links l
         JOIN tree_nodes n ON n.id = l.scene_node_id
         JOIN entities e ON e.id = l.entity_id
         WHERE n.project_id = ?1 AND e.project_id = ?1
           AND (?2 IS NULL OR l.scene_node_id = ?2)
           AND (?3 IS NULL OR l.entity_id = ?3)
         ORDER BY n.order_key, l.role, l.entity_id",
    )?;
    let rows = statement.query_map(
        params![metadata.project_id, params.scene_node_id, params.entity_id],
        scene_link_from_row,
    )?;
    let mut links = Vec::new();
    for row in rows {
        links.push(row?);
    }
    drop(statement);
    connection.close().map_err(|(_, error)| error)?;
    Ok(ListSceneEntityLinksResult { metadata, links })
}

fn validate_scene_link_members(
    transaction: &Transaction<'_>,
    project_id: &str,
    scene_node_id: &str,
    entity_id: &str,
) -> Result<()> {
    let scene = transaction
        .query_row(
            "SELECT project_id, kind FROM tree_nodes WHERE id = ?1",
            [scene_node_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?
        .ok_or_else(|| CoreError::NodeNotFound {
            node_id: scene_node_id.to_owned(),
        })?;
    if scene.1 != "SCENE" {
        return Err(CoreError::NodeKindMismatch {
            node_id: scene_node_id.to_owned(),
            expected: "SCENE",
            actual: scene.1,
        });
    }
    let entity_project = transaction
        .query_row(
            "SELECT project_id FROM entities WHERE id = ?1",
            [entity_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| entity_not_found(entity_id))?;
    if scene.0 != project_id || entity_project != project_id {
        return Err(CoreError::InvalidInput(
            "cross-project scene entity links are forbidden".to_owned(),
        ));
    }
    Ok(())
}

fn load_scene_link(
    connection: &Connection,
    scene_node_id: &str,
    entity_id: &str,
    role: SceneEntityRole,
) -> Result<SceneEntityLinkRecord> {
    connection
        .query_row(
            "SELECT scene_node_id, entity_id, role, note, created_at
             FROM scene_entity_links
             WHERE scene_node_id = ?1 AND entity_id = ?2 AND role = ?3",
            params![scene_node_id, entity_id, role.as_str()],
            scene_link_from_row,
        )
        .optional()?
        .ok_or_else(|| CoreError::NotFound("scene entity link".to_owned()))
}

pub fn create_scene_entity_link(
    params: CreateSceneEntityLinkParams,
) -> Result<SceneEntityLinkMutationResult> {
    validate_non_empty("scene_node_id", &params.scene_node_id)?;
    validate_non_empty("entity_id", &params.entity_id)?;
    let mut setup = prepare_mutation(
        &params.file_path,
        params.expected_revision,
        params.saved_by.as_deref(),
    )?;
    {
        let transaction = setup
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, setup.expected_revision)?;
        validate_scene_link_members(
            &transaction,
            &setup.before.project_id,
            &params.scene_node_id,
            &params.entity_id,
        )?;
        let duplicate: bool = transaction.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM scene_entity_links
                WHERE scene_node_id = ?1 AND entity_id = ?2 AND role = ?3
             )",
            params![params.scene_node_id, params.entity_id, params.role.as_str()],
            |row| row.get(0),
        )?;
        if duplicate {
            return Err(CoreError::InvalidInput(
                "the scene entity link already exists".to_owned(),
            ));
        }
        let now = database_timestamp(&transaction)?;
        transaction.execute(
            "INSERT INTO scene_entity_links (
                scene_node_id, entity_id, role, note, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                params.scene_node_id,
                params.entity_id,
                params.role.as_str(),
                clean_optional(params.note),
                now
            ],
        )?;
        bump_revision(&transaction, setup.expected_revision, &setup.saved_by, &now)?;
        transaction.commit()?;
    }
    let link = load_scene_link(
        &setup.connection,
        &params.scene_node_id,
        &params.entity_id,
        params.role,
    )?;
    let (metadata, backup_file_path) = finish_mutation(setup, &params.file_path)?;
    Ok(SceneEntityLinkMutationResult {
        metadata,
        link,
        backup_file_path,
    })
}

pub fn delete_scene_entity_link(
    params: DeleteSceneEntityLinkParams,
) -> Result<DeleteSceneEntityLinkResult> {
    validate_non_empty("scene_node_id", &params.scene_node_id)?;
    validate_non_empty("entity_id", &params.entity_id)?;
    let mut setup = prepare_mutation(
        &params.file_path,
        params.expected_revision,
        params.saved_by.as_deref(),
    )?;
    {
        let transaction = setup
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, setup.expected_revision)?;
        let changed = transaction.execute(
            "DELETE FROM scene_entity_links
             WHERE scene_node_id = ?1 AND entity_id = ?2 AND role = ?3",
            params![params.scene_node_id, params.entity_id, params.role.as_str()],
        )?;
        if changed != 1 {
            return Err(CoreError::NotFound("scene entity link".to_owned()));
        }
        let now = database_timestamp(&transaction)?;
        bump_revision(&transaction, setup.expected_revision, &setup.saved_by, &now)?;
        transaction.commit()?;
    }
    let (metadata, backup_file_path) = finish_mutation(setup, &params.file_path)?;
    Ok(DeleteSceneEntityLinkResult {
        metadata,
        deleted_link: DeletedSceneEntityLink {
            scene_node_id: params.scene_node_id,
            entity_id: params.entity_id,
            role: params.role,
        },
        backup_file_path,
    })
}

pub fn promote_entity_mention(
    params: PromoteEntityMentionParams,
) -> Result<SceneEntityLinkMutationResult> {
    create_scene_entity_link(CreateSceneEntityLinkParams {
        file_path: params.file_path,
        scene_node_id: params.scene_node_id,
        entity_id: params.entity_id,
        role: params.role,
        note: params.note,
        expected_revision: params.expected_revision,
        saved_by: params.saved_by,
    })
}

#[derive(Clone)]
struct MentionTerm {
    text: String,
}

fn exact_occurrences(haystack: &str, needle: &str) -> Vec<(usize, usize, u64, u64)> {
    if needle.is_empty() {
        return Vec::new();
    }
    let mut matches = Vec::new();
    let mut cursor = 0_usize;
    while cursor <= haystack.len() {
        let Some(relative) = haystack[cursor..].find(needle) else {
            break;
        };
        let start_byte = cursor + relative;
        let end_byte = start_byte + needle.len();
        let start_char = haystack[..start_byte].chars().count() as u64;
        let end_char = start_char + needle.chars().count() as u64;
        matches.push((start_byte, end_byte, start_char, end_char));
        cursor = end_byte;
    }
    matches
}

fn mention_context(text: &str, start_byte: usize, end_byte: usize) -> (String, String, String) {
    let mut before = text[..start_byte]
        .chars()
        .rev()
        .take(MENTION_CONTEXT_CHARS)
        .collect::<Vec<_>>();
    before.reverse();
    (
        before.into_iter().collect(),
        text[start_byte..end_byte].to_owned(),
        text[end_byte..]
            .chars()
            .take(MENTION_CONTEXT_CHARS)
            .collect(),
    )
}

fn discover_mentions_connection(
    connection: &Connection,
    project_id: &str,
    entity_id: &str,
) -> Result<Vec<EntityMentionCandidate>> {
    let entity = load_project_entity_record(connection, project_id, entity_id)?;
    let aliases = load_aliases(connection, entity_id)?;
    let mut terms = vec![MentionTerm {
        text: entity.name.clone(),
    }];
    for alias in aliases {
        if !terms.iter().any(|term| term.text == alias.alias) {
            terms.push(MentionTerm { text: alias.alias });
        }
    }
    let mut statement = connection.prepare(
        "WITH RECURSIVE ordered(id, path) AS (
             SELECT id, printf('%020.6f:%s', order_key, id)
             FROM tree_nodes
             WHERE project_id = ?1 AND kind = 'WORK' AND parent_id IS NULL
             UNION ALL
             SELECT child.id,
                    ordered.path || '/' || printf('%020.6f:%s', child.order_key, child.id)
             FROM tree_nodes child JOIN ordered ON child.parent_id = ordered.id
             WHERE child.project_id = ?1
         )
         SELECT n.id, n.title, n.document_id, d.plain_text_recovery
         FROM ordered
         JOIN tree_nodes n ON n.id = ordered.id
         JOIN documents d ON d.id = n.document_id
         WHERE n.kind = 'SCENE'
         ORDER BY ordered.path",
    )?;
    let rows = statement.query_map([project_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;
    let mut candidates = Vec::new();
    for row in rows {
        let (scene_id, scene_title, document_id, text) = row?;
        let mut first: Option<(usize, usize, u64, u64, String)> = None;
        for term in &terms {
            if let Some((start_byte, end_byte, start_char, end_char)) =
                exact_occurrences(&text, &term.text).into_iter().next()
            {
                let candidate = (
                    start_byte,
                    end_byte,
                    start_char,
                    end_char,
                    term.text.clone(),
                );
                if first
                    .as_ref()
                    .is_none_or(|stored| (candidate.0, &candidate.4) < (stored.0, &stored.4))
                {
                    first = Some(candidate);
                }
            }
        }
        let Some((start_byte, end_byte, start, end, matched_alias)) = first else {
            continue;
        };
        let already_linked: bool = connection.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM scene_entity_links
                WHERE scene_node_id = ?1 AND entity_id = ?2
             )",
            params![scene_id, entity_id],
            |row| row.get(0),
        )?;
        let (context_before, matched_text, context_after) =
            mention_context(&text, start_byte, end_byte);
        let occurrence_id = format!(
            "{:x}",
            Sha256::digest(
                format!("{entity_id}\0{scene_id}\0{start}\0{end}\0{matched_alias}").as_bytes()
            )
        );
        candidates.push(EntityMentionCandidate {
            occurrence_id,
            entity_id: entity_id.to_owned(),
            scene_node_id: scene_id,
            scene_title,
            document_id,
            matched_alias,
            context_before,
            matched_text,
            context_after,
            start,
            end,
            already_linked,
        });
    }
    Ok(candidates)
}

pub fn discover_entity_mentions(
    params: DiscoverEntityMentionsParams,
) -> Result<DiscoverEntityMentionsResult> {
    validate_non_empty("entity_id", &params.entity_id)?;
    let limit = params.limit.unwrap_or(DEFAULT_SEARCH_LIMIT);
    if limit == 0 || limit > MAX_SEARCH_LIMIT {
        return Err(CoreError::InvalidInput(format!(
            "mention limit must be between 1 and {MAX_SEARCH_LIMIT}"
        )));
    }
    let connection = open_existing(&params.file_path)?;
    let metadata = load_app_meta(&connection)?;
    let all = discover_mentions_connection(&connection, &metadata.project_id, &params.entity_id)?;
    let total_scenes = all.len() as u64;
    let candidates = all
        .into_iter()
        .skip(params.offset.min(usize::MAX as u64) as usize)
        .take(limit as usize)
        .collect::<Vec<_>>();
    let has_more = params.offset.saturating_add(candidates.len() as u64) < total_scenes;
    connection.close().map_err(|(_, error)| error)?;
    Ok(DiscoverEntityMentionsResult {
        metadata,
        entity_id: params.entity_id,
        total_scenes,
        offset: params.offset,
        limit,
        has_more,
        candidates,
    })
}

pub fn search_entities(params: SearchEntitiesParams) -> Result<SearchEntitiesResult> {
    validate_non_empty("query", &params.query)?;
    let limit = params.limit.unwrap_or(DEFAULT_SEARCH_LIMIT);
    if limit == 0 || limit > MAX_SEARCH_LIMIT {
        return Err(CoreError::InvalidInput(format!(
            "entity search limit must be between 1 and {MAX_SEARCH_LIMIT}"
        )));
    }
    let query = params.query.trim().to_lowercase();
    let connection = open_existing(&params.file_path)?;
    let metadata = load_app_meta(&connection)?;
    let entities = load_all_entities(&connection, &metadata.project_id)?;
    let mut all_hits = Vec::new();
    for entity in entities {
        let aliases = load_aliases(&connection, &entity.id)?;
        let tags = load_entity_tags(&connection, &entity.id)?;
        let note: String = connection.query_row(
            "SELECT plain_text_recovery FROM documents WHERE id = ?1",
            [&entity.document_id],
            |row| row.get(0),
        )?;
        let mut fields = Vec::new();
        let mut matched_text = String::new();
        if entity.name.to_lowercase().contains(&query) {
            fields.push("NAME".to_owned());
            matched_text = entity.name.clone();
        }
        if let Some(alias) = aliases
            .iter()
            .find(|alias| alias.alias.to_lowercase().contains(&query))
        {
            fields.push("ALIAS".to_owned());
            if matched_text.is_empty() {
                matched_text = alias.alias.clone();
            }
        }
        if let Some(summary) = entity
            .summary
            .as_deref()
            .filter(|summary| summary.to_lowercase().contains(&query))
        {
            fields.push("SUMMARY".to_owned());
            if matched_text.is_empty() {
                matched_text = summary.to_owned();
            }
        }
        if let Some(tag) = tags
            .iter()
            .find(|tag| tag.name.to_lowercase().contains(&query))
        {
            fields.push("TAG".to_owned());
            if matched_text.is_empty() {
                matched_text = tag.name.clone();
            }
        }
        if note.to_lowercase().contains(&query) {
            fields.push("NOTE".to_owned());
            if matched_text.is_empty() {
                matched_text = params.query.clone();
            }
        }
        if !fields.is_empty() {
            all_hits.push(EntitySearchHit {
                entity,
                matched_fields: fields,
                matched_text,
            });
        }
    }
    all_hits.sort_by(|left, right| {
        left.entity
            .name
            .to_lowercase()
            .cmp(&right.entity.name.to_lowercase())
            .then_with(|| left.entity.id.cmp(&right.entity.id))
    });
    let total_matches = all_hits.len() as u64;
    let hits = all_hits
        .into_iter()
        .skip(params.offset.min(usize::MAX as u64) as usize)
        .take(limit as usize)
        .collect::<Vec<_>>();
    let has_more = params.offset.saturating_add(hits.len() as u64) < total_matches;
    connection.close().map_err(|(_, error)| error)?;
    Ok(SearchEntitiesResult {
        metadata,
        query: params.query,
        total_matches,
        offset: params.offset,
        limit,
        has_more,
        hits,
    })
}

fn entity_delete_impact_connection(
    connection: &Connection,
    project_id: &str,
    entity_id: &str,
) -> Result<EntityDeleteImpact> {
    let entity = load_project_entity_record(connection, project_id, entity_id)?;
    let relation_count: i64 = connection.query_row(
        "SELECT count(*) FROM entity_relations
         WHERE project_id = ?1 AND (source_entity_id = ?2 OR target_entity_id = ?2)",
        params![project_id, entity_id],
        |row| row.get(0),
    )?;
    let scene_link_count: i64 = connection.query_row(
        "SELECT count(DISTINCT scene_node_id) FROM scene_entity_links WHERE entity_id = ?1",
        [entity_id],
        |row| row.get(0),
    )?;
    let alias_count: i64 = connection.query_row(
        "SELECT count(*) FROM entity_aliases WHERE entity_id = ?1",
        [entity_id],
        |row| row.get(0),
    )?;
    let tag_count: i64 = connection.query_row(
        "SELECT count(*) FROM entity_tags WHERE entity_id = ?1",
        [entity_id],
        |row| row.get(0),
    )?;
    let note: String = connection.query_row(
        "SELECT plain_text_recovery FROM documents WHERE id = ?1",
        [&entity.document_id],
        |row| row.get(0),
    )?;
    let mention_scene_count =
        discover_mentions_connection(connection, project_id, entity_id)?.len();
    Ok(EntityDeleteImpact {
        entity_id: entity_id.to_owned(),
        relation_count: relation_count.max(0) as u64,
        scene_link_count: scene_link_count.max(0) as u64,
        mention_scene_count: mention_scene_count as u64,
        alias_count: alias_count.max(0) as u64,
        tag_count: tag_count.max(0) as u64,
        note_character_count: note.chars().count() as u64,
    })
}

pub fn get_entity_delete_impact(
    params: GetEntityDeleteImpactParams,
) -> Result<EntityDeleteImpactResult> {
    validate_non_empty("entity_id", &params.entity_id)?;
    let connection = open_existing(&params.file_path)?;
    let metadata = load_app_meta(&connection)?;
    let impact =
        entity_delete_impact_connection(&connection, &metadata.project_id, &params.entity_id)?;
    connection.close().map_err(|(_, error)| error)?;
    Ok(EntityDeleteImpactResult { metadata, impact })
}

pub fn delete_entity(params: DeleteEntityParams) -> Result<DeleteEntityResult> {
    validate_non_empty("entity_id", &params.entity_id)?;
    if !params.confirmed {
        return Err(CoreError::InvalidInput(
            "entity deletion requires confirmed=true".to_owned(),
        ));
    }
    let mut setup = prepare_mutation(
        &params.file_path,
        params.expected_revision,
        params.saved_by.as_deref(),
    )?;
    let impact = entity_delete_impact_connection(
        &setup.connection,
        &setup.before.project_id,
        &params.entity_id,
    )?;
    let document_id = load_project_entity_record(
        &setup.connection,
        &setup.before.project_id,
        &params.entity_id,
    )?
    .document_id;
    {
        let transaction = setup
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_revision(&transaction, setup.expected_revision)?;
        let changed = transaction.execute(
            "DELETE FROM entities WHERE id = ?1 AND project_id = ?2",
            params![params.entity_id, setup.before.project_id],
        )?;
        if changed != 1 {
            return Err(entity_not_found(&params.entity_id));
        }
        let deleted_document = transaction.execute(
            "DELETE FROM documents WHERE id = ?1 AND project_id = ?2",
            params![document_id, setup.before.project_id],
        )?;
        if deleted_document != 1 {
            return Err(CoreError::Integrity(
                "entity note document could not be removed atomically".to_owned(),
            ));
        }
        let now = database_timestamp(&transaction)?;
        bump_revision(&transaction, setup.expected_revision, &setup.saved_by, &now)?;
        transaction.commit()?;
    }
    let (metadata, backup_file_path) = finish_mutation(setup, &params.file_path)?;
    Ok(DeleteEntityResult {
        metadata,
        deleted_entity_id: params.entity_id,
        deleted_document_id: document_id,
        impact,
        backup_file_path,
    })
}
