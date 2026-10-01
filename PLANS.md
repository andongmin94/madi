# madi 개발 계획

갱신일: 2026-10-01. 작업 위치: `main`.
기존 제품 기능은 source660의 자동 Windows 검증을 완료했다. 현재는 남은 배포 준비와 수동 검증용 자료를 진행한다.
이 문서는 현재 목표·완료 상태·다음 작업을 관리하는 유일한 실행 계획이다.

## 현재 작업

사용자가 남은 항목의 진행을 요청했다. 작업 시작 HEAD는 `94c7361e2160229397724242d9bb99a82a999c11`이며,
그 커밋은 검증 source660과 문서4개만 다르다. 아래 새 제품 변경은 source660의 PASS를 그대로 이전하지 않는다.

| 순서 | 작업 | 완료 조건과 상태 |
| --- | --- | --- |
| 1 | EPUBCheck/JRE 오프라인 runtime bundle | `495f2ed` bundle·`bd62ec9` 앱 연결 구현. Full tree364파일 대조·관련91테스트·실제 client VALID/INVALID/취소 PASS. 새 앱 gate는 **PENDING** |
| 2 | 배포용 파일과 수동 시험 준비 | Portable ZIP 생성기 focused7/7·미검증 IME15항목/한글5,000자 kit 준비. 새 source의 실제 배포 ZIP 생성은 **PENDING**. 설치·공개 배포는 별도 |
| 3 | 수정 후 exact Windows gate | **PENDING**. `4c47ec4` 집중 G 개발판 PASS·Java 시작 대기31.9초 확인. 단독 unpacked 명령exit0 후 격리 정리FAIL은 보존. 영구 build server를 사용하지 않도록 수정한 같은 source의 새 배포본·전체 gate를 재실행 |

공개 배포를 위한 소유자 권한·실제 서명 인증서와 한컴 보안 모듈 승인·사람의 IME 검증은 자동 완료로 바꾸지 않는다.

`a54f1e5` 실패는 `normal-export-cancel`의 `phase1g-cancel-enabled timed out`이다.
Java 시작 전 원고 생성·bundle364파일 hash 검증을 포함하므로 시작 대기에 기존 전체 작업 제한240초를 적용하고,
실제 시작 대기시간과 고정 enum/count/bool 진단을 남긴다. 실제 Java 실행·UI 취소·close/drain·출력 부재 조건과
장편 성능5회 gate는 유지한다. `4c47ec4` 집중 G 개발판은874.752초/exit0이며 Java 시작31,885.86ms와
실제 취소·검사 중 앱 종료·native TCP0·정리0를 확인했다. 이 집중 성공을 전체 PASS로 이전하지 않는다.
실패 run2359.074초·exit1·source clean·job cleanup0를 보존하며 input unavailable2회/error5도 숨기지 않는다.
`4c47ec4` 단독 package run1은 빌드 명령exit0이나35.094초 뒤 owned job active2·강제 정리·desktop 잔존으로
host125/CLEANUP_FAILED다. 고정 .NET10 CLI의 `--disable-build-servers`를 build/publish/run에 적용하고
다른 사용자 build server 종료나 전역 환경 설정 없이 다시 검증한다.

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
생성 파일·report·cache·UI 상태는 원고와 분리한다. 일반 AI 검토·복사는 원고를 바꾸지 않으며 mutation은 exact same-block selection만 허용한다.
새 기능이나 큰 구조 변경을 현재 범위에 추가하지 않는다.

## 완료 상태

실제 검증 source는 `660814c7745a5231038aba902fd7113022778238`이다.
`36cbf72`의 World Graph viewport 경합 수정과 이전 저장·출판·종료 경합 수정을 포함한다.
최종 문서 갱신 커밋은 이 검증 source와 구분한다. 문서만 변경한 HEAD에서 전체 actual을 다시 실행했다고 표현하지 않는다.

| 항목 | 판정과 실제 근거 |
| --- | --- |
| 필수 6명령 | **PASS**. 고정 설치, 전체 verify, 중첩 unpacked build·repository·format 검사, source660의 diff 검사 |
| 전체 Windows actual | **PASS**. `full-verify-660814c-run1`, exit0·5333.110초. Desktop104파일/680테스트, native·WASM·CLI·build·개발판/새 배포본 basic/D/E/F/G/H |
| 관계도 경합 수정 | 회귀 RED→GREEN2·관련21테스트·typecheck PASS. 별도 원본 D 개발판2회/배포본3회와 전체 verify 양쪽 D PASS |
| EPUB·HWPX | 일반·675,000자 원고, 장편5회 exact coverage·ZIP/XML reopen·결정성·취소·no-clobber·종료 PASS. HWPX 개발판 exporter max772ms, 배포본 max79ms; IR·wall은 별도 기록 |
| 같은 source의 실제 AI | 개발판39.787초/배포본38.425초 **PASS WITH DIAGNOSTIC WARNING**. 임시 로컬 모델의 실제 응답·일반 복사 무변이·단일 블록 적용·Undo/Redo·저장/reopen 확인 |
| Phase 1H / Phase 1I | HWPX **TECHNICAL GO — PRIVATE LOCAL**, I aggregate Windows **PASS**. AI는 loopback/keyless 실증 범위이며 진단 지정 문구 불일치 경고를 보존 |
| 소스·패키지·격리 | 시작/끝 source660 clean, package receipt·source archive·선택 inventory101파일/233245115bytes 연결. Full Input Default10401회·비활성 desktop, job2628/cleanup active0·강제 종료 없음·handle/desktop 정리 |

