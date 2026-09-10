import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import type { LayoutChangeEvent } from "react-native";
import { afterEach, expect, it, vi } from "vitest";
import { type ChatMotion, useChatMotion } from "./use-chat-motion";

const native = vi.hoisted(() => {
  const keyboard: Record<string, (event: { height: number }) => void> = {};
  const reactions: (() => void)[] = [];
  return { keyboard, reactions, frames: new Map<number, FrameRequestCallback>(), nextFrame: 0, scrollTo: vi.fn() };
});

// Replace the native event/runtime boundary; run the real chat hook and React lifecycle.
vi.mock("react-native-keyboard-controller", () => ({
  useKeyboardHandler: (handlers: typeof native.keyboard) => {
    native.keyboard = handlers;
  },
}));
vi.mock("react-native-worklets", () => ({
  scheduleOnRN: (callback: (value: boolean) => void, value: boolean) => callback(value),
}));
vi.mock("react-native-reanimated", async () => {
  const { useRef } = await import("react");
  function useSharedValue<T>(initial: T) {
    return useRef({
      value: initial,
      get() {
        return this.value;
      },
      set(value: T) {
        this.value = value;
      },
    }).current;
  }
  return {
    ReduceMotion: { System: "system" },
    useSharedValue,
    useAnimatedRef: () => useRef({ current: { scrollTo: native.scrollTo } }).current,
    useReducedMotion: () => true,
    useAnimatedStyle: () => ({}),
    useAnimatedScrollHandler: (handler: unknown) => handler,
    useDerivedValue: (get: () => number) => ({ get }),
    useAnimatedReaction: (prepare: () => boolean, react: (value: boolean, previous: boolean | null) => void) => {
      native.reactions.push(() => react(prepare(), null));
    },
    cancelAnimation: () => {},
    withTiming: (value: number) => value,
    withSpring: (value: number) => value,
  };
});

const container = document.createElement("div");
let root = createRoot(container);
afterEach(async () => {
  await act(() => root.unmount());
  root = createRoot(container);
  native.frames.clear();
  native.reactions = [];
  vi.unstubAllGlobals();
});

function layout(height: number, y = 0): Pick<LayoutChangeEvent, "nativeEvent"> {
  return { nativeEvent: { layout: { height, y, x: 0, width: 390 } } };
}

it("keeps replies visible and does not scroll after keyboard dismissal, including an interrupted final frame", async () => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++native.nextFrame;
    native.frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => native.frames.delete(id));
  let motion: ChatMotion | undefined;
  function Chat() {
    const current = useChatMotion(100, 24, true, "user-1");
    useLayoutEffect(() => {
      motion = current;
    });
    return null;
  }
  async function flush() {
    await act(() => {
      while (native.frames.size) {
        const frames = [...native.frames.values()];
        native.frames.clear();
        for (const frame of frames) frame(0);
      }
      native.reactions.at(-1)?.();
    });
  }
  await act(() => root.render(<Chat />));
  if (!motion) throw new Error("Chat motion is not mounted");
  motion.onViewportLayout(layout(800));
  motion.onComposerLayout(layout(80));
  motion.onTailLayout("user-1", layout(550, 100));
  motion.onContentSizeChange(390, 650);
  motion.onContentInsetChange({ bottom: 150 });
  await flush();
  native.scrollTo.mockClear();

  native.keyboard.onMove({ height: 300 });
  native.keyboard.onEnd({ height: 300 });
  await flush();
  expect(motion.atLatest).toBe(false);

  native.keyboard.onInteractive({ height: 150 });
  // Dismissal can finish without an onMove frame at height zero.
  native.keyboard.onEnd({ height: 0 });
  await flush();
  expect(motion.atLatest).toBe(true);

  // A streamed reply changes both content measurements and the React render.
  await act(() => root.render(<Chat />));
  motion.onTailLayout("user-1", layout(580, 100));
  motion.onContentSizeChange(390, 680);
  motion.onContentInsetChange({ bottom: 120 });
  await flush();
  expect(motion.atLatest).toBe(true);
  expect(native.scrollTo).not.toHaveBeenCalled();

  // The user can open the keyboard again while the agent is replying.
  native.keyboard.onMove({ height: 300 });
  await flush();
  expect(motion.atLatest).toBe(false);
});
