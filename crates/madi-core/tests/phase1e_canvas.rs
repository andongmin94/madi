use std::collections::BTreeMap;
use std::path::PathBuf;

use madi_core::{
    canonical_canvas_document, create_canvas, create_named_snapshot, create_project, delete_canvas,
    diff_named_snapshot, dispatch, duplicate_canvas, list_canvases, list_named_snapshots,
    load_canvas, open_project, restore_named_snapshot, save_canvas, update_canvas, CanvasSort,
    CoreError, CreateCanvasParams, CreateNamedSnapshotParams, CreateProjectParams,
    DeleteCanvasParams, DiffNamedSnapshotParams, DuplicateCanvasParams, JsonCanvasEdge,
    JsonCanvasEnd, JsonCanvasNode, JsonCanvasNodeType, ListCanvasesParams,
    ListNamedSnapshotsParams, LoadCanvasParams, MadiCanvasDocument, MadiCanvasNodeExtension,
    MadiCanvasNodeKind, NamedSnapshotKind, OpenProjectParams, RestoreNamedSnapshotParams,
    SaveCanvasParams, UpdateCanvasParams, FORMAT_VERSION, SCHEMA_VERSION,
};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tempfile::{tempdir, TempDir};

struct Fixture {
    _directory: TempDir,
    path: PathBuf,
}

fn fixture(name: &str) -> Fixture {
    let directory = tempdir().unwrap();
    let path = directory.path().join(name);
    create_project(CreateProjectParams {
        file_path: path.clone(),
        title: "Canvas 작품".to_owned(),
        created_by: Some("phase1e-test".to_owned()),
        author_name: None,
        project_id: Some("canvas-project".to_owned()),
        document_id: Some("opening-document".to_owned()),
        document_title: Some("첫 장면".to_owned()),
        editor_engine: Some("typie".to_owned()),
        editor_engine_commit: Some("phase1e-test".to_owned()),
        editor_schema_version: Some(1),
    })
    .unwrap();
    Fixture {
        _directory: directory,
        path,
    }
}

fn text_node(id: &str, text: &str, x: f64) -> JsonCanvasNode {
    JsonCanvasNode {
        id: id.to_owned(),
        node_type: JsonCanvasNodeType::Text,
        x,
        y: 20.0,
        width: 320.0,
        height: 180.0,
        text: Some(text.to_owned()),
        label: None,
        color: None,
        background: None,
        background_style: None,
        madi: Some(MadiCanvasNodeExtension {
            node_kind: Some(MadiCanvasNodeKind::Text),
            ..MadiCanvasNodeExtension::default()
        }),
        extensions: BTreeMap::new(),
    }
}

fn reference_node(
    id: &str,
    text: &str,
    kind: MadiCanvasNodeKind,
    reference_id: &str,
) -> JsonCanvasNode {
    let (entity_id, scene_node_id) = match kind {
        MadiCanvasNodeKind::Text | MadiCanvasNodeKind::Group => (None, None),
        MadiCanvasNodeKind::EntityReference => (Some(reference_id.to_owned()), None),
        MadiCanvasNodeKind::SceneReference => (None, Some(reference_id.to_owned())),
    };
    JsonCanvasNode {
        madi: Some(MadiCanvasNodeExtension {
            node_kind: Some(kind),
            entity_id,
            scene_node_id,
            parent_group_id: None,
            original_label: Some(text.to_owned()),
            extensions: BTreeMap::new(),
        }),
        ..text_node(id, text, 400.0)
    }
}

fn group_node(id: &str) -> JsonCanvasNode {
    JsonCanvasNode {
        id: id.to_owned(),
        node_type: JsonCanvasNodeType::Group,
        x: 0.0,
        y: 0.0,
        width: 900.0,
        height: 500.0,
        text: None,
        label: Some("1부".to_owned()),
        color: Some("1".to_owned()),
        background: None,
        background_style: None,
        madi: Some(MadiCanvasNodeExtension {
            node_kind: Some(MadiCanvasNodeKind::Group),
            ..MadiCanvasNodeExtension::default()
        }),
        extensions: BTreeMap::new(),
    }
}

