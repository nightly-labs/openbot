import type { MobilePlatformLogoVariant } from "@openbot/brand";
import { ANDROID_PLAY_STORE_URL } from "@openbot/ui/features/mobile-app/android-play-store";
import { IOS_TESTFLIGHT_URL } from "@openbot/ui/features/mobile-app/ios-testflight";

export type MobilePlatform = MobilePlatformLogoVariant;

export interface MobileAppDetails {
  action: string;
  description: string;
  href: string;
  id: MobilePlatform;
  label: string;
  status: "Available" | "Beta";
}

/** The phone apps on the landing cards. They open a store page, so the links leave the site. */
export const MOBILE_APPS: Record<MobilePlatform, MobileAppDetails> = {
  ios: {
    id: "ios",
    label: "iPhone",
    status: "Beta",
    description: "TestFlight beta · Connects to your computer",
    action: "Join the TestFlight beta",
    href: IOS_TESTFLIGHT_URL,
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
