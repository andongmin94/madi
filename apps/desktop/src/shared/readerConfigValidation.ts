import type {
  ReaderFontToken,
  ReaderRenderConfig,
  ReaderSettings,
  ReaderSupportedControl,
  ReaderTextAlign,
  ReaderTheme,
  WorkStyle
} from "./publication";

export const READER_LIMITS = {
  viewportWidth: { min: 280, max: 2560 },
  viewportHeight: { min: 400, max: 2160 },
  fontSize: { min: 10, max: 40 },
  lineHeight: { min: 1, max: 3 },
  paragraphSpacing: { min: 0, max: 120 },
  firstLineIndent: { min: 0, max: 120 },
  padding: { min: 0, max: 200 },
  zoom: { min: 0.5, max: 1.75 }
} as const;

export const READER_FONT_TOKENS: readonly ReaderFontToken[] = [
  "SYSTEM_SANS",
  "SYSTEM_SERIF",
  "KOREAN_SANS",
  "KOREAN_SERIF"
];

const TEXT_ALIGNS: readonly ReaderTextAlign[] = ["LEFT", "JUSTIFY"];
const THEMES: readonly ReaderTheme[] = ["LIGHT", "SEPIA", "DARK", "CUSTOM"];
const SCENE_BREAK_STYLES: readonly WorkStyle["sceneBreakStyleToken"][] = [
  "DIAMONDS",
  "RULE",
  "SPACE",
  "HIDDEN"
];
const SUPPORTED_CONTROLS: readonly ReaderSupportedControl[] = [
  "TYPOGRAPHY",
  "SPACING",
  "VIEWPORT",
  "THEME"
];
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_ID_CHARACTERS = 256;
const MAX_NAME_CHARACTERS = 500;

function isExactIsoTimestamp(value: string): boolean {
  if (!ISO_TIMESTAMP_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  label: string
): void {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new Error(`${label}에 지원하지 않는 필드가 있습니다.`);
  }
}

function boundedNumber(
  value: unknown,
  label: string,
  bounds: { readonly min: number; readonly max: number }
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < bounds.min ||
    value > bounds.max
  ) {
    throw new Error(`${label} 값은 ${bounds.min}~${bounds.max} 범위여야 합니다.`);
  }
  return value;
}

function nonEmptyString(
  value: unknown,
  label: string,
  maximumLength: number
): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximumLength
  ) {
    throw new Error(`${label} 값이 비어 있습니다.`);
  }
  return value;
}

function color(value: unknown, label: string): string {
  if (typeof value !== "string" || !COLOR_PATTERN.test(value)) {
    throw new Error(`${label} 값은 #RRGGBB 형식이어야 합니다.`);
  }
  return value.toLowerCase();
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} 값은 boolean이어야 합니다.`);
  }
  return value;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${label} 값이 지원되지 않습니다.`);
  }
  return value as T;
}

function validateReaderSettings(value: Record<string, unknown>): ReaderSettings {
  return {
    fontFamilyToken: oneOf(value.fontFamilyToken, READER_FONT_TOKENS, "font token"),
    fontSize: boundedNumber(value.fontSize, "font size", READER_LIMITS.fontSize),
    lineHeight: boundedNumber(value.lineHeight, "line height", READER_LIMITS.lineHeight),
    paragraphSpacing: boundedNumber(value.paragraphSpacing, "paragraph spacing", READER_LIMITS.paragraphSpacing),
    firstLineIndent: boundedNumber(value.firstLineIndent, "first-line indent", READER_LIMITS.firstLineIndent),
    horizontalPadding: boundedNumber(value.horizontalPadding, "horizontal padding", READER_LIMITS.padding),
    verticalPadding: boundedNumber(value.verticalPadding, "vertical padding", READER_LIMITS.padding),
    textAlign: oneOf(value.textAlign, TEXT_ALIGNS, "text alignment"),
    theme: oneOf(value.theme, THEMES, "theme"),
    backgroundColor: color(value.backgroundColor, "background color"),
    textColor: color(value.textColor, "text color"),
    scrollMode: oneOf(value.scrollMode, ["CONTINUOUS"] as const, "scroll mode"),
    showChapterTitle: boolean(value.showChapterTitle, "show chapter title"),
    showSceneTitle: boolean(value.showSceneTitle, "show scene title"),
    showSceneBreak: boolean(value.showSceneBreak, "show scene break")
  };
}

function validateSupportedControls(value: unknown): readonly ReaderSupportedControl[] {
  if (
    !Array.isArray(value) ||
    value.length > SUPPORTED_CONTROLS.length ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        !SUPPORTED_CONTROLS.includes(item as ReaderSupportedControl)
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new Error("supported controls 목록이 올바르지 않습니다.");
  }
  return value as ReaderSupportedControl[];
}

