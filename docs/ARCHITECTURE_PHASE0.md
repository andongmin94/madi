# madi Phase 0 아키텍처

> **Phase 0 동결 기록:** 아래 내용은 Phase 0 당시 상태를 보존한다. 현행 Phase 0.5 상태는 [종료 기준](PHASE_0_5_EXIT_CRITERIA.md)과 [폐쇄 결과](PHASE_0_5_CLOSURE_RESULT.md)를 따른다.

## 구성

```text
┌──────────────── Electron renderer (sandboxed) ────────────────┐
│ React UI                                                     │
│   └─ MadiEditorAdapter                                       │
│       └─ TypieEnginePort                                     │
│           ├─ Typie browser WASM                              │
│           ├─ hidden textarea / IME event adapter             │
│           ├─ base / manifest / local full-glyph font chunk    │
│           └─ page 0 HTMLCanvasElement 2D renderer             │
│                                                              │
│ snapshot + recovery text ──debounced/explicit save only──┐   │
└───────────────────────────────────────────────────────────┼───┘
                                                            │
                         typed preload API                  │
                                                            ▼
┌──────────────── Electron main ────────────────────────────────┐
│ secure madi://app static-asset protocol                       │
│ IPC sender validation                                        │
│ project-session capability registry                          │
│ file dialogs                                                  │
│ fixed-command JSON-RPC client                                 │
└───────────────────────────────┬───────────────────────────────┘
                                │ stdin/stdout JSON lines
                                ▼
┌──────────────── Rust madi-core sidecar ───────────────────────┐
│ create/open/save/load/inspect/recover                         │
│ SQLite transaction, revision check, consistent backup         │
└───────────────────────────────┬───────────────────────────────┘
                                ▼
                    드래곤을죽이다.madi
                       (SQLite file)
```

## 프로세스 경계

### Renderer

고빈도 편집 경로는 renderer 밖으로 나가지 않는다.

- native input과 한국어 조합 event
- cursor 및 selection
- Undo/Redo
- copy/cut/paste
- Typie document transaction
- page layout 및 Canvas rendering

`MadiEditorAdapter` 밖의 React 코드에는 Typie의 `Editor`, `Message`, `PlainDoc`,
CRDT 또는 codec 타입을 노출하지 않는다.

### Preload

`contextBridge`는 아래의 구체적 함수만 노출한다.

- `createProject`
- `openProject`
- `saveDocument`
- `loadDocument`
- `recoverPlainText`
- `getAppVersion`

generic `invoke`, `ipcRenderer`, filesystem path API, `fs`, `child_process`, shell 실행은
노출하지 않는다.

### Main

main process는 다음 책임만 가진다.

- native file dialog
- renderer frame와 URL을 포함한 IPC caller 검증
- renderer에 노출되지 않는 실제 파일 경로와 session capability 관리
- 허용된 여섯 sidecar method로의 변환
- sidecar lifecycle 및 응답 크기/timeout 제한
- production renderer와 WASM/ICU/font를 위한 `madi://app` asset protocol
- 실행 중 외부 network request 차단

Renderer는 임의 경로나 임의 sidecar method를 전달할 수 없다.

### Rust sidecar

`madi-core serve`는 한 줄에 하나의 JSON-RPC 2.0 request/response를 사용한다.
snapshot은 이 경계에서만 standard base64로 변환된다. 오류에는 원고나 snapshot
값을 포함하지 않는다.

허용 method:

- `create_project`
- `open_project`
- `save_document`
- `load_document`
- `inspect_project`
- `recover_plain_text`

## Typie runtime 초기화

1. `madi://app`에서 로컬 `editor_ffi_bg.wasm`, `icu.zst`, font
   base/manifest/chunk를 읽는다.
2. `createInstance(WebAssembly.Module)`을 호출한다.
3. `EditorHost.create(icuData)`로 host를 만든다.
4. 고정된 engine font hash로 family를 등록한다.
5. `EditorHost.add_font_base`, `add_font_manifest`, `add_font_chunk`로 Typie의
   실제 font resource protocol을 완성한다. Phase 0 chunk 0은 Nanum Gothic의 전체
   glyph를 담은 로컬 chunk라 font server가 필요 없다.
6. 새 문서는 `EditorHost.create_editor_from_doc`, 복원 문서는
   `EditorHost.create_editor_from_graph`로 연다.
7. `system.initialize` transaction을 적용하고 Canvas surface를 붙인다.

입력 message는 `enqueue_request`와 `tick_through`로 renderer 내부에서 즉시 적용한다.
render invalidation 뒤 `render_surface(0, revision)`을 호출한다. 현재 시제품이
surface를 연결하고 표시하는 범위는 page 0뿐이다.

