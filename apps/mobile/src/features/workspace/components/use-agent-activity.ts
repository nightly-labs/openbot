import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";

export function useAgentActivity(agentId: string) {
  const { liveState, activeServer } = useMobileWorkspace();
  const online = activeServer.state === "online";
  const serverId = activeServer.id;
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
  const { liveState, activeServer } = useMobileWorkspace();
  const online = activeServer.state === "online";
  const serverId = activeServer.id;
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
