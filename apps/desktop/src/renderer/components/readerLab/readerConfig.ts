import type {
  ReaderFontToken,
  ReaderPaneOverrides,
  ReaderRenderConfig,
  ReaderTheme
} from "../../../shared/publication";
import {
  READER_LIMITS,
  validateReaderRenderConfig
} from "../../../shared/readerConfigValidation";

export const READER_FONT_STACKS: Readonly<Record<ReaderFontToken, string>> = {
  SYSTEM_SANS: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  SYSTEM_SERIF: 'Georgia, "Times New Roman", serif',
  KOREAN_SANS: '"Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif',
  KOREAN_SERIF: 'Batang, "AppleMyungjo", Georgia, serif'
};

export function applyReaderOverrides(
  base: ReaderRenderConfig,
  overrides: ReaderPaneOverrides
): ReaderRenderConfig {
  const combined: ReaderRenderConfig = {
    ...base,
    device: {
      ...base.device,
      ...(overrides.deviceCategory ? { category: overrides.deviceCategory } : {}),
      ...(overrides.viewportWidth !== undefined ? { viewportWidth: overrides.viewportWidth } : {}),
      ...(overrides.viewportHeight !== undefined ? { viewportHeight: overrides.viewportHeight } : {})
    },
    settings: {
      ...base.settings,
      ...(overrides.readerSettings ?? {})
    },
    workStyle: {
      ...base.workStyle,
      ...(overrides.sceneBreakStyleToken
        ? { sceneBreakStyleToken: overrides.sceneBreakStyleToken }
        : {})
    }
  };
  const minimumViewportHeight =
    combined.device.readerChromeHeight +
    combined.device.safeAreaTop +
    combined.device.safeAreaBottom +
    1;
  const repairedDevice = {
    ...combined.device,
    viewportHeight: Math.max(
      combined.device.viewportHeight,
      minimumViewportHeight
    )
  };
  const effectiveViewportHeight = Math.max(
    1,
    repairedDevice.viewportHeight -
      repairedDevice.readerChromeHeight -
      repairedDevice.safeAreaTop -
      repairedDevice.safeAreaBottom
  );
  const config: ReaderRenderConfig = {
    ...combined,
    device: repairedDevice,
    settings: {
      ...combined.settings,
      horizontalPadding: Math.min(
        combined.settings.horizontalPadding,
        Math.max(0, Math.floor((combined.device.viewportWidth - 1) / 2))
      ),
      verticalPadding: Math.min(
        combined.settings.verticalPadding,
        Math.max(0, Math.floor((effectiveViewportHeight - 1) / 2))
      )
    }
  };
  return validateReaderRenderConfig(config);
}

export function defaultThemeColors(theme: ReaderTheme): {
  readonly backgroundColor: string;
  readonly textColor: string;
} {
  switch (theme) {
    case "DARK":
      return { backgroundColor: "#191a1d", textColor: "#e7e4de" };
    case "SEPIA":
      return { backgroundColor: "#f1e7d1", textColor: "#3b3024" };
    case "LIGHT":
    case "CUSTOM":
      return { backgroundColor: "#fffdf8", textColor: "#26231f" };
  }
}

export function normalizeZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(READER_LIMITS.zoom.max, Math.max(READER_LIMITS.zoom.min, value));
}
