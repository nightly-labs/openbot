import { type DynamicRecord, isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import type { ConnectionIdentity, InboundMessage, MessagingTransport, TransportSink } from "../messaging-types";
import { MessagingConnectionError } from "../messaging-types";
import type { TelegramWebApi } from "./telegram-api";
import { telegramInboundAction, telegramInboundMessage } from "./telegram-events";

const POLL_TIMEOUT_SECONDS = 30;
const RETRY_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 30_000;

export interface TelegramPollingTransportOptions {
  identity: ConnectionIdentity;
  api: TelegramWebApi;
  pollTimeoutSec?: number;
  delay?: (milliseconds: number) => Promise<void>;
  onInboundMessage?: (msg: InboundMessage | null) => void;
}

/**
 * Long-polling transport for Telegram Bot API.
 * Keeps calling `getUpdates` with an offset, runs entirely locally, requires no public ingress.
 */
export class TelegramPollingTransport implements MessagingTransport {
  readonly #identity: ConnectionIdentity;
  readonly #api: TelegramWebApi;
  readonly #pollTimeoutSec: number;
  readonly #delay: (milliseconds: number) => Promise<void>;
  readonly #onInboundMessage?: (msg: InboundMessage | null) => void;

  #sink: TransportSink | null = null;
  #running = false;
  #abortController: AbortController | null = null;
  #lastUpdateId = 0;
  #loopPromise: Promise<void> | null = null;

  constructor(options: TelegramPollingTransportOptions) {
    this.#identity = options.identity;
    this.#api = options.api;
    this.#pollTimeoutSec = options.pollTimeoutSec ?? POLL_TIMEOUT_SECONDS;
    this.#delay = options.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#onInboundMessage = options.onInboundMessage;
  }

  start(sink: TransportSink): void {
    if (this.#running) return;
    this.#sink = sink;
    this.#running = true;
    sink.state("connecting");
    this.#loopPromise = this.#pollLoop();
  }

  reconnect(): void {
    if (this.#abortController) {
      this.#abortController.abort();
    }
  }

  readonly stop = Effect.fnUntraced(function* (this: TelegramPollingTransport) {
    this.#running = false;
    if (this.#abortController) {
      this.#abortController.abort();
      this.#abortController = null;
    }
    const loop = this.#loopPromise;
    if (loop) {
      yield* Effect.promise(() => loop.catch(() => undefined));
      this.#loopPromise = null;
    }
    this.#sink = null;
  }).bind(this);

  async #pollLoop(): Promise<void> {
    let backoffMs = RETRY_BACKOFF_MS;

    while (this.#running) {
      this.#abortController = new AbortController();
      const signal = this.#abortController.signal;

      try {
        const updates = await this.#api.call<DynamicRecord[]>(
          "getUpdates",
          {
            offset: this.#lastUpdateId > 0 ? this.#lastUpdateId + 1 : 0,
            timeout: this.#pollTimeoutSec,
            allowed_updates: ["message", "edited_message", "channel_post", "callback_query"],
          },
          signal,
        );

        if (!this.#running) break;

        this.#sink?.state("connected");
        backoffMs = RETRY_BACKOFF_MS;

        if (Array.isArray(updates)) {
          for (const update of updates) {
            if (!isDynamicRecord(update) || !isNumber(update.update_id)) continue;
            this.#lastUpdateId = Math.max(this.#lastUpdateId, update.update_id);

            this.#handleUpdate(update);
          }
        }
      } catch (error) {
        if (!this.#running) break;

        if (signal.aborted) {
          continue;
        }

        if (error instanceof MessagingConnectionError) {
          this.#sink?.state(error.state);
          this.#running = false;
          break;
        }

        this.#sink?.state("reconnecting");
        await this.#delay(backoffMs);
        backoffMs = Math.min(backoffMs * 1.5, MAX_BACKOFF_MS);
      }
    }
  }

  #handleUpdate(update: unknown): void {
    const inbound = telegramInboundMessage(update, this.#identity.botUserId, this.#identity.appId);
    this.#onInboundMessage?.(inbound);
    if (inbound) {
      this.#sink?.message(inbound);
      return;
    }

    const action = telegramInboundAction(update);
    if (action) {
      this.#sink?.action(action);
      if (isDynamicRecord(update) && isDynamicRecord(update.callback_query)) {
        const queryId = String(update.callback_query.id ?? "");
        if (queryId) {
          this.#api.answerCallbackQuery(queryId).catch(() => undefined);
        }
      }
    }
  }
}
