import { cubicBezier, ReduceMotion, withDelay, withSpring, withTiming } from "react-native-reanimated";

import { useMotionPreferences } from "@/features/settings/model/motion";
import { useReducedMotion } from "@/shared/lib/motion";
import { SPLASH_EASE_OUT } from "@/shared/lib/splash-motion";

export type OnboardingMotion = "full" | "fade" | "none";

export const EASE_OUT_CSS = cubicBezier(0.23, 1, 0.32, 1);

export function useOnboardingMotion(): OnboardingMotion {
  const reduced = useReducedMotion();
  const animations = useMotionPreferences((state) => state.allAnimations);
  if (!animations) return "none";
  return reduced ? "fade" : "full";
}

const STEP_SHIFT = 28;
const STEP_ENTER_MS = 300;
const STEP_EXIT_MS = 160;
export const STAGGER_MS = 50;
const POP_MS = 240;

export function glassAfter(entranceDelay: number): number {
  return Math.max(STEP_ENTER_MS + 20, entranceDelay);
}

function slideInEntering(motion: OnboardingMotion, offset: number, duration: number, delay: number) {
  if (motion === "none") return undefined;
  const shift = motion === "full" ? offset : 0;
  return () => {
    "worklet";
    const timing = { duration, easing: SPLASH_EASE_OUT, reduceMotion: ReduceMotion.Never };
    return {
      initialValues: { opacity: 0, transform: [{ translateX: shift }] },
      animations: {
        opacity: withDelay(delay, withTiming(1, timing), ReduceMotion.Never),
        transform: [{ translateX: withDelay(delay, withTiming(0, timing), ReduceMotion.Never) }],
      },
    };
  };
}

export function stepEntering(motion: OnboardingMotion, direction: 1 | -1, delay = 0) {
  return slideInEntering(motion, STEP_SHIFT * direction, STEP_ENTER_MS, delay);
}

export function stepExiting(motion: OnboardingMotion, direction: 1 | -1) {
  if (motion === "none") return undefined;
  const shift = motion === "full" ? -STEP_SHIFT * 0.6 * direction : 0;
  return () => {
    "worklet";
    const timing = { duration: STEP_EXIT_MS, easing: SPLASH_EASE_OUT, reduceMotion: ReduceMotion.Never };
    return {
      initialValues: { opacity: 1, transform: [{ translateX: 0 }] },
      animations: {
        opacity: withTiming(0, timing),
        transform: [{ translateX: withTiming(shift, timing) }],
      },
    };
  };
}

export function popEntering(motion: OnboardingMotion, delay = 0) {
  if (motion === "none") return undefined;
  const full = motion === "full";
  return () => {
    "worklet";
    const timing = { duration: POP_MS, easing: SPLASH_EASE_OUT, reduceMotion: ReduceMotion.Never };
    return {
      initialValues: { opacity: 0, transform: [{ translateY: full ? 8 : 0 }, { scale: full ? 0.95 : 1 }] },
      animations: {
        opacity: withDelay(delay, withTiming(1, timing), ReduceMotion.Never),
        transform: [
          { translateY: withDelay(delay, withTiming(0, timing), ReduceMotion.Never) },
          { scale: withDelay(delay, withTiming(1, timing), ReduceMotion.Never) },
        ],
      },
    };
  };
}

export function swapEntering(motion: OnboardingMotion) {
  if (motion === "none") return undefined;
  return () => {
    "worklet";
    return {
      initialValues: { opacity: 0 },
      animations: {
        opacity: withDelay(
          100,
          withTiming(1, { duration: 180, easing: SPLASH_EASE_OUT, reduceMotion: ReduceMotion.Never }),
          ReduceMotion.Never,
        ),
      },
    };
  };
}

export function swapExiting(motion: OnboardingMotion) {
  if (motion === "none") return undefined;
  return () => {
    "worklet";
    return {
      initialValues: { opacity: 1 },
      animations: {
        opacity: withTiming(0, { duration: 120, easing: SPLASH_EASE_OUT, reduceMotion: ReduceMotion.Never }),
      },
    };
  };
}

export function growEntering(motion: OnboardingMotion) {
  if (motion !== "full") return undefined;
  return () => {
    "worklet";
    return {
      initialValues: { transform: [{ scale: 0.8 }] },
      animations: {
        transform: [
          { scale: withTiming(1, { duration: 220, easing: SPLASH_EASE_OUT, reduceMotion: ReduceMotion.Never }) },
        ],
      },
    };
  };
}

export function arriveEntering(motion: OnboardingMotion, fromX: number, delay: number) {
  if (motion === "none") return undefined;
  const full = motion === "full";
  return () => {
    "worklet";
    const spring = { duration: 560, dampingRatio: 0.78, reduceMotion: ReduceMotion.Never };
    return {
      initialValues: { opacity: 0, transform: [{ translateX: full ? fromX : 0 }, { scale: full ? 0.7 : 1 }] },
      animations: {
        opacity: withDelay(
          delay,
          withTiming(1, { duration: 220, easing: SPLASH_EASE_OUT, reduceMotion: ReduceMotion.Never }),
          ReduceMotion.Never,
        ),
        transform: [
          { translateX: withDelay(delay, withSpring(0, spring), ReduceMotion.Never) },
          { scale: withDelay(delay, withSpring(1, spring), ReduceMotion.Never) },
        ],
      },
    };
  };
}

export function handOffEntering(motion: OnboardingMotion, landsAt: number) {
  if (motion !== "full") return arriveEntering(motion, 0, 40);
  return () => {
    "worklet";
    const instant = { duration: 0, reduceMotion: ReduceMotion.Never };
    return {
      initialValues: { opacity: 0 },
      animations: { opacity: withDelay(landsAt, withTiming(1, instant), ReduceMotion.Never) },
    };
  };
}

export function slideSwapEntering(motion: OnboardingMotion, direction: 1 | -1, delay = 0) {
  return slideInEntering(motion, 24 * direction, 280, delay);
}

export function slideSwapExiting(motion: OnboardingMotion) {
  if (motion === "none") return undefined;
  const full = motion === "full";
  return () => {
    "worklet";
    const timing = { duration: 150, easing: SPLASH_EASE_OUT, reduceMotion: ReduceMotion.Never };
    return {
      initialValues: { opacity: 1, transform: [{ scale: 1 }] },
      animations: {
        opacity: withTiming(0, timing),
        transform: [{ scale: withTiming(full ? 0.96 : 1, timing) }],
      },
    };
  };
}
