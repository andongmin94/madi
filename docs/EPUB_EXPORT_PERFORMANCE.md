# EPUB Export Performance

기준일: 2026-08-10

```text
Verdict: CONDITIONAL TECHNICAL GO — RUNTIME EPUBCHECK PACKAGING PENDING
Boundary: PRIVATE LOCAL ONLY
Development/fresh-unpacked actual: PASS
```

이 문서는 Phase 1G development와 fresh-unpacked actual의 성능·correctness 증거를 고정한다.
수치는 이 PC와 당시 process 부하의 관측값이며 다른 hardware의 보장값이 아니다. Unit-test
mock timing은 제품 성능으로 사용하지 않는다.

## 1. 측정 환경과 raw evidence

- Microsoft Windows NT `10.0.26200.0` x64
- Node.js `26.3.1`, pnpm `11.9.0`
- Rust/Cargo `1.97.1` MSVC, Electron `37.10.3`
- 실제 development Electron과 fresh `package:unpacked` Electron
- 일반 state/export와 장편 export를 서로 다른 user-data/process에서 실행
- 장편 timing은 환경별 5회, 정렬된 세 번째 값을 median으로 기록

Raw evidence 경로와 파일 identity는 다음과 같다.

| Runtime | Evidence path | Bytes | SHA-256 | Scenario elapsed |
|---|---|---:|---|---:|
| Development | `output/playwright/madi-electron-phase1g-evidence.json` | 33,313 | `4f4ed9abef9b2337d68bf61871650a6e3f272557364cabb8e2bb9ba864ed429d` | 567,582.25 ms |
| Fresh unpacked | `output/playwright/madi-packaged-phase1g-evidence.json` | 33,387 | `b4bba22e561bd0268f07d71b73a80719c09686e073979ef64cf3e006b2a84a71` | 51,839.72 ms |

두 JSON은 모두 `status=PASS`, `phase=1G`, `measurementRuns=5`, evidence schema `1`, project
schema `7`, logical format `1`, snapshot payload `5`다.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `output/playwright/madi-electron-phase1g-normal.png` | 189,195 | `dc042a728c41801f132ec3f34f0c719effd74048434538ae6d263aa2f369c60a` |
| `output/playwright/madi-electron-phase1g-long.png` | 216,644 | `8faee737100b9cc66fc87a8f944c131a3356e70069e29dacefcf705cbfe7b724` |
| `output/playwright/madi-electron-phase1g-representative.epub` | 63,779 | `527f55f49bcb465df8792e1af0e662664c4185ab5deccd0a6ed94f677503788c` |
| `output/playwright/madi-packaged-phase1g-normal.png` | 189,195 | `dc042a728c41801f132ec3f34f0c719effd74048434538ae6d263aa2f369c60a` |
| `output/playwright/madi-packaged-phase1g-long.png` | 216,327 | `c563e51c0d81591a05dbd20cdf4e39b96033c665639ce6ba2de35be963a165f0` |
| `output/playwright/madi-packaged-phase1g-representative.epub` | 63,779 | `527f55f49bcb465df8792e1af0e662664c4185ab5deccd0a6ed94f677503788c` |

## 2. Fixture

| Fixture | `.madi` bytes | 구조 | 문자/semantic inventory | Publication inventory |
|---|---:|---|---|---|
| 일반 | 2,916,352 | 2권 / 20화 / 60장면 | 180,000자 / 180 paragraph / 60 scene break | 60 section / 323 block |
| 장편 | 10,739,712 | 10권 / 150화 / 450장면 | 675,000자 / 1,350 paragraph / 450 scene break | 450 section / 2,411 block |

두 fixture는 한국어/XML 특수문자, scene break와 supported inline을 포함한다. Performance를
위해 block이나 character를 줄이지 않았다.

Evidence의 `fixture.publicationIrCompile`과
`longExport.performance.publicationIrCompile`은 각 actual 직전 fixture 생성 때 debug core가
기록한 참조 표본이다. Development evidence는 median/maximum
`62,328.43/63,561.21 ms`, fresh-unpacked evidence는 `57,562.72/61,065.41 ms`다. 후자도
packaged runtime의 별도 compile 측정값이 아니다. 따라서 이 값을 packaged wall에 더하거나
packaged compile 성능으로 표시하지 않는다.

## 3. Metric 경계

| Metric | 시작과 종료 | 포함/제외 |
|---|---|---|
| desktop wall | renderer export action → terminal UI state와 operation cleanup | core compile/IPC, exporter spawn, output commit, React/Playwright 관찰 포함 |
| exporter total | `madi-export-epub` report의 monotonic total | split, XHTML, OPF/nav/CSS, ZIP과 internal validation; core compile/IPC/UI 제외 |
| internal validation | exporter가 final ZIP을 reopen해 package/content expectation을 검사 | EPUBCheck 제외 |
| EPUBCheck | 보존한 실제 3.3 EPUB를 fresh-extracted EPUBCheck 5.3.0으로 검사 | 앱 runtime total과 package payload에서 제외 |
| responsiveness | export 중 renderer frame/heartbeat sampling의 최대 gap | OS scheduler의 보장값이나 전체 UI latency 분포가 아님 |
| memory | export 중 관측한 Electron/core/exporter process tree | available sample의 최대값이며 true peak/leak 판정이 아님 |

