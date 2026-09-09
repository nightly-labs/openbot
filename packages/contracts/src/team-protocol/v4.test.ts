import { describe, expect, it } from "vitest";
import { isAgentSummary } from "../ipc-agents";
import request from "./fixtures/v4/client-http-request.json";
import response from "./fixtures/v4/host-http-response.json";
import { decodeTeamProtocolV3CurrentHttpResponse } from "./v3-adapter";
import {
  decodeTeamProtocolV4CurrentHttpRequest,
  decodeTeamProtocolV4CurrentHttpResponse,
  encodeTeamProtocolV4CurrentHttpResponse,
} from "./v4-adapter";
import { decodeTeamProtocolV4BaseCurrentEvent, encodeTeamProtocolV4BaseCurrentEvent } from "./v4-base-adapter";
import {
  createTeamProtocolV4Event,
  decodeTeamProtocolV4CurrentEvent,
  encodeTeamProtocolV4WebRtcHttpRequest,
} from "./v4-webrtc-adapter";

describe("Team protocol v4", () => {
  it("round-trips OpenCode agent and model selection without widening v3", () => {
    expect(decodeTeamProtocolV4CurrentHttpRequest("PATCH", "/v1/agents/agent-opencode", request)).toEqual(request);
    expect(encodeTeamProtocolV4WebRtcHttpRequest("PATCH", "/v1/agents/agent-opencode", request)).toEqual(request);
    expect(JSON.parse(encodeTeamProtocolV4CurrentHttpResponse("GET", "/v1/agents", 200, response))).toEqual(response);
    expect(decodeTeamProtocolV4CurrentHttpResponse("GET", "/v1/agents", 200, response)).toEqual(response);
    expect(() => decodeTeamProtocolV3CurrentHttpResponse("GET", "/v1/agents", 200, response)).toThrow();
    expect(() =>
      decodeTeamProtocolV4CurrentHttpResponse("GET", "/v1/agents", 200, [{ ...response[0], provider: "unknown" }]),
    ).toThrow();
  });

  it("carries OpenCode agent events through HTTP events and WebRTC", () => {
    const agent = response[0];
    if (!isAgentSummary(agent)) throw new Error("Invalid v4 fixture.");
    const event = { type: "agents-changed" as const, agents: [agent] };
    const wire = encodeTeamProtocolV4BaseCurrentEvent(event);
    expect(decodeTeamProtocolV4BaseCurrentEvent(JSON.parse(wire ?? "null"))).toEqual({ kind: "known", event });
    expect(decodeTeamProtocolV4CurrentEvent(createTeamProtocolV4Event(1, JSON.parse(wire ?? "null")))).toEqual({
      status: "known",
      event,
    });
  });
});
