//! Phase 1D read-only world graph derived from the Phase 1C Story Bible.
//!
//! This module deliberately owns no tables. Cytoscape and layout concepts are
//! renderer concerns; the DTOs here expose only Madi entity/relation semantics.

use std::collections::{HashMap, HashSet};
use std::str::FromStr;

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{CoreError, Result};
use crate::model::*;
use crate::storage::{load_app_meta, open_existing, validate_non_empty};

const ALL_ENTITY_KINDS: [EntityKind; 8] = [
    EntityKind::Character,
    EntityKind::Location,
    EntityKind::Organization,
    EntityKind::Item,
    EntityKind::Event,
    EntityKind::WorldRule,
    EntityKind::Foreshadowing,
    EntityKind::Other,
];

#[derive(Clone)]
struct RelationTypeProjection {
    id: String,
    name: String,
    inverse_name: Option<String>,
    directed: bool,
    color_token: Option<String>,
    is_builtin: bool,
}

fn parse_entity_kind(value: String) -> Result<EntityKind> {
    EntityKind::from_str(&value).map_err(|message| CoreError::Integrity(message.to_owned()))
}

fn parse_entity_status(value: String) -> Result<EntityStatus> {
    EntityStatus::from_str(&value).map_err(|message| CoreError::Integrity(message.to_owned()))
}

fn parse_scene_role(value: String) -> Result<SceneEntityRole> {
    SceneEntityRole::from_str(&value).map_err(|message| CoreError::Integrity(message.to_owned()))
}

fn diagnostic(
    code: WorldGraphDiagnosticCode,
    severity: WorldGraphDiagnosticSeverity,
    record_id: impl Into<Option<String>>,
    message: impl Into<String>,
) -> WorldGraphDiagnostic {
    WorldGraphDiagnostic {
        code,
        severity,
        record_id: record_id.into(),
        message: message.into(),
    }
}

fn load_relation_types(
    connection: &Connection,
    project_id: &str,
) -> Result<Vec<RelationTypeProjection>> {
    let mut statement = connection.prepare(
        "SELECT id, name, inverse_name, directed, color_token, is_builtin
         FROM relation_types
         WHERE project_id = ?1
         ORDER BY is_builtin DESC, name, id",
    )?;
    let rows = statement.query_map([project_id], |row| {
        Ok(RelationTypeProjection {
            id: row.get(0)?,
            name: row.get(1)?,
            inverse_name: row.get(2)?,
            directed: row.get(3)?,
            color_token: row.get(4)?,
            is_builtin: row.get(5)?,
        })
    })?;
    let mut relation_types = Vec::new();
    for row in rows {
        relation_types.push(row?);
    }
    Ok(relation_types)
}

fn load_nodes(connection: &Connection, project_id: &str) -> Result<Vec<WorldGraphNode>> {
    let mut statement = connection.prepare(
        "SELECT id, project_id, name, kind, status, summary, color_token, icon_key
         FROM entities
         WHERE project_id = ?1
         ORDER BY name, id",
    )?;
    let rows = statement.query_map([project_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, Option<String>>(7)?,
        ))
    })?;
    let mut nodes = Vec::new();
    for row in rows {
        let (id, project_id, label, kind, status, summary, color_token, icon_key) = row?;
        nodes.push(WorldGraphNode {
            id,
            project_id,
            label,
            kind: parse_entity_kind(kind)?,
            status: parse_entity_status(status)?,
            summary,
            color_token,
            icon_key,
            aliases: Vec::new(),
            tags: Vec::new(),
            explicit_scene_link_count: 0,
            outgoing_relation_count: 0,
            incoming_relation_count: 0,
            undirected_relation_count: 0,
        });
    }
    Ok(nodes)
}

