// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { NetworkReturned } from "./network-returned";

afterEach(() => {
  vi.useRealTimers();
});

function makeWatch(options: { pollMs?: number; online?: () => boolean } = {}) {
  const returned = vi.fn();
  const watch = new NetworkReturned({
    isOnline: options.online ?? (() => true),
    pollMs: options.pollMs ?? 1_000,
    onReturned: returned,
  });
  return { returned, watch };
}

describe("network returned", () => {
  it("reports once when the link goes away and comes back", () => {
    vi.useFakeTimers();
    let online = true;
    const { returned, watch } = makeWatch({ online: () => online });
    online = false;
    vi.advanceTimersByTime(3_000);
    expect(returned).not.toHaveBeenCalled();
    online = true;
    vi.advanceTimersByTime(1_000);
    expect(returned).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
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

  it("reports each return of a link that drops twice", () => {
    vi.useFakeTimers();
    let online = true;
    const { returned, watch } = makeWatch({ online: () => online });
    online = false;
    vi.advanceTimersByTime(1_000);
    online = true;
    vi.advanceTimersByTime(1_000);
    online = false;
    vi.advanceTimersByTime(1_000);
    online = true;
    vi.advanceTimersByTime(1_000);
    expect(returned).toHaveBeenCalledTimes(2);
    watch.dispose();
  });

  it("reports nothing after dispose", () => {
    vi.useFakeTimers();
    let online = true;
    const { returned, watch } = makeWatch({ online: () => online });
    online = false;
    vi.advanceTimersByTime(1_000);
    watch.dispose();
    online = true;
    vi.advanceTimersByTime(10_000);
    expect(returned).not.toHaveBeenCalled();
  });

  it("reports a link that was away when the watch started", () => {
    vi.useFakeTimers();
    let online = false;
    const { returned, watch } = makeWatch({ online: () => online });
    vi.advanceTimersByTime(1_000);
    expect(returned).not.toHaveBeenCalled();
    online = true;
    vi.advanceTimersByTime(1_000);
    expect(returned).toHaveBeenCalledTimes(1);
    watch.dispose();
  });
});
