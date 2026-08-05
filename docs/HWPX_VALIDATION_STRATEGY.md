# HWPX Validation Strategy

기준일: 2026-08-13

## 1. Validation layers

Phase 1H는 하나의 XML parse를 전체 검증으로 취급하지 않는다.

1. request/Publication identity와 bounded input
2. compile expectation 생성
3. in-memory ZIP 생성 및 reopen
4. package/XML/reference/style/page 구조 검사
5. source block/character/semantic coverage
6. Electron main의 terminal summary/output/destination 독립 검사
7. 선택적 Hancom open/save/reopen actual

1~6이 모두 성공하기 전에는 HWPX output을 commit하지 않는다. 7은 profile 상호운용성과
HWP bridge에 필요한 별도 actual이며 internal validator를 대체하지 않는다.

## 2. ZIP/package 검사

- required entries와 deterministic order
- first Stored `mimetype` exact bytes
- duplicate/absolute/traversal/backslash/drive/unsafe path 없음
- entry count, entry/total uncompressed size limit
- ZIP reopen/read
- `container.xml` rootfile의 존재와 media type
- `content.hpf` metadata/manifest/spine, unique ID/href, contiguous section order
- manifest/spine/physical section set의 exact equality
- orphan/missing resource 없음

## 3. XML/profile 검사

- 모든 XML well-formed, unsafe namespace/QName 없음
- `version.xml` root와 `xmlVersion="1.31"`
- `settings.xml` root와 하나의 valid `CaretPosition`
- `header.xml` root/version/secCnt/beginNum
- font/char/paragraph/style table count와 ID uniqueness
- para/style/run/font IDREF의 존재
- section root, 적어도 한 paragraph, 첫 section definition/page definition
- page geometry/margins/orientation
- header/footer/page number structure, text와 position
- `container.rdf`와 ODF manifest root

Madi validator는 bundled KS XSD validator가 아니다. KS X 6101:2024 기계가독 XSD는 이용
조건과 namespace 세대가 다르므로 package에 복사하지 않는다. 따라서 결과 명칭은
`HANCOM_OFFICIAL_MODEL_1_31` internal profile validation이지 `KS X 6101:2024 conformant`가
아니다.

## 4. Source coverage

Compiler가 source block별 expected section, paragraph/style/run text, disposition과 source
identity를 만든다. Reopened section XML에서 paragraph/run/text를 다시 추출해 다음을
대조한다.

- source/exported section
- source/exported/fallback/configured-omission/rejected block
- Unicode scalar character
- heading/scene-break
- ruby/ruby fallback
- strong/emphasis/underline/strike segment
- paragraph/run/text와 physical file count

Block 누락, 중복, 다른 section 배치, text/order/style mismatch, rejected block 또는
character loss는 error다. Ruby와 non-empty unsupported의 명시적 fallback warning은 error가
아니지만 fallback accounting에서 사라지면 error다. Configured omission은 preset의
`include* = false`와 일치하는 hierarchy heading에만 허용한다. Empty unsupported는 fail-closed,
authored image는 Publication IR v1 variant가 없으므로 본문 asset fallback 대상으로 만들지
않는다.

## 5. Severity와 report

Message는 code, `FATAL|ERROR|WARNING|INFO`, 안전한 description, optional source node,
package path와 suggestion만 가진다. `FATAL` 또는 `ERROR`가 하나라도 있으면 status FAIL이고
output success가 아니다. Count와 message severity 분포가 다르면 main이 utility result를
거부한다. 원고 본문과 local source path는 message/report에 넣지 않는다.

## 6. Resource budgets

| Resource | Limit |
|---|---:|
| Utility stdin | 64 MiB |
| Archive entries | 30,000 |
| One uncompressed entry | 128 MiB |
| Total uncompressed | 512 MiB |
| Validation messages | 1,000 |
| Desktop report | 8 MiB |

Utility/process/client에도 line, total stdout, timeout과 close grace가 따로 있다. Limit 초과는
partial success가 아니라 typed failure다.

## 7. Negative/fault gates

Fixture는 missing/duplicate entry, bad MIME/compression/order, malformed XML, mixed namespace,
dangling IDREF/href, count mismatch, unsafe path, wrong page/style/reference, missing/duplicate
source block, text/style mutation과 wrong expectation을 거부해야 한다. Output tests는 collision,
destination changed, cancel/timeout과 owned-temp cleanup을 확인한다.

## 8. Hancom validation boundary

한컴 open/re-save는 profile compatibility의 강한 증거지만 internal source coverage를
증명하지 않는다. Automation HWP conversion/reopen도 HWPX internal validation이 PASS한 뒤만
실행한다. 현재 PC는 한컴오피스 2022와 ProgID가 있으나 file-path security module이 없어
probe는 `SECURITY_MODULE_REQUIRED`; COM activation/open/save는 실행하지 않았다.

```text
HWPX Hancom open/re-save: MANUAL VALIDATION PENDING
HWP conversion/reopen: MANUAL VALIDATION PENDING
```

## 9. 판정 규칙

Actual HWPX, block/character/scene-break coverage, development/unpacked Electron과 최종 pnpm
gate가 모두 확인되기 전 Phase 1H 판정은 `WITHHELD`다. Malformed package, dangling reference,
content loss 또는 atomic failure가 있으면 GO를 내리지 않는다.
