# Phase 1B — Manuscript Workspace 범위와 완료 계약

기준일: 2026-08-02

```text
Input baseline: TECHNICAL GO — PRIVATE LOCAL (Phase 1A)
Implementation branch: codex/phase-1b
Final verdict: TECHNICAL GO — PRIVATE LOCAL
Windows native Korean IME: MANUAL VALIDATION PENDING
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Public/paid/customer distribution: NOT AUTHORIZED
```

이 문서는 Phase 1B에서 구현한 범위와 완료 판정 기준을 고정한다. 실제 검증 결과와
남은 조건은 [`PHASE_1B_RESULT.md`](PHASE_1B_RESULT.md)를 따른다. 이 단계의 목적은
새 제품 영역을 넓히는 것이 아니라 Phase 1A의 장면별 저장 계약 위에 장편 원고
작업공간을 세우는 것이다.

## 1. 유지하는 기준선

다음 Phase 1A 계약은 변경하지 않는다.

- Electron main / sandboxed preload / React renderer 구조
- TypeScript strict mode와 고정된 preload capability 목록
- Rust `madi-core` JSON-RPC sidecar와 단일 SQLite `.madi` 파일
- `WORK → VOLUME → CHAPTER → SCENE` 및 `WORK → CHAPTER → SCENE` Binder
- SCENE별 독립 Typie snapshot과 UTF-8 plain-text recovery
- scene break의 의미 node `madi.scene-break.v1`
- 자동저장, `Ctrl+S`, 장면 전환 전 저장, 종료 전 저장
- document ID, generation, save sequence와 project revision을 이용한 stale-write 방지
- `MadiEditorAdapter` / `TypieEditorAdapter` 경계
- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`
- production external network 차단과 local asset runtime

Typie 내부 Rust/wasm 타입은 검색 결과, snapshot payload, React component, IPC 계약 또는
일반 madi 저장 코드에 노출하지 않는다.

## 2. 구현 범위

### 2.1 Scrivenings

- SCENE 선택은 기존 단일 장면 편집기를 유지한다.
- WORK, VOLUME, CHAPTER 선택은 하위 SCENE을 Binder 순서로 연속 표시한다.
- 각 SCENE은 계속 독립 document/snapshot이다. 합성 Typie document를 만들지 않는다.
- 활성 장면 한 개만 기존 Typie editor instance를 사용한다.
- 비활성 장면은 plain-text recovery 기반 read-only block으로 표시한다.
- 활성 장면 전환은 현재 composition 검사와 저장 성공 뒤에만 수행한다.
- Binder의 container 선택과 Scrivenings 내부 active/highlighted SCENE을 별도 상태로 둔다.
- 근처 block만 무거운 본문 renderer를 사용하고 먼 block은 높이를 가진 placeholder로
  남긴다.

자세한 구조는 [`SCRIVENINGS_ARCHITECTURE.md`](SCRIVENINGS_ARCHITECTURE.md)에 기록한다.

### 2.2 정확한 작품 검색

- 작품명과 WORK/VOLUME/CHAPTER/SCENE 제목 검색
- SCENE plain-text recovery 본문 검색
- `TITLES`, `BODIES`, `ALL` target
- 현재 선택 subtree 또는 WORK 전체 scope
- 대소문자 구분 선택
- 비중첩 정확 부분 문자열 결과, Unicode scalar offset, 앞뒤 문맥
- 장면별 결과 그룹, 결과 클릭 이동과 본문 범위 reveal
- 검색어 변경 debounce와 단일 장면/Scrivenings 강조
- 저장된 `plain_text_recovery`와 transactionally 동기화되는 검색 projection
- 공백 포함/제외 Unicode scalar 글자 수와 SCENE 수

현재 구현은 FTS5/trigram에 의존하지 않는다. 누락 없는 정확성 우선 순회 방식과 한계는
[`SEARCH_REPLACE_SEMANTICS.md`](SEARCH_REPLACE_SEMANTICS.md)를 따른다.

### 2.3 선택적 의미 치환

- BODY 검색 결과별 checkbox, 모두 선택, 모두 해제
- 치환될 장면 수와 occurrence 수 preview
- 제목 결과는 이동할 수 있지만 치환 대상에서는 제외
- preview revision과 각 본문의 SHA-256 source hash 검증
- 한 SCENE 안의 선택 occurrence를 Typie transaction 한 건으로 변환
- paragraph, scene break, 비-text 구조 fingerprint와 editor identity 검증
- 모든 대상 document를 하나의 SQLite transaction에서 commit
- 적용 transaction 안에서 `AUTO_BEFORE_REPLACE` 논리 snapshot 생성
- 실패 시 safety snapshot과 document update를 함께 rollback
- 성공 뒤 검색, snapshot 목록, tree와 현재 editor reload

줄바꿈 삽입, semantic atom/scene break를 가로지르는 범위, block을 가로지르는 범위,
혼합 modifier ownership 범위는 안전하게 변환할 수 없으므로 적용하지 않는다.

### 2.4 이름 있는 논리 snapshot

- `MANUAL`, `AUTO_BEFORE_REPLACE`, `AUTO_BEFORE_RESTORE` 종류
- 이름, 선택 메모, 생성/수정 시각, payload 크기와 SHA-256 hash
- 생성, 목록, 이름 변경, 삭제
- 현재 상태와의 구조/본문/문자 수 요약 diff
- 복원 전 diff 기반 확인
- 복원 transaction 안에서 현재 상태를 `AUTO_BEFORE_RESTORE`로 먼저 저장
- 대상 payload hash/형식/프로젝트/계층/document 무결성 확인 뒤 logical restore
- Binder, `workspace.v1`, 현재 editor와 검색 projection reload

payload는 SQLite 파일 복사본이 아니라 uncompressed UTF-8 versioned JSON이다. 자세한
계약은 [`NAMED_SNAPSHOT_FORMAT.md`](NAMED_SNAPSHOT_FORMAT.md)를 따른다.

### 2.5 `.madi` schema 3

- 논리 `format_version = 1` 유지
- `app_meta.schema_version = 3`
- `PRAGMA user_version = 3`
- `search_documents` projection과 documents trigger
- `named_snapshots` 및 payload metadata/hash
- migration record 3
- schema 2 파일의 documents를 transaction 안에서 search projection으로 backfill

schema 1/2 입력은 기존 migration chain을 따라 열 때 schema 3으로 올라간다. 세부 SQL과
compatibility는 [`MADI_FILE_FORMAT_V1_DRAFT.md`](MADI_FILE_FORMAT_V1_DRAFT.md)를 따른다.

## 3. 안전 불변식

1. Scrivenings는 SCENE 문서를 병합하지 않는다.
2. 동시에 live인 Typie editor instance는 하나다.
3. 장면 전환 전 현재 dirty document 저장이 실패하면 기존 장면과 editor를 유지한다.
4. 검색 본문은 마지막 성공 save의 `plain_text_recovery`를 기준으로 한다.
5. search preview revision 또는 source hash가 stale이면 치환을 거부한다.
6. plain-text recovery만 직접 수정하는 치환 경로는 없다.
7. 치환된 snapshot과 recovery는 같은 Typie 변환 결과에서 나온다.
8. 다중 SCENE commit, 자동 치환 전 snapshot과 revision bump는 한 DB transaction이다.
9. restore 전 safety snapshot과 logical restore는 한 DB transaction이다.
10. named snapshot payload는 named snapshot table 자체와 search projection을 포함하지
    않는다.
11. payload hash 또는 구조 검증 실패는 canonical project를 바꾸지 않는다.
12. 오류와 inspection 응답에는 원고 본문이나 Typie snapshot bytes를 출력하지 않는다.

## 4. 완료 증거

### Rust/core

- schema 2 → 3 migration과 검색 projection backfill
- descendant SCENE 순서와 pagination
- 한국어 exact substring, 저장 뒤 결과 갱신, bounded result page
- scope별 공백 포함/제외 글자 수
- logical snapshot hash/CRUD/diff/restore/reopen
- snapshot 재귀 포함 방지와 지원 UI key 제한
- restore 전 자동 snapshot과 transaction rollback
- selective replacement의 revision/hash/identity/transduction 검증
- 다중 document update 중 실패 rollback

### TypeScript/React/main/preload

- SCENE mode와 WORK/VOLUME/CHAPTER Scrivenings mode
- 하나의 live editor relocation과 save-before-switch failure 유지
- 근처 block windowing, 검색 highlight와 Binder 내부 장면 표시
- 검색 option/result/navigation과 선택 치환 preview
- named snapshot CRUD/diff/restore confirmation
- 고정 IPC allowlist와 Uint8Array copy/shape validation
- stale request, malformed result와 revision mismatch 거부

### 통합과 실제 앱

- 1 WORK, 2 VOLUME, 4개 이상 CHAPTER, 10개 이상 SCENE fixture
- 한국어 본문, 의미 scene break, WORK/VOLUME ordered Scrivenings
- 한국어 검색, 일부 occurrence 치환, semantic postcondition
- 자동 치환 전 snapshot, diff, restore, 원문/순서 복구
- 두 core process 사이 reopen 뒤 검색·snapshot 목록 보존
- 실제 Electron 개발 앱의 검색/치환/snapshot/복원 흐름
- unpacked 앱 실행 smoke와 기존 Phase 0.5/1A 회귀

집중 test가 통과해도 아래 최종 gate를 모두 실행하기 전 aggregate completion으로
기록하지 않는다.

```powershell
pnpm verify
pnpm package:unpacked
pnpm test:electron
pnpm test:package
```

## 5. 이번 단계에서 제외한 것

- 등장인물, 세계관, 관계 그래프, plot canvas
- docking workspace
- 장면별 line/word diff
- 플랫폼별 출판 글자 수 규칙
- Reader Lab, EPUB, HWP/HWPX
- LLM adapter
- cloud/sync, NAS provider, account, server, collaboration
- web/mobile app
- installer, code signing, automatic update, public distribution
- Typie 제품 UI 복제

## 6. 판정 경계

최종 판정은 `TECHNICAL GO — PRIVATE LOCAL`이다. Project-wide 치환을 하나의 지속
가능한 사용자 `Ctrl+Z` history entry로 보존하지 않으며, 이는 미해결 구현 조건이
아니라 확정된 제품 경계다. 각 장면의 headless Typie 변환은 한 transaction/undo
entry이고 여러 장면을 아우르는 공식 rollback UX는 자동 `AUTO_BEFORE_REPLACE`
snapshot restore다. 이 결정은
[`ADR-0002`](decisions/ADR-0002-project-wide-undo-via-snapshots.md)에 기록돼 있다.

또한 Windows native 한국어 IME는 `MANUAL VALIDATION PENDING`, Typie 라이선스 결정은
`HUMAN DECISION REQUIRED BEFORE DISTRIBUTION`이다. 이 조건은 비공개 로컬 개발을
막지 않지만 public download, 유료 pilot, 고객 전달 또는 production 배포를 승인하지
않는다.
