import { describe, expect, it } from "vitest";
import { TEAM_CURRENT_CAPABILITIES } from "./current";
import clientRequest from "./fixtures/host-tailscale-v1/client-request.json";
import clientRequestDirect from "./fixtures/host-tailscale-v1/client-request-direct.json";
import hostResponse from "./fixtures/host-tailscale-v1/host-response.json";
import hostResponseSignIn from "./fixtures/host-tailscale-v1/host-response-sign-in.json";
import { HOST_TAILSCALE_CAPABILITY, HOST_TAILSCALE_ROUTES } from "./host-tailscale-v1";
import { optionalRouteCodec } from "./optional-routes";
import { teamSideRouteCodec } from "./side-routes";
import { TEAM_PROTOCOL_V1_CAPABILITIES } from "./v1";
import { TEAM_PROTOCOL_V6_CAPABILITIES } from "./v6";

function codec(path: string) {
  const found = optionalRouteCodec(path);
  if (!found) throw new Error(`No codec for ${path}.`);
  return found;
}

describe("host-tailscale-v1", () => {
  it("keeps the frozen capability string and routes", () => {
    expect(HOST_TAILSCALE_CAPABILITY).toBe("host-tailscale-v1");
    expect(HOST_TAILSCALE_ROUTES).toEqual({
      status: "/v1/admin/host/tailscale/status",
      direct: "/v1/admin/host/tailscale/direct",
      signIn: "/v1/admin/host/tailscale/sign-in",
    });
    expect(TEAM_CURRENT_CAPABILITIES).toContain(HOST_TAILSCALE_CAPABILITY);
    // Optional: no released protocol base set names it, so an older peer is not changed.
    expect(TEAM_PROTOCOL_V1_CAPABILITIES).not.toContain(HOST_TAILSCALE_CAPABILITY);
    expect(TEAM_PROTOCOL_V6_CAPABILITIES).not.toContain(HOST_TAILSCALE_CAPABILITY);
  });

  it("round-trips the client and host fixtures on every transport", () => {
    for (const route of Object.values(HOST_TAILSCALE_ROUTES)) {
      expect(codec(route).response(200, hostResponse)).toEqual(hostResponse);
      expect(codec(route).response(200, hostResponseSignIn)).toEqual(hostResponseSignIn);
      expect(teamSideRouteCodec(route)?.response(route, 200, hostResponse)).toEqual(hostResponse);
    }
    expect(codec(HOST_TAILSCALE_ROUTES.status).request(clientRequest)).toEqual({});
    expect(codec(HOST_TAILSCALE_ROUTES.signIn).request(clientRequest)).toEqual({});
    expect(codec(HOST_TAILSCALE_ROUTES.direct).request(clientRequestDirect)).toEqual({ enabled: true });
  });

  it("drops a field the contract does not name", () => {
    expect(codec(HOST_TAILSCALE_ROUTES.status).response(200, { ...hostResponse, authKey: "tskey-auth-x" })).toEqual(
      hostResponse,
    );
    expect(codec(HOST_TAILSCALE_ROUTES.signIn).request({ authKey: "tskey-auth-x" })).toEqual({});
    expect(codec(HOST_TAILSCALE_ROUTES.direct).request({ enabled: false, funnel: true })).toEqual({ enabled: false });
  });

  it("rejects a malformed request", () => {
    expect(() => codec(HOST_TAILSCALE_ROUTES.direct).request({})).toThrow();
    expect(() => codec(HOST_TAILSCALE_ROUTES.direct).request({ enabled: "true" })).toThrow();
  });

  // The client opens `loginUrl` in the owner's browser. Only the Tailscale sign-in page is accepted.
  it("rejects a sign-in address that is not the Tailscale sign-in page", () => {
    const { response } = codec(HOST_TAILSCALE_ROUTES.signIn);
    for (const url of [
      "http://login.tailscale.com/a/1a2b3c",
      "https://login.tailscale.com/a/",
      "https://login.tailscale.com/a/1a2b3c?next=https://evil.example",
      "https://login.tailscale.com/a/1a2b3c/../../admin",
      "https://login.tailscale.com.evil.example/a/1a2b3c",
      "https://evil.example/a/1a2b3c",
      "https://login.tailscale.com/admin/machines",
      "javascript:alert(1)",
      "",
    ]) {
      expect(() => response(200, { ...hostResponseSignIn, loginUrl: url }), url).toThrow();
    }
  });

  it("rejects a direct address or a device name that is not a tailnet name", () => {
    const { response } = codec(HOST_TAILSCALE_ROUTES.status);
    for (const url of [
      "http://home-server.tail4b2c1.ts.net",
      "https://home-server.tail4b2c1.ts.net/x",
      "https://a.b",
    ]) {
      expect(() => response(200, { ...hostResponse, url }), url).toThrow();
    }
    for (const dnsName of ["home-server.tail4b2c1.ts.net.", "Home.tail4b2c1.ts.net", "a.b.c.ts.net", "evil.com"]) {
      expect(() => response(200, { ...hostResponse, dnsName }), dnsName).toThrow();
    }
    expect(() => response(200, { ...hostResponse, state: "running" })).toThrow();
    expect(() => response(200, { ...hostResponse, issue: "unknown" })).toThrow();
    expect(() => response(200, { ...hostResponse, environment: "darwin" })).toThrow();
    expect(() => response(200, { ...hostResponse, wslNetworking: "bridged" })).toThrow();
    expect(() => response(200, { ...hostResponse, signInIssue: "denied" })).toThrow();
    expect(() => response(200, { ...hostResponse, tailnet: "x".repeat(201) })).toThrow();
    const { setupCommand: _, ...withoutSetup } = hostResponse;
    expect(() => response(200, withoutSetup)).toThrow();
  });

  it("keeps the error envelope", () => {
    expect(codec(HOST_TAILSCALE_ROUTES.status).response(403, { error: "Only the owner." })).toEqual({
      error: "Only the owner.",
    });
  });
});
