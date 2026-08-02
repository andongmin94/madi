# Phase 1B 저장소 결과

기준일: 2026-08-02

```text
Verdict: CONDITIONAL TECHNICAL GO — PRIVATE LOCAL
Implementation: COMPLETE IN WORKING TREE
Focused verification: PASS
Integration/development/packaged Electron acceptance: PASS
Final pnpm verify gate: PASS
Windows native Korean IME: MANUAL VALIDATION PENDING
License: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Public/paid/customer distribution: NOT AUTHORIZED
```

이 문서는 `codex/phase-1b` 구현을 코드와 집중 test 및 최종 aggregate gate에 대조한
결과다. `pnpm verify`는 exit code 0으로 완료됐고 아래 표는 실제 command와 fixture
결과를 기록한다.

## 1. 최종 판정

최종 판정은 `CONDITIONAL TECHNICAL GO — PRIVATE LOCAL`이다. Phase 1B의 세 기능은
실제 core/API/UI 경로로 구현됐다. 검색은 exact Korean substring이고 선택 치환은
plain text rewrite가 아니라 Typie 의미 transaction과 원자적 DB batch를 사용한다.
named snapshot은 logical payload와 자동 safety restore를 제공한다.

조건부인 이유는 다음 세 가지다.

1. 여러 SCENE 치환은 자동 `AUTO_BEFORE_REPLACE` snapshot restore로 되돌리며 하나의
   지속 가능한 project-wide 사용자 `Ctrl+Z` entry는 아니다.
2. native Windows 한국어 IME는 수동 검증 전이다.
3. 배포 전 Typie 라이선스 방식에 대한 사람의 결정이 필요하다.

## 2. Scrivenings 구현 방식

- WORK/VOLUME/CHAPTER subtree를 Rust에서 `(order_key, id)` DFS로 읽는다.
- renderer는 200 SCENE page를 revision 고정 상태로 모두 모은다.
- SCENE은 독립 document/snapshot을 유지한다.
- `DocumentSessionController`의 기존 editor instance 한 개를 active block으로 옮긴다.
- inactive SCENE은 plain-text recovery read-only block이다.
- container Binder 선택과 내부 active/highlighted SCENE을 별도 상태로 관리한다.
- 장면 전환 전에 composition guard와 기존 atomic save를 완료한다.
- 저장 실패 시 현재 block/editor를 유지한다.

동시에 생성하는 live Typie editor instance 수는 project session당 **1개**다.

## 3. 긴 원고 rendering 전략

IntersectionObserver의 800px margin, 앞뒤 2개 overscan, 최초 6개 block을 기준으로
화면 근처 본문만 heavy read-only renderer로 만든다. active/pending block은 항상
heavy다. 먼 block은 최소 높이 150px placeholder로 남긴다.

완전한 virtual list는 아니다. 모든 wrapper와 전체 preview text는 renderer에 남으므로
memory와 DOM 비용은 SCENE 수에 따라 증가한다. core page는 최대 1,000 SCENE/64 MiB
encoded text이고 renderer는 page consistency를 검증한다.

## 4. 검색 구현과 한국어 결과

FTS5는 사용하지 않았다. `search_documents` projection을 document transaction trigger로
동기화하고 Rust가 subtree title/body를 선형 순회한다. 결과는 non-overlapping exact
substring, Unicode scalar offset, 앞뒤 32 scalar 문맥이다. BODY hit에는 SHA-256
source hash가 붙는다.

CURRENT scope preview identity에는 표시 label뿐 아니라 실제 selected node ID가 들어간다.
Binder selection이 다른 ID로 바뀌면 기존 checkbox preview를 즉시 stale로 처리한다.
현재 live SCENE에 BODY hit가 있으면 첫 hit를 Typie selection으로 자동 표시하되 editor에
focus를 강제로 옮기지 않는다. 사용자가 특정 결과를 click한 경우에만 해당 장면으로
이동하고 focus한다.

Rust 집중 test에서 `문을` Korean substring 3건을 두 SCENE에서 정확히 찾고, save 뒤
새 한국어 검색어가 즉시 1건으로 갱신되며, 20,000건 source에서 정확한 total과 bounded
50건 page를 검증했다. 최종 10+ SCENE 통합 fixture는 WORK 1/VOLUME 2/CHAPTER 5/SCENE
10, exact Korean `불씨` 5건과 선택 치환 3건을 검증했다.

## 5. 치환 의미구조 보존

