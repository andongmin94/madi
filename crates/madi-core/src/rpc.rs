use std::io::{BufRead, Write};

use serde_json::{json, Value};

use crate::error::{CoreError, Result};
use crate::hierarchy::{
    create_tree_node, delete_tree_node, load_project_tree, load_scene, load_ui_state,
    move_tree_node, rename_tree_node, reorder_tree_node, save_scene, save_ui_state,
};
use crate::model::*;
use crate::storage::{
    create_project, inspect_project, load_document, open_project, recover_plain_text, save_document,
};
use crate::story_bible::*;
use crate::workspace::{
    apply_replacement_batch, create_named_snapshot, delete_named_snapshot, diff_named_snapshot,
    get_text_statistics, list_descendant_scenes, list_named_snapshots, rename_named_snapshot,
    restore_named_snapshot, search_project,
};
use crate::world_graph::{
    get_entity_graph_detail, get_entity_scene_context, get_world_graph, get_world_graph_stats,
};

const JSON_RPC_VERSION: &str = "2.0";

enum LineOutcome {
    Response(Value),
    Notification,
}

/// Run the newline-delimited JSON-RPC 2.0 protocol.
///
/// Nothing except protocol responses is written to `writer`. In particular,
/// manuscript text is never emitted as a diagnostic log.
pub fn serve<R: BufRead, W: Write>(reader: R, mut writer: W) -> Result<()> {
    for line_result in reader.lines() {
        let line = line_result?;
        if line.trim().is_empty() {
            continue;
        }

        match process_line(&line) {
            LineOutcome::Response(response) => {
                serde_json::to_writer(&mut writer, &response)?;
                writer.write_all(b"\n")?;
                writer.flush()?;
            }
            LineOutcome::Notification => {}
        }
    }
    Ok(())
}

