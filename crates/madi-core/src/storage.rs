use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use rusqlite::{
    params, Connection, OpenFlags, OptionalExtension, TransactionBehavior,
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
pub const FORMAT_VERSION: i64 = 0;
pub const SCHEMA_VERSION: i64 = 1;

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

    let created_by = params
        .created_by
        .unwrap_or_else(default_client_identifier);
    validate_non_empty("created_by", &created_by)?;

    let editor_engine = params
        .editor_engine
        .unwrap_or_else(|| DEFAULT_EDITOR_ENGINE.to_owned());
    let editor_engine_commit = params
        .editor_engine_commit
        .unwrap_or_else(|| UNINITIALIZED_EDITOR_COMMIT.to_owned());
    let editor_schema_version = params.editor_schema_version.unwrap_or(0);
    validate_editor_metadata(
        &editor_engine,
        &editor_engine_commit,
        editor_schema_version,
    )?;

    let temporary_path = unique_sibling_path(&params.file_path, "create.tmp");
    let mut temporary_guard = TemporaryPathGuard::new(temporary_path.clone());

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
        let transaction =
            connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
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
    if params.expected_revision.is_some_and(|revision| revision < 0) {
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
    let saved_by = params
        .saved_by
        .unwrap_or_else(default_client_identifier);
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
    let expected_revision = params
        .expected_revision
        .unwrap_or(metadata_before.revision);

    let now = database_timestamp(&connection)?;
    let transaction =
        connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
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

pub fn recover_plain_text(
    params: RecoverPlainTextParams,
) -> Result<RecoverPlainTextResult> {
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
        .ok_or_else(|| {
            CoreError::NotFound(format!("document id {document_id}"))
        })?;
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

fn open_existing(file_path: &Path) -> Result<Connection> {
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
    let current: i64 =
        connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if current > SCHEMA_VERSION {
        return Err(CoreError::UnsupportedSchema {
            found: current,
            supported: SCHEMA_VERSION,
        });
    }

    if current < 1 {
        let transaction =
            connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
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
    }

    Ok(())
}

fn application_id(connection: &Connection) -> Result<i64> {
    Ok(connection.pragma_query_value(
        None,
        "application_id",
        |row| row.get(0),
    )?)
}

fn database_timestamp(connection: &Connection) -> Result<String> {
    Ok(connection.query_row(
        "SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        [],
        |row| row.get(0),
    )?)
}

fn load_app_meta(connection: &Connection) -> Result<AppMeta> {
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
        .ok_or_else(|| {
            CoreError::Integrity("app_meta singleton row is missing".to_owned())
        })
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

fn load_document_summary(
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
        .ok_or_else(|| {
            CoreError::NotFound(format!("document id {document_id}"))
        })
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

fn load_document_record(
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
        .ok_or_else(|| {
            CoreError::NotFound(format!("document id {document_id}"))
        })?;

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

fn resolve_document_id(
    connection: &Connection,
    requested: Option<&str>,
) -> Result<String> {
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

fn quick_check(connection: &Connection) -> Result<String> {
    let result: String =
        connection.query_row("PRAGMA quick_check(1)", [], |row| row.get(0))?;
    if result != "ok" {
        return Err(CoreError::Integrity(result));
    }
    Ok(result)
}

fn create_consistent_backup(
    connection: &Connection,
    project_path: &Path,
) -> Result<PathBuf> {
    let backup_path = append_file_suffix(project_path, ".bak");
    let previous_path = append_file_suffix(project_path, ".bak.previous");
    let temporary_path = unique_sibling_path(project_path, "backup.tmp");
    let mut temporary_guard = TemporaryPathGuard::new(temporary_path.clone());
    let temporary_text = temporary_path.to_str().ok_or_else(|| {
        CoreError::InvalidInput(
            "backup path cannot be represented as Unicode".to_owned(),
        )
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

fn sync_file(path: &Path) -> Result<()> {
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

fn validate_non_empty(field: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        return Err(CoreError::InvalidInput(format!(
            "{field} must not be empty"
        )));
    }
    Ok(())
}

fn validate_editor_metadata(
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

fn non_empty_or_generated(field: &str, value: Option<String>) -> Result<String> {
    let value = value.unwrap_or_else(|| Uuid::new_v4().to_string());
    validate_non_empty(field, &value)?;
    Ok(value)
}

fn default_client_identifier() -> String {
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
