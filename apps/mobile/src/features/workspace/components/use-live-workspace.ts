import type { BrowserTakeoverRequest } from "@openbot/contracts/ipc";
import type { BrowserPermissionRequestState } from "@openbot/contracts/team-protocol/browser-permissions-v1";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { agentBrowserTab, agentBrowserTabs, type MobileBrowserTabs } from "@/features/browser/model/browser-tabs";
import {
  type MobileWorkspaceContextValue,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import type {
  LiveAgentKey,
  LiveWorkspaceState,
  LiveWorkspaceStore,
} from "@/features/workspace/model/live-workspace-store";
import type { PendingApproval } from "@/features/workspace/model/pending-approvals";
import type { MobileThreadWait } from "@/features/workspace/model/thread-waits";

const NO_REQUESTS: BrowserTakeoverRequest[] = [];
const NO_APPROVALS: readonly PendingApproval[] = [];
const NO_WAITS: readonly MobileThreadWait[] = [];
const NO_PERMISSIONS: readonly BrowserPermissionRequestState[] = [];

export function selectLiveState(workspace: MobileWorkspaceContextValue) {
  return workspace.liveState;
}

export function useLiveKeySubscription(
  liveState: LiveWorkspaceStore,
  key: keyof LiveWorkspaceState,
  otherKey?: keyof LiveWorkspaceState,
) {
  return useCallback(
    (listener: () => void) => {
      const stop = liveState.subscribeKey(key, listener);
      const stopOther = otherKey && otherKey !== key ? liveState.subscribeKey(otherKey, listener) : undefined;
      return () => {
        stop();
        stopOther?.();
      };
    },
    [liveState, key, otherKey],
  );
}

export function useLiveAgentSubscription(liveState: LiveWorkspaceStore, key: LiveAgentKey, agentId: string) {
  return useCallback(
    (listener: () => void) => liveState.subscribeAgent(key, agentId, listener),
    [liveState, key, agentId],
  );
}

export function useAgentUnread(agentId: string) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const subscribe = useLiveAgentSubscription(liveState, "unreadAgentIds", agentId);
  const select = useCallback(() => liveState.get().unreadAgentIds.includes(agentId), [liveState, agentId]);
  return useSyncExternalStore(subscribe, select);
}

export function useAgentUnreadCount(agentId: string) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const subscribe = useLiveAgentSubscription(liveState, "unreadCounts", agentId);
  const select = useCallback(() => liveState.get().unreadCounts[agentId] ?? 0, [liveState, agentId]);
  return useSyncExternalStore(subscribe, select);
}

export function useUnreadAgentIds() {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const subscribe = useLiveKeySubscription(liveState, "unreadAgentIds");
  const select = useCallback(() => liveState.get().unreadAgentIds, [liveState]);
  return useSyncExternalStore(subscribe, select);
}

export function useUnreadCounts() {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const subscribe = useLiveKeySubscription(liveState, "unreadCounts");
  const select = useCallback(() => liveState.get().unreadCounts, [liveState]);
  return useSyncExternalStore(subscribe, select);
}

export function useAgentFirstUnreadMessageId(agentId: string) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const subscribe = useLiveAgentSubscription(liveState, "firstUnreadMessageIds", agentId);
  const select = useCallback(() => liveState.get().firstUnreadMessageIds[agentId] ?? null, [liveState, agentId]);
  return useSyncExternalStore(subscribe, select);
}

export function useBrowserRequests(serverId: string) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const subscribe = useLiveKeySubscription(liveState, "browserRequests");
  const select = useCallback(() => liveState.get().browserRequests[serverId] ?? NO_REQUESTS, [liveState, serverId]);
  return useSyncExternalStore(subscribe, select);
}

export function useAgentBrowserTab(
  serverId: string,
  agentId: string,
  preferredTabId?: string,
  threadId: string | null = null,
) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const subscribe = useLiveKeySubscription(liveState, "browserTabs");
  const select = useCallback(
    () => agentBrowserTab(liveState.get().browserTabs[serverId], agentId, preferredTabId, threadId),
    [liveState, serverId, agentId, preferredTabId, threadId],
  );
  return useSyncExternalStore(subscribe, select);
}

export function useAgentBrowserTabs(serverId: string, agentId: string, threadId: string | null = null) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const subscribe = useLiveKeySubscription(liveState, "browserTabs");
  const select = useCallback(
    (): MobileBrowserTabs | undefined => liveState.get().browserTabs[serverId],
    [liveState, serverId],
  );
  const state = useSyncExternalStore(subscribe, select);
  return useMemo(() => agentBrowserTabs(state, agentId, threadId), [state, agentId, threadId]);
}
export function useBrowserPermissionRequest(serverId: string, tabId: string | null) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const subscribe = useLiveKeySubscription(liveState, "browserPermissions");
  const select = useCallback(
    () => liveState.get().browserPermissions[serverId]?.find((request) => request.tabId === tabId),
    [liveState, serverId, tabId],
  );
  return useSyncExternalStore(subscribe, select);
}
export function useBrowserHttpSignIn(serverId: string, tabId: string | null) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const subscribe = useLiveKeySubscription(liveState, "browserHttpSignIns");
  const select = useCallback(
    () => (tabId === null ? undefined : liveState.get().browserHttpSignIns[serverId]?.[tabId]),
    [liveState, serverId, tabId],
  );
  return useSyncExternalStore(subscribe, select);
}
export function useOwnedBrowserPermissionRequests(serverId: string, ownerAgentIds: readonly string[]) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const selectRequests = useCallback(
    () => liveState.get().browserPermissions[serverId] ?? NO_PERMISSIONS,
    [liveState, serverId],
  );
  const selectTabs = useCallback(() => liveState.get().browserTabs[serverId], [liveState, serverId]);
  const subscribeRequests = useLiveKeySubscription(liveState, "browserPermissions");
  const subscribeTabs = useLiveKeySubscription(liveState, "browserTabs");
  const requests = useSyncExternalStore(subscribeRequests, selectRequests);
  const tabs = useSyncExternalStore(subscribeTabs, selectTabs);
  return useMemo(() => {
    if (requests.length === 0 || !tabs) return NO_PERMISSIONS;
    const owned = new Set(
      tabs.tabs.filter((tab) => tab.ownerAgentId && ownerAgentIds.includes(tab.ownerAgentId)).map((tab) => tab.id),
    );
    return requests.filter((request) => owned.has(request.tabId));
  }, [requests, tabs, ownerAgentIds]);
}
export function useBrowserTabsLoaded(serverId: string) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const subscribe = useLiveKeySubscription(liveState, "browserTabs");
  const select = useCallback(() => liveState.get().browserTabs[serverId] !== undefined, [liveState, serverId]);
  return useSyncExternalStore(subscribe, select);
}
export function useApprovalRequests(serverId: string) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const subscribe = useLiveKeySubscription(liveState, "approvalRequests");
  const select = useCallback(() => liveState.get().approvalRequests[serverId] ?? NO_APPROVALS, [liveState, serverId]);
  return useSyncExternalStore(subscribe, select);
}
export function useThreadWaits(serverId: string) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const subscribe = useLiveKeySubscription(liveState, "threadWaitsByServer");
  const select = useCallback(() => liveState.get().threadWaitsByServer[serverId] ?? NO_WAITS, [liveState, serverId]);
  return useSyncExternalStore(subscribe, select);
}
