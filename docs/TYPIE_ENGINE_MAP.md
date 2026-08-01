# Typie 편집 엔진 지도

> **Phase 0 동결 기록:** 아래 내용은 Phase 0 당시 상태를 보존한다. 현행 Phase 0.5 상태는 [종료 기준](PHASE_0_5_EXIT_CRITERIA.md)과 [폐쇄 결과](PHASE_0_5_CLOSURE_RESULT.md)를 따른다.

## 조사 기준

- upstream: `https://github.com/penxle/typie`
- 고정 commit: `fbe5c4bf860d1717a66e66bea2374a2e39f0dd26`
- 로컬 소스: `vendor/typie`
- Rust workspace: `vendor/typie/Cargo.toml`
- browser FFI package version: `0.0.1`, `private: true`
- license: `AGPL-3.0-only`

이 문서는 이름으로 역할을 추정한 결과가 아니다. 위 commit의 Rust/TypeScript 소스와
실제로 생성한 browser WASM binding을 기준으로 한다. Typie 제품의 계정, API, 결제,
클라우드, 동기화 UI는 madi의 실행 경로에 포함하지 않았다.

## 계층 개요

```text
DOM keyboard / beforeinput / composition / clipboard / pointer
  └─ madi의 Typie 입력 포트
       └─ editor-ffi::Editor.enqueue_request / tick_through
            └─ editor-core::Editor + Message handler
                 ├─ editor-state::State / Selection / Composition / UndoHistory
                 ├─ editor-transaction::Transaction / Step / Effect
                 ├─ editor-model::PlainDoc / EditOp / schema
                 ├─ editor-crdt::OpGraph / Changeset / Dot
                 ├─ editor-clipboard::Slice / ClipboardPayload
                 ├─ editor-view::View / Viewport
                 └─ editor-renderer::Renderer / CPU RenderBackend
                      └─ editor-ffi::platform::wasm_browser
                           └─ HTMLCanvasElement + CanvasRenderingContext2D
```

저장 경로는 별도다.

```text
editor-ffi::Editor.missing_changesets_tolerant([])
  └─ editor-codec changeset bundle bytes
       └─ MadiEditorAdapter.getSnapshot()
            └─ 명시적 저장 시 Electron IPC
                 └─ madi-core
                      └─ SQLite snapshot_blob
```

## crate 및 소스 책임

