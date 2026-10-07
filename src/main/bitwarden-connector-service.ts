import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import type { BitwardenConnectorStatus } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Effect, Exit, Schema, Semaphore } from "effect";
import { type PasswordVault, PasswordVaultError, type VaultLogin } from "../backend/password-vault";

const IDLE_MS = 8 * 60 * 60 * 1000;
const foldersSchema = Schema.Array(Schema.Struct({ id: Schema.NullOr(Schema.String), name: Schema.String }));
const itemSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.Number,
  folderId: Schema.NullOr(Schema.String),
  reprompt: Schema.optionalKey(Schema.Number),
  deletedDate: Schema.optionalKey(Schema.NullOr(Schema.String)),
  login: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        username: Schema.optionalKey(Schema.NullOr(Schema.String)),
        password: Schema.optionalKey(Schema.NullOr(Schema.String)),
        totp: Schema.optionalKey(Schema.NullOr(Schema.String)),
        uris: Schema.optionalKey(
          Schema.NullOr(
            Schema.Array(
              Schema.Struct({
                uri: Schema.NullOr(Schema.String),
                match: Schema.optionalKey(Schema.NullOr(Schema.Number)),
              }),
            ),
          ),
        ),
      }),
    ),
  ),
});
type Item = typeof itemSchema.Type;
interface Session {
  executable: string;
  key: string;
  folderId: string;
  abort: AbortController;
}
export type BitwardenCliRunner = (
  executable: string,
  args: string[],
  key: string,
  signal: AbortSignal,
) => Promise<string>;

function failure(): PasswordVaultError {
  return new PasswordVaultError({ cause: new Error(sourceText("error.connector.bitwardenFailed")) });
}

/** No shell, inherited credentials, or command output in an error. */
export const runBitwardenCli: BitwardenCliRunner = (executable, args, key, signal) => {
  const env: NodeJS.ProcessEnv = { BW_SESSION: key, BITWARDENCLI_INTERACTIVE: "false" };
  for (const name of [
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "SystemRoot",
    "TEMP",
    "TMP",
    "TMPDIR",
    "PATH",
    "BITWARDENCLI_APPDATA_DIR",
  ]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      { env, signal, timeout: 30_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error) reject(new Error(sourceText("error.connector.bitwardenFailed")));
        else resolve(stdout);
      },
    );
  });
};

async function findCli(): Promise<string> {
  const name = process.platform === "win32" ? "bw.exe" : "bw";
  const directories = [...(process.env.PATH ?? "").split(delimiter), "/opt/homebrew/bin", "/usr/local/bin"];
  for (const directory of new Set(directories.filter(isAbsolute))) {
    try {
      const path = await realpath(join(directory, name));
      await access(path, constants.X_OK);
      return path;
    } catch {
      /* Try the next installation directory. */
    }
  }
  throw new Error(sourceText("error.connector.bitwardenFailed"));
}

/** Exact HTTPS origins only. Never widens Bitwarden's matching rule to a parent domain. */
function matches(item: Item, folderId: string, origin: string): boolean {
  if (
    item.type !== 1 ||
    item.folderId !== folderId ||
    (item.reprompt !== undefined && item.reprompt !== 0) ||
    item.deletedDate
  )
    return false;
  return (
    item.login?.uris?.some((entry) => {
      if (!entry.uri || (entry.match != null && entry.match !== 0 && entry.match !== 1)) return false;
      try {
        const saved = new URL(entry.uri);
        const page = new URL(origin);
        return saved.protocol === "https:" && page.protocol === "https:" && saved.origin === page.origin;
      } catch {
        return false;
      }
    }) ?? false
  );
}

/** Owns one memory-only CLI session. It reads only logins in the folder the user shared. */
export class BitwardenConnectorService implements PasswordVault {
  readonly #run: BitwardenCliRunner;
  readonly #find: () => Promise<string>;
  readonly #running = new Set<Promise<string>>();
  readonly #queue = Semaphore.makeUnsafe(1);
  readonly #listeners = new Set<(status: BitwardenConnectorStatus) => void>();
  #session: Session | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #attempt = 0;

  constructor(options: { runCli?: BitwardenCliRunner; findCli?: () => Promise<string> } = {}) {
    this.#run = options.runCli ?? runBitwardenCli;
    this.#find = options.findCli ?? findCli;
  }

