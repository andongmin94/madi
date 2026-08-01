# madi

`madi`는 한국어 장편소설 작가를 위한 로컬 퍼스트 Windows 데스크톱 저작도구의
Phase 0/0.5 기술검증 시제품이다. Phase 1 제품 기능을 구현한 저장소가 아니다.

현재 목표는 하나다.

> Typie의 Rust 편집 엔진을 Electron + React renderer에서 WASM으로 실행하고,
> 편집 결과를 SQLite 기반 단일 `.madi` 파일에 저장·복원할 수 있는지 검증한다.

Phase 0 판정은 **CONDITIONAL GO**였고, 현재 Phase 0.5 기술 판정은
**CONDITIONAL TECHNICAL GO**다. Phase 0.5 작업트리는 그 조건을 닫기 위한 20회
저장·복원, scene break/복구 CLI, adapter 경계, 다중 page, 개발·unpacked 실행과
offline smoke를 자동 검증할 수 있게 확장됐다. 그러나 다음 항목은 자동화로
닫혔다고 간주하지 않는다.

- Windows native 한국어 IME 15개 항목: 모두 `NOT TESTED`
- Typie 배포 라이선스 정책: `HUMAN DECISION REQUIRED`
- superproject의 durable Typie gitlink와 진짜 clean clone 재현: 최초 commit 뒤
  사용자가 남겨야 하는 VCS 증거
- `wasm-opt`까지 포함한 Typie runtime 전체 source rebuild: 아직 재현 절차가
  닫히지 않음
- 실제 installer와 installed-state lifecycle smoke: unpacked packaged-layout만
  통과
- 실제 후보 Typie commit을 사용한 과거 snapshot upgrade rehearsal: 미실행
- 현실적인 장편·장시간·DPI·다중 monitor 성능과 메모리 기준: 미정·미측정
- 저장·backup 경계의 crash/power-loss fault injection: 미실행
- screen reader·keyboard-only·native IME 후보창 위치: 미검증

따라서 이 README만으로 Phase 0.5를 무조건 `GO`로 올리지 않는다. Phase 0 근거는
[`docs/TYPIE_FEASIBILITY_RESULT.md`](docs/TYPIE_FEASIBILITY_RESULT.md), Phase 0.5
종료 기준과 실제 결과는
[`docs/PHASE_0_5_EXIT_CRITERIA.md`](docs/PHASE_0_5_EXIT_CRITERIA.md) 및
[`docs/PHASE_0_5_CLOSURE_RESULT.md`](docs/PHASE_0_5_CLOSURE_RESULT.md)를 참고한다.

## 현재 구현

- Electron main / sandboxed preload / React renderer 분리
- Typie browser WASM, ICU, 한국어 글꼴을 로컬 asset으로 로드
- Canvas surface와 hidden textarea 기반 입력 경계
- 모든 page Canvas surface의 동적 mount와 page-aware pointer/IME caret 좌표
- 키 입력, IME event, selection, Undo/Redo, clipboard를 renderer의 Typie
  `Message`와 `enqueue_request`/`tick_through`에 연결
- Typie changeset bundle snapshot 추출 및 `create_editor_from_graph` 복원
- Typie `horizontal_rule`의 `three_diamonds` variant를 Phase 0 장면 구분선으로 사용
- snapshot BLOB과 `prose_text_annotated()` 복구 사본을 SQLite `.madi`에 저장
- Electron 없이 plain text를 복구할 수 있는 Rust CLI
- 같은 `.madi`를 별도 프로세스로 20회 열기·수정·저장·재열기하는 endurance 검사
- 5,445자 fixture의 4-page 표시·저장·재실행 복원과 두 번째 page pointer hit 검사
- scene break 전후 편집·삭제·Undo/Redo·clipboard·snapshot 의미 검사
- Typie generated binding 참조를 adapter 구현 경계로 제한하는 정적 검사
- 15개 항목, autosave/composition 상태, 수동 환경 metadata와 JSON/Markdown
  export를 갖춘 IME Test 화면
- dirty 문서 전환 전 저장과 창 종료 전 renderer/main 저장 완료 handshake
- Windows unpacked 폴더 build와 packaged/offline Electron 재시작 smoke
- renderer에 파일 경로나 generic IPC/RPC를 노출하지 않는 session capability 방식
- production 외부 network 요청 차단과 로컬 `madi://app` asset protocol

