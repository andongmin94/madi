# Phase 1A 범위와 완료 계약

기준일: 2026-08-02

```text
Phase 0.5 technical baseline: CONDITIONAL TECHNICAL GO
Private local Phase 1A development authorized: YES
Phase 1A implementation status: COMPLETE
Phase 1A final verdict: TECHNICAL GO — PRIVATE LOCAL
Public/paid/installer distribution authorized: NO
```

이 문서는 Phase 1A에서 구현할 첫 제품 수직 기능의 경계와 완료 증거를 고정한다.
구현 계획이나 승인 사실이 아니라 core-sidecar와 실제 개발/packaged Electron
재시작, `pnpm verify`, 독립 `pnpm package:unpacked`의 exit 0을 완료 증거로 삼는다.

## 1. Phase 0.5에서 Phase 1A로 들어가는 정책

Phase 0.5의 `CONDITIONAL TECHNICAL GO`는 비공개 로컬 Phase 1A 개발을 허용한다.
기존 미완료 항목을 완료로 바꾸지 않으며, 공개·유료·installer 외부 배포의 조건과
로컬 제품 개발의 조건을 분리한다.

| 항목 | 현재 상태 | 비공개 로컬 Phase 1A | 배포 전 조건 |
|---|---|---|---|
| Phase 0.5 자동 검증 기준선 | Phase 1A 변경 뒤 최종 `pnpm verify` `PASS` | 회귀 없음 | 최종 후보에서 재실행 |
| Windows native 한국어 IME 15항목 | `MANUAL VALIDATION PENDING` | 비차단 | 지원 환경 확정 전 수행 |
| Typie 결합·배포 라이선스 | `HUMAN DECISION REQUIRED BEFORE DISTRIBUTION` | 비차단 | 공개·유료·installer 외부 배포 전 서면 결정 |
| 실제 installer lifecycle | `DEFERRED TO HARDENING` | 비차단 | 외부 installer 배포 전 수행 |
| 장편·장시간·DPI·다중 monitor 성능 | `DEFERRED TO HARDENING` | 비차단 | 지원 기준 확정 전 수행 |
| crash/power-loss fault injection | `DEFERRED TO HARDENING` | 비차단 | release hardening에서 수행 |
| screen reader·keyboard-only 접근성 | `DEFERRED TO HARDENING` | 비차단 | 지원 범위 확정 전 수행 |
| Typie 후보 commit upgrade rehearsal | `DEFERRED TO HARDENING` | 비차단 | Typie pin 변경 전에 수행 |
| remote recursive clean clone | `DEFERRED TO PRE-RELEASE` | 비차단 | remote와 commit이 생긴 뒤 수행 |
| `wasm-opt` 포함 runtime source 재현 build | `DEFERRED TO PRE-RELEASE` | 비차단 | source 배포·release 정책에 맞춰 수행 |

위 항목은 미완료다. `DEFERRED`는 통과나 면제가 아니라 담당 Phase를 옮긴 것이다.
라이선스가 결정되기 전에는 public download, 고객·유료 pilot, app store, package
registry 및 installer 외부 전달을 하지 않는다.

## 2. 목표

하나의 SQLite 기반 `.madi` 파일이 다음을 함께 소유해야 한다.

- 작품 `WORK` 하나
- 선택적인 권 `VOLUME`
- 작품 또는 권 아래의 화 `CHAPTER`
- 화 아래의 장면 `SCENE`
- 장면마다 정확히 하나의 Typie document
- 장면별 snapshot, plain-text recovery 및 자동저장 결과
- 마지막 선택 node, Binder 펼침 상태 및 Binder 폭

Phase 1A는 작품 구조와 장면 문서를 실제로 생성·편집·저장·재열기하는 최소
desktop workflow다. 계획 문서나 in-memory mock만으로 완료할 수 없다.

## 3. 필수 완료 시나리오

다음 순서를 하나의 실제 fixture와 실제 Electron lifecycle에서 수행한다.

