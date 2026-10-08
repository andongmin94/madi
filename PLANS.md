# madi 개발 계획

갱신일: 2026-10-08. 작업 위치: `main`. 현재 실행 계획은 이 문서 하나로 관리한다.

## 현재 상태

소유자의 정정에 따라 `neobrutal-ui`의 기본 Mono 테마를 그대로 적용한다. 기존 회색 강조색 구현은 이 요구를 충족하지 못했으며 새 제품 변경의 runtime 승인은 **WITHHELD**다.
직전 기술 검증 source는 `03e44d8e3d2e8c506534d02e17065da4cb39106b`다. 이 source의 전체 Windows gate·fresh-unpacked 실사용·실제 AI UI 검수를 완료했으나 기본 Mono 디자인 승인을 뜻하지 않는다.
각 최종 실행은 source 전후 clean에서 수행했다. Full이 새로 만든 배포본의 전체 파일·디렉터리 inventory를 UI·AI 검수 전후와 실제 연결했다.
이전 b9 UI와 f2의 full·ZIP·AI·자연 종료, 문서 source `65936f2`의 실사용 검수는 해당 revision의 근거로 보존한다. 현재 판정은 아래 최신 실행 결과를 따른다.
Node24.21.0/npm12.2.0/Rust1.97.1을 고정한다. 설치는 `npm ci`, 실행은 `npm run <script>`다.
Private-local 기술 완료이며 공개·유료·고객·installer 배포 승인을 뜻하지 않는다. 사람의 확인 조건은 아래 세 항목이다.

## 현재 작업: 원본 기본 Mono 테마

- Reference `b4da2463fe710a77bf464c65125a1a7f40424722`의 기본 Mono를 기준으로 삼는다. 주요 버튼·선택은 `#27282b` 바탕과 `#f4f5f7` 글자, neutral 입력/sidebar는 흰색과 검정, 카드·outline은 `#f4f5f7`와 검정으로 맞춘다.
- 검정4px 그림자·5px radius·hover3px/active4px와 원본의 error/destructive 의미색을 적용한다. Pretendard와 사용자 작품색·Reader/출판 preset·원고/저장/AI 계약은 유지한다.
- 새 source를 commit한 뒤 먼저 fresh-unpacked 화면을 검수한다. 회색 채널 일치 대신 원본 token·foreground/background pair·그림자·실제 선택과 버튼 상태를 확인한다.
- 화면 검수 후 exact source의 고정 설치·전체 Windows gate를 실행하고 실제 결과에서 완료 판정을 갱신한다.

## 직전 회색 UI 구현과 검증

- 공통 라임 강조색·비중립 배경·저장 상태 표시와 Graph/Canvas/Reader의 기본 장식색을 흰색·회색·검정으로 바꿨다. 굵은 테두리·단단한 그림자·Pretendard·기존 상호작용 구조는 유지했다.
- 사용자 작품의 색상 token·Reader/출판 preset과 원고·저장 계약·AI 로직은 유지했다. 새 npm 의존성은 없다.
- 화면의 색상 검사42회에서 공통 색상 token10개·root paint2개와 표시 중인 버튼·선택·저장 dot의 중립색을 확인했다. 관측한 저장 상태는 `saved`이며 모든 저장 phase나 사용자 작품색 검증으로 확대하지 않는다.

## 이전 UI 개선 완료

- `andongmin94/neobrutal-ui`의 굵은 테두리·단단한 그림자·버튼 눌림 상태를 기존 React/CSS 구조에 반영했다. 공통 토큰으로 집필·설정·그래프·캔버스·Reader·내보내기·AI 화면을 통일했다. 추가 npm 의존성은 없다.
- 공식 Pretendard v1.3.9 variable WOFF2를 기본 UI 폰트로 오프라인 번들에 포함했다. canvas 원고도 같은 버전 Regular의 실제 자산을 사용한다. 한글 완성형 11,172자 coverage·편집 엔진 probe·실제 로컬 FontFace 로드를 확인했다. 출판 preset의 사용자 선택은 유지한다.
- 작업 버튼·모드 선택을 정리하고 작업 패널 닫기를 추가했다. 880×620을 포함한 네 창 크기에서 버튼 접근·본문 영역·그래프/캔버스 노드 노출을 확인했다. 기존 React Flow Controls를 제거하고 확대·축소를 상단 도구 모음으로 옮겨 노드 가림을 해결했다.
- 구현·검수의 실패 회차와 수정 근거는 [오프라인 결과](docs/OFFLINE_RUNTIME_RELEASE_RESULT.md)의 b9 UI 절에 보존한다. 아래 사람의 세 조건은 유지한다.

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

## 직전03 source의 자동 작업 완료

