# madi 개발 계획

갱신일: 2026-10-01. 작업 위치: `main`.
이 문서는 현재 목표·진척·완료 조건을 관리하는 유일한 실행 계획이다.

## 현재 판정

사용자가 요청한 기존 제품 범위의 자동 검증과 남은 로컬 배포 준비를 완료했다.
실제 검증 제품 source는 `5151f6a804cf1565a09211ea8f7a11e9f547fd34`다.
후속 문서 갱신 커밋은 이 source와 구분하며, 문서만 바뀐 HEAD에서 전체 actual을 재실행했다고 표현하지 않는다.

| 항목 | 상태와 완료 근거 |
| --- | --- |
| 필수 Windows 검증 | **PASS**. Frozen install·전체 verify·unpacked·repository·format·diff 실제 실행. Desktop105파일/705테스트, native·WASM·CLI·build, 개발판/새 배포본 basic/D/E/F/G/H 통과 |
| EPUBCheck/JRE | **COMPLETE**. 고정 오프라인 bundle364파일과 manifest 포함. 앱의 실제 Java 검사·UI 취소·검사 중 종료·출력 보호·runtime 외부 요청0 확인 |
| EPUB·HWPX | **PRIVATE LOCAL TECHNICAL GO**. 일반·675,000자 원고, 장편5회 exact coverage·ZIP/XML 재열기·결정성·no-clobber·취소·종료 정리 통과 |
| 같은 source의 AI 실증 | **PASS WITH DIAGNOSTIC WARNING**. 임시 로컬 모델로 양쪽 실제 요청·검토/복사·단일 블록 적용·Undo/Redo·저장/reopen 확인. 진단 지정 응답 불일치 경고 보존 |
| 실행용 ZIP | **COMPLETE**. 검증한561파일/81폴더/549,528,995bytes와 ZIP 전체 내용 hash 일치, 새 폴더 압축 해제 대조 통과 |
| 수동 시험 준비물 | **PREPARED / NOT TESTED**. 한글5,000자·IME15항목·한컴 결과 template·절차 문서11파일 준비. 사람의 검사와 승인은 아직 없음 |

전체 Windows run은 `full-verify-5151f6a-run1`이며 exit0·5256.600초다.
소유 job cleanup active0·강제 종료 없음·handle/desktop 정리를 확인했다.
검사 desktop은10285회 모두 비활성이었지만 input 이름36회 판독 불가/error5로
`inputDefaultEverySample=null`을 보존한다. 모든 입력 표본이 Default였다고 주장하지 않는다.
상세 실행·실패/수정 이력·source/package/ZIP 연결은 [오프라인 runtime·배포 준비 결과](docs/OFFLINE_RUNTIME_RELEASE_RESULT.md)에 있다.

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

- 현재 실행 파일: `output/madi-win32-x64/madi.exe`.
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
| 실제 HWP 변환 | **MANUAL VALIDATION PENDING / DISABLED**. Hancom security module·Automation 이용조건 승인과 실제 conversion/reopen 검증 |
| Typie 배포 범위 | 개발 permission은 owner-confirmed. 공개 배포 전 저장소 밖 실제 grant 범위를 소유자가 확인 |
| 공개 배포 | ZIP은 private-local 실행 자료다. Signing·installer·자동 update·공개/유료/고객 배포 승인 완료로 해석하지 않음 |

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
