import { isBoolean, isDynamicRecord } from "./runtime-values";

/** The mobile features that the account server can turn on and off for each platform and app version. */
export const MOBILE_FEATURES = [
  /** The plans and the Stripe payment for a hosted server. */
  "cloudServers",
] as const;

export type MobileFeature = (typeof MOBILE_FEATURES)[number];
export type MobileFeaturePlatform = "ios" | "android";
export type MobileFeatureFlags = Record<MobileFeature, boolean>;

/**
 * The last app version of each platform that has the feature, such as "1.2.0". Versions up to it
 * have the feature, newer versions do not, and "0" turns it off for every version.
 */
export type MobileFeatureConfig = Record<MobileFeature, Record<MobileFeaturePlatform, string>>;

export const MOBILE_FEATURES_PATH = "/v1/mobile/features";

/** Every feature off: the answer for an unknown platform or version, and when the app cannot read the flags. */
export function mobileFeaturesOff(): MobileFeatureFlags {
  return { cloudServers: false };
}

function versionParts(value: string): number[] | null {
  if (!/^\d{1,6}(\.\d{1,6}){0,3}$/u.test(value)) return null;
  return value.split(".").map(Number);
}

/** Compares two versions part by part, so "1.10.0" is after "1.9.0" and "1.2" equals "1.2.0". */
function isAfterVersion(version: number[], last: number[]): boolean {
  for (let index = 0; index < Math.max(version.length, last.length); index += 1) {
    const difference = (version[index] ?? 0) - (last[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
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
  for (const feature of MOBILE_FEATURES) {
    const last = versionParts(config[feature][platform]);
    flags[feature] = last !== null && !isAfterVersion(parts, last) && last.some((part) => part > 0);
  }
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
