import type { ScopedAgentEvent } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { decodeScopedAgentEvent } from "./agent-event-decoding";

const delta = {
  serverId: "local",
  event: {
    type: "conversation-delta",
    agentId: "agent-1",
    threadId: "thread-1",
    turnId: "turn-1",
    messageId: "message-1",
    delta: "Hello",
    createdAt: "2026-09-23T10:00:00.000Z",
    revision: 3,
  },
} satisfies ScopedAgentEvent;

describe("decodeScopedAgentEvent", () => {
  it.each([
    ["an event", delta],
    [
      "a buffered live event",
      { serverId: "server-1", event: { type: "queue-invalidated", agentId: "agent-1" }, bufferedLive: true },
    ],
  ] satisfies [string, ScopedAgentEvent][])("keeps %s", (_name, value) => {
    expect(decodeScopedAgentEvent(value)).toEqual(value);
  });

  it.each([
    ["no server", { event: delta.event }],
    ["an unknown event type", { serverId: "local", event: { type: "made-up" } }],
    ["an event with a missing field", { serverId: "local", event: { ...delta.event, delta: undefined } }],
    ["a bufferedLive that is not a boolean", { ...delta, bufferedLive: "yes" }],
    ["a value that is not a record", "event"],
  ])("rejects %s", (_name, value) => {
    expect(() => decodeScopedAgentEvent(value)).toThrow(/^Invalid /);
  });
});
