import type { WorkflowRunDetail } from "@openbot/contracts/ipc";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

function useWorkflowsAvailable(serverId: string) {
  const online = useMobileWorkspaceSelector((current) =>
    current.servers.some((server) => server.id === serverId && server.state === "online"),
  );
  const supported = useMobileWorkspaceSelector((current) => current.canUseWorkflows(serverId));
  return { online, supported, ready: online && supported };
}

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

export function useWorkflowRunHistory(serverId: string, workflowId: string) {
  const queryScope = useQueryScope();
  const { loadWorkflowRuns } = useMobileWorkspaceActions();
  const { ready } = useWorkflowsAvailable(serverId);
  return useInfiniteQuery({
    queryKey: queryKeys.workflow(queryScope, serverId, workflowId, "history"),
    enabled: ready && Boolean(workflowId),
    retry: false,
    initialPageParam: "",
    queryFn: ({ pageParam }) => loadWorkflowRuns(workflowId, serverId, pageParam || undefined),
    getNextPageParam: (page) => page.nextBefore ?? undefined,
  });
}

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

export function useWorkflowGitHubSupported(serverId: string) {
  return useMobileWorkspaceSelector((current) => current.canUseWorkflowGitHub(serverId));
}

export function useWorkflowChatsSupported(serverId: string) {
  return useMobileWorkspaceSelector((current) => current.canUseWorkflowChats(serverId));
}

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
