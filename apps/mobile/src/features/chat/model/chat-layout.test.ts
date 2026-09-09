import { afterEach, describe, expect, it, vi } from "vitest";
import { type ChatLayout, chatBlankSpace, chatContentIsVisible, chatEndOffset, chatSendOffset } from "./chat-layout";
import { largePastedText } from "./composer-paste";
import { createStreamRevealPool } from "./stream-reveal-pool";

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
  it("bounds active nodes, exposes an oversized backlog, and releases the next work on completion", () => {
    vi.useFakeTimers();
    const pool = createStreamRevealPool();
    const skipped: number[] = [];
    const active = new Map<number, () => void>();
    for (let id = 0; id < 20; id++) pool.add({ start: (done) => active.set(id, done), skip: () => skipped.push(id) });
    vi.runOnlyPendingTimers();
    vi.runOnlyPendingTimers();
    expect({ skipped, active: [...active.keys()] }).toEqual({
      skipped: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      active: [10, 11, 12, 13],
    });
    active.get(10)?.();
    active.delete(10);
    vi.runOnlyPendingTimers();
    expect([...active.keys()]).toEqual([11, 12, 13, 14]);
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
