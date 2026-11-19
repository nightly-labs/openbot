import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const key = "openbot.mobile.collapseRoutineRows.v1";

export const useRoutineCollapsePreference = create<{ enabled: boolean; ready: boolean; saving: boolean }>(() => ({
  enabled: true,
  ready: false,
  saving: false,
}));

export async function loadRoutineCollapsePreference(): Promise<void> {
  if (useRoutineCollapsePreference.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(key);
    if (!useRoutineCollapsePreference.getState().ready) {
      useRoutineCollapsePreference.setState({ enabled: stored !== "false" });
    }
  } finally {
    useRoutineCollapsePreference.setState({ ready: true });
  }
}

export async function saveRoutineCollapsePreference(enabled: boolean): Promise<void> {
  if (!useRoutineCollapsePreference.getState().ready || useRoutineCollapsePreference.getState().saving) return;
  useRoutineCollapsePreference.setState({ enabled, saving: true });
  try {
    await SecureStore.setItemAsync(key, String(enabled));
  } finally {
    useRoutineCollapsePreference.setState({ saving: false });
  }
}
