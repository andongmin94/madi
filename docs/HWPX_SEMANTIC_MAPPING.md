# HWPX Semantic Mapping

기준일: 2026-08-13

## 1. Source contract

모든 원고 의미는 `PublicationDocument v1`에서 온다. Renderer HTML, recovery text, Canvas,
Story Bible이나 export용 임의 XML을 보조 원고로 읽지 않는다. Source node/block ID는
report/navigation에 사용할 Madi identity이고 HWPX의 paragraph ID는 deterministic numeric
ID로 별도 생성한다.

## 2. Hierarchy와 heading

| Publication IR | HWPX paragraph/style | 기본 동작 |
|---|---|---|
| WORK heading level 1 | `MADI_WORK_TITLE` | 선택적, work heading style |
| VOLUME heading level 2 | `MADI_VOLUME_TITLE` | 선택적, page-break 가능; VOLUME split boundary |
| CHAPTER heading level 3 | `MADI_CHAPTER_TITLE` | 선택적, chapter new-page option |
| SCENE heading level 4 | `MADI_SCENE_TITLE` | 선택적 |

제목을 숨겨도 source body block을 숨기는 것은 아니다. Heading 자체의 visibility는 preset에
기록한다. `includeWorkTitle/includeVolumeTitles/includeChapterTitles/includeSceneTitles = false`인
heading은 fallback이나 silent drop이 아니라 source ID를 보존한 `configured omission`으로
accounting하며 validator는 visible/omitted heading count를 함께 계산한다.

## 3. Block mapping

| IR block | HWPX 표현 | Coverage disposition |
|---|---|---|
| Hierarchy heading, enabled | heading `hp:p` | exported |
| Hierarchy heading, matching `include* = false` | 생성하지 않음 | configured omission |
| Paragraph | body `hp:p`, one or more styled `hp:run/hp:t` | exported |
| Quote | italic `MADI_BLOCKQUOTE` paragraph와 좌우 inset | exported |
| SceneBreak | `MADI_SCENE_BREAK` paragraph의 closed token | exported |
| Unsupported(non-empty text) | escaped body paragraph + warning | fallback |
| Unsupported(empty text) | request rejection | rejected/failure |

`Unsupported(empty text)`는 의미 있는 안전 fallback을 만들 수 없으므로 fail-closed한다. Image는
fallback 대상 block이 아니다. Publication IR v1에 authored manuscript image variant 자체가
없으므로 exporter가 image를 합성하거나 cover/external asset을 본문으로 삽입하지 않는다.

Scene break token은 `ORNAMENT` → `＊　＊　＊`, `RULE` → `―――`, `SPACE` → ideographic
space다. 이것은 authored prose character count에 섞지 않고 source scene-break identity/count로
별도 검증한다.

## 4. Inline mapping

본문 char property는 strong/emphasis/underline/strike 네 bit의 조합으로 deterministic
table을 만든다.

- strong → `hh:bold`
- emphasis → `hh:italic`
- underline → bottom solid underline
- strike → solid strikeout
- 중첩 modifier → bit 조합에 해당하는 하나의 char property
- plain text → modifier가 없는 body char property

Run 경계가 달라도 concatenated Unicode scalar sequence와 modifier별 segment count를
검증한다. XML special character는 text로 escape하고 script-like 원고를 markup으로 실행하지
않는다.

## 5. Ruby fallback

Legacy HWPX의 대응 후보 `hp:dutmal` 구조 자체는 확인했지만 `szRatio`, `option`,
`styleIDRef`의 안전한 1.31 producer 값과 실제 한글 표시 round-trip을 검증하지 못했다.
따라서 v1은 `기본문자(주석)` plain-text로 보존하고 `HWPX_RUBY_TEXT_FALLBACK` warning을
낸다. Ruby count와 ruby fallback count는 같아야 하며 annotation을 silent drop하지 않는다.

## 6. Styles

본문 config는 font family, point size, line spacing, first-line indent, paragraph before/after,
alignment를 가진다. Heading 4종은 font family/size, bold, alignment, before/after와
page-break-before를 각각 가진다. Blockquote, scene break, title-page title/author,
header/footer는 고정된 Madi paragraph kind로 분리된다.

Font는 package에 embed하지 않는다. `header.xml`의 일곱 언어 fontface group에서 preset이
사용하는 family를 참조하되 실제 PC에 설치됐다는 보장은 별도 report field다. Font가 없어도
원고 text coverage는 성공할 수 있지만 표시 대체 가능성을 사용자에게 알려야 한다.

## 7. Page, title page와 controls

- title page: title/author와 optional subtitle/genre/contact; 마지막 front-matter paragraph
  뒤 page break
- contact: one-shot request에만 존재하며 report/snapshot에 넣지 않음
- chapter start: chapter heading paragraph page break
- page number: `beginNum`, first-section `startNum`, bottom position `pageNum`
- header/footer: BOTH page type의 sublist paragraph

## 8. Coverage accounting

성공 조건은 다음 관계를 동시에 만족하는 것이다.

```text
sourceSectionCount == exportedSectionCount
sourceBlockCount == exportedBlockCount
                  + fallbackBlockCount
                  + configuredOmissionBlockCount
                  + rejectedBlockCount
rejectedBlockCount == 0
sourceCharacterCount == exportedCharacterCount
source scene-break IDs/count == generated scene-break IDs/count
source heading count == generated visible heading count + configured omitted heading count
```

Character count는 paragraph/quote/unsupported의 authored base text Unicode scalar를 세며
hierarchy heading, scene-break ornament와 ruby annotation은 별도 의미 count로 관리한다.
각 source block ID는 네 disposition 중 정확히 하나에만 있어야 한다. Configured omission은
명시적으로 disabled된 hierarchy heading에만 허용하며 body/empty unsupported를 숨기는 escape
hatch가 아니다.

## 9. 제외 의미

표, 수식, footnote/endnote, vertical writing, multi-column, track changes, embedded font,
macro/script는 Publication IR v1/HWPX mapping에 없다. 특히 authored manuscript image는
Publication IR v1 variant가 없으며 cover는 별도 publication asset이다. 향후 지원하려면 먼저
Publication IR variant와 source/asset coverage 계약을 version해야 한다.
