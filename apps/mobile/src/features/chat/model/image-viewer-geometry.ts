import { clamp } from "@/shared/lib/worklet-math";

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

export function lerp(from: number, to: number, t: number) {
  "worklet";
  return from + (to - from) * t;
}

export function lerpRect(from: Rect, to: Rect, t: number): Rect {
  "worklet";
  return {
    x: lerp(from.x, to.x, t),
    y: lerp(from.y, to.y, t),
    width: lerp(from.width, to.width, t),
    height: lerp(from.height, to.height, t),
  };
}

export function fitWithin(image: Size, box: Rect): Rect {
  "worklet";
  if (image.width <= 0 || image.height <= 0) return box;
  const scale = Math.min(box.width / image.width, box.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

export function coverSize(image: Size, frame: Size): Size {
  "worklet";
  if (image.width <= 0 || image.height <= 0) return frame;
  const scale = Math.max(frame.width / image.width, frame.height / image.height);
  return { width: image.width * scale, height: image.height * scale };
}

export function rubberBandClamp(value: number, min: number, max: number, dimension: number) {
  "worklet";
  const clamped = clamp(value, min, max);
  const overshoot = Math.abs(value - clamped);
  if (overshoot === 0 || dimension <= 0) return clamped;
  const give = (1 - 1 / ((overshoot * 0.55) / dimension + 1)) * dimension;
  return clamped + (value < clamped ? -give : give);
}

export function panBound(fitted: number, scale: number, viewport: number) {
  "worklet";
  return Math.max(0, (fitted * scale - viewport) / 2);
}

export function focalTranslation(focal: number, offset: number, fromScale: number, toScale: number) {
  "worklet";
  if (fromScale === 0) return focal;
  return focal - offset * (toScale / fromScale);
}

const DISMISS_DISTANCE = 110;

export function shouldDismiss(translation: number, velocity: number) {
  "worklet";
  const projected = translation + velocity * 0.2;
  if (Math.abs(projected) <= DISMISS_DISTANCE) return false;
  return translation === 0 || Math.sign(projected) === Math.sign(translation);
}

export function dragFade(distance: number, viewport: number) {
  "worklet";
  if (viewport <= 0) return 1;
  return 1 - clamp(Math.abs(distance) / (viewport * 0.4), 0, 1) * 0.85;
}

export function dragScale(distance: number, viewport: number) {
  "worklet";
  if (viewport <= 0) return 1;
  return 1 - clamp(Math.abs(distance) / viewport, 0, 1) * 0.2;
}

export function hitsRect(px: number, py: number, rect: Rect, scale: number, tx: number, ty: number) {
  "worklet";
  const cx = rect.x + rect.width / 2 + tx;
  const cy = rect.y + rect.height / 2 + ty;
  return Math.abs(px - cx) <= (rect.width * scale) / 2 && Math.abs(py - cy) <= (rect.height * scale) / 2;
}

const PAGE_FLICK_VELOCITY = 400;

export function pageTurn(offset: number, velocity: number, step: number) {
  "worklet";
  if (Math.abs(velocity) > PAGE_FLICK_VELOCITY && Math.sign(velocity) === Math.sign(offset))
    return velocity < 0 ? 1 : -1;
  if (Math.abs(offset) > step / 2) return offset < 0 ? 1 : -1;
  return 0;
}
