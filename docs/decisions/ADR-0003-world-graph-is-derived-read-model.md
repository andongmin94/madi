# ADR-0003: World Graph는 Story Bible의 파생 read model이다

- 상태: Accepted
- 날짜: 2026-08-02
- 범위: Phase 1D — World Graph Read Model & Visualization

## 맥락

Phase 1C의 `entities`, `entity_aliases`, `tags`, `entity_tags`,
`relation_types`, `entity_relations`, `scene_entity_links`가 세계관 설정과 관계의
canonical source다. Phase 1D는 이 데이터를 Obsidian식 관계 그래프로 탐색하게 하지만,
그래프 배치와 표시 필터는 작품 의미가 아니라 사용자별 화면 상태다.

그래프 라이브러리의 node·edge 객체를 canonical 모델로 저장하면 같은 관계가 Story
Bible과 그래프 양쪽에서 중복 관리되고, layout 변경이 작품 revision이나 named
snapshot을 불필요하게 오염시킨다. 그래프에서 관계 편집까지 허용하면 기존 Story Bible
검증·저장·snapshot 경계를 우회할 수도 있다.

## 결정

1. World Graph는 Rust core가 Story Bible canonical table에서 매 요청마다 만드는
   읽기 전용 madi 소유 DTO다.
2. 그래프 전용 canonical table을 만들지 않는다. Cytoscape element·instance와 type은
   renderer 내부에만 둔다.
3. node 위치, viewport, layout, filter, full/focused mode와 마지막 선택은
   `ui_state.key = 'world-graph.v1'`에 작품별로 저장한다.
4. named snapshot은 기존 logical Story Bible payload만 포함하며 `world-graph.v1`을
   capture하거나 restore하지 않는다. snapshot 복원 뒤에도 현재 그래프 배치를 유지한다.
5. node drag는 화면 위치만 바꾼다. 그래프에서 relation을 생성·수정·삭제하지 않는다.
6. 관계 편집은 기존 Story Bible 화면으로 이동해 수행한다.
7. renderer는 revision이 오래된 read model 응답을 적용하지 않는다.
8. 향후 graph editing이 필요하면 canonical write 명령, 충돌 처리, undo/snapshot 의미를
   별도 Phase와 ADR에서 재검토한다.

## 결과

- `.madi`의 `format_version = 1`, `schema_version = 4`와 canonical schema를 유지한다.
- graph UI state 저장은 project revision을 올리지 않는다.
- Story Bible 변경 뒤 전체 read model을 다시 읽어도 canonical 데이터가 중복되지 않는다.
- Cytoscape.js를 교체하거나 layout을 바꿔도 파일 포맷과 preload/core 계약은 madi DTO로
  안정적으로 유지된다.
- 목록 기반 Story Bible은 그래프를 사용하기 어려운 사용자를 위한 동등한 canonical
  탐색·편집 경로로 계속 남는다.

## 거부한 대안

- Cytoscape JSON을 canonical table 또는 named snapshot에 저장
- graph 전용 entity/relation 사본 table 생성
- node drag나 edge gesture로 즉시 canonical relation 생성
- renderer에서 SQLite를 직접 읽기
