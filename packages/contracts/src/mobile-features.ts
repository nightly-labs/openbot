import { compareReleaseVersions, type ReleaseVersion } from "./release-version";
import { isBoolean, isDynamicRecord, isString } from "./runtime-values";

/** The mobile features that the account server can turn on and off for each platform and app version. */
export const MOBILE_FEATURES = [
  /**
   * The plans of a hosted server and the account's hosted servers. App versions up to 1.2.0 also
   * take the Stripe payment; newer versions sell nothing.
   */
  "cloudServers",
  /** The live view of an agent's browser tab on its host, and the controls of the tab. */
  "browser",
] as const;

export type MobileFeature = (typeof MOBILE_FEATURES)[number];
export type MobileFeaturePlatform = "ios" | "android";
export type MobileFeatureFlags = Record<MobileFeature, boolean>;

/**
 * The app versions of one platform that have a feature. `upTo` is the last version that has it, such
 * as "1.2.0": newer versions do not have it, and "0" turns it off for every version. `except` lists
 * the versions up to `upTo` that do not have it.
 */
export type MobileFeatureVersions = { upTo: string; except?: readonly string[] };

export type MobileFeatureConfig = Record<MobileFeature, Record<MobileFeaturePlatform, MobileFeatureVersions>>;

/** The newest app version that each store offers. The app shows an update when it runs an older one. */
export type MobileLatestVersions = Record<MobileFeaturePlatform, string>;

export const MOBILE_FEATURES_PATH = "/v1/mobile/features";

/** Every feature off: the answer for an unknown platform or version, and when the app cannot read the flags. */
export function mobileFeaturesOff(): MobileFeatureFlags {
  return { cloudServers: false, browser: false };
}

/**
 * A mobile app version. This is a released contract of the feature gates, the changelog and the
 * update prompt, and it is not SemVer: an over-the-air update adds a fourth part ("1.4.8.1"), and
 * there is no pre-release. So it keeps its own grammar. The order is the shared one, so "1.10.0" is
 * after "1.9.0", "1.2" equals "1.2.0" and "1.4.8.1" is after "1.4.8".
 */
function versionParts(value: string): ReleaseVersion | null {
  if (!/^\d{1,6}(\.\d{1,6}){0,3}$/u.test(value)) return null;
  return { parts: value.split(".").map(Number), prerelease: [] };
}

function hasFeature(versions: MobileFeatureVersions, version: ReleaseVersion): boolean {
  const last = versionParts(versions.upTo);
  if (!last?.parts.some((part) => part > 0) || compareReleaseVersions(version, last) > 0) return false;
  return !versions.except?.some((value) => {
    const excluded = versionParts(value);
    return excluded !== null && compareReleaseVersions(version, excluded) === 0;
  });
}

/** The flags of one app version. A version that is missing or that the server cannot read has no feature. */
export function resolveMobileFeatures(
  config: MobileFeatureConfig,
  platform: string | null,
  version: string | null,
): MobileFeatureFlags {
  const flags = mobileFeaturesOff();
  if (platform !== "ios" && platform !== "android") return flags;
  const parts = version ? versionParts(version) : null;
  if (!parts) return flags;
  for (const feature of MOBILE_FEATURES) flags[feature] = hasFeature(config[feature][platform], parts);
  return flags;
}

/** The flags in a `{ features }` answer. A flag that is missing or not a boolean is off. */
export function parseMobileFeatureFlags(value: unknown): MobileFeatureFlags | null {
  if (!isDynamicRecord(value) || !isDynamicRecord(value.features)) return null;
  const features = value.features;
  const flags = mobileFeaturesOff();
  for (const feature of MOBILE_FEATURES) flags[feature] = isBoolean(features[feature]) && features[feature];
  return flags;
}

/** The newest store version of one platform. An unknown platform or a version the app cannot read has none. */
export function resolveMobileLatestVersion(latest: MobileLatestVersions, platform: string | null): string | null {
  if (platform !== "ios" && platform !== "android") return null;
  return versionParts(latest[platform]) ? latest[platform] : null;
}

/** The `latestVersion` of a `{ features }` answer. An older account server sends none. */
export function parseMobileLatestVersion(value: unknown): string | null {
  if (!isDynamicRecord(value) || !isString(value.latestVersion)) return null;
  return versionParts(value.latestVersion) ? value.latestVersion : null;
}

/** True when `candidate` is after `current`. A version that cannot be read is never newer. */
export function isNewerMobileVersion(candidate: string, current: string): boolean {
  const next = versionParts(candidate);
  const now = versionParts(current);
  return next !== null && now !== null && compareReleaseVersions(next, now) > 0;
}

export const MOBILE_CHANGELOG_PATH = "/v1/mobile/changelog";

/** A group of a release, as the changelog writes it: `added`, `changed`, `fixed` and so on. */
export interface MobileReleaseNoteGroup {
  /** The lower-case group name, such as `added`. A group the app has no name for shows `heading`. */
  type: string;
  heading: string;
  /** Plain text: the server removes the Markdown of each item. */
  items: string[];
}

/** One app version in the store of a platform, with its release notes. */
export interface MobileReleaseNotes {
  version: string;
  /** `YYYY-MM-DD`, the day the store of the platform made the version available. */
  date: string;
  groups: MobileReleaseNoteGroup[];
}

function parseReleaseNoteGroup(value: unknown): MobileReleaseNoteGroup | null {
  if (!isDynamicRecord(value) || !isString(value.type) || !isString(value.heading) || !Array.isArray(value.items))
    return null;
  return { type: value.type, heading: value.heading, items: value.items.filter(isString) };
}

function parseReleaseNotes(value: unknown): MobileReleaseNotes | null {
  if (!isDynamicRecord(value) || !isString(value.version) || !versionParts(value.version)) return null;
  if (!isString(value.date) || !Array.isArray(value.groups)) return null;
  const groups = value.groups.flatMap((group) => parseReleaseNoteGroup(group) ?? []);
  return { version: value.version, date: value.date, groups };
}

/** The releases of a `{ releases }` answer, newest first. A release the app cannot read is left out. */
export function parseMobileReleaseNotes(value: unknown): MobileReleaseNotes[] | null {
  if (!isDynamicRecord(value) || !Array.isArray(value.releases)) return null;
  return value.releases.flatMap((release) => parseReleaseNotes(release) ?? []);
}
