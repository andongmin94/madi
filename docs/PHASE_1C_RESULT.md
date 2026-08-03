# Phase 1C 저장소 결과

기준일: 2026-08-02

```text
Verdict: TECHNICAL GO — PRIVATE LOCAL
Scope: STORY BIBLE FOUNDATION — PRIVATE LOCAL
Windows native Korean IME: MANUAL VALIDATION PENDING
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Public/paid/customer distribution: NOT AUTHORIZED
```

이 문서는 `codex/phase-1c`의 실제 schema v4, Rust core, Electron API/UI, named
snapshot v2와 재시작 검증 결과를 기록한다. 완료 gate 6개를 모두 독립 실행해 통과했고
최종 판정은 `TECHNICAL GO — PRIVATE LOCAL`이다.

## 1. Phase 1B 조건 해소

다중 장면 일괄 치환의 영구 project-wide command log는 구현하지 않는다. 단일 장면은
Typie Undo/Redo, 한 장면 치환은 Typie transaction/Undo entry, 여러 장면 일괄 작업은
`AUTO_BEFORE_REPLACE`와 named snapshot restore를 사용하는 것이 공식 제품 동작이다.
`docs/decisions/ADR-0002-project-wide-undo-via-snapshots.md`가 이 결정을 고정했고 Phase
1B 판정은 `TECHNICAL GO — PRIVATE LOCAL`로 갱신됐다.

## 2. Schema migration과 entity 종류

`format_version = 1`을 유지하면서 SQLite `schema_version`과 `user_version`을 3에서 4로
올렸다. Migration은 기존 project/tree/document/search/named snapshot을 보존하고 다음
table, index, FK와 project/owner validation trigger를 transaction으로 추가한다.

- `entities`, `entity_aliases`
- `tags`, `entity_tags`
- `relation_types`, `entity_relations`
- `scene_entity_links`

지원 kind는 `CHARACTER`, `LOCATION`, `ORGANIZATION`, `ITEM`, `EVENT`, `WORLD_RULE`,
`FORESHADOWING`, `OTHER`이고 status는 `ACTIVE`, `DRAFT`, `ARCHIVED`다. 이름은 trim 뒤
비어 있을 수 없고 동명은 허용하되 UI가 경고한다. `attributes_json`은 1 MiB 이하의
유효한 JSON object만 허용한다.

## 3. Entity note 저장 방식

Entity 생성 transaction은 독립 `documents` row를 함께 만들고
`entities.document_id`로 연결한다. Note는 SCENE과 동일하게 원본 Typie snapshot BLOB,
engine commit/schema metadata와 UTF-8 plain-text recovery를 저장한다. 일반 Story Bible
모델이나 SQLite schema에는 Typie 내부 node/type을 노출하지 않는다.

하나의 `DocumentSessionController`와 editor adapter가 SCENE/ENTITY 사이를 이동하며
`ownerKind`, `ownerId`, `documentId`, `generation`, `saveSequence`를 모두 검사한다. 약
550ms autosave, `Ctrl+S`, 전환 전 flush, dirty close flush, stale response 차단과 저장
실패 시 현재 graph 유지 계약을 공유한다.

## 4. Alias와 tag

Alias는 원문과 normalized 값을 함께 저장하고 `(entity_id, normalized_alias)` unique로
중복을 막는다. 한국어·영어·숫자·공백을 그대로 보존하며 변경 뒤 mention 탐색은 현재
alias를 다시 읽는다. Tag는 project 소유 row이고 `entity_tags` 복합 PK와 trigger가
중복/cross-project 연결을 막는다.

## 5. Relation type과 방향 의미

Project마다 10개 built-in relation type을 project-scoped deterministic ID로
idempotent하게 seed한다. Custom type은 생성·수정·미사용 삭제가 가능하고 built-in은
이름을 바꿀 수 있지만 삭제할 수 없다. 사용 중 type 삭제는 거부한다.

Directed relation은 source/target을 보존하고 incoming view에 `inverse_name`을 표시한다.
Undirected relation은 endpoint를 canonical order로 비교해 `(A, type, B)`와
`(B, type, A)`를 같은 논리 관계로 거부한다. UI의 outgoing/incoming은 같은 DB row의
view이고 self/cross-project relation은 허용하지 않는다.

## 6. Scene link와 자동 본문 탐색

