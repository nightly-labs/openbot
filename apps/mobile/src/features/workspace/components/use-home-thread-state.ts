import type { AgentTasksSnapshot } from "@openbot/contracts/ipc";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
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
 * agent does not stay at work. The task events keep both current while the server is there. Returns
 * the unread messages of the side threads of each agent; agents without any are left out.
 */
export function useHomeThreadState(serverId: string, agentIds: readonly string[]): ReadonlyMap<string, number> {
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const workspace = useMobileWorkspaceReader();
  const readsEnabled = useMobileWorkspaceSelector(
    (current) => isOnline(current.servers, serverId) && current.canReadThreads(serverId),
  );
  const tasksEnabled = useMobileWorkspaceSelector(
    (current) => isOnline(current.servers, serverId) && current.canUseTasks(serverId),
  );

  // The counts become a string first, so a read that changes no count does not change the map.
  const unreadKey = useQueries({
    queries: agentIds.map((agentId) => ({
      queryKey: queryKeys.agentThreadReads(queryScope, serverId, agentId),
      enabled: readsEnabled,
      retry: false,
      queryFn: () => workspace().loadAgentThreadReads(agentId, serverId),
    })),
    combine: (results) =>
      JSON.stringify(
        results.flatMap((result, index) => {
          const count = (result.data ?? []).reduce((sum, read) => sum + read.unreadCount, 0);
          return readsEnabled && count > 0 ? [[agentIds[index], count]] : [];
        }),
      ),
  });

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

  return useMemo(() => new Map<string, number>(JSON.parse(unreadKey)), [unreadKey]);
}