fn load_aliases(connection: &Connection, project_id: &str) -> Result<HashMap<String, Vec<String>>> {
    let mut statement = connection.prepare(
        "SELECT a.entity_id, a.alias
         FROM entity_aliases a
         JOIN entities e ON e.id = a.entity_id
         WHERE e.project_id = ?1
         ORDER BY a.entity_id, a.alias, a.id",
    )?;
    let rows = statement.query_map([project_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut aliases: HashMap<String, Vec<String>> = HashMap::new();
    for row in rows {
        let (entity_id, alias) = row?;
        aliases.entry(entity_id).or_default().push(alias);
    }
    Ok(aliases)
}

fn load_tags(
    connection: &Connection,
    project_id: &str,
    diagnostics: &mut Vec<WorldGraphDiagnostic>,
) -> Result<HashMap<String, Vec<WorldGraphTag>>> {
    let mut statement = connection.prepare(
        "SELECT et.entity_id, et.tag_id, e.project_id, t.project_id, t.name, t.color_token
         FROM entity_tags et
         LEFT JOIN entities e ON e.id = et.entity_id
         LEFT JOIN tags t ON t.id = et.tag_id
         WHERE e.project_id = ?1 OR t.project_id = ?1
         ORDER BY et.entity_id, t.name, et.tag_id",
    )?;
    let rows = statement.query_map([project_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<String>>(5)?,
        ))
    })?;
    let mut tags: HashMap<String, Vec<WorldGraphTag>> = HashMap::new();
    for row in rows {
        let (entity_id, tag_id, entity_project, tag_project, name, color_token) = row?;
        if entity_project.as_deref() != Some(project_id)
            || tag_project.as_deref() != Some(project_id)
            || name.is_none()
        {
            diagnostics.push(diagnostic(
                WorldGraphDiagnosticCode::InvalidEntityTag,
                WorldGraphDiagnosticSeverity::Warning,
                Some(format!("{entity_id}:{tag_id}")),
                "entity tag membership does not resolve inside the active project",
            ));
            continue;
        }
        tags.entry(entity_id).or_default().push(WorldGraphTag {
            id: tag_id,
            name: name.expect("checked above"),
            color_token,
        });
    }
    Ok(tags)
}

fn load_edges(
    connection: &Connection,
    project_id: &str,
    relation_types: &[RelationTypeProjection],
    diagnostics: &mut Vec<WorldGraphDiagnostic>,
) -> Result<Vec<WorldGraphEdge>> {
    let type_by_id = relation_types
        .iter()
        .map(|relation_type| (relation_type.id.as_str(), relation_type))
        .collect::<HashMap<_, _>>();
    let mut statement = connection.prepare(
        "SELECT r.id, r.project_id, r.source_entity_id, r.relation_type_id,
                r.target_entity_id, r.note,
                source.project_id, target.project_id, relation_type.project_id
         FROM entity_relations r
         LEFT JOIN entities source ON source.id = r.source_entity_id
         LEFT JOIN entities target ON target.id = r.target_entity_id
         LEFT JOIN relation_types relation_type ON relation_type.id = r.relation_type_id
         WHERE r.project_id = ?1 OR source.project_id = ?1
            OR target.project_id = ?1 OR relation_type.project_id = ?1
         ORDER BY r.id",
    )?;
    let rows = statement.query_map([project_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, Option<String>>(8)?,
        ))
    })?;
    let mut edges = Vec::new();
    let mut undirected_pairs = HashSet::new();
    for row in rows {
        let (
            id,
            relation_project,
            source_entity_id,
            relation_type_id,
            target_entity_id,
            note,
            source_project,
            target_project,
            relation_type_project,
        ) = row?;
        if source_project.is_none() || target_project.is_none() || relation_type_project.is_none() {
            diagnostics.push(diagnostic(
                WorldGraphDiagnosticCode::DanglingRelationMember,
                WorldGraphDiagnosticSeverity::Error,
                Some(id),
                "relation endpoint or relation type is missing",
            ));
            continue;
        }
        if relation_project != project_id
            || source_project.as_deref() != Some(project_id)
            || target_project.as_deref() != Some(project_id)
            || relation_type_project.as_deref() != Some(project_id)
        {
            diagnostics.push(diagnostic(
                WorldGraphDiagnosticCode::CrossProjectRelation,
                WorldGraphDiagnosticSeverity::Error,
                Some(id),
                "relation members do not all belong to the active project",
            ));
            continue;
        }
        if source_entity_id == target_entity_id {
            diagnostics.push(diagnostic(
                WorldGraphDiagnosticCode::SelfRelation,
                WorldGraphDiagnosticSeverity::Error,
                Some(id),
                "self relation is not renderable by the Phase 1D graph",
            ));
            continue;
        }
        let Some(relation_type) = type_by_id.get(relation_type_id.as_str()) else {
            diagnostics.push(diagnostic(
                WorldGraphDiagnosticCode::DanglingRelationMember,
                WorldGraphDiagnosticSeverity::Error,
                Some(id),
                "relation type is unavailable in the active project",
            ));
            continue;
        };
        if !relation_type.directed {
            let (left, right) = if source_entity_id < target_entity_id {
                (&source_entity_id, &target_entity_id)
            } else {
                (&target_entity_id, &source_entity_id)
            };
            let key = (relation_type_id.clone(), left.clone(), right.clone());
            if !undirected_pairs.insert(key) {
                diagnostics.push(diagnostic(
                    WorldGraphDiagnosticCode::DuplicateUndirectedRelation,
                    WorldGraphDiagnosticSeverity::Error,
                    Some(id),
                    "reverse duplicate for an undirected relation was excluded",
                ));
                continue;
            }
        }
        edges.push(WorldGraphEdge {
            id,
            project_id: relation_project,
            source_entity_id,
            target_entity_id,
            relation_type_id,
            forward_label: relation_type.name.clone(),
            inverse_label: relation_type.inverse_name.clone(),
            directed: relation_type.directed,
            color_token: relation_type.color_token.clone(),
            note,
        });
    }
    Ok(edges)
}

