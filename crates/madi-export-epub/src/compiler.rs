use std::collections::{BTreeSet, HashSet};
use std::fmt::Write as _;
use std::io::{Cursor, Write};
use std::path::Path;
use std::time::Instant;

use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngEncoder;
use image::{ExtendedColorType, ImageEncoder as _, ImageFormat};
use madi_publication::{
    PublicationBlock, PublicationDocument, PublicationInline, canonical_publication_document,
    validate_publication_document,
};
use sha2::{Digest, Sha256};
use tempfile::{Builder as TempfileBuilder, NamedTempFile};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipWriter};

use crate::model::{
    CancellationToken, CompiledEpub, EpubBodyStyleToken, EpubCompileSummary, EpubCoverInput,
    EpubCoverMediaType, EpubError, EpubExportRequest, EpubExportResult, EpubExportTiming,
    EpubPackageStatistics, EpubProgressEvent, EpubProgressStage, EpubSceneBreakStyleToken,
    EpubSplitMode, EpubStylesheetToken, EpubValidationMessage, EpubValidationReport,
    EpubValidationSeverity, EpubValidationStatus, Result,
};
use crate::validator::{EpubValidationExpectation, ExpectedBlock, validate_epub_with_expectation};
use crate::{
    EPUB_CONTAINER_PATH, EPUB_MIMETYPE, EPUB_NAV_PATH, EPUB_PACKAGE_PATH, EPUB_STYLESHEET_PATH,
};

const MAX_METADATA_CHARACTERS: usize = 10_000;
const MAX_SUBJECTS: usize = 256;
const MAX_COVER_BYTES: usize = 10 * 1024 * 1024;
const MAX_COVER_DIMENSION: u32 = 10_000;
const MAX_COVER_PIXELS: u64 = 40_000_000;
const MAX_EXPORT_FILES: usize = 25_010;
const MAX_EXPORT_WARNINGS: usize = 1_000;

