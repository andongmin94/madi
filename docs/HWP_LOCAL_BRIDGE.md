# Optional Local HWP Bridge

기준일: 2026-08-13

## 1. 결정

Madi는 Phase 1H에서 binary HWP를 직접 생성하지 않는다. Publication IR에서 완성·검증한
HWPX를 먼저 만들고, 로컬 Windows에 설치된 한컴오피스를 안전하게 사용할 수 있을 때만
별도 C# sidecar가 HWP로 변환한다. 자세한 이유는 [ADR-0010](./decisions/ADR-0010-hwp-output-uses-local-hancom-conversion.md)에 있다.

## 2. Deployment

Sidecar는 `net10.0-windows`, `win-x86` framework-dependent executable이다. Repository
`global.json`은 SDK 10.0.400을 고정한다. Unpacked package에는 다음 Madi 산출물만 있다.

```text
resources/bin/hwp-bridge/madi-hwp-bridge.exe
resources/bin/hwp-bridge/madi-hwp-bridge.dll
resources/bin/hwp-bridge/madi-hwp-bridge.deps.json
resources/bin/hwp-bridge/madi-hwp-bridge.runtimeconfig.json
```

Compatible x86 .NET 10 runtime이 로컬에 필요하다. 현재 SDK cache에 win-x86 self-contained
runtime pack이 없고 외부 download를 허용하지 않았으므로 runtime을 억지로 bundle하지 않는다.
한컴 executable/DLL/type library/security module도 복사하지 않는다.

## 3. Closed JSONL protocol

| Command | 입력 | 성공 결과 |
|---|---|---|
| `probe` | request ID, timeout | availability code, optional version |
| `convert` | absolute HWPX/HWP path, overwrite=false, timeout | output path, bytes, SHA-256, version |
| `reopen-verify` | absolute HWP path, timeout | verified=true, version |
| `cancel` | request ID와 target request ID | targeted cancellation acknowledgement |

Unknown/duplicate field, invalid request ID/control character, relative/wrong-extension path와
timeout 범위 밖 값은 거부한다. Renderer는 이 protocol을 직접 보내거나 executable/path를
고르지 못한다.

## 4. Capability probe

win-x86 probe는 `RegistryHive.ClassesRoot`의 명시적 32-bit view에서
`HWPFrame.HwpObject.2\CLSID`와 해당 `CLSID\...\LocalServer32` 등록 문자열을 읽고,
32-bit process의 current-user view에서 `FilePathCheckerModuleExample` 등록 문자열을 읽는다.
CLSID가 GUID이고 두 등록 문자열이 비어 있지 않은지만 분류한다. `File`/`Path` API,
filesystem regular-file, executable/DLL signature·version, module load를 검사하지 않으며
COM/Automation object도 만들지 않는다. 따라서 probe의 `hancomVersion`은 항상 `null`이다.

주요 availability 의미:

- `NOT_INSTALLED`: 32-bit ProgID/CLSID/LocalServer32 등록 문자열이 없거나 유효하지 않음.
  한컴 executable이 disk에 없다는 filesystem 판정은 아니다.
- `SECURITY_MODULE_REQUIRED`: current-user security-module 등록 문자열이 없음
- `REGISTERED_UNVERIFIED`: 필요한 registry 문자열은 있지만 executable/DLL file, path,
  version, module loading, Automation 소유권과 변환 안전성은 검증하지 않음

현재 UI는 `REGISTERED_UNVERIFIED`에서 HWP를 선택할 수 없다. 실제 사용자 문서 무변경,
전용 window/process 소유권, timeout/cancel 정리와 reopen 내용 검증을 별도 수동 gate로
통과하기 전에는 `AVAILABLE`을 만들거나 conversion PASS라고 표시하지 않는다.

## 5. Conversion transaction

1. Existing regular `.hwpx` input와 absolute `.hwp` output 검증
2. Output no-clobber 확인
3. Automation capability 확인
4. 같은 output directory의 operation-owned temporary HWP 생성
5. `Open(input, "HWPX", ...)`
6. `SaveAs(temp, "HWP", ...)`
7. owned document close, temp bytes/hash 검사
8. atomic commit
9. 별도 `reopen-verify`에서 `Open(output, "HWP", ...)`

Failure/timeout/cancel이면 temp만 지우고 source HWPX와 기존 HWP는 보존한다. Broad process
enumeration/kill을 하지 않고 자신이 만든 Automation object와 captured window/document만
닫는다.

## 6. Timeout caveat

COM 호출 자체는 cooperative cancellation을 항상 보장하지 않는다. Service는 bounded
response를 반환하고 worker cancellation을 요청하지만 사용자 한글 process 전체를 강제
종료하지 않는다. Unattended distribution 전에 supported Hancom version별 prompt/hang,
owned-window cleanup과 repeated conversion을 실제 검증해야 한다.

## 7. Current machine

```text
Independent host inventory, not probe: Hancom Office 2022 / hwp.exe 12.0.0.4170 observed
32-bit registry presence-only probe: REGISTERED_UNVERIFIED
Probe hancomVersion: null
Probe file/path/regular-file/signature/version validation: NOT PERFORMED
COM activation/open/save: NOT RUN
HWP conversion/reopen: MANUAL VALIDATION PENDING
```

Presence-only registry 분류는 security-module DLL이나 Automation 안전성을 증명하지 않는다.
위험한 승인 prompt/hang을 피하기 위해 실제 COM object를 활성화하지 않았다.

## 8. Licensing

한컴 공식 Automation 안내는 상업 목적 solution/application에 별도 승인/license가
필요하다고 설명한다. 기술적 작동과 배포 권리는 별개다.

```text
HANCOM AUTOMATION LICENSE REVIEW REQUIRED BEFORE DISTRIBUTION
```

Madi package에 한컴 code를 포함하지 않는다는 사실도 Automation 사용 조건을 자동으로
해결하지 않는다.
