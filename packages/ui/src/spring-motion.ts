export interface Spring {
  response: number;
  dampingFraction: number;
}

export const ISLAND_OPEN: Spring = { response: 0.5, dampingFraction: 0.8 };
export const ISLAND_CLOSE: Spring = { response: 0.45, dampingFraction: 1 };
export const ISLAND_CONTENT: Spring = { response: 0.34, dampingFraction: 0.88 };

export const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

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

export function springKeyframes(spring: Spring, frame: (progress: number) => Keyframe, sampleCount = 32): Keyframe[] {
  const finalProgress = springProgress(spring.response, spring);
  return Array.from({ length: sampleCount + 1 }, (_, index) => {
    const offset = index / sampleCount;
    const rawProgress = springProgress(offset * spring.response, spring);
    const progress = index === sampleCount ? 1 : rawProgress / finalProgress;
    return { ...frame(progress), offset };
  });
}

export function computedScale(transform: string): number {
  if (!transform || transform === "none") return 1;
  const match = transform.match(/^matrix\(([^,]+)/);
  const scale = Number.parseFloat(match?.[1] ?? "");
  return Number.isFinite(scale) ? scale : 1;
}

export function computedBlur(filter: string): number {
  if (!filter || filter === "none") return 0;
  const match = filter.match(/blur\(([-\d.]+)px\)/);
  const blur = Number.parseFloat(match?.[1] ?? "");
  return Number.isFinite(blur) ? blur : 0;
}
