use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use rusqlite::{
    params, Connection, OpenFlags, OptionalExtension, Transaction, TransactionBehavior,
};
use uuid::Uuid;

use crate::error::{CoreError, Result};
use crate::model::{
    AppMeta, CreateProjectParams, CreateProjectResult, DocumentRecord, DocumentSummary,
    LoadDocumentParams, MigrationRecord, OpenProjectParams, ProjectInspection,
    RecoverPlainTextParams, RecoverPlainTextResult, SaveDocumentParams, SaveDocumentResult,
};

/// ASCII `MADI` encoded as a big-endian integer.
pub const APPLICATION_ID: i64 = 0x4D41_4449;
pub const FORMAT_NAME: &str = "madi";
pub const FORMAT_VERSION: i64 = 1;
pub const SCHEMA_VERSION: i64 = 4;

const DEFAULT_EDITOR_ENGINE: &str = "typie";
const UNINITIALIZED_EDITOR_COMMIT: &str = "uninitialized";

const MIGRATION_V1: &str = r#"
CREATE TABLE IF NOT EXISTS app_meta (
    singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
    format_name TEXT NOT NULL,
    format_version INTEGER NOT NULL,
    schema_version INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    last_saved_by TEXT NOT NULL,
    project_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0)
);

CREATE TABLE IF NOT EXISTS documents (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    editor_engine TEXT NOT NULL,
    editor_engine_commit TEXT NOT NULL,
    editor_schema_version INTEGER NOT NULL,
    snapshot_blob BLOB NOT NULL,
    plain_text_recovery TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES app_meta(project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS documents_project_id_idx
    ON documents(project_id);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER NOT NULL PRIMARY KEY,
    applied_at TEXT NOT NULL,
    description TEXT NOT NULL
);
"#;

const MIGRATION_V2: &str = r#"
CREATE TABLE IF NOT EXISTS projects (
    id TEXT NOT NULL PRIMARY KEY,
    title TEXT NOT NULL,
    author_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (id) REFERENCES app_meta(project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tree_nodes (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    parent_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('WORK', 'VOLUME', 'CHAPTER', 'SCENE')),
    title TEXT NOT NULL,
    order_key REAL NOT NULL,
    document_id TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES tree_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE RESTRICT,
    CHECK (
        (kind = 'WORK' AND parent_id IS NULL AND document_id IS NULL) OR
        (kind IN ('VOLUME', 'CHAPTER') AND parent_id IS NOT NULL AND document_id IS NULL) OR
        (kind = 'SCENE' AND parent_id IS NOT NULL AND document_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS tree_nodes_one_work_per_project
    ON tree_nodes(project_id) WHERE kind = 'WORK';
CREATE UNIQUE INDEX IF NOT EXISTS tree_nodes_sibling_order
    ON tree_nodes(project_id, COALESCE(parent_id, ''), order_key);
CREATE INDEX IF NOT EXISTS tree_nodes_parent_order
    ON tree_nodes(project_id, parent_id, order_key, id);

CREATE TABLE IF NOT EXISTS ui_state (
    project_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL CHECK (json_valid(value_json)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, key),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
"#;

const MIGRATION_V3: &str = r#"
CREATE TABLE IF NOT EXISTS search_documents (
    document_id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    plain_text TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS search_documents_project_idx
    ON search_documents(project_id, document_id);

CREATE TRIGGER IF NOT EXISTS search_documents_after_insert
AFTER INSERT ON documents
BEGIN
    INSERT INTO search_documents (document_id, project_id, plain_text, updated_at)
    VALUES (NEW.id, NEW.project_id, NEW.plain_text_recovery, NEW.updated_at)
    ON CONFLICT(document_id) DO UPDATE SET
        project_id = excluded.project_id,
        plain_text = excluded.plain_text,
        updated_at = excluded.updated_at;
END;

CREATE TRIGGER IF NOT EXISTS search_documents_after_update
AFTER UPDATE OF project_id, plain_text_recovery, updated_at ON documents
BEGIN
    INSERT INTO search_documents (document_id, project_id, plain_text, updated_at)
    VALUES (NEW.id, NEW.project_id, NEW.plain_text_recovery, NEW.updated_at)
    ON CONFLICT(document_id) DO UPDATE SET
        project_id = excluded.project_id,
        plain_text = excluded.plain_text,
        updated_at = excluded.updated_at;
END;

CREATE TRIGGER IF NOT EXISTS search_documents_after_delete
AFTER DELETE ON documents
BEGIN
    DELETE FROM search_documents WHERE document_id = OLD.id;
END;

CREATE TABLE IF NOT EXISTS named_snapshots (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    note TEXT,
    kind TEXT NOT NULL CHECK (
        kind IN ('MANUAL', 'AUTO_BEFORE_REPLACE', 'AUTO_BEFORE_RESTORE')
    ),
    payload_format TEXT NOT NULL,
    payload_version INTEGER NOT NULL CHECK (payload_version > 0),
    payload_blob BLOB NOT NULL,
    content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS named_snapshots_project_created_idx
    ON named_snapshots(project_id, created_at DESC, id);
"#;

const MIGRATION_V4: &str = r#"
CREATE TABLE IF NOT EXISTS entities (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN (
        'CHARACTER', 'LOCATION', 'ORGANIZATION', 'ITEM', 'EVENT',
        'WORLD_RULE', 'FORESHADOWING', 'OTHER'
    )),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    summary TEXT,
    document_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DRAFT', 'ARCHIVED')),
    color_token TEXT,
    icon_key TEXT,
    attributes_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(attributes_json)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS entities_project_kind_name_idx
    ON entities(project_id, kind, name, id);
CREATE INDEX IF NOT EXISTS entities_project_status_updated_idx
    ON entities(project_id, status, updated_at DESC, id);

CREATE TABLE IF NOT EXISTS entity_aliases (
    id TEXT NOT NULL PRIMARY KEY,
    entity_id TEXT NOT NULL,
    alias TEXT NOT NULL CHECK (length(trim(alias)) > 0),
    normalized_alias TEXT NOT NULL CHECK (length(trim(normalized_alias)) > 0),
    created_at TEXT NOT NULL,
    FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
    UNIQUE (entity_id, normalized_alias)
);

CREATE INDEX IF NOT EXISTS entity_aliases_entity_idx
    ON entity_aliases(entity_id, alias, id);

CREATE TABLE IF NOT EXISTS tags (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    color_token TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE (project_id, name)
);

CREATE INDEX IF NOT EXISTS tags_project_name_idx
    ON tags(project_id, name, id);

CREATE TABLE IF NOT EXISTS entity_tags (
    entity_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (entity_id, tag_id),
    FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS relation_types (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    inverse_name TEXT,
    directed INTEGER NOT NULL CHECK (directed IN (0, 1)),
    color_token TEXT,
    is_builtin INTEGER NOT NULL CHECK (is_builtin IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE (project_id, name)
);

CREATE INDEX IF NOT EXISTS relation_types_project_idx
    ON relation_types(project_id, is_builtin DESC, name, id);

CREATE TABLE IF NOT EXISTS entity_relations (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    source_entity_id TEXT NOT NULL,
    relation_type_id TEXT NOT NULL,
    target_entity_id TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (source_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
    FOREIGN KEY (relation_type_id) REFERENCES relation_types(id) ON DELETE RESTRICT,
    FOREIGN KEY (target_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
    CHECK (source_entity_id <> target_entity_id),
    UNIQUE (project_id, source_entity_id, relation_type_id, target_entity_id)
);

CREATE INDEX IF NOT EXISTS entity_relations_source_idx
    ON entity_relations(project_id, source_entity_id, relation_type_id, target_entity_id);
CREATE INDEX IF NOT EXISTS entity_relations_target_idx
    ON entity_relations(project_id, target_entity_id, relation_type_id, source_entity_id);

CREATE TABLE IF NOT EXISTS scene_entity_links (
    scene_node_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('APPEARS', 'POV', 'MENTIONED', 'RELATED')),
    note TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (scene_node_id, entity_id, role),
    FOREIGN KEY (scene_node_id) REFERENCES tree_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS scene_entity_links_entity_idx
    ON scene_entity_links(entity_id, scene_node_id, role);

CREATE TRIGGER IF NOT EXISTS entities_validate_document_insert
BEFORE INSERT ON entities
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = NEW.document_id AND d.project_id = NEW.project_id
    ) THEN RAISE(ABORT, 'entity document must exist in the same project') END;
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM tree_nodes n WHERE n.document_id = NEW.document_id
    ) THEN RAISE(ABORT, 'entity document is already owned by a scene') END;
END;

CREATE TRIGGER IF NOT EXISTS entities_validate_document_update
BEFORE UPDATE OF project_id, document_id ON entities
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = NEW.document_id AND d.project_id = NEW.project_id
    ) THEN RAISE(ABORT, 'entity document must exist in the same project') END;
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM tree_nodes n WHERE n.document_id = NEW.document_id
    ) THEN RAISE(ABORT, 'entity document is already owned by a scene') END;
END;

CREATE TRIGGER IF NOT EXISTS entity_tags_validate_project_insert
BEFORE INSERT ON entity_tags
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM entities e JOIN tags t ON t.id = NEW.tag_id
        WHERE e.id = NEW.entity_id AND e.project_id = t.project_id
    ) THEN RAISE(ABORT, 'entity and tag must belong to the same project') END;
END;

CREATE TRIGGER IF NOT EXISTS entity_relations_validate_insert
BEFORE INSERT ON entity_relations
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM entities s, entities t, relation_types rt
        WHERE s.id = NEW.source_entity_id AND t.id = NEW.target_entity_id
          AND rt.id = NEW.relation_type_id
          AND s.project_id = NEW.project_id
          AND t.project_id = NEW.project_id
          AND rt.project_id = NEW.project_id
    ) THEN RAISE(ABORT, 'relation members must belong to the same project') END;
END;

CREATE TRIGGER IF NOT EXISTS entity_relations_validate_update
BEFORE UPDATE OF project_id, source_entity_id, relation_type_id, target_entity_id
ON entity_relations
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM entities s, entities t, relation_types rt
        WHERE s.id = NEW.source_entity_id AND t.id = NEW.target_entity_id
          AND rt.id = NEW.relation_type_id
          AND s.project_id = NEW.project_id
          AND t.project_id = NEW.project_id
          AND rt.project_id = NEW.project_id
    ) THEN RAISE(ABORT, 'relation members must belong to the same project') END;
END;

CREATE TRIGGER IF NOT EXISTS scene_entity_links_validate_insert
BEFORE INSERT ON scene_entity_links
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM tree_nodes n JOIN entities e
          ON e.id = NEW.entity_id AND e.project_id = n.project_id
        WHERE n.id = NEW.scene_node_id AND n.kind = 'SCENE'
    ) THEN RAISE(ABORT, 'scene link requires a SCENE and entity in the same project') END;
END;

CREATE TRIGGER IF NOT EXISTS scene_entity_links_validate_update
BEFORE UPDATE OF scene_node_id, entity_id ON scene_entity_links
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM tree_nodes n JOIN entities e
          ON e.id = NEW.entity_id AND e.project_id = n.project_id
        WHERE n.id = NEW.scene_node_id AND n.kind = 'SCENE'
    ) THEN RAISE(ABORT, 'scene link requires a SCENE and entity in the same project') END;
END;
"#;

const ORDER_STEP: f64 = 1024.0;

pub(crate) const BUILTIN_RELATION_TYPES: [(&str, &str, &str, bool); 10] = [
    ("builtin-related", "관련됨", "관련됨", false),
    ("builtin-alliance", "동맹", "동맹", false),
    ("builtin-hostility", "적대", "적대", false),
    ("builtin-family", "가족", "가족", false),
    ("builtin-membership", "소속", "구성원을 가짐", true),
    ("builtin-location", "위치함", "포함함", true),
    ("builtin-ownership", "소유함", "소유됨", true),
    ("builtin-causality", "원인", "결과", true),
    ("builtin-foreshadows", "암시함", "암시됨", true),
    ("builtin-resolves", "회수함", "회수됨", true),
];

pub fn create_project(params: CreateProjectParams) -> Result<CreateProjectResult> {
    validate_madi_destination(&params.file_path)?;
    validate_non_empty("title", &params.title)?;

    if params.file_path.exists() {
        return Err(CoreError::AlreadyExists(params.file_path));
    }

    let parent = usable_parent(&params.file_path);
    if !parent.exists() {
        fs::create_dir_all(parent)?;
    }

    let project_id = non_empty_or_generated("project_id", params.project_id)?;
    let document_id = non_empty_or_generated("document_id", params.document_id)?;
    let document_title = params
        .document_title
        .unwrap_or_else(|| params.title.clone());
    validate_non_empty("document_title", &document_title)?;

    let created_by = params.created_by.unwrap_or_else(default_client_identifier);
    validate_non_empty("created_by", &created_by)?;
    if let Some(author_name) = params.author_name.as_deref() {
        validate_non_empty("author_name", author_name)?;
    }

    let editor_engine = params
        .editor_engine
        .unwrap_or_else(|| DEFAULT_EDITOR_ENGINE.to_owned());
    let editor_engine_commit = params
        .editor_engine_commit
        .unwrap_or_else(|| UNINITIALIZED_EDITOR_COMMIT.to_owned());
    let editor_schema_version = params.editor_schema_version.unwrap_or(0);
    validate_editor_metadata(&editor_engine, &editor_engine_commit, editor_schema_version)?;

    let temporary_path = unique_sibling_path(&params.file_path, "create.tmp");
    let mut temporary_guard = TemporaryPathGuard::new(temporary_path.clone());
    let work_node_id = Uuid::new_v4().to_string();
    let default_chapter_node_id = Uuid::new_v4().to_string();
    let default_scene_node_id = Uuid::new_v4().to_string();

    {
        let mut connection = Connection::open_with_flags(
            &temporary_path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        configure_connection(&connection)?;
        connection.pragma_update(None, "journal_mode", "DELETE")?;
        connection.pragma_update(None, "application_id", APPLICATION_ID)?;
        migrate(&mut connection)?;

        let now = database_timestamp(&connection)?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute(
            "INSERT INTO app_meta (
                singleton, format_name, format_version, schema_version,
                created_by, last_saved_by, project_id, title,
                created_at, updated_at, revision
             ) VALUES (1, ?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7, ?7, 0)",
            params![
                FORMAT_NAME,
                FORMAT_VERSION,
                SCHEMA_VERSION,
                created_by,
                project_id,
                params.title,
                now
            ],
        )?;
        transaction.execute(
            "INSERT INTO projects (
                id, title, author_name, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?4)",
            params![project_id, params.title, params.author_name, now],
        )?;
        seed_builtin_relation_types(&transaction, &project_id, &now)?;
        transaction.execute(
            "INSERT INTO documents (
                id, project_id, title, editor_engine, editor_engine_commit,
                editor_schema_version, snapshot_blob, plain_text_recovery,
                created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '', ?8, ?8)",
            params![
                document_id,
                project_id,
                document_title,
                editor_engine,
                editor_engine_commit,
                editor_schema_version,
                Vec::<u8>::new(),
                now
            ],
        )?;
        transaction.execute(
            "INSERT INTO tree_nodes (
                id, project_id, parent_id, kind, title, order_key,
                document_id, created_at, updated_at
             ) VALUES (?1, ?2, NULL, 'WORK', ?3, ?4, NULL, ?5, ?5)",
            params![work_node_id, project_id, params.title, ORDER_STEP, now],
        )?;
        transaction.execute(
            "INSERT INTO tree_nodes (
                id, project_id, parent_id, kind, title, order_key,
                document_id, created_at, updated_at
             ) VALUES (?1, ?2, ?3, 'CHAPTER', ?4, ?5, NULL, ?6, ?6)",
            params![
                default_chapter_node_id,
                project_id,
                work_node_id,
                document_title,
                ORDER_STEP,
                now
            ],
        )?;
        transaction.execute(
            "INSERT INTO tree_nodes (
                id, project_id, parent_id, kind, title, order_key,
                document_id, created_at, updated_at
             ) VALUES (?1, ?2, ?3, 'SCENE', ?4, ?5, ?6, ?7, ?7)",
            params![
                default_scene_node_id,
                project_id,
                default_chapter_node_id,
                document_title,
                ORDER_STEP,
                document_id,
                now
            ],
        )?;
        transaction.commit()?;
        connection.close().map_err(|(_, error)| error)?;
    }

    sync_file(&temporary_path)?;
    // Linking publishes the finished file without replacing a destination that
    // may have appeared after the initial existence check.
    fs::hard_link(&temporary_path, &params.file_path)?;
    sync_file(&params.file_path)?;
    let _ = fs::remove_file(&temporary_path);
    temporary_guard.disarm();

    let project = open_project(OpenProjectParams {
        file_path: params.file_path,
    })?;

    Ok(CreateProjectResult {
        default_document_id: document_id,
        work_node_id,
        default_chapter_node_id,
        default_scene_node_id,
        project,
    })
}

