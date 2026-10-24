import type { MobileFeature } from "@openbot/contracts/mobile-features";

/**
 * Development builds only. Set a feature to `true` or `false` and save: Fast Refresh shows the result,
 * and the account server's answer is ignored. `null` follows the account server. A release build
 * ignores this file, so a value left here does not ship.
 *
 * - `cloudServers`: the plans page of the plus button in the server list. `true` also shows it for
 *   an account that cannot have hosted servers.
 * - `browser`: the live view of an agent's browser tab.
 * - `deviceTools`: the tools that let an agent use Calendar, Reminders, Contacts and Location on this phone.
 */
const DEV_FEATURE_OVERRIDES: Readonly<Record<MobileFeature, boolean | null>> = {
  cloudServers: null,
  browser: null,
  deviceTools: null,
};

/** The override of one feature in a development build, or null to follow the account server. */
export function devFeatureOverride(feature: MobileFeature): boolean | null {
  return __DEV__ ? DEV_FEATURE_OVERRIDES[feature] : null;
}

/**
 * Development builds only. Set to `true` and reload the home screen to see the first-run flow again,
 * also for an account that finished it or whose server has agents. A release build ignores it.
 */
const DEV_REPLAY_ONBOARDING = false;

export function devReplayOnboarding(): boolean {
  return __DEV__ && DEV_REPLAY_ONBOARDING;
}
