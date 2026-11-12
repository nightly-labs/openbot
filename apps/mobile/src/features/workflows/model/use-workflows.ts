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

/** The saved versions of a workflow, newest first. */
export function useWorkflowVersions(serverId: string, workflowId: string) {
  const queryScope = useQueryScope();
  const { loadWorkflowVersions } = useMobileWorkspaceActions();
  const { ready } = useWorkflowsAvailable(serverId);
  return useQuery({
    queryKey: queryKeys.workflow(queryScope, serverId, workflowId, "versions"),
    enabled: ready && Boolean(workflowId),
    retry: false,
    queryFn: () => loadWorkflowVersions(workflowId, serverId),
  });
}

/** The graph of one saved version. A version does not change, so the read stays. */
export function useWorkflowVersionGraph(serverId: string, workflowId: string, versionId: string) {
  const queryScope = useQueryScope();
  const { loadWorkflowVersionGraph } = useMobileWorkspaceActions();
  const { ready } = useWorkflowsAvailable(serverId);
  return useQuery({
    queryKey: queryKeys.workflowVersionGraph(queryScope, serverId, workflowId, versionId),
    enabled: ready && Boolean(workflowId) && Boolean(versionId),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () => loadWorkflowVersionGraph({ workflowId, versionId }, serverId),
  });
}

/** The host runs GitHub triggers and outputs (`workflows-github-v1`). */
export function useWorkflowGitHubSupported(serverId: string) {
  return useMobileWorkspaceSelector((current) => current.canUseWorkflowGitHub(serverId));
}

/** The host runs Telegram and Slack triggers and outputs that a joined owner or admin changes (`workflows-chats-v1`). */
export function useWorkflowChatsSupported(serverId: string) {
  return useMobileWorkspaceSelector((current) => current.canUseWorkflowChats(serverId));
}

/**
 * The host's Telegram chats and Slack workspaces with their channels, from the routine-results options.
 * The host gives them only to an owner or admin.
 */
export function useWorkflowChats(serverId: string, enabled: boolean) {
  const queryScope = useQueryScope();
  const { loadRoutineResultOptions } = useMobileWorkspaceActions();
  const { ready } = useWorkflowsAvailable(serverId);
  const supported = useWorkflowChatsSupported(serverId);
  return useQuery({
    queryKey: queryKeys.workflowChats(queryScope, serverId),
    enabled: enabled && ready && supported,
    retry: false,
    queryFn: () => loadRoutineResultOptions(serverId),
  });
}

/**
 * The events of the GitHub triggers of a workflow, newest first, and the items of their runs. Each
 * `workflows-changed` reads them again, as a new event changes the workflow.
 */
export function useWorkflowGitHubHistory(serverId: string, workflowId: string, enabled = true) {
  const queryScope = useQueryScope();
  const { loadWorkflowGitHubHistory } = useMobileWorkspaceActions();
  const { ready } = useWorkflowsAvailable(serverId);
  const supported = useWorkflowGitHubSupported(serverId);
  return useQuery({
    queryKey: queryKeys.workflow(queryScope, serverId, workflowId, "github-history"),
    enabled: enabled && ready && supported && Boolean(workflowId),
    retry: false,
    queryFn: () => loadWorkflowGitHubHistory(workflowId, serverId),
  });
}

/** The repositories of the host's GitHub connection. The host gives them only to an owner or admin. */
export function useWorkflowGitHubCatalog(serverId: string, enabled: boolean) {
  const queryScope = useQueryScope();
  const { loadWorkflowGitHubCatalog } = useMobileWorkspaceActions();
  const { ready } = useWorkflowsAvailable(serverId);
  const supported = useWorkflowGitHubSupported(serverId);
  return useQuery({
    queryKey: queryKeys.workflowGitHubCatalog(queryScope, serverId),
    enabled: enabled && ready && supported,
    retry: false,
    queryFn: () => loadWorkflowGitHubCatalog(serverId),
  });
}

/** The labels and people of one repository, for an owner or admin. */
export function useWorkflowGitHubOptions(serverId: string, repository: string, enabled: boolean) {
  const queryScope = useQueryScope();
  const { loadWorkflowGitHubOptions } = useMobileWorkspaceActions();
  const { ready } = useWorkflowsAvailable(serverId);
  const supported = useWorkflowGitHubSupported(serverId);
  return useQuery({
    queryKey: queryKeys.workflowGitHubOptions(queryScope, serverId, repository),
    enabled: enabled && ready && supported && Boolean(repository),
    retry: false,
    queryFn: () => loadWorkflowGitHubOptions(repository, serverId),
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
