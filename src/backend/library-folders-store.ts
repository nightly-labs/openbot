import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import {
  applyLibraryFolderAction,
  decodeLibraryFoldersSnapshot,
  EMPTY_LIBRARY_FOLDERS,
  LIBRARY_FOLDER_LIMITS,
  type LibraryFolder,
  type LibraryFolderAction,
  type LibraryFolderContext,
  LibraryFolderRefusal,
  type LibraryFolderRefusalReason,
  type LibraryFoldersSnapshot,
  libraryFolderName,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Semaphore } from "effect";
import { writeFileAtomically } from "./atomic-json-file";
import { isMissingFileError } from "./file-errors";
import { StoredStateFailure, storedIO, storedSync } from "./stored-state-effects";

/** The name of the file in the user data directory. */
export const LIBRARY_FOLDERS_FILE = "openbot-library-folders-v1.json";

const STORED_VERSION = 1;

/** The folders that a path named, from the top level down, and whether the store made one of them. */
export interface PlacedInLibraryPath {
  path: LibraryFolder[];
  created: boolean;
}

/**
 * A change that the rules do not permit, with the message that a person reads. The Team API route
 * answers it as a client error; an unknown failure stays a server error.
 */
export class LibraryFolderChangeRefused extends Error {
  readonly reason: LibraryFolderRefusalReason;

  constructor(reason: LibraryFolderRefusalReason) {
    super(refusalText(reason));
    this.name = "LibraryFolderChangeRefused";
    this.reason = reason;
  }
}

/** The message that a person reads for a refused change. */
function refusalText(reason: LibraryFolderRefusalReason): string {
  switch (reason) {
    case "name":
      return sourceText("error.backend.libraryFolderName", { limit: LIBRARY_FOLDER_LIMITS.name });
    case "folder-limit":
      return sourceText("error.backend.libraryFolderLimit", { limit: LIBRARY_FOLDER_LIMITS.folders });
    case "file-limit":
      return sourceText("error.backend.libraryFolderFileLimit");
    case "too-deep":
      return sourceText("error.backend.libraryFolderTooDeep", { limit: LIBRARY_FOLDER_LIMITS.levels });
    case "unknown-agent":
      return sourceText("error.team.agentNotFound");
    case "unknown-folder":
      return sourceText("error.backend.libraryFolderGone");
    case "unknown-file":
      return sourceText("error.backend.fileGone");
    case "other-agent":
      return sourceText("error.backend.libraryFolderOtherAgent");
    case "into-itself":
      return sourceText("error.backend.libraryFolderMoveInvalid");
    // Only a client that sends the id of a folder a second time can cause this.
    case "taken-id":
      return "Invalid library folder.";
  }
}

function apply(
  current: LibraryFoldersSnapshot,
  action: LibraryFolderAction,
  context: LibraryFolderContext,
): LibraryFoldersSnapshot {
  try {
    return applyLibraryFolderAction(current, action, context);
  } catch (error) {
    if (error instanceof LibraryFolderRefusal) throw new LibraryFolderChangeRefused(error.reason);
    throw error;
  }
}

/**
 * The Library folders of one host, in one JSON file beside the sidebar layout. The folders are a
 * layout over the stored files, so the file holds only folder records and file ids.
 */
export class LibraryFoldersStore {
  readonly #path: string;
  #snapshot = structuredClone(EMPTY_LIBRARY_FOLDERS);
  readonly #operationQueue = Semaphore.makeUnsafe(1);
  readonly #listeners = new Set<() => void>();

  constructor(path: string) {
    this.#path = path;
  }

