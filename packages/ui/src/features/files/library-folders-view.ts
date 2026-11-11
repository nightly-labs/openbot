import {
  LIBRARY_FOLDER_LIMITS,
  type LibraryFolder,
  libraryFolderHeight,
  libraryFolderPath,
} from "@openbot/contracts/ipc";

/** The place in the Library that the page shows. `removed`: the files of agents that the server no longer has. */
export type LibraryLocation =
  | { kind: "all" }
  | { kind: "removed" }
  | { kind: "agent"; agentId: string }
  | { kind: "folder"; agentId: string; folderId: string };

export const ALL_FILES: LibraryLocation = { kind: "all" };
export const REMOVED_AGENTS: LibraryLocation = { kind: "removed" };

export function sameLocation(a: LibraryLocation, b: LibraryLocation): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "agent" && b.kind === "agent") return a.agentId === b.agentId;
  if (a.kind === "folder" && b.kind === "folder") return a.folderId === b.folderId;
  return true;
}

/** The key of the folder list of an agent in the set of collapsed rows. A folder uses its id. */
export function agentKey(agentId: string): string {
  return `agent:${agentId}`;
}

/** The element id of the folder list under a row. */
export function branchId(key: string): string {
  return `library-branch-${key}`;
}

/** The folders of one parent of an agent, in the sequence of the snapshot. */
export function childFolders(
  folders: readonly LibraryFolder[],
  agentId: string,
  parentId: string | undefined,
): LibraryFolder[] {
  return folders.filter((folder) => folder.agentId === agentId && folder.parentId === parentId);
}

/**
 * A folder can hold one more level of folders: a new folder, or the folder `movedId` with the folders
 * in it. `parentId` undefined is the top level of an agent. The host has the same limit.
 */
export function canHoldFolder(
  folders: readonly LibraryFolder[],
  parentId: string | undefined,
  movedId?: string,
): boolean {
  const level = libraryFolderPath(folders, parentId).length;
  const height = movedId === undefined ? 0 : libraryFolderHeight(folders, movedId);
  return level + 1 + height <= LIBRARY_FOLDER_LIMITS.levels;
}

/** The name for a new folder: the base name, or the base name with the first number that no sibling has. */
export function freeFolderName(base: string, siblings: readonly LibraryFolder[]): string {
  const taken = new Set(siblings.map((folder) => folder.name));
  if (!taken.has(base)) return base;
  for (let count = 2; ; count += 1) {
    const name = `${base} ${count}`;
    if (!taken.has(name)) return name;
  }
}

/** The ids in groups that one folder action can hold. */
export function fileIdGroups(ids: readonly string[]): string[][] {
  const groups: string[][] = [];
  for (let start = 0; start < ids.length; start += LIBRARY_FOLDER_LIMITS.files) {
    groups.push(ids.slice(start, start + LIBRARY_FOLDER_LIMITS.files));
  }
  return groups;
}
