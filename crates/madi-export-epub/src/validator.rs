use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::io::{Cursor, Read};

use madi_publication::{PublicationBlock, PublicationDocument, PublicationInline};
use quick_xml::Reader;
use quick_xml::events::{BytesStart, Event};
use zip::{CompressionMethod, ZipArchive};

use crate::compiler::{
    block_export_id, block_plain_text, stylesheet_for_tokens, stylesheet_is_allowed,
    valid_language, validate_cover_resource,
};
use crate::model::{
    EpubCoverMediaType, EpubExportOptions, EpubTargetProfile, EpubValidationMessage,
    EpubValidationReport, EpubValidationSeverity,
};
use crate::{
    EPUB_CONTAINER_PATH, EPUB_MIMETYPE, EPUB_NAV_PATH, EPUB_PACKAGE_PATH, EPUB_STYLESHEET_PATH,
};

const MAX_ARCHIVE_ENTRIES: usize = 30_000;
const MAX_ENTRY_BYTES: u64 = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
const MAX_VALIDATION_MESSAGES: usize = 1_000;

#[derive(Debug, Clone)]
pub(crate) struct ExpectedBlock {
    pub source_node_id: String,
    pub epub_path: Option<String>,
    pub character_count: u64,
    pub fallback: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct EpubValidationExpectation {
    pub expected_file_count: u64,
    pub content_paths: Vec<String>,
    pub blocks: BTreeMap<String, ExpectedBlock>,
    pub heading_ids: BTreeSet<String>,
    pub heading_sources: BTreeMap<String, String>,
    pub scene_break_ids: BTreeSet<String>,
    pub toc_targets: Vec<String>,
    pub source_section_count: u64,
    pub exported_section_count: u64,
    pub source_block_count: u64,
    pub source_character_count: u64,
    pub scene_break_count: u64,
    pub ruby_count: u64,
    pub heading_count: u64,
    pub cover_expected: bool,
    pub cover: Option<(String, EpubCoverMediaType)>,
    pub expected_stylesheet: Option<String>,
}

impl EpubValidationExpectation {
    pub(crate) fn new(_profile: EpubTargetProfile) -> Self {
        Self {
            expected_file_count: 0,
            content_paths: Vec::new(),
            blocks: BTreeMap::new(),
            heading_ids: BTreeSet::new(),
            heading_sources: BTreeMap::new(),
            scene_break_ids: BTreeSet::new(),
            toc_targets: Vec::new(),
            source_section_count: 0,
            exported_section_count: 0,
            source_block_count: 0,
            source_character_count: 0,
            scene_break_count: 0,
            ruby_count: 0,
            heading_count: 0,
            cover_expected: false,
            cover: None,
            expected_stylesheet: None,
        }
    }
}

#[derive(Debug, Clone)]
struct ArchiveEntry {
    bytes: Vec<u8>,
    compression: CompressionMethod,
}

#[derive(Debug, Default)]
struct ContainerStructure {
    valid: bool,
    container_count: u64,
    rootfiles_count: u64,
    rootfile_count: u64,
    rootfile: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct ManifestItem {
    id: String,
    href: String,
    media_type: String,
    properties: BTreeSet<String>,
}

#[derive(Debug, Clone, Default)]
struct PackageData {
    structure_valid: bool,
    package_count: u64,
    metadata_count: u64,
    manifest_count: u64,
    spine_count: u64,
    title_count: u64,
    creator_count: u64,
    language_count: u64,
    modified_count: u64,
    duplicate_identifier_id: bool,
    package_child_phase: u8,
    namespace: String,
    dc_namespace_present: bool,
    version: String,
    unique_identifier_ref: String,
    identifiers: BTreeMap<String, String>,
    title: String,
    creator: String,
    language: String,
    xml_language: String,
    modified: String,
    manifest: Vec<ManifestItem>,
    spine: Vec<String>,
}

#[derive(Debug, Clone)]
struct LinkReference {
    source_path: String,
    href: String,
    is_nav: bool,
}

#[derive(Debug, Clone, Default)]
struct XhtmlData {
    structure_valid: bool,
    html_count: u64,
    head_count: u64,
    title_count: u64,
    body_count: u64,
    title_has_text: bool,
    html_child_phase: u8,
    ids: BTreeSet<String>,
    block_characters: BTreeMap<String, u64>,
    fallback_ids: BTreeSet<String>,
    heading_ids: BTreeSet<String>,
    scene_break_ids: BTreeSet<String>,
    section_ids: BTreeSet<String>,
    ruby_count: u64,
    language_present: bool,
    head_present: bool,
    body_present: bool,
    stylesheet_present: bool,
    toc_nav_present: bool,
    epub_namespace_present: bool,
    links: Vec<LinkReference>,
}

pub fn validate_epub_bytes(bytes: &[u8]) -> EpubValidationReport {
    validate_epub_with_expectation(bytes, None)
}

pub fn validate_epub_against_publication(
    bytes: &[u8],
    document: &PublicationDocument,
    options: &EpubExportOptions,
) -> EpubValidationReport {
    let mut expectation = EpubValidationExpectation::new(options.target_profile);
    expectation.expected_stylesheet = Some(stylesheet_for_tokens(
        options.stylesheet_token,
        options.body_style_token,
        options.scene_break_style_token,
    ));
    expectation.source_section_count = document.sections.len() as u64;
    expectation.exported_section_count = document.sections.len() as u64;
    expectation.cover_expected = options.include_cover;
    for section in &document.sections {
        for block in &section.blocks {
            let id = block_export_id(block);
            let plain_text = block_plain_text(block);
            expectation.source_block_count += 1;
            expectation.source_character_count += plain_text.chars().count() as u64;
            expectation.blocks.insert(
                id.clone(),
                ExpectedBlock {
                    source_node_id: block_source_node_id(block).to_owned(),
                    epub_path: None,
                    character_count: plain_text.chars().count() as u64,
                    fallback: matches!(block, PublicationBlock::Unsupported { .. }),
                },
            );
            match block {
                PublicationBlock::Heading { source, .. } => {
                    expectation.heading_count += 1;
                    expectation.heading_ids.insert(id.clone());
                    expectation
                        .heading_sources
                        .insert(id, source.source_node_id.clone());
                }
                PublicationBlock::SceneBreak { .. } => {
                    expectation.scene_break_count += 1;
                    expectation.scene_break_ids.insert(id);
                }
                PublicationBlock::Paragraph { inlines, .. }
                | PublicationBlock::Quote { inlines, .. } => {
                    expectation.ruby_count += count_ruby(inlines);
                }
                PublicationBlock::Unsupported { .. } => {}
            }
        }
    }
    validate_epub_with_expectation(bytes, Some(&expectation))
}

pub(crate) fn validate_epub_with_expectation(
    bytes: &[u8],
    expectation: Option<&EpubValidationExpectation>,
) -> EpubValidationReport {
    let mut report = EpubValidationReport::default();
    let Some(entries) = read_archive(bytes, &mut report) else {
        return report;
    };
    if let Some(expectation) = expectation {
        if expectation.expected_file_count > 0
            && entries.len() as u64 != expectation.expected_file_count
        {
            error(
                &mut report,
                "EPUB_FILE_COUNT_MISMATCH",
                "EPUB 파일 수가 생성 계획과 일치하지 않습니다.",
                None,
                None,
                Some("내보내기를 다시 실행하세요."),
            );
        }
    }

    let rootfile = validate_container(&entries, &mut report);
    let Some(rootfile) = rootfile else {
        return report;
    };
    if rootfile != EPUB_PACKAGE_PATH {
        error(
            &mut report,
            "EPUB_ROOTFILE_UNEXPECTED",
            "container.xml의 package document 경로가 Madi package layout과 다릅니다.",
            None,
            Some(EPUB_CONTAINER_PATH),
            Some("EPUB/package.opf를 rootfile로 사용하세요."),
        );
    }
    let Some(package_entry) = entries.get(&rootfile) else {
        fatal(
            &mut report,
            "EPUB_PACKAGE_MISSING",
            "container.xml이 가리키는 package document가 없습니다.",
            None,
            Some(&rootfile),
            Some("EPUB package를 다시 생성하세요."),
        );
        return report;
    };
    let Some(package) = parse_package(&package_entry.bytes, &rootfile, &mut report) else {
        return report;
    };
    validate_package(&package, &rootfile, &entries, expectation, &mut report);

    let mut xhtml_by_path = BTreeMap::new();
    let manifest_xhtml: Vec<_> = package
        .manifest
        .iter()
        .filter(|item| item.media_type == "application/xhtml+xml")
        .filter_map(|item| resolve_internal_path(&rootfile, &item.href).map(|path| (item, path)))
        .collect();
    for (item, path) in manifest_xhtml {
        let Some(entry) = entries.get(&path) else {
            continue;
        };
        let is_nav = item.properties.contains("nav");
        if let Some(data) = parse_xhtml(&entry.bytes, &path, is_nav, &package.language, &mut report)
        {
            xhtml_by_path.insert(path, data);
        }
    }
    validate_links(&xhtml_by_path, &entries, &mut report);
    validate_manifest_completeness(&entries, &rootfile, &package, &mut report);
    if let Some(expectation) = expectation {
        validate_coverage(expectation, &package, &xhtml_by_path, &mut report);
    }
    report
}

fn read_archive(
    bytes: &[u8],
    report: &mut EpubValidationReport,
) -> Option<BTreeMap<String, ArchiveEntry>> {
    let mut archive = match ZipArchive::new(Cursor::new(bytes)) {
        Ok(archive) => archive,
        Err(_) => {
            fatal(
                report,
                "EPUB_ZIP_INVALID",
                "파일이 유효한 ZIP container가 아닙니다.",
                None,
                None,
                Some("EPUB을 다시 생성하세요."),
            );
            return None;
        }
    };
    if archive.len() == 0 || archive.len() > MAX_ARCHIVE_ENTRIES {
        fatal(
            report,
            "EPUB_ZIP_ENTRY_COUNT",
            "ZIP entry 수가 안전 범위를 벗어났습니다.",
            None,
            None,
            Some("EPUB package 구성을 확인하세요."),
        );
        return None;
    }
    let mut entries = BTreeMap::new();
    let mut total_size = 0_u64;
    for index in 0..archive.len() {
        let mut entry = match archive.by_index(index) {
            Ok(entry) => entry,
            Err(_) => {
                fatal(
                    report,
                    "EPUB_ZIP_ENTRY_INVALID",
                    "ZIP entry를 읽을 수 없습니다.",
                    None,
                    None,
                    Some("EPUB을 다시 생성하세요."),
                );
                return None;
            }
        };
        let path = entry.name().to_owned();
        if !safe_package_path(&path) {
            fatal(
                report,
                "EPUB_ZIP_PATH_UNSAFE",
                "ZIP에 안전하지 않은 상대경로가 포함되어 있습니다.",
                None,
                Some(&path),
                Some("절대경로와 상위 디렉터리 이동을 제거하세요."),
            );
            continue;
        }
        if entry.is_dir() {
            error(
                report,
                "EPUB_ZIP_DIRECTORY_ENTRY",
                "명시적인 directory ZIP entry는 Madi package에 포함하지 않습니다.",
                None,
                Some(&path),
                Some("파일 entry만 package에 포함하세요."),
            );
            continue;
        }
        if entry.size() > MAX_ENTRY_BYTES {
            fatal(
                report,
                "EPUB_ZIP_ENTRY_TOO_LARGE",
                "ZIP entry가 내부 validator의 안전 크기 제한을 초과했습니다.",
                None,
                Some(&path),
                Some("리소스 크기를 줄이세요."),
            );
            continue;
        }
        total_size = total_size.saturating_add(entry.size());
        if total_size > MAX_TOTAL_BYTES {
            fatal(
                report,
                "EPUB_ZIP_TOTAL_TOO_LARGE",
                "압축 해제된 EPUB 크기가 내부 validator의 안전 제한을 초과했습니다.",
                None,
                None,
                Some("출판 범위나 asset 크기를 줄이세요."),
            );
            return None;
        }
        let compression = entry.compression();
        if !matches!(
            compression,
            CompressionMethod::Stored | CompressionMethod::Deflated
        ) {
            fatal(
                report,
                "EPUB_ZIP_COMPRESSION_UNSUPPORTED",
                "EPUB은 Stored 또는 Deflate ZIP entry만 허용합니다.",
                None,
                Some(&path),
                Some("지원되는 ZIP compression으로 다시 생성하세요."),
            );
        }
        let mut content = Vec::with_capacity(entry.size() as usize);
        if entry.read_to_end(&mut content).is_err() {
            fatal(
                report,
                "EPUB_ZIP_ENTRY_READ",
                "ZIP entry의 압축을 안전하게 해제할 수 없습니다.",
                None,
                Some(&path),
                Some("EPUB을 다시 생성하세요."),
            );
            return None;
        }
        if entries
            .insert(
                path.clone(),
                ArchiveEntry {
                    bytes: content,
                    compression,
                },
            )
            .is_some()
        {
            fatal(
                report,
                "EPUB_ZIP_PATH_DUPLICATE",
                "ZIP에 중복 entry 경로가 있습니다.",
                None,
                Some(&path),
                Some("모든 EPUB entry 경로를 고유하게 만드세요."),
            );
        }
        if index == 0 && path != "mimetype" {
            fatal(
                report,
                "EPUB_MIMETYPE_NOT_FIRST",
                "mimetype가 ZIP의 첫 entry가 아닙니다.",
                None,
                Some(&path),
                Some("mimetype를 첫 entry로 저장하세요."),
            );
        }
    }
    validate_mimetype_header(bytes, &entries, report);
    Some(entries)
}

fn validate_mimetype_header(
    zip_bytes: &[u8],
    entries: &BTreeMap<String, ArchiveEntry>,
    report: &mut EpubValidationReport,
) {
    let Some(mimetype) = entries.get("mimetype") else {
        fatal(
            report,
            "EPUB_MIMETYPE_MISSING",
            "EPUB mimetype entry가 없습니다.",
            None,
            Some("mimetype"),
            Some("정확한 EPUB media type entry를 추가하세요."),
        );
        return;
    };
    if mimetype.bytes != EPUB_MIMETYPE {
        fatal(
            report,
            "EPUB_MIMETYPE_CONTENT",
            "mimetype 내용이 application/epub+zip과 정확히 일치하지 않습니다.",
            None,
            Some("mimetype"),
            Some("공백과 BOM 없이 정확한 ASCII media type을 사용하세요."),
        );
    }
    if mimetype.compression != CompressionMethod::Stored {
        fatal(
            report,
            "EPUB_MIMETYPE_COMPRESSED",
            "mimetype entry는 압축하면 안 됩니다.",
            None,
            Some("mimetype"),
            Some("Stored 방식으로 저장하세요."),
        );
    }
    if zip_bytes.len() < 30 || &zip_bytes[..4] != b"PK\x03\x04" {
        fatal(
            report,
            "EPUB_MIMETYPE_LOCAL_HEADER",
            "첫 ZIP local header가 올바르지 않습니다.",
            None,
            Some("mimetype"),
            Some("표준 ZIP writer로 package를 다시 생성하세요."),
        );
        return;
    }
    let method = u16::from_le_bytes([zip_bytes[8], zip_bytes[9]]);
    let name_length = u16::from_le_bytes([zip_bytes[26], zip_bytes[27]]) as usize;
    let extra_length = u16::from_le_bytes([zip_bytes[28], zip_bytes[29]]) as usize;
    let name_end = 30_usize.saturating_add(name_length);
    if method != 0
        || extra_length != 0
        || name_end > zip_bytes.len()
        || &zip_bytes[30..name_end] != b"mimetype"
    {
        fatal(
            report,
            "EPUB_MIMETYPE_HEADER_CONSTRAINT",
            "mimetype local header의 compression, name 또는 extra field가 규격과 다릅니다.",
            None,
            Some("mimetype"),
            Some("mimetype를 첫 entry, Stored, extra field 없음으로 기록하세요."),
        );
    }
}

fn validate_container(
    entries: &BTreeMap<String, ArchiveEntry>,
    report: &mut EpubValidationReport,
) -> Option<String> {
    let Some(container) = entries.get(EPUB_CONTAINER_PATH) else {
        fatal(
            report,
            "EPUB_CONTAINER_MISSING",
            "META-INF/container.xml이 없습니다.",
            None,
            Some(EPUB_CONTAINER_PATH),
            Some("필수 OCF container document를 추가하세요."),
        );
        return None;
    };
    if !xml_attributes_are_unique(&container.bytes) {
        error(
            report,
            "EPUB_XML_ATTRIBUTE_INVALID",
            "container.xml에 중복되거나 잘못된 attribute가 있습니다.",
            None,
            Some(EPUB_CONTAINER_PATH),
            Some("XML attribute를 고유하게 만드세요."),
        );
    }
    let mut reader = Reader::from_reader(container.bytes.as_slice());
    reader.config_mut().trim_text(true);
    let mut buffer = Vec::new();
    let mut stack = Vec::new();
    let mut structure = ContainerStructure {
        valid: true,
        ..ContainerStructure::default()
    };
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) => {
                let name = inspect_container_element(
                    &reader,
                    &event,
                    stack.last().map(String::as_str),
                    false,
                    &mut structure,
                );
                stack.push(name);
            }
            Ok(Event::Empty(event)) => {
                inspect_container_element(
                    &reader,
                    &event,
                    stack.last().map(String::as_str),
                    true,
                    &mut structure,
                );
            }
            Ok(Event::End(event)) => {
                let actual = String::from_utf8_lossy(event.name().as_ref()).into_owned();
                if stack.pop().as_deref() != Some(actual.as_str()) {
                    structure.valid = false;
                }
            }
            Ok(Event::DocType(_)) => {
                error(
                    report,
                    "EPUB_XML_DOCTYPE_FORBIDDEN",
                    "container.xml에는 DOCTYPE을 포함하지 않습니다.",
                    None,
                    Some(EPUB_CONTAINER_PATH),
                    Some("DOCTYPE과 외부 identifier를 제거하세요."),
                );
            }
            Ok(Event::PI(_)) => {
                error(
                    report,
                    "EPUB_XML_PROCESSING_INSTRUCTION",
                    "container.xml에 processing instruction이 포함되어 있습니다.",
                    None,
                    Some(EPUB_CONTAINER_PATH),
                    Some("XML processing instruction을 제거하세요."),
                );
            }
            Ok(Event::Eof) => break,
            Err(_) => {
                fatal(
                    report,
                    "EPUB_CONTAINER_XML_INVALID",
                    "container.xml이 well-formed XML이 아닙니다.",
                    None,
                    Some(EPUB_CONTAINER_PATH),
                    Some("container.xml을 다시 생성하세요."),
                );
                return None;
            }
            _ => {}
        }
        buffer.clear();
    }
    if !stack.is_empty()
        || !structure.valid
        || structure.container_count != 1
        || structure.rootfiles_count != 1
        || structure.rootfile_count != 1
        || structure.rootfile.is_none()
    {
        error(
            report,
            "EPUB_CONTAINER_STRUCTURE",
            "container.xml의 namespace, rootfiles/rootfile 구조 또는 단일성이 유효하지 않습니다.",
            None,
            Some(EPUB_CONTAINER_PATH),
            Some("OCF container 아래에 rootfiles와 유효한 rootfile을 각각 하나만 두세요."),
        );
    }
    structure.rootfile
}

