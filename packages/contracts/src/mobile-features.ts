import { compareReleaseVersions, type ReleaseVersion } from "./release-version";
import { isBoolean, isDynamicRecord, isString } from "./runtime-values";

export const MOBILE_FEATURES = ["cloudServers", "browser"] as const;

export type MobileFeature = (typeof MOBILE_FEATURES)[number];
export type MobileFeaturePlatform = "ios" | "android";
export type MobileFeatureFlags = Record<MobileFeature, boolean>;

export type MobileFeatureVersions = { upTo: string; except?: readonly string[] };

export type MobileFeatureConfig = Record<MobileFeature, Record<MobileFeaturePlatform, MobileFeatureVersions>>;

export type MobileLatestVersions = Record<MobileFeaturePlatform, string>;

export const MOBILE_FEATURES_PATH = "/v1/mobile/features";

export function mobileFeaturesOff(): MobileFeatureFlags {
  return { cloudServers: false, browser: false };
}

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

export function parseMobileFeatureFlags(value: unknown): MobileFeatureFlags | null {
  if (!isDynamicRecord(value) || !isDynamicRecord(value.features)) return null;
  const features = value.features;
  const flags = mobileFeaturesOff();
  for (const feature of MOBILE_FEATURES) flags[feature] = isBoolean(features[feature]) && features[feature];
  return flags;
}

export function resolveMobileLatestVersion(latest: MobileLatestVersions, platform: string | null): string | null {
  if (platform !== "ios" && platform !== "android") return null;
  return versionParts(latest[platform]) ? latest[platform] : null;
}

export function parseMobileLatestVersion(value: unknown): string | null {
  if (!isDynamicRecord(value) || !isString(value.latestVersion)) return null;
  return versionParts(value.latestVersion) ? value.latestVersion : null;
}

export function isNewerMobileVersion(candidate: string, current: string): boolean {
  const next = versionParts(candidate);
  const now = versionParts(current);
  return next !== null && now !== null && compareReleaseVersions(next, now) > 0;
}

export const MOBILE_CHANGELOG_PATH = "/v1/mobile/changelog";

export interface MobileReleaseNoteGroup {
  type: string;
  heading: string;
  items: string[];
}

export interface MobileReleaseNotes {
  version: string;
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

export function parseMobileReleaseNotes(value: unknown): MobileReleaseNotes[] | null {
  if (!isDynamicRecord(value) || !Array.isArray(value.releases)) return null;
  return value.releases.flatMap((release) => parseReleaseNotes(release) ?? []);
}