font asset은 원본 TTF를 임의 압축한 것이 아니다.
`scripts/build-typie-font.mjs`가 source-built Typie server WASM의
`EditorServer.get_font_codepoints`와 `EditorServer.build_font`를 사용해
base/manifest/chunk를 생성한다. build-time server FFI는 runtime service가 아니다.

## Snapshot 계약

Phase 0 snapshot은 Typie CRDT changeset bundle 전체다.

```ts
editor.missing_changesets_tolerant(new Uint8Array()).bytes
```

빈 heads payload는 `editor-codec::decode_dots`에서 빈 head set으로 해석된다. 복원은:

```ts
host.create_editor_from_graph(snapshot, viewport)
```

plain-text recovery에는 `prose_text_annotated()`를 사용해 장면 구분선의 `***` 표기를
보존한다. 정본은 snapshot이고 recovery text는 비상 복구용이다.

snapshot을 WASM에 전달하기 전에 engine name, 정확한 Typie commit,
`editor_schema_version`을 현재 runtime contract와 비교한다. 다른 engine, commit,
schema의 snapshot은 decode하지 않고 오류와 plain-text recovery 경로를 제공한다.
이 방어는 migration 기능이 아니다.

production Electron smoke에서 저장 직전 snapshot은 `244 bytes`, UI 진단용
FNV-1a fingerprint는 `fnv1a-f091b634`였다. 앱 프로세스를 완전히 닫고 새 Electron
프로세스에서 같은 `.madi`를 열었을 때 snapshot 크기와 fingerprint가 같았다.
FNV-1a 값은 사용자 확인용 비암호학적 fingerprint이며 저장 무결성의 유일한 근거로
사용하지 않는다.

## 장면 구분선

Typie에는 이미 `horizontal_rule` leaf node와 `HorizontalRuleVariant`가 있다. Phase 0의
`scene break`는 adapter 경계에서 다음 native 의미 노드로 mapping한다.

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

이 방식은 schema fork 없이 독립 CRDT node, selection/delete semantics, codec
round-trip을 얻는다. 단, 범용 horizontal rule과 scene break를 영구적으로 구분하는
별도 madi tag는 Phase 0에 없다. 향후 둘을 함께 지원하면 Typie schema/codec 확장 또는
madi metadata overlay가 필요하다.

## Electron 보안 기본값

```ts
{
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false
}
```

새 window와 외부 navigation을 거부하고 permission request/check도 거부한다.

### Production asset protocol

production entry는 `file://`가 아니라 `madi://app/index.html`이다.

- `apps/desktop/src/main/index.ts`가 app ready 전에 `madi` scheme을
  `standard`, `secure`, Fetch API 지원 scheme으로 등록한다.
- `apps/desktop/src/main/appProtocol.ts`는 renderer output directory만 root로 삼는다.
- host는 `app`, method는 `GET`/`HEAD`, 확장자는 HTML/CSS/JS/map/WASM/zst만
  허용한다.
- URL decode 오류, NUL, traversal, 다른 host, root 자체와 허용하지 않은 확장자는
  거부한다.
- `apps/desktop/src/main/window.ts`의 production network guard는
  `madi://app`, `data:`, `blob:`, `devtools:` 외 요청을 차단한다.

실제 production-mode Electron smoke 두 번에서 관찰된 외부 runtime request는
`0`건이었다. renderer에서 workspace의 임의 `file://.../package.json`을 fetch하는
probe도 읽기에 실패해 arbitrary local-file read가 차단됨을 확인했다.

이 검증은 빌드된 renderer를 un-packaged Electron에서 실행한 결과다. Windows 설치
패키지 자체는 아직 만들지 않았다.

## 현재 renderer 한계

- Canvas surface는 page 0만 연결한다.
- undo/redo 명령은 실제 Typie history message지만, 버튼의 `canUndo`/`canRedo`
  표시는 엔진 history-stack query가 없어 최근 command를 바탕으로 추정한다.
- 자동 smoke의 `fill`/`pressSequentially`는 DOM 입력 검증이지 Windows native
  한국어 IME 조합 검증이 아니다. 수동 IME checklist는 계속 `NOT TESTED`다.

## 실패 및 복구

- save 전 `VACUUM INTO`로 일관된 `.bak`을 만든다.
- backup은 현재/이전 두 세대를 회전한다.
- `BEGIN IMMEDIATE` transaction에서 `expected_revision`을 다시 확인한다.
- snapshot BLOB, recovery text, document metadata, project revision은 한 transaction에서
  갱신한다.
- stale revision은 덮어쓰지 않고 충돌 오류를 반환한다.
- CLI `recover-plain-text`는 Electron 없이 동작한다.