fn apply_scene_link_counts(
    connection: &Connection,
    project_id: &str,
    node_index: &HashMap<String, usize>,
    nodes: &mut [WorldGraphNode],
    diagnostics: &mut Vec<WorldGraphDiagnostic>,
) -> Result<()> {
    let mut statement = connection.prepare(
        "SELECT l.scene_node_id, l.entity_id, l.role,
                scene.project_id, scene.kind, entity.project_id
         FROM scene_entity_links l
         LEFT JOIN tree_nodes scene ON scene.id = l.scene_node_id
         LEFT JOIN entities entity ON entity.id = l.entity_id
         WHERE scene.project_id = ?1 OR entity.project_id = ?1
         ORDER BY l.scene_node_id, l.entity_id, l.role",
    )?;
    let rows = statement.query_map([project_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<String>>(5)?,
        ))
    })?;
    for row in rows {
        let (scene_id, entity_id, role, scene_project, scene_kind, entity_project) = row?;
        let valid = scene_project.as_deref() == Some(project_id)
            && scene_kind.as_deref() == Some("SCENE")
            && entity_project.as_deref() == Some(project_id)
            && SceneEntityRole::from_str(&role).is_ok();
        let Some(index) = node_index.get(&entity_id).copied().filter(|_| valid) else {
            diagnostics.push(diagnostic(
                WorldGraphDiagnosticCode::InvalidSceneLink,
                WorldGraphDiagnosticSeverity::Warning,
                Some(format!("{scene_id}:{entity_id}:{role}")),
                "scene link does not resolve to a SCENE and entity in the active project",
            ));
            continue;
        };
        nodes[index].explicit_scene_link_count += 1;
    }
    Ok(())
}

fn build_stats(
    nodes: &[WorldGraphNode],
    edges: &[WorldGraphEdge],
    relation_types: &[RelationTypeProjection],
) -> WorldGraphStats {
    let entity_kind_counts = ALL_ENTITY_KINDS
        .into_iter()
        .map(|kind| WorldGraphEntityKindCount {
            kind,
            count: nodes.iter().filter(|node| node.kind == kind).count() as u64,
        })
        .collect();
    let relation_type_counts = relation_types
        .iter()
        .map(|relation_type| WorldGraphRelationTypeCount {
            relation_type_id: relation_type.id.clone(),
            name: relation_type.name.clone(),
            inverse_name: relation_type.inverse_name.clone(),
            directed: relation_type.directed,
            color_token: relation_type.color_token.clone(),
            is_builtin: relation_type.is_builtin,
            count: edges
                .iter()
                .filter(|edge| edge.relation_type_id == relation_type.id)
                .count() as u64,
        })
        .collect();
    let mut top_degree_entities = nodes
        .iter()
        .filter_map(|node| {
            let degree = node.outgoing_relation_count
                + node.incoming_relation_count
                + node.undirected_relation_count;
            (degree > 0).then(|| WorldGraphDegreeEntry {
                entity_id: node.id.clone(),
                label: node.label.clone(),
                degree,
            })
        })
        .collect::<Vec<_>>();
    top_degree_entities.sort_by(|left, right| {
        right
            .degree
            .cmp(&left.degree)
            .then_with(|| left.label.to_lowercase().cmp(&right.label.to_lowercase()))
            .then_with(|| left.entity_id.cmp(&right.entity_id))
    });
    top_degree_entities.truncate(5);
    WorldGraphStats {
        entity_count: nodes.len() as u64,
        relation_count: edges.len() as u64,
        entity_kind_counts,
        relation_type_counts,
        isolated_entity_count: nodes
            .iter()
            .filter(|node| {
                node.outgoing_relation_count == 0
                    && node.incoming_relation_count == 0
                    && node.undirected_relation_count == 0
            })
            .count() as u64,
        directed_relation_count: edges.iter().filter(|edge| edge.directed).count() as u64,
        undirected_relation_count: edges.iter().filter(|edge| !edge.directed).count() as u64,
        top_degree_entities,
    }
}

