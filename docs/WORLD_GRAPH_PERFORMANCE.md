# World Graph 성능 검증

기준일: 2026-08-08

## 환경과 측정 경계

- Windows x64, Node.js `26.3.1`, pnpm `11.9.0`, Rust `1.97.1` MSVC
- Cytoscape.js exact `3.34.0`, built-in `cose`, `numIter: 200`
- Fixture: entity 500, alias 1,500, relation 2,000, explicit scene link 2,000
- Development Electron과 fresh unpacked package를 각각 새 process까지 검증
- 5회 정렬 세 번째 값이 median, 가장 큰 값이 maximum

세 종류의 clock을 섞지 않는다.

1. Rust/renderer micro-benchmark는 순수 계산 경계다.
2. Renderer performance mark는 browser event 이후 React/Cytoscape/RPC 내부 경계다.
3. Playwright 외부 clock은 locator actionability, scroll, polling과 paint wait를 포함한다.

## Renderer 계산과 COSE

독립 `world-graph-performance.test.ts`의 최종 5회 결과다.

| 항목 | median | maximum |
|---|---:|---:|
| client filter | 0.879 ms | 1.040 ms |
| 이름/별칭/태그/요약 검색 | 5.116 ms | 6.222 ms |
| BFS depth 1+2+3 | 0.938 ms | 7.083 ms |
| 2,500 element 변환 | 0.346 ms | 0.867 ms |
| built-in COSE | 1,176.725 ms | 1,244.787 ms |
| 500-position state normalize/restore | 0.280 ms | 0.586 ms |

Heap signed delta는 median 약 `1.801 MiB`, maximum 약 `29.389 MiB`였다. GC timing에
따라 음수가 나오는 근사치이며 peak heap 보장이 아니다.

## Actual load와 layout

| 실제 창 항목 | Development | Packaged |
|---|---:|---:|
| initial graph IPC | 106.1 ms | 65.4 ms |
| restart IPC | 127.3 ms | 76.8 ms |
| initial layout | 1,069.6 ms | 1,104.5 ms |
| layout 5회 median / max | 977.4 / 982.1 ms | 977.1 / 1,000.6 ms |
| initial click-to-ready | 2,434 ms | 2,466 ms |
| restart ready | 402 ms | 363 ms |
| pan/zoom | 119.55 ms | 119.87 ms |

모든 run은 canonical/accessible/actual canvas 500 node/2,000 edge를 assert한다. Actual
pointer drag는 selected node를 rendered `48×36` 이동했고 saved model position, viewport와
500 positions가 새 process에서 exact 복원됐다. Drag 전후 project revision `2`와
canonical count는 변하지 않았다.

## Interaction 내부 mark

선택 직후 shell과 lazy detail을 분리한 5회 결과다.

| 구간 | Development median / max | Packaged median / max |
|---|---:|---:|
| search click handler | 0.1 / 0.1 ms | 0.1 / 0.1 ms |
| React selection commit | 14.7 / 16.6 ms | 8.4 / 11.0 ms |
| Cytoscape lookup | 0 / 0 ms | 0 / 0 ms |
| focus animation start | 0.3 / 0.3 ms | 0.3 / 0.3 ms |
| neighbor highlight | 11.3 / 11.8 ms | 6.6 / 9.1 ms |
| detail shell commit | 14.7 / 16.6 ms | 8.4 / 11.0 ms |
| entity detail RPC | 119.9 / 131.8 ms | 88.1 / 90.7 ms |
| scene context RPC | 119.8 / 131.8 ms | 88.0 / 90.6 ms |
| mention discovery RPC | 119.8 / 131.9 ms | 88.0 / 90.7 ms |
| IPC serialize/deserialize | 0.045 / 0.102 ms | 0.039 / 0.047 ms |
| parallel lazy round trip | 119.9 / 132.0 ms | 88.1 / 90.8 ms |
| React detail commit | 11.9 / 12.9 ms | 9.9 / 12.5 ms |
| full lazy detail | 131.2 / 144.6 ms | 98.9 / 102.3 ms |

세 read-only RPC는 같은 시점에 시작하며 가장 긴 한 요청 수준에서 끝난다. 동일 node
재선택은 cache hit `1`, A 직후 B 선택은 A를 commit하지 않았고 selection 5회 동안
auto-layout request는 불변이었다.

## Playwright 누적 외부 clock

| 항목 | Development median / max | Packaged median / max | 목표 |
|---|---:|---:|---:|
| search result ready | 222.66 / 250.54 ms | 216.21 / 225.83 ms | 250 ms |
| click→focus | 667.55 / 737.11 ms | 668.17 / 703.35 ms | 250 ms |
| visual selection | 740.08 / 782.05 ms | 593.17 / 657.52 ms | 100 ms |
| detail shell 누적 | 833.89 / 869.94 ms | 656.61 / 722.94 ms | 100 ms |
| full detail 누적 | 1,234.78 / 1,325.10 ms | 1,001.05 / 1,073.36 ms | 250/500 ms |
| depth 1 | 371.92 ms | 263.06 ms | 250 ms |
| depth 2 | 74.91 ms | 79.05 ms | 250 ms |
| depth 3 | 101.65 ms | 67.57 ms | 250 ms |

이 clock은 actual click을 시작하기 전 Playwright timer를 켜고 locator actionability/scroll,
50ms dataset poll과 full-detail의 detached wait/두 animation frame까지 누적한다. 따라서
내부 mark와 직접 합산되지 않는다. 예를 들어 packaged shell의 selection 이후 증분은 약
63ms지만 누적 shell clock은 656.61ms다.

Phase 1D 이전 407–435ms 값은 1회 중심이고 이번 값은 5회 median/max와 확장된 분해를
사용하므로 완전한 전후 A/B가 아니다. 내부 product work는 목표 안으로 줄었지만 현재 외부
acceptance 정의는 목표와 완화 500ms를 넘는다.

## Security, integrity와 bundle

- development/packaged page error `0`, external runtime request `0`
- offline reload PASS, arbitrary local-file read blocked
- canonical project/revision/node/edge가 drag 전후/재실행 exact
- label, summary, manuscript, Entity/relation note를 stdout/evidence에 기록하지 않음
- World Graph JS `WorldGraphWorkspace-ChJKQQFz.js`: raw 478,653 / gzip 153,125 B
- main entry에서 Cytoscape eager runtime import 없음

## 판정

500/2,000 no-loss/no-crash, IPC 1초, layout 5초, pan/zoom, stale/cache, security와 재실행
gate는 모두 PASS다. 그러나 동일 외부 clock의 search focus, selection, shell, full detail과
depth 1이 목표를 넘는다. 판정은 **CONDITIONAL TECHNICAL GO — PRIVATE LOCAL**이다.

다음 GO 재평가는 browser event timestamp에서 실제 focus/paint까지의 정의를 먼저 고정하고
accessible-list actionability, center animation과 test polling을 분리한 5회 측정으로 한다.
수치 정의만 바꾸거나 내부 mark만으로 기존 외부 gate를 대체하지 않는다.
