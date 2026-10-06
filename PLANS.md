# madi 개발 계획

갱신일: 2026-10-06. 작업 위치: `main`.
현재 목표·진척·다음 작업·완료 조건은 이 문서에서만 관리한다.

## 현재 작업 — npm 전환 완료

2026-10-06 사용자 요청에 따라 pnpm workspace를 npm `12.2.0`으로 전환했다.
Node `26.3.1`·Rust `1.97.1`과 제품 의존 버전을 유지하며, 기존 lock의 버전·integrity를
새 `package-lock.json`과 대조한다. 새 직접 의존이나 영구 overrides는 추가하지 않는다.
설치·빌드·개발/packaged 시험·dev 시작 시험·repository·format·diff의 실제 실행 결과를 이 절에 기록한다.
제품 기능, 과거 실행 증거와 사람의 IME·layout·배포 판정은 이번 전환 범위 밖이다.

전환 준비 검증: 고정 Node `v26.3.1`/npm `12.2.0`의 `npm ci` 실제 exit0, 306개 설치,
Electron `37.10.3` binary integrity 복구를 확인했다. 기존 registry `name@version`
353쌍과 integrity는 추가0·제거0·변경0이며 직접 의존 버전도 모두 유지했다.
고정 npm 실행 wrapper·workspaces·CI·현재 문서와 Electron의 npm hoist 경로를 전환하고,
기존 pnpm lock/workspace·실행 경로를 제거했다. 검증 candidate는 `c65b09a8d77b0f7b90042f6dcc892935fd64ed60`이다.
이 source의 분할 실행에서 다음 범위를 실제 통과했다.

- Full run5의 개발 경로: Desktop102파일/710시험·bundle4시험, Rust/Typie/integration/build와 개발 Electron Basic·D·E·F·G·H.
- `npm run test:package` 단독 실행: pretest의 fixture3종·release/unpacked 빌드와 fresh packaged Basic·D·E·F·G·H, 816.327초/exit0.
- `npm run test:dev` 단독 실행: 22.324초/exit0, 실제 소유 browser1개와 `--disable-gpu` argv 관측.

모든 성공 실행은 같은 clean candidate의 전후 SHA를 확인했다. 패키지 단독 실행의 소유 desktop은1599/1599회 비활성,
입력 이름 unknown0, 종료 전 fresh UOI_IO 비활성 조회1회였고 job empty·handle/desktop close·desktop 소멸을 확인했다.
검증된 `output/madi-win32-x64`의554개 파일/549,229,982byte를 thread work에 보존하고,
각 상대경로의 SHA256·size가 원본과 전부 일치하는 provenance를 기록했다. 이 배포본은 추가 재빌드하지 않는다.
사람의 IME·layout·배포 승인이나 이전 제품 작업의 PRIVATE GO는 이번 근거로 확대하지 않는다.

단일 `npm run verify`의 aggregate PASS는 없다. 사용자가 npm 교체 범위를 다시 명확히 한 뒤
반복 전체 제품 검증을 중단했으며, 같은 source의 위 분할 검증 결과로 이번 관리자 전환을 마친다.
전체 실행의 실패·부분 증거를 성공으로 합산하거나 없는 command-exit/sourceAfter 값을 채우지 않는다.

