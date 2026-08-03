# Story Bible 데이터 모델

기준일: 2026-08-02

```text
logical format version: 1
SQLite schema version: 4
Story Bible snapshot payload version: 2
```

## 1. 소유권 모델

`.madi` 파일은 project와 manuscript tree, scene/entity documents, Story Bible tables와
named snapshots를 함께 보관한다. Scene과 entity note는 같은 `documents` 저장 계약을
사용하지만 소유자는 명시적으로 분리한다.

```text
SCENE tree_nodes.document_id ──┐
                               ├── documents
ENTITY entities.document_id ───┘
```

하나의 document는 scene 또는 entity 하나만 소유할 수 있다. Entity 생성 transaction은
빈 Typie document와 entity를 함께 만들고, entity 삭제 transaction은 참조 데이터를
정리한 뒤 note document를 제거한다.

## 2. `entities`

| 열 | 의미 |
|---|---|
| `id` | entity 식별자 |
| `project_id` | 소유 project |
| `kind` | 지원되는 8개 kind |
| `name` | 비어 있지 않은 표시 이름 |
| `summary` | nullable 한 줄 요약 |
| `document_id` | 고유한 상세 note document |
| `status` | `ACTIVE`, `DRAFT`, `ARCHIVED` |
| `color_token` | nullable UI token |
| `icon_key` | nullable icon key |
| `attributes_json` | 유효한 JSON object |
| `created_at`, `updated_at` | DB timestamp |

Kind는 `CHARACTER`, `LOCATION`, `ORGANIZATION`, `ITEM`, `EVENT`, `WORLD_RULE`,
`FORESHADOWING`, `OTHER`로 제한한다. 같은 project의 동일 name은 허용하지만 list/query
결과에 duplicate warning을 계산한다.

`attributes_json`은 향후 확장 지점일 뿐 Phase 1C에서 kind별 schema를 정의하지 않는다.
크기 제한과 JSON object 검증은 main boundary와 Rust core 양쪽에서 수행한다.

## 3. Alias와 tag

`entity_aliases`는 entity FK, 원문 alias와 normalized alias를 가진다. 빈 alias를 거부하고
`(entity_id, normalized_alias)` unique로 같은 entity 안의 중복을 막는다. 원문은 한국어,
영어, 숫자와 공백을 UTF-8 그대로 보존한다.

`tags`는 project별 이름과 optional color token을 가진다. `entity_tags`의 복합 PK가
중복 연결을 막으며 trigger/core 검증이 entity와 tag의 project 일치를 강제한다.

## 4. Relation type

`relation_types`는 다음을 저장한다.

- forward `name`
- nullable `inverse_name`
- `directed`
- nullable `color_token`
- `is_builtin`
- project FK와 timestamps

새 project와 v3→v4 migration은 프로젝트별 deterministic ID로 10개 built-in type을
seed한다. Seed는 idempotent하며 같은 DB에 project가 여러 개 있어도 충돌하지 않는다.

## 5. Entity relation

`entity_relations`는 project, source entity, relation type, target entity와 optional note를
가진다. FK와 core 검증으로 세 객체의 project 일치를 강제하고 self relation을 거부한다.

Directed type은 순서를 그대로 unique key에 사용한다. Undirected type은 endpoint를
canonical order로 비교하므로 역방향 insert도 같은 논리 관계로 거부한다. Incoming과
inverse 표시는 별도 row가 아니라 같은 canonical row의 view다.

## 6. Scene link

`scene_entity_links`의 복합 PK는 `(scene_node_id, entity_id, role)`이다. Role은
`APPEARS`, `POV`, `MENTIONED`, `RELATED`로 제한한다.

DB trigger와 core가 다음을 강제한다.

- node kind가 `SCENE`
- scene과 entity의 project 일치
- 동일 triple 중복 금지

자동 mention 후보는 이 table에 쓰지 않는다.

## 7. Revision과 transaction

모든 mutation은 파일의 current project revision을 읽고 optional expected revision과
대조한다. 성공한 logical mutation은 revision을 한 번 증가시키고 backup metadata와
결과 row를 반환한다. 실패하면 transaction 전체를 rollback한다.

Entity note save는 owner kind/id, document id, engine metadata, generation과 save sequence를
검증한다. 오래된 scene 응답이 entity note를 덮거나 그 반대가 되는 owner 혼동을
허용하지 않는다.

## 8. 삭제

삭제 impact는 relation, explicit scene link, mention candidate scene, alias, tag와 note
글자 수를 계산한다. 사용자가 확인한 뒤 다음을 한 transaction에서 제거한다.

1. relation
2. scene link
3. alias와 entity-tag link
4. entity
5. entity note document

본문 원고와 mention source text는 바꾸지 않는다. 사용 중인 relation type 삭제는
거부한다.

## 9. Snapshot logical order

Payload v2는 project/tree/documents/UI state 다음에 entities, aliases, tags, entity-tags,
relation types, relations와 scene links를 deterministic order로 직렬화한다. Entity note는
일반 documents 집합에 포함되고 owner reference로 연결된다. Search projection, 기존 named
snapshot과 runtime cache는 제외한다.

Restore는 FK dependency order로 insert하고 orphan/cross-project 상태를 검증한 뒤에만
commit한다.