export function validateReaderRenderConfig(value: unknown): ReaderRenderConfig {
  if (!isRecord(value)) {
    throw new Error("Reader preset은 객체여야 합니다.");
  }
  exactKeys(
    value,
    ["formatVersion", "platform", "device", "settings", "workStyle"],
    "Reader preset"
  );
  if (value.formatVersion !== 1) {
    throw new Error("지원하지 않는 Reader preset 형식 또는 버전입니다.");
  }
  if (
    !isRecord(value.platform) ||
    !isRecord(value.device) ||
    !isRecord(value.settings) ||
    !isRecord(value.workStyle)
  ) {
    throw new Error("Reader preset 구성요소가 올바르지 않습니다.");
  }
  const platform = value.platform;
  const device = value.device;
  const settings = value.settings;
  const workStyle = value.workStyle;
  exactKeys(
    platform,
    [
      "id",
      "name",
      "version",
      "family",
      "verificationStatus",
      "verifiedAt",
      "supportedControls"
    ],
    "platform profile"
  );
  exactKeys(
    device,
    [
      "id",
      "name",
      "category",
      "viewportWidth",
      "viewportHeight",
      "safeAreaTop",
      "safeAreaBottom",
      "readerChromeHeight",
      "pixelRatio"
    ],
    "device profile"
  );
  exactKeys(
    settings,
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
    "Reader settings"
  );
  exactKeys(
    workStyle,
    [
      "bodyStyleToken",
      "chapterTitleStyleToken",
      "sceneTitleStyleToken",
      "sceneBreakStyleToken"
    ],
    "work style"
  );
  const verifiedAt = platform.verifiedAt;
  if (
    verifiedAt !== null &&
    (typeof verifiedAt !== "string" ||
      !isExactIsoTimestamp(verifiedAt))
  ) {
    throw new Error("verifiedAt 값이 올바르지 않습니다.");
  }
  if (platform.version !== 1) {
    throw new Error("지원하지 않는 platform profile 버전입니다.");
  }
  const family = oneOf(
    platform.family,
    ["GENERIC", "PLATFORM_LIKE"] as const,
    "platform family"
  );
  const verificationStatus = oneOf(
    platform.verificationStatus,
    ["GENERIC", "UNVERIFIED_SIMULATION", "USER_DEFINED"] as const,
    "verification status"
  );
  if (
    (verificationStatus === "GENERIC" && family !== "GENERIC") ||
    (verificationStatus === "UNVERIFIED_SIMULATION" &&
      family !== "PLATFORM_LIKE")
  ) {
    throw new Error("platform family와 verification status가 일치하지 않습니다.");
  }
  const result: ReaderRenderConfig = {
    formatVersion: 1,
    platform: {
      id: nonEmptyString(platform.id, "platform id", MAX_ID_CHARACTERS),
      name: nonEmptyString(platform.name, "platform name", MAX_NAME_CHARACTERS),
      version: 1,
      family,
      verificationStatus,
      verifiedAt,
      supportedControls: validateSupportedControls(platform.supportedControls)
    },
    device: {
      id: nonEmptyString(device.id, "device id", MAX_ID_CHARACTERS),
      name: nonEmptyString(device.name, "device name", MAX_NAME_CHARACTERS),
      category: oneOf(device.category, ["PHONE", "TABLET", "DESKTOP"] as const, "device category"),
      viewportWidth: boundedNumber(device.viewportWidth, "viewport width", READER_LIMITS.viewportWidth),
      viewportHeight: boundedNumber(device.viewportHeight, "viewport height", READER_LIMITS.viewportHeight),
      safeAreaTop: boundedNumber(device.safeAreaTop, "safe area top", READER_LIMITS.padding),
      safeAreaBottom: boundedNumber(device.safeAreaBottom, "safe area bottom", READER_LIMITS.padding),
      readerChromeHeight: boundedNumber(device.readerChromeHeight, "reader chrome height", READER_LIMITS.padding),
      pixelRatio: boundedNumber(device.pixelRatio, "pixel ratio", { min: 0.5, max: 8 })
    },
    settings: validateReaderSettings(value.settings),
    workStyle: {
      bodyStyleToken: oneOf(workStyle.bodyStyleToken, ["PROSE"] as const, "body paragraph style"),
      chapterTitleStyleToken: oneOf(workStyle.chapterTitleStyleToken, ["CHAPTER_DEFAULT", "CHAPTER_COMPACT"] as const, "chapter title style"),
      sceneTitleStyleToken: oneOf(workStyle.sceneTitleStyleToken, ["SCENE_DEFAULT", "SCENE_HIDDEN"] as const, "scene title style"),
      sceneBreakStyleToken: oneOf(workStyle.sceneBreakStyleToken, SCENE_BREAK_STYLES, "scene break style")
    }
  };
  const effectiveViewportHeight =
    result.device.viewportHeight -
    result.device.readerChromeHeight -
    result.device.safeAreaTop -
    result.device.safeAreaBottom;
  if (effectiveViewportHeight <= 0) {
    throw new Error("Reader device safe viewport 높이가 0보다 커야 합니다.");
  }
  if (result.settings.horizontalPadding * 2 >= result.device.viewportWidth) {
    throw new Error("Reader 가로 여백은 viewport 너비보다 작아야 합니다.");
  }
  if (result.settings.verticalPadding * 2 >= effectiveViewportHeight) {
    throw new Error("Reader 세로 여백은 safe viewport 높이보다 작아야 합니다.");
  }
  return result;
}