첫 전환 candidate `fb1a73bf86ceb1d3314f1bcaba8123072517d287`의 부분 실행 기록은 보존했다.
Full run1은789.117초에 OS의 `Screen-saver` 입력 desktop 관측으로 기존 Default-only guard가 종료했다.
소유 desktop은 모든 관측에서 비활성이었다. 소유 desktop 비활성·알 수 없는 입력 실패·소스 동일성·정리 조건을
유지하면서 실제 `Default`/`Screen-saver` 이름을 허용하는 ignored helper로 바꿨다. 실제 Default 관측값과 허용 정책값은 분리한다.
Full run2는124.429초에 Phase1E fixture의 I/O/SQLite class 오류로 exit1이었다. 하위원인은 미확정이며,
같은 clean source의 해당 fixture 단독 재현은26.056초/exit0이었다. 오래된 UUID 임시 파일을 원인으로 단정하거나 제품 구현을 바꾸지 않았다.
Full run3에서는 Phase1E fixture와 Reader fixture16회 RPC가 통과했으나 G/H 외 Electron의 GPU-off 설정 누락을 확인해
1255.094초에 소유 child/job만 안전하게 종료했다. 이 실행도 전체 PASS가 아니다. 없는 command-exit/sourceAfter 값을 성공으로 채우지 않는다.
기존 G/H와 같은 isolated-only `--disable-gpu` 설정을 basic/D·E·F의 공통 smoke와 dev/start 공식 Electron CLI 실행에 적용했고,
실제 Chromium switch 또는 소유 browser argv를 검사했다. 제품 main·의존·lock·기존 검사 threshold는 바꾸지 않았다.
Candidate c65의 Full run4는1017.869초에 기존 helper의 입력 이름 native5 실패로 종료했다.
이름 관측과 별개인 소유 desktop UOI_IO 비활성 근거가 있었으나 이 과거 실행을 PASS로 승격하지 않았다.
현재 ignored helper hash는 `9B8DFA295DE998D52EEB9B3713FBAF1326EB92E3EA1479F89252C872B1ED7CB5`다.
이름 native5일 때에만 같은 회차 live owned handle의 fresh UOI_IO 성공·비활성을 별도로 요구한다.
초기 identity·known unsupported name·다른 native 오류·owned flag 읽기 실패/true·source·exit·GPU·job·정리 요구는 유지한다.
Full run5는2874.782초에 prepackage PhaseD fixture의 Rust bin 재링크 `LNK1105`/Win321224로 exit1이었다.
Mapping 주체/근본원인은 미확정이며 같은 source의 PhaseD 단독 실행은 실제 재링크 후4.513초/exit0이었다.
제품·Rust·lifecycle 설정을 바꾸지 않고 이어진 위 단독 package 전체 실행을 통과했다.
Full run6은1252.694초에 사용자 범위 재확인에 따른 반복 검증 중단으로 소유 child/job만 정리했다.
이름 native5 unavailable9회는 raw Default/allowedName=null·availability=false로 보존했고,
같은 회차 fresh owned proof9회와 primary2449/2449회 비활성, 종료 전 fresh 조회·job empty·desktop 소멸을 확인했다.
Raw launcher 결과는 command-exit가 없는 `LAUNCHER_FAILED`이며 별도 intentional-abort 근거를 보존했다.
이 실행도 전체 PASS가 아니다. 최종 `check:repository`는 Typie exact commit·9개 hash·경계 검사를,
`format:check`는290개 파일의 whitespace/JSON 검사를 실제 통과했다. `git diff --check`도 exit0이다.

## 이전 제품 작업 — 사용자 요청으로 중단

2026-10-02 퇴근을 위한 사용자 요청으로 작업을 중단했다. 소유 시험 job과 비활성 desktop은 정리했고, 자동 재개하지 않는다.
최신 제품 코드 commit은 `cde2145cf7f3b7465939a99ed11a8b5d80a6bea2`다. HWP 제거와 정밀진단 개선은 구현했으며 제품 소스는 기준 e2 대비4,031줄 줄었다.
Source52 전체 Windows 검증4599.511초·로컬 ZIP 대조·실제 AI 연결은 해당 source의 완료 근거다. Source52에는 이후 별도 시험에서 확인한 창 종료 예외가 있으므로 최신 코드의 완료 판정으로 이전하지 않는다.
닫힌 창의 `webContents` 접근 예외를 최소 guard로 수정했다. 회귀시험2개 실제 RED 뒤 종료 관련14개 GREEN, typecheck·repository·format·diff를 통과했다.
Source cde의 전체 시험은 사용자 요청으로2335.000초에 중단했다. Desktop102파일/710시험·bundle4시험과 dev 기본·D/E/F 경로까지 통과하고 장편 EPUB 시험 중이었다. HWPX·새 unpacked·fresh 경로는 이 실행에서 완료하지 않았다. **전체 PASS가 아니며 최신 runtime 판정은 PENDING이다.**
중단 근거는 `.tools/verification/full-verify-cde2145-run2/intentional-abort.json`과 실제 terminal metadata에 보존했다. job1316/cleanup 시 active18은 소유 job 안에서 종료해 empty로 확인했고 handles·desktop을 닫았다. Input4556회 unknown0·소유 desktop inactive=true다. 강제 중단으로 없는 sourceAfter 필드를 성공값으로 채우지 않았다.
재개하면 그때의 정확한 clean main source에서 명시적 command-only `CARGO_INCREMENTAL=0`으로 전체 pinned Windows 검증을 다시 실행한다. 통과한 unpacked를 재빌드 없이 ZIP으로 묶고 전체 byte join, 실제 AI·자연 종료/보고서 재시작 시험, 최종 결과 문서 갱신을 마친다. 준비 helper와 이전 결과는 `.tools/verification/`에 보존했다.

