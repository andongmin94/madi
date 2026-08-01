# madi

`madi`는 한국어 장편소설 작가를 위한 local-first Windows desktop 저작도구다.
현재 작업트리는 첫 제품 수직 기능인 Phase 1A를 구현한다.

```text
Phase 0.5 baseline: CONDITIONAL TECHNICAL GO
Private local Phase 1A development: AUTHORIZED
Phase 1A implementation: COMPLETE
Phase 1A final verification/package verdict: PASS
Phase 1A technical verdict: TECHNICAL GO — PRIVATE LOCAL
Windows native Korean IME: MANUAL VALIDATION PENDING
License: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Public/paid/installer distribution: NOT AUTHORIZED
```

최종 `pnpm verify`, 독립 `pnpm package:unpacked` 및 실제 Electron의
2권·3화·5장면 종료/재열기 시나리오가 모두 통과했다. 현재 저장소 결과와 남은
배포·hardening 경계는 [`docs/PHASE_1A_RESULT.md`](docs/PHASE_1A_RESULT.md)를
따른다.

## Phase 1A에서 할 수 있는 일

- 하나의 `.madi` SQLite 파일에 작품 구조와 장면별 Typie 문서를 함께 저장
- `WORK → VOLUME → CHAPTER → SCENE` Binder
- WORK 바로 아래 CHAPTER도 허용
- 권·화·장면 추가, 모든 node 이름 변경, 확인 후 subtree 삭제
- 같은 부모 안에서 위·아래 순서 변경
- SCENE을 선택했을 때만 Typie editor 활성화
- 장면별 한국어 본문, Undo/Redo 및 `madi.scene-break.v1`
- 약 550ms debounce 자동저장, `Ctrl+S`, 장면 전환 전 저장, 종료 전 저장
- 마지막 선택 node, Binder 펼침 상태 및 폭을 `.madi`에 저장·복원
- 앱 종료 후 같은 `.madi`를 열어 구조와 각 장면 document 복원
- Electron 없이 UTF-8 plain-text recovery를 꺼내는 Rust CLI

등장인물, 세계관, 관계 그래프, plot Canvas, Reader Lab, EPUB, HWP/HWPX,
LLM, cloud/sync, collaboration, mobile/web, 전체 원고 연속 보기, 프로젝트 전체
검색·치환 및 이름 있는 snapshot은 Phase 1A 범위가 아니다.

## 실제 사용 흐름

### 1. 앱 실행

```powershell
pnpm dev
```

Typie WASM이 준비되면 상단에서 `새 프로젝트` 또는 `.madi 열기`를 사용할 수 있다.

### 2. 새 작품 만들기

1. `새 프로젝트`를 누른다.
2. 저장 대화상자의 기본 이름 `드래곤을죽이다.madi`를 확인하고 저장한다.
3. 새 파일에는 WORK, 기본 CHAPTER, 기본 SCENE과 연결 document가 함께 생긴다.
4. 필요하면 Binder의 WORK에서 `이름 변경`을 눌러 작품명을 정한다.

기존 경로를 덮어쓰지 않는다. 새 project의 첫 SCENE은 Typie가 최초 graph를 만들기
전까지 0-byte placeholder이며, editor가 연 뒤 dirty 상태가 되어 첫 자동저장에서
실제 snapshot으로 교체된다.

### 3. Binder 구성

- WORK의 `권 추가`를 두 번 눌러 권 2개를 만든다.
- 각 VOLUME의 `화 추가` 또는 WORK의 `화 추가`로 CHAPTER를 만든다.
- CHAPTER의 `장면 추가`로 SCENE을 만든다.
- 빈 입력 이름은 UI에서 `새 작품`, `새 권`, `새 화`, `새 장면` 기본값으로
  정규화한다.
- `위로`와 `아래로`는 같은 parent의 sibling 순서만 바꾼다.
- parent 이동은 Rust/core API에 있지만 현재 Binder에는 drag-and-drop이나 parent
  이동 UI가 없다.
- 삭제는 확인 dialog 뒤 명시적인 recursive delete로 실행된다. WORK는 삭제할 수
  없다.

### 4. 장면 편집과 저장

