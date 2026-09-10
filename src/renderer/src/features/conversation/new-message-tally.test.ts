import type { AgentExchangeSummary } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../../data";
import { anchorNewMessages, countableTimelineMessage, type TimelineRow, tallyNewMessages } from "./new-message-tally";

const empty = { count: 0, anchorId: undefined };

/** Ids that start with `own` are the reader's own messages, which never count. */
function rows(...ids: readonly string[]): TimelineRow[] {
  return ids.map((id) => ({ id, countable: !id.startsWith("own") }));
}

function message(overrides: Partial<AgentMessage>): AgentMessage {
  return { id: "m1", author: "agent", body: "Hello", time: "12:00", ...overrides };
}

describe("tallyNewMessages", () => {
  it("counts a message that arrives below the reader", () => {
    const anchored = tallyNewMessages(empty, rows("a"), false);
    expect(tallyNewMessages(anchored, rows("a", "b"), false)).toEqual({ count: 1, anchorId: "b" });
  });

  it("adds up messages that arrive one after another", () => {
    let tally = tallyNewMessages(empty, rows("a"), false);
    tally = tallyNewMessages(tally, rows("a", "b"), false);
    tally = tallyNewMessages(tally, rows("a", "b", "c"), false);
    expect(tally.count).toBe(2);
  });

  it("counts a page of several messages once", () => {
    const anchored = tallyNewMessages(empty, rows("a"), false);
    expect(tallyNewMessages(anchored, rows("a", "b", "c", "d"), false)).toEqual({ count: 3, anchorId: "d" });
  });

  it("counts nothing while a message streams", () => {
    let tally = tallyNewMessages(empty, rows("a", "b"), false);
    tally = tallyNewMessages(tally, rows("a", "b"), false);
    expect(tally.count).toBe(0);
  });

  it("counts nothing for an older page the reader loaded", () => {
    const anchored = tallyNewMessages(empty, rows("c", "d"), false);
    expect(tallyNewMessages(anchored, rows("a", "b", "c", "d"), false)).toEqual(anchored);
  });

  it("counts nothing for the first page of a thread", () => {
    expect(tallyNewMessages(empty, rows("a", "b", "c"), false)).toEqual({ count: 0, anchorId: "c" });
  });

  it("counts nothing while the reader follows the newest message", () => {
    const following = tallyNewMessages({ count: 4, anchorId: "a" }, rows("a", "b"), true);
    expect(following).toEqual({ count: 0, anchorId: "b" });
  });

  it("keeps the count when the anchor leaves the window", () => {
    expect(tallyNewMessages({ count: 2, anchorId: "gone" }, rows("x", "y", "z"), false)).toEqual({
      count: 2,
      anchorId: "z",
    });
  });

  it("forgets the anchor of an empty timeline", () => {
    expect(tallyNewMessages({ count: 3, anchorId: "a" }, [], false)).toEqual(empty);
  });

  it("does not count an arrival the reader wrote", () => {
    const anchored = tallyNewMessages(empty, rows("a"), false);
    expect(tallyNewMessages(anchored, rows("a", "own-1"), false)).toEqual({ count: 0, anchorId: "own-1" });
  });

  /*
   * The reader wrote the whole thread so far and scrolled up. Their own messages hold the anchor,
   * or the reply that follows would read as a first page and count nothing.
   */
  it("counts the first reply to a thread of the reader's own messages", () => {
    const anchored = tallyNewMessages(empty, rows("own-1", "own-2"), false);
    expect(tallyNewMessages(anchored, rows("own-1", "own-2", "a"), false)).toEqual({ count: 1, anchorId: "a" });
  });
});

describe("anchorNewMessages", () => {
  it("takes the newest message as the anchor", () => {
    expect(anchorNewMessages(rows("a", "b"))).toEqual({ count: 0, anchorId: "b" });
  });

  /* A thread the reader wrote alone still has an anchor, or its first reply counts nothing. */
  it("takes the newest message of the reader's own thread as the anchor", () => {
    const anchored = anchorNewMessages(rows("own-1", "own-2"));
    expect(tallyNewMessages(anchored, rows("own-1", "own-2", "a"), false)).toEqual({ count: 1, anchorId: "a" });
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
