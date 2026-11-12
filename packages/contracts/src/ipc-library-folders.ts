/**
 * Library folders: each agent has folders for its files in the Library, and a folder can hold folders.
 * A file is in one folder of its agent or in none. The folders are a layout over the stored files: a
 * folder change moves, copies and deletes no file.
 *
 * The host keeps one snapshot. Each change is one action, and the answer is the full snapshot. The
 * pure `applyLibraryFolderAction` gives the same result on the host, in the preview mock and in a
 * client that shows a change before the host answers.
 */

import { isIdentifier } from "./ipc-bounded-values";
import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "./runtime-values";

export const LIBRARY_FOLDER_LIMITS = {
  /** The folders of all agents of one host. */
  folders: 500,
  name: 80,
  /** A folder at the top is level 1. */
  levels: 5,
  /** The files of one host that are in a folder. */
  placements: 20_000,
  /** The files of one action. */
  files: 2_000,
} as const;

/**
 * A folder in the library of one agent. A folder with a parent is in that folder. The folders of one
 * parent show in the sequence that they have in the snapshot.
 */
export interface LibraryFolder {
  id: string;
  agentId: string;
  name: string;
  parentId?: string;
}

export interface LibraryFoldersSnapshot {
  revision: number;
  folders: LibraryFolder[];
  /** The folder of each file that is in one, by file id. A file with no entry is in no folder. */
  placement: Record<string, string>;
}

/** A deleted folder with the position that it had in the snapshot. */
export interface RemovedLibraryFolder {
  index: number;
  folder: LibraryFolder;
}

export type LibraryFolderAction =
  /**
   * The client makes the id, so it can show the folder before the host answers. The folder goes last
   * in its parent. `fileIds` puts files of the same agent into the new folder.
   */
  | { type: "create"; id: string; agentId: string; name: string; parentId?: string; fileIds?: string[] }
  | { type: "rename"; folderId: string; name: string }
  /** Removes the folder and each folder below it. Their files stay with the agent, in no folder. */
  | { type: "delete"; folderId: string }
  /**
   * Puts a folder, with the folders in it, in `parentId` (null: the top level of its agent), before
   * the sibling `beforeFolderId` (null: last).
   */
  | { type: "move"; folderId: string; parentId: string | null; beforeFolderId: string | null }
  /** Puts files into a folder of their agent. Null takes them out of their folder. */
  | { type: "place"; fileIds: string[]; folderId: string | null }
  /**
   * Puts deleted folders back at their positions, with the files that they held. A folder that exists
   * is not changed, and a file that got a different folder after the delete stays there.
   */
  | { type: "restore"; folders: RemovedLibraryFolder[]; placement: Record<string, string> };

/** What the host knows and the snapshot does not hold. */
export interface LibraryFolderContext {
  agentIds: Pick<ReadonlySet<string>, "has">;
  /** The agent of a file. Null: the file has no agent. Undefined: the file is unknown. */
  fileAgent(fileId: string): string | null | undefined;
}

export type LibraryFolderRefusalReason =
  | "name"
  | "folder-limit"
  | "file-limit"
  | "too-deep"
  | "unknown-agent"
  | "unknown-folder"
  | "unknown-file"
  | "other-agent"
  | "taken-id"
  | "into-itself";

/** A change that the rules do not permit. The host gives each reason a localized message. */
export class LibraryFolderRefusal extends Error {
  readonly reason: LibraryFolderRefusalReason;

  constructor(reason: LibraryFolderRefusalReason) {
    super(`Library folder change refused: ${reason}.`);
    this.name = "LibraryFolderRefusal";
    this.reason = reason;
  }
}

export const EMPTY_LIBRARY_FOLDERS: LibraryFoldersSnapshot = { revision: 0, folders: [], placement: {} };

function refuse(reason: LibraryFolderRefusalReason): never {
  throw new LibraryFolderRefusal(reason);
}

/** The name with no space at its ends. An empty or long name is refused. */
export function libraryFolderName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > LIBRARY_FOLDER_LIMITS.name) refuse("name");
  return trimmed;
}

