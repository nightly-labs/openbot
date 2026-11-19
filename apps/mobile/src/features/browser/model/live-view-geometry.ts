import { clamp } from "@/shared/lib/worklet-math";

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
export const MAX_ZOOM = 5;

export function fittedRect(stage: Size, frame: Size): Rect {
  "worklet";
  if (stage.width <= 0 || stage.height <= 0 || frame.width <= 0 || frame.height <= 0)
    return { x: 0, y: 0, width: 0, height: 0 };
  const scale = Math.min(stage.width / frame.width, stage.height / frame.height);
  const width = frame.width * scale;
  const height = frame.height * scale;
  return { x: (stage.width - width) / 2, y: (stage.height - height) / 2, width, height };
}

export function shownRect(stage: Size, frame: Size, zoom: Zoom): Rect {
  const fitted = fittedRect(stage, frame);
  return {
    x: fitted.x * zoom.scale + zoom.x,
    y: fitted.y * zoom.scale + zoom.y,
    width: fitted.width * zoom.scale,
    height: fitted.height * zoom.scale,
  };
}

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

export function pointsPerPixel(stage: Size, frame: Size, zoom: Zoom): number {
  return frame.width > 0 ? shownRect(stage, frame, zoom).width / frame.width : 1;
}

export function pinchZoom(from: Zoom, focal: Point, to: Point, scale: number): Zoom {
  "worklet";
  const contentX = (focal.x - from.x) / from.scale;
  const contentY = (focal.y - from.y) / from.scale;
  return { scale, x: to.x - contentX * scale, y: to.y - contentY * scale };
}

export function clampZoom(stage: Size, frame: Size, zoom: Zoom): Zoom {
  "worklet";
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

function visibleFractions(stage: Size, frame: Size, zoom: Zoom): { start: Point; end: Point } {
  const rect = shownRect(stage, frame, zoom);
  const start = clampFraction(toFraction({ x: 0, y: 0 }, rect));
  const end = clampFraction(toFraction({ x: stage.width, y: stage.height }, rect));
  return { start, end };
}

export function visibleCenter(stage: Size, frame: Size, zoom: Zoom): Point {
  const { start, end } = visibleFractions(stage, frame, zoom);
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
}

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
