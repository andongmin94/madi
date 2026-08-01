use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use madi_core::{
    create_project, create_tree_node, delete_tree_node, load_project_tree, load_scene,
    load_ui_state, move_tree_node, open_project, rename_tree_node, reorder_tree_node,
    save_scene, save_ui_state, CoreError, CreateProjectParams, CreateTreeNodeParams,
    DeleteTreeNodeParams, LoadProjectTreeParams, LoadSceneParams, LoadUiStateParams,
    MoveTreeNodeParams, NodeKind, OpenProjectParams, RenameTreeNodeParams,
    ReorderTreeNodeParams, SaveSceneParams, SaveUiStateParams, FORMAT_VERSION,
    SCHEMA_VERSION,
};
use rusqlite::Connection;
use serde_json::json;
use tempfile::tempdir;

fn create_params(path: &std::path::Path) -> CreateProjectParams {
    CreateProjectParams {
        file_path: path.to_path_buf(),
        title: "드래곤을 죽이다".to_owned(),
        created_by: Some("phase-1a-test".to_owned()),
        author_name: Some("안동민".to_owned()),
        project_id: Some("project-phase-1a".to_owned()),
        document_id: Some("document-default".to_owned()),
        document_title: Some("1화".to_owned()),
        editor_engine: Some("typie".to_owned()),
        editor_engine_commit: Some("test-commit".to_owned()),
        editor_schema_version: Some(1),
    }
}

fn create_node(
    path: &std::path::Path,
    parent_id: &str,
    node_id: &str,
    kind: NodeKind,
    title: &str,
    expected_revision: i64,
) -> Result<madi_core::CreateTreeNodeResult, CoreError> {
    create_tree_node(CreateTreeNodeParams {
        file_path: path.to_path_buf(),
        parent_id: parent_id.to_owned(),
        kind,
        title: title.to_owned(),
        node_id: Some(node_id.to_owned()),
        document_id: (kind == NodeKind::Scene).then(|| format!("document-{node_id}")),
        editor_engine: None,
        editor_engine_commit: None,
        editor_schema_version: None,
        before_node_id: None,
        after_node_id: None,
        expected_revision: Some(expected_revision),
        saved_by: Some("phase-1a-test".to_owned()),
    })
}

#[test]
fn creates_v2_project_with_exactly_one_work_and_default_scene_link() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("phase-1a.madi");
    let created = create_project(create_params(&path)).unwrap();
    let tree = load_project_tree(LoadProjectTreeParams {
        file_path: path.clone(),
    })
    .unwrap();

    assert_eq!(tree.metadata.format_version, FORMAT_VERSION);
    assert_eq!(tree.metadata.schema_version, SCHEMA_VERSION);
    assert_eq!(tree.project.author_name.as_deref(), Some("안동민"));
    assert_eq!(tree.project.work_node_id, created.work_node_id);
    assert_eq!(tree.nodes.len(), 3);
    let work = tree
        .nodes
        .iter()
        .find(|node| node.kind == NodeKind::Work)
        .unwrap();
    assert_eq!(work.parent_id, None);
    let chapter = tree
        .nodes
        .iter()
        .find(|node| node.id == created.default_chapter_node_id)
        .unwrap();
    assert_eq!(chapter.parent_id.as_deref(), Some(work.id.as_str()));
    let scene = tree
        .nodes
        .iter()
        .find(|node| node.id == created.default_scene_node_id)
        .unwrap();
    assert_eq!(scene.kind, NodeKind::Scene);
    assert_eq!(scene.parent_id.as_deref(), Some(chapter.id.as_str()));
    assert_eq!(scene.document_id.as_deref(), Some("document-default"));

    let connection = Connection::open(&path).unwrap();
    let user_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(user_version, SCHEMA_VERSION);
    let duplicate_work = connection.execute(
        "INSERT INTO tree_nodes (
            id, project_id, parent_id, kind, title, order_key,
            document_id, created_at, updated_at
         ) VALUES ('duplicate-work', 'project-phase-1a', NULL, 'WORK',
                   'duplicate', 2048, NULL, 'now', 'now')",
        [],
    );
    assert!(duplicate_work.is_err());
}

