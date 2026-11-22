import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, readdir, readFile, readlink, rename, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { API_KEY_NAME_PATTERN } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, type LogValue, registerSecretValue, toLogValue } from "@openbot/logging";
import { Effect, Result, Schema, Semaphore } from "effect";
import { writeFileAtomically } from "./atomic-json-file";
import { isMissingFileError } from "./file-errors";
import type { VaultAgent, VaultItems } from "./vault-items";

const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const VAULT_FOLDER = ".vault";

const WRITTEN_KEYS_FILE = ".openbot-keys";

export interface SavedApiKey {
  name: string;
  path: string;
  source?: "vault";
}

export class AgentApiKeyFailed extends Schema.TaggedError<AgentApiKeyFailed>()("AgentApiKeyFailed", {
  cause: Schema.Defect(),
}) {}

const failed = (cause?: unknown) =>
  new AgentApiKeyFailed({ cause: new Error(sourceText("error.backend.apiKeySaveFailed"), { cause }) });

export function apiKeyFailureLog(failure: AgentApiKeyFailed): LogValue {
  const { cause } = failure;
  return toLogValue(cause instanceof Error && cause.cause !== undefined ? cause.cause : cause);
}

const logger = createOpenBotLogger("agent-api-keys");

const skipSync = (step: string) => (failure: AgentApiKeyFailed) =>
  Effect.sync(() =>
    logger.warn("A saved API key could not be updated while listing keys", {
      step,
      error: apiKeyFailureLog(failure),
    }),
  );

export type AgentApiKeyVault = Pick<
  VaultItems,
  "ready" | "apiKeys" | "sharedApiKeys" | "saveApiKey" | "removeAgentApiKey"
>;

export class AgentApiKeys {
  readonly #root: string;
  readonly #vault: AgentApiKeyVault | null;
  readonly #link: LinkFile;
  readonly #files = Semaphore.makeUnsafe(1);

  constructor(root: string, vault: AgentApiKeyVault | null = null, link: LinkFile = symlink) {
    this.#root = root;
    this.#vault = vault;
    this.#link = link;
  }

  readonly save = Effect.fn("AgentApiKeys.save")(function* (
    this: AgentApiKeys,
    agent: VaultAgent,
    name: string,
    value: string,
  ) {
    const path = yield* this.#keyPath(agent.id, name);
    registerSecretValue(value);
    const vault = this.#readyVault();
    const folder = join(this.#root, agent.id);
    if (!vault) {
      yield* this.#files.withPermit(
        Effect.gen(function* () {
          const copies = yield* readWrittenKeys(folder);
          yield* writeKeyRecord(
            folder,
            copies,
            [...copies].filter((copy) => copy !== name),
          );
          yield* writeFileAtomically(path, value, { createDirectory: true }).pipe(Effect.mapError(failed));
        }),
      );
      return { name, path } satisfies SavedApiKey;
    }
    yield* vault.saveApiKey({ name, key: value }, agent, true).pipe(Effect.mapError(failed));
    yield* this.#files.withPermit(this.#removeOldKey(agent.id, name));
    const keys = yield* this.list(agent.id);
    const saved = keys.find((key) => key.name === name && key.source === undefined);
    return saved ?? (yield* failed());
  });

