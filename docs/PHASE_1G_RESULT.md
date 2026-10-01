# Phase 1G — EPUB Export & Validation 결과

## 현재 판정 — 2026-10-01, exact source5151f6a

```text
Tested product source: 5151f6a804cf1565a09211ea8f7a11e9f547fd34
Pinned full Windows verification: PASS / exit 0
Development/fresh-unpacked EPUB runtime actual: PASS
Final Phase 1G verdict: TECHNICAL GO — EPUB / PRIVATE LOCAL ONLY
Runtime EPUBCheck 5.3.0 / Temurin JRE 21.0.11+10: BUNDLED AND ACTUALLY VERIFIED
Windows native Korean IME / Hancom conversion: HUMAN VALIDATION PENDING
Public/paid/customer/installer distribution: NOT AUTHORIZED
```

현재 판정은 아래 §16의 exact-source full actual에 적용한다. 후속 docs-only HEAD는 새로운
runtime-tested source가 아니다. Runtime bundle packaging의 기술 검증은 완료됐으며, portable
ZIP의 별도 기록과 배포 한계는 [오프라인 runtime·배포 준비 결과](./OFFLINE_RUNTIME_RELEASE_RESULT.md)에
구분한다. Typie 허용 범위는 [license status](./TYPIE_LICENSE_STATUS.md)를 따른다.
아래 2026-08-12 판정과 §1–15의 수치·제한은 당시 결과를 보존한 역사 기록이다.

기준일: 2026-08-12

```text
Repository implementation: COMPLETE
Development Electron actual: PASS
Fresh-unpacked Electron actual: PASS
Final Phase 1G verdict: CONDITIONAL TECHNICAL GO — RUNTIME EPUBCHECK PACKAGING PENDING
Development boundary: PRIVATE LOCAL ONLY
Windows native Korean IME: MANUAL VALIDATION PENDING
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Public/paid/customer distribution: NOT AUTHORIZED
```

이 문서는 저장소 구현 감사와 development/fresh-unpacked actual 결과를 한곳에 보존한다.
두 actual은 content/package/atomic/lifecycle/security gate를 통과했고 장편 5회 output의
section/block/character loss는 0이었다. 조건부인 이유는 실제 3.3 EPUB의 EPUBCheck 5.3.0
검증이 build/test harness에만 있고 unpacked app runtime에는 EPUBCheck/JRE가 없기 때문이다.
이 판정은 배포 승인이 아니며 비공개 로컬 기술검증에만 적용한다.

## 1. Reader Lab interaction 최적화

Reader 설정 변경 경로는 visible update와 full-scope analysis를 분리했다. Pane은 config
변경을 rAF generation으로 batch하여 CSS variables와 visible section을 먼저 commit한다.
Full measurement/statistics/layout diagnostics는 `requestIdleCallback` 또는 timeout scheduler로
넘기며 key/generation guard가 stale result를 버린다.

Publication hash+resolved config measurement cache와 layout diagnostic cache는 LRU 4개로
제한한다. Full result가 새 key에 대해 완료될 때까지 UI는 `측정 중…`과 추정값을 명시하며
이전 COMPLETE 값을 최신값처럼 표시하지 않는다. Publication IR 재compile은 Reader setting
변경과 분리된다.

최종 Phase 1F-named Reader smoke는 Phase 1G interaction 최적화가 반영된 같은 worktree에서
development/fresh-unpacked Electron을 다시 측정했다. 장편 setting visible 5회 median/maximum은
development `148.32/150.54 ms`, fresh unpacked `184.10/200.46 ms`로 약 250ms 목표를
통과했다. Fresh-unpacked 장편 first visible도 `2,259.50/2,345.10 ms`로 3초 안이다.

장편 full measurement+layout diagnostics는 반복 분포가 아니라 환경별 단일 workflow
관측이며 development `7,734.38 ms`, fresh unpacked `7,827.55 ms`였다. 두 환경 모두 450
section/2,411 block 전체, diagnostic 900개, horizontal overflow 0과
`measurementStatus=COMPLETE`/`layoutStatus=complete`를 확인했다. Electron evidence에는 stale
callback count가 없으므로 stale-result 0이라고 과장하지 않는다. 별도
`reader-preview-pane.test.tsx` focused test 1 file/11 tests PASS가 next-frame visible config,
async full measurement, stale generation drop, cache reuse와 120/120·300/300 block 보존을
검증했다. 이 focused test의 개별 시간은 actual 성능 표본이 아니다.

