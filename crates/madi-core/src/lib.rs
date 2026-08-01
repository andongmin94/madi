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
pub mod workspace;

pub use error::{CoreError, Result};
pub use model::{
    AppMeta, ApplyReplacementBatchParams, ApplyReplacementBatchResult,
    CreateNamedSnapshotParams, CreateNamedSnapshotResult, CreateProjectParams,
    CreateProjectResult, CreateTreeNodeParams, CreateTreeNodeResult,
    DeleteNamedSnapshotParams, DeleteNamedSnapshotResult, DeleteTreeNodeParams,
    DeleteTreeNodeResult, DiffNamedSnapshotParams, DiffNamedSnapshotResult,
    DocumentRecord, DocumentSummary, GetTextStatisticsParams, InspectProjectParams,
    ListDescendantScenesParams, ListDescendantScenesResult, ListNamedSnapshotsParams,
    ListNamedSnapshotsResult, LoadDocumentParams, LoadProjectTreeParams, LoadSceneParams,
    LoadUiStateParams, LoadUiStateResult, MigrationRecord, MoveTreeNodeParams,
    NamedSnapshotKind, NamedSnapshotSummary, NodeKind, OpenProjectParams,
    ProjectInspection, ProjectRecord, ProjectTree, RecoverPlainTextParams,
    RecoverPlainTextResult, RenameNamedSnapshotParams, RenameNamedSnapshotResult,
    RenameTreeNodeParams, ReorderTreeNodeParams, RestoreNamedSnapshotParams,
    RestoreNamedSnapshotResult, SaveDocumentParams, SaveDocumentPayload,
    SaveDocumentResult, SaveSceneParams, SaveSceneResult, SaveUiStateParams,
    SaveUiStateResult, SceneDocumentPreview, SceneRecord, SceneTextStatistics,
    SceneWorkspaceRecord,
    SearchField, SearchHit, SearchProjectParams, SearchProjectResult, SearchTarget,
    SnapshotDiffSummary, SnapshotNodeCounts, TextStatisticsResult,
    TransformedSceneDocument, TreeMutationResult, TreeNode, UiStateRecord,
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
pub use workspace::{
    apply_replacement_batch, create_named_snapshot, delete_named_snapshot,
    diff_named_snapshot, get_text_statistics, list_descendant_scenes,
    list_named_snapshots, rename_named_snapshot, restore_named_snapshot,
    search_project,
};