fn inspect_container_element(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
    parent: Option<&str>,
    is_empty: bool,
    structure: &mut ContainerStructure,
) -> String {
    let name = String::from_utf8_lossy(event.name().as_ref()).into_owned();
    let attrs = attributes(reader, event);
    let valid = match name.as_str() {
        "container" => {
            structure.container_count += 1;
            parent.is_none()
                && !is_empty
                && attrs.len() == 2
                && attrs.get("version").map(String::as_str) == Some("1.0")
                && attrs.get("xmlns").map(String::as_str)
                    == Some("urn:oasis:names:tc:opendocument:xmlns:container")
        }
        "rootfiles" => {
            structure.rootfiles_count += 1;
            parent == Some("container") && !is_empty && attrs.is_empty()
        }
        "rootfile" => {
            structure.rootfile_count += 1;
            let full_path = attrs.get("full-path").cloned();
            let valid = parent == Some("rootfiles")
                && is_empty
                && attrs.len() == 2
                && attrs.get("media-type").map(String::as_str)
                    == Some("application/oebps-package+xml")
                && full_path.as_deref().is_some_and(safe_package_path)
                && structure.rootfile.is_none();
            if valid {
                structure.rootfile = full_path;
            }
            valid
        }
        _ => false,
    };
    structure.valid &= valid;
    name
}

