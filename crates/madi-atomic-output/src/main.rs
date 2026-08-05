use madi_atomic_output::{AtomicOutputRequest, AtomicOutputResponse, execute};
use std::io::{self, Read, Write};
use std::process::ExitCode;

const MAX_REQUEST_BYTES: u64 = 64 * 1024;

fn main() -> ExitCode {
    let response =
        read_request()
            .map(execute)
            .unwrap_or_else(|code| AtomicOutputResponse::Failed {
                code: code.to_owned(),
            });
    let stdout = io::stdout();
    let mut output = stdout.lock();
    if serde_json::to_writer(&mut output, &response).is_err()
        || output.write_all(b"\n").is_err()
        || output.flush().is_err()
    {
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}

fn read_request() -> Result<AtomicOutputRequest, &'static str> {
    let mut bytes = Vec::new();
    if io::stdin()
        .lock()
        .take(MAX_REQUEST_BYTES + 1)
        .read_to_end(&mut bytes)
        .is_err()
        || bytes.len() as u64 > MAX_REQUEST_BYTES
    {
        return Err("INVALID_REQUEST");
    }
    serde_json::from_slice(&bytes).map_err(|_| "INVALID_REQUEST")
}