pub fn open_project(params: OpenProjectParams) -> Result<ProjectInspection> {
    inspect_path(&params.file_path)
}

pub fn inspect_project(params: OpenProjectParams) -> Result<ProjectInspection> {
    inspect_path(&params.file_path)
}

pub fn save_document(params: SaveDocumentParams) -> Result<SaveDocumentResult> {
    validate_non_empty("document.id", &params.document.id)?;
    validate_non_empty("document.title", &params.document.title)?;
    validate_editor_metadata(
        &params.document.editor_engine,
        &params.document.editor_engine_commit,
        params.document.editor_schema_version,
    )?;
    if params
        .expected_revision
        .is_some_and(|revision| revision < 0)
    {
        return Err(CoreError::InvalidInput(
            "expected_revision must be non-negative".to_owned(),
        ));
    }

    let snapshot = BASE64_STANDARD
        .decode(params.document.snapshot_base64.as_bytes())
        .map_err(|_| {
            CoreError::InvalidInput(
                "document.snapshot_base64 is not valid standard base64".to_owned(),
            )
        })?;
    let saved_by = params.saved_by.unwrap_or_else(default_client_identifier);
    validate_non_empty("saved_by", &saved_by)?;

    let mut connection = open_existing(&params.file_path)?;
    let metadata_before = load_app_meta(&connection)?;
    if let Some(expected) = params.expected_revision {
        if expected != metadata_before.revision {
            return Err(CoreError::RevisionConflict {
                expected,
                actual: metadata_before.revision,
            });
        }
    }

    if let Some(request_project_id) = params.document.project_id.as_deref() {
        if request_project_id != metadata_before.project_id {
            return Err(CoreError::InvalidInput(
                "document.project_id does not match the project metadata".to_owned(),
            ));
        }
    }

    // VACUUM INTO produces a transactionally consistent copy without copying a
    // live journal file. It is completed and fsynced before the write starts.
    let backup_file_path = create_consistent_backup(&connection, &params.file_path)?;
    let expected_revision = params.expected_revision.unwrap_or(metadata_before.revision);

    let now = database_timestamp(&connection)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let current_revision: i64 = transaction.query_row(
        "SELECT revision FROM app_meta WHERE singleton = 1",
        [],
        |row| row.get(0),
    )?;
    if current_revision != expected_revision {
        return Err(CoreError::RevisionConflict {
            expected: expected_revision,
            actual: current_revision,
        });
    }

    transaction.execute(
        "INSERT INTO documents (
            id, project_id, title, editor_engine, editor_engine_commit,
            editor_schema_version, snapshot_blob, plain_text_recovery,
            created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
         ON CONFLICT(id) DO UPDATE SET
            project_id = excluded.project_id,
            title = excluded.title,
            editor_engine = excluded.editor_engine,
            editor_engine_commit = excluded.editor_engine_commit,
            editor_schema_version = excluded.editor_schema_version,
            snapshot_blob = excluded.snapshot_blob,
            plain_text_recovery = excluded.plain_text_recovery,
            updated_at = excluded.updated_at",
        params![
            params.document.id,
            metadata_before.project_id,
            params.document.title,
            params.document.editor_engine,
            params.document.editor_engine_commit,
            params.document.editor_schema_version,
            snapshot,
            params.document.plain_text_recovery,
            now
        ],
    )?;
    transaction.execute(
        "UPDATE tree_nodes
         SET title = ?1, updated_at = ?2
         WHERE document_id = ?3",
        params![params.document.title, now, params.document.id],
    )?;

    let changed = transaction.execute(
        "UPDATE app_meta
         SET last_saved_by = ?1, updated_at = ?2, revision = revision + 1
         WHERE singleton = 1 AND revision = ?3",
        params![saved_by, now, expected_revision],
    )?;
    if changed != 1 {
        return Err(CoreError::RevisionConflict {
            expected: expected_revision,
            actual: current_revision,
        });
    }
    transaction.commit()?;

    let metadata = load_app_meta(&connection)?;
    let document = load_document_summary(&connection, &params.document.id)?;
    connection.close().map_err(|(_, error)| error)?;
    sync_file(&params.file_path)?;

    Ok(SaveDocumentResult {
        metadata,
        document,
        backup_file_path,
    })
}

