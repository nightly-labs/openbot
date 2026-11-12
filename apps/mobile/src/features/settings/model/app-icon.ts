import {
  APP_LOGO_COLOR_HEX,
  APP_LOGO_COLORS,
  APP_LOGO_EYE_HEX,
  type AppLogoColor,
  DEFAULT_APP_LOGO_COLOR,
  isAppLogoColor,
} from "@openbot/contracts/app-logo-color";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { type NativeModule, requireOptionalNativeModule } from "expo";
import { create } from "zustand";

declare class AppIconModule extends NativeModule {
  /** `default` for the main icon, or null when the phone cannot change the icon. */
  getIcon(): Promise<string | null>;
  setIcon(id: string): Promise<void>;
}

/** `modules/app-icon`. A build without it, such as Expo Go or an older binary, hides the picker. */
const native = requireOptionalNativeModule<AppIconModule>("OpenBotAppIcon");

/** The native ID of the main icon. `plugins/with-app-icons.js` names the other icons after their color. */
const MAIN_ICON = "default";

/** The icons are the logo colors of the desktop app, in the order of its picker. */
export const APP_ICONS: readonly AppLogoColor[] = APP_LOGO_COLORS;

export interface AppIconLook {
  body: string;
  eyes: string;
}

/**
 * The colors of an icon in its default look. The previews always show it: the home screen look (Light,
 * Dark, Clear or Tinted on iOS) is a separate setting from the app and system appearance, and an app
 * cannot read it.
 */
export function appIconLook(color: AppLogoColor): AppIconLook {
  return { body: APP_LOGO_COLOR_HEX[color], eyes: APP_LOGO_EYE_HEX[color] };
}

/** The names of the desktop logo colors, in the mobile catalog. */
export const APP_ICON_LABELS = {
  rose: "mobile.settings.appIcon.color.rose",
  terracotta: "mobile.settings.appIcon.color.terracotta",
  gold: "mobile.settings.appIcon.color.gold",
  green: "mobile.settings.appIcon.color.green",
  blue: "mobile.settings.appIcon.color.blue",
  lavender: "mobile.settings.appIcon.color.lavender",
  pink: "mobile.settings.appIcon.color.pink",
  beige: "mobile.settings.appIcon.color.beige",
  gray: "mobile.settings.appIcon.color.gray",
  white: "mobile.settings.appIcon.color.white",
} as const satisfies Record<AppLogoColor, MobileTextKey>;

/** The phone keeps the icon, so the app does not save it. `value` is null when the icon cannot change. */
export const useAppIcon = create<{ value: AppLogoColor | null; ready: boolean; saving: boolean }>(() => ({
  value: null,
  ready: false,
  saving: false,
}));

let loading: Promise<void> | null = null;

/** Reads the icon once. The Appearance row and the picker share the read. */
export function loadAppIcon(): Promise<void> {
  if (useAppIcon.getState().ready) return Promise.resolve();
  loading ??= readAppIcon().finally(() => {
    loading = null;
  });
  return loading;
}

async function readAppIcon(): Promise<void> {
  if (!native) {
    useAppIcon.setState({ ready: true });
    return;
  }
  try {
    const id = await native.getIcon();
    const value = id === MAIN_ICON ? DEFAULT_APP_LOGO_COLOR : isAppLogoColor(id) ? id : null;
    useAppIcon.setState({ value });
  } finally {
    useAppIcon.setState({ ready: true });
  }
}

export async function saveAppIcon(color: AppLogoColor): Promise<void> {
  const { value, saving } = useAppIcon.getState();
  if (!native || saving || value === color) return;
  useAppIcon.setState({ value: color, saving: true });
  try {
    await native.setIcon(color === DEFAULT_APP_LOGO_COLOR ? MAIN_ICON : color);
  } catch (error) {
    useAppIcon.setState({ value });
    throw error;
  } finally {
    useAppIcon.setState({ saving: false });
  }
}
