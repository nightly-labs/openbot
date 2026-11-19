import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const key = "openbot.mobile.large-files.v1";
/**
 * Files above the attachment limit download at once when this is on. It is off by default, so a
 * large file uses mobile data only when the user taps it.
 */
export const useLargeFilePreference = create<{ automatic: boolean; ready: boolean; saving: boolean }>(() => ({
  automatic: false,
  ready: false,
  saving: false,
}));

export async function loadLargeFilePreference(): Promise<void> {
  if (useLargeFilePreference.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(key);
    // A second startup read must not overwrite a change made in Settings.
    if (!useLargeFilePreference.getState().ready) useLargeFilePreference.setState({ automatic: stored === "true" });
  } finally {
    useLargeFilePreference.setState({ ready: true });
  }
}

export async function saveLargeFilePreference(automatic: boolean): Promise<void> {
  if (!useLargeFilePreference.getState().ready || useLargeFilePreference.getState().saving) return;
  // Apply immediately, including when storage fails. Settings shows the error, and the user can switch again.
  useLargeFilePreference.setState({ automatic, saving: true });
  try {
    await SecureStore.setItemAsync(key, String(automatic));
  } finally {
    useLargeFilePreference.setState({ saving: false });
  }
}
