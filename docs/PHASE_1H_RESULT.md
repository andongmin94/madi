# Phase 1H — HWPX Export & Optional Local HWP Bridge 결과

기준일: 2026-08-13  
문서 상태: static implementation record; final actual pending

이 문서는 아래 기준일의 구현·실행 근거를 보존한다. 현행 목표와 작업 순서는
[PLANS.md](../PLANS.md)를 따른다. 후속 Phase 1I 구현이나 계획 정리는 이 문서의
`WITHHELD`를 해소하는 실행 근거가 아니다.

## 1. Phase 1H 최종 판정

```text
Phase 1H verdict: WITHHELD
HWPX actual verdict: WITHHELD UNTIL DEVELOPMENT/FRESH-UNPACKED GATES COMPLETE
HWP Automation: MANUAL VALIDATION PENDING
Development boundary: PRIVATE LOCAL ONLY
```

Repository implementation과 일부 focused/static/package boundary 검증은 존재하지만 이
문서를 작성한 시점에는 일반·675,000자 actual, development/fresh-unpacked Electron과 최종
7개 pnpm command를 완료하지 않았다. 따라서 `TECHNICAL GO — HWPX`를 미리 선언하지 않는다.

## 2. Runtime EPUBCheck 재분류 결과

Runtime EPUBCheck/JRE bundle은 Phase 1H 구현 조건에서 배포 직전 hardening으로 재분류했다.
EPUB exporter의 internal validator와 exact EPUBCheck 5.3.0 build/test gate는 유지한다.
앱 runtime은 JRE/JAR를 download하거나 external validation server를 호출하지 않는다.
Phase 1F Reader visible-setting interaction 조건은 packaged median 184 ms로 목표를 통과해
해소된 것으로 기록한다. 이는 Phase 1H HWPX actual이나 distribution 승인 근거는 아니다.

```text
Runtime EPUBCheck/JRE: DEFERRED TO PRE-RELEASE DISTRIBUTION HARDENING
External runtime requests: required target 0
Distribution: still blocked until packaging/update/license owner is decided
```

## 3. HWPX 공식 구조 근거

구현은 한컴 공식 `hwpx-owpml-model` commit
`1453388472c703a4b299a0834f425cdac16644b9`, 한컴 HWPX 기술 문서/파싱 글, 공개 형식
안내와 Automation 자료를 근거로 한다. Target은 legacy XML 1.31 상호운용 profile이다.

KS X 6101은 2024-10-30 개정 상태를 확인했지만 현행 2024 namespace와 legacy 2011
namespace는 다른 세대다. 이 구현은 세대를 섞지 않으며 `KS X 6101:2024 conformant`라고
주장하지 않는다. 공식 complete sample bytes와 재배포 조건은 확인되지 않아 저장소에
복사하지 않았다. 전체 근거는 [official profile](./HWPX_OFFICIAL_PROFILE_1_31.md)에 있다.

## 4. HWPX exporter 구조

`madi-export-hwpx`는 `PublicationDocument v1`과 closed Madi request만 소비하는 Rust
library/JSONL utility다. Request validation → semantic mapping → style table → section XML →
package documents → deterministic ZIP → reopen → internal/source-coverage validation → staged
write 순서다. Typie/editor DOM/SQLite를 직접 읽지 않는다.

Electron main은 session/revision/scope/preset/output을 다시 확인하고 child result의 exact
shape/hash/coverage/destination을 독립 검증한다. Packaged resolver는
`resources/bin/madi-export-hwpx.exe`로 고정된다.

## 5. Package layout

Deterministic baseline은 `mimetype`, `version.xml`, `Contents/header.xml`, one or more
`Contents/sectionN.xml`, `settings.xml`, `META-INF/container.rdf`, `Contents/content.hpf`,
`META-INF/container.xml`, `META-INF/manifest.xml` 순이다. `mimetype`은 첫 Stored entry이고
exact bytes는 `application/hwp+zip`이다.

