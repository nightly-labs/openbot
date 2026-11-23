import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
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
import { slackInboundAction, slackInboundMessage } from "./slack-events";

const RECENT_EVENTS = 2_000;
const OK: IngressAnswer = { status: 200 };

export interface SlackEventsTransportOptions {
  identity: ConnectionIdentity;
  ingress: MessagingIngress;
}

export class SlackEventsTransport implements MessagingTransport {
  readonly #identity: ConnectionIdentity;
  readonly #ingress: MessagingIngress;
  readonly #seen = new Set<string>();
  #sink: TransportSink | null = null;
  #release: (() => void) | null = null;
  #unsubscribe: (() => void) | null = null;
  #unsubscribeRoutes: (() => void) | null = null;
  #linked = true;

  constructor(options: SlackEventsTransportOptions) {
    this.#identity = options.identity;
    this.#ingress = options.ingress;
  }

  start(sink: TransportSink): void {
    this.#sink = sink;
    this.#unsubscribeRoutes ??= this.#ingress.onLinkedRoutes("slack", (ids) => {
      this.#linked = ids === null || ids.has(this.#identity.workspaceId);
      this.#report(this.#ingress.state());
    });
    this.#release ??= this.#ingress.acquire("slack");
    this.#unsubscribe ??= this.#ingress.onState((state) => this.#report(state));
    this.#report(this.#ingress.state());
  }

  reconnect(): void {}

  readonly stop = Effect.fn("SlackEvents.stop")(() =>
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

  readonly deliver = Effect.fn("SlackEvents.deliver")((delivery: IngressDelivery) =>
    Effect.sync((): IngressAnswer => {
      const sink = this.#sink;
      if (!sink) return { status: 503 };
      if (delivery.platform !== "slack") return { status: 400 };
      const text = new TextDecoder().decode(delivery.body);
      if (delivery.kind === "interactivity") {
        const payload = parseRecord(new URLSearchParams(text).get("payload") ?? "");
        if (!payload) return { status: 400 };
        if (payload.api_app_id !== undefined && payload.api_app_id !== this.#identity.appId) return { status: 404 };
        const action = slackInboundAction(payload, this.#identity.workspaceId);
        if (action) sink.action(action);
        return OK;
      }
      const body = parseRecord(text);
      if (!body) return { status: 400 };
      if (body.type !== "event_callback") return OK;
      if (body.api_app_id !== this.#identity.appId) return { status: 404 };
      if (isString(body.event_id) && this.#remember(body.event_id)) return OK;
      const event = body.event;
      if (isDynamicRecord(event) && (event.type === "app_uninstalled" || event.type === "tokens_revoked")) {
        sink.state("invalid_token");
        return OK;
      }
      if (isDynamicRecord(event) && event.type === "channel_created") {
        if (isDynamicRecord(event.channel) && isString(event.channel.id)) sink.placeCreated?.(event.channel.id);
        return OK;
      }
      const message = slackInboundMessage(body, this.#identity.workspaceId, this.#identity.botUserId);
      if (message) sink.message(message);
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

  #remember(eventId: string): boolean {
    if (this.#seen.has(eventId)) return true;
    this.#seen.add(eventId);
    if (this.#seen.size > RECENT_EVENTS) {
      const oldest = this.#seen.values().next().value;
      if (oldest !== undefined) this.#seen.delete(oldest);
    }
    return false;
  }
}

function parseRecord(text: string): DynamicRecord | null {
  try {
    const value = JSON.parse(text);
    return isDynamicRecord(value) ? value : null;
  } catch {
    return null;
  }
}
