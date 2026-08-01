# Typie 채택 기술검증 결과

> **Phase 0 동결 기록:** 아래 내용은 Phase 0 당시 판정과 증거를 보존한다. 현행 Phase 0.5 판정은 [종료 기준](PHASE_0_5_EXIT_CRITERIA.md)과 [폐쇄 결과](PHASE_0_5_CLOSURE_RESULT.md)를 따른다.

## 최종 판정

**CONDITIONAL GO**

고정된 Typie source에서 browser WASM을 실제로 빌드했고, 서비스 없이 한국어 fixture
삽입, 의미 node, undo/redo, snapshot 추출 및 복원을 실행했다. 별도 프로세스들 사이의
SQLite `.madi` BLOB/recovery round-trip도 통과했다. production-mode Electron
창에서는 local WASM과 정확한 Typie font pipeline을 로드해 Canvas 2D pixel을
표시했고, semantic scene break를 포함한 snapshot을 저장했다. 앱을 완전히 종료하고
새 프로세스에서 같은 snapshot을 복원했으며 외부 runtime request는 0건이었다.
따라서 “Typie Rust 엔진을 Electron renderer의 로컬 편집 코어로 구동하고 `.madi`에
저장할 수 있는가”에는 기술적으로 긍정적인 증거가 있다.

그러나 Windows 한국어 IME의 native composition과 외부 한글/Word clipboard
상호운용은 사람이 아직 확인하지 않았다. renderer는 page 0만 표시하고 undo/redo
가능 상태 표시는 정확한 engine history-stack query가 아니라 최근 command 기반
추정이다. `wasm-opt` 단계, 패키징된 설치본, API/codec upgrade 경로도 남아 있다.
upstream browser package는 `0.0.1`/private API이고 AGPL 배포 방침도 제품 출시 전에
결정해야 한다. 이 상태에서 `GO`라고 판정하지 않는다.

## 검증 기준

- Typie repository: `https://github.com/penxle/typie`
- 확인한 commit:
  `fbe5c4bf860d1717a66e66bea2374a2e39f0dd26`
- commit timestamp: `2026-07-28T18:25:29Z`
- local source: `vendor/typie`
- 실행일: `2026-07-29`
- license: `AGPL-3.0-only`

생성 runtime의 commit과 hashes는
`packages/typie-runtime/BUILD_INFO.json`에 고정했다.

## 실제 사용한 crate 및 소스

직접 WASM에 들어간 주요 crate와 Phase 0에서 사용하는 역할은 다음과 같다.

| crate | 역할 | 대표 source/symbol |
|---|---|---|
| `editor-ffi` | browser WASM/TypeScript 경계 | `crates/editor-ffi/src/host.rs`의 `EditorHost`; `src/editor.rs`의 `Editor`; `src/platform/wasm_browser.rs` |
| `editor-core` | message queue와 편집 orchestration | `crates/editor-core/src/editor.rs`의 `Editor`; `src/message.rs`의 `Message`, `FlatImeOp`, `HistoryOp` |
| `editor-model` | 문서 node, schema, edit payload | `crates/editor-model/src/plain.rs`의 `PlainDoc`; `src/nodes/mod.rs`의 `NodeType`; `src/schema/definitions.rs` |
| `editor-state` | projected state, selection, composition, undo | `crates/editor-state/src/state.rs`의 `State`; `src/selection.rs`; `src/composition.rs`; `src/undo.rs` |
| `editor-transaction` | 원자적 편집 transaction/step | `crates/editor-transaction/src/transaction.rs`의 `Transaction`; `src/step.rs`의 `Step` |
| `editor-crdt` | op graph와 changeset | `crates/editor-crdt/src/op_graph.rs`의 `OpGraph`; `src/changeset.rs`; `src/dot.rs` |
| `editor-codec` | durable changeset bundle | `crates/editor-codec/src/convert.rs`의 `encode_changesets`/`decode_changeset_stream`; `src/bundle.rs` |
| `editor-view` | layout, hit test, caret/selection geometry | `crates/editor-view/src/view.rs`의 `View`; `src/viewport.rs` |
| `editor-renderer` | page display list와 CPU raster | `crates/editor-renderer/src/renderer.rs`의 `Renderer`; `src/backend/mod.rs`의 `RenderBackend` |
| `editor-resource` | ICU, font, theme | `crates/editor-resource/src/segmentation.rs`; `src/resource.rs`; `src/font/*` |
| `editor-clipboard` | text/HTML slice 변환 | `crates/editor-clipboard/src/slice.rs`의 `Slice`; `src/payload.rs` |

