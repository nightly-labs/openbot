// The WhatsApp account connection of this computer: OpenBot links itself to the user's own WhatsApp
// account as a linked device, as WhatsApp Web does, so agents can read the user's chats and, when the
// user turns sending on, send messages as the user.

import { randomBytes } from "node:crypto";
import {
  DISCONNECTED_WHATSAPP_ACCOUNT_CONNECTOR,
  type McpServerConfig,
  WHATSAPP_ACCOUNT_MCP_SERVER_ID,
  WHATSAPP_ACCOUNT_MCP_SERVER_NAME,
  type WhatsAppAccountConnectInput,
  type WhatsAppAccountConnectorStatus,
  type WhatsAppAccountLinkMethod,
  type WhatsAppAccountSubmitInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText, registerSecretValue, toLogValue } from "@openbot/logging";
import { Duration, Effect, Option, Result } from "effect";
import type {
  WhatsAppAccountClient,
  WhatsAppAccountClientEvents,
  WhatsAppStopReason,
  WhatsAppStoredAuth,
} from "./whatsapp-account-client";
import type {
  WhatsAppAccountConnectorRecord,
  WhatsAppAccountConnectorStore,
  WhatsAppAccountRecordAccount,
} from "./whatsapp-account-connector-store";
import type { WhatsAppDataFile } from "./whatsapp-account-data-file";
import {
  maskPhoneNumber,
  phoneDigits,
  registerPhoneNumber,
  type WhatsAppAccountOperationError,
  whatsappAccountCall,
  whatsappErrorMessage,
  whatsappToolFailure,
} from "./whatsapp-account-effects";
import { jidPhone, WhatsAppHistory, type WhatsAppStoredChat } from "./whatsapp-account-history";
import { WhatsAppAccountMcpServer, type WhatsAppAccountMcpTools } from "./whatsapp-account-mcp-server";

const logger = createOpenBotLogger("whatsapp-account-connector");

/** WhatsApp may not answer a log-out at all; the local keys go either way. */
const LOG_OUT_TIMEOUT = Duration.seconds(15);
/** A link with no progress stops, so a forgotten QR code does not keep a socket open. */
const LINK_TIMEOUT_MS = 10 * 60 * 1000;
/** The first QR code is valid for 60 seconds, each later one for 20. */
const FIRST_QR_MS = 60_000;
const NEXT_QR_MS = 20_000;
/** How long a send or a mark-read waits for a connection that is coming back. */
const OPEN_WAIT_MS = 10_000;
/** How long a read waits for older messages from the phone. */
const OLDER_WAIT_MS = 8_000;
const OLDER_COUNT = 50;

const NOT_CONNECTED_FOR_AGENT =
  "WhatsApp is not connected. Ask the user to link their WhatsApp account in OpenBot (Marketplace > Apps > WhatsApp account).";
const SENDING_OFF_FOR_AGENT =
  "Sending is turned off for this WhatsApp connection. The user can turn it on in OpenBot (Marketplace > Apps > WhatsApp account).";
const OFFLINE_FOR_AGENT =
  "WhatsApp is not reachable from this computer now. OpenBot keeps trying. Reading the chats that this computer already has still works; try sending again later.";

/** The client module, loaded at the first link or the first use of a stored device. */
export interface WhatsAppClientModule {
  newWhatsAppAuth(): WhatsAppStoredAuth;
  readStoredAuth(value: unknown): WhatsAppStoredAuth | null;
  createClient(options: {
    auth: WhatsAppStoredAuth;
    history: WhatsAppHistory;
    appVersion: string;
    events: WhatsAppAccountClientEvents;
  }): WhatsAppClientLike;
}

/** The part of the client that the service uses. A test passes a fake. */
export type WhatsAppClientLike = Pick<
  WhatsAppAccountClient,
  | "start"
  | "whenOpen"
  | "isOpen"
  | "requestPairingCode"
  | "lookUp"
  | "sendText"
  | "markRead"
  | "fetchOlder"
  | "logOut"
  | "destroy"
>;

function loadBaileysClient(): Effect.Effect<WhatsAppClientModule, WhatsAppAccountOperationError> {
  return whatsappAccountCall(() => import("./whatsapp-account-client")).pipe(
    Effect.map((module) => ({
      newWhatsAppAuth: module.newWhatsAppAuth,
      readStoredAuth: module.readWhatsAppStoredAuth,
      createClient: (options) => new module.WhatsAppAccountClient(options),
    })),
  );
}

