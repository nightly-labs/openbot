import {
  LIBRARY_FOLDER_LIMITS,
  type LibraryFolder,
  type LibraryFoldersSnapshot,
  libraryFolderBranch,
  libraryFolderHeight,
  libraryFolderOfFile,
  libraryFolderPath,
  type StoredFileRow,
} from "@openbot/contracts/ipc";
import { useSyncExternalStore } from "react";

/**
 * The place in the Library that the page shows, as on desktop. `removed`: the files of agents that the
 * server no longer has. An agent and a folder also show the files of the folders in them.
 */
export type LibraryPlace =
  | { kind: "all" }
  | { kind: "removed" }
  | { kind: "agent"; agentId: string }
  | { kind: "folder"; agentId: string; folderId: string };

const ALL_FILES: LibraryPlace = { kind: "all" };

/**
 * The place of each server, kept while the app runs. The Library and the folder sheet read and set it,
 * so a choice in the sheet shows on the page under it.
 */
const places = new Map<string, LibraryPlace>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setLibraryPlace(serverId: string, place: LibraryPlace): void {
  places.set(serverId, place);
  for (const listener of listeners) listener();
}

/** The place that the user chose on this server. `resolveLibraryPlace` checks it against the folders. */
export function useLibraryPlace(serverId: string): LibraryPlace {
  return useSyncExternalStore(subscribe, () => places.get(serverId) ?? ALL_FILES);
}

/**
 * The place to show: a place whose agent or folder is gone gives the place above it. Without folders,
 * the page shows all files.
 */
export function resolveLibraryPlace(
  place: LibraryPlace,
  snapshot: LibraryFoldersSnapshot | null | undefined,
  livingAgentIds: ReadonlySet<string>,
  removedFilesExist: boolean,
): LibraryPlace {
  if (!snapshot || place.kind === "all") return ALL_FILES;
  if (place.kind === "removed") return removedFilesExist ? place : ALL_FILES;
  if (!livingAgentIds.has(place.agentId)) return ALL_FILES;
  if (place.kind === "agent") return place;
  return snapshot.folders.some((folder) => folder.id === place.folderId && folder.agentId === place.agentId)
    ? place
    : { kind: "agent", agentId: place.agentId };
}

/** A file of an agent that the server no longer has. A file of no agent is in no agent's Library. */
export function fromRemovedAgent(file: StoredFileRow, livingAgentIds: ReadonlySet<string>): boolean {
  return file.agentId !== null && !livingAgentIds.has(file.agentId);
}

/** The files of the place. */
export function filesOfPlace(
  files: readonly StoredFileRow[],
  place: LibraryPlace,
  snapshot: LibraryFoldersSnapshot | null | undefined,
  livingAgentIds: ReadonlySet<string>,
): StoredFileRow[] {
  if (place.kind === "all" || !snapshot) return [...files];
  if (place.kind === "removed") return files.filter((file) => fromRemovedAgent(file, livingAgentIds));
  if (place.kind === "agent") return files.filter((file) => file.agentId === place.agentId);
  const branch = libraryFolderBranch(snapshot.folders, place.folderId);
  return files.filter((file) => {
    const folder = libraryFolderOfFile(snapshot, file);
    return folder !== undefined && branch.has(folder.id);
  });
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
  return level + 1 + height <= LIBRARY_FOLDER_LIMITS.levels && folders.length < LIBRARY_FOLDER_LIMITS.folders;
}

/** The number of files in a folder and in the folders in it. */
export function folderFileCount(
  files: readonly StoredFileRow[],
  snapshot: LibraryFoldersSnapshot,
  folderId: string,
): number {
  const branch = libraryFolderBranch(snapshot.folders, folderId);
  return files.filter((file) => {
    const folder = libraryFolderOfFile(snapshot, file);
    return folder !== undefined && branch.has(folder.id);
  }).length;
}
