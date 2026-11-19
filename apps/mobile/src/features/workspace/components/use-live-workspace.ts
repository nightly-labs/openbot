import type { BrowserTakeoverRequest } from "@openbot/contracts/ipc";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { agentBrowserTab, agentBrowserTabs, type MobileBrowserTabs } from "@/features/browser/model/browser-tabs";
import {
  type MobileWorkspaceContextValue,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import type { PendingApproval } from "@/features/workspace/model/pending-approvals";
import type { MobileThreadWait } from "@/features/workspace/model/thread-waits";

const NO_REQUESTS: BrowserTakeoverRequest[] = [];
const NO_APPROVALS: readonly PendingApproval[] = [];
const NO_WAITS: readonly MobileThreadWait[] = [];

export function selectLiveState(workspace: MobileWorkspaceContextValue) {
  return workspace.liveState;
}

export function useAgentUnread(agentId: string) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const select = useCallback(() => liveState.get().unreadAgentIds.includes(agentId), [liveState, agentId]);
  return useSyncExternalStore(liveState.subscribe, select);
}

export function useAgentUnreadCount(agentId: string) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const select = useCallback(() => liveState.get().unreadCounts[agentId] ?? 0, [liveState, agentId]);
  return useSyncExternalStore(liveState.subscribe, select);
}

export function useUnreadAgentIds() {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const select = useCallback(() => liveState.get().unreadAgentIds, [liveState]);
  return useSyncExternalStore(liveState.subscribe, select);
}

export function useUnreadCounts() {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const select = useCallback(() => liveState.get().unreadCounts, [liveState]);
  return useSyncExternalStore(liveState.subscribe, select);
}

export function useAgentFirstUnreadMessageId(agentId: string) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const select = useCallback(() => liveState.get().firstUnreadMessageIds[agentId] ?? null, [liveState, agentId]);
  return useSyncExternalStore(liveState.subscribe, select);
}

export function useBrowserRequests(serverId: string) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const select = useCallback(() => liveState.get().browserRequests[serverId] ?? NO_REQUESTS, [liveState, serverId]);
  return useSyncExternalStore(liveState.subscribe, select);
}

export function useAgentBrowserTab(
  serverId: string,
  agentId: string,
  preferredTabId?: string,
  threadId: string | null = null,
) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const select = useCallback(
    () => agentBrowserTab(liveState.get().browserTabs[serverId], agentId, preferredTabId, threadId),
    [liveState, serverId, agentId, preferredTabId, threadId],
  );
  return useSyncExternalStore(liveState.subscribe, select);
}

export function useAgentBrowserTabs(serverId: string, agentId: string, threadId: string | null = null) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const select = useCallback(
    (): MobileBrowserTabs | undefined => liveState.get().browserTabs[serverId],
    [liveState, serverId],
  );
  const state = useSyncExternalStore(liveState.subscribe, select);
  return useMemo(() => agentBrowserTabs(state, agentId, threadId), [state, agentId, threadId]);
}
export function useBrowserTabsLoaded(serverId: string) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const select = useCallback(() => liveState.get().browserTabs[serverId] !== undefined, [liveState, serverId]);
  return useSyncExternalStore(liveState.subscribe, select);
}
export function useApprovalRequests(serverId: string) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const select = useCallback(() => liveState.get().approvalRequests[serverId] ?? NO_APPROVALS, [liveState, serverId]);
  return useSyncExternalStore(liveState.subscribe, select);
}
export function useThreadWaits(serverId: string) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const select = useCallback(() => liveState.get().threadWaitsByServer[serverId] ?? NO_WAITS, [liveState, serverId]);
  return useSyncExternalStore(liveState.subscribe, select);
}
