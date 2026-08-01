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

    #[error("tree node was not found: {node_id}")]
    NodeNotFound { node_id: String },

    #[error("{entity} identifier already exists: {id}")]
    IdentifierConflict {
        entity: &'static str,
        id: String,
    },

    #[error("node {node_id} must be {expected}, found {actual}")]
    NodeKindMismatch {
        node_id: String,
        expected: &'static str,
        actual: String,
    },

    #[error("invalid hierarchy: {rule}")]
    InvalidHierarchy { rule: &'static str },

    #[error("{operation} is not allowed for the WORK root")]
    WorkMutationForbidden { operation: &'static str },

    #[error("recursive delete must be explicitly enabled for node {node_id}")]
    RecursiveDeleteRequired { node_id: String },

    #[error("tree position is invalid: {reason}")]
    InvalidTreePosition { reason: &'static str },

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

    #[error("named snapshot integrity check failed: {0}")]
    SnapshotIntegrity(String),

    #[error("revision conflict: expected {expected}, current revision is {actual}")]
    RevisionConflict { expected: i64, actual: i64 },

    #[error("replacement source content changed for scene {scene_id}")]
    SourceContentConflict { scene_id: String },

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}
