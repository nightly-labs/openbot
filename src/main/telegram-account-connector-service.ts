// The Telegram account connection of this computer: OpenBot signs in to the user's own Telegram
// account over MTProto, as Telegram Desktop does, so agents can read the user's chats and, when the
// user turns sending on, send messages as the user.

import { randomBytes } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, relative, sep } from "node:path";
import {
  DISCONNECTED_TELEGRAM_ACCOUNT_CONNECTOR,
  type McpServerConfig,
  TELEGRAM_ACCOUNT_API_HASH_PATTERN,
  TELEGRAM_ACCOUNT_MCP_SERVER_ID,
  TELEGRAM_ACCOUNT_MCP_SERVER_NAME,
  type TelegramAccount,
  type TelegramAccountConnectInput,
  type TelegramAccountConnectorState,
  type TelegramAccountConnectorStatus,
  type TelegramAccountSubmitInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText, registerSecretValue, toLogValue } from "@openbot/logging";
import { Deferred, Duration, Effect, Exit, Option, Result, Scope } from "effect";
import type { TelegramAccountClient, TelegramAccountClientOptions } from "./telegram-account-client";
import type {
  TelegramAccountConnectorRecord,
  TelegramAccountConnectorStore,
  TelegramAccountRecordAccount,
} from "./telegram-account-connector-store";
import {
  registerSubmittedValue,
  TELEGRAM_MAX_API_ID,
  TELEGRAM_SESSION_ENDED,
  type TelegramAccountOperationError,
  telegramAccountCall,
  telegramAccountDecode,
  telegramErrorMessage,
  telegramToolFailure,
} from "./telegram-account-effects";
import { TelegramAccountMcpServer, type TelegramAccountMcpTools } from "./telegram-account-mcp-server";
import { TelegramSignIn, type TelegramSignInState, telegramCredentialsRejected } from "./telegram-account-sign-in";

const logger = createOpenBotLogger("telegram-account-connector");

/** Telegram takes files up to 2 GB from an account without Premium. */
const MAX_SEND_BYTES = 2000 * 1024 * 1024;

/** Whether `path` is `directory` or a path in it. */
function inside(directory: string, path: string): boolean {
  const rest = relative(directory, path);
  return rest === "" || (!rest.startsWith(`..${sep}`) && rest !== ".." && !isAbsolute(rest));
}

/**
 * The real path of a file that an agent asks to send. It must be an absolute path to a regular file
 * of at most 2 GB, outside OpenBot's data (`folders.protected`) and outside the hidden folders of the
 * home folder (`~/.ssh`, `~/.config` and the like), which keep keys and sessions.
 */
export const telegramFileToSend = Effect.fn("telegramFileToSend")(function* (
  path: string,
  folders: { protected: string; home: string },
): Effect.fn.Return<string, TelegramAccountOperationError> {
  if (!isAbsolute(path))
    return yield* telegramToolFailure(`"${path}" is not an absolute path. Give the full path of the file.`);
  const real = yield* telegramAccountCall(() => realpath(path)).pipe(
    Effect.mapError(() => telegramToolFailure(`No file at ${path}.`)),
  );
  const info = yield* telegramAccountCall(() => stat(real));
  if (!info.isFile()) return yield* telegramToolFailure(`${path} is not a file.`);
  if (info.size === 0) return yield* telegramToolFailure(`${path} is empty.`);
  if (info.size > MAX_SEND_BYTES) return yield* telegramToolFailure(`${path} is larger than 2 GB.`);
  const own = yield* telegramAccountCall(() => realpath(folders.protected)).pipe(
    Effect.orElseSucceed(() => folders.protected),
  );
  const home = yield* telegramAccountCall(() => realpath(folders.home)).pipe(Effect.orElseSucceed(() => folders.home));
  const inHome = inside(home, real) ? relative(home, real) : null;
  if (inside(own, real) || inHome?.startsWith("."))
    return yield* telegramToolFailure(
      `${path} is in a folder that keeps keys or sessions. Telegram does not send files from it.`,
    );
  return real;
});

/** Telegram may not answer a sign-out at all; the local session goes either way. */
const LOG_OUT_TIMEOUT = Duration.seconds(15);

const NOT_CONNECTED_FOR_AGENT =
  "Telegram is not connected. Ask the user to connect their Telegram account in OpenBot (Marketplace > Apps > Telegram account).";
