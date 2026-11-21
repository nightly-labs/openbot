import type {
  LibraryFolderAction,
  LibraryFolderContext,
  LibraryFoldersSnapshot,
  StoredFileWorkflow,
} from "@openbot/contracts/ipc";
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
): { agentIds: string[]; folderIds: string[]; fileIds: string[]; unfiledIds?: string[] } {
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
          unfiledIds: action.fileIds,
        };
      return {
        agentIds: [],
        folderIds: [action.folderId, ...action.fileIds.flatMap((fileId) => snapshot.placement[fileId] ?? [])],
        fileIds: action.fileIds,
      };
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

export interface AgentlessFile {
  id: string;
  workflowId: string | null;
}

export interface LibraryFolderActionAgents {
  agentIds: ReadonlySet<string>;
  orphanFile: boolean;
  agentlessFiles: readonly AgentlessFile[];
}

function actionAgents(
  targets: ReturnType<typeof actionTargets>,
  snapshot: LibraryFoldersSnapshot,
  known: KnownFiles,
  living: ReadonlySet<string>,
): LibraryFolderActionAgents {
  const folders = new Map(snapshot.folders.map((folder) => [folder.id, folder.agentId]));
  const agentIds = new Set(targets.agentIds);
  for (const folderId of targets.folderIds) {
    const agentId = folders.get(folderId);
    if (agentId !== undefined) agentIds.add(agentId);
  }
  let orphanFile = false;
  const agentlessFiles: AgentlessFile[] = [];
  for (const fileId of new Set(targets.fileIds)) {
    const agentId = known.agents.get(fileId);
    if (agentId === undefined) continue;
    if (agentId === null) agentlessFiles.push({ id: fileId, workflowId: known.workflows.get(fileId)?.id ?? null });
    else if (!living.has(agentId)) orphanFile = true;
    else agentIds.add(agentId);
  }
  for (const fileId of new Set(targets.unfiledIds)) {
    const workflow = known.workflows.get(fileId);
    if (workflow && known.agents.get(fileId) === null) agentlessFiles.push({ id: fileId, workflowId: workflow.id });
  }
  return { agentIds, orphanFile, agentlessFiles };
}

interface KnownFiles {
  at: number;
  agents: ReadonlyMap<string, string | null>;
  workflows: ReadonlyMap<string, StoredFileWorkflow>;
}

function placeableAgent(known: KnownFiles, fileId: string): string | null | undefined {
  const agentId = known.agents.get(fileId);
  return agentId === null && !known.workflows.has(fileId) ? undefined : agentId;
}

const NO_FILES: KnownFiles = { at: 0, agents: new Map(), workflows: new Map() };

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
    const known =
      targets.fileIds.length > 0
        ? yield* this.#lookUp(
            targets.fileIds.map((id) => ({ id, storedAt: null })),
            false,
          )
        : authorize && targets.unfiledIds
          ? yield* this.#lookUp([], true)
          : NO_FILES;
    const agentIds = new Set(this.#sources.agents().map((agent) => agent.id));
    if (authorize) {
      const agents = actionAgents(targets, snapshot, known, agentIds);
      yield* storedSync(() => authorize(agents));
    }
    const context: LibraryFolderContext = { agentIds, fileAgent: (fileId) => placeableAgent(known, fileId) };
    return yield* this.#sources.store.mutate(action, context);
  }).bind(this);

  readonly workflowFiles = Effect.fn("LibraryFolders.workflowFiles")(function* (this: LibraryFoldersService) {
    const known = yield* this.#lookUp([], true);
    return known.workflows;
  }).bind(this);

  removeAgent(agentId: string) {
    return this.#sources.store.removeAgent(agentId);
  }

  removeFiles(fileIds: readonly string[]) {
    const known = this.#known;
    if (known) {
      const agents = new Map(known.agents);
      const workflows = new Map(known.workflows);
      for (const fileId of fileIds) {
        agents.delete(fileId);
        workflows.delete(fileId);
      }
      this.#known = { at: known.at, agents, workflows };
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
      fileAgents: (files) => this.#lookUp(files, true).pipe(Effect.map((known) => known.agents)),
      fileWorkflows: (files) => this.#lookUp(files, true).pipe(Effect.map((known) => known.workflows)),
    };
  }

  #known: KnownFiles | null = null;

  readonly #lookUp = Effect.fn("LibraryFolders.fileAgents")(function* (
    this: LibraryFoldersService,
    files: readonly LibraryFileStamp[],
    useKept: boolean,
  ) {
    const missing = (known: KnownFiles) =>
      files.some(
        (file) => !known.agents.has(file.id) && (file.storedAt === null || Date.parse(file.storedAt) >= known.at),
      );
    if (useKept && this.#known && !missing(this.#known)) return this.#known;
    const scan = () =>
      this.#sources.storage.usage({ scope: "host" }).pipe(
        Effect.map((usage) => {
          const known: KnownFiles = {
            at: Date.parse(usage.scannedAt),
            agents: new Map(usage.files.map((file) => [file.id, file.agentId])),
            workflows: new Map(usage.files.flatMap((file) => (file.workflow ? [[file.id, file.workflow]] : []))),
          };
          this.#known = known;
          return known;
        }),
      );
    const known = yield* scan();
    if (!missing(known)) return known;
    this.#sources.storage.invalidate();
    return yield* scan();
  }).bind(this);
}
