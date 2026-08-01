# Third-Party Notices

이 파일은 Phase 0 저장소에서 직접 포함하거나 주요 runtime/build dependency로
사용하는 제3자 자료를 요약한다. 각 license 원문이 우선하며, 이 요약은 license
조건을 대체하지 않는다.

## Typie

- Project: Typie and its affiliated softwares
- Copyright notice: `Copyright (C) 2025 PENXLE COMPANY`
- Repository: `https://github.com/penxle/typie`
- Exact commit: `fbe5c4bf860d1717a66e66bea2374a2e39f0dd26`
- Source submodule: `vendor/typie`
- Runtime package: `packages/typie-runtime`
- madi runtime metadata/hashes: `packages/typie-runtime/BUILD_INFO.json`
- madi package license declaration: `AGPL-3.0-only`

포함한 자료:

- `packages/typie-runtime/browser/editor_ffi.js`
- `packages/typie-runtime/browser/editor_ffi.d.ts`
- `packages/typie-runtime/browser/editor_ffi_bg.wasm`
- `packages/typie-runtime/browser/icu.zst`
- `packages/typie-runtime/assets/*`

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

직접 dependency:

- `base64`
- `clap`
- `rusqlite` with bundled SQLite
- `serde`
- `serde_json`
- `thiserror`
- `uuid`

test dependency:

- `sha2`
- `tempfile`

manifest와 정확한 resolved version:

- `crates/madi-core/Cargo.toml`
- `crates/madi-core/Cargo.lock`

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

Rust dependency 전체 license report는 현재 저장소에 자동 생성돼 있지 않다.
production 배포 전 `Cargo.lock` 기준 report와 필요한 원문을 package에 포함해야 한다.

## madi 자체 코드

`crates/madi-core/Cargo.toml`은 현재 `UNLICENSED`이며, 저장소의 madi 자체 코드에
적용할 최종 배포 license는 Phase 0에서 결정하지 않았다. 이는 위 제3자 license를
무효화하거나 proprietary 배포 권한을 부여하지 않는다.
