# Reader Lab visual diagnostics

기준일: 2026-08-09

## 1. 목적

Reader Lab diagnostic은 특정 reading config에서 확인할 layout 후보와 Publication
compile 문제를 찾기 위한 보조 신호다. 문장 품질, 출판 적합성, 플랫폼 승인 또는 작가
의도를 판정하지 않는다.

Diagnostic은 두 계층으로 나뉜다.

- Core diagnostic: semantic compile과 source integrity에서 생성
- Renderer layout diagnostic: active pane의 resolved config와 render measurement에서 생성

두 계층 모두 닫힌 code를 사용한다. Core/user가 보낸 free-form message나 원고 문자열을
label로 표시하지 않고, code와 검증된 숫자에서 고정 한국어 문구를 만든다.

## 2. source 통계와 render 통계

`PublicationDocument.stats`는 config와 무관한 source 통계다.

- 공백 포함/제외 문자 수
- paragraph 수
- scene 수
- chapter 수

다음 값은 pane config에 따라 달라지는 render 통계다.

| 값 | 의미 |
|---|---|
| `renderedContentHeight` | 같은 Shadow CSS로 section을 합산한 content 높이 |
| `viewportHeight` | safe area와 reader chrome을 제외한 유효 높이 |
| `estimatedScreenCount` | content 높이를 유효 viewport 높이로 나눈 올림값 |
| `averageCharactersPerScreen` | source 공백 포함 문자 수를 screen 수로 나눈 값 |
| `longestParagraphLineCount` | paragraph/quote/unsupported fallback 중 최대 render line 수 |
| `paragraphsAtLeastEightLines` | 실제 line 수가 8 이상인 block 수 |
| `consecutiveEmptyParagraphRuns` | 빈 paragraph가 3개 이상 이어지는 run 수 |
| `horizontalOverflowCount` | 실제 content width를 넘긴 block 수 |

`estimatedScreenCount`라는 필드명은 유지하지만 measurement가 완료된 뒤에는 실제로
측정한 content 높이를 사용한다. 실제 화면/page 수의 플랫폼 공식 정의는 아니며 현재
continuous viewport를 기준으로 한 상대량이다.

## 3. measurement lifecycle

통계는 명시적인 세 상태를 가진다.

```text
ESTIMATED → MEASURING → COMPLETE
```

### `ESTIMATED`

첫 화면 전에 text scalar, content width, font size, line height와 spacing으로 초기값을
계산한다. 이 단계의 line/height 문구는 `약`, `표시될 수 있음`처럼 추정임을 드러낸다.
Horizontal overflow는 추정으로 단정하지 않는다.

### `MEASURING`

Visible preview와 별개의 hidden layer가 같은 pane Shadow root와 동일한 CSS custom
property를 사용한다. 한 번에 section 하나만 mount하고 layout을 읽은 뒤 event loop에
양보한다. 따라서 전체 scope DOM을 한꺼번에 만들지 않고도 진행 section 수와 전체
section 수를 보고할 수 있다.

각 paragraph에서 computed line height, bounding height, client width와 scroll width를
측정한다. Config/document가 바뀌면 이전 progress, measured block map과 overflow 결과를
즉시 버린다.

### `COMPLETE`

모든 section을 한 번씩 같은 Shadow CSS로 측정한 뒤 다음을 실제 aggregate로 교체한다.

- 전체 rendered height와 screen 수
- longest line count와 8줄 이상 paragraph 수
- block별 rendered height와 horizontal overflow

빈 paragraph run과 연속 scene break는 semantic block 순서에서 결정하므로 visible
window와 무관하게 전체 scope를 즉시 scan할 수 있다. `COMPLETE` 전에는 measured/estimated
값을 섞어 실제 전체 scope 결과처럼 label하지 않는다.

## 4. core diagnostic code

| code | 의미 | source 가능성 |
|---|---|---|
| `UNSUPPORTED_BLOCK` | semantic node를 지원 block으로 변환하지 못함 | scene/document/block |
| `UNSUPPORTED_INLINE_MODIFIER` | inline modifier를 폐쇄형 inline union으로 표현하지 못함 | scene/document/block |
| `INVALID_SEMANTIC_DOCUMENT` | 저장 semantic snapshot이 compile 계약을 만족하지 못함 | 없거나 document 수준 |
| `EMPTY_SCOPE` | 선택 scope에 render할 scene/content가 없음 | scope/document 수준 |

Severity는 `INFO`, `WARNING`, `ERROR`다. Renderer는 이 code/severity와 nullable identity만
신뢰하며 raw IPC error나 decoder 설명을 그대로 출력하지 않는다.

## 5. renderer layout diagnostic code

