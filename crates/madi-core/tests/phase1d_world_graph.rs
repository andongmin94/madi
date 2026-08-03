use std::path::{Path, PathBuf};
use std::time::Instant;

use madi_core::*;
use rusqlite::{params, Connection};
use serde_json::json;
use tempfile::tempdir;

struct Fixture {
    path: PathBuf,
    project_id: String,
    scene_id: String,
}

fn fixture(name: &str) -> (tempfile::TempDir, Fixture) {
    let directory = tempdir().unwrap();
    let path = directory.path().join(name);
    let created = create_project(CreateProjectParams {
        file_path: path.clone(),
        title: "Phase 1D 작품".to_owned(),
        created_by: Some("phase-1d-test".to_owned()),
        author_name: None,
        project_id: Some("phase-1d-project".to_owned()),
        document_id: Some("phase-1d-scene-document".to_owned()),
        document_title: Some("첫 장면".to_owned()),
        editor_engine: Some("typie".to_owned()),
        editor_engine_commit: Some("phase-1d-test".to_owned()),
        editor_schema_version: Some(1),
    })
    .unwrap();
    (
        directory,
        Fixture {
            path,
            project_id: created.project.metadata.project_id,
            scene_id: created.default_scene_node_id,
        },
    )
}

fn create_graph_entity(
    path: &Path,
    id: &str,
    kind: EntityKind,
    status: EntityStatus,
    name: &str,
) -> EntityRecord {
    create_entity(CreateEntityParams {
        file_path: path.to_path_buf(),
        kind,
        name: name.to_owned(),
        summary: Some(format!("{name}의 전체 이름과 요약")),
        status,
        color_token: Some(format!("color-{id}")),
        icon_key: Some(format!("icon-{id}")),
        attributes: json!({"phase": "1d"}),
        entity_id: Some(id.to_owned()),
        document_id: Some(format!("{id}-document")),
        editor_engine: Some("typie".to_owned()),
        editor_engine_commit: Some("phase-1d-test".to_owned()),
        editor_schema_version: Some(1),
        expected_revision: None,
        saved_by: Some("phase-1d-test".to_owned()),
    })
    .unwrap()
    .entity
}

fn create_relation_type_fixture(
    path: &Path,
    id: &str,
    name: &str,
    inverse_name: Option<&str>,
    directed: bool,
) {
    create_relation_type(CreateRelationTypeParams {
        file_path: path.to_path_buf(),
        name: name.to_owned(),
        inverse_name: inverse_name.map(str::to_owned),
        directed,
        color_token: Some(format!("edge-{id}")),
        relation_type_id: Some(id.to_owned()),
        expected_revision: None,
        saved_by: Some("phase-1d-test".to_owned()),
    })
    .unwrap();
}

