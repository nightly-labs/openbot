import { createHash } from "node:crypto";
import {
  isSyncKey,
  parseSyncName,
  SYNC_LIMITS,
  type SyncClientMessage,
  type SyncLogReference,
  type SyncLogRow,
  type SyncName,
  type SyncServerMessage,
  type SyncUpsert,
} from "@openbot/contracts/team-protocol/sync-v1";

type MaybePromise<T> = T | Promise<T>;

export type SyncEntries = Iterable<readonly [key: string, value: unknown]>;

export interface SyncHostCollection<Viewer> {
  readonly name: string;
  readonly scoped?: boolean;
  read(viewer: Viewer, param: string | null): MaybePromise<SyncEntries | null>;
  readKeys?(
    viewer: Viewer,
    param: string | null,
    keys: readonly string[],
  ): MaybePromise<Iterable<readonly [key: string, value: unknown]> | null>;
}

export interface SyncLogWindow {
  readonly rows: readonly SyncLogRow[];
  readonly cursor: string;
  readonly olderCursor: string | null;
  readonly references?: readonly SyncLogReference[];
}

export interface SyncLogDiff {
  readonly rows: readonly SyncLogRow[];
  readonly deletes: readonly string[];
  readonly cursor: string;
  readonly references?: readonly SyncLogReference[];
}

export interface SyncLogPage {
  readonly rows: readonly SyncLogRow[];
  readonly olderCursor: string | null;
  readonly references?: readonly SyncLogReference[];
}

export interface SyncHostLog<Viewer> {
  readonly name: string;
  latest(viewer: Viewer, param: string, limit: number): MaybePromise<SyncLogWindow | null>;
  since(viewer: Viewer, param: string, cursor: string): MaybePromise<SyncLogDiff | "reset" | null>;
  older(viewer: Viewer, param: string, before: string, limit: number): MaybePromise<SyncLogPage | null>;
}

export interface SyncHubClient<Viewer> {
  send(message: SyncServerMessage): void;
  viewer(): { readonly key: string; readonly value: Viewer };
}

interface CollectionSubscription {
  readonly name: string;
  readonly target: SyncName;
  versions: Map<string, string> | null;
}

interface LogSubscription {
  readonly name: string;
  readonly param: string;
  cursor: string | null;
}

interface ClientState<Viewer> {
  readonly port: SyncHubClient<Viewer>;
  readonly queue: SerialQueue;
  readonly collections: Map<string, CollectionSubscription>;
  readonly logs: Map<string, LogSubscription>;
  readonly pendingHave: Map<string, Map<string, string>>;
  closed: boolean;
}

interface ReadRow {
  readonly version: string;
  readonly bytes: number;
  readonly value: unknown;
}

type ReadView = Map<string, ReadRow>;
type LogResult = SyncLogDiff | "reset" | null;

interface ReadCache {
  readonly views: Map<string, MaybePromise<ReadView | null>>;
  readonly diffs: Map<string, MaybePromise<LogResult>>;
}

function readCache(): ReadCache {
  return { views: new Map(), diffs: new Map() };
}

function syncVersion(json: string): string {
  return createHash("sha256").update(json).digest("base64url").slice(0, 16);
}

function isPromise<T>(value: MaybePromise<T>): value is Promise<T> {
  return value instanceof Promise;
}

function then<T, R>(value: MaybePromise<T>, next: (value: T) => MaybePromise<R>): MaybePromise<R> {
  return isPromise(value) ? value.then(next) : next(value);
}

class SerialQueue {
  #tail: Promise<void> | null = null;
  readonly #onError: (error: unknown) => void;

  constructor(onError: (error: unknown) => void) {
    this.#onError = onError;
  }

  run(task: () => MaybePromise<void>): void {
    if (this.#tail) {
      this.#track(this.#tail.then(task));
      return;
    }
    try {
      const result = task();
      if (isPromise(result)) this.#track(result);
    } catch (error) {
      this.#onError(error);
    }
  }

