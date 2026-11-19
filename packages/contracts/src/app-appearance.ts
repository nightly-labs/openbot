import { type AvatarColor, isAvatarColor } from "./ipc-agent-identity";
import { isDynamicRecord } from "./runtime-values";

export const APP_APPEARANCES = ["system", "light", "dark"] as const;

export type AppAppearance = (typeof APP_APPEARANCES)[number];

export const DEFAULT_APP_APPEARANCE: AppAppearance = "dark";

export const DEFAULT_TRANSPARENT_WINDOW = false;

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

export type ChatBackgroundColor = AvatarColor;

export const isChatBackgroundColor: (value: unknown) => value is ChatBackgroundColor = isAvatarColor;

export type AppFontFamily = string;

export const APP_FONT_FAMILY_PATTERN = /^[^\p{Cc}"\\;{}<>]{1,128}$/u;

export function isAppFontFamily(value: unknown): value is AppFontFamily {
  return typeof value === "string" && value.trim() === value && APP_FONT_FAMILY_PATTERN.test(value);
}

export const APP_THEME_PALETTE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

export const APP_THEME_PALETTE_COLOR_PATTERN = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/u;

export interface AppThemePalette {
  id: string;
  name: string;
  scheme: "light" | "dark";
  colors: Record<AppThemePaletteColor, string>;
}

export interface AppAppearancePreference {
  appearance: AppAppearance;
  palette: string | null;
  palettes: AppThemePalette[];
  transparentWindow: boolean;
  chatBackgroundLight: ChatBackgroundColor | null;
  chatBackgroundDark: ChatBackgroundColor | null;
  interfaceFont: AppFontFamily | null;
  codeFont: AppFontFamily | null;
}

export type SetAppAppearancePreferenceInput = Partial<
  Pick<
    AppAppearancePreference,
    | "appearance"
    | "transparentWindow"
    | "palette"
    | "chatBackgroundLight"
    | "chatBackgroundDark"
    | "interfaceFont"
    | "codeFont"
  >
>;

export function isAppAppearance(value: unknown): value is AppAppearance {
  return APP_APPEARANCES.some((appearance) => appearance === value);
}

export function isAppThemePaletteId(value: unknown): value is string {
  return typeof value === "string" && APP_THEME_PALETTE_ID_PATTERN.test(value);
}

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

export function sameThemePalettes(left: readonly AppThemePalette[], right: readonly AppThemePalette[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function selectedThemePalette(preference: AppAppearancePreference): AppThemePalette | null {
  if (preference.palette === null) return null;
  return preference.palettes.find((palette) => palette.id === preference.palette) ?? null;
}
