use std::collections::HashSet;
use std::fmt::Write as _;
use std::io::{Cursor, Write};
use std::path::Path;
use std::time::Instant;

use madi_publication::{
    PublicationBlock, PublicationDocument, PublicationInline, canonical_publication_document,
    validate_publication_document,
};
use sha2::{Digest, Sha256};
use tempfile::{Builder as TempfileBuilder, NamedTempFile};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipWriter};

use crate::model::{
    CancellationToken, CompiledHwpx, HwpxCompileSummary, HwpxError, HwpxExportOptions,
    HwpxExportRequest, HwpxExportResult, HwpxExportTiming, HwpxHeadingStyle, HwpxLineSpacing,
    HwpxOrientation, HwpxPackageStatistics, HwpxPageNumberPosition, HwpxPageSizeToken,
    HwpxProgressEvent, HwpxProgressStage, HwpxSceneBreakToken, HwpxSectionSplitMode, HwpxTextAlign,
    HwpxValidationMessage, HwpxValidationReport, HwpxValidationSeverity, HwpxValidationStatus,
    Result,
};
use crate::validator::{
    ExpectedBlock, ExpectedDisposition, ExpectedParagraph, ExpectedRun, HwpxValidationExpectation,
    validate_hwpx_source_coverage, validate_hwpx_with_expectation,
};
use crate::{
    HWPX_CONTAINER_PATH, HWPX_CONTENT_PATH, HWPX_HEADER_PATH, HWPX_MANIFEST_PATH, HWPX_MIMETYPE,
    HWPX_RDF_PATH, HWPX_SECTION_PATH, HWPX_SETTINGS_PATH, HWPX_VERSION_PATH, HWPX_XML_VERSION,
};

const MAX_METADATA_CHARACTERS: usize = 10_000;
const MAX_FONT_CHARACTERS: usize = 128;
const MAX_PRESET_ID_CHARACTERS: usize = 256;
const MAX_EXPORT_WARNINGS: usize = 1_000;
const BODY_INLINE_CHAR_PR_COUNT: u32 = 16;
const HEADER_FOOTER_PARA_ID_BASE: u32 = 3_000_000_000;

const NS_HV: &str = "http://www.hancom.co.kr/hwpml/2011/version";
const NS_HA: &str = "http://www.hancom.co.kr/hwpml/2011/app";
const NS_HP: &str = "http://www.hancom.co.kr/hwpml/2011/paragraph";
const NS_HS: &str = "http://www.hancom.co.kr/hwpml/2011/section";
const NS_HC: &str = "http://www.hancom.co.kr/hwpml/2011/core";
const NS_HH: &str = "http://www.hancom.co.kr/hwpml/2011/head";
const NS_OPF: &str = "http://www.idpf.org/2007/opf/";
const NS_OCF: &str = "urn:oasis:names:tc:opendocument:xmlns:container";
const NS_ODF: &str = "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0";
const NS_RDF: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

#[derive(Debug, Clone)]
struct PackageEntry {
    path: String,
    bytes: Vec<u8>,
    compression: CompressionMethod,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
enum ParagraphKind {
    Body = 0,
    WorkTitle = 1,
    VolumeTitle = 2,
    ChapterTitle = 3,
    SceneTitle = 4,
    Blockquote = 5,
    SceneBreak = 6,
    TitlePageTitle = 7,
    TitlePageAuthor = 8,
    Header = 9,
    Footer = 10,
}

impl ParagraphKind {
    const ALL: [Self; 11] = [
        Self::Body,
        Self::WorkTitle,
        Self::VolumeTitle,
        Self::ChapterTitle,
        Self::SceneTitle,
        Self::Blockquote,
        Self::SceneBreak,
        Self::TitlePageTitle,
        Self::TitlePageAuthor,
        Self::Header,
        Self::Footer,
    ];

    fn id(self) -> u32 {
        self as u32
    }

    fn name(self) -> &'static str {
        match self {
            Self::Body => "MADI_BODY",
            Self::WorkTitle => "MADI_WORK_TITLE",
            Self::VolumeTitle => "MADI_VOLUME_TITLE",
            Self::ChapterTitle => "MADI_CHAPTER_TITLE",
            Self::SceneTitle => "MADI_SCENE_TITLE",
            Self::Blockquote => "MADI_BLOCKQUOTE",
            Self::SceneBreak => "MADI_SCENE_BREAK",
            Self::TitlePageTitle => "MADI_TITLE_PAGE_TITLE",
            Self::TitlePageAuthor => "MADI_TITLE_PAGE_AUTHOR",
            Self::Header => "MADI_HEADER",
            Self::Footer => "MADI_FOOTER",
        }
    }

