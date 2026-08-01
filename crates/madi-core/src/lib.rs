//! Local-first persistence core for the phase-0 `madi` prototype.
//!
//! The crate deliberately has no networking or telemetry dependencies. Editor
//! snapshots cross the process boundary as base64, but are stored as SQLite
//! BLOBs. Manuscript text is only returned by explicit load/recovery calls.

pub mod error;
pub mod model;
pub mod rpc;
pub mod storage;

pub use error::{CoreError, Result};
pub use model::{
    AppMeta, CreateProjectParams, CreateProjectResult, DocumentRecord, DocumentSummary,
    InspectProjectParams, LoadDocumentParams, MigrationRecord, OpenProjectParams,
    ProjectInspection, RecoverPlainTextParams, RecoverPlainTextResult,
    SaveDocumentParams, SaveDocumentPayload, SaveDocumentResult,
};
pub use rpc::{dispatch, serve};
pub use storage::{
    create_project, inspect_project, load_document, open_project, recover_plain_text,
    save_document, APPLICATION_ID, FORMAT_NAME, FORMAT_VERSION, SCHEMA_VERSION,
};
