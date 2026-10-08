import { describe, expect, it } from "vitest";
import { isAgentEvent } from "../ipc-agent-events";
import { isAgentSummary } from "../ipc-agents";
import { type ConversationMessage, isConversationMessage } from "../ipc-conversation-messages";
import {
  type ConversationPage,
  type ConversationWithReadState,
  isConversationWithReadState,
} from "../ipc-conversations";
import { isDynamicRecord } from "../runtime-values";
import { withConversationPlans } from "./conversation-plan-v4";
import { withConversationSenders } from "./conversation-sender-v5";
import request from "./fixtures/v6/client-http-request.json";
import conversationPageWire from "./fixtures/v6/host-conversation-page-response.json";
import response from "./fixtures/v6/host-http-response.json";
import models from "./fixtures/v6/host-models-response.json";
import quietTurnWire from "./fixtures/v6/host-quiet-turn-completed-event.json";
import status from "./fixtures/v6/host-status-response.json";
import { encodeTeamProtocolV1CurrentEvent, encodeTeamProtocolV1CurrentHttpResponse } from "./v1-adapter";
import { encodeTeamProtocolV4BaseCurrentEvent } from "./v4-base-adapter";
import {
  decodeTeamProtocolV5CurrentHttpRequest,
  decodeTeamProtocolV5CurrentHttpResponse,
  encodeTeamProtocolV5CurrentHttpResponse,
} from "./v5-adapter";
import { encodeTeamProtocolV5BaseCurrentEvent } from "./v5-base-adapter";
import {
  decodeTeamProtocolV6CurrentHttpRequest,
  decodeTeamProtocolV6CurrentHttpResponse,
  encodeTeamProtocolV6CurrentHttpRequest,
  encodeTeamProtocolV6CurrentHttpResponse,
} from "./v6-adapter";
import { decodeTeamProtocolV6BaseEvent } from "./v6-base";
import {
  decodeTeamProtocolV6BaseCurrentEvent,
  decodeTeamProtocolV6BaseCurrentHttpResponse,
  encodeTeamProtocolV6BaseCurrentEvent,
} from "./v6-base-adapter";
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

  describe("conversation ui blocks", () => {
    const pagePath = "/v1/agents/chief/conversation-page?limit=50";
    const snapshotPath = "/v1/agents/chief/conversation";
    // The fixture is what a host writes: the wire names an agent `botId`.
    const page = readPage(decodeTeamProtocolV6CurrentHttpResponse("GET", pagePath, 200, conversationPageWire));
    const { references: _references, pageInfo: _pageInfo, ...snapshot } = page;
    const blockOf = (value: unknown, id: string) => {
      if (!isDynamicRecord(value) || !Array.isArray(value.messages)) return undefined;
      const message = value.messages.find((item) => isDynamicRecord(item) && item.id === id);
      return isDynamicRecord(message) ? message.uiBlock : undefined;
    };

    it("carries a block over HTTP, WebRTC and conversation events", () => {
      expect(page.messages.map((message) => message.uiBlock?.blockId)).toEqual(["letter", "week", undefined]);
      expect(page.references["question-prompt:turn-0:request-0"]?.uiBlock?.blockId).toBe("weekly");
      const wire = JSON.parse(encodeTeamProtocolV6CurrentHttpResponse("GET", pagePath, 200, page));
      expect(wire).toEqual(conversationPageWire);
      expect(decodeTeamProtocolV6CurrentHttpResponse("GET", pagePath, 200, wire)).toEqual(page);
      const snapshotWire = JSON.parse(encodeTeamProtocolV6CurrentHttpResponse("GET", snapshotPath, 200, snapshot));
      expect(decodeTeamProtocolV6CurrentHttpResponse("GET", snapshotPath, 200, snapshotWire)).toEqual(snapshot);
      const overWebRtc = encodeTeamProtocolV6WebRtcHttpResponse("GET", pagePath, 200, page);
      expect(decodeTeamProtocolV6WebRtcHttpResponse("GET", pagePath, 200, overWebRtc)).toEqual(page);

      // A block that changes, such as an answered block, reaches a client as a conversation event.
      // Events carry no read state.
      const { readState: _readState, ...eventSnapshot } = snapshot;
      const { readState: _pageReadState, ...eventPage } = page;
      for (const event of [
        { type: "conversation" as const, snapshot: eventSnapshot },
        { type: "conversation-page" as const, page: eventPage },
      ]) {
        const eventWire = JSON.parse(encodeTeamProtocolV6BaseCurrentEvent(event) ?? "null");
        expect(decodeTeamProtocolV6BaseCurrentEvent(eventWire)).toEqual({ kind: "known", event });
        expect(decodeTeamProtocolV6CurrentEvent(createTeamProtocolV6Event(1, eventWire))).toEqual({
          status: "known",
          event,
        });
      }
    });

    it("leaves the block out for a client that does not know it, without an error", () => {
      const wire = conversationPageWire;
      // The v6 decoder 0.33.0 shipped: the frozen projection with plans and senders beside it.
      const shipped = withConversationSenders(
        withConversationPlans(decodeTeamProtocolV6BaseCurrentHttpResponse("GET", pagePath, 200, wire), wire),
        wire,
      );
      expect(JSON.stringify(shipped)).not.toContain("uiBlock");
      // It still reads the fallback: a question it can answer, and its answer.
      expect(shipped).toMatchObject({
        messages: [
          { itemType: "question_prompt", questionPrompt: page.messages[0]?.questionPrompt },
          { itemType: "question_prompt", questionPrompt: page.messages[1]?.questionPrompt },
          { text: page.messages[2]?.text },
        ],
      });
      // A host serving an older protocol keeps its frozen key lists.
      expect(encodeTeamProtocolV5CurrentHttpResponse("GET", pagePath, 200, page)).not.toContain("uiBlock");
      expect(JSON.stringify(decodeTeamProtocolV5CurrentHttpResponse("GET", pagePath, 200, wire))).not.toContain(
        "uiBlock",
      );
      expect(encodeTeamProtocolV1CurrentHttpResponse("GET", snapshotPath, 200, snapshot)).not.toContain("uiBlock");
    });

    it("fails closed on a malformed block, in both directions and on the event stream", () => {
      const [prompt, ...rest] = page.messages;
      if (!prompt) throw new Error("Invalid v6 conversation fixture.");
      const malformed = {
        ...page,
        messages: [{ ...prompt, uiBlock: { ...prompt.uiBlock, spec: { type: "confirm" } } }, ...rest],
      };
      expect(() => encodeTeamProtocolV6CurrentHttpResponse("GET", pagePath, 200, malformed)).toThrow(
        "Invalid conversation UI block.",
      );

      const [wirePrompt, ...wireRest] = conversationPageWire.messages;
      const malformedWire = {
        ...conversationPageWire,
        messages: [{ ...wirePrompt, uiBlock: { ...wirePrompt?.uiBlock, spec: { type: "confirm" } } }, ...wireRest],
      };
      expect(() => decodeTeamProtocolV6CurrentHttpResponse("GET", pagePath, 200, malformedWire)).toThrow(
        "Invalid conversation UI block.",
      );
      expect(() => decodeTeamProtocolV6WebRtcHttpResponse("GET", pagePath, 200, malformedWire)).toThrow(
        "Invalid conversation UI block.",
      );
      // A block id that the legacy read renames is malformed too.
      const legacyId = {
        ...conversationPageWire,
        messages: [{ ...wirePrompt, uiBlock: { ...wirePrompt?.uiBlock, blockId: "botId" } }, ...wireRest],
      };
      expect(() => decodeTeamProtocolV6CurrentHttpResponse("GET", pagePath, 200, legacyId)).toThrow(
        "Invalid conversation UI block.",
      );

      const badReference = {
        ...conversationPageWire,
        references: {
          "question-prompt:turn-0:request-0": {
            ...conversationPageWire.references["question-prompt:turn-0:request-0"],
            uiBlock: { version: 2 },
          },
        },
      };
      expect(() => decodeTeamProtocolV6CurrentHttpResponse("GET", pagePath, 200, badReference)).toThrow(
        "Invalid conversation UI block.",
      );

      const { readState: _readState, ...eventSnapshot } = snapshot;
      const eventWire = JSON.parse(
        encodeTeamProtocolV6BaseCurrentEvent({ type: "conversation", snapshot: eventSnapshot }) ?? "null",
      );
      const malformedEvent = { ...eventWire, snapshot: { ...eventWire.snapshot, messages: malformedWire.messages } };
      expect(decodeTeamProtocolV6BaseCurrentEvent(malformedEvent)).toEqual({ kind: "invalid", type: "conversation" });
      expect(() => createTeamProtocolV6Event(1, malformedEvent)).toThrow("Invalid Team protocol v6 event.");
    });

    it("sends a block with only known keys", () => {
      const [prompt, ...rest] = page.messages;
      if (!prompt?.uiBlock) throw new Error("Invalid v6 conversation fixture.");
      const extra = { ...page, messages: [{ ...prompt, uiBlock: { ...prompt.uiBlock, notify: "push" } }, ...rest] };
      const wire = JSON.parse(encodeTeamProtocolV6CurrentHttpResponse("GET", pagePath, 200, extra));
      expect(blockOf(wire, prompt.id)).toEqual(prompt.uiBlock);
    });

    it("keeps the newest blocks within the size budget and leaves the older ones to their fallback", () => {
      const fields = Array.from({ length: 8 }, (_, field) => ({ label: `Field ${field}`, value: "x".repeat(2_000) }));
      const messages = Array.from({ length: 50 }, (_, index) => ({
        id: `question-prompt:turn-1:request-${index}`,
        author: "assistant" as const,
        text: `Letter ${index}`,
        createdAt: `2026-10-08T10:${String(index).padStart(2, "0")}:00.000Z`,
        status: "completed" as const,
        uiBlock: {
          version: 1,
          blockId: `letter-${index}`,
          spec: {
            type: "confirm",
            title: `Letter ${index}`,
            fields,
            preview: "y".repeat(8_000),
            actions: [{ id: "send", label: "Send" }],
          },
          state: { status: "closed" },
        },
      }));
      const large = { ...snapshot, messages };
      const wire = JSON.parse(encodeTeamProtocolV6CurrentHttpResponse("GET", snapshotPath, 200, large));
      const kept = messages.filter((message) => blockOf(wire, message.id) !== undefined);
      expect(kept.length).toBeGreaterThan(0);
      expect(kept.length).toBeLessThan(messages.length);
      // The kept blocks are the newest ones, and every message still arrives with its text.
      expect(kept.map((message) => message.id)).toEqual(messages.slice(-kept.length).map((message) => message.id));
      expect(JSON.stringify(kept.map((message) => message.uiBlock)).length).toBeLessThanOrEqual(1_000_000);
      expect(wire.messages).toHaveLength(messages.length);
      const decoded = decodeTeamProtocolV6CurrentHttpResponse("GET", snapshotPath, 200, wire);
      expect(kept.every((message) => blockOf(decoded, message.id) !== undefined)).toBe(true);
      expect(JSON.parse(encodeTeamProtocolV6CurrentHttpResponse("GET", snapshotPath, 200, decoded))).toEqual(wire);
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

function readPage(value: unknown): ConversationPage & ConversationWithReadState {
  const rawReferences = isDynamicRecord(value) ? value.references : undefined;
  const rawPageInfo = isDynamicRecord(value) ? value.pageInfo : undefined;
  if (
    !isConversationWithReadState(value) ||
    !isDynamicRecord(rawReferences) ||
    !isDynamicRecord(rawPageInfo) ||
    typeof rawPageInfo.hasOlder !== "boolean" ||
    rawPageInfo.olderCursor !== null
  )
    throw new Error("Invalid v6 conversation fixture.");
  const references: Record<string, ConversationMessage> = {};
  for (const [id, message] of Object.entries(rawReferences)) {
    if (!isConversationMessage(message)) throw new Error("Invalid v6 conversation fixture.");
    references[id] = message;
  }
  return { ...value, references, pageInfo: { hasOlder: rawPageInfo.hasOlder, olderCursor: null } };
}
