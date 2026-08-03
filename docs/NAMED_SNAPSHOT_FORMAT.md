# Named snapshot logical payload 형식

기준일: 2026-08-02

```text
Storage table: named_snapshots
payload_format: MADI_LOGICAL_JSON
payload_version: 2 (decoder accepts 1 and 2)
embedded format: madi.logical-snapshot
embedded version: 2 (decoder accepts 1 and 2)
encoding: UTF-8 JSON, uncompressed
integrity: SHA-256 of exact payload_blob bytes
```

이 snapshot은 `.madi` SQLite 파일의 byte copy가 아니다. project의 canonical logical
state를 versioned JSON으로 직렬화한 payload다. 따라서 named snapshot table이나
검색 projection을 재귀적으로 포함하지 않는다.

## 1. table 계약

schema 4의 row는 다음 값을 가진다.

| column | 의미 |
|---|---|
| `id` | snapshot UUID/고유 ID |
| `project_id` | 이 `.madi`의 project ID |
| `name` | trim 후 비어 있지 않은 표시 이름 |
| `note` | nullable 사용자 메모 |
| `kind` | `MANUAL`, `AUTO_BEFORE_REPLACE`, `AUTO_BEFORE_RESTORE` |
| `payload_format` | `MADI_LOGICAL_JSON` |
| `payload_version` | 새 snapshot은 `2`; 기존 `1`도 복원 가능 |
| `payload_blob` | uncompressed UTF-8 JSON bytes |
| `content_hash` | payload bytes의 lowercase 64자리 SHA-256 hex |
| `created_at` | UTC timestamp |
| `updated_at` | UTC timestamp; 이름 변경 때 갱신 |

목록 정렬은 `created_at DESC, id`다. payload는 일반 목록 응답에 포함하지 않고 format,
version, byte length와 hash만 반환한다.

## 2. payload shape

현재 Rust 구조를 JSON 표기로 줄이면 다음과 같다.

