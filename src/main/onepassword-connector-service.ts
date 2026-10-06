// The 1Password connection of this computer: a service account that reads the vault the user shares
// with OpenBot. The embedded browser fills logins from it; agents see titles and usernames only.

import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import {
  DISCONNECTED_ONEPASSWORD_CONNECTOR,
  type OnePasswordAccount,
  type OnePasswordConnectInput,
  type OnePasswordConnectorStatus,
  type OnePasswordSetup,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText, registerSecretValue, toLogValue } from "@openbot/logging";
import { Deferred, Effect, Exit, Scope } from "effect";
import { z } from "zod";
import {
  type PasswordVault,
  PasswordVaultError,
  type VaultAutofill,
  type VaultLogin,
  type VaultWebsite,
  websiteMatchesOrigin,
} from "../backend/password-vault";
import { installedManagedCli, installOnePasswordCli } from "./onepassword-cli-installer";
import type { OnePasswordConnectorRecord, OnePasswordConnectorStore } from "./onepassword-connector-store";
import { OnePasswordOperationError, onePasswordCall, onePasswordDecode } from "./onepassword-effects";
import type { RuntimeTarget } from "./provider-runtime-descriptors";

const logger = createOpenBotLogger("onepassword-connector");

/** The vault that Connect creates. The user moves the logins that OpenBot may use into it. */
const ONEPASSWORD_SHARED_VAULT = "Shared with OpenBot";
/** `op service-account create` needs this version. */
const MIN_CLI_VERSION = [2, 18] as const;
/** 1Password can wait for the user to approve the CLI in the desktop app. */
const CLI_TIMEOUT_MS = 2 * 60_000;
/** A setup check reads only local state; one that takes longer counts as not ready. */
const SETUP_CHECK_TIMEOUT_MS = 15_000;
/** Where Open 1Password goes when the app is not installed. */
const ONEPASSWORD_DOWNLOAD_URL = "https://1password.com/downloads/";
/** Service accounts have hourly read limits, so the list of logins is read again only this often. */
const INDEX_MAX_AGE_MS = 5 * 60_000;
/** A page that opens reads a list older than this again, so the count follows the user's changes. */
const INDEX_REFRESH_ON_VIEW_MS = 30_000;
/** Each listed login costs one read. A page with more saved logins than this lists the first ones. */
const MAX_LISTED_LOGINS = 10;

const accountListSchema = z.array(
  z.object({ account_uuid: z.string().min(1), email: z.string().optional(), url: z.string().optional() }),
);
const vaultListSchema = z.array(z.object({ id: z.string().min(1), name: z.string() }));
const vaultSchema = z.object({ id: z.string().min(1) });

/** Runs one 1Password CLI executable and returns its standard output. */
export type OnePasswordCliRunner = (executable: string, args: string[], signal: AbortSignal) => Promise<string>;

/** The part of the 1Password SDK client this service uses, so a test can pass a fake. */
export interface OnePasswordClient {
  vaults: { list(): Promise<Array<{ id: string; title: string }>> };
  items: {
    list(
      vaultId: string,
    ): Promise<
      Array<{ id: string; title: string; category: string; websites: Array<{ url: string; autofillBehavior: string }> }>
    >;
    get(
      vaultId: string,
      itemId: string,
    ): Promise<{
      fields: Array<{ id: string; fieldType: string; value: string; details?: { type: string; content?: unknown } }>;
      websites: Array<{ url: string; autofillBehavior: string }>;
    }>;
  };
}

export interface OnePasswordConnectorServiceOptions {
  store: OnePasswordConnectorStore;
  /** Names the service account, so the user can find it on 1Password.com. */
  hostName: string;
  appVersion: string;
  /** Where Install puts the CLI, or null when OpenBot has no CLI build for this computer. */
  cliInstall: { directory: string; target: RuntimeTarget } | null;
  openExternal: (url: string) => Promise<void>;
  /** The CLI executables to try, in order. A test passes a fake. */
  findCli?: () => Effect.Effect<string[]>;
  runCli?: OnePasswordCliRunner;
  installCli?: ((signal: AbortSignal) => Effect.Effect<string, OnePasswordOperationError>) | undefined;
  createClient?: (token: string) => Promise<OnePasswordClient>;
  now?: () => number;
}