| 책임 | crate | 실제 소스와 주요 symbol | madi에서의 사용 |
|---|---|---|---|
| 문서 모델 | `editor-model` | `crates/editor-model/src/plain.rs`: `PlainDoc`, `PlainNodeEntry`; `src/nodes/mod.rs`: `Node`, `NodeType`, `PlainNode`; `src/edit_op.rs`: `EditOp`; `src/projection.rs`: `project_document` | 새 문서의 `PlainDoc` 구성, 의미 노드 타입, CRDT payload 모델 |
| schema | `editor-model` | `crates/editor-model/src/schema/definitions.rs`: `Schema::node_spec`; `src/schema/spec.rs`: `NodeSpec`; `src/schema/content.rs` | 허용 child 구조 및 node 성질 결정 |
| CRDT | `editor-crdt` | `crates/editor-crdt/src/op_graph.rs`: `OpGraph`, `Op`, `missing_changesets_for`, `commit`; `src/changeset.rs`: `Changeset`; `src/dot.rs`: `Dot`; `src/oplog.rs`: `OpLog` | 단일 사용자에서도 제거하지 않은 문서 정본, changeset 계산 |
| projected state | `editor-state` | `crates/editor-state/src/state.rs`: `State`; `src/projected_state.rs`: `ProjectedState`; `src/apply.rs`; `src/to_plain.rs` | CRDT graph를 편집 가능한 문서 상태로 projection |
| position/selection | `editor-state` | `crates/editor-state/src/position.rs`: `Position`, `ResolvedPosition`; `src/selection.rs`: `Selection`, `ResolvedSelection`; `src/stable_selection.rs`: `StableSelection` | caret, range selection, 구조 변경 후 selection 해석 |
| IME state | `editor-state`, `editor-core` | `crates/editor-state/src/composition.rs`: `Composition`; `crates/editor-core/src/ime.rs`: `Ime`, `ImeRange`; `crates/editor-core/src/message.rs`: `FlatImeOp`, `Message::TextInput` | DOM 조합 범위를 flat offset 기반 엔진 명령으로 적용 |
| transaction | `editor-transaction` | `crates/editor-transaction/src/transaction.rs`: `Transaction`, `commit`; `src/step.rs`: `Step`; `src/effect.rs`: `Effect`; `src/steps/*` | 텍스트/구조/selection/composition 변경을 원자적 step으로 적용 |
| undo/redo | `editor-state`, `editor-core` | `crates/editor-state/src/undo.rs`: `UndoHistory`, `UndoEntry`; `crates/editor-core/src/handle/history.rs`; `crates/editor-core/src/message.rs`: `HistoryOp::{Undo,Redo}` | renderer 내부 history 명령과 caret 복원 |
| 편집 orchestration | `editor-core` | `crates/editor-core/src/editor.rs`: `Editor`; `src/message.rs`: `Message`; `src/tick.rs`: `TickResult`, `RequestId`, `Revision`; `src/event.rs`: `EditorEvent`; `src/handle/*` | 입력 queue, command dispatch, 상태 변경, render invalidation |
| clipboard 변환 | `editor-clipboard` | `crates/editor-clipboard/src/slice.rs`: `Slice::{extract,to_text,from_text,to_html,from_html,from_payload}`; `src/payload.rs`: `ClipboardPayload`; `src/html/*`, `src/text/*` | selection을 text/HTML로 복사하고 text/HTML 붙여넣기를 model fragment로 변환 |
| layout/view | `editor-view` | `crates/editor-view/src/view.rs`: `View::{layout,reconcile,hit_test,cursor_metrics,selection_rects,composition_rects,resize}`; `src/viewport.rs`: `Viewport`; `src/measure/*`, `src/paginate/*`, `src/query/*` | 문서 layout, hit testing, caret/selection/composition geometry |
| renderer | `editor-renderer` | `crates/editor-renderer/src/renderer.rs`: `Renderer::render_page`; `src/backend/mod.rs`: `RenderBackend::try_new_cpu`; `src/diff.rs`: `render_incremental`; `src/display_list.rs` | page display list 및 damage 기반 CPU raster |
| browser surface | `editor-ffi` | `crates/editor-ffi/src/platform/wasm_browser.rs`: `PlatformHandle = HtmlCanvasElement`, `CpuPageSurface`, `SurfaceHandle`; `Editor::{attach_surface,resize_surface,render_surface}` | CPU buffer를 `CanvasRenderingContext2D.putImageData`로 Canvas에 표시 |
| codec | `editor-codec` | `crates/editor-codec/src/convert.rs`: `encode_changesets`, `decode_changeset_stream`; `src/bundle.rs`: `encode_dots`, `decode_dots`, `split_bundle_bytes`; `src/types/*`: durable wire types | changeset graph의 binary snapshot 직렬화/복원 |
| font/ICU | `editor-resource` | `crates/editor-resource/src/segmentation.rs`: `IcuResources`, `TextSegmenters`; `src/resource.rs`: `ResourceSource`, `prepare_font_base`; `src/font/*`; `src/zstd.rs` | ICU segmentation과 압축 글꼴 로드 |
| WASM FFI | `editor-ffi` | `crates/editor-ffi/src/host.rs`: `EditorHost`; `src/editor.rs`: FFI `Editor`; `src/graph.rs`: `state_from_changesets`; `Cargo.toml`: `wasm-browser` feature | Rust 엔진을 browser-compatible TypeScript/WASM API로 노출 |
| binding 생성 | `editor-bindgen` | `crates/editor-bindgen/src/bin/wasm-bindgen.rs`; `src/bin/editor-bindgen-js.rs`: `createInstance` wrapper 생성 | 한 `WebAssembly.Module`에서 격리된 binding instance 생성 |
| 개발용 introspection | `editor-introspection`, `editor-ffi` | `crates/editor-ffi/src/editor.rs`: `inspect_state`, `inspect_state_as_macro`; `crates/editor-introspection/src/*` | 개발 패널/진단용이며 저장 정본은 아님 |

