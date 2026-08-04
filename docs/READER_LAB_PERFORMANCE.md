# Reader Lab 성능과 실제 Electron 증거

기준일: 2026-08-12

```text
Historical Phase 1F verdict: CONDITIONAL TECHNICAL GO — PRIVATE LOCAL
Phase 1G Reader interaction optimization actual: PASS
Phase 1G final verdict: CONDITIONAL TECHNICAL GO — RUNTIME EPUBCHECK PACKAGING PENDING
Boundary: PRIVATE LOCAL ONLY
```

## 1. 측정 환경과 증거

- Windows x64, Node.js `26.3.1`, pnpm `11.9.0`
- 실제 development Electron과 fresh `package:unpacked` Electron을 각각 실행
- 일반 작품과 장편 작품을 별도 `.madi`/user-data/process로 실행
- expensive timing은 각 환경에서 5회, 정렬된 세 번째 값을 median으로 기록
- scope 전환, diagnostic 완료, process reopen과 memory는 표에 명시한 단일 workflow 관측
- Playwright actual click/select/fill/keyboard/Shadow scroll과 DOM/computed-style 확인 사용
- canonical section/block 수와 source statistics를 fixture manifest와 exact 비교

최종 raw evidence는 실행 시 다음 경로에 생성됐다.

```text
output/playwright/madi-electron-phase1f-evidence.json
output/playwright/madi-packaged-phase1f-evidence.json
```

두 evidence 모두 `status=PASS`, `phase=1F`, `measurementRuns=5`, schema `7`, logical format
`1`, snapshot payload `5`였다. Phase 1F-named harness를 Phase 1G interaction 최적화가 반영된
최종 worktree에서 다시 실행한 결과다. 수치는 이 PC와 당시 process 부하의 관측값이며 다른
hardware의 보장값이 아니다.

| Runtime | Evidence bytes | SHA-256 | Scenario elapsed |
|---|---:|---|---:|
| Development | 17,175 | `1a987e2596e3a417dc9186c639e4fa6f15881640e0d705092d7bd72bf66c4d46` | 803,351.24 ms |
| Fresh unpacked | 17,121 | `e6aeaf4d14216b23806adcf358c319e62d70c3d60970fd4bf102a5a40737fe06` | 111,998.16 ms |

## 2. Metric 경계

| Metric | 시작과 종료 | 포함/제외 |
|---|---|---|
| external compile | Playwright refresh click 직전 → busy/ready/first-visible 관찰 | locator actionability, compile, IPC, validation 적용, React/Shadow first paint와 poll 포함 |
| core compile | Rust compiler가 보고한 compile duration | DB scope load, private Typie decode, IR compile/hash/diagnostic 포함 |
| `compilePublication` RPC round-trip | renderer API 호출 직전 → main/core 응답 수신 | core compile을 포함한 누적 round trip이며 순수 IPC 전송 시간이 아님 |
| validation | 응답 뒤 renderer exact runtime validator | core/IPC와 별도지만 external/first-visible에는 포함 |
| first visible | renderer API 호출 직전 → 첫 pane window가 Shadow DOM에 mount된 다음 animation frame | full-scope background measurement 완료는 기다리지 않음 |
| 3-pane visible | cached IR의 1 pane → 3 pane control action → 세 Shadow pane mount + 2 rAF | Publication compile 제외 |
| preset visible | 실제 pane/preset select → resolved numeric state + Shadow width paint + 2 rAF | Publication compile 제외 |
| setting visible | 실제 number fill/blur → state attribute + computed Shadow style/geometry + 2 rAF | 해당 config의 paint를 확인; full diagnostic 완료는 제외 |
| source selection | focused source block keyboard action → 세 pane 동일 block `aria-pressed` | 원고 mode 이동 제외 |
| source navigation | preview block click → 원고 mode, SCENE selection, exact Typie range | Reader Lab 재진입은 timing 뒤 수행 |
| scroll sync | actual Shadow `scrollTop` 변경/event → 세 pane state와 actual progress 수렴 | virtual repaint 완료의 별도 paint clock은 아님 |
| diagnostics | 알려진 config 변경 → 세 pane 전체 section-by-section measurement COMPLETE | 단일 workflow 관측 |
| memory | scenario 시작/완료 시 전체 Electron app process tree | 1회 delta; heap leak/peak/OS 전체 memory가 아님 |

