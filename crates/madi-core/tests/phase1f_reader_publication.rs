use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use editor_codec::{encode_changesets, ReencodableChangesets};
use editor_model::{
    PlainDoc, PlainNode, PlainNodeEntry, PlainParagraphNode, PlainRootNode, PlainTextNode,
};
use editor_state::State;
use madi_core::*;
use madi_publication::{PublicationBlock, PublicationScopeKind, PINNED_TYPIE_COMMIT};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tempfile::{tempdir, TempDir};

struct Fixture {
    _directory: TempDir,
    path: PathBuf,
}

fn fixture(name: &str, project_id: &str) -> Fixture {
    let directory = tempdir().unwrap();
    let path = directory.path().join(name);
    create_project(CreateProjectParams {
        file_path: path.clone(),
        title: "Reader 작품".to_owned(),
        created_by: Some("phase1f-test".to_owned()),
        author_name: Some("작가".to_owned()),
        project_id: Some(project_id.to_owned()),
        document_id: Some(format!("{project_id}-opening-document")),
        document_title: Some("첫 장면".to_owned()),
        editor_engine: Some("typie".to_owned()),
        editor_engine_commit: Some(PINNED_TYPIE_COMMIT.to_owned()),
        editor_schema_version: Some(1),
    })
    .unwrap();
    Fixture {
        _directory: directory,
        path,
    }
}

fn reader_config(status: ReaderVerificationStatus) -> ReaderRenderConfig {
    ReaderRenderConfig {
        format_version: 1,
        platform: PlatformProfile {
            id: "reader-platform".to_owned(),
            name: "Reader platform".to_owned(),
            version: 1,
            family: if status == ReaderVerificationStatus::UnverifiedSimulation {
                PlatformFamily::PlatformLike
            } else {
                PlatformFamily::Generic
            },
            verification_status: status,
            verified_at: (status == ReaderVerificationStatus::Generic)
                .then(|| "2026-08-09T00:00:00.000Z".to_owned()),
            supported_controls: vec![
                ReaderSupportedControl::Typography,
                ReaderSupportedControl::Spacing,
                ReaderSupportedControl::Viewport,
                ReaderSupportedControl::Theme,
            ],
        },
        device: DeviceProfile {
            id: "reader-device".to_owned(),
            name: "Reader device".to_owned(),
            category: ReaderDeviceCategory::Phone,
            viewport_width: 390.0,
            viewport_height: 844.0,
            safe_area_top: 47.0,
            safe_area_bottom: 34.0,
            reader_chrome_height: 52.0,
            pixel_ratio: 3.0,
        },
        settings: ReaderSettings {
            font_family_token: ReaderFontToken::KoreanSans,
            font_size: 18.0,
            line_height: 1.7,
            paragraph_spacing: 12.0,
            first_line_indent: 18.0,
            horizontal_padding: 24.0,
            vertical_padding: 24.0,
            text_align: ReaderTextAlign::Left,
            theme: ReaderTheme::Light,
            background_color: "#ffffff".to_owned(),
            text_color: "#111111".to_owned(),
            scroll_mode: ReaderScrollMode::Continuous,
            show_chapter_title: true,
            show_scene_title: true,
            show_scene_break: true,
        },
        work_style: WorkStyle {
            body_style_token: BodyStyleToken::Prose,
            chapter_title_style_token: ChapterTitleStyleToken::ChapterDefault,
            scene_title_style_token: SceneTitleStyleToken::SceneDefault,
            scene_break_style_token: SceneBreakStyleToken::Diamonds,
        },
    }
}

fn create_custom_preset(
    path: &Path,
    id: &str,
    name: &str,
    expected_revision: i64,
) -> ReaderPresetMutationResult {
    create_reader_preset(CreateReaderPresetParams {
        file_path: path.to_path_buf(),
        preset_id: Some(id.to_owned()),
        name: name.to_owned(),
        source_kind: ReaderPresetSourceKind::Custom,
        source_id: None,
        source_version: None,
        verification_status: ReaderVerificationStatus::UserDefined,
        preset_format: READER_PRESET_FORMAT.to_owned(),
        preset_version: READER_PRESET_VERSION,
        preset_json: reader_config(ReaderVerificationStatus::UserDefined),
        expected_revision,
        saved_by: Some("phase1f-test".to_owned()),
    })
    .unwrap()
}

fn project_revision(path: &Path) -> i64 {
    open_project(OpenProjectParams {
        file_path: path.to_path_buf(),
    })
    .unwrap()
    .metadata
    .revision
}

fn read_snapshot_payload(path: &Path, snapshot_id: &str) -> Value {
    let connection = Connection::open(path).unwrap();
    let payload: Vec<u8> = connection
        .query_row(
            "SELECT payload_blob FROM named_snapshots WHERE id = ?1",
            [snapshot_id],
            |row| row.get(0),
        )
        .unwrap();
    serde_json::from_slice(&payload).unwrap()
}

