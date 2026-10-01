# EPUB Validation Strategy

기준일: 2026-10-01. 현재 실행 결과는 [PLANS.md](../PLANS.md)를 따른다.

## 1. 이중 검증

Export는 Madi internal validator와 exact pinned EPUBCheck 5.3.0을 모두 통과해야 한다.
EPUBCheck와 Temurin JRE는 개발판과 unpacked runtime에 고정된 별도 bundle로 포함한다.

| Profile | Runtime success gate | Build/test 보조 gate |
|---|---|---|
| EPUB 3.3 compatibility | Internal validator + completeness + EPUBCheck fatal/error 0 | 별도 CHAPTER/SCENE 합성 fixture 검사 |
| EPUB 3.4 Draft | Draft-target internal validator + completeness + 공통 subset EPUBCheck 검사 | 5.3.0 결과는 전체 3.4 conformance가 아님 |

EPUBCheck 결과를 3.4 전체 conformance로 표현하지 않는다.

## 2. Internal validator

### Container/ZIP

- archive parse, entry 수/크기/총 uncompressed budget
- `mimetype` 존재, 첫 local entry/offset 0, Stored, exact media type
- duplicate, unsafe, absolute, traversal, backslash/drive path 없음
- `META-INF/container.xml`, single valid rootfile와 실제 OPF 일치

### Package

- well-formed XML, duplicate attribute 없음
- OPF package version `3.0`, unique identifier ref와 필수 metadata
- valid deterministic `dcterms:modified`
- manifest ID/href 고유, safe relative href, media type/path 일치
- manifest resource 존재, orphan resource 없음
- spine itemref가 manifest XHTML을 가리키고 content set/order와 일치
- nav item 정확히 하나, optional cover-image 최대 하나

### Navigation/XHTML

- well-formed XML/XHTML, namespace, language, title, stylesheet link
- document별 ID 고유
- nav와 internal link target/fragment 존재
- source tree 순서와 TOC target 순서 일치
- script, iframe, object, embed, active/event attribute 없음
- remote/protocol resource와 외부 stylesheet/font 없음
- invalid XML control character 없음

### Assets와 completeness

- CSS가 정확한 built-in token 결과와 byte-identical
- cover media type/path/magic/decode/dimension 일치
- source/exported section 수 일치
- 모든 source block stable ID가 정확히 한 번 존재
- exported + fallback + rejected block accounting, rejected 0
- block별 plain-text Unicode scalar count와 전체 character count 일치
- heading, scene break, ruby count와 source ID set 일치
- cover option과 manifest/assets 일치

Fatal/error가 하나라도 있으면 status는 FAIL이며 file commit으로 진행하지 않는다.
Unsupported block의 safe plain-text fallback은 warning이지만 coverage에 포함한다.

## 3. Resource budgets

- Archive entries: 30,000 이하
- Entry uncompressed size: 64 MiB 이하
- Total uncompressed size: 512 MiB 이하
- Validation messages: 1,000 이하
- Export files: 25,010 이하
- Cover: app 유효 한계 10 MiB / 10,000 px / 40,000,000 pixel
- Utility stdin: 64 MiB 이하

Validator는 XML external entity/DTD resolution이나 network fetch를 사용하지 않는다.

## 4. EPUBCheck 5.3.0 build/test integration

`scripts/test-phase1g-epubcheck.mjs`는 저장소에서 무시된 `.tools/phase1g-validation` 아래의
다음을 exact size/SHA-256으로 확인한다.

| Tool | Bytes | SHA-256 |
|---|---:|---|
| EPUBCheck 5.3.0 distribution ZIP | 33,071,108 | `6c07e68584b2e2ce2f89fe06e1246dfead3eb36b46b340e7d93524f29dcff6c5` |
| `epubcheck.jar` | 1,223,671 | `f7f96617c929371821609b88c8484d6dc9f24fe916499863c46094c5fb778a65` |
| Eclipse Temurin JRE 21.0.11+10 ZIP | 49,005,708 | `be26677aaa20b39a62edcaab4c8857a8b76673b0f45abc0b6143b142b62717e4` |
| `java.exe` | 50,344 | `5e0fab9f07952ceb6e71eb9fd33e1ed69959904ca00cf70869b7baf516a98016` |

