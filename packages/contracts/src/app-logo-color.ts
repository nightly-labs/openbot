/**
 * The color the user picks for the OpenBot logo: the Dock or taskbar icon, the Dynamic Island and
 * the logos in the app. Only a release build shows it. A dev or preview build keeps its own color,
 * so two OpenBot apps that are open at the same time stay easy to tell apart.
 *
 * The identifiers cross the IPC boundary and are saved as written. Add a color, never rename one:
 * a renamed identifier reads back as the default on the next launch. The order is the Settings
 * order: the first row goes around the color wheel, and the second ends with the neutral colors.
 */
export const APP_LOGO_COLORS = [
  "rose",
  "terracotta",
  "gold",
  "green",
  "blue",
  "lavender",
  "pink",
  "beige",
  "gray",
  "white",
] as const;

export type AppLogoColor = (typeof APP_LOGO_COLORS)[number];

/** The released brand color, `--openbot-logo-production`. */
export const DEFAULT_APP_LOGO_COLOR: AppLogoColor = "lavender";

/**
 * The logo body color of each choice. The main process recolors the app icon with it, and the
 * renderers set `--openbot-logo-production` to it, so the icon and the logos show the same color.
 */
export const APP_LOGO_COLOR_HEX = {
  lavender: "#d6adf2",
  green: "#7cc68a",
  gold: "#dcba70",
  terracotta: "#cb9071",
  blue: "#84adde",
  rose: "#d99293",
  pink: "#dba3bd",
  beige: "#edcec3",
  gray: "#b4b4b4",
  white: "#fefdff",
} as const satisfies Record<AppLogoColor, `#${string}`>;

/** The released eye color, `--openbot-logo-eye`. */
export const DEFAULT_APP_LOGO_EYE_HEX = "#040007";

/** The eye color of each choice. Every choice has a light body, so each one keeps the released eyes. */
export const APP_LOGO_EYE_HEX = {
  lavender: DEFAULT_APP_LOGO_EYE_HEX,
  green: DEFAULT_APP_LOGO_EYE_HEX,
  gold: DEFAULT_APP_LOGO_EYE_HEX,
  terracotta: DEFAULT_APP_LOGO_EYE_HEX,
  blue: DEFAULT_APP_LOGO_EYE_HEX,
  rose: DEFAULT_APP_LOGO_EYE_HEX,
  pink: DEFAULT_APP_LOGO_EYE_HEX,
  beige: DEFAULT_APP_LOGO_EYE_HEX,
  gray: DEFAULT_APP_LOGO_EYE_HEX,
  white: DEFAULT_APP_LOGO_EYE_HEX,
} as const satisfies Record<AppLogoColor, `#${string}`>;

/** The preference as it is stored and as it crosses IPC. */
export interface AppLogoColorPreference {
  color: AppLogoColor;
}

export type SetAppLogoColorPreferenceInput = AppLogoColorPreference;

export function isAppLogoColor(value: unknown): value is AppLogoColor {
  return APP_LOGO_COLORS.some((color) => color === value);
}
