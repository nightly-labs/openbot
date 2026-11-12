import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { API_KEY_NAME_PATTERN } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Effect, Result, Schema, Semaphore } from "effect";
import { writeFileAtomically } from "./atomic-json-file";
import { isMissingFileError } from "./file-errors";
import type { VaultAgent, VaultItems } from "./vault-items";

// Agent ids are `agent-<uuid>` or an older short form; anything else must not name a folder.
const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

// Not an agent id, so `registerSaved` and the move into the Vault never read it.
const VAULT_FOLDER = ".vault";

export interface SavedApiKey {
  name: string;
  path: string;
  /**
   * Present for a key from the Vault that is not for this agent only: for every agent, or for agents
   * that the user chose. The user changes it, or an agent with `save_api_key` when a person asked in the
   * OpenBot chat.
   */
  source?: "vault";
}

/** The cause stays private: it can hold a path. The message is what the user and the agent read. */
export class AgentApiKeyFailed extends Schema.TaggedError<AgentApiKeyFailed>()("AgentApiKeyFailed", {
  cause: Schema.Defect(),
}) {}

const failed = () => new AgentApiKeyFailed({ cause: new Error(sourceText("error.backend.apiKeySaveFailed")) });

/** The Vault part that `AgentApiKeys` uses. */
export type AgentApiKeyVault = Pick<VaultItems, "ready" | "apiKeys" | "saveApiKey" | "removeAgentApiKey">;

/**
 * The API keys of each agent. The agent gets the path of a file with the key and reads the file in its
 * own commands, so the value never travels in a tool argument or a tool result.
 *
 * The Vault keeps every key encrypted. A key is for every agent, or for the agents that the user chose;
 * "only this agent" in the chat form is a key for that one agent. `list` writes the keys that an agent
 * can use to `<root>/.vault/<agentId>/<NAME>` when the agent asks for them, and `syncVault` rewrites or
 * removes those files when the Vault changes. Both run one at a time and read the Vault inside their
 * turn, so a key that the user deleted, or took from the agent, is never written again after its
 * removal. The Vault registers its values for redaction itself.
 *
 * Without a Vault (no OS encryption, or a damaged Vault file), a key for one agent is a plain file,
 * `<root>/<agentId>/<NAME>`, readable only by the user, as before the Vault had agents. When the Vault
 * can be used, each such file moves into it as a key for that agent, and the file is deleted after the
 * Vault keeps it.
 */
export class AgentApiKeys {
  readonly #root: string;
  readonly #vault: AgentApiKeyVault | null;
  readonly #files = Semaphore.makeUnsafe(1);

  constructor(root: string, vault: AgentApiKeyVault | null = null) {
    this.#root = root;
    this.#vault = vault;
  }

