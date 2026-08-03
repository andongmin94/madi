# Phase 1D — World Graph Read Model & Visualization 범위

## 상태와 목표

```text
Phase 1C baseline: TECHNICAL GO — PRIVATE LOCAL
Phase 1D target: WORLD GRAPH READ MODEL & VISUALIZATION
Windows native Korean IME: MANUAL VALIDATION PENDING
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Distribution: PRIVATE LOCAL ONLY
```

Phase 1D는 Phase 1C Story Bible의 entity와 relation을 수정하지 않는 파생 read model로
읽어, 전체 세계관과 특정 entity 중심 1~3 hop 이웃을 Cytoscape.js로 탐색하는 실제
Electron 화면을 제공한다.

## 완료 범위

- Rust core의 `get_world_graph`, `get_world_graph_stats`,
  `get_entity_graph_detail`, `get_entity_scene_context` read-only 명령
- entity·alias·tag·relation type·relation·scene link를 결합한 madi DTO
- 전체 graph와 안정적인 양방향-neighbor BFS 기반 1/2/3 hop focused graph
- 8종 entity kind, 상태, 태그 ANY/ALL, relation type, 방향, 고립 node와 label filter
- 이름·별칭·태그·요약 검색과 node focus
- directed arrow, undirected 단일 no-arrow edge, forward/inverse detail label
- node/edge selection, 이웃 강조, 통계와 lazy-loaded detail/mention context
- Story Bible entity·관계 및 원고 SCENE 이동
- node drag 위치, viewport, filter와 mode의 project별 `world-graph.v1` 복원
- 500 entity / 1,500 alias / 2,000 relation / 2,000 scene link 성능 검증
- development와 unpacked Electron의 offline 실행·재실행 smoke

## 불변 경계

- canonical source는 기존 Story Bible table이다.
- graph 전용 canonical table과 schema migration을 만들지 않는다.
- graph에서 relation write를 노출하지 않는다.
- Cytoscape type은 renderer의 변환 계층 밖으로 내보내지 않는다.
- graph UI state는 named snapshot payload에 포함하지 않는다.
- label, summary와 note는 React text/Cytoscape data로만 전달하고 HTML을 주입하지 않는다.
- renderer에 Node 권한이나 외부 네트워크 요청을 추가하지 않는다.

## 제외 범위

그래프 관계 편집, plot Canvas, React Flow, JSON Canvas, 시간축, 인물별 지식 시점,
SCENE node, 자동 관계 추론, 설정 충돌/복선 자동 판정, LLM 분석, Reader Lab, 출판
포맷, cloud/sync/collaboration, 자동 업데이트, 회원·서버·웹·모바일과 플러그인 마켓은
Phase 1D 범위가 아니다.

## 완료 gate

다음 명령이 모두 exit code 0이어야 한다.

```powershell
pnpm verify
pnpm package:unpacked
pnpm test:electron
pnpm test:package
pnpm check:repository
pnpm format:check
```

성능 목표를 초과하거나 실제 Electron 복원이 불안정하면 이를 숨기지 않고
`CONDITIONAL TECHNICAL GO` 이하로 판정한다. 자동 테스트는 Windows native IME 수동
상태와 Typie 배포 라이선스 결정을 변경하지 않는다.
