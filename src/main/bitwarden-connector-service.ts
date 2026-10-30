import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath, rm } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import type { BitwardenConnectorStatus, BitwardenHostConnectInput } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, registerSecretValue, toLogValue } from "@openbot/logging";
import { Effect, Exit, Schema, Scope, Semaphore } from "effect";
import { causeHelpers } from "../backend/effect-boundary";
import { type PasswordVault, PasswordVaultError, type VaultLogin } from "../backend/password-vault";
import type { BitwardenConnectorRecord, BitwardenConnectorStore } from "./bitwarden-connector-store";

const logger = createOpenBotLogger("bitwarden-connector");
const { io: vaultCall } = causeHelpers(PasswordVaultError);

const IDLE_MS = 8 * 60 * 60 * 1000;
const foldersSchema = Schema.Array(Schema.Struct({ id: Schema.NullOr(Schema.String), name: Schema.String }));
const cliStatusSchema = Schema.Struct({
  status: Schema.String,
  serverUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
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
  /** `BW_SESSION`, and for a host connection its own `BITWARDENCLI_APPDATA_DIR`. */
  env: Record<string, string>;
  folderId: string;
  abort: AbortController;
}
/** Runs `bw` with `env` added to the few variables it inherits. */
export type BitwardenCliRunner = (
  executable: string,
  args: string[],
  env: Record<string, string>,
  signal: AbortSignal,
) => Promise<string>;

/** What a connection made through `bitwarden-connector-v1` needs on this computer. */
export interface BitwardenHostOptions {
  store: BitwardenConnectorStore;
  /** The CLI data of the host connection, apart from the user's own `bw` configuration. */
  dataDirectory: string;
  /** Installs OpenBot's copy of `bw` when none is on the PATH, or null when there is no build for this computer. */
  installCli: ((signal: AbortSignal) => Effect.Effect<string, PasswordVaultError>) | null;
}

function failure(): PasswordVaultError {
  return new PasswordVaultError({ cause: new Error(sourceText("error.connector.bitwardenFailed")) });
}

/** No shell, inherited credentials, or command output in an error. */
const runBitwardenCli: BitwardenCliRunner = (executable, args, extra, signal) => {
  const env: NodeJS.ProcessEnv = { BITWARDENCLI_INTERACTIVE: "false" };
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
  Object.assign(env, extra);
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

/** An `https:` server address without a trailing slash, or null. `bw status` reports it as it was set. */
function serverAddress(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
  } catch {
    return null;
  }
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

/**
 * Owns one CLI session. It reads only logins in the folder the user shared. A session key that the
 * user pastes stays in memory only. A host connection (`bitwarden-connector-v1`) signs in with an API
 * key and unlocks with the master password, both kept in the encrypted store, so the host unlocks
 * again after a restart or an idle timeout.
 */
export class BitwardenConnectorService implements PasswordVault {
  readonly #run: BitwardenCliRunner;
  readonly #find: () => Promise<string>;
  readonly #host: BitwardenHostOptions | null;
  readonly #running = new Set<Promise<string>>();
  readonly #queue = Semaphore.makeUnsafe(1);
  /** One unlock from the stored record at a time; the others wait for its session. */
  readonly #unlocking = Semaphore.makeUnsafe(1);
  /** Owns the host sign-in that runs after `connectWithApiKey` answers. Dispose stops it. */
  readonly #scope = Scope.makeUnsafe();
  readonly #listeners = new Set<(status: BitwardenConnectorStatus) => void>();
  #session: Session | null = null;
  /** The host sign-in that runs, and the server it signs in to. */
  #connecting: { abort: AbortController; serverUrl: string } | null = null;
  /** The unlock from the stored record that runs. */
  #unlockAbort: AbortController | null = null;
  #error: string | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #attempt = 0;

  constructor(
    options: { runCli?: BitwardenCliRunner; findCli?: () => Promise<string>; host?: BitwardenHostOptions } = {},
  ) {
    this.#run = options.runCli ?? runBitwardenCli;
    this.#find = options.findCli ?? findCli;
    this.#host = options.host ?? null;
  }

  /** Reads the stored host connection. A file that cannot be read is logged and treated as no connection. */
  readonly load = Effect.fn("BitwardenConnector.load")(function* (this: BitwardenConnectorService) {
    const error = yield* this.#host ? this.#host.store.load() : Effect.succeed(null);
    if (error) logger.warn("The Bitwarden connection file could not be read.", { cause: toLogValue(error) });
    const record = this.#host?.store.read();
    if (record) registerRecord(record);
  }).bind(this);

  connected(): boolean {
    return !this.#connecting && (Boolean(this.#session?.folderId) || Boolean(this.#host?.store.read()));
  }
  status(): BitwardenConnectorStatus {
    return {
      connected: this.connected(),
      connecting: this.#connecting !== null,
      serverUrl: this.#connecting?.serverUrl ?? this.#host?.store.read()?.serverUrl ?? null,
      error: this.#error,
    };
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
    const session: Session = { executable, env: { BW_SESSION: key }, folderId: "", abort: new AbortController() };
    // Keep the pending session so disconnect can cancel the CLI while connect is waiting.
    if (attempt !== this.#attempt) return this.status();
    this.#session = session;
    return yield* this.#openFolder(session).pipe(
      Effect.map(() => this.status()),
      Effect.onExit((exit) => (Exit.isFailure(exit) && this.#session === session ? this.#dropSession() : Effect.void)),
    );
  }).bind(this);

  /**
   * Starts the host sign-in and answers `connecting` at once: a download of `bw` and the first sync
   * can take longer than a Team API request may wait. The record is stored only after the vault
   * opened and the shared folder was found.
   */
  readonly connectWithApiKey = Effect.fn("BitwardenConnector.connectWithApiKey")(function* (
    this: BitwardenConnectorService,
    input: BitwardenHostConnectInput,
  ): Effect.fn.Return<BitwardenConnectorStatus, PasswordVaultError> {
    const host = this.#host;
    if (!host) return yield* failure();
    const record: BitwardenConnectorRecord = {
      serverUrl: input.serverUrl,
      clientId: input.clientId.trim(),
      clientSecret: input.clientSecret.trim(),
      masterPassword: input.masterPassword,
      connectedAt: Date.now(),
    };
    registerRecord(record);
    const serverUrl = serverAddress(input.serverUrl);
    if (!serverUrl || !record.clientId || !record.clientSecret || !record.masterPassword) {
      this.#error = sourceText("error.connector.bitwardenHostInput");
      this.#emit();
      return this.status();
    }
    yield* this.disconnect();
    const attempt = { abort: new AbortController(), serverUrl };
    this.#connecting = attempt;
    this.#emit();
    yield* Effect.forkIn(
      Effect.gen({ self: this }, function* () {
        const session = yield* this.#unlock({ ...record, serverUrl }, attempt.abort.signal);
        const kept = yield* host.store.write(
          { ...record, serverUrl },
          () => this.#connecting === attempt && this.#session === session,
        );
        if (!kept) return yield* failure();
      }).pipe(
        Effect.catch(({ cause }) =>
          Effect.gen({ self: this }, function* () {
            if (this.#connecting !== attempt) return;
            logger.warn("Unable to connect Bitwarden with an API key", { cause: toLogValue(cause) });
            this.#error = hostError(cause);
            yield* this.#dropSession();
            // `bw login` can have worked before a later step failed: remove its signed-in data.
            yield* Effect.promise(() => Promise.allSettled([...this.#running]));
            if (this.#connecting === attempt)
              yield* vaultCall(() => rm(host.dataDirectory, { recursive: true, force: true })).pipe(Effect.ignore);
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (this.#connecting !== attempt) return;
            this.#connecting = null;
            this.#emit();
          }),
        ),
      ),
      this.#scope,
    );
    return this.status();
  }).bind(this);

  /** Stops access, forgets a stored host connection, and removes the host's CLI data. */
  readonly disconnect = Effect.fn("BitwardenConnector.disconnect")(function* (this: BitwardenConnectorService) {
    yield* this.#stop();
    this.#error = null;
    // A stopped `bw` can still write its data file; remove the folder after it exits.
    yield* Effect.promise(() => Promise.allSettled([...this.#running]));
    const host = this.#host;
    if (host) {
      yield* host.store.clear();
      yield* vaultCall(() => rm(host.dataDirectory, { recursive: true, force: true }));
    }
    this.#emit();
    return this.status();
  }).bind(this);

  /** Stops access and the host sign-in, then waits for the child processes to finish. The stored connection stays. */
  readonly dispose = Effect.fn("BitwardenConnector.dispose")(function* (this: BitwardenConnectorService) {
    yield* this.#stop();
    yield* Scope.close(this.#scope, Exit.void);
    yield* Effect.tryPromise({ try: () => Promise.allSettled([...this.#running]), catch: failure });
  }).bind(this);

  readonly loginsFor = Effect.fn("BitwardenConnector.loginsFor")(function* (
    this: BitwardenConnectorService,
    origin: string,
  ): Effect.fn.Return<VaultLogin[] | null, PasswordVaultError> {
    const session = yield* this.#ready();
    if (!session) return null;
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
    if (!/^[a-f0-9-]{36}$/iu.test(id)) return null;
    const session = yield* this.#ready();
    if (!session) return null;
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

  /** The open session, or a new one from the stored host connection, or null when there is neither. */
  readonly #ready = Effect.fn("BitwardenConnector.ready")(function* (
    this: BitwardenConnectorService,
  ): Effect.fn.Return<Session | null, PasswordVaultError> {
    if (this.#session?.folderId) return this.#session;
    if (this.#connecting || !this.#host?.store.read()) return null;
    return yield* this.#unlocking.withPermit(
      Effect.gen({ self: this }, function* () {
        if (this.#session?.folderId) return this.#session;
        const record = this.#host?.store.read();
        if (this.#connecting || !record) return null;
        // `#stop` aborts it, so a stopped unlock neither reports an error nor touches a newer session.
        const abort = new AbortController();
        this.#unlockAbort = abort;
        return yield* this.#unlock(record, abort.signal).pipe(
          Effect.tapError(({ cause }) =>
            Effect.sync(() => {
              if (abort.signal.aborted) return;
              logger.warn("Unable to unlock Bitwarden with the stored connection", { cause: toLogValue(cause) });
              this.#error = hostError(cause);
              this.#emit();
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              if (this.#unlockAbort === abort) this.#unlockAbort = null;
            }),
          ),
        );
      }),
    );
  }).bind(this);

  /**
   * Signs in to `record.serverUrl` when the host's CLI data is signed out or names another server,
   * unlocks, and opens the shared folder. The API key and the master password go to `bw` only in its
   * environment, never in its arguments.
   */
  readonly #unlock = Effect.fn("BitwardenConnector.unlock")(function* (
    this: BitwardenConnectorService,
    record: BitwardenConnectorRecord,
    signal: AbortSignal,
  ): Effect.fn.Return<Session, PasswordVaultError> {
    const host = this.#host;
    if (!host) return yield* failure();
    const attempt = this.#attempt;
    const executable = yield* Effect.tryPromise({ try: this.#find, catch: failure }).pipe(
      Effect.catch((error) => (host.installCli ? host.installCli(signal) : Effect.fail(error))),
    );
    if (attempt !== this.#attempt || signal.aborted) return yield* failure();
    const abort = new AbortController();
    signal.addEventListener("abort", () => abort.abort(), { once: true });
    const env = { BITWARDENCLI_APPDATA_DIR: host.dataDirectory };
    const session: Session = { executable, env, folderId: "", abort };
    this.#session = session;
    return yield* Effect.gen({ self: this }, function* () {
      const output = yield* this.#call(session, ["status"]);
      const cli = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(cliStatusSchema)(JSON.parse(output)),
        catch: failure,
      });
      if (cli.status === "unauthenticated" || cli.serverUrl !== record.serverUrl) {
        if (cli.status !== "unauthenticated") yield* this.#call(session, ["logout"]);
        yield* this.#call(session, ["config", "server", record.serverUrl]);
        yield* this.#call(session, ["login", "--apikey"], {
          BW_CLIENTID: record.clientId,
          BW_CLIENTSECRET: record.clientSecret,
        });
      }
      const key = (yield* this.#call(session, ["unlock", "--passwordenv", "BW_PASSWORD", "--raw"], {
        BW_PASSWORD: record.masterPassword,
      })).trim();
      if (!key) return yield* failure();
      registerSecretValue(key);
      session.env = { ...env, BW_SESSION: key };
      yield* this.#openFolder(session);
      return session;
    }).pipe(
      Effect.onExit((exit) => (Exit.isFailure(exit) && this.#session === session ? this.#dropSession() : Effect.void)),
    );
  }).bind(this);

  /** Syncs and finds the one folder named "Shared with OpenBot". */
  readonly #openFolder = Effect.fn("BitwardenConnector.openFolder")(function* (
    this: BitwardenConnectorService,
    session: Session,
  ) {
    yield* this.#call(session, ["sync"]);
    const output = yield* this.#call(session, ["list", "folders"]);
    const folders = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(foldersSchema)(JSON.parse(output)),
      catch: failure,
    });
    const shared = folders.filter((folder) => folder.name === "Shared with OpenBot");
    if (shared.length !== 1 || !shared[0]?.id) return yield* failure();
    session.folderId = shared[0].id;
    this.#error = null;
    this.#touch();
    this.#emit();
  }).bind(this);

  /** Ends the session and the host sign-in in memory. The stored connection stays. */
  #stop(): Effect.Effect<void> {
    return Effect.suspend(() => {
      this.#connecting?.abort.abort();
      this.#connecting = null;
      this.#unlockAbort?.abort();
      this.#unlockAbort = null;
      return this.#dropSession();
    });
  }
  /** Ends the session and stops its CLI calls. A sign-in that runs keeps its state. */
  #dropSession(): Effect.Effect<void> {
    return Effect.sync(() => {
      this.#attempt++;
      this.#session?.abort.abort();
      this.#session = null;
      clearTimeout(this.#timer);
      this.#emit();
    });
  }

  readonly #call = Effect.fn("BitwardenConnector.call")(
    function* (
      this: BitwardenConnectorService,
      session: Session,
      args: string[],
      secrets: Record<string, string> = {},
    ) {
      if (this.#session !== session) return yield* failure();
      const value = yield* Effect.tryPromise({
        try: (signal) => {
          const pending = this.#run(
            session.executable,
            args,
            { ...session.env, ...secrets },
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

  /** After 8 hours with no vault use the session ends. A stored host connection unlocks again on the next use. */
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

function registerRecord(record: BitwardenConnectorRecord): void {
  registerSecretValue(record.clientId);
  registerSecretValue(record.clientSecret);
  registerSecretValue(record.masterPassword, { allowShort: true });
}

/** The install failure names itself; every other host failure gets one sentence about the inputs. */
function hostError(cause: unknown): string {
  const install = sourceText("error.connector.bitwardenCliInstallFailed");
  return cause instanceof Error && cause.message === install
    ? install
    : sourceText("error.connector.bitwardenHostFailed");
}
