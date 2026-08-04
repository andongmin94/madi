use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
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

fn new_fixture(name: &str, project_id: &str, author_name: Option<&str>) -> Fixture {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join(name);
    create_project(CreateProjectParams {
        file_path: path.clone(),
        title: "한국어 작품 & <테스트>".to_owned(),
        created_by: Some("phase1g-test".to_owned()),
        author_name: author_name.map(ToOwned::to_owned),
        project_id: Some(project_id.to_owned()),
        document_id: Some(format!("{project_id}-document")),
        document_title: Some("첫 화".to_owned()),
        editor_engine: Some("typie".to_owned()),
        editor_engine_commit: Some("phase1g-test-commit".to_owned()),
        editor_schema_version: Some(1),
    })
    .unwrap();
    Fixture {
        _directory: directory,
        path,
        project_id: project_id.to_owned(),
    }
}

fn default_preset() -> EpubExportPresetConfig {
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

fn update_metadata(
    path: &Path,
    current: &PublicationMetadataRecord,
    expected_revision: i64,
    title: &str,
) -> PublicationMetadataMutationResult {
    update_publication_metadata(UpdatePublicationMetadataParams {
        file_path: path.to_owned(),
        publication_title: title.to_owned(),
        creator_name: current.creator_name.clone(),
        language: current.language.clone(),
        identifier: current.identifier.clone(),
        publisher: current.publisher.clone(),
        description: current.description.clone(),
        rights: current.rights.clone(),
        subjects: current.subjects.clone(),
        cover_asset_id: current.cover_asset_id.clone(),
        expected_revision,
        saved_by: Some("phase1g-test".to_owned()),
    })
    .unwrap()
}

fn png_chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut chunk = Vec::new();
    chunk.extend_from_slice(&(data.len() as u32).to_be_bytes());
    chunk.extend_from_slice(kind);
    chunk.extend_from_slice(data);
    let mut crc_input = Vec::from(kind.as_slice());
    crc_input.extend_from_slice(data);
    chunk.extend_from_slice(&crc32(&crc_input).to_be_bytes());
    chunk
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffff_u32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            let mask = 0_u32.wrapping_sub(crc & 1);
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}

fn adler32(bytes: &[u8]) -> u32 {
    let mut a = 1_u32;
    let mut b = 0_u32;
    for byte in bytes {
        a = (a + u32::from(*byte)) % 65_521;
        b = (b + a) % 65_521;
    }
    (b << 16) | a
}

fn png(width: u32, height: u32) -> Vec<u8> {
    assert_eq!((width, height), (1, 1));
    let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
    bytes.extend(png_chunk(b"IHDR", &ihdr));
    let raw = [0_u8, 0x22, 0x44, 0x66, 0xff];
    let mut zlib = vec![0x78, 0x01, 0x01];
    zlib.extend_from_slice(&(raw.len() as u16).to_le_bytes());
    zlib.extend_from_slice(&(!(raw.len() as u16)).to_le_bytes());
    zlib.extend_from_slice(&raw);
    zlib.extend_from_slice(&adler32(&raw).to_be_bytes());
    bytes.extend(png_chunk(b"IDAT", &zlib));
    bytes.extend(png_chunk(b"IEND", &[]));
    bytes
}

fn indexed_png() -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&1_u32.to_be_bytes());
    ihdr.extend_from_slice(&1_u32.to_be_bytes());
    ihdr.extend_from_slice(&[8, 3, 0, 0, 0]);
    bytes.extend(png_chunk(b"IHDR", &ihdr));
    bytes.extend(png_chunk(b"PLTE", &[0x22, 0x44, 0x66]));
    let raw = [0_u8, 0_u8];
    let mut zlib = vec![0x78, 0x01, 0x01];
    zlib.extend_from_slice(&(raw.len() as u16).to_le_bytes());
    zlib.extend_from_slice(&(!(raw.len() as u16)).to_le_bytes());
    zlib.extend_from_slice(&raw);
    zlib.extend_from_slice(&adler32(&raw).to_be_bytes());
    bytes.extend(png_chunk(b"IDAT", &zlib));
    bytes.extend(png_chunk(b"IEND", &[]));
    bytes
}

