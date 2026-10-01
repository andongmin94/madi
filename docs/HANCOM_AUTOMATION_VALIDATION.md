# Hancom Automation Validation

기준일: 2026-08-13. 후속 갱신일: 2026-10-01.
Sections1–8은 기준일의 기록이다. 현재 host·승인·actual 실패는 section9를 따른다.

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

실행 HEAD는 clean `ad7fb613668128a740f683ca8e51fa6624e0e3ae`이며 제품 source·배포본은
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

Prelaunch는 Hwp0부터 시작해 verified executable의 `-Automation -Embedding`을 inactive Win32 desktop의
소유 nested job에서 실행했다. PID/birth/image hash/job과 실제 window-owner thread desktop을 확인했다.
GetThreadDesktop NULL/error0인 worker thread는 unknown으로 보존했으며 전체 native thread 판독 성공으로 쓰지 않았다.
Open 진단의 HWND와 COM object 직접 binding은 하지 않았다. 독점 process/GUI 관측 범위다.
시험 desktop은 비활성이고 입력 이름 관측은 Default였으며 화면 전환·활성화·입력·보안 prompt 승인·global kill은 호출하지 않았다.
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
