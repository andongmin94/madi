# EPUB Validation Strategy

기준일: 2026-08-09

## 1. 이중 검증

Phase 1G의 export success gate는 Madi internal validator다. EPUBCheck 5.3.0은 exact pinned
build/test validator이며 packaged runtime에는 포함하지 않는다.

| Profile | Runtime success gate | Build/test 보조 gate |
|---|---|---|
| EPUB 3.3 compatibility | Madi internal validator + completeness | EPUBCheck 5.3.0 fatal/error 0 |
| EPUB 3.4 Draft | Madi draft-target internal validator + completeness | EPUBCheck 5.3.0은 호환성 보조 도구로만 분류; mandatory harness는 3.3 output만 실행 |

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
JRE/EPUBCheck/JAR/lib tree는 test machine의 ignored tool cache이며 source control이나
unpacked app에 복사하지 않는다.

Harness는 Java proxy를 loopback refusal address로 고정하고 external DTD/schema/stylesheet
access를 끈다. Process timeout은 120초, kill grace 5초, combined output 32 MiB, JSON report
8 MiB로 제한한다. 임시 디렉터리는 `mkdtemp`로 만들고 finally에서 recursive cleanup한다.

CHAPTER/SCENE fixture는 한국어, XML/script-like text, quote, scene break, 모든 inline,
unsupported fallback과 cover 없는 3.3 package를 실제 생성한다. Harness가 ZIP을 독립
reopen하고 exact block/character/TOC/entry/determinism을 확인한 뒤 EPUBCheck JSON fatal/error
0을 요구한다.

## 5. Runtime packaging 결정

채택 방식은 우선순위 3, 즉 runtime internal validator + build/test EPUBCheck다. Runtime에
Java/JAR를 넣으면 package 약 80 MiB 이상 증가뿐 아니라 JRE security update, exact
transitive license, process lifecycle과 release patch 책임이 생긴다. 현재 private-local
단계에서는 이 부담을 앱 기능에 넣지 않는다.

App report의 EPUBCheck status는 runtime 실행이 없으므로 `NOT_RUN` 또는 `UNAVAILABLE`이다.
3.4에서는 `compatibilityOnly=true`로 표시해 향후 보조 검사도 완전한 3.4 validation으로
오인하지 않게 한다.

Unpacked package에는 `madi-export-epub.exe`, Third-Party Notices와 EPUBCheck BSD 3-Clause
원문이 있지만 EPUBCheck executable, Java runtime과 EPUBCheck transitive JAR는 없다.
License 원문 포함은 runtime integration을 의미하지 않으며 향후 distribution 판단을
승인하지 않는다.

## 6. License 근거

EPUBCheck distribution의 `THIRD-PARTY.txt`는 exact transitive component/version과
Apache-2.0, BSD-3-Clause, MIT, MPL-2.0, W3C, Unicode-3.0/SAX 항목을 열거한다. 현재 tool
cache는 upstream `LICENSE.txt`, `THIRD-PARTY.txt`, `licenses/`를 그대로 보존한다.
저장소 고지는 [Third-Party Notices](../THIRD_PARTY_NOTICES.md)에 버전/역할/비번들 경계를
기록하고 unpacked package에는 EPUBCheck 본체의 BSD 원문을 복사한다.

## 7. 향후 runtime 통합 gate

Runtime EPUBCheck를 도입하려면 exact JRE vendor/version, 전체 archive hash, updater/security
owner, 모든 JAR/license corpus, package 증가량, offline/no-network test, timeout/cancel/cleanup,
3.4 support 표시와 packaged actual을 별도 결정으로 승인해야 한다.