fn jpeg(width: u16, height: u16) -> Vec<u8> {
    let mut bytes = Vec::new();
    let pixels = vec![0x80_u8; usize::from(width) * usize::from(height) * 3];
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 80)
        .encode(
            &pixels,
            u32::from(width),
            u32::from(height),
            image::ExtendedColorType::Rgb8,
        )
        .unwrap();
    bytes
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
    payload: Value,
) {
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
            params![snapshot_id, snapshot_id, version, blob, hash, source_id],
        )
        .unwrap();
}

#[test]
fn schema_seven_defaults_are_stable_and_schema_six_migrates_without_data_loss() {
    let no_author = new_fixture("no-author.madi", "no-author-project", None);
    let first = get_publication_export_state(GetPublicationExportStateParams {
        file_path: no_author.path.clone(),
    })
    .unwrap();
    assert_eq!(first.metadata.schema_version, 7);
    assert_eq!(first.metadata.format_version, 1);
    assert_eq!(first.publication_metadata.creator_name, "");
    assert_eq!(first.publication_metadata.language, "ko-KR");
    assert_eq!(
        first.publication_metadata.identifier,
        stable_publication_identifier(&no_author.project_id)
    );
    let rpc = dispatch(
        "get_publication_export_state",
        json!({"file_path": no_author.path}),
    )
    .unwrap();
    assert_eq!(rpc["revision"], rpc["metadata"]["revision"]);
    assert_eq!(rpc["publication_metadata"]["creator_name"], "");
    assert!(rpc["cover_asset"].is_null());

    let migrated = new_fixture("migration.madi", "migration-project", Some("작가"));
    let tree_before = load_project_tree(LoadProjectTreeParams {
        file_path: migrated.path.clone(),
    })
    .unwrap();
    let connection = Connection::open(&migrated.path).unwrap();
    connection
        .execute_batch(
            "DROP TABLE publication_metadata;
             DROP TABLE publication_assets;
             DROP TABLE export_presets;
             DELETE FROM schema_migrations WHERE version = 7;
             UPDATE app_meta SET schema_version = 6;
             PRAGMA user_version = 6;",
        )
        .unwrap();
    drop(connection);
    let opened = open_project(OpenProjectParams {
        file_path: migrated.path.clone(),
    })
    .unwrap();
    assert_eq!(opened.metadata.schema_version, 7);
    assert_eq!(opened.metadata.revision, 0);
    assert_eq!(opened.documents.len(), 1);
    let tree_after = load_project_tree(LoadProjectTreeParams {
        file_path: migrated.path.clone(),
    })
    .unwrap();
    assert_eq!(tree_after.nodes, tree_before.nodes);
    let state = get_publication_export_state(GetPublicationExportStateParams {
        file_path: migrated.path,
    })
    .unwrap();
    assert_eq!(state.publication_metadata.creator_name, "작가");
    assert_eq!(state.metadata.revision, 0);
}

