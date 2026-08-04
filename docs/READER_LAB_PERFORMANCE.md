# Reader Lab 성능과 실제 Electron 증거

기준일: 2026-08-09

```text
Verdict: CONDITIONAL TECHNICAL GO — PRIVATE LOCAL
Reason: packaged long-WORK setting visible median 538.35 ms > 약 250 ms target
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

두 evidence 모두 `status=PASS`, `phase=1F`, `measurementRuns=5`, schema `6`, logical format
`1`, snapshot payload `4`였다. 수치는 이 PC와 당시 process 부하의 관측값이며 다른
hardware의 보장값이 아니다.

| Runtime | Evidence bytes | SHA-256 | Scenario elapsed |
|---|---:|---|---:|
| Development | 17,117 | `9a548c11f32059750c5dc91721c548064000dc25fac846acb1203cef02d0f8a6` | 692,195.83 ms |
| Fresh unpacked | 17,078 | `56e028a0f3d00f7cb6e6e09f954841c1f07a0857bab3c8fc8066878980ed7860` | 70,291.31 ms |

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
| 일반 | 2,994,176 B | 2권 / 20화 / 60장면 | 180,000자 / 180 paragraph / 60 scene break | 60 section / 323 block |
| 장편 | 10,694,656 B | 10권 / 150화 / 450장면 | 675,000자 / 1,350 paragraph / 450 scene break | 450 section / 2,411 block |

| Runtime | 일반 fixture SHA-256 | 장편 fixture SHA-256 |
|---|---|---|
| Development | `c3e08a09b83415f86159b3f538d466b16c13e4df4e6e7a054ef9e522c43a3070` | `2e15e2e87b69de1cc76404dd56c285daaed2f024a014ee0e29c2e088bdb289ff` |
| Fresh unpacked | `c05ed560be589b8fdcaac83060bbe1098a35d1a0c66b7617604c3d07f49f965c` | `4ebb54b706b135f608d493111ab8ccb12b8a8b359532162a86ceb5a6c9e5f090` |

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
| SCENE | 475.79 / 398.20 ms | 99.20 / 32.70 ms | 1 / 8 |
| CHAPTER | 1,236.85 / 1,182.20 ms | 123.19 / 70.40 ms | 3 / 18 |
| VOLUME | 11,618.22 / 11,553.40 ms | 566.68 / 496.30 ms | 30 / 162 |
| WORK | 23,190.06 / 23,153.10 ms | 983.19 / 953.30 ms | 60 / 323 |

Packaged SCENE/CHAPTER first visible은 1초 목표 안이다. Development CHAPTER의 debug
sidecar 단일 관측은 1초를 넘지만 packaged release 결과와 분리한다. 모든 scope의
section/block과 공백 포함/제외 문자, paragraph/scene/chapter 수는 manifest와 일치했다.

## 5. 일반 WORK 5회

| Metric | Development median / max | Packaged median / max |
|---|---:|---:|
| external compile | 22,986.03 / 23,138.38 ms | 1,001.91 / 1,074.78 ms |
| core compile | 22,828.42 / 22,964.22 ms | 849.18 / 863.31 ms |
| `compilePublication` RPC round-trip (core 포함) | 22,855.60 / 22,990.10 ms | 864.10 / 874.50 ms |
| runtime validation | 13.60 / 14.90 ms | 12.90 / 13.90 ms |
| first visible | 22,896.10 / 23,031.90 ms | 906.10 / 914.30 ms |
| cached IR 3-pane visible | 88.60 / 106.07 ms | 88.76 / 104.63 ms |
| preset visible | 116.48 / 116.82 ms | 116.66 / 138.23 ms |
| font-size setting visible | 105.99 / 125.72 ms | 109.27 / 118.25 ms |
| same-source selection | 23.33 / 36.39 ms | 20.26 / 23.81 ms |
| source SCENE/range navigation | 201.47 / 252.74 ms | 201.24 / 214.85 ms |
| normalized scroll state 수렴 | 13.34 / 21.11 ms | 13.31 / 14.44 ms |

Preset 측정은 desktop↔small-phone의 실제 config/paint 전환 다섯 번이며 초기값과 같은
no-op을 표본으로 세지 않았다. Font-size 측정도 18↔19의 실제 structural/computed-style
변화를 확인했다. Source selection은 세 pane의 같은 source identity를 확인했고 navigation은
원고 SCENE과 exact range를 확인했다.

일반 full-scope diagnostics는 development `259.87 ms`, packaged `197.01 ms`의 단일
관측으로 60 section/323 block을 세 pane에서 모두 측정하고 검토 후보 `240`개를 만들었다.
Keyboard diagnostic activation은 세 pane highlight와 원고 이동까지 통과했다.

## 6. 장편 WORK 5회

| Metric | Development median / max | Packaged median / max |
|---|---:|---:|
| external compile | 47,907.98 / 49,250.22 ms | 2,784.73 / 2,853.33 ms |
| core compile | 47,151.22 / 48,442.99 ms | 2,016.90 / 2,033.04 ms |
| `compilePublication` RPC round-trip (core 포함) | 47,286.20 / 48,590.30 ms | 2,081.40 / 2,099.60 ms |
| runtime validation | 46.70 / 49.60 ms | 46.20 / 47.80 ms |
| first visible | 47,509.30 / 48,844.70 ms | **2,380.00 / 2,409.50 ms** |
| cached IR 3-pane visible | 446.54 / 511.54 ms | 425.07 / 441.00 ms |
| font-size setting visible | **567.52 / 606.32 ms** | **538.35 / 562.87 ms** |
| normalized scroll state 수렴 | 38.62 / 40.97 ms | 40.75 / 49.07 ms |

Fresh packaged 장편 first visible은 3초 목표를 만족한다. Debug sidecar compile은 약
47초로 실사용 release 수치가 아니지만 development feedback loop의 명확한 비용으로
남긴다. 장편 setting visible은 development 약 0.57초, package 약 0.54초로 잠정 250ms
목표를 넘으며
Phase 1F conditional 판정의 직접 원인이다.

장편의 첫 WORK scope 단일 transition은 development elapsed/first-visible
`47,316.54/47,190.10 ms`, packaged `2,503.63/2,393.10 ms`였다. 장편 full measurement와
diagnostics는 config 변경 뒤 development `1,849.01 ms`, packaged `1,781.02 ms`의 단일
관측이다. 각 pane에서 450 section/2,411 block이 모두 측정됐고
diagnostic 후보는 `900`, horizontal overflow는 `0`이었다. 이 시간은 first visible을
막지 않는 background completion 경계다.

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

일반 작품에서 preset CRUD, named snapshot v4 변경/restore, WORK/3 pane UI state를 실제로
검증했다. 새 process ready 단일 관측은 development `24,430.54 ms`, packaged
`2,353.52 ms`였다.

다음 값은 저장 전과 재실행 뒤 exact 일치했다.

- pane count `3`, scope `WORK`, pane별 preset selection
- pane별 resolved category/viewport/font/line-height/scene-break style
- zoom `1.10`, `0.95`, `1.15`
- scroll progress 및 실제 Shadow progress `0.20`, `0.45`, `0.70`
- scroll sync off, panel width `333/444`, diagnostics collapsed
- 세 pane의 동일 selected source block

Snapshot diff는 Reader preset changed `1`, v4 restore 뒤 font size `20`, restore 전 safety
snapshot 생성까지 확인했다. Reader UI state는 snapshot payload에 포함하지 않고 별도
`reader-lab.v1`에서 복원됐다.

## 9. Memory 관측 경계

아래 delta는 각 scenario의 시작과 완료 사이 전체 Electron app process tree를 한 번씩
샘플링한 값이다.

| Scenario | Working set delta | Private bytes delta |
|---|---:|---:|
| Development 일반 | +161.71 MiB | +421.77 MiB |
| Packaged 일반 | +227.33 MiB | +453.15 MiB |
| Development 장편 | +261.91 MiB | +368.30 MiB |
| Packaged 장편 | +336.20 MiB | +431.42 MiB |

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
| setting visible 약 250ms | 일반 PASS, 장편 FAIL (`538.35/562.87 ms`) |
| source highlight 약 250ms | PASS |
| scroll sync state+actual `scrollTop` convergence | PASS |
| distant-progress virtual window source change | PASS (untimed correctness gate) |
| 설정 변경이 원고/IR compile을 변경하지 않음 | PASS |
| external renderer HTTP/WS request 0 | PASS |

따라서 최종 판정은 **CONDITIONAL TECHNICAL GO — PRIVATE LOCAL**이다. 다음 성능 작업은
장편 config 변경 직후 visible pane update와 full measurement invalidation 경계를 profile해
화면 반영을 우선하고 background 재측정을 분리하는 것이다. Canonical block을 줄이거나
설정 변경 때 IR을 재compile하는 방식은 허용하지 않는다.

## 관련 문서

- [Phase 1F result](./PHASE_1F_RESULT.md)
- [Phase 1F scope](./PHASE_1F_SCOPE.md)
- [Reader Lab architecture](./READER_LAB_ARCHITECTURE.md)
- [Reader Lab visual diagnostics](./READER_LAB_VISUAL_DIAGNOSTICS.md)
- [Publication IR v1](./PUBLICATION_IR_V1.md)
