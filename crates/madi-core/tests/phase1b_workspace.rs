use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use madi_core::{
    apply_replacement_batch, create_named_snapshot, create_project, create_tree_node,
    delete_named_snapshot, delete_tree_node, diff_named_snapshot, dispatch, get_text_statistics,
    list_descendant_scenes, list_named_snapshots, load_project_tree, load_scene, load_ui_state,
    open_project, rename_named_snapshot, rename_tree_node, restore_named_snapshot, save_scene,
    save_ui_state, search_project, ApplyReplacementBatchParams, CoreError,
    CreateNamedSnapshotParams, CreateProjectParams, CreateTreeNodeParams,
    DeleteNamedSnapshotParams, DeleteTreeNodeParams, DiffNamedSnapshotParams,
    GetTextStatisticsParams, ListDescendantScenesParams, ListNamedSnapshotsParams,
    LoadProjectTreeParams, LoadSceneParams, LoadUiStateParams, NamedSnapshotKind, NodeKind,
    OpenProjectParams, RenameNamedSnapshotParams, RenameTreeNodeParams, ReorderTreeNodeParams,
    RestoreNamedSnapshotParams, SaveSceneParams, SaveUiStateParams, SearchProjectParams,
    SearchTarget, TransformedSceneDocument, APPLICATION_ID, FORMAT_VERSION, SCHEMA_VERSION,
};
use rusqlite::{params, Connection};
use serde_json::json;
use tempfile::tempdir;

const PROJECT_ID: &str = "phase-1b-project";
const EDITOR_COMMIT: &str = "phase-1b-typie-commit";

#[derive(Debug)]
struct Fixture {
    work_id: String,
    default_scene_id: String,
    volume_id: String,
    chapter_id: String,
    scene_a_id: String,
    scene_b_id: String,
    scene_a_document_id: String,
    scene_b_document_id: String,
}

fn create_params(path: &std::path::Path) -> CreateProjectParams {
    CreateProjectParams {
        file_path: path.to_path_buf(),
        title: "한국어 장편".to_owned(),
        created_by: Some("phase-1b-test".to_owned()),
        author_name: Some("테스트 작가".to_owned()),
        project_id: Some(PROJECT_ID.to_owned()),
        document_id: Some("document-default".to_owned()),
        document_title: Some("프롤로그".to_owned()),
        editor_engine: Some("typie".to_owned()),
        editor_engine_commit: Some(EDITOR_COMMIT.to_owned()),
        editor_schema_version: Some(1),
    }
}

fn create_node(
    path: &std::path::Path,
    parent_id: &str,
    node_id: &str,
    kind: NodeKind,
    title: &str,
) -> madi_core::CreateTreeNodeResult {
    create_tree_node(CreateTreeNodeParams {
        file_path: path.to_path_buf(),
        parent_id: parent_id.to_owned(),
        kind,
        title: title.to_owned(),
        node_id: Some(node_id.to_owned()),
        document_id: (kind == NodeKind::Scene).then(|| format!("document-{node_id}")),
        editor_engine: (kind == NodeKind::Scene).then(|| "typie".to_owned()),
        editor_engine_commit: (kind == NodeKind::Scene).then(|| EDITOR_COMMIT.to_owned()),
        editor_schema_version: (kind == NodeKind::Scene).then_some(1),
        before_node_id: None,
        after_node_id: None,
        expected_revision: None,
        saved_by: Some("phase-1b-test".to_owned()),
    })
    .unwrap()
}

fn save_text(path: &std::path::Path, scene_id: &str, text: &str, marker: &[u8]) {
    save_scene(SaveSceneParams {
        file_path: path.to_path_buf(),
        scene_id: scene_id.to_owned(),
        editor_engine: "typie".to_owned(),
        editor_engine_commit: EDITOR_COMMIT.to_owned(),
        editor_schema_version: 1,
        snapshot_base64: BASE64_STANDARD.encode(marker),
        plain_text_recovery: text.to_owned(),
        expected_revision: None,
        saved_by: Some("phase-1b-test".to_owned()),
    })
    .unwrap();
}