pub fn load_document(params: LoadDocumentParams) -> Result<DocumentRecord> {
    let connection = open_existing(&params.file_path)?;
    let document_id = resolve_document_id(&connection, params.document_id.as_deref())?;
    let result = load_document_record(&connection, &document_id)?;
    connection.close().map_err(|(_, error)| error)?;
    Ok(result)
}

pub fn recover_plain_text(params: RecoverPlainTextParams) -> Result<RecoverPlainTextResult> {
    let connection = open_existing(&params.file_path)?;
    let document_id = resolve_document_id(&connection, params.document_id.as_deref())?;
    let (id, title, plain_text_recovery) = connection
        .query_row(
            "SELECT id, title, plain_text_recovery
             FROM documents
             WHERE id = ?1",
            [&document_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("document id {document_id}")))?;
    let project_revision: i64 = connection.query_row(
        "SELECT revision FROM app_meta WHERE singleton = 1",
        [],
        |row| row.get(0),
    )?;
    connection.close().map_err(|(_, error)| error)?;

    Ok(RecoverPlainTextResult {
        document_id: id,
        title,
        plain_text_recovery,
        project_revision,
    })
}

fn inspect_path(file_path: &Path) -> Result<ProjectInspection> {
    let connection = open_existing(file_path)?;
    let application_id = application_id(&connection)?;
    let metadata = load_app_meta(&connection)?;
    validate_metadata(&metadata)?;
    let documents = load_document_summaries(&connection)?;
    let schema_migrations = load_migrations(&connection)?;
    let integrity_check = quick_check(&connection)?;
    connection.close().map_err(|(_, error)| error)?;
    let file_size_bytes = fs::metadata(file_path)?.len();

    Ok(ProjectInspection {
        file_path: file_path.to_path_buf(),
        application_id,
        metadata,
        documents,
        schema_migrations,
        integrity_check,
        file_size_bytes,
    })
}

