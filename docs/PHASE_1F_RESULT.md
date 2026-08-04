# Phase 1F — Publication IR & Reader Lab 결과

기준일: 2026-08-09

```text
Phase 1F verdict: CONDITIONAL TECHNICAL GO — PRIVATE LOCAL
Windows native Korean IME: MANUAL VALIDATION PENDING
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Public/paid/customer distribution: NOT AUTHORIZED
```

Phase 1F는 저장된 Typie 원고를 엔진 독립 Publication IR로 compile하고 같은 IR을
SCENE/CHAPTER/VOLUME/WORK Reader Lab에서 1/2/3개 읽기 환경으로 비교하는 end-to-end
제품을 완성했다. 일반·장편 fixture의 development Electron과 fresh unpacked package,
새 process 상태 복원, snapshot v4, preset CRUD, virtualization, source 이동과 보안 gate는
모두 통과했다.

판정이 conditional인 이유는 fresh packaged 장편 WORK의 설정 변경 visible update가
5회 median `538.35 ms`, maximum `562.87 ms`로 잠정 `약 250 ms` 목표를 넘기 때문이다.
동일 package의 675,000자 WORK first visible은 median `2,380.0 ms`, maximum
`2,409.5 ms`로 3초 목표 안이고, crash와 block 누락은 없었다. 따라서 비공개 로컬 다음
단계 진입은 가능하지만 배포 승인이나 성능 목표 완전 충족으로 해석하지 않는다.

## 1. Publication IR 구조

Canonical 편집 원본은 SQLite `documents.snapshot_blob`의 pinned Typie changeset이다.
Publication IR은 저장하지 않고 요청 시 파생한다.

```text
tree_nodes + SCENE Typie snapshots
        → madi-publication private Typie decoder
        → Madi semantic body
        → madi-core PublicationCompiler
        → PublicationDocument v1 + diagnostics + contentHash
        → strict main/preload/renderer validation
        → Reader Lab / future exporters
```

공개 `PublicationDocument`는 `formatVersion`, project/scope identity와 revision,
작품 metadata, tree-order `sections`, source statistics를 가진다. 각 section은 scene/source
identity, hierarchy title, block 배열을 가진다. 공개 block union은 `HEADING`,
`PARAGRAPH`, `SCENE_BREAK`, `QUOTE`, `UNSUPPORTED`, inline union은 `TEXT`, `STRONG`,
`EMPHASIS`, `UNDERLINE`, `STRIKE`, `RUBY`다.

Canonical JSON은 object key를 결정적으로 정렬하고 UTF-8 bytes의 SHA-256를 계산한다.
동일 project revision과 scope에서는 tree/section/block/inline 순서와 content hash가
동일하다. Story Bible note, alias/tag/relation, World Graph, Plot Canvas, search projection,
snapshot 목록과 Reader runtime state는 IR에 포함하지 않는다.

## 2. 실제 지원한 Typie 의미 요소

- authored `Paragraph`와 빈 paragraph
- `HorizontalRule(ThreeDiamonds)`의 `madi.scene-break.v1`
- top-level `Blockquote`의 paragraph 기반 `QUOTE`
- `Bold`, `Italic`, `Underline`, `Strikethrough`, `Ruby { text }`
- Binder의 WORK/VOLUME/CHAPTER/SCENE 제목에서 파생한 `HEADING`

Image asset이나 현재 pinned Typie 문서에서 안전하게 해석할 수 없는 node/atom은 지원한
것처럼 추측하지 않는다. 텍스트를 보존할 수 있으면 실행되지 않는 `UNSUPPORTED`
plain-text block으로 내리고, block 또는 inline modifier diagnostic을 남긴다. Lossy
changeset, degraded projection, source prose 불일치와 잘못된 editor identity는 fallback으로
숨기지 않고 compile을 실패시킨다.

## 3. Stable source mapping

Section과 block은 scene node ID, document ID, semantic source block ID와 nullable source
range를 가진다. 공개 ID는 project/document/source identity에서 만든 안정적인 hash ID며
DOM index가 아니다. `rangeVerified=true`이면 exact selection 또는 길이 0 caret 위치로
돌아가고, range를 검증할 수 없는 heading/block은 compiler가 제공한 scene/document
target까지만 이동한다. Renderer는 누락된 range를 text occurrence로 추측하지 않는다.

