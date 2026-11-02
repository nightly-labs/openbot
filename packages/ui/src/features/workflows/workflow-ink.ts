/** The lines that the Draw tool puts on the canvas, and the box geometry that the canvas uses. */

import type { WfnPoint } from "./workflow-board";
import type { CanvasColor } from "./workflow-node-parts";

export type Brush = "pen" | "marker";

/** A line drawn on the canvas, in canvas units. */
export interface Stroke {
  id: string;
  brush: Brush;
  color: CanvasColor;
  width: number;
  points: readonly WfnPoint[];
}

/** The width of a line on the screen when it is drawn. A line keeps its width on the canvas after a zoom. */
export const INK_WIDTH: Record<Brush, number> = { pen: 2.5, marker: 14 };
/** The eraser takes each line that comes this near to the pointer, in screen pixels. */
export const ERASER_RADIUS = 8;
/** A point nearer than this to the last point of the line, in screen pixels, is not added. */
export const INK_STEP = 1.5;

const round = (value: number) => Math.round(value * 10) / 10;

/** A smooth path through the points: each point bends a curve that goes from midpoint to midpoint. */
export function inkPath(points: readonly WfnPoint[]): string {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return "";
  // One point is a dot: a round cap on a very short line.
  if (points.length < 3) return `M${round(first.x)} ${round(first.y)}L${round(last.x) + 0.1} ${round(last.y)}`;
  let path = `M${round(first.x)} ${round(first.y)}`;
  for (let index = 1; index < points.length - 1; index++) {
    const point = points[index];
    const next = points[index + 1];
    if (!point || !next) continue;
    path += `Q${round(point.x)} ${round(point.y)} ${round((point.x + next.x) / 2)} ${round((point.y + next.y) / 2)}`;
  }
  return `${path}L${round(last.x)} ${round(last.y)}`;
}

/** How far a point is from the segment between two points. */
function segmentDistance(point: WfnPoint, from: WfnPoint, to: WfnPoint) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  const along =
    length === 0 ? 0 : Math.min(Math.max(((point.x - from.x) * dx + (point.y - from.y) * dy) / length, 0), 1);
  return Math.hypot(point.x - (from.x + along * dx), point.y - (from.y + along * dy));
}

/** Whether a circle at a point touches a line. */
export const touches = (stroke: Stroke, at: WfnPoint, radius: number) =>
  stroke.points.some(
    (point, index) => segmentDistance(at, stroke.points[index - 1] ?? point, point) <= radius + stroke.width / 2,
  );

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The box that a line covers, with half its width on each side. */
export function strokeBox(stroke: Stroke): Box {
  const half = stroke.width / 2;
  const xs = stroke.points.map((point) => point.x);
  const ys = stroke.points.map((point) => point.y);
  const left = Math.min(...xs) - half;
  const top = Math.min(...ys) - half;
  return { x: left, y: top, width: Math.max(...xs) + half - left, height: Math.max(...ys) + half - top };
}

export const union = (boxes: readonly Box[]): Box | undefined => {
  if (boxes.length === 0) return undefined;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  return {
    x: left,
    y: top,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - left,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - top,
  };
};

export const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
