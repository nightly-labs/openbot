import type { MobileFeatureConfig } from "@openbot/contracts/mobile-features";

/**
 * The app versions of each platform that have each mobile feature. `upTo` is the last version that
 * has the feature, such as "1.2.0": newer versions do not have it, and "0" turns it off for every
 * version. `except` lists the versions up to `upTo` that do not have it, such as ["1.3.0"].
 * Change it with a Worker deploy.
 */
export const MOBILE_FEATURE_CONFIG: MobileFeatureConfig = {
  cloudServers: {
    ios: { upTo: "1.4.1", except: ["1.3.0"] },
    android: { upTo: "1.4.1" },
  },
  browser: {
    ios: { upTo: "1.4.1", except: ["1.3.0"] },
    android: { upTo: "1.4.1" },
  },
  deviceTools: {
    ios: { upTo: "1.4.1", except: ["1.3.0"] },
    android: { upTo: "0" },
  },
};