export interface WhatsAppAccountConnectorServiceOptions {
  store: WhatsAppAccountConnectorStore;
  /** The keys of the linked device. */
  authFile: WhatsAppDataFile;
  /** The chats and messages that WhatsApp sent to this device. */
  historyFile: WhatsAppDataFile;
  appVersion: string;
  /** Loads the client module. A test passes a fake; the default loads Baileys at its first use. */
  loadClient?: () => Effect.Effect<WhatsAppClientModule, WhatsAppAccountOperationError>;
}

/** Where the events of one client go. A client that finishes a link keeps running as the device. */
interface EventRoute {
  events: WhatsAppAccountClientEvents;
}

function routedEvents(route: EventRoute): WhatsAppAccountClientEvents {
  return {
    qr: (code) => route.events.qr(code),
    open: (account) => route.events.open(account),
    offline: () => route.events.offline(),
    stopped: (reason, detail) => route.events.stopped(reason, detail),
    authChanged: () => route.events.authChanged(),
  };
}

/** A link in progress. A new link, a cancel or a failure replaces it, so old events are ignored. */
interface Link {
  method: WhatsAppAccountLinkMethod;
  client: WhatsAppClientLike;
  route: EventRoute;
  auth: WhatsAppStoredAuth;
  history: WhatsAppHistory;
  step: "connecting" | "qr" | "phone" | "code";
  qrCode: string | null;
  qrExpiresAt: number | null;
  /** WhatsApp sent a first QR code: it now takes a request for a pairing code. */
  ready: boolean;
  pendingPhone: string | null;
  pairingCode: string | null;
  timer: ReturnType<typeof setTimeout>;
}

/** The linked device: its keys, its chats and its client. The chats can be read while it is offline. */
interface Session {
  client: WhatsAppClientLike | null;
  auth: WhatsAppStoredAuth;
  history: WhatsAppHistory;
  online: boolean;
}

function linked(
  record: WhatsAppAccountConnectorRecord | null,
): record is WhatsAppAccountConnectorRecord & { account: WhatsAppAccountRecordAccount } {
  return record?.account != null;
}

/** The sentence that the user reads when the connection stops for `reason`. */
function stopMessage(reason: WhatsAppStopReason, detail: string): string {
  switch (reason) {
    case "logged-out":
      return sourceText("error.connector.whatsappAccountLoggedOut");
    case "qr-expired":
      return sourceText("error.connector.whatsappAccountQrExpired");
    case "replaced":
      return sourceText("error.connector.whatsappAccountReplaced");
    case "forbidden":
      return sourceText("error.connector.whatsappAccountForbidden");
    case "outdated":
      return sourceText("error.connector.whatsappAccountOutdated");
    case "link-failed":
      return sourceText("error.connector.whatsappAccountLinkFailed", { detail: detail || "-" });
  }
}

/**
 * Owns the WhatsApp account connection: the link, the stored keys and chats, the client that uses
 * them, and the loopback MCP server that gives agents its tools. It never imports the agent service.
 * The agent service reads `mcpServer` and `mcpAuthorization`, and `onAgentAccessChanged` tells it when
 * that answer changes.
 *
 * The keys of the linked device give full access to the account's messages. They never leave the
 * main process except to WhatsApp, encrypted as WhatsApp asks. The phone number of a link and the
 * bearer of the MCP server are registered for redaction before they are used.
 */
export class WhatsAppAccountConnectorService {
  readonly #store: WhatsAppAccountConnectorStore;
  readonly #authFile: WhatsAppDataFile;
  readonly #historyFile: WhatsAppDataFile;
  readonly #appVersion: string;
  readonly #loadClient: NonNullable<WhatsAppAccountConnectorServiceOptions["loadClient"]>;
  readonly #statusListeners = new Set<(status: WhatsAppAccountConnectorStatus) => void>();
  readonly #accessListeners = new Set<() => void>();
  #link: Link | null = null;
  #session: Session | null = null;
  /** The last failure outside a link in progress, as a sentence. */
  #error: string | null = null;
  #mcp: WhatsAppAccountMcpServer | null = null;
  #mcpSecret = randomBytes(32).toString("base64url");
  #agentAccess = false;
  #disposed = false;