1. SCENE을 선택한다. WORK/VOLUME/CHAPTER를 선택하면 editor 대신 안내가 나온다.
2. 장면별 한국어 본문을 입력한다.
3. 필요하면 상단 `장면 구분선`으로 `madi.scene-break.v1`을 넣는다.
4. 저장 badge에서 `dirty → saving → saved` 상태를 확인한다.
5. 즉시 저장하려면 `Ctrl+S` 또는 상단 `저장`을 누른다.

SCENE A에서 B로 이동할 때 A의 snapshot과 plain-text recovery 저장이 성공한 뒤 B를
load한다. 한글 IME composition 중에는 저장·전환·종료를 거부하고 현재 장면을
유지한다. A 저장이 실패해도 A editor를 버리거나 B를 먼저 열지 않는다. 빠른
A → B → C 요청은 queue와 request/session token으로 오래된 장면 load가 화면에
적용되지 않게 한다. save 응답도 scene/document/generation/saveSequence가 원래
요청과 모두 일치할 때만 현재 저장 상태에 적용한다.

저장 중 추가 편집은 새 generation으로 dirty 상태에 남아 다음 자동저장을 예약한다.
저장 오류 뒤에는 현재 editor를 유지한 채 `저장` 또는 `Ctrl+S`로 재시도할 수 있다.
dirty event가 있었더라도 snapshot bytes와 plain-text recovery의 signature가 마지막
성공 값과 같으면 DB write를 반복하지 않고 saved로 돌아간다.

### 5. 종료와 재열기

1. 현재 IME 조합을 끝낸다.
2. 창을 닫는다.
3. renderer는 dirty 장면과 `workspace.v1` UI state 저장을 먼저 요청한다.
4. main process는 renderer가 저장 성공을 승인하기 전 창을 파괴하지 않는다.
5. Electron process가 완전히 끝난 뒤 앱을 다시 실행한다.
6. `.madi 열기`로 같은 파일을 선택한다.

open 시 tree와 UI state를 읽는다. 저장된 selected ID가 없으면 최초 유효 SCENE,
SCENE이 없으면 WORK로 fallback해 Binder-only mode로 연다. 손상된 `workspace.v1`은
tree 복원을 막지 않고 기본 선택·펼침·폭으로 격리한다. Binder 폭은 220..640
범위로 복원한다.

## `.madi` v1 요약

- `PRAGMA application_id = 0x4D414449`
- `app_meta.format_version = 1`
- `app_meta.schema_version = 2`
- `PRAGMA user_version = 2`
- 기존 table: `app_meta`, `documents`, `schema_migrations`
- Phase 1A table: `projects`, `tree_nodes`, `ui_state`

정규 hierarchy:

```text
WORK
├─ VOLUME
│  └─ CHAPTER
│     └─ SCENE → documents.id
└─ CHAPTER
   └─ SCENE → documents.id
```

project마다 WORK는 정확히 하나다. SCENE만 `document_id`를 가지며, SCENE 생성·
이름 변경·저장·삭제는 연결 document와 같은 transaction에서 처리한다. 구조와
장면 저장은 project-wide optimistic `revision`을 사용하고 pre-save backup을
회전한다. UI state 저장은 manuscript revision을 올리지 않는다.

sibling 순서는 `REAL order_key`를 `1024.0` 간격으로 배정한다. 중간 삽입은
midpoint를 사용하고 간격이 `0.000001` 이하이면 해당 sibling만 rebalance한다.
읽기 tie-break는 `(order_key, id)`다.

UI state는 `ui_state.key = 'workspace.v1'`에 다음 snake_case JSON을 저장한다.

```json
{
  "selected_node_id": null,
  "expanded_node_ids": [],
  "binder_width": 300
}
```

전체 계약과 migration 규칙은
[`docs/MADI_FILE_FORMAT_V1_DRAFT.md`](docs/MADI_FILE_FORMAT_V1_DRAFT.md)를 따른다.

## 기술 구조와 보안 경계

- Electron main / sandboxed preload / React renderer
- TypeScript strict mode
- Rust `madi-core` persistent JSON-RPC sidecar
- SQLite `.madi`
- Typie browser WASM, ICU 및 한국어 font를 local asset으로 사용
- `MadiEditorAdapter` / `TypieEditorAdapter` 경계
- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- production external network 차단과 local `madi://app` protocol

