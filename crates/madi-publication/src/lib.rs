//! Madi-owned, engine-independent publication contracts.
//!
//! Typie storage types are confined to the private `typie_bridge` module. The
//! public API accepts opaque snapshot bytes and returns only Madi DTOs, so
//! Reader Lab and future exporters never depend on Typie internals.

mod compiler;
mod typie_bridge;

pub use compiler::{
    CompileInput, CompileOutput, HeadingInput, PublicationBlock, PublicationDiagnostic,
    PublicationDiagnosticCode, PublicationDiagnosticSeverity, PublicationDocument,
    PublicationInline, PublicationMetadata, PublicationScopeKind, PublicationSection,
    PublicationSourceReference, PublicationSourceStatistics, SceneInput,
    canonical_publication_document, compile_publication, validate_publication_document,
};
pub use typie_bridge::{
    MadiSemanticBlock, MadiSemanticDocument, MadiSemanticInline, MadiSemanticSource,
    decode_typie_snapshot,
};

use thiserror::Error;

pub const PUBLICATION_DOCUMENT_FORMAT_VERSION: i64 = 1;
pub const PINNED_TYPIE_COMMIT: &str = "fbe5c4bf860d1717a66e66bea2374a2e39f0dd26";
pub const SUPPORTED_TYPIE_SCHEMA_VERSION: i64 = 1;
pub const SCENE_BREAK_SEMANTIC_ID: &str = "madi.scene-break.v1";

pub type Result<T> = std::result::Result<T, PublicationError>;

#[derive(Debug, Error)]
pub enum PublicationError {
    #[error("Typie snapshot is not losslessly decodable")]
    LossySnapshot,
    #[error("Typie snapshot could not be decoded")]
    SnapshotDecode,
    #[error("Typie snapshot contains unresolved changesets")]
    UnresolvedChangesets,
    #[error("Typie snapshot projection failed")]
    Projection,
    #[error("Typie snapshot projection is degraded or incomplete")]
    DegradedProjection,
    #[error("publication input is invalid: {0}")]
    InvalidInput(String),
    #[error("publication document is invalid: {0}")]
    InvalidDocument(String),
    #[error("publication JSON serialization failed")]
    Serialization(#[from] serde_json::Error),
}