`editor-commands`와 `editor-common`도 `editor-core`의 명령 처리와 공통 타입을
지원한다. 반대로 `editor-server`는 `editor-ffi`의 optional dependency이고,
`wasm-browser` feature에는 포함되지 않는다.

## browser/WASM 진입점

browser 진입점은 실제로 존재한다.

- `crates/editor-ffi/Cargo.toml`
  - library type: `cdylib`, `rlib`, `staticlib`
  - feature: `wasm-browser = ["wasm", "dep:web-sys", "dep:js-sys"]`
  - `wasm-browser`와 `wasm-server` 동시 활성화는 compile error다.
- `crates/editor-ffi/justfile`
  - `wasm32-unknown-unknown` target으로 `release-wasm-browser` profile을 빌드한다.
  - Typie의 `wasm-bindgen-cli` wrapper와 `editor-bindgen-js`를 차례로 실행한다.
  - release recipe는 마지막에 `wasm-opt -Os --all-features`를 실행한다.
  - 완성된 WASM에서 필요한 ICU marker를 읽어 `icu.zst`를 만든다.
- `crates/editor-bindgen/src/bin/editor-bindgen-js.rs`
  - 생성 JS를 `createInstance(wasmModule)` 형태로 바꾼다.
- `apps/website/src/lib/wasm-ffi.svelte.ts`
  - upstream 제품의 실제 browser 초기화 예다.

madi가 실제 source build한 runtime은 `packages/typie-runtime`에 최소 산출물만
분리했다.

- `browser/editor_ffi.js`, `browser/editor_ffi.d.ts`
- `browser/editor_ffi_bg.wasm`
- `browser/icu.zst`
- `assets/NanumGothic-Regular.base.zst`
- `assets/NanumGothic-Regular.manifest.zst`
- `assets/NanumGothic-Regular.chunk-0.zst`
- Typie AGPL 원문과 Nanum Gothic OFL 원문
- `BUILD_INFO.json`

`BUILD_INFO.json`에 기록된 산출물 SHA-256은 다음과 같다.

| asset | bytes | SHA-256 |
|---|---:|---|
| browser WASM | 9,381,730 | `c6cc7d32cebfe3d3e48b3c79e60de0e28a815761f68779fdec415217425ee939` |
| ICU blob | 2,231,873 | `050e08ceebfa8d92f583b80bb31fcb6a792a760ffa821deb3f2316c12ad578f0` |
| Nanum Gothic font base | 89,616 | `54418892219582d1d1334f79ad5fc7fdc74d646464beb0d9bcb600ebacb08517` |
| Nanum Gothic font manifest | 966 | `81424decc8cebe05ac5c4597248648d0f5416742acfcc25c22990e75537e3ca5` |
| Nanum Gothic full-glyph chunk 0 | 884,964 | `489e66dc686591b671f3b14c00cde16922b62b63e06f0563ca5695c6c5101502` |

이 환경에는 `wasm-opt`이 없어 upstream release recipe의 최종 크기 최적화 단계만
생략했다. Rust release WASM compile, binding 생성, ICU4X datagen, 글꼴 압축과
runtime probe는 실제로 수행했다.

글꼴도 Typie의 실제 resource pipeline으로 생성했다.
`scripts/build-typie-font.mjs`가 source-built server WASM의
`EditorServer.get_font_codepoints`와 `EditorServer.build_font`를 호출해
base/manifest/chunk 0을 만들었다. 고정된 Typie engine font hash는
`a178cbd6767300e8`이다. chunk 0에 source font의 전체 codepoint를 담아 runtime
font server 없이 동일 protocol을 사용한다.

## renderer 초기화 순서

madi 구현은
`apps/desktop/src/renderer/editor/typie/createTypieEnginePort.ts`에 격리돼 있다.