/// Dispatch one validated method call. This is shared by the sidecar and tests.
pub fn dispatch(method: &str, params: Value) -> Result<Value> {
    match method {
        "create_project" => {
            let request: CreateProjectParams = parse_params(params)?;
            Ok(serde_json::to_value(create_project(request)?)?)
        }
        "open_project" => {
            let request: OpenProjectParams = parse_params(params)?;
            Ok(serde_json::to_value(open_project(request)?)?)
        }
        "save_document" => {
            let request: SaveDocumentParams = parse_params(params)?;
            Ok(serde_json::to_value(save_document(request)?)?)
        }
        "load_document" => {
            let request: LoadDocumentParams = parse_params(params)?;
            Ok(serde_json::to_value(load_document(request)?)?)
        }
        "inspect_project" => {
            let request: OpenProjectParams = parse_params(params)?;
            Ok(serde_json::to_value(inspect_project(request)?)?)
        }
        "recover_plain_text" => {
            let request: RecoverPlainTextParams = parse_params(params)?;
            Ok(serde_json::to_value(recover_plain_text(request)?)?)
        }
        "load_project_tree" => {
            let request: LoadProjectTreeParams = parse_params(params)?;
            Ok(serde_json::to_value(load_project_tree(request)?)?)
        }
        "create_tree_node" => {
            let request: CreateTreeNodeParams = parse_params(params)?;
            Ok(serde_json::to_value(create_tree_node(request)?)?)
        }
        "rename_tree_node" => {
            let request: RenameTreeNodeParams = parse_params(params)?;
            Ok(serde_json::to_value(rename_tree_node(request)?)?)
        }
        "move_tree_node" => {
            let request: MoveTreeNodeParams = parse_params(params)?;
            Ok(serde_json::to_value(move_tree_node(request)?)?)
        }
        "reorder_tree_node" => {
            let request: ReorderTreeNodeParams = parse_params(params)?;
            Ok(serde_json::to_value(reorder_tree_node(request)?)?)
        }
        "delete_tree_node" => {
            let request: DeleteTreeNodeParams = parse_params(params)?;
            Ok(serde_json::to_value(delete_tree_node(request)?)?)
        }
        "load_scene" => {
            let request: LoadSceneParams = parse_params(params)?;
            Ok(serde_json::to_value(load_scene(request)?)?)
        }
        "save_scene" => {
            let request: SaveSceneParams = parse_params(params)?;
            Ok(serde_json::to_value(save_scene(request)?)?)
        }
        "save_ui_state" => {
            let request: SaveUiStateParams = parse_params(params)?;
            Ok(serde_json::to_value(save_ui_state(request)?)?)
        }
        "load_ui_state" => {
            let request: LoadUiStateParams = parse_params(params)?;
            Ok(serde_json::to_value(load_ui_state(request)?)?)
        }
        "list_descendant_scenes" => {
            let request: ListDescendantScenesParams = parse_params(params)?;
            Ok(serde_json::to_value(list_descendant_scenes(request)?)?)
        }
        "search_project" => {
            let request: SearchProjectParams = parse_params(params)?;
            Ok(serde_json::to_value(search_project(request)?)?)
        }
        "get_text_statistics" => {
            let request: GetTextStatisticsParams = parse_params(params)?;
            Ok(serde_json::to_value(get_text_statistics(request)?)?)
        }
        "create_named_snapshot" => {
            let request: CreateNamedSnapshotParams = parse_params(params)?;
            Ok(serde_json::to_value(create_named_snapshot(request)?)?)
        }
        "list_named_snapshots" => {
            let request: ListNamedSnapshotsParams = parse_params(params)?;
            Ok(serde_json::to_value(list_named_snapshots(request)?)?)
        }
        "rename_named_snapshot" => {
            let request: RenameNamedSnapshotParams = parse_params(params)?;
            Ok(serde_json::to_value(rename_named_snapshot(request)?)?)
        }
        "delete_named_snapshot" => {
            let request: DeleteNamedSnapshotParams = parse_params(params)?;
            Ok(serde_json::to_value(delete_named_snapshot(request)?)?)
        }
        "diff_named_snapshot" => {
            let request: DiffNamedSnapshotParams = parse_params(params)?;
            Ok(serde_json::to_value(diff_named_snapshot(request)?)?)
        }
        "restore_named_snapshot" => {
            let request: RestoreNamedSnapshotParams = parse_params(params)?;
            Ok(serde_json::to_value(restore_named_snapshot(request)?)?)
        }
        "apply_replacement_batch" => {
            let request: ApplyReplacementBatchParams = parse_params(params)?;
            Ok(serde_json::to_value(apply_replacement_batch(request)?)?)
        }
        "list_entities" => {
            let request: ListEntitiesParams = parse_params(params)?;
            Ok(serde_json::to_value(list_entities(request)?)?)
        }
        "search_entities" => {
            let request: SearchEntitiesParams = parse_params(params)?;
            Ok(serde_json::to_value(search_entities(request)?)?)
        }
        "create_entity" => {
            let request: CreateEntityParams = parse_params(params)?;
            Ok(serde_json::to_value(create_entity(request)?)?)
        }
        "update_entity" => {
            let request: UpdateEntityParams = parse_params(params)?;
            Ok(serde_json::to_value(update_entity(request)?)?)
        }
        "get_entity_delete_impact" => {
            let request: GetEntityDeleteImpactParams = parse_params(params)?;
            Ok(serde_json::to_value(get_entity_delete_impact(request)?)?)
        }
        "delete_entity" => {
            let request: DeleteEntityParams = parse_params(params)?;
            Ok(serde_json::to_value(delete_entity(request)?)?)
        }
        "load_entity_note" => {
            let request: LoadEntityNoteParams = parse_params(params)?;
            Ok(serde_json::to_value(load_entity_note(request)?)?)
        }
        "save_entity_note" => {
            let request: SaveEntityNoteParams = parse_params(params)?;
            Ok(serde_json::to_value(save_entity_note(request)?)?)
        }
        "list_entity_aliases" => {
            let request: ListEntityAliasesParams = parse_params(params)?;
            Ok(serde_json::to_value(list_entity_aliases(request)?)?)
        }
        "create_entity_alias" => {
            let request: CreateEntityAliasParams = parse_params(params)?;
            Ok(serde_json::to_value(create_entity_alias(request)?)?)
        }
        "delete_entity_alias" => {
            let request: DeleteEntityAliasParams = parse_params(params)?;
            Ok(serde_json::to_value(delete_entity_alias(request)?)?)
        }
        "list_tags" => {
            let request: ListTagsParams = parse_params(params)?;
            Ok(serde_json::to_value(list_tags(request)?)?)
        }
        "list_entity_tags" => {
            let request: ListEntityTagsParams = parse_params(params)?;
            Ok(serde_json::to_value(list_entity_tags(request)?)?)
        }
        "create_tag" => {
            let request: CreateTagParams = parse_params(params)?;
            Ok(serde_json::to_value(create_tag(request)?)?)
        }
        "update_tag" => {
            let request: UpdateTagParams = parse_params(params)?;
            Ok(serde_json::to_value(update_tag(request)?)?)
        }
        "delete_tag" => {
            let request: DeleteTagParams = parse_params(params)?;
            Ok(serde_json::to_value(delete_tag(request)?)?)
        }
        "set_entity_tags" => {
            let request: SetEntityTagsParams = parse_params(params)?;
            Ok(serde_json::to_value(set_entity_tags(request)?)?)
        }
        "list_relation_types" => {
            let request: ListRelationTypesParams = parse_params(params)?;
            Ok(serde_json::to_value(list_relation_types(request)?)?)
        }
        "create_relation_type" => {
            let request: CreateRelationTypeParams = parse_params(params)?;
            Ok(serde_json::to_value(create_relation_type(request)?)?)
        }
        "update_relation_type" => {
            let request: UpdateRelationTypeParams = parse_params(params)?;
            Ok(serde_json::to_value(update_relation_type(request)?)?)
        }
        "delete_relation_type" => {
            let request: DeleteRelationTypeParams = parse_params(params)?;
            Ok(serde_json::to_value(delete_relation_type(request)?)?)
        }
        "list_entity_relations" => {
            let request: ListEntityRelationsParams = parse_params(params)?;
            Ok(serde_json::to_value(list_entity_relations(request)?)?)
        }
        "create_entity_relation" => {
            let request: CreateEntityRelationParams = parse_params(params)?;
            Ok(serde_json::to_value(create_entity_relation(request)?)?)
        }
        "update_entity_relation" => {
            let request: UpdateEntityRelationParams = parse_params(params)?;
            Ok(serde_json::to_value(update_entity_relation(request)?)?)
        }
        "delete_entity_relation" => {
            let request: DeleteEntityRelationParams = parse_params(params)?;
            Ok(serde_json::to_value(delete_entity_relation(request)?)?)
        }
        "list_scene_entity_links" => {
            let request: ListSceneEntityLinksParams = parse_params(params)?;
            Ok(serde_json::to_value(list_scene_entity_links(request)?)?)
        }
        "create_scene_entity_link" => {
            let request: CreateSceneEntityLinkParams = parse_params(params)?;
            Ok(serde_json::to_value(create_scene_entity_link(request)?)?)
        }
        "delete_scene_entity_link" => {
            let request: DeleteSceneEntityLinkParams = parse_params(params)?;
            Ok(serde_json::to_value(delete_scene_entity_link(request)?)?)
        }
        "discover_entity_mentions" => {
            let request: DiscoverEntityMentionsParams = parse_params(params)?;
            Ok(serde_json::to_value(discover_entity_mentions(request)?)?)
        }
        "promote_entity_mention" => {
            let request: PromoteEntityMentionParams = parse_params(params)?;
            Ok(serde_json::to_value(promote_entity_mention(request)?)?)
        }
        "get_world_graph" => {
            let request: GetWorldGraphParams = parse_params(params)?;
            Ok(serde_json::to_value(get_world_graph(request)?)?)
        }
        "get_world_graph_stats" => {
            let request: GetWorldGraphStatsParams = parse_params(params)?;
            Ok(serde_json::to_value(get_world_graph_stats(request)?)?)
        }
        "get_entity_graph_detail" => {
            let request: GetEntityGraphDetailParams = parse_params(params)?;
            Ok(serde_json::to_value(get_entity_graph_detail(request)?)?)
        }
        "get_entity_scene_context" => {
            let request: GetEntitySceneContextParams = parse_params(params)?;
            Ok(serde_json::to_value(get_entity_scene_context(request)?)?)
        }
        _ => Err(CoreError::MethodNotFound(method.to_owned())),
    }
}

