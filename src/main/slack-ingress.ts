import { decodeSignalServerMessage } from "@openbot/contracts/signal-protocol/decode";
import {
  SIGNAL_PROTOCOL_VERSION,
  type SignalClientMessage,
  SLACK_DELIVERY_RESPONSE_BYTES_LIMIT,
} from "@openbot/contracts/signal-protocol/messages";
import { createOpenBotLogger } from "@openbot/logging";
import { Context, Effect, Exit, Layer, ManagedRuntime, Result, Scope } from "effect";
import WebSocket from "ws";
import type {
  IngressAnswer,
  IngressHandler,
  IngressState,
  MessagingIngress,
} from "../backend/messaging/messaging-types";
import { type RemoteWorkflowError, remoteDecode } from "./remote-service-effects";

const logger = createOpenBotLogger("slack-ingress");

const BACKOFF_START_MS = 2_000;
const BACKOFF_LIMIT_MS = 5 * 60_000;
const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;

export interface SlackIngressOptions {
  /** The remote host id of this computer, or null before it has a name. */
  hostId(): string | null;
  signedIn(): boolean;
  issueTicket(hostId: string): Effect.Effect<{ ticket: string; signalUrl: string }, RemoteWorkflowError>;
  /** The Slack route ticket: the workspaces that the account service links to this host. */
  issueSlackRoute(hostId: string): Effect.Effect<string, RemoteWorkflowError>;
}

class SlackIngressAccount extends Context.Service<
  SlackIngressAccount,
  {
    ticket(hostId: string): Effect.Effect<{ ticket: string; signalUrl: string }, RemoteWorkflowError>;
    route(hostId: string): Effect.Effect<string, RemoteWorkflowError>;
  }
>()("openbot/main/SlackIngressAccount") {
  static layer(options: SlackIngressOptions) {
    return Layer.succeed(
      SlackIngressAccount,
      SlackIngressAccount.of({
        ticket: (hostId) => options.issueTicket(hostId),
        route: (hostId) => options.issueSlackRoute(hostId),
      }),
    );
  }
}

/**
 * Owns this host's `ingress` socket to Signal, which brings the Events API requests of the Slack
 * workspaces linked to this host. It needs no WebRTC, so it lives here in main rather than in the
 * hidden peer window. It is open while a connection holds it, and it reconnects with a new ticket and
 * route ticket after every close. It never logs a frame: a delivery carries Slack message text.
 */
export class SlackIngress implements MessagingIngress {
  readonly #options: SlackIngressOptions;
  readonly #runtime: ManagedRuntime.ManagedRuntime<SlackIngressAccount, never>;
  readonly #scope = Scope.makeUnsafe();
  #disposing = false;
  readonly #listeners = new Set<(state: IngressState) => void>();
  #holders = 0;
  #state: IngressState = "unavailable";
  #handler: IngressHandler | null = null;
  #socket: WebSocket | null = null;
  #retry: ReturnType<typeof setTimeout> | null = null;
  #ping: ReturnType<typeof setInterval> | null = null;
  #backoffMs = BACKOFF_START_MS;
  #generation = 0;

  constructor(options: SlackIngressOptions) {
    this.#options = options;
    this.#runtime = ManagedRuntime.make(SlackIngressAccount.layer(options));
  }

  acquire(): () => void {
    this.#holders += 1;
    if (this.#holders === 1) this.#run(this.#open());
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#holders -= 1;
      if (this.#holders === 0) this.#close();
    };
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
    if (this.#holders === 0) return;
    this.#close();
    this.#run(this.#open());
  }

  readonly dispose = Effect.fn("SlackIngress.dispose")(function* (this: SlackIngress) {
    this.#disposing = true;
    this.#holders = 0;
    this.#close();
    this.#listeners.clear();
    yield* Scope.close(this.#scope, Exit.void);
    yield* this.#runtime.disposeEffect;
  }, Effect.uninterruptible);

  readonly #open = Effect.fn("SlackIngress.open")(function* (this: SlackIngress) {
    if (this.#disposing) return;
    const generation = ++this.#generation;
    this.#clearRetry();
    const hostId = this.#options.hostId();
    if (!this.#options.signedIn()) return this.#wait("signed_out");
    if (!hostId) return this.#wait("no_host");
    this.#setState("connecting");
    const account = yield* SlackIngressAccount;
    const issued = yield* Effect.all([account.ticket(hostId), account.route(hostId)], {
      concurrency: "unbounded",
    }).pipe(Effect.result);
    if (Result.isFailure(issued)) {
      if (generation === this.#generation) this.#wait("unavailable");
      return;
    }
    const [bootstrap, slackRoute] = issued.success;
    if (generation !== this.#generation || this.#holders === 0) return;
    const socket = new WebSocket(bootstrap.signalUrl);
    this.#socket = socket;
    socket.on("open", () => {
      const hello: SignalClientMessage = {
        type: "hello",
        version: SIGNAL_PROTOCOL_VERSION,
        peer: "ingress",
        token: bootstrap.ticket,
        slackRoute,
      };
      socket.send(JSON.stringify(hello));
    });
    socket.on("message", (data) => this.#run(this.#receive(socket, data.toString())));
    socket.on("pong", () => pongs.set(socket, true));
    socket.on("close", () => {
      if (socket !== this.#socket) return;
      this.#socket = null;
      this.#stopPing();
      if (this.#holders > 0) this.#wait("unavailable");
    });
    socket.on("error", () => {
      // `close` follows and schedules the retry. The error can carry the URL.
    });
  });

  readonly #receive = Effect.fn("SlackIngress.receive")(function* (
    this: SlackIngress,
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
      logger.warn("Signal refused the Slack ingress socket.", { code: message.code });
      return;
    }
    if (message.type !== "slack-delivery") return;
    const handler = this.#handler;
    const answer: IngressAnswer = handler
      ? yield* handler(message.teamId, {
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

  #run(operation: Effect.Effect<void, never, SlackIngressAccount>): void {
    if (this.#disposing) return;
    this.#runtime.runFork(
      operation.pipe(Effect.uninterruptible, Effect.forkIn(this.#scope, { startImmediately: true })),
    );
  }

  #wait(state: Exclude<IngressState, "online" | "connecting">): void {
    this.#setState(state);
    if (this.#holders === 0 || this.#retry) return;
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