현재 범위는 실제 미사용 소스·잔재와 중복을 추적하고,
동작상 결함이 확인된 구현을 작게 개선해 복잡도를 줄이는 것이다. 의존성을 추가하지 않고 기존 타입·계약·호출·시험을 근거로 판단한다.
HWPX 검증 성공을 근거로 사용자 요청에 따라 binary HWP 기능을 제품 범위에서 제거한다.
HWP 앱·계약·C# sidecar·.NET/CI/배포 경로 제거와 미사용 선언·반사 선택 shim 정리를 구현했다.
문서 전환의 원고/저장 대상 불일치, malformed JSON-RPC, AI 오류 본문 처리,
EPUB 입력 실패·종료/취소 경합·살아 있는 process의 임시 파일 정리 결함을 회귀 시험과 함께 수정했다.
Strict typecheck·repository·format·diff와 담당별 집중 회귀 검사는 통과했다. 현재 통합 source의 전체 Windows 검증·새 배포본 연결이 남는다.
아래 완료 근거는 검증된 source e2의 기준 상태다. 후속 제품 변경은 관련 회귀검사와 필수 Windows 경로를 별도로 실행하기 전까지 runtime GO로 표현하지 않는다.
HWP 변환은 차후 해결 목록에도 남기지 않는다. 과거 실패 근거만 보존하며 추가 한컴 실증은 하지 않는다.

## 목표와 범위

한국어 장편소설을 기획·집필·설정 관리·읽기 검토·출판하는 로컬 Windows 작업실을 완성한다.
작품의 canonical manuscript는 하나의 `.madi` 파일에 저장한다.

| 영역 | 현재 구현 범위 |
| --- | --- |
| 집필·저장 | Binder, 장면·연속 원고, 검색·치환, 자동저장, revision 검사, 백업, snapshot, 독립 텍스트 추출 |
| 설정·기획 | Story Bible, 관계·장면 연결, 본문 언급 후보, 읽기 전용 World Graph, 독립 Plot Canvas |
| 읽기·출판 | Publication IR 기반 Reader Lab·EPUB·HWPX |
| AI | 사용자 제공자와 요청별 범위 동의, 제안 검토·복사, exact same-block selection 수정 |

Publication IR만 Reader Lab과 exporter의 원고 입력으로 사용한다. Typie 타입은 Madi 소유 adapter에 둔다.
생성 파일·report·cache·UI 상태는 canonical manuscript와 분리한다. 새 제품 phase나 큰 구조 변경은 이번 범위에 포함하지 않는다.

## 현재 판정과 진척

**기존 제품 범위의 자동 개발·Windows 검증·로컬 ZIP 준비는 source e2에서 완료했다. 현재 HWP 제거·코드 정리 및 사람의 검증·배포 결정이 남는다.**
실제 검증 제품 source는 `e2cb07e44e73fd0f43db61090374a762ad1103f0`다. 후속 결과 문서 commit을 추가 runtime 검증으로 표현하지 않는다.