#[test]
fn metadata_cover_and_export_preset_crud_are_revisioned_no_op_and_project_owned() {
    let fixture = new_fixture("crud.madi", "crud-project", Some("초기 작가"));
    let state = get_publication_export_state(GetPublicationExportStateParams {
        file_path: fixture.path.clone(),
    })
    .unwrap();
    let same = update_metadata(
        &fixture.path,
        &state.publication_metadata,
        state.revision,
        &state.publication_metadata.publication_title,
    );
    assert!(same.no_op);
    assert_eq!(same.revision, state.revision);

    let updated = update_publication_metadata(UpdatePublicationMetadataParams {
        file_path: fixture.path.clone(),
        publication_title: "출판 제목 & <안전>".to_owned(),
        creator_name: "작가 이름".to_owned(),
        language: "ko-KR".to_owned(),
        identifier: state.publication_metadata.identifier.clone(),
        publisher: Some("출판사".to_owned()),
        description: Some("설명".to_owned()),
        rights: Some("All rights reserved".to_owned()),
        subjects: vec!["판타지".to_owned(), "한국 소설".to_owned()],
        cover_asset_id: None,
        expected_revision: state.revision,
        saved_by: None,
    })
    .unwrap();
    assert!(!updated.no_op);
    assert_eq!(updated.revision, state.revision + 1);

    let cover_bytes = png(1, 1);
    let cover = set_publication_cover(SetPublicationCoverParams {
        file_path: fixture.path.clone(),
        asset_id: Some("cover-one".to_owned()),
        media_type: "image/png".to_owned(),
        original_name: "표지.png".to_owned(),
        bytes_base64: BASE64_STANDARD.encode(&cover_bytes),
        expected_revision: updated.revision,
        saved_by: None,
    })
    .unwrap();
    assert_eq!((cover.asset.width, cover.asset.height), (1, 1));
    assert_eq!(cover.asset.byte_length, cover_bytes.len() as u64);
    assert_eq!(
        cover.asset.sha256,
        format!("{:x}", Sha256::digest(&cover_bytes))
    );
    assert_eq!(
        cover.publication_metadata.cover_asset_id.as_deref(),
        Some("cover-one")
    );
    let cover_no_op = set_publication_cover(SetPublicationCoverParams {
        file_path: fixture.path.clone(),
        asset_id: Some("ignored-new-cover-id".to_owned()),
        media_type: "image/png".to_owned(),
        original_name: "표지.png".to_owned(),
        bytes_base64: BASE64_STANDARD.encode(&cover_bytes),
        expected_revision: cover.revision,
        saved_by: None,
    })
    .unwrap();
    assert!(cover_no_op.no_op);
    assert_eq!(cover_no_op.revision, cover.revision);
    assert_eq!(cover_no_op.asset.id, "cover-one");
    let metadata_with_implicit_cover =
        update_publication_metadata(UpdatePublicationMetadataParams {
            file_path: fixture.path.clone(),
            publication_title: "표지 유지 제목".to_owned(),
            creator_name: cover.publication_metadata.creator_name.clone(),
            language: cover.publication_metadata.language.clone(),
            identifier: cover.publication_metadata.identifier.clone(),
            publisher: cover.publication_metadata.publisher.clone(),
            description: cover.publication_metadata.description.clone(),
            rights: cover.publication_metadata.rights.clone(),
            subjects: cover.publication_metadata.subjects.clone(),
            cover_asset_id: None,
            expected_revision: cover_no_op.revision,
            saved_by: None,
        })
        .unwrap();
    assert_eq!(
        metadata_with_implicit_cover
            .publication_metadata
            .cover_asset_id
            .as_deref(),
        Some("cover-one")
    );

    let created = create_export_preset(CreateExportPresetParams {
        file_path: fixture.path.clone(),
        preset_id: Some("epub-main".to_owned()),
        name: "기본 EPUB".to_owned(),
        preset_json: default_preset(),
        expected_revision: metadata_with_implicit_cover.revision,
        saved_by: None,
    })
    .unwrap();
    assert_eq!(created.preset.revision, 0);
    assert_eq!(created.revision, created.metadata.revision);
    let update_no_op = update_export_preset(UpdateExportPresetParams {
        file_path: fixture.path.clone(),
        preset_id: created.preset.id.clone(),
        name: created.preset.name.clone(),
        preset_json: created.preset.preset_json.clone(),
        expected_revision: created.revision,
        expected_preset_revision: 0,
        saved_by: None,
    })
    .unwrap();
    assert!(update_no_op.no_op);
    assert_eq!(update_no_op.revision, created.revision);
    let mut changed_config = created.preset.preset_json.clone();
    changed_config.target_profile = EpubTargetProfile::Epub33Compatibility;
    changed_config.split_mode = EpubSplitMode::Scene;
    let changed = update_export_preset(UpdateExportPresetParams {
        file_path: fixture.path.clone(),
        preset_id: created.preset.id.clone(),
        name: "EPUB 3.3".to_owned(),
        preset_json: changed_config,
        expected_revision: created.revision,
        expected_preset_revision: 0,
        saved_by: None,
    })
    .unwrap();
    assert_eq!(changed.preset.revision, 1);
    let duplicate = duplicate_export_preset(DuplicateExportPresetParams {
        file_path: fixture.path.clone(),
        source_preset_id: changed.preset.id.clone(),
        preset_id: Some("epub-copy".to_owned()),
        name: None,
        expected_revision: changed.revision,
        saved_by: None,
    })
    .unwrap();
    assert_eq!(duplicate.preset.revision, 0);
    let listed = list_export_presets(ListExportPresetsParams {
        file_path: fixture.path.clone(),
    })
    .unwrap();
    assert_eq!(listed.presets.len(), 2);
    assert_eq!(listed.revision, listed.metadata.revision);
    let deleted = delete_export_preset(DeleteExportPresetParams {
        file_path: fixture.path.clone(),
        preset_id: duplicate.preset.id,
        expected_revision: duplicate.revision,
        expected_preset_revision: 0,
        saved_by: None,
    })
    .unwrap();
    assert_eq!(deleted.revision, duplicate.revision + 1);

    let removed_cover = remove_publication_cover(RemovePublicationCoverParams {
        file_path: fixture.path.clone(),
        expected_revision: deleted.revision,
        saved_by: None,
    })
    .unwrap();
    assert_eq!(removed_cover.deleted_asset_id.as_deref(), Some("cover-one"));
    assert!(removed_cover.publication_metadata.cover_asset_id.is_none());
    assert_eq!(removed_cover.revision, deleted.revision + 1);
    let remove_no_op = remove_publication_cover(RemovePublicationCoverParams {
        file_path: fixture.path.clone(),
        expected_revision: removed_cover.revision,
        saved_by: None,
    })
    .unwrap();
    assert!(remove_no_op.no_op);
    assert_eq!(remove_no_op.revision, removed_cover.revision);

    let foreign = new_fixture("foreign.madi", "foreign-project", Some("다른 작가"));
    let foreign_state = get_publication_export_state(GetPublicationExportStateParams {
        file_path: foreign.path.clone(),
    })
    .unwrap();
    let cross_project = update_publication_metadata(UpdatePublicationMetadataParams {
        file_path: foreign.path,
        publication_title: foreign_state.publication_metadata.publication_title.clone(),
        creator_name: foreign_state.publication_metadata.creator_name.clone(),
        language: foreign_state.publication_metadata.language.clone(),
        identifier: foreign_state.publication_metadata.identifier.clone(),
        publisher: None,
        description: None,
        rights: None,
        subjects: Vec::new(),
        cover_asset_id: Some("cover-one".to_owned()),
        expected_revision: foreign_state.revision,
        saved_by: None,
    });
    assert!(matches!(cross_project, Err(CoreError::NotFound(_))));
}

