import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const key = "openbot.mobile.fullVisualPreviews.v1";

export const useFullVisualPreference = create<{ enabled: boolean; ready: boolean; saving: boolean }>(() => ({
  enabled: false,
  ready: false,
  saving: false,
}));

export async function loadFullVisualPreference(): Promise<void> {
  if (useFullVisualPreference.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(key);
    if (!useFullVisualPreference.getState().ready) useFullVisualPreference.setState({ enabled: stored === "true" });
  } finally {
    useFullVisualPreference.setState({ ready: true });
  }
}

export async function saveFullVisualPreference(enabled: boolean): Promise<void> {
  if (!useFullVisualPreference.getState().ready || useFullVisualPreference.getState().saving) return;
  useFullVisualPreference.setState({ enabled, saving: true });
  try {
    await SecureStore.setItemAsync(key, String(enabled));
  } finally {
    useFullVisualPreference.setState({ saving: false });
  }
}
