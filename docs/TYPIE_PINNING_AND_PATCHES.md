# Typie 고정과 patch 관리

## 목적과 기준

이 문서는 madi가 사용하는 Typie source와 runtime 산출물의 정확한 출처, 현재
고정 상태, upstream 내부 patch 유무와 향후 upgrade 절차를 정의한다. 일반적인 앱
build는 임의의 Typie branch나 최신 release를 조회하지 않고, 아래 commit에서 만든
저장소 내 runtime 산출물을 사용한다.

- Repository: `https://github.com/penxle/typie`
- Exact commit:
  `fbe5c4bf860d1717a66e66bea2374a2e39f0dd26`
- 의도한 source 연결 방식: Git submodule
- Source 경로: `vendor/typie`
- Submodule 선언: `.gitmodules`
- Runtime 경로: `packages/typie-runtime`
- Runtime manifest: `packages/typie-runtime/BUILD_INFO.json`
- 보수적 license 표기: `AGPL-3.0-only`

40자 commit 전체가 고정값이다. tag, branch, abbreviated commit 또는 `latest`는
고정값을 대체하지 않는다.

## 2026-08-01 Phase 0.5 작업트리의 실제 상태

| 항목 | 상태 | 근거 |
|---|---|---|
| nested Typie checkout HEAD | **PASS** | `git -C vendor/typie rev-parse HEAD`가 정확한 고정 commit을 반환한다. |
| nested Typie checkout clean 여부 | **PASS** | `git -C vendor/typie status --porcelain`과 nested diff가 비어 있다. |
| `.gitmodules` 경로와 URL | **PASS** | `vendor/typie`, `https://github.com/penxle/typie.git`을 선언한다. |
| `BUILD_INFO.json` commit/license | **PASS** | 고정 commit과 `AGPL-3.0-only`를 기록한다. |
| 배포 후보 runtime hash | **PASS** | `scripts/check-repository.mjs`가 7개 runtime 파일을 SHA-256으로 검사한다. |
| superproject의 tracked gitlink | **아직 없음** | madi root 저장소에 최초 commit/`HEAD`가 없고 `vendor/typie`의 mode `160000` index 항목도 없다. |
| upstream Typie 내부 patch | **없음** | nested checkout이 고정 commit에서 clean이며 별도 patch commit이나 `.patch` 파일을 적용하지 않았다. |
| `wasm-opt` 포함 end-to-end 재빌드 | **미완료** | 현재 runtime은 upstream release recipe의 최종 `wasm-opt` 단계를 거치지 않았다. |

현재 작업트리에서 source와 산출물은 정확히 고정돼 있지만, `.gitmodules`만으로는
향후 clone이 어느 commit을 checkout할지 정하지 못한다. 그 commit은
superproject가 mode `160000` gitlink로 기록해야 한다. 현재 madi 저장소에는 아직
`HEAD`가 없으므로 “지금 nested checkout이 맞다”와 “향후 clone이 같은 checkout을
복원한다”를 구분해야 한다.

따라서 durable submodule pin은 **최초 사람이 만드는 superproject commit에 반드시
포함해야 한다**. 이 Phase 0.5 작업은 자동으로 commit하거나 staging하지 않는다.

최초 commit 전 사람이 확인할 명령은 다음과 같다.

```powershell
git -C vendor/typie rev-parse HEAD
git -C vendor/typie status --porcelain

git add .gitmodules vendor/typie
git ls-files --stage vendor/typie
git diff --cached --submodule=log -- .gitmodules vendor/typie
```

`git ls-files --stage vendor/typie`의 mode는 `160000`, object ID는
`fbe5c4bf860d1717a66e66bea2374a2e39f0dd26`이어야 한다. 최초 commit 뒤에는 다음
명령도 통과해야 한다.

```powershell
git ls-tree HEAD vendor/typie
git submodule status --recursive
```

이 단계가 끝나기 전 B-01의 durable pin은 `PASS`로 올리지 않는다.

## checkout과 bootstrap 계약

정상적인 committed 저장소에서는 다음 경로가 기준이다.

```powershell
git clone --recurse-submodules <madi-repository-url> madi
Set-Location madi
git submodule update --init --recursive
git -C vendor/typie rev-parse HEAD
```