## 4. Reader Lab 기능

- 상위 모드 `읽기 실험실`
- 현재 SCENE, CHAPTER, VOLUME, WORK와 유효 Binder selection scope
- dirty SCENE/ENTITY note 선행 flush와 저장 실패 시 fail-closed/마지막 저장본 선택
- request generation, project revision과 scope identity에 의한 stale compile 차단
- Shadow DOM 안의 read-only semantic React render
- 1/2/3 pane, pane별 preset/device/override/zoom/scroll
- 선택 source block의 모든 pane 동시 강조
- 선택적 scroll sync와 독립 scroll
- preview/diagnostic에서 원고 SCENE과 검증된 range로 이동
- 사용자 preset 생성·수정·복제·삭제·reset과 content-hash no-op
- 작품별 Reader UI state 저장과 새 process 복원

원고 문자열은 `innerHTML`로 넣지 않으며 script, iframe, remote font/image/CSS를 실행하지
않는다. 설정/preset 변경은 cached Publication IR에 config만 다시 적용하고 compile RPC를
호출하지 않는다.

## 5. ReaderRenderConfig와 사용자 설정

한 pane의 최종 설정은 다음 네 층의 fully resolved config다.

```text
ReaderRenderConfig
  = PlatformProfile + DeviceProfile + ReaderSettings + WorkStyle
```

Device는 PHONE/TABLET/DESKTOP viewport와 safe area/reader chrome을, settings는 허용된
font token, 10~40px font size, 1~3 line height, paragraph spacing, first-line indent,
0~200px padding, LEFT/JUSTIFY, LIGHT/SEPIA/DARK/CUSTOM 색과 표시 toggle을 가진다.
WorkStyle은 닫힌 body/chapter/scene/scene-break token만 사용한다. CSS string, font URL,
class name이나 임의 style fragment는 저장하지 않는다.

## 6. Built-in과 platform-like simulation

Built-in 11종은 다음과 같다.

- 범용 소형 모바일, 범용 대형 모바일, 범용 태블릿, 범용 데스크톱, 범용 다크 모바일
- 카카오페이지형 모바일/데스크톱
- 네이버 시리즈형 모바일/데스크톱
- 문피아형 모바일/데스크톱

뒤의 6종은 로고·앱 asset·공식 기본값을 복제하지 않는 조절 가능한
`UNVERIFIED_SIMULATION`이다. UI는 “독서환경 시뮬레이션”과 실제 앱 버전·기기·사용자
설정에 따라 달라질 수 있다는 고지를 표시한다. 저장된 사용자 preset은 전체 resolved
config를 가지므로 이후 built-in 변경과 무관하게 재현되지만 공식 플랫폼 검증 상태로
승격되지는 않는다.

## 7. 비교 보기와 scroll sync

2/3 pane은 동일 `PublicationDocument`를 서로 다른 config로 render한다. Source block
선택 identity는 pane 간 공유하고 각 pane의 보이는 block은 `aria-pressed`로도 강조한다.
Scroll sync는 실제 Shadow scroller의 normalized document progress를 맞춘다. 서로 다른
font/viewport에서 exact pixel 또는 같은 줄 정렬은 보장하지 않으며, source block 선택이
정확한 비교 anchor다. Sync off에서는 다른 pane의 state/actual `scrollTop`이 바뀌지
않는 것을 실제 창에서 확인했다.

## 8. 통계와 diagnostics

Source 통계는 공백 포함/제외 문자, paragraph, scene, chapter 수다. Pane별 render 통계는
실제 rendered height, effective viewport, 예상 화면 수, 화면당 평균 문자, 가장 긴 문단
line 수, 8줄 이상 문단, 연속 빈 문단과 horizontal overflow다. 화면 수는 현재 continuous
viewport 설정의 추정치이며 플랫폼 공식 page 수가 아니다.

