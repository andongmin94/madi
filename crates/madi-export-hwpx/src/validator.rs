use std::collections::{BTreeMap, BTreeSet};
use std::io::{Cursor, Read};

use madi_publication::{PublicationBlock, PublicationDocument, PublicationInline};
use quick_xml::Reader;
use quick_xml::events::{BytesStart, Event};
use zip::{CompressionMethod, ZipArchive};

use crate::model::{
    HwpxExportOptions, HwpxSceneBreakToken, HwpxSectionSplitMode, HwpxValidationMessage,
    HwpxValidationReport, HwpxValidationSeverity,
};
use crate::{
    HWPX_CONTAINER_PATH, HWPX_CONTENT_PATH, HWPX_HEADER_PATH, HWPX_MANIFEST_PATH, HWPX_MIMETYPE,
    HWPX_RDF_PATH, HWPX_SECTION_PATH, HWPX_SETTINGS_PATH, HWPX_VERSION_PATH, HWPX_XML_VERSION,
};

const MAX_ARCHIVE_ENTRIES: usize = 30_000;
const MAX_ENTRY_BYTES: u64 = 128 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
const MAX_VALIDATION_MESSAGES: usize = 1_000;
const REQUIRED_ENTRIES: [&str; 9] = [
    "mimetype",
    HWPX_VERSION_PATH,
    HWPX_HEADER_PATH,
    HWPX_SECTION_PATH,
    HWPX_SETTINGS_PATH,
    HWPX_RDF_PATH,
    HWPX_CONTENT_PATH,
    HWPX_CONTAINER_PATH,
    HWPX_MANIFEST_PATH,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ExpectedDisposition {
    Exported,
    Fallback,
    ConfiguredOmission,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ExpectedRun {
    pub char_pr_id: u32,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ExpectedParagraph {
    pub id: u32,
    pub para_pr_id: u32,
    pub style_id: u32,
    pub runs: Vec<ExpectedRun>,
}

#[derive(Debug, Clone)]
pub(crate) struct ExpectedBlock {
    pub section_index: usize,
    pub source_node_id: String,
    pub block_id: String,
    pub source_character_count: u64,
    pub paragraph: Option<ExpectedParagraph>,
    pub disposition: ExpectedDisposition,
    pub is_heading: bool,
    pub is_scene_break: bool,
    pub ruby_fallback_count: u64,
}

#[derive(Debug, Clone)]
pub(crate) struct HwpxValidationExpectation {
    pub expected_file_count: u64,
    pub expected_section_count: u64,
    pub blocks: BTreeMap<String, ExpectedBlock>,
    pub source_block_count: u64,
    pub exported_block_count: u64,
    pub fallback_block_count: u64,
    pub configured_omission_block_count: u64,
    pub rejected_block_count: u64,
    pub source_character_count: u64,
    pub exported_character_count: u64,
    pub paragraph_count: u64,
    pub run_count: u64,
    pub text_count: u64,
    pub heading_count: u64,
    pub scene_break_count: u64,
    pub ruby_count: u64,
    pub ruby_fallback_count: u64,
    pub strong_segment_count: u64,
    pub emphasis_segment_count: u64,
    pub underline_segment_count: u64,
    pub strike_segment_count: u64,
    pub page_width: u32,
    pub page_height: u32,
    pub margin_top: u32,
    pub margin_bottom: u32,
    pub margin_left: u32,
    pub margin_right: u32,
    pub margin_header: u32,
    pub margin_footer: u32,
    pub margin_gutter: u32,
    pub page_number_start: u32,
    pub page_number_position: Option<String>,
    pub header_text: Option<String>,
    pub footer_text: Option<String>,
}

#[derive(Debug, Clone)]
struct ArchiveEntry {
    bytes: Vec<u8>,
    compression: CompressionMethod,
    index: usize,
}

#[derive(Debug, Clone, Default)]
struct CharProperty {
    font_refs: Vec<u32>,
    border_ref: u32,
    bold: bool,
    italic: bool,
    underline: bool,
    strike: bool,
}

#[derive(Debug, Clone, Default)]
struct HeaderData {
    valid_root: bool,
    sec_count: u32,
    begin_page: u32,
    fontface_count: u32,
    font_ids: BTreeSet<u32>,
    border_ids: BTreeSet<u32>,
    tab_ids: BTreeSet<u32>,
    char_properties: BTreeMap<u32, CharProperty>,
    para_properties: BTreeMap<u32, (u32, u32)>,
    styles: BTreeMap<u32, (u32, u32, u32)>,
    declared_font_count: Option<u32>,
    declared_border_count: Option<u32>,
    declared_char_count: Option<u32>,
    declared_tab_count: Option<u32>,
    declared_para_count: Option<u32>,
    declared_style_count: Option<u32>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct ParsedRun {
    char_pr_id: u32,
    text: String,
}

#[derive(Debug, Clone, Default)]
struct ParsedParagraph {
    id: u32,
    para_pr_id: u32,
    style_id: u32,
    runs: Vec<ParsedRun>,
}

#[derive(Debug, Clone, Default)]
struct SectionData {
    valid_root: bool,
    paragraphs: BTreeMap<u32, ParsedParagraph>,
    paragraph_count: u64,
    run_count: u64,
    text_count: u64,
    duplicate_paragraph_id: bool,
    paragraph_ids: BTreeSet<u32>,
    control_paragraph_id: Option<u32>,
    has_section_definition: bool,
    page_width: Option<u32>,
    page_height: Option<u32>,
    margins: Option<[u32; 7]>,
    start_page: Option<u32>,
    page_number_position: Option<String>,
    header_text: Option<String>,
    footer_text: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct ContentData {
    valid_root: bool,
    manifest_items: BTreeMap<String, (String, String)>,
    spine: Vec<String>,
}

pub fn validate_hwpx_bytes(bytes: &[u8]) -> HwpxValidationReport {
    validate_hwpx_with_expectation(bytes, None)
}

pub fn validate_hwpx_against_publication(
    bytes: &[u8],
    document: &PublicationDocument,
    options: &HwpxExportOptions,
) -> HwpxValidationReport {
    let mut report = validate_hwpx_with_expectation(bytes, None);
    if report.status == crate::model::HwpxValidationStatus::Fail {
        return report;
    }
    let Some(entries) = read_archive(bytes, &mut report) else {
        return report;
    };
    let content = validate_content(&entries, &mut report);
    let sections = load_sections(&content, &entries, &mut report);
    let actual: Vec<_> = sections
        .iter()
        .enumerate()
        .flat_map(|(section_index, section)| {
            section
                .paragraphs
                .values()
                .filter(move |paragraph| {
                    Some(paragraph.id) != section.control_paragraph_id && paragraph.style_id <= 6
                })
                .map(move |paragraph| (section_index, paragraph))
        })
        .collect();
    let mut expected = Vec::new();
    let mut expected_section_index = 0_usize;
    let mut saw_volume_heading = false;
    for section in &document.sections {
        for block in &section.blocks {
            if options.section_split_mode == HwpxSectionSplitMode::Volume
                && matches!(block, PublicationBlock::Heading { level: 2, .. })
            {
                if saw_volume_heading {
                    expected_section_index += 1;
                } else {
                    saw_volume_heading = true;
                }
            }
            let Some((style_id, text, run_masks)) = expected_publication_block(block, options)
            else {
                continue;
            };
            expected.push((
                expected_section_index,
                style_id,
                text,
                run_masks,
                source_node_id(block),
            ));
        }
    }
    let expected_section_count = if options.section_split_mode == HwpxSectionSplitMode::Single {
        1
    } else {
        expected_section_index + 1
    };
    if sections.len() != expected_section_count {
        error(
            &mut report,
            "HWPX_PUBLICATION_SECTION_SPLIT",
            "HWPX physical section boundaries differ from the requested Publication IR split.",
            None,
            Some(HWPX_CONTENT_PATH),
            Some("Export the current Publication IR again."),
        );
    }
    if actual.len() != expected.len() {
        error(
            &mut report,
            "HWPX_PUBLICATION_BLOCK_COUNT",
            "HWPX source paragraph count does not match Publication IR.",
            None,
            Some(HWPX_SECTION_PATH),
            Some("Export the current Publication IR again."),
        );
        return report;
    }
    for (
        (actual_section_index, paragraph),
        (expected_section_index, style_id, text, masks, source_node_id),
    ) in actual.iter().zip(expected)
    {
        let actual_text: String = paragraph.runs.iter().map(|run| run.text.as_str()).collect();
        let actual_masks: Vec<u32> = paragraph.runs.iter().map(|run| run.char_pr_id).collect();
        if *actual_section_index != expected_section_index
            || paragraph.style_id != style_id
            || actual_text != text
            || actual_masks != masks
        {
            error(
                &mut report,
                "HWPX_PUBLICATION_SCALAR_COVERAGE",
                "HWPX text or inline style sequence differs from Publication IR mapping.",
                Some(source_node_id),
                Some(HWPX_SECTION_PATH),
                Some("Export the current Publication IR again."),
            );
        }
    }
    report
}

pub(crate) fn validate_hwpx_with_expectation(
    bytes: &[u8],
    expectation: Option<&HwpxValidationExpectation>,
) -> HwpxValidationReport {
    let mut report = HwpxValidationReport::default();
    let Some(entries) = read_archive(bytes, &mut report) else {
        return report;
    };
    if let Some(expectation) = expectation
        && entries.len() as u64 != expectation.expected_file_count
    {
        error(
            &mut report,
            "HWPX_FILE_COUNT_MISMATCH",
            "HWPX file count differs from the generation plan.",
            None,
            None,
            Some("Export again."),
        );
    }
    validate_required_entries(&entries, &mut report);
    validate_xml_documents(&entries, &mut report);
    validate_version_and_settings(&entries, &mut report);
    validate_container(&entries, &mut report);
    let content = validate_content(&entries, &mut report);
    let header = entries
        .get(HWPX_HEADER_PATH)
        .map(|entry| parse_header(&entry.bytes, &mut report))
        .unwrap_or_default();
    let sections = load_sections(&content, &entries, &mut report);
    validate_header(&header, sections.len(), &mut report);
    for section in &sections {
        validate_section(section, &header, &mut report);
    }
    validate_global_paragraph_ids(&sections, &mut report);
    validate_content_references(&content, &entries, &mut report);
    validate_security(&entries, &mut report);
    if let Some(expectation) = expectation {
        validate_expectation(expectation, &sections, &header, &mut report);
    }
    report
}

pub(crate) fn validate_hwpx_source_coverage(
    bytes: &[u8],
    expectation: &HwpxValidationExpectation,
) -> HwpxValidationReport {
    let mut report = HwpxValidationReport::default();
    let Some(entries) = read_archive(bytes, &mut report) else {
        return report;
    };
    let content = validate_content(&entries, &mut report);
    let header = entries
        .get(HWPX_HEADER_PATH)
        .map(|entry| parse_header(&entry.bytes, &mut report))
        .unwrap_or_default();
    let sections = load_sections(&content, &entries, &mut report);
    validate_expectation(expectation, &sections, &header, &mut report);
    report
}

fn read_archive(
    bytes: &[u8],
    report: &mut HwpxValidationReport,
) -> Option<BTreeMap<String, ArchiveEntry>> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_TOTAL_BYTES {
        fatal(
            report,
            "HWPX_ARCHIVE_SIZE",
            "HWPX archive size is outside the safe limit.",
            None,
            None,
            None,
        );
        return None;
    }
    let mut archive = match ZipArchive::new(Cursor::new(bytes)) {
        Ok(archive) => archive,
        Err(_) => {
            fatal(
                report,
                "HWPX_ZIP_REOPEN",
                "HWPX ZIP cannot be reopened.",
                None,
                None,
                Some("Generate the HWPX package again."),
            );
            return None;
        }
    };
    if archive.len() == 0 || archive.len() > MAX_ARCHIVE_ENTRIES {
        fatal(
            report,
            "HWPX_ENTRY_COUNT",
            "HWPX ZIP entry count is outside the safe limit.",
            None,
            None,
            None,
        );
        return None;
    }
    let mut entries = BTreeMap::new();
    let mut normalized_paths = BTreeSet::new();
    let mut total = 0_u64;
    for index in 0..archive.len() {
        let mut file = match archive.by_index(index) {
            Ok(file) => file,
            Err(_) => {
                fatal(
                    report,
                    "HWPX_ENTRY_READ",
                    "A HWPX ZIP entry cannot be read.",
                    None,
                    None,
                    None,
                );
                return None;
            }
        };
        let path = file.name().to_owned();
        if !safe_package_path(&path) || file.is_dir() {
            fatal(
                report,
                "HWPX_ENTRY_PATH",
                "HWPX contains an unsafe or directory ZIP entry.",
                None,
                Some(&path),
                Some("Use package-relative file entries only."),
            );
            return None;
        }
        if !normalized_paths.insert(path.to_ascii_lowercase()) {
            fatal(
                report,
                "HWPX_CASE_COLLIDING_ENTRY",
                "HWPX contains ZIP entries that collide under case-insensitive paths.",
                None,
                Some(&path),
                None,
            );
            return None;
        }
        if file.size() > MAX_ENTRY_BYTES {
            fatal(
                report,
                "HWPX_ENTRY_SIZE",
                "A HWPX entry exceeds the safe size limit.",
                None,
                Some(&path),
                None,
            );
            return None;
        }
        total = match total.checked_add(file.size()) {
            Some(total) if total <= MAX_TOTAL_BYTES => total,
            _ => {
                fatal(
                    report,
                    "HWPX_UNCOMPRESSED_SIZE",
                    "HWPX uncompressed size exceeds the safe limit.",
                    None,
                    None,
                    None,
                );
                return None;
            }
        };
        let compression = file.compression();
        let mut entry_bytes = Vec::with_capacity(file.size() as usize);
        if file.read_to_end(&mut entry_bytes).is_err() || entry_bytes.len() as u64 != file.size() {
            fatal(
                report,
                "HWPX_ENTRY_TRUNCATED",
                "A HWPX ZIP entry is truncated.",
                None,
                Some(&path),
                None,
            );
            return None;
        }
        if entries
            .insert(
                path.clone(),
                ArchiveEntry {
                    bytes: entry_bytes,
                    compression,
                    index,
                },
            )
            .is_some()
        {
            fatal(
                report,
                "HWPX_DUPLICATE_ENTRY",
                "HWPX contains a duplicate ZIP entry.",
                None,
                Some(&path),
                None,
            );
            return None;
        }
    }
    Some(entries)
}

fn validate_required_entries(
    entries: &BTreeMap<String, ArchiveEntry>,
    report: &mut HwpxValidationReport,
) {
    for path in REQUIRED_ENTRIES {
        if !entries.contains_key(path) {
            fatal(
                report,
                "HWPX_REQUIRED_ENTRY_MISSING",
                "A required HWPX package entry is missing.",
                None,
                Some(path),
                Some("Regenerate the HWPX package."),
            );
        }
    }
    if let Some(mimetype) = entries.get("mimetype") {
        if mimetype.index != 0
            || mimetype.compression != CompressionMethod::Stored
            || mimetype.bytes != HWPX_MIMETYPE
        {
            fatal(
                report,
                "HWPX_MIMETYPE",
                "HWPX mimetype must be the first stored entry with exact bytes.",
                None,
                Some("mimetype"),
                None,
            );
        }
    }
}

fn validate_xml_documents(
    entries: &BTreeMap<String, ArchiveEntry>,
    report: &mut HwpxValidationReport,
) {
    for (path, entry) in entries {
        if path == "mimetype"
            || !(path.ends_with(".xml") || path.ends_with(".hpf") || path.ends_with(".rdf"))
        {
            continue;
        }
        let text_is_valid = std::str::from_utf8(&entry.bytes)
            .is_ok_and(|text| text.chars().all(valid_xml_character));
        let mut reader = Reader::from_reader(entry.bytes.as_slice());
        let mut buffer = Vec::new();
        let mut root_count = 0_u64;
        let mut depth = 0_u64;
        let mut valid = text_is_valid;
        let mut namespace_valid = true;
        loop {
            match reader.read_event_into(&mut buffer) {
                Ok(Event::Start(event)) => {
                    if event
                        .attributes()
                        .with_checks(true)
                        .any(|attribute| attribute.is_err())
                    {
                        valid = false;
                        break;
                    }
                    namespace_valid &=
                        valid_namespace_declarations(path, &reader, &event, depth == 0);
                    if depth == 0 {
                        root_count += 1;
                    }
                    depth += 1;
                }
                Ok(Event::Empty(event)) => {
                    if event
                        .attributes()
                        .with_checks(true)
                        .any(|attribute| attribute.is_err())
                    {
                        valid = false;
                        break;
                    }
                    namespace_valid &=
                        valid_namespace_declarations(path, &reader, &event, depth == 0);
                    if depth == 0 {
                        root_count += 1;
                    }
                }
                Ok(Event::End(_)) => {
                    let Some(next) = depth.checked_sub(1) else {
                        valid = false;
                        break;
                    };
                    depth = next;
                }
                Ok(Event::DocType(_)) | Ok(Event::PI(_)) => {
                    valid = false;
                    break;
                }
                Ok(Event::Eof) => break,
                Err(_) => {
                    valid = false;
                    break;
                }
                _ => {}
            }
            buffer.clear();
        }
        if !valid || root_count != 1 || depth != 0 {
            fatal(
                report,
                "HWPX_XML_WELL_FORMED",
                "A HWPX XML entry is not a single well-formed document.",
                None,
                Some(path),
                Some("Regenerate the HWPX package."),
            );
        }
        if !namespace_valid {
            fatal(
                report,
                "HWPX_NAMESPACE",
                "A HWPX XML entry contains an unexpected or nested namespace declaration.",
                None,
                Some(path),
                Some("Regenerate the HWPX package with the pinned namespace profile."),
            );
        }
    }
}

fn valid_namespace_declarations(
    path: &str,
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
    root: bool,
) -> bool {
    let expected = expected_root_namespaces(path);
    let mut declarations = BTreeMap::new();
    for attribute in event.attributes().with_checks(true).flatten() {
        let key = attribute.key.as_ref();
        let prefix = if key == b"xmlns" {
            Some(String::new())
        } else {
            key.strip_prefix(b"xmlns:")
                .and_then(|value| std::str::from_utf8(value).ok())
                .map(str::to_owned)
        };
        let Some(prefix) = prefix else {
            continue;
        };
        if !root {
            return false;
        }
        let Ok(value) = attribute.decode_and_unescape_value(reader.decoder()) else {
            return false;
        };
        if declarations.insert(prefix, value.into_owned()).is_some() {
            return false;
        }
    }
    if !root {
        return true;
    }
    let Some(expected) = expected else {
        return declarations.is_empty();
    };
    declarations.len() == expected.len()
        && expected
            .iter()
            .all(|(prefix, uri)| declarations.get(*prefix).map(String::as_str) == Some(*uri))
}

fn expected_root_namespaces(path: &str) -> Option<&'static [(&'static str, &'static str)]> {
    const VERSION: &[(&str, &str)] = &[("hv", "http://www.hancom.co.kr/hwpml/2011/version")];
    const SETTINGS: &[(&str, &str)] = &[("ha", "http://www.hancom.co.kr/hwpml/2011/app")];
    const HEADER: &[(&str, &str)] = &[
        ("hh", "http://www.hancom.co.kr/hwpml/2011/head"),
        ("hc", "http://www.hancom.co.kr/hwpml/2011/core"),
    ];
    const SECTION: &[(&str, &str)] = &[
        ("hs", "http://www.hancom.co.kr/hwpml/2011/section"),
        ("hp", "http://www.hancom.co.kr/hwpml/2011/paragraph"),
    ];
    const CONTENT: &[(&str, &str)] = &[("opf", "http://www.idpf.org/2007/opf/")];
    const CONTAINER: &[(&str, &str)] =
        &[("ocf", "urn:oasis:names:tc:opendocument:xmlns:container")];
    const MANIFEST: &[(&str, &str)] =
        &[("odf", "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0")];
    const RDF: &[(&str, &str)] = &[("rdf", "http://www.w3.org/1999/02/22-rdf-syntax-ns#")];
    match path {
        HWPX_VERSION_PATH => Some(VERSION),
        HWPX_SETTINGS_PATH => Some(SETTINGS),
        HWPX_HEADER_PATH => Some(HEADER),
        HWPX_CONTENT_PATH => Some(CONTENT),
        HWPX_CONTAINER_PATH => Some(CONTAINER),
        HWPX_MANIFEST_PATH => Some(MANIFEST),
        HWPX_RDF_PATH => Some(RDF),
        _ if section_path_index(path).is_some() => Some(SECTION),
        _ => None,
    }
}

fn valid_xml_character(character: char) -> bool {
    matches!(character, '\u{9}' | '\u{a}' | '\u{d}')
        || ('\u{20}'..='\u{d7ff}').contains(&character)
        || ('\u{e000}'..='\u{fffd}').contains(&character)
        || ('\u{10000}'..='\u{10ffff}').contains(&character)
}

fn validate_version_and_settings(
    entries: &BTreeMap<String, ArchiveEntry>,
    report: &mut HwpxValidationReport,
) {
    if let Some(entry) = entries.get(HWPX_VERSION_PATH) {
        let roots = collect_elements(&entry.bytes, "hv:HCFVersion");
        if roots.len() != 1
            || roots[0].get("xmlns:hv").map(String::as_str)
                != Some("http://www.hancom.co.kr/hwpml/2011/version")
            || roots[0].get("xmlVersion").map(String::as_str) != Some(HWPX_XML_VERSION)
            || roots[0].get("tagetApplication").map(String::as_str) != Some("WORDPROCESSOR")
            || [
                "major",
                "minor",
                "micro",
                "buildNumber",
                "os",
                "application",
                "appVersion",
            ]
            .iter()
            .any(|name| !roots[0].contains_key(*name))
        {
            error(
                report,
                "HWPX_VERSION_STRUCTURE",
                "version.xml does not match the pinned legacy HWPX version contract.",
                None,
                Some(HWPX_VERSION_PATH),
                None,
            );
        }
    }
    if let Some(entry) = entries.get(HWPX_SETTINGS_PATH) {
        let roots = collect_elements(&entry.bytes, "ha:HWPApplicationSetting");
        let carets = collect_elements(&entry.bytes, "ha:CaretPosition");
        if roots.len() != 1
            || roots[0].get("xmlns:ha").map(String::as_str)
                != Some("http://www.hancom.co.kr/hwpml/2011/app")
            || carets.len() != 1
            || ["listIDRef", "paraIDRef", "pos"]
                .iter()
                .any(|name| parse_u32(carets[0].get(*name)).is_none())
        {
            error(
                report,
                "HWPX_SETTINGS_STRUCTURE",
                "settings.xml does not contain one valid CaretPosition.",
                None,
                Some(HWPX_SETTINGS_PATH),
                None,
            );
        }
    }
}

fn validate_container(entries: &BTreeMap<String, ArchiveEntry>, report: &mut HwpxValidationReport) {
    let Some(entry) = entries.get(HWPX_CONTAINER_PATH) else {
        return;
    };
    let roots = collect_elements(&entry.bytes, "ocf:container");
    let rootfiles = collect_elements(&entry.bytes, "ocf:rootfile");
    let valid_root = roots.len() == 1
        && roots[0].get("xmlns:ocf").map(String::as_str)
            == Some("urn:oasis:names:tc:opendocument:xmlns:container");
    let content_root = rootfiles.iter().any(|attributes| {
        attributes.get("full-path").map(String::as_str) == Some(HWPX_CONTENT_PATH)
            && attributes.get("media-type").map(String::as_str)
                == Some("application/hwpml-package+xml")
    });
    let rdf_root = rootfiles.iter().any(|attributes| {
        attributes.get("full-path").map(String::as_str) == Some(HWPX_RDF_PATH)
            && attributes.get("media-type").map(String::as_str) == Some("application/rdf+xml")
    });
    if !valid_root || !content_root || !rdf_root {
        error(
            report,
            "HWPX_CONTAINER_STRUCTURE",
            "container.xml does not identify the content and RDF roots.",
            None,
            Some(HWPX_CONTAINER_PATH),
            None,
        );
    }
    for rootfile in rootfiles {
        if let Some(path) = rootfile.get("full-path")
            && (!safe_package_path(path) || !entries.contains_key(path))
        {
            error(
                report,
                "HWPX_CONTAINER_DANGLING_ROOT",
                "container.xml references a missing or unsafe package path.",
                None,
                Some(HWPX_CONTAINER_PATH),
                None,
            );
        }
    }
}

fn validate_content(
    entries: &BTreeMap<String, ArchiveEntry>,
    report: &mut HwpxValidationReport,
) -> ContentData {
    let Some(entry) = entries.get(HWPX_CONTENT_PATH) else {
        return ContentData::default();
    };
    let mut reader = Reader::from_reader(entry.bytes.as_slice());
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut data = ContentData::default();
    let mut root_count = 0_u64;
    let mut metadata_count = 0_u64;
    let mut manifest_count = 0_u64;
    let mut spine_count = 0_u64;
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) | Ok(Event::Empty(event)) => {
                let name = String::from_utf8_lossy(event.name().as_ref()).into_owned();
                let attrs = attributes(&reader, &event);
                match name.as_str() {
                    "opf:package" => {
                        root_count += 1;
                        data.valid_root = attrs.get("xmlns:opf").map(String::as_str)
                            == Some("http://www.idpf.org/2007/opf/")
                            && attrs.contains_key("version")
                            && attrs.contains_key("unique-identifier")
                            && attrs.contains_key("id");
                    }
                    "opf:metadata" => metadata_count += 1,
                    "opf:manifest" => manifest_count += 1,
                    "opf:spine" => spine_count += 1,
                    "opf:item" => {
                        let (Some(id), Some(href), Some(media_type)) =
                            (attrs.get("id"), attrs.get("href"), attrs.get("media-type"))
                        else {
                            data.valid_root = false;
                            buffer.clear();
                            continue;
                        };
                        if data
                            .manifest_items
                            .insert(id.clone(), (href.clone(), media_type.clone()))
                            .is_some()
                        {
                            error(
                                report,
                                "HWPX_MANIFEST_DUPLICATE_ID",
                                "content.hpf contains a duplicate manifest ID.",
                                None,
                                Some(HWPX_CONTENT_PATH),
                                None,
                            );
                        }
                    }
                    "opf:itemref" => {
                        if let Some(idref) = attrs.get("idref") {
                            data.spine.push(idref.clone());
                            if attrs.get("linear").map(String::as_str) != Some("yes") {
                                data.valid_root = false;
                            }
                        } else {
                            data.valid_root = false;
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buffer.clear();
    }
    if root_count != 1
        || metadata_count != 1
        || manifest_count != 1
        || spine_count != 1
        || !data.valid_root
    {
        error(
            report,
            "HWPX_CONTENT_STRUCTURE",
            "content.hpf does not contain one valid metadata/manifest/spine package.",
            None,
            Some(HWPX_CONTENT_PATH),
            None,
        );
    }
    data
}

fn validate_content_references(
    content: &ContentData,
    entries: &BTreeMap<String, ArchiveEntry>,
    report: &mut HwpxValidationReport,
) {
    for (id, (href, media_type)) in &content.manifest_items {
        let supported_id = id == "header" || id == "settings" || section_index(id).is_some();
        if !safe_package_path(href)
            || !entries.contains_key(href)
            || media_type != "application/xml"
            || !supported_id
            || id == "header" && href != HWPX_HEADER_PATH
            || id == "settings" && href != HWPX_SETTINGS_PATH
            || section_index(id)
                .is_some_and(|index| href != &format!("Contents/section{index}.xml"))
        {
            error(
                report,
                "HWPX_MANIFEST_RESOURCE",
                "content.hpf references a missing, unsafe, or unsupported resource.",
                None,
                Some(HWPX_CONTENT_PATH),
                None,
            );
        }
    }
    for required in ["header", "section0", "settings"] {
        if !content.manifest_items.contains_key(required) {
            error(
                report,
                "HWPX_MANIFEST_REQUIRED_ID",
                "content.hpf is missing a required manifest ID.",
                None,
                Some(HWPX_CONTENT_PATH),
                None,
            );
        }
    }
    let expected_spine = (0..content.spine.len())
        .map(|index| format!("section{index}"))
        .collect::<Vec<_>>();
    if content.spine.is_empty() || content.spine != expected_spine {
        error(
            report,
            "HWPX_SPINE_ORDER",
            "content.hpf spine is not a contiguous section0..sectionN sequence.",
            None,
            Some(HWPX_CONTENT_PATH),
            None,
        );
    }
    for idref in &content.spine {
        if !content.manifest_items.contains_key(idref) {
            error(
                report,
                "HWPX_SPINE_DANGLING_REF",
                "content.hpf spine contains a dangling idref.",
                None,
                Some(HWPX_CONTENT_PATH),
                None,
            );
        }
    }
    let manifest_sections = content
        .manifest_items
        .keys()
        .filter(|id| section_index(id).is_some())
        .collect::<BTreeSet<_>>();
    let spine_sections = content.spine.iter().collect::<BTreeSet<_>>();
    if manifest_sections != spine_sections {
        error(
            report,
            "HWPX_SECTION_MANIFEST_COVERAGE",
            "content.hpf manifest and spine do not identify the same sections.",
            None,
            Some(HWPX_CONTENT_PATH),
            None,
        );
    }
    let archive_section_paths = entries
        .keys()
        .filter(|path| section_path_index(path).is_some())
        .collect::<BTreeSet<_>>();
    let manifest_section_paths = content
        .manifest_items
        .iter()
        .filter(|(id, _)| section_index(id).is_some())
        .map(|(_, (href, _))| href)
        .collect::<BTreeSet<_>>();
    if archive_section_paths != manifest_section_paths {
        error(
            report,
            "HWPX_SECTION_FILE_COVERAGE",
            "HWPX section files and content.hpf manifest references differ.",
            None,
            Some(HWPX_CONTENT_PATH),
            None,
        );
    }
}

fn load_sections(
    content: &ContentData,
    entries: &BTreeMap<String, ArchiveEntry>,
    report: &mut HwpxValidationReport,
) -> Vec<SectionData> {
    content
        .spine
        .iter()
        .filter_map(|id| {
            let (href, _) = content.manifest_items.get(id)?;
            let entry = entries.get(href)?;
            Some(parse_section(&entry.bytes, report))
        })
        .collect()
}

fn section_index(id: &str) -> Option<usize> {
    let suffix = id.strip_prefix("section")?;
    if suffix.is_empty() || suffix.len() > 1 && suffix.starts_with('0') {
        return None;
    }
    suffix.parse().ok()
}

fn parse_header(bytes: &[u8], report: &mut HwpxValidationReport) -> HeaderData {
    let mut reader = Reader::from_reader(bytes);
    let mut buffer = Vec::new();
    let mut data = HeaderData::default();
    let mut current_char_pr = None;
    let mut current_para_pr = None;
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) => {
                inspect_header_element(
                    &reader,
                    &event,
                    false,
                    &mut data,
                    &mut current_char_pr,
                    &mut current_para_pr,
                    report,
                );
            }
            Ok(Event::Empty(event)) => {
                inspect_header_element(
                    &reader,
                    &event,
                    true,
                    &mut data,
                    &mut current_char_pr,
                    &mut current_para_pr,
                    report,
                );
            }
            Ok(Event::End(event)) => match event.name().as_ref() {
                b"hh:charPr" => current_char_pr = None,
                b"hh:paraPr" => current_para_pr = None,
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buffer.clear();
    }
    data
}

#[allow(clippy::too_many_arguments)]
fn inspect_header_element(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
    empty: bool,
    data: &mut HeaderData,
    current_char_pr: &mut Option<u32>,
    current_para_pr: &mut Option<u32>,
    report: &mut HwpxValidationReport,
) {
    let name = event.name();
    let attrs = attributes(reader, event);
    match name.as_ref() {
        b"hh:head" => {
            data.valid_root = attrs.get("xmlns:hh").map(String::as_str)
                == Some("http://www.hancom.co.kr/hwpml/2011/head")
                && attrs.get("xmlns:hc").map(String::as_str)
                    == Some("http://www.hancom.co.kr/hwpml/2011/core")
                && attrs.get("version").map(String::as_str) == Some("1.5");
            data.sec_count = parse_u32(attrs.get("secCnt")).unwrap_or_default();
        }
        b"hh:beginNum" => {
            data.begin_page = parse_u32(attrs.get("page")).unwrap_or_default();
            if ["footnote", "endnote", "pic", "tbl", "equation"]
                .iter()
                .any(|name| parse_u32(attrs.get(*name)).is_none())
            {
                data.valid_root = false;
            }
        }
        b"hh:fontfaces" => data.declared_font_count = parse_u32(attrs.get("itemCnt")),
        b"hh:fontface" => data.fontface_count += 1,
        b"hh:font" => {
            if let Some(id) = parse_u32(attrs.get("id")) {
                data.font_ids.insert(id);
            }
        }
        b"hh:borderFills" => data.declared_border_count = parse_u32(attrs.get("itemCnt")),
        b"hh:borderFill" => {
            if let Some(id) = parse_u32(attrs.get("id"))
                && !data.border_ids.insert(id)
            {
                duplicate_id(report, HWPX_HEADER_PATH, "borderFill");
            }
        }
        b"hh:charProperties" => data.declared_char_count = parse_u32(attrs.get("itemCnt")),
        b"hh:charPr" => {
            if let Some(id) = parse_u32(attrs.get("id")) {
                let property = CharProperty {
                    border_ref: parse_u32(attrs.get("borderFillIDRef")).unwrap_or(u32::MAX),
                    ..CharProperty::default()
                };
                if data.char_properties.insert(id, property).is_some() {
                    duplicate_id(report, HWPX_HEADER_PATH, "charPr");
                }
                if !empty {
                    *current_char_pr = Some(id);
                }
            }
        }
        b"hh:fontRef" => {
            if let Some(id) = *current_char_pr
                && let Some(property) = data.char_properties.get_mut(&id)
            {
                for name in [
                    "hangul", "latin", "hanja", "japanese", "other", "symbol", "user",
                ] {
                    property
                        .font_refs
                        .push(parse_u32(attrs.get(name)).unwrap_or(u32::MAX));
                }
            }
        }
        b"hh:bold" => set_char_flag(data, *current_char_pr, |value| value.bold = true),
        b"hh:italic" => set_char_flag(data, *current_char_pr, |value| value.italic = true),
        b"hh:underline" => {
            if attrs.get("type").map(String::as_str) != Some("BOTTOM")
                || attrs.get("shape").map(String::as_str) != Some("SOLID")
            {
                data.valid_root = false;
            }
            set_char_flag(data, *current_char_pr, |value| value.underline = true);
        }
        b"hh:strikeout" => {
            if attrs.get("shape").map(String::as_str) != Some("SOLID") {
                data.valid_root = false;
            }
            set_char_flag(data, *current_char_pr, |value| value.strike = true);
        }
        b"hh:tabProperties" => data.declared_tab_count = parse_u32(attrs.get("itemCnt")),
        b"hh:tabPr" => {
            if let Some(id) = parse_u32(attrs.get("id"))
                && !data.tab_ids.insert(id)
            {
                duplicate_id(report, HWPX_HEADER_PATH, "tabPr");
            }
        }
        b"hh:paraProperties" => data.declared_para_count = parse_u32(attrs.get("itemCnt")),
        b"hh:paraPr" => {
            if let Some(id) = parse_u32(attrs.get("id")) {
                let refs = (
                    parse_u32(attrs.get("tabPrIDRef")).unwrap_or(u32::MAX),
                    u32::MAX,
                );
                if data.para_properties.insert(id, refs).is_some() {
                    duplicate_id(report, HWPX_HEADER_PATH, "paraPr");
                }
                if !empty {
                    *current_para_pr = Some(id);
                }
            }
        }
        b"hh:border" => {
            if let Some(id) = *current_para_pr
                && let Some(refs) = data.para_properties.get_mut(&id)
            {
                refs.1 = parse_u32(attrs.get("borderFillIDRef")).unwrap_or(u32::MAX);
            }
        }
        b"hh:styles" => data.declared_style_count = parse_u32(attrs.get("itemCnt")),
        b"hh:style" => {
            if let (Some(id), Some(para), Some(character), Some(next)) = (
                parse_u32(attrs.get("id")),
                parse_u32(attrs.get("paraPrIDRef")),
                parse_u32(attrs.get("charPrIDRef")),
                parse_u32(attrs.get("nextStyleIDRef")),
            ) && data.styles.insert(id, (para, character, next)).is_some()
            {
                duplicate_id(report, HWPX_HEADER_PATH, "style");
            }
        }
        _ => {}
    }
}

fn set_char_flag(data: &mut HeaderData, id: Option<u32>, update: impl FnOnce(&mut CharProperty)) {
    if let Some(id) = id
        && let Some(property) = data.char_properties.get_mut(&id)
    {
        update(property);
    }
}

fn validate_header(
    data: &HeaderData,
    expected_section_count: usize,
    report: &mut HwpxValidationReport,
) {
    if !data.valid_root || data.sec_count as usize != expected_section_count || data.begin_page == 0
    {
        error(
            report,
            "HWPX_HEADER_ROOT",
            "header.xml root, section count, or beginNum is invalid.",
            None,
            Some(HWPX_HEADER_PATH),
            None,
        );
    }
    if data.declared_font_count != Some(data.fontface_count)
        || data.declared_border_count != Some(data.border_ids.len() as u32)
        || data.declared_char_count != Some(data.char_properties.len() as u32)
        || data.declared_tab_count != Some(data.tab_ids.len() as u32)
        || data.declared_para_count != Some(data.para_properties.len() as u32)
        || data.declared_style_count != Some(data.styles.len() as u32)
        || data.font_ids.is_empty()
        || data.char_properties.is_empty()
        || data.para_properties.is_empty()
        || data.styles.is_empty()
    {
        error(
            report,
            "HWPX_HEADER_TABLE_COUNT",
            "header.xml mapping table counts are inconsistent.",
            None,
            Some(HWPX_HEADER_PATH),
            None,
        );
    }
    for property in data.char_properties.values() {
        if !data.border_ids.contains(&property.border_ref)
            || property.font_refs.len() != 7
            || property
                .font_refs
                .iter()
                .any(|reference| !data.font_ids.contains(reference))
        {
            error(
                report,
                "HWPX_CHAR_PROPERTY_REFERENCE",
                "A charPr has a dangling font or border reference.",
                None,
                Some(HWPX_HEADER_PATH),
                None,
            );
        }
    }
    for (tab_ref, border_ref) in data.para_properties.values() {
        if !data.tab_ids.contains(tab_ref) || !data.border_ids.contains(border_ref) {
            error(
                report,
                "HWPX_PARA_PROPERTY_REFERENCE",
                "A paraPr has a dangling tab or border reference.",
                None,
                Some(HWPX_HEADER_PATH),
                None,
            );
        }
    }
    for (para_ref, char_ref, next_ref) in data.styles.values() {
        if !data.para_properties.contains_key(para_ref)
            || !data.char_properties.contains_key(char_ref)
            || !data.styles.contains_key(next_ref)
        {
            error(
                report,
                "HWPX_STYLE_REFERENCE",
                "A style has a dangling paragraph, character, or next-style reference.",
                None,
                Some(HWPX_HEADER_PATH),
                None,
            );
        }
    }
}

fn parse_section(bytes: &[u8], report: &mut HwpxValidationReport) -> SectionData {
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut data = SectionData::default();
    let mut current_paragraph: Option<ParsedParagraph> = None;
    let mut current_run: Option<ParsedRun> = None;
    let mut in_text = false;
    let mut control_context: Option<&'static str> = None;
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) => {
                let name = event.name();
                let attrs = attributes(&reader, &event);
                match name.as_ref() {
                    b"hs:sec" => {
                        data.valid_root = attrs.get("xmlns:hs").map(String::as_str)
                            == Some("http://www.hancom.co.kr/hwpml/2011/section")
                            && attrs.get("xmlns:hp").map(String::as_str)
                                == Some("http://www.hancom.co.kr/hwpml/2011/paragraph");
                    }
                    b"hp:p" => {
                        data.paragraph_count += 1;
                        current_paragraph = parse_paragraph_attrs(&attrs);
                        if let Some(id) = current_paragraph.as_ref().map(|paragraph| paragraph.id)
                            && !data.paragraph_ids.insert(id)
                        {
                            data.duplicate_paragraph_id = true;
                        }
                        if data.control_paragraph_id.is_none() {
                            data.control_paragraph_id =
                                current_paragraph.as_ref().map(|value| value.id);
                        }
                        if current_paragraph.is_none() {
                            data.valid_root = false;
                        }
                    }
                    b"hp:run" => {
                        data.run_count += 1;
                        current_run =
                            parse_u32(attrs.get("charPrIDRef")).map(|char_pr_id| ParsedRun {
                                char_pr_id,
                                text: String::new(),
                            });
                        if current_run.is_none() {
                            data.valid_root = false;
                        }
                    }
                    b"hp:t" => {
                        data.text_count += 1;
                        in_text = true;
                    }
                    b"hp:secPr" => {
                        data.has_section_definition =
                            attrs.get("textDirection").map(String::as_str) == Some("HORIZONTAL")
                                && attrs.get("tabStopUnit").map(String::as_str) == Some("HWPUNIT");
                    }
                    b"hp:pagePr" => {
                        data.page_width = parse_u32(attrs.get("width"));
                        data.page_height = parse_u32(attrs.get("height"));
                    }
                    b"hp:margin" => data.margins = parse_page_margins(&attrs),
                    b"hp:startNum" => data.start_page = parse_u32(attrs.get("page")),
                    b"hp:header" => control_context = Some("header"),
                    b"hp:footer" => control_context = Some("footer"),
                    _ => {}
                }
            }
            Ok(Event::Empty(event)) => {
                let name = event.name();
                let attrs = attributes(&reader, &event);
                match name.as_ref() {
                    b"hp:secPr" => {
                        data.has_section_definition =
                            attrs.get("textDirection").map(String::as_str) == Some("HORIZONTAL")
                                && attrs.get("tabStopUnit").map(String::as_str) == Some("HWPUNIT");
                    }
                    b"hp:pagePr" => {
                        data.page_width = parse_u32(attrs.get("width"));
                        data.page_height = parse_u32(attrs.get("height"));
                    }
                    b"hp:margin" => data.margins = parse_page_margins(&attrs),
                    b"hp:startNum" => data.start_page = parse_u32(attrs.get("page")),
                    b"hp:pageNum" => {
                        if attrs.get("formatType").map(String::as_str) == Some("DIGIT")
                            && attrs.contains_key("sideChar")
                        {
                            data.page_number_position = attrs.get("pos").cloned();
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(text)) if in_text => {
                if let Some(run) = current_run.as_mut() {
                    match text.unescape() {
                        Ok(text) => run.text.push_str(&text),
                        Err(_) => data.valid_root = false,
                    }
                }
            }
            Ok(Event::End(event)) => match event.name().as_ref() {
                b"hp:t" => in_text = false,
                b"hp:run" => {
                    if let Some(run) = current_run.take()
                        && let Some(paragraph) = current_paragraph.as_mut()
                    {
                        paragraph.runs.push(run);
                    }
                }
                b"hp:p" => {
                    if let Some(paragraph) = current_paragraph.take() {
                        let text: String =
                            paragraph.runs.iter().map(|run| run.text.as_str()).collect();
                        match control_context {
                            Some("header") => data.header_text = Some(text),
                            Some("footer") => data.footer_text = Some(text),
                            _ => {
                                let id = paragraph.id;
                                if data.paragraphs.insert(id, paragraph).is_some() {
                                    data.duplicate_paragraph_id = true;
                                }
                            }
                        }
                    }
                }
                b"hp:header" | b"hp:footer" => control_context = None,
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buffer.clear();
    }
    if current_paragraph.is_some() || current_run.is_some() || in_text {
        data.valid_root = false;
    }
    if data.duplicate_paragraph_id {
        duplicate_id(report, HWPX_SECTION_PATH, "paragraph");
    }
    data
}

fn parse_paragraph_attrs(attrs: &BTreeMap<String, String>) -> Option<ParsedParagraph> {
    Some(ParsedParagraph {
        id: parse_u32(attrs.get("id"))?,
        para_pr_id: parse_u32(attrs.get("paraPrIDRef"))?,
        style_id: parse_u32(attrs.get("styleIDRef"))?,
        runs: Vec::new(),
    })
}

fn parse_page_margins(attrs: &BTreeMap<String, String>) -> Option<[u32; 7]> {
    Some([
        parse_u32(attrs.get("left"))?,
        parse_u32(attrs.get("right"))?,
        parse_u32(attrs.get("top"))?,
        parse_u32(attrs.get("bottom"))?,
        parse_u32(attrs.get("header"))?,
        parse_u32(attrs.get("footer"))?,
        parse_u32(attrs.get("gutter"))?,
    ])
}

fn validate_section(data: &SectionData, header: &HeaderData, report: &mut HwpxValidationReport) {
    if !data.valid_root
        || data.paragraph_count == 0
        || !data.has_section_definition
        || data.page_width.is_none()
        || data.page_height.is_none()
        || data.margins.is_none()
        || data.start_page.is_none()
    {
        error(
            report,
            "HWPX_SECTION_STRUCTURE",
            "section0.xml lacks a valid root, paragraph, section definition, or page definition.",
            None,
            Some(HWPX_SECTION_PATH),
            None,
        );
    }
    for paragraph in data.paragraphs.values() {
        if !header.para_properties.contains_key(&paragraph.para_pr_id)
            || !header.styles.contains_key(&paragraph.style_id)
        {
            error(
                report,
                "HWPX_PARAGRAPH_REFERENCE",
                "A paragraph has a dangling paraPr or style reference.",
                None,
                Some(HWPX_SECTION_PATH),
                None,
            );
        }
        for run in &paragraph.runs {
            if !header.char_properties.contains_key(&run.char_pr_id) {
                error(
                    report,
                    "HWPX_RUN_REFERENCE",
                    "A run has a dangling charPr reference.",
                    None,
                    Some(HWPX_SECTION_PATH),
                    None,
                );
            }
        }
    }
}

fn validate_global_paragraph_ids(sections: &[SectionData], report: &mut HwpxValidationReport) {
    let mut ids = BTreeSet::new();
    if sections
        .iter()
        .flat_map(|section| &section.paragraph_ids)
        .any(|id| !ids.insert(*id))
    {
        error(
            report,
            "HWPX_DUPLICATE_PARAGRAPH_ID",
            "HWPX paragraph IDs are not unique across sections.",
            None,
            None,
            Some("Regenerate the HWPX package with deterministic global paragraph IDs."),
        );
    }
}

fn validate_expectation(
    expectation: &HwpxValidationExpectation,
    sections: &[SectionData],
    header: &HeaderData,
    report: &mut HwpxValidationReport,
) {
    if expectation.exported_block_count
        + expectation.fallback_block_count
        + expectation.configured_omission_block_count
        + expectation.rejected_block_count
        != expectation.source_block_count
        || expectation.rejected_block_count != 0
        || expectation.exported_character_count != expectation.source_character_count
    {
        error(
            report,
            "HWPX_SOURCE_DISPOSITION",
            "Source block disposition or character coverage is inconsistent.",
            None,
            Some(HWPX_SECTION_PATH),
            None,
        );
    }
    let paragraph_count = sections
        .iter()
        .map(|section| section.paragraph_count)
        .sum::<u64>();
    let run_count = sections
        .iter()
        .map(|section| section.run_count)
        .sum::<u64>();
    let text_count = sections
        .iter()
        .map(|section| section.text_count)
        .sum::<u64>();
    if sections.len() as u64 != expectation.expected_section_count
        || paragraph_count != expectation.paragraph_count
        || run_count != expectation.run_count
        || text_count != expectation.text_count
    {
        error(
            report,
            "HWPX_DOCUMENT_COUNTS",
            "Generated paragraph, run, or text counts differ from the generation plan.",
            None,
            Some(HWPX_SECTION_PATH),
            None,
        );
    }
    let mut actual_heading_count = 0_u64;
    let mut actual_scene_break_count = 0_u64;
    let mut actual_ruby_fallback_count = 0_u64;
    let mut actual_exported = 0_u64;
    let mut actual_fallback = 0_u64;
    let mut actual_configured_omission = 0_u64;
    let mut actual_character_count = 0_u64;
    for expected in expectation.blocks.values() {
        if expected.disposition == ExpectedDisposition::ConfiguredOmission {
            if expected.paragraph.is_some() {
                error(
                    report,
                    "HWPX_CONFIGURED_OMISSION_SEQUENCE",
                    "A configured heading omission unexpectedly owns an output paragraph.",
                    Some(&expected.source_node_id),
                    Some(HWPX_SECTION_PATH),
                    None,
                );
            }
            actual_configured_omission += 1;
            continue;
        }
        let Some(expected_paragraph) = expected.paragraph.as_ref() else {
            error(
                report,
                "HWPX_SOURCE_BLOCK_PLAN",
                "An exported source block has no planned paragraph.",
                Some(&expected.source_node_id),
                Some(HWPX_SECTION_PATH),
                None,
            );
            continue;
        };
        let Some(actual) = sections
            .get(expected.section_index)
            .and_then(|section| section.paragraphs.get(&expected_paragraph.id))
        else {
            error(
                report,
                "HWPX_SOURCE_BLOCK_MISSING",
                "A Publication IR block is missing from section0.xml.",
                Some(&expected.source_node_id),
                Some(HWPX_SECTION_PATH),
                None,
            );
            continue;
        };
        if actual.para_pr_id != expected_paragraph.para_pr_id
            || actual.style_id != expected_paragraph.style_id
            || !runs_equal(&actual.runs, &expected_paragraph.runs)
        {
            error(
                report,
                "HWPX_SOURCE_BLOCK_SEQUENCE",
                "A Publication IR block's exact text/run/style sequence was not preserved.",
                Some(&expected.source_node_id),
                Some(HWPX_SECTION_PATH),
                None,
            );
        }
        actual_character_count += expected_paragraph
            .runs
            .iter()
            .map(|run| run.text.chars().count() as u64)
            .sum::<u64>();
        match expected.disposition {
            ExpectedDisposition::Exported => actual_exported += 1,
            ExpectedDisposition::Fallback => actual_fallback += 1,
            ExpectedDisposition::ConfiguredOmission => actual_configured_omission += 1,
        }
        actual_heading_count += u64::from(expected.is_heading);
        actual_scene_break_count += u64::from(expected.is_scene_break);
        actual_ruby_fallback_count += expected.ruby_fallback_count;
    }
    // Source character coverage excludes headings, scene-break ornaments, and ruby annotation,
    // as defined by Publication IR stats. Exact block text comparison above covers those separately.
    let source_character_count = expectation
        .blocks
        .values()
        .map(|block| block.source_character_count)
        .sum::<u64>();
    if source_character_count != expectation.source_character_count
        || actual_exported != expectation.exported_block_count
        || actual_fallback != expectation.fallback_block_count
        || actual_configured_omission != expectation.configured_omission_block_count
        || actual_heading_count != expectation.heading_count
        || actual_scene_break_count != expectation.scene_break_count
        || actual_ruby_fallback_count != expectation.ruby_fallback_count
        || expectation.ruby_count != expectation.ruby_fallback_count
        || actual_character_count == 0 && expectation.source_character_count > 0
    {
        error(
            report,
            "HWPX_SOURCE_COVERAGE",
            "HWPX semantic source coverage counters are inconsistent.",
            None,
            Some(HWPX_SECTION_PATH),
            None,
        );
    }
    validate_inline_properties(expectation, header, report);
    let expected_margins = [
        expectation.margin_left,
        expectation.margin_right,
        expectation.margin_top,
        expectation.margin_bottom,
        expectation.margin_header,
        expectation.margin_footer,
        expectation.margin_gutter,
    ];
    let invalid_page_settings = sections.iter().enumerate().any(|(index, section)| {
        section.page_width != Some(expectation.page_width)
            || section.page_height != Some(expectation.page_height)
            || section.margins != Some(expected_margins)
            || section.start_page
                != Some(if index == 0 {
                    expectation.page_number_start
                } else {
                    0
                })
            || section.page_number_position != expectation.page_number_position
            || section.header_text != expectation.header_text
            || section.footer_text != expectation.footer_text
    });
    if invalid_page_settings || header.begin_page != expectation.page_number_start {
        error(
            report,
            "HWPX_PAGE_SETTINGS",
            "HWPX page geometry, numbering, header, or footer differs from the request.",
            None,
            Some(HWPX_SECTION_PATH),
            None,
        );
    }
}

fn runs_equal(actual: &[ParsedRun], expected: &[ExpectedRun]) -> bool {
    actual.len() == expected.len()
        && actual.iter().zip(expected).all(|(actual, expected)| {
            actual.char_pr_id == expected.char_pr_id && actual.text == expected.text
        })
}

fn validate_inline_properties(
    expectation: &HwpxValidationExpectation,
    header: &HeaderData,
    report: &mut HwpxValidationReport,
) {
    let expected_masks = expectation
        .blocks
        .values()
        .filter_map(|block| block.paragraph.as_ref())
        .flat_map(|paragraph| paragraph.runs.iter().map(|run| run.char_pr_id))
        .filter(|id| *id < 16)
        .collect::<BTreeSet<_>>();
    for mask in expected_masks {
        let Some(property) = header.char_properties.get(&mask) else {
            continue;
        };
        if property.bold != (mask & 0b0001 != 0)
            || property.italic != (mask & 0b0010 != 0)
            || property.underline != (mask & 0b0100 != 0)
            || property.strike != (mask & 0b1000 != 0)
        {
            error(
                report,
                "HWPX_INLINE_STYLE_COVERAGE",
                "A generated charPr does not preserve its inline modifier mask.",
                None,
                Some(HWPX_HEADER_PATH),
                None,
            );
        }
    }
    let counters = [
        expectation.strong_segment_count,
        expectation.emphasis_segment_count,
        expectation.underline_segment_count,
        expectation.strike_segment_count,
    ];
    if counters.iter().any(|count| *count > 0) && header.char_properties.len() < 16 {
        error(
            report,
            "HWPX_INLINE_TABLE_COVERAGE",
            "Inline modifier usage is not backed by the complete deterministic charPr table.",
            None,
            Some(HWPX_HEADER_PATH),
            None,
        );
    }
}

fn expected_publication_block(
    block: &PublicationBlock,
    options: &HwpxExportOptions,
) -> Option<(u32, String, Vec<u32>)> {
    match block {
        PublicationBlock::Heading { level, text, .. } => {
            let (style, included) = match level {
                1 => (1, options.include_work_title),
                2 => (2, options.include_volume_titles),
                3 => (3, options.include_chapter_titles),
                _ => (4, options.include_scene_titles),
            };
            if included {
                Some((style, text.clone(), vec![15 + style]))
            } else {
                None
            }
        }
        PublicationBlock::Paragraph { inlines, .. } => {
            let mut runs = Vec::new();
            flatten_expected_inlines(inlines, 0, &mut runs);
            if runs.is_empty() {
                runs.push((0, String::new()));
            }
            let text = runs.iter().map(|(_, text)| text.as_str()).collect();
            let masks = runs.into_iter().map(|(mask, _)| mask).collect();
            Some((0, text, masks))
        }
        PublicationBlock::Quote { inlines, .. } => {
            let mut runs = Vec::new();
            flatten_expected_inlines(inlines, 0, &mut runs);
            if runs.is_empty() {
                runs.push((20, String::new()));
            } else if runs.len() == 1 && runs[0].0 == 0 {
                runs[0].0 = 20;
            }
            let text = runs.iter().map(|(_, text)| text.as_str()).collect();
            let masks = runs.into_iter().map(|(mask, _)| mask).collect();
            Some((5, text, masks))
        }
        PublicationBlock::SceneBreak { .. } => Some((
            6,
            match options.scene_break_token {
                HwpxSceneBreakToken::Ornament => "＊　＊　＊",
                HwpxSceneBreakToken::Rule => "―――",
                HwpxSceneBreakToken::Space => "　",
            }
            .to_owned(),
            vec![21],
        )),
        PublicationBlock::Unsupported { text, .. } => Some((0, text.clone(), vec![0])),
    }
}

fn flatten_expected_inlines(
    inlines: &[PublicationInline],
    mask: u32,
    runs: &mut Vec<(u32, String)>,
) {
    for inline in inlines {
        match inline {
            PublicationInline::Text { text } => push_expected_run(runs, mask, text),
            PublicationInline::Strong { children } => {
                flatten_expected_inlines(children, mask | 0b0001, runs)
            }
            PublicationInline::Emphasis { children } => {
                flatten_expected_inlines(children, mask | 0b0010, runs)
            }
            PublicationInline::Underline { children } => {
                flatten_expected_inlines(children, mask | 0b0100, runs)
            }
            PublicationInline::Strike { children } => {
                flatten_expected_inlines(children, mask | 0b1000, runs)
            }
            PublicationInline::Ruby {
                annotation,
                children,
            } => {
                flatten_expected_inlines(children, mask, runs);
                push_expected_run(runs, mask, &format!("({annotation})"));
            }
        }
    }
}

fn push_expected_run(runs: &mut Vec<(u32, String)>, mask: u32, text: &str) {
    if text.is_empty() {
        return;
    }
    if let Some((last_mask, last_text)) = runs.last_mut()
        && *last_mask == mask
    {
        last_text.push_str(text);
    } else {
        runs.push((mask, text.to_owned()));
    }
}

fn source_node_id(block: &PublicationBlock) -> &str {
    match block {
        PublicationBlock::Heading { source, .. }
        | PublicationBlock::Paragraph { source, .. }
        | PublicationBlock::SceneBreak { source, .. }
        | PublicationBlock::Quote { source, .. }
        | PublicationBlock::Unsupported { source, .. } => &source.source_node_id,
    }
}

fn validate_security(entries: &BTreeMap<String, ArchiveEntry>, report: &mut HwpxValidationReport) {
    for (path, entry) in entries {
        let supported_entry = matches!(
            path.as_str(),
            "mimetype"
                | HWPX_VERSION_PATH
                | HWPX_HEADER_PATH
                | HWPX_SETTINGS_PATH
                | HWPX_RDF_PATH
                | HWPX_CONTENT_PATH
                | HWPX_CONTAINER_PATH
                | HWPX_MANIFEST_PATH
                | "Preview/PrvText.txt"
                | "Preview/PrvImage.png"
        ) || section_path_index(path).is_some();
        if !supported_entry {
            error(
                report,
                "HWPX_UNEXPECTED_PACKAGE_ENTRY",
                "HWPX contains an entry outside the supported document-only profile.",
                None,
                Some(path),
                Some("Remove scripts, macros, executables, and unreferenced payloads."),
            );
        }
        let lower_path = path.to_ascii_lowercase();
        let active_extension = [
            ".exe", ".dll", ".com", ".scr", ".msi", ".bat", ".cmd", ".ps1", ".js", ".vbs", ".jar",
            ".hta", ".lnk",
        ]
        .iter()
        .any(|extension| lower_path.ends_with(extension));
        let active_directory = lower_path
            .split('/')
            .any(|component| matches!(component, "script" | "scripts" | "macro" | "macros"));
        if active_extension || active_directory || executable_magic(&entry.bytes) {
            error(
                report,
                "HWPX_ACTIVE_CONTENT",
                "HWPX contains a script, macro, or executable payload.",
                None,
                Some(path),
                Some("Use a document-only HWPX package."),
            );
        }
        if !matches!(
            entry.compression,
            CompressionMethod::Stored | CompressionMethod::Deflated
        ) {
            error(
                report,
                "HWPX_UNSUPPORTED_COMPRESSION",
                "HWPX uses a compression method outside the supported profile.",
                None,
                Some(path),
                None,
            );
        }
        if (path.ends_with(".xml") || path.ends_with(".hpf") || path.ends_with(".rdf"))
            && xml_has_external_reference(&entry.bytes)
        {
            error(
                report,
                "HWPX_EXTERNAL_REFERENCE",
                "HWPX XML contains an external or active resource reference.",
                None,
                Some(path),
                Some("Use package-local references only."),
            );
        }
        if (path.ends_with(".xml") || path.ends_with(".hpf") || path.ends_with(".rdf"))
            && xml_has_active_content_element(&entry.bytes)
        {
            error(
                report,
                "HWPX_ACTIVE_CONTENT",
                "HWPX XML contains a script or macro element.",
                None,
                Some(path),
                Some("Use a document-only HWPX package."),
            );
        }
    }
    for forbidden in [
        "META-INF/encryption.xml",
        "META-INF/signatures.xml",
        "META-INF/documentsignatures.xml",
    ] {
        if entries.contains_key(forbidden) {
            error(
                report,
                "HWPX_UNSUPPORTED_PROTECTED_PACKAGE",
                "Encrypted or signed HWPX packages are outside this validator profile.",
                None,
                Some(forbidden),
                None,
            );
        }
    }
    if let Some(entry) = entries.get(HWPX_MANIFEST_PATH) {
        let roots = collect_elements(&entry.bytes, "odf:manifest");
        if roots.len() != 1
            || roots[0].get("xmlns:odf").map(String::as_str)
                != Some("urn:oasis:names:tc:opendocument:xmlns:manifest:1.0")
        {
            error(
                report,
                "HWPX_ODF_MANIFEST_STRUCTURE",
                "META-INF/manifest.xml has an invalid root.",
                None,
                Some(HWPX_MANIFEST_PATH),
                None,
            );
        }
    }
    if let Some(entry) = entries.get(HWPX_RDF_PATH) {
        let roots = collect_elements(&entry.bytes, "rdf:RDF");
        if roots.len() != 1
            || roots[0].get("xmlns:rdf").map(String::as_str)
                != Some("http://www.w3.org/1999/02/22-rdf-syntax-ns#")
        {
            error(
                report,
                "HWPX_RDF_STRUCTURE",
                "META-INF/container.rdf has an invalid root.",
                None,
                Some(HWPX_RDF_PATH),
                None,
            );
        }
    }
}

fn section_path_index(path: &str) -> Option<usize> {
    let suffix = path
        .strip_prefix("Contents/section")?
        .strip_suffix(".xml")?;
    if suffix.is_empty() || suffix.len() > 1 && suffix.starts_with('0') {
        return None;
    }
    suffix.parse().ok()
}

fn executable_magic(bytes: &[u8]) -> bool {
    bytes.starts_with(b"MZ")
        || bytes.starts_with(b"\x7fELF")
        || bytes.starts_with(&[0xfe, 0xed, 0xfa, 0xce])
        || bytes.starts_with(&[0xfe, 0xed, 0xfa, 0xcf])
        || bytes.starts_with(&[0xce, 0xfa, 0xed, 0xfe])
        || bytes.starts_with(&[0xcf, 0xfa, 0xed, 0xfe])
}

fn xml_has_external_reference(bytes: &[u8]) -> bool {
    let mut reader = Reader::from_reader(bytes);
    let mut buffer = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) | Ok(Event::Empty(event)) => {
                for attribute in event.attributes().with_checks(true).flatten() {
                    let name = String::from_utf8_lossy(attribute.key.as_ref()).to_ascii_lowercase();
                    let local_name = name.rsplit(':').next().unwrap_or(&name);
                    if !matches!(
                        local_name,
                        "href" | "src" | "url" | "target" | "resource" | "about"
                    ) {
                        continue;
                    }
                    let Ok(value) = attribute.decode_and_unescape_value(reader.decoder()) else {
                        return true;
                    };
                    if remote_or_active_reference(&value) {
                        return true;
                    }
                }
            }
            Ok(Event::Eof) => return false,
            Err(_) => return true,
            _ => {}
        }
        buffer.clear();
    }
}

fn xml_has_active_content_element(bytes: &[u8]) -> bool {
    let mut reader = Reader::from_reader(bytes);
    let mut buffer = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) | Ok(Event::Empty(event)) => {
                let name = String::from_utf8_lossy(event.name().as_ref()).to_ascii_lowercase();
                let local_name = name.rsplit(':').next().unwrap_or(&name);
                if matches!(local_name, "script" | "macro") {
                    return true;
                }
            }
            Ok(Event::Eof) => return false,
            Err(_) => return true,
            _ => {}
        }
        buffer.clear();
    }
}

