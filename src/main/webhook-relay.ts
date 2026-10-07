import { WEBHOOK_EVENTS_PATH } from "@openbot/contracts/signal-protocol/webhook-route";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { CentralAuthOperationError } from "./central-auth-effects";
import { HostEventsFailure } from "./host-events-api";
import type { HostWebhookRelay } from "./host-events-service";
import type { SignalIngress } from "./signal-ingress";

export interface WebhookRelayAccount {
  registerWebhookRoute(hostId: string, routeId: string): Effect.Effect<{ routeId: string }, CentralAuthOperationError>;
  revokeWebhookRoute(hostId: string, routeId: string): Effect.Effect<void, CentralAuthOperationError>;
  issueRemoteHostTicket(hostId: string): Effect.Effect<{ signalUrl: string }, CentralAuthOperationError>;
}

export interface WebhookRelayOptions {
  account: WebhookRelayAccount;
  ingress: SignalIngress;
  hostId(): string | null;
}

/** Owns route metadata calls and the ingress lease. Payloads never enter the account service. */
export class WebhookRelay implements HostWebhookRelay {
  readonly #options: WebhookRelayOptions;
  #release: (() => void) | null = null;
  #publicOrigin: { hostId: string; url: string } | null = null;

  constructor(options: WebhookRelayOptions) {
    this.#options = options;
  }

  connected(): boolean {
    return this.#options.ingress.webhookReady();
  }

  setEnabled(enabled: boolean): void {
    if (enabled && !this.#release) this.#release = this.#options.ingress.acquireWebhooks();
    else if (!enabled && this.#release) {
      this.#release();
      this.#release = null;
    }
  }

  stop(): void {
    this.setEnabled(false);
    this.#options.ingress.handleWebhooks(null);
  }

  readonly registerSource = Effect.fn("WebhookRelay.registerSource")(function* (this: WebhookRelay, sourceId: string) {
    const hostId = yield* this.#host();
    yield* this.#options.account.registerWebhookRoute(hostId, sourceId);
    if (this.#publicOrigin?.hostId !== hostId) {
      const ticket = yield* this.#options.account.issueRemoteHostTicket(hostId);
      const url = new URL(ticket.signalUrl);
      url.protocol = url.protocol === "ws:" ? "http:" : "https:";
      url.pathname = WEBHOOK_EVENTS_PATH;
      url.search = "";
      url.hash = "";
      this.#publicOrigin = { hostId, url: url.toString() };
    }
    this.setEnabled(true);
    this.#options.ingress.reconnect();
    return `${this.#publicOrigin.url}/${encodeURIComponent(sourceId)}`;
  }).bind(this);

  readonly revokeSource = Effect.fn("WebhookRelay.revokeSource")(function* (this: WebhookRelay, sourceId: string) {
    const hostId = yield* this.#host();
    yield* this.#options.account.revokeWebhookRoute(hostId, sourceId);
    this.#options.ingress.reconnect();
  }).bind(this);

  readonly #host = Effect.fn("WebhookRelay.host")(function* (this: WebhookRelay) {
    const hostId = this.#options.hostId();
    if (!hostId)
      return yield* new HostEventsFailure({ cause: new Error(sourceText("error.backend.webhookRouteUnavailable")) });
    return hostId;
  });
}
