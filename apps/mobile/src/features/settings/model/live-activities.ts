import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const key = "openbot.mobile.live-activities.v1";
export const useLiveActivitiesPreference = create<{ enabled: boolean; ready: boolean; saving: boolean }>(() => ({
  enabled: true,
  ready: false,
  saving: false,
}));

export async function loadLiveActivitiesPreference(): Promise<void> {
  if (useLiveActivitiesPreference.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(key);
    // A second startup read must not overwrite a change made in Settings.
    if (!useLiveActivitiesPreference.getState().ready) {
      useLiveActivitiesPreference.setState({ enabled: stored !== "false" });
    }
  } finally {
    useLiveActivitiesPreference.setState({ ready: true });
  }
}

export async function saveLiveActivitiesPreference(enabled: boolean): Promise<void> {
  if (!useLiveActivitiesPreference.getState().ready || useLiveActivitiesPreference.getState().saving) return;
  // Apply immediately, including when storage fails. Settings offers a retry.
  useLiveActivitiesPreference.setState({ enabled, saving: true });
  try {
    await SecureStore.setItemAsync(key, String(enabled));
  } finally {
    useLiveActivitiesPreference.setState({ saving: false });
  }
}
