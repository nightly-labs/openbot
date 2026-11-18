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

// The names of the key files that OpenBot wrote in a Vault key folder, one on each line. It starts with
// a dot, so it is never a key name and never an agent id.
const WRITTEN_KEYS_FILE = ".openbot-keys";

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
 * removal. The Vault registers its values for redaction itself. Each folder records the key names that
 * OpenBot wrote there, and only those files are removed (#10077).
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
 * When the system refuses the link, as Windows does without Developer Mode, a copy of the agent's Vault
 * key stays at the path instead, and the record of the agent folder names it (#10240). A copy is never
 * read as a plain key; each sync writes it again from the Vault, and removes it with the key or the Vault.
 */
export class AgentApiKeys {
  readonly #root: string;
  readonly #vault: AgentApiKeyVault | null;
  readonly #link: LinkFile;
  readonly #files = Semaphore.makeUnsafe(1);

  /** `link` makes a symbolic link; the E2E test refuses it, as Windows does without Developer Mode. */
  constructor(root: string, vault: AgentApiKeyVault | null = null, link: LinkFile = symlink) {
    this.#root = root;
    this.#vault = vault;
    this.#link = link;
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
    const folder = join(this.#root, agent.id);
    if (!vault) {
      yield* this.#files.withPermit(
        Effect.gen(function* () {
          // The new key is a plain file: a Vault copy of this name must not hide it or remove it.
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
    // A plain file of this name from before would win over the new key. `list` writes the new key to the
    // copy where the system refused the link.
    yield* this.#files.withPermit(this.#removeOldKey(agent.id, name));
    const keys = yield* this.list(agent.id);
    const saved = keys.find((key) => key.name === name && key.source === undefined);
    return saved ?? (yield* failed());
  });

  /**
   * True when the agent has a key of this name for it only. Unlike `list`, it writes no file, so it is
   * safe to call for an agent that never asked for its keys.
   */
  readonly has = Effect.fn("AgentApiKeys.has")(function* (this: AgentApiKeys, agentId: string, name: string) {
    if (!AGENT_ID_PATTERN.test(agentId) || !API_KEY_NAME_PATTERN.test(name)) return false;
    if ((yield* this.#plainKeys(agentId)).some((key) => key.name === name)) return true;
    return (this.#readyVault()?.apiKeys(agentId) ?? []).some((key) => key.own && key.name === name);
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
      // A file that the system refuses to replace with a link stays as the copy of the Vault key.
      const copies: string[] = [];
      for (const key of moved) {
        const linked = yield* replaceWithLink(this.#link, key.path, ownKeyLinkTarget(agentId, key.name));
        if (!linked) copies.push(key.name);
      }
      if (copies.length === 0) return;
      // Without the record, the file stays a plain key, and the next sync moves it again.
      const folder = join(this.#root, agentId);
      yield* readWrittenKeys(folder).pipe(
        Effect.flatMap((record) => writeKeyRecord(folder, record, [...record, ...copies])),
        Effect.ignore,
      );
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
   * links stay. Where the system refuses a link, a recorded copy of the key takes its place. A copy goes
   * with its key, and without a Vault. Nothing changes without the folder.
   */
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
      // The names that the record keeps. A copy goes before its name leaves the record, so a copy is never
      // read as a plain key: a copy that cannot be removed now keeps its name, and the next sync removes it.
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
        // The temporary link of a replace, or the temporary file of a copy, that stopped before its rename.
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
      // The record first: after a stop, the next sync writes a recorded copy that is missing.
      yield* writeKeyRecord(folder, copies, kept);
      for (const [name, value] of own)
        if (kept.has(name)) yield* writeIfChanged(join(folder, name), value).pipe(Effect.ignore);
    }).pipe(Effect.ignore);
  }

  /**
   * Removes the key file of 0.69 and earlier, but not the link to the agent's Vault copy and not a copy
   * where the system refused the link: `#linkOwnKeys` keeps or removes those after the Vault changes.
   * False when nothing was removed.
   */
  #removeOldKey(agentId: string, name: string): Effect.Effect<boolean, AgentApiKeyFailed> {
    const folder = join(this.#root, agentId);
    return readWrittenKeys(folder).pipe(
      Effect.flatMap((copies) =>
        copies.has(name) ? Effect.succeed(false) : removeOldKey(join(folder, name), ownKeyLinkTarget(agentId, name)),
      ),
    );
  }

  /**
   * The plain files of this agent: keys saved without a Vault, or not moved into it yet. The copies of
   * Vault keys at the old path are not plain keys.
   */
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
 * Removes each key file in `folder` that OpenBot wrote and that `keys` does not keep, and the temporary
 * file of a stopped write: no write runs now. Then records the names of `keys`, which the caller writes
 * next. Every other file stays, also a file with a key name that an agent put there by hand (#10077).
 * A folder from before the record has none, so the first sync removes no key file there: earlier
 * versions removed the file of a stale key at each Vault change and start.
 */
function removeKeyFiles(folder: string, keys: ReadonlyMap<string, string>): Effect.Effect<void, AgentApiKeyFailed> {
  return Effect.gen(function* () {
    const names = yield* Effect.tryPromise({ try: () => folderFiles(folder), catch: failed });
    const written = yield* readWrittenKeys(folder);
    for (const name of names) {
      const stale = API_KEY_NAME_PATTERN.test(name) ? written.has(name) && !keys.has(name) : isStoppedWrite(name);
      if (stale) yield* removeFile(join(folder, name));
    }
    // After the removals: when one fails, the old record stays, and the next sync removes the file.
    yield* writeKeyRecord(folder, written, keys.keys());
  });
}

/** Writes the record of `folder` with `names` when they are not the names that it has (`written`). */
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

/** The names in the record of `folder`; none when there is no record. */
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

/** Makes a symbolic link at `path` to `target`, as `symlink` of `node:fs/promises` does. */
type LinkFile = (target: string, path: string) => Promise<void>;

/**
 * Replaces a key file that the Vault keeps with a link to the agent's Vault copy. One rename does it, so
 * a script never finds the path missing. When the system refuses the link, the file stays: false.
 */
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

/** The temporary file that `writeFileAtomically` makes for a key or the record: `<NAME>.<uuid>.tmp`. */
function isStoppedWrite(name: string): boolean {
  const match = /^(.+)\.[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.tmp$/u.exec(name);
  return match?.[1] !== undefined && (match[1] === WRITTEN_KEYS_FILE || API_KEY_NAME_PATTERN.test(match[1]));
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
