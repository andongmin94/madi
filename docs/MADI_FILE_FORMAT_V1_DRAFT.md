# `.madi` 파일 포맷 v1 초안

기준일: 2026-08-02

```text
Specification status: DRAFT
Logical format version: 1
SQLite schema version: 2
Implementation conformance: PHASE 1A PASS — HARDENING GAPS DOCUMENTED
Migration/core-sidecar round-trip: PASS WITH LIMITS
```

이 문서는 Phase 1A의 저장 계약을 기록한다. 이 명세의 문구만으로 구현 적합성을
증명하지는 않으며, 현재 migration·재열기 검증 증거와 제한은
`PHASE_1A_RESULT.md`를 따른다. 배포 전에는 구현과 fixture를 다시 대조해 이 초안을
확정 문서로 승격해야 한다.

`MUST`, `MUST NOT`, `SHOULD`는 각각 필수, 금지, 권고 요구사항이다.

## 1. 식별과 version

- 확장자: `.madi`
- 실제 container: SQLite 3
- SQLite header: `SQLite format 3\0`
- `PRAGMA application_id`: `0x4D414449` (`MADI`, decimal `1296122953`)
- `app_meta.format_name`: `madi`
- `app_meta.format_version`: `1`
- `app_meta.schema_version`: `2`
- `PRAGMA user_version`: `2`

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

- 모든 document는 같은 project의 SCENE 하나와 정확히 1:1로 연결된다.
- `documents.title`은 연결 SCENE title과 일치한다.
- `snapshot_blob`은 base64 text가 아니라 원본 Typie changeset bundle bytes다.
- `plain_text_recovery`는 사람이 읽을 수 있는 UTF-8 긴급 복구 copy다.
- `editor_engine`, `editor_engine_commit`, `editor_schema_version`은 snapshot을 해석할
  adapter identity다.
- `madi.scene-break.v1`은 Typie snapshot의 의미 node로 보존하고 recovery에서는
  기존 계약대로 `\n\n***\n\n` marker가 된다.

새 SCENE의 document는 adapter가 첫 editor instance를 만들기 전까지
`editor_engine_commit = 'uninitialized'`와 빈 snapshot payload를 가질 수 있다.
빈 payload를 유효한 Typie snapshot이라고 가장하지 않는다. 최초 load 시 adapter가
빈 document를 만들고 최초 성공 save에서 실제 commit/schema/snapshot을 기록한다.

## 3. schema v2

아래 SQL은 v1의 목표 schema다. 실제 migration은 `IF NOT EXISTS`만으로 성공을
판정하지 않고, migration record와 전체 불변식을 함께 검증해야 한다.

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

`value_json`은 cache나 임의 renderer object 저장소가 아니다. Rust core의
`ui_state` API는 versioned key와 JSON value를 보존하는 generic 저장 경계다.
Electron main이 `workspace.v1`의 snake_case shape, node ID, 최대 1,000개 expanded
ID와 Binder 폭을 검증한다. renderer는 원고 text, snapshot, DOM, selection,
viewport, composition payload 또는 timer state를 이 값에 넣지 않는다.

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
8. 모든 documents row는 같은 project의 SCENE 하나에서 참조한다.
9. parent와 child는 같은 project다.
10. self-parent, cycle, 고아 node와 고아 document를 허용하지 않는다.
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

새 v1 project는 대상과 같은 directory의 고유 임시 SQLite 파일에서 다음을 하나의
transaction으로 만든다.

1. v0 table과 schema migration 1
2. `projects`, `tree_nodes`, `ui_state`와 schema migration 2
3. `app_meta` 한 row
4. 같은 ID의 `projects` 한 row
5. project title을 가진 WORK 한 row
6. WORK 아래 초기 document title을 가진 CHAPTER 한 row
7. CHAPTER 아래 같은 title의 SCENE과 document 한 쌍

초기 VOLUME은 만들지 않는다. 기본 node/document는 기존 “새 파일을 만들면 바로 쓸
수 있음” 동작을 유지하기 위한 최소값이다. core의 `document_title`을 생략하면 project
title을 사용하며, 현재 desktop create path도 project title을 넘긴다. 이후 Binder의
추가 동작은 `새 권`, `새 화`, `새 장면`을 기본 제목으로 사용한다.

schema를 만들고 `application_id = 0x4D414449`, `user_version = 2`를 설정한 뒤 file을
sync한다. destination이 이미 있으면 덮어쓰지 않는다. 완성된 임시 파일만 기존 v0의
no-clobber publish 절차로 destination 이름에 연결한다.

## 7. v0 → v1 migration

입력은 `format_version = 0`, `schema_version = 1`, `user_version = 1`인 유효한 v0
파일이다. migration 전에는 application ID, metadata, `quick_check`와 지원 version을
검사한다.

### 절차

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
13. 성공하면 commit한다.

v0는 현재 기본 document 한 개를 가지므로 일반 migration 결과는 WORK → `본문`
CHAPTER → SCENE 한 경로다. 방어적으로 여러 legacy document가 있으면 같은 `본문`
CHAPTER 아래에 순서대로 SCENE을 만들어 orphan이 되지 않게 한다. VOLUME은
자동으로 만들지 않는다.

ui_state row는 migration 필수가 아니다. 값이 없으면 open 시 첫 유효 SCENE,
container 기본 펼침 상태와 기본 폭 `300`을 계산하고, 첫 UI state save에서
`workspace.v1`을 기록한다.