`scene_entity_links`는 실제 SCENE, 같은 project entity와 `APPEARS`, `POV`,
`MENTIONED`, `RELATED` role만 허용한다. 같은 triple은 복합 PK로 중복을 막는다. 원고
mode `설정 연결` inspector와 설정 mode의 연결 장면 목록에서 같은 canonical row를
편집한다.

자동 탐색은 entity name과 alias 원문을 저장된 SCENE recovery에서 보존된 문자열 그대로
exact substring으로 찾고 가장 이른 match 하나를 장면별로 반환한다. 일치 표현, Unicode
scalar range와 문맥을 표시하지만 `본문에서 찾은 후보`일 뿐 relation/link로 자동
저장하지 않는다. 사용자가 role을 선택해 승격한 결과만 canonical link가 된다. 한국어
경계, 짧은 이름과 부분 문자열 때문에 false positive가 가능하다.

## 7. 삭제 안전성

삭제 전 relation 수, distinct explicit scene 수, mention 후보 scene 수, alias/tag 수와
note 글자 수를 계산해 확인 dialog에 표시한다. 확인된 삭제는 relation, scene link,
alias, entity-tag, entity와 note document를 한 transaction에서 정리한다. 본문 원고나
본문 속 이름은 수정하지 않으며 실패 시 부분 상태를 commit하지 않는다.

## 8. Snapshot payload v2와 backward compatibility

새 named snapshot은 `MADI_LOGICAL_JSON`/`madi.logical-snapshot` payload v2다. 기존
project/tree/documents/UI state에 entities, aliases, tags, entity-tags, relation types,
relations, scene links와 entity note documents를 추가한다. Diff는 entity/relation의
추가·삭제·변경, tag/relation type의 추가·삭제·변경, scene link 변화와 entity note
변경 수를 요약하며 SCENE 본문 통계와 entity note 통계를 분리한다.

Decoder는 payload v1과 v2를 지원한다. V1 restore는 복원 직전 현재 전체 v2 상태를
`AUTO_BEFORE_RESTORE`로 보존한 뒤 사용자 Story Bible을 빈 상태로 복원하고 built-in
relation type 10개만 다시 seed한다. UI는 v1에 설정 데이터가 없음을 미리 표시한다.
Hash, embedded identity, owner/FK/unique/role 검증 또는 insert 중 하나라도 실패하면
safety snapshot과 모든 변경을 함께 rollback한다. Forged v1 사전검증 실패뿐 아니라
validator 이후 duplicate tag unique constraint에서 실패하는 v2 payload도 원본 entity,
tag, revision과 snapshot 수가 그대로임을 집중 test로 확인했다.

## 9. UI와 검색

상단 `원고`/`설정` mode를 제공한다. 설정 mode는 타입 그룹·검색/filter/sort/create
목록, 기본 필드·alias/tag·Typie note 상세, outgoing/incoming relation·장면·mention의
3열 구조다. 설정 검색은 이름, 별칭, 요약, 태그와 entity note recovery를 포함하고 원고
검색 UX와 분리한다. Custom relation type 관리와 삭제 impact dialog도 같은 workspace에
포함된다.

## 10. 실제 통합 fixture

Sidecar 통합 fixture는 WORK 1, VOLUME 2, CHAPTER 5, SCENE 10과 scene break, 한국어
본문을 실제 `.madi`에 저장했다. Entity 19개는 kind별 최소
`5/3/2/2/2/2/2/1`, alias 4, tag 5, built-in 10 + custom type 1, relation 16,
네 role의 explicit link와 승격 뒤 link 5개를 검증했다.

이름·별칭·false-positive 후보를 4개 장면에서 찾되 canonical 자동 저장이 없음을
확인했다. ENTITY Typie note, snapshot v2 diff(entity/relation/link/note 각 1 변화), restore,
태그/관계 타입 add·delete·change 카운터도 각각 1을 확인했다. Restore와 두 번째 sidecar
process reopen 뒤 전체 상태가 보존됐고 최종 revision은 94였다.

Renderer 성능 fixture는 entity 500, alias 1,500, relation 2,000, scene link 2,000을
15초 제한 안에서 렌더링·필터·선택했으며 최종 실행 시간은 5.27초였다. 이 수치는
대규모 graph benchmark가 아니라 Phase 1C 목록/관계 UI의 최소 정상 동작 증거다.

