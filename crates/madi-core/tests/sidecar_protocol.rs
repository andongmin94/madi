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
fn json_lines_ui_state_preserves_f64_round_trip_bits() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("float-roundtrip.madi");
    let file_path = path.to_string_lossy();
    let boundary_value = 400.91839804349996_f64;

    let responses = run_sidecar(&[
        json!({
            "jsonrpc": "2.0",
            "id": "create",
            "method": "create_project",
            "params": {
                "file_path": file_path,
                "title": "float round-trip",
                "project_id": PROJECT_ID,
                "document_id": DOCUMENT_ID,
                "editor_engine": "typie",
                "editor_engine_commit": "test-commit",
                "editor_schema_version": 1
            }
        }),
        json!({
            "jsonrpc": "2.0",
            "id": "save-ui",
            "method": "save_ui_state",
            "params": {
                "file_path": file_path,
                "key": "world-graph.v1",
                "value": { "coordinate": boundary_value }
            }
        }),
        json!({
            "jsonrpc": "2.0",
            "id": "load-ui",
            "method": "load_ui_state",
            "params": {
                "file_path": file_path,
                "key": "world-graph.v1"
            }
        }),
    ]);

    for response in &responses[1..=2] {
        let returned = response["result"]["state"]["value"]["coordinate"]
            .as_f64()
            .unwrap();
        assert_eq!(returned.to_bits(), boundary_value.to_bits());
    }
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

