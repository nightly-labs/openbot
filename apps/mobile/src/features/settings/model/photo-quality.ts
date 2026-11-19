import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const key = "openbot.mobile.full-quality-photos.v1";
export const usePhotoQualityPreference = create<{ fullQuality: boolean; ready: boolean; saving: boolean }>(() => ({
  fullQuality: false,
  ready: false,
  saving: false,
}));

export async function loadPhotoQualityPreference(): Promise<void> {
  if (usePhotoQualityPreference.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(key);
    if (!usePhotoQualityPreference.getState().ready)
      usePhotoQualityPreference.setState({ fullQuality: stored === "true" });
  } finally {
    usePhotoQualityPreference.setState({ ready: true });
  }
}

export async function savePhotoQualityPreference(fullQuality: boolean): Promise<void> {
  if (!usePhotoQualityPreference.getState().ready || usePhotoQualityPreference.getState().saving) return;
  usePhotoQualityPreference.setState({ fullQuality, saving: true });
  try {
    await SecureStore.setItemAsync(key, String(fullQuality));
  } finally {
    usePhotoQualityPreference.setState({ saving: false });
  }
}