| 순서 | 동작 | 반드시 남아야 하는 증거 | 현재 결과 |
|---:|---|---|---|
| 1 | `드래곤을죽이다.madi` 생성 | 유효한 v1 SQLite 파일과 WORK | `PASS` — sidecar/Electron |
| 2 | 권 2개 생성 | 두 `VOLUME`의 ID, 제목, 순서 | `PASS` — Electron 2개 |
| 3 | 화 3개 이상 생성 | 유효한 부모 아래의 `CHAPTER` 3개 이상 | `PASS` — Electron 3개, sidecar 4개 |
| 4 | 장면 5개 이상 생성 | `SCENE` 5개 이상과 1:1 document | `PASS` — Electron 5개, sidecar 6개 |
| 5 | 서로 다른 장면에 한국어 본문 입력 | 장면별 서로 다른 snapshot/recovery | `PASS` — Electron 3개, sidecar 3개 |
| 6 | 한 장면에 `madi.scene-break.v1` 삽입 | Typie 의미 node와 recovery marker | `PASS` — 1개 |
| 7 | 장면 순서 변경 | 같은 부모의 안정적인 `order_key` 변경 | `PASS` — restart 전후 동일 |
| 8 | 앱 완전 종료 | dirty scene 및 UI state flush 완료 | `PASS` — 실제 Electron close |
| 9 | 앱 재실행 | 새 Electron process | `PASS` — 개발/packaged 앱 |
| 10 | 같은 `.madi` 열기 | 동일 파일을 core가 다시 검증·open | `PASS` |
| 11 | 전 상태 대조 | 구조, 순서, 제목, 장면별 본문, scene break 동일 | `PASS` — 개발/packaged Electron |

새 process에서 읽은 값을 종료 전 기대값과 비교해야 한다. 같은 renderer의 메모리나
테스트용 전역 객체를 재사용한 비교는 완료 증거가 아니다.

## 4. 허용 범위

### 저장소와 Rust core

- 기존 `app_meta`, `documents`, `schema_migrations` 보존
- `projects`, `tree_nodes`, `ui_state` migration 추가
- v0 파일을 v1로 transaction migration하고 기존 document를 장면에 연결
- project/tree 조회, node 생성·이름 변경·이동·순서 변경·삭제
- SCENE과 document의 원자적 생성, 장면 document load/save
- 작품별 UI state load/save
- 구조·document mutation의 optimistic revision 검사와 backup 유지
- 본문을 포함하지 않는 타입 있는 오류

### Desktop UI

- 상단의 새 파일, 열기, 저장, 작품명, 저장 상태
- Binder의 WORK/VOLUME/CHAPTER/SCENE 트리
- 권·화·장면 추가, 이름 변경, 명시적 삭제, 접기·펼치기
- 같은 부모 안의 위·아래 순서 변경
- 선택 장면 강조와 non-SCENE 안내 화면
- SCENE 선택 시에만 Typie editor 활성화
- Undo, Redo, `madi.scene-break.v1`, `Ctrl+S`
- dirty/saving/saved/error 및 마지막 저장 시각 표시
- 기본 제목 `새 작품`, `새 권`, `새 화`, `새 장면`
- 기본적인 desktop 간격, typography, hover, focus 및 선택 상태

드래그앤드롭은 필수가 아니다. 버튼 기반 위·아래 이동만으로 완료할 수 있다.

## 5. 명시적 금지 범위

Phase 1A에서는 다음을 구현하거나 schema에 미리 넣지 않는다.

- 등장인물 및 인물 관리
- 세계관 설정
- 관계 그래프
- 플롯 Canvas
- Reader Lab
- EPUB
- HWP/HWPX
- LLM adapter
- Dropbox, MYBOX, NAS 전용 기능
- 자동 업데이트
- 회원가입
- server
- 자체 cloud
- collaboration
- mobile 앱
- web 앱
- Typie 제품 UI 복사
- 전체 원고 연속 보기
- 프로젝트 전체 검색·치환
- 이름 있는 snapshot

production design, code signing, installer 제작 및 배포도 Phase 1A 완료 범위가 아니다.
단, 사용자 요청에 포함된 `pnpm package:unpacked` 성공은 기술 완료 gate다.

## 6. 유지해야 하는 기술 경계

다음 구조와 보안 설정은 유지한다.

- Electron main / preload / renderer 분리
- React와 TypeScript strict mode
- Rust `madi-core`와 SQLite `.madi`
- Typie editor engine
- `MadiEditorAdapter` / `TypieEditorAdapter` 경계
- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- 좁고 타입 안전한 preload API