#[derive(Debug, Clone)]
struct ContentSlice {
    section_index: usize,
    start: usize,
    end: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UnitKind {
    Chapter,
    Scene,
}

#[derive(Debug, Clone)]
struct ContentUnit {
    kind: UnitKind,
    key: String,
    title: String,
    chapter_parent_titles: Option<Vec<String>>,
    slices: Vec<ContentSlice>,
    filename: String,
    anchor_id: String,
}

#[derive(Debug, Clone)]
struct TocItem {
    level: u8,
    label: String,
    href: String,
}

#[derive(Debug, Clone)]
struct PackageEntry {
    path: String,
    bytes: Vec<u8>,
    compression: CompressionMethod,
}

#[derive(Debug, Clone)]
struct PreparedCover {
    media_type: EpubCoverMediaType,
    bytes: Vec<u8>,
}

#[derive(Debug)]
struct GeneratedContent {
    entries: Vec<PackageEntry>,
    toc: Vec<TocItem>,
    expectation: EpubValidationExpectation,
    warnings: EpubValidationReport,
    statistics: EpubPackageStatistics,
}

pub fn compile_epub_bytes(
    document: &PublicationDocument,
    request: &EpubExportRequest,
    cancellation: &CancellationToken,
) -> Result<CompiledEpub> {
    compile_epub_bytes_with_progress(document, request, cancellation, |_| {})
}

pub fn compile_epub_bytes_with_progress<F>(
    document: &PublicationDocument,
    request: &EpubExportRequest,
    cancellation: &CancellationToken,
    mut progress: F,
) -> Result<CompiledEpub>
where
    F: FnMut(EpubProgressEvent),
{
    let total_started = Instant::now();
    cancellation.check()?;
    emit_progress(&mut progress, EpubProgressStage::PublicationIr, 0, 1);
    validate_request(document, request)?;
    emit_progress(&mut progress, EpubProgressStage::PublicationIr, 1, 1);

    cancellation.check()?;
    let split_started = Instant::now();
    emit_progress(&mut progress, EpubProgressStage::ContentSplit, 0, 1);
    let units = split_content(document, request.options.split_mode);
    if units.is_empty() {
        return Err(EpubError::InvalidRequest(
            "publication scope must contain at least one section",
        ));
    }
    if units.len() + 5 + usize::from(request.options.include_cover) > MAX_EXPORT_FILES {
        return Err(EpubError::InvalidRequest(
            "publication produces too many EPUB files",
        ));
    }
    let content_split_ms = elapsed_ms(split_started);
    emit_progress(&mut progress, EpubProgressStage::ContentSplit, 1, 1);

    cancellation.check()?;
    let xhtml_started = Instant::now();
    let mut generated = generate_content(document, request, &units, cancellation, &mut progress)?;
    let xhtml_generation_ms = elapsed_ms(xhtml_started);

    cancellation.check()?;
    let package_documents_started = Instant::now();
    emit_progress(&mut progress, EpubProgressStage::PackageDocuments, 0, 1);
    let cover_input = request
        .cover
        .as_ref()
        .filter(|_| request.options.include_cover);
    if request.options.include_cover && cover_input.is_none() {
        return Err(EpubError::InvalidRequest(
            "includeCover requires validated cover bytes",
        ));
    }
    let cover = cover_input.map(prepare_cover).transpose()?;
    let modified = deterministic_modified(document.project_revision)?;
    let package = generate_package_document(request, &units, cover.as_ref(), &modified)?;
    let nav = generate_navigation_document(request, &generated.toc)?;
    let stylesheet = stylesheet(&request.options).into_bytes();
    let mut entries = Vec::with_capacity(generated.entries.len() + 6);
    entries.push(PackageEntry {
        path: "mimetype".to_owned(),
        bytes: EPUB_MIMETYPE.to_vec(),
        compression: CompressionMethod::Stored,
    });
    entries.push(PackageEntry {
        path: EPUB_CONTAINER_PATH.to_owned(),
        bytes: container_document().as_bytes().to_vec(),
        compression: CompressionMethod::Deflated,
    });
    entries.push(PackageEntry {
        path: EPUB_PACKAGE_PATH.to_owned(),
        bytes: package.into_bytes(),
        compression: CompressionMethod::Deflated,
    });
    entries.push(PackageEntry {
        path: EPUB_NAV_PATH.to_owned(),
        bytes: nav.into_bytes(),
        compression: CompressionMethod::Deflated,
    });
    entries.push(PackageEntry {
        path: EPUB_STYLESHEET_PATH.to_owned(),
        bytes: stylesheet,
        compression: CompressionMethod::Deflated,
    });
    entries.append(&mut generated.entries);
    if let Some(cover) = &cover {
        entries.push(PackageEntry {
            path: format!("EPUB/images/cover.{}", cover.media_type.extension()),
            bytes: cover.bytes.clone(),
            compression: CompressionMethod::Stored,
        });
    }
    generated.statistics.file_count = entries.len() as u64;
    generated.statistics.cover_included = cover.is_some();
    generated.expectation.expected_file_count = entries.len() as u64;
    generated.expectation.cover = cover.as_ref().map(|cover| {
        (
            format!("EPUB/images/cover.{}", cover.media_type.extension()),
            cover.media_type,
        )
    });
    generated.expectation.cover_expected = cover.is_some();
    let package_documents_ms = elapsed_ms(package_documents_started);
    emit_progress(&mut progress, EpubProgressStage::PackageDocuments, 1, 1);

    cancellation.check()?;
    let logical_package_hash = logical_package_hash(&entries);
    let zip_started = Instant::now();
    emit_progress(&mut progress, EpubProgressStage::ZipPackaging, 0, 1);
    let bytes = write_zip(&entries, cancellation)?;
    let zip_packaging_ms = elapsed_ms(zip_started);
    emit_progress(&mut progress, EpubProgressStage::ZipPackaging, 1, 1);

    cancellation.check()?;
    let validation_started = Instant::now();
    emit_progress(&mut progress, EpubProgressStage::InternalValidation, 0, 1);
    let mut report = validate_epub_with_expectation(&bytes, Some(&generated.expectation));
    report.append(generated.warnings);
    let internal_validation_ms = elapsed_ms(validation_started);
    emit_progress(&mut progress, EpubProgressStage::InternalValidation, 1, 1);
    if report.status == EpubValidationStatus::Fail {
        return Err(EpubError::ValidationFailed(report));
    }

    let sha256 = sha256_hex(&bytes);
    let summary = EpubCompileSummary {
        byte_length: bytes.len() as u64,
        sha256,
        logical_package_hash,
        target_profile: request.options.target_profile,
        source_publication_hash: request.source_publication_hash.clone(),
        validation_report: report,
        export_timing: EpubExportTiming {
            content_split_ms,
            xhtml_generation_ms,
            package_documents_ms,
            zip_packaging_ms,
            internal_validation_ms,
            total_ms: elapsed_ms(total_started),
        },
        statistics: generated.statistics,
    };
    Ok(CompiledEpub { bytes, summary })
}

pub fn export_epub(
    document: &PublicationDocument,
    request: &EpubExportRequest,
    cancellation: &CancellationToken,
) -> Result<EpubExportResult> {
    export_epub_with_progress(document, request, cancellation, |_| {})
}

pub fn export_epub_with_progress<F>(
    document: &PublicationDocument,
    request: &EpubExportRequest,
    cancellation: &CancellationToken,
    mut progress: F,
) -> Result<EpubExportResult>
where
    F: FnMut(EpubProgressEvent),
{
    export_epub_with_optional_operation(document, request, cancellation, None, &mut progress)
}

pub fn export_epub_for_operation_with_progress<F>(
    document: &PublicationDocument,
    request: &EpubExportRequest,
    operation_id: &str,
    cancellation: &CancellationToken,
    mut progress: F,
) -> Result<EpubExportResult>
where
    F: FnMut(EpubProgressEvent),
{
    if !valid_operation_id(operation_id) {
        return Err(EpubError::InvalidRequest(
            "operationId must be a canonical lowercase UUID",
        ));
    }
    export_epub_with_optional_operation(
        document,
        request,
        cancellation,
        Some(operation_id),
        &mut progress,
    )
}

fn export_epub_with_optional_operation<F>(
    document: &PublicationDocument,
    request: &EpubExportRequest,
    cancellation: &CancellationToken,
    operation_id: Option<&str>,
    progress: &mut F,
) -> Result<EpubExportResult>
where
    F: FnMut(EpubProgressEvent),
{
    let export_started = Instant::now();
    validate_destination(&request.output_path)?;
    if request.output_path.exists() && !request.replace_existing {
        return Err(EpubError::DestinationExists);
    }
    let mut compiled =
        compile_epub_bytes_with_progress(document, request, cancellation, &mut *progress)?;
    cancellation.check()?;
    let parent = request
        .output_path
        .parent()
        .ok_or(EpubError::InvalidDestination)?;
    let mut temporary = if let Some(operation_id) = operation_id {
        TempfileBuilder::new()
            .prefix(&format!(".madi-epub-{operation_id}"))
            .suffix(".tmp")
            .rand_bytes(0)
            .tempfile_in(parent)
            .map_err(|_| EpubError::Output)?
    } else {
        NamedTempFile::new_in(parent).map_err(|_| EpubError::Output)?
    };
    // WRITE_OUTPUT begins only after this process owns the create-new temp path.
    // The desktop parent uses this event as its cleanup ownership boundary.
    emit_progress(progress, EpubProgressStage::WriteOutput, 0, 1);
    temporary
        .write_all(&compiled.bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| EpubError::Output)?;
    let persisted_candidate = std::fs::read(temporary.path()).map_err(|_| EpubError::Output)?;
    if persisted_candidate.len() != compiled.bytes.len()
        || sha256_hex(&persisted_candidate) != compiled.summary.sha256
    {
        return Err(EpubError::Output);
    }
    cancellation.check()?;
    if request.replace_existing {
        temporary
            .persist(&request.output_path)
            .map_err(|_| EpubError::Output)?;
    } else {
        temporary
            .persist_noclobber(&request.output_path)
            .map_err(|error| {
                if error.error.kind() == std::io::ErrorKind::AlreadyExists {
                    EpubError::DestinationExists
                } else {
                    EpubError::Output
                }
            })?;
    }

    compiled.summary.export_timing.total_ms = elapsed_ms(export_started);
    emit_progress(progress, EpubProgressStage::WriteOutput, 1, 1);
    emit_progress(progress, EpubProgressStage::Complete, 1, 1);
    Ok(EpubExportResult {
        output_path: request.output_path.clone(),
        byte_length: compiled.summary.byte_length,
        sha256: compiled.summary.sha256,
        logical_package_hash: compiled.summary.logical_package_hash,
        target_profile: compiled.summary.target_profile,
        source_publication_hash: compiled.summary.source_publication_hash,
        validation_report: compiled.summary.validation_report,
        export_timing: compiled.summary.export_timing,
        statistics: compiled.summary.statistics,
    })
}

pub fn operation_temporary_path(
    request: &EpubExportRequest,
    operation_id: &str,
) -> Result<std::path::PathBuf> {
    validate_destination(&request.output_path)?;
    if !valid_operation_id(operation_id) {
        return Err(EpubError::InvalidRequest(
            "operationId must be a canonical lowercase UUID",
        ));
    }
    Ok(request
        .output_path
        .parent()
        .ok_or(EpubError::InvalidDestination)?
        .join(format!(".madi-epub-{operation_id}.tmp")))
}

fn validate_request(document: &PublicationDocument, request: &EpubExportRequest) -> Result<()> {
    validate_publication_document(document).map_err(|_| EpubError::InvalidPublication)?;
    if request.project_id != document.project_id
        || request.scope_node_id != document.scope_node_id
        || request.expected_project_revision != document.project_revision
    {
        return Err(EpubError::PublicationMismatch);
    }
    let canonical =
        canonical_publication_document(document).map_err(|_| EpubError::InvalidPublication)?;
    if !is_lower_hex_hash(&request.source_publication_hash)
        || sha256_hex(canonical.as_bytes()) != request.source_publication_hash
    {
        return Err(EpubError::PublicationMismatch);
    }
    let metadata = &request.metadata;
    if !valid_metadata_value(&metadata.title, false)
        || !valid_metadata_value(&metadata.creator_name, false)
        || !valid_metadata_value(&metadata.identifier, false)
        || !valid_language(&metadata.language)
        || metadata.subjects.len() > MAX_SUBJECTS
        || metadata
            .subjects
            .iter()
            .any(|subject| !valid_metadata_value(subject, false))
        || [
            metadata.publisher.as_deref(),
            metadata.description.as_deref(),
            metadata.rights.as_deref(),
        ]
        .into_iter()
        .flatten()
        .any(|value| !valid_metadata_value(value, false))
        || request.options.toc_depth == 0
        || request.options.toc_depth > 4
        || request.options.include_cover != request.cover.is_some()
    {
        return Err(EpubError::InvalidRequest(
            "metadata, options, or cover selection is invalid",
        ));
    }
    validate_xml_strings(document)?;
    validate_exportable_blocks(document)?;
    deterministic_modified(document.project_revision)?;
    Ok(())
}

fn validate_exportable_blocks(document: &PublicationDocument) -> Result<()> {
    let mut report = EpubValidationReport::default();
    for section in &document.sections {
        for block in &section.blocks {
            let PublicationBlock::Unsupported {
                node_type,
                text,
                source,
                ..
            } = block
            else {
                continue;
            };
            if text.trim().is_empty() {
                report.push(EpubValidationMessage {
                    code: "EPUB_UNSUPPORTED_BLOCK_CONTENT_LOSS".to_owned(),
                    severity: EpubValidationSeverity::Error,
                    description: format!(
                        "{} 블록에 안전하게 내보낼 텍스트가 없어 EPUB 생성을 중단했습니다.",
                        safe_node_type_label(node_type)
                    ),
                    source_node_id: Some(source.source_node_id.clone()),
                    epub_path: None,
                    suggestion: Some(
                        "해당 블록을 지원되는 원고 텍스트로 바꾸거나 EPUB에서 제외한 뒤 다시 시도하세요."
                            .to_owned(),
                    ),
                });
                if report.messages.len() == MAX_EXPORT_WARNINGS {
                    return Err(EpubError::ValidationFailed(report));
                }
            }
        }
    }
    if report.status == EpubValidationStatus::Fail {
        Err(EpubError::ValidationFailed(report))
    } else {
        Ok(())
    }
}

fn validate_xml_strings(document: &PublicationDocument) -> Result<()> {
    ensure_xml_text(&document.metadata.title)?;
    if let Some(author) = &document.metadata.author_name {
        ensure_xml_text(author)?;
    }
    for section in &document.sections {
        ensure_xml_text(&section.title)?;
        for title in &section.parent_titles {
            ensure_xml_text(title)?;
        }
        for block in &section.blocks {
            match block {
                PublicationBlock::Heading { text, .. }
                | PublicationBlock::Unsupported { text, .. } => ensure_xml_text(text)?,
                PublicationBlock::Paragraph { inlines, .. }
                | PublicationBlock::Quote { inlines, .. } => ensure_inline_xml(inlines)?,
                PublicationBlock::SceneBreak { .. } => {}
            }
        }
    }
    Ok(())
}

fn ensure_inline_xml(inlines: &[PublicationInline]) -> Result<()> {
    for inline in inlines {
        match inline {
            PublicationInline::Text { text } => ensure_xml_text(text)?,
            PublicationInline::Strong { children }
            | PublicationInline::Emphasis { children }
            | PublicationInline::Underline { children }
            | PublicationInline::Strike { children } => ensure_inline_xml(children)?,
            PublicationInline::Ruby {
                annotation,
                children,
            } => {
                ensure_xml_text(annotation)?;
                ensure_inline_xml(children)?;
            }
        }
    }
    Ok(())
}

fn split_content(document: &PublicationDocument, mode: EpubSplitMode) -> Vec<ContentUnit> {
    let mut units = Vec::new();
    match mode {
        EpubSplitMode::Scene => {
            for (section_index, section) in document.sections.iter().enumerate() {
                let key = format!("scene:{}", section.id);
                units.push(ContentUnit {
                    kind: UnitKind::Scene,
                    key: key.clone(),
                    title: section.title.clone(),
                    chapter_parent_titles: None,
                    slices: vec![ContentSlice {
                        section_index,
                        start: 0,
                        end: section.blocks.len(),
                    }],
                    filename: String::new(),
                    anchor_id: stable_export_id("section", &section.id),
                });
            }
        }
        EpubSplitMode::Chapter => {
            for (section_index, section) in document.sections.iter().enumerate() {
                let chapter_positions: Vec<_> = section
                    .blocks
                    .iter()
                    .enumerate()
                    .filter_map(|(index, block)| match block {
                        PublicationBlock::Heading {
                            level: 3,
                            text,
                            source,
                            ..
                        } => Some((index, text.clone(), source.source_node_id.clone())),
                        _ => None,
                    })
                    .collect();
                if chapter_positions.is_empty() {
                    let starts_binder_boundary = section.blocks.iter().any(|block| {
                        matches!(block, PublicationBlock::Heading { level: 1 | 2, .. })
                    });
                    if let Some(current) = units.last_mut().filter(|unit| {
                        !starts_binder_boundary
                            && unit.kind == UnitKind::Chapter
                            && unit.chapter_parent_titles.as_ref() == Some(&section.parent_titles)
                    }) {
                        current.slices.push(ContentSlice {
                            section_index,
                            start: 0,
                            end: section.blocks.len(),
                        });
                    } else {
                        let key = format!("scene:{}", section.id);
                        units.push(ContentUnit {
                            kind: UnitKind::Scene,
                            key,
                            title: section.title.clone(),
                            chapter_parent_titles: None,
                            slices: vec![ContentSlice {
                                section_index,
                                start: 0,
                                end: section.blocks.len(),
                            }],
                            filename: String::new(),
                            anchor_id: stable_export_id("section", &section.id),
                        });
                    }
                    continue;
                }
                for (position_index, (block_index, title, source_node_id)) in
                    chapter_positions.iter().enumerate()
                {
                    let start = if position_index == 0 { 0 } else { *block_index };
                    let end = chapter_positions
                        .get(position_index + 1)
                        .map_or(section.blocks.len(), |next| next.0);
                    let heading = &section.blocks[*block_index];
                    let anchor_id = block_export_id(heading);
                    units.push(ContentUnit {
                        kind: UnitKind::Chapter,
                        key: format!("chapter:{source_node_id}"),
                        title: title.clone(),
                        chapter_parent_titles: Some(section.parent_titles.clone()),
                        slices: vec![ContentSlice {
                            section_index,
                            start,
                            end,
                        }],
                        filename: String::new(),
                        anchor_id,
                    });
                }
            }
        }
    }
    for (index, unit) in units.iter_mut().enumerate() {
        let prefix = match unit.kind {
            UnitKind::Chapter => "chapter",
            UnitKind::Scene => "scene",
        };
        unit.filename = format!(
            "{prefix}-{:04}-{}.xhtml",
            index + 1,
            &sha256_hex(unit.key.as_bytes())[..12]
        );
    }
    units
}

fn generate_content<F>(
    document: &PublicationDocument,
    request: &EpubExportRequest,
    units: &[ContentUnit],
    cancellation: &CancellationToken,
    progress: &mut F,
) -> Result<GeneratedContent>
where
    F: FnMut(EpubProgressEvent),
{
    let mut entries = Vec::with_capacity(units.len());
    let mut toc = Vec::new();
    let mut expectation = EpubValidationExpectation::new(request.options.target_profile);
    expectation.expected_stylesheet = Some(stylesheet(&request.options));
    let mut warnings = EpubValidationReport::default();
    let mut exported_sections = BTreeSet::new();
    let mut statistics = EpubPackageStatistics {
        xhtml_count: units.len() as u64,
        source_section_count: document.sections.len() as u64,
        source_block_count: document
            .sections
            .iter()
            .map(|section| section.blocks.len() as u64)
            .sum(),
        ..EpubPackageStatistics::default()
    };
    emit_progress(
        progress,
        EpubProgressStage::XhtmlGeneration,
        0,
        units.len() as u64,
    );
    for (unit_index, unit) in units.iter().enumerate() {
        cancellation.check()?;
        let path = format!("EPUB/text/{}", unit.filename);
        let mut body = String::new();
        let mut unit_toc = Vec::new();
        let mut opened_section: Option<usize> = None;
        for slice in &unit.slices {
            let section = &document.sections[slice.section_index];
            exported_sections.insert(section.id.clone());
            if opened_section != Some(slice.section_index) {
                if opened_section.is_some() {
                    body.push_str("</section>\n");
                }
                let section_id = stable_export_id("section", &section.id);
                write!(
                    body,
                    "<section id=\"{}\" class=\"scene\">\n",
                    xml_attr(&section_id)?
                )
                .map_err(|_| EpubError::Package)?;
                opened_section = Some(slice.section_index);
            }
            for block in &section.blocks[slice.start..slice.end] {
                let block_id = block_export_id(block);
                let expected_text = block_plain_text(block);
                let fallback = matches!(block, PublicationBlock::Unsupported { .. });
                if expectation
                    .blocks
                    .insert(
                        block_id.clone(),
                        ExpectedBlock {
                            source_node_id: block_source_node_id(block).to_owned(),
                            epub_path: Some(path.clone()),
                            character_count: expected_text.chars().count() as u64,
                            fallback,
                        },
                    )
                    .is_some()
                {
                    return Err(EpubError::InvalidPublication);
                }
                statistics.exported_block_count += 1;
                statistics.source_character_count += expected_text.chars().count() as u64;
                statistics.exported_character_count += expected_text.chars().count() as u64;
                match block {
                    PublicationBlock::Heading {
                        level,
                        text,
                        source,
                        ..
                    } => {
                        statistics.heading_count += 1;
                        let visible = match level {
                            3 => request.options.include_chapter_titles,
                            4 => request.options.include_scene_titles,
                            _ => true,
                        };
                        if visible {
                            write!(
                                body,
                                "<h{level} id=\"{}\">{}</h{level}>\n",
                                xml_attr(&block_id)?,
                                xml_text(text)?
                            )
                            .map_err(|_| EpubError::Package)?;
                        } else {
                            write!(
                                body,
                                "<span id=\"{}\" class=\"source-anchor\"></span>\n",
                                xml_attr(&block_id)?
                            )
                            .map_err(|_| EpubError::Package)?;
                        }
                        let include_in_toc = *level <= request.options.toc_depth
                            && match level {
                                3 => request.options.include_chapter_titles,
                                4 => request.options.include_scene_titles,
                                _ => true,
                            };
                        if include_in_toc {
                            unit_toc.push(TocItem {
                                level: *level,
                                label: text.clone(),
                                href: format!("text/{}#{block_id}", unit.filename),
                            });
                        }
                        expectation.heading_ids.insert(block_id.clone());
                        expectation
                            .heading_sources
                            .insert(block_id, source.source_node_id.clone());
                    }
                    PublicationBlock::Paragraph { inlines, .. } => {
                        write!(
                            body,
                            "<p id=\"{}\">{}</p>\n",
                            xml_attr(&block_id)?,
                            render_inlines(inlines, &mut statistics.ruby_count)?
                        )
                        .map_err(|_| EpubError::Package)?;
                    }
                    PublicationBlock::Quote { inlines, .. } => {
                        write!(
                            body,
                            "<blockquote id=\"{}\"><p>{}</p></blockquote>\n",
                            xml_attr(&block_id)?,
                            render_inlines(inlines, &mut statistics.ruby_count)?
                        )
                        .map_err(|_| EpubError::Package)?;
                    }
                    PublicationBlock::SceneBreak { .. } => {
                        statistics.scene_break_count += 1;
                        expectation.scene_break_ids.insert(block_id.clone());
                        write!(
                            body,
                            "<hr id=\"{}\" class=\"scene-break\" aria-label=\"장면 전환\" />\n",
                            xml_attr(&block_id)?
                        )
                        .map_err(|_| EpubError::Package)?;
                    }
                    PublicationBlock::Unsupported {
                        node_type,
                        text,
                        source,
                        ..
                    } => {
                        statistics.fallback_block_count += 1;
                        write!(
                            body,
                            "<p id=\"{}\" class=\"unsupported-fallback\">{}</p>\n",
                            xml_attr(&block_id)?,
                            xml_text(text)?
                        )
                        .map_err(|_| EpubError::Package)?;
                        if warnings.messages.len() < MAX_EXPORT_WARNINGS {
                            warnings.push(EpubValidationMessage {
                                code: "EPUB_UNSUPPORTED_BLOCK_FALLBACK".to_owned(),
                                severity: EpubValidationSeverity::Warning,
                                description: format!(
                                    "지원되지 않는 {} 블록을 안전한 일반 텍스트로 내보냈습니다.",
                                    safe_node_type_label(node_type)
                                ),
                                source_node_id: Some(source.source_node_id.clone()),
                                epub_path: Some(path.clone()),
                                suggestion: Some(
                                    "내보낸 EPUB에서 해당 블록의 의미와 배치를 확인하세요. 전체 fallback 수는 통계를 확인하세요."
                                        .to_owned(),
                                ),
                            });
                        }
                    }
                }
            }
        }
        if opened_section.is_some() {
            body.push_str("</section>\n");
        }
        expectation
            .toc_targets
            .extend(unit_toc.iter().map(|item| item.href.clone()));
        toc.extend(unit_toc);
        let title = xml_text(&unit.title)?;
        let language = xml_attr(&request.metadata.language)?;
        let xhtml = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
             <!DOCTYPE html>\n\
             <html xmlns=\"http://www.w3.org/1999/xhtml\" xml:lang=\"{language}\" lang=\"{language}\">\n\
             <head><meta charset=\"UTF-8\" /><title>{title}</title><link rel=\"stylesheet\" type=\"text/css\" href=\"../styles/book.css\" /></head>\n\
             <body>\n{body}</body>\n</html>\n"
        );
        entries.push(PackageEntry {
            path: path.clone(),
            bytes: xhtml.into_bytes(),
            compression: CompressionMethod::Deflated,
        });
        expectation.content_paths.push(path);
        emit_progress(
            progress,
            EpubProgressStage::XhtmlGeneration,
            (unit_index + 1) as u64,
            units.len() as u64,
        );
    }
    if toc.is_empty() {
        let first = units.first().ok_or(EpubError::InvalidPublication)?;
        let item = TocItem {
            level: 1,
            label: request.metadata.title.clone(),
            href: format!("text/{}#{}", first.filename, first.anchor_id),
        };
        expectation.toc_targets.push(item.href.clone());
        toc.push(item);
    }
    statistics.exported_section_count = exported_sections.len() as u64;
    expectation.source_section_count = statistics.source_section_count;
    expectation.exported_section_count = statistics.exported_section_count;
    expectation.source_block_count = statistics.source_block_count;
    expectation.source_character_count = statistics.source_character_count;
    expectation.scene_break_count = statistics.scene_break_count;
    expectation.ruby_count = statistics.ruby_count;
    expectation.heading_count = statistics.heading_count;
    Ok(GeneratedContent {
        entries,
        toc,
        expectation,
        warnings,
        statistics,
    })
}

