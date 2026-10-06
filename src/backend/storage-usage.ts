// Storage and files: what the host keeps on disk, measured for the Storage tab, the agent Files
// detail and the chat Files panel. Files come from the mailbox state and their chats from the
// database; folders are walked with a bound. Nothing here follows a symbolic link, and nothing here
// deletes outside the cache and log folders the caller names.

import { lstat, readdir, realpath, rm, statfs } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentStorageRow,
  CLEARABLE_STORAGE_CATEGORIES,
  type ClearableStorageCategory,
  type ConversationStorageRow,
  type GetStorageUsageInput,
  STORAGE_LIMITS,
  type StorageBreakdown,
  type StorageCategory,
  type StorageUsage,
  type StoredFileRow,
} from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Exit, Fiber, Result, Scope, Semaphore } from "effect";
import {
  type StoragePlacement,
  type StorageThread,
  storagePlacementPage,
  storageThreadSize,
  storageThreads,
} from "./database/storage-usage-queries";
import type { MailboxStore, MailboxStoredFile } from "./mailbox-store";
import { StoredStateFailure, storedIO, storedSync } from "./stored-state-effects";

export interface StorageRoots {
  /** The SQLite file. Its `-wal` and `-shm` companions are counted with it. */
  database: string;
  downloads: string;
  /** Folders of copies the app can download again. Clear removes what is in them. */
  caches: readonly string[];
  /** Folders of rotated log files. Only `*.log` and `*.log.N` files directly in them count. */
  logs: readonly string[];
  runtimes: string | null;
  /** A path on the disk that holds the host data, for the free space. */
  data: string;
}

export interface StorageAgent {
  id: string;
  workspacePath: string;
}

export interface StorageUsageSources {
  roots: StorageRoots;
  database: () => DatabaseSync;
  mailbox: {
    listStoredFiles: MailboxStore["listStoredFiles"];
    deleteStoredFile: OmitThisParameter<MailboxStore["deleteStoredFile"]>;
  };
  agents: () => readonly StorageAgent[];
}

/** The request names an agent or a file the host does not have. The Team API answers 404. */
export class StorageNotFoundError extends Error {}

/** A folder with more entries than this counts what it reached and marks the result truncated. */
const STORAGE_WALK_ENTRY_LIMIT = 100_000;
const STAT_BATCH = 64;
const LOG_FILE = /\.log(\.\d+)?$/;
const CACHE_TTL_MS = 60_000;

const yieldToEventLoop = Effect.callback<void>((resume) => {
  const pending = setImmediate(() => resume(Effect.void));
  return Effect.sync(() => clearImmediate(pending));
});

interface TreeSize {
  bytes: number;
  complete: boolean;
}

/**
 * Bytes of the regular files under `root`. A symbolic link is never followed, so a workspace that
 * links to a large folder does not count it, and a loop cannot run forever.
 */
const measureTree = Effect.fn("StorageUsage.measureTree")(function* (
  root: string,
  entryLimit = STORAGE_WALK_ENTRY_LIMIT,
): Effect.fn.Return<TreeSize, StoredStateFailure> {
  const resolved = yield* Effect.result(
    Effect.gen(function* () {
      const path = yield* storedIO(() => realpath(root));
      const stats = yield* storedIO(() => lstat(path));
      return stats.isDirectory() ? path : null;
    }),
  );
  if (Result.isFailure(resolved) || resolved.success === null) return { bytes: 0, complete: true };
  const start = resolved.success;
  const pending = [start];
  let bytes = 0;
  let entries = 0;
  while (pending.length) {
    const directory = pending.pop() ?? start;
    const children = yield* Effect.result(storedIO(() => readdir(directory, { withFileTypes: true })));
    if (Result.isFailure(children)) continue;
    const files: string[] = [];
    for (const child of children.success) {
      if (++entries > entryLimit) return { bytes, complete: false };
      const path = join(directory, child.name);
      if (child.isDirectory()) pending.push(path);
      else if (child.isFile()) files.push(path);
    }
    for (let index = 0; index < files.length; index += STAT_BATCH)
      for (const size of yield* Effect.forEach(files.slice(index, index + STAT_BATCH), fileSize, {
        concurrency: STAT_BATCH,
      }))
        bytes += size;
  }
  return { bytes, complete: true };
});

