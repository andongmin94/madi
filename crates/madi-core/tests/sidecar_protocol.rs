use std::io::Write;
use std::process::{Command, Stdio};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tempfile::tempdir;

const DOCUMENT_ID: &str = "sidecar-document";
const PROJECT_ID: &str = "sidecar-project";

fn run_sidecar(lines: &[Value]) -> Vec<Value> {
    let mut child = Command::new(env!("CARGO_BIN_EXE_madi-core"))
        .arg("serve")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    {
        let stdin = child.stdin.as_mut().unwrap();
        for line in lines {
            serde_json::to_writer(&mut *stdin, line).unwrap();
            stdin.write_all(b"\n").unwrap();
        }
    }
    drop(child.stdin.take());
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "sidecar failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        output.stderr.is_empty(),
        "successful sidecar must not log to stderr"
    );
    String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

#[test]
fn json_lines_process_restart_preserves_snapshot_hash_and_recovery_text() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("드래곤을죽이다.madi");
    let file_path = path.to_string_lossy();
    let snapshot = b"fixture\0typie\xffsnapshot";
    let snapshot_base64 = BASE64_STANDARD.encode(snapshot);
    let plain_text = "첫 문장.\n\n* * *\n\n재시작 뒤 문장.";

    let first_process = run_sidecar(&[
        json!({
            "jsonrpc": "2.0",
            "id": "create",
            "method": "create_project",
            "params": {
                "file_path": file_path,
                "title": "드래곤을 죽이다",
                "project_id": PROJECT_ID,
                "document_id": DOCUMENT_ID,
                "editor_engine": "typie",
                "editor_engine_commit": "test-commit",
                "editor_schema_version": 1
            }
        }),
        json!({
            "jsonrpc": "2.0",
            "id": "save",
            "method": "save_document",
            "params": {
                "file_path": file_path,
                "expected_revision": 0,
                "document": {
                    "id": DOCUMENT_ID,
                    "project_id": PROJECT_ID,
                    "title": "1화",
                    "editor_engine": "typie",
                    "editor_engine_commit": "test-commit",
                    "editor_schema_version": 1,
                    "snapshot_base64": snapshot_base64,
                    "plain_text_recovery": plain_text
                }
            }
        }),
    ]);
    assert_eq!(first_process.len(), 2);
    assert_eq!(first_process[0]["id"], "create");
    assert_eq!(first_process[1]["result"]["metadata"]["revision"], 1);

    // The first process has exited and closed every SQLite handle.
    let second_process = run_sidecar(&[
        json!({
            "jsonrpc": "2.0",
            "id": "open",
            "method": "open_project",
            "params": { "path": file_path }
        }),
        json!({
            "jsonrpc": "2.0",
            "id": "inspect",
            "method": "inspect_project",
            "params": { "file_path": file_path }
        }),
        json!({
            "jsonrpc": "2.0",
            "id": "load",
            "method": "load_document",
            "params": {
                "file_path": file_path,
                "document_id": DOCUMENT_ID
            }
        }),
        json!({
            "jsonrpc": "2.0",
            "id": "recover",
            "method": "recover_plain_text",
            "params": {
                "file_path": file_path,
                "document_id": DOCUMENT_ID
            }
        }),
    ]);
    assert_eq!(second_process.len(), 4);
    assert_eq!(second_process[0]["result"]["metadata"]["revision"], 1);
    let inspection_json = second_process[1].to_string();
    assert!(!inspection_json.contains(plain_text));
    assert!(!inspection_json.contains(&snapshot_base64));

    let loaded_base64 = second_process[2]["result"]["snapshot_base64"]
        .as_str()
        .unwrap();
    let loaded_snapshot = BASE64_STANDARD.decode(loaded_base64).unwrap();
    assert_eq!(Sha256::digest(&loaded_snapshot), Sha256::digest(snapshot));
    assert_eq!(
        second_process[2]["result"]["plain_text_recovery"],
        plain_text
    );
    assert_eq!(
        second_process[3]["result"]["plain_text_recovery"],
        plain_text
    );

    let cli_recovery = Command::new(env!("CARGO_BIN_EXE_madi-core"))
        .arg("recover-plain-text")
        .arg("--file-path")
        .arg(&path)
        .arg("--document-id")
        .arg(DOCUMENT_ID)
        .output()
        .unwrap();
    assert!(cli_recovery.status.success());
    assert!(cli_recovery.stderr.is_empty());
    assert_eq!(cli_recovery.stdout, plain_text.as_bytes());
}
