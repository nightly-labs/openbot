import type { MobileFeatureConfig, MobileLatestVersions } from "@openbot/contracts/mobile-features";

export const MOBILE_FEATURE_CONFIG: MobileFeatureConfig = {
  cloudServers: {
    ios: { upTo: "1.4.10" },
    android: { upTo: "1.4.11" },
  },
  browser: {
    ios: { upTo: "1.4.10" },
    android: { upTo: "1.4.11" },
  },
};

export const MOBILE_LATEST_VERSIONS: MobileLatestVersions = {
  ios: "1.4.10",
  android: "1.4.11",
};

export const ANDROID_APK_FIRST_VERSION: string | null = "1.4.11";