const fileSize = Effect.fn("StorageUsage.fileSize")((path: string) =>
  storedIO(() => lstat(path)).pipe(
    Effect.map((info) => (info.isFile() ? info.size : 0)),
    Effect.catch(() => Effect.succeed(0)),
  ),
);
const logFiles = Effect.fn("StorageUsage.logFiles")((directory: string) =>
  storedIO(() => readdir(directory, { withFileTypes: true })).pipe(
    Effect.map((children) =>
      children
        .filter((child) => child.isFile() && LOG_FILE.test(child.name))
        .map((child) => join(directory, child.name)),
    ),
    Effect.catch(() => Effect.succeed([])),
  ),
);
const freeBytes = Effect.fn("StorageUsage.freeBytes")((path: string) =>
  storedIO(() => statfs(path)).pipe(
    Effect.map((filesystem) => {
      const free = filesystem.bavail * filesystem.bsize;
      return Number.isSafeInteger(free) && free >= 0 ? free : null;
    }),
    Effect.catch(() => Effect.succeed(null)),
  ),
);

/** A wire identifier or nothing, so one odd id drops a link instead of failing the whole answer. */
function wireId(value: string | null | undefined): string | null {
  return value && value.length <= INPUT_LIMITS.identifier ? value : null;
}

interface MeasuredFile {
  stored: MailboxStoredFile;
  placement: StoragePlacement | null;
  /** Every chat of the scope that shows the file. */
  threadIds: ReadonlySet<string>;
  agentId: string | null;
  bytes: number;
  status: "available" | "missing";
  modifiedAt: string | null;
}

function breakdownRow(category: StorageCategory, bytes: number): StorageBreakdown {
  return { category, bytes, removable: isOneOf(CLEARABLE_STORAGE_CATEGORIES, category) };
}

function largestFirst<T extends { bytes: number }>(rows: T[], limit: number): { rows: T[]; cut: boolean } {
  rows.sort((left, right) => right.bytes - left.bytes);
  return { rows: rows.slice(0, limit), cut: rows.length > limit };
}

export class StorageUsageScanner {
  readonly #sources: StorageUsageSources;

  constructor(sources: StorageUsageSources) {
    this.#sources = sources;
  }

