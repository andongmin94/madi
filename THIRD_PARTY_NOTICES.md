# Third-Party Notices

이 파일은 Phase 1H 저장소에서 직접 포함하거나 주요 runtime/build dependency로
사용하는 제3자 자료를 요약한다. 각 license 원문이 우선하며, 이 요약은 license
조건을 대체하지 않는다.

```text
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Hancom Automation: LICENSE REVIEW REQUIRED BEFORE DISTRIBUTION
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
- `image` 0.25.10 with PNG/JPEG only
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

`madi-core`은 `thiserror` 1.0.69를, `madi-publication` 자체 lock은 2.0.18을,
`madi-export-epub`의 통합 lock은 compatible 2.0.20을 사용한다. `sha2`는 core의 canonical
document/snapshot/Canvas/Reader preset hash와 publication source/block/document hash에
사용되는 production dependency다. `thiserror`는 두 crate의 typed Rust error derive에만
사용하며 runtime plugin이나 executable content를 로드하지 않는다.

Resolved registry attribution과 license metadata:

| Crate | Resolved version | Upstream attribution | License | Registry 원문 |
|---|---:|---|---|---|
| `sha2` | 0.10.9 | RustCrypto Developers; license notice의 Graydon Hoare, Mozilla Foundation, Artyom Pavlov | MIT OR Apache-2.0 | `sha2-0.10.9/LICENSE-MIT`, `LICENSE-APACHE` |
| `thiserror` | 1.0.69 | David Tolnay | MIT OR Apache-2.0 | `thiserror-1.0.69/LICENSE-MIT`, `LICENSE-APACHE` |
| `thiserror` | 2.0.18 | David Tolnay | MIT OR Apache-2.0 | `thiserror-2.0.18/LICENSE-MIT`, `LICENSE-APACHE` |
| `thiserror` | 2.0.20 | David Tolnay | MIT OR Apache-2.0 | `thiserror-2.0.20/LICENSE-MIT`, `LICENSE-APACHE` |

Checked-in crate별 license 원문과 exact SHA-256는 다음과 같다. `sha2` 두 파일은 locked
0.10.9 registry 원문과, `thiserror` 두 파일은 locked 1.0.69, 2.0.18과 2.0.20의 동일한
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
Canvas 원문, 위 네 Rust license 원문과 아래 Phase 1G EPUB/HWPX direct dependency,
EPUBCheck 및 .NET apphost 원문을 `resources/licenses`에 복사한다. Package script는 checked-in source와 packaged
copy를 고정 SHA-256에 대조해 mismatch를 거부한다.
Rust transitive dependency 전체의 자동 license report는 아직 생성하지 않으므로
production 배포 전 `Cargo.lock` 기준 report를 계속 검토해야 한다. 이 원문 포함은 위
Typie `HUMAN DECISION REQUIRED`보다 배포 권한을 넓히지 않는다.

## Phase 1G EPUB Rust dependency

`madi-export-epub` direct production dependency와 exporter lock의 resolved version은 다음과
같다. Local `madi-publication`은 위 Typie/Rust bridge 고지를 따르며 Madi 자체 crate는
`UNLICENSED`다.

| Direct crate | Resolved version | 역할 | Upstream license expression |
|---|---:|---|---|
| `base64` | 0.22.1 | JSON cover bytes | MIT OR Apache-2.0 |
| `image` | 0.25.10 | PNG/JPEG decode와 sanitized re-encode | MIT OR Apache-2.0 |
| `quick-xml` | 0.37.5 | XML/XHTML internal validation | MIT |
| `serde` | 1.0.229 | strict request/result DTO | MIT OR Apache-2.0 |
| `serde_json` | 1.0.151 | utility JSON contract | MIT OR Apache-2.0 |
| `sha2` | 0.10.9 | source/package/file hash | MIT OR Apache-2.0 |
| `tempfile` | 3.27.0 | create-new same-directory temp | MIT OR Apache-2.0 |
| `thiserror` | 2.0.20 | typed utility errors | MIT OR Apache-2.0 |
| `zip` | 2.4.2 | EPUB ZIP package/reopen | MIT |

Feature-selected image/ZIP/tempfile closure의 주요 resolved crate와 license expression은
`crates/madi-export-epub/Cargo.lock` 및 registry package metadata에서 다음과 같이 확인했다.
이 표는 local Typie/Publication closure와 generic serde/crypto proc-macro graph를 반복하지
않는다.

| Crate | Version | License expression |
|---|---:|---|
| `bytemuck` | 1.25.2 | Zlib OR Apache-2.0 OR MIT |
| `byteorder-lite` | 0.1.0 | Unlicense OR MIT |
| `moxcms` | 0.8.1 | BSD-3-Clause OR Apache-2.0 |
| `num-traits` | 0.2.19 | MIT OR Apache-2.0 |
| `pxfm` | 0.1.30 | BSD-3-Clause OR Apache-2.0 |
| `png` | 0.18.1 | MIT OR Apache-2.0 |
| `zune-core` | 0.5.3 | MIT OR Apache-2.0 OR Zlib |
| `zune-jpeg` | 0.5.15 | MIT OR Apache-2.0 OR Zlib |
| `bitflags` | 2.13.1 | MIT OR Apache-2.0 |
| `crc32fast` | 1.5.0 | MIT OR Apache-2.0 |
| `fdeflate` | 0.3.7 | MIT OR Apache-2.0 |
| `flate2` | 1.1.9 | MIT OR Apache-2.0 |
| `miniz_oxide` | 0.8.9 | MIT OR Zlib OR Apache-2.0 |
| `adler2` | 2.0.1 | 0BSD OR MIT OR Apache-2.0 |
| `simd-adler32` | 0.3.10 | MIT |
| `fastrand` | 2.5.0 | MIT OR Apache-2.0 |
| `getrandom` | 0.4.3 | MIT OR Apache-2.0 |
| `once_cell` | 1.21.4 | MIT OR Apache-2.0 |
| `windows-sys` | 0.61.2 | MIT OR Apache-2.0 |
| `windows-link` | 0.2.1 | MIT OR Apache-2.0 |
| `indexmap` | 2.14.0 | Apache-2.0 OR MIT |
| `equivalent` | 1.0.2 | Apache-2.0 OR MIT |
| `hashbrown` | 0.17.1 | MIT OR Apache-2.0 |
| `zopfli` | 0.8.3 | Apache-2.0 |
| `bumpalo` | 3.20.3 | MIT OR Apache-2.0 |
| `log` | 0.4.33 | MIT OR Apache-2.0 |

Checked-in direct crate 원문과 LF-normalized SHA-256:

- `docs/licenses/BASE64-MIT.txt` →
  `0dd882e53de11566d50f8e8e2d5a651bcf3fabee4987d70f306233cf39094ba7`
- `docs/licenses/BASE64-TEMPFILE-APACHE-2.0.txt` →
  `a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2`
- `docs/licenses/IMAGE-MIT.txt` →
  `c77a4cf9da729987d0fe7ccd811e3bd27393914ddf3d23467c18cc22954513b3`
- `docs/licenses/IMAGE-APACHE-2.0.txt` →
  `0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594`
- `docs/licenses/QUICK-XML-MIT.txt` →
  `f0cf9b1c62bbe3bd3a69f5f79c7158f513f612b4940a0a812d1db39d605318bc`
- `docs/licenses/TEMPFILE-MIT.txt` →
  `8b427f5bc501764575e52ba4f9d95673cf8f6d80a86d0d06599852e1a9a20a36`
- `docs/licenses/ZIP-MIT.txt` →
  `13f16f8435b4242f494f038d761bd99c5af70395aa39274bd287d22c4d35c3b7`

`quick-xml`과 `zip` source는 registry의 CRLF/line-ending 표현을 repository 정책에 따라 LF로
normalization했으므로 byte hash는 registry file과 다르지만 license text와 attribution은
동일하다. Package script는 checked-in bytes와 packaged copy를 위 hash로 검증한다.

현재 unpacked package는 exporter direct crate의 위 원문, 기존 sha2/thiserror 원문과
Third-Party Notices를 `resources/licenses`에 포함한다. 위 transitive 표의 crate별 개별
license 원문 전체를 package에 자동 수집하는 완결된 Cargo license corpus는 아직 없다.
따라서 이 package는 Phase 1G **PRIVATE LOCAL** actual에는 사용할 수 있지만 외부 배포의
license-complete artifact라고 판정하지 않는다. 이 한계는 Typie의 더 강한
`HUMAN DECISION REQUIRED BEFORE DISTRIBUTION`과 별개로 public/paid/customer distribution을
계속 차단한다.

## EPUBCheck 5.3.0과 test-only Java runtime

- Project: EPUBCheck
- Exact release: 5.3.0
- Release: `https://github.com/w3c/epubcheck/releases/tag/v5.3.0`
- License: BSD 3-Clause
- Runtime role: 없음
- Build/test role: EPUB 3.3 production validation, EPUB 3.4 공통 subset 보조 검사
- Checked-in license text:
  `docs/licenses/EPUBCHECK-5.3.0-BSD-3-CLAUSE.txt`