| code | 생성 조건 |
|---|---|
| `LONG_PARAGRAPH` | paragraph line 수가 현재 기준 이상 |
| `PARAGRAPH_TALLER_THAN_VIEWPORT` | block height가 유효 viewport보다 큼 |
| `HORIZONTAL_OVERFLOW` | complete measurement에서 `scrollWidth > clientWidth` |
| `CONSECUTIVE_EMPTY_PARAGRAPHS` | 빈 paragraph가 3개 이상 연속 |
| `CONSECUTIVE_SCENE_BREAKS` | 인접한 두 semantic block이 모두 scene break |
| `UNSUPPORTED_BLOCK` | 안전한 plain-text fallback을 표시함 |

Line과 height diagnostic은 full-scope measured block map이 있으면 실제 숫자를 사용한다.
Measurement가 끝나기 전에는 estimator 값을 사용할 수 있지만 문구가 그 차이를 명시한다.
Horizontal overflow diagnostic은 measured block에 대해서만 만들며 추정 overflow를
fabricate하지 않는다.

`UNSUPPORTED_BLOCK`은 콘텐츠를 누락했다는 의미가 아니라 실행하지 않는 plain-text
fallback을 사용했다는 표시다. Image처럼 현재 저장 asset 계약이 없는 node도 이 경로를
사용한다.

## 6. multi-pane 의미

Source 통계는 pane 수와 무관하게 하나다. Render 통계와 layout diagnostic은 active
pane의 resolved config를 기준으로 한다. 다른 pane은 같은 Publication IR을 사용해
독립적으로 측정하며 font token, viewport, padding, work style이 다르면 결과도 달라진다.

Scroll progress나 selected block 변화는 config/document identity를 바꾸지 않는다.
따라서 hot scroll 중 full-document estimator와 diagnostic scan을 반복하지 않는다.
Preset/config가 바뀌면 해당 pane의 측정은 초기 상태에서 다시 시작하고, 이전 pane
overflow diagnostic을 새 결과가 끝날 때까지 남겨 두지 않는다.

## 7. diagnostic activation과 source identity

Layout diagnostic은 생성할 때 render block ID와 그 block의 full source reference를
보존한다. Core diagnostic의 `blockId`는 source semantic block identity이므로 renderer는
다음 순서로 해석한다.

1. Publication block의 `source.blockId`와 core diagnostic ID를 대조한다.
2. 일치한 Publication block의 render `id`를 선택/highlight한다.
3. 일치한 block의 검증된 full source reference로 원고 이동을 요청한다.

일치하지 않는 nullable identity에서 source reference를 만들어 내지 않는다.
`rangeVerified=true`는 `start <= end` exact range를 사용한다. 길이 0인 범위는 caret
boundary다. `rangeVerified=false`는 compiler가 제공한 scene/document target으로
fallback한다. Heading도 hierarchy `sourceNodeId`와 별도로 첫 descendant scene target을
가지므로 활성화할 수 있다.

Diagnostic item은 button이다. Click뿐 아니라 keyboard activation으로도 같은 highlight와
navigation을 실행한다. Virtualized target이면 대상 section으로 먼저 이동하고 window가
mount된 뒤 focus를 옮긴다.

## 8. 접근성과 표현 규칙

- Diagnostic group toggle은 `aria-expanded`를 가진 button이다.
- Error, stale, busy와 measurement 상태는 alert/status/live semantics로 구분한다.
- Preview block 선택은 `aria-pressed`로도 전달한다.
- Scene-break hidden 설정은 빈 focusable block을 남기지 않는다.
- Hidden measurement layer는 `aria-hidden`, pointer-events none이며 tab order에 없다.
- 문구는 색만으로 severity나 상태를 전달하지 않는다.

숫자 diagnostic은 해당 config와 로컬 font metric에서 관측한 값이다. 같은 font token도
운영체제에 설치된 local font와 browser text shaping에 따라 결과가 달라질 수 있다.
따라서 검토 후보는 작가가 원문에서 확인할 위치를 제공하지만 writing-quality verdict가
아니다.

## 9. 관찰 가능성 경계

Electron UI 검증은 data attribute로 다음 상태를 읽을 수 있다.

- canonical/mounted section과 block 수
- measurement status, measured/total section 수와 실제 관찰한 누적 block 수
- active pane의 token/numeric config와 통계
- selected source identity와 normalized scroll progress

이 attribute는 본문, 작품 제목이나 preset 표시 이름을 복제하지 않는다. Compile/IPC/
validation/first-visible timing도 content-free 값으로만 노출하며, 이 문서는 그 측정치나
성능 판정을 기록하지 않는다.

## 10. 관련 문서

- [Phase 1F result](./PHASE_1F_RESULT.md)
- [Reader Lab performance](./READER_LAB_PERFORMANCE.md)
- [Reader Lab architecture](./READER_LAB_ARCHITECTURE.md)
- [Reader profile format v1](./READER_PROFILE_FORMAT_V1.md)
- [ADR-0006](./decisions/ADR-0006-reader-lab-rendering-is-isolated-and-non-executable.md)