| 항목 | 판정과 실제 근거 |
| --- | --- |
| 최종 Windows gate | **PASS**. frozen install1.432초, full6027.338초/exit0. Desktop105파일/719시험·C#25시험, core·exporters·Typie·build·dev/fresh 기본/D/E/F/G/H 및 unpacked/repository/format 포함 |
| 최종 실행 정리 | **PASS**. 소유 job3494/active0, host 강제 종료 없음, handles·desktop 정리. input11787회 Default/비활성, unknown0 |
| EPUB·HWPX | **PRIVATE LOCAL TECHNICAL GO**. exact e2 dev/fresh ZIP/XML·IR 범위·결정성·취소·출력 보호·재열기. TCP 외부 관측0; UDP/연속 packet 관측을 주장하지 않음 |
| EPUBCheck/JRE | **PASS**. ZIP에 고정 오프라인 bundle 포함. 실제 Java 검사·취소·검사 중 종료·출력 보호 확인 |
| 최종 ZIP | **WHOLE PAYLOAD JOIN PASS**. 실제 검증한561파일/81폴더/549,563,008bytes를 재빌드 없이 포장, ZIP과 새 압축 해제본까지 전체 hash 대조 |
| AI | **PASS WITH DIAGNOSTIC WARNING**. exact e2 개발판/배포판 실제 요청·선택 적용·Undo/Redo·저장·재열기와 제품 종료/테스트 실행기 분리 확인. 지정 응답 불일치·stderr 관측 한계 보존 |
| IME report·수동 kit | **보고서 경로 PASS / 수동 준비 완료**. 최종 앱에서 JSON/Markdown3개 내보내기·재시작·설정 유지·프로필 정리 확인. Native IME15항목은 NOT TESTED |
| HWPX native 내용 | **PRIVATE LOCAL TEXT PASS ONLY**. source20e 출력/sourcef464 inspector의 일반324·장편2412 문단 전체 대조, Close·Quit·native exit·job0·등록 부재. e2 native 판독·layout·HWP 변환 성공으로 이전하지 않음 |
| HWP 기능 | **제거 구현 완료 / 제품 범위 제외**. HWPX를 출판 경로로 유지하며 HWP 변환 UI·계약·sidecar·.NET 요구사항을 제거. 이전 변환 실패는 역사적 근거로만 보존 |
| Native IME·HWPX layout·배포 | **사람의 확인 대기**. 자동 성공을 수동 입력·서식·공개 배포 승인으로 바꾸지 않음 |

전체 실행 자료는 `.tools/verification/full-verify-e2cb07e-run1/`에 보관했다. Source80개 archive와 raw E/F/G/H10개는 원본 bytes로 보관하고 실제 package receipt·whole inventory·ZIP join과 연결했다.
Source5347/1ff full FAIL, source20e 기본 PASS, 기존 AI source5151과 첫 e2 AI 종료 증거 부족 실행은 각 revision/실행의 기록으로 보존한다. 서로 다른 실행의 부분 성공을 합쳐 전체 PASS로 만들지 않는다.

## 끝까지 이어갈 순서

1. **완료 — 기본 gate 복구와 HWP 구현 고정.** graph·IPv4/IPv6 수집·초기화 시험 수정, HWP 소유권·취소·최소 진단을 반영하고 최종 exact source 전체 경로를 통과했다.
2. **완료 — 최종 자동 검증·포장.** 개발판/새 배포본 AI, IME report와 수동 kit, whole package·ZIP·새 압축 해제본 대조와 결과 기록을 완료했다. 검증한 제품을 포장 전에 재빌드하지 않았다.
3. **사용자 요청으로 중단 — HWP 제거와 코드 정리의 최종 검증.** 구현과 집중 회귀검사를 마쳤다. 재개 시 정확한 clean main source에서 필수 Windows 경로를 다시 실행하고 결과와 새 배포본을 연결한다. 중단한 부분 실행을 전체 PASS로 합치지 않는다.
4. **사람의 확인 — Native IME15항목·HWPX layout·배포.** 실제 환경·입력·서식을 사람이 기록하고 배포 범위를 결정한다. 미완료 항목은 NOT TESTED/PENDING을 유지한다.

