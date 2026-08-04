use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::typie_bridge::MadiSemanticDiagnosticCode;
use crate::{
    MadiSemanticBlock, MadiSemanticInline, PUBLICATION_DOCUMENT_FORMAT_VERSION, PublicationError,
    Result, decode_typie_snapshot,
};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_SECTIONS: usize = 20_000;
const MAX_BLOCKS_PER_SECTION: usize = 100_000;
const MAX_BLOCKS: usize = 250_000;
const MAX_INLINE_NODES: usize = 1_000_000;
const MAX_INLINE_CHILDREN: usize = 100_000;
const MAX_TEXT_CHARACTERS: usize = 10_000_000;
const MAX_ID_CHARACTERS: usize = 256;
const MAX_TITLE_CHARACTERS: usize = 1_000;
const MAX_NODE_TYPE_CHARACTERS: usize = 256;
const MAX_PARENT_TITLES: usize = 64;
const MAX_INLINE_DEPTH: usize = 16;

#[derive(Default)]
struct ValidationBudget {
    blocks: usize,
    inline_nodes: usize,
    text_characters: usize,
}

fn bounded_string(value: &str, maximum: usize, allow_empty: bool) -> bool {
    (allow_empty || !value.is_empty()) && value.encode_utf16().count() <= maximum
}