Typie 제품 UI, 계정, API, cloud, sync, server 코드는 포함하지 않는다.

## 고정된 Typie 기준

- Repository: `https://github.com/penxle/typie`
- Commit: `fbe5c4bf860d1717a66e66bea2374a2e39f0dd26`
- Local source: `vendor/typie`
- Runtime metadata: `packages/typie-runtime/BUILD_INFO.json`
- Runtime package license 표기: `AGPL-3.0-only`

일반 build는 `packages/typie-runtime`에 고정된 WASM/JS/ICU/font 산출물을 사용한다.
Typie 최신 branch를 자동으로 가져오지 않는다.

현재 checkout을 검증하거나 `vendor/typie`가 없는 작업트리에 정확한 commit을
받으려면 다음 script를 사용한다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\bootstrap-typie.ps1

git -C .\vendor\typie rev-parse HEAD
git -C .\vendor\typie status --short
```

script는 기존 checkout이 정확한 commit이고 clean인지 검사한다. checkout이 없을
때만 upstream을 clone해 위 commit으로 detached checkout하며, Typie 내부 patch를
적용하지 않는다. 상세 pin/patch 목록은
[`docs/TYPIE_PINNING_AND_PATCHES.md`](docs/TYPIE_PINNING_AND_PATCHES.md)에 기록한다.

> **현재 VCS 상태:** 이 root repository는 아직 최초 commit 전이라 `HEAD`가 없다.
> `.gitmodules`와 정확한 nested Typie checkout은 존재하지만, parent commit에
> mode `160000` gitlink가 아직 영구 기록되지 않았다. 따라서 현재 HEAD/hash
> 검사는 작업트리 증거이고, `git clone --recurse-submodules`가 같은 pin을
> 재생한다는 durable 증거는 아니다. 사용자가 최초 commit에 gitlink를 포함해
> 원격에 올린 뒤 새 경로에서 clone과 전체 검증을 다시 수행해야 이 조건이 닫힌다.

Typie runtime metadata의 `AGPL-3.0-only` 표기는 기술적 사실이지 proprietary
배포 허가 판정이 아니다. AGPL 호환 배포, 별도 commercial license, 또는 생산
엔진 독립 구현 중 어떤 경로를 택할지는 **HUMAN DECISION REQUIRED**이며 법률
전문가의 검토가 필요하다. 결정 전에는 이 unpacked 결과를 생산 배포 근거로
사용하지 않는다. 자세한 결정지는
[`docs/LICENSE_DECISION_REQUIRED.md`](docs/LICENSE_DECISION_REQUIRED.md)에 있다.

## Windows 요구사항

- Windows 10 또는 Windows 11 x64
- Git
- Node.js `26.3.1`
  - 저장소 pin: [`.node-version`](.node-version)
- pnpm `11.9.0`
  - 저장소 pin: `package.json`의 `packageManager`
- Rust `1.97.1`
  - 저장소 pin: [`rust-toolchain.toml`](rust-toolchain.toml)
- Rust MSVC host toolchain: `1.97.1-x86_64-pc-windows-msvc`
- Rust targets: `x86_64-pc-windows-msvc`, `wasm32-unknown-unknown`
- Visual Studio 2022 Build Tools
  - `Desktop development with C++`
  - MSVC x64/x86 build tools
  - Windows 10 또는 Windows 11 SDK

설치 및 확인 예:

```powershell
node --version
if ((node --version) -ne "v26.3.1") { throw "Node 26.3.1 required" }

# pnpm이 아직 없다면 한 번만 실행한다. Node 26 배포본에 Corepack이 없을 수 있다.
npm install --global pnpm@11.9.0
pnpm --version

rustup toolchain install 1.97.1-x86_64-pc-windows-msvc `
  --profile minimal `
  --component rustfmt `
  --target wasm32-unknown-unknown
rustup target add x86_64-pc-windows-msvc `
  --toolchain 1.97.1-x86_64-pc-windows-msvc

rustc +1.97.1-x86_64-pc-windows-msvc --version
rustc +1.97.1-x86_64-pc-windows-msvc -Vv
rustup target list --installed `
  --toolchain 1.97.1-x86_64-pc-windows-msvc
```

