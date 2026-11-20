import { isNewerMobileVersion } from "./mobile-features";
import { isDynamicRecord, isString } from "./runtime-values";

export const APP_SURFACES = ["desktop", "host", "ios", "android"] as const;
export type AppSurface = (typeof APP_SURFACES)[number];

export const APP_MINIMUM_VERSION_PATH = "/v1/app/minimum-version";

export function isAppSurface(value: unknown): value is AppSurface {
  return APP_SURFACES.some((surface) => surface === value);
}

export function parseAppMinimumVersion(value: unknown): string | null {
  if (!isDynamicRecord(value) || !isString(value.minimumVersion)) return null;
  return isNewerMobileVersion(value.minimumVersion, "0") ? value.minimumVersion : null;
}

export function isBelowMinimumVersion(current: string, minimum: string | null): boolean {
  return minimum !== null && isNewerMobileVersion(minimum, current);
}
