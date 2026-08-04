# Reader Lab 아키텍처

기준일: 2026-08-09

## 1. 목적과 경계

Reader Lab은 저장된 원고를 여러 읽기 환경으로 비교하고, layout에서 생기는 검토
후보를 원문 위치와 연결하는 읽기 전용 renderer다. 편집기 DOM이나 Typie runtime을
복제하지 않고, core가 만든 폐쇄형 `PublicationDocument`만 소비한다.

현재 범위는 다음과 같다.

- `SCENE`, `CHAPTER`, `VOLUME`, `WORK` scope compile
- 하나의 compile 결과를 사용하는 1/2/3개 preview pane
- generic profile과 platform-like 미검증 simulation, 사용자 preset
- source block 선택, pane 공통 highlight와 원고 이동
- section windowing과 전체 scope 순차 측정
- source 통계, render 통계와 고정된 diagnostic code

Reader Lab은 EPUB/HWP export, 원고 편집, 외부 플랫폼 앱의 정확한 복제, 원격 font나
웹 콘텐츠 실행 계층이 아니다. Profile 계약은
[Reader profile format v1](./READER_PROFILE_FORMAT_V1.md), 측정과 진단 의미는
[Reader Lab visual diagnostics](./READER_LAB_VISUAL_DIAGNOSTICS.md)에 정의한다.

## 2. 계층 구조

```text
SQLite tree + pinned Typie semantic snapshot
                  │
                  ▼
madi-core scope/revision 검증
                  │
                  ▼
madi-publication compiler
  PublicationDocument v1 + diagnostics + content hash
                  │
                  ▼
Electron main trust boundary
  exact runtime validation + IPC DTO mapping
                  │
                  ▼
lazy ReaderLabMode / ReaderLabWorkspace
                  │
         ┌────────┼────────┐
         ▼        ▼        ▼
       pane 1   pane 2   pane 3
   Shadow root마다 독립 config, window, measurement
```

저장·compile·render의 DTO는 `apps/desktop/src/shared/publication.ts`가 desktop의 단일
TypeScript 계약이다. `apps/desktop/src/shared/publicationValidation.ts`와
`readerConfigValidation.ts`는 main과 renderer가 함께 사용하는 DOM-free trust-boundary
validator다. Renderer-local type은 측정 결과, layout diagnostic과 좁은 component
capability뿐이며 Publication/profile 계약을 다시 정의하지 않는다.

Reader UI는 `ReaderLabMode`에서 동적 import된다. Editor, Binder, World Graph, Plot Canvas의
초기 renderer 경로는 Reader implementation을 직접 import하지 않는다.

## 3. compile 일관성

### 3.1 scope 입력

Core는 선택된 Binder node를 기준으로 scene descendant를 tree order로 모은다. Scope가
scene이 아니어도 결과 section의 canonical kind는 항상 `SCENE`이다. 각 scene은 저장된
Typie snapshot, 문서 identity와 ancestor heading을 compiler 입력으로 제공한다.

Compiler는 다음의 닫힌 union만 만든다.

- block: `HEADING`, `PARAGRAPH`, `SCENE_BREAK`, `QUOTE`, `UNSUPPORTED`
- inline: `TEXT`, `STRONG`, `EMPHASIS`, `UNDERLINE`, `STRIKE`, `RUBY`

알 수 없는 block이나 지원하지 않는 semantic 표현을 실행 가능한 payload로 보존하지
않는다. 안전한 `UNSUPPORTED` plain-text fallback과 code diagnostic으로 내린다. 현재
저장 asset 계약이 없는 image도 같은 경계에 속한다.

### 3.2 dirty flush와 revision

Compile 전에 App은 active scene과 entity note의 dirty editor를 저장한다.
`onBeforeCompile()`은 단순 성공 boolean이 아니라 저장 이후의 authoritative project
revision을 반환한다. Reader는 그 revision을 `expectedProjectRevision`으로 보내므로 React
prop 반영 시점과 compile 요청이 경쟁하지 않는다.

저장이 실패하거나 promise가 reject되면 이전 preview를 최신 원고처럼 계속 보여 주지
않는다. Preview를 가리고 재시도와 명시적인 `마지막 저장본 보기`만 제공한다. 사용자가
마지막 저장본을 선택한 뒤에도 stale badge는 성공적인 flush와 compile 전까지 유지된다.

응답은 session, project, scope, expected revision과 request generation을 다시 검사한다.
더 늦게 도착한 이전 compile 결과나 다른 project/session 결과는 commit하지 않는다.
Main의 runtime validation을 통과한 응답도 renderer에서 다시 검증한다. IPC 오류의 raw
문자열은 원고 UI에 그대로 노출하지 않고 고정된 오류 분류 문구로 바꾼다.

