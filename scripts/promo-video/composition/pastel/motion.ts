// The pastel video's motion: things pop in on a spring that squashes and stretches with its speed,
// hop on the beat, and pop out with a small lift first. All of it is a pure function of `t`.

import { clamp, ease, progress, spring } from "../timeline";

export interface Pose {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotate: number;
  opacity: number;
}

/** A sample step for the spring's speed. Short enough to be exact, long enough to be stable. */
const STEP = 1 / 240;

/**
 * Scale for a pop in at `start`: 0 to 1 with an overshoot. While the spring moves fast the shape
 * stretches along the motion and gets thin, and on the rebound it squashes.
 */
export function pop(t: number, start: number, frequency = 2.6, damping = 0.38): { scaleX: number; scaleY: number } {
  const value = spring(t, start, frequency, damping);
  const speed = (value - spring(t - STEP, start, frequency, damping)) / STEP;
  const stretch = clamp(speed * 0.045, -0.22, 0.22);
  return { scaleX: value * (1 - stretch * 0.7), scaleY: value * (1 + stretch) };
}

/** Scale for a pop out at `start`: a small lift, then down to 0. 1 before `start`. */
export function popOut(t: number, start: number, length = 0.3): number {
  const amount = progress(t, start, length);
  if (amount <= 0) return 1;
  if (amount < 0.3) return 1 + 0.12 * ease.outCubic(amount / 0.3);
  return 1.12 * (1 - ease.inCubic((amount - 0.3) / 0.7));
}

/**
 * A hop that starts at `at` and lasts `length`: up by `height`, with a squash on take-off and on
 * landing. Returns the lift and the scales to multiply in.
 */
export function hop(
  t: number,
  at: number,
  length: number,
  height: number,
): { lift: number; scaleX: number; scaleY: number } {
  const amount = progress(t, at, length);
  if (amount <= 0 || amount >= 1) {
    const landed = t - (at + length);
    // A short wobble after the landing.
    const wobble = landed > 0 && landed < 0.25 ? -0.08 * Math.exp(-landed * 14) * Math.cos(landed * 40) : 0;
    return { lift: 0, scaleX: 1 - wobble, scaleY: 1 + wobble };
  }
  const lift = height * Math.sin(Math.PI * amount);
  // Stretched in the air while it rises or falls fast; round at the top.
  const stretch = 0.1 * Math.abs(Math.cos(Math.PI * amount));
  return { lift, scaleX: 1 - stretch * 0.6, scaleY: 1 + stretch };
}

/** Places an element by its center, with a separate x and y scale. */
export function placePose(element: HTMLElement | SVGElement, pose: Pose, origin = "50% 50%") {
  element.style.transformOrigin = origin;
  element.style.transform = `translate(${pose.x}px, ${pose.y}px) translate(-50%, -50%) rotate(${pose.rotate}deg) scale(${pose.scaleX}, ${pose.scaleY})`;
  element.style.opacity = String(pose.opacity);
}

/** A slow float for things at rest, so that no frame is ever still. */
export function float(t: number, seed: number, amount = 8): { x: number; y: number; rotate: number } {
  return {
    x: amount * 0.6 * Math.sin(t * 1.1 + seed * 1.7),
    y: amount * Math.sin(t * 1.6 + seed * 2.3),
    rotate: 1.2 * Math.sin(t * 0.9 + seed),
  };
}
