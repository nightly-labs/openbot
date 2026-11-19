import * as SecureStore from "expo-secure-store";
import { useCallback } from "react";
import { create } from "zustand";
import type { ChatMessage } from "@/features/chat/model/chat-messages";
import type { TurnStepsSummary } from "@/features/chat/model/turn-thinking";

export type ChatDetailPreference = { enabled: boolean; ready: boolean; saving: boolean };

/**
 * A chat detail that the user can hide. It is on until the user turns it off. Each store is exported
 * under a `use` name: the React Compiler keeps the result of a call such as `store.use()` and would
 * not show a change.
 */
function detailPreference(key: string) {
  const store = create<ChatDetailPreference>(() => ({ enabled: true, ready: false, saving: false }));
  const load = async (): Promise<void> => {
    if (store.getState().ready) return;
    try {
      const stored = await SecureStore.getItemAsync(key);
      // A second startup read must not overwrite a change made in Settings.
      if (!store.getState().ready) store.setState({ enabled: stored !== "false" });
    } finally {
      store.setState({ ready: true });
    }
  };
  const save = async (enabled: boolean): Promise<void> => {
    if (!store.getState().ready || store.getState().saving) return;
    // Apply immediately, including when storage fails. Settings shows the error.
    store.setState({ enabled, saving: true });
    try {
      await SecureStore.setItemAsync(key, String(enabled));
    } finally {
      store.setState({ saving: false });
    }
  };
  return { store, load, save };
}

const thinking = detailPreference("openbot.mobile.showThinking.v1");
const subagents = detailPreference("openbot.mobile.showSubagents.v1");
const memoryChanges = detailPreference("openbot.mobile.showMemoryChanges.v1");

/**
 * On: a chat shows the steps row of each finished turn and the agent's current reasoning on its
 * activity row. Off: the chat shows only the replies and a plain activity label. The reasoning level
 * of the agent does not change.
 */
export const useThinkingDisplayPreference = thinking.store;
export const saveThinkingDisplayPreference = thinking.save;
/** On: a chat shows the row of the subagents that a turn started. */
export const useSubagentsDisplayPreference = subagents.store;
export const saveSubagentsDisplayPreference = subagents.save;
/** On: a chat shows the row of the memories that a turn saved. */
export const useMemoryChangesDisplayPreference = memoryChanges.store;
export const saveMemoryChangesDisplayPreference = memoryChanges.save;

export async function loadChatDetailPreferences(): Promise<void> {
  await Promise.all([thinking.load(), subagents.load(), memoryChanges.load()]);
}

/**
 * Whether the chat draws a row for a message. A thinking step has a row only with a steps row on it,
 * and the settings can hide the subagents and saved memories rows.
 */
export function useChatRowShown(
  turnSummaries: ReadonlyMap<string, TurnStepsSummary> | undefined,
): (message: ChatMessage) => boolean {
  const showSubagents = useSubagentsDisplayPreference((state) => state.enabled);
  const showMemories = useMemoryChangesDisplayPreference((state) => state.enabled);
  return useCallback(
    (message: ChatMessage) =>
      (message.kind !== "thinking" || Boolean(turnSummaries?.has(message.id))) &&
      !(message.kind === "subagents" && !showSubagents) &&
      !(message.kind === "memory-changes" && !showMemories),
    [turnSummaries, showSubagents, showMemories],
  );
}
