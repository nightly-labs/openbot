import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath, rm } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import type { BitwardenConnectorStatus, BitwardenHostConnectInput } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, registerSecretValue, toLogValue } from "@openbot/logging";
import { Effect, Exit, Schema, Scope, Semaphore } from "effect";
import { cliPathEnvironment, cliSpawnTarget, loginSearchPath, windowsRegistryPathFolders } from "../backend/cli";
import { causeHelpers } from "../backend/effect-boundary";
import {
  type PasswordVault,
  PasswordVaultError,
  type VaultLogin,
  websiteMatchesOrigin,
  websiteUrl,
} from "../backend/password-vault";
import { stopWindowsProcessTree } from "../backend/windows-process-tree";
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
  env: Record<string, string>;
  folderId: string;
  abort: AbortController;
}
export type BitwardenCliRunner = (
  executable: string,
  args: string[],
  env: Record<string, string>,
  signal: AbortSignal,
) => Promise<string>;

interface BitwardenCli {
  executable: string;
  launchPath?: string;
}
export type BitwardenCliFinder = (options: {
  searchLoginShell: boolean;
}) => Effect.Effect<BitwardenCli, PasswordVaultError>;

export interface BitwardenHostOptions {
  store: BitwardenConnectorStore;
  dataDirectory: string;
  installCli: ((signal: AbortSignal) => Effect.Effect<string, PasswordVaultError>) | null;
}

function failure(): PasswordVaultError {
  return new PasswordVaultError({ cause: new Error(sourceText("error.connector.bitwardenFailed")) });
}
function stepFailure(
  key: "error.connector.bitwardenHostSignInFailed" | "error.connector.bitwardenHostUnlockFailed",
): PasswordVaultError {
  return new PasswordVaultError({ cause: new Error(sourceText(key)) });
}
function cliMissing(): PasswordVaultError {
  return new PasswordVaultError({ cause: new Error(sourceText("error.connector.bitwardenCliMissing")) });
}

export class BitwardenKeyIdBackfillError extends Error {}

const CLI_TIMEOUT_MS = 30_000;

const runBitwardenCli: BitwardenCliRunner = (executable, args, extra, signal) => {
  const env: NodeJS.ProcessEnv = { BITWARDENCLI_INTERACTIVE: "false" };
  for (const name of [
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "SystemRoot",
    "ComSpec",
    "PATHEXT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "PATH",
    "BITWARDENCLI_APPDATA_DIR",
  ]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  Object.assign(env, extra);
  const target = cliSpawnTarget(executable, args);
  const wrapper = target.windowsVerbatimArguments;
  return new Promise((resolve, reject) => {
    const child = execFile(
      target.command,
      target.args,
      {
        env,
        ...(wrapper ? {} : { signal, timeout: CLI_TIMEOUT_MS }),
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        windowsVerbatimArguments: wrapper,
      },
      (error, stdout, stderr) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", stop);
        if (!error) resolve(stdout);
        else if (stderr.includes("KeyIdBackfillError"))
          reject(new BitwardenKeyIdBackfillError(sourceText("error.connector.bitwardenFailed")));
        else reject(new Error(sourceText("error.connector.bitwardenFailed")));
      },
    );
    const stop = () => Effect.runFork(stopWindowsProcessTree(child).pipe(Effect.ignore));
    const timer = wrapper ? setTimeout(stop, CLI_TIMEOUT_MS).unref() : undefined;
    if (!wrapper) return;
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });
};

async function firstCli(
  names: string[],
  directories: string[],
  resolve: (path: string) => Promise<string> = realpath,
): Promise<string | null> {
  for (const directory of new Set(directories.filter(isAbsolute))) {
    for (const name of names) {
      try {
        const path = await resolve(join(directory, name));
        await access(path, constants.X_OK);
        return path;
      } catch {}
    }
  }
  return null;
}

function wingetLinkFolders(): string[] {
  const { LOCALAPPDATA, ProgramFiles } = process.env;
  return [
    ...(LOCALAPPDATA ? [join(LOCALAPPDATA, "Microsoft", "WinGet", "Links")] : []),
    ...(ProgramFiles ? [join(ProgramFiles, "WinGet", "Links")] : []),
  ];
}