현재처럼 superproject gitlink가 아직 없는 최초 구성 작업트리에서는
`scripts/bootstrap-typie.ps1`을 사용한다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts/bootstrap-typie.ps1
```

bootstrap script는 다음 계약을 지킨다.

1. `vendor/typie`가 이미 Git checkout이면 정확한 HEAD와 clean 상태를 검사한다.
2. 다른 commit 또는 dirty checkout을 자동으로 덮어쓰지 않고 실패한다.
3. 경로가 비어 있으면 고정 repository를 clone하고 정확한 commit을 detached
   checkout한다.
4. floating branch를 checkout하거나 upstream 최신 commit으로 갱신하지 않는다.

이 script는 현재 작업트리를 준비하는 보조 수단이다. superproject의 mode `160000`
gitlink를 대신 기록하지 않으며, gitlink가 존재하는 정상 clone에서는
`git submodule update --init --recursive`가 우선이다.

## runtime manifest와 hash gate

`packages/typie-runtime/BUILD_INFO.json`은 source identity와 생성 산출물 identity를
함께 고정한다.

| 파일 | SHA-256 |
|---|---|
| `browser/editor_ffi_bg.wasm` | `c6cc7d32cebfe3d3e48b3c79e60de0e28a815761f68779fdec415217425ee939` |
| `browser/icu.zst` | `050e08ceebfa8d92f583b80bb31fcb6a792a760ffa821deb3f2316c12ad578f0` |
| `browser/editor_ffi.js` | `eb8707d22e9d2c1a89bbd132a2ac6d19b47938baa53462c623335a7e0030b745` |
| `browser/editor_ffi.d.ts` | `41b7e24429e892b2df4f2be0ee07948cae25a2a7f2a8ce672ea60bba94404851` |
| `assets/NanumGothic-Regular.base.zst` | `54418892219582d1d1334f79ad5fc7fdc74d646464beb0d9bcb600ebacb08517` |
| `assets/NanumGothic-Regular.manifest.zst` | `81424decc8cebe05ac5c4597248648d0f5416742acfcc25c22990e75537e3ca5` |
| `assets/NanumGothic-Regular.chunk-0.zst` | `489e66dc686591b671f3b14c00cde16922b62b63e06f0563ca5695c6c5101502` |

Nanum Gothic source identity, engine font hash와 license도 `BUILD_INFO.json`,
`NANUM_GOTHIC_LICENSE.txt`에 별도로 기록한다. hash manifest 자체와 binary를 함께
바꾸는 실수를 막기 위해, runtime 갱신은 반드시 code review에서 source commit,
생성 명령, binary diff와 새 hash를 한 묶음으로 검토한다.

현재 자동 gate:

```powershell
node scripts/check-repository.mjs
```

이 gate는 다음을 검사한다.

- nested checkout이 정확한 commit이며 clean인지
- `.gitmodules`의 path와 URL이 맞는지
- `BUILD_INFO.json`의 repository, commit과 license가 맞는지
- 위 7개 runtime 파일의 SHA-256이 manifest와 일치하는지
- 앱 source의 Typie import/type이 Typie adapter 구현 경계 밖으로 새지 않는지
- Rust storage core가 Typie 내부 구현에 직접 의존하지 않는지

root 저장소에 최초 commit이 생기기 전에는 gitlink 검사가 불가능하므로, 최초
commit review에서 mode `160000` 확인을 별도 필수 gate로 수행한다.

## patch와 adaptation inventory

### 1. `vendor/typie` 내부 patch

**없음.**

- `vendor/typie`는 upstream exact commit의 clean detached checkout이다.
- nested repository에 madi 전용 commit을 추가하지 않았다.
- nested source를 직접 수정하지 않았다.
- upstream 위에 적용하는 별도 `.patch` series도 없다.

향후 upstream 내부 수정이 필요해지면 암묵적으로 working tree를 수정하지 않는다.
고정 base commit, patch 파일, patch 목적, affected crate/API, license provenance와
재생성 산출물 hash를 이 문서에 추가해야 한다.

### 2. upstream에서 생성해 보존한 산출물

다음은 upstream 내부 patch는 아니지만 Typie source에서 생성된 배포 대상
산출물이므로 source commit 및 license 추적 대상이다.

- `packages/typie-runtime/browser/editor_ffi.js`
- `packages/typie-runtime/browser/editor_ffi.d.ts`
- `packages/typie-runtime/browser/editor_ffi_bg.wasm`
- `packages/typie-runtime/browser/icu.zst`
- Typie resource protocol로 만든 `packages/typie-runtime/assets/*`

generated 파일이라는 이유로 Typie와 무관한 madi 독립 코드로 분류하지 않는다.

### 3. upstream source에서 adaptation한 madi 파일

다음 세 파일은 고정 commit의
`apps/website/src/lib/editor-ffi/input/` 구현을 madi host에 맞게 adaptation했다.
각 파일 header에 upstream 경로, exact commit과 `SPDX-License-Identifier:
AGPL-3.0-only`를 보존한다.

- `apps/desktop/src/renderer/editor/typie/input/ime-context.ts`
- `apps/desktop/src/renderer/editor/typie/input/ime-normalizer.ts`
- `apps/desktop/src/renderer/editor/typie/input/ime-input-adapter.ts`

이 파일은 `vendor/typie`를 dirty하게 만드는 내부 patch는 아니지만, license와
upgrade 관점에서는 **수정된 Typie 계열 source**로 추적한다. upgrade 때 upstream
대응 파일의 diff를 수동으로 검토하고 단순 복사로 덮어쓰지 않는다.

### 4. madi가 외부 adapter 경계에 작성한 통합 코드

다음 파일은 `vendor/typie` 밖에 있고 madi adapter 구조를 구현한다.

| 파일 | 책임 |
|---|---|
| `renderer/editor/MadiEditorAdapter.ts` | Typie type을 노출하지 않는 madi 소유의 중립 editor 계약과 scene-break semantic ID |
| `renderer/editor/typie/TypieEditorAdapter.ts` | madi 계약을 Typie engine port 명령으로 변환 |
| `renderer/editor/typie/createTypieEnginePort.ts` | generated binding, WASM, ICU/font, Canvas surface와 입력 event 연결 |
| `renderer/editor/typie/runtimeRegistry.ts` | production runtime factory 등록과 test 대체 경계 |
| `renderer/editor/typie/productionAdapter.ts` | composition root에 madi 소유 factory/metadata만 노출 |
| `renderer/editor/typie/sceneBreakMapping.ts` | `madi.scene-break.v1`과 Typie `horizontal_rule/three_diamonds` mapping 고정 |

위 목록은 “법적으로 파생물이 아니다”라는 결론이 아니다. renderer가 generated
binding과 같은 address space에서 강하게 결합되는 현재 구조의 license 판단은
`docs/TYPIE_LICENSE_IMPACT.md`와 `docs/LICENSE_DECISION_REQUIRED.md`에 유보한다.

## 현재 runtime 재빌드 recipe와 남은 위험

현재 runtime은 exact commit source에서 다음 계열의 절차로 만들었다.

1. `wasm32-unknown-unknown`의 `release-wasm-browser` profile로
   `editor-ffi` build
2. Typie `editor-bindgen`이 감싼 `wasm-bindgen-cli --target module`
3. `editor-bindgen-js`로 `createInstance(wasmModule)` binding 생성
4. compiled WASM marker 기반 ICU4X data 생성
5. source-built Typie server WASM의 `EditorServer.get_font_codepoints`와
   `EditorServer.build_font`로 font asset 생성
6. `scripts/build-typie-font.mjs`로 madi runtime asset 배치

그러나 build 환경에 Binaryen `wasm-opt`이 없었기 때문에 upstream release
recipe의 다음 최종 단계는 수행하지 않았다.

```text
wasm-opt -Os --all-features
```

따라서 현재 상태는 다음처럼 구분한다.

- 체크인된 runtime을 소비하는 앱 build와 hash 검증: 가능
- 고정 source에서 기능 검증용 browser runtime 생성: 수행됨
- `wasm-opt`을 포함한 upstream release recipe의 end-to-end 자동 재현: **미완료**
- 두 clean build의 byte-for-byte reproducibility와 tool version manifest:
  **미검증**

현재 source tree에는 font 생성 보조 script가 있지만, Rust target,
`wasm-bindgen`, editor-bindgen, ICU4X, zstd와 정확한 Binaryen version까지 한 번에
bootstrap하고 두 번 재현하는 release script는 없다. 이 상태에서 runtime hash가
source에서 언제든 동일하게 재생성된다고 주장하지 않는다. 또한
Corresponding Source 제공 범위와 build script 충분성은 별도 법률 검토가
필요하다.

`wasm-opt`을 새로 적용하면 WASM hash와 크기가 달라지는 것이 정상이다. 기존
manifest hash를 억지로 유지하지 말고, 정확한 tool version·명령·출력 hash를
새 build record로 남긴 뒤 전체 probe, snapshot fixture와 Electron 검증을 다시
수행해야 한다.

## Typie commit upgrade 절차

Typie upgrade는 일반 package version bump가 아니다. private generated API,
snapshot codec, IME, render와 scene-break 의미를 함께 바꾸는 compatibility
작업이다.

1. 현재 exact commit, runtime hash와 과거 `.madi`/snapshot fixture corpus를
   보존하고 `pnpm verify` baseline을 기록한다.
2. 후보 commit을 40자 hash로 지정한다. branch HEAD를 pin으로 사용하지 않는다.
3. 후보 source의 license/notice, Cargo feature, generated `.d.ts`, browser
   binding, codec과 schema diff를 검토한다.
4. 세 IME adaptation 원본과 madi adaptation의 차이를 수동 review하고 provenance
   header를 갱신한다.
5. 고정된 Rust/Node/build tool과 정확한 Binaryen `wasm-opt` version을 사용해
   WASM, binding, ICU와 font asset을 clean 환경에서 다시 만든다.
6. `BUILD_INFO.json`, runtime hash, submodule gitlink와 이 patch inventory를 한
   후보 변경으로 갱신한다.
7. adapter boundary negative gate, TypeScript/Rust test, 실제 Typie probe,
   20회 `.madi` round-trip, recovery CLI, scene-break semantic/clipboard,
   production 및 packaged Electron smoke를 모두 수행한다.
8. 이전 commit에서 만든 snapshot corpus를 후보 runtime으로 연다. 지원하지
   못하면 조용히 변환하지 말고 compatibility guard와 plain-text recovery로
   안전하게 거부하며, 명시적인 migration이 마련될 때까지 upgrade를 승인하지
   않는다.
9. Windows native 한국어 IME와 외부 한글/Word clipboard checklist를 사람이
   다시 수행한다. 자동 테스트가 수동 결과를 `PASS`로 바꾸면 안 된다.
10. `THIRD_PARTY_NOTICES.md`, license 결정 기록, engine map과 실제 build 명령을
    갱신한다.
11. code review에서 superproject gitlink, `BUILD_INFO.json`, generated artifact,
    adaptations, tests와 문서를 함께 승인한다. 일부만 먼저 merge하지 않는다.

후보가 실패하면 기존 gitlink와 runtime artifact를 그대로 유지한다. 실패한
candidate snapshot을 사용자 문서에 저장하거나 기존 `.madi`를 현장에서
마이그레이션하지 않는다.

## Phase 0.5 종료 판단에 미치는 영향

- 현재 exact checkout, clean upstream, manifest와 runtime hash gate는 확인됐다.
- upstream 내부 patch가 없고 외부 adaptation/adapter 목록은 이 문서로
  추적된다.
- durable submodule pin은 root 최초 commit의 mode `160000` gitlink가 생기기
  전까지 사람이 완료해야 하는 repository action이다.
- `wasm-opt` 포함 end-to-end 재현 build와 과거 snapshot을 대상으로 한 실제
  후보 commit upgrade는 여전히 열린 조건이다.

이 문서는 Phase 1 기능 구현을 허가하지 않는다. Binder, 플롯, Reader Lab, export,
sync, LLM 등 제품 기능을 추가하기 전에 고정·upgrade·license gate를 별도로
통과해야 한다.
