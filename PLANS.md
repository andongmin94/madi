# madi 개발 계획

갱신일: 2026-09-30
인수 분석 기준 커밋: `246b58dda40f83787a8971fd72ecb8cb3f7ddffd`
현재 제품 검증 후보: `472d0fc6b46f3735dd2a8c198aa5e5ab1103ff9f`

이 문서는 madi의 현재 목표, 진척, 작업 순서와 완료 조건을 관리하는 유일한 실행 계획이다.
지금 목표는 기존 제품 범위를 유지하면서 현재 구현의 Windows 검증 기준점을 확보하는 것이다.
이번 계획 정리는 기능 추가나 제품 구조 변경의 완료를 뜻하지 않는다.

## 제품 목표와 유지할 범위

madi는 한국어 장편소설 작가가 기획, 집필, 설정 관리, 읽기 검토와 출판 출력을 수행하는
로컬 Windows 작업실이다. 사용자는 하나의 `.madi` 파일로 작품을 소유한다.

| 작업 | 현재 제품 범위 |
| --- | --- |
| 집필 | 작품·권·화·장면 Binder, 장면 편집, 연속 원고, 검색·치환 |
| 저장과 복구 | 자동저장, revision 검사, 일관된 백업, named snapshot, 텍스트 추출 |
| 설정 관리 | Story Bible, 명시적 관계와 장면 연결, 본문 언급 후보 |
| 기획 | 설정 관계에서 파생하는 읽기 전용 World Graph, 독립적인 Plot Canvas |
| 읽기 검토 | Publication IR 기반 Reader Lab, 독서 설정 비교와 원고 위치 이동 |
| 출판 | Publication IR 기반 EPUB·HWPX, 별도 조건을 갖춘 선택적 HWP 변환 |
| AI 보조 | 사용자 제공자·키, 요청별 범위 동의, 제안 검토, 정확한 단일 블록 선택 수정 |

클라우드·협업·모바일, 새 출판 형식, 그래프 편집, 작품 전체 AI 수정 등은 현재 실행 범위에
추가하지 않는다. 기능 확대와 큰 구조 리팩터링은 현재 검증을 닫고 제품 목표를 정한 뒤
별도 작업으로 정의한다.

## 문서의 역할

| 문서 | 역할 |
| --- | --- |
| 사용자 지시와 [AGENTS.md](AGENTS.md) | 작업 범위, 변경 원칙과 필수 검증 규칙 |
| 이 문서 | 현재 상태, 다음 작업, 완료 조건과 보류 조건 |
| [README.md](README.md) | 기능 소개, 사용법, 개발·실행 명령 |
| `docs/*SCOPE.md`, 아키텍처·형식 문서, `docs/decisions/` | 단계별 범위와 상세 계약·설계 결정 |
| `docs/*RESULT.md`, 성능·감사 문서 | 해당 시점과 코드에 대한 실행 근거·관측 기록 |

과거 결과 문서의 PASS는 현재 커밋의 PASS로 옮기지 않는다. 범위 문서에 남은 다음 단계
추천은 현재 작업 순서로 사용하지 않는다. 문서가 충돌하면 사용자 지시와 AGENTS.md를
우선하고, 아직 해결하지 않은 차이는 아래 검토 항목에 남긴다.

## 현재 진척

구현 확인은 코드가 존재한다는 뜻이다. 과거 검증 기록은 해당 문서의 대상 코드와 환경에
한정한다. 현재 커밋의 제품 검증 완료와 수동·배포 승인은 각각 별도로 판정한다.

