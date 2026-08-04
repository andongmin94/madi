# Publication IR v1

기준일: 2026-08-09

## 1. 역할과 소유권

Publication IR은 저장된 원고를 Reader Lab과 향후 exporter가 소비할 수 있도록 Rust
core가 매 요청마다 만드는 Madi 소유의 engine-independent read model이다. Canonical
본문 원천은 SQLite `documents.snapshot_blob`의 pinned Typie changeset snapshot이다.
`plain_text_recovery`, search projection, editor DOM과 renderer state는 compile 원천이
아니다.

```text
tree_nodes + SCENE documents.snapshot_blob
                │
                ▼
madi-core scope/revision loader
                │
                ▼
madi-publication private Typie adapter
                │ Madi semantic body
                ▼
PublicationDocument v1 + diagnostics + contentHash
```

`madi-publication`의 `typie_bridge` module만 Typie crate type을 안다. 외부 공개 함수는
opaque snapshot bytes와 Madi DTO를 주고받으며 `Dot`, `DocView`, changeset, modifier
runtime type을 Publication JSON이나 desktop IPC에 내보내지 않는다.

Publication IR은 `.madi`의 canonical 저장 row가 아니다. Compile 결과, diagnostic과
`contentHash`는 SQLite, named snapshot 또는 Reader preset에 저장하지 않는다. 원고나
scope revision이 바뀌면 canonical snapshot에서 다시 파생한다.

관련 설계 결정은
[ADR-0005](./decisions/ADR-0005-publication-ir-is-derived-engine-independent-model.md),
렌더링 경계는 [Reader Lab architecture](./READER_LAB_ARCHITECTURE.md)를 따른다.

## 2. scope compile

허용 scope kind는 정확히 다음 네 가지다.

| scope | 포함 scene |
|---|---|
| `SCENE` | 선택한 scene 하나 |
| `CHAPTER` | 선택 chapter의 scene descendant |
| `VOLUME` | 선택 volume의 scene descendant |
| `WORK` | 작품 tree 전체의 scene descendant |

Core는 `expected_revision`과 현재 project revision을 먼저 exact-match한다. Scope node는
현재 project의 Binder `tree_nodes` row여야 하며 kind는 `WORK`, `VOLUME`, `CHAPTER`,
`SCENE` 중 하나다. Child는 `order_key`, ID tie-break 순으로 정렬하고 depth-first로
scene을 수집한다. 각 scene은 고유 `document_id`를 가져야 한다.

Document adapter identity도 compile 전에 다음과 정확히 일치해야 한다.

```text
editor_engine = typie
editor_engine_commit = fbe5c4bf860d1717a66e66bea2374a2e39f0dd26
editor_schema_version = 1
```

Tree ancestry는 `WORK`에서 시작하고 cycle이나 missing parent가 없어야 한다. 존재하는
scope에 scene descendant가 없으면 유효한 빈 document와 `EMPTY_SCOPE` info diagnostic을
만든다. 존재하지 않는 node, 잘못된 hierarchy, stale revision과 잘못된 editor identity는
빈 결과로 완화하지 않고 compile을 실패시킨다.

## 3. Typie snapshot decode

Decoder는 다음 순서로 canonical snapshot을 읽는다.

1. changeset stream을 lossless decode한다.
2. ordered graph input을 `OpGraph`에 적용하고 dropped/unresolved changeset이 없는지
   확인한다.
3. edit log를 split하고 document를 project한다.
4. degraded projection, repair drop와 totality violation이 모두 없는지 확인한다.
5. `DocView`의 authored top-level node를 Madi semantic body로 변환한다.
6. 별도로 reconstructed annotated prose와 Typie `prose_annotated(view).text()`를 exact
   비교해 source range를 검증한다.

Lossy decode, unresolved changeset, projection failure와 annotated prose mismatch는
`Unsupported`로 숨기지 않고 전체 compile을 실패시킨다. Decoder 수준에서 빈 byte
stream은 authored block이 없는 document로 정의하지만, scope compile은 별도로 pinned
editor identity를 요구한다.

Synthetic scaffold는 authored content가 없을 때만 무시한다. Synthetic node 아래에
authored descendant가 있으면 projection degradation으로 실패한다. Authored empty
paragraph는 형태 기반 heuristic으로 제거하지 않으며 public source ID와 `start == end`
caret range를 가진 block으로 유지한다.

## 4. 지원 semantic body