- LF-normalized SHA-256:
  `851180aaf3e14dddafb23f62abf46123aa354cc9379c650952073823ee6b128e`
- Packaged notice path:
  `resources/licenses/EPUBCHECK-5.3.0-BSD-3-CLAUSE.txt`

Ignored local test tool identity:

| Artifact | Exact identity |
|---|---|
| EPUBCheck distribution ZIP | 5.3.0, 33,071,108 bytes, SHA-256 `6c07e68584b2e2ce2f89fe06e1246dfead3eb36b46b340e7d93524f29dcff6c5` |
| `epubcheck.jar` | 1,223,671 bytes, SHA-256 `f7f96617c929371821609b88c8484d6dc9f24fe916499863c46094c5fb778a65` |
| Java runtime ZIP | Eclipse Adoptium Temurin 21.0.11+10-LTS Windows x64 HotSpot JRE, 49,005,708 bytes, SHA-256 `be26677aaa20b39a62edcaab4c8857a8b76673b0f45abc0b6143b142b62717e4` |
| `java.exe` | 50,344 bytes, SHA-256 `5e0fab9f07952ceb6e71eb9fd33e1ed69959904ca00cf70869b7baf516a98016` |

EPUBCheck distribution의 exact `THIRD-PARTY.txt`가 열거하는 component/version은 다음과
같다.

