use std::fs;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use madi_core::{
    create_project, load_document, open_project, recover_plain_text, save_document,
    CreateProjectParams, LoadDocumentParams, OpenProjectParams, RecoverPlainTextParams,
    SaveDocumentParams, SaveDocumentPayload, APPLICATION_ID, FORMAT_NAME, FORMAT_VERSION,
    SCHEMA_VERSION,
};
use rusqlite::Connection;
use tempfile::tempdir;

const DOCUMENT_ID: &str = "document-main";
const PROJECT_ID: &str = "project-test";
const TYPIE_COMMIT: &str = "0123456789abcdef0123456789abcdef01234567";

fn create_params(path: &std::path::Path) -> CreateProjectParams {
    CreateProjectParams {
        file_path: path.to_path_buf(),
        title: "드래곤을 죽이다".to_owned(),
        created_by: Some("madi-test/0".to_owned()),
        author_name: Some("테스트 작가".to_owned()),
        project_id: Some(PROJECT_ID.to_owned()),
        document_id: Some(DOCUMENT_ID.to_owned()),
        document_title: Some("1화".to_owned()),
        editor_engine: Some("typie".to_owned()),
        editor_engine_commit: Some(TYPIE_COMMIT.to_owned()),
        editor_schema_version: Some(1),
    }
}

#[test]
fn creates_real_sqlite_madi_with_application_metadata_and_migration() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("드래곤을죽이다.madi");

    let created = create_project(create_params(&path)).unwrap();

    assert_eq!(created.default_document_id, DOCUMENT_ID);
    assert_eq!(&fs::read(&path).unwrap()[..16], b"SQLite format 3\0");
    assert_eq!(created.project.application_id, APPLICATION_ID);
    assert_eq!(created.project.metadata.format_name, FORMAT_NAME);
    assert_eq!(created.project.metadata.format_version, FORMAT_VERSION);
    assert_eq!(created.project.metadata.schema_version, SCHEMA_VERSION);
    assert_eq!(created.project.metadata.revision, 0);
    assert_eq!(created.project.documents.len(), 1);
    assert_eq!(
        created.project.schema_migrations.len(),
        SCHEMA_VERSION as usize
    );
    assert_eq!(created.project.schema_migrations[0].version, 1);
    assert_eq!(created.project.schema_migrations[1].version, 2);
    assert_eq!(created.project.schema_migrations[3].version, 4);
    assert_eq!(created.project.schema_migrations[4].version, 5);
    assert_eq!(created.project.schema_migrations[5].version, 6);
    assert_eq!(created.project.schema_migrations[6].version, 7);
    assert_eq!(created.project.schema_migrations[7].version, 8);

    let connection = Connection::open(&path).unwrap();
    let application_id: i64 = connection
        .pragma_query_value(None, "application_id", |row| row.get(0))
        .unwrap();
    let user_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(application_id, APPLICATION_ID);
    assert_eq!(user_version, SCHEMA_VERSION);
}

#[test]
fn snapshot_blob_plain_text_reopen_and_recovery_round_trip() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("드래곤을죽이다.madi");
    create_project(create_params(&path)).unwrap();

    let snapshot = vec![0, 1, 2, 0xff, 0x7f, 0x80, 42, 0];
    let plain_text = "용이 깨어났다.\n\n* * *\n\n두 번째 장면.";
    let saved = save_document(SaveDocumentParams {
        file_path: path.clone(),
        document: SaveDocumentPayload {
            id: DOCUMENT_ID.to_owned(),
            project_id: Some(PROJECT_ID.to_owned()),
            title: "1화".to_owned(),
            editor_engine: "typie".to_owned(),
            editor_engine_commit: TYPIE_COMMIT.to_owned(),
            editor_schema_version: 1,
            snapshot_base64: BASE64_STANDARD.encode(&snapshot),
            plain_text_recovery: plain_text.to_owned(),
        },
        expected_revision: Some(0),
        saved_by: Some("madi-test/1".to_owned()),
    })
    .unwrap();

    assert_eq!(saved.metadata.revision, 1);
    assert_eq!(saved.document.snapshot_bytes, snapshot.len() as u64);
    assert_eq!(saved.document.plain_text_bytes, plain_text.len() as u64);
    assert!(saved.backup_file_path.is_file());

    // All SQLite handles from save are closed here. Reopening exercises the
    // same path used after an application restart.
    let reopened = open_project(OpenProjectParams {
        file_path: path.clone(),
    })
    .unwrap();
    assert_eq!(reopened.metadata.revision, 1);
    assert_eq!(reopened.integrity_check, "ok");

    let loaded = load_document(LoadDocumentParams {
        file_path: path.clone(),
        document_id: Some(DOCUMENT_ID.to_owned()),
    })
    .unwrap();
    assert_eq!(
        BASE64_STANDARD.decode(loaded.snapshot_base64).unwrap(),
        snapshot
    );
    assert_eq!(loaded.plain_text_recovery, plain_text);

    let recovered = recover_plain_text(RecoverPlainTextParams {
        file_path: path,
        document_id: Some(DOCUMENT_ID.to_owned()),
    })
    .unwrap();
    assert_eq!(recovered.document_id, DOCUMENT_ID);
    assert_eq!(recovered.plain_text_recovery, plain_text);
    assert_eq!(recovered.project_revision, 1);
}