기대 version은 각각 `v26.3.1`, `11.9.0`, `rustc 1.97.1`이다. `rustc -Vv`의
`host`가 `x86_64-pc-windows-msvc`인지 확인한다. GNU host toolchain은 이 Phase
0/0.5의 Windows native build 기준이 아니다. 루트 Rust script는
[`scripts/cargo.ps1`](scripts/cargo.ps1)을 통해 이 exact toolchain을 선택한다.

정상적인 앱 build에는 체크인된 Typie runtime을 사용하므로
`wasm32-unknown-unknown`, `wasm-bindgen-cli`, ICU4X datagen 또는 `wasm-opt`을
다시 실행할 필요가 없다. `rust-toolchain.toml`에 wasm target이 있어도 Typie
runtime 자체를 source에서 재생성하려면 `wasm-bindgen`, editor-bindgen,
ICU/font 생성과 Binaryen `wasm-opt`의 exact version 및 순서를 함께 고정해야 한다.
현재 `scripts/bootstrap-typie.ps1`은 source pin만 담당하며, `wasm-opt`까지 포함한
전체 source rebuild는 단일 재현 build로 자동화·검증되지 않았다.

## 설치, build, test, 개발 실행

```powershell
# exact Node/Rust/pnpm과 Visual Studio Build Tools를 먼저 준비한다.
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\bootstrap-typie.ps1
pnpm install --frozen-lockfile

pnpm build
pnpm test
pnpm test:dev
pnpm verify
```

`pnpm install --frozen-lockfile`의 root `postinstall`은
[`scripts/ensure-electron.mjs`](scripts/ensure-electron.mjs)를 실행한다. Electron
runtime이 완전하면 version/executable/path를 확인하고, 불완전하면 lockfile의
Electron `37.10.3` archive를 다시 받아 package의 `checksums.json`과 SHA-256을
대조한다. Windows 복구 경로는 검증된 archive를 `tar.exe`로 풀고 runtime을 다시
검사한다. 최초 download에는 network 또는 package cache가 필요할 수 있으며, 이
보강은 설치 뒤 앱의 offline 실행 증거나 아직 남은 진짜 clean clone 증거를
대체하지 않는다.

root `preinstall`과 `pnpm verify`는 `scripts/check-toolchain.mjs`로 실제
`node` command가 `v26.3.1`, 실행 package manager가 `pnpm 11.9.0`인지
fail-fast 검사한다. `package.json`의 `engines`는 standalone pnpm 자체가 내장
Node runtime으로 실행되는 환경을 위한 호환성 하한이며 exact pin으로 사용하지
않는다. 이 저장소의 exact gate는 `.node-version`, `packageManager`와 위
실행 검사다.

`pnpm dev`는 Electron 창을 유지하는 대화형 개발 실행이다. 별도 terminal에서
종료할 때까지 실행한다.

```powershell
pnpm dev
```

`pnpm test:dev`는 같은 `pnpm dev`를 자식 프로세스로 시작해 Rust debug build,
`http://127.0.0.1:5173` Vite 준비와 실제 Electron process를 확인하고 종료하는
자동 startup smoke다. native IME를 입력하거나 15개 수동 항목을 통과시키지는
않는다.

`pnpm verify`는 저장소 정적/format 검사, TypeScript typecheck, frontend/Rust
test, 실제 Typie probe, `.madi`/scene break/recovery integration, production
build, 일반 Electron smoke, Windows unpacked build와 packaged offline smoke를
한 gate로 실행한다. `pnpm test:dev`는 개발 server의 장기 process 성격 때문에
별도 명령으로 둔다.

루트 `pnpm build`는 다음을 수행한다.

1. `crates/madi-core`를 debug MSVC binary로 build
2. Electron main TypeScript compile
3. sandbox preload 단일 CJS bundle 생성
4. React renderer와 로컬 WASM/ICU/font asset bundle 생성

기본 Rust binary 위치는 다음과 같다.

```text
crates/madi-core/target/debug/madi-core.exe
```

다른 binary를 검증할 때만 main process 환경 변수 `MADI_CORE_BIN`으로 절대 경로를
지정할 수 있다. renderer 입력은 이 경로에 사용되지 않는다.

### 최초 commit 이후의 진짜 clean checkout

아래는 parent repository에 `.gitmodules`와 `vendor/typie` gitlink가 commit된 뒤
검증할 목표 절차다. 현재 root에는 최초 commit이 없으므로 이 절차를 이미
재현했다고 주장하지 않는다.

