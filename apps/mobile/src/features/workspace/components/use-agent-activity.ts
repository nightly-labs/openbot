import { useCallback, useSyncExternalStore } from "react";
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
