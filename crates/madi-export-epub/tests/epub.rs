use std::collections::BTreeMap;
use std::io::{Cursor, Read, Write};
use std::process::{Command, Stdio};

use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngEncoder;
use image::{ExtendedColorType, ImageEncoder as _};
use madi_export_epub::{
    CancellationToken, EPUB_MIMETYPE, EpubBodyStyleToken, EpubCoverInput, EpubCoverMediaType,
    EpubError, EpubExportOptions, EpubExportRequest, EpubPublicationMetadata,
    EpubSceneBreakStyleToken, EpubSplitMode, EpubStylesheetToken, EpubTargetProfile,
    EpubUtilityInput, EpubUtilityMessage, EpubUtilityMode, EpubValidationStatus,
    compile_epub_bytes, export_epub, export_epub_for_operation_with_progress,
    operation_temporary_path, validate_epub_against_publication, validate_epub_bytes,
};
use madi_publication::{
    PUBLICATION_DOCUMENT_FORMAT_VERSION, PublicationBlock, PublicationDocument, PublicationInline,
    PublicationSection, PublicationSourceReference, PublicationSourceStatistics,
    canonical_publication_document,
};
use sha2::{Digest, Sha256};
use tempfile::tempdir;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipArchive, ZipWriter};

fn source(scene: &str, suffix: &str, heading_node: Option<&str>) -> PublicationSourceReference {
    let verified = heading_node.is_none();
    PublicationSourceReference {
        source_node_id: heading_node.unwrap_or(scene).to_owned(),
        scene_node_id: scene.to_owned(),
        document_id: format!("document-{scene}"),
        block_id: format!("source-{scene}-{suffix}"),
        start: verified.then_some(0),
        end: verified.then_some(10),
        range_verified: verified,
    }
}

fn rich_inlines(scene: &str) -> Vec<PublicationInline> {
    vec![
        PublicationInline::Text {
            text: format!("한국어 {scene} <script>alert(1)</script> & "),
        },
        PublicationInline::Strong {
            children: vec![PublicationInline::Text {
                text: "굵게".to_owned(),
            }],
        },
        PublicationInline::Emphasis {
            children: vec![PublicationInline::Text {
                text: "기울임".to_owned(),
            }],
        },
        PublicationInline::Underline {
            children: vec![PublicationInline::Text {
                text: "밑줄".to_owned(),
            }],
        },
        PublicationInline::Strike {
            children: vec![PublicationInline::Text {
                text: "취소".to_owned(),
            }],
        },
        PublicationInline::Ruby {
            annotation: "한".to_owned(),
            children: vec![PublicationInline::Text {
                text: "韓".to_owned(),
            }],
        },
    ]
}

fn scene(section_number: usize, chapter: Option<(&str, &str)>) -> PublicationSection {
    let scene_id = format!("scene-{section_number}");
    let mut blocks = Vec::new();
    if section_number == 1 {
        blocks.push(PublicationBlock::Heading {
            id: "heading-work".to_owned(),
            level: 1,
            text: "작품 <테스트>".to_owned(),
            source: source(&scene_id, "heading-work", Some("work-a")),
        });
    }
    if let Some((chapter_id, title)) = chapter {
        blocks.push(PublicationBlock::Heading {
            id: format!("heading-{chapter_id}"),
            level: 3,
            text: title.to_owned(),
            source: source(
                &scene_id,
                &format!("heading-{chapter_id}"),
                Some(chapter_id),
            ),
        });
    }
    blocks.push(PublicationBlock::Heading {
        id: format!("heading-{scene_id}"),
        level: 4,
        text: format!("장면 {section_number}"),
        source: source(&scene_id, "heading-scene", Some(&scene_id)),
    });
    blocks.push(PublicationBlock::Paragraph {
        id: format!("paragraph-{scene_id}"),
        inlines: rich_inlines(&scene_id),
        source: source(&scene_id, "paragraph", None),
    });
    blocks.push(PublicationBlock::Quote {
        id: format!("quote-{scene_id}"),
        inlines: vec![PublicationInline::Text {
            text: "인용 & <문장>".to_owned(),
        }],
        source: source(&scene_id, "quote", None),
    });
    blocks.push(PublicationBlock::SceneBreak {
        id: format!("break-{scene_id}"),
        source: source(&scene_id, "break", None),
    });
    blocks.push(PublicationBlock::Unsupported {
        id: format!("unsupported-{scene_id}"),
        node_type: "custom-block".to_owned(),
        text: "안전한 <fallback> 텍스트".to_owned(),
        source: source(&scene_id, "unsupported", None),
    });
    let parent_titles = match section_number {
        1 | 2 => vec!["작품 <테스트>", "제1화 & 시작"],
        _ => vec!["작품 <테스트>", "제2화 <끝>"],
    };
    serde_json::from_value(serde_json::json!({
        "id": format!("section-{section_number}"),
        "sourceNodeId": scene_id,
        "kind": "SCENE",
        "title": format!("장면 {section_number}"),
        "parentTitles": parent_titles,
        "blocks": blocks,
    }))
    .unwrap()
}