일반 madi renderer와 Rust core는 Typie 내부 type을 import하거나 Typie private API를
직접 호출하지 않는다. snapshot 추출·복원, scene break mapping과 editor event는
기존 adapter 경계 안에서만 Typie 구현으로 변환한다.

Renderer는 임의 path나 SQL을 다루지 않는다. main은 session ID를 실제 file path에
매핑하고, preload는 필요한 command만 노출한다. 계층, revision, document 연결과
delete 권한의 최종 검증자는 Rust core다.

## 7. 작품 트리 불변식

정규 계층은 다음과 같다.

```text
WORK
├─ VOLUME
│  └─ CHAPTER
│     └─ SCENE → documents.id
└─ CHAPTER
   └─ SCENE → documents.id
```

반드시 지킬 규칙:

1. project마다 root `WORK`는 정확히 하나다.
2. `WORK`의 parent와 document는 `NULL`이다.
3. `VOLUME`은 `WORK` 바로 아래에만 둔다.
4. `CHAPTER`는 `WORK` 또는 `VOLUME` 바로 아래에만 둔다.
5. `SCENE`은 `CHAPTER` 바로 아래에만 둔다.
6. `SCENE`만 `document_id`를 가지며 모든 SCENE은 정확히 하나를 가진다.
7. 하나의 document는 정확히 하나의 SCENE에만 연결된다.
8. parent, child 및 document는 같은 project에 속한다.
9. cycle, self-parent, 고아 node 및 고아 document를 허용하지 않는다.
10. kind 변경은 지원하지 않는다.

SQLite의 `CHECK`, `UNIQUE`, foreign key가 표현할 수 있는 규칙과 Rust의 cross-row
검증을 함께 사용한다. create/move/delete mutation은 부모·kind·cycle·project를
검증한다. 현재 open은 project/WORK/edge/foreign-key 기준선을 검사하지만, 임의 변조
SQLite의 orphan document와 모든 mirror를 완전 scan하는 것은 구현 gap으로
`docs/PHASE_1A_RESULT.md`에 남긴다.

## 8. Command 계약

Desktop API와 실제 Rust JSON-RPC 이름을 다음처럼 분리한다.

| Desktop API | Core JSON-RPC | 필수 동작 |
|---|---|---|
| `createProject` | `create_project` | app metadata, project, WORK, 기본 CHAPTER/SCENE/document를 원자적으로 생성 |
| `openProject` | `open_project` | 파일 검증·migration 후 session 생성 |
| `getProjectTree` | `load_project_tree` | project metadata와 정렬된 전체 tree 반환 |
| `createNode` | `create_tree_node` | 부모·kind 검증, SCENE이면 document도 같은 transaction에서 생성 |
| `renameNode` | `rename_tree_node` | 빈 제목 거부, 필요한 project/document title mirror 동시 갱신 |
| `moveNode` | `move_tree_node` | 새 부모·cycle·project 검증 후 새 sibling order 배정 |
| `reorderNode` | `reorder_tree_node` | 같은 부모 안에서만 순서 변경 |
| `deleteNode` | `delete_tree_node` | WORK 금지, non-leaf에는 explicit recursive 요구, 연결 document 정리 |
| `loadSceneDocument` | `load_scene` | scene-document 연결을 확인하고 snapshot/recovery 반환 |
| `saveSceneDocument` | `save_scene` | main이 document/token을 검증하고 core가 scene/revision/editor metadata를 검증해 저장 |
| `saveUiState` | `save_ui_state` | `workspace.v1`을 generic JSON UI-state row에 저장 |
| `loadUiState` | `load_ui_state` | 저장 row를 renderer camelCase 계약으로 변환 |

별도 `create_scene_document` command는 없다. `create_tree_node(SCENE)`이 document
생성과 node 연결을 한 transaction에서 수행한다.

모든 mutation은 타입 있는 오류를 반환한다. 오류, log, telemetry 및 IPC diagnostic에
snapshot bytes나 `plain_text_recovery` 본문을 넣지 않는다.

## 9. 구조 변경과 삭제 규칙