Preset과 pane 설정 변경은 같은 `PublicationDocument`를 다시 사용한다. Preset CRUD가
project revision을 올려도 그 mutation 자체로 Publication IR을 재compile하지 않는다.
원고/tree source revision, scope 또는 명시 refresh가 compile invalidation을 결정한다.

## 4. Publication IR과 source mapping

`PublicationDocument`는 다음을 포함하는 read-only 값이다.

- format version, project/scope identity와 compile 당시 project revision
- 제목, nullable 작가명, 언어 metadata
- scene section과 semantic block/inline tree
- 공백 포함/제외 문자 수, 문단·scene·chapter 수

모든 render block은 `PublicationSourceReference`를 가진다.

| 필드 | 의미 |
|---|---|
| `sourceNodeId` | heading이면 실제 hierarchy node, 본문이면 source scene |
| `sceneNodeId`, `documentId` | 원고를 열 때 사용할 compiler 결정 target |
| `blockId` | source semantic block identity |
| `start`, `end` | 검증된 문자 범위 또는 둘 다 `null` |
| `rangeVerified` | exact range를 사용할 수 있는지 여부 |

Hierarchy heading은 실제 `sourceNodeId`와 첫 descendant scene/document target을 함께
가진다. Range가 검증되지 않은 heading이나 block은 scene fallback으로 이동한다.
`rangeVerified=true`이면 `start <= end` 범위를 사용하며, 길이 0인 범위도 authored caret
위치로 유효하다. Diagnostic의 source `blockId`는 render block ID와 같다고 가정하지
않고 document에서 source reference를 찾아 render ID와 exact source를 함께 해석한다.

## 5. 격리된 semantic render

각 pane은 `open` Shadow root를 하나 만들고 React portal로 semantic node를 렌더한다.
`open`은 테스트와 focus 관찰을 가능하게 하는 선택이며 security sandbox를 뜻하지
않는다. 격리는 다음의 조합으로 성립한다.

1. Strict validator가 unknown field와 unknown union variant를 거부한다.
2. 원고 문자열은 React text node로만 들어간다.
3. `innerHTML`과 `dangerouslySetInnerHTML`을 사용하지 않는다.
4. URL, anchor, script, iframe, webview와 executable style variant가 IR에 없다.
5. Reader chunk는 원고를 위한 network request를 만들지 않는다.
6. Font는 고정된 local/system stack token만 사용하고 `@font-face`나 외부 URL을 받지
   않는다.
7. CSS 값은 검증된 enum, bounded number와 `#RRGGBB` 색에서만 만든다.

Packaged mode는 renderer URL과 core binary를 package-owned path로만 resolve한다. 개발용
`MADI_RENDERER_URL`/`MADI_CORE_BIN` environment override는 packaged process에서 무시하고,
production CSP는 development Vite WebSocket origin을 허용하지 않는다. 이 app-level
경계는 preview 자체의 non-executable Shadow DOM 규칙과 함께 적용된다.

Shadow CSS는 preview 밖 앱 CSS의 유입과 preview style의 유출을 막는다. Safe area,
reader chrome과 viewport를 실제 pane 구조에 예약하고, 같은 CSS를 visible render와
measurement에 사용한다. 이 결정의 보안 근거와 거부한 대안은
[ADR-0006](./decisions/ADR-0006-reader-lab-rendering-is-isolated-and-non-executable.md)에
기록한다.

## 6. bounded section virtualization

큰 scope에서 전체 section DOM을 동시에 mount하지 않는다. Renderer는 각 section의
추정 또는 관측 height로 누적 layout을 만들고, viewport와 고정 overscan이 교차하는
section만 mount한다. 앞뒤 공간은 padding으로 보존한다.

Mounted section이 실제로 차지한 height는 cache에 반영한다. Document content hash나
layout geometry에 영향을 주는 config가 바뀌면 cache를 버리고 다시 계산한다. 멀리 있는
선택 block으로 이동할 때 첫 section부터 대상까지 모두 펼치지 않고 대상 section
offset으로 먼저 jump한다.

Visible windowing과 전체 통계 측정은 별도 책임이다. 각 pane의 hidden measurement
layer는 visible pane과 같은 Shadow CSS로 section 하나만 렌더하고, 다음 task로 양보한
뒤 다음 section을 처리한다. 따라서 첫 화면은 전체 scope 측정 완료를 기다리지 않으며,
전체 원고 DOM을 한꺼번에 만들지 않는다. Document/config 변경은 측정 결과와 overflow
목록을 즉시 초기화한다.

## 7. 1/2/3 pane와 scroll sync

Pane은 같은 Publication IR을 공유하지만 다음 값은 각자 가진다.

