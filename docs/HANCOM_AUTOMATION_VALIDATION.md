# Hancom Automation Validation

기준일: 2026-08-13. 후속 갱신일: 2026-10-01.
Sections1–8은 기준일의 기록이다. 최초 실제 시험은 section9, 재개 후 대조와 현재 한계는 section10을 따른다.

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
제품·배포본·ZIP은 source5151 그대로이며 기존 full5256.600초 PASS를 CCD의 전체 gate 실행으로 옮기지 않는다.

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
