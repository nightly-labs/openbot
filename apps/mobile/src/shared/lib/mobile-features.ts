import {
  MOBILE_FEATURES_PATH,
  type MobileFeatureFlags,
  mobileFeaturesOff,
  parseMobileFeatureFlags,
} from "@openbot/contracts/mobile-features";
import * as Application from "expo-application";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { create } from "zustand";
import { isAndroid, isIOS } from "@/shared/lib/platform";

/** A screen that opens often reads the flags again at most this often. */
const FLAGS_TTL_MS = 60_000;
const FLAGS_TIMEOUT_MS = 10_000;

/**
 * The feature flags of this app version, from the account server that the phone signed in to. Before the
 * first answer every feature is off, and a failed read keeps the last answer. An account server
 * without the flags endpoint, such as an older or self-hosted one, leaves every feature off.
 */
const useMobileFeatures = create<{ apiUrl: string | null; flags: MobileFeatureFlags; checkedAt: number }>(() => ({
  apiUrl: null,
  flags: mobileFeaturesOff(),
  checkedAt: 0,
}));

export async function refreshMobileFeatures(apiUrl: string, force = false): Promise<MobileFeatureFlags> {
  const current = useMobileFeatures.getState();
  if (current.apiUrl !== apiUrl) {
    useMobileFeatures.setState({ apiUrl, flags: mobileFeaturesOff(), checkedAt: 0 });
  } else if (!force && Date.now() - current.checkedAt < FLAGS_TTL_MS) {
    return current.flags;
  }
  const platform = isIOS ? "ios" : isAndroid ? "android" : null;
  if (!platform) return mobileFeaturesOff();

  const url = new URL(MOBILE_FEATURES_PATH, apiUrl);
  url.searchParams.set("platform", platform);
  const version = appVersion();
  if (version) url.searchParams.set("version", version);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FLAGS_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    const flags = response.ok ? parseMobileFeatureFlags(await response.json()) : null;
    if (!flags) return useMobileFeatures.getState().flags;
    if (useMobileFeatures.getState().apiUrl === apiUrl) {
      useMobileFeatures.setState({ flags, checkedAt: Date.now() });
    }
    return flags;
  } catch {
    return useMobileFeatures.getState().flags;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The OpenBot version. In Expo Go the native version is the version of Expo Go, so Expo Go and
 * development builds send the version of the app config; for a development build it is the same.
 * A release build sends its native version.
 */
function appVersion(): string | null {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return Constants.expoConfig?.version ?? null;
  return Application.nativeApplicationVersion;
}

/** One flag for the account server of this session. It is off for another account server. */
export function useMobileFeature(apiUrl: string, feature: keyof MobileFeatureFlags): boolean {
  return useMobileFeatures((state) => state.apiUrl === apiUrl && state.flags[feature]);
}