| 영역 | 구현 상태 | 검증 상태와 근거 |
| --- | --- | --- |
| 집필·저장·복구 | `472d0fc`에서 실패한 열기의 기존 세션 보존 수정 | 집중 90테스트 통과. [Phase 1A](docs/PHASE_1A_RESULT.md)·[1B](docs/PHASE_1B_RESULT.md)의 과거 실행 기록과 구분 |
| Story Bible | 구현 확인 | [Phase 1C](docs/PHASE_1C_RESULT.md)에 과거 실행 기록 있음 |
| World Graph·Plot Canvas | 구현 확인 | [Phase 1D](docs/PHASE_1D_RESULT.md)·[1E](docs/PHASE_1E_RESULT.md)에 과거 실행 기록과 조건 있음 |
| Publication IR·Reader Lab | 구현 확인 | [Phase 1F](docs/PHASE_1F_RESULT.md)에 과거 실행 기록 있음. [1G](docs/PHASE_1G_RESULT.md)에 Reader 반응시간 조건 해소 기록 있음 |
| EPUB | 구현 확인 | [Phase 1G](docs/PHASE_1G_RESULT.md)의 과거 development·fresh-unpacked 결과 있음. Runtime EPUBCheck/JRE는 배포 전 과제 |
| HWPX | 구현 확인 | [Phase 1H](docs/PHASE_1H_RESULT.md) 최종 판정 `WITHHELD` 유지 |
| HWP | bridge 코드 있음, 제품 변환 경로 비활성 | security module·실제 변환·reopen 수동 검증 대기 |
| 좁은 AI 보조 | `37802a0`에서 exact selection 계약 정정 | [Phase 1I](docs/PHASE_1I_RESULT.md)의 집중 28테스트 통과. 현재 후보 Windows 통합 검증 `PENDING` 유지 |
| Transport·Windows CI 보강 | 후속 커밋 구현 있음 | exact commit Windows 통과 근거 미확보. [품질 감사](docs/CODE_QUALITY_AUDIT.md)와 [Windows workflow](.github/workflows/windows-gate.yml) 참조 |

### 이번 인수에서 확인한 검증 상태

초기 작업 셸의 Node `26.3.0`·pnpm `11.19.0` 불일치로 필수 명령은 설치 준비에서 실패했다.
이후 시스템 PATH를 바꾸지 않고 ignored `.tools/`에 고정 도구를 준비했다. Node `26.3.1`,
pnpm `11.9.0`, Rust `1.97.1`과 두 target, .NET SDK `10.0.400`, x86 runtime `10.0.11`을
실제 버전 출력으로 확인했다. Node·.NET과 EPUBCheck/JRE ZIP은 공식 배포 해시와 대조했다.
로컬 명령은 `.tools/run-pinned.ps1`로 고정 도구를 사용하며 Rust 병렬 빌드는 2개로 제한한다.

제품 수정 전 `dd4e66a7c31536d38fa7142a74827190e7129886`의 제품 소스에서 아래를 실행했다.
동시에 준비한 CI workflow 변경은 제품 실행 근거로 취급하지 않는다.

| 실행 | 실제 결과 |
| --- | --- |
| `pnpm install --frozen-lockfile` | exit 0, Node·pnpm pin과 Electron binary 준비 확인 |
| `pnpm verify`, `pnpm check:repository` | Typie 원본 미초기화 검사에서 exit 1. 원본 URL은 Git과 연결된 GitHub 앱에서 404 |
| `pnpm package:unpacked` | `editor-codec` 원본 manifest 부재로 exit 1. 패키지 생성 미완료 |
| `pnpm build:atomic-output` | MSVC `link.exe` 부재로 exit 1 |
| `pnpm test:typie` | exit 0. 실제 포함된 WASM에서 exact selection·semantic replacement·Undo/Redo 확인 |
| Desktop Vitest, `--maxWorkers 2` | 102파일·642테스트 exit 0. native atomic-output E2E 1파일은 binary 부재로 명시적으로 제외 |
| `pnpm format:check` | exit 0, source·JSON 287파일. 전체 제품 gate를 대신하지 않음 |
| `pnpm build:hwp-bridge`, `pnpm build:hwp-bridge:release` | exit 0 |
| `pnpm test:hwp-bridge` | exit 0, 17/17. mock 계약 및 실제 sidecar probe; 실제 한컴 변환 아님 |
| `git diff --check` | exit 0 |

