import { describe, expect, it } from "vitest";
import { isAgentSummary } from "../ipc-agents";
import request from "./fixtures/v6/client-http-request.json";
import response from "./fixtures/v6/host-http-response.json";
import models from "./fixtures/v6/host-models-response.json";
import status from "./fixtures/v6/host-status-response.json";
import { decodeTeamProtocolV5CurrentHttpRequest, decodeTeamProtocolV5CurrentHttpResponse } from "./v5-adapter";
import {
  decodeTeamProtocolV6CurrentHttpRequest,
  decodeTeamProtocolV6CurrentHttpResponse,
  encodeTeamProtocolV6CurrentHttpRequest,
  encodeTeamProtocolV6CurrentHttpResponse,
} from "./v6-adapter";
import { decodeTeamProtocolV6BaseCurrentEvent, encodeTeamProtocolV6BaseCurrentEvent } from "./v6-base-adapter";
import {
  createTeamProtocolV6Event,
  decodeTeamProtocolV6CurrentEvent,
  decodeTeamProtocolV6WebRtcHttpResponse,
  encodeTeamProtocolV6WebRtcHttpRequest,
  encodeTeamProtocolV6WebRtcHttpResponse,
} from "./v6-webrtc-adapter";

describe("Team protocol v6", () => {
  it("round-trips Cursor and Cline agents with Cursor model ids, and v5 still refuses them", () => {
    expect(decodeTeamProtocolV6CurrentHttpRequest("PATCH", "/v1/agents/agent-cursor", request)).toEqual(request);
    expect(encodeTeamProtocolV6WebRtcHttpRequest("PATCH", "/v1/agents/agent-cursor", request)).toEqual(request);
    expect(() => decodeTeamProtocolV5CurrentHttpRequest("PATCH", "/v1/agents/agent-cursor", request)).toThrow();
    for (const [path, value] of [
      ["/v1/agents", response],
      ["/v1/agents/status", status],
      ["/v1/agents/models", models],
    ] as const) {
      expect(JSON.parse(encodeTeamProtocolV6CurrentHttpResponse("GET", path, 200, value))).toEqual(value);
      expect(decodeTeamProtocolV6CurrentHttpResponse("GET", path, 200, value)).toEqual(value);
      expect(encodeTeamProtocolV6WebRtcHttpResponse("GET", path, 200, value)).toEqual(value);
      expect(decodeTeamProtocolV6WebRtcHttpResponse("GET", path, 200, value)).toEqual(value);
      expect(() => decodeTeamProtocolV5CurrentHttpResponse("GET", path, 200, value)).toThrow();
    }
    expect(() =>
      decodeTeamProtocolV6CurrentHttpResponse("GET", "/v1/agents", 200, [{ ...response[0], provider: "unknown" }]),
    ).toThrow();
  });

  it("carries a chosen Cursor or Cline model on agent creation", () => {
    for (const choice of [
      { provider: "cursor", model: "gpt-5.6-sol[context=272k,reasoning=medium,fast=false]" },
      { provider: "cline", model: "cline/free-model" },
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
        encodeTeamProtocolV6CurrentHttpRequest("POST", "/v1/agents", input, { agentCreateModel: true }),
      );
      expect(wire).toMatchObject(choice);
      expect(decodeTeamProtocolV6CurrentHttpRequest("POST", "/v1/agents", wire, { agentCreateModel: true })).toEqual(
        input,
      );
      expect(() =>
        decodeTeamProtocolV5CurrentHttpRequest("POST", "/v1/agents", wire, { agentCreateModel: true }),
      ).toThrow();
    }
  });

  it("carries Cursor agent events through HTTP events and WebRTC", () => {
    const agents = response.map((agent) => {
      if (!isAgentSummary(agent)) throw new Error("Invalid v6 fixture.");
      return agent;
    });
    const event = { type: "agents-changed" as const, agents };
    const wire = encodeTeamProtocolV6BaseCurrentEvent(event);
    expect(decodeTeamProtocolV6BaseCurrentEvent(JSON.parse(wire ?? "null"))).toEqual({ kind: "known", event });
    expect(decodeTeamProtocolV6CurrentEvent(createTeamProtocolV6Event(1, JSON.parse(wire ?? "null")))).toEqual({
      status: "known",
      event,
    });
  });
});