fn inline_text(inlines: &[PublicationInline], output: &mut String) {
    for inline in inlines {
        match inline {
            PublicationInline::Text { text } => output.push_str(text),
            PublicationInline::Strong { children }
            | PublicationInline::Emphasis { children }
            | PublicationInline::Underline { children }
            | PublicationInline::Strike { children }
            | PublicationInline::Ruby { children, .. } => inline_text(children, output),
        }
    }
}

fn statistics(sections: &[PublicationSection]) -> PublicationSourceStatistics {
    let mut with_spaces = 0;
    let mut without_spaces = 0;
    let mut paragraph_count = 0;
    let mut chapters = std::collections::BTreeSet::new();
    for section in sections {
        for block in &section.blocks {
            let mut text = String::new();
            match block {
                PublicationBlock::Heading {
                    level: 3, source, ..
                } => {
                    chapters.insert(source.block_id.clone());
                    continue;
                }
                PublicationBlock::Heading { .. } | PublicationBlock::SceneBreak { .. } => continue,
                PublicationBlock::Paragraph { inlines, .. }
                | PublicationBlock::Quote { inlines, .. } => {
                    paragraph_count += 1;
                    inline_text(inlines, &mut text);
                }
                PublicationBlock::Unsupported { text: value, .. } => text.push_str(value),
            }
            with_spaces += text.chars().count() as u64;
            without_spaces += text
                .chars()
                .filter(|character| !character.is_whitespace())
                .count() as u64;
        }
    }
    PublicationSourceStatistics {
        with_spaces,
        without_spaces,
        paragraph_count,
        scene_count: sections.len() as u64,
        chapter_count: chapters.len() as u64,
    }
}

fn publication() -> PublicationDocument {
    let sections = vec![
        scene(1, Some(("chapter-a", "제1화 & 시작"))),
        scene(2, None),
        scene(3, Some(("chapter-b", "제2화 <끝>"))),
    ];
    let stats = statistics(&sections);
    serde_json::from_value(serde_json::json!({
        "formatVersion": PUBLICATION_DOCUMENT_FORMAT_VERSION,
        "projectId": "project-a",
        "projectRevision": 7,
        "scopeNodeId": "work-a",
        "scopeKind": "WORK",
        "metadata": {
            "title": "작품 <테스트>",
            "authorName": "작가 & 공동",
            "language": "ko",
        },
        "sections": sections,
        "stats": stats,
    }))
    .unwrap()
}

fn hash(document: &PublicationDocument) -> String {
    let canonical = canonical_publication_document(document).unwrap();
    format!("{:x}", Sha256::digest(canonical.as_bytes()))
}

fn options(profile: EpubTargetProfile, split_mode: EpubSplitMode) -> EpubExportOptions {
    EpubExportOptions {
        target_profile: profile,
        split_mode,
        include_cover: false,
        include_scene_titles: true,
        include_chapter_titles: true,
        toc_depth: 4,
        scene_break_style_token: EpubSceneBreakStyleToken::Ornament,
        body_style_token: EpubBodyStyleToken::ReflowableProse,
        stylesheet_token: EpubStylesheetToken::MadiClassic,
    }
}

fn request(
    document: &PublicationDocument,
    profile: EpubTargetProfile,
    split_mode: EpubSplitMode,
    output_path: std::path::PathBuf,
) -> EpubExportRequest {
    EpubExportRequest {
        project_id: document.project_id.clone(),
        scope_node_id: document.scope_node_id.clone(),
        expected_project_revision: document.project_revision,
        source_publication_hash: hash(document),
        metadata: EpubPublicationMetadata {
            title: "출판 제목 <안전>".to_owned(),
            creator_name: "작가 & 공동".to_owned(),
            language: "ko-KR".to_owned(),
            identifier: "urn:madi:project-a".to_owned(),
            publisher: Some("출판사 & Co.".to_owned()),
            description: Some("설명 <script>문자열</script>".to_owned()),
            rights: Some("All rights reserved & 안전".to_owned()),
            subjects: vec!["소설 & 테스트".to_owned()],
        },
        options: options(profile, split_mode),
        output_path,
        replace_existing: false,
        cover: None,
    }
}

fn zip_entries(bytes: &[u8]) -> BTreeMap<String, (CompressionMethod, Vec<u8>)> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut entries = BTreeMap::new();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).unwrap();
        let mut content = Vec::new();
        entry.read_to_end(&mut content).unwrap();
        entries.insert(entry.name().to_owned(), (entry.compression(), content));
    }
    entries
}

fn rewrite_entry<F>(bytes: &[u8], target: &str, mut rewrite: F) -> Vec<u8>
where
    F: FnMut(Vec<u8>) -> Vec<u8>,
{
    let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).unwrap();
        let name = entry.name().to_owned();
        let compression = entry.compression();
        let mut content = Vec::new();
        entry.read_to_end(&mut content).unwrap();
        if name == target {
            content = rewrite(content);
        }
        writer
            .start_file(
                name,
                SimpleFileOptions::default()
                    .compression_method(compression)
                    .last_modified_time(DateTime::default()),
            )
            .unwrap();
        writer.write_all(&content).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

fn replace_once(bytes: Vec<u8>, from: &str, to: &str) -> Vec<u8> {
    let source = String::from_utf8(bytes).unwrap();
    assert!(
        source.contains(from),
        "mutation target was not present: {from}"
    );
    source.replacen(from, to, 1).into_bytes()
}

