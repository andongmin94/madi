use madi_core::{
    load_project_tree, load_scene, open_project, LoadProjectTreeParams,
    LoadSceneParams, NodeKind, OpenProjectParams, APPLICATION_ID, FORMAT_NAME,
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
            params![FORMAT_NAME, 0_i64, 1_i64],
        )
        .unwrap();
    drop(connection);

    let opened = open_project(OpenProjectParams {
        file_path: path.clone(),
    })
    .unwrap();

    assert_eq!(opened.metadata.format_version, FORMAT_VERSION);
    assert_eq!(opened.metadata.schema_version, SCHEMA_VERSION);
    assert_eq!(opened.schema_migrations.len(), 2);
    assert_eq!(opened.schema_migrations[0].version, 1);
    assert_eq!(opened.schema_migrations[1].version, 2);
    assert!(opened.documents.is_empty());

    let connection = Connection::open(path).unwrap();
    let user_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(user_version, SCHEMA_VERSION);
}

#[test]
fn migrates_format_zero_schema_one_document_into_default_chapter_scene() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("phase-0-document.madi");
    let connection = Connection::open(&path).unwrap();
    connection
        .pragma_update(None, "application_id", APPLICATION_ID)
        .unwrap();
    connection
        .pragma_update(None, "user_version", 1_i64)
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
             );
             CREATE TABLE documents (
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
                FOREIGN KEY (project_id) REFERENCES app_meta(project_id)
             );
             CREATE TABLE schema_migrations (
                version INTEGER NOT NULL PRIMARY KEY,
                applied_at TEXT NOT NULL,
                description TEXT NOT NULL
             );",
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO app_meta VALUES
                (1, 'madi', 0, 1, 'legacy-test', 'legacy-test',
                 'legacy-project', '이전 작품',
                 '2026-01-01T00:00:00.000Z',
                 '2026-01-01T00:00:00.000Z', 7)",
            [],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO documents VALUES
                ('legacy-document', 'legacy-project', '이전 1화',
                 'typie', 'legacy-commit', 1, ?1, ?2,
                 '2026-01-01T00:00:00.000Z',
                 '2026-01-01T00:00:00.000Z')",
            params![b"legacy-snapshot".as_slice(), "이전 원고"],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO schema_migrations VALUES
                (1, '2026-01-01T00:00:00.000Z', 'phase-0 schema')",
            [],
        )
        .unwrap();
    drop(connection);

    let opened = open_project(OpenProjectParams {
        file_path: path.clone(),
    })
    .unwrap();
    assert_eq!(opened.metadata.format_version, 1);
    assert_eq!(opened.metadata.schema_version, 2);
    assert_eq!(opened.metadata.revision, 7);
    assert_eq!(opened.documents.len(), 1);
    assert_eq!(opened.schema_migrations.len(), 2);

    let tree = load_project_tree(LoadProjectTreeParams {
        file_path: path.clone(),
    })
    .unwrap();
    assert_eq!(
        tree.nodes
            .iter()
            .filter(|node| node.kind == NodeKind::Work)
            .count(),
        1
    );
    assert_eq!(
        tree.nodes
            .iter()
            .filter(|node| node.kind == NodeKind::Chapter)
            .count(),
        1
    );
    let scene = tree
        .nodes
        .iter()
        .find(|node| node.kind == NodeKind::Scene)
        .unwrap();
    assert_eq!(scene.document_id.as_deref(), Some("legacy-document"));
    let loaded = load_scene(LoadSceneParams {
        file_path: path,
        scene_id: scene.id.clone(),
    })
    .unwrap();
    assert_eq!(loaded.document.plain_text_recovery, "이전 원고");
}