External, RPC round-trip, core 수치를 서로 더하면 같은 시간이 중복된다. 특히 RPC
round-trip은 core duration을 포함한다. Development와 packaged도 build mode가 달라
하나의 분포로 합치지 않는다.

## 3. Fixture

| Fixture | 파일 크기 | 구조 | 문자/semantic inventory | Publication inventory |
|---|---:|---|---|---|
| 일반 | 2,916,352 B | 2권 / 20화 / 60장면 | 180,000자 / 180 paragraph / 60 scene break | 60 section / 323 block |
| 장편 | 10,739,712 B | 10권 / 150화 / 450장면 | 675,000자 / 1,350 paragraph / 450 scene break | 450 section / 2,411 block |

| Runtime | 일반 fixture SHA-256 | 장편 fixture SHA-256 |
|---|---|---|
| Development | `84903de99136490ca5ade827aaa4bde7810955871df6eca28d2cbefd0945cfcf` | `24f91f8f8e41c82b6d7d8a0f3e6f9bf642f63205b070b69cab1f14ffa32ff9c5` |
| Fresh unpacked | `363b41bc85950f8716d3b243af3d75733774b8a47b0b3f243172a043455d95d1` | `7e66ab598aca7cfb40395de89c11a402504432df50a77cb9529b5d2d42906bb7` |

Fixture는 한국어 UTF-8 본문, 긴 paragraph, 빈 paragraph와 scene break를 포함한다. Generator는
고정 timestamp와 `VACUUM`을 사용하지만 동일 semantic ID/revision/inventory를 다시 만든
SQLite binary는 header/page-level regeneration 차이로 file SHA가 달라질 수 있었다. 각
evidence는 실제 소비한 fixture SHA를 별도로 기록한다. Acceptance identity는 manifest의
고정 project/scope ID, revision, inventory와 compile된 canonical section/block/source
statistics를 함께 사용했다.

## 4. 일반 작품 scope 전환

아래 값은 각 scope로 실제 select한 단일 transition이다. `first visible`은 compile 시작
기준이며 external scope elapsed는 Playwright select action과 관찰까지 포함한다.

| Scope | Development elapsed / first visible | Packaged elapsed / first visible | Section / block |
|---|---:|---:|---:|
| SCENE | 486.77 / 431.20 ms | 99.60 / 26.70 ms | 1 / 8 |
| CHAPTER | 1,323.10 / 1,268.80 ms | 115.30 / 71.50 ms | 3 / 18 |
| VOLUME | 12,528.60 / 12,449.30 ms | 593.81 / 495.20 ms | 30 / 162 |
| WORK | 24,837.17 / 24,820.80 ms | 1,047.07 / 1,014.50 ms | 60 / 323 |

Packaged SCENE/CHAPTER first visible은 1초 목표 안이다. Development CHAPTER의 debug
sidecar 단일 관측은 1초를 넘지만 packaged release 결과와 분리한다. 모든 scope의
section/block과 공백 포함/제외 문자, paragraph/scene/chapter 수는 manifest와 일치했다.

## 5. 일반 WORK 5회

| Metric | Development median / max | Packaged median / max |
|---|---:|---:|
| external compile | 25,031.88 / 27,643.43 ms | 986.29 / 998.38 ms |
| core compile | 24,923.36 / 27,485.36 ms | 883.51 / 908.12 ms |
| `compilePublication` RPC round-trip (core 포함) | 24,951.40 / 27,520.00 ms | 896.50 / 920.90 ms |
| runtime validation | 14.80 / 17.90 ms | 14.00 / 14.50 ms |
| first visible | 24,970.40 / 27,542.80 ms | 915.60 / 938.40 ms |
| cached IR 3-pane visible | 73.32 / 125.01 ms | 72.35 / 84.64 ms |
| preset visible | 99.74 / 184.62 ms | 165.22 / 168.36 ms |
| font-size setting visible | 68.23 / 131.61 ms | 75.09 / 129.91 ms |
| same-source selection | 6.95 / 32.01 ms | 7.37 / 14.49 ms |
| source SCENE/range navigation | 189.97 / 216.34 ms | 189.50 / 230.07 ms |
| normalized scroll state 수렴 | 19.82 / 27.87 ms | 14.20 / 16.10 ms |

