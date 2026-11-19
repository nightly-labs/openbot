import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { create } from "zustand";
import { accountScope } from "@/shared/lib/account-scope";
import type { RecentAgent } from "./quick-action-items";

export function recentAgentsKey(apiUrl: string, userId: string): string {
  return `openbot.recent-agents.v1.${accountScope(apiUrl, userId)}`;
}

export function decodeRecentAgents(stored: string | null): RecentAgent[] {
  if (!stored) return [];
  try {
    const value = JSON.parse(stored);
    if (!Array.isArray(value)) return [];
    return value.flatMap((item: unknown) =>
      isDynamicRecord(item) && isString(item.serverId) && isString(item.agentId) && isString(item.name)
        ? [{ serverId: item.serverId, agentId: item.agentId, name: item.name }]
        : [],
    );
  } catch {
    return [];
  }
}

export const useOpenedChat = create<{ agentId: string | null }>(() => ({ agentId: null }));

export function noteChatOpened(agentId: string): void {
  useOpenedChat.setState({ agentId });
}