fn edge(id: &str, from: &str, to: &str) -> JsonCanvasEdge {
    JsonCanvasEdge {
        id: id.to_owned(),
        from_node: from.to_owned(),
        to_node: to.to_owned(),
        from_side: None,
        to_side: None,
        from_end: Some(JsonCanvasEnd::None),
        to_end: Some(JsonCanvasEnd::Arrow),
        color: None,
        label: Some("다음".to_owned()),
        madi: None,
        extensions: BTreeMap::new(),
    }
}

fn sample_document() -> MadiCanvasDocument {
    let mut text = text_node("text-1", "1부의 핵심 갈등", 100.0);
    text.madi = Some(MadiCanvasNodeExtension {
        node_kind: Some(MadiCanvasNodeKind::Text),
        parent_group_id: Some("group-1".to_owned()),
        ..MadiCanvasNodeExtension::default()
    });
    MadiCanvasDocument {
        nodes: vec![
            group_node("group-1"),
            text,
            reference_node(
                "entity-1",
                "레이아",
                MadiCanvasNodeKind::EntityReference,
                "entity-leia",
            ),
            reference_node(
                "scene-1",
                "17화 장면 2",
                MadiCanvasNodeKind::SceneReference,
                "scene-seventeen-two",
            ),
        ],
        edges: vec![edge("edge-1", "text-1", "entity-1")],
        extensions: BTreeMap::from([("madiVersion".to_owned(), json!(1))]),
    }
}

#[test]
fn schema_v5_keeps_format_v1_and_enforces_canvas_table_constraints() {
    let fixture = fixture("schema-v5.madi");
    let opened = open_project(OpenProjectParams {
        file_path: fixture.path.clone(),
    })
    .unwrap();
    assert_eq!(FORMAT_VERSION, 1);
    assert_eq!(SCHEMA_VERSION, 5);
    assert_eq!(opened.metadata.format_version, 1);
    assert_eq!(opened.metadata.schema_version, 5);
    assert_eq!(opened.schema_migrations.last().unwrap().version, 5);

    let connection = Connection::open(&fixture.path).unwrap();
    let project_id = opened.metadata.project_id;
    let invalid = connection.execute(
        "INSERT INTO canvases (
            id, project_id, name, description, document_format,
            document_version, document_json, content_hash, revision,
            created_at, updated_at
         ) VALUES ('bad', ?1, 'bad', NULL, 'REACT_FLOW', '1.0',
                   '{\"nodes\":[],\"edges\":[]}', ?2, 0, 'now', 'now')",
        params![project_id, "0".repeat(64)],
    );
    assert!(invalid.is_err());
}

#[test]
fn json_canvas_contract_is_strict_canonical_and_preserves_safe_extensions() {
    let document = sample_document();
    let (canonical, hash) = canonical_canvas_document(&document).unwrap();
    assert_eq!(hash, format!("{:x}", Sha256::digest(canonical.as_bytes())));
    assert_eq!(canonical_canvas_document(&document).unwrap().0, canonical);
    let round_trip: MadiCanvasDocument = serde_json::from_str(&canonical).unwrap();
    assert_eq!(round_trip, document);
    assert_eq!(round_trip.extensions["madiVersion"], json!(1));
    assert!(canonical.contains("\"fromNode\""));
    assert!(canonical.contains("\"nodeKind\":\"ENTITY_REFERENCE\""));

    let unsupported = serde_json::from_value::<MadiCanvasDocument>(json!({
        "nodes": [{
            "id": "link-1", "type": "link", "x": 0, "y": 0,
            "width": 100, "height": 100, "url": "https://example.com"
        }],
        "edges": []
    }));
    assert!(unsupported.is_err());

    let mut duplicate = document.clone();
    duplicate.nodes.push(duplicate.nodes[0].clone());
    assert!(canonical_canvas_document(&duplicate).is_err());
    let mut dangling = document;
    dangling.edges[0].to_node = "missing".to_owned();
    assert!(canonical_canvas_document(&dangling).is_err());
}

