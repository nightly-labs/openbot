import { useCallback, useSyncExternalStore } from "react";
import {
  Easing,
  type ExitAnimationsValues,
  type LayoutAnimation,
  makeMutable,
  ReduceMotion,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { END_X } from "@/shared/lib/text-direction";

export type PinChange = "pin" | "unpin";

const MOTION_WINDOW_MS = 600;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const SLIDE = { duration: 240, easing: EASE_OUT, reduceMotion: ReduceMotion.System };
const SLIDE_OUT = { duration: 220, easing: EASE_OUT, reduceMotion: ReduceMotion.System };
const POP_SPRING = { damping: 14, stiffness: 260, mass: 0.9, reduceMotion: ReduceMotion.System };

const motions = new Map<string, PinChange>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
const movingOnUi = makeMutable<Record<string, PinChange>>({});

function publish(): void {
  movingOnUi.set(Object.fromEntries(motions));
  for (const listener of listeners) listener();
}

export function isPinMotionRunning(chatId: string): boolean {
  return motions.has(chatId);
}

export function markPinMotion(chatId: string, change: PinChange): void {
  const timer = timers.get(chatId);
  if (timer) clearTimeout(timer);
  motions.set(chatId, change);
  timers.set(
    chatId,
    setTimeout(() => clearPinMotion(chatId), MOTION_WINDOW_MS),
  );
  publish();
}

export function clearPinMotion(chatId: string): void {
  const timer = timers.get(chatId);
  if (timer) clearTimeout(timer);
  timers.delete(chatId);
  if (motions.delete(chatId)) publish();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePinMotion(chatId: string): PinChange | null {
  const read = useCallback(() => motions.get(chatId) ?? null, [chatId]);
  return useSyncExternalStore(subscribe, read);
}

export function pinnedTileEntering(chatId: string) {
  return (): LayoutAnimation => {
    "worklet";
    if (movingOnUi.get()[chatId] === "pin") {
      return {
        initialValues: { opacity: 0, transform: [{ scale: 0.5 }] },
        animations: {
          opacity: withTiming(1, { duration: 120, reduceMotion: ReduceMotion.System }),
          transform: [{ scale: withSpring(1, POP_SPRING) }],
        },
      };
    }
    return {
      initialValues: { opacity: 0 },
      animations: { opacity: withTiming(1, { duration: 180, easing: EASE_OUT, reduceMotion: ReduceMotion.System }) },
    };
  };
}

export function pinnedTileExiting(chatId: string) {
  return (): LayoutAnimation => {
    "worklet";
    const scaleTo = movingOnUi.get()[chatId] === "unpin" ? 0.6 : 1;
    const timing = { duration: scaleTo < 1 ? 160 : 140, easing: EASE_OUT, reduceMotion: ReduceMotion.System };
    return {
      initialValues: { opacity: 1, transform: [{ scale: 1 }] },
      animations: { opacity: withTiming(0, timing), transform: [{ scale: withTiming(scaleTo, timing) }] },
    };
  };
}

export function chatRowSlideIn(): LayoutAnimation {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ translateX: 40 * END_X }] },
    animations: { opacity: withTiming(1, SLIDE), transform: [{ translateX: withTiming(0, SLIDE) }] },
  };
}

export function chatRowSlideOut(values: ExitAnimationsValues): LayoutAnimation {
  "worklet";
  return {
    initialValues: { opacity: 1, transform: [{ translateX: 0 }] },
    animations: {
      opacity: withTiming(0, SLIDE_OUT),
      transform: [{ translateX: withTiming(values.currentWidth * 0.6 * END_X, SLIDE_OUT) }],
    },
  };
}