  initialize() {
    return Effect.gen({ self: this }, function* () {
      yield* storedIO(() => mkdir(dirname(this.#path), { recursive: true, mode: 0o700 }));
      const loaded = yield* Effect.result(
        Effect.gen({ self: this }, function* () {
          const contents = yield* storedIO(() => readFile(this.#path, "utf8"));
          return yield* storedSync(() => {
            const parsed = JSON.parse(contents);
            if (!isDynamicRecord(parsed) || parsed.version !== STORED_VERSION)
              throw new Error("Invalid library folders state.");
            return decodeLibraryFoldersSnapshot(parsed);
          });
        }),
      );
      if (Result.isSuccess(loaded)) {
        this.#snapshot = loaded.success;
        return;
      }
      if (isMissingFileError(loaded.failure.cause)) return;
      // The stored files are not in this file: a file that cannot be read loses only the folders.
      const backupPath = `${this.#path}.corrupt-${Date.now()}`;
      yield* storedIO(() => rename(this.#path, backupPath)).pipe(Effect.catch(() => Effect.void));
      this.#snapshot = structuredClone(EMPTY_LIBRARY_FOLDERS);
    });
  }

  /**
   * Calls `listener` after each saved change, from any source: a member, an agent tool, or the removal
   * of the folders of deleted agents and files. Returns the call that stops it.
   */
  onChanged(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  getSnapshot(): LibraryFoldersSnapshot {
    return structuredClone(this.#snapshot);
  }

  mutate(
    action: LibraryFolderAction,
    context: LibraryFolderContext,
  ): Effect.Effect<LibraryFoldersSnapshot, StoredStateFailure> {
    return this.#enqueue(
      Effect.gen({ self: this }, function* () {
        const next = yield* storedSync(() => apply(this.#snapshot, action, context));
        if (next !== this.#snapshot) yield* this.#commit(next);
        return this.getSnapshot();
      }),
    );
  }

  /**
   * Puts files of an agent into the folder that a path names, such as `["Autumn campaign", "Images"]`.
   * A name matches a folder with no regard to letter case. The store makes each folder that the path
   * names and the agent does not have. One write holds the new folders and the files.
   */
  placeInPath(
    agentId: string,
    names: readonly string[],
    fileIds: readonly string[],
    context: LibraryFolderContext,
  ): Effect.Effect<PlacedInLibraryPath, StoredStateFailure> {
    return this.#enqueue(
      Effect.gen({ self: this }, function* () {
        const placed = yield* storedSync(() => {
          let next = this.#snapshot;
          let created = false;
          const path: LibraryFolder[] = [];
          for (const rawName of names) {
            const parentId = path.at(-1)?.id;
            const name = libraryFolderNameOrRefusal(rawName);
            const wanted = name.toLocaleLowerCase();
            let folder = next.folders.find(
              (candidate) =>
                candidate.agentId === agentId &&
                candidate.parentId === parentId &&
                candidate.name.toLocaleLowerCase() === wanted,
            );
            if (!folder) {
              const id = randomUUID();
              next = apply(
                next,
                parentId === undefined
                  ? { type: "create", id, agentId, name }
                  : { type: "create", id, agentId, name, parentId },
                context,
              );
              folder = next.folders.find((candidate) => candidate.id === id);
              created = true;
            }
            if (!folder) throw new LibraryFolderChangeRefused("unknown-folder");
            path.push(folder);
          }
          const target = path.at(-1);
          if (!target) throw new LibraryFolderChangeRefused("name");
          next = apply(next, { type: "place", fileIds: [...fileIds], folderId: target.id }, context);
          return { next, result: { path, created } };
        });
        if (placed.next !== this.#snapshot) yield* this.#commit(placed.next);
        return structuredClone(placed.result);
      }),
    );
  }

  /** Removes the folders of a deleted agent and the entries of its files. */
  removeAgent(agentId: string): Effect.Effect<LibraryFoldersSnapshot, StoredStateFailure> {
    return this.#enqueue(
      Effect.gen({ self: this }, function* () {
        const gone = new Set(
          this.#snapshot.folders.filter((folder) => folder.agentId === agentId).map((folder) => folder.id),
        );
        if (gone.size === 0) return this.getSnapshot();
        yield* this.#commit({
          revision: this.#snapshot.revision + 1,
          folders: this.#snapshot.folders.filter((folder) => !gone.has(folder.id)),
          placement: Object.fromEntries(
            Object.entries(this.#snapshot.placement).filter(([, folderId]) => !gone.has(folderId)),
          ),
        });
        return this.getSnapshot();
      }),
    );
  }

  /**
   * Removes the folders of agents that the host no longer has, at the start of the app. An agent can
   * go on a path that does not call `removeAgent`, such as the delete of a disconnected integration.
   */
  reconcileAgents(agentIds: Pick<ReadonlySet<string>, "has">): Effect.Effect<void, StoredStateFailure> {
    return Effect.gen({ self: this }, function* () {
      const gone = new Set(
        this.#snapshot.folders.filter((folder) => !agentIds.has(folder.agentId)).map((folder) => folder.agentId),
      );
      for (const agentId of gone) yield* this.removeAgent(agentId);
    });
  }

  /** Removes the entries of deleted files. */
  removeFiles(fileIds: Iterable<string>): Effect.Effect<LibraryFoldersSnapshot, StoredStateFailure> {
    const deleted = new Set(fileIds);
    return this.#keepFiles((fileId) => !deleted.has(fileId));
  }

  /**
   * Removes the entries of files that the host no longer has, at the start of the app. A file can go
   * on a path that does not call `removeFiles`, such as the delete of a message or a chat, and each
   * entry counts toward the file limit of the folders.
   */
  reconcileFiles(fileIds: Pick<ReadonlySet<string>, "has">): Effect.Effect<LibraryFoldersSnapshot, StoredStateFailure> {
    return this.#keepFiles((fileId) => fileIds.has(fileId));
  }

  #keepFiles(keep: (fileId: string) => boolean): Effect.Effect<LibraryFoldersSnapshot, StoredStateFailure> {
    return this.#enqueue(
      Effect.gen({ self: this }, function* () {
        const entries = Object.entries(this.#snapshot.placement);
        const kept = entries.filter(([fileId]) => keep(fileId));
        if (kept.length === entries.length) return this.getSnapshot();
        yield* this.#commit({
          ...this.#snapshot,
          revision: this.#snapshot.revision + 1,
          placement: Object.fromEntries(kept),
        });
        return this.getSnapshot();
      }),
    );
  }

  #enqueue<T, E>(operation: Effect.Effect<T, E>): Effect.Effect<T, E> {
    return this.#operationQueue.withPermit(operation.pipe(Effect.uninterruptible));
  }

  #commit = Effect.fn("LibraryFolders.commit")(function* (this: LibraryFoldersStore, next: LibraryFoldersSnapshot) {
    yield* writeFileAtomically(this.#path, `${JSON.stringify({ version: STORED_VERSION, ...next })}\n`).pipe(
      Effect.mapError(({ cause }) => new StoredStateFailure({ cause })),
    );
    this.#snapshot = next;
    // The change is saved: a listener that fails must not report it as failed.
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch {
        // The next change or read brings the client up to date.
      }
    }
  });
}

/** The trimmed name, or the localized refusal for a name that is empty or too long. */
function libraryFolderNameOrRefusal(name: string): string {
  try {
    return libraryFolderName(name);
  } catch (error) {
    if (error instanceof LibraryFolderRefusal) throw new LibraryFolderChangeRefused(error.reason);
    throw error;
  }
}