fn assert_validation_failure(bytes: &[u8], expected_code: &str) {
    let report = validate_epub_bytes(bytes);
    assert_eq!(report.status, EpubValidationStatus::Fail, "{report:?}");
    assert!(
        report
            .messages
            .iter()
            .any(|message| message.code == expected_code),
        "missing {expected_code}: {report:?}"
    );
}

fn jpeg_with_app1_payload(mut jpeg: Vec<u8>, payload: &[u8]) -> Vec<u8> {
    let length = u16::try_from(payload.len() + 2).unwrap();
    let mut segment = vec![0xff, 0xe1];
    segment.extend_from_slice(&length.to_be_bytes());
    segment.extend_from_slice(payload);
    jpeg.splice(2..2, segment);
    jpeg
}

fn run_utility(input: &EpubUtilityInput) -> std::process::Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_madi-export-epub"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(&serde_json::to_vec(input).unwrap())
        .unwrap();
    child.wait_with_output().unwrap()
}

#[test]
fn both_profiles_emit_a_safe_common_subset_with_complete_semantics() {
    let document = publication();
    for profile in [
        EpubTargetProfile::Epub34Draft202608,
        EpubTargetProfile::Epub33Compatibility,
    ] {
        let directory = tempdir().unwrap();
        let request = request(
            &document,
            profile,
            EpubSplitMode::Chapter,
            directory.path().join("작품.epub"),
        );
        let compiled = compile_epub_bytes(&document, &request, &CancellationToken::new()).unwrap();
        assert_eq!(
            compiled.summary.validation_report.status,
            EpubValidationStatus::Pass
        );
        assert_eq!(compiled.summary.statistics.source_block_count, 18);
        assert_eq!(compiled.summary.statistics.exported_block_count, 18);
        assert_eq!(compiled.summary.statistics.fallback_block_count, 3);
        assert_eq!(compiled.summary.statistics.rejected_block_count, 0);
        assert_eq!(
            compiled.summary.statistics.source_character_count,
            compiled.summary.statistics.exported_character_count
        );
        assert_eq!(compiled.summary.statistics.scene_break_count, 3);
        assert_eq!(compiled.summary.statistics.ruby_count, 3);
        let entries = zip_entries(&compiled.bytes);
        assert_eq!(entries["mimetype"].0, CompressionMethod::Stored);
        assert_eq!(entries["mimetype"].1, EPUB_MIMETYPE);
        let opf = String::from_utf8(entries["EPUB/package.opf"].1.clone()).unwrap();
        assert!(opf.contains("version=\"3.0\""));
        assert!(opf.contains("출판 제목 &lt;안전&gt;"));
        let all_xhtml = entries
            .iter()
            .filter(|(path, _)| path.ends_with(".xhtml"))
            .map(|(_, (_, bytes))| String::from_utf8(bytes.clone()).unwrap())
            .collect::<String>();
        assert!(all_xhtml.contains("&lt;script&gt;alert(1)&lt;/script&gt;"));
        assert!(!all_xhtml.contains("<script>"));
        for semantic in [
            "<strong>",
            "<em>",
            "class=\"underline\"",
            "<s>",
            "<ruby>",
            "<rt>",
            "<blockquote",
            "class=\"scene-break\"",
            "class=\"unsupported-fallback\"",
        ] {
            assert!(all_xhtml.contains(semantic), "missing {semantic}");
        }
        let validation =
            validate_epub_against_publication(&compiled.bytes, &document, &request.options);
        assert_eq!(
            validation.status,
            EpubValidationStatus::Pass,
            "{validation:?}"
        );
    }
}

#[test]
fn package_bytes_and_safe_ascii_content_paths_are_deterministic() {
    let document = publication();
    let directory = tempdir().unwrap();
    let request = request(
        &document,
        EpubTargetProfile::Epub33Compatibility,
        EpubSplitMode::Scene,
        directory.path().join("한글 제목.epub"),
    );
    let first = compile_epub_bytes(&document, &request, &CancellationToken::new()).unwrap();
    let second = compile_epub_bytes(&document, &request, &CancellationToken::new()).unwrap();
    assert_eq!(first.bytes, second.bytes);
    assert_eq!(first.summary.sha256, second.summary.sha256);
    assert_eq!(
        first.summary.logical_package_hash,
        second.summary.logical_package_hash
    );
    let entries = zip_entries(&first.bytes);
    let content_paths: Vec<_> = entries
        .keys()
        .filter(|path| path.starts_with("EPUB/text/"))
        .collect();
    assert_eq!(content_paths.len(), 3);
    assert!(content_paths.iter().all(|path| {
        path.chars()
            .all(|character| character.is_ascii_alphanumeric() || "/.-_".contains(character))
            && path.contains("scene-")
            && !path.contains("한글")
    }));
    assert_eq!(&first.bytes[30..38], b"mimetype");
    assert_eq!(u16::from_le_bytes([first.bytes[8], first.bytes[9]]), 0);
    assert_eq!(u16::from_le_bytes([first.bytes[28], first.bytes[29]]), 0);
}

