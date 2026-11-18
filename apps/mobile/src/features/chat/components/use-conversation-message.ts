import type { ConversationMessage } from "@openbot/contracts/ipc";
import { useCallback, useSyncExternalStore } from "react";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";

/** The first value of a route parameter. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * One message of an agent's chat, kept current. The chat under a sheet loads the conversation and
 * keeps it current, so the sheet only reads it.
 */
export function useConversationMessage(agentId: string, messageId: string): ConversationMessage | undefined {
  const conversationStore = useMobileWorkspaceSelector((current) => current.conversationStore);
  const subscribe = useCallback(
    (notify: () => void) => conversationStore.subscribe(agentId, notify),
    [agentId, conversationStore],
  );
  const conversation = useSyncExternalStore(
    subscribe,
    useCallback(() => conversationStore.get(agentId), [agentId, conversationStore]),
  );
  return conversation?.messages.find((message) => message.id === messageId);
}
