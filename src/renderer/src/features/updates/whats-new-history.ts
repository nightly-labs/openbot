import type { WhatsNewRelease } from "@openbot/ui/features/updates/whats-new";

const WHATS_NEW_VERSION_KEY = "openbot:whats-new-version";
const LEGACY_VERSION_KEY = "openbot:analytics-app-version";

export function releaseVersion(value: string | null): string | null {
  return value !== null && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) ? value : null;
}

export function compareReleaseVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function selectWhatsNewReleases(
  releases: readonly WhatsNewRelease[],
  current: string,
  previous: string | null,
): WhatsNewRelease[] {
  return releases
    .filter((release) =>
      previous === null
        ? release.version === current
        : compareReleaseVersions(release.version, previous) > 0 &&
          compareReleaseVersions(release.version, current) <= 0,
    )
    .sort((a, b) => compareReleaseVersions(b.version, a.version));
}

export interface VersionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readWhatsNewVersion(storage: VersionStorage): string | null {
  try {
    return releaseVersion(storage.getItem(WHATS_NEW_VERSION_KEY) ?? storage.getItem(LEGACY_VERSION_KEY));
  } catch {
    return null;
  }
}

export function claimWhatsNewVersion(storage: VersionStorage, current: string): boolean {
  try {
    const saved = releaseVersion(storage.getItem(WHATS_NEW_VERSION_KEY));
    if (saved !== null && compareReleaseVersions(saved, current) >= 0) return false;
    storage.setItem(WHATS_NEW_VERSION_KEY, current);
    return true;
  } catch {
    return false;
  }
}
