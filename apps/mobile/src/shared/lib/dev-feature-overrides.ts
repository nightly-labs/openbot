import type { MobileFeature } from "@openbot/contracts/mobile-features";

/**
 * Development builds only. Set a feature to `true` or `false` and save: Fast Refresh shows the result,
 * and the account server's answer is ignored. `null` follows the account server. A release build
 * ignores this file, so a value left here does not ship.
 *
 * - `cloudServers`: the plans page of the plus button in the server list. `true` also shows it for
 *   an account that cannot have hosted servers.
 * - `browser`: the live view of an agent's browser tab.
 */
const DEV_FEATURE_OVERRIDES: Readonly<Record<MobileFeature, boolean | null>> = {
  cloudServers: null,
  browser: null,
};

/** The override of one feature in a development build, or null to follow the account server. */
export function devFeatureOverride(feature: MobileFeature): boolean | null {
  return __DEV__ ? DEV_FEATURE_OVERRIDES[feature] : null;
}

/**
 * Development builds only. Set a version newer than the app, such as "9.9.9", and home shows the update
 * header as if the store had that version. Later hides it until you set another version. `null`
 * follows the account server. A release build ignores it.
 */
const DEV_LATEST_APP_VERSION: string | null = null;

/** The newest store version in a development build, or null to follow the account server. */
export function devLatestAppVersion(): string | null {
  return __DEV__ ? DEV_LATEST_APP_VERSION : null;
}

/**
 * Development builds only. Set to `true` and reload the home screen to see the first-run flow again,
 * also for an account that finished it or whose server has agents. A release build ignores it.
 */
const DEV_REPLAY_ONBOARDING = false;

export function devReplayOnboarding(): boolean {
  return __DEV__ && DEV_REPLAY_ONBOARDING;
}