fn generate_package_document(
    request: &EpubExportRequest,
    units: &[ContentUnit],
    cover: Option<&PreparedCover>,
    modified: &str,
) -> Result<String> {
    let metadata = &request.metadata;
    let mut optional_metadata = String::new();
    if let Some(value) = &metadata.publisher {
        write!(
            optional_metadata,
            "<dc:publisher>{}</dc:publisher>\n",
            xml_text(value)?
        )
        .map_err(|_| EpubError::Package)?;
    }
    if let Some(value) = &metadata.description {
        write!(
            optional_metadata,
            "<dc:description>{}</dc:description>\n",
            xml_text(value)?
        )
        .map_err(|_| EpubError::Package)?;
    }
    if let Some(value) = &metadata.rights {
        write!(
            optional_metadata,
            "<dc:rights>{}</dc:rights>\n",
            xml_text(value)?
        )
        .map_err(|_| EpubError::Package)?;
    }
    for subject in &metadata.subjects {
        write!(
            optional_metadata,
            "<dc:subject>{}</dc:subject>\n",
            xml_text(subject)?
        )
        .map_err(|_| EpubError::Package)?;
    }
    let mut manifest = String::from(
        "<item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\" />\n\
         <item id=\"style\" href=\"styles/book.css\" media-type=\"text/css\" />\n",
    );
    let mut spine = String::new();
    for (index, unit) in units.iter().enumerate() {
        write!(
            manifest,
            "<item id=\"content-{:04}\" href=\"text/{}\" media-type=\"application/xhtml+xml\" />\n",
            index + 1,
            xml_attr(&unit.filename)?
        )
        .map_err(|_| EpubError::Package)?;
        write!(spine, "<itemref idref=\"content-{:04}\" />\n", index + 1)
            .map_err(|_| EpubError::Package)?;
    }
    if let Some(cover) = cover {
        write!(
            manifest,
            "<item id=\"cover-image\" href=\"images/cover.{}\" media-type=\"{}\" properties=\"cover-image\" />\n",
            cover.media_type.extension(),
            cover.media_type.media_type()
        )
        .map_err(|_| EpubError::Package)?;
    }
    Ok(format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <package xmlns=\"http://www.idpf.org/2007/opf\" version=\"{}\" unique-identifier=\"pub-id\" xml:lang=\"{}\">\n\
         <metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n\
         <dc:identifier id=\"pub-id\">{}</dc:identifier>\n\
         <dc:title>{}</dc:title>\n\
         <dc:creator>{}</dc:creator>\n\
         <dc:language>{}</dc:language>\n\
         <meta property=\"dcterms:modified\">{}</meta>\n\
         {optional_metadata}</metadata>\n\
         <manifest>\n{manifest}</manifest>\n\
         <spine>\n{spine}</spine>\n\
         </package>\n",
        "3.0",
        xml_attr(&metadata.language)?,
        xml_text(&metadata.identifier)?,
        xml_text(&metadata.title)?,
        xml_text(&metadata.creator_name)?,
        xml_text(&metadata.language)?,
        xml_text(modified)?,
    ))
}

