use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use editor_codec::{encode_changesets, ReencodableChangesets};
use editor_model::{
    HorizontalRuleVariant, Modifier, PlainBlockquoteNode, PlainDoc, PlainHorizontalRuleNode,
    PlainNode, PlainNodeEntry, PlainParagraphNode, PlainRootNode, PlainTextNode,
};
use editor_state::{prose_annotated, State};
use madi_core::{
    compile_publication_scope, create_project, load_project_tree, CompilePublicationParams,
    CreateProjectParams, LoadProjectTreeParams, NodeKind,
};
use madi_publication::{
    decode_typie_snapshot, MadiSemanticBlock, MadiSemanticInline, PublicationBlock,
    PublicationInline, PINNED_TYPIE_COMMIT,
};
use rusqlite::{params, Connection, Transaction};

const FIXED_TIMESTAMP: &str = "2026-08-09T00:00:00.000Z";
const SEMANTIC_BLOCKS_PER_SCENE: usize = 4;

#[derive(Clone, Copy)]
struct FixtureSpec {
    label: &'static str,
    volumes: usize,
    chapters: usize,
    scenes: usize,
    text_characters_per_scene: usize,
}

impl FixtureSpec {
    fn project_id(self) -> String {
        format!("phase1f-{}-project", self.label)
    }

    fn work_id(self) -> String {
        format!("phase1f-{}-work", self.label)
    }

    fn expected_blocks(self) -> usize {
        SEMANTIC_BLOCKS_PER_SCENE * self.scenes + 1 + self.volumes + self.chapters + self.scenes
    }
}

fn entry(node: PlainNode, children: Vec<PlainNodeEntry>) -> PlainNodeEntry {
    PlainNodeEntry {
        node,
        modifiers: BTreeMap::new(),
        carry: Vec::new(),
        children,
    }
}

fn paragraph(text: String) -> PlainNodeEntry {
    entry(
        PlainNode::Paragraph(PlainParagraphNode {}),
        if text.is_empty() {
            Vec::new()
        } else {
            vec![entry(PlainNode::Text(PlainTextNode { text }), Vec::new())]
        },
    )
}

fn text_with_modifier(text: String, modifier: Modifier) -> PlainNodeEntry {
    entry_with_modifiers(
        PlainNode::Text(PlainTextNode { text }),
        BTreeMap::from([(modifier.as_type(), modifier)]),
        Vec::new(),
    )
}

fn entry_with_modifiers(
    node: PlainNode,
    modifiers: BTreeMap<editor_model::ModifierType, Modifier>,
    children: Vec<PlainNodeEntry>,
) -> PlainNodeEntry {
    PlainNodeEntry {
        node,
        modifiers,
        carry: Vec::new(),
        children,
    }
}

fn rich_paragraph(text: String) -> PlainNodeEntry {
    let mut characters = text.chars();
    let modifiers = [
        Modifier::Bold,
        Modifier::Italic,
        Modifier::Underline,
        Modifier::Strikethrough,
        Modifier::Ruby {
            text: "루비".to_owned(),
        },
    ];
    let mut children = modifiers
        .into_iter()
        .map(|modifier| {
            text_with_modifier(
                characters
                    .next()
                    .expect("rich fixture text must have at least five characters")
                    .to_string(),
                modifier,
            )
        })
        .collect::<Vec<_>>();
    let remainder = characters.collect::<String>();
    if !remainder.is_empty() {
        children.push(entry(
            PlainNode::Text(PlainTextNode { text: remainder }),
            Vec::new(),
        ));
    }
    entry(PlainNode::Paragraph(PlainParagraphNode {}), children)
}

fn deterministic_text(character_count: usize) -> String {
    const PREFIX: &str = "한국어검증 <script>alert('&')</script> EPUB XML & < > ";
    const PATTERN: &[char] = &['가', '나', '다', '라', ' '];
    PREFIX
        .chars()
        .chain((0..character_count).map(|index| PATTERN[index % PATTERN.len()]))
        .take(character_count)
        .collect()
}

