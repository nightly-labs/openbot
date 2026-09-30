import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
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

/** Slack sends a request again when the answer is late, with the same `event_id`. */
const RECENT_EVENTS = 2_000;
const OK: IngressAnswer = { status: 200 };

export interface SlackEventsTransportOptions {
  identity: ConnectionIdentity;
  ingress: MessagingIngress;
}

/**
 * The inbound half of one workspace's OpenBot app: the Events API, which Slack posts to Signal.
 * Signal checks Slack's signature, which only it can, and passes the workspace's requests to this
 * host. This holds the ingress socket open while it runs and answers at once. The agent's work
 * starts after the answer, because Slack gives up after three seconds.
 */
export class SlackEventsTransport implements MessagingTransport {
  readonly #identity: ConnectionIdentity;
  readonly #ingress: MessagingIngress;
  readonly #seen = new Set<string>();
  #sink: TransportSink | null = null;
  #release: (() => void) | null = null;
  #unsubscribe: (() => void) | null = null;

  constructor(options: SlackEventsTransportOptions) {
    this.#identity = options.identity;
    this.#ingress = options.ingress;
  }

  start(sink: TransportSink): void {
    this.#sink = sink;
    this.#release ??= this.#ingress.acquire();
    this.#unsubscribe ??= this.#ingress.onState((state) => this.#report(state));
    this.#report(this.#ingress.state());
  }

  /** The main process reconnects the ingress socket itself when the computer wakes. */
  reconnect(): void {}

  async stop(): Promise<void> {
    this.#sink = null;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#release?.();
    this.#release = null;
  }

  async deliver(delivery: IngressDelivery): Promise<IngressAnswer> {
    const sink = this.#sink;
    if (!sink) return { status: 503 };
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
    const message = slackInboundMessage(body, this.#identity.workspaceId, this.#identity.botUserId);
    if (message) sink.message(message);
    return OK;
  }

  #report(state: IngressState): void {
    this.#sink?.state(state === "online" ? "connected" : state === "connecting" ? "connecting" : "relay_unavailable");
  }

  /** True when the event was already handled. */
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

/** A Slack payload is always a JSON object. Anything else is a request Slack did not send. */
function parseRecord(text: string): DynamicRecord | null {
  try {
    const value = JSON.parse(text);
    return isDynamicRecord(value) ? value : null;
  } catch {
    return null;
  }
}
