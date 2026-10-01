# madi 개발 계획

갱신일: 2026-10-02. 작업 위치: `main`.
현재 목표·진척·다음 작업·완료 조건은 이 문서에서만 관리한다.

## 목표와 범위

한국어 장편소설을 기획·집필·설정 관리·읽기 검토·출판하는 로컬 Windows 작업실을 완성한다.
작품의 canonical manuscript는 하나의 `.madi` 파일에 저장한다.

| 영역 | 현재 구현 범위 |
| --- | --- |
| 집필·저장 | Binder, 장면·연속 원고, 검색·치환, 자동저장, revision 검사, 백업, snapshot, 독립 텍스트 추출 |
| 설정·기획 | Story Bible, 관계·장면 연결, 본문 언급 후보, 읽기 전용 World Graph, 독립 Plot Canvas |
| 읽기·출판 | Publication IR 기반 Reader Lab·EPUB·HWPX, 승인 조건이 있는 선택적 HWP bridge |
| AI | 사용자 제공자와 요청별 범위 동의, 제안 검토·복사, exact same-block selection 수정 |

Publication IR만 Reader Lab과 exporter의 원고 입력으로 사용한다. Typie 타입은 Madi 소유 adapter에 둔다.
생성 파일·report·cache·UI 상태는 canonical manuscript와 분리한다. 새 제품 phase나 큰 구조 변경은 이번 범위에 포함하지 않는다.

## 현재 판정과 진척

**플랜은 진행 중이다. 기본 Windows 검증은 통과했고, 후속 HWP 수정의 실제 검증이 남아 있다.**
기본 통과를 새 HWP 구현이나 사람의 IME·layout·라이선스 승인으로 이전하지 않는다.

| 항목 | 실제 완료 근거와 남은 조건 |
| --- | --- |
| 기본 Windows gate | **source20e8 PASS**. frozen install·전체 verify 안의 unpacked/repository/format·diff 확인. 개발판과 fresh 전체 경로, desktop705개 시험 통과 |
| 기본 실행 정리 | **PASS**. full6071.028초/exit0, job3457/active0, 강제 종료 없음, handles·desktop 정리. input11867회 Default/비활성, unknown0 |
| EPUB·HWPX | **기본 source20e8 PRIVATE LOCAL TECHNICAL PASS**. dev/fresh 결정성·ZIP/XML·취소·출력 보호·재열기와 수정된 IPv4/IPv6 TCP 수집 경로 확인. TCP 표본을 연속 packet/UDP 관측으로 확대하지 않음 |
| EPUBCheck/JRE | **기본 source20e8 PASS**. 고정 오프라인 bundle 포함, 실제 Java 검사·취소·검사 중 종료·출력 보호 확인 |
| 기본 ZIP | **source20e8 WHOLE PAYLOAD JOIN PASS**. 실제 검증한561파일/81폴더/549,533,091bytes를 재빌드 없이 ZIP으로 포장하고 새 압축 해제본까지 hash 대조 |
| 한컴 시험 원고 | **source20e8 BACKEND PASS ONLY**. tiny·일반18만자·장편67.5만자 각2회 결정성·전체 IR 내용 대조. 일반324/장편2412 표시 문단 포함. 한컴 변환·native 판독은 아직 미실행 |
| HWP 소유권·취소 | **제품 반영·계약 시험 PASS / 실제 한컴 검증 대기**. unchecked COM activation 제거, 소유 process·문서·native 종료와 취소/commit 경합·cleanup 오류 처리. 제품 C#24개·앱27개·typecheck·repository·format·diff 통과. Mock 성공을 native 성공으로 이전하지 않음 |
| AI | 기존 source5151 dev/fresh **PASS WITH DIAGNOSTIC WARNING** 보존. 최종 제품에서 실제 로컬 제공자 재실행 필요 |
| Native IME·한컴 layout | **사람의 확인 대기**. 수동 kit와 report 경로 준비, 입력15항목은 NOT TESTED |

기본 실행: `.tools/verification/full-verify-20e8f3a-run1/`.
정확한 기본 source: `20e8f3a970d321152940db47e26f9252b4524f26`.
후속 sourcee636 실제 tiny 변환은 소유권 확인에서 실패했고, 일반 HWPX native 판독은 열린 시험 파일의 재해시에서 실패했다. Source dbff 진단 실행에서 초기 창 열거의 false/error0를 확인했다. 창이 없는 초기 표본은 기존 제한 시간 안에서 NOT_READY로 처리하며 실제 창·문서 확인은 계속 요구한다. 실패 실행은 통과 근거로 사용하지 않고 process·job 정리와 module 부재를 확인했다. 수정 뒤 실제 변환과 파일 재해시를 재검증한다.
Whole inventory·raw E/F/G/H archive·ZIP join은 이 run의 source와 실제 package receipt에 연결했다.
이전 source5347/1ff 전체 FAIL과 graph 집중5회, source5151 기존 PASS는 각 revision의 결과로 보존한다.
서로 다른 revision의 부분 성공을 합쳐 전체 통과로 표현하지 않는다.

## 끝까지 이어갈 순서