## 2. EPUB exporter와 Publication IR 경계

새 `crates/madi-export-epub` crate는 `madi-publication`의 `PublicationDocument v1`만
소비한다. Typie crate, snapshot/type, `.madi` SQLite, React/Reader DOM을 직접 읽지 않는다.
Compiler/validator library와 JSON-lines utility binary를 함께 제공한다.

Pipeline은 strict request 검증, CHAPTER/SCENE split, XHTML, OPF/nav/CSS, deterministic ZIP,
internal validation, hash, utility-owned temp write로 구성된다. Electron main은 저장
metadata/preset/cover/revision, utility terminal summary, source coverage와 staged bytes를
다시 확인한 뒤 destination을 commit한다.

## 3. EPUB 3.4 Draft / 3.3 compatibility

- `EPUB_3_4_DRAFT_2026_08`: Candidate Recommendation Draft target
- `EPUB_3_3_COMPATIBILITY`: stable compatibility target

두 profile은 Phase 1G에서 OPF `version="3.0"`인 공통 reflowable subset을 생성한다. 3.4
전용 기능은 없다. UI/report는 3.4를 Draft로 표시하고 EPUBCheck 5.3.0 결과를 3.4 완전
검증으로 표현하지 않는다.

## 4. Package layout과 XHTML mapping

`mimetype`은 첫 Stored entry이고 container rootfile은 `EPUB/package.opf`다. Nav, built-in
CSS, ordered content files와 optional sanitized cover를 포함한다. Entry order/timestamp/path,
manifest/spine/TOC와 source-derived ID는 deterministic하다.

Heading은 `h1`–`h4`, paragraph는 `p`, quote는 `blockquote > p`, scene break는 `hr`,
strong/emphasis/underline/strike/ruby는 각각 semantic XHTML로 mapping한다. Unsupported block은
escaped plain-text fallback과 warning으로 보존한다. Script-like 원고도 text로 escape한다.

## 5. Metadata, cover와 export preset

Schema 7은 `publication_metadata`, 하나 이하의 project COVER를 저장하는
`publication_assets`, generic envelope의 `export_presets`를 추가한다. Logical file version은
1이다. Metadata default는 project title/author, `ko-KR`, project ID 기반 stable identifier다.

Cover는 PNG/JPEG, 10 MiB, 10,000 px/40,000,000 pixel 한계를 적용한다. Bounded single-handle
read, magic/decode/hash/dimension 검증 뒤 bytes만 `.madi`에 저장하며 source path는 저장하지
않는다. Exporter는 pixel decode 후 PNG/JPEG로 재인코딩한다.

Preset v1은 profile, split, TOC depth, title/cover flags와 closed style token만 저장한다.
Unknown/arbitrary CSS는 거부하고 identical canonical JSON save는 revision을 올리지 않는다.

## 6. Navigation, manifest와 spine

TOC depth와 chapter/scene title flag에 따라 `nav.xhtml`의 nested ordered list를 만든다.
Link는 content manifest item과 stable block fragment를 가리키며 source heading order와
동일해야 한다. Manifest ID/href와 spine itemref는 고유하고 실제 entry/content order와
일치해야 한다. Optional cover는 `cover-image` property가 정확히 하나일 때만 유효하다.

## 7. Internal validation

Internal validator는 bounded ZIP reopen, mimetype/container, OPF metadata/manifest/spine,
nav/link/fragment/order, XHTML/XML/language/style/active-content, CSS/asset와 orphan/missing
resource를 검사한다. Compilation expectation을 사용해 source/exported section, stable
block ID별 Unicode character, heading, scene break, ruby와 fallback/cover를 대조한다.
Fatal/error 또는 rejected/content mismatch는 output success가 아니다.

## 8. EPUBCheck와 runtime packaging

Exact EPUBCheck 5.3.0과 Eclipse Temurin JRE 21.0.11+10-LTS는 ignored
`.tools/phase1g-validation`에서 build/test에만 사용한다. Distribution ZIP/JAR/JRE/java.exe의
size와 SHA-256을 실행 전에 확인하고 offline-hardened 120초 bounded process로 CHAPTER/SCENE
3.3 fixture를 검사한다.

