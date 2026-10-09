import { createHmac } from "node:crypto";
import { WEBHOOK_DELIVERY_BODY_BYTES_LIMIT } from "@openbot/contracts/signal-protocol/messages";
import { describe, expect, it } from "vitest";
import { createWebhookSignature, verifyWebhookSignature } from "./webhook-security";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const SECRET = "webhook-signing-secret-for-tests-0123456789";
const BODY = Buffer.from('{"ok":true}', "utf8");

describe("webhook signatures", () => {
  it("covers the exact timestamp, delivery ID, and body bytes", () => {
    const timestamp = String(Math.floor(NOW / 1000));
    const signature = createWebhookSignature(SECRET, timestamp, "delivery-1", BODY);

    expect(() =>
      verifyWebhookSignature(SECRET, { timestamp, deliveryId: "delivery-1", body: BODY, nowMs: NOW }, signature),
    ).not.toThrow();
    // The documented contract: HMAC-SHA256 over `timestamp.deliveryId.body`.
    expect(signature).toBe(
      `sha256=${createHmac("sha256", SECRET).update(`${timestamp}.delivery-1.${BODY.toString()}`).digest("hex")}`,
    );

    expect(() =>
      verifyWebhookSignature(
        SECRET,
        { timestamp, deliveryId: "delivery-1", body: Buffer.from('{"ok":false}'), nowMs: NOW },
        signature,
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid_signature" }));
  });

  it("rejects stale, malformed, replay-shaped, and oversized input before dispatch", () => {
    const timestamp = String(Math.floor(NOW / 1000));
    const signature = createWebhookSignature(SECRET, timestamp, "delivery-1", BODY);
    expect(() =>
      verifyWebhookSignature(
        SECRET,
        { timestamp, deliveryId: "delivery-1", body: BODY, nowMs: NOW + 5 * 60 * 1000 + 1 },
        signature,
      ),
    ).toThrowError(expect.objectContaining({ code: "stale_timestamp" }));
    expect(() =>
      verifyWebhookSignature(SECRET, { timestamp, deliveryId: "delivery/1", body: BODY, nowMs: NOW }, signature),
    ).toThrowError(expect.objectContaining({ code: "invalid_delivery_id" }));
    expect(() =>
      verifyWebhookSignature(
        SECRET,
        { timestamp, deliveryId: "delivery-1", body: Buffer.alloc(WEBHOOK_DELIVERY_BODY_BYTES_LIMIT + 1), nowMs: NOW },
        signature,
      ),
    ).toThrowError(expect.objectContaining({ code: "body_too_large" }));
    expect(() =>
      verifyWebhookSignature(SECRET, { timestamp, deliveryId: "delivery-1", body: BODY, nowMs: NOW }, "sha256=00"),
    ).toThrowError(expect.objectContaining({ code: "invalid_signature" }));
  });
});
