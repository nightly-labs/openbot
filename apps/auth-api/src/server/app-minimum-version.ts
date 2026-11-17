// The lowest app version that each surface still supports (plan 011, item 24). It comes from the
// release dates in CHANGELOG.md and apps/mobile/CHANGELOG.md, which the Worker carries with it, so
// it moves forward each day without a deploy, a D1 row or a call to GitHub. Each release deploys the
// Worker again with its new changelog. No file here imports through Vite, so a plain script can run
// the rule on its own release list.

import type { AppSurface } from "@openbot/contracts/app-minimum-version";
import { isNewerMobileVersion } from "@openbot/contracts/mobile-features";
import type { ChangelogPlatform, ChangelogRelease } from "../lib/changelog";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The days of releases that each surface supports. Desktop apps and servers support the releases of
 * the last 2 months; the phone apps at least 2 months, because a store can hold a version in review.
 * A longer window is a change here and a Worker deploy.
 */
const SUPPORT_WINDOW_DAYS: Readonly<Record<AppSurface, number>> = {
  desktop: 60,
  host: 60,
  ios: 60,
  android: 60,
};

/** `1.4.8.1`: an over-the-air update. The phone reports its store version, so only store versions count. */
const OTA_VERSION = /^\d+\.\d+\.\d+\.\d+$/;

function changelogOf(surface: AppSurface): ChangelogPlatform {
  return surface === "ios" || surface === "android" ? "mobile" : "desktop";
}

/** The day that the surface first had the release, or "" when it never had it. */
function releaseDate(release: ChangelogRelease, surface: AppSurface): string {
  if (surface === "desktop" || surface === "host") return release.date;
  if (OTA_VERSION.test(release.version)) return "";
  return release.stores.find((store) => store.store === surface)?.date ?? "";
}

/**
 * The release that was current on the first day of the window: the highest version that the surface
 * had on or before that day. Every release after it is newer, so an app on that version or later is
 * supported. Null when no release is that old, so nothing is blocked.
 */
export function resolveAppMinimumVersion(
  releases: Readonly<Record<ChangelogPlatform, readonly ChangelogRelease[]>>,
  surface: AppSurface,
  now: number,
): string | null {
  const windowStart = new Date(now - SUPPORT_WINDOW_DAYS[surface] * DAY_MS).toISOString().slice(0, 10);
  let minimum: string | null = null;
  for (const release of releases[changelogOf(surface)]) {
    const date = releaseDate(release, surface);
    if (!date || date > windowStart || !isNewerMobileVersion(release.version, "0")) continue;
    if (minimum === null || isNewerMobileVersion(release.version, minimum)) minimum = release.version;
  }
  return minimum;
}
