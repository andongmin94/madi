# Phase 1D 저장소 결과

기준일: 2026-08-02

```text
Verdict: CONDITIONAL TECHNICAL GO — PRIVATE LOCAL
Scope: WORLD GRAPH READ MODEL & VISUALIZATION — PRIVATE LOCAL
Windows native Korean IME: MANUAL VALIDATION PENDING
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Public/paid/customer distribution: NOT AUTHORIZED
```

이 문서는 `codex/phase-1d`에서 실제 구현한 Rust read model, Cytoscape 화면, 작품별 UI
state, 성능과 development/unpacked Electron 검증 결과를 기록한다.

## 1. Cytoscape와 layout 선택

Desktop runtime dependency는 Cytoscape.js `3.34.0` exact version이다. MIT license와
원문 package 경로를 확인했고 unpacked package에 `resources/licenses/CYTOSCAPE-MIT.txt`를
포함한다. 별도 extension 없이 내장 force-directed `cose`를 사용한다. Production과 test는
같은 option factory를 사용하며 `numIter: 200`이다. 500/2,000 5회 maximum이 5초 목표
안이어서 `cytoscape-fcose` 등 추가 extension과 license/bundle 비용을 만들지 않았다.

## 2. Graph read model 구조

`entities`, `entity_aliases`, `tags`, `entity_tags`, `relation_types`,
`entity_relations`, `scene_entity_links`가 유일한 canonical source다. 새 graph table이나
migration 없이 Rust가 `WorldGraphReadModel { projectId, revision, nodes, edges, stats,
diagnostics }`를 transaction에서 파생한다. Renderer는 SQLite를 직접 읽지 않는다.

Read-only 명령은 `get_world_graph`, `get_world_graph_stats`,
`get_entity_graph_detail`, `get_entity_scene_context` 네 개다. Main은 고정 session
capability와 strict runtime validation을 거치며 Cytoscape type은 renderer 변환 계층 밖으로
나가지 않는다. `.madi`의 `format_version = 1`, `schema_version = 4`를 유지했다.

## 3. Directed·undirected·inverse 표현

Directed edge는 canonical source에서 target으로 triangle arrow와 forward label을 표시한다.
Target 관점 detail은 inverse label, 없으면 forward label을 사용한다. Undirected는 arrow가
없고 canonical relation ID 하나만 양쪽 detail에서 공유한다. 역방향 중복은 진단 후 한
edge만 남긴다. Self, dangling, cross-project relation은 canvas에 강행하지 않고 진단한다.

## 4. Node·edge visual semantics

8종 kind는 색상만이 아니라 ellipse, round-rectangle, hexagon, diamond, rectangle, star 등
shape와 text kind를 함께 쓴다. 지원되는 entity `color_token`과 `icon_key`를 반영하고
ARCHIVED는 기본 filter에서 제외하며 포함 시 opacity/badge로 구분한다. Edge는 relation type
color, arrow 유무와 text 방향을 함께 쓴다. 긴 label은 canvas에서 줄이고 full text와 note는
detail에 표시한다. 사용자 text를 HTML로 주입하지 않는다.

## 5. 전체·중심 graph, filter와 검색

전체 graph와 안정 정렬 BFS 기반 중심 graph depth 1·2·3을 제공한다. Directed도 탐색
이웃 계산에서는 양방향, undirected도 양방향으로 취급하되 edge 의미는 유지한다. Kind,
status, tag ANY/ALL, built-in/custom relation type, directed/undirected, 고립 node와 label을
client-side로 조합한다. 기본 status는 ACTIVE+DRAFT다.

검색은 이름·별칭·태그·요약의 case-insensitive substring이다. 결과는 kind와 일치 field를
표시하고 선택 node가 숨겨졌다면 이유와 필요한 filter 조정을 알린 뒤 선택·중앙 배치한다.

## 6. Detail과 기존 화면 이동

