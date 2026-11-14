import { describe, expect, it } from "vitest";
import { amendedExpectsReply, amendsRunningRequest } from "./mailbox-store";

const agent = (id: string) => ({ kind: "agent" as const, agentId: id });
const user = { kind: "user" as const } as const;

function state(
  messages: Array<{
    id: string;
    sender: ReturnType<typeof agent> | typeof user;
    expectsReply?: false;
    replyToMessageId?: string | null;
  }>,
  deliveries: Array<{
    messageId: string;
    recipientAgentId: string;
    status: "queued" | "starting" | "running" | "completed";
  }>,
) {
  return {
    messages: messages.map((message) => ({
      id: message.id,
      sender: message.sender,
      expectsReply: message.expectsReply,
      replyToMessageId: message.replyToMessageId ?? null,
    })),
    deliveries,
  };
}

describe("amendsRunningRequest", () => {
  it("sees an open request the sender still runs at the recipient", () => {
    const open = state(
      [{ id: "m1", sender: agent("a"), replyToMessageId: null }],
      [{ messageId: "m1", recipientAgentId: "b", status: "running" }],
    );
    expect(amendsRunningRequest(open, "a", ["b"])).toBe(true);
  });

  it("is false once the answer exists", () => {
    const answered = state(
      [
        { id: "m1", sender: agent("a"), replyToMessageId: null },
        { id: "m2", sender: agent("b"), expectsReply: false, replyToMessageId: "m1" },
      ],
      [{ messageId: "m1", recipientAgentId: "b", status: "running" }],
    );
    expect(amendsRunningRequest(answered, "a", ["b"])).toBe(false);
  });

  it("is false when the request finished", () => {
    const finished = state(
      [{ id: "m1", sender: agent("a"), replyToMessageId: null }],
      [{ messageId: "m1", recipientAgentId: "b", status: "completed" }],
    );
    expect(amendsRunningRequest(finished, "a", ["b"])).toBe(false);
  });

  it("is false for a different recipient", () => {
    const other = state(
      [{ id: "m1", sender: agent("a"), replyToMessageId: null }],
      [{ messageId: "m1", recipientAgentId: "b", status: "running" }],
    );
    expect(amendsRunningRequest(other, "a", ["c"])).toBe(false);
  });

  it("ignores a notification the sender already sent", () => {
    const notice = state(
      [{ id: "m1", sender: agent("a"), expectsReply: false, replyToMessageId: null }],
      [{ messageId: "m1", recipientAgentId: "b", status: "running" }],
    );
    expect(amendsRunningRequest(notice, "a", ["b"])).toBe(false);
  });

  it("ignores a request the recipient has not started", () => {
    const waiting = state(
      [{ id: "m1", sender: agent("a"), replyToMessageId: null }],
      [{ messageId: "m1", recipientAgentId: "b", status: "queued" }],
    );
    expect(amendsRunningRequest(waiting, "a", ["b"])).toBe(false);
  });
});

describe("amendedExpectsReply", () => {
  it("keeps an explicit true, so a second question still gets its own answer", () => {
    expect(amendedExpectsReply(true, false, true)).toBe(true);
  });

  it("keeps an explicit false", () => {
    expect(amendedExpectsReply(false, false, false)).toBe(false);
  });

  it("turns an unlabelled amendment into a notification", () => {
    expect(amendedExpectsReply(undefined, false, true)).toBe(false);
  });

  it("leaves an unlabelled message alone when nothing is running", () => {
    expect(amendedExpectsReply(undefined, false, false)).toBeUndefined();
  });

  it("leaves a reply alone", () => {
    expect(amendedExpectsReply(undefined, true, true)).toBeUndefined();
  });
});
