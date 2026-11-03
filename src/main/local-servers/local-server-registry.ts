// The servers on this computer that the desktop app starts as child processes, and the owner
// password of each one.
//
// The password is the one secret here, and it is sealed with the secret storage cipher. The rest of
// a row is plaintext, so a computer that loses its keychain still knows which folders belong to which
// server. The child's own identity is pinned at its first start: a later start that names another
// key is refused, as for a joined server.
//
// The pending removals name deleted servers that the account service can still list, because the
// desktop app was signed out or offline when they were deleted. They live in their own file, which
// an older build never rewrites. The servers file's `removedHostIds` is read only as a legacy copy.
//
// Electron-free, with the cipher injected.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema, Semaphore } from "effect";
import {
  isEmptyStoredFile,
  parseStoredJson,
  setAsideDamagedFile,
  writeJsonFileAtomically,
} from "../../backend/atomic-json-file";

export const LOCAL_SERVERS_FILE = "openbot-local-servers-v1.json";

/** The folder names come from this id, so a changed file cannot name a path outside the two roots. */
const folderId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u),
);

const storedLocalServerSchema = Schema.Struct({
  id: folderId,
  name: Schema.String,
  createdAt: Schema.String,
  encryptedSecret: Schema.String,
  /** Null until the first start reports the identity of the server. */
  serverId: Schema.NullOr(Schema.String),
  fingerprint: Schema.NullOr(Schema.String),
  publicKey: Schema.NullOr(Schema.String),
});

const registryFileSchema = Schema.Struct({
  version: Schema.Literal(1),
  servers: Schema.Array(storedLocalServerSchema),
  removedHostIds: Schema.optional(Schema.Array(Schema.String)),
});

export type StoredLocalServer = typeof storedLocalServerSchema.Type;

export class LocalServerRegistryError extends Schema.TaggedError<LocalServerRegistryError>()(
  "LocalServerRegistryError",
  { cause: Schema.Defect() },
) {}

const decodeRegistryFile = Schema.decodeUnknownSync(registryFileSchema);

/**
 * The deleted servers that still wait for the account service. It lives in its own file, because an
 * earlier build rewrites the servers file without the field above and would drop a pending removal.
 */
const PENDING_REMOVALS_FILE = "openbot-local-servers-pending-removals-v1.json";

const pendingRemovalsSchema = Schema.Struct({
  version: Schema.Literal(1),
  removedHostIds: Schema.Array(Schema.String),
});

const decodePendingRemovals = Schema.decodeUnknownSync(pendingRemovalsSchema);

/** The two lists hold the same IDs, in any order. Both are sets: `remove` and `forgetRemovedHost` keep them so. */
function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

