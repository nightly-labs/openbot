import { describe, expect, it } from "vitest";
import { isAgentSummary } from "../ipc-agents";
import request from "./fixtures/v5/client-http-request.json";
import response from "./fixtures/v5/host-http-response.json";
import models from "./fixtures/v5/host-models-response.json";
import status from "./fixtures/v5/host-status-response.json";
import { decodeTeamProtocolV4CurrentHttpRequest, decodeTeamProtocolV4CurrentHttpResponse } from "./v4-adapter";
import {
  decodeTeamProtocolV5CurrentHttpRequest,
  decodeTeamProtocolV5CurrentHttpResponse,
  encodeTeamProtocolV5CurrentHttpRequest,
  encodeTeamProtocolV5CurrentHttpResponse,
} from "./v5-adapter";
import { decodeTeamProtocolV5BaseCurrentEvent, encodeTeamProtocolV5BaseCurrentEvent } from "./v5-base-adapter";
import {
  createTeamProtocolV5Event,
  decodeTeamProtocolV5CurrentEvent,
  decodeTeamProtocolV5WebRtcHttpResponse,
  encodeTeamProtocolV5WebRtcHttpRequest,
  encodeTeamProtocolV5WebRtcHttpResponse,
} from "./v5-webrtc-adapter";

describe("Team protocol v5", () => {
  it("round-trips Gemini and custom ACP agents, and v4 still refuses them", () => {
    expect(decodeTeamProtocolV5CurrentHttpRequest("PATCH", "/v1/agents/agent-gemini", request)).toEqual(request);
    expect(encodeTeamProtocolV5WebRtcHttpRequest("PATCH", "/v1/agents/agent-gemini", request)).toEqual(request);
    expect(() => decodeTeamProtocolV4CurrentHttpRequest("PATCH", "/v1/agents/agent-gemini", request)).toThrow();
    for (const [path, value] of [
      ["/v1/agents", response],
      ["/v1/agents/status", status],
      ["/v1/agents/models", models],
    ] as const) {
      expect(JSON.parse(encodeTeamProtocolV5CurrentHttpResponse("GET", path, 200, value))).toEqual(value);
      expect(decodeTeamProtocolV5CurrentHttpResponse("GET", path, 200, value)).toEqual(value);
      expect(encodeTeamProtocolV5WebRtcHttpResponse("GET", path, 200, value)).toEqual(value);
      expect(decodeTeamProtocolV5WebRtcHttpResponse("GET", path, 200, value)).toEqual(value);
      expect(() => decodeTeamProtocolV4CurrentHttpResponse("GET", path, 200, value)).toThrow();
    }
    expect(() =>
      decodeTeamProtocolV5CurrentHttpResponse("GET", "/v1/agents", 200, [{ ...response[0], provider: "unknown" }]),
    ).toThrow();
  });

  it("carries a chosen Gemini or custom ACP model on agent creation", () => {
    for (const choice of [
      { provider: "antigravity", model: "gemini-3-pro" },
      { provider: "acp", model: "goose/default" },
    ]) {
      const input = {
        name: "Helper",
        description: "Helps out.",
        avatarSeed: "setup:helper",
        avatarHue: null,
        initialMessage: "Greet me briefly.",
        ...choice,
      };
      const wire = JSON.parse(
        encodeTeamProtocolV5CurrentHttpRequest("POST", "/v1/agents", input, { agentCreateModel: true }),
      );
      expect(wire).toMatchObject(choice);
      expect(decodeTeamProtocolV5CurrentHttpRequest("POST", "/v1/agents", wire, { agentCreateModel: true })).toEqual(
        input,
      );
      expect(() =>
        decodeTeamProtocolV4CurrentHttpRequest("POST", "/v1/agents", wire, { agentCreateModel: true }),
      ).toThrow();
    }
  });

  it("carries Gemini agent events through HTTP events and WebRTC", () => {
    const agents = response.map((agent) => {
      if (!isAgentSummary(agent)) throw new Error("Invalid v5 fixture.");
      return agent;
    });
    const event = { type: "agents-changed" as const, agents };
    const wire = encodeTeamProtocolV5BaseCurrentEvent(event);
    expect(decodeTeamProtocolV5BaseCurrentEvent(JSON.parse(wire ?? "null"))).toEqual({ kind: "known", event });
    expect(decodeTeamProtocolV5CurrentEvent(createTeamProtocolV5Event(1, JSON.parse(wire ?? "null")))).toEqual({
      status: "known",
      event,
    });
  });
});
