import {
  type AppAppearancePreference,
  DEFAULT_APP_APPEARANCE,
  DEFAULT_TRANSPARENT_WINDOW,
  selectedThemePalette,
} from "@openbot/contracts/app-appearance";
import { type BrowserWindow, nativeTheme } from "electron";

const LIGHT_WINDOW_BACKGROUND = "#f5f5f6";

const GLASS_VIBRANCY = "under-window";

let current: AppAppearancePreference = {
  appearance: DEFAULT_APP_APPEARANCE,
  transparentWindow: DEFAULT_TRANSPARENT_WINDOW,
  palette: null,
  palettes: [],
  chatBackgroundLight: null,
  chatBackgroundDark: null,
  interfaceFont: null,
  codeFont: null,
};
const listeners = new Set<() => void>();

export function setWindowAppearance(preference: AppAppearancePreference): void {
  current = { ...preference };
  const appearance = selectedThemePalette(preference)?.scheme ?? preference.appearance;
  nativeTheme.themeSource = preference.transparentWindow ? appearance : "system";
  for (const listener of listeners) listener();
}

export function windowBackgroundColor(darkColor: string): string {
  const palette = selectedThemePalette(current);
  if (palette !== null) return palette.colors.canvas.slice(0, 7);
  const dark = current.appearance === "system" ? nativeTheme.shouldUseDarkColors : current.appearance === "dark";
  return dark ? darkColor : LIGHT_WINDOW_BACKGROUND;
}

export function followAppearance(window: BrowserWindow, darkColor: string): void {
  const update = () => {
    if (!window.isDestroyed()) window.setBackgroundColor(windowBackgroundColor(darkColor));
  };
  follow(window, update);
}

export function setInitialWindowGlass(transparentWindow: boolean): void {
  current = { ...current, transparentWindow };
}

export function glassWindowOptions(
  darkColor: string,
): { vibrancy: typeof GLASS_VIBRANCY } | { backgroundColor: string } {
  return current.transparentWindow
    ? { vibrancy: GLASS_VIBRANCY }
    : { backgroundColor: windowBackgroundColor(darkColor) };
}

export function followWindowGlass(window: BrowserWindow, darkColor: string): void {
  let glass = current.transparentWindow;
  const update = () => {
    if (window.isDestroyed()) return;
    if (current.transparentWindow !== glass) {
      glass = current.transparentWindow;
      window.setVibrancy(glass ? GLASS_VIBRANCY : null);
    }
    window.setBackgroundColor(glass ? "#00000000" : windowBackgroundColor(darkColor));
  };
  update();
  follow(window, update);
}

function follow(window: BrowserWindow, update: () => void): void {
  nativeTheme.on("updated", update);
  listeners.add(update);
  window.once("closed", () => {
    nativeTheme.off("updated", update);
    listeners.delete(update);
  });
}