const findCli: BitwardenCliFinder = Effect.fn("BitwardenConnector.findCli")(function* ({ searchLoginShell }) {
  const names = process.platform === "win32" ? ["bw.exe", "bw.cmd"] : ["bw"];
  const directories = [...(process.env.PATH ?? "").split(delimiter), "/opt/homebrew/bin", "/usr/local/bin"];
  const found = yield* Effect.promise(() => firstCli(names, directories));
  if (found) return { executable: found };
  if (process.platform === "win32") {
    const folders = [...(yield* windowsRegistryPathFolders()), ...wingetLinkFolders()];
    const registered = yield* Effect.promise(() => firstCli(names, folders));
    if (registered) return { executable: registered };
  } else if (searchLoginShell) {
    const folders = (yield* loginSearchPath()).filter(isAbsolute);
    const fromLoginShell = yield* Effect.promise(() => firstCli(names, folders, async (path) => path));
    if (fromLoginShell) return { executable: fromLoginShell, launchPath: folders.join(delimiter) };
  }
  return yield* cliMissing();
});

function serverAddress(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
  } catch {
    return null;
  }
}

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
      if (websiteUrl(entry.uri)?.protocol !== "https:") return false;
      return websiteMatchesOrigin({ url: entry.uri, autofill: entry.match === 1 ? "exact" : "anywhere" }, origin);
    }) ?? false
  );
}

export class BitwardenConnectorService implements PasswordVault {
  readonly #run: BitwardenCliRunner;
  readonly #find: BitwardenCliFinder;
  readonly #host: BitwardenHostOptions | null;
  readonly #running = new Set<Promise<string>>();
  readonly #queue = Semaphore.makeUnsafe(1);
  readonly #unlocking = Semaphore.makeUnsafe(1);
  readonly #scope = Scope.makeUnsafe();
  readonly #listeners = new Set<(status: BitwardenConnectorStatus) => void>();
  #session: Session | null = null;
  #connecting: { abort: AbortController; serverUrl: string } | null = null;
  #unlockAbort: AbortController | null = null;
  #error: string | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #attempt = 0;

  constructor(
    options: { runCli?: BitwardenCliRunner; findCli?: BitwardenCliFinder; host?: BitwardenHostOptions } = {},
  ) {
    this.#run = options.runCli ?? runBitwardenCli;
    this.#find = options.findCli ?? findCli;
    this.#host = options.host ?? null;
  }

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
    const cli = yield* this.#find({ searchLoginShell: true });
    const session: Session = {
      executable: cli.executable,
      env: { ...cliPathEnvironment(cli), BW_SESSION: key },
      folderId: "",
      abort: new AbortController(),
    };
    if (attempt !== this.#attempt) return this.status();
    this.#session = session;
    return yield* this.#openFolder(session).pipe(
      Effect.map(() => this.status()),
      Effect.onExit((exit) => (Exit.isFailure(exit) && this.#session === session ? this.#dropSession() : Effect.void)),
    );
  }).bind(this);

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

  readonly disconnect = Effect.fn("BitwardenConnector.disconnect")(function* (this: BitwardenConnectorService) {
    yield* this.#stop();
    this.#error = null;
    yield* Effect.promise(() => Promise.allSettled([...this.#running]));
    const host = this.#host;
    if (host) {
      yield* host.store.clear();
      yield* vaultCall(() => rm(host.dataDirectory, { recursive: true, force: true }));
    }
    this.#emit();
    return this.status();
  }).bind(this);

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
    const items = yield* this.#reported(
      session,
      Effect.gen({ self: this }, function* () {
        yield* this.#call(session, ["sync"]);
        const output = yield* this.#call(session, ["list", "items", "--folderid", session.folderId]);
        return yield* Effect.try({
          try: () => Schema.decodeUnknownSync(Schema.Array(itemSchema))(JSON.parse(output)),
          catch: failure,
        });
      }),
    );
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
    const value = yield* this.#reported(
      session,
      Effect.gen({ self: this }, function* () {
        yield* this.#call(session, ["sync"]);
        const output = yield* this.#call(session, ["get", "item", id]);
        const item = yield* Effect.try({
          try: () => Schema.decodeUnknownSync(itemSchema)(JSON.parse(output)),
          catch: failure,
        });
        if (item.id !== id || !matches(item, session.folderId, origin)) return null;
        if (kind === "password") return item.login?.password ?? null;
        return item.login?.totp ? (yield* this.#call(session, ["get", "totp", id])).trim() : null;
      }),
    );
    if (!value) return null;
    registerSecretValue(value, { allowShort: true });
    return value;
  }).bind(this);

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

