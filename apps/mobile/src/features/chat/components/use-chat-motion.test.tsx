import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import type { LayoutChangeEvent } from "react-native";
import { afterEach, expect, it, vi } from "vitest";
import { type ChatMotion, useChatMotion } from "./use-chat-motion";

const native = vi.hoisted(() => {
  const keyboard: Record<string, (event: { height: number; progress: number; duration?: number }) => void> = {};
  const reactions: (() => void)[] = [];
  return {
    hidden: () => {},
    keyboard,
    reactions,
    frames: new Map<number, FrameRequestCallback>(),
    nextFrame: 0,
    scrollTo: vi.fn(),
  };
});

vi.mock("react-native", () => ({
  Keyboard: {
    addListener: (_event: string, callback: () => void) => {
      native.hidden = callback;
      return { remove: () => {} };
    },
  },
}));

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
    Easing: { cubic: (value: number) => value, out: <T,>(value: T) => value },
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
  function Chat({ requiredInputId = null }: { requiredInputId?: string | null }) {
    const current = useChatMotion(100, 24, true, "user-1", requiredInputId);
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

  native.keyboard.onStart({ height: 300, progress: 1 });
  native.keyboard.onMove({ height: 300, progress: 1 });
  native.keyboard.onEnd({ height: 300, progress: 1 });
  await flush();
  expect(motion.atLatest).toBe(false);

  native.keyboard.onInteractive({ height: 150, progress: 0.5 });
  // Dismissal can finish without an onMove frame at height zero.
  native.keyboard.onEnd({ height: 0, progress: 0 });
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
  native.keyboard.onStart({ height: 300, progress: 1 });
  native.keyboard.onMove({ height: 300, progress: 1 });
  await flush();
  expect(motion.atLatest).toBe(false);

  // Native dismissal can arrive without any controller completion frame.
  native.hidden();
  // A queued frame from the dismissed keyboard must not lift the composer again.
  native.keyboard.onMove({ height: 300, progress: 1 });
  native.keyboard.onEnd({ height: 300, progress: 1 });
  expect(motion.keyboardHeight.get()).toBe(0);
  expect(motion.keyboardProgress.get()).toBe(0);
  await act(() => root.render(<Chat />));
  await flush();
  expect(motion.atLatest).toBe(true);
  expect(native.scrollTo).not.toHaveBeenCalled();

  native.keyboard.onStart({ height: 300, progress: 1 });
  native.keyboard.onMove({ height: 300, progress: 1 });
  expect(motion.keyboardHeight.get()).toBe(300);
  // A dismissal start must settle the composer even if scrolling interrupts
  // delivery of the controller's final move/end and RN's did-hide notification.
  native.keyboard.onStart({ height: 0, progress: 0, duration: 250 });
  native.keyboard.onInteractive({ height: 280, progress: 0.93 });
  native.keyboard.onMove({ height: 300, progress: 1 });
  expect(motion.keyboardHeight.get()).toBe(0);
  expect(motion.keyboardProgress.get()).toBe(0);
  native.keyboard.onEnd({ height: 300, progress: 0 });
  expect(motion.keyboardHeight.get()).toBe(0);
  await flush();
  expect(motion.atLatest).toBe(true);

  // Sending, dragging, then dismissing the keyboard must preserve manual control,
  // even if the larger viewport makes the current reply visible again.
  native.keyboard.onStart({ height: 300, progress: 1 });
  native.keyboard.onMove({ height: 300, progress: 1 });
  await act(() => {
    motion?.beginSend();
    motion?.onScrollBeginDrag();
  });
  expect(motion.needsSendPosition()).toBe(false);
  native.hidden();
  await flush();
  await act(() => root.render(<Chat requiredInputId="prompt-after-drag" />));
  motion.onContentSizeChange(390, 690);
  await flush();
  expect(native.scrollTo).not.toHaveBeenCalled();

  // Finishing a user scroll at the reply enables following again.
  await act(() => motion?.onScrollEndDrag({ nativeEvent: { contentOffset: { x: 0, y: 0 } } }));
  await act(() => root.render(<Chat requiredInputId="prompt-after-return" />));
  motion.onContentSizeChange(390, 695);
  await flush();
  expect(native.scrollTo).toHaveBeenCalledTimes(1);
});

