# Phase 1E 저장소 결과

기준일: 2026-08-08

```text
Phase 1D verdict: CONDITIONAL TECHNICAL GO — PRIVATE LOCAL
Phase 1E verdict: TECHNICAL GO — PRIVATE LOCAL
Windows native Korean IME: MANUAL VALIDATION PENDING
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Public/paid/customer distribution: NOT AUTHORIZED
```

이 문서는 `codex/phase-1e`에서 실제 구현하고 development/fresh unpacked Electron의 새
process 재실행까지 검증한 결과다. Phase 1E 판정은 비공개 로컬 기술검증만 승인하며
installer, signing, update, 서버, 공개·유료·고객 배포를 승인하지 않는다.

## 1. Phase 1D interaction hardening

World Graph 선택 경로를 즉시 shell과 지연 detail로 분리했다. 선택 강조·이웃 강조·기본
metadata shell은 detail RPC를 기다리지 않는다. Entity detail, scene context, mention
discovery는 `Promise.all`로 시작하고 `(projectId, projectRevision, entityId)` cache를 쓰며,
generation/entity/revision 검증으로 stale commit을 버린다. 선택·검색·detail·hover로 COSE
layout을 다시 실행하지 않고 World Graph를 별도 lazy chunk로 분리했다.

500/2,000 실제 창 5회 결과는 제품 내부 mark와 Playwright 외부 clock을 구분해야 한다.

| 항목 | Phase 1D 이전 dev/pkg | hardening 후 dev/pkg median | 내부 mark dev/pkg median |
|---|---:|---:|---:|
| 검색 click→focus | 419.38 / 407.32 ms | 667.55 / 668.17 ms | handler 0.1 / 0.1 ms |
| node 선택 | 357.37 / 314.26 ms | 740.08 / 593.17 ms | React commit 14.7 / 8.4 ms |
| 이전 lazy-detail heading / 이후 shell 누적 | 434.96 / 387.05 ms | 833.89 / 656.61 ms | shell commit 14.7 / 8.4 ms |
| full lazy detail | 기존 분해 없음 | 1,234.78 / 1,001.05 ms | 131.2 / 98.9 ms |
| pan/zoom | 139.87 / 117.06 ms | 119.55 / 119.87 ms | — |
| layout 5회 | 917.5 / 922.5 ms | 977.4 / 977.1 ms | 5초 hard gate PASS |

이전 값은 1회 중심이고 이후 값은 5회 median이라 완전한 A/B가 아니다. Selection과
heading endpoint의 외부 wall clock은 같은 계열에서 악화했고, 검색은 추가 dataset
read/두 animation frame으로 scope가 늘었으며 full detail은 새 지표다. Center animation은
비동기로 겹칠 수 있지만 고정 포함 비용으로 계산하지 않는다. 내부 선택·shell·병렬 RPC는
목표 안이지만 같은 외부 acceptance 정의의 250/500ms 목표는 넘었다. Cache hit, stale
차단, layout request 불변, 500/2,000 무누락, no-crash와 재실행은 PASS다. 수치를
재분류해 GO로 만들지 않고 Phase 1D 판정은
`CONDITIONAL TECHNICAL GO — PRIVATE LOCAL`로 유지한다. 상세 수치는
[`WORLD_GRAPH_PERFORMANCE.md`](WORLD_GRAPH_PERFORMANCE.md)에 있다.

## 2. Plot Canvas 구현

상단에 `원고 / 설정 / 그래프 / 캔버스` 모드를 추가했다. 현재 session의 Binder/UI 복원이
끝나기 전 모드 버튼을 fail-closed해 초기 open과 mode click 경합도 차단한다. Canvas 화면은
목록, React Flow workspace, inspector로 분리되며 다음을 실제 구현했다.

