import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { remoteHostFingerprint } from "@openbot/team-client";
import { create } from "zustand";
import type { RecentAgent } from "./quick-action-items";

export function recentAgentsKey(apiUrl: string, userId: string): string {
  return `openbot.recent-agents.v1.${remoteHostFingerprint(JSON.stringify([new URL(apiUrl).origin, userId]))}`;
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
