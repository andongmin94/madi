# HWPX Export Performance

기준일: 2026-08-13
후속 갱신일: 2026-10-01

```text
Phase 1H performance verdict: TECHNICAL GO — HWPX / PRIVATE LOCAL ONLY
Actual tested source: 5151f6a804cf1565a09211ea8f7a11e9f547fd34
Reason: exact source5151 full Windows development/fresh H passed
```

이 문서는 측정 계약과 실제 evidence를 분리한다. Unit test 시간, compile log, 구조적 package
copy 시간은 제품 export 성능 표본이 아니다. Correctness gate를 통과하지 않은 run도 timing
sample에서 제외한다.

Source51/660 절의 판정은 당시 기록이며, 현재 결과와 수치는 section9의 source5151을 따른다.

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

## 6. Source51 historical evidence

기준일에는 release executable·resource 배치·bridge capability probe만 확인했고 actual은 미측정이었다.
후속 source `51c1e6cdc10107d76e30103fbe1d6f4d035218e3`의 development와 standalone fresh H는
correctness·coverage·결정성·network·정상 종료를 통과했다. 아래 수치는 그 actual의 관측값이다.
이 source51 기록 시점에는 full run2가 fresh D에서 실패해 aggregate performance verdict가
`WITHHELD`였다. 현재 판정은 section8의 새 source660 actual에 근거한다.

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

## 8. Exact source660 development/fresh actual