```powershell
git clone --recurse-submodules <madi-repository-url> madi-clean
Set-Location madi-clean
git submodule update --init --recursive

git -C .\vendor\typie rev-parse HEAD
git -C .\vendor\typie status --short
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\bootstrap-typie.ps1

pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm test:dev
pnpm verify
```

`git -C .\vendor\typie rev-parse HEAD` 결과는 반드시 다음 값이어야 한다.

```text
fbe5c4bf860d1717a66e66bea2374a2e39f0dd26
```

다르면 임의로 최신 commit을 사용하지 말고 superproject의 gitlink를 확인한다.
submodule에 작업 중인 변경이 있다면 먼저 보존한 뒤 clean checkout을 다시 만든다.

## 실행

개발 모드:

```powershell
pnpm dev
```

`pnpm dev`는 Rust core를 먼저 build하고, loopback Vite server와 Electron을
실행한다. 개발 모드에서 허용되는 network origin은 설정된 loopback renderer
origin뿐이다.

미리 build한 production renderer 실행:

```powershell
pnpm build
pnpm start
```

현재 `start`는 build 결과를 Electron으로 실행하는 비패키지 검증 명령이다.

Windows unpacked 폴더 생성과 검증:

```powershell
pnpm package:unpacked
pnpm test:package
```

출력은 다음과 같다.

```text
output/madi-win32-x64/madi.exe
output/madi-win32-x64/resources/app/dist/
output/madi-win32-x64/resources/bin/madi-core.exe
output/madi-win32-x64/resources/licenses/
```

`pnpm package:unpacked`은 Rust release sidecar와 renderer를 다시 build한 뒤 Electron
runtime을 위 폴더에 조립한다. installer, MSIX/NSIS, code signing 또는 자동
업데이트를 만들지 않는다. 따라서 unpacked packaged-layout 조건은 PASS지만,
Phase 0 원문의 실제 installer/installed-state smoke는 별도 `TODO`다.

`pnpm test:package`의 `pretest:package`는 unpacked 폴더를 다시 만든다. 이어 실제
`madi.exe`를 두 번 실행해 `app.isPackaged === true`, Typie WASM/Canvas,
scene break, snapshot 저장, process 종료 뒤 `.madi` 복원, 임의 `file://` 읽기
차단을 확인한다. Chromium network emulation을 offline으로 둔 상태에서 외부
runtime request가 0건인지도 검사한다. 일반 `pnpm test:electron`은 같은 smoke를
비패키지 Electron에서 실행하며 `app.isPackaged === false`를 요구한다. smoke
자체는 OS 임시 디렉터리의 격리된 Electron user-data profile을 사용하므로 사람이
저장한 IME 수동 결과를 초기화하지 않는다. screenshot은 `output/playwright/`에
남는다.

smoke의 request listener와 Chromium offline emulation은 최초 local page를 얻은
뒤 controlled reload 전에 설치된다. 따라서 `external request 0`은 그 reload부터
입력·저장·dirty 창 종료·재실행·복원까지의 계측값이다. 최초 page load 전부터 main
process의 allowlist network guard가 설치되지만, 그 짧은 구간은 이 0건 counter에
포함되지 않는다.

## 테스트

Phase 0.5 전체 검증 gate:

```powershell
pnpm verify
```

2026-08-01 현재 작업트리 재검증에서 `pnpm verify`와 `pnpm test:dev`는 모두
exit code `0`이었다. 이 자동 증거에는 20회 `.madi` round-trip과 5,445자/4-page
production·packaged offline smoke가 포함되지만, Windows native IME 수동 결과,
현실적인 장편 성능, 실제 installed-state 또는 최초 commit 이후 새 경로 clean
clone을 대신하지 않는다.

기존 Phase 0 회귀 묶음만 실행할 때는 다음 명령을 쓸 수 있다. 이 명령은
`package:unpacked`/`test:package`를 포함하지 않으므로 Phase 0.5 최종 gate를
대체하지 않는다.

```powershell
pnpm test
```

주요 script의 범위는 다음과 같다.

