import {
  type AgentAccessLevels,
  LOCAL_SERVER_ID,
  type WorkflowDetail,
  type WorkflowGitHubHistory,
  type WorkflowSummary,
  type WorkflowVersion,
} from "@openbot/contracts/ipc";
import type { WorkflowRunView } from "@openbot/ui/features/workflows/workflow-run-view";

export interface StoredWorkflow {
  detail: WorkflowDetail;
  runs: WorkflowRunView;
  versions: readonly WorkflowVersion[];
  github: WorkflowGitHubHistory;
}

export interface HostCache {
  library: readonly WorkflowSummary[];
  workflows: Map<string, StoredWorkflow>;
  last?: string;
  levels?: AgentAccessLevels | null;
}

export const workflowCache = new Map<string, HostCache>();
let cacheAccount: string | null = null;

export function keepCachedWorkflows(accountId: string | null, keepServerIds: readonly string[] = []): void {
  if (accountId === null || accountId !== cacheAccount) {
    workflowCache.clear();
    cacheAccount = accountId;
    return;
  }
  const kept = new Set([LOCAL_SERVER_ID, ...keepServerIds]);
  for (const serverId of workflowCache.keys()) if (!kept.has(serverId)) workflowCache.delete(serverId);
}

export function deleteCachedWorkflows(serverId: string): void {
  workflowCache.delete(serverId);
}
