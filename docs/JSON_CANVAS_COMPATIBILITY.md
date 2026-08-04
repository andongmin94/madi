# JSON Canvas 1.0 호환성

기준일: 2026-08-08

기준 명세는 [JSON Canvas Specification 1.0](https://jsoncanvas.org/spec/1.0/)이다.
공식 명세의 표기 version은 `1.0`, 날짜는 2024-03-11이다. madi의 저장 identity는
`document_format = JSON_CANVAS`, `document_version = 1.0`이다.

여기서 “호환”은 지원하는 표준 node/edge를 같은 필드로 import/export하고 알 수 없는
JSON extension을 보존한다는 뜻이다. JSON Canvas 1.0의 모든 node type과 모든 strict
제약을 구현했다는 뜻은 아니다.

## 1. 지원 표

| JSON Canvas 1.0 항목 | madi 상태 | 비고 |
|---|---|---|
| top-level `nodes`, `edges` | 지원, 더 엄격함 | madi importer는 두 배열을 모두 요구 |
| `text` node | 지원 | `text`는 plain text/Markdown fallback; HTML 실행 없음 |
| `group` node | 지원 | `label`, `background`, `backgroundStyle` 보존 |
| `file` node | 미지원 | import 거부; 임의 파일 접근 방지 |
| `link` node | 미지원 | import 거부; 외부 URL 자동 접근 없음 |
| `id`, `x`, `y`, `width`, `height` | 지원 | Desktop ingress는 safe integer, 유일 ID와 양수 크기를 검증 |
| node/edge `color` | 지원 | hex/preset `1`~`6` 표시; 문자열 보존 |
| edge endpoints/sides/ends | 지원 | endpoint 존재 여부를 추가 검증 |
| edge `label` | 지원 | plain text로 렌더 |
| unknown JSON fields | 보존 | top-level/node/edge/`madi` JSON extension round-trip |

## 2. 표준보다 엄격한 부분

- JSON Canvas에서는 `nodes`와 `edges`가 optional이지만 madi importer는 두 배열을
  요구한다.
- 모든 node ID와 edge ID는 한 document 안에서 서로도 겹치지 않아야 한다.
- edge endpoint는 import 시 이미 존재하는 node여야 한다.
- text node에는 문자열 `text`가 반드시 있어야 한다.
- group ownership은 존재하는 group만 가리키고 cycle이 없어야 한다.
- 지원하지 않는 `file`, `link`, HTML/iframe node는 보존 모드로 열지 않고 거부한다.
- `.canvas` import는 8 MiB, node 500개, edge 1,000개 상한을 적용한다.

Malformed, oversized 또는 지원하지 않는 document는 preview 단계에서 실패하며 현재
Canvas row를 수정하지 않는다.

## 3. 알려진 상호운용성 차이

JSON Canvas 1.0은 `x`, `y`, `width`, `height`를 integer로 정의한다. Desktop main의
create/save/import capability와 renderer adapter는 `Number.isSafeInteger`로 이 계약을
적용한다. Rust core도 finite 정수, 양수 크기와 bounded geometry를 별도로 검증한다.
따라서 renderer, main과 core를 통과한 정상 document와 export는 integer geometry만
저장한다.

Color validator는 현재 JSON Canvas preset 또는 hex만으로 제한하지 않고 bounded
string을 보존한다. 표준 consumer와의 최대 호환성이 필요하면 color를 preset `1`~`6`
또는 hex로 사용해야 한다. 이 차이는 성능이나 데이터 손실을 숨기기 위한 fallback이
아니라 현재 명시된 interoperability 한계다.

## 4. madi extension

Entity/SCENE reference와 group ownership은 JSON object의 `madi` key에 둔다.

```json
{
  "type": "text",
  "text": "레이아",
  "madi": {
    "nodeKind": "ENTITY_REFERENCE",
    "entityId": "entity-id",
    "originalLabel": "레이아"
  }
}
```

표준 consumer가 `madi`를 무시해도 이 node는 fallback text를 가진 정상 `text` node로
표시할 수 있다. 지원 값은 다음과 같다.

- node `madi.nodeKind`: `TEXT`, `ENTITY_REFERENCE`, `SCENE_REFERENCE`, `GROUP`
- node `madi.entityId`, `sceneNodeId`, `parentGroupId`, `originalLabel`
- edge `madi.lineStyle`: `SOLID`, `DASHED`, `DOTTED`

Extension은 Story Bible data의 복제 저장소가 아니다. Entity/SCENE의 현재 표시 정보는
ID로 canonical model을 조회해 파생한다.

## 5. import

1. sandboxed renderer는 generic fs/path API 대신 preload의 고정 import capability를
   호출한다.
2. main은 사용자가 고른 `.canvas` 한 파일만 UTF-8 text로 읽고 byte/node/edge 상한을
   검사한다.
3. renderer는 JSON parse, type, ID, endpoint, group graph와 madi extension을 runtime
   validation한다.
4. preview는 node/edge/broken-reference 수를 표시한다.
5. 사용자가 승인하면 새 Canvas row를 생성한다. 현재 Canvas는 덮어쓰지 않는다.

존재하지 않는 entity/SCENE ID는 structural 오류가 아니며 broken reference로
수용한다. 반면 중복 ID, dangling edge와 dangling/cyclic group은 document 구조 오류로
거부한다. Unknown JSON extension은 실행하지 않고 JSON 값으로 보존한다.

## 6. export

- 확장자 `.canvas`, UTF-8 JSON
- 표준 필드와 `madi` extension 유지
- object key를 정렬한 deterministic serialization
- entity/SCENE reference의 fallback `text` 유지
- 원고 본문 전체, entity note, UI state, Undo stack과 React Flow object 제외
- 외부 URL 또는 background path를 읽거나 embed하지 않음

DB `content_hash`는 core가 저장한 compact canonical `document_json` bytes의 hash다.
Export는 whitespace가 다른 deterministic representation일 수 있으므로 export file의
byte hash와 같다고 약속하지 않는다. 재-import한 logical document는 다시 core
canonicalization과 validation을 거친다.

## 7. 라이선스와 표기

JSON Canvas specification은 MIT License로 제공되며 저장소의 license 원문은
`docs/licenses/JSON-CANVAS-MIT.txt`, packaged artifact에서는
`resources/licenses/JSON-CANVAS-MIT.txt`에 포함한다. 명세 호환 표기는 JSON Canvas
상표나 전체 기능 인증을 의미하지 않는다.
