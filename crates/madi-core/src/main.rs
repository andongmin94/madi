use std::fs::{self, OpenOptions};
use std::io::{self, BufReader, BufWriter, Write};
use std::path::PathBuf;
use std::process::ExitCode;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use clap::{Parser, Subcommand};
use madi_core::{
    create_project, inspect_project, load_document, open_project,
    recover_plain_text, save_document, serve, CoreError, CreateProjectParams,
    LoadDocumentParams, OpenProjectParams, RecoverPlainTextParams,
    SaveDocumentParams, SaveDocumentPayload,
};

#[derive(Debug, Parser)]
#[command(name = "madi-core", version, about)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
#[command(rename_all = "kebab-case")]
enum Command {
    /// Run the stdin/stdout JSON-lines JSON-RPC 2.0 sidecar.
    Serve,

    /// Create a new atomic SQLite .madi project.
    CreateProject {
        #[arg(long, alias = "path")]
        file_path: PathBuf,
        #[arg(long)]
        title: String,
        #[arg(long)]
        created_by: Option<String>,
        #[arg(long)]
        project_id: Option<String>,
        #[arg(long)]
        document_id: Option<String>,
        #[arg(long)]
        document_title: Option<String>,
        #[arg(long)]
        editor_engine: Option<String>,
        #[arg(long)]
        editor_engine_commit: Option<String>,
        #[arg(long)]
        editor_schema_version: Option<i64>,
    },

    /// Validate and open an existing .madi project.
    OpenProject {
        #[arg(long, alias = "path")]
        file_path: PathBuf,
    },

    /// Save a document from binary snapshot and UTF-8 recovery files.
    SaveDocument {
        #[arg(long, alias = "path")]
        file_path: PathBuf,
        #[arg(long)]
        document_id: String,
        #[arg(long)]
        title: String,
        #[arg(long)]
        editor_engine: String,
        #[arg(long)]
        editor_engine_commit: String,
        #[arg(long)]
        editor_schema_version: i64,
        #[arg(long)]
        snapshot_file: PathBuf,
        #[arg(long)]
        plain_text_file: PathBuf,
        #[arg(long)]
        expected_revision: Option<i64>,
        #[arg(long)]
        saved_by: Option<String>,
    },

    /// Load a document and print its JSON representation.
    LoadDocument {
        #[arg(long, alias = "path")]
        file_path: PathBuf,
        #[arg(long)]
        document_id: Option<String>,
    },

    /// Print metadata without emitting snapshot or manuscript contents.
    InspectProject {
        #[arg(long, alias = "path")]
        file_path: PathBuf,
    },

    /// Recover plain text to stdout or a newly-created file.
    RecoverPlainText {
        #[arg(long, alias = "path")]
        file_path: PathBuf,
        #[arg(long)]
        document_id: Option<String>,
        #[arg(long)]
        output: Option<PathBuf>,
        /// Print the structured JSON result instead of raw plain text.
        #[arg(long, conflicts_with = "output")]
        json: bool,
    },
}

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            // Errors contain metadata only; manuscript and snapshot values are
            // never interpolated into diagnostics.
            eprintln!("madi-core: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> madi_core::Result<()> {
    match cli.command {
        Command::Serve => {
            let stdin = io::stdin();
            let stdout = io::stdout();
            serve(BufReader::new(stdin.lock()), BufWriter::new(stdout.lock()))
        }
        Command::CreateProject {
            file_path,
            title,
            created_by,
            project_id,
            document_id,
            document_title,
            editor_engine,
            editor_engine_commit,
            editor_schema_version,
        } => print_json(&create_project(CreateProjectParams {
            file_path,
            title,
            created_by,
            project_id,
            document_id,
            document_title,
            editor_engine,
            editor_engine_commit,
            editor_schema_version,
        })?),
        Command::OpenProject { file_path } => {
            print_json(&open_project(OpenProjectParams { file_path })?)
        }
        Command::SaveDocument {
            file_path,
            document_id,
            title,
            editor_engine,
            editor_engine_commit,
            editor_schema_version,
            snapshot_file,
            plain_text_file,
            expected_revision,
            saved_by,
        } => {
            let snapshot = fs::read(snapshot_file)?;
            let plain_text_recovery = fs::read_to_string(plain_text_file)?;
            print_json(&save_document(SaveDocumentParams {
                file_path,
                document: SaveDocumentPayload {
                    id: document_id,
                    project_id: None,
                    title,
                    editor_engine,
                    editor_engine_commit,
                    editor_schema_version,
                    snapshot_base64: BASE64_STANDARD.encode(snapshot),
                    plain_text_recovery,
                },
                expected_revision,
                saved_by,
            })?)
        }
        Command::LoadDocument {
            file_path,
            document_id,
        } => print_json(&load_document(LoadDocumentParams {
            file_path,
            document_id,
        })?),
        Command::InspectProject { file_path } => {
            print_json(&inspect_project(OpenProjectParams { file_path })?)
        }
        Command::RecoverPlainText {
            file_path,
            document_id,
            output,
            json,
        } => {
            let recovered = recover_plain_text(RecoverPlainTextParams {
                file_path,
                document_id,
            })?;
            if let Some(output) = output {
                write_new_recovery_file(&output, recovered.plain_text_recovery.as_bytes())?;
                print_json(&serde_json::json!({
                    "document_id": recovered.document_id,
                    "title": recovered.title,
                    "project_revision": recovered.project_revision,
                    "output": output
                }))
            } else if json {
                print_json(&recovered)
            } else {
                let stdout = io::stdout();
                let mut writer = BufWriter::new(stdout.lock());
                writer.write_all(recovered.plain_text_recovery.as_bytes())?;
                writer.flush()?;
                Ok(())
            }
        }
    }
}

fn print_json(value: &impl serde::Serialize) -> madi_core::Result<()> {
    let stdout = io::stdout();
    let mut writer = BufWriter::new(stdout.lock());
    serde_json::to_writer(&mut writer, value)?;
    writer.write_all(b"\n")?;
    writer.flush()?;
    Ok(())
}

fn write_new_recovery_file(path: &PathBuf, contents: &[u8]) -> madi_core::Result<()> {
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                CoreError::AlreadyExists(path.clone())
            } else {
                CoreError::Io(error)
            }
        })?;
    file.write_all(contents)?;
    file.sync_all()?;
    Ok(())
}
