# Phase 1A 저장소 구현 결과

기준일: 2026-08-02

```text
Repository implementation: IMPLEMENTED IN WORKTREE
Core-sidecar Phase 1A round-trip: PASS
Final pnpm verify: PASS
Final pnpm package:unpacked: PASS
Multi-node Electron Binder acceptance: PASS — DEVELOPMENT AND PACKAGED
Phase 1A final verdict: TECHNICAL GO — PRIVATE LOCAL
Phase 1B entry: GO — PRIVATE LOCAL
```

이 문서는 현재 저장소의 구현과 2026-08-02 최종 실행 증거를 기록한다. 사용자의
최종 보고 12개 항목을 대신하지 않으며 수동·배포·후속 gate 항목을 성공으로
간주하지 않는다.

## 구현 snapshot

### `.madi`와 Rust core

- logical format v1, SQLite schema/user version 2
- 기존 `app_meta`, `documents`, `schema_migrations` 유지
- `projects`, `tree_nodes`, `ui_state` migration 추가
- project당 WORK root 하나
- `WORK → VOLUME|CHAPTER`, `VOLUME → CHAPTER`, `CHAPTER → SCENE`
- SCENE만 document를 가지며 create/rename/save/delete를 transaction으로 처리
- structure/document mutation마다 optimistic revision 검사와 pre-save backup
- `REAL order_key`, 기본 간격 `1024.0`, midpoint와 sibling rebalance
- subtree에는 명시적 recursive delete가 필요하며 WORK delete 금지
- scene snapshot BLOB과 UTF-8 plain-text recovery의 load/save
- manuscript revision을 바꾸지 않는 generic JSON UI-state 저장
- 본문을 오류·stderr에 넣지 않는 typed core 오류

실제 core JSON-RPC는 다음 16개 method를 허용한다.

```text
create_project, open_project, save_document, load_document,
inspect_project, recover_plain_text,
load_project_tree, create_tree_node, rename_tree_node,
move_tree_node, reorder_tree_node, delete_tree_node,
load_scene, save_scene, save_ui_state, load_ui_state
```

별도 `create_scene_document` method는 없다. `create_tree_node`에 `kind = SCENE`을
보내면 core가 document와 node를 같은 transaction에서 만든다.

### Desktop

- WORK/VOLUME/CHAPTER/SCENE Binder render
- 허용 parent에 권·화·장면 추가
- inline rename과 빈 입력의 kind별 기본 제목
- 확인 dialog 뒤 recursive delete
- 같은 parent 안의 위·아래 reorder
- 접기·펼치기, 선택 강조, Binder 폭 220..640
- SCENE에서만 Typie editor 활성화, non-SCENE 안내 화면
- Undo, Redo, `madi.scene-break.v1`, 저장, `Ctrl+S`
- dirty/saving/saved/error와 마지막 저장 시각 표시
- `workspace.v1` selected/expanded/width 저장·복원
- 고정 IPC와 session capability; renderer에 path/generic RPC 미노출

Binder의 drag-and-drop과 parent 이동 UI는 없다. `move_tree_node` core와
`moveNode` preload API는 존재하지만 Phase 1A UI의 필수 동작은 같은 부모의 위·아래
순서 변경으로 제한한다.

## 장면 저장 안전장치

- content event 뒤 약 550ms debounce autosave
- `Ctrl+S`, scene 전환, project 교체와 창 닫기 전 flush
- IME composition 중 save/switch/close 거부
- SCENE A save 성공 뒤에만 SCENE B load
- save 실패 시 A editor와 dirty/error 상태 유지
- 저장 중 발생한 추가 change generation은 dirty로 유지해 다음 save 예약
- 빠른 A → B → C는 직렬 scene queue와 최신 request token으로 stale B load 억제
- save 응답의 scene ID, document ID, generation, saveSequence 직접 대조
- session token/session ID/active scene이 달라진 응답은 현재 UI에 적용하지 않음
- close 승인 전 document와 UI state flush, 승인 동안 renderer `inert`

snapshot bytes와 plain-text recovery의 content signature를 마지막 성공 값과
비교한다. dirty event가 있었더라도 두 값이 같으면 DB write를 생략하고 saved로
돌아간다.