Preset 측정은 desktop↔small-phone의 실제 config/paint 전환 다섯 번이며 초기값과 같은
no-op을 표본으로 세지 않았다. Font-size 측정도 18↔19의 실제 structural/computed-style
변화를 확인했다. Source selection은 세 pane의 같은 source identity를 확인했고 navigation은
원고 SCENE과 exact range를 확인했다.

일반 full measurement+layout diagnostics는 development `1,138.70 ms`, packaged
`1,130.22 ms`의 단일 관측으로 60 section/323 block을 세 pane에서 모두 측정하고 검토 후보
`240`개를 만들었다. 이는 5회 median이 아니다. Keyboard diagnostic activation은 각각
`134.20/134.44 ms`의 단일 관측으로 세 pane highlight와 원고 이동까지 통과했다.

## 6. 장편 WORK 5회

| Metric | Development median / max | Packaged median / max |
|---|---:|---:|
| external compile | 51,793.15 / 52,007.85 ms | 2,591.93 / 2,716.37 ms |
| core compile | 51,160.38 / 51,408.65 ms | 2,102.28 / 2,190.88 ms |
| `compilePublication` RPC round-trip (core 포함) | 51,324.70 / 51,584.30 ms | 2,192.90 / 2,278.00 ms |
| runtime validation | 48.30 / 56.50 ms | 51.80 / 54.10 ms |
| first visible | 51,384.30 / 51,648.20 ms | **2,259.50 / 2,345.10 ms** |
| cached IR 3-pane visible | 418.02 / 443.81 ms | 439.75 / 455.49 ms |
| font-size setting visible | **148.32 / 150.54 ms** | **184.10 / 200.46 ms** |
| normalized scroll state 수렴 | 33.38 / 43.25 ms | 33.50 / 35.01 ms |

Fresh packaged 장편 first visible은 3초 목표를 만족한다. Debug sidecar compile은 약
51초로 실사용 release 수치가 아니지만 development feedback loop의 명확한 비용으로
남긴다. Phase 1G interaction 최적화 뒤 장편 setting visible은 development와 package 모두
잠정 약 250ms 목표를 통과했다.

장편의 첫 WORK scope 단일 transition은 development elapsed/first-visible
`51,153.78/51,091.30 ms`, packaged `2,347.79/2,305.70 ms`였다. 장편 full
measurement+layout diagnostics는 config 변경 뒤 development `7,734.38 ms`, packaged
`7,827.55 ms`의 환경별 단일 관측이다. 반복 median/maximum이 아니다. 각 pane에서 450
section/2,411 block이 모두 측정됐고 diagnostic 후보는 `900`, horizontal overflow는
`0`, measurement/layout status는 complete였다. 이 시간은 first visible을 막지 않는
background completion 경계다.

## 7. Virtualization과 scroll

장편 세 pane은 모두 `virtualized=true`였다. 최종 관찰 시 canonical/measured 값은
450 section/2,411 block이고 visible DOM은 각 pane 1 section/8 block이었다. Progress
`0.10`, `0.25`, `0.50`, `0.75`, `0.42`로 실제 Shadow scroller를 이동할 때는 pane별
1~3 section, 8~16 block만 mount됐고 세 pane 모두 다른 source window로 바뀌었다.

Scroll sync 5회는 state progress뿐 아니라 실제 `scrollTop / scrollMaximum`이 모든 pane에서
±0.02 안으로 수렴했는지 확인했다. Sync off 단일 workflow도 source pane 약 `0.20`과
나머지 pane 불변을 확인했다. 이는 normalized scroll 상태 수렴 지표이며 각 virtual
section의 paint completion이나 exact 줄 정렬 지표는 아니다.

## 8. 상태 복원과 snapshot

일반 작품에서 preset CRUD, named snapshot v5 변경/restore, WORK/3 pane UI state를 실제로
검증했다. 새 process ready 단일 관측은 development `26,108.15 ms`, packaged
`2,390.81 ms`였다.