- preset과 resolved device/settings/work style
- pane-local override와 zoom
- scroll progress, section window와 measurement cache
- pane-local keyboard roving target

공통 selected source block은 모든 pane에서 highlight한다. 설정과 diagnostic panel은
현재 active pane을 기준으로 한다. Resolved config는 preset/override가 바뀔 때만 새로
계산하며 scroll hot path는 전체 document 통계와 diagnostic을 다시 scan하지 않는다.

Scroll sync는 각 pane의 `scrollTop / maxScroll`인 정규화 progress를 복제한다. Imperative
scroll guard와 작은 차이의 no-op 처리로 pane 간 feedback loop를 막는다. 서로 다른
viewport, font, line height와 section 측정 상태에서는 같은 progress가 같은 문장이나
페이지를 뜻하지 않는다. 따라서 scroll sync는 대략적인 상대 위치 동기화이며 semantic
page alignment 보장이 아니다. Sync가 꺼지면 pane은 독립 위치를 유지한다.

## 8. source navigation과 diagnostics

Block click 또는 keyboard activation은 render block을 선택하고 source callback을
호출한다. 검증된 범위는 exact selection/reveal에 쓰고, 미검증 범위는 target scene과
block 주변 context로 이동한다. Source target이 계약상 유효하지 않으면 navigation을
활성화하지 않는다.

Core diagnostic은 code, severity와 nullable source identity만 전달한다. UI는 code를
고정된 한국어 label로 변환하고 raw core message나 manuscript text를 diagnostic label로
사용하지 않는다. Layout diagnostic도 고정 code와 측정된 숫자로만 문구를 만든다.
Diagnostic item은 클릭과 keyboard로 preview highlight와 source navigation을 실행한다.

## 9. preset, UI state와 snapshot

Canonical preset은 SQLite `reader_presets` row에 fully resolved config, provenance,
verification status, hash와 revision으로 저장된다. Built-in template은 renderer-owned
immutable option이며 저장할 때 `USER_DEFINED` config와 유효한 provenance로 변환한다.
중복 이름은 허용하지만 목록에서 경고한다.

`reader-lab.v1`은 다음의 재생성 가능한 UI preference다.

- 마지막 scope와 1/2/3 pane 수
- 세 pane slot의 preset, device, override, zoom과 scroll progress
- scroll sync, panel 폭, selected render block과 diagnostic 펼침 상태

현재 named snapshot은 canonical `reader_presets`를 포함하지만 `reader-lab.v1`을
포함하지 않는다. Snapshot restore 뒤 App의 reload token이 preset 목록과 UI reference를
다시 strict-validate한다. 삭제된 selected preset은 유효한 option으로 normalize하되,
snapshot에서 제외된 pane 배치와 사용자 UI preference를 restore 값으로 덮지 않는다.
Reload token 자체는 Publication IR의 중복 compile 원인이 아니다.

## 10. 접근성과 관찰 가능성

- Scope와 preset은 native select의 keyboard 동작을 사용한다.
- Pane tab은 roving `tabIndex`와 Arrow/Home/End를 지원한다.
- Source block은 pane-local roving target을 유지하고 Arrow/Home/End로 virtualized
  section 밖 block까지 이동한다.
- Enter/Space는 source navigation을 실행한다.
- 선택은 색뿐 아니라 `aria-pressed`로 노출한다.
- 숨긴 scene break는 focus target을 만들지 않는다.
- Diagnostic은 button이며 busy, stale, error와 measurement progress는 적절한
  live/status/alert semantics를 사용한다.
- Hidden measurement DOM은 `aria-hidden`이고 tab order나 landmark에 들어가지 않는다.

실제 Electron 검증을 위해 canonical section/block 수, mounted 수, measurement가 각
section DOM에서 실제 관찰해 누적한 block 수, measurement 상태, pane token/numeric
config, selected source, scroll progress와 compile 단계 timing을 content-free data
attribute로 노출한다. Document/config key가 바뀌면 measured block 수는 0부터 다시
시작한다. Manuscript/preset 이름이나 본문은 log와 관찰 label에 넣지 않는다. 이 문서는
측정 결과나 성능 판정을 기록하지 않는다.

## 11. 관련 문서

- [Phase 1F result](./PHASE_1F_RESULT.md)
- [Reader Lab performance](./READER_LAB_PERFORMANCE.md)
- [Reader profile format v1](./READER_PROFILE_FORMAT_V1.md)
- [Reader Lab visual diagnostics](./READER_LAB_VISUAL_DIAGNOSTICS.md)
- [ADR-0006: Reader Lab rendering is isolated and non-executable](./decisions/ADR-0006-reader-lab-rendering-is-isolated-and-non-executable.md)
- [Typie pinning and patches](./TYPIE_PINNING_AND_PATCHES.md)
