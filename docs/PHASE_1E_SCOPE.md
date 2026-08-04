# Phase 1E — Plot Canvas & Story Planning Workspace 범위

기준일: 2026-08-08

```text
Phase 1D entry verdict: CONDITIONAL TECHNICAL GO — PRIVATE LOCAL
Phase 1E development boundary: PRIVATE LOCAL
Windows native Korean IME: MANUAL VALIDATION PENDING
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Public/paid/customer distribution: NOT AUTHORIZED
```

이 문서는 Phase 1E의 제품·기술 경계를 고정한다. 최종 판정, 실제 성능 수치와 실행
증거는 `PHASE_1E_RESULT.md`와 `PLOT_CANVAS_PERFORMANCE.md`에 기록한다. 측정 전 수치나
실행하지 않은 test/package 결과를 이 범위 문서에서 성공으로 간주하지 않는다.

## 1. 목적

Phase 1E는 작가가 플롯, 장면 흐름, 인물 동선, 결말 후보와 메모를 직접 배치하는
Plot Canvas를 기존 local-first `.madi` 프로젝트에 추가한다. Canvas의 node 위치,
크기, group과 edge는 단순 화면 배치가 아니라 작가가 만든 canonical planning data다.

Phase 1D hardening은 같은 작업에서 다음 원칙을 적용한다.

- World Graph 선택 시 강조와 detail shell을 즉시 표시한다.
- 관계·장면·언급 detail은 병렬로 lazy load한다.
- `projectId + revision + entityId` cache와 request generation으로 stale response를
  차단한다.
- 선택, detail, 검색 focus로 전체 layout을 다시 실행하지 않는다.
- 원고/Story Bible 내용을 성능 log에 넣지 않는 content-free timing만 수집한다.

## 2. World Graph와 Plot Canvas의 고정 경계

| 항목 | World Graph | Plot Canvas |
|---|---|---|
| 원천 | Story Bible entity/relation에서 파생 | 작가가 직접 만든 Canvas document |
| 쓰기 권한 | 읽기 전용 탐색 | node/edge/group을 생성·수정·삭제 |
| 위치 의미 | 재생성 가능한 graph UI state | 작가가 정한 canonical planning data |
| edge 의미 | 저장된 `entity_relations`의 파생 표현 | Canvas 안에서만 유효한 자유 연결선 |
| snapshot | graph UI state 제외 | Canvas document와 metadata 포함 |
| renderer | Cytoscape.js 3.34.0 | `@xyflow/react` exact 12.11.2 (MIT) |

Canvas edge를 만들거나 수정해도 `entity_relations`, `relation_types` 또는
`scene_entity_links`를 만들거나 수정하지 않는다. World Graph의 Cytoscape 객체와 Plot
Canvas의 React Flow 객체는 Rust, SQLite, preload 또는 snapshot 공개 계약이 아니다.

## 3. 저장 계층

Phase 1E는 logical `format_version = 1`을 유지하고 SQLite schema를 `5`로 올린다.
`canvases` table은 한 project에 여러 Canvas를 저장한다.

```text
MadiCanvasDocument (JSON Canvas 기반 canonical DTO)
              ↕ JsonCanvasAdapter
React Flow renderer DTO
              ↕ ReactFlowAdapter
@xyflow/react runtime objects
```

저장 identity는 다음과 같다.

```text
document_format: JSON_CANVAS
document_version: 1.0
content_hash: SHA-256 of core canonical document_json UTF-8 bytes
```

