# madi 개발 계획

갱신일: 2026-10-07. 작업 위치: `main`. 현재 실행 계획은 이 문서 하나로 관리한다.

## 현재 상태

이전 제품 runtime의 전체 Windows 검증 source는 `f2efe6ebf4d02d5f56ec3f6ed5d9e74be6df8276`이다. 전체 gate·AI·자연 종료 자동 검증은 이 source 전후 clean에서 실행했다.
기존 계획의 제품 구현·코드 정리와 자동 runtime 검증을 완료한 뒤, 소유자 요청으로 UI 개선을 진행한다. 새 UI source의 runtime 승인은 **WITHHELD**이며 이전 gate로 대신하지 않는다.
2026-10-07 후속 문서 source `65936f2`에서도 같은 배포본의 Playwright 실사용 흐름 검수를 완료했다. 제품 source는 바뀌지 않았다.
Node24.21.0/npm12.2.0/Rust1.97.1을 고정한다. 설치는 `npm ci`, 실행은 `npm run <script>`다.
Private-local 기술 완료이며 공개·유료·고객·installer 배포 승인을 뜻하지 않는다. 사람의 확인 조건은 아래 세 항목이다.

## 현재 작업: UI 개선

- `andongmin94/neobrutal-ui`의 굵은 테두리·단단한 그림자·버튼 눌림 상태를 기존 React/CSS 구조에 반영한다. 공통 토큰으로 집필·설정·그래프·캔버스·Reader·내보내기·AI 화면을 통일한다.
- 기본 UI 폰트는 공식 Pretendard v1.3.9를 로컬 번들로 포함한다. canvas 원고의 실제 기본 폰트도 확인하며 출판 preset의 사용자 선택은 유지한다.
- 작업 버튼과 모드 선택의 배치를 정리하고 작은 UI 문구의 가독성을 높인다. 최소 창 크기 880×620을 포함해 Playwright로 로컬 폰트 로드·버튼 접근·주요 화면을 확인한다.
- 구현 commit의 전체 고정 Windows gate, fresh-unpacked 실사용 흐름·오프라인 요청·EPUB/HWPX 재열기 결과를 실제 실행 후 기록한다. 현재 새 UI 검증 결과는 **PENDING**이다.

## 목표와 범위

한국어 장편소설의 기획·집필·설정 관리·읽기 검토·출판을 위한 로컬 Windows 작업실을 완성한다.
작품 원고는 하나의 `.madi` 파일에 저장하고 생성 출력·report·cache·UI 상태와 분리한다.

| 영역 | 구현 범위 |
| --- | --- |
| 집필·저장 | Binder, 장면·연속 원고, 검색·치환, 자동저장, revision 검사, 백업·snapshot·텍스트 추출 |
| 설정·기획 | Story Bible, 관계·장면 연결, 본문 언급 후보, 읽기 전용 World Graph, Plot Canvas |
| 읽기·출판 | Publication IR 기반 Reader Lab·EPUB·HWPX, 고정 오프라인 EPUBCheck/JRE |
| AI | 사용자 제공자·요청별 동의, 제안 검토·복사, exact same-block selection 수정 |

Publication IR은 Reader Lab·exporter의 유일한 원고 입력이다. Typie 타입은 Madi adapter 안에 둔다.
Binary HWP는 2026-10-02 제품 범위에서 제거했다. 변환 UI·C# bridge·.NET 요구를 제거했으며 차후 TODO로 남기지 않는다.
새 제품 phase·큰 구조 변경·multi-block/project-wide AI mutation은 현재 범위에 포함하지 않는다.

## 자동 작업 완료

| 항목 | 실제 결과 |
| --- | --- |
| 고정 설치·npm 전환 | `npm ci` PASS31.244초/exit0. workspace·lock·명령·문서 계약은 npm12.2.0 |
| 전체 Windows gate | terminal PASS4459.669초/exit0. desktop710·bundle4 시험, 개발판·fresh unpacked Basic/D–H, Rust·Typie·integration·build 포함 |
| 코드 정리·정밀진단 | e2 대비 제품4,031줄·총6,721줄 감소. RPC·LLM·복원·adapter·export cleanup·stale build·window guard 수정 유지 |
| EPUB·HWPX | exact coverage·ZIP/XML 재열기·결정성·취소·no-clobber·cleanup 통과. 성능과 서식 승인 범위는 각각 결과 문서 참조 |
| 배포 package·ZIP | 검증 unpacked554파일/80디렉터리/549,229,982B. 재빌드 없이 ZIP 포장; whole inventory·manifest·ZIP entry payload hash 일치 |
| 실제 AI | 개발판27.887초·배포판26.105초 PASS. loopback 동의·선택 적용·Undo/Redo·저장·재열기 검증; diagnostic warning 보존·wrapper force0 |
| 일반 앱 자연 종료 | fresh plain native close PASS36.015초. main exit/close0·남은 owned tree0; 이 control에서는 제품 core가 로드되지 않음 |
| IME report·재시작 | direct run3 PASS40.068초. 보고서3개·동일 profile의 수동7필드 유지·두 main 자연 exit/close0·남은 owned tree0·profile 정리 |
| 추가 실사용 UI 검수 | packaged run4 PASS46.472초. 두 장면 집필·Undo/Redo·인물·POV·치환·Reader·EPUB/HWPX·재열기 통과. 스키마와 UI 상태 외19테이블 보존 |
| 결과 문서·최종 정합성 | 현재 source의 실제 결과를 반영했고 `npm run check:repository`·`npm run format:check`·`git diff --check` PASS |