Unpacked runtime에는 Java executable 0, JAR 0, EPUBCheck runtime payload 0이다. App runtime은
`madi-export-epub.exe`의 internal validator만 제공하고 package에는 EPUBCheck 본체의 BSD
3-Clause 고지 원문만 넣는다. Runtime EPUBCheck packaging은 JRE update/license/package
부담 때문에 deferred다.

Actual이 보존한 3.3 compatibility EPUB는 development/fresh-unpacked에서 모두 `63,779 B`,
SHA-256
`527f55f49bcb465df8792e1af0e662664c4185ab5deccd0a6ed94f677503788c`로 동일했다. Build/test
harness의 EPUBCheck 5.3.0 결과는 각각 `3,001.34 ms`, `3,679.22 ms`이고 fatal/error/warning/
info는 모두 0이다. 이 결과는 runtime packaging 증거가 아니며 3.4 완전 검증으로 표현하지
않는다.

## 9. Snapshot payload 5와 migration

Named snapshot payload 5에는 publication metadata, COVER bytes와 export preset을 넣는다.
Generated EPUB, output path, report, validation cache/EPUBCheck output, last export와 temp는
넣지 않는다. Diff는 metadata/cover 변경과 preset added/deleted/changed count를 표시한다.

Restore는 기존 safety snapshot/hash/transaction 흐름 안에서 export state ownership/hash를
검증하고 전체 rollback한다. Payload 1–4 exact shape decode를 유지하며 v5 field를 forged한
legacy payload는 거부한다. Legacy restore는 current project default publication metadata와
빈 cover/preset으로 돌아간다.

## 10. Atomic output, cancel와 deterministic output

Output picker의 기존 destination은 선택 당시 size/SHA-256을 기록하고 commit 직전에 다시
대조한다. Main은 같은 destination directory의 UUID operation staging directory를 create-new로
소유한다. 새 file은 hard-link no-clobber, 확인된 기존 file은 same-directory rename으로
commit한다. Foreign collision path는 삭제하지 않는다.

Utility timeout/cancel promise는 child close와 owned temp cleanup 뒤 settle한다. App quit은
EPUB IPC/operation completion과 main-owned temp cleanup을 기다린다.

ZIP entry timestamp와 order, XML order, filename/source ID, revision-derived modified timestamp가
고정된다. Result는 final file SHA-256과 uncompressed logical package hash를 모두 제공한다.

## 11. Coverage와 성능 actual 계약

Compiler summary와 main 독립 검사 모두 source/exported section, block, character,
fallback/rejected, heading, scene break, ruby와 cover를 비교한다. 성공 조건은 exported section
exact, exported+fallback accounting exact, rejected 0, Unicode character loss 0이다.

일반/장편 actual은 Publication compile, split, XHTML, package documents, ZIP, internal
validation, total, output bytes, EPUBCheck와 process-tree memory를 분리 측정했다. Correctness
gate를 통과하지 못한 run은 timing sample로 쓰지 않았다.

Evidence identity는 다음과 같다.

| Runtime | Evidence path | Bytes | SHA-256 | Elapsed |
|---|---|---:|---|---:|
| Development | `output/playwright/madi-electron-phase1g-evidence.json` | 33,313 | `4f4ed9abef9b2337d68bf61871650a6e3f272557364cabb8e2bb9ba864ed429d` | 567,582.25 ms |
| Fresh unpacked | `output/playwright/madi-packaged-phase1g-evidence.json` | 33,387 | `b4bba22e561bd0268f07d71b73a80719c09686e073979ef64cf3e006b2a84a71` | 51,839.72 ms |

두 evidence는 모두 `status=PASS`, `measurementRuns=5`다. 장편 fixture는 10권/150화/450장면,
675,000자, 450 section, 2,411 block이고 output은 155 entry/150 XHTML/254,784 B다.