interface IndexedLogin {
  id: string;
  vaultId: string;
  title: string;
  websites: VaultWebsite[];
}

interface LoginIndex {
  readAt: number;
  vaultNames: string[];
  logins: IndexedLogin[];
}

function autofill(value: string): VaultAutofill {
  if (value === "ExactDomain") return "exact";
  if (value === "Never") return "never";
  return "anywhere";
}

function vaultWebsites(websites: ReadonlyArray<{ url: string; autofillBehavior: string }>): VaultWebsite[] {
  return websites.map((site) => ({ url: site.url, autofill: autofill(site.autofillBehavior) }));
}

/** Whether 1Password lets a login with these websites fill the page at `origin`. */
function savedFor(websites: ReadonlyArray<{ url: string; autofillBehavior: string }>, origin: string): boolean {
  return vaultWebsites(websites).some((site) => websiteMatchesOrigin(site, origin));
}

function cliVersionSupported(output: string): boolean {
  const [major = 0, minor = 0] = output.trim().split(".").map(Number);
  return major > MIN_CLI_VERSION[0] || (major === MIN_CLI_VERSION[0] && minor >= MIN_CLI_VERSION[1]);
}

function accountLabel(account: z.infer<typeof accountListSchema>[number]): string {
  if (account.email && account.url) return `${account.email} (${account.url})`;
  return account.email ?? account.url ?? account.account_uuid;
}

/** A failure whose message is already a `sourceText` sentence for the user. */
class OnePasswordConnectError extends Error {}

function connectFailure(message: string): OnePasswordOperationError {
  return new OnePasswordOperationError({ cause: new OnePasswordConnectError(message) });
}

/** Parses the JSON that the CLI writes to its standard output. */
function cliJson<T>(schema: z.ZodType<T>) {
  return (output: string) => onePasswordDecode(() => schema.parse(JSON.parse(output)));
}

/**
 * The CLIs to try, in order: the user's own, where installers put it (a Finder launch has no shell
 * `PATH`), then the copy that Install put in OpenBot's folder.
 */
const findCliExecutables = Effect.fn("OnePasswordConnector.findCli")(function* (
  install: OnePasswordConnectorServiceOptions["cliInstall"],
) {
  const name = process.platform === "win32" ? "op.exe" : "op";
  const directories = [...(process.env.PATH ?? "").split(delimiter), "/opt/homebrew/bin", "/usr/local/bin"];
  const found: string[] = [];
  for (const directory of new Set(directories.filter(Boolean))) {
    const candidate = join(directory, name);
    const executable = yield* onePasswordCall(() => access(candidate, constants.X_OK)).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    if (executable) found.push(candidate);
  }
  const managed = install ? yield* installedManagedCli(install.directory, install.target) : null;
  return managed ? [...found, managed] : found;
});

/** Variables that would make `op` act as another identity than the user's own session. */
const CLI_IDENTITY_VARIABLES = new Set(["OP_SERVICE_ACCOUNT_TOKEN", "OP_CONNECT_TOKEN", "OP_CONNECT_HOST"]);

/** Runs `op` with no shell, as the user's own CLI session. */
const runOnePasswordCli: OnePasswordCliRunner = async (executable, args, signal) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !CLI_IDENTITY_VARIABLES.has(name)));
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      { env, signal, timeout: CLI_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        if (error.name === "AbortError") {
          reject(error);
          return;
        }
        const detail = redactText(String(stderr).trim().split("\n").at(-1) || error.message);
        reject(new OnePasswordConnectError(sourceText("error.connector.onePasswordCliFailed", { detail })));
      },
    );
  });
};

