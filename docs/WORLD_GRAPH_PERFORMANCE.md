# World Graph 성능 검증

기준일: 2026-08-02

## 검증 환경과 방법

- Windows `10.0.26200.0`, 12th Gen Intel Core i9-12900K, logical processor 24개
- Node.js `26.3.1`, pnpm `11.9.0`, Rust `1.97.1` MSVC
- Cytoscape.js `3.34.0`, 내장 `cose`, 별도 layout extension 없음
- Fixture: entity 500, alias 1,500, canonical relation 2,000, explicit scene link 2,000
- Production/test 공통 layout: `animate: false`, `randomize: true`, `numIter: 200`,
  `nodeRepulsion: 500000`, `idealEdgeLength: 90`
- 각 집중 benchmark는 같은 process에서 5회 실행하고 정렬된 세 번째 값을 median,
  가장 큰 값을 maximum으로 기록했다.

수치는 이 PC와 당시 process 부하의 관측값이며 다른 장치의 보장이 아니다. 성능을 맞추기
위해 canonical node/edge를 자르지 않았고 모든 반복에서 500 node와 2,000 edge를
assert했다.

## Rust read model과 JSON 직렬화

`phase1d_world_graph.rs`가 실제 SQLite fixture를 한 transaction에서 읽었다.

| 항목 | 5회 median | 5회 maximum | 목표/결과 |
|---|---:|---:|---|
| Rust graph read model 생성 | 29.241 ms | 37.042 ms | 1초 미만 PASS |
| Rust `serde_json` 직렬화 | 19.212 ms | 23.584 ms | 1초 미만 PASS |
| 직렬화 payload | 838,888 bytes | 838,888 bytes | node/edge 누락 없음 |

Read model에는 500 node의 1,500 alias와 2,000 scene-link count, 2,000 canonical edge,
통계와 진단이 모두 포함된다.

## Main 경계 runtime validation

724,655-byte 500/2,000 mock core 응답을 strict parser로 5회 검증한 결과는 median
24.05 ms, maximum 27.56 ms였다. 이 값은 project/revision, exact key, endpoint,
directed/undirected metadata, degree, top-5와 집계값을 모두 재검증하는 main-side 비용이다.
최종 전체 Desktop suite 병렬 실행에서는 median 36.74 ms, maximum 63.67 ms였다.
실제 Electron IPC의 transport와 renderer 반영 시간은 아래 실제 창 측정과 구분한다.

## Renderer 계산과 layout

Production Canvas와 동일한 element converter와 COSE option factory를 headless Cytoscape에
적용했다.

| 항목 | 5회 median | 5회 maximum | 목표/결과 |
|---|---:|---:|---|
| client filter | 1.097 ms | 1.491 ms | 250 ms 미만 PASS |
| 이름/별칭/태그/요약 검색 | 4.954 ms | 6.529 ms | 250 ms 미만 PASS |
| BFS depth 1+2+3 합산 | 0.748 ms | 7.079 ms | 250 ms 미만 PASS |
| Cytoscape element 2,500개 변환 | 0.258 ms | 0.726 ms | 250 ms 미만 PASS |
| 내장 COSE 최초 layout | 1,038.716 ms | 1,309.526 ms | 5초 미만 PASS |
| 500-position state normalize/restore | 0.194 ms | 2.728 ms | 250 ms 미만 PASS |

최종 전체 Desktop suite와 병렬 실행했을 때도 COSE 5회 median 1,294.814 ms, maximum
1,641.906 ms였다. 이는 전용 실행보다 느리지만 5초 목표 안이다.

## 메모리

Headless Cytoscape instance 생성부터 layout 직후까지 `process.memoryUsage().heapUsed`의
signed delta는 median 약 1.963 MiB, maximum 약 30.111 MiB였다. GC 시점에 따라 음수도
나오는 근사치이므로 peak heap 보장으로 해석하지 않는다. 실제 Electron은
`performance.memory?.usedJSHeapSize`가 지원될 때 graph 진입 전후 값을 acceptance JSON에
기록한다.

