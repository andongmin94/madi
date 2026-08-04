use std::time::Instant;

use madi_core::*;
use rusqlite::{params, Connection};
use serde_json::json;
use sha2::{Digest, Sha256};
use tempfile::tempdir;

struct Fixture {
    path: std::path::PathBuf,
    project_id: String,
    chapter_id: String,
    scene_id: String,
}

fn fixture(name: &str) -> (tempfile::TempDir, Fixture) {
    let directory = tempdir().unwrap();
    let path = directory.path().join(name);
    let created = create_project(CreateProjectParams {
        file_path: path.clone(),
        title: "Phase 1C 작품".to_owned(),
        created_by: Some("phase-1c-test".to_owned()),
        author_name: None,
        project_id: Some("phase-1c-project".to_owned()),
        document_id: Some("scene-document".to_owned()),
        document_title: Some("첫 장면".to_owned()),
        editor_engine: Some("typie".to_owned()),
        editor_engine_commit: Some("test-commit".to_owned()),
        editor_schema_version: Some(1),
    })
    .unwrap();
    (
        directory,
        Fixture {
            path,
            project_id: created.project.metadata.project_id,
            chapter_id: created.default_chapter_node_id,
            scene_id: created.default_scene_node_id,
        },
    )
}

fn create_test_entity(
    path: &std::path::Path,
    id: &str,
    kind: EntityKind,
    name: &str,
) -> EntityRecord {
    create_entity(CreateEntityParams {
        file_path: path.to_path_buf(),
        kind,
        name: name.to_owned(),
        summary: Some(format!("{name} 요약")),
        status: EntityStatus::Active,
        color_token: None,
        icon_key: None,
        attributes: json!({"fixture": true}),
        entity_id: Some(id.to_owned()),
        document_id: Some(format!("{id}-document")),
        editor_engine: Some("typie".to_owned()),
        editor_engine_commit: Some("test-commit".to_owned()),
        editor_schema_version: Some(1),
        expected_revision: None,
        saved_by: Some("phase-1c-test".to_owned()),
    })
    .unwrap()
    .entity
}

fn save_scene_text(fixture: &Fixture, text: &str) {
    save_scene(SaveSceneParams {
        file_path: fixture.path.clone(),
        scene_id: fixture.scene_id.clone(),
        editor_engine: "typie".to_owned(),
        editor_engine_commit: "test-commit".to_owned(),
        editor_schema_version: 1,
        snapshot_base64: "c2NlbmU=".to_owned(),
        plain_text_recovery: text.to_owned(),
        expected_revision: None,
        saved_by: Some("phase-1c-test".to_owned()),
    })
    .unwrap();
}

#[test]
fn migrates_v3_to_v5_preserves_manuscript_and_seeds_project_scoped_builtins() {
    let (_directory, fixture) = fixture("migration-v3.madi");
    save_scene_text(&fixture, "이전 원고 보존");
    let connection = Connection::open(&fixture.path).unwrap();
    connection
        .execute_batch(
            "PRAGMA foreign_keys = OFF;
         DROP TRIGGER scene_entity_links_validate_update;
         DROP TRIGGER scene_entity_links_validate_insert;
         DROP TRIGGER entity_relations_validate_update;
         DROP TRIGGER entity_relations_validate_insert;
         DROP TRIGGER entity_tags_validate_project_insert;
         DROP TRIGGER entities_validate_document_update;
         DROP TRIGGER entities_validate_document_insert;
         DROP TABLE scene_entity_links;
         DROP TABLE entity_relations;
         DROP TABLE relation_types;
         DROP TABLE entity_tags;
         DROP TABLE tags;
         DROP TABLE entity_aliases;
         DROP TABLE entities;
         DELETE FROM schema_migrations WHERE version = 4;
         UPDATE app_meta SET schema_version = 3;
         PRAGMA user_version = 3;",
        )
        .unwrap();
    drop(connection);

    let opened = open_project(OpenProjectParams {
        file_path: fixture.path.clone(),
    })
    .unwrap();
    assert_eq!(opened.metadata.schema_version, SCHEMA_VERSION);
    assert_eq!(opened.metadata.format_version, 1);
    assert_eq!(
        opened.schema_migrations.last().unwrap().version,
        SCHEMA_VERSION
    );
    let scene = load_scene(LoadSceneParams {
        file_path: fixture.path.clone(),
        scene_id: fixture.scene_id,
    })
    .unwrap();
    assert_eq!(scene.document.plain_text_recovery, "이전 원고 보존");
    let builtins = list_relation_types(ListRelationTypesParams {
        file_path: fixture.path,
    })
    .unwrap();
    assert_eq!(builtins.relation_types.len(), 10);
    assert!(builtins.relation_types.iter().all(|item| item.is_builtin));
    assert!(builtins
        .relation_types
        .iter()
        .all(|item| item.id.starts_with("phase-1c-project:")));
}