fn remote_or_active_reference(value: &str) -> bool {
    let lower = value.trim().to_ascii_lowercase();
    if lower.starts_with('/')
        || lower.starts_with("\\\\")
        || lower.contains('\\')
        || lower
            .split(['/', '#'])
            .any(|component| matches!(component, "." | ".."))
    {
        return true;
    }
    let first_boundary = ['/', '?', '#']
        .into_iter()
        .filter_map(|separator| lower.find(separator))
        .min()
        .unwrap_or(lower.len());
    lower
        .find(':')
        .is_some_and(|colon_index| colon_index < first_boundary)
}

fn collect_elements(bytes: &[u8], expected_name: &str) -> Vec<BTreeMap<String, String>> {
    let mut reader = Reader::from_reader(bytes);
    let mut buffer = Vec::new();
    let mut output = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) | Ok(Event::Empty(event)) => {
                if event.name().as_ref() == expected_name.as_bytes() {
                    output.push(attributes(&reader, &event));
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buffer.clear();
    }
    output
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

fn parse_u32(value: Option<&String>) -> Option<u32> {
    value?.parse().ok()
}

fn duplicate_id(report: &mut HwpxValidationReport, path: &str, kind: &str) {
    error(
        report,
        "HWPX_DUPLICATE_XML_ID",
        &format!("HWPX contains a duplicate {kind} numeric ID."),
        None,
        Some(path),
        None,
    );
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

fn push_message(
    report: &mut HwpxValidationReport,
    code: &str,
    severity: HwpxValidationSeverity,
    description: &str,
    source_node_id: Option<&str>,
    hwpx_path: Option<&str>,
    suggestion: Option<&str>,
) {
    if report.messages.len() >= MAX_VALIDATION_MESSAGES {
        return;
    }
    report.push(HwpxValidationMessage {
        code: code.to_owned(),
        severity,
        description: description.to_owned(),
        source_node_id: source_node_id.map(str::to_owned),
        hwpx_path: hwpx_path.map(str::to_owned),
        suggestion: suggestion.map(str::to_owned),
    });
}

fn fatal(
    report: &mut HwpxValidationReport,
    code: &str,
    description: &str,
    source_node_id: Option<&str>,
    hwpx_path: Option<&str>,
    suggestion: Option<&str>,
) {
    push_message(
        report,
        code,
        HwpxValidationSeverity::Fatal,
        description,
        source_node_id,
        hwpx_path,
        suggestion,
    );
}

fn error(
    report: &mut HwpxValidationReport,
    code: &str,
    description: &str,
    source_node_id: Option<&str>,
    hwpx_path: Option<&str>,
    suggestion: Option<&str>,
) {
    push_message(
        report,
        code,
        HwpxValidationSeverity::Error,
        description,
        source_node_id,
        hwpx_path,
        suggestion,
    );
}