세부 경로와 symbol 관계는 `docs/TYPIE_ENGINE_MAP.md`에 기록했다.

## Electron/React 통합 방식

Typie 내부 타입을 앱 전체에서 사용하지 않고 다음 세 단계로 격리했다.

1. `apps/desktop/src/renderer/editor/MadiEditorAdapter.ts`
   - 앱이 의존하는 Typie-neutral interface
   - `open`, `getSnapshot`, `getPlainText`, `focus`, `undo`, `redo`,
     `insertSceneBreak`, `onChanged`
2. `apps/desktop/src/renderer/editor/typie/TypieEditorAdapter.ts`
   - 앱 interface와 browser engine port를 연결
3. `apps/desktop/src/renderer/editor/typie/createTypieEnginePort.ts`
   - generated `@madi/typie-runtime/browser` 타입을 참조하는 실제 구현
   - 로컬 WASM/ICU/font base/manifest/chunk load
   - hidden textarea, Canvas, pointer/keyboard/clipboard wiring
   - `enqueue_request`/`tick_through` 직접 호출

React workspace/session 코드는 1번 interface만 사용한다. 키 입력, composition,
selection, undo/redo, clipboard, transaction, render는 renderer의 WASM 경계 안에서
끝난다. Electron IPC는 snapshot, annotated recovery text와 metadata를 명시적으로
저장하거나 문서를 여는 때만 사용한다.

production renderer는 `file://`가 아니라 secure custom origin
`madi://app/index.html`에서 실행한다.

- `apps/desktop/src/main/index.ts`: app ready 전 scheme privilege 등록
- `apps/desktop/src/main/appProtocol.ts`: renderer build root의 허용 asset만 제공
- `apps/desktop/src/main/window.ts`: production에서 `madi://app` 이외 외부 request
  차단

protocol handler는 `GET`/`HEAD`, host `app`, 허용된 HTML/CSS/JS/map/WASM/zst
확장자와 renderer root 내부 path만 받는다. traversal, NUL, 다른 host, 임의 확장자와
workspace의 arbitrary `file://` 읽기는 차단한다.

upstream Svelte UI는 복사하지 않았다. 다만 native IME event를 `FlatImeOp`으로
정규화하는 plain TypeScript 로직은 다음 upstream 파일을 출처로 adaptation했다.

- `vendor/typie/apps/website/src/lib/editor-ffi/input/ime-context.ts`
- `vendor/typie/apps/website/src/lib/editor-ffi/input/ime-normalizer.ts`
- `vendor/typie/apps/website/src/lib/editor-ffi/input/ime-input-adapter.ts`

madi의 대응 파일에는 원본 경로, 고정 commit, `SPDX-License-Identifier:
AGPL-3.0-only`를 명시했다.

## WASM 빌드 방식과 결과

확인한 upstream recipe는
`vendor/typie/crates/editor-ffi/justfile`의 `wasm-browser` target이다. 실제 핵심
build는 다음 설정으로 수행했다.

```text
cargo build
  --manifest-path vendor/typie/crates/editor-ffi/Cargo.toml
  --profile release-wasm-browser
  --features wasm-browser
  --target wasm32-unknown-unknown
```

그 뒤 Typie의 `editor-bindgen`을 사용해:

1. `wasm-bindgen-cli --target module`
2. `editor-bindgen-js`
3. compiled WASM marker 기반 ICU4X datagen
4. source-built Typie server WASM의 `EditorServer.get_font_codepoints`
5. `EditorServer.build_font` 기반 font base/manifest/chunk 생성

을 수행했다. 생성 browser WASM은 `9,381,730` bytes이고 실제 probe가 이 산출물을
로드했다.

`scripts/build-typie-font.mjs`가 생성한 Nanum Gothic asset은 다음과 같다.

| asset | bytes | SHA-256 |
|---|---:|---|
| base | 89,616 | `54418892219582d1d1334f79ad5fc7fdc74d646464beb0d9bcb600ebacb08517` |
| manifest | 966 | `81424decc8cebe05ac5c4597248648d0f5416742acfcc25c22990e75537e3ca5` |
| full-glyph chunk 0 | 884,964 | `489e66dc686591b671f3b14c00cde16922b62b63e06f0563ca5695c6c5101502` |

