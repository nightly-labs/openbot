import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { mobileAnalytics } from "./mobile-analytics";

const key = "openbot.mobile.analytics.v1";
export const useAnalyticsPreference = create<{ enabled: boolean; ready: boolean; saving: boolean }>(() => ({
  enabled: false,
  ready: false,
  saving: false,
}));
let loading: Promise<void> | null = null;

export function loadAnalyticsPreference(): Promise<void> {
  loading ??= SecureStore.getItemAsync(key)
    .then((stored) => {
      const enabled = stored === null || stored === "true";
      mobileAnalytics.setEnabled(enabled);
      useAnalyticsPreference.setState({ enabled, ready: true });
    })
    .catch(() => {
      // An unreadable preference must not turn tracking on.
      useAnalyticsPreference.setState({ enabled: false, ready: true });
    });
  return loading;
}

export async function saveAnalyticsPreference(enabled: boolean): Promise<void> {
  if (!useAnalyticsPreference.getState().ready || useAnalyticsPreference.getState().saving) return;
  useAnalyticsPreference.setState({ saving: true });
  if (!enabled) {
    mobileAnalytics.setEnabled(false);
    useAnalyticsPreference.setState({ enabled: false });
  }
  try {
    await SecureStore.setItemAsync(key, String(enabled));
    mobileAnalytics.setEnabled(enabled);
    useAnalyticsPreference.setState({ enabled });
  } finally {
    useAnalyticsPreference.setState({ saving: false });
  }
}
