# `.madi` 파일 포맷 v1 초안

기준일: 2026-08-09

```text
Specification status: DRAFT
Logical format version: 1
SQLite schema version: 6
Implementation conformance: PHASE 1F READER PRESET/PUBLICATION CORE DATA
Migration/core-sidecar round-trip: SCHEMA 5 → 6
```

이 문서는 Phase 1A의 저장 계약, Phase 1B의 exact search/named snapshot 확장,
Phase 1C의 Story Bible 저장 계약, Phase 1D의 파생 World Graph UI state 경계와 Phase
1E의 작가 소유 Plot Canvas 저장 계약, Phase 1F의 canonical Reader preset과 read-only
Publication compiler 경계를 기록한다. 이 명세의 문구만으로 구현 적합성을 증명하지
않으며, 실행 증거와 제한은 각 Phase 결과 문서를 따른다. 배포 전에는
구현과 fixture를 다시 대조해 이 초안을 확정 문서로 승격해야 한다.

`MUST`, `MUST NOT`, `SHOULD`는 각각 필수, 금지, 권고 요구사항이다.

## 1. 식별과 version

- 확장자: `.madi`
- 실제 container: SQLite 3
- SQLite header: `SQLite format 3\0`
- `PRAGMA application_id`: `0x4D414449` (`MADI`, decimal `1296122953`)
- `app_meta.format_name`: `madi`
- `app_meta.format_version`: `1`
- `app_meta.schema_version`: `6`
- `PRAGMA user_version`: `6`

v0의 `application_id`와 container는 바꾸지 않는다. 확장자만 `.madi`인 임의
SQLite 파일, 다른 `application_id`, 알 수 없는 format 또는 지원 값보다 높은
schema는 쓰기 모드로 열지 않는다.

## 2. v0에서 유지하는 table

다음 table의 v0 column과 의미를 유지한다.

- `app_meta`
- `documents`
- `schema_migrations`

v1은 기존 row를 버리거나 snapshot을 다른 임시 형식으로 바꾸지 않는다.

### `app_meta`의 v1 의미

- `project_id`는 `projects.id`와 일치한다.
- `title`은 `projects.title` 및 root WORK title과 일치한다.
- `revision`은 성공한 canonical tree/document mutation마다 정확히 한 번 증가하는
  project-wide optimistic concurrency token이다.
- UI state만 바뀐 경우 canonical manuscript revision은 증가시키지 않는다.
- `created_by`, `last_saved_by`는 앱/core version 식별자이며 사용자 계정이 아니다.

### `documents`의 v1 의미

- 모든 document는 같은 project의 SCENE 또는 entity 하나와 정확히 1:1로 연결된다.
- 하나의 document를 SCENE과 entity가 공유할 수 없다.
- `documents.title`은 연결 SCENE 또는 entity name과 일치한다.
- `snapshot_blob`은 base64 text가 아니라 원본 Typie changeset bundle bytes다.
- `plain_text_recovery`는 사람이 읽을 수 있는 UTF-8 긴급 복구 copy다.
- `editor_engine`, `editor_engine_commit`, `editor_schema_version`은 snapshot을 해석할
  adapter identity다.
- `madi.scene-break.v1`은 Typie snapshot의 의미 node로 보존하고 recovery에서는
  기존 계약대로 `\n\n***\n\n` marker가 된다.

새 SCENE 또는 entity note document는 adapter가 첫 editor instance를 만들기 전까지
`editor_engine_commit = 'uninitialized'`와 빈 snapshot payload를 가질 수 있다.
빈 payload를 유효한 Typie snapshot이라고 가장하지 않는다. 최초 load 시 adapter가
빈 document를 만들고 최초 성공 save에서 실제 commit/schema/snapshot을 기록한다.

Phase 1F Publication compiler는 `plain_text_recovery`를 semantic fallback으로 사용하지
않는다. `editor_engine = typie`, pinned commit
`fbe5c4bf860d1717a66e66bea2374a2e39f0dd26`, schema version `1`인 snapshot만 private
`madi-publication` bridge에서 lossless decode한다. Unknown/lossy/degraded projection은
read-only compile 오류 또는 code diagnostic이며 원고나 database를 수정하지 않는다.

## 3. schema v6

Schema 6은 Phase 1A schema 2의 `projects`, `tree_nodes`, `ui_state`, Phase 1B schema 3의
exact-search projection과 named logical snapshot table, Phase 1C schema 4의 Story Bible
table, Phase 1E schema 5의 `canvases` table을 그대로 유지하고 Phase 1F의
`reader_presets` table을 추가한다. 아래 SQL은 v1의 목표 schema다. 실제 migration은
`IF NOT EXISTS`만으로 성공을 판정하지 않고 migration record와 전체 불변식을 함께
검증해야 한다.

### `projects`

```sql
CREATE TABLE projects (
    id TEXT NOT NULL PRIMARY KEY,
    title TEXT NOT NULL,
    author_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (id) REFERENCES app_meta(project_id) ON DELETE CASCADE
);
```

규칙:

- 한 `.madi`에는 `app_meta`와 대응하는 project가 정확히 하나다.
- `id`와 trim한 `title`은 비어 있으면 안 된다.
- `author_name`은 `NULL` 또는 trim 후 비어 있지 않은 UTF-8 text다.
- timestamp는 UTC ISO 8601 text다.

### `tree_nodes`

```sql
CREATE TABLE tree_nodes (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    parent_id TEXT,
    kind TEXT NOT NULL
        CHECK (kind IN ('WORK', 'VOLUME', 'CHAPTER', 'SCENE')),
    title TEXT NOT NULL,
    order_key REAL NOT NULL,
    document_id TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES tree_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE RESTRICT,
    CHECK (
        (kind = 'WORK' AND parent_id IS NULL AND document_id IS NULL) OR
        (
            kind IN ('VOLUME', 'CHAPTER')
            AND parent_id IS NOT NULL
            AND document_id IS NULL
        ) OR
        (
            kind = 'SCENE'
            AND parent_id IS NOT NULL
            AND document_id IS NOT NULL
        )
    )
);

CREATE UNIQUE INDEX tree_nodes_one_work_per_project
    ON tree_nodes(project_id)
    WHERE kind = 'WORK';

CREATE UNIQUE INDEX tree_nodes_sibling_order
    ON tree_nodes(project_id, COALESCE(parent_id, ''), order_key);

CREATE INDEX tree_nodes_parent_order
    ON tree_nodes(project_id, parent_id, order_key, id);
```

SQLite constraint만으로 parent의 kind, 같은 project 연결, cycle 및 “최소 하나”를
완전히 표현할 수 없다. Rust core는 mutation과 open에서 아래 불변식을 추가로
검증한다.

### `ui_state`

