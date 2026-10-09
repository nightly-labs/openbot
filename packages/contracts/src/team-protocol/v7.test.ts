import { describe, expect, it } from "vitest";
import { isCustomAgentId, isNewCustomAgentId } from "../agent-providers";
import { PROVIDERS_V4_CODECS, PROVIDERS_V4_ROUTES } from "./providers-v4";
import { PROVIDERS_V5_CODECS, PROVIDERS_V5_ROUTES } from "./providers-v5";
import { decodeTeamProtocolV6CurrentHttpRequest } from "./v6-adapter";
import { decodeTeamProtocolV7CurrentHttpRequest } from "./v7-adapter";
import { encodeTeamProtocolV7WebRtcHttpRequest } from "./v7-webrtc-adapter";

// Failure modes: new provider values reach an old decoder; existing custom agent IDs become unreadable.
describe("Team protocol v7 provider boundaries", () => {
  it.each(["pi", "muse"])("carries %s without changing released contracts or custom IDs", (provider) => {
    const input = { provider, model: "provider/model" };
    expect(decodeTeamProtocolV7CurrentHttpRequest("PATCH", "/v1/agents/agent-1", input)).toEqual(input);
    expect(encodeTeamProtocolV7WebRtcHttpRequest("PATCH", "/v1/agents/agent-1", input)).toEqual(input);
    expect(() => decodeTeamProtocolV6CurrentHttpRequest("PATCH", "/v1/agents/agent-1", input)).toThrow();
    expect(PROVIDERS_V5_CODECS.get(PROVIDERS_V5_ROUTES.runtimesDownload)?.request({ provider })).toEqual({ provider });
    expect(() => PROVIDERS_V4_CODECS.get(PROVIDERS_V4_ROUTES.runtimesDownload)?.request({ provider })).toThrow();
    expect(isCustomAgentId(provider)).toBe(true);
    expect(isNewCustomAgentId(provider)).toBe(false);
  });
  it("keeps Meta keys write-only in the new administration contract", () => {
    expect(PROVIDERS_V5_CODECS.get(PROVIDERS_V5_ROUTES.apiKeySet)?.response(200, { key: "secret" })).toEqual({});
    expect(
      PROVIDERS_V5_CODECS.get(PROVIDERS_V5_ROUTES.apiKeyState)?.response(200, { status: "saved", key: "secret" }),
    ).toEqual({ status: "saved" });
  });
});
