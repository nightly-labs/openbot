// Library folders of this host: the one place that gives a folder change what the stored snapshot
// does not hold, which is the agents that exist and the agent of each file. The IPC handler of this
// computer and the `library-folders-v1` route of the Team API both change the folders through it, so
// a joined server applies the same rules.

import type { LibraryFolderAction, LibraryFolderContext, LibraryFoldersSnapshot } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentLibraryFolders, LibraryFileStamp } from "../backend/agent/library-folder-tools";
import type { LibraryFoldersStore } from "../backend/library-folders-store";
import type { StorageUsageService } from "../backend/storage-usage";
import { storedSync } from "../backend/stored-state-effects";

export interface LibraryFoldersSources {
  store: Pick<LibraryFoldersStore, "getSnapshot" | "mutate" | "placeInPath" | "removeAgent" | "removeFiles">;
  /**
   * The Library shows the files of the host scan, each below the agent that the scan gives it. A
   * folder change must use the same agent, so it reads the same scan.
   */
  storage: Pick<StorageUsageService, "usage" | "invalidate">;
  agents: () => readonly { id: string }[];
}

/**
 * The agents and the folders that an action names, and the files whose agent it needs. A file that
 * goes out of its folder needs no scan: a folder holds only files of its own agent, so the folder
 * gives the agent.
 */
function actionTargets(
  action: LibraryFolderAction,
  snapshot: LibraryFoldersSnapshot,
): { agentIds: string[]; folderIds: string[]; fileIds: string[] } {
  switch (action.type) {
    case "create":
      return {
        agentIds: [action.agentId],
        folderIds: action.parentId === undefined ? [] : [action.parentId],
        fileIds: action.fileIds ?? [],
      };
    case "rename":
    case "delete":
      return { agentIds: [], folderIds: [action.folderId], fileIds: [] };
    case "move":
      return {
        agentIds: [],
        folderIds: [action.folderId, action.parentId, action.beforeFolderId].flatMap((id) => (id === null ? [] : [id])),
        fileIds: [],
      };
    case "place":
      if (action.folderId === null)
        return {
          agentIds: [],
          folderIds: action.fileIds.flatMap((fileId) => snapshot.placement[fileId] ?? []),
          fileIds: [],
        };
      return { agentIds: [], folderIds: [action.folderId], fileIds: action.fileIds };
    case "restore":
      return {
        agentIds: action.folders.map((entry) => entry.folder.agentId),
        folderIds: [
          ...action.folders.flatMap((entry) => (entry.folder.parentId === undefined ? [] : [entry.folder.parentId])),
          ...Object.values(action.placement),
        ],
        fileIds: Object.keys(action.placement),
      };
  }
}

/**
 * The agents whose Library an action changes, so the Team API can check the level of the member for
 * each one. A file whose agent the host does not have (a deleted agent, or no agent) cannot go into a
 * folder: `orphanFile` names it, so the route answers as for a file that is gone.
 */
export interface LibraryFolderActionAgents {
  agentIds: ReadonlySet<string>;
  orphanFile: boolean;
}

/**
 * The agents that an action names, the agents of the folders that it names, and the agents of the
 * files that it names. A folder or a file that the host does not have adds no agent; the change then
 * refuses it.
 */
function actionAgents(
  targets: ReturnType<typeof actionTargets>,
  snapshot: LibraryFoldersSnapshot,
  fileAgents: ReadonlyMap<string, string | null>,
  living: ReadonlySet<string>,
): LibraryFolderActionAgents {
  const folders = new Map(snapshot.folders.map((folder) => [folder.id, folder.agentId]));
  const agentIds = new Set(targets.agentIds);
  for (const folderId of targets.folderIds) {
    const agentId = folders.get(folderId);
    if (agentId !== undefined) agentIds.add(agentId);
  }
  let orphanFile = false;
  for (const fileId of targets.fileIds) {
    const agentId = fileAgents.get(fileId);
    if (agentId === undefined) continue;
    if (agentId === null || !living.has(agentId)) orphanFile = true;
    else agentIds.add(agentId);
  }
  return { agentIds, orphanFile };
}

interface KnownFileAgents {
  /** Milliseconds since the epoch. */
  at: number;
  agents: ReadonlyMap<string, string | null>;
}

export class LibraryFoldersService {
  readonly #sources: LibraryFoldersSources;

