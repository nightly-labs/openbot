import { act, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { WithTimingConfig } from "react-native-reanimated";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SPLASH_HANDOFF_DEADLINE_MS, type SplashArtwork, useSplashGate } from "./use-splash-gate";

import { useSplashMotion } from "./use-splash-motion";

const animation = vi.hoisted(() => {
  const callbacks: Array<(finished: boolean) => void> = [];
  return { callbacks };
});
// Reanimated and worklet scheduling have no DOM runtime. Tests drive completion
// explicitly, including callbacks delivered after a later loading state.
vi.mock("react-native-reanimated", () => ({
  Easing: { bezier: () => ({ factory: () => (value: number) => value }), linear: (value: number) => value },
  ReduceMotion: { System: "system", Never: "never" },
  useSharedValue: (initial: number) => {
    const state = useRef(initial);
    return useRef({
      get: () => state.current,
      set: (value: number) => {
        state.current = value;
      },
    }).current;
  },
  cancelAnimation: () => {},
  withTiming: (_value: number, _config: WithTimingConfig, callback: (finished: boolean) => void) => {
    animation.callbacks.push(callback);
    return 0;
  },
}));
vi.mock("react-native-worklets", () => ({
  scheduleOnRN: (callback: (run: number) => void, run: number) => callback(run),
}));

const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);

beforeEach(() => {
  animation.callbacks = [];
  vi.useFakeTimers();
});
afterEach(async () => {
  await act(() => root.unmount());
  vi.useRealTimers();
  root = createRoot(container);
});

async function renderGate(busy: boolean, nativeReady = true) {
  const hide = vi.fn();
  const current = { covered: true, report: (_: SplashArtwork) => {}, ready: () => {} };
  function Harness({ busy, nativeReady }: { busy: boolean; nativeReady: boolean }) {
    const gate = useSplashGate(busy, { hide }, nativeReady);
    useLayoutEffect(() => {
      current.covered = gate.covered;
      current.report = gate.reportArtwork;
      current.ready = gate.reportContentReady;
    });
    return null;
  }
  const render = (next: boolean, nextNativeReady = true) =>
    act(() => root.render(<Harness busy={next} nativeReady={nextNativeReady} />));
  await render(busy, nativeReady);
  return {
    get covered() {
      return current.covered;
    },
    hide,
    render,
    ready: () => act(() => current.ready()),
    report: (artwork: SplashArtwork) => act(() => current.report(artwork)),
    advance: (ms: number) => act(() => vi.advanceTimersByTime(ms)),
  };
}

