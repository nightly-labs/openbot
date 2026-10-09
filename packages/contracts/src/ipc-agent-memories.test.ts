import { describe, expect, it } from "vitest";
import { INPUT_LIMITS } from "./input-limits";
import { AGENT_MEMORY_LIMITS } from "./ipc-agent-memories";
import { decodeTeamProtocolV2RpcFrame, encodeTeamProtocolV2Frame } from "./team-protocol/v2";
import { encodeTeamProtocolV6WebRtcHttpResponse } from "./team-protocol/v6-webrtc-adapter";

describe("agent memory list transport", () => {
  it.each(["記", '"', "\u0001"])("transmits a full list with escaped or multibyte text %j", (character) => {
    const memories = Array.from({ length: Math.max(...AGENT_MEMORY_LIMITS) }, (_, index) => ({
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
