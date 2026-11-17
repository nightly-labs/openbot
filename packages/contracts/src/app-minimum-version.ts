import { isNewerMobileVersion } from "./mobile-features";
import { isDynamicRecord, isString } from "./runtime-values";

/** The surfaces that have a minimum app version (plan 011, item 24). The web client has none. */
export const APP_SURFACES = ["desktop", "host", "ios", "android"] as const;
export type AppSurface = (typeof APP_SURFACES)[number];

export const APP_MINIMUM_VERSION_PATH = "/v1/app/minimum-version";

export function isAppSurface(value: unknown): value is AppSurface {
  return APP_SURFACES.some((surface) => surface === value);
}

/** The `minimumVersion` of an answer. Null when there is none or it cannot be read, so it never blocks. */
export function parseAppMinimumVersion(value: unknown): string | null {
  if (!isDynamicRecord(value) || !isString(value.minimumVersion)) return null;
  return isNewerMobileVersion(value.minimumVersion, "0") ? value.minimumVersion : null;
}

/**
 * True only when both versions can be read and `current` comes before `minimum`.
 * Uses the mobile comparator until the shared one of PR #10774 is on main.
 */
export function isBelowMinimumVersion(current: string, minimum: string | null): boolean {
  return minimum !== null && isNewerMobileVersion(minimum, current);
}
