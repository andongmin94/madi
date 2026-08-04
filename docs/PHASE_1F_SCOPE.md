# Phase 1F — Publication IR & Reader Lab 범위

기준일: 2026-08-09

```text
Phase 1E entry verdict: TECHNICAL GO — PRIVATE LOCAL
Phase 1F development boundary: PRIVATE LOCAL
Windows native Korean IME: MANUAL VALIDATION PENDING
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Public/paid/customer distribution: NOT AUTHORIZED
```

이 문서는 Phase 1F의 제품·기술 경계를 고정한다. Phase 1F의 성능 수치, 실행 증거와 최종
판정은 이 범위 문서에 기록하지 않는다. 실행하지 않은 test/package/Electron 결과를
완료 증거로 간주하지 않는다.

## 1. 목적

Phase 1F는 canonical Typie 원고를 engine-independent `PublicationDocument v1`으로
compile하고, 작가가 같은 원고를 여러 읽기 설정에서 비교하는 Reader Lab을 추가한다.

핵심 흐름은 다음과 같다.

```text
stored SCENE snapshots
        → Publication IR v1
        → strict desktop validation
        → isolated 1/2/3 pane Reader preview
        → render statistics/diagnostics
        → verified source navigation
```

Publication IR은 파생 read model이고 Reader preset은 별도의 canonical 사용자 설정이다.
Preview layout, scroll, selection과 measurement cache는 UI/runtime state다.

## 2. Publication compile 범위

- `SCENE`, `CHAPTER`, `VOLUME`, `WORK` Binder scope
- expected project revision을 검사한 closed-document core compile
- tree `order_key`+ID 순서의 scene descendant traversal
- pinned Typie engine/commit/schema identity 검증
- lossless changeset decode와 non-degraded `DocView` projection
- Paragraph, ThreeDiamonds SceneBreak와 paragraph-based Quote decode
- Text, Strong, Emphasis, Underline, Strike와 Ruby inline subset
- Binder WORK/VOLUME/CHAPTER/SCENE hierarchy heading
- Unsupported plain-text fallback과 block/modifier diagnostic
- public stable hash ID와 verified exact/caret source range
- deterministic canonical JSON과 SHA-256 content hash
- source 문자/paragraph/scene/chapter 통계의 재계산과 검증

Compile 전에 active scene/entity note dirty editor를 flush하고 post-flush authoritative
revision을 사용한다. Flush 실패/rejection은 이전 preview를 최신 상태처럼 보여 주지 않는
fail-closed 상태다. 사용자가 명시적으로 선택한 마지막 저장본만 stale badge와 함께 볼 수
있다.

Publication IR exact 계약은 [Publication IR v1](./PUBLICATION_IR_V1.md), 파생 모델 결정은
[ADR-0005](./decisions/ADR-0005-publication-ir-is-derived-engine-independent-model.md)를
따른다.

## 3. Reader Lab UI 범위

### Scope와 pane

- 현재 active scene, Binder selection과 유효 restored scope에서 scope option 구성
- invalid/deleted scope는 tree order의 첫 valid scene과 ancestor scope로 normalize
- 1/2/3개 preview pane
- pane별 preset, device/profile override, zoom과 scroll progress
- active pane 설정/통계/diagnostic panel
- 모든 pane의 공통 selected source block highlight
- optional normalized scroll sync

Scroll sync는 서로 다른 layout의 상대 progress를 맞추며 exact page/문장 alignment를
보장하지 않는다. Programmatic sync guard와 epsilon no-op으로 pane feedback loop를
차단한다. Sync가 꺼지면 각 pane이 독립 위치와 keyboard roving target을 가진다.

### Semantic render와 격리

- Reader mode/workspace의 lazy-loaded renderer boundary
- pane별 Shadow root와 고정 internal CSS
- React semantic element와 text node만 사용
- `innerHTML`, external URL/font/style/script/network 없음
- packaged renderer/core는 package-owned source만 사용하고 dev environment override 무시
- production CSP에서 development WebSocket origin 제외
- safe area, reader chrome과 effective viewport의 실제 DOM 반영
- chapter/scene title과 scene-break WorkStyle token 반영
- 지원하지 않는 image/semantic node의 plain-text fallback

상세 구조는 [Reader Lab architecture](./READER_LAB_ARCHITECTURE.md), 보안 결정은
[ADR-0006](./decisions/ADR-0006-reader-lab-rendering-is-isolated-and-non-executable.md)를
따른다.

