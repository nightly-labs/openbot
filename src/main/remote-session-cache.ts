import { readFile, rm } from "node:fs/promises";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { Effect, Semaphore } from "effect";
import { writeFileAtomically } from "../backend/atomic-json-file";

export interface CachedRemoteSession {
  readonly sessionId: string;
  readonly expiresAt: number;
}

export interface RemoteSessionCacheOptions {
  path: string;
  canPersist: () => boolean;
  encrypt: (value: string) => Buffer;
  decrypt: (value: Buffer) => string;
  enabled?: boolean;
}

interface CacheState {
  principalId: string;
  signalUrl: string | null;
  sessions: Map<string, CachedRemoteSession>;
}

const CACHE_VERSION = 1;

export class RemoteSessionCache {
  readonly #options: RemoteSessionCacheOptions;
  readonly #writes = Semaphore.makeUnsafe(1);
  #state: CacheState | null = null;
  #loaded: Effect.Effect<void> | null = null;
  #enabled: boolean;

  constructor(options: RemoteSessionCacheOptions) {
    this.#options = options;
    this.#enabled = options.enabled ?? true;
  }

  canPersist(): boolean {
    if (!this.#enabled) return false;
    try {
      return this.#options.canPersist();
    } catch {
      return false;
    }
  }

  setEnabled(enabled: boolean): Effect.Effect<void> {
    return this.#writes.withPermit(
      Effect.gen({ self: this }, function* () {
        yield* this.load();
        this.#enabled = enabled;
        yield* this.#write();
      }),
    );
  }

  load(): Effect.Effect<void> {
    this.#loaded ??= Effect.runSync(Effect.cached(this.#read()));
    return this.#loaded;
  }

  get(principalId: string, hostId: string): CachedRemoteSession | null {
    if (!this.#enabled || this.#state?.principalId !== principalId) return null;
    return this.#state.sessions.get(hostId) ?? null;
  }

  signalUrl(principalId: string): string | null {
    return this.#enabled && this.#state?.principalId === principalId ? this.#state.signalUrl : null;
  }

  set(principalId: string, hostId: string, session: CachedRemoteSession, signalUrl: string): Effect.Effect<void> {
    return this.#change(() => {
      if (this.#state?.principalId !== principalId) this.#state = { principalId, signalUrl: null, sessions: new Map() };
      const current = this.#state.sessions.get(hostId);
      if (
        this.#state.signalUrl === signalUrl &&
        current?.sessionId === session.sessionId &&
        current.expiresAt === session.expiresAt
      )
        return false;
      this.#state.signalUrl = signalUrl;
      this.#state.sessions.set(hostId, { sessionId: session.sessionId, expiresAt: session.expiresAt });
    });
  }

  delete(hostId: string): Effect.Effect<void> {
    return this.#change(() => {
      if (!this.#state?.sessions.has(hostId)) return false;
      this.#state.sessions.delete(hostId);
    });
  }

  clear(): Effect.Effect<void> {
    return this.#change(() => {
      this.#state = null;
    });
  }

  #read(): Effect.Effect<void> {
    if (!this.#enabled) return this.#remove();
    return Effect.tryPromise(() => readFile(this.#options.path, "utf8")).pipe(
      Effect.flatMap((encrypted) =>
        Effect.try(() => decodeCache(JSON.parse(this.#options.decrypt(Buffer.from(encrypted, "base64"))))),
      ),
      Effect.tap((state) =>
        Effect.sync(() => {
          this.#state ??= state;
        }),
      ),
      Effect.ignore,
    );
  }

  #change(update: () => boolean | undefined): Effect.Effect<void> {
    return this.#writes.withPermit(
      Effect.gen({ self: this }, function* () {
        yield* this.load();
        if (update() === false || !this.#enabled) return;
        yield* this.#write();
      }),
    );
  }

  #write(): Effect.Effect<void> {
    const state = this.#state;
    if (!state || state.sessions.size === 0 || !this.canPersist()) return this.#remove();
    return Effect.try(() =>
      this.#options
        .encrypt(
          JSON.stringify({
            version: CACHE_VERSION,
            principalId: state.principalId,
            signalUrl: state.signalUrl,
            sessions: Object.fromEntries(state.sessions),
          }),
        )
        .toString("base64"),
    ).pipe(
      Effect.flatMap((content) => writeFileAtomically(this.#options.path, content, { createDirectory: true })),
      Effect.ignore,
    );
  }

  #remove(): Effect.Effect<void> {
    return Effect.tryPromise(() => rm(this.#options.path, { force: true })).pipe(Effect.ignore);
  }
}

function decodeCache(value: unknown): CacheState | null {
  if (!isDynamicRecord(value) || value.version !== CACHE_VERSION || !isString(value.principalId)) return null;
  if (!isDynamicRecord(value.sessions)) return null;
  const sessions = new Map<string, CachedRemoteSession>();
  for (const [hostId, session] of Object.entries(value.sessions)) {
    if (!isDynamicRecord(session) || !isString(session.sessionId) || !session.sessionId) continue;
    if (!isNumber(session.expiresAt) || !Number.isFinite(session.expiresAt)) continue;
    sessions.set(hostId, { sessionId: session.sessionId, expiresAt: session.expiresAt });
  }
  return {
    principalId: value.principalId,
    signalUrl: isSignalUrl(value.signalUrl) ? value.signalUrl : null,
    sessions,
  };
}

function isSignalUrl(value: unknown): value is string {
  if (!isString(value)) return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "wss:" || protocol === "ws:";
  } catch {
    return false;
  }
}
