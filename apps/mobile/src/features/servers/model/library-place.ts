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

export type LibraryPlace =
  | { kind: "all" }
  | { kind: "removed" }
  | { kind: "agent"; agentId: string }
  | { kind: "folder"; agentId: string; folderId: string };

const ALL_FILES: LibraryPlace = { kind: "all" };

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

export function useLibraryPlace(serverId: string): LibraryPlace {
  return useSyncExternalStore(subscribe, () => places.get(serverId) ?? ALL_FILES);
}

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

export function fromRemovedAgent(file: StoredFileRow, livingAgentIds: ReadonlySet<string>): boolean {
  return file.agentId !== null && !livingAgentIds.has(file.agentId);
}

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
  return level + 1 + height <= LIBRARY_FOLDER_LIMITS.levels && folders.length < LIBRARY_FOLDER_LIMITS.folders;
}

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
