import {
  LIBRARY_FOLDER_LIMITS,
  type LibraryFolder,
  type LibraryFoldersSnapshot,
  libraryFolderPath,
  libraryFolderTree,
} from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { z } from "zod";
import type { LibraryFoldersStore } from "../library-folders-store";
import type { MailboxStoredFile } from "../mailbox-store";

/** What the agent tools use of the Library folders of this host. */
export type AgentLibraryFolders = Pick<LibraryFoldersStore, "getSnapshot" | "placeInPath">;

/** A folder path, such as `Autumn campaign/Images`: each level with a name of the full length. */
const FOLDER_PATH_CHARACTERS = LIBRARY_FOLDER_LIMITS.levels * (LIBRARY_FOLDER_LIMITS.name + 1) - 1;

/** The `folder` argument of `attach_files_to_response` and `list_library_folders`. */
export const libraryFolderArgument = z.string().max(FOLDER_PATH_CHARACTERS);

export const listLibraryFoldersToolSchema = z.strictObject({ folder: libraryFolderArgument.optional() });

/** The most files that one `list_library_folders` result names. */
const LISTED_FILES = 200;

/** Where `attach_files_to_response` put the files, or why they are in no folder. */
export type AttachedLibraryFolder = { path: string; created: boolean } | { placed: false; reason: string };

export interface LibraryFolderListing {
  folders: { path: string; fileCount: number; files: { id: string; name: string; path: string }[] }[];
  /** The files of the agent that are in no folder. */
  unfiled: number;
  /** True when `files` of a folder has fewer entries than its `fileCount`. */
  truncated: boolean;
}

const pathText = (folders: readonly LibraryFolder[]) => folders.map((folder) => folder.name).join("/");

/**
 * The folder names of a path, from the top level down. A model often adds a slash at an end, and a
 * refused call costs a model step, so empty names are ignored. Throws the reason for a path that
 * names no folder, has too many levels, or has a name that is too long.
 */
function folderPathNames(path: string): string[] {
  const names = path
    .split("/")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (names.length === 0) throw new Error('folder must name a Library folder, such as "Reports/2026".');
  if (names.length > LIBRARY_FOLDER_LIMITS.levels)
    throw new Error(`A Library folder path has at most ${LIBRARY_FOLDER_LIMITS.levels} levels.`);
  if (names.some((name) => name.length > LIBRARY_FOLDER_LIMITS.name))
    throw new Error(`A Library folder name has at most ${LIBRARY_FOLDER_LIMITS.name} characters.`);
  return names;
}

/** A refusal of the store has a message for a person. An I/O error has a code, and its message can name a path. */
function refusalReason(cause: unknown): string {
  return cause instanceof Error && !("code" in cause) ? cause.message : "OpenBot could not save the Library folders.";
}

/**
 * Puts files that the agent attached into the folder that `folder` names, and makes each folder
 * that the agent does not have. The files are attached before this runs, so it never fails: a path
 * or a limit that the store refuses gives the reason, and the files stay in no folder.
 */
export function placeInLibraryFolder(
  store: AgentLibraryFolders | null,
  agentId: string,
  folder: string,
  fileIds: readonly string[],
): Effect.Effect<AttachedLibraryFolder> {
  const notPlaced = (reason: string): AttachedLibraryFolder => ({ placed: false, reason });
  if (!store) return Effect.succeed(notPlaced("Library folders are not available on this OpenBot."));
  let names: string[];
  try {
    names = folderPathNames(folder);
  } catch (error) {
    return Effect.succeed(notPlaced(refusalReason(error)));
  }
  const attached = new Set(fileIds);
  return store
    .placeInPath(agentId, names, fileIds, {
      agentIds: { has: (id) => id === agentId },
      // The Library shows a file that an agent attached under that agent.
      fileAgent: (fileId) => (attached.has(fileId) ? agentId : undefined),
    })
    .pipe(
      Effect.map((placed): AttachedLibraryFolder => ({ path: pathText(placed.path), created: placed.created })),
      Effect.catch((failure) => Effect.succeed(notPlaced(refusalReason(failure.cause)))),
      Effect.catchDefect((defect) => Effect.succeed(notPlaced(refusalReason(defect)))),
    );
}

/**
 * The folders of an agent with the files in each, for `list_library_folders`. `folder` limits the
 * result to one folder and the folders in it; a path that the agent does not have throws. A file is
 * in a folder by its entry in the snapshot, which the store wrote only for a file of the agent. The
 * `unfiled` count uses the agent of the stored file record, which can differ from the Library for a
 * file that a different agent's chat showed first.
 */
export function listLibraryFolders(
  snapshot: Pick<LibraryFoldersSnapshot, "folders" | "placement">,
  storedFiles: readonly MailboxStoredFile[],
  agentId: string,
  folder?: string,
): LibraryFolderListing {
  const own = snapshot.folders.filter((candidate) => candidate.agentId === agentId);
  let top: LibraryFolder | undefined;
  if (folder !== undefined) {
    for (const name of folderPathNames(folder)) {
      const wanted = name.toLocaleLowerCase();
      const parentId = top?.id;
      top = own.find((candidate) => candidate.parentId === parentId && candidate.name.toLocaleLowerCase() === wanted);
      if (!top) throw new Error(`You have no Library folder "${folder}". Omit folder to see your folders.`);
    }
  }
  const listed = top
    ? [top, ...libraryFolderTree(own, agentId, top.id).map((entry) => entry.folder)]
    : libraryFolderTree(own, agentId).map((entry) => entry.folder);

  const ownIds = new Set(own.map((candidate) => candidate.id));
  const filesByFolder = new Map<string, { id: string; name: string; path: string }[]>();
  const seen = new Set<string>();
  let unfiled = 0;
  for (const stored of storedFiles) {
    const { id, name } = stored.attachment;
    if (seen.has(id)) continue;
    seen.add(id);
    const folderId = snapshot.placement[id];
    if (folderId !== undefined && ownIds.has(folderId)) {
      const file = { id, name, path: stored.path };
      const files = filesByFolder.get(folderId);
      if (files) files.push(file);
      else filesByFolder.set(folderId, [file]);
    } else if (stored.agentId === agentId) unfiled += 1;
  }

  let room = LISTED_FILES;
  const folders = listed.map((entry) => {
    const all = filesByFolder.get(entry.id) ?? [];
    const files = all.slice(0, room);
    room -= files.length;
    return { path: pathText(libraryFolderPath(own, entry.id)), fileCount: all.length, files };
  });
  return { folders, unfiled, truncated: folders.some((entry) => entry.files.length < entry.fileCount) };
}
