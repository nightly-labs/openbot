import type { MobileFeatureConfig, MobileLatestVersions } from "@openbot/contracts/mobile-features";

/**
 * The app versions of each platform that have each mobile feature. `upTo` is the last version that
 * has the feature, such as "1.2.0": newer versions do not have it, and "0" turns it off for every
 * version. `except` lists the versions up to `upTo` that do not have it, such as ["1.3.0"].
 * Change it with a Worker deploy.
 */
export const MOBILE_FEATURE_CONFIG: MobileFeatureConfig = {
  cloudServers: {
    ios: { upTo: "1.4.9" },
    android: { upTo: "1.4.9" },
  },
  browser: {
    ios: { upTo: "1.4.9" },
    android: { upTo: "1.4.9" },
  },
};

/**
 * The newest app version that each store offers. An older app shows an update header on home. Set
 * it when the store makes the version available, as the feature versions above. Change it with a
 * Worker deploy.
 */
export const MOBILE_LATEST_VERSIONS: MobileLatestVersions = {
  ios: "1.4.9",
  android: "1.4.9",
};

/**
 * The first Android version that has its APK on GitHub, from the `Stage the Android APK` workflow.
 * From this version on, the site offers the APK of the newest Google Play version above, for a phone
 * with no Google Play (`apps/auth-api/src/lib/android-apk.ts`). A change of this file on main makes
 * the APK of that version public (the `Publish the Android APK` workflow).
 *
 * `null` hides the APK download. The first APK is build 24 of 1.4.9, staged by hand (run
 * 43390367490). Each later version needs its draft release before it is marked as available: else
 * the site links to a file that is not there, and `Publish the Android APK` fails.
 */
export const ANDROID_APK_FIRST_VERSION: string | null = "1.4.9";