- Canvas 생성, 이름·설명 수정, 복제, node/edge count 확인 후 삭제, 이름/수정일 정렬
- pan, zoom, fit view, dot grid, minimap/grid/snap 설정
- Text, Entity reference, Scene reference, Group node
- drag, resize, box/multi-select, duplicate, delete, z-order, group attach/unlock
- label, color, line style, source/target side, arrow/no-arrow edge
- keyboard toolbar, `Ctrl+K`, `Ctrl+S`, `Ctrl+Z/Y`, `Ctrl+D`, Delete
- 접근 가능한 node/edge 목록과 inspector 편집
- 마지막 Canvas, viewport, selection, inspector 폭과 표시 옵션 복원

React Flow의 controlled selection은 `onNodesChange/onEdgesChange` select delta 하나만
authoritative source로 쓴다. Canonical width/height/measured와 unchanged node/edge reference
structural sharing으로 grouped child 반복 drag의 ResizeObserver loop를 제거했다.

## 3. 저장 구조와 JSON Canvas

SQLite schema는 `5`, logical `format_version`은 `1`이다. `canvases` table은 `id`,
`project_id`, `name`, nullable `description`, `document_format`, `document_version`,
`document_json`, `content_hash`, `revision`, `created_at`, `updated_at`을 저장한다.
`document_format = JSON_CANVAS`, `document_version = 1.0`이며 canonical JSON bytes의
SHA-256을 content hash로 쓴다.

공개 저장 계약은 madi 소유 `MadiCanvasDocument`와 JSON Canvas DTO다. React Flow type은
Rust, SQLite, main/preload IPC, snapshot payload에 노출되지 않는다. 표준 consumer는 madi
reference도 fallback `text` node로 읽을 수 있고 알 수 있는 안전한 extension은 round-trip
보존한다. Node는 최대 500, edge는 최대 1,000이며 ID, endpoint, integer geometry,
크기/좌표 범위와 document bytes를 Rust/main/renderer 경계에서 검증한다.

지원 node는 JSON Canvas `text`, `group`과 `madi.nodeKind`의 `TEXT`, `GROUP`,
`ENTITY_REFERENCE`, `SCENE_REFERENCE`다. 외부 URL, file, image, HTML, iframe/web node는
지원하지 않는다. Edge는 `fromNode/toNode`, side, end arrow, color, label과
`madi.lineStyle = SOLID | DASHED | DOTTED`를 지원한다.

## 4. Reference와 Story Bible 분리

Entity reference는 `entityId`, Scene reference는 `sceneNodeId`만 canonical target으로
삼는다. 화면 label/kind/status/summary/scene preview는 현재 Story Bible/Binder catalog에서
읽으며 export용 fallback text만 document에 둔다. 이름·상태·제목 변경은 document mutation
없이 표시를 갱신한다. Target 삭제 시 node를 자동 삭제하지 않고 원래 label을 가진 broken
reference로 유지하며 다른 target relink, Text 변환 또는 삭제를 제공한다. Inspector와
double click으로 기존 Story Bible/원고 화면을 연다.

Story Bible과 World Graph의 `캔버스에 추가`는 entity ID만 전달하고 대상 Canvas를
키보드로 선택한 뒤 추가한다. Cytoscape 객체나 React Flow 객체를 넘기지 않는다. Canvas
edge는 작가 소유 planning connection이며 `entity_relations`, relation type 또는
`scene_entity_links`를 생성·수정·삭제하지 않는다. 이 소유권 결정은
[`ADR-0004`](decisions/ADR-0004-plot-canvas-is-author-owned-planning-data.md)에 고정했다.

## 5. Autosave와 session history

Canvas 변경은 약 500ms debounce 뒤 저장한다. `dirty / saving / saved / error`, 마지막
저장 시각, 저장 중 추가 변경의 후속 예약, `Ctrl+S`, Canvas/mode/project 전환과 window
close 전 flush를 지원한다. Save request는 project revision, Canvas revision,
`canvasId/generation/saveSequence`를 검증한다. 같은 canonical hash는 Canvas/project
revision과 timestamp를 올리지 않는다. 실패는 local edit를 유지하고 전환·종료·snapshot을
fail-closed한다.

Undo/Redo는 Canvas별 session-local 최대 100 entry다. 연속 drag/resize gesture는 각각 한
entry로 합치며 create/delete/move/resize/text/group/edge/multi-move를 다룬다. 저장 뒤에도
현재 session history는 유지하지만 앱 재시작과 named snapshot에는 포함하지 않는다.