1. Vite가 생성한 `madi://app` asset URL로 로컬 WASM, ICU blob, font
   base/manifest/chunk bytes를 읽는다.
2. `WebAssembly.compile(wasmBytes)`를 호출한다.
3. 생성 binding의 `createInstance(WebAssembly.Module)`을 호출한다.
4. 반환된 `EditorHost` class의 `EditorHost.create(icuData)`로 host를 만든다.
5. `EditorHost.set_fonts`, `add_font_base`, `add_font_manifest`,
   `add_font_chunk`로 고정 hash의 글꼴을 등록한다.
6. 새 문서는 `EditorHost.create_editor_from_doc`, 복원 문서는
   `EditorHost.create_editor_from_graph`로 만든다.
7. `Message::System { Initialize }`와 초기 selection message를
   `enqueue_request`/`tick_through`로 적용한다.
8. `Editor.attach_surface`로 page 0과 `HTMLCanvasElement`를 연결하고,
   `render_surface`를 `requestAnimationFrame`에서 호출한다.

`EditorHost.create_editor_from_graph`의 실제 구현은
`crates/editor-ffi/src/host.rs`에서 `graph::state_from_changesets`로 bytes를 decode한
뒤 `editor_core::Editor::new`를 호출한다.

production asset fetch는 Electron main의
`apps/desktop/src/main/appProtocol.ts`가 `madi://app` origin에서 제공한다. protocol
handler는 renderer build root, `GET`/`HEAD`, 정해진 web asset 확장자만 허용한다.
path traversal, 다른 host, NUL, 임의 확장자와 arbitrary `file://` 접근은 허용하지
않는다. 실제 Electron smoke에서 local WASM/ICU/font fetch가 성공했고 외부 runtime
request는 0건이었으며 workspace의 임의 `file://` 파일 읽기 probe는 차단됐다.

## 입력, IME, selection, history 흐름

Rust 측 IME API는 다음 두 경계를 제공한다.

- 읽기: `editor-ffi/src/editor.rs`의 `Editor::ime(before, after)` →
  `editor-core/src/editor.rs`의 `Editor::ime` → `Ime`
- 쓰기: `Message::TextInput { ops: Vec<FlatImeOp> }`

`FlatImeOp`에는 `SetSelection`, `ReplaceSelection`, `Compose`,
`DeleteSurrounding`, `DeleteSurroundingUtf16`, `SetComposition`,
`ClearComposition`, `CommitAsIs`, `MoveCursor`가 실제로 정의돼 있다.

브라우저의 native composition event를 이 명령으로 바꾸는 코드는 Rust crate가
아니라 upstream website의 plain TypeScript adapter다.

- `apps/website/src/lib/editor-ffi/input/ime-context.ts`
- `apps/website/src/lib/editor-ffi/input/ime-normalizer.ts`
- `apps/website/src/lib/editor-ffi/input/ime-input-adapter.ts`
- `apps/website/src/lib/editor-ffi/input/ime-resync.ts`
- wiring 예: `apps/website/src/lib/editor-ffi/components/Input.svelte`

madi는 Svelte component를 가져오지 않고 위 adapter 로직을 출처/commit/SPDX와 함께
다음 파일로 옮겨 React-independent DOM adapter로 사용한다.

- `apps/desktop/src/renderer/editor/typie/input/ime-context.ts`
- `apps/desktop/src/renderer/editor/typie/input/ime-normalizer.ts`
- `apps/desktop/src/renderer/editor/typie/input/ime-input-adapter.ts`

`createTypieEnginePort.ts`가 투명 textarea의 `beforeinput`, `input`,
`compositionstart/update/end`, keyboard, clipboard, pointer event를 연결한다. 이
경로는 renderer 안에서 바로 `enqueue_request`/`tick_through`를 호출하므로 키 입력마다
Electron IPC를 왕복하지 않는다.

selection은 `Message::Selection`, navigation은 `Message::Navigation`, undo/redo는
`Message::History`로 같은 queue를 이용한다. copy는 `Editor::copy_selection`,
cut/paste는 `Message::Clipboard`와 `editor-clipboard`를 이용한다.

