export function clamp(value: number, min: number, max: number): number {
  "worklet";
  return Math.min(Math.max(value, min), max);
}

export function rubberBand(value: number, max: number, resistance: number): number {
  "worklet";
  if (value < 0) return value * resistance;
  if (value > max) return max + (value - max) * resistance;
  return value;
}
