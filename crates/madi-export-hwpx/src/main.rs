use std::io::{self, Read, Write};
use std::process::ExitCode;

use madi_export_hwpx::{
    CancellationToken, HwpxCompileSummary, HwpxError, HwpxProgressEvent, HwpxUtilityInput,
    HwpxUtilityMessage, HwpxUtilityMode, compile_hwpx_bytes_with_progress,
    export_hwpx_for_operation_with_progress, operation_temporary_path,
};

const MAX_INPUT_BYTES: u64 = 64 * 1024 * 1024;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(()) => ExitCode::FAILURE,
    }
}

fn run() -> Result<(), ()> {
    let mut input_bytes = Vec::new();
    if io::stdin()
        .lock()
        .take(MAX_INPUT_BYTES + 1)
        .read_to_end(&mut input_bytes)
        .is_err()
        || input_bytes.len() as u64 > MAX_INPUT_BYTES
    {
        write_error(
            "INPUT_TOO_LARGE",
            "HWPX utility input exceeds the safe limit.",
        );
        return Err(());
    }
    let input: HwpxUtilityInput = match serde_json::from_slice(&input_bytes) {
        Ok(input) => input,
        Err(_) => {
            write_error("INVALID_JSON", "HWPX utility input is invalid JSON.");
            return Err(());
        }
    };
    let cancellation = CancellationToken::new();
    if operation_temporary_path(&input.request, &input.operation_id).is_err() {
        write_error(
            "INVALID_OPERATION_ID",
            "HWPX operationId or destination path is invalid.",
        );
        return Err(());
    }
    let stdout = io::stdout();
    let mut output = stdout.lock();
    let mode = input.mode;
    let output_existed_before = input.request.output_path.exists();
    let mut progress_write_failed = false;
    let result = match mode {
        HwpxUtilityMode::Export => export_hwpx_for_operation_with_progress(
            &input.document,
            &input.request,
            &input.operation_id,
            &cancellation,
            |event| {
                if write_progress(&mut output, event).is_err() {
                    progress_write_failed = true;
                    cancellation.cancel();
                }
            },
        )
        .map(|result| {
            let output_path = Some(result.output_path);
            let summary = HwpxCompileSummary {
                byte_length: result.byte_length,
                sha256: result.sha256,
                logical_package_hash: result.logical_package_hash,
                package_xml_version: result.package_xml_version,
                source_publication_hash: result.source_publication_hash,
                preset_id: result.preset_id,
                preset_content_hash: result.preset_content_hash,
                font_family: result.font_family,
                validation_report: result.validation_report,
                export_timing: result.export_timing,
                statistics: result.statistics,
            };
            (output_path, summary)
        }),
        HwpxUtilityMode::ValidateOnly => compile_hwpx_bytes_with_progress(
            &input.document,
            &input.request,
            &cancellation,
            |event| {
                if write_progress(&mut output, event).is_err() {
                    progress_write_failed = true;
                    cancellation.cancel();
                }
            },
        )
        .map(|compiled| (None, compiled.summary)),
    };
    if progress_write_failed {
        if mode == HwpxUtilityMode::Export {
            remove_new_export_output(&input.request.output_path, output_existed_before);
        }
        return Err(());
    }
    match result {
        Ok((output_path, summary)) => {
            if mode == HwpxUtilityMode::ValidateOnly {
                write_progress(
                    &mut output,
                    HwpxProgressEvent {
                        stage: madi_export_hwpx::HwpxProgressStage::Complete,
                        completed: 1,
                        total: 1,
                    },
                )
                .map_err(|_| ())?;
            }
            finish_terminal_write(
                write_message(
                    &mut output,
                    &HwpxUtilityMessage::Result {
                        mode,
                        output_path,
                        summary,
                    },
                ),
                mode,
                &input.request.output_path,
                output_existed_before,
            )?;
            Ok(())
        }
        Err(error) => {
            let validation_report = match &error {
                HwpxError::ValidationFailed(report) => Some(report.clone()),
                _ => None,
            };
            write_message(
                &mut output,
                &HwpxUtilityMessage::Error {
                    code: error_code(&error).to_owned(),
                    description: error.to_string(),
                    validation_report,
                },
            )
            .map_err(|_| ())?;
            Err(())
        }
    }
}

fn remove_new_export_output(output_path: &std::path::Path, output_existed_before: bool) {
    if !output_existed_before {
        let _ = std::fs::remove_file(output_path);
    }
}

fn finish_terminal_write(
    write_result: io::Result<()>,
    mode: HwpxUtilityMode,
    output_path: &std::path::Path,
    output_existed_before: bool,
) -> Result<(), ()> {
    if write_result.is_ok() {
        return Ok(());
    }
    if mode == HwpxUtilityMode::Export {
        remove_new_export_output(output_path, output_existed_before);
    }
    Err(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn broken_stdout_cleanup_removes_only_new_owned_output() {
        let directory = tempfile::tempdir().unwrap();
        let new_output = directory.path().join("new.hwpx");
        std::fs::write(&new_output, b"new staging output").unwrap();
        super::remove_new_export_output(&new_output, false);
        assert!(!new_output.exists());

        let prior_output = directory.path().join("prior.hwpx");
        std::fs::write(&prior_output, b"prior caller-owned output").unwrap();
        super::remove_new_export_output(&prior_output, true);
        assert_eq!(
            std::fs::read(&prior_output).unwrap(),
            b"prior caller-owned output"
        );
    }

    #[test]
    fn result_write_failure_removes_new_requested_output() {
        let directory = tempfile::tempdir().unwrap();
        let output = directory.path().join("publication.hwpx");
        std::fs::write(&output, b"completed but unacknowledged staging output").unwrap();
        let broken_pipe = std::io::Error::new(std::io::ErrorKind::BrokenPipe, "closed stdout");
        assert!(
            super::finish_terminal_write(
                Err(broken_pipe),
                madi_export_hwpx::HwpxUtilityMode::Export,
                &output,
                false,
            )
            .is_err()
        );
        assert!(!output.exists());
    }
}

fn write_progress(output: &mut impl Write, event: HwpxProgressEvent) -> io::Result<()> {
    write_message(
        output,
        &HwpxUtilityMessage::Progress {
            stage: event.stage,
            completed: event.completed,
            total: event.total,
        },
    )
}

fn write_error(code: &str, description: &str) {
    let stdout = io::stdout();
    let mut output = stdout.lock();
    let _ = write_message(
        &mut output,
        &HwpxUtilityMessage::Error {
            code: code.to_owned(),
            description: description.to_owned(),
            validation_report: None,
        },
    );
}

fn write_message(output: &mut impl Write, message: &HwpxUtilityMessage) -> io::Result<()> {
    serde_json::to_writer(&mut *output, message)?;
    output.write_all(b"\n")?;
    output.flush()
}

fn error_code(error: &HwpxError) -> &'static str {
    match error {
        HwpxError::InvalidRequest(_) => "INVALID_REQUEST",
        HwpxError::PublicationMismatch => "PUBLICATION_MISMATCH",
        HwpxError::InvalidPublication => "INVALID_PUBLICATION",
        HwpxError::Cancelled => "CANCELLED",
        HwpxError::DestinationExists => "DESTINATION_EXISTS",
        HwpxError::InvalidDestination => "INVALID_DESTINATION",
        HwpxError::Package => "PACKAGE_FAILED",
        HwpxError::ValidationFailed(_) => "VALIDATION_FAILED",
        HwpxError::Output => "OUTPUT_FAILED",
        HwpxError::Json(_) => "INVALID_JSON",
    }
}
