/**
 * The color scheme the user picks for the desktop app: follow the system, or always light or dark.
 * The main process holds it, and each OpenBot window applies it. Visited websites and the native
 * menus follow the computer, as they did before the choice existed, unless the window is transparent.
 *
 * The identifiers cross the IPC boundary and are saved as written. Add one, never rename one: a
 * renamed identifier reads back as the default on the next launch. The order is the Settings order.
 */
export const APP_APPEARANCES = ["system", "light", "dark"] as const;

export type AppAppearance = (typeof APP_APPEARANCES)[number];

/** Dark: OpenBot was dark only before this choice existed, so an update does not change the look. */
export const DEFAULT_APP_APPEARANCE: AppAppearance = "dark";

/** Off: a see-through window is a choice, and only macOS can blur what is behind it. */
export const DEFAULT_TRANSPARENT_WINDOW = false;

/** The preference as it is stored and as it crosses IPC. */
export interface AppAppearancePreference {
  appearance: AppAppearance;
  /**
   * The main window shows the blurred desktop behind it (macOS vibrancy). Main reports `false` on
   * other platforms. While it is on, main sets `nativeTheme.themeSource` to the appearance, because the
   * blur takes its light or dark shade from it: then visited websites and native menus follow the
   * appearance too.
   */
  transparentWindow: boolean;
}

/** One field or both. Each Settings control sends only its own, so two quick changes do not undo each other. */
export type SetAppAppearancePreferenceInput = Partial<AppAppearancePreference>;

export function isAppAppearance(value: unknown): value is AppAppearance {
  return APP_APPEARANCES.some((appearance) => appearance === value);
}
