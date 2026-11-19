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
  getIcon(): Promise<string | null>;
  setIcon(id: string): Promise<void>;
}

const native = requireOptionalNativeModule<AppIconModule>("OpenBotAppIcon");

const MAIN_ICON = "default";

export const APP_ICONS: readonly AppLogoColor[] = APP_LOGO_COLORS;

export interface AppIconLook {
  body: string;
  eyes: string;
}

export function appIconLook(color: AppLogoColor): AppIconLook {
  return { body: APP_LOGO_COLOR_HEX[color], eyes: APP_LOGO_EYE_HEX[color] };
}

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

export const useAppIcon = create<{ value: AppLogoColor | null; ready: boolean; saving: boolean }>(() => ({
  value: null,
  ready: false,
  saving: false,
}));

let loading: Promise<void> | null = null;

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