Typie decoder가 직접 지원하는 top-level body는 세 종류다.

### Paragraph

Authored `Paragraph`의 character leaf를 순서대로 읽어 inline run으로 만든다. Paragraph
안에 지원하지 않는 atom/block child가 있으면 paragraph 전체를 `UNSUPPORTED` fallback으로
내리고 원문 text를 가능한 범위에서 보존한다.

### Scene break

Root의 authored `HorizontalRule(ThreeDiamonds)`만 `SCENE_BREAK`으로 변환한다. Semantic
identity는 `madi.scene-break.v1`이다. 다른 horizontal-rule variant나 다른 top-level
atom은 `UNSUPPORTED`다.

### Quote

Top-level `Blockquote`의 authored paragraph child마다 하나의 `QUOTE` block을 만든다.
지원하지 않는 child 구조는 blockquote plain-text fallback 또는 해당 paragraph
fallback으로 내린다. 빈 authored blockquote는 빈 inline 배열의 `QUOTE`로 남는다.

Compiler는 이 body 앞에 Binder hierarchy에서 파생한 `HEADING`을 추가한다. 따라서 최종
block union은 다음 다섯 종류다.

```text
HEADING | PARAGRAPH | SCENE_BREAK | QUOTE | UNSUPPORTED
```

## 5. 지원 inline subset

최종 inline union은 다음과 같다.

```text
TEXT | STRONG | EMPHASIS | UNDERLINE | STRIKE | RUBY
```

Typie modifier mapping은 다음과 같다.

| Typie modifier | Publication inline |
|---|---|
| `Bold` | `STRONG` |
| `Italic` | `EMPHASIS` |
| `Underline` | `UNDERLINE` |
| `Strikethrough` | `STRIKE` |
| `Ruby { text }` | `RUBY { annotation, children }` |

여러 modifier는 deterministic nesting으로 감싼다. 안쪽부터 ruby, strike, underline,
emphasis, strong 순서다. Decoder는 existing leaf의 effective modifier만 읽고 Typie의
삽입 상태인 carry를 기존 text semantics로 해석하지 않는다.

지원하지 않는 modifier가 함께 있으면 text와 지원 modifier는 유지하고
`UNSUPPORTED_INLINE_MODIFIER` warning을 해당 source block ID로 남긴다. 지원하지 않는
formatting을 조용히 버리지 않는다. Non-text leaf처럼 inline 구조 자체를 안전하게
해석할 수 없으면 paragraph/quote paragraph를 `UNSUPPORTED` block으로 내린다.

`TEXT.text`는 빈 string도 허용한다. Wrapper children과 ruby annotation은 비어 있을 수
없다. Ruby annotation은 표시 metadata이며 source 문자 통계에는 children text만 들어간다.

## 6. document shape

`PublicationDocument`의 exact top-level field는 다음과 같다.

| 필드 | 계약 |
|---|---|
| `formatVersion` | `1` |
| `projectId` | source project identity |
| `projectRevision` | compile snapshot의 project revision |
| `scopeNodeId` | 요청한 Binder scope identity |
| `scopeKind` | `WORK`, `VOLUME`, `CHAPTER`, `SCENE` |
| `metadata` | 작품 title, nullable author name, `language = ko` |
| `sections` | tree order의 `SCENE` section 배열 |
| `stats` | IR에서 다시 계산한 source statistics |

Scene descendant가 없는 chapter를 compile한 document의 유효한 예는 다음과 같다.

```json
{
  "formatVersion": 1,
  "projectId": "project-empty-chapter",
  "projectRevision": 7,
  "scopeNodeId": "chapter-without-scenes",
  "scopeKind": "CHAPTER",
  "metadata": {
    "title": "빈 장 검사",
    "authorName": null,
    "language": "ko"
  },
  "sections": [],
  "stats": {
    "withSpaces": 0,
    "withoutSpaces": 0,
    "paragraphCount": 0,
    "sceneCount": 0,
    "chapterCount": 0
  }
}
```

Unknown top-level/nested field와 unknown union variant는 Rust `deny_unknown_fields` 및
desktop exact-key validator에서 거부한다.

## 7. section과 hierarchy

모든 section은 다음 exact shape를 가진다.

| 필드 | 의미 |
|---|---|
| `id` | `section-v1` namespace와 scene ID에서 파생한 stable hash |
| `sourceNodeId` | 해당 scene node ID |
| `kind` | 항상 `SCENE` |
| `title` | 현재 scene title |
| `parentTitles` | scene을 제외한 `WORK`/`VOLUME`/`CHAPTER` path title |
| `blocks` | hierarchy heading 뒤 semantic body |