## 6. Snapshot v3

Named snapshot payload v3는 Canvas metadata, canonical JSON, revision과 content hash를
tree/documents/Story Bible과 같은 logical payload에 포함한다. Diff는 added/deleted/changed
Canvas와 node/edge count delta를 제공한다. UI state, viewport, selection, inspector,
temporary drag, session Undo와 React Flow runtime object는 포함하지 않는다.

Restore는 dirty scene/entity/Canvas를 먼저 flush하고 `AUTO_BEFORE_RESTORE`를 만든 뒤 hash와
전체 payload를 검증해 한 SQLite transaction으로 복원한다. 실패 시 전부 rollback한다.
실제 v3 create/diff/restore와 Rust의 v1/v2 decode·Canvas 없는 상태 복원, v3 rollback을
모두 검증했다. v1/v2 지원은 사용자가 명시한 snapshot 요구에 한정하며 새 저장 경로는 v3
하나뿐이다.

## 7. Import와 export

한 Canvas를 deterministic UTF-8 `.canvas`로 export한다. 원고 본문 전체를 포함하지 않고
madi extension과 fallback label을 보존한다. Import는 dialog가 선택한 최대 8MiB 파일만
읽고 UTF-8/JSON/runtime schema/ID/endpoint/500·1,000 limit를 검증한다. Preview에
node/edge count를 표시한 뒤 항상 새 Canvas를 만들며 malformed document는 기존 Canvas를
바꾸지 않는다. Script/HTML을 실행하거나 URL을 자동 접근하지 않는다.

실제 Electron은 60,202-byte export를 preview하고 101 node/200 edge 새 Canvas로 import한
뒤 새 process에서 같은 count를 복원했다.

## 8. Code splitting과 dependency

`@xyflow/react`는 exact `12.11.2`, MIT다. JSON Canvas 1.0 spec/reference license도 MIT다.
최종 lazy chunks는 다음과 같다.

| boundary | raw / gzip |
|---|---:|
| main `index-BWI-Lh7S.js` | 411,058 / 116,548 B |
| Plot Canvas `PlotCanvasMode-f0f_jqc_.js` | 249,549 / 79,557 B |
| World Graph `WorldGraphWorkspace-ChJKQQFz.js` | 478,653 / 153,125 B |

Production `index.html`은 main만 직접 참조한다. Build 뒤 `pnpm test:bundle`이 두 heavy
feature의 dynamic boundary와 eager import 부재를 검사한다.

## 9. Scale와 실제 Electron

결정론적 fixture는 일반 Canvas 10×100/200과 대형 Canvas 500/1,000, 총 1,500 node와
3,000 edge다. Rust/SQLite `load_canvas` 5회는 median/maximum `45.96/46.18 ms`다.
Renderer parse `3.317/7.967 ms`, React Flow 변환 `3.678/15.303 ms`, canonical
serialization `3.506/6.737 ms`다.

실제 development와 fresh unpacked package 모두 다음을 통과했다.

- 500/1,000 canonical/DOM exact를 5회 전환
- fit, `Ctrl+K`, exact 2-node multi-select와 grouped child pointer drag 5회
- text add, inspector resize, Undo/Redo, pointer edge create/delete
- Canvas 전환 전 flush, export/import, snapshot v3 diff/safety restore
- Canvas `11 → 12 → 새 process 12`, drag `0,0 → 100,75` exact 복원
- page error `0`, renderer diagnostic `0`, external runtime request `0`
- offline reload와 임의 local-file read 차단

5회 median/maximum과 단일 workflow 수치는
[`PLOT_CANVAS_PERFORMANCE.md`](PLOT_CANVAS_PERFORMANCE.md)에 구분해 기록했다. Cold
`Ctrl+K` median은 dev/package `518.40/520.72 ms`, maximum `621.96/642.24 ms`로
추가 hardening 대상이지만 crash·loss·3초 freeze는 없었다.

## 10. Test와 package gate