- 모든 구조 변경은 `BEGIN IMMEDIATE` transaction 안에서 수행한다.
- caller의 `expected_revision`을 transaction 안에서 다시 확인한다.
- 성공한 canonical 구조 변경은 `app_meta.revision`을 정확히 한 번 증가시킨다.
- 실패하면 node, document, metadata와 revision을 모두 rollback한다.
- SCENE 생성은 빈/uninitialized document와 node를 한 transaction에서 생성한다.
- SCENE 삭제는 node와 연결 document를 같은 transaction에서 삭제한다.
- 하위 node가 있는 대상은 기본적으로 `RecursiveDeleteRequired`로 거부한다.
- UI가 확인한 뒤에만 `recursive: true`를 보낸다. core도 이 flag를 재검증한다.
- WORK 삭제는 recursive flag와 관계없이 금지한다.
- 삭제 전 subtree와 연결 document ID를 확정하고, 성공 결과에 본문 없이 ID만 반환한다.
- core delete는 generic UI-state JSON을 직접 고치지 않는다. renderer가 반환된 새
  tree에서 삭제된 선택·펼침 ID를 제거하고 다음 UI-state save에서 교체한다.

SQLite cascade는 명시적으로 검증된 transaction을 원자적으로 끝내는 보조 수단일
뿐, 사용자 확인이나 Rust의 recursive-delete guard를 대체하지 않는다.

## 10. `order_key` 계약

단순 배열 index를 모든 sibling에 매번 쓰지 않는다. 각 sibling은 간격을 둔
`order_key`를 가지며 기본 간격은 `1024`다.

- 첫 node는 `1024`, append는 마지막 key에 `1024`를 더한다.
- 두 node 사이 삽입·이동은 안전한 간격이 있으면 두 key의 midpoint를 사용한다.
- 간격이 너무 작거나 값이 유한하지 않거나 overflow 위험이 있으면 해당 부모의
  sibling만 `(index + 1) * 1024`로 rebalance한 뒤 다시 배치한다.
- 읽기 순서는 항상 `(order_key ASC, id ASC)`로 고정해 tie도 결정적으로 처리한다.
- 같은 부모 안의 reorder만 지원하며 다른 부모로 옮기는 동작은 `move_node`다.
- 한 transaction 안에서 unique 충돌을 피하도록 임시 key 또는 전체 sibling
  rebalance 순서를 안전하게 적용한다.

정확한 SQLite type과 epsilon은
`docs/MADI_FILE_FORMAT_V1_DRAFT.md`에 정의한다.

## 11. 장면 전환 저장 protocol

장면 A에서 장면 B로 전환할 때의 commit point는 A 저장 성공이다.

1. 전환 요청의 target scene을 기록한다.
2. IME composition 중이면 종료 event까지 대기하거나 adapter의 안전한 commit을
   사용한다. 조합 중 snapshot을 강제로 버리지 않는다.
3. A의 Typie snapshot을 추출한다.
4. A의 plain-text recovery를 추출한다.
5. `documentId`, `generation`, 증가하는 `saveSequence`와 함께 A를 저장한다.
6. A 저장 성공을 확인한 뒤 B의 scene-document를 load한다.
7. B에 새 generation/session token을 발급하고 editor를 활성화한다.

저장 실패 시 A editor instance와 dirty state를 유지하고 B를 활성화하지 않는다.
사용자는 재시도하거나 A에 머물 수 있어야 한다.

빠른 A → B → C 선택은 마지막 의도만 이어서 처리한다. 모든 async 결과는 요청 당시의
`documentId`, `generation`, `saveSequence`를 포함한다. 응답이 현재 session과 다르거나
더 오래된 sequence면 snapshot, dirty, 저장 상태, 마지막 저장 시각 및 선택 장면에
적용하지 않는다. `AbortController` 또는 동등한 token 취소는 UI 작업을 줄이는
수단이며, 응답 identity 재검사를 대체하지 않는다.

## 12. 자동저장과 종료 계약

- content 변경 뒤 약 `500ms` debounce한다.
- `Ctrl+S`, 장면 전환 및 앱 종료 요청은 debounce를 기다리지 않고 flush한다.
- 저장 중 발생한 추가 변경은 별도 dirty generation으로 남겨 다음 저장을 예약한다.
- 저장 성공은 저장 요청이 캡처한 generation까지만 clean 처리한다.
- snapshot bytes와 recovery의 content signature가 마지막 성공 값과 같으면 dirty
  event가 있었더라도 중복 DB write를 생략한다.
