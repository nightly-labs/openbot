import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const key = "openbot.mobile.large-files.v1";
export const useLargeFilePreference = create<{ automatic: boolean; ready: boolean; saving: boolean }>(() => ({
  automatic: false,
  ready: false,
  saving: false,
}));

export async function loadLargeFilePreference(): Promise<void> {
  if (useLargeFilePreference.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(key);
    if (!useLargeFilePreference.getState().ready) useLargeFilePreference.setState({ automatic: stored === "true" });
  } finally {
    useLargeFilePreference.setState({ ready: true });
  }
}

export async function saveLargeFilePreference(automatic: boolean): Promise<void> {
  if (!useLargeFilePreference.getState().ready || useLargeFilePreference.getState().saving) return;
  useLargeFilePreference.setState({ automatic, saving: true });
  try {
    await SecureStore.setItemAsync(key, String(automatic));
  } finally {
    useLargeFilePreference.setState({ saving: false });
  }
}
