import type { SyncCollectionSpec, SyncLogSpec } from "@openbot/contracts/team-protocol/sync-collections";
import {
  SYNC_LIMITS,
  type SyncClientMessage,
  type SyncKeyVersion,
  type SyncServerMessage,
  syncName,
} from "@openbot/contracts/team-protocol/sync-v1";

export type SyncStatus = "idle" | "syncing" | "synced" | "stale" | "unavailable";

export interface SyncMutation<Entity, Result> {
  key: string;
  apply(current: Entity | undefined): Entity | undefined;
  run(): Promise<Result>;
}

export interface SyncLogEntry<Entity> {
  readonly key: string;
  readonly order: string;
  readonly entity: Entity;
}

export interface SyncLogMutation<Entity, Result> {
  key: string;
  apply(current: SyncLogEntry<Entity> | undefined): SyncLogEntry<Entity> | undefined;
  run(): Promise<Result>;
}

interface SyncHandle {
  readonly name: string;
  status(): SyncStatus;
  subscribe(listener: () => void): () => void;
}

export interface SyncCollection<Entity> extends SyncHandle {
  values(): readonly Entity[];
  get(key: string): Entity | undefined;
  mutate<Result>(mutation: SyncMutation<Entity, Result>): Promise<Result>;
}

export interface SyncLog<Entity> extends SyncHandle {
  rows(): readonly SyncLogEntry<Entity>[];
  get(key: string): SyncLogEntry<Entity> | undefined;
  hasOlder(): boolean;
  olderCursor(): string | null;
  references(): ReadonlyMap<string, Entity>;
  loadOlder(limit?: number): Promise<void>;
  mutate<Result>(mutation: SyncLogMutation<Entity, Result>): Promise<Result>;
}

export interface SyncClientOptions {
  send(message: SyncClientMessage): Promise<void>;
  barrierTimeoutMs?: number;
  onError?(error: unknown): void;
}

export interface SyncClient {
  collection<Entity>(spec: SyncCollectionSpec<Entity>, param?: string | null): SyncCollection<Entity>;
  log<Entity>(spec: SyncLogSpec<Entity>, param: string, options?: { limit?: number }): SyncLog<Entity>;
  has(name: string): boolean;
  release(name: string): void;
  receive(message: SyncServerMessage): void;
  resubscribe(): void;
  pause(): void;
  barrier(): Promise<void>;
  dispose(): void;
}

interface Runtime {
  subscribe(): void;
  receive(message: SyncServerMessage): void;
  unavailable(): void;
  pause(): void;
  close(): void;
}

interface PendingBarrier {
  resolve(): void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_BARRIER_TIMEOUT_MS = 10_000;
const DEFAULT_LOG_LIMIT = 50;

function compareEntries(left: SyncLogEntry<unknown>, right: SyncLogEntry<unknown>): number {
  if (left.order !== right.order) return left.order < right.order ? -1 : 1;
  return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}

function boundedLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(SYNC_LIMITS.logRows, Math.floor(limit ?? DEFAULT_LOG_LIMIT)));
}

class Listeners {
  readonly #listeners = new Set<() => void>();

