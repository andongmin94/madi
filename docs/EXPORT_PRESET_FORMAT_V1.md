# Export Preset Format v1

기준일: 2026-08-09

## 1. 저장 envelope

Export preset은 향후 exporter와 공유할 generic SQLite envelope를 사용하지만 v1의 유일한
`kind`는 `EPUB`이다.

| Field | Contract |
|---|---|
| `id` | project 안의 stable non-empty ID |
| `project_id` | owning project |
| `kind` | exact `EPUB` |
| `name` | trim 후 1–500 Unicode scalar |
| `preset_format` | exact `MADI_EXPORT_PRESET` |
| `preset_version` | exact integer `1` |
| `preset_json` | canonical JSON인 아래 closed config |
| `content_hash` | canonical `preset_json` UTF-8 SHA-256 lowercase hex |
| `revision` | 0 이상 optimistic revision |
| `created_at`, `updated_at` | database timestamp |

Unknown kind/format/version/field/token은 alias나 fallback으로 받지 않는다. 동일 canonical
content를 다시 저장하면 `noOp=true`이며 preset/project revision과 updated time을 올리지
않는다.

## 2. EPUB config

```json
{
  "formatVersion": 1,
  "targetProfile": "EPUB_3_4_DRAFT_2026_08",
  "splitMode": "CHAPTER",
  "tocDepth": 3,
  "includeChapterTitles": true,
  "includeSceneTitles": true,
  "sceneBreakStyleToken": "ORNAMENT",
  "bodyStyleToken": "REFLOWABLE_PROSE",
  "includeCover": false,
  "stylesheetToken": "MADI_CLASSIC"
}
```

Allowed values:

| Field | Values |
|---|---|
| `formatVersion` | `1` |
| `targetProfile` | `EPUB_3_4_DRAFT_2026_08`, `EPUB_3_3_COMPATIBILITY` |
| `splitMode` | `CHAPTER`, `SCENE` |
| `tocDepth` | integer 1–4 |
| title/cover flags | boolean |
| `sceneBreakStyleToken` | `ORNAMENT`, `RULE`, `SPACE` |
| `bodyStyleToken` | `REFLOWABLE_PROSE`, `INDENTED_PROSE`, `SPACED_PROSE` |
| `stylesheetToken` | `MADI_CLASSIC`, `MADI_MODERN`, `MADI_MINIMAL` |

Arbitrary CSS, numeric CSS value, URL, font name/path, script와 unknown property는 없다.

## 3. default

신규 project의 UI default는 3.4 Draft, CHAPTER, TOC depth 3, chapter/scene title 표시,
ORNAMENT, REFLOWABLE_PROSE, MADI_CLASSIC, cover 제외다. Cover 포함은 저장된 cover가 있을 때 선택할
수 있으며 includeCover=true인데 cover asset이 없으면 export 전에 실패한다.

기본값은 implicit canonical row가 아니다. 사용자가 preset을 생성하면 generated ID와
revision 0인 row를 만들고 project revision을 1 올린다.

## 4. CRUD와 concurrency

Create/update/duplicate/delete는 current project revision을 요구한다. Update는 preset
revision도 함께 확인한다. Duplicate는 source config를 canonical copy하고 새 ID/name,
revision 0을 만든다. Cross-project ID와 stale revision은 실패한다.

UI에서 저장 preset을 선택한 뒤 option을 일회성으로 변경할 수 있다. Cover나 metadata
mutation 때문에 state를 reload해도 이 dirty one-off config를 덮어쓰지 않는다. Snapshot
restore나 selected preset 변경/삭제처럼 authoritative reload가 발생하면 저장된 config
또는 default로 reconcile한다.

## 5. snapshot

Payload 5는 모든 project EPUB preset의 ID/name/envelope/config/hash/revision/timestamp를
포함한다. Diff는 added/deleted/changed count를 계산하고 restore는 transaction 안에서
전체 set을 교체한 뒤 hash/ownership/config를 다시 검증한다. Payload 1–4에는 export preset
field가 없어야 하며 restore 결과는 빈 preset set이다.

Generated `.epub`, output path, report, validation cache, last export와 UI selected preset은
canonical preset 또는 snapshot에 포함하지 않는다.

## 6. compatibility

V1을 확장할 때 unknown field를 조용히 무시하지 않는다. 새 exporter kind나 config는 새
closed schema/version, validator, canonical hash, snapshot 및 UI migration을 함께 추가한다.
3.4 final 의미가 draft profile과 달라지면 기존 `EPUB_3_4_DRAFT_2026_08` 값을 재해석하지
않고 새 profile ID를 추가한다.
