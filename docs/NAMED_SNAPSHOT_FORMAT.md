# Named snapshot logical payload 형식

기준일: 2026-08-09

```text
Storage table: named_snapshots
payload_format: MADI_LOGICAL_JSON
payload_version: 4 (decoder accepts 1, 2, 3 and 4)
embedded format: madi.logical-snapshot
embedded version: 4 (decoder accepts 1, 2, 3 and 4)
encoding: UTF-8 JSON, uncompressed
integrity: SHA-256 of exact payload_blob bytes
```

이 snapshot은 `.madi` SQLite file의 byte copy가 아니다. Project의 canonical logical
state를 versioned JSON으로 직렬화한 payload다. Named snapshot table이나 검색
projection을 재귀적으로 포함하지 않는다.

## 1. table 계약

Schema 6의 `named_snapshots` row는 다음 값을 가진다.

| column | 의미 |
|---|---|
| `id` | snapshot UUID/고유 ID |
| `project_id` | 이 `.madi`의 project ID |
| `name` | trim 후 비어 있지 않은 표시 이름 |
| `note` | nullable 사용자 메모 |
| `kind` | `MANUAL`, `AUTO_BEFORE_REPLACE`, `AUTO_BEFORE_RESTORE` |
| `payload_format` | `MADI_LOGICAL_JSON` |
| `payload_version` | 새 snapshot은 `4`; 기존 `1`, `2`, `3`도 decode/restore 가능 |
| `payload_blob` | uncompressed UTF-8 JSON bytes |
| `content_hash` | payload bytes의 lowercase 64자리 SHA-256 hex |
| `created_at` | UTC timestamp |
| `updated_at` | UTC timestamp; 이름 변경 때 갱신 |

목록 정렬은 `created_at DESC, id`다. Payload는 일반 목록 응답에 포함하지 않고 format,
version, byte length와 hash만 반환한다.

## 2. payload shape

현재 Rust 구조를 JSON 표기로 줄이면 다음과 같다.

```json
{
  "format": "madi.logical-snapshot",
  "version": 4,
  "app": {
    "project_id": "...",
    "title": "...",
    "created_by": "...",
    "created_at": "..."
  },
  "project": {
    "id": "...",
    "title": "...",
    "author_name": null,
    "created_at": "...",
    "updated_at": "..."
  },
  "nodes": [],
  "documents": [],
  "ui_state": [],
  "entities": [],
  "entity_aliases": [],
  "tags": [],
  "entity_tags": [],
  "relation_types": [],
  "entity_relations": [],
  "scene_entity_links": [],
  "canvases": [],
  "reader_presets": []
}
```

`nodes`는 WORK부터 Binder DFS 순서로 다음을 저장한다.

- id, project_id, parent_id
- kind, title, order_key, document_id
- created_at, updated_at

`documents`는 SCENE document 뒤 entity note document를 deterministic order로 저장한다.

- id, project_id, title
- editor_engine, editor_engine_commit, editor_schema_version
- 원본 Typie `snapshot_blob`의 standard base64 문자열
- UTF-8 `plain_text_recovery`
- created_at, updated_at

`ui_state`에는 역사적 v1 계약인 Binder `workspace.v1` row만 저장한다. 현재 Binder
selection, expanded ID와 폭을 복원하는 최소 상태다. `world-graph.v1`과
`plot-canvas.v1`은 포함하지 않는다.

Payload v2부터 Story Bible 배열은 canonical row를 보존한다.

- `entities`: kind/status/name/summary/document owner/표현 속성/attributes/timestamp
- `entity_aliases`: 원문과 normalized alias
- `tags`, `entity_tags`: project tag와 entity 연결
- `relation_types`: directed/inverse/builtin 의미를 포함한 built-in/custom type
- `entity_relations`: source/type/target/note canonical row
- `scene_entity_links`: SCENE/entity/role/note explicit link

Entity note의 Typie bytes와 recovery는 `documents`에 있고 `entities.document_id`가 owner를
연결한다. Story Bible 배열 안에 Typie 내부 node/type을 중복 저장하지 않는다.

Payload v3의 `canvases`는 다음을 저장한다.

