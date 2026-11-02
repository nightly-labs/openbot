/**
 * The motion of the canvas camera. A zoom step keeps the centre of the view still. A longer move
 * zooms out, pans and zooms in again on the shortest path (van Wijk and Nuij, as `interpolateZoom`
 * of d3 that Higgsfield uses), so the eye keeps its place. The durations and the curves come from
 * the motion tokens.
 */

import { rendererDuration } from "../conversation/activity-timing";

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

/** A step of the zoom: the centre of the view stays still. A flight: the shortest zoom-and-pan path. */
export type CameraMotion = "step" | "flight";

const RHO = Math.SQRT2;

/** The camera at a point of the move, from 0 to 1, for a view of this size. */
function cameraPath(from: Camera, to: Camera, view: { width: number; height: number }) {
  // The path works on the centre of the view in the world and the width of the view in the world.
  const x0 = (view.width / 2 - from.x) / from.scale;
  const y0 = (view.height / 2 - from.y) / from.scale;
  const w0 = view.width / from.scale;
  const x1 = (view.width / 2 - to.x) / to.scale;
  const y1 = (view.height / 2 - to.y) / to.scale;
  const w1 = view.width / to.scale;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d2 = dx * dx + dy * dy;
  const camera = (x: number, y: number, w: number): Camera => {
    const scale = view.width / w;
    return { scale, x: view.width / 2 - x * scale, y: view.height / 2 - y * scale };
  };
  if (d2 < 1e-6) {
    const span = Math.log(w1 / w0);
    return (t: number) => (t >= 1 ? to : camera(x0 + t * dx, y0 + t * dy, w0 * Math.exp(t * span)));
  }
  const d1 = Math.sqrt(d2);
  const b0 = (w1 * w1 - w0 * w0 + RHO ** 4 * d2) / (2 * w0 * RHO ** 2 * d1);
  const b1 = (w1 * w1 - w0 * w0 - RHO ** 4 * d2) / (2 * w1 * RHO ** 2 * d1);
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
  const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const span = r1 - r0;
  return (t: number) => {
    if (t >= 1) return to;
    const r = r0 + t * span;
    const u = (w0 / (RHO ** 2 * d1)) * (Math.cosh(r0) * Math.tanh(r) - Math.sinh(r0));
    return camera(x0 + u * dx, y0 + u * dy, (w0 * Math.cosh(r0)) / Math.cosh(r));
  };
}

/** The curve of a `cubic-bezier()` token, as a function of time from 0 to 1. */
function curve(token: string): (t: number) => number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token);
  const points = /cubic-bezier\(([^)]+)\)/.exec(value)?.[1]?.split(",").map(Number);
  const [x1 = 0, y1 = 0, x2 = 1, y2 = 1] = points?.length === 4 && points.every(Number.isFinite) ? points : [];
  const at = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  return (t: number) => {
    if (t <= 0 || t >= 1) return Math.min(Math.max(t, 0), 1);
    // The curve is monotonic in x, so halving finds the point for this time.
    let low = 0;
    let high = 1;
    for (let step = 0; step < 24; step += 1) {
      const mid = (low + high) / 2;
      if (at(x1, x2, mid) < t) low = mid;
      else high = mid;
    }
    return at(y1, y2, (low + high) / 2);
  };
}

/**
 * Moves the camera from one place to another over some frames, and returns a function that stops
 * it. Each frame goes to `apply`. With reduced motion, the camera goes to its place at once.
 */
export function glideCamera(
  from: Camera,
  to: Camera,
  motion: CameraMotion,
  view: { width: number; height: number },
  apply: (camera: Camera, done: boolean) => void,
): () => void {
  const duration =
    motion === "step"
      ? rendererDuration("--openbot-duration-slow", 200)
      : rendererDuration("--openbot-duration-overlay", 240);
  if (duration === 0 || view.width === 0) {
    apply(to, true);
    return () => {};
  }
  // A step starts fast, so quick presses chain into one zoom. A flight starts and ends soft.
  const ease = curve(motion === "step" ? "--openbot-ease-out" : "--openbot-ease-in-out");
  const path = cameraPath(from, to, view);
  const start = performance.now();
  let frame = 0;
  const tick = (now: number) => {
    const t = Math.min((now - start) / duration, 1);
    apply(path(ease(t)), t >= 1);
    frame = t < 1 ? requestAnimationFrame(tick) : 0;
  };
  frame = requestAnimationFrame(tick);
  return () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };
}
