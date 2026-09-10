import type { AgentExchangeSummary } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../../data";
import { anchorNewMessages, countableTimelineMessage, tallyNewMessages } from "./new-message-tally";

const empty = { count: 0, anchorId: undefined };

function message(overrides: Partial<AgentMessage>): AgentMessage {
  return { id: "m1", author: "agent", body: "Hello", time: "12:00", ...overrides };
}

describe("tallyNewMessages", () => {
  it("counts a message that arrives below the reader", () => {
    const anchored = tallyNewMessages(empty, ["a"], false);
    expect(tallyNewMessages(anchored, ["a", "b"], false)).toEqual({ count: 1, anchorId: "b" });
  });

  it("adds up messages that arrive one after another", () => {
    let tally = tallyNewMessages(empty, ["a"], false);
    tally = tallyNewMessages(tally, ["a", "b"], false);
    tally = tallyNewMessages(tally, ["a", "b", "c"], false);
    expect(tally.count).toBe(2);
  });

  it("counts a page of several messages once", () => {
    const anchored = tallyNewMessages(empty, ["a"], false);
    expect(tallyNewMessages(anchored, ["a", "b", "c", "d"], false)).toEqual({ count: 3, anchorId: "d" });
  });

  it("counts nothing while a message streams", () => {
    let tally = tallyNewMessages(empty, ["a", "b"], false);
    tally = tallyNewMessages(tally, ["a", "b"], false);
    expect(tally.count).toBe(0);
  });

  it("counts nothing for an older page the reader loaded", () => {
    const anchored = tallyNewMessages(empty, ["c", "d"], false);
    expect(tallyNewMessages(anchored, ["a", "b", "c", "d"], false)).toEqual(anchored);
  });

  it("counts nothing for the first page of a thread", () => {
    expect(tallyNewMessages(empty, ["a", "b", "c"], false)).toEqual({ count: 0, anchorId: "c" });
  });

  it("counts nothing while the reader follows the newest message", () => {
    const following = tallyNewMessages({ count: 4, anchorId: "a" }, ["a", "b"], true);
    expect(following).toEqual({ count: 0, anchorId: "b" });
  });

  it("keeps the count when the anchor leaves the window", () => {
    expect(tallyNewMessages({ count: 2, anchorId: "gone" }, ["x", "y", "z"], false)).toEqual({
      count: 2,
      anchorId: "z",
    });
  });

  it("forgets the anchor of an empty timeline", () => {
    expect(tallyNewMessages({ count: 3, anchorId: "a" }, [], false)).toEqual(empty);
  });
});

describe("anchorNewMessages", () => {
  it("takes the newest message as the anchor", () => {
    expect(anchorNewMessages(["a", "b"])).toEqual({ count: 0, anchorId: "b" });
  });
});

describe("countableTimelineMessage", () => {
  it("counts another author's message", () => {
    expect(countableTimelineMessage(message({}))).toBe(true);
  });

  it("does not count the reader's own message", () => {
    expect(countableTimelineMessage(message({ author: "you" }))).toBe(false);
  });

  it("does not count a thinking row", () => {
    expect(countableTimelineMessage(message({ kind: "thinking" }))).toBe(false);
  });

  it("does not count a marker with no message of its own", () => {
    expect(
      countableTimelineMessage(message({ actionMarker: { kind: "unavailable", label: "Gone", timestamp: "now" } })),
    ).toBe(false);
  });

  it("counts a marker that carries an exchange", () => {
    const exchange: AgentExchangeSummary = {
      direction: "incoming",
      messageId: "m1",
      senderAgentId: "agent-1",
      recipientAgentIds: ["agent-2"],
      replyToMessageId: null,
      deliveries: [],
    };
    expect(
      countableTimelineMessage(
        message({ actionMarker: { kind: "unavailable", label: "Gone", timestamp: "now" }, exchange }),
      ),
    ).toBe(true);
  });
});