fn parse_package(
    bytes: &[u8],
    path: &str,
    report: &mut EpubValidationReport,
) -> Option<PackageData> {
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut package = PackageData {
        structure_valid: true,
        ..PackageData::default()
    };
    if !xml_attributes_are_unique(bytes) {
        error(
            report,
            "EPUB_XML_ATTRIBUTE_INVALID",
            "package document에 중복되거나 잘못된 attribute가 있습니다.",
            None,
            Some(path),
            Some("XML attribute를 고유하게 만드세요."),
        );
    }
    let mut stack: Vec<(String, BTreeMap<String, String>, String, bool)> = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) => {
                let name = String::from_utf8_lossy(event.name().as_ref()).into_owned();
                let attrs = attributes(&reader, &event);
                let valid = inspect_package_element(
                    &name,
                    &attrs,
                    stack.last().map(|entry| entry.0.as_str()),
                    false,
                    &mut package,
                );
                stack.push((name, attrs, String::new(), valid));
            }
            Ok(Event::Empty(event)) => {
                let name = String::from_utf8_lossy(event.name().as_ref()).into_owned();
                let attrs = attributes(&reader, &event);
                let valid = inspect_package_element(
                    &name,
                    &attrs,
                    stack.last().map(|entry| entry.0.as_str()),
                    true,
                    &mut package,
                );
                if valid {
                    process_package_element(local_name(name.as_bytes()), &attrs, "", &mut package);
                }
            }
            Ok(Event::Text(text)) => {
                if let Some((_, _, value, _)) = stack.last_mut() {
                    match text.unescape() {
                        Ok(text) => value.push_str(&text),
                        Err(_) => {
                            error(
                                report,
                                "EPUB_PACKAGE_TEXT_INVALID",
                                "package metadata text를 XML decode할 수 없습니다.",
                                None,
                                Some(path),
                                Some("metadata XML escaping을 확인하세요."),
                            );
                        }
                    }
                }
            }
            Ok(Event::End(event)) => {
                let actual = String::from_utf8_lossy(event.name().as_ref()).into_owned();
                if let Some((name, attrs, text, valid)) = stack.pop() {
                    if name != actual {
                        package.structure_valid = false;
                    }
                    if valid {
                        process_package_element(
                            local_name(name.as_bytes()),
                            &attrs,
                            text.trim(),
                            &mut package,
                        );
                    }
                } else {
                    package.structure_valid = false;
                }
            }
            Ok(Event::DocType(_)) => {
                error(
                    report,
                    "EPUB_XML_DOCTYPE_FORBIDDEN",
                    "package document에는 DOCTYPE을 포함하지 않습니다.",
                    None,
                    Some(path),
                    Some("DOCTYPE과 외부 identifier를 제거하세요."),
                );
            }
            Ok(Event::PI(_)) => {
                error(
                    report,
                    "EPUB_XML_PROCESSING_INSTRUCTION",
                    "package document에 processing instruction이 포함되어 있습니다.",
                    None,
                    Some(path),
                    Some("XML processing instruction을 제거하세요."),
                );
            }
            Ok(Event::Eof) => break,
            Err(_) => {
                fatal(
                    report,
                    "EPUB_PACKAGE_XML_INVALID",
                    "package.opf가 well-formed XML이 아닙니다.",
                    None,
                    Some(path),
                    Some("package document를 다시 생성하세요."),
                );
                return None;
            }
            _ => {}
        }
        buffer.clear();
    }
    if !stack.is_empty() {
        package.structure_valid = false;
    }
    Some(package)
}

