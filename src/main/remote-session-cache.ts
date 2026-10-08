import { readFile, rm } from "node:fs/promises";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { Effect, Semaphore } from "effect";
import { writeFileAtomically } from "../backend/atomic-json-file";

/** A logical remote session of the account service, kept so that the next start only asks for a ticket. */
export interface CachedRemoteSession {
  readonly sessionId: string;
  readonly expiresAt: number;
}

export interface RemoteSessionCacheOptions {
  path: string;
  canPersist: () => boolean;
  encrypt: (value: string) => Buffer;
  decrypt: (value: Buffer) => string;
}

interface CacheState {
  principalId: string;
  /** The Signal address of the last ticket. The next start opens its socket while the ticket is made. */
  signalUrl: string | null;
  sessions: Map<string, CachedRemoteSession>;
}

const CACHE_VERSION = 1;

/**
 * The remote sessions of the signed-in account, one for each host, between two runs of the app.
 *
 * A session ID is not a credential: the account service gives a ticket for it only with the account's
 * own session token, and only while that device sign-in is not revoked. The file is encrypted with
 * the operating-system storage all the same, as the other account records are. It holds one
 * account; a record of another account is not used.
 *
 * Every failure is ignored. A missing or unreadable file only means that the next connect starts a
 * new session, as it did before this cache.
 */
export class RemoteSessionCache {
  readonly #options: RemoteSessionCacheOptions;
  readonly #writes = Semaphore.makeUnsafe(1);
  #state: CacheState | null = null;
  #loaded: Effect.Effect<void> | null = null;

  constructor(options: RemoteSessionCacheOptions) {
    this.#options = options;
  }

  /** Whether a session kept now can be read by the next run. */
  canPersist(): boolean {
    try {
      return this.#options.canPersist();
    } catch {
      return false;
    }
  }

  /** Reads the file once. Later calls wait for the same read. */
  load(): Effect.Effect<void> {
    this.#loaded ??= Effect.runSync(Effect.cached(this.#read()));
    return this.#loaded;
  }

  get(principalId: string, hostId: string): CachedRemoteSession | null {
    if (this.#state?.principalId !== principalId) return null;
    return this.#state.sessions.get(hostId) ?? null;
  }

  signalUrl(principalId: string): string | null {
    return this.#state?.principalId === principalId ? this.#state.signalUrl : null;
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

  /** Forgets every session, such as at sign-out or when another account signs in. */
  clear(): Effect.Effect<void> {
    return this.#change(() => {
      this.#state = null;
    });
  }

  #read(): Effect.Effect<void> {
    return Effect.tryPromise(() => readFile(this.#options.path, "utf8")).pipe(
      Effect.flatMap((encrypted) =>
        Effect.try(() => decodeCache(JSON.parse(this.#options.decrypt(Buffer.from(encrypted, "base64"))))),
      ),
      Effect.tap((state) =>
        Effect.sync(() => {
          // A change made while the file was read is newer than the file.
          this.#state ??= state;
        }),
      ),
      Effect.ignore,
    );
  }

  /** Applies `update` after the file was read, and writes the result. `false` means nothing changed. */
  #change(update: () => boolean | undefined): Effect.Effect<void> {
    return this.#writes.withPermit(
      Effect.gen({ self: this }, function* () {
        yield* this.load();
        if (update() === false) return;
        yield* this.#write();
      }),
    );
  }

  #write(): Effect.Effect<void> {
    const state = this.#state;
    if (!state || state.sessions.size === 0 || !this.canPersist())
      return Effect.tryPromise(() => rm(this.#options.path, { force: true })).pipe(Effect.ignore);
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