#[test]
fn hierarchy_allows_only_work_volume_chapter_scene_edges() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("hierarchy.madi");
    let created = create_project(create_params(&path)).unwrap();

    let volume = create_node(
        &path,
        &created.work_node_id,
        "volume-1",
        NodeKind::Volume,
        "1권",
        0,
    )
    .unwrap();
    let chapter = create_node(
        &path,
        &volume.node.id,
        "chapter-1",
        NodeKind::Chapter,
        "2화",
        1,
    )
    .unwrap();
    let scene = create_node(
        &path,
        &chapter.node.id,
        "scene-1",
        NodeKind::Scene,
        "첫 장면",
        2,
    )
    .unwrap();
    assert_eq!(scene.metadata.revision, 3);

    let direct_work_scene = create_node(
        &path,
        &created.work_node_id,
        "scene-invalid-work",
        NodeKind::Scene,
        "invalid",
        3,
    )
    .unwrap_err();
    assert!(matches!(
        direct_work_scene,
        CoreError::InvalidHierarchy { .. }
    ));
    let direct_volume_scene = create_node(
        &path,
        &volume.node.id,
        "scene-invalid-volume",
        NodeKind::Scene,
        "invalid",
        3,
    )
    .unwrap_err();
    assert!(matches!(
        direct_volume_scene,
        CoreError::InvalidHierarchy { .. }
    ));
    let nested_volume = create_node(
        &path,
        &volume.node.id,
        "volume-invalid",
        NodeKind::Volume,
        "invalid",
        3,
    )
    .unwrap_err();
    assert!(matches!(nested_volume, CoreError::InvalidHierarchy { .. }));
}

#[test]
fn rename_reorder_move_and_explicit_recursive_delete_are_transactional() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("mutations.madi");
    let created = create_project(create_params(&path)).unwrap();
    let chapter_a = create_node(
        &path,
        &created.work_node_id,
        "chapter-a",
        NodeKind::Chapter,
        "A",
        0,
    )
    .unwrap();
    let chapter_b = create_node(
        &path,
        &created.work_node_id,
        "chapter-b",
        NodeKind::Chapter,
        "B",
        1,
    )
    .unwrap();
    let chapter_mid = create_tree_node(CreateTreeNodeParams {
        file_path: path.clone(),
        parent_id: created.work_node_id.clone(),
        kind: NodeKind::Chapter,
        title: "중간".to_owned(),
        node_id: Some("chapter-mid".to_owned()),
        document_id: None,
        editor_engine: None,
        editor_engine_commit: None,
        editor_schema_version: None,
        before_node_id: Some(chapter_b.node.id.clone()),
        after_node_id: None,
        expected_revision: Some(2),
        saved_by: None,
    })
    .unwrap();
    assert!(chapter_a.node.order_key < chapter_mid.node.order_key);
    assert!(chapter_mid.node.order_key < chapter_b.node.order_key);

    let reordered = reorder_tree_node(ReorderTreeNodeParams {
        file_path: path.clone(),
        node_id: chapter_b.node.id.clone(),
        before_node_id: Some(chapter_a.node.id.clone()),
        after_node_id: None,
        expected_revision: Some(3),
        saved_by: None,
    })
    .unwrap();
    let chapter_a_after = reordered
        .tree
        .nodes
        .iter()
        .find(|node| node.id == chapter_a.node.id)
        .unwrap();
    assert!(reordered.node.order_key < chapter_a_after.order_key);

    let renamed_scene = rename_tree_node(RenameTreeNodeParams {
        file_path: path.clone(),
        node_id: created.default_scene_node_id.clone(),
        title: "새 장면 제목".to_owned(),
        expected_revision: Some(4),
        saved_by: None,
    })
    .unwrap();
    assert_eq!(renamed_scene.metadata.revision, 5);
    let loaded_scene = load_scene(LoadSceneParams {
        file_path: path.clone(),
        scene_id: created.default_scene_node_id.clone(),
    })
    .unwrap();
    assert_eq!(loaded_scene.scene.title, "새 장면 제목");
    assert_eq!(loaded_scene.document.title, "새 장면 제목");

    let renamed_work = rename_tree_node(RenameTreeNodeParams {
        file_path: path.clone(),
        node_id: created.work_node_id.clone(),
        title: "새 작품 제목".to_owned(),
        expected_revision: Some(5),
        saved_by: None,
    })
    .unwrap();
    assert_eq!(renamed_work.tree.metadata.title, "새 작품 제목");
    assert_eq!(renamed_work.tree.project.title, "새 작품 제목");

    let volume = create_node(
        &path,
        &created.work_node_id,
        "volume-move",
        NodeKind::Volume,
        "이동 대상 권",
        6,
    )
    .unwrap();
    let moved = move_tree_node(MoveTreeNodeParams {
        file_path: path.clone(),
        node_id: chapter_a.node.id.clone(),
        new_parent_id: volume.node.id.clone(),
        before_node_id: None,
        after_node_id: None,
        expected_revision: Some(7),
        saved_by: None,
    })
    .unwrap();
    assert_eq!(moved.node.parent_id.as_deref(), Some(volume.node.id.as_str()));

    let invalid_scene_move = move_tree_node(MoveTreeNodeParams {
        file_path: path.clone(),
        node_id: created.default_scene_node_id.clone(),
        new_parent_id: volume.node.id.clone(),
        before_node_id: None,
        after_node_id: None,
        expected_revision: Some(8),
        saved_by: None,
    })
    .unwrap_err();
    assert!(matches!(
        invalid_scene_move,
        CoreError::InvalidHierarchy { .. }
    ));

    let child_scene = create_node(
        &path,
        &chapter_a.node.id,
        "scene-delete",
        NodeKind::Scene,
        "삭제할 장면",
        8,
    )
    .unwrap();
    let non_recursive = delete_tree_node(DeleteTreeNodeParams {
        file_path: path.clone(),
        node_id: chapter_a.node.id.clone(),
        recursive: false,
        expected_revision: Some(9),
        saved_by: None,
    })
    .unwrap_err();
    assert!(matches!(
        non_recursive,
        CoreError::RecursiveDeleteRequired { .. }
    ));
    let deleted = delete_tree_node(DeleteTreeNodeParams {
        file_path: path.clone(),
        node_id: chapter_a.node.id,
        recursive: true,
        expected_revision: Some(9),
        saved_by: None,
    })
    .unwrap();
    assert!(deleted.deleted_node_ids.contains(&child_scene.node.id));
    assert!(deleted
        .deleted_document_ids
        .contains(child_scene.node.document_id.as_ref().unwrap()));
    assert_eq!(deleted.metadata.revision, 10);
}