| 명령 | 범위 |
|---|---|
| `pnpm run build:core` | Rust sidecar build |
| `pnpm run typecheck` | Electron main/preload/renderer strict TypeScript 검사 |
| `pnpm run test:typie` | 실제 Typie WASM의 한국어 fixture, 의미 구분선, Undo/Redo, snapshot 복원 |
| `pnpm run test:core` | SQLite schema, metadata, BLOB/recovery, migration, reopen, recovery CLI |
| `pnpm run test:desktop` | adapter, preload 허용 API, 저장 상태, 복원 orchestration |
| `pnpm run test:integration` | 별도 core process round-trip, 20회 endurance, scene break, recovery CLI 안전성 |
| `pnpm run test:electron` | 비패키지 production Electron의 5,445자/4-page, page-aware pointer, dirty-close 저장, offline/restart smoke |
| `pnpm run test:dev` | `pnpm dev`의 Vite 및 Electron startup smoke |
| `pnpm run package:unpacked` | Windows x64 unpacked 폴더 생성 |
| `pnpm run test:package` | `app.isPackaged === true` unpacked 5,445자/4-page, dirty-close 저장, offline/restart smoke |
| `pnpm run verify` | 정적/format/type/test/build/Electron/package 전체 gate |

개별 명령:

```powershell
pnpm run typecheck
pnpm run test:typie
pnpm run test:core
pnpm run test:desktop
pnpm run test:integration
pnpm run test:electron
pnpm run test:dev
pnpm run package:unpacked
pnpm run test:package
pnpm run verify
```

자동 probe에서 프로그램 방식으로 한국어 문자열을 삽입하는 것과 Windows native
IME를 사람이 입력하는 것은 다른 검증이다. 자동 test가 통과해도 아래 수동 상태는
바뀌지 않는다.

## Rust CLI

먼저 core를 build한다.

```powershell
pnpm run build:core
$core = ".\crates\madi-core\target\debug\madi-core.exe"
```

프로젝트 생성과 metadata 확인:

```powershell
& $core create-project `
  --file-path ".\드래곤을죽이다.madi" `
  --title "드래곤을죽이다" `
  --document-id "phase0-document" `
  --editor-engine "typie" `
  --editor-engine-commit "fbe5c4bf860d1717a66e66bea2374a2e39f0dd26" `
  --editor-schema-version 1

& $core inspect-project `
  --file-path ".\드래곤을죽이다.madi"
```

snapshot과 recovery text 저장:

```powershell
& $core save-document `
  --file-path ".\드래곤을죽이다.madi" `
  --document-id "phase0-document" `
  --title "본문" `
  --editor-engine "typie" `
  --editor-engine-commit "fbe5c4bf860d1717a66e66bea2374a2e39f0dd26" `
  --editor-schema-version 1 `
  --snapshot-file ".\fixture.snapshot" `
  --plain-text-file ".\fixture.txt" `
  --expected-revision 0
```

`fixture.snapshot`은 임의 text 파일이 아니라 Typie
`missing_changesets_tolerant(new Uint8Array()).bytes`가 반환한 changeset
bundle이어야 한다.

UI 없이 plain text 복구:

```powershell
& $core recover-plain-text `
  --file-path ".\드래곤을죽이다.madi" `
  --document-id "phase0-document"
```

canonical flag 형식은 다음과 같다. 경로와 document id를 positional argument로
쓰지 않는다.

```text
madi-core recover-plain-text --file-path <PROJECT.madi> [--document-id <ID>] [--output <NEW_FILE> | --json]
```

- `--file-path`는 필수다. `--path` alias도 있지만 문서와 test는
  `--file-path`를 사용한다.
- `--document-id`는 선택이다. 생략하면 저장소의 기본/유일 document를 선택한다.
- `--output`을 생략하면 UTF-8 plain text만 stdout으로 쓴다.
- `--output`은 새 파일만 생성하고 기존 파일을 덮어쓰지 않는다. 성공 시 stdout에는
  원고가 아니라 output metadata JSON만 쓴다.
- `--json`은 `--output`과 동시에 쓸 수 없으며, 의도적으로 복구 본문을 포함한
  structured JSON을 stdout으로 요청할 때만 사용한다.

새 파일로 복구할 때 출력 파일은 기존에 없어야 한다.

```powershell
& $core recover-plain-text `
  --file-path ".\드래곤을죽이다.madi" `
  --document-id "phase0-document" `
  --output ".\recovered.txt"
