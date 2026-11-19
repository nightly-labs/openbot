import type { ConversationMessage } from "@openbot/contracts/ipc";
import { useCallback, useSyncExternalStore } from "react";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function useConversationMessage(agentId: string, messageId: string): ConversationMessage | undefined {
  return useAgentConversation(agentId)?.messages.find((message) => message.id === messageId);
}

export function useAgentConversation(agentId: string) {
  const conversationStore = useMobileWorkspaceSelector((current) => current.conversationStore);
  const subscribe = useCallback(
    (notify: () => void) => conversationStore.subscribe(agentId, notify),
    [agentId, conversationStore],
  );
  return useSyncExternalStore(
    subscribe,
    useCallback(() => conversationStore.get(agentId), [agentId, conversationStore]),
  );
}