fn inspect_package_element(
    name: &str,
    attrs: &BTreeMap<String, String>,
    parent: Option<&str>,
    is_empty: bool,
    package: &mut PackageData,
) -> bool {
    let valid = match name {
        "package" => {
            package.package_count += 1;
            package.namespace = attrs.get("xmlns").cloned().unwrap_or_default();
            package.version = attrs.get("version").cloned().unwrap_or_default();
            package.unique_identifier_ref =
                attrs.get("unique-identifier").cloned().unwrap_or_default();
            package.xml_language = attrs.get("xml:lang").cloned().unwrap_or_default();
            parent.is_none()
                && !is_empty
                && package.package_count == 1
                && package.namespace == "http://www.idpf.org/2007/opf"
        }
        "metadata" => {
            package.metadata_count += 1;
            package.dc_namespace_present = attrs.get("xmlns:dc").map(String::as_str)
                == Some("http://purl.org/dc/elements/1.1/");
            let valid = parent == Some("package")
                && !is_empty
                && package.metadata_count == 1
                && package.package_child_phase == 0
                && package.dc_namespace_present;
            if valid {
                package.package_child_phase = 1;
            }
            valid
        }
        "manifest" => {
            package.manifest_count += 1;
            let valid = parent == Some("package")
                && !is_empty
                && package.manifest_count == 1
                && package.package_child_phase == 1;
            if valid {
                package.package_child_phase = 2;
            }
            valid
        }
        "spine" => {
            package.spine_count += 1;
            let valid = parent == Some("package")
                && !is_empty
                && package.spine_count == 1
                && package.package_child_phase == 2;
            if valid {
                package.package_child_phase = 3;
            }
            valid
        }
        "dc:identifier" | "dc:title" | "dc:creator" | "dc:language" | "dc:publisher"
        | "dc:description" | "dc:rights" | "dc:subject" => parent == Some("metadata") && !is_empty,
        "meta" => parent == Some("metadata") && !is_empty,
        "item" => parent == Some("manifest") && is_empty,
        "itemref" => parent == Some("spine") && is_empty,
        _ => false,
    };
    package.structure_valid &= valid;
    valid
}

fn process_package_element(
    name: &[u8],
    attrs: &BTreeMap<String, String>,
    text: &str,
    package: &mut PackageData,
) {
    match name {
        b"identifier" => {
            if let Some(id) = attrs.get("id") {
                package.duplicate_identifier_id |= package
                    .identifiers
                    .insert(id.clone(), text.to_owned())
                    .is_some();
            }
        }
        b"title" => {
            package.title_count += 1;
            if package.title.is_empty() {
                package.title = text.to_owned();
            }
        }
        b"creator" => {
            package.creator_count += 1;
            if package.creator.is_empty() {
                package.creator = text.to_owned();
            }
        }
        b"language" => {
            package.language_count += 1;
            if package.language.is_empty() {
                package.language = text.to_owned();
            }
        }
        b"meta" if attrs.get("property").map(String::as_str) == Some("dcterms:modified") => {
            package.modified_count += 1;
            package.modified = text.to_owned();
        }
        b"item" => package.manifest.push(ManifestItem {
            id: attrs.get("id").cloned().unwrap_or_default(),
            href: attrs.get("href").cloned().unwrap_or_default(),
            media_type: attrs.get("media-type").cloned().unwrap_or_default(),
            properties: attrs
                .get("properties")
                .map(|value| value.split_whitespace().map(str::to_owned).collect())
                .unwrap_or_default(),
        }),
        b"itemref" => package
            .spine
            .push(attrs.get("idref").cloned().unwrap_or_default()),
        _ => {}
    }
}

fn validate_package(
    package: &PackageData,
    package_path: &str,
    entries: &BTreeMap<String, ArchiveEntry>,
    expectation: Option<&EpubValidationExpectation>,
    report: &mut EpubValidationReport,
) {
    if !package.structure_valid
        || package.package_count != 1
        || package.metadata_count != 1
        || package.manifest_count != 1
        || package.spine_count != 1
        || package.package_child_phase != 3
        || package.title_count != 1
        || package.creator_count != 1
        || package.language_count != 1
        || package.modified_count != 1
        || package.duplicate_identifier_id
    {
        error(
            report,
            "EPUB_PACKAGE_STRUCTURE",
            "package document의 namespace, metadata/manifest/spine 구조 또는 필수 metadata 단일성이 유효하지 않습니다.",
            None,
            Some(package_path),
            Some("OPF package 아래에 metadata, manifest, spine을 순서대로 각각 하나만 두세요."),
        );
    }
    if package.namespace != "http://www.idpf.org/2007/opf"
        || !package.dc_namespace_present
        || package.version != "3.0"
    {
        error(
            report,
            "EPUB_PACKAGE_VERSION",
            "package version이 선택한 EPUB profile과 일치하지 않습니다.",
            None,
            Some(package_path),
            Some("선택한 profile의 package version을 사용하세요."),
        );
    }
    let identifier = package.identifiers.get(&package.unique_identifier_ref);
    if !valid_xml_id(&package.unique_identifier_ref)
        || identifier.is_none_or(|identifier| identifier.trim().is_empty())
        || package.identifiers.keys().any(|id| !valid_xml_id(id))
        || package.title.trim().is_empty()
        || package.creator.trim().is_empty()
        || !valid_language(&package.language)
        || !valid_language(&package.xml_language)
        || !package.language.eq_ignore_ascii_case(&package.xml_language)
        || !valid_modified(&package.modified)
    {
        error(
            report,
            "EPUB_PACKAGE_METADATA_REQUIRED",
            "identifier, title, creator, language 또는 modified metadata가 유효하지 않습니다.",
            None,
            Some(package_path),
            Some("필수 publication metadata를 입력하세요."),
        );
    }
    let mut ids = HashSet::new();
    let mut hrefs = HashSet::new();
    let mut manifest_by_id = BTreeMap::new();
    let mut nav_count = 0;
    for item in &package.manifest {
        let path = resolve_internal_path(package_path, &item.href);
        if !valid_xml_id(&item.id)
            || item.href.is_empty()
            || item.media_type.is_empty()
            || !ids.insert(item.id.as_str())
            || !hrefs.insert(item.href.as_str())
            || path.is_none()
        {
            error(
                report,
                "EPUB_MANIFEST_ITEM_INVALID",
                "manifest item의 id, href 또는 media type이 유효하거나 고유하지 않습니다.",
                None,
                Some(package_path),
                Some("manifest id와 href를 고유한 안전 상대경로로 만드세요."),
            );
            continue;
        }
        let path = path.unwrap();
        if !entries.contains_key(&path) {
            error(
                report,
                "EPUB_MANIFEST_FILE_MISSING",
                "manifest가 존재하지 않는 package 파일을 가리킵니다.",
                None,
                Some(&path),
                Some("파일을 package에 포함하거나 manifest item을 수정하세요."),
            );
        }
        if !media_type_matches_path(&item.media_type, &path) {
            error(
                report,
                "EPUB_MANIFEST_MEDIA_TYPE",
                "manifest media type과 resource 확장자가 일치하지 않습니다.",
                None,
                Some(&path),
                Some("resource의 정확한 media type을 지정하세요."),
            );
        }
        if item.properties.contains("nav") {
            nav_count += 1;
            if path != EPUB_NAV_PATH || item.media_type != "application/xhtml+xml" {
                error(
                    report,
                    "EPUB_NAV_MANIFEST_ITEM",
                    "navigation document manifest item이 잘못되었습니다.",
                    None,
                    Some(&path),
                    Some("nav.xhtml을 properties=nav로 등록하세요."),
                );
            }
        }
        manifest_by_id.insert(item.id.as_str(), (item, path));
    }
    validate_stylesheets_and_assets(package, package_path, entries, expectation, report);
    if nav_count != 1 {
        error(
            report,
            "EPUB_NAV_MANIFEST_COUNT",
            "navigation document manifest item은 정확히 하나여야 합니다.",
            None,
            Some(package_path),
            Some("properties=nav item을 하나만 유지하세요."),
        );
    }
    let mut spine_paths = Vec::new();
    let mut seen_spine = HashSet::new();
    for idref in &package.spine {
        if !valid_xml_id(idref) {
            error(
                report,
                "EPUB_SPINE_IDREF_INVALID",
                "spine itemref의 idref가 유효한 XML ID reference가 아닙니다.",
                None,
                Some(package_path),
                Some("안전한 manifest XML ID를 idref로 사용하세요."),
            );
            continue;
        }
        let Some((item, path)) = manifest_by_id.get(idref.as_str()) else {
            error(
                report,
                "EPUB_SPINE_IDREF_INVALID",
                "spine itemref가 manifest item을 가리키지 않습니다.",
                None,
                Some(package_path),
                Some("유효한 manifest id를 idref로 사용하세요."),
            );
            continue;
        };
        if item.media_type != "application/xhtml+xml" || !seen_spine.insert(idref.clone()) {
            error(
                report,
                "EPUB_SPINE_ITEM_INVALID",
                "spine content item이 XHTML이 아니거나 중복되었습니다.",
                None,
                Some(path),
                Some("고유한 XHTML content document만 spine에 배치하세요."),
            );
        }
        spine_paths.push(path.clone());
    }
    if spine_paths.is_empty() {
        error(
            report,
            "EPUB_SPINE_EMPTY",
            "spine reading order가 비어 있습니다.",
            None,
            Some(package_path),
            Some("최소 하나의 XHTML content document를 추가하세요."),
        );
    }
    if let Some(expectation) = expectation {
        if !expectation.content_paths.is_empty() && spine_paths != expectation.content_paths {
            error(
                report,
                "EPUB_SPINE_SOURCE_ORDER",
                "spine 순서가 Publication IR의 Binder 순서와 일치하지 않습니다.",
                None,
                Some(package_path),
                Some("content documents를 source tree 순서로 배치하세요."),
            );
        }
        if let Some((expected_path, expected_media_type)) = &expectation.cover {
            let cover_items: Vec<_> = package
                .manifest
                .iter()
                .filter(|item| item.properties.contains("cover-image"))
                .collect();
            if cover_items.len() != 1
                || resolve_internal_path(package_path, &cover_items[0].href).as_deref()
                    != Some(expected_path)
                || cover_items[0].media_type != expected_media_type.media_type()
            {
                error(
                    report,
                    "EPUB_COVER_MANIFEST",
                    "cover asset이 manifest에 정확히 등록되지 않았습니다.",
                    None,
                    Some(expected_path),
                    Some("cover-image property와 media type을 확인하세요."),
                );
            }
        }
    }
}

