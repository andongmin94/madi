# Phase 0.5 Conditional GO 폐쇄 결과

## 판정 요약

기준일: 2026-08-01

```text
Phase 0.5 technical verdict: CONDITIONAL TECHNICAL GO
Windows native Korean IME: NOT TESTED
License/distribution decision: HUMAN DECISION REQUIRED
Production distribution authorized: NO
Phase 1 product-feature entry authorized: NO
```

저장·복원, Typie 서비스 비의존, scene break 의미 보존, 현재 작업트리의 build,
plain-text 긴급 복구와 adapter 격리는 자동 검증 범위에서 통과했다. 따라서 현재
시제품을 기술적으로 즉시 폐기해야 할 `TECHNICAL NO-GO` 근거는 없다.

그러나 다음 항목이 남아 있으므로 완전한 `TECHNICAL GO`로 올리지 않는다.

- Windows native 한국어 IME 15개 항목이 모두 `NOT TESTED`다.
- root 저장소에 아직 최초 `HEAD`와 mode `160000` Typie gitlink가 없어, 새
  clone이 같은 source를 재생한다는 durable 증거가 없다.
- Binaryen `wasm-opt`을 포함한 Typie runtime end-to-end 재현 build가 완성되지
  않았다.
- Windows unpacked packaged-layout smoke는 통과했지만 실제 installer를 만들고
  설치한 상태의 lifecycle smoke는 수행하지 않았다.
- 현실적인 장편·장시간·DPI·다중 monitor 성능, 저장 중 crash fault injection,
  접근성·screen reader·native IME 후보창은 검증되지 않았다.
- 과거 snapshot을 실제 후보 Typie commit으로 여는 upgrade rehearsal은 수행하지
  않았다.
- Typie 결합 구조의 생산 배포 정책은 `HUMAN DECISION REQUIRED`다.

이 판정은 로컬 기술검증 시제품에만 적용된다. unpacked Windows 실행물이 만들어진
사실은 installer, code signing, 공개 배포 또는 라이선스 승인을 뜻하지 않는다.

### 최종 자동 검증 기록

2026-08-01 현재 작업트리 재검증 결과:

```text
Command: pnpm verify
Exit code: 0

Repository gate:
  desktop source files scanned: 27
  Rust core files scanned: 6
  negative Typie-boundary fixture: rejected
  Typie nested checkout: fbe5c4bf860d1717a66e66bea2374a2e39f0dd26, clean
  pinned runtime hashes: 7 / 7 verified
Exact toolchain gate: Node v26.3.1, pnpm 11.9.0, PASS
Format/JSON gate: 57 files, PASS
TypeScript typecheck: PASS
Vitest: 8 files, 40 tests, PASS
Rust: 9 tests (2 + 1 + 1 + 5), doc tests 0, PASS
Typie/integration/build/Electron/package gates: PASS

Command: pnpm test:dev
Result: Rust debug build, Vite startup, actual Electron process, PASS
```

일반 Electron과 Windows unpacked Electron smoke는 각각 5,445자, 4개 page
surface 전체 render, 두 번째 page pointer hit, offline mode, controlled reload
이후 외부 request 0건과 완전 종료 뒤 동일 문서 복원을 확인했다. 두 경로 모두
실제 IME panel을 열어
15개 결과가 모두 `NOT TESTED`이고 autosave/history/composition 상태와
snapshot·reopen·JSON·Markdown 작업이 노출되는지도 확인했다. smoke의
Electron user-data는 OS 임시 디렉터리에 격리해 실제 수동 결과를 건드리지 않는다.
dirty 입력 12자를 추가한 직후 창 닫기를 요청했을 때도 저장이 끝난 뒤 종료됐고,
재실행에서 revision `1 → 2`와 recovery 문자 수 `5,457 → 5,469`를 확인했다.

## 1. 기존 `CONDITIONAL GO` 조건 원문

Phase 0 결과 문서
`docs/TYPIE_FEASIBILITY_RESULT.md`의 “`GO`로 올리기 위한 최소 조건” 원문은
다음과 같다.

> 1. 한국어 IME와 외부 한글/Word clipboard checklist를 사람이 수행하고 각
>    환경/결과를 기록한다.
> 2. page 0 이외의 문서 표시와 긴 장편/DPI 성능을 검증한다.
> 3. undo/redo 가능 표시를 engine의 신뢰 가능한 history 상태에 연결하거나, 추정임을
>    UI contract로 명확히 제한한다.
> 4. `wasm-opt`을 포함한 고정/reproducible runtime build를 CI 또는 release script로
>    만든다.
> 5. Windows 패키지/설치본을 만들고 설치 상태에서 같은 smoke를 반복한다.
> 6. 과거 snapshot fixture를 포함한 commit upgrade gate를 정의한다.
> 7. AGPL 배포, 별도 commercial license, 또는 독립 구현 중 하나를 제품 정책으로
>    결정하고 법률 전문가의 검토를 받는다.

원문은 이어서 “이 조건을 충족하기 전 최종 판정은 **CONDITIONAL GO**다.”라고
판정했다. Phase 0의 미확인 목록과 Phase 0.5 요청이 추가한 adapter 정적 격리,
20회 round-trip, 복구 오류 안전성과 IME Test 화면은
`docs/PHASE_0_5_EXIT_CRITERIA.md`에서 별도 종료 조건으로 분해했다.

## 2. 각 조건의 최종 상태