| 장편 metric | Development median / max | Fresh unpacked median / max |
|---|---:|---:|
| Desktop end-to-end wall | 52,289.60 / 53,407.21 ms | 2,519.64 / 2,603.01 ms |
| Exporter total | 493 / 532 ms | 57 / 58 ms |
| Internal validation | 92 / 100 ms | 12 / 12 ms |
| XHTML generation | 50 / 55 ms | 7 / 8 ms |
| ZIP packaging | 61 / 63 ms | 7 / 8 ms |

Source/exported section `450/450`, block `2,411/2,411`, Unicode character
`675,000/675,000`, fallback/rejected `0/0`이었고 5회 byte/logical hash가 각각 동일했다.
Fresh-unpacked의 exporter-total 15초 hard gate는 5/5 PASS다. Development wall은 debug core
compile/IPC/UI를 포함하므로 exporter total이나 packaged 제품 성능으로 사용하지 않는다.
전체 timing sample, responsiveness/memory와 artifact hash는
[EPUB export performance](./EPUB_EXPORT_PERFORMANCE.md)에 기록한다.

## 12. Electron UI와 process 경계

EPUB mode는 renderer lazy chunk이며 metadata/scope/profile/split/preset/cover, 사전 검사,
progress/cancel, success summary, reveal과 JSON/Markdown report 저장을 제공한다. Main/preload
contract는 exact key/enum/size/session/revision을 검증한다. Project/mode/snapshot/close 전환은
dirty metadata와 active operation 정리를 기다리며 stale session/revision/config result를
표시하지 않는다.

Packaged app은 package-owned `resources/bin/madi-export-epub.exe`만 사용하고 environment
override를 무시한다. Renderer의 Node 권한, network surface와 external runtime request를
추가하지 않는다.

## 13. Test와 실행 증거

Phase 1G development와 fresh-unpacked actual은 실제 3.3 EPUBCheck, close/reopen/snapshot/
cover/preset/cancel/overwrite, no-clobber, process lifecycle와 security를 통과했다. 세 scenario의
owned temp/symlink/new global artifact와 종료 뒤 captured descendant는 0이다. 외부 HTTP/WS,
page/renderer/main/child unexpected diagnostic와 diagnostic private content/path도 0이다.

Fresh unpacked output은 147 files/`358,623,678 B`다.

| File | Bytes | SHA-256 | Authenticode |
|---|---:|---|---|
| `output/madi-win32-x64/madi.exe` | 204,521,984 | `8d205e25b40da3ada4a08c92f32bfbd8e8d38edb4bfe443deea77fc9de685bac` | `NotSigned` |
| `output/madi-win32-x64/resources/bin/madi-core.exe` | 9,106,944 | `e3fd7d4393bcd662fb0f8a6cd0f3ac59a7c05649f8be9db939804f4c59d7821c` | `NotSigned` |
| `output/madi-win32-x64/resources/bin/madi-export-epub.exe` | 1,859,072 | `7f71b9e84eda09fa74f24e76767a081cf48235b42455590087b27388a6cfad48` | `NotSigned` |

최종 문서 diff를 포함한 worktree에서 다음 aggregate/독립 command가 실제 exit 0으로
끝났다. `pnpm verify` 안의 실행과 그 뒤 독립 실행은 구분한다.

| Command | Result | Elapsed |
|---|---|---:|
| `pnpm verify` | PASS / exit 0 | 2,969.3 s |
| `pnpm package:unpacked` | PASS / exit 0 | 6.826 s |
| `pnpm test:electron` | PASS / exit 0 | 1,955.6 s |
| `pnpm test:package` | PASS / exit 0 | 740.5 s |
| `pnpm test:bundle` | PASS / exit 0 / 1 file, 3 tests | 1.973 s |
| `pnpm check:repository` | PASS / exit 0 | 0.642 s |
| `pnpm format:check` | PASS / exit 0 / 200 files | 0.681 s |

Full desktop suite inventory는 `58 files / 404 tests`다.

## 14. Dependency와 license

Exporter direct dependency는 `base64 0.22.1`, `image 0.25.10`, `quick-xml 0.37.5`,
`serde 1.0.229`, `serde_json 1.0.151`, `sha2 0.10.9`, `tempfile 3.27.0`,
`thiserror 2.0.20`, `zip 2.4.2`와 local `madi-publication`이다. Exact lock과 direct
license 원문/해시는 [Third-Party Notices](../THIRD_PARTY_NOTICES.md)에 기록하고 package
script가 `resources/licenses` copy hash를 검사한다. 새 npm runtime dependency는 없다.

