import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SPLASH_HANDOFF_DEADLINE_MS,
  SPLASH_MIN_VISIBLE_MS,
  type SplashArtwork,
  useSplashGate,
} from "./use-splash-gate";

const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  await act(() => root.unmount());
  vi.useRealTimers();
  root = createRoot(container);
});

async function renderGate(busy: boolean) {
  const hide = vi.fn();
  const current = { covered: true, report: (_: SplashArtwork) => {} };
  function Harness({ busy }: { busy: boolean }) {
    const gate = useSplashGate(busy, { hide });
    useLayoutEffect(() => {
      current.covered = gate.covered;
      current.report = gate.reportArtwork;
    });
    return null;
  }
  const render = (next: boolean) => act(() => root.render(<Harness busy={next} />));
  await render(busy);
  return {
    get covered() {
      return current.covered;
    },
    hide,
    render,
    report: (artwork: SplashArtwork) => act(() => current.report(artwork)),
    advance: (ms: number) => act(() => vi.advanceTimersByTime(ms)),
  };
}

describe("splash handoff", () => {
  it("holds the native splash until every source is on screen, then shows the artwork for its minimum window", async () => {
    const gate = await renderGate(false);
    expect(gate.covered).toBe(true);

    await gate.report("wallpaper");
    // Uncovering here would blink the app mark out while the wallpaper appears.
    expect(gate.hide).not.toHaveBeenCalled();

    await gate.report("mark");
    expect(gate.hide).toHaveBeenCalledOnce();

    await gate.advance(SPLASH_MIN_VISIBLE_MS - 1);
    expect(gate.covered).toBe(true);
    await gate.advance(1);
    expect(gate.covered).toBe(false);
  });

  it("releases the app when the artwork never reports", async () => {
    const gate = await renderGate(false);
    await gate.advance(SPLASH_HANDOFF_DEADLINE_MS);
    expect(gate.hide).toHaveBeenCalledOnce();

    await gate.advance(SPLASH_MIN_VISIBLE_MS);
    expect(gate.covered).toBe(false);
  });

  it("keeps covering past the minimum window while the account is still loading", async () => {
    const gate = await renderGate(true);
    await gate.report("wallpaper");
    await gate.report("mark");
    await gate.advance(SPLASH_MIN_VISIBLE_MS);
    expect(gate.covered).toBe(true);

    await gate.render(false);
    expect(gate.covered).toBe(false);
  });
});
