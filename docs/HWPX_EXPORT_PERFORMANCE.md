# HWPX Export Performance

기준일: 2026-08-13

```text
Phase 1H performance verdict: WITHHELD
Reason: development/fresh-unpacked general and 675,000-character actual not yet recorded here
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

현재 문서가 확정할 수 있는 것은 release HWPX executable 생성과 unpacked resource 배치,
그리고 packaged bridge capability probe뿐이다. 이는 general/long-form Electron export actual이
아니므로 성능 표를 채우지 않는다.

| Environment | General | Long-form | Status |
|---|---|---|---|
| Development Electron | 미측정 | 미측정 | `WITHHELD` |
| Fresh unpacked Electron | 미측정 | 미측정 | `WITHHELD` |
| Hancom HWP conversion/reopen | 실행 안 함 | 실행 안 함 | `MANUAL VALIDATION PENDING` |

Root actual harness가 evidence JSON과 artifact hash를 확정한 뒤에만 이 표를 수치로 갱신한다.

## 7. Report requirements

최종 evidence에는 app/runtime identity, fixture hash, preset hash, run count, raw timing samples,
median/max, output byte/file/logical hash, package/coverage statistics, validation counts,
cancel/no-clobber/cleanup, external request count와 unexpected diagnostic를 포함한다. 원고 본문과
private absolute path는 포함하지 않는다.
