import type { MobileFeatureConfig, MobileLatestVersions } from "@openbot/contracts/mobile-features";

/**
 * The app versions of each platform that have each mobile feature. `upTo` is the last version that
 * has the feature, such as "1.2.0": newer versions do not have it, and "0" turns it off for every
 * version. `except` lists the versions up to `upTo` that do not have it, such as ["1.3.0"].
 * Change it with a Worker deploy.
 */
export const MOBILE_FEATURE_CONFIG: MobileFeatureConfig = {
  cloudServers: {
    ios: { upTo: "1.4.3" },
    android: { upTo: "1.4.2" },
  },
  browser: {
    ios: { upTo: "1.4.3" },
    android: { upTo: "1.4.2" },
  },
};

/**
 * The newest app version that each store offers. An older app shows an update header on home. Set
 * it when the store makes the version available, as the feature versions above. Change it with a
 * Worker deploy.
 */
export const MOBILE_LATEST_VERSIONS: MobileLatestVersions = {
  ios: "1.4.3",
  android: "1.4.2",
};