위 표는 이전 제품 source의 완료 기록이다. 현재 UI 작업 완료 조건은 새 source의 검증이며, 아래 사람의 세 조건도 유지한다.
후속 문서 commit은 실제 검증 source와 구분하며 이전 성공으로 이후 제품 변경을 승인하지 않는다.

## 사람이 확인할 세 조건

- Windows native 한국어 IME15항목: **NOT TESTED**. report 자동화의 수동7필드 보존·15항목 상태·composition event null은 실제 IME 입력 시험이 아니다.
- HWPX layout: **PENDING**. native text 대조·ZIP/XML 자동 검증과 별도로 사람이 서식을 확인한다.
- 배포 범위: Typie 개발 permission은 owner-confirmed다. 소유자가 저장소 밖 exact grant와 배포 조건을 확인해야 공개·유료·고객·installer 배포를 판정할 수 있다.

## 실행 근거와 기록

- [전체 gate](.tools/verification/full-verify-f2efe6e-run1/metadata.json): terminal PASS; job3321/cleanup active0·host force0·desktop gone.
- full 입력 관측8784개는 owned inactive였다. native error5로 이름 unknown4개였으며 같은 sample의 fresh inactive 근거4개를 보존한다.
- [현재 ZIP](output/releases/madi-0.0.1-win32-x64-f2efe6ebf4d02d5f56ec3f6ed5d9e74be6df8276): ZIP SHA `5a0df130…`, canonical inventory SHA `4684dd2e…`; 상세 join은 오프라인 결과에 기록한다.
- ZIP join은 entry stream hash 대조다. 이 join을 별도의 새 ZIP 추출·앱 시험으로 표현하지 않는다.
- [report run3](.tools/verification/ime-report-direct-cdp-natural-f2efe6e-run3/metadata.json): input78 known inactive·job122/active0·host force0·desktop gone.
- [실사용 run4](.tools/verification/real-use-packaged-65936f2-run4/real-use-evidence.json): 원본 CSS의 EPUB360/960px 렌더 overflow0·package 전후 byte 일치·오류/관측한 외부 요청0. 이전 검수 스크립트 실패3회는 결과 문서에 보존한다.
- source archive는444개 source의 **RUNNING snapshot**을 그대로 보존한다. terminal full metadata와 별도로 연결하며 snapshot을 PASS로 고쳐 쓰지 않는다.
- report run1 완료 download 관측 실패110.832초와 run2 첫 종료 뒤 relaunch timeout130.432초는 역사에 보존한다. 성공 run3과 합치지 않는다.
- 이전 Node/npm·e2/source52/cde 기록은 [오프라인 결과](docs/OFFLINE_RUNTIME_RELEASE_RESULT.md)에 revision-bound 역사로 보존한다.

## 검증 운용

필수 명령은 `npm ci`, `npm run verify`, `npm run package:unpacked`, `npm run check:repository`, `npm run format:check`, `git diff --check`다.
Full에서 실제 실행한 unpacked·repository·format은 해당 run에 연결한다. 후속 문서 변경 뒤 repository·format·diff를 다시 확인한다.
앱 시험은 소유 비활성 Win32 desktop·BelowNormal·GPU 비활성화에서 순차 실행하며 사용자 화면·키보드·포커스·clipboard를 바꾸지 않는다.
Rust jobs1·Vitest workers2·command process 한정 `CARGO_INCREMENTAL=0`을 유지한다.
명시적으로 호출한 사용자 소유 LLM 외 external runtime request는0이어야 한다. 원고·응답·키·private path를 로그에 남기지 않는다.
AI loopback은 remote HTTPS·인증키·OS clipboard·native IME·전체 AI process TCP 감사를 대신하지 않는다. AI wrapper 종료 근거와 plain/report native 자연 종료 근거는 구분한다.

상세 actual: [오프라인 결과](docs/OFFLINE_RUNTIME_RELEASE_RESULT.md), [HWPX](docs/PHASE_1H_RESULT.md), [AI](docs/PHASE_1I_RESULT.md), [코드 감사](docs/CODE_QUALITY_AUDIT.md).
사람의 확인: [IME 체크리스트](docs/MANUAL_KOREAN_IME_CHECKLIST.md), [Typie license](docs/TYPIE_LICENSE_STATUS.md). 집필·설정·기획·Reader Lab·EPUB의 상세 결과는 기존 Phase1A–1G 문서에 보존한다.
