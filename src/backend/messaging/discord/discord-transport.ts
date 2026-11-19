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

const RECENT_EVENTS = 2_000;
const OK: IngressAnswer = { status: 200 };

export class DiscordTransport implements MessagingTransport {
  readonly #ingress: MessagingIngress;
  readonly #guildId: string;
  readonly #seen = new Set<string>();
  #sink: TransportSink | null = null;
  #release: (() => void) | null = null;
  #unsubscribe: (() => void) | null = null;
  #unsubscribeRoutes: (() => void) | null = null;
  #linked = true;

  constructor(ingress: MessagingIngress, guildId: string) {
    this.#ingress = ingress;
    this.#guildId = guildId;
  }

  start(sink: TransportSink): void {
    this.#sink = sink;
    this.#unsubscribeRoutes ??= this.#ingress.onDiscordRoutes((guildIds) => {
      this.#linked = guildIds.has(this.#guildId);
      this.#report(this.#ingress.state());
    });
    this.#release ??= this.#ingress.acquire("discord");
    this.#unsubscribe ??= this.#ingress.onState((state) => this.#report(state));
    this.#report(this.#ingress.state());
  }

  reconnect(): void {}

  readonly stop = Effect.fn("DiscordTransport.stop")(() =>
    Effect.sync(() => {
      this.#sink = null;
      this.#unsubscribe?.();
      this.#unsubscribe = null;
      this.#unsubscribeRoutes?.();
      this.#unsubscribeRoutes = null;
      this.#linked = true;
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
    this.#sink?.state(
      state === "online"
        ? this.#linked
          ? "connected"
          : "not_linked"
        : state === "connecting"
          ? "connecting"
          : "relay_unavailable",
    );
  }

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