일반 madi code와 Rust core는 Typie 내부 type을 직접 import하지 않는다. renderer에는
generic IPC, filesystem path, process, shell 또는 임의 RPC method를 노출하지 않는다.
main이 dialog path를 session capability에 연결하고, preload는 다음 고정 API만
노출한다.

```text
createProject, openProject, saveDocument, loadDocument, recoverPlainText,
getProjectTree, createNode, renameNode, moveNode, reorderNode, deleteNode,
loadSceneDocument, saveSceneDocument, saveUiState, loadUiState,
getAppVersion, onCloseRequested, completeCloseRequest
```

core/main/preload 오류에는 snapshot과 원고 본문을 출력하지 않는다.

## 고정된 Typie 기준

- Repository: `https://github.com/penxle/typie`
- Commit: `fbe5c4bf860d1717a66e66bea2374a2e39f0dd26`
- Local source: `vendor/typie`
- Runtime metadata: `packages/typie-runtime/BUILD_INFO.json`
- Runtime package license 표기: `AGPL-3.0-only`

현재 baseline commit에는 `vendor/typie`가 mode `160000` gitlink로 기록돼 있다.
remote가 없으므로 새 경로의 실제 `git clone --recurse-submodules` 재현은 아직
`DEFERRED TO REPOSITORY HARDENING`이다.

checkout 확인:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\bootstrap-typie.ps1
git -C .\vendor\typie rev-parse HEAD
git -C .\vendor\typie status --short
```

일반 앱 build는 고정된 runtime artifact를 사용한다. `wasm-opt`을 포함하는 Typie
runtime 전체 source 재현 build는 `DEFERRED TO BUILD HARDENING`이다.

## Windows 개발 요구사항

- Windows 10/11 x64
- Git
- Node.js `26.3.1` (`.node-version`)
- pnpm `11.9.0` (`package.json#packageManager`)
- Rust `1.97.1` MSVC (`rust-toolchain.toml`)
- Rust targets `x86_64-pc-windows-msvc`, `wasm32-unknown-unknown`
- Visual Studio 2022 Build Tools의 C++ desktop workload와 Windows SDK

설치:

```powershell
node --version
pnpm --version
rustc +1.97.1-x86_64-pc-windows-msvc --version

powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\bootstrap-typie.ps1
pnpm install --frozen-lockfile
```

의존성 최초 설치와 Typie checkout에는 network 또는 cache가 필요할 수 있다. 설치
뒤 production runtime은 Typie/madi server, account, API, cloud 또는 sync에
의존하지 않는다.

## build, test와 package 명령

```powershell
# 대화형 개발 실행
pnpm dev

# build
pnpm build

# 집중 검증
pnpm run test:core
pnpm run typecheck
pnpm run test:desktop
pnpm run test:phase1a
pnpm run test:integration

# 최종 gate
pnpm verify

# unpacked Windows 폴더만 생성
pnpm package:unpacked

# unpacked를 다시 만들고 실제 packaged smoke 실행
pnpm test:package
```

`pnpm verify`는 toolchain/repository/format/typecheck, renderer/Rust test, 실제 Typie
probe, 기존 `.madi` integration, production build, 일반 Electron smoke와 unpacked
packaged smoke를 순서대로 실행한다. `pnpm test:dev`는 interactive Vite/Electron
startup 성격 때문에 별도다.

unpacked 출력:

```text
output/madi-win32-x64/madi.exe
output/madi-win32-x64/resources/app/dist/
output/madi-win32-x64/resources/bin/madi-core.exe
output/madi-win32-x64/resources/licenses/
```

이 폴더는 installer, code signing 또는 자동 update가 아니다.

### 현재 검증 상태

| 항목 | 현재 기록 |
|---|---|
| Rust 전체 test | `16 / 16 PASS` |
| renderer focused test | `53 / 53 PASS` |
| Phase 1A sidecar 재시작 round-trip | `PASS` — 2 process, WORK 1/VOLUME 2/CHAPTER 4/SCENE 6, 한국어 장면 3, scene break 1, 최종 revision 14 |
| 기존 Phase 0.5 integration | `PASS` |
| Phase 1A 변경 뒤 최종 `pnpm verify` | `PASS` — exit 0 |
| Phase 1A 변경 뒤 독립 `pnpm package:unpacked` | `PASS` — `output/madi-win32-x64/madi.exe` |
| 다중 Binder node를 조작하는 실제 Electron 종료/재열기 acceptance | `PASS` — 개발 앱과 unpacked packaged 앱 |