#[test]
fn backup_is_a_valid_pre_save_project() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("backup-test.madi");
    create_project(create_params(&path)).unwrap();

    let saved = save_document(SaveDocumentParams {
        file_path: path,
        document: SaveDocumentPayload {
            id: DOCUMENT_ID.to_owned(),
            project_id: Some(PROJECT_ID.to_owned()),
            title: "1화".to_owned(),
            editor_engine: "typie".to_owned(),
            editor_engine_commit: TYPIE_COMMIT.to_owned(),
            editor_schema_version: 1,
            snapshot_base64: BASE64_STANDARD.encode(b"saved snapshot"),
            plain_text_recovery: "저장된 원고".to_owned(),
        },
        expected_revision: Some(0),
        saved_by: None,
    })
    .unwrap();

    let backup = open_project(OpenProjectParams {
        file_path: saved.backup_file_path,
    })
    .unwrap();
    assert_eq!(backup.metadata.revision, 0);
    assert_eq!(backup.documents[0].snapshot_bytes, 0);
}

#[test]
fn backup_rotation_keeps_the_two_previous_consistent_revisions() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("rotation-test.madi");
    create_project(create_params(&path)).unwrap();

    for revision in 0..2 {
        save_document(SaveDocumentParams {
            file_path: path.clone(),
            document: SaveDocumentPayload {
                id: DOCUMENT_ID.to_owned(),
                project_id: None,
                title: "1화".to_owned(),
                editor_engine: "typie".to_owned(),
                editor_engine_commit: TYPIE_COMMIT.to_owned(),
                editor_schema_version: 1,
                snapshot_base64: BASE64_STANDARD.encode(format!("snapshot-{revision}").as_bytes()),
                plain_text_recovery: format!("원고 {revision}"),
            },
            expected_revision: Some(revision),
            saved_by: None,
        })
        .unwrap();
    }

    let current_backup = path.with_file_name("rotation-test.madi.bak");
    let previous_backup = path.with_file_name("rotation-test.madi.bak.previous");
    let current = open_project(OpenProjectParams {
        file_path: current_backup,
    })
    .unwrap();
    let previous = open_project(OpenProjectParams {
        file_path: previous_backup,
    })
    .unwrap();

    assert_eq!(current.metadata.revision, 1);
    assert_eq!(previous.metadata.revision, 0);
    assert_eq!(current.integrity_check, "ok");
    assert_eq!(previous.integrity_check, "ok");
}

#[test]
fn stale_revision_never_overwrites_the_document() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("conflict-test.madi");
    create_project(create_params(&path)).unwrap();

    let first = SaveDocumentParams {
        file_path: path.clone(),
        document: SaveDocumentPayload {
            id: DOCUMENT_ID.to_owned(),
            project_id: None,
            title: "1화".to_owned(),
            editor_engine: "typie".to_owned(),
            editor_engine_commit: TYPIE_COMMIT.to_owned(),
            editor_schema_version: 1,
            snapshot_base64: BASE64_STANDARD.encode(b"first"),
            plain_text_recovery: "첫 저장".to_owned(),
        },
        expected_revision: Some(0),
        saved_by: None,
    };
    save_document(first.clone()).unwrap();

    let error = save_document(first).unwrap_err();
    assert!(error.to_string().contains("revision conflict"));

    let loaded = load_document(LoadDocumentParams {
        file_path: path,
        document_id: Some(DOCUMENT_ID.to_owned()),
    })
    .unwrap();
    assert_eq!(loaded.plain_text_recovery, "첫 저장");
    assert_eq!(
        BASE64_STANDARD.decode(loaded.snapshot_base64).unwrap(),
        b"first"
    );
}
