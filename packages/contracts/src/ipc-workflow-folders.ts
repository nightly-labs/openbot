import { isIdentifier } from "./ipc-bounded-values";
import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "./runtime-values";

export const WORKFLOW_FOLDER_LIMITS = { folders: 200, name: 80, placements: 10_000, workflows: 1_000 } as const;

export interface WorkflowFolder {
  id: string;
  name: string;
}

export interface WorkflowFoldersSnapshot {
  revision: number;
  folders: WorkflowFolder[];
  placement: Record<string, string>;
}

export type WorkflowFolderAction =
  | { type: "create"; id: string; name: string; workflowIds?: string[] }
  | { type: "rename"; folderId: string; name: string }
  | { type: "delete"; folderId: string }
  | { type: "place"; workflowIds: string[]; folderId: string | null };

export interface WorkflowFolderContext {
  workflowIds: Pick<ReadonlySet<string>, "has">;
}

export type WorkflowFolderRefusalReason =
  | "name"
  | "folder-limit"
  | "placement-limit"
  | "unknown-folder"
  | "unknown-workflow"
  | "taken-id";

export class WorkflowFolderRefusal extends Error {
  readonly reason: WorkflowFolderRefusalReason;

  constructor(reason: WorkflowFolderRefusalReason) {
    super(`Workflow folder change refused: ${reason}.`);
    this.name = "WorkflowFolderRefusal";
    this.reason = reason;
  }
}

export const EMPTY_WORKFLOW_FOLDERS: WorkflowFoldersSnapshot = { revision: 0, folders: [], placement: {} };

function refuse(reason: WorkflowFolderRefusalReason): never {
  throw new WorkflowFolderRefusal(reason);
}

export function workflowFolderName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > WORKFLOW_FOLDER_LIMITS.name) refuse("name");
  return trimmed;
}

export function workflowFolderActionWorkflowIds(action: WorkflowFolderAction): readonly string[] {
  if (action.type === "place") return action.workflowIds;
  if (action.type === "create") return action.workflowIds ?? [];
  return [];
}

export function prunedWorkflowFolders(
  snapshot: WorkflowFoldersSnapshot,
  workflowIds: Pick<ReadonlySet<string>, "has">,
): WorkflowFoldersSnapshot {
  const entries = Object.entries(snapshot.placement);
  const kept = entries.filter(([workflowId]) => workflowIds.has(workflowId));
  return kept.length === entries.length ? snapshot : { ...snapshot, placement: Object.fromEntries(kept) };
}

function requireFolder(snapshot: WorkflowFoldersSnapshot, folderId: string): WorkflowFolder {
  return snapshot.folders.find((folder) => folder.id === folderId) ?? refuse("unknown-folder");
}

function placed(
  placement: Record<string, string>,
  workflowIds: readonly string[],
  folderId: string,
  context: WorkflowFolderContext,
): Record<string, string> {
  if (workflowIds.length > WORKFLOW_FOLDER_LIMITS.workflows) refuse("placement-limit");
  const next = { ...placement };
  for (const workflowId of new Set(workflowIds)) {
    if (!context.workflowIds.has(workflowId)) refuse("unknown-workflow");
    next[workflowId] = folderId;
  }
  if (Object.keys(next).length > WORKFLOW_FOLDER_LIMITS.placements) refuse("placement-limit");
  return next;
}

function samePlacement(left: Record<string, string>, right: Record<string, string>): boolean {
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length && keys.every((workflowId) => left[workflowId] === right[workflowId])
  );
}

export function applyWorkflowFolderAction(
  current: WorkflowFoldersSnapshot,
  action: WorkflowFolderAction,
  context: WorkflowFolderContext,
): WorkflowFoldersSnapshot {
  const revision = current.revision + 1;
  switch (action.type) {
    case "create": {
      if (current.folders.length >= WORKFLOW_FOLDER_LIMITS.folders) refuse("folder-limit");
      if (current.folders.some((folder) => folder.id === action.id)) refuse("taken-id");
      const folder: WorkflowFolder = { id: action.id, name: workflowFolderName(action.name) };
      return {
        revision,
        folders: [...current.folders, folder],
        placement: action.workflowIds
          ? placed(current.placement, action.workflowIds, folder.id, context)
          : current.placement,
      };
    }
    case "rename": {
      const folder = requireFolder(current, action.folderId);
      const name = workflowFolderName(action.name);
      if (name === folder.name) return current;
      return {
        ...current,
        revision,
        folders: current.folders.map((candidate) => (candidate.id === folder.id ? { ...candidate, name } : candidate)),
      };
    }
    case "delete": {
      requireFolder(current, action.folderId);
      return {
        revision,
        folders: current.folders.filter((folder) => folder.id !== action.folderId),
        placement: Object.fromEntries(
          Object.entries(current.placement).filter(([, folderId]) => folderId !== action.folderId),
        ),
      };
    }
    case "place": {
      let placement: Record<string, string>;
      if (action.folderId === null) {
        if (action.workflowIds.length > WORKFLOW_FOLDER_LIMITS.workflows) refuse("placement-limit");
        placement = { ...current.placement };
        for (const workflowId of action.workflowIds) delete placement[workflowId];
      } else {
        requireFolder(current, action.folderId);
        placement = placed(current.placement, action.workflowIds, action.folderId, context);
      }
      return samePlacement(placement, current.placement) ? current : { ...current, revision, placement };
    }
  }
}