  constructor(sources: LibraryFoldersSources) {
    this.#sources = sources;
  }

  snapshot(): LibraryFoldersSnapshot {
    return this.#sources.store.getSnapshot();
  }

  /**
   * Applies one change. `authorize` gets the agents whose Library the change changes, from the same
   * scan as the change, and throws to refuse it: its error is then the cause of the failure. The store
   * refuses a change that the rules do not permit with a `LibraryFolderChangeRefused` as the cause.
   */
  readonly change = Effect.fn("LibraryFolders.change")(function* (
    this: LibraryFoldersService,
    action: LibraryFolderAction,
    authorize?: (agents: LibraryFolderActionAgents) => void,
  ) {
    const snapshot = this.#sources.store.getSnapshot();
    const targets = actionTargets(action, snapshot);
    const fileAgents =
      targets.fileIds.length === 0
        ? new Map<string, string | null>()
        : yield* this.#lookUp(
            targets.fileIds.map((id) => ({ id, storedAt: null })),
            false,
          );
    const agentIds = new Set(this.#sources.agents().map((agent) => agent.id));
    if (authorize) {
      const agents = actionAgents(targets, snapshot, fileAgents, agentIds);
      yield* storedSync(() => authorize(agents));
    }
    const context: LibraryFolderContext = { agentIds, fileAgent: (fileId) => fileAgents.get(fileId) };
    return yield* this.#sources.store.mutate(action, context);
  }).bind(this);

  /** Removes the folders of a deleted agent and the entries of its files. */
  removeAgent(agentId: string) {
    return this.#sources.store.removeAgent(agentId);
  }

  /**
   * Removes the entries of deleted files. The files are already gone, so a failed write does not fail
   * the delete: the next start removes the entries.
   */
  removeFiles(fileIds: readonly string[]) {
    const known = this.#known;
    if (known) {
      const agents = new Map(known.agents);
      for (const fileId of fileIds) agents.delete(fileId);
      this.#known = { at: known.at, agents };
    }
    return this.#sources.store.removeFiles(fileIds).pipe(Effect.catch(() => Effect.void));
  }

  /**
   * The folders for the agent tools of this host: the same store, and the agent of each file from the
   * same scan, so an agent can organize each file that the Library shows under it.
   */
  forAgents(): AgentLibraryFolders {
    const store = this.#sources.store;
    return {
      getSnapshot: () => store.getSnapshot(),
      placeInPath: (agentId, names, fileIds, context) => store.placeInPath(agentId, names, fileIds, context),
      mutate: (action, context) => store.mutate(action, context),
      removeAgent: (agentId) => store.removeAgent(agentId),
      fileAgents: (files) => this.#lookUp(files, true),
    };
  }

  /**
   * The last host scan: the agent of each file that it lists, and the time of the scan. The agent of a
   * stored file does not change, so the agent tools use the map with no time limit: they find a deleted
   * file in the stored files first. A member's change uses the scan of the storage service, which is
   * kept for a short time only, so it refuses a file that a path other than `removeFiles` deleted.
   */
  #known: KnownFileAgents | null = null;

  /**
   * The agent of each file that the host scan lists. With `useKept`, the kept map answers, and a new scan
   * runs only when a file is not in it and was stored after it, or has no stored time: a file that the
   * scan leaves out (it lists the largest files only) thus does not start a scan on each call. Without
   * `useKept`, the scan of the storage service answers.
   */
  readonly #lookUp = Effect.fn("LibraryFolders.fileAgents")(function* (
    this: LibraryFoldersService,
    files: readonly LibraryFileStamp[],
    useKept: boolean,
  ) {
    const missing = (known: KnownFileAgents) =>
      files.some(
        (file) => !known.agents.has(file.id) && (file.storedAt === null || Date.parse(file.storedAt) >= known.at),
      );
    if (useKept && this.#known && !missing(this.#known)) return this.#known.agents;
    const scan = () =>
      this.#sources.storage.usage({ scope: "host" }).pipe(
        Effect.map((usage) => {
          const known: KnownFileAgents = {
            at: Date.parse(usage.scannedAt),
            agents: new Map(usage.files.map((file) => [file.id, file.agentId])),
          };
          this.#known = known;
          return known;
        }),
      );
    const known = yield* scan();
    if (!missing(known)) return known.agents;
    this.#sources.storage.invalidate();
    return (yield* scan()).agents;
  }).bind(this);
}