pub(crate) fn open_existing(file_path: &Path) -> Result<Connection> {
    if !file_path.is_file() {
        return Err(CoreError::NotFound(
            file_path.to_string_lossy().into_owned(),
        ));
    }

    let mut connection = Connection::open_with_flags(
        file_path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    configure_connection(&connection)?;

    let found_application_id = application_id(&connection)?;
    if found_application_id != APPLICATION_ID {
        return Err(CoreError::NotMadiFile {
            found: found_application_id,
        });
    }

    migrate(&mut connection)?;
    quick_check(&connection)?;
    let metadata = load_app_meta(&connection)?;
    validate_metadata(&metadata)?;
    validate_phase_1a_structure(&connection, &metadata)?;
    Ok(connection)
}

fn configure_connection(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;
         PRAGMA synchronous = FULL;
         PRAGMA trusted_schema = OFF;",
    )?;
    Ok(())
}

fn migrate(connection: &mut Connection) -> Result<()> {
    let mut current: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if current > SCHEMA_VERSION {
        return Err(CoreError::UnsupportedSchema {
            found: current,
            supported: SCHEMA_VERSION,
        });
    }

    if current < 1 {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute_batch(MIGRATION_V1)?;
        let applied_at = database_timestamp(&transaction)?;
        transaction.execute(
            "INSERT OR IGNORE INTO schema_migrations
                (version, applied_at, description)
             VALUES (1, ?1, ?2)",
            params![
                applied_at,
                "Initial phase-0 app_meta, documents, and migration schema"
            ],
        )?;
        transaction.pragma_update(None, "user_version", 1_i64)?;
        transaction.commit()?;
        current = 1;
    }

    if current < 2 {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute_batch(MIGRATION_V2)?;
        backfill_phase_1a_hierarchy(&transaction)?;
        let applied_at = database_timestamp(&transaction)?;
        transaction.execute(
            "INSERT OR IGNORE INTO schema_migrations
                (version, applied_at, description)
             VALUES (2, ?1, ?2)",
            params![
                applied_at,
                "Phase 1A projects, tree hierarchy, scene links, and UI state"
            ],
        )?;
        transaction.execute(
            "UPDATE app_meta
             SET format_version = 1, schema_version = 2
             WHERE singleton = 1",
            [],
        )?;
        transaction.pragma_update(None, "user_version", 2_i64)?;
        transaction.commit()?;
        current = 2;
    }

    if current < 3 {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute_batch(MIGRATION_V3)?;
        transaction.execute(
            "INSERT OR REPLACE INTO search_documents
                (document_id, project_id, plain_text, updated_at)
             SELECT id, project_id, plain_text_recovery, updated_at
             FROM documents",
            [],
        )?;
        let applied_at = database_timestamp(&transaction)?;
        transaction.execute(
            "INSERT OR IGNORE INTO schema_migrations
                (version, applied_at, description)
             VALUES (3, ?1, ?2)",
            params![
                applied_at,
                "Phase 1B exact search projection and versioned named snapshots"
            ],
        )?;
        transaction.execute(
            "UPDATE app_meta
             SET format_version = 1, schema_version = 3
             WHERE singleton = 1",
            [],
        )?;
        transaction.pragma_update(None, "user_version", 3_i64)?;
        transaction.commit()?;
        current = 3;
    }

    if current < 4 {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute_batch(MIGRATION_V4)?;
        let applied_at = database_timestamp(&transaction)?;
        let project_ids = {
            let mut statement = transaction.prepare("SELECT id FROM projects ORDER BY id")?;
            let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
            let mut project_ids = Vec::new();
            for row in rows {
                project_ids.push(row?);
            }
            project_ids
        };
        for project_id in project_ids {
            seed_builtin_relation_types(&transaction, &project_id, &applied_at)?;
        }
        transaction.execute(
            "INSERT OR IGNORE INTO schema_migrations
                (version, applied_at, description)
             VALUES (4, ?1, ?2)",
            params![
                applied_at,
                "Phase 1C Story Bible entities, aliases, tags, relations, and scene links"
            ],
        )?;
        transaction.execute(
            "UPDATE app_meta
             SET format_version = 1, schema_version = 4
             WHERE singleton = 1",
            [],
        )?;
        transaction.pragma_update(None, "user_version", 4_i64)?;
        transaction.commit()?;
    }

    Ok(())
}