## 11. 테스트와 재시작 결과

2026-08-02 최종 실행에서 다음 결과를 확인했다.

- Rust 전체 test: 28/28 PASS. Phase 1C 집중 test 5/5와 migration v3 → v4,
  relation/link/mention, snapshot v2/v1, INSERT 중 restore rollback 및 500/1,500/2,000/2,000
  fixture를 포함한다.
- Desktop Vitest: 21 files/106 tests PASS. Main/preload allowlist, owner-safe editor 전환,
  설정 workspace, scene inspector, snapshot diff와 기존 Phase 0.5/1A/1B 회귀를 포함한다.
- TypeScript typecheck, Typie semantic probe, repository boundary와 source format 검사는
  모두 PASS다. Repository 검사는 Typie artifact hash 9개, adapter boundary file 35개,
  Rust core file 9개와 source hygiene file 62개를 확인했다.
- Sidecar integration: Phase 1A revision 14, Phase 1B revision 29, Phase 1C revision 94까지
  각각 두 process round-trip을 통과했다. Phase 1C는 entity 19, alias 4, tag 5,
  relation type 11, relation 16, scene link 5와 snapshot diff의 tag/relation-type
  add/delete/change 6개 counter를 검증했다.
- Development Electron: 실제 창에서 first/second process, offline reload, entity 2개,
  alias/tag, 42자 ENTITY Typie note, custom directed relation, 자동 mention 7개, mention
  승격, POV link, payload v2 snapshot restore와 stable ID reopen을 PASS했다.
- Windows unpacked Electron: `output/madi-win32-x64/madi.exe`를 새로 만든 뒤 development와
  같은 first/second process Phase 1C 수명주기를 PASS했다. Packaged sidecar SHA-256은
  `8d08c3c54b04827585bf8787994ed8626f24cc4a1772451ae1dcc4f838850a44`다.
- 개발/패키지 화면은 `output/playwright/madi-electron-phase1c.png`,
  `output/playwright/madi-electron-phase1c-reopened.png`,
  `output/playwright/madi-packaged-phase1c.png`,
  `output/playwright/madi-packaged-phase1c-reopened.png`로 확인했다. 세 열의 목록·상세·관계,
  Typie note, 저장 상태와 재실행 복원 상태에 겹침이나 치명적 잘림이 없었다.

완료 gate의 최종 상태는 다음과 같다.

| 명령 | 결과 |
|---|---|
| `pnpm verify` | `PASS` — exit code 0; 전체 test/build와 development/packaged Electron 포함 |
| `pnpm package:unpacked` | `PASS` — exit code 0; Windows x64 unpacked와 release sidecar 생성 |
| `pnpm test:electron` | `PASS` — exit code 0; development first/second process |
| `pnpm test:package` | `PASS` — exit code 0; 새 package 생성 뒤 packaged first/second process |
| `pnpm check:repository` | `PASS` — exit code 0 |
| `pnpm format:check` | `PASS` — exit code 0; 86 files, whitespace/JSON issue 0 |

## 12. 알려진 한계와 다음 단계

- Windows native Korean IME 15항목은 자동 test로 대체하지 않는다.
- Typie 결합/배포 license 결정 전 공개·유료·고객 배포를 허가하지 않는다.
- Mention은 형태소 분석이나 사실 판정이 아닌 exact substring 후보다.
- 목록은 500개 fixture를 통과했지만 완전한 virtual list나 장편 benchmark는 아니다.
- 관계 그래프, 시간축/지식 시점 filter, 자동/LLM relation 추론, inline entity mark는
  구현하지 않았다.
- Snapshot은 전체 logical copy라서 수와 project 크기에 따라 파일이 커지며 압축,
  retention, 부분 restore와 merge는 없다.

모든 gate가 통과했으므로 다음 추천 작업은 이 canonical model을 읽기 전용으로 소비하는
`Phase 1D — World Graph Read Model & Visualization Spike`다. 먼저 graph query/read
model, 500/2,000 fixture의 layout·selection 성능과 directed/inverse/undirected 표시를
검증하고, canonical CRUD는 계속 기존 Story Bible API를 통해서만 수행해야 한다.

```text
Phase 1D World Graph entry: GO — PRIVATE LOCAL
Public/paid/customer distribution: NOT AUTHORIZED
```
