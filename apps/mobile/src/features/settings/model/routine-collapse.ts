import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const key = "openbot.mobile.collapseRoutineRows.v1";

/** On: a row of consecutive routine markers in a chat starts closed. Off: it starts open. */
export const useRoutineCollapsePreference = create<{ enabled: boolean; ready: boolean; saving: boolean }>(() => ({
  enabled: true,
  ready: false,
  saving: false,
}));

export async function loadRoutineCollapsePreference(): Promise<void> {
  if (useRoutineCollapsePreference.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(key);
    // A second startup read must not overwrite a change made in Settings.
    if (!useRoutineCollapsePreference.getState().ready) {
      useRoutineCollapsePreference.setState({ enabled: stored !== "false" });
    }
  } finally {
    useRoutineCollapsePreference.setState({ ready: true });
  }
}

export async function saveRoutineCollapsePreference(enabled: boolean): Promise<void> {
  if (!useRoutineCollapsePreference.getState().ready || useRoutineCollapsePreference.getState().saving) return;
  // Apply immediately, including when storage fails. Settings shows the error.
  useRoutineCollapsePreference.setState({ enabled, saving: true });
  try {
    await SecureStore.setItemAsync(key, String(enabled));
  } finally {
    useRoutineCollapsePreference.setState({ saving: false });
  }
}