어느 단계든 실패하면 전체 transaction을 rollback하고 원본 v0 metadata와 document를
그대로 유지한다. 현재 구현은 migration 전 `.bak`을 만들지 않으므로 pre-migration
backup이 있다고 주장하지 않는다. 손상된 row를 버리고 migration을 성공 처리하거나
빈 v1 project로 대체하면 안 된다.

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

## 12. UI state 정규화

disk의 `workspace.v1` 계약:

- `selected_node_id`: `string | null`
- `expanded_node_ids`: string array, 최대 1,000개
- `binder_width`: finite number, Phase 1A 지원 범위 `220..640`

preload의 TypeScript 값은 각각 `selectedNodeId`, `expandedNodeIds`, `binderWidth`이며
Electron main이 disk snake_case와 renderer camelCase를 변환한다.

save 때:

1. renderer는 현재 tree의 non-SCENE node만 expanded list로 만든다.
2. main은 selected/expanded 값이 제한된 node ID 문자열인지 확인한다.
3. main은 expanded 개수와 width `220..640` 범위를 확인한다.
4. core는 generic JSON을 `BEGIN IMMEDIATE` upsert로 저장한다.
5. 이 write는 manuscript revision과 canonical backup rotation을 바꾸지 않는다.

load 때:

1. main은 JSON shape와 node ID 및 width를 다시 검사한다.
2. renderer는 UI-state load/validation 오류를 `{ state: null }`로 격리해 tree
   복원을 계속한다.
3. renderer는 없는 expanded ID를 제거하고 유효한 branch만 펼침 상태에 적용한다.
4. 존재하지 않는 selected ID는 session SCENE, 첫 SCENE, WORK 순으로 대체한다.
5. 존재하는 non-SCENE selected ID는 유지하고 안내 화면을 표시한다.
6. SCENE이 없으면 WORK를 선택하고 editor를 비활성화한다.
7. 저장 row가 없거나 invalid이면 모든 branch를 펼치고 width 기본값 `300`을
   사용한다.

현재 core의 generic UI-state API 자체는 tree 존재 여부나 container 여부를 sanitize하지
않는다. application renderer/main 경계가 `workspace.v1`을 제한한다. UI state 손상
때문에 canonical node/document를 삭제하거나 고치지 않는다.

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
완전 검증하지 않는다. mutation API와 현재 한-project create/migration path는 이
불변식을 유지하지만, 임의로 변조한 SQLite에 대한 추가 corruption test와 scan은
별도 hardening 대상이다.

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

- v0는 backup 후 명시적 schema 2 migration을 수행한다.
- v1 reader는 v0 snapshot bytes를 decode하지 않고 그대로 연결한 뒤 기존 adapter
  compatibility contract를 사용한다.
- `user_version > 2`, `schema_version > 2` 또는 알 수 없는 format은 downgrade하지
  않는다.
- Typie commit/schema 변경은 별도 upgrade rehearsal과 migration 없이는 자동
  변환하지 않는다.
- `plain_text_recovery`는 비상 copy이며 rich document를 완전히 재구성한다는 보장은
  없다.
- v1 파일을 v0 앱이 쓸 수 있다고 약속하지 않는다.

위 unknown-format 선거부는 목표 계약이다. 현재 open 순서는 `application_id`와
`user_version`을 본 뒤 v2 migration을 먼저 실행하고, 그 다음 `quick_check`와
`app_meta` format/schema를 검증한다. 따라서 `user_version = 1`인 변조 파일의
unknown `app_meta.format_version`을 migration 전에 거부하는 conformance는
`PENDING`이다.

## 16. 요구 test와 현재 결과

집중 test와 최종 aggregate gate를 구분한다. 상세 결과와 구현 gap은
`docs/PHASE_1A_RESULT.md`를 따른다.

| 영역 | 필수 검증 | 결과 |
|---|---|---|
| schema | 새 v1 create의 table/index/version | `PASS` — Rust |
| migration | 실제 v0 fixture의 공통 `본문` CHAPTER backfill | `PASS` — failure rollback test와 pre-migration backup은 없음 |
| hierarchy | 허용 edge와 대표 금지 edge | `PASS` — Rust |
| root | project당 WORK 정확히 하나 | `PASS` — Rust |
| scene-document | create/rename/load/save/delete 연결 | `PASS` — Rust |
| transaction | stale revision no-overwrite와 transaction-bound mutation | `PASS` — process-kill fault injection은 `DEFERRED TO HARDENING` |
| ordering | append/midpoint/reorder/move/reopen | `PASS` — Rust/sidecar 범위 |
| delete | non-leaf 거부, explicit recursive, WORK 금지 | `PASS` — Rust |
| UI state | generic JSON save/load와 malformed `workspace.v1` default fallback | `PASS` — 다중 Binder Electron reopen 포함 |
| content | 6 SCENE 중 3개의 한국어 snapshot/recovery | `PASS` — 2-process sidecar |
| scene break | `madi.scene-break.v1` 하나 save/reopen | `PASS` — 2-process sidecar |
| lifecycle | 두 core process와 실제 Electron process reopen | `PASS` — 개발/packaged 앱 |
| regression | 변경 뒤 최종 `pnpm verify` | `PASS` — exit 0 |
| package | 변경 뒤 `pnpm package:unpacked` | `PASS` — Windows unpacked |

Phase 1A의 구현·회귀·package gate는 통과했다. 이 문서는 계속 v1 **초안**이며,
위에 명시한 migration preflight와 임의 변조 DB open audit은 hardening 과제로 남는다.
