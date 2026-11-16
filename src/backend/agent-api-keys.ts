import { randomUUID } from "node:crypto";
import { lstat, readdir, readFile, readlink, rename, rm, symlink } from "node:fs/promises";
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
export type AgentApiKeyVault = Pick<
  VaultItems,
  "ready" | "apiKeys" | "sharedApiKeys" | "saveApiKey" | "removeAgentApiKey"
>;

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
 * Before agent scope (0.70.0), `list` wrote each Vault key to `<root>/.vault/<NAME>`, and scripts, MCP
 * servers and provider configs read that path (#8983). `list` still writes the keys for every agent
 * there, and `syncVault` keeps those files in line with the Vault. A key for chosen agents is never
 * written there.
 *
 * The scope controls which agents get a key file, not which agents can read it: every agent runs as the
 * same system user, so an agent can read the files of the other agents. The Vault text says so.
 *
 * Without a Vault (no OS encryption, or a damaged Vault file), a key for one agent is a plain file,
 * `<root>/<agentId>/<NAME>`, readable only by the user, as before the Vault had agents. When the Vault
 * can be used, each such file moves into it as a key for that agent. After the Vault keeps the key, a
 * link to the agent's Vault copy, `../.vault/<agentId>/<NAME>`, replaces the file. Scripts that read the
 * path of 0.69 and earlier then get the Vault value, and a link is never read as a plain key again.
 * 0.70.0 deleted these files with no link (#9313). While the agent folder exists, each start writes the
 * Vault copy and a link for each key for that agent only, so the path of those scripts works again.
 * Without a link (the system refuses it, as Windows can without Developer Mode), the file is deleted.
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
    // A plain file of this name from before would win over the new key. The link to the Vault copy stays.
    yield* this.#files.withPermit(removeOldKey(path, ownKeyLinkTarget(agent.id, name)));
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
        // The paths of earlier versions; they do not change what the agent gets.
        yield* this.#writeShared().pipe(Effect.ignore);
        yield* this.#linkOwnKeys(agentId);
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
        // The folder is there once an agent listed its keys, which wrote the shared files in earlier
        // versions. 0.70.0 deleted those files at start, so they come back here. First, so that a key
        // that is no longer for every agent goes even when the copy of one agent cannot be written.
        if (agents.includes(VAULT_FOLDER)) yield* this.#writeShared();
        const vaultFolder = join(this.#root, VAULT_FOLDER);
        const copies = yield* Effect.tryPromise({ try: () => folderNames(vaultFolder), catch: failed });
        // A copy that cannot be written does not stop the copies and links of the other agents.
        for (const agentId of copies.filter((id) => AGENT_ID_PATTERN.test(id)))
          yield* this.#writeAgent(join(vaultFolder, agentId), agentId).pipe(Effect.ignore);
        // The agent folders of 0.69 and earlier: the Vault copy and a link for each key for that agent
        // only, also when the agent did not list its keys after the update. The link of a key that is
        // deleted, or now for other agents too, goes.
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

  /** False when the agent has no key with that name for it only. */
  readonly remove = Effect.fn("AgentApiKeys.remove")(function* (this: AgentApiKeys, agentId: string, name: string) {
    const path = yield* this.#keyPath(agentId, name);
    const folder = yield* this.#agentFolder(agentId);
    return yield* this.#files.withPermit(
      Effect.gen({ self: this }, function* () {
        const plain = yield* removeOldKey(path, ownKeyLinkTarget(agentId, name));
        const vault = this.#readyVault();
        const own = vault ? yield* vault.removeAgentApiKey(agentId, name).pipe(Effect.mapError(failed)) : false;
        if (vault) yield* this.#writeAgent(folder, agentId);
        yield* this.#linkOwnKeys(agentId);
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
      const moved: SavedApiKey[] = [];
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
        if (saved) moved.push(key);
      }
      if (moved.length === 0) return;
      // The link replaces a file only after the copy that it points to is there. A file that cannot be
      // replaced or deleted stays. It holds the same key, and `list` gives it to the agent.
      const copied = yield* this.#writeAgent(join(this.#root, VAULT_FOLDER, agentId), agentId).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
      if (!copied) return;
      for (const key of moved)
        yield* replaceWithLink(key.path, ownKeyLinkTarget(agentId, key.name)).pipe(Effect.ignore);
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

  /**
   * Writes the Vault keys for every agent to `<root>/.vault/<NAME>`, where earlier versions wrote them,
   * and removes the files of other keys.
   */
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

  /**
   * Brings the links in the agent folder of 0.69 and earlier in line with the Vault: a link to the Vault
   * copy for each key for this agent only, and no OpenBot link for another key. Plain files and other
   * links stay. Nothing changes without the folder or a Vault. A link that cannot be made is skipped.
   */
  #linkOwnKeys(agentId: string): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const vault = this.#readyVault();
      if (!vault || !AGENT_ID_PATTERN.test(agentId)) return;
      const folder = join(this.#root, agentId);
      const own = new Set(
        vault
          .apiKeys(agentId)
          .filter((key) => key.own && API_KEY_NAME_PATTERN.test(key.name))
          .map((key) => key.name),
      );
      const entries = yield* Effect.tryPromise({ try: () => readdir(folder, { withFileTypes: true }), catch: failed });
      for (const entry of entries) {
        if (!entry.isSymbolicLink() || own.has(entry.name)) continue;
        const path = join(folder, entry.name);
        // The temporary link of a replace that stopped before its rename.
        if (isStoppedWrite(entry.name)) {
          yield* Effect.tryPromise({ try: () => rm(path), catch: failed }).pipe(Effect.ignore);
          continue;
        }
        if (!API_KEY_NAME_PATTERN.test(entry.name)) continue;
        yield* Effect.tryPromise({
          try: async () => {
            if ((await readlink(path)) === ownKeyLinkTarget(agentId, entry.name)) await rm(path);
          },
          catch: failed,
        }).pipe(Effect.ignore);
      }
      const present = new Set(entries.map((entry) => entry.name));
      for (const name of own) {
        if (present.has(name)) continue;
        yield* Effect.tryPromise({
          try: () => symlink(ownKeyLinkTarget(agentId, name), join(folder, name)),
          catch: failed,
        }).pipe(Effect.ignore);
      }
    }).pipe(Effect.ignore);
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

/**
 * Removes a key file of 0.69 and earlier, or a link that the user made in its place, but never the link
 * to the agent's Vault copy (`link`). False when nothing was removed.
 */
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

/**
 * The target of the link that replaces a key file of 0.69 and earlier: the agent's Vault copy. It is
 * relative, so it still works when the data folder moves, such as into a container.
 */
function ownKeyLinkTarget(agentId: string, name: string): string {
  return join("..", VAULT_FOLDER, agentId, name);
}

/**
 * Replaces a key file that the Vault keeps with a link to the agent's Vault copy. One rename does it, so
 * a script never finds the path missing. When the system refuses the link, the file is deleted.
 */
function replaceWithLink(path: string, target: string): Effect.Effect<boolean, AgentApiKeyFailed> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  return Effect.tryPromise({
    try: async () => {
      await symlink(target, temporary);
      await rename(temporary, path);
      return true;
    },
    catch: failed,
  }).pipe(
    Effect.catch(() =>
      Effect.promise(() => rm(temporary, { force: true }).catch(() => undefined)).pipe(
        Effect.flatMap(() => removeFile(path)),
      ),
    ),
  );
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

/** The names in a folder that are not files, such as folders and links to them; none when the folder is missing. */
async function folderNames(folder: string): Promise<string[]> {
  try {
    return (await readdir(folder, { withFileTypes: true })).filter((entry) => !entry.isFile()).map(({ name }) => name);
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
}
