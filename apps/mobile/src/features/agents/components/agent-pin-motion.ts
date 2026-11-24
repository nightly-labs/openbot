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

type PinChange = "pin" | "unpin";

const movingChat = makeMutable<{ chatId: string; change: PinChange } | null>(null);
const MOTION_WINDOW_MS = 600;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const SLIDE = { duration: 240, easing: EASE_OUT, reduceMotion: ReduceMotion.System };
const POP_SPRING = { damping: 14, stiffness: 260, mass: 0.9, reduceMotion: ReduceMotion.System };
let clearTimer: ReturnType<typeof setTimeout> | null = null;

export function markPinMotion(chatId: string, change: PinChange): void {
  if (clearTimer) clearTimeout(clearTimer);
  movingChat.set({ chatId, change });
  clearTimer = setTimeout(clearPinMotion, MOTION_WINDOW_MS);
}

export function clearPinMotion(): void {
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = null;
  movingChat.set(null);
}

function isMoving(chatId: string, change: PinChange): boolean {
  "worklet";
  const moving = movingChat.get();
  return moving !== null && moving.chatId === chatId && moving.change === change;
}

function unchanged(): LayoutAnimation {
  "worklet";
  return { initialValues: { opacity: 1 }, animations: { opacity: withTiming(1, { duration: 0 }) } };
}

export function pinnedTileEntering(chatId: string) {
  return (): LayoutAnimation => {
    "worklet";
    if (isMoving(chatId, "pin")) {
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
    const scaleTo = isMoving(chatId, "unpin") ? 0.6 : 1;
    const timing = { duration: scaleTo < 1 ? 160 : 140, easing: EASE_OUT, reduceMotion: ReduceMotion.System };
    return {
      initialValues: { opacity: 1, transform: [{ scale: 1 }] },
      animations: { opacity: withTiming(0, timing), transform: [{ scale: withTiming(scaleTo, timing) }] },
    };
  };
}

export function chatRowEntering(chatId: string) {
  return (): LayoutAnimation => {
    "worklet";
    if (!isMoving(chatId, "unpin")) return unchanged();
    return {
      initialValues: { opacity: 0, transform: [{ translateX: 40 * END_X }] },
      animations: { opacity: withTiming(1, SLIDE), transform: [{ translateX: withTiming(0, SLIDE) }] },
    };
  };
}

export function chatRowExiting(chatId: string) {
  return (values: ExitAnimationsValues): LayoutAnimation => {
    "worklet";
    if (!isMoving(chatId, "pin")) {
      return { initialValues: { opacity: 1 }, animations: { opacity: withTiming(0, { duration: 0 }) } };
    }
    const timing = { duration: 220, easing: EASE_OUT, reduceMotion: ReduceMotion.System };
    return {
      initialValues: { opacity: 1, transform: [{ translateX: 0 }] },
      animations: {
        opacity: withTiming(0, timing),
        transform: [{ translateX: withTiming(values.currentWidth * 0.6 * END_X, timing) }],
      },
    };
  };
}
