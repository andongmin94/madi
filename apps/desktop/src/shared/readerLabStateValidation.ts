import type {
  ReaderDeviceCategory,
  ReaderFontToken,
  ReaderLabUiState,
  ReaderPaneOverrides,
  ReaderPaneUiState,
  ReaderSettings,
  ReaderTextAlign,
  ReaderTheme,
  WorkStyle
} from "./publication";
import { READER_FONT_TOKENS, READER_LIMITS } from "./readerConfigValidation";

const DEVICE_CATEGORIES: readonly ReaderDeviceCategory[] = [
  "PHONE",
  "TABLET",
  "DESKTOP"
];
const TEXT_ALIGNS: readonly ReaderTextAlign[] = ["LEFT", "JUSTIFY"];
const THEMES: readonly ReaderTheme[] = ["LIGHT", "SEPIA", "DARK", "CUSTOM"];
const SCENE_BREAK_STYLES: readonly WorkStyle["sceneBreakStyleToken"][] = [
  "DIAMONDS",
  "RULE",
  "SPACE",
  "HIDDEN"
];
const COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;
type MutablePartial<T> = { -readonly [K in keyof T]?: T[K] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  label: string
): void {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error(`${label}에 지원하지 않는 필드가 있습니다.`);
  }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${label} 값이 지원되지 않습니다.`);
  }
  return value as T;
}

function bounded(
  value: unknown,
  bounds: { readonly min: number; readonly max: number },
  label: string
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < bounds.min ||
    value > bounds.max
  ) {
    throw new Error(`${label} 값이 허용 범위를 벗어났습니다.`);
  }
  return value;
}

function optionalId(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new Error(`${label} 값이 올바르지 않습니다.`);
  }
  return value;
}

function requiredId(value: unknown, label: string): string {
  const parsed = optionalId(value, label);
  if (parsed === null) {
    throw new Error(`${label} 값이 비어 있습니다.`);
  }
  return parsed;
}

function validateSettingsOverride(value: unknown): Partial<ReaderSettings> {
  if (!isRecord(value)) {
    throw new Error("Reader 설정 override가 올바르지 않습니다.");
  }
  exactKeys(
    value,
    [
      "fontFamilyToken",
      "fontSize",
      "lineHeight",
      "paragraphSpacing",
      "firstLineIndent",
      "horizontalPadding",
      "verticalPadding",
      "textAlign",
      "theme",
      "backgroundColor",
      "textColor",
      "scrollMode",
      "showChapterTitle",
      "showSceneTitle",
      "showSceneBreak"
    ],
    "Reader 설정 override"
  );
  const result: MutablePartial<ReaderSettings> = {};
  if (value.fontFamilyToken !== undefined) {
    result.fontFamilyToken = oneOf(
      value.fontFamilyToken,
      READER_FONT_TOKENS,
      "font token"
    ) as ReaderFontToken;
  }
  for (const [key, bounds] of [
    ["fontSize", READER_LIMITS.fontSize],
    ["lineHeight", READER_LIMITS.lineHeight],
    ["paragraphSpacing", READER_LIMITS.paragraphSpacing],
    ["firstLineIndent", READER_LIMITS.firstLineIndent],
    ["horizontalPadding", READER_LIMITS.padding],
    ["verticalPadding", READER_LIMITS.padding]
  ] as const) {
    if (value[key] !== undefined) {
      result[key] = bounded(value[key], bounds, key);
    }
  }
  if (value.textAlign !== undefined) {
    result.textAlign = oneOf(value.textAlign, TEXT_ALIGNS, "text alignment");
  }
  if (value.theme !== undefined) {
    result.theme = oneOf(value.theme, THEMES, "theme");
  }
  for (const key of ["backgroundColor", "textColor"] as const) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== "string" || !COLOR_PATTERN.test(value[key])) {
        throw new Error(`${key} 값은 #RRGGBB 형식이어야 합니다.`);
      }
      result[key] = value[key].toLowerCase();
    }
  }
  if (value.scrollMode !== undefined) {
    result.scrollMode = oneOf(value.scrollMode, ["CONTINUOUS"] as const, "scroll mode");
  }
  for (const key of [
    "showChapterTitle",
    "showSceneTitle",
    "showSceneBreak"
  ] as const) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== "boolean") {
        throw new Error(`${key} 값은 boolean이어야 합니다.`);
      }
      result[key] = value[key];
    }
  }
  return result;
}