단, Windows 한국어 IME의 실제 native event sequence는 자동 message probe와 다르다.
사람이 직접 실행한 결과가 없는 항목은
`docs/MANUAL_KOREAN_IME_CHECKLIST.md`에서 모두 `NOT TESTED`다.

## layout 및 renderer 요구사항

현재 browser platform은 WebGPU가 아니다.

`crates/editor-ffi/src/platform/wasm_browser.rs`는 다음을 명시한다.

- `PlatformHandle = web_sys::HtmlCanvasElement`
- `SurfaceHandle = CpuPageSurface`
- `RenderBackend::try_new_cpu`
- damage 영역을 CPU로 raster
- `CanvasRenderingContext2D.putImageData`로 present

`editor-ffi/Cargo.toml`의 `web-sys` feature 목록에는 `WebGl2RenderingContext` 등도
있지만 현재 `wasm_browser.rs`의 page present 경로는 CPU + Canvas 2D다. 따라서 Phase
0의 확인된 필수 runtime은 WebAssembly, Canvas 2D, DOM input/composition event,
`ResizeObserver`, `requestAnimationFrame`, ICU blob과 유효한 글꼴이다. WebGPU는
필수로 확인되지 않았고 WebGL 경로도 이 시제품에서 사용하지 않는다.

production-mode Electron smoke는 `surface_backend(0) === "cpu"`, 유효한 frame key,
0보다 큰 Canvas 크기와 non-transparent pixel sample을 실제 browser context에서
저장 전과 재실행 복원 뒤 모두 확인했다. font missing event는 `0`이었다. 즉 Rust
display list를 연결만 한 것이 아니라 Canvas 2D pixel present가 일어났다. 현재 madi
host는 `attach_surface(0, ...)`만 호출하므로 page 0 이외의 다중 page 표시와
scrolling은 아직 구현/검증하지 않았다.

## snapshot과 복원

Phase 0 snapshot은 `PlainDoc` JSON이 아니라 CRDT changeset bundle 전체다.

```ts
const result = editor.missing_changesets_tolerant(new Uint8Array());
const snapshot = result.bytes;
```

근거:

- `editor-ffi/src/editor.rs`: `Editor::missing_changesets_tolerant`
- `editor-codec/src/bundle.rs`: `decode_dots`는 빈 bytes를 빈 head set으로 해석
- `editor-crdt/src/op_graph.rs`: `OpGraph::missing_changesets_for`
- `editor-codec/src/convert.rs`: `encode_changesets`,
  `decode_changeset_stream`

`withheld === 0`일 때만 snapshot으로 채택한다. 복원은
`EditorHost.create_editor_from_graph(snapshot, viewport)`이다.

이 bundle은 문서 graph의 정본이다. viewport, 현재 selection, composition과
`UndoHistory` 같은 transient UI/history 상태는 저장 계약에 포함하지 않는다.
복원 후 초기 selection을 다시 설정하므로, 앱 재시작 전 undo stack까지 복원된다고
주장하지 않는다.

plain-text recovery에는 `Editor::prose_text_annotated()`를 사용한다.
`editor-state/src/prose.rs`의 `prose_annotated`는 `HorizontalRule` atom을
`\n\n***\n\n`로 내보낸다. 일반 `prose_text()`는 이 divider를 생략하므로 recovery
copy에는 사용하지 않는다.

실제 Electron 저장/재실행 smoke에서는 저장 snapshot이 `244 bytes`, UI 진단용
fingerprint가 `fnv1a-f091b634`였다. 첫 Electron 프로세스를 완전히 종료하고 새
프로세스에서 `드래곤을죽이다.madi`를 열었을 때 두 값이 동일했다. 이 FNV-1a는
빠른 화면 확인용 비암호학적 fingerprint이고, 별도 CLI 통합 test는 SHA-256으로
저장 bytes의 동일성을 검사한다.

## 장면 구분선 확장 지점

Typie에는 이미 독립 leaf인 `horizontal_rule`이 있다.