    fn char_pr_id(self) -> u32 {
        if self == Self::Body {
            0
        } else {
            BODY_INLINE_CHAR_PR_COUNT + self.id() - 1
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RenderedRun {
    char_pr_id: u32,
    text: String,
}

#[derive(Debug, Clone)]
struct RenderedParagraph {
    id: u32,
    kind: ParagraphKind,
    page_break: bool,
    runs: Vec<RenderedRun>,
    expected: Option<ExpectedBlock>,
}

#[derive(Debug)]
struct RenderedDocument {
    sections: Vec<RenderedSection>,
    warnings: HwpxValidationReport,
    statistics: HwpxPackageStatistics,
    expectation: HwpxValidationExpectation,
}

#[derive(Debug)]
struct RenderedSection {
    paragraphs: Vec<RenderedParagraph>,
}

#[derive(Debug, Clone, Copy)]
struct PageGeometry {
    width: u32,
    height: u32,
    top: u32,
    bottom: u32,
    left: u32,
    right: u32,
    header: u32,
    footer: u32,
    gutter: u32,
}

pub fn compile_hwpx_bytes(
    document: &PublicationDocument,
    request: &HwpxExportRequest,
    cancellation: &CancellationToken,
) -> Result<CompiledHwpx> {
    compile_hwpx_bytes_with_progress(document, request, cancellation, |_| {})
}

pub fn compile_hwpx_bytes_with_progress<F>(
    document: &PublicationDocument,
    request: &HwpxExportRequest,
    cancellation: &CancellationToken,
    mut progress: F,
) -> Result<CompiledHwpx>
where
    F: FnMut(HwpxProgressEvent),
{
    let total_started = Instant::now();
    cancellation.check()?;
    emit_progress(&mut progress, HwpxProgressStage::PublicationIr, 0, 1);
    validate_request(document, request)?;
    emit_progress(&mut progress, HwpxProgressStage::PublicationIr, 1, 1);

    cancellation.check()?;
    let planned_section_count = planned_section_count(document, request.options.section_split_mode);
    let style_started = Instant::now();
    emit_progress(&mut progress, HwpxProgressStage::StyleTable, 0, 1);
    let header = header_document(request, planned_section_count)?;
    let style_table_ms = elapsed_ms(style_started);
    emit_progress(&mut progress, HwpxProgressStage::StyleTable, 1, 1);

    cancellation.check()?;
    emit_progress(&mut progress, HwpxProgressStage::SectionXml, 0, 1);
    let semantic_mapping_started = Instant::now();
    let mut rendered = render_publication(document, request, cancellation)?;
    if rendered.sections.len() != planned_section_count {
        return Err(HwpxError::Package);
    }
    let semantic_mapping_ms = elapsed_ms(semantic_mapping_started);
    let section_started = Instant::now();
    let sections = rendered
        .sections
        .iter()
        .enumerate()
        .map(|(index, section)| section_document(&section.paragraphs, index, request))
        .collect::<Result<Vec<_>>>()?;
    let section_xml_ms = elapsed_ms(section_started);
    emit_progress(&mut progress, HwpxProgressStage::SectionXml, 1, 1);

    cancellation.check()?;
    let package_started = Instant::now();
    emit_progress(&mut progress, HwpxProgressStage::PackageDocuments, 0, 1);
    let entries = package_entries(request, header, sections)?;
    rendered.statistics.file_count = entries.len() as u64;
    rendered.expectation.expected_file_count = entries.len() as u64;
    let logical_package_hash = logical_package_hash(&entries);
    let package_documents_ms = elapsed_ms(package_started);
    emit_progress(&mut progress, HwpxProgressStage::PackageDocuments, 1, 1);

    cancellation.check()?;
    let zip_started = Instant::now();
    emit_progress(&mut progress, HwpxProgressStage::ZipPackaging, 0, 1);
    let bytes = write_zip(&entries, cancellation)?;
    let zip_packaging_ms = elapsed_ms(zip_started);
    emit_progress(&mut progress, HwpxProgressStage::ZipPackaging, 1, 1);

    let zip_reopen_started = Instant::now();
    reopen_zip(&bytes)?;
    let zip_reopen_ms = elapsed_ms(zip_reopen_started);

    cancellation.check()?;
    let validation_started = Instant::now();
    emit_progress(&mut progress, HwpxProgressStage::InternalValidation, 0, 1);
    let mut report = validate_hwpx_with_expectation(&bytes, None);
    let internal_validation_ms = elapsed_ms(validation_started);
    let source_coverage_started = Instant::now();
    report.append(validate_hwpx_source_coverage(&bytes, &rendered.expectation));
    let source_coverage_ms = elapsed_ms(source_coverage_started);
    report.append(rendered.warnings);
    emit_progress(&mut progress, HwpxProgressStage::InternalValidation, 1, 1);
    if report.status == HwpxValidationStatus::Fail {
        return Err(HwpxError::ValidationFailed(report));
    }

    let summary = HwpxCompileSummary {
        byte_length: bytes.len() as u64,
        sha256: sha256_hex(&bytes),
        logical_package_hash,
        package_xml_version: HWPX_XML_VERSION.to_owned(),
        source_publication_hash: request.source_publication_hash.clone(),
        preset_id: request.preset_id.clone(),
        preset_content_hash: request.preset_content_hash.clone(),
        font_family: request.options.body.font_family.clone(),
        validation_report: report,
        export_timing: HwpxExportTiming {
            semantic_mapping_ms,
            style_table_ms,
            section_xml_ms,
            package_documents_ms,
            zip_packaging_ms,
            zip_reopen_ms,
            internal_validation_ms,
            source_coverage_ms,
            exporter_total_ms: elapsed_ms(total_started),
        },
        statistics: rendered.statistics,
    };
    Ok(CompiledHwpx { bytes, summary })
}

pub fn export_hwpx(
    document: &PublicationDocument,
    request: &HwpxExportRequest,
    cancellation: &CancellationToken,
) -> Result<HwpxExportResult> {
    export_hwpx_with_progress(document, request, cancellation, |_| {})
}

pub fn export_hwpx_with_progress<F>(
    document: &PublicationDocument,
    request: &HwpxExportRequest,
    cancellation: &CancellationToken,
    mut progress: F,
) -> Result<HwpxExportResult>
where
    F: FnMut(HwpxProgressEvent),
{
    export_hwpx_with_optional_operation(document, request, cancellation, None, &mut progress)
}

pub fn export_hwpx_for_operation_with_progress<F>(
    document: &PublicationDocument,
    request: &HwpxExportRequest,
    operation_id: &str,
    cancellation: &CancellationToken,
    mut progress: F,
) -> Result<HwpxExportResult>
where
    F: FnMut(HwpxProgressEvent),
{
    if !valid_operation_id(operation_id) {
        return Err(HwpxError::InvalidRequest(
            "operationId must be a canonical lowercase UUID",
        ));
    }
    export_hwpx_with_optional_operation(
        document,
        request,
        cancellation,
        Some(operation_id),
        &mut progress,
    )
}

fn export_hwpx_with_optional_operation<F>(
    document: &PublicationDocument,
    request: &HwpxExportRequest,
    cancellation: &CancellationToken,
    operation_id: Option<&str>,
    progress: &mut F,
) -> Result<HwpxExportResult>
where
    F: FnMut(HwpxProgressEvent),
{
    let export_started = Instant::now();
    validate_destination(&request.output_path)?;
    if request.output_path.exists() && !request.replace_existing {
        return Err(HwpxError::DestinationExists);
    }
    let mut compiled =
        compile_hwpx_bytes_with_progress(document, request, cancellation, &mut *progress)?;
    cancellation.check()?;
    let parent = request
        .output_path
        .parent()
        .ok_or(HwpxError::InvalidDestination)?;
    let mut temporary = if let Some(operation_id) = operation_id {
        TempfileBuilder::new()
            .prefix(&format!(".madi-hwpx-{operation_id}"))
            .suffix(".tmp")
            .rand_bytes(0)
            .tempfile_in(parent)
            .map_err(|_| HwpxError::Output)?
    } else {
        NamedTempFile::new_in(parent).map_err(|_| HwpxError::Output)?
    };
    emit_progress(progress, HwpxProgressStage::WriteOutput, 0, 1);
    temporary
        .write_all(&compiled.bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| HwpxError::Output)?;
    let persisted_candidate = std::fs::read(temporary.path()).map_err(|_| HwpxError::Output)?;
    if persisted_candidate.len() != compiled.bytes.len()
        || sha256_hex(&persisted_candidate) != compiled.summary.sha256
    {
        return Err(HwpxError::Output);
    }
    cancellation.check()?;
    if request.replace_existing {
        temporary
            .persist(&request.output_path)
            .map_err(|_| HwpxError::Output)?;
    } else {
        temporary
            .persist_noclobber(&request.output_path)
            .map_err(|error| {
                if error.error.kind() == std::io::ErrorKind::AlreadyExists {
                    HwpxError::DestinationExists
                } else {
                    HwpxError::Output
                }
            })?;
    }
    compiled.summary.export_timing.exporter_total_ms = elapsed_ms(export_started);
    emit_progress(progress, HwpxProgressStage::WriteOutput, 1, 1);
    emit_progress(progress, HwpxProgressStage::Complete, 1, 1);
    Ok(HwpxExportResult {
        output_path: request.output_path.clone(),
        byte_length: compiled.summary.byte_length,
        sha256: compiled.summary.sha256,
        logical_package_hash: compiled.summary.logical_package_hash,
        package_xml_version: compiled.summary.package_xml_version,
        source_publication_hash: compiled.summary.source_publication_hash,
        preset_id: compiled.summary.preset_id,
        preset_content_hash: compiled.summary.preset_content_hash,
        font_family: compiled.summary.font_family,
        validation_report: compiled.summary.validation_report,
        export_timing: compiled.summary.export_timing,
        statistics: compiled.summary.statistics,
    })
}

pub fn operation_temporary_path(
    request: &HwpxExportRequest,
    operation_id: &str,
) -> Result<std::path::PathBuf> {
    validate_destination(&request.output_path)?;
    if !valid_operation_id(operation_id) {
        return Err(HwpxError::InvalidRequest(
            "operationId must be a canonical lowercase UUID",
        ));
    }
    Ok(request
        .output_path
        .parent()
        .ok_or(HwpxError::InvalidDestination)?
        .join(format!(".madi-hwpx-{operation_id}.tmp")))
}

fn validate_request(document: &PublicationDocument, request: &HwpxExportRequest) -> Result<()> {
    validate_publication_document(document).map_err(|_| HwpxError::InvalidPublication)?;
    if document.sections.is_empty() {
        return Err(HwpxError::InvalidRequest(
            "publication scope must contain at least one section",
        ));
    }
    if request.project_id != document.project_id
        || request.scope_node_id != document.scope_node_id
        || request.expected_project_revision != document.project_revision
    {
        return Err(HwpxError::PublicationMismatch);
    }
    let canonical =
        canonical_publication_document(document).map_err(|_| HwpxError::InvalidPublication)?;
    if !is_lower_hex_hash(&request.source_publication_hash)
        || sha256_hex(canonical.as_bytes()) != request.source_publication_hash
    {
        return Err(HwpxError::PublicationMismatch);
    }
    if !valid_bounded_xml(&request.preset_id, MAX_PRESET_ID_CHARACTERS, false)
        || !is_lower_hex_hash(&request.preset_content_hash)
        || !valid_bounded_xml(&request.metadata.title, MAX_METADATA_CHARACTERS, false)
        || !valid_bounded_xml(&request.metadata.author_name, MAX_METADATA_CHARACTERS, true)
        || [
            request.metadata.subtitle.as_deref(),
            request.metadata.genre.as_deref(),
            request.metadata.contact.as_deref(),
        ]
        .into_iter()
        .flatten()
        .any(|value| !valid_bounded_xml(value, MAX_METADATA_CHARACTERS, false))
    {
        return Err(HwpxError::InvalidRequest(
            "metadata or preset identity is invalid",
        ));
    }
    validate_options(&request.options)?;
    validate_document_xml(document)?;
    for section in &document.sections {
        for block in &section.blocks {
            if matches!(block, PublicationBlock::Unsupported { text, .. } if text.is_empty()) {
                return Err(HwpxError::InvalidRequest(
                    "unsupported block has no safe textual fallback",
                ));
            }
        }
    }
    Ok(())
}

fn validate_options(options: &HwpxExportOptions) -> Result<()> {
    let page = &options.page;
    if [
        page.margin_top_mm,
        page.margin_bottom_mm,
        page.margin_left_mm,
        page.margin_right_mm,
        page.header_margin_mm,
        page.footer_margin_mm,
        page.gutter_mm,
    ]
    .into_iter()
    .any(|value| !value.is_finite() || !(0.0..=100.0).contains(&value))
    {
        return Err(HwpxError::InvalidRequest("page margin is out of range"));
    }
    match page.page_size_token {
        HwpxPageSizeToken::A4 | HwpxPageSizeToken::Letter
            if page.custom_width_mm.is_some() || page.custom_height_mm.is_some() =>
        {
            return Err(HwpxError::InvalidRequest(
                "built-in page size cannot include custom dimensions",
            ));
        }
        HwpxPageSizeToken::Custom => {
            let (Some(width), Some(height)) = (page.custom_width_mm, page.custom_height_mm) else {
                return Err(HwpxError::InvalidRequest(
                    "custom page size requires width and height",
                ));
            };
            if !width.is_finite()
                || !height.is_finite()
                || !(50.0..=500.0).contains(&width)
                || !(50.0..=500.0).contains(&height)
            {
                return Err(HwpxError::InvalidRequest(
                    "custom page dimensions are out of range",
                ));
            }
        }
        _ => {}
    }
    let geometry = page_geometry(page)?;
    if geometry.left + geometry.right + geometry.gutter >= geometry.width
        || geometry.top + geometry.bottom >= geometry.height
        || geometry.header > geometry.top
        || geometry.footer > geometry.bottom
    {
        return Err(HwpxError::InvalidRequest(
            "page margins leave no valid text area",
        ));
    }
    let body = &options.body;
    if !valid_bounded_xml(&body.font_family, MAX_FONT_CHARACTERS, false)
        || !body.font_size_pt.is_finite()
        || !(6.0..=72.0).contains(&body.font_size_pt)
        || !(-10_000..=10_000).contains(&body.first_line_indent_hwpunit)
        || !(0..=10_000).contains(&body.paragraph_spacing_before_hwpunit)
        || !(0..=10_000).contains(&body.paragraph_spacing_after_hwpunit)
        || !valid_line_spacing(body.line_spacing)
    {
        return Err(HwpxError::InvalidRequest("body typography is out of range"));
    }
    for heading in [
        &options.headings.work,
        &options.headings.volume,
        &options.headings.chapter,
        &options.headings.scene,
    ] {
        if !valid_bounded_xml(&heading.font_family, MAX_FONT_CHARACTERS, false)
            || !heading.font_size_pt.is_finite()
            || !(6.0..=72.0).contains(&heading.font_size_pt)
            || !(0..=10_000).contains(&heading.spacing_before_hwpunit)
            || !(0..=10_000).contains(&heading.spacing_after_hwpunit)
        {
            return Err(HwpxError::InvalidRequest(
                "heading typography is out of range",
            ));
        }
    }
    if !(1..=1_000_000).contains(&options.page_number_start)
        || (options.include_header
            && !valid_bounded_xml(&options.header_text, MAX_METADATA_CHARACTERS, false))
        || (!options.include_header && !options.header_text.is_empty())
        || (options.include_footer
            && !valid_bounded_xml(&options.footer_text, MAX_METADATA_CHARACTERS, false))
        || (!options.include_footer && !options.footer_text.is_empty())
    {
        return Err(HwpxError::InvalidRequest(
            "page numbering, header, or footer option is invalid",
        ));
    }
    Ok(())
}

fn planned_section_count(document: &PublicationDocument, mode: HwpxSectionSplitMode) -> usize {
    if mode == HwpxSectionSplitMode::Single {
        return 1;
    }
    document
        .sections
        .iter()
        .flat_map(|section| &section.blocks)
        .filter(|block| matches!(block, PublicationBlock::Heading { level: 2, .. }))
        .count()
        .max(1)
}

fn valid_line_spacing(value: HwpxLineSpacing) -> bool {
    match value {
        HwpxLineSpacing::Percent { percent } => {
            percent.is_finite() && (50.0..=400.0).contains(&percent)
        }
        HwpxLineSpacing::Fixed { hwpunit } => (600..=20_000).contains(&hwpunit),
    }
}

fn validate_document_xml(document: &PublicationDocument) -> Result<()> {
    for section in &document.sections {
        for value in [&section.id, &section.source_node_id, &section.title] {
            ensure_xml_text(value)?;
        }
        for value in &section.parent_titles {
            ensure_xml_text(value)?;
        }
        for block in &section.blocks {
            match block {
                PublicationBlock::Heading { text, .. }
                | PublicationBlock::Unsupported { text, .. } => ensure_xml_text(text)?,
                PublicationBlock::Paragraph { inlines, .. }
                | PublicationBlock::Quote { inlines, .. } => validate_inline_xml(inlines)?,
                PublicationBlock::SceneBreak { .. } => {}
            }
        }
    }
    Ok(())
}

fn validate_inline_xml(inlines: &[PublicationInline]) -> Result<()> {
    for inline in inlines {
        match inline {
            PublicationInline::Text { text } => ensure_xml_text(text)?,
            PublicationInline::Ruby {
                annotation,
                children,
            } => {
                ensure_xml_text(annotation)?;
                validate_inline_xml(children)?;
            }
            PublicationInline::Strong { children }
            | PublicationInline::Emphasis { children }
            | PublicationInline::Underline { children }
            | PublicationInline::Strike { children } => validate_inline_xml(children)?,
        }
    }
    Ok(())
}

fn render_publication(
    document: &PublicationDocument,
    request: &HwpxExportRequest,
    cancellation: &CancellationToken,
) -> Result<RenderedDocument> {
    let planned_sections = planned_section_count(document, request.options.section_split_mode);
    let mut sections = vec![RenderedSection {
        paragraphs: Vec::new(),
    }];
    let mut current_section_index = 0_usize;
    let mut saw_volume_heading = false;
    let mut omitted_blocks = Vec::new();
    let mut warnings = HwpxValidationReport::default();
    let mut statistics = HwpxPackageStatistics {
        section_count: planned_sections as u64,
        exported_section_count: document.sections.len() as u64,
        source_section_count: document.sections.len() as u64,
        source_character_count: document.stats.with_spaces,
        ..HwpxPackageStatistics::default()
    };

    // The first paragraph owns the section definition and section-level controls.
    // It has no source mapping and therefore cannot affect source coverage.
    sections[0].paragraphs.push(RenderedParagraph {
        id: 0,
        kind: ParagraphKind::Body,
        page_break: false,
        runs: Vec::new(),
        expected: None,
    });
    let mut next_id = 1_u32;

    if request.options.include_title_page {
        let mut front_matter = vec![(
            ParagraphKind::TitlePageTitle,
            request.metadata.title.clone(),
        )];
        if !request.metadata.author_name.trim().is_empty() {
            front_matter.push((
                ParagraphKind::TitlePageAuthor,
                request.metadata.author_name.clone(),
            ));
        }
        for value in [
            request.metadata.subtitle.as_ref(),
            request.metadata.genre.as_ref(),
            request.metadata.contact.as_ref(),
        ]
        .into_iter()
        .flatten()
        {
            front_matter.push((ParagraphKind::TitlePageAuthor, value.clone()));
        }
        let final_index = front_matter.len().saturating_sub(1);
        for (index, (kind, text)) in front_matter.into_iter().enumerate() {
            sections[current_section_index]
                .paragraphs
                .push(RenderedParagraph {
                    id: next_id,
                    kind,
                    page_break: index == final_index,
                    runs: vec![RenderedRun {
                        char_pr_id: kind.char_pr_id(),
                        text,
                    }],
                    expected: None,
                });
            next_id += 1;
        }
    }

    for section in &document.sections {
        cancellation.check()?;
        for block in &section.blocks {
            cancellation.check()?;
            if request.options.section_split_mode == HwpxSectionSplitMode::Volume
                && matches!(block, PublicationBlock::Heading { level: 2, .. })
            {
                if saw_volume_heading {
                    current_section_index += 1;
                    sections.push(RenderedSection {
                        paragraphs: vec![RenderedParagraph {
                            id: next_id,
                            kind: ParagraphKind::Body,
                            page_break: false,
                            runs: Vec::new(),
                            expected: None,
                        }],
                    });
                    next_id += 1;
                } else {
                    saw_volume_heading = true;
                }
            }
            statistics.source_block_count += 1;
            let source_node_id = block_source_node_id(block).to_owned();
            if let PublicationBlock::Heading { level, .. } = block {
                let (_, included) = heading_kind_and_inclusion(*level, request);
                if !included {
                    statistics.configured_omission_block_count += 1;
                    omitted_blocks.push(ExpectedBlock {
                        section_index: current_section_index,
                        source_node_id,
                        block_id: block_id(block).to_owned(),
                        source_character_count: 0,
                        paragraph: None,
                        disposition: ExpectedDisposition::ConfiguredOmission,
                        is_heading: false,
                        is_scene_break: false,
                        ruby_fallback_count: 0,
                    });
                    continue;
                }
            }
            let (kind, runs, disposition, is_heading, is_scene_break, ruby_fallbacks) = match block
            {
                PublicationBlock::Heading { level, text, .. } => {
                    let (heading_kind, _) = heading_kind_and_inclusion(*level, request);
                    statistics.exported_block_count += 1;
                    (
                        heading_kind,
                        vec![RenderedRun {
                            char_pr_id: heading_kind.char_pr_id(),
                            text: text.clone(),
                        }],
                        ExpectedDisposition::Exported,
                        true,
                        false,
                        0,
                    )
                }
                PublicationBlock::Paragraph { inlines, .. } => {
                    let mut runs = Vec::new();
                    let mut inline_counts = InlineCounts::default();
                    flatten_inlines(inlines, 0, &mut runs, &mut inline_counts);
                    ensure_text_run(&mut runs, 0);
                    accumulate_inline_counts(&mut statistics, inline_counts);
                    if inline_counts.ruby > 0 {
                        statistics.fallback_block_count += 1;
                        push_ruby_warning(&mut warnings, &source_node_id);
                        (
                            ParagraphKind::Body,
                            runs,
                            ExpectedDisposition::Fallback,
                            false,
                            false,
                            inline_counts.ruby,
                        )
                    } else {
                        statistics.exported_block_count += 1;
                        (
                            ParagraphKind::Body,
                            runs,
                            ExpectedDisposition::Exported,
                            false,
                            false,
                            0,
                        )
                    }
                }
                PublicationBlock::Quote { inlines, .. } => {
                    let mut runs = Vec::new();
                    let mut inline_counts = InlineCounts::default();
                    flatten_inlines(inlines, 0, &mut runs, &mut inline_counts);
                    ensure_text_run(&mut runs, ParagraphKind::Blockquote.char_pr_id());
                    if runs.len() == 1 && runs[0].char_pr_id == 0 {
                        runs[0].char_pr_id = ParagraphKind::Blockquote.char_pr_id();
                    }
                    accumulate_inline_counts(&mut statistics, inline_counts);
                    if inline_counts.ruby > 0 {
                        statistics.fallback_block_count += 1;
                        push_ruby_warning(&mut warnings, &source_node_id);
                        (
                            ParagraphKind::Blockquote,
                            runs,
                            ExpectedDisposition::Fallback,
                            false,
                            false,
                            inline_counts.ruby,
                        )
                    } else {
                        statistics.exported_block_count += 1;
                        (
                            ParagraphKind::Blockquote,
                            runs,
                            ExpectedDisposition::Exported,
                            false,
                            false,
                            0,
                        )
                    }
                }
                PublicationBlock::SceneBreak { .. } => {
                    statistics.exported_block_count += 1;
                    statistics.scene_break_count += 1;
                    (
                        ParagraphKind::SceneBreak,
                        vec![RenderedRun {
                            char_pr_id: ParagraphKind::SceneBreak.char_pr_id(),
                            text: scene_break_text(request.options.scene_break_token).to_owned(),
                        }],
                        ExpectedDisposition::Exported,
                        false,
                        true,
                        0,
                    )
                }
                PublicationBlock::Unsupported { text, .. } => {
                    statistics.fallback_block_count += 1;
                    push_warning(
                        &mut warnings,
                        "HWPX_UNSUPPORTED_BLOCK_FALLBACK",
                        "지원하지 않는 블록을 원문 텍스트 문단으로 보존했습니다.",
                        Some(&source_node_id),
                        Some("내보낸 HWPX에서 해당 문단의 표현을 확인하세요."),
                    );
                    (
                        ParagraphKind::Body,
                        vec![RenderedRun {
                            char_pr_id: 0,
                            text: text.clone(),
                        }],
                        ExpectedDisposition::Fallback,
                        false,
                        false,
                        0,
                    )
                }
            };
            let expected_runs = runs
                .iter()
                .map(|run| ExpectedRun {
                    char_pr_id: run.char_pr_id,
                    text: run.text.clone(),
                })
                .collect::<Vec<_>>();
            let expected = ExpectedBlock {
                section_index: current_section_index,
                source_node_id,
                block_id: block_id(block).to_owned(),
                source_character_count: source_block_character_count(block),
                paragraph: Some(ExpectedParagraph {
                    id: next_id,
                    para_pr_id: kind.id(),
                    style_id: kind.id(),
                    runs: expected_runs,
                }),
                disposition,
                is_heading,
                is_scene_break,
                ruby_fallback_count: ruby_fallbacks,
            };
            let page_break = matches!(kind, ParagraphKind::ChapterTitle)
                && request.options.chapter_starts_on_new_page;
            sections[current_section_index]
                .paragraphs
                .push(RenderedParagraph {
                    id: next_id,
                    kind,
                    page_break,
                    runs,
                    expected: Some(expected),
                });
            next_id += 1;
        }
    }

    statistics.exported_character_count = document.stats.with_spaces;
    statistics.rejected_block_count = 0;
    if statistics.configured_omission_block_count > 0 {
        push_info(
            &mut warnings,
            "HWPX_CONFIGURED_HEADING_OMISSION",
            "Preset에서 비활성화한 제목 문단을 의도적으로 출력에서 제외했습니다.",
            Some("내보내기 보고서의 configuredOmissionBlockCount를 확인하세요."),
        );
    }
    if statistics.exported_block_count
        + statistics.fallback_block_count
        + statistics.configured_omission_block_count
        + statistics.rejected_block_count
        != statistics.source_block_count
    {
        return Err(HwpxError::Package);
    }

    if sections.len() != planned_sections {
        return Err(HwpxError::Package);
    }
    let header_footer_count = (u64::from(request.options.include_header)
        + u64::from(request.options.include_footer))
        * sections.len() as u64;
    statistics.paragraph_count = sections
        .iter()
        .map(|section| section.paragraphs.len() as u64)
        .sum::<u64>()
        + header_footer_count;
    statistics.run_count = sections
        .iter()
        .flat_map(|section| &section.paragraphs)
        .map(|paragraph| paragraph.runs.len().max(1) as u64)
        .sum::<u64>()
        + header_footer_count;
    statistics.text_count = sections
        .iter()
        .flat_map(|section| &section.paragraphs)
        .map(|paragraph| paragraph.runs.len() as u64)
        .sum::<u64>()
        + header_footer_count;
    statistics.heading_count = sections
        .iter()
        .flat_map(|section| &section.paragraphs)
        .filter_map(|paragraph| paragraph.expected.as_ref())
        .filter(|expected| expected.is_heading)
        .count() as u64;

    let blocks = sections
        .iter()
        .flat_map(|section| &section.paragraphs)
        .filter_map(|paragraph| paragraph.expected.clone())
        .chain(omitted_blocks)
        .map(|expected| (expected.block_id.clone(), expected))
        .collect();
    let geometry = page_geometry(&request.options.page)?;
    let expectation = HwpxValidationExpectation {
        expected_file_count: 0,
        expected_section_count: planned_sections as u64,
        blocks,
        source_block_count: statistics.source_block_count,
        exported_block_count: statistics.exported_block_count,
        fallback_block_count: statistics.fallback_block_count,
        configured_omission_block_count: statistics.configured_omission_block_count,
        rejected_block_count: statistics.rejected_block_count,
        source_character_count: statistics.source_character_count,
        exported_character_count: statistics.exported_character_count,
        paragraph_count: statistics.paragraph_count,
        run_count: statistics.run_count,
        text_count: statistics.text_count,
        heading_count: statistics.heading_count,
        scene_break_count: statistics.scene_break_count,
        ruby_count: statistics.ruby_count,
        ruby_fallback_count: statistics.ruby_fallback_count,
        strong_segment_count: statistics.strong_segment_count,
        emphasis_segment_count: statistics.emphasis_segment_count,
        underline_segment_count: statistics.underline_segment_count,
        strike_segment_count: statistics.strike_segment_count,
        page_width: geometry.width,
        page_height: geometry.height,
        margin_top: geometry.top,
        margin_bottom: geometry.bottom,
        margin_left: geometry.left,
        margin_right: geometry.right,
        margin_header: geometry.header,
        margin_footer: geometry.footer,
        margin_gutter: geometry.gutter,
        page_number_start: request.options.page_number_start,
        page_number_position: request
            .options
            .include_page_number
            .then_some(page_number_position(request.options.page_number_position).to_owned()),
        header_text: request
            .options
            .include_header
            .then(|| request.options.header_text.clone()),
        footer_text: request
            .options
            .include_footer
            .then(|| request.options.footer_text.clone()),
    };
    Ok(RenderedDocument {
        sections,
        warnings,
        statistics,
        expectation,
    })
}

#[derive(Debug, Clone, Copy, Default)]
struct InlineCounts {
    strong: u64,
    emphasis: u64,
    underline: u64,
    strike: u64,
    ruby: u64,
}

fn flatten_inlines(
    inlines: &[PublicationInline],
    mask: u32,
    runs: &mut Vec<RenderedRun>,
    counts: &mut InlineCounts,
) {
    for inline in inlines {
        match inline {
            PublicationInline::Text { text } => push_run(runs, mask, text),
            PublicationInline::Strong { children } => {
                counts.strong += 1;
                flatten_inlines(children, mask | 0b0001, runs, counts);
            }
            PublicationInline::Emphasis { children } => {
                counts.emphasis += 1;
                flatten_inlines(children, mask | 0b0010, runs, counts);
            }
            PublicationInline::Underline { children } => {
                counts.underline += 1;
                flatten_inlines(children, mask | 0b0100, runs, counts);
            }
            PublicationInline::Strike { children } => {
                counts.strike += 1;
                flatten_inlines(children, mask | 0b1000, runs, counts);
            }
            PublicationInline::Ruby {
                annotation,
                children,
            } => {
                counts.ruby += 1;
                flatten_inlines(children, mask, runs, counts);
                push_run(runs, mask, &format!("({annotation})"));
            }
        }
    }
}

fn push_run(runs: &mut Vec<RenderedRun>, char_pr_id: u32, text: &str) {
    if text.is_empty() {
        return;
    }
    if let Some(last) = runs.last_mut()
        && last.char_pr_id == char_pr_id
    {
        last.text.push_str(text);
    } else {
        runs.push(RenderedRun {
            char_pr_id,
            text: text.to_owned(),
        });
    }
}

fn ensure_text_run(runs: &mut Vec<RenderedRun>, default_char_pr_id: u32) {
    if runs.is_empty() {
        runs.push(RenderedRun {
            char_pr_id: default_char_pr_id,
            text: String::new(),
        });
    }
}

fn accumulate_inline_counts(statistics: &mut HwpxPackageStatistics, counts: InlineCounts) {
    statistics.strong_segment_count += counts.strong;
    statistics.emphasis_segment_count += counts.emphasis;
    statistics.underline_segment_count += counts.underline;
    statistics.strike_segment_count += counts.strike;
    statistics.ruby_count += counts.ruby;
    statistics.ruby_fallback_count += counts.ruby;
}

fn push_ruby_warning(report: &mut HwpxValidationReport, source_node_id: &str) {
    push_warning(
        report,
        "HWPX_RUBY_PLAIN_TEXT_FALLBACK",
        "Ruby는 검증된 HWPX 의미 구조 대신 기본문자(주석) 텍스트로 보존했습니다.",
        Some(source_node_id),
        Some("실제 한/글에서 주석 표기를 확인하세요."),
    );
}

fn push_warning(
    report: &mut HwpxValidationReport,
    code: &str,
    description: &str,
    source_node_id: Option<&str>,
    suggestion: Option<&str>,
) {
    if report.messages.len() >= MAX_EXPORT_WARNINGS {
        return;
    }
    report.push(HwpxValidationMessage {
        code: code.to_owned(),
        severity: HwpxValidationSeverity::Warning,
        description: description.to_owned(),
        source_node_id: source_node_id.map(ToOwned::to_owned),
        hwpx_path: Some(HWPX_SECTION_PATH.to_owned()),
        suggestion: suggestion.map(ToOwned::to_owned),
    });
}

fn push_info(
    report: &mut HwpxValidationReport,
    code: &str,
    description: &str,
    suggestion: Option<&str>,
) {
    if report.messages.len() >= MAX_EXPORT_WARNINGS {
        return;
    }
    report.push(HwpxValidationMessage {
        code: code.to_owned(),
        severity: HwpxValidationSeverity::Info,
        description: description.to_owned(),
        source_node_id: None,
        hwpx_path: Some(HWPX_CONTENT_PATH.to_owned()),
        suggestion: suggestion.map(ToOwned::to_owned),
    });
}

fn heading_kind_and_inclusion(level: u8, request: &HwpxExportRequest) -> (ParagraphKind, bool) {
    match level {
        1 => (ParagraphKind::WorkTitle, request.options.include_work_title),
        2 => (
            ParagraphKind::VolumeTitle,
            request.options.include_volume_titles,
        ),
        3 => (
            ParagraphKind::ChapterTitle,
            request.options.include_chapter_titles,
        ),
        _ => (
            ParagraphKind::SceneTitle,
            request.options.include_scene_titles,
        ),
    }
}

fn scene_break_text(token: HwpxSceneBreakToken) -> &'static str {
    match token {
        HwpxSceneBreakToken::Ornament => "＊　＊　＊",
        HwpxSceneBreakToken::Rule => "―――",
        HwpxSceneBreakToken::Space => "　",
    }
}

fn block_id(block: &PublicationBlock) -> &str {
    match block {
        PublicationBlock::Heading { id, .. }
        | PublicationBlock::Paragraph { id, .. }
        | PublicationBlock::SceneBreak { id, .. }
        | PublicationBlock::Quote { id, .. }
        | PublicationBlock::Unsupported { id, .. } => id,
    }
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

fn source_block_character_count(block: &PublicationBlock) -> u64 {
    match block {
        PublicationBlock::Paragraph { inlines, .. } | PublicationBlock::Quote { inlines, .. } => {
            source_inline_character_count(inlines)
        }
        PublicationBlock::Unsupported { text, .. } => text.chars().count() as u64,
        PublicationBlock::Heading { .. } | PublicationBlock::SceneBreak { .. } => 0,
    }
}

fn source_inline_character_count(inlines: &[PublicationInline]) -> u64 {
    inlines
        .iter()
        .map(|inline| match inline {
            PublicationInline::Text { text } => text.chars().count() as u64,
            PublicationInline::Strong { children }
            | PublicationInline::Emphasis { children }
            | PublicationInline::Underline { children }
            | PublicationInline::Strike { children }
            | PublicationInline::Ruby { children, .. } => source_inline_character_count(children),
        })
        .sum()
}

fn deterministic_fonts(request: &HwpxExportRequest) -> Vec<&str> {
    let candidates = [
        request.options.body.font_family.as_str(),
        request.options.headings.work.font_family.as_str(),
        request.options.headings.volume.font_family.as_str(),
        request.options.headings.chapter.font_family.as_str(),
        request.options.headings.scene.font_family.as_str(),
    ];
    let mut fonts = Vec::with_capacity(candidates.len());
    for font in candidates {
        if !fonts.contains(&font) {
            fonts.push(font);
        }
    }
    fonts
}

fn font_ref_for_kind(
    kind: ParagraphKind,
    request: &HwpxExportRequest,
    fonts: &[&str],
) -> Result<u32> {
    let font = match kind {
        ParagraphKind::WorkTitle | ParagraphKind::TitlePageTitle => {
            request.options.headings.work.font_family.as_str()
        }
        ParagraphKind::VolumeTitle => request.options.headings.volume.font_family.as_str(),
        ParagraphKind::ChapterTitle => request.options.headings.chapter.font_family.as_str(),
        ParagraphKind::SceneTitle => request.options.headings.scene.font_family.as_str(),
        ParagraphKind::Body
        | ParagraphKind::Blockquote
        | ParagraphKind::SceneBreak
        | ParagraphKind::TitlePageAuthor
        | ParagraphKind::Header
        | ParagraphKind::Footer => request.options.body.font_family.as_str(),
    };
    fonts
        .iter()
        .position(|candidate| *candidate == font)
        .and_then(|index| u32::try_from(index).ok())
        .ok_or(HwpxError::Package)
}

fn header_document(request: &HwpxExportRequest, section_count: usize) -> Result<String> {
    let mut xml = String::with_capacity(32_000);
    write!(
        xml,
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><hh:head xmlns:hh=\"{NS_HH}\" xmlns:hc=\"{NS_HC}\" version=\"1.5\" secCnt=\"{section_count}\"><hh:beginNum page=\"{}\" footnote=\"1\" endnote=\"1\" pic=\"1\" tbl=\"1\" equation=\"1\"/><hh:refList>",
        request.options.page_number_start,
    )
    .map_err(|_| HwpxError::Package)?;

    let fonts = deterministic_fonts(request);
    xml.push_str("<hh:fontfaces itemCnt=\"7\">");
    for language in [
        "HANGUL", "LATIN", "HANJA", "JAPANESE", "OTHER", "SYMBOL", "USER",
    ] {
        write!(
            xml,
            "<hh:fontface lang=\"{language}\" fontCnt=\"{}\">",
            fonts.len(),
        )
        .map_err(|_| HwpxError::Package)?;
        for (id, font) in fonts.iter().enumerate() {
            write!(
                xml,
                "<hh:font id=\"{id}\" face=\"{}\" type=\"TTF\" isEmbedded=\"0\"/>",
                xml_attr(font)?,
            )
            .map_err(|_| HwpxError::Package)?;
        }
        xml.push_str("</hh:fontface>");
    }
    xml.push_str("</hh:fontfaces>");
    xml.push_str("<hh:borderFills itemCnt=\"1\"><hh:borderFill id=\"0\" threeD=\"0\" shadow=\"0\" centerLine=\"NONE\" breakCellSeparateLine=\"0\"/></hh:borderFills>");

    let char_property_count = BODY_INLINE_CHAR_PR_COUNT + (ParagraphKind::ALL.len() as u32 - 1);
    write!(xml, "<hh:charProperties itemCnt=\"{char_property_count}\">")
        .map_err(|_| HwpxError::Package)?;
    for mask in 0..BODY_INLINE_CHAR_PR_COUNT {
        write_char_property(
            &mut xml,
            mask,
            point_to_hundredths(request.options.body.font_size_pt),
            0,
            mask & 0b0001 != 0,
            mask & 0b0010 != 0,
            mask & 0b0100 != 0,
            mask & 0b1000 != 0,
        )?;
    }
    for kind in ParagraphKind::ALL
        .into_iter()
        .filter(|kind| *kind != ParagraphKind::Body)
    {
        let (font_size, bold, italic) = char_style(kind, request);
        let font_ref = font_ref_for_kind(kind, request, &fonts)?;
        write_char_property(
            &mut xml,
            kind.char_pr_id(),
            point_to_hundredths(font_size),
            font_ref,
            bold,
            italic,
            false,
            false,
        )?;
    }
    xml.push_str("</hh:charProperties>");
    xml.push_str("<hh:tabProperties itemCnt=\"1\"><hh:tabPr id=\"0\" autoTabLeft=\"0\" autoTabRight=\"0\"/></hh:tabProperties>");

    write!(
        xml,
        "<hh:paraProperties itemCnt=\"{}\">",
        ParagraphKind::ALL.len()
    )
    .map_err(|_| HwpxError::Package)?;
    for kind in ParagraphKind::ALL {
        write_paragraph_property(&mut xml, kind, request)?;
    }
    xml.push_str("</hh:paraProperties>");

    write!(xml, "<hh:styles itemCnt=\"{}\">", ParagraphKind::ALL.len())
        .map_err(|_| HwpxError::Package)?;
    for kind in ParagraphKind::ALL {
        let name = kind.name();
        write!(
            xml,
            "<hh:style id=\"{}\" type=\"PARA\" name=\"{name}\" engName=\"{name}\" paraPrIDRef=\"{}\" charPrIDRef=\"{}\" nextStyleIDRef=\"0\" langID=\"1042\" lockForm=\"0\"/>",
            kind.id(),
            kind.id(),
            kind.char_pr_id()
        )
        .map_err(|_| HwpxError::Package)?;
    }
    xml.push_str("</hh:styles></hh:refList></hh:head>");
    Ok(xml)
}

fn write_char_property(
    xml: &mut String,
    id: u32,
    height: u32,
    font_ref: u32,
    bold: bool,
    italic: bool,
    underline: bool,
    strike: bool,
) -> Result<()> {
    write!(
        xml,
        "<hh:charPr id=\"{id}\" height=\"{height}\" textColor=\"#000000\" shadeColor=\"#FFFFFF\" useFontSpace=\"0\" useKerning=\"0\" symMark=\"NONE\" borderFillIDRef=\"0\"><hh:fontRef hangul=\"{font_ref}\" latin=\"{font_ref}\" hanja=\"{font_ref}\" japanese=\"{font_ref}\" other=\"{font_ref}\" symbol=\"{font_ref}\" user=\"{font_ref}\"/><hh:ratio hangul=\"100\" latin=\"100\" hanja=\"100\" japanese=\"100\" other=\"100\" symbol=\"100\" user=\"100\"/><hh:spacing hangul=\"0\" latin=\"0\" hanja=\"0\" japanese=\"0\" other=\"0\" symbol=\"0\" user=\"0\"/><hh:relSz hangul=\"100\" latin=\"100\" hanja=\"100\" japanese=\"100\" other=\"100\" symbol=\"100\" user=\"100\"/><hh:offset hangul=\"0\" latin=\"0\" hanja=\"0\" japanese=\"0\" other=\"0\" symbol=\"0\" user=\"0\"/>"
    )
    .map_err(|_| HwpxError::Package)?;
    if italic {
        xml.push_str("<hh:italic/>");
    }
    if bold {
        xml.push_str("<hh:bold/>");
    }
    if underline {
        xml.push_str("<hh:underline type=\"BOTTOM\" shape=\"SOLID\" color=\"#000000\"/>");
    }
    if strike {
        xml.push_str("<hh:strikeout shape=\"SOLID\" color=\"#000000\"/>");
    }
    xml.push_str("</hh:charPr>");
    Ok(())
}

fn char_style(kind: ParagraphKind, request: &HwpxExportRequest) -> (f64, bool, bool) {
    let body = request.options.body.font_size_pt;
    match kind {
        ParagraphKind::WorkTitle => (
            request.options.headings.work.font_size_pt,
            request.options.headings.work.bold,
            false,
        ),
        ParagraphKind::VolumeTitle => (
            request.options.headings.volume.font_size_pt,
            request.options.headings.volume.bold,
            false,
        ),
        ParagraphKind::ChapterTitle => (
            request.options.headings.chapter.font_size_pt,
            request.options.headings.chapter.bold,
            false,
        ),
        ParagraphKind::SceneTitle => (
            request.options.headings.scene.font_size_pt,
            request.options.headings.scene.bold,
            false,
        ),
        ParagraphKind::Blockquote => (body, false, true),
        ParagraphKind::SceneBreak => (body, false, false),
        ParagraphKind::TitlePageTitle => (request.options.headings.work.font_size_pt, true, false),
        ParagraphKind::TitlePageAuthor => (body, false, false),
        ParagraphKind::Header | ParagraphKind::Footer => (body.min(9.0), false, false),
        ParagraphKind::Body => (body, false, false),
    }
}

fn write_paragraph_property(
    xml: &mut String,
    kind: ParagraphKind,
    request: &HwpxExportRequest,
) -> Result<()> {
    let (align, indent, left, right, before, after, line_spacing, page_break_before) =
        paragraph_style(kind, request);
    let (line_type, line_value, line_unit) = line_spacing_parts(line_spacing);
    write!(
        xml,
        "<hh:paraPr id=\"{}\" tabPrIDRef=\"0\" condense=\"0\" fontLineHeight=\"0\" snapToGrid=\"0\" suppressLineNumbers=\"0\" checked=\"0\"><hh:align horizontal=\"{}\" vertical=\"BASELINE\"/><hh:heading type=\"NONE\" idRef=\"0\" level=\"0\"/><hh:breakSetting breakLatinWord=\"KEEP_WORD\" breakNonLatinWord=\"BREAK_WORD\" widowOrphan=\"0\" keepWithNext=\"0\" keepLines=\"0\" pageBreakBefore=\"{}\" lineWrap=\"BREAK\"/><hh:margin><hc:intent value=\"{indent}\" unit=\"HWPUNIT\"/><hc:left value=\"{left}\" unit=\"HWPUNIT\"/><hc:right value=\"{right}\" unit=\"HWPUNIT\"/><hc:prev value=\"{before}\" unit=\"HWPUNIT\"/><hc:next value=\"{after}\" unit=\"HWPUNIT\"/></hh:margin><hh:lineSpacing type=\"{line_type}\" value=\"{line_value}\" unit=\"{line_unit}\"/><hh:border borderFillIDRef=\"0\" offsetLeft=\"0\" offsetRight=\"0\" offsetTop=\"0\" offsetBottom=\"0\" connect=\"0\" ignoreMargin=\"0\"/><hh:autoSpacing eAsianEng=\"0\" eAsianNum=\"0\"/></hh:paraPr>",
        kind.id(),
        align_token(align),
        u8::from(page_break_before),
    )
    .map_err(|_| HwpxError::Package)?;
    Ok(())
}

fn paragraph_style(
    kind: ParagraphKind,
    request: &HwpxExportRequest,
) -> (
    HwpxTextAlign,
    i32,
    i32,
    i32,
    i32,
    i32,
    HwpxLineSpacing,
    bool,
) {
    let body = &request.options.body;
    let body_tuple = (
        body.text_align,
        body.first_line_indent_hwpunit,
        0,
        0,
        body.paragraph_spacing_before_hwpunit,
        body.paragraph_spacing_after_hwpunit,
        body.line_spacing,
        false,
    );
    match kind {
        ParagraphKind::Body => body_tuple,
        ParagraphKind::Blockquote => (
            body.text_align,
            0,
            2000,
            2000,
            body.paragraph_spacing_before_hwpunit,
            body.paragraph_spacing_after_hwpunit,
            body.line_spacing,
            false,
        ),
        ParagraphKind::SceneBreak => (
            HwpxTextAlign::Center,
            0,
            0,
            0,
            1000,
            1000,
            HwpxLineSpacing::Percent { percent: 100.0 },
            false,
        ),
        ParagraphKind::TitlePageTitle => {
            heading_para_tuple(&request.options.headings.work, false, HwpxTextAlign::Center)
        }
        ParagraphKind::TitlePageAuthor => (
            HwpxTextAlign::Center,
            0,
            0,
            0,
            600,
            600,
            HwpxLineSpacing::Percent { percent: 120.0 },
            false,
        ),
        ParagraphKind::WorkTitle => {
            heading_para_tuple(&request.options.headings.work, false, HwpxTextAlign::Center)
        }
        ParagraphKind::VolumeTitle => heading_para_tuple(
            &request.options.headings.volume,
            request.options.headings.volume.page_break_before,
            request.options.headings.volume.alignment,
        ),
        ParagraphKind::ChapterTitle => heading_para_tuple(
            &request.options.headings.chapter,
            request.options.headings.chapter.page_break_before
                || request.options.chapter_starts_on_new_page,
            request.options.headings.chapter.alignment,
        ),
        ParagraphKind::SceneTitle => heading_para_tuple(
            &request.options.headings.scene,
            request.options.headings.scene.page_break_before,
            request.options.headings.scene.alignment,
        ),
        ParagraphKind::Header => (
            HwpxTextAlign::Left,
            0,
            0,
            0,
            0,
            0,
            HwpxLineSpacing::Percent { percent: 100.0 },
            false,
        ),
        ParagraphKind::Footer => (
            HwpxTextAlign::Center,
            0,
            0,
            0,
            0,
            0,
            HwpxLineSpacing::Percent { percent: 100.0 },
            false,
        ),
    }
}

fn heading_para_tuple(
    heading: &HwpxHeadingStyle,
    page_break: bool,
    alignment: HwpxTextAlign,
) -> (
    HwpxTextAlign,
    i32,
    i32,
    i32,
    i32,
    i32,
    HwpxLineSpacing,
    bool,
) {
    (
        alignment,
        0,
        0,
        0,
        heading.spacing_before_hwpunit,
        heading.spacing_after_hwpunit,
        HwpxLineSpacing::Percent { percent: 100.0 },
        page_break,
    )
}

fn line_spacing_parts(value: HwpxLineSpacing) -> (&'static str, u32, &'static str) {
    match value {
        HwpxLineSpacing::Percent { percent } => ("PERCENT", percent.round() as u32, "HWPUNIT"),
        HwpxLineSpacing::Fixed { hwpunit } => ("FIXED", hwpunit, "HWPUNIT"),
    }
}

fn align_token(value: HwpxTextAlign) -> &'static str {
    match value {
        HwpxTextAlign::Justify => "JUSTIFY",
        HwpxTextAlign::Left => "LEFT",
        HwpxTextAlign::Right => "RIGHT",
        HwpxTextAlign::Center => "CENTER",
    }
}

fn point_to_hundredths(value: f64) -> u32 {
    (value * 100.0).round() as u32
}

fn section_document(
    paragraphs: &[RenderedParagraph],
    section_index: usize,
    request: &HwpxExportRequest,
) -> Result<String> {
    let geometry = page_geometry(&request.options.page)?;
    let mut xml = String::with_capacity(
        paragraphs
            .iter()
            .flat_map(|paragraph| paragraph.runs.iter())
            .map(|run| run.text.len())
            .sum::<usize>()
            + paragraphs.len() * 180
            + 4_000,
    );
    write!(
        xml,
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><hs:sec xmlns:hs=\"{NS_HS}\" xmlns:hp=\"{NS_HP}\">"
    )
    .map_err(|_| HwpxError::Package)?;
    for (paragraph_index, paragraph) in paragraphs.iter().enumerate() {
        write!(
            xml,
            "<hp:p id=\"{}\" paraPrIDRef=\"{}\" styleIDRef=\"{}\" pageBreak=\"{}\" columnBreak=\"0\" merged=\"0\">",
            paragraph.id,
            paragraph.kind.id(),
            paragraph.kind.id(),
            u8::from(paragraph.page_break),
        )
        .map_err(|_| HwpxError::Package)?;
        if paragraph_index == 0 {
            xml.push_str("<hp:run charPrIDRef=\"0\">");
            write_section_definition(&mut xml, geometry, section_index, request)?;
            write_section_controls(&mut xml, geometry, section_index, request)?;
            xml.push_str("</hp:run>");
        } else {
            for run in &paragraph.runs {
                write!(
                    xml,
                    "<hp:run charPrIDRef=\"{}\"><hp:t>{}</hp:t></hp:run>",
                    run.char_pr_id,
                    xml_text(&run.text)?
                )
                .map_err(|_| HwpxError::Package)?;
            }
        }
        xml.push_str("</hp:p>");
    }
    xml.push_str("</hs:sec>");
    Ok(xml)
}

fn write_section_definition(
    xml: &mut String,
    geometry: PageGeometry,
    section_index: usize,
    request: &HwpxExportRequest,
) -> Result<()> {
    let landscape = match request.options.page.orientation {
        HwpxOrientation::Portrait => "NARROWLY",
        HwpxOrientation::Landscape => "WIDELY",
    };
    write!(
        xml,
        "<hp:secPr id=\"0\" textDirection=\"HORIZONTAL\" spaceColumns=\"0\" tabStop=\"8000\" tabStopVal=\"0\" tabStopUnit=\"HWPUNIT\" outlineShapeIDRef=\"0\" memoShapeIDRef=\"0\" textVerticalWidthHead=\"0\" masterPageCnt=\"0\"><hp:startNum pageStartsOn=\"BOTH\" page=\"{}\" pic=\"1\" tbl=\"1\" equation=\"1\"/><hp:pagePr landscape=\"{landscape}\" width=\"{}\" height=\"{}\" gutterType=\"LEFT_ONLY\"><hp:margin left=\"{}\" right=\"{}\" top=\"{}\" bottom=\"{}\" header=\"{}\" footer=\"{}\" gutter=\"{}\"/></hp:pagePr></hp:secPr>",
        if section_index == 0 {
            request.options.page_number_start
        } else {
            0
        },
        geometry.width,
        geometry.height,
        geometry.left,
        geometry.right,
        geometry.top,
        geometry.bottom,
        geometry.header,
        geometry.footer,
        geometry.gutter,
    )
    .map_err(|_| HwpxError::Package)?;
    Ok(())
}

fn write_section_controls(
    xml: &mut String,
    geometry: PageGeometry,
    section_index: usize,
    request: &HwpxExportRequest,
) -> Result<()> {
    if !request.options.include_header
        && !request.options.include_footer
        && !request.options.include_page_number
    {
        return Ok(());
    }
    xml.push_str("<hp:ctrl>");
    if request.options.include_header {
        write_header_footer(
            xml,
            true,
            HEADER_FOOTER_PARA_ID_BASE + (section_index as u32 * 2),
            geometry,
            &request.options.header_text,
        )?;
    }
    if request.options.include_footer {
        write_header_footer(
            xml,
            false,
            HEADER_FOOTER_PARA_ID_BASE + (section_index as u32 * 2) + 1,
            geometry,
            &request.options.footer_text,
        )?;
    }
    if request.options.include_page_number {
        write!(
            xml,
            "<hp:pageNum pos=\"{}\" formatType=\"DIGIT\" sideChar=\"\"/>",
            page_number_position(request.options.page_number_position)
        )
        .map_err(|_| HwpxError::Package)?;
    }
    xml.push_str("</hp:ctrl>");
    Ok(())
}

fn write_header_footer(
    xml: &mut String,
    header: bool,
    paragraph_id: u32,
    geometry: PageGeometry,
    text: &str,
) -> Result<()> {
    let (element, kind, control_id, height) = if header {
        ("header", ParagraphKind::Header, 0, geometry.top)
    } else {
        ("footer", ParagraphKind::Footer, 1, geometry.bottom)
    };
    let text_width = geometry
        .width
        .saturating_sub(geometry.left + geometry.right + geometry.gutter);
    write!(
        xml,
        "<hp:{element} id=\"{control_id}\" applyPageType=\"BOTH\"><hp:subList id=\"madi-{element}\" textDirection=\"HORIZONTAL\" lineWrap=\"BREAK\" vertAlign=\"TOP\" linkListIDRef=\"0\" linkListNextIDRef=\"0\" textWidth=\"{text_width}\" textHeight=\"{height}\" hasTextRef=\"1\" hasNumRef=\"0\"><hp:p id=\"{paragraph_id}\" paraPrIDRef=\"{}\" styleIDRef=\"{}\" pageBreak=\"0\" columnBreak=\"0\" merged=\"0\"><hp:run charPrIDRef=\"{}\"><hp:t>{}</hp:t></hp:run></hp:p></hp:subList></hp:{element}>",
        kind.id(),
        kind.id(),
        kind.char_pr_id(),
        xml_text(text)?,
    )
    .map_err(|_| HwpxError::Package)?;
    Ok(())
}

fn page_number_position(value: HwpxPageNumberPosition) -> &'static str {
    match value {
        HwpxPageNumberPosition::BottomLeft => "BOTTOM_LEFT",
        HwpxPageNumberPosition::BottomCenter => "BOTTOM_CENTER",
        HwpxPageNumberPosition::BottomRight => "BOTTOM_RIGHT",
    }
}

fn package_entries(
    request: &HwpxExportRequest,
    header: String,
    sections: Vec<String>,
) -> Result<Vec<PackageEntry>> {
    let version = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><hv:HCFVersion xmlns:hv=\"{NS_HV}\" tagetApplication=\"WORDPROCESSOR\" major=\"0\" minor=\"0\" micro=\"0\" buildNumber=\"0\" os=\"0\" xmlVersion=\"{HWPX_XML_VERSION}\" application=\"madi\" appVersion=\"0.1.0\"/>"
    );
    let settings = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><ha:HWPApplicationSetting xmlns:ha=\"{NS_HA}\"><ha:CaretPosition listIDRef=\"0\" paraIDRef=\"0\" pos=\"0\"/></ha:HWPApplicationSetting>"
    );
    let title = xml_text(&request.metadata.title)?;
    let creator = xml_attr(&request.metadata.author_name)?;
    let identifier = xml_text(&request.source_publication_hash)?;
    let mut manifest_items = format!(
        "<opf:item id=\"header\" href=\"{HWPX_HEADER_PATH}\" media-type=\"application/xml\"/>"
    );
    let mut spine_items = String::new();
    for index in 0..sections.len() {
        write!(
            manifest_items,
            "<opf:item id=\"section{index}\" href=\"Contents/section{index}.xml\" media-type=\"application/xml\"/>"
        )
        .map_err(|_| HwpxError::Package)?;
        write!(
            spine_items,
            "<opf:itemref idref=\"section{index}\" linear=\"yes\"/>"
        )
        .map_err(|_| HwpxError::Package)?;
    }
    write!(
        manifest_items,
        "<opf:item id=\"settings\" href=\"{HWPX_SETTINGS_PATH}\" media-type=\"application/xml\"/>"
    )
    .map_err(|_| HwpxError::Package)?;
    let content = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><opf:package xmlns:opf=\"{NS_OPF}\" version=\"1.0\" unique-identifier=\"madi-publication\" id=\"madi-publication\"><opf:metadata id=\"madi-publication\"><opf:title>{title}</opf:title><opf:language>ko</opf:language><opf:identifier>{identifier}</opf:identifier><opf:meta name=\"creator\" content=\"{creator}\"/></opf:metadata><opf:manifest>{manifest_items}</opf:manifest><opf:spine>{spine_items}</opf:spine></opf:package>"
    );
    let rdf =
        format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><rdf:RDF xmlns:rdf=\"{NS_RDF}\"/>");
    let container = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><ocf:container xmlns:ocf=\"{NS_OCF}\"><ocf:rootfiles><ocf:rootfile full-path=\"{HWPX_CONTENT_PATH}\" media-type=\"application/hwpml-package+xml\"/><ocf:rootfile full-path=\"{HWPX_RDF_PATH}\" media-type=\"application/rdf+xml\"/></ocf:rootfiles></ocf:container>"
    );
    let manifest =
        format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><odf:manifest xmlns:odf=\"{NS_ODF}\"/>");
    let mut entries = vec![
        PackageEntry {
            path: "mimetype".to_owned(),
            bytes: HWPX_MIMETYPE.to_vec(),
            compression: CompressionMethod::Stored,
        },
        PackageEntry {
            path: HWPX_VERSION_PATH.to_owned(),
            bytes: version.into_bytes(),
            compression: CompressionMethod::Stored,
        },
        PackageEntry {
            path: HWPX_HEADER_PATH.to_owned(),
            bytes: header.into_bytes(),
            compression: CompressionMethod::Deflated,
        },
    ];
    for (index, section) in sections.into_iter().enumerate() {
        entries.push(PackageEntry {
            path: format!("Contents/section{index}.xml"),
            bytes: section.into_bytes(),
            compression: CompressionMethod::Deflated,
        });
    }
    entries.extend([
        PackageEntry {
            path: HWPX_SETTINGS_PATH.to_owned(),
            bytes: settings.into_bytes(),
            compression: CompressionMethod::Deflated,
        },
        PackageEntry {
            path: HWPX_RDF_PATH.to_owned(),
            bytes: rdf.into_bytes(),
            compression: CompressionMethod::Deflated,
        },
        PackageEntry {
            path: HWPX_CONTENT_PATH.to_owned(),
            bytes: content.into_bytes(),
            compression: CompressionMethod::Deflated,
        },
        PackageEntry {
            path: HWPX_CONTAINER_PATH.to_owned(),
            bytes: container.into_bytes(),
            compression: CompressionMethod::Deflated,
        },
        PackageEntry {
            path: HWPX_MANIFEST_PATH.to_owned(),
            bytes: manifest.into_bytes(),
            compression: CompressionMethod::Deflated,
        },
    ]);
    Ok(entries)
}

