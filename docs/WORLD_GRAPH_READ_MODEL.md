# World Graph Read Model

## 목적과 소유권

World Graph는 Story Bible canonical data를 탐색하기 위한 revision-tagged read model이다.
Rust core가 `.madi` SQLite를 읽고 madi DTO를 반환하며 renderer는 SQLite나 Cytoscape
형식을 IPC 경계에서 다루지 않는다. 결정 근거는
[`ADR-0003`](decisions/ADR-0003-world-graph-is-derived-read-model.md)에 있다.

## 입력

- `entities`
- `entity_aliases`
- `tags`, `entity_tags`
- `relation_types`
- `entity_relations`
- `scene_entity_links`

모든 join은 요청한 project ID 범위로 제한한다. relation의 source/target과 type이 같은
project에 속하지 않으면 정상 edge로 내보내지 않는다. canonical write API가 금지하는
self relation이 손상 데이터에서 발견되면 렌더링 edge에서 제외하고 diagnostics에
기록한다.

## 반환 모델

`WorldGraphReadModel`은 project ID, project revision, nodes, edges, stats와 diagnostics를
가진다. node에는 표시 label과 kind/status/summary/color/icon, alias/tag, 명시적 scene
link 수, outgoing/incoming/undirected relation 수가 포함된다. edge에는 canonical
relation ID, 양 끝 entity ID, relation type ID, forward/inverse label, directed flag,
color와 note가 포함된다.

stats는 다음을 계산한다.

- entity와 relation 총수
- kind별 entity 수
- relation type별 relation 수
- isolated entity 수
- directed/undirected relation 수
- degree가 높은 entity 상위 5개

Degree는 directed relation도 탐색 관점에서는 양 끝에 1씩 더하며 undirected relation도
canonical edge 하나를 양 끝 이웃으로 계산한다. isolated는 유효한 canonical relation이
하나도 없는 entity다. scene link 수는 degree에 포함하지 않는다.

## 네 개 read-only 명령

- `get_world_graph`: 전체 node/edge/stats/diagnostics
- `get_world_graph_stats`: graph를 렌더링하지 않고 같은 규칙의 통계
- `get_entity_graph_detail`: 선택 entity의 outgoing/incoming/undirected 관계 상세
- `get_entity_scene_context`: 선택 entity의 명시적 scene link와 lazy mention context

요청은 open session capability를 통해 file path에 연결된다. preload에는 고정된 메서드만
노출하고 임의 RPC method나 filesystem path를 renderer에 노출하지 않는다.

## 방향 의미

Directed edge는 `source_entity_id → target_entity_id`이며 canvas label은 forward label을
쓴다. target 관점 detail은 inverse label을 사용한다. Undirected edge는 canonical relation
ID 하나만 반환하고 양쪽 detail에 같은 관계로 나타난다.

## revision과 갱신

read model의 revision은 graph query가 읽은 project revision이다. renderer는 요청 token과
session ID를 함께 확인하고, 더 새 project revision을 이미 알고 있거나 후속 요청이 시작된
경우 오래된 응답을 버린다. Story Bible canonical 변경 뒤에는 bounded 500/2,000 규모에서
전체 모델을 다시 읽는다.

Main runtime validator의 Phase 1D 상한은 node 500, edge 2,000, alias 합계 1,500,
명시적 scene link 합계 2,000이다. 상한을 넘는 응답을 일부 잘라내지 않고 전체 요청을
명시적으로 거부한다. 더 큰 graph를 위한 pagination/streaming 전략은 후속 Phase에서
별도로 정한다.

## 저장하지 않는 데이터

Cytoscape element, layout scratch data, selection/highlight, pan/zoom과 node position은 read
model이 아니다. 이 중 복원이 필요한 화면 상태만 별도 `world-graph.v1` UI state에
저장하며 project revision과 named snapshot에는 영향을 주지 않는다.
