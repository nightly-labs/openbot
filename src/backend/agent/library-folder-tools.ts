import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  LIBRARY_FOLDER_LIMITS,
  type LibraryFolder,
  type LibraryFolderContext,
  type LibraryFoldersSnapshot,
  libraryFolderBranch,
  libraryFolderPath,
  libraryFolderTree,
} from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { z } from "zod";
import type { LibraryFoldersStore } from "../library-folders-store";
import type { MailboxStoredFile } from "../mailbox-store";
import { StoredStateFailure } from "../stored-state-effects";

export interface AgentLibraryFolders
  extends Pick<LibraryFoldersStore, "getSnapshot" | "placeInPath" | "mutate" | "removeAgent"> {
  fileAgents(files: readonly LibraryFileStamp[]): Effect.Effect<ReadonlyMap<string, string | null>, StoredStateFailure>;
}

export interface LibraryFileStamp {
  id: string;
  storedAt: string | null;
}

const FOLDER_PATH_CHARACTERS = LIBRARY_FOLDER_LIMITS.levels * (LIBRARY_FOLDER_LIMITS.name + 1) - 1;

export const libraryFolderArgument = z.string().max(FOLDER_PATH_CHARACTERS);

export const listLibraryFoldersToolSchema = z.strictObject({ folder: libraryFolderArgument.optional() });

const ORGANIZE_LIBRARY_ACTIONS = ["create", "rename", "move", "delete", "place"] as const;

export const organizeLibraryToolSchema = z.strictObject({
  action: z.enum(ORGANIZE_LIBRARY_ACTIONS),
  folder: libraryFolderArgument.optional(),
  name: z.string().max(LIBRARY_FOLDER_LIMITS.name).optional(),
  to: libraryFolderArgument.optional(),
  files: z.array(z.string().min(1).max(INPUT_LIMITS.identifier)).max(LIBRARY_FOLDER_LIMITS.files).optional(),
});

type OrganizeLibraryArguments = z.infer<typeof organizeLibraryToolSchema>;

export type OrganizedLibrary =
  | { folder: string; created: boolean; filesPlaced: number }
  | { folder: string; was: string }
  | { deleted: string; foldersDeleted: number; filesInNoFolder: number }
  | { to: string | null; filesPlaced: number };

const LISTED_FILES = 200;

interface ListedFile {
  id: string;
  name: string;
  path: string;
}

export type AttachedLibraryFolder = { path: string; created: boolean } | { placed: false; reason: string };

export interface LibraryFolderListing {
  folders: { path: string; fileCount: number; files: ListedFile[] }[];
  unfiled?: { fileCount: number; files: ListedFile[] };
  truncated: boolean;
}

const pathText = (folders: readonly LibraryFolder[]) => folders.map((folder) => folder.name).join("/");

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

function optionalPathNames(path: string | undefined): string[] | null {
  if (path === undefined || path.split("/").every((name) => name.trim().length === 0)) return null;
  return folderPathNames(path);
}

function ownFolder(own: readonly LibraryFolder[], path: string): LibraryFolder {
  let found: LibraryFolder | undefined;
  for (const name of folderPathNames(path)) {
    const wanted = name.toLocaleLowerCase();
    const parentId = found?.id;
    found = own.find((candidate) => candidate.parentId === parentId && candidate.name.toLocaleLowerCase() === wanted);
    if (!found) break;
  }
  if (!found)
    throw new Error(
      `You have no Library folder "${path}". Call list_library_folders with no folder to see your folders.`,
    );
  return found;
}

function refusalReason(cause: unknown): string {
  return cause instanceof Error && !("code" in cause) ? cause.message : "OpenBot could not save the Library folders.";
}

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
      fileAgent: (fileId) => (attached.has(fileId) ? agentId : undefined),
    })
    .pipe(
      Effect.map((placed): AttachedLibraryFolder => ({ path: pathText(placed.path), created: placed.created })),
      Effect.catch((failure) => Effect.succeed(notPlaced(refusalReason(failure.cause)))),
      Effect.catchDefect((defect) => Effect.succeed(notPlaced(refusalReason(defect)))),
    );
}