#[test]
fn phase_1a_json_rpc_exposes_tree_scene_and_ui_state_methods() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("phase-1a-sidecar.madi");
    let file_path = path.to_string_lossy();
    let created = run_sidecar(&[json!({
        "jsonrpc": "2.0",
        "id": "create",
        "method": "create_project",
        "params": {
            "file_path": file_path,
            "title": "사이드카 작품",
            "author_name": "테스트 작가",
            "project_id": "phase-1a-sidecar-project",
            "document_id": "phase-1a-default-document",
            "editor_engine": "typie",
            "editor_engine_commit": "test-commit",
            "editor_schema_version": 1
        }
    })]);
    let work_id = created[0]["result"]["work_node_id"]
        .as_str()
        .unwrap()
        .to_owned();
    let default_chapter_id = created[0]["result"]["default_chapter_node_id"]
        .as_str()
        .unwrap()
        .to_owned();
    let default_scene_id = created[0]["result"]["default_scene_node_id"]
        .as_str()
        .unwrap()
        .to_owned();
    let manuscript = "RPC를 통한 한글 장면 저장";

    let responses = run_sidecar(&[
        json!({
            "jsonrpc": "2.0",
            "id": "tree",
            "method": "load_project_tree",
            "params": { "file_path": file_path }
        }),
        json!({
            "jsonrpc": "2.0",
            "id": "volume",
            "method": "create_tree_node",
            "params": {
                "file_path": file_path,
                "parent_id": work_id,
                "node_id": "rpc-volume",
                "kind": "VOLUME",
                "title": "1권",
                "expected_revision": 0
            }
        }),
        json!({
            "jsonrpc": "2.0",
            "id": "chapter",
            "method": "create_tree_node",
            "params": {
                "file_path": file_path,
                "parent_id": "rpc-volume",
                "node_id": "rpc-chapter",
                "kind": "CHAPTER",
                "title": "2화",
                "expected_revision": 1
            }
        }),
        json!({
            "jsonrpc": "2.0",
            "id": "move",
            "method": "move_tree_node",
            "params": {
                "file_path": file_path,
                "node_id": "rpc-chapter",
                "new_parent_id": work_id,
                "expected_revision": 2
            }
        }),
        json!({
            "jsonrpc": "2.0",
            "id": "reorder",
            "method": "reorder_tree_node",
            "params": {
                "file_path": file_path,
                "node_id": "rpc-chapter",
                "before_node_id": default_chapter_id,
                "expected_revision": 3
            }
        }),
        json!({
            "jsonrpc": "2.0",
            "id": "rename",
            "method": "rename_tree_node",
            "params": {
                "file_path": file_path,
                "node_id": default_scene_id,
                "title": "RPC 장면",
                "expected_revision": 4
            }
        }),
        json!({
            "jsonrpc": "2.0",
            "id": "save-scene",
            "method": "save_scene",
            "params": {
                "file_path": file_path,
                "scene_id": default_scene_id,
                "editor_engine": "typie",
                "editor_engine_commit": "test-commit",
                "editor_schema_version": 1,
                "snapshot_base64": BASE64_STANDARD.encode(b"rpc-snapshot"),
                "plain_text_recovery": manuscript,
                "expected_revision": 5
            }
        }),
        json!({
            "jsonrpc": "2.0",
            "id": "save-ui",
            "method": "save_ui_state",
            "params": {
                "file_path": file_path,
                "key": "binder",
                "value": { "selected_node_id": default_scene_id }
            }
        }),
        json!({
            "jsonrpc": "2.0",
            "id": "load-ui",
            "method": "load_ui_state",
            "params": { "file_path": file_path, "key": "binder" }
        }),
        json!({
            "jsonrpc": "2.0",
            "id": "load-scene",
            "method": "load_scene",
            "params": {
                "file_path": file_path,
                "scene_id": default_scene_id
            }
        }),
        json!({
            "jsonrpc": "2.0",
            "id": "delete",
            "method": "delete_tree_node",
            "params": {
                "file_path": file_path,
                "node_id": "rpc-chapter",
                "recursive": false,
                "expected_revision": 6
            }
        }),
    ]);

    assert_eq!(responses.len(), 11);
    assert_eq!(responses[0]["result"]["nodes"].as_array().unwrap().len(), 3);
    assert_eq!(responses[1]["result"]["node"]["kind"], "VOLUME");
    assert_eq!(responses[2]["result"]["node"]["kind"], "CHAPTER");
    assert_eq!(responses[3]["result"]["metadata"]["revision"], 3);
    assert_eq!(responses[4]["result"]["metadata"]["revision"], 4);
    assert_eq!(responses[5]["result"]["node"]["title"], "RPC 장면");
    assert_eq!(responses[6]["result"]["metadata"]["revision"], 6);
    assert_eq!(responses[7]["result"]["metadata"]["revision"], 6);
    assert_eq!(
        responses[8]["result"]["state"]["value"]["selected_node_id"],
        default_scene_id
    );
    assert_eq!(
        responses[9]["result"]["document"]["plain_text_recovery"],
        manuscript
    );
    assert_eq!(responses[10]["result"]["metadata"]["revision"], 7);

    let invalid = run_sidecar(&[json!({
        "jsonrpc": "2.0",
        "id": "invalid-hierarchy",
        "method": "create_tree_node",
        "params": {
            "file_path": file_path,
            "parent_id": work_id,
            "node_id": "invalid-direct-scene",
            "kind": "SCENE",
            "title": "invalid",
            "expected_revision": 7
        }
    })]);
    assert_eq!(invalid[0]["error"]["code"], -32020);
    assert!(!invalid[0].to_string().contains(manuscript));

    let rejected_manuscript = "오류나 로그에 노출되면 안 되는 원고";
    let stale_save = run_sidecar(&[json!({
        "jsonrpc": "2.0",
        "id": "stale-save",
        "method": "save_scene",
        "params": {
            "file_path": file_path,
            "scene_id": default_scene_id,
            "editor_engine": "typie",
            "editor_engine_commit": "test-commit",
            "editor_schema_version": 1,
            "snapshot_base64": BASE64_STANDARD.encode(b"rejected"),
            "plain_text_recovery": rejected_manuscript,
            "expected_revision": 0
        }
    })]);
    assert_eq!(stale_save[0]["error"]["code"], -32001);
    assert!(!stale_save[0].to_string().contains(rejected_manuscript));
}
