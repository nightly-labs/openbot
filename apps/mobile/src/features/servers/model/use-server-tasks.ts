import type { AgentTask } from "@openbot/contracts/ipc";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";

export interface ServerTasks {
  agents: MobileAgent[];
  tasks: AgentTask[];
  online: boolean;
  supported: boolean;
  ready: boolean;
  retry: (() => void) | null;
}

export function useServerTasks(serverId: string, options: { agentId?: string; enabled?: boolean } = {}): ServerTasks {
  const { agentId, enabled = true } = options;
  const queryScope = useQueryScope();
  const { loadAgentTasks } = useMobileWorkspaceActions();
  const online = useMobileWorkspaceSelector((current) =>
    current.servers.some((server) => server.id === serverId && server.state === "online"),
  );
  const supported = useMobileWorkspaceSelector((current) => current.canUseTasks(serverId));
  const agents = useMobileWorkspaceSelector((current) => current.agents);
  const hiddenAgents = useMobileWorkspaceSelector((current) =>
    current.activeServer.id === serverId ? current.hiddenAgents : null,
  );
  const serverAgents = useMemo(() => {
    const hiddenIds = hiddenAgents ? new Set(hiddenAgents.map((agent) => agent.id)) : null;
    return agents.filter(
      (agent) => agent.serverId === serverId && !hiddenIds?.has(agent.id) && (!agentId || agent.id === agentId),
    );
  }, [agents, hiddenAgents, serverId, agentId]);
  const lists = useQueries({
    queries: serverAgents.map((agent) => ({
      queryKey: queryKeys.agentTasks(queryScope, serverId, agent.id),
      enabled: enabled && online && supported,
      retry: false,
      queryFn: () => loadAgentTasks(agent.id, serverId),
    })),
  });
  const known = new Set(serverAgents.map((agent) => agent.id));
  const failed = lists.filter((list) => list.isError);
  return {
    agents: serverAgents,
    tasks: lists.flatMap((list) => list.data?.tasks ?? []).filter((task) => known.has(task.agentId)),
    online,
    supported,
    ready: lists.every((list) => list.data !== undefined || list.isError),
    retry:
      failed.length > 0
        ? () => {
            for (const list of failed) void list.refetch();
          }
        : null,
  };
}