fn build_world_graph(
    connection: &Connection,
    project_id: &str,
    revision: i64,
) -> Result<WorldGraphReadModel> {
    let mut diagnostics = Vec::new();
    let relation_types = load_relation_types(connection, project_id)?;
    let mut nodes = load_nodes(connection, project_id)?;
    let node_index = nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id.clone(), index))
        .collect::<HashMap<_, _>>();
    let mut aliases = load_aliases(connection, project_id)?;
    let mut tags = load_tags(connection, project_id, &mut diagnostics)?;
    for node in &mut nodes {
        node.aliases = aliases.remove(&node.id).unwrap_or_default();
        node.tags = tags.remove(&node.id).unwrap_or_default();
    }
    let edges = load_edges(connection, project_id, &relation_types, &mut diagnostics)?;
    for edge in &edges {
        let source_index = node_index
            .get(&edge.source_entity_id)
            .copied()
            .ok_or_else(|| {
                CoreError::Integrity(format!(
                    "validated graph edge {} has no source node",
                    edge.id
                ))
            })?;
        let target_index = node_index
            .get(&edge.target_entity_id)
            .copied()
            .ok_or_else(|| {
                CoreError::Integrity(format!(
                    "validated graph edge {} has no target node",
                    edge.id
                ))
            })?;
        if edge.directed {
            nodes[source_index].outgoing_relation_count += 1;
            nodes[target_index].incoming_relation_count += 1;
        } else {
            nodes[source_index].undirected_relation_count += 1;
            nodes[target_index].undirected_relation_count += 1;
        }
    }
    apply_scene_link_counts(
        connection,
        project_id,
        &node_index,
        &mut nodes,
        &mut diagnostics,
    )?;
    let stats = build_stats(&nodes, &edges, &relation_types);
    Ok(WorldGraphReadModel {
        project_id: project_id.to_owned(),
        revision,
        nodes,
        edges,
        stats,
        diagnostics,
    })
}

/// Return a revision-consistent, full-project graph derived from canonical tables.
pub fn get_world_graph(params: GetWorldGraphParams) -> Result<WorldGraphReadModel> {
    let mut connection = open_existing(&params.file_path)?;
    let graph = {
        let transaction = connection.transaction()?;
        let metadata = load_app_meta(&transaction)?;
        let graph = build_world_graph(&transaction, &metadata.project_id, metadata.revision)?;
        transaction.commit()?;
        graph
    };
    connection.close().map_err(|(_, error)| error)?;
    Ok(graph)
}

pub fn get_world_graph_stats(params: GetWorldGraphStatsParams) -> Result<GetWorldGraphStatsResult> {
    let graph = get_world_graph(params)?;
    Ok(GetWorldGraphStatsResult {
        project_id: graph.project_id,
        revision: graph.revision,
        stats: graph.stats,
        diagnostics: graph.diagnostics,
    })
}

pub fn get_entity_graph_detail(params: GetEntityGraphDetailParams) -> Result<EntityGraphDetail> {
    validate_non_empty("entity_id", &params.entity_id)?;
    let graph = get_world_graph(GetWorldGraphParams {
        file_path: params.file_path,
    })?;
    let entity = graph
        .nodes
        .iter()
        .find(|node| node.id == params.entity_id)
        .cloned()
        .ok_or_else(|| CoreError::NotFound(format!("entity id {}", params.entity_id)))?;
    let mut outgoing_relations = Vec::new();
    let mut incoming_relations = Vec::new();
    let mut undirected_relations = Vec::new();
    for edge in graph.edges {
        if !edge.directed
            && (edge.source_entity_id == params.entity_id
                || edge.target_entity_id == params.entity_id)
        {
            let counterpart_entity_id = if edge.source_entity_id == params.entity_id {
                edge.target_entity_id.clone()
            } else {
                edge.source_entity_id.clone()
            };
            undirected_relations.push(WorldGraphRelationDetail {
                display_label: edge.forward_label.clone(),
                edge,
                counterpart_entity_id,
                perspective: WorldGraphRelationPerspective::Undirected,
            });
        } else if edge.directed && edge.source_entity_id == params.entity_id {
            outgoing_relations.push(WorldGraphRelationDetail {
                counterpart_entity_id: edge.target_entity_id.clone(),
                display_label: edge.forward_label.clone(),
                edge,
                perspective: WorldGraphRelationPerspective::Outgoing,
            });
        } else if edge.directed && edge.target_entity_id == params.entity_id {
            incoming_relations.push(WorldGraphRelationDetail {
                counterpart_entity_id: edge.source_entity_id.clone(),
                display_label: edge
                    .inverse_label
                    .clone()
                    .unwrap_or_else(|| edge.forward_label.clone()),
                edge,
                perspective: WorldGraphRelationPerspective::Incoming,
            });
        }
    }
    Ok(EntityGraphDetail {
        project_id: graph.project_id,
        revision: graph.revision,
        entity,
        outgoing_relations,
        incoming_relations,
        undirected_relations,
    })
}

