export const WEBHOOK_ROUTE_AUDIENCE = "openbot-webhook-route";

export const WEBHOOK_EVENTS_PATH = "/v1/webhooks";

export const WEBHOOK_TIMESTAMP_HEADER = "x-openbot-timestamp";
export const WEBHOOK_DELIVERY_ID_HEADER = "x-openbot-delivery-id";
export const WEBHOOK_SIGNATURE_HEADER = "x-openbot-signature";

export const WEBHOOK_MAX_CLOCK_SKEW_SECONDS = 5 * 60;

export const WEBHOOK_ROUTE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
export const WEBHOOK_TIMESTAMP_PATTERN = /^[0-9]{1,12}$/u;
export const WEBHOOK_DELIVERY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
export const WEBHOOK_SIGNATURE_PATTERN = /^sha256=[A-Fa-f0-9]{64}$/u;

export const STANDARD_WEBHOOKS_FORMAT = "standard-webhooks";
export type WebhookSignatureFormat = typeof STANDARD_WEBHOOKS_FORMAT;
export const STANDARD_WEBHOOK_HEADER_SETS = [
  { deliveryId: "webhook-id", timestamp: "webhook-timestamp", signature: "webhook-signature" },
  { deliveryId: "svix-id", timestamp: "svix-timestamp", signature: "svix-signature" },
] as const;
export const STANDARD_WEBHOOK_SIGNATURE_PATTERN =
  /^[a-z0-9]{1,8},[A-Za-z0-9+/=]{1,128}(?: [a-z0-9]{1,8},[A-Za-z0-9+/=]{1,128}){0,7}$/u;

export const WEBHOOK_ROUTE_TTL_SECONDS = 5 * 60;

export const WEBHOOK_ROUTES_LIMIT = 64;

export interface WebhookRoute {
  id: string;
  linkedAt: number;
}
