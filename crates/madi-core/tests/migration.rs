use madi_core::{
    open_project, OpenProjectParams, APPLICATION_ID, FORMAT_NAME,
    FORMAT_VERSION, SCHEMA_VERSION,
};
use rusqlite::{params, Connection};
use tempfile::tempdir;

#[test]
fn migrates_a_version_zero_project_and_records_the_migration() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("legacy.madi");
    let connection = Connection::open(&path).unwrap();
    connection
        .pragma_update(None, "application_id", APPLICATION_ID)
        .unwrap();
    connection
        .execute_batch(
            "CREATE TABLE app_meta (
                singleton INTEGER NOT NULL PRIMARY KEY,
                format_name TEXT NOT NULL,
                format_version INTEGER NOT NULL,
                schema_version INTEGER NOT NULL,
                created_by TEXT NOT NULL,
                last_saved_by TEXT NOT NULL,
                project_id TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                revision INTEGER NOT NULL
             );",
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO app_meta VALUES
                (1, ?1, ?2, ?3, 'legacy-test', 'legacy-test',
                 'legacy-project', '이전 작품',
                 '2026-01-01T00:00:00.000Z',
                 '2026-01-01T00:00:00.000Z', 0)",
            params![FORMAT_NAME, FORMAT_VERSION, SCHEMA_VERSION],
        )
        .unwrap();
    drop(connection);

    let opened = open_project(OpenProjectParams {
        file_path: path.clone(),
    })
    .unwrap();

    assert_eq!(opened.schema_migrations.len(), 1);
    assert_eq!(opened.schema_migrations[0].version, 1);
    assert!(opened.documents.is_empty());

    let connection = Connection::open(path).unwrap();
    let user_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(user_version, SCHEMA_VERSION);
}

