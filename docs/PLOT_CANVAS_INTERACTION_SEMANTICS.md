# Plot Canvas interaction semantics

기준일: 2026-08-08

이 문서는 UI event를 canonical Canvas mutation, UI-state write와 session-only state로
구분한다. 정확한 document 구조는 `PLOT_CANVAS_DATA_MODEL.md`를 따른다.

## 1. 작업 공간과 mode 전환

Canvas mode는 Canvas 목록, 중앙 Plot Canvas와 선택 항목 inspector로 구성한다.
원고/설정/그래프에서 Canvas로 진입할 때 기존 editor owner를 바꾸지 않고 Plot Canvas
lazy chunk를 연다. Canvas를 떠나거나 창을 닫기 전에는 현재 Canvas document와
`plot-canvas.v1`을 flush한다. flush가 실패하면 전환/닫기를 성공으로 가장하지 않고
현재 편집 상태를 유지한다.

Canvas A에서 B로 이동하는 순서는 다음과 같다.

1. A autosave timer를 flush한다.
2. A UI state를 저장한다.
3. B record를 load하고 runtime history를 B 기준으로 새로 만든다.
4. B의 저장된 viewport/selection/inspector 옵션을 적용한다.

빠른 A → B → C load는 load generation을 사용해 이전 응답을 현재 화면에 적용하지
않는다.

## 2. Canvas 목록

- `새 캔버스`는 기본 이름 `새 캔버스`와 빈 document로 만든다.
- 이름은 비어 있을 수 없지만 같은 이름은 허용한다. case-insensitive 중복은 목록에
  `중복 이름`으로 표시한다.
- metadata 저장은 document flush 뒤 name/description과 expected Canvas revision을
  transaction으로 갱신한다.
- 복제는 현재 document를 저장한 뒤 새 ID와 기본 이름 `<이름> 복사본`을 만든다.
- 삭제 확인에는 현재 node/edge 수를 표시한다. 성공 후 삭제된 Canvas의 UI state를
  제거하고 남은 목록을 reload한다.
- 정렬 변경도 현재 Canvas를 먼저 flush한다.

## 3. node 추가와 picker

Toolbar는 text, entity reference, scene reference와 group을 직접 추가한다. `Ctrl+K`
또는 `노드 추가…`는 keyboard picker를 연다. Picker는 다음을 찾는다.

- entity 이름·별칭·태그
- SCENE/상위 화 제목
- 현재 Canvas의 text node

새 node는 현재 viewport 중앙 부근에 만든다. Entity/SCENE node에는 ID와 fallback label만
저장한다. Story Bible/World Graph의 `캔버스에 추가` callback도 entity ID만 전달하고
Cytoscape나 React component object를 넘기지 않는다.

## 4. 선택, 이동과 크기

- pane click 또는 Escape는 selection을 해제한다.
- node/edge click은 해당 element를 inspector에 표시한다.
- box selection과 Ctrl/Meta multi-selection을 허용한다.
- drag와 resize 결과는 canonical node geometry에 반영한다.
- 연속 drag change는 하나의 Undo history entry로 coalesce한다.
- `화면 맞춤`과 검색 focus는 viewport만 바꾸며 node geometry를 rewrite하지 않는다.
- node array 순서는 z-order다. inspector의 앞으로/뒤로 동작은 이 canonical 순서를
  바꾼다.

Selection, hover, fit view와 inspector 폭은 document mutation이 아니다.

## 5. group

Group은 JSON Canvas `type: group` node다. 일반 node의 `madi.parentGroupId`로 소속을
정한다. Group으로 묶인 node는 React Flow에서 parent-relative로 표시하지만 저장
좌표는 절대 좌표로 변환한다. Group 이동은 포함 node의 화면 위치를 함께 이동시킨다.

Group 삭제 시 child가 있으면 확인한다.

- 확인: group과 child node 및 연결 edge를 함께 삭제
- 취소: group만 제거하고 child를 ungroup
- 명시적 callback이 `CANCEL`을 반환하는 test/host 경로: mutation 없음

Dangling parent와 group cycle은 import/save validation에서 거부한다.

## 6. edge

두 connectable node를 연결하면 Canvas edge를 만들고 선택한다. Inspector는 label,
color, solid/dashed/dotted와 no/start/end/both arrow를 수정한다. Group 자체는 edge
endpoint로 연결하지 않는다.

Inspector에는 다음 의미를 고정해 표시한다.

```text
캔버스 연결선
세계관 설정의 공식 관계와는 별개입니다.
```

Edge mutation은 `entity_relations`, relation type, World Graph 또는 scene link를
수정하지 않는다.