| 항목 | 실제 결과 |
| --- | --- |
| 고정 npm workspace | Node24.21.0/npm12.2.0/Rust1.97.1·committed lock. exact source의 `npm ci` 실제 PASS26.208초/exit0 |
| 전체 Windows gate | terminal PASS4181.694초/exit0. desktop102파일/714테스트·별도 bundle4 시험, 개발판·fresh unpacked Basic/D–H, Rust·Typie·integration·build 포함 |
| EPUB·HWPX | exact coverage·ZIP/XML 재열기·결정성·취소·no-clobber·cleanup 통과. HWPX 장편 packaged exporter max69ms; UI wall·사람의 서식 승인은 별도 |
| 배포 package 연결 | 556파일/80디렉터리/551,929,597B. Full 이후와 UI·AI 이후 두 번 읽은 전체 inventory가 실제 일치. 새 ZIP은 만들지 않음 |
| 실제 AI UI | host PASS31.278초/exit0·actual probe22.196초. 동의·exact same-block 적용·Undo/Redo·저장·재열기·AI4화면×2크기 통과. 진단 경고 보존 |
| 실사용 모노톤 UI | harness PASS65.427초·host PASS67.798초/exit0. 폰트10회·4크기40화면·54캡처·색상 검사42회, 집필·설정·치환·Reader·EPUB/HWPX·재열기·스키마/원고19테이블 보존 |
| 결과 문서·최종 정합성 | 실제 결과를 기록했고 후속 문서 변경 뒤 `npm run check:repository`·`npm run format:check`·`git diff --check`를 실제 PASS했다. 문서 commit은 제품 검증 source와 구분 |

UI·AI inspector의 ordered product quit·Core 종료·wrapper exit0·force0은 확인했다. 이 근거를 main 자연 exit/native exit-code 증명으로 확대하지 않는다.
이전 f2의 별도 plain close·IME report·ZIP 결과는 해당 source의 역사다. 이전 성공으로 이후 제품 변경을 승인하지 않는다.

## 사람이 확인할 세 조건

- Windows native 한국어 IME15항목: **NOT TESTED**. report 자동화의 수동7필드 보존·15항목 상태·composition event null은 실제 IME 입력 시험이 아니다.
- HWPX layout: **PENDING**. native text 대조·ZIP/XML 자동 검증과 별도로 사람이 서식을 확인한다.
- 배포 범위: Typie 개발 permission은 owner-confirmed다. 소유자가 저장소 밖 exact grant와 배포 조건을 확인해야 공개·유료·고객·installer 배포를 판정할 수 있다.

## 실행 근거와 기록

- [직전03 전체 gate](.tools/verification/full-mono-verify-03e44d8-run1/metadata.json): terminal PASS; job3251/cleanup active0·host force0·desktop gone. 입력8,224표본 모두 소유 desktop 비활성이며 이름 미가용5회도 독립 inactive flag로 확인했다. 이름 관측은 Default→Screen-saver→Default로, 전표본 Default/이름 가용으로 표현하지 않는다.
- [직전03 UI](.tools/verification/ui-review-mono-03e44d8-run1/ui-review-evidence.json): 원본 CSS EPUB360/960px overflow0·package 전후 일치·관측한 오류/외부 요청0·모노톤42회 PASS.
- [직전03 실제 AI](.tools/verification/ai-ui-mono-03e44d8-run2/metadata.json): host PASS·AI8캡처·명시 동의한 loopback 외 관측 외부 요청0·job92/active0·host force0·desktop gone. 이전 source를 요구한 run1 실패는 보존했다.
- [직전03 whole package join](.tools/verification/full-mono-verify-03e44d8-run1/final-monochrome-package-join.json): canonical inventory SHA `f4ba3085db9115e00dbeaead06ad13031b26b2cabc25a10eca2aa3998aa8e5c1`·전체 inventory deep equality.
- [f2 보관 ZIP](output/releases/madi-0.0.1-win32-x64-f2efe6ebf4d02d5f56ec3f6ed5d9e74be6df8276): 이전 UI의 ZIP SHA `5a0df130…`·inventory SHA `4684dd2e…`. 현재 배포본으로 표현하지 않는다.
- 이전 f2 source archive는444개 source의 **RUNNING snapshot**을 그대로 보존한다. 해당 terminal full metadata와 별도로 연결하며 snapshot을 PASS로 고쳐 쓰지 않는다.
- 이전 UI·report 실패와 Node/npm·e2/source52/cde/f2 기록은 [오프라인 결과](docs/OFFLINE_RUNTIME_RELEASE_RESULT.md)에 revision-bound 역사로 보존한다.

## 검증 운용

필수 명령은 `npm ci`, `npm run verify`, `npm run package:unpacked`, `npm run check:repository`, `npm run format:check`, `git diff --check`다.
Full에서 실제 실행한 unpacked·repository·format은 해당 run에 연결한다. 후속 문서 변경 뒤 repository·format·diff를 다시 확인한다.
앱 시험은 소유 비활성 Win32 desktop·BelowNormal·GPU 비활성화에서 순차 실행하며 사용자 화면·키보드·포커스·clipboard를 바꾸지 않는다.
Rust jobs1·Vitest workers2·command process 한정 `CARGO_INCREMENTAL=0`을 유지한다.
명시적으로 호출한 사용자 소유 LLM 외 external runtime request는0이어야 한다. 원고·응답·키·private path를 로그에 남기지 않는다.
AI loopback은 remote HTTPS·인증키·OS clipboard·native IME·전체 AI process TCP 감사를 대신하지 않는다. AI wrapper 종료 근거와 plain/report native 자연 종료 근거는 구분한다.

상세 actual: [오프라인 결과](docs/OFFLINE_RUNTIME_RELEASE_RESULT.md), [HWPX](docs/PHASE_1H_RESULT.md), [AI](docs/PHASE_1I_RESULT.md), [코드 감사](docs/CODE_QUALITY_AUDIT.md).
사람의 확인: [IME 체크리스트](docs/MANUAL_KOREAN_IME_CHECKLIST.md), [Typie license](docs/TYPIE_LICENSE_STATUS.md). 집필·설정·기획·Reader Lab·EPUB의 상세 결과는 기존 Phase1A–1G 문서에 보존한다.
