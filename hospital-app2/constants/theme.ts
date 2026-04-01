/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';
import { useNavStore, type TextSizePreset } from '../store/navStore';

const tintColorLight = '#0a7ea4';
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};

export const AppPalette = {
  primary: "#3F9BB0",
  background: "#FFFFFF",
  lists: "rgba(63, 155, 176, 0.10)",
  lines: "rgba(63, 155, 176, 0.60)",
  textSectionTitles: "#136B7F",
  textPrimary: "#1D1B20",
  surfaceAlt: "#EEF6F8",
};

export const HighContrastPalette = {
  primary: "#0B5F73",
  background: "#FFFFFF",
  lists: "#D7EEF4",
  lines: "#0B5F73",
  textSectionTitles: "#073D49",
  textPrimary: "#000000",
  surfaceAlt: "#F3FAFC",
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});

const TEXT_SIZE_SCALE: Record<TextSizePreset, number> = {
  small: 0.92,
  medium: 1,
  large: 1.16,
};

export function getAppPalette(highContrastEnabled: boolean) {
  return highContrastEnabled ? HighContrastPalette : AppPalette;
}

export function scaleFontSize(size: number, textSize: TextSizePreset) {
  return Math.round(size * TEXT_SIZE_SCALE[textSize]);
}

export function scaleLineHeight(size: number, textSize: TextSizePreset) {
  return Math.round(size * TEXT_SIZE_SCALE[textSize]);
}

export function useAppAppearance() {
  const textSize = useNavStore((s) => s.navigationUi.textSize);
  const highContrastEnabled = useNavStore((s) => s.navigationUi.highContrastEnabled);
  const palette = getAppPalette(highContrastEnabled);

  return {
    textSize,
    highContrastEnabled,
    palette,
    scaleFont: (size: number) => scaleFontSize(size, textSize),
    scaleLineHeight: (size: number) => scaleLineHeight(size, textSize),
  };
}