## 4. 큰 scope 렌더링 범위

Visible preview는 큰 scope에서 section windowing을 사용한다. Viewport+overscan에 속한
section만 mount하고 앞뒤 공간은 cumulative layout padding으로 보존한다. 멀리 있는
source block 이동은 중간 section 전체를 펼치지 않고 target section으로 jump한다.

Full-scope 통계는 visible first render를 막지 않는다. 같은 Shadow CSS를 쓰는 hidden
layer에서 section 하나씩 측정하고 event loop에 양보한다. 전체 scope DOM을 한 번에
mount하지 않으며 progress를 `ESTIMATED`, `MEASURING`, `COMPLETE`로 구분한다.

Document hash 또는 geometry config가 바뀌면 section height, measured block과 overflow
cache를 초기화한다. Scroll-only update는 config/document identity와 전체 통계 scan을
무효화하지 않는다.

## 5. Reader profile과 preset 범위

- fully resolved `ReaderRenderConfig` version 1
- strict platform/device/settings/WorkStyle token과 relational validation
- generic built-in profile과 platform-like `UNVERIFIED_SIMULATION`
- local/system font token만 사용
- 사용자 preset create/update/duplicate/delete
- project revision과 preset별 optimistic revision
- canonical config JSON, lowercase color와 SHA-256 hash
- source provenance/status/config 일치 검증
- 중복 이름 허용과 지속적인 warning
- pane-local override의 안전한 relational repair 후 재검증

Built-in은 immutable renderer option이다. 저장할 때 official platform verified profile로
승격하지 않고 `USER_DEFINED` config와 유효한 custom/duplicate provenance를 쓴다. Preset,
device 또는 pane config 변경은 Publication IR을 재compile하지 않는다.

Exact format은 [Reader profile format v1](./READER_PROFILE_FORMAT_V1.md)을 따른다.

## 6. 통계와 diagnostics 범위

Source 통계와 active-pane render 통계를 분리한다. Full-scope incremental measurement가
완료되면 actual rendered height, line count, 8줄 이상 paragraph, horizontal overflow와
block height를 measured 값으로 교체한다. 완료 전에는 estimator라는 사실을 UI에
명시한다.

Core diagnostic code는 unsupported block/modifier, invalid semantic document와 empty
scope를 다룬다. Renderer diagnostic은 long paragraph, viewport보다 큰 paragraph,
horizontal overflow, 연속 empty paragraph, 연속 scene break와 unsupported fallback을
다룬다.

Diagnostic은 문장 품질 판정이 아니다. Code/severity/source identity와 측정 숫자에서
고정 한국어 문구를 만들며 raw IPC message, 작품/preset 이름이나 manuscript text를
label/log에 넣지 않는다. 상세 의미는
[Reader Lab visual diagnostics](./READER_LAB_VISUAL_DIAGNOSTICS.md)를 따른다.

## 7. source navigation 범위

- Preview block click/keyboard activation에서 render selection 유지
- Core diagnostic source block ID를 Publication block source ID로 resolve
- `rangeVerified=true`, `start < end`의 exact text reveal
- `rangeVerified=true`, `start == end`의 exact caret reveal
- unverified heading/block의 compiler-selected scene/document fallback
- target section virtualization jump와 focus restore
- stale/nullable/unmatched source를 추측하지 않는 fail-closed 처리

Heading의 `sourceNodeId`는 actual hierarchy node지만 navigation target은 compiler가
선택한 first descendant scene/document다. Body source node는 section scene과 같다.

## 8. persistence와 snapshot 범위

Phase 1F는 logical `.madi` format version 1을 유지하고 SQLite schema 6의
`reader_presets` table을 사용한다. Publication IR, compile hash/diagnostic, measurement와
preview DOM은 저장하지 않는다.

Named logical snapshot payload v4는 canonical `reader_presets` row를 포함한다.
`reader-lab.v1` UI state는 snapshot에서 제외한다. Snapshot restore 뒤 Reader reload token은
preset 목록/config/hash/status와 UI reference를 다시 검증하고, 삭제된 selected preset을
유효 option으로 normalize한다. Snapshot에서 제외된 pane 수, override, zoom, scroll,
panel 폭과 selection은 restore payload로 덮지 않는다. Reload token 자체는 IR을 중복
compile하지 않는다.