#[test]
fn chapter_and_scene_split_preserve_binder_order() {
    let document = publication();
    let directory = tempdir().unwrap();
    let chapter_request = request(
        &document,
        EpubTargetProfile::Epub34Draft202608,
        EpubSplitMode::Chapter,
        directory.path().join("chapter.epub"),
    );
    let chapter =
        compile_epub_bytes(&document, &chapter_request, &CancellationToken::new()).unwrap();
    let chapter_entries = zip_entries(&chapter.bytes);
    let chapter_paths: Vec<_> = chapter_entries
        .keys()
        .filter(|path| path.starts_with("EPUB/text/"))
        .collect();
    assert_eq!(chapter_paths.len(), 2);
    let first = String::from_utf8(chapter_entries[chapter_paths[0].as_str()].1.clone()).unwrap();
    assert!(first.find("scene-1").unwrap() < first.find("scene-2").unwrap());

    let scene_request = request(
        &document,
        EpubTargetProfile::Epub34Draft202608,
        EpubSplitMode::Scene,
        directory.path().join("scene.epub"),
    );
    let scene_compiled =
        compile_epub_bytes(&document, &scene_request, &CancellationToken::new()).unwrap();
    assert_eq!(scene_compiled.summary.statistics.xhtml_count, 3);

    let mut with_direct_scene = document.clone();
    let mut direct_scene = scene(4, None);
    direct_scene.parent_titles = with_direct_scene.sections[2].parent_titles.clone();
    direct_scene.blocks.insert(
        0,
        PublicationBlock::Heading {
            id: "heading-volume-boundary".to_owned(),
            level: 2,
            text: "동명 볼륨 경계".to_owned(),
            source: source("scene-4", "heading-volume-boundary", Some("volume-b")),
        },
    );
    with_direct_scene.sections.push(direct_scene);
    with_direct_scene.stats = statistics(&with_direct_scene.sections);
    let direct_request = request(
        &with_direct_scene,
        EpubTargetProfile::Epub34Draft202608,
        EpubSplitMode::Chapter,
        directory.path().join("direct-scene.epub"),
    );
    let direct = compile_epub_bytes(
        &with_direct_scene,
        &direct_request,
        &CancellationToken::new(),
    )
    .unwrap();
    let direct_paths: Vec<_> = zip_entries(&direct.bytes)
        .into_keys()
        .filter(|path| path.starts_with("EPUB/text/"))
        .collect();
    assert_eq!(direct_paths.len(), 3);
    assert!(direct_paths.iter().any(|path| path.contains("scene-")));
}

fn png_cover() -> Vec<u8> {
    png_cover_dimensions(1, 1)
}

fn png_cover_dimensions(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = Vec::new();
    let pixels = vec![0xff; width as usize * height as usize * 4];
    PngEncoder::new(&mut bytes)
        .write_image(&pixels, width, height, ExtendedColorType::Rgba8)
        .unwrap();
    bytes
}

fn jpeg_cover() -> Vec<u8> {
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, 90)
        .encode(&[0x20, 0x40, 0x60], 1, 1, ExtendedColorType::Rgb8)
        .unwrap();
    bytes
}

#[test]
fn png_and_jpeg_covers_are_validated_by_magic_content_and_manifest() {
    let document = publication();
    for (media_type, cover_bytes) in [
        (EpubCoverMediaType::Png, png_cover()),
        (EpubCoverMediaType::Jpeg, jpeg_cover()),
    ] {
        let directory = tempdir().unwrap();
        let mut request = request(
            &document,
            EpubTargetProfile::Epub33Compatibility,
            EpubSplitMode::Chapter,
            directory.path().join("cover.epub"),
        );
        request.options.include_cover = true;
        request.cover = Some(EpubCoverInput {
            media_type,
            original_name: "표지 안전 파일".to_owned(),
            bytes: cover_bytes,
        });
        let compiled = compile_epub_bytes(&document, &request, &CancellationToken::new()).unwrap();
        assert!(compiled.summary.statistics.cover_included);
        assert_eq!(
            compiled.summary.validation_report.status,
            EpubValidationStatus::Pass
        );
        let entries = zip_entries(&compiled.bytes);
        let cover_path = format!(
            "EPUB/images/cover.{}",
            match media_type {
                EpubCoverMediaType::Png => "png",
                EpubCoverMediaType::Jpeg => "jpg",
            }
        );
        assert!(entries.contains_key(&cover_path));
        assert_eq!(entries[&cover_path].0, CompressionMethod::Stored);
    }

    let directory = tempdir().unwrap();
    let mut invalid = request(
        &document,
        EpubTargetProfile::Epub33Compatibility,
        EpubSplitMode::Chapter,
        directory.path().join("invalid.epub"),
    );
    invalid.options.include_cover = true;
    let mut trailing_png = png_cover();
    trailing_png.extend_from_slice(b"MZ");
    invalid.cover = Some(EpubCoverInput {
        media_type: EpubCoverMediaType::Png,
        original_name: "cover.png".to_owned(),
        bytes: trailing_png,
    });
    assert!(matches!(
        compile_epub_bytes(&document, &invalid, &CancellationToken::new()),
        Err(EpubError::InvalidCover(_))
    ));

    invalid.cover = Some(EpubCoverInput {
        media_type: EpubCoverMediaType::Png,
        original_name: "too-wide.png".to_owned(),
        bytes: png_cover_dimensions(10_001, 1),
    });
    assert!(matches!(
        compile_epub_bytes(&document, &invalid, &CancellationToken::new()),
        Err(EpubError::InvalidCover(_))
    ));
}

