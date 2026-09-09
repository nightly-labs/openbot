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
  decodeTeamProtocolV4WebRtcHttpRequest,
  decodeTeamProtocolV4WebRtcHttpResponse,
  encodeTeamProtocolV4WebRtcHttpRequest,
  encodeTeamProtocolV4WebRtcHttpResponse,
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

it.each([encodeTeamProtocolV4WebRtcHttpResponse, decodeTeamProtocolV4WebRtcHttpResponse])(
  "%s accepts successful bodyless deletion responses",
  (adapt) => {
    for (const path of [
      "/v1/agents/agent-1",
      "/v1/agents/agent-1/memories/memory-1",
      "/v1/agents/agent-1/routines/routine-1",
    ]) {
      expect(adapt("DELETE", path, 204, undefined)).toEqual({});
    }
  },
);

it.each([encodeTeamProtocolV4WebRtcHttpRequest, decodeTeamProtocolV4WebRtcHttpRequest])(
  "%s preserves bodyless manual routine runs",
  (adapt) => {
    for (const body of [undefined, null, {}]) {
      expect(adapt("POST", "/v1/agents/agent-1/routines/routine-1/test", body)).toEqual({});
    }
  },
);

it.each([encodeTeamProtocolV4WebRtcHttpRequest, decodeTeamProtocolV4WebRtcHttpRequest])(
  "%s preserves remote-viewer authorization requests",
  (adapt) => {
    expect(adapt("POST", "/v1/remote-screen/sessions/session-1/authorize", { code: "viewer-code" })).toEqual({
      code: "viewer-code",
    });
  },
);

it.each([encodeTeamProtocolV4WebRtcHttpResponse, decodeTeamProtocolV4WebRtcHttpResponse])(
  "%s preserves remote-viewer responses",
  (adapt) => {
    for (const route of ["viewer", "authorize", "viewer-state", "moonlight/api/role"]) {
      const payload = { ready: true };
      expect(
        adapt(route === "authorize" ? "POST" : "GET", `/v1/remote-screen/sessions/session-1/${route}`, 200, payload),
      ).toEqual(payload);
    }
  },
);