`docs/PHASE_0_5_EXIT_CRITERIA.md`의 관리표와 이 문서의 binary Phase gate는 다음
crosswalk를 사용한다.

| EXIT 관리 상태 | 이 문서의 binary Phase gate | 의미 |
|---|---|---|
| `PASS` | `PASS` | 조건과 증거가 모두 충족됨 |
| `TODO` | `FAIL — UNMET` | 실행 실패가 아니라 조건 또는 증거가 아직 충족되지 않음 |
| `FAIL` | `FAIL — VERIFIED FAILURE` | 검증을 실행했고 합격 기준을 충족하지 못함 |
| `HUMAN DECISION REQUIRED` | `HUMAN DECISION REQUIRED` | 자동화로 대신할 수 없는 결정 |

따라서 아래 `FAIL — UNMET`은 구현 전체가 고장났다는 뜻이 아니다. EXIT 관리표의
`TODO`를 Phase 진입 여부가 명확한 이진 gate로 표현한 것이다. 현재 실행한 자동
검증에는 `FAIL — VERIFIED FAILURE`가 없다. 수동 시험의 `NOT TESTED`도 자동
통과로 바꾸지 않고 `FAIL — UNMET / NOT TESTED`로 표시한다.

EXIT 관리표 합계는 `PASS 15 / TODO 9 / FAIL 0 / HUMAN DECISION REQUIRED 1`이다.
아래 표는 인접한 PASS 조건을 일부 묶거나 같은 원 조건의 구현·미충족 부분을
나눠 보여주지만, EXIT의 9개 `TODO`는 모두 9개 `FAIL — UNMET`에 대응한다.

| ID | 조건 | 최종 상태 | 근거와 제한 |
|---|---|---|---|
| M-01 | 실제 Windows native 한국어 IME 15항목과 외부 한글/Word clipboard | **FAIL — UNMET / NOT TESTED** | IME Test 화면과 export는 준비됐지만 실제 사람이 수행한 결과가 없다. |
| C-02a | page 0 이후 문서 표시와 page-aware pointer | **PASS** | 5,445자 fixture가 4개 Canvas surface로 표시·저장·재실행 복원됐고 두 번째 page pointer hit가 `cursorPage = 1`로 확인됐다. |
| E-01 | 현실적인 장편·장시간·DPI·다중 monitor 성능/메모리 | **FAIL — UNMET** | 5,445자 자동 fixture는 기능 검증이지 장편 성능 허용 기준이 아니다. |
| C-03 | Undo/Redo 가능 표시의 계약 | **PASS** | public history-stack query가 없는 한계를 숨기지 않고 UI를 `최근 명령 기반 추정`으로 명시했다. 정확한 authoritative 상태로 약속하지 않는다. |
| B-04 | `wasm-opt` 포함 고정/reproducible runtime source build | **FAIL — UNMET** | 현재 runtime source build의 최종 `wasm-opt -Os --all-features` 단계, exact Binaryen version과 두 clean build 비교가 없다. |
| B-05a | Windows unpacked packaged-layout smoke | **PASS** | `output/madi-win32-x64/madi.exe`에서 `app.isPackaged === true`, release sidecar, offline 두 process 저장·복원을 확인했다. |
| B-05b | 실제 installer와 installed-state smoke | **FAIL — UNMET** | installer를 만들거나 설치 상태에서 같은 lifecycle smoke를 실행한 증거가 없다. `app.isPackaged === true`는 설치 상태를 뜻하지 않는다. |
| U-01a | 과거 snapshot을 포함하는 commit upgrade 절차 정의 | **PASS** | pin·artifact·API/codec/IME/render·과거 snapshot·수동 IME를 한 gate로 묶은 절차를 `docs/TYPIE_PINNING_AND_PATCHES.md`에 정의했다. |
| U-01b | 실제 후보 commit upgrade와 과거 snapshot migration rehearsal | **FAIL — UNMET** | 후보 commit을 선택해 실행한 증거가 없으며 commit 간 migration도 구현하지 않았다. |
| H-01 | AGPL/별도 license/독립 구현 중 생산 정책 결정 | **HUMAN DECISION REQUIRED** | 승인 option과 법률 검토가 모두 비어 있다. |
| B-01a | 현재 nested checkout·runtime artifact의 exact pin | **PASS** | nested HEAD가 고정 40자 commit이며 clean이고, `BUILD_INFO.json`과 7개 runtime SHA-256이 일치한다. |
| B-01b | superproject mode `160000` gitlink와 새 clone 재현 | **FAIL — UNMET** | root에 최초 `HEAD`가 없고 `git ls-files --stage vendor/typie` 결과도 없다. |
| B-02 | Typie 참조 방식·patch/adaptation inventory | **PASS** | submodule 방식, upstream 내부 patch 없음, generated asset과 IME adaptation을 분리 기록했다. |
| C-01 | Typie dependency의 adapter 정적 격리 | **PASS** | 허용 디렉터리 밖 source와 Rust core를 검사하며, 금지 import 음성 fixture가 gate에 의해 거부된다. |
| B-03a | 현재 작업트리에서 cache/생성물 제거 후 frozen install·build | **PASS** | `node_modules`, build output과 cache를 제거한 뒤 `pnpm install --frozen-lockfile`이 성공했고 같은 작업트리에서 build/package 검증을 다시 수행했다. |
| B-03b | committed remote의 진짜 clean clone 전체 재현 | **FAIL — UNMET** | 최초 commit과 remote가 없으므로 `git clone --recurse-submodules` 증거를 만들 수 없다. |
| B-06 | 단일 `pnpm verify` gate 정의·실행 | **PASS** | repository/format, typecheck, frontend/Rust, Typie, integration, build, Electron과 package smoke를 순서대로 실패 전파했고 최종 실행이 exit code `0`이었다. |
| B-07 | 설치·checkout 이후 Typie/madi 서비스와 인터넷 비의존 | **PASS** | packaged offline lifecycle에서 외부 runtime request 0건이며 계정/API/cloud/sync/server가 없다. |
| C-04/C-05 | `.madi` 별도 process 복원과 20회 round-trip | **PASS** | 매 회차 저장 bytes, canonical Typie 의미, UTF-8 recovery, scene node, 순서, metadata/migration과 revision을 검사했다. |
| C-06/C-07 | scene break 의미·편집·clipboard·안정 ID | **PASS** | 독립 node와 snapshot 의미, 전후 입력, 선택 삭제, Undo/Redo, rich clipboard, `madi.scene-break.v1` mapping을 확인했다. plain-text 외부 clipboard 제한은 문서화했다. |
| C-08/C-09 | Electron 없는 plain-text 복구와 오류 안전성 | **PASS** | 한글 UTF-8/`***`, no-clobber와 세 오류 경로 redaction, 비암호화 SQLite를 확인했다. |
| C-10 | 사람이 검증할 IME Test 화면 | **PASS** | 빈 문서, autosave, history 추정, redacted composition 상태, 수동 환경 metadata, snapshot/reopen, 15개 checkbox, runtime-bound persistence와 JSON/Markdown export가 있다. 이 PASS는 실제 IME 결과 PASS가 아니다. |
| E-02 | 저장/backup crash fault injection | **FAIL — UNMET** | transaction과 backup 단위 test는 있으나 강제 종료 지점별 실제 fault injection이 없다. |
| E-03 | 접근성·screen reader·native 후보창 위치 | **FAIL — UNMET** | 실제 보조기술과 native IME 후보창 검증 기록이 없다. |