  add(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  notify(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  clear(): void {
    this.#listeners.clear();
  }
}

class Overlays<Value> {
  readonly #byKey = new Map<string, ((current: Value | undefined) => Value | undefined)[]>();

  keys(): Iterable<string> {
    return this.#byKey.keys();
  }

  apply(key: string, value: Value | undefined): Value | undefined {
    let current = value;
    for (const overlay of this.#byKey.get(key) ?? []) current = overlay(current);
    return current;
  }

  add(key: string, overlay: (current: Value | undefined) => Value | undefined): () => void {
    this.#byKey.set(key, [...(this.#byKey.get(key) ?? []), overlay]);
    return () => {
      const kept = (this.#byKey.get(key) ?? []).filter((item) => item !== overlay);
      if (kept.length) this.#byKey.set(key, kept);
      else this.#byKey.delete(key);
    };
  }
}

export function createSyncClient(options: SyncClientOptions): SyncClient {
  const runtimes = new Map<string, Runtime>();
  const barriers = new Map<string, PendingBarrier>();
  const barrierTimeoutMs = options.barrierTimeoutMs ?? DEFAULT_BARRIER_TIMEOUT_MS;
  let nextRequest = 0;
  let started = false;
  let disposed = false;

  function report(error: unknown): void {
    options.onError?.(error);
  }

  function requestId(prefix: string): string {
    nextRequest += 1;
    return `${prefix}${nextRequest.toString(36)}`;
  }

  function send(message: SyncClientMessage): Promise<void> {
    if (disposed) return Promise.resolve();
    return options.send(message).catch((error: unknown) => {
      report(error);
      throw error;
    });
  }

  function sendQuietly(message: SyncClientMessage): void {
    void send(message).catch(() => undefined);
  }

  function settleBarrier(id: string): void {
    const pending = barriers.get(id);
    if (!pending) return;
    barriers.delete(id);
    clearTimeout(pending.timer);
    pending.resolve();
  }

  function barrier(): Promise<void> {
    if (disposed) return Promise.resolve();
    const id = requestId("b");
    return new Promise<void>((resolve) => {
      barriers.set(id, { resolve, timer: setTimeout(() => settleBarrier(id), barrierTimeoutMs) });
      send({ type: "sync-barrier", id }).catch(() => settleBarrier(id));
    });
  }

  async function withOverlay<Result>(
    status: () => SyncStatus,
    changed: () => void,
    add: () => () => void,
    run: () => Promise<Result>,
  ): Promise<Result> {
    const remove = add();
    changed();
    try {
      const result = await run();
      const current = status();
      if (current === "synced" || current === "syncing") await barrier();
      return result;
    } finally {
      remove();
      if (!disposed) changed();
    }
  }

  function createCollection<Entity>(
    spec: SyncCollectionSpec<Entity>,
    name: string,
  ): { runtime: Runtime; handle: SyncCollection<Entity> } {
    const base = new Map<string, { version: string; entity: Entity }>();
    const overlays = new Overlays<Entity>();
    const listeners = new Listeners();
    let status: SyncStatus = "idle";
    let broken = false;
    let snapshot: readonly Entity[] | null = null;

    function changed(): void {
      snapshot = null;
      listeners.notify();
    }

    function view(key: string): Entity | undefined {
      return overlays.apply(key, base.get(key)?.entity);
    }

    function values(): readonly Entity[] {
      if (snapshot) return snapshot;
      const list: Entity[] = [];
      for (const key of new Set([...base.keys(), ...overlays.keys()])) {
        const entity = view(key);
        if (entity !== undefined) list.push(entity);
      }
      if (spec.compare) list.sort(spec.compare);
      snapshot = list;
      return list;
    }

    function fail(error: unknown): void {
      report(error);
      broken = true;
      status = "unavailable";
      base.clear();
      sendQuietly({ type: "sync-unsubscribe", collection: name });
      changed();
    }

    const handle: SyncCollection<Entity> = {
      name,
      status: () => status,
      values,
      get: view,
      subscribe: (listener) => listeners.add(listener),
      mutate: (mutation) =>
        withOverlay(
          () => status,
          changed,
          () => overlays.add(mutation.key, (current) => mutation.apply(current)),
          () => mutation.run(),
        ),
    };

    const runtime: Runtime = {
      subscribe() {
        if (broken) return;
        if (base.size > SYNC_LIMITS.haveEntries) base.clear();
        status = "syncing";
        const have: SyncKeyVersion[] = [...base].map(([key, entry]) => [key, entry.version] as const);
        const chunks: SyncKeyVersion[][] = [];
        for (let start = 0; start < have.length; start += SYNC_LIMITS.entriesPerChunk)
          chunks.push(have.slice(start, start + SYNC_LIMITS.entriesPerChunk));
        if (chunks.length === 0) chunks.push([]);
        chunks.forEach((chunk, index) => {
          sendQuietly({ type: "sync-subscribe", collection: name, have: chunk, more: index < chunks.length - 1 });
        });
        changed();
      },
      receive(message) {
        if (message.type !== "sync-changes" || status === "unavailable" || status === "idle") return;
        const decoded: { key: string; version: string; entity: Entity }[] = [];
        try {
          for (const upsert of message.upserts) {
            const entity = spec.decode(upsert.value);
            if (spec.key(entity) !== upsert.key) throw new Error("Sync entity key does not match.");
            decoded.push({ key: upsert.key, version: upsert.version, entity });
          }
        } catch (error) {
          fail(error);
          return;
        }
        for (const key of message.deletes) base.delete(key);
        for (const entry of decoded) base.set(entry.key, { version: entry.version, entity: entry.entity });
        if (message.synced) status = "synced";
        changed();
      },
      unavailable() {
        status = "unavailable";
        base.clear();
        changed();
      },
      pause() {
        if (status !== "synced" && status !== "syncing") return;
        status = "stale";
        changed();
      },
      close() {
        status = "idle";
        listeners.clear();
      },
    };
    return { runtime, handle };
  }

  function createLog<Entity>(
    spec: SyncLogSpec<Entity>,
    name: string,
    limit: number,
  ): { runtime: Runtime; handle: SyncLog<Entity> } {
    const base = new Map<string, SyncLogEntry<Entity>>();
    const overlays = new Overlays<SyncLogEntry<Entity>>();
    const listeners = new Listeners();
    const references = new Map<string, Entity>();
    const pages = new Map<
      string,
      {
        rows: SyncLogEntry<Entity>[];
        references: (readonly [string, Entity])[];
        resolve(): void;
        reject(error: Error): void;
      }
    >();
    let status: SyncStatus = "idle";
    let broken = false;
    let cursor: string | null = null;
    let olderCursor: string | null = null;
    let complete = false;
    let loading: Promise<void> | null = null;
    let snapshot: readonly SyncLogEntry<Entity>[] | null = null;
    let referenceSnapshot: ReadonlyMap<string, Entity> | null = null;

    function changed(): void {
      snapshot = null;
      referenceSnapshot = null;
      listeners.notify();
    }

    function referenceView(): ReadonlyMap<string, Entity> {
      referenceSnapshot ??= new Map(references);
      return referenceSnapshot;
    }

    function view(key: string): SyncLogEntry<Entity> | undefined {
      return overlays.apply(key, base.get(key));
    }

    function rows(): readonly SyncLogEntry<Entity>[] {
      if (snapshot) return snapshot;
      const list: SyncLogEntry<Entity>[] = [];
      for (const key of new Set([...base.keys(), ...overlays.keys()])) {
        const entry = view(key);
        if (entry !== undefined) list.push(entry);
      }
      list.sort(compareEntries);
      snapshot = list;
      return list;
    }

    function oldestOrder(): string | null {
      let oldest: string | null = null;
      for (const entry of base.values()) if (oldest === null || entry.order < oldest) oldest = entry.order;
      return oldest;
    }

    function decodeRows(list: readonly { key: string; order: string; value: unknown }[]): SyncLogEntry<Entity>[] {
      return list.map((row) => {
        const entity = spec.decode(row.value);
        if (spec.key(entity) !== row.key) throw new Error("Sync entity key does not match.");
        return { key: row.key, order: row.order, entity };
      });
    }

    function decodeReferences(list: readonly { key: string; value: unknown }[] = []): (readonly [string, Entity])[] {
      return list.map((reference) => {
        const entity = spec.decode(reference.value);
        if (spec.key(entity) !== reference.key) throw new Error("Sync entity key does not match.");
        return [reference.key, entity];
      });
    }

    function dropPages(): void {
      for (const page of pages.values()) page.resolve();
      pages.clear();
      loading = null;
    }

    function fail(error: unknown): void {
      report(error);
      broken = true;
      status = "unavailable";
      base.clear();
      references.clear();
      cursor = null;
      dropPages();
      sendQuietly({ type: "sync-unsubscribe", collection: name });
      changed();
    }

    function loadOlder(pageLimit?: number): Promise<void> {
      if (loading) return loading;
      if (status !== "synced" || olderCursor === null || complete) return Promise.resolve();
      const id = requestId("p");
      const before = olderCursor;
      loading = new Promise<void>((resolve, reject) => {
        pages.set(id, { rows: [], references: [], resolve, reject });
        send({ type: "sync-log-older", log: name, id, before, limit: boundedLimit(pageLimit ?? limit) }).catch(
          (error: unknown) => {
            pages.delete(id);
            reject(error instanceof Error ? error : new Error("Sync request failed."));
          },
        );
      }).finally(() => {
        loading = null;
      });
      return loading;
    }

    const handle: SyncLog<Entity> = {
      name,
      status: () => status,
      rows,
      get: view,
      hasOlder: () => status === "synced" && olderCursor !== null && !complete,
      olderCursor: () => olderCursor,
      references: referenceView,
      loadOlder,
      subscribe: (listener) => listeners.add(listener),
      mutate: (mutation) =>
        withOverlay(
          () => status,
          changed,
          () => overlays.add(mutation.key, (current) => mutation.apply(current)),
          () => mutation.run(),
        ),
    };

    const runtime: Runtime = {
      subscribe() {
        if (broken) return;
        status = "syncing";
        dropPages();
        sendQuietly({ type: "sync-log-subscribe", log: name, after: cursor, limit });
        changed();
      },
      receive(message) {
        if (status === "unavailable" || status === "idle") return;
        if (message.type === "sync-log-page") {
          const page = pages.get(message.id);
          if (!page) return;
          try {
            page.rows.push(...decodeRows(message.rows));
            page.references.push(...decodeReferences(message.references));
          } catch (error) {
            pages.delete(message.id);
            page.resolve();
            fail(error);
            return;
          }
          if (!message.done) return;
          pages.delete(message.id);
          for (const entry of page.rows) if (!base.has(entry.key)) base.set(entry.key, entry);
          for (const [key, entity] of page.references) references.set(key, entity);
          olderCursor = message.olderCursor;
          complete = message.olderCursor === null;
          page.resolve();
          changed();
          return;
        }
        if (message.type !== "sync-log-changes") return;
        let decoded: SyncLogEntry<Entity>[];
        let decodedReferences: (readonly [string, Entity])[];
        try {
          decoded = decodeRows(message.rows);
          decodedReferences = decodeReferences(message.references);
        } catch (error) {
          fail(error);
          return;
        }
        if (message.reset) {
          base.clear();
          references.clear();
          dropPages();
          olderCursor = message.olderCursor;
          complete = message.olderCursor === null;
        }
        for (const key of message.deletes) {
          base.delete(key);
          references.delete(key);
        }
        const oldest = complete ? null : oldestOrder();
        for (const entry of decoded) {
          if (references.has(entry.key)) references.set(entry.key, entry.entity);
          if (message.reset || oldest === null || base.has(entry.key) || entry.order >= oldest)
            base.set(entry.key, entry);
        }
        for (const [key, entity] of decodedReferences) references.set(key, entity);
        if (message.synced) {
          cursor = message.cursor;
          status = "synced";
        }
        changed();
      },
      unavailable() {
        status = "unavailable";
        base.clear();
        references.clear();
        cursor = null;
        dropPages();
        changed();
      },
      pause() {
        if (status !== "synced" && status !== "syncing") return;
        status = "stale";
        dropPages();
        changed();
      },
      close() {
        status = "idle";
        dropPages();
        listeners.clear();
      },
    };
    return { runtime, handle };
  }

  function register<Handle extends SyncHandle>(created: { runtime: Runtime; handle: Handle }): Handle {
    if (runtimes.has(created.handle.name)) throw new Error("A sync handle with this name already exists.");
    runtimes.set(created.handle.name, created.runtime);
    if (started && !disposed) created.runtime.subscribe();
    return created.handle;
  }

  return {
    collection<Entity>(spec: SyncCollectionSpec<Entity>, param?: string | null): SyncCollection<Entity> {
      return register(createCollection(spec, syncName(spec.name, param)));
    },
    log<Entity>(spec: SyncLogSpec<Entity>, param: string, logOptions?: { limit?: number }): SyncLog<Entity> {
      return register(createLog(spec, syncName(spec.name, param), boundedLimit(logOptions?.limit)));
    },
    has: (name) => runtimes.has(name),
    release(name: string): void {
      const runtime = runtimes.get(name);
      if (!runtime) return;
      runtimes.delete(name);
      runtime.close();
      if (started) sendQuietly({ type: "sync-unsubscribe", collection: name });
    },
    receive(message: SyncServerMessage): void {
      if (disposed) return;
      switch (message.type) {
        case "sync-barrier":
          settleBarrier(message.id);
          return;
        case "sync-unavailable":
          runtimes.get(message.collection)?.unavailable();
          return;
        case "sync-changes":
          runtimes.get(message.collection)?.receive(message);
          return;
        case "sync-log-changes":
        case "sync-log-page":
          runtimes.get(message.log)?.receive(message);
          return;
      }
    },
    resubscribe(): void {
      if (disposed) return;
      started = true;
      for (const runtime of runtimes.values()) runtime.subscribe();
      for (const id of barriers.keys()) sendQuietly({ type: "sync-barrier", id });
    },
    pause(): void {
      for (const runtime of runtimes.values()) runtime.pause();
    },
    barrier,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const id of [...barriers.keys()]) settleBarrier(id);
      for (const runtime of runtimes.values()) runtime.close();
    },
  };
}