- id, project_id, name, nullable description
- `document_format = JSON_CANVAS`, `document_version = 1.0`
- canonical `document_json`과 exact bytes의 `content_hash`
- Canvas별 revision
- created_at, updated_at

Canvas node/edge count는 document에서 파생하며 snapshot row에 중복 저장하지 않는다.

Payload v4의 `reader_presets`는 저장된 canonical Reader preset row를
`name COLLATE NOCASE, id` 순서로 보존한다.

- id, project_id, name과 source kind/ID/version
- envelope와 config의 동일한 verification status
- `preset_format = MADI_READER_PRESET`, `preset_version = 1`
- shared camelCase `ReaderRenderConfig` object인 `preset_json`
- canonical config bytes의 lowercase SHA-256 `content_hash`
- preset별 revision과 created/updated timestamp

Renderer bundle의 immutable built-in option은 SQLite row가 아니라서 이 배열에 들어가지
않는다. 다만 canonical table에 provenance가 검증된 `BUILTIN_TEMPLATE` row가 실제로
존재하면 다른 저장 row와 동일하게 capture한다. Config validation과 provenance 규칙은
`READER_PROFILE_FORMAT_V1.md`를 따른다.

## 3. 의도적으로 제외하는 값

- `named_snapshots` row와 이전 payload
- `search_documents` projection 및 trigger-derived cache
- `schema_migrations`
- `world-graph.v1`, `plot-canvas.v1`, `reader-lab.v1`과 다른/future UI-state key
- Canvas viewport, selection, inspector 폭, grid/minimap/snap 옵션
- Canvas session Undo/Redo history와 temporary drag state
- Reader pane 수/slot, scope, preset selection, pane override, scroll/zoom, source selection
- React Flow/Cytoscape object, renderer cache, DOM, timer와 active composition
- Electron window 위치
- Typie runtime cache와 undo stack
- log, API key, account/cloud 상태
- `.bak`, temporary save 또는 SQLite container bytes

Restore는 `workspace.v1`만 교체한다. Snapshot에 포함하지 않은 UI-state key는 그대로
남으므로 World Graph/Canvas viewport와 Reader pane/layout/selection은 현재 사용자 상태를
유지한다. Restore 뒤 유효하지 않은 Reader preset 참조를 고치는 것은 renderer의 UI-state
정규화이며 snapshot payload의 일부가 아니다.

## 4. 생성 종류

### `MANUAL`

사용자 UI/API에서 직접 만들 수 있는 유일한 kind다. 이름과 optional memo를 받는다.
자동 kind를 manual create API로 위조하면 core가 거부한다.

### `AUTO_BEFORE_REPLACE`

선택 치환 commit transaction 안에서 core가 만든다. 모든 document update보다 먼저 현재
logical state를 capture한다. 기본 이름은 `전체 치환 전 — <timestamp>`이며 query,
replacement와 occurrence 수를 note에 기록한다.

### `AUTO_BEFORE_RESTORE`

대상 snapshot restore transaction 안에서 core가 현재 logical state를 먼저 capture한다.
기본 이름은 `복원 전 자동 저장 — <timestamp>`다. Current schema 6에서 생성되므로
v1/v2/v3 target을 복원할 때도 safety snapshot 자체는 Canvas와 Reader preset을 포함한
v4다.

## 5. 생성과 revision

Snapshot 생성/rename/delete는 canonical operation으로 project optimistic revision을 한
번 올리고 pre-operation `.bak`을 만든다. Create는 `BEGIN IMMEDIATE` 안에서 현재 logical
payload를 serialize하고 hash를 계산해 row와 함께 commit한다.

Desktop은 manual create와 restore 직전에 dirty SCENE/ENTITY note와 active Canvas를
flush한다. `workspace.v1`도 debounce timer에 맡기지 않고 즉시 저장한다. 따라서 방금
바꾼 canonical document와 Binder state가 snapshot capture와 경쟁하지 않는다. Canvas
UI state는 flush할 수 있지만 payload에는 들어가지 않는다.

Payload에 현재 named snapshot 목록이나 project revision 자체는 들어가지 않는다.
Logical project를 연속 capture해도 timestamp 때문에 byte-identical payload를 보장하는
content-addressed deduplication 형식은 아니다.

