// Proton Pass as a driver of the password-manager engine. OpenBot runs Proton's own CLI (`pass-cli`)
// as a separate program; it does not include its code.
//
// A `browser` connection signs the user in on this host with Proton's web sign-in, in a temporary
// CLI session. With that session, the host finds or makes the vault "Shared with OpenBot", makes an
// agent access key that reads only that vault, and signs the user out again. The host keeps only the
// agent access key. A `key` connection takes an agent access key that the user made. The browser
// reads the logins of the vault with the access key; the CLI tells Proton why it reads a login.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  disconnectedPasswordManager,
  type PasswordManagerConnectMethod,
  type PasswordManagerErrorCode,
  type PasswordManagerStatus,
  type PasswordManagerStep,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { isFixedSourceText, sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, registerSecretValue, toLogValue } from "@openbot/logging";
import { Effect, Exit, Schema, Scope, Semaphore } from "effect";
import { causeHelpers } from "../../backend/effect-boundary";
import {
  PASSWORD_MANAGER_BRANDS,
  type PasswordVault,
  PasswordVaultError,
  type VaultLogin,
  websiteMatchesOrigin,
} from "../../backend/password-vault";
import { type PasswordManagerDriver, PasswordManagerError, passwordManagerFailure } from "./driver";
import type { EncryptedRecordStore } from "./encrypted-record-store";
import { type ExtraPasswordAnswer, openExtraPasswordPipe } from "./extra-password-pipe";
import { allowedSignInPage } from "./password-managers-service";

const logger = createOpenBotLogger("proton-pass");
const { io } = causeHelpers(PasswordManagerError);

/** The vault that a `browser` connection reads. The user moves the logins that OpenBot may use into it. */
const PROTON_PASS_SHARED_VAULT = "Shared with OpenBot";
const PROTON_PASS_SIGN_IN_HOSTS = ["account.proton.me"] as const;
const TOKEN_VARIABLE = "PROTON_PASS_PERSONAL_ACCESS_TOKEN";
/** The CLI tells Proton this reason for each login that it reads. */
const READ_REASON = "OpenBot fills this login in its browser.";
const AGENT_EXPIRATION = "1y";
const AGENT_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;
const COMMAND_MS = 60_000;
/** The sign-out after a web sign-in. It runs also after a cancel or a quit, so it is short. */
const SIGN_OUT_MS = 10_000;
/** The CLI waits 10 minutes for the web sign-in. */
const SIGN_IN_MS = 11 * 60_000;
const INDEX_MS = 10 * 60_000;
const MAX_LOGINS = 500;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const PROTON_ID = /^[A-Za-z0-9_=-]{1,256}$/u;

export const protonPassRecordSchema = Schema.Struct({
  /** The agent access key, `pst_<token>::<key>`. It goes to the CLI only, in its environment. */
  token: Schema.String,
  /** Encrypts the CLI session on the disk. It goes to the CLI only, in its environment. */
  encryptionKey: Schema.String,
  /** The agent that a `browser` connection made, or null for a key that the user made. */
  agentName: Schema.NullOr(Schema.String),
  vaultNames: Schema.Array(Schema.String),
  method: Schema.Literals(["browser", "key"]),
  expiresAt: Schema.NullOr(Schema.Number),
  connectedAt: Schema.Number,
});
export type ProtonPassRecord = typeof protonPassRecordSchema.Type;

export interface ProtonPassCliResult {
  /** Null when the CLI was stopped. */
  code: number | null;
  stdout: string;
  stderr: string;
}

export type ProtonPassCliRunner = (
  executable: string,
  args: readonly string[],
  options: {
    env: Record<string, string>;
    signal: AbortSignal;
    timeoutMs: number;
    /** Gets the output while the CLI runs. */
    onOutput?: (text: string) => void;
  },
) => Promise<ProtonPassCliResult>;