Desktop wall과 exporter total은 서로 다른 경계다. 특히 development wall은 debug core
compile이 대부분을 차지하므로 exporter 자체 성능이나 fresh package 제품 성능으로
재해석하지 않는다.

## 4. Timing 표본의 correctness 선행 조건

각 run은 다음 gate를 먼저 통과했다.

- internal validation `VALID`
- source/exported section, block와 Unicode character exact match
- rejected/fallback block 0, nav/manifest/spine valid
- final ZIP reopen과 output/report size/hash 일치
- output destination/operation ID/profile/revision 일치
- crash/hang/owned temp/process leak 없음

실패 run을 timing sample에서 숨기거나 retry 값으로 교체하지 않았다.

## 5. 일반 작품 actual

일반 작품의 profile별 export는 환경마다 한 번 측정한 workflow 관측이며 median이 아니다.

| Runtime / profile | Validation wall | Export wall | Exporter total | Internal validation | Output |
|---|---:|---:|---:|---:|---:|
| Development / 3.4 Draft | 25,382.99 ms | 25,318.04 ms | 102 ms | 15 ms | 37,575 B |
| Development / 3.3 compatibility | 25,489.89 ms | 25,214.61 ms | 115 ms | 19 ms | 63,779 B |
| Fresh unpacked / 3.4 Draft | 1,242.27 ms | 1,158.43 ms | 17 ms | 2 ms | 37,575 B |
| Fresh unpacked / 3.3 compatibility | 1,043.60 ms | 1,062.15 ms | 18 ms | 3 ms | 63,779 B |

WORK/VOLUME/CHAPTER/SCENE scope, 3.4 Draft/3.3 compatibility, CHAPTER/SCENE split, cover 포함과
제거, preset CRUD, snapshot restore, confirmed replace, no-clobber, cancel, JSON/Markdown report와
reveal workflow가 actual에서 통과했다. 일반 internal validation 5초 잠정 목표도 모두
통과했다.

## 6. 장편 5회 actual

| Metric | Development median / max | Fresh unpacked median / max |
|---|---:|---:|
| Desktop end-to-end wall | 52,289.60 / 53,407.21 ms | 2,519.64 / 2,603.01 ms |
| Content split | 1 / 1 ms | 0 / 0 ms |
| XHTML generation | 50 / 55 ms | 7 / 8 ms |
| OPF and navigation | 0 / 1 ms | 0 / 0 ms |
| ZIP packaging | 61 / 63 ms | 7 / 8 ms |
| Internal validation | 92 / 100 ms | 12 / 12 ms |
| Exporter total | 493 / 532 ms | 57 / 58 ms |
| Maximum frame gap | 16.9 / 33.74 ms | 16.9 / 17.0 ms |
| Maximum heartbeat gap | 62.9 / 63.7 ms | 61.7 / 63.3 ms |

Desktop wall raw samples는 development
`52,289.60, 52,048.58, 51,547.99, 53,407.21, 52,456.81 ms`, fresh unpacked
`2,519.64, 2,463.13, 2,603.01, 2,555.39, 2,513.30 ms`다. Exporter total raw samples는
development `501, 493, 491, 492, 532 ms`, fresh unpacked `53, 58, 55, 57, 57 ms`다.

Process-tree bounded observation은 development maximum working set `685,473,792 B`, private
bytes `629,915,648 B`; fresh unpacked working set `749,596,672 B`, private bytes
`676,159,488 B`였다. 두 환경 모두 available run 5회, 최대 process count 7이다.

## 7. Coverage, structure와 determinism

장편 5회 모두 다음 exact identity를 유지했다.

| Metric | Result |
|---|---:|
| Source/exported section | 450 / 450 |
| Source/exported block | 2,411 / 2,411 |
| Source/exported Unicode character | 675,000 / 675,000 |
| Fallback/rejected block | 0 / 0 |
| Scene break / ruby / heading | 450 / 450 / 611 |
| EPUB entry / XHTML / nav link / spine | 155 / 150 / 161 / 150 |
| Output bytes | 254,784 |

`mimetype` first Stored, OPF `3.0`, ZIP reopen, supported semantic XHTML과 escaped raw script
absence가 통과했다. 같은 source revision/metadata/config의 5회 output은 byte SHA-256과
uncompressed logical package hash가 각각 모두 동일했다.

