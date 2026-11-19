import { useCallback } from "react";
import type { ChatMessage } from "@/features/chat/model/chat-messages";
import type { TurnStepsSummary } from "@/features/chat/model/turn-thinking";
import { type SwitchPreference, switchPreference } from "./secure-preference";

export type ChatDetailPreference = SwitchPreference;

const thinking = switchPreference("openbot.mobile.showThinking.v1", true);
const subagents = switchPreference("openbot.mobile.showSubagents.v1", true);
const memoryChanges = switchPreference("openbot.mobile.showMemoryChanges.v1", true);

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