- Jackson annotations/core/databind 2.18.2
- error-prone annotations 2.36.0
- Guava failureaccess 1.0.3, Guava 33.4.8-jre, ListenableFuture 9999.0 empty artifact
- J2ObjC annotations 3.0.0, JSpecify 1.0.0
- ICU4J 77.1
- json-path/json-path-assert 2.8.0
- TwelveMonkeys common-image/common-io/common-lang/imageio-core/imageio-jpeg/imageio-metadata
  3.9.4
- Commons Codec 1.19.0, Commons IO 2.20.0, Commons Compress 1.28.0, Commons Lang 3.18.0
- isorelax 20030108, accessors-smart 2.4.9, json-smart 2.4.10
- Saxon-HE 11.4, galimatias 0.1.3, ASM 9.3, Jing 20181222
- HttpClient/Core/Core-H2 5.1.3
- SLF4J API/NOP 1.7.36, SAC 1.3
- XML Resolver 4.4.3, Xerces2-j 2.12.2, XML APIs 1.4.01

Upstream distribution은 이 corpus에 Apache-2.0, BSD-3-Clause, MIT, MPL-2.0, W3C,
Unicode-3.0과 SAX license를 매핑하고 `licenses/` 및 JAR metadata를 함께 제공한다. Exact
distribution directory는 ignored `.tools/phase1g-validation` 안에서 이 files와
`THIRD-PARTY.txt`를 그대로 보존한다.

EPUBCheck ZIP/JAR, 그 transitive JAR와 Temurin JRE는 source control 또는 unpacked app의
runtime payload에 포함하지 않는다. 따라서 Java/JAR license corpus를 app runtime
license로 가장하지 않는다. 향후 runtime bundle을 승인하려면 Temurin GPLv2 with Classpath
Exception 및 assembly third-party notices, EPUBCheck 전체 transitive corpus, package size와
security-update owner를 별도 재검토해야 한다.

## Phase 1H HWPX exporter

`madi-export-hwpx`는 Madi가 작성한 Publication IR 기반 exporter다. Direct production
dependency와 resolved version은 다음과 같으며, 모두 Phase 1G exporter에서 이미 사용한
crate/version과 같다.

| Direct crate | Resolved version | 역할 | Upstream license expression |
|---|---:|---|---|
| `quick-xml` | 0.37.5 | 생성 XML의 well-formed reopen 검증 | MIT |
| `serde` | 1.0.229 | strict utility protocol | MIT OR Apache-2.0 |
| `serde_json` | 1.0.151 | strict utility protocol | MIT OR Apache-2.0 |
| `sha2` | 0.10.9 | source/file/logical package hash | MIT OR Apache-2.0 |
| `tempfile` | 3.27.0 | same-directory temporary output | MIT OR Apache-2.0 |
| `thiserror` | 2.0.20 | typed utility errors | MIT OR Apache-2.0 |
| `zip` | 2.4.2 | HWPX ZIP 생성과 reopen | MIT |

