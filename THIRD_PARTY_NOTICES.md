# Third-Party Notices

이 파일은 Phase 1F 저장소에서 직접 포함하거나 주요 runtime/build dependency로
사용하는 제3자 자료를 요약한다. 각 license 원문이 우선하며, 이 요약은 license
조건을 대체하지 않는다.

```text
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Public/paid/customer distribution: NOT AUTHORIZED
```

## Typie

- Project: Typie and its affiliated softwares
- Copyright notice: `Copyright (C) 2025 PENXLE COMPANY`
- Repository: `https://github.com/penxle/typie`
- Exact commit: `fbe5c4bf860d1717a66e66bea2374a2e39f0dd26`
- Source submodule: `vendor/typie`
- Runtime package: `packages/typie-runtime`
- Production Rust bridge: `crates/madi-publication`
- madi runtime metadata/hashes: `packages/typie-runtime/BUILD_INFO.json`
- madi package license declaration: `AGPL-3.0-only`

포함한 자료:

- `packages/typie-runtime/browser/editor_ffi.js`
- `packages/typie-runtime/browser/editor_ffi.d.ts`
- `packages/typie-runtime/browser/editor_ffi_bg.wasm`
- `packages/typie-runtime/browser/icu.zst`
- `packages/typie-runtime/assets/*`
- `vendor/typie/crates/editor-codec`
- `vendor/typie/crates/editor-crdt`
- `vendor/typie/crates/editor-model`
- `vendor/typie/crates/editor-state`

Phase 1F production sidecar는 `madi-publication` 안에서 위 네 Typie Rust crate를 직접
compile한다. 이 private bridge는 pinned changeset stream을 lossless decode하고 madi 소유
Publication DTO로 변환하며 Typie Rust type을 core/RPC/renderer에 노출하지 않는다. 이
경계는 결합 범위를 줄일 뿐 Typie code의 license 의무나 아래 배포 판단을 없애지 않는다.

upstream source에서 adaptation한 IME 파일:

- Upstream:
  `vendor/typie/apps/website/src/lib/editor-ffi/input/ime-context.ts`
- Upstream:
  `vendor/typie/apps/website/src/lib/editor-ffi/input/ime-normalizer.ts`
- Upstream:
  `vendor/typie/apps/website/src/lib/editor-ffi/input/ime-input-adapter.ts`
- Adapted:
  `apps/desktop/src/renderer/editor/typie/input/ime-context.ts`
- Adapted:
  `apps/desktop/src/renderer/editor/typie/input/ime-normalizer.ts`
- Adapted:
  `apps/desktop/src/renderer/editor/typie/input/ime-input-adapter.ts`

GNU Affero General Public License Version 3 원문 위치:

- `vendor/typie/LICENSE`
- `packages/typie-runtime/LICENSE`

두 파일은 현재 exact SHA-256
`e66addfa3ea117efa8ae4071512d3f47aa56646d2546d7f7e02f32e386feb087`로
byte-identical하다. Unpacked package는 `packages/typie-runtime/LICENSE`를
`resources/licenses/TYPIE-AGPL-3.0.txt`로 복사하므로 browser runtime과 production
Rust bridge가 사용하는 pinned Typie source의 원문 경로가 같다.

upstream manifest에는 확인한 범위에서 명시적인 SPDX “only”/“or later” field가 없어,
이 저장소는 보수적으로 `AGPL-3.0-only`로 기록한다. 자세한 판단 유보와 배포 경로는
`docs/TYPIE_LICENSE_IMPACT.md`를 참고한다.

## Nanum Gothic

- Font: Nanum Gothic Regular
- Source:
  `https://github.com/google/fonts/tree/main/ofl/nanumgothic`
- License: SIL Open Font License 1.1
- License text: `packages/typie-runtime/NANUM_GOTHIC_LICENSE.txt`
- Runtime assets:
  - `packages/typie-runtime/assets/NanumGothic-Regular.base.zst`
  - `packages/typie-runtime/assets/NanumGothic-Regular.manifest.zst`
  - `packages/typie-runtime/assets/NanumGothic-Regular.chunk-0.zst`
- Source 및 runtime hashes:
  `packages/typie-runtime/BUILD_INFO.json`

font asset의 madi 내부 family 이름은 Phase 0 Typie 기본 font slot에 맞춘 기술적
mapping이며, 원래 font 저작권·이름 또는 OFL 조건을 변경하지 않는다.