#[test]
fn cover_validation_enforces_magic_dimensions_size_crc_and_exact_terminal_bytes() {
    let valid_png = png(1, 1);
    assert_eq!(
        validate_cover_bytes("image/png", &valid_png).unwrap(),
        (1, 1)
    );
    assert_eq!(
        validate_cover_bytes("image/png", &indexed_png()).unwrap(),
        (1, 1)
    );
    let valid_jpeg = jpeg(320, 480);
    assert_eq!(
        validate_cover_bytes("image/jpeg", &valid_jpeg).unwrap(),
        (320, 480)
    );
    assert!(validate_cover_bytes("image/jpeg", &valid_png).is_err());
    assert!(validate_cover_bytes("image/png", &valid_jpeg).is_err());

    let mut bad_crc = valid_png.clone();
    bad_crc[29] ^= 1;
    assert!(validate_cover_bytes("image/png", &bad_crc).is_err());
    let mut bad_zlib = valid_png.clone();
    let idat_kind = bad_zlib
        .windows(4)
        .position(|window| window == b"IDAT")
        .unwrap();
    let idat_length =
        u32::from_be_bytes(bad_zlib[idat_kind - 4..idat_kind].try_into().unwrap()) as usize;
    bad_zlib[idat_kind + 4] = 0;
    let idat_crc = crc32(&bad_zlib[idat_kind..idat_kind + 4 + idat_length]);
    bad_zlib[idat_kind + 4 + idat_length..idat_kind + 8 + idat_length]
        .copy_from_slice(&idat_crc.to_be_bytes());
    assert!(validate_cover_bytes("image/png", &bad_zlib).is_err());
    let mut png_polyglot = valid_png.clone();
    png_polyglot.extend_from_slice(b"MZ executable tail");
    assert!(validate_cover_bytes("image/png", &png_polyglot).is_err());
    let mut jpeg_polyglot = valid_jpeg.clone();
    jpeg_polyglot.extend_from_slice(b"PK\x03\x04 zip tail");
    assert!(validate_cover_bytes("image/jpeg", &jpeg_polyglot).is_err());
    let mut malformed_frame = valid_jpeg.clone();
    let sof = malformed_frame
        .windows(2)
        .position(|window| matches!(window, [0xff, 0xc0] | [0xff, 0xc2]))
        .unwrap();
    malformed_frame[sof + 9] = 4;
    assert!(validate_cover_bytes("image/jpeg", &malformed_frame).is_err());
    let oversized_dimension = jpeg(10_001, 1);
    assert!(validate_cover_bytes("image/jpeg", &oversized_dimension).is_err());
    assert!(validate_cover_bytes("image/png", &vec![0_u8; MAX_COVER_BYTES + 1]).is_err());

    let fixture = new_fixture("jpeg.madi", "jpeg-project", Some("작가"));
    let cover = set_publication_cover(SetPublicationCoverParams {
        file_path: fixture.path,
        asset_id: None,
        media_type: "image/jpeg".to_owned(),
        original_name: "cover.jpeg".to_owned(),
        bytes_base64: BASE64_STANDARD.encode(valid_jpeg),
        expected_revision: 0,
        saved_by: None,
    })
    .unwrap();
    assert_eq!((cover.asset.width, cover.asset.height), (320, 480));
}