#[test]
fn world_graph_projects_story_bible_semantics_and_reopens_identically() {
    let (_directory, fixture) = fixture("world-graph-roundtrip.madi");
    create_graph_entity(
        &fixture.path,
        "hero",
        EntityKind::Character,
        EntityStatus::Active,
        "레이아",
    );
    create_graph_entity(
        &fixture.path,
        "guild",
        EntityKind::Organization,
        EntityStatus::Draft,
        "북부 마법사단",
    );
    create_graph_entity(
        &fixture.path,
        "rival",
        EntityKind::Character,
        EntityStatus::Active,
        "세리나",
    );
    create_graph_entity(
        &fixture.path,
        "archive",
        EntityKind::Location,
        EntityStatus::Archived,
        "폐허",
    );
    create_entity_alias(CreateEntityAliasParams {
        file_path: fixture.path.clone(),
        entity_id: "hero".to_owned(),
        alias: "북부의 별".to_owned(),
        alias_id: Some("hero-alias".to_owned()),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    let tag = create_tag(CreateTagParams {
        file_path: fixture.path.clone(),
        name: "주요 인물".to_owned(),
        color_token: Some("tag-primary".to_owned()),
        tag_id: Some("tag-primary".to_owned()),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    set_entity_tags(SetEntityTagsParams {
        file_path: fixture.path.clone(),
        entity_id: "hero".to_owned(),
        tag_ids: vec![tag.tag.id],
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();

    create_relation_type_fixture(
        &fixture.path,
        "membership",
        "가입",
        Some("회원을 가짐"),
        true,
    );
    create_relation_type_fixture(&fixture.path, "hostility", "경쟁", None, false);
    create_entity_relation(CreateEntityRelationParams {
        file_path: fixture.path.clone(),
        source_entity_id: "hero".to_owned(),
        relation_type_id: "membership".to_owned(),
        target_entity_id: "guild".to_owned(),
        note: Some("정식 단원".to_owned()),
        relation_id: Some("relation-membership".to_owned()),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    create_entity_relation(CreateEntityRelationParams {
        file_path: fixture.path.clone(),
        source_entity_id: "rival".to_owned(),
        relation_type_id: "hostility".to_owned(),
        target_entity_id: "hero".to_owned(),
        note: Some("오랜 경쟁자".to_owned()),
        relation_id: Some("relation-hostility".to_owned()),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    create_scene_entity_link(CreateSceneEntityLinkParams {
        file_path: fixture.path.clone(),
        scene_node_id: fixture.scene_id.clone(),
        entity_id: "hero".to_owned(),
        role: SceneEntityRole::Pov,
        note: Some("시점 인물".to_owned()),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();

    let graph = get_world_graph(GetWorldGraphParams {
        file_path: fixture.path.clone(),
    })
    .unwrap();
    assert_eq!(graph.project_id, fixture.project_id);
    assert_eq!(graph.nodes.len(), 4);
    assert_eq!(graph.edges.len(), 2);
    assert!(graph.diagnostics.is_empty());

    let hero = graph.nodes.iter().find(|node| node.id == "hero").unwrap();
    assert_eq!(hero.kind, EntityKind::Character);
    assert_eq!(hero.status, EntityStatus::Active);
    assert_eq!(hero.aliases, vec!["북부의 별"]);
    assert_eq!(hero.tags.len(), 1);
    assert_eq!(hero.tags[0].name, "주요 인물");
    assert_eq!(hero.explicit_scene_link_count, 1);
    assert_eq!(hero.outgoing_relation_count, 1);
    assert_eq!(hero.incoming_relation_count, 0);
    assert_eq!(hero.undirected_relation_count, 1);
    assert_eq!(
        graph
            .nodes
            .iter()
            .find(|node| node.id == "archive")
            .unwrap()
            .status,
        EntityStatus::Archived
    );

    let directed = graph
        .edges
        .iter()
        .find(|edge| edge.id == "relation-membership")
        .unwrap();
    assert!(directed.directed);
    assert_eq!(directed.source_entity_id, "hero");
    assert_eq!(directed.target_entity_id, "guild");
    assert_eq!(directed.forward_label, "가입");
    assert_eq!(directed.inverse_label.as_deref(), Some("회원을 가짐"));
    let undirected = graph
        .edges
        .iter()
        .find(|edge| edge.id == "relation-hostility")
        .unwrap();
    assert!(!undirected.directed);
    assert_eq!(undirected.forward_label, "경쟁");

    assert_eq!(graph.stats.entity_count, 4);
    assert_eq!(graph.stats.relation_count, 2);
    assert_eq!(graph.stats.isolated_entity_count, 1);
    assert_eq!(graph.stats.directed_relation_count, 1);
    assert_eq!(graph.stats.undirected_relation_count, 1);
    assert_eq!(graph.stats.entity_kind_counts.len(), 8);
    assert_eq!(
        graph
            .stats
            .entity_kind_counts
            .iter()
            .find(|entry| entry.kind == EntityKind::Organization)
            .unwrap()
            .count,
        1
    );
    assert_eq!(graph.stats.top_degree_entities[0].entity_id, "hero");
    assert_eq!(graph.stats.top_degree_entities[0].degree, 2);
    let membership_count = graph
        .stats
        .relation_type_counts
        .iter()
        .find(|entry| entry.relation_type_id == "membership")
        .unwrap();
    assert_eq!(membership_count.count, 1);
    assert!(membership_count.directed);
    assert_eq!(
        membership_count.inverse_name.as_deref(),
        Some("회원을 가짐")
    );

    let hero_detail = get_entity_graph_detail(GetEntityGraphDetailParams {
        file_path: fixture.path.clone(),
        entity_id: "hero".to_owned(),
    })
    .unwrap();
    assert_eq!(hero_detail.entity, *hero);
    assert_eq!(hero_detail.outgoing_relations.len(), 1);
    assert_eq!(hero_detail.undirected_relations.len(), 1);
    assert_eq!(
        hero_detail.outgoing_relations[0].perspective,
        WorldGraphRelationPerspective::Outgoing
    );
    let guild_detail = get_entity_graph_detail(GetEntityGraphDetailParams {
        file_path: fixture.path.clone(),
        entity_id: "guild".to_owned(),
    })
    .unwrap();
    assert_eq!(guild_detail.incoming_relations.len(), 1);
    assert_eq!(
        guild_detail.incoming_relations[0].display_label,
        "회원을 가짐"
    );
    assert_eq!(
        guild_detail.incoming_relations[0].perspective,
        WorldGraphRelationPerspective::Incoming
    );

    let scene_context = get_entity_scene_context(GetEntitySceneContextParams {
        file_path: fixture.path.clone(),
        entity_id: "hero".to_owned(),
    })
    .unwrap();
    assert_eq!(scene_context.links.len(), 1);
    assert_eq!(scene_context.links[0].scene_node_id, fixture.scene_id);
    assert_eq!(scene_context.links[0].role, SceneEntityRole::Pov);

    let stats = get_world_graph_stats(GetWorldGraphStatsParams {
        file_path: fixture.path.clone(),
    })
    .unwrap();
    assert_eq!(stats.stats, graph.stats);
    assert_eq!(stats.revision, graph.revision);
    let rpc = dispatch("get_world_graph", json!({"file_path": fixture.path})).unwrap();
    assert_eq!(rpc["project_id"], fixture.project_id);
    assert_eq!(
        rpc["stats"]["entity_kind_counts"].as_array().unwrap().len(),
        8
    );
    assert_eq!(rpc["edges"][0]["source_entity_id"].is_string(), true);
    let stats_rpc = dispatch("get_world_graph_stats", json!({"file_path": fixture.path})).unwrap();
    assert_eq!(stats_rpc["stats"]["relation_count"], 2);
    let detail_rpc = dispatch(
        "get_entity_graph_detail",
        json!({"file_path": fixture.path, "entity_id": "guild"}),
    )
    .unwrap();
    assert_eq!(
        detail_rpc["incoming_relations"][0]["perspective"],
        "INCOMING"
    );
    let scene_rpc = dispatch(
        "get_entity_scene_context",
        json!({"file_path": fixture.path, "entity_id": "hero"}),
    )
    .unwrap();
    assert_eq!(scene_rpc["links"][0]["role"], "POV");

    let opened = open_project(OpenProjectParams {
        file_path: fixture.path.clone(),
    })
    .unwrap();
    assert_eq!(opened.metadata.revision, graph.revision);
    assert_eq!(opened.metadata.format_version, FORMAT_VERSION);
    assert_eq!(opened.metadata.schema_version, SCHEMA_VERSION);
    let reopened = get_world_graph(GetWorldGraphParams {
        file_path: fixture.path,
    })
    .unwrap();
    assert_eq!(reopened, graph);
}

#[test]
fn deleted_story_bible_records_disappear_and_revision_advances() {
    let (_directory, fixture) = fixture("world-graph-delete.madi");
    create_graph_entity(
        &fixture.path,
        "source",
        EntityKind::Character,
        EntityStatus::Active,
        "출발점",
    );
    create_graph_entity(
        &fixture.path,
        "target",
        EntityKind::Event,
        EntityStatus::Draft,
        "도착점",
    );
    create_relation_type_fixture(&fixture.path, "cause", "촉발", Some("촉발됨"), true);
    create_entity_relation(CreateEntityRelationParams {
        file_path: fixture.path.clone(),
        source_entity_id: "source".to_owned(),
        relation_type_id: "cause".to_owned(),
        target_entity_id: "target".to_owned(),
        note: None,
        relation_id: Some("cause-edge".to_owned()),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    let before = get_world_graph(GetWorldGraphParams {
        file_path: fixture.path.clone(),
    })
    .unwrap();

    delete_entity_relation(DeleteEntityRelationParams {
        file_path: fixture.path.clone(),
        relation_id: "cause-edge".to_owned(),
        expected_revision: Some(before.revision),
        saved_by: None,
    })
    .unwrap();
    let without_edge = get_world_graph(GetWorldGraphParams {
        file_path: fixture.path.clone(),
    })
    .unwrap();
    assert!(without_edge.revision > before.revision);
    assert!(without_edge.edges.is_empty());

    delete_entity(DeleteEntityParams {
        file_path: fixture.path.clone(),
        entity_id: "target".to_owned(),
        confirmed: true,
        expected_revision: Some(without_edge.revision),
        saved_by: None,
    })
    .unwrap();
    let without_entity = get_world_graph(GetWorldGraphParams {
        file_path: fixture.path,
    })
    .unwrap();
    assert!(without_entity.revision > without_edge.revision);
    assert!(!without_entity.nodes.iter().any(|node| node.id == "target"));
    assert_eq!(without_entity.stats.entity_count, 1);
}

fn seed_large_fixture(fixture: &Fixture) {
    let editor_engine_commit = std::env::var("MADI_PHASE1D_TYPIE_COMMIT")
        .unwrap_or_else(|_| "phase-1d-scale".to_owned());
    let mut connection = Connection::open(&fixture.path).unwrap();
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .unwrap();
    let transaction = connection.transaction().unwrap();
    let timestamp = "2026-08-02T00:00:00.000Z";
    for index in 0..20 {
        transaction
            .execute(
                "INSERT INTO tags (id, project_id, name, color_token, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                params![
                    format!("scale-tag-{index}"),
                    fixture.project_id,
                    format!("태그 {index}"),
                    format!("tag-color-{index}"),
                    timestamp
                ],
            )
            .unwrap();
    }
    for index in 0..500 {
        let entity_id = format!("scale-entity-{index:03}");
        let document_id = format!("scale-document-{index:03}");
        transaction
            .execute(
                "INSERT INTO documents (
                    id, project_id, title, editor_engine, editor_engine_commit,
                    editor_schema_version, snapshot_blob, plain_text_recovery,
                    created_at, updated_at
                 ) VALUES (?1, ?2, ?3, 'typie', ?4, 1, ?5, '', ?6, ?6)",
                params![
                    document_id,
                    fixture.project_id,
                    format!("설정 {index}"),
                    &editor_engine_commit,
                    Vec::<u8>::new(),
                    timestamp
                ],
            )
            .unwrap();
        transaction
            .execute(
                "INSERT INTO entities (
                    id, project_id, kind, name, summary, document_id, status,
                    color_token, icon_key, attributes_json, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, '{}', ?8, ?8)",
                params![
                    entity_id,
                    fixture.project_id,
                    match index % 8 {
                        0 => "CHARACTER",
                        1 => "LOCATION",
                        2 => "ORGANIZATION",
                        3 => "ITEM",
                        4 => "EVENT",
                        5 => "WORLD_RULE",
                        6 => "FORESHADOWING",
                        _ => "OTHER",
                    },
                    format!("대규모 설정 {index:03}"),
                    format!("대규모 fixture summary {index}"),
                    document_id,
                    if index % 5 == 4 { "DRAFT" } else { "ACTIVE" },
                    timestamp
                ],
            )
            .unwrap();
        for alias_index in 0..3 {
            transaction
                .execute(
                    "INSERT INTO entity_aliases (
                        id, entity_id, alias, normalized_alias, created_at
                     ) VALUES (?1, ?2, ?3, ?3, ?4)",
                    params![
                        format!("scale-alias-{index:03}-{alias_index}"),
                        entity_id,
                        format!("별칭 {index:03}-{alias_index}"),
                        timestamp
                    ],
                )
                .unwrap();
        }
        transaction
            .execute(
                "INSERT INTO entity_tags (entity_id, tag_id) VALUES (?1, ?2)",
                params![entity_id, format!("scale-tag-{}", index % 20)],
            )
            .unwrap();
        for role in ["APPEARS", "POV", "MENTIONED", "RELATED"] {
            transaction
                .execute(
                    "INSERT INTO scene_entity_links (
                        scene_node_id, entity_id, role, note, created_at
                     ) VALUES (?1, ?2, ?3, NULL, ?4)",
                    params![fixture.scene_id, entity_id, role, timestamp],
                )
                .unwrap();
        }
    }
    let relation_type_id = format!("{}:builtin-membership", fixture.project_id);
    for round in 0..4 {
        for source in 0..500 {
            let target = (source + round + 1) % 500;
            transaction
                .execute(
                    "INSERT INTO entity_relations (
                        id, project_id, source_entity_id, relation_type_id,
                        target_entity_id, note, created_at, updated_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?6)",
                    params![
                        format!("scale-relation-{round}-{source:03}"),
                        fixture.project_id,
                        format!("scale-entity-{source:03}"),
                        relation_type_id,
                        format!("scale-entity-{target:03}"),
                        timestamp
                    ],
                )
                .unwrap();
        }
    }
    transaction
        .execute(
            "UPDATE documents SET editor_engine_commit = ?1 WHERE project_id = ?2",
            params![&editor_engine_commit, fixture.project_id],
        )
        .unwrap();
    transaction
        .execute(
            "UPDATE app_meta SET revision = revision + 1, updated_at = ?1 WHERE singleton = 1",
            [timestamp],
        )
        .unwrap();
    transaction.commit().unwrap();
}

#[test]
fn graph_read_model_handles_500_entities_and_2000_relations_under_one_second() {
    let (_directory, fixture) = fixture("world-graph-scale.madi");
    seed_large_fixture(&fixture);
    let mut read_samples_ms = Vec::new();
    let mut serialization_samples_ms = Vec::new();
    let mut payload_bytes = None;
    for _ in 0..5 {
        let started = Instant::now();
        let graph = get_world_graph(GetWorldGraphParams {
            file_path: fixture.path.clone(),
        })
        .unwrap();
        read_samples_ms.push(started.elapsed().as_secs_f64() * 1_000.0);
        assert_eq!(graph.nodes.len(), 500);
        assert_eq!(graph.edges.len(), 2_000);
        assert_eq!(
            graph
                .nodes
                .iter()
                .map(|node| node.aliases.len())
                .sum::<usize>(),
            1_500
        );
        assert_eq!(
            graph
                .nodes
                .iter()
                .map(|node| node.explicit_scene_link_count)
                .sum::<u64>(),
            2_000
        );
        assert!(graph.diagnostics.is_empty());
        let serialization_started = Instant::now();
        let serialized = serde_json::to_vec(&graph).unwrap();
        serialization_samples_ms.push(serialization_started.elapsed().as_secs_f64() * 1_000.0);
        assert_eq!(
            *payload_bytes.get_or_insert(serialized.len()),
            serialized.len()
        );
    }
    read_samples_ms.sort_by(f64::total_cmp);
    serialization_samples_ms.sort_by(f64::total_cmp);
    let read_median_ms = read_samples_ms[2];
    let read_maximum_ms = read_samples_ms[4];
    let serialization_median_ms = serialization_samples_ms[2];
    let serialization_maximum_ms = serialization_samples_ms[4];
    println!(
        "PHASE1D_RUST_GRAPH_READ_MODEL samples_ms={read_samples_ms:?} median_ms={read_median_ms:.3} max_ms={read_maximum_ms:.3}"
    );
    println!(
        "PHASE1D_RUST_GRAPH_SERIALIZATION samples_ms={serialization_samples_ms:?} median_ms={serialization_median_ms:.3} max_ms={serialization_maximum_ms:.3} payload_bytes={}",
        payload_bytes.unwrap()
    );
    assert!(
        read_maximum_ms < 1_000.0,
        "world graph read model max {read_maximum_ms:.3}ms exceeded the 1000ms target"
    );
    assert!(
        serialization_maximum_ms < 1_000.0,
        "world graph serialization max {serialization_maximum_ms:.3}ms exceeded the 1000ms target"
    );
}

#[test]
fn export_phase1d_scale_fixture_when_requested() {
    let Some(output_path) = std::env::var_os("MADI_PHASE1D_SCALE_FIXTURE_OUTPUT") else {
        return;
    };
    let output_path = PathBuf::from(output_path);
    assert!(
        output_path.is_absolute(),
        "MADI_PHASE1D_SCALE_FIXTURE_OUTPUT must be absolute"
    );
    assert_eq!(
        output_path
            .extension()
            .and_then(|extension| extension.to_str()),
        Some("madi"),
        "scale fixture output must use the .madi extension"
    );

    let (_directory, fixture) = fixture("world-graph-scale-export.madi");
    seed_large_fixture(&fixture);
    let expected_typie_commit = std::env::var("MADI_PHASE1D_TYPIE_COMMIT").unwrap();
    let incompatible_document_count: u64 = Connection::open(&fixture.path)
        .unwrap()
        .query_row(
            "SELECT COUNT(*) FROM documents WHERE editor_engine_commit <> ?1",
            [&expected_typie_commit],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        incompatible_document_count, 0,
        "exported scale fixture must use one compatible Typie commit"
    );
    let graph = get_world_graph(GetWorldGraphParams {
        file_path: fixture.path.clone(),
    })
    .unwrap();
    assert_eq!(graph.nodes.len(), 500);
    assert_eq!(graph.edges.len(), 2_000);
    assert_eq!(
        graph
            .nodes
            .iter()
            .map(|node| node.aliases.len())
            .sum::<usize>(),
        1_500
    );
    assert_eq!(
        graph
            .nodes
            .iter()
            .map(|node| node.explicit_scene_link_count)
            .sum::<u64>(),
        2_000
    );
    assert!(graph
        .nodes
        .iter()
        .all(|node| matches!(node.status, EntityStatus::Active | EntityStatus::Draft)));
    assert!(graph.diagnostics.is_empty());

    let mut source = std::fs::File::open(&fixture.path).unwrap();
    let mut destination = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&output_path)
        .unwrap();
    std::io::copy(&mut source, &mut destination).unwrap();
    destination.sync_all().unwrap();
    drop(destination);

    let exported = get_world_graph(GetWorldGraphParams {
        file_path: output_path.clone(),
    })
    .unwrap();
    assert_eq!(exported, graph);
    println!(
        "PHASE1D_SCALE_FIXTURE output={} entities=500 aliases=1500 relations=2000 scene_links=2000 statuses=ACTIVE+DRAFT bytes={}",
        output_path.display(),
        std::fs::metadata(&output_path).unwrap().len()
    );
}
