import {
  type AppAppearancePreference,
  DEFAULT_APP_APPEARANCE,
  DEFAULT_TRANSPARENT_WINDOW,
  selectedThemePalette,
} from "@openbot/contracts/app-appearance";
import { type BrowserWindow, nativeTheme, type TitleBarOverlay } from "electron";

const LIGHT_WINDOW_BACKGROUND = "#f5f5f6";

const GLASS_VIBRANCY = "under-window";

const TOP_ROW_HEIGHT = 38;

const TITLE_BAR_COLORS = {
  frame: { dark: "#0d0d0d", light: "#e8e8eb" },
  canvas: { dark: "#1a1a1a", light: "#f5f5f6" },
} as const;

const TITLE_BAR_SYMBOL_COLORS = { dark: "#ffffff", light: "#141414" } as const;

export type TitleBarSurface = keyof typeof TITLE_BAR_COLORS;

const titleBarSurfaces = new WeakMap<BrowserWindow, TitleBarSurface>();

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

function darkAppearance(): boolean {
  return current.appearance === "system" ? nativeTheme.shouldUseDarkColors : current.appearance === "dark";
}

export function windowBackgroundColor(darkColor: string): string {
  const palette = selectedThemePalette(current);
  if (palette !== null) return palette.colors.canvas.slice(0, 7);
  return darkAppearance() ? darkColor : LIGHT_WINDOW_BACKGROUND;
}

export function titleBarOverlay(surface: TitleBarSurface, zoomFactor: number): TitleBarOverlay {
  const palette = selectedThemePalette(current);
  const scheme = palette?.scheme ?? (darkAppearance() ? "dark" : "light");
  return {
    color: palette ? palette.colors[surface].slice(0, 7) : TITLE_BAR_COLORS[surface][scheme],
    symbolColor: palette ? palette.colors.text.slice(0, 7) : TITLE_BAR_SYMBOL_COLORS[scheme],
    height: Math.round(TOP_ROW_HEIGHT * zoomFactor),
  };
}

export function followTitleBarOverlay(window: BrowserWindow, surface: TitleBarSurface): void {
  if (process.platform !== "win32") return;
  titleBarSurfaces.set(window, surface);
  follow(window, () => fitTitleBarOverlay(window));
}

export function fitTitleBarOverlay(window: BrowserWindow): void {
  const surface = titleBarSurfaces.get(window);
  if (surface === undefined || window.isDestroyed()) return;
  window.setTitleBarOverlay(titleBarOverlay(surface, window.webContents.getZoomFactor()));
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
