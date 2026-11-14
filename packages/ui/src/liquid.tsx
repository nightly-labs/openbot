/**
 * Liquid shapes, as the agent dock and the voice conversation have them: shapes that flow out of an
 * edge of the window frame and back into it. The shapes are one liquid under an SVG "goo" filter, and
 * a small spring engine moves them.
 */

import { prefersReducedMotion } from "./utils";

/**
 * A liquid layer starts this far before the frame edge, so the goo joins a shape to the frame
 * that is drawn in this band.
 */
export const LIQUID_PAD = 40;

/**
 * Blurs the shapes under it and then cuts the blur at about half its alpha, so shapes that touch
 * flow into one. A shape that uses it sets `filter: url(#id)`.
 */
export function GooFilter(props: { id: string; class?: string }) {
  return (
    <svg class={props.class} aria-hidden="true" width="0" height="0">
      <filter id={props.id} x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
        <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="blur" />
        <feColorMatrix in="blur" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -11" />
      </filter>
    </svg>
  );
}

/* ---------- The open curve ---------- */

/**
 * The open progress at which a shape is clear of the frame. Before it, the shape slides out and swells;
 * after it, the shape grows to its full size.
 */
export const SLIDE_END = 0.42;

/**
 * A smooth curve through `start` at 0, `middle` at SLIDE_END and `end` at 1. It eases out of `start`,
 * keeps one speed through `middle` (no overshoot), and past 1 it continues in a straight line for the
 * spring's overshoot.
 */
export function stagedCurve(progress: number, start: number, middle: number, end: number) {
  const first = (middle - start) / SLIDE_END;
  const second = (end - middle) / (1 - SLIDE_END);
  const limit = Math.min(Math.abs(first), Math.abs(second)) * 3;
  const through = Math.sign(end - start) * Math.min(Math.abs(end - start), limit);
  const hermite = (t: number, from: number, to: number, slopeFrom: number, slopeTo: number, span: number) => {
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * from +
      (t3 - 2 * t2 + t) * span * slopeFrom +
      (-2 * t3 + 3 * t2) * to +
      (t3 - t2) * span * slopeTo
    );
  };
  if (progress <= SLIDE_END) return hermite(progress / SLIDE_END, start, middle, 0, through, SLIDE_END);
  if (progress <= 1)
    return hermite((progress - SLIDE_END) / (1 - SLIDE_END), middle, end, through, second, 1 - SLIDE_END);
  return end + second * (progress - 1);
}

/* ---------- A small spring engine ---------- */

export interface SpringConfig {
  stiffness: number;
  damping: number;
}

export const SOFT: SpringConfig = { stiffness: 170, damping: 19 };
export const SNAPPY: SpringConfig = { stiffness: 320, damping: 24 };
export const WOBBLY: SpringConfig = { stiffness: 210, damping: 13 };
/** A shape opens with a small overshoot and closes with none, so it does not snap into the frame. */
export const LIQUID_OPEN: SpringConfig = { stiffness: 190, damping: 19 };
export const LIQUID_CLOSE: SpringConfig = { stiffness: 280, damping: 33 };

export class Spring {
  velocity = 0;
  target: number;
  private onRest: (() => void) | null = null;

  constructor(
    public value: number,
    private config: SpringConfig,
  ) {
    this.target = value;
  }

  to(target: number, onRest?: () => void, config?: SpringConfig) {
    this.target = target;
    if (config) this.config = config;
    this.onRest = onRest ?? null;
    if (prefersReducedMotion()) this.jump(target);
  }

  jump(value: number) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
  }

  /** Advances by `dt` seconds. Returns true while the spring still moves. */
  step(dt: number): boolean {
    const force = -this.config.stiffness * (this.value - this.target) - this.config.damping * this.velocity;
    this.velocity += force * dt;
    this.value += this.velocity * dt;
    if (Math.abs(this.velocity) < 0.01 && Math.abs(this.value - this.target) < 0.005) {
      this.value = this.target;
      this.velocity = 0;
      const rest = this.onRest;
      this.onRest = null;
      rest?.();
      return false;
    }
    return true;
  }
}

/**
 * Steps every spring each frame and calls `render`, until all of them rest. `onActivity` is told when
 * the springs start to move and when all of them rest again.
 */
export function createMotion(render: () => void, onActivity?: (moving: boolean) => void) {
  const springs = new Set<Spring>();
  let frame = 0;
  let last = 0;
  const tick = (now: number) => {
    const dt = Math.min(1 / 30, (now - last) / 1000 || 1 / 60);
    last = now;
    let moving = false;
    // Small sub-steps keep stiff springs stable.
    for (const spring of springs) {
      let springMoving = false;
      for (let i = 0; i < 4; i++) springMoving = spring.step(dt / 4) || springMoving;
      moving = springMoving || moving;
    }
    render();
    frame = moving ? requestAnimationFrame(tick) : 0;
    if (!moving) onActivity?.(false);
  };
  return {
    spring(value: number, config: SpringConfig) {
      const spring = new Spring(value, config);
      springs.add(spring);
      return spring;
    },
    drop(spring: Spring) {
      springs.delete(spring);
    },
    kick() {
      if (frame) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
      onActivity?.(true);
    },
    stop() {
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