fn parse_xhtml(
    bytes: &[u8],
    path: &str,
    is_nav: bool,
    expected_language: &str,
    report: &mut EpubValidationReport,
) -> Option<XhtmlData> {
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut data = XhtmlData {
        structure_valid: true,
        ..XhtmlData::default()
    };
    let mut element_stack: Vec<Option<String>> = Vec::new();
    let mut name_stack: Vec<String> = Vec::new();
    let mut rt_depth = 0_u32;
    let mut saw_html = false;
    if !xml_attributes_are_unique(bytes) {
        error(
            report,
            "EPUB_XML_ATTRIBUTE_INVALID",
            "XHTML에 중복되거나 잘못된 attribute가 있습니다.",
            None,
            Some(path),
            Some("XML attribute를 고유하게 만드세요."),
        );
    }
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) => {
                let raw_name = String::from_utf8_lossy(event.name().as_ref()).into_owned();
                let name = raw_name.to_ascii_lowercase();
                let attrs = attributes(&reader, &event);
                inspect_xhtml_element(
                    &raw_name,
                    &name,
                    &attrs,
                    name_stack.last().map(String::as_str),
                    &name_stack,
                    false,
                    &mut data,
                );
                validate_xhtml_element(&name, &attrs, path, is_nav, &mut data, report);
                if name == "html" {
                    saw_html = attrs.get("xmlns").map(String::as_str)
                        == Some("http://www.w3.org/1999/xhtml");
                    data.epub_namespace_present = attrs.get("xmlns:epub").map(String::as_str)
                        == Some("http://www.idpf.org/2007/ops");
                    data.language_present = attrs
                        .get("lang")
                        .zip(attrs.get("xml:lang"))
                        .is_some_and(|(language, xml_language)| {
                            valid_language(language)
                                && valid_language(xml_language)
                                && language.eq_ignore_ascii_case(xml_language)
                                && language.eq_ignore_ascii_case(expected_language)
                        });
                }
                if name == "head" {
                    data.head_present = true;
                }
                if name == "body" {
                    data.body_present = true;
                }
                if name == "rt" {
                    rt_depth += 1;
                }
                let inherited = element_stack.last().cloned().flatten();
                let block = attrs
                    .get("id")
                    .filter(|id| id.starts_with("madi-block-"))
                    .cloned()
                    .or(inherited);
                element_stack.push(block);
                name_stack.push(name);
            }
            Ok(Event::Empty(event)) => {
                let raw_name = String::from_utf8_lossy(event.name().as_ref()).into_owned();
                let name = raw_name.to_ascii_lowercase();
                let attrs = attributes(&reader, &event);
                inspect_xhtml_element(
                    &raw_name,
                    &name,
                    &attrs,
                    name_stack.last().map(String::as_str),
                    &name_stack,
                    true,
                    &mut data,
                );
                validate_xhtml_element(&name, &attrs, path, is_nav, &mut data, report);
            }
            Ok(Event::Text(text)) => {
                if name_stack.last().map(String::as_str) == Some("title") {
                    match text.unescape() {
                        Ok(text) if !text.trim().is_empty() => data.title_has_text = true,
                        Ok(_) => {}
                        Err(_) => error(
                            report,
                            "EPUB_XHTML_TEXT_INVALID",
                            "XHTML title text entity를 decode할 수 없습니다.",
                            None,
                            Some(path),
                            Some("title XML escaping을 확인하세요."),
                        ),
                    }
                }
                if rt_depth == 0 {
                    if let Some(Some(block_id)) = element_stack.last() {
                        if data.heading_ids.contains(block_id) {
                            buffer.clear();
                            continue;
                        }
                        match text.unescape() {
                            Ok(text) => {
                                *data.block_characters.entry(block_id.clone()).or_default() +=
                                    text.chars().count() as u64;
                            }
                            Err(_) => error(
                                report,
                                "EPUB_XHTML_TEXT_INVALID",
                                "XHTML text entity를 decode할 수 없습니다.",
                                None,
                                Some(path),
                                Some("XML escaping을 확인하세요."),
                            ),
                        }
                    }
                }
            }
            Ok(Event::End(event)) => {
                let name = String::from_utf8_lossy(event.name().as_ref()).to_ascii_lowercase();
                if name == "rt" {
                    rt_depth = rt_depth.saturating_sub(1);
                }
                element_stack.pop();
                if name_stack.pop().as_deref() != Some(name.as_str()) {
                    data.structure_valid = false;
                }
            }
            Ok(Event::DocType(doctype)) => {
                if String::from_utf8_lossy(doctype.as_ref()).trim() != "html" {
                    error(
                        report,
                        "EPUB_XHTML_DOCTYPE_EXTERNAL",
                        "XHTML DOCTYPE에 외부 identifier 또는 지원하지 않는 값이 있습니다.",
                        None,
                        Some(path),
                        Some("단순 <!DOCTYPE html>만 사용하세요."),
                    );
                }
            }
            Ok(Event::PI(_)) => {
                error(
                    report,
                    "EPUB_XML_PROCESSING_INSTRUCTION",
                    "XHTML에 외부 resource를 참조할 수 있는 processing instruction이 있습니다.",
                    None,
                    Some(path),
                    Some("xml-stylesheet 등 모든 processing instruction을 제거하세요."),
                );
            }
            Ok(Event::Eof) => break,
            Err(_) => {
                fatal(
                    report,
                    "EPUB_XHTML_XML_INVALID",
                    "XHTML content document가 well-formed XML이 아닙니다.",
                    None,
                    Some(path),
                    Some("XHTML을 다시 생성하세요."),
                );
                return None;
            }
            _ => {}
        }
        buffer.clear();
    }
    if !saw_html || !data.language_present {
        error(
            report,
            "EPUB_XHTML_LANGUAGE",
            "XHTML html element 또는 language attribute가 없습니다.",
            None,
            Some(path),
            Some("html에 lang과 xml:lang을 지정하세요."),
        );
    }
    if !name_stack.is_empty()
        || !element_stack.is_empty()
        || !data.structure_valid
        || data.html_count != 1
        || data.head_count != 1
        || data.title_count != 1
        || data.body_count != 1
        || data.html_child_phase != 2
        || !data.title_has_text
        || !data.head_present
        || !data.body_present
    {
        error(
            report,
            "EPUB_XHTML_STRUCTURE",
            "XHTML document의 html/head/title/body namespace, 부모 구조 또는 단일성이 유효하지 않습니다.",
            None,
            Some(path),
            Some(
                "html 아래에 비어 있지 않은 title을 둔 head와 body를 순서대로 각각 하나만 포함하세요.",
            ),
        );
    }
    if !data.stylesheet_present {
        error(
            report,
            "EPUB_XHTML_STYLESHEET",
            "XHTML이 package 내부 stylesheet를 참조하지 않습니다.",
            None,
            Some(path),
            Some("styles/book.css 상대경로 link를 추가하세요."),
        );
    }
    if is_nav && !data.toc_nav_present {
        error(
            report,
            "EPUB_NAV_TOC_MISSING",
            "navigation document에 toc nav가 없습니다.",
            None,
            Some(path),
            Some("epub:type=toc인 nav를 추가하세요."),
        );
    }
    if is_nav && !data.links.iter().any(|link| link.is_nav) {
        error(
            report,
            "EPUB_NAV_EMPTY",
            "navigation document의 toc에 이동 가능한 link가 없습니다.",
            None,
            Some(path),
            Some("최소 하나의 내부 content link를 toc에 추가하세요."),
        );
    }
    if is_nav && !data.epub_namespace_present {
        error(
            report,
            "EPUB_NAV_NAMESPACE",
            "navigation document에 EPUB structural semantics namespace가 없습니다.",
            None,
            Some(path),
            Some("xmlns:epub을 올바르게 지정하세요."),
        );
    }
    Some(data)
}

