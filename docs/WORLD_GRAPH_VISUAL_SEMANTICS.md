# World Graph Visual Semantics

## Node

Node는 색상뿐 아니라 shape와 text badge로 entity kind를 구분한다.

| Kind | 기본 형태 | 의미 |
|---|---|---|
| `CHARACTER` | ellipse | 등장인물 |
| `LOCATION` | round-rectangle | 장소 |
| `ORGANIZATION` | hexagon | 조직 |
| `ITEM` | diamond | 물건 |
| `EVENT` | 가로로 긴 ellipse | 사건 |
| `WORLD_RULE` | rectangle | 세계관 규칙 |
| `FORESHADOWING` | star | 복선 |
| `OTHER` | octagon | 기타 |

entity `color_token`이 안전한 지원 token이면 기본색보다 우선한다. `icon_key`는 text
metadata로 표시하며 사용자 값을 HTML로 해석하지 않는다. `ARCHIVED`는 기본 status
filter에서 숨기고 사용자가 포함하면 opacity와 상태 text로 구분한다. Degree에 따른 크기
변화는 완만하게 제한한다.

## Edge

- directed: source에서 target으로 triangle arrow, canvas에는 forward label
- undirected: arrow 없음, canonical relation ID당 line 하나
- relation type color token: 지원 token일 때 line color에 적용
- label off 또는 낮은 zoom: `min-zoomed-font-size: 7`로 edge label을 숨기며,
  selected/connected edge는 이 제한을 해제
- selected/hover detail: full forward/inverse label과 note를 text로 표시

Self relation diagnostic은 canvas에 그리지 않는다. endpoint가 filter로 숨겨지면 edge도
숨긴다.

## Selection과 focus

Node 선택 시 node와 1-hop neighbor/edge를 강조하고 다른 element를 흐리게 한다. detail
panel에는 이름, kind/status/summary, alias/tag, 방향별 relation, scene link와 lazy mention
후보 수를 표시한다. 키보드 사용자는 검색 결과 또는 접근 가능한 node 목록에서 선택한 뒤
detail panel로 focus를 옮길 수 있다.

Edge 선택 시 양 endpoint를 강조하고 relation type, 방향, forward/inverse label과 note를
보여준다. `관계 편집에서 열기`는 source entity가 선택된 기존 Story Bible 화면으로
이동할 뿐 graph에서 write를 수행하지 않는다.

## Full과 focused mode

Full mode는 filter를 통과한 node와 양 endpoint가 보이는 edge를 모두 표시한다. Focused
mode는 선택 entity에서 시작해 depth 1/2/3까지 BFS한다. 탐색에서 directed와 undirected
edge는 모두 양방향 neighbor로 취급한다. 순회 순서는 entity ID로 안정화하며 같은 depth의
결과가 실행마다 흔들리지 않게 한다.

## Filter와 검색

Kind, status, tag ANY/ALL, relation type, direction, isolated, labels를 client-side로
결합한다. 기본 status는 `ACTIVE`와 `DRAFT`다. 검색은 name, alias, tag name, summary의
case-insensitive substring이며 결과에는 entity kind를 함께 표시한다. 검색 node가 filter로
숨겨져 있으면 이유를 알리고 canonical 모델을 수정하지 않는다.

## Layout과 drag

Cytoscape.js `3.34.0`의 내장 force-directed `cose`를 자동 배치에 사용한다. 별도 extension은
쓰지 않는다. Production과 성능 test는 같은 option factory를 사용하며 `animate: false`,
`randomize: true`, `numIter: 200`, `nodeRepulsion: 500000`, `idealEdgeLength: 90`으로
고정한다. 사용자가 drag한 위치는 `world-graph.v1`에 저장하고 관계에는 영향을 주지
않는다. `자동 배치 다시 실행`은 현재 element에 `cose`를 다시 적용하고 `레이아웃 초기화`는
저장 위치를 비운 뒤 새 layout을 수행한다. 새 node는 저장 위치가 없으므로 layout 결과를
사용하고 삭제된 node position은 다음 저장 전에 제거한다.

## Empty와 대체 경로

entity가 없으면 Story Bible에서 설정을 만들라는 empty state를 표시한다. entity는 있지만
filter 결과가 비면 filter를 완화하라는 별도 상태를 표시한다. 기존 Story Bible 목록 화면은
삭제하지 않으며 canonical 편집과 graph 대체 탐색 경로로 유지한다.