## 6. diff 의미

`diff_named_snapshot`은 target snapshot을 현재 project와 비교해 다음 summary만
계산한다.

- 현재에만 있는 VOLUME/CHAPTER/SCENE 수: `added`
- snapshot에만 있는 VOLUME/CHAPTER/SCENE 수: `deleted`
- 공통 node ID의 title 변경 수
- 공통 node의 parent/sibling position 변경 수
- 공통 document의 snapshot 또는 recovery 변경 SCENE 수
- `현재 전체 SCENE recovery scalar 수 - snapshot scalar 수`
- 추가·삭제·변경된 entity 수
- 추가·삭제·변경된 relation 수
- 추가·삭제되거나 note가 바뀐 explicit scene link 수
- Typie snapshot 또는 recovery가 바뀐 공통 entity note 수
- 추가·삭제·변경된 project tag 수
- 추가·삭제·변경된 built-in/custom relation type 수
- 추가·삭제·변경된 Canvas 수
- `현재 전체 Canvas node 수 - snapshot Canvas node 수`
- `현재 전체 Canvas edge 수 - snapshot Canvas edge 수`
- 추가된 Reader preset 수: `added_reader_presets`
- 삭제된 Reader preset 수: `deleted_reader_presets`
- 공통 ID에서 canonical envelope/config/hash 의미가 바뀐 Reader preset 수:
  `changed_reader_presets`

Canvas changed 비교에는 name/description, document identity/JSON/hash와 creation identity가
포함되고 Canvas revision과 `updated_at`만 다른 경우는 semantic change로 세지 않는다.
Reader preset changed 비교에는 name, provenance, verification, format/version, canonical
config, content hash와 `created_at` identity가 포함되고 preset revision과 `updated_at`만
다른 경우는 semantic change로 세지 않는다.
세부 node-by-node patch, Canvas별 diff, 본문 line/style diff와 merge는
제공하지 않는다. 기존 `changed_scene_bodies`와 character delta는 SCENE document만
계산하며 entity note나 Canvas text를 원고 통계에 섞지 않는다.

## 7. restore 검증

Restore 확인 button을 누르면 Desktop이 target diff를 fresh하게 다시 읽는다. 확인창에
표시했던 snapshot ID, project revision과 전체 summary가 fresh 결과와 모두 같아야
restore를 시작한다. 달라졌으면 갱신된 summary에 대한 새 확인이 필요하다.

Core는 다음을 검증한다.

1. row가 현재 project 소속인지 확인
2. `payload_format`, table payload version과 embedded format/version 확인
3. exact payload bytes의 SHA-256 확인
4. JSON decode와 payload project ID 확인
5. node ID/title/order, hierarchy, WORK와 SCENE-document 1:1 확인
6. entity/document owner와 alias/tag/relation/link 무결성 확인
7. v2/v3/v4의 built-in relation type 10개와 v1 빈 Story Bible 계약 확인
8. document project/editor metadata/base64 확인
9. UI state가 `workspace.v1`뿐인지 확인
10. v1/v2가 Canvas array를 위조하지 않았는지 확인
11. v3 Canvas ID/project/metadata/document identity/revision/timestamp 확인
12. 각 Canvas JSON 구조, canonical serialization, content hash, geometry/group/edge
    endpoint와 count/size limit 확인
13. v1/v2/v3가 Reader preset array를 위조하지 않았는지 확인
14. v4 Reader preset의 project, ID, provenance, verification, exact config shape,
    canonical hash, revision과 timestamp 확인

검증 실패는 `SnapshotIntegrity` 오류이며 현재 project를 바꾸지 않는다.

## 8. 원자적 restore

Desktop은 dirty SCENE/ENTITY note/active Canvas와 필요한 UI state를 flush한 뒤 one-live
Typie editor에 exclusive lock을 건다. Hidden input/surface를 disabled/inert로 만들며
lock 동안 `Ctrl+S`, Undo/Redo, scene break, focus와 owner transition은 fail-closed다.

Core restore는 pre-operation SQLite backup 뒤 하나의 `BEGIN IMMEDIATE` 안에서
수행한다.

