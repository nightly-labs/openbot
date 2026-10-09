import type { MessagingPlatform } from "@openbot/contracts/ipc";
import { decodeSignalServerMessage } from "@openbot/contracts/signal-protocol/decode";
import { type DiscordApiRequest, decodeDiscordApiError } from "@openbot/contracts/signal-protocol/discord-api";
import { DISCORD_API_PATH } from "@openbot/contracts/signal-protocol/discord-route";
import { INGRESS_QUEUE_CAPABILITY, openQueuedDelivery } from "@openbot/contracts/signal-protocol/ingress-queue";
import {
  SIGNAL_PROTOCOL_VERSION,
  type SignalClientMessage,
  type SignalServerMessage,
  SLACK_DELIVERY_RESPONSE_BYTES_LIMIT,
  type WebhookDeliveryStatus,
} from "@openbot/contracts/signal-protocol/messages";
import {
  TELEGRAM_CAPABILITY,
  type TelegramCallMethod,
  type TelegramCallParams,
  type TelegramCallResult,
} from "@openbot/contracts/signal-protocol/telegram-route";
import { createOpenBotLogger } from "@openbot/logging";
import { Context, Effect, Exit, Layer, ManagedRuntime, Option, Result, Scope, Semaphore } from "effect";
import WebSocket from "ws";
import {
  DiscordApiError,
  type DiscordUploadFile,
  type IngressAnswer,
  type IngressHandler,
  type IngressState,
  MessagingAdapterError,
  type MessagingIngress,
  TelegramCallError,
  type TelegramGateway,
} from "../backend/messaging/messaging-types";
import type { IngressQueueKey } from "./ingress-queue-key";
import { type RemoteWorkflowError, remoteDecode } from "./remote-service-effects";
import { downloadTelegramFile, signalHttpOrigin, uploadTelegramFile } from "./telegram-files";

const logger = createOpenBotLogger("signal-ingress");

const BACKOFF_START_MS = 2_000;
const BACKOFF_LIMIT_MS = 5 * 60_000;
const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;
/** How long a Discord call waits for the session of a socket that is still connecting. */
const DISCORD_SESSION_WAIT_MS = 15_000;
/** Signal gives a Discord call about 10 seconds, and an upload carries up to 10 MB. */
const DISCORD_CALL_TIMEOUT_MS = 60_000;
/** How long a Telegram call waits for the socket to be ready, and then for Signal's answer. */
const TELEGRAM_READY_TIMEOUT_MS = 10_000;
const TELEGRAM_CALL_TIMEOUT_MS = 20_000;

export interface SignalIngressOptions {
  /** The remote host id of this computer, or null before it has a name. */
  hostId(): string | null;
  signedIn(): boolean;
  issueTicket(hostId: string): Effect.Effect<{ ticket: string; signalUrl: string }, RemoteWorkflowError>;
  /** The Slack route ticket: the workspaces that the account service links to this host. */
  issueSlackRoute(hostId: string): Effect.Effect<string, RemoteWorkflowError>;
  /** The Discord route ticket: the guilds that the account service links to this host. */
  issueDiscordRoute(hostId: string): Effect.Effect<string, RemoteWorkflowError>;
  /** The generic webhook route ticket: route IDs registered by this host in account metadata. */
  issueWebhookRoute(hostId: string): Effect.Effect<string, RemoteWorkflowError>;
  /**
   * The Telegram route ticket: the chats that the account service links to this host. A failure, such
   * as an account service without Telegram, leaves the socket without Telegram chats until it opens
   * again later.
   */
  issueTelegramRoute?(hostId: string): Effect.Effect<string, RemoteWorkflowError>;
  /**
   * The lasting queue key of this host, or null. With it, Signal keeps the events of a hosted server
   * that sleeps, sealed, and sends them when the socket connects.
   */
  queueKey?(): Effect.Effect<IngressQueueKey | null>;
}

class SignalIngressAccount extends Context.Service<
  SignalIngressAccount,
  {
    ticket(hostId: string): Effect.Effect<{ ticket: string; signalUrl: string }, RemoteWorkflowError>;
    slackRoute(hostId: string): Effect.Effect<string, RemoteWorkflowError>;
    discordRoute(hostId: string): Effect.Effect<string, RemoteWorkflowError>;
    webhookRoute(hostId: string): Effect.Effect<string, RemoteWorkflowError>;
    telegramRoute(hostId: string): Effect.Effect<string | null>;
  }
