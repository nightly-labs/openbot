import { clamp } from "@/shared/lib/worklet-math";
import { lerp } from "./image-viewer-geometry";

export interface StackPose {
  x: number;
  y: number;
  rotate: number;
  scale: number;
  opacity: number;
  zIndex: number;
}

const LAYERS = [
  { x: 0, y: 0, rotate: 0, scale: 1 },
  { x: -12, y: 6, rotate: -6, scale: 0.94 },
  { x: 12, y: 10, rotate: 5, scale: 0.9 },
] as const;
const THROW = 0.5;
const THROW_TURN = 10;

export function stackDepth(slot: number, position: number, count: number) {
  "worklet";
  const depth = (slot - position) % count;
  return depth < 0 ? depth + count : depth;
}

export function frontSlot(position: number, count: number) {
  "worklet";
  const slot = Math.round(position) % count;
  return slot < 0 ? slot + count : slot;
}

function layer(depth: number, mirror: number) {
  "worklet";
  const last = LAYERS.length - 1;
  const lower = Math.min(Math.floor(depth), last);
  const upper = Math.min(lower + 1, last);
  const t = clamp(depth - lower, 0, 1);
  const from = LAYERS[lower] ?? LAYERS[0];
  const to = LAYERS[upper] ?? LAYERS[0];
  return {
    x: lerp(from.x, to.x, t) * mirror,
    y: lerp(from.y, to.y, t),
    rotate: lerp(from.rotate, to.rotate, t) * mirror,
    scale: lerp(from.scale, to.scale, t),
    opacity: clamp(LAYERS.length - depth, 0, 1),
  };
}

export function stackPose(
  depth: number,
  count: number,
  width: number,
  direction: number,
  thrown: boolean,
  mirror: number,
): StackPose {
  "worklet";
  if (count > 1 && depth > count - 1) {
    const u = count - depth;
    const from = layer(0, mirror);
    const to = layer(count - 1, mirror);
    const arc = thrown ? Math.sin(Math.PI * u) : 0;
    return {
      x: lerp(from.x, to.x, u) + direction * width * THROW * arc,
      y: lerp(from.y, to.y, u),
      rotate: lerp(from.rotate, to.rotate, u) + direction * THROW_TURN * arc,
      scale: lerp(from.scale, to.scale, u),
      opacity: lerp(from.opacity, to.opacity, u),
      zIndex: u < 0.5 ? (count + 1) * 100 : 0,
    };
  }
  return { ...layer(depth, mirror), zIndex: Math.round((count - depth) * 100) };
}

export function throwReach(width: number) {
  "worklet";
  return width * THROW;
}

export function dragPose(dragX: number, width: number): Pick<StackPose, "x" | "rotate"> {
  "worklet";
  return { x: dragX, rotate: (dragX / (width * THROW)) * THROW_TURN };
}

export function throwProgress(dragX: number, width: number) {
  "worklet";
  return Math.asin(clamp(Math.abs(dragX) / (width * THROW), 0, 1)) / Math.PI;
}

export function throwVelocity(velocityX: number, progress: number, width: number) {
  "worklet";
  const pace = width * THROW * Math.PI * Math.cos(Math.PI * progress);
  return pace > 1 ? clamp(Math.abs(velocityX) / pace, 0, 8) : 8;
}

const FLICK_VELOCITY = 500;

export function shouldThrow(dragX: number, velocityX: number, width: number) {
  "worklet";
  if (Math.abs(velocityX) > FLICK_VELOCITY && Math.sign(velocityX) === Math.sign(dragX)) return true;
  return Math.abs(dragX) > width * THROW * 0.4;
}
