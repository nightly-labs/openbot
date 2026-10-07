import { createHmac, timingSafeEqual } from "node:crypto";
import { WEBHOOK_DELIVERY_BODY_BYTES_LIMIT } from "@openbot/contracts/signal-protocol/messages";
import { Schema } from "effect";

/** Signatures outside this clock window are replays, even if the secret is valid. */
const WEBHOOK_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
/** Keep header values bounded before they reach HMAC or a request parser. */
const WEBHOOK_MAX_TIMESTAMP_BYTES = 32;
const WEBHOOK_MAX_SIGNATURE_BYTES = 160;
/** The relay applies the same rule, so a delivery ID that it forwards always passes here. */
const WEBHOOK_DELIVERY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

type WebhookSecurityFailureCode =
  | "body_too_large"
  | "invalid_body"
  | "invalid_timestamp"
  | "stale_timestamp"
  | "invalid_delivery_id"
  | "invalid_signature"
  | "invalid_secret";

/** Does not retain the input, secret, or native error. It is safe to show and log. */
class WebhookSecurityError extends Schema.TaggedError<WebhookSecurityError>()("WebhookSecurityError", {
  code: Schema.Literals([
    "body_too_large",
    "invalid_body",
    "invalid_timestamp",
    "stale_timestamp",
    "invalid_delivery_id",
    "invalid_signature",
    "invalid_secret",
  ]),
}) {}

export interface WebhookSignatureInput {
  /** Unix time in seconds, encoded as an ASCII decimal string. */
  timestamp: string;
  /** A route-scoped delivery ID. It is also the deduplication key. */
  deliveryId: string;
  /** The exact bytes received on the wire. */
  body: Uint8Array;
  /** Unix time in milliseconds. Defaults to Date.now(). */
  nowMs?: number;
}

function fail(code: WebhookSecurityFailureCode): never {
  throw new WebhookSecurityError({ code });
}

function secretBytes(secret: string | Uint8Array): Buffer {
  const bytes = typeof secret === "string" ? Buffer.from(secret, "utf8") : Buffer.from(secret);
  if (bytes.length === 0 || bytes.length > 1024) fail("invalid_secret");
  return bytes;
}

function validateBody(body: Uint8Array): Buffer {
  if (!(body instanceof Uint8Array)) fail("invalid_body");
  if (body.byteLength > WEBHOOK_DELIVERY_BODY_BYTES_LIMIT) fail("body_too_large");
  return Buffer.from(body);
}

function validateTimestampSyntax(timestamp: string): number {
  if (
    typeof timestamp !== "string" ||
    Buffer.byteLength(timestamp, "ascii") > WEBHOOK_MAX_TIMESTAMP_BYTES ||
    !/^[0-9]{1,12}$/.test(timestamp)
  )
    fail("invalid_timestamp");
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds)) fail("invalid_timestamp");
  return seconds;
}

function validateTimestamp(timestamp: string, nowMs: number): number {
  const seconds = validateTimestampSyntax(timestamp);
  if (Math.abs(seconds * 1000 - nowMs) > WEBHOOK_MAX_CLOCK_SKEW_MS) fail("stale_timestamp");
  return seconds;
}

function validateDeliveryId(deliveryId: string): void {
  // Header values are deliberately narrower than arbitrary UTF-8. This also excludes CR/LF.
  if (typeof deliveryId !== "string" || !WEBHOOK_DELIVERY_ID_PATTERN.test(deliveryId)) fail("invalid_delivery_id");
}

/** The exact bytes that a webhook signature covers. */
function webhookSigningBytes(timestamp: string, deliveryId: string, body: Uint8Array): Buffer {
  validateTimestampSyntax(timestamp);
  validateDeliveryId(deliveryId);
  const bytes = validateBody(body);
  return Buffer.concat([
    Buffer.from(timestamp, "ascii"),
    Buffer.from("."),
    Buffer.from(deliveryId, "ascii"),
    Buffer.from("."),
    bytes,
  ]);
}

/** Formats the documented `sha256=<lowercase hex>` signature header. */
export function createWebhookSignature(
  secret: string | Uint8Array,
  timestamp: string,
  deliveryId: string,
  body: Uint8Array,
): string {
  const bytes = webhookSigningBytes(timestamp, deliveryId, body);
  return `sha256=${createHmac("sha256", secretBytes(secret)).update(bytes).digest("hex")}`;
}

/**
 * Checks timestamp freshness, input bounds, and the HMAC in constant time.
 *
 * The caller should deduplicate `(routine, deliveryId)` after this check and before a run starts.
 */
export function verifyWebhookSignature(
  secret: string | Uint8Array,
  input: WebhookSignatureInput,
  signature: string,
): void {
  const nowMs = input.nowMs ?? Date.now();
  const body = validateBody(input.body);
  validateTimestamp(input.timestamp, nowMs);
  validateDeliveryId(input.deliveryId);
  if (
    typeof signature !== "string" ||
    Buffer.byteLength(signature, "ascii") > WEBHOOK_MAX_SIGNATURE_BYTES ||
    !/^sha256=[0-9a-f]{64}$/i.test(signature)
  )
    fail("invalid_signature");

  const expected = Buffer.from(createWebhookSignature(secret, input.timestamp, input.deliveryId, body).slice(7), "hex");
  const supplied = Buffer.from(signature.slice(7), "hex");
  // timingSafeEqual throws for unequal lengths. The length check keeps this a safe constant-time
  // comparison for valid-length values, while malformed values have already taken the same path.
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) fail("invalid_signature");
}