  scan = Effect.fn("StorageUsage.scan")(function* (
    this: StorageUsageScanner,
    input: GetStorageUsageInput,
  ): Effect.fn.Return<StorageUsage, StoredStateFailure> {
    const scannedAt = new Date().toISOString();
    const agents = this.#sources.agents();
    const scopeAgent = input.agentId === undefined ? null : agents.find((agent) => agent.id === input.agentId);
    if (input.scope === "agent" && !scopeAgent)
      return yield* new StoredStateFailure({
        cause: new StorageNotFoundError(sourceText("error.storage.agentMissing")),
      });

    const db = this.#sources.database();
    let threads = yield* storedSync(() => storageThreads(db, input.agentId));
    if (input.scope === "conversation") threads = threads.filter((thread) => thread.threadId === input.conversationId);
    const threadById = new Map(threads.map((thread) => [thread.threadId, thread]));
    const placements = yield* this.#placements(db, threadById);
    const files = yield* this.#measureFiles(input, placements, threadById);
    const threadSizes = new Map<string, { messageCount: number; bytes: number }>();
    for (const thread of threads) {
      threadSizes.set(thread.threadId, yield* storedSync(() => storageThreadSize(db, thread.threadId)));
      yield* yieldToEventLoop;
    }

    const filesByThread = new Map<string, MeasuredFile[]>();
    for (const file of files)
      for (const threadId of file.threadIds) {
        const shown = filesByThread.get(threadId);
        if (shown) shown.push(file);
        else filesByThread.set(threadId, [file]);
      }
    let truncated = false;
    const conversations = largestFirst(
      threads.flatMap(
        (thread) => this.#conversationRow(thread, threadSizes, filesByThread.get(thread.threadId) ?? []) ?? [],
      ),
      STORAGE_LIMITS.conversations,
    );
    const fileRows = largestFirst(
      files.map((file) => ({ bytes: file.bytes, row: this.#fileRow(file, threadById, scannedAt) })),
      STORAGE_LIMITS.files,
    );
    truncated ||= conversations.cut || fileRows.cut;

    const sum = (source: MailboxStoredFile["source"]) =>
      uniqueBytes(files.filter((file) => file.stored.source === source));
    const chatBytes = [...threadSizes.values()].reduce((total, size) => total + size.bytes, 0);
    let breakdown: StorageBreakdown[];
    let agentRows: AgentStorageRow[] = [];
    if (input.scope === "host") {
      const measured = yield* this.#hostFolders(agents);
      truncated ||= !measured.complete;
      breakdown = [
        breakdownRow("workspaces", measured.workspaces),
        breakdownRow("attachments", sum("attachment")),
        breakdownRow("generated", sum("generated")),
        breakdownRow("chats", yield* this.#databaseBytes()),
        breakdownRow("downloads", measured.downloads),
        breakdownRow("caches", measured.caches),
        breakdownRow("runtimes", measured.runtimes),
        breakdownRow("logs", measured.logs),
      ];
      const agentList = largestFirst(
        agents.flatMap((agent) => {
          const id = wireId(agent.id);
          if (!id) return [];
          return [this.#agentRow(id, measured.byWorkspace.get(agent.workspacePath) ?? 0, files, threads, threadSizes)];
        }),
        STORAGE_LIMITS.agents,
      );
      agentRows = agentList.rows;
      truncated ||= agentList.cut;
    } else if (input.scope === "agent" && scopeAgent) {
      const workspace = yield* measureTree(scopeAgent.workspacePath);
      truncated ||= !workspace.complete;
      breakdown = [
        breakdownRow("workspaces", workspace.bytes),
        breakdownRow("attachments", sum("attachment")),
        breakdownRow("generated", sum("generated")),
        breakdownRow("chats", chatBytes),
      ];
      agentRows = [this.#agentRow(scopeAgent.id, workspace.bytes, files, threads, threadSizes)];
    } else {
      breakdown = [
        breakdownRow("attachments", sum("attachment")),
        breakdownRow("generated", sum("generated")),
        breakdownRow("chats", chatBytes),
      ];
    }

    return {
      scope: input.scope,
      agentId: input.agentId ?? null,
      conversationId: input.conversationId ?? null,
      scannedAt,
      freeBytes: yield* freeBytes(this.#sources.roots.data),
      breakdown,
      agents: agentRows,
      conversations: conversations.rows,
      files: fileRows.rows.map((entry) => entry.row),
      truncated,
    };
  }).bind(this);

  /** Placements in the scope's chats, by attachment id. Paged, with a yield between pages. */
  #placements = Effect.fn("StorageUsage.placements")(function* (
    this: StorageUsageScanner,
    db: DatabaseSync,
    threadById: ReadonlyMap<string, StorageThread>,
  ): Effect.fn.Return<Map<string, StoragePlacement[]>, StoredStateFailure> {
    const byAttachment = new Map<string, StoragePlacement[]>();
    if (threadById.size === 0) return byAttachment;
    let afterId: string | null = "";
    while (afterId !== null) {
      const cursor: string = afterId;
      const page: ReturnType<typeof storagePlacementPage> = yield* storedSync(() => storagePlacementPage(db, cursor));
      for (const placement of page.placements) {
        if (!threadById.has(placement.threadId)) continue;
        const list = byAttachment.get(placement.attachmentId);
        if (list) list.push(placement);
        else byAttachment.set(placement.attachmentId, [placement]);
      }
      afterId = page.nextId;
      yield* yieldToEventLoop;
    }
    return byAttachment;
  });

  #measureFiles = Effect.fn("StorageUsage.measureFiles")(function* (
    this: StorageUsageScanner,
    input: GetStorageUsageInput,
    placements: ReadonlyMap<string, StoragePlacement[]>,
    threadById: ReadonlyMap<string, StorageThread>,
  ): Effect.fn.Return<MeasuredFile[], StoredStateFailure> {
    const seen = new Set<string>();
    const selected: Omit<MeasuredFile, "bytes" | "status" | "modifiedAt">[] = [];
    for (const stored of this.#sources.mailbox.listStoredFiles()) {
      if (seen.has(stored.attachment.id)) continue;
      const shown = [...(placements.get(stored.attachment.id) ?? [])].sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt),
      );
      const inScope =
        input.scope === "host" || shown.length > 0 || (input.scope === "agent" && stored.agentId === input.agentId);
      if (!inScope) continue;
      seen.add(stored.attachment.id);
      const placement = shown[0] ?? null;
      const placementAgent = placement ? (threadById.get(placement.threadId)?.agentId ?? null) : null;
      selected.push({
        stored,
        placement,
        threadIds: new Set(shown.map((entry) => entry.threadId)),
        agentId: input.scope === "agent" ? (input.agentId ?? null) : (placementAgent ?? stored.agentId),
      });
    }
    const measured: MeasuredFile[] = [];
    for (let index = 0; index < selected.length; index += STAT_BATCH) {
      const batch = selected.slice(index, index + STAT_BATCH);
      const infos = yield* Effect.forEach(
        batch,
        (file) => storedIO(() => lstat(file.stored.path)).pipe(Effect.catch(() => Effect.succeed(null))),
        { concurrency: STAT_BATCH },
      );
      batch.forEach((file, offset) => {
        const info = infos[offset];
        const available = info?.isFile() === true;
        measured.push({
          ...file,
          bytes: available ? info.size : 0,
          status: available ? "available" : "missing",
          modifiedAt: available ? info.mtime.toISOString() : null,
        });
      });
    }
    return measured;
  });

  #fileRow(file: MeasuredFile, threadById: ReadonlyMap<string, StorageThread>, scannedAt: string): StoredFileRow {
    const thread = file.placement ? threadById.get(file.placement.threadId) : undefined;
    const conversationId = wireId(thread?.threadId);
    const messageId = conversationId ? wireId(file.placement?.messageId) : null;
    return {
      ...file.stored.attachment,
      source: file.stored.source,
      agentId: wireId(file.agentId),
      conversation:
        thread && conversationId ? { id: conversationId, title: thread.title.slice(0, STORAGE_LIMITS.title) } : null,
      messageId,
      createdAt: file.stored.createdAt ?? file.placement?.createdAt ?? file.modifiedAt ?? scannedAt,
      status: file.status,
      deletable: true,
    };
  }