fn process_line(line: &str) -> LineOutcome {
    let request = match serde_json::from_str::<Value>(line) {
        Ok(value) => value,
        Err(_) => {
            return LineOutcome::Response(error_response(
                Value::Null,
                -32700,
                "Parse error".to_owned(),
            ))
        }
    };

    let object = match request.as_object() {
        Some(object) => object,
        None => {
            return LineOutcome::Response(error_response(
                Value::Null,
                -32600,
                "Invalid Request".to_owned(),
            ))
        }
    };

    let id = object.get("id").cloned();
    let response_id = id.clone().unwrap_or(Value::Null);
    let jsonrpc_valid = object
        .get("jsonrpc")
        .and_then(Value::as_str)
        .is_some_and(|value| value == JSON_RPC_VERSION);
    let method = object.get("method").and_then(Value::as_str);
    let id_valid = id.as_ref().map_or(true, |value| {
        value.is_null() || value.is_string() || value.is_number()
    });

    if !jsonrpc_valid || method.is_none() || !id_valid {
        return LineOutcome::Response(error_response(
            Value::Null,
            -32600,
            "Invalid Request".to_owned(),
        ));
    }

    let Some(method) = method else {
        return LineOutcome::Response(error_response(
            Value::Null,
            -32600,
            "Invalid Request".to_owned(),
        ));
    };
    let params = object.get("params").cloned().unwrap_or_else(|| json!({}));
    let dispatched = dispatch(method, params);

    if id.is_none() {
        return LineOutcome::Notification;
    }

    match dispatched {
        Ok(result) => LineOutcome::Response(json!({
            "jsonrpc": JSON_RPC_VERSION,
            "id": response_id,
            "result": result
        })),
        Err(error) => {
            let (code, message) = rpc_error(&error, method);
            LineOutcome::Response(error_response(response_id, code, message))
        }
    }
}