## 8. EPUBCheck 5.3.0

Development와 fresh-unpacked actual이 각각 보존한 동일 3.3 compatibility EPUB
`63,779 B`/SHA-256
`527f55f49bcb465df8792e1af0e662664c4185ab5deccd0a6ed94f677503788c`를 build/test harness가
검사했다.

| Source actual | EPUBCheck elapsed | Fatal / error / warning / info |
|---|---:|---:|
| Development | 3,001.34 ms | 0 / 0 / 0 / 0 |
| Fresh unpacked | 3,679.22 ms | 0 / 0 / 0 / 0 |

Exact EPUBCheck version은 `5.3.0`이고 target은 `EPUB_3_3_COMPATIBILITY`다. Archive hash를
검증한 뒤 fresh temporary extraction을 사용했고, automatic download와 external runtime
lookup은 0이었다. 이 검사는 앱 외부 build/test gate이며 actual JSON도
`runtimeEpubCheck.packaged=false`로 기록한다. 3.4 완전 검증 근거가 아니고 unpacked app의
runtime capability도 아니다.

## 9. 잠정 목표 판정

| Gate | Target | Result |
|---|---|---|
| 일반 internal validation | 5초 이하 | PASS, 최대 19 ms |
| 장편 exporter total | 15초 이하 | Development 관측 5/5 PASS, hard gate 아님; fresh unpacked hard gate 5/5 PASS |
| 3.3 EPUBCheck | fatal/error 0 | PASS |
| Block/character loss | 0 | PASS |
| UI 장시간 unresponsive | 없음 | PASS, frame/heartbeat gap은 위 표 참조 |
| Cancel과 cleanup | 완료 | PASS |
| 외부 runtime HTTP/WS request | 0 | PASS |

15초 목표의 metric은 desktop wall이 아니라 exporter report의 `totalMs`다. Fresh-unpacked에서만
hard gate를 적용했다. Development desktop wall의 약 52.3초는 debug core compile/IPC/UI를
포함하며 이 15초 gate의 실패가 아니다.

## 10. Lifecycle, security와 cleanup

일반 state, 일반 export, 장편 export의 세 lifecycle에서 `before-quit → will-quit → quit`
순서가 확인됐고 정확히 추적한 process와 descendant는 종료 뒤 0이었다. Owned temp/symlink와
새 global artifact도 0이다. Development/fresh-unpacked 모두 page/renderer/main/child
unexpected diagnostic, private manuscript/path diagnostic, external HTTP/WS request가 0이고
local-file probe는 모두 차단됐다. Fresh package는 renderer/core/exporter development override
canary도 차단했다.

## 11. Fresh-unpacked package identity

`output/madi-win32-x64`은 147개 파일, 총 `358,623,678 B`다. 이 합계는 directory archive
hash가 아니라 recursive regular-file byte 합계다.

| Packaged file | Bytes | SHA-256 | Authenticode |
|---|---:|---|---|
| `output/madi-win32-x64/madi.exe` | 204,521,984 | `8d205e25b40da3ada4a08c92f32bfbd8e8d38edb4bfe443deea77fc9de685bac` | `NotSigned` |
| `output/madi-win32-x64/resources/bin/madi-core.exe` | 9,106,944 | `e3fd7d4393bcd662fb0f8a6cd0f3ac59a7c05649f8be9db939804f4c59d7821c` | `NotSigned` |
| `output/madi-win32-x64/resources/bin/madi-export-epub.exe` | 1,859,072 | `7f71b9e84eda09fa74f24e76767a081cf48235b42455590087b27388a6cfad48` | `NotSigned` |

Package에는 Java executable 0, JAR 0, EPUBCheck runtime payload 0이며 EPUBCheck BSD 3-Clause
고지 원문만 `resources/licenses`에 있다. Runtime은 `madi-export-epub.exe`의 internal
validator만 제공한다.

## 12. 판정 한계

Actual correctness와 fresh-unpacked 성능은 통과했지만 runtime EPUBCheck/JRE가 bundle되지
않았다. 따라서 판정은 **CONDITIONAL TECHNICAL GO — RUNTIME EPUBCHECK PACKAGING PENDING**,
허용 범위는 **PRIVATE LOCAL ONLY**다.

Typie는 계속 `HUMAN DECISION REQUIRED BEFORE DISTRIBUTION`, Windows native 한국어 IME는
`MANUAL VALIDATION PENDING`이다. pnpm/Cargo 전체 transitive license corpus는 완결되지
않았고 실행 파일은 unsigned다. 이 조건들은 서로 독립적으로 public/paid/customer
distribution을 차단한다.

## 관련 문서

- [Phase 1G result](./PHASE_1G_RESULT.md)
- [Reader Lab performance](./READER_LAB_PERFORMANCE.md)
- [Validation strategy](./EPUB_VALIDATION_STRATEGY.md)
