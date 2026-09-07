import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";

export function useAgentActivity(agentId: string) {
  const { activityByServer, activeServer } = useMobileWorkspace();
  return activeServer.state === "online" ? activityByServer[activeServer.id]?.[agentId] : undefined;
}