fn insert_derived_snapshot(path: &Path, source_id: &str, id: &str, version: i64, payload: Value) {
    let blob = serde_json::to_vec(&payload).unwrap();
    let hash = format!("{:x}", Sha256::digest(&blob));
    let connection = Connection::open(path).unwrap();
    connection
        .execute(
            "INSERT INTO named_snapshots (
                id, project_id, name, note, kind, payload_format, payload_version,
                payload_blob, content_hash, created_at, updated_at
             ) SELECT ?1, project_id, ?2, NULL, 'MANUAL', payload_format, ?3,
                      ?4, ?5, created_at, updated_at
               FROM named_snapshots WHERE id = ?6",
            params![id, id, version, blob, hash, source_id],
        )
        .unwrap();
}

fn plain_snapshot(text: &str) -> Vec<u8> {
    fn entry(node: PlainNode, children: Vec<PlainNodeEntry>) -> PlainNodeEntry {
        PlainNodeEntry {
            node,
            modifiers: BTreeMap::new(),
            carry: Vec::new(),
            children,
        }
    }
    let paragraph = entry(
        PlainNode::Paragraph(PlainParagraphNode {}),
        vec![entry(
            PlainNode::Text(PlainTextNode {
                text: text.to_owned(),
            }),
            Vec::new(),
        )],
    );
    let state = State::from_plain(&PlainDoc {
        root: entry(PlainNode::Root(PlainRootNode::default()), vec![paragraph]),
    })
    .unwrap();
    encode_changesets(ReencodableChangesets::from_local_ops(
        state.graph().changesets_as_vec(),
    ))
    .unwrap()
}

