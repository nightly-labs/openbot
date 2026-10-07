import type { MessagingPlatform } from "@openbot/contracts/ipc";
import { decodeSignalServerMessage } from "@openbot/contracts/signal-protocol/decode";
import { type DiscordApiRequest, decodeDiscordApiError } from "@openbot/contracts/signal-protocol/discord-api";
import { DISCORD_API_PATH } from "@openbot/contracts/signal-protocol/discord-route";
import {
  SIGNAL_PROTOCOL_VERSION,
  type SignalClientMessage,
  SLACK_DELIVERY_RESPONSE_BYTES_LIMIT,
} from "@openbot/contracts/signal-protocol/messages";
import { createOpenBotLogger } from "@openbot/logging";
import { Context, Effect, Exit, Layer, ManagedRuntime, Option, Result, Scope } from "effect";
import WebSocket from "ws";
import {
  DiscordApiError,
  type DiscordUploadFile,
  type IngressAnswer,
  type IngressHandler,
  type IngressState,
  MessagingAdapterError,
  type MessagingIngress,
} from "../backend/messaging/messaging-types";
import { type RemoteWorkflowError, remoteDecode } from "./remote-service-effects";

const logger = createOpenBotLogger("signal-ingress");

const BACKOFF_START_MS = 2_000;
const BACKOFF_LIMIT_MS = 5 * 60_000;
const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;
/** How long a Discord call waits for the session of a socket that is still connecting. */
const DISCORD_SESSION_WAIT_MS = 15_000;
/** Signal gives a Discord call about 10 seconds, and an upload carries up to 10 MB. */
const DISCORD_CALL_TIMEOUT_MS = 60_000;

export interface SignalIngressOptions {
  /** The remote host id of this computer, or null before it has a name. */
  hostId(): string | null;
  signedIn(): boolean;
  issueTicket(hostId: string): Effect.Effect<{ ticket: string; signalUrl: string }, RemoteWorkflowError>;
  /** The Slack route ticket: the workspaces that the account service links to this host. */
  issueSlackRoute(hostId: string): Effect.Effect<string, RemoteWorkflowError>;
  /** The Discord route ticket: the guilds that the account service links to this host. */
  issueDiscordRoute(hostId: string): Effect.Effect<string, RemoteWorkflowError>;
}

class SignalIngressAccount extends Context.Service<
  SignalIngressAccount,
  {
    ticket(hostId: string): Effect.Effect<{ ticket: string; signalUrl: string }, RemoteWorkflowError>;
    slackRoute(hostId: string): Effect.Effect<string, RemoteWorkflowError>;
    discordRoute(hostId: string): Effect.Effect<string, RemoteWorkflowError>;
  }
>()("openbot/main/SignalIngressAccount") {
  static layer(options: SignalIngressOptions) {
    return Layer.succeed(
      SignalIngressAccount,
      SignalIngressAccount.of({
        ticket: (hostId) => options.issueTicket(hostId),
        slackRoute: (hostId) => options.issueSlackRoute(hostId),
        discordRoute: (hostId) => options.issueDiscordRoute(hostId),
      }),
    );
  }
}

/** The bearer of this socket's Discord calls, and where they go. Valid while the socket is open. */
interface DiscordSession {
  token: string;
  url: string;
}

/**
 * Owns this host's `ingress` socket to Signal, which brings the Events API requests of the Slack
 * workspaces and the Gateway events of the Discord guilds linked to this host. It also makes this
 * host's Discord calls through Signal, which holds the Discord bot token. It needs no WebRTC, so it
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
  readonly #sessionListeners = new Set<(session: DiscordSession | null) => void>();
  readonly #routeListeners = new Set<(guildIds: ReadonlySet<string>) => void>();

  constructor(options: SignalIngressOptions) {
    this.#options = options;
    this.#runtime = ManagedRuntime.make(SignalIngressAccount.layer(options));
  }

  acquire(platform: MessagingPlatform): () => void {
    const before = this.#holders.get(platform) ?? 0;
    this.#holders.set(platform, before + 1);
    if (this.#held() === 1) this.#run(this.#open());
    // The socket asks Signal only for the routes of the platforms that hold it.
    else if (before === 0) this.reconnect();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#holders.set(platform, (this.#holders.get(platform) ?? 1) - 1);
      if (this.#held() === 0) this.#close();
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

  /**
   * A socket can be dead without knowing it after the computer sleeps, or the account, the name or
   * the linked workspaces changed.
   */
  reconnect(): void {
    if (this.#held() === 0) return;
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
    const issued = yield* Effect.all(
      [
        account.ticket(hostId),
        slack ? account.slackRoute(hostId) : Effect.succeed(null),
        discord ? account.discordRoute(hostId) : Effect.succeed(null),
      ],
      { concurrency: "unbounded" },
    ).pipe(Effect.result);
    if (Result.isFailure(issued)) {
      if (generation === this.#generation) this.#wait("unavailable");
      return;
    }
    const [bootstrap, slackRoute, discordRoute] = issued.success;
    const routes = {
      ...(slackRoute === null ? {} : { slackRoute }),
      ...(discordRoute === null ? {} : { discordRoute }),
    };
    if (generation !== this.#generation || this.#held() === 0) return;
    const socket = new WebSocket(bootstrap.signalUrl);
    this.#socket = socket;
    this.#apiUrl = discordApiUrl(bootstrap.signalUrl);
    socket.on("open", () => {
      const hello: SignalClientMessage = {
        type: "hello",
        version: SIGNAL_PROTOCOL_VERSION,
        peer: "ingress",
        token: bootstrap.ticket,
        ...routes,
      };
      socket.send(JSON.stringify(hello));
    });
    socket.on("message", (data) => this.#run(this.#receive(socket, data.toString())));
    socket.on("pong", () => pongs.set(socket, true));
    socket.on("close", () => {
      if (socket !== this.#socket) return;
      this.#socket = null;
      this.#discordSession = null;
      this.#stopPing();
      if (this.#held() > 0) this.#wait("unavailable");
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
    if (message.type === "ready") {
      this.#backoffMs = BACKOFF_START_MS;
      this.#startPing(socket);
      this.#setState("online");
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
        yield* handler(message.guildId, { platform: "discord", delivery: message.delivery }).pipe(
          Effect.catch(() => Effect.void),
        );
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
        }).pipe(Effect.catch(() => Effect.succeed<IngressAnswer>({ status: 503 })))
      : { status: 503 };
    if (socket.readyState !== WebSocket.OPEN) return;
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
    if (this.#held() === 0 || this.#retry) return;
    const delay = this.#backoffMs * (0.5 + Math.random() / 2);
    this.#backoffMs = Math.min(this.#backoffMs * 2, BACKOFF_LIMIT_MS);
    this.#retry = setTimeout(() => {
      this.#retry = null;
      this.#run(this.#open());
    }, delay);
  }

  #close(): void {
    this.#generation += 1;
    this.#clearRetry();
    this.#stopPing();
    const socket = this.#socket;
    this.#socket = null;
    this.#discordSession = null;
    if (this.#held() === 0) for (const listener of [...this.#sessionListeners]) listener(null);
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

/** Signal's Discord path on the origin of its socket: `wss:` becomes `https:`, and `ws:` (local) `http:`. */
function discordApiUrl(signalUrl: string): string {
  const url = new URL(signalUrl);
  url.protocol = url.protocol === "ws:" ? "http:" : "https:";
  url.pathname = DISCORD_API_PATH;
  url.search = "";
  url.hash = "";
  return url.toString();
}