자동화로 닫힌 필수 원고 안전 조건에 현재 `FAIL — VERIFIED FAILURE`는 없다. 남은
`FAIL — UNMET`은 재현 source/VCS, installed-state, 사람 입력, 실제 규모·환경,
upgrade와 fault-injection 증거다. 이 차이 때문에 전체 판정은
`CONDITIONAL TECHNICAL GO`다.

## 3. 변경한 코드

root 저장소가 최초 commit 전이라 신뢰할 수 있는 baseline diff는 존재하지 않는다.
따라서 아래는 “기존 commit 대비 diff”가 아니라 Phase 0.5 종료 증거에 직접
연결되는 현재 구현 inventory다.

### Editor 경계와 runtime host

- `apps/desktop/src/renderer/editor/MadiEditorAdapter.ts`
  - Typie type이 없는 madi 소유 editor 계약
  - 안정 ID `madi.scene-break.v1`
- `apps/desktop/src/renderer/editor/typie/TypieEditorAdapter.ts`
  - madi 명령과 Typie engine port 사이의 유일한 변환 경계
- `apps/desktop/src/renderer/editor/typie/productionAdapter.ts`
- `apps/desktop/src/renderer/editor/typie/runtimeRegistry.ts`
  - composition root에 madi 소유 factory/metadata만 전달
- `apps/desktop/src/renderer/editor/typie/sceneBreakMapping.ts`
  - madi scene ID와 Typie `horizontal_rule/three_diamonds`의 mapping
- `apps/desktop/src/renderer/editor/typie/createTypieEnginePort.ts`
  - WASM/ICU/font, 모든 page Canvas surface, page-aware pointer, hidden textarea,
    keyboard·composition·clipboard·snapshot 연결
  - 내용 transaction이 없는 composition 취소/종료도 독립 상태 event로 전달
- `apps/desktop/src/renderer/workspace/DocumentSessionController.ts`
  - `composition-state`를 dirty/generation 변경 없이 조합 guard에만 반영

### IME 수동검증 화면

- `apps/desktop/src/renderer/App.tsx`
  - 시험용 빈 `.madi`, 1.2초 autosave, snapshot 저장/열기 orchestration,
    원문을 보존하지 않는 마지막 composition metadata, DOM composition 동기 guard,
    닫기 전 저장과 renderer `inert` freeze handshake
- `apps/desktop/src/preload/bridge.ts`
  - renderer listener 등록 전 close request를 한 건 버퍼링, main ACK 전달
- `apps/desktop/src/main/window.ts`
  - dirty-close 승인, 15초 무응답 retry reset, 100ms IPC response grace,
    boolean ACK, renderer-gone 종료 정책
- `apps/desktop/src/renderer/components/ImeChecklist.tsx`
- `apps/desktop/src/renderer/components/imeManualResults.ts`
  - 정확히 15개 결과, 초기/reset `NOT TESTED`, 사람 checkbox만 `PASS`,
    명시적 `FAIL`, 수동 환경 7개 필드, runtime-bound localStorage와 원문 없는
    JSON/Markdown export
- `apps/desktop/tests/ime-test-app.test.tsx`
  - 조합 중 close 거부, 조합 종료 뒤 dirty-save, ACK 대기 중 `inert`,
    거부 ACK의 unlock과 수락 ACK의 lock 유지