fn inspect_xhtml_element(
    raw_name: &str,
    name: &str,
    attrs: &BTreeMap<String, String>,
    parent: Option<&str>,
    ancestors: &[String],
    is_empty: bool,
    data: &mut XhtmlData,
) {
    let unprefixed_lowercase = raw_name == name && !raw_name.contains(':');
    let valid = unprefixed_lowercase
        && match name {
            "html" => {
                data.html_count += 1;
                parent.is_none()
                    && !is_empty
                    && data.html_count == 1
                    && attrs.get("xmlns").map(String::as_str)
                        == Some("http://www.w3.org/1999/xhtml")
            }
            "head" => {
                data.head_count += 1;
                let valid = parent == Some("html")
                    && !is_empty
                    && data.head_count == 1
                    && data.html_child_phase == 0;
                if valid {
                    data.html_child_phase = 1;
                }
                valid
            }
            "title" => {
                data.title_count += 1;
                parent == Some("head") && !is_empty && data.title_count == 1
            }
            "meta" | "link" => parent == Some("head") && is_empty,
            "body" => {
                data.body_count += 1;
                let valid = parent == Some("html")
                    && !is_empty
                    && data.body_count == 1
                    && data.html_child_phase == 1;
                if valid {
                    data.html_child_phase = 2;
                }
                valid
            }
            _ => ancestors.iter().any(|ancestor| ancestor == "body"),
        };
    data.structure_valid &= valid;
}

fn validate_xhtml_element(
    name: &str,
    attrs: &BTreeMap<String, String>,
    path: &str,
    is_nav: bool,
    data: &mut XhtmlData,
    report: &mut EpubValidationReport,
) {
    const ALLOWED_ELEMENTS: &[&str] = &[
        "html",
        "head",
        "meta",
        "title",
        "link",
        "body",
        "nav",
        "h1",
        "h2",
        "h3",
        "h4",
        "ol",
        "li",
        "a",
        "section",
        "p",
        "strong",
        "em",
        "span",
        "s",
        "ruby",
        "rt",
        "blockquote",
        "hr",
    ];
    if !ALLOWED_ELEMENTS.contains(&name) {
        error(
            report,
            "EPUB_XHTML_ACTIVE_CONTENT",
            "XHTML에 Madi reflowable subset 밖의 element가 포함되어 있습니다.",
            None,
            Some(path),
            Some("Madi가 생성하는 정적 XHTML element만 사용하세요."),
        );
    }
    for key in attrs.keys() {
        if !xhtml_attribute_is_allowed(name, key, is_nav) {
            error(
                report,
                "EPUB_XHTML_ATTRIBUTE_UNSAFE",
                "XHTML에 Madi reflowable subset 밖의 attribute가 포함되어 있습니다.",
                None,
                Some(path),
                Some("inline style, event, navigation 및 remote-fetch attribute를 제거하세요."),
            );
        }
    }
    if attrs
        .get("class")
        .is_some_and(|value| !xhtml_class_is_allowed(name, value))
    {
        error(
            report,
            "EPUB_XHTML_CLASS_UNSAFE",
            "XHTML class가 선택된 Madi stylesheet의 안전한 semantic subset 밖입니다.",
            None,
            Some(path),
            Some("Madi가 생성한 element별 class token만 유지하세요."),
        );
    }
    if name == "meta"
        && attrs
            .get("charset")
            .is_none_or(|value| !value.eq_ignore_ascii_case("utf-8"))
    {
        error(
            report,
            "EPUB_XHTML_CHARSET",
            "XHTML meta charset이 UTF-8이 아닙니다.",
            None,
            Some(path),
            Some("meta charset을 UTF-8로 지정하세요."),
        );
    }
    if let Some(id) = attrs.get("id") {
        if !valid_xml_id(id) || !data.ids.insert(id.clone()) {
            error(
                report,
                "EPUB_XHTML_ID_DUPLICATE",
                "XHTML id가 비어 있거나 document 안에서 중복되었습니다.",
                None,
                Some(path),
                Some("각 XHTML id를 고유하게 만드세요."),
            );
        }
        if id.starts_with("madi-block-") {
            data.block_characters.entry(id.clone()).or_default();
            let classes: BTreeSet<_> = attrs
                .get("class")
                .map(|value| value.split_whitespace().collect())
                .unwrap_or_default();
            if classes.contains("unsupported-fallback") {
                data.fallback_ids.insert(id.clone());
            }
            if classes.contains("source-anchor") || matches!(name, "h1" | "h2" | "h3" | "h4") {
                data.heading_ids.insert(id.clone());
            }
            if name == "hr" && classes.contains("scene-break") {
                data.scene_break_ids.insert(id.clone());
            }
        }
        if name == "section" && id.starts_with("madi-section-") {
            data.section_ids.insert(id.clone());
        }
    }
    if name == "ruby" {
        data.ruby_count += 1;
    }
    if name == "link"
        && attrs
            .get("rel")
            .is_some_and(|rel| rel.split_whitespace().any(|token| token == "stylesheet"))
    {
        if let Some(href) = attrs.get("href") {
            if resolve_internal_path(path, href).as_deref() == Some(EPUB_STYLESHEET_PATH) {
                data.stylesheet_present = true;
            }
        }
    }
    if name == "nav"
        && is_nav
        && attrs
            .get("epub:type")
            .is_some_and(|types| types.split_whitespace().any(|token| token == "toc"))
    {
        data.toc_nav_present = true;
    }
    for attribute_name in ["href", "src", "xlink:href"] {
        if let Some(href) = attrs.get(attribute_name) {
            if remote_or_active_url(href) {
                error(
                    report,
                    "EPUB_XHTML_REMOTE_RESOURCE",
                    "XHTML에 remote, file 또는 active resource URL이 있습니다.",
                    None,
                    Some(path),
                    Some("EPUB 내부 상대경로만 사용하세요."),
                );
            } else if attribute_name == "href" {
                data.links.push(LinkReference {
                    source_path: path.to_owned(),
                    href: href.clone(),
                    is_nav: is_nav && name == "a",
                });
            }
        }
    }
}

fn xhtml_attribute_is_allowed(element: &str, attribute: &str, is_nav: bool) -> bool {
    match element {
        "html" => {
            matches!(attribute, "xmlns" | "xml:lang" | "lang")
                || (is_nav && attribute == "xmlns:epub")
        }
        "meta" => attribute == "charset",
        "link" => matches!(attribute, "rel" | "type" | "href"),
        "nav" => is_nav && matches!(attribute, "epub:type" | "id"),
        "h1" | "h2" | "h3" | "h4" | "blockquote" => attribute == "id",
        "section" => matches!(attribute, "id" | "class"),
        "a" => attribute == "href",
        "p" | "span" => matches!(attribute, "id" | "class"),
        "hr" => matches!(attribute, "id" | "class" | "aria-label"),
        "head" | "title" | "body" | "ol" | "li" | "strong" | "em" | "s" | "ruby" | "rt" => false,
        _ => false,
    }
}

fn xhtml_class_is_allowed(element: &str, value: &str) -> bool {
    matches!(
        (element, value),
        ("section", "scene")
            | ("p", "unsupported-fallback")
            | ("span", "underline")
            | ("span", "source-anchor")
            | ("hr", "scene-break")
    )
}

