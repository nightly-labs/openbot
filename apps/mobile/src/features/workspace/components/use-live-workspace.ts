import type { BrowserTakeoverRequest } from "@openbot/contracts/ipc";
import { useCallback, useSyncExternalStore } from "react";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";

const NO_REQUESTS: BrowserTakeoverRequest[] = [];

/** Re-renders only when this agent's unread state changes. */
export function useAgentUnread(agentId: string) {
  const { liveState } = useMobileWorkspace();
  const select = useCallback(() => liveState.get().unreadAgentIds.includes(agentId), [liveState, agentId]);
  return useSyncExternalStore(liveState.subscribe, select);
}

/** The browser takeovers this server waits on. Re-renders only when that list changes. */
export function useBrowserRequests(serverId: string) {
  const { liveState } = useMobileWorkspace();
  const select = useCallback(() => liveState.get().browserRequests[serverId] ?? NO_REQUESTS, [liveState, serverId]);
  return useSyncExternalStore(liveState.subscribe, select);
}