/** A folder and each folder below it. */
export function libraryFolderBranch(folders: readonly LibraryFolder[], folderId: string): Set<string> {
  const ids = new Set([folderId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId === undefined || !ids.has(folder.parentId) || ids.has(folder.id)) continue;
      ids.add(folder.id);
      grew = true;
    }
  }
  return ids;
}

/** The folders from the top level down to the folder. Empty for an unknown folder. */
export function libraryFolderPath(folders: readonly LibraryFolder[], folderId: string | undefined): LibraryFolder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: LibraryFolder[] = [];
  for (let folder = folderId === undefined ? undefined : byId.get(folderId); folder; ) {
    if (path.includes(folder)) break;
    path.unshift(folder);
    folder = folder.parentId === undefined ? undefined : byId.get(folder.parentId);
  }
  return path;
}

/** Each folder of an agent with its level (0 at the top), in the sequence of the tree. */
export function libraryFolderTree(
  folders: readonly LibraryFolder[],
  agentId: string,
  parentId?: string,
  depth = 0,
): { folder: LibraryFolder; depth: number }[] {
  if (depth >= LIBRARY_FOLDER_LIMITS.levels) return [];
  return folders
    .filter((folder) => folder.agentId === agentId && folder.parentId === parentId)
    .flatMap((folder) => [{ folder, depth }, ...libraryFolderTree(folders, agentId, folder.id, depth + 1)]);
}

/** How many levels of folders a folder holds under it: 0 for a folder with no folders in it. */
export function libraryFolderHeight(
  folders: readonly LibraryFolder[],
  folderId: string,
  seen = new Set<string>(),
): number {
  if (seen.has(folderId)) return 0;
  seen.add(folderId);
  let height = 0;
  for (const folder of folders) {
    if (folder.parentId === folderId) height = Math.max(height, 1 + libraryFolderHeight(folders, folder.id, seen));
  }
  return height;
}

/**
 * The folder of a file: its entry in the snapshot, when that folder exists and is a folder of the
 * agent of the file. A file never shows in the folder of a different agent.
 */
export function libraryFolderOfFile(
  snapshot: Pick<LibraryFoldersSnapshot, "folders" | "placement">,
  file: { id: string; agentId: string | null },
): LibraryFolder | undefined {
  const folderId = snapshot.placement[file.id];
  if (folderId === undefined || file.agentId === null) return undefined;
  const folder = snapshot.folders.find((candidate) => candidate.id === folderId);
  return folder?.agentId === file.agentId ? folder : undefined;
}

/**
 * The snapshot with only what the rules permit: one folder for each id, a parent that exists, is a
 * folder of the same agent, makes no loop and is not too deep (else the folder goes to the top
 * level), and placements only in folders that exist. A file that a person or an older version edited
 * loads through this.
 */
export function normalizeLibraryFolders(snapshot: LibraryFoldersSnapshot): LibraryFoldersSnapshot {
  const byId = new Map<string, LibraryFolder>();
  for (const folder of snapshot.folders) if (!byId.has(folder.id)) byId.set(folder.id, folder);
  const children = new Map<string, LibraryFolder[]>();
  const tops: string[] = [];
  for (const folder of byId.values()) {
    const parent = folder.parentId === undefined ? undefined : byId.get(folder.parentId);
    if (!parent || parent.id === folder.id || parent.agentId !== folder.agentId) tops.push(folder.id);
    else children.set(parent.id, [...(children.get(parent.id) ?? []), folder]);
  }
  // From the top level down, so the level of a folder does not depend on the sequence of the array.
  // A folder that this does not reach is in a loop or too deep: it goes to the top level, with its folders.
  const levels = new Map<string, number>();
  const parents = new Map<string, string>();
  const descend = (top: string) => {
    levels.set(top, 1);
    const queue = [top];
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      const level = levels.get(id) ?? 1;
      if (level >= LIBRARY_FOLDER_LIMITS.levels) continue;
      for (const child of children.get(id) ?? []) {
        if (levels.has(child.id)) continue;
        levels.set(child.id, level + 1);
        parents.set(child.id, id);
        queue.push(child.id);
      }
    }
  };
  for (const top of tops) descend(top);
  for (const id of byId.keys()) if (!levels.has(id)) descend(id);
  const folders = [...byId.values()].map(({ id, agentId, name }) => {
    const parentId = parents.get(id);
    return parentId === undefined ? { id, agentId, name } : { id, agentId, name, parentId };
  });
  const placement = Object.fromEntries(Object.entries(snapshot.placement).filter(([, folderId]) => byId.has(folderId)));
  return { revision: snapshot.revision, folders, placement };
}

