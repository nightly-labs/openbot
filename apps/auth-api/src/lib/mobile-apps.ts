import type { MobilePlatformLogoVariant } from "@openbot/brand";
import { ANDROID_PLAY_STORE_URL } from "@openbot/ui/features/mobile-app/android-play-store";
import { IOS_APP_STORE_URL } from "@openbot/ui/features/mobile-app/ios-app-store";
import type { PlatformNavigator } from "./download-platforms";

export type MobilePlatform = MobilePlatformLogoVariant;

export interface MobileAppDetails {
  action: string;
  description: string;
  href: string;
  id: MobilePlatform;
  label: string;
  status: "Available";
}

/** The phone apps on the landing cards. They open a store page, so the links leave the site. */
export const MOBILE_APPS: Record<MobilePlatform, MobileAppDetails> = {
  ios: {
    id: "ios",
    label: "iPhone",
    status: "Available",
    description: "App Store · Connects to your computer",
    action: "Download on the App Store",
    href: IOS_APP_STORE_URL,
  },
  android: {
    id: "android",
    label: "Android",
    status: "Available",
    description: "Google Play · Connects to your computer",
    action: "Get it on Google Play",
    href: ANDROID_PLAY_STORE_URL,
  },
};

export const MOBILE_APP_ORDER: readonly MobilePlatform[] = ["ios", "android"];

/**
 * The phone app for a visitor on a phone. Android reports Linux and an iPhone reports "like Mac OS X",
 * so check this before the desktop detection. An iPad in desktop mode reports a Mac and stays one.
 */
export function detectMobilePlatform(source: PlatformNavigator): MobilePlatform | undefined {
  const platform =
    `${source.userAgentData?.platform ?? ""} ${source.platform ?? ""} ${source.userAgent ?? ""}`.toLowerCase();

  if (/iphone|ipad|ipod/.test(platform)) return "ios";
  if (/android/.test(platform)) return "android";
  return undefined;
}