Node detail은 기본 metadata, 방향별 관계, alias/tag, 명시적 SCENE link와 본문 mention
후보 수를 표시한다. Mention은 node 선택 시 기존 discovery API로 lazy load하며 자동
relation/link 승격을 하지 않는다. Edge detail은 endpoint, type, 방향, forward/inverse
label과 note를 표시한다. Node/edge에서 기존 Story Bible로, scene link에서 원고 SCENE으로
이동하며 graph 자체에는 canonical write API가 없다.

## 7. UI state persistence

`world-graph.v1`을 기존 `ui_state` table에 작품별로 저장한다. Full/focused mode, 중심 ID,
depth, filter, layout, viewport, 최대 500 node position과 마지막 선택 entity ID를 포함한다.
Drag는 좌표만 저장한다. 새 node에는 layout 좌표를 쓰고 삭제된 node·tag·relation type의
stale UI state는 model 갱신 때 정리한다. 작품 전환·mode 전환·window close 전에 최신
state를 flush하고 두 번째 process에서 복원한다.

Graph UI state는 project revision을 올리지 않으며 named snapshot payload에 들어가지
않는다. Snapshot restore 뒤 현재 배치를 유지하는 결정은 ADR-0003에 기록했다.

## 8. 500/2,000 성능

실제 SQLite fixture와 production과 같은 renderer 변환/layout으로 5회 측정했다. Rust
read model median/maximum은 29.241/37.042 ms, JSON serialization은
19.212/23.584 ms, focused renderer COSE layout은 1,038.716/1,309.526 ms였다.
Filter·검색·BFS·element 변환·500-position 복원은 모두 maximum 7.079 ms 이하였다.
Payload는 838,888 bytes이고
500 node, 1,500 alias, 2,000 edge, 2,000 scene link를 자르지 않았다. 상세 방법과 실제
Electron 측정은 [`WORLD_GRAPH_PERFORMANCE.md`](WORLD_GRAPH_PERFORMANCE.md)에 있다.

## 9. Development·packaged Electron 검증

실제 Playwright-Electron 창에서 development와 fresh unpacked package를 각각 실행하고
두 번째 process까지 다시 열었다. 양쪽 모두 실제 Cytoscape canvas에서 500 node/2,000
edge를 자르지 않고 표시했고, 5회 layout, tag/relation/direction filter, alias 검색,
depth 1·2·3, keyboard 목록, detail lazy load, wheel pan/zoom과 pointer node drag를 통과했다.
Drag 전후와 재실행 좌표가 정확히 일치했고 project revision `2`, node `500`, edge
`2,000`도 전후 동일했다.

Development의 IPC는 최초/재실행 `110.6/122.5 ms`, 5회 layout median/maximum은
`917.5/973.9 ms`, 최초 click-to-ready는 `2,375 ms`였다. Packaged는 IPC
`64.5/72.4 ms`, layout `922.5/930.3 ms`, ready `2,236 ms`였다. 외부 runtime 요청은
양쪽 모두 실제 집계 `0`, offline reload와 임의 local-file read 차단도 PASS다.

기능·crash·보안·5초 layout hard gate는 모두 통과했다. 다만 실제 창에서 검색 결과
click-to-focus, node selection, lazy detail heading과 최초 depth 1 전환이 일부 250 ms
목표를 넘었다. 정확한 값 때문에 최종 판정은 `CONDITIONAL TECHNICAL GO — PRIVATE
LOCAL`이다. Screenshot은 `output/playwright/madi-{electron,packaged}-phase1d-scale-*.png`
세트에 남겼다.

## 10. 보안과 offline

`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`를
유지했다. Renderer에 filesystem/process/shell/generic RPC 권한을 추가하지 않았고
production은 local `madi://app`과 bundled assets만 사용한다. Smoke는 외부 URL 요청 0과
offline reload를 검사한다. Label, summary와 relation note는 React text/Cytoscape data로만
전달하며 `innerHTML`을 쓰지 않는다.