fn page_geometry(page: &crate::model::HwpxPageSettings) -> Result<PageGeometry> {
    let (mut width, mut height) = match page.page_size_token {
        HwpxPageSizeToken::A4 => (59_528, 84_188),
        HwpxPageSizeToken::Letter => (61_200, 79_200),
        HwpxPageSizeToken::Custom => (
            mm_to_hwpunit(
                page.custom_width_mm
                    .ok_or(HwpxError::InvalidRequest("custom page width is missing"))?,
            ),
            mm_to_hwpunit(
                page.custom_height_mm
                    .ok_or(HwpxError::InvalidRequest("custom page height is missing"))?,
            ),
        ),
    };
    if page.orientation == HwpxOrientation::Landscape && height > width
        || page.orientation == HwpxOrientation::Portrait && width > height
    {
        std::mem::swap(&mut width, &mut height);
    }
    Ok(PageGeometry {
        width,
        height,
        top: mm_to_hwpunit(page.margin_top_mm),
        bottom: mm_to_hwpunit(page.margin_bottom_mm),
        left: mm_to_hwpunit(page.margin_left_mm),
        right: mm_to_hwpunit(page.margin_right_mm),
        header: mm_to_hwpunit(page.header_margin_mm),
        footer: mm_to_hwpunit(page.footer_margin_mm),
        gutter: mm_to_hwpunit(page.gutter_mm),
    })
}

