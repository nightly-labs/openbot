import type { MobileFeature } from "@openbot/contracts/mobile-features";

const DEV_FEATURE_OVERRIDES: Readonly<Record<MobileFeature, boolean | null>> = {
  cloudServers: null,
  browser: null,
};

export function devFeatureOverride(feature: MobileFeature): boolean | null {
  return __DEV__ ? DEV_FEATURE_OVERRIDES[feature] : null;
}

const DEV_LATEST_APP_VERSION: string | null = null;

export function devLatestAppVersion(): string | null {
  return __DEV__ ? DEV_LATEST_APP_VERSION : null;
}

const DEV_REPLAY_ONBOARDING = false;

export function devReplayOnboarding(): boolean {
  return __DEV__ && DEV_REPLAY_ONBOARDING;
}

const DEV_SHOW_RATING_ASK = false;

export function devShowRatingAsk(): boolean {
  return __DEV__ && DEV_SHOW_RATING_ASK;
}

const DEV_MOCK_CREDITS = false;

export function devMockCredits(): boolean {
  return __DEV__ && DEV_MOCK_CREDITS;
}