EPUBCheck 5.3.0 distribution의 `THIRD-PARTY.txt`와 license corpus는 ignored tool cache에
보존된다. Runtime에 JAR를 bundle하지 않으므로 transitive JAR license corpus도 app package의
runtime payload가 아니다.

그러나 `pnpm-lock.yaml`/`Cargo.lock` 전체 transitive dependency의 완결된 license corpus는
아직 없고 package의 세 executable은 모두 Authenticode `NotSigned`다. Runtime EPUBCheck/JRE
추가 시 Temurin과 EPUBCheck 전체 transitive notice/security-update owner도 다시 결정해야
한다. 이 제한들은 Typie 판단과 별개로 외부 배포를 차단한다.

## 15. 현재 상태와 Phase 1H 경계

Windows native 한국어 IME는 계속 `MANUAL VALIDATION PENDING`이다. Automated 한글 입력이나
EPUB UTF-8 test는 native IME PASS 근거가 아니다.

Typie는 계속 `HUMAN DECISION REQUIRED BEFORE DISTRIBUTION`이다. Phase 1G의 license 원문과
EPUB validator 고지는 public/paid/customer distribution 권한을 만들지 않는다.

Phase 1G actual은 content loss/nav/package/atomic failure 없이 끝났다. 따라서 private-local
Phase 1H 기술 작업은 진행할 수 있다. 다만 runtime EPUBCheck/JRE packaging이 남아 최종
판정은 **CONDITIONAL TECHNICAL GO — RUNTIME EPUBCHECK PACKAGING PENDING**이다. Invalid EPUB,
block/character loss 또는 atomic 저장 실패는 이 조건부 판정으로 허용되지 않는다.

## 16. 2026-10-01 source5151f6a runtime completion

Exact source `5151f6a804cf1565a09211ea8f7a11e9f547fd34`의 pinned full Windows 경로는
`2026-10-01T03:15:31.9089127Z`부터 `04:43:08.5463271Z`까지 5,256.600초 실행되어
`PASS / exit 0`으로 끝났다. Desktop 105 files/705 tests와 native/CLI/build, development 및
fresh-unpacked basic/D/E/F/G/H actual을 포함한다. 시작·종료 tracked source는 clean이었다.
이 결과는 이전 source660814c의 성공이나 focused source4c47ec4/5151f6a의 결과를 전이한 것이 아니다.

불변 evidence는 ignored `.tools/verification/full-verify-5151f6a-run1/phaseefgh-proof-archive/`에
byte-exact로 보관되어 있다. 아래 경로는 해당 directory 기준이며 raw JSON은 재직렬화하지 않았다.

| Actual | Archive file | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Development | `madi-electron-phase1g-evidence.json` | 71,279 | `c9591f57e7d6bf1a033b62f9e971e7b70e3f56e5f71a6b584088a0bf2715dac9` |
| Fresh unpacked | `madi-packaged-phase1g-evidence.json` | 71,340 | `fd52d018145382ca7dcce4a7f96c41f71802222cdbeff2368f8dbe2a6f423a20` |

Archive `receipt.json` SHA-256은
`6e43c66169f47bbb2e083f47c38afcef654376fe71c353f1c70f67f082aaafea`, full host metadata SHA-256은
`31ba4cf8d25783908461b1f5e97374bb8c07dceb24e02048f612c8dfe80fa21c`다.
같은 full command의 Windows-unpacked receipt SHA-256
`b86956227e6bf67b83a0e30f370d2233243eae0af089a5836e46962ed2eb05ea`와 whole tested-package
inventory file SHA-256 `0608619fd9d2bf47ca29bbd2f4da47522a95e7ed0099a04532684033790b965a`를
함께 읽는다. Inventory는 561 files/81 directories/549,528,995 B, canonical inventory digest는
`6ca42b827431aba14d8e3315b1c3cc3621300e3b86b5b7cfd8fbd5af63b92e7f`다. Inventory 단독으로
freshness를 추정하지 않으며 command/source/runtime-entrypoint hash join이 별도로 일치했다.