/** No shell and no inherited credentials. The output is never logged: `item view` prints passwords. */
const runProtonPassCli: ProtonPassCliRunner = (executable, args, options) => {
  const env: NodeJS.ProcessEnv = { PROTON_PASS_NO_UPDATE_CHECK: "1", PROTON_PASS_DISABLE_TELEMETRY: "1" };
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
  ]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  Object.assign(env, options.env);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      env,
      signal: options.signal,
      timeout: options.timeoutMs,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = { stdout: "", stderr: "" };
    let size = 0;
    for (const stream of ["stdout", "stderr"] as const) {
      child[stream].setEncoding("utf8");
      child[stream].on("data", (text: string) => {
        size += text.length;
        if (size > MAX_OUTPUT_BYTES) {
          child.kill();
          return;
        }
        output[stream] += text;
        options.onOutput?.(text);
      });
    }
    child.once("error", () => reject(new Error(sourceText("error.connector.protonPassFailed"))));
    child.once("close", (code) => resolve({ code, ...output }));
  });
};

/** A failure that the status shows, with its `errorCode`. */
class ProtonPassFailure extends Error {
  readonly code: PasswordManagerErrorCode | null;
  constructor(message: string, code: PasswordManagerErrorCode | null = null) {
    super(message);
    this.code = code;
  }
}

function fail(message: string, code: PasswordManagerErrorCode | null = null): PasswordManagerError {
  return new PasswordManagerError({ cause: new ProtonPassFailure(message, code) });
}

/** The known refusals of the CLI. Other output gives the general failure. */
function cliFailure(result: ProtonPassCliResult): PasswordManagerError {
  const text = `${result.stdout}\n${result.stderr}`;
  if (text.includes("not yet allowed to use our CLI"))
    return fail(sourceText("error.connector.protonPassPlan"), "plan");
  if (/invalid or expired personal access token|invalid, expired or has been deleted/iu.test(text))
    return fail(sourceText("error.connector.protonPassExpired"), "expired");
  if (/incorrect extra password/iu.test(text))
    return fail(sourceText("error.connector.protonPassExtraPassword"), "extra-password");
  return fail(sourceText("error.connector.protonPassFailed"));
}

function failureOf(cause: unknown): ProtonPassFailure {
  if (cause instanceof ProtonPassFailure) return cause;
  return new ProtonPassFailure(
    cause instanceof Error && isFixedSourceText(cause.message)
      ? cause.message
      : sourceText("error.connector.protonPassFailed"),
  );
}

/** An agent access key without the variable name that the CLI prints before it, or null. */
function protonPassAccessKey(value: string): string | null {
  let key = value.trim();
  if (key.startsWith(`${TOKEN_VARIABLE}=`)) key = key.slice(TOKEN_VARIABLE.length + 1).trim();
  return /^pst_[^\s:]+::\S+$/u.test(key) ? key : null;
}

/** The vault names of `vault list --output json`: a list, or an object that holds one. */
function vaultNames(output: string): string[] {
  return namesIn(JSON.parse(output));
}

/** The OpenBot vault first, because a page names the first vault as the one that agents use. */
function sharedVaultFirst(names: readonly string[]): string[] {
  return [...names].sort((a, b) => Number(b === PROTON_PASS_SHARED_VAULT) - Number(a === PROTON_PASS_SHARED_VAULT));
}

/** The share ids of `vault list --output json`. A vault without a valid id is skipped. */
function vaultShareIds(output: string): string[] {
  return vaultsIn(JSON.parse(output)).flatMap((vault) =>
    typeof vault.share_id === "string" && PROTON_ID.test(vault.share_id) ? [vault.share_id] : [],
  );
}

function namesIn(value: unknown): string[] {
  return vaultsIn(value).flatMap((vault) => {
    const name = vault.name ?? vault.title;
    return typeof name === "string" ? [name] : [];
  });
}

/** The vault records of `vault list --output json`: a list, or an object that holds one. */
function vaultsIn(value: unknown): DynamicRecord[] {
  const list: unknown[] = Array.isArray(value)
    ? value
    : isDynamicRecord(value)
      ? (Object.values(value).find(Array.isArray) ?? [])
      : [];
  return list.filter(isDynamicRecord);
}

function tokenIn(value: unknown): string | null {
  return isDynamicRecord(value) && typeof value.token === "string" ? protonPassAccessKey(value.token) : null;
}

/** The access key in the output of `agent create`. */
function createdAccessKey(output: string): string | null {
  try {
    const key = tokenIn(JSON.parse(output));
    if (key) return key;
  } catch {
    /* The text form follows. */
  }
  const match = /pst_[^\s:"]+::[^\s"]+/u.exec(output);
  return match ? protonPassAccessKey(match[0]) : null;
}

