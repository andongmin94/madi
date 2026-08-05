//! Deterministic HWPX generation from Madi Publication IR.
//!
//! This crate consumes [`madi_publication::PublicationDocument`] exclusively.
//! It never reads editor snapshots, the database, or renderer state.

mod compiler;
mod model;
mod validator;

pub use compiler::{
    compile_hwpx_bytes, compile_hwpx_bytes_with_progress, export_hwpx,
    export_hwpx_for_operation_with_progress, export_hwpx_with_progress, operation_temporary_path,
};
pub use model::{
    CancellationToken, CompiledHwpx, HwpxBodyStyle, HwpxCompileSummary, HwpxError,
    HwpxExportMetadata, HwpxExportOptions, HwpxExportRequest, HwpxExportResult, HwpxExportTiming,
    HwpxHeadingStyle, HwpxHeadingStyles, HwpxLineSpacing, HwpxOrientation, HwpxPackageStatistics,
    HwpxPageNumberPosition, HwpxPageSettings, HwpxPageSizeToken, HwpxProgressEvent,
    HwpxProgressStage, HwpxSceneBreakToken, HwpxSectionSplitMode, HwpxTextAlign, HwpxUtilityInput,
    HwpxUtilityMessage, HwpxUtilityMode, HwpxValidationMessage, HwpxValidationReport,
    HwpxValidationSeverity, HwpxValidationStatus, Result,
};
pub use validator::{validate_hwpx_against_publication, validate_hwpx_bytes};

pub const HWPX_MIMETYPE: &[u8] = b"application/hwp+zip";
pub const HWPX_VERSION_PATH: &str = "version.xml";
pub const HWPX_SETTINGS_PATH: &str = "settings.xml";
pub const HWPX_CONTENT_PATH: &str = "Contents/content.hpf";
pub const HWPX_HEADER_PATH: &str = "Contents/header.xml";
pub const HWPX_SECTION_PATH: &str = "Contents/section0.xml";
pub const HWPX_RDF_PATH: &str = "META-INF/container.rdf";
pub const HWPX_CONTAINER_PATH: &str = "META-INF/container.xml";
pub const HWPX_MANIFEST_PATH: &str = "META-INF/manifest.xml";
pub const HWPX_XML_VERSION: &str = "1.31";
