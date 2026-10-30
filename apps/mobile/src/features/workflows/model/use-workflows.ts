import type { WorkflowRunDetail } from "@openbot/contracts/ipc";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

/** The server is online and serves `workflows-v1`. */
function useWorkflowsAvailable(serverId: string) {
  const online = useMobileWorkspaceSelector((current) =>
    current.servers.some((server) => server.id === serverId && server.state === "online"),
  );
  const supported = useMobileWorkspaceSelector((current) => current.canUseWorkflows(serverId));
  return { online, supported, ready: online && supported };
}

/**
 * The workflows that the host shows to this member, with the status of each last run. The host sends
 * `workflows-changed` on each run and step change, which reads the list again. A complete list also
 * drops the pins of workflows that are gone. `enabled: false` reads nothing, for a drawer that is closed.
 */
export function useWorkflowList(serverId: string, enabled = true) {
  const queryScope = useQueryScope();
  const { listWorkflows, reconcileWorkflowPins } = useMobileWorkspaceActions();
  const { ready, online, supported } = useWorkflowsAvailable(serverId);
  const list = useQuery({
    queryKey: queryKeys.workflowList(queryScope, serverId),
    enabled: enabled && ready,
    retry: false,
    queryFn: () => listWorkflows(serverId),
  });
  const data = list.data;
  useEffect(() => {
    if (data)
      reconcileWorkflowPins(
        serverId,
        data.map((workflow) => workflow.id),
      );
  }, [data, serverId, reconcileWorkflowPins]);
  return { list, online, supported };
}

export function useWorkflowDetail(serverId: string, workflowId: string) {
  const queryScope = useQueryScope();
  const { loadWorkflow } = useMobileWorkspaceActions();
  const { ready } = useWorkflowsAvailable(serverId);
  return useQuery({
    queryKey: queryKeys.workflow(queryScope, serverId, workflowId, "detail"),
    enabled: ready && Boolean(workflowId),
    retry: false,
    queryFn: () => loadWorkflow(workflowId, serverId),
  });
}

/** The newest runs of a workflow, each with its steps. */
export function useWorkflowRuns(serverId: string, workflowId: string) {
  const queryScope = useQueryScope();
  const { loadWorkflowRuns } = useMobileWorkspaceActions();
  const { ready } = useWorkflowsAvailable(serverId);
  return useQuery({
    queryKey: queryKeys.workflow(queryScope, serverId, workflowId, "runs"),
    enabled: ready && Boolean(workflowId),
    retry: false,
    queryFn: () => loadWorkflowRuns(workflowId, serverId),
  });
}

/** All runs of a workflow, newest first, a page at a time. */
export function useWorkflowRunHistory(serverId: string, workflowId: string) {
  const queryScope = useQueryScope();
  const { loadWorkflowRuns } = useMobileWorkspaceActions();
  const { ready } = useWorkflowsAvailable(serverId);
  return useInfiniteQuery({
    queryKey: queryKeys.workflow(queryScope, serverId, workflowId, "history"),
    enabled: ready && Boolean(workflowId),
    retry: false,
    // An empty cursor asks for the newest runs.
    initialPageParam: "",
    queryFn: ({ pageParam }) => loadWorkflowRuns(workflowId, serverId, pageParam || undefined),
    getNextPageParam: (page) => page.nextBefore ?? undefined,
  });
}

/**
 * One run: from the newest runs when it is there, else its own read. Without `runId`, the newest run,
 * as the drawer opens it from a workflow whose last run needs the person.
 */
export function useWorkflowRun(serverId: string, workflowId: string, runId: string | undefined) {
  const queryScope = useQueryScope();
  const { loadWorkflowRun } = useMobileWorkspaceActions();
  const { ready } = useWorkflowsAvailable(serverId);
  const runs = useWorkflowRuns(serverId, workflowId);
  const page = runs.data?.runs;
  const fromPage: WorkflowRunDetail | undefined = runId ? page?.find((detail) => detail.run.id === runId) : page?.[0];
  const own = useQuery({
    queryKey: queryKeys.workflow(queryScope, serverId, workflowId, "run", runId ?? ""),
    enabled: ready && Boolean(runId) && Boolean(page) && !fromPage,
    retry: false,
    queryFn: () => loadWorkflowRun(runId ?? "", serverId),
  });
  return {
    run: fromPage ?? own.data,
    loading: runs.isPending || (Boolean(runId) && !fromPage && own.isPending),
    error: runs.error ?? own.error,
    refetch: () => {
      void runs.refetch();
      if (runId && !fromPage) void own.refetch();
    },
  };
}