fn generate_navigation_document(request: &EpubExportRequest, toc: &[TocItem]) -> Result<String> {
    let mut index = 0;
    let list = render_toc_level(toc, &mut index, 0)?;
    let language = xml_attr(&request.metadata.language)?;
    Ok(format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <!DOCTYPE html>\n\
         <html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" xml:lang=\"{language}\" lang=\"{language}\">\n\
         <head><meta charset=\"UTF-8\" /><title>{}</title><link rel=\"stylesheet\" type=\"text/css\" href=\"styles/book.css\" /></head>\n\
         <body><nav epub:type=\"toc\" id=\"toc\"><h1>{}</h1>{list}</nav></body>\n\
         </html>\n",
        xml_text(&format!("{} 목차", request.metadata.title))?,
        xml_text("목차")?,
    ))
}

fn render_toc_level(items: &[TocItem], index: &mut usize, parent_level: u8) -> Result<String> {
    let mut output = String::from("<ol>");
    while *index < items.len() {
        let item = &items[*index];
        if item.level <= parent_level {
            break;
        }
        let current_level = item.level;
        write!(
            output,
            "<li><a href=\"{}\">{}</a>",
            xml_attr(&item.href)?,
            xml_text(&item.label)?
        )
        .map_err(|_| EpubError::Package)?;
        *index += 1;
        if *index < items.len() && items[*index].level > current_level {
            output.push_str(&render_toc_level(items, index, current_level)?);
        }
        output.push_str("</li>");
    }
    output.push_str("</ol>");
    Ok(output)
}