#[test]
fn reader_preset_crud_is_canonical_revisioned_and_project_isolated() {
    let first = fixture("reader-a.madi", "reader-project-a");
    let second = fixture("reader-b.madi", "reader-project-b");
    let created = create_reader_preset(CreateReaderPresetParams {
        file_path: first.path.clone(),
        preset_id: Some("preset-a".to_owned()),
        name: "기본".to_owned(),
        source_kind: ReaderPresetSourceKind::BuiltinTemplate,
        source_id: Some("generic-phone".to_owned()),
        source_version: Some("1".to_owned()),
        verification_status: ReaderVerificationStatus::Generic,
        preset_format: READER_PRESET_FORMAT.to_owned(),
        preset_version: READER_PRESET_VERSION,
        preset_json: reader_config(ReaderVerificationStatus::Generic),
        expected_revision: 0,
        saved_by: None,
    })
    .unwrap();
    assert_eq!(created.preset.revision, 0);
    assert_eq!(created.revision, created.metadata.revision);
    assert_eq!(created.metadata.revision, 1);
    assert_eq!(created.preset.content_hash.len(), 64);

    let no_op = update_reader_preset(UpdateReaderPresetParams {
        file_path: first.path.clone(),
        preset_id: "preset-a".to_owned(),
        name: "기본".to_owned(),
        verification_status: ReaderVerificationStatus::Generic,
        preset_json: reader_config(ReaderVerificationStatus::Generic),
        expected_revision: 1,
        expected_preset_revision: 0,
        saved_by: None,
    })
    .unwrap();
    assert!(no_op.no_op);
    assert_eq!(no_op.metadata.revision, 1);
    assert_eq!(no_op.preset.revision, 0);

    let changed = update_reader_preset(UpdateReaderPresetParams {
        file_path: first.path.clone(),
        preset_id: "preset-a".to_owned(),
        name: "기본 수정".to_owned(),
        verification_status: ReaderVerificationStatus::Generic,
        preset_json: reader_config(ReaderVerificationStatus::Generic),
        expected_revision: 1,
        expected_preset_revision: 0,
        saved_by: None,
    })
    .unwrap();
    assert_eq!(changed.preset.revision, 1);
    assert_eq!(changed.metadata.revision, 2);
    assert!(matches!(
        update_reader_preset(UpdateReaderPresetParams {
            file_path: first.path.clone(),
            preset_id: "preset-a".to_owned(),
            name: "stale".to_owned(),
            verification_status: ReaderVerificationStatus::Generic,
            preset_json: reader_config(ReaderVerificationStatus::Generic),
            expected_revision: 2,
            expected_preset_revision: 0,
            saved_by: None,
        }),
        Err(CoreError::ReaderPresetRevisionConflict {
            expected: 0,
            actual: 1
        })
    ));
    assert_eq!(project_revision(&first.path), 2);

    let duplicate = duplicate_reader_preset(DuplicateReaderPresetParams {
        file_path: first.path.clone(),
        source_preset_id: "preset-a".to_owned(),
        preset_id: Some("preset-copy".to_owned()),
        name: Some("기본 수정".to_owned()),
        expected_revision: 2,
        saved_by: None,
    })
    .unwrap();
    assert_eq!(duplicate.preset.revision, 0);
    assert_eq!(
        duplicate.preset.verification_status,
        ReaderVerificationStatus::UserDefined
    );
    assert_eq!(
        duplicate.preset.preset_json.platform.verification_status,
        ReaderVerificationStatus::UserDefined
    );
    assert!(duplicate.preset.preset_json.platform.verified_at.is_none());
    let listed = list_reader_presets(ListReaderPresetsParams {
        file_path: first.path.clone(),
    })
    .unwrap();
    assert_eq!(listed.presets.len(), 2);
    assert_eq!(listed.duplicate_names, vec!["기본 수정"]);
    assert_eq!(listed.revision, listed.metadata.revision);
    let rpc_list = dispatch(
        "list_reader_presets",
        json!({ "file_path": first.path.clone() }),
    )
    .unwrap();
    assert_eq!(rpc_list["revision"], rpc_list["metadata"]["revision"]);
    assert!(rpc_list["presets"][0].get("preset_json").is_some());
    assert!(rpc_list["presets"][0]["preset_json"]["platform"]
        .get("verificationStatus")
        .is_some());
    assert!(rpc_list["presets"][0]["preset_json"]["platform"]
        .get("verification_status")
        .is_none());

    assert!(matches!(
        delete_reader_preset(DeleteReaderPresetParams {
            file_path: second.path.clone(),
            preset_id: "preset-a".to_owned(),
            expected_revision: 0,
            expected_preset_revision: 1,
            saved_by: None,
        }),
        Err(CoreError::NotFound(_))
    ));
    assert_eq!(project_revision(&second.path), 0);

    let before_invalid = project_revision(&first.path);
    let mut invalid = reader_config(ReaderVerificationStatus::UserDefined);
    invalid.settings.vertical_padding = 200.0;
    invalid.device.viewport_height = 400.0;
    invalid.device.safe_area_top = 100.0;
    invalid.device.safe_area_bottom = 100.0;
    invalid.device.reader_chrome_height = 100.0;
    assert!(create_reader_preset(CreateReaderPresetParams {
        file_path: first.path.clone(),
        preset_id: Some("invalid-range".to_owned()),
        name: "invalid".to_owned(),
        source_kind: ReaderPresetSourceKind::Custom,
        source_id: None,
        source_version: None,
        verification_status: ReaderVerificationStatus::UserDefined,
        preset_format: READER_PRESET_FORMAT.to_owned(),
        preset_version: READER_PRESET_VERSION,
        preset_json: invalid,
        expected_revision: before_invalid,
        saved_by: None,
    })
    .is_err());
    assert_eq!(project_revision(&first.path), before_invalid);
    let mut invalid_iso = reader_config(ReaderVerificationStatus::Generic);
    invalid_iso.platform.verified_at = Some("2026-02-30T00:00:00.000Z".to_owned());
    assert!(create_reader_preset(CreateReaderPresetParams {
        file_path: first.path.clone(),
        preset_id: Some("invalid-platform".to_owned()),
        name: "invalid".to_owned(),
        source_kind: ReaderPresetSourceKind::BuiltinTemplate,
        source_id: Some("invalid".to_owned()),
        source_version: Some("1".to_owned()),
        verification_status: ReaderVerificationStatus::Generic,
        preset_format: READER_PRESET_FORMAT.to_owned(),
        preset_version: READER_PRESET_VERSION,
        preset_json: invalid_iso,
        expected_revision: before_invalid,
        saved_by: None,
    })
    .is_err());
    assert_eq!(project_revision(&first.path), before_invalid);
    let mut duplicate_control = reader_config(ReaderVerificationStatus::Generic);
    duplicate_control.platform.supported_controls = vec![
        ReaderSupportedControl::Typography,
        ReaderSupportedControl::Typography,
    ];
    assert!(create_reader_preset(CreateReaderPresetParams {
        file_path: first.path.clone(),
        preset_id: Some("invalid-controls".to_owned()),
        name: "invalid".to_owned(),
        source_kind: ReaderPresetSourceKind::BuiltinTemplate,
        source_id: Some("invalid".to_owned()),
        source_version: Some("1".to_owned()),
        verification_status: ReaderVerificationStatus::Generic,
        preset_format: READER_PRESET_FORMAT.to_owned(),
        preset_version: READER_PRESET_VERSION,
        preset_json: duplicate_control,
        expected_revision: before_invalid,
        saved_by: None,
    })
    .is_err());
    assert_eq!(project_revision(&first.path), before_invalid);
    assert!(create_reader_preset(CreateReaderPresetParams {
        file_path: first.path.clone(),
        preset_id: Some("emoji-name".to_owned()),
        name: "🙂".repeat(251),
        source_kind: ReaderPresetSourceKind::Custom,
        source_id: None,
        source_version: None,
        verification_status: ReaderVerificationStatus::UserDefined,
        preset_format: READER_PRESET_FORMAT.to_owned(),
        preset_version: READER_PRESET_VERSION,
        preset_json: reader_config(ReaderVerificationStatus::UserDefined),
        expected_revision: before_invalid,
        saved_by: None,
    })
    .is_err());
    assert_eq!(project_revision(&first.path), before_invalid);
    assert!(create_reader_preset(CreateReaderPresetParams {
        file_path: first.path.clone(),
        preset_id: Some("invalid-status".to_owned()),
        name: "invalid".to_owned(),
        source_kind: ReaderPresetSourceKind::Custom,
        source_id: None,
        source_version: None,
        verification_status: ReaderVerificationStatus::Generic,
        preset_format: READER_PRESET_FORMAT.to_owned(),
        preset_version: READER_PRESET_VERSION,
        preset_json: reader_config(ReaderVerificationStatus::UserDefined),
        expected_revision: before_invalid,
        saved_by: None,
    })
    .is_err());
    assert_eq!(project_revision(&first.path), before_invalid);

    let deleted = delete_reader_preset(DeleteReaderPresetParams {
        file_path: first.path.clone(),
        preset_id: "preset-copy".to_owned(),
        expected_revision: before_invalid,
        expected_preset_revision: 0,
        saved_by: None,
    })
    .unwrap();
    assert_eq!(deleted.revision, deleted.metadata.revision);
}

