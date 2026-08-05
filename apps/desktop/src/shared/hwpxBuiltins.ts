import type {
  HwpxExportPresetConfig,
  HwpxHeadingStyleConfig
} from "./hwpxExport";

export interface BuiltInHwpxPreset {
  readonly id: "GENERAL_SUBMISSION" | "READABILITY_REVIEW" | "COMPACT_REVIEW";
  readonly name: string;
  readonly description: string;
  readonly config: HwpxExportPresetConfig;
}

const heading = (
  fontSizePt: number,
  alignment: "LEFT" | "CENTER",
  spacingBefore: number,
  spacingAfter: number,
  pageBreakBefore: boolean
): HwpxHeadingStyleConfig => ({
  fontFamilyToken: "함초롬바탕",
  fontSizePt,
  bold: true,
  alignment,
  spacingBefore,
  spacingAfter,
  pageBreakBefore
});

const baseConfig = (): HwpxExportPresetConfig => ({
  formatVersion: 1,
  pageSizeToken: "A4",
  customPageWidth: null,
  customPageHeight: null,
  orientation: "PORTRAIT",
  marginTop: 25,
  marginBottom: 25,
  marginLeft: 25,
  marginRight: 25,
  headerMargin: 15,
  footerMargin: 15,
  gutter: 0,
  fontFamilyToken: "함초롬바탕",
  fontSizePt: 10.5,
  lineSpacingMode: "PERCENT",
  lineSpacingValue: 180,
  firstLineIndent: 10,
  paragraphSpacingBefore: 0,
  paragraphSpacingAfter: 0,
  textAlign: "JUSTIFY",
  workTitleStyle: heading(22, "CENTER", 0, 24, false),
  volumeTitleStyle: heading(18, "CENTER", 20, 16, true),
  chapterTitleStyle: heading(15, "LEFT", 18, 12, true),
  sceneTitleStyle: heading(12, "LEFT", 12, 8, false),
  includeTitlePage: true,
  includeWorkTitle: true,
  includeVolumeTitles: true,
  includeChapterTitles: true,
  includeSceneTitles: false,
  sectionSplitMode: "SINGLE",
  includePageNumber: true,
  pageNumberStart: 1,
  pageNumberPosition: "BOTTOM_CENTER",
  includeHeader: false,
  headerText: "",
  includeFooter: false,
  footerText: "",
  sceneBreakToken: "ORNAMENT"
});

const general = baseConfig();
const readable: HwpxExportPresetConfig = {
  ...baseConfig(),
  marginTop: 30,
  marginBottom: 30,
  marginLeft: 30,
  marginRight: 30,
  fontSizePt: 11,
  lineSpacingValue: 200,
  paragraphSpacingAfter: 4,
  includeSceneTitles: true
};
const compact: HwpxExportPresetConfig = {
  ...baseConfig(),
  marginTop: 18,
  marginBottom: 18,
  marginLeft: 18,
  marginRight: 18,
  headerMargin: 10,
  footerMargin: 10,
  fontSizePt: 9,
  lineSpacingValue: 150,
  firstLineIndent: 9,
  workTitleStyle: heading(20, "CENTER", 0, 18, false),
  volumeTitleStyle: heading(16, "CENTER", 14, 10, true),
  chapterTitleStyle: heading(13, "LEFT", 12, 8, true),
  sceneTitleStyle: heading(11, "LEFT", 8, 6, false)
};

export const BUILT_IN_HWPX_PRESETS: readonly BuiltInHwpxPreset[] = [
  {
    id: "GENERAL_SUBMISSION",
    name: "범용 출판사 제출본",
    description:
      "출판사의 별도 양식이 없을 때 사용하는 편집 가능한 A4 예시입니다. 실제 제출 전 출판사의 요구사항을 확인하세요.",
    config: general
  },
  {
    id: "READABILITY_REVIEW",
    name: "가독성 중심 검토본",
    description:
      "넉넉한 줄간격과 여백, 페이지 번호, 장·화 구분을 사용하는 검토용 예시입니다.",
    config: readable
  },
  {
    id: "COMPACT_REVIEW",
    name: "압축 검토본",
    description:
      "상대적으로 작은 글자와 좁은 여백을 사용하는 페이지 절약형 검토 예시입니다.",
    config: compact
  }
];