Typie engine font hash는 `a178cbd6767300e8`이다. chunk 0에 source font 전체
codepoint를 넣어 Typie의 resource protocol을 유지하면서 runtime font server는
없앴다.

이 환경에는 `wasm-opt`이 없어 upstream release recipe의
`wasm-opt -Os --all-features` 최종 단계만 생략했다. 이는 현재 기능 검증의 runtime
차단 원인은 아니지만 배포 크기/성능 recipe를 완전히 재현한 결과는 아니다.

## Typie 서비스 없이 실행 가능한지

**확인됨.**

`scripts/probe-typie.mjs`는 다음 로컬 파일만 읽어 별도 Typie API, 계정, server 없이
실행됐다.

- `packages/typie-runtime/browser/editor_ffi_bg.wasm`
- `packages/typie-runtime/browser/icu.zst`
- `packages/typie-runtime/assets/NanumGothic-Regular.base.zst`
- `packages/typie-runtime/assets/NanumGothic-Regular.manifest.zst`
- `packages/typie-runtime/assets/NanumGothic-Regular.chunk-0.zst`

`editor-ffi`의 `wasm-browser` feature는 optional `editor-server` feature를
활성화하지 않는다. CRDT의 `OpGraph`는 제거하지 않았지만 local actor와 local
changeset으로 단일 사용자 편집이 가능했다.

`EditorServer.build_font`는 build-time에 로컬 server WASM 안에서 실행한 함수다.
배포된 renderer는 server WASM이나 network font service를 사용하지 않는다.

## snapshot 직렬화 및 복원

사용한 snapshot 추출 API는 실제 generated binding의 다음 method다.

```ts
const result = editor.missing_changesets_tolerant(new Uint8Array());
if (result.withheld !== 0) throw new Error("incomplete snapshot");
const snapshot = result.bytes;
```

빈 `Uint8Array`는 “remote가 가진 head 없음”을 뜻한다.
`vendor/typie/crates/editor-codec/src/bundle.rs`의 `decode_dots`가 빈 bytes를 빈
`Vec<Dot>`으로 처리한다. 결과 bytes는
`editor-codec::encode_changesets`가 만든 전체 changeset bundle이다.

복원 API는:

```ts
host.create_editor_from_graph(snapshot, viewport)
```

이며 실제 구현 경로는
`vendor/typie/crates/editor-ffi/src/host.rs` →
`vendor/typie/crates/editor-ffi/src/graph.rs::state_from_changesets` →
`editor_codec::decode_changeset_stream`이다.

`scripts/probe-typie.mjs` 실행 결과:

```json
{
  "commit": "fbe5c4bf860d1717a66e66bea2374a2e39f0dd26",
  "snapshotBytes": 373,
  "snapshotSha256": "4f16e2407800a7fc598010a0dced1b656556bbfbfb8d6c45a5b19506ef97ffb4",
  "plainTextLength": 16,
  "annotatedSceneBreak": true,
  "undoRedo": true,
  "restored": true
}
```

복원 뒤 annotated prose가 snapshot 전과 같음을 비교했다.

별도의 실제 Electron smoke에서는 다음 값을 확인했다.

```json
{
  "snapshotBytes": 244,
  "snapshotFingerprint": "fnv1a-f091b634",
  "processRestartRestore": true
}
```

첫 Electron 프로세스를 완전히 종료한 뒤 새 프로세스로
`드래곤을죽이다.madi`를 열었을 때 snapshot bytes와 fingerprint가 같았다.
FNV-1a는 UI 진단용 비암호학적 fingerprint다. CLI persistence test는 별도로
SHA-256을 비교한다.

snapshot은 문서 CRDT graph다. 현재 selection, viewport, composition과 재시작 전
undo stack은 포함하지 않는다. 이 transient 상태까지 복원됐다고 주장하지 않는다.

복원 전에
`apps/desktop/src/renderer/workspace/DocumentSessionController.ts`의
`assertSnapshotCompatibility`가 `editor_engine === "typie"`, 정확한 고정 commit,
`editor_schema_version === 1`을 검사한다. 다른 engine, commit 또는 schema인
snapshot은 WASM decoder에 전달하지 않고 오류와 plain-text recovery 안내를
표시한다. 세 불일치 경우가 자동 test에 포함된다. 이는 안전한 거부 경계이지 서로
다른 commit/schema를 migration하는 기능은 아니다.