Madi는 RDF를 항상 생성/참조해 현재 profile validator에서 required로 삼지만 HWPX의 모든
문서에 보편적으로 필수라고 주장하지 않는다. Preview/BinData/Scripts/template/history/
chart/signature는 생성하지 않는다. 자세한 관계는 [package layout](./HWPX_PACKAGE_LAYOUT.md)에
있다.

## 6. 의미 매핑

WORK/VOLUME/CHAPTER/SCENE heading은 4개 Madi paragraph style로, paragraph/quote/scene break는
각각 body/blockquote/closed-token paragraph로 mapping한다. Strong/emphasis/underline/strike는
char property bit 조합이다. Unsupported non-empty block은 escaped text fallback+warning이며
empty fallback은 거부한다.

Ruby는 verified legacy `dutmal` parameter가 부족해 `기본문자(주석)` text fallback과
structured warning을 사용한다. Ruby count와 fallback count가 다르면 성공이 아니다.

## 7. Style·font·paragraph property

Preset은 본문 font/point size, percent/fixed line spacing, first-line indent, paragraph
before/after와 alignment를 가진다. Work/volume/chapter/scene heading은 font/size/bold/
alignment/spacing/page break를 별도로 가진다. Header에는 deterministic fontfaces,
charProperties, paraProperties와 styles를 만들고 모든 IDREF/count를 validator가 확인한다.

Font는 embed하지 않는다. 기본 template은 `함초롬바탕`을 사용하지만 actual installed
font check와 표시 결과는 source text coverage와 별도 report 항목이다.

## 8. Page·margin·page number·title page

A4 portrait는 `59528 × 84188 HWPUNIT`; landscape는 축을 교환한다. Custom/margin은 mm를
`round(mm × 72000 / 254)`로 변환한다. `pagePr/margin`에 여백/header/footer/gutter를 기록하고
invalid text area를 거부한다.

Page number는 `hh:beginNum`, 첫 section `hp:startNum`, bottom left/center/right
`hp:pageNum`으로 기록한다. Optional header/footer는 sublist paragraph다. Title page는
작품명/저자와 one-shot subtitle/genre/contact를 포함하고 마지막 항목 뒤 page break를
둔다. Contact는 report/snapshot에 넣지 않는다.

## 9. Export preset

Schema 8은 generic `export_presets.kind`를 `EPUB | HWPX`로 확장한다. HWPX는
`MADI_EXPORT_PRESET` version 1의 closed config와 canonical JSON SHA-256를 저장한다.
Built-in은 범용 제출본, 가독성 중심 검토본, 압축 검토본 3종이며 SQLite에 자동 seed하지
않는다.

CRUD는 project/preset revision, kind/format/version/hash와 no-op을 transaction에서 강제한다.
Named snapshot payload는 계속 v5이고 EPUB/HWPX preset을 kind별로 보존한다.

## 10. Internal validation

Validator는 bounded ZIP reopen, exact MIME/order/path, required parts, XML roots/namespaces,
container/HPF manifest/spine, header table count/IDREF, section/paragraph/run, page/controls와
source expectation을 검사한다. Fatal/error가 있거나 validation count가 inconsistent하면
output success가 아니다.

Bundled 2024 KS XSD validator는 아니며 internal result를 국가표준 완전 적합성으로 표시하지
않는다. Negative/fault fixture 범위는 [validation strategy](./HWPX_VALIDATION_STRATEGY.md)에
있다.

## 11. Block·character coverage

목표 성공 관계는 다음과 같다.

```text
source sections == exported sections
source blocks == exported blocks + fallback blocks + configured omission blocks + rejected blocks
rejected blocks == 0
source Unicode scalar characters == exported characters
heading/scene-break/ruby/inline modifier expectation == reopened package observation
```

Configured omission은 `include* = false`로 사용자가 끈 hierarchy heading만 뜻한다. Empty
unsupported는 fail-closed하며 Publication IR v1에는 authored manuscript image variant가 없다.

이 문서 작성 시 long-form Electron actual 수치는 아직 없으므로 loss 0을 최종 결과로
선언하지 않는다.

## 12. Deterministic output

