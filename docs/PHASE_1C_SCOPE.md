# Phase 1C — Story Bible Foundation 범위

기준일: 2026-08-02

```text
Phase 1B verdict: TECHNICAL GO — PRIVATE LOCAL
Phase 1C target: STORY BIBLE FOUNDATION
Windows native Korean IME: MANUAL VALIDATION PENDING
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Public/paid/customer distribution: NOT AUTHORIZED
```

## 1. 목적

Phase 1C는 관계 그래프를 그리기 전에 안정적인 canonical Story Bible 데이터를 만든다.
설정 엔트리, 별칭, 태그, 명시적 관계, 장면 연결, 본문 언급 후보와 Typie 상세 노트를
단일 `.madi` 파일에 저장하고 snapshot/restore와 앱 재시작 경계까지 검증한다.

## 2. 포함 범위

- `CHARACTER`, `LOCATION`, `ORGANIZATION`, `ITEM`, `EVENT`, `WORLD_RULE`,
  `FORESHADOWING`, `OTHER` entity
- `ACTIVE`, `DRAFT`, `ARCHIVED` 상태
- entity별 summary, color token, icon key와 확장용 JSON attributes
- entity별 별칭과 프로젝트별 태그
- built-in/custom relation type과 directed/undirected/inverse 의미
- entity 사이의 명시적 relation
- SCENE과 entity의 `APPEARS`, `POV`, `MENTIONED`, `RELATED` link
- entity 이름/별칭을 이용한 exact substring 언급 후보 탐색
- 후보를 명시적 scene link로 승격
- entity별 독립 Typie 상세 note document
- named snapshot payload v2, v1 backward restore와 Story Bible diff
- 원고/설정 mode와 설정 3열 UI

## 3. 저장 경계

각 entity는 정확히 하나의 `documents` 행을 상세 노트로 소유한다. SQLite에는 Typie
내부 node 타입을 저장하지 않고 기존 document 계약의 engine metadata, snapshot BLOB과
plain-text recovery만 저장한다. 일반 UI, entity/relation 모델과 snapshot logical model은
Typie 내부 타입을 참조하지 않는다.

Entity note 저장은 scene 저장과 같은 generation/save-sequence/optimistic revision
안전성을 사용한다. owner identity는 최소한 다음 튜플로 검증한다.

```text
ownerKind: SCENE | ENTITY
ownerId
documentId
generation
saveSequence
```

## 4. Schema와 migration

Schema v3 파일을 schema v4로 transaction migration하고 logical `format_version = 1`을
유지한다. migration은 기존 project/tree/document/search/snapshot 데이터를 보존한다.

- `entities`
- `entity_aliases`
- `tags`
- `entity_tags`
- `relation_types`
- `entity_relations`
- `scene_entity_links`

Foreign key와 unique/check constraint를 가능한 범위에서 DB에도 적용하고, project/owner
의미 검사는 Rust transaction 안에서 다시 강제한다. 프로젝트에는 built-in relation
type을 idempotent하게 seed한다.

## 5. Entity와 분류

이름은 trim 뒤 비어 있을 수 없다. 같은 프로젝트의 동명 entity는 허용하되 UI에서
경고한다. `attributes_json`은 유효한 JSON object로만 저장하고 이번 단계에서는 kind별
복합 form이나 별도 schema를 만들지 않는다.

별칭은 빈 값을 거부하고 동일 entity 안에서 normalized alias 중복을 막는다. 한국어,
영어, 숫자와 내부 공백을 보존한다. 태그 연결과 scene link는 복합 unique constraint로
중복을 막는다.

## 6. Relation 의미

Relation type은 forward name, 선택 inverse name, directed flag와 builtin flag를 가진다.
Directed relation은 source/target 방향을 보존하고 incoming view에서는 inverse label을
사용한다. Undirected relation은 canonical endpoint order로 비교해 역방향 중복을 같은
관계로 취급한다. Self relation은 Phase 1C에서 거부한다.

사용 중인 relation type 삭제는 거부한다. Built-in type은 rename할 수 있지만 삭제는
제한한다. Entity 삭제는 impact를 먼저 계산하고 확인 뒤 aliases/tags/relations/scene
links와 note document를 한 transaction에서 정리한다. 원고 본문은 변경하지 않는다.

## 7. 장면 link와 언급 후보

명시적 link는 canonical Story Bible data다. 연결 대상은 같은 프로젝트의 실제 SCENE과
entity여야 한다. 자동 언급 탐색은 Phase 1B exact substring 검색을 재사용하고 name과
모든 alias 결과를 장면별로 deduplicate한다.

자동 결과는 `본문에서 찾은 후보`로 표시하며 false positive가 가능한 참고 정보다.
사용자가 승격하기 전에는 `scene_entity_links`에 쓰거나 relation을 추론하지 않는다.

## 8. Snapshot 계약

새 snapshot은 logical payload v2로 생성하며 Story Bible table과 entity note document를
포함한다. 기존 snapshot 자체, 검색 projection과 runtime cache는 포함하지 않는다.

Payload v1 decoder를 유지한다. v1 snapshot 복원은 snapshot 당시 존재하지 않았던 Story
Bible data를 빈 상태로 복원하며, 복원 직전에 현재 v2 전체 상태를
`AUTO_BEFORE_RESTORE`로 보존한다. 모든 restore는 hash 검증과 한 DB transaction 안에서
수행한다.

Diff에는 entity, tag, relation type과 relation의 추가/삭제/변경, scene link 변화와
entity note 변경 수를 추가한다.

## 9. UI 범위

`원고` mode는 기존 Binder, 단일 scene editor, Scrivenings, 검색/치환, snapshot과 상태
표시를 그대로 유지한다. `설정` mode는 다음 3열을 사용한다.

1. 설정 목록: kind group, 검색/filter/sort, create/select/delete
2. 설정 상세: 기본 필드, aliases/tags와 Typie 상세 note
3. 관계·등장 위치: outgoing/incoming relation, 명시적 scene link와 언급 후보

SCENE 선택 때 원고 mode에 `설정 연결` inspector를 제공하고, Story Bible에서 scene으로
이동하거나 manuscript에서 entity 상세를 열 수 있게 한다.

## 10. 검증 범위

- Rust migration/integrity/CRUD/relation/link/mention/snapshot/round-trip tests
- renderer mode/entity/note/relation/link/mention/delete/snapshot reload tests
- 실제 `.madi`에 2권, 4화 이상, 10장면 이상과 모든 Story Bible kind fixture
- entity 500, alias 1,500, relation 2,000, scene link 2,000 최소 성능 fixture
- development Electron first/second process
- unpacked Electron first/second process
- 기존 Phase 0.5/1A/1B 전체 regression

완료 gate는 다음과 같다.

```powershell
pnpm verify
pnpm package:unpacked
pnpm test:electron
pnpm test:package
pnpm check:repository
pnpm format:check
```

## 11. 제외 범위

관계 그래프 시각화, Cytoscape.js, React Flow, 플롯 캔버스, 시간축/지식 시점 필터,
자동 관계 추론, LLM 추출, inline entity mark, 서버·협업·클라우드·모바일·웹, EPUB,
HWP/HWPX, 자동 업데이트, 복잡한 kind별 form과 플러그인 마켓은 구현하지 않는다.

## 12. 판정 경계

Phase 1C의 private-local 기술 판정과 배포 판정은 분리한다. Windows native IME는
`MANUAL VALIDATION PENDING`, Typie 라이선스는
`HUMAN DECISION REQUIRED BEFORE DISTRIBUTION`을 유지하며 공개·유료·고객 배포를
허가하지 않는다.
