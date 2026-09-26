// Storage and files: what the host keeps on disk, measured for the Storage tab, the agent Files
// detail and the chat Files panel. Files come from the mailbox state and their chats from the
// database; folders are walked with a bound. Nothing here follows a symbolic link, and nothing here
// deletes outside the cache and log folders the caller names.

import type { Dirent } from "node:fs";
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
import {
  type StoragePlacement,
  type StorageThread,
  storagePlacementPage,
  storageThreadSize,
  storageThreads,
} from "./database/storage-usage-queries";
import type { MailboxStore, MailboxStoredFile } from "./mailbox-store";

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
  mailbox: Pick<MailboxStore, "listStoredFiles" | "deleteStoredFile">;
  agents: () => readonly StorageAgent[];
}

/** The request names an agent or a file the host does not have. The Team API answers 404. */
export class StorageNotFoundError extends Error {}

/** A folder with more entries than this counts what it reached and marks the result truncated. */
const STORAGE_WALK_ENTRY_LIMIT = 100_000;
const STAT_BATCH = 64;
const LOG_FILE = /\.log(\.\d+)?$/;
const CACHE_TTL_MS = 60_000;

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

interface TreeSize {
  bytes: number;
  complete: boolean;
}

/**
 * Bytes of the regular files under `root`. A symbolic link is never followed, so a workspace that
 * links to a large folder does not count it, and a loop cannot run forever.
 */