## Rust CLI와 JSON-RPC

core build와 help:

```powershell
pnpm run build:core
$core = ".\crates\madi-core\target\debug\madi-core.exe"
& $core --help
& $core create-tree-node --help
& $core save-scene --help
```

Phase 1A CLI subcommand:

```text
create-project, open-project, inspect-project,
load-project-tree, create-tree-node, rename-tree-node,
move-tree-node, reorder-tree-node, delete-tree-node,
load-scene, save-scene, save-ui-state, load-ui-state,
save-document, load-document, recover-plain-text, serve
```

Electron main이 사용하는 JSON-RPC method는 snake_case다.

```text
create_project, open_project, inspect_project,
load_project_tree, create_tree_node, rename_tree_node,
move_tree_node, reorder_tree_node, delete_tree_node,
load_scene, save_scene, save_ui_state, load_ui_state,
save_document, load_document, recover_plain_text
```

plain-text 긴급 복구 예:

```powershell
& $core recover-plain-text `
  --file-path ".\드래곤을죽이다.madi" `
  --output ".\recovered.txt"
```

`--output`은 새 file만 만들고 기존 file을 덮어쓰지 않는다. terminal에 원고를
출력하지 않으려면 output 경로를 사용한다.

## 수동 IME와 배포 금지 경계

Windows native 한국어 IME 15항목은 계속
`MANUAL VALIDATION PENDING (15 / 15 NOT TESTED)`이다. Vitest, Playwright와
programmatic 한글 입력은 이 상태를 `PASS`로 바꾸지 않는다. 실제 절차는
[`docs/MANUAL_KOREAN_IME_CHECKLIST.md`](docs/MANUAL_KOREAN_IME_CHECKLIST.md)를
따른다.

Typie runtime의 `AGPL-3.0-only` 표기와 현재 결합 구조 때문에 배포 정책은
`HUMAN DECISION REQUIRED BEFORE DISTRIBUTION`이다. 현재 허용 범위는 비공개 로컬
개발과 제한된 내부 기술검증이다. 다음은 허용되지 않는다.

- public download
- 유료 또는 고객 pilot
- installer 외부 전달
- app store/package registry 배포
- proprietary production 배포의 승인 근거로 사용

AGPL 호환 공개, Typie 권리자와 별도 license 또는 production editor 독립 구현 중
하나를 제품 책임자와 법률 전문가가 서면 결정해야 이 경계를 바꿀 수 있다.
[`docs/LICENSE_DECISION_REQUIRED.md`](docs/LICENSE_DECISION_REQUIRED.md)는 법률
자문이 아니라 결정 입력 문서다.

## hardening으로 미룬 항목

다음은 완료가 아니라 비공개 Phase 1A의 차단에서 후속 단계로 옮긴 것이다.

- Windows native 한국어 IME 수동검증
- installer/installed-state lifecycle
- 장편·장시간·DPI·다중 monitor 성능과 memory 기준
- 저장 중 crash/power-loss fault injection
- screen reader·keyboard-only 접근성 및 native 후보창 위치
- 실제 후보 Typie commit upgrade rehearsal
- remote recursive clean clone
- `wasm-opt` 포함 runtime source 재현 build

## 문서

- [Phase 1A 범위와 완료 계약](docs/PHASE_1A_SCOPE.md)
- [`.madi` v1 format 초안](docs/MADI_FILE_FORMAT_V1_DRAFT.md)
- [Phase 1A 저장소 결과](docs/PHASE_1A_RESULT.md)
- [Phase 0.5 폐쇄 결과](docs/PHASE_0_5_CLOSURE_RESULT.md)
- [Typie pin과 patch 정책](docs/TYPIE_PINNING_AND_PATCHES.md)
- [라이선스 결정 필요](docs/LICENSE_DECISION_REQUIRED.md)
- [수동 한국어 IME checklist](docs/MANUAL_KOREAN_IME_CHECKLIST.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
