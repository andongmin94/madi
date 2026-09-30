# HWPX Export Performance

기준일: 2026-08-13
후속 갱신일: 2026-10-01

```text
Phase 1H performance verdict: WITHHELD
Reason: source51 development/standalone fresh actual passed; full Windows run2 failed at fresh D
```

이 문서는 측정 계약과 실제 evidence를 분리한다. Unit test 시간, compile log, 구조적 package
copy 시간은 제품 export 성능 표본이 아니다. Correctness gate를 통과하지 않은 run도 timing
sample에서 제외한다.

## 1. Fixtures

| Fixture | 최소 내용 |
|---|---|
| General | WORK/VOLUME/CHAPTER/SCENE, 한국어/XML 문자, paragraph/quote/scene break, 4 inline modifier, ruby, unsupported fallback |
| Long-form | 10권/150화/450장면, 675,000 source characters, 450 source sections |

두 fixture 모두 scope/preset/source publication hash를 evidence에 기록한다. 실제 source block,
heading, scene-break, inline/ruby count도 고정해 coverage 성공을 먼저 증명한다.

## 2. Measurement stages

- Publication IR compile
- semantic mapping
- style table
- section XML
- package documents
- ZIP packaging
- ZIP reopen
- internal validation
- source coverage
- total exporter
- desktop end-to-end wall
- optional HWP conversion
- optional HWP reopen

Exporter timing은 integer milliseconds라 매우 짧은 stage가 0일 수 있다. Desktop wall과
Rust stage 시간을 섞지 않는다. Development wall에는 debug core compile/IPC/UI 비용이 들어갈
수 있으므로 packaged exporter 성능으로 해석하지 않는다.

## 3. Sampling

- development와 fresh unpacked를 별도 process로 측정
- 가능한 경우 warm-up 뒤 5회, median/maximum 기록
- 각 run의 HWPX file SHA-256와 logical package hash 기록
- 5회 입력 identity와 logical hash가 같아야 distribution을 계산
- source/exported/fallback/configured-omission/rejected/character count와 validation PASS를 각
  run에서 확인
- child/process-tree memory, UI heartbeat와 cancel latency를 별도 기록

## 4. Hard correctness gates

```text
sourceSectionCount == exportedSectionCount
sourceBlockCount == exportedBlockCount
                  + fallbackBlockCount
                  + configuredOmissionBlockCount
                  + rejectedBlockCount
rejectedBlockCount == 0
sourceCharacterCount == exportedCharacterCount
sceneBreak loss == 0
validation fatal/error == 0
ZIP/XML reopen == PASS
```

이 조건이 깨지면 빠른 run이라도 성능 결과로 채택하지 않는다.

## 5. Target

Fresh-unpacked 675,000자 HWPX exporter total은 15초 이하를 hard target으로 사용한다.
Desktop wall, optional Hancom conversion과 reopen은 환경 의존 관측값이며 이 15초 target과
별도다. HWP 변환을 측정할 때 한컴 version, security module, output bytes/hash와 reopen을
같이 기록한다.

## 6. Current evidence

기준일에는 release executable·resource 배치·bridge capability probe만 확인했고 actual은 미측정이었다.
후속 source `51c1e6cdc10107d76e30103fbe1d6f4d035218e3`의 development와 standalone fresh H는
correctness·coverage·결정성·network·정상 종료를 통과했다. 아래 수치는 그 actual의 관측값이다.
Full run2는 fresh D에서 실패했으므로 최종 aggregate performance verdict는 `WITHHELD`로 유지한다.

| Environment | General | Long-form | Status |
|---|---|---|---|
| Development Electron source51 | 6 scope/split, exporter29–175ms | n5, exporter median/max769/773ms | 개별 H `PASS`, hard target 미적용 |
| Standalone fresh Electron source51 | 6 scope/split, exporter8–21ms | n5, exporter median/max76/77ms | 개별 H `PASS`, 15초 exporter 기준 실제 적용 |
| Hancom HWP conversion/reopen | 실행 안 함 | 실행 안 함 | `MANUAL VALIDATION PENDING` |