const itemListSchema = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      share_id: Schema.String,
      state: Schema.optionalKey(Schema.Unknown),
      modify_time: Schema.optionalKey(Schema.Unknown),
      title: Schema.optionalKey(Schema.String),
    }),
  ),
});

/** A login that is not in the trash. */
function isActive(state: unknown): boolean {
  return (
    state === undefined || state === null || state === 1 || (typeof state === "string" && /^active$/iu.test(state))
  );
}

interface IndexedLogin {
  shareId: string;
  itemId: string;
  modified: string;
  title: string;
  username: string | null;
  urls: string[];
  hasTotp: boolean;
}

/**
 * The fields of `item view --output json` that the browser needs. The password is in the same
 * output; it is not kept. The fields are found by name at any depth.
 */
function loginDetails(value: unknown): Pick<IndexedLogin, "username" | "urls" | "hasTotp"> {
  let username: string | null = null;
  let email: string | null = null;
  const urls: string[] = [];
  let hasTotp = false;
  const visit = (node: unknown, depth: number): void => {
    if (depth > 8) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1);
      return;
    }
    if (!isDynamicRecord(node)) return;
    for (const [key, child] of Object.entries(node)) {
      if (key === "password") continue;
      if (key === "urls" && Array.isArray(child)) urls.push(...child.filter((url) => typeof url === "string"));
      else if (key === "username" && typeof child === "string" && child) username ??= child;
      else if (key === "email" && typeof child === "string" && child) email ??= child;
      else if ((key === "totp_uri" || key === "totp") && typeof child === "string" && child) hasTotp = true;
      else visit(child, depth + 1);
    }
  };
  visit(value, 0);
  return { username: username ?? email, urls, hasTotp };
}

/**
 * The password in `item view --output json`, found by name as in `loginDetails`, or null. A login
 * with an empty password, for example one with only a passkey, gives null: `item view` of its
 * `/password` field exits 1, which reads as a failed session.
 */
