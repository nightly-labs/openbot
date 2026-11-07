import {
  type AppAppearancePreference,
  DEFAULT_APP_APPEARANCE,
  DEFAULT_TRANSPARENT_WINDOW,
  selectedThemePalette,
} from "@openbot/contracts/app-appearance";
import { type BrowserWindow, nativeTheme } from "electron";

/** The light canvas, `--openbot-bg-canvas` in `tokens-light.css`, so a light window opens without a dark frame. */
const LIGHT_WINDOW_BACKGROUND = "#f5f5f6";

/** The macOS material behind a transparent main window. The page paints its own tint over it. */
const GLASS_VIBRANCY = "under-window";

let current: AppAppearancePreference = {
  appearance: DEFAULT_APP_APPEARANCE,
  transparentWindow: DEFAULT_TRANSPARENT_WINDOW,
  palette: null,
  palettes: [],
  chatBackgroundLight: null,
  chatBackgroundDark: null,
};
const listeners = new Set<() => void>();

/**
 * Sets the appearance that window backgrounds follow. While the window is opaque, main leaves
 * `nativeTheme.themeSource` on the system: visited websites and the native menus follow the computer.
 * The blur behind a transparent window takes its light or dark shade from `themeSource`, so while the
 * window is transparent, `themeSource` follows the appearance, or the scheme of the selected theme
 * palette, and websites and menus follow it too.
 * Main reports `transparentWindow` as `false` where the window cannot blur.
 */
export function setWindowAppearance(preference: AppAppearancePreference): void {
  current = { ...preference };
  const appearance = selectedThemePalette(preference)?.scheme ?? preference.appearance;
  nativeTheme.themeSource = preference.transparentWindow ? appearance : "system";
  for (const listener of listeners) listener();
}

/**
 * The background a window shows before its page paints, and around it while it resizes. A theme
 * palette gives its own canvas, without its alpha: Electron reads eight hex digits as `#aarrggbb`,
 * and the window under the page is opaque.
 */
export function windowBackgroundColor(darkColor: string): string {
  const palette = selectedThemePalette(current);
  if (palette !== null) return palette.colors.canvas.slice(0, 7);
  const dark = current.appearance === "system" ? nativeTheme.shouldUseDarkColors : current.appearance === "dark";
  return dark ? darkColor : LIGHT_WINDOW_BACKGROUND;
}

/** Keeps an opaque window's background on the current appearance until the window closes. */
export function followAppearance(window: BrowserWindow, darkColor: string): void {
  const update = () => {
    if (!window.isDestroyed()) window.setBackgroundColor(windowBackgroundColor(darkColor));
  };
  follow(window, update);
}

/** Sets the saved transparent window choice before the first window is built, so it is built with the blur. */
export function setInitialWindowGlass(transparentWindow: boolean): void {
  current = { ...current, transparentWindow };
}

/**
 * The constructor options of a window that `followWindowGlass` follows. Electron makes a macOS window
 * translucent only when it is built with vibrancy. A window that gets its vibrancy later stays opaque
 * to the compositor, which then draws the translucent page over what it drew before: on macOS 26 and
 * later the previous chat shows through and the window flickers. A window built with vibrancy and no
 * background color gets a clear background from Electron.
 */
export function glassWindowOptions(
  darkColor: string,
): { vibrancy: typeof GLASS_VIBRANCY } | { backgroundColor: string } {
  return current.transparentWindow
    ? { vibrancy: GLASS_VIBRANCY }
    : { backgroundColor: windowBackgroundColor(darkColor) };
}

/**
 * Keeps the main window opaque or transparent, as the preference says, until the window closes. A
 * transparent window shows the macOS blur; the page then paints a translucent tint over it. The
 * blur keeps Electron's default `visualEffectState`, `followWindow`, so an inactive window stops the
 * live blur. Main applies the saved preference before the window shows.
 */
export function followWindowGlass(window: BrowserWindow, darkColor: string): void {
  // The window is built with `glassWindowOptions`, so it has the blur when the preference is on. A
  // window built opaque takes the blur here when the preference turns on later.
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
