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
pub mod story_bible;
pub mod workspace;
pub mod world_graph;

pub use error::{CoreError, Result};
pub use hierarchy::{
    create_tree_node, delete_tree_node, load_project_tree, load_scene, load_ui_state,
    move_tree_node, rename_tree_node, reorder_tree_node, save_scene, save_ui_state,
};
pub use model::*;
pub use rpc::{dispatch, serve};
pub use storage::{
    create_project, inspect_project, load_document, open_project, recover_plain_text,
    save_document, APPLICATION_ID, FORMAT_NAME, FORMAT_VERSION, SCHEMA_VERSION,
};
pub use story_bible::*;
pub use workspace::{
    apply_replacement_batch, create_named_snapshot, delete_named_snapshot, diff_named_snapshot,
    get_text_statistics, list_descendant_scenes, list_named_snapshots, rename_named_snapshot,
    restore_named_snapshot, search_project,
};
pub use world_graph::{
    get_entity_graph_detail, get_entity_scene_context, get_world_graph, get_world_graph_stats,
};