Diagnostic은 긴 문단, viewport보다 큰 문단, horizontal overflow, 3개 이상 연속 빈
문단, 연속 scene break, unsupported block/modifier를 “검토 후보”로만 표시한다. 문장
품질·독자 이탈·호흡을 자동 판정하지 않는다. Measurement는
`ESTIMATED → MEASURING → COMPLETE`를 명시하며 browser/local font 차이를 고지한다.

## 9. 긴 원고 virtualization

12 section 또는 100,000자를 넘으면 section windowing을 사용한다. Visible viewport에
900px overscan을 더한 section만 mount하고, 앞뒤 cumulative padding과 측정된 높이로
scroll geometry를 유지한다. Full-scope 통계는 같은 Shadow CSS의 숨긴 layer에서 section
하나씩 측정하며 event loop에 양보한다.

장편 fixture 450 section/2,411 block에서 pane별 mounted section은 관찰 지점에 따라
1~3개, mounted block은 8~16개였고 전체 450 section/2,411 block은 모두 측정됐다. 서로
떨어진 `0.10, 0.25, 0.50, 0.75, 0.42` progress에서 세 pane의 virtual window가 모두
변했고 canonical block loss는 `0`이었다.

## 10. Reader preset과 `.madi` schema 6

Logical `format_version = 1`은 유지하고 SQLite schema/user version을 `6`으로 올렸다.
Migration 5→6은 기존 row를 보존하며 다음 `reader_presets` table/index만 추가한다.

```text
id, project_id, name,
source_kind, source_id, source_version,
verification_status,
preset_format, preset_version, preset_json,
content_hash, revision, created_at, updated_at
```

Core는 exact config shape/enum/version, 숫자와 relational padding 범위, provenance/status,
canonical hash와 project/preset revision을 transaction 안에서 검증한다. Cross-project
reference, malformed JSON, orphan preset과 partial mutation은 거부한다. 동일 canonical
content update는 preset/project revision을 올리지 않는다. 이름 중복은 허용하되 UI가
경고하고 빈 이름은 거부한다.

## 11. Snapshot payload v4와 하위 호환성

새 named snapshot은 `MADI_LOGICAL_JSON` payload v4이며 canonical `reader_presets` row의
metadata, full resolved JSON, hash, revision과 timestamp를 포함한다. Reader Lab의 현재
scope/pane/preset selection/override/zoom/scroll/panel 폭/diagnostic 상태, Publication cache와
render metrics는 포함하지 않는다.

Decoder는 payload v1/v2/v3/v4만 수용한다. v1은 Story Bible/Canvas/preset을, v2는
Canvas/preset을, v3는 preset을 빈 상태로 정확히 복원한다. Restore는 dirty owner flush,
v4 `AUTO_BEFORE_RESTORE`, hash/shape 검증, logical row 복원, search projection 재구축과
Reader preset revalidation을 한 transaction 경계로 수행한다. Diff에는 Reader preset
added/deleted/changed 수가 추가됐다. 실제 workflow는 preset 변경 `1`건을 diff하고 v4
restore 뒤 원래 font size `20`과 safety snapshot을 확인했다.

## 12. UI state와 재실행 복원

`reader-lab.v1`은 작품별로 마지막 scope, pane count, 정확히 세 pane slot의 preset/
override/zoom/scroll, scroll sync, 좌우 panel 폭, 선택 source block과 diagnostic 펼침을
저장한다. Named snapshot에는 들어가지 않는다. 삭제된 node/preset reference는 첫 유효
scope 또는 안전한 built-in으로 normalize한다.

새 process 실제 검증에서 WORK/3 pane, 서로 다른 preset/config, zoom
`1.10/0.95/1.15`, panel 폭 `333/444`, sync off와 각 pane scroll
`0.20/0.45/0.70`의 state 및 실제 Shadow scroll 위치가 모두 복원됐다. 첫 창 종료부터 새
process ready까지는 development `24,430.54 ms`, packaged `2,353.52 ms`의 단일 관측이다.

## 13. Bundle code splitting

최종 production renderer의 lazy chunk는 다음과 같다.

