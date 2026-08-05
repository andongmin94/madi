use std::io::Write;
use std::process::{Command, Output, Stdio};

use madi_export_hwpx::{
    HwpxExportMetadata, HwpxExportOptions, HwpxExportRequest, HwpxUtilityInput, HwpxUtilityMode,
    HwpxValidationStatus, validate_hwpx_against_publication, validate_hwpx_bytes,
};
use madi_publication::{PublicationDocument, canonical_publication_document};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

fn document() -> PublicationDocument {
    serde_json::from_value(json!({
        "formatVersion": 1,
        "projectId": "project-jsonl",
        "projectRevision": 3,
        "scopeNodeId": "work-jsonl",
        "scopeKind": "WORK",
        "metadata": { "title": "JSONL 작품", "authorName": "작가", "language": "ko" },
        "sections": [{
            "id": "section-jsonl",
            "sourceNodeId": "scene-jsonl",
            "kind": "SCENE",
            "title": "장면",
            "parentTitles": ["JSONL 작품", "장"],
            "blocks": [{
                "kind": "PARAGRAPH",
                "id": "paragraph-jsonl",
                "inlines": [{ "kind": "TEXT", "text": "본문" }],
                "source": {
                    "sourceNodeId": "scene-jsonl",
                    "sceneNodeId": "scene-jsonl",
                    "documentId": "document-jsonl",
                    "blockId": "source-paragraph-jsonl",
                    "start": 0,
                    "end": 2,
                    "rangeVerified": true
                }
            }]
        }],
        "stats": {
            "withSpaces": 2,
            "withoutSpaces": 2,
            "paragraphCount": 1,
            "sceneCount": 1,
            "chapterCount": 0
        }
    }))
    .unwrap()
}

fn request(document: &PublicationDocument, output_path: std::path::PathBuf) -> HwpxExportRequest {
    let canonical = canonical_publication_document(document).unwrap();
    HwpxExportRequest {
        project_id: document.project_id.clone(),
        scope_node_id: document.scope_node_id.clone(),
        expected_project_revision: document.project_revision,
        source_publication_hash: format!("{:x}", Sha256::digest(canonical.as_bytes())),
        preset_id: "builtin-jsonl".to_owned(),
        preset_content_hash: "1".repeat(64),
        metadata: HwpxExportMetadata {
            title: "JSONL 작품".to_owned(),
            author_name: "작가".to_owned(),
            subtitle: None,
            genre: None,
            contact: Some("private-contact-must-not-leak".to_owned()),
        },
        options: HwpxExportOptions::default(),
        output_path,
        replace_existing: false,
    }
}

fn run_utility(input: &HwpxUtilityInput) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_madi-export-hwpx"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    serde_json::to_writer(child.stdin.as_mut().unwrap(), input).unwrap();
    child.stdin.as_mut().unwrap().write_all(b"\n").unwrap();
    drop(child.stdin.take());
    child.wait_with_output().unwrap()
}

fn run_utility_with_closed_stdout(input: &HwpxUtilityInput) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_madi-export-hwpx"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    drop(child.stdout.take().unwrap());
    serde_json::to_writer(child.stdin.as_mut().unwrap(), input).unwrap();
    child.stdin.as_mut().unwrap().write_all(b"\n").unwrap();
    drop(child.stdin.take());
    child.wait_with_output().unwrap()
}

fn long_document() -> PublicationDocument {
    let paragraph_text = "가".repeat(281);
    let sections = (0..450)
        .map(|section_index| {
            let blocks = (0..6)
                .map(|block_index| {
                    json!({
                        "kind": "PARAGRAPH",
                        "id": format!("paragraph-{section_index}-{block_index}"),
                        "inlines": [{ "kind": "TEXT", "text": paragraph_text }],
                        "source": {
                            "sourceNodeId": format!("scene-{section_index}"),
                            "sceneNodeId": format!("scene-{section_index}"),
                            "documentId": format!("document-{section_index}"),
                            "blockId": format!("source-{section_index}-{block_index}"),
                            "start": block_index * 281,
                            "end": (block_index + 1) * 281,
                            "rangeVerified": true
                        }
                    })
                })
                .collect::<Vec<_>>();
            json!({
                "id": format!("section-{section_index}"),
                "sourceNodeId": format!("scene-{section_index}"),
                "kind": "SCENE",
                "title": format!("장면 {section_index}"),
                "parentTitles": ["장편", format!("화 {section_index}")],
                "blocks": blocks
            })
        })
        .collect::<Vec<_>>();
    serde_json::from_value(json!({
        "formatVersion": 1,
        "projectId": "project-long",
        "projectRevision": 1,
        "scopeNodeId": "work-long",
        "scopeKind": "WORK",
        "metadata": { "title": "장편", "authorName": "작가", "language": "ko" },
        "sections": sections,
        "stats": {
            "withSpaces": 758700,
            "withoutSpaces": 758700,
            "paragraphCount": 2700,
            "sceneCount": 450,
            "chapterCount": 0
        }
    }))
    .unwrap()
}

