# madi 개발 계획

갱신일: 2026-10-02. 작업 위치: `main`.
이 문서는 현재 목표·진척·완료 조건을 관리하는 유일한 실행 계획이다.

**작업 재개:** 사용자가 재부팅을 위해 중지한 뒤 계속 진행을 요청했다. 실제 재부팅 여부는 독립 확인하지 않았다.
현재 host·등록·도구 identity를 새로 확인했다. HWPX 구역 설정을 수정한 source5347의 관련21개 테스트와
compiled tiny 출력의 native TEXT 5문단 일치·정상 종료는 통과했다. 그러나 전체 Windows gate는 새 배포본의
장편 World Graph 재열기에서 실패했다. 같은 배포본의 집중5회는 모두 통과했으며 원래 실패 원인은 미확정이다.
IPv6 수집 누락을 실제 대조로 확인해 검증 명령과 회귀 검사를 수정했다. 다음 exact source의 전체 gate를 다시 실행한다.

## 현재 판정

**현재 계획은 미완료다.** 기존 source5151의 전체 자동 검증·로컬 ZIP은 보존한다. 후속 제품 source
`534756060e8f56ec2f58c307004013cde592ada3`의 전체 검증은 FAIL이며 현행 제품 판정은 WITHHELD다.
HWP 변환·재열기와 전체 native 내용·layout 검증, 사람의 Native IME 확인이 남아 있다.
서로 다른 source의 부분 성공을 합쳐 현행 전체 통과로 표현하지 않는다.

| 항목 | 상태와 완료 근거 |
| --- | --- |
| 필수 Windows 검증 | **현재 WITHHELD**. source5151의 전체 PASS 보존. source5347 frozen install·개발판 basic/D/E/F/G/H·unpacked·새 배포본 basic은 통과했으나 별도 장편 graph reopen에서 full FAIL. Fresh E/F/G/H는 미실행 |
| EPUBCheck/JRE | **COMPLETE**. 고정 오프라인 bundle364파일과 manifest 포함. 앱의 실제 Java 검사·UI 취소·검사 중 종료·출력 보호·runtime 외부 요청0 확인 |
| EPUB·HWPX 내부 경로 | **source5151 PRIVATE LOCAL TECHNICAL GO** 보존. 새 source5347 개발판은 통과했으나 fresh 전체 판정은 대기. Compiled tiny HWPX의 결정성·ZIP/XML와 native 5문단 TEXT 일치만 별도 확인 |
| 같은 source의 AI 실증 | **PASS WITH DIAGNOSTIC WARNING**. 임시 로컬 모델로 양쪽 실제 요청·검토/복사·단일 블록 적용·Undo/Redo·저장/reopen 확인. 진단 지정 응답 불일치 경고 보존 |
| 실행용 ZIP | **COMPLETE**. 검증한561파일/81폴더/549,528,995bytes와 ZIP 전체 내용 hash 일치, 새 폴더 압축 해제 대조 통과 |
| 수동 시험 준비물 | **PREPARED / NOT TESTED**. 한글5,000자·IME15항목·한컴 결과 template·절차 문서11파일 준비. Native IME와 최종 한컴 검증 결과는 미완료 |
| IME 보고서 경로 | **REPORT EXPORT/RESTART PASS ONLY**. 같은 source의 배포본에서 JSON/Markdown 저장·재실행 후 보존 확인. 입력15항목은 모두 NOT TESTED |
| 실제 한컴 시험 | **COMPILED TINY TEXT PASS / HWP DISABLED**. source5347 exporter 출력의 native 5문단·44 표시 문자 일치, Close BOOL·Quit·native exit 확인. HWP SaveAs·재열기·전체 원고는 미검증 |
| HWP 소유권·취소 수정안 | **PREPARED / MOCK PASS ONLY**. 별도 사본의 C#24개·앱 client27개·RPC 오류분류16개 시험 통과. 제품에는 미반영. 기본 Windows gate 후 승인된 실제 변환으로 검증 |

기존 전체 Windows run은 `full-verify-5151f6a-run1`이며 exit0·5256.600초다.
소유 job cleanup active0·강제 종료 없음·handle/desktop 정리를 확인했다.
검사 desktop은10285회 모두 비활성이었지만 input 이름36회 판독 불가/error5로
`inputDefaultEverySample=null`을 보존한다. 모든 입력 표본이 Default였다고 주장하지 않는다.
상세 실행·실패/수정 이력·source/package/ZIP 연결은 [오프라인 runtime·배포 준비 결과](docs/OFFLINE_RUNTIME_RELEASE_RESULT.md)에 있다.

