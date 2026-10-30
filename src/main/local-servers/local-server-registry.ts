// The servers on this computer that the desktop app starts as child processes, and the owner
// password of each one.
//
// The password is the one secret here, and it is sealed with the secret storage cipher. The rest of
// a row is plaintext, so a computer that loses its keychain still knows which folders belong to which
// server. The child's own identity is pinned at its first start: a later start that names another
// key is refused, as for a joined server.
//
// Electron-free, with the cipher injected.

import { readFile } from "node:fs/promises";
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
});

export type StoredLocalServer = typeof storedLocalServerSchema.Type;

export class LocalServerRegistryError extends Schema.TaggedError<LocalServerRegistryError>()(
  "LocalServerRegistryError",
  { cause: Schema.Defect() },
) {}

const decodeRegistryFile = Schema.decodeUnknownSync(registryFileSchema);

export class LocalServerRegistry {
  readonly #path: string;
  #servers: readonly StoredLocalServer[] = [];
  /** Set when the file exists and this build cannot read it. Every write is then refused. */
  #readOnly = false;
  readonly #writes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#path = path;
  }

  get servers(): readonly StoredLocalServer[] {
    return this.#servers;
  }

  get readOnly(): boolean {
    return this.#readOnly;
  }

  /**
   * A missing file is a first run, and an empty one is moved aside. A file this build cannot read
   * keeps its servers on disk: no server starts, and no write replaces it.
   */
  readonly load = Effect.fn("LocalServerRegistry.load")(function* (this: LocalServerRegistry) {
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

  remove(id: string): Effect.Effect<void, LocalServerRegistryError> {
    return this.#write((servers) => servers.filter((server) => server.id !== id));
  }

  #write(
    change: (servers: readonly StoredLocalServer[]) => readonly StoredLocalServer[] | LocalServerRegistryError,
  ): Effect.Effect<void, LocalServerRegistryError> {
    return this.#writes.withPermit(
      Effect.suspend(() => {
        if (this.#readOnly)
          return Effect.fail(
            new LocalServerRegistryError({ cause: new Error(sourceText("error.remote.localServersReadOnly")) }),
          );
        const servers = change(this.#servers);
        if (servers instanceof LocalServerRegistryError) return Effect.fail(servers);
        return writeJsonFileAtomically(this.#path, { version: 1, servers }, { createDirectory: true }).pipe(
          Effect.mapError(({ cause }) => new LocalServerRegistryError({ cause })),
          Effect.tap(() => Effect.sync(() => (this.#servers = servers))),
        );
      }),
    );
  }
}
