import type { LibraryFolderAction, LibraryFolderContext, LibraryFoldersSnapshot } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentLibraryFolders, LibraryFileStamp } from "../backend/agent/library-folder-tools";
import type { LibraryFoldersStore } from "../backend/library-folders-store";
import type { StorageUsageService } from "../backend/storage-usage";
import { storedSync } from "../backend/stored-state-effects";

export interface LibraryFoldersSources {
  store: Pick<LibraryFoldersStore, "getSnapshot" | "mutate" | "placeInPath" | "removeAgent" | "removeFiles">;
  storage: Pick<StorageUsageService, "usage" | "invalidate">;
  agents: () => readonly { id: string }[];
}

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

export interface LibraryFolderActionAgents {
  agentIds: ReadonlySet<string>;
  orphanFile: boolean;
}

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

  removeAgent(agentId: string) {
    return this.#sources.store.removeAgent(agentId);
  }

  removeFiles(fileIds: readonly string[]) {
    const known = this.#known;
    if (known) {
      const agents = new Map(known.agents);
      for (const fileId of fileIds) agents.delete(fileId);
      this.#known = { at: known.at, agents };
    }
    return this.#sources.store.removeFiles(fileIds).pipe(Effect.catch(() => Effect.void));
  }

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

  #known: KnownFileAgents | null = null;

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
