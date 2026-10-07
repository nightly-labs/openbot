import { describe, expect, it } from "vitest";
import {
  createWebhookSignature,
  isPublicIpAddress,
  verifyWebhookSignature,
  WEBHOOK_MAX_BODY_BYTES,
  webhookSigningBytes,
} from "./webhook-security";

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
    expect(webhookSigningBytes(timestamp, "delivery-1", BODY).toString()).toBe(
      `${timestamp}.delivery-1.${BODY.toString()}`,
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
        { timestamp, deliveryId: "delivery-1", body: Buffer.alloc(WEBHOOK_MAX_BODY_BYTES + 1), nowMs: NOW },
        signature,
      ),
    ).toThrowError(expect.objectContaining({ code: "body_too_large" }));
    expect(() =>
      verifyWebhookSignature(SECRET, { timestamp, deliveryId: "delivery-1", body: BODY, nowMs: NOW }, "sha256=00"),
    ).toThrowError(expect.objectContaining({ code: "invalid_signature" }));
  });
});

describe("webhook destination IP policy", () => {
  it("allows global unicast addresses and denies private, special, and mapped addresses", () => {
    expect(isPublicIpAddress("8.8.8.8")).toBe(true);
    expect(isPublicIpAddress("2001:4860:4860::8888")).toBe(true);
    expect(isPublicIpAddress("127.0.0.1")).toBe(false);
    expect(isPublicIpAddress("169.254.169.254")).toBe(false);
    expect(isPublicIpAddress("10.0.0.1")).toBe(false);
    expect(isPublicIpAddress("::1")).toBe(false);
    expect(isPublicIpAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicIpAddress("::ffff:8.8.8.8")).toBe(true);
    expect(isPublicIpAddress("2001:db8::1")).toBe(false);
    expect(isPublicIpAddress("2001:0000:4136:e378:8000:63bf:3fff:fdd2")).toBe(false);
  });
});