Heading level은 `WORK=1`, `VOLUME=2`, `CHAPTER=3`, `SCENE=4`다. Scope traversal 동안 같은
hierarchy node의 heading은 처음 만난 scene section에 한 번만 들어간다. 따라서 heading은
각 section마다 복제하는 decoration이 아니라 document 안의 deterministic hierarchy
block이다.

Heading source의 `sourceNodeId`는 실제 WORK/VOLUME/CHAPTER/SCENE node다. Navigation을
위해 `sceneNodeId`와 `documentId`는 heading이 처음 배치된, compiler가 선택한 descendant
scene target을 가진다. Heading은 editor text range가 아니므로 `start=end=null`,
`rangeVerified=false`다.

Body block의 `sourceNodeId`와 `sceneNodeId`는 section scene ID와 같고 `documentId`는
그 scene의 canonical document다.

## 8. source reference와 stable ID

모든 block은 다음 source reference를 가진다.

```text
sourceNodeId, sceneNodeId, documentId, blockId,
start, end, rangeVerified
```

### Public source block ID

Body `source.blockId`는 raw Typie `Dot`을 노출하지 않고 다음 bytes의 SHA-256 lowercase
hex로 만든다.

```text
"madi-publication-block-v1\0"
+ documentId UTF-8
+ "\0"
+ source Dot string UTF-8
```

Heading source ID는 length-prefixed `heading-source-v1`, actual hierarchy node ID와 level을
hash한다. Final render block `id`는 length-prefixed `publication-block-v1`, block kind와
source node/scene/document/block identity를 hash한다. Section ID도 length-prefixed
`section-v1`과 scene ID를 hash한다.

이 ID는 같은 source identity와 target mapping에서 deterministic하다. Text/range를 ID
입력에 넣지 않으므로 같은 authored block identity의 text edit만으로 ID를 바꾸지 않는다.
Source node가 삭제·재생성되거나 heading의 first-descendant target이 달라지면 새 identity가
될 수 있다. Validator는 section ID, render block ID와 source block ID의 document 내
중복을 거부한다.

### Exact/caret range

Body range는 Typie annotated prose의 Unicode scalar offset이다. Decoder는 paragraph
boundary, empty authored paragraph, hard/atom representation과 scene-break `***` marker를
독립 재구성하고 전체 annotated text가 Typie 결과와 exact match할 때만 range map을
사용한다.

- `rangeVerified=true`: `start`와 `end`는 nonnegative safe integer이며 `start <= end`
- `start < end`: exact text span
- `start == end`: authored empty block/atom boundary의 exact caret 위치
- `rangeVerified=false`: `start=end=null`; scene/document fallback만 사용

Mixed null pair, 역전 범위와 verified flag 불일치는 거부한다. Renderer는 false range를
추측하지 않고 compiler target scene으로 이동한다.

## 9. block shape

| kind | 필드 | source 규칙 |
|---|---|---|
| `HEADING` | `id`, `level`, `text`, `source` | actual hierarchy source, descendant scene target, unverified null range |
| `PARAGRAPH` | `id`, `inlines`, `source` | section scene/document, verified span/caret 또는 null fallback |
| `SCENE_BREAK` | `id`, `source` | section scene/document, verified annotated `***` span 또는 null fallback |
| `QUOTE` | `id`, `inlines`, `source` | authored quote paragraph identity, verified range 또는 null fallback |
| `UNSUPPORTED` | `id`, `nodeType`, `text`, `source` | section scene/document, 안전한 fallback text와 검증 가능한 range |

`UNSUPPORTED`를 diagnostic만 남기고 block에서 제거하지 않는다. Fallback text가 빈
경우에도 node type, source identity와 range를 보존한다. 따라서 consumer는 누락 위치를
표시하고 원문으로 이동할 수 있다.

## 10. diagnostics와 실패 의미

성공한 compile 결과의 diagnostic code는 다음과 같다.

| code | severity/의미 |
|---|---|
| `UNSUPPORTED_BLOCK` | warning; fallback block이 IR에 함께 존재 |
| `UNSUPPORTED_INLINE_MODIFIER` | warning; text/지원 style은 유지 |
| `EMPTY_SCOPE` | info; 유효 scope에 scene이 없음 |