## 장면 구분선 결과

**Phase 0 목표 범위에서 확인됨.**

새 schema를 fork하지 않고 Typie의 기존 독립 node를 사용했다.

- `vendor/typie/crates/editor-model/src/nodes/horizontal_rule.rs`
  - `HorizontalRuleNode`
  - `HorizontalRuleVariant::ThreeDiamonds`
- `vendor/typie/crates/editor-model/src/schema/definitions.rs`
  - Root content에서 `HorizontalRule` 허용
- `vendor/typie/crates/editor-codec/src/types/item.rs`
  - `DurableNodeType::HorizontalRule`
- `vendor/typie/crates/editor-codec/src/types/values.rs`
  - durable `ThreeDiamonds` variant

삽입 message:

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

probe에서 node 삽입, undo/redo, changeset snapshot 복원과
`prose_text_annotated()`의 `\n\n***\n\n` recovery marker를 확인했다.
Electron smoke도 `semanticSceneBreaks = 1`을 확인하고 이 node가 포함된 snapshot을
저장·재실행 복원했다.

한계: 현재는 `three_diamonds` horizontal rule을 madi scene break로 해석하는
adapter 규칙이다. 일반 가로선과 scene break를 함께 지원할 때 둘을 구분하는 madi
전용 영구 tag는 없다. custom node를 만들면 model/schema/codec/view/renderer/FFI
전부에 변경이 필요해 upstream merge 부담이 커진다.

## `.madi` 저장/복원 결과

`scripts/test-madi-roundtrip.mjs`는 실제 Typie WASM으로 한국어 두 장면과 semantic
divider fixture를 만든 뒤, 별도 `madi-core` 프로세스를 각각 실행했다.

1. `create-project`
2. `save-document`
3. 첫 프로세스 종료
4. 새 프로세스에서 `load-document`
5. 새 프로세스에서 `recover-plain-text`
6. 새 프로세스에서 `inspect-project`

실행 결과:

```json
{
  "fileName": "드래곤을죽이다.madi",
  "sqlite": true,
  "applicationId": 1296122953,
  "snapshotBytes": 479,
  "snapshotSha256": "060929381e524e083d49f541075a26065a9aeb51d477158a57420b4314a43790",
  "plainTextBytes": 85,
  "sceneBreakRecovered": true,
  "processRestartRoundTrip": true
}
```

이 SHA-256은 최신 `pnpm test`에서 생성된 해당 fixture run의 snapshot 값이다.
통합 test의 합격 조건은 특정 상수 hash가 아니라 저장 전후 bytes의 SHA-256 동일성이다.

확인 항목:

- 파일 header가 `SQLite format 3\0`
- `PRAGMA application_id = 0x4D414449`
- `quick_check = ok`
- 저장 전후 snapshot SHA-256 동일
- 저장 전후 annotated recovery text 동일
- UI 없이 `recover-plain-text` 동작

CLI test와 별도로 `scripts/electron-smoke.mjs`가 실제 Electron 창에서 다음 흐름을
수행해 통과했다.

1. production `madi://app` renderer와 sidecar 실행
2. `드래곤을죽이다.madi` 새 프로젝트 생성
3. 첫 장면 입력, semantic scene break, 둘째 장면 입력
4. 244-byte snapshot 저장
5. Canvas CPU backend, 유효 frame, non-transparent pixel 확인
6. 첫 Electron 프로세스 완전 종료
7. 새 Electron 프로세스 실행 및 `.madi` 열기
8. `fnv1a-f091b634`와 snapshot 크기 동일 확인
9. 복원된 Canvas CPU pixel 확인

두 실행 모두 Typie font missing event는 `0`, 외부 runtime request는 `0`이었다.
workspace의 임의 `file://.../package.json` fetch도 읽기에 실패했다.

이 smoke는 실제 Electron/SQLite/Typie/Canvas 경계를 사용하지만 입력은 Playwright의
DOM `fill`/`pressSequentially`다. Windows native 한국어 IME가 아니다.

## 자동 테스트 결과

### 실행해 통과한 것

| 범위 | 명령/대상 | 결과 |
|---|---|---|
| Typie source-built runtime probe | `node scripts/probe-typie.mjs` | PASS |
| Rust core | `madi-core` unit/integration test 9개 | PASS, 9/9 |
| TypeScript/React | desktop Vitest 5 files | PASS, 23/23; protocol security 6개와 snapshot compatibility 3개 포함 |
| process-restart `.madi` 통합 | `node scripts/test-madi-roundtrip.mjs` | PASS |
| production-mode Electron | `node scripts/electron-smoke.mjs` | PASS |