fn create_fixture(path: &std::path::Path) -> Fixture {
    let created = create_project(create_params(path)).unwrap();
    save_text(
        path,
        &created.default_scene_node_id,
        "아무 일도 없었다.",
        b"default",
    );
    let volume = create_node(
        path,
        &created.work_node_id,
        "volume-1",
        NodeKind::Volume,
        "1권",
    );
    let chapter = create_node(path, &volume.node.id, "chapter-1", NodeKind::Chapter, "1화");
    let scene_a = create_node(
        path,
        &chapter.node.id,
        "scene-a",
        NodeKind::Scene,
        "첫 장면",
    );
    let scene_b = create_node(
        path,
        &chapter.node.id,
        "scene-b",
        NodeKind::Scene,
        "둘째 장면",
    );
    save_text(
        path,
        &scene_a.node.id,
        "그는 문을 열었다. 문을 다시 닫았다.",
        b"snapshot-a-v1",
    );
    save_ui_state(SaveUiStateParams {
        file_path: path.to_path_buf(),
        key: "future.panel.v2".to_owned(),
        value: json!({"must_survive_restore": true}),
    })
    .unwrap();
    save_text(
        path,
        &scene_b.node.id,
        "방 안에서 문을 바라봤다.",
        b"snapshot-b-v1",
    );
    Fixture {
        work_id: created.work_node_id,
        default_scene_id: created.default_scene_node_id,
        volume_id: volume.node.id,
        chapter_id: chapter.node.id,
        scene_a_document_id: scene_a.node.document_id.clone().unwrap(),
        scene_b_document_id: scene_b.node.document_id.clone().unwrap(),
        scene_a_id: scene_a.node.id,
        scene_b_id: scene_b.node.id,
    }
}

fn current_revision(path: &std::path::Path) -> i64 {
    open_project(OpenProjectParams {
        file_path: path.to_path_buf(),
    })
    .unwrap()
    .metadata
    .revision
}

fn load_text(path: &std::path::Path, scene_id: &str) -> String {
    load_scene(LoadSceneParams {
        file_path: path.to_path_buf(),
        scene_id: scene_id.to_owned(),
    })
    .unwrap()
    .document
    .plain_text_recovery
}

