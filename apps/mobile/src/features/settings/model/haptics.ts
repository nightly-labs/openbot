import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const key = "openbot.mobile.haptics.v1";
const repliesKey = "openbot.mobile.haptics.replies.v1";

/** `enabled` turns off all haptics. `replies` turns off only the taps while an agent reply appears. */
export const useHapticsPreference = create<{ enabled: boolean; replies: boolean; ready: boolean; saving: boolean }>(
  () => ({
    enabled: false,
    replies: false,
    ready: false,
    saving: false,
  }),
);

export type HapticsSetting = "enabled" | "replies";

export async function loadHapticsPreference(): Promise<void> {
  if (useHapticsPreference.getState().ready) return;
  try {
    const [stored, storedReplies] = await Promise.all([
      SecureStore.getItemAsync(key),
      // A failed read of the newer key must not lose the main setting.
      SecureStore.getItemAsync(repliesKey).catch(() => null),
    ]);
    // A second startup read must not overwrite a change made in Settings.
    if (!useHapticsPreference.getState().ready) {
      useHapticsPreference.setState({
        enabled: stored === null || stored === "true",
        replies: storedReplies === null || storedReplies === "true",
      });
    }
  } finally {
    useHapticsPreference.setState({ ready: true });
  }
}

export async function saveHapticsPreference(setting: HapticsSetting, value: boolean): Promise<void> {
  if (!useHapticsPreference.getState().ready || useHapticsPreference.getState().saving) return;
  // Apply immediately, including when storage fails. Settings offers a retry.
  useHapticsPreference.setState(
    setting === "enabled" ? { enabled: value, saving: true } : { replies: value, saving: true },
  );
  try {
    await SecureStore.setItemAsync(setting === "enabled" ? key : repliesKey, String(value));
  } finally {
    useHapticsPreference.setState({ saving: false });
  }
}
