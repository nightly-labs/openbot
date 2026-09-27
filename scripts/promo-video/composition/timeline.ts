// Time helpers for the promo video. Every frame is a pure function of `t`, in seconds, so the
// renderer can seek to any frame in any order and get the same picture.

export const DURATION = 18;
export const FPS = 60;
export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;
/** 120 BPM. The cuts, the words and the drums all land on this grid. */
export const BEAT = 0.5;

/** The length of `count` beats at `bpm`, in seconds. */
export function beats(count: number, bpm: number): number {
  return (count * 60) / bpm;
}

export function clamp(value: number, min = 0, max = 1): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

/** How far `t` is through the window that starts at `start` and lasts `duration`, from 0 to 1. */
export function progress(t: number, start: number, duration: number): number {
  return clamp((t - start) / duration);
}

export const ease = {
  linear: (x: number) => x,
  inCubic: (x: number) => x * x * x,
  outCubic: (x: number) => 1 - (1 - x) ** 3,
  inOutCubic: (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  inQuart: (x: number) => x ** 4,
  outQuart: (x: number) => 1 - (1 - x) ** 4,
  outQuint: (x: number) => 1 - (1 - x) ** 5,
  inExpo: (x: number) => (x <= 0 ? 0 : 2 ** (10 * x - 10)),
  outExpo: (x: number) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
  inOutExpo: (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2;
  },
  outBack: (x: number) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2,
  /** The logo's own curve, from packages/brand/src/logo.css. */
  logo: (x: number) => cubicBezier(0.77, 0, 0.175, 1, x),
};

/** A damped spring that starts at `start`, rises from 0 to 1, overshoots, and settles. */
export function spring(t: number, start: number, frequency = 2.4, damping = 0.42): number {
  const elapsed = t - start;
  if (elapsed <= 0) return 0;
  const omega = 2 * Math.PI * frequency;
  const damped = omega * Math.sqrt(1 - damping * damping);
  const decay = Math.exp(-damping * omega * elapsed);
  return 1 - decay * (Math.cos(damped * elapsed) + ((damping * omega) / damped) * Math.sin(damped * elapsed));
}

/** 1 at `at`, falling to 0 over `length` seconds; 0 outside that window. */
export function decay(t: number, at: number, length: number): number {
  if (t < at || t > at + length) return 0;
  return (1 - (t - at) / length) ** 3;
}

/** The sum of a short `decay` on every beat from `from` up to and including `to`. */
export function beatPulse(t: number, from: number, to: number, length = 0.14, beat = BEAT): number {
  if (t < from || t > to + length) return 0;
  const last = Math.min(to, from + Math.floor((t - from) / beat) * beat);
  return decay(t, last, length);
}

/** 0 before `at`, up to 1 at the middle of the window, and back to 0 at its end. For blinks. */
export function bump(t: number, at: number, length: number): number {
  const amount = progress(t, at, length);
  return amount <= 0 || amount >= 1 ? 0 : Math.sin(Math.PI * amount);
}

/**
 * Moves from key to key: at each key's time the value eases to the key's value over `length`.
 * The first key is the start value.
 */
export function keys(
  t: number,
  frames: readonly (readonly [time: number, value: number])[],
  length = 0.08,
  curve: (x: number) => number = ease.outCubic,
): number {
  let value = frames[0]?.[1] ?? 0;
  for (const [time, next] of frames.slice(1)) value = lerp(value, next, curve(progress(t, time, length)));
  return value;
}

/** Visible in [start, end), with `t` local to the window. */
export function within(t: number, start: number, end: number): boolean {
  return t >= start && t < end;
}

/** Seeded random numbers, so particles and grain look the same on every render. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise in [-1, 1]. The same seed and x always give the same value. */
export function noise(seed: number, x: number): number {
  const index = Math.floor(x);
  const fraction = x - index;
  const smooth = fraction * fraction * (3 - 2 * fraction);
  return lerp(hash(seed, index), hash(seed, index + 1), smooth) * 2 - 1;
}

function hash(seed: number, index: number): number {
  let value = Math.imul(index ^ (seed * 0x9e3779b1), 0x85ebca6b);
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  // Newton steps on the x curve, then read y. Five steps are exact to well under a pixel.
  let u = x;
  for (let step = 0; step < 5; step += 1) {
    const currentX = bezierAxis(x1, x2, u) - x;
    const slope = bezierSlope(x1, x2, u);
    if (Math.abs(slope) < 1e-6) break;
    u = clamp(u - currentX / slope);
  }
  return bezierAxis(y1, y2, u);
}

function bezierAxis(a: number, b: number, u: number): number {
  return 3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3;
}

function bezierSlope(a: number, b: number, u: number): number {
  return 3 * a * (1 - u) ** 2 + 6 * (b - a) * u * (1 - u) + 3 * (1 - b) * u * u;
}