## Cytoscape.js

- Project: Cytoscape.js
- Package: `cytoscape`
- Exact version: `3.34.0`
- Repository: `https://github.com/cytoscape/cytoscape.js`
- License: MIT
- Runtime role: Phase 1D World Graph의 renderer 전용 시각화와 내장 `cose` layout
- License text: packaged artifact의
  `resources/licenses/CYTOSCAPE-MIT.txt`

Phase 1D는 별도 layout extension을 추가하지 않고 Cytoscape.js에 포함된 `cose`를
사용한다. Cytoscape element와 instance는 renderer 내부 파생 표현이며 Rust core,
preload 계약 또는 Story Bible canonical 저장 모델에 포함하지 않는다.

## React Flow

- Project: React Flow
- Package: `@xyflow/react`
- Exact version: `12.11.2`
- Repository: `https://github.com/xyflow/xyflow`
- License: MIT
- Copyright notice: `Copyright (c) 2019-2025 webkid GmbH`
- Runtime role: Phase 1E Plot Canvas의 renderer 전용 interaction/visualization
- License text: packaged artifact의
  `resources/licenses/REACT-FLOW-MIT.txt`

Version은 `apps/desktop/package.json`과 `pnpm-lock.yaml`에 exact `12.11.2`로 고정한다.
React Flow `Node`, `Edge`, instance와 event는 renderer runtime 파생 표현이며 Rust core,
SQLite, preload 공개 계약 또는 named snapshot payload에 포함하지 않는다. 저장 계약은
JSON Canvas 1.0 기반 `MadiCanvasDocument`다.

## JSON Canvas

- Project/specification: JSON Canvas
- Specification version: `1.0` (2024-03-11)
- Specification: `https://jsoncanvas.org/spec/1.0/`
- Repository: `https://github.com/obsidianmd/jsoncanvas`
- License: MIT
- Copyright notice: `Copyright (c) 2024 Obsidian.md`
- Repository license text: `docs/licenses/JSON-CANVAS-MIT.txt`
- Packaged license text: `resources/licenses/JSON-CANVAS-MIT.txt`

JSON Canvas는 npm runtime dependency가 아니라 Canvas 저장·import/export 구조의 기준
specification이다. Madi는 표준 `text`/`group` node와 edge를 사용하고 `madi` extension으로
entity/SCENE reference와 line style을 표현한다. 지원 범위와 strict-conformance 차이는
`docs/JSON_CANVAS_COMPATIBILITY.md`를 따른다.

## 주요 npm dependency

정확한 direct dependency와 version range:

- Root: `package.json`
- Desktop: `apps/desktop/package.json`
- Typie runtime package metadata: `packages/typie-runtime/package.json`

해결된 전체 npm dependency graph와 integrity:

- `pnpm-lock.yaml`

주요 runtime/build/test package:

| Package | 역할 | 일반적 license 표기 |
|---|---|---|
| Electron | Windows desktop runtime | MIT |
| React / React DOM | renderer UI | MIT |
| Cytoscape.js 3.34.0 | World Graph renderer와 `cose` layout | MIT |
| `@xyflow/react` 12.11.2 | Plot Canvas renderer | MIT |
| Vite / `@vitejs/plugin-react` | renderer/preload bundle | MIT |
| TypeScript | compile/typecheck | Apache-2.0 |
| Vitest | unit test | MIT |
| Testing Library React | React test | MIT |
| jsdom | DOM test environment | MIT |
| `playwright-core` | Electron smoke automation | Apache-2.0 |
| concurrently / cross-env / wait-on | development orchestration | MIT |

위 표는 편의를 위한 요약이며 transitive dependency 전체 notice가 아니다. 설치된
각 package의 실제 license metadata와 원문은 pnpm virtual store의 해당 package
directory(`node_modules/.pnpm/.../node_modules/<package>/LICENSE*`)에서 확인한다.
배포 artifact를 만들기 전 `pnpm-lock.yaml` 기준으로 production dependency 전체의
license/notice를 다시 생성·검토해야 한다.

검토 보조 명령:

```powershell
pnpm licenses list --prod
```

이 명령의 출력은 현재 저장소에 별도 고지 파일로 고정돼 있지 않다.

## 주요 Rust dependency

`madi-core` 직접 production dependency:

- `base64`
- `clap`
- `rusqlite` with bundled SQLite
- `serde`
- `serde_json`
- `sha2` 0.10.9
- `thiserror`
- `uuid`
- local `madi-publication`

`madi-publication` 직접 production dependency:

- pinned local Typie `editor-codec`, `editor-crdt`, `editor-model`, `editor-state`
- `serde`, `serde_json`
- `sha2` 0.10.9
- `thiserror` 2.0.18

`madi-core`은 `thiserror` 1.0.69를 사용한다. `sha2`는 core의 canonical
document/snapshot/Canvas/Reader preset hash와 publication source/block/document hash에
사용되는 production dependency다. `thiserror`는 두 crate의 typed Rust error derive에만
사용하며 runtime plugin이나 executable content를 로드하지 않는다.

Resolved registry attribution과 license metadata:

| Crate | Resolved version | Upstream attribution | License | Registry 원문 |
|---|---:|---|---|---|
| `sha2` | 0.10.9 | RustCrypto Developers; license notice의 Graydon Hoare, Mozilla Foundation, Artyom Pavlov | MIT OR Apache-2.0 | `sha2-0.10.9/LICENSE-MIT`, `LICENSE-APACHE` |
| `thiserror` | 1.0.69 | David Tolnay | MIT OR Apache-2.0 | `thiserror-1.0.69/LICENSE-MIT`, `LICENSE-APACHE` |
| `thiserror` | 2.0.18 | David Tolnay | MIT OR Apache-2.0 | `thiserror-2.0.18/LICENSE-MIT`, `LICENSE-APACHE` |

Checked-in crate별 license 원문과 exact SHA-256는 다음과 같다. `sha2` 두 파일은 locked
0.10.9 registry 원문과, `thiserror` 두 파일은 locked 1.0.69와 2.0.18 양쪽의 동일한
registry 원문과 각각 byte-identical하다.

- `docs/licenses/SHA2-MIT.txt` →
  `b4eb00df6e2a4d22518fcaa6a2b4646f249b3a3c9814509b22bd2091f1392ff1`
- `docs/licenses/SHA2-APACHE-2.0.txt` →
  `a9040321c3712d8fd0b09cf52b17445de04a23a10165049ae187cd39e5c86be5`
- `docs/licenses/THISERROR-MIT.txt` →
  `23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3`
- `docs/licenses/THISERROR-APACHE-2.0.txt` →
  `62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a`
- Packaged paths use the same four basenames under `resources/licenses/`.

test dependency:

- pinned local Typie editor test helpers
- `tempfile`

manifest와 정확한 resolved version:

- `crates/madi-core/Cargo.toml`
- `crates/madi-core/Cargo.lock`
- `crates/madi-publication/Cargo.toml`

crate별 license 원문은 Cargo가 받은 registry source의 각 crate
directory(`$CARGO_HOME/registry/src/.../<crate-version>/LICENSE*`)를 따른다.
주요 crate는 MIT 또는 MIT/Apache-2.0 dual-license 계열이지만, 정확한 조건은
고정된 각 version의 package metadata와 원문으로 확인한다.

`rusqlite`의 `bundled` feature는 `libsqlite3-sys`를 통해 SQLite를 함께 build한다.
SQLite 자체의 public-domain dedication과 Rust wrapper의 license는 구분해
검토해야 한다.

검토 보조 명령:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/cargo.ps1 `
  tree --manifest-path crates/madi-core/Cargo.toml
```

현재 unpacked package는 `THIRD_PARTY_NOTICES.md`, Typie/Nanum/Cytoscape/React Flow/JSON
Canvas 원문과 위 네 Rust crate license 원문을 `resources/licenses`에 복사한다. Package
script는 checked-in source와 packaged copy를 위 SHA-256에 대조해 mismatch를 거부한다.
Rust transitive dependency 전체의 자동 license report는 아직 생성하지 않으므로
production 배포 전 `Cargo.lock` 기준 report를 계속 검토해야 한다. 이 원문 포함은 위
Typie `HUMAN DECISION REQUIRED`보다 배포 권한을 넓히지 않는다.

## madi 자체 코드

`crates/madi-core/Cargo.toml`과 `crates/madi-publication/Cargo.toml`은 현재
`UNLICENSED`이며, 저장소의 madi 자체 코드에
적용할 최종 배포 license는 Phase 0에서 결정하지 않았다. 이는 위 제3자 license를
무효화하거나 proprietary 배포 권한을 부여하지 않는다.
