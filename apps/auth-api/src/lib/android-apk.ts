// The Android app as an APK, for a phone with no Google Play. The file is the universal APK that
// Google Play makes from the store bundle, so it has the signature of the store app. It is on a
// GitHub release of its own, which is never the "latest" release: that one is the desktop app, and
// the desktop updater reads it (it is a prerelease, which cannot be "latest"). The release is a
// draft, which is not public, until the version is marked as available: then the
// `Publish the Android APK` workflow makes it public.
// See apps/mobile/README.md#android-apk.

import { isNewerMobileVersion } from "@openbot/contracts/mobile-features";
import { ANDROID_APK_FIRST_VERSION, MOBILE_LATEST_VERSIONS } from "../server/mobile-features-config";
import { OPENBOT_LINKS } from "./landing-links";

export interface AndroidApkRelease {
  /** The tag of the GitHub release. */
  tag: string;
  /** The name of the APK on that release. */
  asset: string;
  url: string;
}

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;

/**
 * Where the APK of the store version `version` is. scripts/android-apk-release.ts publishes with
 * these names, so the site link and the release cannot differ.
 */
export function androidApkRelease(version: string): AndroidApkRelease {
  if (!VERSION_PATTERN.test(version)) throw new Error(`${version} is not a store version of the Android app.`);
  const tag = `android-v${version}`;
  const asset = `OpenBot-${version}.apk`;
  return { tag, asset, url: `${OPENBOT_LINKS.releases}/download/${tag}/${asset}` };
}

/**
 * The version whose APK the site offers: the newest version on Google Play, so the two downloads
 * are the same build. Undefined while that version is from before the first APK.
 */
export function androidApkVersion(
  latest: string = MOBILE_LATEST_VERSIONS.android,
  first: string | null = ANDROID_APK_FIRST_VERSION,
): string | undefined {
  if (first === null || !VERSION_PATTERN.test(first) || !VERSION_PATTERN.test(latest)) return undefined;
  return isNewerMobileVersion(first, latest) ? undefined : latest;
}

/** True when the site shows the APK download. */
export const ANDROID_APK_AVAILABLE = androidApkVersion() !== undefined;
