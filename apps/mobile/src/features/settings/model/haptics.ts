import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const key = "openbot.mobile.haptics.v1";
export const useHapticsPreference = create<{ enabled: boolean; ready: boolean; saving: boolean }>(() => ({
  enabled: false,
  ready: false,
  saving: false,
}));

export async function loadHapticsPreference(): Promise<void> {
  if (useHapticsPreference.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(key);
    // A second startup read must not overwrite a change made in Settings.
    if (!useHapticsPreference.getState().ready) {
      useHapticsPreference.setState({ enabled: stored === null || stored === "true" });
    }
  } finally {
    useHapticsPreference.setState({ ready: true });
  }
}

export async function saveHapticsPreference(enabled: boolean): Promise<void> {
  if (!useHapticsPreference.getState().ready || useHapticsPreference.getState().saving) return;
  // Apply immediately, including when storage fails. Settings offers a retry.
  useHapticsPreference.setState({ enabled, saving: true });
  try {
    await SecureStore.setItemAsync(key, String(enabled));
  } finally {
    useHapticsPreference.setState({ saving: false });
  }
}