describe("splash handoff", () => {
  it("waits for artwork and screen layout without an extra display delay", async () => {
    const gate = await renderGate(false);
    await gate.ready();
    expect(gate.covered).toBe(true);
    await gate.report("wallpaper");
    expect(gate.hide).not.toHaveBeenCalled();
    await gate.report("mark");
    expect(gate.hide).toHaveBeenCalledOnce();
    expect(gate.covered).toBe(false);
  });

  it("keeps the native cover until the saved appearance is ready", async () => {
    const gate = await renderGate(true, false);
    await gate.advance(SPLASH_HANDOFF_DEADLINE_MS);
    expect(gate.hide).not.toHaveBeenCalled();
    await gate.render(false, true);
    await gate.ready();
    await gate.report("wallpaper");
    expect(gate.hide).not.toHaveBeenCalled();
    await gate.report("mark");
    expect(gate.hide).toHaveBeenCalledOnce();
    expect(gate.covered).toBe(false);
  });

  it("keeps the backdrop while the destination has not completed layout", async () => {
    const gate = await renderGate(false);
    await gate.report("wallpaper");
    await gate.report("mark");
    await gate.advance(SPLASH_HANDOFF_DEADLINE_MS);
    expect(gate.covered).toBe(true);
    await gate.ready();
    expect(gate.covered).toBe(false);
  });

  it("releases the native splash when artwork never reports, but still waits for content", async () => {
    const gate = await renderGate(false);
    await gate.advance(SPLASH_HANDOFF_DEADLINE_MS);
    expect(gate.hide).toHaveBeenCalledOnce();
    expect(gate.covered).toBe(true);
    await gate.ready();
    expect(gate.covered).toBe(false);
    await gate.report("wallpaper");
    await gate.report("mark");
    expect(gate.hide).toHaveBeenCalledOnce();
  });

  it("keeps covering a slow account or appearance load after content is ready", async () => {
    const gate = await renderGate(true);
    await gate.report("wallpaper");
    await gate.report("mark");
    await gate.ready();
    await gate.advance(SPLASH_HANDOFF_DEADLINE_MS);
    expect(gate.covered).toBe(true);
    await gate.render(false);
    expect(gate.covered).toBe(false);
  });

  it("can cover a later busy state without replaying native startup or a minimum wait", async () => {
    const gate = await renderGate(false);
    await gate.report("wallpaper");
    await gate.report("mark");
    await gate.ready();
    await gate.render(true);
    expect(gate.covered).toBe(true);
    await gate.render(false);
    expect(gate.covered).toBe(false);
    expect(gate.hide).toHaveBeenCalledOnce();
  });

  it("cancels the fallback on unmount", async () => {
    const gate = await renderGate(true);
    await act(() => root.render(null));
    await gate.advance(SPLASH_HANDOFF_DEADLINE_MS);
    expect(gate.hide).not.toHaveBeenCalled();
  });
});

async function renderMotion(reducedMotion = false) {
  const current = { complete: false, revealing: false, finish: () => {} };
  function Harness({ covered, foreground }: { covered: boolean; foreground: boolean }) {
    const motion = useSplashMotion({ covered, foreground, reducedMotion, hasTarget: true });
    useLayoutEffect(() => {
      current.complete = motion.complete;
      current.revealing = motion.revealing;
      current.finish = motion.finish;
    });
    return null;
  }
  const render = (covered: boolean, foreground = true) =>
    act(() => root.render(<Harness covered={covered} foreground={foreground} />));
  await render(true);
  return { current, render };
}

describe("splash motion lifecycle", () => {
  it.each([false, true])(
    "reveals ready content without waiting for animation completion (reduced motion: %s)",
    async (reduced) => {
      const motion = await renderMotion(reduced);
      expect(motion.current.revealing).toBe(false);
      expect(animation.callbacks).toHaveLength(0);
      await motion.render(false);
      expect(motion.current.revealing).toBe(true);
      expect(motion.current.complete).toBe(false);
      expect(animation.callbacks).toHaveLength(1);
      await act(() => animation.callbacks[0]?.(true));
      expect(motion.current.complete).toBe(true);
    },
  );

  it("finishes the introduction immediately when the user starts scanning", async () => {
    const motion = await renderMotion();
    await motion.render(false);
    await act(() => motion.current.finish());
    expect(motion.current.complete).toBe(true);
    const started = animation.callbacks.length;
    await act(() => animation.callbacks[0]?.(true));
    expect(motion.current.complete).toBe(true);
    expect(animation.callbacks).toHaveLength(started);
  });

  it("settles an interrupted launch and does not replay it on foreground", async () => {
    const motion = await renderMotion();
    await motion.render(false);
    await motion.render(false, false);
    expect(motion.current.complete).toBe(true);
    const started = animation.callbacks.length;
    await motion.render(false, true);
    expect(motion.current.complete).toBe(true);
    expect(animation.callbacks).toHaveLength(started);
  });

  it("ignores stale completion after loading resumes, then permits another reveal", async () => {
    const motion = await renderMotion();
    await motion.render(false);
    const previous = animation.callbacks[0];
    await motion.render(true);
    await act(() => previous?.(true));
    expect(motion.current.complete).toBe(false);
    expect(motion.current.revealing).toBe(false);
    await motion.render(false);
    await act(() => animation.callbacks.at(-1)?.(true));
    expect(motion.current.complete).toBe(true);
  });
});