function requireFolder(snapshot: LibraryFoldersSnapshot, folderId: string): LibraryFolder {
  return snapshot.folders.find((folder) => folder.id === folderId) ?? refuse("unknown-folder");
}

/** The level of a folder: 1 at the top. */
function folderLevel(snapshot: LibraryFoldersSnapshot, folderId: string): number {
  return libraryFolderPath(snapshot.folders, folderId).length;
}

/** The placement with the files in the folder. Each file must be a known file of the agent of the folder. */
function placed(
  snapshot: LibraryFoldersSnapshot,
  fileIds: readonly string[],
  folder: LibraryFolder,
  context: LibraryFolderContext,
): Record<string, string> {
  const placement = { ...snapshot.placement };
  for (const fileId of new Set(fileIds)) {
    const agentId = context.fileAgent(fileId);
    if (agentId === undefined) refuse("unknown-file");
    if (agentId !== folder.agentId) refuse("other-agent");
    placement[fileId] = folder.id;
  }
  if (Object.keys(placement).length > LIBRARY_FOLDER_LIMITS.placements) refuse("file-limit");
  return placement;
}

function samePlacement(left: Record<string, string>, right: Record<string, string>): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((fileId) => left[fileId] === right[fileId]);
}

/**
 * Applies one action. An action that changes nothing answers `current` itself, so the host does not
 * write its file or raise the revision. A change that the rules do not permit throws a
 * `LibraryFolderRefusal`.
 */
