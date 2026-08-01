use std::io::{BufRead, Write};

use serde_json::{json, Value};

use crate::error::{CoreError, Result};
use crate::model::{
    CreateProjectParams, LoadDocumentParams, OpenProjectParams,
    RecoverPlainTextParams, SaveDocumentParams,
};
use crate::storage::{
    create_project, inspect_project, load_document, open_project,
    recover_plain_text, save_document,
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
        CoreError::InvalidInput(
            "RPC params do not match the method schema".to_owned(),
        )
    })
}

fn rpc_error(error: &CoreError, method: &str) -> (i64, String) {
    match error {
        CoreError::InvalidInput(_) | CoreError::Json(_) => {
            (-32602, error.to_string())
        }
        CoreError::MethodNotFound(_) => {
            (-32601, format!("Method not found: {method}"))
        }
        CoreError::RevisionConflict { .. } => (-32001, error.to_string()),
        CoreError::AlreadyExists(_) => (-32002, error.to_string()),
        CoreError::NotFound(_) => (-32004, error.to_string()),
        CoreError::NotMadiFile { .. }
        | CoreError::UnsupportedSchema { .. }
        | CoreError::UnsupportedFormat { .. }
        | CoreError::Integrity(_) => (-32010, error.to_string()),
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
        let input =
            r#"{"jsonrpc":"2.0","method":"missing","params":{}}"#;
        let mut output = Vec::new();

        serve(Cursor::new(input.as_bytes()), &mut output).unwrap();

        assert!(output.is_empty());
    }
}
