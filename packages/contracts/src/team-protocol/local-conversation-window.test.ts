import { describe, expect, it } from "vitest";
import type { AgentEvent, ConversationPage, ConversationWithReadState } from "../ipc";
import { encodeTeamProtocolV1CurrentEvent, encodeTeamProtocolV1CurrentHttpResponse } from "./v1-adapter";
import { createTeamProtocolV2Event, encodeTeamProtocolV2CurrentHttpResponse } from "./v2-adapter";
import { encodeTeamProtocolV3CurrentHttpResponse } from "./v3-adapter";
import { encodeTeamProtocolV3WebRtcHttpResponse } from "./v3-webrtc-adapter";
import { encodeTeamProtocolV4CurrentHttpResponse } from "./v4-adapter";
import { encodeTeamProtocolV4BaseCurrentEvent } from "./v4-base-adapter";
import { createTeamProtocolV4Event, encodeTeamProtocolV4WebRtcHttpResponse } from "./v4-webrtc-adapter";
import { encodeTeamProtocolV5CurrentHttpResponse } from "./v5-adapter";
import { encodeTeamProtocolV5BaseCurrentEvent } from "./v5-base-adapter";
import { createTeamProtocolV5Event, encodeTeamProtocolV5WebRtcHttpResponse } from "./v5-webrtc-adapter";
import { encodeTeamProtocolV6CurrentHttpResponse } from "./v6-adapter";
import { encodeTeamProtocolV6BaseCurrentEvent } from "./v6-base-adapter";
import { createTeamProtocolV6Event, encodeTeamProtocolV6WebRtcHttpResponse } from "./v6-webrtc-adapter";

// v2 shares v1 HTTP/SSE and introduces its WebRTC frame; v3 also keeps that frame.
const protocols = [
  {
    version: 1,
    http: encodeTeamProtocolV1CurrentHttpResponse,
    event: encodeTeamProtocolV1CurrentEvent,
    webrtc: encodeTeamProtocolV2CurrentHttpResponse,
    frame: createTeamProtocolV2Event,
  },
  {
    version: 2,
    http: encodeTeamProtocolV1CurrentHttpResponse,
    event: encodeTeamProtocolV1CurrentEvent,
    webrtc: encodeTeamProtocolV2CurrentHttpResponse,
    frame: createTeamProtocolV2Event,
  },
  {
    version: 3,
    http: encodeTeamProtocolV3CurrentHttpResponse,
    event: encodeTeamProtocolV1CurrentEvent,
    webrtc: encodeTeamProtocolV3WebRtcHttpResponse,
    frame: createTeamProtocolV2Event,
  },
  {
    version: 4,
    http: encodeTeamProtocolV4CurrentHttpResponse,
    event: encodeTeamProtocolV4BaseCurrentEvent,
    webrtc: encodeTeamProtocolV4WebRtcHttpResponse,
    frame: createTeamProtocolV4Event,
  },
  {
    version: 5,
    http: encodeTeamProtocolV5CurrentHttpResponse,
    event: encodeTeamProtocolV5BaseCurrentEvent,
    webrtc: encodeTeamProtocolV5WebRtcHttpResponse,
    frame: createTeamProtocolV5Event,
  },
  {
    version: 6,
    http: encodeTeamProtocolV6CurrentHttpResponse,
    event: encodeTeamProtocolV6BaseCurrentEvent,
    webrtc: encodeTeamProtocolV6WebRtcHttpResponse,
    frame: createTeamProtocolV6Event,
  },
];
const message = {
  id: "reply",
  author: "assistant" as const,
  text: "Reply",
  createdAt: "2026-10-08T00:00:02.000Z",
  status: "completed" as const,
};
const snapshot: ConversationWithReadState = {
  agentId: "chief",
  threadId: "thread-chief",
  activeTurnId: null,
  revision: 100,
  messages: [message],
  readState: { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: null },
};
const page: ConversationPage = { ...snapshot, references: {}, pageInfo: { hasOlder: true, olderCursor: "cursor" } };
const localSnapshot: ConversationWithReadState = {
  ...snapshot,
  messages: [{ ...message, visibilityEpoch: 50, visibilityKind: "created" }],
  window: { removedMessageIds: ["deleted"] },
};
const localPage: ConversationPage = {
  ...page,
  orderProof: { agentId: "chief", threadId: "thread-chief", revision: 50, entries: [{ id: "input", order: null }] },
  messages: localSnapshot.messages,
  messageOrder: [
    { id: "input", key: [message.createdAt, 0, "turn:current", 4, message.createdAt, 0, "input"] },
    { id: "reply", key: [message.createdAt, 0, "turn:current", 4, message.createdAt, 1, "reply"] },
  ],
  windowMembers: {
    messages: [{ ...message, id: "input", author: "user", visibilityEpoch: 50, visibilityKind: "revealed" }],
    visibilityFloor: 50,
  },
};

describe("local conversation window fields stay out of released projections", () => {
  for (const protocol of protocols) {
    it(`preserves protocol ${protocol.version} HTTP, event and WebRTC bytes`, () => {
      for (const [path, baseline, local] of [
        ["/v1/agents/chief/conversation", snapshot, localSnapshot],
        ["/v1/agents/chief/conversation-page", page, localPage],
      ] as const) {
        expect(protocol.http("GET", path, 200, local)).toBe(protocol.http("GET", path, 200, baseline));
        expect(protocol.webrtc("GET", path, 200, local)).toEqual(protocol.webrtc("GET", path, 200, baseline));
      }
      for (const [event, base] of [
        [
          { type: "conversation", snapshot: localSnapshot },
          { type: "conversation", snapshot },
        ],
        [
          { type: "conversation-page", page: localPage },
          { type: "conversation-page", page },
        ],
      ] satisfies Array<[AgentEvent, AgentEvent]>) {
        const encoded = protocol.event(event);
        const baseline = protocol.event(base);
        expect(encoded).toBe(baseline);
        expect(encoded).not.toBeNull();
        expect(protocol.frame(1, JSON.parse(encoded ?? "null"))).toEqual(
          protocol.frame(1, JSON.parse(baseline ?? "null")),
        );
      }
    });
  }
});