#[test]
fn cover_metadata_is_sanitized_and_packaged_assets_reject_payloads() {
    let document = publication();
    let directory = tempdir().unwrap();
    let mut request = request(
        &document,
        EpubTargetProfile::Epub33Compatibility,
        EpubSplitMode::Chapter,
        directory.path().join("sanitized-cover.epub"),
    );
    request.options.include_cover = true;
    let payload = b"Exif\0\0MADI-POLYGLOT-MZ";
    request.cover = Some(EpubCoverInput {
        media_type: EpubCoverMediaType::Jpeg,
        original_name: "cover-with-metadata.jpg".to_owned(),
        bytes: jpeg_with_app1_payload(jpeg_cover(), payload),
    });
    let compiled = compile_epub_bytes(&document, &request, &CancellationToken::new()).unwrap();
    let repeated = compile_epub_bytes(&document, &request, &CancellationToken::new()).unwrap();
    assert_eq!(compiled.bytes, repeated.bytes);
    let entries = zip_entries(&compiled.bytes);
    let packaged_cover = &entries["EPUB/images/cover.jpg"].1;
    assert!(
        !packaged_cover
            .windows(payload.len())
            .any(|value| value == payload)
    );

    let mutated = rewrite_entry(&compiled.bytes, "EPUB/images/cover.jpg", |bytes| {
        jpeg_with_app1_payload(bytes, payload)
    });
    let report = validate_epub_bytes(&mutated);
    assert_eq!(report.status, EpubValidationStatus::Fail);
    assert!(
        report
            .messages
            .iter()
            .any(|message| message.code == "EPUB_COVER_BYTES_INVALID")
    );
}

#[test]
fn validator_rejects_arbitrary_css_inline_style_and_invalid_xhtml_language() {
    let document = publication();
    let directory = tempdir().unwrap();
    let request = request(
        &document,
        EpubTargetProfile::Epub33Compatibility,
        EpubSplitMode::Chapter,
        directory.path().join("mutations.epub"),
    );
    let compiled = compile_epub_bytes(&document, &request, &CancellationToken::new()).unwrap();
    let content_path = zip_entries(&compiled.bytes)
        .into_keys()
        .find(|path| path.starts_with("EPUB/text/"))
        .unwrap();

    let arbitrary_css = rewrite_entry(&compiled.bytes, "EPUB/styles/book.css", |_| {
        b"body { display: none; }".to_vec()
    });
    let css_report = validate_epub_bytes(&arbitrary_css);
    assert_eq!(css_report.status, EpubValidationStatus::Fail);
    assert!(
        css_report
            .messages
            .iter()
            .any(|message| message.code == "EPUB_STYLESHEET_UNSAFE")
    );

    let inline_style = rewrite_entry(&compiled.bytes, &content_path, |bytes| {
        String::from_utf8(bytes)
            .unwrap()
            .replacen(
                "<p id=",
                "<p style=\"background:url(https://evil.example/x)\" id=",
                1,
            )
            .into_bytes()
    });
    let style_report = validate_epub_bytes(&inline_style);
    assert_eq!(style_report.status, EpubValidationStatus::Fail);
    assert!(
        style_report
            .messages
            .iter()
            .any(|message| message.code == "EPUB_XHTML_ATTRIBUTE_UNSAFE")
    );

    let invalid_language = rewrite_entry(&compiled.bytes, &content_path, |bytes| {
        String::from_utf8(bytes)
            .unwrap()
            .replace(
                "xml:lang=\"ko-KR\" lang=\"ko-KR\"",
                "xml:lang=\"ko-0\" lang=\"en-a\"",
            )
            .into_bytes()
    });
    let language_report = validate_epub_bytes(&invalid_language);
    assert_eq!(language_report.status, EpubValidationStatus::Fail);
    assert!(
        language_report
            .messages
            .iter()
            .any(|message| message.code == "EPUB_XHTML_LANGUAGE")
    );

    let processing_instruction = rewrite_entry(&compiled.bytes, &content_path, |bytes| {
        String::from_utf8(bytes)
            .unwrap()
            .replacen(
                "?>\n",
                "?>\n<?xml-stylesheet href=\"https://evil.example/book.css\"?>\n",
                1,
            )
            .into_bytes()
    });
    let pi_report = validate_epub_bytes(&processing_instruction);
    assert_eq!(pi_report.status, EpubValidationStatus::Fail);
    assert!(
        pi_report
            .messages
            .iter()
            .any(|message| message.code == "EPUB_XML_PROCESSING_INSTRUCTION")
    );
}