Entry/order/path, XML generation order, numeric IDs, ZIP timestamp/permission/compression을
고정한다. Result는 ZIP byte SHA-256와 ordered uncompressed part bytes에 domain-separated
`logicalPackageHash`를 모두 제공한다. Repeated fixture equality는 Rust tests와 최종 5-run
actual 양쪽에서 확인해야 한다. Hancom re-save/HWP binary에는 같은 byte determinism을
주장하지 않는다.

## 13. HWP local bridge

C# `madi-hwp-bridge`는 net10.0-windows/win-x86 framework-dependent sidecar다. Closed
`probe|convert|reopen-verify|cancel` JSONL protocol, absolute extension-safe path, no-clobber,
owned temp, timeout/cancel cleanup과 mockable Automation interface를 제공한다.

Binary HWP를 직접 생성하지 않는다. HWPX validation이 먼저 성공해야 하며 conversion
failure는 source/final HWPX를 손상시키지 않는다. 한컴/HwpObject/security module binary는
bundle하지 않는다.

## 14. 실제 한컴 검증 여부

한컴오피스 2022와 `HWPFrame.HwpObject.2`, signed `hwp.exe 12.0.0.4170`은 발견했다.
Packaged bridge probe는 `SECURITY_MODULE_REQUIRED`를 반환했다. Current-user Automation
module value가 없어 COM object를 활성화하지 않았다.

```text
Hancom installed: YES
Packaged bridge process/protocol: PASS
Security module: MISSING
COM activation: NOT RUN
HWPX open/HWP SaveAs/HWP reopen: MANUAL VALIDATION PENDING
```

## 15. 일반·장편 성능

측정 계약은 general semantic fixture와 10권/150화/450장면/675,000자 long-form fixture를
development/fresh-unpacked에서 가능한 5회 측정하는 것이다. Fresh-unpacked exporter total
target은 15초다. 현재 actual evidence가 없어 수치와 PASS는 `WITHHELD`다.

## 16. 테스트 결과

현재 확정된 focused/static 경계만 기록한다.

| Gate | Result |
|---|---|
| HWPX release build | PASS; structural packaging prerequisite |
| HWP bridge debug/release publish | PASS |
| C# bridge contract tests | PASS, 12/12 |
| Packaged resolver boundary | PASS, 5/5 |
| Repository boundary | PASS |
| Source format/hygiene | PASS at documentation start; rerun required after final docs |
| Full HWPX Rust suite | pending final exporter turn |
| Development/fresh-unpacked Electron actual | NOT RUN in this documentation turn |
| Final aggregate commands | PENDING |

Focused result는 aggregate/final actual을 대신하지 않는다.

## 17. 실행한 명령

이 documentation/package subtask에서 확인한 주요 명령은 다음이다.

- `pnpm run build:hwpx:release`
- `pnpm run build:hwp-bridge`
- `pnpm run build:hwp-bridge:release`
- `pnpm run test:hwp-bridge`
- focused `packaged-runtime-boundary.test.ts`
- `node scripts/package-unpacked.mjs`
- `node scripts/check-repository.mjs`
- `node scripts/check-format.mjs`

Required 최종 7개 command의 independent elapsed/exit는 root actual 종료 후 이 문서에
추가한다. 실행하지 않은 명령을 PASS로 적지 않는다.

## 18. 변경 파일과 commit

구현은 core schema/preset/snapshot, Rust HWPX crate, Electron contracts/main/preload/renderer,
C# bridge, packaging/tests/docs를 변경한다. 이 static result 시점에는 Phase 1H commit chain이
확정되지 않았으므로 commit ID를 기입하지 않는다. Final result는 실제 commit과 clean/dirty
state를 구분해 기록해야 한다.

## 19. 추가 dependency와 라이선스

HWPX crate의 direct dependencies는 Phase 1G에서 이미 사용한 quick-xml 0.37.5, serde
1.0.229, serde_json 1.0.151, sha2 0.10.9, tempfile 3.27.0, thiserror 2.0.20, zip 2.4.2와 local
madi-publication이다. 새 npm runtime dependency와 remote service는 없다.