  #conversationRow(
    thread: StorageThread,
    threadSizes: ReadonlyMap<string, { messageCount: number; bytes: number }>,
    shown: readonly MeasuredFile[],
  ): ConversationStorageRow | null {
    const id = wireId(thread.threadId);
    const agentId = wireId(thread.agentId);
    if (!id || !agentId) return null;
    const size = threadSizes.get(thread.threadId) ?? { messageCount: 0, bytes: 0 };
    return {
      id,
      title: thread.title.slice(0, STORAGE_LIMITS.title),
      agentId,
      bytes: size.bytes + uniqueBytes(shown),
      fileCount: shown.length,
      messageCount: size.messageCount,
    };
  }

  #agentRow(
    agentId: string,
    workspaceBytes: number,
    files: readonly MeasuredFile[],
    threads: readonly StorageThread[],
    threadSizes: ReadonlyMap<string, { bytes: number }>,
  ): AgentStorageRow {
    const chats = threads.filter((thread) => thread.agentId === agentId);
    // The same rule as the agent scope: a file shown in two agents' chats counts for both.
    const owned = files.filter((file) =>
      file.threadIds.size === 0
        ? file.agentId === agentId
        : chats.some((thread) => file.threadIds.has(thread.threadId)),
    );
    const chatBytes = chats.reduce((total, thread) => total + (threadSizes.get(thread.threadId)?.bytes ?? 0), 0);
    return {
      agentId,
      bytes: workspaceBytes + uniqueBytes(owned) + chatBytes,
      fileCount: owned.length,
      conversationCount: chats.length,
    };
  }

  #databaseBytes = Effect.fn("StorageUsage.databaseBytes")(function* (
    this: StorageUsageScanner,
  ): Effect.fn.Return<number, StoredStateFailure> {
    const path = this.#sources.roots.database;
    const sizes = yield* Effect.forEach([path, `${path}-wal`, `${path}-shm`], fileSize, { concurrency: "unbounded" });
    return sizes.reduce((total, size) => total + size, 0);
  });

  #hostFolders = Effect.fn("StorageUsage.hostFolders")(function* (
    this: StorageUsageScanner,
    agents: readonly StorageAgent[],
  ) {
    const roots = this.#sources.roots;
    let complete = true;
    const measure = (path: string) =>
      Effect.gen(function* () {
        const size = yield* measureTree(path);
        complete &&= size.complete;
        return size.bytes;
      });
    // Two agents can share a workspace folder; the disk holds it once.
    const byWorkspace = new Map<string, number>();
    for (const path of new Set(agents.map((agent) => agent.workspacePath))) byWorkspace.set(path, yield* measure(path));
    let caches = 0;
    for (const path of roots.caches) caches += yield* measure(path);
    let logs = 0;
    for (const directory of roots.logs)
      for (const size of yield* Effect.forEach(yield* logFiles(directory), fileSize, { concurrency: "unbounded" }))
        logs += size;
    return {
      byWorkspace,
      workspaces: [...byWorkspace.values()].reduce((total, bytes) => total + bytes, 0),
      downloads: yield* measure(roots.downloads),
      caches,
      runtimes: roots.runtimes ? yield* measure(roots.runtimes) : 0,
      logs,
      complete,
    };
  });
}