#[test]
fn json_canvas_geometry_rejects_fractional_and_out_of_bounds_numbers() {
    let cases = [
        (0.5, 20.0, 320.0, 180.0),
        (0.0, -1.25, 320.0, 180.0),
        (0.0, 20.0, 320.5, 180.0),
        (0.0, 20.0, 320.0, 180.25),
        (10_000_001.0, 20.0, 320.0, 180.0),
        (0.0, 20.0, 100_001.0, 180.0),
    ];
    for (x, y, width, height) in cases {
        let mut document = MadiCanvasDocument {
            nodes: vec![text_node("geometry", "정수 좌표", 0.0)],
            edges: vec![],
            extensions: BTreeMap::new(),
        };
        document.nodes[0].x = x;
        document.nodes[0].y = y;
        document.nodes[0].width = width;
        document.nodes[0].height = height;
        let error = canonical_canvas_document(&document).unwrap_err();
        assert!(matches!(error, CoreError::InvalidInput(_)));
    }
}

#[test]
fn canvas_crud_hash_noop_stale_revision_and_reopen_are_atomic() {
    let fixture = fixture("crud.madi");
    let created = create_canvas(CreateCanvasParams {
        file_path: fixture.path.clone(),
        canvas_id: Some("plot-main".to_owned()),
        name: "전체 플롯".to_owned(),
        description: Some("주요 사건".to_owned()),
        document: sample_document(),
        expected_revision: Some(0),
        saved_by: Some("canvas-test".to_owned()),
    })
    .unwrap();
    assert_eq!(created.metadata.revision, 1);
    assert_eq!(created.canvas.summary.revision, 0);
    assert_eq!(created.canvas.summary.node_count, 4);
    assert_eq!(created.canvas.summary.edge_count, 1);
    assert_eq!(created.canvas.summary.content_hash.len(), 64);

    let no_op = save_canvas(SaveCanvasParams {
        file_path: fixture.path.clone(),
        canvas_id: "plot-main".to_owned(),
        document: created.canvas.document.clone(),
        expected_revision: 1,
        expected_canvas_revision: 0,
        saved_by: None,
    })
    .unwrap();
    assert!(no_op.no_op);
    assert_eq!(no_op.metadata.revision, 1);
    assert_eq!(no_op.canvas.summary.revision, 0);

    let mut changed_document = no_op.canvas.document;
    changed_document
        .nodes
        .push(text_node("text-2", "결말 후보", 800.0));
    let saved = save_canvas(SaveCanvasParams {
        file_path: fixture.path.clone(),
        canvas_id: "plot-main".to_owned(),
        document: changed_document,
        expected_revision: 1,
        expected_canvas_revision: 0,
        saved_by: None,
    })
    .unwrap();
    assert!(!saved.no_op);
    assert_eq!(saved.metadata.revision, 2);
    assert_eq!(saved.canvas.summary.revision, 1);

    let stale = save_canvas(SaveCanvasParams {
        file_path: fixture.path.clone(),
        canvas_id: "plot-main".to_owned(),
        document: sample_document(),
        expected_revision: 2,
        expected_canvas_revision: 0,
        saved_by: None,
    })
    .unwrap_err();
    assert!(matches!(stale, CoreError::CanvasRevisionConflict { .. }));

    let renamed = update_canvas(UpdateCanvasParams {
        file_path: fixture.path.clone(),
        canvas_id: "plot-main".to_owned(),
        name: "인물 관계 구상".to_owned(),
        description: None,
        expected_revision: 2,
        expected_canvas_revision: 1,
        saved_by: None,
    })
    .unwrap();
    assert_eq!(renamed.metadata.revision, 3);
    assert_eq!(renamed.canvas.summary.revision, 2);

    let duplicate = duplicate_canvas(DuplicateCanvasParams {
        file_path: fixture.path.clone(),
        source_canvas_id: "plot-main".to_owned(),
        canvas_id: Some("plot-copy".to_owned()),
        name: Some("인물 관계 구상".to_owned()),
        expected_revision: 3,
        saved_by: None,
    })
    .unwrap();
    assert_eq!(duplicate.metadata.revision, 4);
    assert_eq!(duplicate.canvas.summary.revision, 0);
    assert_eq!(
        duplicate.canvas.summary.content_hash,
        renamed.canvas.summary.content_hash
    );

    let listed = list_canvases(ListCanvasesParams {
        file_path: fixture.path.clone(),
        sort: CanvasSort::NameAsc,
    })
    .unwrap();
    assert_eq!(listed.canvases.len(), 2);
    assert_eq!(
        listed
            .canvases
            .iter()
            .filter(|canvas| canvas.name == "인물 관계 구상")
            .count(),
        2
    );

    let deleted = delete_canvas(DeleteCanvasParams {
        file_path: fixture.path.clone(),
        canvas_id: "plot-copy".to_owned(),
        expected_revision: 4,
        expected_canvas_revision: 0,
        saved_by: None,
    })
    .unwrap();
    assert_eq!(deleted.metadata.revision, 5);

    let reopened = load_canvas(LoadCanvasParams {
        file_path: fixture.path,
        canvas_id: "plot-main".to_owned(),
    })
    .unwrap();
    assert_eq!(reopened.canvas.summary.revision, 2);
    assert_eq!(reopened.canvas.summary.node_count, 5);
    assert_eq!(reopened.canvas.summary.edge_count, 1);
}