fn container_document() -> &'static str {
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
     <container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">\n\
     <rootfiles><rootfile full-path=\"EPUB/package.opf\" media-type=\"application/oebps-package+xml\" /></rootfiles>\n\
     </container>\n"
}

fn stylesheet(options: &crate::model::EpubExportOptions) -> String {
    stylesheet_for_tokens(
        options.stylesheet_token,
        options.body_style_token,
        options.scene_break_style_token,
    )
}

pub(crate) fn stylesheet_for_tokens(
    stylesheet_token: EpubStylesheetToken,
    body_style_token: EpubBodyStyleToken,
    scene_break_style_token: EpubSceneBreakStyleToken,
) -> String {
    let theme = match stylesheet_token {
        EpubStylesheetToken::MadiClassic => {
            "body { max-width: 42em; font-family: serif; }\nh1, h2, h3, h4 { font-weight: 700; }\n"
        }
        EpubStylesheetToken::MadiModern => {
            "body { max-width: 44em; font-family: sans-serif; }\nh1, h2, h3, h4 { font-weight: 600; letter-spacing: -0.01em; }\n"
        }
        EpubStylesheetToken::MadiMinimal => {
            "body { max-width: 46em; }\nh1, h2, h3, h4 { font-weight: inherit; }\n"
        }
    };
    let paragraphs = match body_style_token {
        EpubBodyStyleToken::ReflowableProse => "p { margin: 0 0 0.8em; text-indent: 0; }\n",
        EpubBodyStyleToken::IndentedProse => "p { margin: 0; text-indent: 1em; }\n",
        EpubBodyStyleToken::SpacedProse => "p { margin: 0 0 1em; text-indent: 0; }\n",
    };
    let scene_break = match scene_break_style_token {
        EpubSceneBreakStyleToken::Ornament => {
            ".scene-break { border: 0; margin: 1.75em auto; width: 30%; }\n.scene-break::after { content: \"* * *\"; display: block; text-align: center; }\n"
        }
        EpubSceneBreakStyleToken::Rule => {
            ".scene-break { border: 0; border-top: 0.08em solid currentColor; margin: 1.75em auto; width: 30%; }\n"
        }
        EpubSceneBreakStyleToken::Space => {
            ".scene-break { border: 0; height: 1.75em; margin: 0; }\n"
        }
    };
    format!(
        "html {{ line-height: 1.6; }}\nbody {{ margin: 0 auto; padding: 5%; }}\n{theme}\
         h1, h2, h3, h4 {{ line-height: 1.3; margin: 1.5em 0 0.75em; }}\n{paragraphs}\
         blockquote {{ margin: 1em 1.5em; }}\nblockquote p {{ text-indent: 0; }}\n{scene_break}\
         .underline {{ text-decoration: underline; }}\nruby {{ ruby-position: over; }}\n\
         img {{ height: auto; max-width: 100%; }}\n.source-anchor {{ display: block; height: 0; overflow: hidden; }}\n\
         .unsupported-fallback {{ white-space: pre-wrap; }}\nnav ol {{ list-style: none; padding-inline-start: 1.25em; }}\n"
    )
}

pub(crate) fn stylesheet_is_allowed(value: &str) -> bool {
    const STYLESHEETS: [EpubStylesheetToken; 3] = [
        EpubStylesheetToken::MadiClassic,
        EpubStylesheetToken::MadiModern,
        EpubStylesheetToken::MadiMinimal,
    ];
    const BODY_STYLES: [EpubBodyStyleToken; 3] = [
        EpubBodyStyleToken::ReflowableProse,
        EpubBodyStyleToken::IndentedProse,
        EpubBodyStyleToken::SpacedProse,
    ];
    const SCENE_BREAKS: [EpubSceneBreakStyleToken; 3] = [
        EpubSceneBreakStyleToken::Ornament,
        EpubSceneBreakStyleToken::Rule,
        EpubSceneBreakStyleToken::Space,
    ];
    STYLESHEETS.into_iter().any(|stylesheet| {
        BODY_STYLES.into_iter().any(|body| {
            SCENE_BREAKS
                .into_iter()
                .any(|scene_break| value == stylesheet_for_tokens(stylesheet, body, scene_break))
        })
    })
}