1. expected revision 재확인
2. target row load
3. 현재 logical v4 payload capture
4. 현재 payload를 `AUTO_BEFORE_RESTORE`로 insert
5. target hash/decode/구조 검증
6. 현재 tree, documents, Story Bible, canvases, reader presets와 `workspace.v1` 삭제
7. project/app metadata, documents, tree, Story Bible, Canvas, Reader preset과
   `workspace.v1`을 FK 순서로 재생성
8. documents trigger를 통한 search projection 재구성
9. project revision 한 번 증가
10. commit 및 file sync

`named_snapshots` table은 지우지 않으므로 target과 safety snapshot을 포함한 목록은
restore 뒤에도 유지된다. 어느 단계에서든 실패하면 safety snapshot insert와 logical
state 변경이 함께 rollback된다.

DB restore 뒤 Binder/Story Bible/Canvas 목록과 유효 editor owner를 reload할 때까지
exclusive lock을 해제하지 않는다. Canvas reference display는 reload한 Story Bible과
tree 기준으로 broken 여부를 다시 파생한다. Commit 뒤 reload 실패는 임시 editor graph를
canonical DB에 저장하지 못하게 fail-closed 처리한다.

## 9. v1/v2/v3 호환과 current v4

Decoder는 payload version 1, 2, 3, 4만 수용한다. 명시적으로 지원하는 older payload의
newer array는 빈 값으로 decode하지만, older payload가 더 최신 데이터를 위조할 수는 없다.

### Payload v1

- project/tree/SCENE documents/`workspace.v1`만 의미가 있다.
- 비어 있지 않은 Story Bible, Canvas 또는 Reader preset array는 integrity 오류다.
- Restore는 사용자 Story Bible, Canvas와 Reader preset을 빈 상태로 만들고 built-in
  relation type 10개만 다시 seed한다.

### Payload v2

- Story Bible과 entity note를 포함한다.
- 비어 있지 않은 Canvas 또는 Reader preset array는 integrity 오류다.
- Restore는 v2 Story Bible을 복원하고 Canvas와 Reader preset은 빈 상태로 만든다.

### Payload v3

- v2 전체와 Canvas canonical row를 포함한다.
- Canvas metadata/document/hash/revision까지 logical restore한다.
- Canvas UI state와 session Undo history는 포함하지 않는다.
- 비어 있지 않은 Reader preset array는 integrity 오류이며 restore 결과는 preset이 빈
  상태다.

### Payload v4

- v3 전체와 canonical `reader_presets` row를 포함한다.
- Reader preset envelope/config/hash/revision/timestamp를 logical restore한다.
- `reader-lab.v1` pane/layout/selection UI state는 포함하지 않는다.

V1/v2 restore가 현재 Canvas를, v1/v2/v3 restore가 현재 Reader preset을 암묵적으로
유지하거나 merge하지 않는 이유는 snapshot target을 정확히 재현하기 위해서다. Restore
직전 현재 schema 6 state는 Canvas와 Reader preset을 담은 v4
`AUTO_BEFORE_RESTORE`로 보존되므로 사용자는 safety snapshot으로 돌아갈 수 있다.

## 10. 한계

- unknown format/version은 자동 변환하지 않는다.
- payload는 압축하지 않아 Typie base64와 Canvas JSON 크기에 비례해 커진다.
- named snapshot마다 SCENE/ENTITY note/Canvas document/Reader preset을 복제하므로 저장 공간은
  snapshot 수와 project 크기에 비례한다.
- hash는 무결성 검사용이며 서명, 인증, 암호화 또는 비밀성 보장이 아니다.
- runtime Undo history는 payload에 포함하지 않는다.
- partial restore, merge, per-scene/Canvas restore와 automatic pruning은 없다.

검증 결과와 test 수는 실제 실행 로그가 있는 Phase 결과 문서에서만 보고한다.

## 11. 관련 문서

- [Phase 1F result](./PHASE_1F_RESULT.md)
- [`.madi` file format v1 draft](./MADI_FILE_FORMAT_V1_DRAFT.md)
- [Reader profile format v1](./READER_PROFILE_FORMAT_V1.md)