부분 성공을 전체 Windows baseline의 성공으로 옮기지 않는다. 후속 제품 수정의 검증은 아래
진행 기록과 해당 결과 문서에 별도로 남기며, full gate는 계속 보류한다.

### 현재 후보의 실제 검증

`472d0fc`의 제품 소스에서 고정 도구로 실행한 결과다. 계획·결과 문서 갱신은 제품 소스를
바꾸지 않으며, 아래 결과의 대상 SHA를 새 문서 커밋으로 옮기지 않는다.

| 실행 | 실제 결과 |
| --- | --- |
| `pnpm install --frozen-lockfile` | exit 0, pnpm `11.9.0` |
| `pnpm typecheck`, Desktop build | 모두 exit 0 |
| Desktop Vitest, `--maxWorkers 2` | 설치 후 전체 103파일·661테스트 exit 0, 제외 없음. 실제 native atomic-output process E2E 2테스트 포함 |
| `pnpm build:atomic-output`, `pnpm build:atomic-output:release`, `pnpm test:atomic-output` | 설치 후 모두 exit 0. 실제 Windows 파일 교체·복구·no-clobber 9/9 |
| `pnpm test:typie` | exit 0, 포함된 실제 WASM selection·semantic transaction·Undo/Redo 확인 |
| `pnpm test:hwp-bridge` | exit 0, 17/17. mock 계약과 registry-only sidecar probe; 실제 HWP 변환 없음 |
| `pnpm format:check` | exit 0, 287파일 |
| `pnpm verify`, `pnpm check:repository` | Typie 원본 미초기화로 exit 1. Node·pnpm exact pin 검사 통과 |
| `pnpm package:unpacked` | Typie `editor-codec` manifest 부재로 exit 1. unpacked build 없음 |
| `git diff --check` | exit 0 |

사용자가 관리자 확인창을 허용하여 Microsoft 서명을 확인한 공식 Build Tools를 백그라운드
설치했다. C++ compiler와 Windows SDK `26100`을 갖춘 Build Tools `17.14.37710.0`의 완료
등록을 확인했다. installer exit `3010`은 재부팅 필요 상태이며 자동 재시작은 하지 않았다.
현재 세션에서 native atomic-output debug/release build와 9테스트가 통과했고, 앞서 제외한
native process E2E를 포함한 전체 Desktop Vitest도 통과했다. 재부팅 필요 코드가 해소된
것으로 추정하지 않으며, 전체 제품 gate와 Electron actual 통과를 뜻하지 않는다.
같은 후보의 설치 전 부분 실행은 102파일·659테스트였고, 최종 실행에서 제외를 해소했다.

Typie의 고정 commit은 비어 있는 submodule, 기존 로컬 Git 객체와 캐시에서도 확보하지
못했다. 공식 repository·commit·raw·codeload 접근 모두 404였으며 대체 remote 기록도 없다.
삭제·비공개 여부는 단정하지 않는다. 접근 가능한 원본 URL/권한 또는 정확한 commit 객체가
포함된 기존 checkout·Git bundle 경로가 필요하다. 이 입력 없이는 core·publication·exporter
원본 빌드, full verify와 unpacked package를 진행할 수 없다.

### 사용자 컴퓨터 실행 조건

사용자 작업을 방해하지 않는 백그라운드 명령만 실행한다. 현재 Electron harness는
`ready-to-show`에서 실제 창을 표시하므로 로컬 GUI actual은 실행하지 않았다. 제공된
데스크톱 제어 API에는 가상 데스크톱 2로 창을 보내는 기능이 없다. 화면이 필요한 검증은
별도 Windows runner·세션 또는 사용자 작업과 분리된 실제 실행 환경을 확보한 뒤 진행한다.
native IME 수동 판정과 실제 제공자 전송 동의는 이 조건과 별개로 유지한다.

## 다음 작업과 완료 조건