#[test]
fn migrates_v2_without_data_loss_and_builds_exact_search_projection() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("migration-v2.madi");
    let fixture = create_fixture(&path);
    {
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch("PRAGMA foreign_keys = OFF;")
            .unwrap();
        connection
            .execute_batch(
                "DROP TRIGGER search_documents_after_insert;
                 DROP TRIGGER search_documents_after_update;
                 DROP TRIGGER search_documents_after_delete;
                 DROP TABLE search_documents;
                 DROP TABLE named_snapshots;
                 DELETE FROM schema_migrations WHERE version = 3;
                 UPDATE app_meta SET schema_version = 2;
                 PRAGMA user_version = 2;",
            )
            .unwrap();
    }

    let opened = open_project(OpenProjectParams {
        file_path: path.clone(),
    })
    .unwrap();
    assert_eq!(opened.metadata.format_version, FORMAT_VERSION);
    assert_eq!(opened.metadata.schema_version, SCHEMA_VERSION);
    assert_eq!(
        opened.schema_migrations.last().unwrap().version,
        SCHEMA_VERSION
    );
    assert_eq!(
        load_text(&path, &fixture.scene_a_id),
        "그는 문을 열었다. 문을 다시 닫았다."
    );

    let connection = Connection::open(&path).unwrap();
    let projected: String = connection
        .query_row(
            "SELECT plain_text FROM search_documents WHERE document_id = ?1",
            [&fixture.scene_a_document_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(projected, "그는 문을 열었다. 문을 다시 닫았다.");
    let application_id: i64 = connection
        .pragma_query_value(None, "application_id", |row| row.get(0))
        .unwrap();
    assert_eq!(application_id, APPLICATION_ID);
}

#[test]
fn descendant_order_korean_substrings_saved_updates_and_character_counts_are_exact() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("workspace.madi");
    let fixture = create_fixture(&path);

    let all = list_descendant_scenes(ListDescendantScenesParams {
        file_path: path.clone(),
        scope_node_id: fixture.work_id.clone(),
        offset: 0,
        limit: None,
    })
    .unwrap();
    assert_eq!(
        all.scenes
            .iter()
            .map(|record| record.scene.id.as_str())
            .collect::<Vec<_>>(),
        vec![
            fixture.default_scene_id.as_str(),
            fixture.scene_a_id.as_str(),
            fixture.scene_b_id.as_str()
        ]
    );
    let scene_page = list_descendant_scenes(ListDescendantScenesParams {
        file_path: path.clone(),
        scope_node_id: fixture.work_id.clone(),
        offset: 1,
        limit: Some(1),
    })
    .unwrap();
    assert_eq!(scene_page.total_scenes, 3);
    assert_eq!(scene_page.scenes.len(), 1);
    assert_eq!(scene_page.scenes[0].scene.id, fixture.scene_a_id);
    assert_eq!(scene_page.next_offset, Some(2));
    assert!(scene_page.has_more);
    let volume = list_descendant_scenes(ListDescendantScenesParams {
        file_path: path.clone(),
        scope_node_id: fixture.volume_id.clone(),
        offset: 0,
        limit: None,
    })
    .unwrap();
    assert_eq!(volume.scenes.len(), 2);
    assert_eq!(volume.scenes[0].scene.id, fixture.scene_a_id);
    assert_eq!(volume.scenes[1].scene.id, fixture.scene_b_id);

    let search = search_project(SearchProjectParams {
        file_path: path.clone(),
        query: "문을".to_owned(),
        case_sensitive: true,
        target: SearchTarget::Bodies,
        scope_node_id: Some(fixture.work_id.clone()),
        offset: 0,
        limit: None,
    })
    .unwrap();
    assert_eq!(search.total_matches, 3);
    assert_eq!(search.scene_count, 2);
    assert!(search.hits.iter().all(|hit| hit.matched_text == "문을"));
    assert!(search.hits.iter().all(|hit| {
        hit.source_content_hash
            .as_deref()
            .is_some_and(|hash| hash.len() == 64)
    }));
    assert!(search
        .hits
        .iter()
        .all(|hit| hit.end_char - hit.start_char == 2));
    let paged_search = search_project(SearchProjectParams {
        file_path: path.clone(),
        query: "문을".to_owned(),
        case_sensitive: true,
        target: SearchTarget::Bodies,
        scope_node_id: Some(fixture.work_id.clone()),
        offset: 1,
        limit: Some(1),
    })
    .unwrap();
    assert_eq!(paged_search.total_matches, 3);
    assert_eq!(paged_search.hits.len(), 1);
    assert_eq!(paged_search.offset, 1);
    assert_eq!(paged_search.limit, 1);
    assert!(paged_search.has_more);

    let title_search = search_project(SearchProjectParams {
        file_path: path.clone(),
        query: "장면".to_owned(),
        case_sensitive: false,
        target: SearchTarget::Titles,
        scope_node_id: Some(fixture.volume_id.clone()),
        offset: 0,
        limit: None,
    })
    .unwrap();
    assert_eq!(title_search.total_matches, 2);

    save_text(
        &path,
        &fixture.scene_b_id,
        "자동저장 직후 새한국어검색어가 보인다.",
        b"snapshot-b-v2",
    );
    let refreshed = search_project(SearchProjectParams {
        file_path: path.clone(),
        query: "한국어검색".to_owned(),
        case_sensitive: true,
        target: SearchTarget::Bodies,
        scope_node_id: None,
        offset: 0,
        limit: None,
    })
    .unwrap();
    assert_eq!(refreshed.total_matches, 1);
    assert_eq!(
        refreshed.hits[0].scene_id.as_deref(),
        Some(fixture.scene_b_id.as_str())
    );

    let statistics = get_text_statistics(GetTextStatisticsParams {
        file_path: path.clone(),
        scope_node_id: Some(fixture.volume_id),
    })
    .unwrap();
    let expected = [
        "그는 문을 열었다. 문을 다시 닫았다.",
        "자동저장 직후 새한국어검색어가 보인다.",
    ]
    .join("");
    assert_eq!(statistics.scene_count, 2);
    assert_eq!(statistics.with_spaces, expected.chars().count() as u64);
    assert_eq!(
        statistics.without_spaces,
        expected
            .chars()
            .filter(|character| !character.is_whitespace())
            .count() as u64
    );

    save_text(
        &path,
        &fixture.scene_a_id,
        &"가".repeat(20_000),
        b"bounded-search",
    );
    let bounded = search_project(SearchProjectParams {
        file_path: path,
        query: "가".to_owned(),
        case_sensitive: true,
        target: SearchTarget::Bodies,
        scope_node_id: Some(fixture.scene_a_id),
        offset: 0,
        limit: Some(50),
    })
    .unwrap();
    assert_eq!(bounded.total_matches, 20_000);
    assert_eq!(bounded.hits.len(), 50);
    assert!(bounded.has_more);
}

