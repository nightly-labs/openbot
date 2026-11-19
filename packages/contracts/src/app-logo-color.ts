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

export const DEFAULT_APP_LOGO_COLOR: AppLogoColor = "lavender";

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

export const DEFAULT_APP_LOGO_EYE_HEX = "#040007";

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

export interface AppLogoColorPreference {
  color: AppLogoColor;
}

export type SetAppLogoColorPreferenceInput = AppLogoColorPreference;

export function isAppLogoColor(value: unknown): value is AppLogoColor {
  return APP_LOGO_COLORS.some((color) => color === value);
}
