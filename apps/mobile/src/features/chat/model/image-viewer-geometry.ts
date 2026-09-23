/**
 * The arithmetic of the image viewer. Each function runs inside a gesture or an animated style
 * on the UI thread, so each is a worklet, and none touches React Native, so tests run them in
 * Node. The model and the values follow PanelUI's ImageViewer (MIT, panelui.dev).
 */

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

export function clamp(value: number, min: number, max: number) {
  "worklet";
  return Math.min(Math.max(value, min), max);
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

/** The largest rect of the image's shape inside the box, centred in it. */
export function fitWithin(image: Size, box: Rect): Rect {
  "worklet";
  if (image.width <= 0 || image.height <= 0) return box;
  const scale = Math.min(box.width / image.width, box.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

/**
 * The smallest size of the image's shape that covers the frame. The picture is drawn at this size
 * inside a frame that grows from the chat's crop to the whole image, so the crop opens out
 * instead of the picture jumping.
 */
export function coverSize(image: Size, frame: Size): Size {
  "worklet";
  if (image.width <= 0 || image.height <= 0) return frame;
  const scale = Math.max(frame.width / image.width, frame.height / image.height);
  return { width: image.width * scale, height: image.height * scale };
}

/** Past a limit, a value follows with growing resistance and never quite reaches `dimension`. */
export function rubberBandClamp(value: number, min: number, max: number, dimension: number) {
  "worklet";
  const clamped = clamp(value, min, max);
  const overshoot = Math.abs(value - clamped);
  if (overshoot === 0 || dimension <= 0) return clamped;
  const give = (1 - 1 / ((overshoot * 0.55) / dimension + 1)) * dimension;
  return clamped + (value < clamped ? -give : give);
}

/** How far a zoomed image may move on one axis before its edge leaves the screen's edge. */
export function panBound(fitted: number, scale: number, viewport: number) {
  "worklet";
  return Math.max(0, (fitted * scale - viewport) / 2);
}

/** The translation that keeps the point under the fingers in place while the scale changes. */
export function focalTranslation(focal: number, offset: number, fromScale: number, toScale: number) {
  "worklet";
  if (fromScale === 0) return focal;
  return focal - offset * (toScale / fromScale);
}

/** How far a released drag must be heading, flick included, to close the viewer. */
export const DISMISS_DISTANCE = 110;

/**
 * Whether a released vertical drag closes the viewer. It reads where the image was heading, so a
 * quick flick closes it from close by, and a throw back toward the centre cancels.
 */
export function shouldDismiss(translation: number, velocity: number) {
  "worklet";
  const projected = translation + velocity * 0.2;
  if (Math.abs(projected) <= DISMISS_DISTANCE) return false;
  return translation === 0 || Math.sign(projected) === Math.sign(translation);
}

/** How much backdrop is left during a drag: mostly gone by the point a release would close. */
export function dragFade(distance: number, viewport: number) {
  "worklet";
  if (viewport <= 0) return 1;
  return 1 - clamp(Math.abs(distance) / (viewport * 0.4), 0, 1) * 0.85;
}

/** How small the image gets during a drag, never below 0.8 of its size. */
export function dragScale(distance: number, viewport: number) {
  "worklet";
  if (viewport <= 0) return 1;
  return 1 - clamp(Math.abs(distance) / viewport, 0, 1) * 0.2;
}

/** Whether a point lands on a rect scaled about its centre and then moved. */
export function hitsRect(px: number, py: number, rect: Rect, scale: number, tx: number, ty: number) {
  "worklet";
  const cx = rect.x + rect.width / 2 + tx;
  const cy = rect.y + rect.height / 2 + ty;
  return Math.abs(px - cx) <= (rect.width * scale) / 2 && Math.abs(py - cy) <= (rect.height * scale) / 2;
}
