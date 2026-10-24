import { isBoolean, isDynamicRecord } from "./runtime-values";

/** The mobile features that the account server can turn on and off for each platform and app version. */
export const MOBILE_FEATURES = [
  /**
   * The plans of a hosted server and the account's hosted servers. App versions up to 1.2.0 also
   * take the Stripe payment; newer versions sell nothing.
   */
  "cloudServers",
  /** The live view of an agent's browser tab on its host, and the controls of the tab. */
  "browser",
  /** The tools that let an agent on the host use Calendar, Reminders, Contacts and Location on the phone. */
  "deviceTools",
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

export const MOBILE_FEATURES_PATH = "/v1/mobile/features";

/** Every feature off: the answer for an unknown platform or version, and when the app cannot read the flags. */
export function mobileFeaturesOff(): MobileFeatureFlags {
  return { cloudServers: false, browser: false, deviceTools: false };
}

function versionParts(value: string): number[] | null {
  if (!/^\d{1,6}(\.\d{1,6}){0,3}$/u.test(value)) return null;
  return value.split(".").map(Number);
}

/** Compares two versions part by part, so "1.10.0" is after "1.9.0" and "1.2" equals "1.2.0". */
function compareVersions(version: number[], other: number[]): number {
  for (let index = 0; index < Math.max(version.length, other.length); index += 1) {
    const difference = (version[index] ?? 0) - (other[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function hasFeature(versions: MobileFeatureVersions, version: number[]): boolean {
  const last = versionParts(versions.upTo);
  if (!last?.some((part) => part > 0) || compareVersions(version, last) > 0) return false;
  return !versions.except?.some((value) => {
    const excluded = versionParts(value);
    return excluded !== null && compareVersions(version, excluded) === 0;
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