앱의 사전 검사와 저장 경로가 fixed runtime을 실제 실행한다. Development는 pinned local bundle,
fresh는 `resources/validation`의 bundle을 쓰며 system Java나 runtime download는 사용하지 않는다.
두 환경에서 EPUBCheck `5.3.0`, Temurin JRE `21.0.11+10`, 364 files/187,794,843 B의 full-tree
hash가 일치했다. Bundle digest는
`bcabd009a2a10ec70499c1e239bef6c53df9580253cc2a19448d804cbaabcb0c`이며 package source-copy도
일치했다. EPUBCheck/Temurin license·notice 원문은 bundle 안에 포함된다.

일반 actual은 metadata/cover/preset CRUD, snapshot/reopen, 3.3 compatibility 및 3.4 draft,
WORK/VOLUME/CHAPTER/SCENE scope, confirmed overwrite/no-clobber/cancel/report/reveal을 통과했다.
3.4 결과의 `compatibilityOnly=true`는 공통 reflowable 3.3 subset 검사이며 완전한 3.4 인증이 아니다.
보존된 3.3 대표 EPUB는 두 환경 모두 63,779 B와 SHA-256
`527f55f49bcb465df8792e1af0e662664c4185ab5deccd0a6ed94f677503788c`가 일치했고 runtime
EPUBCheck는 `VALID`, fatal/error 0이었다. 대표 단일 Java 시간은 dev 5,350.42 ms/fresh
5,002.34 ms이며 장편 5회 Java 분포로 확대하지 않는다.

장편은 각 환경 5회 모두 section 450/450, block 2,411/2,411, Unicode character
675,000/675,000, fallback/rejected 0/0이었다. Scene break/ruby 각450, heading611을 보존했고,
ZIP/XML reopen, mimetype-first Stored, OPF3.0, 155 entries/150 XHTML와 semantic coverage가
통과했다. Output 254,784 B의 byte/logical determinism은 각 환경 5회 모두 true다.
Native exporter median/max는 dev 653/767 ms, fresh 62/75 ms다. Fresh native exporter-total
15초 hard gate는 5/5 PASS이며 wall/Java 시간에 적용한 기준이 아니다.

실제 JVM 시작을 관측한 뒤 UI cancel을 실행했다. Checker 시작 대기는 dev 32,211.04 ms,
fresh 2,874.01 ms였고 취소 뒤 exit/close 및 stdout/stderr drain, output 없음, late success/progress
없음을 확인했다. 별도 active-JVM window-close 검사도 wrapper cleanup 전에 checker 종료·drain과
output 없음이 true였다. 그 검사는 장편 5회 성능 표본에 포함되지 않는다.

일반 state/export/장편의 세 lifecycle 모두 product graceful quit, pre-wrapper native sidecar exit,
PID+Win32 birth identity 기반 종료와 짧은 child의 exit/close receipt가 통과했다. 종료 후 captured
owned descendants는 0이었다. Product close→quit, quit→native-exit, wrapper cleanup의 strict
unexpected diagnostic은 각각0이며 renderer HTTP/WS, owned non-loopback TCP, native TCP,
identity race/classification/parser rejection은0이다. Local-file probe는 차단됐고 fresh override
canary도 차단됐다. Owned temp/symlink/new-global-artifact는0이다.

Full host는 job3,533/cleanup active0/forced termination 없음, job empty와 모든 owned handles·desktop
제거를 기록했다. 입력 관측 10,285회 중 이름 불가36회(native error5)여서
`inputDefaultEverySample=null`이며 all-Default로 보고하지 않는다. Owned desktop은 전 관측에서
비활성이었다. Native 한국어 IME·Hancom 실제 변환·공개/유료/고객/installer 배포 승인은 이
자동 technical GO에 포함되지 않는다. 성능의 정확한 경계는
[EPUB export performance](./EPUB_EXPORT_PERFORMANCE.md)의 §13에 기록한다.

## 관련 문서

- [Phase 1G scope](./PHASE_1G_SCOPE.md)
- [EPUB export architecture](./EPUB_EXPORT_ARCHITECTURE.md)
- [EPUB export performance](./EPUB_EXPORT_PERFORMANCE.md)
- [EPUB validation strategy](./EPUB_VALIDATION_STRATEGY.md)