fn mm_to_hwpunit(value: impl Into<f64>) -> u32 {
    (value.into() * 72_000.0 / 254.0).round() as u32
}

fn write_zip(entries: &[PackageEntry], cancellation: &CancellationToken) -> Result<Vec<u8>> {
    let mut paths = HashSet::new();
    for entry in entries {
        if !safe_package_path(&entry.path) || !paths.insert(entry.path.as_str()) {
            return Err(HwpxError::Package);
        }
    }
    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    for entry in entries {
        cancellation.check()?;
        let options = SimpleFileOptions::default()
            .compression_method(entry.compression)
            .last_modified_time(DateTime::default())
            .unix_permissions(0o644);
        writer.start_file(&entry.path, options)?;
        writer
            .write_all(&entry.bytes)
            .map_err(|_| HwpxError::Package)?;
    }
    let cursor = writer.finish()?;
    Ok(cursor.into_inner())
}

fn reopen_zip(bytes: &[u8]) -> Result<()> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| HwpxError::Package)?;
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|_| HwpxError::Package)?;
        std::io::copy(&mut file, &mut std::io::sink()).map_err(|_| HwpxError::Package)?;
    }
    Ok(())
}

fn logical_package_hash(entries: &[PackageEntry]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"madi-hwpx-logical-package-v1");
    for entry in entries {
        hasher.update((entry.path.len() as u64).to_be_bytes());
        hasher.update(entry.path.as_bytes());
        hasher.update((entry.bytes.len() as u64).to_be_bytes());
        hasher.update(&entry.bytes);
    }
    format!("{:x}", hasher.finalize())
}

