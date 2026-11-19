import type { AppSurface } from "@openbot/contracts/app-minimum-version";

export const APP_MINIMUM_VERSIONS: Readonly<Record<AppSurface, string | null>> = {
  desktop: null,
  host: null,
  ios: null,
  android: null,
};