const SESSION_ENDED_FOR_AGENT =
  "Telegram ended this session, for example in Telegram > Settings > Devices. Ask the user to connect their Telegram account again in OpenBot.";
const SENDING_OFF_FOR_AGENT =
  "Sending is turned off for this Telegram connection. The user can turn it on in OpenBot (Marketplace > Apps > Telegram account).";

export interface TelegramAccountConnectorServiceOptions {
  store: TelegramAccountConnectorStore;
  appVersion: string;
  /** Where downloaded media goes, one folder per chat. */
  mediaDirectory: string;
  /** OpenBot's own data. A file in it is never sent, so an agent cannot send a session or a key. */
  protectedDirectory: string;
  /** Creates a GramJS client. A test passes a fake; the default loads GramJS at its first use. */
  createClient?: (
    options: TelegramAccountClientOptions,
  ) => Effect.Effect<TelegramAccountClient, TelegramAccountOperationError>;
}

/** Loads GramJS with the client module, at the first sign-in or the first use of a stored session. */
function createGramClient(
  options: TelegramAccountClientOptions,
): Effect.Effect<TelegramAccountClient, TelegramAccountOperationError> {
  return telegramAccountCall(() => import("./telegram-account-client")).pipe(
    Effect.flatMap((module) => telegramAccountDecode(() => new module.TelegramAccountClient(options))),
  );
}

/** Whether `record` holds a signed-in session. */
function signedIn(
  record: TelegramAccountConnectorRecord | null,
): record is TelegramAccountConnectorRecord & { account: TelegramAccountRecordAccount } {
  return record !== null && record.session !== "" && record.account !== null;
}

/** The phone number with its middle hidden, for anything that leaves the main process. */
function maskTelegramPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/gu, "");
  if (digits.length < 7) return "+***";
  return `+${digits.slice(0, 4)}***${digits.slice(-3)}`;
}

function statusAccount(account: TelegramAccountRecordAccount): TelegramAccount {
  const name = [account.firstName, account.lastName].filter(Boolean).join(" ") || account.username || "Telegram";
  return { name, username: account.username, phone: maskTelegramPhone(account.phone) };
}

function sessionEnded(failure: TelegramAccountOperationError): boolean {
  return TELEGRAM_SESSION_ENDED.has(telegramErrorMessage(failure.cause));
}

/** The record with no session: the API credentials stay, so a new sign-in does not ask for them. */
function signedOut(record: TelegramAccountConnectorRecord): TelegramAccountConnectorRecord {
  return { ...record, session: "", account: null, sendingEnabled: false, connectedAt: null };
}

/**
 * Owns the Telegram account connection: the sign-in, the stored session, the client that uses it, and
 * the loopback MCP server that gives agents its tools. It never imports the agent service. The agent
 * service reads `mcpServer` and `mcpAuthorization`, and `onAgentAccessChanged` tells it when that
 * answer changes.
 *
 * The session string grants full access to the account. It never leaves the main process except to
 * Telegram, and it is registered for redaction before it is used, as are the api_hash, each value
 * of a sign-in and the bearer of the MCP server. A sign-in never creates a Telegram account.
 */
export class TelegramAccountConnectorService {
  readonly #store: TelegramAccountConnectorStore;
  readonly #appVersion: string;
  readonly #mediaDirectory: string;
  readonly #protectedDirectory: string;
  readonly #createClient: NonNullable<TelegramAccountConnectorServiceOptions["createClient"]>;
  /** Owns the sign-in runs and the session check that runs in the background. */
  readonly #scope = Scope.makeUnsafe();
  readonly #statusListeners = new Set<(status: TelegramAccountConnectorStatus) => void>();
  readonly #accessListeners = new Set<() => void>();
  #signIn: TelegramSignIn<TelegramAccountClient> | null = null;
  /** The last failure outside a sign-in in progress, as a sentence. */
  #error: string | null = null;
  /** The client of the stored session, and that session, while it is open. */
  #active: { client: TelegramAccountClient; session: string } | null = null;
  #opening: Deferred.Deferred<TelegramAccountClient, TelegramAccountOperationError> | null = null;
  /** Null when the loopback server could not start: agents then get no Telegram tools. */
  #mcp: TelegramAccountMcpServer | null = null;
  /** Generated at the first start, then kept in the record. */
  #mcpSecret = randomBytes(32).toString("base64url");
  /** What agents were last told, so a change that does not alter it replaces no session. */
  #agentAccess = false;
  #disposed = false;