fn render_inlines(inlines: &[PublicationInline], ruby_count: &mut u64) -> Result<String> {
    let mut output = String::new();
    for inline in inlines {
        match inline {
            PublicationInline::Text { text } => output.push_str(&xml_text(text)?),
            PublicationInline::Strong { children } => {
                write!(
                    output,
                    "<strong>{}</strong>",
                    render_inlines(children, ruby_count)?
                )
                .map_err(|_| EpubError::Package)?;
            }
            PublicationInline::Emphasis { children } => {
                write!(output, "<em>{}</em>", render_inlines(children, ruby_count)?)
                    .map_err(|_| EpubError::Package)?;
            }
            PublicationInline::Underline { children } => {
                write!(
                    output,
                    "<span class=\"underline\">{}</span>",
                    render_inlines(children, ruby_count)?
                )
                .map_err(|_| EpubError::Package)?;
            }
            PublicationInline::Strike { children } => {
                write!(output, "<s>{}</s>", render_inlines(children, ruby_count)?)
                    .map_err(|_| EpubError::Package)?;
            }
            PublicationInline::Ruby {
                annotation,
                children,
            } => {
                *ruby_count += 1;
                write!(
                    output,
                    "<ruby>{}<rt>{}</rt></ruby>",
                    render_inlines(children, ruby_count)?,
                    xml_text(annotation)?
                )
                .map_err(|_| EpubError::Package)?;
            }
        }
    }
    Ok(output)
}

pub(crate) fn block_plain_text(block: &PublicationBlock) -> String {
    match block {
        PublicationBlock::Paragraph { inlines, .. } | PublicationBlock::Quote { inlines, .. } => {
            let mut output = String::new();
            collect_inline_text(inlines, &mut output);
            output
        }
        PublicationBlock::Unsupported { text, .. } => text.clone(),
        PublicationBlock::Heading { .. } | PublicationBlock::SceneBreak { .. } => String::new(),
    }
}

fn collect_inline_text(inlines: &[PublicationInline], output: &mut String) {
    for inline in inlines {
        match inline {
            PublicationInline::Text { text } => output.push_str(text),
            PublicationInline::Strong { children }
            | PublicationInline::Emphasis { children }
            | PublicationInline::Underline { children }
            | PublicationInline::Strike { children }
            | PublicationInline::Ruby { children, .. } => collect_inline_text(children, output),
        }
    }
}

pub(crate) fn block_export_id(block: &PublicationBlock) -> String {
    let id = match block {
        PublicationBlock::Heading { id, .. }
        | PublicationBlock::Paragraph { id, .. }
        | PublicationBlock::SceneBreak { id, .. }
        | PublicationBlock::Quote { id, .. }
        | PublicationBlock::Unsupported { id, .. } => id,
    };
    stable_export_id("block", id)
}

fn block_source_node_id(block: &PublicationBlock) -> &str {
    match block {
        PublicationBlock::Heading { source, .. }
        | PublicationBlock::Paragraph { source, .. }
        | PublicationBlock::SceneBreak { source, .. }
        | PublicationBlock::Quote { source, .. }
        | PublicationBlock::Unsupported { source, .. } => &source.source_node_id,
    }
}

fn stable_export_id(kind: &str, source_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"madi-epub-source-v1");
    hasher.update((kind.len() as u64).to_be_bytes());
    hasher.update(kind.as_bytes());
    hasher.update((source_id.len() as u64).to_be_bytes());
    hasher.update(source_id.as_bytes());
    format!("madi-{kind}-{:x}", hasher.finalize())
}

fn write_zip(entries: &[PackageEntry], cancellation: &CancellationToken) -> Result<Vec<u8>> {
    let mut seen = HashSet::new();
    for entry in entries {
        if !safe_package_path(&entry.path) || !seen.insert(entry.path.as_str()) {
            return Err(EpubError::Package);
        }
    }
    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    for entry in entries {
        cancellation.check()?;
        let options = SimpleFileOptions::default()
            .compression_method(entry.compression)
            .last_modified_time(DateTime::default());
        writer.start_file(&entry.path, options)?;
        writer
            .write_all(&entry.bytes)
            .map_err(|_| EpubError::Package)?;
    }
    let cursor = writer.finish()?;
    Ok(cursor.into_inner())
}

fn logical_package_hash(entries: &[PackageEntry]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"madi-epub-logical-package-v1");
    for entry in entries {
        hasher.update((entry.path.len() as u64).to_be_bytes());
        hasher.update(entry.path.as_bytes());
        hasher.update((entry.bytes.len() as u64).to_be_bytes());
        hasher.update(&entry.bytes);
    }
    format!("{:x}", hasher.finalize())
}

fn prepare_cover(cover: &EpubCoverInput) -> Result<PreparedCover> {
    if cover.bytes.is_empty() || cover.bytes.len() > MAX_COVER_BYTES {
        return Err(EpubError::InvalidCover(
            "file size is outside the safe limit",
        ));
    }
    if cover.original_name.is_empty()
        || cover.original_name.chars().count() > 255
        || cover
            .original_name
            .chars()
            .any(|character| character == '\0')
    {
        return Err(EpubError::InvalidCover("original filename is invalid"));
    }
    let image = decode_cover_resource(cover.media_type, &cover.bytes)?;
    let (width, height) = (image.width(), image.height());
    let mut bytes = Vec::new();
    match cover.media_type {
        EpubCoverMediaType::Png => {
            let image = image.to_rgba8();
            PngEncoder::new(&mut bytes)
                .write_image(image.as_raw(), width, height, ExtendedColorType::Rgba8)
                .map_err(|_| EpubError::InvalidCover("PNG sanitization failed"))?;
        }
        EpubCoverMediaType::Jpeg => {
            let image = image.to_rgb8();
            JpegEncoder::new_with_quality(&mut bytes, 90)
                .encode(image.as_raw(), width, height, ExtendedColorType::Rgb8)
                .map_err(|_| EpubError::InvalidCover("JPEG sanitization failed"))?;
        }
    }
    if bytes.len() > MAX_COVER_BYTES {
        return Err(EpubError::InvalidCover(
            "sanitized file size is outside the safe limit",
        ));
    }
    validate_cover_resource(cover.media_type, &bytes)?;
    Ok(PreparedCover {
        media_type: cover.media_type,
        bytes,
    })
}

pub(crate) fn validate_cover_resource(media_type: EpubCoverMediaType, bytes: &[u8]) -> Result<()> {
    match media_type {
        EpubCoverMediaType::Png => validate_sanitized_png_container(bytes)?,
        EpubCoverMediaType::Jpeg => validate_sanitized_jpeg_container(bytes)?,
    }
    decode_cover_resource(media_type, bytes).map(|_| ())
}

