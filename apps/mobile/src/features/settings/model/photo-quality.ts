import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const key = "openbot.mobile.full-quality-photos.v1";
/**
 * Photos go as a smaller JPEG copy unless this is on. A full-quality photo is often 4–10 MB, and a
 * slow relay path cannot carry it in time (#8205).
 */
export const usePhotoQualityPreference = create<{ fullQuality: boolean; ready: boolean; saving: boolean }>(() => ({
  fullQuality: false,
  ready: false,
  saving: false,
}));

export async function loadPhotoQualityPreference(): Promise<void> {
  if (usePhotoQualityPreference.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(key);
    // A second startup read must not overwrite a change made in Settings.
    if (!usePhotoQualityPreference.getState().ready)
      usePhotoQualityPreference.setState({ fullQuality: stored === "true" });
  } finally {
    usePhotoQualityPreference.setState({ ready: true });
  }
}

export async function savePhotoQualityPreference(fullQuality: boolean): Promise<void> {
  if (!usePhotoQualityPreference.getState().ready || usePhotoQualityPreference.getState().saving) return;
  // Apply immediately, including when storage fails. Settings shows the error, and the user can switch again.
  usePhotoQualityPreference.setState({ fullQuality, saving: true });
  try {
    await SecureStore.setItemAsync(key, String(fullQuality));
  } finally {
    usePhotoQualityPreference.setState({ saving: false });
  }
}