실제 source `660814c7745a5231038aba902fd7113022778238`의 full Windows path는
5333.110초/PASS/exit0/source clean before·after로 종료했고 development와 fresh H가 같은 run에서
correctness·coverage·ZIP/XML reopen·결정성·network·정상 종료를 통과했다.
Node26.3.1/pnpm11.9.0과 command-process-only `CARGO_INCREMENTAL=0`을 기록했다.
필수6명령/package stdout receipt/inventory/source join과 역사 보존은
[H 결과 section28](PHASE_1H_RESULT.md#28-2026-10-01-exact-source660-full-windows-actual-완료)을 따른다.

장편은 양쪽 각5회450 sections/2411blocks(1961 exported+450fallback)/675000 characters,
omission/rejected0/VALID fatal/error0/warnings451/ZIP/XML reopen을 보존했다.
Output31867bytes와 output/logical/Publication IR/ONE_OFF preset 네 hash는 새 actual의 각5회와
development/fresh 사이 모두 같다. 일반6행은 별도 scope/split 입력이며 반복 median으로 합치지 않는다.

| 장편 n5 metric, ms | Development samples; median/max | Fresh samples; median/max |
| --- | --- | --- |
| Exporter total | 771,752,772,752,763;763/772 | 75,78,78,79,76;78/79 |
| Runtime Publication IR | 59915.09,59799.18,59679.51,60026.29,59914.55;59914.55/60026.29 | 2617.28,2609.43,2598.86,2623.94,2616.42;2616.42/2623.94 |
| Click→output read/reopen wall | 61775.46,61564.64,61422.70,61812.26,61672.42;61672.42/61812.26 | 3605.66,3565.67,3610.04,3597.39,3566.53;3597.39/3610.04 |
| Maximum renderer frame gap | median/max53.40/63.93 | median/max33.40/52.86 |
| Maximum heartbeat gap | median/max63.60/65.00 | median/max63.70/65.50 |

| 일반 scope/split | Development wall/IR/exporter ms | Fresh wall/IR/exporter ms |
| --- | --- | --- |
| WORK/SINGLE | 29712.39/28856.40/167 | 1840.60/1139.09/20 |
| WORK/SINGLE_OVERWRITE | 29835.16/28911.66/166 | 1893.39/1060.37/20 |
| VOLUME/SINGLE | 15387.78/14678.31/100 | 1401.84/541.43/15 |
| CHAPTER/SINGLE | 2152.75/1476.27/35 | 1370.04/65.41/8 |
| SCENE/SINGLE | 1400.90/508.79/30 | 1524.97/29.38/9 |
| WORK/VOLUME | 29530.97/28723.21/170 | 1759.19/1050.98/21 |

일반 5초/장편 15초 exporter total 기준은 fresh의 모든 run에서 실제 적용·통과했다.
Development hardTargetApplied=false와 별도 wall observation을 유지한다. Fresh wall도 모두 목표 수치
이내였지만 기준을 exporter에서 wall로 바꾸지 않는다. H의 IR은 runtime report stage이며 G의 사전
fixture compileWork 수치와 다르다. 별도 warm-up 완료나 cancel latency 측정은 기록하지 않았다.
Memory는5회 point 관측 max workingSet/private bytes로 development646180864/446443520,
fresh679079936/479866880이며 peak/leak 증명은 아니다.

Renderer HTTP/WS와 full-owned instance TCP 위반·classification/identity/parser 오류0,
product/native-before-wrapper/wrapper 세 진단 구간0, native alive0/exact captured exit/artifact+recovery cleanup0을
확인했다. Hancom HWP conversion/reopen은 미실행이고 수동 승인 PENDING이다. Native Korean IME,
runtime EPUBCheck/JRE distribution packaging 및 public/paid/customer/installer 배포 승인도 이 판정에 포함하지 않는다.

원본 JSON은 ignored `full-verify-660814c-run1/development-phase1h-evidence.json`과
`packaged-phase1h-evidence.json`에 byte-exact로 보존했다. 각각 SHA는
`116da2ad688c0b3730a3050e8bd1c0715b3b3616d578cbd561c7bf3f3121810e`,
`0316e71a2a6b710daf76c858bdd968c4e3a0759e346fc9d599406433b5cab920`다.
문서 동기화 이후 docs-only HEAD와 실제 runtime-tested source660을 구분한다.

## 9. Exact source5151 development/fresh actual

실제 source `5151f6a804cf1565a09211ea8f7a11e9f547fd34`의 `full-verify-5151f6a-run1`은
5256.600초/PASS/exit0·source clean before/after로 종료했고 development/fresh H가 같은 full에서 통과했다.
Source51/660 표는 해당 source의 역사로 보존한다. 새 raw 연결·package/source/host 증거는
[H 결과 section29](PHASE_1H_RESULT.md#29-2026-10-01-exact-source5151-full-windows-actual-완료)에 있다.
현재 계획은 [PLANS](../PLANS.md), runtime·portable 준비는 [별도 결과](OFFLINE_RUNTIME_RELEASE_RESULT.md)를 따른다.

두 환경의 각5회 모두450 source/exported sections·10 package sections,
2411blocks(1961 exported+450fallback)/675000characters, omission/rejected0,
VALID/fatal0/error0/warning451·ZIP/XML reopen·rich semantics를 유지했다.
31867bytes 및 output/logical/runtime Publication IR/preset 네 hash는 각5회와 두 환경 사이 모두 같다.
Correctness를 통과한 새 sample만 아래 표에 채택했다.

| 장편 n5 metric, ms | Development samples; median/max | Fresh samples; median/max |
| --- | --- | --- |
| Native exporter total | 1075,906,932,822,810;906/1075 | 96,85,87,87,78;87/96 |
| Runtime Publication IR | 67153.21,66039.96,65321.4,66850.41,64823.98;66039.96/67153.21 | 3467.85,3154.39,3320.5,2724.1,2693.77;3154.39/3467.85 |
| Click→output read/reopen wall | 69619.29,68127.21,67463.89,68692.25,66587.74;68127.21/69619.29 | 4667.56,4088.66,4423.83,3843.11,3638.94;4088.66/4667.56 |
| Maximum renderer frame gap | median/max52.4/166.7 | median/max50/60.2 |
| Maximum heartbeat gap | median/max66.1/73.7 | median/max76.6/77 |

| 일반 scope/split | Development wall/IR/exporter ms | Fresh wall/IR/exporter ms |
| --- | --- | --- |
| WORK/SINGLE | 50473.04/48921.32/267 | 2109.8/1166.08/26 |
| WORK/SINGLE_OVERWRITE | 44775.45/43481.66/213 | 1974.13/1118.14/22 |
| VOLUME/SINGLE | 18990.12/18079.29/121 | 1528.2/548.11/15 |
| CHAPTER/SINGLE | 2439.57/1755.38/39 | 1419.59/64.81/9 |
| SCENE/SINGLE | 2031.67/617.12/34 | 1587.82/32.72/9 |
| WORK/VOLUME | 33028.96/32167.45/184 | 1941.53/1213.84/24 |

일반6행은 별도 scope/split 입력이며 반복 median으로 합치지 않는다. 일반 IR 표시만 소수2자리로 반올림했다.
Fresh 일반5000ms·장편15000ms hard target은 native EXPORTER_TOTAL_MS에 실제 적용했다.
Development hardTargetApplied=false를 유지하며 wall을 exporter gate로 바꾸지 않는다.
H IR은 실제 runtime report stage다. G fixture 생성 때 저장된 compileWork나 Java EPUBCheck 시간과 섞지 않는다.

Memory5회 point 관측 max workingSet/private bytes는 development643047424/447950848,
fresh665202688/466272256다. Peak/leak 증명은 아니며 warm-up/cancel latency/Hancom 변환을 측정했다고 주장하지 않는다.
Rust jobs1/Vitest workers2·command-local CARGO_INCREMENTAL=0·dotnet --disable-build-servers,
비활성 desktop·GPU 비활성화 환경에서 측정했다. Foreground 기본 GPU 성능으로 확대하지 않는다.

양쪽 renderer HTTP/WS·owned TCP 위반/identity/parser·세 product/native/wrapper diagnostics0,
wrapper 전 native alive0/exact exit·descendants0·temp/recovery/claim/symlink0을 확인했다.
전체 host는 cleanup active0/강제 종료 없음/handles·desktop 제거지만 input10285 중36회error5로 이름 판독 불가였고,
DefaultEverySample=null·inactiveEverySample=true를 보존한다. Known input을 전체 구간의 Default 증거로 바꾸지 않는다.

새 dev/fresh raw SHA는 각각 `9757812c8cf6a0af7b27404048c1952767e2bcbff2eb28480e37585be34d3a70`,
`8f711f39ec4e46f27d818102ec360428de2bf6180b5e7d4a03ebf2f2e923f815`이며 ignored same-run phaseefgh-proof-archive에 byte-exact 보존했다.
수동 native Korean IME·Hancom module/licensing/실제 HWP conversion/reopen은 PENDING/HWPdisabled다.
이 결과는 HWPX private-local 기술 GO이며 공개·유료·고객·installer 승인 또는 docs-only HEAD의 새 actual PASS가 아니다.
