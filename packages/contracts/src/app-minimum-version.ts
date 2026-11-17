import { isNewerMobileVersion } from "./mobile-features";
import { isDynamicRecord, isString } from "./runtime-values";

/**
 * The lowest app version that the account service still supports for each surface (plan 011, item 24).
 * Desktop apps and servers support the releases of the last 2 months (60 days), and the phone apps
 * at least 2 months. An app below its minimum shows "Update required" and installs the update.
 *
 * The request names only the surface. The app compares its own version, so it sends no version, no
 * account and no session.
 */
export const APP_SURFACES = ["desktop", "host", "ios", "android"] as const;
export type AppSurface = (typeof APP_SURFACES)[number];

export const APP_MINIMUM_VERSION_PATH = "/v1/app/minimum-version";

export function isAppSurface(value: unknown): value is AppSurface {
  return APP_SURFACES.some((surface) => surface === value);
}

/**
 * The `minimumVersion` of an answer: `{ minimumVersion: "0.70.0" }` from `APP_MINIMUM_VERSION_PATH`, or
 * the same field of the mobile features answer. Null when there is no minimum, and for an answer that
 * the app cannot read, so a damaged answer never blocks the app.
 */
export function parseAppMinimumVersion(value: unknown): string | null {
  if (!isDynamicRecord(value) || !isString(value.minimumVersion)) return null;
  return isNewerMobileVersion(value.minimumVersion, "0") ? value.minimumVersion : null;
}

/**
 * True only when both versions can be read and `current` comes before `minimum`. A pre-release or a
 * development version that cannot be read is never below the minimum.
 *
 * It uses the comparator of the mobile versions, which reads dotted numbers. PR #10774 adds one
 * release version comparator for all surfaces; this function moves to it with that change.
 */
export function isBelowMinimumVersion(current: string, minimum: string | null): boolean {
  return minimum !== null && isNewerMobileVersion(minimum, current);
}
