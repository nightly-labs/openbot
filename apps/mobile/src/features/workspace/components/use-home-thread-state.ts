import type { AgentTasksSnapshot } from "@openbot/contracts/ipc";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useAgentThreadUnreadCounts } from "@/features/chat/components/use-agent-thread-reads";
import {
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

function isOnline(servers: readonly { id: string; state: string }[], serverId: string) {
  return servers.some((server) => server.id === serverId && server.state === "online");
}

/**
 * Loads what the home list shows of the side threads of the agents on `serverId`, as the agents' own
 * marks: the read marks of each agent's open threads, so an agent with an unread thread shows as
 * unread, and, when the server comes back, the list of each agent with a thread that ran, so that the
 * agent does not stay at work. The task events keep both current while the server is there.
 */
export function useHomeThreadState(serverId: string, agentIds: readonly string[]): void {
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const workspace = useMobileWorkspaceReader();
  const tasksEnabled = useMobileWorkspaceSelector(
    (current) => isOnline(current.servers, serverId) && current.canUseTasks(serverId),
  );

  useAgentThreadUnreadCounts(serverId, agentIds);

  // A running thread can end while the server is away, and the list would show its agent at work.
  useEffect(() => {
    if (!tasksEnabled) return;
    const lists = queryClient.getQueriesData<AgentTasksSnapshot>({
      queryKey: [...queryKeys.serverTasks(queryScope, serverId), "agent"],
    });
    for (const [, snapshot] of lists) {
      if (!snapshot?.tasks.some((task) => task.state === "running")) continue;
      const { agentId } = snapshot;
      void queryClient
        .fetchQuery({
          queryKey: queryKeys.agentTasks(queryScope, serverId, agentId),
          queryFn: () => workspace().loadAgentTasks(agentId, serverId),
          staleTime: 0,
        })
        .catch(() => undefined);
    }
  }, [tasksEnabled, serverId, queryScope, queryClient, workspace]);
}