Typie probe가 자동으로 확인한 것은 프로그램 방식 한국어 문자열 삽입,
`horizontal_rule`, undo/redo, snapshot 추출, `create_editor_from_graph` 복원이다.
native Windows IME를 생성한 test가 아니다.

최종 `pnpm test`가 위 Rust, Vitest, Node integration과 Electron smoke를 순서대로
실행해 모두 통과했다.

## 수동 테스트가 필요한 항목

다음은 모두 **NOT TESTED**다. 상세 절차는
`docs/MANUAL_KOREAN_IME_CHECKLIST.md`를 따른다.

- 한글 문장 연속 입력
- 초성/중성/종성 조합
- 겹받침과 복합모음
- 조합 직후 Enter
- 조합 직후 Undo, 이어서 Redo
- 조합 직후 cursor 이동
- 선택 후 삭제
- 한국어 문장 copy/paste
- 한글 또는 Word 계열 프로그램에서 paste
- 실제 앱 종료 후 `.madi` 복원의 사람 수동 확인
  - 자동 Electron process-restart smoke는 PASS
  - 사람의 시각적/IME 수동 항목은 `NOT TESTED`
- 장면 구분선 앞뒤 입력
- 빠른 입력의 중복/누락

추가로 여러 DPI, 다중 monitor, 큰 문서, 여러 page, 장시간 편집의 performance와
memory도 측정하지 않았다.

## 실행 중 네트워크 의존성

기술 구조상 Typie 또는 madi server는 필요 없다.

- 실제 runtime asset은 `packages/typie-runtime`의 로컬 file이다.
- renderer Typie 경로에 service endpoint, token, account client가 없다.
- Rust `madi-core`에는 networking/telemetry dependency가 없다.
- `apps/desktop/src/main/window.ts`의 `installRuntimeNetworkGuard`는 production에서
  `madi://app`, `data:`, `blob:`, `devtools:`만 허용하고, development에서는 설정된
  loopback Vite origin만 허용한다.

production-mode Electron smoke의 두 실행에서 page request를 수집한 결과 외부 runtime
request는 `0`건이었다. 같은 renderer에서 arbitrary workspace `file://` fetch는
차단됐다. 이는 Electron page와 main network guard 범위의 자동 검증 결과이며 OS
전체 packet capture라고 확대 해석하지 않는다.

## 빌드 난도

평가: **중간 이상**.

긍정적 요인:

- upstream에 `wasm-browser` feature와 build recipe가 실제로 있다.
- generated `.d.ts`가 있어 TypeScript message shape를 확인할 수 있다.
- 고정 commit source에서 Windows 환경의 browser WASM build가 실제 성공했다.

비용/위험:

- Rust stable, `wasm32-unknown-unknown`, MSVC native linker가 필요했다.
- GNU host toolchain은 이 환경에서 `dlltool.exe` 부재로 실패했다.
- Typie 자체 `editor-bindgen`, `wasm-bindgen-cli`, ICU4X datagen과 zstd 단계가
  필요하다.
- exact font path를 위해 source-built Typie server WASM과
  `EditorServer.build_font` 단계도 필요하다.
- upstream release recipe 완전 재현에는 별도 `wasm-opt`이 필요하다.
- 최종 `wasm-opt`을 거치지 않은 WASM만 약 9.38 MB이고 ICU/font asset도 별도다.
- Windows clean machine용으로 tool bootstrap과 artifact hash 검증을 자동화해야 한다.

## Typie 내부 결합도

평가를 두 부분으로 나누면 다음과 같다.

- **Rust 엔진 ↔ Svelte: 낮음.** `editor-model`부터 `editor-ffi`까지 Svelte를
  의존하지 않고 React에서 generated binding을 직접 사용할 수 있었다.
- **완성 browser host ↔ Typie website: 중간~높음.**
  `apps/website/src/lib/editor-ffi/editor.svelte.ts`,
  `components/Input.svelte`, 여러 handler가 lifecycle, scroll, IME, clipboard,
  render를 담당한다.

madi는 upstream 제품 wrapper를 가져오지 않고 필요한 subset을 약 1개의 engine
port와 3개의 IME adapter 파일로 재구현했다. 이로써 제품 UI 결합은 피했지만
upstream DOM/IME bug fix를 자동으로 얻지는 못한다.