#[test]
fn malformed_save_and_identifier_conflict_leave_the_previous_canvas_intact() {
    let fixture = fixture("rollback.madi");
    let created = create_canvas(CreateCanvasParams {
        file_path: fixture.path.clone(),
        canvas_id: Some("stable".to_owned()),
        name: "안전한 캔버스".to_owned(),
        description: None,
        document: sample_document(),
        expected_revision: Some(0),
        saved_by: None,
    })
    .unwrap();
    let before_hash = created.canvas.summary.content_hash;

    let mut malformed = created.canvas.document;
    malformed.edges[0].to_node = "missing".to_owned();
    assert!(save_canvas(SaveCanvasParams {
        file_path: fixture.path.clone(),
        canvas_id: "stable".to_owned(),
        document: malformed,
        expected_revision: 1,
        expected_canvas_revision: 0,
        saved_by: None,
    })
    .is_err());
    assert!(matches!(
        create_canvas(CreateCanvasParams {
            file_path: fixture.path.clone(),
            canvas_id: Some("stable".to_owned()),
            name: "충돌".to_owned(),
            description: None,
            document: MadiCanvasDocument::default(),
            expected_revision: Some(1),
            saved_by: None,
        })
        .unwrap_err(),
        CoreError::IdentifierConflict { .. }
    ));

    let after = load_canvas(LoadCanvasParams {
        file_path: fixture.path.clone(),
        canvas_id: "stable".to_owned(),
    })
    .unwrap();
    assert_eq!(after.metadata.revision, 1);
    assert_eq!(after.canvas.summary.revision, 0);
    assert_eq!(after.canvas.summary.content_hash, before_hash);
    assert_eq!(after.canvas.summary.node_count, 4);
}

#[test]
fn canvas_queries_fail_closed_if_a_corrupt_foreign_project_row_exists() {
    let fixture = fixture("project-isolation.madi");
    let (document_json, content_hash) =
        canonical_canvas_document(&MadiCanvasDocument::default()).unwrap();
    let connection = Connection::open(&fixture.path).unwrap();
    connection
        .pragma_update(None, "foreign_keys", false)
        .unwrap();
    connection
        .execute(
            "INSERT INTO canvases (
                id, project_id, name, description, document_format,
                document_version, document_json, content_hash, revision,
                created_at, updated_at
             ) VALUES ('foreign', 'different-project', '외부', NULL,
                       'JSON_CANVAS', '1.0', ?1, ?2, 0, 'now', 'now')",
            params![document_json, content_hash],
        )
        .unwrap();
    drop(connection);

    let listed = list_canvases(ListCanvasesParams {
        file_path: fixture.path.clone(),
        sort: CanvasSort::UpdatedDesc,
    });
    assert!(matches!(listed, Err(CoreError::Integrity(_))));
    assert!(load_canvas(LoadCanvasParams {
        file_path: fixture.path,
        canvas_id: "foreign".to_owned(),
    })
    .is_err());
}