```json
{
  "format": "madi.logical-snapshot",
  "version": 2,
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
  "scene_entity_links": []
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

`ui_state`에는 `workspace.v1` row만 저장한다. 현재 selection, expanded Binder ID와 폭을
복원하는 데 필요한 최소 상태다.

Payload v2의 Story Bible 배열은 schema v4 canonical row를 보존한다.

- `entities`: kind/status/이름/요약/document owner/표현 속성/attributes JSON/timestamp
- `entity_aliases`: 원문과 normalized alias
- `tags`, `entity_tags`: project tag와 entity 연결
- `relation_types`: directed/inverse/builtin 의미를 포함한 built-in/custom type
- `entity_relations`: source/type/target/note canonical row
- `scene_entity_links`: SCENE/entity/role/note explicit link

Entity note의 Typie bytes와 recovery는 `documents`에 있고 `entities.document_id`가 owner를
연결한다. Story Bible 배열 안에 Typie 내부 node/type을 중복 저장하지 않는다.

## 3. 의도적으로 제외하는 값

- `named_snapshots` row와 이전 payload
- `search_documents` projection 및 trigger-derived cache
- `schema_migrations`
- 다른/future UI-state key
- renderer cache, DOM, scroll measurement, timer와 active composition
- Electron 창 위치
- Typie runtime cache와 undo stack
- log, API key, account/cloud 상태
- `.bak`, 임시 save 또는 SQLite container bytes

restore는 `workspace.v1`만 교체하므로 snapshot에 포함하지 않은 future UI-state key는
그대로 남는다.

## 4. 생성 종류

### `MANUAL`

사용자 UI/API에서 직접 만들 수 있는 유일한 kind다. 이름과 선택 메모를 받는다. 자동
kind를 manual create API로 위조하려 하면 core가 거부한다.

### `AUTO_BEFORE_REPLACE`

선택 치환 commit transaction 안에서 core가 생성한다. 모든 document update보다 먼저
현재 logical state를 캡처한다. 기본 이름은 `전체 치환 전 — <timestamp>`이며 query,
replacement와 occurrence 수를 note에 기록한다.

### `AUTO_BEFORE_RESTORE`

대상 snapshot restore transaction 안에서 core가 현재 logical state를 먼저 캡처한다.
기본 이름은 `복원 전 자동 저장 — <timestamp>`다.

## 5. 생성과 revision

snapshot 생성/rename/delete는 canonical operation으로 project optimistic revision을
한 번 올리고 pre-operation `.bak`을 만든다. create는 `BEGIN IMMEDIATE` 안에서 현재
logical payload를 직렬화하고 hash를 계산해 row와 함께 commit한다.

Desktop은 manual create와 restore 직전에 dirty SCENE 또는 ENTITY note를 flush하고 현재
`workspace.v1`을 debounce timer에 맡기지 않고 즉시 저장한다. 따라서 방금 바꾼
Binder selection/expanded state/폭이 snapshot capture와 경쟁하지 않는다.

payload에 현재 named snapshot 목록이나 revision 자체는 들어가지 않는다. 동일한
logical project를 연속 캡처해도 timestamps 때문에 byte-identical payload를 보장하는
content-addressed deduplication 형식은 아니다.

## 6. diff 의미

`diff_named_snapshot`은 target snapshot을 현재 project와 비교해 다음 summary만
계산한다.

- 현재에만 있는 VOLUME/CHAPTER/SCENE 수: `added`
- snapshot에만 있는 VOLUME/CHAPTER/SCENE 수: `deleted`
- 공통 node ID의 title 변경 수
- 공통 node의 parent/sibling position 변경 수
- 공통 document의 snapshot 또는 recovery 변경 장면 수
- `현재 전체 recovery scalar 수 - snapshot scalar 수`
- 추가·삭제·변경된 entity 수
- 추가·삭제·변경된 relation 수
- 추가·삭제되거나 note가 바뀐 explicit scene link 수
- Typie snapshot 또는 recovery가 바뀐 공통 entity note 수
- 추가·삭제·변경된 project tag 수
- 추가·삭제·변경된 built-in/custom relation type 수

기존 `changed_scene_bodies`와 character delta는 SCENE document만 계산하며 entity note를
원고 통계에 섞지 않는다. 본문 line diff, style diff, 장면별 patch 또는 merge는
제공하지 않는다.

## 7. restore 검증

restore 확인 button을 누르면 Desktop이 target diff를 fresh하게 다시 읽는다. 확인창에
표시했던 snapshot ID, project revision과 전체 summary가 fresh 결과와 모두 같아야만
restore를 시작한다. 달라졌으면 fresh summary를 표시하고 두 번째 사용자 확인을
요구한다. 그 다음 core는 다음 payload 검증을 수행한다.

1. row가 현재 project 소속인지 확인
2. `payload_format`과 `payload_version` 확인
3. exact payload bytes의 SHA-256 확인
4. JSON decode와 embedded format/version 확인
5. payload project ID 확인
6. node ID, title, finite/unique sibling order와 WORK 정확히 하나 확인
7. parent-kind edge와 SCENE-document 1:1 set 확인
8. entity/document 1:1 ownership과 SCENE owner 중복 없음 확인
9. alias/tag/relation/link의 ID·project·FK·unique·role·directed 의미와 alias 정규화 확인
10. v2 payload에 project-scoped deterministic ID의 built-in relation type 10개가 있고
    해당 row만 `is_builtin`인지 확인
11. document project/editor metadata/base64 확인
12. UI state가 `workspace.v1`뿐인지 확인

검증 실패는 `SnapshotIntegrity` 오류이며 현재 project를 바꾸지 않는다.

## 8. 원자적 restore

Desktop은 dirty SCENE 또는 ENTITY note/UI state를 flush한 뒤 one-live Typie editor에
exclusive lock을
건다. hidden input/surface를 disabled/inert로 만들며 lock 동안 `Ctrl+S`, Undo/Redo,
scene break, focus/reveal과 장면 전환은 fail-closed다. suppress하지 않은 editor mutation은
restore를 중단한다.

core restore는 pre-operation SQLite backup 뒤 하나의 `BEGIN IMMEDIATE` 안에서
수행한다.

1. expected revision 재확인
2. target row load
3. 현재 logical payload capture
4. 현재 payload를 `AUTO_BEFORE_RESTORE`로 insert
5. target hash/decode/구조 검증
6. 현재 tree, documents, Story Bible, `workspace.v1` 삭제
7. project/app metadata, documents, tree, Story Bible, `workspace.v1`을 FK 순서로 재생성
8. documents insert trigger를 통한 search projection 재구성
9. project revision 한 번 증가
10. commit 및 file sync

`named_snapshots` table은 지우지 않으므로 target과 safety snapshot을 포함한 목록은
복원 뒤에도 유지된다. 어느 단계에서든 실패하면 safety snapshot insert와 logical
state 변경이 함께 rollback된다.

DB restore 뒤 Binder/UI state와 유효 SCENE snapshot을 reload할 때까지 exclusive lock을
해제하지 않는다. 설정 mode에서 시작했다면 유효 entity note와 Story Bible state도
reload한다. commit 뒤 reload가 실패하면 temporary graph를 save하지 못하는 fatal
lock을 유지한다. 시작 전 user change는 flush됐으므로 이 상태에서는 close만 허용하고
앱을 다시 시작해 canonical `.madi` state를 연다.

## 9. 호환성과 한계

Payload v1은 새 Story Bible 배열을 가지지 않는다. Decoder는 누락된 배열을 빈 배열로
해석하되, version 1 payload가 비어 있지 않은 Story Bible 배열을 위조하면 integrity
오류로 거부한다. v1 복원 순서는 다음과 같다.

1. 현재 v2 전체 상태를 `AUTO_BEFORE_RESTORE`로 보존
2. v1의 project/tree/SCENE documents/`workspace.v1` 복원
3. 사용자 entities/aliases/tags/relations/scene links와 entity note를 빈 상태로 유지
4. 현재 schema v4가 요구하는 built-in relation type 10개만 idempotent하게 재생성

따라서 구버전 복원이 현재 Story Bible을 암묵적으로 유지하거나 섞지 않는다. Desktop은
payload v1을 구버전 snapshot으로 표시하고 설정 데이터가 비워짐을 복원 전에 알린다.

- unknown format/version은 자동 변환하지 않는다.
- payload는 압축하지 않는다. Typie snapshot을 base64 JSON으로 저장하므로 원본 BLOB보다
  커진다.
- named snapshot마다 모든 SCENE/ENTITY note snapshot을 복제하므로 저장 공간은 snapshot
  수와 project 크기에 비례한다.
- hash는 무결성 검사용이며 서명, 인증, 암호화 또는 비밀성 보장이 아니다.
- runtime undo history는 payload에 포함되지 않는다.
- 부분 restore, merge, per-scene restore와 retention/automatic pruning은 없다.

집중 Rust test는 payload hash mismatch, recursive snapshot 비포함, future UI key 보존,
tree/document/Story Bible restore, v1 compatibility, auto-before-restore와 failure rollback,
CRUD/diff/reopen을 검증한다.
Desktop test는 fresh diff revision/summary 재검증, restore exclusive lock과 storage reload
완료 전 save 거부를 검증한다.