| Chunk | Raw | gzip | SHA-256 |
|---|---:|---:|---|
| `ReaderLabMode-CDe7cKmz.js` | 71,502 B | 21,207 B | `efdf00545c060d1ad0036ed134c7434fffcd5b9c400b29c24d306a4178864843` |
| `ReaderLabMode-COq1pqa9.css` | 7,218 B | 2,037 B | `5a54c14f40ee58453ab939ace1e9c0e0d5d9845680bcf50c1bc14a413fa69e47` |
| `WorldGraphWorkspace-DhoY8F33.js` | 478,653 B | 153,124 B | — |
| `PlotCanvasMode-CvmMxDH_.js` | 249,564 B | 79,562 B | — |
| initial `index-CBdcFHoW.js` | 415,263 B | 117,634 B | — |

Bundle test는 Reader Lab/World Graph/Plot Canvas가 서로 다른 dynamic chunk이고 Reader
preview/windowing code가 initial shell에 중복되지 않음을 확인했다. 별도 virtualization
npm dependency는 추가하지 않았다. 위 Reader JS/CSS의 source build와 packaged copy는
각각 byte-identical하다.

## 14. 일반·장편 실제 성능

일반 fixture는 2권/20화/60장면/180,000자/60 scene break, 60 section/323 block이다.
장편 fixture는 10권/150화/450장면/675,000자/450 scene break, 450 section/2,411 block이다.
둘 다 한국어, 긴 문단과 빈 문단을 포함한다.

최종 standalone actual evidence는 다음과 같다.

| Runtime | Evidence bytes | Evidence SHA-256 | 일반 fixture SHA-256 | 장편 fixture SHA-256 |
|---|---:|---|---|---|
| Development | 17,117 | `9a548c11f32059750c5dc91721c548064000dc25fac846acb1203cef02d0f8a6` | `c3e08a09b83415f86159b3f538d466b16c13e4df4e6e7a054ef9e522c43a3070` | `2e15e2e87b69de1cc76404dd56c285daaed2f024a014ee0e29c2e088bdb289ff` |
| Fresh unpacked | 17,078 | `56e028a0f3d00f7cb6e6e09f954841c1f07a0857bab3c8fc8066878980ed7860` | `c05ed560be589b8fdcaac83060bbe1098a35d1a0c66b7617604c3d07f49f965c` | `4ebb54b706b135f608d493111ab8ccb12b8a8b359532162a86ceb5a6c9e5f090` |

Fresh packaged 5회 핵심 median/maximum은 다음과 같다.

| 항목 | 일반 WORK | 장편 WORK |
|---|---:|---:|
| 외부 refresh→관찰 | 1,001.91 / 1,074.78 ms | 2,784.73 / 2,853.33 ms |
| core compile | 849.18 / 863.31 ms | 2,016.90 / 2,033.04 ms |
| `compilePublication` RPC round-trip (core 포함) | 864.10 / 874.50 ms | 2,081.40 / 2,099.60 ms |
| runtime validation | 12.90 / 13.90 ms | 46.20 / 47.80 ms |
| compile 시작→first visible | 906.10 / 914.30 ms | 2,380.00 / 2,409.50 ms |
| cached IR 3-pane visible | 88.76 / 104.63 ms | 425.07 / 441.00 ms |
| font-size setting visible | 109.27 / 118.25 ms | **538.35 / 562.87 ms** |
| normalized scroll state 수렴 | 13.31 / 14.44 ms | 40.75 / 49.07 ms |

Development는 debug Rust sidecar 때문에 장편 compile/first-visible median이
`47,907.98/47,509.30 ms`로 release package와 성격이 다르다. 이를 packaged 제품 성능으로
혼합하지 않는다. 전체 metric 정의와 나머지 수치는
[Reader Lab performance](./READER_LAB_PERFORMANCE.md)에 기록한다.

## 15. Security와 외부 runtime 요청

Development와 packaged Reader 실제 renderer session에서 외부 HTTP request `0`, 외부
WebSocket `0`, page error `0`, content-bearing renderer diagnostic `0`이고 local-file probe는
모두 차단됐다. Dev의 local same-origin runtime traffic은 외부 요청으로 분류하지 않는다.
Main의 navigation/window/network guard, local protocol, sandboxed preload와 strict IPC도
유지했다.