- 모델: `crates/editor-model/src/nodes/horizontal_rule.rs`
  - `HorizontalRuleNode`
  - `HorizontalRuleVariant::ThreeDiamonds`
- node enum: `crates/editor-model/src/nodes/mod.rs`
  - `Node::HorizontalRule`
  - `NodeType::HorizontalRule`
- schema: `crates/editor-model/src/schema/definitions.rs`
  - Root/FoldContent/TableCell content에서 `HorizontalRule` 허용
- codec: `crates/editor-codec/src/types/item.rs`
  - `DurableNodeType::HorizontalRule`
- variant codec: `crates/editor-codec/src/types/values.rs`
  - `DurableHorizontalRuleVariant::ThreeDiamonds`
- upstream command 예:
  `apps/website/src/lib/editor-ffi/handlers/variant-flow.ts`의
  `createHorizontalRuleVariantMessage`

madi adapter는 다음 native fragment를 삽입한다.

```ts
{
  type: "insertion",
  op: {
    type: "fragment",
    fragment: {
      node: { type: "horizontal_rule", variant: "three_diamonds" }
    }
  }
}
```

따라서 `* * *`라는 일반 텍스트 세 글자가 아니라 selection/delete/undo/codec의
대상이 되는 독립 CRDT node다. 실제 probe에서 삽입, undo/redo, annotated prose,
snapshot 복원이 통과했다.

한계도 명확하다. Phase 0는 기존 `horizontal_rule` variant를 madi 장면 구분선으로
해석하므로, 향후 일반 가로선과 장면 구분선을 동시에 제공하면 둘을 영구적으로
구분할 별도 tag가 없다. 진짜 custom node를 추가하려면 최소한 다음 영역을 함께
변경해야 한다.

- `editor-model/src/nodes/*`, `nodes/mod.rs`, `schema/definitions.rs`
- `editor-codec/src/types/item.rs`, 필요 시 `types/values.rs`,
  `convert.rs`, codec schema/registry
- `editor-view/src/measure/nodes/*`
- `editor-renderer`의 표시 경로
- FFI 생성 타입과 adapter message

이 fork는 upstream 업데이트 때 schema/codec merge와 snapshot compatibility 검증을
계속 요구한다. Phase 0에서는 기존 semantic node를 adapter에서 제한적으로 해석하는
방식이 더 작은 통합면이다.

## Svelte 결합도

Rust 엔진 crate와 browser FFI는 Svelte를 import하지 않는다. 따라서 엔진 자체는
React renderer에서 실행 가능하며 실제 madi binding도 React에서 import된다.

다만 upstream의 완성된 browser host orchestration은 Svelte에 상당히 결합돼 있다.

- `apps/website/src/lib/editor-ffi/editor.svelte.ts`: editor lifecycle, tick,
  scroll, render, resource, clipboard 등을 묶은 대형 wrapper
- `apps/website/src/lib/editor-ffi/components/Input.svelte`: textarea와
  composition/keyboard/clipboard wiring
- 여러 `components/*.svelte`, `handlers/*.ts`

madi는 이 UI/wrapper를 복제하지 않고 `MadiEditorAdapter`에 필요한 subset을 직접
구현했다. Rust FFI 재사용성은 높지만, DOM IME와 Canvas host orchestration은
“binding import만 하면 끝나는” 수준이 아니다. 특히 upstream IME adapter 변경을
추적해 madi의 port에 반영하는 일이 지속적인 유지보수 항목이다.

## 단일 사용자 모드와 서비스 비의존성

CRDT를 제거하지 않아도 로컬 단일 사용자 editor를 만들 수 있다.

- `EditorHost.create_editor_from_doc`가 로컬 `State::from_plain`과
  `editor_core::Editor`를 만든다.
- `OpGraph::new`가 로컬 actor를 만들고 transaction이 local changeset을 생성한다.
- snapshot은 현재 graph에서 직접 구한다.
- `wasm-browser` feature는 optional `editor-server`를 활성화하지 않는다.