function invalid(label: string): never {
  throw new Error(`Invalid ${label}.`);
}

function identifier(value: unknown, label: string): string {
  if (!isIdentifier(value)) invalid(label);
  return value;
}

function folderName(value: unknown): string {
  if (!isString(value) || value.length === 0 || value.length > WORKFLOW_FOLDER_LIMITS.name)
    invalid("workflow folder name");
  return value;
}

function workflowIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > WORKFLOW_FOLDER_LIMITS.workflows) invalid("workflow folder workflows");
  return value.map((workflowId) => identifier(workflowId, "workflow folder workflow"));
}

function decodeFolder(value: unknown): WorkflowFolder {
  if (!isDynamicRecord(value)) invalid("workflow folder");
  return { id: identifier(value.id, "workflow folder"), name: folderName(value.name) };
}

function decodePlacement(value: unknown): Record<string, string> {
  if (!isDynamicRecord(value)) invalid("workflow folder placement");
  const entries = Object.entries(value);
  if (entries.length > WORKFLOW_FOLDER_LIMITS.placements) invalid("workflow folder placement");
  return Object.fromEntries(
    entries.map(([workflowId, folderId]) => [
      identifier(workflowId, "workflow folder workflow"),
      identifier(folderId, "workflow folder"),
    ]),
  );
}

export function decodeWorkflowFoldersSnapshot(value: unknown): WorkflowFoldersSnapshot {
  if (!isDynamicRecord(value)) invalid("workflow folders");
  if (!isNumber(value.revision) || !Number.isSafeInteger(value.revision) || value.revision < 0)
    invalid("workflow folders revision");
  if (!Array.isArray(value.folders) || value.folders.length > WORKFLOW_FOLDER_LIMITS.folders)
    invalid("workflow folders");
  const folders = new Map<string, WorkflowFolder>();
  for (const folder of value.folders.map(decodeFolder)) if (!folders.has(folder.id)) folders.set(folder.id, folder);
  const placement = Object.fromEntries(
    Object.entries(decodePlacement(value.placement)).filter(([, folderId]) => folders.has(folderId)),
  );
  return { revision: value.revision, folders: [...folders.values()], placement };
}

function exact(value: unknown, names: readonly string[]): DynamicRecord {
  if (!isDynamicRecord(value) || Object.keys(value).some((key) => !names.includes(key)))
    invalid("workflow folder action");
  return value;
}

export function parseWorkflowFolderAction(value: unknown): WorkflowFolderAction {
  if (!isDynamicRecord(value)) invalid("workflow folder action");
  switch (value.type) {
    case "create": {
      const input = exact(value, ["type", "id", "name", "workflowIds"]);
      const action: WorkflowFolderAction = {
        type: "create",
        id: identifier(input.id, "workflow folder"),
        name: folderName(input.name),
      };
      if (input.workflowIds !== undefined) action.workflowIds = workflowIds(input.workflowIds);
      return action;
    }
    case "rename": {
      const input = exact(value, ["type", "folderId", "name"]);
      return { type: "rename", folderId: identifier(input.folderId, "workflow folder"), name: folderName(input.name) };
    }
    case "delete": {
      const input = exact(value, ["type", "folderId"]);
      return { type: "delete", folderId: identifier(input.folderId, "workflow folder") };
    }
    case "place": {
      const input = exact(value, ["type", "workflowIds", "folderId"]);
      return {
        type: "place",
        workflowIds: workflowIds(input.workflowIds),
        folderId: input.folderId === null ? null : identifier(input.folderId, "workflow folder"),
      };
    }
    default:
      return invalid("workflow folder action");
  }
}