표준 기반은 [JSON Canvas 1.0 specification](https://jsoncanvas.org/spec/1.0/)이다.
구체적인 지원·제한은 `JSON_CANVAS_COMPATIBILITY.md`를 따른다.

## 4. 구현 범위

### Canvas lifecycle

- 여러 Canvas 생성, 목록, 이름·설명 수정, 복제와 확인 후 삭제
- 최근 수정/이름 오름차순·내림차순 정렬
- 같은 이름 허용과 목록의 중복 이름 안내
- 마지막 사용 Canvas 복원
- transaction, project revision과 Canvas별 optimistic revision
- 같은 canonical content의 no-op save에서 불필요한 revision 증가 방지

### 편집

- pan, zoom, fit view, dot grid, minimap, snap-to-grid
- node drag, resize, box/multi selection
- text, entity reference, scene reference, group node
- node 복제, 삭제, 색상, z-order와 group 소속
- edge 생성, label, 색상, 시작/끝/both arrow, solid/dashed/dotted line style
- session-local Undo/Redo 최대 100 entry와 drag coalescing
- `Ctrl+S`, `Ctrl+Z`, `Ctrl+Shift+Z`, `Ctrl+Y`, `Ctrl+D`, `Ctrl+K`, Delete

### Reference와 navigation

- entity reference는 `entityId`, scene reference는 `sceneNodeId`를 canonical identity로
  저장한다.
- 표시 이름·상태·요약 등은 현재 Story Bible/Binder read model에서 해석한다.
- fallback text와 `madi.originalLabel`은 외부 consumer와 broken-reference 표시에
  사용하며 canonical entity/scene 사본이 아니다.
- 삭제된 대상은 node를 자동 삭제하지 않고 broken reference로 표시한다.
- 사용자는 다른 대상으로 다시 연결하거나 일반 text로 변환하거나 node를 삭제한다.
- Story Bible/World Graph의 `캔버스에 추가`는 entity ID만 넘긴다.
- entity/scene reference는 기존 상세/원고 화면으로 이동할 수 있다.

### Autosave, import/export와 snapshot

- 약 500 ms document autosave, dirty/saving/saved/error 표시와 explicit flush
- Canvas 전환·mode 전환·창 닫기 전에 flush
- `canvasId + generation + saveSequence`를 대조해 stale request/response 차단
- 저장 실패 시 renderer의 현재 편집 document 유지
- UTF-8 `.canvas` import preview와 새 Canvas 생성
- deterministic JSON export, madi extension과 알 수 없는 JSON extension 보존
- logical snapshot payload v3에 Canvas metadata/document/hash/revision 포함
- payload v1/v2 decode·restore 유지
- Canvas session Undo, viewport, selection, inspector 폭과 React Flow 객체는 snapshot 제외

## 5. UI state 경계

작품별 `ui_state.key = 'plot-canvas.v1'`에는 다음 재생성 가능한 값만 저장한다.

- 마지막 Canvas ID
- Canvas별 viewport
- 마지막 선택 element ID
- inspector 폭
- grid, minimap, snap-to-grid 표시 값

이 row는 project revision을 올리지 않는다. named snapshot에는 `plot-canvas.v1`과
`world-graph.v1`을 포함하지 않으므로 restore 뒤에도 현재 사용자의 화면 배치를
유지한다. 기존 snapshot 계약상 Binder의 `workspace.v1`만 payload에 남는다.

## 6. 보안과 배포 경계

- Canvas text는 React text node로 렌더하고 `innerHTML`로 주입하지 않는다.
- `file`, `link`, HTML, iframe, 외부 web content node를 지원하지 않는다.
- import는 고정 file dialog capability로만 읽고 임의 path/fs API를 renderer에
  노출하지 않는다.
- 외부 link나 background path를 자동으로 열거나 가져오지 않는다.
- React Flow와 Cytoscape는 renderer lazy chunk로 분리한다.
- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`를 유지한다.
- 외부 runtime network request를 추가하지 않는다.

현재 개발은 비공개 로컬 범위다. 공개·유료·고객·외부 설치파일 배포는 승인되지
않았다. 특히 다음 상태는 Phase 1E에서도 바꾸지 않는다.

```text
Windows native Korean IME: MANUAL VALIDATION PENDING
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
```

## 7. 이번 단계에서 하지 않는 것

- Canvas edge의 Story Bible relation 자동 승격
- World Graph canonical 편집
- 자동 플롯 생성, 관계 추론 또는 LLM Canvas 생성
- 지속형 project-wide Canvas command log
- 시간축 Canvas, collaboration, server/cloud, mobile/web
- 외부 URL embed, iframe, 임의 HTML 또는 이미지 편집기
- Reader Lab, EPUB, HWP/HWPX와 배포/업데이트 계층

## 8. 검증 원칙

단위·통합 test는 schema/migration, Canvas CRUD/hash/revision, adapters, reference/group/
edge semantics, Undo/Redo, autosave/stale 차단, import/export, UI state, snapshot v3와
v1/v2 호환, lazy chunk와 Story Bible relation 불변을 다룬다.

성능은 일반 fixture와 node 500/edge 1,000 대규모 fixture에서 실제로 실행한 결과만
보고한다. 목표값은 acceptance 기준이지 성공 수치가 아니다. 개발/packaged Electron,
reopen, 외부 요청 0과 repository gate도 실행 결과가 있을 때만 `PASS`로 기록한다.
