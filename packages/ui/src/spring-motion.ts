/** A SwiftUI-style spring: `response` is the period in seconds, `dampingFraction` is from 0 to 1. */
export interface Spring {
  response: number;
  dampingFraction: number;
}

/** The progress of a spring from 0 to 1 at `time` seconds. A damping fraction of 1 does not overshoot. */
export function springProgress(time: number, spring: Spring): number {
  const angularFrequency = (2 * Math.PI) / spring.response;
  const damping = spring.dampingFraction;
  if (damping === 1) {
    const phase = angularFrequency * time;
    return 1 - Math.exp(-phase) * (1 + phase);
  }

  const dampedFrequency = angularFrequency * Math.sqrt(1 - damping * damping);
  const envelope = Math.exp(-damping * angularFrequency * time);
  const phase = dampedFrequency * time;
  return 1 - envelope * (Math.cos(phase) + (damping * Math.sin(phase)) / Math.sqrt(1 - damping * damping));
}

/**
 * Samples one `response` of the spring into keyframes for a linear animation of that duration.
 * The progress is scaled so that the last sample is exactly 1.
 */
export function springKeyframes(spring: Spring, frame: (progress: number) => Keyframe, sampleCount = 32): Keyframe[] {
  const finalProgress = springProgress(spring.response, spring);
  return Array.from({ length: sampleCount + 1 }, (_, index) => {
    const offset = index / sampleCount;
    const rawProgress = springProgress(offset * spring.response, spring);
    const progress = index === sampleCount ? 1 : rawProgress / finalProgress;
    return { ...frame(progress), offset };
  });
}

/** The x scale of a computed `transform`: `none` or `matrix(...)`. Other values give 1. */
export function computedScale(transform: string): number {
  if (!transform || transform === "none") return 1;
  const match = transform.match(/^matrix\(([^,]+)/);
  const scale = Number.parseFloat(match?.[1] ?? "");
  return Number.isFinite(scale) ? scale : 1;
}

/** The radius in pixels of the `blur()` in a computed `filter`, or 0 when it has none. */
export function computedBlur(filter: string): number {
  if (!filter || filter === "none") return 0;
  const match = filter.match(/blur\(([-\d.]+)px\)/);
  const blur = Number.parseFloat(match?.[1] ?? "");
  return Number.isFinite(blur) ? blur : 0;
}