따라서 추가 Rust license 원문은 생기지 않는다. `QUICK-XML-MIT.txt`, `SHA2-*`,
`TEMPFILE-*`, `THISERROR-*`, `ZIP-MIT.txt`를 HWPX exporter에도 적용하고 unpacked package에
동일한 bytes로 포함한다.

구조 조사에 사용한 Hancom `hwpx-owpml-model` repository는 Apache-2.0으로 공개되어 있다.
다만 해당 repository clone은 ignored 조사 도구이며, 그 source/XSD와 공식 HWPX sample을
Madi source 또는 unpacked package에 복사하지 않는다. 공식 페이지·모델을 근거로 Madi가
독자적으로 생성한 XML과 문서만 포함한다. Apache-2.0 공개가 별도 KS 표준 문서나 공식
sample 전체의 재배포 권한까지 자동으로 부여한다고 해석하지 않는다.

## Phase 1H .NET HWP bridge와 Hancom Automation

`sidecars/hwp-bridge`는 외부 NuGet package 없이 .NET BCL/COM interop만 사용하는 Madi
소유 C# 코드다. Unpacked package에는 `win-x86`, `net10.0-windows` framework-dependent
apphost, Madi assembly, dependency metadata와 runtime configuration만 포함한다. .NET runtime
자체는 번들하지 않으므로 실행 PC에 compatible x86 .NET 10 runtime이 설치되어 있어야 한다.
현재 로컬 SDK에 self-contained win-x86 runtime pack이 없어 build가 runtime pack을
자동 다운로드하거나 package에 임의로 복사하지 않는다. Build SDK는 repository
`global.json`에서 `10.0.400`, roll-forward disabled로 고정한다.

.NET runtime/apphost source는 .NET Foundation MIT license다. Checked-in 원문과 hash:

- `docs/licenses/DOTNET-RUNTIME-MIT.txt` →
  `cfc21f5e8bd655ae997eec916138b707b1d290b83272c02a95c9f821b8c87310`
- Packaged path: `resources/licenses/DOTNET-RUNTIME-MIT.txt`

향후 self-contained deployment로 바꾸려면 고정한 정확한 runtime release의 전체
third-party notices, 보안 업데이트 owner와 architecture별 payload를 다시 검토해야 한다.

Bridge는 사용자가 별도로 설치한 Hancom Office의 registered COM Automation object만
호출한다. Hancom Office 실행 파일, DLL, `HwpObject`, 보안 승인 module, sample 또는 기타
Hancom binary를 source/package에 포함하지 않는다. Hancom Automation/API 및 HWP 변환의
상업적·외부 배포 조건은 해결되었다고 판단하지 않으며 상태는 다음과 같다.

```text
HANCOM AUTOMATION LICENSE REVIEW REQUIRED BEFORE DISTRIBUTION
```

## Phase 1H Windows output replacement helper

`madi-atomic-output`은 Madi가 작성한 compensation/recovery-aware Windows output
replacement helper다. Direct production dependency는 `serde` 1.0.229, `serde_json`
1.0.151, `sha2` 0.10.9, `windows-sys` 0.61.2이며 모두 MIT OR Apache-2.0이다.
`SHA2-MIT.txt`와 `SHA2-APACHE-2.0.txt`에 포함된 동일한 MIT/Apache-2.0 원문 corpus를
적용한다. Helper는 Windows API를 동적으로 호출하며 Microsoft Windows binary나 SDK
payload를 package에 복사하지 않는다.

Helper가 쓰는 `ReplaceFileW`는 단일 OS replacement 호출이지만 linearizable CAS,
visibility-gap 부재 또는 전원 손실 durability를 보장한다고 주장하지 않는다. 지속된
PREPARED intent, identity 기반 reconcile, private rollback과 visible no-clobber recovery
copy가 외부 데이터 손실을 막는 제품 계약이다.

## madi 자체 코드

`crates/madi-core/Cargo.toml`과 `crates/madi-publication/Cargo.toml`은 현재
`UNLICENSED`이며, 저장소의 madi 자체 코드에
적용할 최종 배포 license는 Phase 0에서 결정하지 않았다. 이는 위 제3자 license를
무효화하거나 proprietary 배포 권한을 부여하지 않는다.