#[test]
fn named_snapshot_hash_crud_diff_restore_and_reopen_preserve_the_logical_project() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("snapshots.madi");
    let fixture = create_fixture(&path);
    let original_text = load_text(&path, &fixture.scene_a_id);
    let created = create_named_snapshot(CreateNamedSnapshotParams {
        file_path: path.clone(),
        name: "초고 완료".to_owned(),
        note: Some("복원 기준점".to_owned()),
        kind: NamedSnapshotKind::Manual,
        snapshot_id: Some("snapshot-draft".to_owned()),
        expected_revision: None,
        saved_by: Some("phase-1b-test".to_owned()),
    })
    .unwrap();
    assert_eq!(created.snapshot.content_hash.len(), 64);
    assert_eq!(created.snapshot.payload_format, "MADI_LOGICAL_JSON");
    assert_eq!(created.snapshot.payload_version, 4);

    let second = create_named_snapshot(CreateNamedSnapshotParams {
        file_path: path.clone(),
        name: "두 번째".to_owned(),
        note: None,
        kind: NamedSnapshotKind::Manual,
        snapshot_id: Some("snapshot-second".to_owned()),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    {
        let connection = Connection::open(&path).unwrap();
        let payloads = [created.snapshot.id.as_str(), second.snapshot.id.as_str()]
            .iter()
            .map(|id| {
                connection
                    .query_row(
                        "SELECT payload_blob FROM named_snapshots WHERE id = ?1",
                        [id],
                        |row| row.get::<_, Vec<u8>>(0),
                    )
                    .unwrap()
            })
            .collect::<Vec<_>>();
        for payload in payloads {
            let text = String::from_utf8(payload).unwrap();
            assert!(!text.contains("named_snapshots"));
            assert!(!text.contains("snapshot-draft"));
            assert!(!text.contains("snapshot-second"));
            assert!(!text.contains("future.panel.v2"));
            assert!(text.contains("그는 문을 열었다"));
        }
    }

    let renamed = rename_named_snapshot(RenameNamedSnapshotParams {
        file_path: path.clone(),
        snapshot_id: second.snapshot.id.clone(),
        name: "1차 퇴고".to_owned(),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    assert_eq!(renamed.snapshot.name, "1차 퇴고");

    rename_tree_node(RenameTreeNodeParams {
        file_path: path.clone(),
        node_id: fixture.scene_a_id.clone(),
        title: "수정된 첫 장면".to_owned(),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    let added_scene = create_node(
        &path,
        &fixture.chapter_id,
        "scene-added-after-snapshot",
        NodeKind::Scene,
        "새 장면",
    );
    madi_core::reorder_tree_node(ReorderTreeNodeParams {
        file_path: path.clone(),
        node_id: fixture.scene_b_id.clone(),
        before_node_id: Some(fixture.scene_a_id.clone()),
        after_node_id: None,
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    delete_tree_node(DeleteTreeNodeParams {
        file_path: path.clone(),
        node_id: fixture.default_scene_id.clone(),
        recursive: false,
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    save_text(
        &path,
        &fixture.scene_a_id,
        "완전히 수정된 원고 본문이다.",
        b"snapshot-a-mutated",
    );
    let diff = diff_named_snapshot(DiffNamedSnapshotParams {
        file_path: path.clone(),
        snapshot_id: created.snapshot.id.clone(),
    })
    .unwrap();
    assert_eq!(diff.summary.renamed_nodes, 1);
    assert_eq!(diff.summary.changed_scene_bodies, 1);
    assert_eq!(diff.summary.added.scenes, 1);
    assert_eq!(diff.summary.deleted.scenes, 1);
    assert_eq!(diff.summary.reordered_nodes, 2);
    assert_ne!(diff.summary.character_count_delta, 0);

    let revision_before_restore = current_revision(&path);
    let restored = restore_named_snapshot(RestoreNamedSnapshotParams {
        file_path: path.clone(),
        snapshot_id: created.snapshot.id.clone(),
        auto_snapshot_name: Some("복원 직전 보존".to_owned()),
        expected_revision: Some(revision_before_restore),
        saved_by: Some("phase-1b-test".to_owned()),
    })
    .unwrap();
    assert_eq!(restored.metadata.revision, revision_before_restore + 1);
    assert_eq!(
        restored.safety_snapshot.kind,
        NamedSnapshotKind::AutoBeforeRestore
    );
    assert_eq!(restored.safety_snapshot.name, "복원 직전 보존");
    assert_eq!(load_text(&path, &fixture.scene_a_id), original_text);
    assert_eq!(
        load_ui_state(LoadUiStateParams {
            file_path: path.clone(),
            key: "future.panel.v2".to_owned(),
        })
        .unwrap()
        .state
        .unwrap()
        .value,
        json!({"must_survive_restore": true})
    );
    assert_eq!(
        load_text(&path, &fixture.scene_b_id),
        "방 안에서 문을 바라봤다."
    );
    assert!(matches!(
        load_scene(LoadSceneParams {
            file_path: path.clone(),
            scene_id: added_scene.node.id,
        }),
        Err(CoreError::NodeNotFound { .. })
    ));
    let restored_volume = list_descendant_scenes(ListDescendantScenesParams {
        file_path: path.clone(),
        scope_node_id: fixture.volume_id.clone(),
        offset: 0,
        limit: None,
    })
    .unwrap();
    assert_eq!(
        restored_volume
            .scenes
            .iter()
            .map(|record| record.scene.id.as_str())
            .collect::<Vec<_>>(),
        vec![fixture.scene_a_id.as_str(), fixture.scene_b_id.as_str()]
    );
    let restored_tree = load_project_tree(LoadProjectTreeParams {
        file_path: path.clone(),
    })
    .unwrap();
    assert_eq!(
        restored_tree
            .nodes
            .iter()
            .find(|node| node.id == fixture.scene_a_id)
            .unwrap()
            .title,
        "첫 장면"
    );

    let reopened = list_named_snapshots(ListNamedSnapshotsParams {
        file_path: path.clone(),
    })
    .unwrap();
    assert_eq!(reopened.snapshots.len(), 3);
    assert!(reopened
        .snapshots
        .iter()
        .any(|snapshot| snapshot.id == restored.safety_snapshot.id));

    delete_named_snapshot(DeleteNamedSnapshotParams {
        file_path: path.clone(),
        snapshot_id: second.snapshot.id.clone(),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    let after_delete = list_named_snapshots(ListNamedSnapshotsParams { file_path: path }).unwrap();
    assert!(!after_delete
        .snapshots
        .iter()
        .any(|snapshot| snapshot.id == second.snapshot.id));
}

#[test]
fn hash_failure_and_restore_validation_roll_back_the_safety_snapshot() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("snapshot-integrity.madi");
    let fixture = create_fixture(&path);
    let snapshot = create_named_snapshot(CreateNamedSnapshotParams {
        file_path: path.clone(),
        name: "검증 대상".to_owned(),
        note: None,
        kind: NamedSnapshotKind::Manual,
        snapshot_id: Some("snapshot-corrupt".to_owned()),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    let count_before = list_named_snapshots(ListNamedSnapshotsParams {
        file_path: path.clone(),
    })
    .unwrap()
    .snapshots
    .len();
    let revision_before = current_revision(&path);
    {
        let connection = Connection::open(&path).unwrap();
        connection
            .execute(
                "UPDATE named_snapshots SET content_hash = ?1 WHERE id = ?2",
                params!["0".repeat(64), snapshot.snapshot.id],
            )
            .unwrap();
    }
    let error = restore_named_snapshot(RestoreNamedSnapshotParams {
        file_path: path.clone(),
        snapshot_id: snapshot.snapshot.id,
        auto_snapshot_name: None,
        expected_revision: Some(revision_before),
        saved_by: None,
    })
    .unwrap_err();
    assert!(matches!(error, CoreError::SnapshotIntegrity(_)));
    assert_eq!(current_revision(&path), revision_before);
    assert_eq!(
        list_named_snapshots(ListNamedSnapshotsParams {
            file_path: path.clone(),
        })
        .unwrap()
        .snapshots
        .len(),
        count_before
    );
    assert_eq!(
        load_text(&path, &fixture.scene_a_id),
        "그는 문을 열었다. 문을 다시 닫았다."
    );
}

fn transformed(
    scene_id: &str,
    document_id: &str,
    text: &str,
    snapshot: &[u8],
    occurrence_count: u64,
) -> TransformedSceneDocument {
    TransformedSceneDocument {
        scene_id: scene_id.to_owned(),
        document_id: document_id.to_owned(),
        editor_engine: "typie".to_owned(),
        editor_engine_commit: EDITOR_COMMIT.to_owned(),
        editor_schema_version: 1,
        snapshot_base64: BASE64_STANDARD.encode(snapshot),
        plain_text_recovery: text.to_owned(),
        occurrence_count,
        source_content_hash: None,
    }
}

#[test]
fn replacement_batch_creates_safety_snapshot_updates_search_and_rolls_back_atomically() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("replacement.madi");
    let fixture = create_fixture(&path);
    let original_a = load_text(&path, &fixture.scene_a_id);
    let original_b = load_text(&path, &fixture.scene_b_id);
    let before_revision = current_revision(&path);
    let previews = list_descendant_scenes(ListDescendantScenesParams {
        file_path: path.clone(),
        scope_node_id: fixture.volume_id.clone(),
        offset: 0,
        limit: None,
    })
    .unwrap();
    let hash_a = previews.scenes[0].document.source_content_hash.clone();
    let hash_b = previews.scenes[1].document.source_content_hash.clone();
    let mut transformed_a = transformed(
        &fixture.scene_a_id,
        &fixture.scene_a_document_id,
        "그는 창을 열었다. 창을 다시 닫았다.",
        b"snapshot-a-replaced",
        2,
    );
    transformed_a.source_content_hash = Some(hash_a);
    let mut transformed_b = transformed(
        &fixture.scene_b_id,
        &fixture.scene_b_document_id,
        "방 안에서 창을 바라봤다.",
        b"snapshot-b-replaced",
        1,
    );
    transformed_b.source_content_hash = Some(hash_b);
    let mut invalid_relation = transformed_a.clone();
    invalid_relation.plain_text_recovery = "그는 창을 열었다. 길을 다시 닫았다.".to_owned();
    invalid_relation.snapshot_base64 = BASE64_STANDARD.encode(b"invalid-relation");
    let relation_error = apply_replacement_batch(ApplyReplacementBatchParams {
        file_path: path.clone(),
        expected_revision: before_revision,
        query: "문을".to_owned(),
        replacement: "창을".to_owned(),
        case_sensitive: true,
        transformed_scenes: vec![invalid_relation],
        saved_by: None,
        auto_snapshot_name: None,
    })
    .unwrap_err();
    assert!(matches!(relation_error, CoreError::InvalidInput(_)));
    assert_eq!(current_revision(&path), before_revision);
    let mut stale_source = transformed_a.clone();
    stale_source.source_content_hash = Some("0".repeat(64));
    let stale_error = apply_replacement_batch(ApplyReplacementBatchParams {
        file_path: path.clone(),
        expected_revision: before_revision,
        query: "문을".to_owned(),
        replacement: "창을".to_owned(),
        case_sensitive: true,
        transformed_scenes: vec![stale_source],
        saved_by: None,
        auto_snapshot_name: None,
    })
    .unwrap_err();
    assert!(matches!(
        stale_error,
        CoreError::SourceContentConflict { .. }
    ));
    assert_eq!(current_revision(&path), before_revision);
    assert!(list_named_snapshots(ListNamedSnapshotsParams {
        file_path: path.clone(),
    })
    .unwrap()
    .snapshots
    .is_empty());
    let applied = apply_replacement_batch(ApplyReplacementBatchParams {
        file_path: path.clone(),
        expected_revision: before_revision,
        query: "문을".to_owned(),
        replacement: "창을".to_owned(),
        case_sensitive: true,
        transformed_scenes: vec![transformed_a, transformed_b],
        saved_by: Some("phase-1b-test".to_owned()),
        auto_snapshot_name: Some("치환 전 안전 저장".to_owned()),
    })
    .unwrap();
    assert_eq!(applied.metadata.revision, before_revision + 1);
    assert_eq!(applied.changed_scenes, 2);
    assert_eq!(applied.changed_occurrences, 3);
    assert_eq!(
        applied.safety_snapshot.kind,
        NamedSnapshotKind::AutoBeforeReplace
    );
    let search = search_project(SearchProjectParams {
        file_path: path.clone(),
        query: "창을".to_owned(),
        case_sensitive: true,
        target: SearchTarget::Bodies,
        scope_node_id: None,
        offset: 0,
        limit: None,
    })
    .unwrap();
    assert_eq!(search.total_matches, 3);

    restore_named_snapshot(RestoreNamedSnapshotParams {
        file_path: path.clone(),
        snapshot_id: applied.safety_snapshot.id,
        auto_snapshot_name: Some("치환 복원 전".to_owned()),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    assert_eq!(load_text(&path, &fixture.scene_a_id), original_a);
    assert_eq!(load_text(&path, &fixture.scene_b_id), original_b);

    let snapshot_count_before_failure = list_named_snapshots(ListNamedSnapshotsParams {
        file_path: path.clone(),
    })
    .unwrap()
    .snapshots
    .len();
    {
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(&format!(
                "CREATE TRIGGER force_second_document_failure
                 BEFORE UPDATE OF plain_text_recovery ON documents
                 WHEN OLD.id = '{}'
                 BEGIN
                    SELECT RAISE(ABORT, 'forced replacement rollback');
                 END;",
                fixture.scene_b_document_id
            ))
            .unwrap();
    }
    let revision_before_failure = current_revision(&path);
    let failure = apply_replacement_batch(ApplyReplacementBatchParams {
        file_path: path.clone(),
        expected_revision: revision_before_failure,
        query: "문을".to_owned(),
        replacement: "길을".to_owned(),
        case_sensitive: true,
        transformed_scenes: vec![
            transformed(
                &fixture.scene_a_id,
                &fixture.scene_a_document_id,
                "그는 길을 열었다. 길을 다시 닫았다.",
                b"snapshot-a-failed",
                2,
            ),
            transformed(
                &fixture.scene_b_id,
                &fixture.scene_b_document_id,
                "방 안에서 길을 바라봤다.",
                b"snapshot-b-failed",
                1,
            ),
        ],
        saved_by: None,
        auto_snapshot_name: None,
    })
    .unwrap_err();
    assert!(matches!(failure, CoreError::Sqlite(_)));
    assert_eq!(current_revision(&path), revision_before_failure);
    assert_eq!(load_text(&path, &fixture.scene_a_id), original_a);
    assert_eq!(load_text(&path, &fixture.scene_b_id), original_b);
    assert_eq!(
        list_named_snapshots(ListNamedSnapshotsParams { file_path: path })
            .unwrap()
            .snapshots
            .len(),
        snapshot_count_before_failure
    );
}

#[test]
fn phase_1b_json_rpc_methods_use_the_documented_snake_case_contract() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("rpc.madi");
    let fixture = create_fixture(&path);
    let scenes = dispatch(
        "list_descendant_scenes",
        json!({
            "file_path": path,
            "scope_node_id": fixture.volume_id
        }),
    )
    .unwrap();
    assert_eq!(scenes["scenes"].as_array().unwrap().len(), 2);
    assert_eq!(scenes["metadata"]["schema_version"], SCHEMA_VERSION);
    assert_eq!(scenes["total_scenes"], 2);
    assert!(scenes["scenes"][0]["document"]["snapshot_base64"].is_null());
    assert_eq!(
        scenes["scenes"][0]["document"]["source_content_hash"]
            .as_str()
            .unwrap()
            .len(),
        64
    );

    let search = dispatch(
        "search_project",
        json!({
            "file_path": path,
            "query": "문을",
            "case_sensitive": true,
            "target": "BODIES",
            "scope_node_id": fixture.work_id
        }),
    )
    .unwrap();
    assert_eq!(search["total_matches"], 3);
    assert_eq!(search["hits"][0]["field"], "BODY");
    assert!(search["hits"][0]["start_char"].is_number());

    let snapshot = dispatch(
        "create_named_snapshot",
        json!({
            "file_path": path,
            "name": "RPC 스냅샷",
            "kind": "MANUAL",
            "expected_revision": current_revision(&path)
        }),
    )
    .unwrap();
    assert_eq!(snapshot["snapshot"]["payload_format"], "MADI_LOGICAL_JSON");
    assert_eq!(snapshot["snapshot"]["kind"], "MANUAL");
}
