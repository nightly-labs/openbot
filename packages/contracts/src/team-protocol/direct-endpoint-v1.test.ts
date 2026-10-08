import { describe, expect, it } from "vitest";
import { TEAM_CURRENT_CAPABILITIES } from "./current";
import { DIRECT_ENDPOINT_CAPABILITY, DIRECT_ENDPOINT_ROUTES } from "./direct-endpoint-v1";
import clientRequest from "./fixtures/direct-endpoint-v1/client-request.json";
import hostResponse from "./fixtures/direct-endpoint-v1/host-response.json";
import hostResponseOff from "./fixtures/direct-endpoint-v1/host-response-off.json";
import hostResponsePort from "./fixtures/direct-endpoint-v1/host-response-port.json";
import { optionalRouteCodec } from "./optional-routes";
import { teamSideRouteCodec } from "./side-routes";
import { TEAM_PROTOCOL_V1_CAPABILITIES } from "./v1";
import { TEAM_PROTOCOL_V6_CAPABILITIES } from "./v6";

function codec() {
  const found = optionalRouteCodec(DIRECT_ENDPOINT_ROUTES.read);
  if (!found) throw new Error("No direct endpoint codec.");
  return found;
}

describe("direct-endpoint-v1", () => {
  it("keeps the frozen capability string and route", () => {
    expect(DIRECT_ENDPOINT_CAPABILITY).toBe("direct-endpoint-v1");
    expect(DIRECT_ENDPOINT_ROUTES.read).toBe("/v1/direct-endpoint");
    expect(TEAM_CURRENT_CAPABILITIES).toContain(DIRECT_ENDPOINT_CAPABILITY);
    // Optional: no released protocol base set names it, so an older peer is not changed.
    expect(TEAM_PROTOCOL_V1_CAPABILITIES).not.toContain(DIRECT_ENDPOINT_CAPABILITY);
    expect(TEAM_PROTOCOL_V6_CAPABILITIES).not.toContain(DIRECT_ENDPOINT_CAPABILITY);
  });

  it("round-trips the client and host fixtures on every transport", () => {
    expect(codec().request(clientRequest)).toEqual({});
    expect(codec().response(200, hostResponse)).toEqual(hostResponse);
    expect(codec().response(200, hostResponsePort)).toEqual(hostResponsePort);
    expect(codec().response(200, hostResponseOff)).toEqual({ url: null });
    const side = teamSideRouteCodec(DIRECT_ENDPOINT_ROUTES.read);
    expect(side?.response(DIRECT_ENDPOINT_ROUTES.read, 200, hostResponse)).toEqual(hostResponse);
  });

  it("drops a field the contract does not name", () => {
    expect(codec().response(200, { ...hostResponse, tailnet: "owner@example.com" })).toEqual(hostResponse);
    expect(codec().request({ token: "secret" })).toEqual({});
  });

  // A host can only point a member at a Tailscale HTTPS name. Anything else fails closed.
  it("rejects an address that is not a tailnet HTTPS name", () => {
    for (const url of [
      "http://studio-mac.tail4b2c1.ts.net",
      "https://studio-mac.tail4b2c1.ts.net/",
      "https://studio-mac.tail4b2c1.ts.net/v1",
      "https://studio-mac.tail4b2c1.ts.net?x=1",
      "https://user@studio-mac.tail4b2c1.ts.net",
      "https://ts.net",
      "https://tail4b2c1.ts.net",
      "https://a.b.c.ts.net",
      "https://studio-mac.tail4b2c1.ts.net.evil.com",
      "https://Studio-Mac.tail4b2c1.ts.net",
      "https://-mac.tail4b2c1.ts.net",
      "https://studio-mac.tail4b2c1.ts.net:0",
      "https://studio-mac.tail4b2c1.ts.net:99999",
      "https://100.64.0.1",
      "https://studio-mac.tail4b2c1.ts.net:8443:1",
      "",
    ]) {
      expect(() => codec().response(200, { url }), url).toThrow();
    }
    expect(() => codec().response(200, {})).toThrow();
    expect(() => codec().response(200, { url: 1 })).toThrow();
  });

  it("keeps the error envelope", () => {
    expect(codec().response(400, { error: "Not offered." })).toEqual({ error: "Not offered." });
  });
});