export class LocalServerRegistry {
  readonly #path: string;
  readonly #pendingPath: string;
  #servers: readonly StoredLocalServer[] = [];
  #removedHostIds: readonly string[] = [];
  /** The list the pending file holds, or null while that file does not exist. A write touches it only on a change. */
  #pendingOnDisk: readonly string[] | null = null;
  /** Set when the file exists and this build cannot read it. Every write is then refused. */
  #readOnly = false;
  readonly #writes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#path = path;
    this.#pendingPath = join(dirname(path), PENDING_REMOVALS_FILE);
  }

  get servers(): readonly StoredLocalServer[] {
    return this.#servers;
  }

  /**
   * Deleted servers that the account service can still list. A server whose row still exists is left
   * out: its removal has not finished, and removing its account would deregister a live server.
   */
  get removedHostIds(): readonly string[] {
    return this.#removedHostIds.filter((hostId) => !this.#servers.some((server) => server.serverId === hostId));
  }

  get readOnly(): boolean {
    return this.#readOnly;
  }

  /**
   * A missing file is a first run, and an empty one is moved aside. A file this build cannot read
   * keeps its servers on disk: no server starts, and no write replaces it.
   */
  readonly load = Effect.fn("LocalServerRegistry.load")(function* (this: LocalServerRegistry) {
    yield* this.#loadServersFile();
    yield* this.#loadPendingRemovals();
    // An earlier build kept the list in the servers file. It moves to the pending file once, here,
    // before any other build can rewrite the servers file. After that the pending file is the only source.
    // A failed migration makes the registry read-only and drops the inline list, so no stale ID is actionable.
    if (!this.#readOnly && this.#pendingOnDisk === null && this.#removedHostIds.length)
      yield* this.#persistPendingRemovals(this.#removedHostIds).pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            this.#readOnly = true;
            this.#removedHostIds = [];
          }),
        ),
      );
  });

  readonly #loadServersFile = Effect.fn("LocalServerRegistry.loadServersFile")(function* (this: LocalServerRegistry) {
    const contents = yield* Effect.tryPromise({
      try: () => readFile(this.#path, "utf8"),
      catch: (cause) => new LocalServerRegistryError({ cause }),
    }).pipe(Effect.result);
    if (Result.isFailure(contents)) {
      const { cause } = contents.failure;
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return;
      this.#readOnly = true;
      return yield* contents.failure;
    }
    if (isEmptyStoredFile(contents.success)) return yield* setAsideDamagedFile(this.#path);
    const file = yield* Effect.try({
      try: () => parseStoredJson(this.#path, contents.success, decodeRegistryFile),
      catch: (cause) => new LocalServerRegistryError({ cause }),
    }).pipe(Effect.tapError(() => Effect.sync(() => (this.#readOnly = true))));
    this.#servers = file.servers;
    this.#removedHostIds = file.removedHostIds ?? [];
  });

  /** A missing file holds no pending removal. A file this build cannot read makes the registry read-only. */
  readonly #loadPendingRemovals = Effect.fn("LocalServerRegistry.loadPendingRemovals")(function* (
    this: LocalServerRegistry,
  ) {
    const contents = yield* Effect.tryPromise({
      try: () => readFile(this.#pendingPath, "utf8"),
      catch: (cause) => new LocalServerRegistryError({ cause }),
    }).pipe(Effect.result);
    // Once this file exists it is the whole list, so an inline copy in the servers file is never
    // actionable. An unreadable file is left in place: its list is unknown, so nothing is pending, and
    // the registry refuses writes. Nothing is set aside, so the next start sees the same file and the
    // same refusal, and cannot fall back to the servers file's copy.
    if (Result.isFailure(contents)) {
      const { cause } = contents.failure;
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return;
      this.#readOnly = true;
      this.#removedHostIds = [];
      return yield* contents.failure;
    }
    if (isEmptyStoredFile(contents.success)) {
      this.#readOnly = true;
      this.#removedHostIds = [];
      return;
    }
    const file = yield* Effect.try({
      try: () => parseStoredJson(this.#pendingPath, contents.success, decodePendingRemovals),
      catch: (cause) => new LocalServerRegistryError({ cause }),
    }).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          this.#readOnly = true;
          this.#removedHostIds = [];
        }),
      ),
    );
    this.#pendingOnDisk = file.removedHostIds;
    this.#removedHostIds = file.removedHostIds;
  });

  /** Writes the list, then records it as what the disk holds. A failed write leaves the record unchanged. */
  readonly #persistPendingRemovals = Effect.fn("LocalServerRegistry.persistPendingRemovals")(function* (
    this: LocalServerRegistry,
    removedHostIds: readonly string[],
  ) {
    yield* writeJsonFileAtomically(this.#pendingPath, { version: 1, removedHostIds }, { createDirectory: true }).pipe(
      Effect.mapError(({ cause }) => new LocalServerRegistryError({ cause })),
    );
    this.#pendingOnDisk = removedHostIds;
  });

  find(id: string): StoredLocalServer | undefined {
    return this.#servers.find((server) => server.id === id);
  }

  findByServerId(serverId: string): StoredLocalServer | undefined {
    return this.#servers.find((server) => server.serverId === serverId);
  }

  /** The check of the limit and the write hold one permit, so two creates cannot both pass the check. */
  add(server: StoredLocalServer, limit: number): Effect.Effect<void, LocalServerRegistryError> {
    return this.#write((servers) =>
      servers.length < limit
        ? [...servers, server]
        : new LocalServerRegistryError({ cause: new Error(sourceText("error.remote.localServerLimit", { limit })) }),
    );
  }

  update(id: string, change: Partial<Omit<StoredLocalServer, "id">>): Effect.Effect<void, LocalServerRegistryError> {
    return this.#write((servers) => servers.map((server) => (server.id === id ? { ...server, ...change } : server)));
  }

  /** `removedHostId` stays listed until the account service no longer has the server. */
  remove(id: string, removedHostId: string | null = null): Effect.Effect<void, LocalServerRegistryError> {
    return this.#write(
      (servers) => servers.filter((server) => server.id !== id),
      (removed) => (removedHostId === null || removed.includes(removedHostId) ? removed : [...removed, removedHostId]),
    );
  }

  /** The account service no longer lists the server. */
  forgetRemovedHost(hostId: string): Effect.Effect<void, LocalServerRegistryError> {
    return this.#write(
      (servers) => servers,
      (removed) => removed.filter((candidate) => candidate !== hostId),
    );
  }

  #write(
    change: (servers: readonly StoredLocalServer[]) => readonly StoredLocalServer[] | LocalServerRegistryError,
    changeRemoved: (removedHostIds: readonly string[]) => readonly string[] = (removedHostIds) => removedHostIds,
  ): Effect.Effect<void, LocalServerRegistryError> {
    return this.#writes.withPermit(
      Effect.suspend(() => {
        if (this.#readOnly)
          return Effect.fail(
            new LocalServerRegistryError({ cause: new Error(sourceText("error.remote.localServersReadOnly")) }),
          );
        const servers = change(this.#servers);
        if (servers instanceof LocalServerRegistryError) return Effect.fail(servers);
        const removedHostIds = changeRemoved(this.#removedHostIds);
        // An ordinary edit does not touch the pending file. Its absence counts as an empty list.
        const changed = !sameIds(removedHostIds, this.#pendingOnDisk ?? []);
        // The pending list goes first. A crash between the two writes leaves a removal that the row
        // filter in `removedHostIds` holds back while its server row is still on disk. The servers
        // file never carries the list, so an older copy of it cannot bring back an acknowledged ID.
        return (changed ? this.#persistPendingRemovals(removedHostIds) : Effect.void).pipe(
          Effect.andThen(
            writeJsonFileAtomically(this.#path, { version: 1, servers }, { createDirectory: true }).pipe(
              Effect.mapError(({ cause }) => new LocalServerRegistryError({ cause })),
            ),
          ),
          Effect.tap(() =>
            Effect.sync(() => {
              this.#servers = servers;
              this.#removedHostIds = removedHostIds;
            }),
          ),
        );
      }),
    );
  }
}