#[test]
fn validator_rejects_removed_or_misnested_wrappers_and_wrong_namespaces() {
    let document = publication();
    let directory = tempdir().unwrap();
    let request = request(
        &document,
        EpubTargetProfile::Epub33Compatibility,
        EpubSplitMode::Chapter,
        directory.path().join("structure-mutations.epub"),
    );
    let compiled = compile_epub_bytes(&document, &request, &CancellationToken::new()).unwrap();
    let content_path = zip_entries(&compiled.bytes)
        .into_keys()
        .find(|path| path.starts_with("EPUB/text/"))
        .unwrap();

    let removed_rootfiles = rewrite_entry(&compiled.bytes, "META-INF/container.xml", |bytes| {
        let bytes = replace_once(bytes, "<rootfiles>", "");
        replace_once(bytes, "</rootfiles>", "")
    });
    assert_validation_failure(&removed_rootfiles, "EPUB_CONTAINER_STRUCTURE");

    let misnested_manifest = rewrite_entry(&compiled.bytes, "EPUB/package.opf", |bytes| {
        let bytes = replace_once(bytes, "</metadata>\n<manifest>", "<manifest>");
        replace_once(
            bytes,
            "</manifest>\n<spine>",
            "</manifest>\n</metadata>\n<spine>",
        )
    });
    assert_validation_failure(&misnested_manifest, "EPUB_PACKAGE_STRUCTURE");

    let removed_head = rewrite_entry(&compiled.bytes, &content_path, |bytes| {
        let bytes = replace_once(bytes, "<head>", "");
        replace_once(bytes, "</head>", "")
    });
    assert_validation_failure(&removed_head, "EPUB_XHTML_STRUCTURE");

    let wrong_container_namespace =
        rewrite_entry(&compiled.bytes, "META-INF/container.xml", |bytes| {
            replace_once(
                bytes,
                "urn:oasis:names:tc:opendocument:xmlns:container",
                "urn:wrong:container",
            )
        });
    assert_validation_failure(&wrong_container_namespace, "EPUB_CONTAINER_STRUCTURE");

    let wrong_package_namespace = rewrite_entry(&compiled.bytes, "EPUB/package.opf", |bytes| {
        replace_once(bytes, "http://www.idpf.org/2007/opf", "urn:wrong:opf")
    });
    assert_validation_failure(&wrong_package_namespace, "EPUB_PACKAGE_STRUCTURE");

    let wrong_xhtml_namespace = rewrite_entry(&compiled.bytes, &content_path, |bytes| {
        replace_once(bytes, "http://www.w3.org/1999/xhtml", "urn:wrong:xhtml")
    });
    assert_validation_failure(&wrong_xhtml_namespace, "EPUB_XHTML_STRUCTURE");
}

#[test]
fn empty_unsupported_blocks_fail_and_fallback_warnings_are_bounded() {
    let mut invalid_document = publication();
    invalid_document.sections[0]
        .blocks
        .push(PublicationBlock::Unsupported {
            id: "unsupported-empty-image".to_owned(),
            node_type: "image".to_owned(),
            text: "   ".to_owned(),
            source: source("scene-1", "unsupported-empty-image", None),
        });
    invalid_document.stats = statistics(&invalid_document.sections);
    let directory = tempdir().unwrap();
    let invalid_request = request(
        &invalid_document,
        EpubTargetProfile::Epub33Compatibility,
        EpubSplitMode::Chapter,
        directory.path().join("empty-unsupported.epub"),
    );
    let Err(EpubError::ValidationFailed(report)) = compile_epub_bytes(
        &invalid_document,
        &invalid_request,
        &CancellationToken::new(),
    ) else {
        panic!("empty unsupported block was not rejected");
    };
    assert!(report.messages.iter().any(|message| {
        message.code == "EPUB_UNSUPPORTED_BLOCK_CONTENT_LOSS"
            && message.source_node_id.as_deref() == Some("scene-1")
    }));

    let mut large_document = publication();
    for index in 0..1_050 {
        large_document.sections[0]
            .blocks
            .push(PublicationBlock::Unsupported {
                id: format!("unsupported-bounded-{index}"),
                node_type: "custom-block".to_owned(),
                text: format!("fallback {index}"),
                source: source("scene-1", &format!("unsupported-bounded-{index}"), None),
            });
    }
    large_document.stats = statistics(&large_document.sections);
    let large_request = request(
        &large_document,
        EpubTargetProfile::Epub33Compatibility,
        EpubSplitMode::Chapter,
        directory.path().join("bounded-warnings.epub"),
    );
    let compiled =
        compile_epub_bytes(&large_document, &large_request, &CancellationToken::new()).unwrap();
    assert_eq!(compiled.summary.validation_report.messages.len(), 1_000);
    assert_eq!(compiled.summary.validation_report.warning_count, 1_000);
    assert_eq!(compiled.summary.statistics.fallback_block_count, 1_053);
}

#[test]
fn hidden_scene_titles_do_not_reappear_in_navigation() {
    let document = publication();
    let directory = tempdir().unwrap();
    let mut request = request(
        &document,
        EpubTargetProfile::Epub33Compatibility,
        EpubSplitMode::Scene,
        directory.path().join("hidden-scenes.epub"),
    );
    request.options.include_scene_titles = false;
    let compiled = compile_epub_bytes(&document, &request, &CancellationToken::new()).unwrap();
    let nav = String::from_utf8(zip_entries(&compiled.bytes)["EPUB/nav.xhtml"].1.clone()).unwrap();
    assert!(!nav.contains("장면 1"));
    assert!(!nav.contains("장면 2"));
    assert!(!nav.contains("장면 3"));
    assert!(nav.contains("작품 &lt;테스트&gt;"));
}

