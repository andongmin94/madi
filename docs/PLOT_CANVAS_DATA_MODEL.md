# Plot Canvas 데이터 모델

기준일: 2026-08-08

## 1. 소유권과 저장 경계

Plot Canvas는 작가가 소유하는 canonical planning data다. node의 위치·크기·순서,
group 소속과 edge 자체가 문서 내용이다. 반대로 viewport, selection, inspector 폭과
session Undo history는 재생성 가능한 UI/runtime state다.

```text
SQLite canvases.document_json
        ↕ MadiCanvasDocument
        ↕ JsonCanvasAdapter
        ↕ ReactFlowAdapter
@xyflow/react renderer runtime
```

React Flow `Node`, `Edge`, instance, viewport object 또는 event는 renderer 밖의 저장·IPC
계약에 포함하지 않는다. 현재 renderer dependency는 MIT licensed `@xyflow/react` exact
`12.11.2`다.

## 2. `canvases` row

SQLite schema 5의 `canvases` table은 다음 값을 저장한다.

| column | 의미 |
|---|---|
| `id` | project 안에서 사용하는 Canvas ID |
| `project_id` | 이 `.madi`의 project ID |
| `name` | trim 후 비어 있지 않은 사용자 이름; 중복 허용 |
| `description` | nullable 설명 |
| `document_format` | 고정값 `JSON_CANVAS` |
| `document_version` | 고정값 `1.0` |
| `document_json` | 검증 후 core가 canonical serialize한 UTF-8 JSON text |
| `content_hash` | exact `document_json` UTF-8 bytes의 lowercase SHA-256 |
| `revision` | Canvas별 optimistic concurrency token |
| `created_at`, `updated_at` | UTC timestamp text |

project-wide `app_meta.revision`과 Canvas별 `canvases.revision`을 함께 검사한다. create,
metadata update, duplicate, delete와 document save는 transaction 안에서 처리한다. 같은
canonical document를 다시 저장하면 `no_op = true`이며 Canvas/project revision과
timestamp를 올리지 않는다. 실패한 mutation은 이전 정상 row를 유지한다.

목록은 `updated_at` 또는 name 기준으로 정렬하며 ID를 deterministic tie-break로 쓴다.
node/edge count는 저장된 document에서 계산하며 별도 canonical column이 아니다.

## 3. document 최상위 구조

```json
{
  "nodes": [],
  "edges": []
}
```

Madi는 JSON Canvas 1.0의 `nodes`/`edges` 구조를 사용한다. 현재 import/runtime
validator는 두 배열을 모두 요구하고 빈 배열은 허용한다. 배열 순서는 node z-order와
결정적 export에 의미가 있다.

Core의 canonical save 상한은 다음과 같다.

- node 500개
- edge 1,000개
- canonical document JSON 32 MiB

Desktop main의 create/save/import capability는 추가로 8 MiB, node 500개, edge 1,000개를
제한하며 `.canvas` file dialog에도 같은 상한을 적용한다.
identifier, text/label, 유한 좌표, 양수 크기, endpoint와 group graph도 저장 전에
검증한다.

## 4. node

공통 표준 필드:

| 필드 | 계약 |
|---|---|
| `id` | 비어 있지 않은 고유 문자열 |
| `type` | 현재 `text` 또는 `group` |
| `x`, `y` | Canvas 절대 좌표; desktop IPC/import는 safe integer 요구 |
| `width`, `height` | 양수 크기; desktop IPC/import는 safe integer 요구 |
| `color` | nullable JSON Canvas color 문자열 |

### Text

```json
{
  "id": "node-1",
  "type": "text",
  "x": 100,
  "y": 120,
  "width": 320,
  "height": 180,
  "text": "1부의 핵심 갈등",
  "madi": { "nodeKind": "TEXT" }
}
```

`text`는 plain text fallback이며 DOM HTML로 실행하지 않는다.

### Entity reference

Entity reference도 표준 consumer에는 `text` node다.

```json
{
  "id": "node-2",
  "type": "text",
  "x": 500,
  "y": 120,
  "width": 260,
  "height": 140,
  "text": "레이아",
  "madi": {
    "nodeKind": "ENTITY_REFERENCE",
    "entityId": "entity-id",
    "originalLabel": "레이아"
  }
}
```

Canonical identity는 `entityId`다. 이름, kind, status, summary, color, alias/tag와 관계
수는 현재 Story Bible read model에서 해석한다. `text`/`originalLabel`은 외부 export와
broken-reference fallback이고 canonical entity 사본이 아니다.

### Scene reference

```json
{
  "id": "node-3",
  "type": "text",
  "x": 500,
  "y": 340,
  "width": 300,
  "height": 160,
  "text": "17화 장면 2",
  "madi": {
    "nodeKind": "SCENE_REFERENCE",
    "sceneNodeId": "scene-node-id",
    "originalLabel": "17화 장면 2"
  }
}
```