function validateOverrides(value: unknown): ReaderPaneOverrides {
  if (!isRecord(value)) {
    throw new Error("Reader pane override가 올바르지 않습니다.");
  }
  exactKeys(
    value,
    [
      "deviceCategory",
      "viewportWidth",
      "viewportHeight",
      "readerSettings",
      "sceneBreakStyleToken"
    ],
    "Reader pane override"
  );
  return {
    ...(value.deviceCategory === undefined
      ? {}
      : {
          deviceCategory: oneOf(
            value.deviceCategory,
            DEVICE_CATEGORIES,
            "device category"
          )
        }),
    ...(value.viewportWidth === undefined
      ? {}
      : {
          viewportWidth: bounded(
            value.viewportWidth,
            READER_LIMITS.viewportWidth,
            "viewport width"
          )
        }),
    ...(value.viewportHeight === undefined
      ? {}
      : {
          viewportHeight: bounded(
            value.viewportHeight,
            READER_LIMITS.viewportHeight,
            "viewport height"
          )
        }),
    ...(value.readerSettings === undefined
      ? {}
      : { readerSettings: validateSettingsOverride(value.readerSettings) }),
    ...(value.sceneBreakStyleToken === undefined
      ? {}
      : {
          sceneBreakStyleToken: oneOf(
            value.sceneBreakStyleToken,
            SCENE_BREAK_STYLES,
            "scene break style"
          )
        })
  };
}

function validatePane(value: unknown): ReaderPaneUiState {
  if (!isRecord(value)) {
    throw new Error("Reader pane 상태가 올바르지 않습니다.");
  }
  exactKeys(
    value,
    ["presetId", "deviceProfileId", "overrides", "zoom", "scrollProgress"],
    "Reader pane 상태"
  );
  return {
    presetId: optionalId(value.presetId, "preset id"),
    deviceProfileId: requiredId(value.deviceProfileId, "device profile id"),
    overrides: validateOverrides(value.overrides),
    zoom: bounded(value.zoom, READER_LIMITS.zoom, "zoom"),
    scrollProgress: bounded(value.scrollProgress, { min: 0, max: 1 }, "scroll progress")
  };
}

export function validateReaderLabUiState(value: unknown): ReaderLabUiState {
  if (!isRecord(value)) {
    throw new Error("Reader Lab UI state가 올바르지 않습니다.");
  }
  exactKeys(
    value,
    [
      "lastScopeNodeId",
      "paneCount",
      "panes",
      "scrollSync",
      "leftPanelWidth",
      "rightPanelWidth",
      "selectedSourceBlockId",
      "diagnosticsExpanded"
    ],
    "Reader Lab UI state"
  );
  if (
    value.paneCount !== 1 &&
    value.paneCount !== 2 &&
    value.paneCount !== 3
  ) {
    throw new Error("Reader pane 수가 올바르지 않습니다.");
  }
  if (!Array.isArray(value.panes) || value.panes.length !== 3) {
    throw new Error("Reader pane 상태는 정확히 3개 슬롯이어야 합니다.");
  }
  if (
    typeof value.scrollSync !== "boolean" ||
    typeof value.diagnosticsExpanded !== "boolean"
  ) {
    throw new Error("Reader Lab boolean 상태가 올바르지 않습니다.");
  }
  return {
    lastScopeNodeId: optionalId(value.lastScopeNodeId, "scope node id"),
    paneCount: value.paneCount,
    panes: value.panes.map(validatePane),
    scrollSync: value.scrollSync,
    leftPanelWidth: bounded(
      value.leftPanelWidth,
      { min: 220, max: 520 },
      "left panel width"
    ),
    rightPanelWidth: bounded(
      value.rightPanelWidth,
      { min: 260, max: 560 },
      "right panel width"
    ),
    selectedSourceBlockId: optionalId(
      value.selectedSourceBlockId,
      "selected source block id"
    ),
    diagnosticsExpanded: value.diagnosticsExpanded
  };
}
