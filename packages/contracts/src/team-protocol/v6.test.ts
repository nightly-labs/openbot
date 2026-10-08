import { describe, expect, it } from "vitest";
import { isAgentEvent } from "../ipc-agent-events";
import { isAgentSummary } from "../ipc-agents";
import request from "./fixtures/v6/client-http-request.json";
import response from "./fixtures/v6/host-http-response.json";
import models from "./fixtures/v6/host-models-response.json";
import quietTurnWire from "./fixtures/v6/host-quiet-turn-completed-event.json";
import status from "./fixtures/v6/host-status-response.json";
import { encodeTeamProtocolV1CurrentEvent } from "./v1-adapter";
import { encodeTeamProtocolV4BaseCurrentEvent } from "./v4-base-adapter";
import { decodeTeamProtocolV5CurrentHttpRequest, decodeTeamProtocolV5CurrentHttpResponse } from "./v5-adapter";
import { encodeTeamProtocolV5BaseCurrentEvent } from "./v5-base-adapter";
import {
  decodeTeamProtocolV6CurrentHttpRequest,
  decodeTeamProtocolV6CurrentHttpResponse,
  encodeTeamProtocolV6CurrentHttpRequest,
  encodeTeamProtocolV6CurrentHttpResponse,
} from "./v6-adapter";
import { decodeTeamProtocolV6BaseEvent } from "./v6-base";
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

  describe("quiet routine runs", () => {
    // The fixture is what a host writes: the wire names an agent `botId`.
    const { botId, ...rest } = quietTurnWire;
    const current = { ...rest, agentId: botId };
    if (!isAgentEvent(current) || current.type !== "turn-completed") throw new Error("Invalid v6 quiet fixture.");
    const event = current;

    it("carries quiet on a completed turn over HTTP events and WebRTC", () => {
      expect(decodeTeamProtocolV6BaseCurrentEvent(quietTurnWire)).toEqual({ kind: "known", event });
      expect(JSON.parse(encodeTeamProtocolV6BaseCurrentEvent(event) ?? "null")).toEqual(quietTurnWire);
      expect(decodeTeamProtocolV6CurrentEvent(createTeamProtocolV6Event(1, quietTurnWire))).toEqual({
        status: "known",
        event,
      });
      // A turn that is not quiet keeps the shipped shape.
      const { quiet: _quiet, ...loud } = event;
      expect(encodeTeamProtocolV6BaseCurrentEvent(loud)).not.toContain("quiet");
    });

    it("leaves quiet out for a client that does not know it, without an error", () => {
      // The v6 projection 0.33.0 shipped reads a completed turn and drops the key.
      const { quiet: _quiet, ...shipped } = quietTurnWire;
      expect(decodeTeamProtocolV6BaseEvent(quietTurnWire)).toEqual({ kind: "known", event: shipped });
      // A host serving an older protocol keeps its frozen key lists.
      for (const encode of [
        encodeTeamProtocolV5BaseCurrentEvent,
        encodeTeamProtocolV4BaseCurrentEvent,
        encodeTeamProtocolV1CurrentEvent,
      ]) {
        const wire = encode(event);
        expect(wire).not.toBeNull();
        expect(wire).not.toContain("quiet");
      }
    });

    it("fails closed on a quiet value other than true", () => {
      for (const quiet of [false, "true", 1, null]) {
        const malformed = { ...quietTurnWire, quiet };
        expect(decodeTeamProtocolV6BaseCurrentEvent(malformed)).toEqual({ kind: "invalid", type: "turn-completed" });
        expect(() => createTeamProtocolV6Event(1, malformed)).toThrow("Invalid Team protocol v6 event.");
      }
    });
  });
});
