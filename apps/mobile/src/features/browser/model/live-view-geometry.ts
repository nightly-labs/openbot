// Where the host's page is on the phone screen. The page is fitted into the stage, the area the
// live view has, and the user can zoom it. A zoom is a scale about the stage's top-left corner and
// then a translation, so a stage point `p` of the fitted page shows at `scale * p + (x, y)`.
//
// The host reads a point as a fraction of the frame, so the screen converts each touch to a
// fraction of the page as it shows now, and the pointer from a fraction back to the screen.

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point, Size {}

export interface Zoom {
  scale: number;
  x: number;
  y: number;
}

export const NO_ZOOM: Zoom = { scale: 1, x: 0, y: 0 };
/** The largest zoom. A 1280-pixel page on a phone is about three times too small to read, so four leaves room. */
export const MAX_ZOOM = 5;

/** The page fitted into the stage without zoom: whole, centered, with bars where the shapes differ. */
export function fittedRect(stage: Size, frame: Size): Rect {
  if (stage.width <= 0 || stage.height <= 0 || frame.width <= 0 || frame.height <= 0)
    return { x: 0, y: 0, width: 0, height: 0 };
  const scale = Math.min(stage.width / frame.width, stage.height / frame.height);
  const width = frame.width * scale;
  const height = frame.height * scale;
  return { x: (stage.width - width) / 2, y: (stage.height - height) / 2, width, height };
}

/** The page as it shows with the zoom. */
export function shownRect(stage: Size, frame: Size, zoom: Zoom): Rect {
  const fitted = fittedRect(stage, frame);
  return {
    x: fitted.x * zoom.scale + zoom.x,
    y: fitted.y * zoom.scale + zoom.y,
    width: fitted.width * zoom.scale,
    height: fitted.height * zoom.scale,
  };
}

/** A stage point as a fraction of the page. Outside 0..1 when the point is on a bar. */
export function toFraction(point: Point, rect: Rect): Point {
  return {
    x: rect.width > 0 ? (point.x - rect.x) / rect.width : 0.5,
    y: rect.height > 0 ? (point.y - rect.y) / rect.height : 0.5,
  };
}

export function fromFraction(fraction: Point, rect: Rect): Point {
  return { x: rect.x + fraction.x * rect.width, y: rect.y + fraction.y * rect.height };
}

export function clampFraction(fraction: Point): Point {
  return { x: clamp(fraction.x, 0, 1), y: clamp(fraction.y, 0, 1) };
}

/** Stage points per page pixel: how far a finger moves for one pixel of the page. */
export function pointsPerPixel(stage: Size, frame: Size, zoom: Zoom): number {
  return frame.width > 0 ? shownRect(stage, frame, zoom).width / frame.width : 1;
}

/**
 * The zoom `from` scaled to `scale` with the stage point `focal` kept where it is, and moved so that
 * point follows `to`. This is what two fingers do: they pinch about their middle, and drag it.
 */
export function pinchZoom(from: Zoom, focal: Point, to: Point, scale: number): Zoom {
  const contentX = (focal.x - from.x) / from.scale;
  const contentY = (focal.y - from.y) / from.scale;
  return { scale, x: to.x - contentX * scale, y: to.y - contentY * scale };
}

/**
 * A zoom inside its limits: the scale between 1 and `MAX_ZOOM`, and the page over the whole stage
 * on each side where it is larger than the stage, or centered where it is not.
 */
export function clampZoom(stage: Size, frame: Size, zoom: Zoom): Zoom {
  const scale = clamp(zoom.scale, 1, MAX_ZOOM);
  const fitted = fittedRect(stage, frame);
  const axis = (stageSize: number, offset: number, size: number, translation: number) => {
    const shownSize = size * scale;
    const shownStart = offset * scale + translation;
    const start = shownSize <= stageSize ? (stageSize - shownSize) / 2 : clamp(shownStart, stageSize - shownSize, 0);
    return start - offset * scale;
  };
  return {
    scale,
    x: axis(stage.width, fitted.x, fitted.width, zoom.x),
    y: axis(stage.height, fitted.y, fitted.height, zoom.y),
  };
}

/** The part of the page the stage shows, as fractions of the page. */
function visibleFractions(stage: Size, frame: Size, zoom: Zoom): { start: Point; end: Point } {
  const rect = shownRect(stage, frame, zoom);
  const start = clampFraction(toFraction({ x: 0, y: 0 }, rect));
  const end = clampFraction(toFraction({ x: stage.width, y: stage.height }, rect));
  return { start, end };
}

/** The middle of the part of the page that shows. Recenter puts the pointer here. */
export function visibleCenter(stage: Size, frame: Size, zoom: Zoom): Point {
  const { start, end } = visibleFractions(stage, frame, zoom);
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
}

/**
 * The zoom moved just enough to show the page point `fraction` at least `margin` points inside
 * the stage. The pointer of the trackpad mode stays in view this way when the page is zoomed.
 */
export function revealFraction(stage: Size, frame: Size, zoom: Zoom, fraction: Point, margin: number): Zoom {
  const point = fromFraction(fraction, shownRect(stage, frame, zoom));
  const shift = (position: number, size: number) => {
    const inset = Math.min(margin, size / 2);
    if (position < inset) return inset - position;
    if (position > size - inset) return size - inset - position;
    return 0;
  };
  const moved = {
    scale: zoom.scale,
    x: zoom.x + shift(point.x, stage.width),
    y: zoom.y + shift(point.y, stage.height),
  };
  return clampZoom(stage, frame, moved);
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
