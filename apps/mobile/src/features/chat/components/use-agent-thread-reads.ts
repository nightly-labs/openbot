import type { AgentTask, AgentTaskReadState } from "@openbot/contracts/ipc";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

const NO_READS: ReadonlyMap<string, AgentTaskReadState> = new Map();

function useThreadReadsEnabled(serverId: string): boolean {
  return useMobileWorkspaceSelector(
    (current) =>
      current.servers.some((server) => server.id === serverId && server.state === "online") &&
      current.canReadThreads(serverId),
  );
}

/**
 * The person's read mark of each open thread of one agent, by task id. The host keeps the marks for
 * the member, so a thread that the person read on desktop is read here too. Empty on a host without
 * `agent-thread-reads-v1`. The host sends no event when a mark moves: the marks load again when the
 * thread list changes and when a screen that shows them opens.
 */
export function useAgentThreadReads(serverId: string, agentId: string): ReadonlyMap<string, AgentTaskReadState> {
  const queryScope = useQueryScope();
  const workspace = useMobileWorkspaceReader();
  const enabled = useThreadReadsEnabled(serverId);
  const reads = useQuery({
    queryKey: queryKeys.agentThreadReads(queryScope, serverId, agentId),
    enabled,
    retry: false,
    staleTime: 0,
    queryFn: () => workspace().loadAgentThreadReads(agentId, serverId),
  }).data;
  return useMemo(() => (reads ? new Map(reads.map((read) => [read.taskId, read])) : NO_READS), [reads]);
}

/**
 * Moves the person's read mark of a thread to `messageId` while the person sees the thread. The
 * member's other devices read the mark. `version` is the thread's last change: the host keeps the
 * mark where it is for a message that it has not saved yet, such as one that streams, so the mark
 * goes again when the turn ends. A failure keeps the old mark: the next change moves it.
 */
export function useMarkThreadRead(
  serverId: string,
  agentId: string,
  taskId: string | null,
  messageId: string | null,
  version: string | null,
): void {
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const workspace = useMobileWorkspaceReader();
  const enabled = useThreadReadsEnabled(serverId);
  const marked = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !taskId || !messageId) return;
    const mark = `${taskId}:${messageId}:${version}`;
    if (marked.current === mark) return;
    marked.current = mark;
    workspace()
      .markAgentThreadRead({ agentId, taskId, throughMessageId: messageId }, serverId)
      .then((state) => {
        const key = queryKeys.agentThreadReads(queryScope, serverId, agentId);
        queryClient.setQueryData<AgentTaskReadState[]>(
          key,
          (stored) => stored?.map((read) => (read.taskId === state.taskId ? state : read)) ?? stored,
        );
        // A read of the marks that started before this mark landed holds the old mark. Read again.
        void queryClient.invalidateQueries({ queryKey: key });
      })
      .catch(() => {
        if (marked.current === mark) marked.current = null;
      });
  }, [enabled, taskId, messageId, version, agentId, serverId, queryScope, queryClient, workspace]);
}

/**
 * The person's read mark of each open thread in `tasks`, by task id. Null on a host without
 * `agent-thread-reads-v1`. It reads the marks of each agent that has an open thread.
 */
export function useServerThreadReads(
  serverId: string,
  tasks: readonly AgentTask[],
): ReadonlyMap<string, AgentTaskReadState> | null {
  const queryScope = useQueryScope();
  const workspace = useMobileWorkspaceReader();
  const enabled = useThreadReadsEnabled(serverId);
  const agentIds = useMemo(
    () => [...new Set(tasks.filter((task) => task.state !== "closed").map((task) => task.agentId))].sort(),
    [tasks],
  );
  return useQueries({
    queries: agentIds.map((agentId) => ({
      queryKey: queryKeys.agentThreadReads(queryScope, serverId, agentId),
      enabled,
      retry: false,
      queryFn: () => workspace().loadAgentThreadReads(agentId, serverId),
    })),
    combine: (results) =>
      enabled ? new Map(results.flatMap((result) => result.data ?? []).map((read) => [read.taskId, read])) : null,
  });
}