  constructor(options: WhatsAppAccountConnectorServiceOptions) {
    this.#store = options.store;
    this.#authFile = options.authFile;
    this.#historyFile = options.historyFile;
    this.#appVersion = options.appVersion;
    this.#loadClient = options.loadClient ?? loadBaileysClient;
    registerSecretValue(this.#mcpSecret);
  }

  /**
   * Reads the stored connection and starts the loopback MCP server. Call once, before an agent
   * starts. A file that cannot be read is logged and treated as no connection. A linked device
   * connects to WhatsApp in the background; the app does not wait for it.
   */
  readonly load = Effect.fn("WhatsAppAccountConnector.load")(function* (
    this: WhatsAppAccountConnectorService,
  ): Effect.fn.Return<void> {
    const error = yield* this.#store.load();
    if (error) logger.warn("The WhatsApp account connection file could not be read.", { cause: toLogValue(error) });
    yield* this.#startMcpServer(this.#store.read());
    const record = this.#store.read();
    if (linked(record)) yield* this.#openSession(record);
    this.#agentAccess = this.mcpServer() !== null;
  }).bind(this);

  status(): WhatsAppAccountConnectorStatus {
    const link = this.#link;
    const record = this.#store.read();
    if (link) {
      return {
        ...DISCONNECTED_WHATSAPP_ACCOUNT_CONNECTOR,
        state: link.step,
        method: link.method,
        qrCode: link.step === "qr" ? link.qrCode : null,
        qrExpiresAt: link.step === "qr" ? link.qrExpiresAt : null,
        pairingCode: link.step === "code" ? link.pairingCode : null,
        sendingEnabled: record?.sendingEnabled ?? false,
        error: this.#error,
      };
    }
    const session = this.#session;
    if (linked(record) && session) {
      const name = record.account.name || (record.account.phone ? `+${record.account.phone}` : "WhatsApp");
      return {
        ...DISCONNECTED_WHATSAPP_ACCOUNT_CONNECTOR,
        state: "connected",
        account: { name, phone: maskPhoneNumber(record.account.phone) },
        history: session.history.counts(),
        sendingEnabled: record.sendingEnabled,
        error: this.#error ?? (session.online ? null : sourceText("error.connector.whatsappAccountOffline")),
      };
    }
    return { ...DISCONNECTED_WHATSAPP_ACCOUNT_CONNECTOR, error: this.#error };
  }

  onChanged(listener: (status: WhatsAppAccountConnectorStatus) => void): () => void {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  /** Called when agents gain or lose the WhatsApp tools. */
  onAgentAccessChanged(listener: () => void): () => void {
    this.#accessListeners.add(listener);
    return () => this.#accessListeners.delete(listener);
  }

  /**
   * Starts a link with `method`, or starts the one in progress again with it. A computer that is
   * already linked answers its status: the user disconnects first.
   */
  readonly connect = Effect.fn("WhatsAppAccountConnector.connect")(function* (
    this: WhatsAppAccountConnectorService,
    input: WhatsAppAccountConnectInput,
  ): Effect.fn.Return<WhatsAppAccountConnectorStatus> {
    if (this.#disposed || linked(this.#store.read())) return this.status();
    const previous = this.#link;
    if (previous?.method === input.method) return this.status();
    this.#endLink();
    this.#error = null;
    const loaded = yield* Effect.result(this.#loadClient());
    if (Result.isFailure(loaded)) {
      logger.warn("The WhatsApp client could not be loaded.", { cause: toLogValue(loaded.failure.cause) });
      return this.#fail(
        sourceText("error.connector.whatsappAccountLinkFailed", {
          detail: redactText(whatsappErrorMessage(loaded.failure.cause)),
        }),
      );
    }
    if (this.#disposed || linked(this.#store.read()) || this.#link) return this.status();
    const module = loaded.success;
    const auth = module.newWhatsAppAuth();
    const history = new WhatsAppHistory();
    let link: Link | null = null;
    const route: EventRoute = {
      events: {
        qr: (code) => {
          if (link && this.#link === link) this.#linkQr(link, code);
        },
        open: (account) => {
          if (link && this.#link === link) void Effect.runPromise(this.#linked(link, account));
        },
        offline: () => {},
        stopped: (reason, detail) => {
          if (link && this.#link === link) this.#linkFailed(reason, detail);
        },
        // The keys stay in memory until WhatsApp accepts the device.
        authChanged: () => {},
      },
    };
    const client = module.createClient({ auth, history, appVersion: this.#appVersion, events: routedEvents(route) });
    link = {
      method: input.method,
      client,
      route,
      auth,
      history,
      step: "connecting",
      qrCode: null,
      qrExpiresAt: null,
      ready: false,
      pendingPhone: null,
      pairingCode: null,
      timer: setTimeout(() => {
        if (this.#link !== link) return;
        this.#endLink();
        this.#fail(sourceText("error.connector.whatsappAccountTimedOut"));
      }, LINK_TIMEOUT_MS),
    };
    this.#link = link;
    this.#emitStatus();
    const started = yield* Effect.result(whatsappAccountCall(() => client.start()));
    if (Result.isFailure(started) && this.#link === link) {
      this.#endLink();
      return this.#fail(
        sourceText("error.connector.whatsappAccountLinkFailed", {
          detail: redactText(whatsappErrorMessage(started.failure.cause)),
        }),
      );
    }
    return this.status();
  }).bind(this);

  /** Gives the link in progress the phone number for a link with a code. */
  readonly submit = Effect.fn("WhatsAppAccountConnector.submit")(function* (
    this: WhatsAppAccountConnectorService,
    input: WhatsAppAccountSubmitInput,
  ): Effect.fn.Return<WhatsAppAccountConnectorStatus> {
    const digits = phoneDigits(input.value);
    if (digits) registerPhoneNumber(digits);
    const link = this.#link;
    if (link?.method !== "phone" || link.step === "code") {
      return this.#fail(sourceText("error.connector.whatsappAccountMovedOn"));
    }
    if (!digits) return this.#fail(sourceText("error.connector.whatsappAccountPhoneFormat"));
    this.#error = null;
    link.pendingPhone = digits;
    link.step = "connecting";
    this.#emitStatus();
    if (link.ready) yield* this.#requestCode(link);
    return this.status();
  }).bind(this);

  /** Stops the link in progress. */
  cancel(): WhatsAppAccountConnectorStatus {
    this.#endLink();
    this.#error = null;
    this.#emitStatus();
    return this.status();
  }

  /**
   * Removes this device from the account, as Linked devices > Log out does on the phone, and deletes
   * its keys and chats here. WhatsApp may not answer; the local data goes either way. Sending turns
   * off.
   */
  readonly disconnect = Effect.fn("WhatsAppAccountConnector.disconnect")(function* (
    this: WhatsAppAccountConnectorService,
  ): Effect.fn.Return<WhatsAppAccountConnectorStatus, WhatsAppAccountOperationError> {
    this.#endLink();
    const session = this.#session;
    if (session?.client) {
      const client = session.client;
      const loggedOut = yield* Effect.result(
        whatsappAccountCall(async () => {
          if (!(await client.whenOpen(OPEN_WAIT_MS))) throw new Error("WhatsApp is not reachable.");
          await client.logOut();
        }).pipe(Effect.timeoutOption(LOG_OUT_TIMEOUT)),
      );
      if (Result.isFailure(loggedOut) || Option.isNone(loggedOut.success)) {
        const reason = Result.isFailure(loggedOut) ? whatsappErrorMessage(loggedOut.failure.cause) : "timeout";
        logger.warn("WhatsApp did not confirm the log-out. The local device is removed anyway.", {
          reason: redactText(reason),
        });
      }
    }
    yield* this.#forgetDevice();
    this.#error = null;
    this.#emitStatus();
    this.#agentAccessChanged();
    return this.status();
  }).bind(this);

  /** Lets agents send messages and mark chats as read, or stops them. */
  readonly setSending = Effect.fn("WhatsAppAccountConnector.setSending")(function* (
    this: WhatsAppAccountConnectorService,
    enabled: boolean,
  ): Effect.fn.Return<WhatsAppAccountConnectorStatus, WhatsAppAccountOperationError> {
    if (!linked(this.#store.read())) return this.status();
    yield* this.#store.update((record) => (record ? { ...record, sendingEnabled: enabled } : null));
    this.#emitStatus();
    return this.status();
  }).bind(this);

  /** The WhatsApp MCP server that agents are given, or null while the account is not linked. */
  mcpServer(): McpServerConfig | null {
    const url = this.#mcp?.url() ?? null;
    if (!url || !linked(this.#store.read()) || !this.#session) return null;
    return {
      id: WHATSAPP_ACCOUNT_MCP_SERVER_ID,
      name: WHATSAPP_ACCOUNT_MCP_SERVER_NAME,
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

  /** The bearer that agents send to the WhatsApp MCP server, or null while it is not given. */
  mcpAuthorization(): Effect.Effect<string | null> {
    return Effect.sync(() => (this.mcpServer() ? this.#mcpSecret : null));
  }

  /** Stops the link, the client and the MCP server, and writes pending changes. The device stays linked. */
  readonly dispose = Effect.fn("WhatsAppAccountConnector.dispose")(function* (
    this: WhatsAppAccountConnectorService,
  ): Effect.fn.Return<void> {
    this.#disposed = true;
    this.#statusListeners.clear();
    this.#accessListeners.clear();
    this.#endLink();
    this.#session?.client?.destroy();
    yield* this.#authFile.flush().pipe(Effect.ignore);
    yield* this.#historyFile.flush().pipe(Effect.ignore);
    const mcp = this.#mcp;
    this.#mcp = null;
    if (mcp) yield* mcp.stop();
  }).bind(this);

  // --- the link --------------------------------------------------------------------------------

  #linkQr(link: Link, code: string): void {
    if (link.method === "qr") {
      link.qrExpiresAt = Date.now() + (link.qrCode === null ? FIRST_QR_MS : NEXT_QR_MS);
      link.qrCode = code;
      link.step = "qr";
      this.#emitStatus();
      return;
    }
    // The link with a code: the first QR code means that WhatsApp takes a request for a code.
    if (link.ready) return;
    link.ready = true;
    if (link.pendingPhone) void Effect.runPromise(this.#requestCode(link));
    else {
      link.step = "phone";
      this.#emitStatus();
    }
  }

  readonly #requestCode = Effect.fn("WhatsAppAccountConnector.requestCode")(function* (
    this: WhatsAppAccountConnectorService,
    link: Link,
  ): Effect.fn.Return<void> {
    const phone = link.pendingPhone;
    if (!phone) return;
    const code = yield* Effect.result(whatsappAccountCall(() => link.client.requestPairingCode(phone)));
    if (this.#link !== link) return;
    if (Result.isFailure(code)) {
      logger.warn("WhatsApp did not give a pairing code.", {
        reason: redactText(whatsappErrorMessage(code.failure.cause)),
      });
      link.pendingPhone = null;
      link.step = "phone";
      this.#error = sourceText("error.connector.whatsappAccountPairingFailed", {
        detail: redactText(whatsappErrorMessage(code.failure.cause)),
      });
      this.#emitStatus();
      return;
    }
    // The code links the device: it is masked in every log line, as the number is.
    registerSecretValue(code.success.replace("-", ""), { allowShort: true });
    link.pairingCode = code.success;
    link.step = "code";
    this.#error = null;
    this.#emitStatus();
  });

  /** WhatsApp accepted the new device: stores its keys and starts to use it. */
  readonly #linked = Effect.fn("WhatsAppAccountConnector.linked")(function* (
    this: WhatsAppAccountConnectorService,
    link: Link,
    account: { id: string; name: string },
  ): Effect.fn.Return<void> {
    clearTimeout(link.timer);
    this.#link = null;
    const phone = jidPhone(account.id);
    if (phone) registerPhoneNumber(phone);
    const session: Session = { client: link.client, auth: link.auth, history: link.history, online: true };
    link.route.events = this.#sessionEvents(session);
    link.history.setOwnId(account.id || null);
    this.#attachSession(session);
    const saved = yield* Effect.result(
      Effect.gen({ self: this }, function* () {
        this.#authFile.schedule(() => session.auth);
        yield* this.#authFile.flush();
        yield* this.#store.update((current) => ({
          account: { id: account.id, name: account.name, phone },
          sendingEnabled: false,
          connectedAt: Date.now(),
          mcpServer: current?.mcpServer ?? this.#mcpSettings(),
        }));
      }),
    );
    if (Result.isFailure(saved)) {
      // A device that this computer cannot keep must not stay linked to the account.
      logger.warn("The linked WhatsApp device could not be saved.", { cause: toLogValue(saved.failure.cause) });
      yield* whatsappAccountCall(() => link.client.logOut()).pipe(Effect.timeoutOption(LOG_OUT_TIMEOUT), Effect.ignore);
      yield* this.#forgetDevice().pipe(Effect.ignore);
      this.#fail(
        sourceText("error.connector.whatsappAccountSaveFailed", {
          detail: redactText(whatsappErrorMessage(saved.failure.cause)),
        }),
      );
      return;
    }
    this.#error = null;
    logger.info("Linked to WhatsApp.");
    this.#emitStatus();
    this.#agentAccessChanged();
  });

  #linkFailed(reason: WhatsAppStopReason, detail: string): void {
    this.#endLink();
    this.#fail(stopMessage(reason, detail));
  }

  #endLink(): void {
    const link = this.#link;
    this.#link = null;
    if (!link) return;
    clearTimeout(link.timer);
    link.client.destroy();
  }

  // --- the linked device -----------------------------------------------------------------------

  /** Reads the stored keys and chats and connects in the background. */
  readonly #openSession = Effect.fn("WhatsAppAccountConnector.openSession")(function* (
    this: WhatsAppAccountConnectorService,
    record: WhatsAppAccountConnectorRecord & { account: WhatsAppAccountRecordAccount },
  ): Effect.fn.Return<void> {
    const module = yield* Effect.result(this.#loadClient());
    if (Result.isFailure(module)) {
      logger.warn("The WhatsApp client could not be loaded.", { cause: toLogValue(module.failure.cause) });
      this.#error = sourceText("error.connector.whatsappAccountLinkFailed", {
        detail: redactText(whatsappErrorMessage(module.failure.cause)),
      });
      return;
    }
    const file = yield* Effect.result(this.#authFile.load(module.success.readStoredAuth));
    const auth = Result.isSuccess(file) ? file.success : null;
    if (auth === null) {
      const cause = Result.isFailure(file) ? file.failure.cause : null;
      logger.warn("The keys of the linked WhatsApp device could not be read.", { cause: toLogValue(cause) });
      this.#error = sourceText("error.connector.whatsappAccountFileUnreadable");
      yield* this.#store
        .update((current) => (current ? { ...current, account: null, sendingEnabled: false, connectedAt: null } : null))
        .pipe(Effect.ignore);
      return;
    }
    const stored = yield* Effect.result(this.#historyFile.load(WhatsAppHistory.fromJSON));
    if (Result.isFailure(stored))
      logger.warn("The WhatsApp chats of this computer could not be read. WhatsApp sends new ones.", {
        cause: toLogValue(stored.failure.cause),
      });
    const history = (Result.isSuccess(stored) ? stored.success : null) ?? new WhatsAppHistory();
    history.setOwnId(record.account.id);
    const session: Session = { client: null, auth, history, online: false };
    session.client = module.success.createClient({
      auth,
      history,
      appVersion: this.#appVersion,
      events: this.#sessionEvents(session),
    });
    this.#attachSession(session);
    const client = session.client;
    yield* Effect.forkDetach(
      whatsappAccountCall(() => client.start()).pipe(
        Effect.catch(({ cause }) =>
          Effect.sync(() => {
            logger.warn("The linked WhatsApp device could not connect.", {
              reason: redactText(whatsappErrorMessage(cause)),
            });
          }),
        ),
      ),
    );
  });

  #attachSession(session: Session): void {
    this.#session = session;
    session.history.onChanged(() => {
      if (this.#session === session) this.#historyFile.schedule(() => session.history.toJSON());
    });
    this.#historyFile.schedule(() => session.history.toJSON());
  }

  #sessionEvents(session: Session): WhatsAppAccountClientEvents {
    const current = () => this.#session === session;
    return {
      qr: () => {},
      open: () => {
        if (!current()) return;
        session.online = true;
        if (this.#error === sourceText("error.connector.whatsappAccountOffline")) this.#error = null;
        this.#emitStatus();
      },
      offline: () => {
        if (!current()) return;
        session.online = false;
        this.#emitStatus();
      },
      stopped: (reason, detail) => {
        if (!current()) return;
        session.online = false;
        if (reason === "logged-out") {
          void Effect.runPromise(this.#deviceRemoved());
          return;
        }
        logger.warn("The linked WhatsApp device stopped.", { reason, detail: redactText(detail) });
        this.#error = stopMessage(reason, detail);
        this.#emitStatus();
      },
      authChanged: () => {
        if (current()) this.#authFile.schedule(() => session.auth);
      },
    };
  }

  /** WhatsApp removed this device, on the phone or because the keys were refused. */
  readonly #deviceRemoved = Effect.fn("WhatsAppAccountConnector.deviceRemoved")(function* (
    this: WhatsAppAccountConnectorService,
  ): Effect.fn.Return<void> {
    logger.warn("WhatsApp removed the linked device of the WhatsApp account connection.");
    this.#error = sourceText("error.connector.whatsappAccountLoggedOut");
    yield* this.#forgetDevice().pipe(
      Effect.catch(({ cause }) =>
        Effect.sync(() => {
          logger.warn("The removed WhatsApp device could not be deleted here.", { cause: toLogValue(cause) });
        }),
      ),
    );
    this.#emitStatus();
    this.#agentAccessChanged();
  });

  /** Deletes the keys, the chats and the account here. Sending turns off. */
  readonly #forgetDevice = Effect.fn("WhatsAppAccountConnector.forgetDevice")(function* (
    this: WhatsAppAccountConnectorService,
  ): Effect.fn.Return<void, WhatsAppAccountOperationError> {
    const session = this.#session;
    this.#session = null;
    session?.client?.destroy();
    yield* this.#authFile.remove();
    yield* this.#historyFile.remove();
    yield* this.#store.update((record) =>
      record ? { ...record, account: null, sendingEnabled: false, connectedAt: null } : null,
    );
  });

  // --- tools -----------------------------------------------------------------------------------

  #requireSession(): Effect.Effect<Session, WhatsAppAccountOperationError> {
    return Effect.suspend(() => {
      const session = this.#session;
      return session && linked(this.#store.read())
        ? Effect.succeed(session)
        : Effect.fail(whatsappToolFailure(NOT_CONNECTED_FOR_AGENT));
    });
  }

  #requireSending(): Effect.Effect<void, WhatsAppAccountOperationError> {
    return Effect.suspend(() =>
      this.#store.read()?.sendingEnabled ? Effect.void : Effect.fail(whatsappToolFailure(SENDING_OFF_FOR_AGENT)),
    );
  }