Typie runtime에는 repository-owned patch로
`replace_many_from_prose_annotated` operation을 추가했다. 한 SCENE의 선택 range들을
한 transaction으로 처리하며 scalar offset, expected annotated source/text, block/text
mapping과 modifier ownership을 검증한다. newline, scene break/atom, block-crossing 또는
mixed-modifier 범위는 거부한다.

adapter는 변환 전후 annotated text, semantic scene-break count와 non-text structure
fingerprint를 비교하고 snapshot을 export한다. core는 모든 SCENE의 revision,
scene-document-editor identity, SHA-256, occurrence transduction과 snapshot 변화를 다시
검증한 뒤 한 SQLite transaction에서 safety snapshot, document updates, search
projection과 revision을 commit한다.

치환/restore가 one-live Typie를 빌리는 동안 controller exclusive lock과 adapter
interaction lock을 함께 사용한다. hidden input은 disabled/blur되고 surface는 inert가
되며 `Ctrl+S`, Undo/Redo, scene break, focus, reveal과 장면 전환이 fail-closed된다.
suppression 경계 밖 editor mutation을 감지하면 core commit 전에 중단한다. DB commit 뒤
원래/복원 SCENE reload가 실패하면 controller는 fatal lock을 유지해 임시 graph 저장을
금지한다. 사용자 변경은 exclusive operation 전에 flush됐으므로 이 상태에서는 window
close만 허용하고 재시작해 DB의 canonical state를 다시 열게 한다.

Typie probe는 Korean+emoji scalar 치환, 두 occurrence, one-scene Undo/Redo, selection과
pending modifiers 보존, style no-bleed, scene-break/mixed-style 거부와 거부 뒤 editor
사용 가능을 통과했다.

## 6. named snapshot payload와 복원

payload는 `MADI_LOGICAL_JSON` version 1, embedded `madi.logical-snapshot` version 1의
uncompressed UTF-8 JSON이다. Typie BLOB은 base64로 넣고 exact payload bytes의 SHA-256
hex를 저장한다.

포함: project/app metadata subset, 전체 Binder node/order, 모든 SCENE document와
Typie snapshot/recovery, `workspace.v1`. 제외: named snapshots, search projection,
runtime/cache/log와 다른 UI-state key.

Desktop은 manual capture와 restore 직전에 현재 `workspace.v1`을 즉시 저장해 300ms
debounce와 logical payload capture가 경쟁하지 않게 한다.

복원 button을 누른 순간에도 target의 fresh diff를 다시 읽는다. 확인창에 제시된
snapshot ID, project revision과 summary가 fresh 결과와 모두 같을 때만 restore RPC를
호출한다. 하나라도 달라지면 새 summary를 표시하고 사용자가 다시 확인해야 한다.

restore는 대상 hash/형식/project/hierarchy/document를 검증하고 같은 transaction 안에서
현재 state를 `AUTO_BEFORE_RESTORE`로 저장한 뒤 logical state를 재생성한다. document
trigger가 검색 projection을 다시 만든다. 실패하면 safety snapshot도 남지 않는다.

## 7. schema migration 결과

논리 `format_version = 1`을 유지하고 schema/user version을 2에서 3으로 올렸다.

- `search_documents` + insert/update/delete trigger
- `named_snapshots` + project/created index
- migration record 3
- 기존 documents의 search projection transaction backfill

Rust migration test는 schema 2를 재구성한 fixture를 schema 3으로 열어 application ID,
기존 Korean recovery, migration record와 projection을 확인했다. schema 1 입력은 기존
schema 2 migration 뒤 같은 chain으로 schema 3에 도달한다.

## 8. 집중 test 결과

| 영역 | 명령/대상 | 현재 결과 |
|---|---|---|
| Rust 전체 | `pnpm test:core` | `PASS` — 23 / 23 |
| Desktop typecheck | `pnpm typecheck` | `PASS` |
| Desktop format/build | format check + renderer build | `PASS` |
| Desktop Vitest | `pnpm test:desktop` | `PASS` — 16 files / 88 tests |
| Typie semantic probe | `pnpm test:typie` | `PASS` |
| Typie patched runtime rebuild | `scripts/build-typie-phase1b-runtime.ps1` | `PASS` — WASM SHA-256 `3fd50f4f92c12595d3f81d585571a1001a24bbfa656bd8bf395119f19494c38a`, vendor clean |
| repository provenance | `pnpm check:repository` | `PASS` |
| Phase 1B 10+ SCENE integration | `pnpm test:phase1b` | `PASS` — aggregate integration 안에서 실행 |
| 전체 integration | `pnpm test:integration` | `PASS` |
| aggregate gate | `pnpm verify` | `PASS` — exit code 0 |
| unpacked build | `pnpm package:unpacked` | `PASS` |
| 실제 development Electron | `pnpm test:electron` | `PASS` |
| 실제 unpacked Electron | `pnpm test:package` | `PASS` |

