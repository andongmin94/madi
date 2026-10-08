# madi 개발 계획

갱신일: 2026-10-08. 작업 위치: `main`. 현재 실행 계획은 이 문서 하나로 관리한다.

## 현재 상태

`neobrutal-ui`의 원본 기본 Mono 테마를 적용했고 자동 작업을 완료했다. 검증한 제품 source는 `d96bd0f50e45c9e999cd360a58e2c49d9a6b047c`다.
Exact source 전후 clean에서 전체 Windows gate·fresh-unpacked 실사용·실제 AI UI 검수를 통과했다. Full이 만든 전체 배포 inventory를 화면 검수본 및 AI 전후 파일과 실제 연결했다.
후속 문서 commit은 제품 검증 source와 구분한다. 직전03의 일반 회색 구현은 기본 Mono 요구를 충족하지 못했으며,03/b9/f2의 검증·실패 근거는 [오프라인 결과](docs/OFFLINE_RUNTIME_RELEASE_RESULT.md)에 해당 revision의 역사로 보존한다.
Node24.21.0/npm12.2.0/Rust1.97.1을 고정한다. 설치는 `npm ci`, 실행은 `npm run <script>`다.
Private-local 기술 완료이며 공개·유료·고객·installer 배포 승인을 뜻하지 않는다. 사람의 확인 조건은 아래 세 항목이다.

## 기본 Mono 적용 완료

- Reference `b4da2463fe710a77bf464c65125a1a7f40424722`의 기본 Mono 값을 적용했다. 주요 버튼·선택은 `#27282b`/`#f4f5f7`, neutral 입력/sidebar는 흰색/검정, 카드·outline은 `#f4f5f7`/검정이다.
- 검정4px 그림자·5px radius·hover3px/active4px와 원본 error/destructive 의미색을 적용했다. 폐기한 accent-soft 경로를 제거했다. 추가 npm 의존성은 없다.
- Pretendard v1.3.9 오프라인 UI·canvas 폰트와 사용자 작품색·Reader/출판 preset·원고/저장/AI 계약을 유지했다. 이전 폰트 coverage·자산 근거는 b9 결과에 보존한다.
- 실제 computed token12개·색상쌍·선택8종을43회 확인했다. 주요 버튼 rest/hover/active·disabled 그림자와 활성 Scrivenings·선택 복원을 확인했다. 모든 화면을 grayscale로 검사하지 않는다.
- 4개 창 크기40 layout·57캡처·폰트10회·Graph/Canvas8회·Canvas zoom4회와 저장·재열기를 통과했다. Drawer 열림 상태의 전체 콘텐츠 동시 노출이나 임의 작품색·모든 버튼/저장 phase의 검증으로 확대하지 않는다.

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

## d96 source의 자동 작업 완료

| 항목 | 실제 결과 |
| --- | --- |
| 고정 npm workspace | Node24.21.0/npm12.2.0/Rust1.97.1·committed lock. exact source의 `npm ci` 실제 PASS15.912초/exit0 |
| 전체 Windows gate | terminal PASS4277.253초/exit0. desktop102파일/714테스트·별도 bundle4 시험, 개발판·fresh unpacked Basic/D–H, Rust·Typie·integration·build 포함 |
| EPUB·HWPX | exact coverage·ZIP/XML 재열기·결정성·취소·no-clobber·cleanup 통과. HWPX 장편 exporter max 개발판881ms/배포판89ms; native exporter 시간으로 UI wall·사람의 서식 승인은 별도 |
| 배포 package 연결 | 556파일/80디렉터리/551,939,563B. UI 전과 Full 후 전체 inventory deep equality·AI 전후 및 최종 현재 tree 일치. 새 ZIP은 만들지 않음 |
| 실제 AI UI | host PASS33.783초/exit0·actual probe23.974초. 동의·exact same-block 적용·Undo/Redo·저장·재열기·AI4화면×2크기 통과. 실제 진단 기대문구 불일치 경고 보존 |
| 실사용 기본 Mono UI | harness PASS72.370초·host PASS74.069초/exit0. 원본값43회·57캡처·폰트10회·4크기40화면, 집필·설정·치환·Reader·EPUB/HWPX·재열기·스키마/원고19테이블 보존 |
| 결과 연결 | exact source/full/UI/AI·전체 package join 실제 PASS. 결과 연결 도구의 UTF-16LE 로그 해석 실패와 보정본을 보존했고 runtime 결과 원본은 유지 |

