import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const key = "openbot.mobile.agent-color-messages.v1";
/** When enabled, the user's messages in an agent chat use that agent's color. */
export const useAgentColorMessages = create<{ enabled: boolean; ready: boolean; saving: boolean }>(() => ({
  enabled: true,
  ready: false,
  saving: false,
}));

export async function loadAgentColorMessages(): Promise<void> {
  if (useAgentColorMessages.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(key);
    // A second startup read must not overwrite a change made in Settings.
    if (!useAgentColorMessages.getState().ready) {
      useAgentColorMessages.setState({ enabled: stored === null || stored === "true" });
    }
  } finally {
    useAgentColorMessages.setState({ ready: true });
  }
}

export async function saveAgentColorMessages(enabled: boolean): Promise<void> {
  if (!useAgentColorMessages.getState().ready || useAgentColorMessages.getState().saving) return;
  // Apply immediately, including when storage fails.
  useAgentColorMessages.setState({ enabled, saving: true });
  try {
    await SecureStore.setItemAsync(key, String(enabled));
  } finally {
    useAgentColorMessages.setState({ saving: false });
  }
}
