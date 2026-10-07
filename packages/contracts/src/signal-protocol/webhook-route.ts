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

// The syntax of the opaque route ID in the public URL and of the three signed header values.
// Signal refuses other values before it reads the body; the host checks them again.
export const WEBHOOK_ROUTE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
export const WEBHOOK_TIMESTAMP_PATTERN = /^[0-9]{1,12}$/u;
export const WEBHOOK_DELIVERY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
export const WEBHOOK_SIGNATURE_PATTERN = /^sha256=[A-Fa-f0-9]{64}$/u;

// Signal checks this when an ingress socket connects. The host asks for a fresh ticket on every
// connection, so deleting a route takes effect when the socket reconnects as well as
// through the revocation event.
export const WEBHOOK_ROUTE_TTL_SECONDS = 5 * 60;

// One host may register many webhook routines, but the route ticket must stay bounded.
export const WEBHOOK_ROUTES_LIMIT = 64;

export interface WebhookRoute {
  id: string;
  /** When the account service registered this route, in milliseconds. */
  linkedAt: number;
}
