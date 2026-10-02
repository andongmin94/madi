# Hancom Automation Validation

현재 제품 범위: **HWP CONVERSION REMOVED**, 2026-10-02 사용자 결정.
HWPX는 독립 출판 경로로 유지한다. 아래 성공·실패·등록 원복은 각 revision의 역사적 근거이며 추가 HWP 시험 계획이 아니다.

기준일: 2026-08-13. 후속 갱신일: 2026-10-02.
Sections1–8은 기준일의 기록이며 sections9–13의 revision별 actual과 실패를 보존한다. 최신 HWPX TEXT와 HWP 네트워크 판정은 section14를 따른다.

## 1. Official basis

- ProgID: `HWPFrame.HwpObject.2`
- HWPX open: `Open(path, "HWPX", "")`
- HWP save: `SaveAs(path, "HWP", "")`
- File path approval: registered `FilePathCheckDLL` module

ProgID/Open/SaveAs와 HWP token은 공식 Automation manual, HWPX token은 한컴 담당자 forum
예에서 확인했다. 이 근거는 unattended prompt 없음이나 commercial license 승인을 뜻하지
않는다. Source links는 [official profile](./HWPX_OFFICIAL_PROFILE_1_31.md)에 고정했다.

## 2. Independent read-only host inventory

다음은 bridge probe가 아니라 별도 host inventory에서 관측한 값이다. Probe는 이 executable
path, regular-file, signature 또는 version을 읽거나 검증하지 않는다.

| Item | Observation |
|---|---|
| Product | 한컴오피스 2022 |
| HWP executable version | `12.0.0.4170` |
| Signature | Valid, HANCOM INC. |
| Registered ProgID | `HWPFrame.HwpObject`, `.1`, `.2` |
| `.2` LocalServer32 | 32-bit `hwp.exe -Automation` |
| Security module registry | 32-bit process의 current-user 등록 문자열 존재; value path/file은 probe가 검사하지 않음 |
| HWP process before probe | 없음 |

## 3. Executed safe probe

Framework-dependent win-x86 bridge release를 unpacked resources에 복사한 뒤 UTF-8 JSONL
`probe`를 실행했다. 결과는 다음 capability identity였다.

```json
{
  "status": "SUCCESS",
  "available": false,
  "availabilityCode": "REGISTERED_UNVERIFIED",
  "hancomVersion": null
}
```

Probe는 명시적 32-bit ClassesRoot view의 ProgID/CLSID/LocalServer32 등록 문자열과 win-x86
process의 current-user security-module 등록 문자열이 비어 있지 않은지만 확인했다.
`File`/`Path` API, filesystem regular-file, executable/DLL signature·version, module load와
COM activation은 실행하지 않았다. 따라서 이것은 Automation activation, HWPX open, HWP
save 또는 HWP reopen PASS 근거가 아니다.

## 4. Automated mock/contract validation

C# tests는 closed protocol, 32-bit registry presence-only
registered-unverified/not-installed probe,
invalid path/extension, no-clobber,
timeout, targeted cancel, failure preservation, mock conversion commit와 mock reopen 계약을
검사한다. Mock PASS는 실제 한컴 호환성 PASS로 바꾸어 표현하지 않는다.

## 5. Manual/actual matrix

| Gate | Status |
|---|---|
| Independent registry/file/signature host inventory | PASS; bridge probe와 별도 |
| Packaged x86 bridge starts and parses UTF-8 JSONL | PASS |
| 32-bit registry presence-only classification | `REGISTERED_UNVERIFIED`, version `null` |
| Probe filesystem/path/regular-file/signature/version validation | NOT PERFORMED BY DESIGN |
| COM object activation | NOT RUN |
| Madi HWPX open in Hancom | MANUAL VALIDATION PENDING |
| HWPX → HWP SaveAs | MANUAL VALIDATION PENDING |
| Generated HWP reopen | MANUAL VALIDATION PENDING |
| Five repeated conversions and cleanup | MANUAL VALIDATION PENDING |

## 6. Conditions before running actual

1. Approved file-path security module source/registration and redistribution boundary 확인
2. Automation license/approval owner 확인
3. No unsaved user HWP documents/process interference 확인
4. Madi-generated non-private fixture 사용
5. HWPX internal validation/coverage PASS 확인
6. Hidden owned window와 conservative dialog policy 확인
7. Timeout/cancel에서 global process kill을 하지 않음 확인

## 7. Acceptance procedure

Actual을 승인하면 probe → generated HWPX open → HWP SaveAs → close → new Automation session에서
HWP reopen → output size/hash 확인 순서로 수행한다. 5회 반복하며 conversion/reopen timing,
process descendants, temp/global artifact와 prompt를 기록한다. Existing HWP/no-clobber와 failure
때 source HWPX 보존도 별도 scenario로 검증한다.

## 8. Current conclusion

```text
Hancom installed: YES
Probe classification: REGISTERED_UNVERIFIED — 32-BIT REGISTRY PRESENCE ONLY
Probe hancomVersion: null
Automation safely available: NO
COM activation performed: NO
HWP technical verdict: MANUAL VALIDATION PENDING
Distribution verdict: LICENSE REVIEW REQUIRED
```

## 9. 2026-10-01 private-local actual

최초 실제 시험 HEAD는 clean `ad7fb613668128a740f683ca8e51fa6624e0e3ae`이며 제품 source·배포본은
`5151f6a804cf1565a09211ea8f7a11e9f547fd34` 그대로다. 제품 재빌드나 ZIP 변경 없이 시험했다.
Current host의 registered x86 Hwp는 version12.0.0.4605, signature Valid/HANCOM_INC,
SHA `59d402c3a3fe1409f3bb612b5c59301425aa5a7781c76163c96ebb07fb11d680`다.
시험 전 HKCU32/64의 `FilePathCheckerModuleExample` 등록 값은 없었다. 기준일의 등록 존재 관측을 재사용하지 않았다.

