use std::collections::HashMap;
use std::ops::Range;

use editor_crdt::{Dot, OpGraph};
use editor_model::{
    AtomLeaf, ChildView, DocView, EditOp, HorizontalRuleVariant, Modifier, NodeType, NodeView,
    SeqItem, project_document, split_logs,
};
use editor_state::{FlatSegment, flat_segments, prose_annotated};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{PublicationError, Result, SCENE_BREAK_SEMANTIC_ID};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MadiSemanticDocument {
    pub format_version: i64,
    pub blocks: Vec<MadiSemanticBlock>,
    pub diagnostics: Vec<MadiSemanticDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MadiSemanticSource {
    pub block_id: String,
    pub start: Option<u64>,
    pub end: Option<u64>,
    pub occurrence: u64,
    pub verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MadiSemanticBlock {
    Paragraph {
        source: MadiSemanticSource,
        inlines: Vec<MadiSemanticInline>,
    },
    SceneBreak {
        source: MadiSemanticSource,
        semantic_id: String,
    },
    Quote {
        source: MadiSemanticSource,
        inlines: Vec<MadiSemanticInline>,
    },
    Unsupported {
        source: MadiSemanticSource,
        node_type: String,
        text: String,
    },
}

impl MadiSemanticBlock {
    pub fn source(&self) -> &MadiSemanticSource {
        match self {
            Self::Paragraph { source, .. }
            | Self::SceneBreak { source, .. }
            | Self::Quote { source, .. }
            | Self::Unsupported { source, .. } => source,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MadiSemanticInline {
    Text {
        text: String,
    },
    Strong {
        children: Vec<MadiSemanticInline>,
    },
    Emphasis {
        children: Vec<MadiSemanticInline>,
    },
    Underline {
        children: Vec<MadiSemanticInline>,
    },
    Strike {
        children: Vec<MadiSemanticInline>,
    },
    Ruby {
        annotation: String,
        children: Vec<MadiSemanticInline>,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MadiSemanticDiagnosticCode {
    UnsupportedBlock,
    UnsupportedInlineModifier,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MadiSemanticDiagnostic {
    pub code: MadiSemanticDiagnosticCode,
    pub block_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct InlineStyle {
    strong: bool,
    emphasis: bool,
    underline: bool,
    strike: bool,
    ruby: Option<String>,
}

/// Decode one pinned Typie changeset stream without exposing Typie types.
///
/// An empty stream is the canonical uninitialized scene created by madi-core
/// before the editor has produced its first graph. It has no authored blocks.
pub fn decode_typie_snapshot(document_id: &str, snapshot: &[u8]) -> Result<MadiSemanticDocument> {
    if document_id.is_empty() {
        return Err(PublicationError::InvalidInput(
            "document id is empty".to_owned(),
        ));
    }
    if snapshot.is_empty() {
        return Ok(MadiSemanticDocument {
            format_version: 1,
            blocks: Vec::new(),
            diagnostics: Vec::new(),
        });
    }

    let decoded = editor_codec::decode_changeset_stream(snapshot)
        .map_err(|_| PublicationError::SnapshotDecode)?;
    if !decoded.lossless() {
        return Err(PublicationError::LossySnapshot);
    }
    let (graph, dropped) =
        OpGraph::<EditOp>::new().receive_changesets_ordered(decoded.into_graph_input());
    if !dropped.is_empty() {
        return Err(PublicationError::UnresolvedChangesets);
    }
    let logs = split_logs(&graph).map_err(|_| PublicationError::Projection)?;
    let projected = project_document(&logs).map_err(|_| PublicationError::Projection)?;
    let repair = projected.repair_stats;
    if repair.projection_degraded || repair.drops != 0 || repair.totality_violations != 0 {
        return Err(PublicationError::DegradedProjection);
    }
    let view = DocView::new(&projected);
    let root = view.root().ok_or(PublicationError::Projection)?;
    let ranges = verified_annotated_ranges(&view)?;
    let mut blocks = Vec::new();
    let mut diagnostics = Vec::new();
    for child in root.children() {
        decode_top_level_child(document_id, child, &ranges, &mut blocks, &mut diagnostics)?;
    }
    let document = MadiSemanticDocument {
        format_version: 1,
        blocks,
        diagnostics,
    };
    validate_semantic_document(&document)?;
    Ok(document)
}

fn decode_top_level_child(
    document_id: &str,
    child: ChildView<'_>,
    ranges: &HashMap<Dot, Range<u64>>,
    blocks: &mut Vec<MadiSemanticBlock>,
    diagnostics: &mut Vec<MadiSemanticDiagnostic>,
) -> Result<()> {
    match child {
        ChildView::Block(node) => {
            decode_top_level_block(document_id, node, ranges, blocks, diagnostics)
        }
        ChildView::Leaf(leaf) => {
            if leaf.dot().is_synthetic() {
                return Ok(());
            }
            let block_id = public_block_id(document_id, leaf.dot());
            match leaf.as_atom() {
                Some(AtomLeaf::HorizontalRule {
                    variant: HorizontalRuleVariant::ThreeDiamonds,
                }) => blocks.push(MadiSemanticBlock::SceneBreak {
                    source: semantic_source(block_id, ranges.get(&leaf.dot())),
                    semantic_id: SCENE_BREAK_SEMANTIC_ID.to_owned(),
                }),
                _ => push_unsupported(
                    blocks,
                    diagnostics,
                    block_id,
                    ranges.get(&leaf.dot()),
                    node_type_token(leaf.node_type()),
                    leaf_fallback_text(&leaf),
                ),
            }
            Ok(())
        }
    }
}

fn decode_top_level_block(
    document_id: &str,
    node: NodeView<'_>,
    ranges: &HashMap<Dot, Range<u64>>,
    blocks: &mut Vec<MadiSemanticBlock>,
    diagnostics: &mut Vec<MadiSemanticDiagnostic>,
) -> Result<()> {
    let Some(dot) = node.dot() else {
        if contains_authored_content(node) {
            return Err(PublicationError::DegradedProjection);
        }
        return Ok(());
    };
    if dot.is_synthetic() {
        if contains_authored_content(node) {
            return Err(PublicationError::DegradedProjection);
        }
        return Ok(());
    }
    let block_id = public_block_id(document_id, dot);
    match node.node_type() {
        NodeType::Paragraph => match decode_paragraph_inlines(node, &block_id, diagnostics) {
            Ok(inlines) => blocks.push(MadiSemanticBlock::Paragraph {
                source: semantic_source(block_id, ranges.get(&dot)),
                inlines,
            }),
            Err(()) => push_unsupported(
                blocks,
                diagnostics,
                block_id,
                ranges.get(&dot),
                "paragraph".to_owned(),
                node_fallback_text(node),
            ),
        },
        NodeType::Blockquote => {
            decode_quote_blocks(document_id, node, ranges, &block_id, blocks, diagnostics)
        }
        _ => push_unsupported(
            blocks,
            diagnostics,
            block_id,
            ranges.get(&dot),
            node_type_token(node.node_type()),
            node_fallback_text(node),
        ),
    }
    Ok(())
}

fn decode_quote_blocks(
    document_id: &str,
    quote: NodeView<'_>,
    ranges: &HashMap<Dot, Range<u64>>,
    fallback_block_id: &str,
    blocks: &mut Vec<MadiSemanticBlock>,
    diagnostics: &mut Vec<MadiSemanticDiagnostic>,
) {
    let mut decoded = Vec::new();
    for child in quote.children() {
        let ChildView::Block(paragraph) = child else {
            push_unsupported(
                blocks,
                diagnostics,
                fallback_block_id.to_owned(),
                ranges.get(&quote.id()),
                "blockquote".to_owned(),
                node_fallback_text(quote),
            );
            return;
        };
        let Some(paragraph_dot) = paragraph.dot() else {
            if contains_authored_content(paragraph) {
                push_unsupported(
                    blocks,
                    diagnostics,
                    fallback_block_id.to_owned(),
                    ranges.get(&quote.id()),
                    "blockquote".to_owned(),
                    node_fallback_text(quote),
                );
                return;
            }
            continue;
        };
        if paragraph_dot.is_synthetic() {
            if contains_authored_content(paragraph) {
                push_unsupported(
                    blocks,
                    diagnostics,
                    fallback_block_id.to_owned(),
                    ranges.get(&quote.id()),
                    "blockquote".to_owned(),
                    node_fallback_text(quote),
                );
                return;
            }
            continue;
        }
        if paragraph.node_type() != NodeType::Paragraph {
            push_unsupported(
                blocks,
                diagnostics,
                fallback_block_id.to_owned(),
                ranges.get(&quote.id()),
                "blockquote".to_owned(),
                node_fallback_text(quote),
            );
            return;
        }
        let paragraph_id = public_block_id(document_id, paragraph_dot);
        let Ok(inlines) = decode_paragraph_inlines(paragraph, &paragraph_id, diagnostics) else {
            push_unsupported(
                blocks,
                diagnostics,
                paragraph_id.clone(),
                ranges.get(&paragraph_dot),
                "paragraph".to_owned(),
                node_fallback_text(paragraph),
            );
            continue;
        };
        decoded.push(MadiSemanticBlock::Quote {
            source: semantic_source(paragraph_id, ranges.get(&paragraph_dot)),
            inlines,
        });
    }
    if decoded.is_empty() {
        blocks.push(MadiSemanticBlock::Quote {
            source: semantic_source(fallback_block_id.to_owned(), ranges.get(&quote.id())),
            inlines: Vec::new(),
        });
    } else {
        blocks.extend(decoded);
    }
}

#[derive(Default)]
struct AnnotatedRangeBuilder {
    text: String,
    offset: u64,
    ranges: HashMap<Dot, Range<u64>>,
    pending_boundary: bool,
    pending_empty_blocks: usize,
    textblock_emitted: Vec<bool>,
}

impl AnnotatedRangeBuilder {
    fn emit_owned(&mut self, owner: Dot, text: &str) {
        if text.is_empty() {
            return;
        }
        self.flush_pending();
        let start = self.offset;
        self.text.push_str(text);
        self.offset += text.chars().count() as u64;
        self.ranges
            .entry(owner)
            .and_modify(|range| range.end = self.offset)
            .or_insert(start..self.offset);
        if let Some(emitted) = self.textblock_emitted.last_mut() {
            *emitted = true;
        }
    }

    fn flush_pending(&mut self) {
        if self.pending_boundary {
            self.text.push_str("\n\n");
            self.offset += 2;
            self.pending_boundary = false;
        }
        for _ in 0..self.pending_empty_blocks {
            if !self.text.is_empty() {
                let trailing = self.text.chars().rev().take_while(|&c| c == '\n').count();
                if trailing < 4 {
                    self.text.push('\n');
                    self.offset += 1;
                }
            }
        }
        self.pending_empty_blocks = 0;
    }

    fn emit_divider(&mut self, owner: Dot) {
        self.flush_pending();
        let start = self.offset;
        self.text.push_str("***");
        self.offset += 3;
        self.ranges.insert(owner, start..self.offset);
        self.pending_boundary = true;
    }
}

fn verified_annotated_ranges(view: &DocView<'_>) -> Result<HashMap<Dot, Range<u64>>> {
    let mut builder = AnnotatedRangeBuilder::default();
    for segment in flat_segments(view) {
        match segment {
            FlatSegment::Open { block } => {
                if view
                    .node(block)
                    .is_some_and(|node| node.spec().is_textblock())
                {
                    builder.textblock_emitted.push(false);
                }
            }
            FlatSegment::Close { block } => {
                if view
                    .node(block)
                    .is_some_and(|node| node.spec().is_textblock())
                {
                    let emitted = builder
                        .textblock_emitted
                        .pop()
                        .ok_or(PublicationError::DegradedProjection)?;
                    if emitted {
                        builder.pending_boundary = true;
                    } else {
                        builder.pending_empty_blocks += 1;
                    }
                }
                if !block.is_synthetic() {
                    builder
                        .ranges
                        .entry(block)
                        .or_insert(builder.offset..builder.offset);
                }
            }
            FlatSegment::Text { block, leaves } => {
                let owner = semantic_owner_for_block(view, block)
                    .ok_or(PublicationError::DegradedProjection)?;
                let text: String = leaves
                    .into_iter()
                    .filter_map(|dot| view.leaf(dot).and_then(|leaf| leaf.as_char()))
                    .collect();
                builder.emit_owned(owner, &text);
            }
            FlatSegment::Break { leaf } => {
                let owner = top_level_owner_for_leaf(view, leaf)
                    .ok_or(PublicationError::DegradedProjection)?;
                builder.emit_owned(owner, "\n");
            }
            FlatSegment::Atom { leaf } => {
                if view
                    .leaf(leaf)
                    .is_some_and(|leaf| leaf.node_type() == NodeType::HorizontalRule)
                {
                    let owner = top_level_owner_for_leaf(view, leaf)
                        .ok_or(PublicationError::DegradedProjection)?;
                    builder.emit_divider(owner);
                } else if !leaf.is_synthetic() {
                    let owner = top_level_owner_for_leaf(view, leaf)
                        .ok_or(PublicationError::DegradedProjection)?;
                    builder
                        .ranges
                        .entry(owner)
                        .or_insert(builder.offset..builder.offset);
                }
            }
        }
    }
    if !builder.textblock_emitted.is_empty() || builder.text != prose_annotated(view).text() {
        return Err(PublicationError::DegradedProjection);
    }
    Ok(builder.ranges)
}

fn top_level_owner_for_leaf(view: &DocView<'_>, leaf: Dot) -> Option<Dot> {
    let block = view.block_of(leaf)?;
    if view.node(block)?.node_type() == NodeType::Root {
        Some(leaf)
    } else {
        semantic_owner_for_block(view, block)
    }
}

fn semantic_owner_for_block(view: &DocView<'_>, block: Dot) -> Option<Dot> {
    let node = view.node(block)?;
    if node.node_type() == NodeType::Paragraph && node.dot().is_some_and(|dot| !dot.is_synthetic())
    {
        Some(block)
    } else {
        top_level_owner_for_block(view, block)
    }
}

fn top_level_owner_for_block(view: &DocView<'_>, mut block: Dot) -> Option<Dot> {
    loop {
        let parent = view.parent_of(block)?;
        if view.node(parent)?.node_type() == NodeType::Root {
            return Some(block);
        }
        block = parent;
    }
}

fn decode_paragraph_inlines(
    paragraph: NodeView<'_>,
    diagnostic_block_id: &str,
    diagnostics: &mut Vec<MadiSemanticDiagnostic>,
) -> std::result::Result<Vec<MadiSemanticInline>, ()> {
    let mut runs: Vec<(InlineStyle, String)> = Vec::new();
    let mut unsupported_modifier = false;
    for (slot, child) in paragraph.children().enumerate() {
        let ChildView::Leaf(leaf) = child else {
            return Err(());
        };
        if leaf.dot().is_synthetic() {
            continue;
        }
        let Some(character) = leaf.as_char() else {
            return Err(());
        };
        let effective = paragraph
            .leaf_state_at(slot)
            .map(|state| state.eff)
            .ok_or(())?;
        let (style, unsupported) = inline_style(effective.values());
        unsupported_modifier |= unsupported;
        match runs.last_mut() {
            Some((previous, text)) if previous == &style => text.push(character),
            _ => runs.push((style, character.to_string())),
        }
    }
    if unsupported_modifier
        && !diagnostics.iter().any(|diagnostic| {
            diagnostic.code == MadiSemanticDiagnosticCode::UnsupportedInlineModifier
                && diagnostic.block_id == diagnostic_block_id
        })
    {
        diagnostics.push(MadiSemanticDiagnostic {
            code: MadiSemanticDiagnosticCode::UnsupportedInlineModifier,
            block_id: diagnostic_block_id.to_owned(),
        });
    }
    Ok(runs
        .into_iter()
        .map(|(style, text)| inline_run(style, text))
        .collect())
}

fn inline_style<'a>(modifiers: impl Iterator<Item = &'a Modifier>) -> (InlineStyle, bool) {
    let mut style = InlineStyle {
        strong: false,
        emphasis: false,
        underline: false,
        strike: false,
        ruby: None,
    };
    let mut unsupported = false;
    for modifier in modifiers {
        match modifier {
            Modifier::Bold => style.strong = true,
            Modifier::Italic => style.emphasis = true,
            Modifier::Underline => style.underline = true,
            Modifier::Strikethrough => style.strike = true,
            Modifier::Ruby { text } => style.ruby = Some(text.clone()),
            _ => unsupported = true,
        }
    }
    (style, unsupported)
}

fn inline_run(style: InlineStyle, text: String) -> MadiSemanticInline {
    let mut inline = MadiSemanticInline::Text { text };
    if let Some(annotation) = style.ruby {
        inline = MadiSemanticInline::Ruby {
            annotation,
            children: vec![inline],
        };
    }
    if style.strike {
        inline = MadiSemanticInline::Strike {
            children: vec![inline],
        };
    }
    if style.underline {
        inline = MadiSemanticInline::Underline {
            children: vec![inline],
        };
    }
    if style.emphasis {
        inline = MadiSemanticInline::Emphasis {
            children: vec![inline],
        };
    }
    if style.strong {
        inline = MadiSemanticInline::Strong {
            children: vec![inline],
        };
    }
    inline
}

fn push_unsupported(
    blocks: &mut Vec<MadiSemanticBlock>,
    diagnostics: &mut Vec<MadiSemanticDiagnostic>,
    block_id: String,
    range: Option<&Range<u64>>,
    node_type: String,
    text: String,
) {
    diagnostics.push(MadiSemanticDiagnostic {
        code: MadiSemanticDiagnosticCode::UnsupportedBlock,
        block_id: block_id.clone(),
    });
    blocks.push(MadiSemanticBlock::Unsupported {
        source: semantic_source(block_id, range),
        node_type,
        text,
    });
}

fn semantic_source(block_id: String, range: Option<&Range<u64>>) -> MadiSemanticSource {
    MadiSemanticSource {
        block_id,
        start: range.map(|range| range.start),
        end: range.map(|range| range.end),
        occurrence: 0,
        verified: range.is_some(),
    }
}

fn public_block_id(document_id: &str, dot: Dot) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"madi-publication-block-v1\0");
    hasher.update(document_id.as_bytes());
    hasher.update(b"\0");
    hasher.update(dot.to_string().as_bytes());
    format!("{:x}", hasher.finalize())
}

fn contains_authored_content(node: NodeView<'_>) -> bool {
    node.descendants().any(|child| match child {
        ChildView::Block(block) => block.dot().is_some_and(|dot| !dot.is_synthetic()),
        ChildView::Leaf(leaf) => !leaf.dot().is_synthetic(),
    })
}

fn node_fallback_text(node: NodeView<'_>) -> String {
    let mut output = String::new();
    append_node_text(node, &mut output);
    output
}

fn append_node_text(node: NodeView<'_>, output: &mut String) {
    let mut previous_block = false;
    for child in node.children() {
        match child {
            ChildView::Block(block) => {
                if previous_block && !output.ends_with('\n') {
                    output.push('\n');
                }
                append_node_text(block, output);
                previous_block = true;
            }
            ChildView::Leaf(leaf) => {
                output.push_str(&leaf_fallback_text(&leaf));
                previous_block = false;
            }
        }
    }
}

fn leaf_fallback_text(leaf: &editor_model::LeafView<'_>) -> String {
    match leaf.item() {
        SeqItem::Char(character) => character.to_string(),
        SeqItem::Atom(AtomLeaf::HardBreak) => "\n".to_owned(),
        SeqItem::Atom(AtomLeaf::Tab) => "\t".to_owned(),
        _ => String::new(),
    }
}

fn node_type_token(node_type: NodeType) -> String {
    match node_type {
        NodeType::Root => "root",
        NodeType::Paragraph => "paragraph",
        NodeType::Blockquote => "blockquote",
        NodeType::Callout => "callout",
        NodeType::Text => "text",
        NodeType::BulletList => "bullet_list",
        NodeType::OrderedList => "ordered_list",
        NodeType::ListItem => "list_item",
        NodeType::Fold => "fold",
        NodeType::FoldTitle => "fold_title",
        NodeType::FoldContent => "fold_content",
        NodeType::Table => "table",
        NodeType::TableRow => "table_row",
        NodeType::TableCell => "table_cell",
        NodeType::Image => "image",
        NodeType::File => "file",
        NodeType::Embed => "embed",
        NodeType::Archived => "archived",
        NodeType::HardBreak => "hard_break",
        NodeType::HorizontalRule => "horizontal_rule",
        NodeType::PageBreak => "page_break",
        NodeType::Tab => "tab",
        NodeType::Unknown => "unknown",
    }
    .to_owned()
}

fn validate_semantic_document(document: &MadiSemanticDocument) -> Result<()> {
    if document.format_version != 1 {
        return Err(PublicationError::InvalidDocument(
            "semantic format version is unsupported".to_owned(),
        ));
    }
    let mut block_ids = std::collections::HashSet::new();
    for block in &document.blocks {
        let source = block.source();
        if source.block_id.is_empty()
            || !block_ids.insert(source.block_id.as_str())
            || match (source.start, source.end, source.verified) {
                (None, None, false) => false,
                (Some(start), Some(end), true) => start > end,
                _ => true,
            }
        {
            return Err(PublicationError::InvalidDocument(
                "semantic source identity is invalid".to_owned(),
            ));
        }
        match block {
            MadiSemanticBlock::Paragraph { inlines, .. }
            | MadiSemanticBlock::Quote { inlines, .. } => {
                validate_inlines(inlines, 0)?;
            }
            MadiSemanticBlock::SceneBreak { semantic_id, .. } => {
                if semantic_id != SCENE_BREAK_SEMANTIC_ID {
                    return Err(PublicationError::InvalidDocument(
                        "scene-break semantic identity is invalid".to_owned(),
                    ));
                }
            }
            MadiSemanticBlock::Unsupported { node_type, .. } => {
                if node_type.is_empty() {
                    return Err(PublicationError::InvalidDocument(
                        "unsupported node type is empty".to_owned(),
                    ));
                }
            }
        }
    }
    Ok(())
}

fn validate_inlines(inlines: &[MadiSemanticInline], depth: usize) -> Result<()> {
    if depth > 16 {
        return Err(PublicationError::InvalidDocument(
            "inline nesting exceeds the supported depth".to_owned(),
        ));
    }
    for inline in inlines {
        match inline {
            MadiSemanticInline::Text { .. } => {}
            MadiSemanticInline::Strong { children }
            | MadiSemanticInline::Emphasis { children }
            | MadiSemanticInline::Underline { children }
            | MadiSemanticInline::Strike { children } => {
                if children.is_empty() {
                    return Err(PublicationError::InvalidDocument(
                        "inline wrapper is empty".to_owned(),
                    ));
                }
                validate_inlines(children, depth + 1)?;
            }
            MadiSemanticInline::Ruby {
                annotation,
                children,
            } => {
                if annotation.is_empty() || children.is_empty() {
                    return Err(PublicationError::InvalidDocument(
                        "ruby inline is incomplete".to_owned(),
                    ));
                }
                validate_inlines(children, depth + 1)?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use editor_codec::{ReencodableChangesets, encode_changesets};
    use editor_crdt::{Changeset, Dot, ListOp, Op};
    use editor_model::{
        Anchor, Bias, EditOp, HorizontalRuleVariant, Modifier, NodeType, PlainBlockquoteNode,
        PlainDoc, PlainHorizontalRuleNode, PlainNode, PlainNodeEntry, PlainParagraphNode,
        PlainRootNode, PlainTabNode, PlainTextNode, SeqItem, SpanOp,
    };
    use editor_state::State;

    use super::*;

    fn snapshot(ops: Vec<Op<EditOp>>) -> Vec<u8> {
        encode_changesets(ReencodableChangesets::from_local_ops(vec![Changeset {
            ops,
        }]))
        .unwrap()
    }

    fn linear_document() -> Vec<u8> {
        let paragraph = Dot::new(7, 0);
        let first = Dot::new(7, 1);
        let second = Dot::new(7, 2);
        let scene_break = Dot::new(7, 4);
        snapshot(vec![
            Op {
                id: paragraph,
                parents: vec![],
                payload: EditOp::Seq(ListOp::Ins {
                    pos: 0,
                    item: SeqItem::Block {
                        node_type: NodeType::Paragraph,
                        parents: vec![Dot::ROOT],
                        attrs: vec![],
                    },
                }),
            },
            Op {
                id: first,
                parents: vec![paragraph],
                payload: EditOp::Seq(ListOp::Ins {
                    pos: 1,
                    item: SeqItem::Char('가'),
                }),
            },
            Op {
                id: second,
                parents: vec![first],
                payload: EditOp::Seq(ListOp::Ins {
                    pos: 2,
                    item: SeqItem::Char('나'),
                }),
            },
            Op {
                id: Dot::new(7, 3),
                parents: vec![second],
                payload: EditOp::Span(SpanOp::AddSpan {
                    start: Anchor {
                        id: first,
                        bias: Bias::Before,
                    },
                    end: Anchor {
                        id: second,
                        bias: Bias::After,
                    },
                    modifier: Modifier::Bold,
                }),
            },
            Op {
                id: scene_break,
                parents: vec![Dot::new(7, 3)],
                payload: EditOp::Seq(ListOp::Ins {
                    pos: 3,
                    item: SeqItem::BlockAtom {
                        leaf: AtomLeaf::HorizontalRule {
                            variant: HorizontalRuleVariant::ThreeDiamonds,
                        },
                        parents: vec![Dot::ROOT],
                    },
                }),
            },
        ])
    }

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

    fn paragraph(text: &str) -> PlainNodeEntry {
        entry(
            PlainNode::Paragraph(PlainParagraphNode {}),
            vec![entry(
                PlainNode::Text(PlainTextNode {
                    text: text.to_owned(),
                }),
                Vec::new(),
            )],
        )
    }

    #[test]
    fn decodes_authored_paragraph_inline_and_scene_break_with_dot_ids() {
        let document = decode_typie_snapshot("document-a", &linear_document()).unwrap();
        assert_eq!(document.blocks.len(), 2);
        let MadiSemanticBlock::Paragraph { source, inlines } = &document.blocks[0] else {
            panic!("paragraph expected")
        };
        assert_eq!(source.block_id.len(), 64);
        assert_ne!(source.block_id, Dot::new(7, 0).to_string());
        assert_eq!(source.start, Some(0));
        assert_eq!(source.end, Some(2));
        assert!(source.verified);
        assert!(matches!(
            inlines.as_slice(),
            [MadiSemanticInline::Strong { .. }]
        ));
        assert!(matches!(
            &document.blocks[1],
            MadiSemanticBlock::SceneBreak { semantic_id, .. }
                if semantic_id == SCENE_BREAK_SEMANTIC_ID
        ));
    }

    #[test]
    fn empty_stream_is_the_uninitialized_empty_document() {
        let document = decode_typie_snapshot("document-a", &[]).unwrap();
        assert!(document.blocks.is_empty());
        assert!(document.diagnostics.is_empty());
    }

    #[test]
    fn namespaces_identical_typie_dots_by_document_id() {
        let snapshot = linear_document();
        let first = decode_typie_snapshot("scene-document-a", &snapshot).unwrap();
        let second = decode_typie_snapshot("scene-document-b", &snapshot).unwrap();
        assert_ne!(
            first.blocks[0].source().block_id,
            second.blocks[0].source().block_id
        );
    }

    #[test]
    fn maps_duplicate_korean_emoji_and_scene_break_to_exact_annotated_ranges() {
        let snapshot = snapshot_from_plain(vec![
            paragraph("중복🙂"),
            paragraph("중복🙂"),
            entry(
                PlainNode::HorizontalRule(PlainHorizontalRuleNode {
                    variant: HorizontalRuleVariant::ThreeDiamonds,
                }),
                Vec::new(),
            ),
        ]);
        let document = decode_typie_snapshot("document-a", &snapshot).unwrap();
        assert_eq!(
            document.blocks.len(),
            3,
            "synthetic trailing scaffold is skipped"
        );
        assert_eq!(
            (
                document.blocks[0].source().start,
                document.blocks[0].source().end
            ),
            (Some(0), Some(3))
        );
        assert_eq!(
            (
                document.blocks[1].source().start,
                document.blocks[1].source().end
            ),
            (Some(5), Some(8))
        );
        assert_eq!(
            (
                document.blocks[2].source().start,
                document.blocks[2].source().end
            ),
            (Some(10), Some(13))
        );
        assert_ne!(
            document.blocks[0].source().block_id,
            document.blocks[1].source().block_id
        );
    }

    #[test]
    fn maps_each_blockquote_paragraph_to_its_exact_annotated_range() {
        let snapshot = snapshot_from_plain(vec![entry(
            PlainNode::Blockquote(PlainBlockquoteNode::default()),
            vec![paragraph("인용🙂"), paragraph("인용🙂")],
        )]);
        let document = decode_typie_snapshot("document-quote", &snapshot).unwrap();
        assert_eq!(document.blocks.len(), 2);
        assert!(
            document
                .blocks
                .iter()
                .all(|block| matches!(block, MadiSemanticBlock::Quote { .. }))
        );
        assert_eq!(
            (
                document.blocks[0].source().start,
                document.blocks[0].source().end
            ),
            (Some(0), Some(3))
        );
        assert_eq!(
            (
                document.blocks[1].source().start,
                document.blocks[1].source().end
            ),
            (Some(5), Some(8))
        );
        assert!(document.blocks.iter().all(|block| block.source().verified));
        assert_ne!(
            document.blocks[0].source().block_id,
            document.blocks[1].source().block_id
        );
    }

    #[test]
    fn assigns_verified_zero_length_boundaries_to_empty_and_unsupported_blocks() {
        let snapshot = snapshot_from_plain(vec![
            paragraph(""),
            entry(
                PlainNode::Paragraph(PlainParagraphNode {}),
                vec![entry(PlainNode::Tab(PlainTabNode {}), Vec::new())],
            ),
        ]);
        let document = decode_typie_snapshot("document-empty", &snapshot).unwrap();
        assert_eq!(document.blocks.len(), 2);
        assert!(matches!(
            document.blocks[0],
            MadiSemanticBlock::Paragraph { .. }
        ));
        assert!(matches!(
            document.blocks[1],
            MadiSemanticBlock::Unsupported { .. }
        ));
        let empty_source = document.blocks[0].source();
        assert!(empty_source.verified);
        assert_eq!(empty_source.start, empty_source.end);
        let unsupported_source = document.blocks[1].source();
        assert!(unsupported_source.verified);
        assert!(unsupported_source.start <= unsupported_source.end);
    }
}
