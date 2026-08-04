# Phase 1D 저장소 결과

기준일: 2026-08-08

```text
Verdict: CONDITIONAL TECHNICAL GO — PRIVATE LOCAL
Scope: WORLD GRAPH READ MODEL, VISUALIZATION & INTERACTION HARDENING
Windows native Korean IME: MANUAL VALIDATION PENDING
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Public/paid/customer distribution: NOT AUTHORIZED
```

Phase 1D의 read-only World Graph와 Phase 1E 작업에서 수행한 interaction hardening을 함께
기록한다. Graph의 canonical source는 계속 Story Bible이며 현재 `.madi` schema는 Phase
1E Canvas 추가로 `5`, logical `format_version`은 `1`이다.

## 1. Read model과 보안 경계

Rust는 `entities`, alias/tag, relation type/relation과 `scene_entity_links`를 한 transaction에서
`WorldGraphReadModel`로 파생한다. Graph 전용 canonical table은 없다. Renderer는 SQLite를
직접 읽지 않고 fixed JSON-RPC/preload allowlist와 strict DTO validation만 통과한다.
Cytoscape type은 renderer adapter 밖으로 나가지 않는다.

Directed/undirected/inverse 의미, 8종 kind shape, status/color/icon, full/focused 1·2·3-hop,
kind/status/tag/relation/direction/isolated filter, 이름·별칭·태그·요약 검색과 node/edge detail을
유지한다. Graph는 relation이나 scene link를 수정하지 않는 읽기 전용 화면이다.

`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`와
외부 runtime request 0을 유지한다. Label/summary/note는 text/data로만 렌더하며 실제 smoke
stdout/evidence는 사용자 원문을 기록하지 않는다.

## 2. Interaction hardening

선택과 detail을 다음처럼 분리했다.

- 선택 node와 이웃 강조, 기본 metadata와 detail shell을 동기 selection commit에 표시
- Entity detail, scene context, mention discovery를 동시에 시작
- `(projectId, projectRevision, entityId)` session cache와 revision invalidation
- generation/entity/revision 검증으로 A→B stale response commit 차단
- 검색 focus는 기존 position에서 center animation만 사용
- 선택, edge, hover, detail, panel resize로 COSE layout을 재실행하지 않음
- Graph canvas/state/detail callback을 분리하고 stable element/style/state를 재사용
- Cytoscape/Graph를 manuscript entry와 분리된 lazy chunk로 이동

5회 내부 product mark의 development/packaged median/maximum은 다음과 같다.

| 구간 | Development | Packaged |
|---|---:|---:|
| search click handler | 0.1 / 0.1 ms | 0.1 / 0.1 ms |
| React selection commit | 14.7 / 16.6 ms | 8.4 / 11.0 ms |
| Cytoscape node lookup | 0 / 0 ms | 0 / 0 ms |
| focus animation start | 0.3 / 0.3 ms | 0.3 / 0.3 ms |
| neighbor highlight | 11.3 / 11.8 ms | 6.6 / 9.1 ms |
| detail shell commit | 14.7 / 16.6 ms | 8.4 / 11.0 ms |
| 병렬 Entity/scene/mention RPC | 약 119.8–119.9 / 131.8–131.9 ms | 약 88.0–88.1 / 90.6–90.7 ms |
| narrow IPC serialize/deserialize | 0.045 / 0.102 ms | 0.039 / 0.047 ms |
| full lazy detail | 131.2 / 144.6 ms | 98.9 / 102.3 ms |

Cache 재선택은 `detailCacheHit = 1`, 빠른 A→B는 B만 commit, selection 5회 동안 layout
request count는 불변이었다.

## 3. 외부 실제 창 clock과 판정

같은 실행에서 Playwright action 전부터 dataset poll까지 재는 누적 외부 clock도 5회
측정했다. 검색은 추가 dataset read와 두 animation frame, full detail은 detached wait와
두 animation frame까지 포함한다.

| 실제 창 항목 | Development median / max | Packaged median / max | 목표 |
|---|---:|---:|---:|
| 검색 결과 ready | 222.66 / 250.54 ms | 216.21 / 225.83 ms | 250 ms |
| result click→focus | 667.55 / 737.11 ms | 668.17 / 703.35 ms | 250 ms |
| visual selection | 740.08 / 782.05 ms | 593.17 / 657.52 ms | 100 ms |
| detail shell 누적 | 833.89 / 869.94 ms | 656.61 / 722.94 ms | 100 ms |
| full lazy detail 누적 | 1,234.78 / 1,325.10 ms | 1,001.05 / 1,073.36 ms | 250 / 500 ms |
| pan/zoom | 119.55 ms | 119.87 ms | 250 ms |
| depth 1 / 2 / 3 | 371.92 / 74.91 / 101.65 ms | 263.06 / 79.05 / 67.57 ms | 각 250 ms |

