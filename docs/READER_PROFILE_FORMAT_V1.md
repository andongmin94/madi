# Reader profile format v1

기준일: 2026-08-09

## 1. 계약 목적

Reader profile은 하나의 preview pane을 재현하는 fully resolved rendering config다.
Partial theme, CSS fragment나 특정 외부 앱 설정의 사본이 아니다. Core, Electron main과
renderer는 같은 token과 숫자 범위를 독립적으로 검증한다.

Canonical 상수는 다음과 같다.

| 항목 | 값 |
|---|---|
| preset envelope format | `MADI_READER_PRESET` |
| preset envelope version | `1` |
| `ReaderRenderConfig.formatVersion` | `1` |
| `PlatformProfile.version` | `1` |

Unknown field, unknown enum, 누락된 필드와 다른 version은 거부한다. Alias, legacy token,
CSS fallback이나 자동 format migration은 제공하지 않는다.

## 2. 저장 envelope

SQLite와 IPC의 `ReaderPresetRecord`는 다음 필드를 가진다.

| 필드 | 계약 |
|---|---|
| `id` | project 안의 preset identity |
| `projectId` | 소유 project identity |
| `name` | trim 후 비어 있지 않은 이름, 중복 허용 |
| `sourceKind` | `BUILTIN_TEMPLATE`, `CUSTOM`, `DUPLICATED`, `IMPORTED` |
| `sourceId`, `sourceVersion` | provenance 규칙에 따른 둘 다 string 또는 둘 다 `null` |
| `verificationStatus` | config 내부 status와 exact match |
| `presetFormat`, `presetVersion` | `MADI_READER_PRESET`, `1` |
| `config` | 아래의 fully resolved `ReaderRenderConfig` |
| `contentHash` | canonical config JSON bytes의 lowercase SHA-256 |
| `revision` | preset별 optimistic concurrency token |
| `createdAt`, `updatedAt` | UTC timestamp |

Preset create/update/delete는 project revision도 검사한다. Update/delete는 preset revision을
추가로 검사한다. 같은 이름을 둘 이상 저장할 수 있지만 UI는 duplicate-name warning을
계속 표시한다.

## 3. exact config shape

아래 JSON은 `CUSTOM` envelope에 저장할 수 있는 하나의 완전한 config 예다. 설명을 위한
extra field는 없다.

```json
{
  "formatVersion": 1,
  "platform": {
    "id": "reader-custom-prose",
    "name": "사용자 산문 설정",
    "version": 1,
    "family": "GENERIC",
    "verificationStatus": "USER_DEFINED",
    "verifiedAt": null,
    "supportedControls": ["TYPOGRAPHY", "SPACING", "VIEWPORT", "THEME"]
  },
  "device": {
    "id": "desktop-reading-1440x900",
    "name": "데스크톱 읽기 화면",
    "category": "DESKTOP",
    "viewportWidth": 1440,
    "viewportHeight": 900,
    "safeAreaTop": 0,
    "safeAreaBottom": 0,
    "readerChromeHeight": 48,
    "pixelRatio": 1
  },
  "settings": {
    "fontFamilyToken": "KOREAN_SERIF",
    "fontSize": 18,
    "lineHeight": 1.8,
    "paragraphSpacing": 14,
    "firstLineIndent": 18,
    "horizontalPadding": 72,
    "verticalPadding": 48,
    "textAlign": "LEFT",
    "theme": "SEPIA",
    "backgroundColor": "#f1e7d1",
    "textColor": "#3b3024",
    "scrollMode": "CONTINUOUS",
    "showChapterTitle": true,
    "showSceneTitle": true,
    "showSceneBreak": true
  },
  "workStyle": {
    "bodyStyleToken": "PROSE",
    "chapterTitleStyleToken": "CHAPTER_DEFAULT",
    "sceneTitleStyleToken": "SCENE_DEFAULT",
    "sceneBreakStyleToken": "DIAMONDS"
  }
}
```