Bridge는 external NuGet package 없이 .NET BCL/COM interop만 사용한다. .NET apphost MIT
원문은 package에 포함한다. Official model source는 Apache-2.0이나 source/XSD/sample을
vendor/package하지 않는다. 자세한 고지는 [Third-Party Notices](../THIRD_PARTY_NOTICES.md)에
있다.

## 20. Windows native IME·Typie·Hancom 라이선스 상태

```text
Windows native Korean IME: MANUAL VALIDATION PENDING
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Hancom Automation: LICENSE REVIEW REQUIRED BEFORE DISTRIBUTION
Official complete HWPX sample redistribution: UNVERIFIED / NOT BUNDLED
Public/paid/customer distribution: NOT AUTHORIZED
```

Automated UTF-8/HWPX output은 Windows native IME PASS 근거가 아니다. 한컴을 bundle하지
않는다는 사실도 Automation 상업 이용 조건을 해결하지 않는다.

## 21. 현재 알려진 한계

- KS X 6101:2024 full conformance/XSD validation 아님
- Official complete HWPX sample fixture 없음
- Ruby는 plain-text fallback
- Font embed와 특정 출판사 공식 제출 양식 없음
- 표/수식/image/footnote/vertical/multi-column/track-change/import 없음
- Hancom security module 미등록, actual HWP 변환 없음
- Bridge는 framework-dependent x86 .NET 10 runtime 필요
- Executable signing/installer/auto-update/distribution license corpus 미완료
- Runtime EPUBCheck/JRE bundle은 distribution hardening으로 deferred

## 22. 당시 Phase 1I 진입 판단

이 문서 작성 당시 판정은 `WITHHELD`였으므로 Phase 1I 진입을 선언하지 않았다. HWPX actual, general/
long-form coverage, development/fresh-unpacked Electron과 최종 command가 모두 PASS하면
private-local Phase 1I 기술 작업을 진행한다는 것이 당시 조건이었다. 현재 코드에는 좁은
Phase 1I 구현이 존재하지만 Phase 1H actual 판정은 계속 보류한다. 현행 개발·배포 경계는
[AGENTS.md](../AGENTS.md)와 [개발 계획](../PLANS.md)을 따른다.

## 23. 현행 계획 참조

다음 실행 작업, 필수 command와 HWP 별도 조건은 [PLANS.md](../PLANS.md)에서 관리한다.
새 실행 근거가 확보되면 해당 commit·환경·hash·결과를 이 문서와 성능 문서에 기록한다.
계획 목록 정리는 실행 성공이나 최종 판정 변경을 뜻하지 않는다.

## 24. 2026-09-30 development 실패와 프리셋 재현

`80225d3`와 `451e085`의 H development 실행은 첫 preset·snapshot·scene export·close를
통과한 뒤 `normal-export-reopen`의 `phase1h-validation-complete`에서 **FAIL**했다.
`7c87e83`의 부모 callback 재조회 수정 뒤 `451e085`에서는 IDLE·validation NONE·alert 1을
관측했다. HWPX save 0회, renderer diagnostic 0건이었다. 이는 전체 H 성공이 아니다.

같은 source의 narrow input 진단은 **DIAGNOSTIC_ONLY / acceptance=false**이며,
첫 custom preset preflight의 오류를 main의 고정 stale throw 위치에 매칭했다.
후속 실제 native probe는 기본·소수점 설정 모두에서 Core hash와 JS 재해시의 차이를
확인했다. Core의 `f64` 숫자 표기에는 `.0`이 있지만 JS 재직렬화에는 없다.
create·list·get·새 core process reopen에서 설정과 Core hash는 안정적이었으며,
합성 복제의 저장 hash만 변조했을 때 Core가 canonical hash 오류 `-32010`으로 거부했다.
저장 형식의 해시는 Core canonical bytes를 기준으로 유지해야 한다.