Packaged actual은 launch 환경을 의도적으로 오염해 `MADI_RENDERER_URL`을 loopback canary
HTTP server로, `MADI_CORE_BIN`을 존재하지 않아야 하는 canary executable path로 지정한
상태에서 전체 Reader workflow를 실행한다. 모든 packaged process의 renderer protocol은
`madi:`, wrapper의 canary renderer request는 `0`, core canary file은 생성되지 않았다.
Production CSP에는 development `ws://127.0.0.1:5173`이 없고 packaged main은 두 개발용
override를 무시한다.

이 결과는 Playwright가 해당 renderer session에서 관찰한 HTTP/WS와 앱 guard 증거다.
OS 전체 packet capture, 다른 process 또는 kernel 수준 egress가 `0`이었다는 주장은
아니다.

## 16. Test와 package gate

Node.js `26.3.1`, pnpm `11.9.0`의 최종 `pnpm verify`는 exit `0`, `2,001.7 s`로
끝났다.

| Gate | 결과 |
|---|---:|
| Desktop Vitest | 49 files / 281 tests PASS |
| `madi-publication` Rust | 14 / 14 PASS |
| `madi-core` Rust | 49 / 49 PASS |
| Phase 1A–1E integration regression | PASS |
| Phase 1F normal/long fixture export | PASS |
| Development Electron Reader actual, 5회 | PASS |
| Fresh unpacked Electron Reader actual, 5회 | PASS |
| New-process Reader state restore | PASS |
| Lazy bundle boundary | PASS |
| Repository/format/typecheck/build/package | PASS |

`pnpm verify` 뒤 요구 명령도 독립적으로 다시 실행했다.

| 명령 | 최종 결과 |
|---|---:|
| `pnpm package:unpacked` | PASS / 5.9 s |
| `pnpm test:electron` | PASS / 1,218.4 s |
| `pnpm test:package` | PASS / 575.3 s |
| `pnpm test:bundle` | PASS / 719 ms / 1 file, 3 tests |
| `pnpm check:repository` | PASS |
| `pnpm format:check` | PASS |

Evidence JSON의 `measurementRuns`는 development/package 모두 `5`다.

## 17. Package와 라이선스

Fresh unpacked artifact는 `madi.exe` `204,521,984 B`, SHA-256
`8d205e25b40da3ada4a08c92f32bfbd8e8d38edb4bfe443deea77fc9de685bac`이고 release sidecar
`madi-core.exe`는 `8,311,296 B`, SHA-256
`55375232afa83048a6eb417e76a6317c5fdd20d04f3a2c71a31d63b4d5301573`다. Package의
`resources/licenses`에는 Typie AGPL,
Nanum Gothic OFL, Cytoscape MIT, React Flow MIT, JSON Canvas MIT, sha2와 thiserror의
MIT/Apache-2.0 원문, `THIRD_PARTY_NOTICES.md`가 포함됐다.

새 npm runtime dependency는 없다. 새 private Rust crate `madi-publication`은 이미 pinned된
local Typie crates와 `serde`, `serde_json`, `sha2 0.10.9`, `thiserror 2.0.18`을 사용한다.
Core의 `thiserror 1.0.69`를 포함한 exact attribution/hash는
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)에 기록했다. 이 원문 동봉은 Typie
배포 결정을 해결하거나 배포 권한을 넓히지 않는다.

현재 package license corpus는 포함한 원문이 source와 byte-identical하다는 것까지만
검증했다. `pnpm-lock.yaml`/`Cargo.lock` 전체 npm·Rust transitive dependency의 자동
license/notice report는 아직 완결되지 않았고 executable은 Authenticode 서명되지 않았다.
이는 PRIVATE LOCAL 기술검증을 막지 않지만 Typie 결정과 별도로 모든 외부 배포를 계속
차단한다.

## 18. Phase 1D/1E 누적 clock 재분류

Phase 1D Playwright search focus/selection 누적값과 Phase 1E Canvas cold `Ctrl+K`/autosave
관측값은 다음 상태로 재분류한다.

```text
NON-BLOCKING HARNESS-LEVEL OBSERVATION
```