- 실패하면 editor state와 dirty를 유지하고 오류와 재시도 동작을 노출한다.
- 닫기 요청 중 renderer 입력은 freeze하되 현재 snapshot을 버리지 않는다.
- main은 저장 성공 또는 명시적인 사용자 확인을 받기 전 창을 즉시 파괴하지 않는다.

상태 전이는 최소한 다음을 구분한다.

```text
clean → dirty → saving → saved/clean
                  ├─ new edits → dirty queued
                  └─ error → dirty + retryable error
```

## 13. UI state 복원 계약

`.madi`에는 다음 값만 작품별로 저장한다.

- `selectedNodeId`
- unique `expandedNodeIds`
- `binderWidth`

editor instance, DOM, Canvas, selection, viewport, 진행 중 composition, timer,
AbortController와 in-memory cache는 원본 데이터로 저장하지 않는다.

open 때 존재하지 않는 selected ID는 session SCENE, 첫 번째 유효한 SCENE, WORK
순으로 대체한다. SCENE이 없으면 WORK를 선택하고 editor를 비활성화한다. 존재하는
non-SCENE 선택은 유지하고 안내 화면을 표시할 수 있다. expanded ID는 존재하는
container node로 제한하고, Binder 폭은 `220..640` 범위로 clamp한다. 모든 SCENE을
삭제한 project는 WORK를 선택한 Binder-only mode로 재열고 editor mount를
비활성화한다. malformed `workspace.v1`은 tree 복원을 막지 않고 default state로
fallback한다.

## 14. 필수 검증과 현재 상태

상세 출력은 `docs/PHASE_1A_RESULT.md`에 기록한다. 현재 집중 검증과 최종 gate를
분리한다.

### Rust

- 전체 Rust test: `16 / 16 PASS`
- v0 migration, project/WORK, 허용·금지 hierarchy: `PASS`
- rename, move, reorder, explicit recursive delete: `PASS`
- SCENE-document create/save/delete와 core reopen: `PASS`
- generic UI-state revision-neutral round-trip: `PASS`
- 임의 변조 DB의 orphan/mirror 전체 open audit: `PENDING`

### TypeScript / React

- 현재 focused run: `56 / 56 PASS`
- Binder render/create/rename/delete/reorder와 non-SCENE 선택 test 존재
- save-before-load, composition guard, rapid selection과 실패 보존 test 존재
- response scene/document/generation/sequence, unchanged-content dedupe와 SCENE 0개
  Binder-only reopen test: `PASS`

### 통합·package

- Phase 1A 2-process sidecar fixture: `PASS` — WORK 1, VOLUME 2,
  CHAPTER 4, SCENE 6, 한국어 장면 3, scene break 1, revision 14
- 기존 Phase 0.5 integration: `PASS`
- 다중 Binder node 실제 Electron acceptance: `PASS` — WORK 1/VOLUME 2/CHAPTER 3/SCENE 5
- 변경 뒤 최종 `pnpm verify`: `PASS` — exit 0
- 변경 뒤 독립 `pnpm package:unpacked`: `PASS`
- 변경 뒤 unpacked Electron smoke: `PASS`

## 15. 완료 판정

다음을 모두 충족해야만 Phase 1A를 `PASS` 또는 `GO`로 보고할 수 있다.

1. 필수 11단계 시나리오가 한 실제 `.madi`와 새 Electron process에서 통과한다.
2. 계층과 SCENE-document 불변식의 positive/negative Rust test가 통과한다.
3. save-before-load, stale suppression, autosave 실패 보존 test가 통과한다.
4. 기존 Phase 0.5 자동 회귀를 포함한 `pnpm verify`가 통과한다.
5. `pnpm package:unpacked`가 성공한다.
6. 실제로 실행하지 못한 항목과 제한을 결과 문서에 그대로 남긴다.

위 여섯 조건은 2026-08-02 최종 실행에서 모두 충족됐다. 수동 IME, 라이선스와
release hardening 항목은 완료로 바꾸지 않으며 비공개 로컬 Phase 1A 판정과 분리한다.

## 16. Phase 1B 진입

비공개 로컬 Phase 1B 진입은 `GO`다. Phase 0.5에서 후속 gate로 옮긴 항목은
완료되지 않았으며, 해당 지원 또는 배포 경계에 도달하기 전에 각각 다시 gate로
승격해야 한다.