pub(crate) fn seed_builtin_relation_types(
    transaction: &Transaction<'_>,
    project_id: &str,
    now: &str,
) -> Result<()> {
    for (suffix, name, inverse_name, directed) in BUILTIN_RELATION_TYPES {
        let id = format!("{project_id}:{suffix}");
        transaction.execute(
            "INSERT OR IGNORE INTO relation_types (
                id, project_id, name, inverse_name, directed, color_token,
                is_builtin, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, 1, ?6, ?6)",
            params![id, project_id, name, inverse_name, directed, now],
        )?;
    }
    Ok(())
}

fn backfill_phase_1a_hierarchy(transaction: &Transaction<'_>) -> Result<()> {
    let legacy_project = transaction
        .query_row(
            "SELECT project_id, title, created_at, updated_at
             FROM app_meta WHERE singleton = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()?;
    let Some((project_id, title, created_at, updated_at)) = legacy_project else {
        return Ok(());
    };

    transaction.execute(
        "INSERT OR IGNORE INTO projects
            (id, title, author_name, created_at, updated_at)
         VALUES (?1, ?2, NULL, ?3, ?4)",
        params![project_id, title, created_at, updated_at],
    )?;

    let existing_work = transaction
        .query_row(
            "SELECT id FROM tree_nodes
             WHERE project_id = ?1 AND kind = 'WORK'",
            [&project_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let work_node_id = existing_work.unwrap_or_else(|| Uuid::new_v4().to_string());
    transaction.execute(
        "INSERT OR IGNORE INTO tree_nodes (
            id, project_id, parent_id, kind, title, order_key,
            document_id, created_at, updated_at
         ) VALUES (?1, ?2, NULL, 'WORK', ?3, ?4, NULL, ?5, ?6)",
        params![
            work_node_id,
            project_id,
            title,
            ORDER_STEP,
            created_at,
            updated_at
        ],
    )?;

    let document_rows = {
        let mut statement = transaction.prepare(
            "SELECT id, title, created_at, updated_at
             FROM documents
             WHERE project_id = ?1
             ORDER BY created_at, id",
        )?;
        let rows = statement.query_map([&project_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()?
    };

    let default_chapter_node_id = if document_rows.is_empty() {
        None
    } else {
        let chapter_node_id = Uuid::new_v4().to_string();
        transaction.execute(
            "INSERT INTO tree_nodes (
                id, project_id, parent_id, kind, title, order_key,
                document_id, created_at, updated_at
             ) VALUES (?1, ?2, ?3, 'CHAPTER', '본문', ?4, NULL, ?5, ?6)",
            params![
                chapter_node_id,
                project_id,
                work_node_id,
                ORDER_STEP,
                created_at,
                updated_at
            ],
        )?;
        Some(chapter_node_id)
    };

    for (index, (document_id, document_title, created_at, updated_at)) in
        document_rows.into_iter().enumerate()
    {
        let linked: Option<String> = transaction
            .query_row(
                "SELECT id FROM tree_nodes WHERE document_id = ?1",
                [&document_id],
                |row| row.get(0),
            )
            .optional()?;
        if linked.is_some() {
            continue;
        }
        let scene_node_id = Uuid::new_v4().to_string();
        let order_key = (index as f64 + 1.0) * ORDER_STEP;
        transaction.execute(
            "INSERT INTO tree_nodes (
                id, project_id, parent_id, kind, title, order_key,
                document_id, created_at, updated_at
             ) VALUES (?1, ?2, ?3, 'SCENE', ?4, ?5, ?6, ?7, ?8)",
            params![
                scene_node_id,
                project_id,
                default_chapter_node_id.as_deref(),
                document_title,
                order_key,
                document_id,
                created_at,
                updated_at
            ],
        )?;
    }

    Ok(())
}

fn application_id(connection: &Connection) -> Result<i64> {
    Ok(connection.pragma_query_value(None, "application_id", |row| row.get(0))?)
}

pub(crate) fn database_timestamp(connection: &Connection) -> Result<String> {
    Ok(
        connection.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get(0)
        })?,
    )
}

