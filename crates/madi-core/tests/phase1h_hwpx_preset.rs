use std::path::{Path, PathBuf};

use madi_core::*;
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tempfile::TempDir;

struct Fixture {
    _directory: TempDir,
    path: PathBuf,
    project_id: String,
}

#[derive(Debug, PartialEq, Eq)]
struct StoredPresetRow {
    id: String,
    project_id: String,
    kind: String,
    name: String,
    preset_format: String,
    preset_version: i64,
    preset_json: String,
    content_hash: String,
    revision: i64,
    created_at: String,
    updated_at: String,
}

fn fixture(file_name: &str, project_id: &str) -> Fixture {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join(file_name);
    create_project(CreateProjectParams {
        file_path: path.clone(),
        title: "Phase 1H 장편".to_owned(),
        created_by: Some("phase1h-test".to_owned()),
        author_name: Some("테스트 작가".to_owned()),
        project_id: Some(project_id.to_owned()),
        document_id: Some(format!("{project_id}-document")),
        document_title: Some("첫 장면".to_owned()),
        editor_engine: Some("typie".to_owned()),
        editor_engine_commit: Some("phase1h-test-commit".to_owned()),
        editor_schema_version: Some(1),
    })
    .unwrap();
    Fixture {
        _directory: directory,
        path,
        project_id: project_id.to_owned(),
    }
}

fn epub_config() -> EpubExportPresetConfig {
    EpubExportPresetConfig {
        format_version: 1,
        target_profile: EpubTargetProfile::Epub34Draft202608,
        split_mode: EpubSplitMode::Chapter,
        toc_depth: 3,
        include_chapter_titles: true,
        include_scene_titles: false,
        scene_break_style_token: EpubSceneBreakStyleToken::Ornament,
        body_style_token: EpubBodyStyleToken::ReflowableProse,
        include_cover: true,
        stylesheet_token: EpubStylesheetToken::MadiClassic,
    }
}

fn heading(font_size_pt: f64, page_break_before: bool) -> HwpxHeadingStyleConfig {
    HwpxHeadingStyleConfig {
        font_family_token: "MADI_SERIF_KO".to_owned(),
        font_size_pt,
        bold: true,
        alignment: HwpxTextAlign::Center,
        spacing_before: 12.0,
        spacing_after: 12.0,
        page_break_before,
    }
}

fn hwpx_config() -> HwpxExportPresetConfig {
    HwpxExportPresetConfig {
        format_version: 1,
        page_size_token: HwpxPageSizeToken::A4,
        custom_page_width: None,
        custom_page_height: None,
        orientation: HwpxOrientation::Portrait,
        margin_top: 20.0,
        margin_bottom: 20.0,
        margin_left: 25.0,
        margin_right: 25.0,
        header_margin: 10.0,
        footer_margin: 10.0,
        gutter: 0.0,
        font_family_token: "MADI_SERIF_KO".to_owned(),
        font_size_pt: 10.5,
        line_spacing_mode: HwpxLineSpacingMode::Percent,
        line_spacing_value: 160.0,
        first_line_indent: 10.0,
        paragraph_spacing_before: 0.0,
        paragraph_spacing_after: 0.0,
        text_align: HwpxTextAlign::Justify,
        work_title_style: heading(24.0, true),
        volume_title_style: heading(20.0, true),
        chapter_title_style: heading(16.0, true),
        scene_title_style: heading(12.0, false),
        include_title_page: true,
        include_work_title: true,
        include_volume_titles: true,
        include_chapter_titles: true,
        include_scene_titles: false,
        section_split_mode: HwpxSectionSplitMode::Volume,
        include_page_number: true,
        page_number_start: 1,
        page_number_position: HwpxPageNumberPosition::BottomCenter,
        include_header: false,
        header_text: String::new(),
        include_footer: false,
        footer_text: String::new(),
        scene_break_token: HwpxSceneBreakToken::Ornament,
    }
}