export function listLibraryFolders(
  snapshot: Pick<LibraryFoldersSnapshot, "folders" | "placement">,
  storedFiles: readonly MailboxStoredFile[],
  fileAgents: ReadonlyMap<string, string | null>,
  agentId: string,
  folder?: string,
): LibraryFolderListing {
  const own = snapshot.folders.filter((candidate) => candidate.agentId === agentId);
  const top = folder === undefined ? undefined : ownFolder(own, folder);
  const listed = top
    ? [top, ...libraryFolderTree(own, agentId, top.id).map((entry) => entry.folder)]
    : libraryFolderTree(own, agentId).map((entry) => entry.folder);

  const ownIds = new Set(own.map((candidate) => candidate.id));
  const filesByFolder = new Map<string, ListedFile[]>();
  const unfiled: ListedFile[] = [];
  const seen = new Set<string>();
  for (const stored of storedFiles) {
    const { id, name } = stored.attachment;
    if (seen.has(id)) continue;
    seen.add(id);
    const file = { id, name, path: stored.path };
    const folderId = snapshot.placement[id];
    if (folderId !== undefined && ownIds.has(folderId)) {
      const files = filesByFolder.get(folderId);
      if (files) files.push(file);
      else filesByFolder.set(folderId, [file]);
    } else if (folderId === undefined && fileAgents.get(id) === agentId) unfiled.push(file);
  }

  let room = LISTED_FILES;
  const take = (all: readonly ListedFile[]) => {
    const files = all.slice(0, room);
    room -= files.length;
    return files;
  };
  const folders = listed.map((entry) => {
    const all = filesByFolder.get(entry.id) ?? [];
    return { path: pathText(libraryFolderPath(own, entry.id)), fileCount: all.length, files: take(all) };
  });
  const loose = top ? undefined : { fileCount: unfiled.length, files: take(unfiled) };
  return {
    folders,
    ...(loose ? { unfiled: loose } : {}),
    truncated: [...folders, ...(loose ? [loose] : [])].some((entry) => entry.files.length < entry.fileCount),
  };
}