fn load_entity_scene_links(
    connection: &Connection,
    project_id: &str,
    entity_id: &str,
) -> Result<Vec<WorldGraphSceneLink>> {
    let mut statement = connection.prepare(
        "WITH RECURSIVE ordered(id, path) AS (
             SELECT id, printf('%020.6f:%s', order_key, id)
             FROM tree_nodes
             WHERE project_id = ?1 AND kind = 'WORK' AND parent_id IS NULL
             UNION ALL
             SELECT child.id,
                    ordered.path || '/' || printf('%020.6f:%s', child.order_key, child.id)
             FROM tree_nodes child JOIN ordered ON child.parent_id = ordered.id
             WHERE child.project_id = ?1
         )
         SELECT link.scene_node_id, scene.title, link.role, link.note
         FROM scene_entity_links link
         JOIN entities entity ON entity.id = link.entity_id
         JOIN tree_nodes scene ON scene.id = link.scene_node_id
         JOIN ordered ON ordered.id = scene.id
         WHERE link.entity_id = ?2 AND entity.project_id = ?1
           AND scene.project_id = ?1 AND scene.kind = 'SCENE'
         ORDER BY ordered.path, link.role",
    )?;
    let rows = statement.query_map(params![project_id, entity_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
        ))
    })?;
    let mut links = Vec::new();
    for row in rows {
        let (scene_node_id, scene_title, role, note) = row?;
        links.push(WorldGraphSceneLink {
            scene_node_id,
            scene_title,
            role: parse_scene_role(role)?,
            note,
        });
    }
    Ok(links)
}