pub(crate) fn load_app_meta(connection: &Connection) -> Result<AppMeta> {
    connection
        .query_row(
            "SELECT
                format_name, format_version, schema_version,
                created_by, last_saved_by, project_id, title,
                created_at, updated_at, revision
             FROM app_meta
             WHERE singleton = 1",
            [],
            |row| {
                Ok(AppMeta {
                    format_name: row.get(0)?,
                    format_version: row.get(1)?,
                    schema_version: row.get(2)?,
                    created_by: row.get(3)?,
                    last_saved_by: row.get(4)?,
                    project_id: row.get(5)?,
                    title: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                    revision: row.get(9)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| CoreError::Integrity("app_meta singleton row is missing".to_owned()))
}

fn load_document_summaries(connection: &Connection) -> Result<Vec<DocumentSummary>> {
    let mut statement = connection.prepare(
        "SELECT
            id, project_id, title, editor_engine, editor_engine_commit,
            editor_schema_version, length(snapshot_blob),
            length(CAST(plain_text_recovery AS BLOB)), created_at, updated_at
         FROM documents
         ORDER BY created_at, id",
    )?;
    let rows = statement.query_map([], document_summary_from_row)?;
    let mut documents = Vec::new();
    for row in rows {
        documents.push(row?);
    }
    Ok(documents)
}

pub(crate) fn load_document_summary(
    connection: &Connection,
    document_id: &str,
) -> Result<DocumentSummary> {
    connection
        .query_row(
            "SELECT
                id, project_id, title, editor_engine, editor_engine_commit,
                editor_schema_version, length(snapshot_blob),
                length(CAST(plain_text_recovery AS BLOB)), created_at, updated_at
             FROM documents
             WHERE id = ?1",
            [document_id],
            document_summary_from_row,
        )
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("document id {document_id}")))
}

fn document_summary_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DocumentSummary> {
    let snapshot_bytes: i64 = row.get(6)?;
    let plain_text_bytes: i64 = row.get(7)?;
    Ok(DocumentSummary {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        editor_engine: row.get(3)?,
        editor_engine_commit: row.get(4)?,
        editor_schema_version: row.get(5)?,
        snapshot_bytes: snapshot_bytes.max(0) as u64,
        plain_text_bytes: plain_text_bytes.max(0) as u64,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

pub(crate) fn load_document_record(
    connection: &Connection,
    document_id: &str,
) -> Result<DocumentRecord> {
    let stored = connection
        .query_row(
            "SELECT
                id, project_id, title, editor_engine, editor_engine_commit,
                editor_schema_version, snapshot_blob, plain_text_recovery,
                created_at, updated_at
             FROM documents
             WHERE id = ?1",
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
        .ok_or_else(|| CoreError::NotFound(format!("document id {document_id}")))?;

    Ok(DocumentRecord {
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
    })
}

fn load_migrations(connection: &Connection) -> Result<Vec<MigrationRecord>> {
    let mut statement = connection.prepare(
        "SELECT version, applied_at, description
         FROM schema_migrations
         ORDER BY version",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(MigrationRecord {
            version: row.get(0)?,
            applied_at: row.get(1)?,
            description: row.get(2)?,
        })
    })?;
    let mut migrations = Vec::new();
    for row in rows {
        migrations.push(row?);
    }
    Ok(migrations)
}

fn resolve_document_id(connection: &Connection, requested: Option<&str>) -> Result<String> {
    if let Some(document_id) = requested {
        validate_non_empty("document_id", document_id)?;
        return Ok(document_id.to_owned());
    }

    connection
        .query_row(
            "SELECT id FROM documents ORDER BY created_at, id LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| CoreError::NotFound("the project has no documents".to_owned()))
}

fn validate_metadata(metadata: &AppMeta) -> Result<()> {
    if metadata.format_name != FORMAT_NAME {
        return Err(CoreError::Integrity(
            "app_meta.format_name is not 'madi'".to_owned(),
        ));
    }
    if metadata.format_version != FORMAT_VERSION {
        return Err(CoreError::UnsupportedFormat {
            found: metadata.format_version,
            supported: FORMAT_VERSION,
        });
    }
    if metadata.schema_version != SCHEMA_VERSION {
        return Err(CoreError::UnsupportedSchema {
            found: metadata.schema_version,
            supported: SCHEMA_VERSION,
        });
    }
    if metadata.revision < 0 {
        return Err(CoreError::Integrity(
            "app_meta.revision is negative".to_owned(),
        ));
    }
    validate_non_empty("app_meta.project_id", &metadata.project_id)?;
    validate_non_empty("app_meta.title", &metadata.title)?;
    Ok(())
}

fn validate_phase_1a_structure(connection: &Connection, metadata: &AppMeta) -> Result<()> {
    let project_count: i64 = connection.query_row(
        "SELECT count(*) FROM projects WHERE id = ?1",
        [&metadata.project_id],
        |row| row.get(0),
    )?;
    if project_count != 1 {
        return Err(CoreError::Integrity(
            "the project row is missing or duplicated".to_owned(),
        ));
    }
    let work_count: i64 = connection.query_row(
        "SELECT count(*) FROM tree_nodes
         WHERE project_id = ?1 AND kind = 'WORK' AND parent_id IS NULL",
        [&metadata.project_id],
        |row| row.get(0),
    )?;
    if work_count != 1 {
        return Err(CoreError::Integrity(
            "the project must contain exactly one WORK root".to_owned(),
        ));
    }
    let invalid_edges: i64 = connection.query_row(
        "SELECT count(*)
         FROM tree_nodes child
         LEFT JOIN tree_nodes parent ON parent.id = child.parent_id
         WHERE child.project_id = ?1
           AND child.kind <> 'WORK'
           AND (parent.id IS NULL OR NOT (
             (parent.kind = 'WORK' AND child.kind IN ('VOLUME', 'CHAPTER')) OR
             (parent.kind = 'VOLUME' AND child.kind = 'CHAPTER') OR
             (parent.kind = 'CHAPTER' AND child.kind = 'SCENE')
           ))",
        [&metadata.project_id],
        |row| row.get(0),
    )?;
    if invalid_edges != 0 {
        return Err(CoreError::Integrity(
            "tree hierarchy contains an invalid edge".to_owned(),
        ));
    }
    let foreign_key_violation = connection
        .query_row("PRAGMA foreign_key_check", [], |row| {
            row.get::<_, String>(0)
        })
        .optional()?;
    if foreign_key_violation.is_some() {
        return Err(CoreError::Integrity(
            "project foreign-key integrity check failed".to_owned(),
        ));
    }
    Ok(())
}

fn quick_check(connection: &Connection) -> Result<String> {
    let result: String = connection.query_row("PRAGMA quick_check(1)", [], |row| row.get(0))?;
    if result != "ok" {
        return Err(CoreError::Integrity(result));
    }
    Ok(result)
}

pub(crate) fn create_consistent_backup(
    connection: &Connection,
    project_path: &Path,
) -> Result<PathBuf> {
    let backup_path = append_file_suffix(project_path, ".bak");
    let previous_path = append_file_suffix(project_path, ".bak.previous");
    let temporary_path = unique_sibling_path(project_path, "backup.tmp");
    let mut temporary_guard = TemporaryPathGuard::new(temporary_path.clone());
    let temporary_text = temporary_path.to_str().ok_or_else(|| {
        CoreError::InvalidInput("backup path cannot be represented as Unicode".to_owned())
    })?;

    connection.execute("VACUUM main INTO ?1", [temporary_text])?;
    sync_file(&temporary_path)?;

    if previous_path.exists() {
        fs::remove_file(&previous_path)?;
    }
    if backup_path.exists() {
        fs::rename(&backup_path, &previous_path)?;
    }

    if let Err(error) = fs::rename(&temporary_path, &backup_path) {
        if previous_path.exists() && !backup_path.exists() {
            let _ = fs::rename(&previous_path, &backup_path);
        }
        return Err(error.into());
    }
    temporary_guard.disarm();
    sync_file(&backup_path)?;
    Ok(backup_path)
}

fn append_file_suffix(path: &Path, suffix: &str) -> PathBuf {
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "project.madi".to_owned());
    path.with_file_name(format!("{name}{suffix}"))
}

fn unique_sibling_path(path: &Path, role: &str) -> PathBuf {
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "project.madi".to_owned());
    path.with_file_name(format!(".{name}.{}.{}", Uuid::new_v4(), role))
}

pub(crate) fn sync_file(path: &Path) -> Result<()> {
    OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)?
        .sync_all()?;
    Ok(())
}

