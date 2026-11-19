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

const folderId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u),
);

const storedLocalServerSchema = Schema.Struct({
  id: folderId,
  name: Schema.String,
  createdAt: Schema.String,
  encryptedSecret: Schema.String,
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

export class LocalServerRegistry {
  readonly #path: string;
  #servers: readonly StoredLocalServer[] = [];
  #removedHostIds: readonly string[] = [];
  #readOnly = false;
  readonly #writes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#path = path;
  }

  get servers(): readonly StoredLocalServer[] {
    return this.#servers;
  }

  get removedHostIds(): readonly string[] {
    return this.#removedHostIds;
  }

  get readOnly(): boolean {
    return this.#readOnly;
  }

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
    this.#removedHostIds = file.removedHostIds ?? [];
  });

  find(id: string): StoredLocalServer | undefined {
    return this.#servers.find((server) => server.id === id);
  }

  findByServerId(serverId: string): StoredLocalServer | undefined {
    return this.#servers.find((server) => server.serverId === serverId);
  }

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

  remove(id: string, removedHostId: string | null = null): Effect.Effect<void, LocalServerRegistryError> {
    return this.#write(
      (servers) => servers.filter((server) => server.id !== id),
      (removed) => (removedHostId === null || removed.includes(removedHostId) ? removed : [...removed, removedHostId]),
    );
  }

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
        const file = removedHostIds.length ? { version: 1, servers, removedHostIds } : { version: 1, servers };
        return writeJsonFileAtomically(this.#path, file, { createDirectory: true }).pipe(
          Effect.mapError(({ cause }) => new LocalServerRegistryError({ cause })),
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
