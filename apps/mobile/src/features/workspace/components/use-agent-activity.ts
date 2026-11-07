import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";
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
import { agentThreadWaitReason } from "@/features/workspace/model/thread-waits";
import type { TurnStepLines } from "@/features/workspace/model/turn-step-lines";
import { selectLiveState, useAgentUnread, useAgentUnreadCount } from "./use-live-workspace";

export function useAgentActivity(agentId: string) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const online = useMobileWorkspaceSelector((workspace) => showsOnline(workspace.activeServer));
  const serverId = useMobileWorkspaceSelector((workspace) => workspace.activeServer.id);
  const select = useCallback(
    () => (online ? liveState.get().activityByServer[serverId]?.[agentId] : undefined),
    [liveState, online, serverId, agentId],
  );
  return useSyncExternalStore(liveState.subscribe, select);
}

/** What the side threads of this agent wait on from the user, or undefined. */
function useAgentThreadWaitReason(agentId: string) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const online = useMobileWorkspaceSelector((workspace) => showsOnline(workspace.activeServer));
  const serverId = useMobileWorkspaceSelector((workspace) => workspace.activeServer.id);
  const select = useCallback(
    () => (online ? agentThreadWaitReason(liveState.get().threadWaitsByServer[serverId] ?? [], agentId) : undefined),
    [liveState, online, serverId, agentId],
  );
  return useSyncExternalStore(liveState.subscribe, select);
}

/**
 * True while a side thread of this agent runs a turn, as the task list that the phone holds says.
 * It reads the cached list only: the task events keep it current, and the home list reads the lists
 * of running threads again after the server was away.
 */
function useAgentThreadRunning(agentId: string) {
  const queryScope = useQueryScope();
  const workspace = useMobileWorkspaceReader();
  const online = useMobileWorkspaceSelector((current) => showsOnline(current.activeServer));
  const serverId = useMobileWorkspaceSelector((current) => current.activeServer.id);
  // Disabled with the real query function, not `skipToken`: each observer writes its options into
  // the shared query, and the thread list's later invalidation of the key fetches with them.
  const running = useQuery({
    queryKey: queryKeys.agentTasks(queryScope, serverId, agentId),
    enabled: false,
    retry: false,
    queryFn: () => workspace().loadAgentTasks(agentId, serverId),
    select: (snapshot) => snapshot.tasks.some((task) => task.state === "running"),
  }).data;
  return online && running === true;
}

/**
 * The activity that the home list shows on an agent: the activity of its own chat, with the work of
 * its side threads. A wait wins over work, so an agent that needs the user says so.
 */
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

/** What this agent or one of its side threads waits on from the user, or undefined. */
export function useAgentListWaitReason(agentId: string) {
  const activity = useAgentListActivity(agentId);
  return activity?.phase === "waiting" ? activity.reason : undefined;
}

/**
 * The unread messages that the home list shows on this agent, as the desktop counts them: those of its
 * own chat and of its side threads. 0 when the person read them all. An unread chat with no count from
 * the host counts as one.
 */
export function useAgentListUnreadCount(agentId: string): number {
  const serverId = useMobileWorkspaceSelector((workspace) => workspace.activeServer.id);
  const own = useAgentUnread(agentId);
  const ownCount = useAgentUnreadCount(agentId);
  const threads = useAgentThreadUnread(serverId, agentId);
  return (own ? Math.max(1, ownCount) : 0) + threads;
}

/**
 * The agents of the active server that wait for the user, in their own chat or in a side thread. The
 * selector returns a sorted key, so activity that keeps the same agents waiting does not re-render the list.
 */
export function useWaitingAgentIds(): ReadonlySet<string> {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const online = useMobileWorkspaceSelector((workspace) => showsOnline(workspace.activeServer));
  const serverId = useMobileWorkspaceSelector((workspace) => workspace.activeServer.id);
  const select = useCallback(() => {
    if (!online) return "";
    const { activityByServer, threadWaitsByServer } = liveState.get();
    const activities = activityByServer[serverId] ?? {};
    const waiting = new Set(Object.keys(activities).filter((agentId) => activities[agentId]?.phase === "waiting"));
    for (const wait of threadWaitsByServer[serverId] ?? []) if (wait.task) waiting.add(wait.agentId);
    return [...waiting].sort().join("\n");
  }, [liveState, online, serverId]);
  const key = useSyncExternalStore(liveState.subscribe, select);
  return useMemo(() => new Set(key ? key.split("\n") : []), [key]);
}

/**
 * The wait of each agent of a server that waits for the user. The selector returns a key, so
 * activity that does not change a wait does not re-render the consumer.
 */
export function useAgentWaits(serverId: string, online: boolean): Readonly<Record<string, MobileAgentWait>> {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const waits = useCallback(
    () => (online ? agentWaits(liveState.get().activityByServer[serverId] ?? {}) : {}),
    [liveState, online, serverId],
  );
  const select = useCallback(() => JSON.stringify(waits()), [waits]);
  const key = useSyncExternalStore(liveState.subscribe, select);
  // The key changes with every wait, so the waits are read again then.
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

/** The progress lines that this phone got for the newest turns on the server. */
export function useTurnStepLines(serverId: string): TurnStepLines {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const select = useCallback(() => liveState.get().turnLinesByServer[serverId] ?? NO_TURN_LINES, [liveState, serverId]);
  return useSyncExternalStore(liveState.subscribe, select);
}