## 4. `platform`

| 필드 | 허용 값/규칙 |
|---|---|
| `id` | 비어 있지 않은 string, 최대 256 UTF-16 code unit |
| `name` | 비어 있지 않은 string, 최대 500 UTF-16 code unit |
| `version` | `1` |
| `family` | `GENERIC`, `PLATFORM_LIKE` |
| `verificationStatus` | `GENERIC`, `UNVERIFIED_SIMULATION`, `USER_DEFINED` |
| `verifiedAt` | `null` 또는 canonical millisecond UTC ISO timestamp |
| `supportedControls` | 아래 token의 중복 없는 배열, 최대 4개 |

`supportedControls` token은 `TYPOGRAPHY`, `SPACING`, `VIEWPORT`, `THEME`다. 이 배열은
profile이 표현한다고 선언한 설정 범위이며 임의 property name을 허용하지 않는다.

`PLATFORM_LIKE`는 외부 플랫폼 앱을 정확히 복제했다는 뜻이 아니다. Built-in
platform-like profile은 반드시 `UNVERIFIED_SIMULATION`이고 `verifiedAt=null`이다.
사용자 저장본은 `USER_DEFINED`로 바뀌며 검증된 공식 플랫폼 profile로 승격되지 않는다.

## 5. `device`

| 필드 | 허용 값/범위 |
|---|---|
| `id` | 비어 있지 않은 string, 최대 256 UTF-16 code unit |
| `name` | 비어 있지 않은 string, 최대 500 UTF-16 code unit |
| `category` | `PHONE`, `TABLET`, `DESKTOP` |
| `viewportWidth` | 유한 number, 280~2560 |
| `viewportHeight` | 유한 number, 400~2160 |
| `safeAreaTop` | 유한 number, 0~200 |
| `safeAreaBottom` | 유한 number, 0~200 |
| `readerChromeHeight` | 유한 number, 0~200 |
| `pixelRatio` | 유한 number, 0.5~8 |

유효 content viewport 높이는 다음과 같다.

```text
effectiveViewportHeight
  = viewportHeight - safeAreaTop - safeAreaBottom - readerChromeHeight
```

이 값은 0보다 커야 한다. Preview DOM도 이 세 예약 영역을 실제로 제외하므로 통계가
사용하는 viewport와 보이는 영역이 일치한다.

## 6. `settings`

| 필드 | 허용 값/범위 |
|---|---|
| `fontFamilyToken` | `SYSTEM_SANS`, `SYSTEM_SERIF`, `KOREAN_SANS`, `KOREAN_SERIF` |
| `fontSize` | 유한 number, 10~40 |
| `lineHeight` | 유한 number, 1~3 |
| `paragraphSpacing` | 유한 number, 0~120 |
| `firstLineIndent` | 유한 number, 0~120 |
| `horizontalPadding` | 유한 number, 0~200 |
| `verticalPadding` | 유한 number, 0~200 |
| `textAlign` | `LEFT`, `JUSTIFY` |
| `theme` | `LIGHT`, `SEPIA`, `DARK`, `CUSTOM` |
| `backgroundColor`, `textColor` | exact `#RRGGBB`; canonical 저장은 lowercase |
| `scrollMode` | `CONTINUOUS` |
| `showChapterTitle` | boolean |
| `showSceneTitle` | boolean |
| `showSceneBreak` | boolean |

Font token은 renderer 안의 고정 local/system font stack으로 해석한다. Profile에는 font
family CSS string, font file, URL이나 `@font-face`를 저장하지 않는다. `theme`은 token이며
실제 표시 색은 config의 두 color가 결정한다.

두 relational invariant도 반드시 만족해야 한다.

```text
horizontalPadding * 2 < viewportWidth
verticalPadding * 2 < effectiveViewportHeight
```

각 필드가 개별 범위 안이어도 조합이 이 식을 어기면 canonical preset은 거부된다.

## 7. `workStyle`