JRE metadata는 Eclipse Adoptium Temurin 21.0.11+10-LTS Windows x64 HotSpot JRE다. 이
JRE/EPUBCheck/JAR/lib 원본 ZIP은 ignored tool cache이며 source control에 넣지 않는다.
`prepare:epubcheck`는 고정 archive를 검증·추출해 개발용 runtime을 준비한다.

Harness는 Java proxy를 loopback refusal address로 고정하고 external DTD/schema/stylesheet
access를 끈다. Process timeout은 120초, kill grace 5초, combined output 32 MiB, JSON report
8 MiB로 제한한다. 임시 디렉터리는 `mkdtemp`로 만들고 finally에서 recursive cleanup한다.

CHAPTER/SCENE fixture는 한국어, XML/script-like text, quote, scene break, 모든 inline,
unsupported fallback과 cover 없는 3.3 package를 실제 생성한다. Harness가 ZIP을 독립
reopen하고 exact block/character/TOC/entry/determinism을 확인한 뒤 EPUBCheck JSON fatal/error
0을 요구한다.

## 5. Runtime packaging 결정

Phase 1H에서 runtime EPUBCheck/JRE bundle은 HWPX 기능의 선행 조건이 아니라
**pre-distribution hardening**으로 재분류했다. 이 재분류는 Phase 1G의 역사적 conditional
verdict를 소급해 `PASS`로 바꾸거나 public/paid/customer distribution을 승인하지 않는다.
배포 전에는 아래 7절 gate를 별도 완료해야 한다.

개발판은 `.tools/phase1g-validation/runtime`, 배포본은 `resources/validation`만 사용한다.
전체 364파일·187,794,843 bytes와 manifest를 포함하며, 고정 files 배열 digest는
`bcabd009a2a10ec70499c1e239bef6c53df9580253cc2a19448d804cbaabcb0c`다.
준비·package copy·실제 Java spawn 전에 path set와 전체 file hash를 확인한다. System Java,
environment path override, 실행 중 download 또는 외부 validator 서버를 사용하지 않는다.

`검사`도 owned temporary EPUB를 생성해 checker를 실행한 뒤 정리하며 output path를
공개 결과에 남기지 않는다. Export는 staged EPUB의 identity를 검증하고 checker가 통과한
후 destination을 commit한다. Checker 실행은 취소와 app shutdown에 포함한다.
Raw report/stdout/stderr는 UI·원고·영구 report에 복사하지 않고 severity/code/count만 사용한다.

성공 report는 `VALID/5.3.0`과 `epubCheckMs`를 보존한다. 3.4에서는
`compatibilityOnly=true`로 표시한다. `totalMs`는 기존 native exporter timing이며 checker
시간과 전체 작업 wall time은 분리한다. Bundle 누락·변조·checker 실패는 성공으로 우회하지 않는다.

## 6. License 근거

EPUBCheck distribution의 `THIRD-PARTY.txt`는 exact transitive component/version과
Apache-2.0, BSD-3-Clause, MIT, MPL-2.0, W3C, Unicode-3.0/SAX 항목을 열거한다. 현재 tool
cache는 upstream `LICENSE.txt`, `THIRD-PARTY.txt`, `licenses/`를 그대로 보존한다.
저장소 고지는 [Third-Party Notices](../THIRD_PARTY_NOTICES.md)에 버전·역할·고정 tree를
기록한다. Unpacked package는 EPUBCheck 전체 고지/JAR corpus와 Temurin `NOTICE/legal`
원문을 수정 없이 포함한다.

## 7. 배포 전 runtime 통합 gate

저장소 유지보수자는 JRE·checker 갱신 때 archive/tree pin, 전체 license corpus, package
증가량, offline/network·timeout/cancel/cleanup·fresh-unpacked gate를 같은 exact source에서
다시 검증한다. 구현이나 고지 복사만으로 actual PASS 또는 public 배포 승인으로 바꾸지 않는다.
