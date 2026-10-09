import { Effect } from "effect";
import type {
  ConnectionIdentity,
  IngressAnswer,
  IngressDelivery,
  IngressState,
  MessagingIngress,
  MessagingTransport,
  TransportSink,
} from "../messaging-types";
import type { TelegramChatState } from "./telegram-chats";
import { parseTelegramUpdate, telegramUpdateEvent } from "./telegram-updates";

/** Signal can pass one update twice, such as after a link. */
const RECENT_UPDATES = 2_000;
const OK: IngressAnswer = { status: 200 };

export interface TelegramTransportOptions {
  identity: ConnectionIdentity;
  ingress: MessagingIngress;
  state: TelegramChatState;
  chatId: string;
}

/**
 * The inbound half of one chat: the updates that Telegram posts to Signal, which Signal passes to
 * this host. This holds the ingress socket open while it runs. A button press is answered at once,
 * so Telegram stops its spinner; the work starts after that.
 */
export class TelegramTransport implements MessagingTransport {
  readonly #identity: ConnectionIdentity;
  readonly #ingress: MessagingIngress;
  readonly #state: TelegramChatState;
  readonly #chatId: string;
  readonly #seen = new Set<number>();
  #sink: TransportSink | null = null;
  #release: (() => void) | null = null;
  #unsubscribe: (() => void) | null = null;

  constructor(options: TelegramTransportOptions) {
    this.#identity = options.identity;
    this.#ingress = options.ingress;
    this.#state = options.state;
    this.#chatId = options.chatId;
  }

  start(sink: TransportSink): void {
    this.#sink = sink;
    this.#release ??= this.#ingress.acquire("telegram");
    this.#unsubscribe ??= this.#ingress.onState((state) => this.#report(state));
    this.#report(this.#ingress.state());
  }

  /** The main process reconnects the ingress socket itself when the computer wakes. */
  reconnect(): void {}

  readonly stop = Effect.fn("TelegramTransport.stop")(() =>
    Effect.sync(() => {
      this.#sink = null;
      this.#unsubscribe?.();
      this.#unsubscribe = null;
      this.#release?.();
      this.#release = null;
    }),
  );

  readonly deliver = Effect.fn("TelegramTransport.deliver")(function* (
    this: TelegramTransport,
    delivery: IngressDelivery,
  ) {
    const sink = this.#sink;
    if (!sink || delivery.platform !== "telegram") return { status: 503 } satisfies IngressAnswer;
    const update = parseTelegramUpdate(delivery.body);
    if (!update) return { status: 400 } satisfies IngressAnswer;
    const updateId = update.update_id;
    if (typeof updateId === "number" && this.#remember(updateId)) return OK;
    const event = telegramUpdateEvent(update, this.#identity.botUserId, this.#chatId, this.#state);
    if (!event) return OK;
    if (event.type === "removed") sink.state("removed");
    else if (event.type === "renamed") sink.renamed?.(event.title);
    else if (event.type === "message") sink.message(event.message);
    else {
      yield* this.#ingress.telegram
        .call(this.#identity.botUserId, "answerCallbackQuery", { callback_query_id: event.callbackQueryId })
        .pipe(Effect.catch(() => Effect.void));
      if (event.action) sink.action(event.action);
    }
    return OK;
  });

  #report(state: IngressState): void {
    this.#sink?.state(
      state === "online" && this.#ingress.telegram.available()
        ? "connected"
        : state === "connecting"
          ? "connecting"
          : "relay_unavailable",
    );
  }

  /** True when the update was already handled. */
  #remember(updateId: number): boolean {
    if (this.#seen.has(updateId)) return true;
    this.#seen.add(updateId);
    if (this.#seen.size > RECENT_UPDATES) {
      const oldest = this.#seen.values().next().value;
      if (oldest !== undefined) this.#seen.delete(oldest);
    }
    return false;
  }
}