- `apps/desktop/tests/ime-checklist.test.tsx`
- `apps/desktop/tests/preload-api.test.ts`
- `apps/desktop/tests/window-close.test.ts`
  - 조기 close buffer, timeout retry, renderer crash/destroy 경계

### 검증·packaging

- `scripts/check-repository.mjs`
  - pin/hash, adapter boundary, Rust core 경계와 음성 fixture
- `scripts/test-madi-endurance.mjs`
  - 별도 core process와 새 Typie host를 사용하는 20회 round-trip
- `scripts/test-scene-break.mjs`
  - 전후 입력, 선택 삭제, Undo/Redo, rich clipboard와 snapshot 의미
- `scripts/test-recovery-cli.mjs`
  - UTF-8, marker, no-clobber와 오류 redaction
- `scripts/electron-smoke.mjs`
  - 다중 page, page-aware pointer, IME panel 15개 초기 상태, offline,
    dirty-close save, process restart와 local-file 차단
- `scripts/package-unpacked.mjs`
- `scripts/electron-packaged-smoke.mjs`
  - Windows unpacked layout과 `app.isPackaged === true` 실행
- `scripts/test-dev-startup.mjs`
  - `pnpm dev`의 Rust build, Vite와 실제 Electron process startup
- `package.json`
  - 단일 `pnpm verify`와 세분화한 build/test/package 명령
- `.node-version`, `rust-toolchain.toml`
  - Node `26.3.1`, Rust `1.97.1`, MSVC/wasm target 고정

## 4. Typie 고정 commit

```text
Repository: https://github.com/penxle/typie
Exact commit: fbe5c4bf860d1717a66e66bea2374a2e39f0dd26
Intended source reference: Git submodule
Path: vendor/typie
Runtime manifest: packages/typie-runtime/BUILD_INFO.json
Runtime license label: AGPL-3.0-only
```

현재 nested checkout은 위 commit에서 clean하다. 앱 일반 build는 floating branch,
tag 또는 `latest`를 조회하지 않고 저장소의 고정 runtime을 사용한다.
`scripts/check-repository.mjs`는 WASM, ICU, JS, TypeScript binding과 Nanum Gothic
resource 3개, 총 7개 파일의 SHA-256을 검사한다.

다만 `.gitmodules`의 URL만으로 commit은 고정되지 않는다. root 최초 commit에
`vendor/typie` mode `160000` gitlink가 위 object ID로 기록되고, 새 경로 clone에서
재검증되기 전 durable pin 상태는 `FAIL — UNMET`이다.

## 5. Typie patch 목록

### Upstream checkout 내부 patch

**없음.**

`vendor/typie`의 nested worktree는 고정 commit에서 clean하고, madi 전용 commit,
dirty source 또는 적용되는 `.patch` series가 없다. Typie codec/schema를 직접
fork하지 않았다.

### Generated/derived runtime 추적 대상

- `packages/typie-runtime/browser/editor_ffi.js`
- `packages/typie-runtime/browser/editor_ffi.d.ts`
- `packages/typie-runtime/browser/editor_ffi_bg.wasm`
- `packages/typie-runtime/browser/icu.zst`
- `packages/typie-runtime/assets/*`

이는 “patch 없음”과 별개로 Typie source/license/build provenance 추적 대상이다.

### Upstream website source에서 adaptation한 파일

- `apps/desktop/src/renderer/editor/typie/input/ime-context.ts`
- `apps/desktop/src/renderer/editor/typie/input/ime-normalizer.ts`
- `apps/desktop/src/renderer/editor/typie/input/ime-input-adapter.ts`

세 파일은 upstream 원경로, exact commit과
`SPDX-License-Identifier: AGPL-3.0-only`를 header에 보존한다. upstream 내부
patch는 아니지만 수정된 Typie 계열 source이므로 upgrade와 license 검토에서
별도로 추적한다.

## 6. Adapter 경계 상태

최종 상태: **PASS**

허용된 Typie 구현 경계는 다음 하나다.

```text
apps/desktop/src/renderer/editor/typie/**
```

그 밖의 Electron UI, 저장 상태 UI, workspace orchestration, preload/shared 계약과
Rust SQLite core는 `MadiEditorAdapter`가 소유한 중립 type만 사용한다.
`scripts/check-repository.mjs`는 `apps/desktop/src` 전체에서 다음 누출을 검사한다.

- `@madi/typie-runtime` 직접 import
- generated `editor_ffi` import
- `vendor/typie` source import
- `FlatImeOp`, `PlainDoc`, `PlainNodeEntry`, `TypieEnginePort`,
  `TypieTransactionEvent` 같은 Typie/FFI type
- Rust core의 `typie::`, `editor_ffi`, vendored source 참조

검사가 스스로 무력화되지 않았는지 확인하기 위해 금지 package와 FFI type을 함께
가진 음성 fixture가 실제로 두 gate에 의해 거부되는지도 assert한다. production
composition root는 `productionEditorAdapter.factory`와 commit/schema metadata만
받고 generated binding을 직접 import하지 않는다.

이 경계는 결합도를 제한하지만 현재 renderer/WASM 결합의 법적 성격을 바꾸지는
않는다. 또한 Typie 교체 비용을 0으로 만들지 않는다. snapshot codec, IME와
render 동작은 여전히 adapter 내부의 upgrade 대상이다.

## 7. Clean install/build 결과

현재 확인된 toolchain:

| 도구 | 고정/확인 값 |
|---|---|
| Windows | Windows 10/11 x64 + Visual Studio 2022 Build Tools |
| Node.js | `v26.3.1` (`.node-version`) |
| pnpm | `11.9.0` (`packageManager`) |
| Rust/Cargo | `1.97.1`, `x86_64-pc-windows-msvc` |
| Rust targets | `x86_64-pc-windows-msvc`, `wasm32-unknown-unknown` |

현재 작업트리에서는 기존 `node_modules`, Rust `target`, Electron `dist`, package
output과 dependency cache를 제거한 뒤 다음 lockfile install이 성공했다.

```powershell
pnpm install --frozen-lockfile
```

이어 debug core, main/preload/renderer production build, Rust release sidecar와
Windows unpacked layout을 다시 만들었다. 이 결과는 “기존 생성물 없이 현재
작업트리를 다시 build할 수 있다”는 증거다.

그러나 root repository는 최초 commit 전이고 remote가 없다. 따라서 아래 절차는
아직 **실행된 결과가 아니라 최초 commit 이후 반드시 수행할 종료 gate**다.

```powershell
git clone --recurse-submodules <madi-repository-url> madi-clean
Set-Location madi-clean
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm verify
pnpm test:dev
```

현재 clean build 판정은 두 부분으로 나뉜다.

- cache/생성물을 공유하지 않는 현재 작업트리 재설치·재build: **PASS**
- committed superproject의 새 경로 clean clone 재현: **FAIL — UNMET**

또한 체크인된 runtime을 소비하는 앱 build와 Typie runtime을 source에서 다시
만드는 release build는 다르다. 후자는 `wasm-opt`과 exact tool manifest가 없어
**FAIL — UNMET**이다.

## 8. 오프라인 실행 결과

최종 상태: **PASS**

production과 Windows unpacked smoke는 Chromium network emulation을 offline으로
설정한 controlled reload 뒤 다음 lifecycle을 두 개의 실제 Electron process로
실행한다.

```text
reload offline → editor ready → 5,445자 입력 → scene break → save
→ 12자 추가 → dirty close/save handshake
→ relaunch → 같은 .madi open → snapshot/Canvas/scene break compare
```

결과:

- external runtime request: `0`
- Typie 계정/API/cloud/sync request: `0`
- madi server request: `0`
- production asset origin: local `madi://app`
- test가 의도적으로 시도한 arbitrary `file://` read: 차단
- `app.isPackaged`: unpacked 실행에서 `true`
- dirty close 저장: revision `1 → 2`, recovery `5,457 → 5,469` chars
- process restart 뒤 증가한 snapshot과 recovery가 복원됨

계측된 reload 이후 요청 URL에는 필수 외부 URL이 없었다. `data:`, `blob:`,
`devtools:`와 `madi:`는 local runtime scheme으로만 허용한다. 개발 실행의
`http://127.0.0.1:5173`은 `pnpm dev`의 loopback Vite server이며 production
runtime 의존성이 아니다.

자동 updater는 이 시제품에 구현하지 않았고, main process network guard가 허용되지
않은 navigation/request를 차단한다. 의존성 최초 설치와 Typie source checkout에
필요할 수 있는 network는 “설치·checkout 이후 runtime offline” 판정과 구분한다.
main guard는 최초 page load 전에 설치되지만 Playwright request counter와 offline
emulation은 최초 window를 얻은 뒤 controlled reload부터 시작한다. 따라서 0건은
그 이후 편집 lifecycle의 직접 계측값이며 최초 boot 전체를 계측했다고 과장하지
않는다.

## 9. `.madi` 20회 저장·복원 결과

최종 상태: **PASS**

`scripts/test-madi-endurance.mjs`는 한 fixture에 scene break 하나를 넣고, 초기
저장 뒤 20회 다음 순서를 반복한다.

```text
fresh core process load
→ fresh Typie WASM host restore
→ ordered round token append
→ snapshot/recovery extract
→ editor/host free
→ fresh core process save
→ separate load/recover/inspect processes
→ fresh Typie host restore and compare
```

검증 결과:

| 검사 | 결과 |
|---|---|
| 반복 횟수 | 20 |
| 각 회차 보고 revision | `2`부터 `21`까지 정확히 1씩 증가 |
| 저장 직전/재열기 snapshot | 매 회차 SHA-256이 같은 exact stored bytes |
| 복원 의미 | `prose_text_annotated()` canonical comparison 동일 |
| plain-text recovery | load와 독립 CLI 결과 모두 UTF-8 byte 의미 동일 |
| scene break | 매 회차 독립 의미 node 1개 유지 |
| 문서 순서 | `[회차-01]` … `[회차-20]` 순서 유지 |
| SQLite header | `SQLite format 3\0` |
| `application_id` | `0x4D414449` |
| integrity | `quick_check = ok` |
| format/schema | `madi` v0, schema v1 |
| migration | version `1` 한 건 유지 |
| editor identity | exact Typie commit, editor schema v1 유지 |

Typie snapshot은 수정할 때마다 바뀌므로 서로 다른 회차의 hash가 같을 것을 요구하지
않는다. 대신 한 회차에서 저장한 bytes와 별도 process가 읽은 bytes를 exact hash로
비교하고, 그 bytes를 새 WASM host가 복원한 canonical annotated text와 의미
scene node를 함께 비교한다. 이 방식은 storage byte 보존과 editor 의미 보존을
각각 검증한다.

## 10. Scene break 의미 보존 결과

최종 상태: **PASS**