fn decode_cover_resource(
    media_type: EpubCoverMediaType,
    bytes: &[u8],
) -> Result<image::DynamicImage> {
    if bytes.is_empty() || bytes.len() > MAX_COVER_BYTES {
        return Err(EpubError::InvalidCover(
            "file size is outside the safe limit",
        ));
    }
    let format = match media_type {
        EpubCoverMediaType::Png => {
            validate_png_container(bytes)?;
            ImageFormat::Png
        }
        EpubCoverMediaType::Jpeg => {
            if !bytes.starts_with(&[0xff, 0xd8]) || !bytes.ends_with(&[0xff, 0xd9]) {
                return Err(EpubError::InvalidCover(
                    "JPEG magic bytes or terminal marker do not match",
                ));
            }
            ImageFormat::Jpeg
        }
    };
    let (width, height) = image::ImageReader::with_format(Cursor::new(bytes), format)
        .into_dimensions()
        .map_err(|_| EpubError::InvalidCover("image header is malformed"))?;
    if width == 0
        || height == 0
        || width > MAX_COVER_DIMENSION
        || height > MAX_COVER_DIMENSION
        || u64::from(width) * u64::from(height) > MAX_COVER_PIXELS
    {
        return Err(EpubError::InvalidCover(
            "image dimensions are outside the safe limit",
        ));
    }
    image::load_from_memory_with_format(bytes, format)
        .map_err(|_| EpubError::InvalidCover("image data is malformed"))
}

fn validate_sanitized_jpeg_container(bytes: &[u8]) -> Result<()> {
    const CANONICAL_JFIF: &[u8] = b"JFIF\0\x01\x02\x00\x00\x01\x00\x01\x00\x00";
    if !bytes.starts_with(&[0xff, 0xd8]) || !bytes.ends_with(&[0xff, 0xd9]) {
        return Err(EpubError::InvalidCover(
            "JPEG magic bytes or terminal marker do not match",
        ));
    }
    let mut offset = 2;
    let mut app0_count = 0;
    let mut saw_scan = false;
    while offset < bytes.len() {
        if bytes[offset] != 0xff {
            return Err(EpubError::InvalidCover("JPEG marker stream is malformed"));
        }
        let marker_start = offset;
        while offset < bytes.len() && bytes[offset] == 0xff {
            offset += 1;
        }
        let marker = *bytes
            .get(offset)
            .ok_or(EpubError::InvalidCover("JPEG marker is truncated"))?;
        offset += 1;
        if marker == 0xd9 {
            return if saw_scan && offset == bytes.len() {
                Ok(())
            } else {
                Err(EpubError::InvalidCover("JPEG terminal marker is malformed"))
            };
        }
        if marker == 0xda {
            let segment_end = jpeg_segment_end(bytes, offset)?;
            offset = segment_end;
            saw_scan = true;
            loop {
                let Some(relative) = bytes[offset..].iter().position(|byte| *byte == 0xff) else {
                    return Err(EpubError::InvalidCover("JPEG scan is truncated"));
                };
                offset += relative;
                let mut next = offset + 1;
                while bytes.get(next) == Some(&0xff) {
                    next += 1;
                }
                match bytes.get(next).copied() {
                    Some(0x00) | Some(0xd0..=0xd7) => offset = next + 1,
                    Some(_) => break,
                    None => return Err(EpubError::InvalidCover("JPEG scan is truncated")),
                }
            }
            continue;
        }
        if marker == 0xd8 || marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
            return Err(EpubError::InvalidCover("JPEG marker stream is malformed"));
        }
        let segment_end = jpeg_segment_end(bytes, offset)?;
        let payload = &bytes[offset + 2..segment_end];
        if marker == 0xe0 {
            app0_count += 1;
            if app0_count != 1 || marker_start != 2 || payload != CANONICAL_JFIF {
                return Err(EpubError::InvalidCover("JPEG APP0 is not canonical"));
            }
        } else if (0xe1..=0xef).contains(&marker) || marker == 0xfe {
            return Err(EpubError::InvalidCover(
                "JPEG metadata or comment payload is not allowed",
            ));
        }
        offset = segment_end;
    }
    Err(EpubError::InvalidCover("JPEG terminal marker is missing"))
}

fn validate_sanitized_png_container(bytes: &[u8]) -> Result<()> {
    const SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
    validate_png_container(bytes)?;
    let mut offset = SIGNATURE.len();
    let mut chunk_index = 0_u64;
    let mut idat_count = 0_u64;
    let mut idat_ended = false;
    while offset < bytes.len() {
        let length = u32::from_be_bytes(
            bytes[offset..offset + 4]
                .try_into()
                .map_err(|_| EpubError::InvalidCover("PNG chunk is truncated"))?,
        ) as usize;
        let kind = &bytes[offset + 4..offset + 8];
        let chunk_end = offset + 8 + length + 4;
        match kind {
            b"IHDR" if chunk_index == 0 => {}
            b"IDAT" if !idat_ended => idat_count += 1,
            b"IEND" if idat_count > 0 => {
                if chunk_end != bytes.len() {
                    return Err(EpubError::InvalidCover("PNG IEND is not terminal"));
                }
            }
            _ => {
                return Err(EpubError::InvalidCover(
                    "PNG metadata or non-canonical chunk is not allowed",
                ));
            }
        }
        if idat_count > 0 && kind != b"IDAT" && kind != b"IEND" {
            idat_ended = true;
        }
        offset = chunk_end;
        chunk_index += 1;
    }
    Ok(())
}

fn jpeg_segment_end(bytes: &[u8], length_offset: usize) -> Result<usize> {
    let length_bytes: [u8; 2] = bytes
        .get(length_offset..length_offset + 2)
        .ok_or(EpubError::InvalidCover("JPEG segment is truncated"))?
        .try_into()
        .map_err(|_| EpubError::InvalidCover("JPEG segment is truncated"))?;
    let length = usize::from(u16::from_be_bytes(length_bytes));
    if length < 2 {
        return Err(EpubError::InvalidCover("JPEG segment length is invalid"));
    }
    length_offset
        .checked_add(length)
        .filter(|end| *end <= bytes.len())
        .ok_or(EpubError::InvalidCover("JPEG segment is truncated"))
}

fn validate_png_container(bytes: &[u8]) -> Result<()> {
    const SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
    if !bytes.starts_with(SIGNATURE) {
        return Err(EpubError::InvalidCover("PNG magic bytes do not match"));
    }
    let mut offset = SIGNATURE.len();
    let mut first = true;
    let mut ended = false;
    while offset < bytes.len() {
        let header_end = offset
            .checked_add(8)
            .ok_or(EpubError::InvalidCover("PNG chunk length is invalid"))?;
        if header_end > bytes.len() {
            return Err(EpubError::InvalidCover("PNG chunk is truncated"));
        }
        let length = u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        let kind = &bytes[offset + 4..offset + 8];
        let chunk_end = header_end
            .checked_add(length)
            .and_then(|end| end.checked_add(4))
            .ok_or(EpubError::InvalidCover("PNG chunk length is invalid"))?;
        if chunk_end > bytes.len() {
            return Err(EpubError::InvalidCover("PNG chunk is truncated"));
        }
        if first && (kind != b"IHDR" || length != 13) {
            return Err(EpubError::InvalidCover("PNG IHDR is invalid"));
        }
        first = false;
        offset = chunk_end;
        if kind == b"IEND" {
            if length != 0 || offset != bytes.len() {
                return Err(EpubError::InvalidCover(
                    "PNG contains trailing or malformed data",
                ));
            }
            ended = true;
            break;
        }
    }
    if !ended {
        return Err(EpubError::InvalidCover("PNG IEND is missing"));
    }
    Ok(())
}

fn validate_destination(path: &Path) -> Result<()> {
    let valid_extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("epub"));
    let parent = path.parent();
    if !path.is_absolute()
        || !valid_extension
        || path.file_name().is_none()
        || parent.is_none_or(|parent| !parent.is_dir())
    {
        return Err(EpubError::InvalidDestination);
    }
    Ok(())
}

