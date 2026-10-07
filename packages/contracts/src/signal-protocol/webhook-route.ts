// A generic webhook route: Signal maps one opaque public route ID to the host that registered it.
// The host makes the route ID when a routine gets a webhook trigger. The account service
// stores only that ownership metadata and signs it into the short-lived ingress ticket.

export const WEBHOOK_ROUTE_AUDIENCE = "openbot-webhook-route";

export const WEBHOOK_EVENTS_PATH = "/v1/webhooks";

// The relay forwards these values without normalizing them. Keep the names shared with the host
// verifier so the public contract cannot drift between Signal and the desktop.
export const WEBHOOK_TIMESTAMP_HEADER = "x-openbot-timestamp";
export const WEBHOOK_DELIVERY_ID_HEADER = "x-openbot-delivery-id";
export const WEBHOOK_SIGNATURE_HEADER = "x-openbot-signature";

// Signal checks this when an ingress socket connects. The host asks for a fresh ticket on every
// connection, so deleting a route takes effect when the socket reconnects as well as
// through the revocation event.
export const WEBHOOK_ROUTE_TTL_SECONDS = 5 * 60;

// One host may register many webhook routines, but the route ticket must stay bounded.
export const WEBHOOK_ROUTES_LIMIT = 64;

export interface WebhookRouteClaims {
  aud: typeof WEBHOOK_ROUTE_AUDIENCE;
  /** The remote host that receives the requests. */
  hid: string;
  /** Opaque webhook route IDs linked to that host. */
  routes: WebhookRoute[];
  iat: number;
  exp: number;
}

export interface WebhookRoute {
  id: string;
  /** When the account service registered this route, in milliseconds. */
  linkedAt: number;
}
