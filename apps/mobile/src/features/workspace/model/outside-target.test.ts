import { describe, expect, it } from "vitest";
import { waitTaskCapability } from "./outside-target";

/** A driven clock: each asked wait records itself and moves `now`. */
function drivenClock() {
  const waited: number[] = [];
  let now = 1_000;
  const sleep = async (ms: number) => {
    waited.push(ms);
    now += ms;
  };
  return { waited, now: () => now, sleep };
}

describe("waitTaskCapability", () => {
  it("returns at once when the server answers without agent tasks (an old host)", async () => {
    const waited: number[] = [];
    const supported = await waitTaskCapability(
      () => false,
      () => "online",
      8_000,
      async () => waited.push(250),
    );
    expect(supported).toBe(false);
    expect(waited).toEqual([]);
  });

  it("returns at once when the host is out of reach", async () => {
    const waited: number[] = [];
    const supported = await waitTaskCapability(
      () => false,
      () => "offline",
      8_000,
      async () => waited.push(250),
    );
    expect(supported).toBe(false);
    expect(waited).toEqual([]);
  });

  it("returns at once when the capability is already known", async () => {
    const waited: number[] = [];
    const supported = await waitTaskCapability(
      () => true,
      () => "connecting",
      8_000,
      async () => waited.push(250),
    );
    expect(supported).toBe(true);
    expect(waited).toEqual([]);
  });

  it("waits for a cold-start tap until the compatibility check answers", async () => {
    const clock = drivenClock();
    let supported = false;
    const result = await waitTaskCapability(
      () => supported,
      () => "connecting",
      8_000,
      async (ms) => {
        await clock.sleep(ms);
        // The compatibility check answers on the second poll, before the state turns online.
        if (clock.waited.length >= 2) supported = true;
      },
      clock.now,
    );
    expect(result).toBe(true);
    expect(clock.waited.length).toBeGreaterThanOrEqual(2);
    expect(clock.now()).toBeLessThan(1_000 + 8_000);
  });

  it("gives up at the deadline when the check never answers", async () => {
    const clock = drivenClock();
    const supported = await waitTaskCapability(
      () => false,
      () => "connecting",
      8_000,
      clock.sleep,
      clock.now,
    );
    expect(supported).toBe(false);
    expect(clock.now()).toBeGreaterThanOrEqual(1_000 + 8_000);
    expect(clock.now()).toBeLessThan(1_000 + 8_000 + 1_000);
  });

  it("reads the capability again at the deadline", async () => {
    const clock = drivenClock();
    // The capability answers while the last poll waits past the deadline.
    const supportedAt = 1_000 + 7_900;
    const result = await waitTaskCapability(
      () => clock.now() >= supportedAt,
      () => "connecting",
      8_000,
      clock.sleep,
      clock.now,
    );
    expect(result).toBe(true);
  });
});