1. **완료 — 기본 gate 복구.** 장편 graph 재열기 진단, IPv4/IPv6 회귀, 초기화 뒤 시험 순서를 적용하고 exact source20e8의 전체 Windows 경로를 통과했다.
2. **구현·계약 시험 완료 — HWP 수정 고정.** 반영한 소유권·취소 수정의 빌드·관련 C#/앱 시험·repository·format·diff를 통과했다. 실제 한컴 검증과 최종 전체 gate 전에는 구현 완료를 runtime GO로 표현하지 않는다.
3. **다음 — 승인된 실제 한컴 시험.** 원본 예제 모듈만 임시 등록하고 tiny conversion→fresh reopen→no-clobber부터 검증한다. 통과하면 일반·장편 전체 표시 내용, 장편5회, 취소·timeout·종료와 TCP 관측을 확인한다. 모든 결과 뒤 exact-value external postguard와 등록 원복을 확인한다.
4. **다음 — 최종 source 검증·포장.** 최종 제품의 frozen install·전체 pinned Windows gate·dev/fresh AI를 실행한다. 실제 검증한 unpacked 전체 inventory·ZIP·새 압축 해제본을 바이트로 연결하고 최종 IME report/수동 kit를 준비한다. 검증 후 포장 전 재빌드하지 않는다.
5. **사람의 확인 — Native IME15항목·한컴 layout/라이선스.** 실제 환경과 결과를 사람이 기록한다. 자동 검증을 완료해도 사람의 미완료 항목을 PASS로 바꾸지 않는다.

## 실행 자료와 사람에게 남는 조건

- 기본 source20e8 ZIP: `output/releases/madi-0.0.1-win32-x64-20e8f3a970d321152940db47e26f9252b4524f26/`.
- 현재 `output/madi-win32-x64/`는 기본 검증 패키지다. 후속 제품 빌드·최종 gate의 결과는 별도 source로 기록한다.
- 기존 수동 kit: `output/releases/manual-validation/5151f6a-036f0b13-b04c-45e8-88b6-d153534d7a8e/`. 최종 source용으로 갱신할 예정이며 입력15항목 완료 증거가 아니다.

HWP 기본 UI는 REGISTERED_UNVERIFIED/disabled를 유지한다. 기존 human 승인은 원본 unsigned 모듈의 일시 등록·합성 로컬 시험이다.
영구 등록·다른 registry namespace·소유권 불명확 COM activation·전역 process 종료로 확대하지 않는다. PID18872 특정 종료 승인은 이미 사용한 별도 승인이다.
Native IME 입력은 화면·키보드 사용 승인과 사람의 체크리스트가 필요하다.
Typie 개발 permission은 owner-confirmed이며 공개 배포 범위는 저장소 밖 정확한 grant를 소유자가 확인한다.
Private-local ZIP·기술 성공을 signing·installer·자동 update·공개/유료/고객 배포 승인으로 해석하지 않는다.

AI 실증은 keyless loopback·합성 단일 블록 전체 선택·clipboard API interception 범위다.
Remote HTTPS·인증키·OS clipboard·native IME로 확대하지 않는다. 진단 지정 응답 불일치와 stderr 등 관측 한계는 결과에 보존한다.

## 검증과 기록 규칙

AGENTS.md의 필수 명령을 고정 pnpm workspace로 실제 실행한다.

```powershell
pnpm install --frozen-lockfile
pnpm verify
pnpm package:unpacked
pnpm check:repository
pnpm format:check
git diff --check
```

전체 verify 안에서 실제 실행한 unpacked·repository·format은 그 run에 연결한다. 최종 문서 변경 뒤 repository·format·diff를 다시 확인한다.
`.tools/run-pinned.ps1`, Node26.3.1/pnpm11.9.0/Rust1.97.1/.NET10.0.400/MSVC·SDK·x86 runtime을 사용한다.
Rust jobs1·Vitest workers2·command process 한정 `CARGO_INCREMENTAL=0`·.NET `--disable-build-servers`를 유지한다.
실행은 소유 비활성 Win32 desktop·BelowNormal·GPU 비활성화로 한 번에 하나씩 한다. 화면·포커스를 전환하지 않는다.
명시적으로 호출한 사용자 소유 LLM 외 external runtime request는0이어야 한다. 원고·prompt·응답·키·private path를 로그나 공개 evidence에 남기지 않는다.
Actual evidence만 phase 결과에 반영하고 WITHHELD/PENDING을 static inspection으로 GO로 바꾸지 않는다.

## 상세 계약과 결과

상세 scope·architecture·format·ADR은 계약이며, 결과 문서는 stated revision·환경의 evidence다.

- [오프라인 runtime·배포 결과](docs/OFFLINE_RUNTIME_RELEASE_RESULT.md), [한컴 검증 기록](docs/HANCOM_AUTOMATION_VALIDATION.md).
- [Phase1H 결과](docs/PHASE_1H_RESULT.md), [HWPX 성능](docs/HWPX_EXPORT_PERFORMANCE.md), [HWP bridge 계약](docs/HWP_LOCAL_BRIDGE.md).
- [Phase1I 결과](docs/PHASE_1I_RESULT.md), [AI 범위](docs/PHASE_1I_SCOPE.md), [IME 체크리스트](docs/MANUAL_KOREAN_IME_CHECKLIST.md).
- [Typie pin·patch](docs/TYPIE_PINNING_AND_PATCHES.md), [license 상태](docs/TYPIE_LICENSE_STATUS.md).
- 집필·설정·기획·Reader Lab·EPUB의 상세 결과는 기존 Phase1A–1G 결과 문서와 Git history에 보존한다.