```text
madi semantic ID: madi.scene-break.v1
Typie node mapping: horizontal_rule
Typie variant: three_diamonds
render/recovery contract: ***
```

확인한 동작:

- 장면 구분선은 `* * *`를 입력한 일반 text가 아니라 독립 Typie node다.
- editor에서는 `three_diamonds` 장식으로 표시되고 annotated recovery에서는
  읽을 수 있는 `\n\n***\n\n` marker가 된다.
- scene break 앞뒤에 text를 넣을 수 있다.
- scene node 선택 삭제, 삭제 Undo, Redo, 다시 Undo가 의미 node를 정확히
  제거·복원한다.
- Typie rich clipboard의 `data-slice-v2` HTML을 사용하면 새 editor paste와
  snapshot 복원 뒤에도 의미 node가 유지된다.
- 안정적인 Publication IR 후보 식별자는 madi 소유
  `madi.scene-break.v1`이다.

plain-text clipboard fallback은 divider의 의미 type을 보장하지 않는다. 현재
Typie plain clipboard payload는 divider를 생략하며, 외부 앱이 rich Typie slice를
보존하지 않으면 paste 뒤 scene 의미가 유지된다고 약속하지 않는다. 이것은
`docs/TYPIE_PINNING_AND_PATCHES.md`와 test report에 명시된 계약이다.

현재 adapter는 `horizontal_rule/three_diamonds`를 scene break 전용으로 예약한다.
Typie snapshot에 별도 madi tag를 fork하지 않았기 때문에 향후 장식용 일반 가로선을
제품에 추가하기 전에는 둘을 구분하는 durable metadata를 먼저 설계해야 한다.
그 전까지 같은 variant를 다른 기능이 만들면 안 된다.

## 11. Plain-text 긴급 복구 결과

최종 상태: **PASS**

Electron, React, Typie WASM 없이 Rust binary만으로 실행하는 명령은 다음과 같다.

```powershell
.\crates\madi-core\target\debug\madi-core.exe recover-plain-text `
  --file-path ".\드래곤을죽이다.madi" `
  --output ".\recovered.txt"
```

검증 결과:

- 정상 SQLite `.madi`에서 새 output 파일 생성
- 한글 UTF-8 byte 보존
- `\n\n***\n\n` scene marker 보존
- Electron dependency 없음
- 기존 output이 있으면 덮어쓰지 않고 실패
- `existing-output`, `missing-document`, `corrupt-database` 세 오류 경로에서
  원고 전체가 stdout/stderr에 나오지 않음
- 오류 뒤 기존 recovery output 내용이 바뀌지 않음
- fixture header가 일반 `SQLite format 3\0`임을 확인
- 암호화: **구현하지 않음**

`--json`은 내부 integration에서 recovery 값을 구조적으로 비교할 때 사용한다.
사용자 비상 복구에는 `--output`을 사용해 원고가 terminal/log에 노출되는 범위를
줄인다.

## 12. 자동 테스트 결과

2026-08-01 재검증 `pnpm verify` 결과: **exit code `0`**

| 순서 | 명령/범위 | 실제 최종 결과 |
|---:|---|---|
| 1 | exact Node/pnpm gate | **PASS** — Node `v26.3.1`, pnpm `11.9.0` |
| 2 | repository pin/hash/adapter 음성 gate | **PASS** — desktop source 27개, Rust core 6개 검사; 음성 fixture 거부; Typie exact commit/clean과 runtime hash 7개 확인 |
| 3 | source/JSON/Rust format check | **PASS** — 57개 파일 |
| 4 | Electron main/preload/renderer TypeScript typecheck | **PASS** |
| 5 | React/Vitest adapter·preload·safe-close·save·IME·orchestration | **PASS** — 8개 test file, 40개 test |
| 6 | Rust unit/integration tests | **PASS** — 9개(`2 + 1 + 1 + 5`), doc test 0개 |
| 7 | 실제 Typie WASM 한국어/scene/Undo/Redo/snapshot probe | **PASS** — 고정 commit runtime으로 snapshot 복원 |
| 8 | `.madi` process round-trip와 20회 endurance | **PASS** — revision `2 → 21`, `quick_check = ok` |
| 9 | scene break semantic/clipboard integration | **PASS** — `madi.scene-break.v1`, rich clipboard와 snapshot 의미 유지 |
| 10 | recovery CLI UTF-8/no-clobber/redaction | **PASS** |
| 11 | production build | **PASS** |
| 12 | 비패키지 production Electron offline/restart smoke | **PASS** — 5,445자, 4 page 전체 render, 두 번째 page pointer, IME panel 15개 `NOT TESTED`, dirty-close revision `1 → 2`, offline reload 이후 외부 request 0건, 재실행 복원 |
| 13 | Windows unpacked build와 packaged offline/restart smoke | **PASS** — `output/madi-win32-x64`, 동일한 5,445자/4 page/IME panel/dirty-close/offline/restart 검증 |

추가 개발 실행 smoke:

```powershell
pnpm test:dev
```

이 명령은 `pnpm dev`를 자식 process로 실행해 Rust debug build,
`http://127.0.0.1:5173` Vite 준비와 실제 Electron process를 확인하고 종료한다.
최종 실행 결과는 **PASS**다. native IME를 대신 입력하지는 않는다.

이 결과는 현재 exact 작업트리의 권위 있는 자동 검증 기록이다. 이후 source나
runtime artifact가 바뀌면 `pnpm verify`와 필요한 수동 gate를 다시 실행해야 한다.