다음 값은 저장 전과 재실행 뒤 exact 일치했다.

- pane count `3`, scope `WORK`, pane별 preset selection
- pane별 resolved category/viewport/font/line-height/scene-break style
- zoom `1.10`, `0.95`, `1.15`
- scroll progress 및 실제 Shadow progress `0.20`, `0.45`, `0.70`
- scroll sync off, panel width `333/444`, diagnostics collapsed
- 세 pane의 동일 selected source block

Snapshot diff는 Reader preset changed `1`, v5 restore 뒤 font size `20`, restore 전 safety
snapshot 생성까지 확인했다. Reader UI state는 snapshot payload에 포함하지 않고 별도
`reader-lab.v1`에서 복원됐다.

## 9. Memory 관측 경계

아래 delta는 각 scenario의 시작과 완료 사이 전체 Electron app process tree를 한 번씩
샘플링한 값이다.

| Scenario | Working set delta | Private bytes delta |
|---|---:|---:|
| Development 일반 | +104.04 MiB | +398.37 MiB |
| Packaged 일반 | +173.25 MiB | +429.47 MiB |
| Development 장편 | +134.57 MiB | +228.71 MiB |
| Packaged 장편 | +288.14 MiB | +385.14 MiB |

각 scenario는 compile 반복, 세 pane, full measurement, screenshot과 automation state까지
포함한다. Sample 수가 1이므로 leak, steady-state heap, peak resident set 또는 장시간
상한으로 해석하지 않는다. 장시간/GC/heap snapshot은 후속 hardening 항목이다.

## 10. Security 관측 경계

Development와 packaged의 normal first/reopen 및 long session에서 다음이 모두 `0`이었다.

- 외부 renderer HTTP request
- 외부 renderer WebSocket
- page error
- 원고/preset 내용을 포함할 수 있는 renderer console diagnostic

Local-file probe도 모두 읽기 실패했다. Harness는 dev same-origin Vite runtime URL/WS를
허용된 local transport로 분리하고 외부 host만 집계한다. App main은 navigation, 새 window,
permission과 production network를 guard하고 preview DOM에는 `script`, `iframe`, `object`,
`embed`, external `src`/`href`/`url()` element가 없었다.

Packaged smoke wrapper는 `MADI_RENDERER_URL`을 임시 loopback canary server로,
`MADI_CORE_BIN`을 canary executable path로 오염한 채 actual Reader workflow를 실행한다.
모든 packaged process는 `madi:` renderer를 사용했고 canary server request `0`, core canary
file 부재를 확인했다. Production CSP도 development WebSocket origin을 포함하지 않는다.

이는 해당 renderer session의 Playwright HTTP/WS 관찰과 main/static guard 증거다. OS-wide
packet capture, 다른 process의 network 또는 kernel 수준 egress에 대한 주장이 아니다.

## 11. Phase 1D/1E historical clock

이전 World Graph Playwright 누적 search focus/selection과 Plot Canvas cold `Ctrl+K`/
autosave 수치는 삭제하지 않고 다음으로 재분류한다.

```text
NON-BLOCKING HARNESS-LEVEL OBSERVATION
```

| Historical metric | Development median / max | Packaged median / max |
|---|---:|---:|
| World Graph click→focus | 667.55 / 737.11 ms | 668.17 / 703.35 ms |
| World Graph visual selection | 740.08 / 782.05 ms | 593.17 / 657.52 ms |
| Plot Canvas cold `Ctrl+K` | 518.40 / 621.96 ms | 520.72 / 642.24 ms |
| Canvas drag→autosave | 981.90 / 1,013.26 ms | 1,024.66 / 1,029.79 ms |

Locator actionability/poll/paint 및 autosave debounce가 내부 처리와 크게 다른 누적 clock이다.
실제 사용에서 명백한 지연이나 오류가 새로 관찰되기 전에는 Phase 1F/1G를 차단하거나
World Graph/Canvas 최적화만 반복하는 기준으로 사용하지 않는다.

## 12. 목표 대비 판정

