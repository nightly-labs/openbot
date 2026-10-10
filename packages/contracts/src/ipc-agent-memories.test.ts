import { describe, expect, it } from "vitest";
import { INPUT_LIMITS } from "./input-limits";
import { AGENT_MEMORIES_PAGE_ROUTE, AGENT_MEMORIES_PAGE_SIZE } from "./team-protocol/agent-memories-v1";
import { optionalRouteCodec } from "./team-protocol/optional-routes";
import { decodeTeamProtocolV2RpcFrame, encodeTeamProtocolV2Frame } from "./team-protocol/v2";
import { encodeTeamProtocolV6WebRtcHttpResponse } from "./team-protocol/v6-webrtc-adapter";

describe("agent memory list transport", () => {
  it.each(["記", '"', "\u0001"])("keeps the released 512-entry full list within one frame for %j", (character) => {
    const memories = Array.from({ length: 512 }, (_, index) => ({
      id: `memory-${index}`.padEnd(INPUT_LIMITS.identifier, "a"),
      agentId: "agent-1".padEnd(INPUT_LIMITS.identifier, "a"),
      text: `${index} ${character.repeat(INPUT_LIMITS.agentMemoryText - String(index).length - 1)}`,
      origin: "automatic",
      sourceTurnId: "turn-1".padEnd(INPUT_LIMITS.identifier, "a"),
      createdAt: "2026-10-09T00:00:00.000Z",
      updatedAt: "2026-10-09T00:00:00.000Z",
    }));
    const body = encodeTeamProtocolV6WebRtcHttpResponse("GET", "/v1/agents/agent-1/memories", 200, memories);
    const response = { status: 200, body };
    const frame = encodeTeamProtocolV2Frame({
      version: 2,
      type: "response",
      requestId: "memory-list",
      result: response,
    });
    expect(decodeTeamProtocolV2RpcFrame(frame)).toEqual({
      version: 2,
      type: "response",
      requestId: "memory-list",
      result: response,
    });
  });
});

describe("agent memory page transport", () => {
  it.each(["記", '"', "\u0001"])("fits a maximum page with escaped or multibyte fields %j", (character) => {
    const memories = Array.from({ length: AGENT_MEMORIES_PAGE_SIZE }, (_, index) => ({
      id: `${index}`.padEnd(128, character),
      agentId: character.repeat(128),
      text: character.repeat(500),
      origin: "automatic",
      sourceTurnId: character.repeat(128),
      createdAt: character.repeat(64),
      updatedAt: character.repeat(64),
    }));
    const codec = optionalRouteCodec(AGENT_MEMORIES_PAGE_ROUTE);
    expect(codec).toBeDefined();
    const body = codec?.response(200, { memories, nextCursor: memories.at(-1)?.id });
    if (!body) throw new Error("Missing memory page codec.");
    const frame = { version: 2, type: "response", requestId: "memory-page", result: { status: 200, body } } as const;
    expect(decodeTeamProtocolV2RpcFrame(encodeTeamProtocolV2Frame(frame))).toEqual(frame);
    expect(() => codec?.response(200, { memories: [...memories, memories[0]], nextCursor: null })).toThrow();
  });
});