## 13. 수동 IME 테스트 상태

```text
Automated IME Test screen readiness: PASS
Windows native Korean IME results: 15 / 15 NOT TESTED
Human-validated PASS items: 0
```

IME Test 화면에는 다음이 있다.

- 시험용 빈 `.madi` 생성
- 실제 snapshot 기반 autosave 상태
- Undo/Redo `최근 명령 기반 추정` 상태
- 원문/조합 문자열을 저장하지 않는 마지막 composition event type·길이·시각
- `snapshot 지금 저장`
- 완전 종료 뒤 `저장한 .madi 열기` 안내와 버튼
- 정확히 15개 수동 항목 checkbox와 별도 `FAIL`
- 초기/reset 상태 15개 모두 `NOT TESTED`
- 사람이 checkbox를 누른 항목만 `PASS`로 localStorage 저장
- Windows/Electron/IME/keyboard/display scale/date/tester 수동 환경 필드
- app/Typie/schema/platform/user-agent가 달라질 때 과거 결과를 전부
  `NOT TESTED`로 초기화하는 runtime identity gate
- 원고 본문을 포함하지 않는 JSON/Markdown 결과 export

실제 실행:

```powershell
pnpm dev

# 또는 unpacked build
pnpm package:unpacked
& .\output\madi-win32-x64\madi.exe
```

Vitest, Playwright `fill`, `pressSequentially`, composition event unit test는 실제
Windows native 한국어 IME와 한글/Word clipboard를 검증하지 않는다. 따라서
사람이 `docs/MANUAL_KOREAN_IME_CHECKLIST.md`를 수행하고 환경 metadata와 export를
보존하기 전 M-01은 `FAIL — UNMET / NOT TESTED`다.

## 14. 남은 빌드·런타임 위험

1. **Durable source pin:** root 최초 commit과 mode `160000` gitlink가 없다.
   현재 nested HEAD는 맞지만 새 clone 재현 증거가 아니다.
2. **Runtime source build:** exact Binaryen version과 `wasm-opt`을 포함한
   end-to-end script, 두 clean build의 비교가 없다.
3. **장편 성능:** 5,445자/4 page 기능 smoke는 통과했지만 현실적인 장편,
   장시간 편집, DPI·다중 monitor별 latency/memory 허용 기준이 없다.
4. **Crash 안전성:** SQLite transaction, revision, backup rotation test는 있으나
   저장 단계별 process kill/power-loss fault injection은 없다.
5. **접근성:** screen reader, keyboard-only 편집 계약과 실제 native candidate
   window 위치를 확인하지 않았다.
6. **History 상태:** public history-stack query가 없어 Undo/Redo UI는 최근 command
   기반 보수적 추정이다. UI가 이 사실을 표시하지만 authoritative 상태는 아니다.
7. **Packaging 범위:** unpacked Windows folder와 packaged-layout smoke만
   검증했다. 실제 installer/installed-state smoke는 `FAIL — UNMET`이며 MSIX/NSIS,
   code signing, notarization과 updater는 없다. 자동 업데이트는 이번 단계에서
   의도적으로 구현하지 않았다.
8. **Snapshot 범위:** CRDT graph는 저장하지만 selection, viewport, 진행 중
   composition과 재시작 전 Undo stack은 복원하지 않는다.
9. **Plain clipboard:** 외부 앱의 plain-text paste는 scene break 의미 node를
   보존한다고 약속하지 않는다.

## 15. Typie upstream 업데이트 위험

Typie API는 private `0.0.1` generated binding이며 semver 호환성을 보장하지 않는다.
commit 변경은 일반 dependency bump가 아니라 다음을 함께 검토하는 migration
후보다.

- generated `.d.ts`/JavaScript/WASM API
- message/transaction 동작
- changeset snapshot codec와 과거 `.madi`
- `horizontal_rule/three_diamonds` 의미
- Canvas surface/resource protocol
- IME context/normalizer/adapter 원본과 madi adaptation
- ICU/font asset와 hash
- license/notice와 별도 license의 version 범위

`docs/TYPIE_PINNING_AND_PATCHES.md`에는 후보 commit, 과거 fixture, adapter gate,
20회 round-trip, recovery, scene break, production/package smoke와 native IME
재검증을 한 승인 단위로 묶는 절차가 있다. 그러나 실제 후보 commit으로 이
절차를 rehearsal하지 않았고 commit 간 snapshot migration도 없다.

따라서 다음 upgrade 전에는 현재 runtime과 fixture를 보존하고, 후보가 과거
snapshot을 열지 못하면 조용히 저장·변환하지 말아야 한다. compatibility guard로
안전하게 거부하고 plain-text recovery를 제공한 상태에서 명시적 migration이
마련될 때까지 기존 pin을 유지한다.

## 16. 라이선스 미결정 사항

최종 상태: **HUMAN DECISION REQUIRED**

현재 승인된 option은 없다.

| 경로 | 현재 의미 |
|---|---|
| Option A — madi를 AGPL 호환 오픈소스로 배포 | 현재 결합을 유지할 수 있는 후보지만 covered/combined work 범위, madi root license, Corresponding Source/build 정보와 전체 notice를 법률 검토해야 한다. |
| Option B — Typie 권리자와 별도 license | 서명된 계약이 exact commit, WASM/binding, IME adaptation, closed-source·유료 배포와 upgrade를 실제로 허용해야 한다. 협상 중 상태는 승인이 아니다. |
| Option C — 생산 editor 독립 구현/다른 엔진 | 현재 Typie runtime, binding, adapted IME와 전용 통합을 production에서 제거하고 법률 검토를 받은 독립 구현 절차가 필요하다. wrapper 이름 변경만으로는 충분하지 않다. |