  constructor(options: TelegramAccountConnectorServiceOptions) {
    this.#store = options.store;
    this.#appVersion = options.appVersion;
    this.#mediaDirectory = options.mediaDirectory;
    this.#protectedDirectory = options.protectedDirectory;
    this.#createClient = options.createClient ?? createGramClient;
    registerSecretValue(this.#mcpSecret);
  }

  /**
   * Reads the stored connection and starts the loopback MCP server. Call once, before an agent
   * starts. A file that cannot be read is logged and treated as no connection. A stored session is
   * checked with Telegram in the background; the app does not wait for it.
   */
  readonly load = Effect.fn("TelegramAccountConnector.load")(function* (
    this: TelegramAccountConnectorService,
  ): Effect.fn.Return<void> {
    const error = yield* this.#store.load();
    if (error) logger.warn("The Telegram account connection file could not be read.", { cause: toLogValue(error) });
    yield* this.#startMcpServer(this.#store.read());
    this.#agentAccess = this.mcpServer() !== null;
    if (!signedIn(this.#store.read())) return;
    yield* Effect.forkIn(
      this.#client().pipe(
        Effect.catch(({ cause }) =>
          Effect.sync(() => {
            logger.warn("The stored Telegram session could not be checked.", {
              reason: redactText(telegramErrorMessage(cause)),
            });
          }),
        ),
      ),
      this.#scope,
    );
  }).bind(this);

  status(): TelegramAccountConnectorStatus {
    const record = this.#store.read();
    const signIn = this.#signIn;
    if (signIn && !signIn.ended) return this.#signInStatus(signIn.state, record);
    if (signedIn(record)) {
      return {
        ...DISCONNECTED_TELEGRAM_ACCOUNT_CONNECTOR,
        state: "connected",
        account: statusAccount(record.account),
        sendingEnabled: record.sendingEnabled,
        error: this.#error,
      };
    }
    return { ...DISCONNECTED_TELEGRAM_ACCOUNT_CONNECTOR, error: this.#error };
  }

  onChanged(listener: (status: TelegramAccountConnectorStatus) => void): () => void {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  /** Called when agents gain or lose the Telegram tools. */
  onAgentAccessChanged(listener: () => void): () => void {
    this.#accessListeners.add(listener);
    return () => this.#accessListeners.delete(listener);
  }

  /**
   * Starts a sign-in with `method`, or starts the one in progress again with it. New API credentials
   * replace the stored ones; with none, the stored ones are used. A computer that is already signed
   * in answers its status: the user disconnects first.
   */
  readonly connect = Effect.fn("TelegramAccountConnector.connect")(function* (
    this: TelegramAccountConnectorService,
    input: TelegramAccountConnectInput,
  ): Effect.fn.Return<TelegramAccountConnectorStatus> {
    if (input.apiHash && TELEGRAM_ACCOUNT_API_HASH_PATTERN.test(input.apiHash)) registerSecretValue(input.apiHash);
    if (this.#disposed) return this.status();
    // A sign-in that Telegram accepted is saved first: the record below must not replace it.
    if (this.#signIn) yield* this.#signIn.settled();
    const record = this.#store.read();
    if (signedIn(record)) return this.status();
    const given = input.apiId !== null || input.apiHash !== null;
    if (
      given &&
      !(
        input.apiId !== null &&
        Number.isSafeInteger(input.apiId) &&
        input.apiId > 0 &&
        input.apiId <= TELEGRAM_MAX_API_ID &&
        input.apiHash !== null &&
        TELEGRAM_ACCOUNT_API_HASH_PATTERN.test(input.apiHash)
      )
    ) {
      return this.#fail(sourceText("error.connector.telegramAccountCredentialsInvalid"));
    }
    const apiId = given ? input.apiId : (record?.apiId ?? null);
    const apiHash = given ? input.apiHash : (record?.apiHash ?? null);
    if (apiId === null || apiHash === null)
      return this.#fail(sourceText("error.connector.telegramAccountCredentialsMissing"));
    if (!record || record.apiId !== apiId || record.apiHash !== apiHash) {
      const saved = yield* Effect.result(
        this.#store.update((current) => ({
          apiId,
          apiHash,
          session: "",
          account: null,
          sendingEnabled: false,
          connectedAt: null,
          mcpServer: current?.mcpServer ?? this.#mcpSettings(),
        })),
      );
      if (Result.isFailure(saved)) return this.#fail(this.#saveFailure(saved.failure.cause));
    }
    this.#error = null;
    const signIn = this.#signIn && !this.#signIn.ended ? this.#signIn : this.#newSignIn();
    this.#signIn = signIn;
    yield* signIn.start(input.method);
    return this.status();
  }).bind(this);

  /** Gives the sign-in in progress the value that its step asks for. */
  submit(input: TelegramAccountSubmitInput): TelegramAccountConnectorStatus {
    registerSubmittedValue(input);
    const signIn = this.#signIn;
    if (!signIn || signIn.ended) {
      this.#error = sourceText("error.connector.telegramAccountMovedOn");
      this.#emitStatus();
      return this.status();
    }
    signIn.submit(input.field, input.value);
    return this.status();
  }

  /** Stops the sign-in in progress. One that Telegram has already accepted finishes and stays. */
  readonly cancel = Effect.fn("TelegramAccountConnector.cancel")(function* (
    this: TelegramAccountConnectorService,
  ): Effect.fn.Return<TelegramAccountConnectorStatus> {
    const signIn = this.#signIn;
    if (signIn && !signIn.ended) yield* signIn.cancel(null);
    this.#error = null;
    this.#emitStatus();
    return this.status();
  }).bind(this);

  /**
   * Signs this connection out of Telegram, so it disappears from Settings > Devices, and forgets the
   * session here. Telegram may not answer; the local session goes either way. The API credentials
   * stay, and sending is turned off.
   */
  readonly disconnect = Effect.fn("TelegramAccountConnector.disconnect")(function* (
    this: TelegramAccountConnectorService,
  ): Effect.fn.Return<TelegramAccountConnectorStatus, TelegramAccountOperationError> {
    // A sign-in that Telegram already accepted finishes saving first, then is signed out below.
    const signIn = this.#signIn;
    if (signIn) yield* signIn.cancel(null);
    this.#signIn = null;
    if (signedIn(this.#store.read())) {
      const loggedOut = yield* this.#client().pipe(
        Effect.flatMap((client) => client.logOut()),
        Effect.timeoutOption(LOG_OUT_TIMEOUT),
        Effect.result,
      );
      if (Result.isFailure(loggedOut) || Option.isNone(loggedOut.success)) {
        const reason = Result.isFailure(loggedOut) ? telegramErrorMessage(loggedOut.failure.cause) : "timeout";
        logger.warn("Telegram did not confirm the sign-out. The local session is removed anyway.", {
          reason: redactText(reason),
        });
      }
    }
    yield* this.#closeActive();
    yield* this.#store.update((record) => (record ? signedOut(record) : null));
    this.#error = null;
    this.#emitStatus();
    this.#agentAccessChanged();
    return this.status();
  }).bind(this);

  /** Lets agents send messages and mark chats as read, or stops them. */
  readonly setSending = Effect.fn("TelegramAccountConnector.setSending")(function* (
    this: TelegramAccountConnectorService,
    enabled: boolean,
  ): Effect.fn.Return<TelegramAccountConnectorStatus, TelegramAccountOperationError> {
    if (!signedIn(this.#store.read())) return this.status();
    yield* this.#store.update((record) => (record ? { ...record, sendingEnabled: enabled } : null));
    this.#emitStatus();
    return this.status();
  }).bind(this);

  /** The Telegram MCP server that agents are given, or null while the account is not connected. */
  mcpServer(): McpServerConfig | null {
    const url = this.#mcp?.url() ?? null;
    if (!url || !signedIn(this.#store.read())) return null;
    return {
      id: TELEGRAM_ACCOUNT_MCP_SERVER_ID,
      name: TELEGRAM_ACCOUNT_MCP_SERVER_NAME,
      transport: "http",
      enabled: true,
      command: "",
      args: [],
      env: [],
      envPassthrough: [],
      workingDirectory: "",
      url,
      headers: [],
    };
  }

  /** The bearer that agents send to the Telegram MCP server, or null while it is not given. */
  mcpAuthorization(): Effect.Effect<string | null> {
    return Effect.sync(() => (this.mcpServer() ? this.#mcpSecret : null));
  }

  /** Stops the sign-in, the session check, the client and the MCP server. The stored session stays. */
  readonly dispose = Effect.fn("TelegramAccountConnector.dispose")(function* (
    this: TelegramAccountConnectorService,
  ): Effect.fn.Return<void> {
    this.#disposed = true;
    this.#statusListeners.clear();
    this.#accessListeners.clear();
    const signIn = this.#signIn;
    this.#signIn = null;
    if (signIn) yield* signIn.dispose();
    yield* Scope.close(this.#scope, Exit.void);
    yield* this.#closeActive();
    const mcp = this.#mcp;
    this.#mcp = null;
    if (mcp) yield* mcp.stop();
  }).bind(this);

  // --- sign-in ---------------------------------------------------------------------------------

  #newSignIn(): TelegramSignIn<TelegramAccountClient> {
    return new TelegramSignIn<TelegramAccountClient>({
      scope: this.#scope,
      createClient: () =>
        Effect.suspend(() => {
          const record = this.#store.read();
          if (!record)
            return Effect.fail(telegramToolFailure(sourceText("error.connector.telegramAccountCredentialsMissing")));
          return this.#createClient({
            credentials: { apiId: record.apiId, apiHash: record.apiHash },
            session: "",
            appVersion: this.#appVersion,
          });
        }),
      onSuccess: (client, session, account) => this.#signedIn(client, session, account),
      onChange: (state) => this.#signInChanged(state),
    });
  }

  /** Stores the new session and starts to use its client. */
  readonly #signedIn = Effect.fn("TelegramAccountConnector.signedIn")(function* (
    this: TelegramAccountConnectorService,
    client: TelegramAccountClient,
    session: string,
    account: TelegramAccountRecordAccount,
  ): Effect.fn.Return<void, TelegramAccountOperationError> {
    const record = yield* this.#store.update((current) =>
      current
        ? { ...current, session, account, connectedAt: Date.now(), mcpServer: current.mcpServer ?? this.#mcpSettings() }
        : null,
    );
    if (!record) return yield* telegramToolFailure(sourceText("error.connector.telegramAccountCredentialsMissing"));
    const previous = this.#active;
    this.#active = { client, session };
    this.#error = null;
    if (previous && previous.client !== client) yield* previous.client.destroy();
    logger.info("Signed in to Telegram.");
    this.#agentAccessChanged();
  });

  #signInChanged(state: TelegramSignInState): void {
    if (state.step === "failed" || state.step === "cancelled") {
      this.#error = state.error;
      if (state.reason)
        logger.warn("The Telegram sign-in ended without a session.", { reason: redactText(state.reason) });
      // Telegram refused the api_id and api_hash, so the next sign-in asks for them again.
      if (telegramCredentialsRejected(state.reason)) {
        Effect.runFork(
          this.#store
            .update((record) => (record && !signedIn(record) ? null : record))
            .pipe(Effect.ignore, Effect.andThen(Effect.sync(() => this.#emitStatus()))),
        );
      }
    }
    if (state.step === "done") this.#error = null;
    this.#emitStatus();
  }

  #signInStatus(
    state: TelegramSignInState,
    record: TelegramAccountConnectorRecord | null,
  ): TelegramAccountConnectorStatus {
    let step: TelegramAccountConnectorState = "connecting";
    if (
      !state.busy &&
      (state.step === "qr" || state.step === "phone" || state.step === "code" || state.step === "password")
    )
      step = state.step;
    return {
      ...DISCONNECTED_TELEGRAM_ACCOUNT_CONNECTOR,
      state: step,
      method: state.method,
      qrUrl: step === "qr" ? state.qrUrl : null,
      qrExpiresAt: step === "qr" ? state.qrExpiresAt : null,
      codeViaApp: step === "code" ? state.codeViaApp : null,
      passwordHint: step === "password" ? state.passwordHint : null,
      sendingEnabled: record?.sendingEnabled ?? false,
      error: state.error,
    };
  }

  #fail(error: string): TelegramAccountConnectorStatus {
    this.#error = error;
    this.#emitStatus();
    return this.status();
  }

  #saveFailure(cause: unknown): string {
    return sourceText("error.connector.telegramAccountSaveFailed", {
      detail: redactText(telegramErrorMessage(cause)),
    });
  }

  // --- the session -----------------------------------------------------------------------------

  /** The connected client of the stored session. Opens that share one start share its answer. */
  readonly #client = Effect.fn("TelegramAccountConnector.client")(function* (
    this: TelegramAccountConnectorService,
  ): Effect.fn.Return<TelegramAccountClient, TelegramAccountOperationError> {
    const record = this.#store.read();
    if (this.#active) {
      if (signedIn(record) && record.session === this.#active.session) return this.#active.client;
      // The stored session changed or was removed: this client must not keep reading the account.
      const stale = this.#active;
      this.#active = null;
      yield* stale.client.destroy();
    }
    if (this.#opening) return yield* Deferred.await(this.#opening);
    if (!signedIn(record) || this.#disposed) return yield* telegramToolFailure(NOT_CONNECTED_FOR_AGENT);
    const session = record.session;
    const opening = Deferred.makeUnsafe<TelegramAccountClient, TelegramAccountOperationError>();
    this.#opening = opening;
    return yield* this.#open(record, session).pipe(
      Effect.onExit((exit) => Deferred.done(opening, exit)),
      Effect.ensuring(
        Effect.sync(() => {
          if (this.#opening === opening) this.#opening = null;
        }),
      ),
    );
  });

  readonly #open = Effect.fn("TelegramAccountConnector.open")(function* (
    this: TelegramAccountConnectorService,
    record: TelegramAccountConnectorRecord,
    session: string,
  ): Effect.fn.Return<TelegramAccountClient, TelegramAccountOperationError> {
    const client = yield* this.#createClient({
      credentials: { apiId: record.apiId, apiHash: record.apiHash },
      session,
      appVersion: this.#appVersion,
    });
    const opened = yield* Effect.result(client.connect().pipe(Effect.andThen(client.checkSession())));
    if (Result.isFailure(opened)) {
      yield* client.destroy();
      if (!sessionEnded(opened.failure)) return yield* opened.failure;
      yield* this.#forgetSession(session);
      return yield* telegramToolFailure(SESSION_ENDED_FOR_AGENT);
    }
    // A sign-out or a new sign-in while this one opened: this session is no longer the one in use.
    if (this.#store.read()?.session !== session || this.#disposed) {
      yield* client.destroy();
      return yield* telegramToolFailure(NOT_CONNECTED_FOR_AGENT);
    }
    this.#active = { client, session };
    return client;
  });

  /**
   * Telegram ended `session`, in Settings > Devices or by a sign-out elsewhere. Drops its client, and
   * the stored session only while it is still that one: a newer sign-in stays.
   */
  readonly #forgetSession = Effect.fn("TelegramAccountConnector.forgetSession")(function* (
    this: TelegramAccountConnectorService,
    session: string,
  ): Effect.fn.Return<void> {
    const active = this.#active;
    if (active?.session === session) {
      this.#active = null;
      yield* active.client.destroy();
    }
    const changed = yield* this.#store
      .update((record) => (record && record.session === session ? signedOut(record) : record))
      .pipe(
        Effect.map((record) => record !== null && record.session === ""),
        Effect.catch(({ cause }) =>
          Effect.sync(() => {
            logger.warn("The ended Telegram session could not be removed.", { cause: toLogValue(cause) });
            return false;
          }),
        ),
      );
    if (!changed) return;
    logger.warn("Telegram ended the session of the Telegram account connection.");
    this.#error = sourceText("error.connector.telegramAccountSessionEnded");
    this.#emitStatus();
    this.#agentAccessChanged();
  });

  #closeActive(): Effect.Effect<void> {
    return Effect.suspend(() => {
      const active = this.#active;
      this.#active = null;
      return active ? active.client.destroy() : Effect.void;
    });
  }

  /** Runs `call` on the client. A session that Telegram ended is forgotten, and the agent is told. */
  #withClient<A>(
    call: (client: TelegramAccountClient) => Effect.Effect<A, TelegramAccountOperationError>,
  ): Effect.Effect<A, TelegramAccountOperationError> {
    return Effect.gen({ self: this }, function* () {
      const client = yield* this.#client();
      const session = this.#active?.session ?? null;
      return yield* call(client).pipe(
        Effect.catch((failure) =>
          sessionEnded(failure) && session !== null
            ? this.#forgetSession(session).pipe(
                Effect.andThen(Effect.fail(telegramToolFailure(SESSION_ENDED_FOR_AGENT))),
              )
            : Effect.fail(failure),
        ),
      );
    });
  }

  #requireSending(): Effect.Effect<void, TelegramAccountOperationError> {
    return Effect.suspend(() =>
      this.#store.read()?.sendingEnabled ? Effect.void : Effect.fail(telegramToolFailure(SENDING_OFF_FOR_AGENT)),
    );
  }

  /** The tools of the MCP server. Sending and marking as read check the user's switch at each call. */
  #tools(): TelegramAccountMcpTools {
    return {
      listChats: (options) =>
        this.#withClient((client) => client.listChats(options)).pipe(
          Effect.map((chats) => ({ count: chats.length, chats })),
        ),
      readMessages: (options) => this.#withClient((client) => client.readMessages(options)),
      searchMessages: (options) => this.#withClient((client) => client.searchMessages(options)),
      sendMessage: (options) =>
        this.#requireSending().pipe(
          Effect.andThen(
            this.#withClient((client) => this.#requireSending().pipe(Effect.andThen(client.sendMessage(options)))),
          ),
          Effect.tap((sent) =>
            Effect.sync(() => {
              logger.info("An agent sent a Telegram message.", { chat: sent.chat.id, message: sent.message.id });
            }),
          ),
        ),
      downloadMedia: (options) =>
        this.#withClient((client) => client.downloadMedia({ ...options, directory: this.#mediaDirectory })),
      sendFile: (options) =>
        this.#requireSending().pipe(
          Effect.andThen(telegramFileToSend(options.path, { protected: this.#protectedDirectory, home: homedir() })),
          Effect.flatMap((path) =>
            this.#withClient((client) =>
              this.#requireSending().pipe(Effect.andThen(client.sendFile({ ...options, path }))),
            ),
          ),
          Effect.tap((sent) =>
            Effect.sync(() => {
              logger.info("An agent sent a Telegram file.", { chat: sent.chat.id, message: sent.message.id });
            }),
          ),
        ),
      markRead: (chat) =>
        this.#requireSending().pipe(
          Effect.andThen(
            this.#withClient((client) => this.#requireSending().pipe(Effect.andThen(client.markRead(chat)))),
          ),
        ),
    };
  }

  // --- the MCP server --------------------------------------------------------------------------

  /**
   * Starts the loopback MCP server on the port it had, so that a resumed session finds it. A server
   * that cannot start is logged: agents then get no Telegram tools.
   */
  readonly #startMcpServer = Effect.fn("TelegramAccountConnector.startMcpServer")(function* (
    this: TelegramAccountConnectorService,
    record: TelegramAccountConnectorRecord | null,
  ): Effect.fn.Return<void> {
    if (record?.mcpServer) {
      this.#mcpSecret = record.mcpServer.secret;
      registerSecretValue(this.#mcpSecret);
    }
    const server = new TelegramAccountMcpServer({
      secret: () => this.#mcpSecret,
      tools: this.#tools(),
      version: this.#appVersion,
    });
    const started = yield* Effect.result(server.start(record?.mcpServer?.port ?? null));
    if (Result.isFailure(started)) {
      logger.warn("The Telegram MCP server of this computer did not start.", {
        cause: toLogValue(started.failure.cause),
      });
      return;
    }
    this.#mcp = server;
    if (!record || record.mcpServer?.port === started.success) return;
    if (record.mcpServer) {
      // Resumed sessions send the old secret to the old port, where another program now listens.
      this.#mcpSecret = randomBytes(32).toString("base64url");
      registerSecretValue(this.#mcpSecret);
    }
    yield* this.#store
      .update((current) => (current ? { ...current, mcpServer: this.#mcpSettings() } : null))
      .pipe(
        Effect.catch(({ cause }) =>
          Effect.sync(() => {
            logger.warn("The Telegram MCP server port could not be saved.", { cause: toLogValue(cause) });
          }),
        ),
      );
  });

  #mcpSettings(): TelegramAccountConnectorRecord["mcpServer"] {
    const port = this.#mcp?.port() ?? null;
    return port ? { port, secret: this.#mcpSecret } : null;
  }

  #agentAccessChanged(): void {
    const access = this.mcpServer() !== null;
    if (access === this.#agentAccess) return;
    this.#agentAccess = access;
    for (const listener of this.#accessListeners) listener();
  }

  #emitStatus(): void {
    const status = this.status();
    for (const listener of this.#statusListeners) listener(status);
  }
}
