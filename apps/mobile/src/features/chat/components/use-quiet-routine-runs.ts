import { ROUTINE_RUNS_QUIET_LIMIT } from "@openbot/contracts/team-protocol/routine-runs-quiet-v1";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import type { ChatMessage } from "@/features/chat/model/chat-messages";
import {
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

const NO_RUNS: ReadonlySet<string> = new Set();

/**
 * The completed routine runs of an agent's chat that ended with nothing to report, on an online host
 * with `routine-runs-quiet-v1`. The chat asks about its newest completed runs, as many as one read takes.
 * The labels of the last answer stay while a read for a new run loads.
 */
export function useQuietRoutineRuns(
  serverId: string,
  agentId: string | null,
  messages: readonly ChatMessage[],
): ReadonlySet<string> {
  const queryScope = useQueryScope();
  const workspace = useMobileWorkspaceReader();
  const enabled = useMobileWorkspaceSelector(
    (current) =>
      current.servers.some((server) => server.id === serverId && server.state === "online") &&
      current.canReadQuietRoutineRuns(serverId),
  );
  const runIds = useMemo(
    () =>
      messages
        .flatMap((message) =>
          message.kind === "routine" && message.event === "succeeded" && message.runId ? [message.runId] : [],
        )
        .slice(-ROUTINE_RUNS_QUIET_LIMIT)
        .sort(),
    [messages],
  );
  const query = useQuery({
    queryKey: queryKeys.quietRoutineRuns(queryScope, serverId, agentId ?? "", runIds),
    enabled: enabled && agentId !== null && runIds.length > 0,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    placeholderData: keepPreviousData,
    queryFn: () => (agentId ? workspace().loadQuietRoutineRuns(agentId, runIds, serverId) : Promise.resolve([])),
  });
  return useMemo(() => (enabled && query.data ? new Set(query.data) : NO_RUNS), [enabled, query.data]);
}
