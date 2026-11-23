import { isNewerMobileVersion } from "@openbot/contracts/mobile-features";
import { ANDROID_APK_FIRST_VERSION, MOBILE_LATEST_VERSIONS } from "../server/mobile-features-config";
import { OPENBOT_LINKS } from "./landing-links";

export interface AndroidApkRelease {
  tag: string;
  asset: string;
  url: string;
}

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;

export function androidApkRelease(version: string): AndroidApkRelease {
  if (!VERSION_PATTERN.test(version)) throw new Error(`${version} is not a store version of the Android app.`);
  const tag = `android-v${version}`;
  const asset = `OpenBot-${version}.apk`;
  return { tag, asset, url: `${OPENBOT_LINKS.releases}/download/${tag}/${asset}` };
}

export function androidApkVersion(
  latest: string = MOBILE_LATEST_VERSIONS.android,
  first: string | null = ANDROID_APK_FIRST_VERSION,
): string | undefined {
  if (first === null || !VERSION_PATTERN.test(first) || !VERSION_PATTERN.test(latest)) return undefined;
  return isNewerMobileVersion(first, latest) ? undefined : latest;
}

export const ANDROID_APK_AVAILABLE = androidApkVersion() !== undefined;