현재 다음 작업은 **고정 Typie 원본 접근 확보**다. 새 기능이나 큰 구조
리팩터링은 시작하지 않는다. 현재 범위의 좁은 계약 정정과 재현된 저장 안전성 오류는
부분 baseline을 기준으로 수정하되, 그 수정의 최종 Windows 판정도 보류한다.

| 순서 | 작업 | 상태 | 완료 조건 |
| --- | --- | --- | --- |
| 1 | 고정 Windows 검증 환경 준비 | toolchain·MSVC·SDK·ZIP 준비 완료, 원본 대기 | 아래 toolchain, clean Typie checkout, validator ZIP 준비를 확인하고 frozen install이 exit 0 |
| 2 | Windows CI 준비 경로 보완 | `a0c1366` 구현, runner 실행 대기 | 새 runner에서 hash를 검증한 EPUBCheck/JRE를 준비하고 필수 검증 경로를 실행할 수 있음. 원고·키·private path 없는 결과를 exact commit과 연결해 보존 |
| 3 | 변경 전 Windows 기준점 확보 | 부분 검증, full gate 보류 | 기준 commit의 필수 명령과 development·fresh-unpacked actual 통과. 아래 coverage·network·cleanup 조건의 실행 근거 기록 |
| 4 | 현행 범위와 구현 대조 | `37802a0`, `472d0fc` 수정 완료 | AI·IR 계약 정정 및 재현된 실패한 열기 수정. 집중 검증과 최종 읽기 전용 점검 완료; 전체 Windows 판정은 5에서 수행 |
| 5 | 최종 후보 Windows 검증 종료 | 부분 검증, 원본·GUI 환경 대기 | 변경했다면 새 commit의 필수 전체 경로와 actual을 다시 통과. 변경이 없으면 3번의 동일 commit 근거 사용. 최종 후보 SHA·build·결과 일치 확인 |
| 6 | 실제 사용 조건 확인 | 환경·사용자 입력 대기 | 사람이 동일 후보 build의 native IME checklist를 수행하고, 사용자가 지정한 AI endpoint를 명시적 전송 동의 아래 development·unpacked에서 검증 |
| 7 | 다음 개발 작업 선정 | 미정 | 검증 결과와 사용자 제품 목표를 기준으로 작업 하나의 범위·완료 조건을 정의 |

3번의 성공은 변경 전 기준점이다. 이후 변경한 commit에는 그 성공을 이전하지 않는다.
6번에서 수정이 필요하면 새 후보를 만들고 5번의 검증 조건을 다시 충족한다.

### 필요한 환경

- Windows x64, Git, Node `26.3.1`, pnpm `11.9.0`.
- Rust `1.97.1` MSVC와 `x86_64-pc-windows-msvc`, `wasm32-unknown-unknown` target.
- Visual Studio C++ Build Tools와 Windows SDK.
- .NET SDK `10.0.400`, x86 .NET 10 runtime. 현재 CI pin은 `10.0.11`.
- clean Typie checkout `fbe5c4bf860d1717a66e66bea2374a2e39f0dd26`과 저장소 runtime hash.
- `.tools/phase1g-validation/epubcheck-5.3.0.zip`, `temurin-jre-21.0.11+10.zip`.
  크기·SHA-256는 [검증 스크립트](scripts/test-phase1g-epubcheck.mjs)의 pin을 따른다.

### 제품 검증 완료 조건

검증 후보는 하나의 정확한 main commit과 그 commit에서 만든 unpacked build로 식별한다.
명령별 exit·실행 환경과 개인정보 없는 요약을 기록하며, 구현 완료를 실행 성공으로 쓰지 않는다.
AGENTS.md의 필수 경로는 다음과 같다.

```powershell
pnpm install --frozen-lockfile
pnpm verify
pnpm package:unpacked
pnpm check:repository
pnpm format:check
git diff --check
```

다음 조건을 함께 충족해야 Phase 1H actual과 후속 커밋의 검증을 닫을 수 있다.