`INVALID_SEMANTIC_DOCUMENT`는 별도 `validate_publication` 경계에서 전달된 IR이 canonical
검증을 실패했을 때 반환하는 error diagnostic이다. Snapshot loss, unresolved operation,
degraded projection과 구조적 decode 실패는 성공한 IR에 warning만 달지 않고 compile
request 자체를 실패시킨다.

Diagnostic은 code, severity, nullable scene/document/source block identity만 가진다.
Decoder의 raw error나 manuscript text를 public message로 전달하지 않는다.

## 11. source statistics

Stats는 입력 값을 신뢰하지 않고 section/block/inline tree에서 다시 계산한다.

- `withSpaces`: Paragraph, Quote와 Unsupported fallback body의 Unicode scalar 수
- `withoutSpaces`: 위 body에서 Unicode whitespace를 제외한 scalar 수
- `paragraphCount`: Paragraph + Quote + `nodeType=paragraph`인 Unsupported 수
- `sceneCount`: section 수
- `chapterCount`: unique level-3 heading source 수

Heading text, scene-break marker와 ruby annotation은 본문 문자 수에 넣지 않는다.
Validator는 제공된 stats가 같은 derivation과 exact match하는지 확인한다.

## 12. canonical JSON과 content hash

Compiler는 검증된 document를 JSON value로 만든 뒤 모든 object key를 재귀적으로
lexicographic sort한다. Array 순서는 tree/semantic order를 그대로 보존한다. Whitespace
없는 UTF-8 JSON으로 serialize하고 exact bytes의 SHA-256 lowercase 64자리 hex를
`contentHash`로 반환한다.

Hash에는 document의 모든 field, source range, derived stats와 `projectRevision`도
포함된다. 따라서 같은 exact PublicationDocument는 어느 compile 경로에서도 같은 hash를
갖지만, revision만 바뀐 document도 다른 hash를 가질 수 있다. 이는 body-only fingerprint가
아니라 전체 IR identity다.

## 13. safety limits

Rust와 desktop shared validator는 다음 상한을 함께 강제한다.

| 항목 | 상한 |
|---|---:|
| section | 20,000 |
| section당 block | 100,000 |
| 전체 block | 250,000 |
| inline node | 1,000,000 |
| 한 inline children 배열 | 100,000 |
| 전체 text budget | 10,000,000 UTF-16 code unit |
| ID | 256 UTF-16 code unit |
| title/author/heading | 1,000 UTF-16 code unit |
| unsupported node type | 256 UTF-16 code unit |
| parent title | section당 64개 |
| inline nesting | 16 |

Revision/range/stat integer는 JavaScript safe integer 범위를 넘지 않는다. 이 값은
trust-boundary 안전 상한이며 성능 측정 결과나 지원 작품 크기 판정이 아니다.

## 14. 명시적으로 포함하지 않는 것

Publication IR compile은 다음을 읽거나 포함하지 않는다.

- Story Bible entity, alias, tag, relation, scene link와 entity note document
- Plot Canvas document, node/edge와 Canvas UI state
- World Graph read model, layout, filter와 Cytoscape object
- search projection과 `plain_text_recovery`
- Reader preset, pane override, zoom, scroll position과 visual diagnostic result
- named snapshot row, Undo/Redo history, editor selection/composition과 DOM
- 외부 asset, image bytes, URL, HTML, CSS, script와 network resource

Entity note도 `documents` row를 가지지만 Binder `SCENE` owner가 아니므로 scope compiler가
로드하지 않는다. Scene link는 Story Bible의 planning/context data이며 원고 body에
자동 삽입하지 않는다. 이 제외 경계는 향후 요구가 생겨도 암묵적으로 확장하지 않고 새
format/ADR로 결정한다.

## 15. 관련 문서

- [Phase 1F result](./PHASE_1F_RESULT.md)
- [Reader Lab performance](./READER_LAB_PERFORMANCE.md)
- [ADR-0005: Publication IR is derived and engine-independent](./decisions/ADR-0005-publication-ir-is-derived-engine-independent-model.md)
- [Phase 1F scope](./PHASE_1F_SCOPE.md)
- [Reader Lab architecture](./READER_LAB_ARCHITECTURE.md)
- [Reader Lab visual diagnostics](./READER_LAB_VISUAL_DIAGNOSTICS.md)
- [Typie pinning and patches](./TYPIE_PINNING_AND_PATCHES.md)
