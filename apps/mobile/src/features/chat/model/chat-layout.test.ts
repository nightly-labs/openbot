import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_HISTORY_BATCH,
  type ChatLayout,
  chatBlankSpace,
  chatContentIsVisible,
  chatEndOffset,
  chatHistoryStart,
  chatSendOffset,
} from "./chat-layout";
import { largePastedText } from "./composer-paste";
import { createStreamRevealPool, streamRevealWindow } from "./stream-reveal-pool";

const short: ChatLayout = { viewport: 800, header: 100, content: 1300, tailY: 1100, tailHeight: 200 };
afterEach(() => vi.useRealTimers());

describe("chat positioning", () => {
  it("attaches only a large pasted insertion and keeps the surrounding draft", () => {
    const text = "word ".repeat(900);
    expect(largePastedText(`before ${"selection".repeat(900)} after`, `before ${text} after`)).toEqual({
      text,
      draft: "before  after",
    });
  });
  it("keeps the sent message at the same offset as the response consumes blank space", () => {
    const long = { ...short, content: 2100, tailHeight: 1000 };
    expect([
      chatBlankSpace(short),
      chatBlankSpace(long),
      chatSendOffset(short, Math.max(80, chatBlankSpace(short))),
      chatSendOffset(long, 80),
      chatEndOffset(long, 80),
    ]).toEqual([500, 0, 1000, 1000, 1380]);
  });
  it("absorbs the keyboard into blank space and moves only when the keyboard exceeds it", () => {
    const floor = chatBlankSpace(short);
    expect([0, 300, 600].map((keyboard) => chatEndOffset(short, Math.max(floor, 80 + keyboard)))).toEqual([
      1000, 1000, 1180,
    ]);
  });
  it("offers the latest-message action for obscured content, not for blank space", () => {
    const long = { ...short, content: 2100, tailHeight: 1000 };
    expect([
      chatContentIsVisible(short, 1000, 80),
      chatContentIsVisible(long, 1000, 80),
      chatContentIsVisible(long, 1380, 80),
      chatContentIsVisible(long, 1380, 380),
    ]).toEqual([true, false, true, false]);
  });
});

describe("streaming reveal work", () => {
  it("bounds active nodes and keeps revealing words even when completion callbacks are delayed", () => {
    vi.useFakeTimers();
    const pool = createStreamRevealPool();
    const skipped: number[] = [];
    const active = new Map<number, () => void>();
    for (let id = 0; id < 20; id++)
      pool.add({
        start: (done) => active.set(id, done),
        skip: () => {
          skipped.push(id);
          active.delete(id);
        },
      });
    for (let tick = 0; tick < 4; tick += 1) vi.runOnlyPendingTimers();
    expect({ skipped, active: [...active.keys()] }).toEqual({
      skipped: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      active: [10, 11, 12, 13],
    });
    vi.runOnlyPendingTimers();
    expect([...active.keys()]).toEqual([11, 12, 13, 14]);
    expect(skipped).toContain(10);
    pool.clear();
  });
  it("does not run queued work after it is removed or its conversation is closed", () => {
    vi.useFakeTimers();
    const pool = createStreamRevealPool();
    const start = vi.fn();
    pool.add({ start, skip: () => {} })();
    pool.add({ start, skip: () => {} });
    pool.clear();
    vi.runOnlyPendingTimers();
    expect(start).not.toHaveBeenCalled();
  });
});

it("bounds the reveal tail and retains all text when words finish or the stream changes", () => {
  const body = "word ".repeat(1000);
  const window = streamRevealWindow(body, "", true);
  expect({ size: window.words.length, text: window.prefix + window.words.map((word) => word.text).join("") }).toEqual({
    size: 14,
    text: body,
  });
  const completed = body.slice(0, window.words[window.words.length - 1].end);
  expect([
    streamRevealWindow(body, completed, true),
    streamRevealWindow("replacement", body, true),
    streamRevealWindow(body, "", false),
  ]).toEqual([
    { prefix: body, words: [] },
    { prefix: "replacement", words: [] },
    { prefix: body, words: [] },
  ]);
});

describe("chat history window", () => {
  const messages = Array.from({ length: 50 }, (_, index) => ({ id: String(index) }));
  const empty = { firstId: null, headId: null };

  it("opens the recent messages and retains the latest user-message anchor", () => {
    expect(messages.slice(chatHistoryStart(messages, 48, empty))).toEqual(messages.slice(-CHAT_HISTORY_BATCH));
    expect(chatHistoryStart(messages, 10, empty)).toBe(10);
    expect(chatHistoryStart(messages, -1, empty)).toBe(34);
    expect(chatHistoryStart([], -1, empty)).toBe(0);
  });

  it("keeps the first visible message when new messages arrive", () => {
    const updated = [...messages, { id: "new" }];
    const start = chatHistoryStart(updated, 50, { firstId: "34", headId: "0" });
    expect(updated[start]?.id).toBe("34");
    expect(updated.slice(start).at(-1)?.id).toBe("new");
  });

  it("reveals every cached message in batches without a server page", () => {
    let start = chatHistoryStart(messages, 48, empty);
    const revealed = messages.slice(start);
    while (start > 0) {
      const firstId = messages[Math.max(0, start - CHAT_HISTORY_BATCH)].id;
      const next = chatHistoryStart(messages, 48, { firstId, headId: "0" });
      revealed.unshift(...messages.slice(next, start));
      start = next;
    }
    expect(revealed).toEqual(messages);
  });

  it("shows the nearest part of a newly fetched older page and keeps a scrolled window stable", () => {
    const older = Array.from({ length: 50 }, (_, index) => ({ id: `old-${index}` }));
    const updated = [...older, ...messages];
    expect(chatHistoryStart(updated, 98, { firstId: "0", headId: "0" })).toBe(34);
    expect(chatHistoryStart(updated, 98, { firstId: "34", headId: "0" })).toBe(84);
  });

  it("resets to recent messages if a reconnect replaces the history window", () => {
    const replaced = messages.map((message) => ({ id: `replacement-${message.id}` }));
    expect(chatHistoryStart(replaced, 48, { firstId: "34", headId: "0" })).toBe(34);
  });
});
