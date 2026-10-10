import type { ConversationPage, ConversationSnapshot } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { decodeScopedAgentEvent } from "./agent-event-decoding";
import { decodeConversation, decodeConversationPageFromMain } from "./conversation-decoding";

const message = {
  id: "reply",
  author: "assistant" as const,
  text: "Reply",
  createdAt: "2026-10-08T00:00:02.000Z",
  status: "completed" as const,
};
const snapshot: ConversationSnapshot = {
  agentId: "chief",
  threadId: "thread-chief",
  activeTurnId: null,
  revision: 100,
  messages: [message],
};
const page: ConversationPage = { ...snapshot, references: {}, pageInfo: { hasOlder: true, olderCursor: "cursor" } };

describe("local conversation membership decoding", () => {
  it("keeps old payloads without local metadata and validates new local members", () => {
    expect(decodeConversation(snapshot)).toEqual(snapshot);
    expect(decodeConversationPageFromMain(page)).toEqual(page);
    const local: ConversationPage = {
      ...page,
      messages: [{ ...message, visibilityEpoch: 50 }],
      windowMembers: {
        messages: [{ ...message, id: "input", author: "user", visibilityEpoch: 50, visibilityKind: "revealed" }],
        visibilityFloor: 50,
      },
    };
    expect(decodeConversationPageFromMain(local)).toEqual(local);
    const event = {
      serverId: "local",
      event: {
        type: "conversation",
        snapshot: { ...snapshot, window: { removedMessageIds: ["deleted"] }, messages: local.messages },
      },
    };
    expect(decodeScopedAgentEvent(event)).toEqual(event);
  });
  it.each([null, "unknown", 1, {}, "REVEALED"])("rejects malformed visibility kind %s", (kind) => {
    expect(() =>
      decodeConversation({ ...snapshot, messages: [{ ...message, visibilityEpoch: 50, visibilityKind: kind }] }),
    ).toThrow();
  });
  it("rejects a visibility kind without an epoch", () => {
    expect(() => decodeConversation({ ...snapshot, messages: [{ ...message, visibilityKind: "revealed" }] })).toThrow();
  });
  it.each([0, -1, 1.5, Number.NaN, Infinity, "50"])("rejects malformed visibility epoch %s", (epoch) => {
    expect(() => decodeConversation({ ...snapshot, messages: [{ ...message, visibilityEpoch: epoch }] })).toThrow();
    expect(() =>
      decodeConversationPageFromMain({
        ...page,
        windowMembers: { messages: [{ ...message, visibilityEpoch: epoch }] },
      }),
    ).toThrow();
  });
  it.each([
    null,
    { messages: "input" },
    { messages: [{}] },
    { messages: Array.from({ length: 101 }, () => message) },
    { messages: [], visibilityFloor: 0 },
    { messages: [], visibilityFloor: "50" },
  ])("rejects malformed page membership %s", (windowMembers) => {
    expect(() => decodeConversationPageFromMain({ ...page, windowMembers })).toThrow();
  });
  it.each([null, { removedMessageIds: "deleted" }, { removedMessageIds: [0] }, { removedMessageIds: [""] }])(
    "rejects malformed snapshot removals %s",
    (window) => {
      expect(() =>
        decodeScopedAgentEvent({
          serverId: "local",
          event: { type: "conversation", snapshot: { ...snapshot, window } },
        }),
      ).toThrow();
    },
  );
});

describe("authoritative local page order", () => {
  const ordered = {
    ...page,
    messageOrder: [
      { id: message.id, key: [message.createdAt, 0, "turn:current", 4, message.createdAt, 0, message.id] },
    ],
  };
  it("keeps new local order while legacy pages remain unchanged", () => {
    expect(decodeConversationPageFromMain(ordered)).toEqual(ordered);
    expect(decodeConversationPageFromMain(page)).toEqual(page);
  });
  it("keeps legacy empty timestamps when the host supplies their SQL order", () => {
    const legacy = {
      ...page,
      messages: [{ ...message, createdAt: "" }],
      messageOrder: [{ id: message.id, key: ["", 0, "turn:current", 4, "", 0, message.id] }],
    };
    expect(decodeConversationPageFromMain(legacy)).toEqual(legacy);
  });
  it.each([
    null,
    "order",
    [],
    [{ id: message.id, key: [] }],
    [{ id: message.id, key: [message.createdAt, -1, "turn:current", 4, message.createdAt, 0, message.id] }],
    [{ id: message.id, key: [message.createdAt, 0, "turn:current", 4, message.createdAt, Infinity, message.id] }],
    [{ id: message.id, key: [message.createdAt, 0, "x".repeat(257), 4, message.createdAt, 0, message.id] }],
    [{ id: message.id, key: [message.createdAt, 0, "turn:current", 4, message.createdAt, 0, "wrong"] }],
  ])("rejects malformed or incomplete local order %s", (order) => {
    expect(() => decodeConversationPageFromMain({ ...page, messageOrder: order })).toThrow();
  });
  it("rejects duplicate, foreign and over-limit keys", () => {
    expect(() =>
      decodeConversationPageFromMain({ ...page, messageOrder: [...ordered.messageOrder, ...ordered.messageOrder] }),
    ).toThrow();
    expect(() =>
      decodeConversationPageFromMain({
        ...page,
        messageOrder: [
          { id: "foreign", key: [message.createdAt, 0, "turn:current", 4, message.createdAt, 0, "foreign"] },
        ],
      }),
    ).toThrow();
    expect(() =>
      decodeConversationPageFromMain({
        ...page,
        messageOrder: Array.from({ length: 201 }, (_, index) => ({
          id: `id-${index}`,
          key: [message.createdAt, 0, "turn:current", 4, message.createdAt, index, `id-${index}`],
        })),
      }),
    ).toThrow();
  });
});
