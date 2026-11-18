import type { AppSurface } from "@openbot/contracts/app-minimum-version";

/**
 * The lowest supported version of each surface (plan 011, item 24). Null blocks nothing. Raise a value
 * only in a PR that deletes old code or needs it. `scripts/check-app-minimum-version.ts` fails when a
 * value is not a release that is 60 days old or older (store dates for ios and android).
 */
export const APP_MINIMUM_VERSIONS: Readonly<Record<AppSurface, string | null>> = {
  desktop: null,
  host: null,
  ios: null,
  android: null,
};