```

전체 CLI option은 다음으로 확인한다.

```powershell
& $core --help
& $core save-document --help
& $core recover-plain-text --help
```

## stdin/stdout JSON-RPC

Electron main은 다음 명령으로 persistent sidecar를 시작한다.

```powershell
& $core serve
```

프로토콜은 한 줄에 하나의 JSON-RPC 2.0 request/response를 사용하는 JSON Lines다.
허용 method는 다음 여섯 개다.

- `create_project`
- `open_project`
- `save_document`
- `load_document`
- `inspect_project`
- `recover_plain_text`

PowerShell에서 단일 request를 보내는 예:

```powershell
'{"jsonrpc":"2.0","id":1,"method":"inspect_project","params":{"file_path":"C:\\work\\드래곤을죽이다.madi"}}' |
  & $core serve
```

생성 예:

```json
{"jsonrpc":"2.0","id":2,"method":"create_project","params":{"file_path":"C:\\work\\드래곤을죽이다.madi","title":"드래곤을죽이다","document_id":"phase0-document","editor_engine":"typie","editor_engine_commit":"fbe5c4bf860d1717a66e66bea2374a2e39f0dd26","editor_schema_version":1}}
```

저장은 `params.document`에 `snapshot_base64`와 `plain_text_recovery`를 넣는다.
renderer는 method 이름이나 실제 파일 경로를 전달하지 않는다. Electron main이
고정 method별 payload를 만들고, dialog에서 얻은 경로를 session capability로
관리한다.

## 보안과 로컬 동작

Electron window 기본값:

```text
nodeIntegration: false
contextIsolation: true
sandbox: true
webSecurity: true
allowRunningInsecureContent: false
```

preload는 다음 함수만 노출한다.

- `createProject`
- `openProject`
- `saveDocument`
- `loadDocument`
- `recoverPlainText`
- `getAppVersion`
- `onCloseRequested`
- `completeCloseRequest`

generic `ipcRenderer`, `fs`, `child_process`, shell 실행 또는 임의 파일 경로 API는
노출하지 않는다. 마지막 두 함수는 main의 창 닫기 요청을 renderer가 받으면 dirty
snapshot 저장을 마친 뒤에만 닫기를 승인하는 고정 handshake다. 원고 본문과
snapshot은 console log에 기록하지 않는다. preload는 React listener보다 먼저
close IPC를 구독해 조기 요청을 한 건 버퍼링하고, main은 15초 무응답 뒤 pending을
해제해 재시도를 허용한다. 저장 승인 IPC가 renderer에 돌아갈 100ms grace 뒤에만
창을 파괴하며, renderer는 승인 요청 직전에 문서 전체를 `inert`로 동결한다.
main의 boolean ACK가 요청을 거부하거나 IPC가 실패하면 동결을 되돌리고, 수락한
경우에는 grace 동안의 중복 닫기와 새 사용자 입력을 모두 차단한다. DOM
`compositionstart`는 controller transaction보다 먼저 동기 guard에 반영되므로
미확정 한글 조합 중 저장·문서 교체·종료를 승인하지 않는다. renderer가 이미 종료된
경우에는 마지막으로 저장된 recovery를 남긴 채 좀비 창을 닫는다. production Typie
input은 내용 transaction이 없는 composition 취소/종료도 별도
`composition-state` event로 controller에 전달한다. 따라서 조합 취소 뒤 guard가
고착되지 않으며, 이 상태 event만으로 문서를 dirty로 바꾸거나 generation을
증가시키지 않는다.

의존성 설치와 submodule checkout 이후 앱 실행에는 Typie 또는 madi server가
필요하지 않다. production renderer는 `madi://app`의 local asset만 읽는다.

## 수동 한국어 IME 상태

Windows native 한국어 IME 15개 항목은 현재 모두 **NOT TESTED**다. 자동
Vitest/Playwright와 `pressSequentially`는 이 상태를 `PASS`로 바꾸지 않는다.

IME Test 화면은 다음 둘 중 하나로 실제 Electron을 실행해 사용한다.

```powershell
# 개발 실행
pnpm dev

# 또는 unpacked 실행
pnpm package:unpacked
& .\output\madi-win32-x64\madi.exe
```

정확한 사용 절차:

1. Windows 한국어 IME를 켜고 Electron 창 우측 상단의 `한국어 IME 체크`를 연다.
2. `테스트용 빈 문서 생성`을 누르고 저장 대화상자에서 시험용 `.madi`를 지정한다.
3. `수동 시험 환경`에 Windows/Electron/IME/keyboard/display scale/date/tester를
   실제 값으로 입력한다. app version, Typie commit, editor schema, platform과
   user agent는 자동으로 붙는다.
4. 왼쪽의 실제 Typie editor mount에 아래 fixture를 입력한다. 우측 Autosave,
   Undo/Redo 가능 표시와 마지막 composition event를 함께 관찰한다.
5. 저장 경계를 확인할 때 `snapshot 지금 저장`을 누르고 Autosave가
   `snapshot 저장됨`인지 확인한다.
6. 재실행 시험은 창을 닫는 데 그치지 말고 Electron process가 완전히 끝났는지
   확인한 뒤 같은 명령으로 다시 실행한다. `저장한 .madi 열기`로 같은 파일을 연다.
7. 사람이 기대 결과를 직접 확인한 행만 checkbox로 `PASS` 처리한다. 실패는 해당
   행의 `FAIL` 버튼을 사용한다. 앱이 자동으로 `PASS`를 기록하지 않는다.
8. `결과 JSON 내보내기` 또는 `결과 Markdown 내보내기`로 환경 metadata와 결과를
   보관한다. export에는 입력 문자나 원고 본문이 포함되지 않는다.
9. 새 수동 run을 시작할 때 `모두 NOT TESTED로 초기화`를 누른다.

화면의 정확한 15개 항목은 다음과 같다.

1. 한글 문장 연속 입력
2. 초성·중성·종성 조합
3. 복합모음과 겹받침
4. 조합 직후 Enter
5. 조합 직후 Undo
6. Undo 후 Redo
7. 조합 직후 방향키 이동
8. 선택 후 삭제
9. 한글 문장 복사·붙여넣기
10. 한글 또는 Word 계열 프로그램에서 붙여넣기
11. 장면 구분선 앞뒤에서 입력
12. 빠른 입력 시 중복·누락 확인
13. 저장 후 앱 완전 종료
14. 재실행 후 동일 문서 복원
15. 5,000자 이상 한글 원고 입력 또는 붙여넣기

초기 상태와 reset 뒤 상태는 15개 모두 `NOT TESTED`다. 사람이 수행한 환경과
결과가 보존되기 전에는 통과로 기록하지 않는다. 상세 fixture와 기대 결과는
[`docs/MANUAL_KOREAN_IME_CHECKLIST.md`](docs/MANUAL_KOREAN_IME_CHECKLIST.md)를
사용한다. app version, Typie commit, editor schema, platform 또는 user agent가
달라지면 앱은 과거 PASS를 새 runtime의 결과로 오인하지 않도록 전 항목을
`NOT TESTED`로 초기화하고 경고한다.

## Phase 1 진입 gate

현재 Phase 1 제품 기능 구현 진입은 **NO**다. 다음 조건을 모두 충족하고 기술·제품·
라이선스 판정을 다시 내려야 한다.

1. source/runtime 변경 뒤에도 `pnpm verify`와 `pnpm test:dev`가 통과해야 한다.
2. 최초 commit에 `.gitmodules`와 정확한 `vendor/typie` mode `160000` gitlink를
   기록해야 한다.
3. 원격의 새 경로에서 recursive clone, frozen install, 전체 verify와 development
   startup을 재현해야 한다.
4. exact tool version과 `wasm-opt`을 포함한 Typie runtime build를 두 clean build로
   재현해야 한다.
5. 실제 installer로 깨끗한 Windows 사용자 환경에 설치하고 같은
   offline/save/close/relaunch/restore smoke를 반복해야 한다.
6. Windows native 한국어 IME와 외부 한글/Word clipboard 15개 항목을 사람이
   수행하고 환경·결과 export를 보존해야 한다.
7. 합의한 장편 규모와 지원 DPI/monitor에서 latency·memory 기준을 정해 통과해야
   한다.
8. 저장·backup 주요 경계의 crash/power-loss fault injection과 복구를 통과해야
   한다.
9. screen reader, keyboard-only 조작과 native IME 후보창 위치를 실제로 확인해야
   한다.
10. 실제 후보 Typie commit으로 과거 snapshot의 호환 또는 안전한 거부·복구를
    rehearsal해야 한다.