#[test]
fn publication_tables_reject_cross_project_cover_links_and_queries_fail_closed() {
    let fixture = new_fixture("ownership.madi", "ownership-project", Some("작가"));
    let bytes = png(1, 1);
    let hash = format!("{:x}", Sha256::digest(&bytes));
    let connection = Connection::open(&fixture.path).unwrap();
    connection
        .pragma_update(None, "foreign_keys", false)
        .unwrap();
    connection
        .execute(
            "INSERT INTO publication_assets (
                id, project_id, kind, media_type, original_name, sha256, bytes,
                width, height, created_at, updated_at
             ) VALUES ('foreign-cover', 'foreign-project', 'COVER', 'image/png',
                       'foreign.png', ?1, ?2, 1, 1, 'now', 'now')",
            params![hash, bytes],
        )
        .unwrap();
    assert!(connection
        .execute(
            "UPDATE publication_metadata SET cover_asset_id = 'foreign-cover'
             WHERE project_id = 'ownership-project'",
            [],
        )
        .is_err());
    drop(connection);
    assert!(matches!(
        get_publication_export_state(GetPublicationExportStateParams {
            file_path: fixture.path,
        }),
        Err(CoreError::Integrity(_))
    ));
}

#[test]
fn snapshot_v5_restores_export_state_diffs_rolls_back_and_decodes_v4() {
    let fixture = new_fixture("snapshot.madi", "snapshot-export-project", Some("원 작가"));
    let initial = get_publication_export_state(GetPublicationExportStateParams {
        file_path: fixture.path.clone(),
    })
    .unwrap();
    let metadata = update_publication_metadata(UpdatePublicationMetadataParams {
        file_path: fixture.path.clone(),
        publication_title: "기준 출판 제목".to_owned(),
        creator_name: "기준 작가".to_owned(),
        language: "ko-KR".to_owned(),
        identifier: initial.publication_metadata.identifier,
        publisher: Some("기준 출판사".to_owned()),
        description: None,
        rights: None,
        subjects: vec!["기준".to_owned()],
        cover_asset_id: None,
        expected_revision: initial.revision,
        saved_by: None,
    })
    .unwrap();
    let cover = set_publication_cover(SetPublicationCoverParams {
        file_path: fixture.path.clone(),
        asset_id: Some("snapshot-cover".to_owned()),
        media_type: "image/png".to_owned(),
        original_name: "baseline.png".to_owned(),
        bytes_base64: BASE64_STANDARD.encode(png(1, 1)),
        expected_revision: metadata.revision,
        saved_by: None,
    })
    .unwrap();
    let preset = create_export_preset(CreateExportPresetParams {
        file_path: fixture.path.clone(),
        preset_id: Some("snapshot-preset".to_owned()),
        name: "기준 preset".to_owned(),
        preset_json: default_preset(),
        expected_revision: cover.revision,
        saved_by: None,
    })
    .unwrap();
    let baseline = create_named_snapshot(CreateNamedSnapshotParams {
        file_path: fixture.path.clone(),
        name: "Phase 1G baseline".to_owned(),
        note: None,
        kind: NamedSnapshotKind::Manual,
        snapshot_id: Some("export-v5".to_owned()),
        expected_revision: Some(preset.revision),
        saved_by: None,
    })
    .unwrap();
    assert_eq!(baseline.snapshot.payload_version, 5);
    let payload = snapshot_payload(&fixture.path, "export-v5");
    assert_eq!(payload["publication_assets"].as_array().unwrap().len(), 1);
    assert_eq!(payload["export_presets"].as_array().unwrap().len(), 1);

    let changed_metadata = update_metadata(
        &fixture.path,
        &baseline_state(&fixture.path).publication_metadata,
        baseline.metadata.revision,
        "변경된 출판 제목",
    );
    let changed_cover = set_publication_cover(SetPublicationCoverParams {
        file_path: fixture.path.clone(),
        asset_id: Some("snapshot-cover".to_owned()),
        media_type: "image/jpeg".to_owned(),
        original_name: "changed.jpg".to_owned(),
        bytes_base64: BASE64_STANDARD.encode(jpeg(640, 960)),
        expected_revision: changed_metadata.revision,
        saved_by: None,
    })
    .unwrap();
    let mut changed_config = preset.preset.preset_json.clone();
    changed_config.split_mode = EpubSplitMode::Scene;
    let changed_preset = update_export_preset(UpdateExportPresetParams {
        file_path: fixture.path.clone(),
        preset_id: preset.preset.id.clone(),
        name: "변경 preset".to_owned(),
        preset_json: changed_config,
        expected_revision: changed_cover.revision,
        expected_preset_revision: 0,
        saved_by: None,
    })
    .unwrap();
    let added = create_export_preset(CreateExportPresetParams {
        file_path: fixture.path.clone(),
        preset_id: Some("added-preset".to_owned()),
        name: "추가 preset".to_owned(),
        preset_json: default_preset(),
        expected_revision: changed_preset.revision,
        saved_by: None,
    })
    .unwrap();
    let diff = diff_named_snapshot(DiffNamedSnapshotParams {
        file_path: fixture.path.clone(),
        snapshot_id: "export-v5".to_owned(),
    })
    .unwrap();
    assert!(diff.summary.publication_metadata_changed);
    assert!(diff.summary.cover_changed);
    assert_eq!(diff.summary.added_export_presets, 1);
    assert_eq!(diff.summary.deleted_export_presets, 0);
    assert_eq!(diff.summary.changed_export_presets, 1);

    let restored = restore_named_snapshot(RestoreNamedSnapshotParams {
        file_path: fixture.path.clone(),
        snapshot_id: "export-v5".to_owned(),
        auto_snapshot_name: Some("복원 전 export".to_owned()),
        expected_revision: Some(added.revision),
        saved_by: None,
    })
    .unwrap();
    assert_eq!(restored.safety_snapshot.payload_version, 5);
    let safety_payload = snapshot_payload(&fixture.path, &restored.safety_snapshot.id);
    assert_eq!(
        safety_payload["publication_metadata"]["publication_title"],
        "변경된 출판 제목"
    );
    assert_eq!(
        safety_payload["publication_assets"][0]["media_type"],
        "image/jpeg"
    );
    assert_eq!(
        safety_payload["export_presets"].as_array().unwrap().len(),
        2
    );
    let restored_state = baseline_state(&fixture.path);
    assert_eq!(
        restored_state.publication_metadata.publication_title,
        "기준 출판 제목"
    );
    assert_eq!(restored_state.cover_asset.unwrap().media_type, "image/png");
    assert_eq!(restored_state.export_presets.len(), 1);
    assert_eq!(restored_state.export_presets[0].revision, 0);

    let mut corrupt = snapshot_payload(&fixture.path, "export-v5");
    corrupt["publication_assets"][0]["sha256"] = json!("0".repeat(64));
    insert_derived_snapshot(&fixture.path, "export-v5", "corrupt-export-v5", 5, corrupt);
    let revision_before_failure = restored_state.revision;
    let snapshots_before_failure = list_named_snapshots(ListNamedSnapshotsParams {
        file_path: fixture.path.clone(),
    })
    .unwrap()
    .snapshots
    .len();
    assert!(matches!(
        restore_named_snapshot(RestoreNamedSnapshotParams {
            file_path: fixture.path.clone(),
            snapshot_id: "corrupt-export-v5".to_owned(),
            auto_snapshot_name: None,
            expected_revision: Some(revision_before_failure),
            saved_by: None,
        }),
        Err(CoreError::SnapshotIntegrity(_))
    ));
    assert_eq!(
        baseline_state(&fixture.path).revision,
        revision_before_failure
    );
    assert_eq!(
        list_named_snapshots(ListNamedSnapshotsParams {
            file_path: fixture.path.clone(),
        })
        .unwrap()
        .snapshots
        .len(),
        snapshots_before_failure
    );

    let mut forged_v4 = snapshot_payload(&fixture.path, "export-v5");
    forged_v4["version"] = json!(4);
    insert_derived_snapshot(
        &fixture.path,
        "export-v5",
        "forged-v4-with-v5-fields",
        4,
        forged_v4,
    );
    assert!(matches!(
        restore_named_snapshot(RestoreNamedSnapshotParams {
            file_path: fixture.path.clone(),
            snapshot_id: "forged-v4-with-v5-fields".to_owned(),
            auto_snapshot_name: None,
            expected_revision: Some(revision_before_failure),
            saved_by: None,
        }),
        Err(CoreError::SnapshotIntegrity(_))
    ));
    assert_eq!(
        baseline_state(&fixture.path).revision,
        revision_before_failure
    );

    let mut v4 = snapshot_payload(&fixture.path, "export-v5");
    v4["version"] = json!(4);
    for key in [
        "publication_metadata",
        "publication_assets",
        "export_presets",
    ] {
        v4.as_object_mut().unwrap().remove(key);
    }
    insert_derived_snapshot(&fixture.path, "export-v5", "legacy-v4", 4, v4);
    let restored_v4 = restore_named_snapshot(RestoreNamedSnapshotParams {
        file_path: fixture.path.clone(),
        snapshot_id: "legacy-v4".to_owned(),
        auto_snapshot_name: None,
        expected_revision: Some(revision_before_failure),
        saved_by: None,
    })
    .unwrap();
    assert_eq!(restored_v4.restored_snapshot.payload_version, 4);
    let legacy_state = baseline_state(&fixture.path);
    assert_eq!(
        legacy_state.publication_metadata.publication_title,
        "한국어 작품 & <테스트>"
    );
    assert_eq!(legacy_state.publication_metadata.creator_name, "원 작가");
    assert!(legacy_state.cover_asset.is_none());
    assert!(legacy_state.export_presets.is_empty());
    drop(legacy_state);
    let reopened = baseline_state(&fixture.path);
    assert!(reopened.cover_asset.is_none());
    assert!(reopened.export_presets.is_empty());
}

