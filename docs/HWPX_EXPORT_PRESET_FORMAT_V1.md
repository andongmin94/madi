# HWPX Export Preset Format v1

기준일: 2026-08-13

## 1. Envelope

HWPX preset은 schema 8의 generic `export_presets` row를 사용한다.

```text
kind = HWPX
preset_format = MADI_EXPORT_PRESET
preset_version = 1
preset_json = canonical compact UTF-8 JSON object
content_hash = lowercase SHA-256(preset_json bytes)
revision >= 0
```

`kind`가 config decoder를 선택한다. EPUB과 HWPX config를 ambiguous untagged union으로
추측하지 않는다. Unknown field/token, non-finite number, unsafe string과 out-of-range 값은
거부한다.

## 2. Closed config

V1 config key는 다음 그룹뿐이다.

- identity: `formatVersion = 1`
- page: size token, custom width/height, orientation, 7 margin/gutter values
- body: font token, size, line-spacing mode/value, indent, paragraph spacing, alignment
- headings: work/volume/chapter/scene style object
- inclusion: title page와 4 hierarchy title flag
- sections/controls: split, page number, header/footer, scene break token

Heading style object는 font family token, size, bold, alignment, before/after와
page-break-before를 가진다. Arbitrary XML/CSS/script, resource path/URL, embedded font, macro와
Automation command는 넣을 수 없다.

## 3. Tokens와 주요 범위

| Field | Values/range |
|---|---|
| pageSizeToken | `A4`, `LETTER`, `CUSTOM` |
| orientation | `PORTRAIT`, `LANDSCAPE` |
| page/custom dimension | custom 50–500 mm; built-in이면 null |
| margins/gutter | 0–100 mm, 유효 text area 필요 |
| font size | 6–72 pt |
| lineSpacingMode | `PERCENT`, `FIXED_PT` |
| lineSpacingValue | percent 50–400; fixed 6–200 pt |
| text/heading alignment | `LEFT`, `CENTER`, `RIGHT`, `JUSTIFY` |
| sectionSplitMode | `SINGLE`, `VOLUME` |
| pageNumberPosition | `BOTTOM_LEFT`, `BOTTOM_CENTER`, `BOTTOM_RIGHT` |
| sceneBreakToken | `ORNAMENT`, `RULE`, `SPACE` |
| pageNumberStart | 1–1,000,000 |

`includeWorkTitle/includeVolumeTitles/includeChapterTitles/includeSceneTitles = false`는 해당
hierarchy heading을 configured omission으로 기록하는 명시적 선택이며 body block을 숨기지
않는다. Header/footer text는 include flag가 false면 빈 문자열이어야 한다. Font family와 text는
bounded XML-safe Unicode여야 한다. Page margins는 width/height를 소진하거나 header/footer
margin을 넘을 수 없다.

## 4. Built-in templates

Renderer는 다음 immutable template을 제공한다.

| ID | 표시명 | 목적 |
|---|---|---|
| `GENERAL_SUBMISSION` | 범용 출판사 제출본 | A4 일반 제출 예시 |
| `READABILITY_REVIEW` | 가독성 중심 검토본 | 넓은 여백/줄간격과 scene title |
| `COMPACT_REVIEW` | 압축 검토본 | 작은 글자/좁은 여백의 검토본 |

Built-in은 특정 출판사의 공식 양식이 아니다. SQLite에 seed하지 않으며 사용자가 복사할
때 custom HWPX row가 생긴다. 따라서 template 수정은 기존 project의 canonical preset을
소급 변경하지 않는다.

## 5. CRUD와 revision

Create/duplicate는 preset revision 0으로 시작한다. Update/delete는 current project revision과
expected preset revision을 함께 비교한다. Name/config의 semantic no-op은 content hash,
timestamp, preset revision과 project revision을 올리지 않는다. Cross-project ID, kind mismatch,
tampered hash/config는 transaction을 바꾸지 않고 거부한다.

같은 project 안에서 preset 이름 중복은 허용하되 목록이 duplicate-name diagnostic을
반환한다. Canonical order는 case-insensitive name 뒤 ID다.

## 6. Snapshot

Named snapshot payload v5 `export_presets` 배열은 EPUB과 HWPX envelope를 kind와 함께
그대로 보존한다. Restore는 ID/project/kind/format/version/canonical hash/revision/timestamp를
검증하고 전체 logical state를 transaction으로 교체한다. Generated file, path, report,
one-shot title-page contact와 UI draft/selection은 포함하지 않는다.

## 7. Example

아래는 shape 예시이며 특정 출판사 요구사항이 아니다.

```json
{
  "formatVersion": 1,
  "pageSizeToken": "A4",
  "customPageWidth": null,
  "customPageHeight": null,
  "orientation": "PORTRAIT",
  "marginTop": 25,
  "marginBottom": 25,
  "marginLeft": 25,
  "marginRight": 25,
  "headerMargin": 15,
  "footerMargin": 15,
  "gutter": 0,
  "fontFamilyToken": "함초롬바탕",
  "fontSizePt": 10.5,
  "lineSpacingMode": "PERCENT",
  "lineSpacingValue": 180,
  "firstLineIndent": 10,
  "paragraphSpacingBefore": 0,
  "paragraphSpacingAfter": 0,
  "textAlign": "JUSTIFY",
  "workTitleStyle": { "fontFamilyToken": "함초롬바탕", "fontSizePt": 22, "bold": true, "alignment": "CENTER", "spacingBefore": 0, "spacingAfter": 24, "pageBreakBefore": false },
  "volumeTitleStyle": { "fontFamilyToken": "함초롬바탕", "fontSizePt": 18, "bold": true, "alignment": "CENTER", "spacingBefore": 20, "spacingAfter": 16, "pageBreakBefore": true },
  "chapterTitleStyle": { "fontFamilyToken": "함초롬바탕", "fontSizePt": 15, "bold": true, "alignment": "LEFT", "spacingBefore": 18, "spacingAfter": 12, "pageBreakBefore": true },
  "sceneTitleStyle": { "fontFamilyToken": "함초롬바탕", "fontSizePt": 12, "bold": true, "alignment": "LEFT", "spacingBefore": 12, "spacingAfter": 8, "pageBreakBefore": false },
  "includeTitlePage": true,
  "includeWorkTitle": true,
  "includeVolumeTitles": true,
  "includeChapterTitles": true,
  "includeSceneTitles": false,
  "sectionSplitMode": "SINGLE",
  "includePageNumber": true,
  "pageNumberStart": 1,
  "pageNumberPosition": "BOTTOM_CENTER",
  "includeHeader": false,
  "headerText": "",
  "includeFooter": false,
  "footerText": "",
  "sceneBreakToken": "ORNAMENT"
}
```