  readonly has = Effect.fn("AgentApiKeys.has")(function* (this: AgentApiKeys, agentId: string, name: string) {
    if (!AGENT_ID_PATTERN.test(agentId) || !API_KEY_NAME_PATTERN.test(name)) return false;
    if ((yield* this.#plainKeys(agentId)).some((key) => key.name === name)) return true;
    return (this.#readyVault()?.apiKeys(agentId) ?? []).some((key) => key.own && key.name === name);
  });

  readonly list = Effect.fn("AgentApiKeys.list")(function* (this: AgentApiKeys, agentId: string) {
    const folder = yield* this.#agentFolder(agentId);
    return yield* this.#files.withPermit(
      Effect.gen({ self: this }, function* () {
        yield* this.#moveIntoVault(agentId).pipe(Effect.catch(skipSync("move")));
        const own = yield* this.#plainKeys(agentId);
        const vault = yield* this.#writeAgent(folder, agentId).pipe(
          Effect.catch((failure) =>
            skipSync("vault copies")(failure).pipe(Effect.andThen(this.#readableVaultKeys(folder, agentId))),
          ),
        );
        yield* this.#writeShared().pipe(Effect.ignore);
        yield* this.#linkOwnKeys(agentId);
        const shown = vault.filter((key) => !own.some((entry) => entry.name === key.name));
        return [...own, ...shown].sort((a, b) => a.name.localeCompare(b.name));
      }),
    );
  });

  readonly syncVault = Effect.fn("AgentApiKeys.syncVault")(function* (this: AgentApiKeys) {
    yield* this.#files.withPermit(
      Effect.gen({ self: this }, function* () {
        const agents = yield* Effect.tryPromise({ try: () => folderNames(this.#root), catch: failed });
        for (const agentId of agents.filter((id) => AGENT_ID_PATTERN.test(id))) yield* this.#moveIntoVault(agentId);
        if (agents.includes(VAULT_FOLDER)) yield* this.#writeShared();
        const vaultFolder = join(this.#root, VAULT_FOLDER);
        const copies = yield* Effect.tryPromise({ try: () => folderNames(vaultFolder), catch: failed });
        for (const agentId of copies.filter((id) => AGENT_ID_PATTERN.test(id)))
          yield* this.#writeAgent(join(vaultFolder, agentId), agentId).pipe(Effect.ignore);
        for (const agentId of agents.filter((id) => AGENT_ID_PATTERN.test(id))) {
          const own = this.#readyVault()
            ?.apiKeys(agentId)
            .some((key) => key.own);
          if (own && !copies.includes(agentId))
            yield* this.#writeAgent(join(vaultFolder, agentId), agentId).pipe(Effect.ignore);
          yield* this.#linkOwnKeys(agentId);
        }
      }),
    );
  });

  readonly remove = Effect.fn("AgentApiKeys.remove")(function* (this: AgentApiKeys, agentId: string, name: string) {
    yield* this.#keyPath(agentId, name);
    const folder = yield* this.#agentFolder(agentId);
    return yield* this.#files.withPermit(
      Effect.gen({ self: this }, function* () {
        const plain = yield* this.#removeOldKey(agentId, name);
        const vault = this.#readyVault();
        const own = vault ? yield* vault.removeAgentApiKey(agentId, name).pipe(Effect.mapError(failed)) : false;
        if (vault) yield* this.#writeAgent(folder, agentId);
        yield* this.#linkOwnKeys(agentId);
        return plain || own;
      }),
    );
  });

  readonly removeAgent = Effect.fn("AgentApiKeys.removeAgent")(function* (this: AgentApiKeys, agentId: string) {
    const folder = yield* this.#agentFolder(agentId);
    yield* this.#files.withPermit(
      Effect.forEach([join(this.#root, agentId), folder], (path) =>
        Effect.tryPromise({ try: () => rm(path, { recursive: true, force: true }), catch: failed }),
      ),
    );
  });

  readonly registerSaved = Effect.fn("AgentApiKeys.registerSaved")(function* (this: AgentApiKeys) {
    const agents = yield* Effect.promise(() => folderNames(this.#root).catch((): string[] => []));
    for (const agentId of agents.filter((id) => AGENT_ID_PATTERN.test(id))) {
      const keys = yield* this.#plainKeys(agentId).pipe(Effect.catch(() => Effect.succeed<SavedApiKey[]>([])));
      for (const key of keys) {
        const value = yield* Effect.promise(() => readFile(key.path, "utf8").catch(() => ""));
        registerSecretValue(value);
      }
    }
  });

  #readyVault(): AgentApiKeyVault | null {
    return this.#vault?.ready() ? this.#vault : null;
  }

  #moveIntoVault(agentId: string): Effect.Effect<void, AgentApiKeyFailed> {
    return Effect.gen({ self: this }, function* () {
      const vault = this.#readyVault();
      if (!vault) return;
      const moved: SavedApiKey[] = [];
      for (const key of yield* this.#plainKeys(agentId)) {
        const value = (yield* Effect.promise(() => readFile(key.path, "utf8").catch(() => null)))?.trim();
        if (!value) continue;
        const kept = vault
          .apiKeys(agentId)
          .some((saved) => saved.own && saved.name === key.name && saved.value === value);
        const saved =
          kept ||
          Result.isSuccess(
            yield* Effect.result(
              vault.saveApiKey({ name: key.name, key: value }, { id: agentId, name: undefined }, true),
            ),
          );
        if (saved) moved.push(key);
      }
      if (moved.length === 0) return;
      const copied = yield* this.#writeAgent(join(this.#root, VAULT_FOLDER, agentId), agentId).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
      if (!copied) return;
      const copies: string[] = [];
      for (const key of moved) {
        const linked = yield* replaceWithLink(this.#link, key.path, ownKeyLinkTarget(agentId, key.name));
        if (!linked) copies.push(key.name);
      }
      if (copies.length === 0) return;
      const folder = join(this.#root, agentId);
      yield* readWrittenKeys(folder).pipe(
        Effect.flatMap((record) => writeKeyRecord(folder, record, [...record, ...copies])),
        Effect.ignore,
      );
    });
  }

  #writeAgent(folder: string, agentId: string): Effect.Effect<SavedApiKey[], AgentApiKeyFailed> {
    return Effect.gen({ self: this }, function* () {
      const keys = (this.#readyVault()?.apiKeys(agentId) ?? []).filter(({ name }) => API_KEY_NAME_PATTERN.test(name));
      yield* removeKeyFiles(folder, new Map(keys.map(({ name, value }) => [name, value])));
      const written: SavedApiKey[] = [];
      for (const { name, value, own } of keys) {
        const path = join(folder, name);
        yield* writeIfChanged(path, value);
        written.push({ name, path, ...(own ? {} : { source: "vault" as const }) });
      }
      return written;
    });
  }

  #readableVaultKeys(folder: string, agentId: string): Effect.Effect<SavedApiKey[]> {
    const keys = (this.#readyVault()?.apiKeys(agentId) ?? []).filter(({ name }) => API_KEY_NAME_PATTERN.test(name));
    return Effect.promise(async () => {
      const readable: SavedApiKey[] = [];
      for (const { name, own } of keys) {
        const path = join(folder, name);
        if (
          await access(path, constants.R_OK).then(
            () => true,
            () => false,
          )
        )
          readable.push({ name, path, ...(own ? {} : { source: "vault" as const }) });
      }
      return readable;
    });
  }

  #writeShared(): Effect.Effect<void, AgentApiKeyFailed> {
    return Effect.gen({ self: this }, function* () {
      const folder = join(this.#root, VAULT_FOLDER);
      const keys = new Map(
        (this.#readyVault()?.sharedApiKeys() ?? [])
          .filter(({ name }) => API_KEY_NAME_PATTERN.test(name))
          .map(({ name, value }) => [name, value]),
      );
      yield* removeKeyFiles(folder, keys);
      for (const [name, value] of keys) yield* writeIfChanged(join(folder, name), value);
    });
  }

  #linkOwnKeys(agentId: string): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (!AGENT_ID_PATTERN.test(agentId)) return;
      const folder = join(this.#root, agentId);
      const entries = yield* Effect.tryPromise({ try: () => readdir(folder, { withFileTypes: true }), catch: failed });
      const vault = this.#readyVault();
      const own = new Map(
        (vault?.apiKeys(agentId) ?? [])
          .filter((key) => key.own && API_KEY_NAME_PATTERN.test(key.name))
          .map((key) => [key.name, key.value]),
      );
      const copies = yield* readWrittenKeys(folder);
      const kept = new Set<string>();
      for (const name of copies) {
        if (own.has(name)) kept.add(name);
        else if (
          !(yield* removeFile(join(folder, name)).pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          ))
        )
          kept.add(name);
      }
      if (!vault) return yield* writeKeyRecord(folder, copies, kept);
      for (const entry of entries) {
        const path = join(folder, entry.name);
        if (isStoppedWrite(entry.name)) {
          yield* Effect.tryPromise({ try: () => rm(path), catch: failed }).pipe(Effect.ignore);
          continue;
        }
        if (!entry.isSymbolicLink() || own.has(entry.name) || !API_KEY_NAME_PATTERN.test(entry.name)) continue;
        yield* Effect.tryPromise({
          try: async () => {
            if ((await readlink(path)) === ownKeyLinkTarget(agentId, entry.name)) await rm(path);
          },
          catch: failed,
        }).pipe(Effect.ignore);
      }
      const present = new Set(entries.map((entry) => entry.name));
      for (const name of own.keys()) {
        if (present.has(name) || kept.has(name)) continue;
        const linked = yield* Effect.tryPromise({
          try: () => this.#link(ownKeyLinkTarget(agentId, name), join(folder, name)),
          catch: failed,
        }).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
        if (!linked) kept.add(name);
      }
      yield* writeKeyRecord(folder, copies, kept);
      for (const [name, value] of own)
        if (kept.has(name)) yield* writeIfChanged(join(folder, name), value).pipe(Effect.ignore);
    }).pipe(Effect.ignore);
  }

  #removeOldKey(agentId: string, name: string): Effect.Effect<boolean, AgentApiKeyFailed> {
    const folder = join(this.#root, agentId);
    return readWrittenKeys(folder).pipe(
      Effect.flatMap((copies) =>
        copies.has(name) ? Effect.succeed(false) : removeOldKey(join(folder, name), ownKeyLinkTarget(agentId, name)),
      ),
    );
  }

  #plainKeys(agentId: string): Effect.Effect<SavedApiKey[], AgentApiKeyFailed> {
    return Effect.gen({ self: this }, function* () {
      if (!AGENT_ID_PATTERN.test(agentId)) return yield* failed();
      const folder = join(this.#root, agentId);
      const names = yield* Effect.tryPromise({ try: () => folderFiles(folder), catch: failed });
      const copies = yield* readWrittenKeys(folder);
      return names
        .filter((name) => API_KEY_NAME_PATTERN.test(name) && !copies.has(name))
        .sort()
        .map((name): SavedApiKey => ({ name, path: join(folder, name) }));
    });
  }

  #agentFolder(agentId: string): Effect.Effect<string, AgentApiKeyFailed> {
    return AGENT_ID_PATTERN.test(agentId)
      ? Effect.succeed(join(this.#root, VAULT_FOLDER, agentId))
      : Effect.fail(failed());
  }

  #keyPath(agentId: string, name: string): Effect.Effect<string, AgentApiKeyFailed> {
    if (!API_KEY_NAME_PATTERN.test(name) || !AGENT_ID_PATTERN.test(agentId)) return Effect.fail(failed());
    return Effect.succeed(join(this.#root, agentId, name));
  }
}

function removeKeyFiles(folder: string, keys: ReadonlyMap<string, string>): Effect.Effect<void, AgentApiKeyFailed> {
  return Effect.gen(function* () {
    const names = yield* Effect.tryPromise({ try: () => folderFiles(folder), catch: failed });
    const written = yield* readWrittenKeys(folder);
    for (const name of names) {
      const stale = API_KEY_NAME_PATTERN.test(name) ? written.has(name) && !keys.has(name) : isStoppedWrite(name);
      if (stale) yield* removeFile(join(folder, name));
    }
    yield* writeKeyRecord(folder, written, keys.keys());
  });
}

function writeKeyRecord(
  folder: string,
  written: ReadonlySet<string>,
  names: Iterable<string>,
): Effect.Effect<void, AgentApiKeyFailed> {
  const next = [...new Set(names)].sort();
  if (next.length === written.size && next.every((name) => written.has(name))) return Effect.void;
  return writeFileAtomically(join(folder, WRITTEN_KEYS_FILE), next.map((name) => `${name}\n`).join(""), {
    createDirectory: true,
  }).pipe(Effect.mapError(failed));
}

function readWrittenKeys(folder: string): Effect.Effect<ReadonlySet<string>, AgentApiKeyFailed> {
  return Effect.tryPromise({
    try: () =>
      readFile(join(folder, WRITTEN_KEYS_FILE), "utf8").then(
        (text) => new Set(text.split("\n").filter((name) => API_KEY_NAME_PATTERN.test(name))),
        (error: unknown) => (isMissingFileError(error) ? new Set<string>() : Promise.reject(error)),
      ),
    catch: failed,
  });
}

function removeFile(path: string): Effect.Effect<boolean, AgentApiKeyFailed> {
  return Effect.tryPromise({
    try: () =>
      rm(path).then(
        () => true,
        (error: unknown) => (isMissingFileError(error) ? false : Promise.reject(error)),
      ),
    catch: failed,
  });
}

function removeOldKey(path: string, link: string): Effect.Effect<boolean, AgentApiKeyFailed> {
  return Effect.tryPromise({
    try: async () => {
      const entry = await lstat(path).catch((error: unknown) =>
        isMissingFileError(error) ? null : Promise.reject(error),
      );
      return entry !== null && !(entry.isSymbolicLink() && (await readlink(path)) === link);
    },
    catch: failed,
  }).pipe(Effect.flatMap((old) => (old ? removeFile(path) : Effect.succeed(false))));
}

function ownKeyLinkTarget(agentId: string, name: string): string {
  return join("..", VAULT_FOLDER, agentId, name);
}

type LinkFile = (target: string, path: string) => Promise<void>;

function replaceWithLink(link: LinkFile, path: string, target: string): Effect.Effect<boolean> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  return Effect.tryPromise({
    try: async () => {
      await link(target, temporary);
      await rename(temporary, path);
      return true;
    },
    catch: failed,
  }).pipe(
    Effect.catch(() =>
      Effect.promise(() => rm(temporary, { force: true }).catch(() => undefined)).pipe(Effect.as(false)),
    ),
  );
}

function writeIfChanged(path: string, value: string): Effect.Effect<void, AgentApiKeyFailed> {
  return Effect.promise(() => readFile(path, "utf8").catch(() => null)).pipe(
    Effect.flatMap((saved) =>
      saved === value
        ? Effect.void
        : writeFileAtomically(path, value, { createDirectory: true }).pipe(Effect.mapError(failed)),
    ),
  );
}

function isStoppedWrite(name: string): boolean {
  const match = /^(.+)\.[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.tmp$/u.exec(name);
  return match?.[1] !== undefined && (match[1] === WRITTEN_KEYS_FILE || API_KEY_NAME_PATTERN.test(match[1]));
}

async function folderFiles(folder: string): Promise<string[]> {
  try {
    return (await readdir(folder, { withFileTypes: true })).filter((entry) => entry.isFile()).map(({ name }) => name);
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
}

async function folderNames(folder: string): Promise<string[]> {
  try {
    return (await readdir(folder, { withFileTypes: true })).filter((entry) => !entry.isFile()).map(({ name }) => name);
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
}
