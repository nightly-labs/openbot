import { cubicBezier, ReduceMotion, withDelay, withSpring, withTiming } from "react-native-reanimated";

import { useMotionPreferences } from "@/features/settings/model/motion";
import { useReducedMotion } from "@/shared/lib/motion";
import { SPLASH_EASE_OUT } from "@/shared/lib/splash-motion";

/**
 * How the first-run flow moves. Reduce Motion keeps the fades, which carry the change of step, and
 * drops movement. Settings → Animations off removes both.
 */
export type OnboardingMotion = "full" | "fade" | "none";

/** The strong ease-out of `SPLASH_EASE_OUT`, for Reanimated CSS animations, which take `cubicBezier`. */
export const EASE_OUT_CSS = cubicBezier(0.23, 1, 0.32, 1);

export function useOnboardingMotion(): OnboardingMotion {
  const reduced = useReducedMotion();
  const animations = useMotionPreferences((state) => state.allAnimations);
  if (!animations) return "none";
  return reduced ? "fade" : "full";
}

// A step comes in from the side it is on: forward from the right, back from the left. The step
// that leaves is quicker than the step that arrives, so the two never fight for attention.
const STEP_SHIFT = 28;
const STEP_ENTER_MS = 300;
const STEP_EXIT_MS = 160;
// Parts of a step arrive one after another.
export const STAGGER_MS = 50;
// A small thing pops in over this time, after its delay.
const POP_MS = 240;

/**
 * When a glass surface appears. Glass does not draw under a parent with no opacity, and a step
 * fades in, so a glass surface never fades itself: it waits until its step is in and its own turn
 * comes, then its glass forms and its content fades in together (see `useGlassEntrance`).
 */
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

/** The exit of a step: it moves a little towards the side it goes to. */
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

/** A small thing that pops in: a chip, a row, a bubble. It never starts from nothing. */
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

/**
 * A label or a line of text that changes in place: the old one fades out, and the new one fades
 * in as the old one is nearly gone, so two never show at full strength together. No movement.
 */
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

/**
 * A glass control that appears in place. It grows from a little smaller and does not fade: glass
 * does not draw under a parent with no opacity.
 */
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

/**
 * A character that comes onto a stage from the side: it flies in from `fromX`, grows to its size
 * and settles with a little overshoot, as a body with weight does.
 */
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

/**
 * The character that the hero hands over to: hidden while the hero flies onto it, then there at
 * once, under the hero, which fades off it. With Reduce Motion the hero does not fly; it fades in.
 */
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

/**
 * A text that changes with a swipe: the new one slides in from the side the user swipes towards
 * and fades in. `direction` is 1 when the next choice is to the right. Reduce Motion fades only.
 */
export function slideSwapEntering(motion: OnboardingMotion, direction: 1 | -1, delay = 0) {
  return slideInEntering(motion, 24 * direction, 280, delay);
}

/** The old text of a swipe leaves quicker than the new one comes, shrinking a little as it fades. */
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
