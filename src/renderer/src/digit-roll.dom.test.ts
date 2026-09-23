import { createDigitRoll } from "@openbot/ui/digit-roll";
import { createRoot, createSignal, flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * An update reports every whole percent it downloads, which is faster than the roll the digits run.
 * These cases pin what stops that from restarting the animation on each one, because the symptom -
 * digits held at the blurred first frame for the whole download - is a rendered frame no assertion
 * about the DOM can see.
 */
function mountRoll(animate?: () => boolean) {
  const [percent, setPercent] = createSignal(0);
  const group = document.createElement("span");
  const { roll, dispose } = createRoot((dispose) => {
    const roll = createDigitRoll(percent, { settleMs: 400, animate });
    roll.ref(group);
    return { roll, dispose };
  });
  return { group, roll, setPercent, dispose };
}

describe("digit roll", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("rolls once to the newest value, not once per value", () => {
    const { group, roll, setPercent, dispose } = mountRoll();

    // The group rolls in on mount. Cleared, so the class below can only come from a restart.
    flush();
    group.classList.remove("is-animating");
    for (const value of [1, 2, 3, 4, 5]) flush(() => setPercent(value));
    // Still the settled value: the roll in flight is left to finish.
    expect(roll.displayed()).toBe(0);
    expect(group.classList.contains("is-animating")).toBe(false);

    vi.advanceTimersByTime(400);
    flush();
    expect(roll.displayed()).toBe(5);
    expect(group.classList.contains("is-animating")).toBe(true);
    dispose();
  });

  it("leaves a hidden group's digits alone", () => {
    const { group, roll, setPercent, dispose } = mountRoll(() => false);

    flush(() => setPercent(42));
    vi.advanceTimersByTime(400);
    flush();

    expect(roll.displayed()).toBe(42);
    expect(group.classList.contains("is-animating")).toBe(false);
    dispose();
  });
});
