import { createHmac, timingSafeEqual } from "node:crypto";
import { WEBHOOK_DELIVERY_BODY_BYTES_LIMIT } from "@openbot/contracts/signal-protocol/messages";
import {
  WEBHOOK_DELIVERY_ID_PATTERN,
  WEBHOOK_TIMESTAMP_PATTERN,
} from "@openbot/contracts/signal-protocol/webhook-route";
import { Schema } from "effect";

/** Signatures outside this clock window are replays, even if the secret is valid. */
const WEBHOOK_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
/**
 * Also accepts an upper-case `SHA256=` prefix, which the shared pattern refuses. Signal refuses that
 * prefix first, so the difference does not reach this check.
 */
const WEBHOOK_SIGNATURE_PATTERN = /^sha256=[0-9a-f]{64}$/i;
const WEBHOOK_SIGNATURE_PREFIX = "sha256=";

/** Does not retain the input, secret, or native error. It is safe to show and log. */
class WebhookSecurityError extends Schema.TaggedError<WebhookSecurityError>()("WebhookSecurityError", {
  code: Schema.Literals([
    "body_too_large",
    "invalid_timestamp",
    "stale_timestamp",
    "invalid_delivery_id",
    "invalid_signature",
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

function fail(code: WebhookSecurityError["code"]): never {
  throw new WebhookSecurityError({ code });
}

/** HMAC-SHA256 over the exact bytes `timestamp.deliveryId.body`. */
function signatureDigest(secret: string, timestamp: string, deliveryId: string, body: Uint8Array): Buffer {
  return createHmac("sha256", secret).update(`${timestamp}.${deliveryId}.`).update(body).digest();
}

/** Formats the documented `sha256=<lowercase hex>` signature header. */
export function createWebhookSignature(
  secret: string,
  timestamp: string,
  deliveryId: string,
  body: Uint8Array,
): string {
  return `${WEBHOOK_SIGNATURE_PREFIX}${signatureDigest(secret, timestamp, deliveryId, body).toString("hex")}`;
}

/**
 * Checks input bounds, timestamp freshness, and the HMAC in constant time.
 *
 * The caller should deduplicate `(routine, deliveryId)` after this check and before a run starts.
 */
export function verifyWebhookSignature(secret: string, input: WebhookSignatureInput, signature: string): void {
  if (input.body.byteLength > WEBHOOK_DELIVERY_BODY_BYTES_LIMIT) fail("body_too_large");
  if (!WEBHOOK_TIMESTAMP_PATTERN.test(input.timestamp)) fail("invalid_timestamp");
  if (Math.abs(Number(input.timestamp) * 1000 - (input.nowMs ?? Date.now())) > WEBHOOK_MAX_CLOCK_SKEW_MS)
    fail("stale_timestamp");
  // The shared patterns are the relay's rules. The timestamp has at most 12 digits, so it is a safe
  // integer, and the delivery ID excludes CR/LF.
  if (!WEBHOOK_DELIVERY_ID_PATTERN.test(input.deliveryId)) fail("invalid_delivery_id");
  if (!WEBHOOK_SIGNATURE_PATTERN.test(signature)) fail("invalid_signature");
  const expected = signatureDigest(secret, input.timestamp, input.deliveryId, input.body);
  const supplied = Buffer.from(signature.slice(WEBHOOK_SIGNATURE_PREFIX.length), "hex");
  // The pattern makes both values 32 bytes, so `timingSafeEqual` does not throw.
  if (!timingSafeEqual(expected, supplied)) fail("invalid_signature");
}
