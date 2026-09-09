import { BloubBot, BotEngine, makeBlock } from "@norbert_bodziony/bloub";
import type { AvatarHue } from "@openbot/contracts/ipc";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createStore, For, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AvatarMotion } from "../../bloub-avatar";
import { AgentAvatar } from "./AgentAvatar";

function playback() {
  const samples = new Map<BotEngine, number[]>();
  const frames = new Map<BotEngine, ReturnType<BotEngine["sample"]>>();
  const sample = BotEngine.prototype.sample;
  vi.spyOn(BotEngine.prototype, "sample").mockImplementation(function (this: BotEngine, time) {
    const times = samples.get(this) ?? [];
    times.push(time);
    samples.set(this, times);
    const frame = sample.call(this, time);
    frames.set(this, frame);
    return frame;
  });
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  return {
    samples,
    frames,
    callbacks,
    frame(time: number) {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(time);
      flush();
    },
  };
}

function motionPreference(matches: boolean) {
  const media = Object.assign(new EventTarget(), { matches, media: "(prefers-reduced-motion: reduce)" });
  vi.stubGlobal("matchMedia", () => media);
  return (value: boolean) => {
    media.matches = value;
    media.dispatchEvent(new Event("change"));
    flush();
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("AgentAvatar playback", () => {
  it("keeps distinct drawing phases across updates, reordering, and remounts", () => {
    motionPreference(false);
    const clock = playback();
    const [state, setState] = createStore<{ seeds: string[]; hue: AvatarHue; label: string }>({
      seeds: ["agent-alpha", "agent-beta", "agent-gamma"],
      hue: 215,
      label: "Before",
    });
    const mount = () =>
      render(() => (
        <For each={state.seeds}>
          {(seed) => (
            <button type="button" aria-label={`${state.label} ${seed}`}>
              <AgentAvatar seed={seed} hue={state.hue} motion="idle" />
            </button>
          )}
        </For>
      ));
    const view = mount();
    flush();
    const initial = [...clock.samples.values()].map((times) => times[0]);
    expect(initial).toHaveLength(3);
    expect(new Set(initial).size).toBe(3);
    for (const phase of initial) {
      expect(phase).toBeGreaterThan(0);
      expect(phase).toBeLessThan(1.4);
    }
    const engines = [...clock.samples.keys()];
    clock.frame(1000);
    clock.frame(1040);
    setState((draft) => {
      draft.label = "After";
      draft.hue = 280;
      draft.seeds.reverse();
    });
    flush();
    expect(screen.getByRole("button", { name: "After agent-alpha" })).toBeInTheDocument();
    expect([...clock.samples.keys()]).toEqual(engines);
    clock.frame(1080);
    for (const times of clock.samples.values()) {
      expect(times.at(-1)).toBeCloseTo((times[0] ?? 0) + 0.08);
    }
    view.unmount();
    expect(clock.callbacks.size).toBe(0);
    clock.samples.clear();
    mount();
    flush();
    expect([...clock.samples.values()].map((times) => times[0])).toEqual(initial.toReversed());
  });

  it.each([0, 1.2])("uses the explicit phase %s instead of the seed", (phase) => {
    motionPreference(false);
    const clock = playback();
    render(() => <AgentAvatar seed="agent-alpha" motion="working" animationOffset={phase} />);
    flush();
    expect([...clock.samples.values()].map((times) => times[0])).toEqual([phase]);
  });

  it.each([
    ["idle", "working", "orbit"],
    ["working", "idle", "idle"],
  ] as const)("changes from %s to %s without restarting playback", (from, to, expectedState) => {
    motionPreference(false);
    const clock = playback();
    const [state, setState] = createStore<{ motion: AvatarMotion }>({ motion: from });
    render(() => <AgentAvatar seed="agent-alpha" motion={state.motion} animationOffset={1.2} />);
    flush();
    const engines = [...clock.samples.keys()];
    clock.frame(1000);
    clock.frame(1040);
    setState((draft) => {
      draft.motion = to;
    });
    flush();
    expect([...clock.samples.keys()]).toEqual(engines);
    expect(engines).toHaveLength(1);
    expect(engines[0]?.state).toBe(expectedState);
    clock.frame(1080);
    for (const times of clock.samples.values()) {
      expect(times.at(-1)).toBeCloseTo(1.28);
    }
  });

  it("keeps distinct working poses and cycle positions after simultaneous activity changes", () => {
    const clock = playback();
    const [state, setState] = createStore({ working: false });
    const idle = [makeBlock("idle")];
    const working = [makeBlock("orbit")];
    const elapsedByPhase = new Map<number, number>();
    render(() => (
      <For each={[0.2, 0.9]}>
        {(phase) => (
          <BloubBot
            cycle={state.working ? working : idle}
            playing
            initialPhase={phase}
            onElapsedChange={(elapsed) => elapsedByPhase.set(phase, elapsed)}
          />
        )}
      </For>
    ));
    flush();
    clock.frame(1000);
    clock.frame(1040);
    const before = [...clock.frames.values()].map((frame) => frame.bodyPath);
    setState((draft) => {
      draft.working = true;
    });
    flush();
    clock.frame(1040);
    expect([...clock.frames.values()].map((frame) => frame.bodyPath)).toEqual(before);
    const positions = [...elapsedByPhase.values()];
    for (let frame = 1; frame <= 20; frame += 1) clock.frame(1040 + frame * 40);
    const arcs = [...clock.frames.values()].flatMap((frame) => frame.arcs.slice(0, 1).map((arc) => arc.front));
    expect(arcs).toHaveLength(2);
    expect(new Set(arcs).size).toBe(2);
    expect(positions[0]).toBeCloseTo(0.2);
    expect(positions[1]).toBeCloseTo(0.9);
    const workingPoses = [...clock.frames.values()].map((frame) => frame.bodyPath);
    setState((draft) => {
      draft.working = false;
    });
    flush();
    clock.frame(1840);
    expect([...clock.frames.values()].map((frame) => frame.bodyPath)).toEqual(workingPoses);
    clock.frame(1880);
    const midTransition = [...clock.frames.values()].map((frame) => frame.bodyPath);
    setState((draft) => {
      draft.working = true;
    });
    flush();
    clock.frame(1880);
    expect([...clock.frames.values()].map((frame) => frame.bodyPath)).toEqual(midTransition);
  });

  it("keeps reduced-motion avatars static and stops playback when the preference changes", () => {
    const setReducedMotion = motionPreference(true);
    const clock = playback();
    render(() => <AgentAvatar seed="agent-alpha" motion="working" />);
    flush();
    expect(clock.callbacks.size).toBe(0);
    expect([...clock.samples.values()].map((times) => times[0])).toEqual([0]);
    setReducedMotion(false);
    expect(clock.callbacks.size).toBe(1);
    setReducedMotion(true);
    expect(clock.callbacks.size).toBe(0);
  });

  it("starts and stops hover playback for pointer and keyboard interaction", async () => {
    motionPreference(false);
    const clock = playback();
    render(() => (
      <button type="button">
        Agent
        <AgentAvatar seed="agent-alpha" />
      </button>
    ));
    const target = screen.getByRole("button", { name: "Agent" });
    expect(clock.callbacks.size).toBe(0);
    await fireEvent.pointerEnter(target);
    expect(clock.callbacks.size).toBe(1);
    await fireEvent.pointerLeave(target);
    expect(clock.callbacks.size).toBe(0);
    await fireEvent.focusIn(target);
    expect(clock.callbacks.size).toBe(1);
    await fireEvent.focusOut(target);
    expect(clock.callbacks.size).toBe(0);
  });

  it("initializes the library drawing clock and cycle position together", () => {
    const clock = playback();
    const idle = makeBlock("idle");
    const changes = vi.fn();
    render(() => (
      <BloubBot
        cycle={[idle, makeBlock("orbit")]}
        playing
        initialPhase={idle.duration + 0.5}
        onElapsedChange={changes}
      />
    ));
    flush();
    const engine = [...clock.samples.keys()][0];
    expect(engine?.state).toBe("orbit");
    expect([...clock.samples.values()].map((times) => times[0])).toEqual([idle.duration + 0.5]);
    expect(changes).toHaveBeenLastCalledWith(0.5);
    clock.frame(1000);
    clock.frame(1040);
    expect(changes).toHaveBeenLastCalledWith(expect.closeTo(0.54));
  });
});