  #track(work: Promise<void>): void {
    const tail: Promise<void> = work
      .catch((error: unknown) => this.#onError(error))
      .then(() => {
        if (this.#tail === tail) this.#tail = null;
      });
    this.#tail = tail;
  }
}

export class SyncHub<Viewer, Client> {
  readonly #collections = new Map<string, SyncHostCollection<Viewer>>();
  readonly #logs = new Map<string, SyncHostLog<Viewer>>();
  readonly #clients = new Map<Client, ClientState<Viewer>>();
  readonly #dirtyCollections = new Map<string, Set<string> | null>();
  readonly #dirtyLogs = new Set<string>();
  readonly #onError: (error: unknown) => void;
  #flushScheduled = false;

  constructor(
    sources: { collections: readonly SyncHostCollection<Viewer>[]; logs?: readonly SyncHostLog<Viewer>[] },
    onError: (error: unknown) => void,
  ) {
    for (const collection of sources.collections) this.#collections.set(collection.name, collection);
    for (const log of sources.logs ?? []) this.#logs.set(log.name, log);
    this.#onError = onError;
  }

  open(client: Client, port: SyncHubClient<Viewer>): void {
    this.#clients.set(client, {
      port,
      queue: new SerialQueue(this.#onError),
      collections: new Map(),
      logs: new Map(),
      pendingHave: new Map(),
      closed: false,
    });
  }

  close(client: Client): void {
    const state = this.#clients.get(client);
    if (!state) return;
    this.#clients.delete(client);
    state.closed = true;
    state.collections.clear();
    state.logs.clear();
  }