fn rewrite_nav_with_broken_fragments(bytes: &[u8]) -> Vec<u8> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).unwrap();
        let name = entry.name().to_owned();
        let compression = entry.compression();
        let mut content = Vec::new();
        entry.read_to_end(&mut content).unwrap();
        if name == "EPUB/nav.xhtml" {
            content = String::from_utf8(content)
                .unwrap()
                .replace("madi-block-", "missing-id-")
                .into_bytes();
        }
        writer
            .start_file(
                name,
                SimpleFileOptions::default()
                    .compression_method(compression)
                    .last_modified_time(DateTime::default()),
            )
            .unwrap();
        writer.write_all(&content).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

#[test]
fn validator_rejects_broken_navigation_and_unsafe_zip_paths() {
    let document = publication();
    let directory = tempdir().unwrap();
    let request = request(
        &document,
        EpubTargetProfile::Epub33Compatibility,
        EpubSplitMode::Chapter,
        directory.path().join("book.epub"),
    );
    let compiled = compile_epub_bytes(&document, &request, &CancellationToken::new()).unwrap();
    let broken = rewrite_nav_with_broken_fragments(&compiled.bytes);
    let report = validate_epub_bytes(&broken);
    assert_eq!(report.status, EpubValidationStatus::Fail);
    assert!(
        report
            .messages
            .iter()
            .any(|message| message.code == "EPUB_LINK_FRAGMENT_MISSING")
    );

    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    writer
        .start_file(
            "mimetype",
            SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
        )
        .unwrap();
    writer.write_all(EPUB_MIMETYPE).unwrap();
    writer
        .start_file(
            "../evil.xhtml",
            SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
        )
        .unwrap();
    writer.write_all(b"evil").unwrap();
    let unsafe_zip = writer.finish().unwrap().into_inner();
    let unsafe_report = validate_epub_bytes(&unsafe_zip);
    assert_eq!(unsafe_report.status, EpubValidationStatus::Fail);
    assert!(
        unsafe_report
            .messages
            .iter()
            .any(|message| message.code == "EPUB_ZIP_PATH_UNSAFE")
    );
}

#[test]
fn output_is_no_clobber_by_default_and_replaces_only_after_successful_validation() {
    let mut document = publication();
    let directory = tempdir().unwrap();
    let destination = directory.path().join("existing.epub");
    std::fs::write(&destination, b"known-good-old-file").unwrap();
    let mut export_request = request(
        &document,
        EpubTargetProfile::Epub33Compatibility,
        EpubSplitMode::Chapter,
        destination.clone(),
    );
    assert!(matches!(
        export_epub(&document, &export_request, &CancellationToken::new()),
        Err(EpubError::DestinationExists)
    ));
    assert_eq!(std::fs::read(&destination).unwrap(), b"known-good-old-file");

    export_request.replace_existing = true;
    export_request.source_publication_hash = "0".repeat(64);
    assert!(matches!(
        export_epub(&document, &export_request, &CancellationToken::new()),
        Err(EpubError::PublicationMismatch)
    ));
    assert_eq!(std::fs::read(&destination).unwrap(), b"known-good-old-file");

    document.project_revision += 1;
    export_request.expected_project_revision = document.project_revision;
    export_request.source_publication_hash = hash(&document);
    let result = export_epub(&document, &export_request, &CancellationToken::new()).unwrap();
    let new_bytes = std::fs::read(&destination).unwrap();
    assert_ne!(new_bytes, b"known-good-old-file");
    assert_eq!(result.sha256, format!("{:x}", Sha256::digest(&new_bytes)));
    assert_eq!(
        validate_epub_bytes(&new_bytes).status,
        EpubValidationStatus::Pass
    );

    let operation_id = "12345678-1234-1234-1234-123456789abc";
    let mut operation_request = request(
        &document,
        EpubTargetProfile::Epub33Compatibility,
        EpubSplitMode::Chapter,
        directory.path().join("operation.epub"),
    );
    operation_request.expected_project_revision = document.project_revision;
    operation_request.source_publication_hash = hash(&document);
    let temporary_path = operation_temporary_path(&operation_request, operation_id).unwrap();
    assert_eq!(
        temporary_path.file_name().unwrap().to_string_lossy(),
        ".madi-epub-12345678-1234-1234-1234-123456789abc.tmp"
    );
    export_epub_for_operation_with_progress(
        &document,
        &operation_request,
        operation_id,
        &CancellationToken::new(),
        |_| {},
    )
    .unwrap();
    assert!(operation_request.output_path.exists());
    assert!(!temporary_path.exists());
}