장편 각5회는450 sections, 2411 blocks(1961 exported+450 fallback), 675000자를 보존했고
omission/rejected0·VALID fatal/error0·warning451·ZIP/XML reopen을 확인했다.
Output31867bytes와 byte/logical/source/preset hash는 반복 및 두 environment 사이 모두 같다.
Hash와 실행 이력은 [H 결과 section27](PHASE_1H_RESULT.md#27-2026-10-01-exact-source51-full-실패와-standalone-actual)을 따른다.

| 장편 n5 metric, ms | Development samples; median/max | Fresh samples; median/max |
| --- | --- | --- |
| Exporter total | 773,769,767,773,756; 769/773 | 77,77,76,75,76; 76/77 |
| Runtime Publication IR | 59144.39,59052.25,58983.20,58946.07,59094.03; 59052.25/59144.39 | 2634.53,2582.63,2599.82,2577.12,2583.83; 2583.83/2634.53 |
| Click→output read/reopen wall | 60922.14,60824.30,60794.96,60751.23,60843.99; 60824.30/60922.14 | 3594.32,3601.06,3541.54,3504.00,3521.57; 3541.54/3601.06 |
| Maximum renderer frame gap | median/max33.30/53.06 | median/max51.26/53.03 |
| Maximum heartbeat gap | median/max63.60/70.90 | median/max61.60/64.40 |

| 일반 scope/split | Development wall/IR/exporter ms | Fresh wall/IR/exporter ms |
| --- | --- | --- |
| WORK/SINGLE | 29750.41/28849.02/168 | 1826.60/1117.08/21 |
| WORK/SINGLE_OVERWRITE | 29684.63/28705.25/171 | 1855.34/1052.21/21 |
| VOLUME/SINGLE | 15036.64/14321.42/98 | 1363.55/540.36/16 |
| CHAPTER/SINGLE | 2194.82/1527.60/37 | 1377.73/61.37/8 |
| SCENE/SINGLE | 1496.68/508.39/29 | 1511.07/28.37/8 |
| WORK/VOLUME | 29654.27/28801.72/175 | 1770.69/1036.45/21 |

일반6행은 서로 다른 input/scope이며 반복 median으로 합치지 않는다. 별도 warm-up export 완료는
기록하지 않았다. Runtime IR·exporter·wall을 구분하고 development 비용을 release 성능으로 이전하지 않는다.
Fresh 일반5초/장편15초는 exporter total 기준이며 모든 run에서 실제 적용·통과했다.
장편 memory는5회 point 관측의 max workingSet/private bytes로 development645083136/441856000,
fresh684384256/485158912다. Peak 또는 leak 증명은 아니며 별도 cancel latency도 미측정이다.
취소는 PREPARING에서 output/late-success/progress 부재를, no-clobber는 concurrent destination 보존을 확인했다.
Renderer HTTP/WS와 owned TCP 위반·분류/identity/parser 실패0, 세 lifecycle 진단0/native pre-wrapper 잔여0,
artifact/recovery cleanup0을 확인했다. Hancom 실제 conversion/reopen은 계속 미실행이다.
원본 JSON은 ignored `full-verify-51c1e6c-run2/development-phase1h-evidence.json`과
`phase1h-packaged-51c1e6c-run1/packaged-phase1h-evidence.json`에 보존했고 SHA는 H 결과 문서에 기록했다.

## 7. Report requirements

최종 evidence에는 app/runtime identity, fixture hash, preset hash, run count, raw timing samples,
median/max, output byte/file/logical hash, package/coverage statistics, validation counts,
cancel/no-clobber/cleanup, external request count와 unexpected diagnostic를 포함한다. 원고 본문과
private absolute path는 포함하지 않는다.
