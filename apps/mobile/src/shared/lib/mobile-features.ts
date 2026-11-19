import { parseAppMinimumVersion } from "@openbot/contracts/app-minimum-version";
import {
  MOBILE_FEATURES_PATH,
  type MobileFeatureFlags,
  mobileFeaturesOff,
  parseMobileFeatureFlags,
  parseMobileLatestVersion,
} from "@openbot/contracts/mobile-features";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { useEffect } from "react";
import { AppState } from "react-native";
import { create } from "zustand";
import { devFeatureOverride, devLatestAppVersion } from "@/shared/lib/dev-feature-overrides";
import { nativeApplicationVersion } from "@/shared/lib/native-application";
import { isAndroid, isIOS } from "@/shared/lib/platform";

const FLAGS_TTL_MS = 10 * 60_000;
const FLAGS_TIMEOUT_MS = 10_000;

const useMobileFeatures = create<{
  apiUrl: string | null;
  flags: MobileFeatureFlags;
  latestVersion: string | null;
  minimumVersion: string | null;
  checkedAt: number;
}>(() => ({
  apiUrl: null,
  flags: mobileFeaturesOff(),
  latestVersion: null,
  minimumVersion: null,
  checkedAt: 0,
}));

export async function refreshMobileFeatures(apiUrl: string, force = false): Promise<MobileFeatureFlags> {
  const current = useMobileFeatures.getState();
  if (current.apiUrl !== apiUrl) {
    useMobileFeatures.setState({
      apiUrl,
      flags: mobileFeaturesOff(),
      latestVersion: null,
      minimumVersion: null,
      checkedAt: 0,
    });
  } else if (!force && Date.now() - current.checkedAt < FLAGS_TTL_MS) {
    return current.flags;
  }
  const platform = isIOS ? "ios" : isAndroid ? "android" : null;
  if (!platform) return mobileFeaturesOff();

  const url = new URL(MOBILE_FEATURES_PATH, apiUrl);
  url.searchParams.set("platform", platform);
  const version = currentAppVersion();
  if (version) url.searchParams.set("version", version);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FLAGS_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    const body = response.ok ? await response.json() : null;
    const flags = parseMobileFeatureFlags(body);
    if (!flags) return useMobileFeatures.getState().flags;
    if (useMobileFeatures.getState().apiUrl === apiUrl) {
      useMobileFeatures.setState({
        flags,
        latestVersion: parseMobileLatestVersion(body),
        minimumVersion: parseAppMinimumVersion(body),
        checkedAt: Date.now(),
      });
    }
    return flags;
  } catch {
    return useMobileFeatures.getState().flags;
  } finally {
    clearTimeout(timeout);
  }
}

export function currentAppVersion(): string | null {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return Constants.expoConfig?.version ?? null;
  return nativeApplicationVersion();
}

export function useMobileFeature(apiUrl: string, feature: keyof MobileFeatureFlags): boolean {
  const on = useMobileFeatures((state) => state.apiUrl === apiUrl && state.flags[feature]);
  return devFeatureOverride(feature) ?? on;
}

export function useMobileFeaturesRefresh(apiUrl: string | null, options: { onAppActive?: boolean } = {}): void {
  const onAppActive = options.onAppActive ?? false;
  useEffect(() => {
    if (!apiUrl) return;
    void refreshMobileFeatures(apiUrl);
    if (!onAppActive) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshMobileFeatures(apiUrl);
    });
    return () => subscription.remove();
  }, [apiUrl, onAppActive]);
}

export function useRefreshedMobileFeature(apiUrl: string, feature: keyof MobileFeatureFlags): boolean {
  useMobileFeaturesRefresh(apiUrl);
  return useMobileFeature(apiUrl, feature);
}

export function useLatestAppVersion(apiUrl: string): string | null {
  const latest = useMobileFeatures((state) => (state.apiUrl === apiUrl ? state.latestVersion : null));
  return devLatestAppVersion() ?? latest;
}

export function useMinimumAppVersion(apiUrl: string): string | null {
  return useMobileFeatures((state) => (state.apiUrl === apiUrl ? state.minimumVersion : null));
}