## API 안정성

평가: **낮음**.

근거:

- `vendor/typie/crates/editor-ffi/package.json`은 version `0.0.1`이고
  `private: true`다.
- generated binding은 method/message shape를 제공하지만 public semver 호환 계약으로
  배포된 package가 아니다.
- `editor-codec`은 durable wire format의 evolution 규칙과 unknown carrier를
  구현하고 있어 내부 설계는 신중하지만, madi가 서로 다른 Typie commit 사이의
  snapshot migration을 실행해 본 것은 아니다.
- browser host 일부는 upstream website의 내부 TypeScript 코드다.

따라서 commit pin은 필수이고, upgrade는 일반 dependency bump가 아니라
API/codec/IME/render compatibility 작업으로 취급해야 한다.

## 예상 유지보수 부담

최소한 다음 작업이 지속적으로 필요하다.

1. Typie commit별 source/WASM/ICU/font hash 고정
2. generated `.d.ts` diff와 `MadiEditorAdapter` contract test
3. 과거 `.madi` snapshot corpus를 새 commit에서 여는 compatibility test
4. Windows 한국어 IME regression checklist
5. upstream IME adapter 변경의 수동 port/review
6. Canvas/DPI/large-document performance regression
7. scene break mapping invariant 유지
8. AGPL source 제공/notice 절차 또는 별도 license 관리
9. reproducible build toolchain과 `wasm-opt` 포함 artifact pipeline

특히 새 madi 전용 node를 Typie schema에 직접 추가하면 3, 5, 7의 비용이 크게
증가한다. Phase 0처럼 기존 semantic `horizontal_rule`을 제한적으로 mapping하는
편이 유지보수 면에서 유리하다.

## AGPL 영향

기술적 실행 가능성과 배포 가능성은 별개다.

- 현재 runtime에는 Typie에서 빌드한 WASM과 generated binding이 포함된다.
- madi의 IME adapter에는 upstream Typie TypeScript에서 adaptation한 코드가 있다.
- 따라서 현재 시제품 구조는 Typie 코드와 분리된 독립 구현이라고 볼 수 없다.
- network service를 사용하지 않는 desktop 앱이라고 해서 AGPL 의무가 사라진다고
  전제하면 안 된다.

AGPL로 madi를 배포할지, 원저작자에게 별도 license를 받을지, Typie는 연구에만 쓰고
독립 구현으로 교체할지는 제품 배포 전에 결정해야 한다. 상세 시나리오와 비법률적
위험 정리는 `docs/TYPIE_LICENSE_IMPACT.md`를 따른다.

## 미확인 사항

- 실제 Windows native 한국어 IME 전체 checklist
- 실제 Electron clipboard와 한글/Word 계열 앱 간 HTML/plain text 상호운용
- packaged Windows binary와 installer
- `wasm-opt` 포함 release artifact
- 긴 장편, 다중 page, 높은 DPI에서 성능/메모리
- page 0 이외의 Canvas surface 표시
- 엔진 history stack에 근거한 정확한 undo/redo 가능 상태
- crash 중 저장/backup 복구의 실제 fault injection
- Typie commit upgrade와 과거 snapshot migration
- generic horizontal rule과 madi scene break의 영구 구분
- 접근성, screen reader, native candidate window 위치의 실제 동작

## `GO`로 올리기 위한 최소 조건

1. 한국어 IME와 외부 한글/Word clipboard checklist를 사람이 수행하고 각
   환경/결과를 기록한다.
2. page 0 이외의 문서 표시와 긴 장편/DPI 성능을 검증한다.
3. undo/redo 가능 표시를 engine의 신뢰 가능한 history 상태에 연결하거나, 추정임을
   UI contract로 명확히 제한한다.
4. `wasm-opt`을 포함한 고정/reproducible runtime build를 CI 또는 release script로
   만든다.
5. Windows 패키지/설치본을 만들고 설치 상태에서 같은 smoke를 반복한다.
6. 과거 snapshot fixture를 포함한 commit upgrade gate를 정의한다.
7. AGPL 배포, 별도 commercial license, 또는 독립 구현 중 하나를 제품 정책으로
   결정하고 법률 전문가의 검토를 받는다.

이 조건을 충족하기 전 최종 판정은 **CONDITIONAL GO**다.