fn deterministic_modified(revision: i64) -> Result<String> {
    const BASE_SECONDS: i64 = 946_684_800;
    const MAX_SECONDS: i64 = 253_402_300_799;
    let seconds = BASE_SECONDS
        .checked_add(revision)
        .filter(|seconds| *seconds <= MAX_SECONDS)
        .ok_or(EpubError::InvalidRequest(
            "project revision cannot be represented as a deterministic timestamp",
        ))?;
    let days = seconds.div_euclid(86_400);
    let day_seconds = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = day_seconds / 3_600;
    let minute = (day_seconds % 3_600) / 60;
    let second = day_seconds % 60;
    Ok(format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z"
    ))
}

fn civil_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_epoch + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year, month, day)
}

fn safe_package_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path.contains(':')
        && !path.contains('\0')
        && path
            .split('/')
            .all(|component| !component.is_empty() && component != "." && component != "..")
}

fn valid_metadata_value(value: &str, allow_empty: bool) -> bool {
    (allow_empty || !value.trim().is_empty())
        && value.chars().count() <= MAX_METADATA_CHARACTERS
        && value.chars().all(valid_xml_character)
}

pub(crate) fn valid_language(value: &str) -> bool {
    let subtags: Vec<_> = value.split('-').collect();
    let Some(primary) = subtags.first() else {
        return false;
    };
    if !(2..=8).contains(&primary.len()) || !primary.bytes().all(|byte| byte.is_ascii_alphabetic())
    {
        return false;
    }
    let mut index = 1;
    if primary.len() <= 3 {
        let mut extlang_count = 0;
        while extlang_count < 3
            && subtags.get(index).is_some_and(|subtag| {
                subtag.len() == 3 && subtag.bytes().all(|byte| byte.is_ascii_alphabetic())
            })
        {
            index += 1;
            extlang_count += 1;
        }
    }
    if subtags.get(index).is_some_and(|subtag| {
        subtag.len() == 4 && subtag.bytes().all(|byte| byte.is_ascii_alphabetic())
    }) {
        index += 1;
    }
    if subtags.get(index).is_some_and(|subtag| {
        (subtag.len() == 2 && subtag.bytes().all(|byte| byte.is_ascii_alphabetic()))
            || (subtag.len() == 3 && subtag.bytes().all(|byte| byte.is_ascii_digit()))
    }) {
        index += 1;
    }
    let mut variants = HashSet::new();
    while subtags.get(index).is_some_and(|subtag| {
        ((5..=8).contains(&subtag.len())
            || (subtag.len() == 4 && subtag.as_bytes()[0].is_ascii_digit()))
            && subtag.bytes().all(|byte| byte.is_ascii_alphanumeric())
    }) {
        if !variants.insert(subtags[index].to_ascii_lowercase()) {
            return false;
        }
        index += 1;
    }
    let mut singletons = HashSet::new();
    while subtags.get(index).is_some_and(|subtag| {
        subtag.len() == 1
            && subtag.as_bytes()[0].is_ascii_alphanumeric()
            && !subtag.eq_ignore_ascii_case("x")
    }) {
        if !singletons.insert(subtags[index].to_ascii_lowercase()) {
            return false;
        }
        index += 1;
        let start = index;
        while subtags.get(index).is_some_and(|subtag| {
            (2..=8).contains(&subtag.len())
                && subtag.bytes().all(|byte| byte.is_ascii_alphanumeric())
        }) {
            index += 1;
        }
        if index == start {
            return false;
        }
    }
    if subtags
        .get(index)
        .is_some_and(|subtag| subtag.eq_ignore_ascii_case("x"))
    {
        index += 1;
        let start = index;
        while subtags.get(index).is_some_and(|subtag| {
            (1..=8).contains(&subtag.len())
                && subtag.bytes().all(|byte| byte.is_ascii_alphanumeric())
        }) {
            index += 1;
        }
        if index == start {
            return false;
        }
    }
    index == subtags.len()
}

fn ensure_xml_text(value: &str) -> Result<()> {
    if value.chars().all(valid_xml_character) {
        Ok(())
    } else {
        Err(EpubError::InvalidRequest(
            "publication contains an invalid XML control character",
        ))
    }
}

fn valid_xml_character(character: char) -> bool {
    matches!(character, '\u{9}' | '\u{a}' | '\u{d}')
        || ('\u{20}'..='\u{d7ff}').contains(&character)
        || ('\u{e000}'..='\u{fffd}').contains(&character)
        || ('\u{10000}'..='\u{10ffff}').contains(&character)
}

fn xml_text(value: &str) -> Result<String> {
    ensure_xml_text(value)?;
    Ok(value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;"))
}

fn xml_attr(value: &str) -> Result<String> {
    Ok(xml_text(value)?
        .replace('"', "&quot;")
        .replace('\'', "&apos;"))
}

fn safe_node_type_label(node_type: &str) -> &'static str {
    match node_type {
        "paragraph" => "문단",
        "image" => "이미지",
        _ => "원고",
    }
}

fn is_lower_hex_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_operation_id(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
            }
        })
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis().try_into().unwrap_or(u64::MAX)
}

fn emit_progress<F>(progress: &mut F, stage: EpubProgressStage, completed: u64, total: u64)
where
    F: FnMut(EpubProgressEvent),
{
    progress(EpubProgressEvent {
        stage,
        completed,
        total,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn revision_timestamp_is_deterministic() {
        assert_eq!(deterministic_modified(0).unwrap(), "2000-01-01T00:00:00Z");
        assert_eq!(
            deterministic_modified(86_400).unwrap(),
            "2000-01-02T00:00:00Z"
        );
    }

    #[test]
    fn package_paths_reject_absolute_parent_and_windows_forms() {
        assert!(safe_package_path("EPUB/text/chapter-0001.xhtml"));
        for invalid in [
            "../evil",
            "EPUB/../evil",
            "/absolute",
            "C:/absolute",
            "EPUB\\evil",
            "EPUB//evil",
            "./EPUB/evil",
        ] {
            assert!(!safe_package_path(invalid), "accepted {invalid}");
        }
    }

    #[test]
    fn language_tags_use_a_well_formed_bcp47_subset() {
        for valid in [
            "ko",
            "ko-KR",
            "en-Latn-US",
            "zh-cmn-Hans-CN",
            "de-CH-1901",
            "en-US-u-ca-gregory",
            "ko-x-madi",
        ] {
            assert!(valid_language(valid), "rejected {valid}");
        }
        for invalid in [
            "",
            "x",
            "x-private",
            "ko-0",
            "ko-x",
            "en--US",
            "en-a",
            "de-1901-1901",
            "en-a-foo-a-bar",
        ] {
            assert!(!valid_language(invalid), "accepted {invalid}");
        }
    }

    #[test]
    fn every_preset_combination_has_a_distinct_built_in_stylesheet() {
        let mut values = BTreeSet::new();
        for stylesheet in [
            EpubStylesheetToken::MadiClassic,
            EpubStylesheetToken::MadiModern,
            EpubStylesheetToken::MadiMinimal,
        ] {
            for body in [
                EpubBodyStyleToken::ReflowableProse,
                EpubBodyStyleToken::IndentedProse,
                EpubBodyStyleToken::SpacedProse,
            ] {
                for scene_break in [
                    EpubSceneBreakStyleToken::Ornament,
                    EpubSceneBreakStyleToken::Rule,
                    EpubSceneBreakStyleToken::Space,
                ] {
                    let value = stylesheet_for_tokens(stylesheet, body, scene_break);
                    assert!(stylesheet_is_allowed(&value));
                    values.insert(value);
                }
            }
        }
        assert_eq!(values.len(), 27);
    }
}