#[test]
fn snapshot_v3_diff_restore_and_legacy_v2_restore_cover_canvases_atomically() {
    let fixture = fixture("snapshot-v3.madi");
    let baseline_canvas = create_canvas(CreateCanvasParams {
        file_path: fixture.path.clone(),
        canvas_id: Some("baseline-canvas".to_owned()),
        name: "기준 캔버스".to_owned(),
        description: None,
        document: MadiCanvasDocument {
            nodes: vec![text_node("base", "기준", 0.0)],
            edges: vec![],
            extensions: BTreeMap::new(),
        },
        expected_revision: Some(0),
        saved_by: None,
    })
    .unwrap();
    let baseline = create_named_snapshot(CreateNamedSnapshotParams {
        file_path: fixture.path.clone(),
        name: "Canvas 기준".to_owned(),
        note: None,
        kind: NamedSnapshotKind::Manual,
        snapshot_id: Some("canvas-baseline".to_owned()),
        expected_revision: Some(baseline_canvas.metadata.revision),
        saved_by: None,
    })
    .unwrap();
    assert_eq!(baseline.snapshot.payload_version, 3);

    let mut changed = baseline_canvas.canvas.document;
    changed.nodes.push(text_node("second", "두 번째", 400.0));
    changed.edges.push(edge("base-to-second", "base", "second"));
    let changed = save_canvas(SaveCanvasParams {
        file_path: fixture.path.clone(),
        canvas_id: "baseline-canvas".to_owned(),
        document: changed,
        expected_revision: baseline.metadata.revision,
        expected_canvas_revision: 0,
        saved_by: None,
    })
    .unwrap();
    let added = create_canvas(CreateCanvasParams {
        file_path: fixture.path.clone(),
        canvas_id: Some("added-canvas".to_owned()),
        name: "추가 캔버스".to_owned(),
        description: None,
        document: MadiCanvasDocument::default(),
        expected_revision: Some(changed.metadata.revision),
        saved_by: None,
    })
    .unwrap();

    let diff = diff_named_snapshot(DiffNamedSnapshotParams {
        file_path: fixture.path.clone(),
        snapshot_id: "canvas-baseline".to_owned(),
    })
    .unwrap();
    assert_eq!(diff.summary.added_canvases, 1);
    assert_eq!(diff.summary.deleted_canvases, 0);
    assert_eq!(diff.summary.changed_canvases, 1);
    assert_eq!(diff.summary.canvas_node_count_delta, 1);
    assert_eq!(diff.summary.canvas_edge_count_delta, 1);

    let restored = restore_named_snapshot(RestoreNamedSnapshotParams {
        file_path: fixture.path.clone(),
        snapshot_id: "canvas-baseline".to_owned(),
        auto_snapshot_name: Some("Canvas 복원 전".to_owned()),
        expected_revision: Some(added.metadata.revision),
        saved_by: None,
    })
    .unwrap();
    assert_eq!(restored.safety_snapshot.payload_version, 3);
    let restored_canvases = list_canvases(ListCanvasesParams {
        file_path: fixture.path.clone(),
        sort: CanvasSort::NameAsc,
    })
    .unwrap();
    assert_eq!(restored_canvases.canvases.len(), 1);
    assert_eq!(restored_canvases.canvases[0].id, "baseline-canvas");
    assert_eq!(restored_canvases.canvases[0].node_count, 1);
    assert_eq!(restored_canvases.canvases[0].edge_count, 0);

    let connection = Connection::open(&fixture.path).unwrap();
    let payload_blob: Vec<u8> = connection
        .query_row(
            "SELECT payload_blob FROM named_snapshots WHERE id = 'canvas-baseline'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let payload: Value = serde_json::from_slice(&payload_blob).unwrap();
    let mut corrupt_canvas_payload = payload.clone();
    corrupt_canvas_payload["canvases"][0]["content_hash"] = json!("0".repeat(64));
    let corrupt_canvas_blob = serde_json::to_vec(&corrupt_canvas_payload).unwrap();
    let corrupt_canvas_hash = format!("{:x}", Sha256::digest(&corrupt_canvas_blob));
    connection
        .execute(
            "INSERT INTO named_snapshots (
                id, project_id, name, note, kind, payload_format, payload_version,
                payload_blob, content_hash, created_at, updated_at
             ) SELECT 'corrupt-canvas-v3', project_id, '손상 Canvas v3', NULL,
                      'MANUAL', payload_format, 3, ?1, ?2, created_at, updated_at
               FROM named_snapshots WHERE id = 'canvas-baseline'",
            params![corrupt_canvas_blob, corrupt_canvas_hash],
        )
        .unwrap();
    let mut legacy_payload = payload;
    legacy_payload["version"] = json!(2);
    legacy_payload.as_object_mut().unwrap().remove("canvases");
    let legacy_blob = serde_json::to_vec(&legacy_payload).unwrap();
    let legacy_hash = format!("{:x}", Sha256::digest(&legacy_blob));
    connection
        .execute(
            "INSERT INTO named_snapshots (
                id, project_id, name, note, kind, payload_format, payload_version,
                payload_blob, content_hash, created_at, updated_at
             ) SELECT 'legacy-v2-canvasless', project_id, '구버전 v2', NULL,
                      'MANUAL', payload_format, 2, ?1, ?2, created_at, updated_at
               FROM named_snapshots WHERE id = 'canvas-baseline'",
            params![legacy_blob, legacy_hash],
        )
        .unwrap();
    drop(connection);

    let before_failed_revision = open_project(OpenProjectParams {
        file_path: fixture.path.clone(),
    })
    .unwrap()
    .metadata
    .revision;
    let before_failed_snapshot_count = list_named_snapshots(ListNamedSnapshotsParams {
        file_path: fixture.path.clone(),
    })
    .unwrap()
    .snapshots
    .len();
    assert!(restore_named_snapshot(RestoreNamedSnapshotParams {
        file_path: fixture.path.clone(),
        snapshot_id: "corrupt-canvas-v3".to_owned(),
        auto_snapshot_name: None,
        expected_revision: Some(before_failed_revision),
        saved_by: None,
    })
    .is_err());
    assert_eq!(
        open_project(OpenProjectParams {
            file_path: fixture.path.clone(),
        })
        .unwrap()
        .metadata
        .revision,
        before_failed_revision
    );
    assert_eq!(
        list_named_snapshots(ListNamedSnapshotsParams {
            file_path: fixture.path.clone(),
        })
        .unwrap()
        .snapshots
        .len(),
        before_failed_snapshot_count
    );
    assert_eq!(
        load_canvas(LoadCanvasParams {
            file_path: fixture.path.clone(),
            canvas_id: "baseline-canvas".to_owned(),
        })
        .unwrap()
        .canvas
        .summary
        .node_count,
        1
    );

    restore_named_snapshot(RestoreNamedSnapshotParams {
        file_path: fixture.path.clone(),
        snapshot_id: "legacy-v2-canvasless".to_owned(),
        auto_snapshot_name: None,
        expected_revision: Some(before_failed_revision),
        saved_by: None,
    })
    .unwrap();
    assert!(list_canvases(ListCanvasesParams {
        file_path: fixture.path.clone(),
        sort: CanvasSort::UpdatedDesc,
    })
    .unwrap()
    .canvases
    .is_empty());
    assert!(list_named_snapshots(ListNamedSnapshotsParams {
        file_path: fixture.path,
    })
    .unwrap()
    .snapshots
    .iter()
    .any(|snapshot| snapshot.id == "legacy-v2-canvasless"));
}

