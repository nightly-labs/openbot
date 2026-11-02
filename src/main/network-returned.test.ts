// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { NetworkReturned } from "./network-returned";

afterEach(() => {
  vi.useRealTimers();
});

function makeWatch(options: { pollMs?: number; onlineReads?: number; minGapMs?: number; online?: () => boolean } = {}) {
  const returned = vi.fn();
  const watch = new NetworkReturned({
    isOnline: options.online ?? (() => true),
    pollMs: options.pollMs ?? 1_000,
    onlineReads: options.onlineReads,
    minGapMs: options.minGapMs,
    onReturned: returned,
  });
  return { returned, watch };
}

describe("network returned", () => {
  it("reports a return only after several online reads in a row", () => {
    vi.useFakeTimers();
    let online = false;
    const { returned, watch } = makeWatch({ onlineReads: 2, online: () => online, pollMs: 1_000 });
    online = true;
    vi.advanceTimersByTime(1_000);
    expect(returned).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(returned).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(returned).toHaveBeenCalledTimes(1);
    watch.dispose();
  });

  it("reports nothing while the link stays up", () => {
    vi.useFakeTimers();
    const { returned, watch } = makeWatch({ online: () => true });
    vi.advanceTimersByTime(60_000);
    expect(returned).not.toHaveBeenCalled();
    watch.dispose();
  });

  it("starts its online reads again when the link drops between them", () => {
    vi.useFakeTimers();
    let online = false;
    const { returned, watch } = makeWatch({ onlineReads: 2, online: () => online, pollMs: 1_000 });
    online = true;
    vi.advanceTimersByTime(1_000);
    online = false;
    vi.advanceTimersByTime(1_000);
    online = true;
    vi.advanceTimersByTime(1_000);
    expect(returned).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(returned).toHaveBeenCalledTimes(1);
    watch.dispose();
  });

  it("leaves a return that follows the previous one too closely unreported", () => {
    vi.useFakeTimers();
    let online = true;
    const { returned, watch } = makeWatch({ onlineReads: 1, minGapMs: 30_000, online: () => online });
    online = false;
    vi.advanceTimersByTime(1_000);
    online = true;
    vi.advanceTimersByTime(1_000);
    expect(returned).toHaveBeenCalledTimes(1);
    online = false;
    vi.advanceTimersByTime(1_000);
    online = true;
    // Inside the gap: the servers' own backoff answers this flap.
    vi.advanceTimersByTime(1_000);
    expect(returned).toHaveBeenCalledTimes(1);
    online = false;
    vi.advanceTimersByTime(1_000);
    online = true;
    vi.advanceTimersByTime(31_000);
    expect(returned).toHaveBeenCalledTimes(2);
    watch.dispose();
  });

  it("reports nothing after dispose", () => {
    vi.useFakeTimers();
    let online = false;
    const { returned, watch } = makeWatch({ onlineReads: 1, online: () => online });
    watch.dispose();
    online = true;
    vi.advanceTimersByTime(30_000);
    expect(returned).not.toHaveBeenCalled();
  });

  it("reports a link that was away when the watch started", () => {
    vi.useFakeTimers();
    let online = false;
    const { returned, watch } = makeWatch({ onlineReads: 2, online: () => online, pollMs: 1_000 });
    vi.advanceTimersByTime(1_000);
    expect(returned).not.toHaveBeenCalled();
    online = true;
    vi.advanceTimersByTime(2_000);
    expect(returned).toHaveBeenCalledTimes(1);
    watch.dispose();
  });
});