fn parse_params<T>(params: Value) -> Result<T>
where
    T: serde::de::DeserializeOwned,
{
    serde_json::from_value(params).map_err(|_| {
        CoreError::InvalidInput("RPC params do not match the method schema".to_owned())
    })
}

fn rpc_error(error: &CoreError, method: &str) -> (i64, String) {
    match error {
        CoreError::InvalidInput(_) | CoreError::Json(_) => (-32602, error.to_string()),
        CoreError::MethodNotFound(_) => (-32601, format!("Method not found: {method}")),
        CoreError::RevisionConflict { .. } | CoreError::SourceContentConflict { .. } => {
            (-32001, error.to_string())
        }
        CoreError::AlreadyExists(_) => (-32002, error.to_string()),
        CoreError::IdentifierConflict { .. } => (-32003, error.to_string()),
        CoreError::NotFound(_) | CoreError::NodeNotFound { .. } => (-32004, error.to_string()),
        CoreError::InvalidHierarchy { .. }
        | CoreError::WorkMutationForbidden { .. }
        | CoreError::NodeKindMismatch { .. } => (-32020, error.to_string()),
        CoreError::RecursiveDeleteRequired { .. } => (-32021, error.to_string()),
        CoreError::InvalidTreePosition { .. } => (-32022, error.to_string()),
        CoreError::NotMadiFile { .. }
        | CoreError::UnsupportedSchema { .. }
        | CoreError::UnsupportedFormat { .. }
        | CoreError::Integrity(_) => (-32010, error.to_string()),
        CoreError::SnapshotIntegrity(_) => (-32030, error.to_string()),
        CoreError::Io(_) | CoreError::Sqlite(_) => {
            (-32000, "madi-core operation failed".to_owned())
        }
    }
}

fn error_response(id: Value, code: i64, message: String) -> Value {
    json!({
        "jsonrpc": JSON_RPC_VERSION,
        "id": id,
        "error": {
            "code": code,
            "message": message
        }
    })
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use serde_json::Value;

    use super::serve;

    #[test]
    fn returns_standard_errors_and_keeps_processing_lines() {
        let input = concat!(
            "{not-json}\n",
            r#"{"jsonrpc":"2.0","id":1,"method":"missing","params":{}}"#,
            "\n",
        );
        let mut output = Vec::new();

        serve(Cursor::new(input.as_bytes()), &mut output).unwrap();

        let output = String::from_utf8(output).unwrap();
        let responses: Vec<Value> = output
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(responses.len(), 2);
        assert_eq!(responses[0]["error"]["code"], -32700);
        assert_eq!(responses[1]["error"]["code"], -32601);
        assert_eq!(responses[1]["id"], 1);
    }

    #[test]
    fn notifications_do_not_write_a_response() {
        let input = r#"{"jsonrpc":"2.0","method":"missing","params":{}}"#;
        let mut output = Vec::new();

        serve(Cursor::new(input.as_bytes()), &mut output).unwrap();

        assert!(output.is_empty());
    }
}
