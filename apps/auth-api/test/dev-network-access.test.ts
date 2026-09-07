import { describe, expect, it } from "vitest";
import { developmentNetworkRequestAllowed } from "../dev-network-access";

describe("development Auth API LAN access", () => {
  it("keeps the full development API available on loopback", () => {
    expect(developmentNetworkRequestAllowed("127.0.0.1", "/v1/auth/email/start")).toBe(true);
    expect(developmentNetworkRequestAllowed("::1", "/v1/marketplace/agents")).toBe(true);
    expect(developmentNetworkRequestAllowed("::ffff:127.0.0.1", "/v1/auth/email/start")).toBe(true);
  });

  it("exposes mobile connections and account settings to the local network", () => {
    for (const path of [
      "/v1/mobile-auth/redeem",
      "/v1/mobile-auth/session",
      "/v1/me",
      "/v1/me/profile",
      "/v1/me/avatar",
      "/v1/avatars/user-id?v=photo-version",
      "/v1/mobile-auth/devices?includeDesktop=true",
      "/v1/mobile-auth/devices/session-id?includeDesktop=true",
      "/v2/remote/hosts/",
      "/v2/remote/sessions/",
      "/v2/remote/sessions/session-1/ticket",
      "/v2/remote/sessions/session-1/end",
      "/v2/remote/invites/preview",
      "/v2/remote/invites/accept",
      "/v2/remote/hosts/host-1/members/member-1",
    ]) {
      expect(developmentNetworkRequestAllowed("192.168.1.20", path)).toBe(true);
    }
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v1/auth/logout")).toBe(false);
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v1/auth/email/start")).toBe(false);
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v1/mobile-auth/ticket")).toBe(false);
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v1/mobile-auth/devices/session-id/other")).toBe(false);
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v1/me/other")).toBe(false);
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v1/avatars/user-id/other")).toBe(false);
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v2/remote/hosts/register")).toBe(false);
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v2/remote/sessions/session-1/other")).toBe(false);
  });
});