function loginPassword(node: unknown, depth = 0): string | null {
  if (depth > 8) return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = loginPassword(child, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  if (!isDynamicRecord(node)) return null;
  for (const [key, child] of Object.entries(node)) {
    if (key === "password") return typeof child === "string" && child ? child : null;
    const found = loginPassword(child, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

function matchesOrigin(login: IndexedLogin, origin: string): boolean {
  // `urls` holds only the websites in Proton's `Default` fill mode, which fills on the whole site:
  // a login saved for `cloudflare.com` also fills on `dash.cloudflare.com`.
  return login.urls.some((url) => websiteMatchesOrigin({ url, autofill: "anywhere" }, origin));
}

function registerRecord(record: ProtonPassRecord): void {
  registerSecretValue(record.token);
  registerSecretValue(record.encryptionKey);
}

interface Attempt {
  abort: AbortController;
  step: PasswordManagerStep;
  signInUrl: string | null;
  /** Set while the CLI waits for the extra password. */
  answer: ExtraPasswordAnswer | null;
  reads: number;
}

export interface ProtonPassDriverOptions {
  store: EncryptedRecordStore<ProtonPassRecord>;
  /** The CLI sessions of this host. Outside every root that an agent can write. */
  dataDirectory: string;
  hostName: string;
  /** Installs the pinned CLI, or null when OpenBot has no CLI build for this computer. */
  installCli: ((signal: AbortSignal) => Effect.Effect<string, PasswordManagerError>) | null;
  runCli?: ProtonPassCliRunner;
  now?: () => number;
}

export class ProtonPassDriver implements PasswordManagerDriver, PasswordVault {
  readonly id = "protonpass" as const;
  readonly prefix = "proton:";
  readonly brand = PASSWORD_MANAGER_BRANDS.protonpass;
  readonly signInHosts: readonly string[] = PROTON_PASS_SIGN_IN_HOSTS;
  readonly vault: PasswordVault = this;
  readonly #options: ProtonPassDriverOptions;
  readonly #run: ProtonPassCliRunner;
  readonly #now: () => number;
  readonly #listeners = new Set<(status: PasswordManagerStatus) => void>();
  readonly #running = new Set<Promise<ProtonPassCliResult>>();
  /** Owns the sign-in and the index reads that run after an answer. Dispose stops them. */
  readonly #scope = Scope.makeUnsafe();
  /** One CLI session call at a time, so a sign-in again with the access key runs once. */
  readonly #session = Semaphore.makeUnsafe(1);
  readonly #indexing = Semaphore.makeUnsafe(1);
  #attempt: Attempt | null = null;
  /** Stops the calls of the stored connection. Replaced at each disconnect. */
  #connection = new AbortController();
  #executable: string | null = null;
  #signedIn = false;
  #index: { readAt: number; logins: Map<string, IndexedLogin> } | null = null;
  #error: string | null = null;
  #errorCode: PasswordManagerErrorCode | null = null;

  constructor(options: ProtonPassDriverOptions) {
    this.#options = options;
    this.#run = options.runCli ?? runProtonPassCli;
    this.#now = options.now ?? Date.now;
  }

  /** Reads the stored connection, then reads the logins in the background. */
  readonly load = Effect.fn("ProtonPass.load")(function* (this: ProtonPassDriver) {
    const error = yield* this.#options.store.load();
    if (error) logger.warn("The Proton Pass connection file could not be read.", { cause: toLogValue(error) });
    const record = this.#options.store.read();
    if (!record) return;
    registerRecord(record);
    if (record.expiresAt !== null && record.expiresAt <= this.#now()) {
      this.#setError(new ProtonPassFailure(sourceText("error.connector.protonPassExpired"), "expired"));
      return;
    }
    yield* this.#refreshInBackground();
  }).bind(this);

  status(): PasswordManagerStatus {
    const base = disconnectedPasswordManager("protonpass", ["browser", "key"]);
    const failure = { error: this.#error, errorCode: this.#errorCode };
    const attempt = this.#attempt;
    if (attempt) {
      return {
        ...base,
        ...failure,
        state: "signing-in",
        step: attempt.step,
        signInUrl: attempt.step === "browser" ? attempt.signInUrl : null,
      };
    }
    const record = this.#options.store.read();
    if (record && this.connected()) {
      return {
        ...base,
        state: "connected",
        vaultNames: sharedVaultFirst(record.vaultNames),
        loginCount: this.#index?.logins.size ?? null,
        expiresAt: record.expiresAt,
      };
    }
    return this.#error ? { ...base, ...failure, state: "failed" } : base;
  }

  onChanged(listener: (status: PasswordManagerStatus) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  connected(): boolean {
    return (
      !this.#attempt &&
      this.#options.store.read() !== null &&
      this.#errorCode !== "expired" &&
      this.#errorCode !== "plan"
    );
  }

  readonly connect = Effect.fn("ProtonPass.connect")(function* (
    this: ProtonPassDriver,
    method: PasswordManagerConnectMethod,
  ): Effect.fn.Return<PasswordManagerStatus, PasswordManagerError> {
    if (method.kind === "extra-password") {
      registerSecretValue(method.password, { allowShort: true });
      const answer = this.#attempt?.answer;
      if (!answer || !this.#attempt)
        return yield* passwordManagerFailure(sourceText("error.connector.protonPassExtraPasswordNotAsked"));
      this.#attempt.answer = null;
      this.#attempt.step = "setup";
      this.#emit();
      yield* io(() => answer(method.password));
      return this.status();
    }
    if (method.kind === "key") {
      registerSecretValue(method.key);
      const key = protonPassAccessKey(method.key);
      if (!key) {
        yield* this.#stop();
        this.#setError(new ProtonPassFailure(sourceText("error.connector.protonPassKeyInvalid")));
        return this.status();
      }
      registerSecretValue(key);
      yield* this.#start("setup", (attempt) =>
        this.#store(attempt, { token: key, agentName: null, method: "key", expiresAt: null }),
      );
      return this.status();
    }
    yield* this.#start("browser", (attempt) => this.#signIn(attempt));
    return this.status();
  }).bind(this);

  readonly cancel = Effect.fn("ProtonPass.cancel")(function* (this: ProtonPassDriver) {
    yield* Effect.sync(() => {
      const attempt = this.#attempt;
      if (!attempt) return;
      attempt.abort.abort();
      this.#attempt = null;
      this.#error = null;
      this.#errorCode = null;
      this.#emit();
    });
    return this.status();
  }).bind(this);

  /**
   * Stops access and removes the access key and the CLI session of this host. An agent that a
   * `browser` connection made stays in the Proton account until it expires; the user can remove it
   * there.
   */
  readonly disconnect = Effect.fn("ProtonPass.disconnect")(function* (
    this: ProtonPassDriver,
  ): Effect.fn.Return<PasswordManagerStatus, PasswordManagerError> {
    yield* this.#stop();
    yield* this.#options.store.clear();
    yield* Effect.promise(() => Promise.allSettled([...this.#running]));
    yield* io(() => rm(this.#options.dataDirectory, { recursive: true, force: true }));
    this.#error = null;
    this.#errorCode = null;
    this.#emit();
    return this.status();
  }).bind(this);

  /** Stops the sign-in and the CLI. The stored connection stays. */
  readonly dispose = Effect.fn("ProtonPass.dispose")(function* (this: ProtonPassDriver) {
    this.#attempt?.abort.abort();
    this.#attempt = null;
    this.#connection.abort();
    yield* Scope.close(this.#scope, Exit.void);
    yield* Effect.promise(() => Promise.allSettled([...this.#running]));
  }).bind(this);

  readonly loginsFor = Effect.fn("ProtonPass.loginsFor")(function* (
    this: ProtonPassDriver,
    origin: string,
  ): Effect.fn.Return<VaultLogin[] | null, PasswordVaultError> {
    if (!this.connected()) return null;
    const logins = yield* this.#logins().pipe(Effect.mapError(({ cause }) => new PasswordVaultError({ cause })));
    return [...logins.entries()]
      .filter(([, login]) => matchesOrigin(login, origin))
      .map(([id, login]) => ({ id, title: login.title, username: login.username, hasOneTimePassword: login.hasTotp }));
  }).bind(this);

  readonly secretFor = Effect.fn("ProtonPass.secretFor")(function* (
    this: ProtonPassDriver,
    id: string,
    origin: string,
    kind: "password" | "totp",
  ): Effect.fn.Return<string | null, PasswordVaultError> {
    if (!this.connected()) return null;
    const logins = yield* this.#logins().pipe(Effect.mapError(({ cause }) => new PasswordVaultError({ cause })));
    const login = logins.get(id);
    if (!login || !matchesOrigin(login, origin) || (kind === "totp" && !login.hasTotp)) return null;
    const item = `pass://${login.shareId}/${login.itemId}`;
    const value = yield* (
      kind === "password"
        ? this.#agentCall(["item", "view", item, "--output", "json"]).pipe(
            Effect.flatMap((output) =>
              Effect.try({
                try: () => loginPassword(JSON.parse(output)),
                catch: () => fail(sourceText("error.connector.protonPassFailed")),
              }),
            ),
          )
        : this.#agentCall(["item", "view", `${item}/totp?totp=code`]).pipe(Effect.map((output) => output.trim()))
    ).pipe(Effect.mapError(({ cause }) => new PasswordVaultError({ cause })));
    if (!value) return null;
    registerSecretValue(value, { allowShort: true });
    return value;
  }).bind(this);

  /** Starts a sign-in that answers at once; `work` continues in the driver's scope. */
  #start(
    step: PasswordManagerStep,
    work: (attempt: Attempt) => Effect.Effect<void, PasswordManagerError>,
  ): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      yield* this.#stop();
      const attempt: Attempt = { abort: new AbortController(), step, signInUrl: null, answer: null, reads: 0 };
      this.#attempt = attempt;
      this.#error = null;
      this.#errorCode = null;
      this.#emit();
      yield* Effect.forkIn(
        work(attempt).pipe(
          Effect.catch(({ cause }) =>
            Effect.sync(() => {
              if (this.#attempt !== attempt) return;
              logger.warn("Unable to connect Proton Pass", { cause: toLogValue(cause) });
              this.#attempt = null;
              this.#setError(failureOf(cause));
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              if (this.#attempt !== attempt) return;
              this.#attempt = null;
              this.#emit();
            }),
          ),
        ),
        this.#scope,
      );
    });
  }

  /** The web sign-in in a temporary CLI session, then the vault and the agent access key. */
  #signIn(attempt: Attempt): Effect.Effect<void, PasswordManagerError> {
    const { signal } = attempt.abort;
    const directory = join(this.#options.dataDirectory, `sign-in-${randomBytes(6).toString("hex")}`);
    return Effect.gen({ self: this }, function* () {
      const executable = yield* this.#cli(signal);
      yield* io(() => mkdir(directory, { recursive: true, mode: 0o700 }));
      const pipe = yield* io(() =>
        openExtraPasswordPipe(directory, (answer) => {
          if (this.#attempt !== attempt) return;
          attempt.reads += 1;
          attempt.answer = answer;
          attempt.step = "extra-password";
          // The CLI reads again only after an incorrect password.
          if (attempt.reads > 1) {
            this.#error = sourceText("error.connector.protonPassExtraPassword");
            this.#errorCode = "extra-password";
          }
          this.#emit();
        }),
      );
      const env = {
        PROTON_PASS_SESSION_DIR: join(directory, "session"),
        PROTON_PASS_KEY_PROVIDER: "env",
        PROTON_PASS_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
        PROTON_PASS_EXTRA_PASSWORD_FILE: pipe.path,
      };
      registerSecretValue(env.PROTON_PASS_ENCRYPTION_KEY);
      const call = (args: string[]) => this.#call(executable, args, env, signal, COMMAND_MS);
      const signedIn = yield* Effect.gen({ self: this }, function* () {
        let output = "";
        const login = yield* this.#call(executable, ["login"], env, signal, SIGN_IN_MS, (text) => {
          output += text;
          if (attempt.signInUrl || this.#attempt !== attempt) return;
          for (const [url] of output.matchAll(/https:\/\/[^\s"'<>]+/gu)) {
            const page = allowedSignInPage(url, PROTON_PASS_SIGN_IN_HOSTS);
            if (!page) continue;
            attempt.signInUrl = page;
            this.#emit();
            return;
          }
        });
        if (login.code === null && !signal.aborted)
          return yield* fail(sourceText("error.connector.protonPassSignInTimeout"));
        if (login.code !== 0) return yield* cliFailure(login);
        attempt.answer = null;
        attempt.step = "setup";
        this.#error = null;
        this.#errorCode = null;
        this.#emit();
        const vaults = yield* call(["vault", "list", "--output", "json"]);
        if (vaults.code !== 0) return yield* cliFailure(vaults);
        const names = yield* Effect.try({
          try: () => vaultNames(vaults.stdout),
          catch: () => fail(sourceText("error.connector.protonPassSetupFailed")),
        });
        if (!names.includes(PROTON_PASS_SHARED_VAULT)) {
          const created = yield* call(["vault", "create", "--name", PROTON_PASS_SHARED_VAULT]);
          if (created.code !== 0) return yield* fail(sourceText("error.connector.protonPassSetupFailed"));
        }
        // A new name each time: another computer with the same host name keeps its own agent.
        const hostPart = `OpenBot ${this.#options.hostName}`.slice(0, 57);
        const agentName = `${hostPart} ${randomBytes(3).toString("hex")}`;
        const agent = yield* call([
          "agent",
          "create",
          agentName,
          "--expiration",
          AGENT_EXPIRATION,
          "--vault",
          PROTON_PASS_SHARED_VAULT,
        ]);
        const token = agent.code === 0 ? createdAccessKey(agent.stdout) : null;
        if (!token) return yield* fail(sourceText("error.connector.protonPassSetupFailed"));
        registerSecretValue(token);
        return { token, agentName };
      }).pipe(
        Effect.ensuring(
          Effect.gen({ self: this }, function* () {
            // The user's own session ends on this host; only the agent access key stays. A cancel aborts
            // `signal`, so the sign-out has its own signal: it must also end the session at Proton then.
            const signOut = (args: string[]) =>
              this.#call(executable, args, env, new AbortController().signal, SIGN_OUT_MS);
            const logout = yield* signOut(["logout"]).pipe(Effect.orElseSucceed(() => null));
            if (logout?.code !== 0) yield* signOut(["logout", "--force"]).pipe(Effect.ignore);
            yield* Effect.promise(() => pipe.close());
          }),
        ),
      );
      yield* this.#store(attempt, {
        token: signedIn.token,
        agentName: signedIn.agentName,
        method: "browser",
        expiresAt: this.#now() + AGENT_LIFETIME_MS,
      });
    }).pipe(Effect.ensuring(io(() => rm(directory, { recursive: true, force: true })).pipe(Effect.ignore)));
  }

  /** Signs in with the agent access key in the host's own CLI session, reads the vault names, and stores the record. */
  #store(
    attempt: Attempt,
    access: Pick<ProtonPassRecord, "token" | "agentName" | "method" | "expiresAt">,
  ): Effect.Effect<void, PasswordManagerError> {
    return Effect.gen({ self: this }, function* () {
      attempt.step = "setup";
      this.#emit();
      const { signal } = attempt.abort;
      const record: ProtonPassRecord = {
        ...access,
        encryptionKey: randomBytes(32).toString("hex"),
        vaultNames: [],
        connectedAt: this.#now(),
      };
      registerRecord(record);
      const executable = yield* this.#cli(signal);
      yield* io(() => rm(this.#sessionDirectory(), { recursive: true, force: true }));
      this.#signedIn = false;
      const login = yield* this.#call(executable, ["login"], this.#sessionEnv(record, true), signal, COMMAND_MS);
      if (login.code !== 0) return yield* cliFailure(login);
      const vaults = yield* this.#call(
        executable,
        ["vault", "list", "--output", "json"],
        this.#sessionEnv(record),
        signal,
        COMMAND_MS,
      );
      if (vaults.code !== 0) return yield* cliFailure(vaults);
      const names = yield* Effect.try({
        try: () => vaultNames(vaults.stdout),
        catch: () => fail(sourceText("error.connector.protonPassFailed")),
      });
      const stored = { ...record, vaultNames: names.slice(0, 500) };
      const kept = yield* this.#options.store.write(stored, () => this.#attempt === attempt && !signal.aborted);
      if (!kept) return yield* fail(sourceText("error.connector.protonPassFailed"));
      this.#signedIn = true;
      this.#index = null;
      this.#attempt = null;
      this.#error = null;
      this.#errorCode = null;
      this.#emit();
      yield* this.#refreshInBackground();
    });
  }

  /** Stops a sign-in and the calls of the stored connection, and forgets the CLI session in memory. */
  #stop(): Effect.Effect<void> {
    return Effect.sync(() => {
      this.#attempt?.abort.abort();
      this.#attempt = null;
      this.#connection.abort();
      this.#connection = new AbortController();
      this.#signedIn = false;
      this.#index = null;
    });
  }

  #cli(signal: AbortSignal): Effect.Effect<string, PasswordManagerError> {
    return Effect.suspend(() => {
      if (this.#executable) return Effect.succeed(this.#executable);
      const install = this.#options.installCli;
      if (!install) return Effect.fail(fail(sourceText("error.connector.protonPassCliInstallFailed")));
      return install(signal).pipe(Effect.tap((path) => Effect.sync(() => (this.#executable = path))));
    });
  }

  #sessionDirectory(): string {
    return join(this.#options.dataDirectory, "session");
  }

  /** The environment of the host's own CLI session. `withToken` adds the access key for `login`. */
  #sessionEnv(record: ProtonPassRecord, withToken = false): Record<string, string> {
    return {
      PROTON_PASS_SESSION_DIR: this.#sessionDirectory(),
      PROTON_PASS_KEY_PROVIDER: "env",
      PROTON_PASS_ENCRYPTION_KEY: record.encryptionKey,
      PROTON_PASS_AGENT_REASON: READ_REASON,
      ...(withToken ? { [TOKEN_VARIABLE]: record.token } : {}),
    };
  }

  #call(
    executable: string,
    args: readonly string[],
    env: Record<string, string>,
    signal: AbortSignal,
    timeoutMs: number,
    onOutput?: (text: string) => void,
  ): Effect.Effect<ProtonPassCliResult, PasswordManagerError> {
    return io((interrupted) => {
      const pending = this.#run(executable, args, {
        env,
        signal: AbortSignal.any([signal, interrupted]),
        timeoutMs,
        ...(onOutput ? { onOutput } : {}),
      });
      this.#running.add(pending);
      return pending.finally(() => this.#running.delete(pending));
    });
  }

  /**
   * Runs `args` in the host's own CLI session. The agent session ends after a time, so a failed call
   * signs in again with the access key once and runs again.
   */
  #agentCall(args: readonly string[]): Effect.Effect<string, PasswordManagerError> {
    return this.#session.withPermit(
      Effect.gen({ self: this }, function* () {
        const record = this.#options.store.read();
        if (!record || !this.connected()) return yield* fail(sourceText("error.connector.protonPassFailed"));
        const { signal } = this.#connection;
        const executable = yield* this.#cli(signal);
        const signIn = Effect.gen({ self: this }, function* () {
          const login = yield* this.#call(executable, ["login"], this.#sessionEnv(record, true), signal, COMMAND_MS);
          // The CLI refuses `login` while the session of an earlier run is still there, for example after a
          // restart. The CLI deletes that session when the server ends it, so it is safe to use it.
          if (login.code !== 0 && !login.stderr.includes("Already authenticated")) {
            const error = cliFailure(login);
            if (error.cause instanceof ProtonPassFailure && error.cause.code) this.#setError(error.cause);
            return yield* error;
          }
          this.#signedIn = true;
        });
        if (!this.#signedIn) yield* signIn;
        let result = yield* this.#call(executable, args, this.#sessionEnv(record), signal, COMMAND_MS);
        if (result.code !== 0 && !signal.aborted) {
          this.#signedIn = false;
          yield* signIn;
          result = yield* this.#call(executable, args, this.#sessionEnv(record), signal, COMMAND_MS);
        }
        if (result.code !== 0) return yield* cliFailure(result);
        return result.stdout;
      }),
    );
  }

  /** The index of the shared logins, read again when it is older than 10 minutes. */
  #logins(): Effect.Effect<Map<string, IndexedLogin>, PasswordManagerError> {
    return this.#indexing.withPermit(
      Effect.gen({ self: this }, function* () {
        const current = this.#index;
        if (current && this.#now() - current.readAt < INDEX_MS) return current.logins;
        // `item list` reads one vault, and no default vault is set: each vault that the key reads is listed.
        const vaultOutput = yield* this.#agentCall(["vault", "list", "--output", "json"]);
        const shareIds = yield* Effect.try({
          try: () => vaultShareIds(vaultOutput),
          catch: () => fail(sourceText("error.connector.protonPassFailed")),
        });
        const pages: (typeof itemListSchema.Type)[] = [];
        for (const shareId of shareIds) {
          const output = yield* this.#agentCall([
            "item",
            "list",
            "--share-id",
            shareId,
            "--filter-type",
            "login",
            "--output",
            "json",
          ]);
          const page = yield* Effect.try({
            try: () => Schema.decodeUnknownSync(itemListSchema)(JSON.parse(output)),
            catch: () => fail(sourceText("error.connector.protonPassFailed")),
          });
          pages.push(page);
        }
        const logins = new Map<string, IndexedLogin>();
        for (const item of pages.flatMap((page) => page.items)) {
          if (logins.size >= MAX_LOGINS) break;
          if (!isActive(item.state) || !PROTON_ID.test(item.id) || !PROTON_ID.test(item.share_id)) continue;
          const id = `${item.share_id}:${item.id}`;
          const modified = JSON.stringify(item.modify_time ?? null);
          const known = current?.logins.get(id);
          if (known && known.modified === modified) {
            logins.set(id, known);
            continue;
          }
          // `item view` prints the password too; only the fields that the browser needs are kept.
          const view = yield* this.#agentCall([
            "item",
            "view",
            `pass://${item.share_id}/${item.id}`,
            "--output",
            "json",
          ]);
          const details = yield* Effect.try({
            try: () => loginDetails(JSON.parse(view)),
            catch: () => fail(sourceText("error.connector.protonPassFailed")),
          });
          logins.set(id, { shareId: item.share_id, itemId: item.id, modified, title: item.title ?? "", ...details });
        }
        const changed = current?.logins.size !== logins.size;
        this.#index = { readAt: this.#now(), logins };
        if (changed) this.#emit();
        return logins;
      }),
    );
  }

  #refreshInBackground(): Effect.Effect<void> {
    return Effect.forkIn(
      this.#logins().pipe(
        Effect.catch(({ cause }) =>
          Effect.sync(() => logger.warn("The Proton Pass logins could not be read.", { cause: toLogValue(cause) })),
        ),
      ),
      this.#scope,
    ).pipe(Effect.asVoid);
  }

  #setError(failure: ProtonPassFailure): void {
    this.#error = failure.message;
    this.#errorCode = failure.code;
    this.#emit();
  }

  #emit(): void {
    const status = this.status();
    for (const listener of this.#listeners) listener(status);
  }
}
