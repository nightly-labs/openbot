import { Effect } from "effect";
import { sha256 } from "./crypto";
import { primaryD1 } from "./observed-d1";
import type { AuthUser } from "./types";

const SESSION_CACHE_TTL_MS = 10 * 60_000;
const SESSION_CHANGES_POLL_MS = 30_000;
const SESSION_CHANGES_WINDOW_MS = 15 * 60_000;
export const SESSION_CHANGES_RETENTION_MS = 60 * 60_000;

const CACHE_NAME = "auth-sessions";
const CACHE_ORIGIN = "https://openbot.run";
const ENTRY_PATH = "/__openbot/auth-session/v1/";
const CHANGES_PATH = "/__openbot/auth-session-changes/v1";
const MEMO_LIMIT = 5_000;
const CHANGES_LIMIT = 10_000;

export type SessionCacheKey = `token:${string}` | `session:${string}`;

export interface CachedSession {
  sessionId: string;
  user: AuthUser;
  expiresAt: number;
  mobile: boolean;
}

interface CacheEntry extends CachedSession {
  cachedUntil: number;
  readAt: number;
  changeMark: number;
}

interface ChangeList {
  loadedAt: number;
  mark: number;
  changes: Map<string, number>;
}

interface StoredChangeList {
  loadedAt: number;
  mark: number;
  changes: [string, number][];
}

export interface SessionLookup {
  cached: CachedSession | null;
  mark: number | null;
}

export type SessionCacheSubject = `session:${string}` | `user:${string}`;

const memo = new Map<SessionCacheKey, CacheEntry>();
const localChanges = new Map<SessionCacheSubject, number>();
let changeList: ChangeList | null = null;

const openCache = Effect.fn("SessionCache.open")(function* () {
  if (typeof caches === "undefined") return null;
  return yield* Effect.tryPromise(() => caches.open(CACHE_NAME)).pipe(Effect.orElseSucceed(() => null));
});

const entryRequest = Effect.fn("SessionCache.entryRequest")(function* (key: SessionCacheKey) {
  const digest = yield* sha256(`openbot-auth-session-cache:v1:${key}`);
  return new Request(`${CACHE_ORIGIN}${ENTRY_PATH}${digest}`);
});

const changesRequest = () => new Request(`${CACHE_ORIGIN}${CHANGES_PATH}`);