export function applyLibraryFolderAction(
  current: LibraryFoldersSnapshot,
  action: LibraryFolderAction,
  context: LibraryFolderContext,
): LibraryFoldersSnapshot {
  const revision = current.revision + 1;
  switch (action.type) {
    case "create": {
      if (current.folders.length >= LIBRARY_FOLDER_LIMITS.folders) refuse("folder-limit");
      if (!context.agentIds.has(action.agentId)) refuse("unknown-agent");
      if (current.folders.some((folder) => folder.id === action.id)) refuse("taken-id");
      const name = libraryFolderName(action.name);
      if (action.parentId !== undefined) {
        if (requireFolder(current, action.parentId).agentId !== action.agentId) refuse("other-agent");
        if (folderLevel(current, action.parentId) >= LIBRARY_FOLDER_LIMITS.levels) refuse("too-deep");
      }
      const folder: LibraryFolder =
        action.parentId === undefined
          ? { id: action.id, agentId: action.agentId, name }
          : { id: action.id, agentId: action.agentId, name, parentId: action.parentId };
      return {
        revision,
        folders: [...current.folders, folder],
        placement: action.fileIds ? placed(current, action.fileIds, folder, context) : current.placement,
      };
    }
    case "rename": {
      const folder = requireFolder(current, action.folderId);
      const name = libraryFolderName(action.name);
      if (name === folder.name) return current;
      return {
        ...current,
        revision,
        folders: current.folders.map((candidate) => (candidate.id === folder.id ? { ...candidate, name } : candidate)),
      };
    }
    case "delete": {
      requireFolder(current, action.folderId);
      const gone = libraryFolderBranch(current.folders, action.folderId);
      return {
        revision,
        folders: current.folders.filter((folder) => !gone.has(folder.id)),
        placement: Object.fromEntries(Object.entries(current.placement).filter(([, folderId]) => !gone.has(folderId))),
      };
    }
    case "move": {
      const moved = requireFolder(current, action.folderId);
      const branch = libraryFolderBranch(current.folders, moved.id);
      if (action.parentId !== null) {
        if (branch.has(action.parentId)) refuse("into-itself");
        if (requireFolder(current, action.parentId).agentId !== moved.agentId) refuse("other-agent");
        const levels = folderLevel(current, action.parentId) + 1 + libraryFolderHeight(current.folders, moved.id);
        if (levels > LIBRARY_FOLDER_LIMITS.levels) refuse("too-deep");
      }
      if (action.beforeFolderId !== null && action.beforeFolderId !== moved.id) {
        const before = requireFolder(current, action.beforeFolderId);
        if (before.agentId !== moved.agentId || (before.parentId ?? null) !== action.parentId) refuse("unknown-folder");
      }
      const next: LibraryFolder =
        action.parentId === null
          ? { id: moved.id, agentId: moved.agentId, name: moved.name }
          : { id: moved.id, agentId: moved.agentId, name: moved.name, parentId: action.parentId };
      const rest = current.folders.filter((folder) => folder.id !== moved.id);
      const at = action.beforeFolderId === null ? -1 : rest.findIndex((folder) => folder.id === action.beforeFolderId);
      const folders = at < 0 ? [...rest, next] : [...rest.slice(0, at), next, ...rest.slice(at)];
      const same =
        (moved.parentId ?? null) === action.parentId &&
        folders.every((folder, index) => folder.id === current.folders[index]?.id);
      return same ? current : { ...current, revision, folders };
    }
    case "place": {
      if (action.fileIds.length > LIBRARY_FOLDER_LIMITS.files) refuse("file-limit");
      let placement: Record<string, string>;
      if (action.folderId === null) {
        placement = { ...current.placement };
        for (const fileId of action.fileIds) delete placement[fileId];
      } else {
        placement = placed(current, action.fileIds, requireFolder(current, action.folderId), context);
      }
      return samePlacement(placement, current.placement) ? current : { ...current, revision, placement };
    }
    case "restore": {
      const folders = [...current.folders];
      for (const entry of [...action.folders].sort((left, right) => left.index - right.index)) {
        if (folders.some((folder) => folder.id === entry.folder.id)) continue;
        if (folders.length >= LIBRARY_FOLDER_LIMITS.folders) refuse("folder-limit");
        if (!context.agentIds.has(entry.folder.agentId)) refuse("unknown-agent");
        const folder = { ...entry.folder, name: libraryFolderName(entry.folder.name) };
        folders.splice(Math.min(entry.index, folders.length), 0, folder);
      }
      // A parent that does not come back, or that the rules do not permit, puts the folder at the top level.
      const restored = normalizeLibraryFolders({ revision, folders, placement: {} }).folders;
      const byId = new Map(restored.map((folder) => [folder.id, folder]));
      const placement = { ...current.placement };
      for (const [fileId, folderId] of Object.entries(action.placement)) {
        const folder = byId.get(folderId);
        if (!folder || placement[fileId] !== undefined || context.fileAgent(fileId) !== folder.agentId) continue;
        placement[fileId] = folderId;
      }
      if (Object.keys(placement).length > LIBRARY_FOLDER_LIMITS.placements) refuse("file-limit");
      const same =
        restored.length === current.folders.length &&
        restored.every((folder, index) => folder.id === current.folders[index]?.id) &&
        samePlacement(placement, current.placement);
      return same ? current : { revision, folders: restored, placement };
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
  if (!isString(value) || value.length === 0 || value.length > LIBRARY_FOLDER_LIMITS.name)
    invalid("library folder name");
  return value;
}

function fileIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > LIBRARY_FOLDER_LIMITS.files) invalid("library folder files");
  return value.map((fileId) => identifier(fileId, "library folder file"));
}

function nullableIdentifier(value: unknown, label: string): string | null {
  return value === null ? null : identifier(value, label);
}

function decodeFolder(value: unknown): LibraryFolder {
  if (!isDynamicRecord(value)) invalid("library folder");
  const folder: LibraryFolder = {
    id: identifier(value.id, "library folder"),
    agentId: identifier(value.agentId, "library folder agent"),
    name: folderName(value.name),
  };
  if (value.parentId !== undefined) folder.parentId = identifier(value.parentId, "library folder parent");
  return folder;
}

