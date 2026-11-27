import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useAgentThreadUnread } from "@/features/chat/components/use-agent-thread-reads";
import {
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import type {
  MobileAgentActivities,
  MobileAgentActivity,
  MobileAgentWait,
} from "@/features/workspace/model/agent-activity";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { showsOnline } from "@/features/workspace/model/server-status";
import { agentThreadWaitReason, type MobileThreadWait } from "@/features/workspace/model/thread-waits";
import type { TurnStepLine, TurnStepLines } from "@/features/workspace/model/turn-step-lines";
import {
  selectLiveState,
  useAgentUnread,
  useAgentUnreadCount,
  useLiveAgentSubscription,
  useLiveKeySubscription,
} from "./use-live-workspace";

export function useAgentActivity(agentId: string) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const online = useMobileWorkspaceSelector((workspace) => showsOnline(workspace.activeServer));
  const serverId = useMobileWorkspaceSelector((workspace) => workspace.activeServer.id);
  const subscribe = useLiveAgentSubscription(liveState, "activityByServer", agentId);
  const select = useCallback(
    () => (online ? liveState.get().activityByServer[serverId]?.[agentId] : undefined),
    [liveState, online, serverId, agentId],
  );
  return useSyncExternalStore(subscribe, select);
}

function useAgentThreadWaitReason(agentId: string) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const online = useMobileWorkspaceSelector((workspace) => showsOnline(workspace.activeServer));
  const serverId = useMobileWorkspaceSelector((workspace) => workspace.activeServer.id);
  const subscribe = useLiveAgentSubscription(liveState, "threadWaitsByServer", agentId);
  const select = useCallback(
    () => (online ? agentThreadWaitReason(liveState.get().threadWaitsByServer[serverId] ?? [], agentId) : undefined),
    [liveState, online, serverId, agentId],
  );
  return useSyncExternalStore(subscribe, select);
}

function useAgentThreadRunning(agentId: string) {
  const queryScope = useQueryScope();
  const workspace = useMobileWorkspaceReader();
  const online = useMobileWorkspaceSelector((current) => showsOnline(current.activeServer));
  const serverId = useMobileWorkspaceSelector((current) => current.activeServer.id);
  const running = useQuery({
    queryKey: queryKeys.agentTasks(queryScope, serverId, agentId),
    enabled: false,
    retry: false,
    queryFn: () => workspace().loadAgentTasks(agentId, serverId),
    select: (snapshot) => snapshot.tasks.some((task) => task.state === "running"),
  }).data;
  return online && running === true;
}

export function useAgentListActivity(agentId: string): MobileAgentActivity | undefined {
  const own = useAgentActivity(agentId);
  const threadWait = useAgentThreadWaitReason(agentId);
  const threadRunning = useAgentThreadRunning(agentId);
  return useMemo((): MobileAgentActivity | undefined => {
    if (own?.phase === "waiting") return own;
    if (threadWait) return { turnId: null, phase: "waiting", detail: null, reason: threadWait };
    if (own) return own;
    return threadRunning ? { turnId: null, phase: "working", detail: null } : undefined;
  }, [own, threadWait, threadRunning]);
}

export function agentListWaitReason(activity: MobileAgentActivity | undefined) {
  return activity?.phase === "waiting" ? activity.reason : undefined;
}

export function useAgentListUnreadCount(agentId: string): number {
  const own = useAgentUnread(agentId);
  const ownCount = useAgentUnreadCount(agentId);
  return own ? Math.max(1, ownCount) : 0;
}

export function useAgentListUnreadThreads(agentId: string): boolean {
  const serverId = useMobileWorkspaceSelector((workspace) => workspace.activeServer.id);
  return useAgentThreadUnread(serverId, agentId) > 0;
}

const NO_AGENT_IDS: ReadonlySet<string> = new Set();