#[test]
fn rpc_contract_and_maximum_500_by_1000_document_round_trip() {
    let fixture = fixture("scale.madi");
    let nodes = (0..500)
        .map(|index| text_node(&format!("node-{index:03}"), "fixture", index as f64 * 20.0))
        .collect::<Vec<_>>();
    let edges = (0..1_000)
        .map(|index| {
            edge(
                &format!("edge-{index:04}"),
                &format!("node-{:03}", index % 500),
                &format!("node-{:03}", (index + 1) % 500),
            )
        })
        .collect::<Vec<_>>();
    let document = MadiCanvasDocument {
        nodes,
        edges,
        extensions: BTreeMap::new(),
    };
    let created = dispatch(
        "create_canvas",
        json!({
            "file_path": fixture.path,
            "canvas_id": "scale-canvas",
            "name": "대규모",
            "document": document,
            "expected_revision": 0
        }),
    )
    .unwrap();
    assert_eq!(created["canvas"]["node_count"], json!(500));
    assert_eq!(created["canvas"]["edge_count"], json!(1_000));
    assert_eq!(created["canvas"]["revision"], json!(0));
    for _ in 0..5 {
        let loaded = dispatch(
            "load_canvas",
            json!({
                "file_path": fixture.path,
                "canvas_id": "scale-canvas"
            }),
        )
        .unwrap();
        assert_eq!(
            loaded["canvas"]["document"]["nodes"]
                .as_array()
                .unwrap()
                .len(),
            500
        );
        assert_eq!(
            loaded["canvas"]["document"]["edges"]
                .as_array()
                .unwrap()
                .len(),
            1_000
        );
    }
}
