import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import type { MobileAgentActivities, MobileAgentWait } from "@/features/workspace/model/agent-activity";
import { showsOnline } from "@/features/workspace/model/server-status";
import type { TurnStepLines } from "@/features/workspace/model/turn-step-lines";
import { selectLiveState } from "./use-live-workspace";

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

/** What this agent waits on from the user, or undefined. Re-renders only when that changes. */
export function useAgentWaitReason(agentId: string) {
  const activity = useAgentActivity(agentId);
  return activity?.phase === "waiting" ? activity.reason : undefined;
}

/**
 * The agents of the active server that wait for the user. The selector returns a sorted key, so
 * activity that keeps the same agents waiting does not re-render the list.
 */
export function useWaitingAgentIds(): ReadonlySet<string> {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const online = useMobileWorkspaceSelector((workspace) => showsOnline(workspace.activeServer));
  const serverId = useMobileWorkspaceSelector((workspace) => workspace.activeServer.id);
  const select = useCallback(() => {
    if (!online) return "";
    const activities = liveState.get().activityByServer[serverId] ?? {};
    return Object.keys(activities)
      .filter((agentId) => activities[agentId]?.phase === "waiting")
      .sort()
      .join("\n");
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
