# HWPX official model 1.31 interoperability profile

기준일: 2026-08-13  
Profile ID: `HWPX_HANCOM_MODEL_1_31_INTEROP`

## 상태와 범위

이 문서는 Madi HWPX exporter와 선택적 한글 Automation bridge의 구현 근거를
고정한다. 현재 exporter의 직접 생성 목표는 한컴 공식
`hwpx-owpml-model` commit
[`1453388472c703a4b299a0834f425cdac16644b9`](https://github.com/hancom-io/hwpx-owpml-model/tree/1453388472c703a4b299a0834f425cdac16644b9)이
구현한 XML `1.31` 세대와의 상호운용성이다.

이 profile은 다음을 뜻하지 않는다.

- KS X 6101:2024 전체에 대한 무조건적 적합성 선언
- 한컴에서 발행한 공식 HWPX sample의 재배포 허가
- 한글 Automation의 상업적 사용 허가
- 한글에서 실제 열기, 다시 저장하기 및 HWP 변환까지 통과했다는 주장

판정 용어는 다음과 같다.

| 판정 | 의미 |
|---|---|
| `VERIFIED` | 아래에 적은 exact source 또는 공식 원문에서 직접 확인했다. |
| `PROFILE` | 현행 KS의 보편적 의무라고 단정하지 않고 Madi가 상호운용성을 위해 채택한다. |
| `UNVERIFIED` | 공식 근거, 실제 한글 round-trip 또는 양쪽 모두가 아직 부족하다. |
| `LEGAL REVIEW REQUIRED` | 기술 검증과 별개로 배포 전 권리 검토가 필요하다. |

## 공식 근거

| 근거 | 고정점과 용도 |
|---|---|
| [KS X 6101 국가표준 상세](https://www.standard.go.kr/KSCI/standardIntro/getStandardSearchView.do?ksNo=KSX6101&menuId=503&tmprKsNo=KSX6101&topMenuId=502) | 최종 개정 2024-10-30, 고시 2024-15. 적용 범위와 현행 개정 상태. |
| [KS X 6101:2024 기계가독 원문](https://www.standard.go.kr/KSCI/api/std/viewMachine.do?reformNo=03&tmprKsNo=KSX6101&formType=STD) | 현행 namespace와 규정 부속서 B~H XSD. 이 서비스 자체가 시범 제공, 법적 비보증, 상업적 활용 금지를 표시하므로 XSD를 저장소에 복제하지 않는다. |
| [한컴 공식 HWPX 구조 설명](https://tech.hancom.com/hwpxformat/) | ZIP 구성, `content.hpf`, header/section, Preview의 선택성. 2025-02-26. |
| [한컴 공식 parsing 글 1](https://tech.hancom.com/python-hwpx-parsing-1/) | legacy 실제 문서의 namespace, header `version="1.5"`, ref table 예, manifest 예. 2025-06-18. |
| [한컴 공식 parsing 글 2](https://tech.hancom.com/python-hwpx-parsing-2/) | section/paragraph/run 구조, 본문과 header ID 참조, 적어도 한 section/paragraph. 2025-09-29. |
| [한컴 공식 open-source 안내](https://developer.hancom.com/opensources) | `hwpx-owpml-model`을 한컴 제공 open source로 식별. |
| [공식 model source](https://github.com/hancom-io/hwpx-owpml-model/tree/1453388472c703a4b299a0834f425cdac16644b9) | 이 profile의 exact legacy filename, namespace, QName, enum과 기본값. Apache-2.0. |
| [HWP/OWPML 공개 형식 안내](https://license.hancom.com/support/downloadCenter/hwpOwpml) | 포맷 공개 취지, 파생 개발 및 저작권 고지 조건. |
| [한글 Automation 안내](https://developer.hancom.com/hwpautomation) | 공식 manual, 보안 모듈, 상업 사용 별도 license. |
| [HwpAutomation 2504 manual](https://github.com/hancom-io/devcenter-archive/raw/main/hwp-automation/HwpAutomation_2504.pdf) | COM ProgID와 Open/SaveAs API. HWPX token은 표에 없음. |
| [한컴 담당자 HWPX Automation 예](https://forum.developer.hancom.com/t/topic/2303/2) | `Open(..., "HWPX", "")`, `SaveAs(..., "HWPX", "")`, `Quit()` exact 예. 2025-03-13. |

공식 model source를 인용할 때는 항상 위 commit을 기준으로 한다. 특히 filename과
namespace는 [`OWPMLDocumentDef.h`](https://github.com/hancom-io/hwpx-owpml-model/blob/1453388472c703a4b299a0834f425cdac16644b9/OWPMLApi/OWPMLDocumentDef.h),
[`NamespacePrefix.cpp`](https://github.com/hancom-io/hwpx-owpml-model/blob/1453388472c703a4b299a0834f425cdac16644b9/OWPML/Base/NamespacePrefix.cpp),
직렬화 순서와 MIME은
[`OWPMLSerialize.cpp`](https://github.com/hancom-io/hwpx-owpml-model/blob/1453388472c703a4b299a0834f425cdac16644b9/OWPMLApi/OWPMLSerialize.cpp)에서
확인했다.

## 가장 중요한 세대 경계

**한 XML 문서 안에서 legacy model 1.31 namespace와 KS X 6101:2024 namespace를
섞지 않는다.** Prefix가 같아도 URI가 다르면 다른 QName이다.

| 역할 | 이 profile: official model 1.31 | 현행 KS X 6101:2024 |
|---|---|---|
| version | `hv:HCFVersion`, `http://www.hancom.co.kr/hwpml/2011/version` | root local name `version`, `http://www.owpml.org/owpml/2024/version` |
| header | `hh:head`, `http://www.hancom.co.kr/hwpml/2011/head` | `head`, `http://www.owpml.org/owpml/2024/head` |
| section | `hs:sec`, `http://www.hancom.co.kr/hwpml/2011/section` | `sec`, `http://www.owpml.org/owpml/2024/section` |
| paragraph | `hp:*`, `http://www.hancom.co.kr/hwpml/2011/paragraph` | `http://www.owpml.org/owpml/2024/paragraph` |
| core | `hc:*`, `http://www.hancom.co.kr/hwpml/2011/core` | `http://www.owpml.org/owpml/2024/core` |
| settings | `ha:*`, `http://www.hancom.co.kr/hwpml/2011/app` | `ha:*`, `http://www.owpml.org/owpml/2024/app` |
| master page | `hm:*`, `http://www.hancom.co.kr/hwpml/2011/master-page` | `http://www.owpml.org/owpml/2024/master-page` |
| history | `hhs:*`, `http://www.hancom.co.kr/hwpml/2011/history` | `http://www.owpml.org/owpml/2024/history` |

현행 표준의 2024 Header XSD가 `2024/paragraph`와 `2024/core`를 import하고,
Body/ParaList XSD도 모두 2024 URI를 사용한다. 반면 audited model은 2011 URI와
일부 2016 확장 URI를 사용한다. 한컴 공식 parsing 글도 문서 version에 따라
namespace가 달라진다고 명시한다. 따라서 2024 XSD의 속성이나 default를 legacy
문서에 선택적으로 복사해 넣는 방식은 금지한다.

현행 KS 2024 schema 전체를 별도 profile로 구현하려면 다음을 한꺼번에 해야 한다.

1. 2024 version/head/section/paragraph/core/app/master/history schema set을 pin한다.
2. root local name과 모든 import QName을 2024 세대로 바꾼다.
3. 2024 XSD validator와 실제 한글 round-trip을 모두 통과한다.
4. 그 전까지 `KS X 6101:2024 conformant`라고 표시하지 않는다.

## model 1.31 namespace와 root QName

| Prefix | Exact namespace URI | 대표 root/용도 | 판정 |
|---|---|---|---|
| `hv` | `http://www.hancom.co.kr/hwpml/2011/version` | `hv:HCFVersion` | `VERIFIED` |
| `ha` | `http://www.hancom.co.kr/hwpml/2011/app` | `ha:HWPApplicationSetting` | `VERIFIED` |
| `hp` | `http://www.hancom.co.kr/hwpml/2011/paragraph` | `hp:p`, `hp:run`, `hp:t`, controls | `VERIFIED` |
| `hp10` | `http://www.hancom.co.kr/hwpml/2016/paragraph` | paragraph extension | `VERIFIED`, 사용 전 capability 확인 |
| `hs` | `http://www.hancom.co.kr/hwpml/2011/section` | `hs:sec` | `VERIFIED` |
| `hc` | `http://www.hancom.co.kr/hwpml/2011/core` | shared value/types | `VERIFIED` |
| `hh` | `http://www.hancom.co.kr/hwpml/2011/head` | `hh:head` | `VERIFIED` |
| `hhs` | `http://www.hancom.co.kr/hwpml/2011/history` | history | `VERIFIED` |
| `hm` | `http://www.hancom.co.kr/hwpml/2011/master-page` | master page | `VERIFIED` |
| `hpf` | `http://www.hancom.co.kr/schema/2011/hpf` | HWP package extension | `VERIFIED` |
| `opf` | `http://www.idpf.org/2007/opf/` | `opf:package`, manifest, spine | `VERIFIED` |
| `dc` | `http://purl.org/dc/elements/1.1/` | package metadata | `VERIFIED` |
| `ocf` | `urn:oasis:names:tc:opendocument:xmlns:container` | `ocf:container` | `VERIFIED` |
| `odf` | `urn:oasis:names:tc:opendocument:xmlns:manifest:1.0` | encryption manifest | `VERIFIED` |
| `config` | `urn:oasis:names:tc:opendocument:xmlns:config:1.0` | settings config | `VERIFIED` |
| `rdf` | `http://www.w3.org/1999/02/22-rdf-syntax-ns#` | optional RDF | `VERIFIED` |
| `epub` | `http://www.idpf.org/2007/ops` | package/content extension | `VERIFIED` |

Namespace declarations may be placed where XML namespace scoping permits, but emitted
QNames must resolve to these exact URIs throughout this profile.

## ZIP와 package contract

### Madi가 생성하는 baseline entries

아래 `PROFILE required`는 audited official model writer의 경로와 일반 HWPX
상호운용성을 기준으로 Madi가 항상 생성한다는 뜻이다. 현행 KS 2024의 모든 상황에
대한 normative minimum과 같은 말은 아니다.

| Entry | Exact content/root | Madi 판정 |
|---|---|---|
| `mimetype` | ASCII `application/hwp+zip`; official model은 무압축으로 저장하고 reader도 exact 값을 검사한다. | `PROFILE required`, 값과 무압축 `VERIFIED` |
| `version.xml` | `hv:HCFVersion` | `PROFILE required`; KS 2024도 `version.xml` 자체를 필수라고 명시 |
| `META-INF/container.xml` | `ocf:container/ocf:rootfiles/ocf:rootfile` | `PROFILE required` |
| `Contents/content.hpf` | `opf:package` | `PROFILE required` |
| `Contents/header.xml` | `hh:head` | `PROFILE required` |
| `Contents/section0.xml` | `hs:sec`; 이후 `section1.xml` 순 | `PROFILE required`; 1개 이상 section과 각 section의 1개 이상 paragraph는 공식 설명으로 `VERIFIED` |
| `settings.xml` | `ha:HWPApplicationSetting`, baseline CaretPosition | `PROFILE required`; 현행 KS 2024 normative mandatory 여부는 `UNVERIFIED` |
| `META-INF/manifest.xml` | ODF manifest root; official model serializer의 Save 경로가 생성한다. | `PROFILE required`; 현행 KS 2024에서 unencrypted package까지 mandatory인지는 `UNVERIFIED` |

ZIP의 `mimetype`가 반드시 물리적 첫 entry여야 하는지에 대해서는 audited model
source만으로 규범 판정을 확정하지 않았다. Madi는 일반 OCF 상호운용성을 위해
`mimetype`을 첫 entry, 무압축으로 쓰되 이 문서에서는 첫-entry 규칙을
`PROFILE`로 취급한다.

### 선택 entries

| Entry/디렉터리 | 판정과 정책 |
|---|---|
| `Preview/PrvText.txt`, `Preview/PrvImage.png` | `OPTIONAL VERIFIED`. 한컴 공식 글은 암호화 문서에서 Preview를 생략한다고 명시한다. baseline은 생성하지 않는다. |
| `META-INF/container.rdf` | optional. RDF가 실제로 있을 때만 참조한다. |
| `BinData/` | embedded image/font/OLE 등이 있을 때만 생성한다. |
| `Scripts/` | optional이지만 Madi baseline은 생성하지 않는다. |
| `XMLTemplate/`, `DocHistory/`, `Chart/` | 해당 feature가 있을 때만 생성한다. baseline은 생성하지 않는다. |
| `META-INF/signatures.xml` | 전자서명 feature가 있을 때만 생성한다. baseline은 생성하지 않는다. |

KS X 6101:2024 8.2는 `Preview`, `Contents`, `BinData`, `Scripts`, `XMLTemplate`,
`DocHistory`, `Chart` 디렉터리를 선택적으로 사용될 수 있는 디렉터리로 설명한다.
그러나 본문이 있는 Madi 문서는 실제 header와 section이 필요하다. 빈 optional
디렉터리나 존재하지 않는 part를 manifest/container에 미리 선언하지 않는다.

### `META-INF/container.xml`

baseline rootfile은 다음 관계를 가져야 한다.

```xml
<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container">
  <ocf:rootfiles>
    <ocf:rootfile full-path="Contents/content.hpf"
                  media-type="application/hwpml-package+xml"/>
  </ocf:rootfiles>
</ocf:container>
```

경로와 media type은 official model source에서 `VERIFIED`다. Official writer는
Preview text와 RDF rootfile도 추가하지만 해당 part가 없는 경우에도 이를 만들 수
있는 구현 특성이 있으므로 Madi는 그 동작을 normative rule로 복사하지 않는다.

### `Contents/content.hpf`

Exact model은 `opf:package` 아래 `opf:metadata`, `opf:manifest`, `opf:spine`을
사용한다. Manifest item과 spine itemref는 다음 관계를 만족해야 한다.

- `opf:item`: `id`, `href`, `media-type`, optional `isEmbeded`를 가진다. 속성 철자는
  official model과 실제 예제의 `isEmbeded` 그대로다.
- `opf:itemref`: `idref`, `linear`, optional `id`를 가진다.
- 모든 `itemref.idref`는 같은 manifest의 존재하는 item `id` 하나를 가리킨다.
- section item을 spine에 논리적 읽기 순서대로 둔다.
- `header`, `section0`, `settings`의 official example media type은
  `application/xml`이다. Official model writer는 settings/content 일부에
  `text/xml`을 쓰는 경로도 있어 exact media type 통일은 실제 한글 round-trip 전
  `UNVERIFIED`; Madi profile은 manifest에 `application/xml`을 사용한다.
- `opf:package`의 `version`, `unique-identifier`, `id`는 model이 직렬화하지만
  공식 source에 안전한 생성 default가 없고 공개 공식 예제도 root 속성을 생략했다.
  임의 값을 한컴 공식 값이라고 주장하지 않는다. 선택한 Madi 값은 실제 reopen
  전까지 `PROFILE/UNVERIFIED`다.

Manifest와 spine의 모든 ID는 문서 내에서 유일해야 한다. Dangling IDREF, duplicate
ID, 존재하지 않는 href, manifest에 없는 생성 part는 export를 실패시킨다.

## version과 제품 identity

Legacy root는 다음 속성을 직렬화한다.

```text
hv:HCFVersion
  tagetApplication major minor micro buildNumber os
  xmlVersion application appVersion
```

`tagetApplication`은 official source와 현행 표준에도 남아 있는 철자이므로 수정하지
않는다.

| 값 | 판정 |
|---|---|
| `xmlVersion="1.31"` | official model constant로 `VERIFIED` |
| `application="Hancom Office Hangul"` | official model constant로 존재함은 `VERIFIED`; Madi가 자신을 한컴 제품으로 표시해도 된다는 뜻은 아님 |
| `major`, `minor`, `micro`, `buildNumber`, `os`, `appVersion` | official model은 field/default setter만 제공한다. Madi에 안전한 exact 값은 `UNVERIFIED`. 실제 한글 sample이나 승인된 producer identity 없이 한컴 버전을 사칭하지 않는다. |
| header `version="1.5"` | 한컴 공식 tech 글의 legacy 실제 파일 예로 `VERIFIED` |
| `opf:package version/unique-identifier/id` | safe exact generation value `UNVERIFIED` |

비공식 블로그나 인터넷에서 발견한 임의 HWPX의 producer version은 이 profile의
근거로 사용하지 않는다.

## header, style, font와 ID 관계

`Contents/header.xml`의 root는 `hh:head`; 핵심 속성은 `version`과 `secCnt`다.
`secCnt`는 실제 section file 수와 같아야 한다. Official legacy 실제-file 예는
`version="1.5" secCnt="1"`이다.

`hh:refList`의 table은 다음과 같다.

| Table | 역할 | KS X 6101:2024 XSD cardinality 참고 |
|---|---|---|
| `fontfaces/fontface/font` | 언어별 font ID | container와 fontface/font 각 1개 이상 |
| `borderFills/borderFill` | border/background/fill | table optional, child 0+ |
| `charProperties/charPr` | character shape | container와 charPr 1개 이상 |
| `tabProperties/tabPr` | tab definition | table optional, child 0+ |
| `numberings/numbering` | numbering definition | table optional, child 0+ |
| `bullets/bullet` | bullet definition | table optional, child 0+ |
| `paraProperties/paraPr` | paragraph shape | container와 paraPr 1개 이상 |
| `styles/style` | named style | container required, style 0+ |
| memo/track-change tables | optional metadata | optional |

이 cardinality는 **2024 XSD 근거**이며 legacy 1.31 validator 자체가 아니다. Legacy
실제 한컴 예제에는 fontfaces 7, borderFills 2, charProperties 7, tabProperties 3,
numberings 1, paraProperties 20, styles 22가 있었지만 이는 minimum이 아니다.
따라서 그 숫자를 빈 문서에 복제하지 않는다.

본문 참조 규칙은 다음과 같다.

- `hp:p@id`는 paragraph의 nonnegative ID다.
- `hp:p@paraPrIDRef`는 header `paraProperties/paraPr` ID를 가리킨다.
- `hp:p@styleIDRef`는 header `styles/style` ID를 가리킨다.
- `hp:run@charPrIDRef`는 header `charProperties/charPr` ID를 가리킨다.
- `charPr/fontRef`의 언어별 ID는 대응하는 `fontface@lang`의 font ID를 가리킨다.
- style의 `paraPrIDRef`, `charPrIDRef`, `nextStyleIDRef`도 존재하는 ID를 가리켜야
  한다.

각 `itemCnt`는 실제 child 수와 같아야 한다. 모든 참조의 존재, 범위, uniqueness를
ZIP을 닫기 전에 검증한다.

## section, paragraph, run과 page setup

Logical skeleton은 다음과 같다.

```xml
<hs:sec>
  <hp:p id="..." paraPrIDRef="..." styleIDRef="...">
    <hp:run charPrIDRef="...">
      <hp:secPr>...</hp:secPr> <!-- 구역 설정이 있는 첫 run -->
      <hp:t>...</hp:t>
    </hp:run>
  </hp:p>
</hs:sec>
```

- body는 section file 1개 이상, 각 section은 paragraph 1개 이상이다.
- `hp:p`는 문단 기본 단위, `hp:run`은 같은 글자 속성을 공유하는 content
  container, `hp:t`는 실제 문자열이다.
- official model과 2024 ParaList XSD 모두 `secPr`을 run child로 두고, `pagePr`은
  `secPr` 아래에 둔다.
- 단순 Madi baseline에서는 section의 첫 paragraph/run에 section property를 한 번
  기록한다. 다중 section의 정확한 inheritance와 control placement는 round-trip
  전까지 `UNVERIFIED`다.

### HWPUNIT와 A4

1 HWPUNIT은 1/7200 inch, 즉 1/100 point다. 단위가 표시되지 않은 OWPML 수치는
원칙적으로 HWPUNIT으로 해석한다.

Official model과 KS X 6101:2024 page XSD의 portrait 기본값은 다음과 같다.

| 속성 | 값 |
|---|---:|
| `landscape` | `NARROWLY` |
| `width` | `59528` |
| `height` | `84188` |
| `gutterType` | `LEFT_ONLY` |
| left/right margin | `8504` / `8504` |
| top/bottom margin | `5668` / `4252` |
| header/footer margin | `4252` / `4252` |
| gutter | `0` |

공식 한컴 forum의 A4 설명은 약 `59527 x 84189`로도 표기한다. 단위 환산의 1-unit
rounding 차이가 있으므로 이 수치를 서로 다른 용지로 오판하지 않는다. Madi
baseline 직렬화 값은 audited model/XSD default인 `59528 x 84188`로 고정한다.

### 줄 간격

`hh:paraPr/hh:lineSpacing`의 exact attrs는 `type`, `value`, `unit`이다.

- `type`: `PERCENT`, `FIXED`, `BETWEEN_LINES`, `AT_LEAST`
- `unit`: `CHAR`, `HWPUNIT`
- KS X 6101:2024 XSD는 `PERCENT`일 때 `value`를 0%~500%로 제한한다고 설명한다.
- 다른 type의 세부 계산, 한글 UI 수치와의 변환은 실제 round-trip 전까지
  `UNVERIFIED`다.

## 머리말, 꼬리말과 쪽 번호

머리말과 꼬리말은 `hp:ctrl` 안의 `hp:header` 또는 `hp:footer`이며, 각각
`hp:subList`를 통해 paragraph list를 가진다.

- attrs: `id`, `applyPageType`
- `applyPageType`: `BOTH`, `EVEN`, `ODD`
- 머리말/꼬리말 내부 paragraph/run도 정상적인 header table ID를 참조해야 한다.

쪽 번호 관련 exact 구조는 다음과 같다.

- 전체 시작 번호: `hh:beginNum@page`; official example default는 `1`.
- odd/even 적용: `hp:ctrl/hp:pageNumCtrl@pageStartsOn`, 값은
  `BOTH`, `EVEN`, `ODD`.
- 위치/표시: `hp:ctrl/hp:pageNum` attrs `pos`, `formatType`, `sideChar`.
- `pos`: `NONE`, `TOP_LEFT`, `TOP_CENTER`, `TOP_RIGHT`, `BOTTOM_LEFT`,
  `BOTTOM_CENTER`, `BOTTOM_RIGHT`, `OUTSIDE_TOP`, `OUTSIDE_BOTTOM`,
  `INSIDE_TOP`, `INSIDE_BOTTOM`.

따라서 Madi의 bottom-left/center/right는 각각 `BOTTOM_LEFT`,
`BOTTOM_CENTER`, `BOTTOM_RIGHT`에 직접 대응한다. `formatType`의 전체 numbering
enum과 쪽 번호 field가 머리말/꼬리말과 함께 쓰일 때의 우선순위는 round-trip
fixture로 추가 검증한다.

## Ruby/덧말

HWPX model의 Ruby 대응 후보는 `ruby`라는 element가 아니라 run child
`hp:dutmal`이다. KS X 6101:2024의 정의는 덧말이 본문 위/아래의 보충 정보이고
일본어 토씨나 중국어 발음 기호에 사용할 수 있다고 명시한다.

```xml
<hp:dutmal posType="TOP" szRatio="..." option="..."
           styleIDRef="..." align="CENTER">
  <hp:mainText>...</hp:mainText>
  <hp:subText>...</hp:subText>
</hp:dutmal>
```

| 항목 | exact model/standard 사실 |
|---|---|
| `posType` | `TOP`, `BOTTOM` |
| `align` | `JUSTIFY`, `LEFT`, `RIGHT`, `CENTER`, `DISTRIBUTE`, `DISTRIBUTE_SPACE` |
| child | `mainText`, `subText` 순 |
| `styleIDRef` | style table 참조 후보; 참조 의미의 실제 legacy round-trip은 `UNVERIFIED` |
| `szRatio` | KS 2024 XSD는 positive integer. legacy producer의 안전한 값은 `UNVERIFIED`. |
| `option` | KS 2024 XSD는 fixed `4`, 반면 audited legacy model constructor default는 `0`. 세대를 섞어 보정하지 말고 실제 legacy fixture 전에는 `UNVERIFIED`. |

구조와 덧말의 발음 표기 용도는 `VERIFIED`지만 Reader IR의 arbitrary ruby를 모든
경우에 손실 없이 1:1 변환한다는 보장은 아직 없다. Legacy profile에서
`szRatio/option/styleIDRef`의 실제 한글 수용값이 검증되기 전에는 plain-text
fallback과 구조화 warning을 사용하고, silent drop은 금지한다.

## official sample과 검증 상태

한컴 공식 tech 글에는 실제 XML excerpt가 있지만 다운로드 가능한 완전한 HWPX와
그 재배포 license가 함께 제공되지는 않았다. 공식 `hancom-io/dvc` solution은 과거
`sample/basedocument.hwpx`를 참조하지만 현재 main tree에는 그 file이 없다. 이 PC의
한컴 설치 디렉터리에서도 `.hwpx` sample을 찾지 못했다.

따라서 현재 상태는 다음과 같다.

- official complete sample bytes: `UNAVAILABLE`
- official sample redistribution: `UNVERIFIED`
- Madi-generated fixture의 ZIP/XML self-validation: 구현 가능
- 한글 2022에서 open/re-save: `MANUAL VALIDATION PENDING`
- HWPX -> HWP -> reopen: `MANUAL VALIDATION PENDING`

한컴 생성 sample을 저장소에 복사하지 않는다. Madi가 자체 원고와 이 profile로
생성한 fixture를 사용하고, 실제 한글에서 저장된 결과를 보관해야 한다면 public
재배포 권리와 개인정보/원고 내용을 별도로 확인한다.

## 한글 Automation

### 공식 API 근거

HwpAutomation 2504 manual은 COM/OLE ProgID `HwpFrame.HwpObject.2`, `Open`,
`SaveAs`, `XHwpWindows`와 `Visible`을 설명한다. Manual의 format 표에는 HWP 계열은
있지만 exact `HWPX` token은 없다. 따라서 출처를 구분한다.

| 동작 | Exact format | 판정 |
|---|---|---|
| HWP open/save | `HWP` | 2504 manual로 `VERIFIED` |
| HWPX open | uppercase `HWPX` | [한컴 forum 담당자 답변](https://forum.developer.hancom.com/t/hwpx-open/1006)으로 `VERIFIED`; 빈 format 자동 판별도 공식 답변에 있음 |
| HWPX SaveAs | uppercase `HWPX` | [한컴 담당자 전체 예](https://forum.developer.hancom.com/t/topic/2303/2)로 `VERIFIED` |

공식 예의 lifecycle은 다음과 같다.

```text
CreateObject("HWPFrame.HwpObject")
Open(path, "HWPX", "")
SaveAs(path, "HWPX", "")
Quit()
```

한글 창의 `Visible` property는 manual로 확인되지만 완전 headless, 무인 실행,
prompt가 절대 발생하지 않음은 `UNVERIFIED`다. 로컬 파일 open/save에는 보안 승인
메시지가 발생할 수 있으며 공식 안내는 보안 module 등록과
`RegisterModule("FilePathCheckDLL", "FilePathCheckerModuleExample")` 호출을
요구한다.

Bridge는 자신이 만든 automation object/document/window만 닫고 기존 사용자의
한글 process를 kill하지 않는다. Timeout 뒤 process kill이 필요한 전용 worker
격리는 별도 검증 전까지 구현하지 않는다.

### 이 PC의 read-only probe

2026-08-13에 registry/file metadata/signature/process만 읽었다. `hwp.exe`나 COM
object를 실행하지 않았다.

| 항목 | 관찰 결과 |
|---|---|
| 설치 제품 | 한컴오피스 2022, uninstall version `12.0.0.1189`, publisher `Hancom` |
| 설치 경로 | `C:\Program Files (x86)\HNC\Office 2022\` |
| 실행 파일 | `C:\Program Files (x86)\HNC\Office 2022\HOffice120\bin\hwp.exe` |
| file/product version | `12.0.0.4170` |
| Authenticode | `Valid`, signer `HANCOM INC.` |
| registered ProgID | `HWPFrame.HwpObject`, `.1`, `.2` -> CLSID `{2291CF00-64A1-4877-A9B4-68CFE89612D6}` |
| absent ProgID | `.3`, `HWP.HwpObject` |
| LocalServer32 | 위 `hwp.exe -Automation`; registry의 32-bit CLSID view에 존재 |
| 보안 module | `HKCU\Software\HNC\HwpAutomation\Modules` key는 있으나 등록 value 0개 |
| 실행 중 한글 | 없음 |

따라서 capability probe는 `installed/registered`를 보고할 수 있지만 실제 변환
capability를 `PASS`로 보고하면 안 된다. 보안 module 미등록 때문에 현재
unattended run은 승인 prompt/hang 위험이 있다. 실제 COM bitness와 Madi bridge의
호환성은 최소 x86 worker probe와 실제 open/save로 확인한다.

## 저작권, license와 재배포

이 절은 법률 자문이 아니다.

### Official model source

Audited commit의 [`LICENSE.txt`](https://github.com/hancom-io/hwpx-owpml-model/blob/1453388472c703a4b299a0834f425cdac16644b9/LICENSE.txt)는
Apache License 2.0이고
[`NOTICE.txt`](https://github.com/hancom-io/hwpx-owpml-model/blob/1453388472c703a4b299a0834f425cdac16644b9/NOTICE.txt)가
있다. Source/code를 복사하거나 binary로 결합하면 Apache-2.0 조건과 NOTICE 보존을
release compliance에 반영한다. 이 문서는 source를 vendoring하지 않고 사실만
독립 구현 근거로 사용한다.

### 포맷 문서와 국가표준

한컴 공개 형식 페이지는 공개 문서를 참고한 파생 개발 결과물의 저작권이
개발자에게 있을 수 있다고 설명하지만, 문서 원본의 복사/배포는 수정하지 않은
최신 원본 조건을 두고 다음 고지를 요구한다.

> 본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.

페이지 문언은 일부 항목에서 `.hwp` 공개 문서를 특정하므로 이 고지가 HWPX/OWPML
구현에 정확히 어떻게 적용되는지는 `LEGAL REVIEW REQUIRED`다. 보수적으로 제품의
존재하는 UI/manual/help/source에 출처를 표시할 준비를 하되 법률 검토 없이 조건을
축소 해석하지 않는다.

국가기술표준원 기계가독 원문 화면은 시범 서비스, 법적 책임 비보증, 저작권 보호,
상업적 활용 금지를 명시한다. 따라서 이 repository에 그 HTML이나 XSD 전문을
복제하지 않는다. 상용 개발에서 표준 원문/XSD를 bundle하거나 validator resource로
재배포하려면 별도 이용 허가와 법률 검토가 필요하다.

### Automation

한컴 공식 Automation 페이지는 개인의 비상업적 이용만 자유롭게 허용하고,
상업적으로 판매되는 solution/application 등 상업 목적은 한컴 승인과 별도
license 취득이 필요하다고 명시한다.

```text
HANCOM AUTOMATION LICENSE REVIEW REQUIRED BEFORE DISTRIBUTION
```

Direct HWPX export와 Automation-based HWP conversion은 서로 독립된 capability와
license gate로 유지한다. Direct exporter가 동작한다는 이유로 Automation license가
생기지 않고, 한컴 설치가 발견됐다는 이유로 배포 권한이 생기지 않는다.

### Sample

완전한 official HWPX sample의 재배포 조건은 `UNVERIFIED`다. URL이 공개돼 있거나
한글이 local file을 만들 수 있다는 이유만으로 repository/public fixture에 넣지
않는다. Madi 자체 fixture를 우선한다.

## Release와 validation gate

다음 증거가 모두 있기 전에는 profile 이름 이상으로 적합성을 확장해 주장하지
않는다.

1. ZIP entry, exact MIME, XML well-formedness, ID/IDREF/href/count 검증 PASS
2. profile 1.31 namespace만 존재하고 2024 namespace가 섞이지 않았다는 검증 PASS
3. 적어도 한 section/paragraph/run과 모든 header reference 검증 PASS
4. A4/page/header/footer/page-number fixture의 한글 2022 open/re-save PASS
5. ruby/dutmal fixture의 구조 및 표시 round-trip PASS, 아니면 explicit fallback warning
6. HWP conversion을 제공할 경우 Automation license, security module, timeout/cleanup 및
   HWP/HWPX reopen PASS
7. model source를 결합했다면 Apache-2.0/NOTICE compliance PASS
8. official sample 또는 국가표준 resource를 배포한다면 별도 권리 검토 PASS

현재 결론은 다음과 같다.

```text
DIRECT HWPX PROFILE 1.31: IMPLEMENTATION BASIS VERIFIED, ROUND-TRIP PENDING
KS X 6101:2024 FULL CONFORMANCE: UNVERIFIED
RUBY/DUTMAL: STRUCTURE VERIFIED, LEGACY VALUES/ROUND-TRIP PENDING
HWP AUTOMATION: INSTALLED/REGISTERED, SECURITY MODULE AND LIVE VALIDATION PENDING
COMMERCIAL AUTOMATION DISTRIBUTION: LICENSE REVIEW REQUIRED
OFFICIAL SAMPLE REDISTRIBUTION: UNVERIFIED
```
