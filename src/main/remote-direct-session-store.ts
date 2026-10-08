import { readFile, rm } from "node:fs/promises";
import { isValidTailscaleDirectApiUrl } from "@openbot/contracts/invite-links";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { registerSecretValue } from "@openbot/logging";
import { Effect, Semaphore } from "effect";
import { writeFileAtomically } from "../backend/atomic-json-file";

/** A session of the direct Tailscale path: the host's token, its address, and when it ends. */
export interface StoredDirectSession {
  readonly url: string;
  readonly token: string;
  readonly expiresAt: number;
}

export interface RemoteDirectSessionStoreOptions {
  path: string;
  canPersist: () => boolean;
  encrypt: (value: string) => Buffer;
  decrypt: (value: Buffer) => string;
}

interface StoreState {
  principalId: string;
  sessions: Map<string, StoredDirectSession>;
}

const STORE_VERSION = 1;
/** The host token is 32 random bytes in base64url. A longer value is not one. */
const MAXIMUM_TOKEN_LENGTH = 512;

/**
 * The direct Tailscale sessions of the signed-in account, one for each joined server, between two
 * runs of the app. The next start uses the kept session after the pinned-key check, and does not ask
 * the account service for a ticket or sign in at the host again.
 *
 * The token is a credential for that host, so the file is encrypted with the operating-system
 * storage. Without that storage nothing is written and the file is removed: each start signs in
 * again, as before this store. The file holds one account; a record of another account is not used.
 *
 * Every failure is ignored. A missing, unreadable or damaged file only means that the next connection
 * signs in again.
 */
export class RemoteDirectSessionStore {
  readonly #options: RemoteDirectSessionStoreOptions;
  readonly #writes = Semaphore.makeUnsafe(1);
  #state: StoreState | null = null;
  #loaded: Effect.Effect<void> | null = null;

  constructor(options: RemoteDirectSessionStoreOptions) {
    this.#options = options;
  }

  /** Reads the file once. Later calls wait for the same read. */
  load(): Effect.Effect<void> {
    this.#loaded ??= Effect.runSync(Effect.cached(this.#read()));
    return this.#loaded;
  }

  /** The kept session of `serverId` for this account. Call `load` first. */
  get(principalId: string, serverId: string): StoredDirectSession | null {
    if (this.#state?.principalId !== principalId) return null;
    return this.#state.sessions.get(serverId) ?? null;
  }

  set(principalId: string, serverId: string, session: StoredDirectSession): Effect.Effect<void> {
    registerSecretValue(session.token);
    return this.#change(() => {
      if (this.#state?.principalId !== principalId) this.#state = { principalId, sessions: new Map() };
      const current = this.#state.sessions.get(serverId);
      if (current?.token === session.token && current.url === session.url && current.expiresAt === session.expiresAt)
        return false;
      this.#state.sessions.set(serverId, { url: session.url, token: session.token, expiresAt: session.expiresAt });
    });
  }

  delete(serverId: string): Effect.Effect<void> {
    return this.#change(() => {
      if (!this.#state?.sessions.has(serverId)) return false;
      this.#state.sessions.delete(serverId);
    });
  }

  /** Forgets every session, such as at sign-out or when another account signs in. */
  clear(): Effect.Effect<void> {
    return this.#change(() => {
      this.#state = null;
    });
  }

  #canPersist(): boolean {
    try {
      return this.#options.canPersist();
    } catch {
      return false;
    }
  }

  #read(): Effect.Effect<void> {
    return Effect.tryPromise(() => readFile(this.#options.path, "utf8")).pipe(
      Effect.flatMap((encrypted) =>
        Effect.try(() => decodeStore(JSON.parse(this.#options.decrypt(Buffer.from(encrypted, "base64"))))),
      ),
      Effect.tap((state) =>
        Effect.sync(() => {
          if (!state) return;
          for (const session of state.sessions.values()) registerSecretValue(session.token);
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
    if (!state || state.sessions.size === 0 || !this.#canPersist()) return this.#remove();
    return Effect.try(() =>
      this.#options
        .encrypt(
          JSON.stringify({
            version: STORE_VERSION,
            principalId: state.principalId,
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

function decodeStore(value: unknown): StoreState | null {
  if (!isDynamicRecord(value) || value.version !== STORE_VERSION) return null;
  if (!isString(value.principalId) || !value.principalId || !isDynamicRecord(value.sessions)) return null;
  const sessions = new Map<string, StoredDirectSession>();
  for (const [serverId, session] of Object.entries(value.sessions)) {
    if (!isDynamicRecord(session)) continue;
    const { url, token, expiresAt } = session;
    if (!isString(url) || !isValidTailscaleDirectApiUrl(url)) continue;
    if (!isString(token) || !token || token.length > MAXIMUM_TOKEN_LENGTH) continue;
    if (!isNumber(expiresAt) || !Number.isFinite(expiresAt)) continue;
    sessions.set(serverId, { url, token, expiresAt });
  }
  return { principalId: value.principalId, sessions };
}
