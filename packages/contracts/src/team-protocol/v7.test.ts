import { describe, expect, it } from "vitest";
import { isCustomAgentId, isNewCustomAgentId } from "../agent-providers";
import { isAgentSummary } from "../ipc-agents";
import request from "./fixtures/v7/client-http-request.json";
import response from "./fixtures/v7/host-http-response.json";
import models from "./fixtures/v7/host-models-response.json";
import status from "./fixtures/v7/host-status-response.json";
import { PROVIDERS_V4_CODECS, PROVIDERS_V4_ROUTES } from "./providers-v4";
import { PROVIDERS_V5_CODECS, PROVIDERS_V5_ROUTES } from "./providers-v5";
import { decodeTeamProtocolV6CurrentHttpRequest, decodeTeamProtocolV6CurrentHttpResponse } from "./v6-adapter";
import {
  decodeTeamProtocolV7CurrentHttpRequest,
  decodeTeamProtocolV7CurrentHttpResponse,
  encodeTeamProtocolV7CurrentHttpRequest,
  encodeTeamProtocolV7CurrentHttpResponse,
} from "./v7-adapter";
import { decodeTeamProtocolV7BaseCurrentEvent, encodeTeamProtocolV7BaseCurrentEvent } from "./v7-base-adapter";
import {
  createTeamProtocolV7Event,
  decodeTeamProtocolV7CurrentEvent,
  decodeTeamProtocolV7WebRtcHttpRequest,
  decodeTeamProtocolV7WebRtcHttpResponse,
  encodeTeamProtocolV7WebRtcHttpRequest,
  encodeTeamProtocolV7WebRtcHttpResponse,
} from "./v7-webrtc-adapter";

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
  it.each(["pi", "muse"])("preserves %s on agent creation over HTTP and WebRTC", (provider) => {
    const input = {
      name: "Helper",
      description: "Helps out.",
      avatarSeed: "setup:helper",
      avatarHue: null,
      initialMessage: "Greet me briefly.",
      provider,
      model: "provider/model",
    };
    const options = { agentCreateModel: true };
    const wire = JSON.parse(encodeTeamProtocolV7CurrentHttpRequest("POST", "/v1/agents", input, options));
    expect(decodeTeamProtocolV7CurrentHttpRequest("POST", "/v1/agents", wire, options)).toEqual(input);
    const peerWire = encodeTeamProtocolV7WebRtcHttpRequest("POST", "/v1/agents", input, options);
    expect(decodeTeamProtocolV7WebRtcHttpRequest("POST", "/v1/agents", peerWire, options)).toEqual(input);
    expect(() => decodeTeamProtocolV6CurrentHttpRequest("POST", "/v1/agents", wire, options)).toThrow();
  });
  it("round-trips the client and host fixtures, and v6 still refuses them", () => {
    expect(decodeTeamProtocolV7CurrentHttpRequest("PATCH", "/v1/agents/agent-pi", request)).toEqual(request);
    expect(encodeTeamProtocolV7WebRtcHttpRequest("PATCH", "/v1/agents/agent-pi", request)).toEqual(request);
    expect(() => decodeTeamProtocolV6CurrentHttpRequest("PATCH", "/v1/agents/agent-pi", request)).toThrow();
    for (const [path, value] of [
      ["/v1/agents", response],
      ["/v1/agents/status", status],
      ["/v1/agents/models", models],
    ] as const) {
      expect(JSON.parse(encodeTeamProtocolV7CurrentHttpResponse("GET", path, 200, value))).toEqual(value);
      expect(decodeTeamProtocolV7CurrentHttpResponse("GET", path, 200, value)).toEqual(value);
      expect(encodeTeamProtocolV7WebRtcHttpResponse("GET", path, 200, value)).toEqual(value);
      expect(decodeTeamProtocolV7WebRtcHttpResponse("GET", path, 200, value)).toEqual(value);
      expect(() => decodeTeamProtocolV6CurrentHttpResponse("GET", path, 200, value)).toThrow();
    }
  });
  it("carries Pi and Muse agent events through HTTP events and WebRTC", () => {
    const agents = response.map((agent) => {
      if (!isAgentSummary(agent)) throw new Error("Invalid v7 fixture.");
      return agent;
    });
    const event = { type: "agents-changed" as const, agents };
    const wire = encodeTeamProtocolV7BaseCurrentEvent(event);
    expect(decodeTeamProtocolV7BaseCurrentEvent(JSON.parse(wire ?? "null"))).toEqual({ kind: "known", event });
    expect(decodeTeamProtocolV7CurrentEvent(createTeamProtocolV7Event(1, JSON.parse(wire ?? "null")))).toEqual({
      status: "known",
      event,
    });
  });
  it("keeps Meta keys write-only in the new administration contract", () => {
    expect(PROVIDERS_V5_CODECS.get(PROVIDERS_V5_ROUTES.apiKeySet)?.response(200, { key: "secret" })).toEqual({});
    expect(
      PROVIDERS_V5_CODECS.get(PROVIDERS_V5_ROUTES.apiKeyState)?.response(200, { status: "saved", key: "secret" }),
    ).toEqual({ status: "saved" });
  });
});