## 7. reference node

Entity reference display는 현재 name/kind/status/summary/color/관계 수를, Scene
reference display는 현재 화·장면 제목/recovery 첫 문장/글자 수/장면 구분 여부를
catalog에서 파생한다. Canonical target이 삭제되면 node는 자동 삭제되지 않는다.

Broken reference 동작:

- `originalLabel`과 fallback text로 원래 이름 표시
- `연결 끊김` badge
- 다른 target으로 재연결
- 일반 text로 변환
- node 삭제

정상 reference double-click 또는 inspector button은 각각 Story Bible 상세나 원고
SCENE으로 이동한다. 이동 전에 현재 Canvas를 flush한다.

## 8. session-local Undo/Redo

Canvas document mutation은 Canvas별 현재 mount session history에 들어간다. 기본 상한은
100 entry다.

- Undo: `Ctrl/Meta+Z`
- Redo: `Ctrl/Meta+Shift+Z` 또는 `Ctrl/Meta+Y`
- Duplicate: `Ctrl/Meta+D`
- Delete: Delete 또는 Backspace

Text input/textarea/select가 focus된 동안 편집용 shortcut을 가로채지 않는다. Undo/Redo
결과도 새 canonical document이므로 autosave 대상이다. 저장 성공 뒤에도 현재 session
history는 유지할 수 있지만 Canvas 전환·unmount·앱 재시작 뒤에는 복원하지 않는다.
지속형 rollback은 named snapshot을 사용한다.

## 9. autosave state machine

Document 변경은 약 500 ms debounce 뒤 저장한다.

```text
clean/saved → dirty → saving → saved
                         └──→ error
dirty while saving → current save finish → next save
```

각 save request는 `canvasId`, activation `generation`과 monotonic `saveSequence`를 가진다.
응답이 세 값을 모두 일치시키지 않거나 현재 active Canvas가 바뀌었으면 current state에
commit하지 않는다. 저장 중 추가 변경은 document version을 비교해 `dirty`로 남기고
후속 save를 예약한다.

Canonical serialization이 마지막 성공 document와 같으면 IPC/DB write 없이 `saved`로
돌아간다. Core도 content hash가 같으면 no-op으로 처리한다. Error 상태는 현재 renderer
document를 유지하며 `Ctrl+S`/저장 button/다음 flush로 재시도할 수 있다.

## 10. UI state

`plot-canvas.v1`에는 project별로 다음을 저장한다.

- `last_canvas_id`
- Canvas별 viewport
- `selected_element_id`
- `inspector_width`
- `show_grid`, `show_minimap`, `snap_to_grid`

UI state write는 canonical project revision을 올리지 않는다. 존재하지 않는 selection은
document load 뒤 제거한다. Named snapshot restore는 Canvas document는 복원하지만 이
row는 교체하지 않는다. 따라서 restore 뒤 viewport/panel 배치는 현재 사용자 상태를
유지하고, 삭제된 Canvas/element ID는 reload 단계에서 무효화한다.

## 11. import/export

Import는 current Canvas overwrite가 아니다.

1. 고정 dialog에서 `.canvas`를 선택한다.
2. UTF-8 JSON과 size/count/structure를 검증한다.
3. node/edge/broken-reference 수와 새 이름을 preview한다.
4. 승인 시 새 Canvas를 생성한다.

Cancel 또는 validation failure는 현재 Canvas를 바꾸지 않는다. Unknown JSON extension은
data로 보존하지만 실행하지 않는다. `file`/`link`/HTML node는 거부한다.

Export는 현재 Canvas를 먼저 flush하고 deterministic UTF-8 `.canvas` file을 사용자가
고른 위치에 쓴다. 원고 본문 전체, UI state, Undo history와 runtime object는 포함하지
않는다.

## 12. 접근성과 안전

- Canvas 목록, toolbar, picker, inspector와 fallback node/edge 목록은 keyboard로
  접근할 수 있다.
- node type은 label/badge로도 표시해 색상만으로 구분하지 않는다.
- Canvas text/label은 text content로 렌더하며 `innerHTML`을 사용하지 않는다.
- renderer에는 generic fs/path/process/shell/RPC capability를 노출하지 않는다.
- 외부 URL/background는 자동으로 열거나 fetch하지 않는다.
- 오류 message와 performance sample에는 원고, entity note와 relation note를 넣지 않는다.

완전한 screen-reader 및 Windows native Korean IME 검증 상태는 다음과 같다.

```text
Windows native Korean IME: MANUAL VALIDATION PENDING
```