fn consume_text(
    budget: &mut ValidationBudget,
    value: &str,
    maximum: usize,
    allow_empty: bool,
) -> bool {
    if !bounded_string(value, maximum, allow_empty) {
        return false;
    }
    let count = value.encode_utf16().count();
    let Some(total) = budget.text_characters.checked_add(count) else {
        return false;
    };
    budget.text_characters = total;
    total <= MAX_TEXT_CHARACTERS
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PublicationScopeKind {
    Work,
    Volume,
    Chapter,
    Scene,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HeadingInput {
    pub source_node_id: String,
    pub level: u8,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SceneInput {
    pub scene_node_id: String,
    pub document_id: String,
    pub title: String,
    pub parent_titles: Vec<String>,
    pub headings: Vec<HeadingInput>,
    pub snapshot: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompileInput {
    pub project_id: String,
    pub project_revision: i64,
    pub scope_node_id: String,
    pub scope_kind: PublicationScopeKind,
    pub title: String,
    pub author_name: Option<String>,
    pub chapter_count: u64,
    pub scenes: Vec<SceneInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationSourceReference {
    pub source_node_id: String,
    pub scene_node_id: String,
    pub document_id: String,
    pub block_id: String,
    pub start: Option<u64>,
    pub end: Option<u64>,
    pub range_verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PublicationInline {
    Text {
        text: String,
    },
    Strong {
        children: Vec<PublicationInline>,
    },
    Emphasis {
        children: Vec<PublicationInline>,
    },
    Underline {
        children: Vec<PublicationInline>,
    },
    Strike {
        children: Vec<PublicationInline>,
    },
    Ruby {
        annotation: String,
        children: Vec<PublicationInline>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PublicationBlock {
    Heading {
        id: String,
        level: u8,
        text: String,
        source: PublicationSourceReference,
    },
    Paragraph {
        id: String,
        inlines: Vec<PublicationInline>,
        source: PublicationSourceReference,
    },
    SceneBreak {
        id: String,
        source: PublicationSourceReference,
    },
    Quote {
        id: String,
        inlines: Vec<PublicationInline>,
        source: PublicationSourceReference,
    },
    Unsupported {
        id: String,
        node_type: String,
        text: String,
        source: PublicationSourceReference,
    },
}

impl PublicationBlock {
    fn id(&self) -> &str {
        match self {
            Self::Heading { id, .. }
            | Self::Paragraph { id, .. }
            | Self::SceneBreak { id, .. }
            | Self::Quote { id, .. }
            | Self::Unsupported { id, .. } => id,
        }
    }

    fn source(&self) -> &PublicationSourceReference {
        match self {
            Self::Heading { source, .. }
            | Self::Paragraph { source, .. }
            | Self::SceneBreak { source, .. }
            | Self::Quote { source, .. }
            | Self::Unsupported { source, .. } => source,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationSection {
    pub id: String,
    pub source_node_id: String,
    pub kind: PublicationSectionKind,
    pub title: String,
    pub parent_titles: Vec<String>,
    pub blocks: Vec<PublicationBlock>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PublicationSectionKind {
    Scene,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationMetadata {
    pub title: String,
    pub author_name: Option<String>,
    pub language: PublicationLanguage,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum PublicationLanguage {
    #[serde(rename = "ko")]
    Korean,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationSourceStatistics {
    pub with_spaces: u64,
    pub without_spaces: u64,
    pub paragraph_count: u64,
    pub scene_count: u64,
    pub chapter_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationDocument {
    pub format_version: i64,
    pub project_id: String,
    pub project_revision: i64,
    pub scope_node_id: String,
    pub scope_kind: PublicationScopeKind,
    pub metadata: PublicationMetadata,
    pub sections: Vec<PublicationSection>,
    pub stats: PublicationSourceStatistics,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PublicationDiagnosticSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PublicationDiagnosticCode {
    UnsupportedBlock,
    UnsupportedInlineModifier,
    InvalidSemanticDocument,
    EmptyScope,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationDiagnostic {
    pub code: PublicationDiagnosticCode,
    pub severity: PublicationDiagnosticSeverity,
    pub scene_node_id: Option<String>,
    pub document_id: Option<String>,
    pub block_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompileOutput {
    pub document: PublicationDocument,
    pub content_hash: String,
    pub diagnostics: Vec<PublicationDiagnostic>,
}

pub fn compile_publication(input: CompileInput) -> Result<CompileOutput> {
    validate_compile_input(&input)?;
    let mut sections = Vec::with_capacity(input.scenes.len());
    let mut diagnostics = Vec::new();

    if input.scenes.is_empty() {
        diagnostics.push(PublicationDiagnostic {
            code: PublicationDiagnosticCode::EmptyScope,
            severity: PublicationDiagnosticSeverity::Info,
            scene_node_id: None,
            document_id: None,
            block_id: None,
        });
    }

    for scene in &input.scenes {
        let semantic = decode_typie_snapshot(&scene.document_id, &scene.snapshot)?;
        let mut blocks = Vec::with_capacity(scene.headings.len() + semantic.blocks.len());
        for heading in &scene.headings {
            let block_id = stable_id(&[
                "heading-source-v1",
                &heading.source_node_id,
                &heading.level.to_string(),
            ]);
            let source = PublicationSourceReference {
                source_node_id: heading.source_node_id.clone(),
                scene_node_id: scene.scene_node_id.clone(),
                document_id: scene.document_id.clone(),
                block_id,
                start: None,
                end: None,
                range_verified: false,
            };
            blocks.push(PublicationBlock::Heading {
                id: stable_block_id("HEADING", &source),
                level: heading.level,
                text: heading.text.clone(),
                source,
            });
        }
        for block in semantic.blocks {
            let semantic_source = block.source().clone();
            let source = source_reference(
                scene,
                semantic_source.block_id,
                semantic_source.start,
                semantic_source.end,
                semantic_source.verified,
            );
            let publication_block = match block {
                MadiSemanticBlock::Paragraph { inlines, .. } => PublicationBlock::Paragraph {
                    id: stable_block_id("PARAGRAPH", &source),
                    inlines: inlines.into_iter().map(map_inline).collect(),
                    source,
                },
                MadiSemanticBlock::SceneBreak { .. } => PublicationBlock::SceneBreak {
                    id: stable_block_id("SCENE_BREAK", &source),
                    source,
                },
                MadiSemanticBlock::Quote { inlines, .. } => PublicationBlock::Quote {
                    id: stable_block_id("QUOTE", &source),
                    inlines: inlines.into_iter().map(map_inline).collect(),
                    source,
                },
                MadiSemanticBlock::Unsupported {
                    node_type, text, ..
                } => PublicationBlock::Unsupported {
                    id: stable_block_id("UNSUPPORTED", &source),
                    node_type,
                    text,
                    source,
                },
            };
            blocks.push(publication_block);
        }
        for diagnostic in semantic.diagnostics {
            diagnostics.push(PublicationDiagnostic {
                code: match diagnostic.code {
                    MadiSemanticDiagnosticCode::UnsupportedBlock => {
                        PublicationDiagnosticCode::UnsupportedBlock
                    }
                    MadiSemanticDiagnosticCode::UnsupportedInlineModifier => {
                        PublicationDiagnosticCode::UnsupportedInlineModifier
                    }
                },
                severity: PublicationDiagnosticSeverity::Warning,
                scene_node_id: Some(scene.scene_node_id.clone()),
                document_id: Some(scene.document_id.clone()),
                block_id: Some(diagnostic.block_id),
            });
        }
        sections.push(PublicationSection {
            id: stable_id(&["section-v1", &scene.scene_node_id]),
            source_node_id: scene.scene_node_id.clone(),
            kind: PublicationSectionKind::Scene,
            title: scene.title.clone(),
            parent_titles: scene.parent_titles.clone(),
            blocks,
        });
    }

    let stats = derive_stats(&sections);
    if stats.chapter_count != input.chapter_count {
        return Err(PublicationError::InvalidInput(
            "publication chapter count does not match level-three headings".to_owned(),
        ));
    }

    let document = PublicationDocument {
        format_version: PUBLICATION_DOCUMENT_FORMAT_VERSION,
        project_id: input.project_id,
        project_revision: input.project_revision,
        scope_node_id: input.scope_node_id,
        scope_kind: input.scope_kind,
        metadata: PublicationMetadata {
            title: input.title,
            author_name: input.author_name,
            language: PublicationLanguage::Korean,
        },
        sections,
        stats,
    };
    validate_publication_document(&document)?;
    let canonical = canonical_publication_document(&document)?;
    let content_hash = sha256_hex(canonical.as_bytes());
    Ok(CompileOutput {
        document,
        content_hash,
        diagnostics,
    })
}

pub fn canonical_publication_document(document: &PublicationDocument) -> Result<String> {
    validate_publication_document(document)?;
    let value = serde_json::to_value(document)?;
    serde_json::to_string(&canonical_value(value)).map_err(PublicationError::from)
}

pub fn validate_publication_document(document: &PublicationDocument) -> Result<()> {
    if document.format_version != PUBLICATION_DOCUMENT_FORMAT_VERSION
        || !bounded_string(&document.project_id, MAX_ID_CHARACTERS, false)
        || !bounded_string(&document.scope_node_id, MAX_ID_CHARACTERS, false)
        || !bounded_string(&document.metadata.title, MAX_TITLE_CHARACTERS, false)
        || document
            .metadata
            .author_name
            .as_ref()
            .is_some_and(|author| !bounded_string(author, MAX_TITLE_CHARACTERS, true))
        || document.project_revision < 0
        || document.project_revision as u64 > MAX_SAFE_INTEGER
        || document.sections.len() > MAX_SECTIONS
    {
        return Err(PublicationError::InvalidDocument(
            "publication document metadata is invalid".to_owned(),
        ));
    }
    let mut budget = ValidationBudget::default();
    if !consume_text(
        &mut budget,
        &document.metadata.title,
        MAX_TITLE_CHARACTERS,
        false,
    ) || document
        .metadata
        .author_name
        .as_ref()
        .is_some_and(|author| !consume_text(&mut budget, author, MAX_TITLE_CHARACTERS, true))
    {
        return Err(PublicationError::InvalidDocument(
            "publication text budget is invalid".to_owned(),
        ));
    }
    let mut section_ids = HashSet::new();
    let mut source_nodes = HashSet::new();
    let mut block_ids = HashSet::new();
    let mut source_block_ids = HashSet::new();
    for section in &document.sections {
        if section.id.is_empty()
            || !bounded_string(&section.id, MAX_ID_CHARACTERS, false)
            || !bounded_string(&section.source_node_id, MAX_ID_CHARACTERS, false)
            || !consume_text(&mut budget, &section.title, MAX_TITLE_CHARACTERS, false)
            || section.parent_titles.len() > MAX_PARENT_TITLES
            || section
                .parent_titles
                .iter()
                .any(|title| !consume_text(&mut budget, title, MAX_TITLE_CHARACTERS, true))
            || section.blocks.len() > MAX_BLOCKS_PER_SECTION
            || !section_ids.insert(section.id.as_str())
            || !source_nodes.insert(section.source_node_id.as_str())
        {
            return Err(PublicationError::InvalidDocument(
                "publication section identity is invalid".to_owned(),
            ));
        }
        for block in &section.blocks {
            budget.blocks = budget.blocks.saturating_add(1);
            let source = block.source();
            if budget.blocks > MAX_BLOCKS
                || !bounded_string(block.id(), MAX_ID_CHARACTERS, false)
                || !block_ids.insert(block.id())
                || !bounded_string(&source.source_node_id, MAX_ID_CHARACTERS, false)
                || !bounded_string(&source.scene_node_id, MAX_ID_CHARACTERS, false)
                || !bounded_string(&source.document_id, MAX_ID_CHARACTERS, false)
                || !bounded_string(&source.block_id, MAX_ID_CHARACTERS, false)
                || !source_block_ids.insert(source.block_id.as_str())
                || match (source.start, source.end, source.range_verified) {
                    (None, None, false) => false,
                    (Some(start), Some(end), true) => {
                        start > end || end > MAX_TEXT_CHARACTERS as u64 || end > MAX_SAFE_INTEGER
                    }
                    _ => true,
                }
            {
                return Err(PublicationError::InvalidDocument(
                    "publication block source is invalid".to_owned(),
                ));
            }
            match block {
                PublicationBlock::Heading { level, text, .. } => {
                    if !(1..=4).contains(level)
                        || !consume_text(&mut budget, text, MAX_TITLE_CHARACTERS, false)
                        || source.scene_node_id != section.source_node_id
                        || source.range_verified
                        || source.start.is_some()
                        || source.end.is_some()
                    {
                        return Err(PublicationError::InvalidDocument(
                            "publication heading is invalid".to_owned(),
                        ));
                    }
                }
                PublicationBlock::Paragraph { inlines, .. }
                | PublicationBlock::Quote { inlines, .. } => {
                    if source.source_node_id != section.source_node_id
                        || source.scene_node_id != section.source_node_id
                    {
                        return Err(PublicationError::InvalidDocument(
                            "publication body source scene is invalid".to_owned(),
                        ));
                    }
                    validate_publication_inlines(inlines, 0, &mut budget)?;
                }
                PublicationBlock::SceneBreak { .. } => {
                    if source.source_node_id != section.source_node_id
                        || source.scene_node_id != section.source_node_id
                    {
                        return Err(PublicationError::InvalidDocument(
                            "publication body source scene is invalid".to_owned(),
                        ));
                    }
                }
                PublicationBlock::Unsupported { node_type, .. } => {
                    if source.source_node_id != section.source_node_id
                        || source.scene_node_id != section.source_node_id
                    {
                        return Err(PublicationError::InvalidDocument(
                            "publication body source scene is invalid".to_owned(),
                        ));
                    }
                    if !bounded_string(node_type, MAX_NODE_TYPE_CHARACTERS, false) {
                        return Err(PublicationError::InvalidDocument(
                            "unsupported block type is empty".to_owned(),
                        ));
                    }
                    if let PublicationBlock::Unsupported { text, .. } = block {
                        if !consume_text(&mut budget, text, MAX_TEXT_CHARACTERS, true) {
                            return Err(PublicationError::InvalidDocument(
                                "unsupported block text exceeds the safe budget".to_owned(),
                            ));
                        }
                    }
                }
            }
        }
    }
    let stats = &document.stats;
    if stats.with_spaces > MAX_TEXT_CHARACTERS as u64
        || stats.with_spaces > MAX_SAFE_INTEGER
        || stats.without_spaces > stats.with_spaces
        || stats.paragraph_count > MAX_BLOCKS as u64
        || stats.scene_count > MAX_SAFE_INTEGER
        || stats.chapter_count > MAX_SECTIONS as u64
        || stats != &derive_stats(&document.sections)
    {
        return Err(PublicationError::InvalidDocument(
            "publication statistics are invalid".to_owned(),
        ));
    }
    Ok(())
}

fn validate_compile_input(input: &CompileInput) -> Result<()> {
    if !bounded_string(&input.project_id, MAX_ID_CHARACTERS, false)
        || !bounded_string(&input.scope_node_id, MAX_ID_CHARACTERS, false)
        || !bounded_string(&input.title, MAX_TITLE_CHARACTERS, false)
        || input
            .author_name
            .as_ref()
            .is_some_and(|author| !bounded_string(author, MAX_TITLE_CHARACTERS, true))
        || input.project_revision < 0
        || input.project_revision as u64 > MAX_SAFE_INTEGER
        || input.scenes.len() > MAX_SECTIONS
        || input.chapter_count > MAX_SECTIONS as u64
    {
        return Err(PublicationError::InvalidInput(
            "publication scope metadata is incomplete".to_owned(),
        ));
    }
    let mut budget = ValidationBudget::default();
    if !consume_text(&mut budget, &input.title, MAX_TITLE_CHARACTERS, false)
        || input
            .author_name
            .as_ref()
            .is_some_and(|author| !consume_text(&mut budget, author, MAX_TITLE_CHARACTERS, true))
    {
        return Err(PublicationError::InvalidInput(
            "publication text budget is invalid".to_owned(),
        ));
    }
    let mut scene_ids = HashSet::new();
    let mut document_ids = HashSet::new();
    for scene in &input.scenes {
        if !bounded_string(&scene.scene_node_id, MAX_ID_CHARACTERS, false)
            || !bounded_string(&scene.document_id, MAX_ID_CHARACTERS, false)
            || !consume_text(&mut budget, &scene.title, MAX_TITLE_CHARACTERS, false)
            || scene.parent_titles.len() > MAX_PARENT_TITLES
            || scene
                .parent_titles
                .iter()
                .any(|title| !consume_text(&mut budget, title, MAX_TITLE_CHARACTERS, true))
            || scene.headings.len() > MAX_BLOCKS_PER_SECTION
            || !scene_ids.insert(scene.scene_node_id.as_str())
            || !document_ids.insert(scene.document_id.as_str())
        {
            return Err(PublicationError::InvalidInput(
                "publication scene identity is invalid".to_owned(),
            ));
        }
        for heading in &scene.headings {
            budget.blocks = budget.blocks.saturating_add(1);
            if budget.blocks > MAX_BLOCKS
                || !bounded_string(&heading.source_node_id, MAX_ID_CHARACTERS, false)
                || !consume_text(&mut budget, &heading.text, MAX_TITLE_CHARACTERS, false)
                || !(1..=4).contains(&heading.level)
            {
                return Err(PublicationError::InvalidInput(
                    "publication heading is invalid".to_owned(),
                ));
            }
        }
    }
    Ok(())
}

fn source_reference(
    scene: &SceneInput,
    block_id: String,
    start: Option<u64>,
    end: Option<u64>,
    range_verified: bool,
) -> PublicationSourceReference {
    PublicationSourceReference {
        source_node_id: scene.scene_node_id.clone(),
        scene_node_id: scene.scene_node_id.clone(),
        document_id: scene.document_id.clone(),
        block_id,
        start,
        end,
        range_verified,
    }
}

fn stable_block_id(kind: &str, source: &PublicationSourceReference) -> String {
    stable_id(&[
        "publication-block-v1",
        kind,
        &source.source_node_id,
        &source.scene_node_id,
        &source.document_id,
        &source.block_id,
    ])
}

fn stable_id(parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update((part.len() as u64).to_be_bytes());
        hasher.update(part.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn map_inline(inline: MadiSemanticInline) -> PublicationInline {
    match inline {
        MadiSemanticInline::Text { text } => PublicationInline::Text { text },
        MadiSemanticInline::Strong { children } => PublicationInline::Strong {
            children: children.into_iter().map(map_inline).collect(),
        },
        MadiSemanticInline::Emphasis { children } => PublicationInline::Emphasis {
            children: children.into_iter().map(map_inline).collect(),
        },
        MadiSemanticInline::Underline { children } => PublicationInline::Underline {
            children: children.into_iter().map(map_inline).collect(),
        },
        MadiSemanticInline::Strike { children } => PublicationInline::Strike {
            children: children.into_iter().map(map_inline).collect(),
        },
        MadiSemanticInline::Ruby {
            annotation,
            children,
        } => PublicationInline::Ruby {
            annotation,
            children: children.into_iter().map(map_inline).collect(),
        },
    }
}

fn derive_stats(sections: &[PublicationSection]) -> PublicationSourceStatistics {
    let mut stats = PublicationSourceStatistics {
        scene_count: sections.len() as u64,
        ..PublicationSourceStatistics::default()
    };
    let mut chapter_sources = HashSet::new();
    for section in sections {
        for block in &section.blocks {
            let mut text = String::new();
            match block {
                PublicationBlock::Heading { level, source, .. } => {
                    if *level == 3 {
                        chapter_sources.insert(source.block_id.as_str());
                    }
                    continue;
                }
                PublicationBlock::Paragraph { inlines, .. }
                | PublicationBlock::Quote { inlines, .. } => {
                    collect_publication_inline_text(inlines, &mut text);
                    stats.paragraph_count += 1;
                }
                PublicationBlock::SceneBreak { .. } => continue,
                PublicationBlock::Unsupported {
                    node_type,
                    text: unsupported_text,
                    ..
                } => {
                    text.push_str(unsupported_text);
                    if node_type == "paragraph" {
                        stats.paragraph_count += 1;
                    }
                }
            }
            stats.with_spaces += text.chars().count() as u64;
            stats.without_spaces += text
                .chars()
                .filter(|character| !character.is_whitespace())
                .count() as u64;
        }
    }
    stats.chapter_count = chapter_sources.len() as u64;
    stats
}

fn collect_publication_inline_text(inlines: &[PublicationInline], output: &mut String) {
    for inline in inlines {
        match inline {
            PublicationInline::Text { text } => output.push_str(text),
            PublicationInline::Strong { children }
            | PublicationInline::Emphasis { children }
            | PublicationInline::Underline { children }
            | PublicationInline::Strike { children }
            | PublicationInline::Ruby { children, .. } => {
                collect_publication_inline_text(children, output)
            }
        }
    }
}

fn validate_publication_inlines(
    inlines: &[PublicationInline],
    depth: usize,
    budget: &mut ValidationBudget,
) -> Result<()> {
    if depth > MAX_INLINE_DEPTH || inlines.len() > MAX_INLINE_CHILDREN {
        return Err(PublicationError::InvalidDocument(
            "publication inline shape exceeds the safe limit".to_owned(),
        ));
    }
    for inline in inlines {
        budget.inline_nodes = budget.inline_nodes.saturating_add(1);
        if budget.inline_nodes > MAX_INLINE_NODES {
            return Err(PublicationError::InvalidDocument(
                "publication inline count exceeds the safe limit".to_owned(),
            ));
        }
        match inline {
            PublicationInline::Text { text } => {
                if !consume_text(budget, text, MAX_TEXT_CHARACTERS, true) {
                    return Err(PublicationError::InvalidDocument(
                        "publication inline text exceeds the safe budget".to_owned(),
                    ));
                }
            }
            PublicationInline::Strong { children }
            | PublicationInline::Emphasis { children }
            | PublicationInline::Underline { children }
            | PublicationInline::Strike { children } => {
                if children.is_empty() {
                    return Err(PublicationError::InvalidDocument(
                        "publication inline wrapper is empty".to_owned(),
                    ));
                }
                validate_publication_inlines(children, depth + 1, budget)?;
            }
            PublicationInline::Ruby {
                annotation,
                children,
            } => {
                if children.is_empty()
                    || !consume_text(budget, annotation, MAX_TEXT_CHARACTERS, false)
                {
                    return Err(PublicationError::InvalidDocument(
                        "publication ruby inline is invalid".to_owned(),
                    ));
                }
                validate_publication_inlines(children, depth + 1, budget)?;
            }
        }
    }
    Ok(())
}

fn canonical_value(value: Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.into_iter().map(canonical_value).collect()),
        Value::Object(values) => {
            let sorted: BTreeMap<_, _> = values
                .into_iter()
                .map(|(key, value)| (key, canonical_value(value)))
                .collect();
            Value::Object(sorted.into_iter().collect())
        }
        scalar => scalar,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use editor_codec::{ReencodableChangesets, encode_changesets};
    use editor_model::{
        PlainDoc, PlainHardBreakNode, PlainNode, PlainNodeEntry, PlainParagraphNode, PlainRootNode,
        PlainTextNode,
    };
    use editor_state::State;

    use super::*;

    fn entry(node: PlainNode, children: Vec<PlainNodeEntry>) -> PlainNodeEntry {
        PlainNodeEntry {
            node,
            modifiers: BTreeMap::new(),
            carry: Vec::new(),
            children,
        }
    }

    fn snapshot_from_plain(children: Vec<PlainNodeEntry>) -> Vec<u8> {
        let state = State::from_plain(&PlainDoc {
            root: entry(PlainNode::Root(PlainRootNode::default()), children),
        })
        .unwrap();
        encode_changesets(ReencodableChangesets::from_local_ops(
            state.graph().changesets_as_vec(),
        ))
        .unwrap()
    }

    fn hard_break_paragraph_snapshot() -> Vec<u8> {
        snapshot_from_plain(vec![entry(
            PlainNode::Paragraph(PlainParagraphNode {}),
            vec![
                entry(
                    PlainNode::Text(PlainTextNode {
                        text: "앞".to_owned(),
                    }),
                    Vec::new(),
                ),
                entry(PlainNode::HardBreak(PlainHardBreakNode {}), Vec::new()),
                entry(
                    PlainNode::Text(PlainTextNode {
                        text: "뒤".to_owned(),
                    }),
                    Vec::new(),
                ),
            ],
        )])
    }

    fn empty_scene(scene: &str, document: &str) -> SceneInput {
        SceneInput {
            scene_node_id: scene.to_owned(),
            document_id: document.to_owned(),
            title: scene.to_owned(),
            parent_titles: vec!["Work".to_owned()],
            headings: vec![HeadingInput {
                source_node_id: "chapter-a".to_owned(),
                level: 3,
                text: "장".to_owned(),
            }],
            snapshot: Vec::new(),
        }
    }

    #[test]
    fn canonical_compile_is_deterministic() {
        let input = CompileInput {
            project_id: "project-a".to_owned(),
            project_revision: 7,
            scope_node_id: "work-a".to_owned(),
            scope_kind: PublicationScopeKind::Work,
            title: "작품".to_owned(),
            author_name: Some("작가".to_owned()),
            chapter_count: 1,
            scenes: vec![empty_scene("scene-a", "document-a")],
        };
        let first = compile_publication(input.clone()).unwrap();
        let second = compile_publication(input).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.content_hash.len(), 64);
        assert_eq!(first.document.stats.scene_count, 1);
    }

    #[test]
    fn empty_scope_has_an_explicit_diagnostic() {
        let output = compile_publication(CompileInput {
            project_id: "project-a".to_owned(),
            project_revision: 0,
            scope_node_id: "chapter-empty".to_owned(),
            scope_kind: PublicationScopeKind::Chapter,
            title: "빈 장".to_owned(),
            author_name: None,
            chapter_count: 0,
            scenes: Vec::new(),
        })
        .unwrap();
        assert_eq!(output.document.sections, Vec::new());
        assert_eq!(
            output.diagnostics[0].code,
            PublicationDiagnosticCode::EmptyScope
        );
    }

    #[test]
    fn emits_hierarchy_headings_once_and_targets_the_first_descendant_scene() {
        let mut first = empty_scene("scene-a", "document-a");
        first.headings = vec![
            HeadingInput {
                source_node_id: "chapter-a".to_owned(),
                level: 3,
                text: "한 장".to_owned(),
            },
            HeadingInput {
                source_node_id: "scene-a".to_owned(),
                level: 4,
                text: "첫 장면".to_owned(),
            },
        ];
        let mut second = empty_scene("scene-b", "document-b");
        second.headings = vec![HeadingInput {
            source_node_id: "scene-b".to_owned(),
            level: 4,
            text: "둘째 장면".to_owned(),
        }];
        let output = compile_publication(CompileInput {
            project_id: "project-a".to_owned(),
            project_revision: 3,
            scope_node_id: "chapter-a".to_owned(),
            scope_kind: PublicationScopeKind::Chapter,
            title: "한 장".to_owned(),
            author_name: None,
            chapter_count: 1,
            scenes: vec![first, second],
        })
        .unwrap();
        assert_eq!(output.document.stats.scene_count, 2);
        assert_eq!(output.document.stats.chapter_count, 1);
        let headings: Vec<_> = output
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
        let chapter = headings.iter().find(|(level, _)| *level == 3).unwrap().1;
        assert_eq!(chapter.source_node_id, "chapter-a");
        assert_eq!(chapter.scene_node_id, "scene-a");
        assert_eq!(chapter.document_id, "document-a");
        let scene_targets: Vec<_> = headings
            .iter()
            .filter(|(level, _)| *level == 4)
            .map(|(_, source)| {
                (
                    source.source_node_id.as_str(),
                    source.scene_node_id.as_str(),
                    source.document_id.as_str(),
                )
            })
            .collect();
        assert_eq!(
            scene_targets,
            vec![
                ("scene-a", "scene-a", "document-a"),
                ("scene-b", "scene-b", "document-b"),
            ]
        );
    }

    #[test]
    fn derives_unique_multi_chapter_stats() {
        let first = empty_scene("scene-a", "document-a");
        let mut second = empty_scene("scene-b", "document-b");
        second.headings[0].source_node_id = "chapter-b".to_owned();
        let output = compile_publication(CompileInput {
            project_id: "project-a".to_owned(),
            project_revision: 0,
            scope_node_id: "work-a".to_owned(),
            scope_kind: PublicationScopeKind::Work,
            title: "작품".to_owned(),
            author_name: None,
            chapter_count: 2,
            scenes: vec![first, second],
        })
        .unwrap();
        assert_eq!(output.document.stats.chapter_count, 2);
    }

    #[test]
    fn counts_an_unsupported_hard_break_paragraph_from_the_semantic_source() {
        let mut scene = empty_scene("scene-a", "document-a");
        scene.snapshot = hard_break_paragraph_snapshot();
        let output = compile_publication(CompileInput {
            project_id: "project-a".to_owned(),
            project_revision: 0,
            scope_node_id: "chapter-a".to_owned(),
            scope_kind: PublicationScopeKind::Chapter,
            title: "장".to_owned(),
            author_name: None,
            chapter_count: 1,
            scenes: vec![scene],
        })
        .unwrap();
        assert_eq!(output.document.stats.paragraph_count, 1);
        assert!(matches!(
            output.document.sections[0].blocks.last(),
            Some(PublicationBlock::Unsupported { node_type, .. }) if node_type == "paragraph"
        ));
    }

    #[test]
    fn rejects_tampered_statistics() {
        let output = compile_publication(CompileInput {
            project_id: "project-a".to_owned(),
            project_revision: 0,
            scope_node_id: "work-a".to_owned(),
            scope_kind: PublicationScopeKind::Work,
            title: "작품".to_owned(),
            author_name: None,
            chapter_count: 1,
            scenes: vec![empty_scene("scene-a", "document-a")],
        })
        .unwrap();
        let mut tampered = output.document;
        tampered.stats.with_spaces += 1;
        assert!(matches!(
            validate_publication_document(&tampered),
            Err(PublicationError::InvalidDocument(_))
        ));
    }

    #[test]
    fn mirrors_the_publication_boundary_caps_and_safe_integer_contract() {
        let mut oversized_id = CompileInput {
            project_id: "x".repeat(MAX_ID_CHARACTERS + 1),
            project_revision: 0,
            scope_node_id: "work-a".to_owned(),
            scope_kind: PublicationScopeKind::Work,
            title: "작품".to_owned(),
            author_name: None,
            chapter_count: 1,
            scenes: vec![empty_scene("scene-a", "document-a")],
        };
        assert!(matches!(
            compile_publication(oversized_id.clone()),
            Err(PublicationError::InvalidInput(_))
        ));
        oversized_id.project_id = "project-a".to_owned();
        oversized_id.project_revision = MAX_SAFE_INTEGER as i64 + 1;
        assert!(matches!(
            compile_publication(oversized_id),
            Err(PublicationError::InvalidInput(_))
        ));

        let output = compile_publication(CompileInput {
            project_id: "project-a".to_owned(),
            project_revision: 0,
            scope_node_id: "work-a".to_owned(),
            scope_kind: PublicationScopeKind::Work,
            title: "작품".to_owned(),
            author_name: None,
            chapter_count: 1,
            scenes: vec![empty_scene("scene-a", "document-a")],
        })
        .unwrap();
        let mut oversized_title = output.document;
        oversized_title.metadata.title = "가".repeat(MAX_TITLE_CHARACTERS + 1);
        assert!(matches!(
            validate_publication_document(&oversized_title),
            Err(PublicationError::InvalidDocument(_))
        ));
    }

    #[test]
    fn serde_rejects_unknown_block_and_inline_variant_fields() {
        assert!(
            serde_json::from_value::<PublicationInline>(serde_json::json!({
                "kind": "TEXT",
                "text": "본문",
                "href": "https://example.invalid"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<PublicationBlock>(serde_json::json!({
                "kind": "SCENE_BREAK",
                "id": "block-a",
                "source": {
                    "sourceNodeId": "scene-a",
                    "sceneNodeId": "scene-a",
                    "documentId": "document-a",
                    "blockId": "source-a",
                    "start": 0,
                    "end": 3,
                    "rangeVerified": true
                },
                "href": "https://example.invalid"
            }))
            .is_err()
        );
    }
}
