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

#[cfg(windows)]
mod windows_backup_sharing {
    use super::*;
    use madi_core::CoreError;
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;
    use std::path::{Path, PathBuf};
    use std::thread;
    use std::time::{Duration, Instant};

    fn save_params(path: &Path, revision: i64) -> SaveDocumentParams {
        SaveDocumentParams {
            file_path: path.to_path_buf(),
            document: SaveDocumentPayload {
                id: DOCUMENT_ID.to_owned(),
                project_id: None,
                title: "fixture".to_owned(),
                editor_engine: "typie".to_owned(),
                editor_engine_commit: TYPIE_COMMIT.to_owned(),
                editor_schema_version: 1,
                snapshot_base64: BASE64_STANDARD.encode(format!("snapshot-{revision}")),
                plain_text_recovery: format!("fixture-{revision}"),
            },
            expected_revision: Some(revision),
            saved_by: None,
        }
    }

    fn fixture_with_two_backups() -> (tempfile::TempDir, PathBuf, PathBuf, PathBuf) {
        let directory = tempdir().unwrap();
        let path = directory.path().join("sharing-test.madi");
        create_project(create_params(&path)).unwrap();
        for revision in 0..2 {
            save_document(save_params(&path, revision)).unwrap();
        }
        let backup = path.with_file_name("sharing-test.madi.bak");
        let previous = path.with_file_name("sharing-test.madi.bak.previous");
        assert!(backup.is_file() && previous.is_file());
        (directory, path, backup, previous)
    }

    #[test]
    fn backup_sharing_release_allows_one_same_revision_save() {
        let (_directory, path, backup, previous) = fixture_with_two_backups();
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(0)
            .open(&previous)
            .unwrap();
        let release = thread::spawn(move || {
            thread::sleep(Duration::from_millis(150));
            drop(lock);
        });
        let result = save_document(save_params(&path, 2));
        release.join().unwrap();
        let saved = result.unwrap();
        assert_eq!(saved.metadata.revision, 3);
        let loaded = load_document(LoadDocumentParams {
            file_path: path,
            document_id: Some(DOCUMENT_ID.to_owned()),
        })
        .unwrap();
        assert_eq!(loaded.plain_text_recovery, "fixture-2");
        assert_eq!(
            BASE64_STANDARD.decode(loaded.snapshot_base64).unwrap(),
            b"snapshot-2"
        );
        for (path, revision) in [(backup, 2), (previous, 1)] {
            assert_eq!(
                open_project(OpenProjectParams { file_path: path })
                    .unwrap()
                    .metadata
                    .revision,
                revision
            );
        }
    }

    #[test]
    fn backup_sharing_permanent_lock_preserves_revision_content_and_both_backups() {
        let (_directory, path, backup, previous) = fixture_with_two_backups();
        let original_bytes =
            [fs::read(&path), fs::read(&backup), fs::read(&previous)].map(Result::unwrap);
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(0)
            .open(&previous)
            .unwrap();
        let started = Instant::now();
        let error = save_document(save_params(&path, 2)).unwrap_err();
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(matches!(error, CoreError::Io(ref error) if error.raw_os_error() == Some(32)));
        drop(lock);
        let unchanged_bytes =
            [fs::read(&path), fs::read(&backup), fs::read(&previous)].map(Result::unwrap);
        assert_eq!(unchanged_bytes, original_bytes);
        let loaded = load_document(LoadDocumentParams {
            file_path: path.clone(),
            document_id: Some(DOCUMENT_ID.to_owned()),
        })
        .unwrap();
        assert_eq!(
            open_project(OpenProjectParams {
                file_path: path.clone()
            })
            .unwrap()
            .metadata
            .revision,
            2
        );
        assert_eq!(loaded.plain_text_recovery, "fixture-1");
        assert_eq!(
            BASE64_STANDARD.decode(loaded.snapshot_base64).unwrap(),
            b"snapshot-1"
        );
        assert_eq!(
            save_document(save_params(&path, 2))
                .unwrap()
                .metadata
                .revision,
            3
        );
    }
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