fn validate_links(
    documents: &BTreeMap<String, XhtmlData>,
    entries: &BTreeMap<String, ArchiveEntry>,
    report: &mut EpubValidationReport,
) {
    for document in documents.values() {
        for link in &document.links {
            let (resource, fragment) = split_fragment(&link.href);
            let target_path = if resource.is_empty() {
                Some(link.source_path.clone())
            } else {
                resolve_internal_path(&link.source_path, resource)
            };
            let Some(target_path) = target_path else {
                error(
                    report,
                    "EPUB_LINK_PATH_UNSAFE",
                    "XHTML link가 EPUB container 밖으로 이동합니다.",
                    None,
                    Some(&link.source_path),
                    Some("안전한 내부 상대경로를 사용하세요."),
                );
                continue;
            };
            if !entries.contains_key(&target_path) {
                error(
                    report,
                    "EPUB_LINK_TARGET_MISSING",
                    "XHTML link가 존재하지 않는 파일을 가리킵니다.",
                    None,
                    Some(&target_path),
                    Some("link target을 package에 포함하세요."),
                );
                continue;
            }
            if let Some(fragment) = fragment {
                if fragment.is_empty()
                    || documents
                        .get(&target_path)
                        .is_none_or(|document| !document.ids.contains(fragment))
                {
                    error(
                        report,
                        "EPUB_LINK_FRAGMENT_MISSING",
                        "XHTML link fragment가 target document에 없습니다.",
                        None,
                        Some(&target_path),
                        Some("실제 XHTML id를 fragment로 사용하세요."),
                    );
                }
            } else if link.is_nav {
                error(
                    report,
                    "EPUB_NAV_FRAGMENT_REQUIRED",
                    "Madi navigation link에는 안정적인 source fragment가 필요합니다.",
                    None,
                    Some(&link.source_path),
                    Some("content document의 안정적인 id를 link하세요."),
                );
            }
        }
    }
}

fn validate_manifest_completeness(
    entries: &BTreeMap<String, ArchiveEntry>,
    package_path: &str,
    package: &PackageData,
    report: &mut EpubValidationReport,
) {
    let manifest_paths: BTreeSet<_> = package
        .manifest
        .iter()
        .filter_map(|item| resolve_internal_path(package_path, &item.href))
        .collect();
    for path in entries.keys() {
        if matches!(
            path.as_str(),
            "mimetype" | EPUB_CONTAINER_PATH | EPUB_PACKAGE_PATH
        ) {
            continue;
        }
        if !manifest_paths.contains(path) {
            error(
                report,
                "EPUB_ORPHAN_RESOURCE",
                "EPUB publication resource가 manifest에 등록되지 않았습니다.",
                None,
                Some(path),
                Some("resource를 manifest에 등록하거나 package에서 제거하세요."),
            );
        }
    }
}

fn validate_stylesheets_and_assets(
    package: &PackageData,
    package_path: &str,
    entries: &BTreeMap<String, ArchiveEntry>,
    expectation: Option<&EpubValidationExpectation>,
    report: &mut EpubValidationReport,
) {
    let mut stylesheet_count = 0_u64;
    let mut cover_count = 0_u64;
    for item in &package.manifest {
        let Some(path) = resolve_internal_path(package_path, &item.href) else {
            continue;
        };
        if item.media_type == "text/css" {
            stylesheet_count += 1;
            let valid = entries.get(&path).is_some_and(|entry| {
                std::str::from_utf8(&entry.bytes).is_ok_and(|stylesheet| {
                    stylesheet_is_allowed(stylesheet)
                        && expectation
                            .and_then(|expectation| expectation.expected_stylesheet.as_deref())
                            .is_none_or(|expected| stylesheet == expected)
                })
            });
            if path != EPUB_STYLESHEET_PATH || !valid {
                error(
                    report,
                    "EPUB_STYLESHEET_UNSAFE",
                    "stylesheet이 Madi의 안전한 reflowable CSS subset을 벗어났습니다.",
                    None,
                    Some(&path),
                    Some("내장 stylesheet token으로 다시 생성하세요."),
                );
            }
        }
        if matches!(item.media_type.as_str(), "image/png" | "image/jpeg") {
            if !item.properties.contains("cover-image") {
                error(
                    report,
                    "EPUB_IMAGE_UNSUPPORTED",
                    "v1 EPUB package에는 cover가 아닌 image asset을 포함할 수 없습니다.",
                    None,
                    Some(&path),
                    Some("지원하지 않는 image asset을 제거하세요."),
                );
                continue;
            }
            cover_count += 1;
            let media_type = match item.media_type.as_str() {
                "image/png" => EpubCoverMediaType::Png,
                "image/jpeg" => EpubCoverMediaType::Jpeg,
                _ => unreachable!(),
            };
            if entries
                .get(&path)
                .is_none_or(|entry| validate_cover_resource(media_type, &entry.bytes).is_err())
            {
                error(
                    report,
                    "EPUB_COVER_BYTES_INVALID",
                    "cover asset의 media type, magic bytes, 구조 또는 dimension이 유효하지 않습니다.",
                    None,
                    Some(&path),
                    Some("유효한 PNG 또는 JPEG cover를 다시 선택하세요."),
                );
            }
        }
    }
    if stylesheet_count != 1 {
        error(
            report,
            "EPUB_STYLESHEET_COUNT",
            "Madi EPUB에는 안전한 stylesheet가 정확히 하나 있어야 합니다.",
            None,
            Some(package_path),
            Some("styles/book.css manifest item을 하나만 유지하세요."),
        );
    }
    if cover_count > 1 {
        error(
            report,
            "EPUB_COVER_COUNT",
            "cover-image asset은 최대 하나만 허용됩니다.",
            None,
            Some(package_path),
            Some("cover image를 하나만 유지하세요."),
        );
    }
}

fn validate_coverage(
    expectation: &EpubValidationExpectation,
    package: &PackageData,
    documents: &BTreeMap<String, XhtmlData>,
    report: &mut EpubValidationReport,
) {
    let observed_cover_count = package
        .manifest
        .iter()
        .filter(|item| item.properties.contains("cover-image"))
        .count();
    if expectation.cover_expected != (observed_cover_count == 1) {
        error(
            report,
            "EPUB_COVER_SELECTION_MISMATCH",
            "cover 포함 여부가 export options와 일치하지 않습니다.",
            None,
            Some(EPUB_PACKAGE_PATH),
            Some("includeCover 설정과 cover-image manifest item을 일치시키세요."),
        );
    }
    let mut observed_blocks = BTreeMap::new();
    let mut observed_fallbacks = BTreeSet::new();
    let mut observed_headings = BTreeSet::new();
    let mut observed_breaks = BTreeSet::new();
    let mut observed_sections = BTreeSet::new();
    let mut observed_ruby = 0_u64;
    for document in documents.values() {
        for (id, characters) in &document.block_characters {
            if observed_blocks.insert(id.clone(), *characters).is_some() {
                error(
                    report,
                    "EPUB_SOURCE_ID_DUPLICATE",
                    "source block export ID가 여러 content document에 중복되었습니다.",
                    None,
                    None,
                    Some("각 Publication IR block을 한 번만 내보내세요."),
                );
            }
        }
        observed_fallbacks.extend(document.fallback_ids.iter().cloned());
        observed_headings.extend(document.heading_ids.iter().cloned());
        observed_breaks.extend(document.scene_break_ids.iter().cloned());
        observed_sections.extend(document.section_ids.iter().cloned());
        observed_ruby += document.ruby_count;
    }
    for (id, expected) in &expectation.blocks {
        let Some(actual_characters) = observed_blocks.get(id) else {
            error(
                report,
                "EPUB_SOURCE_BLOCK_MISSING",
                "Publication IR block이 EPUB content에 없습니다.",
                Some(&expected.source_node_id),
                expected.epub_path.as_deref(),
                Some("block mapping과 content split을 확인하세요."),
            );
            continue;
        };
        if *actual_characters != expected.character_count {
            error(
                report,
                "EPUB_SOURCE_CHARACTER_LOSS",
                "Publication IR block의 본문 문자 수가 EPUB과 일치하지 않습니다.",
                Some(&expected.source_node_id),
                expected.epub_path.as_deref(),
                Some("XML escaping과 inline mapping을 확인하세요."),
            );
        }
        if expected.fallback != observed_fallbacks.contains(id) {
            error(
                report,
                "EPUB_FALLBACK_COVERAGE",
                "unsupported block의 fallback 표시가 생성 계획과 다릅니다.",
                Some(&expected.source_node_id),
                expected.epub_path.as_deref(),
                Some("unsupported block을 명시적인 plain-text fallback으로 처리하세요."),
            );
        }
    }
    for id in observed_blocks.keys() {
        if !expectation.blocks.contains_key(id) {
            error(
                report,
                "EPUB_SOURCE_BLOCK_UNEXPECTED",
                "Publication IR에 없는 source block export ID가 있습니다.",
                None,
                None,
                Some("stale content document를 package에서 제거하세요."),
            );
        }
    }
    let exported_characters: u64 = observed_blocks.values().sum();
    if expectation.source_block_count != expectation.blocks.len() as u64
        || expectation.source_block_count != observed_blocks.len() as u64
        || expectation.source_character_count != exported_characters
        || expectation.exported_section_count != observed_sections.len() as u64
        || expectation.source_section_count != expectation.exported_section_count
        || expectation.scene_break_ids != observed_breaks
        || expectation.scene_break_count != observed_breaks.len() as u64
        || expectation.heading_ids != observed_headings
        || expectation.heading_count != observed_headings.len() as u64
        || expectation.ruby_count != observed_ruby
    {
        error(
            report,
            "EPUB_PUBLICATION_COMPLETENESS",
            "section, block, character, heading, scene break 또는 ruby coverage가 완전하지 않습니다.",
            None,
            None,
            Some("Publication IR completeness 지표와 XHTML mapping을 확인하세요."),
        );
    }
    if !expectation.toc_targets.is_empty() {
        let nav_targets: Vec<_> = documents
            .get(EPUB_NAV_PATH)
            .into_iter()
            .flat_map(|document| document.links.iter())
            .filter(|link| link.is_nav)
            .map(|link| link.href.clone())
            .collect();
        if nav_targets != expectation.toc_targets {
            error(
                report,
                "EPUB_NAV_SOURCE_ORDER",
                "navigation 목차 순서가 Publication IR의 논리 순서와 일치하지 않습니다.",
                None,
                Some(EPUB_NAV_PATH),
                Some("Binder/heading 순서로 nav link를 생성하세요."),
            );
        }
    }
    let manifest_ids: HashSet<_> = package
        .manifest
        .iter()
        .map(|item| item.id.as_str())
        .collect();
    if manifest_ids.len() != package.manifest.len() {
        error(
            report,
            "EPUB_MANIFEST_ID_COVERAGE",
            "manifest ID completeness 검사가 실패했습니다.",
            None,
            Some(EPUB_PACKAGE_PATH),
            Some("manifest id를 고유하게 유지하세요."),
        );
    }
}