공통 미결 사항:

- madi root code는 현재 `UNLICENSED`이고 최종 `LICENSE`가 없다.
- `THIRD_PARTY_NOTICES.md`는 transitive npm/Rust/Electron dependency 전체를
  release 기준으로 완전히 생성한 SBOM/license report가 아니다.
- `wasm-opt` 포함 Corresponding Source/build 절차가 없다.
- 선택 owner, 법률 reviewer, 법인/관할, 배포 채널, 수익화, 적용 Typie version과
  서명이 없다.

결정 전 허용 범위는 로컬 기술검증, 같은 조직 안의 제한된 평가, 수동 IME 검사와
삭제 가능한 unpacked smoke다. public download, 고객/유료 pilot, app store,
package registry와 proprietary production 배포는 승인되지 않는다.

이 절은 법률 자문이 아니다. 상세 비교와 필요한 결정 기록은
`docs/LICENSE_DECISION_REQUIRED.md`를 따른다.

## 17. 다음 Phase로 넘어가기 위한 정확한 조건

Phase 1 제품 기능 구현 진입은 현재 **승인하지 않는다**. 아래 조건 중 최종 자동
gate만 현재 통과했고 나머지는 열려 있다. 모두 통과·유지한 뒤 기술 판정과
제품/법률 gate를 다시 내려야 한다.

1. **최종 자동 gate — PASS, 유지 필요:** 2026-08-01 현재 작업트리 재검증에서
   `pnpm verify` exit code `0`, `pnpm test:dev` PASS를 기록했다. source/runtime
   변경 뒤에는 다시 통과해야 한다.
2. **Durable pin — FAIL — UNMET:** 사람이 최초 commit에 `.gitmodules`와
   `vendor/typie` mode `160000` gitlink
   `fbe5c4bf860d1717a66e66bea2374a2e39f0dd26`을 기록해야 한다.
3. **진짜 clean clone — FAIL — UNMET:** 원격의 새 빈 경로에서
   `git clone --recurse-submodules`, `pnpm install --frozen-lockfile`,
   `pnpm verify`, `pnpm test:dev`를 재현해야 한다.
4. **Reproducible Typie runtime — FAIL — UNMET:** exact
   Rust/wasm-bindgen/editor-bindgen/ICU/font, zstd/Binaryen version과 `wasm-opt`
   명령을 script에 고정하고 두 clean build와 전체 runtime probe를 비교해야 한다.
5. **Installed-state — FAIL — UNMET:** 지원할 installer로 깨끗한 Windows 사용자
   환경에 설치한 뒤 설치 경로에서 입력·저장·완전 종료·재실행·복원·offline smoke를
   반복하고, 설치 경로 권한과 제거 뒤 사용자 `.madi` 보존을 확인해야 한다.
6. **사람 IME — FAIL — UNMET, 15/15 NOT TESTED:** 실제 Windows native IME와
   한글/Word 앱으로 15개 항목을 수행해 환경 metadata와 JSON/Markdown export를
   보존해야 한다. 중복·누락·조합 손상, 저장·완전 종료·복원에 해결되지 않은
   실패가 없어야 한다.
7. **현실 규모 — FAIL — UNMET:** 합의한 장편 fixture와 지원 DPI/monitor 환경에서
   input/render, 저장 latency와 peak/steady memory 허용 기준을 정하고 통과해야
   한다.
8. **Crash recovery — FAIL — UNMET:** 저장/backup 주요 경계에서 강제 종료 fault
   injection을 수행하고 원본/backup의 `quick_check`, revision,
   snapshot/recovery 회수 절차를 통과해야 한다.
9. **접근성/후보창 — FAIL — UNMET:** 지원할 Windows 접근성 범위를 정하고 실제 screen
   reader, keyboard-only와 native IME candidate window 위치를 확인해야 한다.
10. **Upgrade rehearsal — FAIL — UNMET:** 현재 commit의 과거 snapshot fixture를 실제 후보
   commit gate에 넣어 호환 또는 안전한 거부/복구를 증명해야 한다.
11. **License와 배포 — HUMAN DECISION REQUIRED:** 제품 책임자와 법률 전문가가
    Option A/B/C 중 하나를 서면 승인하고 source/계약/독립 구현 증거, 전체
    notice와 허용 배포 범위를 release gate에 연결해야 한다.

위 조건을 닫는 동안 허용되는 다음 작업은 engine-risk retirement, test,
reproducibility, manual validation과 license 의사결정 지원뿐이다. 다음 기능은
여전히 구현하면 안 된다.

- 완성형 Binder와 권·화·장면 CRUD
- 세계관 설정·관계 그래프·플롯 Canvas
- Reader Lab
- EPUB, HWP/HWPX export
- LLM adapter
- Dropbox, MYBOX, NAS, sync
- 자동 업데이트
- production 디자인, 회원가입, server, cloud, collaboration
- 모바일 앱과 웹 앱
- Typie 제품 UI 복사

Phase 0.5의 목적은 editor engine 채택 조건을 닫는 것이며, 위 제품 기능을 먼저
추가해 열린 저장·입력·재현·license 위험을 가리는 것이 아니다.
