import {
  type AppAppearancePreference,
  DEFAULT_APP_APPEARANCE,
  DEFAULT_TRANSPARENT_WINDOW,
} from "@openbot/contracts/app-appearance";
import { type BrowserWindow, nativeTheme } from "electron";

/** The light canvas, `--openbot-bg-canvas` in `tokens-light.css`, so a light window opens without a dark frame. */
const LIGHT_WINDOW_BACKGROUND = "#f5f5f6";

/** The macOS material behind a transparent main window. The page paints its own tint over it. */
const GLASS_VIBRANCY = "under-window";

let current: AppAppearancePreference = {
  appearance: DEFAULT_APP_APPEARANCE,
  transparentWindow: DEFAULT_TRANSPARENT_WINDOW,
};
const listeners = new Set<() => void>();

/**
 * Sets the appearance that window backgrounds follow. While the window is opaque, main leaves
 * `nativeTheme.themeSource` on the system: visited websites and the native menus follow the computer.
 * The blur behind a transparent window takes its light or dark shade from `themeSource`, so while the
 * window is transparent, `themeSource` follows the appearance, and websites and menus follow it too.
 * Main reports `transparentWindow` as `false` where the window cannot blur.
 */
export function setWindowAppearance(preference: AppAppearancePreference): void {
  current = { ...preference };
  nativeTheme.themeSource = preference.transparentWindow ? preference.appearance : "system";
  for (const listener of listeners) listener();
}

/** The background a window shows before its page paints, and around it while it resizes. */
export function windowBackgroundColor(darkColor: string): string {
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

/**
 * Keeps the main window opaque or transparent, as the preference says, until the window closes. A
 * transparent window shows the macOS blur; the page then paints a translucent tint over it. The
 * blur keeps Electron's default `visualEffectState`, `followWindow`, so an inactive window stops the
 * live blur. Main applies the saved preference before the window shows.
 */
export function followWindowGlass(window: BrowserWindow, darkColor: string): void {
  // The window is built opaque. A window opened again while the preference is on takes the blur here.
  let glass = false;
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