#[test]
fn cancellation_leaves_no_output_and_hidden_titles_keep_block_coverage() {
    let document = publication();
    let directory = tempdir().unwrap();
    let destination = directory.path().join("cancelled.epub");
    let mut request = request(
        &document,
        EpubTargetProfile::Epub34Draft202608,
        EpubSplitMode::Chapter,
        destination.clone(),
    );
    let cancellation = CancellationToken::new();
    cancellation.cancel();
    assert!(matches!(
        export_epub(&document, &request, &cancellation),
        Err(EpubError::Cancelled)
    ));
    assert!(!destination.exists());

    request.options.include_chapter_titles = false;
    request.options.include_scene_titles = false;
    let compiled = compile_epub_bytes(&document, &request, &CancellationToken::new()).unwrap();
    assert_eq!(
        compiled.summary.validation_report.status,
        EpubValidationStatus::Pass
    );
    let xhtml = zip_entries(&compiled.bytes)
        .into_iter()
        .filter(|(path, _)| path.starts_with("EPUB/text/"))
        .map(|(_, (_, bytes))| String::from_utf8(bytes).unwrap())
        .collect::<String>();
    assert!(xhtml.contains("class=\"source-anchor\""));
}

#[test]
fn utility_json_contract_uses_camel_case_base64_and_exact_tokens() {
    let document = publication();
    let directory = tempdir().unwrap();
    let mut request = request(
        &document,
        EpubTargetProfile::Epub34Draft202608,
        EpubSplitMode::Scene,
        directory.path().join("book.epub"),
    );
    request.options.include_cover = true;
    request.options.scene_break_style_token = EpubSceneBreakStyleToken::Rule;
    request.options.body_style_token = EpubBodyStyleToken::SpacedProse;
    request.options.stylesheet_token = EpubStylesheetToken::MadiModern;
    request.cover = Some(EpubCoverInput {
        media_type: EpubCoverMediaType::Png,
        original_name: "cover.png".to_owned(),
        bytes: png_cover(),
    });
    let value = serde_json::to_value(EpubUtilityInput {
        operation_id: "12345678-1234-1234-1234-123456789abc".to_owned(),
        mode: EpubUtilityMode::ValidateOnly,
        document,
        request,
    })
    .unwrap();
    assert_eq!(value["mode"], "VALIDATE_ONLY");
    assert_eq!(
        value["request"]["options"]["targetProfile"],
        "EPUB_3_4_DRAFT_2026_08"
    );
    assert_eq!(value["request"]["options"]["sceneBreakStyleToken"], "RULE");
    assert_eq!(
        value["request"]["options"]["bodyStyleToken"],
        "SPACED_PROSE"
    );
    assert_eq!(
        value["request"]["options"]["stylesheetToken"],
        "MADI_MODERN"
    );
    assert!(value["request"]["cover"]["bytesBase64"].is_string());
    assert!(value["request"].get("replaceExisting").is_some());
    let round_trip: EpubUtilityInput = serde_json::from_value(value).unwrap();
    assert_eq!(round_trip.request.cover.unwrap().bytes, png_cover());

    let error = serde_json::to_value(EpubUtilityMessage::Error {
        code: "VALIDATION_FAILED".to_owned(),
        description: "safe summary".to_owned(),
        validation_report: None,
    })
    .unwrap();
    assert_eq!(error["kind"], "ERROR");
    assert!(error["validationReport"].is_null());
}

#[test]
fn utility_process_emits_content_free_json_lines_and_a_real_epub() {
    let document = publication();
    let directory = tempdir().unwrap();
    let output_path = directory.path().join("utility.epub");
    let input = EpubUtilityInput {
        operation_id: "abcdef12-3456-7890-abcd-ef1234567890".to_owned(),
        mode: EpubUtilityMode::Export,
        request: request(
            &document,
            EpubTargetProfile::Epub33Compatibility,
            EpubSplitMode::Chapter,
            output_path.clone(),
        ),
        document,
    };
    let output = run_utility(&input);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stderr.is_empty());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(!stdout.contains("한국어"));
    assert!(!stdout.contains("<script>"));
    let messages: Vec<serde_json::Value> = stdout
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert!(messages.iter().any(|message| {
        message["kind"] == "PROGRESS" && message["stage"] == "INTERNAL_VALIDATION"
    }));
    let result = messages
        .iter()
        .find(|message| message["kind"] == "RESULT")
        .unwrap();
    assert_eq!(result["mode"], "EXPORT");
    assert_eq!(result["summary"]["validationReport"]["status"], "PASS");
    assert_eq!(
        validate_epub_bytes(&std::fs::read(output_path).unwrap()).status,
        EpubValidationStatus::Pass
    );

    let validate_output_path = directory.path().join("must-not-be-created.epub");
    let validate_input = EpubUtilityInput {
        operation_id: "abcdef12-3456-7890-abcd-ef1234567891".to_owned(),
        mode: EpubUtilityMode::ValidateOnly,
        request: request(
            &input.document,
            EpubTargetProfile::Epub33Compatibility,
            EpubSplitMode::Chapter,
            validate_output_path.clone(),
        ),
        document: input.document.clone(),
    };
    let validate_output = run_utility(&validate_input);
    assert!(validate_output.status.success());
    assert!(validate_output.stderr.is_empty());
    let messages: Vec<serde_json::Value> = String::from_utf8(validate_output.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let result = messages
        .iter()
        .find(|message| message["kind"] == "RESULT")
        .unwrap();
    assert_eq!(result["mode"], "VALIDATE_ONLY");
    assert!(result["outputPath"].is_null());
    assert!(!validate_output_path.exists());
}
