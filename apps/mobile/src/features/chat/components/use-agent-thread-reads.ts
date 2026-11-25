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
        void queryClient.invalidateQueries({ queryKey: key });
      })
      .catch(() => {
        if (marked.current === mark) marked.current = null;
      });
  }, [enabled, taskId, messageId, version, agentId, serverId, queryScope, queryClient, workspace]);
}

export function useServerThreadReads(
  serverId: string,
  tasks: readonly AgentTask[],
): { reads: ReadonlyMap<string, AgentTaskReadState> | null; ready: boolean; failed: boolean } {
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
    combine: (results) => ({
      reads: enabled
        ? new Map(results.flatMap((result) => result.data ?? []).map((read) => [read.taskId, read]))
        : null,
      ready: !enabled || results.every((result) => result.data !== undefined || result.isError),
      failed: enabled && results.some((result) => result.isError),
    }),
  });
}

function threadReadsQuery(
  queryScope: ReturnType<typeof useQueryScope>,
  workspace: ReturnType<typeof useMobileWorkspaceReader>,
  serverId: string,
  agentId: string,
  enabled: boolean,
) {
  return {
    queryKey: queryKeys.agentThreadReads(queryScope, serverId, agentId),
    enabled,
    retry: false,
    queryFn: () => workspace().loadAgentThreadReads(agentId, serverId),
  };
}

export function useAgentThreadUnreadCounts(serverId: string, agentIds: readonly string[]): ReadonlyMap<string, number> {
  const queryScope = useQueryScope();
  const workspace = useMobileWorkspaceReader();
  const enabled = useThreadReadsEnabled(serverId);
  const key = useQueries({
    queries: agentIds.map((agentId) => threadReadsQuery(queryScope, workspace, serverId, agentId, enabled)),
    combine: (results) =>
      JSON.stringify(
        results.flatMap((result, index) => {
          const count = (result.data ?? []).reduce((sum, read) => sum + read.unreadCount, 0);
          return enabled && count > 0 ? [[agentIds[index], count]] : [];
        }),
      ),
  });
  return useMemo(() => new Map<string, number>(JSON.parse(key)), [key]);
}

export function useAgentThreadUnread(serverId: string, agentId: string): number {
  const queryScope = useQueryScope();
  const workspace = useMobileWorkspaceReader();
  const enabled = useThreadReadsEnabled(serverId);
  const unread = useQuery({
    ...threadReadsQuery(queryScope, workspace, serverId, agentId, false),
    select: (reads) => reads.reduce((sum, read) => sum + read.unreadCount, 0),
  }).data;
  return enabled ? (unread ?? 0) : 0;
}

export function useThreadOpeningUnread(
  serverId: string,
  agentId: string,
  taskId: string | null,
): { firstUnread: string | null | undefined; keptUnread: boolean } {
  const queryScope = useQueryScope();
  const workspace = useMobileWorkspaceReader();
  const enabled = useThreadReadsEnabled(serverId) && taskId !== null;
  const reads = useQuery({ ...threadReadsQuery(queryScope, workspace, serverId, agentId, enabled), staleTime: 0 });
  const read = reads.data?.find((entry) => entry.taskId === taskId);
  const keptUnread = !reads.data || (read?.unreadCount ?? 0) > 0;
  if (!enabled || reads.isError) return { firstUnread: null, keptUnread: false };
  if (reads.fetchStatus === "fetching") return { firstUnread: undefined, keptUnread };
  return { firstUnread: read?.firstUnreadMessageId ?? null, keptUnread };
}
