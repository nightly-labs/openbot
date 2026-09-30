import { describe, expect, it } from "vitest";
import { isAgentSummary } from "../ipc-agents";
import type { ConversationPlan } from "../ipc-conversation-plan";
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

  // v5 was copied from v4 before these marks reached v4; current peers negotiate v5.
  it("carries turn plans and the queue reply mark, as v4 does", () => {
    const conversationPath = "/v1/agents/chief/conversation";
    const plan: ConversationPlan = {
      explanation: null,
      steps: [{ id: "0", text: "List files", activeText: "Listing files", status: "inProgress" }],
    };
    const planned = {
      agentId: "chief",
      threadId: "thread-1",
      activeTurnId: "turn-1",
      revision: 1,
      messages: [
        {
          id: "plan-1",
          turnId: "turn-1",
          author: "assistant" as const,
          itemType: "plan",
          text: "- [ ] List files",
          createdAt: "2026-09-28T10:00:00.000Z",
          status: "streaming" as const,
          plan,
        },
      ],
      readState: { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: null },
    };
    const wire = JSON.parse(encodeTeamProtocolV5CurrentHttpResponse("GET", conversationPath, 200, planned));
    expect(decodeTeamProtocolV5CurrentHttpResponse("GET", conversationPath, 200, wire)).toEqual(planned);
    const overWebRtc = encodeTeamProtocolV5WebRtcHttpResponse("GET", conversationPath, 200, planned);
    expect(decodeTeamProtocolV5WebRtcHttpResponse("GET", conversationPath, 200, overWebRtc)).toEqual(planned);
    const event = { type: "conversation" as const, snapshot: planned };
    const eventWire = JSON.parse(encodeTeamProtocolV5BaseCurrentEvent(event) ?? "null");
    const received = decodeTeamProtocolV5CurrentEvent(createTeamProtocolV5Event(1, eventWire));
    expect(
      received.status === "known" &&
        received.event.type === "conversation" &&
        received.event.snapshot.messages[0]?.plan,
    ).toEqual(plan);

    const queuePath = "/v1/agents/chief/queue";
    const answer = {
      id: "delivery-1",
      messageId: "message-1",
      recipientAgentId: "chief",
      sender: { kind: "agent", agentId: "builder" },
      text: "Status: done",
      attachments: [],
      replyToMessageId: "message-0",
      status: "queued",
      position: 1,
      turnId: null,
      error: null,
      createdAt: "2026-09-28T10:00:00.000Z",
      editing: false,
      expectsReply: false,
    };
    const snapshot = { agentId: "chief", deliveries: [answer] };
    const queueWire = JSON.parse(encodeTeamProtocolV5CurrentHttpResponse("GET", queuePath, 200, snapshot));
    expect(decodeTeamProtocolV5CurrentHttpResponse("GET", queuePath, 200, queueWire)).toEqual(snapshot);
    const malformed = { agentId: "chief", deliveries: [{ ...answer, expectsReply: "false" }] };
    expect(() => encodeTeamProtocolV5CurrentHttpResponse("GET", queuePath, 200, malformed)).toThrow("reply mark");
  });

  it("names the member who wrote a user message; v4 drops the name, and a malformed one fails closed", () => {
    const pagePath = "/v1/agents/chief/conversation-page";
    const message = (id: string, senderMember?: { id: string; name: string }) => ({
      id,
      author: "user" as const,
      text: `Message ${id}`,
      createdAt: "2026-09-28T10:00:00.000Z",
      status: "completed" as const,
      ...(senderMember ? { senderMember } : {}),
    });
    const page = {
      agentId: "chief",
      threadId: "thread-1",
      activeTurnId: null,
      revision: 1,
      messages: [message("ada-1", { id: "member-ada", name: "Ada" }), message("legacy-1")],
      references: { "grace-0": message("grace-0", { id: "member-grace", name: "Grace" }) },
      pageInfo: { hasOlder: false, olderCursor: null },
    };
    const wire = JSON.parse(encodeTeamProtocolV5CurrentHttpResponse("GET", pagePath, 200, page));
    expect(decodeTeamProtocolV5CurrentHttpResponse("GET", pagePath, 200, wire)).toEqual(page);
    const overWebRtc = encodeTeamProtocolV5WebRtcHttpResponse("GET", pagePath, 200, page);
    expect(decodeTeamProtocolV5WebRtcHttpResponse("GET", pagePath, 200, overWebRtc)).toEqual(page);

    const snapshot = {
      agentId: "chief",
      threadId: "thread-1",
      activeTurnId: null,
      revision: 1,
      messages: page.messages,
    };
    const eventWire = JSON.parse(encodeTeamProtocolV5BaseCurrentEvent({ type: "conversation", snapshot }) ?? "null");
    expect(decodeTeamProtocolV5CurrentEvent(createTeamProtocolV5Event(1, eventWire))).toEqual({
      status: "known",
      event: { type: "conversation", snapshot },
    });

    // A client on protocol 4 reads every user message as its own, as it always did.
    const v4 = decodeTeamProtocolV4CurrentHttpResponse("GET", pagePath, 200, wire);
    expect(JSON.stringify(v4)).not.toContain("senderMember");

    const malformed = { ...page, messages: [{ ...message("bad-1"), senderMember: { id: "member-ada", name: 7 } }] };
    expect(() => encodeTeamProtocolV5CurrentHttpResponse("GET", pagePath, 200, malformed)).toThrow(
      "Invalid conversation sender.",
    );
    const malformedWire = { ...wire, messages: [{ ...wire.messages[0], senderMember: { id: "", name: "Ada" } }] };
    expect(() => decodeTeamProtocolV5CurrentHttpResponse("GET", pagePath, 200, malformedWire)).toThrow(
      "Invalid conversation sender.",
    );
  });
});
