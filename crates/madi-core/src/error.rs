use std::path::PathBuf;

use thiserror::Error;

pub type Result<T> = std::result::Result<T, CoreError>;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("invalid input: {0}")]
    InvalidInput(String),

    #[error("project already exists: {}", .0.display())]
    AlreadyExists(PathBuf),

    #[error("project was not found: {0}")]
    NotFound(String),

    #[error("RPC method was not found: {0}")]
    MethodNotFound(String),

    #[error("the file is not a madi SQLite project (application_id={found})")]
    NotMadiFile { found: i64 },

    #[error("unsupported schema version {found}; this build supports up to {supported}")]
    UnsupportedSchema { found: i64, supported: i64 },

    #[error("unsupported format version {found}; this build supports {supported}")]
    UnsupportedFormat { found: i64, supported: i64 },

    #[error("project integrity check failed: {0}")]
    Integrity(String),

    #[error("revision conflict: expected {expected}, current revision is {actual}")]
    RevisionConflict { expected: i64, actual: i64 },

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}
