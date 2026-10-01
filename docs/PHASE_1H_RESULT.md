# Phase 1H — HWPX Export & Optional Local HWP Bridge 결과

기준일: 2026-08-13  
후속 갱신일: 2026-10-01
문서 상태: baseline/source51/source660 history preserved; exact source5151 full development/fresh actual PASS

이 문서는 아래 기준일의 구현·실행 근거와 revision별 후속 actual을 보존한다. 현행 목표와
작업 순서는 [PLANS.md](../PLANS.md)를 따른다. 현재 판정은 section29의 exact source5151
development/fresh 실제 검증에 근거하며 과거 `WITHHELD`와 source51 실패는 해당 시점의 기록으로 남긴다.

## 1. Phase 1H 최종 판정

```text
Phase 1H verdict: TECHNICAL GO — HWPX / PRIVATE LOCAL ONLY
Actual tested source: 5151f6a804cf1565a09211ea8f7a11e9f547fd34
HWPX source5151 actual: DEVELOPMENT PASS / FRESH-UNPACKED PASS
Full pinned Windows aggregate source5151: PASS / exit0 / 5256.600s
HWP Automation: ACTUAL OPEN FAILURE / DISABLED / MANUAL ACCEPTANCE PENDING
Public/paid/customer/installer distribution: NOT APPROVED
```

기준일에는 일반·675,000자 development/fresh actual이 미완료였다. Source51의 개별 actual
성공과 full 실패는 section27, source660의 전체 실제 성공은 section28, 새 source5151은 section29에 기록한다.
필수 6개 명령의 실행 범위와 package join을 구분하며 HWPX private-local 기술 성공을
수동 Hancom 검증이나 배포 승인으로 해석하지 않는다. 최종 문서 commit과 실제 검증 source5151도 구분한다.

