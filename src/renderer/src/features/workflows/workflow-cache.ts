import {
  type AgentAccessLevels,
  LOCAL_SERVER_ID,
  type WorkflowDetail,
  type WorkflowGitHubHistory,
  type WorkflowSummary,
  type WorkflowVersion,
} from "@openbot/contracts/ipc";
import type { WorkflowRunView } from "@openbot/ui/features/workflows/workflow-run-view";

/** The open workflow as the host has it. */
export interface StoredWorkflow {
  detail: WorkflowDetail;
  runs: WorkflowRunView;
  versions: readonly WorkflowVersion[];
  github: WorkflowGitHubHistory;
}

/** What the canvas of one host read, for as long as this window is open. */
export interface HostCache {
  library: readonly WorkflowSummary[];
  /** The workflows that this window read or saved, by id, the last used last. */
  workflows: Map<string, StoredWorkflow>;
  /** The workflow that the page showed last. */
  last?: string;
  /** The agent access of the account, so that a cached workflow does not open editable for a member. */
  levels?: AgentAccessLevels | null;
}

/**
 * The workflows of each server, by server id. A page that opens again, and a switch to a workflow of
 * the cache, show it at once and then read it again. Each read and each save updates it. Only memory
 * keeps it: the workflows of a joined server stay on the server. This module is small, so that the
 * sign-out path can clear the cache without loading the Workflows page.
 */
export const workflowCache = new Map<string, HostCache>();
/** The account that the cache is for. */
let cacheAccount: string | null = null;

/**
 * Deletes the cached workflows of the joined servers that are not in `keepServerIds`. A sign-out
 * (`accountId` null) or another account deletes all of them.
 */
export function keepCachedWorkflows(accountId: string | null, keepServerIds: readonly string[] = []): void {
  if (accountId === null || accountId !== cacheAccount) {
    workflowCache.clear();
    cacheAccount = accountId;
    return;
  }
  const kept = new Set([LOCAL_SERVER_ID, ...keepServerIds]);
  for (const serverId of workflowCache.keys()) if (!kept.has(serverId)) workflowCache.delete(serverId);
}

/** Deletes the cached workflows of a server that this account can no longer read. */
export function deleteCachedWorkflows(serverId: string): void {
  workflowCache.delete(serverId);
}