fn stored_preset(path: &Path, preset_id: &str) -> StoredPresetRow {
    Connection::open(path)
        .unwrap()
        .query_row(
            "SELECT id, project_id, kind, name, preset_format, preset_version,
                    preset_json, content_hash, revision, created_at, updated_at
             FROM export_presets WHERE id = ?1",
            [preset_id],
            |row| {
                Ok(StoredPresetRow {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    kind: row.get(2)?,
                    name: row.get(3)?,
                    preset_format: row.get(4)?,
                    preset_version: row.get(5)?,
                    preset_json: row.get(6)?,
                    content_hash: row.get(7)?,
                    revision: row.get(8)?,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            },
        )
        .unwrap()
}

fn snapshot_payload(path: &Path, snapshot_id: &str) -> Value {
    let connection = Connection::open(path).unwrap();
    let bytes: Vec<u8> = connection
        .query_row(
            "SELECT payload_blob FROM named_snapshots WHERE id = ?1",
            [snapshot_id],
            |row| row.get(0),
        )
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

fn insert_derived_snapshot(
    path: &Path,
    source_id: &str,
    snapshot_id: &str,
    version: i64,
    payload: &Value,
) {
    let blob = serde_json::to_vec(payload).unwrap();
    let hash = format!("{:x}", Sha256::digest(&blob));
    Connection::open(path)
        .unwrap()
        .execute(
            "INSERT INTO named_snapshots (
                id, project_id, name, note, kind, payload_format, payload_version,
                payload_blob, content_hash, created_at, updated_at
             ) SELECT ?1, project_id, ?2, NULL, 'MANUAL', payload_format, ?3,
                      ?4, ?5, created_at, updated_at
               FROM named_snapshots WHERE id = ?6",
            params![snapshot_id, snapshot_id, version, blob, hash, source_id],
        )
        .unwrap();
}

fn legacy_snapshot_payload(v5: &Value, version: i64) -> Value {
    assert!((1..=4).contains(&version));
    let mut payload = v5.clone();
    payload["version"] = json!(version);
    let object = payload.as_object_mut().unwrap();
    for key in [
        "publication_metadata",
        "publication_assets",
        "export_presets",
    ] {
        object.remove(key);
    }
    if version < 4 {
        object.remove("reader_presets");
    }
    if version < 3 {
        object.remove("canvases");
    }
    if version < 2 {
        for key in [
            "entities",
            "entity_aliases",
            "tags",
            "entity_tags",
            "relation_types",
            "entity_relations",
            "scene_entity_links",
        ] {
            object.remove(key);
        }
    }
    payload
}

#[test]
fn schema_seven_epub_rows_migrate_to_eight_without_changing_any_preset_column() {
    let fixture = fixture("migration.madi", "phase1h-migration");
    let created = create_export_preset(CreateExportPresetParams {
        file_path: fixture.path.clone(),
        preset_id: Some("legacy-epub".to_owned()),
        kind: ExportPresetKind::Epub,
        name: "기존 EPUB".to_owned(),
        preset_json: ExportPresetConfig::Epub(epub_config()),
        expected_revision: 0,
        saved_by: Some("phase1h-test".to_owned()),
    })
    .unwrap();
    let before = stored_preset(&fixture.path, "legacy-epub");

    let connection = Connection::open(&fixture.path).unwrap();
    connection
        .execute_batch(
            "PRAGMA foreign_keys = OFF;
             DROP INDEX export_presets_project_name_idx;
             DROP INDEX export_presets_project_updated_idx;
             ALTER TABLE export_presets RENAME TO export_presets_v8;
             CREATE TABLE export_presets (
                 id TEXT NOT NULL PRIMARY KEY,
                 project_id TEXT NOT NULL,
                 kind TEXT NOT NULL CHECK (kind = 'EPUB'),
                 name TEXT NOT NULL CHECK (length(trim(name)) > 0),
                 preset_format TEXT NOT NULL CHECK (preset_format = 'MADI_EXPORT_PRESET'),
                 preset_version INTEGER NOT NULL CHECK (preset_version = 1),
                 preset_json TEXT NOT NULL CHECK (json_valid(preset_json)),
                 content_hash TEXT NOT NULL CHECK (
                     length(content_hash) = 64
                     AND content_hash = lower(content_hash)
                     AND content_hash NOT GLOB '*[^0-9a-f]*'
                 ),
                 revision INTEGER NOT NULL CHECK (revision >= 0),
                 created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL,
                 FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
             );
             INSERT INTO export_presets SELECT * FROM export_presets_v8;
             DROP TABLE export_presets_v8;
             CREATE INDEX export_presets_project_name_idx
                 ON export_presets(project_id, kind, name COLLATE NOCASE, id);
             CREATE INDEX export_presets_project_updated_idx
                 ON export_presets(project_id, updated_at DESC, id);
             DELETE FROM schema_migrations WHERE version = 8;
             UPDATE app_meta SET schema_version = 7;
             PRAGMA user_version = 7;
             PRAGMA foreign_keys = ON;",
        )
        .unwrap();
    let rejected_hwpx_before_migration = connection.execute(
        "INSERT INTO export_presets (
            id, project_id, kind, name, preset_format, preset_version,
            preset_json, content_hash, revision, created_at, updated_at
         ) VALUES ('blocked-hwpx', ?1, 'HWPX', 'blocked',
                   'MADI_EXPORT_PRESET', 1, '{}', ?2, 0, 'now', 'now')",
        params![fixture.project_id, "0".repeat(64)],
    );
    assert!(rejected_hwpx_before_migration.is_err());
    drop(connection);

    let opened = open_project(OpenProjectParams {
        file_path: fixture.path.clone(),
    })
    .unwrap();
    assert_eq!(opened.metadata.schema_version, SCHEMA_VERSION);
    assert_eq!(opened.metadata.schema_version, 8);
    assert_eq!(opened.metadata.revision, created.revision);
    assert_eq!(opened.schema_migrations.last().unwrap().version, 8);
    assert_eq!(stored_preset(&fixture.path, "legacy-epub"), before);

    let hwpx = create_export_preset(CreateExportPresetParams {
        file_path: fixture.path.clone(),
        preset_id: Some("new-hwpx".to_owned()),
        kind: ExportPresetKind::Hwpx,
        name: "새 HWPX".to_owned(),
        preset_json: ExportPresetConfig::Hwpx(hwpx_config()),
        expected_revision: opened.metadata.revision,
        saved_by: Some("phase1h-test".to_owned()),
    })
    .unwrap();
    assert_eq!(hwpx.preset.kind, ExportPresetKind::Hwpx);
    assert_eq!(stored_preset(&fixture.path, "new-hwpx").kind, "HWPX");
}

#[test]
fn mixed_epub_hwpx_crud_is_revisioned_hashed_and_kind_mismatch_is_fail_closed() {
    let fixture = fixture("crud.madi", "phase1h-crud");
    let epub = create_export_preset(CreateExportPresetParams {
        file_path: fixture.path.clone(),
        preset_id: Some("epub".to_owned()),
        kind: ExportPresetKind::Epub,
        name: "EPUB".to_owned(),
        preset_json: ExportPresetConfig::Epub(epub_config()),
        expected_revision: 0,
        saved_by: None,
    })
    .unwrap();
    assert_eq!(epub.revision, 1);
    assert_eq!(epub.preset.revision, 0);

    let hwpx = create_export_preset(CreateExportPresetParams {
        file_path: fixture.path.clone(),
        preset_id: Some("hwpx".to_owned()),
        kind: ExportPresetKind::Hwpx,
        name: "HWPX".to_owned(),
        preset_json: ExportPresetConfig::Hwpx(hwpx_config()),
        expected_revision: epub.revision,
        saved_by: None,
    })
    .unwrap();
    assert_eq!(hwpx.revision, 2);
    let stored_hwpx = stored_preset(&fixture.path, "hwpx");
    assert_eq!(stored_hwpx.content_hash, hwpx.preset.content_hash);
    assert_eq!(
        stored_hwpx.content_hash,
        format!("{:x}", Sha256::digest(stored_hwpx.preset_json.as_bytes()))
    );

    let listed = list_export_presets(ListExportPresetsParams {
        file_path: fixture.path.clone(),
    })
    .unwrap();
    assert_eq!(
        listed
            .presets
            .iter()
            .map(|preset| (preset.id.as_str(), preset.kind))
            .collect::<Vec<_>>(),
        vec![
            ("epub", ExportPresetKind::Epub),
            ("hwpx", ExportPresetKind::Hwpx),
        ]
    );

    let no_op = update_export_preset(UpdateExportPresetParams {
        file_path: fixture.path.clone(),
        preset_id: "hwpx".to_owned(),
        kind: ExportPresetKind::Hwpx,
        name: "HWPX".to_owned(),
        preset_json: hwpx.preset.preset_json.clone(),
        expected_revision: hwpx.revision,
        expected_preset_revision: 0,
        saved_by: None,
    })
    .unwrap();
    assert!(no_op.no_op);
    assert_eq!(no_op.revision, hwpx.revision);
    assert_eq!(no_op.preset.content_hash, hwpx.preset.content_hash);

    let mut changed_config = hwpx_config();
    changed_config.margin_top = 22.0;
    let changed = update_export_preset(UpdateExportPresetParams {
        file_path: fixture.path.clone(),
        preset_id: "hwpx".to_owned(),
        kind: ExportPresetKind::Hwpx,
        name: "HWPX 수정".to_owned(),
        preset_json: ExportPresetConfig::Hwpx(changed_config),
        expected_revision: no_op.revision,
        expected_preset_revision: 0,
        saved_by: None,
    })
    .unwrap();
    assert_eq!(changed.revision, 3);
    assert_eq!(changed.preset.revision, 1);
    assert_ne!(changed.preset.content_hash, hwpx.preset.content_hash);

    let programmatic_mismatch = update_export_preset(UpdateExportPresetParams {
        file_path: fixture.path.clone(),
        preset_id: "hwpx".to_owned(),
        kind: ExportPresetKind::Epub,
        name: "절대 바뀌면 안 됨".to_owned(),
        preset_json: changed.preset.preset_json.clone(),
        expected_revision: changed.revision,
        expected_preset_revision: changed.preset.revision,
        saved_by: None,
    });
    assert!(matches!(
        programmatic_mismatch,
        Err(CoreError::InvalidInput(_))
    ));

    let rpc_mismatch = dispatch(
        "create_export_preset",
        json!({
            "file_path": fixture.path,
            "preset_id": "mismatched-wire",
            "kind": "HWPX",
            "name": "mismatch",
            "preset_json": epub_config(),
            "expected_revision": changed.revision
        }),
    );
    assert!(matches!(rpc_mismatch, Err(CoreError::InvalidInput(_))));

    let mut mismatched_record = serde_json::to_value(&epub.preset).unwrap();
    mismatched_record["kind"] = json!("HWPX");
    assert!(serde_json::from_value::<ExportPresetRecord>(mismatched_record).is_err());
    assert_eq!(
        list_export_presets(ListExportPresetsParams {
            file_path: fixture.path.clone(),
        })
        .unwrap()
        .revision,
        changed.revision
    );

    let duplicate = duplicate_export_preset(DuplicateExportPresetParams {
        file_path: fixture.path.clone(),
        source_preset_id: "hwpx".to_owned(),
        preset_id: Some("hwpx-copy".to_owned()),
        name: Some("HWPX 복제".to_owned()),
        expected_revision: changed.revision,
        saved_by: None,
    })
    .unwrap();
    assert_eq!(duplicate.preset.kind, ExportPresetKind::Hwpx);
    assert_eq!(duplicate.preset.content_hash, changed.preset.content_hash);
    assert_eq!(duplicate.preset.revision, 0);
    assert_eq!(duplicate.revision, 4);

    let deleted = delete_export_preset(DeleteExportPresetParams {
        file_path: fixture.path.clone(),
        preset_id: duplicate.preset.id,
        expected_revision: duplicate.revision,
        expected_preset_revision: 0,
        saved_by: None,
    })
    .unwrap();
    assert_eq!(deleted.revision, 5);
    assert_eq!(deleted.deleted_preset_id, "hwpx-copy");

    open_project(OpenProjectParams {
        file_path: fixture.path.clone(),
    })
    .unwrap();
    let reopened = list_export_presets(ListExportPresetsParams {
        file_path: fixture.path,
    })
    .unwrap();
    assert_eq!(reopened.presets.len(), 2);
    assert_eq!(reopened.presets[1], changed.preset);
}

#[test]
fn snapshot_v5_mixes_epub_hwpx_diffs_restores_reopens_and_legacy_v1_to_v4_decode() {
    let fixture = fixture("snapshot.madi", "phase1h-snapshot");
    let epub = create_export_preset(CreateExportPresetParams {
        file_path: fixture.path.clone(),
        preset_id: Some("snapshot-epub".to_owned()),
        kind: ExportPresetKind::Epub,
        name: "snapshot EPUB".to_owned(),
        preset_json: ExportPresetConfig::Epub(epub_config()),
        expected_revision: 0,
        saved_by: None,
    })
    .unwrap();
    let hwpx = create_export_preset(CreateExportPresetParams {
        file_path: fixture.path.clone(),
        preset_id: Some("snapshot-hwpx".to_owned()),
        kind: ExportPresetKind::Hwpx,
        name: "snapshot HWPX".to_owned(),
        preset_json: ExportPresetConfig::Hwpx(hwpx_config()),
        expected_revision: epub.revision,
        saved_by: None,
    })
    .unwrap();
    let baseline_rows = vec![
        stored_preset(&fixture.path, "snapshot-epub"),
        stored_preset(&fixture.path, "snapshot-hwpx"),
    ];

    let snapshot = create_named_snapshot(CreateNamedSnapshotParams {
        file_path: fixture.path.clone(),
        name: "mixed export presets".to_owned(),
        note: None,
        kind: NamedSnapshotKind::Manual,
        snapshot_id: Some("mixed-v5".to_owned()),
        expected_revision: Some(hwpx.revision),
        saved_by: None,
    })
    .unwrap();
    assert_eq!(snapshot.snapshot.payload_version, 5);
    let v5 = snapshot_payload(&fixture.path, "mixed-v5");
    assert_eq!(v5["version"], 5);
    assert_eq!(v5["export_presets"].as_array().unwrap().len(), 2);
    assert_eq!(v5["export_presets"][0]["kind"], "EPUB");
    assert_eq!(v5["export_presets"][1]["kind"], "HWPX");
    assert!(v5["export_presets"][0]["preset_json"]["Epub"].is_null());
    assert!(v5["export_presets"][1]["preset_json"]["Hwpx"].is_null());
    assert_eq!(
        v5["export_presets"][1]["preset_json"]["pageSizeToken"],
        "A4"
    );

    for version in 1..=4 {
        let payload = legacy_snapshot_payload(&v5, version);
        let id = format!("legacy-v{version}");
        insert_derived_snapshot(&fixture.path, "mixed-v5", &id, version, &payload);
        let decoded = diff_named_snapshot(DiffNamedSnapshotParams {
            file_path: fixture.path.clone(),
            snapshot_id: id,
        })
        .unwrap();
        assert_eq!(decoded.snapshot.payload_version, version);
    }

    let mut changed_config = hwpx_config();
    changed_config.page_number_start = 17;
    let changed = update_export_preset(UpdateExportPresetParams {
        file_path: fixture.path.clone(),
        preset_id: "snapshot-hwpx".to_owned(),
        kind: ExportPresetKind::Hwpx,
        name: "changed HWPX".to_owned(),
        preset_json: ExportPresetConfig::Hwpx(changed_config),
        expected_revision: snapshot.metadata.revision,
        expected_preset_revision: 0,
        saved_by: None,
    })
    .unwrap();
    let deleted = delete_export_preset(DeleteExportPresetParams {
        file_path: fixture.path.clone(),
        preset_id: "snapshot-epub".to_owned(),
        expected_revision: changed.revision,
        expected_preset_revision: 0,
        saved_by: None,
    })
    .unwrap();
    let current_only = create_export_preset(CreateExportPresetParams {
        file_path: fixture.path.clone(),
        preset_id: Some("current-only".to_owned()),
        kind: ExportPresetKind::Epub,
        name: "current only".to_owned(),
        preset_json: ExportPresetConfig::Epub(epub_config()),
        expected_revision: deleted.revision,
        saved_by: None,
    })
    .unwrap();
    let diff = diff_named_snapshot(DiffNamedSnapshotParams {
        file_path: fixture.path.clone(),
        snapshot_id: "mixed-v5".to_owned(),
    })
    .unwrap();
    assert_eq!(diff.summary.added_export_presets, 1);
    assert_eq!(diff.summary.deleted_export_presets, 1);
    assert_eq!(diff.summary.changed_export_presets, 1);

    let restored = restore_named_snapshot(RestoreNamedSnapshotParams {
        file_path: fixture.path.clone(),
        snapshot_id: "mixed-v5".to_owned(),
        auto_snapshot_name: Some("before mixed restore".to_owned()),
        expected_revision: Some(current_only.revision),
        saved_by: None,
    })
    .unwrap();
    assert_eq!(restored.restored_snapshot.payload_version, 5);
    assert_eq!(
        stored_preset(&fixture.path, "snapshot-epub"),
        baseline_rows[0]
    );
    assert_eq!(
        stored_preset(&fixture.path, "snapshot-hwpx"),
        baseline_rows[1]
    );

    open_project(OpenProjectParams {
        file_path: fixture.path.clone(),
    })
    .unwrap();
    let reopened = list_export_presets(ListExportPresetsParams {
        file_path: fixture.path.clone(),
    })
    .unwrap();
    assert_eq!(
        reopened
            .presets
            .iter()
            .map(|preset| preset.kind)
            .collect::<Vec<_>>(),
        vec![ExportPresetKind::Epub, ExportPresetKind::Hwpx]
    );

    let mut mismatched = v5.clone();
    mismatched["export_presets"][1]["kind"] = json!("EPUB");
    insert_derived_snapshot(&fixture.path, "mixed-v5", "mismatched-v5", 5, &mismatched);
    assert!(matches!(
        diff_named_snapshot(DiffNamedSnapshotParams {
            file_path: fixture.path.clone(),
            snapshot_id: "mismatched-v5".to_owned(),
        }),
        Err(CoreError::SnapshotIntegrity(_))
    ));
    assert_eq!(
        list_export_presets(ListExportPresetsParams {
            file_path: fixture.path,
        })
        .unwrap()
        .presets,
        reopened.presets
    );
}