pub fn get_entity_scene_context(params: GetEntitySceneContextParams) -> Result<EntitySceneContext> {
    validate_non_empty("entity_id", &params.entity_id)?;
    let mut connection = open_existing(&params.file_path)?;
    let context = {
        let transaction = connection.transaction()?;
        let metadata = load_app_meta(&transaction)?;
        let exists = transaction
            .query_row(
                "SELECT 1 FROM entities WHERE id = ?1 AND project_id = ?2",
                params![params.entity_id, metadata.project_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !exists {
            return Err(CoreError::NotFound(format!(
                "entity id {}",
                params.entity_id
            )));
        }
        let links = load_entity_scene_links(&transaction, &metadata.project_id, &params.entity_id)?;
        let context = EntitySceneContext {
            project_id: metadata.project_id,
            revision: metadata.revision,
            entity_id: params.entity_id,
            links,
        };
        transaction.commit()?;
        context
    };
    connection.close().map_err(|(_, error)| error)?;
    Ok(context)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corrupt_relations_are_diagnosed_and_never_duplicated_or_cross_projected() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE entities (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
                    kind TEXT NOT NULL, status TEXT NOT NULL, summary TEXT,
                    color_token TEXT, icon_key TEXT
                 );
                 CREATE TABLE relation_types (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
                    inverse_name TEXT, directed INTEGER NOT NULL, color_token TEXT,
                    is_builtin INTEGER NOT NULL
                 );
                 CREATE TABLE entity_relations (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
                    source_entity_id TEXT NOT NULL, relation_type_id TEXT NOT NULL,
                    target_entity_id TEXT NOT NULL, note TEXT
                 );
                 CREATE TABLE entity_aliases (
                    id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, alias TEXT NOT NULL
                 );
                 CREATE TABLE tags (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
                    name TEXT NOT NULL, color_token TEXT
                 );
                 CREATE TABLE entity_tags (entity_id TEXT NOT NULL, tag_id TEXT NOT NULL);
                 CREATE TABLE tree_nodes (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL
                 );
                 CREATE TABLE scene_entity_links (
                    scene_node_id TEXT NOT NULL, entity_id TEXT NOT NULL, role TEXT NOT NULL
                 );
                 INSERT INTO entities VALUES
                    ('a', 'current', 'A', 'CHARACTER', 'ACTIVE', NULL, NULL, NULL),
                    ('b', 'current', 'B', 'LOCATION', 'DRAFT', NULL, NULL, NULL),
                    ('foreign', 'other', 'Foreign', 'OTHER', 'ACTIVE', NULL, NULL, NULL);
                 INSERT INTO entity_aliases VALUES
                    ('alias-a', 'a', 'Alias A'),
                    ('alias-foreign', 'foreign', 'Foreign Alias');
                 INSERT INTO tags VALUES
                    ('tag-current', 'current', 'Current Tag', NULL),
                    ('tag-foreign', 'other', 'Foreign Tag', NULL);
                 INSERT INTO entity_tags VALUES
                    ('a', 'tag-current'),
                    ('a', 'tag-foreign'),
                    ('foreign', 'tag-current');
                 INSERT INTO tree_nodes VALUES
                    ('scene-current', 'current', 'SCENE'),
                    ('chapter-current', 'current', 'CHAPTER'),
                    ('scene-foreign', 'other', 'SCENE');
                 INSERT INTO scene_entity_links VALUES
                    ('scene-current', 'a', 'POV'),
                    ('scene-foreign', 'a', 'POV'),
                    ('chapter-current', 'a', 'RELATED'),
                    ('scene-current', 'foreign', 'APPEARS'),
                    ('scene-current', 'b', 'BROKEN');
                 INSERT INTO relation_types VALUES
                    ('undirected', 'current', '적대', NULL, 0, NULL, 0),
                    ('directed', 'current', '소속', '구성원을 가짐', 1, NULL, 0);
                 INSERT INTO entity_relations VALUES
                    ('01-valid-undirected', 'current', 'a', 'undirected', 'b', NULL),
                    ('02-reverse-duplicate', 'current', 'b', 'undirected', 'a', NULL),
                    ('03-self', 'current', 'a', 'directed', 'a', NULL),
                    ('04-cross', 'current', 'a', 'directed', 'foreign', NULL),
                    ('05-dangling', 'current', 'a', 'directed', 'missing', NULL);",
            )
            .unwrap();
        let nodes = load_nodes(&connection, "current").unwrap();
        assert_eq!(
            nodes
                .iter()
                .map(|node| node.id.as_str())
                .collect::<Vec<_>>(),
            vec!["a", "b"]
        );
        let mut diagnostics = Vec::new();
        let aliases = load_aliases(&connection, "current").unwrap();
        assert_eq!(aliases.get("a").unwrap(), &["Alias A"]);
        assert!(!aliases.contains_key("foreign"));
        let tags = load_tags(&connection, "current", &mut diagnostics).unwrap();
        assert_eq!(tags.get("a").unwrap()[0].id, "tag-current");
        assert_eq!(tags.get("a").unwrap().len(), 1);
        assert!(diagnostics
            .iter()
            .any(|item| item.code == WorldGraphDiagnosticCode::InvalidEntityTag));
        let node_index = nodes
            .iter()
            .enumerate()
            .map(|(index, node)| (node.id.clone(), index))
            .collect::<HashMap<_, _>>();
        let mut nodes = nodes;
        apply_scene_link_counts(
            &connection,
            "current",
            &node_index,
            &mut nodes,
            &mut diagnostics,
        )
        .unwrap();
        assert_eq!(nodes[0].explicit_scene_link_count, 1);
        assert_eq!(nodes[1].explicit_scene_link_count, 0);
        assert!(diagnostics
            .iter()
            .any(|item| item.code == WorldGraphDiagnosticCode::InvalidSceneLink));
        let relation_types = load_relation_types(&connection, "current").unwrap();
        let edges = load_edges(&connection, "current", &relation_types, &mut diagnostics).unwrap();
        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].id, "01-valid-undirected");
        assert!(diagnostics
            .iter()
            .any(|item| { item.code == WorldGraphDiagnosticCode::DuplicateUndirectedRelation }));
        assert!(diagnostics
            .iter()
            .any(|item| item.code == WorldGraphDiagnosticCode::SelfRelation));
        assert!(diagnostics
            .iter()
            .any(|item| item.code == WorldGraphDiagnosticCode::CrossProjectRelation));
        assert!(diagnostics
            .iter()
            .any(|item| item.code == WorldGraphDiagnosticCode::DanglingRelationMember));
    }
}
