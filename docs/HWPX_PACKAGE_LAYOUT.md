# HWPX Package Layout

기준 profile: `HANCOM_OFFICIAL_MODEL_1_31`

## 1. Claim boundary

이 layout은 한컴 공식 `hwpx-owpml-model` XML 1.31 세대에 맞춘 Madi 상호운용 profile이다.
KS X 6101:2024 전체 적합성 선언이 아니다. 2011 legacy namespace와 2024 namespace를 한
package 안에 섞지 않는다.

## 2. Deterministic entry order

Madi가 생성하고 internal validator가 요구하는 물리적 순서는 다음과 같다.

| 순서 | Entry | Compression | Root/내용 |
|---:|---|---|---|
| 1 | `mimetype` | Stored | ASCII `application/hwp+zip` |
| 2 | `version.xml` | Stored | `hv:HCFVersion`, `xmlVersion="1.31"` |
| 3 | `Contents/header.xml` | Deflated | `hh:head` |
| 4… | `Contents/section0.xml` … `sectionN.xml` | Deflated | `hs:sec` |
| 다음 | `settings.xml` | Deflated | `ha:HWPApplicationSetting` |
| 다음 | `META-INF/container.rdf` | Deflated | 빈 `rdf:RDF` baseline |
| 다음 | `Contents/content.hpf` | Deflated | `opf:package` |
| 다음 | `META-INF/container.xml` | Deflated | `ocf:container` |
| 마지막 | `META-INF/manifest.xml` | Deflated | 빈 ODF manifest baseline |

`container.rdf`는 HWPX 일반 규범의 항상 필수 part라고 주장하지 않는다. Madi profile은
항상 생성하고 container rootfile로 선언하므로 현재 Madi validator에서는 required다.
Preview, BinData, Scripts, XMLTemplate, DocHistory, Chart와 signature는 생성하지 않는다.

## 3. Namespace set

- version: `http://www.hancom.co.kr/hwpml/2011/version`
- app: `http://www.hancom.co.kr/hwpml/2011/app`
- head: `http://www.hancom.co.kr/hwpml/2011/head`
- section: `http://www.hancom.co.kr/hwpml/2011/section`
- paragraph: `http://www.hancom.co.kr/hwpml/2011/paragraph`
- core: `http://www.hancom.co.kr/hwpml/2011/core`
- HPF: `http://www.hancom.co.kr/schema/2011/hpf`
- OPF: `http://www.idpf.org/2007/opf/`
- OCF: `urn:oasis:names:tc:opendocument:xmlns:container`
- ODF manifest: `urn:oasis:names:tc:opendocument:xmlns:manifest:1.0`

전체 exact QName와 세대 비교는 [official profile](./HWPX_OFFICIAL_PROFILE_1_31.md)에 있다.

## 4. Container와 HPF 관계

`META-INF/container.xml`은 다음 두 실제 part만 rootfile로 가리킨다.

- `Contents/content.hpf` → `application/hwpml-package+xml`
- `META-INF/container.rdf` → `application/rdf+xml`

`Contents/content.hpf`는 metadata, manifest, spine을 가진다. Manifest에는 header,
contiguous `section0..sectionN`, settings만 선언한다. 각 spine `idref`는 존재하는 section
manifest item 하나를 가리키며 section 파일 순서와 같다. Missing/orphan/dangling/duplicate
reference는 export failure다.

## 5. Header와 section

`Contents/header.xml`은 `hh:head version="1.5" secCnt="N"`과 `hh:beginNum`을 기록한다.
Fontfaces, border fill, char properties, tab properties, paragraph properties와 styles의
`itemCnt`는 실제 child count와 일치한다. 모든 paragraph/style/run/font reference는 같은
header의 존재하는 ID를 가리킨다.

각 section은 적어도 한 `hp:p`를 가진다. 첫 paragraph/run이 `hp:secPr`와 `hp:pagePr`,
선택적 header/footer/page-number controls를 소유한다. 본문은
`hp:p > hp:run > hp:t`로 기록된다.

## 6. Page model

HWPUNIT는 1/100 point다. A4 portrait baseline은 `59528 × 84188`; landscape는 width/height를
교환한다. Millimetre 설정은 `round(mm × 72000 / 254)`로 변환한다. `pagePr/margin`에
left/right/top/bottom/header/footer/gutter를 기록한다.

전체 page start는 `hh:beginNum@page`; 첫 section의 `hp:startNum@page`도 같은 시작 번호다.
선택한 bottom left/center/right는 `hp:pageNum@pos`에 직접 mapping한다. Header/footer는
`hp:header|hp:footer > hp:subList`와 정상 paragraph/run/style reference로 생성한다.

## 7. ZIP safety와 limits

- absolute, drive, colon, backslash, `.`/`..`, empty component, NUL path 금지
- duplicate entry 금지
- entry 30,000개, entry당 128 MiB, 총 uncompressed 512 MiB 한계
- `mimetype` exact bytes/first/Stored 검증
- fixed ZIP timestamp와 Unix permission `0644`
- ZIP finish 후 모든 entry를 reopen/read

## 8. 의도적 비포함

Embedded font/image/OLE, preview, script/macro, signature/encryption/history/template는 v1에
없다. 존재하지 않는 optional part를 manifest나 container에 미리 선언하지 않는다.