| 기존 누적 관측 | Development median / max | Packaged median / max |
|---|---:|---:|
| World Graph result click→focus | 667.55 / 737.11 ms | 668.17 / 703.35 ms |
| World Graph visual selection | 740.08 / 782.05 ms | 593.17 / 657.52 ms |
| Plot Canvas cold `Ctrl+K` | 518.40 / 621.96 ms | 520.72 / 642.24 ms |
| Canvas drag→debounced autosave | 981.90 / 1,013.26 ms | 1,024.66 / 1,029.79 ms |

Playwright actionability, scroll/poll/paint wait와 의도한 autosave debounce가 제품 내부
처리와 섞인 누적값이다. 수치는 삭제하지 않되 실제 사용 중 명백한 지연이나 기능 오류가
새로 발견되기 전에는 Reader Lab 진행을 차단하거나 World Graph/Canvas 최적화만 반복하는
근거로 쓰지 않는다.

## 19. 알려진 한계

- 장편 WORK 설정 visible update가 약 0.54초로 잠정 250ms 목표를 넘는다.
- Development debug compile은 release package보다 매우 느려 제품 성능 대표값이 아니다.
- Scroll sync는 normalized progress이며 서로 다른 layout의 exact 줄/pixel mapping이 아니다.
- 화면 수와 diagnostic line 수는 현재 local browser/font metric의 추정·관측이다.
- Memory는 전체 Electron app process tree의 전/후 단일 관측이며 leak 또는 장시간 상한을
  증명하지 않는다.
- 실제 EPUB/HWPX/HWP/PDF/DOCX export와 플랫폼 upload는 구현하지 않았다.
- 완전한 screen-reader, native IME, 장시간/DPI/다중-monitor 검증은 남아 있다.
- Renderer-session HTTP/WS 관찰은 OS-wide packet capture가 아니다.
- npm/Rust transitive license corpus가 완결되지 않았고 executable이 unsigned다.

## 20. Windows native IME와 Typie 라이선스

Windows native 한국어 IME는 계속
`MANUAL VALIDATION PENDING (15 / 15 NOT TESTED)`이다. 자동화 한글 입력이나 Reader
preview가 이 상태를 PASS로 바꾸지 않는다.

Typie는 계속 `HUMAN DECISION REQUIRED BEFORE DISTRIBUTION`이다. 현재 허용 범위는
비공개 로컬 개발과 제한된 내부 기술검증뿐이며 public, paid, customer pilot, installer
외부 전달은 승인하지 않는다.

## 21. Phase 1G 진입과 추천 작업

Phase 1G는 **비공개 로컬에 한해 conditional 진입 가능**하다. 첫 작업은 장편 WORK에서
Reader setting 변경이 full measurement와 결합되는 구간을 profile해 visible update를
약 250ms 수준으로 줄이되 Publication IR 재compile이나 block 누락으로 비용을 숨기지 않는
것이다. 이어서 Publication IR v1을 그대로 소비하는 첫 exporter의 format/검증 계약을
결정할 수 있다. 배포 또는 외부 파일 전달 전에는 native IME 수동 gate와 Typie license
결정을 먼저 닫아야 한다.

## 관련 문서

- [Phase 1F scope](./PHASE_1F_SCOPE.md)
- [Publication IR v1](./PUBLICATION_IR_V1.md)
- [Reader Lab architecture](./READER_LAB_ARCHITECTURE.md)
- [Reader profile format v1](./READER_PROFILE_FORMAT_V1.md)
- [Reader Lab visual diagnostics](./READER_LAB_VISUAL_DIAGNOSTICS.md)
- [Reader Lab performance](./READER_LAB_PERFORMANCE.md)
- [Named snapshot format](./NAMED_SNAPSHOT_FORMAT.md)
- [`.madi` file format v1 draft](./MADI_FILE_FORMAT_V1_DRAFT.md)
- [ADR-0005](./decisions/ADR-0005-publication-ir-is-derived-engine-independent-model.md)
- [ADR-0006](./decisions/ADR-0006-reader-lab-rendering-is-isolated-and-non-executable.md)
