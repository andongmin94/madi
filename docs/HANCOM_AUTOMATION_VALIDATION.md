# Hancom Automation Validation

기준일: 2026-08-13

## 1. Official basis

- ProgID: `HWPFrame.HwpObject.2`
- HWPX open: `Open(path, "HWPX", "")`
- HWP save: `SaveAs(path, "HWP", "")`
- File path approval: registered `FilePathCheckDLL` module

ProgID/Open/SaveAs와 HWP token은 공식 Automation manual, HWPX token은 한컴 담당자 forum
예에서 확인했다. 이 근거는 unattended prompt 없음이나 commercial license 승인을 뜻하지
않는다. Source links는 [official profile](./HWPX_OFFICIAL_PROFILE_1_31.md)에 고정했다.

## 2. Read-only installation evidence

| Item | Observation |
|---|---|
| Product | 한컴오피스 2022 |
| HWP executable version | `12.0.0.4170` |
| Signature | Valid, HANCOM INC. |
| Registered ProgID | `HWPFrame.HwpObject`, `.1`, `.2` |
| `.2` LocalServer32 | 32-bit `hwp.exe -Automation` |
| Security module registry | key 존재, 등록 value 없음 |
| HWP process before probe | 없음 |

## 3. Executed safe probe

Framework-dependent win-x86 bridge release를 unpacked resources에 복사한 뒤 UTF-8 JSONL
`probe`를 실행했다. 결과는 다음 capability identity였다.

```json
{
  "status": "SUCCESS",
  "available": false,
  "availabilityCode": "SECURITY_MODULE_REQUIRED",
  "hancomVersion": "12.0.0.4170"
}
```

Probe는 security-module gate에서 끝났고 COM object를 만들지 않았다. 따라서 이것은
Automation activation, HWPX open, HWP save 또는 HWP reopen PASS 근거가 아니다.

## 4. Automated mock/contract validation

C# tests는 closed protocol, available/not-installed probe, invalid path/extension, no-clobber,
timeout, targeted cancel, failure preservation, mock conversion commit와 mock reopen 계약을
검사한다. Mock PASS는 실제 한컴 호환성 PASS로 바꾸어 표현하지 않는다.

## 5. Manual/actual matrix

| Gate | Status |
|---|---|
| Registry/file/signature inspection | PASS |
| Packaged x86 bridge starts and parses UTF-8 JSONL | PASS |
| Security module registered and regular DLL | FAIL / missing |
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
Automation safely available: NO — SECURITY_MODULE_REQUIRED
COM activation performed: NO
HWP technical verdict: MANUAL VALIDATION PENDING
Distribution verdict: LICENSE REVIEW REQUIRED
```