11. 제품 책임자와 법률 전문가가 라이선스 Option A/B/C와 허용 배포 범위를 서면
    승인해야 한다.

상세 상태 crosswalk와 증거는
[`docs/PHASE_0_5_CLOSURE_RESULT.md`](docs/PHASE_0_5_CLOSURE_RESULT.md)의
“다음 Phase로 넘어가기 위한 정확한 조건”을 따른다.

## Phase 0 한계

- 완성형 제품 UI가 아니라 기술검증 shell이다.
- visual host는 paginated document의 모든 page surface를 동적으로 붙이고,
  page-aware pointer hit test와 IME caret offset을 처리한다. packaged smoke에서
  5,445자 fixture가 4개 page로 표시·저장·복원되는 것을 확인했다.
- 현실적인 장편 규모, 장시간 편집, 다양한 DPI와 다중 monitor 조합의 성능·메모리
  허용 기준은 아직 검증하지 않았다.
- pointer, keyboard, clipboard wiring은 최소 범위이며 Typie website의 전체 browser
  host 기능을 복제하지 않았다.
- Undo/Redo 가능 상태는 별도 public history-stack query가 없어 adapter가 최근
  command로 보수적으로 추정하며, UI도 이를 authoritative 상태가 아닌
  `최근 명령 기반 추정`으로 표시한다.
- snapshot은 CRDT changeset graph이며 selection, viewport, composition과 재시작 전
  Undo stack은 복원하지 않는다.
- 장면 구분선의 madi 소유 의미 ID는 `madi.scene-break.v1`이고, 현재 adapter는
  이를 Typie `horizontal_rule/three_diamonds`에 독점 mapping한다.
- Typie snapshot 자체에 별도 madi tag를 fork해 넣지는 않았다. 범용 가로선 기능을
  추가하려면 장식용 가로선과 scene ID를 구별하는 durable metadata를 먼저 설계해야
  하며, 그 전에는 같은 variant를 다른 기능이 만들 수 없다.
- Typie API는 private `0.0.1` generated binding이며 semver 안정성 보장이 없다.
- Typie commit 간 과거 snapshot migration은 검증하지 않았다.
- Typie runtime 전체 source build는 성공했지만 `wasm-opt` 단계가 생략됐고,
  clean checkout에서 재현하는 단일 자동화 script는 없다.
- Windows unpacked 폴더만 조립한다. installer, code signing, 자동 업데이트는
  구현하지 않았다.
- Windows native IME 15개 수동 항목은 전부 `NOT TESTED`다.
- root 최초 commit 전이므로 parent gitlink와 진짜 clean clone 증거가 아직 없다.
- Typie 결합 구조의 생산 배포 라이선스 경로는 `HUMAN DECISION REQUIRED`다.
- Binder, 세계관 그래프, 플롯, Reader Lab, HWP/HWPX, EPUB, LLM은 범위 밖이다.

## 문서

- [`docs/PRODUCT_SCOPE_PHASE0.md`](docs/PRODUCT_SCOPE_PHASE0.md)
- [`docs/ARCHITECTURE_PHASE0.md`](docs/ARCHITECTURE_PHASE0.md)
- [`docs/MADI_FILE_FORMAT_V0.md`](docs/MADI_FILE_FORMAT_V0.md)
- [`docs/TYPIE_ENGINE_MAP.md`](docs/TYPIE_ENGINE_MAP.md)
- [`docs/TYPIE_FEASIBILITY_RESULT.md`](docs/TYPIE_FEASIBILITY_RESULT.md)
- [`docs/TYPIE_LICENSE_IMPACT.md`](docs/TYPIE_LICENSE_IMPACT.md)
- [`docs/MANUAL_KOREAN_IME_CHECKLIST.md`](docs/MANUAL_KOREAN_IME_CHECKLIST.md)
- [`docs/PHASE_0_5_EXIT_CRITERIA.md`](docs/PHASE_0_5_EXIT_CRITERIA.md)
- [`docs/TYPIE_PINNING_AND_PATCHES.md`](docs/TYPIE_PINNING_AND_PATCHES.md)
- [`docs/LICENSE_DECISION_REQUIRED.md`](docs/LICENSE_DECISION_REQUIRED.md)
- [`docs/PHASE_0_5_CLOSURE_RESULT.md`](docs/PHASE_0_5_CLOSURE_RESULT.md)
- [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)
