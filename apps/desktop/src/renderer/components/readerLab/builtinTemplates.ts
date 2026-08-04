import type { ReaderRenderConfig } from "../../../shared/publication";
import type { ReaderPresetOption } from "./types";
import { validateReaderRenderConfig } from "../../../shared/readerConfigValidation";

interface TemplateSpec {
  readonly id: string;
  readonly name: string;
  readonly family: "GENERIC" | "PLATFORM_LIKE";
  readonly category: "PHONE" | "TABLET" | "DESKTOP";
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly paragraphSpacing: number;
  readonly horizontalPadding: number;
  readonly theme: "LIGHT" | "SEPIA" | "DARK";
}

const SPECS: readonly TemplateSpec[] = [
  { id: "generic-small-phone", name: "범용 소형 모바일", family: "GENERIC", category: "PHONE", width: 360, height: 720, fontSize: 16, lineHeight: 1.75, paragraphSpacing: 12, horizontalPadding: 22, theme: "LIGHT" },
  { id: "generic-large-phone", name: "범용 대형 모바일", family: "GENERIC", category: "PHONE", width: 430, height: 860, fontSize: 17, lineHeight: 1.8, paragraphSpacing: 14, horizontalPadding: 26, theme: "LIGHT" },
  { id: "generic-tablet", name: "범용 태블릿", family: "GENERIC", category: "TABLET", width: 768, height: 1024, fontSize: 18, lineHeight: 1.8, paragraphSpacing: 16, horizontalPadding: 72, theme: "SEPIA" },
  { id: "generic-desktop", name: "범용 데스크톱", family: "GENERIC", category: "DESKTOP", width: 960, height: 900, fontSize: 18, lineHeight: 1.85, paragraphSpacing: 18, horizontalPadding: 160, theme: "LIGHT" },
  { id: "generic-dark-phone", name: "범용 다크 모바일", family: "GENERIC", category: "PHONE", width: 390, height: 844, fontSize: 17, lineHeight: 1.8, paragraphSpacing: 14, horizontalPadding: 24, theme: "DARK" },
  { id: "kakao-like-mobile", name: "카카오페이지형 모바일", family: "PLATFORM_LIKE", category: "PHONE", width: 390, height: 844, fontSize: 17, lineHeight: 1.9, paragraphSpacing: 16, horizontalPadding: 24, theme: "LIGHT" },
  { id: "kakao-like-desktop", name: "카카오페이지형 데스크톱", family: "PLATFORM_LIKE", category: "DESKTOP", width: 820, height: 900, fontSize: 18, lineHeight: 1.9, paragraphSpacing: 18, horizontalPadding: 140, theme: "LIGHT" },
  { id: "series-like-mobile", name: "네이버 시리즈형 모바일", family: "PLATFORM_LIKE", category: "PHONE", width: 390, height: 844, fontSize: 16, lineHeight: 1.85, paragraphSpacing: 15, horizontalPadding: 22, theme: "LIGHT" },
  { id: "series-like-desktop", name: "네이버 시리즈형 데스크톱", family: "PLATFORM_LIKE", category: "DESKTOP", width: 860, height: 900, fontSize: 17, lineHeight: 1.85, paragraphSpacing: 16, horizontalPadding: 150, theme: "LIGHT" },
  { id: "munpia-like-mobile", name: "문피아형 모바일", family: "PLATFORM_LIKE", category: "PHONE", width: 390, height: 844, fontSize: 17, lineHeight: 1.75, paragraphSpacing: 13, horizontalPadding: 20, theme: "SEPIA" },
  { id: "munpia-like-desktop", name: "문피아형 데스크톱", family: "PLATFORM_LIKE", category: "DESKTOP", width: 900, height: 900, fontSize: 18, lineHeight: 1.8, paragraphSpacing: 15, horizontalPadding: 155, theme: "SEPIA" }
];

function colors(theme: TemplateSpec["theme"]): {
  readonly backgroundColor: string;
  readonly textColor: string;
} {
  if (theme === "DARK") {
    return { backgroundColor: "#191a1d", textColor: "#e7e4de" };
  }
  if (theme === "SEPIA") {
    return { backgroundColor: "#f1e7d1", textColor: "#3b3024" };
  }
  return { backgroundColor: "#fffdf8", textColor: "#26231f" };
}

function configFor(spec: TemplateSpec): ReaderRenderConfig {
  const themeColors = colors(spec.theme);
  return validateReaderRenderConfig({
    formatVersion: 1,
    platform: {
      id: spec.id,
      name: spec.name,
      version: 1,
      family: spec.family,
      verificationStatus: spec.family === "PLATFORM_LIKE" ? "UNVERIFIED_SIMULATION" : "GENERIC",
      verifiedAt: null,
      supportedControls: ["TYPOGRAPHY", "SPACING", "VIEWPORT", "THEME"]
    },
    device: {
      id: `${spec.id}-device`,
      name: spec.name,
      category: spec.category,
      viewportWidth: spec.width,
      viewportHeight: spec.height,
      safeAreaTop: spec.category === "PHONE" ? 24 : 0,
      safeAreaBottom: spec.category === "PHONE" ? 20 : 0,
      readerChromeHeight: spec.category === "PHONE" ? 48 : 36,
      pixelRatio: spec.category === "PHONE" ? 2 : 1
    },
    settings: {
      fontFamilyToken: "KOREAN_SANS",
      fontSize: spec.fontSize,
      lineHeight: spec.lineHeight,
      paragraphSpacing: spec.paragraphSpacing,
      firstLineIndent: 0,
      horizontalPadding: spec.horizontalPadding,
      verticalPadding: 32,
      textAlign: "LEFT",
      theme: spec.theme,
      ...themeColors,
      scrollMode: "CONTINUOUS",
      showChapterTitle: true,
      showSceneTitle: true,
      showSceneBreak: true
    },
    workStyle: {
      bodyStyleToken: "PROSE",
      chapterTitleStyleToken: "CHAPTER_DEFAULT",
      sceneTitleStyleToken: "SCENE_DEFAULT",
      sceneBreakStyleToken: "DIAMONDS"
    }
  });
}

export const BUILTIN_READER_PRESETS: readonly ReaderPresetOption[] = SPECS.map(
  (spec) => ({
    id: `builtin:${spec.id}`,
    projectId: "builtin",
    name: spec.name,
    sourceKind: "BUILTIN_TEMPLATE",
    sourceId: spec.id,
    sourceVersion: "1",
    verificationStatus: spec.family === "PLATFORM_LIKE" ? "UNVERIFIED_SIMULATION" : "GENERIC",
    presetFormat: "MADI_READER_PRESET",
    presetVersion: 1,
    config: configFor(spec),
    contentHash: `builtin:${spec.id}:v1`,
    revision: 1,
    createdAt: "",
    updatedAt: "",
    duplicateName: false,
    builtin: true
  })
);

export const DEFAULT_READER_PRESET = BUILTIN_READER_PRESETS[0]!;

export function findBuiltinReaderPreset(id: string | null): ReaderPresetOption | null {
  return BUILTIN_READER_PRESETS.find((preset) => preset.id === id) ?? null;
}
