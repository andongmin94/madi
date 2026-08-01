# madi Phase 0 제품 범위

## 목적

Phase 0의 유일한 목적은 Typie의 Rust 편집기 엔진을 Electron + React 기반의
로컬 Windows 앱에서 실제 편집 코어로 사용할 수 있는지 검증하고, 편집 결과를
SQLite 기반 단일 `.madi` 파일에 저장했다가 복원하는 것이다.

제품명은 언제나 소문자 `madi`로 표기한다.

## 이번 시제품이 증명해야 하는 것

- Typie의 고정된 소스 commit에서 browser WASM을 직접 빌드할 수 있다.
- Typie 계정, API, 클라우드, 동기화 또는 서버 없이 renderer 안에서 편집할 수 있다.
- 키 입력, IME 조합, 커서, 선택, Undo/Redo, clipboard, transaction, 화면 렌더링은
  renderer의 Typie WASM 경계 안에서 처리된다.
- Typie CRDT changeset bundle을 snapshot으로 추출하고 다시 열 수 있다.
- snapshot과 plain-text recovery copy를 실제 SQLite `.madi` 파일에 저장한다.
- 앱/sidecar 프로세스가 종료된 뒤 파일을 다시 열어 동일한 snapshot을 복원한다.
- 장면 구분선을 단순한 `* * *` 문자열이 아니라 Typie의 독립 의미 노드로 표현한다.
- 원고를 UI 없이 별도 Rust CLI로 복구할 수 있다.

## 구현 범위

- 단일 Electron 창
- React 검증 UI
- 중앙 Typie Canvas 편집기
- 새 프로젝트, `.madi` 열기, 저장
- 장면 구분선 삽입
- Undo, Redo
- 저장 상태와 engine/snapshot 개발 정보
- 한국어 IME 수동 테스트 패널
- 좁은 `MadiEditorAdapter` 경계
- sandboxed preload API
- Rust JSON-lines JSON-RPC sidecar
- SQLite format v0 및 migration v1
- 자동화 가능한 TypeScript, Rust, process-restart 통합 테스트

## 명시적으로 제외하는 것

- 완성형 제품 UI
- 작품/권/화/장면 Binder
- 세계관 그래프, 플롯 캔버스, Reader Lab
- HWP/HWPX, EPUB
- LLM adapter
- 자동 업데이트
- Dropbox, MYBOX, NAS 연동
- 모바일 또는 웹 앱
- 계정, 자체 서버, 자체 클라우드, 실시간 협업, 결제
- plugin marketplace
- Typie 제품 UI 복제

## 데이터 및 네트워크 원칙

- 원고의 정본은 사용자가 선택한 로컬 `.madi` 파일이다.
- 원고 본문은 console, 오류 로그, telemetry, crash report에 기록하지 않는다.
- 실행 중 외부 네트워크 요청은 main process의 session guard가 거부한다.
- WASM, ICU 데이터, 한국어 글꼴은 앱에 포함된 로컬 자산만 사용한다.
- 의존성 설치와 Typie 소스 취득 이후에는 Typie 또는 madi 서버가 필요 없다.

## Phase 0의 품질 한계

- 한글 IME 자동 테스트는 event translation과 engine transaction까지만 검증한다.
- Windows의 실제 한국어 IME 동작은 사람이 체크리스트를 수행하기 전까지
  `NOT TESTED`다.
- Phase 0 파일 포맷은 문서 한 개만 다룬다.
- Typie API는 `0.0.1`이며 안정화 보장이 없으므로 commit을 바꾸는 작업은
  migration과 adapter 재검증을 동반해야 한다.
