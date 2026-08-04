//! Deterministic, reflowable EPUB generation from Madi Publication IR.
//!
//! This crate deliberately depends on `madi-publication`, never on Typie. The
//! public API accepts an already-compiled [`madi_publication::PublicationDocument`]
//! and emits a self-contained EPUB common subset shared by EPUB 3.3 and the
//! EPUB 3.4 draft profile.

mod compiler;
mod model;
mod validator;

pub use compiler::{
    compile_epub_bytes, compile_epub_bytes_with_progress, export_epub,
    export_epub_for_operation_with_progress, export_epub_with_progress, operation_temporary_path,
};
pub use model::{
    CancellationToken, CompiledEpub, EpubBodyStyleToken, EpubCompileSummary, EpubCoverInput,
    EpubCoverMediaType, EpubError, EpubExportOptions, EpubExportRequest, EpubExportResult,
    EpubExportTiming, EpubPackageStatistics, EpubProgressEvent, EpubProgressStage,
    EpubPublicationMetadata, EpubSceneBreakStyleToken, EpubSplitMode, EpubStylesheetToken,
    EpubTargetProfile, EpubUtilityInput, EpubUtilityMessage, EpubUtilityMode,
    EpubValidationMessage, EpubValidationReport, EpubValidationSeverity, EpubValidationStatus,
    Result,
};
pub use validator::{validate_epub_against_publication, validate_epub_bytes};

pub const EPUB_MIMETYPE: &[u8] = b"application/epub+zip";
pub const EPUB_PACKAGE_PATH: &str = "EPUB/package.opf";
pub const EPUB_CONTAINER_PATH: &str = "META-INF/container.xml";
pub const EPUB_NAV_PATH: &str = "EPUB/nav.xhtml";
pub const EPUB_STYLESHEET_PATH: &str = "EPUB/styles/book.css";
