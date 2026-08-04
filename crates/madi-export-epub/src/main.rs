use std::io::{self, Read, Write};
use std::process::ExitCode;

use madi_export_epub::{
    CancellationToken, EpubCompileSummary, EpubError, EpubProgressEvent, EpubUtilityInput,
    EpubUtilityMessage, EpubUtilityMode, compile_epub_bytes_with_progress,
    export_epub_for_operation_with_progress, operation_temporary_path,
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
            "EPUB utility input exceeds the safe limit.",
        );
        return Err(());
    }
    let input: EpubUtilityInput = match serde_json::from_slice(&input_bytes) {
        Ok(input) => input,
        Err(_) => {
            write_error("INVALID_JSON", "EPUB utility input is invalid JSON.");
            return Err(());
        }
    };
    let cancellation = CancellationToken::new();
    if operation_temporary_path(&input.request, &input.operation_id).is_err() {
        write_error(
            "INVALID_OPERATION_ID",
            "EPUB operationId or destination path is invalid.",
        );
        return Err(());
    }
    let stdout = io::stdout();
    let mut output = stdout.lock();
    let mode = input.mode;
    let result = match mode {
        EpubUtilityMode::Export => {
            let export = export_epub_for_operation_with_progress(
                &input.document,
                &input.request,
                &input.operation_id,
                &cancellation,
                |event| write_progress(&mut output, event),
            );
            export.map(|result| {
                let output_path = Some(result.output_path);
                let summary = EpubCompileSummary {
                    byte_length: result.byte_length,
                    sha256: result.sha256,
                    logical_package_hash: result.logical_package_hash,
                    target_profile: result.target_profile,
                    source_publication_hash: result.source_publication_hash,
                    validation_report: result.validation_report,
                    export_timing: result.export_timing,
                    statistics: result.statistics,
                };
                (output_path, summary)
            })
        }
        EpubUtilityMode::ValidateOnly => compile_epub_bytes_with_progress(
            &input.document,
            &input.request,
            &cancellation,
            |event| write_progress(&mut output, event),
        )
        .map(|compiled| (None, compiled.summary)),
    };
    match result {
        Ok((output_path, summary)) => {
            if mode == EpubUtilityMode::ValidateOnly {
                write_progress(
                    &mut output,
                    EpubProgressEvent {
                        stage: madi_export_epub::EpubProgressStage::Complete,
                        completed: 1,
                        total: 1,
                    },
                );
            }
            write_message(
                &mut output,
                &EpubUtilityMessage::Result {
                    mode,
                    output_path,
                    summary,
                },
            )
            .map_err(|_| ())?;
            Ok(())
        }
        Err(error) => {
            let code = error_code(&error);
            let validation_report = match &error {
                EpubError::ValidationFailed(report) => Some(report.clone()),
                _ => None,
            };
            write_message(
                &mut output,
                &EpubUtilityMessage::Error {
                    code: code.to_owned(),
                    description: error.to_string(),
                    validation_report,
                },
            )
            .map_err(|_| ())?;
            Err(())
        }
    }
}

fn write_progress(output: &mut impl Write, event: EpubProgressEvent) {
    let _ = write_message(
        output,
        &EpubUtilityMessage::Progress {
            stage: event.stage,
            completed: event.completed,
            total: event.total,
        },
    );
}

fn write_error(code: &str, description: &str) {
    let stdout = io::stdout();
    let mut output = stdout.lock();
    let _ = write_message(
        &mut output,
        &EpubUtilityMessage::Error {
            code: code.to_owned(),
            description: description.to_owned(),
            validation_report: None,
        },
    );
}

fn write_message(output: &mut impl Write, message: &EpubUtilityMessage) -> io::Result<()> {
    serde_json::to_writer(&mut *output, message)?;
    output.write_all(b"\n")?;
    output.flush()
}

fn error_code(error: &EpubError) -> &'static str {
    match error {
        EpubError::InvalidRequest(_) => "INVALID_REQUEST",
        EpubError::PublicationMismatch => "PUBLICATION_MISMATCH",
        EpubError::InvalidPublication => "INVALID_PUBLICATION",
        EpubError::InvalidCover(_) => "INVALID_COVER",
        EpubError::Cancelled => "CANCELLED",
        EpubError::DestinationExists => "DESTINATION_EXISTS",
        EpubError::InvalidDestination => "INVALID_DESTINATION",
        EpubError::Package => "PACKAGE_FAILED",
        EpubError::ValidationFailed(_) => "VALIDATION_FAILED",
        EpubError::Output => "OUTPUT_FAILED",
        EpubError::Json(_) => "INVALID_JSON",
    }
}