#[test]
fn reader_preset_color_case_is_canonical_and_a_lowercase_resave_is_a_no_op() {
    let fixture = fixture("reader-color.madi", "reader-color-project");
    let mut uppercase = reader_config(ReaderVerificationStatus::UserDefined);
    uppercase.settings.background_color = "#AABBCC".to_owned();
    uppercase.settings.text_color = "#DDEEFF".to_owned();
    let created = create_reader_preset(CreateReaderPresetParams {
        file_path: fixture.path.clone(),
        preset_id: Some("color-preset".to_owned()),
        name: "Color".to_owned(),
        source_kind: ReaderPresetSourceKind::Custom,
        source_id: None,
        source_version: None,
        verification_status: ReaderVerificationStatus::UserDefined,
        preset_format: READER_PRESET_FORMAT.to_owned(),
        preset_version: READER_PRESET_VERSION,
        preset_json: uppercase,
        expected_revision: 0,
        saved_by: None,
    })
    .unwrap();
    assert_eq!(
        created.preset.preset_json.settings.background_color,
        "#aabbcc"
    );
    assert_eq!(created.preset.preset_json.settings.text_color, "#ddeeff");
    let no_op = update_reader_preset(UpdateReaderPresetParams {
        file_path: fixture.path,
        preset_id: "color-preset".to_owned(),
        name: "Color".to_owned(),
        verification_status: ReaderVerificationStatus::UserDefined,
        preset_json: created.preset.preset_json.clone(),
        expected_revision: created.metadata.revision,
        expected_preset_revision: 0,
        saved_by: None,
    })
    .unwrap();
    assert!(no_op.no_op);
    assert_eq!(no_op.metadata.revision, created.metadata.revision);
    assert_eq!(no_op.preset.content_hash, created.preset.content_hash);
}