```sql
CREATE TABLE ui_state (
    project_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL CHECK (json_valid(value_json)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, key),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

Phase 1A의 예약 key는 `workspace.v1`이다. 그 값은 다음 JSON object다.

```json
{
  "selected_node_id": null,
  "expanded_node_ids": [],
  "binder_width": 300
}
```

Phase 1D의 예약 key는 `world-graph.v1`이다. 이 값은 full/focused mode, focused entity,
depth, kind/status/tag/relation/direction/isolated/label filter, layout, pan/zoom, node
position과 마지막 선택 entity ID만 저장한다. `world-graph.v1`은 graph의 canonical
node/edge 사본을 저장하지 않으며 Story Bible 데이터를 수정하지 않는다.

Phase 1E의 예약 key는 `plot-canvas.v1`이다. Project의 마지막 Canvas ID와 Canvas별
viewport, selected element ID, inspector 폭, grid/minimap/snap-to-grid 값을 저장한다.
Canvas node 위치·크기·z-order·group과 edge는 이 UI state가 아니라 canonical
`canvases.document_json`에 저장한다. `plot-canvas.v1`은 Canvas document, session Undo
history 또는 React Flow object를 저장하지 않는다.

Phase 1F의 예약 key는 `reader-lab.v1`이다. 마지막 scope, active pane count와 정확히 세
pane slot, pane별 preset 선택과 safe override, scroll/zoom, source selection, scroll
sync와 panel 폭을 저장한다.
Publication IR, 원고 text, compiled block/section, Reader preset config/hash 또는 측정 DOM은
저장하지 않는다. 이 row는 재생성 가능한 renderer preference이며 named snapshot에서
제외한다.

`value_json`은 cache나 임의 renderer object 저장소가 아니다. Rust core의
`ui_state` API는 versioned key와 JSON value를 보존하는 generic 저장 경계다.
Electron main이 `workspace.v1`의 snake_case shape, node ID, 최대 1,000개 expanded
ID와 Binder 폭을 검증한다. `world-graph.v1`은 별도 고정 schema와 유한 좌표·viewport,
지원 enum, bounded string array/position map을 검증한다. `plot-canvas.v1`도 dedicated
main/preload capability가 유한 viewport, bounded inspector 폭, boolean option과 최대
1,000개 Canvas state를 검증한다. `reader-lab.v1`도 dedicated capability가 exact version,
bounded scope/preset ID, pane count/slot, finite scroll/zoom/override와 panel 폭을 검증한다.
Renderer는 원고 text, snapshot, DOM,
Cytoscape/React Flow instance, composition payload 또는 timer state를 어느 UI state에도
넣지 않는다.

### `search_documents`

```sql
CREATE TABLE search_documents (
    document_id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    plain_text TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX search_documents_project_idx
    ON search_documents(project_id, document_id);
```

이 table은 canonical 본문이 아니라 `documents.plain_text_recovery`의 exact-search
projection이다. `AFTER INSERT`, `AFTER UPDATE OF project_id,
plain_text_recovery, updated_at`, `AFTER DELETE` trigger가 document transaction 안에서
upsert/delete한다. schema 3 migration은 기존 documents를 한 번 backfill한다.

현재 search는 FTS5가 아니라 이 projection의 text를 Rust에서 non-overlapping exact
substring으로 순회한다. 검색 결과의 offset과 글자 수는 Unicode scalar 기준이다.

### `named_snapshots`

```sql
CREATE TABLE named_snapshots (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    note TEXT,
    kind TEXT NOT NULL CHECK (
        kind IN ('MANUAL', 'AUTO_BEFORE_REPLACE', 'AUTO_BEFORE_RESTORE')
    ),
    payload_format TEXT NOT NULL,
    payload_version INTEGER NOT NULL CHECK (payload_version > 0),
    payload_blob BLOB NOT NULL,
    content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX named_snapshots_project_created_idx
    ON named_snapshots(project_id, created_at DESC, id);
```

새 payload identity는 `MADI_LOGICAL_JSON` version 4이며 embedded JSON identity는
`madi.logical-snapshot` version 4이다. Decoder는 명시된 compatibility 범위인 version
1, 2, 3도 계속 지원한다.
`content_hash`는 exact uncompressed UTF-8 payload bytes의 lowercase SHA-256 hex다.
payload에는 project/tree/documents, Typie BLOB의 base64, recovery, `workspace.v1`과
Story Bible logical row, Canvas metadata/document/hash/revision, canonical Reader preset
row를 포함하고 named snapshot table, search projection, `world-graph.v1`,
`plot-canvas.v1`, `reader-lab.v1`, Canvas Undo/viewport/selection과 renderer runtime
object는 포함하지 않는다.

전체 payload와 restore 계약은 `docs/NAMED_SNAPSHOT_FORMAT.md`를 따른다.

### Phase 1C Story Bible table

```sql
CREATE TABLE entities (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN (
        'CHARACTER', 'LOCATION', 'ORGANIZATION', 'ITEM', 'EVENT',
        'WORLD_RULE', 'FORESHADOWING', 'OTHER'
    )),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    summary TEXT,
    document_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DRAFT', 'ARCHIVED')),
    color_token TEXT,
    icon_key TEXT,
    attributes_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(attributes_json)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE RESTRICT
);

CREATE TABLE entity_aliases (
    id TEXT NOT NULL PRIMARY KEY,
    entity_id TEXT NOT NULL,
    alias TEXT NOT NULL CHECK (length(trim(alias)) > 0),
    normalized_alias TEXT NOT NULL CHECK (length(trim(normalized_alias)) > 0),
    created_at TEXT NOT NULL,
    FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
    UNIQUE (entity_id, normalized_alias)
);

CREATE TABLE tags (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    color_token TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE (project_id, name)
);

CREATE TABLE entity_tags (
    entity_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (entity_id, tag_id),
    FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE relation_types (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    inverse_name TEXT,
    directed INTEGER NOT NULL CHECK (directed IN (0, 1)),
    color_token TEXT,
    is_builtin INTEGER NOT NULL CHECK (is_builtin IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE (project_id, name)
);

CREATE TABLE entity_relations (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    source_entity_id TEXT NOT NULL,
    relation_type_id TEXT NOT NULL,
    target_entity_id TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (source_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
    FOREIGN KEY (relation_type_id) REFERENCES relation_types(id) ON DELETE RESTRICT,
    FOREIGN KEY (target_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
    CHECK (source_entity_id <> target_entity_id),
    UNIQUE (project_id, source_entity_id, relation_type_id, target_entity_id)
);

CREATE TABLE scene_entity_links (
    scene_node_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('APPEARS', 'POV', 'MENTIONED', 'RELATED')),
    note TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (scene_node_id, entity_id, role),
    FOREIGN KEY (scene_node_id) REFERENCES tree_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
);
```

Schema trigger는 entity note document가 같은 project에 있고 SCENE 소유가 아닌지,
entity-tag/relation/scene-link 구성원이 같은 project인지, link node가 실제 `SCENE`인지
검사한다. Rust transaction은 같은 조건을 다시 검사하고 undirected relation의 역방향
중복을 canonical endpoint order로 거부한다. 각 project에는 migration/create 시 10개의
built-in relation type을 deterministic project-scoped ID로 idempotent하게 seed한다.

### Phase 1E `canvases`

```sql
CREATE TABLE canvases (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    description TEXT,
    document_format TEXT NOT NULL CHECK (document_format = 'JSON_CANVAS'),
    document_version TEXT NOT NULL CHECK (document_version = '1.0'),
    document_json TEXT NOT NULL CHECK (json_valid(document_json)),
    content_hash TEXT NOT NULL CHECK (
        length(content_hash) = 64
        AND content_hash = lower(content_hash)
        AND content_hash NOT GLOB '*[^0-9a-f]*'
    ),
    revision INTEGER NOT NULL CHECK (revision >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX canvases_project_updated_idx
    ON canvases(project_id, updated_at DESC, id);
CREATE INDEX canvases_project_name_idx
    ON canvases(project_id, name, id);
```

`document_json`은 JSON Canvas 1.0 field를 사용하는 `MadiCanvasDocument`다. Core는
deserialize 뒤 node/edge ID, text/group shape, finite geometry, group ownership, edge
endpoint와 count/size limit을 검증하고 다시 canonical serialize한다. `content_hash`는
그 exact canonical UTF-8 bytes의 SHA-256다. React Flow type은 이 table이나 Rust DTO에
포함하지 않는다.

Canvas 이름은 비어 있을 수 없지만 같은 project에서 중복할 수 있다. Create,
metadata update, duplicate, delete와 document save는 project revision과 Canvas별 revision을
transaction 안에서 대조한다. Content hash가 같은 document save는 no-op이며 revision과
timestamp를 올리지 않는다. Node/edge count는 document에서 파생한다.

Entity/SCENE reference는 `madi.entityId`/`madi.sceneNodeId`를 저장하고 current canonical
model에서 표시를 파생한다. Target 삭제는 Canvas row를 cascade-delete하지 않으며 broken
reference로 남긴다. Canvas edge는 `entity_relations`와 별개다. 전체 JSON 구조와
호환성은 `PLOT_CANVAS_DATA_MODEL.md`와 `JSON_CANVAS_COMPATIBILITY.md`를 따른다.

### Phase 1F `reader_presets`

```sql
CREATE TABLE reader_presets (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    source_kind TEXT NOT NULL CHECK (source_kind IN (
        'BUILTIN_TEMPLATE', 'CUSTOM', 'DUPLICATED', 'IMPORTED'
    )),
    source_id TEXT,
    source_version TEXT,
    verification_status TEXT NOT NULL CHECK (verification_status IN (
        'GENERIC', 'UNVERIFIED_SIMULATION', 'USER_DEFINED'
    )),
    preset_format TEXT NOT NULL CHECK (preset_format = 'MADI_READER_PRESET'),
    preset_version INTEGER NOT NULL CHECK (preset_version = 1),
    preset_json TEXT NOT NULL CHECK (json_valid(preset_json)),
    content_hash TEXT NOT NULL CHECK (
        length(content_hash) = 64
        AND content_hash = lower(content_hash)
        AND content_hash NOT GLOB '*[^0-9a-f]*'
    ),
    revision INTEGER NOT NULL CHECK (revision >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX reader_presets_project_name_idx
    ON reader_presets(project_id, name COLLATE NOCASE, id);
CREATE INDEX reader_presets_project_updated_idx
    ON reader_presets(project_id, updated_at DESC, id);
```

`preset_json`은 `ReaderRenderConfig` v1 object이며 nested field는 shared renderer contract와
같은 camelCase다. Core는 unknown field/token, UTF-16 길이, safe number/range, viewport와
padding 관계, provenance/verification 관계를 strict하게 검증하고 color를 lowercase로
normalize한 뒤 object key를 결정적으로 정렬한다. `content_hash`는 이 canonical compact
UTF-8 JSON bytes의 SHA-256다.

Preset 이름은 같은 project에서 중복할 수 있고 목록 응답은 duplicate name을 별도로
진단한다. Create/duplicate는 preset revision `0`으로 시작한다. Update/delete는 project
revision과 `expected_preset_revision >= 0`을 모두 대조한다. Update의 canonical config와
name/status가 같으면 no-op이며 timestamp, preset revision과 project revision을 올리지
않는다. Cross-project ID와 malformed config/hash는 transaction을 바꾸지 않고 거부한다.
전체 envelope/config 계약은 `READER_PROFILE_FORMAT_V1.md`를 따른다.

## 4. canonical hierarchy

허용 graph는 다음뿐이다.

```text
WORK
├─ VOLUME
│  └─ CHAPTER
│     └─ SCENE → documents.id
└─ CHAPTER
   └─ SCENE → documents.id
```

### node 불변식

1. project마다 root `WORK`가 정확히 하나 존재한다.
2. root는 WORK뿐이며 WORK의 `parent_id`와 `document_id`는 `NULL`이다.
3. VOLUME의 parent는 같은 project의 WORK다.
4. CHAPTER의 parent는 같은 project의 WORK 또는 VOLUME이다.
5. SCENE의 parent는 같은 project의 CHAPTER다.
6. SCENE만 `document_id`를 가지며 SCENE은 반드시 하나를 가진다.
7. `document_id UNIQUE`로 하나의 document가 둘 이상의 SCENE에 연결되지 않는다.
8. 모든 documents row는 같은 project의 SCENE 또는 entity 하나에서 참조한다.
9. parent와 child는 같은 project다.
10. self-parent, cycle, 고아 node, 고아 entity note와 고아 document를 허용하지 않는다.
11. 모든 ID와 trim한 title은 비어 있지 않다.
12. `order_key`는 유한한 수이며 같은 project/parent sibling 안에서 unique하다.
13. node의 kind는 생성 뒤 바꾸지 않는다.

### title mirror

- `app_meta.title = projects.title = root WORK.title`
- `SCENE.title = 연결된 documents.title`
- VOLUME과 CHAPTER title은 `tree_nodes.title`만이 canonical 값이다.

WORK rename은 첫 번째 등식의 세 row를 한 transaction에서 바꾼다. SCENE rename은
node와 document title을 함께 바꾼다. 실패 시 일부 title만 남기지 않는다.

### SCENE-document invariant

SCENE과 document의 lifecycle은 분리할 수 없다.

- SCENE 생성: documents insert와 tree_nodes insert를 같은 transaction에서 수행
- SCENE load/save: 전달된 `scene_id`가 가리키는 `document_id`만 사용
- SCENE rename: documents title도 같은 transaction에서 갱신
- SCENE move/reorder: document ID와 bytes는 바꾸지 않음
- SCENE 삭제: 연결 document도 같은 transaction에서 삭제
- open: SCENE 없는 document 또는 document 없는 SCENE을 corruption으로 거부

Renderer가 보낸 `document_id`를 신뢰해 다른 장면을 저장하지 않는다. core는
`scene_id`로 연결을 다시 조회하고, 요청의 document ID가 있다면 조회 결과와
일치할 때만 저장한다.

### ENTITY-document invariant

- entity 생성: 빈/uninitialized documents row와 entity를 같은 transaction에서 생성
- entity load/save: `owner_kind = ENTITY`, `owner_id`, `document_id`를 모두 재검증
- entity 이름 변경: 연결 document title을 같은 transaction에서 갱신
- entity 삭제: alias, entity-tag, relation, scene link와 entity row를 정리한 뒤 note
  document를 같은 transaction에서 삭제
- SCENE과 entity가 같은 `document_id`를 소유하는 상태를 trigger/core 양쪽에서 거부
- open/snapshot restore: entity가 없는 note 또는 note가 없는 entity를 integrity 오류로
  처리

Renderer의 generation/save sequence는 stale response 억제용이며 canonical DB 값이
아니다. SCENE과 ENTITY는 editor adapter instance를 공유할 수 있지만 owner tuple이
일치하지 않는 save 응답을 현재 document 상태에 적용하지 않는다.

## 5. sparse `order_key`

`order_key`는 zero-based array index가 아니다. Phase 1A의 기본 정책은 다음과 같다.

```text
ORDER_STEP = 1024.0
MIN_ORDER_GAP = 0.000001
read order = order_key ASC, id ASC
```

### 배정

- 빈 sibling list의 첫 key: `1024.0`
- 끝에 append: 마지막 key + `1024.0`
- 처음에 prepend: 첫 key - `1024.0`; 음수 key도 유효함
- 두 sibling 사이: `(left + right) / 2.0`
- `before_node_id`와 `after_node_id`는 상호 배타적이다. 지정한 ID는 같은 부모의
  sibling이어야 한다.

### rebalance

현재 구현은 다음 중 하나면 해당 부모의 sibling만 결정적 순서대로 rebalance한다.

- midpoint와 이웃의 차이가 `MIN_ORDER_GAP` 이하다.
- 계산 결과가 finite가 아니다.

rebalance 값은 `(index + 1) * ORDER_STEP`이다. rebalance와 최종 배치는 하나의
transaction에서 처리한다. unique index와 충돌할 수 있으므로 구현은 임시 음수/별도
범위를 사용하고 중간 상태를 commit하지 않는다. open 시 non-finite legacy/손상
`order_key`는 integrity 오류다.

`reorder_node`는 같은 부모 안에서만 위치를 바꾼다. 부모를 바꾸는 것은
`move_node`이며, 새 부모의 규칙을 검증하고 새 sibling key를 배정한다. tie 발생 시
ID가 결정적 read fallback이지만 정상 mutation은 tie를 남기지 않는다.

## 6. project 생성

새 v1 project는 대상과 같은 directory의 고유 임시 SQLite 파일에서 schema migration
transaction들을 적용한 뒤 canonical project row를 별도 transaction으로 만든다.

1. v0 table과 schema migration 1
2. `projects`, `tree_nodes`, `ui_state`와 schema migration 2
3. `search_documents`, trigger, `named_snapshots`와 schema migration 3
4. Story Bible table, trigger와 schema migration 4
5. `canvases` table/index와 schema migration 5
6. `reader_presets` table/index와 schema migration 6
7. `app_meta` 한 row
8. 같은 ID의 `projects` 한 row와 built-in relation type 10개
9. project title을 가진 WORK 한 row
10. WORK 아래 초기 document title을 가진 CHAPTER 한 row
11. CHAPTER 아래 같은 title의 SCENE과 document 한 쌍

초기 VOLUME은 만들지 않는다. 기본 node/document는 기존 “새 파일을 만들면 바로 쓸
수 있음” 동작을 유지하기 위한 최소값이다. core의 `document_title`을 생략하면 project
title을 사용하며, 현재 desktop create path도 project title을 넘긴다. 이후 Binder의
추가 동작은 `새 권`, `새 화`, `새 장면`을 기본 제목으로 사용한다.

schema를 만들고 `application_id = 0x4D414449`, `user_version = 6`을 설정한 뒤 file을
sync한다. destination이 이미 있으면 덮어쓰지 않는다. 완성된 임시 파일만 기존 v0의
no-clobber publish 절차로 destination 이름에 연결한다.

## 7. schema 1/2/3/4/5 → schema 6 migration

입력은 `format_version = 0`, `schema_version = 1`, `user_version = 1`인 유효한 v0
파일 또는 schema 2 파일이다. 현재 open 순서는 migration 전에 application ID와
지원 가능한 `user_version`을 확인하고, migration 뒤 `quick_check`, metadata와
hierarchy를 검증한다. unknown metadata preflight의 한계는 compatibility 절에 명시한다.

### schema 1 → 2 절차

1. SQLite connection을 열고 application ID와 지원 가능한 `user_version`을 확인한다.
2. `BEGIN IMMEDIATE`를 시작한다.
3. `projects`, `tree_nodes`, `ui_state`와 index를 만든다.
4. `app_meta.project_id/title/timestamp`에서 projects row를 만든다.
5. project title을 가진 WORK를 정확히 하나 만든다.
6. legacy documents를 `(created_at, id)` 순서로 읽는다.
7. document가 있으면 WORK 아래 `본문` CHAPTER를 하나 만든다.
8. 각 legacy document를 이 공통 CHAPTER 아래 SCENE으로 연결한다.
9. SCENE title과 ID 연결은 기존 document title/ID를 그대로 사용한다.
10. `schema_migrations(version = 2)`를 기록한다.
11. `app_meta.format_version = 1`, `schema_version = 2`로 바꾼다.
12. `PRAGMA user_version = 2`를 설정한다.
13. 성공하면 schema 2 migration transaction을 commit한다.

v0는 현재 기본 document 한 개를 가지므로 일반 migration 결과는 WORK → `본문`
CHAPTER → SCENE 한 경로다. 방어적으로 여러 legacy document가 있으면 같은 `본문`
CHAPTER 아래에 순서대로 SCENE을 만들어 orphan이 되지 않게 한다. VOLUME은
자동으로 만들지 않는다.

ui_state row는 migration 필수가 아니다. 값이 없으면 open 시 첫 유효 SCENE,
container 기본 펼침 상태와 기본 폭 `300`을 계산하고, 첫 UI state save에서
`workspace.v1`을 기록한다.

schema 2 단계 중 실패하면 해당 transaction을 rollback하고 원본 schema 1 metadata와
document를 유지한다.

### schema 2 → 3 절차

1. 별도 `BEGIN IMMEDIATE`를 시작한다.
2. `search_documents`, project index와 documents insert/update/delete trigger를 만든다.
3. `named_snapshots`와 project/created index를 만든다.
4. 기존 `documents.id/project_id/plain_text_recovery/updated_at`을 projection에
   `INSERT OR REPLACE`로 backfill한다.
5. `schema_migrations(version = 3)`을 기록한다.
6. `app_meta.schema_version = 3`으로 바꾸고 `format_version = 1`을 유지한다.
7. `PRAGMA user_version = 3`을 설정한다.
8. 성공하면 commit한다.

schema 2 → 3 실패는 table/backfill/version 변경을 함께 rollback한다. schema 1에서
open할 때는 schema 2 transaction이 먼저 commit된 뒤 schema 3 transaction이 실행되므로
두 migration을 하나의 outer transaction으로 원자화했다고 주장하지 않는다. 재open은
현재 `user_version`에서 migration chain을 계속한다.

### schema 3 → 4 절차

1. 별도 `BEGIN IMMEDIATE`를 시작한다.
2. `entities`, `entity_aliases`, `tags`, `entity_tags`, `relation_types`,
   `entity_relations`, `scene_entity_links`와 index/validation trigger를 만든다.
3. 기존 각 project에 10개의 built-in relation type을 project-scoped deterministic ID로
   idempotent하게 seed한다.
4. `schema_migrations(version = 4)`를 기록한다.
5. `app_meta.schema_version = 4`로 바꾸고 `format_version = 1`을 유지한다.
6. `PRAGMA user_version = 4`를 설정한다.
7. foreign-key/integrity 검증이 성공하면 commit한다.

schema 3 → 4는 기존 project/tree/document/search/snapshot row를 변경하거나 버리지
않는다. 실패하면 신규 table, seed와 version 변경이 함께 rollback된다. 기존 payload
v1 row는 schema migration에서 rewrite하지 않고 snapshot decoder가 복원 시 처리한다.

### schema 4 → 5 절차

1. 별도 `BEGIN IMMEDIATE`를 시작한다.
2. `canvases` table과 project/updated, project/name index를 만든다.
3. `schema_migrations(version = 5)`를 기록한다.
4. `app_meta.schema_version = 5`로 바꾸고 `format_version = 1`을 유지한다.
5. `PRAGMA user_version = 5`를 설정한다.
6. 성공하면 commit한다.

Schema 4 → 5는 기존 project/tree/document/search/snapshot/Story Bible row를 변경하거나
backfill하지 않는다. 기존 project의 Canvas 목록은 빈 상태에서 시작한다. 기존 payload
v1/v2 row도 rewrite하지 않으며 snapshot decoder가 version별 빈 Story Bible/Canvas
계약을 검증한다. 실패하면 Canvas table/index/migration record/version 변경이 함께
rollback된다.

### schema 5 → 6 절차

1. 별도 `BEGIN IMMEDIATE`를 시작한다.
2. `reader_presets` table과 project/name, project/updated index를 만든다.
3. `schema_migrations(version = 6)`을 기록한다.
4. `app_meta.schema_version = 6`으로 바꾸고 `format_version = 1`을 유지한다.
5. `PRAGMA user_version = 6`을 설정한다.
6. 성공하면 commit한다.

Schema 5 → 6은 기존 project/tree/document/search/snapshot/Story Bible/Canvas row를
변경하거나 backfill하지 않는다. 기존 project의 저장 Reader preset 목록은 빈 상태에서
시작하고 immutable built-in template은 SQLite row로 seed하지 않는다. 기존 payload
v1/v2/v3 row도 rewrite하지 않으며 decoder가 restore할 때 Reader preset이 없는 정확한
historical state로 처리한다. 실패하면 Reader preset table/index/migration
record/version 변경이 함께 rollback된다.

현재 구현은 migration 전 `.bak`을 만들지 않으므로 pre-migration backup이 있다고
주장하지 않는다. 손상된 row를 버리고 migration을 성공 처리하거나 빈 v1 project로
대체하면 안 된다.

## 8. structural mutation transaction

모든 canonical tree mutation은 다음 순서를 따른다.

1. application ID, version, `quick_check` 및 현재 hierarchy 검증
2. canonical content를 바꾸기 전 backup 생성·sync
3. `BEGIN IMMEDIATE`
4. transaction 안에서 `expected_revision` 재검사
5. parent/kind/project/cycle/document/order validation
6. 관련 projects/tree_nodes/documents/app_meta row 변경
7. `app_meta.revision = revision + 1`, `last_saved_by`, `updated_at` 갱신
8. 변경된 전체 불변식 재검사
9. commit 및 `.madi` file sync

실패는 전체 rollback이다. `expected_revision` 충돌 시 자동 overwrite하지 않는다.
단일 desktop session도 가능한 모든 canonical mutation에 expected revision을 넘긴다.

UI state mutation은 별도 짧은 transaction으로 upsert한다. UI state는 원고의
canonical revision이나 backup rotation을 증가시키지 않는다. 이 분리는 Binder 폭
저장과 장면 autosave가 서로 불필요한 revision conflict를 만들지 않게 한다.

## 9. node create, move, reorder와 rename

### create

- `WORK` create command는 금지한다. WORK는 project 생성/migration만 만든다.
- VOLUME, CHAPTER, SCENE은 허용 parent 규칙을 만족해야 한다.
- 빈 title은 kind별 기본 제목으로 정규화하거나 타입 있는 validation 오류로 거부한다.
- SCENE create는 새 document ID를 만들고 빈/uninitialized document와 node를 같은
  transaction에서 insert한다.
- document insert가 실패하면 SCENE도 존재하지 않아야 한다.

### move

- WORK는 이동할 수 없다.
- target parent는 같은 project에 존재해야 한다.
- VOLUME → WORK, CHAPTER → WORK/VOLUME, SCENE → CHAPTER 규칙을 다시 검사한다.
- 자기 자신이나 descendant 아래로 이동할 수 없다.
- 이동 전 document 연결을 유지한다.
- source/target sibling ordering과 UI state sanitize를 같은 transaction에서 끝낸다.

### reorder

- node kind와 parent는 바꾸지 않는다.
- 같은 parent의 실제 sibling ID만 before/after target으로 받을 수 있다.
- 첫/마지막 경계의 위·아래 명령은 typed no-op 결과 또는 typed boundary 오류로
  일관되게 처리한다. 성공으로 revision만 올리면 안 된다.

### rename

- trim 후 빈 제목을 거부한다.
- WORK는 app_meta/projects title을 함께 갱신한다.
- SCENE은 documents title을 함께 갱신한다.
- VOLUME/CHAPTER는 해당 node만 갱신한다.

## 10. explicit delete

delete request는 `node_id`와 `recursive`를 반드시 포함한다.

- WORK 삭제는 항상 `WorkMutationForbidden`이다.
- leaf는 `recursive = false`로 삭제할 수 있다.
- child가 있는 node는 `recursive = false`이면 `RecursiveDeleteRequired`다.
- `recursive = true`는 UI 확인 뒤에만 보내며 core도 subtree를 다시 계산한다.
- subtree 밖 node/document를 삭제하면 안 된다.
- SCENE을 지울 때 연결 documents row도 지운다.
- core delete는 generic UI-state JSON을 같은 transaction에서 수정하지 않는다.
- renderer는 새 tree에서 selected ID가 사라졌으면 첫 유효 SCENE, 없으면 WORK로
  fallback하고 다음 UI-state save에서 stale ID를 교체한다.

transaction은 삭제 전 descendant와 document ID를 확정한다. foreign-key cascade는
검증된 subtree를 원자적으로 정리하는 보조 수단이다. UI가 SQL cascade에 의존해
확인 없이 부모를 삭제할 수 있게 해서는 안 된다.

성공 응답은 삭제된 node/document ID와 새 revision을 포함할 수 있지만 snapshot이나
recovery 본문은 포함하지 않는다.

## 11. scene load/save

### load

1. `scene_id`가 같은 project의 SCENE인지 확인한다.
2. SCENE의 non-null `document_id`를 core가 조회한다.
3. 연결 document의 project, title과 editor metadata를 확인한다.
4. snapshot bytes, recovery 및 현재 project revision을 반환한다.

SCENE이 아닌 node, orphan document, cross-project 연결 또는 지원하지 않는 Typie
commit/schema는 typed error다. compatibility 실패를 빈 document로 열어 저장하면
안 된다.

### save

renderer → main save request는 최소 다음을 포함한다.

- `scene_id`
- `document_id`
- `generation`
- `saveSequence`
- `editor_engine`
- `editor_engine_commit`
- `editor_schema_version`
- snapshot bytes
- plain-text recovery

Renderer의 `generation`과 `saveSequence`는 stale UI suppression token이며 DB의
canonical 내용은 아니다. main은 renderer의 `document_id`와 core 응답 document를
대조하고 generation/sequence를 응답에 echo한다. controller는 scene/document/
generation/sequence가 요청과 모두 같은 응답만 현재 UI 상태에 적용한다.

main → core `save_scene` RPC는 session의 `expected_revision`과 `scene_id`를
canonical identity로 보내며
`document_id`, generation과 sequence를 보내지 않는다. core가 scene에서 document
연결을 다시 조회하고 revision, engine metadata와 payload를 검증한 뒤 document와
`app_meta.revision`을 기존 pre-save backup protocol로 원자적으로 갱신한다. 오류
메시지에는 snapshot, recovery 또는 사용자가 입력한 본문을 넣지 않는다.

documents update와 같은 transaction에서 schema 3 trigger가 `search_documents`를
upsert한다. 따라서 검색 projection은 마지막 성공 save와 같은 commit boundary를
가진다. UI가 dirty editor의 미저장 text를 DB 검색 결과라고 표시하면 안 된다.

### Phase 1B descendant/search/statistics read

- `list_descendant_scenes`는 선택 subtree의 SCENE을 Binder DFS 순서로 반환하며
  snapshot BLOB을 제외한다. page limit은 1..1,000이고 encoded recovery text는 응답당
  최대 64 MiB다.
- `search_project`는 title과 `search_documents.plain_text`를 non-overlapping exact
  substring으로 검색한다. default result limit은 1,000, 최대 5,000이며 total은 page와
  별도로 정확히 계산한다.
- BODY result는 SCENE/document ID, Unicode scalar start/end와 source recovery의
  SHA-256를 가진다.
- `get_text_statistics`는 subtree SCENE의 Unicode scalar 수와 Unicode whitespace를
  제외한 수를 계산한다.

세 read operation은 deferred transaction에서 metadata와 text를 같은 revision view로
읽는다.

### Phase 1B selective replacement commit

`apply_replacement_batch`는 renderer가 만든 arbitrary text를 신뢰하지 않는다.
expected project revision, SCENE-document-editor identity, source body SHA-256,
occurrence count, query/replacement transduction, character delta와 transformed snapshot이
실제로 달라졌는지 확인한다.

검증 뒤 하나의 immediate transaction에서 현재 logical state를
`AUTO_BEFORE_REPLACE`로 저장하고 모든 target documents를 update한 뒤 project revision을
한 번 올린다. 중간 실패는 document/search projection/safety snapshot/revision을 모두
rollback한다. Typie 의미 transform 자체의 adapter 계약은
`docs/SEARCH_REPLACE_SEMANTICS.md`를 따른다.

### Named logical snapshot operation

manual create/rename/delete는 pre-operation backup, expected revision과 immediate
transaction을 사용하고 revision을 한 번 올린다. diff는 read-only다. restore는 같은
transaction 안에서 현재 logical payload를 `AUTO_BEFORE_RESTORE`로 insert하고 target을
검증한 뒤 project/tree/documents/Story Bible/Canvas/Reader preset/`workspace.v1`을
복원한다. 다른 UI key와 기존 named snapshot row는 보존한다. Payload v1은 Story Bible,
Canvas와 Reader preset을, payload v2는 Canvas와 Reader preset을, payload v3는 Reader
preset을 빈 상태로 복원한다. Restore 직전 현재 schema 6 state는 Canvas와 Reader
preset을 포함한 v4 `AUTO_BEFORE_RESTORE`로 보존한다. 자세한 payload는
`docs/NAMED_SNAPSHOT_FORMAT.md`를 따른다.

### Phase 1E Canvas operation

- `list_canvases`는 document body를 제외한 metadata와 derived node/edge count를 name 또는
  updated time 순서로 반환한다.
- `create_canvas`는 검증된 document와 metadata를 insert하고 project revision을 한 번
  올린다.
- `update_canvas`는 name/description을 Canvas/project revision과 함께 대조한다.
- `duplicate_canvas`는 source의 canonical document를 새 Canvas ID로 복제한다.
- `delete_canvas`는 Canvas/project revision을 대조해 한 row를 transaction으로 지운다.
- `load_canvas`는 저장 JSON을 decode·canonicalize하고 stored hash와 exact bytes를
  재검증한다.
- `save_canvas`는 document 전체를 검증하고 content hash가 같으면 no-op, 다르면 Canvas와
  project revision을 각각 한 번 올린다.

Renderer의 `generation`/`saveSequence`는 stale response 억제 token이며 canonical DB
column이 아니다. Main은 고정 Canvas IPC capability에서 request/result identity를
대조하고 React Flow object, generic filesystem path 또는 arbitrary RPC method를 받지
않는다.

### Phase 1F Publication/Reader preset operation

- `compile_publication`은 SCENE/CHAPTER/VOLUME/WORK scope의 pinned Typie snapshot을
  read-only decode하여 engine-independent `PublicationDocument` v1, deterministic hash,
  code-only diagnostic과 compile timing을 반환한다.
- `get_publication_stats`는 같은 compile boundary의 character/paragraph/scene/chapter
  통계와 hash를 반환한다.
- `validate_publication`은 전달된 Publication DTO의 strict union, source mapping, caps,
  derived statistics와 canonical hash를 검증하며 `.madi`를 열거나 수정하지 않는다.
- `list_reader_presets`는 current project row를 hash/shape/provenance까지 재검증해
  deterministic order와 duplicate-name warning으로 반환한다.
- `create_reader_preset`, `update_reader_preset`, `duplicate_reader_preset`,
  `delete_reader_preset`은 project/preset revision, canonical hash, no-op과 project
  isolation을 transaction 안에서 강제한다.

Publication source block ID는 raw Typie Dot이 아니라 document ID와 private Dot identity를
namespace한 deterministic hash다. Body block은 정확한 annotated Unicode-scalar range를
보존하고 empty authored block은 verified zero-length caret range를 가진다. Hierarchy
heading은 실제 source node ID와 첫/current descendant target SCENE/document를 함께
가져 title click이 source SCENE을 열 수 있게 한다. Renderer/SQLite/RPC에는 Typie Rust
type, editor DOM 또는 executable HTML/CSS가 노출되지 않는다.

## 12. UI state 정규화

disk의 `workspace.v1` 계약:

- `selected_node_id`: `string | null`
- `expanded_node_ids`: string array, 최대 1,000개
- `binder_width`: finite number, Phase 1A 지원 범위 `220..640`

preload의 TypeScript 값은 각각 `selectedNodeId`, `expandedNodeIds`, `binderWidth`이며
Electron main이 disk snake_case와 renderer camelCase를 변환한다.

disk의 `world-graph.v1` 계약은 다음 camelCase renderer 상태를 snake_case JSON으로
변환해 저장한다.

- `mode`: `FULL | FOCUSED`
- `focused_entity_id`: `string | null`
- `depth`: `1 | 2 | 3`
- `filters`: kind/status/tag/tag mode/relation type/direction/isolated/label 값
- `layout`: `cose | preset`
- `viewport`: finite positive zoom과 finite pan `(x, y)`
- `node_positions`: entity ID별 finite `(x, y)` map
- `selected_entity_id`: `string | null`

Graph state load 뒤 renderer는 현재 read model에 없는 focused/selected ID와 삭제된
entity position을 제거한다. state row가 없거나 손상됐으면 `FULL`, depth 1,
`ACTIVE + DRAFT`, tag ANY, 모든 relation 방향, isolated/label 표시, `cose`, zoom 1과
pan `(0, 0)`을 사용한다. 다른 project의 row는 `(project_id, key)` primary key 때문에
섞이지 않는다.

save 때:

1. renderer는 현재 tree의 non-SCENE node만 expanded list로 만든다.
2. main은 selected/expanded 값이 제한된 node ID 문자열인지 확인한다.
3. main은 expanded 개수와 width `220..640` 범위를 확인한다.
4. core는 generic JSON을 `BEGIN IMMEDIATE` upsert로 저장한다.
5. 이 write는 manuscript revision과 canonical backup rotation을 바꾸지 않는다.

`world-graph.v1` save도 같은 generic upsert를 사용하지만 dedicated main/preload
capability가 shape를 검증한다. node drag, pan/zoom과 filter 변경은 canonical project
revision을 올리지 않는다.

Disk의 `plot-canvas.v1`은 다음 snake_case 구조를 저장한다.

- `last_canvas_id`: `string | null`
- `canvas_states`: Canvas ID별 view state map, 최대 1,000개
- 각 view의 `viewport`: finite `x`, `y`, `zoom`
- `selected_element_id`: `string | null`
- `inspector_width`: bounded finite number
- `show_grid`, `show_minimap`, `snap_to_grid`: boolean

Dedicated main/preload capability가 camelCase renderer DTO와 disk snake_case를 변환하고
project/key를 재검증한다. Canvas document mutation과 별개이므로 viewport, selection,
inspector 옵션은 project revision을 올리지 않는다.

Disk의 `reader-lab.v1`은 key suffix로 version을 고정하고 shared camelCase renderer
구조를 generic JSON value로 그대로 저장한다.

- `lastScopeNodeId`: `string | null`
- `paneCount`: `1 | 2 | 3`
- 정확히 세 fixed pane slot의 preset ID, device profile ID, safe override, zoom과 scroll
  progress
- `scrollSync`, bounded left/right panel width, selected source block ID와 diagnostic expanded
  여부

Dedicated main/preload capability가 shared Reader UI-state validator를 적용하고 save 뒤
canonical JSON equality를 확인한다. Canonical `reader_presets` mutation과 별개이므로
scope/pane/layout/selection 변경은 project revision을 올리지 않는다. Named snapshot
restore는 이 key를 교체하지 않으며 renderer가 사라진 preset/source 참조만 current
canonical option으로 정규화한다.

load 때:

1. main은 JSON shape와 node ID 및 width를 다시 검사한다.
2. renderer는 UI-state load/validation 오류를 `{ state: null }`로 격리해 tree
   복원을 계속한다.
3. renderer는 없는 expanded ID를 제거하고 유효한 branch만 펼침 상태에 적용한다.
4. 존재하지 않는 selected ID는 session SCENE, 첫 SCENE, WORK 순으로 대체한다.
5. 존재하는 WORK/VOLUME/CHAPTER selected ID는 유지하고 해당 subtree Scrivenings를
   표시한다.
6. SCENE이 없으면 WORK를 선택하고 editor를 비활성화한다.
7. 저장 row가 없거나 invalid이면 모든 branch를 펼치고 width 기본값 `300`을
   사용한다.

현재 core의 generic UI-state API 자체는 tree/entity 존재 여부를 sanitize하지 않는다.
application renderer/main 경계가 `workspace.v1`, `world-graph.v1`과
`plot-canvas.v1`, `reader-lab.v1`을 제한한다. UI state 손상 때문에 canonical
node/document/entity/relation/Canvas를 삭제하거나 고치지 않는다.

## 13. open validation

현재 core는 쓰기 가능한 v1 connection을 반환하기 전에 다음을 검사한다.

- SQLite header와 application ID
- 알려진 format/schema/user version의 일치
- `quick_check = ok`
- `PRAGMA foreign_key_check` 결과 없음
- app_meta metadata와 대응하는 projects row 하나
- WORK 정확히 하나와 유효한 root
- WORK/VOLUME/CHAPTER/SCENE parent-kind edge

table의 `CHECK`, foreign key와 unique index는 SCENE의 non-null document link와 같은
기본 무결성을 추가로 지킨다. tree load는 non-finite `order_key`를 거부하며,
renderer는 장면 load 시 현재 Typie engine/commit/schema compatibility를 검사한다.

현재 open-time scan은 orphan documents, cross-project parent/document pair,
`app_meta/projects/WORK` title mirror 및 모든 SCENE-document 역방향 1:1을 별도 query로
완전 검증하지 않는다. Schema v6의 FK/trigger와 Story Bible/Canvas/Reader preset
mutation/snapshot restore는
entity note ownership과 cross-project relation/link를 검증하지만, 임의로 변조한 SQLite
전체를 open 시 재구성해 audit하는 추가 corruption scan은 별도 hardening 대상이다.

Canvas document는 list/load/snapshot validation 시 canonical JSON과 hash를 검증한다.
Open은 모든 Canvas JSON/hash를 전수 decode하지 않으므로 임의 변조 DB 전체 Canvas audit은
별도 hardening 대상이다.

Reader preset도 list/mutation/snapshot validation 시 strict config, provenance와 canonical
hash를 검증한다. Open은 모든 preset JSON/hash를 전수 decode하지 않으므로 임의 변조 DB
전체 preset audit은 별도 hardening 대상이다.

open 자체는 모든 document에 대응하는 `search_documents` row와 모든 named snapshot
payload hash를 전수 decode하지 않는다. search는 projection 누락을 integrity 오류로
거부하고 snapshot hash/shape는 diff/restore 시 검증한다. 변조 DB 전체를 open 전에
audit하는 것은 후속 hardening 대상이다.

validation 실패 시 본문을 log에 출력하지 않고 typed corruption/compatibility 오류를
반환한다. 사용자의 명시적 복구 동작 없이 빈 값으로 덮어쓰거나 자동 삭제하지 않는다.
`plain_text_recovery` CLI 경로는 계속 별도로 유지한다.

## 14. backup, crash와 durability 경계

Phase 0의 two-generation `.bak`/`.bak.previous`, `BEGIN IMMEDIATE`, file sync 및
no-clobber create 계약을 유지한다. canonical structure/document mutation에도 같은
pre-save backup을 적용한다.

SQLite transaction과 backup 설계가 있어도 process kill/power-loss 전체가 이미
검증됐다는 뜻은 아니다. fault injection 결과는 `DEFERRED TO HARDENING`이며 실제
실행 전까지 완료로 표시하지 않는다.

UI state는 재생성 가능한 비정규 상태이므로 원고 backup을 매번 회전하지 않는다.
UI state write가 실패해도 마지막 성공 canonical manuscript는 유지돼야 한다.

## 15. compatibility

- Schema 1은 2/3/4/5/6을, schema 2는 3/4/5/6을, schema 3은 4/5/6을, schema 4는
  5/6을, schema 5는 6을
  순서대로 migration한다.
  migration 전 backup을 자동 생성한다고 주장하지 않는다.
- v1 reader는 v0 snapshot bytes를 decode하지 않고 그대로 연결한 뒤 기존 adapter
  compatibility contract를 사용한다.
- Snapshot payload decoder는 version 1/2/3/4를 수용한다. v1은 Story Bible/Canvas/Reader
  preset, v2는 Canvas/Reader preset, v3는 Reader preset이 없는 정확한 historical
  state로 restore한다.
- `user_version > 6`, `schema_version > 6` 또는 알 수 없는 format은 downgrade하지
  않는다.
- Typie commit/schema 변경은 별도 upgrade rehearsal과 migration 없이는 자동
  변환하지 않는다.
- `plain_text_recovery`는 비상 copy이며 rich document를 완전히 재구성한다는 보장은
  없다.
- v1 파일을 v0 앱이 쓸 수 있다고 약속하지 않는다.

위 unknown-format 선거부는 목표 계약이다. 현재 open 순서는 `application_id`와
`user_version`을 본 뒤 v2/v3/v4/v5/v6 migration을 먼저 실행하고, 그 다음 `quick_check`와
`app_meta` format/schema를 검증한다. 따라서 `user_version = 1`인 변조 파일의
unknown `app_meta.format_version`을 migration 전에 거부하는 conformance는
`PENDING`이다.

## 16. 요구 test와 결과 기록 원칙

Phase 1F core/storage에서는 최소한 다음을 검증한다.

- Schema 5 → 6 data-preserving migration, 새 project schema/index/version
- Reader preset create/update/duplicate/delete/list, revision 0 lifecycle, canonical hash/no-op,
  strict config/provenance, rollback, project isolation과 reopen
- Snapshot payload v4 Reader preset capture/diff/restore/rollback,
  `AUTO_BEFORE_RESTORE`, genuine v1/v2/v3 compatibility와 v3 Canvas retention
- pinned Typie lossless decoder, authored/synthetic 구분, inline/unsupported diagnostic,
  document-namespaced IDs와 exact Korean/emoji/empty/quote source range
- SCENE/CHAPTER/VOLUME/WORK Publication compile, boundary heading, deterministic hash/stats,
  tampered DTO rejection과 read-only revision
- 기존 hierarchy/search/replacement/Story Bible/World Graph/Canvas regression

집중 test, aggregate command, development/packaged Electron과 성능 결과는 실제 실행
로그가 있는 Phase 결과/성능 문서에서만 `PASS` 또는 수치로
기록한다. 이 format draft는 실행하지 않은 결과나 추정 성능을 선언하지 않는다.

현재 배포 경계는 다음과 같다.

```text
Phase 1D entry verdict: CONDITIONAL TECHNICAL GO — PRIVATE LOCAL
Phase 1E verdict: TECHNICAL GO — PRIVATE LOCAL
Phase 1F verdict: NOT DECLARED IN THIS FORMAT DRAFT
Windows native Korean IME: MANUAL VALIDATION PENDING
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Public/paid/customer distribution: NOT AUTHORIZED
```

이 문서는 계속 v1 **초안**이며 migration preflight, 임의 변조 DB의 full open-time
audit와 power-loss fault injection은 별도 hardening 대상이다.

실제 Phase 1F 판정과 schema 6 package 검증은
[Phase 1F result](./PHASE_1F_RESULT.md)를 따른다.
