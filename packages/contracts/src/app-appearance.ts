import { isDynamicRecord } from "./runtime-values";

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

/**
 * The colors that a theme palette file gives. Each is a `#rrggbb` or `#rrggbbaa` hex color. The
 * renderer makes the other tokens from them, over the light or dark palette that `scheme` names.
 *
 * The keys are the file format that other programs write, such as the Omarchy theme template. Add a
 * key only as optional, and never rename one: a file that an older template wrote must still read.
 */
export const APP_THEME_PALETTE_COLORS = [
  "canvas",
  "frame",
  "sidebar",
  "surface",
  "text",
  "textMuted",
  "border",
  "accent",
  "accentForeground",
  "success",
  "warning",
  "danger",
] as const;

export type AppThemePaletteColor = (typeof APP_THEME_PALETTE_COLORS)[number];

/** The file name stem of a theme palette file, which is also its saved identifier. */
export const APP_THEME_PALETTE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

/** `#rrggbb` or `#rrggbbaa`. Nothing else reaches a CSS property. */
export const APP_THEME_PALETTE_COLOR_PATTERN = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/u;

/**
 * A palette that another program gives in `<userData>/themes/<id>.json`, such as the Omarchy theme.
 * While it is selected, it replaces the light, dark or system choice, and it follows each change to
 * the file.
 */
export interface AppThemePalette {
  id: string;
  /** The name that the file gives, such as "Omarchy". It is data, as an agent name is. */
  name: string;
  scheme: "light" | "dark";
  colors: Record<AppThemePaletteColor, string>;
}

/** The preference as it is stored and as it crosses IPC. */
export interface AppAppearancePreference {
  appearance: AppAppearance;
  /**
   * The selected theme palette, or null. Main reports an id only while that palette file is
   * present and valid; it keeps the saved id, so the palette comes back when the file does.
   */
  palette: string | null;
  /** Every valid palette file, by id. Empty on most computers. */
  palettes: AppThemePalette[];
  /**
   * The main window shows the blurred desktop behind it (macOS vibrancy). Main reports `false` on
   * other platforms. While it is on, main sets `nativeTheme.themeSource` to the appearance, because the
   * blur takes its light or dark shade from it: then visited websites and native menus follow the
   * appearance too.
   */
  transparentWindow: boolean;
}

/**
 * One field or more. Each Settings control sends only its own, so two quick changes do not undo each
 * other. The theme control sends `palette: null` with a light, dark or system choice.
 */
export type SetAppAppearancePreferenceInput = Partial<
  Pick<AppAppearancePreference, "appearance" | "transparentWindow" | "palette">
>;

export function isAppAppearance(value: unknown): value is AppAppearance {
  return APP_APPEARANCES.some((appearance) => appearance === value);
}

export function isAppThemePaletteId(value: unknown): value is string {
  return typeof value === "string" && APP_THEME_PALETTE_ID_PATTERN.test(value);
}

/** A palette with a valid id, a light or dark scheme, a name, and a hex value for every color. */
export function isAppThemePalette(value: unknown): value is AppThemePalette {
  if (!isDynamicRecord(value)) return false;
  const { id, name, scheme, colors } = value;
  if (!isAppThemePaletteId(id) || typeof name !== "string" || (scheme !== "light" && scheme !== "dark")) return false;
  if (!isDynamicRecord(colors)) return false;
  return APP_THEME_PALETTE_COLORS.every((key) => {
    const color = colors[key];
    return typeof color === "string" && APP_THEME_PALETTE_COLOR_PATTERN.test(color);
  });
}

/** Two palette lists with the same palettes, colors and order. */
export function sameThemePalettes(left: readonly AppThemePalette[], right: readonly AppThemePalette[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** The palette that the windows show, or null for the light, dark or system choice. */
export function selectedThemePalette(preference: AppAppearancePreference): AppThemePalette | null {
  if (preference.palette === null) return null;
  return preference.palettes.find((palette) => palette.id === preference.palette) ?? null;
}
