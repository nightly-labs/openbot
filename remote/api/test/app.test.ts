import { describe, expect, it, vi } from "vitest";
import { createRemoteApiApp, signalClientIp } from "../src/app";
import { readRemoteApiConfig } from "../src/config";
import { SignalService } from "../src/signal-service";
import { RemoteTokenService, signServiceRequest } from "../src/tokens";

describe("Remote API proxy addresses", () => {
  it("uses the first forwarded address only when the proxy is trusted", () => {
    expect(signalClientIp("127.0.0.1", "198.51.100.20, 127.0.0.1", true)).toBe("198.51.100.20");
    expect(signalClientIp("203.0.113.8", "198.51.100.20", false)).toBe("203.0.113.8");
  });
});

describe("Remote API development configuration", () => {
  it("uses the Auth API public JWKS binding for a local Signal service", () => {
    expect(
      readRemoteApiConfig({
        REMOTE_TICKET_PUBLIC_JWKS: '{"keys":[]}',
        REMOTE_TLS_DISABLED: "true",
        REMOTE_CONTROL_PLANE_URL: "http://127.0.0.1:3100",
        REMOTE_SESSION_SECRET: "s".repeat(32),
        REMOTE_AUTH_WEBHOOK_SECRET: "w".repeat(32),
        TURN_SHARED_SECRET: "t".repeat(32),
        TURN_HOST: "192.168.1.143",
      }).ticketJwks,
    ).toBe('{"keys":[]}');
  });
});

describe("signed account notifications", () => {
  it("verifies the exact HTTP body before delivering profile invalidation", async () => {
    const config = readRemoteApiConfig({
      REMOTE_TICKET_JWKS_URL: "https://api.example.test/.well-known/jwks.json",
      REMOTE_TLS_DISABLED: "true",
      REMOTE_CONTROL_PLANE_URL: "http://127.0.0.1:3100",
      REMOTE_SESSION_SECRET: "s".repeat(32),
      REMOTE_AUTH_WEBHOOK_SECRET: "w".repeat(32),
      TURN_SHARED_SECRET: "t".repeat(32),
      TURN_HOST: "localhost",
    });
    const signal = new SignalService(new RemoteTokenService(config), 8);
    const changed = vi.spyOn(signal, "profileChanged");
    const app = createRemoteApiApp(config, signal);
    const body = '{ "type": "account-profile-changed", "userId": "user-1" }';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signServiceRequest(body, timestamp, config.authWebhookSecret);
    const send = (payload: string, signed: string) =>
      app.handle(
        new Request("http://localhost/internal/auth-events", {
          method: "POST",
          headers: { "Content-Type": "application/json", "OpenBot-Timestamp": timestamp, "OpenBot-Signature": signed },
          body: payload,
        }),
      );
    const response = await send(body, signature);
    expect(response.status, await response.text()).toBe(204);
    expect(changed).toHaveBeenCalledWith("user-1");
    changed.mockClear();
    expect((await send(body.replace("user-1", "user-2"), signature)).status).toBe(401);
    expect((await send(body, "")).status).toBe(401);
    expect(changed).not.toHaveBeenCalled();
  });
});
