import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFramePacer, SCREENCAST_MINIMUM_FRAME_INTERVAL_MS } from "./browser-screencast-pacing";

describe("createFramePacer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("holds a page that draws faster than the view can show to the interval", () => {
    const sent: number[] = [];
    const pacer = createFramePacer<number>((frame) => sent.push(frame));

    // A page with an animation draws about every 8 ms. Two seconds of it must not become two
    // seconds of frames on the link.
    for (let frame = 0; frame < 250; frame += 1) {
      pacer.offer(frame);
      vi.advanceTimersByTime(8);
    }

    expect(sent.length).toBeLessThanOrEqual(2000 / SCREENCAST_MINIMUM_FRAME_INTERVAL_MS + 1);
    expect(sent.length).toBeGreaterThan(50);
    // Each frame sent is a later one than the frame before it, in the order the page drew them.
    expect([...sent].sort((a, b) => a - b)).toEqual(sent);
  });

  it("sends a frame at once when the page has been quiet", () => {
    const sent: number[] = [];
    const pacer = createFramePacer<number>((frame) => sent.push(frame));

    pacer.offer(1);
    expect(sent).toEqual([1]);

    vi.advanceTimersByTime(5_000);
    pacer.offer(2);
    expect(sent).toEqual([1, 2]);
  });

  it("still sends the last frame of a burst, and only the newest held one", () => {
    const sent: number[] = [];
    const pacer = createFramePacer<number>((frame) => sent.push(frame));

    pacer.offer(1);
    pacer.offer(2);
    pacer.offer(3);
    // A page that stops changing sends nothing more, so a held frame that is never released would
    // leave the view showing the page before it settled.
    expect(sent).toEqual([1]);
    vi.advanceTimersByTime(SCREENCAST_MINIMUM_FRAME_INTERVAL_MS);
    expect(sent).toEqual([1, 3]);
  });

  it("sends nothing after it is stopped", () => {
    const sent: number[] = [];
    const pacer = createFramePacer<number>((frame) => sent.push(frame));

    pacer.offer(1);
    pacer.offer(2);
    pacer.stop();
    vi.advanceTimersByTime(1_000);
    expect(sent).toEqual([1]);
  });
});