| 필드 | 허용 token |
|---|---|
| `bodyStyleToken` | `PROSE` |
| `chapterTitleStyleToken` | `CHAPTER_DEFAULT`, `CHAPTER_COMPACT` |
| `sceneTitleStyleToken` | `SCENE_DEFAULT`, `SCENE_HIDDEN` |
| `sceneBreakStyleToken` | `DIAMONDS`, `RULE`, `SPACE`, `HIDDEN` |

`showSceneTitle`/`showSceneBreak`가 false이거나 대응 style token이 hidden이면 해당 block은
표시와 keyboard focus 순서에서 모두 빠진다. Chapter compact와 scene hidden도 token
의미를 실제 render에 반영한다. 임의 class name이나 style fragment는 받지 않는다.

## 8. provenance와 verification invariant

| `sourceKind` | provenance | 허용 status/family |
|---|---|---|
| `BUILTIN_TEMPLATE` | `sourceId`, `sourceVersion` 모두 필요 | `GENERIC`+`GENERIC` family 또는 `UNVERIFIED_SIMULATION`+`PLATFORM_LIKE` family |
| `CUSTOM` | 둘 다 `null` | `USER_DEFINED`; family는 config가 선언한 값 |
| `DUPLICATED` | 원본 preset ID/version 모두 필요 | `USER_DEFINED` |
| `IMPORTED` | source ID/version 모두 필요 | `USER_DEFINED` |

`verificationStatus` envelope 값과 `config.platform.verificationStatus`는 항상 같아야 한다.
`UNVERIFIED_SIMULATION`과 `USER_DEFINED`의 `verifiedAt`은 `null`이다. `GENERIC` status는
generic built-in에서만 허용된다. Built-in을 새 사용자 preset으로 저장할 때는
`CUSTOM`+null provenance와 `USER_DEFINED` config를 만들고, 저장된 preset duplicate는
`DUPLICATED` provenance를 보존한다.

## 9. canonicalization과 trust boundary

Core는 config를 검증한 뒤 object key를 결정적으로 정렬하고 색을 lowercase로
normalize하여 compact JSON을 만든다. `contentHash`는 이 exact UTF-8 bytes의 SHA-256다.
DB에서 preset을 읽을 때도 envelope, config, provenance와 hash를 모두 다시 검사한다.

Electron main은 core JSON을 shared validator로 검사한 뒤 renderer에 넘긴다. Renderer도
사용 전에 같은 exact config 계약을 적용한다. Persisted preset은 invalid 조합을
fail-closed로 거부한다. Pane-local override는 canonical preset이 아니며 UI state에서
읽은 뒤 viewport/safe area가 보이는 공간을 남기도록 padding과 높이를 repair하고 최종
resolved config를 다시 strict-validate한다.

## 10. built-in, pane override와 snapshot

Built-in template은 renderer bundle의 immutable option이고 SQLite row가 아니다. 같은
Publication IR에 서로 다른 fully resolved config를 적용할 수 있으므로 pane 설정 변경은
원고 compile을 요구하지 않는다.

Pane override, zoom, scroll progress와 선택은 `reader-lab.v1` UI state다. Profile의
canonical config나 hash에 들어가지 않는다. 현재 named snapshot은 저장된
`reader_presets` row는 포함하지만 `reader-lab.v1`은 제외한다. Restore 후 preset 목록과
hash/status를 다시 검증하며, 사라진 selected preset reference만 유효한 option으로
normalize한다.

## 11. 관련 문서

- [Phase 1F result](./PHASE_1F_RESULT.md)
- [Reader Lab performance](./READER_LAB_PERFORMANCE.md)
- [Reader Lab architecture](./READER_LAB_ARCHITECTURE.md)
- [Reader Lab visual diagnostics](./READER_LAB_VISUAL_DIAGNOSTICS.md)
- [ADR-0006](./decisions/ADR-0006-reader-lab-rendering-is-isolated-and-non-executable.md)