새 `full-verify-5347560-run1`은 exit1·5830.138초다. Cleanup active1의 소유 job 강제 정리를 사용했고
최종 job empty·handles/desktop 정리를 기록했다. Input11382표본은 모두 Default/비활성·unknown0이다.
집중 graph5회의 PASS는 이 전체 실패를 대체하지 않는다. 기존 G/H TCP 관측은 IPv4 범위였으며
IPv6 포함 수정과 실제 loopback 회귀 성공을 새 exact source의 runtime network GO로 이전하지 않는다.

## 제품 범위

madi는 한국어 장편소설의 기획·집필·설정 관리·읽기 검토·출판을 위한 로컬 Windows 작업실이다.
작품의 canonical manuscript는 하나의 `.madi` 파일에 저장한다.

| 영역 | 구현 범위 |
| --- | --- |
| 집필 | 작품·권·화·장면 Binder, 장면 편집, 연속 원고, 검색·치환 |
| 저장·복구 | 자동저장, revision 검사, 일관된 백업, named snapshot, 독립 텍스트 추출 |
| 설정 관리 | Story Bible, 명시적 관계·장면 연결, 본문 언급 후보 |
| 기획 | 읽기 전용 World Graph, 독립 Plot Canvas |
| 읽기 검토 | Publication IR 기반 Reader Lab, 독서 설정 비교, 원고 위치 이동 |
| 출판 | Publication IR 기반 EPUB·HWPX, 수동 승인 조건이 있는 선택적 HWP bridge |
| AI 보조 | 사용자 제공자·키와 요청별 범위 동의, 일반 제안 검토·복사, 정확한 단일 블록 선택 수정 |

Publication IR은 Reader Lab과 출판 exporter의 유일한 원고 입력이다. Typie 타입은 Madi 소유 editor adapter에 둔다.
생성 파일·report·cache·UI 상태는 원고와 분리한다. AI mutation은 exact same-block selection만 허용한다.
새 제품 phase나 큰 구조 변경은 별도 범위 결정 후 시작한다.

## 실행 파일과 준비물

- 현재 재검증 대상 실행 파일: `output/madi-win32-x64/madi.exe` (source5347 full 실패 실행에서 만든 unpacked).
- ZIP: `output/releases/madi-0.0.1-win32-x64-5151f6a804cf1565a09211ea8f7a11e9f547fd34/`의 ZIP·README·manifest·SHA256SUMS.
- 수동 kit: `output/releases/manual-validation/5151f6a-036f0b13-b04c-45e8-88b6-d153534d7a8e/`.

ZIP을 새 쓰기 가능한 폴더에 풀고 `madi.exe`를 실행한다. 작품 `.madi`와 앱 user-data는 실행 폴더와 별도다.
ZIP을 포장할 때 전체 gate에서 검증한 배포본을 재빌드하지 않았다. Packaging HEAD 자체가 compiled-source 증명은 아니므로
full package receipt·source archive·whole inventory·ZIP byte join을 함께 보관했다.
이 실증은 현재 컴퓨터의 개발판/새 배포본 경로이며 다른 깨끗한 PC의 설치 성공을 주장하지 않는다.

## 사람에게 남는 검증과 배포 조건

| 항목 | 현재 상태와 완료 조건 |
| --- | --- |
| Windows native Korean IME | **MANUAL VALIDATION PENDING**. 사람이 [체크리스트](docs/MANUAL_KOREAN_IME_CHECKLIST.md)15항목과 실제 환경을 기록 |
| 실제 HWP 변환 | **DISABLED / ACTUAL CONVERSION PENDING**. 임시 모듈·합성 로컬 시험은 승인됨. Compiled tiny HWPX 내용 판독은 통과했지만 bridge conversion/reopen·전체 내용·반복·취소·정리·network는 미완료. 영구 등록·공개 배포·최종 layout 승인 없음 |
| Typie 배포 범위 | 개발 permission은 owner-confirmed. 공개 배포 전 저장소 밖 실제 grant 범위를 소유자가 확인 |
| 공개 배포 | ZIP은 private-local 실행 자료다. Signing·installer·자동 update·공개/유료/고객 배포 승인 완료로 해석하지 않음 |

## 현재 이어갈 작업