UI·AI inspector의 ordered product quit·Core 종료·wrapper exit0·force0은 확인했다. 이 근거를 main 자연 exit/native exit-code 증명으로 확대하지 않는다.
이전 성공으로 이후 제품 변경을 승인하지 않는다. 별도 plain close·IME report·ZIP 등 revision-bound 상세 근거는 결과 문서에서 관리한다.

## 사람이 확인할 세 조건

- Windows native 한국어 IME15항목: **NOT TESTED**. report 자동화의 수동7필드 보존·15항목 상태·composition event null은 실제 IME 입력 시험이 아니다.
- HWPX layout: **PENDING**. native text 대조·ZIP/XML 자동 검증과 별도로 사람이 서식을 확인한다.
- 배포 범위: Typie 개발 permission은 owner-confirmed다. 소유자가 저장소 밖 exact grant와 배포 조건을 확인해야 공개·유료·고객·installer 배포를 판정할 수 있다.

## 실행 근거와 기록

- [현재 전체 gate](.tools/verification/full-default-mono-verify-d96bd0f-run1/metadata.json): terminal PASS; job3059/cleanup active0·host force0·desktop gone. 입력8,427표본 모두 Default/owned inactive·이름 미가용0이다.
- [현재 UI](.tools/verification/ui-review-default-mono-d96bd0f-run1/ui-review-evidence.json): 원본 기본 Mono43회·EPUB360/960px overflow0·package 전후 일치·관측 오류/외부 요청0.
- [현재 실제 AI](.tools/verification/ai-ui-default-mono-d96bd0f-run1/metadata.json): host PASS·AI8캡처·명시 동의한 loopback 외 관측 외부 요청0·job92/active0·host force0·desktop gone.
- [현재 whole package join](.tools/verification/full-default-mono-verify-d96bd0f-run1/final-default-mono-package-join.json): canonical inventory SHA `ec47c66f4bef4313e3acd2decbe7ffb6b832b2e400894106f010fb4514067c3a`·전체 inventory deep equality와 최종 tree 일치.
- 이전 구현·실패·ZIP·source archive·IME report는 [오프라인 결과](docs/OFFLINE_RUNTIME_RELEASE_RESULT.md)의 해당 revision 절에 보존한다.

## 검증 운용

필수 명령은 `npm ci`, `npm run verify`, `npm run package:unpacked`, `npm run check:repository`, `npm run format:check`, `git diff --check`다.
Full에서 실제 실행한 unpacked·repository·format은 해당 run에 연결한다. 후속 문서 변경 뒤 repository·format·diff를 다시 확인한다.
앱 시험은 소유 비활성 Win32 desktop·BelowNormal·GPU 비활성화에서 순차 실행하며 사용자 화면·키보드·포커스·clipboard를 바꾸지 않는다.
Rust jobs1·Vitest workers2·command process 한정 `CARGO_INCREMENTAL=0`을 유지한다.
명시적으로 호출한 사용자 소유 LLM 외 external runtime request는0이어야 한다. 원고·응답·키·private path를 로그에 남기지 않는다.
AI loopback은 remote HTTPS·인증키·OS clipboard·native IME·전체 AI process TCP 감사를 대신하지 않는다. AI wrapper 종료 근거와 plain/report native 자연 종료 근거는 구분한다.

상세 actual: [오프라인 결과](docs/OFFLINE_RUNTIME_RELEASE_RESULT.md), [HWPX](docs/PHASE_1H_RESULT.md), [AI](docs/PHASE_1I_RESULT.md), [코드 감사](docs/CODE_QUALITY_AUDIT.md).
사람의 확인: [IME 체크리스트](docs/MANUAL_KOREAN_IME_CHECKLIST.md), [Typie license](docs/TYPIE_LICENSE_STATUS.md). 집필·설정·기획·Reader Lab·EPUB의 상세 결과는 기존 Phase1A–1G 문서에 보존한다.
