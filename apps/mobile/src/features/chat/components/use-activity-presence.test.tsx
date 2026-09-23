import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ACTIVITY_HOLD_MS, useActivityPresence } from "./use-activity-presence";

const container = document.createElement("div");
let root = createRoot(container);
afterEach(async () => {
  await act(() => root.unmount());
  root = createRoot(container);
  vi.useRealTimers();
});

it("holds the last row across the gap between the send flag and the host's activity", async () => {
  vi.useFakeTimers();
  let rows: readonly string[] = [];
  function Indicator({ active }: { active: readonly string[] }) {
    const held = useActivityPresence(active);
    useLayoutEffect(() => {
      rows = held;
    });
    return null;
  }

  await act(() => root.render(<Indicator active={["Sending…"]} />));
  expect(rows).toEqual(["Sending…"]);

  // The send resolves before the host reports the turn. The row must survive that gap.
  await act(() => root.render(<Indicator active={[]} />));
  expect(rows).toEqual(["Sending…"]);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ACTIVITY_HOLD_MS - 20);
  });
  expect(rows).toEqual(["Sending…"]);

  await act(() => root.render(<Indicator active={["Thinking…"]} />));
  expect(rows).toEqual(["Thinking…"]);

  // The turn really ends: the row is released once the hold runs out.
  await act(() => root.render(<Indicator active={[]} />));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ACTIVITY_HOLD_MS);
  });
  expect(rows).toEqual([]);
});
