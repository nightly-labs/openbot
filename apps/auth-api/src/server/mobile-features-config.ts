import type { MobileFeatureConfig } from "@openbot/contracts/mobile-features";

/**
 * The last app version of each platform that has each mobile feature, such as "1.2.0". Versions up
 * to it have the feature; newer versions do not. "0" turns the feature off for every version.
 * Change it with a Worker deploy.
 */
export const MOBILE_FEATURE_CONFIG: MobileFeatureConfig = {
  cloudServers: { ios: "0", android: "1.2.0" },
  browser: { ios: "1.2.0", android: "1.2.0" },
};