집중 test의 주요 범위:

- core: v2→v3, ordered descendants, exact search/pagination/stats, logical snapshot
  CRUD/hash/diff/restore/rollback, source conflict와 atomic batch
- main/preload: allowlisted RPC, snake/camel mapping, shape/range/hash validation,
  snapshot byte copy
- React/App: Scrivenings one-live-editor/save-before-switch, search/navigation/highlight,
  selective BODY replacement request, snapshot CRUD/diff/restore confirmation

## 9. 앱 종료 후 재복원 결과

Phase 1B 전용 10 SCENE script는 WORK 1/VOLUME 2/CHAPTER 5/SCENE 10과 의미 scene
break 1개를 만들었다. 두 개의 실제 `madi-core serve` process를 사용해
reopen 뒤 Scrivenings text/order, exact search 결과/hash와 MANUAL/AUTO snapshot 목록을
대조했고 `PASS`했다.

development와 packaged Electron acceptance가 모두 `PASS`했다. fixture는 SCENE
11개를 만들고 WORK
Scrivenings 11개, live editor 1개와 read-only/light block 10개를 확인했다. Korean exact
검색 7건을 7 SCENE semantic batch로 치환해 기존 query 0/새 query 7을 확인하고
`AUTO_BEFORE_REPLACE`를 검증했다. manual snapshot restore는 원문 7건과
`AUTO_BEFORE_RESTORE`를 되살려 snapshot 목록 3개를 확인했다. 각 앱의 second Electron
process에서 WORK Scrivenings 11개, exact search 원문 7건과 snapshot 3개를 다시
확인했다.

## 10. 회귀와 보안 경계

기존 Phase 1A save/session/controller 경계를 재사용한다. generic filesystem/RPC를
renderer에 노출하지 않고 Phase 1B API도 고정 method와 strict validator로 제한한다.
Scrivenings preview RPC는 Typie snapshot을 반환하지 않는다. 오류에는 recovery 본문과
snapshot payload를 포함하지 않는다.

최종 `pnpm verify`가 기존 Phase 0.5/1A integration과 development/packaged Electron
smoke를 포함해 exit code 0으로 완료됐으므로 해당 자동 회귀 범위는 `PASS`다.

## 11. 현재 성능 한계

- 검색은 정확하지만 scope 전체를 선형 순회한다.
- renderer는 Scrivenings preview text를 전체 적재한다.
- named snapshot은 전체 logical state를 압축 없이 복제한다.
- snapshot 수/원고 크기에 따른 quota, retention과 pruning이 없다.
- 한 응답은 core에서 최대 64 MiB preview text로 제한한다.
- search renderer는 일관된 revision을 요구하므로 검색 중 save가 일어나면 다시 검색해야
  한다.
- project-wide Undo stack persistence와 부분 snapshot restore가 없다.
- 장시간/대규모/DPI/memory benchmark 수치는 아직 없다.

## 12. 수동 IME와 라이선스

Windows native 한국어 IME는 정확히 `MANUAL VALIDATION PENDING`이다. programmatic
composition/Vitest/Playwright 결과는 이 상태를 PASS로 바꾸지 않는다.

Typie runtime 표기는 `AGPL-3.0-only`이며 배포 결정은 정확히
`HUMAN DECISION REQUIRED BEFORE DISTRIBUTION`이다. 허용 범위는 비공개 로컬 개발과
제한된 내부 기술검증뿐이다. public download, 유료 배포, 고객 pilot/전달, app store,
installer 외부 전달 또는 proprietary production 배포는 금지한다.

## 13. Phase 1C 진입 여부

비공개 로컬 Phase 1C 준비 작업은 **조건부 진입 가능**하다. 모든 자동 gate는
통과했지만 project-wide 사용자 Undo 지속성, native Windows IME 수동 검증과 배포
라이선스 결정은 여전히 조건이다. Phase 1C 진입은 public/paid/customer distribution
승인이 아니다.

## 14. 다음 권장 작업

1. native Windows IME 15항목을 사람이 수행한다.
2. Phase 1C에서 장편 benchmark, preview page cache/virtual list와 snapshot retention을
   먼저 다룬다.
3. project-wide Undo/Redo를 snapshot restore UX로 유지할지 지속형 command log로
   확장할지 결정한다.
4. 배포 논의 전 Typie 라이선스 방식을 서면 결정한다.