  connected(): boolean {
    return Boolean(this.#session?.folderId);
  }
  status(): BitwardenConnectorStatus {
    return { connected: this.connected() };
  }
  onChanged(listener: (status: BitwardenConnectorStatus) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  readonly connect = Effect.fn("BitwardenConnector.connect")(function* (this: BitwardenConnectorService, key: string) {
    yield* this.disconnect();
    const attempt = this.#attempt;
    registerSecretValue(key);
    const executable = yield* Effect.tryPromise({ try: this.#find, catch: failure });
    const session: Session = { executable, key, folderId: "", abort: new AbortController() };
    // Keep the pending session so disconnect can cancel the CLI while connect is waiting.
    if (attempt !== this.#attempt) return this.status();
    this.#session = session;
    return yield* Effect.gen({ self: this }, function* () {
      yield* this.#call(session, ["sync"]);
      const output = yield* this.#call(session, ["list", "folders"]);
      const folders = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(foldersSchema)(JSON.parse(output)),
        catch: failure,
      });
      const shared = folders.filter((folder) => folder.name === "Shared with OpenBot");
      if (shared.length !== 1 || !shared[0]?.id) return yield* failure();
      session.folderId = shared[0].id;
      this.#touch();
      this.#emit();
      return this.status();
    }).pipe(
      Effect.onExit((exit) => (Exit.isFailure(exit) && this.#session === session ? this.disconnect() : Effect.void)),
    );
  }).bind(this);

  readonly disconnect = Effect.fn("BitwardenConnector.disconnect")(() =>
    Effect.sync(() => {
      this.#attempt++;
      this.#session?.abort.abort();
      this.#session = null;
      clearTimeout(this.#timer);
      this.#emit();
      return this.status();
    }),
  );

  /** Stops access first, then waits for the child processes to finish. */
  readonly dispose = Effect.fn("BitwardenConnector.dispose")(function* (this: BitwardenConnectorService) {
    yield* this.disconnect();
    yield* Effect.tryPromise({ try: () => Promise.allSettled([...this.#running]), catch: failure });
  }).bind(this);

  readonly loginsFor = Effect.fn("BitwardenConnector.loginsFor")(function* (
    this: BitwardenConnectorService,
    origin: string,
  ): Effect.fn.Return<VaultLogin[] | null, PasswordVaultError> {
    const session = this.#session;
    if (!session?.folderId) return null;
    yield* this.#call(session, ["sync"]);
    const output = yield* this.#call(session, ["list", "items", "--folderid", session.folderId]);
    const items = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(Schema.Array(itemSchema))(JSON.parse(output)),
      catch: failure,
    });
    return items
      .filter((item) => matches(item, session.folderId, origin))
      .map((item) => ({
        id: item.id,
        title: item.name,
        username: item.login?.username ?? null,
        hasOneTimePassword: Boolean(item.login?.totp),
      }));
  }).bind(this);

  readonly secretFor = Effect.fn("BitwardenConnector.secretFor")(function* (
    this: BitwardenConnectorService,
    id: string,
    origin: string,
    kind: "password" | "totp",
  ) {
    const session = this.#session;
    if (!session?.folderId || !/^[a-f0-9-]{36}$/iu.test(id)) return null;
    yield* this.#call(session, ["sync"]);
    const output = yield* this.#call(session, ["get", "item", id]);
    const item = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(itemSchema)(JSON.parse(output)),
      catch: failure,
    });
    if (item.id !== id || !matches(item, session.folderId, origin)) return null;
    const value =
      kind === "password"
        ? item.login?.password
        : item.login?.totp
          ? (yield* this.#call(session, ["get", "totp", id])).trim()
          : null;
    if (!value) return null;
    registerSecretValue(value, { allowShort: true });
    return value;
  }).bind(this);

  readonly #call = Effect.fn("BitwardenConnector.call")(
    function* (this: BitwardenConnectorService, session: Session, args: string[]) {
      if (this.#session !== session) return yield* failure();
      const value = yield* Effect.tryPromise({
        try: (signal) => {
          const pending = this.#run(
            session.executable,
            args,
            session.key,
            AbortSignal.any([signal, session.abort.signal]),
          );
          this.#running.add(pending);
          return pending.finally(() => this.#running.delete(pending));
        },
        catch: failure,
      });
      if (this.#session !== session) return yield* failure();
      this.#touch();
      return value;
    },
    (operation) => this.#queue.withPermit(operation),
  ).bind(this);

  #touch(): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#attempt++;
      this.#session?.abort.abort();
      this.#session = null;
      this.#emit();
    }, IDLE_MS);
    this.#timer.unref();
  }
  #emit(): void {
    for (const listener of this.#listeners) listener(this.status());
  }
}