후속 clean ad7fb61에서 사용자가 임시 module·합성 로컬 시험을 승인했다. source5151 bridge는
OPEN_FAILED, 별도 진단은 실제 Open=false/getters 성공을 관측했다. HWP output·reopen 성공은 없다.
Section29의 HWPX 내부 실제 경로 판정을 실제 한컴 호환성 GO로 확대하지 않는다.
현재 host와 실패·중단·정리 범위는 [Hancom actual section9](HANCOM_AUTOMATION_VALIDATION.md#9-2026-10-01-private-local-actual)에 보존한다.

재개 후 cleanCCD의 좁은 진단에서는 독립 빈 HWPX의 정확한 FullName·단일 현재 문서·empty/unmodified와
Close BOOL true→Quit→native exit를 통과했다. 마디 원본과 major0→5 단일 변경 시험본은 모두 native 문서 식별에 실패했다.
이 결과는 source5151의 내부 HWPX 판정이나 최종 한컴 acceptance를 대체하지 않는다.
제품·ZIP은 변경하지 않았고 HWP conversion/reopen·본문 coverage·network gate는 미통과다.
상세 원본·승인·관측 범위는 [Hancom 재개 후 기록](HANCOM_AUTOMATION_VALIDATION.md#10-2026-10-01-resumed-native-controls)을 따른다.

## 2. Runtime EPUBCheck 재분류 결과 — 기준일 기록

아래 DEFERRED는 기준일의 기록이다. Source5151의 bundled offline runtime과 배포 준비 결과는
[오프라인 runtime·release 결과](OFFLINE_RUNTIME_RELEASE_RESULT.md)를 따른다.

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
target은 15초다. 기준일에는 actual evidence가 없어 수치와 PASS를 `WITHHELD`로 기록했다.
후속 source51 development/fresh 실측은 section27과 [성능 문서](HWPX_EXPORT_PERFORMANCE.md)에 기록한다.

## 16. 테스트 결과

아래 표는 기준일에 확정한 focused/static 경계다. 후속 실행의 결과로 과거 표를 덮지 않는다.

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

당시 최종 aggregate command의 independent elapsed/exit는 미확보였다. 현행 필수 6명령은
[PLANS.md](../PLANS.md)를 따른다. 실행하지 않은 명령을 PASS로 적지 않는다.

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

## 25. 2026-09-30 후속 full Windows 실행과 저장 오류 재현

`b21827ae0d6ccd1ac5995fa160306f17583a3a5b`의 frozen install은 성공했다.
같은 clean source의 `pnpm verify` run1은 4021.131초 후 exit1로 종료했다.
Desktop 103파일·678테스트, native·CLI·build와 development basic/D/E/F/G/H는 통과했지만,
`pretest:package`의 Phase E fixture 생성 중 `create_tree_node -32000`으로 실패했다.
따라서 새 unpacked package와 packaged actual은 미도달이며 전체 성공으로 기록하지 않는다.

이 실행의 H development는 장편 5회 모두 450 sections, 2411 blocks
(1961 exported + 450 fallback + 0 omission + 0 rejected), 675000자를 보존했다.
VALID fatal/error0·warning451을 유지하며 ZIP/XML reopen과 byte/logical 결정성은 통과했다.
Exporter median/max는 755/768ms, IR compile은 61677.31/62004.99ms,
click부터 output read/reopen까지 wall은 63462.74/63794.01ms다. Development에서는
exporter hard target을 적용하지 않았으므로 fresh-unpacked 15초 target 성공으로 이전하지 않는다.
Renderer HTTP/WebSocket과 owned TCP non-loopback·경계 위반은 0이었다.
세 app의 정상 종료·native exit·wrapper 정리 진단은 0, 잔여 소유 프로세스도 0이었다.
Hancom 실제 변환·reopen은 실행하지 않았고 기존 비활성 조건을 유지한다.

Full host는 시작·끝 같은 source SHA와 tracked clean을 기록했다. Input desktop은
7839/7839 samples에서 Default, owned desktop은 모든 sample에서 비활성이었다.
Job2082의 cleanup active0, process/thread/job handle과 desktop 정리를 확인했다.
Evidence는 `.tools/verification/full-verify-b21827a-run1/`에 보관했다.
H JSON SHA-256은 `9fa4a2db9bdaa6498d146978982ddeab9e270954bd31721d869d8581b5fa1786`다.

원본 generator를 유지한 별도 진단에서도 `create_entity -32000`을 재현했다.
보존한 synthetic DB는 revision107·entity53으로 실패 항목이 없었고 mutation은 미커밋이었다.
기존 CLI의 공통 백업 경로 120회는 성공했으므로 이를 exact entity 재현으로 표현하지 않는다.
Pinned production rlib에 연결한 ignored native dispatch 진단에서는 같은 프로세스의 연속 생성 중
I/O·Windows native code32를 확인했다. 실패 요청 expected revision241과 실패 후 revision241은
같았으며, 진단 acceptance는 false다. 구체 fs 단계와 최초 full 실패의 인과는 아직 확정하지 않는다.
이 진단은 H actual 판정의 근거가 아니며 최종 판정은 계속 **WITHHELD**다.

## 26. 2026-10-01 백업 공유 위반 수정과 회귀 검증

`4463d7a6ee220a667a630e7d61cdcfe49f12680d`는 `create_consistent_backup` 내부의
sync·remove·rename에만 Windows I/O32/33 재시도를 적용한다. 간격은 20ms, 파일 작업당
재시도 budget은 500ms이며 sleep 후 deadline을 다시 확인해 만료 뒤 새 시도를 시작하지 않는다.
OS syscall 자체 실행 시간의 hard 상한은 뜻하지 않는다. SQLite VACUUM·전역 sync·원고 mutation
전체의 재시도, 새 설정·의존성은 추가하지 않았고 원래 회전·rollback·오류 반환은 유지한다.

이 수정 worktree에서 실제 Windows `share_mode(0)` previous-backup 잠금 회귀를 실행했다.
Baseline은 잠금 해제 후 저장 1건이 I/O32로 실패했고, 수정 후 저장 roundtrip 7개는 모두 통과했다.
성공 시 revision이 한 번 증가하고 원고·snapshot·두 백업 revision을 확인했다.
영구 previous-backup 잠금 시 원고·revision과 두 백업의 byte-exact 불변, 잠금 해제 뒤
같은 expected revision으로 저장 성공도 확인했다. 잠금 해제 검사는 150ms timer를 사용하며
baseline 실제 RED를 확보했지만 모든 scheduler에서 최초 공유 충돌이 발생함을 보장하는 hook은 아니다.

최종 오류 분류 unit은 rustc object 파일 삭제 I/O32로 두 번 컴파일 실패해 테스트에 미도달했다.
별도 단일 명령의 `CARGO_INCREMENTAL=0`에서 최종 코드의 2테스트가 모두 통과했다.
다른 I/O·SQLite 즉시 반환과 code33 회복을 확인했으며 code33은 합성 unit 증거다.
실제 파일 잠금 증거는 code32다. 증분 cache 제어는 [Cargo 공식 환경 변수](https://doc.rust-lang.org/cargo/reference/environment-variables.html)를
따르며 compile 실패의 근본 원인을 이 성공으로 확정하지 않는다. 시스템 보안 설정은 변경하지 않았다.
Logs·환경 receipt는 `.tools/verification/backup-sharing-b21827a-regression-run1/`에 보관했다.
당시 Repository·format·diff 검사는 통과했고 새로운 full Windows·fresh actual은 대기 중이었다.
후속 검증은 아래 source51 실행으로 구분한다.

## 27. 2026-10-01 exact source51 full 실패와 standalone actual

검증 source는 `51c1e6cdc10107d76e30103fbe1d6f4d035218e3`다. Node26.3.1/pnpm11.9.0/
Rust1.97.1/.NET10.0.400, jobs1/workers2와 command-local `CARGO_INCREMENTAL=0`을 사용했다.
원본 E generator 두 번은 각각422 requests를 통과했다. 이 focused 성공은 전체 gate가 아니다.

| 실행 | 실제 결과 |
| --- | --- |
| Full run1 | FAIL/exit1/1539.756초. Desktop678·core63·native·WASM·CLI·build·basic 통과 후 development D의 filters opened 이후 Error messageLength71. 실패 조건·인과 미확정 |
| D 후속 확인 | Readiness diagnostic33.411초/acceptance=false; 원본 stock D 두 번 PASS34.231/34.988초. 원 full 실패의 인과를 확정하지 않음 |
| Full run2 | FAIL/exit1/5133.172초. Desktop103파일/678테스트·native·CLI·build·development basic/D/E/F/G/H·prepackage D/E/F·package build·fresh basic 통과 후 fresh D pointer-center wait 실패(messageLength88). 이 full의 fresh E/F/G/H는 NOT_REACHED |
| 후속 standalone fresh E/F/G/H | 각각 공식 PASS/exit0. Host metadata elapsed50.495/126.316/80.444/101.537초. Full run2의 결과를 PASS로 바꾸지 않음 |

두 full은 시작·끝 같은 source와 clean을 기록했다. Run1 job817/cleanup active0/no forced termination,
Input Default3003 samples였다. Run2는 UTC16:09:10.9771007→17:34:44.1609365,
job2156/cleanup active1/owned-job 강제 종료 후 job empty·handle/desktop 정리를 기록했고
Input Default10011 samples였다. 후속 standalone host는 active0/no forced termination이었다.
V3는 fresh D 원본88조건을 actual selected가 height503 canvas 밖인 상태로 재현했다.
V4는 center 이동을 반복 VIEWPORT 적용이 덮는 journal을 보존했다. 두 진단은 acceptance=false이며
H actual이나 새 수정의 aggregate 성공으로 분류하지 않는다. 현행 수정·재검증 상태는 PLANS를 따른다.

Source51 H development와 standalone fresh는 일반6 scopes, preset CRUD·snapshot/reopen·overwrite·
Markdown·no-clobber·취소·정상 종료를 완료했다. 장편5회 각각 sections450/450,
blocks2411=1961 exported+450 fallback+0 omission+0 rejected, characters675000/675000,
VALID fatal/error0·warning451, ZIP/XML reopen을 확인했다. 최초 custom scene의 의도한 omission1은 별도다.
장편 output31867bytes와 byte/logical/source/preset 해시는 각5회와 development/fresh 사이 모두 같다.

| 장편 identity | SHA-256 |
| --- | --- |
| Output | `0dd78a22ae530a85506bf05087e0ddc07f27d1d2704dd5a05be9bba52298afde` |
| Logical package | `f09e22b7841aaee73a0a6445440f419b55cf55ed30461eb19eb175453652afe0` |
| Source Publication IR | `eba872b8ce302e8ff54c9f3417a115768f0d0ebbaa1f33c87ed37f706854626b` |
| ONE_OFF preset | `5651a452f234acdf399e9ba3c3dd8007a888f46d1693740f59fff66230a17bbb` |

Development exporter median/max769/773ms, runtime IR59052.25/59144.39ms, wall60824.30/60922.14ms.
Fresh exporter76/77ms, IR2583.83/2634.53ms, wall3541.54/3601.06ms다.
Fresh 일반5초·장편15초의 exporter 기준을 실제 적용해 모두 통과했다. Wall은 별도 관측값이다.
Renderer HTTP/WS와 owned birth-based TCP nonloopback·peer/listener 위반·classification/identity race/
parser reject는0, session spellcheck enabled=false/languages0였다. 세 lifecycle의 제품 종료·native exit·
wrapper 진단0, wrapper 전 native alive0, exact captured exit·잔여0, recovery/artifact cleanup0을 확인했다.
Fresh 개발용 renderer·core/exporter/bridge/atomic override canary는 요청0/파일 생성false였다.
Hancom REGISTERED_UNVERIFIED/HWP disabled/security module false/COM-HWP attempt false/reopen NOT_RUN 유지.

Evidence는 ignored `full-verify-51c1e6c-run2/`와 `phase1{e,f,g,h}-packaged-51c1e6c-run1/`에 보존했다.
Development H JSON SHA는 `0f7f9428194948dfa8aa3eec613797280d209e2ae13ea6f0fe5b7d3cc19a04cc`,
fresh H는 `64e2ae11c222c34193dd2c55d21b6aec275bad1ae69e28fe21779de08d9c384a`다.
Same-run `package-unpacked-receipt.json` SHA는 `a32f82a5f35a17d312fcfe5a7f1a9e5e43f776fb4dc813bcdc34ab887d83c6b4`,
source join은 `60e554d41919bb3182e7f55eb0e2e3beea64e95856501d20beeec5b7888b787b`다.
Source/build/log·선택 inventory101files/233244993bytes를 연결했고 sidecar4+bridge4 SHA/bytes가 일치했다.
Receipt는 중첩 `package:unpacked` 성공이며 별도 실행 시간을 만들지 않는다. Inventory는 acceptance=false/
freshness 추정false이고 전체 Electron runtime/license 목록이나 actual gate를 대체하지 않는다.
`36cbf72e51667e06f0124651396f448d5a3d73db`는 D World Graph의 viewport 경합을 좁게 수정했다.
작업 중 회귀 RED→GREEN2·관련21테스트·typecheck는 통과했지만 수정 후 actual/full은 미실행이다.
이 section27 기록 시점에는 source51의 개별 development/fresh H 성공에도 full 실패와 새 후보
검증 대기로 최종 **WITHHELD**였다. 현재 판정은 다음 section28의 새 actual을 따른다.

## 28. 2026-10-01 exact source660 full Windows actual 완료

실제 검증 source는 `660814c7745a5231038aba902fd7113022778238`이다. Node26.3.1/pnpm11.9.0,
pinned Windows 경로와 명령 process에만 `CARGO_INCREMENTAL=0`을 적용했다. Build environment·
source hashes·38개 원본 source copies·각 evidence의 byte-exact archive를 보존했다.
`full-verify-660814c-run1`은 UTC2026-09-30 18:40:41.7297632→20:09:34.8733957,
5333.110초, PASS/exit0/timeoutfalse/source clean before·after로 종료했다. Development와 fresh의
basic/D/E/F/G/H가 같은 full에서 통과했다. 이전 source51 full 실패를 성공으로 다시 분류하지 않는다.

| 필수 명령 | Source660 실행 근거 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 별도 owned frozen-install host PASS/exit0,1.507초 |
| `pnpm verify` | 같은 full host PASS/exit0,5333.110초 |
| `pnpm package:unpacked` | full의 중첩 pretest:package에서 PASS; 별도 elapsed를 만들지 않음 |
| `pnpm check:repository` | 원래 순차 verify chain과 parent exit0; 독립 exit/time 기록 아님 |
| `pnpm format:check` | 원래 순차 verify chain과 parent exit0; 독립 exit/time 기록 아님 |
| `git diff --check` | source660 clean에서 root 실제 실행 PASS; 관측 시각과 정확한 명령 시작·끝을 구분 |

`required-six-command-join-v2.json` SHA는
`8db9a79f2adbe3af7276bc0006a5c3c80bad4a64991807d97159d48f46e5409f`다.
같은 full의 Windows unpacked stdout receipt SHA는
`0d387571a8883a49333e21537f719be793b94e67c2b0b24a8a86696f9978abfa`, source join은
`5c22daf65da23c07abe71422ba164da0ac0f3f3956ce95e977124331683f1582`다.
Selected inventory SHA `61400280b6d56f09307a545b1a0035d124a020d0a07f1de28e00924c8383e51c`
의101files/233245115bytes(madi.exe/app package.json/dist91/bin8)와 source/build/log를 연결했다.
Sidecar4+bridge4의 copied SHA/bytes가 모두 일치했다. Inventory와 archive helpers는 acceptance=false/
freshness inferred=false이며, actual fresh 실행이나 전체 Electron runtime/license 목록을 대신하지 않는다.

| H actual archive | SHA-256 |
| --- | --- |
| Development | `116da2ad688c0b3730a3050e8bd1c0715b3b3616d578cbd561c7bf3f3121810e` |
| Fresh-unpacked | `0316e71a2a6b710daf76c858bdd968c4e3a0759e346fc9d599406433b5cab920` |

두 JSON은 ignored `full-verify-660814c-run1/`의 `development-phase1h-evidence.json`과
`packaged-phase1h-evidence.json`이다. 원본 mtime은 각각19:46:01.8302467Z/20:09:34.3270108Z로
full 시작·종료 안이며 현재/보관 source38개 hash, terminal metadata/log/exit/environment를 join했다.
Metadata SHA `427310cc1acc78b914b46a242d92ce63d4d7cb5e8dad582eaf91f973992ddc42`,
command-log SHA `ed4e626544e713f0329c5c65e74f4acc9b0340cf326c46749b30e60207639080`도 보존했다.

Normal6 scope/split에서 source block은 WORK323=263 exported+60fallback,
VOLUME162=132+30, CHAPTER18=15+3, SCENE8=7+1이며 configured omission/rejected0다.
Source/exported characters180000/90000/9000/3000 일치, VALID fatal/error0·warnings61/31/4/2를 보존한다.
Long5는 매회450 source/exported sections·10 package sections,
2411=1961 exported+450fallback+0omission+0rejected,675000 characters 일치,
VALID fatal/error0·warning451·ZIP/XML reopen·source paragraph sequence·rich semantics를 확인했다.
Output31867bytes와 section27에 기재한 output/logical/Publication IR/ONE_OFF preset 네 hash를
새 dev/fresh 각5회에서 직접 비교해 모두 같음을 확인했다. Source51의 판정을 이전한 것이 아니다.
첫 custom scene의 configured omission1과 ruby fallback 경고도 그대로 남겼다.

Preset CRUD·snapshotv5·safety snapshot·새 process reopen·one-time contact isolation,
confirmed overwrite 결정성·no-clobber concurrent destination 보존·PREPARING cancel의 output/
late success/progress 부재가 양쪽 actual에서 통과했다. Fresh renderer canary requests0,
core/exporter/bridge/atomic overrides absent, packaged path pinning/사용된 bundled binary 경로 일치였다.
Renderer HTTP/WS와 owned instance TCP nonloopback·peer/listener 위반·classification/identity race/
parser reject0, process identity rejected rows0, session spellchecker enabled=false/languages0였다.
세 lifecycle의 product close→quit/quit→native exit/wrapper unexpected diagnostics0,
wrapper 전 native alive0, PID+Win32 birth와 ChildProcess close receipts의 exact captured exit/
descendants0, artifact/temp/recovery/claim/symlink0을 확인했다. Receipt와 birth counts는 별개 증거다.

Host는 job2628/cleanup active0/no owned-job or unassigned forced termination,
Default input10401/inactive UOI_IO false all, job empty·process/thread/job handles·desktop 제거를 기록했다.
Development exporter median/max763/772ms와 fresh78/79ms 및 IR/wall 차이는
[성능 문서의 source660 actual](HWPX_EXPORT_PERFORMANCE.md#8-exact-source660-developmentfresh-actual)을 따른다.
Fresh normal5초/long15초 exporter total 기준을 실제 적용해 모두 통과했다.

Hancom REGISTERED_UNVERIFIED/HWPdisabled/security modulefalse/COM-HWP attemptfalse/reopenNOT_RUN은 유지한다.
Native Korean IME·Hancom licensing/security/conversion/reopen·runtime EPUBCheck/JRE packaging은 수동 또는
출시 전 PENDING이다. G의 EPUBCheck actual receipt `packaged=false`도 distribution packaging 증거로 쓰지 않는다.
Typie permission은 owner-confirmed이며 출시 범위는 외부 grant의 exact terms를 따른다.
Public/paid/customer/installer 배포는 승인하지 않는다. Phase1I의 exact660 dev/fresh actual은 별도 I 결과 문서를 따른다.
이 후속은 actual source660을 기록하는 문서 동기화다. 이후 docs-only HEAD의 정적 검사와 runtime-tested
source660을 구분하고 문서 commit에 새 runtime PASS를 자동 부여하지 않는다.

## 29. 2026-10-01 exact source5151 full Windows actual 완료

실제 검증 source는 `5151f6a804cf1565a09211ea8f7a11e9f547fd34`다. `full-verify-5151f6a-run1`은
UTC2026-10-01T03:15:31.9089127Z→04:43:08.5463271Z,5256.600초/PASS/exit0,
source before/after tracked clean으로 종료했다. Development와 fresh-unpacked basic/D/E/F/G/H가
같은 pinned Windows verify에서 통과했다. 이전 source51/660 수치는 위 이력으로 보존한다.
Runtime bundle·G 취소 대기 정정·dotnet build-server 억제와 과거 실패/집중 실행은
[오프라인 runtime·release 결과](OFFLINE_RUNTIME_RELEASE_RESULT.md)에 모으고, 현행 작업은 [PLANS](../PLANS.md)를 따른다.

Node26.3.1/pnpm11.9.0/Rust1.97.1/.NET10.0.400, Rust jobs1/Vitest workers2,
명령 process 한정 `CARGO_INCREMENTAL=0`과 세 dotnet 명령의 `--disable-build-servers`를 사용했다.
두 H actual 모두 비활성 Win32 desktop·GPU 비활성화 실행임을 runtime flag로 확인했다.
이 환경의 성능 관측을 foreground 기본 GPU 실행 또는 사람의 IME 검증으로 확대하지 않는다.

| Same-run H raw archive | SHA-256 / bytes / receipt mtime UTC |
| --- | --- |
| Development | `9757812c8cf6a0af7b27404048c1952767e2bcbff2eb28480e37585be34d3a70` / 58144 / 2026-10-01T04:21:52.200Z |
| Fresh-unpacked | `8f711f39ec4e46f27d818102ec360428de2bf6180b5e7d4a03ebf2f2e923f815` / 58194 / 2026-10-01T04:43:07.920Z |

원본 JSON은 ignored `full-verify-5151f6a-run1/phaseefgh-proof-archive/`에 byte-exact 보존했다.
두 mtime은 full 시작·종료 안이며 source63 원본/hash·terminal metadata·command log와 연결했다.
Raw H는 PRIVACY_SAFE_SUMMARY_ONLY다. 임시 HWPX/원문 report나 screenshot을 보관했다고 주장하지 않는다.
Terminal metadata SHA는 `31ba4cf8d25783908461b1f5e97374bb8c07dceb24e02048f612c8dfe80fa21c`,
command-log SHA는 `178a5c85ba037287dcbda16685a4762871213b710bc53fa593afeb2cc63be27d`다.

같은 full의 nested package:unpacked stdout 원본 receipt SHA
`b86956227e6bf67b83a0e30f370d2233243eae0af089a5836e46962ed2eb05ea`와 whole tested-package inventory561파일/81디렉터리/
549528995bytes를 연결했다. Inventory payload SHA는
`6ca42b827431aba14d8e3315b1c3cc3621300e3b86b5b7cfd8fbd5af63b92e7f`, inventory 파일 SHA는
`0608619fd9d2bf47ca29bbd2f4da47522a95e7ed0099a04532684033790b965a`다.
Source/hash/package/raw archive의 acceptance=false는 보관 작업 자체를 actual gate로 판정하지 않는다는 뜻이다.
원래 nested 실행을 별도 standalone 명령이나 독립 elapsed로 표현하지 않는다.

Normal6 scope/split은 WORK/SINGLE·확인된 overwrite·VOLUME/CHAPTER/SCENE SINGLE·WORK/VOLUME다.
각 source/exported characters180000/90000/9000/3000과 block balance를 보존했고
VALID/fatal0/error0, 실제 fallback/omission/warning을 유지했다. 첫 custom scene의 configured omission1도 숨기지 않는다.
Long dev/fresh 각5회는450/450 source/exported sections·10 package sections,
2411=1961 exported+450fallback+0omission+0rejected,675000/675000 Unicode scalar characters,
VALID/fatal0/error0/warning451과 ZIP/XML reopen·rich semantics를 확인했다.
출력31867bytes와 아래 네 hash가 두 환경의 각5회 모두 같다. 과거 source의 PASS를 이전한 것이 아니라 새 raw에서 직접 비교했다.

| Long artifact identity | SHA-256 |
| --- | --- |
| Output bytes | `0dd78a22ae530a85506bf05087e0ddc07f27d1d2704dd5a05be9bba52298afde` |
| Logical package | `f09e22b7841aaee73a0a6445440f419b55cf55ed30461eb19eb175453652afe0` |
| Runtime Publication IR | `eba872b8ce302e8ff54c9f3417a115768f0d0ebbaa1f33c87ed37f706854626b` |
| ONE_OFF preset config | `5651a452f234acdf399e9ba3c3dd8007a888f46d1693740f59fff66230a17bbb` |

Preset CRUD·snapshotv5/safety snapshot·새 process reopen·contact isolation, overwrite 결정성,
no-clobber 목적지 보존·Markdown scope/node/revision exact-line·PREPARING UI 취소의 출력/늦은 성공/진행 표시 부재가 양쪽에서 통과했다.
Fresh override canary는 renderer requests0·core/exporter/bridge/atomic overrides absent이며 실제 packaged path pinning도 일치했다.

Renderer HTTP/WS·owned TCP nonloopback/peer/listener 위반·classification/identity/parser·process identity rejected0,
page/renderer/process diagnostics0을 확인했다. 세 lifecycle 모두 product graceful quit,
product close→quit/quit→native exit/wrapper diagnostics0, wrapper 전 native alive0,
exact PID+Win32 birth exit·descendants0과 temp/recovery/claim/symlink0을 확인했다.
H 취소는 PREPARING에서 수행했으며 G의 checker 실행 후 취소와 같은 시험으로 표현하지 않는다.

Host job3533/cleanup active0, owned job/unassigned 강제 종료false, job empty,
process/thread/job handles와 desktop 정리를 기록했다. Input samples10285 중36회는 error5로 이름 판독 불가였다.
판독 가능한 input 이름은 Default였으나 `inputDefaultEverySample=null`을 그대로 유지한다.
별도 UOI_IO 관측의 `desktopInactiveEverySample=true`는 유지됐다. Unknown 구간의 foreground 이름을 추정하지 않는다.

Development exporter median/max906/1075ms, fresh87/96ms다.
Fresh 일반5초·장편15초의 EXPORTER_TOTAL_MS 기준을 실제 적용해 모두 통과했다.
IR·wall 및5회 수치는 [성능 문서 section9](HWPX_EXPORT_PERFORMANCE.md#9-exact-source5151-developmentfresh-actual)를 따른다.

판정은 **TECHNICAL GO — HWPX / PRIVATE LOCAL ONLY**다. Hancom REGISTERED_UNVERIFIED,
HWPdisabled/securityModuleVerified=false/COM-HWP attemptfalse/reopen NOT_RUN을 보존한다.
Native Korean IME·Hancom licensing/security/conversion/reopen은 사람의 검증 PENDING이다.
Typie 개발 permission owner-confirmed와 외부 grant의 정확한 출시 범위, signing/installer/공개·유료·고객 승인은 별개다.
Phase1I actual은 별도 I 결과 문서를 따르며 이 H 성공으로 AI network 범위를 확대하지 않는다.
이후 docs-only HEAD의 정적 검사와 runtime-tested source5151을 구분한다.
