import { createHmac, timingSafeEqual } from "node:crypto";
import { WEBHOOK_DELIVERY_BODY_BYTES_LIMIT } from "@openbot/contracts/signal-protocol/messages";
import {
  STANDARD_WEBHOOK_SIGNATURE_PATTERN,
  WEBHOOK_DELIVERY_ID_PATTERN,
  WEBHOOK_MAX_CLOCK_SKEW_SECONDS,
  WEBHOOK_TIMESTAMP_PATTERN,
} from "@openbot/contracts/signal-protocol/webhook-route";
import { Schema } from "effect";

const WEBHOOK_MAX_CLOCK_SKEW_MS = WEBHOOK_MAX_CLOCK_SKEW_SECONDS * 1000;
const WEBHOOK_SIGNATURE_PATTERN = /^sha256=[0-9a-f]{64}$/i;
const WEBHOOK_SIGNATURE_PREFIX = "sha256=";
const STANDARD_WEBHOOK_SIGNATURE_VERSION = "v1,";
const STANDARD_WEBHOOK_SECRET_PREFIX = "whsec_";
const STANDARD_WEBHOOK_MINIMUM_KEY_BYTES = 16;
const SHA256_BYTES = 32;

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
  timestamp: string;
  deliveryId: string;
  body: Uint8Array;
  nowMs?: number;
}

function fail(code: WebhookSecurityError["code"]): never {
  throw new WebhookSecurityError({ code });
}

function signatureDigest(secret: string, timestamp: string, deliveryId: string, body: Uint8Array): Buffer {
  return createHmac("sha256", secret).update(`${timestamp}.${deliveryId}.`).update(body).digest();
}

export function signWebhookBody(secret: string, timestamp: string, deliveryId: string, body: Uint8Array): string {
  return `${WEBHOOK_SIGNATURE_PREFIX}${signatureDigest(secret, timestamp, deliveryId, body).toString("hex")}`;
}

function verifyWebhookInput(input: WebhookSignatureInput): void {
  if (input.body.byteLength > WEBHOOK_DELIVERY_BODY_BYTES_LIMIT) fail("body_too_large");
  if (!WEBHOOK_TIMESTAMP_PATTERN.test(input.timestamp)) fail("invalid_timestamp");
  if (Math.abs(Number(input.timestamp) * 1000 - (input.nowMs ?? Date.now())) > WEBHOOK_MAX_CLOCK_SKEW_MS)
    fail("stale_timestamp");
  if (!WEBHOOK_DELIVERY_ID_PATTERN.test(input.deliveryId)) fail("invalid_delivery_id");
}

export function verifyWebhookSignature(secret: string, input: WebhookSignatureInput, signature: string): void {
  verifyWebhookInput(input);
  if (!WEBHOOK_SIGNATURE_PATTERN.test(signature)) fail("invalid_signature");
  const expected = signatureDigest(secret, input.timestamp, input.deliveryId, input.body);
  const supplied = Buffer.from(signature.slice(WEBHOOK_SIGNATURE_PREFIX.length), "hex");
  if (!timingSafeEqual(expected, supplied)) fail("invalid_signature");
}

function standardWebhookKeys(secret: string): Buffer[] {
  const keys = [Buffer.from(secret, "utf8")];
  if (secret.startsWith(STANDARD_WEBHOOK_SECRET_PREFIX)) {
    const encoded = secret.slice(STANDARD_WEBHOOK_SECRET_PREFIX.length);
    for (const encoding of ["base64", "base64url"] as const) {
      const decoded = Buffer.from(encoded, encoding);
      if (decoded.byteLength >= STANDARD_WEBHOOK_MINIMUM_KEY_BYTES && decoded.toString(encoding) === encoded)
        keys.push(decoded);
    }
  }
  return keys;
}

export function verifyStandardWebhookSignature(secret: string, input: WebhookSignatureInput, signature: string): void {
  verifyWebhookInput(input);
  if (!STANDARD_WEBHOOK_SIGNATURE_PATTERN.test(signature)) fail("invalid_signature");
  const supplied = signature
    .split(" ")
    .filter((entry) => entry.startsWith(STANDARD_WEBHOOK_SIGNATURE_VERSION))
    .map((entry) => Buffer.from(entry.slice(STANDARD_WEBHOOK_SIGNATURE_VERSION.length), "base64"))
    .filter((value) => value.byteLength === SHA256_BYTES);
  const expected = standardWebhookKeys(secret).map((key) =>
    createHmac("sha256", key).update(`${input.deliveryId}.${input.timestamp}.`).update(input.body).digest(),
  );
  if (!supplied.some((value) => expected.some((digest) => timingSafeEqual(digest, value)))) fail("invalid_signature");
}
