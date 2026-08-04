# ADR-0004: Plot Canvas는 작가 소유 planning data다

- Status: Accepted for Phase 1E private-local development
- Date: 2026-08-08
- Decision scope: Plot Canvas persistence, World Graph separation, renderer boundary, snapshot과 Undo

## Context

Story Bible에는 작품의 canonical entity, relation과 SCENE link가 저장된다. Phase 1D
World Graph는 이 데이터를 읽어 분석·탐색용 graph를 파생한다. 작가는 별도로 플롯,
장면 순서 후보, 인물 동선과 메모를 자유롭게 배치할 시각적 작업 공간이 필요하다.

이 두 graph를 같은 모델로 취급하면 다음 문제가 생긴다.

- 자유로운 Canvas edge가 세계관의 공식 relation으로 오인된다.
- 분석 화면의 자동 layout과 작가가 의도한 배치가 충돌한다.
- Cytoscape/React Flow runtime type이 core와 file format에 결합된다.
- snapshot restore가 작가의 계획 자료를 빠뜨리거나 UI 배치까지 불필요하게 되돌린다.

## Decision

1. World Graph는 Story Bible canonical data에서 파생한 read-only model이다.
2. Plot Canvas는 작가가 만든 canonical planning data다.
3. Canvas node의 위치·크기·z-order·group 소속과 edge는 Canvas document 내용이다.
4. Canvas edge는 Story Bible `entity_relations`와 별개이며 자동으로 승격하지 않는다.
5. 저장 계약은 JSON Canvas 1.0 기반 `MadiCanvasDocument`다.
6. React Flow와 Cytoscape type은 저장 포맷, Rust, SQLite, preload 또는 snapshot 계약이
   아니다.
7. viewport, selection, inspector 폭, grid/minimap/snap 옵션은 `plot-canvas.v1` UI
   state이며 Canvas document가 아니다.
8. Canvas metadata/document/hash/revision은 named snapshot payload v3에 포함한다.
9. Canvas UI state와 session Undo/Redo history는 named snapshot에 포함하지 않는다.
10. session-local Undo/Redo는 유지하지만 persistent project-wide command log를 만들지
    않는다. 장기 rollback은 named snapshot을 사용한다.

## Consequences

### Positive

- 작가는 공식 설정을 훼손하지 않고 자유롭게 여러 계획안을 만들 수 있다.
- World Graph는 canonical relation에 대한 신뢰 가능한 읽기 전용 분석 화면으로 남는다.
- `.madi`와 `.canvas`가 renderer library 변경과 독립적인 DTO를 가진다.
- node geometry와 edge를 snapshot으로 복원할 수 있다.
- viewport나 selection은 snapshot restore 뒤에도 현재 사용자 배치를 유지할 수 있다.

### Trade-offs

- 동일한 entity pair가 World Graph relation과 Canvas edge에 서로 다른 의미로 존재할 수
  있다. Inspector 문구와 문서가 이 차이를 설명해야 한다.
- Entity/SCENE 삭제 뒤 Canvas reference는 broken state로 남고 사용자가 재연결하거나
  변환해야 한다.
- Canvas history는 앱 재시작 뒤 복원되지 않는다. 지속형 되돌리기는 더 무거운 named
  snapshot restore다.
- JSON Canvas 호환 계층과 React Flow adapter를 별도로 유지해야 한다.

## Rejected alternatives

### Canvas edge를 Story Bible relation으로 자동 저장

자유 메모/흐름과 세계관의 공식 relation을 섞고 의도하지 않은 canonical mutation을
만들기 때문에 거부한다. 향후 명시적 승격 workflow는 별도 결정이 필요하다.

### React Flow state를 그대로 SQLite에 저장

Library-specific runtime field, event와 version 변화가 file format에 누출되고 Rust가
프론트엔드 type에 결합되므로 거부한다.

### Canvas geometry를 UI state로만 저장

작가가 의도적으로 만든 spatial composition을 snapshot과 export에서 잃으므로
거부한다.

### 모든 Canvas edit을 persistent command log로 저장

현재 요구에는 session Undo와 named snapshot이 충분하며 복잡한 project-wide command
replay/compaction 모델을 추가할 근거가 없으므로 거부한다.

## Compatibility

새 Canvas는 SQLite schema 5와 logical snapshot payload v3에서 시작한다. Logical
`.madi` format version은 1을 유지한다. Snapshot decoder는 v1/v2를 계속 수용하되 이전
payload에 존재하지 않던 Canvas state를 암묵적으로 현재 값과 merge하지 않는다.

## Distribution note

이 결정은 비공개 로컬 개발을 승인할 뿐 공개 배포를 승인하지 않는다.

```text
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Public/paid/customer distribution: NOT AUTHORIZED
```