export function waitingAgentIds(
  activities: MobileAgentActivities | undefined,
  waits: readonly MobileThreadWait[] | undefined,
  previous: ReadonlySet<string>,
): ReadonlySet<string> {
  const waiting = new Set<string>();
  for (const agentId in activities) if (activities[agentId]?.phase === "waiting") waiting.add(agentId);
  for (const wait of waits ?? []) if (wait.task) waiting.add(wait.agentId);
  if (waiting.size === 0) return NO_AGENT_IDS;
  if (waiting.size === previous.size && [...waiting].every((agentId) => previous.has(agentId))) return previous;
  return waiting;
}

export function useWaitingAgentIds(): ReadonlySet<string> {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const online = useMobileWorkspaceSelector((workspace) => showsOnline(workspace.activeServer));
  const serverId = useMobileWorkspaceSelector((workspace) => workspace.activeServer.id);
  const subscribe = useLiveKeySubscription(liveState, "activityByServer", "threadWaitsByServer");
  const kept = useRef<{
    activities: MobileAgentActivities | undefined;
    waits: readonly MobileThreadWait[] | undefined;
    ids: ReadonlySet<string>;
  } | null>(null);
  const select = useCallback(() => {
    if (!online) return NO_AGENT_IDS;
    const { activityByServer, threadWaitsByServer } = liveState.get();
    const activities = activityByServer[serverId];
    const waits = threadWaitsByServer[serverId];
    const previous = kept.current;
    if (previous && previous.activities === activities && previous.waits === waits) return previous.ids;
    const ids = waitingAgentIds(activities, waits, previous?.ids ?? NO_AGENT_IDS);
    kept.current = { activities, waits, ids };
    return ids;
  }, [liveState, online, serverId]);
  return useSyncExternalStore(subscribe, select);
}

export function useAgentWaits(serverId: string, online: boolean): Readonly<Record<string, MobileAgentWait>> {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const waits = useCallback(
    () => (online ? agentWaits(liveState.get().activityByServer[serverId] ?? {}) : {}),
    [liveState, online, serverId],
  );
  const select = useCallback(() => JSON.stringify(waits()), [waits]);
  const subscribe = useLiveKeySubscription(liveState, "activityByServer");
  const key = useSyncExternalStore(subscribe, select);
  return useMemo(() => (key === "{}" ? {} : waits()), [key, waits]);
}

function agentWaits(activities: MobileAgentActivities): Record<string, MobileAgentWait> {
  const waits: Record<string, MobileAgentWait> = {};
  for (const agentId of Object.keys(activities).sort()) {
    const activity = activities[agentId];
    if (activity?.phase === "waiting" && activity.reason)
      waits[agentId] = { reason: activity.reason, detail: activity.detail };
  }
  return waits;
}

const NO_TURN_LINES: TurnStepLines = {};

export function useTurnStepLines(serverId: string): TurnStepLines {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const subscribe = useLiveKeySubscription(liveState, "turnLinesByServer");
  const select = useCallback(() => liveState.get().turnLinesByServer[serverId] ?? NO_TURN_LINES, [liveState, serverId]);
  return useSyncExternalStore(subscribe, select);
}

export function useTurnStepLinesOf(serverId: string, turnIds: readonly string[]): TurnStepLines {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const kept = useRef<TurnStepLines>(NO_TURN_LINES);
  const subscribe = useLiveKeySubscription(liveState, "turnLinesByServer");
  const select = useCallback(() => {
    const lines = liveState.get().turnLinesByServer[serverId] ?? NO_TURN_LINES;
    const previous = kept.current;
    const next: Record<string, readonly TurnStepLine[]> = {};
    let count = 0;
    let same = true;
    for (const turnId of turnIds) {
      const turn = lines[turnId];
      if (!turn) continue;
      next[turnId] = turn;
      count += 1;
      if (previous[turnId] !== turn) same = false;
    }
    if (same && count === Object.keys(previous).length) return previous;
    kept.current = count === 0 ? NO_TURN_LINES : next;
    return kept.current;
  }, [liveState, serverId, turnIds]);
  return useSyncExternalStore(subscribe, select);
}