## 11. 테스트와 완료 gate

최종 source에서 `pnpm verify`는 exit code `0`(145.2초)으로 끝났다. Desktop은
`27 files / 136 tests`, Rust는 `33 / 33 tests`가 PASS했다. Phase 1D sidecar
integration은 10 scene, 19 entity, 16 relation(12 directed/4 undirected)을 두 process에서
재검증했고 final revision은 `94`였다. Named snapshot restore 전후 `world-graph.v1`이
보존되어 graph UI state가 snapshot payload에 들어가지 않는 것도 확인했다.

독립 `pnpm test:electron`과 `pnpm test:package`는 각각 exit code `0`이었다. 두 명령은
기존 Phase 1B/1C 실제 창 회귀와 Phase 1D small graph에 이어 500/2,000 scale graph의
actual canvas, pointer drag, process restart를 모두 실행한다. `pnpm check:repository`는
pinned Typie commit, 9 artifact hash와 adapter/core 경계를 PASS했고 `pnpm format:check`는
103 files에서 trailing whitespace/invalid JSON `0`이었다. TypeScript typecheck와
Typie semantic probe도 PASS했다.

`pnpm package:unpacked`은 `output/madi-win32-x64/madi.exe`와 release sidecar, runtime,
Cytoscape license를 생성했다. 실행 파일은 204,521,984 bytes, `madi-core.exe`는
5,028,864 bytes였다. Installer, signing, update와 외부 배포는 만들지 않았다.

## 12. 접근성·IME·라이선스

검색/filter는 native keyboard control이고 canvas 앞뒤 focus, Enter로 detail 이동,
Escape 선택 해제와 동일 node/edge keyboard 목록을 제공한다. Kind/방향은 색상만으로
표현하지 않고 기존 Story Bible 목록을 유지한다. Screen reader 완전 검증은 이번 단계의
완료 조건이 아니다.

```text
Windows native Korean IME: MANUAL VALIDATION PENDING
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
```

Programmatic 한국어 입력과 Playwright는 native 후보창 수동 검증을 대체하지 않는다.
Cytoscape MIT 추가는 Typie의 기존 배포 판단을 바꾸지 않으며 공개·유료·고객 배포는
승인되지 않았다.

## 13. 알려진 한계와 Phase 1E

- 500/2,000보다 큰 graph는 canonical data를 자르지 않고 main validator에서 명시적으로
  거부한다. 이 범위를 늘리려면 별도 성능·payload 계약이 필요하다.
- COSE는 renderer thread에서 동기 실행된다. 현재 maximum은 1초 안팎이지만 실행 중
  입력 지연을 취소할 수 없으므로 worker/cancellable layout은 후속 hardening 항목이다.
- 실제 창 검색 focus는 development/packaged `419.38/407.32 ms`, selection은
  `357.37/314.26 ms`, lazy detail은 `434.96/387.05 ms`, depth 1은
  `349.41/250.46 ms`였다. 내부 filter/search/BFS 계산은 1 ms 안팎이므로 병목은
  Playwright action을 포함한 React/detail IPC·render 경로에 있다.
- Screen reader 완전 검증과 Windows native 한국어 IME는 수행하지 않았다. Bundle은
  Cytoscape 포함으로 Vite의 500 kB warning을 내지만 package와 runtime에는 영향이 없다.
- 그래프는 계속 read-only다. relation 편집, 자동 관계 추론과 500/2,000 초과 확장은
  Phase 1D 범위가 아니다.

따라서 Phase 1E는 **조건부 진입 가능 — PRIVATE LOCAL ONLY**다. 공개·유료·고객 배포는
허용하지 않으며, 첫 후속 작업은 위 네 interaction latency의 분리 계측과 250 ms 목표
회복이다. 그 다음에만 Phase 1E 제품 범위를 확정한다.
