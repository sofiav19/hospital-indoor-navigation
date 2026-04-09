import { useNavStore, type TextSizePreset } from '../store/navStore';

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