실제 Node probe는 계정 token, Typie API, server 없이 로컬 WASM/ICU/font만으로
실행됐다. madi runtime 코드에도 Typie 서비스 endpoint가 없다. 단일 사용자라고 해서
CRDT를 제거한 것이 아니며, `OpGraph`, changeset bundle과 codec은 그대로
유지한다.

Electron production-mode smoke에서도 두 번의 앱 실행 동안 외부 runtime request
0건을 관찰했다. build-time의 `EditorServer.build_font` 호출은 로컬 server WASM
함수 호출이며 실행 중 network service가 아니다.

## madi의 격리 경계

Typie 내부 타입을 나머지 앱에 퍼뜨리지 않는 경계는 다음과 같다.

- 공개 앱 경계:
  `apps/desktop/src/renderer/editor/MadiEditorAdapter.ts`
- Typie-neutral port와 adapter:
  `apps/desktop/src/renderer/editor/typie/TypieEditorAdapter.ts`
- 유일한 실제 binding/DOM host:
  `apps/desktop/src/renderer/editor/typie/createTypieEnginePort.ts`

React workspace/session 코드는 `MadiEditorAdapter`만 참조한다. `EditorHost`,
`Editor`, `Message`, `FlatImeOp`, `PlainDoc`와 generated FFI 타입은
`editor/typie` 아래에만 머문다.

`apps/desktop/src/renderer/workspace/DocumentSessionController.ts`의
`assertSnapshotCompatibility`는 복원 bytes가 Typie WASM에 들어가기 전에 engine
name, 정확한 commit, editor schema version을 검사한다. 불일치하면 snapshot decode를
시도하지 않고 plain-text recovery를 안내한다. 이 guard는 migration을 대신하지
않으며, 고정 contract 이외 snapshot의 안전한 거부 경계다.

## Windows source build 요구사항

이번 환경에서 실제 필요했던 항목은 다음과 같다.

- Node.js 및 pnpm
- Rust stable toolchain
- `wasm32-unknown-unknown` target
- Windows MSVC linker가 있는 Visual Studio/Build Tools 환경
- Typie `editor-bindgen`이 감싼 `wasm-bindgen-cli`
- ICU4X datagen
- Typie server WASM과 `EditorServer.build_font` 기반 글꼴 asset 생성
- zstd 압축 수단
- release 최적화 recipe를 완전히 따르려면 Binaryen `wasm-opt`

GNU Rust host toolchain은 이 환경에서 `dlltool.exe` 부재로 native build dependency
link 단계가 실패했고, MSVC host toolchain으로 성공했다. `wasm-opt` 부재는 최종
크기 최적화 생략 원인이지만 browser WASM의 compile/binding/실행을 막지는 않았다.

## 확인 범위

확인됨:

- 고정 commit source에서 browser WASM build
- generated browser binding으로 `EditorHost`/`Editor` 생성
- 프로그램 방식 한국어 문자열 삽입
- semantic `horizontal_rule` 삽입
- undo/redo
- changeset snapshot 추출과 `create_editor_from_graph` 복원
- annotated recovery text
- CRDT를 유지한 server 없는 단일 사용자 실행
- production `madi://app`에서 local WASM/ICU/font load
- 실제 Electron Canvas 2D CPU pixel present
- semantic scene break를 포함한 244-byte snapshot 저장
- Electron 완전 종료 후 `fnv1a-f091b634` 동일 snapshot 복원
- scene break count 1 및 font missing event 0
- 두 실행의 외부 runtime request 0건
- arbitrary workspace `file://` 읽기 차단

아직 확인하지 않음:

- Windows native 한국어 IME의 전체 수동 checklist
- 실제 Electron 창에서의 장시간 입력/selection/clipboard 안정성
- 다양한 DPI, 대형 문서, 다중 page의 성능과 메모리
- page 0 이외의 surface 표시
- 정확한 history stack 기반 undo/redo 가능 상태 표시
- 구 commit snapshot을 미래 Typie commit에서 여는 migration
- 일반 horizontal rule과 madi scene break의 영구적 구분
- `wasm-opt`을 포함한 upstream release recipe의 완전 재현
- 패키징된 Windows 설치본
