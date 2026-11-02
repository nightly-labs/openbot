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
      "/v1/me/analytics",
      "/v1/me/avatar",
      "/v1/mobile/features?platform=ios&version=1.2.0",
      "/v1/mobile/changelog?platform=ios&after=1.4.1",
      "/v1/avatars/user-id?v=photo-version",
      "/v1/mobile-auth/devices?includeDesktop=true",
      "/v1/mobile-auth/devices/session-id?includeDesktop=true",
      "/v2/remote/hosts/",
      "/v2/remote/sessions/",
      "/v2/remote/sessions/session-1/ticket",
      "/v2/remote/sessions/session-1/end",
      "/v2/remote/invites/preview",
      "/v2/remote/invites/accept",
      "/v2/remote/hosts/host-1/",
      "/v2/remote/hosts/host-1/members/member-1",
      "/v2/remote/hosts/host-1/logo?v=logo-version",
      "/v1/agent-templates/AbCdEfGhIjKlMnOpQrSt_-",
      "/v1/agent-templates/AbCdEfGhIjKlMnOpQrSt_-/avatar",
      "/v2/hosting/plans",
      "/v2/hosting/servers/",
      "/v2/hosting/servers/server-1/checkout",
      "/v2/hosting/servers/server-1/wake",
      "/v2/hosting/servers/server-1/restart",
    ]) {
      expect(developmentNetworkRequestAllowed("192.168.1.20", path)).toBe(true);
    }
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v1/auth/logout")).toBe(false);
    // A development code follows from the challenge ID, so email sign-in stays on loopback.
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v1/auth/email/start")).toBe(false);
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v1/mobile-auth/email/verify")).toBe(false);
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v1/mobile-auth/ticket")).toBe(false);
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v1/mobile-auth/devices/session-id/other")).toBe(false);
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v1/me/other")).toBe(false);
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v1/mobile/other")).toBe(false);
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v1/mobile/changelog/other")).toBe(false);
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v1/avatars/user-id/other")).toBe(false);
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v1/agent-templates/mine")).toBe(false);
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v1/agent-templates/template-id/card")).toBe(false);
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v2/remote/hosts/register")).toBe(false);
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v2/remote/hosts/host-1/slack-route")).toBe(false);
    for (const path of [
      "/v2/remote/hosts/host-1/telegram-link",
      "/v2/remote/hosts/host-1/telegram-route",
      "/v2/remote/hosts/host-1/telegram-disconnect",
      "/v2/remote/telegram-route/link",
      "/v2/remote/telegram-route/validate",
    ]) {
      expect(developmentNetworkRequestAllowed("192.168.1.20", path)).toBe(false);
    }
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v2/slack/authorize")).toBe(false);
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v2/remote/hosts/host-1/logo/other")).toBe(false);
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v2/remote/sessions/session-1/other")).toBe(false);
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v2/hosting/servers/server-1/activity")).toBe(false);
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v2/hosting/servers/server-1")).toBe(false);
    expect(developmentNetworkRequestAllowed("192.168.1.20", "/v2/hosting/servers/server-1/restart/other")).toBe(false);
  });

  it("exposes the public Marketplace catalog to the phone and keeps account reads on loopback", () => {
    for (const path of [
      "/v1/skills/?sort=installs&limit=50",
      "/v1/skills/skill-1",
      "/v1/skills/skill-1/icon",
      "/v1/marketplace/agents/?category=coding&limit=50",
      "/v1/marketplace/agents/listing-1",
      "/v1/marketplace/agents/listing-1/avatar",
      "/plugins/icon/linear?app=linear",
    ]) {
      expect(developmentNetworkRequestAllowed("192.168.1.20", path)).toBe(true);
    }
    for (const path of [
      "/v1/skills/mine",
      "/v1/skills/admin/submissions",
      "/v1/skills/skill-1/install",
      "/v1/skills/skill-1/content",
      "/v1/skills/skill-1/versions/version-1",
      "/v1/marketplace/agents/mine",
      "/v1/marketplace/agents/admin/submissions",
      "/v1/marketplace/agents/listing-1/install",
      "/v1/marketplace",
      "/plugins/linear",
      "/plugins/icon/linear/other",
    ]) {
      expect(developmentNetworkRequestAllowed("192.168.1.20", path)).toBe(false);
    }
  });
});