## 실제 Electron 개발·unpacked 측정

| 실제 창 항목 | Development | Unpacked package | 목표/결과 |
|---|---:|---:|---|
| graph IPC 최초 / 재실행 | 110.6 / 122.5 ms | 64.5 / 72.4 ms | 각각 1초 미만 PASS |
| element 변환 | 1.4 ms | 1.4 ms | 250 ms 미만 PASS |
| 최초 layout | 1,091.8 ms | 1,038.9 ms | 5초 미만 PASS |
| layout 5회 median / maximum | 917.5 / 973.9 ms | 922.5 / 930.3 ms | 5초 미만 PASS |
| graph click-to-ready / 재실행 ready | 2,375 / 375 ms | 2,236 / 363 ms | 5초 미만 PASS |
| tag filter 내부 / 관측 | 0.6 / 116.13 ms | 0.5 / 121.41 ms | 250 ms 미만 PASS |
| alias result ready / click-to-focus | 45.57 / 419.38 ms | 45.14 / 407.32 ms | focus 목표 초과 |
| BFS depth 1 내부 / 관측 | 0.5 / 349.41 ms | 0.6 / 250.46 ms | 관측 목표 초과 |
| BFS depth 2 내부 / 관측 | 0.5 / 70.14 ms | 0.5 / 85.74 ms | 250 ms 미만 PASS |
| BFS depth 3 내부 / 관측 | 0.4 / 63.79 ms | 0.5 / 69.05 ms | 250 ms 미만 PASS |
| node selection 관측 | 357.37 ms | 314.26 ms | 목표 초과 |
| lazy detail heading 관측 | 434.96 ms | 387.05 ms | 목표 초과 |
| pan/zoom 관측 | 139.87 ms | 117.06 ms | 250 ms 미만 PASS |
| renderer heap 근사 delta | +48,858,736 B | +49,306,000 B | crash 없음, GC 종속 |
| 재실행 heap 근사 delta | +26,302,616 B | +17,497,695 B | crash 없음, GC 종속 |

실제 창 smoke는 Cytoscape canvas의 양수 크기와 non-transparent pixel, 접근 가능한
node/edge 목록, full/focused depth 1·2·3, 검색/filter/selection, Story Bible·SCENE 이동,
viewport와 position 저장 및 두 번째 process 복원을 검증한다. 외부 URL 요청은 허용된
local runtime URL 외에는 0이어야 한다.

## 응답성과 해석

- 500/2,000에서 filter, 검색, BFS와 element 변환은 7.079 ms 이하였다.
- COSE는 renderer thread에서 동기로 실행되므로 약 1.1~1.7초 동안 입력 지연이 생길 수
  있다. Crash나 5초 초과는 없었지만 worker/cancel 가능한 layout은 후속 개선점이다.
- 실제 pan/zoom/selection의 기능 경로는 development와 unpacked 창에서 검증한다.
- `displayMs`는 React commit 뒤 다음 animation frame까지의 계측이며 전체 COSE 시간을
  뜻하지 않는다. End-to-end는 graph 버튼 click부터 ready 조건까지 별도로 기록한다.
- 500/2,000보다 큰 graph는 Phase 1D main validator가 자르지 않고 명시적으로 거부한다.

## 판정

500/2,000 hard gate인 무누락, no-crash, graph read/IPC 1초 미만, layout 5초 미만,
offline/security와 process restart 복원은 모두 PASS다. 그러나 development와 packaged
양쪽에서 검색 focus, selection과 lazy detail이 250 ms 목표를 넘었고 depth 1도 경계 또는
초과였다. 따라서 성능 판정은 **CONDITIONAL TECHNICAL GO — PRIVATE LOCAL**이다.

다음 최적화는 renderer 내부 계산이 아니라 click→React selection→세 개 lazy read-only
RPC→detail commit 경로를 각각 분리 계측하는 것이다. 이 지연을 250 ms 안으로 줄이기 전
공개·유료·고객 배포 근거로 사용하지 않는다.