fn reusable_snapshot(character_count: usize) -> (Vec<u8>, String) {
    let first_count = character_count / 2;
    let first = deterministic_text(first_count);
    let second = deterministic_text(character_count - first_count);
    let document = PlainDoc {
        root: entry(
            PlainNode::Root(PlainRootNode::default()),
            vec![
                rich_paragraph(first),
                paragraph(String::new()),
                entry(
                    PlainNode::HorizontalRule(PlainHorizontalRuleNode {
                        variant: HorizontalRuleVariant::ThreeDiamonds,
                    }),
                    Vec::new(),
                ),
                entry(
                    PlainNode::Blockquote(PlainBlockquoteNode::default()),
                    vec![paragraph(second)],
                ),
            ],
        ),
    };
    let state = State::from_plain(&document).unwrap();
    let recovery = prose_annotated(&state.view()).text().to_owned();
    let snapshot = encode_changesets(ReencodableChangesets::from_local_ops(
        state.graph().changesets_as_vec(),
    ))
    .unwrap();
    (snapshot, recovery)
}

fn contains_inline_kind(
    inlines: &[PublicationInline],
    predicate: fn(&PublicationInline) -> bool,
) -> bool {
    inlines.iter().any(|inline| {
        predicate(inline)
            || match inline {
                PublicationInline::Text { .. } => false,
                PublicationInline::Strong { children }
                | PublicationInline::Emphasis { children }
                | PublicationInline::Underline { children }
                | PublicationInline::Strike { children }
                | PublicationInline::Ruby { children, .. } => {
                    contains_inline_kind(children, predicate)
                }
            }
    })
}

fn contains_semantic_inline_kind(
    inlines: &[MadiSemanticInline],
    predicate: fn(&MadiSemanticInline) -> bool,
) -> bool {
    inlines.iter().any(|inline| {
        predicate(inline)
            || match inline {
                MadiSemanticInline::Text { .. } => false,
                MadiSemanticInline::Strong { children }
                | MadiSemanticInline::Emphasis { children }
                | MadiSemanticInline::Underline { children }
                | MadiSemanticInline::Strike { children }
                | MadiSemanticInline::Ruby { children, .. } => {
                    contains_semantic_inline_kind(children, predicate)
                }
            }
    })
}

#[test]
fn reusable_reader_fixture_snapshot_contains_export_semantics_and_xml_special_korean() {
    let (snapshot, recovery) = reusable_snapshot(1_500);
    let decoded = decode_typie_snapshot("phase1f-rich-fixture-document", &snapshot).unwrap();
    let rich = decoded
        .blocks
        .iter()
        .find_map(|block| match block {
            MadiSemanticBlock::Paragraph { inlines, .. }
                if contains_semantic_inline_kind(inlines, |inline| {
                    matches!(inline, MadiSemanticInline::Strong { .. })
                }) =>
            {
                Some(inlines.as_slice())
            }
            _ => None,
        })
        .expect("fixture snapshot must decode a rich paragraph");
    for predicate in [
        (|inline| matches!(inline, MadiSemanticInline::Strong { .. }))
            as fn(&MadiSemanticInline) -> bool,
        |inline| matches!(inline, MadiSemanticInline::Emphasis { .. }),
        |inline| matches!(inline, MadiSemanticInline::Underline { .. }),
        |inline| matches!(inline, MadiSemanticInline::Strike { .. }),
        |inline| matches!(inline, MadiSemanticInline::Ruby { .. }),
    ] {
        assert!(contains_semantic_inline_kind(rich, predicate));
    }
    assert!(decoded
        .blocks
        .iter()
        .any(|block| matches!(block, MadiSemanticBlock::Quote { .. })));
    assert!(decoded
        .blocks
        .iter()
        .any(|block| matches!(block, MadiSemanticBlock::SceneBreak { .. })));
    assert!(recovery.contains("한국어검증"));
    assert!(recovery.contains("<script>alert('&')</script>"));
}

fn insert_node(
    transaction: &Transaction<'_>,
    project_id: &str,
    id: &str,
    parent_id: Option<&str>,
    kind: NodeKind,
    title: &str,
    order_key: f64,
    document_id: Option<&str>,
) {
    transaction
        .execute(
            "INSERT INTO tree_nodes (
                id, project_id, parent_id, kind, title, order_key, document_id,
                created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![
                id,
                project_id,
                parent_id,
                kind.as_str(),
                title,
                order_key,
                document_id,
                FIXED_TIMESTAMP,
            ],
        )
        .unwrap();
}

