import * as SecureStore from "expo-secure-store";
import { useCallback } from "react";
import { create } from "zustand";
import type { ChatMessage } from "@/features/chat/model/chat-messages";
import type { TurnStepsSummary } from "@/features/chat/model/turn-thinking";

export type ChatDetailPreference = { enabled: boolean; ready: boolean; saving: boolean };

function detailPreference(key: string) {
  const store = create<ChatDetailPreference>(() => ({ enabled: true, ready: false, saving: false }));
  const load = async (): Promise<void> => {
    if (store.getState().ready) return;
    try {
      const stored = await SecureStore.getItemAsync(key);
      if (!store.getState().ready) store.setState({ enabled: stored !== "false" });
    } finally {
      store.setState({ ready: true });
    }
  };
  const save = async (enabled: boolean): Promise<void> => {
    if (!store.getState().ready || store.getState().saving) return;
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

export const useThinkingDisplayPreference = thinking.store;
export const saveThinkingDisplayPreference = thinking.save;
export const useSubagentsDisplayPreference = subagents.store;
export const saveSubagentsDisplayPreference = subagents.save;
export const useMemoryChangesDisplayPreference = memoryChanges.store;
export const saveMemoryChangesDisplayPreference = memoryChanges.save;

export async function loadChatDetailPreferences(): Promise<void> {
  await Promise.all([thinking.load(), subagents.load(), memoryChanges.load()]);
}

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
