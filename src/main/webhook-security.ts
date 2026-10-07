import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { WEBHOOK_DELIVERY_BODY_BYTES_LIMIT } from "@openbot/contracts/signal-protocol/messages";
import { Schema } from "effect";

/** Signatures outside this clock window are replays, even if the secret is valid. */
const WEBHOOK_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
/** Keep header values bounded before they reach HMAC or a request parser. */
const WEBHOOK_MAX_TIMESTAMP_BYTES = 32;
const WEBHOOK_MAX_SIGNATURE_BYTES = 160;
/** The relay applies the same rule, so a delivery ID that it forwards always passes here. */
const WEBHOOK_DELIVERY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export type WebhookSecurityFailureCode =
  | "body_too_large"
  | "invalid_body"
  | "invalid_timestamp"
  | "stale_timestamp"
  | "invalid_delivery_id"
  | "invalid_signature"
  | "invalid_secret";

/** Does not retain the input, secret, or native error. It is safe to show and log. */
export class WebhookSecurityError extends Schema.TaggedError<WebhookSecurityError>()("WebhookSecurityError", {
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

/** The exact bytes covered by both inbound and outbound signatures. */
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

function parseIpv4(value: string): Uint8Array | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^[0-9]{1,3}$/.test(part))) return null;
  const bytes = parts.map(Number);
  if (bytes.some((part) => part > 255)) return null;
  return Uint8Array.from(bytes);
}

/** Parses a resolver address without accepting zones or non-canonical numeric forms. */
function parseIpv6(value: string): Uint8Array | null {
  if (value.includes("%") || value.includes("[") || value.includes("]")) return null;
  let normalized = value;
  const lastColon = normalized.lastIndexOf(":");
  if (normalized.includes(".") && lastColon >= 0) {
    const ipv4 = parseIpv4(normalized.slice(lastColon + 1));
    if (!ipv4) return null;
    normalized = `${normalized.slice(0, lastColon + 1)}${(((ipv4[0] ?? 0) << 8) | (ipv4[1] ?? 0)).toString(16)}:${(
      ((ipv4[2] ?? 0) << 8) | (ipv4[3] ?? 0)
    ).toString(16)}`;
  }
  const marker = normalized.indexOf("::");
  if (marker !== normalized.lastIndexOf("::")) return null;
  const hasCompression = marker >= 0;
  const leftText = hasCompression ? normalized.slice(0, marker) : normalized;
  const rightText = hasCompression ? normalized.slice(marker + 2) : "";
  const left = leftText ? leftText.split(":") : [];
  const right = rightText ? rightText.split(":") : [];
  const groups = [...left, ...right];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
  const missing = 8 - groups.length;
  if ((hasCompression && missing < 1) || (!hasCompression && missing !== 0)) return null;
  const expanded = [...left, ...Array.from({ length: Math.max(0, missing) }, () => "0"), ...right];
  if (expanded.length !== 8) return null;
  const bytes = new Uint8Array(16);
  expanded.forEach((group, index) => {
    const value16 = Number.parseInt(group, 16);
    bytes[index * 2] = value16 >>> 8;
    bytes[index * 2 + 1] = value16 & 0xff;
  });
  return bytes;
}

function ipv4IsPublic(bytes: Uint8Array): boolean {
  const value =
    ((bytes[0] ?? 0) * 0x1000000 + (bytes[1] ?? 0) * 0x10000 + (bytes[2] ?? 0) * 0x100 + (bytes[3] ?? 0)) >>> 0;
  const inRange = (start: number, end: number) => value >= start && value <= end;
  // Allow only globally routable unicast space. This blocks private, loopback, link-local,
  // shared, documentation, benchmark, multicast, broadcast, and future-reserved space.
  return !(
    inRange(0x00000000, 0x00ffffff) ||
    inRange(0x0a000000, 0x0affffff) ||
    inRange(0x64400000, 0x647fffff) ||
    inRange(0x7f000000, 0x7fffffff) ||
    inRange(0xa9fe0000, 0xa9feffff) ||
    inRange(0xac100000, 0xac1fffff) ||
    inRange(0xc0000000, 0xc00000ff) ||
    inRange(0xc0000200, 0xc00002ff) ||
    inRange(0xc0586300, 0xc05863ff) ||
    inRange(0xc0a80000, 0xc0a8ffff) ||
    inRange(0xc6120000, 0xc613ffff) ||
    inRange(0xc6336400, 0xc63364ff) ||
    inRange(0xcb007100, 0xcb0071ff) ||
    inRange(0xe0000000, 0xffffffff)
  );
}

function ipv6IsPublic(bytes: Uint8Array): boolean {
  const allZero = bytes.every((value) => value === 0);
  if (allZero) return false;
  // IPv4-mapped and IPv4-compatible addresses inherit the IPv4 policy.
  const mapped = bytes.slice(0, 10).every((value) => value === 0) && (bytes[10] === 0xff || bytes[10] === 0);
  if (mapped && bytes[10] === 0xff && bytes[11] === 0xff) return ipv4IsPublic(bytes.slice(12, 16));
  if (mapped && bytes[10] === 0 && bytes[11] === 0) return ipv4IsPublic(bytes.slice(12, 16));
  const first16 = ((bytes[0] ?? 0) << 8) | (bytes[1] ?? 0);
  // Global unicast addresses are currently 2000::/3. Reject all other ranges, then reject
  // documented and special allocations inside that range.
  if ((first16 & 0xe000) !== 0x2000) return false;
  const second16 = ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0);
  // 2001:0000::/23 contains Teredo and protocol assignments. 2001:db8 is documentation,
  // 2001:2 is benchmarking, and 2001:10::/28 is an old special-use allocation.
  if (
    first16 === 0x2001 &&
    (second16 <= 0x01ff || second16 === 0x0db8 || second16 === 0x0002 || (second16 & 0xfff0) === 0x0010)
  )
    return false;
  if (first16 === 0x2002) return false;
  if (first16 === 0x3fff && (second16 & 0xf000) === 0x0000) return false;
  return true;
}

/** True only for globally routable unicast IPv4 or IPv6 addresses. */
export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const bytes = parseIpv4(address);
    return bytes !== null && ipv4IsPublic(bytes);
  }
  if (family === 6) {
    const bytes = parseIpv6(address);
    return bytes !== null && ipv6IsPublic(bytes);
  }
  return false;
}