#[test]
fn snapshot_v4_diffs_restores_and_rolls_back_reader_presets_atomically() {
    let fixture = fixture("snapshot-v4.madi", "snapshot-project");
    let first = create_custom_preset(&fixture.path, "preset-change", "변경", 0);
    let second = create_custom_preset(
        &fixture.path,
        "preset-delete",
        "삭제",
        first.metadata.revision,
    );
    let canvas = create_canvas(CreateCanvasParams {
        file_path: fixture.path.clone(),
        canvas_id: Some("reader-canvas".to_owned()),
        name: "Reader Canvas".to_owned(),
        description: None,
        document: MadiCanvasDocument::default(),
        expected_revision: Some(second.metadata.revision),
        saved_by: None,
    })
    .unwrap();
    let baseline = create_named_snapshot(CreateNamedSnapshotParams {
        file_path: fixture.path.clone(),
        name: "Reader baseline".to_owned(),
        note: None,
        kind: NamedSnapshotKind::Manual,
        snapshot_id: Some("reader-baseline".to_owned()),
        expected_revision: Some(canvas.metadata.revision),
        saved_by: None,
    })
    .unwrap();
    assert_eq!(baseline.snapshot.payload_version, 4);

    let changed = update_reader_preset(UpdateReaderPresetParams {
        file_path: fixture.path.clone(),
        preset_id: "preset-change".to_owned(),
        name: "변경 후".to_owned(),
        verification_status: ReaderVerificationStatus::UserDefined,
        preset_json: reader_config(ReaderVerificationStatus::UserDefined),
        expected_revision: baseline.metadata.revision,
        expected_preset_revision: 0,
        saved_by: None,
    })
    .unwrap();
    let deleted = delete_reader_preset(DeleteReaderPresetParams {
        file_path: fixture.path.clone(),
        preset_id: "preset-delete".to_owned(),
        expected_revision: changed.metadata.revision,
        expected_preset_revision: 0,
        saved_by: None,
    })
    .unwrap();
    let added = create_custom_preset(
        &fixture.path,
        "preset-added",
        "추가",
        deleted.metadata.revision,
    );
    let diff = diff_named_snapshot(DiffNamedSnapshotParams {
        file_path: fixture.path.clone(),
        snapshot_id: "reader-baseline".to_owned(),
    })
    .unwrap();
    assert_eq!(diff.summary.added_reader_presets, 1);
    assert_eq!(diff.summary.deleted_reader_presets, 1);
    assert_eq!(diff.summary.changed_reader_presets, 1);

    let restored = restore_named_snapshot(RestoreNamedSnapshotParams {
        file_path: fixture.path.clone(),
        snapshot_id: "reader-baseline".to_owned(),
        auto_snapshot_name: Some("복원 전 Reader".to_owned()),
        expected_revision: Some(added.metadata.revision),
        saved_by: None,
    })
    .unwrap();
    let restored_presets = list_reader_presets(ListReaderPresetsParams {
        file_path: fixture.path.clone(),
    })
    .unwrap();
    assert_eq!(
        restored_presets
            .presets
            .iter()
            .map(|preset| preset.id.as_str())
            .collect::<Vec<_>>(),
        vec!["preset-change", "preset-delete"]
    );
    assert_eq!(restored_presets.presets[0].name, "변경");
    let safety = read_snapshot_payload(&fixture.path, &restored.safety_snapshot.id);
    assert_eq!(safety["reader_presets"].as_array().unwrap().len(), 2);
    assert!(safety["reader_presets"]
        .as_array()
        .unwrap()
        .iter()
        .any(|preset| preset["id"] == "preset-added"));

    let baseline_payload = read_snapshot_payload(&fixture.path, "reader-baseline");
    let mut corrupt = baseline_payload;
    corrupt["reader_presets"][0]["content_hash"] = json!("0".repeat(64));
    insert_derived_snapshot(
        &fixture.path,
        "reader-baseline",
        "corrupt-reader-v4",
        4,
        corrupt,
    );
    let revision_before_failure = project_revision(&fixture.path);
    let snapshots_before_failure = list_named_snapshots(ListNamedSnapshotsParams {
        file_path: fixture.path.clone(),
    })
    .unwrap()
    .snapshots
    .len();
    assert!(matches!(
        restore_named_snapshot(RestoreNamedSnapshotParams {
            file_path: fixture.path.clone(),
            snapshot_id: "corrupt-reader-v4".to_owned(),
            auto_snapshot_name: None,
            expected_revision: Some(revision_before_failure),
            saved_by: None,
        }),
        Err(CoreError::SnapshotIntegrity(_))
    ));
    assert_eq!(project_revision(&fixture.path), revision_before_failure);
    assert_eq!(
        list_named_snapshots(ListNamedSnapshotsParams {
            file_path: fixture.path.clone(),
        })
        .unwrap()
        .snapshots
        .len(),
        snapshots_before_failure
    );
    assert_eq!(
        list_reader_presets(ListReaderPresetsParams {
            file_path: fixture.path.clone(),
        })
        .unwrap()
        .presets
        .len(),
        2
    );

    let mut foreign = read_snapshot_payload(&fixture.path, "reader-baseline");
    foreign["reader_presets"][0]["project_id"] = json!("foreign-project");
    insert_derived_snapshot(
        &fixture.path,
        "reader-baseline",
        "foreign-reader-v4",
        4,
        foreign,
    );
    assert!(matches!(
        restore_named_snapshot(RestoreNamedSnapshotParams {
            file_path: fixture.path.clone(),
            snapshot_id: "foreign-reader-v4".to_owned(),
            auto_snapshot_name: None,
            expected_revision: Some(revision_before_failure),
            saved_by: None,
        }),
        Err(CoreError::SnapshotIntegrity(_))
    ));
    assert_eq!(project_revision(&fixture.path), revision_before_failure);

    drop(restored_presets);
    let reopened = list_reader_presets(ListReaderPresetsParams {
        file_path: fixture.path.clone(),
    })
    .unwrap();
    assert_eq!(reopened.presets.len(), 2);
    assert_eq!(reopened.presets[0].revision, 0);
}