export function organizeLibrary(
  libraryFolders: AgentLibraryFolders,
  agentId: string,
  args: OrganizeLibraryArguments,
  storedFiles: readonly MailboxStoredFile[],
): Effect.Effect<OrganizedLibrary, StoredStateFailure> {
  return Effect.gen(function* () {
    const snapshot = libraryFolders.getSnapshot();
    const own = snapshot.folders.filter((folder) => folder.agentId === agentId);
    const required = <T>(value: T | undefined, field: string): T => {
      if (value === undefined) throw new Error(`${args.action} needs ${field}.`);
      return value;
    };
    const ownPath = (folders: readonly LibraryFolder[], folderId: string) =>
      pathText(libraryFolderPath(folders, folderId));
    const requireFreeName = (parentId: string | undefined, name: string, folderId: string) => {
      const wanted = name.trim().toLocaleLowerCase();
      const taken = own.find(
        (folder) =>
          folder.id !== folderId && folder.parentId === parentId && folder.name.toLocaleLowerCase() === wanted,
      );
      if (taken) throw new Error(`You already have a Library folder "${ownPath(own, taken.id)}".`);
    };
    const ownFiles = Effect.fn("LibraryFolders.ownFiles")(function* () {
      const fileIds = [...new Set(required(args.files, "files"))];
      if (fileIds.length === 0) throw new Error(`${args.action} needs at least one file id in files.`);
      const stored = new Map(storedFiles.map((file) => [file.attachment.id, file]));
      const unknown = (fileId: string) =>
        new Error(`No Library file has the id "${fileId}". list_library_folders gives the ids of your files.`);
      const missing = fileIds.find((fileId) => !stored.has(fileId));
      if (missing !== undefined) throw unknown(missing);
      const fileAgents = yield* libraryFolders.fileAgents(
        fileIds.map((fileId) => ({ id: fileId, storedAt: stored.get(fileId)?.createdAt ?? null })),
      );
      for (const fileId of fileIds) {
        const fileAgent = fileAgents.get(fileId);
        if (fileAgent === undefined) throw unknown(fileId);
        if (fileAgent !== agentId) throw new Error(`The file "${fileId}" is not one of your Library files.`);
      }
      const context: LibraryFolderContext = {
        agentIds: { has: (id) => id === agentId },
        fileAgent: (fileId) => fileAgents.get(fileId),
      };
      return { fileIds, context };
    });
    const folderContext: LibraryFolderContext = {
      agentIds: { has: (id) => id === agentId },
      fileAgent: () => undefined,
    };

    switch (args.action) {
      case "create":
      case "place": {
        const names =
          args.action === "create" ? folderPathNames(required(args.folder, "folder")) : optionalPathNames(args.to);
        const files =
          args.files === undefined && args.action === "create"
            ? { fileIds: [], context: folderContext }
            : yield* ownFiles();
        if (names === null) {
          yield* libraryFolders.mutate({ type: "place", fileIds: files.fileIds, folderId: null }, files.context);
          return { to: null, filesPlaced: files.fileIds.length };
        }
        const placed = yield* libraryFolders.placeInPath(agentId, names, files.fileIds, files.context);
        const path = pathText(placed.path);
        return args.action === "create"
          ? { folder: path, created: placed.created, filesPlaced: files.fileIds.length }
          : { to: path, filesPlaced: files.fileIds.length };
      }
      case "rename": {
        const folder = ownFolder(own, required(args.folder, "folder"));
        const name = required(args.name, "name");
        if (name.includes("/")) throw new Error("A Library folder name cannot have a slash.");
        requireFreeName(folder.parentId, name, folder.id);
        const next = yield* libraryFolders.mutate({ type: "rename", folderId: folder.id, name }, folderContext);
        return { folder: ownPath(next.folders, folder.id), was: ownPath(own, folder.id) };
      }
      case "move": {
        const folder = ownFolder(own, required(args.folder, "folder"));
        const parent = optionalPathNames(args.to) === null ? undefined : ownFolder(own, required(args.to, "to"));
        requireFreeName(parent?.id, folder.name, folder.id);
        const next = yield* libraryFolders.mutate(
          { type: "move", folderId: folder.id, parentId: parent?.id ?? null, beforeFolderId: null },
          folderContext,
        );
        return { folder: ownPath(next.folders, folder.id), was: ownPath(own, folder.id) };
      }
      case "delete": {
        const folder = ownFolder(own, required(args.folder, "folder"));
        const branch = libraryFolderBranch(own, folder.id);
        const filesInNoFolder = Object.values(snapshot.placement).filter((folderId) => branch.has(folderId)).length;
        yield* libraryFolders.mutate({ type: "delete", folderId: folder.id }, folderContext);
        return { deleted: ownPath(own, folder.id), foldersDeleted: branch.size, filesInNoFolder };
      }
    }
  }).pipe(Effect.mapError(safeFailure));
}

function safeFailure(failure: StoredStateFailure): StoredStateFailure {
  return new StoredStateFailure({ cause: new Error(refusalReason(failure.cause)) });
}

export function libraryFileAgents(
  libraryFolders: AgentLibraryFolders,
  storedFiles: readonly MailboxStoredFile[],
): Effect.Effect<ReadonlyMap<string, string | null>, StoredStateFailure> {
  const stamped = storedFiles.flatMap((file) =>
    file.createdAt === null ? [] : [{ id: file.attachment.id, storedAt: file.createdAt }],
  );
  return libraryFolders.fileAgents(stamped).pipe(Effect.mapError(safeFailure));
}
