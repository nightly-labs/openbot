import {
  LIBRARY_FOLDER_LIMITS,
  type LibraryFolder,
  libraryFolderHeight,
  libraryFolderPath,
  type StoredFileRow,
} from "@openbot/contracts/ipc";

export type LibraryLocation =
  | { kind: "all" }
  | { kind: "recent" }
  | { kind: "unsorted" }
  | { kind: "removed" }
  | { kind: "other" }
  | { kind: "agent"; agentId: string }
  | { kind: "folder"; agentId: string; folderId: string }
  | { kind: "workflowFolder"; folderId: string }
  | { kind: "workflow"; workflowId: string };

export type WorkflowLocation = Extract<LibraryLocation, { kind: "workflowFolder" | "workflow" }>;

export const ALL_FILES: LibraryLocation = { kind: "all" };
export const RECENT_FILES: LibraryLocation = { kind: "recent" };
export const UNSORTED_FILES: LibraryLocation = { kind: "unsorted" };
export const REMOVED_AGENTS: LibraryLocation = { kind: "removed" };
export const OTHER_FILES: LibraryLocation = { kind: "other" };

export function isWorkflowLocation(place: LibraryLocation): place is WorkflowLocation {
  return place.kind === "workflowFolder" || place.kind === "workflow";
}

const RECENT_MS = 7 * 86_400_000;

export function isRecentFile(createdAt: string, now: Date): boolean {
  return now.getTime() - Date.parse(createdAt) < RECENT_MS;
}

export function sameLocation(a: LibraryLocation, b: LibraryLocation): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "agent" && b.kind === "agent") return a.agentId === b.agentId;
  if (a.kind === "folder" && b.kind === "folder") return a.folderId === b.folderId;
  if (a.kind === "workflowFolder" && b.kind === "workflowFolder") return a.folderId === b.folderId;
  if (a.kind === "workflow" && b.kind === "workflow") return a.workflowId === b.workflowId;
  return true;
}

export function agentKey(agentId: string): string {
  return `agent:${agentId}`;
}

export const FAVORITES_SECTION = "section:favorites";
export const AGENTS_SECTION = "section:agents";
export const WORKFLOWS_SECTION = "section:workflows";

export function workflowFolderKey(folderId: string): string {
  return `workflow-folder:${folderId}`;
}

export interface LibraryWorkflowRow {
  id: string;
  name: string;
  count: number;
}

export interface LibraryWorkflowFolderRow extends LibraryWorkflowRow {
  workflows: LibraryWorkflowRow[];
}

export interface LibraryWorkflowTree {
  count: number;
  folders: LibraryWorkflowFolderRow[];
  loose: LibraryWorkflowRow[];
}

function counted(rows: Map<string, LibraryWorkflowRow>, id: string, name: string): void {
  const row = rows.get(id);
  if (row) row.count += 1;
  else rows.set(id, { id, name, count: 1 });
}

function byName(a: LibraryWorkflowRow, b: LibraryWorkflowRow): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

export function libraryWorkflowTree(files: readonly StoredFileRow[]): LibraryWorkflowTree {
  const folders = new Map<string, LibraryWorkflowRow>();
  const inFolder = new Map<string, Map<string, LibraryWorkflowRow>>();
  const loose = new Map<string, LibraryWorkflowRow>();
  let count = 0;
  for (const { workflow } of files) {
    if (!workflow) continue;
    count += 1;
    if (!workflow.folder) {
      counted(loose, workflow.id, workflow.name);
      continue;
    }
    counted(folders, workflow.folder.id, workflow.folder.name);
    const rows = inFolder.get(workflow.folder.id) ?? new Map<string, LibraryWorkflowRow>();
    counted(rows, workflow.id, workflow.name);
    inFolder.set(workflow.folder.id, rows);
  }
  return {
    count,
    folders: [...folders.values()]
      .map((folder) => ({ ...folder, workflows: [...(inFolder.get(folder.id)?.values() ?? [])].sort(byName) }))
      .sort(byName),
    loose: [...loose.values()].sort(byName),
  };
}

export function branchId(key: string): string {
  return `library-branch-${key}`;
}

export function childFolders(
  folders: readonly LibraryFolder[],
  agentId: string,
  parentId: string | undefined,
): LibraryFolder[] {
  return folders.filter((folder) => folder.agentId === agentId && folder.parentId === parentId);
}

export function canHoldFolder(
  folders: readonly LibraryFolder[],
  parentId: string | undefined,
  movedId?: string,
): boolean {
  const level = libraryFolderPath(folders, parentId).length;
  const height = movedId === undefined ? 0 : libraryFolderHeight(folders, movedId);
  return level + 1 + height <= LIBRARY_FOLDER_LIMITS.levels;
}

export function freeFolderName(base: string, siblings: readonly LibraryFolder[]): string {
  const taken = new Set(siblings.map((folder) => folder.name));
  if (!taken.has(base)) return base;
  for (let count = 2; ; count += 1) {
    const name = `${base} ${count}`;
    if (!taken.has(name)) return name;
  }
}

export function fileIdGroups(ids: readonly string[]): string[][] {
  const groups: string[][] = [];
  for (let start = 0; start < ids.length; start += LIBRARY_FOLDER_LIMITS.files) {
    groups.push(ids.slice(start, start + LIBRARY_FOLDER_LIMITS.files));
  }
  return groups;
}