function cacheResponse(value: unknown, maxAgeMs: number): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${Math.max(1, Math.ceil(maxAgeMs / 1000))}`,
    },
  });
}

function readJson<T>(response: Response | undefined) {
  if (!response) return Effect.succeed(null);
  return Effect.tryPromise(() => response.json<T>()).pipe(Effect.orElseSucceed(() => null));
}

function changeListFresh(list: ChangeList | null, now: number): list is ChangeList {
  return list !== null && now - list.loadedAt < SESSION_CHANGES_POLL_MS;
}

function storedList(value: StoredChangeList | null): ChangeList | null {
  if (!value || !Number.isFinite(value.loadedAt) || !Number.isFinite(value.mark) || !Array.isArray(value.changes)) {
    return null;
  }
  return { loadedAt: value.loadedAt, mark: value.mark, changes: new Map(value.changes) };
}

const queryChanges = Effect.fn("SessionCache.queryChanges")(function* (database: D1Database, now: number) {
  const result = yield* Effect.tryPromise(() =>
    primaryD1(database)
      .prepare(
        `SELECT id, kind, subject_id FROM auth_session_changes
         WHERE changed_at > ? ORDER BY id LIMIT ?`,
      )
      .bind(now - SESSION_CHANGES_WINDOW_MS, CHANGES_LIMIT + 1)
      .all<{ id: number; kind: string; subject_id: string }>(),
  ).pipe(Effect.orElseSucceed(() => null));
  if (!result || result.results.length > CHANGES_LIMIT) return null;
  const changes = new Map<string, number>();
  let mark = 0;
  for (const row of result.results) {
    changes.set(`${row.kind}:${row.subject_id}`, row.id);
    mark = Math.max(mark, row.id);
  }
  if (mark === 0) {
    const last = yield* Effect.tryPromise(() =>
      primaryD1(database)
        .prepare("SELECT COALESCE(MAX(id), 0) AS mark FROM auth_session_changes")
        .first<{ mark: number }>(),
    ).pipe(Effect.orElseSucceed(() => null));
    if (!last) return null;
    mark = last.mark;
  }
  return { loadedAt: now, mark, changes } satisfies ChangeList;
});

function subjects(sessionId: string, userId: string): SessionCacheSubject[] {
  return [`session:${sessionId}`, `user:${userId}`];
}

function changedSince(list: ChangeList, sessionId: string, userId: string, mark: number, readAt: number): boolean {
  return subjects(sessionId, userId).some(
    (subject) => (list.changes.get(subject) ?? 0) > mark || (localChanges.get(subject) ?? -1) >= readAt,
  );
}

function entryValid(entry: CacheEntry, list: ChangeList, now: number): boolean {
  if (now >= entry.cachedUntil || now >= entry.expiresAt) return false;
  return !changedSince(list, entry.sessionId, entry.user.id, entry.changeMark, entry.readAt);
}

function noteLocalChanges(changed: readonly SessionCacheSubject[], now: number) {
  for (const subject of changed) {
    localChanges.delete(subject);
    localChanges.set(subject, now);
  }
  for (const [subject, at] of localChanges) {
    if (localChanges.size <= MEMO_LIMIT && at > now - SESSION_CACHE_TTL_MS) break;
    localChanges.delete(subject);
  }
}

function remember(key: SessionCacheKey, entry: CacheEntry) {
  memo.delete(key);
  memo.set(key, entry);
  if (memo.size <= MEMO_LIMIT) return;
  const oldest = memo.keys().next();
  if (!oldest.done) memo.delete(oldest.value);
}

export class SessionCache {
  readonly #database: D1Database;

  constructor(database: D1Database) {
    this.#database = database;
  }

  readonly #changes = Effect.fn("SessionCache.changes")(function* (this: SessionCache, now: number) {
    if (changeListFresh(changeList, now)) return changeList;
    const cache = yield* openCache();
    if (cache) {
      const response = yield* Effect.tryPromise(() => cache.match(changesRequest())).pipe(
        Effect.orElseSucceed(() => undefined),
      );
      const shared = storedList(yield* readJson<StoredChangeList>(response));
      if (changeListFresh(shared, now)) {
        changeList = shared;
        return shared;
      }
    }
    const loaded = yield* queryChanges(this.#database, now);
    if (!loaded) return null;
    changeList = loaded;
    if (cache) {
      const stored: StoredChangeList = { loadedAt: loaded.loadedAt, mark: loaded.mark, changes: [...loaded.changes] };
      yield* Effect.tryPromise(() => cache.put(changesRequest(), cacheResponse(stored, SESSION_CHANGES_POLL_MS))).pipe(
        Effect.ignore,
      );
    }
    return loaded;
  }).bind(this);

  readonly lookup = Effect.fn("SessionCache.lookup")(
    function* (this: SessionCache, key: SessionCacheKey, now: number) {
      const list = yield* this.#changes(now);
      if (!list) return { cached: null, mark: null } satisfies SessionLookup;
      const remembered = memo.get(key);
      if (remembered && entryValid(remembered, list, now)) {
        return { cached: remembered, mark: list.mark } satisfies SessionLookup;
      }
      if (remembered) memo.delete(key);
      const cache = yield* openCache();
      if (!cache) return { cached: null, mark: list.mark } satisfies SessionLookup;
      const request = yield* entryRequest(key);
      const response = yield* Effect.tryPromise(() => cache.match(request)).pipe(Effect.orElseSucceed(() => undefined));
      const shared = yield* readJson<CacheEntry>(response);
      if (shared && entryValid(shared, list, now)) {
        remember(key, shared);
        return { cached: shared, mark: list.mark } satisfies SessionLookup;
      }
      return { cached: null, mark: list.mark } satisfies SessionLookup;
    },
    Effect.orElseSucceed((): SessionLookup => ({ cached: null, mark: null })),
  ).bind(this);

  recentlyChanged(sessionId: string, userId: string, now: number): boolean {
    if (!changeList) return true;
    return changedSince(changeList, sessionId, userId, 0, now - SESSION_CACHE_TTL_MS);
  }

  readonly store = Effect.fn("SessionCache.store")(
    function* (this: SessionCache, key: SessionCacheKey, session: CachedSession, mark: number, now: number) {
      const cachedUntil = Math.min(now + SESSION_CACHE_TTL_MS, session.expiresAt);
      if (cachedUntil <= now) return;
      const entry: CacheEntry = { ...session, cachedUntil, readAt: now, changeMark: mark };
      remember(key, entry);
      const cache = yield* openCache();
      if (!cache) return;
      const request = yield* entryRequest(key);
      yield* Effect.tryPromise(() => cache.put(request, cacheResponse(entry, cachedUntil - now)));
    },
    (operation) => Effect.ignore(operation),
  ).bind(this);

  readonly forget = Effect.fn("SessionCache.forget")(
    function* (
      this: SessionCache,
      changed: { keys?: readonly SessionCacheKey[]; subjects: readonly SessionCacheSubject[] },
      now: number,
    ) {
      noteLocalChanges(changed.subjects, now);
      const keys = changed.keys ?? [];
      for (const key of keys) memo.delete(key);
      const cache = yield* openCache();
      if (!cache) return;
      yield* Effect.tryPromise(() => cache.delete(changesRequest())).pipe(Effect.ignore);
      for (const key of keys) {
        const request = yield* entryRequest(key);
        yield* Effect.tryPromise(() => cache.delete(request)).pipe(Effect.ignore);
      }
    },
    (operation) => Effect.ignore(operation),
  ).bind(this);
}