Phase 1D 이전 407–435ms 수치는 1회 위주이고 이번 값은 5회 median/max다. Selection과
heading endpoint에는 이전에도 locator actionability와 dataset poll이 있었으므로 현재
외부 selection/shell wall clock은 같은 계열에서 악화했다. 검색은 측정 scope가 늘었고
full detail은 새 지표라 직접 전후 비교할 수 없다. 내부 mark는 selection/shell/병렬 RPC
병목을 제거했지만 현재 외부 acceptance 정의는 250ms와 완화 500ms도 넘는다. 수치 정의를
바꾸어 GO로 재분류하지 않는다.

따라서 판정은 계속 **CONDITIONAL TECHNICAL GO — PRIVATE LOCAL**이다. Phase 1E의
비공개 로컬 구현 판정은 별도이며, Phase 1D를 공개 배포 근거로 사용하지 않는다.

## 4. 500/2,000 scale와 무결성

결정론적 SQLite fixture는 entity 500, alias 1,500, canonical relation 2,000과 explicit
scene link 2,000을 가진다. Actual Electron은 다음을 통과했다.

- initial IPC dev/package `106.1/65.4 ms`, restart `127.3/76.8 ms`
- initial layout dev/package `1,069.6/1,104.5 ms`
- layout 5회 median/max `977.4/982.1 ms`, `977.1/1,000.6 ms`
- click-to-ready dev/package `2,434/2,466 ms`, restart `402/363 ms`
- canonical/accessible/actual canvas 500 node/2,000 edge exact
- actual pointer drag `48×36`, viewport와 500 position 재실행 복원
- project revision `2`, node/edge count가 drag 전/후/재실행 모두 불변
- no crash, page error 0, external runtime request 0, local-file read 차단

독립 renderer 5회 benchmark는 filter `0.879/1.040 ms`, search `5.116/6.222 ms`,
BFS depth1+2+3 `0.938/7.083 ms`, element 변환 `0.346/0.867 ms`, COSE
`1,176.725/1,244.787 ms`, state normalize/restore `0.280/0.586 ms`였다.

## 5. Bundle과 UI state

`world-graph.v1`은 작품별 full/focused mode, center/depth, filter, layout, viewport, 최대
500 position과 마지막 selection을 저장한다. UI state는 project revision을 올리거나
snapshot payload에 들어가지 않는다. Snapshot restore 뒤 현재 graph 배치를 유지한다.

최종 World Graph lazy JS는 `WorldGraphWorkspace-ChJKQQFz.js`, raw `478,653` bytes,
gzip `153,125` bytes다. Main `index-BWI-Lh7S.js`에는 Cytoscape runtime의 eager import가
없고 `pnpm test:bundle`이 production artifact에서 이를 검사했다.

## 6. 최종 gate

Node.js `26.3.1`, pnpm `11.9.0`에서 전체 `pnpm verify`는 exit `0`, 294.354초였다.
Desktop `39 files / 219 tests`, Rust `41 tests`, Phase 1A–E integration, development와
fresh packaged Electron을 포함한다. 독립 `pnpm test:electron`과 `pnpm test:package`도
각각 exit `0`으로 Phase 1D 500/2,000과 새 process 복원을 다시 통과했다.

상세 방법과 전체 5회 수치는
[`WORLD_GRAPH_PERFORMANCE.md`](WORLD_GRAPH_PERFORMANCE.md)에 있다.

## 7. 알려진 한계와 다음 hardening

- 누적 외부 click/selection/detail clock이 목표와 완화 500ms를 넘는다.
- COSE는 renderer thread의 동기 작업이며 현재 약 1.0–1.25초다.
- 500/2,000 초과는 데이터를 자르지 않고 main validator에서 거부한다.
- 다음 단계는 browser-event timestamp 기반 click→focus 정의를 명확히 하고 accessible
  list actionability/scroll과 animation/poll을 분리한 뒤 실제 UX를 다시 최적화하는 것이다.
- Worker/cancellable layout, 장시간 heap, screen reader와 Windows native IME는 별도다.

```text
Windows native Korean IME: MANUAL VALIDATION PENDING
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
```
