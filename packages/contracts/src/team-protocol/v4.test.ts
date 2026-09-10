import { describe, expect, it } from "vitest";
import { isAgentSummary } from "../ipc-agents";
import { isDynamicRecord } from "../runtime-values";
import request from "./fixtures/v4/client-http-request.json";
import response from "./fixtures/v4/host-http-response.json";
import profileResponseFixture from "./fixtures/v4/profile-host-response.json";
import { decodeProfileV4Draft, decodeProfileV4Request, decodeProfileV4Response } from "./profile-v4";
import { decodeTeamProtocolV3CurrentHttpResponse } from "./v3-adapter";
import {
  decodeTeamProtocolV4CurrentHttpRequest,
  decodeTeamProtocolV4CurrentHttpResponse,
  encodeTeamProtocolV4CurrentHttpRequest,
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

// v4 is the first protocol whose agent profile carries a provider v3 cannot spell, and its save
// response is the one place the marketplace key inverts: in-app `listingId` is the wire `agentId`,
// while every other `agentId` means the product agent. Pinning the encoded form is what keeps a
// later edit to `profile-v4.ts` from silently reprojecting either.
it("keeps profile save responses frozen across HTTP and WebRTC adapters", () => {
  const path = "/v1/agents/profile/save";
  const current = decodeTeamProtocolV4CurrentHttpResponse("POST", path, 200, profileResponseFixture);
  expect(JSON.parse(encodeTeamProtocolV4CurrentHttpResponse("POST", path, 200, current))).toEqual(
    profileResponseFixture,
  );
  expect(encodeTeamProtocolV4WebRtcHttpResponse("POST", path, 200, current)).toEqual(profileResponseFixture);
  expect(decodeTeamProtocolV4WebRtcHttpResponse("POST", path, 200, profileResponseFixture)).toEqual(current);
  const agent = isDynamicRecord(current) ? current.agent : null;
  if (!isDynamicRecord(agent)) throw new Error("Invalid v4 profile fixture.");
  expect(agent.marketplaceSource).toEqual({
    listingId: "market-research",
    versionId: "market-research-v2",
    version: 2,
    skillIds: ["primary-sources"],
    routineIds: ["routine-copy"],
  });
});

it("round trips reviewed profiles through the additive v4 HTTP and WebRTC routes", () => {
  const draft = {
    name: "Researcher",
    title: "Science",
    description: "Cite sources",
    avatarSeed: "research",
    avatarHue: 215,
    sectionId: null,
  };
  const path = "/v1/agents/profile/generate";
  const input = { prompt: "Research science", agentId: "chief", draft };
  expect(
    decodeTeamProtocolV4CurrentHttpRequest(
      "POST",
      path,
      JSON.parse(encodeTeamProtocolV4CurrentHttpRequest("POST", path, input)),
    ),
  ).toEqual(input);
  expect(
    decodeTeamProtocolV4WebRtcHttpRequest("POST", path, encodeTeamProtocolV4WebRtcHttpRequest("POST", path, input)),
  ).toEqual(input);
  // A half-written draft is a legal request: the user is still editing it when generation starts.
  const incomplete = { ...input, draft: { ...draft, name: "", description: "" } };
  expect(
    decodeTeamProtocolV4CurrentHttpRequest(
      "POST",
      path,
      JSON.parse(encodeTeamProtocolV4CurrentHttpRequest("POST", path, incomplete)),
    ),
  ).toEqual(incomplete);
  const response = encodeTeamProtocolV4CurrentHttpResponse("POST", path, 200, draft);
  expect(decodeTeamProtocolV4CurrentHttpResponse("POST", path, 200, JSON.parse(response))).toEqual(draft);
});

// Against `profile-v4.ts` and not through an adapter, deliberately. The adapter runs the current IPC
// parser first, so it rejects these inputs before the frozen codec sees them - a bound asserted
// through the adapter passes whatever `profile-v4.ts` says, which is the opposite of freezing it.
// These bounds belong to the v4 wire and must outlive any change to the current profile model.
it("freezes the v4 profile draft bounds independently of the current profile model", () => {
  const draft = {
    name: "Researcher",
    title: "Science",
    description: "Cite sources",
    avatarSeed: "research",
    avatarHue: 215,
    sectionId: null,
  };
  expect(decodeProfileV4Draft(draft, true)).toEqual(draft);
  // The codec projects through its own key list, so a key a later build adds never reaches the wire.
  expect(decodeProfileV4Draft({ ...draft, futureField: "private" }, true)).toEqual(draft);
  // Incomplete is legal while generating, and rejected once the draft is presented as finished.
  const blank = { ...draft, name: "", description: "" };
  expect(decodeProfileV4Draft(blank, false)).toEqual(blank);
  expect(() => decodeProfileV4Draft(blank, true)).toThrow("Invalid profile v4 draft.");
  for (const invalid of [
    { ...draft, description: "x".repeat(2_001) },
    { ...draft, name: "x".repeat(81) },
    { ...draft, title: "x".repeat(121) },
    { ...draft, avatarHue: 20 },
    { ...draft, avatarSeed: "../avatar.png" },
    { ...draft, sectionId: "" },
  ]) {
    expect(() => decodeProfileV4Draft(invalid, true)).toThrow("Invalid profile v4 draft.");
  }
  expect(() => decodeProfileV4Response(true, blank)).toThrow("Invalid profile v4 draft.");
  expect(() => decodeProfileV4Request(false, { operationId: "invalid", draft })).toThrow("Invalid profile v4 save.");
  expect(() => decodeProfileV4Request(true, { prompt: " ", draft })).toThrow("Invalid profile v4 prompt.");
});
