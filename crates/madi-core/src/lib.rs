//! Local-first persistence core for the phase-0 `madi` prototype.
//!
//! The crate deliberately has no networking or telemetry dependencies. Editor
//! snapshots cross the process boundary as base64, but are stored as SQLite
//! BLOBs. Manuscript text is only returned by explicit load/recovery calls.

pub mod error;
pub mod hierarchy;
pub mod model;
pub mod rpc;
pub mod storage;

pub use error::{CoreError, Result};
pub use model::{
    AppMeta, CreateProjectParams, CreateProjectResult, CreateTreeNodeParams,
    CreateTreeNodeResult, DeleteTreeNodeParams, DeleteTreeNodeResult, DocumentRecord,
    DocumentSummary, InspectProjectParams, LoadDocumentParams, LoadProjectTreeParams,
    LoadSceneParams, LoadUiStateParams, LoadUiStateResult, MigrationRecord,
    MoveTreeNodeParams, NodeKind, OpenProjectParams, ProjectInspection, ProjectRecord,
    ProjectTree, RecoverPlainTextParams, RecoverPlainTextResult, RenameTreeNodeParams,
    ReorderTreeNodeParams, SaveDocumentParams, SaveDocumentPayload, SaveDocumentResult,
    SaveSceneParams, SaveSceneResult, SaveUiStateParams, SaveUiStateResult, SceneRecord,
    TreeMutationResult, TreeNode, UiStateRecord,
};
pub use hierarchy::{
    create_tree_node, delete_tree_node, load_project_tree, load_scene, load_ui_state,
    move_tree_node, rename_tree_node, reorder_tree_node, save_scene, save_ui_state,
};
pub use rpc::{dispatch, serve};
pub use storage::{
    create_project, inspect_project, load_document, open_project, recover_plain_text,
    save_document, APPLICATION_ID, FORMAT_NAME, FORMAT_VERSION, SCHEMA_VERSION,
};