  /** Saves a key for this agent only: in the Vault, or as a plain file without a Vault. */
  readonly save = Effect.fn("AgentApiKeys.save")(function* (
    this: AgentApiKeys,
    agent: VaultAgent,
    name: string,
    value: string,
  ) {
    const path = yield* this.#keyPath(agent.id, name);
    registerSecretValue(value);
    const vault = this.#readyVault();
    if (!vault) {
      yield* this.#files.withPermit(
        writeFileAtomically(path, value, { createDirectory: true }).pipe(Effect.mapError(failed)),
      );
      return { name, path } satisfies SavedApiKey;
    }
    yield* vault.saveApiKey({ name, key: value }, agent, true).pipe(Effect.mapError(failed));
    // A plain file of this name from before would win over the new key.
    yield* this.#files.withPermit(removeFile(path));
    const keys = yield* this.list(agent.id);
    const saved = keys.find((key) => key.name === name && key.source === undefined);
    return saved ?? (yield* failed());
  });

  /** The keys that the agent can use. A plain file of the agent wins over a Vault key of its name. */
  readonly list = Effect.fn("AgentApiKeys.list")(function* (this: AgentApiKeys, agentId: string) {
    const folder = yield* this.#agentFolder(agentId);
    return yield* this.#files.withPermit(
      Effect.gen({ self: this }, function* () {
        yield* this.#moveIntoVault(agentId);
        const own = yield* this.#plainKeys(agentId);
        const vault = yield* this.#writeAgent(folder, agentId);
        const shown = vault.filter((key) => !own.some((entry) => entry.name === key.name));
        return [...own, ...shown].sort((a, b) => a.name.localeCompare(b.name));
      }),
    );
  });

  /**
   * Moves the plain files into the Vault when it can be used, and brings the key files that `list`
   * wrote in line with the Vault: a changed key is written again, and a key that the agent can no
   * longer use, or a Vault that cannot be read, removes its file. Only files that OpenBot writes are
   * removed: an agent can put other files here, such as a key that cannot be downloaded again.
   */
  readonly syncVault = Effect.fn("AgentApiKeys.syncVault")(function* (this: AgentApiKeys) {
    yield* this.#files.withPermit(
      Effect.gen({ self: this }, function* () {
        const agents = yield* Effect.tryPromise({ try: () => folderNames(this.#root), catch: failed });
        for (const agentId of agents.filter((id) => AGENT_ID_PATTERN.test(id))) yield* this.#moveIntoVault(agentId);
        const vaultFolder = join(this.#root, VAULT_FOLDER);
        // The files of a build before agent scope, for every agent, are directly in the folder.
        yield* removeKeyFiles(vaultFolder, new Map());
        const copies = yield* Effect.tryPromise({ try: () => folderNames(vaultFolder), catch: failed });
        for (const agentId of copies.filter((id) => AGENT_ID_PATTERN.test(id)))
          yield* this.#writeAgent(join(vaultFolder, agentId), agentId);
      }),
    );
  });

  /** False when the agent has no key with that name for it only. */
  readonly remove = Effect.fn("AgentApiKeys.remove")(function* (this: AgentApiKeys, agentId: string, name: string) {
    const path = yield* this.#keyPath(agentId, name);
    const folder = yield* this.#agentFolder(agentId);
    return yield* this.#files.withPermit(
      Effect.gen({ self: this }, function* () {
        const plain = yield* removeFile(path);
        const vault = this.#readyVault();
        const own = vault ? yield* vault.removeAgentApiKey(agentId, name).pipe(Effect.mapError(failed)) : false;
        if (vault) yield* this.#writeAgent(folder, agentId);
        return plain || own;
      }),
    );
  });

  /** Removes the key files of a deleted agent. */
  readonly removeAgent = Effect.fn("AgentApiKeys.removeAgent")(function* (this: AgentApiKeys, agentId: string) {
    const folder = yield* this.#agentFolder(agentId);
    yield* this.#files.withPermit(
      Effect.forEach([join(this.#root, agentId), folder], (path) =>
        Effect.tryPromise({ try: () => rm(path, { recursive: true, force: true }), catch: failed }),
      ),
    );
  });

  /** Registers every plain file value for redaction. A file that cannot be read is skipped. */
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

  /**
   * Moves the plain files of an agent into the Vault, each as a key for this agent only. The file value
   * wins over a Vault key for this agent only. A file is deleted only after the Vault keeps its key; a
   * failed move keeps the file, which `list` gives the agent as before.
   */
  #moveIntoVault(agentId: string): Effect.Effect<void, AgentApiKeyFailed> {
    return Effect.gen({ self: this }, function* () {
      const vault = this.#readyVault();
      if (!vault) return;
      for (const key of yield* this.#plainKeys(agentId)) {
        const value = (yield* Effect.promise(() => readFile(key.path, "utf8").catch(() => null)))?.trim();
        if (!value) continue;
        // A file that could not be deleted earlier is not saved again: each save changes the Vault, and
        // the change starts this sync again.
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
        // A file that cannot be deleted stays. It holds the same key, and `list` gives it to the agent.
        if (saved) yield* removeFile(key.path).pipe(Effect.orElseSucceed(() => false));
      }
    });
  }

  /**
   * Writes the Vault keys that the agent can use to `folder` and removes the files of keys that it can
   * no longer use. Without a Vault, every key file goes.
   */
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

  /** The plain files of this agent: keys saved without a Vault, or not moved into it yet. */
  #plainKeys(agentId: string): Effect.Effect<SavedApiKey[], AgentApiKeyFailed> {
    return Effect.gen({ self: this }, function* () {
      if (!AGENT_ID_PATTERN.test(agentId)) return yield* failed();
      const folder = join(this.#root, agentId);
      const names = yield* Effect.tryPromise({ try: () => folderFiles(folder), catch: failed });
      return names
        .filter((name) => API_KEY_NAME_PATTERN.test(name))
        .sort()
        .map((name): SavedApiKey => ({ name, path: join(folder, name) }));
    });
  }

  /** The folder of the files that `list` writes from the Vault for this agent. */
  #agentFolder(agentId: string): Effect.Effect<string, AgentApiKeyFailed> {
    return AGENT_ID_PATTERN.test(agentId)
      ? Effect.succeed(join(this.#root, VAULT_FOLDER, agentId))
      : Effect.fail(failed());
  }

  /** The plain file of a key for this agent only. */
  #keyPath(agentId: string, name: string): Effect.Effect<string, AgentApiKeyFailed> {
    if (!API_KEY_NAME_PATTERN.test(name) || !AGENT_ID_PATTERN.test(agentId)) return Effect.fail(failed());
    return Effect.succeed(join(this.#root, agentId, name));
  }
}

/**
 * Removes each key file in `folder` that `keys` does not keep, and the temporary file of a stopped write:
 * no write runs now. Every other file stays.
 */
function removeKeyFiles(folder: string, keys: ReadonlyMap<string, string>): Effect.Effect<void, AgentApiKeyFailed> {
  return Effect.gen(function* () {
    const names = yield* Effect.tryPromise({ try: () => folderFiles(folder), catch: failed });
    for (const name of names) {
      const stale = API_KEY_NAME_PATTERN.test(name) ? !keys.has(name) : isStoppedWrite(name);
      if (stale) yield* removeFile(join(folder, name));
    }
  });
}

/** False when the file was not there. */
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

/** Writes a Vault key file only when it does not hold `value` yet, so a Vault change does not rewrite each key. */
function writeIfChanged(path: string, value: string): Effect.Effect<void, AgentApiKeyFailed> {
  return Effect.promise(() => readFile(path, "utf8").catch(() => null)).pipe(
    Effect.flatMap((saved) =>
      saved === value
        ? Effect.void
        : writeFileAtomically(path, value, { createDirectory: true }).pipe(Effect.mapError(failed)),
    ),
  );
}

/** The temporary file that `writeFileAtomically` makes for a key: `<NAME>.<uuid>.tmp`. */
function isStoppedWrite(name: string): boolean {
  const match = /^([^.]+)\.[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.tmp$/u.exec(name);
  return match?.[1] !== undefined && API_KEY_NAME_PATTERN.test(match[1]);
}

/** The names of the files in a folder, not of its folders; none when the folder is missing. */
async function folderFiles(folder: string): Promise<string[]> {
  try {
    return (await readdir(folder, { withFileTypes: true })).filter((entry) => entry.isFile()).map(({ name }) => name);
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
}

/** The names in a folder; none when the folder is missing. */
async function folderNames(folder: string): Promise<string[]> {
  try {
    return await readdir(folder);
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
}
