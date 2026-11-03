/**
 * The arithmetic of a message's image stack. One number, `position`, says which card is in front:
 * it grows by one each time the front card goes to the back. Every card reads its pose from it on
 * the UI thread, so a swipe and the cards that move up behind it never wait for the JS thread.
 */

import { clamp, lerp } from "./image-viewer-geometry";

export interface StackPose {
  x: number;
  y: number;
  rotate: number;
  scale: number;
  opacity: number;
  zIndex: number;
}

// The front card, then the cards that show behind it, turned a little to either side.
const LAYERS = [
  { x: 0, y: 0, rotate: 0, scale: 1 },
  { x: -12, y: 6, rotate: -6, scale: 0.94 },
  { x: 12, y: 10, rotate: 5, scale: 0.9 },
] as const;
/**
 * How far the front card travels to the side on its way to the back, in card widths. Half a card
 * clears the stack enough to read as a shuffle, and keeps the card on the screen.
 */
const THROW = 0.5;
/** How far it turns at the far point, in degrees. */
const THROW_TURN = 10;

/** How many cards back a card is: 0 in front. A card on its way to the back is between count - 1 and count. */
export function stackDepth(slot: number, position: number, count: number) {
  "worklet";
  const depth = (slot - position) % count;
  return depth < 0 ? depth + count : depth;
}

/** The card in front at a position at rest. */
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
    // Cards past the last layer wait, unseen, behind it.
    opacity: clamp(LAYERS.length - depth, 0, 1),
  };
}

/**
 * Where a card is drawn. The card on its way to the back first swings out to the side the swipe
 * went, passes behind the others at the far point, and settles in the last place. `mirror` is -1
 * for a stack on the right of the chat: its cards fan out the other way, as a mirror image.
 */
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

/** How far a finger can pull the front card before it resists: the far point of the throw. */
export function throwReach(width: number) {
  "worklet";
  return width * THROW;
}

/** The front card under a finger: the same swing the throw starts with, so the release does not jump. */
export function dragPose(dragX: number, width: number): Pick<StackPose, "x" | "rotate"> {
  "worklet";
  return { x: dragX, rotate: (dragX / (width * THROW)) * THROW_TURN };
}

/** The part of the throw a drag has already done, from 0 to 0.5, the far point. */
export function throwProgress(dragX: number, width: number) {
  "worklet";
  return Math.asin(clamp(Math.abs(dragX) / (width * THROW), 0, 1)) / Math.PI;
}

/** The finger's speed as a speed of `position`, so the throw keeps the pace of the release. */
export function throwVelocity(velocityX: number, progress: number, width: number) {
  "worklet";
  const pace = width * THROW * Math.PI * Math.cos(Math.PI * progress);
  return pace > 1 ? clamp(Math.abs(velocityX) / pace, 0, 8) : 8;
}

/** A release faster than this, in points per second, throws the card from any distance. */
const FLICK_VELOCITY = 500;

/** Whether a released drag sends the front card to the back. */
export function shouldThrow(dragX: number, velocityX: number, width: number) {
  "worklet";
  if (Math.abs(velocityX) > FLICK_VELOCITY && Math.sign(velocityX) === Math.sign(dragX)) return true;
  return Math.abs(dragX) > width * THROW * 0.4;
}