>()("openbot/main/SignalIngressAccount") {
  static layer(options: SignalIngressOptions) {
    return Layer.succeed(
      SignalIngressAccount,
      SignalIngressAccount.of({
        ticket: (hostId) => options.issueTicket(hostId),
        slackRoute: (hostId) => options.issueSlackRoute(hostId),
        discordRoute: (hostId) => options.issueDiscordRoute(hostId),
        webhookRoute: (hostId) => options.issueWebhookRoute(hostId),
        telegramRoute: (hostId) =>
          options.issueTelegramRoute
            ? options.issueTelegramRoute(hostId).pipe(
                Effect.catch(() =>
                  Effect.sync(() => {
                    logger.warn(
                      "The Telegram route ticket is not available. The socket opens again later for Telegram.",
                    );
                    return null;
                  }),
                ),
              )
            : Effect.succeed(null),
      }),
    );
  }
}

/** The bearer of this socket's Discord calls, and where they go. Valid while the socket is open. */
interface DiscordSession {
  token: string;
  url: string;
}

export interface WebhookIngressDelivery {
  routeId: string;
  deliveryId: string;
  timestamp: string;
  signature: string;
  body: Uint8Array;
}

interface WebhookIngressAnswer {
  status: WebhookDeliveryStatus;
}

export type WebhookIngressHandler = (delivery: WebhookIngressDelivery) => Effect.Effect<WebhookIngressAnswer, unknown>;

/**
 * Owns this host's `ingress` socket to Signal, which brings the Events API requests of the Slack
 * workspaces, the Gateway events of the Discord guilds and the updates of the Telegram chats linked to
 * this host. It also makes this host's Discord and Telegram calls through Signal, which holds both bot
 * tokens. It needs no WebRTC, so it
 * lives here in main rather than in the hidden peer window. It is open while a connection holds it,
 * and it reconnects with a new ticket and route tickets after every close. It never logs a frame or
 * a call: both carry message text.
 */
export class SignalIngress implements MessagingIngress {
  readonly #options: SignalIngressOptions;
  readonly #runtime: ManagedRuntime.ManagedRuntime<SignalIngressAccount, never>;
  readonly #scope = Scope.makeUnsafe();
  #disposing = false;
  readonly #listeners = new Set<(state: IngressState) => void>();
  /** How many connections of each platform hold the socket open. */
  readonly #holders = new Map<MessagingPlatform, number>();
  #state: IngressState = "unavailable";
  #handler: IngressHandler | null = null;
  #socket: WebSocket | null = null;
  #retry: ReturnType<typeof setTimeout> | null = null;
  #ping: ReturnType<typeof setInterval> | null = null;
  #backoffMs = BACKOFF_START_MS;
  #generation = 0;
  #apiUrl: string | null = null;
  #discordSession: DiscordSession | null = null;
  #webhookHolders = 0;
  #webhookHandler: WebhookIngressHandler | null = null;
  #webhookReady = false;
  /** The open socket serves Slack or Discord without the webhook route, because its ticket failed. */
  #webhookMissing = false;
  #webhookBackoffMs = BACKOFF_START_MS;
  /** The open socket has no Telegram route, because its ticket failed. */
  #telegramMissing = false;
  #telegramBackoffMs = BACKOFF_START_MS;
  readonly #sessionListeners = new Set<(session: DiscordSession | null) => void>();
  readonly #routeListeners = new Set<(guildIds: ReadonlySet<string>) => void>();
  /** What the Signal of the open socket can do, from its `ready`. */
  #capabilities = new Set<string>();
  /** The HTTPS origin of the Signal of the open socket, for Telegram files. */
  #signalOrigin: string | null = null;
  readonly #telegramCalls = new Map<string, (answer: TelegramCallAnswer) => void>();
  /** Loaded once; `null` when this host has none. */
  #queueKey: IngressQueueKey | null | undefined;
  /** The host ID that the open socket said hello with: the queued events are sealed for it. */
  #socketHostId: string | null = null;
  readonly #queuedOrder = Semaphore.makeUnsafe(1);

  constructor(options: SignalIngressOptions) {
    this.#options = options;
    this.#runtime = ManagedRuntime.make(SignalIngressAccount.layer(options));
  }

