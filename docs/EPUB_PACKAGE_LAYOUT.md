# EPUB Package Layout

기준일: 2026-08-09

## 1. Entry layout

```text
작품명.epub
├─ mimetype
├─ META-INF/
│  └─ container.xml
└─ EPUB/
   ├─ package.opf
   ├─ nav.xhtml
   ├─ styles/
   │  └─ book.css
   ├─ text/
   │  ├─ chapter-0001-<stable-12-hex>.xhtml
   │  └─ scene-0001-<stable-12-hex>.xhtml
   └─ images/
      └─ cover.png | cover.jpg
```

Cover가 없으면 `images` entry와 cover manifest item이 없다. CHAPTER/SCENE 파일은 실제
split 결과에 따라 한 종류 또는 chapterless fallback의 scene 파일로 구성된다.

## 2. ZIP 규칙

Entry order는 `mimetype`, `META-INF/container.xml`, `EPUB/package.opf`,
`EPUB/nav.xhtml`, `EPUB/styles/book.css`, content documents, optional cover 순서로 고정한다.
`mimetype`은 offset 0의 첫 entry이며 `application/epub+zip` 정확한 bytes를 Stored 방식으로
쓴다. 나머지 XML/XHTML/CSS는 Deflate, cover는 Stored다.

모든 entry timestamp는 `zip::DateTime::default()`로 고정한다. Entry path는 빈 component,
`.`/`..`, backslash, colon, NUL, leading slash를 허용하지 않으며 duplicate를 거부한다.
Windows drive/UNC나 host filesystem path가 archive 안에 들어가지 않는다.

## 3. Container와 package

`META-INF/container.xml`의 단일 rootfile은 `EPUB/package.opf`와 정확히 일치하며 media type은
`application/oebps-package+xml`이다.

`package.opf`는 unique identifier ref `pub-id`, stable publication identifier, title,
creator, language와 deterministic modified를 포함한다. Optional metadata는 값이 있을 때만
publisher, description, rights와 subject element를 만든다. Manifest ID/href는 고유하고
nav, CSS, 모든 content document와 optional cover가 실제 entry와 일치한다. Spine은 content
unit 순서와 일치한다.

## 4. Content split과 stable identity

Binder/Publication IR section/block order를 바꾸지 않는다. CHAPTER split은 level-3 heading을
경계로 파일을 만들고 chapter 전후에 chapter 소속이 없는 scene이 있으면 scene unit으로
fallback한다. SCENE split은 section 하나당 파일 하나다.

Filename은 `{chapter|scene}-{1-based-order:04}-{sha256(key)[0..12]}.xhtml`이다. Section과
block ID는 `madi-epub-source-v1`, kind와 source ID의 length-prefixed SHA-256으로 만든다.
사용자 제목은 filename이 아니라 heading/title/nav text 안에서 원문 UTF-8로 보존한다.

## 5. XHTML 의미 mapping

| Publication IR | XHTML |
|---|---|
| Heading level 1–4 | `h1`–`h4` 또는 숨김 설정일 때 stable `span.source-anchor` |
| Paragraph | `p` |
| Quote | `blockquote > p` |
| SceneBreak | `hr.scene-break` |
| Unsupported | `p.unsupported-fallback` + WARNING |
| Strong | `strong` |
| Emphasis | `em` |
| Underline | `span.underline` |
| Strike | `s` |
| Ruby | `ruby` + `rt` |

각 content document는 XML declaration, XHTML doctype/namespace, UTF-8 meta, title,
`xml:lang`/`lang`, local stylesheet link를 가진다. User text/attribute는 XML escape하며 invalid
control character는 compiler 전에 거부한다. Raw HTML, script, event handler, iframe,
object/embed, remote URL과 external stylesheet/font는 생성하지 않는다.

## 6. Navigation

`nav.xhtml`은 local CSS를 사용하고 `nav epub:type="toc" id="toc"`를 가진다. TOC depth,
chapter/scene title 표시 option을 반영하면서 Publication heading order를 보존한다. 모든
link는 manifest content document와 stable fragment를 가리킨다. TOC 대상이 없으면 첫
content section anchor에 publication title link 한 개를 만든다.

## 7. CSS와 cover

CSS는 stylesheet/body/scene-break token의 닫힌 조합으로만 생성한다. 상대 단위와 reader
user setting을 우선하며 viewport pixel, remote font, arbitrary declaration과 external URL을
저장하지 않는다.

Cover는 PNG/JPEG decoder로 magic/format/dimension을 확인하고 pixel data를 다시
PNG 또는 quality-90 JPEG로 encode한다. Re-encoded bytes만 archive에 넣어 trailing/polyglot
payload를 보존하지 않는다. Manifest에는 하나 이하의 `cover-image`만 허용한다.

## 8. Hash

File SHA-256은 최종 ZIP bytes의 hash다. `logicalPackageHash`는 고정 namespace 뒤에 entry
path length/path/bytes length/bytes를 entry order대로 hash한다. 현재 ZIP timestamp와 order도
고정되어 두 hash 모두 deterministic해야 한다.