function decodePlacement(value: unknown): Record<string, string> {
  if (!isDynamicRecord(value)) invalid("library folder files");
  const entries = Object.entries(value);
  if (entries.length > LIBRARY_FOLDER_LIMITS.placements) invalid("library folder files");
  return Object.fromEntries(
    entries.map(([fileId, folderId]) => [
      identifier(fileId, "library folder file"),
      identifier(folderId, "library folder"),
    ]),
  );
}

/** Decodes a snapshot from a host or from the stored file. Throws on a value outside the bounds. */
export function decodeLibraryFoldersSnapshot(value: unknown): LibraryFoldersSnapshot {
  if (!isDynamicRecord(value)) invalid("library folders");
  if (!isNumber(value.revision) || !Number.isSafeInteger(value.revision) || value.revision < 0)
    invalid("library folders revision");
  if (!Array.isArray(value.folders) || value.folders.length > LIBRARY_FOLDER_LIMITS.folders) invalid("library folders");
  return normalizeLibraryFolders({
    revision: value.revision,
    folders: value.folders.map(decodeFolder),
    placement: decodePlacement(value.placement),
  });
}

/** Null: the host has no Library folders. */
export function decodeOptionalLibraryFoldersSnapshot(value: unknown): LibraryFoldersSnapshot | null {
  return value === null ? null : decodeLibraryFoldersSnapshot(value);
}

function exact(value: unknown, names: readonly string[]): DynamicRecord {
  if (!isDynamicRecord(value) || Object.keys(value).some((key) => !names.includes(key)))
    invalid("library folder action");
  return value;
}

export function parseLibraryFolderAction(value: unknown): LibraryFolderAction {
  if (!isDynamicRecord(value)) invalid("library folder action");
  switch (value.type) {
    case "create": {
      const input = exact(value, ["type", "id", "agentId", "name", "parentId", "fileIds"]);
      const action: LibraryFolderAction = {
        type: "create",
        id: identifier(input.id, "library folder"),
        agentId: identifier(input.agentId, "library folder agent"),
        name: folderName(input.name),
      };
      if (input.parentId !== undefined) action.parentId = identifier(input.parentId, "library folder parent");
      if (input.fileIds !== undefined) action.fileIds = fileIds(input.fileIds);
      return action;
    }
    case "rename": {
      const input = exact(value, ["type", "folderId", "name"]);
      return { type: "rename", folderId: identifier(input.folderId, "library folder"), name: folderName(input.name) };
    }
    case "delete": {
      const input = exact(value, ["type", "folderId"]);
      return { type: "delete", folderId: identifier(input.folderId, "library folder") };
    }
    case "move": {
      const input = exact(value, ["type", "folderId", "parentId", "beforeFolderId"]);
      return {
        type: "move",
        folderId: identifier(input.folderId, "library folder"),
        parentId: nullableIdentifier(input.parentId, "library folder parent"),
        beforeFolderId: nullableIdentifier(input.beforeFolderId, "library folder"),
      };
    }
    case "place": {
      const input = exact(value, ["type", "fileIds", "folderId"]);
      return {
        type: "place",
        fileIds: fileIds(input.fileIds),
        folderId: nullableIdentifier(input.folderId, "library folder"),
      };
    }
    case "restore": {
      const input = exact(value, ["type", "folders", "placement"]);
      if (!Array.isArray(input.folders) || input.folders.length > LIBRARY_FOLDER_LIMITS.folders)
        invalid("library folders");
      return {
        type: "restore",
        folders: input.folders.map((entry) => {
          if (!isDynamicRecord(entry)) invalid("library folder");
          if (!isNumber(entry.index) || !Number.isSafeInteger(entry.index) || entry.index < 0)
            invalid("library folder position");
          return { index: entry.index, folder: decodeFolder(entry.folder) };
        }),
        placement: decodePlacement(input.placement),
      };
    }
    default:
      return invalid("library folder action");
  }
}