#[test]
fn scene_save_load_and_reopen_round_trip_preserves_binary_and_korean_text() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("scene-roundtrip.madi");
    let created = create_project(create_params(&path)).unwrap();
    let snapshot = b"phase-1a\0snapshot\xff";
    let manuscript = "한글 원고.\n\n* * *\n\n다음 장면.";

    let saved = save_scene(SaveSceneParams {
        file_path: path.clone(),
        scene_id: created.default_scene_node_id.clone(),
        editor_engine: "typie".to_owned(),
        editor_engine_commit: "test-commit".to_owned(),
        editor_schema_version: 1,
        snapshot_base64: BASE64_STANDARD.encode(snapshot),
        plain_text_recovery: manuscript.to_owned(),
        expected_revision: Some(0),
        saved_by: Some("scene-test".to_owned()),
    })
    .unwrap();
    assert_eq!(saved.metadata.revision, 1);
    assert!(saved.backup_file_path.is_file());

    open_project(OpenProjectParams {
        file_path: path.clone(),
    })
    .unwrap();
    let loaded = load_scene(LoadSceneParams {
        file_path: path,
        scene_id: created.default_scene_node_id,
    })
    .unwrap();
    assert_eq!(loaded.project_revision, 1);
    assert_eq!(
        BASE64_STANDARD.decode(loaded.document.snapshot_base64).unwrap(),
        snapshot
    );
    assert_eq!(loaded.document.plain_text_recovery, manuscript);
}

#[test]
fn ui_state_round_trip_does_not_change_manuscript_revision() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("ui-state.madi");
    create_project(create_params(&path)).unwrap();
    let value = json!({
        "expanded_node_ids": ["chapter-a", "scene-a"],
        "selected_node_id": "scene-a",
        "binder_width": 320
    });
    let saved = save_ui_state(SaveUiStateParams {
        file_path: path.clone(),
        key: "workspace.v1".to_owned(),
        value: value.clone(),
    })
    .unwrap();
    assert_eq!(saved.metadata.revision, 0);
    assert_eq!(saved.state.value, value);

    let loaded = load_ui_state(LoadUiStateParams {
        file_path: path.clone(),
        key: "workspace.v1".to_owned(),
    })
    .unwrap();
    assert_eq!(loaded.metadata.revision, 0);
    assert_eq!(loaded.state.unwrap().value, value);

    let missing = load_ui_state(LoadUiStateParams {
        file_path: path,
        key: "missing".to_owned(),
    })
    .unwrap();
    assert!(missing.state.is_none());
}
