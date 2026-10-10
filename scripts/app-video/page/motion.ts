// Pure motion helpers. Every value is a function of time, so any frame renders the same way.

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

/** 0 before `from`, 1 after `to`, linear between. */
export function progress(t: number, from: number, to: number): number {
  return to <= from ? Number(t >= from) : clamp((t - from) / (to - from));
}

export const ease = {
  outCubic: (x: number) => 1 - (1 - x) ** 3,
  outQuint: (x: number) => 1 - (1 - x) ** 5,
  outExpo: (x: number) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
  inCubic: (x: number) => x ** 3,
  inOutCubic: (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
  inOutQuint: (x: number) => (x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2),
};

/**
 * A damped spring from 0 to 1, `elapsed` seconds after it starts. `frequency` is in hertz; a
 * `damping` under 1 overshoots.
 */
export function spring(elapsed: number, frequency = 2.2, damping = 0.62): number {
  if (elapsed <= 0) return 0;
  const omega = 2 * Math.PI * frequency;
  const decay = Math.exp(-damping * omega * elapsed);
  if (damping >= 1) return 1 - decay * (1 + omega * elapsed);
  const damped = omega * Math.sqrt(1 - damping * damping);
  return 1 - decay * (Math.cos(damped * elapsed) + ((damping * omega) / damped) * Math.sin(damped * elapsed));
}

/** A keyframed value: holds before the first key and after the last, and eases between keys. */
export function keyframes<T>(
  t: number,
  keys: readonly { t: number; value: T }[],
  blend: (from: T, to: T, amount: number) => T,
  curve: (x: number) => number = ease.inOutCubic,
): T {
  const first = keys[0];
  if (!first) throw new Error("A keyframe track needs at least one key.");
  if (t <= first.t) return first.value;
  for (let index = 1; index < keys.length; index += 1) {
    const from = keys[index - 1];
    const to = keys[index];
    if (from && to && t < to.t) return blend(from.value, to.value, curve(progress(t, from.t, to.t)));
  }
  return (keys[keys.length - 1] ?? first).value;
}