it("reveals a virtualized history and does not jump to the end when older messages load", async () => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++native.nextFrame;
    native.frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => native.frames.delete(id));
  let motion: ChatMotion | undefined;
  function Chat() {
    const current = useChatMotion(100, 0, true, "user");
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
    });
  }
  await act(() => root.render(<Chat />));
  if (!motion) throw new Error("Chat motion is not mounted");
  motion.onViewportLayout(layout(800));
  motion.onComposerLayout(layout(80));
  motion.onTailStartLayout("user", layout(100, 600));
  motion.onContentSizeChange(390, 1000);
  motion.onContentInsetChange({ bottom: 400 });
  await flush();
  expect(motion.historyVisible).toBe(true);
  native.scrollTo.mockClear();

  motion.onTailStartLayout("user", layout(100, 2600));
  motion.onContentSizeChange(390, 3000);
  await flush();
  expect(native.scrollTo).not.toHaveBeenCalled();
  await act(() => motion?.scrollToLatest());
  expect(native.scrollTo).toHaveBeenLastCalledWith({ y: 2600, animated: false });
});

it("follows required input after layout but preserves a manual history position", async () => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++native.nextFrame;
    native.frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => native.frames.delete(id));
  let motion: ChatMotion | undefined;
  function Chat({ requiredInputId }: { requiredInputId: string | null }) {
    const current = useChatMotion(100, 0, true, "user", requiredInputId);
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

  await act(() => root.render(<Chat requiredInputId={null} />));
  if (!motion) throw new Error("Chat motion is not mounted");
  motion.onViewportLayout(layout(800));
  motion.onComposerLayout(layout(80));
  motion.onTailStartLayout("user", layout(100, 2_600));
  motion.onContentSizeChange(390, 3_000);
  motion.onContentInsetChange({ bottom: 400 });
  await flush();
  native.scrollTo.mockClear();

  await act(() => root.render(<Chat requiredInputId="prompt-1" />));
  await flush();
  expect(native.scrollTo).not.toHaveBeenCalled();
  motion.onContentSizeChange(390, 3_400);
  await flush();
  expect(native.scrollTo).toHaveBeenLastCalledWith({ y: 3_000, animated: false });

  native.scrollTo.mockClear();
  await act(() => motion?.onScrollBeginDrag());
  expect(motion.keyboardLiftBehavior).toBe("never");
  await act(() => root.render(<Chat requiredInputId="prompt-2" />));
  motion.onContentSizeChange(390, 3_800);
  await flush();
  expect(native.scrollTo).not.toHaveBeenCalled();

  await act(() => motion?.scrollToLatest());
  expect(motion.keyboardLiftBehavior).toBe("whenAtEnd");
  native.scrollTo.mockClear();
  await act(() => root.render(<Chat requiredInputId="prompt-3" />));
  await act(() => motion?.onScrollBeginDrag());
  motion.onContentSizeChange(390, 4_200);
  await flush();
  expect(native.scrollTo).not.toHaveBeenCalled();
});

it("cancels first-send positioning when the user drags before layout commits", async () => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++native.nextFrame;
    native.frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => native.frames.delete(id));
  let motion: ChatMotion | undefined;
  function Chat({ lastUserId }: { lastUserId: string | null }) {
    const current = useChatMotion(100, 0, true, lastUserId);
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
    });
  }

  await act(() => root.render(<Chat lastUserId={null} />));
  if (!motion) throw new Error("Chat motion is not mounted");
  motion.onViewportLayout(layout(800));
  motion.onComposerLayout(layout(80));
  await act(() => motion?.beginSend());
  await act(() => root.render(<Chat lastUserId="first-message" />));
  motion.onTailStartLayout("first-message", layout(100, 100));
  motion.onContentSizeChange(390, 300);
  motion.onContentInsetChange({ bottom: 500 });
  native.scrollTo.mockClear();

  await act(() => {
    motion?.onScrollBeginDrag();
    // Native size callbacks can run before React commits historyVisible.
    expect(motion?.needsInitialPosition()).toBe(false);
    expect(motion?.needsSendPosition()).toBe(false);
  });
  await flush();
  // The next content commit must not fall back to the initial-history scroll.
  motion.onContentSizeChange(390, 350);
  await flush();
  expect(native.scrollTo).not.toHaveBeenCalled();
  expect(motion.historyVisible).toBe(true);
  expect(motion.responseVisible).toBe(true);
  expect(motion.keyboardLiftBehavior).toBe("never");

  await act(() => motion?.scrollToLatest());
  expect(native.scrollTo).toHaveBeenCalledTimes(1);
  expect(motion.keyboardLiftBehavior).toBe("whenAtEnd");
});
