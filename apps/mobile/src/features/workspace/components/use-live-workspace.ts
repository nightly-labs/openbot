import type { BrowserTakeoverRequest } from "@openbot/contracts/ipc";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { agentBrowserTab, agentBrowserTabs, type MobileBrowserTabs } from "@/features/browser/model/browser-tabs";
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

/**
 * The browser tab this agent works in on its host, or null. `threadId` is the agent's thread, when the
 * phone knows it. Re-renders only when that tab changes.
 */
export function useAgentBrowserTab(
  serverId: string,
  agentId: string,
  preferredTabId?: string,
  threadId: string | null = null,
) {
  const { liveState } = useMobileWorkspace();
  const select = useCallback(
    () => agentBrowserTab(liveState.get().browserTabs[serverId], agentId, preferredTabId, threadId),
    [liveState, serverId, agentId, preferredTabId, threadId],
  );
  return useSyncExternalStore(liveState.subscribe, select);
}

/** All of this agent's browser tabs on its host, oldest first. Re-renders only when the host's tab list changes. */
export function useAgentBrowserTabs(serverId: string, agentId: string, threadId: string | null = null) {
  const { liveState } = useMobileWorkspace();
  const select = useCallback(
    (): MobileBrowserTabs | undefined => liveState.get().browserTabs[serverId],
    [liveState, serverId],
  );
  const state = useSyncExternalStore(liveState.subscribe, select);
  return useMemo(() => agentBrowserTabs(state, agentId, threadId), [state, agentId, threadId]);
}