  readonly #unlock = Effect.fn("BitwardenConnector.unlock")(function* (
    this: BitwardenConnectorService,
    record: BitwardenConnectorRecord,
    signal: AbortSignal,
  ): Effect.fn.Return<Session, PasswordVaultError> {
    const host = this.#host;
    if (!host) return yield* failure();
    const attempt = this.#attempt;
    const executable = yield* this.#find({ searchLoginShell: false }).pipe(
      Effect.map((cli) => cli.executable),
      Effect.catch(() => (host.installCli ? host.installCli(signal) : Effect.fail(failure()))),
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
        }).pipe(Effect.mapError(() => stepFailure("error.connector.bitwardenHostSignInFailed")));
      }
      const unlock = this.#call(session, ["unlock", "--passwordenv", "BW_PASSWORD", "--raw"], {
        BW_PASSWORD: record.masterPassword,
      });
      const key = (yield* unlock.pipe(
        Effect.catchIf(
          ({ cause }) => cause instanceof BitwardenKeyIdBackfillError,
          () => {
            logger.info("The Bitwarden CLI failed its user key id backfill. Unlocking again.");
            return unlock;
          },
        ),
        Effect.mapError(() => stepFailure("error.connector.bitwardenHostUnlockFailed")),
      )).trim();
      if (!key) return yield* stepFailure("error.connector.bitwardenHostUnlockFailed");
      registerSecretValue(key);
      session.env = { ...env, BW_SESSION: key };
      yield* this.#openFolder(session);
      return session;
    }).pipe(
      Effect.onExit((exit) => (Exit.isFailure(exit) && this.#session === session ? this.#dropSession() : Effect.void)),
    );
  }).bind(this);

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
    if (shared.length !== 1 || !shared[0]?.id)
      return yield* new PasswordVaultError({ cause: new Error(sourceText("error.connector.bitwardenFolderMissing")) });
    session.folderId = shared[0].id;
    this.#error = null;
    this.#touch();
    this.#emit();
  }).bind(this);

  #reported<A>(session: Session, read: Effect.Effect<A, PasswordVaultError>): Effect.Effect<A, PasswordVaultError> {
    return read.pipe(
      Effect.tapError(({ cause }) =>
        Effect.suspend(() => {
          if (this.#session !== session) return Effect.void;
          const host = Boolean(this.#host?.store.read());
          this.#error = host ? hostError(cause) : sourceText("error.connector.bitwardenFailed");
          return host ? this.#dropSession() : Effect.sync(() => this.#emit());
        }),
      ),
      Effect.tap(() =>
        Effect.sync(() => {
          if (this.#error === null || this.#session !== session) return;
          this.#error = null;
          this.#emit();
        }),
      ),
    );
  }

  #stop(): Effect.Effect<void> {
    return Effect.suspend(() => {
      this.#connecting?.abort.abort();
      this.#connecting = null;
      this.#unlockAbort?.abort();
      this.#unlockAbort = null;
      return this.#dropSession();
    });
  }
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
        catch: (error) =>
          error instanceof BitwardenKeyIdBackfillError ? new PasswordVaultError({ cause: error }) : failure(),
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

function registerRecord(record: BitwardenConnectorRecord): void {
  registerSecretValue(record.clientId);
  registerSecretValue(record.clientSecret);
  registerSecretValue(record.masterPassword, { allowShort: true });
}

function hostError(cause: unknown): string {
  const named = [
    sourceText("error.connector.bitwardenCliInstallFailed"),
    sourceText("error.connector.bitwardenHostSignInFailed"),
    sourceText("error.connector.bitwardenHostUnlockFailed"),
    sourceText("error.connector.bitwardenFolderMissing"),
  ];
  const message = cause instanceof Error ? cause.message : null;
  return named.find((text) => text === message) ?? sourceText("error.connector.bitwardenHostFailed");
}