Probe source는 `451e0855634417e6d0007d3cef064ab89df5f19b`이며, 사용한 기존 Debug core의
SHA-256은 `91b738092c02cf8e772f39648f586910a08114ea9f16d3689e23d238ebbba9a3`이다.
합성 fixture·Core canonical golden bytes·receipt는 ignored
`.tools/verification/hwpx-preset-hash-probe-runs/2372763f-ee06-43e9-9dd6-bf305dc46f7d/`에
보존했다. Native child 3개는 정상 종료했고 임시 영역을 제거했다. Probe acceptance는
false이며 전체 Windows gate, H 성능·network 또는 수정 후 성공으로 확대하지 않는다.

G development의 `80225d3` **PASS**는 독립 EPUB 근거다. 같은 최종 후보의 full verification과
development/fresh-unpacked H actual이 끝나기 전까지 Phase 1H actual은 **WITHHELD**다.

`bf357ca`는 저장 custom preset에서 main의 중복 JS 재해시 비교만 제거한다.
Core가 검증한 fresh hash와 renderer hash의 일치, config 동등성, revision·ownership·exporter
반환 hash 검사는 유지한다. Built-in·one-off와 `.madi` 형식은 바꾸지 않았다.
실제 Core canonical golden bytes를 쓴 정상 수락 2건은 수정 전 stale 오류로 실패한 뒤
수정 후 통과했다. 잘못된 supplied hash·config 거부 2건도 통과했다.
수정 worktree의 H service·workspace·export tab 3파일 34테스트, Desktop typecheck,
format 287파일·diff 검사가 실제 통과했다. 이 focused 결과는 새 actual 판정을 대신하지 않는다.

같은 제품 변경과 기록을 포함한 `76f7dafd9326b419e5df0a1b1231fd770e634bde`에서
frozen install·Desktop build는 통과했다. 후속 H development는
`phase1h-markdown-contract`에서 **FAIL**했다. 실패 context는 VALID·alert 0,
HWPX save 6회·JSON report save 6회·Markdown save 1회·renderer diagnostic 0건이다.
제품 Markdown은 `scope (nodeId)/revision`을 표시하지만 harness는 중간 node ID를
생략한 `scope/` 부분 문자열을 찾았다. 문서 계약의 세 identity를 한 줄에서 정확히
검사하도록 정정하며 제품 formatter와 기존 coverage·network·privacy·timeout·cleanup
조건은 유지한다. 장편·일반 no-clobber·최종 종료·fresh package는 이 실행에서 미도달했다.
Owned inactive-desktop host는 source clean before/after·exit 1·active job 0·desktop 제거를
기록했다. 실패 evidence는 ignored `.tools/verification/phase1h-development-76f7daf-run1/`에
보존했다. 전체 H actual 판정은 계속 **WITHHELD**다.

`66e9c2d`는 잘못된 두 부분 조건을 scope·node ID·revision 전체 줄의 exact 검사로
교체했다. 기존 Markdown unit에도 같은 세 identity의 literal 줄 검사를 추가했다.
수정 worktree의 service 20테스트, smoke Node 구문 검사, format·diff 검사는 통과했다.
제품 formatter·다른 gate 조건은 그대로이며 후속 actual은 아직 완료되지 않았다.

`55d1d45ea4e8430b7b0182fd16a9c4f715b945ed`에서 frozen install·Desktop build와 후속
development H actual이 **PASS**했다. 일반 원고의 preset·snapshot·여섯 scope/split export·
overwrite·Markdown report·no-clobber와 정상 종료, 장편 취소·5회 export·정상 종료를 완료했다.
장편 exporter 최대 시간은 772 ms이며 전체 UI 대기·Publication IR 시간과 구분한다.
이 실행의 owned inactive-desktop host는 source clean before/after·exit 0,
UOI_IO=false 2,115회·입력 Default 관측·active job 0·desktop 제거를 기록했다.
실행 시간은 host 기준 1,084.884초다. 상세 JSON·고정 harness source·hash는 ignored
`.tools/verification/phase1h-development-55d1d45-run1/`에 보존했다.
이는 해당 development 실행의 성공이며 최종 full verification·fresh-unpacked H actual은
아직 대기 중이다. 그 실행들이 완료되기 전까지 최종 Phase 1H 판정은 **WITHHELD**다.