#[test]
fn entity_kinds_notes_aliases_tags_search_and_reopen_round_trip() {
    let (_directory, fixture) = fixture("entity-roundtrip.madi");
    let kinds = [
        EntityKind::Character,
        EntityKind::Location,
        EntityKind::Organization,
        EntityKind::Item,
        EntityKind::Event,
        EntityKind::WorldRule,
        EntityKind::Foreshadowing,
        EntityKind::Other,
    ];
    for (index, kind) in kinds.into_iter().enumerate() {
        create_test_entity(
            &fixture.path,
            &format!("entity-{index}"),
            kind,
            &format!("설정 {index}"),
        );
    }
    let duplicate = create_test_entity(
        &fixture.path,
        "entity-duplicate",
        EntityKind::Character,
        "설정 0",
    );
    assert!(duplicate.duplicate_name);

    let alias = create_entity_alias(CreateEntityAliasParams {
        file_path: fixture.path.clone(),
        entity_id: "entity-0".to_owned(),
        alias: "  북부   마법사  ".to_owned(),
        alias_id: Some("alias-north".to_owned()),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    assert_eq!(alias.alias.normalized_alias, "북부 마법사");
    assert!(create_entity_alias(CreateEntityAliasParams {
        file_path: fixture.path.clone(),
        entity_id: "entity-0".to_owned(),
        alias: "북부 마법사".to_owned(),
        alias_id: None,
        expected_revision: None,
        saved_by: None,
    })
    .is_err());

    let tag = create_tag(CreateTagParams {
        file_path: fixture.path.clone(),
        name: "핵심".to_owned(),
        color_token: Some("red".to_owned()),
        tag_id: Some("tag-core".to_owned()),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    set_entity_tags(SetEntityTagsParams {
        file_path: fixture.path.clone(),
        entity_id: "entity-0".to_owned(),
        tag_ids: vec![tag.tag.id],
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();

    let loaded_blank = load_entity_note(LoadEntityNoteParams {
        file_path: fixture.path.clone(),
        owner_kind: DocumentOwnerKind::Entity,
        owner_id: "entity-0".to_owned(),
    })
    .unwrap();
    assert!(loaded_blank.document.snapshot_base64.is_empty());
    let saved = save_entity_note(SaveEntityNoteParams {
        file_path: fixture.path.clone(),
        owner_kind: DocumentOwnerKind::Entity,
        owner_id: "entity-0".to_owned(),
        document_id: loaded_blank.document_id,
        generation: 7,
        save_sequence: 11,
        editor_engine: "typie".to_owned(),
        editor_engine_commit: "test-commit".to_owned(),
        editor_schema_version: 1,
        snapshot_base64: "7ISk7KCV64W464q4".to_owned(),
        plain_text_recovery: "고대 봉인의 상세 노트".to_owned(),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    assert_eq!((saved.generation, saved.save_sequence), (7, 11));

    let hits = search_entities(SearchEntitiesParams {
        file_path: fixture.path.clone(),
        query: "봉인".to_owned(),
        offset: 0,
        limit: None,
    })
    .unwrap();
    assert_eq!(hits.total_matches, 1);
    assert_eq!(hits.hits[0].matched_fields, vec!["NOTE"]);
    let alias_hits = search_entities(SearchEntitiesParams {
        file_path: fixture.path.clone(),
        query: "마법사".to_owned(),
        offset: 0,
        limit: None,
    })
    .unwrap();
    assert_eq!(alias_hits.hits[0].matched_fields, vec!["ALIAS"]);

    let reopened = list_entities(ListEntitiesParams {
        file_path: fixture.path.clone(),
        query: None,
        kinds: vec![],
        statuses: vec![],
        tag_ids: vec![],
        sort: EntitySort::NameAsc,
    })
    .unwrap();
    assert_eq!(reopened.entities.len(), 9);
    assert_eq!(
        list_entity_tags(ListEntityTagsParams {
            file_path: fixture.path.clone(),
            entity_id: "entity-0".to_owned(),
        })
        .unwrap()
        .tags
        .len(),
        1
    );
    assert_eq!(
        load_entity_note(LoadEntityNoteParams {
            file_path: fixture.path,
            owner_kind: DocumentOwnerKind::Entity,
            owner_id: "entity-0".to_owned(),
        })
        .unwrap()
        .document
        .plain_text_recovery,
        "고대 봉인의 상세 노트"
    );
}

#[test]
fn relations_inverse_semantics_scene_links_mentions_and_delete_are_safe() {
    let (_directory, fixture) = fixture("relations.madi");
    create_test_entity(&fixture.path, "leia", EntityKind::Character, "레이아");
    create_test_entity(&fixture.path, "serina", EntityKind::Character, "세리나");
    create_test_entity(&fixture.path, "guild", EntityKind::Organization, "마법사단");

    let malformed = Connection::open(&fixture.path).unwrap();
    malformed
        .execute_batch("PRAGMA foreign_keys = OFF;")
        .unwrap();
    malformed
        .execute(
            "INSERT INTO projects VALUES ('external', '외부', NULL, ?1, ?1)",
            ["2026-08-02T00:00:00.000Z"],
        )
        .unwrap();
    malformed
        .execute(
            "INSERT INTO documents VALUES (
                'external-document', 'external', '외부', 'typie', 'test', 1,
                X'', '', ?1, ?1
             )",
            ["2026-08-02T00:00:00.000Z"],
        )
        .unwrap();
    malformed
        .execute(
            "INSERT INTO entities VALUES (
                'external-entity', 'external', 'OTHER', '외부', NULL,
                'external-document', 'ACTIVE', NULL, NULL, '{}', ?1, ?1
             )",
            ["2026-08-02T00:00:00.000Z"],
        )
        .unwrap();
    drop(malformed);
    assert!(create_entity_relation(CreateEntityRelationParams {
        file_path: fixture.path.clone(),
        source_entity_id: "leia".to_owned(),
        relation_type_id: format!("{}:builtin-related", fixture.project_id),
        target_entity_id: "external-entity".to_owned(),
        note: None,
        relation_id: None,
        expected_revision: None,
        saved_by: None,
    })
    .is_err());
    let cleanup = Connection::open(&fixture.path).unwrap();
    cleanup.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
    cleanup
        .execute("DELETE FROM entities WHERE id = 'external-entity'", [])
        .unwrap();
    cleanup
        .execute("DELETE FROM documents WHERE id = 'external-document'", [])
        .unwrap();
    cleanup
        .execute("DELETE FROM projects WHERE id = 'external'", [])
        .unwrap();
    drop(cleanup);
    create_entity_alias(CreateEntityAliasParams {
        file_path: fixture.path.clone(),
        entity_id: "leia".to_owned(),
        alias: "북부의 마법사".to_owned(),
        alias_id: None,
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    save_scene_text(
        &fixture,
        "레이아가 문을 열었다. 북부의 마법사는 레이아였다.",
    );
    let alias_scene = create_tree_node(CreateTreeNodeParams {
        file_path: fixture.path.clone(),
        parent_id: fixture.chapter_id.clone(),
        kind: NodeKind::Scene,
        title: "별칭 장면".to_owned(),
        node_id: Some("alias-scene".to_owned()),
        document_id: Some("alias-scene-document".to_owned()),
        editor_engine: Some("typie".to_owned()),
        editor_engine_commit: Some("test-commit".to_owned()),
        editor_schema_version: Some(1),
        before_node_id: None,
        after_node_id: Some(fixture.scene_id.clone()),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    save_scene(SaveSceneParams {
        file_path: fixture.path.clone(),
        scene_id: alias_scene.node.id,
        editor_engine: "typie".to_owned(),
        editor_engine_commit: "test-commit".to_owned(),
        editor_schema_version: 1,
        snapshot_base64: "YWxpYXM=".to_owned(),
        plain_text_recovery: "북부의 마법사가 돌아왔다.".to_owned(),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();

    let types = list_relation_types(ListRelationTypesParams {
        file_path: fixture.path.clone(),
    })
    .unwrap();
    let membership = types
        .relation_types
        .iter()
        .find(|item| item.name == "소속")
        .unwrap();
    let hostility = types
        .relation_types
        .iter()
        .find(|item| item.name == "적대")
        .unwrap();
    let custom_directed = create_relation_type(CreateRelationTypeParams {
        file_path: fixture.path.clone(),
        name: "관찰".to_owned(),
        inverse_name: None,
        directed: true,
        color_token: None,
        relation_type_id: Some("custom-directed".to_owned()),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    for (relation_id, source, target) in [
        ("directed-forward", "leia", "serina"),
        ("directed-reverse", "serina", "leia"),
    ] {
        create_entity_relation(CreateEntityRelationParams {
            file_path: fixture.path.clone(),
            source_entity_id: source.to_owned(),
            relation_type_id: custom_directed.relation_type.id.clone(),
            target_entity_id: target.to_owned(),
            note: None,
            relation_id: Some(relation_id.to_owned()),
            expected_revision: None,
            saved_by: None,
        })
        .unwrap();
    }
    for relation_id in ["directed-forward", "directed-reverse"] {
        delete_entity_relation(DeleteEntityRelationParams {
            file_path: fixture.path.clone(),
            relation_id: relation_id.to_owned(),
            expected_revision: None,
            saved_by: None,
        })
        .unwrap();
    }
    delete_relation_type(DeleteRelationTypeParams {
        file_path: fixture.path.clone(),
        relation_type_id: custom_directed.relation_type.id,
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    create_entity_relation(CreateEntityRelationParams {
        file_path: fixture.path.clone(),
        source_entity_id: "leia".to_owned(),
        relation_type_id: membership.id.clone(),
        target_entity_id: "guild".to_owned(),
        note: None,
        relation_id: Some("membership".to_owned()),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    create_entity_relation(CreateEntityRelationParams {
        file_path: fixture.path.clone(),
        source_entity_id: "leia".to_owned(),
        relation_type_id: hostility.id.clone(),
        target_entity_id: "serina".to_owned(),
        note: None,
        relation_id: Some("hostility".to_owned()),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    assert!(create_entity_relation(CreateEntityRelationParams {
        file_path: fixture.path.clone(),
        source_entity_id: "serina".to_owned(),
        relation_type_id: hostility.id.clone(),
        target_entity_id: "leia".to_owned(),
        note: None,
        relation_id: None,
        expected_revision: None,
        saved_by: None,
    })
    .is_err());
    let inverse = list_entity_relations(ListEntityRelationsParams {
        file_path: fixture.path.clone(),
        entity_id: Some("guild".to_owned()),
    })
    .unwrap();
    assert_eq!(inverse.relations[0].source_entity_id, "leia");
    assert_eq!(membership.inverse_name.as_deref(), Some("구성원을 가짐"));
    assert!(delete_relation_type(DeleteRelationTypeParams {
        file_path: fixture.path.clone(),
        relation_type_id: membership.id.clone(),
        expected_revision: None,
        saved_by: None,
    })
    .is_err());

    assert!(create_scene_entity_link(CreateSceneEntityLinkParams {
        file_path: fixture.path.clone(),
        scene_node_id: fixture.chapter_id.clone(),
        entity_id: "leia".to_owned(),
        role: SceneEntityRole::Pov,
        note: None,
        expected_revision: None,
        saved_by: None,
    })
    .is_err());
    create_scene_entity_link(CreateSceneEntityLinkParams {
        file_path: fixture.path.clone(),
        scene_node_id: fixture.scene_id.clone(),
        entity_id: "leia".to_owned(),
        role: SceneEntityRole::Pov,
        note: None,
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    let mentions = discover_entity_mentions(DiscoverEntityMentionsParams {
        file_path: fixture.path.clone(),
        entity_id: "leia".to_owned(),
        offset: 0,
        limit: None,
    })
    .unwrap();
    assert_eq!(mentions.total_scenes, 2);
    assert_eq!(mentions.candidates.len(), 2);
    assert_eq!(mentions.candidates[0].matched_alias, "레이아");
    assert!(mentions.candidates[0].already_linked);
    assert!(mentions
        .candidates
        .iter()
        .any(|candidate| candidate.matched_alias == "북부의 마법사"));
    assert_eq!(
        list_scene_entity_links(ListSceneEntityLinksParams {
            file_path: fixture.path.clone(),
            scene_node_id: None,
            entity_id: None,
        })
        .unwrap()
        .links
        .len(),
        1
    );

    let impact = get_entity_delete_impact(GetEntityDeleteImpactParams {
        file_path: fixture.path.clone(),
        entity_id: "leia".to_owned(),
    })
    .unwrap()
    .impact;
    assert_eq!(impact.relation_count, 2);
    assert_eq!(impact.scene_link_count, 1);
    assert_eq!(impact.mention_scene_count, 2);
    assert!(delete_entity(DeleteEntityParams {
        file_path: fixture.path.clone(),
        entity_id: "leia".to_owned(),
        confirmed: false,
        expected_revision: None,
        saved_by: None,
    })
    .is_err());
    let deleted = delete_entity(DeleteEntityParams {
        file_path: fixture.path.clone(),
        entity_id: "leia".to_owned(),
        confirmed: true,
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    assert_eq!(deleted.impact.relation_count, 2);
    assert!(load_entity_note(LoadEntityNoteParams {
        file_path: fixture.path.clone(),
        owner_kind: DocumentOwnerKind::Entity,
        owner_id: "leia".to_owned(),
    })
    .is_err());
    assert!(load_document(LoadDocumentParams {
        file_path: fixture.path.clone(),
        document_id: Some(deleted.deleted_document_id),
    })
    .is_err());
    assert!(list_entity_relations(ListEntityRelationsParams {
        file_path: fixture.path,
        entity_id: None,
    })
    .unwrap()
    .relations
    .is_empty());
}

#[test]
fn snapshot_v5_restores_story_data_and_v1_restore_clears_it_but_reseeds_builtins() {
    let (_directory, fixture) = fixture("snapshot-v2.madi");
    create_test_entity(&fixture.path, "leia", EntityKind::Character, "레이아");
    let note = load_entity_note(LoadEntityNoteParams {
        file_path: fixture.path.clone(),
        owner_kind: DocumentOwnerKind::Entity,
        owner_id: "leia".to_owned(),
    })
    .unwrap();
    save_entity_note(SaveEntityNoteParams {
        file_path: fixture.path.clone(),
        owner_kind: DocumentOwnerKind::Entity,
        owner_id: "leia".to_owned(),
        document_id: note.document_id,
        generation: 1,
        save_sequence: 1,
        editor_engine: "typie".to_owned(),
        editor_engine_commit: "test-commit".to_owned(),
        editor_schema_version: 1,
        snapshot_base64: "bm90ZQ==".to_owned(),
        plain_text_recovery: "원래 설정 노트".to_owned(),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    create_entity_alias(CreateEntityAliasParams {
        file_path: fixture.path.clone(),
        entity_id: "leia".to_owned(),
        alias: "북부   마법사".to_owned(),
        alias_id: Some("snapshot-alias".to_owned()),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    for (tag_id, name) in [
        ("snapshot-tag-change", "변경 전 태그"),
        ("snapshot-tag-delete", "삭제할 태그"),
    ] {
        create_tag(CreateTagParams {
            file_path: fixture.path.clone(),
            name: name.to_owned(),
            color_token: None,
            tag_id: Some(tag_id.to_owned()),
            expected_revision: None,
            saved_by: None,
        })
        .unwrap();
    }
    for (relation_type_id, name) in [
        ("snapshot-type-change", "변경 전 관계"),
        ("snapshot-type-delete", "삭제할 관계"),
    ] {
        create_relation_type(CreateRelationTypeParams {
            file_path: fixture.path.clone(),
            name: name.to_owned(),
            inverse_name: None,
            directed: false,
            color_token: None,
            relation_type_id: Some(relation_type_id.to_owned()),
            expected_revision: None,
            saved_by: None,
        })
        .unwrap();
    }
    let baseline = create_named_snapshot(CreateNamedSnapshotParams {
        file_path: fixture.path.clone(),
        name: "설정 기준".to_owned(),
        note: None,
        kind: NamedSnapshotKind::Manual,
        snapshot_id: Some("story-baseline".to_owned()),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    assert_eq!(baseline.snapshot.payload_version, 5);
    update_entity(UpdateEntityParams {
        file_path: fixture.path.clone(),
        entity_id: "leia".to_owned(),
        kind: EntityKind::Character,
        name: "레이아 변경".to_owned(),
        summary: None,
        status: EntityStatus::Archived,
        color_token: None,
        icon_key: None,
        attributes: json!({}),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    create_tag(CreateTagParams {
        file_path: fixture.path.clone(),
        name: "추가된 태그".to_owned(),
        color_token: None,
        tag_id: Some("snapshot-tag-added".to_owned()),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    update_tag(UpdateTagParams {
        file_path: fixture.path.clone(),
        tag_id: "snapshot-tag-change".to_owned(),
        name: "변경 후 태그".to_owned(),
        color_token: Some("amber".to_owned()),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    delete_tag(DeleteTagParams {
        file_path: fixture.path.clone(),
        tag_id: "snapshot-tag-delete".to_owned(),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    create_relation_type(CreateRelationTypeParams {
        file_path: fixture.path.clone(),
        name: "추가된 관계".to_owned(),
        inverse_name: None,
        directed: false,
        color_token: None,
        relation_type_id: Some("snapshot-type-added".to_owned()),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    update_relation_type(UpdateRelationTypeParams {
        file_path: fixture.path.clone(),
        relation_type_id: "snapshot-type-change".to_owned(),
        name: "변경 후 관계".to_owned(),
        inverse_name: Some("역관계".to_owned()),
        directed: true,
        color_token: Some("blue".to_owned()),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    delete_relation_type(DeleteRelationTypeParams {
        file_path: fixture.path.clone(),
        relation_type_id: "snapshot-type-delete".to_owned(),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    let diff = diff_named_snapshot(DiffNamedSnapshotParams {
        file_path: fixture.path.clone(),
        snapshot_id: "story-baseline".to_owned(),
    })
    .unwrap();
    assert_eq!(diff.summary.changed_entities, 1);
    assert_eq!(diff.summary.added_tags, 1);
    assert_eq!(diff.summary.deleted_tags, 1);
    assert_eq!(diff.summary.changed_tags, 1);
    assert_eq!(diff.summary.added_relation_types, 1);
    assert_eq!(diff.summary.deleted_relation_types, 1);
    assert_eq!(diff.summary.changed_relation_types, 1);
    restore_named_snapshot(RestoreNamedSnapshotParams {
        file_path: fixture.path.clone(),
        snapshot_id: "story-baseline".to_owned(),
        auto_snapshot_name: None,
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    assert_eq!(
        list_entities(ListEntitiesParams {
            file_path: fixture.path.clone(),
            query: None,
            kinds: vec![],
            statuses: vec![],
            tag_ids: vec![],
            sort: EntitySort::NameAsc,
        })
        .unwrap()
        .entities[0]
            .name,
        "레이아"
    );
    assert_eq!(
        load_entity_note(LoadEntityNoteParams {
            file_path: fixture.path.clone(),
            owner_kind: DocumentOwnerKind::Entity,
            owner_id: "leia".to_owned(),
        })
        .unwrap()
        .document
        .plain_text_recovery,
        "원래 설정 노트"
    );

    let connection = Connection::open(&fixture.path).unwrap();
    let blob: Vec<u8> = connection
        .query_row(
            "SELECT payload_blob FROM named_snapshots WHERE id = 'story-baseline'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let original_payload: serde_json::Value = serde_json::from_slice(&blob).unwrap();
    let mut legacy_v2_payload = original_payload.clone();
    legacy_v2_payload["version"] = json!(2);
    legacy_v2_payload
        .as_object_mut()
        .unwrap()
        .remove("canvases");
    legacy_v2_payload
        .as_object_mut()
        .unwrap()
        .remove("reader_presets");
    for key in [
        "publication_metadata",
        "publication_assets",
        "export_presets",
    ] {
        legacy_v2_payload.as_object_mut().unwrap().remove(key);
    }
    let mut insert_failure_payload = legacy_v2_payload.clone();
    let duplicate_tag = {
        let tags = insert_failure_payload["tags"].as_array().unwrap();
        let mut duplicate = tags[0].clone();
        duplicate["id"] = json!("snapshot-tag-duplicate-name");
        duplicate
    };
    insert_failure_payload["tags"]
        .as_array_mut()
        .unwrap()
        .push(duplicate_tag);
    let insert_failure_blob = serde_json::to_vec(&insert_failure_payload).unwrap();
    let insert_failure_hash = format!("{:x}", Sha256::digest(&insert_failure_blob));
    connection
        .execute(
            "INSERT INTO named_snapshots (
                id, project_id, name, note, kind, payload_format, payload_version,
                payload_blob, content_hash, created_at, updated_at
             ) SELECT 'insert-failure-v2', project_id, 'INSERT 실패', NULL, 'MANUAL',
                      payload_format, 2, ?1, ?2, created_at, updated_at
               FROM named_snapshots WHERE id = 'story-baseline'",
            params![insert_failure_blob, insert_failure_hash],
        )
        .unwrap();
    let mut invalid_alias_payload = legacy_v2_payload.clone();
    invalid_alias_payload["entity_aliases"][0]["normalized_alias"] = json!("위조 별칭");
    let invalid_alias_blob = serde_json::to_vec(&invalid_alias_payload).unwrap();
    let invalid_alias_hash = format!("{:x}", Sha256::digest(&invalid_alias_blob));
    connection
        .execute(
            "INSERT INTO named_snapshots (
                id, project_id, name, note, kind, payload_format, payload_version,
                payload_blob, content_hash, created_at, updated_at
             ) SELECT 'invalid-alias-v2', project_id, '별칭 위조', NULL, 'MANUAL',
                      payload_format, 2, ?1, ?2, created_at, updated_at
               FROM named_snapshots WHERE id = 'story-baseline'",
            params![invalid_alias_blob, invalid_alias_hash],
        )
        .unwrap();
    let mut invalid_builtin_payload = legacy_v2_payload;
    let builtin = invalid_builtin_payload["relation_types"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|relation_type| {
            relation_type["id"]
                .as_str()
                .is_some_and(|id| id.ends_with(":builtin-related"))
        })
        .unwrap();
    builtin["is_builtin"] = json!(false);
    let invalid_builtin_blob = serde_json::to_vec(&invalid_builtin_payload).unwrap();
    let invalid_builtin_hash = format!("{:x}", Sha256::digest(&invalid_builtin_blob));
    connection
        .execute(
            "INSERT INTO named_snapshots (
                id, project_id, name, note, kind, payload_format, payload_version,
                payload_blob, content_hash, created_at, updated_at
             ) SELECT 'invalid-builtin-v2', project_id, 'builtin 위조', NULL, 'MANUAL',
                      payload_format, 2, ?1, ?2, created_at, updated_at
               FROM named_snapshots WHERE id = 'story-baseline'",
            params![invalid_builtin_blob, invalid_builtin_hash],
        )
        .unwrap();
    let mut forged_payload = original_payload.clone();
    forged_payload["version"] = json!(1);
    let forged_blob = serde_json::to_vec(&forged_payload).unwrap();
    let forged_hash = format!("{:x}", Sha256::digest(&forged_blob));
    connection
        .execute(
            "INSERT INTO named_snapshots (
                id, project_id, name, note, kind, payload_format, payload_version,
                payload_blob, content_hash, created_at, updated_at
             ) SELECT 'forged-v1', project_id, '위장 구버전', NULL, 'MANUAL',
                      payload_format, 1, ?1, ?2, created_at, updated_at
               FROM named_snapshots WHERE id = 'story-baseline'",
            params![forged_blob, forged_hash],
        )
        .unwrap();
    drop(connection);
    let before_insert_failure_revision = open_project(OpenProjectParams {
        file_path: fixture.path.clone(),
    })
    .unwrap()
    .metadata
    .revision;
    let before_insert_failure_entities = list_entities(ListEntitiesParams {
        file_path: fixture.path.clone(),
        query: None,
        kinds: vec![],
        statuses: vec![],
        tag_ids: vec![],
        sort: EntitySort::NameAsc,
    })
    .unwrap();
    let before_insert_failure_tags = list_tags(ListTagsParams {
        file_path: fixture.path.clone(),
    })
    .unwrap();
    let before_failed_restore = list_named_snapshots(ListNamedSnapshotsParams {
        file_path: fixture.path.clone(),
    })
    .unwrap()
    .snapshots
    .len();
    assert!(restore_named_snapshot(RestoreNamedSnapshotParams {
        file_path: fixture.path.clone(),
        snapshot_id: "insert-failure-v2".to_owned(),
        auto_snapshot_name: None,
        expected_revision: None,
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
        before_insert_failure_revision
    );
    assert_eq!(
        list_named_snapshots(ListNamedSnapshotsParams {
            file_path: fixture.path.clone(),
        })
        .unwrap()
        .snapshots
        .len(),
        before_failed_restore
    );
    assert_eq!(
        list_entities(ListEntitiesParams {
            file_path: fixture.path.clone(),
            query: None,
            kinds: vec![],
            statuses: vec![],
            tag_ids: vec![],
            sort: EntitySort::NameAsc,
        })
        .unwrap(),
        before_insert_failure_entities
    );
    assert_eq!(
        list_tags(ListTagsParams {
            file_path: fixture.path.clone(),
        })
        .unwrap(),
        before_insert_failure_tags
    );
    for invalid_snapshot_id in ["invalid-alias-v2", "invalid-builtin-v2"] {
        assert!(restore_named_snapshot(RestoreNamedSnapshotParams {
            file_path: fixture.path.clone(),
            snapshot_id: invalid_snapshot_id.to_owned(),
            auto_snapshot_name: None,
            expected_revision: None,
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
            before_insert_failure_revision
        );
        assert_eq!(
            list_named_snapshots(ListNamedSnapshotsParams {
                file_path: fixture.path.clone(),
            })
            .unwrap()
            .snapshots
            .len(),
            before_failed_restore
        );
    }
    assert!(restore_named_snapshot(RestoreNamedSnapshotParams {
        file_path: fixture.path.clone(),
        snapshot_id: "forged-v1".to_owned(),
        auto_snapshot_name: None,
        expected_revision: None,
        saved_by: None,
    })
    .is_err());
    assert_eq!(
        list_named_snapshots(ListNamedSnapshotsParams {
            file_path: fixture.path.clone(),
        })
        .unwrap()
        .snapshots
        .len(),
        before_failed_restore
    );

    let connection = Connection::open(&fixture.path).unwrap();
    let mut payload = original_payload;
    payload["version"] = json!(1);
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
        "publication_metadata",
        "publication_assets",
        "export_presets",
    ] {
        payload.as_object_mut().unwrap().remove(key);
    }
    let scene_document_id = payload["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|node| node["kind"] == "SCENE")
        .unwrap()["document_id"]
        .as_str()
        .unwrap()
        .to_owned();
    payload["documents"]
        .as_array_mut()
        .unwrap()
        .retain(|document| document["id"] == scene_document_id);
    let v1_blob = serde_json::to_vec(&payload).unwrap();
    let hash = format!("{:x}", Sha256::digest(&v1_blob));
    connection
        .execute(
            "INSERT INTO named_snapshots (
                id, project_id, name, note, kind, payload_format, payload_version,
                payload_blob, content_hash, created_at, updated_at
             ) SELECT 'legacy-v1', project_id, '구버전', NULL, 'MANUAL',
                      payload_format, 1, ?1, ?2, created_at, updated_at
               FROM named_snapshots WHERE id = 'story-baseline'",
            params![v1_blob, hash],
        )
        .unwrap();
    drop(connection);

    create_canvas(CreateCanvasParams {
        file_path: fixture.path.clone(),
        canvas_id: Some("legacy-restore-canvas".to_owned()),
        name: "구버전 복원 전 캔버스".to_owned(),
        description: None,
        document: MadiCanvasDocument::default(),
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();

    restore_named_snapshot(RestoreNamedSnapshotParams {
        file_path: fixture.path.clone(),
        snapshot_id: "legacy-v1".to_owned(),
        auto_snapshot_name: None,
        expected_revision: None,
        saved_by: None,
    })
    .unwrap();
    assert!(list_entities(ListEntitiesParams {
        file_path: fixture.path.clone(),
        query: None,
        kinds: vec![],
        statuses: vec![],
        tag_ids: vec![],
        sort: EntitySort::NameAsc,
    })
    .unwrap()
    .entities
    .is_empty());
    assert!(list_canvases(ListCanvasesParams {
        file_path: fixture.path.clone(),
        sort: CanvasSort::UpdatedDesc,
    })
    .unwrap()
    .canvases
    .is_empty());
    assert_eq!(
        list_relation_types(ListRelationTypesParams {
            file_path: fixture.path,
        })
        .unwrap()
        .relation_types
        .len(),
        10
    );
}

#[test]
fn performance_fixture_handles_500_entities_1500_aliases_2000_relations_and_links() {
    let (_directory, fixture) = fixture("performance.madi");
    let mut connection = Connection::open(&fixture.path).unwrap();
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .unwrap();
    let transaction = connection.transaction().unwrap();
    let now = "2026-08-02T00:00:00.000Z";
    for index in 0..500 {
        let entity_id = format!("perf-entity-{index:03}");
        let document_id = format!("perf-document-{index:03}");
        transaction
            .execute(
                "INSERT INTO documents (
                    id, project_id, title, editor_engine, editor_engine_commit,
                    editor_schema_version, snapshot_blob, plain_text_recovery,
                    created_at, updated_at
                 ) VALUES (?1, ?2, ?3, 'typie', 'test', 1, X'', '', ?4, ?4)",
                params![document_id, fixture.project_id, entity_id, now],
            )
            .unwrap();
        transaction
            .execute(
                "INSERT INTO entities (
                    id, project_id, kind, name, summary, document_id, status,
                    color_token, icon_key, attributes_json, created_at, updated_at
                 ) VALUES (?1, ?2, 'CHARACTER', ?3, NULL, ?4, 'ACTIVE',
                           NULL, NULL, '{}', ?5, ?5)",
                params![
                    entity_id,
                    fixture.project_id,
                    format!("인물 {index:03}"),
                    document_id,
                    now
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
                        format!("perf-alias-{index:03}-{alias_index}"),
                        entity_id,
                        format!("별칭 {index:03} {alias_index}"),
                        now
                    ],
                )
                .unwrap();
        }
    }
    let relation_type_id = format!("{}:builtin-membership", fixture.project_id);
    for source in 0..500 {
        for step in 1..=4 {
            let target = (source + step) % 500;
            transaction
                .execute(
                    "INSERT INTO entity_relations (
                        id, project_id, source_entity_id, relation_type_id,
                        target_entity_id, note, created_at, updated_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?6)",
                    params![
                        format!("perf-relation-{source:03}-{step}"),
                        fixture.project_id,
                        format!("perf-entity-{source:03}"),
                        relation_type_id,
                        format!("perf-entity-{target:03}"),
                        now
                    ],
                )
                .unwrap();
        }
    }
    for entity in 0..500 {
        for role in ["APPEARS", "POV", "MENTIONED", "RELATED"] {
            transaction
                .execute(
                    "INSERT INTO scene_entity_links (
                        scene_node_id, entity_id, role, note, created_at
                     ) VALUES (?1, ?2, ?3, NULL, ?4)",
                    params![
                        fixture.scene_id,
                        format!("perf-entity-{entity:03}"),
                        role,
                        now
                    ],
                )
                .unwrap();
        }
    }
    transaction.commit().unwrap();
    drop(connection);

    let started = Instant::now();
    assert_eq!(
        list_entities(ListEntitiesParams {
            file_path: fixture.path.clone(),
            query: None,
            kinds: vec![],
            statuses: vec![],
            tag_ids: vec![],
            sort: EntitySort::NameAsc,
        })
        .unwrap()
        .entities
        .len(),
        500
    );
    assert_eq!(
        list_entity_relations(ListEntityRelationsParams {
            file_path: fixture.path.clone(),
            entity_id: None,
        })
        .unwrap()
        .relations
        .len(),
        2_000
    );
    assert_eq!(
        search_entities(SearchEntitiesParams {
            file_path: fixture.path.clone(),
            query: "별칭 499 2".to_owned(),
            offset: 0,
            limit: Some(10),
        })
        .unwrap()
        .total_matches,
        1
    );
    assert_eq!(
        open_project(OpenProjectParams {
            file_path: fixture.path.clone(),
        })
        .unwrap()
        .metadata
        .schema_version,
        SCHEMA_VERSION
    );
    assert_eq!(
        list_scene_entity_links(ListSceneEntityLinksParams {
            file_path: fixture.path.clone(),
            scene_node_id: None,
            entity_id: None,
        })
        .unwrap()
        .links
        .len(),
        2_000
    );
    assert!(started.elapsed().as_secs() < 30);
}
