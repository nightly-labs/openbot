import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { API_KEY_NAME_PATTERN } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Effect, Schema, Semaphore } from "effect";
import { writeFileAtomically } from "./atomic-json-file";
import { isMissingFileError } from "./file-errors";

// Agent ids are `agent-<uuid>` or an older short form; anything else must not name a folder.
const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

// Not an agent id, so `registerSaved` and the agent folders never read it.
const VAULT_FOLDER = ".vault";

export interface SavedApiKey {
  name: string;
  path: string;
  /** Present for a key from the Vault, which every agent can read and only the user changes. */
  source?: "vault";
}

/** The API keys saved in the Vault. None while the Vault cannot be read. */
export type VaultApiKeySource = () => readonly { name: string; value: string }[];

/** The cause stays private: it can hold a path. The message is what the user and the agent read. */
export class AgentApiKeyFailed extends Schema.TaggedError<AgentApiKeyFailed>()("AgentApiKeyFailed", {
  cause: Schema.Defect(),
}) {}

const failed = () => new AgentApiKeyFailed({ cause: new Error(sourceText("error.backend.apiKeySaveFailed")) });

/**
 * The API keys that the user entered for an agent through `request_api_key`. Each key is one file,
 * `<root>/<agentId>/<NAME>`, readable only by the user, outside every workspace. The agent gets the
 * path and reads the file in its own commands, so the value never travels in a tool argument or a
 * tool result. Each value is registered for redaction when it is saved and when OpenBot starts.
 *
 * The Vault's API keys are for every agent. The Vault keeps them encrypted; `list` writes each one to
 * `<root>/.vault/<NAME>` only when an agent asks for its keys, and `syncVault` rewrites or removes those
 * files when the Vault changes. Both run one at a time and read the Vault inside their turn, so a key
 * that the user deleted is never written again after its removal. The Vault registers its values for
 * redaction itself.
 */
export class AgentApiKeys {
  readonly #root: string;
  readonly #vaultKeys: VaultApiKeySource;
  readonly #vaultFiles = Semaphore.makeUnsafe(1);

  constructor(root: string, vaultKeys: VaultApiKeySource = () => []) {
    this.#root = root;
    this.#vaultKeys = vaultKeys;
  }

  readonly save = Effect.fn("AgentApiKeys.save")(function* (
    this: AgentApiKeys,
    agentId: string,
    name: string,
    value: string,
  ) {
    const path = yield* this.#keyPath(agentId, name);
    registerSecretValue(value);
    yield* writeFileAtomically(path, value, { createDirectory: true }).pipe(Effect.mapError(failed));
    return { name, path } satisfies SavedApiKey;
  });

  /** The agent's own keys, then the Vault's keys. The agent's own key wins over a Vault key of its name. */
  readonly list = Effect.fn("AgentApiKeys.list")(function* (this: AgentApiKeys, agentId: string) {
    const own = yield* this.#ownKeys(agentId);
    const vault = yield* this.#vaultFiles.withPermit(
      Effect.gen({ self: this }, function* () {
        const written: SavedApiKey[] = [];
        for (const { name, value } of this.#vaultKeys()) {
          if (!API_KEY_NAME_PATTERN.test(name) || own.some((key) => key.name === name)) continue;
          const path = join(this.#root, VAULT_FOLDER, name);
          yield* writeIfChanged(path, value);
          written.push({ name, path, source: "vault" });
        }
        return written;
      }),
    );
    return [...own, ...vault.sort((a, b) => a.name.localeCompare(b.name))];
  });

  /**
   * Brings the Vault key files that `list` wrote in line with the Vault: a changed key is written
   * again, and a key that is gone, or a Vault that cannot be read, removes its file.
   */
  readonly syncVault = Effect.fn("AgentApiKeys.syncVault")(function* (this: AgentApiKeys) {
    yield* this.#vaultFiles.withPermit(
      Effect.gen({ self: this }, function* () {
        const folder = join(this.#root, VAULT_FOLDER);
        const names = yield* Effect.tryPromise({ try: () => folderNames(folder), catch: failed });
        const keys = new Map(this.#vaultKeys().map(({ name, value }) => [name, value]));
        for (const name of names) {
          // Another name is a temporary file that a stopped write left: no write runs now.
          const value = API_KEY_NAME_PATTERN.test(name) ? keys.get(name) : undefined;
          const path = join(folder, name);
          if (value === undefined)
            yield* Effect.tryPromise({ try: () => rm(path, { force: true, recursive: true }), catch: failed });
          else yield* writeIfChanged(path, value);
        }
      }),
    );
  });

  /** False when the agent has no key with that name. */
  readonly remove = Effect.fn("AgentApiKeys.remove")(function* (this: AgentApiKeys, agentId: string, name: string) {
    const path = yield* this.#keyPath(agentId, name);
    return yield* Effect.tryPromise({
      try: () =>
        rm(path).then(
          () => true,
          (error: unknown) => (isMissingFileError(error) ? false : Promise.reject(error)),
        ),
      catch: failed,
    });
  });

  /** Removes every key of a deleted agent. */
  readonly removeAgent = Effect.fn("AgentApiKeys.removeAgent")(function* (this: AgentApiKeys, agentId: string) {
    const folder = yield* this.#agentFolder(agentId);
    yield* Effect.tryPromise({ try: () => rm(folder, { recursive: true, force: true }), catch: failed });
  });

  /** Registers every saved value for redaction. A file that cannot be read is skipped. */
  readonly registerSaved = Effect.fn("AgentApiKeys.registerSaved")(function* (this: AgentApiKeys) {
    const agents = yield* Effect.promise(() => folderNames(this.#root).catch((): string[] => []));
    for (const agentId of agents.filter((id) => AGENT_ID_PATTERN.test(id))) {
      const keys = yield* this.#ownKeys(agentId).pipe(Effect.catch(() => Effect.succeed<SavedApiKey[]>([])));
      for (const key of keys) {
        const value = yield* Effect.promise(() => readFile(key.path, "utf8").catch(() => ""));
        registerSecretValue(value);
      }
    }
  });

  /** The keys that the user saved for this agent with `request_api_key`. */
  #ownKeys(agentId: string): Effect.Effect<SavedApiKey[], AgentApiKeyFailed> {
    return this.#agentFolder(agentId).pipe(
      Effect.flatMap((folder) =>
        Effect.tryPromise({ try: () => folderNames(folder), catch: failed }).pipe(
          Effect.map((names) =>
            names
              .filter((name) => API_KEY_NAME_PATTERN.test(name))
              .sort()
              .map((name): SavedApiKey => ({ name, path: join(folder, name) })),
          ),
        ),
      ),
    );
  }

  #agentFolder(agentId: string): Effect.Effect<string, AgentApiKeyFailed> {
    return AGENT_ID_PATTERN.test(agentId) ? Effect.succeed(join(this.#root, agentId)) : Effect.fail(failed());
  }

  #keyPath(agentId: string, name: string): Effect.Effect<string, AgentApiKeyFailed> {
    if (!API_KEY_NAME_PATTERN.test(name)) return Effect.fail(failed());
    return this.#agentFolder(agentId).pipe(Effect.map((folder) => join(folder, name)));
  }
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

/** The names in a folder; none when the folder is missing. */
async function folderNames(folder: string): Promise<string[]> {
  try {
    return await readdir(folder);
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
}