async function createSdkClient(token: string, appVersion: string): Promise<OnePasswordClient> {
  const sdk = await import("@1password/sdk");
  const client = await sdk.createClient({ auth: token, integrationName: "OpenBot", integrationVersion: appVersion });
  return {
    vaults: { list: () => client.vaults.list() },
    items: {
      list: (vaultId) => client.items.list(vaultId),
      get: (vaultId, itemId) => client.items.get(vaultId, itemId),
    },
  };
}

/**
 * Owns the 1Password connection: Connect through the CLI, a pasted token, the stored token, and the
 * list of logins it reads. It never imports the agent service, which reads it as a `PasswordVault`.
 *
 * Connect uses the CLI only once, to create the vault "Shared with OpenBot" and a service account
 * that can only read it. The CLI session is the user's own; OpenBot keeps only the service account
 * token. The token never leaves the main process except to 1Password, and it is registered for
 * redaction before it is used. Passwords and codes go to the browser only.
 */
export class OnePasswordConnectorService implements PasswordVault {
  readonly #store: OnePasswordConnectorStore;
  readonly #hostName: string;
  readonly #findCli: () => Effect.Effect<string[]>;
  readonly #runCli: OnePasswordCliRunner;
  /** Null when OpenBot has no CLI build for this computer. */
  readonly #installCli: ((signal: AbortSignal) => Effect.Effect<string, OnePasswordOperationError>) | null;
  readonly #openExternal: (url: string) => Promise<void>;
  readonly #createClient: (token: string) => Promise<OnePasswordClient>;
  readonly #now: () => number;
  readonly #listeners = new Set<(status: OnePasswordConnectorStatus) => void>();
  /** Owns the login list reads that run in the background. Dispose stops them. */
  readonly #scope = Scope.makeUnsafe();
  /** The CLI that the last setup check found, or null. */
  #cliPath: string | null = null;
  #setup: OnePasswordSetup;
  #checking: Deferred.Deferred<void> | null = null;
  #installing: AbortController | null = null;
  #connecting: AbortController | null = null;
  #accounts: OnePasswordAccount[] = [];
  #error: string | null = null;
  #client: { token: string; client: Deferred.Deferred<OnePasswordClient, OnePasswordOperationError> } | null = null;
  #index: LoginIndex | null = null;
  #indexing: Deferred.Deferred<LoginIndex, OnePasswordOperationError> | null = null;
  /** Changes each time the token is replaced or removed. A read that started before does not keep its answer. */
  #generation = 0;

  constructor(options: OnePasswordConnectorServiceOptions) {
    this.#store = options.store;
    this.#hostName = options.hostName;
    const install = options.cliInstall;
    this.#findCli = options.findCli ?? (() => findCliExecutables(install));
    this.#runCli = options.runCli ?? runOnePasswordCli;
    this.#installCli =
      options.installCli ??
      (install
        ? (signal) => installOnePasswordCli({ directory: install.directory, target: install.target, signal })
        : null);
    this.#openExternal = options.openExternal;
    this.#setup = { ...DISCONNECTED_ONEPASSWORD_CONNECTOR.setup, canInstall: this.#installCli !== null };
    this.#createClient = options.createClient ?? ((token) => createSdkClient(token, options.appVersion));
    this.#now = options.now ?? Date.now;
  }

  /** Reads the stored token. A file that cannot be read is logged and treated as no connection. */
  readonly load = Effect.fn("OnePasswordConnector.load")(function* (
    this: OnePasswordConnectorService,
  ): Effect.fn.Return<void> {
    const error = yield* this.#store.load();
    if (error) logger.warn("The 1Password connection file could not be read.", { cause: toLogValue(error) });
    const record = this.#store.read();
    if (!record) return;
    registerSecretValue(record.token);
    // The vault names and the login count come from 1Password; the app does not wait for them.
    yield* this.#readIndexInBackground(INDEX_MAX_AGE_MS);
  }).bind(this);