`reader-lab.v1`에는 마지막 scope, 세 pane slot, pane count, scroll sync, panel 폭,
selected render block과 diagnostic 펼침만 저장한다. 이 UI-state save는 Publication/preset
canonical content가 아니다.

## 9. accessibility와 observability 범위

- Scope/preset native select keyboard 동작
- Pane tab roving `tabIndex`와 Arrow/Home/End
- Virtualized source block의 pane-local Arrow/Home/End navigation
- Enter/Space source activation
- Diagnostic button과 expanded state
- Hidden scene break의 focus target 제거
- `aria-pressed`, busy/status/alert/live semantics
- Hidden measurement DOM의 `aria-hidden`과 tab-order 제외

실제 Electron 관찰을 위해 canonical/mounted section·block 수, measurement progress,
pane token/numeric config, selected source, scroll progress와 compile 단계 timing을
content-free data attribute로 노출할 수 있다. Manuscript/preset 표시 문자열을 log에 넣지
않는다. 이 scope 문서는 해당 timing 결과를 보고하지 않는다.

## 10. 명시적 금지 범위

Phase 1F Publication/Reader 경계에 다음을 포함하거나 자동 결합하지 않는다.

- Story Bible entity/alias/tag/relation/scene link를 Publication section/block으로 변환
- Entity note document를 manuscript scope에 포함
- Plot Canvas node/edge/text를 작품 전체 출판 원고로 포함
- World Graph node/edge/layout/filter를 Publication 또는 Reader preset에 저장
- `plain_text_recovery`/search projection으로 semantic block이나 range를 재구성
- Typie `Dot`, changeset, `DocView`, modifier/runtime object를 IPC/public JSON에 노출
- Editor DOM/selection/composition/Undo stack을 Reader에 복제
- Unsupported block/modifier를 diagnostic 없이 삭제
- Text occurrence scan으로 exact source range를 추측
- Publication IR, render statistics 또는 measurement cache를 SQLite/snapshot에 저장
- Reader preset/UI 변경으로 manuscript IR 재compile
- External HTML/CSS/font/image/script/iframe/webview/network resource 실행
- 외부 플랫폼의 공식 또는 pixel-exact 재현 주장
- EPUB, HWP/HWPX, PDF 출판 export
- LLM 분석, 자동 문장 품질 판정, 자동 수정
- Cloud/sync/collaboration, account/server, installer/signing/update와 공개 배포

위 항목은 구현 편의를 위한 fallback으로도 추가하지 않는다. 새 요구가 생기면 canonical
소유권, source mapping, snapshot, security와 version을 별도 Phase/ADR에서 결정한다.

## 11. 검증 원칙

Phase 1F 검증은 다음 경계를 독립적으로 다룬다.

- lossless/degraded Typie snapshot decode와 private adapter isolation
- paragraph/scene-break/quote/inline subset과 unsupported fallback
- stable ID, exact/caret range round-trip과 deterministic content hash
- scope/hierarchy/tree order, revision conflict와 forbidden data exclusion
- Rust/shared exact validation, budgets, stats와 tamper rejection
- preset provenance/hash/revision/CRUD와 snapshot restore revalidation
- dirty flush, stale compile, last-saved fail-closed UX
- Shadow semantic render, no executable/network surface와 lazy boundary
- section windowing, incremental measurement와 scroll hot path isolation
- multi-pane selection/scroll sync와 source/diagnostic navigation
- keyboard/focus/ARIA와 content-free Electron observability

성능 측정치, package/runtime 실행 결과와 Phase 1F 판정은 실제 증거를 수집하는 별도 결과
문서에서만 기록한다.

## 12. 관련 문서

- [Phase 1F result](./PHASE_1F_RESULT.md)
- [Reader Lab performance](./READER_LAB_PERFORMANCE.md)
- [Publication IR v1](./PUBLICATION_IR_V1.md)
- [ADR-0005](./decisions/ADR-0005-publication-ir-is-derived-engine-independent-model.md)
- [Reader Lab architecture](./READER_LAB_ARCHITECTURE.md)
- [Reader profile format v1](./READER_PROFILE_FORMAT_V1.md)
- [Reader Lab visual diagnostics](./READER_LAB_VISUAL_DIAGNOSTICS.md)
- [ADR-0006](./decisions/ADR-0006-reader-lab-rendering-is-isolated-and-non-executable.md)
- [Typie pinning and patches](./TYPIE_PINNING_AND_PATCHES.md)
- [License decision required](./LICENSE_DECISION_REQUIRED.md)
