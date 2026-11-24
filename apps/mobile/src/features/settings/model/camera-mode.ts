import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const key = "openbot.mobile.full-screen-camera.v1";
const tipKey = "openbot.mobile.full-screen-camera-tip-seen.v1";
export const useFullScreenCameraPreference = create<{
  fullScreen: boolean;
  tipSeen: boolean;
  ready: boolean;
  saving: boolean;
}>(() => ({
  fullScreen: false,
  tipSeen: true,
  ready: false,
  saving: false,
}));

export async function loadFullScreenCameraPreference(): Promise<void> {
  if (useFullScreenCameraPreference.getState().ready) return;
  try {
    const [stored, tipSeen] = await Promise.all([SecureStore.getItemAsync(key), SecureStore.getItemAsync(tipKey)]);
    if (!useFullScreenCameraPreference.getState().ready)
      useFullScreenCameraPreference.setState({ fullScreen: stored === "true", tipSeen: tipSeen === "true" });
  } finally {
    useFullScreenCameraPreference.setState({ ready: true });
  }
}

export async function saveFullScreenCameraPreference(fullScreen: boolean): Promise<void> {
  if (!useFullScreenCameraPreference.getState().ready || useFullScreenCameraPreference.getState().saving) return;
  useFullScreenCameraPreference.setState({ fullScreen, saving: true });
  try {
    await SecureStore.setItemAsync(key, String(fullScreen));
  } finally {
    useFullScreenCameraPreference.setState({ saving: false });
  }
}

export async function markFullScreenCameraTipSeen(): Promise<void> {
  useFullScreenCameraPreference.setState({ tipSeen: true });
  await SecureStore.setItemAsync(tipKey, "true");
}
