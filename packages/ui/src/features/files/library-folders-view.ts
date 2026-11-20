import {
  LIBRARY_FOLDER_LIMITS,
  type LibraryFolder,
  libraryFolderHeight,
  libraryFolderPath,
} from "@openbot/contracts/ipc";

export type LibraryLocation =
  | { kind: "all" }
  | { kind: "recent" }
  | { kind: "unsorted" }
  | { kind: "removed" }
  | { kind: "agent"; agentId: string }
  | { kind: "folder"; agentId: string; folderId: string };

export const ALL_FILES: LibraryLocation = { kind: "all" };
export const RECENT_FILES: LibraryLocation = { kind: "recent" };
export const UNSORTED_FILES: LibraryLocation = { kind: "unsorted" };
export const REMOVED_AGENTS: LibraryLocation = { kind: "removed" };

const RECENT_MS = 7 * 86_400_000;

export function isRecentFile(createdAt: string, now: Date): boolean {
  return now.getTime() - Date.parse(createdAt) < RECENT_MS;
}

export function sameLocation(a: LibraryLocation, b: LibraryLocation): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "agent" && b.kind === "agent") return a.agentId === b.agentId;
  if (a.kind === "folder" && b.kind === "folder") return a.folderId === b.folderId;
  return true;
}

export function agentKey(agentId: string): string {
  return `agent:${agentId}`;
}

export const FAVORITES_SECTION = "section:favorites";
export const AGENTS_SECTION = "section:agents";

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