fn seed_fixture(path: &Path, spec: FixtureSpec) {
    assert!(!path.exists(), "fixture destination must not already exist");
    let project_id = spec.project_id();
    create_project(CreateProjectParams {
        file_path: path.to_path_buf(),
        title: format!("Phase1F {} work", spec.label),
        created_by: Some("phase1f-fixture".to_owned()),
        author_name: Some("Phase1F".to_owned()),
        project_id: Some(project_id.clone()),
        document_id: Some(format!("phase1f-{}-bootstrap-document", spec.label)),
        document_title: Some("Bootstrap".to_owned()),
        editor_engine: Some("typie".to_owned()),
        editor_engine_commit: Some(PINNED_TYPIE_COMMIT.to_owned()),
        editor_schema_version: Some(1),
    })
    .unwrap();
    let (snapshot, recovery) = reusable_snapshot(spec.text_characters_per_scene);
    let mut connection = Connection::open(path).unwrap();
    connection
        .pragma_update(None, "foreign_keys", true)
        .unwrap();
    let transaction = connection.transaction().unwrap();
    transaction.execute("DELETE FROM tree_nodes", []).unwrap();
    transaction
        .execute("DELETE FROM search_documents", [])
        .unwrap();
    transaction.execute("DELETE FROM documents", []).unwrap();
    transaction
        .execute(
            "UPDATE app_meta
             SET created_by = 'phase1f-fixture', last_saved_by = 'phase1f-fixture',
                 title = ?1, created_at = ?2, updated_at = ?2, revision = 1
             WHERE singleton = 1",
            params![format!("Phase1F {} work", spec.label), FIXED_TIMESTAMP],
        )
        .unwrap();
    transaction
        .execute(
            "UPDATE projects
             SET title = ?1, author_name = 'Phase1F', created_at = ?2, updated_at = ?2
             WHERE id = ?3",
            params![
                format!("Phase1F {} work", spec.label),
                FIXED_TIMESTAMP,
                project_id
            ],
        )
        .unwrap();
    transaction
        .execute(
            "UPDATE schema_migrations SET applied_at = ?1",
            [FIXED_TIMESTAMP],
        )
        .unwrap();

    let work_id = spec.work_id();
    insert_node(
        &transaction,
        &project_id,
        &work_id,
        None,
        NodeKind::Work,
        "Work",
        0.0,
        None,
    );
    let chapters_per_volume = spec.chapters / spec.volumes;
    let scenes_per_chapter = spec.scenes / spec.chapters;
    assert_eq!(chapters_per_volume * spec.volumes, spec.chapters);
    assert_eq!(scenes_per_chapter * spec.chapters, spec.scenes);
    let mut global_chapter = 0usize;
    let mut global_scene = 0usize;
    for volume_index in 0..spec.volumes {
        let volume_id = format!("phase1f-{}-volume-{volume_index:03}", spec.label);
        insert_node(
            &transaction,
            &project_id,
            &volume_id,
            Some(&work_id),
            NodeKind::Volume,
            &format!("Volume {volume_index:03}"),
            volume_index as f64,
            None,
        );
        for local_chapter in 0..chapters_per_volume {
            let chapter_index = global_chapter;
            global_chapter += 1;
            let chapter_id = format!("phase1f-{}-chapter-{chapter_index:03}", spec.label);
            insert_node(
                &transaction,
                &project_id,
                &chapter_id,
                Some(&volume_id),
                NodeKind::Chapter,
                &format!("Chapter {chapter_index:03}"),
                local_chapter as f64,
                None,
            );
            for local_scene in 0..scenes_per_chapter {
                let scene_index = global_scene;
                global_scene += 1;
                let scene_id = format!("phase1f-{}-scene-{scene_index:03}", spec.label);
                let document_id = format!("phase1f-{}-document-{scene_index:03}", spec.label);
                let title = format!("Scene {scene_index:03}");
                transaction
                    .execute(
                        "INSERT INTO documents (
                            id, project_id, title, editor_engine, editor_engine_commit,
                            editor_schema_version, snapshot_blob, plain_text_recovery,
                            created_at, updated_at
                         ) VALUES (?1, ?2, ?3, 'typie', ?4, 1, ?5, ?6, ?7, ?7)",
                        params![
                            document_id,
                            project_id,
                            title,
                            PINNED_TYPIE_COMMIT,
                            snapshot,
                            recovery,
                            FIXED_TIMESTAMP,
                        ],
                    )
                    .unwrap();
                insert_node(
                    &transaction,
                    &project_id,
                    &scene_id,
                    Some(&chapter_id),
                    NodeKind::Scene,
                    &title,
                    local_scene as f64,
                    Some(&document_id),
                );
            }
        }
    }
    assert_eq!(global_chapter, spec.chapters);
    assert_eq!(global_scene, spec.scenes);
    transaction.commit().unwrap();
    connection.execute_batch("VACUUM;").unwrap();
    drop(connection);

    let tree = load_project_tree(LoadProjectTreeParams {
        file_path: path.to_path_buf(),
    })
    .unwrap();
    assert_eq!(
        tree.nodes
            .iter()
            .filter(|node| node.kind == NodeKind::Volume)
            .count(),
        spec.volumes
    );
    assert_eq!(
        tree.nodes
            .iter()
            .filter(|node| node.kind == NodeKind::Chapter)
            .count(),
        spec.chapters
    );
    assert_eq!(
        tree.nodes
            .iter()
            .filter(|node| node.kind == NodeKind::Scene)
            .count(),
        spec.scenes
    );
    let compiled = compile_publication_scope(CompilePublicationParams {
        file_path: path.to_path_buf(),
        scope_node_id: format!("phase1f-{}-scene-000", spec.label),
        expected_revision: 1,
    })
    .unwrap();
    assert_eq!(compiled.document.sections.len(), 1);
    assert_eq!(compiled.document.stats.scene_count, 1);
    assert_eq!(compiled.document.stats.chapter_count, 1);
    assert_eq!(compiled.document.stats.paragraph_count, 3);
    assert_eq!(
        compiled.document.stats.with_spaces,
        spec.text_characters_per_scene as u64
    );
    assert_eq!(
        compiled
            .document
            .sections
            .iter()
            .map(|section| section.blocks.len())
            .sum::<usize>(),
        8
    );
    let blocks = compiled
        .document
        .sections
        .iter()
        .flat_map(|section| section.blocks.iter())
        .collect::<Vec<_>>();
    let rich = blocks
        .iter()
        .find_map(|block| match block {
            PublicationBlock::Paragraph { inlines, .. }
                if contains_inline_kind(inlines, |inline| {
                    matches!(inline, PublicationInline::Strong { .. })
                }) =>
            {
                Some(inlines.as_slice())
            }
            _ => None,
        })
        .expect("fixture must expose rich inline semantics through Publication IR");
    for predicate in [
        (|inline| matches!(inline, PublicationInline::Strong { .. }))
            as fn(&PublicationInline) -> bool,
        |inline| matches!(inline, PublicationInline::Emphasis { .. }),
        |inline| matches!(inline, PublicationInline::Underline { .. }),
        |inline| matches!(inline, PublicationInline::Strike { .. }),
        |inline| matches!(inline, PublicationInline::Ruby { .. }),
    ] {
        assert!(contains_inline_kind(rich, predicate));
    }
    assert!(blocks
        .iter()
        .any(|block| matches!(block, PublicationBlock::Quote { .. })));
    assert!(blocks
        .iter()
        .any(|block| matches!(block, PublicationBlock::SceneBreak { .. })));
}