이전 구조 대조·실패·재시험과 compiled tiny TEXT 근거는
[한컴 검증 기록](docs/HANCOM_AUTOMATION_VALIDATION.md#10-2026-10-01-resumed-native-controls)에 보존한다.
현행 작업 순서와 완료 조건은 다음과 같다.

1. **진행 중 — 기본 Windows gate 복구.** 장편 graph reopen의 실패 조건을 본문·ID·경로 없이 기록하도록
   검증을 보완하고 IPv4/IPv6 실제 수집 회귀를 전체 verify에 포함한다. 현행 exact source의 frozen install·
   verify·unpacked·repository·format·diff와 development/fresh 경로를 실제 통과해야 다음 제품 수정을 적용한다.
2. **준비됨 — HWP bridge 소유권·취소 수정.** 기본 gate 통과 뒤 별도 사본에서 검증한 수정안을 적용한다.
   unchecked COM activation을 제거하고 소유 process·문서·native exit, 취소/commit 경합과 cleanup 오류를 묶는다.
   적용한 exact source의 빌드·관련 실제 시험을 다시 실행한다.
3. **대기 — 승인된 실제 HWP 검증.** 원본 예제 모듈만 임시 등록하고 합성 tiny conversion→fresh reopen→
   no-clobber부터 확인한다. 이어 전체 표시 내용·장편5회·취소/timeout/종료·IPv4/IPv6 network와 등록 원복을 검증한다.
   Outer job 중단 뒤에도 정확한 등록값의 postguard/원복을 확인한다. 완료 전 HWP는 disabled다.
4. **대기 — 최종 source 연결.** 최종 제품의 전체 pinned Windows gate와 dev/fresh AI를 실행하고,
   실제 검증한 unpacked 전체 inventory·ZIP·새 압축 해제본을 바이트로 연결한다. 검증 후 포장 전에 재빌드하지 않는다.
   IME report/수동 kit도 최종 배포본에 연결한다.
5. **사람의 확인 필요 — Native IME15항목·한컴 layout/라이선스.** 실제 환경과 결과를 사람이 기록한다.
   화면·키보드 사용 승인 전에는 입력 시험을 진행하지 않으며 private-local 기술 성공을 공개 배포 승인으로 바꾸지 않는다.

기존 승인은 원본 unsigned module의 일시 등록·합성 로컬 시험이다. 예전 PID18872 특정 종료 승인을
다른 process에 확대하지 않는다. 다른 registry namespace나 소유권이 불명확한 새 COM activation으로 우회하지 않는다.

AI 실증은 keyless loopback·합성 단일 블록 전체 선택·clipboard API interception 범위다.
Remote HTTPS·인증키·OS clipboard·사람의 native IME 실증으로 확대하지 않는다.
AI의 종료 전 main fetch/renderer 관측은 G/H의 owned TCP·종료 감사와 구분한다.

## 실행과 갱신 규칙

AGENTS.md의 필수 명령을 고정 pnpm workspace에서 실행한다.
이번 unpacked·repository·format은 전체 verify 안의 실제 실행도 근거로 연결하며 별도 시간을 만들지 않는다.
최종 문서 변경 뒤에는 repository·format·diff 검사를 실제 실행한다.

```powershell
pnpm install --frozen-lockfile
pnpm verify
pnpm package:unpacked
pnpm check:repository
pnpm format:check
git diff --check
```

`.tools/run-pinned.ps1`과 Node26.3.1/pnpm11.9.0/Rust1.97.1/.NET10.0.400, MSVC·Windows SDK·x86 runtime을 사용한다.
Rust jobs1·Vitest workers2, command process 한정 `CARGO_INCREMENTAL=0`, .NET CLI `--disable-build-servers`를 유지했다.
Actual은 소유 비활성 Win32 desktop·GPU 비활성화 환경에서 한 번에 하나씩 실행했으며 화면/포커스를 전환하지 않았다.
성능은 이 환경의 관측값이다. 입력 unknown·실패·cleanup을 관측대로 남기고 다른 source의 부분 성공을 합치지 않는다.
명시적으로 호출한 사용자 소유 LLM 요청 외 external runtime request는0이어야 한다.
원고·prompt·응답·키·private path를 로그나 공개 evidence에 남기지 않는다.

## 계약과 결과 문서

AGENTS.md는 작업·검증 규칙, scope·architecture·format·ADR은 상세 계약을 관리한다.
과거 source51/660 및 이번 후보의 상세 이력·수치는 결과 문서와 Git history에 보존한다.

- 집필·복구·설정: [1A](docs/PHASE_1A_RESULT.md), [1B](docs/PHASE_1B_RESULT.md), [1C](docs/PHASE_1C_RESULT.md).
- 기획·읽기·EPUB: [1D](docs/PHASE_1D_RESULT.md), [1E](docs/PHASE_1E_RESULT.md), [1F](docs/PHASE_1F_RESULT.md), [1G](docs/PHASE_1G_RESULT.md), [EPUB 성능](docs/EPUB_EXPORT_PERFORMANCE.md).
- 출판·AI: [1H](docs/PHASE_1H_RESULT.md), [HWPX 성능](docs/HWPX_EXPORT_PERFORMANCE.md), [1I](docs/PHASE_1I_RESULT.md), [I 범위](docs/PHASE_1I_SCOPE.md).
- Runtime·배포 준비: [실제 결과](docs/OFFLINE_RUNTIME_RELEASE_RESULT.md).
- 고정 editor: [Typie pin·patch](docs/TYPIE_PINNING_AND_PATCHES.md), [license 상태](docs/TYPIE_LICENSE_STATUS.md).