## 실행 자료와 사람에게 남는 조건

- 최종 private-local ZIP: `output/releases/madi-0.0.1-win32-x64-e2cb07e44e73fd0f43db61090374a762ad1103f0/`.
- 직접 실행할 최종 앱: `output/madi-win32-x64/madi.exe`.
- 최종 수동 kit: `output/releases/manual-validation/e2cb07e-68cec668-c8fd-49b7-86e4-baf816261a37/`. Source e2 문서 사본과15항목 NOT TESTED template·5,000자 합성 한글 입력 자료다. 수동 검증 완료 증거가 아니다.

과거 HWP 등록·합성 시험 승인과 원복·네트워크 실패는 역사적 결과 문서에서 보존한다.
HWP 기능 제거를 추가 Automation 시험·영구 등록·전역 process 종료·전역 네트워크/보안 변경으로 해석하지 않는다.
Native IME는 사람이 체크리스트를 수행한다. 자동 시험은 사용자의 화면·키보드·포커스·clipboard를 바꾸지 않았다.
Typie 개발 permission은 owner-confirmed이며 공개 배포 범위는 저장소 밖 정확한 grant를 소유자가 확인한다.
Private-local ZIP·기술 성공을 signing·installer·자동 update·공개/유료/고객 배포 승인으로 해석하지 않는다.

AI 실증은 keyless loopback·합성 단일 블록 전체 선택·clipboard API interception 범위다. 진단 지정 응답 불일치와 stderr 관측 한계는 보존한다.
Remote HTTPS·인증키·OS clipboard·native IME 또는 AI 실행 전체 process TCP 감사로 확대하지 않는다. 앱의 제품 종료와 Playwright 테스트 실행기의 정리는 별도로 기록한다.

## 검증과 기록 규칙

AGENTS.md의 필수 명령을 고정 npm workspace로 실제 실행한다.

```powershell
npm ci
npm run verify
npm run package:unpacked
npm run check:repository
npm run format:check
git diff --check
```

전체 verify 안에서 실제 실행한 unpacked·repository·format은 그 run에 연결한다. 최종 문서 변경 뒤 repository·format·diff를 다시 확인했다.
`.tools/run-pinned.ps1`, Node26.3.1/npm12.2.0/Rust1.97.1/MSVC·SDK를 사용한다.
Rust jobs1·Vitest workers2·command process 한정 `CARGO_INCREMENTAL=0`을 유지한다.
실행은 소유 비활성 Win32 desktop·BelowNormal·GPU 비활성화로 한 번에 하나씩 한다. 화면·포커스를 전환하지 않는다.
명시적으로 호출한 사용자 소유 LLM 외 external runtime request는0이어야 한다. 원고·prompt·응답·키·private path를 로그나 공개 evidence에 남기지 않는다.
Actual evidence만 phase 결과에 반영하고 WITHHELD/PENDING을 static inspection으로 GO로 바꾸지 않는다.

## 상세 계약과 결과

상세 scope·architecture·format·ADR은 계약이며, 결과 문서는 stated revision·환경의 evidence다.

- [오프라인 runtime·배포 결과](docs/OFFLINE_RUNTIME_RELEASE_RESULT.md), [한컴 검증 기록](docs/HANCOM_AUTOMATION_VALIDATION.md).
- [Phase1H 결과](docs/PHASE_1H_RESULT.md), [HWPX 성능](docs/HWPX_EXPORT_PERFORMANCE.md), [과거 HWP bridge 기록](docs/HWP_LOCAL_BRIDGE.md).
- [Phase1I 결과](docs/PHASE_1I_RESULT.md), [AI 범위](docs/PHASE_1I_SCOPE.md), [IME 체크리스트](docs/MANUAL_KOREAN_IME_CHECKLIST.md).
- [Typie pin·patch](docs/TYPIE_PINNING_AND_PATCHES.md), [license 상태](docs/TYPIE_LICENSE_STATUS.md).
- 집필·설정·기획·Reader Lab·EPUB의 상세 결과는 기존 Phase1A–1G 결과 문서와 Git history에 보존한다.