fn validate_madi_destination(path: &Path) -> Result<()> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !extension.eq_ignore_ascii_case("madi") {
        return Err(CoreError::InvalidInput(
            "project file must use the .madi extension".to_owned(),
        ));
    }
    if path.file_name().is_none() {
        return Err(CoreError::InvalidInput(
            "project file path must include a file name".to_owned(),
        ));
    }
    Ok(())
}

fn usable_parent(path: &Path) -> &Path {
    path.parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
}

pub(crate) fn validate_non_empty(field: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        return Err(CoreError::InvalidInput(format!(
            "{field} must not be empty"
        )));
    }
    Ok(())
}

pub(crate) fn validate_editor_metadata(
    editor_engine: &str,
    editor_engine_commit: &str,
    editor_schema_version: i64,
) -> Result<()> {
    validate_non_empty("editor_engine", editor_engine)?;
    validate_non_empty("editor_engine_commit", editor_engine_commit)?;
    if editor_schema_version < 0 {
        return Err(CoreError::InvalidInput(
            "editor_schema_version must be non-negative".to_owned(),
        ));
    }
    Ok(())
}

pub(crate) fn non_empty_or_generated(field: &str, value: Option<String>) -> Result<String> {
    let value = value.unwrap_or_else(|| Uuid::new_v4().to_string());
    validate_non_empty(field, &value)?;
    Ok(value)
}

pub(crate) fn default_client_identifier() -> String {
    format!("madi-core/{}", env!("CARGO_PKG_VERSION"))
}

struct TemporaryPathGuard {
    path: PathBuf,
    armed: bool,
}

impl TemporaryPathGuard {
    fn new(path: PathBuf) -> Self {
        Self { path, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for TemporaryPathGuard {
    fn drop(&mut self) {
        if self.armed {
            let _ = fs::remove_file(&self.path);
        }
    }
}