fn baseline_state(path: &Path) -> PublicationExportStateResult {
    get_publication_export_state(GetPublicationExportStateParams {
        file_path: path.to_owned(),
    })
    .unwrap()
}

#[test]
fn strict_rpc_rejects_arbitrary_preset_fields_and_reports_exact_profile_tokens() {
    let fixture = new_fixture("rpc.madi", "rpc-project", Some("작가"));
    let created = dispatch(
        "create_export_preset",
        json!({
            "file_path": fixture.path,
            "preset_id": "rpc-preset",
            "name": "RPC preset",
            "preset_json": {
                "formatVersion": 1,
                "targetProfile": "EPUB_3_4_DRAFT_2026_08",
                "splitMode": "CHAPTER",
                "tocDepth": 3,
                "includeChapterTitles": true,
                "includeSceneTitles": false,
                "sceneBreakStyleToken": "ORNAMENT",
                "bodyStyleToken": "REFLOWABLE_PROSE",
                "includeCover": false,
                "stylesheetToken": "MADI_MINIMAL"
            },
            "expected_revision": 0
        }),
    )
    .unwrap();
    assert_eq!(created["revision"], created["metadata"]["revision"]);
    assert_eq!(created["preset"]["revision"], 0);
    assert_eq!(
        created["preset"]["preset_json"]["targetProfile"],
        "EPUB_3_4_DRAFT_2026_08"
    );
    let rejected = dispatch(
        "create_export_preset",
        json!({
            "file_path": fixture.path,
            "name": "Unsafe CSS",
            "preset_json": {
                "formatVersion": 1,
                "targetProfile": "EPUB_3_3_COMPATIBILITY",
                "splitMode": "SCENE",
                "tocDepth": 2,
                "includeChapterTitles": true,
                "includeSceneTitles": true,
                "sceneBreakStyleToken": "RULE",
                "bodyStyleToken": "SPACED_PROSE",
                "includeCover": false,
                "stylesheetToken": "MADI_CLASSIC",
                "arbitraryCss": "script { display:block }"
            },
            "expected_revision": 1
        }),
    );
    assert!(matches!(rejected, Err(CoreError::InvalidInput(_))));
    let invalid_toc = EpubExportPresetConfig {
        toc_depth: 0,
        ..default_preset()
    };
    assert!(validate_export_preset(&invalid_toc).is_err());
}
