# `.madi` 파일 포맷 v0

## 식별

- 확장자: `.madi`
- 실제 container: SQLite 3
- SQLite header: `SQLite format 3\0`
- `PRAGMA application_id`: `0x4D414449` (`MADI`, decimal `1296122953`)
- `app_meta.format_name`: `madi`
- `app_meta.format_version`: `0`
- `app_meta.schema_version`: `1`
- `PRAGMA user_version`: `1`

확장자만 바꾼 임의 SQLite 파일은 `application_id`와 metadata 검증에서 거부한다.

## Schema v1

```sql
CREATE TABLE app_meta (
    singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
    format_name TEXT NOT NULL,
    format_version INTEGER NOT NULL,
    schema_version INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    last_saved_by TEXT NOT NULL,
    project_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0)
);

CREATE TABLE documents (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    editor_engine TEXT NOT NULL,
    editor_engine_commit TEXT NOT NULL,
    editor_schema_version INTEGER NOT NULL,
    snapshot_blob BLOB NOT NULL,
    plain_text_recovery TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES app_meta(project_id) ON DELETE CASCADE
);

CREATE INDEX documents_project_id_idx ON documents(project_id);

CREATE TABLE schema_migrations (
    version INTEGER NOT NULL PRIMARY KEY,
    applied_at TEXT NOT NULL,
    description TEXT NOT NULL
);
```

Phase 0는 `app_meta` 한 행과 기본 `documents` 한 행을 만든다. 작품/권/화/장면
hierarchy는 이 버전에 추가하지 않는다.

## Field 의미

### `app_meta`

- `created_by`, `last_saved_by`: 저장한 앱/코어 버전 식별자
- `project_id`: 파일 내부 project UUID
- `revision`: 성공한 document save마다 1 증가하는 optimistic concurrency token
- timestamp: SQLite UTC `strftime`, ISO 8601 형태

### `documents`

- `editor_engine`: Phase 0에서는 `typie`
- `editor_engine_commit`: 정확한 40자 Typie Git commit
- `editor_schema_version`: madi adapter가 이해하는 snapshot 계약 버전
- `snapshot_blob`: base64가 아닌 원본 Typie changeset bundle bytes
- `plain_text_recovery`: 사람이 읽을 수 있는 UTF-8 recovery copy

### `schema_migrations`

적용된 migration version, UTC 적용 시각, 설명을 기록한다. `PRAGMA user_version`과
함께 검사한다.

## 생성

1. 대상과 같은 directory에 고유한 임시 SQLite 파일을 만든다.
2. `journal_mode=DELETE`, `synchronous=FULL`, foreign keys와 schema를 적용한다.
3. metadata와 기본 document를 transaction으로 기록하고 file을 sync한다.
4. 완성된 임시 파일을 destination에 hard-link해 이미 생긴 파일을 덮어쓰지 않는다.
5. link가 성공한 뒤 임시 이름을 제거한다.

기존 destination은 직접 교체하지 않는다.

## 저장

1. `application_id`, format/schema version, `quick_check`를 검증한다.
2. 현재 revision이 caller의 `expected_revision`과 같은지 확인한다.
3. `VACUUM INTO`로 transaction-consistent pre-save backup을 만들고 sync한다.
4. `.bak`과 `.bak.previous` 두 세대를 회전한다.
5. `BEGIN IMMEDIATE` 안에서 revision을 다시 검사한다.
6. document row와 `app_meta.revision`을 같은 transaction에서 갱신한다.
7. commit한 `.madi` 파일을 sync한다.

저장 도중 충돌 또는 오류가 나면 기존 document row를 부분적으로 갱신하지 않는다.

## 호환성

- `application_id`가 다르면 `.madi`로 열지 않는다.
- 알려진 값보다 높은 `user_version` 또는 `schema_version`은 자동 downgrade하지 않는다.
- 알 수 없는 `format_version`은 열지 않는다.
- Typie commit 또는 editor schema가 바뀌면 snapshot migration/compatibility probe가
  먼저 필요하다.
- `plain_text_recovery`는 snapshot codec 장애 시의 비상 경로이며 rich document를
  완전히 재구성할 수 있다는 보장은 없다.