| 목표 | 결과 |
|---|---|
| no-crash | PASS |
| 원고 block 누락 0 | PASS |
| packaged SCENE/CHAPTER first visible ≤ 1초 | PASS |
| packaged 675,000자 WORK first visible ≤ 3초 | PASS |
| preset visible 약 250ms | 일반 PASS |
| setting visible 약 250ms | 일반/장편 PASS; packaged 장편 `184.10/200.46 ms` |
| source highlight 약 250ms | PASS |
| scroll sync state+actual `scrollTop` convergence | PASS |
| distant-progress virtual window source change | PASS (untimed correctness gate) |
| 설정 변경이 원고/IR compile을 변경하지 않음 | PASS |
| external renderer HTTP/WS request 0 | PASS |

Phase 1G Reader interaction 최적화 actual은 PASS다. Historical Phase 1F conditional 원인이던
장편 setting-visible 목표 초과는 해소됐다. Phase 1G 전체 판정은 Reader 때문이 아니라
runtime EPUBCheck/JRE가 package에 없어서 **CONDITIONAL TECHNICAL GO — RUNTIME EPUBCHECK
PACKAGING PENDING**이며 허용 범위는 **PRIVATE LOCAL ONLY**다. Canonical block을 줄이거나
설정 변경 때 IR을 재compile하는 방식은 계속 허용하지 않는다.

## 13. Phase 1G interaction 최적화 구현

Phase 1G는 위 장편 setting visible 관측을 `NON-BLOCKING INTERACTION OPTIMIZATION`으로
수용하고 다음 경계를 구현했다.

- resolved typography/layout key별 visible config를 rAF generation으로 batch한다.
- CSS variable과 visible/windowed section commit을 full-scope measurement보다 먼저 수행한다.
- 전체 scope statistics와 hidden section measurement는 `requestIdleCallback` 또는 bounded
  timeout scheduler로 실행한다.
- Pane별 generation/key guard가 이전 config의 analysis/measurement callback을 버린다.
- Publication hash+resolved config measurement cache와 layout diagnostic cache를 각각
  insertion-order LRU 4개로 제한한다.
- 새 key의 complete measurement 전에는 `측정 중…`과 추정 상태를 표시하고 이전 complete
  값을 최신처럼 재사용하지 않는다.
- Diagnostic은 같은 measurement key의 complete block set에서만 생성한다.
- Reader setting 변경은 Publication IR compile을 다시 시작하지 않는다.

최종 Phase 1F-named raw evidence는 Phase 1G 최적화가 반영된 worktree의 Reader actual이다.
장편 visible metrics는 위 5회 표본에서, full measurement/layout diagnostics는 환경별 단일
관측에서 가져왔다. Electron evidence는 `measurementStatus=COMPLETE`,
`layoutStatus=complete`, block/overflow 결과를 기록하지만 stale callback count는 기록하지
않는다. 따라서 actual stale-result 0이라고 주장하지 않는다.

Exact Node 26 toolchain으로 `reader-preview-pane.test.tsx`를 별도 실행한 결과는 1 file/11
tests PASS였다. 이 focused test는 다음 correctness를 확인한다.

- visible config가 다음 animation frame에 적용되고 full-scope statistics는 이후 완료됨
- 중간 generation의 callback이 final key 결과로 들어오지 않음
- config cache 재사용 전에는 measured block을 0으로 reset하고 완료 뒤 120/120을 복원함
- 반복 generation 전환 뒤 60 section/300 block을 중복 없이 300/300으로 완료함
- 동시에 유지하는 hidden measurement section은 1개 이하임

이 결과는 jsdom의 synthetic scheduler와 DOM을 사용한 focused stale/caching correctness
qualification이다. 테스트의 개별 millisecond는 실제 Electron paint/interaction 성능이나
development/fresh-packaged median으로 사용하지 않는다.

## 관련 문서

- [Phase 1F result](./PHASE_1F_RESULT.md)
- [Phase 1F scope](./PHASE_1F_SCOPE.md)
- [Reader Lab architecture](./READER_LAB_ARCHITECTURE.md)
- [Reader Lab visual diagnostics](./READER_LAB_VISUAL_DIAGNOSTICS.md)
- [Publication IR v1](./PUBLICATION_IR_V1.md)
- [Phase 1G result](./PHASE_1G_RESULT.md)
- [EPUB export performance](./EPUB_EXPORT_PERFORMANCE.md)
