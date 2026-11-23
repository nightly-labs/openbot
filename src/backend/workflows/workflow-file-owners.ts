import {
  STORAGE_LIMITS,
  type StoredFileWorkflow,
  type WorkflowFoldersSnapshot,
  type WorkflowSummary,
} from "@openbot/contracts/ipc";
import type { WorkflowMediaOutput } from "./workflow-run-store";

export interface WorkflowFileOwner {
  workflow: StoredFileWorkflow;
  createdAt: string | null;
}

export interface WorkflowFileOwnerSources {
  outputs: () => readonly WorkflowMediaOutput[];
  workflows: () => readonly Pick<WorkflowSummary, "id" | "title">[];
  folders: (workflowIds: ReadonlySet<string>) => WorkflowFoldersSnapshot;
}

export function workflowFileOwners(sources: WorkflowFileOwnerSources): ReadonlyMap<string, WorkflowFileOwner> {
  const outputs = sources.outputs();
  const owners = new Map<string, WorkflowFileOwner>();
  if (outputs.length === 0) return owners;
  const summaries = sources.workflows();
  const workflowIds = new Set(summaries.map((summary) => summary.id));
  const snapshot = sources.folders(workflowIds);
  const folderById = new Map(snapshot.folders.map((folder) => [folder.id, folder]));
  const workflowById = new Map(
    summaries.map((summary) => {
      const folder = folderById.get(snapshot.placement[summary.id] ?? "");
      const workflow: StoredFileWorkflow = {
        id: summary.id,
        name: summary.title.slice(0, STORAGE_LIMITS.title),
        folder: folder ? { id: folder.id, name: folder.name.slice(0, STORAGE_LIMITS.title) } : null,
      };
      return [summary.id, workflow];
    }),
  );
  for (const output of outputs) {
    if (owners.has(output.attachmentId)) continue;
    const workflow = workflowById.get(output.workflowId);
    if (workflow) owners.set(output.attachmentId, { workflow, createdAt: output.endedAt });
  }
  return owners;
}