고정 Node.js `26.3.1`, pnpm `11.9.0`에서 최종 결과는 다음과 같다.

| 명령 | 결과 | wall time |
|---|---|---:|
| `pnpm verify` | PASS | 294.354 s |
| `pnpm package:unpacked` | PASS | 5.879 s |
| `pnpm test:electron` | PASS | 121.646 s |
| `pnpm test:package` | PASS | 122.905 s |
| `pnpm test:bundle` | PASS, 1 file/2 tests | 2.074 s |
| `pnpm check:repository` | PASS | 0.637 s |
| `pnpm format:check` | PASS, 136 files | 0.466 s |
| isolated Plot Canvas performance | PASS, 1 file/1 test | 1.974 s |

`verify` 안에서 Desktop `39 files / 219 tests`, Rust `41 tests`, Typie probe,
Phase 1A/B/C/D/E sidecar integration, endurance schema migration 1→5, production build,
bundle, development/packaged actual Electron을 모두 통과했다. Sandbox의 `spawn EPERM`이 난
GUI/esbuild/git read-only 명령은 승인된 외부 실행으로 같은 명령을 재실행해 PASS했으며
product assertion은 바꾸지 않았다.

Fresh unpacked artifact:

| artifact | bytes | SHA-256 |
|---|---:|---|
| `madi.exe` | 204,521,984 | `8d205e25b40da3ada4a08c92f32bfbd8e8d38edb4bfe443deea77fc9de685bac` |
| `resources/bin/madi-core.exe` | 5,499,904 | `19014648fea18b42476f7b5b30324c3247c92cffe6aa9000324ced105353e7e5` |

이 폴더는 installer나 배포물이 아니다.

## 11. 보안·접근성·라이선스

`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, fixed IPC allowlist와
session capability를 유지한다. Canvas text는 React text로만 렌더하고 import color는 JSON
Canvas preset/strict hex만 paint에 전달한다. 실패 증거와 console bridge는 원고/Entity
note/relation note/Canvas text를 출력하지 않고 길이·수치·hash만 기록한다.

Canvas list/picker/toolbar/inspector와 접근 가능한 node/edge panel은 keyboard로 사용할 수
있다. 완전한 screen reader와 Windows native IME 후보창 검증은 후속 수동 gate다.

Unpacked `resources/licenses`에는 Typie, Nanum Gothic, Cytoscape, React Flow, JSON Canvas와
`THIRD_PARTY_NOTICES.md`가 있다. React Flow/JSON Canvas MIT 추가는 Typie 배포 결정을
바꾸지 않는다.

```text
Windows native Korean IME: MANUAL VALIDATION PENDING
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
```

## 12. 알려진 한계와 다음 단계

- Phase 1D 외부 interaction acceptance는 목표를 넘으므로 판정은 계속 CONDITIONAL이다.
- Plot Canvas hard limit는 Canvas당 500 node/1,000 edge다.
- Ctrl+K, pointer gesture, autosave end-to-end를 더 줄이는 interaction profiling이 남았다.
- Session Undo는 재실행 뒤 복원하지 않고 snapshot은 Canvas별 세부 diff를 제공하지 않는다.
- Entity rename→delete→broken→relink는 Rust integration과 renderer catalog/workspace test로
  각 경계를 검증했지만 하나의 실제 Electron 연속 workflow로도 다시 묶는 것이 바람직하다.
- 장시간 heap, crash/power-loss fault injection, DPI/다중 monitor, screen reader와 native
  한국어 IME는 pre-release hardening 대상이다.
- Remote recursive clean clone 검증은 `DEFERRED TO PRE-RELEASE`다.

Phase 1E는 **TECHNICAL GO — PRIVATE LOCAL**이다. Phase 1F는 비공개 로컬 hardening에
한해 진입 가능하다. 첫 작업은 Phase 1D external timing 정의/UX 최적화와 Canvas cold
`Ctrl+K`/autosave profiler, 그 다음 actual Entity reference lifecycle 연속 smoke와 장시간
fault-injection이다. 공개·유료·고객 배포는 Typie license 결정과 수동 IME/pre-release
gate 전까지 금지한다.