fn validate_destination(path: &Path) -> Result<()> {
    let valid_extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("hwpx"));
    let parent = path.parent();
    if !path.is_absolute()
        || !valid_extension
        || path.file_name().is_none()
        || parent.is_none_or(|parent| !parent.is_dir())
    {
        return Err(HwpxError::InvalidDestination);
    }
    Ok(())
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

fn valid_bounded_xml(value: &str, maximum: usize, allow_empty: bool) -> bool {
    (allow_empty || !value.trim().is_empty())
        && value.chars().count() <= maximum
        && value.chars().all(valid_xml_character)
}

fn ensure_xml_text(value: &str) -> Result<()> {
    if value.chars().all(valid_xml_character) {
        Ok(())
    } else {
        Err(HwpxError::InvalidRequest(
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
        .replace('>', "&gt;")
        .replace('\r', "&#13;"))
}

fn xml_attr(value: &str) -> Result<String> {
    Ok(xml_text(value)?
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
        .replace('\t', "&#9;")
        .replace('\n', "&#10;"))
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

fn emit_progress<F>(progress: &mut F, stage: HwpxProgressStage, completed: u64, total: u64)
where
    F: FnMut(HwpxProgressEvent),
{
    progress(HwpxProgressEvent {
        stage,
        completed,
        total,
    });
}

#[cfg(test)]
mod tests {
    use std::io::Read;

    use madi_publication::canonical_publication_document;
    use serde_json::json;
    use zip::ZipArchive;

    use super::*;

    fn sample_document() -> PublicationDocument {
        serde_json::from_value(json!({
            "formatVersion": 1,
            "projectId": "project-1",
            "projectRevision": 7,
            "scopeNodeId": "work-1",
            "scopeKind": "WORK",
            "metadata": { "title": "작품", "authorName": "작가", "language": "ko" },
            "sections": [
                {
                    "id": "section-a",
                    "sourceNodeId": "scene-a",
                    "kind": "SCENE",
                    "title": "장면 A",
                    "parentTitles": ["작품", "1권", "1장"],
                    "blocks": [
                        {
                            "kind": "HEADING", "id": "heading-volume-a", "level": 2,
                            "text": "1권",
                            "source": { "sourceNodeId": "volume-a", "sceneNodeId": "scene-a", "documentId": "doc-a", "blockId": "source-heading-a", "start": null, "end": null, "rangeVerified": false }
                        },
                        {
                            "kind": "PARAGRAPH", "id": "paragraph-a",
                            "inlines": [{ "kind": "STRONG", "children": [{ "kind": "TEXT", "text": "하나" }] }],
                            "source": { "sourceNodeId": "scene-a", "sceneNodeId": "scene-a", "documentId": "doc-a", "blockId": "source-paragraph-a", "start": 0, "end": 2, "rangeVerified": true }
                        }
                    ]
                },
                {
                    "id": "section-b",
                    "sourceNodeId": "scene-b",
                    "kind": "SCENE",
                    "title": "장면 B",
                    "parentTitles": ["작품", "2권", "2장"],
                    "blocks": [
                        {
                            "kind": "HEADING", "id": "heading-volume-b", "level": 2,
                            "text": "2권",
                            "source": { "sourceNodeId": "volume-b", "sceneNodeId": "scene-b", "documentId": "doc-b", "blockId": "source-heading-b", "start": null, "end": null, "rangeVerified": false }
                        },
                        {
                            "kind": "PARAGRAPH", "id": "paragraph-b",
                            "inlines": [{ "kind": "RUBY", "annotation": "dul", "children": [{ "kind": "TEXT", "text": "둘" }] }],
                            "source": { "sourceNodeId": "scene-b", "sceneNodeId": "scene-b", "documentId": "doc-b", "blockId": "source-paragraph-b", "start": 0, "end": 1, "rangeVerified": true }
                        }
                    ]
                }
            ],
            "stats": { "withSpaces": 3, "withoutSpaces": 3, "paragraphCount": 2, "sceneCount": 2, "chapterCount": 0 }
        }))
        .unwrap()
    }

    fn request(document: &PublicationDocument, mode: HwpxSectionSplitMode) -> HwpxExportRequest {
        let canonical = canonical_publication_document(document).unwrap();
        let mut options = HwpxExportOptions::default();
        options.section_split_mode = mode;
        options.include_title_page = true;
        options.include_page_number = true;
        options.include_header = true;
        options.header_text = "머리말".to_owned();
        options.include_footer = true;
        options.footer_text = "꼬리말".to_owned();
        HwpxExportRequest {
            project_id: document.project_id.clone(),
            scope_node_id: document.scope_node_id.clone(),
            expected_project_revision: document.project_revision,
            source_publication_hash: sha256_hex(canonical.as_bytes()),
            preset_id: "builtin-test".to_owned(),
            preset_content_hash: "0".repeat(64),
            metadata: crate::model::HwpxExportMetadata {
                title: "작품".to_owned(),
                author_name: "작가".to_owned(),
                subtitle: Some("부제".to_owned()),
                genre: None,
                contact: Some("private@example.invalid".to_owned()),
            },
            options,
            output_path: Path::new("C:/tmp/test.hwpx").to_path_buf(),
            replace_existing: false,
        }
    }

    fn entry_names(bytes: &[u8]) -> Vec<String> {
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        (0..archive.len())
            .map(|index| archive.by_index(index).unwrap().name().to_owned())
            .collect()
    }

    fn extracted_entries(bytes: &[u8]) -> Vec<PackageEntry> {
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        (0..archive.len())
            .map(|index| {
                let mut entry = archive.by_index(index).unwrap();
                let mut contents = Vec::new();
                entry.read_to_end(&mut contents).unwrap();
                PackageEntry {
                    path: entry.name().to_owned(),
                    bytes: contents,
                    compression: entry.compression(),
                }
            })
            .collect()
    }

    fn rewrite_entry(bytes: &[u8], path: &str, rewrite: impl FnOnce(&mut Vec<u8>)) -> Vec<u8> {
        let mut entries = extracted_entries(bytes);
        let entry = entries.iter_mut().find(|entry| entry.path == path).unwrap();
        rewrite(&mut entry.bytes);
        write_zip(&entries, &CancellationToken::new()).unwrap()
    }

    fn raw_zip_with_extra(bytes: &[u8], path: &str, contents: &[u8]) -> Vec<u8> {
        let entries = extracted_entries(bytes);
        let cursor = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(cursor);
        for entry in entries {
            let options = SimpleFileOptions::default()
                .compression_method(entry.compression)
                .last_modified_time(DateTime::default());
            writer.start_file(entry.path, options).unwrap();
            writer.write_all(&entry.bytes).unwrap();
        }
        writer
            .start_file(
                path,
                SimpleFileOptions::default()
                    .compression_method(CompressionMethod::Deflated)
                    .last_modified_time(DateTime::default()),
            )
            .unwrap();
        writer.write_all(contents).unwrap();
        writer.finish().unwrap().into_inner()
    }

    fn has_code(report: &HwpxValidationReport, code: &str) -> bool {
        report.messages.iter().any(|message| message.code == code)
    }

    #[test]
    fn official_a4_dimensions_are_stable() {
        let geometry = page_geometry(&crate::model::HwpxPageSettings::default()).unwrap();
        assert_eq!((geometry.width, geometry.height), (59_528, 84_188));
    }

    #[test]
    fn package_paths_reject_unsafe_forms() {
        assert!(safe_package_path(HWPX_SECTION_PATH));
        for invalid in [
            "../evil",
            "Contents/../evil",
            "/absolute",
            "C:/absolute",
            "Contents\\evil",
            "Contents//evil",
            "./Contents/evil",
        ] {
            assert!(!safe_package_path(invalid), "accepted {invalid}");
        }
    }

    #[test]
    fn decimal_point_sizes_round_to_hundredths() {
        assert_eq!(point_to_hundredths(10.5), 1050);
        assert_eq!(point_to_hundredths(10.125), 1013);
    }

    #[test]
    fn xml_escaping_preserves_scalar_and_attribute_whitespace_semantics() {
        assert_eq!(xml_text("<&>\r\n\t").unwrap(), "&lt;&amp;&gt;&#13;\n\t");
        assert_eq!(xml_attr("\"'\r\n\t").unwrap(), "&quot;&apos;&#13;&#10;&#9;");
    }

    #[test]
    fn single_section_generation_is_deterministic_and_self_validating() {
        let document = sample_document();
        let request = request(&document, HwpxSectionSplitMode::Single);
        let first = compile_hwpx_bytes(&document, &request, &CancellationToken::new()).unwrap();
        let second = compile_hwpx_bytes(&document, &request, &CancellationToken::new()).unwrap();
        assert_eq!(first.bytes, second.bytes);
        assert_eq!(first.summary.statistics.section_count, 1);
        assert_eq!(first.summary.statistics.exported_section_count, 2);
        assert_eq!(first.summary.statistics.ruby_fallback_count, 1);
        assert_eq!(
            first.summary.validation_report.status,
            HwpxValidationStatus::Pass
        );
        assert_eq!(
            entry_names(&first.bytes).first().map(String::as_str),
            Some("mimetype")
        );
    }

    #[test]
    fn disabled_headings_are_configured_omissions_not_body_fallbacks() {
        let document = sample_document();
        let mut request = request(&document, HwpxSectionSplitMode::Single);
        request.options.include_volume_titles = false;
        let compiled = compile_hwpx_bytes(&document, &request, &CancellationToken::new()).unwrap();
        assert_eq!(compiled.summary.statistics.source_block_count, 4);
        assert_eq!(compiled.summary.statistics.exported_block_count, 1);
        assert_eq!(compiled.summary.statistics.fallback_block_count, 1);
        assert_eq!(
            compiled.summary.statistics.configured_omission_block_count,
            2
        );
        assert_eq!(compiled.summary.statistics.rejected_block_count, 0);
        assert_eq!(compiled.summary.statistics.heading_count, 0);
        let report = crate::validator::validate_hwpx_against_publication(
            &compiled.bytes,
            &document,
            &request.options,
        );
        assert_eq!(report.status, HwpxValidationStatus::Pass);
    }

    #[test]
    fn volume_split_generates_contiguous_manifest_and_spine_sections() {
        let document = sample_document();
        let mut request = request(&document, HwpxSectionSplitMode::Volume);
        request.options.headings.volume.font_family = "맑은 고딕".to_owned();
        let compiled = compile_hwpx_bytes(&document, &request, &CancellationToken::new()).unwrap();
        assert_eq!(compiled.summary.statistics.section_count, 2);
        assert_eq!(compiled.summary.statistics.exported_section_count, 2);
        let names = entry_names(&compiled.bytes);
        assert!(names.iter().any(|name| name == "Contents/section0.xml"));
        assert!(names.iter().any(|name| name == "Contents/section1.xml"));
        let mut archive = ZipArchive::new(Cursor::new(&compiled.bytes)).unwrap();
        let mut content = String::new();
        archive
            .by_name(HWPX_CONTENT_PATH)
            .unwrap()
            .read_to_string(&mut content)
            .unwrap();
        assert!(content.contains("id=\"section1\" href=\"Contents/section1.xml\""));
        assert!(content.contains("idref=\"section1\" linear=\"yes\""));
        let mut header = String::new();
        archive
            .by_name(HWPX_HEADER_PATH)
            .unwrap()
            .read_to_string(&mut header)
            .unwrap();
        assert!(header.contains("id=\"1\" face=\"맑은 고딕\""));
        assert!(header.contains(
            "<hh:charPr id=\"17\" height=\"1800\" textColor=\"#000000\" shadeColor=\"#FFFFFF\" useFontSpace=\"0\" useKerning=\"0\" symMark=\"NONE\" borderFillIDRef=\"0\"><hh:fontRef hangul=\"1\""
        ));
        assert_eq!(
            crate::validator::validate_hwpx_against_publication(
                &compiled.bytes,
                &document,
                &request.options,
            )
            .status,
            HwpxValidationStatus::Pass
        );
        let mut wrong_options = request.options.clone();
        wrong_options.section_split_mode = HwpxSectionSplitMode::Single;
        assert_eq!(
            crate::validator::validate_hwpx_against_publication(
                &compiled.bytes,
                &document,
                &wrong_options,
            )
            .status,
            HwpxValidationStatus::Fail
        );
    }

    #[test]
    fn validator_rejects_active_payloads_and_external_references() {
        let document = sample_document();
        let request = request(&document, HwpxSectionSplitMode::Single);
        let compiled = compile_hwpx_bytes(&document, &request, &CancellationToken::new()).unwrap();

        let active = raw_zip_with_extra(&compiled.bytes, "Scripts/macro.js", b"alert(1)");
        let active_report = crate::validator::validate_hwpx_bytes(&active);
        assert_eq!(active_report.status, HwpxValidationStatus::Fail);
        assert!(has_code(&active_report, "HWPX_ACTIVE_CONTENT"));

        let external = rewrite_entry(&compiled.bytes, HWPX_SECTION_PATH, |section| {
            let xml = String::from_utf8(section.clone()).unwrap().replacen(
                "<hp:t>",
                "<hp:t href=\"https://example.invalid/payload\">",
                1,
            );
            *section = xml.into_bytes();
        });
        let external_report = crate::validator::validate_hwpx_bytes(&external);
        assert_eq!(external_report.status, HwpxValidationStatus::Fail);
        assert!(has_code(&external_report, "HWPX_EXTERNAL_REFERENCE"));
    }

    #[test]
    fn validator_rejects_nested_namespace_rebinding() {
        let document = sample_document();
        let request = request(&document, HwpxSectionSplitMode::Single);
        let compiled = compile_hwpx_bytes(&document, &request, &CancellationToken::new()).unwrap();
        let rebound = rewrite_entry(&compiled.bytes, HWPX_SECTION_PATH, |section| {
            let xml = String::from_utf8(section.clone()).unwrap().replacen(
                "<hp:p id=",
                "<hp:p xmlns:hp=\"urn:madi:audit:evil\" id=",
                1,
            );
            *section = xml.into_bytes();
        });
        let report = crate::validator::validate_hwpx_bytes(&rebound);
        assert_eq!(report.status, HwpxValidationStatus::Fail);
        assert!(has_code(&report, "HWPX_NAMESPACE"));
    }

    #[test]
    fn validator_rejects_traversal_duplicates_and_invalid_xml_controls() {
        let document = sample_document();
        let request = request(&document, HwpxSectionSplitMode::Single);
        let compiled = compile_hwpx_bytes(&document, &request, &CancellationToken::new()).unwrap();

        let traversal = raw_zip_with_extra(&compiled.bytes, "../evil.exe", b"MZ");
        assert!(has_code(
            &crate::validator::validate_hwpx_bytes(&traversal),
            "HWPX_ENTRY_PATH"
        ));

        let mut duplicate =
            raw_zip_with_extra(&compiled.bytes, "Contents/foobar.xml", b"duplicate");
        let placeholder = b"Contents/foobar.xml";
        let replacement = HWPX_HEADER_PATH.as_bytes();
        assert_eq!(placeholder.len(), replacement.len());
        let mut replacements = 0;
        for index in 0..=duplicate.len() - placeholder.len() {
            if &duplicate[index..index + placeholder.len()] == placeholder {
                duplicate[index..index + replacement.len()].copy_from_slice(replacement);
                replacements += 1;
            }
        }
        assert_eq!(replacements, 2);
        let duplicate_report = crate::validator::validate_hwpx_bytes(&duplicate);
        assert_eq!(duplicate_report.status, HwpxValidationStatus::Fail);
        assert!(!duplicate_report.messages.is_empty());

        let invalid_xml = rewrite_entry(&compiled.bytes, HWPX_SECTION_PATH, |section| {
            let position = section.iter().position(|byte| *byte == b'>').unwrap() + 1;
            section.insert(position, 1);
        });
        assert!(has_code(
            &crate::validator::validate_hwpx_bytes(&invalid_xml),
            "HWPX_XML_WELL_FORMED"
        ));
    }

    #[test]
    fn validator_rejects_dangling_spine_and_section_references() {
        let document = sample_document();
        let request = request(&document, HwpxSectionSplitMode::Single);
        let compiled = compile_hwpx_bytes(&document, &request, &CancellationToken::new()).unwrap();
        let dangling = rewrite_entry(&compiled.bytes, HWPX_CONTENT_PATH, |content| {
            let xml = String::from_utf8(content.clone())
                .unwrap()
                .replace("idref=\"section0\"", "idref=\"section99\"");
            *content = xml.into_bytes();
        });
        let report = crate::validator::validate_hwpx_bytes(&dangling);
        assert_eq!(report.status, HwpxValidationStatus::Fail);
        assert!(has_code(&report, "HWPX_SPINE_DANGLING_REF"));
        assert!(has_code(&report, "HWPX_SECTION_MANIFEST_COVERAGE"));
    }

    #[test]
    fn atomic_export_never_clobbers_and_cleans_cancelled_operation_temp() {
        let document = sample_document();
        let directory = tempfile::tempdir().unwrap();
        let output_path = directory.path().join("book.hwpx");
        let mut request = request(&document, HwpxSectionSplitMode::Single);
        request.output_path = output_path.clone();

        let result = export_hwpx(&document, &request, &CancellationToken::new()).unwrap();
        assert_eq!(
            std::fs::read(&output_path).unwrap().len() as u64,
            result.byte_length
        );
        let original = std::fs::read(&output_path).unwrap();
        assert!(matches!(
            export_hwpx(&document, &request, &CancellationToken::new()),
            Err(HwpxError::DestinationExists)
        ));
        assert_eq!(std::fs::read(&output_path).unwrap(), original);

        let operation_id = "12345678-1234-1234-1234-123456789abc";
        request.output_path = directory.path().join("cancelled.hwpx");
        let temporary_path = operation_temporary_path(&request, operation_id).unwrap();
        let cancellation = CancellationToken::new();
        let callback_token = cancellation.clone();
        let cancelled = export_hwpx_for_operation_with_progress(
            &document,
            &request,
            operation_id,
            &cancellation,
            |event| {
                if event.stage == HwpxProgressStage::WriteOutput && event.completed == 0 {
                    callback_token.cancel();
                }
            },
        );
        assert!(matches!(cancelled, Err(HwpxError::Cancelled)));
        assert!(!request.output_path.exists());
        assert!(!temporary_path.exists());
    }
}