fn messages(output: &Output) -> Vec<Value> {
    String::from_utf8(output.stdout.clone())
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

#[test]
fn utility_emits_content_free_jsonl_and_a_valid_atomic_hwpx() {
    let directory = tempfile::tempdir().unwrap();
    let document = document();
    let request = request(&document, directory.path().join("utility.hwpx"));
    let input = HwpxUtilityInput {
        operation_id: "12345678-1234-1234-1234-123456789abc".to_owned(),
        mode: HwpxUtilityMode::Export,
        document: document.clone(),
        request: request.clone(),
    };
    let output = run_utility(&input);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8(output.stdout.clone()).unwrap();
    assert!(!stdout.contains("private-contact-must-not-leak"));
    assert!(!stdout.contains("본문"));
    let messages = messages(&output);
    assert_eq!(messages.last().unwrap()["kind"], "RESULT");
    assert_eq!(messages.last().unwrap()["mode"], "EXPORT");
    assert_eq!(
        messages.last().unwrap()["summary"]["statistics"]["exportedSectionCount"],
        1
    );
    let stages = messages
        .iter()
        .filter_map(|message| message.get("stage").and_then(Value::as_str))
        .collect::<Vec<_>>();
    assert!(stages.contains(&"PUBLICATION_IR"));
    assert!(stages.contains(&"WRITE_OUTPUT"));
    assert_eq!(stages.last().copied(), Some("COMPLETE"));

    let bytes = std::fs::read(&request.output_path).unwrap();
    assert_eq!(
        validate_hwpx_bytes(&bytes).status,
        HwpxValidationStatus::Pass
    );
    assert_eq!(
        validate_hwpx_against_publication(&bytes, &document, &request.options).status,
        HwpxValidationStatus::Pass
    );
    let temporary_path = directory
        .path()
        .join(".madi-hwpx-12345678-1234-1234-1234-123456789abc.tmp");
    assert!(!temporary_path.exists());
}

#[test]
fn validate_only_jsonl_has_no_output_path_and_writes_no_file() {
    let directory = tempfile::tempdir().unwrap();
    let document = document();
    let request = request(&document, directory.path().join("validate-only.hwpx"));
    let input = HwpxUtilityInput {
        operation_id: "abcdefab-cdef-abcd-efab-cdefabcdefab".to_owned(),
        mode: HwpxUtilityMode::ValidateOnly,
        document,
        request: request.clone(),
    };
    let output = run_utility(&input);
    assert!(output.status.success());
    let messages = messages(&output);
    let result = messages.last().unwrap();
    assert_eq!(result["kind"], "RESULT");
    assert_eq!(result["mode"], "VALIDATE_ONLY");
    assert!(result["outputPath"].is_null());
    assert!(!request.output_path.exists());
}

#[test]
fn closed_stdout_cancels_export_and_cleans_owned_temporary_file() {
    let directory = tempfile::tempdir().unwrap();
    let document = long_document();
    let mut request = request(&document, directory.path().join("broken-pipe.hwpx"));
    // Desktop always exports into a newly-created owned staging directory with
    // replaceExisting=true before publishing to the user-selected destination.
    request.replace_existing = true;
    let operation_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    let input = HwpxUtilityInput {
        operation_id: operation_id.to_owned(),
        mode: HwpxUtilityMode::Export,
        document,
        request: request.clone(),
    };
    let output = run_utility_with_closed_stdout(&input);
    assert!(!output.status.success());
    assert!(!request.output_path.exists());
    assert!(
        !directory
            .path()
            .join(format!(".madi-hwpx-{operation_id}.tmp"))
            .exists()
    );
}

#[test]
fn long_work_675k_characters_and_2400_blocks_has_zero_loss() {
    let document = long_document();
    let directory = tempfile::tempdir().unwrap();
    let request = request(&document, directory.path().join("long.hwpx"));
    let started = std::time::Instant::now();
    let compiled = madi_export_hwpx::compile_hwpx_bytes(
        &document,
        &request,
        &madi_export_hwpx::CancellationToken::new(),
    )
    .unwrap();
    let wall_ms = started.elapsed().as_secs_f64() * 1_000.0;
    eprintln!(
        "[hwpx-long-work] wallMs={wall_ms:.2} exporterMs={} bytes={}",
        compiled.summary.export_timing.total_ms, compiled.summary.byte_length,
    );
    assert!(wall_ms < 15_000.0);
    assert_eq!(compiled.summary.statistics.source_section_count, 450);
    assert_eq!(compiled.summary.statistics.exported_section_count, 450);
    assert_eq!(compiled.summary.statistics.source_block_count, 2_700);
    assert_eq!(compiled.summary.statistics.exported_block_count, 2_700);
    assert_eq!(compiled.summary.statistics.fallback_block_count, 0);
    assert_eq!(compiled.summary.statistics.rejected_block_count, 0);
    assert_eq!(compiled.summary.statistics.source_character_count, 758_700);
    assert_eq!(
        compiled.summary.statistics.exported_character_count,
        758_700
    );
    assert_eq!(
        compiled.summary.validation_report.status,
        HwpxValidationStatus::Pass
    );
}