#[test]
fn export_phase1f_reader_fixtures_when_requested() {
    let Some(directory) = std::env::var_os("MADI_PHASE1F_READER_FIXTURE_DIRECTORY") else {
        return;
    };
    let directory = PathBuf::from(directory);
    assert!(
        directory.is_absolute(),
        "fixture directory must be absolute"
    );
    assert!(directory.is_dir(), "fixture directory must already exist");
    let specifications = [
        FixtureSpec {
            label: "normal",
            volumes: 2,
            chapters: 20,
            scenes: 60,
            text_characters_per_scene: 3_000,
        },
        FixtureSpec {
            label: "long",
            volumes: 10,
            chapters: 150,
            scenes: 450,
            text_characters_per_scene: 1_500,
        },
    ];
    for spec in specifications {
        let path = directory.join(format!("phase1f-reader-{}.madi", spec.label));
        seed_fixture(&path, spec);
        println!(
            "PHASE1F_READER_FIXTURE label={} volumes={} chapters={} scenes={} characters={} blocks={} revision=1 bytes={}",
            spec.label,
            spec.volumes,
            spec.chapters,
            spec.scenes,
            spec.scenes * spec.text_characters_per_scene,
            spec.expected_blocks(),
            std::fs::metadata(path).unwrap().len(),
        );
    }
}