AI 실증의 선택 범위는 합성 단일 블록 전체이며 clipboard는 interception으로 확인했다.
Remote HTTPS·인증키·OS clipboard·사람의 native IME를 실제 검증했다고 주장하지 않는다.
AI network 관측은 종료 전 main fetch·renderer 범위이고 H의 owned TCP 종료 검사와 구분한다.
Source51의 full 두 번 FAIL와 후속 개별 PASS는 과거 실행으로 보존하며 이번 source660의 PASS와 혼합하지 않는다.

## 남은 수동 검증과 배포 조건

| 항목 | 현재 상태와 완료 조건 |
| --- | --- |
| Windows native Korean IME | **MANUAL VALIDATION PENDING**. 사람이 [체크리스트](docs/MANUAL_KOREAN_IME_CHECKLIST.md)를 완료 |
| 실제 HWP 변환 | **MANUAL VALIDATION PENDING / DISABLED**. Hancom security module·Automation 이용조건 승인과 실제 conversion/reopen 검증 |
| Typie 배포 범위 | 개발 permission은 owner-confirmed. 공개 배포 전 저장소 밖 실제 grant 범위를 소유자가 확인 |
| 배포 준비 | 새 runtime·portable actual 검증 진행. 소유자 signing·실제 installer·자동 update·공개 승인과 구분 |

현재 unpacked 실행 파일은 `output/madi-win32-x64/madi.exe`다.
Private-local 기술 성공을 공개·유료·고객·installer 배포 승인으로 표현하지 않는다.
기존 제품 기능의 자동 결과는 위 source660 기록을 따른다. 새 배포 준비 작업은 현재 작업 표에서 별도로 종료한다.
새로운 제품 phase는 별도 범위 결정 후 시작한다.

## 실행과 갱신 규칙

AGENTS.md의 필수 명령은 다음과 같다. 각 실제 exit와 exact source를 기록한다.
이번 `package:unpacked`·repository·format은 `verify` 안의 실행 근거로 연결하며 별도 실행 시간을 만들지 않는다.
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
Rust jobs1·Vitest workers2를 유지한다. 이번 native 명령의 `CARGO_INCREMENTAL=0`은 process 한정이다.
이번 HWPX·AI Electron actual은 비활성 desktop에서 GPU를 비활성화해 실행했으며 성능 수치는 이 환경의 관측값이다.
무거운 실제 검증은 하나씩, 소유한 비활성 Win32 desktop에서 화면 전환 없이 실행한다. Input unknown·cleanup도 관측대로 보존한다.
실패가 확인되면 main의 작은 수정 후 새 후보를 검증한다. 실행 중·부분 성공·과거 후보·acceptance=false 진단을 전체 PASS로 합치지 않는다.
명시적으로 호출한 사용자 소유 LLM 요청 외 external runtime request는 0이어야 한다.
원고·prompt·응답·키·private path를 로그나 공개 evidence에 남기지 않는다.

## 계약과 결과 문서

[AGENTS.md](AGENTS.md)는 작업·검증 규칙, scope·architecture·format·ADR은 상세 계약을 관리한다.
상세 실행 이력과 source별 수치는 기존 결과 문서와 Git history에 보존하고 이 계획에는 현재 상태만 유지한다.

- 집필·복구·설정: [1A](docs/PHASE_1A_RESULT.md), [1B](docs/PHASE_1B_RESULT.md), [1C](docs/PHASE_1C_RESULT.md).
- 기획·읽기·EPUB: [1D](docs/PHASE_1D_RESULT.md), [1E](docs/PHASE_1E_RESULT.md), [1F](docs/PHASE_1F_RESULT.md), [1G](docs/PHASE_1G_RESULT.md).
- 출판·AI: [1H](docs/PHASE_1H_RESULT.md), [HWPX 성능](docs/HWPX_EXPORT_PERFORMANCE.md), [1I](docs/PHASE_1I_RESULT.md), [I 범위](docs/PHASE_1I_SCOPE.md).
- 고정 editor: [Typie pin·patch](docs/TYPIE_PINNING_AND_PATCHES.md), [license 상태](docs/TYPIE_LICENSE_STATUS.md).