fn attributes(reader: &Reader<&[u8]>, event: &BytesStart<'_>) -> BTreeMap<String, String> {
    event
        .attributes()
        .with_checks(true)
        .filter_map(|attribute| attribute.ok())
        .map(|attribute| {
            let key = String::from_utf8_lossy(attribute.key.as_ref()).into_owned();
            let value = attribute
                .decode_and_unescape_value(reader.decoder())
                .map(|value| value.into_owned())
                .unwrap_or_default();
            (key, value)
        })
        .collect()
}

fn xml_attributes_are_unique(bytes: &[u8]) -> bool {
    let mut reader = Reader::from_reader(bytes);
    let mut buffer = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) | Ok(Event::Empty(event)) => {
                if event
                    .attributes()
                    .with_checks(true)
                    .any(|attribute| attribute.is_err())
                {
                    return false;
                }
            }
            Ok(Event::Eof) => return true,
            Err(_) => return false,
            _ => {}
        }
        buffer.clear();
    }
}

fn local_name(name: &[u8]) -> &[u8] {
    name.rsplit(|byte| *byte == b':').next().unwrap_or(name)
}

fn resolve_internal_path(base_path: &str, reference: &str) -> Option<String> {
    let resource = split_fragment(reference).0;
    if resource.is_empty() || remote_or_active_url(resource) || resource.contains('\\') {
        return None;
    }
    let mut components: Vec<&str> = base_path.split('/').collect();
    components.pop();
    for component in resource.split('/') {
        match component {
            "" | "." => return None,
            ".." => {
                components.pop()?;
            }
            component if component.contains(':') || component.contains('\0') => return None,
            component => components.push(component),
        }
    }
    if components.is_empty() {
        None
    } else {
        Some(components.join("/"))
    }
}

fn split_fragment(reference: &str) -> (&str, Option<&str>) {
    match reference.split_once('#') {
        Some((resource, fragment)) => (resource, Some(fragment)),
        None => (reference, None),
    }
}

fn remote_or_active_url(value: &str) -> bool {
    let lower = value.trim().to_ascii_lowercase();
    let first_boundary = ['/', '?', '#']
        .into_iter()
        .filter_map(|separator| lower.find(separator))
        .min()
        .unwrap_or(lower.len());
    lower.starts_with("//")
        || lower
            .find(':')
            .is_some_and(|colon_index| colon_index < first_boundary)
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

fn media_type_matches_path(media_type: &str, path: &str) -> bool {
    if path.ends_with(".xhtml") {
        media_type == "application/xhtml+xml"
    } else if path.ends_with(".css") {
        media_type == "text/css"
    } else if path.ends_with(".png") {
        media_type == "image/png"
    } else if path.ends_with(".jpg") || path.ends_with(".jpeg") {
        media_type == "image/jpeg"
    } else {
        false
    }
}

fn valid_modified(value: &str) -> bool {
    let bytes = value.as_bytes();
    if !(bytes.len() == 20
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[10] == b'T'
        && bytes[13] == b':'
        && bytes[16] == b':'
        && bytes[19] == b'Z'
        && bytes.iter().enumerate().all(|(index, byte)| {
            matches!(index, 4 | 7 | 10 | 13 | 16 | 19) || byte.is_ascii_digit()
        }))
    {
        return false;
    }
    let number = |start: usize, end: usize| {
        std::str::from_utf8(&bytes[start..end])
            .ok()
            .and_then(|value| value.parse::<u32>().ok())
    };
    let (Some(year), Some(month), Some(day), Some(hour), Some(minute), Some(second)) = (
        number(0, 4),
        number(5, 7),
        number(8, 10),
        number(11, 13),
        number(14, 16),
        number(17, 19),
    ) else {
        return false;
    };
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    year > 0 && (1..=max_day).contains(&day) && hour < 24 && minute < 60 && second < 60
}

fn valid_xml_id(value: &str) -> bool {
    let mut bytes = value.bytes();
    bytes
        .next()
        .is_some_and(|byte| byte.is_ascii_alphabetic() || byte == b'_')
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
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

fn count_ruby(inlines: &[PublicationInline]) -> u64 {
    inlines
        .iter()
        .map(|inline| match inline {
            PublicationInline::Text { .. } => 0,
            PublicationInline::Strong { children }
            | PublicationInline::Emphasis { children }
            | PublicationInline::Underline { children }
            | PublicationInline::Strike { children } => count_ruby(children),
            PublicationInline::Ruby { children, .. } => 1 + count_ruby(children),
        })
        .sum()
}

fn push_message(
    report: &mut EpubValidationReport,
    code: &str,
    severity: EpubValidationSeverity,
    description: &str,
    source_node_id: Option<&str>,
    epub_path: Option<&str>,
    suggestion: Option<&str>,
) {
    if report.messages.len() >= MAX_VALIDATION_MESSAGES {
        return;
    }
    report.push(EpubValidationMessage {
        code: code.to_owned(),
        severity,
        description: description.to_owned(),
        source_node_id: source_node_id.map(str::to_owned),
        epub_path: epub_path.map(str::to_owned),
        suggestion: suggestion.map(str::to_owned),
    });
}

fn fatal(
    report: &mut EpubValidationReport,
    code: &str,
    description: &str,
    source_node_id: Option<&str>,
    epub_path: Option<&str>,
    suggestion: Option<&str>,
) {
    push_message(
        report,
        code,
        EpubValidationSeverity::Fatal,
        description,
        source_node_id,
        epub_path,
        suggestion,
    );
}

fn error(
    report: &mut EpubValidationReport,
    code: &str,
    description: &str,
    source_node_id: Option<&str>,
    epub_path: Option<&str>,
    suggestion: Option<&str>,
) {
    push_message(
        report,
        code,
        EpubValidationSeverity::Error,
        description,
        source_node_id,
        epub_path,
        suggestion,
    );
}
