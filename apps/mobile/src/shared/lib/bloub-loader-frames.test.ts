import { afterEach, describe, expect, it, vi } from "vitest";

import { prepareLoaderFrames, prepareReturnToIdleFrames } from "./bloub-loader-frames";

// The loader's exit waits for its settling sequence, so preparation must finish
// even on a thread that never reports idle time - opening a chat and streaming a
// reply is exactly that thread.
function withoutIdleTime() {
  const idle = vi.fn(() => 1);
  vi.stubGlobal("requestIdleCallback", idle);
  vi.stubGlobal("cancelIdleCallback", vi.fn());
  return idle;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("bloub loader frame preparation", () => {
  it("finishes without an idle callback", async () => {
    vi.useFakeTimers();
    const idle = withoutIdleTime();
    const ready = vi.fn();

    prepareReturnToIdleFrames(3, ready);
    await vi.advanceTimersByTimeAsync(2000);

    expect(idle).toHaveBeenCalled();
    expect(ready).toHaveBeenCalledOnce();
    expect(ready.mock.calls[0]?.[0].length).toBeGreaterThan(1);
  });

  it("stops preparing once cancelled", async () => {
    vi.useFakeTimers();
    withoutIdleTime();
    const ready = vi.fn();

    prepareLoaderFrames(ready)();
    await vi.advanceTimersByTimeAsync(2000);

    expect(ready).not.toHaveBeenCalled();
  });
});