  status(): OnePasswordConnectorStatus {
    const connected = this.#store.read() !== null && !this.#connecting;
    return {
      ...DISCONNECTED_ONEPASSWORD_CONNECTOR,
      state: this.#connecting
        ? "connecting"
        : connected
          ? "connected"
          : this.#accounts.length > 0
            ? "choose-account"
            : "disconnected",
      setup: { ...this.#setup },
      accounts: this.#connecting || connected ? [] : [...this.#accounts],
      vaultNames: connected ? [...(this.#index?.vaultNames ?? [])] : [],
      loginCount: connected ? (this.#index?.logins.length ?? null) : null,
      error: this.#error,
    };
  }

  onChanged(listener: (status: OnePasswordConnectorStatus) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Looks for a CLI that Connect can run and asks it whether the 1Password app lets it use an
   * account. Nothing here asks 1Password to unlock or approve anything. Checks that overlap share one
   * run, and a check during Install waits for the next one.
   */
  readonly checkSetup = Effect.fn("OnePasswordConnector.checkSetup")(function* (
    this: OnePasswordConnectorService,
  ): Effect.fn.Return<OnePasswordConnectorStatus> {
    if (!this.#installing) yield* this.#sharedCheck();
    // The user moves logins into the vault in the 1Password app, outside this window. A page that
    // opens or gets the focus back reads the list again; the answer arrives as a status event.
    if (this.#store.read() && !this.#connecting) yield* this.#readIndexInBackground(INDEX_REFRESH_ON_VIEW_MS);
    return this.status();
  }).bind(this);

  /** Downloads OpenBot's copy of the CLI, then checks the setup again. */
  readonly installCli = Effect.fn("OnePasswordConnector.installCli")(function* (
    this: OnePasswordConnectorService,
  ): Effect.fn.Return<OnePasswordConnectorStatus> {
    const install = this.#installCli;
    if (!install || this.#installing) return this.status();
    const controller = new AbortController();
    this.#installing = controller;
    this.#error = null;
    this.#setup = { ...this.#setup, cli: "installing" };
    this.#emitStatus();
    yield* install(controller.signal).pipe(
      Effect.catch(({ cause: error }) =>
        Effect.sync(() => {
          if (controller.signal.aborted) return;
          logger.warn("Unable to install the 1Password CLI", { cause: toLogValue(error) });
          this.#error = sourceText("error.connector.onePasswordCliInstallFailed");
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          if (this.#installing === controller) this.#installing = null;
        }),
      ),
    );
    return yield* this.checkSetup();
  }).bind(this);

  /** Opens the 1Password app, where the user turns on the CLI integration, or its download page. */
  readonly openApp = Effect.fn("OnePasswordConnector.openApp")(function* (
    this: OnePasswordConnectorService,
  ): Effect.fn.Return<void, OnePasswordOperationError> {
    yield* this.#open("onepassword://").pipe(Effect.catch(() => this.#open(ONEPASSWORD_DOWNLOAD_URL)));
  }).bind(this);

  /**
   * Creates the shared vault and a service account that reads it, with the user's CLI session. With
   * several accounts and none named, it answers `choose-account` and creates nothing.
   */
  readonly connect = Effect.fn("OnePasswordConnector.connect")(function* (
    this: OnePasswordConnectorService,
    { accountId }: OnePasswordConnectInput,
  ): Effect.fn.Return<OnePasswordConnectorStatus> {
    const controller = this.#startConnecting();
    yield* Effect.gen({ self: this }, function* () {
      const token = yield* this.#createServiceAccount(accountId, controller.signal);
      if (token !== null) yield* this.#save({ token, accountId, connectedAt: this.#now() }, controller.signal);
    }).pipe(
      Effect.catch(({ cause: error }) =>
        Effect.sync(() => {
          if (this.#connecting !== controller || controller.signal.aborted) return;
          logger.warn("Unable to connect 1Password", { cause: toLogValue(error) });
          this.#error =
            error instanceof OnePasswordConnectError
              ? error.message
              : sourceText("error.connector.onePasswordUnexpected", {
                  detail: redactText(error instanceof Error ? error.message : String(error)),
                });
        }),
      ),
      Effect.ensuring(this.#finishConnecting(controller)),
    );
    return this.status();
  }).bind(this);

  /** Connects with a service account token the user created on 1Password.com. */
  readonly connectWithToken = Effect.fn("OnePasswordConnector.connectWithToken")(function* (
    this: OnePasswordConnectorService,
    token: string,
  ): Effect.fn.Return<OnePasswordConnectorStatus> {
    const trimmed = token.trim();
    registerSecretValue(trimmed);
    // Tracked like a CLI connect, so Cancel, Disconnect and a newer connection stop this one.
    const controller = this.#startConnecting();
    yield* this.#save({ token: trimmed, accountId: null, connectedAt: this.#now() }, controller.signal).pipe(
      Effect.catch(({ cause: error }) =>
        Effect.sync(() => {
          if (this.#connecting !== controller || controller.signal.aborted) return;
          logger.warn("Unable to connect 1Password with a token", { cause: toLogValue(error) });
          this.#error =
            error instanceof OnePasswordConnectError
              ? error.message
              : sourceText("error.connector.onePasswordTokenRejected");
        }),
      ),
      Effect.ensuring(this.#finishConnecting(controller)),
    );
    return this.status();
  }).bind(this);

  cancel(): OnePasswordConnectorStatus {
    this.#connecting?.abort();
    this.#connecting = null;
    this.#accounts = [];
    this.#error = null;
    this.#emitStatus();
    return this.status();
  }

  /**
   * Forgets the token. The vault and the service account stay in 1Password: only the user can remove
   * them there, and the panel says so.
   */
  readonly disconnect = Effect.fn("OnePasswordConnector.disconnect")(function* (
    this: OnePasswordConnectorService,
  ): Effect.fn.Return<OnePasswordConnectorStatus, OnePasswordOperationError> {
    this.#connecting?.abort();
    this.#connecting = null;
    this.#accounts = [];
    this.#error = null;
    this.#generation += 1;
    this.#client = null;
    this.#index = null;
    this.#indexing = null;
    yield* this.#store.clear();
    this.#emitStatus();
    return this.status();
  }).bind(this);

  connected(): boolean {
    return this.#store.read() !== null;
  }

  readonly loginsFor = Effect.fn("OnePasswordConnector.loginsFor")(
    function* (
      this: OnePasswordConnectorService,
      origin: string,
    ): Effect.fn.Return<VaultLogin[] | null, OnePasswordOperationError> {
      if (!this.#store.read()) return null;
      // An answer read from a connection that Disconnect removed or a new one replaced is dropped.
      const generation = this.#generation;
      const index = yield* this.#readIndex();
      const client = yield* this.#clientForToken();
      const matches = index.logins.filter((login) => login.websites.some((site) => websiteMatchesOrigin(site, origin)));
      const items = yield* Effect.forEach(
        matches.slice(0, MAX_LISTED_LOGINS),
        (login) =>
          onePasswordCall(() => client.items.get(login.vaultId, login.id)).pipe(
            Effect.map((item) => ({ login, item })),
          ),
        { concurrency: "unbounded" },
      );
      if (generation !== this.#generation) return null;
      return items
        .filter(({ item }) => savedFor(item.websites, origin))
        .map(({ login, item }) => ({
          id: login.id,
          title: login.title,
          username: item.fields.find((field) => field.id === "username")?.value || null,
          hasOneTimePassword: item.fields.some((field) => field.fieldType === "Totp"),
        }));
    },
    (operation) => operation.pipe(Effect.mapError(({ cause }) => new PasswordVaultError({ cause }))),
  ).bind(this);

  readonly secretFor = Effect.fn("OnePasswordConnector.secretFor")(
    function* (
      this: OnePasswordConnectorService,
      loginId: string,
      origin: string,
      kind: "password" | "totp",
    ): Effect.fn.Return<string | null, OnePasswordOperationError> {
      if (!this.#store.read()) return null;
      const generation = this.#generation;
      const login = (yield* this.#readIndex()).logins.find((candidate) => candidate.id === loginId);
      if (!login) return null;
      const client = yield* this.#clientForToken();
      const item = yield* onePasswordCall(() => client.items.get(login.vaultId, login.id));
      // The index can be minutes old: the item's websites as 1Password holds them now decide.
      if (generation !== this.#generation || !savedFor(item.websites, origin)) return null;
      const value =
        kind === "password"
          ? item.fields.find((field) => field.id === "password")?.value
          : otpCode(item.fields.find((field) => field.fieldType === "Totp")?.details);
      if (!value) return null;
      registerSecretValue(value);
      return value;
    },
    (operation) => operation.pipe(Effect.mapError(({ cause }) => new PasswordVaultError({ cause }))),
  ).bind(this);

  /** Stops a connection attempt, an install, and the login list reads that run in the background. */
  readonly dispose = Effect.fn("OnePasswordConnector.dispose")(function* (
    this: OnePasswordConnectorService,
  ): Effect.fn.Return<void> {
    this.#connecting?.abort();
    this.#connecting = null;
    this.#installing?.abort();
    this.#installing = null;
    this.#listeners.clear();
    yield* Scope.close(this.#scope, Exit.void);
  }).bind(this);

  /** Stops the attempt that runs, if any, and starts a new one. */
  #startConnecting(): AbortController {
    this.#connecting?.abort();
    const controller = new AbortController();
    this.#connecting = controller;
    this.#accounts = [];
    this.#error = null;
    this.#emitStatus();
    return controller;
  }

  #finishConnecting(controller: AbortController): Effect.Effect<void> {
    return Effect.sync(() => {
      if (this.#connecting === controller) this.#connecting = null;
      this.#emitStatus();
    });
  }

  /** Checks that overlap share one run. */
  readonly #sharedCheck = Effect.fn("OnePasswordConnector.sharedCheck")(function* (
    this: OnePasswordConnectorService,
  ): Effect.fn.Return<void> {
    if (this.#checking) return yield* Deferred.await(this.#checking);
    const done = Deferred.makeUnsafe<void>();
    this.#checking = done;
    return yield* this.#check().pipe(
      Effect.onExit((exit) => Deferred.done(done, exit)),
      Effect.ensuring(
        Effect.sync(() => {
          if (this.#checking === done) this.#checking = null;
        }),
      ),
    );
  });

  readonly #check = Effect.fn("OnePasswordConnector.check")(function* (
    this: OnePasswordConnectorService,
  ): Effect.fn.Return<void> {
    let found: { path: string; version: string } | null = null;
    for (const path of yield* this.#findCli()) {
      const version = yield* this.#run(path, ["--version"], AbortSignal.timeout(SETUP_CHECK_TIMEOUT_MS)).pipe(
        Effect.map((output) => output.trim()),
        Effect.orElseSucceed(() => null),
      );
      if (version && cliVersionSupported(version)) {
        found = { path, version };
        break;
      }
    }
    this.#cliPath = found?.path ?? null;
    // No account means the app integration is off: the CLI then has no session to create anything with.
    const appIntegration = found
      ? yield* this.#run(
          found.path,
          ["account", "list", "--format", "json"],
          AbortSignal.timeout(SETUP_CHECK_TIMEOUT_MS),
        ).pipe(
          Effect.flatMap(cliJson(accountListSchema)),
          Effect.map((accounts) => accounts.length > 0),
          Effect.orElseSucceed(() => false),
        )
      : null;
    this.#setup = {
      cli: found ? "ready" : "missing",
      cliVersion: found?.version ?? null,
      canInstall: this.#installCli !== null,
      appIntegration,
    };
    this.#emitStatus();
  });

  /** Runs one CLI executable. An interrupt stops the process, as `signal` does. */
  #run(executable: string, args: string[], signal: AbortSignal): Effect.Effect<string, OnePasswordOperationError> {
    return onePasswordCall((interrupted) => this.#runCli(executable, args, AbortSignal.any([signal, interrupted])));
  }

  /** Runs the CLI that the setup check found, looking again when there is none yet. */
  readonly #cli = Effect.fn("OnePasswordConnector.cli")(function* (
    this: OnePasswordConnectorService,
    args: string[],
    signal: AbortSignal,
  ): Effect.fn.Return<string, OnePasswordOperationError> {
    if (!this.#cliPath) yield* this.checkSetup();
    if (!this.#cliPath) return yield* connectFailure(sourceText("error.connector.onePasswordCliMissing"));
    return yield* this.#run(this.#cliPath, args, signal);
  });

  /** The new token, or null when the user must first choose an account. */
  readonly #createServiceAccount = Effect.fn("OnePasswordConnector.createServiceAccount")(function* (
    this: OnePasswordConnectorService,
    accountId: string | null,
    signal: AbortSignal,
  ): Effect.fn.Return<string | null, OnePasswordOperationError> {
    const accounts = yield* this.#cli(["account", "list", "--format", "json"], signal).pipe(
      Effect.flatMap(cliJson(accountListSchema)),
    );
    if (accounts.length === 0) return yield* connectFailure(sourceText("error.connector.onePasswordCliSignedOut"));
    const account = accountId
      ? accounts.find((candidate) => candidate.account_uuid === accountId)
      : accounts.length === 1
        ? accounts[0]
        : undefined;
    if (!account) {
      if (accountId) return yield* connectFailure(sourceText("error.connector.onePasswordCliSignedOut"));
      this.#accounts = accounts.map((candidate) => ({ id: candidate.account_uuid, label: accountLabel(candidate) }));
      return null;
    }
    const scope = ["--account", account.account_uuid];
    const vaults = yield* this.#cli(["vault", "list", ...scope, "--format", "json"], signal).pipe(
      Effect.flatMap(cliJson(vaultListSchema)),
    );
    const vaultId =
      vaults.find((vault) => vault.name === ONEPASSWORD_SHARED_VAULT)?.id ??
      (yield* this.#cli(
        [
          "vault",
          "create",
          ONEPASSWORD_SHARED_VAULT,
          "--description",
          "Logins that OpenBot agents may use to sign in to sites.",
          ...scope,
          "--format",
          "json",
        ],
        signal,
      ).pipe(Effect.flatMap(cliJson(vaultSchema)))).id;
    const token = (yield* this.#cli(
      [
        "service-account",
        "create",
        `OpenBot on ${this.#hostName}`,
        "--vault",
        `${vaultId}:read_items`,
        ...scope,
        "--raw",
      ],
      signal,
    )).trim();
    if (!token) return yield* connectFailure(sourceText("error.connector.onePasswordTokenRejected"));
    registerSecretValue(token);
    return token;
  });

  /** Checks the token with 1Password, then stores it. A token that reads no vault is refused. */
  readonly #save = Effect.fn("OnePasswordConnector.save")(function* (
    this: OnePasswordConnectorService,
    record: OnePasswordConnectorRecord,
    signal: AbortSignal,
  ): Effect.fn.Return<void, OnePasswordOperationError> {
    const client = yield* onePasswordCall(() => this.#createClient(record.token));
    const index = yield* this.#buildIndex(client);
    if (index.vaultNames.length === 0) return yield* connectFailure(sourceText("error.connector.onePasswordNoVault"));
    // Asked inside the store's queued write, so a stop during the write keeps nothing.
    if (!(yield* this.#store.write(record, () => !signal.aborted))) return;
    const ready = Deferred.makeUnsafe<OnePasswordClient, OnePasswordOperationError>();
    yield* Deferred.succeed(ready, client);
    this.#generation += 1;
    this.#client = { token: record.token, client: ready };
    this.#index = index;
    this.#indexing = null;
  });

  /** One client for each token. Reads that start together share its start. */
  readonly #clientForToken = Effect.fn("OnePasswordConnector.clientForToken")(function* (
    this: OnePasswordConnectorService,
  ): Effect.fn.Return<OnePasswordClient, OnePasswordOperationError> {
    const record = this.#store.read();
    if (!record)
      return yield* new OnePasswordOperationError({
        cause: new Error(sourceText("error.connector.onePasswordNoVault")),
      });
    const current = this.#client;
    if (current?.token === record.token) return yield* Deferred.await(current.client);
    const entry = { token: record.token, client: Deferred.makeUnsafe<OnePasswordClient, OnePasswordOperationError>() };
    this.#client = entry;
    return yield* onePasswordCall(() => this.#createClient(record.token)).pipe(
      Effect.onExit((exit) =>
        Effect.gen({ self: this }, function* () {
          // A failed start is tried again at the next read.
          if (Exit.isFailure(exit) && this.#client === entry) this.#client = null;
          yield* Deferred.done(entry.client, exit);
        }),
      ),
    );
  });

  /** Reads the login list when it is older than `maxAgeMs`. Reads that overlap share one run. */
  readonly #readIndex = Effect.fn("OnePasswordConnector.readIndex")(function* (
    this: OnePasswordConnectorService,
    maxAgeMs: number = INDEX_MAX_AGE_MS,
  ): Effect.fn.Return<LoginIndex, OnePasswordOperationError> {
    if (this.#index && this.#now() - this.#index.readAt < maxAgeMs) return this.#index;
    if (this.#indexing) return yield* Deferred.await(this.#indexing);
    const generation = this.#generation;
    const indexing = Deferred.makeUnsafe<LoginIndex, OnePasswordOperationError>();
    this.#indexing = indexing;
    return yield* Effect.gen({ self: this }, function* () {
      const index = yield* this.#buildIndex(yield* this.#clientForToken());
      if (generation === this.#generation) {
        this.#index = index;
        // The page shows the vault names and the login count from this list.
        this.#emitStatus();
      }
      return index;
    }).pipe(
      Effect.onExit((exit) => Deferred.done(indexing, exit)),
      Effect.ensuring(
        Effect.sync(() => {
          if (this.#indexing === indexing) this.#indexing = null;
        }),
      ),
    );
  });

  /** Reads the login list in the service's own scope. A failure is logged only. */
  #readIndexInBackground(maxAgeMs: number): Effect.Effect<void> {
    return Effect.forkIn(
      this.#readIndex(maxAgeMs).pipe(
        Effect.catch(({ cause }) =>
          Effect.sync(() => {
            logger.warn("The 1Password vault could not be read.", { cause: toLogValue(cause) });
          }),
        ),
      ),
      this.#scope,
    ).pipe(Effect.asVoid);
  }

  readonly #buildIndex = Effect.fn("OnePasswordConnector.buildIndex")(function* (
    this: OnePasswordConnectorService,
    client: OnePasswordClient,
  ): Effect.fn.Return<LoginIndex, OnePasswordOperationError> {
    const vaults = yield* onePasswordCall(() => client.vaults.list());
    const logins: IndexedLogin[] = [];
    for (const vault of vaults) {
      for (const item of yield* onePasswordCall(() => client.items.list(vault.id))) {
        if (item.category !== "Login") continue;
        logins.push({
          id: item.id,
          vaultId: vault.id,
          title: item.title,
          websites: vaultWebsites(item.websites),
        });
      }
    }
    return { readAt: this.#now(), vaultNames: vaults.map((vault) => vault.title), logins };
  });

  #open(url: string): Effect.Effect<void, OnePasswordOperationError> {
    return onePasswordCall(() => this.#openExternal(url));
  }

  #emitStatus(): void {
    const status = this.status();
    for (const listener of this.#listeners) listener(status);
  }
}

function otpCode(details: { type: string; content?: unknown } | undefined): string | undefined {
  if (details?.type !== "Otp" || typeof details.content !== "object" || details.content === null) return undefined;
  const code = "code" in details.content ? details.content.code : undefined;
  return typeof code === "string" ? code : undefined;
}