사용자는 unsigned 공식 예제 모듈의 임시 등록과 합성 로컬 시험을 직접 승인했다.
예제 callback은 모든 경로를 허용하며 서명이 없다. DLL217229bytes/SHA
`9ac5b97c47ac8aed1e8bca27a3eef39411361d8f68c262509f0c40a8f9d21bb6`의 원본만 사용했고
정확한 HKCU32 REG_SZ 값 하나를 일시 등록한 뒤 기존 부재 상태로 복원했다.
승인은 이 시험 범위이며 영구 등록·공개/유료/고객 배포·문서 layout 최종 승인이 아니다.
[공식 module 안내](https://developer.hancom.com/hwpautomation)와 다운로드 원본의 hash·정적 검토를 별도로 보관했다.

합성 입력은 canonical180000자/323blocks/180본문문단/60sections다. 표시용 ruby fallback과 heading 등을
포함한 HWPX 전체 표시 sequence는324문단/263nonempty/61empty/181324자다.
7785bytes/SHA `d6b3b807d8e3b35420338464f8c128e408f40903237297401883e2c2448087a9`의 두 export가
byte/logical hash 동일하고 ZIP9entry/XML8개 재열기·내부 coverage를 통과했다. 이는 한컴 열기 성공 증거가 아니다.

| 실제 실행 | 관측과 판정 |
| --- | --- |
| 등록 없음 bridge | probe/convert SECURITY_MODULE_REQUIRED, 기존 output OUTPUT_EXISTS·변경 없음; COM 미실행 |
| first-vertical run1–4 | PowerShell 명령·observer·startup/thread desktop 판독 조건에서 실패. 첫 working increment 실패 그대로 보존; convert 미실행 |
| first-vertical run5 | registered probe 후 convert ERROR OTHER, output 없음. 원래 classifier가 구체 code를 보존하지 못했으므로 후속 결과로 바꾸지 않음. 소유 nested job 강제 정리 |
| JSONL encoding 진단 | PS5 writer CP949로 INPUT_NOT_FOUND, UTF-8 bytes로 SECURITY_MODULE_REQUIRED. 한글 경로 transport 문제를 ignored 시험 도구에서 수정; 제품 코드 변경 없음 |
| first-vertical run6 | UTF-8 요청 후 실제 제품 convert OPEN_FAILED, request→response1150.57ms. HWP output 없음/SaveAs·reopen 미실행. Hwp 자연 종료 실패 후 소유 nested job만 강제 정리 |
| 별도 .NET open 진단 run1 | Open(path,"HWPX","")는 예외 없이 false; XHwpDocuments와 Active_XHwpDocument getter는 성공. 독점 private instance의 Quit 반환 뒤 native exit/job0·강제 정리 없음. 종료 직후 observer race로 전체 harness COMMAND_FAILED; 3개 control 전체 완료로 쓰지 않음 |
| 별도 진단 run2 | 새 소유권 미확인 Hwp 존재로 USER_HWP_PROCESS_PRESENT 사전 중단. registry write·COM·소유 server 생성 없음; 해당 process 조작·종료 없음 |

한컴 자체 blank HWPX 저장과 format 빈 문자열의 자동 감지 Open은 아직 실행하지 못했다.
공식 문서상 [명시적 HWPX와 자동 감지](https://forum.developer.hancom.com/t/hwpx-open/1006)는 둘 다 지원한다.
따라서 현재 호출 token이 잘못됐거나 한컴2022가 HWPX를 지원하지 않는다고 단정하지 않는다.
실제 생성 파일·format filter·환경 중 원인을 대조하기 전 임의 XML 보완을 하지 않았다.

이 최초 Open 진단의 prelaunch는 Hwp0부터 시작해 verified executable의 `-Automation -Embedding`을 inactive Win32 desktop의
소유 nested job에서 실행했다. PID/birth/image hash/job과 실제 window-owner thread desktop을 확인했다.
GetThreadDesktop NULL/error0인 worker thread는 unknown으로 보존했으며 전체 native thread 판독 성공으로 쓰지 않았다.
Open 진단의 HWND와 COM object 직접 binding은 하지 않았다. 독점 process/GUI 관측 범위다.
이 최초 Open 진단의 시험 desktop은 비활성이고 입력 이름 관측은 Default였으며 화면 전환·활성화·입력·보안 prompt 승인·global kill은 호출하지 않았다.
Foreground 비간섭의 절대 보증이나 모든 Windows process의 감시로 확대하지 않는다.
TCP sampling은 이 좁은 진단에서 disabled/unknown이며 network gate PASS가 아니다.

제품 probe는 계속 REGISTERED_UNVERIFIED/available=false다. 현재 source에는 수동 승인 결과를 저장해
AVAILABLE로 연결하는 경로가 없고, root Open/SaveAs·Item(0) window capture는 새 창/문서 소유권 증명이 아니다.
Timeout 응답도 background STA 정리 완료를 보증하지 않는다. 독점 시험 도구의 Quit/native exit를
제품 cleanup 성공으로 이전하거나 등록 문자열 존재만으로 HWP를 활성화하지 않는다.
Ignored HWP body coverage decoder는 준비됐지만 실제 HWP가 없어 실행하지 않았다.

| 원본 근거 | SHA-256 |
| --- | --- |
| `.tools/verification/hancom-private-local-approval-9cbfba88-576e-450f-bd2c-f21cf3b325e3/approval.json` | `792b77e29a710ca19ec728020328fc1bde19cac66a1683814069142ec7aa2dff` |
| `.tools/verification/synthetic-hwpx-input-5151f6a-9d946327-e916-4074-9d7b-80e68498f5f8/receipt.json` | `e805c7c2549b11a711f4cca9bbd2df16fa02db27df63839324773fa374d5b66a` |
| `.tools/verification/hancom-jsonl-encoding-ecdc7053-7891-486b-a92e-8fc2c8851191/receipt.json` | `635ee6ef5b0b69ad55bed931fdbc9fec2821bfb0e6d50ef83d6981b6b0ff5705` |
| `.tools/verification/hancom-first-vertical-f39c4b1a-6ec7-4b00-8049-d7e012ba30ac/receipt.json` | `6f05641ac13b621c0f5c5a0c5bc31a201e8afdf31f04b92e7e42b6e59ceb063c` |
| `.tools/verification/hancom-open-diagnostic-19bd2d4b-8910-488f-93b8-7bb02ab2892e/receipt.json` | `efbcaed514e0c8d53bc9beac94b08a7391927f1c8e53ea1d4f3abddfcd2815d6` |
| `.tools/verification/hancom-open-diagnostic-736b1616-c24c-46fc-9af0-b95fac3aba03/receipt.json` | `4bbd56ebb2948db410fb409a4e43ce250cb159c941f218ff94bcfcac9ec216ac` |

```text
Private temporary module/synthetic trial: HUMAN APPROVED
Product bridge conversion: OPEN_FAILED / NO HWP OUTPUT
Separate actual Open: false / document getters succeeded
Separate guarded Quit: RETURNED / NATIVE EXIT OBSERVED / NO FORCE
Native blank HWPX and autodetect control: NOT RUN
Five conversions/content/reopen/network/lifecycle gate: NOT PASSED
App HWP: DISABLED
Distribution/layout approval: NOT GIVEN
```

## 10. 2026-10-01 resumed native controls

사용자가 재부팅을 위해 중지한 뒤 작업 재개를 요청했다. 실제 재부팅 여부는 독립 확인하지 않았다.
재개 후 좁은 ignored 진단은 clean `ccd406ef620eb5175e3ac2fd6671d6dff2550853`에서 실행했다.
당시 제품·배포본·ZIP은 source5151 그대로였으며 기존 full5256.600초 PASS를 CCD의 전체 gate 실행으로 옮기지 않는다.

별도 x86 loader에서 원본 예제 DLL load/export lookup/free를 통과했다. 이는 Hancom의 RegisterModule 성공이나
Automation 안전 가용성을 증명하지 않는다. `-Automation`과 인자 없는 prelaunch의 ROT RegisterModule은 모두 false였다.
이전 GetTextFile NULL도 보존하며 NULL을 빈 문자열이나 확정 고장 원인으로 해석하지 않는다.
아래 문서 식별 대조에서는 module 등록·Automation Open/SaveAs·본문 읽기를 수행하지 않았다.

독립 대조군은 Apache-2.0 `neolord0/hwpxlib`의 고정 commit
`f9fd2255ac0fc57414e0b657d115e7de51d31c65`, `testFile/tool/blank.hwpx`다.
6397bytes/SHA `d28f55cd622b6d0cade2d8ae3b5d53f1ed5c4154289e463a4c390d9be157aa6d`,
ZIP8entry·문단1·문자0이며 Hancom 자체 생성 파일이라고 증명한 것은 아니다.
URI16개는 선언된 namespace를 고르는 `hp:case required-namespace`였다. 외부 대상0이라는 정적 분류는 runtime network 판정이 아니다.

| 실제 대조 | 관측과 판정 |
| --- | --- |
| 원본 마디 quoted filepath | strict blank에서 SetActive 반환 뒤 FullName16표본/15007ms, 일치 없음·timeout. Native emptytrue/nonmodified. TEXT·Close·Quit 미실행, 소유 job 강제 정리와 FAIL 보존 |
| 독립 빈 대조군의 초기 Path 조건 | FullName exact/emptytrue/nonmodified이지만 Path가 파일·디렉터리 비교 모두 false여서 활성화 전에 중단. Path 표현의 원인은 미확정이며 FAIL 보존 |
| 독립 빈 대조군의 FullName 조건 | before/after FullName exact, captured/current-active Count1, emptytrue/nonmodified. Close BOOL true와 전후 guard, Quit 반환, native exit/no force, Hwp0. 문서 식별·정리 범위 PASS |
| 마디 major0 재대조 | 공통 A/B 빌드에서 FullName20표본/15011ms, 일치 없음·timeout. Native blank 상태, TEXT·Close·Quit 미실행. Inner 소유 job 강제 정리/FAIL, outer COMMAND_FAILED45.104초 |
| 마디 major5 시험본 | 같은 빌드에서 FullName21표본/15151ms, 일치 없음·timeout. Native blank 상태, TEXT·Close·Quit 미실행. Inner 소유 job 강제 정리/FAIL, outer COMMAND_FAILED42.516초 |

Known file identity는 공식 FullName 전체경로 계약, 고정 fixture hash, 현재 active Count1,
HWND→PID/birth/image/job/private desktop을 함께 확인한다. Path는 metadata로 관측한다.
미명명 blank의 SetActive-only 자격에는 Path와 FullName 모두 empty/native emptytrue/nonmodified 조건을 유지한다.
Close 직전 captured/current active FullName·Count1·empty/modified를 다시 검사하고,
Close API BOOL true와 전후 input guard가 성공한 뒤에만 Quit을 허용한다.
공식 계약은 [고정 Hancom Automation manual](https://github.com/hancom-io/devcenter-archive/blob/213c7faad552b4853b525887e36accb6025e837b/hwp-automation/HwpAutomation_2504.pdf)과 installed type library로 확인했다.
문서 식별 guard는 좁은 시험 도구의 설계 판단이며 제품의 안전 가용성 인증이 아니다.

빈 대조군의 C# input43회와 outer host25회는 각각 Default/owned desktop inactive를 확인했다.
Outer12.695초/exit0/jobactive0/no force/desktop 제거다. 두 관측 범위를 합치지 않는다.
A/B outer는 major0의88표본, major5의83표본에서 Default/inactive/unknown0, jobactive0/desktop 제거를 확인했다.
각 시험 뒤 Hwp0·HKCU32/64 예제 값 부재·원본 module/fixture hash 불변을 새로 확인했다.
전체 native thread desktop 판독은 완전 증명되지 않았고 foreground 비간섭을 절대 보증하지 않는다.
화면 전환·직접 Win32 활성화·키보드/마우스 입력·보안 prompt 승인은 하지 않았다.
SetActive는 focus-capable COM 호출이며 각 호출 전후 private input guard를 적용했다.
TCP는 DISABLED_UNKNOWN이므로 network gate PASS가 아니다. source5151 full의 input36 unknown 이력도 유지한다.

Major 대조군은 원본7785bytes의 byte-exact copy와 major0→5 한 바이트/local·central CRC8바이트만 바꾼 파일이다.
다른8entry의 raw/compressed bytes와324문단/181324자/framed sequence hash는 동일하다.
ZIP CRC/XML 정적 통과는 native format·본문 coverage 성공이 아니다.
단일 major 변경은 이 시험의 로드 실패를 해결하지 못했으며 다른 형식 원인 전체를 배제한 것은 아니다.
제품 version 값이나 XML을 이 차이만으로 수정하지 않았다.

| 재개 후 원본 근거 | SHA-256 |
| --- | --- |
| `.tools/verification/hancom-module-loader-run-efe2efe1-2f7b-4912-9326-f36487736ee3/receipt.json` | `9b6caa5e86a9ab9b5a7df0ebf43aaeec4816a489548f01c844c51cf203e89b3e` |
| `.tools/verification/hancom-file-blank-activation-ccd406e-run1/actual-join.json` | `3253b7ed996d19ae4a859f9a72c160757f7c90bc927e4e3a65df55dd4a3dd32a` |
| `.tools/verification/hancom-independent-empty-control-ccd406e-run1/actual-join.json` | `a86960f237011f5508080d94ce0a911ba0664c02250854b4853e720b6d9d7f3b` |
| `.tools/verification/hancom-empty-control-fullname-ccd406e-run1/actual-join.json` | `d959868391357ed0a5c5f5f5c915034f3a8efe94fbd5488e543239ad2713af90` |
| `.tools/verification/hwpx-major-byte-patch-374ed9b9-b018-4adc-838e-ca7b37d4f608/receipt.json` | `d2da182a97cfd82ef59539144e78fb714f18be2875d22c3609f723b874d95005` |
| `.tools/verification/hancom-major0-ab-ccd406e-run1/actual-join.json` | `7059bfa08ee333367ef8b4b77d678cbd3abc3eb1fd80c828d218480a440b5699` |
| `.tools/verification/hancom-major5-ab-ccd406e-run1/actual-join.json` | `8981c959ad337608cea60d5a5357c4e278592eee79d7065fc34da09094614a76` |

원본 prepared/build/actual/outer receipt는 바이트 그대로 새 보관본과 hash를 연결했다. 실패 원본을 고치지 않았다.
이전 active blank join의 index0 요약이 ROT baseline을 선택했던 오류도 원본과 별도 operation correction에 보존했다.

재개 전931 진단의 RegisterModule false와 특정 PID18872 정리는 다음 원본에 남는다.
PID18872 종료는 그 process에 한정한 사람의 승인으로 실행했으며 다른 process 종료 승인으로 확대하지 않았다.

| 중지 전 원본 근거 | SHA-256 |
| --- | --- |
| `.tools/verification/hancom-rot-diagnostic-run-7486438a-ae51-48f8-987c-1f1fdbea4b04/receipt.json` | `b95813d8bbc3286669f515b0aab60a20ff83872acf0548e01015c62e0e1584bd` |
| `.tools/verification/hancom-rot-diagnostic-run-f5418f39-0bfc-4cc1-800d-b6bc2207e84a/receipt.json` | `4e6c025d55f6b8cc2d6c66874b2ee51834b18c246743e030dac173b83366ae56` |
| `.tools/verification/hancom18872-specific-cleanup-b525eef9-4130-4439-b6ae-a35f6df1ec2f/receipt.json` | `e21a7ef211f91eac992790567ec25398181f6f2d534ca8fc469574da962fcbf9` |
| `.tools/verification/retired-hancom-desktop-readonly-7924d0d3-c130-4943-b289-343cefff013b/receipt.json` | `976a30f95794761072ece39ab659f7146798f4311fa647aabfb39a1b38539cd8` |

HWP 생성·재열기·본문 coverage·5회 반복·network/lifecycle gate는 미통과이며 제품 HWP는 disabled다.
독립 빈 대조군의 식별·정상 종료 성공을 이 판정이나 public/layout/native IME 승인으로 확대하지 않는다.

## 11. 2026-10-01 BBB native file-load controls

실제 outer source는 `bbbeb4d20debce8aef67c68eb060a7d31aea5063`이며 각 실행 전후 tracked clean이다.
제품·검증한 배포본·ZIP은 `5151f6a804cf1565a09211ea8f7a11e9f547fd34` 그대로다. 기존 full5256.600초 PASS를 BBB 전체 gate 실행으로 옮기지 않는다.
아래는 합성 파일의 native 문서 식별/정리 진단이다. HWP 변환·저장·재열기·최종 한컴 호환성 승인이 아니다.

### Actual results

NONEMPTY와 TEXT는 독립 대조군의 1문단/18 scalar이고, 나머지는 마디의 18 scalar 본문을 포함한 5 display 문단/44 scalar 진단 입력이다.
`poll`은 bounded FullName readiness의 표본 수/경과 ms이며 성능 기준을 완화한 값이 아니다. `outer`는 전체 host 경과 초다.

| Case | 입력/차이 | poll | outer(s) | 실제 결과/정리 |
| --- | --- | ---: | ---: | --- |
| NONEMPTY | 독립 빈 template의 hp:t 하나에 합성18 scalar | 1/98 | 12.721 | 문서 식별 PASS, 자연 종료 |
| TEXT | 같은 NONEMPTY에서 GetTextFile(TEXT,'') 1회 | 1/189 | 15.092 | STRING 관측 PASS, 자연 종료 |
| TINY | 실제5151 Publication IR exporter 원본 | 18/15285 | 44.466 | blank 상태/timeout FAIL, inner 소유 job 강제 정리 |
| BASELINE | Tiny의 matched stdlib repack | 21/15007 | 42.343 | 같은 범위 FAIL, inner 강제 정리 |
| SPINEHEADER | BASELINE content.hpf spine에 header itemref 추가만 | 19/15003 | 44.511 | 같은 범위 FAIL, inner 강제 정리 |
| VKNOWN | BASELINE version.xml만 독립 대조군 원본 bytes로 교체 | 20/15198 | 44.849 | 같은 범위 FAIL, inner 강제 정리 |
| PARTS | 독립 대조군 packaging에 Tiny header+section 교체 | 18/15012 | 45.738 | 같은 범위 FAIL, inner 강제 정리 |
| SECTION | 독립 header 유지/Tiny section의 사용 char refs를0으로 맞춘 입력 | 21/15013 | 42.041 | 같은 범위 FAIL, inner 강제 정리 |
| SAFE_FIRST_RUN | 첫 run을 donor secPr+column+t로 구성/pageNum 제거; 여러 변수 | 1/105 | 16.388 | 문서 식별 PASS, 자연 종료 |
| T_ONLY | 첫 run에 t만 | 22/15098 | 41.854 | 같은 범위 FAIL, inner 강제 정리 |
| COLUMN_AND_T | 첫 run에 column+t만 | 22/15060 | 41.384 | 같은 범위 FAIL, inner 강제 정리 |
| NO_PAGE_NUM | COLUMN_AND_T에서 pageNum 요소 삭제만 | 17/15284 | 46.793 | 같은 범위 FAIL, inner 강제 정리 |
| KNOWN_SEC_PR | COLUMN_AND_T secPr를 독립 donor로 교체; 여러 설정 | 1/98 | 13.015 | 문서 식별 PASS, 자연 종료 |
| CHILDREN_ONLY | COLUMN_AND_T secPr에 donor 자식8개 추가/기존 opening·startNum·pagePr 유지 | 1/264 | 17.407 | 문서 식별 PASS, 자연 종료 |
| ATTRIBUTES_ONLY | COLUMN_AND_T에서 donor opening·startNum·pagePr만 교체/자식8개 제외; 여러 설정 | 19/15006 | 43.779 | 같은 범위 FAIL, inner 강제 정리 |

PASS 범위는 정확한 FullName·captured/current-active Count1·nonempty/unmodified·소유 HWND/PID/birth/image/job/private/input guards와 Close BOOL true→Quit 반환→native exit/job0다.
실패 case는 bounded readiness 후에도 strict blank였으며 TEXT·Close·Quit를 실행하지 않았다. Inner 강제 정리와 FAIL을 그대로 보존했고 outer는 job0·desktop 제거·별도 강제 정리 없음이었다.
모든 case의 입력/module hash가 유지됐다. 각 종료 관측의 Hwp0·양 registry view 등록값 부재는 현재 시점 증거이며 연속 host 관측을 뜻하지 않는다.

### Narrow findings and limits

CHILDREN_ONLY에서는 기존 Madi secPr opening·startNum·pagePr와 pageNum·column·동일44 scalar를 유지한 채 추가한 donor 자식8개 묶음으로 문서 식별이 성공했다.
이는 단일 자식의 필요성·전체 format 원인·제품 수정 완료를 증명하지 않는다. 원본 Tiny/PARTS/SECTION 실패는 재판정하지 않았다.
독립 accepted header를 사용한 hybrid 입력은 사용되는 section refs를 맞췄지만 inherited unused/sentinel header refs가 남아 있어 `allHeaderReferencesResolved=false`를 유지한다. 원본 Madi header에 이 판정을 적용하지 않는다.
TEXT는 STRING18 UTF-16/18 scalar/26 UTF-8bytes, SHA `82c2c06622fdef248f28daa5cfc9ea9e274d19bb6c0fc63029be409c593f3044`였고 literal exact/CRLF0/loneCR0/loneLF0였다.
본문은 memory에서만 비교했고 저장·출력·trim·빈 문단 제거를 하지 않았다. `nativeRawExpected=null`, profile PENDING, canonical coverage=false다.
TEXT를 제외한14 case는 TEXT NOT_READ다. Tiny와 hybrid 입력의 5문단/44 scalar native 본문 coverage나 빈 문단 경계 보존은 측정하지 않았다. NONEMPTY는 별도의 1문단/18 scalar 대조군이다.
TCP는 DISABLED_UNKNOWN이고 network gate PASS가 아니다. Worker thread desktop unknown을 expected로 승격하지 않았으며 foreground 비간섭의 절대 보증은 하지 않는다.
직접 Win32 activation/desktop switch/UI 입력·RegisterModule·registry writes·Automation.Open·SaveAs는 이 진단에 없다. Captured SetActive는 포커스 동작 가능한 private 문서 활성화로 따로 기록했다.
HWP는 계속 disabled이고 실제5회 변환·HWP재열기·layout·취소/timeout/network 승인 및 사람의 결정은 미완료다. Native Korean IME15항목도 MANUAL VALIDATION PENDING이다.

### Immutable byte joins

각 join은 prepared/static/build/raw actual/outer metadata 원본5개를 wx로 복사·재해시했고 `INSPECT_NATIVE_FILE`과 fixed case를 명시 선택했다. 아래는 draft 작성 때 다시 확인한 join SHA다.

| Case / `.tools/verification/` 하위 join | SHA256 |
| --- | --- |
| NONEMPTY `hancom-nonempty-control-bbbeb4d-run1/actual-join.json` | `9bde2484a02f6957a2f56d215c0f5e3609ee9c59a33148dd999cfb929f44b3a2` |
| TEXT `hancom-nonempty-text-bbbeb4d-run1/actual-join.json` | `23329e383d26f154f311d16a6b70e8f6672770b233748e1adc8f40bbb688812f` |
| TINY `hancom-madi-tiny-bbbeb4d-run1/actual-join.json` | `038ac53202adac22c0802b85579407898e808679067592c318fd55a317d0de9f` |
| BASELINE `hancom-tiny-baseline-bbbeb4d-run1/actual-join.json` | `17a0da5ef4d08ad0133642c148c9bb029c96ed6ae84fe6e027e9f8b7691103db` |
| SPINEHEADER `hancom-tiny-spineheader-bbbeb4d-run1/actual-join.json` | `7f3651babc3c3628f77c63564e32c21d28882cb668c9fd50045e38f0a50ae7aa` |
| VKNOWN `hancom-tiny-vknown-bbbeb4d-run1/actual-join.json` | `4b9b5db5617df93872cd197f527a153c2d7935193bf156977bca7643cd50f278` |
| PARTS `hancom-madi-parts-bbbeb4d-run1/actual-join.json` | `af84474c8d99ac0a45ed204e60e5ae67be98e044cb546a086486002306b7e126` |
| SECTION `hancom-madi-section-bbbeb4d-run1/actual-join.json` | `5845214ed5332a9ae94fcdab9eab22044faff5973317d15c677a643c28434778` |
| SAFE_FIRST_RUN `hancom-safe-first-run-bbbeb4d-run1/actual-join.json` | `13e4b2e5876054f1426af8db10cd6a07a55df9252dcd92ad34ac939d2759034e` |
| T_ONLY `hancom-t-only-bbbeb4d-run1/actual-join.json` | `39054b2428db16ba3f77c2325b6642b7d0ed92d24548841f947ba74a24c5c26f` |
| COLUMN_AND_T `hancom-column-t-bbbeb4d-run1/actual-join.json` | `fa665e2a73f30077ce53311487df2175bee816f5e3e944e22df073ab8231892a` |
| NO_PAGE_NUM `hancom-no-page-num-bbbeb4d-run1/actual-join.json` | `657425d881ae0b4589e615c8ea728b946df470eed86f0282ca1eefbcd04464ee` |
| KNOWN_SEC_PR `hancom-known-secpr-bbbeb4d-run1/actual-join.json` | `7ad6faa90f1c2e5df9a07d6bcfdd9a0edf082b60375b154cb21b6100d0d61aca` |
| CHILDREN_ONLY `hancom-secpr-children-bbbeb4d-run1/actual-join.json` | `cb45cb6503d7c1e6d7b165cd06a7703146aea2fc19511927b3f56f828dd77682` |
| ATTRIBUTES_ONLY `hancom-secpr-attributes-bbbeb4d-run1/actual-join.json` | `3ea0d1121c5d3551c4913f078cef0c3445298351945aec1cd2088645de0336d6` |

4-case 종료 후 fresh annotation: `.tools/verification/hancom-secpr-four-case-postguard-6b93b6e3-a545-4a5e-80d8-ebe2a5bce63f/receipt.json`, SHA `56e3363357afbb78cda68d27a88cf83d8d57bf2f04c482ca0363478fa6d1e727`.
앞/뒤 Hwp0·등록값 부재·BBB clean, 원본20/보관20 receipts와54 build/static references의 해시/크기를 실제 재확인했다. 이전 join의 deferred Hwp 표시는 수정하지 않았다.

## 12. 2026-10-02 minimal Madi section profile control

정확한 outer source는 clean `bbbeb4d20debce8aef67c68eb060a7d31aea5063`다. 제품 source5151의 tiny HWPX를
동일한 stdlib 재포장 baseline과 대조했다. 기존 `secPr` attrs·`startNum`·`pagePr`·geometry·major0·Madi header·본문을 유지하고
`grid`·`visibility`·`lineNumberShape` 세 직계 자식만 올바른 순서로 넣었다. 원본 ZIP과 바이트 동일한 변경이라고 주장하지 않는다.
다른8 raw/compressed payload의 동일성은 재포장 baseline과의 비교다. 이전 baseline native FAIL도 보존했다.

| 추가 대조 | 실제 관측 |
| --- | --- |
| 알려진 header의 LAYOUT_ONLY 첫 실행 | 파일 식별·Close BOOL true는 반환했지만 post-close/terminal 기록이 완료되지 않아 diagnostic 소유 process 강제 정리, FAIL. 닫기 실패나 blank load timeout으로 재분류하지 않음 |
| 같은 LAYOUT_ONLY 재실행 | PASS16.684초. exact FullName·Count1·nonempty/unmodified·Close BOOL true/전후 guard·Quit·native exit |
| 마디 자체 MADI_ALL_CHILDREN | PASS14.406초. 자체 header·major0, 자식8개와 colPr/empty t의 결합 대조. 이 넓은 구성을 제품에 그대로 채택하지 않음 |
| NOTES_ONLY / BORDERS_ONLY | 각각 FAIL41.551/41.855초. strict blank·15초 file readiness timeout, TEXT/Close/Quit 미실행·소유 job 강제 정리 |
| 마디 자체 MADI_LAYOUT_ONLY | **PASS18.849초**. 4663bytes/SHA `0b026dc17a3731d23260859154304f69912290e0eddb32dd48da0b6ffa2ec7fe`, file readiness1표본/375ms·exact captured/current Active Count1·nonempty/unmodified·Close BOOL true/전후 guard·Quit·native exit. 5문단/44 scalar/52 UTF-8 bytes는 ZIP/XML 정적 보존 수치이며 native TEXT는 NOT_READ |

MADI_LAYOUT_ONLY outer는 UTC2026-10-01T15:19:56.7615687Z→15:20:15.6109775Z,
job31/active0·outer/inner 강제 정리 없음·desktop 제거, input36표본 Default/inactive/unknown0이다.
이 호출에서 registry/module registration·Automation Open/SaveAs·본문 읽기는 하지 않았다.
prepared MADI_LAYOUT_COLUMN_T와 MADI_ALL_CHILDREN_MAJOR5는 실제 실행하지 않았다.

| 보존 근거 | SHA-256 |
| --- | --- |
| LAYOUT_ONLY run1 join | `86164d8a8c2d5f60b3788cae02436d4dd0d26c29014c437d61bc7b80f9304e11` |
| LAYOUT_ONLY run2 join | `a224f43fb71479e7336cd5cff3715f012936df072d8b3fdb5c7ecd887434c785` |
| MADI_ALL_CHILDREN join | `4095f3c6aa0357cfd27894f1c2340de991dc6b07b883122ab94072752529181f` |
| NOTES_ONLY / BORDERS_ONLY joins | `b170ac1d50e2af87e61c9280e13a5331e887836aed27748097d65dc160f34f29` / `27600eb763a443eea5b9cff7601926e2a4c409f32f20ac28bdfb8381f3a3976f` |
| own minimal artifact receipt | `5235a76a4cb260b2f195c2184f76f5e2fbeaa016f731dabac85cca3b5d081db9` |
| own minimal raw receipt | `dad402d2545b4d9effc6e07b7b981187134421ebab60eaac04e64e19414948b0` |
| own minimal join | `495c20377414547f5e17da8d2cfb04af97929c263fd1389ce176f1a65c57b9d1` |
| own minimal fresh boundary receipt | `282712f57ce9bf4dbadca9209f762e977ca8e4c79f0b20a252ab85ece8445b09` |

fresh boundary는 UTC2026-10-01T15:23:20.2925029Z에 실제 확인했다. BBB clean before/after·Hwp0 before/after·
HKCU32/64 예제 등록값 부재·module 불변·artifact/tool54개 hash/bytes·join 원본5개/보관5개의 byte 일치를 확인했다.
그 뒤 제품 편집 상태로 이 clean 관측을 확대하지 않는다. TCP는 UNKNOWN이며 native network gate가 아니다.

세 layout 자식의 대조 성공은 Madi가 채택할 좁은 writer/validator profile의 근거다. 모든 HWPX에서 각각 필수인
공식 XSD 조항이라는 주장은 하지 않는다. 새 compiled exporter의 native 출력, 전체 표시 coverage, HWP conversion/reopen,
5회·no-clobber·취소/timeout/종료·network·사람의 layout/IME 승인까지 통과한 것으로 해석하지 않는다.
HWP는 계속 disabled이며 새 제품 commit은 exact Windows gate 전까지 implementation-only다.

## 13. 2026-10-02 compiled source5347 tiny native TEXT

정확한 source는 clean `534756060e8f56ec2f58c307004013cde592ada3`다. 새 debug HWPX exporter와 기존
source5151 packaged core/main wrapper로 동일한 합성 원고에서 출력2개를 만들었다. 각각4650bytes,
SHA `157f90aaede4f92f1e4332dca8eeb77e5b0a07b756bde457012742cf79bed619`이며 ZIP9/XML8·CRC·
결정성·오류/누락/fallback0과 원고 불변을 확인했다. IR body4블록/18자, 표시5문단/44 scalar/52 UTF-8 bytes다.
혼합 backend 준비 경로이며 전체 source5347 package 검증이라고 표현하지 않는다.

`hancom-compiled-tiny-text-5347560-run1` 실제 native 시험은12.621초/exit0다. Exact PID/birth/image/job/private
HWND·captured/current Active Count1·FullName·nonempty/unmodified를 확인한 후 TEXT를 읽었다.
Leading empty carrier를 포함한5문단의 길이는 `[0,12,7,7,18]`이며 기대 문단과 전체 문자 순서가 일치했다.
TEXT는52 UTF-16/52 scalar/60 UTF-8 bytes, CRLF4·lone CR/LF0·trailing separator 없음이다.
본문은 로그나 evidence에 저장하지 않고 counts와 hashes만 남겼다.

| 근거 | SHA-256 |
| --- | --- |
| tiny exporter preparation receipt | `70300ae7447c351771d916c43f3f6efa735685d0c6dea3dc17295f7aec53e15d` |
| native raw receipt | `bb139d14ba50919c523fa3c90f0af96d7ee7b7ace49d0b3fd439911e121af052` |
| byte-exact actual join | `4ad64044677376177e4f816dc2c7890fdb00935bf34ff181a01cb3a3e388d669` |
| native TEXT SHA | `888a81677e2415c65d30404b466d84840b1286078dbd8e9cc997461522f480d4` |
| length-framed paragraph sequence SHA | `15bc71456c579d78facbec3017a568347f6e971200b6da4f4c12480ccad9ab71` |
| fresh postguard receipt | `0d5304dc28d6af2eab85469b6c00b3b4a9d7e67b013e65ae09c20f36200209f3` |

Close BOOL true와 전후 guard→Quit→native exit를 통과했고 outer job31/active0·강제 종료 없음·handles/desktop
정리를 확인했다. Input23표본은 Default/비활성·unknown0이었다. Fresh postguard에서 Hwp0·양쪽 HKCU view의
예제 등록값 부재·module/input 불변과 원본/보관30파일의 hash/bytes를 확인했다.
이 호출에서는 Module registration·Automation Open/SaveAs·HWP conversion/reopen을 실행하지 않았다.
TCP는 UNKNOWN이며 전체 원고·layout·5회·취소/timeout·network나 사람의 acceptance를 통과한 것은 아니다.

Source5347의 별도 full Windows gate는 fresh scale graph reopen에서 FAIL했으므로 compiled tiny TEXT의
좁은 PASS를 전체 GO로 이전하지 않는다. HWP는 disabled이며 소유권/취소 수정안은 제품 미반영이다.

## 14. 2026-10-02 HWPX 전체 TEXT와 HWP 네트워크 gate

현재 HWPX 제품의 개발판·fresh-unpacked Windows 판정은 clean source
`e2cb07e44e73fd0f43db61090374a762ad1103f0`의 full 실제 PASS6027.338초에 한정한
**TECHNICAL GO — HWPX / PRIVATE LOCAL ONLY**다. 상세 근거는
[Phase 1H section33](PHASE_1H_RESULT.md#33-2026-10-02-exact-sourcee2-full-windows-hwpx-actual)를 따른다.
아래 native TEXT 대조와 실패한 HWP 시험은 별도 revision의 기록이며 서로 합쳐 전체 성공으로 표현하지 않는다.

### HWPX 전체 표시 문단 판독

일반18만자·장편67.5만자 HWPX의 producer는 source
`20e8f3a970d321152940db47e26f9252b4524f26`의 fresh packaged backend다. 실제 한컴 판독의
clean source는 `f464e5f7c8c4e76e9fdc6995b6586afceacfe057`이며 독립 owned inspection host를 사용했다.
원래 합성 fixture·Publication IR에서 만든 전체 표시 문단 배열과 native TEXT의 문자 순서를 대조했다.

| 실제 대조 | 일반 | 장편 |
| --- | --- | --- |
| 표시 문단 전체 | 324/324 일치 | 2412/2412 일치 |
| 길이 framing을 적용한 문단 sequence SHA-256 | `204b7be98ae1b20ce8f3838fd4302490c5e2821d5d616f8810823710f1f72426` | `e1b1c16117ef6a88281c45ffefe0fa78cd7dad5139d9637ec7a36a3375d663e3` |
| outer 실제 결과 | PASS12.747초/exit0 | PASS12.664초/exit0 |
| backend producer receipt SHA-256 | `b2bd50b39677a213324ba19dbbaa08101fd9f9ba315968c295132edc3a26933d` | `f74aea2b656682a614cb3a785f4eb2167d5d14a1aca73550de73f579e431cb24` |
| native receipt SHA-256 | `490c91e7c3ed41375b940ad5bee49b2b099125e95b49176f7b57ee64357f1e97` | `1522a683ad3b6bfebb9421d78a0b5009a3285cc42013c93c6bdabb66d39aa72d` |

Native receipts는 `.tools/verification/hwp-content-inspection-host-080f41bc-3da4-468b-862d-1ace4af6d9ee/runs/`의
`255ebd0a-b7e6-4540-a61b-75c5678af9fe/receipt.json`과
`d4afc9b6-90c0-49bd-b9da-58ab5b60bbc6/receipt.json`이다. Outer metadata는 각각
`.tools/verification/normal-hwpx-native-f464-run3/metadata.json`과
`.tools/verification/long-hwpx-native-f464-run1/metadata.json`이다.

양쪽 모두 exact PID/birth/image/job/private 창·현재 문서 FullName·nonempty/unmodified를 확인하고
Close BOOL true·전후 guard→Quit→native exit를 통과했다. 소유 job0·강제 정리 없음·Hwp0·양쪽 HKCU view의
예제 등록값 부재·fixture/module 불변을 확인했다. Native report의 `nativeTextStored=false`는
그 report가 native TEXT 원문을 저장하지 않았다는 범위이며, 내용이 들어 있는 합성 fixture·oracle의 저장과 구분한다.
TCP 표본은 모두0이지만 `networkBoundaryAcceptance=false`·`canonicalCoverageAcceptance=false`를 유지한다. HWPX TEXT만 확인했으며
HWP 변환·새 HWP 재열기·장편5회·취소/timeout·layout·사람의 acceptance를 통과한 근거가 아니다.
이전 share 위반·receipt 작성 실패·강제 정리 실행은 각각의 FAIL로 보존한다.

### 승인된 HWP 시험의 실제 네트워크 실패

Clean source `90fe3f93378e401eb309082a74d34f6dd692ab22`의 승인된 tiny 시험은
`approved-tiny-90fe3f9-run1`에서 **COMMAND_FAILED/exit1/5.721초**였다. 소유 한컴의 retained identity를
전후 확인한 TCP 표본에서 CONNECTED/PUBLIC peer1을 관측해 `OWNED_TCP_NOT_ZERO_OR_UNAVAILABLE`로 중단했다.
Bridge terminal은 `null`이며 반환 종류·HWP 출력/재열기·내용·no-clobber·5회·취소/timeout의 성공을 주장하지 않는다.

Inner 소유 job에는 `forcedOwnedJob=true`와 `OWNED_JOB_COUNT_LIFECYCLE_UNPROVEN` 정리 실패가 남았다.
이후 job active0·Hwp0는 강제 정리 뒤의 결과다. Outer launcher의 `jobTerminationUsed=false`를
inner 자연 종료 증거로 바꾸지 않는다. 등록 원복·module/input 불변과 clean source 전후를 확인했으며,
별도 exact-value external postguard는 `EXACT_MODULE_RESTORATION_CONFIRMED`와 Registry32/64 모두 absent를 확인했다.

| 보존 근거 | SHA-256 |
| --- | --- |
| `.tools/verification/approved-tiny-90fe3f9-run1/metadata.json` | `dee7301b82a019935e36bdd522f6d8834cda0a0a734d4c5f0a8c852ee71a981b` |
| `.tools/verification/hwp-approved-trial-staging-5347560/runs/01186e15-297c-4f66-ba39-f2e2590d59e6/receipt.json` | `81b57842c2a2203f43a34d6a958246ee82a7b7e91f9ae76ab18b23335eec460c` |
| `.tools/verification/hwp-approved-trial-staging-5347560/postguards/d8297eee-ac6b-4cf0-b8ad-05ddf7069a51/receipt.json` | `7f404514c0972525f5dfa7fbfffe6cc5414a082ddcc8f1a31f3f20cbc21c51e0` |

선택적 HWP는 **WITHHELD / NETWORK FAIL / DISABLED**를 유지한다. 원본 module 일시 등록과 합성 로컬 시험의
승인은 네트워크 실패·변환 성공·layout/라이선스 acceptance의 승인이 아니다. 최종 e2의 HWPX UI
`REGISTERED_UNVERIFIED`는 보안 미검증/disabled 표시 계약이며 현재 registry 등록이나 DLL 수용을 입증하지 않는다.
Registry 원복 근거는 위 postguard와 구분한다. Native IME·한컴 layout/라이선스·public/paid/customer/installer
배포 승인은 사람이 결정하며, 이 private-local 기술 결과에서 추론하지 않는다.