## file format의 실제 값

```text
PRAGMA application_id: 0x4D414449
app_meta.format_version: 1
app_meta.schema_version: 2
PRAGMA user_version: 2
ORDER_STEP: 1024.0
MIN_ORDER_GAP: 0.000001
UI state key: workspace.v1
Binder width default/range: 300 / 220..640
```

disk의 `workspace.v1` JSON은 snake_case다.

```json
{
  "selected_node_id": null,
  "expanded_node_ids": [],
  "binder_width": 300
}
```

renderer/preload TypeScript에서는 같은 값이 camelCase로 노출되고 Electron main이
변환한다.

새 desktop project는 WORK, 초기 CHAPTER, 초기 SCENE/document 한 쌍으로 시작한다.
초기 CHAPTER와 SCENE은 현재 project/document title을 공유한다. Binder에서 이후
추가하는 node는 `새 권`, `새 화`, `새 장면`을 기본 제목으로 사용한다.

v0 migration은 legacy documents가 있으면 WORK 아래 `본문` CHAPTER 하나를 만들고,
`(created_at, id)` 순서의 SCENE으로 연결한다. migration은 `BEGIN IMMEDIATE`
transaction으로 rollback되지만 migration 전 별도 `.bak`은 만들지 않는다.

## 실행 증거

### 집중 test 기록

| 범위 | 기록 | 해석 |
|---|---|---|
| Rust 전체 test | `16 / 16 PASS` | storage, migration, hierarchy, JSON-RPC, scene/UI round-trip |
| renderer focused test | `56 / 56 PASS` | response identity, 4-way stale 응답, unchanged-content dedupe, SCENE 0개 reopen 포함 |
| Phase 0.5 integration scripts | `PASS` | 기존 round-trip/endurance/scene-break/recovery 회귀 |
| Phase 1A sidecar restart | `PASS` | 아래 별도 2-process fixture |

### Phase 1A sidecar 재시작 fixture

실행 script: `scripts/test-phase1a-roundtrip.mjs`

| 검사 | 실제 결과 |
|---|---|
| 파일 | `드래곤을죽이다.madi` |
| core process | 2개, 첫 process 종료 후 새 process로 reopen |
| WORK | 1 |
| VOLUME | 2 |
| CHAPTER | 4 |
| SCENE | 6 |
| 한국어 본문을 저장·대조한 SCENE | 3 |
| snapshot | 저장 bytes와 reopen bytes exact 동일 |
| plain-text recovery | 세 장면 exact 동일 |
| scene reorder | reopen 뒤 순서 동일 |
| `madi.scene-break.v1` | 의미 node 1개 보존 |
| `workspace.v1` UI state | 선택 node·펼침 node·Binder 폭이 reopen 뒤 exact 동일 |
| 최종 revision | 14 |

이 fixture는 Rust sidecar process와 실제 Typie host를 사용한다. hierarchy, 한국어
snapshot/recovery, reorder, scene break와 UI-state persistence를 새 core process에서
검증했다.

### 실제 Electron Binder acceptance

동일 smoke를 개발 Electron과 unpacked packaged `madi.exe`에서 각각 수행했다.

| 검사 | 실제 결과 |
|---|---|
| hierarchy | WORK 1, VOLUME 2, CHAPTER 3, SCENE 5 |
| 제목 | 작품·권·화·장면 제목 전부 고유, restart 뒤 동일 |
| 한국어 장면 | 짧은 장면 22자·24자와 기본 5,445자 fixture |
| reorder | 같은 부모의 두 SCENE 순서가 restart 전후 동일 |
| scene break | 기본 장면의 `madi.scene-break.v1` 1개 보존 |
| dirty close | revision 29 → 30, recovery 5,473 → 5,485자 |
| 작품별 UI state | fallback이 아닌 `닫힌 성문` 선택·다른 권 접힘·Binder 420px 폭이 restart 뒤 동일 |
| lifecycle | 창 종료, Electron process 종료, 새 process, 같은 파일 reopen |
| runtime boundary | offline, 외부 요청 0, 임의 local file read 차단 |

## 최종 gate 현황

