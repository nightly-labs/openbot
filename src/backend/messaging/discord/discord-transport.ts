import { Effect } from "effect";
import type {
  IngressAnswer,
  IngressDelivery,
  IngressState,
  MessagingIngress,
  MessagingTransport,
  TransportSink,
} from "../messaging-types";
import { discordInboundAction, discordInboundMessage } from "./discord-events";

/** The Gateway can send an event again after a resume. */
const RECENT_EVENTS = 2_000;
const OK: IngressAnswer = { status: 200 };

/**
 * The inbound half of one guild's OpenBot app. Signal keeps the bot's Gateway connection, which only
 * it can, and passes the guild's mentions of OpenBot and its button presses to this host's ingress
 * socket. This holds that socket open while it runs. Signal has already acknowledged each button
 * press to Discord, so nothing here answers Discord.
 */
export class DiscordTransport implements MessagingTransport {
  readonly #ingress: MessagingIngress;
  readonly #guildId: string;
  readonly #seen = new Set<string>();
  #sink: TransportSink | null = null;
  #release: (() => void) | null = null;
  #unsubscribe: (() => void) | null = null;
  #unsubscribeRoutes: (() => void) | null = null;

  constructor(ingress: MessagingIngress, guildId: string) {
    this.#ingress = ingress;
    this.#guildId = guildId;
  }

  start(sink: TransportSink): void {
    this.#sink = sink;
    // Before `acquire`, which can open the socket. The socket's route ticket is issued after this
    // start, so a session without the guild means that it was unlinked or the bot left it.
    this.#unsubscribeRoutes ??= this.#ingress.onDiscordRoutes((guildIds) => {
      if (!guildIds.has(this.#guildId)) this.#sink?.state("invalid_token");
    });
    this.#release ??= this.#ingress.acquire("discord");
    this.#unsubscribe ??= this.#ingress.onState((state) => this.#report(state));
    this.#report(this.#ingress.state());
  }

  /** The main process reconnects the ingress socket itself when the computer wakes. */
  reconnect(): void {}

  readonly stop = Effect.fn("DiscordTransport.stop")(() =>
    Effect.sync(() => {
      this.#sink = null;
      this.#unsubscribe?.();
      this.#unsubscribe = null;
      this.#unsubscribeRoutes?.();
      this.#unsubscribeRoutes = null;
      this.#release?.();
      this.#release = null;
    }),
  );

  readonly deliver = Effect.fn("DiscordTransport.deliver")((delivery: IngressDelivery) =>
    Effect.sync((): IngressAnswer => {
      const sink = this.#sink;
      if (!sink) return { status: 503 };
      if (delivery.platform !== "discord") return { status: 400 };
      const event = delivery.delivery;
      if (event.kind === "removed") {
        sink.state("invalid_token");
        return OK;
      }
      if (event.kind === "interaction") {
        if (this.#remember(`interaction:${event.interaction.id}`)) return OK;
        const action = discordInboundAction(event.interaction);
        if (action) sink.action(action);
        return OK;
      }
      if (this.#remember(`message:${event.message.id}`)) return OK;
      sink.message(discordInboundMessage(event.message));
      return OK;
    }),
  );

  #report(state: IngressState): void {
    this.#sink?.state(state === "online" ? "connected" : state === "connecting" ? "connecting" : "relay_unavailable");
  }

  /** True when the event was already handled. */
  #remember(key: string): boolean {
    if (this.#seen.has(key)) return true;
    this.#seen.add(key);
    if (this.#seen.size > RECENT_EVENTS) {
      const oldest = this.#seen.values().next().value;
      if (oldest !== undefined) this.#seen.delete(oldest);
    }
    return false;
  }
}