  /** The open client, after a short wait for a connection that is coming back. */
  #openClient(session: Session): Effect.Effect<WhatsAppClientLike, WhatsAppAccountOperationError> {
    return Effect.gen(function* () {
      const client = session.client;
      if (!client) return yield* whatsappToolFailure(OFFLINE_FOR_AGENT);
      const open = yield* whatsappAccountCall(() => client.whenOpen(OPEN_WAIT_MS));
      if (!open) return yield* whatsappToolFailure(OFFLINE_FOR_AGENT);
      return client;
    });
  }

  #resolve(
    session: Session,
    reference: string,
    exact: boolean,
  ): Effect.Effect<WhatsAppStoredChat, WhatsAppAccountOperationError> {
    return Effect.suspend(() => {
      const chat = session.history.resolveChat(reference, exact);
      return typeof chat === "string" ? Effect.fail(whatsappToolFailure(chat)) : Effect.succeed(chat);
    });
  }

  /** The tools of the MCP server. Sending and marking as read check the user's switch at each call. */
  #tools(): WhatsAppAccountMcpTools {
    return {
      listChats: (options) =>
        this.#requireSession().pipe(
          Effect.map((session) => {
            const chats = session.history.listChats(options);
            return { count: chats.length, chats, note: session.online ? undefined : OFFLINE_FOR_AGENT };
          }),
        ),
      readMessages: (options) =>
        Effect.gen({ self: this }, function* () {
          const session = yield* this.#requireSession();
          const chat = yield* this.#resolve(session, options.chat, false);
          let page = session.history.read(chat.id, options);
          // The phone can send messages older than the ones here, while it is online.
          const oldest = session.history.messages(chat.id)[0];
          const short = page.messages.length < options.limit && !page.has_more && page.before_found;
          if (short && oldest && !options.since && session.client?.isOpen()) {
            const client = session.client;
            const arrived = yield* whatsappAccountCall(() =>
              client.fetchOlder(chat.id, oldest, OLDER_COUNT, OLDER_WAIT_MS),
            ).pipe(Effect.orElseSucceed(() => false));
            if (arrived) page = session.history.read(chat.id, options);
          }
          return {
            chat: { id: chat.id, name: session.history.chatName(chat), type: chat.kind },
            messages: page.messages,
            has_more: page.has_more,
            note: page.before_found
              ? "WhatsApp sends recent history only. Older messages may be missing."
              : `No message with id ${options.beforeId ?? ""} is on this computer.`,
          };
        }),
      searchMessages: (options) =>
        Effect.gen({ self: this }, function* () {
          const session = yield* this.#requireSession();
          const chat = options.chat ? yield* this.#resolve(session, options.chat, false) : null;
          const results = session.history.search(options.query, { chat: chat?.id ?? null, limit: options.limit });
          return {
            count: results.length,
            results,
            note: "The search covers the messages on this computer only: the history that WhatsApp sent when the device linked, and every message since.",
          };
        }),
      sendMessage: (options) =>
        Effect.gen({ self: this }, function* () {
          yield* this.#requireSending();
          const session = yield* this.#requireSession();
          let chat = yield* this.#resolve(session, options.chat, true);
          const client = yield* this.#openClient(session);
          // A number with no chat yet: WhatsApp says whether it has an account and which id.
          if (!session.history.chat(chat.id) && jidPhone(chat.id)) {
            const phone = jidPhone(chat.id) ?? "";
            const id = yield* whatsappAccountCall(() => client.lookUp(phone));
            if (!id) return yield* whatsappToolFailure(`+${phone} has no WhatsApp account.`);
            chat = session.history.chat(id) ?? { ...chat, id };
          }
          const replyTo = options.replyToId
            ? (session.history.messages(chat.id).find((message) => message.id === options.replyToId) ?? null)
            : null;
          if (options.replyToId && !replyTo)
            return yield* whatsappToolFailure(`No message with id ${options.replyToId} is in this chat.`);
          // The switch can change while the connection opens.
          yield* this.#requireSending();
          const sent = yield* whatsappAccountCall(() => client.sendText(chat.id, options.text, replyTo));
          logger.info("An agent sent a WhatsApp message.");
          return {
            sent: true,
            chat: { id: chat.id, name: session.history.chatName(session.history.chat(chat.id) ?? chat) },
            message: { id: sent.id, date: new Date(sent.at * 1000).toISOString() },
          };
        }),
      markRead: (reference) =>
        Effect.gen({ self: this }, function* () {
          yield* this.#requireSending();
          const session = yield* this.#requireSession();
          const chat = yield* this.#resolve(session, reference, true);
          const client = yield* this.#openClient(session);
          const messages = session.history.messages(chat.id);
          const lastOwn = messages.findLastIndex((message) => message.fromMe);
          const unread = messages.slice(lastOwn + 1).filter((message) => !message.fromMe);
          yield* this.#requireSending();
          yield* whatsappAccountCall(() => client.markRead(chat.id, unread));
          return {
            marked_read: true,
            chat: { id: chat.id, name: session.history.chatName(chat) },
            messages: unread.length,
          };
        }),
    };
  }

  // --- the MCP server --------------------------------------------------------------------------

  /**
   * Starts the loopback MCP server on the port it had, so that a resumed session finds it. A server
   * that cannot start is logged: agents then get no WhatsApp tools.
   */
  readonly #startMcpServer = Effect.fn("WhatsAppAccountConnector.startMcpServer")(function* (
    this: WhatsAppAccountConnectorService,
    record: WhatsAppAccountConnectorRecord | null,
  ): Effect.fn.Return<void> {
    if (record?.mcpServer) {
      this.#mcpSecret = record.mcpServer.secret;
      registerSecretValue(this.#mcpSecret);
    }
    const server = new WhatsAppAccountMcpServer({
      secret: () => this.#mcpSecret,
      tools: this.#tools(),
      version: this.#appVersion,
    });
    const started = yield* Effect.result(server.start(record?.mcpServer?.port ?? null));
    if (Result.isFailure(started)) {
      logger.warn("The WhatsApp MCP server of this computer did not start.", {
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
            logger.warn("The WhatsApp MCP server port could not be saved.", { cause: toLogValue(cause) });
          }),
        ),
      );
  });

  #mcpSettings(): WhatsAppAccountConnectorRecord["mcpServer"] {
    const port = this.#mcp?.port() ?? null;
    return port ? { port, secret: this.#mcpSecret } : null;
  }

  #fail(error: string): WhatsAppAccountConnectorStatus {
    this.#error = error;
    this.#emitStatus();
    return this.status();
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