  /**
   * Whether the last Signal said that it starts this host for a connector event and keeps the event,
   * and this host sent it a queue key. Only then may a hosted server with a live connection sleep.
   */
  queueReady(): boolean {
    return Boolean(this.#queueKey) && this.#capabilities.has(INGRESS_QUEUE_CAPABILITY);
  }

  acquire(platform: MessagingPlatform): () => void {
    const before = this.#holders.get(platform) ?? 0;
    this.#holders.set(platform, before + 1);
    if (this.#held() === 1 && this.#webhookHolders === 0) this.#run(this.#open());
    // The socket asks Signal only for the routes of the platforms that hold it, and webhooks can
    // already hold it.
    else if (before === 0) this.reconnect();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#holders.set(platform, (this.#holders.get(platform) ?? 1) - 1);
      if (this.#held() === 0 && this.#webhookHolders === 0) this.#close();
    };
  }

  /** Keeps the ingress relay open while host webhook routes are enabled. */
  acquireWebhooks(): () => void {
    this.#webhookHolders += 1;
    if (this.#held() === 0 && this.#webhookHolders === 1) this.#run(this.#open());
    else if (this.#webhookHolders === 1) this.reconnect();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#webhookHolders = Math.max(0, this.#webhookHolders - 1);
      if (this.#held() === 0 && this.#webhookHolders === 0) this.#close();
    };
  }

  #held(): number {
    let total = 0;
    for (const count of this.#holders.values()) total += count;
    return total;
  }

  #holds(platform: MessagingPlatform): boolean {
    return (this.#holders.get(platform) ?? 0) > 0;
  }

  state(): IngressState {
    return this.#state;
  }

  onState(listener: (state: IngressState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  handle(handler: IngressHandler | null): void {
    this.#handler = handler;
  }

  /** Sets the handler for generic webhook requests received over the ingress socket. */
  handleWebhooks(handler: WebhookIngressHandler | null): void {
    this.#webhookHandler = handler;
  }

  readonly telegram: TelegramGateway = {
    available: () => this.#state === "online" && this.#capabilities.has(TELEGRAM_CAPABILITY),
    call: <M extends TelegramCallMethod>(botId: string, method: M, params: TelegramCallParams[M]) =>
      this.#telegramCall(botId, method, params),
    download: (fileToken, destination, maxBytes) =>
      Effect.suspend(() =>
        this.#signalOrigin
          ? downloadTelegramFile(this.#signalOrigin, fileToken, destination, maxBytes)
          : Effect.fail(telegramUnavailable()),
      ),
    upload: (uploadToken, path) =>
      Effect.suspend(() =>
        this.#signalOrigin
          ? uploadTelegramFile(this.#signalOrigin, uploadToken, path)
          : Effect.fail(telegramUnavailable()),
      ),
  };

  /** True only after Signal confirms the webhook route ticket on this socket. */
  webhookReady(): boolean {
    return this.#webhookReady;
  }

  /**
   * A socket can be dead without knowing it after the computer sleeps, or the account, the name or
   * the linked workspaces changed.
   */
  reconnect(): void {
    if (this.#held() === 0 && this.#webhookHolders === 0) return;
    this.#close();
    this.#run(this.#open());
  }

  /**
   * One Discord call through Signal. It fails with `unavailable` when no session arrives in time,
   * such as when this host is signed out or Signal has no Discord bot.
   */
  readonly discord = Effect.fn("SignalIngress.discord")(function* <A>(
    this: SignalIngress,
    request: DiscordApiRequest,
    decode: (value: unknown) => A,
    file?: DiscordUploadFile,
  ): Effect.fn.Return<A, MessagingAdapterError> {
    const session = yield* this.#awaitSession().pipe(
      Effect.timeoutOption(DISCORD_SESSION_WAIT_MS),
      Effect.map(Option.getOrNull),
    );
    if (!session) return yield* new MessagingAdapterError({ cause: new DiscordApiError(request.op, "unavailable") });
    const { token, url } = session;
    let body: string | FormData = JSON.stringify(request);
    if (file) {
      const form = new FormData();
      form.set("request", body);
      form.set("file", new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }), "file");
      body = form;
    }
    const sent = body;
    const { status, text } = yield* Effect.tryPromise({
      try: async (signal) => {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            ...(typeof sent === "string" ? { "content-type": "application/json" } : {}),
          },
          body: sent,
          redirect: "error",
          signal: AbortSignal.any([signal, AbortSignal.timeout(DISCORD_CALL_TIMEOUT_MS)]),
        });
        return { status: response.status, text: await response.text() };
      },
      catch: () => new MessagingAdapterError({ cause: new DiscordApiError(request.op, "unreachable") }),
    });
    if (status >= 200 && status < 300)
      return yield* Effect.try({
        try: () => decode(JSON.parse(text)),
        catch: () => new MessagingAdapterError({ cause: new DiscordApiError(request.op, "invalid_answer") }),
      });
    const refused = Result.getOrNull(Result.try(() => decodeDiscordApiError(JSON.parse(text))));
    return yield* new MessagingAdapterError({
      cause: new DiscordApiError(request.op, refused?.code ?? `http_${status}`, refused?.retryAfterMs),
    });
  });

  onDiscordRoutes(listener: (guildIds: ReadonlySet<string>) => void): () => void {
    this.#routeListeners.add(listener);
    return () => this.#routeListeners.delete(listener);
  }

  /**
   * The session of the open socket, at once or when Signal sends it. Null when nothing holds the
   * socket open, or when it closes: no session comes then.
   */
  #awaitSession(): Effect.Effect<DiscordSession | null> {
    return Effect.callback<DiscordSession | null>((resume) => {
      const current = this.#discordSession;
      if (current || this.#disposing || !this.#holds("discord")) {
        resume(Effect.succeed(current));
        return;
      }
      const listener = (session: DiscordSession | null) => {
        this.#sessionListeners.delete(listener);
        resume(Effect.succeed(session));
      };
      this.#sessionListeners.add(listener);
      return Effect.sync(() => this.#sessionListeners.delete(listener));
    });
  }

  readonly dispose = Effect.fn("SignalIngress.dispose")(function* (this: SignalIngress) {
    this.#disposing = true;
    this.#holders.clear();
    this.#close();
    this.#listeners.clear();
    this.#routeListeners.clear();
    this.#webhookHandler = null;
    this.#webhookHolders = 0;
    yield* Scope.close(this.#scope, Exit.void);
    yield* this.#runtime.disposeEffect;
  }, Effect.uninterruptible);

  readonly #open = Effect.fn("SignalIngress.open")(function* (this: SignalIngress) {
    if (this.#disposing) return;
    const generation = ++this.#generation;
    this.#clearRetry();
    const hostId = this.#options.hostId();
    if (!this.#options.signedIn()) return this.#wait("signed_out");
    if (!hostId) return this.#wait("no_host");
    this.#setState("connecting");
    const account = yield* SignalIngressAccount;
    const slack = this.#holds("slack");
    const discord = this.#holds("discord");
    const telegram = this.#holds("telegram");
    const webhooks = this.#webhookHolders > 0;
    let webhookTicket: Effect.Effect<string | null, RemoteWorkflowError> = webhooks
      ? account.webhookRoute(hostId)
      : Effect.succeed(null);
    // A failed webhook ticket must not stop Slack and Discord: the socket then connects without it.
    if (webhooks && (slack || discord))
      webhookTicket = webhookTicket.pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            logger.warn("The webhook route ticket is not available. The socket opens again later for webhooks.");
            return null;
          }),
        ),
      );
    const issued = yield* Effect.all(
      [
        account.ticket(hostId),
        slack ? account.slackRoute(hostId) : Effect.succeed(null),
        discord ? account.discordRoute(hostId) : Effect.succeed(null),
        webhookTicket,
        telegram ? account.telegramRoute(hostId) : Effect.succeed(null),
      ],
      { concurrency: "unbounded" },
    ).pipe(Effect.result);
    if (Result.isFailure(issued)) {
      if (generation === this.#generation) this.#wait("unavailable");
      return;
    }
    const [bootstrap, slackRoute, discordRoute, webhookRoute, telegramRoute] = issued.success;
    const routes = {
      ...(slackRoute === null ? {} : { slackRoute }),
      ...(discordRoute === null ? {} : { discordRoute }),
      ...(webhookRoute === null ? {} : { webhookRoute }),
      ...(telegramRoute === null ? {} : { telegramRoute }),
    };
    if (this.#queueKey === undefined) this.#queueKey = this.#options.queueKey ? yield* this.#options.queueKey() : null;
    const queueKey = this.#queueKey;
    if (generation !== this.#generation || (this.#held() === 0 && this.#webhookHolders === 0)) return;
    this.#webhookMissing = webhooks && webhookRoute === null;
    this.#telegramMissing = telegram && telegramRoute === null;
    if (telegram && telegramRoute !== null) this.#telegramBackoffMs = BACKOFF_START_MS;
    const socket = new WebSocket(bootstrap.signalUrl);
    this.#socket = socket;
    this.#socketHostId = hostId;
    this.#apiUrl = discordApiUrl(bootstrap.signalUrl);
    this.#signalOrigin = signalHttpOrigin(bootstrap.signalUrl);
    socket.on("open", () => {
      const hello: SignalClientMessage = {
        type: "hello",
        version: SIGNAL_PROTOCOL_VERSION,
        peer: "ingress",
        token: bootstrap.ticket,
        ...routes,
        ...(queueKey ? { queueKey: queueKey.publicKey } : {}),
      };
      socket.send(JSON.stringify(hello));
    });
    socket.on("message", (data) => this.#run(this.#receive(socket, data.toString())));
    socket.on("pong", () => pongs.set(socket, true));
    socket.on("close", () => {
      if (socket !== this.#socket) return;
      this.#socket = null;
      this.#discordSession = null;
      this.#endTelegram();
      this.#stopPing();
      this.#webhookReady = false;
      if (this.#held() > 0 || this.#webhookHolders > 0) this.#wait("unavailable");
    });
    socket.on("error", () => {
      // `close` follows and schedules the retry. The error can carry the URL.
    });
  });

  readonly #receive = Effect.fn("SignalIngress.receive")(function* (
    this: SignalIngress,
    socket: WebSocket,
    text: string,
  ) {
    if (this.#disposing || socket !== this.#socket) return;
    const decoded = yield* remoteDecode(() => decodeSignalServerMessage(JSON.parse(text))).pipe(Effect.result);
    if (Result.isFailure(decoded)) {
      socket.close(1002);
      return;
    }
    const message = decoded.success;
    if (!message || socket !== this.#socket) return;
    if (message.type !== "queued-delivery") return yield* this.#dispatch(socket, message, false);
    // A delivery that Signal kept while this host started. Signal already answered the platform. The
    // kept deliveries are handled one at a time, in the order that Signal sent them.
    const sealed = message.sealed;
    yield* this.#queuedOrder.withPermit(
      Effect.gen({ self: this }, function* () {
        const key = this.#queueKey;
        const hostId = this.#socketHostId;
        const opened =
          key && hostId
            ? yield* Effect.tryPromise(() => openQueuedDelivery(key.privateKey, hostId, sealed)).pipe(
                Effect.catch(() => Effect.succeed(null)),
              )
            : null;
        if (!opened) {
          logger.warn("A kept delivery from Signal could not be opened, and is dropped.");
          return;
        }
        if (socket === this.#socket) yield* this.#dispatch(socket, opened, true);
      }),
    );
  });

  readonly #dispatch = Effect.fn("SignalIngress.dispatch")(function* (
    this: SignalIngress,
    socket: WebSocket,
    message: Exclude<SignalServerMessage, { type: "queued-delivery" }>,
    queued: boolean,
  ) {
    if (message.type === "ready") {
      this.#capabilities = new Set(message.capabilities ?? []);
      this.#backoffMs = BACKOFF_START_MS;
      this.#startPing(socket);
      this.#setState("online");
      if (this.#webhookMissing || this.#telegramMissing) this.#retryRoutes();
      return;
    }
    if (message.type === "webhook-ready") {
      this.#webhookReady = true;
      this.#webhookBackoffMs = BACKOFF_START_MS;
      return;
    }
    if (message.type === "error") {
      // Signal closes the socket after an error that ends it. Only the code is logged.
      logger.warn("Signal refused the ingress socket.", { code: message.code });
      return;
    }
    if (message.type === "discord-session") {
      const url = this.#apiUrl;
      if (!url) return;
      const session = { token: message.token, url };
      this.#discordSession = session;
      for (const listener of [...this.#sessionListeners]) listener(session);
      const routes = new Set(message.guilds);
      for (const listener of [...this.#routeListeners]) listener(routes);
      return;
    }
    if (message.type === "discord-delivery") {
      // Discord gets no answer: Signal already acknowledged a button press.
      const handler = this.#handler;
      if (handler)
        yield* handler(message.guildId, { platform: "discord", delivery: message.delivery, queued }).pipe(
          Effect.catch(() => Effect.void),
        );
      return;
    }
    if (message.type === "telegram-call-result") {
      this.#telegramCalls.get(message.requestId)?.(message);
      return;
    }
    if (message.type === "telegram-delivery") {
      // Telegram gets no answer: Signal already answered its webhook.
      const handler = this.#handler;
      if (handler)
        yield* handler(message.chatId, {
          platform: "telegram",
          botId: message.botId,
          body: Buffer.from(message.bodyBase64, "base64"),
          linked: message.linked === true,
          queued,
        }).pipe(Effect.catch(() => Effect.void));
      return;
    }
    if (message.type === "webhook-delivery") {
      const handler = this.#webhookHandler;
      const answer = handler
        ? yield* handler({
            routeId: message.routeId,
            deliveryId: message.deliveryId,
            timestamp: message.timestamp,
            signature: message.signature,
            body: Buffer.from(message.bodyBase64, "base64"),
          }).pipe(Effect.catch(() => Effect.succeed<WebhookIngressAnswer>({ status: 503 })))
        : { status: 503 as const };
      if (socket.readyState !== WebSocket.OPEN) return;
      const result: SignalClientMessage = {
        type: "webhook-delivery-result",
        version: SIGNAL_PROTOCOL_VERSION,
        requestId: message.requestId,
        status: answer.status,
      };
      socket.send(JSON.stringify(result));
      return;
    }
    if (message.type !== "slack-delivery") return;
    const handler = this.#handler;
    const answer: IngressAnswer = handler
      ? yield* handler(message.teamId, {
          platform: "slack",
          kind: message.kind,
          retryNum: message.retryNum,
          body: Buffer.from(message.bodyBase64, "base64"),
          queued,
        }).pipe(Effect.catch(() => Effect.succeed<IngressAnswer>({ status: 503 })))
      : { status: 503 };
    if (queued || socket.readyState !== WebSocket.OPEN) return;
    const body =
      answer.contentType && answer.body !== undefined && answer.body.length <= SLACK_DELIVERY_RESPONSE_BYTES_LIMIT
        ? { contentType: answer.contentType, body: answer.body }
        : {};
    const result: SignalClientMessage = {
      type: "slack-delivery-result",
      version: SIGNAL_PROTOCOL_VERSION,
      requestId: message.requestId,
      status: answer.status,
      ...body,
    };
    socket.send(JSON.stringify(result));
  });

  #run(operation: Effect.Effect<void, never, SignalIngressAccount>): void {
    if (this.#disposing) return;
    this.#runtime.runFork(
      operation.pipe(Effect.uninterruptible, Effect.forkIn(this.#scope, { startImmediately: true })),
    );
  }

  #wait(state: Exclude<IngressState, "online" | "connecting">): void {
    this.#setState(state);
    if ((this.#held() === 0 && this.#webhookHolders === 0) || this.#retry) return;
    const delay = this.#backoffMs * (0.5 + Math.random() / 2);
    this.#backoffMs = Math.min(this.#backoffMs * 2, BACKOFF_LIMIT_MS);
    this.#retry = setTimeout(() => {
      this.#retry = null;
      this.#run(this.#open());
    }, delay);
  }

  /**
   * Opens the shared socket again later, with a longer delay each time, so a missing webhook or
   * Telegram route comes back. Each route has its own delay: a confirmed webhook route does not
   * shorten the delay of a Telegram route that still fails.
   */
  #retryRoutes(): void {
    if (this.#retry) return;
    let delay: number;
    if (this.#webhookMissing) {
      delay = this.#webhookBackoffMs * (0.5 + Math.random() / 2);
      this.#webhookBackoffMs = Math.min(this.#webhookBackoffMs * 2, BACKOFF_LIMIT_MS);
    } else {
      delay = this.#telegramBackoffMs * (0.5 + Math.random() / 2);
      this.#telegramBackoffMs = Math.min(this.#telegramBackoffMs * 2, BACKOFF_LIMIT_MS);
    }
    this.#retry = setTimeout(() => {
      this.#retry = null;
      this.reconnect();
    }, delay);
  }

  /**
   * One Bot API call through Signal. It waits a short time for the socket to be ready, so a call made
   * while the socket reconnects does not fail at once.
   */
  #telegramCall<M extends TelegramCallMethod>(
    botId: string,
    method: M,
    params: TelegramCallParams[M],
  ): Effect.Effect<TelegramCallResult, MessagingAdapterError> {
    return Effect.gen({ self: this }, function* () {
      yield* this.#telegramReady();
      const socket = this.#socket;
      if (!socket || socket.readyState !== WebSocket.OPEN) return yield* telegramUnavailable();
      const requestId = crypto.randomUUID().replaceAll("-", "");
      const answer = yield* Effect.callback<TelegramCallAnswer>((resume) => {
        this.#telegramCalls.set(requestId, (value) => resume(Effect.succeed(value)));
        const request: SignalClientMessage = {
          type: "telegram-call",
          version: SIGNAL_PROTOCOL_VERSION,
          requestId,
          botId,
          method,
          params,
        };
        socket.send(JSON.stringify(request));
      }).pipe(
        Effect.timeoutOrElse({ duration: TELEGRAM_CALL_TIMEOUT_MS, orElse: () => Effect.succeed(TELEGRAM_TIMED_OUT) }),
        Effect.ensuring(Effect.sync(() => this.#telegramCalls.delete(requestId))),
      );
      if (answer.ok) return answer.result;
      return yield* new MessagingAdapterError({
        cause: new TelegramCallError(answer.errorCode, answer.description, answer.retryAfter ?? null),
      });
    });
  }

  #telegramReady(): Effect.Effect<void, MessagingAdapterError> {
    if (this.telegram.available()) return Effect.void;
    // A Signal that answered `ready` without Telegram does not gain it on this socket.
    if (this.#state === "online") return Effect.fail(telegramUnavailable());
    return Effect.callback<void>((resume) => {
      const stop = this.onState(() => {
        if (!this.telegram.available()) return;
        stop();
        resume(Effect.void);
      });
      return Effect.sync(stop);
    }).pipe(
      Effect.timeoutOrElse({ duration: TELEGRAM_READY_TIMEOUT_MS, orElse: () => Effect.fail(telegramUnavailable()) }),
    );
  }

  /** The socket closed: no answer comes for the Telegram calls in flight. */
  #endTelegram(): void {
    this.#capabilities = new Set();
    for (const settle of [...this.#telegramCalls.values()]) settle(TELEGRAM_UNAVAILABLE_ANSWER);
    this.#telegramCalls.clear();
  }

  #close(): void {
    this.#generation += 1;
    this.#clearRetry();
    this.#stopPing();
    this.#endTelegram();
    const socket = this.#socket;
    this.#socket = null;
    this.#discordSession = null;
    this.#webhookReady = false;
    if (this.#held() === 0 && this.#webhookHolders === 0)
      for (const listener of [...this.#sessionListeners]) listener(null);
    socket?.close(1000);
    this.#backoffMs = BACKOFF_START_MS;
    this.#setState("unavailable");
  }

  #setState(state: IngressState): void {
    if (state === this.#state) return;
    this.#state = state;
    for (const listener of this.#listeners) listener(state);
  }

  #clearRetry(): void {
    if (this.#retry) clearTimeout(this.#retry);
    this.#retry = null;
  }

  #startPing(socket: WebSocket): void {
    this.#stopPing();
    this.#ping = setInterval(() => {
      if (socket !== this.#socket) return;
      pongs.set(socket, false);
      socket.ping();
      setTimeout(() => {
        if (pongs.get(socket) === false) socket.terminate();
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  #stopPing(): void {
    if (this.#ping) clearInterval(this.#ping);
    this.#ping = null;
  }
}

const pongs = new WeakMap<WebSocket, boolean>();

type TelegramCallAnswer =
  | { ok: true; result: TelegramCallResult }
  | { ok: false; errorCode: number; description: string; retryAfter?: number };

const TELEGRAM_UNAVAILABLE_ANSWER: TelegramCallAnswer = { ok: false, errorCode: 503, description: "relay_unavailable" };
const TELEGRAM_TIMED_OUT: TelegramCallAnswer = { ok: false, errorCode: 504, description: "timeout" };

function telegramUnavailable(): MessagingAdapterError {
  return new MessagingAdapterError({ cause: new TelegramCallError(503, "relay_unavailable", null) });
}

/** Signal's Discord path on the origin of its socket: `wss:` becomes `https:`, and `ws:` (local) `http:`. */
function discordApiUrl(signalUrl: string): string {
  const url = new URL(signalUrl);
  url.protocol = url.protocol === "ws:" ? "http:" : "https:";
  url.pathname = DISCORD_API_PATH;
  url.search = "";
  url.hash = "";
  return url.toString();
}