| gate | 상태 | 완료로 바꾸는 증거 |
|---|---|---|
| 변경 뒤 renderer 전체 test | `PASS` | `56 / 56` |
| 변경 뒤 `pnpm verify` | `PASS` | exit 0, 61.9초 |
| 변경 뒤 독립 `pnpm package:unpacked` | `PASS` | `output/madi-win32-x64/madi.exe` |
| unpacked 실제 실행 | `PASS` | packaged startup/save/close/reopen |
| 다중 Binder Electron acceptance | `PASS` | 개발/packaged Playwright evidence |

unpacked `madi.exe`는 204,521,984 bytes이고 포함된 `madi-core.exe`는 3,236,864
bytes다. sidecar SHA-256은
`4f25bce144abd6f21a787c58268e939f42fef05325e720bbf8c2f2671953bdfb`다.

## 구현과 계약 사이의 남은 차이

아래 항목은 현재 happy-path Phase 1A sidecar fixture의 PASS를 무효화하지 않지만,
강한 file-format/open 계약 또는 edge case 기준으로는 남아 있다.

1. **Migration preflight/backup 제한:** v0 → v1 migration은 transaction rollback을
   사용하지만 시작 전 `.bak`을 만들지 않는다. `quick_check`와 full metadata 검증도
   migration commit 뒤 수행하므로 변조·unknown-format fixture에 대한 선검증은
   별도 hardening이 필요하다.
2. **Open-time audit 범위:** core open은 metadata/version, `quick_check`, project row,
   WORK root, parent-kind edge와 foreign key를 검사한다. 임의 변조 SQLite의 orphan
   document, cross-project pair 및 모든 title mirror를 완전 scan하지 않는다.
3. **Delete-time UI sanitation:** core delete transaction은 generic UI-state JSON을
   수정하지 않는다. renderer가 새 tree에서 fallback한 뒤 약 300ms 후 저장한다.

다음 edge case는 최신 renderer 구현과 `56 / 56` focused test에서 닫혔다.

- malformed `workspace.v1`은 `{ state: null }` default로 격리해 tree 복원을 계속함
- SCENE이 하나도 없는 유효 project를 Binder-only mode로 reopen
- non-SCENE 선택 때 Typie mount를 hidden/inert 처리
- save response의 scene/document/generation/saveSequence 불일치 거부
- unchanged snapshot/recovery signature의 중복 DB write 생략

이 차이는 최종 판정에서 숨기지 않는다. 현재 승인된 비공개 로컬 Phase 1A를
차단하지 않으며 release/file-format hardening에서 구현·test로 닫아야 한다.

## 계속 미완료인 외부 gate

- Windows native IME: `MANUAL VALIDATION PENDING`, 15/15 `NOT TESTED`
- license: `HUMAN DECISION REQUIRED BEFORE DISTRIBUTION`
- 공개·유료·installer 외부 배포: 금지
- installer lifecycle: `DEFERRED TO HARDENING`
- 현실 장편/장시간/DPI/multi-monitor 성능: `DEFERRED TO HARDENING`
- crash/power-loss fault injection: `DEFERRED TO HARDENING`
- screen reader/keyboard-only/native 후보창: `DEFERRED TO HARDENING`
- 실제 후보 Typie upgrade rehearsal: `DEFERRED TO HARDENING`
- remote recursive clean clone: `DEFERRED TO PRE-RELEASE`
- `wasm-opt` 포함 runtime source 재현 build: `DEFERRED TO PRE-RELEASE`

이 항목은 비공개 로컬 Phase 1A 구현을 막지 않지만 완료된 것으로 표시하지 않는다.

## 최종 판정

Phase 1A 완료 조건은 모두 충족됐다. 판정은 `TECHNICAL GO — PRIVATE LOCAL`이며
Phase 1B의 비공개 로컬 개발에 진입할 수 있다. 이는 public/paid/installer 배포
승인이 아니며, 아래 외부 gate는 각각 명시된 시점까지 계속 유효하다.

참조:

- `docs/PHASE_1A_SCOPE.md`
- `docs/MADI_FILE_FORMAT_V1_DRAFT.md`
- `docs/PHASE_0_5_CLOSURE_RESULT.md`
- `docs/LICENSE_DECISION_REQUIRED.md`