/** Two records can point at one file on disk; count it once. */
function uniqueBytes(files: readonly MeasuredFile[]): number {
  const byPath = new Map<string, number>();
  for (const file of files) byPath.set(file.stored.path, file.bytes);
  return [...byPath.values()].reduce((total, bytes) => total + bytes, 0);
}

/**
 * Removes what is in each cache folder, or the rotated log files, and nothing else: the folders
 * stay, and a subfolder of a log folder (such as the transfer journal) is not touched.
 */
const clearStorageCategory = Effect.fn("StorageUsage.clearCategory")(function* (
  roots: StorageRoots,
  category: ClearableStorageCategory,
) {
  if (category === "logs") {
    for (const directory of roots.logs)
      yield* Effect.forEach(yield* logFiles(directory), (path) => storedIO(() => rm(path, { force: true })), {
        concurrency: "unbounded",
        discard: true,
      });
    return;
  }
  for (const directory of roots.caches) {
    const children = yield* Effect.result(storedIO(() => readdir(directory, { withFileTypes: true })));
    if (Result.isFailure(children)) continue;
    yield* Effect.forEach(
      children.success,
      (child) => storedIO(() => rm(join(directory, child.name), { recursive: true, force: true })),
      { concurrency: "unbounded", discard: true },
    );
  }
});

function scopeKey(input: GetStorageUsageInput): string {
  return JSON.stringify([input.scope, input.agentId ?? null, input.conversationId ?? null]);
}

/**
 * Scans are slow on a large host, so each scope keeps its last answer for a minute, and two
 * surfaces that ask at the same time share one scan. A delete, a clear, or a change to the agents
 * drops every answer, and a scan that was running at that moment is not kept.
 */
export class StorageUsageService {
  readonly #scanner: { scan: OmitThisParameter<StorageUsageScanner["scan"]> };
  readonly #sources: Pick<StorageUsageSources, "roots" | "mailbox">;
  readonly #now: () => number;
  readonly #cache = new Map<string, { at: number; usage: StorageUsage }>();
  readonly #running = new Map<string, { token: symbol; fiber: Fiber.Fiber<StorageUsage, StoredStateFailure> }>();
  readonly #scope = Scope.makeUnsafe();
  readonly #scanGate = Semaphore.makeUnsafe(1);
  #generation = 0;

  constructor(
    scanner: { scan: OmitThisParameter<StorageUsageScanner["scan"]> },
    sources: Pick<StorageUsageSources, "roots" | "mailbox">,
    now: () => number = Date.now,
  ) {
    this.#scanner = scanner;
    this.#sources = sources;
    this.#now = now;
  }

  readonly usage = Effect.fn("StorageUsage.usage")(function* (this: StorageUsageService, input: GetStorageUsageInput) {
    const work = yield* this.#scanGate.withPermit(
      Effect.gen({ self: this }, function* () {
        const key = scopeKey(input);
        const cached = this.#cache.get(key);
        if (!input.force && cached && this.#now() - cached.at < CACHE_TTL_MS) return Effect.succeed(cached.usage);
        const running = this.#running.get(key);
        if (running) return Fiber.join(running.fiber);
        const generation = this.#generation;
        const token = Symbol();
        const fiber = yield* this.#scanner.scan(input).pipe(
          Effect.tap((usage) =>
            Effect.sync(() => {
              if (generation === this.#generation) this.#cache.set(key, { at: this.#now(), usage });
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              if (this.#running.get(key)?.token === token) this.#running.delete(key);
            }),
          ),
          Effect.forkIn(this.#scope),
        );
        this.#running.set(key, { token, fiber });
        return Fiber.join(fiber);
      }),
    );
    return yield* work;
  }).bind(this);

  readonly deleteFile = Effect.fn("StorageUsage.deleteFile")(function* (this: StorageUsageService, fileId: string) {
    if (!this.#sources.mailbox.listStoredFiles().some((file) => file.attachment.id === fileId))
      return yield* new StoredStateFailure({ cause: new StorageNotFoundError(sourceText("error.backend.fileGone")) });
    yield* this.#sources.mailbox.deleteStoredFile(fileId).pipe(Effect.ensuring(Effect.sync(() => this.invalidate())));
  }).bind(this);

  clear(category: ClearableStorageCategory) {
    return clearStorageCategory(this.#sources.roots, category).pipe(
      Effect.ensuring(Effect.sync(() => this.invalidate())),
    );
  }

  dispose() {
    return Scope.close(this.#scope, Exit.void);
  }

  invalidate(): void {
    this.#generation += 1;
    this.#cache.clear();
    this.#running.clear();
  }
}
