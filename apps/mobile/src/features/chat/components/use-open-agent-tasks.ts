import type { AgentTask } from "@openbot/contracts/ipc";
import { isAgentTaskOpen } from "@openbot/team-client/agent-tasks";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

const NO_TASKS: AgentTask[] = [];

/**
 * The open threads of one agent, as the desktop thread list shows them: a thread stays after its
 * turn ends, with its result, until the person archives it. The task events keep the list current.
 * Empty on a host without `agent-tasks-v1`.
 */
export function useOpenAgentTasks(serverId: string, agentId: string): AgentTask[] {
  const queryScope = useQueryScope();
  const workspace = useMobileWorkspaceReader();
  const enabled = useMobileWorkspaceSelector(
    (current) =>
      current.servers.some((server) => server.id === serverId && server.state === "online") &&
      current.canUseTasks(serverId),
  );
  const list = useQuery({
    queryKey: queryKeys.agentTasks(queryScope, serverId, agentId),
    enabled,
    retry: false,
    queryFn: () => workspace().loadAgentTasks(agentId, serverId),
  });
  const tasks = list.data?.tasks;
  // One array while the list stays, so the chat and its thread menu do not draw again.
  return useMemo(() => (tasks?.some(isAgentTaskOpen) ? tasks.filter(isAgentTaskOpen) : NO_TASKS), [tasks]);
}