Canonical identity는 Binder의 `sceneNodeId`다. 본문 전체는 Canvas에 복제하지 않는다.
표시는 현재 chapter/scene title, recovery 첫 문장, 문자 수와 장면 구분 badge에서
파생한다.

### Group

```json
{
  "id": "group-1",
  "type": "group",
  "x": 80,
  "y": 80,
  "width": 900,
  "height": 560,
  "label": "1부",
  "color": "5",
  "madi": { "nodeKind": "GROUP" }
}
```

표준 `label`, `background`, `backgroundStyle`를 보존한다. child는 자신의
`madi.parentGroupId`로 group을 가리킨다. parent는 존재하는 group이어야 하고 cycle은
거부한다. 저장 좌표는 Canvas 절대 좌표이며 React Flow의 parent-relative 좌표는 adapter
내부에서만 사용한다.

### `madi` node extension

| 필드 | 의미 |
|---|---|
| `nodeKind` | `TEXT`, `ENTITY_REFERENCE`, `SCENE_REFERENCE`, `GROUP` |
| `entityId` | entity reference identity |
| `sceneNodeId` | scene reference identity |
| `parentGroupId` | 선택적 parent group |
| `originalLabel` | broken reference와 외부 fallback label |

알 수 없는 JSON 필드와 알 수 없는 `madi` 하위 필드는 JSON 값이면 round-trip 보존한다.
알 수 없는 `nodeKind` 자체는 실행 의미가 없으므로 거부한다.

## 5. edge

```json
{
  "id": "edge-1",
  "fromNode": "node-1",
  "toNode": "node-2",
  "fromSide": "right",
  "toSide": "left",
  "fromEnd": "none",
  "toEnd": "arrow",
  "color": "3",
  "label": "원인이 된다",
  "madi": { "lineStyle": "DASHED" }
}
```

`fromNode`와 `toNode`는 같은 document의 존재하는 node를 가리켜야 한다. 시작/끝
endpoint는 각각 `none | arrow`이므로 no-arrow, 한 방향, 반대 방향과 양방향 arrow를
표현할 수 있다. `fromSide`/`toSide`, color와 label은 선택적이다. `madi.lineStyle`은
`SOLID | DASHED | DOTTED`이다.

Canvas edge는 Story Bible `entity_relations`가 아니다. 두 entity reference를 연결해도
relation row를 생성하지 않으며 World Graph에 나타나지 않는다.

## 6. reference 삭제와 변경

Entity/SCENE 삭제는 Canvas node를 cascade-delete하지 않는다. target lookup 실패 시
node는 `삭제된 설정` 또는 `삭제된 장면`, `originalLabel`, `연결 끊김`으로 표시된다.
가능한 사용자 동작은 다음뿐이다.

- 존재하는 다른 entity/SCENE으로 다시 연결
- fallback text를 유지한 일반 text node로 변환
- Canvas node 삭제

Canonical entity/scene 이름이 바뀌면 node ID나 document를 자동 rewrite하지 않고 현재
catalog에서 새 표시를 파생한다.

## 7. canonical data와 UI/runtime state

| 값 | `document_json` | `plot-canvas.v1` | session only |
|---|---:|---:|---:|
| node text/reference/group | 예 | 아니요 | 아니요 |
| node x/y/width/height/z-order | 예 | 아니요 | drag 중간 event만 |
| edge/label/arrow/style | 예 | 아니요 | 아니요 |
| 마지막 Canvas | 아니요 | 예 | 아니요 |
| viewport/grid/minimap/snap | 아니요 | 예 | 아니요 |
| selection/inspector 폭 | 아니요 | 예 | 아니요 |
| React Flow object/event | 아니요 | 아니요 | 예 |
| Undo/Redo history | 아니요 | 아니요 | 예 |

`plot-canvas.v1` 저장은 project revision을 올리지 않는다. named snapshot v3에는
`canvases` canonical row를 포함하지만 이 UI state와 session-only 값은 포함하지 않는다.

## 8. snapshot과 export의 byte identity

Named snapshot은 `document_json`, `content_hash`, Canvas revision과 metadata를 그대로
담는다. Core restore는 document를 다시 decode·validate·canonicalize하고 hash를
대조한다.

`.canvas` export는 같은 logical document를 key-sorted UTF-8 JSON으로 직렬화한다.
읽기 쉬운 export bytes와 SQLite의 compact core canonical bytes는 직렬화 whitespace가
다를 수 있으므로 DB `content_hash`를 export file hash라고 해석하지 않는다. Import는
preview 후 항상 새 Canvas를 만들고 현재 Canvas를 덮어쓰지 않는다.