- 일반·675,000자 원고의 development 및 fresh-unpacked Electron workflow.
- exact source·block·Unicode character coverage와 ZIP/XML reopen.
- deterministic hash, cancel·실패·종료 후 cleanup, 기존 파일을 덮어쓰지 않는 recovery.
- 명시적으로 호출한 사용자 소유 LLM 요청 외 external runtime request 0.
- 현재 변경과 일치하는 결과 기록. `WITHHELD`·`PENDING`은 실제 근거가 확보될 때만 갱신.

## 현행 계약과 대조할 항목

이 표는 현행 계약과의 대조 및 처리 결과다. 새 기능 목록으로 사용하지 않는다.

| 항목 | 확인한 차이 | 처리 기준 |
| --- | --- | --- |
| AI 수정 범위 | `37802a0`에서 [일반 보조](apps/desktop/src/renderer/components/llm/LlmAssistantOverlay.tsx)의 직접 적용과 [고유 문자열 검색 경로](apps/desktop/src/renderer/llm/proposalApply.ts)를 삭제 | exact range 필수화와 검토·복사 무변이 회귀 통과. 최종 전체 gate 대기 |
| IR의 목록 지원 설명 | `37802a0`에서 [IR 문서](docs/PUBLICATION_IR_V1.md)의 List 의미 매핑 주장을 Unsupported text fallback으로 정정 | 현행 [IR 타입](apps/desktop/src/shared/publication.ts)과 일치. IR 확장 없음 |
| 실패한 프로젝트 열기 | 실제 DesktopService·registry·controller 테스트에서 B 열기 실패 뒤 A 저장 불가를 재현 | `472d0fc`에서 현재 세션·후보 분리, 편집기 설치 성공 뒤 이전 세션 폐기. 취소·설치 실패·복원 실패·동시 열기·SCENE/ENTITY owner 회귀 포함 집중 7파일·90테스트 통과 |
| 저장·검색 비용 | 전체 DB 백업과 검색 페이지별 범위 순회가 있음 | 실제 장편의 측정이나 재현 없이 최적화 작업으로 자동 승격하지 않음 |

## 사람과 배포의 별도 조건

- Windows native Korean IME는 [15항목 체크리스트](docs/MANUAL_KOREAN_IME_CHECKLIST.md)를
  사람이 수행하기 전까지 수동검증 대기다.
- AI 실증에는 사용자가 지정한 실제 loopback 제공자와 HTTPS 제공자, 필요한 키와 요청별
  동의가 필요하다. 원고·prompt·응답·키를 로그나 증거에 남기지 않는다.
- HWP는 승인된 Hancom security module·이용조건·실제 변환과 reopen 근거가 마련되기
  전까지 비활성으로 유지한다. 자동 Windows gate 통과만으로 활성화하지 않는다.
- Typie 개발 permission은 [owner-confirmed](docs/TYPIE_LICENSE_STATUS.md)다. 각 release는
  저장소 밖의 실제 grant 범위를 확인하며 배포 권한을 추정하지 않는다.
- Runtime EPUBCheck/JRE 패키징, installer·signing·update, transitive license 확인,
  crash·power loss, 장시간·DPI·다중 monitor·접근성 검증은 배포 준비 작업이다.
  현재 계획 정리와 private-local 기술 성공은 외부 배포 승인이 아니다.

## 계획 갱신 규칙

작업을 시작할 때 현재 단계, 대상 commit과 완료 조건을 읽는다. 종료할 때 구현 상태,
실제로 실행한 검증, 남은 실패와 다음 작업을 이 문서에 갱신한다. 한 번에 검토 가능한
작업 하나를 진행하고, main에서 작은 변경을 유지한다.

상세 실행 근거는 기존 RESULT·성능 문서에 기록하고 이 문서에서 연결한다. 새로운 계획
파일이나 phase별 다음 작업 목록을 병렬로 만들지 않는다. 미확정 제안은 현재 우선순위로
자동 추가하지 않는다.
