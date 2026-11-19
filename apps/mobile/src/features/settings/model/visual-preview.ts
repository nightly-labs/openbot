import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const key = "openbot.mobile.fullVisualPreviews.v1";

/**
 * On: a visual reply in a chat grows to the full height of its page. Off (the default): it keeps the
 * height that the agent asked for, or the default height, and a tap opens all of it.
 */
export const useFullVisualPreference = create<{ enabled: boolean; ready: boolean; saving: boolean }>(() => ({
  enabled: false,
  ready: false,
  saving: false,
}));

export async function loadFullVisualPreference(): Promise<void> {
  if (useFullVisualPreference.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(key);
    // A second startup read must not overwrite a change made in Settings.
    if (!useFullVisualPreference.getState().ready) useFullVisualPreference.setState({ enabled: stored === "true" });
  } finally {
    useFullVisualPreference.setState({ ready: true });
  }
}

export async function saveFullVisualPreference(enabled: boolean): Promise<void> {
  if (!useFullVisualPreference.getState().ready || useFullVisualPreference.getState().saving) return;
  // Apply immediately, including when storage fails. Settings shows the error.
  useFullVisualPreference.setState({ enabled, saving: true });
  try {
    await SecureStore.setItemAsync(key, String(enabled));
  } finally {
    useFullVisualPreference.setState({ saving: false });
  }
}
