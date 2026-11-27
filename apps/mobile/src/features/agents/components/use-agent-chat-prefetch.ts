import { useCallback } from "react";
import {
  type MobileWorkspaceContextValue,
  useMobileWorkspaceReader,
} from "@/features/workspace/context/mobile-workspace-context";
import { showsOnline } from "@/features/workspace/model/server-status";

function prefetchAgentChat(
  workspace: Pick<MobileWorkspaceContextValue, "conversationStore" | "loadConversation" | "servers">,
  agentId: string,
  serverId: string,
): boolean {
  if (workspace.conversationStore.isUpToDate(agentId)) return false;
  if (!workspace.servers.some((server) => server.id === serverId && showsOnline(server))) return false;
  void workspace.loadConversation(agentId, serverId).catch(() => undefined);
  return true;
}

export function useAgentChatPrefetch(agentId: string, serverId: string, enabled = true) {
  const workspace = useMobileWorkspaceReader();
  return useCallback(() => {
    if (enabled) prefetchAgentChat(workspace(), agentId, serverId);
  }, [workspace, agentId, serverId, enabled]);
}