#[test]
fn legacy_snapshot_v1_v2_v3_restore_with_reader_presets_empty() {
    let fixture = fixture("snapshot-legacy.madi", "legacy-project");
    let preset = create_custom_preset(&fixture.path, "legacy-preset", "Legacy", 0);
    let canvas = create_canvas(CreateCanvasParams {
        file_path: fixture.path.clone(),
        canvas_id: Some("legacy-canvas".to_owned()),
        name: "Legacy Canvas".to_owned(),
        description: None,
        document: MadiCanvasDocument::default(),
        expected_revision: Some(preset.metadata.revision),
        saved_by: None,
    })
    .unwrap();
    let baseline = create_named_snapshot(CreateNamedSnapshotParams {
        file_path: fixture.path.clone(),
        name: "Legacy source".to_owned(),
        note: None,
        kind: NamedSnapshotKind::Manual,
        snapshot_id: Some("legacy-source-v4".to_owned()),
        expected_revision: Some(canvas.metadata.revision),
        saved_by: None,
    })
    .unwrap();
    let source = read_snapshot_payload(&fixture.path, "legacy-source-v4");
    let mut v3 = source.clone();
    v3["version"] = json!(3);
    v3.as_object_mut().unwrap().remove("reader_presets");
    insert_derived_snapshot(&fixture.path, "legacy-source-v4", "legacy-v3", 3, v3);
    let mut v2 = source.clone();
    v2["version"] = json!(2);
    v2.as_object_mut().unwrap().remove("canvases");
    v2.as_object_mut().unwrap().remove("reader_presets");
    insert_derived_snapshot(&fixture.path, "legacy-source-v4", "legacy-v2", 2, v2);
    let mut v1 = source;
    v1["version"] = json!(1);
    for key in [
        "entities",
        "entity_aliases",
        "tags",
        "entity_tags",
        "relation_types",
        "entity_relations",
        "scene_entity_links",
        "canvases",
        "reader_presets",
    ] {
        v1.as_object_mut().unwrap().remove(key);
    }
    insert_derived_snapshot(&fixture.path, "legacy-source-v4", "legacy-v1", 1, v1);

    let restored_v3 = restore_named_snapshot(RestoreNamedSnapshotParams {
        file_path: fixture.path.clone(),
        snapshot_id: "legacy-v3".to_owned(),
        auto_snapshot_name: None,
        expected_revision: Some(baseline.metadata.revision),
        saved_by: None,
    })
    .unwrap();
    assert!(list_reader_presets(ListReaderPresetsParams {
        file_path: fixture.path.clone(),
    })
    .unwrap()
    .presets
    .is_empty());
    assert_eq!(
        list_canvases(ListCanvasesParams {
            file_path: fixture.path.clone(),
            sort: CanvasSort::NameAsc,
        })
        .unwrap()
        .canvases
        .len(),
        1
    );

    let restored_v4 = restore_named_snapshot(RestoreNamedSnapshotParams {
        file_path: fixture.path.clone(),
        snapshot_id: "legacy-source-v4".to_owned(),
        auto_snapshot_name: None,
        expected_revision: Some(restored_v3.metadata.revision),
        saved_by: None,
    })
    .unwrap();
    assert_eq!(
        list_reader_presets(ListReaderPresetsParams {
            file_path: fixture.path.clone(),
        })
        .unwrap()
        .presets
        .len(),
        1
    );
    let restored_v2 = restore_named_snapshot(RestoreNamedSnapshotParams {
        file_path: fixture.path.clone(),
        snapshot_id: "legacy-v2".to_owned(),
        auto_snapshot_name: None,
        expected_revision: Some(restored_v4.metadata.revision),
        saved_by: None,
    })
    .unwrap();
    assert!(list_reader_presets(ListReaderPresetsParams {
        file_path: fixture.path.clone(),
    })
    .unwrap()
    .presets
    .is_empty());
    assert!(list_canvases(ListCanvasesParams {
        file_path: fixture.path.clone(),
        sort: CanvasSort::UpdatedDesc,
    })
    .unwrap()
    .canvases
    .is_empty());
    let restored_v1 = restore_named_snapshot(RestoreNamedSnapshotParams {
        file_path: fixture.path.clone(),
        snapshot_id: "legacy-v1".to_owned(),
        auto_snapshot_name: None,
        expected_revision: Some(restored_v2.metadata.revision),
        saved_by: None,
    })
    .unwrap();
    assert!(list_reader_presets(ListReaderPresetsParams {
        file_path: fixture.path.clone(),
    })
    .unwrap()
    .presets
    .is_empty());
    assert_eq!(restored_v1.restored_snapshot.payload_version, 1);
}