async function measureTree(root: string, entryLimit = STORAGE_WALK_ENTRY_LIMIT): Promise<TreeSize> {
  let start: string;
  try {
    start = await realpath(root);
    if (!(await lstat(start)).isDirectory()) return { bytes: 0, complete: true };
  } catch {
    return { bytes: 0, complete: true };
  }
  const pending = [start];
  let bytes = 0;
  let entries = 0;
  while (pending.length) {
    const directory = pending.pop() ?? start;
    let children: Dirent[];
    try {
      children = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    const files: string[] = [];
    for (const child of children) {
      if (++entries > entryLimit) return { bytes, complete: false };
      const path = join(directory, child.name);
      if (child.isDirectory()) pending.push(path);
      else if (child.isFile()) files.push(path);
    }
    for (let index = 0; index < files.length; index += STAT_BATCH)
      for (const size of await Promise.all(files.slice(index, index + STAT_BATCH).map(fileSize))) bytes += size;
  }
  return { bytes, complete: true };
}

async function fileSize(path: string): Promise<number> {
  try {
    const info = await lstat(path);
    return info.isFile() ? info.size : 0;
  } catch {
    return 0;
  }
}

async function logFiles(directory: string): Promise<string[]> {
  try {
    const children = await readdir(directory, { withFileTypes: true });
    return children
      .filter((child) => child.isFile() && LOG_FILE.test(child.name))
      .map((child) => join(directory, child.name));
  } catch {
    return [];
  }
}

async function freeBytes(path: string): Promise<number | null> {
  try {
    const filesystem = await statfs(path);
    const free = filesystem.bavail * filesystem.bsize;
    return Number.isSafeInteger(free) && free >= 0 ? free : null;
  } catch {
    return null;
  }
}

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

  async scan(input: GetStorageUsageInput): Promise<StorageUsage> {
    const scannedAt = new Date().toISOString();
    const agents = this.#sources.agents();
    const scopeAgent = input.agentId === undefined ? null : agents.find((agent) => agent.id === input.agentId);
    if (input.scope === "agent" && !scopeAgent)
      throw new StorageNotFoundError(sourceText("error.storage.agentMissing"));

    const db = this.#sources.database();
    let threads = storageThreads(db, input.agentId);
    if (input.scope === "conversation") threads = threads.filter((thread) => thread.threadId === input.conversationId);
    const threadById = new Map(threads.map((thread) => [thread.threadId, thread]));
    const placements = await this.#placements(db, threadById);
    const files = await this.#measureFiles(input, placements, threadById);
    const threadSizes = new Map<string, { messageCount: number; bytes: number }>();
    for (const thread of threads) {
      threadSizes.set(thread.threadId, storageThreadSize(db, thread.threadId));
      await yieldToEventLoop();
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
      const measured = await this.#hostFolders(agents);
      truncated ||= !measured.complete;
      breakdown = [
        breakdownRow("workspaces", measured.workspaces),
        breakdownRow("attachments", sum("attachment")),
        breakdownRow("generated", sum("generated")),
        breakdownRow("chats", await this.#databaseBytes()),
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
      const workspace = await measureTree(scopeAgent.workspacePath);
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
      freeBytes: await freeBytes(this.#sources.roots.data),
      breakdown,
      agents: agentRows,
      conversations: conversations.rows,
      files: fileRows.rows.map((entry) => entry.row),
      truncated,
    };
  }

  /** Placements in the scope's chats, by attachment id. Paged, with a yield between pages. */
  async #placements(
    db: DatabaseSync,
    threadById: ReadonlyMap<string, StorageThread>,
  ): Promise<Map<string, StoragePlacement[]>> {
    const byAttachment = new Map<string, StoragePlacement[]>();
    if (threadById.size === 0) return byAttachment;
    let afterId: string | null = "";
    while (afterId !== null) {
      const page = storagePlacementPage(db, afterId);
      for (const placement of page.placements) {
        if (!threadById.has(placement.threadId)) continue;
        const list = byAttachment.get(placement.attachmentId);
        if (list) list.push(placement);
        else byAttachment.set(placement.attachmentId, [placement]);
      }
      afterId = page.nextId;
      await yieldToEventLoop();
    }
    return byAttachment;
  }

  async #measureFiles(
    input: GetStorageUsageInput,
    placements: ReadonlyMap<string, StoragePlacement[]>,
    threadById: ReadonlyMap<string, StorageThread>,
  ): Promise<MeasuredFile[]> {
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
      const infos = await Promise.all(batch.map((file) => lstat(file.stored.path).catch(() => null)));
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
  }

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

  async #databaseBytes(): Promise<number> {
    const path = this.#sources.roots.database;
    const sizes = await Promise.all([path, `${path}-wal`, `${path}-shm`].map(fileSize));
    return sizes.reduce((total, size) => total + size, 0);
  }

  async #hostFolders(agents: readonly StorageAgent[]) {
    const roots = this.#sources.roots;
    let complete = true;
    const measure = async (path: string) => {
      const size = await measureTree(path);
      complete &&= size.complete;
      return size.bytes;
    };
    // Two agents can share a workspace folder; the disk holds it once.
    const byWorkspace = new Map<string, number>();
    for (const path of new Set(agents.map((agent) => agent.workspacePath))) byWorkspace.set(path, await measure(path));
    let caches = 0;
    for (const path of roots.caches) caches += await measure(path);
    let logs = 0;
    for (const directory of roots.logs)
      for (const size of await Promise.all((await logFiles(directory)).map(fileSize))) logs += size;
    return {
      byWorkspace,
      workspaces: [...byWorkspace.values()].reduce((total, bytes) => total + bytes, 0),
      downloads: await measure(roots.downloads),
      caches,
      runtimes: roots.runtimes ? await measure(roots.runtimes) : 0,
      logs,
      complete,
    };
  }
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
async function clearStorageCategory(roots: StorageRoots, category: ClearableStorageCategory): Promise<void> {
  if (category === "logs") {
    for (const directory of roots.logs)
      await Promise.all((await logFiles(directory)).map((path) => rm(path, { force: true })));
    return;
  }
  for (const directory of roots.caches) {
    let children: Dirent[];
    try {
      children = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    await Promise.all(children.map((child) => rm(join(directory, child.name), { recursive: true, force: true })));
  }
}

function scopeKey(input: GetStorageUsageInput): string {
  return JSON.stringify([input.scope, input.agentId ?? null, input.conversationId ?? null]);
}

/**
 * Scans are slow on a large host, so each scope keeps its last answer for a minute, and two
 * surfaces that ask at the same time share one scan. A delete, a clear, or a change to the agents
 * drops every answer, and a scan that was running at that moment is not kept.
 */
export class StorageUsageService {
  readonly #scanner: Pick<StorageUsageScanner, "scan">;
  readonly #sources: Pick<StorageUsageSources, "roots" | "mailbox">;
  readonly #now: () => number;
  readonly #cache = new Map<string, { at: number; usage: StorageUsage }>();
  readonly #running = new Map<string, Promise<StorageUsage>>();
  #generation = 0;

  constructor(
    scanner: Pick<StorageUsageScanner, "scan">,
    sources: Pick<StorageUsageSources, "roots" | "mailbox">,
    now: () => number = Date.now,
  ) {
    this.#scanner = scanner;
    this.#sources = sources;
    this.#now = now;
  }

  usage(input: GetStorageUsageInput): Promise<StorageUsage> {
    const key = scopeKey(input);
    const cached = this.#cache.get(key);
    if (!input.force && cached && this.#now() - cached.at < CACHE_TTL_MS) return Promise.resolve(cached.usage);
    const running = this.#running.get(key);
    if (running) return running;
    const generation = this.#generation;
    const settled = this.#scanner
      .scan(input)
      .then((usage) => {
        if (generation === this.#generation) this.#cache.set(key, { at: this.#now(), usage });
        return usage;
      })
      .finally(() => {
        if (this.#running.get(key) === settled) this.#running.delete(key);
      });
    this.#running.set(key, settled);
    return settled;
  }

  async deleteFile(fileId: string): Promise<void> {
    if (!this.#sources.mailbox.listStoredFiles().some((file) => file.attachment.id === fileId))
      throw new StorageNotFoundError(sourceText("error.backend.fileGone"));
    try {
      await this.#sources.mailbox.deleteStoredFile(fileId);
    } finally {
      this.invalidate();
    }
  }

  async clear(category: ClearableStorageCategory): Promise<void> {
    try {
      await clearStorageCategory(this.#sources.roots, category);
    } finally {
      this.invalidate();
    }
  }

  invalidate(): void {
    this.#generation += 1;
    this.#cache.clear();
    this.#running.clear();
  }
}
