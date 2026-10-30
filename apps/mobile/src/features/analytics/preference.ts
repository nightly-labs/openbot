import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { mobileAnalytics } from "./mobile-analytics";

const key = "openbot.mobile.analytics.v1";
// The longest wait for the opt-out event before tracking stops. The opt-out must not wait for a slow network.
const OPT_OUT_EVENT_LIMIT_MS = 2_000;
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
      mobileAnalytics.setEnabled(false);
      useAnalyticsPreference.setState({ enabled: false, ready: true });
    });
  return loading;
}

export async function saveAnalyticsPreference(enabled: boolean): Promise<void> {
  if (!useAnalyticsPreference.getState().ready || useAnalyticsPreference.getState().saving) return;
  const wasEnabled = useAnalyticsPreference.getState().enabled;
  useAnalyticsPreference.setState({ saving: true });
  if (!enabled) {
    useAnalyticsPreference.setState({ enabled: false });
    // The opt-out event goes out before the client stops. Nothing else is sent after the choice.
    if (wasEnabled) {
      await mobileAnalytics.sendLast("analytics_preference_changed", { enabled: false }, OPT_OUT_EVENT_LIMIT_MS);
    }
    mobileAnalytics.setEnabled(false);
  }
  try {
    await SecureStore.setItemAsync(key, String(enabled));
    mobileAnalytics.setEnabled(enabled);
    useAnalyticsPreference.setState({ enabled });
  } finally {
    useAnalyticsPreference.setState({ saving: false });
  }
}