#[test]
fn publication_rpc_compiles_two_scenes_with_stable_exact_sources_and_read_only_revision() {
    let fixture = fixture("publication.madi", "publication-project");
    let created = open_project(OpenProjectParams {
        file_path: fixture.path.clone(),
    })
    .unwrap();
    let tree = load_project_tree(LoadProjectTreeParams {
        file_path: fixture.path.clone(),
    })
    .unwrap();
    let chapter_id = tree
        .nodes
        .iter()
        .find(|node| node.kind == NodeKind::Chapter)
        .unwrap()
        .id
        .clone();
    let work_id = tree
        .nodes
        .iter()
        .find(|node| node.kind == NodeKind::Work)
        .unwrap()
        .id
        .clone();
    let first_scene = tree
        .nodes
        .iter()
        .find(|node| node.kind == NodeKind::Scene)
        .unwrap()
        .id
        .clone();
    let volume = create_tree_node(CreateTreeNodeParams {
        file_path: fixture.path.clone(),
        parent_id: work_id.clone(),
        kind: NodeKind::Volume,
        title: "첫 권".to_owned(),
        node_id: Some("publication-volume".to_owned()),
        document_id: None,
        editor_engine: None,
        editor_engine_commit: None,
        editor_schema_version: None,
        before_node_id: None,
        after_node_id: None,
        expected_revision: Some(created.metadata.revision),
        saved_by: None,
    })
    .unwrap();
    let moved_chapter = move_tree_node(MoveTreeNodeParams {
        file_path: fixture.path.clone(),
        node_id: chapter_id.clone(),
        new_parent_id: volume.node.id.clone(),
        before_node_id: None,
        after_node_id: None,
        expected_revision: Some(volume.metadata.revision),
        saved_by: None,
    })
    .unwrap();
    let first_saved = save_scene(SaveSceneParams {
        file_path: fixture.path.clone(),
        scene_id: first_scene.clone(),
        editor_engine: "typie".to_owned(),
        editor_engine_commit: PINNED_TYPIE_COMMIT.to_owned(),
        editor_schema_version: 1,
        snapshot_base64: STANDARD.encode(plain_snapshot("중복🙂")),
        plain_text_recovery: "중복🙂".to_owned(),
        expected_revision: Some(moved_chapter.metadata.revision),
        saved_by: None,
    })
    .unwrap();
    let second_scene = create_tree_node(CreateTreeNodeParams {
        file_path: fixture.path.clone(),
        parent_id: chapter_id.clone(),
        kind: NodeKind::Scene,
        title: "둘째 장면".to_owned(),
        node_id: Some("second-scene".to_owned()),
        document_id: Some("second-document".to_owned()),
        editor_engine: Some("typie".to_owned()),
        editor_engine_commit: Some(PINNED_TYPIE_COMMIT.to_owned()),
        editor_schema_version: Some(1),
        before_node_id: None,
        after_node_id: None,
        expected_revision: Some(first_saved.metadata.revision),
        saved_by: None,
    })
    .unwrap();
    let second_saved = save_scene(SaveSceneParams {
        file_path: fixture.path.clone(),
        scene_id: second_scene.node.id.clone(),
        editor_engine: "typie".to_owned(),
        editor_engine_commit: PINNED_TYPIE_COMMIT.to_owned(),
        editor_schema_version: 1,
        snapshot_base64: STANDARD.encode(plain_snapshot("중복🙂")),
        plain_text_recovery: "중복🙂".to_owned(),
        expected_revision: Some(second_scene.metadata.revision),
        saved_by: None,
    })
    .unwrap();
    let params = CompilePublicationParams {
        file_path: fixture.path.clone(),
        scope_node_id: chapter_id.clone(),
        expected_revision: second_saved.metadata.revision,
    };
    let compiled = compile_publication_scope(params.clone()).unwrap();
    assert_eq!(compiled.revision, compiled.metadata.revision);
    assert_eq!(compiled.metadata.revision, second_saved.metadata.revision);
    assert_eq!(
        project_revision(&fixture.path),
        second_saved.metadata.revision
    );
    assert_eq!(compiled.document.stats.scene_count, 2);
    assert_eq!(compiled.document.stats.chapter_count, 1);
    assert_eq!(compiled.document.stats.paragraph_count, 2);
    let expected_scene_order = vec![first_scene.as_str(), second_scene.node.id.as_str()];
    for (scope_node_id, scope_kind, expected_sections) in [
        (work_id.as_str(), PublicationScopeKind::Work, 2usize),
        (
            volume.node.id.as_str(),
            PublicationScopeKind::Volume,
            2usize,
        ),
        (chapter_id.as_str(), PublicationScopeKind::Chapter, 2usize),
        (first_scene.as_str(), PublicationScopeKind::Scene, 1usize),
    ] {
        let scoped = compile_publication_scope(CompilePublicationParams {
            file_path: fixture.path.clone(),
            scope_node_id: scope_node_id.to_owned(),
            expected_revision: second_saved.metadata.revision,
        })
        .unwrap();
        assert_eq!(scoped.document.scope_kind, scope_kind);
        assert_eq!(scoped.document.sections.len(), expected_sections);
        assert_eq!(scoped.document.stats.scene_count, expected_sections as u64);
        assert_eq!(
            scoped
                .document
                .sections
                .iter()
                .map(|section| section.source_node_id.as_str())
                .collect::<Vec<_>>(),
            expected_scene_order[..expected_sections]
        );
        assert!(scoped.document.sections.iter().all(|section| {
            section.blocks.iter().all(|block| {
                let source = match block {
                    PublicationBlock::Heading { source, .. }
                    | PublicationBlock::Paragraph { source, .. }
                    | PublicationBlock::SceneBreak { source, .. }
                    | PublicationBlock::Quote { source, .. }
                    | PublicationBlock::Unsupported { source, .. } => source,
                };
                source.scene_node_id == section.source_node_id
                    && match (source.start, source.end, source.range_verified) {
                        (Some(start), Some(end), true) => start <= end && end <= 3,
                        (None, None, false) => true,
                        _ => false,
                    }
            })
        }));
    }
    let headings: Vec<_> = compiled
        .document
        .sections
        .iter()
        .flat_map(|section| section.blocks.iter())
        .filter_map(|block| match block {
            PublicationBlock::Heading { level, source, .. } => Some((*level, source)),
            _ => None,
        })
        .collect();
    assert_eq!(headings.iter().filter(|(level, _)| *level == 3).count(), 1);
    assert_eq!(headings.iter().filter(|(level, _)| *level == 4).count(), 2);
    let chapter_source = headings.iter().find(|(level, _)| *level == 3).unwrap().1;
    assert_eq!(chapter_source.scene_node_id, first_scene);
    assert!(!chapter_source.document_id.is_empty());
    let body_sources: Vec<_> = compiled
        .document
        .sections
        .iter()
        .flat_map(|section| section.blocks.iter())
        .filter_map(|block| match block {
            PublicationBlock::Paragraph { source, .. } => Some(source),
            _ => None,
        })
        .collect();
    assert_eq!(body_sources.len(), 2);
    assert!(body_sources.iter().all(|source| {
        source.range_verified && source.start == Some(0) && source.end == Some(3)
    }));
    assert_ne!(body_sources[0].block_id, body_sources[1].block_id);

    let stats = get_publication_stats(params.clone()).unwrap();
    assert_eq!(stats.stats, compiled.document.stats);
    assert_eq!(stats.content_hash, compiled.content_hash);
    assert_eq!(stats.revision, compiled.revision);
    let validation = validate_publication(ValidatePublicationParams {
        document: compiled.document.clone(),
    })
    .unwrap();
    assert!(validation.valid);
    assert_eq!(validation.content_hash, compiled.content_hash);
    let mut tampered = compiled.document.clone();
    tampered.stats.without_spaces += 1;
    assert!(
        !validate_publication(ValidatePublicationParams { document: tampered })
            .unwrap()
            .valid
    );

    let rpc = dispatch("compile_publication", serde_json::to_value(params).unwrap()).unwrap();
    assert_eq!(rpc["revision"], rpc["metadata"]["revision"]);
    assert!(rpc.get("content_hash").is_some());
    let source = rpc["document"]["sections"][0]["blocks"]
        .as_array()
        .unwrap()
        .iter()
        .find_map(|block| block.get("source"))
        .unwrap();
    assert!(source.get("sourceNodeId").is_some());
    assert!(source.get("sceneNodeId").is_some());
    assert!(source.get("documentId").is_some());
    assert!(source.get("blockId").is_some());
    assert!(source.get("source_node_id").is_none());

    let connection = Connection::open(&fixture.path).unwrap();
    connection
        .execute(
            "UPDATE documents SET editor_engine_commit = 'wrong' WHERE id = ?1",
            [&second_saved.document.id],
        )
        .unwrap();
    drop(connection);
    assert!(matches!(
        compile_publication_scope(CompilePublicationParams {
            file_path: fixture.path,
            scope_node_id: second_saved.scene.parent_id.unwrap(),
            expected_revision: second_saved.metadata.revision,
        }),
        Err(CoreError::InvalidInput(_))
    ));
}
