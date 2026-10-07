import { WEBHOOK_EVENTS_PATH } from "@openbot/contracts/signal-protocol/webhook-route";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { CentralAuthOperationError } from "./central-auth-effects";
import { HostEventsFailure, WebhookRouteConflict } from "./host-events-api";
import type { HostWebhookRelay } from "./host-events-service";
import type { SignalIngress } from "./signal-ingress";

interface WebhookRelayAccount {
  registerWebhookRoute(hostId: string, routeId: string): Effect.Effect<void, CentralAuthOperationError>;
  revokeWebhookRoute(hostId: string, routeId: string): Effect.Effect<void, CentralAuthOperationError>;
  issueRemoteHostTicket(hostId: string): Effect.Effect<{ signalUrl: string }, CentralAuthOperationError>;
}

export interface WebhookRelayOptions {
  account: WebhookRelayAccount;
  ingress: SignalIngress;
  hostId(): string | null;
}

/** The account service keeps a revoked route ID, and one that another host or account owns, for good. */
function isRouteConflict(failure: CentralAuthOperationError): boolean {
  const { cause } = failure;
  return cause instanceof Error && "code" in cause && cause.code === "webhook_route_conflict";
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

  setAccountActive(active: boolean): void {
    // Reconnect before releasing the webhook hold. Signal then builds its next hello with the
    // current principal and route set. Releasing afterwards closes the socket when no other
    // ingress consumer holds it.
    if (this.#release) this.#options.ingress.reconnect();
    if (!active) this.setEnabled(false);
  }

  /**
   * Opens a new socket, so Signal issues a route ticket with the current routes. Without the hold,
   * `setEnabled(true)` opens that socket, so a second reconnect here is not necessary.
   */
  refresh(): void {
    if (this.#release) this.#options.ingress.reconnect();
  }

  stop(): void {
    this.setEnabled(false);
    this.#options.ingress.handleWebhooks(null);
  }

  readonly registerRoute = Effect.fn("WebhookRelay.registerRoute")(function* (this: WebhookRelay, routeId: string) {
    const hostId = yield* this.#host();
    yield* this.#options.account
      .registerWebhookRoute(hostId, routeId)
      .pipe(Effect.mapError((failure) => (isRouteConflict(failure) ? new WebhookRouteConflict() : failure)));
    if (this.#publicOrigin?.hostId !== hostId) {
      const ticket = yield* this.#options.account.issueRemoteHostTicket(hostId);
      const url = new URL(ticket.signalUrl);
      url.protocol = url.protocol === "ws:" ? "http:" : "https:";
      url.pathname = WEBHOOK_EVENTS_PATH;
      url.search = "";
      url.hash = "";
      this.#publicOrigin = { hostId, url: url.toString() };
    }
    return `${this.#publicOrigin.url}/${encodeURIComponent(routeId)}`;
  }).bind(this);

  readonly revokeRoute = Effect.fn("WebhookRelay.revokeRoute")(function* (this: WebhookRelay, routeId: string) {
    const hostId = yield* this.#host();
    yield* this.#options.account.revokeWebhookRoute(hostId, routeId);
  }).bind(this);

  readonly #host = Effect.fn("WebhookRelay.host")(function* (this: WebhookRelay) {
    const hostId = this.#options.hostId();
    if (!hostId)
      return yield* new HostEventsFailure({ cause: new Error(sourceText("error.backend.webhookRouteUnavailable")) });
    return hostId;
  });
}