  receive(client: Client, message: SyncClientMessage): void {
    const state = this.#clients.get(client);
    if (!state) throw new Error("Sync is not open for this connection.");
    switch (message.type) {
      case "sync-barrier":
        setImmediate(() => {
          if (this.#clients.get(client) !== state) return;
          this.flush();
          state.queue.run(() => {
            if (this.#clients.get(client) === state) state.port.send({ type: "sync-barrier", id: message.id });
          });
        });
        return;
      case "sync-unsubscribe":
        state.collections.delete(message.collection);
        state.logs.delete(message.collection);
        state.pendingHave.delete(message.collection);
        return;
      case "sync-subscribe":
        this.#subscribe(state, message);
        return;
      case "sync-log-subscribe":
        this.#subscribeLog(state, message);
        return;
      case "sync-log-older":
        this.#older(state, message);
        return;
    }
  }

  changed(name: string, keys?: Iterable<string>): void {
    const target = parseSyncName(name);
    if (!target || !this.#collections.has(target.base)) return;
    const current = this.#dirtyCollections.get(name);
    if (current === null) return;
    if (!keys) this.#dirtyCollections.set(name, null);
    else {
      const set = current ?? new Set<string>();
      for (const key of keys) set.add(key);
      this.#dirtyCollections.set(name, set);
    }
    this.#schedule();
  }

  changedLog(name: string): void {
    const target = parseSyncName(name);
    if (!target || !this.#logs.has(target.base)) return;
    this.#dirtyLogs.add(name);
    this.#schedule();
  }

  changedAll(): void {
    for (const name of this.#collections.keys()) this.#dirtyCollections.set(name, null);
    for (const name of this.#logs.keys()) this.#dirtyLogs.add(name);
    this.#schedule();
  }

  flush(): void {
    if (this.#dirtyCollections.size === 0 && this.#dirtyLogs.size === 0) return;
    const collections = new Map(this.#dirtyCollections);
    const logs = new Set(this.#dirtyLogs);
    this.#dirtyCollections.clear();
    this.#dirtyLogs.clear();
    const cache = readCache();
    for (const state of this.#clients.values()) {
      for (const subscription of state.collections.values()) {
        const keys = dirtyKeys(collections, subscription);
        if (keys !== undefined) state.queue.run(() => this.#refresh(state, subscription, keys, cache));
      }
      for (const subscription of state.logs.values()) {
        const target = parseSyncName(subscription.name);
        if (target && (logs.has(subscription.name) || logs.has(target.base)))
          state.queue.run(() => this.#advance(state, subscription, cache));
      }
    }
  }

  #schedule(): void {
    if (this.#flushScheduled) return;
    this.#flushScheduled = true;
    queueMicrotask(() => {
      this.#flushScheduled = false;
      this.flush();
    });
  }

  #subscribe(state: ClientState<Viewer>, message: Extract<SyncClientMessage, { type: "sync-subscribe" }>): void {
    const name = message.collection;
    state.collections.delete(name);
    const target = parseSyncName(name);
    const collection = target && this.#collections.get(target.base);
    if (!target || !collection || Boolean(collection.scoped) !== (target.param !== null)) {
      state.pendingHave.delete(name);
      if (!message.more) state.queue.run(() => state.port.send({ type: "sync-unavailable", collection: name }));
      return;
    }
    const have = state.pendingHave.get(name) ?? new Map<string, string>();
    for (const [key, version] of message.have) have.set(key, version);
    if (pendingEntries(state.pendingHave, name) + have.size > SYNC_LIMITS.haveEntries)
      throw new Error("Sync state is too large.");
    if (message.more) {
      state.pendingHave.set(name, have);
      return;
    }
    state.pendingHave.delete(name);
    const subscription: CollectionSubscription = { name, target, versions: null };
    state.collections.set(name, subscription);
    state.queue.run(() =>
      this.#guard(state, subscription, () =>
        then(this.#readView(state, collection, target, readCache()), (view) => {
          if (!this.#live(state, subscription)) return;
          if (!view) return this.#unavailable(state, subscription.name);
          const upserts: { upsert: SyncUpsert; bytes: number }[] = [];
          for (const [key, row] of view) {
            if (have.get(key) !== row.version)
              upserts.push({ upsert: { key, version: row.version, value: row.value }, bytes: row.bytes });
          }
          const deletes = [...have.keys()].filter((key) => !view.has(key));
          subscription.versions = versionsOf(view);
          for (const chunk of collectionChunks(name, upserts, deletes)) state.port.send(chunk);
        }),
      ),
    );
  }

  #refresh(
    state: ClientState<Viewer>,
    subscription: CollectionSubscription,
    keys: ReadonlySet<string> | null,
    cache: ReadCache,
  ): MaybePromise<void> {
    if (!this.#live(state, subscription) || !subscription.versions) return;
    const collection = this.#collections.get(subscription.target.base);
    if (!collection) return;
    return this.#guard(state, subscription, () => {
      if (keys && collection.readKeys) {
        const list = [...keys].sort();
        return then(this.#readKeys(state, collection, subscription.target, list, cache), (rows) => {
          const versions = subscription.versions;
          if (!this.#live(state, subscription) || !versions) return;
          if (!rows) return this.#unavailable(state, subscription.name);
          const upserts: { upsert: SyncUpsert; bytes: number }[] = [];
          const deletes: string[] = [];
          for (const key of list) {
            const row = rows.get(key);
            if (!row) {
              if (versions.delete(key)) deletes.push(key);
              continue;
            }
            if (versions.get(key) === row.version) continue;
            versions.set(key, row.version);
            upserts.push({ upsert: { key, version: row.version, value: row.value }, bytes: row.bytes });
          }
          if (versions.size > SYNC_LIMITS.haveEntries) throw new Error("Sync collection is too large.");
          if (upserts.length || deletes.length)
            for (const chunk of collectionChunks(subscription.name, upserts, deletes)) state.port.send(chunk);
        });
      }
      return then(this.#readView(state, collection, subscription.target, cache), (view) => {
        const versions = subscription.versions;
        if (!this.#live(state, subscription) || !versions) return;
        if (!view) return this.#unavailable(state, subscription.name);
        const upserts: { upsert: SyncUpsert; bytes: number }[] = [];
        for (const [key, row] of view) {
          if (versions.get(key) !== row.version)
            upserts.push({ upsert: { key, version: row.version, value: row.value }, bytes: row.bytes });
        }
        const deletes = [...versions.keys()].filter((key) => !view.has(key));
        subscription.versions = versionsOf(view);
        if (upserts.length || deletes.length)
          for (const chunk of collectionChunks(subscription.name, upserts, deletes)) state.port.send(chunk);
      });
    });
  }

  #subscribeLog(state: ClientState<Viewer>, message: Extract<SyncClientMessage, { type: "sync-log-subscribe" }>): void {
    const name = message.log;
    state.logs.delete(name);
    const target = parseSyncName(name);
    const log = target && this.#logs.get(target.base);
    if (!target?.param || !log) {
      state.queue.run(() => state.port.send({ type: "sync-unavailable", collection: name }));
      return;
    }
    const subscription: LogSubscription = { name, param: target.param, cursor: null };
    state.logs.set(name, subscription);
    const viewer = () => state.port.viewer().value;
    state.queue.run(() =>
      this.#guard(state, subscription, () => {
        const latest = () =>
          then(log.latest(viewer(), subscription.param, message.limit), (window) => {
            if (!this.#live(state, subscription)) return;
            if (!window) return this.#unavailable(state, name);
            subscription.cursor = window.cursor;
            for (const chunk of logChunks(
              name,
              window.rows,
              [],
              window.cursor,
              true,
              window.olderCursor,
              window.references,
            ))
              state.port.send(chunk);
          });
        if (!message.after) return latest();
        return then(log.since(viewer(), subscription.param, message.after), (diff) => {
          if (!this.#live(state, subscription)) return;
          if (diff === "reset") return latest();
          if (!diff) return this.#unavailable(state, name);
          subscription.cursor = diff.cursor;
          for (const chunk of logChunks(name, diff.rows, diff.deletes, diff.cursor, false, null, diff.references))
            state.port.send(chunk);
        });
      }),
    );
  }

  #advance(state: ClientState<Viewer>, subscription: LogSubscription, cache: ReadCache): MaybePromise<void> {
    const cursor = subscription.cursor;
    if (!this.#live(state, subscription) || cursor === null) return;
    const target = parseSyncName(subscription.name);
    const log = target && this.#logs.get(target.base);
    if (!log) return;
    return this.#guard(state, subscription, () => {
      const viewer = state.port.viewer();
      const cacheKey = `log\n${subscription.name}\n${viewer.key}\n${cursor}`;
      const diff = cached(cache.diffs, cacheKey, () => log.since(viewer.value, subscription.param, cursor));
      return then(diff, (result) => {
        if (!this.#live(state, subscription) || subscription.cursor !== cursor) return;
        if (!result) return this.#unavailable(state, subscription.name);
        if (result === "reset") {
          return then(log.latest(viewer.value, subscription.param, SYNC_LIMITS.logRows), (window) => {
            if (!this.#live(state, subscription)) return;
            if (!window) return this.#unavailable(state, subscription.name);
            subscription.cursor = window.cursor;
            for (const chunk of logChunks(
              subscription.name,
              window.rows,
              [],
              window.cursor,
              true,
              window.olderCursor,
              window.references,
            ))
              state.port.send(chunk);
          });
        }
        if (result.cursor === cursor && result.rows.length === 0 && result.deletes.length === 0) return;
        subscription.cursor = result.cursor;
        for (const chunk of logChunks(
          subscription.name,
          result.rows,
          result.deletes,
          result.cursor,
          false,
          null,
          result.references,
        ))
          state.port.send(chunk);
      });
    });
  }

  #older(state: ClientState<Viewer>, message: Extract<SyncClientMessage, { type: "sync-log-older" }>): void {
    const subscription = state.logs.get(message.log);
    const target = parseSyncName(message.log);
    const log = target && this.#logs.get(target.base);
    if (!subscription || !log) {
      state.queue.run(() => state.port.send({ type: "sync-unavailable", collection: message.log }));
      return;
    }
    state.queue.run(() =>
      this.#guard(state, subscription, () =>
        then(log.older(state.port.viewer().value, subscription.param, message.before, message.limit), (page) => {
          if (!this.#live(state, subscription)) return;
          if (!page) return this.#unavailable(state, message.log);
          for (const chunk of pageChunks(message.log, message.id, page)) state.port.send(chunk);
        }),
      ),
    );
  }

  #live(state: ClientState<Viewer>, subscription: CollectionSubscription | LogSubscription): boolean {
    if (state.closed) return false;
    return (
      state.collections.get(subscription.name) === subscription || state.logs.get(subscription.name) === subscription
    );
  }

  #unavailable(state: ClientState<Viewer>, name: string): void {
    state.collections.delete(name);
    state.logs.delete(name);
    state.port.send({ type: "sync-unavailable", collection: name });
  }

  #guard(
    state: ClientState<Viewer>,
    subscription: CollectionSubscription | LogSubscription,
    task: () => MaybePromise<void>,
  ): MaybePromise<void> {
    const fail = (error: unknown) => {
      this.#onError(error);
      if (this.#live(state, subscription)) this.#unavailable(state, subscription.name);
    };
    try {
      const result = task();
      return isPromise(result) ? result.catch(fail) : result;
    } catch (error) {
      fail(error);
    }
  }

  #readView(
    state: ClientState<Viewer>,
    collection: SyncHostCollection<Viewer>,
    target: SyncName,
    cache: ReadCache,
  ): MaybePromise<ReadView | null> {
    const viewer = state.port.viewer();
    const cacheKey = `all\n${target.base}\n${target.param ?? ""}\n${viewer.key}`;
    return cached(cache.views, cacheKey, () =>
      then(collection.read(viewer.value, target.param), (entries) => (entries ? readRows(entries, true) : null)),
    );
  }

  #readKeys(
    state: ClientState<Viewer>,
    collection: SyncHostCollection<Viewer>,
    target: SyncName,
    keys: readonly string[],
    cache: ReadCache,
  ): MaybePromise<ReadView | null> {
    const readKeys = collection.readKeys;
    if (!readKeys) return null;
    const viewer = state.port.viewer();
    const cacheKey = `keys\n${target.base}\n${target.param ?? ""}\n${viewer.key}\n${keys.join("\n")}`;
    return cached(cache.views, cacheKey, () =>
      then(readKeys.call(collection, viewer.value, target.param, keys), (entries) => {
        if (!entries) return null;
        const wanted = new Set(keys);
        const present: [string, unknown][] = [];
        for (const [key, value] of entries) if (wanted.has(key) && value != null) present.push([key, value]);
        return readRows(present, false);
      }),
    );
  }
}

function cached<T>(cache: Map<string, MaybePromise<T>>, key: string, read: () => MaybePromise<T>): MaybePromise<T> {
  const existing = cache.get(key);
  if (existing !== undefined) return existing;
  const value = read();
  cache.set(key, value);
  return value;
}

function dirtyKeys(
  dirty: ReadonlyMap<string, Set<string> | null>,
  subscription: CollectionSubscription,
): ReadonlySet<string> | null | undefined {
  const exact = dirty.get(subscription.name);
  const base = subscription.target.param === null ? undefined : dirty.get(subscription.target.base);
  if (exact === null || base === null) return null;
  if (exact === undefined && base === undefined) return undefined;
  return new Set([...(exact ?? []), ...(base ?? [])]);
}

function pendingEntries(pending: ReadonlyMap<string, ReadonlyMap<string, string>>, except: string): number {
  let entries = 0;
  for (const [name, have] of pending) if (name !== except) entries += have.size;
  return entries;
}

function versionsOf(view: ReadView): Map<string, string> {
  return new Map([...view].map(([key, row]) => [key, row.version]));
}

function readRows(entries: Iterable<readonly [string, unknown]>, full: boolean): ReadView {
  const view: ReadView = new Map();
  for (const [key, value] of entries) {
    if (!isSyncKey(key) || view.has(key)) throw new Error("Invalid sync key.");
    const json = JSON.stringify(value);
    const bytes = Buffer.byteLength(json);
    if (bytes > SYNC_LIMITS.rowBytes) throw new Error("Sync entity is too large.");
    view.set(key, { version: syncVersion(json), bytes, value });
  }
  if (full && view.size > SYNC_LIMITS.haveEntries) throw new Error("Sync collection is too large.");
  return view;
}

type SyncChanges = Extract<SyncServerMessage, { type: "sync-changes" }>;
type SyncLogChanges = Extract<SyncServerMessage, { type: "sync-log-changes" }>;
type SyncLogPageMessage = Extract<SyncServerMessage, { type: "sync-log-page" }>;

function chunked<Item, Chunk>(
  items: readonly Item[],
  size: (item: Item) => number,
  create: () => Chunk,
  add: (chunk: Chunk, item: Item) => void,
): Chunk[] {
  const chunks: Chunk[] = [create()];
  let count = 0;
  let bytes = 0;
  for (const item of items) {
    const itemBytes = size(item);
    if (count > 0 && (count >= SYNC_LIMITS.entriesPerChunk || bytes + itemBytes > SYNC_LIMITS.chunkBytes)) {
      chunks.push(create());
      count = 0;
      bytes = 0;
    }
    const current = chunks[chunks.length - 1];
    if (current) add(current, item);
    count += 1;
    bytes += itemBytes;
  }
  return chunks;
}

type CollectionItem = { upsert: SyncUpsert; bytes: number } | { delete: string };

function collectionChunks(
  collection: string,
  upserts: readonly { upsert: SyncUpsert; bytes: number }[],
  deletes: readonly string[],
): SyncChanges[] {
  const items: CollectionItem[] = [...upserts, ...deletes.map((key) => ({ delete: key }))];
  const chunks = chunked<CollectionItem, SyncChanges>(
    items,
    (item) => ("delete" in item ? item.delete.length + 3 : item.bytes + item.upsert.key.length + 64),
    () => ({ type: "sync-changes", collection, upserts: [], deletes: [], synced: false }),
    (chunk, item) => {
      if ("delete" in item) chunk.deletes.push(item.delete);
      else chunk.upserts.push(item.upsert);
    },
  );
  const last = chunks[chunks.length - 1];
  if (last) last.synced = true;
  return chunks;
}

type LogItem = { row: SyncLogRow; bytes: number } | { reference: SyncLogReference; bytes: number } | { delete: string };

function logValueBytes(key: string, value: unknown): number {
  const bytes = Buffer.byteLength(JSON.stringify(value));
  if (!isSyncKey(key) || bytes > SYNC_LIMITS.rowBytes) throw new Error("Invalid sync log row.");
  return bytes;
}

function logItems(
  rows: readonly SyncLogRow[],
  deletes: readonly string[],
  references: readonly SyncLogReference[] = [],
): LogItem[] {
  const items: LogItem[] = references.map((reference) => ({
    reference,
    bytes: logValueBytes(reference.key, reference.value),
  }));
  for (const row of rows) items.push({ row, bytes: logValueBytes(row.key, row.value) });
  for (const key of deletes) items.push({ delete: key });
  return items;
}

function logItemBytes(item: LogItem): number {
  if ("delete" in item) return item.delete.length + 3;
  if ("reference" in item) return item.bytes + item.reference.key.length + 64;
  return item.bytes + item.row.key.length + item.row.order.length + 64;
}

function addLogItem(chunk: { rows: SyncLogRow[]; references?: SyncLogReference[] }, item: LogItem): void {
  if ("row" in item) chunk.rows.push(item.row);
  else if ("reference" in item) {
    chunk.references ??= [];
    chunk.references.push(item.reference);
  }
}

function logChunks(
  log: string,
  rows: readonly SyncLogRow[],
  deletes: readonly string[],
  cursor: string,
  reset: boolean,
  olderCursor: string | null,
  references?: readonly SyncLogReference[],
): SyncLogChanges[] {
  const chunks = chunked<LogItem, SyncLogChanges>(
    logItems(rows, deletes, references),
    logItemBytes,
    () => ({ type: "sync-log-changes", log, rows: [], deletes: [], cursor, reset: false, olderCursor, synced: false }),
    (chunk, item) => {
      if ("delete" in item) chunk.deletes.push(item.delete);
      else addLogItem(chunk, item);
    },
  );
  const first = chunks[0];
  if (first) first.reset = reset;
  const last = chunks[chunks.length - 1];
  if (last) last.synced = true;
  return chunks;
}

function pageChunks(log: string, id: string, page: SyncLogPage): SyncLogPageMessage[] {
  const chunks = chunked<LogItem, SyncLogPageMessage>(
    logItems(page.rows, [], page.references),
    logItemBytes,
    () => ({ type: "sync-log-page", log, id, rows: [], olderCursor: page.olderCursor, done: false }),
    addLogItem,
  );
  const last = chunks[chunks.length - 1];
  if (last) last.done = true;
  return chunks;
}
